import type {
  BillingNotificationSettings,
  FinancialNotificationType,
} from "../finance/billing-automation";

export const FINANCIAL_TEST_CONFIRMATION = "CONFIRM_FINANCIAL_WHATSAPP_TEST";
export const FINANCIAL_TEST_TYPES = ["before_due", "due_today", "overdue"] as const;

export function normalizeFinancialTestPhone(value: unknown) {
  let phone = String(value ?? "").replace(/\D/g, "");
  if (!phone.startsWith("55") && [10, 11].includes(phone.length)) phone = `55${phone}`;
  return phone;
}

export function readFinancialTestConfiguration(
  environment: Record<string, string | undefined>,
) {
  const whatsappTestEnabled = ["1", "true", "yes", "on"].includes(
    String(environment.WHATSAPP_TEST_MODE ?? "").trim().toLowerCase(),
  );
  const financialTestEnabled = ["1", "true", "yes", "on"].includes(
    String(environment.FINANCIAL_NOTIFICATION_TEST_ENABLED ?? "").trim().toLowerCase(),
  );
  return {
    enabled: whatsappTestEnabled && financialTestEnabled,
    phone: normalizeFinancialTestPhone(environment.WHATSAPP_TEST_PHONE),
  };
}

export function validateFinancialTestRequest(input: {
  type: unknown;
  testPhone: unknown;
  runId: unknown;
  confirmation: unknown;
  configuration: { enabled: boolean; phone: string };
}) {
  const type = String(input.type ?? "") as FinancialNotificationType;
  const testPhone = normalizeFinancialTestPhone(input.testPhone);
  const runId = String(input.runId ?? "").trim();
  const validType = FINANCIAL_TEST_TYPES.includes(type);
  const validRunId = /^[a-zA-Z0-9-]{8,64}$/.test(runId);
  const valid = Boolean(
    input.configuration.enabled &&
      input.configuration.phone &&
      testPhone === input.configuration.phone &&
      validType &&
      validRunId &&
      input.confirmation === FINANCIAL_TEST_CONFIRMATION,
  );
  return { valid, type, testPhone, runId, validType, validRunId };
}

function addUtcDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function referenceDateForFinancialTest(
  type: FinancialNotificationType,
  dueDate: string,
  settings: BillingNotificationSettings,
) {
  if (type === "due_today") return dueDate;
  if (type === "before_due") {
    return addUtcDays(dueDate, -Math.max(1, Math.min(settings.beforeDueDays, 3)));
  }
  return addUtcDays(dueDate, Math.max(1, settings.overdueDays));
}

export function financialTestIdempotencyKey(
  runId: string,
  type: FinancialNotificationType,
) {
  return `financial-test:${runId}:${type}`;
}

export function financialTestIdempotencyKeys(runId: string) {
  return FINANCIAL_TEST_TYPES.map((type) => financialTestIdempotencyKey(runId, type));
}

export function isFinancialTestKey(value: string | null | undefined) {
  return String(value ?? "").startsWith("financial-test:");
}
