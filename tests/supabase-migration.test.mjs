import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migration = await readFile(
  new URL("supabase/migrations/0001_initial_schema.sql", root),
  "utf8",
);
const readme = await readFile(new URL("supabase/README.md", root), "utf8");

test("migration Supabase cobre os modulos operacionais principais", () => {
  for (const table of [
    "organizations",
    "local_users",
    "organization_members",
    "athletes",
    "teams",
    "team_athletes",
    "attendance_sessions",
    "attendance_records",
    "athlete_check_ins",
    "billing_plans",
    "athlete_billing",
    "billing_combos",
    "athlete_combos",
    "payments",
    "payment_transactions",
    "notification_outbox",
    "notification_attempts",
    "expenses",
  ]) {
    assert.match(migration, new RegExp(`create table ${table} \\(`, "i"));
  }
});

test("migration Supabase preserva invariantes financeiros e de notificacao", () => {
  assert.match(migration, /payments_athlete_month_unique/);
  assert.match(migration, /where status <> 'cancelled'/);
  assert.match(migration, /athlete_billing_month_reservations/);
  assert.match(migration, /unique \(organization_id, athlete_id, reference_month\)/);
  assert.match(migration, /payment_transactions\(origin, external_transaction_id, type\) where external_transaction_id is not null/);
  assert.match(migration, /idempotency_key text not null unique/);
  assert.match(migration, /notification_outbox_eligible_idx/);
  assert.match(migration, /lock_token text not null unique/);
  assert.match(migration, /final_amount_cents integer not null check \(final_amount_cents > 0\)/);
});

test("README documenta evolucao sem desligar SQLite antes da validacao", () => {
  assert.match(readme, /runtime principal ainda usa SQLite\/D1 local/);
  assert.match(readme, /Evolution API/);
  assert.match(readme, /preflight sem envio/i);
  assert.match(readme, /DATABASE_URL=/);
});
