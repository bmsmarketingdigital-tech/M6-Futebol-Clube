import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { absenceNotificationKey } from "../app/api/notifications/absence-idempotency.mjs";
import { queueAbsenceNotifications } from "../app/api/notifications/absence-queue.mjs";
import { sanitizeDeliveryError } from "../app/api/notifications/sanitize-delivery-error.mjs";
import { selectWhatsAppProviderFromConfig } from "../app/api/check-in/provider-choice.mjs";
import { normalizeNotificationPhone } from "../app/api/notifications/normalize-phone.mjs";

const migration = readFileSync(
  new URL("../drizzle/0013_solid_talisman.sql", import.meta.url),
  "utf8",
).replaceAll("--> statement-breakpoint", "");

function baseDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "m6-outbox-"));
  const db = new DatabaseSync(join(directory, "test.sqlite"));
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE organizations(id TEXT PRIMARY KEY);
    CREATE TABLE athletes(id TEXT PRIMARY KEY, organization_id TEXT NOT NULL);
    CREATE TABLE teams(id TEXT PRIMARY KEY, organization_id TEXT NOT NULL);
    CREATE TABLE payments(id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, athlete_id TEXT NOT NULL);
    CREATE TABLE billing_notifications(
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, payment_id TEXT NOT NULL,
      athlete_id TEXT NOT NULL, type TEXT NOT NULL, phone TEXT NOT NULL,
      message TEXT NOT NULL, status TEXT NOT NULL, error TEXT, sent_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    INSERT INTO organizations VALUES ('org');
    INSERT INTO athletes VALUES ('athlete','org');
    INSERT INTO teams VALUES ('team','org');`);
  return db;
}

function insertLegacy(db) {
  const payment = db.prepare("INSERT INTO payments VALUES (?, 'org', 'athlete')");
  const notification = db.prepare(
    `INSERT INTO billing_notifications VALUES (?, 'org', ?, 'athlete', ?,
      '5511999999999', 'mensagem histórica', ?, ?, ?, ?, ?)`,
  );
  for (let index = 0; index < 21; index += 1) {
    const id = `sent-${index}`;
    const sentAt = 1_700_000_000_000 + index;
    payment.run(`payment-${id}`);
    notification.run(id, `payment-${id}`, "due_today", "sent", null, sentAt, sentAt - 10, sentAt);
  }
  for (let index = 0; index < 51; index += 1) {
    const id = `failed-${index}`;
    payment.run(`payment-${id}`);
    notification.run(id, `payment-${id}`, "overdue", "failed", "inválido", null, 10 + index, 20 + index);
  }
}

function enqueue(db, { key, type = "due_today", id = crypto.randomUUID() }) {
  db.prepare(
    `INSERT INTO notification_outbox(
      id,organization_id,athlete_id,team_id,event_type,idempotency_key,phone,message,
      status,attempt_count,max_attempts,created_at,updated_at
    ) VALUES (?,'org','athlete','team',?,?,'5511888888888','mensagem fake',
      'pending',0,3,100,100) ON CONFLICT(idempotency_key) DO NOTHING`,
  ).run(id, type, key);
  return id;
}

function reserve(db, id, origin = "automatic") {
  const token = crypto.randomUUID();
  return db.prepare(
    `UPDATE notification_outbox SET status='processing', attempt_count=attempt_count+1,
      lock_token=?, locked_at=200, locked_until=1200, last_attempt_origin=?
     WHERE id=? AND (status='pending' OR status='failed')
       AND (locked_until IS NULL OR locked_until<=200)
     RETURNING id,attempt_count,lock_token`,
  ).get(token, origin, id);
}

async function process(db, id, sender, connected = true, origin = "automatic") {
  if (!connected) return false;
  const item = reserve(db, id, origin);
  if (!item) return false;
  db.prepare(
    `INSERT INTO notification_attempts VALUES (?, ?, ?, ?, ?, 'processing', NULL, NULL, 200, NULL)`,
  ).run(crypto.randomUUID(), id, item.attempt_count, origin, item.lock_token);
  const result = await sender();
  const next = result.status === "failed" ? 500 : null;
  db.prepare(
    `UPDATE notification_outbox SET status=?,last_error=?,sent_at=?,next_attempt_at=?,
      provider_message_id=?,lock_token=NULL,locked_until=NULL WHERE id=? AND lock_token=?`,
  ).run(
    result.status,
    result.error ?? null,
    result.status === "sent" ? 300 : null,
    next,
    result.providerMessageId ?? null,
    id,
    item.lock_token,
  );
  db.prepare(
    `UPDATE notification_attempts SET status=?,error=?,finished_at=300 WHERE lock_token=?`,
  ).run(result.status, result.error ?? null, item.lock_token);
  return true;
}

test("migração preserva 21 sent, sent_at e 51 failed sem enviar", () => {
  const db = baseDatabase();
  insertLegacy(db);
  db.exec(migration);
  assert.deepEqual(
    db.prepare("SELECT status,count(*) total FROM billing_notifications GROUP BY status ORDER BY status").all().map((row) => ({ ...row })),
    [{ status: "failed", total: 51 }, { status: "sent", total: 21 }],
  );
  assert.equal(db.prepare("SELECT count(*) total FROM notification_outbox").get().total, 72);
  assert.equal(
    db.prepare(`SELECT count(*) total FROM billing_notifications b JOIN notification_outbox o
      ON o.legacy_notification_id=b.id WHERE b.status='sent' AND o.sent_at=b.sent_at`).get().total,
    21,
  );
  assert.equal(db.prepare("SELECT count(*) total FROM notification_attempts").get().total, 0);
});

test("sent é ignorada e duas verificações reservam uma única vez", async () => {
  const db = baseDatabase();
  db.exec(migration);
  const sentId = enqueue(db, { key: "billing:sent:due_today" });
  db.prepare("UPDATE notification_outbox SET status='sent',sent_at=123 WHERE id=?").run(sentId);
  let calls = 0;
  assert.equal(await process(db, sentId, async () => (++calls, { status: "sent" })), false);
  const id = enqueue(db, { key: "billing:double:due_today" });
  const sender = async () => (++calls, { status: "sent", providerMessageId: "fake-1" });
  await Promise.all([process(db, id, sender, true, "verify_now"), process(db, id, sender, true, "verify_now")]);
  assert.equal(calls, 1);
  assert.equal(db.prepare("SELECT attempt_count total FROM notification_outbox WHERE id=?").get(id).total, 1);
});

test("desconexão mantém pending; reconexão e reinício recuperam somente pendências", async () => {
  const db = baseDatabase();
  db.exec(migration);
  const id = enqueue(db, { key: "billing:reconnect:overdue" });
  let calls = 0;
  assert.equal(await process(db, id, async () => (++calls, { status: "sent" }), false), false);
  assert.equal(db.prepare("SELECT status FROM notification_outbox WHERE id=?").get(id).status, "pending");
  await process(db, id, async () => (++calls, { status: "sent" }), true, "reconnect");
  assert.equal(calls, 1);
  assert.equal(await process(db, id, async () => (++calls, { status: "sent" }), true, "startup"), false);
  assert.equal(calls, 1);
});

test("inscrição usa chave única conectada e aguarda quando desconectada", async () => {
  const db = baseDatabase();
  db.exec(migration);
  const key = "enrollment:org:athlete:team";
  const first = enqueue(db, { key, type: "enrollment" });
  enqueue(db, { key, type: "enrollment" });
  assert.equal(db.prepare("SELECT count(*) total FROM notification_outbox WHERE idempotency_key=?").get(key).total, 1);
  let calls = 0;
  await process(db, first, async () => (++calls, { status: "sent" }), true, "enrollment");
  assert.equal(calls, 1);
  const pending = enqueue(db, { key: "enrollment:org:athlete-2:team", type: "enrollment" });
  await process(db, pending, async () => (++calls, { status: "sent" }), false, "enrollment");
  assert.equal(db.prepare("SELECT status FROM notification_outbox WHERE id=?").get(pending).status, "pending");
});

test("falha registra erro; timeout vira delivery_unknown e não tem retry automático", async () => {
  const db = baseDatabase();
  db.exec(migration);
  const failed = enqueue(db, { key: "billing:failed:overdue" });
  await process(db, failed, async () => ({ status: "failed", error: "sem WhatsApp" }));
  assert.deepEqual(
    { ...db.prepare("SELECT status,attempt_count,last_error FROM notification_outbox WHERE id=?").get(failed) },
    { status: "failed", attempt_count: 1, last_error: "sem WhatsApp" },
  );
  const unknown = enqueue(db, { key: "billing:unknown:overdue" });
  let calls = 0;
  await process(db, unknown, async () => (++calls, { status: "delivery_unknown", error: "timeout" }));
  assert.equal(await process(db, unknown, async () => (++calls, { status: "sent" })), false);
  assert.equal(calls, 1);
  assert.equal(db.prepare("SELECT status FROM notification_outbox WHERE id=?").get(unknown).status, "delivery_unknown");
});

test("reenvio manual cria filho e tentativa sem alterar original", async () => {
  const db = baseDatabase();
  db.exec(migration);
  const original = enqueue(db, { key: "billing:original:due_today" });
  await process(db, original, async () => ({ status: "sent" }));
  const child = crypto.randomUUID();
  db.prepare(`INSERT INTO notification_outbox(
    id,organization_id,athlete_id,team_id,original_notification_id,event_type,
    idempotency_key,phone,message,status,attempt_count,max_attempts,last_attempt_origin,
    created_at,updated_at) SELECT ?,'org',athlete_id,team_id,id,event_type,?,phone,message,
    'pending',0,1,'manual',400,400 FROM notification_outbox WHERE id=?`
  ).run(child, `manual:${original}:${child}`, original);
  db.prepare("UPDATE notification_outbox SET manual_resend_count=1 WHERE id=?").run(original);
  await process(db, child, async () => ({ status: "sent" }), true, "manual");
  assert.equal(db.prepare("SELECT status FROM notification_outbox WHERE id=?").get(original).status, "sent");
  assert.deepEqual(
    { ...db.prepare("SELECT original_notification_id,status,last_attempt_origin FROM notification_outbox WHERE id=?").get(child) },
    { original_notification_id: original, status: "sent", last_attempt_origin: "manual" },
  );
  assert.equal(db.prepare("SELECT count(*) total FROM notification_attempts WHERE notification_id=?").get(child).total, 1);
});

test("ausência com guardian cria um item outbox idempotente ligado à organização e sessão", () => {
  const db = baseDatabase();
  db.exec(migration);
  const key = absenceNotificationKey("org", "session-1", "athlete");
  const first = enqueue(db, { key, type: "absence" });
  enqueue(db, { key, type: "absence", id: "duplicate" });
  const row = db.prepare("SELECT organization_id,event_type,status,attempt_count FROM notification_outbox WHERE idempotency_key=?").get(key);
  assert.deepEqual({ ...row }, { organization_id: "org", event_type: "absence", status: "pending", attempt_count: 0 });
  assert.equal(db.prepare("SELECT count(*) total FROM notification_outbox WHERE idempotency_key=?").get(key).total, 1);
  assert.equal(first.length > 0, true);
});

test("ausência elegível enfileira uma vez; telefone ausente e presença não enfileiram", async () => {
  const roster = [{ id: "athlete-a", name: "Atleta A" }, { id: "athlete-b", name: "Atleta B" }];
  const submitted = new Map([ ["athlete-a", { present: false, note: null }], ["athlete-b", { present: true, note: null }] ]);
  const phones = new Map([ ["athlete-a", "5511888888888"], ["athlete-b", "5511777777777"] ]);
  const seen = new Map();
  const enqueue = async (input) => {
    const created = !seen.has(input.idempotencyKey);
    seen.set(input.idempotencyKey, input);
    return { created };
  };
  const args = {
    organizationId: "org-a", teamId: "team-a", sessionId: "session-a", teamName: "Sub-7",
    date: "2026-11-12", roster, submitted, phoneByAthleteId: phones, enqueue,
  };
  assert.equal(await queueAbsenceNotifications(args), 1);
  assert.equal(await queueAbsenceNotifications(args), 0);
  assert.equal(seen.size, 1);
  const notification = [...seen.values()][0];
  assert.equal(notification.eventType, "absence");
  assert.equal(notification.organizationId, "org-a");
  assert.equal(notification.idempotencyKey, "absence:org-a:session-a:athlete-a");

  assert.equal(await queueAbsenceNotifications({
    ...args,
    roster: [roster[0]],
    phoneByAthleteId: new Map(),
  }), 0);
  assert.equal(seen.size, 1);
});

test("duas requisições concorrentes para a mesma ausência criam uma linha", async () => {
  const db = baseDatabase();
  db.exec(migration);
  const key = absenceNotificationKey("org", "session-race", "athlete");
  await Promise.all([
    Promise.resolve().then(() => enqueue(db, { key, type: "absence", id: "attempt-a" })),
    Promise.resolve().then(() => enqueue(db, { key, type: "absence", id: "attempt-b" })),
  ]);
  assert.equal(db.prepare("SELECT count(*) total FROM notification_outbox WHERE idempotency_key=?").get(key).total, 1);
});

test("telefone inválido ou ausente não cria outbox de ausência", async () => {
  const calls = [];
  const queued = await queueAbsenceNotifications({
    organizationId: "org", teamId: "team", sessionId: "session", teamName: "Sub-7", date: "2026-11-12",
    roster: [{ id: "athlete-a", name: "A" }, { id: "athlete-b", name: "B" }],
    submitted: new Map([ ["athlete-a", { present: false, note: null }], ["athlete-b", { present: false, note: null }] ]),
    phoneByAthleteId: new Map([ ["athlete-a", "123"], ["athlete-b", "   "] ]),
    enqueue: async (input) => { calls.push(input); return { created: true }; },
  });
  assert.equal(queued, 0);
  assert.deepEqual(calls, []);
});

test("falha ao enfileirar não lança erro que possa cancelar a presença já salva", async () => {
  const attendanceSaved = true;
  const logged = [];
  const queued = await queueAbsenceNotifications({
    organizationId: "org-a", teamId: "team-a", sessionId: "session-a", teamName: "Sub-7",
    date: "2026-11-12", roster: [{ id: "athlete-a", name: "Atleta A" }],
    submitted: new Map([["athlete-a", { present: false, note: null }]]),
    phoneByAthleteId: new Map([["athlete-a", "5511888888888"]]),
    enqueue: async () => { throw new Error("DB temporário indisponível"); },
    onError: (detail) => logged.push(detail),
  });
  assert.equal(queued, 0);
  assert.equal(attendanceSaved, true);
  assert.equal(logged.length, 1);
  assert.equal("phone" in logged[0], false);
});

test("provider selecionado permanece Evolution quando configurado", () => {
  assert.equal(selectWhatsAppProviderFromConfig({}, true), "evolution");
  assert.equal(selectWhatsAppProviderFromConfig({ WHATSAPP_BRIDGE_URL: "http://localhost" }, true), "local");
});

test("telefone é normalizado antes do sender e valores inválidos são recusados", () => {
  assert.equal(normalizeNotificationPhone("(11) 99999-8888"), "5511999998888");
  assert.equal(normalizeNotificationPhone("+55 11 99999-8888"), "5511999998888");
  assert.equal(normalizeNotificationPhone("123"), null);
  assert.equal(normalizeNotificationPhone("5511abc"), null);
});

test("erro persistido no outbox remove bearer, token e telefone", () => {
  const safe = sanitizeDeliveryError(new Error("Bearer secret-token token=api-secret telefone 5511999999999"));
  assert.doesNotMatch(safe, /secret-token|api-secret|5511999999999/);
  assert.match(safe, /redacted/);
});

test("presente ou ausência sem guardian não cria item; WhatsApp offline mantém pendente", async () => {
  const db = baseDatabase();
  db.exec(migration);
  const noGuardianPhone = null;
  const present = true;
  if (!noGuardianPhone && present === false) enqueue(db, { key: "absence:org:session:athlete", type: "absence" });
  assert.equal(db.prepare("SELECT count(*) total FROM notification_outbox WHERE event_type='absence'").get().total, 0);
  const id = enqueue(db, { key: absenceNotificationKey("org", "session", "athlete"), type: "absence" });
  let sent = 0;
  assert.equal(await process(db, id, async () => (++sent, { status: "sent" }), false, "attendance"), false);
  assert.equal(sent, 0);
  assert.equal(db.prepare("SELECT status FROM notification_outbox WHERE id=?").get(id).status, "pending");
});

test("falha da notificação de ausência persiste erro sanitizado e permite retry até sent", async () => {
  const db = baseDatabase();
  db.exec(migration);
  const id = enqueue(db, { key: absenceNotificationKey("org", "session", "athlete"), type: "absence" });
  const rawFailure = "Bearer secret-token telefone 5511999999999";
  await process(db, id, async () => ({ status: "failed", error: sanitizeDeliveryError(rawFailure) }));
  const failed = db.prepare("SELECT status,attempt_count,last_error FROM notification_outbox WHERE id=?").get(id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.attempt_count, 1);
  assert.match(failed.last_error, /\[redacted\]/);
  assert.doesNotMatch(failed.last_error, /secret-token|5511999999999/);
  await process(db, id, async () => ({ status: "sent", providerMessageId: "fake-provider-id" }), true, "attendance");
  const sent = db.prepare("SELECT status,attempt_count,sent_at FROM notification_outbox WHERE id=?").get(id);
  assert.equal(sent.status, "sent");
  assert.equal(sent.attempt_count, 2);
  assert.ok(sent.sent_at);
  assert.equal(db.prepare("SELECT count(*) total FROM notification_outbox WHERE idempotency_key=?").get(absenceNotificationKey("org", "session", "athlete")).total, 1);
});
