import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { expenses } from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";

export const dynamic = "force-dynamic";

const methods = new Set(["cash", "pix", "card", "bank", "other"]);

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
      action?: "pay" | "cancel" | "restore" | "reverse";
      paymentMethod?: "cash" | "pix" | "card" | "bank" | "other";
      notes?: string;
      scope?: "single" | "remaining";
    };
    const db = getDb();
    const organizationId = context.membership.organizationId;
    const [current] = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.organizationId, organizationId)))
      .limit(1);
    if (!current) {
      return Response.json({ error: "Despesa não encontrada." }, { status: 404 });
    }

    const now = new Date();
    const reason = payload.notes?.trim().slice(0, 220) || "";
    const audit = (label: string) => {
      const timestamp = now.toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
      });
      return [current.notes?.trim(), `[${timestamp}] ${label}${reason ? `: ${reason}` : ""}`]
        .filter(Boolean)
        .join("\n")
        .slice(0, 1000);
    };

    if (payload.action === "pay") {
      if (current.status !== "open" && current.status !== "overdue") {
        return Response.json(
          { error: "Somente despesas pendentes podem receber baixa." },
          { status: 409 },
        );
      }
      const paymentMethod = payload.paymentMethod ?? "pix";
      if (!methods.has(paymentMethod)) {
        return Response.json({ error: "Forma de pagamento inválida." }, { status: 400 });
      }
      await db
        .update(expenses)
        .set({
          status: "paid",
          paidAt: now,
          paymentMethod,
          notes: audit("Despesa paga"),
          updatedAt: now,
        })
        .where(and(eq(expenses.id, id), eq(expenses.organizationId, organizationId)));
    } else if (payload.action === "reverse") {
      if (current.status !== "paid") {
        return Response.json(
          { error: "Somente despesas pagas podem ter a baixa estornada." },
          { status: 409 },
        );
      }
      if (!reason) {
        return Response.json({ error: "Informe o motivo do estorno." }, { status: 400 });
      }
      await db
        .update(expenses)
        .set({
          status:
            current.dueDate < now.toISOString().slice(0, 10) ? "overdue" : "open",
          paidAt: null,
          paymentMethod: null,
          notes: audit("Baixa da despesa estornada"),
          updatedAt: now,
        })
        .where(and(eq(expenses.id, id), eq(expenses.organizationId, organizationId)));
    } else if (payload.action === "cancel") {
      if (current.status === "paid") {
        return Response.json(
          { error: "Uma despesa paga não pode ser cancelada sem estorno contábil." },
          { status: 409 },
        );
      }
      if (!reason) {
        return Response.json({ error: "Informe o motivo do cancelamento." }, { status: 400 });
      }
      const cancelRemaining =
        payload.scope === "remaining" &&
        Boolean(current.installmentGroupId) &&
        current.installmentCount > 1;
      await db
        .update(expenses)
        .set({
          status: "cancelled",
          notes: audit(
            cancelRemaining
              ? `Parcelas ${current.installmentNumber} a ${current.installmentCount} canceladas`
              : "Despesa cancelada",
          ),
          updatedAt: now,
        })
        .where(
          cancelRemaining
            ? and(
                eq(expenses.organizationId, organizationId),
                eq(expenses.installmentGroupId, current.installmentGroupId!),
                gte(expenses.installmentNumber, current.installmentNumber),
                inArray(expenses.status, ["open", "overdue"]),
              )
            : and(eq(expenses.id, id), eq(expenses.organizationId, organizationId)),
        );
    } else if (payload.action === "restore") {
      if (current.status !== "cancelled") {
        return Response.json(
          { error: "Somente despesas canceladas podem ser reativadas." },
          { status: 409 },
        );
      }
      await db
        .update(expenses)
        .set({
          status:
            current.dueDate < now.toISOString().slice(0, 10) ? "overdue" : "open",
          notes: audit("Despesa reativada"),
          updatedAt: now,
        })
        .where(and(eq(expenses.id, id), eq(expenses.organizationId, organizationId)));
    } else {
      return Response.json({ error: "Ação inválida." }, { status: 400 });
    }

    return Response.json({ updated: true });
  } catch (error) {
    console.error("Failed to update expense", error);
    return Response.json(
      { error: "Não foi possível atualizar a despesa." },
      { status: 500 },
    );
  }
}
