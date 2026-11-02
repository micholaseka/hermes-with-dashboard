// server/server.js
// Hermes webhook endpoint: menerima laporan dari BotWatcher-Dashboard, route
// ke processing pipeline, dan menjalankan Telegram Listener untuk SOP Balasan Lokasi.
// Run: node server/server.js  (default port 8765)

import http from "node:http";
import { URL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

import { Processor } from "../src/hermes/processor.js";
import { TelegramListener } from "../src/hermes/telegramListener.js";

const PORT = Number(process.env.PORT || 8765);
const WEBHOOK_PATH = "/webhooks/BotWatcher-Dashboard";

// ES module: __dirname equivalent
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Root project dir: server/server.js → project root
const PROJECT_ROOT = path.resolve(__dirname, "..");

// Telegram credentials (optional). Console-only fallback jika kosong.
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

// Agar sessionResolver menemukan profil yang dibuat oleh Electron app
// (BOTWATCHER_DATA_DIR = app.getPath("userData")). Otomatis mengenali
// Windows (%APPDATA%\Electron) dan Linux (~/.config/Electron).
import { getDefaultDataDir } from "../src/config/engine.config.js";

if (!process.env.BOTWATCHER_DATA_DIR) {
  process.env.BOTWATCHER_DATA_DIR = getDefaultDataDir();
}

// Processor pipeline
const processor = new Processor({
  projectRoot: PROJECT_ROOT,
  telegramBotToken: TELEGRAM_BOT_TOKEN,
  telegramChatId: TELEGRAM_CHAT_ID,
});

// Telegram Listener untuk menangkap balasan admin Telegram (SOP Poin 4)
const telegramListener = new TelegramListener({
  telegramBotToken: TELEGRAM_BOT_TOKEN,
  telegramChatId: TELEGRAM_CHAT_ID,
  processor,
  pendingStore: processor.pendingStore,
  responseSender: processor.responseSender,
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const reqPath = url.pathname;

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  if (reqPath !== WEBHOOK_PATH) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));

  try {
    const payload = JSON.parse(rawBody);

    // Log ringkas: timestamp, accountId, unreadCount, delta.
    console.log(
      `[webhook] ${new Date().toISOString()} accountId=${payload.accountId} ` +
        `accountName=${payload.accountName ?? ""} unread=${payload.unreadCount} ` +
        `new=${payload.newMessageCount} signal=${payload.signal}`,
    );

    // Route ke processing pipeline.
    try {
      const result = await processor.process(payload);
      console.log(
        `[pipeline] accountId=${payload.accountId} classification=${result.classification} ` +
          `actionResult=${result.actionResult} messages=${result.messageCount}`,
      );
    } catch (err) {
      console.error(
        `[pipeline] Gagal memproses akun ${payload.accountId}: ${err.message}`,
      );
      // Notifikasi ke Telegram jika sesi putus / checkpoint
      if (
        err.message.includes("tidak bisa diakses") ||
        err.message.includes("tidak valid")
      ) {
        await processor.responseSender.sendTelegramMessage(
          `⚠️ PERINGATAN: Sesi akun FB "${payload.accountName ?? payload.accountId}" bermasalah!\nDetail: ${err.message}\nSilakan login ulang manual via dashboard.`,
        );
      }
    }
  } catch (err) {
    console.error(`[webhook] invalid JSON: ${err.message}`);
    console.error(rawBody);
  }
});

server.listen(PORT, () => {
  console.log(`[hermes] webhook server listening on :${PORT}`);
  telegramListener.start();
});

// Graceful shutdown: close server, stop poller, and release resources.
process.on("SIGINT", () => {
  console.log("[hermes] SIGINT received, shutting down...");
  telegramListener.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
});

process.on("SIGTERM", () => {
  console.log("[hermes] SIGTERM received, shutting down...");
  telegramListener.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
});
