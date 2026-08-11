import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const phase1Migration = readFileSync(new URL("../drizzle/0014_phase1_operational_safety.sql", import.meta.url), "utf8")
  .replaceAll("--> statement-breakpoint", "");

function financeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE payments(id TEXT PRIMARY KEY, organization_id TEXT, athlete_id TEXT,
    amount_cents INTEGER, paid_amount_cents INTEGER, status TEXT, external_payment_id TEXT,
    external_creation_status TEXT, external_creation_token TEXT, external_creation_started_at INTEGER,
    updated_at INTEGER);`);
  return db;
}

function atomicPay(db, cents) {
  return db.prepare(`UPDATE payments SET paid_amount_cents=COALESCE(paid_amount_cents,0)+?,
    status=CASE WHEN COALESCE(paid_amount_cents,0)+?=amount_cents THEN 'paid' ELSE 'partial' END
    WHERE id='p' AND status IN ('open','overdue','partial')
      AND amount_cents-COALESCE(paid_amount_cents,0)>=? RETURNING paid_amount_cents,status`).get(cents, cents, cents);
}

test("F-H: baixas atômicas acumulam, não duplicam quitação e não ultrapassam saldo", () => {
  const db = financeDb();
  db.prepare("INSERT INTO payments VALUES('p','org','a',10000,NULL,'open',NULL,NULL,NULL,NULL,0)").run();
  atomicPay(db, 4000); atomicPay(db, 3000);
  assert.deepEqual({ ...db.prepare("SELECT paid_amount_cents,status FROM payments WHERE id='p'").get() }, { paid_amount_cents: 7000, status: "partial" });
  assert.equal(atomicPay(db, 4000), undefined);
  assert.equal(atomicPay(db, 3000).status, "paid");
  assert.equal(atomicPay(db, 1), undefined);
});

test("I-J: partial com saldo positivo permanece dívida para qualquer origem", () => {
  const db = financeDb();
  db.prepare("INSERT INTO payments VALUES('p','org','a',10000,5000,'partial',NULL,NULL,NULL,NULL,0)").run();
  const query = "SELECT 1 FROM payments WHERE organization_id=? AND athlete_id=? AND status IN ('open','overdue','partial') AND amount_cents-COALESCE(paid_amount_cents,0)>0 LIMIT 1";
  assert.ok(db.prepare(query).get("org", "a"));
  const helper = readFileSync(new URL("../app/api/finance/debt-status.ts", import.meta.url), "utf8");
  const manual = readFileSync(new URL("../app/api/finance/charges/[id]/route.ts", import.meta.url), "utf8");
  const webhook = readFileSync(new URL("../app/api/webhooks/asaas/route.ts", import.meta.url), "utf8");
  assert.match(helper, /status IN \('open', 'overdue', 'partial'\)/);
  assert.match(manual, /refreshAthleteFinancialStatus/);
  assert.match(webhook, /refreshAthleteFinancialStatus/);
});

test("K: somente uma criação Asaas concorrente obtém reserva local", () => {
  const db = financeDb();
  db.prepare("INSERT INTO payments VALUES('p','org','a',10000,NULL,'open',NULL,NULL,NULL,NULL,0)").run();
  const reserve = db.prepare(`UPDATE payments SET external_creation_status='creating',external_creation_token=?
    WHERE id='p' AND external_payment_id IS NULL AND (external_creation_status IS NULL OR external_creation_status='failed') RETURNING id`);
  assert.ok(reserve.get("token-a"));
  assert.equal(reserve.get("token-b"), undefined);
  const route = readFileSync(new URL("../app/api/finance/charges/[id]/send/route.ts", import.meta.url), "utf8");
  assert.ok(route.indexOf("external_creation_status='creating'") < route.indexOf('asaasRequest<{ id: string }>("/customers"'));
  assert.match(route, /providerPaymentRequested \? "unknown" : "failed"/);
});

test("A-E: revalidação fica entre lock e tentativa/sender e usa superseded", () => {
  const source = readFileSync(new URL("../app/api/notifications/outbox.ts", import.meta.url), "utf8");
  const loop = source.slice(source.indexOf("async function runNotificationQueue"));
  assert.ok(loop.indexOf("reserveNext") < loop.indexOf("revalidateFinancialNotification"));
  assert.ok(loop.indexOf("revalidateFinancialNotification") < loop.indexOf("beginAttempt"));
  assert.ok(loop.indexOf("beginAttempt") < loop.indexOf("sender(item.phone"));
  assert.match(source, /status='superseded'/);
  assert.match(source, /Telefone do responsável mudou/);
  for (const marker of ["paid", "cancelled", "Atleta inativo", "before_due", "due_today", "overdue"]) assert.ok(source.includes(marker));
});

test("L,N,O: migração exata converte somente IDs auditados e preserva históricos", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE payments(id TEXT PRIMARY KEY,external_payment_id TEXT);
    CREATE TABLE notification_outbox(id TEXT PRIMARY KEY,created_at INTEGER,updated_at INTEGER,sent_at INTEGER,locked_at INTEGER,locked_until INTEGER,next_attempt_at INTEGER);
    CREATE TABLE notification_attempts(id TEXT PRIMARY KEY,started_at INTEGER,finished_at INTEGER);`);
  db.prepare("INSERT INTO notification_outbox VALUES(?,?,?,?,?,?,?)").run("81e73c42-c16f-421c-a298-b6be52adb2ac",1786409175392,1786409175423,null,1786409175404,null,1786409475423);
  db.prepare("INSERT INTO notification_outbox VALUES(?,?,?,?,?,?,?)").run("legacy",1700000000,1700000000,1700000000,null,null,null);
  db.prepare("INSERT INTO notification_attempts VALUES(?,?,?)").run("c08ae75c-aefb-4c7d-afd7-c7629afcab3f",1786409175404,1786409175423);
  db.exec(phase1Migration);
  assert.equal(db.prepare("SELECT created_at FROM notification_outbox WHERE id LIKE '81e%'").get().created_at,1786409175);
  assert.equal(db.prepare("SELECT created_at FROM notification_outbox WHERE id='legacy'").get().created_at,1700000000);
});

test("M: código mantém idempotência, lock e exclui controlled_test da fila geral", () => {
  const source = readFileSync(new URL("../app/api/notifications/outbox.ts", import.meta.url), "utf8");
  assert.match(source, /ON CONFLICT\(idempotency_key\) DO NOTHING/);
  assert.match(source, /event_type != 'controlled_test'/);
  assert.match(source, /lock_token/);
});
