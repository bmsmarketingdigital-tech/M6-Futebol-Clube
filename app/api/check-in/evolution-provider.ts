import { env } from "cloudflare:workers";

const runtime = env as unknown as Record<string, string | undefined>;

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
