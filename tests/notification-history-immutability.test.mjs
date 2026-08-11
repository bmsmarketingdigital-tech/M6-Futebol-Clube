import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const outboxMigration = readFileSync(
  new URL("../drizzle/0013_solid_talisman.sql", import.meta.url), "utf8",
).replaceAll("--> statement-breakpoint", "");
const immutabilityMigration = readFileSync(
  new URL("../drizzle/0017_phase3_notification_history_immutability.sql", import.meta.url), "utf8",
).replaceAll("--> statement-breakpoint", "");

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE organizations(id TEXT PRIMARY KEY);
    CREATE TABLE athletes(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL);
    CREATE TABLE teams(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL);
    CREATE TABLE payments(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,athlete_id TEXT NOT NULL);
    CREATE TABLE billing_notifications(
      id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,payment_id TEXT NOT NULL,
      athlete_id TEXT NOT NULL,type TEXT NOT NULL,phone TEXT NOT NULL,message TEXT NOT NULL,
      status TEXT NOT NULL,error TEXT,sent_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
    );
    INSERT INTO organizations VALUES('org');
    INSERT INTO athletes VALUES('athlete','org');
    INSERT INTO teams VALUES('team','org');
    INSERT INTO payments VALUES('payment','org','athlete');
  `);
  db.exec(outboxMigration);
  db.exec(`CREATE TRIGGER billing_notifications_preserve_history_delete
    BEFORE DELETE ON billing_notifications WHEN OLD.status IN ('sent','failed')
    BEGIN SELECT RAISE(ABORT,'immutable delete'); END;
    CREATE TRIGGER notification_outbox_preserve_history_delete
    BEFORE DELETE ON notification_outbox WHEN OLD.status IN ('sent','failed','delivery_unknown','superseded')
      OR EXISTS(SELECT 1 FROM notification_attempts WHERE notification_id=OLD.id)
    BEGIN SELECT RAISE(ABORT,'immutable delete'); END;
    CREATE TRIGGER notification_attempts_preserve_history_delete
    BEFORE DELETE ON notification_attempts BEGIN SELECT RAISE(ABORT,'immutable delete'); END;`);
  db.exec(immutabilityMigration);
  return db;
}

function billing(db, id, status) {
  db.prepare(`INSERT INTO billing_notifications VALUES(?,'org','payment','athlete','due_today',
    '5511000000000','histÃ³rico',?,NULL,?,100,100)`).run(id, status, status === "sent" ? 100 : null);
}

function outbox(db, id, status, attempts = 0, event = "due_today") {
  db.prepare(`INSERT INTO notification_outbox(
    id,organization_id,athlete_id,payment_id,team_id,event_type,idempotency_key,
    phone,message,status,attempt_count,max_attempts,created_at,updated_at
  ) VALUES(?,'org','athlete','payment','team',?,?,'5511000000000','histÃ³rico',?,?,3,100,100)`)
    .run(id, event, `key:${id}`, status, attempts);
}

test("1-3 billing sent/failed Ã© imutÃ¡vel para UPDATE e DELETE", () => {
  const db = database(); billing(db, "sent", "sent"); billing(db, "failed", "failed");
  assert.throws(() => db.prepare("UPDATE billing_notifications SET message='x' WHERE id='sent'").run(), /imut/);
  assert.throws(() => db.prepare("UPDATE billing_notifications SET error='x' WHERE id='failed'").run(), /imut/);
  assert.throws(() => db.prepare("DELETE FROM billing_notifications WHERE id IN('sent','failed')").run(), /immutable delete/);
});

test("4-8 outbox sent/failed/superseded/delivery_unknown Ã© imutÃ¡vel e DELETE segue bloqueado", () => {
  const db = database();
  outbox(db, "sent", "sent", 1); outbox(db, "failed", "failed", 3);
  outbox(db, "superseded", "superseded"); outbox(db, "unknown", "delivery_unknown", 1);
  for (const id of ["sent", "failed", "superseded", "unknown"]) {
    assert.throws(() => db.prepare("UPDATE notification_outbox SET message='x' WHERE id=?").run(id), /imut/);
    assert.throws(() => db.prepare("DELETE FROM notification_outbox WHERE id=?").run(id), /immutable delete/);
  }

  outbox(db, "controlled-failed", "failed", 1, "controlled_test");
  assert.throws(
    () => db.prepare("UPDATE notification_outbox SET status='processing' WHERE id='controlled-failed'").run(),
    /imut/,
  );
});

test("9-10 attempt finalizada Ã© append-only", () => {
  const db = database(); outbox(db, "o", "sent", 1);
  db.prepare(`INSERT INTO notification_attempts VALUES(
    'a','o',1,'automatic','lock','sent',NULL,'provider',100,200)`).run();
  assert.throws(() => db.prepare("UPDATE notification_attempts SET error='x' WHERE id='a'").run(), /imut/);
  assert.throws(() => db.prepare("DELETE FROM notification_attempts WHERE id='a'").run(), /immutable delete/);
});

test("11-14 pending/processamento/finalizaÃ§Ã£o e attempt ativa continuam permitidos", () => {
  const db = database(); outbox(db, "sent-flow", "pending");
  db.prepare("UPDATE notification_outbox SET status='processing',lock_token='l1',attempt_count=1 WHERE id='sent-flow'").run();
  db.prepare(`INSERT INTO notification_attempts VALUES(
    'a1','sent-flow',1,'automatic','l1','processing',NULL,NULL,100,NULL)`).run();
  db.prepare("UPDATE notification_outbox SET status='sent',sent_at=200,lock_token=NULL WHERE id='sent-flow'").run();
  db.prepare("UPDATE notification_attempts SET status='sent',provider_message_id='p',finished_at=200 WHERE id='a1'").run();
  assert.equal(db.prepare("SELECT status FROM notification_outbox WHERE id='sent-flow'").get().status, "sent");

  outbox(db, "failed-flow", "pending");
  db.prepare("UPDATE notification_outbox SET status='processing',lock_token='l2',attempt_count=1 WHERE id='failed-flow'").run();
  db.prepare("UPDATE notification_outbox SET status='failed',next_attempt_at=300,lock_token=NULL WHERE id='failed-flow'").run();
  assert.equal(db.prepare("SELECT status FROM notification_outbox WHERE id='failed-flow'").get().status, "failed");

  outbox(db, "unknown-flow", "pending");
  db.prepare("UPDATE notification_outbox SET status='processing',lock_token='l3',attempt_count=1 WHERE id='unknown-flow'").run();
  db.prepare("UPDATE notification_outbox SET status='delivery_unknown',last_error='timeout',lock_token=NULL WHERE id='unknown-flow'").run();
  assert.equal(db.prepare("SELECT status FROM notification_outbox WHERE id='unknown-flow'").get().status, "delivery_unknown");
});

test("15-16 superseded e retry/recovery legÃ­timos continuam permitidos", () => {
  const db = database(); outbox(db, "sup", "pending");
  db.prepare("UPDATE notification_outbox SET status='processing',lock_token='s' WHERE id='sup'").run();
  db.prepare("UPDATE notification_outbox SET status='superseded',last_error='obsoleto',lock_token=NULL WHERE id='sup'").run();
  assert.equal(db.prepare("SELECT status FROM notification_outbox WHERE id='sup'").get().status, "superseded");

  outbox(db, "retry", "failed", 1);
  db.prepare("UPDATE notification_outbox SET status='processing',lock_token='r',last_error=NULL WHERE id='retry'").run();
  assert.equal(db.prepare("SELECT status FROM notification_outbox WHERE id='retry'").get().status, "processing");
});

test("reenvio manual pode incrementar somente seu contador auditÃ¡vel", () => {
  const db = database(); outbox(db, "original", "sent", 1);
  db.prepare("UPDATE notification_outbox SET manual_resend_count=manual_resend_count+1,updated_at=200 WHERE id='original'").run();
  assert.equal(db.prepare("SELECT manual_resend_count FROM notification_outbox WHERE id='original'").get().manual_resend_count, 1);
  assert.throws(() => db.prepare("UPDATE notification_outbox SET manual_resend_count=2,message='x',updated_at=300 WHERE id='original'").run(), /imut/);
});
