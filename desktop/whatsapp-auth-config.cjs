const path = require("path");

const WHATSAPP_CLIENT_ID = "baseforte";

function resolveWhatsAppAuthConfig(dataDir) {
  const sessionDir = path.join(dataDir, "whatsapp-session");
  return {
    clientId: WHATSAPP_CLIENT_ID,
    sessionDir,
    sessionPath: path.join(sessionDir, `session-${WHATSAPP_CLIENT_ID}`),
    cacheDir: path.join(dataDir, "whatsapp-cache"),
  };
}

module.exports = { WHATSAPP_CLIENT_ID, resolveWhatsAppAuthConfig };
