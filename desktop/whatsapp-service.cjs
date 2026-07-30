/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const express = require("express");
const QRCode = require("qrcode");

const CONNECTION_TIMEOUT_MS = 90000;
const SEND_TIMEOUT_MS = 20000;

function createWhatsAppBridge({
  dataDir,
  log,
  token,
  port,
}) {
  const sessionDir = path.join(dataDir, "whatsapp-session");
  const cacheDir = path.join(dataDir, "whatsapp-cache");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  let client = null;
  let server = null;
  let connectionTimer = null;
  let manualDisconnect = false;
  const state = {
    status: "disconnected",
    qrCodeDataUrl: "",
    connectedPhone: "",
    lastError: "",
    lastMessage: "WhatsApp ainda não conectado.",
    updatedAt: new Date().toISOString(),
  };

  function update(patch) {
    Object.assign(state, patch, { updatedAt: new Date().toISOString() });
  }

  function publicState() {
    return { ...state };
  }

  function resolveChromePath() {
    const candidates = [
      process.env.LOCALAPPDATA
        ? path.join(
            process.env.LOCALAPPDATA,
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          )
        : null,
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ].filter(Boolean);
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  }

  async function destroyClient() {
    clearTimeout(connectionTimer);
    connectionTimer = null;
    const current = client;
    client = null;
    if (!current) return;
    try {
      await Promise.race([
        current.destroy(),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
    } catch (error) {
      log(`Falha ao encerrar sessão do WhatsApp: ${error.message}`);
    }
  }

  async function connect() {
    if (client) return publicState();
    manualDisconnect = false;
    update({
      status: "starting",
      qrCodeDataUrl: "",
      connectedPhone: "",
      lastError: "",
      lastMessage: "Iniciando conexão com o WhatsApp...",
    });

    let Client;
    let LocalAuth;
    try {
      ({ Client, LocalAuth } = require("whatsapp-web.js"));
    } catch (error) {
      update({
        status: "error",
        lastError: "Componente do WhatsApp não foi instalado corretamente.",
      });
      throw error;
    }

    const chromePath = resolveChromePath();
    if (!chromePath) {
      update({
        status: "error",
        lastError:
          "Google Chrome ou Microsoft Edge não foi encontrado neste computador.",
      });
      return publicState();
    }

    client = new Client({
      authStrategy: new LocalAuth({
        clientId: "baseforte",
        dataPath: sessionDir,
      }),
      webVersionCache: {
        type: "local",
        path: cacheDir,
        strict: false,
      },
      puppeteer: {
        headless: true,
        executablePath: chromePath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
          "--no-zygote",
        ],
      },
    });

    client.on("qr", async (qr) => {
      clearTimeout(connectionTimer);
      try {
        const qrCodeDataUrl = await QRCode.toDataURL(qr, {
          width: 320,
          margin: 1,
        });
        update({
          status: "qr",
          qrCodeDataUrl,
          lastMessage: "Escaneie o QR Code com o WhatsApp da escolinha.",
          lastError: "",
        });
        log("QR Code do WhatsApp gerado.");
      } catch (error) {
        update({ status: "error", lastError: error.message });
      }
    });

    client.on("authenticated", () => {
      update({
        status: "authenticated",
        lastMessage: "WhatsApp autenticado. Finalizando conexão...",
        lastError: "",
      });
    });

    client.on("ready", () => {
      clearTimeout(connectionTimer);
      const info = client?.info || {};
      update({
        status: "connected",
        qrCodeDataUrl: "",
        connectedPhone: String(
          info.wid?.user || info.pushname || "",
        ).trim(),
        lastMessage: "WhatsApp conectado e pronto para enviar.",
        lastError: "",
      });
      log(`WhatsApp conectado: ${state.connectedPhone || "conta ativa"}.`);
    });

    client.on("auth_failure", async (message) => {
      update({
        status: "error",
        qrCodeDataUrl: "",
        lastError: `Falha de autenticação: ${String(message || "")}`,
      });
      await destroyClient();
    });

    client.on("disconnected", async (reason) => {
      update({
        status: "disconnected",
        qrCodeDataUrl: "",
        connectedPhone: "",
        lastMessage: "WhatsApp desconectado.",
        lastError: String(reason || ""),
      });
      await destroyClient();
      if (!manualDisconnect) log(`WhatsApp desconectado: ${reason || ""}`);
    });

    connectionTimer = setTimeout(async () => {
      if (!["connected", "qr"].includes(state.status)) {
        update({
          status: "error",
          lastError: "O WhatsApp demorou demais para iniciar. Tente novamente.",
        });
        await destroyClient();
      }
    }, CONNECTION_TIMEOUT_MS);

    try {
      await client.initialize();
    } catch (error) {
      update({
        status: "error",
        lastError: error.message || "Não foi possível iniciar o WhatsApp.",
      });
      await destroyClient();
    }
    return publicState();
  }

  async function disconnect() {
    manualDisconnect = true;
    const current = client;
    if (current && typeof current.logout === "function") {
      try {
        await Promise.race([
          current.logout(),
          new Promise((resolve) => setTimeout(resolve, 10000)),
        ]);
      } catch {}
    }
    await destroyClient();
    update({
      status: "disconnected",
      qrCodeDataUrl: "",
      connectedPhone: "",
      lastMessage: "WhatsApp desconectado.",
      lastError: "",
    });
    return publicState();
  }

  function normalizePhone(value) {
    let phone = String(value || "").replace(/\D/g, "");
    if (!phone) return "";
    if (!phone.startsWith("55") && [10, 11].includes(phone.length)) {
      phone = `55${phone}`;
    }
    return phone;
  }

  async function send(phoneRaw, message) {
    if (!client || state.status !== "connected") {
      return { ok: false, error: "WhatsApp não está conectado." };
    }
    const phone = normalizePhone(phoneRaw);
    const text = String(message || "").trim();
    if (!phone || !text) {
      return { ok: false, error: "Telefone ou mensagem inválidos." };
    }

    try {
      let chatId = `${phone}@c.us`;
      if (typeof client.getNumberId === "function") {
        const numberId = await client.getNumberId(phone);
        if (!numberId?._serialized) {
          return {
            ok: false,
            error: "O telefone informado não possui WhatsApp.",
          };
        }
        chatId = numberId._serialized;
      }
      await Promise.race([
        client.sendMessage(chatId, text),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Tempo limite ao enviar a mensagem.")),
            SEND_TIMEOUT_MS,
          ),
        ),
      ]);
      update({ lastMessage: `Mensagem enviada para ${phone}.`, lastError: "" });
      log(`Mensagem do BaseForte enviada para ${phone}.`);
      return { ok: true, phone };
    } catch (error) {
      update({ lastError: error.message || "Falha ao enviar mensagem." });
      return { ok: false, error: state.lastError };
    }
  }

  function authorized(request, response, next) {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.status(401).json({ ok: false, error: "Não autorizado." });
      return;
    }
    next();
  }

  async function start() {
    if (server) return;
    const api = express();
    api.disable("x-powered-by");
    api.use(express.json({ limit: "64kb" }));
    api.get("/health", (_request, response) =>
      response.json({ ok: true }),
    );
    api.use(authorized);
    api.get("/status", (_request, response) =>
      response.json({ ok: true, ...publicState() }),
    );
    api.post("/connect", async (_request, response) => {
      void connect();
      response.status(202).json({ ok: true, ...publicState() });
    });
    api.post("/disconnect", async (_request, response) => {
      response.json({ ok: true, ...(await disconnect()) });
    });
    api.post("/send", async (request, response) => {
      const result = await send(request.body?.phone, request.body?.message);
      response.status(result.ok ? 200 : 409).json(result);
    });

    await new Promise((resolve, reject) => {
      server = api
        .listen(port, "127.0.0.1", resolve)
        .once("error", reject);
    });
    log(`Conector local do WhatsApp iniciado na porta ${port}.`);
  }

  async function stop() {
    await destroyClient();
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }

  return { start, stop, connect, disconnect, publicState };
}

module.exports = { createWhatsAppBridge };
