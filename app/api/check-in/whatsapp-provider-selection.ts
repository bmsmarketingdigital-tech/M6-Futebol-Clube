import { evolutionConfigured } from "./evolution-provider";
import { getRuntimeEnv } from "../runtime-env";

const runtime = getRuntimeEnv();

export type WhatsAppProvider = "local" | "evolution" | "none";

export function selectWhatsAppProvider(
  organizationId: string,
  source: Record<string, string | undefined> = runtime,
): WhatsAppProvider {
  if (source.WHATSAPP_BRIDGE_URL?.trim()) return "local";
  if (evolutionConfigured(organizationId, source)) return "evolution";
  return "none";
}

export function whatsappBridgeConfigured(
  organizationId: string,
  source: Record<string, string | undefined> = runtime,
) {
  return selectWhatsAppProvider(organizationId, source) !== "none";
}
