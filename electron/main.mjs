// electron/main.mjs
//
// Electron main process: React UI <-> AccountRotator.
// React tidak menjalankan Playwright langsung.

import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { AccountManager } from "../src/accounts/accountManager.js";
import { AccountRotator } from "../src/rotation/accountRotator.js";
import { MarketplaceSession } from "../src/marketplace/session.js";
import { HermesWebhook } from "../src/notifications/hermesWebhook.js";
import { TelegramNotifier } from "../src/notifications/telegram.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const isAccountManagerSmokeTest = process.argv.includes(
  "--smoke-test-account-manager",
);

let mainWindow = null;
let rotator = null;
let manager = null;
let managerInitPromise = null;
let managerInitError = null;

function loadEnvFile() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(os.homedir(), ".hermes", ".env"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
    break;
  }
}

loadEnvFile();

async function initializeManager() {
  if (manager) return manager;
  if (managerInitPromise) return managerInitPromise;

  managerInitPromise = (async () => {
    const dataRoot = app.getPath("userData");
    process.env.BOTWATCHER_DATA_DIR = dataRoot;

    const instance = new AccountManager({
      databaseFile: path.join(dataRoot, "botwatcher.db"),
    });

    await instance.load();

    manager = instance;
    managerInitError = null;

    return manager;
  })().catch((error) => {
    managerInitError = error;
    throw error;
  });

  return managerInitPromise;
}

async function getManager() {
  return initializeManager();
}

async function runAccountManagerSmokeTest() {
  const activeManager = await initializeManager();
  const accountId = `smoke-${Date.now()}`;
  const databaseFile = activeManager.databaseFile;

  const created = await activeManager.addAccount({
    accountId,
    name: "Windows Packaged Smoke Test",
    city: "Kediri",
  });

  if (created.accountId !== accountId || created.enabled !== true) {
    activeManager.close();
    throw new Error("AccountManager smoke test gagal membuat akun aktif.");
  }

  const persisted = activeManager.getAccount(accountId);

  if (!persisted) {
    activeManager.close();
    throw new Error(
      "AccountManager smoke test gagal membaca akun yang baru dibuat.",
    );
  }

  activeManager.close();

  const reopenedManager = new AccountManager({
    databaseFile,
  });

  try {
    await reopenedManager.load();

    const reloaded = reopenedManager.getAccount(accountId);

    if (!reloaded) {
      throw new Error(
        "AccountManager smoke test gagal membaca akun setelah database dibuka ulang.",
      );
    }

    if (
      reloaded.name !== "Windows Packaged Smoke Test" ||
      reloaded.city !== "Kediri" ||
      reloaded.enabled !== true
    ) {
      throw new Error(
        "AccountManager smoke test menemukan data akun yang tidak sesuai setelah reload.",
      );
    }

    console.log(`[smoke] AccountManager OK: ${databaseFile}`);
  } finally {
    try {
      if (reopenedManager.getAccount(accountId)) {
        await reopenedManager.removeAccount(accountId);
      }
    } finally {
      reopenedManager.close();
    }
  }
}

const notifier = new TelegramNotifier();
const hermesWebhook = new HermesWebhook();
const notifiedUnreadMap = new Map(); // accountId -> last notified unread count
const replySessions = new Map(); // accountId -> MarketplaceSession aktif buat reply manual

let rotationState = {
  round: 0,
  currentBatch: [],
  checkedSoFar: 0,
  totalAccounts: 0,
};

function broadcastStatus() {
  if (!mainWindow || mainWindow.isDestroyed() || !manager) return;
  mainWindow.webContents.send("accounts:update", manager.getAllStatuses());
}

function broadcastLog(message, level = "info") {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("engine:log", {
    message,
    level,
    at: new Date().toISOString(),
  });
}

function broadcastRotation() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("rotation:update", rotationState);
}

function broadcastEngineStatus(running) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("engine:status", { running });
}

