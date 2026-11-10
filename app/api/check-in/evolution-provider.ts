import { getRuntimeEnv } from "../runtime-env";

const runtime = getRuntimeEnv();

type RuntimeSource = Record<string, string | undefined>;

export type EvolutionConfig = {
  apiKey: string;
  baseUrl: string;
  instance: string;
};

export type EvolutionConnectionState = "open" | "connecting" | "close" | "unknown";
export type PhoneVerification = "confirmed" | "unknown" | "mismatch";

const validInstanceName = /^[a-zA-Z0-9_-]{1,100}$/;

export function normalizeEvolutionPhone(value = "") {
  let digits = value.replace(/\D/g, "");
  while (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("55") && [10, 11].includes(digits.length)) digits = `55${digits}`;
  return digits;
}

export function parseEvolutionInstanceMap(source: RuntimeSource = runtime): Record<string, string> | null {
  try {
    const parsed: unknown = JSON.parse(source.EVOLUTION_API_INSTANCE_MAP || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed as Record<string, unknown>);
    const result: Record<string, string> = {};
    for (const [organizationId, instance] of entries) {
      if (!organizationId || typeof instance !== "string" || !validInstanceName.test(instance)) return null;
      if (Object.values(result).includes(instance)) return null;
      result[organizationId] = instance;
    }
    return result;
  } catch {
    return null;
  }
}

export function getEvolutionConfig(organizationId: string, source: RuntimeSource = runtime): EvolutionConfig | null {
  if (!organizationId) return null;
  const baseUrl = source.EVOLUTION_API_URL?.trim();
  const apiKey = source.EVOLUTION_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;

  const map = parseEvolutionInstanceMap(source);
  if (!map) return null;
  let instance = map[organizationId] || "";

  // Compatibility is allowed only when the legacy instance is explicitly
  // bound to this organization; a global instance is never a fallback.
  if (!instance && source.EVOLUTION_API_ORGANIZATION_ID === organizationId) {
    instance = source.EVOLUTION_API_INSTANCE || "";
  }
  if (!instance || !validInstanceName.test(instance)) return null;
  if (
    source.EVOLUTION_API_ORGANIZATION_ID &&
    source.EVOLUTION_API_ORGANIZATION_ID !== organizationId &&
    source.EVOLUTION_API_INSTANCE === instance
  ) return null;

  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, ""), instance };
}

export function evolutionConfigured(organizationId: string, source: RuntimeSource = runtime) {
  return getEvolutionConfig(organizationId, source) !== null;
}

export function evolutionConfigurationPresent(source: RuntimeSource = runtime) {
  if (!source.EVOLUTION_API_URL?.trim() || !source.EVOLUTION_API_KEY?.trim()) return false;
  if (source.EVOLUTION_API_INSTANCE_MAP?.trim()) {
    const map = parseEvolutionInstanceMap(source);
    return Boolean(map && Object.keys(map).length > 0);
  }
  return Boolean(
    source.EVOLUTION_API_ORGANIZATION_ID &&
    source.EVOLUTION_API_INSTANCE &&
    validInstanceName.test(source.EVOLUTION_API_INSTANCE),
  );
}

