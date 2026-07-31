import { and, asc, desc, eq, lt } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  athleteBilling,
  athletes,
  billingPlans,
  payments,
} from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import { validateMonth } from "../finance-utils";
import { hasAsaasConfiguration } from "../asaas";

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
    const today = new Date().toISOString().slice(0, 10);

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

    const [planRows, archivedPlanRows, billingRows, chargeRows] = await Promise.all([
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
    ]);

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

    return Response.json({
      month,
      plans: planRows,
      archivedPlans: archivedPlanRows,
      billing: billingRows,
      charges: chargeRows,
      summary: {
        receivedCents,
        pendingCents,
        overdueCents,
        expectedCents: receivedCents + pendingCents + overdueCents,
        paidCount: chargeRows.filter(
          (charge) => charge.status === "paid" || charge.status === "partial",
        ).length,
        overdueCount: chargeRows.filter(
          (charge) =>
            charge.status === "overdue" ||
            (charge.status === "partial" && charge.dueDate < today),
        ).length,
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
