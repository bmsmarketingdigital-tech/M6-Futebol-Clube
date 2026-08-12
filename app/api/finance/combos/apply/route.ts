import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import {
  athleteComboCoverage,
  athletes,
  billingCombos,
  payments,
} from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";

function addMonths(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 10);
}

function split(total: number, count: number) {
  const base = Math.floor(total / count);
  const rest = total - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < rest ? 1 : 0));
}

export async function POST(request: Request) {
  const context = await getApiContext(request);
  if (!context) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = (await request.json()) as {
    athleteId?: string;
    comboId?: string;
    startDate?: string;
    firstDueDate?: string;
  };
  const organizationId = context.membership.organizationId;
  const db = getDb();
  const [athlete] = await db
    .select({ id: athletes.id, active: athletes.active })
    .from(athletes)
    .where(
      and(
        eq(athletes.id, body.athleteId ?? ""),
        eq(athletes.organizationId, organizationId),
      ),
    )
    .limit(1);
  const [combo] = await db
    .select()
    .from(billingCombos)
    .where(
      and(
        eq(billingCombos.id, body.comboId ?? ""),
        eq(billingCombos.organizationId, organizationId),
        eq(billingCombos.active, true),
      ),
    )
    .limit(1);

  if (!athlete || !athlete.active) {
    return Response.json({ error: "Atleta inválido ou inativo." }, { status: 409 });
  }
  if (!combo) {
    return Response.json({ error: "Combo inválido ou inativo." }, { status: 409 });
  }

  const startDate = body.startDate ?? "";
  const firstDueDate = body.firstDueDate ?? startDate;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate)
  ) {
    return Response.json({ error: "Datas inválidas." }, { status: 400 });
  }

  const count = combo.billingMode === "upfront" ? 1 : combo.installmentCount;
  const amounts = split(combo.finalAmountCents, count);
  const months = Array.from({ length: combo.durationMonths }, (_, index) =>
    addMonths(startDate, index).slice(0, 7),
  );
  const existing = await db
    .select({ id: payments.id, referenceMonth: payments.referenceMonth })
    .from(payments)
    .where(
      and(
        eq(payments.organizationId, organizationId),
        eq(payments.athleteId, athlete.id),
      ),
    );
  if (existing.some((payment) => months.includes(payment.referenceMonth))) {
    return Response.json(
      { error: "Já existe cobrança para uma competência coberta pelo combo." },
      { status: 409 },
    );
  }

  const existingCoverage = await db
    .select({ referenceMonth: athleteComboCoverage.referenceMonth })
    .from(athleteComboCoverage)
    .where(
      and(
        eq(athleteComboCoverage.organizationId, organizationId),
        eq(athleteComboCoverage.athleteId, athlete.id),
        eq(athleteComboCoverage.active, true),
      ),
    );
  const conflictingMonths = existingCoverage
    .map((coverage) => coverage.referenceMonth)
    .filter((month) => months.includes(month));
  if (conflictingMonths.length > 0) {
    return Response.json(
      {
        error: "O atleta já possui um combo ativo em uma ou mais competências selecionadas.",
        conflictingMonths,
      },
      { status: 409 },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const athleteComboId = crypto.randomUUID();
  const d1 = getD1();
  const statements = [
    d1
      .prepare(
        "INSERT INTO athlete_combos (id,organization_id,athlete_id,combo_id,combo_name_snapshot,duration_months,base_amount_cents,discount_type,discount_value,final_amount_cents,installment_count,start_date,end_date,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        athleteComboId,
        organizationId,
        athlete.id,
        combo.id,
        combo.name,
        combo.durationMonths,
        combo.baseAmountCents,
        combo.discountType,
        combo.discountValue,
        combo.finalAmountCents,
        count,
        startDate,
        addMonths(startDate, combo.durationMonths),
        "active",
        now,
        now,
      ),
  ];
  for (const month of months) {
    statements.push(
      d1
        .prepare(
          "INSERT INTO athlete_combo_coverage (id,organization_id,athlete_id,athlete_combo_id,reference_month,active,created_at,released_at) VALUES (?,?,?,?,?,1,?,NULL)",
        )
        .bind(
          crypto.randomUUID(),
          organizationId,
          athlete.id,
          athleteComboId,
          month,
          now,
        ),
    );
  }
  for (let index = 0; index < count; index += 1) {
    const paymentId = crypto.randomUUID();
    const referenceMonth = months[index] ?? months[months.length - 1];
    const dueDate = index === 0 ? firstDueDate : addMonths(firstDueDate, index);
    statements.push(
      d1
        .prepare(
          "INSERT INTO payments (id,organization_id,athlete_id,athlete_combo_id,combo_installment_number,combo_installment_total,reference_month,amount_cents,due_date,plan_name,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?, 'open', ?,?)",
        )
        .bind(
          paymentId,
          organizationId,
          athlete.id,
          athleteComboId,
          index + 1,
          count,
          referenceMonth,
          amounts[index],
          dueDate,
          combo.name,
          now,
          now,
        ),
    );
    statements.push(
      d1
        .prepare(
          "INSERT INTO athlete_combo_installments (id,organization_id,athlete_combo_id,installment_number,installment_total,reference_month,due_date,amount_cents,payment_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          organizationId,
          athleteComboId,
          index + 1,
          count,
          referenceMonth,
          dueDate,
          amounts[index],
          paymentId,
          now,
        ),
    );
  }

  try {
    await d1.batch(statements);
  } catch (error) {
    if (
      error instanceof Error &&
      /unique|athlete_combo_coverage_active_unique/i.test(error.message)
    ) {
      return Response.json(
        { error: "O atleta já possui um combo ativo em uma ou mais competências selecionadas." },
        { status: 409 },
      );
    }
    throw error;
  }

  return Response.json(
    { athleteComboId, installmentCount: count, amounts, coveredMonths: months },
    { status: 201 },
  );
}