export function parseEvolutionConnectedPhone(payload: unknown, expectedInstance: string): string | null {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.instances)
      ? root.instances
      : Array.isArray(root?.instance)
        ? root.instance
        : root?.instance && typeof root.instance === "object"
          ? [root.instance]
          : [];
  const match = list.find((item) => {
    if (!item || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    return record.instanceName === expectedInstance || record.name === expectedInstance;
  }) as Record<string, unknown> | undefined;
  if (!match) return null;

  const raw = typeof match.ownerJid === "string"
    ? match.ownerJid
    : typeof match.number === "string"
      ? match.number
      : "";
  const digits = raw.split("@")[0].replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export function verifyEvolutionPhone(expectedPhone: string | null | undefined, confirmedPhone: string | null | undefined): PhoneVerification {
  const expected = expectedPhone ? normalizeEvolutionPhone(expectedPhone) : "";
  const confirmed = confirmedPhone ? normalizeEvolutionPhone(confirmedPhone) : "";
  if (!expected || !confirmed) return "unknown";
  return expected === confirmed ? "confirmed" : "mismatch";
}

export async function getEvolutionConnectionState(organizationId: string): Promise<EvolutionConnectionState> {
  const config = getEvolutionConfig(organizationId);
  if (!config) return "unknown";
  try {
    const response = await fetch(`${config.baseUrl}/instance/connectionState/${encodeURIComponent(config.instance)}`, {
      headers: { apikey: config.apiKey },
      cache: "no-store",
    });
    if (!response.ok) return "unknown";
    const payload = await response.json() as { instance?: { state?: string } };
    const state = payload.instance?.state;
    return state === "open" || state === "connecting" || state === "close" ? state : "unknown";
  } catch {
    return "unknown";
  }
}

export async function getEvolutionConnectedPhone(organizationId: string): Promise<string | null> {
  const config = getEvolutionConfig(organizationId);
  if (!config) return null;
  try {
    const url = new URL(`${config.baseUrl}/instance/fetchInstances`);
    url.searchParams.set("instanceName", config.instance);
    const response = await fetch(url, {
      headers: { apikey: config.apiKey },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return parseEvolutionConnectedPhone(await response.json(), config.instance);
  } catch {
    return null;
  }
}

function connectFieldsFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return { qrCodeDataUrl: "", pairingCode: null as string | null };
  const record = payload as Record<string, unknown>;
  const nested = record.qrcode && typeof record.qrcode === "object" ? record.qrcode as Record<string, unknown> : {};
  const base64 = record.base64 ?? nested.base64;
  const pairingCode = record.pairingCode ?? nested.pairingCode;
  return {
    qrCodeDataUrl: typeof base64 === "string" ? base64 : "",
    pairingCode: typeof pairingCode === "string" ? pairingCode : null,
  };
}

export async function getEvolutionConnectPayload(
  organizationId: string,
  phone?: string,
): Promise<{ qrCodeDataUrl: string; pairingCode: string | null; error: string | null }> {
  const config = getEvolutionConfig(organizationId);
  if (!config) return { qrCodeDataUrl: "", pairingCode: null, error: "Evolution API não configurada para esta organização." };
  const number = phone ? normalizeEvolutionPhone(phone) : "";
  if (phone && (!/^\d{10,15}$/.test(number))) {
    return { qrCodeDataUrl: "", pairingCode: null, error: "Informe um telefone válido com DDD e código do país." };
  }
  const url = `${config.baseUrl}/instance/connect/${encodeURIComponent(config.instance)}${number ? `?number=${encodeURIComponent(number)}` : ""}`;
  try {
    const response = await fetch(url, { headers: { apikey: config.apiKey }, cache: "no-store" });
    const raw = await response.text().catch(() => "");
    const payload = raw ? JSON.parse(raw) as unknown : null;
    if (!response.ok) return { qrCodeDataUrl: "", pairingCode: null, error: `Evolution API respondeu ${response.status}${raw ? `: ${raw.slice(0, 200)}` : ""}` };
    return { ...connectFieldsFromPayload(payload), error: null };
  } catch (error) {
    return { qrCodeDataUrl: "", pairingCode: null, error: error instanceof Error ? error.message : "Evolution API não respondeu." };
  }
}

export async function logoutEvolutionInstance(organizationId: string): Promise<{ ok: boolean; error: string | null }> {
  const config = getEvolutionConfig(organizationId);
  if (!config) return { ok: false, error: "Evolution API não configurada para esta organização." };
  try {
    const response = await fetch(`${config.baseUrl}/instance/logout/${encodeURIComponent(config.instance)}`, {
      method: "DELETE",
      headers: { apikey: config.apiKey },
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, error: `Evolution API respondeu ${response.status}` };
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Evolution API não respondeu." };
  }
}

function providerMessageIdFrom(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const key = record.key && typeof record.key === "object" ? record.key as Record<string, unknown> : null;
  return String(key?.id || record.messageId || record.id || "").trim() || null;
}

export async function sendEvolutionWhatsAppMessage(organizationId: string, phone: string, message: string) {
  const config = getEvolutionConfig(organizationId);
  if (!config) return { status: "pending" as const, error: "Evolution API não configurada para esta organização.", providerMessageId: null };
  const number = normalizeEvolutionPhone(phone);
  const text = String(message || "").trim();
  if (!/^\d{10,15}$/.test(number) || !text) {
    return { status: "failed" as const, error: "Telefone ou mensagem inválida para Evolution API.", providerMessageId: null };
  }
  try {
    const response = await fetch(`${config.baseUrl}/message/sendText/${encodeURIComponent(config.instance)}`, {
      body: JSON.stringify({ delay: 1200, number, text }),
      headers: { "Content-Type": "application/json", apikey: config.apiKey },
      method: "POST",
      cache: "no-store",
    });
    const raw = await response.text().catch(() => "");
    const payload = raw ? JSON.parse(raw) as unknown : null;
    if (!response.ok) return { status: "failed" as const, error: `Evolution API respondeu ${response.status}${raw ? `: ${raw.slice(0, 200)}` : ""}`, providerMessageId: null };
    return { status: "sent" as const, error: null, providerMessageId: providerMessageIdFrom(payload) };
  } catch (error) {
    return {
      status: "delivery_unknown" as const,
      error: error instanceof Error ? error.message : "Resultado incerto do envio pela Evolution API.",
      providerMessageId: null,
    };
  }
}
