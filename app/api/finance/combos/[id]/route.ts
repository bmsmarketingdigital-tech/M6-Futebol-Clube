import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../../db/postgres";
import { billingCombos } from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getApiContext(request); if (!context) return Response.json({ error: "Não autorizado." }, { status: 401 }); const { id } = await params; const body = await request.json() as { active?: boolean; name?: string; description?: string };
  const organizationId = context.membership.organizationId;
  const nextActive = typeof body.active === "boolean" ? (body.active ? 1 : 0) : null;
  const nextName = body.name ? body.name.trim() : null;
  const nextDescription = body.description !== undefined ? body.description : undefined;

  if (postgresConfigured()) {
    const sql = getPostgresClient();
    const now = Math.floor(Date.now() / 1000);
    const [row] = await sql`
      UPDATE billing_combos SET
        active = COALESCE(${nextActive}, active),
        name = COALESCE(${nextName}, name),
        description = ${nextDescription === undefined ? sql`description` : nextDescription},
        updated_at = ${now}
      WHERE id = ${id} AND organization_id = ${organizationId}
      RETURNING *
    `;
    if (!row) return Response.json({ error: "Combo não encontrado." }, { status: 404 });
    return Response.json({
      combo: {
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        comboType: row.combo_type,
        durationMonths: row.duration_months,
        description: row.description,
        basePlanId: row.base_plan_id,
        baseAmountCents: row.base_amount_cents,
        discountType: row.discount_type,
        discountValue: row.discount_value,
        finalAmountCents: row.final_amount_cents,
        billingMode: row.billing_mode,
        installmentCount: row.installment_count,
        active: Boolean(row.active),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  }

  const [row] = await getDb().update(billingCombos).set({ ...(typeof body.active === "boolean" ? { active: body.active } : {}), ...(body.name ? { name: body.name.trim() } : {}), ...(body.description !== undefined ? { description: body.description } : {}), updatedAt: new Date() }).where(and(eq(billingCombos.id, id), eq(billingCombos.organizationId, organizationId))).returning();
  return row ? Response.json({ combo: row }) : Response.json({ error: "Combo não encontrado." }, { status: 404 });
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getApiContext(request); if (!context) return Response.json({ error: "Não autorizado." }, { status: 401 }); const { id } = await params;
  const organizationId = context.membership.organizationId;

  if (postgresConfigured()) {
    const sql = getPostgresClient();
    const now = Math.floor(Date.now() / 1000);
    const [row] = await sql`
      UPDATE billing_combos SET active = 0, updated_at = ${now}
      WHERE id = ${id} AND organization_id = ${organizationId}
      RETURNING id
    `;
    return row ? Response.json({ ok: true }) : Response.json({ error: "Combo não encontrado." }, { status: 404 });
  }

  const [row] = await getDb().update(billingCombos).set({ active: false, updatedAt: new Date() }).where(and(eq(billingCombos.id, id), eq(billingCombos.organizationId, organizationId))).returning({ id: billingCombos.id }); return row ? Response.json({ ok: true }) : Response.json({ error: "Combo não encontrado." }, { status: 404 });
}
