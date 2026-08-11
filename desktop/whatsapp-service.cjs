/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const express = require("express");
const QRCode = require("qrcode");
const { resolveWhatsAppAuthConfig } = require("./whatsapp-auth-config.cjs");
const {
  normalizePhone,
  readWhatsAppTestMode,
  canSendToPhone,
  maskPhone,
  validateControlledTestInput,
} = require("./whatsapp-test-mode.cjs");

const CONNECTION_TIMEOUT_MS = 90000;
const SEND_TIMEOUT_MS = 20000;

function createWhatsAppBridge({
  dataDir,
  log,
  token,
  port,
  onConnected,
  clientFactory,
  chromePathResolver,
}) {
  const { clientId, sessionDir, sessionPath, cacheDir } =
    resolveWhatsAppAuthConfig(dataDir);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  let client = null;
  let server = null;
  let connectionTimer = null;
  let connectionPromise = null;
  let clientSequence = 0;
  let manualDisconnect = false;
  const observedBrowsers = new WeakSet();
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

  function observeChromium(current, clientNumber) {
    const browser = current?.pupBrowser;
    const page = current?.pupPage;
    if (!browser || observedBrowsers.has(browser)) return;
    observedBrowsers.add(browser);
    const browserProcess = typeof browser.process === "function" ? browser.process() : null;
    log(`CHROMIUM_STARTED: client=${clientNumber} pid=${browserProcess?.pid || "indisponivel"}.`);
    browser.on?.("disconnected", () =>
      log(`BROWSER_DISCONNECTED: client=${clientNumber}.`),
    );
    browserProcess?.once?.("exit", (code, signal) =>
      log(`CHROMIUM_EXITED: client=${clientNumber} code=${code ?? "null"} signal=${signal ?? "null"}.`),
    );
    page?.on?.("close", () => log(`PAGE_CLOSED: client=${clientNumber}.`));
    page?.on?.("error", (error) =>
      log(`PAGE_CRASH: client=${clientNumber} ${error?.message || "sem detalhe"}.`),
    );
    log(`PAGE_STATE: client=${clientNumber} closed=${page?.isClosed?.() === true}.`);
  }

  async function logInternalState(current, clientNumber, stage) {
    observeChromium(current, clientNumber);
    let internalState = "indisponivel";
    try {
      internalState = (await current.getState?.()) || "indisponivel";
    } catch (error) {
      internalState = `erro:${error?.message || "sem detalhe"}`;
    }
    log(
      `CLIENT_STATE: client=${clientNumber} stage=${stage} state=${internalState} ` +
        `info=${current.info ? "disponivel" : "indisponivel"} ` +
        `browserConnected=${current.pupBrowser?.connected ?? "indisponivel"} ` +
        `pageClosed=${current.pupPage?.isClosed?.() ?? "indisponivel"}.`,
    );
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

  async function initializeConnection() {
    if (client) return publicState();
    manualDisconnect = false;
    log(
      fs.existsSync(sessionPath)
        ? `SESSION_FOUND: ${sessionPath}`
        : `SESSION_NOT_FOUND: ${sessionPath}`,
    );
    update({
      status: "starting",
      qrCodeDataUrl: "",
      connectedPhone: "",
      lastError: "",
      lastMessage: "Iniciando conexão com o WhatsApp...",
    });

    let Client;
    let LocalAuth;
    if (!clientFactory) {
    try {
      ({ Client, LocalAuth } = require("whatsapp-web.js"));
    } catch (error) {
      update({
        status: "error",
        lastError: "Componente do WhatsApp não foi instalado corretamente.",
      });
      throw error;
    }
    }

    const chromePath = chromePathResolver?.() ?? resolveChromePath();
    if (!chromePath) {
      update({
        status: "error",
        lastError:
          "Google Chrome ou Microsoft Edge não foi encontrado neste computador.",
      });
      return publicState();
    }

    const clientNumber = ++clientSequence;
    const clientOptions = {
      authStrategy: clientFactory
        ? undefined
        : new LocalAuth({ clientId, dataPath: sessionDir }),
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
    };
    client = clientFactory
      ? clientFactory({ clientId, sessionDir, cacheDir, options: clientOptions })
      : new Client(clientOptions);
    const currentClient = client;

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
        log("QR_REQUIRED: QR Code do WhatsApp gerado.");
      } catch (error) {
        update({ status: "error", lastError: error.message });
      }
    });

    client.on("authenticated", () => {
      clearTimeout(connectionTimer);
      connectionTimer = null;
      update({
        status: "authenticated",
        lastMessage: "WhatsApp autenticado. Finalizando conexão...",
        lastError: "",
      });
      log("AUTHENTICATED: sessao local aceita pelo WhatsApp.");
      void logInternalState(currentClient, clientNumber, "authenticated");
    });

    client.on("loading_screen", (percent, message) => {
      log(`LOADING_SCREEN: client=${clientNumber} percent=${percent} message=${String(message || "")}.`);
    });

    client.on("change_state", (nextState) => {
      log(`CHANGE_STATE: client=${clientNumber} state=${String(nextState || "indisponivel")}.`);
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
      log(`READY: WhatsApp conectado: ${state.connectedPhone || "conta ativa"}.`);
      log(`RECONNECT_FINISHED: client=${clientNumber}.`);
      void logInternalState(currentClient, clientNumber, "ready");
      Promise.resolve(onConnected?.()).catch((error) =>
        log(`Falha ao iniciar recuperação após conexão: ${error.message}`),
      );
    });

    client.on("auth_failure", async (message) => {
      update({
        status: "error",
        qrCodeDataUrl: "",
        lastError: `Falha de autenticação: ${String(message || "")}`,
      });
      log(`AUTH_FAILURE: ${String(message || "falha sem detalhe")}`);
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
      if (!manualDisconnect) log(`DISCONNECTED: ${reason || "sem detalhe"}`);
    });

    connectionTimer = setTimeout(async () => {
      if (!["connected", "qr"].includes(state.status)) {
        update({
          status: "error",
          lastError: "O WhatsApp demorou demais para iniciar. Tente novamente.",
        });
        log(`INITIALIZE_TIMEOUT: client=${clientNumber} stage=${state.status}.`);
        await destroyClient();
      }
    }, CONNECTION_TIMEOUT_MS);

    try {
      log(`INITIALIZE_STARTED: client=${clientNumber}.`);
      const browserProbe = setInterval(
        () => observeChromium(currentClient, clientNumber),
        250,
      );
      try {
        await currentClient.initialize();
      } finally {
        clearInterval(browserProbe);
      }
      observeChromium(currentClient, clientNumber);
      log(`INITIALIZE_RESOLVED: client=${clientNumber}.`);
    } catch (error) {
      update({
        status: "error",
        lastError: error.message || "Não foi possível iniciar o WhatsApp.",
      });
      log(`INITIALIZE_REJECTED: client=${clientNumber} ${error.message || error || "falha ao inicializar"}.`);
      log(`RECONNECT_FAILED: ${error.message || error || "falha ao inicializar"}`);
      await destroyClient();
    }
    return publicState();
  }

  function connect() {
    if (connectionPromise) return connectionPromise;
    if (client) return Promise.resolve(publicState());
    const pending = initializeConnection();
    const guarded = pending.finally(() => {
      if (connectionPromise === guarded) connectionPromise = null;
    });
    connectionPromise = guarded;
    return guarded;
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

  async function send(phoneRaw, message) {
    if (!client || state.status !== "connected") {
      return { ok: false, error: "WhatsApp não está conectado." };
    }
    const phone = normalizePhone(phoneRaw);
    const text = String(message || "").trim();
    if (!phone || !text) {
      return { ok: false, error: "Telefone ou mensagem inválidos." };
    }

    const testMode = readWhatsAppTestMode();
    if (!canSendToPhone(phone, testMode)) {
      const masked = maskPhone(phone);
      log(`Envio bloqueado pelo TEST_MODE para ${masked}.`);
      return {
        ok: false,
        blockedByTestMode: true,
        error: "Envio bloqueado pelo modo de teste controlado.",
      };
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
      const sentMessage = await Promise.race([
        client.sendMessage(chatId, text),
        new Promise((_, reject) =>
          setTimeout(
            () => {
              const timeout = new Error("Tempo limite ao enviar a mensagem.");
              timeout.deliveryUnknown = true;
              reject(timeout);
            },
            SEND_TIMEOUT_MS,
          ),
        ),
      ]);
      update({ lastMessage: `Mensagem enviada para ${phone}.`, lastError: "" });
      log(`Mensagem da Escola de Futebol M6 Futebol Clube enviada para ${phone}.`);
      return {
        ok: true,
        phone,
        providerMessageId: sentMessage?.id?._serialized || null,
      };
    } catch (error) {
      update({ lastError: error.message || "Falha ao enviar mensagem." });
      return {
        ok: false,
        error: state.lastError,
        deliveryUnknown: Boolean(error.deliveryUnknown),
      };
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
    api.get("/health", (_request, response) => {
      const testMode = readWhatsAppTestMode();
      response.json({
        ok: true,
        whatsappConnected: state.status === "connected",
        testMode: testMode.enabled,
        testPhoneConfigured: Boolean(testMode.allowedPhone),
        testPhoneMasked: maskPhone(testMode.allowedPhone),
      });
    });
    api.use(authorized);
    api.post("/test-mode/validate", (request, response) => {
      const validation = validateControlledTestInput({
        configuration: readWhatsAppTestMode(),
        requestedPhone: request.body?.phone,
        message: request.body?.message,
      });
      response.status(validation.valid ? 200 : 409).json({
        ok: validation.valid,
        testMode: validation.testMode,
        testPhoneConfigured: validation.testPhoneConfigured,
        matches: validation.matches,
        messageConfigured: Boolean(validation.normalizedMessage),
      });
    });
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
      response.status(result.ok ? 200 : result.deliveryUnknown ? 504 : 409).json(result);
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
