# Plan: Fix Facebook Marketplace Seller Inbox Reader & Reply Automation

## Goal

Fix the Facebook Marketplace inbox reader and auto-reply pipeline so that when a new inbox message webhook is received, Hermes navigates to the actual Marketplace Seller Inbox, selects the conversation, extracts real customer messages according to SOP, and sends the single-bubble reply or Telegram admin notification.

## Current Context / Assumptions

- **Webhook Server**: Runs on port 8765 (`server/server.js`), started via `start-hermes.sh` and cron `@reboot / */2min`.
- **Profiles**: Electron userData at `/home/masterhand/.config/Electron` contains persistent Chromium profiles for Account 1 (`Maratul Husna`) and Account 2 (`akun kedua`). Both accounts are confirmed logged in (`isLoggedIn: true`).
- **Obsidian Vault**: Located at `/home/masterhand/Documents/Hermes-Marketplace-inbox/`. Contains:
  - `template/template chat.md`: Verified parsed into `TEMPLATE CHAT JIKA ADA CUSTOMER BARU DENGAN CHAT PERTAMA:` (containing Raffa Computer WhatsApp links) and `TEMPLATE LOKASI YANG KAMU AKAN BERIKAN KE USER DI FORWARD TELEGRAM`.
  - `Refrensi/SOP-Costumer-Service-RaffaComputer.md` & `Refrensi/sop tambahan.md`: SOP rules (1 bubble chat, new customer template, location/COD to Telegram admin, handoff for complaints/discounts/refunds).
- **Telegram Notifications**: Credentials configured in `/home/masterhand/.hermes/.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_HOME_CHANNEL`).
- **Identified Bugs in Current Implementation**:
  1. `messageReader.js` navigates to `https://www.facebook.com/marketplace/you/dashboard/` instead of the actual inbox: `https://www.facebook.com/marketplace/inbox/?targetTab=SELLER`. The dashboard only shows counter cards, not conversations.
  2. `messageReader.js` queries `div[role="listitem"]`. On Facebook web, `div[role="listitem"]` matches hidden global notifications (`"New See all"`, `"UnreadWe noticed a new login..."`), resulting in timeout errors when attempting to click.
  3. Real conversation cards on `https://www.facebook.com/marketplace/inbox/?targetTab=SELLER` are `<div role="button" tabindex="0">` inside `div[role="main"]`.
  4. Clicking a conversation card opens the floating Messenger thread window (`div[role="region"][aria-label="Thread composer"]` and `div[role="log"]`), where the chat input is `div[role="textbox"][contenteditable="true"]` and the send button is `div[aria-label="Press enter to send"]` (or keyboard `Enter`).

## Architecture / Proposed Approach

1. Update `src/monitor/selectors.js` and `src/hermes/messageReader.js` to target the true Seller Inbox URL (`https://www.facebook.com/marketplace/inbox/?targetTab=SELLER`) and locate conversations using `div[role="main"] div[role="button"][tabindex="0"]`.
2. In `messageReader.js`, click the latest conversation item to trigger the floating chat window, inspect `div[role="log"]` for prior seller messages (to determine whether this is a First Chat / New Customer per SOP), and extract the latest message from the buyer.
3. In `src/hermes/fbMarketplaceReplySender.js`, ensure typing into `div[role="textbox"][contenteditable="true"]` preserves newlines within a single bubble chat and triggers send via `div[aria-label="Press enter to send"]` or keyboard `Enter`.

---

## Step-by-Step Tasks

### Task 1: Update Selectors for Seller Inbox & Composer

**File**: `src/monitor/selectors.js`

Add explicit selectors for the Seller Inbox page, conversation cards, and the Messenger composer. Keep existing `inboxUrl` intact for `checkUnread.js` (which reads the dashboard counter card), and add `sellerInboxUrl`.

```javascript
export const marketplaceInboxSelectors = {
  // Dashboard URL - dipakai rotator untuk membaca angka badge counter
  inboxUrl: "https://www.facebook.com/marketplace/you/dashboard/?locale=id_ID",

  // URL Inbox Penjual asli - tempat daftar obrolan pembeli dan chat thread
  sellerInboxUrl: "https://www.facebook.com/marketplace/inbox/?targetTab=SELLER&locale=id_ID",

  // Badge counter di halaman dashboard
  unreadBadge: 'a[href*="targetTab=SELLER"] span[dir="auto"]',

  // Daftar obrolan di halaman Seller Inbox (di dalam kontainer role="main")
  conversationItem: 'div[role="main"] div[role="button"][tabindex="0"]',

  // Messenger floating chat container & log
  chatLog: 'div[role="log"][aria-label*="Messages in conversation"], div[role="log"]',
  composerRegion: 'div[role="region"][aria-label="Thread composer"]',
  chatInput: 'div[role="textbox"][contenteditable="true"]',
  sendButton: 'div[aria-label="Press enter to send"], div[aria-label*="Kirim"], div[aria-label*="Send"]',

  unavailableText: [
    "your account has been suspended",
    "your account has been temporarily suspended",
    "we suspended your account",
    "your account has been disabled",
    "we disabled your account",
    "this account has been disabled",
    "akun anda ditangguhkan",
    "akun anda telah ditangguhkan",
    "akun anda dinonaktifkan",
    "akun anda telah dinonaktifkan",
  ],
};
```

