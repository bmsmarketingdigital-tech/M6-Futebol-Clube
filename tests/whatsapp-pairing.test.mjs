import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { performWhatsAppAction } from "../app/whatsapp-action.mjs";
import {
  beginPairingGeneration,
  clearPairingCodeOnOpen,
  copyPairingCodeToClipboard,
  createPairingRequestGate,
  mergePairingPollingStatus,
  pairingFailureStatus,
  WHATSAPP_CONNECT_TIMEOUT_MS,
} from "../app/whatsapp-pairing.mjs";

const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { "content-type": "application/json" },
});
const component = readFileSync(new URL("../app/CommunicationManagement.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("P1 connect aceita resposta simulada de 21s com timeout de 35s", async () => {
  let simulatedElapsed = 0;
  let scheduledTimeout = 0;
  let timeoutCallback;
  const result = await performWhatsAppAction({
    path: "/api/check-in/whatsapp",
    body: { action: "connect" },
    timeoutMs: WHATSAPP_CONNECT_TIMEOUT_MS,
    setTimeoutImpl: (callback, delay) => {
      timeoutCallback = callback;
      scheduledTimeout = delay;
      return 1;
    },
    clearTimeoutImpl: () => {},
    fetchImpl: async (_url, options) => {
      simulatedElapsed = 21_000;
      if (simulatedElapsed >= scheduledTimeout) timeoutCallback();
      assert.equal(options.signal.aborted, false);
      return jsonResponse({ whatsapp: { status: "starting" } });
    },
  });
  assert.equal(WHATSAPP_CONNECT_TIMEOUT_MS, 35_000);
  assert.equal(scheduledTimeout, 35_000);
  assert.equal(simulatedElapsed, 21_000);
  assert.deepEqual(result, { whatsapp: { status: "starting" } });
});

test("P2 e P9 gate bloqueia segundo connect e representa botão disabled enquanto pendente", () => {
  const gate = createPairingRequestGate();
  const first = gate.begin();
  assert.equal(typeof first, "number");
  assert.equal(gate.pending, true);
  assert.equal(gate.begin(), null);
  assert.equal(gate.pending, true);
  gate.complete(first);
  assert.equal(gate.pending, false);
});

test("P3 resposta e polling de geração antiga não substituem a mais recente", () => {
  const gate = createPairingRequestGate();
  const oldGeneration = gate.begin();
  gate.invalidate();
  const staleCompletion = gate.complete(oldGeneration);
  assert.equal(staleCompletion.applied, false);
  const newGeneration = gate.begin();
  assert.notEqual(newGeneration, oldGeneration);
  assert.equal(gate.isCurrent(oldGeneration), false);
  const merged = mergePairingPollingStatus(
    { status: "starting", pairingCode: null },
    { status: "qr", pairingCode: "OLD-CODE" },
    { requestGeneration: oldGeneration, currentGeneration: gate.generation },
  );
  assert.equal(merged, null);
  gate.complete(newGeneration);
});

test("P4 nova geração remove imediatamente código anterior", () => {
  const next = beginPairingGeneration({ status: "qr", pairingCode: "OLD-CODE", qrCodeDataUrl: "old-qr" });
  assert.equal(next.status, "starting");
  assert.equal(next.pairingCode, null);
  assert.equal(next.qrCodeDataUrl, "");
});

test("P5 status starting não restaura código de outra geração", () => {
  const merged = mergePairingPollingStatus(
    { status: "starting", pairingCode: null, qrCodeDataUrl: "" },
    { status: "starting", pairingCode: null },
    { requestGeneration: 8, currentGeneration: 8, pairingCodeGeneration: 7 },
  );
  assert.equal(merged.status, "starting");
  assert.equal(merged.pairingCode, null);
});

test("P6 conexão open limpa pairing code", () => {
  const connected = clearPairingCodeOnOpen({ status: "qr", pairingCode: "OLD-CODE", qrCodeDataUrl: "old-qr" });
  assert.equal(connected.status, "connected");
  assert.equal(connected.pairingCode, null);
  assert.equal(connected.qrCodeDataUrl, "");
});

test("P7 timeout/falha não reapresenta código anterior em polling", () => {
  const gate = createPairingRequestGate();
  const token = gate.begin();
  const completed = gate.complete(token, { failed: true });
  const failed = pairingFailureStatus({ status: "qr", pairingCode: "OLD-CODE", qrCodeDataUrl: "old-qr" }, new Error("timeout"));
  const polled = mergePairingPollingStatus(failed, { status: "qr", pairingCode: "OLD-CODE", qrCodeDataUrl: "old-qr" }, {
    requestGeneration: completed.generation,
    currentGeneration: gate.generation,
    pairingCodeGeneration: null,
    failedGeneration: gate.failedGeneration,
  });
  assert.equal(failed.pairingCode, null);
  assert.equal(failed.qrCodeDataUrl, "");
  assert.equal(polled.pairingCode, null);
  assert.equal(polled.qrCodeDataUrl, "");
});

test("P8 copiar código usa somente Clipboard API", async () => {
  const copied = [];
  let connectCalls = 0;
  await copyPairingCodeToClipboard("RSBR-9SNZ", { writeText: async (value) => copied.push(value) });
  assert.deepEqual(copied, ["RSBR-9SNZ"]);
  assert.equal(connectCalls, 0);
});

test("P8/P9 componente usa botão de cópia separado e desabilita connect durante request", () => {
  assert.match(component, /onClick=\{\(\) => void copyPairingCode\(\)\}/);
  assert.match(component, /disabled=\{busy \|\| !pairingPhone\.trim\(\)\}/);
  assert.match(component, /if \(actionBusy\.current\) return/);
  assert.match(component, /timeoutMs: WHATSAPP_CONNECT_TIMEOUT_MS/);
});

test("código mobile fica grande, contrastante e em uma linha com orientação próxima", () => {
  assert.match(stylesheet, /\.communication-whatsapp-card \.whatsapp-pairing-code\s*\{[^}]*font-size:\s*clamp\(28px, 8vw, 36px\)/s);
  assert.match(stylesheet, /\.whatsapp-pairing-code\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(stylesheet, /\.whatsapp-pairing-code\s*\{[^}]*background:\s*#fff[^}]*color:\s*#102a20/s);
  assert.match(component, /Abra o WhatsApp &gt; Aparelhos conectados &gt; Conectar com número de telefone e digite este código\./);
});

test("falha de Clipboard API não modifica o código e retorna erro amigável", async () => {
  await assert.rejects(
    copyPairingCodeToClipboard("RSBR-9SNZ", { writeText: async () => { throw new Error("permission denied"); } }),
    /Não foi possível copiar o código/,
  );
});
