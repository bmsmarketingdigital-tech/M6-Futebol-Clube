/** @param {unknown} error */
export function sanitizeDeliveryError(error) {
  const raw = error instanceof Error ? error.message : String(error ?? "Falha no envio.");
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
