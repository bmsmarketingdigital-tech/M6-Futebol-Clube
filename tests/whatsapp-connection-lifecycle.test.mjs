import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createWhatsAppBridge } from "../desktop/whatsapp-service.cjs";

class FakeClient extends EventEmitter {
  constructor(control) {
    super();
    this.control = control;
    this.info = null;
    this.pupBrowser = null;
    this.pupPage = null;
  }

  async initialize() {
    this.control.initializeCalls += 1;
    this.control.listenersBeforeInitialize = [
      "authenticated", "ready", "auth_failure", "disconnected", "qr",
      "change_state", "loading_screen",
    ].every((event) => this.listenerCount(event) === 1);
    if (this.control.initializeGate) await this.control.initializeGate;
    if (this.control.failInitialize) throw new Error("initialize failure");
    this.pupBrowser = Object.assign(new EventEmitter(), {
      connected: true,
      process: () => Object.assign(new EventEmitter(), { pid: 4321 }),
    });
    this.pupPage = Object.assign(new EventEmitter(), { isClosed: () => false });
    if (this.control.emitAuthenticated) this.emit("authenticated");
    if (this.control.emitReady) {
      this.info = { wid: { user: "5518981518787" } };
      this.emit("ready");
    }
  }

  async getState() {
    return this.control.internalState ?? "CONNECTED";
  }

  async destroy() {
    this.control.destroyCalls += 1;
  }

  async logout() {
    this.control.logoutCalls += 1;
  }

  async clearAuth() {
    this.control.clearAuthCalls += 1;
  }
}

function setup(overrides = {}) {
  const control = {
    initializeCalls: 0,
    destroyCalls: 0,
    logoutCalls: 0,
    clearAuthCalls: 0,
    emitAuthenticated: true,
    emitReady: true,
    ...overrides,
  };
  const clients = [];
  const bridge = createWhatsAppBridge({
    dataDir: mkdtempSync(join(tmpdir(), "m6-whatsapp-lifecycle-")),
    log: () => {},
    token: "test-token",
    port: 0,
    clientFactory: () => {
      const client = new FakeClient(control);
      clients.push(client);
      return client;
    },
    chromePathResolver: () => "C:\\fake-chrome.exe",
  });
  return { bridge, control, clients };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("1 initialize e chamado uma unica vez por client", async () => {
  const { bridge, control } = setup();
  await bridge.connect();
  await bridge.connect();
  assert.equal(control.initializeCalls, 1);
  await bridge.stop();
});

test("2 start e connect nao criam clients duplicados", async () => {
  const { bridge, control, clients } = setup();
  await bridge.start();
  await Promise.all([bridge.connect(), bridge.connect()]);
  assert.equal(clients.length, 1);
  assert.equal(control.initializeCalls, 1);
  await bridge.stop();
});

test("3 connects concorrentes reutilizam a mesma promise", async () => {
  const gate = deferred();
  const { bridge } = setup({ initializeGate: gate.promise });
  const first = bridge.connect();
  const second = bridge.connect();
  assert.equal(first, second);
  gate.resolve();
  await first;
  await bridge.stop();
});

test("4 authenticated sozinho nao marca connected", async () => {
  const { bridge } = setup({ emitReady: false });
  await bridge.connect();
  assert.equal(bridge.publicState().status, "authenticated");
  await bridge.stop();
});

test("5 ready marca connected", async () => {
  const { bridge } = setup();
  await bridge.connect();
  assert.equal(bridge.publicState().status, "connected");
  await bridge.stop();
});

test("6 disconnected marca connected false", async () => {
  const { bridge, clients } = setup();
  await bridge.connect();
  clients[0].emit("disconnected", "test");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bridge.publicState().status, "disconnected");
  await bridge.stop();
});

test("7 initialize failure limpa estado para nova tentativa", async () => {
  const { bridge, control } = setup({ failInitialize: true, emitAuthenticated: false, emitReady: false });
  await bridge.connect();
  control.failInitialize = false;
  await bridge.connect();
  assert.equal(control.initializeCalls, 2);
  await bridge.stop();
});

test("8 reconnect nao inicia outro client durante initialize ativo", async () => {
  const gate = deferred();
  const { bridge, control, clients } = setup({ initializeGate: gate.promise });
  const requests = Array.from({ length: 20 }, () => bridge.connect());
  assert.equal(clients.length, 1);
  gate.resolve();
  await Promise.all(requests);
  assert.equal(control.initializeCalls, 1);
  await bridge.stop();
});

test("9 listeners completos existem antes de initialize", async () => {
  const { bridge, control } = setup();
  await bridge.connect();
  assert.equal(control.listenersBeforeInitialize, true);
  await bridge.stop();
});

test("10 health consulta o estado da mesma instancia", async () => {
  const port = await availablePort();
  const { bridge } = setup();
  const configured = createWhatsAppBridge({
    dataDir: mkdtempSync(join(tmpdir(), "m6-whatsapp-health-")),
    log: () => {}, token: "test-token", port,
    clientFactory: () => new FakeClient({ initializeCalls: 0, destroyCalls: 0, logoutCalls: 0, clearAuthCalls: 0, emitAuthenticated: true, emitReady: true }),
    chromePathResolver: () => "C:\\fake-chrome.exe",
  });
  await configured.start();
  await configured.connect();
  const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
  assert.equal(health.whatsappConnected, true);
  assert.equal(configured.publicState().status, "connected");
  await configured.stop();
  await bridge.stop();
});

test("11 flags de teste nao alteram clientId ou auth path", async () => {
  process.env.WHATSAPP_TEST_MODE = "1";
  process.env.WHATSAPP_TEST_PHONE = "18981518787";
  const { bridge, clients } = setup();
  await bridge.connect();
  assert.equal(clients.length, 1);
  delete process.env.WHATSAPP_TEST_MODE;
  delete process.env.WHATSAPP_TEST_PHONE;
  await bridge.stop();
});

test("12 stop nao chama logout nem clearAuth", async () => {
  const { bridge, control } = setup();
  await bridge.connect();
  await bridge.stop();
  assert.equal(control.logoutCalls, 0);
  assert.equal(control.clearAuthCalls, 0);
});
