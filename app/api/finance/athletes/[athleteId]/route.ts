import { and, eq, ne } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../../db/postgres";
import { athleteBilling, athleteComboCoverage, athletes, billingPlans, payments } from "../../../../../db/schema";
import { planCategoryCompatible } from "../../../../athlete-financial-plan";
import { getApiContext } from "../../../api-auth";
import { currentReferenceMonth, parseMoneyToCents } from "../../finance-utils";

export const dynamic = "force-dynamic";

type AthleteBillingRow = {
  id: string;
  planId: string;
  planName: string;
  amountCents: number;
  dueDay: number;
  planCategory: string | null;
  planActive: boolean;
  discountType: "none" | "fixed" | "percent";
  discountValue: number;
  customDueDay: number | null;
  active: boolean;
};

type PaymentRow = {
  id: string;
  referenceMonth: string;
  amountCents: number;
  dueDate: string;
  status: string;
  paidAt: Date | null;
  paidAmountCents: number | null;
};

type SavedBillingRow = typeof athleteBilling.$inferSelect | {
  id: string;
  organization_id: string;
  athlete_id: string;
  plan_id: string;
  discount_type: "none" | "fixed" | "percent";
  discount_value: number;
  custom_due_day: number | null;
  provider_customer_id: string | null;
  active: number | boolean;
  created_at: number;
  updated_at: number;
};

function savedBillingToDto(row: SavedBillingRow) {
  if ("organizationId" in row) return row;
  return {
    id: row.id,
    organizationId: row.organization_id,
    athleteId: row.athlete_id,
    planId: row.plan_id,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    customDueDay: row.custom_due_day,
    providerCustomerId: row.provider_customer_id,
    active: Boolean(row.active),
    createdAt: new Date(row.created_at * 1000),
    updatedAt: new Date(row.updated_at * 1000),
  };
}

