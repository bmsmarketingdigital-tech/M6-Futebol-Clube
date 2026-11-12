import assert from "node:assert/strict";
import test from "node:test";
import { describeDatabaseUrl } from "../app/api/internal/db-diagnostic/diagnostic.ts";

const cases = [
  ["Supabase", "db.abcdef.supabase.co", "Supabase", "db.****.supabase.co"],
  ["Supabase pooler", "aws-0-us-east-1.pooler.supabase.com", "Supabase", "****.pooler.supabase.com"],
  ["Neon", "ep-example-123.neon.tech", "Neon", "ep-****.neon.tech"],
  ["Vercel Postgres", "pooler.vercel-storage.com", "Vercel Postgres", "****.vercel-storage.com"],
  ["Railway", "shuttle.proxy.rlwy.net", "Railway", "****.railway.app"],
  ["Other", "private.database.example.org", "Other PostgreSQL", "****"],
];

for (const [name, host, provider, hostMasked] of cases) {
  test(`database diagnostic masks ${name}`, () => {
    const raw = `postgresql://unique_user:unique_password@${host}:5432/private_database?sslmode=require&token=unique_token`;
    const result = describeDatabaseUrl(raw, true, false);
    assert.deepEqual(result, {
      databaseConfigured: true,
      protocol: "postgresql",
      provider,
      hostMasked,
      port: "5432",
      databaseMasked: "****",
      directUrlPresent: true,
      postgresUrlPresent: false,
    });
    const serialized = JSON.stringify(result);
    for (const secret of [raw, "unique_user", "unique_password", "private_database", "unique_token"]) {
      assert.equal(serialized.includes(secret), false);
    }
  });
}

test("database diagnostic handles absent or invalid URL without leaking input", () => {
  assert.equal(describeDatabaseUrl(undefined, false, false).databaseConfigured, false);
  const raw = "secret-placeholder-value";
  const result = describeDatabaseUrl(raw, false, true);
  assert.equal(result.databaseConfigured, true);
  assert.equal(result.provider, null);
  assert.equal(JSON.stringify(result).includes(raw), false);
});
