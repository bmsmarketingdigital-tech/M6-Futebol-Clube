import { getRuntimeEnv } from "../runtime-env";

const runtime = getRuntimeEnv();

type EvolutionConfig = {
  apiKey: string;
  baseUrl: string;
  instance: string;
};

function normalizePhone(value = "") {
  let digits = value.replace(/\D/g, "");
  while (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("55") && [10, 11].includes(digits.length)) digits = `55${digits}`;
  return digits;
}

export function getEvolutionConfig(source = runtime): EvolutionConfig | null {
  const baseUrl = source.EVOLUTION_API_URL;
  const apiKey = source.EVOLUTION_API_KEY;
  const instance = source.EVOLUTION_API_INSTANCE;
  if (!baseUrl || !apiKey || !instance) return null;
  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, ""), instance };
}

export function evolutionConfigured(source = runtime) {
  return getEvolutionConfig(source) !== null;
}

function providerMessageIdFrom(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const key = record.key && typeof record.key === "object" ? record.key as Record<string, unknown> : null;
  return String(key?.id || record.messageId || record.id || "").trim() || null;
}

export type EvolutionConnectionState = "open" | "connecting" | "close" | "unknown";

export async function getEvolutionConnectionState(): Promise<EvolutionConnectionState> {
  const config = getEvolutionConfig();
  if (!config) return "unknown";
  try {
    const response = await fetch(
      `${config.baseUrl}/instance/connectionState/${config.instance}`,
      { headers: { apikey: config.apiKey } },
    );
    if (!response.ok) return "unknown";
    const payload = (await response.json()) as { instance?: { state?: string } };
    const state = payload.instance?.state;
    return state === "open" || state === "connecting" || state === "close" ? state : "unknown";
  } catch {
    return "unknown";
  }
}

function qrCodeFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const direct = record.base64;
  if (typeof direct === "string") return direct;
  const nested = record.qrcode as Record<string, unknown> | undefined;
  return typeof nested?.base64 === "string" ? nested.base64 : "";
}

// Pede um QR Code novo para conectar o numero desta instancia. Chamado quando
// o estado nao esta "open" (ainda nao conectado ou sessao expirada) -- a UI
// existente (CommunicationManagement) ja sabe renderizar qrCodeDataUrl.
export async function getEvolutionQrCode(): Promise<{ qrCodeDataUrl: string; error: string | null }> {
  const config = getEvolutionConfig();
  if (!config) return { qrCodeDataUrl: "", error: "Evolution API nao configurada." };
  try {
    const response = await fetch(`${config.baseUrl}/instance/connect/${config.instance}`, {
      headers: { apikey: config.apiKey },
    });
    const raw = await response.text().catch(() => "");
    if (!response.ok) {
      return {
        qrCodeDataUrl: "",
        error: `Evolution API respondeu ${response.status}${raw ? `: ${raw.slice(0, 200)}` : ""}`,
      };
    }
    const payload = raw ? (JSON.parse(raw) as unknown) : null;
    return { qrCodeDataUrl: qrCodeFromPayload(payload), error: null };
  } catch (error) {
    return {
      qrCodeDataUrl: "",
      error: error instanceof Error ? error.message : "Evolution API nao respondeu.",
    };
  }
}

export async function logoutEvolutionInstance(): Promise<{ ok: boolean; error: string | null }> {
  const config = getEvolutionConfig();
  if (!config) return { ok: false, error: "Evolution API nao configurada." };
  try {
    const response = await fetch(`${config.baseUrl}/instance/logout/${config.instance}`, {
      method: "DELETE",
      headers: { apikey: config.apiKey },
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      return {
        ok: false,
        error: `Evolution API respondeu ${response.status}${raw ? `: ${raw.slice(0, 200)}` : ""}`,
      };
    }
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Evolution API nao respondeu.",
    };
  }
}

export async function sendEvolutionWhatsAppMessage(phone: string, message: string) {
  const config = getEvolutionConfig();
  if (!config) {
    return {
      status: "pending" as const,
      error: "Evolution API nao configurada.",
      providerMessageId: null,
    };
  }

  const number = normalizePhone(phone);
  const text = String(message || "").trim();
  if (!number || !text) {
    return {
      status: "failed" as const,
      error: "Telefone ou mensagem invalida para Evolution API.",
      providerMessageId: null,
    };
  }

  try {
    const response = await fetch(`${config.baseUrl}/message/sendText/${config.instance}`, {
      body: JSON.stringify({ delay: 1200, number, text }),
      headers: {
        "Content-Type": "application/json",
        apikey: config.apiKey,
      },
      method: "POST",
    });
    const raw = await response.text().catch(() => "");
    const payload = raw ? JSON.parse(raw) as unknown : null;
    if (!response.ok) {
      return {
        status: "failed" as const,
        error: `Evolution API respondeu ${response.status}${raw ? `: ${raw.slice(0, 200)}` : ""}`,
        providerMessageId: null,
      };
    }
    return {
      status: "sent" as const,
      error: null,
      providerMessageId: providerMessageIdFrom(payload),
    };
  } catch (error) {
    return {
      status: "delivery_unknown" as const,
      error: error instanceof Error ? error.message : "Evolution API nao respondeu.",
      providerMessageId: null,
    };
  }
}
