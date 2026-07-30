import { env } from "cloudflare:workers";

const runtime = env as unknown as Record<string, string | undefined>;

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
  return Boolean(runtime.WHATSAPP_BRIDGE_URL);
}

async function bridgeRequest<T>(path: string, init?: RequestInit) {
  const bridgeUrl = runtime.WHATSAPP_BRIDGE_URL?.replace(/\/+$/, "");
  if (!bridgeUrl) throw new Error("Conector local não configurado.");
  const response = await fetch(`${bridgeUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(runtime.WHATSAPP_BRIDGE_TOKEN
        ? { Authorization: `Bearer ${runtime.WHATSAPP_BRIDGE_TOKEN}` }
        : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json()) as T & {
    ok?: boolean;
    error?: string;
  };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "O conector do WhatsApp recusou a operação.");
  }
  return payload;
}

export async function getWhatsAppBridgeStatus(): Promise<WhatsAppBridgeStatus> {
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
      lastError:
        error instanceof Error
          ? error.message
          : "O conector local não respondeu.",
      lastMessage: "Conector local indisponível.",
      updatedAt: null,
    };
  }
}

export async function controlWhatsAppBridge(action: "connect" | "disconnect") {
  return bridgeRequest<Omit<WhatsAppBridgeStatus, "configured">>(`/${action}`, {
    method: "POST",
  });
}

export async function sendWhatsAppMessage(phone: string, message: string) {
  if (!whatsappBridgeConfigured()) {
    return {
      status: "pending" as const,
      error: "Aguardando conexão do WhatsApp no aplicativo Windows.",
    };
  }

  try {
    await bridgeRequest<{ ok: boolean }>("/send", {
      method: "POST",
      body: JSON.stringify({ phone, message }),
    });
    return { status: "sent" as const, error: null };
  } catch (error) {
    return {
      status: "failed" as const,
      error:
        error instanceof Error
          ? error.message
          : "O conector do WhatsApp não respondeu.",
    };
  }
}
