import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";

const connectionUrl = process.env.OUTBOX_POSTGRES_TEST_URL;
const localDisposableDatabase = (() => {
  if (!connectionUrl) return false;
  const parsed = new URL(connectionUrl);
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/[\w-]*(test|outbox|disposable)[\w-]*/i.test(dbName) || !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("OUTBOX_POSTGRES_TEST_URL must target a local disposable database whose name contains test, outbox, or disposable.");
  }
  return true;
})();

test("PostgreSQL disposable validates outbox constraints, revalidation reads, and SKIP LOCKED claiming", { skip: !connectionUrl }, async (t) => {
  assert.equal(localDisposableDatabase, true);
  const db = postgres(connectionUrl, { max: 3, ssl: false, prepare: false });
  const schema = `outbox_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const ns = db(schema);
  await db`CREATE SCHEMA ${db(schema)}`;
  t.after(async () => {
    await db`DROP SCHEMA IF EXISTS ${db(schema)} CASCADE`;
    await db.end({ timeout: 2 });
  });
  await db`CREATE TABLE ${ns}.notification_outbox (
    id text PRIMARY KEY, organization_id text NOT NULL, athlete_id text NOT NULL,
    team_id text, event_type text NOT NULL CHECK (event_type IN ('before_due','due_today','overdue','enrollment','controlled_test','absence')),
    idempotency_key text NOT NULL UNIQUE, phone text NOT NULL, message text NOT NULL,
    status text NOT NULL CHECK (status IN ('pending','processing','sent','failed','delivery_unknown','superseded')),
    attempt_count integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5,
    lock_token text, locked_until bigint, last_attempt_origin text CHECK (last_attempt_origin IS NULL OR last_attempt_origin IN ('startup','reconnect','automatic','verify_now','enrollment','controlled_test','manual','attendance')),
    created_at bigint NOT NULL, next_attempt_at bigint
  )`;
  await db`CREATE TABLE ${ns}.attendance_sessions(id text PRIMARY KEY, organization_id text, team_id text, session_date text, status text)`;
  await db`CREATE TABLE ${ns}.attendance_records(session_id text, athlete_id text, present boolean, PRIMARY KEY(session_id, athlete_id))`;
  await db`INSERT INTO ${ns}.notification_outbox(id,organization_id,athlete_id,team_id,event_type,idempotency_key,phone,message,status,created_at)
    VALUES ('n1','org','athlete','team','absence','absence:org:s1:athlete','5511999999999','test','pending',${Math.floor(Date.now()/1000)})`;
  await db`INSERT INTO ${ns}.attendance_sessions VALUES ('s1','org','team',${new Date().toISOString().slice(0,10)},'completed')`;
  await db`INSERT INTO ${ns}.attendance_records VALUES ('s1','athlete',false)`;

  await t.test("absence/attendance values satisfy actual PostgreSQL CHECK constraints", async () => {
    await db`UPDATE ${ns}.notification_outbox SET last_attempt_origin='attendance' WHERE id='n1'`;
    await assert.rejects(db`UPDATE ${ns}.notification_outbox SET event_type='not-a-real-event' WHERE id='n1'`);
    await assert.rejects(db`UPDATE ${ns}.notification_outbox SET last_attempt_origin='not-a-real-origin' WHERE id='n1'`);
  });
  await t.test("current attendance can be re-read and corrected presence is visible", async () => {
    const [before] = await db`SELECT s.status, r.present FROM ${ns}.attendance_sessions s JOIN ${ns}.attendance_records r ON r.session_id=s.id WHERE s.id='s1' AND s.organization_id='org' AND s.team_id='team' AND r.athlete_id='athlete'`;
    assert.equal(before.present, false);
    await db`UPDATE ${ns}.attendance_records SET present=true WHERE session_id='s1' AND athlete_id='athlete'`;
    const [after] = await db`SELECT present FROM ${ns}.attendance_records WHERE session_id='s1' AND athlete_id='athlete'`;
    assert.equal(after.present, true);
  });
  await t.test("two PostgreSQL workers claim at most one row; superseded is terminal", async () => {
    const claim = (tx) => tx`SELECT id FROM ${ns}.notification_outbox WHERE status='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`;
    await db.begin(async (tx) => {
      const [first] = await claim(tx);
      assert.equal(first.id, "n1");
      const second = await claim(db);
      assert.equal(second.length, 0);
      await tx`UPDATE ${ns}.notification_outbox SET status='superseded' WHERE id='n1'`;
    });
    const again = await db`SELECT id FROM ${ns}.notification_outbox WHERE status IN ('pending','failed')`;
    assert.equal(again.length, 0);
  });
});

