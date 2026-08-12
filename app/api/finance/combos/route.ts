import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { billingCombos, billingPlans } from "../../../../db/schema";
import { getApiContext } from "../../api-auth";

export const dynamic = "force-dynamic";

function cents(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function finalAmount(base: number, type: string, value: number) {
  if (type === "percent") return Math.max(0, base - Math.round((base * value) / 100));
  if (type === "fixed") return Math.max(0, base - value);
  return base;
}

function validateCombo(body: Record<string, unknown>) {
  const name = String(body.name ?? "").trim();
  const durationMonths = Number(body.durationMonths);
  const base = cents(body.baseAmountCents);
  const discountType = ["none", "fixed", "percent"].includes(String(body.discountType))
    ? String(body.discountType)
    : "none";
  const rawDiscountValue = cents(body.discountValue);
  const discountValue = discountType === "none" ? 0 : rawDiscountValue;
  const installmentCount = Number(body.installmentCount ?? 1);

  if (
    !name ||
    !Number.isInteger(durationMonths) ||
    durationMonths < 1 ||
    base === null ||
    base <= 0 ||
    !Number.isInteger(installmentCount) ||
    installmentCount < 1
  ) {
    return { error: "Informe nome, duracao, valor e parcelas validos." };
  }
  if (discountType !== "none" && (discountValue === null || discountValue < 0)) {
    return { error: "Desconto nao pode ser negativo." };
  }
  if (discountType === "percent" && discountValue > 100) {
    return { error: "Desconto percentual invalido." };
  }
  if (discountType === "fixed" && discountValue >= base) {
    return { error: "Desconto fixo deve ser menor que o valor do Combo." };
  }

  const final = finalAmount(base, discountType, discountValue);
  if (final <= 0) {
    return { error: "O valor final do Combo deve ser maior que zero." };
  }

  return {
    name,
    durationMonths,
    base,
    discountType,
    discountValue,
    final,
    installmentCount,
  };
}

export async function GET(request: Request) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Faca login para acessar os combos." }, { status: 401 });
  const rows = await getDb()
    .select({ combo: billingCombos, planName: billingPlans.name })
    .from(billingCombos)
    .leftJoin(
      billingPlans,
      and(
        eq(billingPlans.id, billingCombos.basePlanId),
        eq(billingPlans.organizationId, billingCombos.organizationId),
      ),
    )
    .where(eq(billingCombos.organizationId, context.membership.organizationId))
    .orderBy(desc(billingCombos.createdAt));
  return Response.json({ combos: rows.map(({ combo, planName }) => ({ ...combo, planName })) });
}

export async function POST(request: Request) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Faca login para criar combos." }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  const parsed = validateCombo(body);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const now = new Date();
  const [row] = await getDb()
    .insert(billingCombos)
    .values({
      id: crypto.randomUUID(),
      organizationId: context.membership.organizationId,
      name: parsed.name,
      comboType: String(body.comboType ?? "custom"),
      durationMonths: parsed.durationMonths,
      description: body.description ? String(body.description) : null,
      basePlanId: body.basePlanId ? String(body.basePlanId) : null,
      baseAmountCents: parsed.base,
      discountType: parsed.discountType as "none" | "fixed" | "percent",
      discountValue: parsed.discountValue,
      finalAmountCents: parsed.final,
      billingMode: body.billingMode === "upfront" ? "upfront" : "installments",
      installmentCount: parsed.installmentCount,
      active: body.active !== false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return Response.json({ combo: row }, { status: 201 });
}
