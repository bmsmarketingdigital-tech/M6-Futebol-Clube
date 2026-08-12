import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

// Auditoria pontual: webhooks/asaas/route.ts importava refreshAthleteFinancialStatus
// sem nunca chamá-lo (lint "unused"). Este arquivo prova, com o SQL real de
// db/payment-transaction-triggers.ts, que:
//   - PAYMENT_RECEIVED/PAYMENT_CONFIRMED e PAYMENT_REFUNDED passam por
//     recordPaymentTransaction() -> INSERT em payment_transactions -> a trigger
//     payment_transactions_apply_insert já recalcula payments E athletes.financial_status
//     atomicamente. Nenhum refresh manual era necessário nesses dois casos.
//   - PAYMENT_OVERDUE e PAYMENT_DELETED escrevem payments.status diretamente
//     (sem passar por payment_transactions), o que NÃO dispara a trigger — o
//     financial_status do atleta ficava obsoleto até algum outro evento financeiro
//     recalculá-lo. Essa era a lacuna real por trás do import "unused".

const triggerSource = readFileSync(
  new URL("../db/payment-transaction-triggers.ts", import.meta.url),
  "utf8",
);
const applyInsertTrigger = triggerSource.match(
  /`CREATE TRIGGER IF NOT EXISTS payment_transactions_apply_insert[\s\S]*?END`/,
)[0].slice(1, -1);

function financeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE athletes(id TEXT PRIMARY KEY, organization_id TEXT, financial_status TEXT, updated_at INTEGER);
    CREATE TABLE payments(id TEXT PRIMARY KEY, organization_id TEXT, athlete_id TEXT,
      amount_cents INTEGER, paid_amount_cents INTEGER, status TEXT, due_date TEXT,
      paid_at INTEGER, payment_method TEXT, notes TEXT, updated_at INTEGER);
    CREATE TABLE payment_transactions(id TEXT PRIMARY KEY, payment_id TEXT, type TEXT,
      amount_cents INTEGER, payment_method TEXT, origin TEXT, occurred_at INTEGER,
      created_by TEXT, external_transaction_id TEXT, reverses_transaction_id TEXT,
      idempotency_key TEXT, note TEXT, created_at INTEGER);
  `);
  db.exec(applyInsertTrigger);
  return db;
}

function insertTransaction(db, { id = crypto.randomUUID(), paymentId, type, amountCents, occurredAt = 100 }) {
  db.prepare(`INSERT INTO payment_transactions
    (id,payment_id,type,amount_cents,payment_method,origin,occurred_at,created_by,
     external_transaction_id,reverses_transaction_id,idempotency_key,note,created_at)
    VALUES (?,?,?,?,'other','asaas',?,NULL,NULL,NULL,?,NULL,?)`)
    .run(id, paymentId, type, amountCents, occurredAt, `k:${id}`, occurredAt);
}

test("overdue -> paid via webhook: payment e athlete.financial_status recalculados juntos", () => {
  const db = financeDb();
  db.prepare("INSERT INTO athletes VALUES('a1','org','pending',0)").run();
  db.prepare(`INSERT INTO payments VALUES('p1','org','a1',15000,NULL,'overdue','2026-08-01',NULL,NULL,NULL,0)`).run();

  insertTransaction(db, { paymentId: "p1", type: "payment", amountCents: 15000 });

  const payment = db.prepare("SELECT status,paid_amount_cents FROM payments WHERE id='p1'").get();
  assert.equal(payment.status, "paid");
  assert.equal(payment.paid_amount_cents, 15000);
  const athlete = db.prepare("SELECT financial_status FROM athletes WHERE id='a1'").get();
  assert.equal(athlete.financial_status, "paid", "athlete deveria sair de pending para paid no mesmo passo");
});

test("partial -> paid via webhook: saldo zera e athlete deixa de estar inadimplente", () => {
  const db = financeDb();
  db.prepare("INSERT INTO athletes VALUES('a1','org','pending',0)").run();
  db.prepare(`INSERT INTO payments VALUES('p1','org','a1',15000,5000,'partial','2026-08-01',NULL,NULL,NULL,0)`).run();

  insertTransaction(db, { paymentId: "p1", type: "payment", amountCents: 10000 });

  const payment = db.prepare("SELECT status,paid_amount_cents FROM payments WHERE id='p1'").get();
  assert.equal(payment.paid_amount_cents, 15000);
  assert.equal(payment.status, "paid");
  const athlete = db.prepare("SELECT financial_status FROM athletes WHERE id='a1'").get();
  assert.equal(athlete.financial_status, "paid");
});

test("GAP CONFIRMADO: UPDATE direto de payments.status (overdue/deleted) não dispara a trigger", () => {
  const db = financeDb();
  db.prepare("INSERT INTO athletes VALUES('a1','org','paid',0)").run();
  db.prepare(`INSERT INTO payments VALUES('p1','org','a1',15000,NULL,'open','2026-08-01',NULL,NULL,NULL,0)`).run();

  // Isto é exatamente o que o branch overdue/deleted do webhook faz: um UPDATE
  // direto em payments, sem passar por payment_transactions.
  db.prepare("UPDATE payments SET status='overdue' WHERE id='p1'").run();

  const payment = db.prepare("SELECT status FROM payments WHERE id='p1'").get();
  assert.equal(payment.status, "overdue", "o pagamento correto sim vira overdue");
  const athlete = db.prepare("SELECT financial_status FROM athletes WHERE id='a1'").get();
  assert.equal(
    athlete.financial_status,
    "paid",
    "sem refresh explícito, o athlete fica desatualizado (a lacuna real por trás do import 'unused')",
  );

  // A correção: refreshAthleteFinancialStatus roda a mesma query de dívida
  // pendente e escreve o resultado — é exatamente isso que o webhook agora
  // chama depois do UPDATE direto de status.
  const outstanding = db.prepare(`SELECT 1 AS found FROM payments
      WHERE organization_id='org' AND athlete_id='a1'
        AND status IN ('open','overdue','partial')
        AND amount_cents-COALESCE(paid_amount_cents,0)>0 LIMIT 1`).get();
  db.prepare("UPDATE athletes SET financial_status=? WHERE id='a1'").run(outstanding ? "pending" : "paid");
  assert.equal(db.prepare("SELECT financial_status FROM athletes WHERE id='a1'").get().financial_status, "pending");
});

const webhookSource = readFileSync(
  new URL("../app/api/webhooks/asaas/route.ts", import.meta.url),
  "utf8",
);

test("webhook chama refreshAthleteFinancialStatus quando escreve status diretamente (overdue/deleted)", () => {
  assert.match(webhookSource, /if \(stateUpdate\.status\) \{/);
  assert.match(webhookSource, /refreshAthleteFinancialStatus\(current\.organizationId, current\.athleteId\)/);
});

test("chamada de refresh acontece depois do UPDATE de payments, não antes (ordem importa)", () => {
  const updateIndex = webhookSource.indexOf("await db.update(payments).set(stateUpdate)");
  const refreshIndex = webhookSource.indexOf("await refreshAthleteFinancialStatus(current.organizationId");
  assert.ok(updateIndex > -1 && refreshIndex > -1);
  assert.ok(refreshIndex > updateIndex);
});
