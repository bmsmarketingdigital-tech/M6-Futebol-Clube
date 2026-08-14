import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../../db/postgres";
import { payments } from "../../../../../db/schema";
import { getApiContext } from "../../../api-auth";
import { refreshAthleteFinancialStatus } from "../../debt-status";
import { parseMoneyToCents } from "../../finance-utils";
import { findLatestReversibleTransaction, recordPaymentTransaction } from "../../payment-transactions";

export const dynamic = "force-dynamic";

const methods = new Set(["cash", "pix", "card", "bank", "other"]);
const methodLabels: Record<string, string> = {
  cash: "Dinheiro",
  pix: "PIX",
  card: "Cartão",
  bank: "Transferência",
  other: "Outro",
};

type ChargeCurrent = {
  id: string;
  organizationId: string;
  athleteId: string;
  amountCents: number;
  dueDate: string;
  paidAmountCents: number | null;
  paymentMethod: "cash" | "pix" | "card" | "bank" | "other" | null;
  status: "open" | "paid" | "partial" | "overdue" | "cancelled";
  notes: string | null;
};

function formatCents(cents: number) {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
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
      paidAmount?: unknown;
      refundAmount?: unknown;
      idempotencyKey?: string;
      notes?: string;
    };
    const organizationId = context.membership.organizationId;
    let current: ChargeCurrent | null = null;
    const usePostgres = postgresConfigured();
    if (usePostgres) {
      const sql = getPostgresClient();
      const [row] = await sql<ChargeCurrent[]>`
        SELECT id,
               organization_id AS "organizationId",
               athlete_id AS "athleteId",
               amount_cents AS "amountCents",
               due_date AS "dueDate",
               paid_amount_cents AS "paidAmountCents",
               payment_method AS "paymentMethod",
               status,
               notes
        FROM payments
        WHERE id = ${id}
          AND organization_id = ${organizationId}
        LIMIT 1
      `;
      current = row ?? null;
    } else {
      const db = getDb();
      const [row] = await db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.id, id),
            eq(payments.organizationId, organizationId),
          ),
        )
        .limit(1);
      current = row ?? null;
    }
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

    if (payload.idempotencyKey?.trim() && (payload.action === "pay" || payload.action === "reverse")) {
      const prefix = payload.action === "pay" ? "manual:payment" : "manual:refund";
      const transactionKey = `${prefix}:${id}:${payload.idempotencyKey.trim()}`;
      const existingTransaction = usePostgres
        ? (await getPostgresClient()<{ id: string }[]>`
            SELECT id
            FROM payment_transactions
            WHERE payment_id = ${id}
              AND idempotency_key = ${transactionKey}
            LIMIT 1
          `)[0]
        : await getD1().prepare(
            "SELECT id FROM payment_transactions WHERE payment_id=? AND idempotency_key=?",
          ).bind(id, transactionKey).first<{ id: string }>();
      if (existingTransaction) return Response.json({ updated: true, idempotent: true });
    }

    if (payload.action === "pay") {
      if (
        current.status !== "open" &&
        current.status !== "overdue" &&
        current.status !== "partial"
      ) {
        return Response.json(
          { error: "Somente cobranças em aberto podem receber baixa." },
          { status: 409 },
        );
      }
      const paymentMethod = payload.paymentMethod ?? "pix";
      if (!methods.has(paymentMethod)) {
        return Response.json({ error: "Forma de pagamento inválida." }, { status: 400 });
      }
      const alreadyPaidCents = current.paidAmountCents ?? 0;
      const remainingCents = current.amountCents - alreadyPaidCents;
      const incomingCents =
        payload.paidAmount == null
          ? remainingCents
          : parseMoneyToCents(payload.paidAmount);
      if (incomingCents === null || incomingCents <= 0) {
        return Response.json({ error: "Valor recebido inválido." }, { status: 400 });
      }
      if (incomingCents > remainingCents) {
        return Response.json(
          {
            error: `Valor maior que o saldo devido (${formatCents(remainingCents)}).`,
          },
          { status: 400 },
        );
      }
      if (!payload.idempotencyKey?.trim()) {
        return Response.json({ error: "Chave de idempotência obrigatória." }, { status: 400 });
      }
      const auditNote =
        `Baixa de ${formatCents(incomingCents)} via ${methodLabels[paymentMethod]}`;
      await recordPaymentTransaction({
        paymentId: id, type: "payment", amountCents: incomingCents, paymentMethod,
        origin: "manual", createdBy: context.user.email,
        idempotencyKey: `manual:payment:${id}:${payload.idempotencyKey.trim()}`,
        note: `${auditNote}${reason ? `: ${reason}` : ""}`,
      });
    } else if (payload.action === "cancel") {
      if (current.status !== "open" && current.status !== "overdue") {
        return Response.json(
          { error: "Estorne a baixa antes de cancelar uma cobrança com pagamento registrado." },
          { status: 409 },
        );
      }
      if (!reason) {
        return Response.json(
          { error: "Informe o motivo do cancelamento." },
          { status: 400 },
        );
      }
      if (usePostgres) {
        await getPostgresClient()`
          UPDATE payments
          SET status = 'cancelled',
              notes = ${appendAuditNote("Lançamento cancelado")},
              updated_at = ${Math.floor(now.getTime() / 1000)}
          WHERE id = ${id}
            AND organization_id = ${organizationId}
        `;
      } else {
        const db = getDb();
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
      }
    } else if (payload.action === "reverse") {
      if (current.status !== "paid" && current.status !== "partial") {
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
      if (!payload.idempotencyKey?.trim()) {
        return Response.json({ error: "Chave de idempotência obrigatória." }, { status: 400 });
      }
      const original = await findLatestReversibleTransaction(id);
      if (!original) return Response.json({ error: "Não existe transação reversível." }, { status: 409 });
      const refundCents = payload.refundAmount == null
        ? Math.min(current.paidAmountCents ?? 0, original.reversibleCents)
        : parseMoneyToCents(payload.refundAmount);
      if (refundCents === null || refundCents <= 0) {
        return Response.json({ error: "Valor do estorno inválido." }, { status: 400 });
      }
      await recordPaymentTransaction({
        paymentId: id, type: "refund", amountCents: refundCents,
        origin: "manual", createdBy: context.user.email,
        reversesTransactionId: original.id,
        idempotencyKey: `manual:refund:${id}:${payload.idempotencyKey.trim()}`,
        note: `Estorno de ${formatCents(refundCents)}: ${reason}`,
      });
    } else if (payload.action === "restore") {
      if (current.status !== "cancelled") {
        return Response.json(
          { error: "Somente lançamentos cancelados podem ser reativados." },
          { status: 409 },
        );
      }
      if (usePostgres) {
        const restored = await getPostgresClient()<{ id: string }[]>`
          UPDATE payments
          SET status = ${reopenedStatus},
              notes = ${appendAuditNote("Lançamento reativado")},
              updated_at = ${Math.floor(now.getTime() / 1000)}
          WHERE id = ${id}
            AND organization_id = ${organizationId}
            AND status = 'cancelled'
          RETURNING id
        `;
        if (restored.length === 0) {
          return Response.json({ error: "A cobrança foi alterada por outra operação." }, { status: 409 });
        }
      } else {
        const db = getDb();
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
      }
    } else {
      return Response.json({ error: "Ação inválida." }, { status: 400 });
    }

    if (payload.action === "cancel" || payload.action === "restore") {
      await refreshAthleteFinancialStatus(organizationId, current.athleteId);
    }
    return Response.json({ updated: true });
  } catch (error) {
    console.error("Failed to update charge", error);
    return Response.json(
      { error: "Não foi possível atualizar a cobrança." },
      { status: 500 },
    );
  }
}
