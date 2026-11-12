/** @param {Record<string,string|undefined>} source @param {boolean} isEvolutionConfigured */
export function selectWhatsAppProviderFromConfig(source, isEvolutionConfigured) {
  if (source.WHATSAPP_BRIDGE_URL?.trim()) return "local";
  if (isEvolutionConfigured) return "evolution";
  return "none";
}
