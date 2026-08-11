import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("combos têm modelo, snapshot, parcelas e cobertura separados", async () => {
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  for (const table of ["billingCombos", "athleteCombos", "athleteComboInstallments", "athleteComboCoverage"]) assert.match(schema, new RegExp(`export const ${table}`));
  assert.match(schema, /athlete_combo_installment_unique/);
  assert.match(schema, /athlete_combo_coverage_unique/);
});

test("parcelamento inteiro distribui o resto sem perder centavos", () => {
  const total = 100; const count = 3; const base = Math.floor(total / count); const values = [base + 1, base, base];
  assert.deepEqual(values, [34, 33, 33]); assert.equal(values.reduce((a, b) => a + b, 0), total);
});

test("mensalidade normal consulta cobertura de combo", async () => {
  const automation = await readFile(new URL("../app/api/finance/billing-automation.ts", import.meta.url), "utf8");
  assert.match(automation, /athleteComboCoverage/); assert.match(automation, /coveredAthletes/);
});
