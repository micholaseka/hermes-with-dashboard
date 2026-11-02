# Plan: FB Marketplace Inbox Automation — Reply Inside Browser, Template with WA Links Preserved

## Goal

Hermes reads customer messages from Facebook Marketplace inbox (inside browser), classifies them via SOP, and replies directly in the FB Marketplace chat using the template from Obsidian vault. The template contains WhatsApp links so customers can click and chat with the shop admin on WhatsApp (managed by admin, not Hermes). Telegram is used only for admin notifications (handoff, location/COD). No WhatsApp sending by Hermes.

## Current Context / Assumptions

- **Platform**: Facebook Marketplace inbox, accessed via Playwright/patchright Chromium in dev mode (mode: `dev`).
- **Accounts**: 2 permanent Chrome profiles under `~/.config/Electron/storage/profiles/{1,2}/` (created by BotWatcher-Dashboard Electron app). Profile 1 = Maratul Husna, Profile 2 = akun kedua.
- **Server**: Node.js ES module server at `server/server.js`, port 8765. Receives webhooks from BotWatcher-Dashboard. Env: `BOTWATCHER_DATA_DIR`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- **Pipeline**: `Processor.process(payload)` → resolve session (open browser with correct profile) → read inbox → classify (SOP) → send reply on FB Marketplace → log to Obsidian.
- **SOP classification** (`src/hermes/sop.js`): `reply` (default, template-based), `clarify`, `handoff` (complaint/refund/discount), `notify_admin` (location/COD), `no_action`.
- **Template**: `template/template chat.md` in Obsidian vault. First section key: `TEMPLATE CHAT JIKA ADA CUSTOMER BARU DENGAN CHAT PERTAMA:`. Contains WA links (`wa.me/6281223330`, `wa.me/c/6281223143330`) and TikTok link. These links are INTENTIONAL — customers click them to chat with shop admin on WhatsApp directly.
- **Telegram**: Bot token + chat ID from `/home/masterhand/.hermes/.env`. Used ONLY for admin notifications (handoff, location/COD). Not for customer replies.
- **Obsidian vault**: `/home/masterhand/Documents/Hermes-Marketplace-inbox`. Logs → `Logs/YYYY/MM/<category>.md`.
- **Hermes does NOT manage WhatsApp.** Admin manages WhatsApp separately. Hermes only manages FB Marketplace inbox.

### Known Bugs

1. **No FB Marketplace reply mechanism**: `ResponseSender.sendWhatsAppReply()` only logs to console — it does NOT type a reply into the FB Marketplace chat. Need a new sender that types into the browser.
2. **Message reader extracts UI chrome**: `MessageReader.readInbox()` reads `div[role="listitem"]` elements which include FB UI elements like "New See all" instead of real customer messages.
3. **Session not closed on account switch**: Fixed in previous work (close old session before opening new one), but needs verification.
4. **Template links must be preserved**: The WA links in the template are intentional. Do NOT strip them.

## Architecture / Proposed Approach

1. **Keep template as-is**: The template with WA links is correct. Customers click the links to chat with shop admin on WhatsApp. Hermes just sends the template text (including links) as a reply on FB Marketplace.
2. **Add FB Marketplace reply sender**: New module `src/hermes/fbMarketplaceReplySender.js` that receives the Playwright `page` object, finds the chat input textarea, types the message, and clicks send.
3. **Processor flow**: For `SOP_ACTION_REPLY`, build message from template (preserving all links), then use `FBMarketplaceReplySender` to type it into the FB Marketplace chat via the browser page.
4. **Fix message reader**: Filter out UI noise patterns. Navigate to conversation detail to read real chat messages instead of inbox list previews.
5. **Telegram stays for admin only**: `sendTelegramAdminNotification` and `sendHumanHandoff` remain unchanged. ResponseSender no longer has `sendWhatsAppReply`.

## Step-by-Step Tasks

### Task 1: Create FB Marketplace Reply Sender

**New file**: `src/hermes/fbMarketplaceReplySender.js`