function createRotator() {
  const accountIds = manager.getEnabledAccounts().map((a) => a.accountId);

  const r = new AccountRotator(accountIds, {
    minBatchSize: 5,
    maxBatchSize: 10,
    delayBetweenBatchesMs: 5000,
    roundIntervalMs:
      Number(process.env.ROTATION_INTERVAL_MS) || 5 * 60 * 1000,
  });

  r.on("log", (message, level) => broadcastLog(message, level));

  r.on("round_started", ({ round, totalAccounts }) => {
    rotationState = { round, currentBatch: [], checkedSoFar: 0, totalAccounts };
    broadcastRotation();
  });

  r.on("batch_started", ({ batch, checkedSoFar, totalAccounts }) => {
    rotationState = {
      ...rotationState,
      currentBatch: batch,
      checkedSoFar,
      totalAccounts,
    };
    broadcastRotation();
  });

  r.on("batch_finished", ({ checkedSoFar, totalAccounts }) => {
    rotationState = {
      ...rotationState,
      currentBatch: [],
      checkedSoFar,
      totalAccounts,
    };
    broadcastRotation();
  });

  r.on("account_checked", ({ accountId, loggedIn, unreadCount, reason }) => {
    // Aktif HANYA kalau dashboard benar-benar terbaca (unreadCount
    // berupa angka). null = sesi kadaluarsa / akun ditangguhkan /
    // banned -> status Tidur, BUKAN Aktif.
    const usable =
      loggedIn === true &&
      unreadCount !== null &&
      unreadCount !== undefined;
    const currentStatus = manager.getStatus(accountId);
    const previousState = currentStatus?.state ?? "monitoring";
    const previousUnreadCount = currentStatus?.unreadCount ?? null;

    manager.updateStatus(accountId, {
      loggedIn: usable,
      unreadCount,
      lastCheckedAt: new Date(),
      state: usable ? "monitoring" : "offline",
      error: usable ? null : (reason ?? null),
    });
    broadcastStatus();

    // Alert admin Telegram kalau akun berubah status menjadi offline/bermasalah
    if (!usable && previousState !== "offline") {
      const account = manager.getAccount(accountId);
      void notifier.notifyAccountError(
        account?.name ?? accountId,
        reason ?? "Akun tidak dapat diakses / sesi kadaluarsa",
      );
    }

    if (usable) {
      const account = manager.getAccount(accountId);

      if (unreadCount > 0) {
        if (notifiedUnreadMap.get(accountId) !== unreadCount) {
          notifiedUnreadMap.set(accountId, unreadCount);
          manager.updateStatus(accountId, {
            lastNotifiedUnreadCount: unreadCount,
          });
          void hermesWebhook.notifyIfNewInboxMessages({
            accountId,
            accountName: account?.name ?? accountId,
            unreadCount,
            previousUnreadCount: 0,
          });
        }
      } else {
        notifiedUnreadMap.delete(accountId);
        manager.updateStatus(accountId, {
          lastNotifiedUnreadCount: 0,
        });
      }
    }
  });

  r.on("error", ({ accountId, error }) => {
    const currentStatus = manager.getStatus(accountId);
    const previousState = currentStatus?.state ?? "monitoring";

    manager.updateStatus(accountId, { state: "error", error: error.message });
    broadcastStatus();
    broadcastLog(`[${accountId}] ${error.message}`, "error");

    if (previousState !== "error") {
      const account = manager.getAccount(accountId);
      void notifier.notifyAccountError(
        account?.name ?? accountId,
        error?.message ?? "Terjadi kesalahan saat memeriksa akun",
      );
    }
  });

  return r;
}

// --- IPC handlers dipanggil dari renderer (GUI) ---

ipcMain.handle("accounts:getAll", async () => {
  try {
    const activeManager = await getManager();
    return activeManager.getAllStatuses();
  } catch (error) {
    broadcastLog(`Gagal memuat Account Manager: ${error.message}`, "error");
    throw error;
  }
});

ipcMain.handle("accounts:add", async (_event, { accountId, name, city, postCount }) => {
  try {
    const activeManager = await getManager();

    await activeManager.addAccount({
      accountId,
      name,
      city,
      postCount,
    });

    broadcastStatus();

    broadcastLog(`Akun "${accountId}" berhasil ditambahkan.`, "success");

    return activeManager.getAllStatuses();
  } catch (error) {
    broadcastLog(
      `Gagal menambahkan akun "${accountId}": ${error.message}`,
      "error",
    );
    throw error;
  }
});
ipcMain.handle("engine:getStatus", () => ({
  running: Boolean(rotator?.running),
}));
ipcMain.handle("rotation:getState", () => rotationState);

ipcMain.handle("engine:start", async () => {
  const activeManager = await getManager();

  if (rotator?.running) {
    return {
      running: true,
      started: false,
      reason: "ALREADY_RUNNING",
    };
  }

  const enabledAccounts = activeManager.getEnabledAccounts();

  if (enabledAccounts.length === 0) {
    broadcastLog("Bot tidak dapat dimulai: tidak ada akun yang aktif.", "warn");

    broadcastEngineStatus(false);

    return {
      running: false,
      started: false,
      reason: "NO_ACCOUNTS",
    };
  }

  rotator = createRotator();

  broadcastLog(`Rotasi dimulai untuk ${enabledAccounts.length} akun .`, "info");

  broadcastEngineStatus(true);

  rotator.start().finally(() => {
    broadcastEngineStatus(false);
  });

  return {
    running: true,
    started: true,
  };
});

