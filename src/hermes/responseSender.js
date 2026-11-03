// src/hermes/responseSender.js
// Sends outbound notifications via Telegram (location questions + human handoff).
// Console-only fallback if Telegram credentials are absent.

export class ResponseSender {
  constructor({ telegramBotToken, telegramChatId } = {}) {
    this.telegramBotToken =
      telegramBotToken ||
      process.env.TELEGRAM_CS_BOT_TOKEN ||
      process.env.TELEGRAM_BOT_TOKEN ||
      "";
    this.telegramChatId = telegramChatId || process.env.TELEGRAM_CHAT_ID || "";
  }

  /** Send general text message to admin Telegram. */
  async sendTelegramMessage(text) {
    if (!this.telegramBotToken || !this.telegramChatId) {
      console.log(`[telegram] (console-only) ${text}`);
      return { ok: true, messageId: null };
    }

    try {
      const res = await fetch(
        `https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: this.telegramChatId, text }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        console.error(`[telegram] Gagal kirim: ${JSON.stringify(data)}`);
        return { ok: false, messageId: null };
      }
      return { ok: true, messageId: data.result?.message_id };
    } catch (err) {
      console.error(`[telegram] Gagal kirim: ${err.message}`);
      return { ok: false, messageId: null };
    }
  }

  /** Send general text message to admin Telegram with simple retry. */
  async sendTelegramMessageWithRetry(text, retries = 2, delayMs = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      const result = await this.sendTelegramMessage(text);
      if (result.ok) return result;
      if (attempt === retries) return result;
      const wait = delayMs * attempt;
      console.warn(
        `[telegram-retry] Percobaan ${attempt}/${retries} gagal. Mencoba lagi dalam ${wait}ms...`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
    return { ok: false, messageId: null };
  }

  /** Send Telegram admin notification for location/address/COD questions per SOP. */
  async sendTelegramAdminNotification({
    accountId,
    accountName,
    customerName,
    message,
  }) {
    const text =
      `Tanya Lokasi!\n` +
      `Akun FB: ${accountName || accountId}\n` +
      `Pengirim: ${customerName || "Pelanggan"}\n` +
      `Isi Chat: ${message || "-"}\n\n` +
      `Admin, silakan balas pesan ini menggunakan template berikut:\n` +
      `Lokasi kami di _________ kak\n` +
      `bisa COD dan bayar dirumah kak\n` +
      `free ongkir cek sepuasnya baru bayar\n` +
      `ada no wa kak saya share lokasinya?`;

    return this.sendTelegramMessage(text);
  }

  /** Send human-handoff notification (complaint, refund, discount, sensitive). */
  async sendHumanHandoff({ accountName, message, reason }) {
    const text = `Handoff ke manusia — ${reason}.\nAkun: ${accountName}\nPesan: ${message}`;
    return this.sendTelegramMessage(text);
  }
}
