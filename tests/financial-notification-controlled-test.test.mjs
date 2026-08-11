import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FINANCIAL_TEST_CONFIRMATION,
  financialTestIdempotencyKey,
  readFinancialTestConfiguration,
  referenceDateForFinancialTest,
  validateFinancialTestRequest,
} from "../app/api/notifications/financial-test.ts";

const root = new URL("../", import.meta.url);
const [automation, route, outbox, bridge, triggers] = await Promise.all([
  readFile(new URL("app/api/finance/billing-automation.ts", root), "utf8"),
  readFile(new URL("app/api/notifications/financial-test/route.ts", root), "utf8"),
  readFile(new URL("app/api/notifications/outbox.ts", root), "utf8"),
  readFile(new URL("desktop/whatsapp-service.cjs", root), "utf8"),
  readFile(new URL("db/notification-history-triggers.ts", root), "utf8"),
]);

const settings = {
  enabled: true,
  beforeDueEnabled: true,
  beforeDueDays: 3,
  dueTodayEnabled: true,
  overdueEnabled: true,
  overdueDays: 5,
};
const configuration = readFinancialTestConfiguration({
  WHATSAPP_TEST_MODE: "1",
  WHATSAPP_TEST_PHONE: "+55 (18) 98151-8787",
  FINANCIAL_NOTIFICATION_TEST_ENABLED: "1",
});
const validRequest = {
  type: "before_due",
  testPhone: "18981518787",
  runId: "release-20260811",
  confirmation: FINANCIAL_TEST_CONFIRMATION,
  configuration,
};

test("1 before_due usa o gerador real e uma data de referencia aplicavel", () => {
  assert.equal(referenceDateForFinancialTest("before_due", "2026-08-10", settings), "2026-08-07");
  assert.match(automation, /export function buildBillingNotification/);
  assert.match(automation, /vence em \$\{difference\} dia/);
  assert.match(route, /buildBillingNotification\(payment, referenceDate, settings\)/);
});

test("2 due_today usa o mesmo template real", () => {
  assert.equal(referenceDateForFinancialTest("due_today", "2026-08-10", settings), "2026-08-10");
  assert.match(automation, /type: "due_today"/);
  assert.match(automation, /vence hoje/);
});

test("3 overdue usa o mesmo template real", () => {
  assert.equal(referenceDateForFinancialTest("overdue", "2026-08-10", settings), "2026-08-15");
  assert.match(automation, /type: "overdue"/);
  assert.match(automation, /consta em aberto/);
});

test("4 telefone configurado correto e confirmacao administrativa sao aceitos", () => {
  assert.equal(validateFinancialTestRequest(validRequest).valid, true);
  assert.match(route, /context\.role !== "admin"/);
});

test("5 telefone diferente e modo incompleto sao bloqueados", () => {
  assert.equal(validateFinancialTestRequest({ ...validRequest, testPhone: "5511999999999" }).valid, false);
  assert.equal(
    readFinancialTestConfiguration({ WHATSAPP_TEST_MODE: "1", WHATSAPP_TEST_PHONE: "18981518787" }).enabled,
    false,
  );
});

test("6 fallback para telefone real e impossivel", () => {
  assert.match(route, /phone: validation\.testPhone/);
  assert.match(outbox, /currentPhone !== normalizePhone\(financialTest\.authorizedPhone\)/);
  assert.match(bridge, /canSendToPhone\(phone, testMode\)/);
  assert.ok(bridge.indexOf("canSendToPhone(phone, testMode)") < bridge.indexOf("client.sendMessage"));
});

test("7 quarta mensagem do mesmo run e bloqueada", () => {
  assert.match(route, /\(count\?\.total \?\? 0\) >= 3/);
  assert.match(route, /Limite absoluto de tres envios atingido/);
  assert.match(route, /idempotency_key IN \(\?,\?,\?\)/);
  assert.doesNotMatch(route, /\b(?:LIKE|GLOB)\b/i);
});

test("8 tipo duplicado e bloqueado pela consulta e idempotencia", () => {
  assert.equal(financialTestIdempotencyKey("release-20260811", "due_today"), "financial-test:release-20260811:due_today");
  assert.match(route, /Este tipo ja foi executado neste teste/);
  assert.match(outbox, /ON CONFLICT\(idempotency_key\) DO NOTHING/);
});

test("9 outbox de teste recebe marcador inequivoco e apenas uma tentativa", () => {
  assert.match(route, /financialTestIdempotencyKey/);
  assert.match(route, /eventType: validation\.type/);
  assert.match(route, /maxAttempts: 1/);
});

test("10 worker geral nao processa outbox durante o modo financeiro", () => {
  assert.match(outbox, /financialNotificationTestEnabled\(\) && !dependencies\.notificationId/);
  assert.match(outbox, /event_type != 'controlled_test'/);
  assert.match(outbox, /quarantineExpiredLocks\(organizationId, dependencies\.notificationId\)/);
});

test("11 revalidacao financeira real recebe o contexto temporal controlado", () => {
  assert.match(route, /financialTest: \{/);
  assert.match(outbox, /revalidateFinancialNotification\(/);
  assert.match(outbox, /financialTest\?\.referenceDate \?\? saoPauloDate\(\)/);
});

test("12 mensalidade paga ou cancelada e recusada", () => {
  assert.match(outbox, /\["paid", "cancelled"\]\.includes\(String\(current\.status\)\)/);
});

test("13 saldo zero e recusado", () => {
  assert.match(outbox, /balance <= 0/);
});

test("14 atleta inativo e telefone logico invalido sao recusados", () => {
  assert.match(outbox, /!Number\(current\.athleteActive\)/);
  assert.match(outbox, /if \(!guardianPhone\)/);
});

test("15 WhatsApp desconectado e conector sem TEST_MODE bloqueiam antes da outbox", () => {
  assert.ok(route.indexOf("whatsapp.status") < route.lastIndexOf("enqueueNotification"));
  assert.ok(route.indexOf("validateWhatsAppTestMode") < route.lastIndexOf("enqueueNotification"));
});

test("16 attempt real e criada somente depois da revalidacao", () => {
  assert.ok(outbox.indexOf("revalidateFinancialNotification") < outbox.indexOf("beginAttempt(item"));
  assert.match(outbox, /INSERT INTO notification_attempts/);
});

test("17 finalizacao sent atualiza outbox e attempt pela cadeia real", () => {
  assert.match(outbox, /SET status = \?, last_error = \?, sent_at = \?, provider_message_id = \?/);
  assert.match(outbox, /UPDATE notification_attempts/);
  assert.match(route, /processNotificationQueue\(organizationId, "controlled_test"/);
});

test("18 historicos finais continuam protegidos", () => {
  assert.match(triggers, /billing_notifications_immutable_final_update/);
  assert.match(triggers, /notification_outbox_immutable_final_update/);
  assert.match(triggers, /notification_attempts_immutable_final_update/);
});

test("19 rota controlada nao importa nem chama Asaas", () => {
  assert.doesNotMatch(route, /asaas/i);
  assert.match(route, /FINANCIAL_NOTIFICATION_TEST_ENABLED|readFinancialTestConfiguration/);
});
