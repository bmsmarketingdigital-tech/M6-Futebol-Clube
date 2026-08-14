import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../../db/postgres";
import { expenses } from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";

export const dynamic = "force-dynamic";

const methods = new Set(["cash", "pix", "card", "bank", "other"]);

type PaymentMethod = "cash" | "pix" | "card" | "bank" | "other";

type ExpenseActionPayload = {
  action?: "pay" | "cancel" | "restore" | "reverse";
  paymentMethod?: PaymentMethod;
  notes?: string;
  scope?: "single" | "remaining";
};

type PostgresExpenseCurrent = {
  id: string;
  due_date: string;
  status: "open" | "paid" | "overdue" | "cancelled";
  notes: string | null;
  installment_group_id: string | null;
  installment_number: number;
  installment_count: number;
};

function appendAuditNote(currentNotes: string | null, label: string, reason: string, now: Date) {
  const timestamp = now.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  return [currentNotes?.trim(), `[${timestamp}] ${label}${reason ? `: ${reason}` : ""}`]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1000);
}

async function patchPostgresExpense(
  organizationId: string,
  id: string,
  payload: ExpenseActionPayload,
) {
  const sql = getPostgresClient();
  const [current] = await sql<PostgresExpenseCurrent[]>`
    SELECT id, due_date, status, notes, installment_group_id,
           installment_number, installment_count
    FROM expenses
    WHERE id = ${id}
      AND organization_id = ${organizationId}
    LIMIT 1
  `;
  if (!current) {
    return Response.json({ error: "Despesa não encontrada." }, { status: 404 });
  }

  const now = new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const today = now.toISOString().slice(0, 10);
  const reason = payload.notes?.trim().slice(0, 220) || "";
  const audit = (label: string) => appendAuditNote(current.notes, label, reason, now);

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
    const paid = await sql<{ id: string }[]>`
      UPDATE expenses
      SET status = 'paid',
          paid_at = ${nowSeconds},
          payment_method = ${paymentMethod},
          notes = ${audit("Despesa paga")},
          updated_at = ${nowSeconds}
      WHERE id = ${id}
        AND organization_id = ${organizationId}
        AND status IN ('open', 'overdue')
      RETURNING id
    `;
    if (paid.length === 0) {
      return Response.json({ error: "A despesa foi alterada por outra operação." }, { status: 409 });
    }
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
    const reversed = await sql<{ id: string }[]>`
      UPDATE expenses
      SET status = ${current.due_date < today ? "overdue" : "open"},
          paid_at = NULL,
          payment_method = NULL,
          notes = ${audit("Baixa da despesa estornada")},
          updated_at = ${nowSeconds}
      WHERE id = ${id}
        AND organization_id = ${organizationId}
        AND status = 'paid'
      RETURNING id
    `;
    if (reversed.length === 0) {
      return Response.json({ error: "A despesa foi alterada por outra operação." }, { status: 409 });
    }
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
      Boolean(current.installment_group_id) &&
      current.installment_count > 1;
    const note = audit(
      cancelRemaining
        ? `Parcelas ${current.installment_number} a ${current.installment_count} canceladas`
        : "Despesa cancelada",
    );
    const cancelled = cancelRemaining
      ? await sql<{ id: string }[]>`
          UPDATE expenses
          SET status = 'cancelled',
              paid_at = NULL,
              payment_method = NULL,
              notes = ${note},
              updated_at = ${nowSeconds}
          WHERE organization_id = ${organizationId}
            AND installment_group_id = ${current.installment_group_id}
            AND installment_number >= ${current.installment_number}
            AND status IN ('open', 'overdue')
          RETURNING id
        `
      : await sql<{ id: string }[]>`
          UPDATE expenses
          SET status = 'cancelled',
              paid_at = NULL,
              payment_method = NULL,
              notes = ${note},
              updated_at = ${nowSeconds}
          WHERE id = ${id}
            AND organization_id = ${organizationId}
          RETURNING id
        `;
    if (cancelled.length === 0) {
      return Response.json({ error: "A despesa foi alterada por outra operação." }, { status: 409 });
    }
  } else if (payload.action === "restore") {
    if (current.status !== "cancelled") {
      return Response.json(
        { error: "Somente despesas canceladas podem ser reativadas." },
        { status: 409 },
      );
    }
    const restored = await sql<{ id: string }[]>`
      UPDATE expenses
      SET status = ${current.due_date < today ? "overdue" : "open"},
          notes = ${audit("Despesa reativada")},
          updated_at = ${nowSeconds}
      WHERE id = ${id}
        AND organization_id = ${organizationId}
        AND status = 'cancelled'
      RETURNING id
    `;
    if (restored.length === 0) {
      return Response.json({ error: "A despesa foi alterada por outra operação." }, { status: 409 });
    }
  } else {
    return Response.json({ error: "Ação inválida." }, { status: 400 });
  }

  return Response.json({ updated: true });
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
    const payload = (await request.json()) as ExpenseActionPayload;
    const organizationId = context.membership.organizationId;

    if (postgresConfigured()) {
      return patchPostgresExpense(organizationId, id, payload);
    }

    const db = getDb();
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
    const audit = (label: string) => appendAuditNote(current.notes, label, reason, now);

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
      const [paid] = await db
        .update(expenses)
        .set({
          status: "paid",
          paidAt: now,
          paymentMethod,
          notes: audit("Despesa paga"),
          updatedAt: now,
        })
        .where(
          and(
            eq(expenses.id, id),
            eq(expenses.organizationId, organizationId),
            inArray(expenses.status, ["open", "overdue"]),
          ),
        )
        .returning({ id: expenses.id });
      if (!paid) {
        return Response.json({ error: "A despesa foi alterada por outra operação." }, { status: 409 });
      }
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
      const [reversed] = await db
        .update(expenses)
        .set({
          status:
            current.dueDate < now.toISOString().slice(0, 10) ? "overdue" : "open",
          paidAt: null,
          paymentMethod: null,
          notes: audit("Baixa da despesa estornada"),
          updatedAt: now,
        })
        .where(
          and(
            eq(expenses.id, id),
            eq(expenses.organizationId, organizationId),
            eq(expenses.status, "paid"),
          ),
        )
        .returning({ id: expenses.id });
      if (!reversed) {
        return Response.json({ error: "A despesa foi alterada por outra operação." }, { status: 409 });
      }
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
      const cancelled = await db
        .update(expenses)
        .set({
          status: "cancelled",
          paidAt: null,
          paymentMethod: null,
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
        )
        .returning({ id: expenses.id });
      if (cancelled.length === 0) {
        return Response.json({ error: "A despesa foi alterada por outra operação." }, { status: 409 });
      }
    } else if (payload.action === "restore") {
      if (current.status !== "cancelled") {
        return Response.json(
          { error: "Somente despesas canceladas podem ser reativadas." },
          { status: 409 },
        );
      }
      const [restored] = await db
        .update(expenses)
        .set({
          status:
            current.dueDate < now.toISOString().slice(0, 10) ? "overdue" : "open",
          notes: audit("Despesa reativada"),
          updatedAt: now,
        })
        .where(
          and(
            eq(expenses.id, id),
            eq(expenses.organizationId, organizationId),
            eq(expenses.status, "cancelled"),
          ),
        )
        .returning({ id: expenses.id });
      if (!restored) {
        return Response.json({ error: "A despesa foi alterada por outra operação." }, { status: 409 });
      }
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
