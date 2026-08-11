import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WHATSAPP_CLIENT_ID,
  resolveWhatsAppAuthConfig,
} from "../desktop/whatsapp-auth-config.cjs";

const root = new URL("../", import.meta.url);
const [main, service, financialRoute, testMode] = await Promise.all([
  readFile(new URL("desktop/main.cjs", root), "utf8"),
  readFile(new URL("desktop/whatsapp-service.cjs", root), "utf8"),
  readFile(new URL("app/api/notifications/financial-test/route.ts", root), "utf8"),
  readFile(new URL("desktop/whatsapp-test-mode.cjs", root), "utf8"),
]);

test("1 modo normal e TEST_MODE resolvem o mesmo diretorio oficial", () => {
  const normal = resolveWhatsAppAuthConfig("C:\\ProgramData\\M6FutebolClube");
  process.env.WHATSAPP_TEST_MODE = "1";
  const controlled = resolveWhatsAppAuthConfig("C:\\ProgramData\\M6FutebolClube");
  assert.deepEqual(controlled, normal);
  delete process.env.WHATSAPP_TEST_MODE;
});

test("2 telefone de teste nao altera identidade nem path", () => {
  const before = resolveWhatsAppAuthConfig("C:\\ProgramData\\M6FutebolClube");
  process.env.WHATSAPP_TEST_PHONE = "5518981518787";
  assert.deepEqual(resolveWhatsAppAuthConfig("C:\\ProgramData\\M6FutebolClube"), before);
  delete process.env.WHATSAPP_TEST_PHONE;
});

test("3 FINANCIAL_NOTIFICATION_TEST_ENABLED nao altera sessao", () => {
  const before = resolveWhatsAppAuthConfig("C:\\ProgramData\\M6FutebolClube");
  process.env.FINANCIAL_NOTIFICATION_TEST_ENABLED = "1";
  assert.deepEqual(resolveWhatsAppAuthConfig("C:\\ProgramData\\M6FutebolClube"), before);
  delete process.env.FINANCIAL_NOTIFICATION_TEST_ENABLED;
});

test("4 clientId permanece consistente", () => {
  const config = resolveWhatsAppAuthConfig("C:\\ProgramData\\M6FutebolClube");
  assert.equal(WHATSAPP_CLIENT_ID, "baseforte");
  assert.equal(config.clientId, WHATSAPP_CLIENT_ID);
  assert.match(config.sessionPath, /session-baseforte$/);
  assert.match(service, /clientId,/);
});

test("5 startup inicia reconnect uma vez sem criar sessao paralela", () => {
  assert.match(main, /await whatsappBridge\.start\(\)/);
  assert.match(main, /whatsappBridge\.connect\(\)/);
  assert.equal((service.match(/new LocalAuth\(/g) ?? []).length, 1);
  assert.match(service, /SESSION_FOUND/);
  assert.match(service, /READY:/);
});

test("6 funcoes de teste nao executam logout nem limpeza de auth", () => {
  assert.doesNotMatch(financialRoute, /logout|removeAuth|clearAuth|rmSync/i);
  assert.doesNotMatch(testMode, /logout|removeAuth|clearAuth|rmSync/i);
  assert.doesNotMatch(main, /logout|removeAuth|clearAuth|rmSync/i);
});
