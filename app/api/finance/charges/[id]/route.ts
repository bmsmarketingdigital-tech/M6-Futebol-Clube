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
      action?: "pay" | "cancel" | "reverse" | "restore";
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

    const now = new Date();
    const reason = payload.notes?.trim().slice(0, 220) || "";
    const appendAuditNote = (label: string) => {
      const timestamp = now.toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
      });
      const event = `[${timestamp}] ${label}${reason ? `: ${reason}` : ""}`;
      return [current.notes?.trim(), event].filter(Boolean).join("\n").slice(0, 1000);
    };
    const reopenedStatus =
      current.dueDate < now.toISOString().slice(0, 10) ? "overdue" : "open";

    if (payload.action === "pay") {
      if (current.status !== "open" && current.status !== "overdue") {
        return Response.json(
          { error: "Somente cobranças em aberto podem receber baixa." },
          { status: 409 },
        );
      }
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
          notes: reason || null,
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
      if (current.status !== "open" && current.status !== "overdue") {
        return Response.json(
          { error: "Estorne a baixa antes de cancelar uma cobrança paga." },
          { status: 409 },
        );
      }
      if (!reason) {
        return Response.json(
          { error: "Informe o motivo do cancelamento." },
          { status: 400 },
        );
      }
      await db
        .update(payments)
        .set({
          status: "cancelled",
          notes: appendAuditNote("Lançamento cancelado"),
          updatedAt: now,
        })
        .where(
          and(
            eq(payments.id, id),
            eq(payments.organizationId, organizationId),
          ),
        );
    } else if (payload.action === "reverse") {
      if (current.status !== "paid") {
        return Response.json(
          { error: "Somente pagamentos baixados podem ser estornados." },
          { status: 409 },
        );
      }
      if (!reason) {
        return Response.json(
          { error: "Informe o motivo do estorno." },
          { status: 400 },
        );
      }
      await db
        .update(payments)
        .set({
          status: reopenedStatus,
          paidAt: null,
          paidAmountCents: null,
          paymentMethod: null,
          notes: appendAuditNote("Baixa estornada"),
          updatedAt: now,
        })
        .where(
          and(
            eq(payments.id, id),
            eq(payments.organizationId, organizationId),
            eq(payments.status, "paid"),
          ),
        );
    } else if (payload.action === "restore") {
      if (current.status !== "cancelled") {
        return Response.json(
          { error: "Somente lançamentos cancelados podem ser reativados." },
          { status: 409 },
        );
      }
      await db
        .update(payments)
        .set({
          status: reopenedStatus,
          notes: appendAuditNote("Lançamento reativado"),
          updatedAt: now,
        })
        .where(
          and(
            eq(payments.id, id),
            eq(payments.organizationId, organizationId),
            eq(payments.status, "cancelled"),
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
