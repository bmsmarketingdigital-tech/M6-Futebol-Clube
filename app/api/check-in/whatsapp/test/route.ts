import { getWhatsAppBridgeStatus, sendWhatsAppMessage } from "../../whatsapp-bridge";
import { getApiContext } from "../../../api-auth";

export const dynamic = "force-dynamic";

const TEST_PHONE = "18981518787";

export async function POST(request: Request) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  const status = await getWhatsAppBridgeStatus();
  if (status.status !== "connected") {
    return Response.json({ error: "Conecte o WhatsApp pelo QR Code antes de enviar o teste.", bridge: status }, { status: 409 });
  }
  const result = await sendWhatsAppMessage(
    TEST_PHONE,
    "Teste de notificação da Gestão Esportiva: a conexão do WhatsApp está funcionando ✅",
  );
  if (result.status !== "sent") return Response.json({ error: result.error ?? "Falha ao enviar.", bridge: status }, { status: 502 });
  return Response.json({ ok: true, phone: TEST_PHONE, bridge: status });
}