```js
// src/hermes/fbMarketplaceReplySender.js
// Sends a reply directly in the Facebook Marketplace chat via the browser page.
// No WhatsApp involved — everything happens inside FB Marketplace.

export class FBMarketplaceReplySender {
  constructor({ page }) {
    this.page = page;
  }

  async sendReply(message) {
    // Find the chat input. FB Marketplace uses a contenteditable div
    // with role="textbox" inside the conversation view.
    const inputSelector = 'div[role="textbox"][contenteditable="true"]';
    const input = this.page.locator(inputSelector).first();
    await input.waitFor({ state: "visible", timeout: 15_000 });
    await input.click();
    await this.page.waitForTimeout(500);
    await input.fill(message);
    await this.page.waitForTimeout(500);

    // Find and click the send button.
    const sendBtn = this.page.locator(
      'div[role="button"][aria-label*="Kirim"], div[role="button"][aria-label*="Send"], button[aria-label*="Kirim"], button[aria-label*="Send"]'
    ).first();
    await sendBtn.waitFor({ state: "visible", timeout: 5_000 });
    await sendBtn.click();

    // Wait for message to appear in chat (confirmation).
    await this.page.waitForTimeout(3_000);
    return true;
  }
}
```

**Verification**: `node --check src/hermes/fbMarketplaceReplySender.js` → no errors.

### Task 2: Remove sendWhatsAppReply from ResponseSender

**File**: `src/hermes/responseSender.js`

Remove the `sendWhatsAppReply` method. Add a comment explaining replies are now sent via `FBMarketplaceReplySender`. Keep `sendTelegramAdminNotification` and `sendHumanHandoff`.

```js
// REMOVED: sendWhatsAppReply — replies are now sent directly on FB Marketplace
// via FBMarketplaceReplySender (see src/hermes/fbMarketplaceReplySender.js).
// WhatsApp is not managed by Hermes; admin manages WhatsApp separately.
// Customers are redirected to WhatsApp via links in the template.
```

**Verification**: `node --check src/hermes/responseSender.js` → no errors. `grep -i "whatsapp\|wa.me" src/hermes/responseSender.js` → no matches.

### Task 3: Update Processor to Use FBMarketplaceReplySender

**File**: `src/hermes/processor.js`

Replace the `sendWhatsAppReply` call in `SOP_ACTION_REPLY` case with `FBMarketplaceReplySender`. Build message from template (preserving all links). Pass `session.page` to the sender.

```js
// Add import at top:
import { FBMarketplaceReplySender } from "./fbMarketplaceReplySender.js";

// In SOP_ACTION_REPLY case:
case SOP_ACTION_REPLY: {
  const { VaultStore } = await import("./store.js");
  const store = new VaultStore();
  await store.load();
  const templateKey = "TEMPLATE CHAT JIKA ADA CUSTOMER BARU DENGAN CHAT PERTAMA:";
  const template = store.getTemplate(templateKey);
  if (!template) {
    console.error(`[processor] Template "${templateKey}" tidak ditemukan.`);
    actionResult = "no_action";
    break;
  }
  // Template includes WA links for customers to click — preserved as-is.
  const replySender = new FBMarketplaceReplySender({ page: session.page });
  await replySender.sendReply(template);
  actionResult = "reply";
  break;
}
```

**Verification**: `node --check src/hermes/processor.js` → no errors.

### Task 4: Fix MessageReader — Filter UI Noise and Read Conversation Detail

**File**: `src/hermes/messageReader.js`

4a. Add UI noise filter:

```js
const UI_NOISE_PATTERNS = [
  /^New\s*See all$/i,
  /^See all$/i,
  /^New$/i,
  /^Mark as read$/i,
  /^Filter$/i,
  /^Search$/i,
  /^Inbox$/i,
  /^Unread$/i,
];

function isNoise(raw) {
  const trimmed = raw.trim();
  if (trimmed.length < 3) return true;
  return UI_NOISE_PATTERNS.some((p) => p.test(trimmed));
}
```

4b. In the extraction loop, skip noise:

```js
for (const el of messageElements) {
  const raw = (await el.innerText()).trim();
  if (!raw || isNoise(raw)) continue;
  // ... rest of extraction
}
```

4c. After reading inbox list, navigate to the first conversation to read actual chat messages. Add a method `readConversationDetail()` that clicks the first conversation and reads chat bubbles.

```js
async readConversationDetail() {
  // Click first conversation in inbox list
  const firstConv = this.page.locator('div[role="listitem"]').first();
  await firstConv.click();
  await this.page.waitForTimeout(3_000);

  // Read chat bubbles
  const bubbles = await this.page.locator('div[role="row"] div[dir="auto"], div[data-testid="message-container"] div[dir="auto"]').all();
  const messages = [];
  for (const bubble of bubbles) {
    const text = (await bubble.innerText()).trim();
    if (text && text.length > 2) {
      messages.push({ sender: "", content: text, timestamp: new Date().toISOString() });
    }
  }
  return messages;
}
```