**Verification**:
```bash
node -e "import('./src/monitor/selectors.js').then(m => { console.log(m.marketplaceInboxSelectors.sellerInboxUrl ? 'OK' : 'FAIL'); })"
# Expected: OK
```

---

### Task 2: Refactor `MessageReader` to Read from Real Seller Inbox

**File**: `src/hermes/messageReader.js`

Rewrite `MessageReader` to:
1. Navigate directly to `sel.sellerInboxUrl`.
2. Wait for `div[role="main"]` to be visible.
3. Locate conversation items via `sel.conversationItem`.
4. Parse the latest conversation item (buyer name, listing title, preview snippet).
5. Click the conversation item to open the floating chat window.
6. Wait for `div[role="textbox"][contenteditable="true"]` to appear.
7. Inspect the chat log (`div[role="log"]`) to check if seller ("You") has messaged before:
   - If no messages by "You", set `isFirstChat: true`.
   - Extract the customer's latest message content and timestamp.
8. Return structured message objects: `{ sender, content, isFirstChat, timestamp, listingTitle }`.

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
        throw new Error(`Halaman Seller Inbox tidak dimuat dalam ${NAV_TIMEOUT_MS / 1000} detik.`);
      }
      throw error;
    }

    // Check account status redirect
    const url = this.page.url().toLowerCase();
    if (url.includes("/login") || url.includes("checkpoint") || /suspend|disabled|blocked/i.test(url)) {
      throw new Error(`Akun tidak bisa diakses: ${this.page.url()}`);
    }

    // Wait for the conversation list to settle
    await this.page.waitForTimeout(4_000);

    const mainContainer = this.page.locator('div[role="main"]').first();
    await mainContainer.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});

    // Find conversation buttons inside main
    const conversationButtons = this.page.locator(sel.conversationItem);
    const count = await conversationButtons.count();

    if (count === 0) {
      console.log("[messageReader] Tidak ada obrolan ditemukan di Inbox Penjual.");
      return [];
    }

    console.log(`[messageReader] Ditemukan ${count} obrolan di Inbox Penjual.`);

    // Extract details from the first (latest) conversation
    const firstButton = conversationButtons.first();
    const rawText = (await firstButton.innerText()).trim();
    const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
    const sender = lines[0] || "Pelanggan";
    const listingTitle = lines.find((l) => l.startsWith("·")) || "";
    const previewContent = lines.slice(1).filter((l) => !l.startsWith("·")).join(" ") || rawText;

    // Click to open floating chat thread
    await firstButton.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(500);
    await firstButton.click({ force: true });
    await this.page.waitForTimeout(3_000);

    // Wait for composer textbox to be visible
    const input = this.page.locator(sel.chatInput).first();
    try {
      await input.waitFor({ state: "visible", timeout: 10_000 });
    } catch {
      console.warn("[messageReader] Chat input tidak langsung terlihat, mencoba klik ulang obrolan...");
      await firstButton.click({ force: true });
      await input.waitFor({ state: "visible", timeout: 5_000 });
    }

    // Inspect chat log to see if there is prior conversation from 'You'
    const chatLogInfo = await this.page.evaluate(() => {
      const logs = document.querySelectorAll('div[role="log"]');
      let hasPriorSellerReply = false;
      let lastCustomerMessage = "";

      logs.forEach((log) => {
        const text = log.innerText || "";
        if (text.includes("You sent") || text.includes("Anda mengirim")) {
          hasPriorSellerReply = true;
        }

        // Look for customer message containers
        const messageElements = log.querySelectorAll('div[aria-label*=":"]');
        messageElements.forEach((el) => {
          const label = el.getAttribute("aria-label") || "";
          if (label.includes(", You:") || label.includes(", Anda:")) {
            hasPriorSellerReply = true;
          } else if (label.includes(": ")) {
            const parts = label.split(": ");
            lastCustomerMessage = parts.slice(1).join(": ").trim();
          }
        });
      });

      return { hasPriorSellerReply, lastCustomerMessage };
    });

    const isFirstChat = !chatLogInfo.hasPriorSellerReply;
    const finalContent = chatLogInfo.lastCustomerMessage || previewContent;

    return [
      {
        sender,
        content: finalContent,
        isFirstChat,
        listingTitle,
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

### Task 3: Strengthen `FBMarketplaceReplySender`

**File**: `src/hermes/fbMarketplaceReplySender.js`

Enhance `FBMarketplaceReplySender` to:
1. Locate `div[role="textbox"][contenteditable="true"]` reliably in the composer.
2. Focus and fill the template message directly (preserving newlines in a single bubble).
3. Try clicking the send button (`div[aria-label="Press enter to send"]`), and fallback to `page.keyboard.press("Enter")`.
4. Wait 2 seconds to confirm the input clears and the message is dispatched.

**Implementation code**:
```javascript
// src/hermes/fbMarketplaceReplySender.js
import { marketplaceInboxSelectors as sel } from "../monitor/selectors.js";

export class FBMarketplaceReplySender {
  constructor({ page }) {
    this.page = page;
  }

  async sendReply(message) {
    if (!message || !message.trim()) {
      throw new Error("Pesan balasan kosong, tidak dapat dikirim.");
    }

    // 1) Find chat input
    const input = this.page.locator(sel.chatInput).first();
    await input.waitFor({ state: "visible", timeout: 10_000 });
    await input.click();
    await this.page.waitForTimeout(300);

    // 2) Fill text in one bubble
    await input.fill(message);
    await this.page.waitForTimeout(500);

    // 3) Click send button or press Enter
    const sendBtn = this.page.locator(sel.sendButton).first();
    if ((await sendBtn.count()) > 0 && (await sendBtn.isVisible())) {
      console.log("[fb-reply] Mengklik tombol kirim...");
      await sendBtn.click();
    } else {
      console.log("[fb-reply] Tombol kirim tidak ditemukan, menekan Enter...");
      await this.page.keyboard.press("Enter");
    }

    // 4) Wait for message submission
    await this.page.waitForTimeout(3_000);
    return true;
  }
}
```

**Verification**:
```bash
node --check src/hermes/fbMarketplaceReplySender.js
# Expected: no syntax errors
```

---

### Task 4: Connect First-Chat Logic in `Processor` and `SOP`

**Files**:
- `src/hermes/sop.js`
- `src/hermes/processor.js`

1. In `src/hermes/sop.js`:
   - Accept `{ sender, content, isFirstChat }`.
   - If `isFirstChat === true` and content does not ask for location/refund: return `SOP_ACTION_REPLY`.
   - If customer asks for location/COD: return `SOP_ACTION_NOTIFY_ADMIN`.
   - If complaint/refund/discount: return `SOP_ACTION_HANDOFF`.
2. In `src/hermes/processor.js`:
   - Pass `latest.isFirstChat` to `classifyMessage()`.
   - Correct the category typo (`"pending_loksi"` / `"pending_loaksi"` -> `"pending_lokasi"`).
   - If `actionResult === "pending_lokasi"`, log with status `[PENDING_LOKASI]` per SOP.

**Verification**:
```bash
node --check src/hermes/sop.js
node --check src/hermes/processor.js
# Expected: no syntax errors
```

---

### Task 5: End-to-End Pipeline Dry-Run Verification

Create an integration test script `testing/test-hermes-pipeline.js` that:
1. Resolves session for Account 1 (`Maratul Husna`) in headless mode.
2. Runs `reader.readInbox()`: verifies that conversations are detected and chat input is opened.
3. Tests classification using real extracted customer message.
4. If classified as reply, tests input fill and clears input without sending (dry-run safe).
5. If classified as location/handoff, verifies Telegram notification sends to admin chat `7426438358`.
6. Checks Obsidian log entry created in `Logs/YYYY/MM/`.

**Run Command**:
```bash
BOTWATCHER_DATA_DIR=/home/masterhand/.config/Electron node testing/test-hermes-pipeline.js
# Expected: All steps pass with green output and clean browser shutdown.
```

---

## Tests / Validation

1. **Unit Syntax Checks**:
   - `node --check src/monitor/selectors.js`
   - `node --check src/hermes/messageReader.js`
   - `node --check src/hermes/fbMarketplaceReplySender.js`
   - `node --check src/hermes/sop.js`
   - `node --check src/hermes/processor.js`
2. **Template Parsing Check**:
   - Verify `VaultStore.load()` returns both the first-chat template and location template.
3. **Live Webhook End-to-End Test**:
   - Send test webhook POST to `http://localhost:8765/webhooks/BotWatcher-Dashboard`.
   - Verify server log in `/tmp/hermes-webhook.log` shows:
     `[pipeline] accountId=1 classification=... actionResult=... messages=1`
   - Verify Obsidian vault log is appended in `Logs/YYYY/MM/`.

---

## Risks, Tradeoffs, and Open Questions

1. **Facebook UI Localization**:
   - Attribute `aria-label` may vary between Indonesian (`Tulis pesan...`) and English (`Write to...`).
   - *Mitigation*: Use tag and role-based matching (`div[role="textbox"][contenteditable="true"]`) combined with `div[role="region"][aria-label*="composer" i]` which is stable regardless of language.
2. **Concurrent Access to Account Profile (SingletonLock)**:
   - If BotWatcher-Dashboard's rotator checks Account 1 at the exact same second Hermes opens Account 1, Chromium will fail with `SingletonLock`.
   - *Mitigation*: `sessionResolver.js` already includes `waitForProfileUnlocked()` and `acquireAccountSlot()`. Ensure old sessions are always closed before new operations.
3. **Live Customer Reply vs Dry-Run**:
   - When testing Account 1 live, the first conversation in the list is a real user (`Maulana`).
   - *Mitigation*: Pipeline test script must run in dry-run mode (type and clear) before enabling live production sends.
