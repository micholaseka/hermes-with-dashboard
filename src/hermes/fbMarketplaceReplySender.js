// src/hermes/fbMarketplaceReplySender.js
// Sends a reply directly in the Facebook Marketplace chat via the browser page.
// Ensures 1 bubble chat, preserving line breaks.

import { marketplaceInboxSelectors as sel } from "../monitor/selectors.js";

export class FBMarketplaceReplySender {
  constructor({ page }) {
    this.page = page;
  }

  async sendReply(message) {
    if (!message || !message.trim()) {
      throw new Error("Pesan balasan kosong, tidak dapat dikirim.");
    }

    // Wait for chat window / composer to settle
    await this.page.waitForTimeout(2_000);

    // 1) Find chat input
    const inputSelectors = [
      sel.chatInput,
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="Aa"]',
      'div[contenteditable="true"]',
    ];

    let input = null;
    for (const selector of inputSelectors) {
      const loc = this.page.locator(selector).first();
      if ((await loc.count()) > 0) {
        input = loc;
        break;
      }
    }

    if (!input) {
      throw new Error("Chat input tidak ditemukan di halaman percakapan.");
    }

    await input.waitFor({ state: "visible", timeout: 10_000 });
    await input.click();
    await this.page.waitForTimeout(300);

    // 2) Fill text in one bubble (Shift+Enter style)
    await input.fill(message);
    await this.page.waitForTimeout(500);

    // 3) Click send button or press Enter
    const sendSelectors = [
      'div[aria-label="Press enter to send"]',
      'div[role="button"][aria-label*="Press enter"]',
      'div[role="button"][aria-label*="Kirim"]',
      'div[role="button"][aria-label*="Send"]',
      'button[aria-label*="Kirim"]',
      'button[aria-label*="Send"]',
    ];

    let sendBtn = null;
    for (const selector of sendSelectors) {
      const loc = this.page.locator(selector).first();
      if ((await loc.count()) > 0 && (await loc.isVisible())) {
        sendBtn = loc;
        break;
      }
    }

    if (sendBtn) {
      console.log("[fb-reply] Mengklik tombol kirim...");
      await sendBtn.click();
    } else {
      console.log("[fb-reply] Mengirim pesan via tombol Enter...");
      await this.page.keyboard.press("Enter");
    }

    // 4) Verify the composer cleared after submission.
    await this.page.waitForTimeout(3_000);
    const remainingText = await input.innerText().catch(() => "");
    if (remainingText.trim()) {
      throw new Error("Balasan Facebook belum terverifikasi terkirim: composer masih berisi teks.");
    }
    return true;
  }
}
