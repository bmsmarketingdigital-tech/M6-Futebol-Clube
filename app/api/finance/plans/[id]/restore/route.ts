import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { billingPlans } from "../../../../../../db/schema";
import { getApiContext } from "../../../../api-auth";

export const dynamic = "force-dynamic";

export async function POST(
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
    .set({ active: true, updatedAt: new Date() })
    .where(
      and(
        eq(billingPlans.id, id),
        eq(billingPlans.organizationId, context.membership.organizationId),
        eq(billingPlans.active, false),
      ),
    )
    .returning();
  return plan
    ? Response.json({ plan })
    : Response.json({ error: "Plano arquivado não encontrado." }, { status: 404 });
}
