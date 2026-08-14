import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../db/postgres";
import {
  athleteBilling,
  athletes,
  billingPlans,
  expenses,
  payments,
} from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import { validateMonth } from "../finance-utils";
import { hasAsaasConfiguration } from "../asaas";
import { saoPauloDate } from "../billing-automation";

export const dynamic = "force-dynamic";

type PostgresPlanRow = {
  id: string;
  organization_id: string;
  name: string;
  amount_cents: number;
  due_day: number;
  category: string | null;
  active: number | boolean;
  created_at: number;
  updated_at: number;
};

type PostgresChargeRow = {
  id: string;
  athleteId: string;
  athleteName: string;
  category: string;
  referenceMonth: string;
  amountCents: number;
  dueDate: string;
  paidAt: number | null;
  paidAmountCents: number | null;
  paymentMethod: "cash" | "pix" | "card" | "bank" | "other" | null;
  planName: string | null;
  notes: string | null;
  externalProvider: string | null;
  externalPaymentId: string | null;
  invoiceUrl: string | null;
  externalStatus: string | null;
  status: "open" | "paid" | "partial" | "overdue" | "cancelled";
};

type PostgresExpenseRow = {
  id: string;
  organization_id: string;
  reference_month: string;
  description: string;
  category: string;
  supplier: string | null;
  amount_cents: number;
  due_date: string;
  paid_at: number | null;
  payment_method: "cash" | "pix" | "card" | "bank" | "other" | null;
  status: "open" | "paid" | "overdue" | "cancelled";
  notes: string | null;
  installment_group_id: string | null;
  installment_number: number;
  installment_count: number;
  created_by: string;
  created_at: number;
  updated_at: number;
};

function timestampToIso(value: number | null) {
  return value ? new Date(value * 1000).toISOString() : null;
}

function planToDto(row: PostgresPlanRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    amountCents: row.amount_cents,
    dueDay: row.due_day,
    category: row.category,
    active: Boolean(row.active),
    createdAt: new Date(row.created_at * 1000),
    updatedAt: new Date(row.updated_at * 1000),
  };
}

function chargeToDto(row: PostgresChargeRow) {
  return {
    ...row,
    paidAt: timestampToIso(row.paidAt),
  };
}

function expenseToDto(row: PostgresExpenseRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    referenceMonth: row.reference_month,
    description: row.description,
    category: row.category,
    supplier: row.supplier,
    amountCents: row.amount_cents,
    dueDate: row.due_date,
    paidAt: timestampToIso(row.paid_at),
    paymentMethod: row.payment_method,
    status: row.status,
    notes: row.notes,
    installmentGroupId: row.installment_group_id,
    installmentNumber: row.installment_number,
    installmentCount: row.installment_count,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at * 1000),
    updatedAt: new Date(row.updated_at * 1000),
  };
}

