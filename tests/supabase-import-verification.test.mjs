import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("verify script checks critical financial and notification tables", () => {
  const source = read("scripts/verify-supabase-import.mjs");
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

test("verify script reports billing/outbox/attempt audit after import", () => {
  const source = read("scripts/verify-supabase-import.mjs");
  assert.match(source, /sent_with_sent_at/);
  assert.match(source, /notificationOutboxByStatus/);
  assert.match(source, /notificationAttempts/);
});

test("package exposes supabase verify command", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["supabase:verify"], "node scripts/verify-supabase-import.mjs");
});
