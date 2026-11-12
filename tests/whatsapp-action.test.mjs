import assert from "node:assert/strict";
import test from "node:test";
import { performWhatsAppAction, WhatsAppActionError } from "../app/whatsapp-action.mjs";

const response = (status, body) => new Response(body, { status, headers: { "content-type": "application/json" } });

test("ação WhatsApp aborta ao estourar o timeout de 15s configurado", async () => {
  await assert.rejects(
    performWhatsAppAction({
      path: "/api/check-in/whatsapp",
      timeoutMs: 5,
      fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    }),
    (error) => error instanceof WhatsAppActionError && error.kind === "timeout"
      && error.message === "Não foi possível concluir a conexão com o WhatsApp. Tente novamente.",
  );
});

test("ação WhatsApp apresenta falha de rede sem expor Failed to fetch", async () => {
  await assert.rejects(
    performWhatsAppAction({ path: "/api/check-in/whatsapp", fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }),
    (error) => error.kind === "network" && !error.message.includes("Failed to fetch"),
  );
});

test("ação WhatsApp separa HTTP 500 e resposta JSON inválida", async () => {
  await assert.rejects(
    performWhatsAppAction({ path: "/api/check-in/whatsapp", fetchImpl: async () => response(500, JSON.stringify({ error: "Falha sanitizada" })) }),
    (error) => error.kind === "http" && error.message === "Falha sanitizada",
  );
  await assert.rejects(
    performWhatsAppAction({ path: "/api/check-in/whatsapp", fetchImpl: async () => response(200, "not json") }),
    (error) => error.kind === "invalid" && error.message.includes("resposta inválida"),
  );
});

test("ação WhatsApp aceita resposta JSON válida", async () => {
  const result = await performWhatsAppAction({
    path: "/api/check-in/whatsapp",
    body: { action: "connect" },
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, "POST");
      assert.equal(options.signal instanceof AbortSignal, true);
      return response(200, JSON.stringify({ whatsapp: { status: "starting" } }));
    },
  });
  assert.deepEqual(result, { whatsapp: { status: "starting" } });
});
