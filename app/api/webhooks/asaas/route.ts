import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { getPostgresClient, postgresConfigured } from "../../../../db/postgres";
import { payments } from "../../../../db/schema";
import { validWebhookToken } from "../../finance/asaas";
import { refreshAthleteFinancialStatus } from "../../finance/debt-status";
import { findLatestReversibleTransaction, recordPaymentTransaction } from "../../finance/payment-transactions";

export const dynamic = "force-dynamic";

type WebhookPaymentRow = {
  id: string;
  organizationId: string;
  athleteId: string;
  amountCents: number;
  paidAmountCents: number | null;
  externalStatus: string | null;
};

async function loadPostgresPaymentByExternalId(externalPaymentId: string) {
  const sql = getPostgresClient();
  const [row] = await sql<{
    id: string;
    organization_id: string;
    athlete_id: string;
    amount_cents: number;
    paid_amount_cents: number | null;
    external_status: string | null;
  }[]>`
    SELECT id,
           organization_id,
           athlete_id,
           amount_cents,
           paid_amount_cents,
           external_status
    FROM payments
    WHERE external_payment_id = ${externalPaymentId}
    LIMIT 1
  `;
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    athleteId: row.athlete_id,
    amountCents: row.amount_cents,
    paidAmountCents: row.paid_amount_cents,
    externalStatus: row.external_status,
  } satisfies WebhookPaymentRow;
}

export async function POST(request: Request) {
  if (!validWebhookToken(request)) {
    return Response.json({ error: "Token inválido." }, { status: 401 });
  }
  const payload = (await request.json()) as {
    event?: string;
    payment?: { id?: string; status?: string; value?: number };
  };
  if (!payload.payment?.id) return Response.json({ received: true });

  const usePostgres = postgresConfigured();
  const db = usePostgres ? null : getDb();
  const current = usePostgres
    ? await loadPostgresPaymentByExternalId(payload.payment.id)
    : (await db!
        .select()
        .from(payments)
        .where(eq(payments.externalPaymentId, payload.payment.id))
        .limit(1))[0];
  if (!current) return Response.json({ received: true });

  const received = ["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"].includes(payload.event ?? "");
  const overdue = payload.event === "PAYMENT_OVERDUE";
  const deleted = payload.event === "PAYMENT_DELETED";
  const refunded = payload.event === "PAYMENT_REFUNDED";
  if (received) {
    const amountCents = Math.round((payload.payment.value ?? current.amountCents / 100) * 100);
    await recordPaymentTransaction({
      paymentId: current.id, type: "payment", amountCents,
      paymentMethod: "other", origin: "asaas",
      externalTransactionId: payload.payment.id,
      idempotencyKey: `asaas:payment:${payload.payment.id}:receipt`,
      note: `Recebimento confirmado pelo Asaas (${payload.event}).`,
    });
  }
  if (refunded && (current.paidAmountCents ?? 0) > 0) {
    const original = await findLatestReversibleTransaction(current.id);
    if (!original) throw new Error("Recebimento Asaas sem transação reversível correspondente.");
    await recordPaymentTransaction({
      paymentId: current.id, type: "refund",
      amountCents: Math.min(current.paidAmountCents ?? 0, original.reversibleCents),
      origin: "asaas", externalTransactionId: payload.payment.id,
      reversesTransactionId: original.id,
      idempotencyKey: `asaas:payment:${payload.payment.id}:refund`,
      note: "Estorno confirmado pelo Asaas.",
    });
  }
  const stateUpdate: { status?: "overdue" | "cancelled"; externalStatus: string | null; updatedAt: Date } = {
    externalStatus: payload.payment.status || payload.event || current.externalStatus || null,
    updatedAt: new Date(),
  };
  if (overdue) stateUpdate.status = "overdue";
  if (deleted && (current.paidAmountCents ?? 0) === 0) stateUpdate.status = "cancelled";
  if (usePostgres) {
    await getPostgresClient()`
      UPDATE payments
      SET status = COALESCE(${stateUpdate.status ?? null}, status),
          external_status = ${stateUpdate.externalStatus},
          updated_at = ${Math.floor(Date.now() / 1000)}
      WHERE id = ${current.id}
    `;
  } else {
    await db!.update(payments).set(stateUpdate).where(eq(payments.id, current.id));
  }
  if (stateUpdate.status) {
    // received/refunded already recompute athletes.financial_status atomically via
    // the payment_transactions_apply_insert trigger (fired by recordPaymentTransaction
    // above). overdue/deleted write payments.status directly, bypassing that trigger,
    // so the athlete's cached financial status would otherwise go stale.
    await refreshAthleteFinancialStatus(current.organizationId, current.athleteId);
  }
  return Response.json({ received: true });
}
