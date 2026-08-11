import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  normalizePhone,
  readWhatsAppTestMode,
  canSendToPhone,
  maskPhone,
  validateControlledTestInput,
} = require("../desktop/whatsapp-test-mode.cjs");

const authorized = "5518981518787";
const configuration = readWhatsAppTestMode({
  WHATSAPP_TEST_MODE: "1",
  WHATSAPP_TEST_PHONE: authorized,
});

test("TEST_MODE permite somente o telefone autorizado", () => {
  assert.equal(configuration.enabled, true);
  assert.equal(canSendToPhone(authorized, configuration), true);
  assert.equal(canSendToPhone("5511999999999", configuration), false);
  assert.equal(
    canSendToPhone(authorized, readWhatsAppTestMode({ WHATSAPP_TEST_MODE: "1" })),
    false,
  );
});

test("em 100 notificações somente o telefone autorizado chega ao sender", () => {
  const phones = Array.from({ length: 100 }, (_, index) =>
    index === 47 ? authorized : `55119${String(index).padStart(8, "0")}`,
  );
  const delivered = phones.filter((phone) => canSendToPhone(phone, configuration));
  assert.deepEqual(delivered, [authorized]);
});

test("verificação, reconexão, inicialização e reenvio manual não contornam a whitelist", () => {
  const origins = ["verify_now", "reconnect", "startup", "manual"];
  let senderCalls = 0;
  for (const origin of origins) {
    if (canSendToPhone("5511888888888", configuration)) senderCalls += 1;
    assert.ok(origin);
  }
  assert.equal(senderCalls, 0);
});

test("a barreira final está antes de client.sendMessage e a outbox filtra antes da reserva", () => {
  const connector = readFileSync(
    new URL("../desktop/whatsapp-service.cjs", import.meta.url),
    "utf8",
  );
  const outbox = readFileSync(
    new URL("../app/api/notifications/outbox.ts", import.meta.url),
    "utf8",
  );
  assert.ok(connector.indexOf("canSendToPhone(phone, testMode)") < connector.indexOf("client.sendMessage(chatId, text)"));
  assert.match(connector, /Envio bloqueado pelo TEST_MODE/);
  assert.match(outbox, /phoneFilter/);
  assert.match(outbox, /attempt_count = attempt_count \+ 1/);
  assert.ok(outbox.indexOf("${phoneFilter}") < outbox.indexOf("ORDER BY created_at"));
});

test("normalização aceita o número configurado com ou sem máscara e DDI", () => {
  assert.equal(normalizePhone("(18) 98151-8787"), authorized);
  assert.equal(normalizePhone(`+${authorized}`), authorized);
});

test("health mascara o telefone e usa a mesma configuração da barreira final", () => {
  assert.equal(maskPhone(configuration.allowedPhone), "*********8787");
  const connector = readFileSync(
    new URL("../desktop/whatsapp-service.cjs", import.meta.url),
    "utf8",
  );
  assert.match(connector, /const testMode = readWhatsAppTestMode\(\)/);
  assert.match(connector, /testMode: testMode\.enabled/);
  assert.match(connector, /testPhoneConfigured: Boolean\(testMode\.allowedPhone\)/);
  assert.match(connector, /testPhoneMasked: maskPhone\(testMode\.allowedPhone\)/);
  assert.match(connector, /canSendToPhone\(phone, testMode\)/);
  assert.doesNotMatch(connector, /testPhone:\s*testMode\.allowedPhone/);
});

async function controlledPipeline({ configuration: testConfiguration, phone, message, sender }) {
  const outbox = [];
  const attempts = [];
  const validation = validateControlledTestInput({
    configuration: testConfiguration,
    requestedPhone: phone,
    message,
  });
  if (!validation.valid) return { validation, outbox, attempts };
  outbox.push({ phone: validation.normalizedRequestedPhone, message: validation.normalizedMessage });
  attempts.push({ status: "processing" });
  await sender(validation.normalizedRequestedPhone, validation.normalizedMessage);
  return { validation, outbox, attempts };
}

test("teste controlado entrega ao mock somente o número autorizado completo", async () => {
  const calls = [];
  const result = await controlledPipeline({
    configuration,
    phone: authorized,
    message: "mensagem de teste",
    sender: async (phone, message) => calls.push({ phone, message }),
  });
  assert.equal(result.outbox[0].phone, authorized);
  assert.deepEqual(calls, [{ phone: authorized, message: "mensagem de teste" }]);
  assert.equal(result.attempts.length, 1);
});

test("telefone vazio, diferente, TEST_MODE desligado, sem TEST_PHONE e mensagem vazia bloqueiam antes da outbox", async () => {
  let senderCalls = 0;
  const cases = [
    { configuration, phone: "", message: "teste" },
    { configuration, phone: "5511999999999", message: "teste" },
    { configuration: { enabled: false, allowedPhone: authorized }, phone: authorized, message: "teste" },
    { configuration: { enabled: true, allowedPhone: "" }, phone: authorized, message: "teste" },
    { configuration, phone: authorized, message: "   " },
  ];
  for (const item of cases) {
    const result = await controlledPipeline({
      ...item,
      sender: async () => { senderCalls += 1; },
    });
    assert.equal(result.outbox.length, 0);
    assert.equal(result.attempts.length, 0);
  }
  assert.equal(senderCalls, 0);
});

test("telefone formatado normaliza e só passa quando corresponde exatamente", async () => {
  const calls = [];
  const accepted = await controlledPipeline({
    configuration,
    phone: "+55 (18) 98151-8787",
    message: "teste",
    sender: async (phone) => calls.push(phone),
  });
  assert.equal(accepted.outbox[0].phone, authorized);
  assert.deepEqual(calls, [authorized]);
});

test("rota corrigida persiste requestedPhone e nunca configuredPhone vazio", () => {
  const route = readFileSync(
    new URL("../app/api/internal/notifications/controlled-test/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /phone: requestedPhone/);
  assert.doesNotMatch(route, /phone: configuredPhone/);
  assert.match(route, /\/test-mode\/validate/);
});
