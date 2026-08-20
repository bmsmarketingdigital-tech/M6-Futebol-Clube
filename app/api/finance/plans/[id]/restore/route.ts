import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../../../db/postgres";
import { billingPlans } from "../../../../../../db/schema";
import { getApiContext } from "../../../../api-auth";

export const dynamic = "force-dynamic";

type BillingPlanRow = typeof billingPlans.$inferSelect | {
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

function planToDto(row: BillingPlanRow) {
  if ("organizationId" in row) return row;
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getApiContext(request);
  if (!context) {
    return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  }
  const { id } = await params;

  if (postgresConfigured()) {
    const sql = getPostgresClient();
    const now = Math.floor(Date.now() / 1000);
    const [plan] = await sql<BillingPlanRow[]>`
      UPDATE billing_plans
      SET active = 1, updated_at = ${now}
      WHERE id = ${id}
        AND organization_id = ${context.membership.organizationId}
        AND active = 0
      RETURNING id, organization_id, name, amount_cents, due_day, category,
                active, created_at, updated_at
    `;
    return plan
      ? Response.json({ plan: planToDto(plan) })
      : Response.json({ error: "Plano arquivado não encontrado." }, { status: 404 });
  }

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
    ? Response.json({ plan: planToDto(plan) })
    : Response.json({ error: "Plano arquivado não encontrado." }, { status: 404 });
}
