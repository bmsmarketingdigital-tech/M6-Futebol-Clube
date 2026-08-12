import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

// P0-INSTALL-COMBO-001: um fresh install (banco novo do zero, sem
// .wrangler/state pre-existente) nunca criava as 5 tabelas do modulo de
// Combos (billing_combos, athlete_combos, athlete_combo_installments,
// athlete_combo_coverage, athlete_billing_month_reservations), porque
// ensureDatabase() - o unico mecanismo real de inicializacao de schema em
// runtime - nunca continha o CREATE TABLE dessas tabelas; elas so existiam
// em db/schema.ts (tipos Drizzle, sem DDL) e em drizzle/0019_*.sql (migracao
// historica, nunca executada em runtime). Este teste extrai as instrucoes
// CREATE TABLE/CREATE INDEX/ALTER TABLE literalmente do codigo-fonte de
// db/index.ts (mesmo padrao de "espelhar a rota real" ja usado em
// tests/dashboard-summary.test.mjs) e as executa contra um SQLite real,
// provando que um banco vazio termina com o schema final de Combos
// (pos drizzle/0019+0020+0021+0022), nao a forma intermediaria de 0019.

const dbIndexSource = readFileSync("db/index.ts", "utf8");

// Extrai o literal de cada chamada d1.prepare(`...`) ou d1.prepare("..."),
// mantendo apenas CREATE TABLE/CREATE INDEX (a fundacao de schema que roda
// sempre, incondicionalmente, dentro do batch() inicial de ensureDatabase).
// As varias cadeias de ALTER TABLE .then() sao guardadas em runtime por
// checagens de PRAGMA table_info (coluna so e adicionada se ainda nao
// existir) - propositalmente FORA do escopo genérico deste extrator, porque
// rodar todas incondicionalmente duplicaria colunas que o CREATE TABLE já
// contém para um banco novo (ex.: "username"), o que não é o bug deste P0.
// As 3 colunas de Combo adicionadas a payments por este fix são testadas
// explicitamente abaixo (teste 6), espelhando exatamente o que
// db/index.ts#paymentAdditions executa.
function extractDdlStatements(source) {
  const statements = [];
  const callPattern = /d1\.prepare\(\s*(`[^`]*`|"[^"]*")\s*[,)]/gs;
  let match;
  while ((match = callPattern.exec(source)) !== null) {
    const literal = match[1];
    const sql = literal.slice(1, -1);
    if (/^\s*(CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS|CREATE UNIQUE INDEX IF NOT EXISTS)/i.test(sql)) {
      statements.push(sql);
    }
  }
  return statements;
}

const ddlStatements = extractDdlStatements(dbIndexSource);

// As 3 colunas de Combo em payments, extraidas do mesmo padrao usado por
// db/index.ts#paymentAdditions (ALTER TABLE guardado por PRAGMA table_info
// em runtime; aqui aplicado direto pois o CREATE TABLE base de payments não
// as inclui).
const comboPaymentColumnAlters = [
  "ALTER TABLE payments ADD COLUMN athlete_combo_id TEXT REFERENCES athlete_combos(id)",
  "ALTER TABLE payments ADD COLUMN combo_installment_number INTEGER",
  "ALTER TABLE payments ADD COLUMN combo_installment_total INTEGER",
];

test("0 db/index.ts#paymentAdditions contém as 3 colunas de Combo esperadas", () => {
  for (const alter of comboPaymentColumnAlters) {
    assert.ok(dbIndexSource.includes(alter), `esperava "${alter}" em db/index.ts`);
  }
});

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const sql of ddlStatements) {
    db.exec(sql);
  }
  for (const alter of comboPaymentColumnAlters) {
    db.exec(alter);
  }
  return db;
}

test("1 fonte contem DDL de todas as 5 tabelas de Combos", () => {
  for (const table of [
    "billing_combos",
    "athlete_combos",
    "athlete_combo_installments",
    "athlete_combo_coverage",
    "athlete_billing_month_reservations",
  ]) {
    assert.ok(
      ddlStatements.some((sql) => new RegExp(`CREATE TABLE IF NOT EXISTS ${table} `).test(sql)),
      `esperava CREATE TABLE IF NOT EXISTS ${table} em db/index.ts`,
    );
  }
});

test("2 banco novo (sem estado previo) termina com as 5 tabelas de Combos", () => {
  const db = freshDb();
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  for (const table of [
    "billing_combos",
    "athlete_combos",
    "athlete_combo_installments",
    "athlete_combo_coverage",
    "athlete_billing_month_reservations",
  ]) {
    assert.ok(rows.includes(table), `tabela ${table} ausente no banco novo`);
  }
});

test("3 indice parcial de sobreposicao de cobertura (drizzle/0020) existe e esta correto", () => {
  const db = freshDb();
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='athlete_combo_coverage_active_unique'")
    .get();
  assert.ok(row, "indice athlete_combo_coverage_active_unique ausente");
  assert.match(row.sql, /UNIQUE INDEX/i);
  assert.match(row.sql, /WHERE\s+`?active`?\s*=\s*1/i);
});

test("4 indice de reserva mensal (drizzle/0021) existe, sem WHERE (tabela inteira)", () => {
  const db = freshDb();
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='athlete_billing_month_reservation_unique'")
    .get();
  assert.ok(row, "indice athlete_billing_month_reservation_unique ausente");
  assert.doesNotMatch(row.sql, /WHERE/i);
});

test("5 indice payments_athlete_month_unique reflete o estado final de 0022 (libera mes cancelado)", () => {
  const db = freshDb();
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='payments_athlete_month_unique'")
    .get();
  assert.ok(row, "indice payments_athlete_month_unique ausente");
  assert.match(row.sql, /organization_id/i);
  assert.match(row.sql, /WHERE\s+status\s*!=\s*'cancelled'/i);
});

test("6 payments recebe as colunas de Combo (athlete_combo_id, combo_installment_number/total)", () => {
  const db = freshDb();
  const columns = db.prepare("PRAGMA table_info(payments)").all().map((c) => c.name);
  assert.ok(columns.includes("athlete_combo_id"));
  assert.ok(columns.includes("combo_installment_number"));
  assert.ok(columns.includes("combo_installment_total"));
});

test("7 integrity_check/foreign_key_check/foreign_keys ok em banco novo", () => {
  const db = freshDb();
  const integrity = db.prepare("PRAGMA integrity_check").get();
  assert.equal(integrity.integrity_check, "ok");
  const fkViolations = db.prepare("PRAGMA foreign_key_check").all();
  assert.equal(fkViolations.length, 0);
  const fkOn = db.prepare("PRAGMA foreign_keys").get();
  assert.equal(fkOn.foreign_keys, 1);
});

test("8 idempotencia: reexecutar todo o DDL nao falha, nao duplica tabelas/indices", () => {
  const db = freshDb();
  const before = db
    .prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name")
    .all();
  assert.doesNotThrow(() => {
    for (const sql of ddlStatements) db.exec(sql);
  });
  const after = db
    .prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name")
    .all();
  assert.deepEqual(after, before);
});

test("9 fluxo minimo de Combo funciona no banco novo (sem 'no such table')", () => {
  const db = freshDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO organizations (id, name, slug, created_at) VALUES ('org1','Org','org1',${now})`,
  ).run();
  db.prepare(
    `INSERT INTO athletes (id, organization_id, full_name, birth_year, category, guardian_name, created_by, created_at, updated_at)
     VALUES ('ath1','org1','Atleta Teste',2015,'Sub-11','Responsavel Teste','tester',${now},${now})`,
  ).run();
  db.prepare(
    `INSERT INTO billing_combos (id, organization_id, name, duration_months, base_amount_cents, final_amount_cents, installment_count, created_at, updated_at)
     VALUES ('combo1','org1','Combo Teste',3,30000,27000,3,${now},${now})`,
  ).run();
  db.prepare(
    `INSERT INTO athlete_combos (id, organization_id, athlete_id, combo_id, combo_name_snapshot, duration_months, base_amount_cents, discount_type, discount_value, final_amount_cents, installment_count, start_date, end_date, created_at, updated_at)
     VALUES ('acombo1','org1','ath1','combo1','Combo Teste',3,30000,'none',0,27000,3,'2026-08-01','2026-10-31',${now},${now})`,
  ).run();
  db.prepare(
    `INSERT INTO athlete_combo_coverage (id, organization_id, athlete_id, athlete_combo_id, reference_month, created_at)
     VALUES ('cov1','org1','ath1','acombo1','2026-08',${now})`,
  ).run();
  db.prepare(
    `INSERT INTO athlete_billing_month_reservations (id, organization_id, athlete_id, reference_month, source_type, source_id, created_at)
     VALUES ('res1','org1','ath1','2026-08','combo','acombo1',${now})`,
  ).run();

  const coverage = db.prepare("SELECT * FROM athlete_combo_coverage WHERE id='cov1'").get();
  assert.equal(coverage.athlete_id, "ath1");

  // Sobreposicao: segunda cobertura ATIVA para o mesmo atleta/mes deve ser
  // bloqueada pelo indice unico parcial (drizzle/0020).
  assert.throws(() => {
    db.prepare(
      `INSERT INTO athlete_combo_coverage (id, organization_id, athlete_id, athlete_combo_id, reference_month, created_at)
       VALUES ('cov2','org1','ath1','acombo1','2026-08',${now})`,
    ).run();
  }, /UNIQUE constraint failed/);

  // Segunda reserva para o mesmo atleta/mes deve ser bloqueada
  // (drizzle/0021 - fonte unica de verdade do mes reservado).
  assert.throws(() => {
    db.prepare(
      `INSERT INTO athlete_billing_month_reservations (id, organization_id, athlete_id, reference_month, source_type, source_id, created_at)
       VALUES ('res2','org1','ath1','2026-08','monthly','pay1',${now})`,
    ).run();
  }, /UNIQUE constraint failed/);
});