export async function GET(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }
    const month =
      validateMonth(new URL(request.url).searchParams.get("month")) ??
      new Date().toISOString().slice(0, 7);
    const organizationId = context.membership.organizationId;
    const today = saoPauloDate();

    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const now = Math.floor(Date.now() / 1000);

      await Promise.all([
        sql`
          UPDATE payments
          SET status = 'overdue', updated_at = ${now}
          WHERE organization_id = ${organizationId}
            AND status = 'open'
            AND due_date < ${today}
        `,
        sql`
          UPDATE expenses
          SET status = 'overdue', updated_at = ${now}
          WHERE organization_id = ${organizationId}
            AND status = 'open'
            AND due_date < ${today}
        `,
      ]);

      const [planRows, archivedPlanRows, billingRows, chargeRows, expenseRows] = await Promise.all([
        sql<PostgresPlanRow[]>`
          SELECT id, organization_id, name, amount_cents, due_day, category,
                 active, created_at, updated_at
          FROM billing_plans
          WHERE organization_id = ${organizationId}
            AND active = 1
          ORDER BY name ASC
        `,
        sql<PostgresPlanRow[]>`
          SELECT id, organization_id, name, amount_cents, due_day, category,
                 active, created_at, updated_at
          FROM billing_plans
          WHERE organization_id = ${organizationId}
            AND active = 0
          ORDER BY name ASC
        `,
        sql<{
          athleteId: string;
          athleteName: string;
          category: string;
          planId: string;
          planName: string;
          planAmountCents: number;
          planDueDay: number;
          discountType: "none" | "fixed" | "percent";
          discountValue: number;
          customDueDay: number | null;
          active: boolean;
        }[]>`
          SELECT ab.athlete_id AS "athleteId",
                 a.full_name AS "athleteName",
                 a.category,
                 ab.plan_id AS "planId",
                 bp.name AS "planName",
                 bp.amount_cents AS "planAmountCents",
                 bp.due_day AS "planDueDay",
                 ab.discount_type AS "discountType",
                 ab.discount_value AS "discountValue",
                 ab.custom_due_day AS "customDueDay",
                 (ab.active = 1) AS active
          FROM athlete_billing ab
          INNER JOIN athletes a ON a.id = ab.athlete_id
          INNER JOIN billing_plans bp ON bp.id = ab.plan_id
          WHERE ab.organization_id = ${organizationId}
            AND a.organization_id = ${organizationId}
            AND bp.organization_id = ${organizationId}
            AND a.active = 1
          ORDER BY a.full_name ASC
        `,
        sql<PostgresChargeRow[]>`
          SELECT p.id,
                 p.athlete_id AS "athleteId",
                 a.full_name AS "athleteName",
                 a.category,
                 p.reference_month AS "referenceMonth",
                 p.amount_cents AS "amountCents",
                 p.due_date AS "dueDate",
                 p.paid_at AS "paidAt",
                 p.paid_amount_cents AS "paidAmountCents",
                 p.payment_method AS "paymentMethod",
                 p.plan_name AS "planName",
                 p.notes,
                 p.external_provider AS "externalProvider",
                 p.external_payment_id AS "externalPaymentId",
                 p.invoice_url AS "invoiceUrl",
                 p.external_status AS "externalStatus",
                 p.status
          FROM payments p
          INNER JOIN athletes a ON a.id = p.athlete_id
          WHERE p.organization_id = ${organizationId}
            AND a.organization_id = ${organizationId}
            AND p.reference_month = ${month}
          ORDER BY p.due_date DESC, a.full_name ASC
        `,
        sql<PostgresExpenseRow[]>`
          SELECT id, organization_id, reference_month, description, category,
                 supplier, amount_cents, due_date, paid_at, payment_method,
                 status, notes, installment_group_id, installment_number,
                 installment_count, created_by, created_at, updated_at
          FROM expenses
          WHERE organization_id = ${organizationId}
            AND reference_month = ${month}
          ORDER BY due_date DESC, description ASC
        `,
      ]);

      const outstandingRows = await sql<{
        amountCents: number;
        paidAmountCents: number | null;
        dueDate: string;
        status: string;
      }[]>`
        SELECT amount_cents AS "amountCents",
               paid_amount_cents AS "paidAmountCents",
               due_date AS "dueDate",
               status
        FROM payments
        WHERE organization_id = ${organizationId}
          AND status IN ('open', 'overdue', 'partial')
      `;
      const planDtos = planRows.map(planToDto);
      const archivedPlanDtos = archivedPlanRows.map(planToDto);
      const chargeDtos = chargeRows.map(chargeToDto);
      const expenseDtos = expenseRows.map(expenseToDto);
      const balance = (charge: (typeof outstandingRows)[number]) =>
        Math.max(0, charge.amountCents - (charge.paidAmountCents ?? 0));
      const openRows = outstandingRows.filter((charge) => charge.dueDate >= today);
      const overdueRows = outstandingRows.filter((charge) => charge.dueDate < today);
      const dueTodayRows = outstandingRows.filter((charge) => charge.dueDate === today);
      const soonLimit = new Date(`${today}T12:00:00Z`);
      soonLimit.setUTCDate(soonLimit.getUTCDate() + 7);
      const soonLimitDate = soonLimit.toISOString().slice(0, 10);
      const dueSoonRows = outstandingRows.filter(
        (charge) => charge.dueDate > today && charge.dueDate <= soonLimitDate,
      );

      const receivedCents = chargeDtos.reduce((sum, charge) => {
        if (charge.status === "paid") return sum + (charge.paidAmountCents ?? charge.amountCents);
        if (charge.status === "partial") return sum + (charge.paidAmountCents ?? 0);
        return sum;
      }, 0);
      const pendingCents = chargeDtos.reduce((sum, charge) => {
        if (charge.status === "open") return sum + charge.amountCents;
        if (charge.status === "partial" && charge.dueDate >= today) {
          return sum + (charge.amountCents - (charge.paidAmountCents ?? 0));
        }
        return sum;
      }, 0);
      const overdueCents = chargeDtos.reduce((sum, charge) => {
        if (charge.status === "overdue") return sum + charge.amountCents;
        if (charge.status === "partial" && charge.dueDate < today) {
          return sum + (charge.amountCents - (charge.paidAmountCents ?? 0));
        }
        return sum;
      }, 0);
      const billedCents = chargeDtos.reduce(
        (sum, charge) => sum + (charge.status === "cancelled" ? 0 : charge.amountCents),
        0,
      );
      const expensePaidCents = expenseDtos.reduce(
        (sum, expense) => sum + (expense.status === "paid" ? expense.amountCents : 0),
        0,
      );
      const expensePendingCents = expenseDtos.reduce(
        (sum, expense) =>
          sum +
          (expense.status === "open" || expense.status === "overdue"
            ? expense.amountCents
            : 0),
        0,
      );
      const expenseOverdueCents = expenseDtos.reduce(
        (sum, expense) => sum + (expense.status === "overdue" ? expense.amountCents : 0),
        0,
      );

      return Response.json({
        month,
        plans: planDtos,
        archivedPlans: archivedPlanDtos,
        billing: billingRows,
        charges: chargeDtos,
        expenses: expenseDtos,
        summary: {
          billedCents,
          receivedCents,
          pendingCents,
          overdueCents,
          expectedCents: billedCents,
          expensePaidCents,
          expensePendingCents,
          expenseOverdueCents,
          expenseTotalCents: expensePaidCents + expensePendingCents,
          netCents: receivedCents - expensePaidCents,
          paidCount: chargeDtos.filter(
            (charge) => charge.status === "paid" || charge.status === "partial",
          ).length,
          overdueCount: chargeDtos.filter(
            (charge) =>
              charge.status === "overdue" ||
              (charge.status === "partial" && charge.dueDate < today),
          ).length,
          expensePaidCount: expenseDtos.filter((expense) => expense.status === "paid").length,
          expensePendingCount: expenseDtos.filter(
            (expense) => expense.status === "open" || expense.status === "overdue",
          ).length,
          openCount: openRows.length,
          openCents: openRows.reduce((sum, charge) => sum + balance(charge), 0),
          dueTodayCount: dueTodayRows.length,
          dueTodayCents: dueTodayRows.reduce((sum, charge) => sum + balance(charge), 0),
          dueSoonCount: dueSoonRows.length,
          dueSoonCents: dueSoonRows.reduce((sum, charge) => sum + balance(charge), 0),
          totalOverdueCount: overdueRows.length,
          totalOverdueCents: overdueRows.reduce((sum, charge) => sum + balance(charge), 0),
          collectionRate:
            billedCents > 0 ? Math.round((receivedCents / billedCents) * 100) : 0,
        },
        paymentIntegration: {
          provider: "asaas",
          configured: hasAsaasConfiguration(),
          environment: "sandbox",
        },
      });
    }

    const db = getDb();

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

    await db
      .update(expenses)
      .set({ status: "overdue", updatedAt: new Date() })
      .where(
        and(
          eq(expenses.organizationId, organizationId),
          eq(expenses.status, "open"),
          lt(expenses.dueDate, today),
        ),
      );

    const [planRows, archivedPlanRows, billingRows, chargeRows, expenseRows] = await Promise.all([
      db
        .select()
        .from(billingPlans)
        .where(
          and(
            eq(billingPlans.organizationId, organizationId),
            eq(billingPlans.active, true),
          ),
        )
        .orderBy(asc(billingPlans.name)),
      db
        .select()
        .from(billingPlans)
        .where(
          and(
            eq(billingPlans.organizationId, organizationId),
            eq(billingPlans.active, false),
          ),
        )
        .orderBy(asc(billingPlans.name)),
      db
        .select({
          athleteId: athleteBilling.athleteId,
          athleteName: athletes.fullName,
          category: athletes.category,
          planId: athleteBilling.planId,
          planName: billingPlans.name,
          planAmountCents: billingPlans.amountCents,
          planDueDay: billingPlans.dueDay,
          discountType: athleteBilling.discountType,
          discountValue: athleteBilling.discountValue,
          customDueDay: athleteBilling.customDueDay,
          active: athleteBilling.active,
        })
        .from(athleteBilling)
        .innerJoin(athletes, eq(athletes.id, athleteBilling.athleteId))
        .innerJoin(billingPlans, eq(billingPlans.id, athleteBilling.planId))
        .where(
          and(
            eq(athleteBilling.organizationId, organizationId),
            eq(athletes.active, true),
          ),
        )
        .orderBy(asc(athletes.fullName)),
      db
        .select({
          id: payments.id,
          athleteId: payments.athleteId,
          athleteName: athletes.fullName,
          category: athletes.category,
          referenceMonth: payments.referenceMonth,
          amountCents: payments.amountCents,
          dueDate: payments.dueDate,
          paidAt: payments.paidAt,
          paidAmountCents: payments.paidAmountCents,
          paymentMethod: payments.paymentMethod,
          planName: payments.planName,
          notes: payments.notes,
          externalProvider: payments.externalProvider,
          externalPaymentId: payments.externalPaymentId,
          invoiceUrl: payments.invoiceUrl,
          externalStatus: payments.externalStatus,
          status: payments.status,
        })
        .from(payments)
        .innerJoin(athletes, eq(athletes.id, payments.athleteId))
        .where(
          and(
            eq(payments.organizationId, organizationId),
            eq(payments.referenceMonth, month),
          ),
        )
        .orderBy(desc(payments.dueDate), asc(athletes.fullName)),
        db
          .select()
          .from(expenses)
        .where(
          and(
            eq(expenses.organizationId, organizationId),
            eq(expenses.referenceMonth, month),
          ),
          )
          .orderBy(desc(expenses.dueDate), asc(expenses.description)),
      ]);

    const outstandingRows = await db
      .select({
        amountCents: payments.amountCents,
        paidAmountCents: payments.paidAmountCents,
        dueDate: payments.dueDate,
        status: payments.status,
      })
      .from(payments)
      .where(
        and(
          eq(payments.organizationId, organizationId),
          inArray(payments.status, ["open", "overdue", "partial"]),
        ),
      );
    const balance = (charge: (typeof outstandingRows)[number]) =>
      Math.max(0, charge.amountCents - (charge.paidAmountCents ?? 0));
    const openRows = outstandingRows.filter(
      (charge) => charge.dueDate >= today,
    );
    const overdueRows = outstandingRows.filter(
      (charge) => charge.dueDate < today,
    );
    const dueTodayRows = outstandingRows.filter(
      (charge) => charge.dueDate === today,
    );
    const soonLimit = new Date(`${today}T12:00:00Z`);
    soonLimit.setUTCDate(soonLimit.getUTCDate() + 7);
    const soonLimitDate = soonLimit.toISOString().slice(0, 10);
    const dueSoonRows = outstandingRows.filter(
      (charge) => charge.dueDate > today && charge.dueDate <= soonLimitDate,
    );

    const receivedCents = chargeRows.reduce((sum, charge) => {
      if (charge.status === "paid") return sum + (charge.paidAmountCents ?? charge.amountCents);
      if (charge.status === "partial") return sum + (charge.paidAmountCents ?? 0);
      return sum;
    }, 0);
    const pendingCents = chargeRows.reduce((sum, charge) => {
      if (charge.status === "open") return sum + charge.amountCents;
      if (charge.status === "partial" && charge.dueDate >= today) {
        return sum + (charge.amountCents - (charge.paidAmountCents ?? 0));
      }
      return sum;
    }, 0);
    const overdueCents = chargeRows.reduce((sum, charge) => {
      if (charge.status === "overdue") return sum + charge.amountCents;
      if (charge.status === "partial" && charge.dueDate < today) {
        return sum + (charge.amountCents - (charge.paidAmountCents ?? 0));
      }
      return sum;
    }, 0);
    const billedCents = chargeRows.reduce(
      (sum, charge) => sum + (charge.status === "cancelled" ? 0 : charge.amountCents),
      0,
    );
    const expensePaidCents = expenseRows.reduce(
      (sum, expense) => sum + (expense.status === "paid" ? expense.amountCents : 0),
      0,
    );
    const expensePendingCents = expenseRows.reduce(
      (sum, expense) =>
        sum +
        (expense.status === "open" || expense.status === "overdue"
          ? expense.amountCents
          : 0),
      0,
    );
    const expenseOverdueCents = expenseRows.reduce(
      (sum, expense) =>
        sum + (expense.status === "overdue" ? expense.amountCents : 0),
      0,
    );

    return Response.json({
      month,
      plans: planRows,
      archivedPlans: archivedPlanRows,
      billing: billingRows,
      charges: chargeRows,
      expenses: expenseRows,
      summary: {
        billedCents,
        receivedCents,
        pendingCents,
        overdueCents,
        expectedCents: billedCents,
        expensePaidCents,
        expensePendingCents,
        expenseOverdueCents,
        expenseTotalCents: expensePaidCents + expensePendingCents,
        netCents: receivedCents - expensePaidCents,
        paidCount: chargeRows.filter(
          (charge) => charge.status === "paid" || charge.status === "partial",
        ).length,
        overdueCount: chargeRows.filter(
          (charge) =>
            charge.status === "overdue" ||
            (charge.status === "partial" && charge.dueDate < today),
        ).length,
        expensePaidCount: expenseRows.filter((expense) => expense.status === "paid")
          .length,
        expensePendingCount: expenseRows.filter(
          (expense) => expense.status === "open" || expense.status === "overdue",
        ).length,
        openCount: openRows.length,
        openCents: openRows.reduce((sum, charge) => sum + balance(charge), 0),
        dueTodayCount: dueTodayRows.length,
        dueTodayCents: dueTodayRows.reduce(
          (sum, charge) => sum + balance(charge),
          0,
        ),
        dueSoonCount: dueSoonRows.length,
        dueSoonCents: dueSoonRows.reduce(
          (sum, charge) => sum + balance(charge),
          0,
        ),
        totalOverdueCount: overdueRows.length,
        totalOverdueCents: overdueRows.reduce(
          (sum, charge) => sum + balance(charge),
          0,
        ),
        collectionRate:
          billedCents > 0 ? Math.round((receivedCents / billedCents) * 100) : 0,
      },
      paymentIntegration: {
        provider: "asaas",
        configured: hasAsaasConfiguration(),
        environment: "sandbox",
      },
    });
  } catch (error) {
    console.error("Failed to load financial summary", error);
    return Response.json(
      { error: "Não foi possível carregar o financeiro." },
      { status: 500 },
    );
  }
}
