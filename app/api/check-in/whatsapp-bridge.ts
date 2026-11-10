import { getRuntimeEnv } from "../runtime-env";
import { selectWhatsAppProvider, whatsappBridgeConfigured, type WhatsAppProvider } from "./whatsapp-provider-selection";
import { canSendEvolution, readEvolutionWhatsAppStatus } from "./whatsapp-evolution-status";
import {
  getEvolutionConnectionState,
  getEvolutionConnectPayload,
  logoutEvolutionInstance,
  normalizeEvolutionPhone,
  sendEvolutionWhatsAppMessage,
  type PhoneVerification,
} from "./evolution-provider";
import {
  getWhatsAppOrganizationPhones,
  setWhatsAppExpectedPhone,
} from "./whatsapp-organization-store";

const runtime = getRuntimeEnv();

class WhatsAppBridgeError extends Error {
  constructor(message: string, readonly deliveryUnknown: boolean) {
    super(message);
  }
}

export type WhatsAppBridgeStatus = {
  configured: boolean;
  status: "unavailable" | "disconnected" | "starting" | "qr" | "authenticated" | "connected" | "error";
  qrCodeDataUrl: string;
  pairingCode: string | null;
  connectedPhone: string;
  phoneVerification?: PhoneVerification;
  phoneMismatch?: boolean;
  lastError: string;
  lastMessage: string;
  updatedAt: string | null;
};

export { selectWhatsAppProvider, whatsappBridgeConfigured };
export type { WhatsAppProvider };