// Leitura da configuração financeira atual de um único atleta — usada pelo
// bloco "Configuração financeira" no cadastro/edição do atleta. Somente
// leitura: não cria/altera athlete_billing, payments, nem athlete_combo_coverage.
//
// Além do vínculo com o plano, também informa se já existe mensalidade
// (payment) ou cobertura de Combo para a competência ATUAL — necessário para
// o bloco distinguir "plano configurado" de "mensalidade já gerada" em vez de
// tratar as duas coisas como sinônimos.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ athleteId: string }> },
) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }
    const { athleteId } = await params;
    const organizationId = context.membership.organizationId;
    const currentMonth = currentReferenceMonth();
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const [[billingRow], [paymentRow], [coverageRow]] = await Promise.all([
        sql<AthleteBillingRow[]>`
          SELECT ab.id,
                 ab.plan_id AS "planId",
                 bp.name AS "planName",
                 bp.amount_cents AS "amountCents",
                 bp.due_day AS "dueDay",
                 bp.category AS "planCategory",
                 (bp.active = 1) AS "planActive",
                 ab.discount_type AS "discountType",
                 ab.discount_value AS "discountValue",
                 ab.custom_due_day AS "customDueDay",
                 (ab.active = 1) AS active
          FROM athlete_billing ab
          INNER JOIN billing_plans bp ON bp.id = ab.plan_id
          WHERE ab.athlete_id = ${athleteId}
            AND ab.organization_id = ${organizationId}
          LIMIT 1
        `,
        sql<{
          id: string;
          reference_month: string;
          amount_cents: number;
          due_date: string;
          status: string;
          paid_at: number | null;
          paid_amount_cents: number | null;
        }[]>`
          SELECT id, reference_month, amount_cents, due_date, status,
                 paid_at, paid_amount_cents
          FROM payments
          WHERE athlete_id = ${athleteId}
            AND organization_id = ${organizationId}
            AND reference_month = ${currentMonth}
            AND status <> 'cancelled'
          LIMIT 1
        `,
        sql<{ id: string }[]>`
          SELECT id
          FROM athlete_combo_coverage
          WHERE athlete_id = ${athleteId}
            AND organization_id = ${organizationId}
            AND reference_month = ${currentMonth}
            AND active = 1
          LIMIT 1
        `,
      ]);

      const payment: PaymentRow | null = paymentRow
        ? {
            id: paymentRow.id,
            referenceMonth: paymentRow.reference_month,
            amountCents: paymentRow.amount_cents,
            dueDate: paymentRow.due_date,
            status: paymentRow.status,
            paidAt: paymentRow.paid_at ? new Date(paymentRow.paid_at * 1000) : null,
            paidAmountCents: paymentRow.paid_amount_cents,
          }
        : null;

      return Response.json({
        billing: billingRow ?? null,
        currentMonth,
        payment,
        comboCovered: Boolean(coverageRow),
      });
    }

    const db = getDb();
    const [[billingRow], [paymentRow], [coverageRow]] = await Promise.all([
      db
        .select({
          id: athleteBilling.id,
          planId: athleteBilling.planId,
          planName: billingPlans.name,
          amountCents: billingPlans.amountCents,
          dueDay: billingPlans.dueDay,
          planCategory: billingPlans.category,
          planActive: billingPlans.active,
          discountType: athleteBilling.discountType,
          discountValue: athleteBilling.discountValue,
          customDueDay: athleteBilling.customDueDay,
          active: athleteBilling.active,
        })
        .from(athleteBilling)
        .innerJoin(billingPlans, eq(billingPlans.id, athleteBilling.planId))
        .where(
          and(
            eq(athleteBilling.athleteId, athleteId),
            eq(athleteBilling.organizationId, organizationId),
          ),
        )
        .limit(1),
      // Mensalidade da competência atual, ignorando cancelamentos — um
      // payment cancelado não conta como "mensalidade gerada".
      db
        .select({
          id: payments.id,
          referenceMonth: payments.referenceMonth,
          amountCents: payments.amountCents,
          dueDate: payments.dueDate,
          status: payments.status,
          paidAt: payments.paidAt,
          paidAmountCents: payments.paidAmountCents,
        })
        .from(payments)
        .where(
          and(
            eq(payments.athleteId, athleteId),
            eq(payments.organizationId, organizationId),
            eq(payments.referenceMonth, currentMonth),
            ne(payments.status, "cancelled"),
          ),
        )
        .limit(1),
      db
        .select({ id: athleteComboCoverage.id })
        .from(athleteComboCoverage)
        .where(
          and(
            eq(athleteComboCoverage.athleteId, athleteId),
            eq(athleteComboCoverage.organizationId, organizationId),
            eq(athleteComboCoverage.referenceMonth, currentMonth),
            eq(athleteComboCoverage.active, true),
          ),
        )
        .limit(1),
    ]);
    return Response.json({
      billing: billingRow ?? null,
      currentMonth,
      payment: paymentRow ?? null,
      comboCovered: Boolean(coverageRow),
    });
  } catch (error) {
    console.error("Failed to load athlete billing", error);
    return Response.json(
      { error: "Não foi possível carregar a configuração financeira." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ athleteId: string }> },
) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }
    const { athleteId } = await params;
    const payload = (await request.json()) as {
      planId?: string;
      discountType?: "none" | "fixed" | "percent";
      discountValue?: unknown;
      customDueDay?: number | null;
      active?: boolean;
    };
    const discountType = payload.discountType ?? "none";
    const discountValue = discountType === "fixed"
      ? parseMoneyToCents(payload.discountValue ?? 0)
      : Number(payload.discountValue ?? 0);
    const customDueDay =
      payload.customDueDay == null || payload.customDueDay === 0
        ? null
        : Number(payload.customDueDay);

    if (!payload.planId) {
      return Response.json({ error: "Selecione um plano." }, { status: 400 });
    }
    if (!["none", "fixed", "percent"].includes(discountType)) {
      return Response.json({ error: "Tipo de desconto inválido." }, { status: 400 });
    }
    if (discountValue === null || !Number.isInteger(discountValue) || discountValue < 0) {
      return Response.json({ error: "Valor do desconto inválido." }, { status: 400 });
    }
    if (discountType === "percent" && discountValue > 100) {
      return Response.json({ error: "O desconto percentual não pode superar 100%." }, { status: 400 });
    }
    if (customDueDay !== null && (!Number.isInteger(customDueDay) || customDueDay < 1 || customDueDay > 28)) {
      return Response.json({ error: "O vencimento deve estar entre os dias 1 e 28." }, { status: 400 });
    }

    const organizationId = context.membership.organizationId;
    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const [[athlete], [plan]] = await Promise.all([
        sql<{ id: string; category: string }[]>`
          SELECT id, category
          FROM athletes
          WHERE id = ${athleteId}
            AND organization_id = ${organizationId}
            AND active = 1
          LIMIT 1
        `,
        sql<{ id: string; category: string | null }[]>`
          SELECT id, category
          FROM billing_plans
          WHERE id = ${payload.planId}
            AND organization_id = ${organizationId}
            AND active = 1
          LIMIT 1
        `,
      ]);
      if (!athlete || !plan) {
        return Response.json({ error: "Atleta ou plano não encontrado." }, { status: 404 });
      }
      if (!planCategoryCompatible(plan.category, athlete.category)) {
        return Response.json(
          { error: `Este plano é da categoria ${plan.category}, incompatível com a categoria ${athlete.category} do atleta.` },
          { status: 400 },
        );
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const billingId = crypto.randomUUID();
      const [billing] = await sql<SavedBillingRow[]>`
        INSERT INTO athlete_billing (
          id, organization_id, athlete_id, plan_id, discount_type, discount_value,
          custom_due_day, active, created_at, updated_at
        )
        SELECT ${billingId}, ${organizationId}, ${athleteId}, ${payload.planId},
               ${discountType}, ${discountValue}, ${customDueDay},
               ${payload.active ?? true ? 1 : 0}, ${timestamp}, ${timestamp}
        WHERE EXISTS (
          SELECT 1
          FROM athletes a
          JOIN billing_plans p ON p.organization_id = a.organization_id
          WHERE a.id = ${athleteId}
            AND a.organization_id = ${organizationId}
            AND a.active = 1
            AND p.id = ${payload.planId}
            AND p.organization_id = ${organizationId}
            AND p.active = 1
            AND (p.category IS NULL OR p.category = '' OR p.category = a.category)
        )
        ON CONFLICT (athlete_id) DO UPDATE SET
          organization_id = EXCLUDED.organization_id,
          plan_id = EXCLUDED.plan_id,
          discount_type = EXCLUDED.discount_type,
          discount_value = EXCLUDED.discount_value,
          custom_due_day = EXCLUDED.custom_due_day,
          active = EXCLUDED.active,
          updated_at = EXCLUDED.updated_at
        RETURNING id, organization_id, athlete_id, plan_id, discount_type,
                  discount_value, custom_due_day, provider_customer_id,
                  active, created_at, updated_at
      `;
      if (!billing) {
        return Response.json({ error: "Atleta ou plano não encontrado, inativo ou incompatível." }, { status: 404 });
      }

      return Response.json({ billing: savedBillingToDto(billing) });
    }

    const db = getDb();
    const [[athlete], [plan]] = await Promise.all([
      db.select({ id: athletes.id, category: athletes.category }).from(athletes).where(and(eq(athletes.id, athleteId), eq(athletes.organizationId, organizationId), eq(athletes.active, true))).limit(1),
      db.select({ id: billingPlans.id, category: billingPlans.category }).from(billingPlans).where(and(eq(billingPlans.id, payload.planId), eq(billingPlans.organizationId, organizationId), eq(billingPlans.active, true))).limit(1),
    ]);
    if (!athlete || !plan) {
      return Response.json({ error: "Atleta ou plano não encontrado." }, { status: 404 });
    }
    // Plano sem categoria é geral/universal; caso contrário precisa bater
    // com a categoria atual do atleta. Validado aqui (não só na UI) para
    // que nenhum chamador consiga vincular um plano de outra categoria.
    if (!planCategoryCompatible(plan.category, athlete.category)) {
      return Response.json(
        { error: `Este plano é da categoria ${plan.category}, incompatível com a categoria ${athlete.category} do atleta.` },
        { status: 400 },
      );
    }

    const now = new Date();
    const timestamp = Math.floor(now.getTime() / 1000);
    const billingId = crypto.randomUUID();
    const result = await getD1().batch([
      getD1().prepare(`INSERT INTO athlete_billing
        (id, organization_id, athlete_id, plan_id, discount_type, discount_value,
         custom_due_day, active, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM athletes a JOIN billing_plans p ON p.organization_id = a.organization_id
          WHERE a.id = ? AND a.organization_id = ? AND a.active = 1
            AND p.id = ? AND p.organization_id = ? AND p.active = 1
            AND (p.category IS NULL OR p.category = '' OR p.category = a.category)
        )
        ON CONFLICT(athlete_id) DO UPDATE SET
          organization_id = excluded.organization_id, plan_id = excluded.plan_id,
          discount_type = excluded.discount_type, discount_value = excluded.discount_value,
          custom_due_day = excluded.custom_due_day, active = excluded.active,
          updated_at = excluded.updated_at`).bind(
        billingId, organizationId, athleteId, payload.planId, discountType,
        discountValue, customDueDay, payload.active ?? true ? 1 : 0,
        timestamp, timestamp, athleteId, organizationId, payload.planId, organizationId,
      ),
    ]);
    if ((result[0].meta.changes ?? 0) === 0) {
      return Response.json({ error: "Atleta ou plano não encontrado, inativo ou incompatível." }, { status: 404 });
    }
    const [billing] = await db.select().from(athleteBilling).where(
      and(eq(athleteBilling.athleteId, athleteId), eq(athleteBilling.organizationId, organizationId)),
    ).limit(1);
    if (!billing) throw new Error("A configuração criada não pôde ser carregada.");

    return Response.json({ billing });
  } catch (error) {
    console.error("Failed to save athlete billing", error);
    return Response.json(
      { error: "Não foi possível salvar a configuração." },
      { status: 500 },
    );
  }
}
