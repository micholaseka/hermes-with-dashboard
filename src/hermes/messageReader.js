// src/hermes/messageReader.js
// Reads messages from the Facebook Marketplace Seller Inbox using an already
// logged-in Playwright page. Reuses selectors from src/monitor/selectors.js.
//
// Validates whether the conversation is genuinely unread and whether the
// customer sent the last message before returning it for processing.

import { marketplaceInboxSelectors as sel } from "../monitor/selectors.js";

const NAV_TIMEOUT_MS = 30_000;

export const FB_MESSAGE_LABEL_REGEX =
  /(?:sent\s+.+?\s+by\s+|dikirim\s+.+?\s+oleh\s+|at\s+.+?,\s+|pada\s+.+?,\s*)(.+?):\s*([\s\S]+)/i;

export class MessageReader {
  constructor({ page }) {
    this.page = page;
  }

  async readInbox() {
    try {
      await this.page.goto(sel.sellerInboxUrl, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
    } catch (error) {
      if (error?.name === "TimeoutError") {
        throw new Error(
          `Halaman Seller Inbox tidak dimuat dalam ${NAV_TIMEOUT_MS / 1000} detik.`,
        );
      }
      throw error;
    }

    // Check account status redirect
    const url = this.page.url().toLowerCase();
    if (
      url.includes("/login") ||
      url.includes("checkpoint") ||
      /suspend|disabled|blocked/i.test(url)
    ) {
      throw new Error(`Akun tidak bisa diakses: ${this.page.url()}`);
    }

    await this.page.waitForTimeout(4_000);

    const mainContainer = this.page.locator('div[role="main"]').first();
    await mainContainer
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => {});

    const conversationButtons = this.page.locator(sel.conversationItem);
    const count = await conversationButtons.count();

    if (count === 0) {
      console.log("[messageReader] Tidak ada obrolan ditemukan di Inbox Penjual.");
      return [];
    }

    console.log(`[messageReader] Ditemukan ${count} obrolan di Inbox Penjual.`);

    // 1) Find which conversation to inspect
    // Prefer conversations with bold font, unread indicators, or the top candidate
    let targetButton = conversationButtons.first();
    for (let i = 0; i < count; i++) {
      const btn = conversationButtons.nth(i);
      const isUnread = await btn.evaluate((el) => {
        const hasBlueDot = !!el.querySelector(
          'span[style*="rgb(0, 100, 224)"], div[style*="rgb(0, 100, 224)"], [class*="unread"]',
        );
        const spans = Array.from(el.querySelectorAll("span, div"));
        const hasBold = spans.some((s) => {
          const w = window.getComputedStyle(s).fontWeight;
          return w === "bold" || parseInt(w, 10) >= 600;
        });
        return hasBlueDot || hasBold;
      });

      if (isUnread) {
        console.log(`[messageReader] Menemukan obrolan belum dibaca di indeks #${i}.`);
        targetButton = btn;
        break;
      }
    }

    // Extract basic preview info
    const rawText = (await targetButton.innerText()).trim();
    const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
    const fallbackSender = lines[0] || "Pelanggan";
    const listingTitle = lines.find((l) => l.startsWith("·")) || "";
    const previewContent =
      lines.slice(1).filter((l) => !l.startsWith("·")).join(" ") || rawText;

    // Open floating chat thread
    await targetButton.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(500);
    await targetButton.click({ force: true });
    await this.page.waitForTimeout(3_000);

    // Wait for composer textbox to be visible (soft check agar tidak throw jika hanya membaca pesan)
    const input = this.page.locator(sel.chatInput).first();
    try {
      await input.waitFor({ state: "visible", timeout: 8_000 });
    } catch {
      console.warn(
        "[messageReader] Chat input tidak langsung terlihat, mencoba klik ulang obrolan...",
      );
      await targetButton.click({ force: true }).catch(() => {});
      await input.waitFor({ state: "visible", timeout: 4_000 }).catch(() => {});
    }

    // 2) Parse message log to determine who spoke last
    const threadData = await this.page.evaluate(() => {
      const log = document.querySelector('div[role="log"]');
      if (!log) return null;

      const candidates = Array.from(log.querySelectorAll("*[aria-label]"));
      const messages = [];

      candidates.forEach((el) => {
        const label = el.getAttribute("aria-label") || "";
        const match = label.match(
          /(?:sent\s+.+?\s+by\s+|dikirim\s+.+?\s+oleh\s+|at\s+.+?,\s+|pada\s+.+?,\s*)(.+?):\s*([\s\S]+)/i,
        );
        if (match) {
          const senderRaw = match[1].trim();
          const content = match[2].trim();
          const isSeller = /^(You|Anda)$/i.test(senderRaw);
          messages.push({
            sender: senderRaw,
            senderRole: isSeller ? "seller" : "customer",
            content,
            label,
          });
        }
      });

      // Deduplicate consecutive identical messages from duplicate DOM containers
      const uniqueMessages = [];
      messages.forEach((m) => {
        const last = uniqueMessages[uniqueMessages.length - 1];
        if (
          !last ||
          last.content !== m.content ||
          last.senderRole !== m.senderRole
        ) {
          uniqueMessages.push(m);
        }
      });

      if (uniqueMessages.length === 0) return null;

      const lastMsg = uniqueMessages[uniqueMessages.length - 1];
      const hasPriorSellerReply = uniqueMessages
        .slice(0, -1)
        .some((m) => m.senderRole === "seller");

      return {
        totalMessages: uniqueMessages.length,
        lastSender: lastMsg.sender,
        lastSenderRole: lastMsg.senderRole,
        lastContent: lastMsg.content,
        hasPriorSellerReply,
      };
    });

    if (threadData) {
      console.log(
        `[messageReader] Pesan terakhir dikirim oleh: ${threadData.lastSenderRole} (${threadData.lastSender})`,
      );

      // CRITICAL CHECK: If seller already spoke last, customer has not replied yet!
      if (threadData.lastSenderRole === "seller") {
        console.log(
          "[messageReader] Pesan terakhir sudah dikirim oleh penjual (You/Anda). Tidak ada pesan baru yang perlu dijawab.",
        );
        return [];
      }

      const isFirstChat = !threadData.hasPriorSellerReply;
      return [
        {
          sender: threadData.lastSender,
          content: threadData.lastContent,
          isFirstChat,
          lastSenderRole: threadData.lastSenderRole,
          listingTitle,
          needsReply: true,
          timestamp: new Date().toISOString(),
        },
      ];
    }

    // Fallback if role="log" was not found or has non-standard labels
    console.log("[messageReader] Fallback preview parsing...");
    return [
      {
        sender: fallbackSender,
        content: previewContent,
        isFirstChat: false,
        lastSenderRole: "unknown",
        listingTitle,
        needsReply: false, // Safe default: do not spam if unsure
        timestamp: new Date().toISOString(),
      },
    ];
  }
}
