import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import {
  athleteBilling,
  athletes,
  billingPlans,
  payments,
} from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";
import {
  calculateCharge,
  dueDateForMonth,
  validateMonth,
} from "../../finance-utils";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }
    const payload = (await request.json()) as { month?: string };
    const month = validateMonth(payload.month);
    if (!month) {
      return Response.json({ error: "Mês de referência inválido." }, { status: 400 });
    }
    const db = getDb();
    const organizationId = context.membership.organizationId;
    const configurations = await db
      .select({
        athleteId: athleteBilling.athleteId,
        amountCents: billingPlans.amountCents,
        planName: billingPlans.name,
        planDueDay: billingPlans.dueDay,
        customDueDay: athleteBilling.customDueDay,
        discountType: athleteBilling.discountType,
        discountValue: athleteBilling.discountValue,
      })
      .from(athleteBilling)
      .innerJoin(athletes, eq(athletes.id, athleteBilling.athleteId))
      .innerJoin(billingPlans, eq(billingPlans.id, athleteBilling.planId))
      .where(
        and(
          eq(athleteBilling.organizationId, organizationId),
          eq(athleteBilling.active, true),
          eq(athletes.active, true),
          eq(billingPlans.active, true),
        ),
      );

    let createdCount = 0;
    const now = new Date();
    for (const configuration of configurations) {
      const created = await db
        .insert(payments)
        .values({
          id: crypto.randomUUID(),
          organizationId,
          athleteId: configuration.athleteId,
          referenceMonth: month,
          amountCents: calculateCharge(
            configuration.amountCents,
            configuration.discountType,
            configuration.discountValue,
          ),
          dueDate: dueDateForMonth(
            month,
            configuration.customDueDay ?? configuration.planDueDay,
          ),
          planName: configuration.planName,
          status: "open",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [payments.athleteId, payments.referenceMonth],
        })
        .returning({ id: payments.id });
      if (created.length > 0) {
        createdCount += 1;
        await db
          .update(athletes)
          .set({ financialStatus: "pending", updatedAt: now })
          .where(
            and(
              eq(athletes.id, configuration.athleteId),
              eq(athletes.organizationId, organizationId),
            ),
          );
      }
    }

    return Response.json({
      createdCount,
      skippedCount: configurations.length - createdCount,
      configuredCount: configurations.length,
    });
  } catch (error) {
    console.error("Failed to generate charges", error);
    return Response.json(
      { error: "Não foi possível gerar as mensalidades." },
      { status: 500 },
    );
  }
}
