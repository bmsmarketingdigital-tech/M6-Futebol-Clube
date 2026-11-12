import assert from "node:assert/strict";
import test from "node:test";
import { createWhatsAppConnectionHandlers } from "../app/api/check-in/whatsapp-connection-handler.ts";

async function captureLogs(run) {
  const original = console.info;
  const entries = [];
  console.info = (line) => entries.push(JSON.parse(line));
  try { return { value: await run(), entries }; }
  finally { console.info = original; }
}

test("POST connect registra request/provider/Evolution sem telefone nem secrets", async () => {
  const handlers = createWhatsAppConnectionHandlers({
    getContext: async () => ({ membership: { organizationId: "org-safe" } }),
    getStatus: async () => ({ status: "starting" }),
    getProvider: () => "evolution",
    control: async () => ({ status: "starting" }),
  });
  const { value, entries } = await captureLogs(() => handlers.POST(new Request("https://local/api/check-in/whatsapp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "connect", phone: "+55 11 99999-9999" }),
  })));
  assert.equal(value.status, 200);
  const requestId = value.headers.get("x-request-id");
  assert.ok(requestId);
  assert.deepEqual(entries.map((entry) => entry.event), [
    "WHATSAPP_REQUEST_START", "WHATSAPP_PROVIDER_SELECTED", "EVOLUTION_CONNECT_START", "EVOLUTION_CONNECT_RESULT",
  ]);
  assert.equal(entries[0].provider, "evolution");
  assert.ok(entries[0].requestId);
  assert.equal(requestId, entries[0].requestId);
  assert.ok(entries.every((entry) => entry.requestId === requestId));
  assert.equal(JSON.stringify(entries).includes("99999-9999"), false);
});

test("GET registra organization, provider e state", async () => {
  const handlers = createWhatsAppConnectionHandlers({
    getContext: async () => ({ membership: { organizationId: "org-safe" } }),
    getStatus: async () => ({ status: "connected" }),
    getProvider: () => "evolution",
    control: async () => ({ status: "connected" }),
  });
  const { value, entries } = await captureLogs(() => handlers.GET(new Request("https://local/api/check-in/whatsapp")));
  assert.equal(value.status, 200);
  assert.deepEqual(entries, [{ event: "WHATSAPP_STATUS_RESULT", organizationId: "org-safe", provider: "evolution", state: "connected" }]);
});

test("erros POST são sanitizados antes de logar ou responder", async () => {
  const handlers = createWhatsAppConnectionHandlers({
    getContext: async () => ({ membership: { organizationId: "org-safe" } }),
    getStatus: async () => ({ status: "disconnected" }),
    getProvider: () => "evolution",
    control: async () => { throw new Error("Bearer secret-token pairingCode=12345678 phone=5511999999999"); },
  });
  const { value, entries } = await captureLogs(() => handlers.POST(new Request("https://local/api/check-in/whatsapp", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "connect" }),
  })));
  const serialized = JSON.stringify({ body: await value.json(), entries });
  assert.equal(value.status, 500);
  assert.doesNotMatch(serialized, /secret-token|12345678|5511999999999/);
  assert.ok(entries.some((entry) => entry.event === "WHATSAPP_REQUEST_ERROR"));
});