async function bridgeRequest<T>(path: string, init?: RequestInit) {
  const bridgeUrl = runtime.WHATSAPP_BRIDGE_URL?.replace(/\/+$/, "");
  if (!bridgeUrl) throw new Error("Conector local indisponível.");
  let response: Response;
  try {
    response = await fetch(`${bridgeUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(runtime.WHATSAPP_BRIDGE_TOKEN ? { Authorization: `Bearer ${runtime.WHATSAPP_BRIDGE_TOKEN}` } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    throw new WhatsAppBridgeError(error instanceof Error ? error.message : "O conector local não respondeu.", path === "/send");
  }
  let payload: T & { ok?: boolean; error?: string; deliveryUnknown?: boolean };
  try {
    payload = await response.json() as typeof payload;
  } catch {
    throw new WhatsAppBridgeError("O conector retornou uma resposta inválida.", path === "/send");
  }
  if (!response.ok || payload.ok === false) {
    throw new WhatsAppBridgeError(payload.error || "O conector do WhatsApp recusou a operação.", Boolean(payload.deliveryUnknown));
  }
  return payload;
}

export async function getWhatsAppBridgeStatus(organizationId: string): Promise<WhatsAppBridgeStatus> {
  if (!organizationId) throw new Error("Organização obrigatória para WhatsApp.");
  const provider = selectWhatsAppProvider(organizationId);
  if (provider === "evolution") {
    return readEvolutionWhatsAppStatus(organizationId, {
      getState: getEvolutionConnectionState,
      getConnectedPhone: (orgId) => import("./evolution-provider").then(({ getEvolutionConnectedPhone }) => getEvolutionConnectedPhone(orgId)),
      getStoredPhones: getWhatsAppOrganizationPhones,
    });
  }

  if (provider === "none") {
    return { configured: false, status: "unavailable", qrCodeDataUrl: "", pairingCode: null, connectedPhone: "", lastError: "", lastMessage: "Nenhum provider WhatsApp configurado para esta organização.", updatedAt: null };
  }

  try {
    const payload = await bridgeRequest<Omit<WhatsAppBridgeStatus, "configured" | "pairingCode">>("/status");
    return { configured: true, pairingCode: null, ...payload };
  } catch {
    return { configured: true, status: "error", qrCodeDataUrl: "", pairingCode: null, connectedPhone: "", lastError: "O conector local não respondeu.", lastMessage: "Conector local indisponível.", updatedAt: null };
  }
}

export async function controlWhatsAppBridge(organizationId: string, action: "connect" | "disconnect", phone?: string) {
  if (!organizationId) throw new Error("Organização obrigatória para WhatsApp.");
  const provider = selectWhatsAppProvider(organizationId);
  if (provider === "evolution") {
    if (action === "disconnect") {
      const result = await logoutEvolutionInstance(organizationId);
      if (!result.ok) throw new Error("Não foi possível desconectar a sessão WhatsApp desta organização.");
      return getWhatsAppBridgeStatus(organizationId);
    }

    const normalizedPhone = phone ? normalizeEvolutionPhone(phone) : "";
    if (phone && !/^\d{10,15}$/.test(normalizedPhone)) throw new Error("Informe um telefone válido com DDD e código do país.");
    if (normalizedPhone) await setWhatsAppExpectedPhone(organizationId, normalizedPhone);
    const currentState = await getEvolutionConnectionState(organizationId);
    if (currentState === "open") return getWhatsAppBridgeStatus(organizationId);

    // Only this explicit POST action reaches /instance/connect. Status polling
    // never requests a QR code or pairing code.
    const payload = await getEvolutionConnectPayload(organizationId, normalizedPhone || undefined);
    if (payload.error) throw new Error("A Evolution API não conseguiu iniciar a conexão.");
    return {
      configured: true,
      status: payload.pairingCode || payload.qrCodeDataUrl ? "qr" as const : "starting" as const,
      qrCodeDataUrl: payload.qrCodeDataUrl,
      pairingCode: payload.pairingCode,
      connectedPhone: "",
      phoneVerification: "unknown" as const,
      lastError: "",
      lastMessage: payload.pairingCode ? "Digite o código no WhatsApp para conectar." : payload.qrCodeDataUrl ? "Escaneie o QR Code para conectar." : "Aguardando conexão do WhatsApp.",
      updatedAt: new Date().toISOString(),
    };
  }

  if (provider === "none") throw new Error("Nenhum provider WhatsApp configurado para esta organização.");
  const payload = await bridgeRequest<Omit<WhatsAppBridgeStatus, "configured" | "pairingCode">>(`/${action}`, { method: "POST" });
  return { configured: true, pairingCode: null, ...payload };
}

export async function validateWhatsAppTestMode(phone: string, message: string) {
  return bridgeRequest<{
    ok: boolean;
    testMode: boolean;
    testPhoneConfigured: boolean;
    matches: boolean;
    messageConfigured: boolean;
  }>("/test-mode/validate", { method: "POST", body: JSON.stringify({ phone, message }) });
}

export async function sendWhatsAppMessage(organizationId: string, phone: string, message: string) {
  if (!organizationId) throw new Error("Organização obrigatória para WhatsApp.");
  const provider = selectWhatsAppProvider(organizationId);
  if (provider === "evolution") {
    const status = await getWhatsAppBridgeStatus(organizationId);
    if (!canSendEvolution(status)) {
      return {
        status: "pending" as const,
        error: status.phoneVerification === "mismatch"
          ? "Telefone conectado diverge do esperado; envio bloqueado."
          : "Telefone conectado ainda não foi confirmado; envio bloqueado.",
        providerMessageId: null,
      };
    }
    return sendEvolutionWhatsAppMessage(organizationId, phone, message);
  }
  if (provider === "none") {
    return { status: "pending" as const, error: "Nenhum provider WhatsApp configurado para esta organização.", providerMessageId: null };
  }
  try {
    const payload = await bridgeRequest<{ ok: boolean; providerMessageId?: string }>("/send", {
      method: "POST",
      body: JSON.stringify({ phone, message }),
    });
    return { status: "sent" as const, error: null, providerMessageId: payload.providerMessageId ?? null };
  } catch (error) {
    return {
      status: error instanceof WhatsAppBridgeError && error.deliveryUnknown ? "delivery_unknown" as const : "failed" as const,
      error: error instanceof Error ? error.message : "O conector do WhatsApp não respondeu.",
      providerMessageId: null,
    };
  }
}
