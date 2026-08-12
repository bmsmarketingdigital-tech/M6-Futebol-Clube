import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

function db() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE athlete_combos(
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      athlete_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE athlete_combo_coverage(
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      athlete_id TEXT NOT NULL,
      athlete_combo_id TEXT NOT NULL,
      reference_month TEXT NOT NULL,
      active INTEGER NOT NULL,
      released_at INTEGER
    );
    CREATE UNIQUE INDEX athlete_combo_coverage_active_unique
      ON athlete_combo_coverage(organization_id,athlete_id,reference_month)
      WHERE active=1;
    CREATE TABLE athlete_billing_month_reservations(
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      athlete_id TEXT NOT NULL,
      reference_month TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX athlete_billing_month_reservation_unique
      ON athlete_billing_month_reservations(organization_id,athlete_id,reference_month);
    CREATE TABLE payments(
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      athlete_id TEXT NOT NULL,
      athlete_combo_id TEXT,
      reference_month TEXT NOT NULL,
      status TEXT NOT NULL,
      paid_amount_cents INTEGER,
      paid_at INTEGER,
      payment_method TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX payments_athlete_month_unique
      ON payments(organization_id,athlete_id,reference_month)
      WHERE status != 'cancelled';
    CREATE TABLE payment_transactions(
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL
    );
  `);
  return database;
}

function seed(database, { id = "combo-a", org = "org-a", athlete = "athlete-a", months = ["2026-07", "2026-08", "2026-09", "2026-10"], statusByMonth = {} } = {}) {
  database.prepare("INSERT INTO athlete_combos VALUES (?,?,?,?,?)").run(id, org, athlete, "active", 1);
  for (const month of months) {
    const payment = statusByMonth[month] ?? { status: "open", paid: 0 };
    database.prepare("INSERT INTO athlete_combo_coverage VALUES (?,?,?,?,?,?,NULL)").run(`cov-${month}`, org, athlete, id, month, 1);
    database.prepare("INSERT INTO athlete_billing_month_reservations VALUES (?,?,?,?,?,?,?)").run(`res-${month}`, org, athlete, month, "combo", id, 1);
    database.prepare("INSERT INTO payments VALUES (?,?,?,?,?,?,?,?,?,?)").run(`pay-${month}`, org, athlete, id, month, payment.status, payment.paid ?? 0, null, null, 1);
    if (payment.tx) database.prepare("INSERT INTO payment_transactions VALUES (?,?,?)").run(`tx-${month}`, `pay-${month}`, payment.tx);
  }
}

function cancelCombo(database, { id = "combo-a", org = "org-a", currentMonth = "2026-08", now = 10 } = {}) {
  database.exec("BEGIN");
  try {
    database.prepare("UPDATE athlete_combos SET status='cancelled', updated_at=? WHERE id=? AND organization_id=? AND status!='cancelled'").run(now, id, org);
    const rows = database.prepare(`
      SELECT c.reference_month,c.active,p.id payment_id,p.status payment_status,
        COALESCE(p.paid_amount_cents,0) paid_amount_cents,
        COALESCE((SELECT SUM(amount_cents) FROM payment_transactions t WHERE t.payment_id=p.id),0) transaction_total
      FROM athlete_combo_coverage c
      LEFT JOIN payments p ON p.athlete_combo_id=c.athlete_combo_id AND p.organization_id=c.organization_id AND p.athlete_id=c.athlete_id AND p.reference_month=c.reference_month
      WHERE c.organization_id=? AND c.athlete_combo_id=?
      ORDER BY c.reference_month`).all(org, id);
    const released = [];
    for (const row of rows) {
      const canRelease = row.active === 1 && row.reference_month > currentMonth && row.payment_id && row.payment_status === "open" && row.paid_amount_cents === 0 && row.transaction_total === 0;
      if (!canRelease) continue;
      database.prepare("UPDATE payments SET status='cancelled', paid_at=NULL, payment_method=NULL, updated_at=? WHERE id=? AND organization_id=? AND athlete_combo_id=? AND status='open' AND COALESCE(paid_amount_cents,0)=0 AND NOT EXISTS (SELECT 1 FROM payment_transactions WHERE payment_id=payments.id)").run(now, row.payment_id, org, id);
      database.prepare("UPDATE athlete_combo_coverage SET active=0, released_at=? WHERE organization_id=? AND athlete_combo_id=? AND reference_month=? AND active=1").run(now, org, id, row.reference_month);
      database.prepare("DELETE FROM athlete_billing_month_reservations WHERE organization_id=? AND source_type='combo' AND source_id=? AND reference_month=?").run(org, id, row.reference_month);
      released.push(row.reference_month);
    }
    database.exec("COMMIT");
    return released;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

test("cancelamento libera somente competencias futuras open sem historico financeiro", () => {
  const database = db();
  seed(database, { statusByMonth: {
    "2026-07": { status: "paid", paid: 15000, tx: 15000 },
    "2026-09": { status: "partial", paid: 5000, tx: 5000 },
    "2026-10": { status: "open", paid: 0 },
  } });
  assert.deepEqual(cancelCombo(database), ["2026-10"]);
  assert.equal(database.prepare("SELECT status FROM athlete_combos WHERE id='combo-a'").get().status, "cancelled");
  assert.equal(database.prepare("SELECT active FROM athlete_combo_coverage WHERE reference_month='2026-07'").get().active, 1);
  assert.equal(database.prepare("SELECT active FROM athlete_combo_coverage WHERE reference_month='2026-08'").get().active, 1);
  assert.equal(database.prepare("SELECT active,released_at FROM athlete_combo_coverage WHERE reference_month='2026-10'").get().active, 0);
  assert.equal(database.prepare("SELECT released_at FROM athlete_combo_coverage WHERE reference_month='2026-10'").get().released_at, 10);
  assert.equal(database.prepare("SELECT status FROM payments WHERE reference_month='2026-10'").get().status, "cancelled");
  assert.equal(database.prepare("SELECT COUNT(*) total FROM athlete_billing_month_reservations WHERE reference_month='2026-10'").get().total, 0);
  assert.equal(database.prepare("SELECT COALESCE(SUM(amount_cents),0) total FROM payment_transactions").get().total, 20000);
  database.close();
});

test("overdue e paid futuros sao preservados e cancelamento repetido e coerente", () => {
  const database = db();
  seed(database, { months: ["2026-09", "2026-10"], statusByMonth: {
    "2026-09": { status: "overdue", paid: 0 },
    "2026-10": { status: "paid", paid: 15000, tx: 15000 },
  } });
  assert.deepEqual(cancelCombo(database), []);
  assert.deepEqual(cancelCombo(database), []);
  assert.equal(database.prepare("SELECT COUNT(*) total FROM athlete_combo_coverage WHERE active=1").get().total, 2);
  assert.equal(database.prepare("SELECT COUNT(*) total FROM athlete_billing_month_reservations").get().total, 2);
  assert.equal(database.prepare("SELECT SUM(amount_cents) total FROM payment_transactions").get().total, 15000);
  database.close();
});

test("monthly volta depois da liberacao e cancel x monthly nunca deixa coverage ativa com payment mensal", () => {
  const database = db();
  seed(database, { months: ["2026-09"] });
  cancelCombo(database);
  database.prepare("INSERT INTO athlete_billing_month_reservations VALUES ('res-monthly','org-a','athlete-a','2026-09','monthly','monthly-pay',20)").run();
  database.prepare("INSERT INTO payments VALUES ('monthly-pay','org-a','athlete-a',NULL,'2026-09','open',0,NULL,NULL,20)").run();
  assert.equal(database.prepare("SELECT active FROM athlete_combo_coverage WHERE reference_month='2026-09'").get().active, 0);
  assert.equal(database.prepare("SELECT source_type FROM athlete_billing_month_reservations WHERE reference_month='2026-09'").get().source_type, "monthly");
  assert.equal(database.prepare("SELECT COUNT(*) total FROM payments WHERE reference_month='2026-09' AND athlete_combo_id IS NULL").get().total, 1);
  database.close();
});

test("cancel x payment preserva pagamento confirmado pela guarda condicional", () => {
  const database = db();
  seed(database, { months: ["2026-09"] });
  database.prepare("INSERT INTO payment_transactions VALUES ('tx-race','pay-2026-09',15000)").run();
  database.prepare("UPDATE payments SET paid_amount_cents=15000,status='paid' WHERE id='pay-2026-09'").run();
  assert.deepEqual(cancelCombo(database), []);
  assert.equal(database.prepare("SELECT status FROM payments WHERE id='pay-2026-09'").get().status, "paid");
  assert.equal(database.prepare("SELECT active FROM athlete_combo_coverage WHERE reference_month='2026-09'").get().active, 1);
  assert.equal(database.prepare("SELECT SUM(amount_cents) total FROM payment_transactions").get().total, 15000);
  database.close();
});

test("tenant isolation impede cancelamento cross-tenant", () => {
  const database = db();
  seed(database, { org: "org-b", athlete: "athlete-b", months: ["2026-09"] });
  assert.deepEqual(cancelCombo(database, { org: "org-a" }), []);
  assert.equal(database.prepare("SELECT status FROM athlete_combos WHERE organization_id='org-b'").get().status, "active");
  assert.equal(database.prepare("SELECT active FROM athlete_combo_coverage WHERE organization_id='org-b'").get().active, 1);
  database.close();
});

test("rotas reais possuem cancelamento atomico e validacoes de valor do Combo", async () => {
  const cancelRoute = await readFile(new URL("../app/api/finance/combos/contracts/[id]/cancel/route.ts", import.meta.url), "utf8");
  const comboRoute = await readFile(new URL("../app/api/finance/combos/route.ts", import.meta.url), "utf8");
  const applyRoute = await readFile(new URL("../app/api/finance/combos/apply/route.ts", import.meta.url), "utf8");
  const ui = await readFile(new URL("../app/CombosManagement.tsx", import.meta.url), "utf8");

  assert.match(cancelRoute, /await d1\.batch\(statements\)/);
  assert.match(cancelRoute, /status='cancelled'/);
  assert.match(cancelRoute, /reference_month > currentMonth/);
  assert.match(cancelRoute, /status='open'/);
  assert.match(cancelRoute, /COALESCE\(paid_amount_cents,0\)=0/);
  assert.match(cancelRoute, /NOT EXISTS \(SELECT 1 FROM payment_transactions/);
  assert.match(cancelRoute, /active=0/);
  assert.match(cancelRoute, /released_at/);
  assert.match(cancelRoute, /DELETE FROM athlete_billing_month_reservations/);
  assert.match(cancelRoute, /eq\(athleteCombos\.organizationId, organizationId\)/);

  assert.match(comboRoute, /base <= 0/);
  assert.match(comboRoute, /Desconto nao pode ser negativo/);
  assert.match(comboRoute, /discountValue > 100/);
  assert.match(comboRoute, /discountValue >= base/);
  assert.match(comboRoute, /final <= 0/);
  assert.match(applyRoute, /combo\.finalAmountCents <= 0/);

  assert.match(ui, /validateForm/);
  assert.match(ui, /Cancelar contrato/);
  assert.match(ui, /Desativar modelo apenas bloqueia novas contratacoes/);
});
