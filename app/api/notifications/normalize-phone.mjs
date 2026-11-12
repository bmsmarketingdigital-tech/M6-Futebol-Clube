/** @param {string|null|undefined} phone */
export function normalizeNotificationPhone(phone) {
  let normalized = String(phone || "").replace(/\D/g, "");
  if (!normalized.startsWith("55") && [10, 11].includes(normalized.length)) normalized = `55${normalized}`;
  return /^\d{12,15}$/.test(normalized) ? normalized : null;
}
