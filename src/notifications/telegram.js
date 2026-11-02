// src/notifications/telegram.js
//
// Notifikasi Telegram sederhana: cuma kirim "dari <label akun>: <jumlah>
// pesan yang perlu dijawab". Tidak ada nama pengirim, tidak ada
// preview isi chat, tidak ada template/command "/".
//
// Zero-dependency: pakai fetch bawaan Node 18+ (sesuai keputusan
// arsitektur di spesifikasi awal), tidak butuh library Telegram apa pun.

const TELEGRAM_API = "https://api.telegram.org";

export class TelegramNotifier {
  constructor({ botToken, chatId } = {}) {
    this.botToken = botToken || process.env.TELEGRAM_BOT_TOKEN || "";
    this.chatId =
      chatId ||
      process.env.TELEGRAM_CHAT_ID ||
      process.env.TELEGRAM_HOME_CHANNEL ||
      "";
    this.consoleOnly = !this.botToken || !this.chatId;

    if (this.consoleOnly) {
      console.warn(
        "[TelegramNotifier] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID kosong. " +
          "Mode console-only aktif — notifikasi cuma ditulis ke log, " +
          "tidak dikirim ke Telegram.",
      );
    }
  }

  // Dipanggil manual oleh main.mjs/index.js lewat event account_checked:
  //   notifier.notifyUnread(accountName, unreadCount);
  async notifyUnread(accountLabel, totalUnread) {
    const text = `dari ${accountLabel}: ${totalUnread} pesan yang perlu dijawab`;

    if (this.consoleOnly) {
      console.log(`[TelegramNotifier] (console-only) ${text}`);
      return;
    }

    try {
      const res = await fetch(
        `${TELEGRAM_API}/bot${this.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: this.chatId,
            text,
          }),
        },
      );

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(
          `[TelegramNotifier] Gagal kirim (HTTP ${res.status}): ${body}`,
        );
      }
    } catch (err) {
      // Kegagalan kirim Telegram TIDAK BOLEH menghentikan siklus pemantauan.
      // Cukup log error di sini.
      console.error(`[TelegramNotifier] Gagal kirim: ${err.message}`);
    }
  }

  // Dipanggil saat akun Facebook terdeteksi bermasalah (checkpoint, banned,
  // sesi kadaluarsa / logout) agar admin segera tahu dan bisa login ulang.
  async notifyAccountError(accountLabel, reason) {
    const text =
      `⚠️ PERINGATAN AKUN FACEBOOK!\n` +
      `Akun: ${accountLabel}\n` +
      `Status: ${reason || "Sesi terputus / perlu login ulang"}\n\n` +
      `Silakan buka BotWatcher Dashboard dan klik 'Balas Sekarang' / 'Login Ulang' untuk memulihkan sesi akun ini.`;

    if (this.consoleOnly) {
      console.log(`[TelegramNotifier] (console-only alert) ${text}`);
      return;
    }

    try {
      const res = await fetch(
        `${TELEGRAM_API}/bot${this.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: this.chatId,
            text,
          }),
        },
      );

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(
          `[TelegramNotifier] Gagal kirim alert (HTTP ${res.status}): ${body}`,
        );
      }
    } catch (err) {
      console.error(`[TelegramNotifier] Gagal kirim alert: ${err.message}`);
    }
  }
}