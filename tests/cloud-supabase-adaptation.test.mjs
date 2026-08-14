import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("env example documents Supabase/Postgres and Evolution cloud variables", () => {
  const env = read(".env.example");
  for (const name of [
    "DATABASE_URL",
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "EVOLUTION_API_URL",
    "EVOLUTION_API_KEY",
    "EVOLUTION_API_INSTANCE",
  ]) {
    assert.match(env, new RegExp(`^${name}=`, "m"));
  }
});

test("cloud health reports only booleans and never returns configured secrets", () => {
  const source = read("app/api/cloud/health/route.ts");
  assert.match(source, /databaseConfigured/);
  assert.match(source, /supabaseUrlConfigured/);
  assert.match(source, /evolutionConfigured/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY[^)]*Response\.json/s);
  assert.doesNotMatch(source, /DATABASE_URL[^)]*Response\.json/s);
  assert.doesNotMatch(source, /EVOLUTION_API_KEY[^)]*Response\.json/s);
});

test("cloud integrations no longer import cloudflare:workers directly", () => {
  const files = [
    "app/api/check-in/evolution-provider.ts",
    "app/api/check-in/whatsapp-bridge.ts",
    "app/api/finance/asaas.ts",
    "app/api/notifications/outbox.ts",
    "app/api/notifications/financial-test/route.ts",
    "app/api/internal/notifications/controlled-test/route.ts",
    "app/api/internal/notifications/recover/route.ts",
    "db/storage.ts",
  ];
  for (const file of files) {
    assert.doesNotMatch(read(file), /cloudflare:workers/, file);
  }
});

test("Postgres adapter uses DATABASE_URL-compatible variables and ssl", () => {
  const source = read("db/postgres.ts");
  assert.match(source, /DATABASE_URL/);
  assert.match(source, /SUPABASE_DATABASE_URL/);
  assert.match(source, /ssl:\s*"require"/);
  assert.match(source, /select 1 as ok/);
});
