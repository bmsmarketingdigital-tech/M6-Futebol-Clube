import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const root = new URL("../", import.meta.url);
const savedEnv = {
  EVOLUTION_API_URL: process.env.EVOLUTION_API_URL,
  EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY,
  EVOLUTION_API_INSTANCE_MAP: process.env.EVOLUTION_API_INSTANCE_MAP,
  EVOLUTION_API_INSTANCE: process.env.EVOLUTION_API_INSTANCE,
  EVOLUTION_API_ORGANIZATION_ID: process.env.EVOLUTION_API_ORGANIZATION_ID,
  WHATSAPP_BRIDGE_URL: process.env.WHATSAPP_BRIDGE_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  POSTGRES_URL: process.env.POSTGRES_URL,
};

const orgA = "org-a-123";
const orgB = "org-b-456";
const source = {
  EVOLUTION_API_URL: "https://evolution.invalid",
  EVOLUTION_API_KEY: "test-secret-api-key",
  EVOLUTION_API_INSTANCE_MAP: JSON.stringify({ [orgA]: "instance-a", [orgB]: "instance-b" }),
  WHATSAPP_BRIDGE_URL: "",
};

Object.assign(process.env, source);
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

const provider = await tsImport("../app/api/check-in/evolution-provider.ts", import.meta.url);
const selection = await tsImport("../app/api/check-in/whatsapp-provider-selection.ts", import.meta.url);
const statusHelpers = await tsImport("../app/api/check-in/whatsapp-evolution-status.ts", import.meta.url);
const diagnostics = await tsImport("../app/api/internal/whatsapp-diagnostics-handler.ts", import.meta.url);
const connectionRoute = await tsImport("../app/api/check-in/whatsapp-connection-handler.ts", import.meta.url);

for (const [name, value] of Object.entries(savedEnv)) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("Evolution resolve instância isolada por organização e rejeita mapas inválidos ou duplicados", () => {
  assert.equal(provider.getEvolutionConfig(orgA, source)?.instance, "instance-a");
  assert.equal(provider.getEvolutionConfig(orgB, source)?.instance, "instance-b");
  assert.equal(provider.getEvolutionConfig("org-c", source), null);
  assert.equal(provider.getEvolutionConfig(orgA, { ...source, EVOLUTION_API_INSTANCE_MAP: "{" }), null);
  assert.equal(provider.getEvolutionConfig(orgA, {
    ...source,
    EVOLUTION_API_INSTANCE_MAP: JSON.stringify({ [orgA]: "same", [orgB]: "same" }),
  }), null);
  assert.equal(provider.getEvolutionConfig(orgA, {
    ...source,
    EVOLUTION_API_INSTANCE: "legacy",
    EVOLUTION_API_INSTANCE_MAP: "{}",
  }), null);
  assert.equal(provider.getEvolutionConfig(orgA, {
    ...source,
    EVOLUTION_API_INSTANCE: "legacy",
    EVOLUTION_API_INSTANCE_MAP: "{}",
    EVOLUTION_API_ORGANIZATION_ID: orgA,
  })?.instance, "legacy");
});
test("provider seleciona local, Evolution mapeada ou nenhum sem fallback global", () => {
  assert.equal(selection.selectWhatsAppProvider(orgA, { ...source, WHATSAPP_BRIDGE_URL: "http://127.0.0.1:9999" }), "local");
  assert.equal(selection.selectWhatsAppProvider(orgA, source), "evolution");
  assert.equal(selection.selectWhatsAppProvider(orgA, { EVOLUTION_API_URL: source.EVOLUTION_API_URL, EVOLUTION_API_KEY: source.EVOLUTION_API_KEY, EVOLUTION_API_INSTANCE: "global" }), "none");
  assert.equal(selection.selectWhatsAppProvider(orgA, {}), "none");
});

test("status em polling é read-only e não chama connect nem gera QR/pairing", async () => {
  let connectCalls = 0;
  const calls = [];
  const deps = {
    getState: async (id) => { calls.push(["state", id]); return "close"; },
    getConnectedPhone: async () => { throw new Error("não consulta telefone se fechado"); },
    getStoredPhones: async () => ({ expectedPhone: null }),
    connect: async () => { connectCalls += 1; },
    now: () => "2026-01-01T00:00:00.000Z",
  };
  const first = await statusHelpers.readEvolutionWhatsAppStatus(orgA, deps);
  const second = await statusHelpers.readEvolutionWhatsAppStatus(orgA, deps);
  assert.equal(first.status, "disconnected");
  assert.equal(second.status, "disconnected");
  assert.deepEqual(calls, [["state", orgA], ["state", orgA]]);
  assert.equal(connectCalls, 0);
  assert.equal(first.qrCodeDataUrl, "");
  assert.equal(first.pairingCode, null);
});

test("consulta status connected verifica telefone sem persistir estado", async () => {
  let writes = 0;
  const status = await statusHelpers.readEvolutionWhatsAppStatus(orgA, {
    getState: async () => "open",
    getConnectedPhone: async () => "5511987654321",
    getStoredPhones: async () => ({ expectedPhone: "+55 11 98765-4321" }),
    setConfirmedPhone: async () => { writes += 1; },
    now: () => "2026-01-01T00:00:00.000Z",
  });
  assert.equal(status.phoneVerification, "confirmed");
  assert.equal(writes, 0);
});

