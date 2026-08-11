import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { parseMoneyToCents } from "../app/api/finance/finance-utils.ts";

const migration = readFileSync(
  new URL("../drizzle/0016_phase3_history_and_money_safety.sql", import.meta.url),
  "utf8",
).split("--> statement-breakpoint").map((sql) => sql.trim()).filter(Boolean);

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE organizations(id TEXT PRIMARY KEY);
    CREATE TABLE athletes(id TEXT PRIMARY KEY,active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE teams(id TEXT PRIMARY KEY);
    CREATE TABLE payments(id TEXT PRIMARY KEY,athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,amount_cents INTEGER NOT NULL,paid_amount_cents INTEGER,status TEXT,plan_name TEXT,due_date TEXT);
    CREATE TABLE payment_transactions(id TEXT PRIMARY KEY,payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,type TEXT NOT NULL,amount_cents INTEGER NOT NULL,origin TEXT,reverses_transaction_id TEXT REFERENCES payment_transactions(id) ON DELETE RESTRICT);
    CREATE TRIGGER payment_transactions_immutable_update BEFORE UPDATE ON payment_transactions BEGIN SELECT RAISE(ABORT,'immutable'); END;
    CREATE TRIGGER payment_transactions_immutable_delete BEFORE DELETE ON payment_transactions BEGIN SELECT RAISE(ABORT,'immutable'); END;
    CREATE TABLE attendance_sessions(id TEXT PRIMARY KEY,team_id TEXT REFERENCES teams(id) ON DELETE CASCADE);
    CREATE TABLE attendance_records(id TEXT PRIMARY KEY,athlete_id TEXT REFERENCES athletes(id) ON DELETE CASCADE);
    CREATE TABLE athlete_check_ins(id TEXT PRIMARY KEY,athlete_id TEXT REFERENCES athletes(id) ON DELETE CASCADE,team_id TEXT REFERENCES teams(id) ON DELETE CASCADE);
    CREATE TABLE billing_notifications(id TEXT PRIMARY KEY,athlete_id TEXT REFERENCES athletes(id) ON DELETE CASCADE,payment_id TEXT REFERENCES payments(id) ON DELETE CASCADE,status TEXT);
    CREATE TABLE notification_outbox(id TEXT PRIMARY KEY,athlete_id TEXT REFERENCES athletes(id) ON DELETE CASCADE,payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,status TEXT);
    CREATE TABLE notification_attempts(id TEXT PRIMARY KEY,notification_id TEXT REFERENCES notification_outbox(id) ON DELETE CASCADE);
    CREATE TABLE communication_recipients(id TEXT PRIMARY KEY,athlete_id TEXT REFERENCES athletes(id) ON DELETE CASCADE);
    CREATE TABLE communications(id TEXT PRIMARY KEY,team_id TEXT REFERENCES teams(id));
    CREATE TABLE class_reminders(id TEXT PRIMARY KEY,team_id TEXT REFERENCES teams(id) ON DELETE CASCADE);
    CREATE TABLE training_sessions(id TEXT PRIMARY KEY,team_id TEXT REFERENCES teams(id));
    CREATE TABLE billing_plans(id TEXT PRIMARY KEY,name TEXT,amount_cents INTEGER NOT NULL);
    CREATE TABLE expenses(id TEXT PRIMARY KEY,amount_cents INTEGER NOT NULL);
  `);
  for (const statement of migration) db.exec(statement);
  return db;
}

function seedPayment(db, { id = "p1", paid = 0, status = "open" } = {}) {
  db.prepare("INSERT OR IGNORE INTO athletes(id) VALUES('a1')").run();
  db.prepare("INSERT INTO payments VALUES(?,?,?,?,?,?,?)")
    .run(id, "a1", 1001, paid, status, "Plano histÃ³rico", "2026-08-10");
}

test("1-2 foreign keys ficam ativas e recusam registro Ã³rfÃ£o", () => {
  const db = database();
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.throws(() => db.prepare("INSERT INTO payments VALUES('x','missing',100,0,'open',NULL,'2026-08-10')").run());
});

test("3-4 exclusÃ£o fÃ­sica de atleta e mensalidade com histÃ³rico Ã© bloqueada", () => {
  const db = database(); seedPayment(db);
  db.prepare("INSERT INTO billing_notifications VALUES('b1','a1','p1','failed')").run();
  assert.throws(() => db.prepare("DELETE FROM payments WHERE id='p1'").run(), /canceladas/);
  assert.throws(() => db.prepare("DELETE FROM athletes WHERE id='a1'").run(), /arquivados/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM payments").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM billing_notifications").get().n, 1);
});

test("5-6 payment_transaction continua imutÃ¡vel para DELETE e UPDATE", () => {
  const db = database(); seedPayment(db, { paid: 500, status: "partial" });
  db.prepare("INSERT INTO payment_transactions VALUES('t1','p1','payment',500,'manual',NULL)").run();
  assert.throws(() => db.prepare("UPDATE payment_transactions SET amount_cents=1 WHERE id='t1'").run(), /immutable/);
  assert.throws(() => db.prepare("DELETE FROM payment_transactions WHERE id='t1'").run(), /immutable/);
});

test("7-9 plano, preÃ§o e arquivamento do atleta nÃ£o recalculam histÃ³rico", () => {
  const db = database(); seedPayment(db);
  db.prepare("INSERT INTO billing_plans VALUES('plan','Atual',12000)").run();
  db.prepare("UPDATE billing_plans SET name='Novo',amount_cents=15000 WHERE id='plan'").run();
  db.prepare("UPDATE athletes SET active=0 WHERE id='a1'").run();
  const historical = db.prepare("SELECT amount_cents,plan_name FROM payments WHERE id='p1'").get();
  assert.equal(historical.amount_cents, 1001);
  assert.equal(historical.plan_name, "Plano histÃ³rico");
  assert.equal(db.prepare("SELECT active FROM athletes WHERE id='a1'").get().active, 0);
});

test("10-12 parcial, estorno e cancelamento preservam o ledger", () => {
  const db = database(); seedPayment(db, { paid: 500, status: "partial" });
  db.prepare("INSERT INTO payment_transactions VALUES('t1','p1','payment',500,'manual',NULL)").run();
  db.prepare("INSERT INTO payment_transactions VALUES('r1','p1','refund',100,'manual','t1')").run();
  db.prepare("UPDATE payments SET status='cancelled' WHERE id='p1'").run();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM payment_transactions").get().n, 2);
  assert.equal(db.prepare("SELECT SUM(CASE WHEN type='refund' THEN -amount_cents ELSE amount_cents END) net FROM payment_transactions").get().net, 400);
});

test("13-16 dinheiro usa centavos exatos e rejeita fraÃ§Ãµes ambÃ­guas", () => {
  assert.equal(parseMoneyToCents("10.01"), 1001);
  assert.equal(parseMoneyToCents("0.01"), 1);
  assert.equal(parseMoneyToCents("10,01"), 1001);
  assert.equal(parseMoneyToCents("1.005"), null);
  assert.equal(parseMoneyToCents(-1), null);
});

test("17-20 API, tela, relatÃ³rio, saldo materializado e ledger usam centavos", () => {
  const db = database(); seedPayment(db, { paid: 500, status: "partial" });
  db.prepare("INSERT INTO payment_transactions VALUES('t1','p1','payment',500,'manual',NULL)").run();
  const [summary, ui, route] = [
    readFileSync(new URL("../app/api/finance/summary/route.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../app/FinanceManagement.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/api/finance/charges/[id]/route.ts", import.meta.url), "utf8"),
  ];
  assert.match(summary, /paidAmountCents/); assert.match(summary, /receivedCents/);
  assert.match(ui, /money\(data\.summary\.receivedCents\)/);
  assert.match(route, /parseMoneyToCents/);
  const row = db.prepare("SELECT paid_amount_cents,(SELECT SUM(CASE WHEN type='refund' THEN -amount_cents ELSE amount_cents END) FROM payment_transactions WHERE payment_id=payments.id) ledger FROM payments WHERE id='p1'").get();
  assert.equal(row.paid_amount_cents, row.ledger);
});

test("guards monetÃ¡rios recusam zero, negativo e pagamento acima do nominal", () => {
  const db = database();
  db.prepare("INSERT INTO athletes(id) VALUES('a1')").run();
  assert.throws(() => db.prepare("INSERT INTO payments VALUES('z','a1',0,0,'open',NULL,'2026-08-10')").run());
  seedPayment(db);
  assert.throws(() => db.prepare("UPDATE payments SET paid_amount_cents=1002 WHERE id='p1'").run());
  assert.throws(() => db.prepare("INSERT INTO expenses VALUES('e1',-1)").run());
});
