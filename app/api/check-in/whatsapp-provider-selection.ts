import { evolutionConfigured } from "./evolution-provider";
import { getRuntimeEnv } from "../runtime-env";
import { selectWhatsAppProviderFromConfig } from "./provider-choice.mjs";

const runtime = getRuntimeEnv();

export type WhatsAppProvider = "local" | "evolution" | "none";

export function selectWhatsAppProvider(
  organizationId: string,
  source: Record<string, string | undefined> = runtime,
): WhatsAppProvider {
  return selectWhatsAppProviderFromConfig(
    source,
    evolutionConfigured(organizationId, source),
  );
}

export function whatsappBridgeConfigured(
  organizationId: string,
  source: Record<string, string | undefined> = runtime,
) {
  return selectWhatsAppProvider(organizationId, source) !== "none";
}
