import { and, eq, inArray, lt } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import {
  athleteBilling,
  athletes,
  billingNotificationSettings,
  billingPlans,
  organizations,
  payments,
} from "../../../db/schema";
import {
  enqueueNotification,
  NotificationOrigin,
  processNotificationQueue,
} from "../notifications/outbox";
import {
  calculateCharge,
  dueDateForMonth,
  validateMonth,
} from "./finance-utils";

export type BillingNotificationSettings = {
  enabled: boolean;
  beforeDueEnabled: boolean;
  beforeDueDays: number;
  dueTodayEnabled: boolean;
  overdueEnabled: boolean;
  overdueDays: number;
};

export const defaultBillingNotificationSettings: BillingNotificationSettings = {
  enabled: true,
  beforeDueEnabled: true,
  beforeDueDays: 3,
  dueTodayEnabled: true,
  overdueEnabled: true,
  overdueDays: 5,
};

export function saoPauloDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000,
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

export async function getBillingNotificationSettings(
  organizationId: string,
): Promise<BillingNotificationSettings> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(billingNotificationSettings)
    .where(eq(billingNotificationSettings.organizationId, organizationId))
    .limit(1);
  if (!row) return defaultBillingNotificationSettings;
  return {
    enabled: row.enabled,
    beforeDueEnabled: row.beforeDueEnabled,
    beforeDueDays: row.beforeDueDays,
    dueTodayEnabled: row.dueTodayEnabled,
    overdueEnabled: row.overdueEnabled,
    overdueDays: row.overdueDays,
  };
}

export async function generateMonthlyCharges(
  organizationId: string,
  requestedMonth: string,
) {
  const month = validateMonth(requestedMonth);
  if (!month) throw new Error("Mês de referência inválido.");

  const db = getDb();
  const configurations = await db
    .select({
      athleteId: athleteBilling.athleteId,
      amountCents: billingPlans.amountCents,
      planName: billingPlans.name,
      planDueDay: billingPlans.dueDay,
      customDueDay: athleteBilling.customDueDay,
      discountType: athleteBilling.discountType,
      discountValue: athleteBilling.discountValue,
    })
    .from(athleteBilling)
    .innerJoin(
      athletes,
      and(
        eq(athletes.id, athleteBilling.athleteId),
        eq(athletes.organizationId, athleteBilling.organizationId),
      ),
    )
    .innerJoin(
      billingPlans,
      and(
        eq(billingPlans.id, athleteBilling.planId),
        eq(billingPlans.organizationId, athleteBilling.organizationId),
      ),
    )
    .where(
      and(
        eq(athleteBilling.organizationId, organizationId),
        eq(athleteBilling.active, true),
        eq(athletes.active, true),
        eq(billingPlans.active, true),
      ),
    );

  let createdCount = 0;
  const now = new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const d1 = getD1();
  for (const configuration of configurations) {
    const paymentId = crypto.randomUUID();
    const reservationId = crypto.randomUUID();
    try {
      await d1.batch([
        d1
          .prepare(
            "INSERT INTO athlete_billing_month_reservations (id,organization_id,athlete_id,reference_month,source_type,source_id,created_at) VALUES (?,?,?,?, 'monthly', ?,?)",
          )
          .bind(
            reservationId,
            organizationId,
            configuration.athleteId,
            month,
            paymentId,
            nowSeconds,
          ),
        d1
          .prepare(
            "INSERT INTO payments (id,organization_id,athlete_id,reference_month,amount_cents,due_date,plan_name,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'open',?,?)",
          )
          .bind(
            paymentId,
            organizationId,
            configuration.athleteId,
            month,
            calculateCharge(
              configuration.amountCents,
              configuration.discountType,
              configuration.discountValue,
            ),
            dueDateForMonth(
              month,
              configuration.customDueDay ?? configuration.planDueDay,
            ),
            configuration.planName,
            nowSeconds,
            nowSeconds,
          ),
        d1
          .prepare(
            "UPDATE athletes SET financial_status='pending',updated_at=? WHERE id=? AND organization_id=?",
          )
          .bind(nowSeconds, configuration.athleteId, organizationId),
      ]);
      createdCount += 1;
    } catch (error) {
      if (
        error instanceof Error &&
        /athlete_billing_month_reservation_unique|payments_athlete_month_unique|UNIQUE constraint failed: athlete_billing_month_reservations|UNIQUE constraint failed: payments\.athlete_id, payments\.reference_month/i.test(
          error.message,
        )
      ) {
        continue;
      }
      throw error;
    }
  }

  return {
    createdCount,
    skippedCount: configurations.length - createdCount,
    configuredCount: configurations.length,
  };
}