test("somente a operação explícita de connect chama endpoint de pairing/QR", async () => {
  const previousFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ pairingCode: "ABCD1234" }), { status: 200 });
  };
  try {
    const result = await provider.getEvolutionConnectPayload(orgA, "+55 (11) 98765-4321");
    assert.equal(result.pairingCode, "ABCD1234");
    assert.match(requestedUrl, /\/instance\/connect\/instance-a\?number=5511987654321$/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("telefone conectado usa ownerJid/number; unknown nunca é considerado confirmado", () => {
  const payload = [{ instanceName: "instance-a", ownerJid: "5511987654321@s.whatsapp.net" }];
  const phone = provider.parseEvolutionConnectedPhone(payload, "instance-a");
  assert.equal(phone, "5511987654321");
  assert.equal(provider.verifyEvolutionPhone("+55 (11) 98765-4321", phone), "confirmed");
  assert.equal(provider.verifyEvolutionPhone("5511999990000", phone), "mismatch");
  assert.equal(provider.verifyEvolutionPhone("5511987654321", null), "unknown");
  assert.equal(statusHelpers.canSendEvolution({ status: "connected", phoneVerification: "confirmed" }), true);
  assert.equal(statusHelpers.canSendEvolution({ status: "connected", phoneVerification: "mismatch" }), false);
  assert.equal(statusHelpers.canSendEvolution({ status: "connected", phoneVerification: "unknown" }), false);
});

test("diagnóstico exercita handler real, usa tenant autenticado e não faz rede", async () => {
  let requests = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests += 1; throw new Error("network forbidden in diagnostics test"); };
  const env = {
    ...source,
    EVOLUTION_API_KEY: "secret-never-return-this",
    DATABASE_URL: "postgres://secret-never-return-this",
    CRON_SECRET: "secret-never-return-this",
    WHATSAPP_BRIDGE_TOKEN: "secret-never-return-this",
  };
  try {
    const handler = diagnostics.createWhatsAppDiagnosticsGet({
      getContext: async () => ({ membership: { organizationId: orgA } }),
      getEnv: () => env,
      getEvolution: provider.getEvolutionConfig,
      evolutionIsConfigured: provider.evolutionConfigured,
      selectProvider: selection.selectWhatsAppProvider,
      bridgeIsConfigured: selection.whatsappBridgeConfigured,
      getRuntimePresence: (runtime) => ({
        whatsappBridgeUrlPresent: Boolean(runtime.WHATSAPP_BRIDGE_URL?.trim()),
        evolutionApiUrlPresent: Boolean(runtime.EVOLUTION_API_URL?.trim()),
        evolutionApiKeyPresent: Boolean(runtime.EVOLUTION_API_KEY?.trim()),
        evolutionInstanceMapPresent: Boolean(runtime.EVOLUTION_API_INSTANCE_MAP?.trim()),
      }),
      getInstanceName: (config) => config?.instance ?? null,
    });
    const response = await handler(new Request("https://school.invalid/api/internal/whatsapp-diagnostics?organizationId=org-b-456"));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.organizationId, orgA);
    assert.equal(body.evolution.instanceName, "instance-a");
    assert.equal(body.providerSelection.selected, "evolution");
    assert.equal(JSON.stringify(body).includes("secret-never-return-this"), false);
    assert.equal(requests, 0);

    const unauthenticated = diagnostics.createWhatsAppDiagnosticsGet({
      getContext: async () => null, getEnv: () => env,
      getEvolution: provider.getEvolutionConfig, evolutionIsConfigured: provider.evolutionConfigured,
      selectProvider: selection.selectWhatsAppProvider, bridgeIsConfigured: selection.whatsappBridgeConfigured,
      getRuntimePresence: () => ({}), getInstanceName: () => null,
    });
    const denied = await unauthenticated(new Request("https://school.invalid/api/internal/whatsapp-diagnostics"));
    assert.equal(denied.status, 401);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("rota WhatsApp usa somente organizationId da membership para GET e POST", async () => {
  const seen = [];
  const handlers = connectionRoute.createWhatsAppConnectionHandlers({
    getContext: async () => ({ membership: { organizationId: orgA } }),
    getStatus: async (organizationId) => { seen.push(["status", organizationId]); return { status: "disconnected" }; },
    control: async (organizationId, action, phone) => { seen.push(["control", organizationId, action, phone]); return { status: "qr" }; },
  });
  const getResponse = await handlers.GET(new Request(`https://school.invalid/api/check-in/whatsapp?organizationId=${orgB}`));
  assert.equal(getResponse.status, 200);
  const postResponse = await handlers.POST(new Request("https://school.invalid/api/check-in/whatsapp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "connect", phone: "+55 11 98765-4321", organizationId: orgB }),
  }));
  assert.equal(postResponse.status, 200);
  assert.deepEqual(seen, [
    ["status", orgA],
    ["control", orgA, "connect", "+55 11 98765-4321"],
  ]);

  const denied = connectionRoute.createWhatsAppConnectionHandlers({ getContext: async () => null });
  assert.equal((await denied.GET(new Request("https://school.invalid/api/check-in/whatsapp"))).status, 401);
});

test("rota de teste fixo está desativada e não contém destinatário legado", async () => {
  const route = await readFile(new URL("app/api/check-in/whatsapp/test/route.ts", root), "utf8");
  const ui = await readFile(new URL("app/CommunicationManagement.tsx", root), "utf8");
  assert.match(route, /status:\s*410/);
  assert.doesNotMatch(route, /18981518787/);
  assert.doesNotMatch(ui, /18981518787/);
});
