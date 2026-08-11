import { and, count, desc, eq, gte, notLike } from "drizzle-orm";
import { getDb } from "../../../../../db";
import {
  athletes,
  billingNotificationSettings,
  notificationOutbox,
} from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";
import { getWhatsAppBridgeStatus } from "../../../check-in/whatsapp-bridge";
import {
  defaultBillingNotificationSettings,
  getBillingNotificationSettings,
  runBillingAutomation,
} from "../../billing-automation";

export const dynamic = "force-dynamic";

async function notificationOverview(organizationId: string) {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [sent, failed, recent, whatsapp] = await Promise.all([
    db
      .select({ total: count() })
      .from(notificationOutbox)
      .where(
        and(
          eq(notificationOutbox.organizationId, organizationId),
          eq(notificationOutbox.status, "sent"),
          gte(notificationOutbox.createdAt, since),
          notLike(notificationOutbox.idempotencyKey, "financial-test:%"),
        ),
      ),
    db
      .select({ total: count() })
      .from(notificationOutbox)
      .where(
        and(
          eq(notificationOutbox.organizationId, organizationId),
          eq(notificationOutbox.status, "failed"),
          gte(notificationOutbox.createdAt, since),
          notLike(notificationOutbox.idempotencyKey, "financial-test:%"),
        ),
      ),
    db
      .select({
        id: notificationOutbox.id,
        athleteName: athletes.fullName,
        type: notificationOutbox.eventType,
        status: notificationOutbox.status,
        phone: notificationOutbox.phone,
        attemptCount: notificationOutbox.attemptCount,
        lastError: notificationOutbox.lastError,
        origin: notificationOutbox.lastAttemptOrigin,
        manualResendCount: notificationOutbox.manualResendCount,
        sentAt: notificationOutbox.sentAt,
        updatedAt: notificationOutbox.updatedAt,
      })
      .from(notificationOutbox)
      .innerJoin(athletes, eq(athletes.id, notificationOutbox.athleteId))
      .where(
        and(
          eq(notificationOutbox.organizationId, organizationId),
          notLike(notificationOutbox.idempotencyKey, "financial-test:%"),
        ),
      )
      .orderBy(desc(notificationOutbox.updatedAt))
      .limit(10),
    getWhatsAppBridgeStatus(),
  ]);
  return {
    sentLast30Days: sent[0]?.total ?? 0,
    failedLast30Days: failed[0]?.total ?? 0,
    recent: recent.map((item) => ({
      ...item,
      phone: item.phone.replace(/\d(?=\d{4})/g, "•"),
    })),
    whatsapp: {
      connected: whatsapp.status === "connected",
      status: whatsapp.status,
      connectedPhone: whatsapp.connectedPhone,
    },
  };
}

export async function GET(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }
    const organizationId = context.membership.organizationId;
    return Response.json({
      settings: await getBillingNotificationSettings(organizationId),
      overview: await notificationOverview(organizationId),
    });
  } catch (error) {
    console.error("Failed to load billing notification settings", error);
    return Response.json(
      { error: "Não foi possível carregar as notificações de mensalidades." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }
    const payload = (await request.json()) as Partial<
      typeof defaultBillingNotificationSettings
    >;
    const beforeDueDays = Number(payload.beforeDueDays);
    const overdueDays = Number(payload.overdueDays);
    if (
      !Number.isInteger(beforeDueDays) ||
      beforeDueDays < 1 ||
      beforeDueDays > 30 ||
      !Number.isInteger(overdueDays) ||
      overdueDays < 1 ||
      overdueDays > 90
    ) {
      return Response.json(
        { error: "Use de 1 a 30 dias antes e de 1 a 90 dias após o vencimento." },
        { status: 400 },
      );
    }

    const settings = {
      enabled: Boolean(payload.enabled),
      beforeDueEnabled: Boolean(payload.beforeDueEnabled),
      beforeDueDays,
      dueTodayEnabled: Boolean(payload.dueTodayEnabled),
      overdueEnabled: Boolean(payload.overdueEnabled),
      overdueDays,
    };
    const organizationId = context.membership.organizationId;
    const db = getDb();
    await db
      .insert(billingNotificationSettings)
      .values({
        organizationId,
        ...settings,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: billingNotificationSettings.organizationId,
        set: { ...settings, updatedAt: new Date() },
      });
    return Response.json({
      settings,
      overview: await notificationOverview(organizationId),
    });
  } catch (error) {
    console.error("Failed to save billing notification settings", error);
    return Response.json(
      { error: "Não foi possível salvar as notificações de mensalidades." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }
    const organizationId = context.membership.organizationId;
    const result = await runBillingAutomation(organizationId, "verify_now");
    return Response.json({
      result,
      overview: await notificationOverview(organizationId),
    });
  } catch (error) {
    console.error("Failed to run billing notifications", error);
    return Response.json(
      { error: "Não foi possível executar as notificações agora." },
      { status: 500 },
    );
  }
}
