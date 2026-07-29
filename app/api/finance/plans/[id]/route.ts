import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { athleteBilling, billingPlans } from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";
import { parsePlanPayload } from "../../finance-utils";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getApiContext(request);
  if (!context) {
    return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  }
  const parsed = parsePlanPayload(await request.json());
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const { id } = await params;
  const [plan] = await getDb()
    .update(billingPlans)
    .set({ ...parsed.value, updatedAt: new Date() })
    .where(
      and(
        eq(billingPlans.id, id),
        eq(billingPlans.organizationId, context.membership.organizationId),
        eq(billingPlans.active, true),
      ),
    )
    .returning();
  return plan
    ? Response.json({ plan })
    : Response.json({ error: "Plano não encontrado." }, { status: 404 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getApiContext(request);
  if (!context) {
    return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  }
  const { id } = await params;
  const [plan] = await getDb()
    .update(billingPlans)
    .set({ active: false, updatedAt: new Date() })
    .where(
      and(
        eq(billingPlans.id, id),
        eq(billingPlans.organizationId, context.membership.organizationId),
      ),
    )
    .returning({ id: billingPlans.id });
  if (plan) {
    await getDb()
      .update(athleteBilling)
      .set({ active: false, updatedAt: new Date() })
      .where(
        and(
          eq(athleteBilling.planId, id),
          eq(
            athleteBilling.organizationId,
            context.membership.organizationId,
          ),
        ),
      );
  }
  return plan
    ? Response.json({ archived: true })
    : Response.json({ error: "Plano não encontrado." }, { status: 404 });
}
