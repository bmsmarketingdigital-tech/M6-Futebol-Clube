import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const [provider, bridge, outbox, envExample] = await Promise.all([
  readFile(new URL("app/api/check-in/evolution-provider.ts", root), "utf8"),
  readFile(new URL("app/api/check-in/whatsapp-bridge.ts", root), "utf8"),
  readFile(new URL("app/api/notifications/outbox.ts", root), "utf8"),
  readFile(new URL(".env.example", root), "utf8"),
]);

test("Evolution usa as mesmas variaveis do projeto de referencia e endpoint v2", () => {
  assert.match(provider, /EVOLUTION_API_URL/);
  assert.match(provider, /EVOLUTION_API_KEY/);
  assert.match(provider, /EVOLUTION_API_INSTANCE/);
  assert.match(provider, /\/message\/sendText\/\$\{config\.instance\}/);
  assert.match(provider, /apikey: config\.apiKey/);
  assert.match(provider, /delay: 1200/);
  assert.match(provider, /number/);
  assert.match(provider, /text/);
});

test("Evolution entra como provider, mas a outbox segura continua controlando tentativa e idempotencia", () => {
  assert.match(bridge, /sendEvolutionWhatsAppMessage\(phone, message\)/);
  assert.match(bridge, /Evolution API configurada para envio em nuvem/);
  assert.match(outbox, /reserveNext/);
  assert.match(outbox, /beginAttempt/);
  assert.match(outbox, /finishAttempt/);
  assert.match(outbox, /ON CONFLICT\(idempotency_key\) DO NOTHING/);
});

test("ambiente documenta Evolution sem remover o conector local", () => {
  assert.match(envExample, /WHATSAPP_BRIDGE_URL=/);
  assert.match(envExample, /EVOLUTION_API_URL=/);
  assert.match(envExample, /EVOLUTION_API_KEY=/);
  assert.match(envExample, /EVOLUTION_API_INSTANCE=/);
});
