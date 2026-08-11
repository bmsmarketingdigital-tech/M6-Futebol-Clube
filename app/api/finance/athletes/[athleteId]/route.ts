import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
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
    const [billing] = await db
      .insert(athleteBilling)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        athleteId,
        planId: payload.planId,
        discountType,
        discountValue,
        customDueDay,
        active: payload.active ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: athleteBilling.athleteId,
        set: {
          planId: payload.planId,
          discountType,
          discountValue,
          customDueDay,
          active: payload.active ?? true,
          updatedAt: now,
        },
      })
      .returning();

    return Response.json({ billing });
  } catch (error) {
    console.error("Failed to save athlete billing", error);
    return Response.json(
      { error: "Não foi possível salvar a configuração." },
      { status: 500 },
    );
  }
}
