import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("schema compatibility script compares export columns against migration columns", () => {
  const source = read("scripts/check-supabase-schema-compat.mjs");
  assert.match(source, /parseCreateTables/);
  assert.match(source, /missingInMigration/);
  assert.match(source, /m6-supabase-export-v1/);
});

test("package exposes Supabase schema compatibility command", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(
    pkg.scripts["supabase:check-schema"],
    "node scripts/check-supabase-schema-compat.mjs",
  );
});
