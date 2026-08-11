import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { athleteCheckIns } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import {
  sendWhatsAppMessage,
  whatsappBridgeConfigured,
} from "../whatsapp-bridge";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json(
        { error: "Faça login para enviar as notificações." },
        { status: 401 },
      );
    }
    if (!whatsappBridgeConfigured()) {
      return Response.json(
        { error: "Conecte o WhatsApp no aplicativo Windows primeiro." },
        { status: 409 },
      );
    }

    const db = getDb();
    const queued = await db
      .select({
        id: athleteCheckIns.id,
        phone: athleteCheckIns.guardianPhone,
        message: athleteCheckIns.notificationMessage,
      })
      .from(athleteCheckIns)
      .where(
        and(
          eq(
            athleteCheckIns.organizationId,
            context.membership.organizationId,
          ),
          inArray(athleteCheckIns.notificationStatus, ["pending", "failed"]),
          isNotNull(athleteCheckIns.guardianPhone),
        ),
      )
      .orderBy(asc(athleteCheckIns.scannedAt))
      .limit(25);

    let sent = 0;
    let failed = 0;
    for (const item of queued) {
      if (!item.phone) continue;
      const delivery = await sendWhatsAppMessage(item.phone, item.message);
      const notificationStatus =
        delivery.status === "delivery_unknown" ? "failed" : delivery.status;
      if (delivery.status === "sent") sent += 1;
      else failed += 1;
      await db
        .update(athleteCheckIns)
        .set({
          notificationStatus,
          notificationError: delivery.error,
          notifiedAt: delivery.status === "sent" ? new Date() : null,
        })
        .where(eq(athleteCheckIns.id, item.id));
    }

    return Response.json({
      attempted: queued.length,
      sent,
      failed,
      remaining: Math.max(0, queued.length - sent),
    });
  } catch (error) {
    console.error("Failed to process WhatsApp queue", error);
    return Response.json(
      { error: "Não foi possível processar a fila do WhatsApp." },
      { status: 500 },
    );
  }
}
