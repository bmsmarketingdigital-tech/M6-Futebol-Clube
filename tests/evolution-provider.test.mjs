import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const [provider, bridge, selection, status, outbox, envExample, health] = await Promise.all([
  readFile(new URL("app/api/check-in/evolution-provider.ts", root), "utf8"),
  readFile(new URL("app/api/check-in/whatsapp-bridge.ts", root), "utf8"),
  readFile(new URL("app/api/check-in/whatsapp-provider-selection.ts", root), "utf8"),
  readFile(new URL("app/api/check-in/whatsapp-evolution-status.ts", root), "utf8"),
  readFile(new URL("app/api/notifications/outbox.ts", root), "utf8"),
  readFile(new URL(".env.example", root), "utf8"),
  readFile(new URL("app/api/cloud/health/route.ts", root), "utf8"),
]);

test("Evolution usa configuração server-side e endpoint v2 por organização", () => {
  assert.match(provider, /EVOLUTION_API_URL/);
  assert.match(provider, /EVOLUTION_API_KEY/);
  assert.match(provider, /EVOLUTION_API_INSTANCE_MAP/);
  assert.match(provider, /getEvolutionConfig\(organizationId/);
  assert.match(provider, /\/message\/sendText\/\$\{encodeURIComponent\(config\.instance\)\}/);
  assert.match(provider, /apikey: config\.apiKey/);
  assert.match(provider, /delay: 1200/);
});

test("seleção é por organização e status não chama o endpoint de connect", () => {
  assert.match(selection, /selectWhatsAppProvider\(\s*organizationId/);
  assert.match(selection, /evolutionConfigured\(organizationId, source\)/);
  const statusBody = status.slice(status.indexOf("export async function readEvolutionWhatsAppStatus"));
  assert.doesNotMatch(statusBody, /getEvolutionConnectPayload|\/instance\/connect/);
  assert.match(bridge, /readEvolutionWhatsAppStatus\(organizationId/);
  assert.match(bridge, /canSendEvolution\(status\)/);
});

test("outbox recebe organização no status reader e no sender", () => {
  assert.match(outbox, /statusReader\(organizationId\)/);
  assert.match(outbox, /sender\(item\.organizationId, item\.phone, item\.message\)/);
  assert.match(outbox, /reserveNext/);
  assert.match(outbox, /beginAttempt/);
  assert.match(outbox, /finishAttempt/);
  assert.match(outbox, /ON CONFLICT\(idempotency_key\) DO NOTHING/);
});

test("ambiente documenta mapa, vínculo legado explícito e health reconhece o mapa", () => {
  assert.match(envExample, /WHATSAPP_BRIDGE_URL=/);
  assert.match(envExample, /EVOLUTION_API_URL=/);
  assert.match(envExample, /EVOLUTION_API_KEY=/);
  assert.match(envExample, /EVOLUTION_API_INSTANCE=/);
  assert.match(envExample, /EVOLUTION_API_INSTANCE_MAP=/);
  assert.match(envExample, /EVOLUTION_API_ORGANIZATION_ID=/);
  assert.match(health, /evolutionConfigurationPresent/);
});
