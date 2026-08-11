import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "../../../../db";
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
    const db = getDb();
    const today = saoPauloDate();

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
