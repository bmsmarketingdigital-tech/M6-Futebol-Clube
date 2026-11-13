import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildBillingNotification } from "../app/api/notifications/financial-message.ts";
import {
  evaluateAbsenceSnapshot,
  evaluateEnrollmentSnapshot,
  evaluateFinancialSnapshot,
  parseAbsenceIdempotencyKey,
} from "../app/api/notifications/revalidation-rules.mjs";

const now = Date.parse("2026-11-13T12:00:00-03:00");
const absence = {
  id: "n1", organizationId: "org", athleteId: "athlete", teamId: "team",
  eventType: "absence", idempotencyKey: "absence:org:session:athlete",
  phone: "5511999999999", createdAt: Math.floor(now / 1000) - 60,
};
const session = { id: "session", organizationId: "org", teamId: "team", sessionDate: "2026-11-13", status: "completed" };
const record = { athleteId: "athlete", present: false };
const athlete = { organizationId: "org", active: true, guardianPhone: "+55 (11) 99999-9999" };
const membership = { teamId: "team", active: true };
const outboxSource = readFileSync(new URL("../app/api/notifications/outbox.ts", import.meta.url), "utf8");
const validAbsence = (overrides = {}) => evaluateAbsenceSnapshot({
  item: absence, session, record, athlete, teamMembership: membership, now, ...overrides,
});

test("ausência válida ainda marcada como ausente pode ser enviada", () => assert.deepEqual(validAbsence(), { kind: "valid" }));
test("ausência corrigida para presente é invalidada", () => assert.equal(validAbsence({ record: { ...record, present: true } }).reason, "attendance_no_longer_absent"));
test("sessão cancelada ou removida é invalidada", () => {
  assert.equal(validAbsence({ session: { ...session, status: "canceled" } }).reason, "attendance_session_cancelled");
  assert.equal(validAbsence({ session: null }).reason, "attendance_session_not_found");
});
test("ausência expirada após duas horas ou fim do dia local é invalidada", () => {
  assert.equal(validAbsence({ now: now + 2 * 60 * 60 * 1000 + 1 }).reason, "notification_expired");
  assert.equal(validAbsence({ now: Date.parse("2026-11-14T00:00:01-03:00") }).reason, "notification_expired");
});
test("telefone alterado ou ausente nunca reutiliza destino antigo", () => {
  assert.equal(validAbsence({ athlete: { ...athlete, guardianPhone: "5511888888888" } }).reason, "phone_changed");
  assert.equal(validAbsence({ athlete: { ...athlete, guardianPhone: null } }).reason, "phone_missing");
});
test("retry de ausência revalida a chamada atual em cada tentativa", () => {
  assert.deepEqual(validAbsence(), { kind: "valid" });
  assert.equal(validAbsence({ record: { ...record, present: true } }).reason, "attendance_no_longer_absent");
});
test("chave de ausência é parseada defensivamente e isolada por organização/atleta", () => {
  assert.deepEqual(parseAbsenceIdempotencyKey(absence.idempotencyKey, "org", "athlete"), { sessionId: "session" });
  assert.equal(parseAbsenceIdempotencyKey(absence.idempotencyKey, "other", "athlete"), null);
  assert.equal(parseAbsenceIdempotencyKey("absence:org:session:athlete:extra", "org", "athlete"), null);
});
test("enrollment só continua válido com atleta, vínculo, telefone e dentro de 24h", () => {
  const item = { ...absence, eventType: "enrollment", idempotencyKey: "enrollment:org:athlete:team" };
  const check = (overrides = {}) => evaluateEnrollmentSnapshot({ item, athlete, teamMembership: membership, now, ...overrides });
  assert.deepEqual(check(), { kind: "valid" });
  assert.equal(check({ teamMembership: { ...membership, active: false } }).reason, "athlete_not_in_team");
  assert.equal(check({ now: now + 24 * 60 * 60 * 1000 + 1 }).reason, "notification_expired");
  const unassigned = { ...item, teamId: null, idempotencyKey: "enrollment:org:athlete:unassigned" };
  assert.deepEqual(evaluateEnrollmentSnapshot({ item: unassigned, athlete, teamMembership: null, now }), { kind: "valid" });
});

test("financeiro aberto com saldo continua elegível; quitado/cancelado é superseded", () => {
  const item = { ...absence, eventType: "overdue", paymentId: "payment", idempotencyKey: "billing:payment:overdue" };
  const current = {
    organizationId: "org", athleteId: "athlete", status: "overdue", amountCents: 5000,
    paidAmountCents: 0, athleteActive: true, guardianPhone: athlete.guardianPhone, enabled: true,
  };
  const check = (snapshot = current) => evaluateFinancialSnapshot({ item, current: snapshot });
  assert.equal(check().kind, "valid"); // F1
  assert.equal(check({ ...current, status: "paid" }).reason, "payment_already_settled"); // F2/F4, including every retry
  assert.equal(check({ ...current, status: "cancelled" }).reason, "payment_cancelled"); // F3
  assert.equal(check({ ...current, amountCents: 5000, paidAmountCents: 5000 }).reason, "payment_no_balance");
});

test("financeiro desabilitado ou com telefone trocado é invalidado", () => {
  const item = { ...absence, eventType: "due_today", paymentId: "payment" };
  const current = {
    organizationId: "org", athleteId: "athlete", status: "open", amountCents: 5000,
    paidAmountCents: 0, athleteActive: true, guardianPhone: athlete.guardianPhone, enabled: true,
  };
  assert.equal(evaluateFinancialSnapshot({ item, current: { ...current, enabled: false } }).reason, "notification_disabled");
  assert.equal(evaluateFinancialSnapshot({ item, current: { ...current, guardianPhone: "5511888888888" } }).reason, "phone_changed");
});

test("mensagem financeira é reconstruída com valor e vencimento atuais", () => {
  const settings = { enabled: true, beforeDueEnabled: true, beforeDueDays: 3, dueTodayEnabled: true, overdueEnabled: true, overdueDays: 5 };
  const oldMessage = buildBillingNotification({ athleteName: "Atleta", amountCents: 8000, paidAmountCents: 0, dueDate: "2026-11-13" }, "2026-11-13", settings)?.message;
  const refreshed = buildBillingNotification({ athleteName: "Atleta", amountCents: 10000, paidAmountCents: 2500, dueDate: "2026-11-13" }, "2026-11-13", settings)?.message;
  assert.ok(oldMessage);
  assert.ok(refreshed);
  assert.notEqual(refreshed, oldMessage); // F5: refresh uses current balance.
});

test("invalid/transient são tratados antes do provider e sem tentativa de entrega", () => {
  const queue = outboxSource.slice(outboxSource.indexOf("async function runNotificationQueue"));
  assert.ok(queue.indexOf("revalidateNotification(") < queue.indexOf("beginAttempt(item"));
  assert.ok(queue.indexOf('validation.kind === "invalid"') < queue.indexOf("beginAttempt(item"));
  assert.match(queue, /validation\.kind === "transient_error"[\s\S]*?deferRevalidation\(item, validation\.error\)/);
  assert.match(outboxSource, /status = 'superseded'/);
  assert.match(outboxSource, /event_type != 'controlled_test'/);
});
