import {
  evolutionConfigured,
  getEvolutionConnectionState,
  getEvolutionQrCode,
  logoutEvolutionInstance,
  sendEvolutionWhatsAppMessage,
} from "./evolution-provider";
import { getRuntimeEnv } from "../runtime-env";

const runtime = getRuntimeEnv();

class WhatsAppBridgeError extends Error {
  constructor(message: string, readonly deliveryUnknown: boolean) {
    super(message);
  }
}

export type WhatsAppBridgeStatus = {
  configured: boolean;
  status:
    | "unavailable"
    | "disconnected"
    | "starting"
    | "qr"
    | "authenticated"
    | "connected"
    | "error";
  qrCodeDataUrl: string;
  connectedPhone: string;
  lastError: string;
  lastMessage: string;
  updatedAt: string | null;
};

export function whatsappBridgeConfigured() {
  return Boolean(runtime.WHATSAPP_BRIDGE_URL) || evolutionConfigured(runtime);
}

async function bridgeRequest<T>(path: string, init?: RequestInit) {
  const bridgeUrl = runtime.WHATSAPP_BRIDGE_URL?.replace(/\/+$/, "");
  if (!bridgeUrl) throw new Error("Conector local não configurado.");
  let response: Response;
  try {
    response = await fetch(`${bridgeUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(runtime.WHATSAPP_BRIDGE_TOKEN
          ? { Authorization: `Bearer ${runtime.WHATSAPP_BRIDGE_TOKEN}` }
          : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    throw new WhatsAppBridgeError(
      error instanceof Error ? error.message : "O conector local não respondeu.",
      path === "/send",
    );
  }
  let payload: T & { ok?: boolean; error?: string; deliveryUnknown?: boolean };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new WhatsAppBridgeError(
      "O conector retornou uma resposta inválida.",
      path === "/send",
    );
  }
  if (!response.ok || payload.ok === false) {
    throw new WhatsAppBridgeError(
      payload.error || "O conector do WhatsApp recusou a operação.",
      Boolean(payload.deliveryUnknown),
    );
  }
  return payload;
}

export async function getWhatsAppBridgeStatus(): Promise<WhatsAppBridgeStatus> {
  if (!runtime.WHATSAPP_BRIDGE_URL && evolutionConfigured(runtime)) {
    const state = await getEvolutionConnectionState();
    if (state === "open") {
      return {
        configured: true,
        status: "connected",
        qrCodeDataUrl: "",
        connectedPhone: "",
        lastError: "",
        lastMessage: "WhatsApp conectado via Evolution API.",
        updatedAt: new Date().toISOString(),
      };
    }
    if (state === "connecting" || state === "close") {
      const { qrCodeDataUrl, error } = await getEvolutionQrCode();
      return {
        configured: true,
        status: qrCodeDataUrl ? "qr" : "disconnected",
        qrCodeDataUrl,
        connectedPhone: "",
        lastError: error ?? "",
        lastMessage: qrCodeDataUrl
          ? "Escaneie o QR Code para conectar o WhatsApp."
          : "WhatsApp desconectado.",
        updatedAt: new Date().toISOString(),
      };
    }
    return {
      configured: true,
      status: "error",
      qrCodeDataUrl: "",
      connectedPhone: "",
      lastError: "Não foi possível consultar o status da Evolution API.",
      lastMessage: "Status indisponível.",
      updatedAt: new Date().toISOString(),
    };
  }
  if (!whatsappBridgeConfigured()) {
    return {
      configured: false,
      status: "unavailable",
      qrCodeDataUrl: "",
      connectedPhone: "",
      lastError: "",
      lastMessage: "Disponível somente no aplicativo Windows.",
      updatedAt: null,
    };
  }
  try {
    const payload = await bridgeRequest<Omit<WhatsAppBridgeStatus, "configured">>(
      "/status",
    );
    return { configured: true, ...payload };
  } catch (error) {
    return {
      configured: true,
      status: "error",
      qrCodeDataUrl: "",
      connectedPhone: "",
      lastError: error instanceof Error ? error.message : "O conector local não respondeu.",
      lastMessage: "Conector local indisponível.",
      updatedAt: null,
    };
  }
}

export async function controlWhatsAppBridge(action: "connect" | "disconnect") {
  if (!runtime.WHATSAPP_BRIDGE_URL && evolutionConfigured(runtime)) {
    if (action === "disconnect") {
      await logoutEvolutionInstance();
    }
    return getWhatsAppBridgeStatus();
  }
  return bridgeRequest<Omit<WhatsAppBridgeStatus, "configured">>(`/${action}`, {
    method: "POST",
  });
}

export async function validateWhatsAppTestMode(phone: string, message: string) {
  return bridgeRequest<{
    ok: boolean;
    testMode: boolean;
    testPhoneConfigured: boolean;
    matches: boolean;
    messageConfigured: boolean;
  }>("/test-mode/validate", {
    method: "POST",
    body: JSON.stringify({ phone, message }),
  });
}

export async function sendWhatsAppMessage(phone: string, message: string) {
  if (!runtime.WHATSAPP_BRIDGE_URL && evolutionConfigured(runtime)) {
    return sendEvolutionWhatsAppMessage(phone, message);
  }
  if (!whatsappBridgeConfigured()) {
    return {
      status: "pending" as const,
      error: "Aguardando conexão do WhatsApp no aplicativo Windows.",
      providerMessageId: null,
    };
  }
  try {
    const payload = await bridgeRequest<{ ok: boolean; providerMessageId?: string }>(
      "/send",
      { method: "POST", body: JSON.stringify({ phone, message }) },
    );
    return {
      status: "sent" as const,
      error: null,
      providerMessageId: payload.providerMessageId ?? null,
    };
  } catch (error) {
    return {
      status:
        error instanceof WhatsAppBridgeError && error.deliveryUnknown
          ? ("delivery_unknown" as const)
          : ("failed" as const),
      error: error instanceof Error ? error.message : "O conector do WhatsApp não respondeu.",
      providerMessageId: null,
    };
  }
}
