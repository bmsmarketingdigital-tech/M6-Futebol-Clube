/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, dialog, session, shell } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createWhatsAppBridge } = require("./whatsapp-service.cjs");

const APP_PORT = 3040;
const BRIDGE_PORT = 3211;
let mainWindow = null;
let webServer = null;
let whatsappBridge = null;
let shuttingDown = false;
let notificationRecoveryTimer = null;

function programDataDir() {
  const base =
    process.env.ProgramData ||
    process.env.PROGRAMDATA ||
    app.getPath("userData");
  return path.join(base, "M6FutebolClube");
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function createLogger(dataDir) {
  const logDir = ensureDirectory(path.join(dataDir, "logs"));
  const logFile = path.join(logDir, "m6futebolclube.log");
  return (message) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    try {
      fs.appendFileSync(logFile, `${line}\n`, "utf8");
    } catch {}
    try {
      console.log(line);
    } catch (error) {
      if (error?.code !== "EPIPE") throw error;
    }
  };
}

function loadBridgeToken(dataDir) {
  const tokenFile = path.join(dataDir, "bridge-token.txt");
  try {
    const saved = fs.readFileSync(tokenFile, "utf8").trim();
    if (saved.length >= 32) return saved;
  } catch {}
  const token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(tokenFile, token, {
    encoding: "utf8",
    mode: 0o600,
  });
  return token;
}

function waitForServer(url, timeoutMs = 120000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      request.on("error", retry);
      request.setTimeout(2500, () => {
        request.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("O servidor local da Escola de Futebol M6 Futebol Clube não iniciou."));
        return;
      }
      setTimeout(check, 700);
    };
    check();
  });
}

function triggerNotificationRecovery({ bridgeToken, origin, log }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: APP_PORT,
        path: `/api/internal/notifications/recover?origin=${origin}`,
        method: "POST",
        headers: { Authorization: `Bearer ${bridgeToken}` },
        timeout: 120000,
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          if (response.statusCode && response.statusCode < 300) {
            log(`Recuperação de notificações concluída (${origin}).`);
            resolve();
          } else {
            reject(new Error(`Rotina respondeu HTTP ${response.statusCode}.`));
          }
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("Tempo limite da rotina.")));
    request.on("error", reject);
    request.end();
  });
}

function startWebServer({ appRoot, dataDir, bridgeToken, log }) {
  const viteCli = path.join(appRoot, "node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(viteCli)) {
    throw new Error(`Componente local não encontrado: ${viteCli}`);
  }
  const serverLog = path.join(dataDir, "logs", "server.log");
  const output = fs.openSync(serverLog, "a");
  const serverEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "development",
    BASEFORTE_DESKTOP: "1",
    WRANGLER_LOG_PATH: path.join(dataDir, "logs", "wrangler"),
    MINIFLARE_REGISTRY_PATH: path.join(dataDir, "registry"),
    WHATSAPP_BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`,
    WHATSAPP_BRIDGE_TOKEN: bridgeToken,
  };
  delete serverEnv.BASEFORTE_CACHE_DIR;
  if (app.isPackaged) {
    serverEnv.BASEFORTE_STATE_DIR = path.join(dataDir, "state");
  } else {
    delete serverEnv.BASEFORTE_STATE_DIR;
  }
  webServer = spawn(
    process.execPath,
    [
      viteCli,
      "--host",
      "127.0.0.1",
      "--port",
      String(APP_PORT),
      "--strictPort",
    ],
    {
      cwd: appRoot,
      env: serverEnv,
      stdio: ["ignore", output, output],
      windowsHide: true,
    },
  );
  webServer.on("exit", (code) => {
    log(`Servidor local encerrado com código ${code}.`);
    webServer = null;
    if (!shuttingDown) {
      dialog.showErrorBox(
        "Escola de Futebol M6 Futebol Clube",
        "O servidor local foi encerrado inesperadamente. Reinicie o aplicativo.",
      );
      app.quit();
    }
  });
  webServer.on("error", (error) => {
    log(`Falha ao iniciar servidor local: ${error.message}`);
  });
}

function stopWebServer() {
  const child = webServer;
  webServer = null;
  if (!child?.pid) return;
  try {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } catch {}
}

function createWindow(log) {
  const headlessTest = process.env.BASEFORTE_HEADLESS_TEST === "1";
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f4f7f5",
    title: "Escola de Futebol M6 Futebol Clube — Gestão Esportiva",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => {
    if (!headlessTest) {
      mainWindow?.maximize();
      mainWindow?.show();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${APP_PORT}`)) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, code, description) => {
      log(`Falha ao abrir interface: ${code} ${description}`);
    },
  );
  return mainWindow;
}

async function boot() {
  const dataDir = ensureDirectory(programDataDir());
  ensureDirectory(path.join(dataDir, "state"));
  const log = createLogger(dataDir);
  const bridgeToken = loadBridgeToken(dataDir);
  const appRoot = app.getAppPath();

  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const origin = new URL(webContents.getURL()).hostname;
      callback(
        permission === "media" &&
          (origin === "127.0.0.1" || origin === "localhost"),
      );
    },
  );

  whatsappBridge = createWhatsAppBridge({
    dataDir,
    log,
    token: bridgeToken,
    port: BRIDGE_PORT,
    onConnected: () =>
      triggerNotificationRecovery({ bridgeToken, origin: "reconnect", log }),
  });
  await whatsappBridge.start();
  log("RECONNECT_STARTED: restaurando sessao oficial no startup.");
  void whatsappBridge.connect().catch((error) =>
    log(`RECONNECT_FAILED: ${error.message || "falha ao iniciar cliente"}`),
  );
  startWebServer({ appRoot, dataDir, bridgeToken, log });
  await waitForServer(`http://127.0.0.1:${APP_PORT}/`);
  await triggerNotificationRecovery({ bridgeToken, origin: "startup", log });
  notificationRecoveryTimer = setInterval(() => {
    void triggerNotificationRecovery({ bridgeToken, origin: "automatic", log }).catch(
      (error) => log(`Falha na verificação periódica: ${error.message}`),
    );
  }, 15 * 60 * 1000);
  const window = createWindow(log);
  await window.loadURL(`http://127.0.0.1:${APP_PORT}/`);
  log("Escola de Futebol M6 Futebol Clube iniciado com sucesso.");
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(boot).catch((error) => {
    dialog.showErrorBox(
      "Não foi possível iniciar o sistema",
      `${error.message}\n\nConsulte os registros em C:\\ProgramData\\M6FutebolClube\\logs.`,
    );
    app.quit();
  });
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  clearInterval(notificationRecoveryTimer);
  Promise.resolve()
    .then(() => whatsappBridge?.stop())
    .catch(() => undefined)
    .finally(() => {
      stopWebServer();
      app.exit(0);
    });
});