test("real outbox processor revalidates on PostgreSQL and calls only the injected fake provider", { skip: !connectionUrl }, async (t) => {
  assert.equal(localDisposableDatabase, true);
  const parsed = new URL(connectionUrl);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname));
  assert.match(parsed.pathname, /outbox|test|disposable/i);
  process.env.DATABASE_URL = connectionUrl;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "cloudflare:workers") {
        return { url: "data:text/javascript,export%20const%20env%3D%7B%7D", shortCircuit: true };
      }
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (!specifier.startsWith(".") || extname(specifier)) throw error;
        const base = resolve(dirname(fileURLToPath(context.parentURL)), specifier);
        const candidates = [".ts", ".tsx", ".mjs", ".js", ".cjs"].map((extension) => base + extension)
          .concat(["index.ts", "index.tsx", "index.mjs", "index.js"].map((name) => resolve(base, name)));
        const candidate = candidates.find(existsSync);
        if (candidate) return nextResolve(pathToFileURL(candidate).href, context);
        throw error;
      }
    },
    load(url, context, nextLoad) {
      if (url.startsWith("file:") && /\.tsx?$/.test(new URL(url).pathname)) {
        const source = readFileSync(fileURLToPath(url), "utf8");
        const output = ts.transpileModule(source, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText;
        return { format: "module", source: output, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
  const outbox = await import("../app/api/notifications/outbox.ts");
  const postgresConnection = await import("../db/postgres.ts");
  globalThis.env ??= {};
  assert.equal(typeof outbox.processNotificationQueue, "function");
  assert.equal(typeof outbox.runNotificationQueue, "function");

  const db = postgres(connectionUrl, { max: 8, ssl: false, prepare: false });
  const appDb = postgresConnection.getPostgresClient();
  const organizationId = crypto.randomUUID();
  const athleteId = crypto.randomUUID();
  const teamId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const saoPauloDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const shiftDate = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const statusReader = async () => ({ status: "connected", phoneVerification: "verified" });
  const processorOptions = (sender, extra = {}) => ({
    sender, statusReader, maxPerRun: 1, minIntervalMs: 0, sleep: async () => {}, ...extra,
  });

  await db`INSERT INTO organizations(id,name,slug,created_at) VALUES (${organizationId},'Outbox PG Test',${`outbox-test-${organizationId}`},${now})`;
  await db`INSERT INTO athletes(id,organization_id,full_name,birth_year,category,guardian_name,guardian_phone,created_by,created_at,updated_at)
    VALUES (${athleteId},${organizationId},'PG Test Athlete',2010,'Sub-17','PG Test Guardian','5511999999999','test',${now},${now})`;
  await db`INSERT INTO teams(id,organization_id,name,category,created_at) VALUES (${teamId},${organizationId},'PG Test Team','Sub-17',${now})`;
  await db`INSERT INTO team_athletes(organization_id,team_id,athlete_id,enrolled_at) VALUES (${organizationId},${teamId},${athleteId},${now})`;

  t.after(async () => {
    try { await db`DELETE FROM organizations WHERE id=${organizationId}`; } finally {
      await appDb.end({ timeout: 2 });
      await db.end({ timeout: 2 });
      delete process.env.DATABASE_URL;
    }
  });

  async function addAbsence({ present = 0, sessionStatus = "completed", createdAt = now, sessionDate = saoPauloDate } = {}) {
    const sessionId = crypto.randomUUID();
    const id = crypto.randomUUID();
    const sessionTeamId = crypto.randomUUID();
    await db`INSERT INTO teams(id,organization_id,name,category,created_at)
      VALUES (${sessionTeamId},${organizationId},${`PG Test Team ${sessionTeamId}`},'Sub-17',${now})`;
    await db`INSERT INTO team_athletes(organization_id,team_id,athlete_id,enrolled_at)
      VALUES (${organizationId},${sessionTeamId},${athleteId},${now})`;
    await db`INSERT INTO attendance_sessions(id,organization_id,team_id,session_date,recorded_by,status,created_at)
      VALUES (${sessionId},${organizationId},${sessionTeamId},${sessionDate},'test',${sessionStatus},${now})`;
    await db`INSERT INTO attendance_records(session_id,athlete_id,present) VALUES (${sessionId},${athleteId},${present})`;
    await db`INSERT INTO notification_outbox(id,organization_id,athlete_id,team_id,event_type,idempotency_key,phone,message,status,attempt_count,max_attempts,created_at,updated_at)
      VALUES (${id},${organizationId},${athleteId},${sessionTeamId},'absence',${`absence:${organizationId}:${sessionId}:${athleteId}`},'5511999999999','stale attendance message','pending',0,5,${createdAt},${now})`;
    return { id, sessionId, sessionTeamId };
  }
  async function addPayment({ status = "overdue", amountCents = 10000, paidAmountCents = 0, dueDate = shiftDate(saoPauloDate, -10), message = "stale financial message" } = {}) {
    const paymentId = crypto.randomUUID();
    const id = crypto.randomUUID();
    await db`INSERT INTO payments(id,organization_id,athlete_id,reference_month,amount_cents,due_date,paid_amount_cents,plan_name,status,created_at,updated_at)
      VALUES (${paymentId},${organizationId},${athleteId},${`test-${paymentId}`},${amountCents},${dueDate},${paidAmountCents},'Test Plan',${status},${now},${now})`;
    await db`INSERT INTO notification_outbox(id,organization_id,athlete_id,payment_id,event_type,idempotency_key,phone,message,status,attempt_count,max_attempts,created_at,updated_at)
      VALUES (${id},${organizationId},${athleteId},${paymentId},'overdue',${`billing:${paymentId}:overdue`},'5511999999999',${message},'pending',0,5,${now},${now})`;
    return { id, paymentId };
  }
  async function outboxRow(id) {
    const [row] = await db`SELECT status,attempt_count AS "attemptCount",last_error AS "lastError",
      last_attempt_origin AS "lastAttemptOrigin",provider_message_id AS "providerMessageId",
      next_attempt_at AS "nextAttemptAt" FROM notification_outbox WHERE id=${id}`;
    return row;
  }

  await t.test("A1 valid absence sends once and records origin only when attempt starts", async () => {
    const item = await addAbsence();
    const before = await outboxRow(item.id);
    assert.equal(before.lastAttemptOrigin, null);
    let calls = 0;
    const totals = await outbox.processNotificationQueue(organizationId, "attendance", processorOptions(async () => {
      calls += 1;
      return { status: "sent", error: null, providerMessageId: "fake-message-id" };
    }));
    const after = await outboxRow(item.id);
    assert.equal(calls, 1);
    assert.equal(totals.sent, 1);
    assert.equal(after.status, "sent");
    assert.equal(Number(after.attemptCount), 1);
    assert.equal(after.providerMessageId, "fake-message-id");
    assert.equal(after.lastAttemptOrigin, "attendance");
  });

  await t.test("A2 corrected presence supersedes before provider and remains terminal", async () => {
    const item = await addAbsence();
    await db`UPDATE attendance_records SET present=1 WHERE session_id=${item.sessionId} AND athlete_id=${athleteId}`;
    let calls = 0;
    await outbox.processNotificationQueue(organizationId, "attendance", processorOptions(async () => {
      calls += 1;
      return { status: "sent", error: null, providerMessageId: "unexpected" };
    }));
    const invalidated = await outboxRow(item.id);
    assert.equal(calls, 0);
    assert.equal(invalidated.status, "superseded");
    assert.equal(invalidated.lastError, "attendance_no_longer_absent");
    assert.equal(Number(invalidated.attemptCount), 0);
    assert.equal(invalidated.lastAttemptOrigin, null);
    await outbox.processNotificationQueue(organizationId, "attendance", processorOptions(async () => {
      calls += 1;
      return { status: "sent", error: null, providerMessageId: "unexpected" };
    }));
    assert.equal(calls, 0);
  });

  await t.test("A3 canceled session and A4 expired absence never call provider", async () => {
    const canceled = await addAbsence({ sessionStatus: "canceled" });
    const expired = await addAbsence({ createdAt: now - 3 * 60 * 60, sessionDate: saoPauloDate });
    let calls = 0;
    await outbox.processNotificationQueue(organizationId, "attendance", processorOptions(async () => {
      calls += 1;
      return { status: "sent", error: null, providerMessageId: "unexpected" };
    }, { maxPerRun: 2 }));
    const canceledRow = await outboxRow(canceled.id);
    const expiredRow = await outboxRow(expired.id);
    assert.equal(calls, 0);
    assert.equal(canceledRow.status, "superseded");
    assert.equal(canceledRow.lastError, "attendance_session_cancelled");
    assert.equal(expiredRow.status, "superseded");
    assert.equal(expiredRow.lastError, "notification_expired");
    assert.equal(canceledRow.lastAttemptOrigin, null);
    assert.equal(expiredRow.lastAttemptOrigin, null);
  });

  await t.test("F1 open overdue debt sends; F2 settled and F3 cancelled payments do not", async () => {
    const eligible = await addPayment();
    const settled = await addPayment();
    const cancelled = await addPayment();
    await db`UPDATE payments SET status='paid',paid_amount_cents=amount_cents WHERE id=${settled.paymentId}`;
    await db`UPDATE payments SET status='cancelled' WHERE id=${cancelled.paymentId}`;
    const sentMessages = [];
    const sender = async (_organizationId, _phone, message) => {
      sentMessages.push(message);
      return { status: "sent", error: null, providerMessageId: "fake-financial-id" };
    };
    await outbox.processNotificationQueue(organizationId, "automatic", processorOptions(sender, { maxPerRun: 3 }));
    const eligibleRow = await outboxRow(eligible.id);
    const settledRow = await outboxRow(settled.id);
    const cancelledRow = await outboxRow(cancelled.id);
    assert.equal(sentMessages.length, 1);
    assert.equal(eligibleRow.status, "sent");
    assert.equal(settledRow.status, "superseded");
    assert.equal(settledRow.lastError, "payment_already_settled");
    assert.equal(Number(settledRow.attemptCount), 0);
    assert.equal(cancelledRow.status, "superseded");
    assert.equal(cancelledRow.lastError, "payment_cancelled");
    assert.equal(Number(cancelledRow.attemptCount), 0);
  });

  await t.test("F4 changed debt details refresh the message immediately before send", async () => {
    const payment = await addPayment({ amountCents: 10000, dueDate: shiftDate(saoPauloDate, -8) });
    await db`UPDATE payments SET amount_cents=15000,paid_amount_cents=2500,due_date=${shiftDate(saoPauloDate, -10)} WHERE id=${payment.paymentId}`;
    const messages = [];
    await outbox.processNotificationQueue(organizationId, "automatic", processorOptions(async (_org, _phone, message) => {
      messages.push(message);
      return { status: "sent", error: null, providerMessageId: "fake-refreshed-id" };
    }));
    assert.equal(messages.length, 1);
    assert.notEqual(messages[0], "stale financial message");
    assert.match(messages[0], /125,00/);
    assert.match(messages[0], new RegExp(new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${shiftDate(saoPauloDate, -10)}T12:00:00Z`))));
  });

  await t.test("retry revalidates after provider failure and supersedes a newly settled absence", async () => {
    const item = await addAbsence();
    let calls = 0;
    await outbox.processNotificationQueue(organizationId, "attendance", processorOptions(async () => {
      calls += 1;
      return { status: "failed", error: "synthetic provider failure", providerMessageId: null };
    }));
    await db`UPDATE attendance_records SET present=1 WHERE session_id=${item.sessionId} AND athlete_id=${athleteId}`;
    await db`UPDATE notification_outbox SET next_attempt_at=${Math.floor(Date.now() / 1000) - 1} WHERE id=${item.id}`;
    await outbox.processNotificationQueue(organizationId, "attendance", processorOptions(async () => {
      calls += 1;
      return { status: "sent", error: null, providerMessageId: "unexpected-retry" };
    }));
    const row = await outboxRow(item.id);
    assert.equal(calls, 1);
    assert.equal(row.status, "superseded");
    assert.equal(row.lastError, "attendance_no_longer_absent");
    assert.equal(Number(row.attemptCount), 1);
  });

  await t.test("transient revalidation database error defers without provider attempt or delivery_unknown", async () => {
    const item = await addAbsence();
    await db`ALTER TABLE attendance_sessions RENAME TO attendance_sessions_hidden`;
    let calls = 0;
    try {
      await outbox.processNotificationQueue(organizationId, "attendance", processorOptions(async () => {
        calls += 1;
        return { status: "sent", error: null, providerMessageId: "unexpected-transient" };
      }));
    } finally {
      await db`ALTER TABLE attendance_sessions_hidden RENAME TO attendance_sessions`;
    }
    const row = await outboxRow(item.id);
    assert.equal(calls, 0);
    assert.equal(Number(row.attemptCount), 0);
    assert.equal(row.status, "failed");
    assert.ok(Number(row.nextAttemptAt) > Math.floor(Date.now() / 1000));
    assert.notEqual(row.status, "delivery_unknown");
    assert.equal(row.lastAttemptOrigin, null);
  });

  await t.test("two independent real workers reserve one item and make exactly one provider call", async () => {
    await addAbsence();
    let calls = 0;
    const sender = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { status: "sent", error: null, providerMessageId: "fake-concurrent-id" };
    };
    const workerOptions = processorOptions(sender);
    await Promise.all([
      outbox.runNotificationQueue(organizationId, "attendance", workerOptions),
      outbox.runNotificationQueue(organizationId, "attendance", workerOptions),
    ]);
    const [row] = await db`SELECT status,attempt_count AS "attemptCount" FROM notification_outbox
      WHERE organization_id=${organizationId} AND event_type='absence' AND provider_message_id='fake-concurrent-id'`;
    assert.equal(calls, 1);
    assert.equal(row.status, "sent");
    assert.equal(Number(row.attemptCount), 1);
  });
});
