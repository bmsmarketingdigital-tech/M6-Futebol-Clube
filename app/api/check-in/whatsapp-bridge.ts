import { env } from "cloudflare:workers";

const runtime = env as unknown as Record<string, string | undefined>;

export function whatsappBridgeConfigured() {
  return Boolean(runtime.WHATSAPP_BRIDGE_URL);
}

export async function sendWhatsAppMessage(phone: string, message: string) {
  const bridgeUrl = runtime.WHATSAPP_BRIDGE_URL?.replace(/\/+$/, "");
  if (!bridgeUrl) {
    return {
      status: "pending" as const,
      error: "Aguardando conexão do WhatsApp no aplicativo Windows.",
    };
  }

  try {
    const response = await fetch(`${bridgeUrl}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(runtime.WHATSAPP_BRIDGE_TOKEN
          ? { Authorization: `Bearer ${runtime.WHATSAPP_BRIDGE_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ phone, message }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (!response.ok || payload.ok === false) {
      return {
        status: "failed" as const,
        error: payload.error || "O conector do WhatsApp recusou a mensagem.",
      };
    }
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
