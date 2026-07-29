import { and, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { athletes, payments } from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";

export const dynamic = "force-dynamic";

const methods = new Set(["cash", "pix", "card", "bank", "other"]);

async function refreshAthleteStatus(
  organizationId: string,
  athleteId: string,
) {
  const db = getDb();
  const [outstanding] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.organizationId, organizationId),
        eq(payments.athleteId, athleteId),
        inArray(payments.status, ["open", "overdue"]),
      ),
    )
    .limit(1);
  await db
    .update(athletes)
    .set({
      financialStatus: outstanding ? "pending" : "paid",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(athletes.id, athleteId),
        eq(athletes.organizationId, organizationId),
      ),
    );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await getApiContext(request);
    if (!context) {
      return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
    }
    const { id } = await params;
    const payload = (await request.json()) as {
      action?: "pay" | "cancel";
      paymentMethod?: "cash" | "pix" | "card" | "bank" | "other";
      paidAmount?: number;
      notes?: string;
    };
    const db = getDb();
    const organizationId = context.membership.organizationId;
    const [current] = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.id, id),
          eq(payments.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!current) {
      return Response.json({ error: "Cobrança não encontrada." }, { status: 404 });
    }
    if (current.status === "paid" || current.status === "cancelled") {
      return Response.json({ error: "Esta cobrança já foi finalizada." }, { status: 409 });
    }

    const now = new Date();
    if (payload.action === "pay") {
      const paymentMethod = payload.paymentMethod ?? "pix";
      if (!methods.has(paymentMethod)) {
        return Response.json({ error: "Forma de pagamento inválida." }, { status: 400 });
      }
      const paidAmountCents =
        payload.paidAmount == null
          ? current.amountCents
          : Math.round(Number(payload.paidAmount) * 100);
      if (!Number.isInteger(paidAmountCents) || paidAmountCents < 0) {
        return Response.json({ error: "Valor recebido inválido." }, { status: 400 });
      }
      await db
        .update(payments)
        .set({
          status: "paid",
          paidAt: now,
          paidAmountCents,
          paymentMethod,
          notes: payload.notes?.trim().slice(0, 300) || null,
          updatedAt: now,
        })
        .where(
          and(
            eq(payments.id, id),
            eq(payments.organizationId, organizationId),
            ne(payments.status, "paid"),
          ),
        );
    } else if (payload.action === "cancel") {
      await db
        .update(payments)
        .set({
          status: "cancelled",
          notes: payload.notes?.trim().slice(0, 300) || current.notes,
          updatedAt: now,
        })
        .where(
          and(
            eq(payments.id, id),
            eq(payments.organizationId, organizationId),
          ),
        );
    } else {
      return Response.json({ error: "Ação inválida." }, { status: 400 });
    }

    await refreshAthleteStatus(organizationId, current.athleteId);
    return Response.json({ updated: true });
  } catch (error) {
    console.error("Failed to update charge", error);
    return Response.json(
      { error: "Não foi possível atualizar a cobrança." },
      { status: 500 },
    );
  }
}
