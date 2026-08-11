import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import { billingPlans } from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";
import { parsePlanPayload } from "../../finance-utils";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  const parsed = parsePlanPayload(await request.json());
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const { id } = await params;
  const [plan] = await getDb().update(billingPlans)
    .set({ ...parsed.value, updatedAt: new Date() })
    .where(and(eq(billingPlans.id, id), eq(billingPlans.organizationId, context.membership.organizationId), eq(billingPlans.active, true)))
    .returning();
  return plan ? Response.json({ plan }) : Response.json({ error: "Plano não encontrado." }, { status: 404 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  const { id } = await params;
  const organizationId = context.membership.organizationId;
  const now = Math.floor(Date.now() / 1000);
  const d1 = getD1();
  const results = await d1.batch([
    d1.prepare(`UPDATE billing_plans SET active = 0, updated_at = ? WHERE id = ? AND organization_id = ?`).bind(now, id, organizationId),
    d1.prepare(`UPDATE athlete_billing SET active = 0, updated_at = ? WHERE plan_id = ? AND organization_id = ?`).bind(now, id, organizationId),
  ]);
  if ((results[0].meta.changes ?? 0) === 0) {
    return Response.json({ error: "Plano não encontrado." }, { status: 404 });
  }
  return Response.json({ archived: true });
}
