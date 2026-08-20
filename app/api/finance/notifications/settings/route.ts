import { and, count, desc, eq, gte, notLike } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../../db/postgres";
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
  const sinceEpoch = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);

  if (postgresConfigured()) {
    const sql = getPostgresClient();
    const [[sentRow], [failedRow], recentRows, whatsapp] = await Promise.all([
      sql<{ total: number }[]>`
        SELECT COUNT(*)::int AS total FROM notification_outbox
        WHERE organization_id = ${organizationId} AND status = 'sent'
          AND created_at >= ${sinceEpoch}
          AND idempotency_key NOT LIKE 'financial-test:%'
      `,
      sql<{ total: number }[]>`
        SELECT COUNT(*)::int AS total FROM notification_outbox
        WHERE organization_id = ${organizationId} AND status = 'failed'
          AND created_at >= ${sinceEpoch}
          AND idempotency_key NOT LIKE 'financial-test:%'
      `,
      sql<{
        id: string;
        athlete_name: string;
        type: string;
        status: string;
        phone: string;
        attempt_count: number;
        last_error: string | null;
        origin: string | null;
        manual_resend_count: number;
        sent_at: number | null;
        updated_at: number;
      }[]>`
        SELECT n.id, a.full_name AS athlete_name, n.event_type AS type,
               n.status, n.phone, n.attempt_count, n.last_error,
               n.last_attempt_origin AS origin, n.manual_resend_count,
               n.sent_at, n.updated_at
        FROM notification_outbox n
        INNER JOIN athletes a ON a.id = n.athlete_id
        WHERE n.organization_id = ${organizationId}
          AND n.idempotency_key NOT LIKE 'financial-test:%'
        ORDER BY n.updated_at DESC
        LIMIT 10
      `,
      getWhatsAppBridgeStatus(),
    ]);
    return {
      sentLast30Days: sentRow?.total ?? 0,
      failedLast30Days: failedRow?.total ?? 0,
      recent: recentRows.map((item) => ({
        id: item.id,
        athleteName: item.athlete_name,
        type: item.type,
        status: item.status,
        phone: item.phone.replace(/\d(?=\d{4})/g, "•"),
        attemptCount: item.attempt_count,
        lastError: item.last_error,
        origin: item.origin,
        manualResendCount: item.manual_resend_count,
        sentAt: item.sent_at,
        updatedAt: item.updated_at,
      })),
      whatsapp: {
        connected: whatsapp.status === "connected",
        status: whatsapp.status,
        connectedPhone: whatsapp.connectedPhone,
      },
    };
  }

  const db = getDb();
  const since = new Date(sinceEpoch * 1000);
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
    const now = Math.floor(Date.now() / 1000);
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      await sql`
        INSERT INTO billing_notification_settings
          (organization_id, enabled, before_due_enabled, before_due_days,
           due_today_enabled, overdue_enabled, overdue_days, updated_at)
        VALUES (
          ${organizationId}, ${settings.enabled}, ${settings.beforeDueEnabled},
          ${settings.beforeDueDays}, ${settings.dueTodayEnabled},
          ${settings.overdueEnabled}, ${settings.overdueDays}, ${now}
        )
        ON CONFLICT (organization_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          before_due_enabled = EXCLUDED.before_due_enabled,
          before_due_days = EXCLUDED.before_due_days,
          due_today_enabled = EXCLUDED.due_today_enabled,
          overdue_enabled = EXCLUDED.overdue_enabled,
          overdue_days = EXCLUDED.overdue_days,
          updated_at = EXCLUDED.updated_at
      `;
    } else {
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
    }
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
