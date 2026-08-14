import { getD1 } from "../../../db";
import {
  getWhatsAppBridgeStatus,
  sendWhatsAppMessage,
} from "../check-in/whatsapp-bridge";
import { getRuntimeEnv } from "../runtime-env";

export type NotificationOrigin =
  | "startup"
  | "reconnect"
  | "automatic"
  | "verify_now"
  | "enrollment"
  | "controlled_test"
  | "manual";

export type OutboxInput = {
  organizationId: string;
  athleteId: string;
  paymentId?: string | null;
  teamId?: string | null;
  eventType: "before_due" | "due_today" | "overdue" | "enrollment" | "controlled_test";
  idempotencyKey: string;
  phone: string;
  message: string;
  maxAttempts?: number;
};

export type FinancialTestContext = {
  runId: string;
  type: "before_due" | "due_today" | "overdue";
  referenceDate: string;
  authorizedPhone: string;
};

type ReservedNotification = OutboxInput & {
  id: string;
  attemptCount: number;
  lockToken: string;
};

type Sender = typeof sendWhatsAppMessage;
type StatusReader = typeof getWhatsAppBridgeStatus;

const LOCK_MS = 60_000;
const ABSOLUTE_MAX_BATCH = 100;
const DEFAULT_MAX_PER_RUN = 5;
const DEFAULT_MIN_INTERVAL_MS = 3_000;
const unixNow = () => Math.floor(Date.now() / 1000);
const LOCK_SECONDS = Math.ceil(LOCK_MS / 1000);
const activeBackgroundWorkers = new Map<string, Promise<QueueTotals>>();

type QueueTotals = {
  sent: number;
  failed: number;
  deliveryUnknown: number;
  processed: number;
  disconnected: boolean;
};

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function readFinancialDispatchPolicy(
  runtime = getRuntimeEnv(),
) {
  return {
    maxPerRun: boundedInteger(runtime.WHATSAPP_FINANCIAL_MAX_PER_RUN, DEFAULT_MAX_PER_RUN, 1, ABSOLUTE_MAX_BATCH),
    minIntervalMs: boundedInteger(runtime.WHATSAPP_FINANCIAL_MIN_INTERVAL_MS, DEFAULT_MIN_INTERVAL_MS, 0, 60_000),
  };
}

function normalizePhone(phone: string | null | undefined) {
  let normalized = String(phone || "").replace(/\D/g, "");
  if (!normalized.startsWith("55") && [10, 11].includes(normalized.length)) normalized = `55${normalized}`;
  return normalized;
}

function saoPauloDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function dayDifference(today: string, dueDate: string) {
  return Math.round((Date.parse(`${dueDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}

function testModeAllowedPhone() {
  const runtime = env as unknown as Record<string, string | undefined>;
  const enabled = ["1", "true", "yes", "on"].includes(
    String(runtime.WHATSAPP_TEST_MODE || "").trim().toLowerCase(),
  );
  if (!enabled) return null;
  let phone = String(runtime.WHATSAPP_TEST_PHONE || "").replace(/\D/g, "");
  if (!phone.startsWith("55") && [10, 11].includes(phone.length)) phone = `55${phone}`;
  return phone || "__TEST_MODE_WITHOUT_AUTHORIZED_PHONE__";
}

function financialNotificationTestEnabled() {
  const runtime = env as unknown as Record<string, string | undefined>;
  return ["1", "true", "yes", "on"].includes(
    String(runtime.FINANCIAL_NOTIFICATION_TEST_ENABLED || "").trim().toLowerCase(),
  );
}

export async function enqueueNotification(input: OutboxInput) {
  const now = unixNow();
  const id = crypto.randomUUID();
  const result = await getD1()
    .prepare(
      `INSERT INTO notification_outbox (
        id, organization_id, athlete_id, payment_id, team_id, event_type,
        idempotency_key, phone, message, status, attempt_count, max_attempts,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING
      RETURNING id`,
    )
    .bind(
      id,
      input.organizationId,
      input.athleteId,
      input.paymentId ?? null,
      input.teamId ?? null,
      input.eventType,
      input.idempotencyKey,
      input.phone,
      input.message,
      input.maxAttempts ?? 3,
      now,
      now,
    )
    .first<{ id: string }>();
  return { id: result?.id ?? null, created: Boolean(result) };
}

async function quarantineExpiredLocks(organizationId: string, notificationId?: string) {
  const now = unixNow();
  const targetFilter = notificationId ? "AND id = ?" : "";
  const bindings: unknown[] = [now, organizationId, now];
  if (notificationId) bindings.push(notificationId);
  await getD1()
    .prepare(
      `UPDATE notification_outbox
       SET status = 'delivery_unknown',
           last_error = 'A execução foi interrompida após a reserva; entrega requer análise manual.',
           lock_token = NULL, locked_until = NULL, updated_at = ?
       WHERE organization_id = ? AND status = 'processing'
         AND locked_until IS NOT NULL AND locked_until <= ?
         ${targetFilter}`,
    )
    .bind(...bindings)
    .run();
}

async function reserveNext(
  organizationId: string,
  origin: NotificationOrigin,
  notificationId?: string,
): Promise<ReservedNotification | null> {
  const now = unixNow();
  const lockToken = crypto.randomUUID();
  const targetFilter = notificationId ? "AND id = ?" : "";
  const controlledTestFilter = notificationId
    ? ""
    : "AND event_type != 'controlled_test' AND idempotency_key NOT LIKE 'financial-test:%'";
  const allowedPhone = testModeAllowedPhone();
  const phoneFilter = allowedPhone
    ? `AND (
        replace(replace(replace(replace(replace(replace(phone, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') = ?
        OR '55' || replace(replace(replace(replace(replace(replace(phone, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') = ?
      )`
    : "";
  const bindings: unknown[] = [now, now + LOCK_SECONDS, lockToken, origin, now, organizationId, now];
  if (notificationId) bindings.push(notificationId);
  if (allowedPhone) bindings.push(allowedPhone, allowedPhone);
  bindings.push(now);
  const row = await getD1()
    .prepare(
      `UPDATE notification_outbox
       SET status = 'processing',
           locked_at = ?, locked_until = ?, lock_token = ?,
           last_attempt_origin = ?, last_error = NULL, updated_at = ?
       WHERE id = (
         SELECT id FROM notification_outbox
         WHERE organization_id = ?
           AND (status = 'pending' OR (
             status = 'failed' AND attempt_count < max_attempts
             AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           ))
           ${targetFilter}
           ${controlledTestFilter}
           ${phoneFilter}
         ORDER BY created_at, id LIMIT 1
       )
       AND (status = 'pending' OR status = 'failed')
       AND (locked_until IS NULL OR locked_until <= ?)
       RETURNING id, organization_id AS organizationId, athlete_id AS athleteId,
         payment_id AS paymentId, team_id AS teamId, event_type AS eventType,
         idempotency_key AS idempotencyKey, phone, message,
         attempt_count AS attemptCount, lock_token AS lockToken`,
    )
    .bind(...bindings)
    .first<ReservedNotification>();
  if (!row) return null;
  return row;
}

export async function revalidateFinancialNotification(
  item: ReservedNotification,
  financialTest?: FinancialTestContext,
) {
  if (!["before_due", "due_today", "overdue"].includes(item.eventType)) return null;
  if (item.idempotencyKey.startsWith("financial-test:") && !financialTest) {
    return "Teste financeiro controlado sem contexto autorizado.";
  }
  if (!item.paymentId) return "Mensalidade vinculada não está mais disponível.";
  const current = await getD1().prepare(`SELECT
      p.status, p.amount_cents AS amountCents, p.paid_amount_cents AS paidAmountCents,
      p.due_date AS dueDate, a.active AS athleteActive, a.guardian_phone AS guardianPhone,
      COALESCE(s.enabled, 1) AS enabled,
      COALESCE(s.before_due_enabled, 1) AS beforeDueEnabled,
      COALESCE(s.before_due_days, 3) AS beforeDueDays,
      COALESCE(s.due_today_enabled, 1) AS dueTodayEnabled,
      COALESCE(s.overdue_enabled, 1) AS overdueEnabled,
      COALESCE(s.overdue_days, 5) AS overdueDays
    FROM payments p JOIN athletes a ON a.id = p.athlete_id
    LEFT JOIN billing_notification_settings s ON s.organization_id = p.organization_id
    WHERE p.id = ? AND p.organization_id = ? AND a.id = ?`)
    .bind(item.paymentId, item.organizationId, item.athleteId).first<Record<string, string | number | null>>();
  if (!current) return "Mensalidade ou atleta não encontrado na revalidação.";
  const balance = Number(current.amountCents) - Number(current.paidAmountCents || 0);
  if (["paid", "cancelled"].includes(String(current.status)) || balance <= 0) return "Mensalidade quitada, cancelada ou sem saldo.";
  if (!Number(current.athleteActive)) return "Atleta inativo.";
  const guardianPhone = normalizePhone(String(current.guardianPhone || ""));
  if (!guardianPhone) return "Atleta sem telefone atual valido.";
  const currentPhone = financialTest ? normalizePhone(item.phone) : guardianPhone;
  if (financialTest) {
    const expectedKey = `financial-test:${financialTest.runId}:${financialTest.type}`;
    if (
      item.eventType !== financialTest.type ||
      item.idempotencyKey !== expectedKey ||
      currentPhone !== normalizePhone(financialTest.authorizedPhone)
    ) {
      return "Contexto do teste financeiro controlado nao corresponde a outbox reservada.";
    }
  }
  if (!currentPhone) return "Atleta sem telefone atual válido.";
  if (currentPhone !== normalizePhone(item.phone)) return "Telefone do responsável mudou desde a criação da notificação.";
  if (!Number(current.enabled)) return "Notificações financeiras foram desativadas.";
  const difference = dayDifference(
    financialTest?.referenceDate ?? saoPauloDate(),
    String(current.dueDate),
  );
  const applicable =
    (item.eventType === "before_due" && Number(current.beforeDueEnabled) && difference > 0 && difference <= Number(current.beforeDueDays)) ||
    (item.eventType === "due_today" && Number(current.dueTodayEnabled) && difference === 0) ||
    (item.eventType === "overdue" && Number(current.overdueEnabled) && difference < 0 && Math.abs(difference) >= Number(current.overdueDays));
  return applicable ? null : `O evento ${item.eventType} não é mais aplicável à data atual.`;
}

async function supersede(item: ReservedNotification, reason: string) {
  const now = unixNow();
  await getD1().prepare(`UPDATE notification_outbox
    SET status='superseded', last_error=?, lock_token=NULL, locked_at=NULL,
        locked_until=NULL, next_attempt_at=NULL, updated_at=?
    WHERE id=? AND status='processing' AND lock_token=?`)
    .bind(reason, now, item.id, item.lockToken).run();
}

async function beginAttempt(item: ReservedNotification, origin: NotificationOrigin) {
  const now = unixNow();
  const row = await getD1().prepare(`UPDATE notification_outbox
    SET attempt_count = attempt_count + 1, updated_at=?
    WHERE id=? AND status='processing' AND lock_token=?
    RETURNING attempt_count AS attemptCount`)
    .bind(now, item.id, item.lockToken).first<{ attemptCount: number }>();
  if (!row) return false;
  item.attemptCount = row.attemptCount;
  await getD1().prepare(`INSERT INTO notification_attempts
    (id,notification_id,attempt_number,origin,lock_token,status,started_at)
    VALUES (?,?,?,?,?,'processing',?)`)
    .bind(crypto.randomUUID(), item.id, item.attemptCount, origin, item.lockToken, now).run();
  return true;
}

function retryAt(attemptCount: number) {
  const minutes = Math.min(24 * 60, 5 * 2 ** Math.max(0, attemptCount - 1));
  return unixNow() + minutes * 60;
}

async function finishAttempt(
  item: ReservedNotification,
  result: Awaited<ReturnType<Sender>>,
) {
  const now = unixNow();
  const status = result.status;
  const nextAttemptAt = status === "failed" ? retryAt(item.attemptCount) : null;
  await getD1().batch([
    getD1()
      .prepare(
        `UPDATE notification_outbox
         SET status = ?, last_error = ?, sent_at = ?, provider_message_id = ?,
             next_attempt_at = ?, lock_token = NULL, locked_until = NULL, updated_at = ?
         WHERE id = ? AND status = 'processing' AND lock_token = ?`,
      )
      .bind(
        status,
        result.error,
        status === "sent" ? now : null,
        result.providerMessageId ?? null,
        nextAttemptAt,
        now,
        item.id,
        item.lockToken,
      ),
    getD1()
      .prepare(
        `UPDATE notification_attempts
         SET status = ?, error = ?, provider_message_id = ?, finished_at = ?
         WHERE lock_token = ? AND status = 'processing'`,
      )
      .bind(
        status,
        result.error,
        result.providerMessageId ?? null,
        now,
        item.lockToken,
      ),
  ]);
}

async function runNotificationQueue(
  organizationId: string,
  origin: NotificationOrigin,
  dependencies: {
    sender?: Sender;
    statusReader?: StatusReader;
    notificationId?: string;
    financialTest?: FinancialTestContext;
    maxPerRun?: number;
    minIntervalMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<QueueTotals> {
  if (financialNotificationTestEnabled() && !dependencies.notificationId) {
    return { sent: 0, failed: 0, deliveryUnknown: 0, processed: 0, disconnected: false };
  }
  if (dependencies.financialTest) {
    const configuredPhone = testModeAllowedPhone();
    if (
      origin !== "controlled_test" ||
      !financialNotificationTestEnabled() ||
      !dependencies.notificationId ||
      !configuredPhone ||
      configuredPhone.startsWith("__") ||
      normalizePhone(dependencies.financialTest.authorizedPhone) !== configuredPhone
    ) {
      throw new Error("Teste financeiro bloqueado: TEST_MODE, telefone ou alvo invalido.");
    }
  }
  const sender = dependencies.sender ?? sendWhatsAppMessage;
  const statusReader = dependencies.statusReader ?? getWhatsAppBridgeStatus;
  const policy = readFinancialDispatchPolicy();
  const maxPerRun = dependencies.notificationId
    ? 1
    : Math.min(ABSOLUTE_MAX_BATCH, Math.max(1, dependencies.maxPerRun ?? policy.maxPerRun));
  const minIntervalMs = dependencies.notificationId
    ? 0
    : Math.min(60_000, Math.max(0, dependencies.minIntervalMs ?? policy.minIntervalMs));
  const sleep = dependencies.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const bridge = await statusReader();
  if (bridge.status !== "connected") {
    return { sent: 0, failed: 0, deliveryUnknown: 0, processed: 0, disconnected: true };
  }

  await quarantineExpiredLocks(organizationId, dependencies.notificationId);
  const totals = { sent: 0, failed: 0, deliveryUnknown: 0, processed: 0, disconnected: false };
  let sendAttempts = 0;
  for (let reservations = 0; reservations < ABSOLUTE_MAX_BATCH && sendAttempts < maxPerRun; reservations += 1) {
    const item = await reserveNext(organizationId, origin, dependencies.notificationId);
    if (!item) break;
    const supersededReason = await revalidateFinancialNotification(
      item,
      dependencies.financialTest,
    );
    if (supersededReason) {
      await supersede(item, supersededReason);
      totals.processed += 1;
      if (dependencies.notificationId) break;
      continue;
    }
    if (!(await beginAttempt(item, origin))) break;
    const delivery = await sender(item.phone, item.message);
    sendAttempts += 1;
    const result =
      delivery.status === "pending"
        ? {
            status: "failed" as const,
            error: delivery.error || "WhatsApp desconectado antes do envio.",
            providerMessageId: null,
          }
        : delivery;
    await finishAttempt(item, result);
    totals.processed += 1;
    if (result.status === "sent") totals.sent += 1;
    else if (result.status === "delivery_unknown") totals.deliveryUnknown += 1;
    else totals.failed += 1;
    if (dependencies.notificationId) break;
    if (sendAttempts < maxPerRun && minIntervalMs > 0) {
      // finishAttempt already released the SQLite lock before this wait.
      await sleep(minIntervalMs);
    }
  }
  return totals;
}

export async function processNotificationQueue(
  organizationId: string,
  origin: NotificationOrigin,
  dependencies: {
    sender?: Sender;
    statusReader?: StatusReader;
    notificationId?: string;
    financialTest?: FinancialTestContext;
    maxPerRun?: number;
    minIntervalMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
) {
  if (dependencies.notificationId) {
    return runNotificationQueue(organizationId, origin, dependencies);
  }
  const active = activeBackgroundWorkers.get(organizationId);
  if (active) return active;
  const operation: Promise<QueueTotals> = runNotificationQueue(organizationId, origin, dependencies).finally(() => {
    if (activeBackgroundWorkers.get(organizationId) === operation) {
      activeBackgroundWorkers.delete(organizationId);
    }
  });
  activeBackgroundWorkers.set(organizationId, operation);
  return operation;
}

export async function createManualResend(
  organizationId: string,
  originalId: string,
) {
  const original = await getD1()
    .prepare(
      `SELECT id, athlete_id AS athleteId, payment_id AS paymentId, team_id AS teamId,
        event_type AS eventType, idempotency_key AS idempotencyKey, phone, message
       FROM notification_outbox WHERE id = ? AND organization_id = ?`,
    )
    .bind(originalId, organizationId)
    .first<ReservedNotification>();
  if (original?.idempotencyKey.startsWith("financial-test:")) {
    throw new Error("Testes financeiros controlados nao admitem reenvio manual.");
  }
  if (!original) throw new Error("Notificação original não encontrada.");

  const now = unixNow();
  const id = crypto.randomUUID();
  await getD1().batch([
    getD1()
      .prepare(
        `INSERT INTO notification_outbox (
          id, organization_id, athlete_id, payment_id, team_id,
          original_notification_id, event_type, idempotency_key, phone, message,
          status, attempt_count, max_attempts, last_attempt_origin, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 1, 'manual', ?, ?)`,
      )
      .bind(
        id,
        organizationId,
        original.athleteId,
        original.paymentId ?? null,
        original.teamId ?? null,
        original.id,
        original.eventType,
        `manual:${original.id}:${id}`,
        original.phone,
        original.message,
        now,
        now,
      ),
    getD1()
      .prepare(
        `UPDATE notification_outbox
         SET manual_resend_count = manual_resend_count + 1, updated_at = ?
         WHERE id = ? AND organization_id = ?`,
      )
      .bind(now, original.id, organizationId),
  ]);
  return { id };
}
