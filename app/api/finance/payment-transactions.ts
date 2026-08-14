import { getD1 } from "../../../db";
import { getPostgresClient, postgresConfigured } from "../../../db/postgres";

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
  if (postgresConfigured()) {
    const sql = getPostgresClient();
    const now = Math.floor(Date.now() / 1000);
    const id = crypto.randomUUID();
    const idempotencyKey = input.idempotencyKey.trim();
    const note = input.note?.trim().slice(0, 500) || null;

    return sql.begin(async (transaction) => {
      const [created] = await transaction<{ id: string; payment_id: string }[]>`
        INSERT INTO payment_transactions (
          id, payment_id, type, amount_cents, payment_method, origin,
          occurred_at, created_by, external_transaction_id, reverses_transaction_id,
          idempotency_key, note, created_at
        )
        SELECT ${id}, p.id, ${input.type}, ${input.amountCents},
               ${input.paymentMethod ?? null}, ${input.origin},
               ${input.occurredAt ?? now}, ${input.createdBy ?? null},
               ${input.externalTransactionId ?? null},
               ${input.reversesTransactionId ?? null},
               ${idempotencyKey}, ${note}, ${now}
        FROM payments p
        WHERE p.id = ${input.paymentId}
          AND (
            ${input.type} <> 'payment'
            OR (
              p.status IN ('open','overdue','partial')
              AND p.amount_cents - COALESCE(p.paid_amount_cents,0) >= ${input.amountCents}
            )
          )
          AND (
            ${input.type} <> 'refund'
            OR (
              COALESCE(p.paid_amount_cents,0) >= ${input.amountCents}
              AND EXISTS (
                SELECT 1
                FROM payment_transactions original
                WHERE original.id = ${input.reversesTransactionId ?? null}
                  AND original.payment_id = p.id
                  AND original.type IN ('payment','opening_balance')
                  AND original.amount_cents - COALESCE((
                    SELECT SUM(previous.amount_cents)
                    FROM payment_transactions previous
                    WHERE previous.type = 'refund'
                      AND previous.reverses_transaction_id = original.id
                  ), 0) >= ${input.amountCents}
              )
            )
          )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id, payment_id
      `;
      if (!created) {
        const [existing] = await transaction<{ id: string }[]>`
          SELECT id FROM payment_transactions WHERE idempotency_key = ${idempotencyKey}
        `;
        if (!existing) throw new Error("A transação financeira não pôde ser registrada.");
        return { id: existing.id, created: false };
      }

      if (input.type === "payment" || input.type === "refund") {
        const delta = input.type === "payment" ? input.amountCents : -input.amountCents;
        const [updatedPayment] = await transaction<{
          organization_id: string;
          athlete_id: string;
        }[]>`
          UPDATE payments
          SET paid_amount_cents = COALESCE(paid_amount_cents, 0) + ${delta},
              status = CASE
                WHEN COALESCE(paid_amount_cents, 0) + ${delta} = amount_cents THEN 'paid'
                WHEN COALESCE(paid_amount_cents, 0) + ${delta} > 0 THEN 'partial'
                WHEN due_date < to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') THEN 'overdue'
                ELSE 'open'
              END,
              paid_at = CASE
                WHEN ${input.type} = 'payment'
                  AND COALESCE(paid_amount_cents, 0) + ${delta} = amount_cents
                THEN ${input.occurredAt ?? now}
                WHEN ${input.type} = 'refund'
                  AND COALESCE(paid_amount_cents, 0) + ${delta} = 0
                THEN NULL
                ELSE paid_at
              END,
              payment_method = CASE
                WHEN ${input.type} = 'payment' THEN COALESCE(${input.paymentMethod ?? null}, payment_method)
                WHEN ${input.type} = 'refund'
                  AND COALESCE(paid_amount_cents, 0) + ${delta} = 0
                THEN NULL
                ELSE payment_method
              END,
              updated_at = ${now}
          WHERE id = ${input.paymentId}
          RETURNING organization_id, athlete_id
        `;
        if (!updatedPayment) throw new Error("A mensalidade não pôde ser atualizada.");
        await transaction`
          UPDATE athletes
          SET financial_status = CASE WHEN EXISTS (
                SELECT 1
                FROM payments debt
                WHERE debt.organization_id = ${updatedPayment.organization_id}
                  AND debt.athlete_id = ${updatedPayment.athlete_id}
                  AND debt.status IN ('open','overdue','partial')
                  AND debt.amount_cents - COALESCE(debt.paid_amount_cents,0) > 0
              )
              THEN 'pending'
              ELSE 'paid'
            END,
            updated_at = ${now}
          WHERE id = ${updatedPayment.athlete_id}
            AND organization_id = ${updatedPayment.organization_id}
        `;
      }

      return { id: created.id, created: true };
    });
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
  if (postgresConfigured()) {
    const sql = getPostgresClient();
    const [row] = await sql<{ id: string; amountCents: number; reversibleCents: number }[]>`
      SELECT t.id,
             t.amount_cents AS "amountCents",
             t.amount_cents - COALESCE((
               SELECT SUM(r.amount_cents)
               FROM payment_transactions r
               WHERE r.type = 'refund'
                 AND r.reverses_transaction_id = t.id
             ), 0) AS "reversibleCents"
      FROM payment_transactions t
      WHERE t.payment_id = ${paymentId}
        AND t.type IN ('payment','opening_balance')
        AND t.amount_cents > COALESCE((
          SELECT SUM(r.amount_cents)
          FROM payment_transactions r
          WHERE r.type = 'refund'
            AND r.reverses_transaction_id = t.id
        ), 0)
      ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
      LIMIT 1
    `;
    return row ?? null;
  }

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
