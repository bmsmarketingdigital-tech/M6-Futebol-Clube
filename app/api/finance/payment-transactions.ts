import { getD1 } from "../../../db";

export type PaymentTransactionInput = {
  paymentId: string;
  type: "payment" | "refund";
  amountCents: number;
  paymentMethod?: "cash" | "pix" | "card" | "bank" | "other" | null;
  origin: "manual" | "asaas" | "system";
  occurredAt?: number;
  createdBy?: string | null;
  externalTransactionId?: string | null;
  reversesTransactionId?: string | null;
  idempotencyKey: string;
  note?: string | null;
};

export async function recordPaymentTransaction(input: PaymentTransactionInput) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Valor da transação financeira inválido.");
  }
  if (!input.idempotencyKey.trim()) {
    throw new Error("Chave de idempotência financeira obrigatória.");
  }
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  const created = await getD1().prepare(`INSERT OR IGNORE INTO payment_transactions (
      id,payment_id,type,amount_cents,payment_method,origin,occurred_at,created_by,
      external_transaction_id,reverses_transaction_id,idempotency_key,note,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`)
    .bind(
      id, input.paymentId, input.type, input.amountCents, input.paymentMethod ?? null,
      input.origin, input.occurredAt ?? now, input.createdBy ?? null,
      input.externalTransactionId ?? null, input.reversesTransactionId ?? null,
      input.idempotencyKey.trim(), input.note?.trim().slice(0, 500) || null, now,
    ).first<{ id: string }>();
  if (created) return { id: created.id, created: true };
  const existing = await getD1().prepare(`SELECT id FROM payment_transactions WHERE idempotency_key=?`)
    .bind(input.idempotencyKey.trim()).first<{ id: string }>();
  if (!existing) throw new Error("A transação financeira não pôde ser registrada.");
  return { id: existing.id, created: false };
}

export async function findLatestReversibleTransaction(paymentId: string) {
  return getD1().prepare(`SELECT t.id, t.amount_cents AS amountCents,
      t.amount_cents-COALESCE((SELECT SUM(r.amount_cents) FROM payment_transactions r
        WHERE r.type='refund' AND r.reverses_transaction_id=t.id),0) AS reversibleCents
    FROM payment_transactions t
    WHERE t.payment_id=? AND t.type IN ('payment','opening_balance')
      AND t.amount_cents>COALESCE((SELECT SUM(r.amount_cents) FROM payment_transactions r
        WHERE r.type='refund' AND r.reverses_transaction_id=t.id),0)
    ORDER BY t.occurred_at DESC,t.created_at DESC,t.id DESC LIMIT 1`)
    .bind(paymentId).first<{ id: string; amountCents: number; reversibleCents: number }>();
}