ipcMain.handle("engine:stop", async () => {
  if (rotator) rotator.stop();
  broadcastLog("Perintah stop diterima.", "info");
  return { running: false };
});

ipcMain.handle("accounts:remove", async (_event, accountId) => {
  const activeManager = await getManager();

  await activeManager.removeAccount(accountId);

  broadcastStatus();

  return activeManager.getAllStatuses();
});

// Simpan perubahan nama/kota (dipanggil dari kartu akun yang di-klik-edit).
ipcMain.handle("accounts:update", async (_event, { accountId, updates }) => {
  const activeManager = await getManager();

  await activeManager.updateAccount(accountId, updates);

  broadcastStatus();

  return activeManager.getAllStatuses();
});

// Tombol "Balas Sekarang" -- buka (atau fokus ulang) sesi browser buat
// akun itu, terpisah dari siklus rotasi otomatis, biar user bisa balas
// manual.
//
// Kalau akun berstatus ERROR (kartu merah) atau OFFLINE (tidur karena
// sesi/akun bermasalah), cookie lama tetap TERDETEKSI "ada" padahal
// tidak valid. Jadi buka halaman login Facebook langsung (bukan
// dashboard), dan begitu user login ulang, status dibersihkan
// supaya kartu kembali normal.
ipcMain.handle("accounts:openReply", async (_event, accountId) => {
  const activeManager = await getManager();
  const account = activeManager.getAccount(accountId);
  if (!account) throw new Error(`Akun "${accountId}" tidak ditemukan.`);

  // Kartu merah (error) ATAU tidur karena sesi/akun bermasalah: buka
  // halaman login Facebook langsung supaya user bisa login ulang /
  // verifikasi akun dari tombol di kartu.
  const status = activeManager.getStatus(accountId);
  const needsLogin =
    status?.state === "error" || status?.state === "offline";

  const existing = replySessions.get(accountId);
  if (existing) {
    if (needsLogin) {
      // Sesi lama (mungkin nyangkut di dashboard/checkpoint) ditutup
      // dulu supaya browser baru benar-benar mulai dari halaman login.
      await existing.close().catch(() => {});
      replySessions.delete(accountId);
    } else {
      try {
        await existing.page?.bringToFront();
        return { opened: true, reused: true };
      } catch {
        replySessions.delete(accountId);
      }
    }
  }

  const session = new MarketplaceSession({
    accountId,
    forceLogin: needsLogin,
    // headless: false -- sesi ini HARUS terlihat, user perlu lihat &
    // berinteraksi (balas pesan / login ulang) di window browser.
    headless: false,
  });
  session.on("log", (message, level) =>
    broadcastLog(`[balas:${accountId}] ${message}`, level),
  );

  // Setelah login ulang terdeteksi, hapus status error biar kartu
  // tidak merah lagi (tanpa nunggu putaran rotasi berikutnya).
  session.on("login_status", ({ isLoggedIn }) => {
    if (!isLoggedIn) return;
    try {
      activeManager.updateStatus(accountId, {
        loggedIn: true,
        state: "monitoring",
        error: null,
      });
      broadcastStatus();
    } catch {
      // Akun mungkin baru dihapus user saat sesi browser terbuka.
    }
  });

  await session.open();
  session.context?.on("close", () => replySessions.delete(accountId));
  replySessions.set(accountId, session);

  return { opened: true, reused: false, loginPrompt: needsLogin };
});

// --- Setup jendela ---

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      broadcastLog(
        `UI gagal dimuat (${errorCode}): ${errorDescription} — ${validatedURL}`,
        "error",
      );
    },
  );

  mainWindow.webContents.on("did-finish-load", () => {
    if (manager) {
      broadcastStatus();
      broadcastLog(
        `Aplikasi siap. Database: ${path.join(app.getPath("userData"), "botwatcher.db")}`,
        "info",
      );
      broadcastEngineStatus(Boolean(rotator?.running));
    }

    if (managerInitError) {
      broadcastLog(
        `Gagal memuat Account Manager: ${managerInitError.message}`,
        "error",
      );
    }
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(
      path.join(__dirname, "..", "ui-design", "dist", "index.html"),
    );
  }
}

app.whenReady().then(async () => {
  if (isAccountManagerSmokeTest) {
    try {
      await runAccountManagerSmokeTest();
      app.quit();
    } catch (error) {
      console.error("[smoke] AccountManager smoke test gagal:", error);
      app.exit(1);
    }
    return;
  }

  try {
    await initializeManager();
  } catch {}

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  if (rotator) rotator.stop();
  for (const session of replySessions.values()) {
    await session.close().catch(() => {});
  }
  replySessions.clear();
  if (manager) {
    manager.close();
    manager = null;
  }
  if (process.platform !== "darwin") app.quit();
});
