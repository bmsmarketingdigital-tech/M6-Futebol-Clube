import assert from "node:assert/strict";
import test from "node:test";
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
