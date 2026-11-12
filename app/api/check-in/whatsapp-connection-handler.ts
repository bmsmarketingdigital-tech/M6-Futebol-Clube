import { randomUUID } from "node:crypto";

export type WhatsAppConnectionContext = { membership: { organizationId: string } };

export type WhatsAppConnectionDependencies<Status = unknown> = {
  getContext: (request: Request) => Promise<WhatsAppConnectionContext | null>;
  getStatus: (organizationId: string) => Promise<Status>;
  control: (organizationId: string, action: "connect" | "disconnect", phone?: string) => Promise<Status>;
  getProvider?: (organizationId: string) => string;
};

function safeError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "Unknown error");
  return raw
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/(?:api[_-]?key|token|authorization|pairing(?:\s|_)?code)\s*[:=]\s*[^\s,;]+/gi, "[secret redacted]")
    .replace(/\b[A-Za-z0-9]{4}-[A-Za-z0-9]{4}\b/g, "[code redacted]")
    .replace(/\+?\d[\d ().-]{7,}\d/g, "[phone redacted]")
    .replace(/\b\d{6,15}\b/g, "[number redacted]")
    .replace(/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9._-]{10,}\b/g, "[token redacted]")
    .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, "[secret redacted]")
    .slice(0, 300);
}

function log(event: string, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ event, ...fields }));
}

export function createWhatsAppConnectionHandlers<Status>(dependencies: WhatsAppConnectionDependencies<Status>) {
  return {
    async GET(request: Request) {
      const context = await dependencies.getContext(request);
      if (!context) return Response.json({ error: "Faça login para configurar o WhatsApp." }, { status: 401 });
      const organizationId = context.membership.organizationId;
      const provider = dependencies.getProvider?.(organizationId) ?? "unknown";
      const whatsapp = await dependencies.getStatus(organizationId);
      const state = typeof whatsapp === "object" && whatsapp !== null && "status" in whatsapp
        ? String((whatsapp as { status: unknown }).status).slice(0, 40)
        : "unknown";
      log("WHATSAPP_STATUS_RESULT", { organizationId, provider, state });
      return Response.json({ whatsapp });
    },
    async POST(request: Request) {
      const context = await dependencies.getContext(request);
      if (!context) return Response.json({ error: "Faça login para configurar o WhatsApp." }, { status: 401 });
      const requestId = randomUUID();
      const startedAt = Date.now();
      const organizationId = context.membership.organizationId;
      const provider = dependencies.getProvider?.(organizationId) ?? "unknown";
      let action = "unknown";
      let requestStarted = false;
      try {
        const payload = await request.json() as { action?: string; phone?: string };
        action = payload.action ?? "unknown";
        log("WHATSAPP_REQUEST_START", { requestId, organizationId, action, provider });
        requestStarted = true;
        log("WHATSAPP_PROVIDER_SELECTED", { requestId, organizationId, provider });
        if (payload.action !== "connect" && payload.action !== "disconnect") {
          return Response.json({ error: "Ação inválida." }, { status: 400, headers: { "x-request-id": requestId } });
        }
        if (payload.action === "connect" && provider === "evolution") {
          log("EVOLUTION_CONNECT_START", { requestId, organizationId });
        }
        const operationStartedAt = Date.now();
        const whatsapp = await dependencies.control(organizationId, payload.action, payload.phone);
        if (payload.action === "connect" && provider === "evolution") {
          log("EVOLUTION_CONNECT_RESULT", { requestId, organizationId, success: true, statusHttp: 200, durationMs: Date.now() - operationStartedAt });
        }
        return Response.json({ whatsapp }, { headers: { "x-request-id": requestId } });
      } catch (error) {
        const message = safeError(error);
        if (!requestStarted) {
          log("WHATSAPP_REQUEST_START", { requestId, organizationId, action, provider });
          log("WHATSAPP_PROVIDER_SELECTED", { requestId, organizationId, provider });
        }
        if (action === "connect" && provider === "evolution") {
          const candidate = error as { status?: number; statusCode?: number };
          log("EVOLUTION_CONNECT_RESULT", { requestId, organizationId, success: false, statusHttp: candidate?.status ?? candidate?.statusCode ?? null, error: message, durationMs: Date.now() - startedAt });
        }
        log("WHATSAPP_REQUEST_ERROR", { requestId, organizationId, action, errorName: error instanceof Error ? error.name : "Error", error: message, durationMs: Date.now() - startedAt });
        return Response.json({ error: message || "Não foi possível controlar o WhatsApp desta organização." }, { status: 500, headers: { "x-request-id": requestId } });
      }
    },
  };
}
