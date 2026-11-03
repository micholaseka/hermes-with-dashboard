// src/hermes/telegramListener.js
// Listens for admin messages on Telegram via long-polling (getUpdates).
// Executes SOP Rule 4: when admin replies with location text,
// the bot sends that reply to the customer in Facebook Marketplace.

export class TelegramListener {
  constructor({
    telegramBotToken,
    telegramChatId,
    processor,
    pendingStore,
    responseSender,
  }) {
    this.token =
      telegramBotToken ||
      process.env.TELEGRAM_CS_BOT_TOKEN ||
      process.env.TELEGRAM_BOT_TOKEN ||
      "";
    this.chatId = telegramChatId || process.env.TELEGRAM_CHAT_ID || "";
    this.processor = processor;
    this.pendingStore = pendingStore;
    this.responseSender = responseSender;
    this.offset = 0;
    this.running = false;
    this.pollTimer = null;
  }

  start() {
    if (!this.token || !this.chatId) {
      console.log(
        "[telegram-listener] Token atau Chat ID kosong. Listener dinonaktifkan.",
      );
      return;
    }

    this.running = true;
    console.log(
      `[telegram-listener] Memulai polling Telegram untuk admin (chatId: ${this.chatId})...`,
    );
    this._pollLoop();
  }

  stop() {
    this.running = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    console.log("[telegram-listener] Listener dihentikan.");
  }

  async _pollLoop() {
    while (this.running) {
      try {
        const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.offset}&timeout=25`;
        const res = await fetch(url);
        const data = await res.json();

        if (res.status === 409 || data.error_code === 409) {
          console.warn(
            "[telegram-listener] Konflik HTTP 409: Token bot ini sedang aktif di sesi/gateway lain.\n" +
            "  -> Untuk balasan live via Telegram, buat bot baru di @BotFather dan set TELEGRAM_CS_BOT_TOKEN di .env.\n" +
            "  -> Balasan lokasi juga bisa dikirim via HTTP POST /api/reply-location."
          );
          // Tunggu 30 detik sebelum mencoba lagi agar tidak flooding
          await new Promise((r) => setTimeout(r, 30000));
          continue;
        }

        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            try {
              await this.handleUpdate(update);
              this.offset = update.update_id + 1;
            } catch (err) {
              console.error(
                `[telegram-listener] Update ${update.update_id} gagal diproses; akan dicoba lagi: ${err.message}`,
              );
              await new Promise((r) => setTimeout(r, 5000));
              break;
            }
          }
        } else {
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch (err) {
        if (this.running) {
          console.error(`[telegram-listener] Error polling: ${err.message}`);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
  }

  async handleUpdate(update) {
    const msg = update.message;
    if (!msg || !msg.text) return;

    // Security: Only accept commands/messages from authorized admin chat ID
    const senderChatId = String(msg.chat.id);
    const authorizedChatId = String(this.chatId);
    if (senderChatId !== authorizedChatId) {
      console.warn(
        `[telegram-listener] Mengabaikan pesan dari chat unauthorized: ${senderChatId}`,
      );
      return;
    }

    const text = msg.text.trim();
    console.log(
      `[telegram-listener] Menerima balasan dari admin: "${text.substring(0, 60)}..."`,
    );

    // 1) Cek apakah ini reply ke pesan bot tertentu
    const replyToId = msg.reply_to_message?.message_id;
    let ticket = null;

    if (replyToId) {
      ticket = await this.pendingStore.getTicket(replyToId);
    }

    // 2) Jika bukan reply spesifik, cek apakah admin mengisi template lokasi
    if (!ticket && /lokasi kami di|bisa cod|free ongkir/i.test(text)) {
      console.warn(
        "[telegram-listener] Balasan template harus memakai Reply pada notifikasi tiket; fallback tanpa tiket dinonaktifkan.",
      );
      return;
    }

    if (!ticket) {
      console.log(
        "[telegram-listener] Tidak ada tiket [PENDING_LOKASI] yang cocok untuk balasan ini.",
      );
      return;
    }

    console.log(
      `[telegram-listener] Menemukan tiket cocok: Akun ${ticket.accountName}, Pembeli: ${ticket.customerName}`,
    );

    try {
      await this.processor.handleAdminLocationReply({
        ticket,
        replyText: text,
      });
    } catch (err) {
      console.error(
        `[telegram-listener] Gagal mengirim balasan ke FB: ${err.message}`,
      );
      if (this.responseSender) {
        await this.responseSender.sendTelegramMessageWithRetry(
          `❌ Gagal mengirim balasan ke ${ticket.customerName} (${ticket.accountName}): ${err.message}`,
        );
      }
    }
  }
}
