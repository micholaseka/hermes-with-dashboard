# Plan: Prevent Chat Spamming by Enforcing Unread & Last-Sender Validation

## Goal

Prevent the Facebook Marketplace inbox bot from spamming chatrooms by verifying that a conversation is genuinely unread and that the latest message was sent by the customer (not the seller) before any reply or handoff is executed.

## Current Context / Assumptions

- **Problem Statement**: The user observed: *"bot malah spam pesan ke chatroom yang tidak menerima pesan"*.
- **Root Cause Identified**:
  1. `messageReader.js` blindly selected the first conversation card (`conversationButtons.first()`) regardless of whether that conversation was unread or already handled.
  2. `messageReader.js` did not verify who sent the *last* message in the chat thread. In conversations where the seller ("You" / "Anda") spoke last, the customer has not replied, yet the bot still processed the thread.
  3. `sop.js` contained a dangerous default fallback (`// 4) Default fallback: reply with template -> return SOP_ACTION_REPLY;`). Even when a conversation was not a first chat (`isFirstChat: false`) and had no location/complaint triggers, it returned `reply`, causing the first-chat WhatsApp template to be resent repeatedly to existing customers.
  4. Per the SOP in `Refrensi/sop tambahan.md`:
     - *"Sinyal adalah petunjuk untuk memeriksa akun, bukan bukti bahwa pesan tertentu belum diproses."*
     - *"Sebelum menyiapkan balasan, pastikan pesan pelanggan terbaru belum pernah diproses."*
     - *"no_action: jangan mengirim pesan jika tidak ada pesan pelanggan baru yang memerlukan jawaban."*
     - *"Jangan mengirim lebih dari satu balasan untuk pesan pelanggan yang sama."*

## Architecture / Proposed Approach

1. Upgrade `MessageReader` (`src/hermes/messageReader.js`) to parse the conversation list for unread indicators, open the candidate conversation, and parse `div[role="log"]` to extract the full chronological message sequence.
2. Determine `lastSenderRole`: if the latest message was sent by the seller (`You` / `Anda`), set `needsReply = false` and abort processing immediately with `no_action`.
3. In `src/hermes/sop.js`, remove the `reply` default fallback; when `isFirstChat === false` and no specific template keyword matches, route to `handoff` or `no_action`, completely prohibiting repeat template blasts.

---

## Step-by-Step Tasks

### Task 1: Update `MessageReader` with Chronological Thread & Last-Sender Detection

**File**: `src/hermes/messageReader.js`

1. When opening the Seller Inbox, scan the conversation list:
   - Identify candidate conversations (check for unread badges, bold text, or preview snippets).
   - Click the most relevant conversation.
2. In the opened conversation thread (`div[role="log"]`), parse all message elements with `aria-label`:
   - Match regex: `/(?:sent\s+.+?\s+by\s+|At\s+.+?,\s+)(.+?):\s*([\s\S]+)/i`.
   - Identify sender: if sender matches `^(You|Anda)$` -> `senderRole = "seller"`, else `senderRole = "customer"`.
   - Deduplicate consecutive duplicate DOM elements.
3. Determine:
   - `lastMsg`: the very last message in the thread.
   - `lastSenderRole`: `lastMsg.senderRole` (`"seller"` vs `"customer"`).
   - `needsReply`: `true` ONLY if `lastSenderRole === "customer"`. If `lastSenderRole === "seller"`, `needsReply = false`.
   - `hasPriorSellerReply`: `true` if any message prior to the customer's last message was sent by the seller.
   - `isFirstChat`: `!hasPriorSellerReply && needsReply`.
4. If `!needsReply`:
   - Log `[messageReader] Obrolan sudah dibalas oleh penjual. Tidak ada pesan baru dari pelanggan.`
   - Return `[]` (empty list) so `Processor` marks it as `no_action` and terminates cleanly without typing or sending anything.
5. If `needsReply`:
   - Return `[{ sender: lastMsg.sender, content: lastMsg.content, isFirstChat, listingTitle, needsReply: true, timestamp }]`.

**Implementation code**:
```javascript
// src/hermes/messageReader.js
import { marketplaceInboxSelectors as sel } from "../monitor/selectors.js";

const NAV_TIMEOUT_MS = 30_000;

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

    // Check account redirect
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

    // Wait for composer textbox to be visible
    const input = this.page.locator(sel.chatInput).first();
    try {
      await input.waitFor({ state: "visible", timeout: 10_000 });
    } catch {
      console.warn(
        "[messageReader] Chat input tidak langsung terlihat, mencoba klik ulang obrolan...",
      );
      await targetButton.click({ force: true });
      await input.waitFor({ state: "visible", timeout: 5_000 });
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
          /(?:sent\s+.+?\s+by\s+|At\s+.+?,\s+)(.+?):\s*([\s\S]+)/i,
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
        listingTitle,
        needsReply: false, // Safe default: do not spam if unsure
        timestamp: new Date().toISOString(),
      },
    ];
  }
}
```

**Verification**:
```bash
node --check src/hermes/messageReader.js
# Expected: no syntax errors
```

---

### Task 2: Fix `sop.js` to Eliminate Default Template Resending

