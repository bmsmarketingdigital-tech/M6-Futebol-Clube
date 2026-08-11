import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { billingCombos } from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getApiContext(request); if (!context) return Response.json({ error: "Não autorizado." }, { status: 401 }); const { id } = await params; const body = await request.json() as { active?: boolean; name?: string; description?: string };
  const [row] = await getDb().update(billingCombos).set({ ...(typeof body.active === "boolean" ? { active: body.active } : {}), ...(body.name ? { name: body.name.trim() } : {}), ...(body.description !== undefined ? { description: body.description } : {}), updatedAt: new Date() }).where(and(eq(billingCombos.id, id), eq(billingCombos.organizationId, context.membership.organizationId))).returning();
  return row ? Response.json({ combo: row }) : Response.json({ error: "Combo não encontrado." }, { status: 404 });
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) { const context = await getApiContext(request); if (!context) return Response.json({ error: "Não autorizado." }, { status: 401 }); const { id } = await params; const [row] = await getDb().update(billingCombos).set({ active: false, updatedAt: new Date() }).where(and(eq(billingCombos.id, id), eq(billingCombos.organizationId, context.membership.organizationId))).returning({ id: billingCombos.id }); return row ? Response.json({ ok: true }) : Response.json({ error: "Combo não encontrado." }, { status: 404 }); }
