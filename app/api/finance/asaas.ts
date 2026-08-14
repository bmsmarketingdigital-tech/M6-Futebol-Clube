import { getRuntimeEnv } from "../runtime-env";

type AsaasError = { errors?: { description?: string }[] };
const runtime = getRuntimeEnv();

export function hasAsaasConfiguration() {
  return Boolean(runtime.ASAAS_API_KEY);
}

export async function asaasRequest<T>(path: string, init: RequestInit) {
  const apiKey = runtime.ASAAS_API_KEY;
  if (!apiKey) throw new Error("Integração Asaas ainda não configurada.");
  const sandbox = runtime.ASAAS_ENVIRONMENT !== "production";
  const response = await fetch(
    `${sandbox ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3"}${path}`,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "EscolaM6FutebolClube/1.0",
        access_token: apiKey,
        ...init.headers,
      },
    },
  );
  const payload = (await response.json()) as T & AsaasError;
  if (!response.ok) {
    throw new Error(
      payload.errors?.[0]?.description || "O Asaas recusou a operação.",
    );
  }
  return payload;
}

export function validWebhookToken(request: Request) {
  const secret = runtime.ASAAS_WEBHOOK_TOKEN;
  return Boolean(
    secret && request.headers.get("asaas-access-token") === secret,
  );
}
