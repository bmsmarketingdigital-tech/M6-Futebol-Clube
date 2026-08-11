import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import { athleteBilling, athletes, billingPlans } from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";
import { parseMoneyToCents } from "../../finance-utils";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ athleteId: string }> },
) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }
    const { athleteId } = await params;
    const payload = (await request.json()) as {
      planId?: string;
      discountType?: "none" | "fixed" | "percent";
      discountValue?: unknown;
      customDueDay?: number | null;
      active?: boolean;
    };
    const discountType = payload.discountType ?? "none";
    const discountValue = discountType === "fixed"
      ? parseMoneyToCents(payload.discountValue ?? 0)
      : Number(payload.discountValue ?? 0);
    const customDueDay =
      payload.customDueDay == null || payload.customDueDay === 0
        ? null
        : Number(payload.customDueDay);

    if (!payload.planId) {
      return Response.json({ error: "Selecione um plano." }, { status: 400 });
    }
    if (!["none", "fixed", "percent"].includes(discountType)) {
      return Response.json({ error: "Tipo de desconto inválido." }, { status: 400 });
    }
    if (discountValue === null || !Number.isInteger(discountValue) || discountValue < 0) {
      return Response.json({ error: "Valor do desconto invÃ¡lido." }, { status: 400 });
    }
    if (discountType === "percent" && discountValue > 100) {
      return Response.json({ error: "O desconto percentual não pode superar 100%." }, { status: 400 });
    }
    if (customDueDay !== null && (!Number.isInteger(customDueDay) || customDueDay < 1 || customDueDay > 28)) {
      return Response.json({ error: "O vencimento deve estar entre os dias 1 e 28." }, { status: 400 });
    }

    const db = getDb();
    const organizationId = context.membership.organizationId;
    const [[athlete], [plan]] = await Promise.all([
      db.select({ id: athletes.id }).from(athletes).where(and(eq(athletes.id, athleteId), eq(athletes.organizationId, organizationId), eq(athletes.active, true))).limit(1),
      db.select({ id: billingPlans.id }).from(billingPlans).where(and(eq(billingPlans.id, payload.planId), eq(billingPlans.organizationId, organizationId), eq(billingPlans.active, true))).limit(1),
    ]);
    if (!athlete || !plan) {
      return Response.json({ error: "Atleta ou plano não encontrado." }, { status: 404 });
    }

    const now = new Date();
    const timestamp = Math.floor(now.getTime() / 1000);
    const billingId = crypto.randomUUID();
    const result = await getD1().batch([
      getD1().prepare(`INSERT INTO athlete_billing
        (id, organization_id, athlete_id, plan_id, discount_type, discount_value,
         custom_due_day, active, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM athletes a JOIN billing_plans p ON p.organization_id = a.organization_id
          WHERE a.id = ? AND a.organization_id = ? AND a.active = 1
            AND p.id = ? AND p.organization_id = ? AND p.active = 1
        )
        ON CONFLICT(athlete_id) DO UPDATE SET
          organization_id = excluded.organization_id, plan_id = excluded.plan_id,
          discount_type = excluded.discount_type, discount_value = excluded.discount_value,
          custom_due_day = excluded.custom_due_day, active = excluded.active,
          updated_at = excluded.updated_at`).bind(
        billingId, organizationId, athleteId, payload.planId, discountType,
        discountValue, customDueDay, payload.active ?? true ? 1 : 0,
        timestamp, timestamp, athleteId, organizationId, payload.planId, organizationId,
      ),
    ]);
    if ((result[0].meta.changes ?? 0) === 0) {
      return Response.json({ error: "Atleta ou plano não encontrado, inativo ou incompatível." }, { status: 404 });
    }
    const [billing] = await db.select().from(athleteBilling).where(
      and(eq(athleteBilling.athleteId, athleteId), eq(athleteBilling.organizationId, organizationId)),
    ).limit(1);
    if (!billing) throw new Error("A configuração criada não pôde ser carregada.");

    return Response.json({ billing });
  } catch (error) {
    console.error("Failed to save athlete billing", error);
    return Response.json(
      { error: "Não foi possível salvar a configuração." },
      { status: 500 },
    );
  }
}
