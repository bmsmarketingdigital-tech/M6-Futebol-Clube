export function validateMonth(value: string | null | undefined) {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}

export function dueDateForMonth(month: string, requestedDay: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const day = Math.min(Math.max(1, requestedDay), lastDay);
  return `${month}-${String(day).padStart(2, "0")}`;
}

export function calculateCharge(
  amountCents: number,
  discountType: "none" | "fixed" | "percent",
  discountValue: number,
) {
  const discount =
    discountType === "fixed"
      ? discountValue
      : discountType === "percent"
        ? Math.round((amountCents * discountValue) / 100)
        : 0;
  return Math.max(0, amountCents - discount);
}

export function parsePlanPayload(payload: {
  name?: string;
  amount?: number;
  dueDay?: number;
  category?: string | null;
}) {
  const name = payload.name?.trim() ?? "";
  const amountCents = Math.round(Number(payload.amount) * 100);
  const dueDay = Number(payload.dueDay);
  const category = payload.category?.trim() || null;

  if (name.length < 2 || name.length > 80) {
    return { error: "Informe um nome válido para o plano." } as const;
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { error: "Informe um valor mensal maior que zero." } as const;
  }
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
    return { error: "O vencimento deve estar entre os dias 1 e 28." } as const;
  }
  if (category && category.length > 40) {
    return { error: "Nome de categoria inválido." } as const;
  }
  return { value: { name, amountCents, dueDay, category } } as const;
}