Update `readInbox()` to call `readConversationDetail()` after navigating to inbox, and return those messages instead of inbox list previews.

**Verification**: Run pipeline test, check Obsidian log shows real customer messages (not "New See all").

### Task 5: Verify Template Preserved (No Changes)

**File**: `template/template chat.md` (Obsidian vault) — NO CHANGES NEEDED.

The template with WA links is correct and intentional. Customers click the links to chat with shop admin on WhatsApp. Hermes does not need to modify or strip these links. Hermes just sends the template text as-is on FB Marketplace.

**Verification**: `grep "wa.me" template/template\ chat.md` → links present (expected).

### Task 6: Remove WhatsApp References from server.js

**File**: `server/server.js`

Ensure no WhatsApp-related env vars or config. The server only needs:
- `PORT`
- `BOTWATCHER_DATA_DIR`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

**Verification**: `grep -i "whatsapp\|wa.me\|wa_link" server/server.js` → no matches.

### Task 7: Update start-hermes.sh — Remove WhatsApp Env Vars

**File**: `start-hermes.sh`

Ensure only Telegram credentials are loaded (already done). Remove any WhatsApp-related env vars if present.

**Verification**: `grep -i "whatsapp\|wa.me" start-hermes.sh` → no matches.

### Task 8: End-to-End Test

1. Kill existing server: `kill $(pgrep -f "node server/server.js")`
2. Start server with env vars:
   ```
   TELEGRAM_BOT_TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' /home/masterhand/.hermes/.env | cut -d= -f2-) \
   TELEGRAM_CHAT_ID=$(grep '^TELEGRAM_HOME_CHANNEL=' /home/masterhand/.hermes/.env | cut -d= -f2-) \
   BOTWATCHER_DATA_DIR=/home/masterhand/.config/Electron \
   node server/server.js &
   ```
3. Trigger webhook for account 1:
   ```
   curl -s -X POST http://localhost:8765/webhooks/BotWatcher-Dashboard \
     -H 'Content-Type: application/json' \
     -d '{"signal":"wake","event":"new_inbox_messages","accountId":"1","accountName":"Maratul Husna","hasNewMessages":true,"newMessageCount":1,"unreadCount":1}'
   ```
4. Wait 60 seconds.
5. Check process output: should show reply sent on FB Marketplace with template text (including WA links).
6. Check Obsidian log: new entry with real customer message (not "New See all").

**Expected output**:
```
[webhook] ... accountId=1 ...
[fb-reply] === Sending to Maratul Husna (1) ===
<template text with WA links preserved>
[log] /home/masterhand/Documents/Hermes-Marketplace-inbox/Logs/YYYY/MM_reply.md
[pipeline] accountId=1 classification=reply actionResult=reply messages=N
```

## Risks, Tradeoffs, and Open Questions

1. **FB Marketplace DOM changes**: Chat input selector (`div[role="textbox"][contenteditable="true"]`) and send button selector may change with FB UI updates. Need to verify selectors against live page.
2. **Message reader accuracy**: Filtering UI noise is fragile. Navigating to conversation detail and reading chat bubbles is more reliable but requires understanding FB's conversation URL structure.
3. **Reply delivery confirmation**: Currently no confirmation that the message was actually sent. Need to verify the message appears in the chat after sending.
4. **Rate limiting**: FB may rate-limit or block automated replies. Need to add delays between actions.
5. **Session switching**: Fixed (close old session first), but needs testing with rapid account switches.
6. **Open question**: Should the reply be sent to ALL unread conversations, or only the latest one? Current code processes `messages[0]` (latest). Need to clarify with user.
7. **Open question**: The template has `@` placeholder for WA link. Since Hermes sends the template as-is on FB Marketplace, the `@` will appear in the FB chat. Is this acceptable, or should it be replaced with the actual WA link? (Recommendation: replace `@` with the WA link so customers can click it in FB chat.)
8. **Telegram admin flow completeness**: Currently Telegram notifications are one-way (Hermes → admin). The user mentioned wanting to reply via Telegram and have Hermes forward to customer. This requires a Telegram bot webhook receiver — not yet implemented.
