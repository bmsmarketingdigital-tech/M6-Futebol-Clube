/** @typedef {{ error?: string, whatsapp?: unknown }} WhatsAppActionPayload */

export class WhatsAppActionError extends Error {
  /** @param {"timeout"|"network"|"http"|"invalid"} kind */
  constructor(kind, message) {
    super(message);
    this.name = "WhatsAppActionError";
    this.kind = kind;
  }
}

const CONNECTION_ERROR = "Não foi possível concluir a conexão com o WhatsApp. Tente novamente.";
const NETWORK_ERROR = "Não foi possível acessar o serviço de WhatsApp. Verifique a conexão e tente novamente.";

/** @param {{fetchImpl?: typeof fetch, path: string, body?: unknown, timeoutMs?: number}} options */
export async function performWhatsAppAction({
  fetchImpl = fetch,
  path,
  body,
  timeoutMs = 15000,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeoutImpl(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut || (error instanceof Error && error.name === "AbortError")) {
        throw new WhatsAppActionError("timeout", CONNECTION_ERROR);
      }
      throw new WhatsAppActionError("network", NETWORK_ERROR);
    }

    let payload;
    try {
      const text = await response.text();
      payload = text ? JSON.parse(text) : {};
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid json shape");
    } catch {
      if (timedOut) throw new WhatsAppActionError("timeout", CONNECTION_ERROR);
      throw new WhatsAppActionError("invalid", "O servidor retornou uma resposta inválida. Tente novamente.");
    }
    if (!response.ok) {
      const errorMessage = typeof payload.error === "string" ? payload.error.slice(0, 240) : "Não foi possível concluir a solicitação. Tente novamente.";
      throw new WhatsAppActionError("http", errorMessage);
    }
    return payload;
  } finally {
    clearTimeoutImpl(timer);
  }
}
