export type FinancialNotificationType = "before_due" | "due_today" | "overdue";

export type BillingNotificationSettings = {
  enabled: boolean;
  beforeDueEnabled: boolean;
  beforeDueDays: number;
  dueTodayEnabled: boolean;
  overdueEnabled: boolean;
  overdueDays: number;
};

function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000,
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
