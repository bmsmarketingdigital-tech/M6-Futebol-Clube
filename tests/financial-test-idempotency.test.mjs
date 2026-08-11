import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  FINANCIAL_TEST_CONFIRMATION,
  financialTestIdempotencyKey,
  financialTestIdempotencyKeys,
  validateFinancialTestRequest,
} from "../app/api/notifications/financial-test.ts";

const route = readFileSync(
  new URL("../app/api/notifications/financial-test/route.ts", import.meta.url),
  "utf8",
);
const configuration = { enabled: true, phone: "5518981518787" };
const validInput = {
  type: "before_due",
  testPhone: "5518981518787",
  runId: "phase3-test-20260811",
  confirmation: FINANCIAL_TEST_CONFIRMATION,
  configuration,
};

function database() {
  const directory = mkdtempSync(join(tmpdir(), "m6-financial-idempotency-"));
  const db = new DatabaseSync(join(directory, "test.sqlite"));
  db.exec(`CREATE TABLE notification_outbox (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending'
  )`);
  return db;
}

function insert(db, runId, type, id = crypto.randomUUID()) {
  const key = financialTestIdempotencyKey(runId, type);
  return db.prepare(
    `INSERT INTO notification_outbox(id,organization_id,idempotency_key,status)
     VALUES (?,'org',?,'sent') ON CONFLICT(idempotency_key) DO NOTHING`,
  ).run(id, key);
}

function countRun(db, runId) {
  const keys = financialTestIdempotencyKeys(runId);
  return Number(db.prepare(
    `SELECT COUNT(*) AS total FROM notification_outbox
     WHERE organization_id=? AND idempotency_key IN (?,?,?)`,
  ).get("org", ...keys).total);
}

test("1 runId simples aceito", () => {
  assert.equal(validateFinancialTestRequest(validInput).validRunId, true);
});

test("2 runId muito grande recusado", () => {
  assert.equal(validateFinancialTestRequest({ ...validInput, runId: "a".repeat(65) }).validRunId, false);
});

test("3 runId com percentual recusado", () => {
  assert.equal(validateFinancialTestRequest({ ...validInput, runId: "phase3%test" }).validRunId, false);
});

test("4 runId com asterisco recusado", () => {
  assert.equal(validateFinancialTestRequest({ ...validInput, runId: "phase3*test" }).validRunId, false);
});

test("5 before_due gera chave exata", () => {
  assert.equal(financialTestIdempotencyKey("run-123456", "before_due"), "financial-test:run-123456:before_due");
});

test("6 due_today gera chave exata", () => {
  assert.equal(financialTestIdempotencyKey("run-123456", "due_today"), "financial-test:run-123456:due_today");
});

test("7 overdue gera chave exata", () => {
  assert.equal(financialTestIdempotencyKey("run-123456", "overdue"), "financial-test:run-123456:overdue");
});

test("8 tipo duplicado e bloqueado pela constraint", () => {
  const db = database();
  insert(db, "run-duplicate", "before_due", "first");
  insert(db, "run-duplicate", "before_due", "second");
  assert.equal(countRun(db, "run-duplicate"), 1);
  db.close();
});

test("9 segundo tipo e permitido", () => {
  const db = database();
  insert(db, "run-second", "before_due");
  insert(db, "run-second", "due_today");
  assert.equal(countRun(db, "run-second"), 2);
  db.close();
});

test("10 terceiro tipo e permitido", () => {
  const db = database();
  insert(db, "run-third", "before_due");
  insert(db, "run-third", "due_today");
  insert(db, "run-third", "overdue");
  assert.equal(countRun(db, "run-third"), 3);
  db.close();
});

test("11 quarto registro e bloqueado pelo conjunto finito e pela igualdade", () => {
  const db = database();
  for (const type of ["before_due", "due_today", "overdue", "before_due"]) {
    insert(db, "run-limit", type);
  }
  assert.equal(countRun(db, "run-limit"), 3);
  db.close();
});

test("12 outro runId nao interfere", () => {
  const db = database();
  insert(db, "run-primary", "before_due");
  insert(db, "run-another", "due_today");
  assert.equal(countRun(db, "run-primary"), 1);
  db.close();
});

test("13 outbox normal nao entra na contagem", () => {
  const db = database();
  db.prepare("INSERT INTO notification_outbox VALUES ('normal','org','billing:payment:due_today','sent')").run();
  assert.equal(countRun(db, "run-normal"), 0);
  db.close();
});

test("14 concorrencia do mesmo tipo cria no maximo um registro", async () => {
  const db = database();
  await Promise.all(Array.from({ length: 20 }, async (_, index) => insert(db, "run-concurrent", "before_due", `same-${index}`)));
  assert.equal(countRun(db, "run-concurrent"), 1);
  db.close();
});

test("15 concorrencia dos tres tipos cria no maximo tres registros", async () => {
  const db = database();
  const types = ["before_due", "due_today", "overdue"];
  await Promise.all(Array.from({ length: 30 }, async (_, index) => insert(db, "run-three", types[index % 3], `three-${index}`)));
  assert.equal(countRun(db, "run-three"), 3);
  db.close();
});

test("16 fluxo de identidade nao executa LIKE ou GLOB", () => {
  assert.doesNotMatch(route, /\b(?:LIKE|GLOB)\b/i);
  assert.match(route, /idempotency_key IN \(\?,\?,\?\)/);
  assert.match(route, /idempotency_key=\?/);
});

test("17 consulta exata executa no binding D1 sem pattern too complex", () => {
  const directory = mkdtempSync(join(tmpdir(), "m6-financial-d1-"));
  const config = join(directory, "wrangler.jsonc");
  const persistence = join(directory, "state");
  writeFileSync(config, JSON.stringify({
    name: "m6-financial-idempotency-test",
    compatibility_date: "2026-08-11",
    d1_databases: [{
      binding: "DB",
      database_name: "m6-financial-idempotency-test",
      database_id: "00000000-0000-4000-8000-000000000000",
    }],
  }));
  const sql = `CREATE TABLE notification_outbox(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,status TEXT NOT NULL);
    INSERT INTO notification_outbox VALUES('one','org','financial-test:run-d1-runtime:before_due','sent');
    SELECT COUNT(*) AS total FROM notification_outbox WHERE organization_id='org' AND idempotency_key IN ('financial-test:run-d1-runtime:before_due','financial-test:run-d1-runtime:due_today','financial-test:run-d1-runtime:overdue');`;
  try {
    const output = execFileSync(process.execPath, [
      new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url).pathname.slice(1),
      "d1", "execute", "DB", "--local", `--persist-to=${persistence}`,
      `--config=${config}`, `--command=${sql}`,
    ], { encoding: "utf8", windowsHide: true });
    assert.doesNotMatch(output, /pattern too complex/i);
    assert.match(output, /"total": 1/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
