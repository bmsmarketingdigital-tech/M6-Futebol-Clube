import { getApiContext } from "../../api-auth";
import { evolutionConfigured, getEvolutionConfig } from "../../check-in/evolution-provider";
import { whatsappBridgeConfigured } from "../../check-in/whatsapp-provider-selection";
import { selectWhatsAppProvider } from "../../check-in/whatsapp-provider-selection";
import { getRuntimeEnv } from "../../runtime-env";
import { createWhatsAppDiagnosticsGet } from "../whatsapp-diagnostics-handler";

export const dynamic = "force-dynamic";

const handlers = createWhatsAppDiagnosticsGet({
  getContext: getApiContext,
  getEnv: getRuntimeEnv,
  getEvolution: getEvolutionConfig,
  evolutionIsConfigured: evolutionConfigured,
  selectProvider: selectWhatsAppProvider,
  bridgeIsConfigured: whatsappBridgeConfigured,
  getRuntimePresence: (env) => ({
    whatsappBridgeUrlPresent: Boolean(env.WHATSAPP_BRIDGE_URL?.trim()),
    evolutionApiUrlPresent: Boolean(env.EVOLUTION_API_URL?.trim()),
    evolutionApiKeyPresent: Boolean(env.EVOLUTION_API_KEY?.trim()),
    evolutionInstanceMapPresent: Boolean(env.EVOLUTION_API_INSTANCE_MAP?.trim()),
  }),
  getInstanceName: (config) => config?.instance ?? null,
});

export const GET = handlers;