export type FinancialNotificationType = "before_due" | "due_today" | "overdue";

export function buildBillingNotification(
  input: {
    athleteName: string;
    amountCents: number;
    paidAmountCents: number | null;
    dueDate: string;
  },
  today: string,
  settings: BillingNotificationSettings,
): { type: FinancialNotificationType; message: string } | null {
  const difference = daysBetween(today, input.dueDate);
  const outstandingCents = Math.max(
    0,
    input.amountCents - (input.paidAmountCents ?? 0),
  );
  const value = formatMoney(outstandingCents);
  const dueDate = formatDate(input.dueDate);

  if (difference < 0 && settings.overdueEnabled) {
    const overdueDays = Math.abs(difference);
    if (overdueDays >= settings.overdueDays) {
      return {
        type: "overdue",
        message:
          `Olá! A mensalidade de ${input.athleteName}, no valor de ${value}, ` +
          `vencida em ${dueDate}, consta em aberto há ${overdueDays} dia(s). ` +
          "Se o pagamento já foi realizado, por favor desconsidere esta mensagem.",
      };
    }
  }
  if (difference === 0 && settings.dueTodayEnabled) {
    return {
      type: "due_today",
      message:
        `Olá! A mensalidade de ${input.athleteName}, no valor de ${value}, ` +
        `vence hoje (${dueDate}). Se o pagamento já foi realizado, por favor desconsidere esta mensagem.`,
    };
  }
  if (
    difference > 0 &&
    difference <= settings.beforeDueDays &&
    settings.beforeDueEnabled
  ) {
    return {
      type: "before_due",
      message:
        `Olá! A mensalidade de ${input.athleteName}, no valor de ${value}, ` +
        `vence em ${difference} dia(s), no dia ${dueDate}. ` +
        "Se o pagamento já foi realizado, por favor desconsidere esta mensagem.",
    };
  }
  return null;
}

export async function runBillingAutomation(
  organizationId: string,
  origin: NotificationOrigin = "automatic",
) {
  const db = getDb();
  const today = saoPauloDate();
  const month = today.slice(0, 7);
  const generated = await generateMonthlyCharges(organizationId, month);

  await db
    .update(payments)
    .set({ status: "overdue", updatedAt: new Date() })
    .where(
      and(
        eq(payments.organizationId, organizationId),
        eq(payments.status, "open"),
        lt(payments.dueDate, today),
      ),
    );

  const settings = await getBillingNotificationSettings(organizationId);
  if (!settings.enabled) {
    const processed = await processNotificationQueue(organizationId, origin);
    return {
      ...generated,
      notificationsQueued: 0,
      notificationsSent: processed.sent,
      notificationsFailed: processed.failed,
      notificationsDeliveryUnknown: processed.deliveryUnknown,
      whatsappDisconnected: processed.disconnected,
    };
  }

  const [organization] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const charges = await db
    .select({
      paymentId: payments.id,
      athleteId: payments.athleteId,
      athleteName: athletes.fullName,
      guardianPhone: athletes.guardianPhone,
      amountCents: payments.amountCents,
      paidAmountCents: payments.paidAmountCents,
      dueDate: payments.dueDate,
    })
    .from(payments)
    .innerJoin(
      athletes,
      and(
        eq(athletes.id, payments.athleteId),
        eq(athletes.organizationId, payments.organizationId),
      ),
    )
    .where(
      and(
        eq(payments.organizationId, organizationId),
        inArray(payments.status, ["open", "overdue", "partial"]),
        eq(athletes.active, true),
      ),
    );

  let notificationsQueued = 0;
  for (const charge of charges) {
    if (!charge.guardianPhone) continue;
    const notification = buildBillingNotification(charge, today, settings);
    if (!notification) continue;

    const message = `${notification.message}\n\n${organization?.name ?? "Escolinha de Futebol"}`;
    const queued = await enqueueNotification({
      organizationId,
      athleteId: charge.athleteId,
      paymentId: charge.paymentId,
      eventType: notification.type,
      idempotencyKey: `billing:${charge.paymentId}:${notification.type}`,
      phone: charge.guardianPhone,
      message,
    });
    if (queued.created) notificationsQueued += 1;
  }

  const processed = await processNotificationQueue(organizationId, origin);

  return {
    ...generated,
    notificationsQueued,
    notificationsSent: processed.sent,
    notificationsFailed: processed.failed,
    notificationsDeliveryUnknown: processed.deliveryUnknown,
    whatsappDisconnected: processed.disconnected,
  };
}
