// src/hermes/processor.js
// Processing pipeline orchestrator:
//   Webhook payload -> resolve session -> read messages -> classify (SOP) ->
//   execute response -> log to Obsidian

import path from "node:path";
import { HermesSessionResolver } from "./sessionResolver.js";
import { MessageReader } from "./messageReader.js";
import {
  classifyMessage,
  SOP_ACTION_REPLY,
  SOP_ACTION_CLARIFY,
  SOP_ACTION_HANDOFF,
  SOP_ACTION_NO_ACTION,
  SOP_ACTION_NOTIFY_ADMIN,
} from "./sop.js";
import { ResponseSender } from "./responseSender.js";
import { FBMarketplaceReplySender } from "./fbMarketplaceReplySender.js";
import { Logger } from "./logger.js";
import { PendingLocationStore } from "./pendingStore.js";

/** Simple retry with exponential backoff for transient browser/network errors. */
async function retry(fn, { retries = 2, delayMs = 1000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable =
        err?.name === "TimeoutError" ||
        err?.message?.includes("tidak bisa diakses") ||
        err?.message?.includes("tidak valid") ||
        err?.message?.includes("ECONNREFUSED") ||
        err?.message?.includes("net::ERR_");
      if (!isRetryable || attempt === retries) throw err;
      const wait = delayMs * attempt;
      console.warn(
        `[retry] Percobaan ${attempt}/${retries} gagal: ${err.message}. Mencoba lagi dalam ${wait}ms...`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

export class Processor {
  constructor({ projectRoot, telegramBotToken, telegramChatId } = {}) {
    const root =
      projectRoot ||
      process.env.HERMES_PROJECT_ROOT ||
      "/home/masterhand/Projects/BotWatcher-Dashboard-source";
    this.resolver = new HermesSessionResolver({ projectRoot: root });
    this.responseSender = new ResponseSender({
      telegramBotToken,
      telegramChatId,
    });
    this.logger = new Logger();
    this.pendingStore = new PendingLocationStore({
      storageDir: path.join(root, "storage"),
    });
    this.accountLocks = new Map();
  }

  async _acquireAccount(accountId) {
    const key = String(accountId);
    const previous = this.accountLocks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const chain = previous.then(() => current);
    this.accountLocks.set(key, chain);
    await previous;
    return () => {
      release();
      if (this.accountLocks.get(key) === chain) this.accountLocks.delete(key);
    };
  }

  async process(payload) {
    const { accountId, accountName, unreadCount } = payload;
    const releaseAccount = await this._acquireAccount(accountId);

    // 1) Resolve Playwright session
    try {
    const session = await this.resolver.resolveSession(accountId);
    if (!session || !session.isLoggedIn) {
      throw new Error(`Sesi login tidak valid untuk akun "${accountId}".`);
    }

    try {
      // 2) Read messages from inbox
      const reader = new MessageReader({ page: session.page });
      const messages = await reader.readInbox();

      if (messages.length === 0 || !messages[0].needsReply) {
        // No messages to process. Log as no_action.
        await this.logger.log({
          accountId,
          accountName,
          category: "no_action",
          message:
            "Tidak ada pesan baru dari pelanggan yang memerlukan balasan.",
          action: "no_action",
        });
        return { accountId, action: "no_action", messageCount: 0 };
      }

      // 3) Classify the latest message
      const latest = messages[0];
      const classification = classifyMessage({
        sender: latest.sender,
        content: latest.content,
        isFirstChat: latest.isFirstChat,
        lastSenderRole: latest.lastSenderRole || "customer",
      });

      let actionResult = null;

      switch (classification) {
        case SOP_ACTION_REPLY: {
          const { VaultStore } = await import("./store.js");
          const store = new VaultStore();
          await store.load();
          const templateKey =
            "TEMPLATE CHAT JIKA ADA CUSTOMER BARU DENGAN CHAT PERTAMA:";
          const template = store.getTemplate(templateKey);
          if (!template) {
            console.error(
              `[processor] Template "${templateKey}" tidak ditemukan di vault.`,
            );
            actionResult = "no_action";
            break;
          }
          // Template includes WA links for customers to click — preserved as-is.
          const replySender = new FBMarketplaceReplySender({
            page: session.page,
          });
          await replySender.sendReply(template);
          actionResult = "reply";
          break;
        }

        case SOP_ACTION_CLARIFY:
          // No approved clarify template exists yet; hand off rather than silently ignore.
          await this.responseSender.sendHumanHandoff({
            accountId,
            accountName,
            message: latest.content,
            reason: "klarifikasi belum punya template approved",
          });
          actionResult = "handoff";
          break;

        case SOP_ACTION_HANDOFF:
          await this.responseSender.sendHumanHandoff({
            accountId,
            accountName,
            message: latest.content,
            reason: "informasi kurang / komplain / butuh respon manusia sesuai SOP",
          });
          actionResult = "handoff";
          break;

        case SOP_ACTION_NOTIFY_ADMIN: {
          const notifyRes =
            await this.responseSender.sendTelegramAdminNotification({
              accountId,
              accountName,
              customerName: latest.sender,
              message: latest.content,
            });

          if (!notifyRes?.ok) {
            throw new Error("Notifikasi admin lokasi gagal dikirim.");
          }

          await this.pendingStore.addTicket({
            telegramMessageId: notifyRes.messageId,
            accountId,
            accountName,
            customerName: latest.sender,
            customerMessage: latest.content,
          });

          actionResult = "pending_lokasi";
          break;
        }

        case SOP_ACTION_NO_ACTION:
          actionResult = "no_action";
          break;

        default:
          actionResult = "no_action";
      }

      // 4) Log the interaction
      const logCategory =
        actionResult === "pending_lokasi" ? "pending_lokasi" : actionResult;
      await this.logger.log({
        accountId,
        accountName,
        category: logCategory,
        message: latest.content,
        action: classification,
        meta:
          actionResult === "pending_lokasi"
            ? { status: "[PENDING_LOKASI]", customer: latest.sender }
            : {},
      });

      return {
        accountId,
        accountName,
        classification,
        actionResult,
        messageCount: messages.length,
      };
    } finally {
      await this.close();
    }
    } finally {
      releaseAccount();
    }
  }

  /**
   * Eksekusi balasan lokasi dari admin Telegram (SOP Poin 4).
   * Mengetikkan balasan admin langsung ke obrolan pelanggan di FB Marketplace,
   * lalu memperbarui log Obsidian menjadi [SELESAI_LOKASI].
   */
  async handleAdminLocationReply({ ticket, replyText }) {
    console.log(
      `[processor] Mengeksekusi balasan admin untuk tiket ${ticket.id} (${ticket.customerName} @ ${ticket.accountName})...`,
    );

    const releaseAccount = await this._acquireAccount(ticket.accountId);
    try {
    // 1) Buka sesi browser akun FB
    const session = await retry(() =>
      this.resolver.resolveSession(ticket.accountId),
    );
    if (!session || !session.isLoggedIn) {
      throw new Error(
        `Sesi login tidak valid untuk akun "${ticket.accountId}".`,
      );
    }

    try {
      // 2) Buka halaman Seller Inbox
      const { marketplaceInboxSelectors: sel } = await import(
        "../monitor/selectors.js"
      );
      await retry(() =>
        session.page.goto(sel.sellerInboxUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        }),
      );
      await session.page.waitForTimeout(4000);

      // 3) Cari obrolan pembeli yang sesuai
      const buttons = session.page.locator(sel.conversationItem);
      const count = await buttons.count();
      let targetBtn = null;

      for (let i = 0; i < count; i++) {
        const text = await buttons.nth(i).innerText();
        if (text.toLowerCase().includes(ticket.customerName.toLowerCase())) {
          targetBtn = buttons.nth(i);
          break;
        }
      }

      if (!targetBtn && count > 0) {
        console.log(
          `[processor] Obrolan atas nama "${ticket.customerName}" tidak ditemukan secara eksak, menggunakan obrolan teratas.`,
        );
        targetBtn = buttons.first();
      }

      if (!targetBtn) {
        throw new Error("Tidak ada obrolan ditemukan di Inbox Penjual.");
      }

      await targetBtn.scrollIntoViewIfNeeded();
      await session.page.waitForTimeout(500);
      await targetBtn.click({ force: true });
      await session.page.waitForTimeout(3000);

      // 4) Kirim balasan admin via FBMarketplaceReplySender (1 bubble)
      const replySender = new FBMarketplaceReplySender({ page: session.page });
      await retry(() => replySender.sendReply(replyText), { retries: 2, delayMs: 1500 });

      // 5) Update tiket pending menjadi completed
      await this.pendingStore.markCompleted(ticket.id);

      // 6) Catat log Obsidian [SELESAI_LOKASI]
      await this.logger.log({
        accountId: ticket.accountId,
        accountName: ticket.accountName,
        category: "selesai_lokasi",
        message: replyText,
        action: "selesai_lokasi",
        meta: {
          customer: ticket.customerName,
          status: "[SELESAI_LOKASI]",
        },
      });

      // 7) Kirim konfirmasi balik ke Telegram admin
      await retry(() =>
        this.responseSender.sendTelegramMessage(
          `✅ [SELESAI_LOKASI] Balasan lokasi berhasil dikirim ke ${ticket.customerName} di akun ${ticket.accountName}!`,
        ),
        { retries: 2, delayMs: 1000 },
      );

      console.log(
        `[processor] Balasan lokasi berhasil diselesaikan untuk ${ticket.customerName}.`,
      );
      return { ok: true, ticketId: ticket.id };
    } finally {
      await this.close();
    }
    } finally {
      releaseAccount();
    }
  }

  async close() {
    if (this.resolver) {
      await this.resolver.close();
    }
  }
}
