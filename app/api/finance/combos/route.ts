import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { billingCombos, billingPlans } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";

export const dynamic = "force-dynamic";

function cents(value: unknown) { const n = Number(value); return Number.isInteger(n) && n >= 0 ? n : null; }
function finalAmount(base: number, type: string, value: number) {
  if (type === "percent") return Math.max(0, base - Math.round(base * value / 100));
  if (type === "fixed") return Math.max(0, base - value);
  return base;
}

export async function GET(request: Request) {
  const context = await getApiContext(request); if (!context) return Response.json({ error: "Faça login para acessar os combos." }, { status: 401 });
  const rows = await getDb().select({ combo: billingCombos, planName: billingPlans.name }).from(billingCombos)
    .leftJoin(billingPlans, and(eq(billingPlans.id, billingCombos.basePlanId), eq(billingPlans.organizationId, billingCombos.organizationId)))
    .where(eq(billingCombos.organizationId, context.membership.organizationId)).orderBy(desc(billingCombos.createdAt));
  return Response.json({ combos: rows.map(({ combo, planName }) => ({ ...combo, planName })) });
}

export async function POST(request: Request) {
  const context = await getApiContext(request); if (!context) return Response.json({ error: "Faça login para criar combos." }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const name = String(body.name ?? "").trim(); const durationMonths = Number(body.durationMonths); const base = cents(body.baseAmountCents);
  const discountType = ["none", "fixed", "percent"].includes(String(body.discountType)) ? String(body.discountType) : "none";
  const discountValue = cents(body.discountValue) ?? 0; const installmentCount = Number(body.installmentCount ?? 1);
  if (!name || !Number.isInteger(durationMonths) || durationMonths < 1 || base === null || !Number.isInteger(installmentCount) || installmentCount < 1) return Response.json({ error: "Informe nome, duração, valor e parcelas válidos." }, { status: 400 });
  if (discountType === "percent" && discountValue > 100) return Response.json({ error: "Desconto percentual inválido." }, { status: 400 });
  const now = new Date(); const final = finalAmount(base, discountType, discountValue);
  const [row] = await getDb().insert(billingCombos).values({ id: crypto.randomUUID(), organizationId: context.membership.organizationId, name, comboType: String(body.comboType ?? "custom"), durationMonths, description: body.description ? String(body.description) : null, basePlanId: body.basePlanId ? String(body.basePlanId) : null, baseAmountCents: base, discountType: discountType as "none" | "fixed" | "percent", discountValue, finalAmountCents: final, billingMode: body.billingMode === "upfront" ? "upfront" : "installments", installmentCount, active: body.active !== false, createdAt: now, updatedAt: now }).returning();
  return Response.json({ combo: row }, { status: 201 });
}
