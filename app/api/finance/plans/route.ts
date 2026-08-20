import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../db/postgres";
import { billingPlans } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";
import { parsePlanPayload } from "../finance-utils";

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

export async function GET(request: Request) {
  const context = await getApiContext(request);
  if (!context) {
    return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  }

  if (postgresConfigured()) {
    const sql = getPostgresClient();
    const rows = await sql<BillingPlanRow[]>`
      SELECT id, organization_id, name, amount_cents, due_day, category,
             active, created_at, updated_at
      FROM billing_plans
      WHERE organization_id = ${context.membership.organizationId}
        AND active = 1
      ORDER BY name ASC
    `;
    return Response.json({ plans: rows.map(planToDto) });
  }

  const rows = await getDb()
    .select()
    .from(billingPlans)
    .where(
      and(
        eq(billingPlans.organizationId, context.membership.organizationId),
        eq(billingPlans.active, true),
      ),
    )
    .orderBy(asc(billingPlans.name));
  return Response.json({ plans: rows.map(planToDto) });
}

export async function POST(request: Request) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }
    const parsed = parsePlanPayload(await request.json());
    if ("error" in parsed) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }

    if (postgresConfigured()) {
      const sql = getPostgresClient();
      const now = Math.floor(Date.now() / 1000);
      const [plan] = await sql<BillingPlanRow[]>`
        INSERT INTO billing_plans (
          id, organization_id, name, amount_cents, due_day, category,
          active, created_at, updated_at
        )
        VALUES (
          ${crypto.randomUUID()}, ${context.membership.organizationId},
          ${parsed.value.name}, ${parsed.value.amountCents},
          ${parsed.value.dueDay}, ${parsed.value.category},
          1, ${now}, ${now}
        )
        RETURNING id, organization_id, name, amount_cents, due_day, category,
                  active, created_at, updated_at
      `;
      return Response.json({ plan: planToDto(plan) }, { status: 201 });
    }

    const now = new Date();
    const [plan] = await getDb()
      .insert(billingPlans)
      .values({
        id: crypto.randomUUID(),
        organizationId: context.membership.organizationId,
        ...parsed.value,
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return Response.json({ plan: planToDto(plan) }, { status: 201 });
  } catch (error) {
    console.error("Failed to create billing plan", error);
    return Response.json(
      { error: "Não foi possível criar o plano." },
      { status: 500 },
    );
  }
}
