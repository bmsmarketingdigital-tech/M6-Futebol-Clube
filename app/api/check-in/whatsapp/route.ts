import { getApiContext } from "../../api-auth";
import {
  controlWhatsAppBridge,
  getWhatsAppBridgeStatus,
} from "../whatsapp-bridge";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getApiContext(request);
  if (!context) {
    return Response.json(
      { error: "Faça login para configurar o WhatsApp." },
      { status: 401 },
    );
  }
  return Response.json({ whatsapp: await getWhatsAppBridgeStatus() });
}

export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json(
        { error: "Faça login para configurar o WhatsApp." },
        { status: 401 },
      );
    }
    const payload = (await request.json()) as {
      action?: "connect" | "disconnect";
    };
    if (!payload.action || !["connect", "disconnect"].includes(payload.action)) {
      return Response.json({ error: "Ação inválida." }, { status: 400 });
    }
    const whatsapp = await controlWhatsAppBridge(payload.action);
    return Response.json({ whatsapp: { configured: true, ...whatsapp } });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível controlar o WhatsApp.",
      },
      { status: 500 },
    );
  }
}
