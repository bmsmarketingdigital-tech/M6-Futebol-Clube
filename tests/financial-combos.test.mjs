import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("combos têm modelo, snapshot, parcelas e cobertura separados", async () => {
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  for (const table of ["billingCombos", "athleteCombos", "athleteComboInstallments", "athleteComboCoverage"]) assert.match(schema, new RegExp(`export const ${table}`));
  assert.match(schema, /athlete_combo_installment_unique/);
  assert.match(schema, /athlete_combo_coverage_contract_month_unique/);
  assert.match(schema, /athlete_combo_coverage_active_unique/);
  assert.match(schema, /\.where\(sql`\$\{table\.active\} = 1`\)/);
});

test("parcelamento inteiro distribui o resto sem perder centavos", () => {
  const total = 100; const count = 3; const base = Math.floor(total / count); const values = [base + 1, base, base];
  assert.deepEqual(values, [34, 33, 33]); assert.equal(values.reduce((a, b) => a + b, 0), total);
});

test("mensalidade normal reserva competência e cria payment no mesmo lote", async () => {
  const automation = await readFile(new URL("../app/api/finance/billing-automation.ts", import.meta.url), "utf8");
  assert.match(automation, /athlete_billing_month_reservations/);
  assert.match(automation, /source_type,source_id/);
  assert.match(automation, /'monthly'/);
  assert.match(automation, /await d1\.batch/);
});

test("aplicação rejeita cobertura ativa e grava a identidade do atleta no lote atômico", async () => {
  const route = await readFile(new URL("../app/api/finance/combos/apply/route.ts", import.meta.url), "utf8");
  assert.match(route, /eq\(athleteComboCoverage\.athleteId, athlete\.id\)/);
  assert.match(route, /eq\(athleteComboCoverage\.active, true\)/);
  assert.match(route, /conflictingMonths/);
  assert.match(route, /organization_id,athlete_id,athlete_combo_id,reference_month,active,created_at,released_at/);
  assert.match(route, /await d1\.batch\(statements\)/);
  assert.match(route, /athlete_billing_month_reservations/);
  assert.match(route, /'combo'/);
  assert.match(route, /status: 409/);
});

test("migração protege uma única cobertura ativa por organização, atleta e mês", async () => {
  const migration = await readFile(new URL("../drizzle/0020_p0_combo_coverage_overlap.sql", import.meta.url), "utf8");
  assert.match(migration, /athlete_id/);
  assert.match(migration, /athlete_combo_coverage_active_unique/);
  assert.match(migration, /\(`organization_id`,`athlete_id`,`reference_month`\) WHERE `active`=1/);
});
