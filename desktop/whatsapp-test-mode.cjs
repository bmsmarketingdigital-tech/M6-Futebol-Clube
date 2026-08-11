function normalizePhone(value) {
  let phone = String(value || "").replace(/\D/g, "");
  if (!phone) return "";
  if (!phone.startsWith("55") && [10, 11].includes(phone.length)) phone = `55${phone}`;
  return phone;
}

function readWhatsAppTestMode(environment = process.env) {
  const enabled = ["1", "true", "yes", "on"].includes(
    String(environment.WHATSAPP_TEST_MODE || "").trim().toLowerCase(),
  );
  return { enabled, allowedPhone: normalizePhone(environment.WHATSAPP_TEST_PHONE) };
}

function canSendToPhone(phone, configuration) {
  if (!configuration.enabled) return true;
  return Boolean(
    configuration.allowedPhone && normalizePhone(phone) === configuration.allowedPhone,
  );
}

function maskPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return "";
  return `${"*".repeat(Math.max(0, normalized.length - 4))}${normalized.slice(-4)}`;
}

function validateControlledTestInput({ configuration, requestedPhone, message }) {
  const normalizedRequestedPhone = normalizePhone(requestedPhone);
  const normalizedMessage = String(message || "").trim();
  const valid = Boolean(
    configuration.enabled &&
      configuration.allowedPhone &&
      normalizedRequestedPhone &&
      normalizedRequestedPhone === configuration.allowedPhone &&
      normalizedMessage,
  );
  return {
    valid,
    normalizedRequestedPhone,
    normalizedMessage,
    testMode: configuration.enabled,
    testPhoneConfigured: Boolean(configuration.allowedPhone),
    matches: Boolean(
      configuration.allowedPhone &&
        normalizedRequestedPhone === configuration.allowedPhone,
    ),
  };
}

module.exports = {
  normalizePhone,
  readWhatsAppTestMode,
  canSendToPhone,
  maskPhone,
  validateControlledTestInput,
};
