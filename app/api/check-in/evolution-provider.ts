import { getRuntimeEnv } from "../runtime-env";

const runtime = getRuntimeEnv();

type EvolutionConfig = {
  apiKey: string;
  baseUrl: string;
  instance: string;
};

export function normalizeEvolutionPhone(value = "") {
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

function connectFieldsFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return { qrCodeDataUrl: "", pairingCode: null as string | null };
  const record = payload as Record<string, unknown>;
  // Resposta do /connect sem "number": { base64, code, pairingCode: null, count }.
  // Resposta do /create: os mesmos campos aninhados em "qrcode".
  // Resposta do /connect com "number": { pairingCode: "6LHHNDM2", count } (sem QR).
  const nested = record.qrcode as Record<string, unknown> | undefined;
  const base64 = record.base64 ?? nested?.base64;
  const pairingCode = record.pairingCode ?? nested?.pairingCode;
  return {
    qrCodeDataUrl: typeof base64 === "string" ? base64 : "",
    pairingCode: typeof pairingCode === "string" ? pairingCode : null,
  };
}

// Pede uma forma nova de conectar o numero desta instancia: QR Code (padrao) ou,
// se "phone" for informado, um codigo de pareamento de 8 digitos -- util quando
// o unico aparelho disponivel para conectar e o mesmo que esta olhando a tela
// (nao da para escanear um QR exibido na propria tela do celular do WhatsApp).
// Chamado quando o estado nao esta "open" (ainda nao conectado ou sessao expirada).
export async function getEvolutionConnectPayload(
  phone?: string,
): Promise<{ qrCodeDataUrl: string; pairingCode: string | null; error: string | null }> {
  const config = getEvolutionConfig();
  if (!config) return { qrCodeDataUrl: "", pairingCode: null, error: "Evolution API nao configurada." };
  const number = phone ? normalizeEvolutionPhone(phone) : "";
  const url = `${config.baseUrl}/instance/connect/${config.instance}${number ? `?number=${number}` : ""}`;
  try {
    const response = await fetch(url, { headers: { apikey: config.apiKey } });
    const raw = await response.text().catch(() => "");
    if (!response.ok) {
      return {
        qrCodeDataUrl: "",
        pairingCode: null,
        error: `Evolution API respondeu ${response.status}${raw ? `: ${raw.slice(0, 200)}` : ""}`,
      };
    }
    const payload = raw ? (JSON.parse(raw) as unknown) : null;
    return { ...connectFieldsFromPayload(payload), error: null };
  } catch (error) {
    return {
      qrCodeDataUrl: "",
      pairingCode: null,
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

  const number = normalizeEvolutionPhone(phone);
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
