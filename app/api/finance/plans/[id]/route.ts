import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../../db/postgres";
import { billingPlans } from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";
import { parsePlanPayload } from "../../finance-utils";

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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso nÃ£o autorizado." }, { status: 401 });
  const parsed = parsePlanPayload(await request.json());
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const { id } = await params;

  if (postgresConfigured()) {
    const sql = getPostgresClient();
    const now = Math.floor(Date.now() / 1000);
    const [plan] = await sql<BillingPlanRow[]>`
      UPDATE billing_plans
      SET name = ${parsed.value.name},
          amount_cents = ${parsed.value.amountCents},
          due_day = ${parsed.value.dueDay},
          category = ${parsed.value.category},
          updated_at = ${now}
      WHERE id = ${id}
        AND organization_id = ${context.membership.organizationId}
        AND active = 1
      RETURNING id, organization_id, name, amount_cents, due_day, category,
                active, created_at, updated_at
    `;
    return plan
      ? Response.json({ plan: planToDto(plan) })
      : Response.json({ error: "Plano nÃ£o encontrado." }, { status: 404 });
  }

  const [plan] = await getDb().update(billingPlans)
    .set({ ...parsed.value, updatedAt: new Date() })
    .where(and(eq(billingPlans.id, id), eq(billingPlans.organizationId, context.membership.organizationId), eq(billingPlans.active, true)))
    .returning();
  return plan ? Response.json({ plan: planToDto(plan) }) : Response.json({ error: "Plano nÃ£o encontrado." }, { status: 404 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Acesso nÃ£o autorizado." }, { status: 401 });
  const { id } = await params;
  const organizationId = context.membership.organizationId;
  const now = Math.floor(Date.now() / 1000);

  if (postgresConfigured()) {
    const sql = getPostgresClient();
    const archived = await sql.begin(async (transaction) => {
      const [plan] = await transaction<{ id: string }[]>`
        UPDATE billing_plans
        SET active = 0, updated_at = ${now}
        WHERE id = ${id}
          AND organization_id = ${organizationId}
        RETURNING id
      `;
      if (!plan) return null;
      await transaction`
        UPDATE athlete_billing
        SET active = 0, updated_at = ${now}
        WHERE plan_id = ${id}
          AND organization_id = ${organizationId}
      `;
      return plan;
    });
    if (!archived) {
      return Response.json({ error: "Plano nÃ£o encontrado." }, { status: 404 });
    }
    return Response.json({ archived: true });
  }

  const d1 = getD1();
  const results = await d1.batch([
    d1.prepare(`UPDATE billing_plans SET active = 0, updated_at = ? WHERE id = ? AND organization_id = ?`).bind(now, id, organizationId),
    d1.prepare(`UPDATE athlete_billing SET active = 0, updated_at = ? WHERE plan_id = ? AND organization_id = ?`).bind(now, id, organizationId),
  ]);
  if ((results[0].meta.changes ?? 0) === 0) {
    return Response.json({ error: "Plano nÃ£o encontrado." }, { status: 404 });
  }
  return Response.json({ archived: true });
}
