import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const migrationUrl = new URL(
  "../drizzle/0021_p0_combo_monthly_competency_reservation.sql",
  import.meta.url,
);

async function migrationSql() {
  return (await readFile(migrationUrl, "utf8")).replaceAll(
    "--> statement-breakpoint",
    "",
  );
}

function baseDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE athletes (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL REFERENCES organizations(id)
    );
    CREATE TABLE athlete_combos (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      athlete_id TEXT NOT NULL
    );
    CREATE TABLE payments (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      athlete_id TEXT NOT NULL,
      athlete_combo_id TEXT,
      reference_month TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE athlete_combo_coverage (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      athlete_id TEXT NOT NULL,
      athlete_combo_id TEXT NOT NULL,
      reference_month TEXT NOT NULL,
      active INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      released_at INTEGER
    );
    INSERT INTO organizations VALUES ('org-a'),('org-b');
    INSERT INTO athletes VALUES ('athlete-a','org-a'),('athlete-b','org-a'),('athlete-c','org-b');
  `);
  return db;
}

test("migration faz backfill distinto de monthly e Combo", async () => {
  const db = baseDatabase();
  db.exec(`
    INSERT INTO payments VALUES ('payment-a','org-a','athlete-a',NULL,'2026-08',1);
    INSERT INTO athlete_combos VALUES ('contract-a','org-a','athlete-a');
    INSERT INTO athlete_combo_coverage VALUES ('coverage-a','org-a','athlete-a','contract-a','2026-09',1,2,NULL);
  `);
  db.exec(await migrationSql());
  assert.deepEqual(
    db.prepare("SELECT source_type,source_id,reference_month FROM athlete_billing_month_reservations ORDER BY reference_month").all().map((row) => ({ ...row })),
    [
      { source_type: "monthly", source_id: "payment-a", reference_month: "2026-08" },
      { source_type: "combo", source_id: "contract-a", reference_month: "2026-09" },
    ],
  );
  db.close();
});

test("migration recusa conflito legado antes de criar a tabela definitiva", async () => {
  const db = baseDatabase();
  db.exec(`
    INSERT INTO payments VALUES ('payment-a','org-a','athlete-a',NULL,'2026-08',1);
    INSERT INTO athlete_combos VALUES ('contract-a','org-a','athlete-a');
    INSERT INTO athlete_combo_coverage VALUES ('coverage-a','org-a','athlete-a','contract-a','2026-08',1,2,NULL);
  `);
  const sql = await migrationSql();
  assert.throws(() => db.exec(sql), /conflict_count/);
  assert.equal(
    db.prepare("SELECT COUNT(*) total FROM sqlite_master WHERE type='table' AND name='athlete_billing_month_reservations'").get().total,
    0,
  );
  db.close();
});

test("uma competência aceita somente uma origem e não permite NULL", async () => {
  const db = baseDatabase();
  db.exec(await migrationSql());
  const insert = db.prepare("INSERT INTO athlete_billing_month_reservations VALUES (?,?,?,?,?,?,?)");
  insert.run("r1", "org-a", "athlete-a", "2026-10", "monthly", "payment-a", 1);
  assert.throws(
    () => insert.run("r2", "org-a", "athlete-a", "2026-10", "combo", "contract-a", 1),
    /UNIQUE/,
  );
  for (const row of [
    ["n1", null, "athlete-a", "2026-11", "monthly", "p1", 1],
    ["n2", "org-a", null, "2026-11", "monthly", "p2", 1],
    ["n3", "org-a", "athlete-a", null, "monthly", "p3", 1],
  ]) {
    assert.throws(() => insert.run(...row), /NOT NULL/);
  }
  db.close();
});

test("outro mês, atleta e tenant permanecem independentes", async () => {
  const db = baseDatabase();
  db.exec(await migrationSql());
  const insert = db.prepare("INSERT INTO athlete_billing_month_reservations VALUES (?,?,?,?,?,?,?)");
  insert.run("r1", "org-a", "athlete-a", "2026-10", "monthly", "p1", 1);
  insert.run("r2", "org-a", "athlete-a", "2026-11", "combo", "c1", 1);
  insert.run("r3", "org-a", "athlete-b", "2026-10", "combo", "c2", 1);
  insert.run("r4", "org-b", "athlete-c", "2026-10", "monthly", "p2", 1);
  assert.equal(db.prepare("SELECT COUNT(*) total FROM athlete_billing_month_reservations").get().total, 4);
  db.close();
});

test("writers reais usam reserva e escrita financeira na mesma unidade atômica", async () => {
  const apply = await readFile(
    new URL("../app/api/finance/combos/apply/route.ts", import.meta.url),
    "utf8",
  );
  const monthly = await readFile(
    new URL("../app/api/finance/billing-automation.ts", import.meta.url),
    "utf8",
  );
  assert.match(apply, /INSERT INTO athlete_billing_month_reservations/);
  assert.match(apply, /for \(const month of months\)/);
  assert.match(apply, /await d1\.batch\(statements\)/);
  assert.match(monthly, /INSERT INTO athlete_billing_month_reservations/);
  assert.match(monthly, /INSERT INTO payments/);
  assert.match(monthly, /await d1\.batch\(\[/);
  assert.doesNotMatch(monthly, /onConflictDoNothing/);
});
