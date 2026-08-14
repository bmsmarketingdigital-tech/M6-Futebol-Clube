import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("export script reads only the official SQLite path by default", () => {
  const source = read("scripts/export-sqlite-for-supabase.mjs");
  assert.match(source, /C:\\\\SISTEMA_ESCOLA_DE_FUTEBOL\\\\\.wrangler/);
  assert.doesNotMatch(source, /Documents\\\\SISTEMA ESCOLA DE FUTEBOL/);
  assert.match(source, /readOnly:\s*true/);
  assert.match(source, /PRAGMA integrity_check/);
  assert.match(source, /PRAGMA foreign_key_check/);
});

test("export script includes financial and notification audit tables", () => {
  const source = read("scripts/export-sqlite-for-supabase.mjs");
  for (const table of [
    "payments",
    "payment_transactions",
    "billing_notifications",
    "notification_outbox",
    "notification_attempts",
    "athlete_billing_month_reservations",
  ]) {
    assert.match(source, new RegExp(`"${table}"`));
  }
});

test("import script requires DATABASE_URL and uses a transaction", () => {
  const source = read("scripts/import-supabase-export.mjs");
  assert.match(source, /requireEnv\("DATABASE_URL"\)/);
  assert.match(source, /sql\.begin/);
  assert.match(source, /ON CONFLICT DO NOTHING/);
  assert.match(source, /ssl:\s*"require"/);
});

test("import dry-run executes inside the transaction and then rolls back", () => {
  const source = read("scripts/import-supabase-export.mjs");
  assert.doesNotMatch(source, /if\s*\(!dryRun\)\s*{\s*await tx\.unsafe/s);
  assert.match(source, /__M6_DRY_RUN_ROLLBACK__/);
});

test("import script reports progress and applies bounded timeouts", () => {
  const source = read("scripts/import-supabase-export.mjs");
  assert.match(source, /connect_timeout:\s*15/);
  assert.match(source, /statement_timeout = '15s'/);
  assert.match(source, /\[supabase:import\]/);
});

test("package scripts expose controlled Supabase export/import commands", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["supabase:export"], "node scripts/export-sqlite-for-supabase.mjs");
  assert.equal(pkg.scripts["supabase:import"], "node scripts/import-supabase-export.mjs");
});