**File**: `src/hermes/sop.js`

1. Modify `classifyMessage({ sender, content, isFirstChat, lastSenderRole })`:
   - If `lastSenderRole === "seller"`: return `SOP_ACTION_NO_ACTION`.
   - If location/COD keywords match: return `SOP_ACTION_NOTIFY_ADMIN`.
   - If handoff triggers match: return `SOP_ACTION_HANDOFF`.
   - If `isFirstChat === true`: return `SOP_ACTION_REPLY` (first-chat WhatsApp template).
   - If `isFirstChat === false` (existing chat):
     - DO NOT return `SOP_ACTION_REPLY`!
     - Return `SOP_ACTION_HANDOFF` so human admin handles customer follow-up questions instead of receiving repeated template spam.

**Implementation code**:
```javascript
// In src/hermes/sop.js:
export function classifyMessage({
  sender,
  content,
  isFirstChat = false,
  lastSenderRole = "customer",
}) {
  // If the last message was sent by the seller, there is nothing to reply to
  if (lastSenderRole === "seller") {
    return SOP_ACTION_NO_ACTION;
  }

  const text = `${sender || ""} ${content || ""}`;
  const normalized = normalize(text);

  // 1) Location / address / COD questions -> notify admin
  if (LOCATION_KEYWORDS.some((kw) => normalized.includes(kw))) {
    return SOP_ACTION_NOTIFY_ADMIN;
  }

  // 2) Handoff triggers (complaint, refund, discount, unclear info, sensitive)
  if (containsHandoffSignal(text)) {
    return SOP_ACTION_HANDOFF;
  }

  // 3) New customer / first chat -> reply with WhatsApp template
  if (isFirstChat) {
    return SOP_ACTION_REPLY;
  }

  // 4) Existing customer follow-up without known automated template:
  // Hand off to human admin to avoid sending duplicate/spam first-chat templates
  return SOP_ACTION_HANDOFF;
}
```

**Verification**:
```bash
node --check src/hermes/sop.js
# Expected: no syntax errors
```

---

### Task 3: Update `Processor` to Pass `lastSenderRole` and Enforce `no_action`

**File**: `src/hermes/processor.js`

1. Pass `latest.lastSenderRole` to `classifyMessage()`.
2. Check `if (!latest.needsReply)`: log `no_action` and return immediately without doing any DOM interaction or sending messages.

**Implementation code**:
```javascript
    // In src/hermes/processor.js:
    if (messages.length === 0 || !messages[0].needsReply) {
      await this.logger.log({
        accountId,
        accountName,
        category: "no_action",
        message: "Tidak ada pesan baru dari pelanggan yang memerlukan balasan.",
        action: "no_action",
      });
      return { accountId, action: "no_action", messageCount: 0 };
    }

    const latest = messages[0];
    const classification = classifyMessage({
      sender: latest.sender,
      content: latest.content,
      isFirstChat: latest.isFirstChat,
      lastSenderRole: latest.lastSenderRole || "customer",
    });
```

**Verification**:
```bash
node --check src/hermes/processor.js
# Expected: no syntax errors
```

---

### Task 4: Verify with Dry-Run and Live Webhook

**File**: `testing/test-spam-guard.js`

Write a verification test that:
1. Opens Account 1 (`Maratul Husna`) where the last message was sent by the seller.
2. Runs `reader.readInbox()`.
3. Asserts that `reader.readInbox()` returns `[]` (empty list) because `lastSenderRole === 'seller'`.
4. Asserts that no message is typed and no reply is sent.
5. Sends simulated webhook: verifies that server logs `[pipeline] accountId=1 action=no_action` and does NOT spam the chatroom.

**Run Command**:
```bash
BOTWATCHER_DATA_DIR=/home/masterhand/.config/Electron node testing/test-spam-guard.js
# Expected: Green assertions confirming no_action and zero chat interactions.
```

---

## Tests / Validation

1. **Syntax Checks**:
   - `node --check src/hermes/messageReader.js`
   - `node --check src/hermes/sop.js`
   - `node --check src/hermes/processor.js`
2. **Spam Guard Test**:
   - Run `testing/test-spam-guard.js` on Account 1: must output `needsReply: false`, return `0` messages to process, and log `no_action`.
3. **Live Webhook Check**:
   - Post webhook for Account 1: verify `/tmp/hermes-webhook.log` shows:
     `[pipeline] accountId=1 action=no_action messageCount=0`
   - Check that the Facebook chat with Maulana receives NO new message.

---

## Risks, Tradeoffs, and Open Questions

1. **Multiple Unread Messages**:
   - If an account has multiple unread conversations simultaneously, the rotator will emit `unreadCount > 1`.
   - The loop in `messageReader.js` will prioritize the first unread conversation. On the next check cycle, BotWatcher will report the remaining unread count and process the next one.
2. **Language in Aria Labels**:
   - Aria labels can be in Indonesian (`Anda:`) or English (`You:`).
   - *Mitigation*: The regex `/(?:sent\s+.+?\s+by\s+|At\s+.+?,\s+)(.+?):\s*([\s\S]+)/i` and `/^(You|Anda)$/i` handles both English and Indonesian Facebook UI seamlessly.
