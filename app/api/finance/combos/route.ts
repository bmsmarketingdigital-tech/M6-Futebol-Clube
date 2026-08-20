import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../db/postgres";
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
  const organizationId = context.membership.organizationId;

  if (postgresConfigured()) {
    const sql = getPostgresClient();
    const rows = await sql`
      SELECT c.*, p.name AS plan_name
      FROM billing_combos c
      LEFT JOIN billing_plans p
        ON p.id = c.base_plan_id AND p.organization_id = c.organization_id
      WHERE c.organization_id = ${organizationId}
      ORDER BY c.created_at DESC
    `;
    return Response.json({
      combos: rows.map((row) => ({
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
        planName: row.plan_name,
      })),
    });
  }

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
    .where(eq(billingCombos.organizationId, organizationId))
    .orderBy(desc(billingCombos.createdAt));
  return Response.json({ combos: rows.map(({ combo, planName }) => ({ ...combo, planName })) });
}

export async function POST(request: Request) {
  const context = await getApiContext(request);
  if (!context) return Response.json({ error: "Faca login para criar combos." }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  const parsed = validateCombo(body);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const organizationId = context.membership.organizationId;
  const id = crypto.randomUUID();
  const comboType = String(body.comboType ?? "custom");
  const description = body.description ? String(body.description) : null;
  const basePlanId = body.basePlanId ? String(body.basePlanId) : null;
  const billingMode = body.billingMode === "upfront" ? "upfront" : "installments";
  const active = body.active !== false;

  if (postgresConfigured()) {
    const sql = getPostgresClient();
    const now = Math.floor(Date.now() / 1000);
    const [row] = await sql`
      INSERT INTO billing_combos (
        id, organization_id, name, combo_type, duration_months, description,
        base_plan_id, base_amount_cents, discount_type, discount_value,
        final_amount_cents, billing_mode, installment_count, active,
        created_at, updated_at
      ) VALUES (
        ${id}, ${organizationId}, ${parsed.name}, ${comboType}, ${parsed.durationMonths},
        ${description}, ${basePlanId}, ${parsed.base}, ${parsed.discountType},
        ${parsed.discountValue}, ${parsed.final}, ${billingMode}, ${parsed.installmentCount},
        ${active ? 1 : 0}, ${now}, ${now}
      )
      RETURNING *
    `;
    return Response.json(
      {
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
      },
      { status: 201 },
    );
  }

  const now = new Date();
  const [row] = await getDb()
    .insert(billingCombos)
    .values({
      id,
      organizationId,
      name: parsed.name,
      comboType,
      durationMonths: parsed.durationMonths,
      description,
      basePlanId,
      baseAmountCents: parsed.base,
      discountType: parsed.discountType as "none" | "fixed" | "percent",
      discountValue: parsed.discountValue,
      finalAmountCents: parsed.final,
      billingMode,
      installmentCount: parsed.installmentCount,
      active,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return Response.json({ combo: row }, { status: 201 });
}
