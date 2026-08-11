import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  athleteBilling,
  athletes,
  billingPlans,
  expenses,
  payments,
} from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import { dueDateForMonth } from "../finance-utils";
import { recordPaymentTransaction } from "../payment-transactions";

export const dynamic = "force-dynamic";

const PHONE = "18981518787";
const MONTHLY_AMOUNT_CENTS = 14950;

function monthOffset(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function POST(request: Request) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });

  const db = getDb();
  const organizationId = context.membership.organizationId;
  const now = new Date();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const previousMonth = monthOffset(currentMonth, -1);

  let athlete = await db.query.athletes.findFirst({
    where: and(eq(athletes.organizationId, organizationId), eq(athletes.guardianPhone, PHONE)),
  });
  if (!athlete) {
    const id = crypto.randomUUID();
    [athlete] = await db.insert(athletes).values({
      id,
      organizationId,
      fullName: "Atleta teste WhatsApp",
      birthYear: now.getFullYear() - 12,
      category: "Sub-13",
      guardianName: "Responsável teste",
      guardianPhone: PHONE,
      createdBy: context.user.email,
      financialStatus: "pending",
      imageAuthorized: false,
      attendanceRate: 100,
      createdAt: now,
      updatedAt: now,
    }).returning();
  }

  let plan = await db.query.billingPlans.findFirst({
    where: and(eq(billingPlans.organizationId, organizationId), eq(billingPlans.name, "Mensalidade teste WhatsApp")),
  });
  if (!plan) {
    [plan] = await db.insert(billingPlans).values({
      id: crypto.randomUUID(), organizationId, name: "Mensalidade teste WhatsApp",
      amountCents: MONTHLY_AMOUNT_CENTS, dueDay: 10, category: "Sub-13", active: true,
      createdAt: now, updatedAt: now,
    }).returning();
  }
  const billing = await db.query.athleteBilling.findFirst({
    where: eq(athleteBilling.athleteId, athlete.id),
  });
  if (!billing) await db.insert(athleteBilling).values({
    id: crypto.randomUUID(), organizationId, athleteId: athlete.id, planId: plan.id,
    discountType: "none", discountValue: 0, active: true, createdAt: now, updatedAt: now,
  });

  const paymentSpecs = [
    { referenceMonth: previousMonth, status: "paid" as const, paidAt: now, paidAmountCents: MONTHLY_AMOUNT_CENTS },
    { referenceMonth: currentMonth, status: "open" as const, paidAt: null, paidAmountCents: null },
  ];
  for (const spec of paymentSpecs) {
    const existing = await db.query.payments.findFirst({
      where: and(eq(payments.athleteId, athlete.id), eq(payments.referenceMonth, spec.referenceMonth)),
    });
    if (!existing) {
      const paymentId = crypto.randomUUID();
      await db.insert(payments).values({
      id: paymentId, organizationId, athleteId: athlete.id,
      referenceMonth: spec.referenceMonth, amountCents: MONTHLY_AMOUNT_CENTS,
      dueDate: dueDateForMonth(spec.referenceMonth, 10), paidAt: null,
      paidAmountCents: null, paymentMethod: null,
      planName: plan.name, notes: "Cenário de teste financeiro", status: "open",
      createdAt: now, updatedAt: now,
      });
      if (spec.status === "paid") {
        await recordPaymentTransaction({
          paymentId, type: "payment", amountCents: MONTHLY_AMOUNT_CENTS,
          paymentMethod: "pix", origin: "system", createdBy: context.user.email,
          idempotencyKey: `system:demo-seed:${paymentId}`,
          note: "Pagamento criado pelo cenário de teste financeiro.",
        });
      }
    }
  }
  await db.update(athletes).set({ financialStatus: "pending", updatedAt: now }).where(eq(athletes.id, athlete.id));

  const expenseRows = [
    { description: "Aluguel do campo (teste)", category: "Aluguel", amountCents: 38000, dueDate: dueDateForMonth(currentMonth, 5), status: "paid" as const, paidAt: now },
    { description: "Materiais esportivos (teste)", category: "Materiais", amountCents: 12490, dueDate: dueDateForMonth(currentMonth, 18), status: "open" as const, paidAt: null },
  ];
  for (const expense of expenseRows) {
    const existing = await db.query.expenses.findFirst({
      where: and(eq(expenses.organizationId, organizationId), eq(expenses.description, expense.description), eq(expenses.referenceMonth, currentMonth)),
    });
    if (!existing) await db.insert(expenses).values({
      id: crypto.randomUUID(), organizationId, referenceMonth: currentMonth,
      ...expense, supplier: "Cenário de teste", paymentMethod: expense.status === "paid" ? "pix" : null,
      notes: "Registro criado para validação do fluxo financeiro", installmentGroupId: null,
      installmentNumber: 1, installmentCount: 1, createdBy: context.user.email, createdAt: now, updatedAt: now,
    });
  }

  const installmentGroupId = `demo-${organizationId}-${currentMonth}`;
  for (let index = 0; index < 3; index += 1) {
    const dueMonth = monthOffset(currentMonth, index);
    const description = "Uniformes da turma (parcelado - teste)";
    const existing = await db.query.expenses.findFirst({
      where: and(eq(expenses.organizationId, organizationId), eq(expenses.description, description), eq(expenses.referenceMonth, dueMonth)),
    });
    if (!existing) await db.insert(expenses).values({
      id: crypto.randomUUID(), organizationId, referenceMonth: dueMonth, description,
      category: "Materiais", supplier: "Fornecedor fictício", amountCents: 20000,
      dueDate: dueDateForMonth(dueMonth, 12), paidAt: index === 0 ? now : null,
      paymentMethod: index === 0 ? "pix" : null, status: index === 0 ? "paid" : "open",
      notes: "Parcela de teste", installmentGroupId, installmentNumber: index + 1,
      installmentCount: 3, createdBy: context.user.email, createdAt: now, updatedAt: now,
    });
  }

  return Response.json({ ok: true, phone: PHONE, athleteId: athlete.id, referenceMonth: currentMonth, message: "Cenário financeiro criado ou já existente." });
}
