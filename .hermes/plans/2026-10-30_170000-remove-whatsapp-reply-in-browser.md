# Plan: Refactor FB Marketplace Inbox Automation — Remove WhatsApp, Reply Inside Browser

## Goal

Make Hermes reply to customer messages directly inside the Facebook Marketplace browser chat, not via WhatsApp. Remove all WhatsApp-related code and links. Ensure message reading extracts real customer messages (not UI chrome). Keep Telegram for admin-only notifications (handoff, location/COD).

## Current Context / Assumptions

- **Platform**: Facebook Marketplace inbox, accessed via Playwright/patchright Chromium in dev mode.
- **Accounts**: 2 permanent Chrome profiles under `~/.config/Electron/storage/profiles/{1,2}/` (created by BotWatcher-Dashboard Electron app).
- **Server**: Node.js ES module server at `server/server.js`, port 8765, receives webhooks from BotWatcher-Dashboard.
- **Pipeline**: `Processor.process(payload)` → resolve session → read inbox → classify (SOP) → send response → log to Obsidian.
- **SOP classification** (`src/hermes/sop.js`): `reply` (default), `clarify`, `handoff` (complaint/refund/discount), `notify_admin` (location/COD), `no_action`.
- **Telegram**: Bot token + chat ID loaded from `/home/masterhand/.hermes/.env` (TELEGRAM_BOT_TOKEN, TELEGRAM_HOME_CHANNEL). Used only for admin notifications.
- **Obsidian vault**: `/home/masterhand/Documents/Hermes-Marketplace-inbox`. Logs go to `Logs/YYYY/MM/<category>.md`.
- **Template**: `template/template chat.md` in vault. First section key: `TEMPLATE CHAT JIKA ADA CUSTOMER BARU DENGAN CHAT PERTAMA:`.

### Known Bugs

1. **WhatsApp in template and code**: Template contains WA links (`wa.me/6281223330`, `wa.me/c/6281223143330`). `ResponseSender.sendWhatsAppReply()` just logs a message — it does NOT send anything on FB Marketplace. The actual reply must be typed into the FB Marketplace chat textarea.
2. **Message reader extracts UI chrome**: `MessageReader.readInbox()` reads `div[role="listitem"]` elements which include FB UI elements like "New See all" instead of real customer messages.
3. **No FB Marketplace reply mechanism**: There is no code that types a reply into the FB Marketplace chat input and sends it.

## Architecture / Proposed Approach

1. **Remove WhatsApp entirely**: Delete `sendWhatsAppReply` method, remove WA links from template processing, remove WA-related env vars and config.
2. **Add FB Marketplace reply sender**: New method `sendFBMarketplaceReply({ page, message })` that finds the chat input textarea on the FB Marketplace conversation page, types the message, and clicks send.
3. **Fix message reader**: Refine selectors to extract only real customer messages (sender name + message content), skipping UI chrome like "New See all", "See all", navigation elements.
4. **Processor flow change**: After classifying as `reply`, use the page from the session to type the reply directly in the browser. No WhatsApp involved.
5. **Telegram stays for admin**: `sendTelegramAdminNotification` and `sendHumanHandoff` remain for location/COD and handoff cases.

## Step-by-Step Tasks

### Task 1: Remove WhatsApp from ResponseSender

**File**: `src/hermes/responseSender.js`

Remove the `sendWhatsAppReply` method entirely. Replace with a placeholder comment explaining that replies are now sent via `FBMarketplaceReplySender` (Task 2). Keep `sendTelegramAdminNotification` and `sendHumanHandoff`.

```js
// REMOVED: sendWhatsAppReply — replies are now sent directly on FB Marketplace
// via FBMarketplaceReplySender (see src/hermes/fbMarketplaceReplySender.js).
// WhatsApp is not part of this workflow.
```

**Verification**: `node --check src/hermes/responseSender.js` → no errors.

### Task 2: Create FB Marketplace Reply Sender

**New file**: `src/hermes/fbMarketplaceReplySender.js`

Create a module that types a reply into the FB Marketplace chat. It receives the Playwright `page` object and the message text.

```js
// src/hermes/fbMarketplaceReplySender.js
// Sends a reply directly in the Facebook Marketplace chat via the browser page.
// No WhatsApp involved — everything happens inside FB Marketplace.

export class FBMarketplaceReplySender {
  constructor({ page }) {
    this.page = page;
  }

  async sendReply(message) {
    // Find the chat input textarea. FB Marketplace uses a contenteditable div
    // or textarea with role="textbox" inside the conversation view.
    const inputSelector = 'div[role="textbox"][contenteditable="true"], textarea[placeholder*="Ketik"], textarea[placeholder*="Type"]';

    const input = this.page.locator(inputSelector).first();
    await input.waitFor({ state: "visible", timeout: 10_000 });
    await input.click();
    await input.fill(message);

    // Find and click the send button.
    const sendBtn = this.page.locator('button[aria-label*="Kirim"], button[aria-label*="Send"], div[role="button"][aria-label*="Kirim"], div[role="button"][aria-label*="Send"]').first();
    await sendBtn.waitFor({ state: "visible", timeout: 5_000 });
    await sendBtn.click();

    // Wait for the message to appear in the chat (confirmation).
    await this.page.waitForTimeout(2_000);
    return true;
  }
}
```

**Verification**: `node --check src/hermes/fbMarketplaceReplySender.js` → no errors.

### Task 3: Update Processor to Use FB Marketplace Reply Sender

**File**: `src/hermes/processor.js`

Replace the `sendWhatsAppReply` call with `FBMarketplaceReplySender`. The processor already has `session.page` available.

Changes:
- Import `FBMarketplaceReplySender` instead of using `ResponseSender.sendWhatsAppReply`.
- In `SOP_ACTION_REPLY` case: create `FBMarketplaceReplySender({ page: session.page })`, build the message from template, call `sendReply(message)`.
- Keep `ResponseSender` for Telegram notifications only.

```js
// In processor.js, SOP_ACTION_REPLY case:
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
  // Build message from template (no WhatsApp links)
  const fullMessage = template; // template already has no WA links after Task 5
  const replySender = new FBMarketplaceReplySender({ page: session.page });
  await replySender.sendReply(fullMessage);
  actionResult = "reply";
  break;
}
```

**Verification**: `node --check src/hermes/processor.js` → no errors.

### Task 4: Fix MessageReader to Extract Real Customer Messages

**File**: `src/hermes/messageReader.js`

Refine the selector logic to skip UI chrome elements. After extracting `raw` text from each `div[role="listitem"]`, filter out entries that match known UI patterns.

Add a filter function:

```js
const UI_NOISE_PATTERNS = [
  /^New\s*See all$/i,
  /^See all$/i,
  /^New$/i,
  /^Mark as read$/i,
  /^Filter$/i,
  /^Search$/i,
];

function isNoise(raw) {
  const trimmed = raw.trim();
  if (trimmed.length < 3) return true;
  return UI_NOISE_PATTERNS.some((p) => p.test(trimmed));
}
```

In the extraction loop, skip noise:

```js
for (const el of messageElements) {
  const raw = (await el.innerText()).trim();
  if (!raw || isNoise(raw)) continue;
  // ... rest of extraction
}
```

Also, the message reader should navigate to the conversation detail (click on the first conversation) to read the actual chat messages, not just the inbox list. Currently it reads the inbox list which contains conversation previews.

**Verification**: Run pipeline test, check that logged messages are real customer messages, not "New See all".

### Task 5: Clean Up Template — Remove WhatsApp Links

**File**: `template/template chat.md` (in Obsidian vault)

Remove all WhatsApp-related lines and links:
- Remove `WA : https://wa.me/6281223330`
- Remove `link Katalog WA kami: https://wa.me/c/6281223143330`
- Remove `Tiktok: https://www.tiktok.com/@raffa.computer` (optional, keep if user wants)
- Keep the core message template

The template should contain only the message text that will be sent on FB Marketplace.

**Verification**: `cat template/template\ chat.md` → no `wa.me` or `whatsapp` strings.

### Task 6: Remove WhatsApp Config from server.js

**File**: `server/server.js`

Remove any WhatsApp-related environment variables or config. The server only needs:
- `PORT`
- `BOTWATCHER_DATA_DIR`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `OBSIDIAN_VAULT_PATH` (optional, has default)

**Verification**: `grep -i "whatsapp\|wa.me\|wa_link" server/server.js` → no matches.

### Task 7: Update start-hermes.sh — Remove WhatsApp Env Vars

**File**: `start-hermes.sh`

Ensure only Telegram credentials are loaded (already done). Remove any WhatsApp-related env vars if present.

**Verification**: `grep -i "whatsapp\|wa.me" start-hermes.sh` → no matches.

### Task 8: End-to-End Test

1. Kill existing server: `kill $(pgrep -f "node server/server.js")`
2. Start server: `BOTWATCHER_DATA_DIR=/home/masterhand/.config/Electron TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... node server/server.js &`
3. Trigger webhook for account 1:
   ```
   curl -s -X POST http://localhost:8765/webhooks/BotWatcher-Dashboard -H 'Content-Type: application/json' -d '{"signal":"wake","event":"new_inbox_messages","accountId":"1","accountName":"Maratul Husna","hasNewMessages":true,"newMessageCount":1,"unreadCount":1}'
   ```
4. Wait 60 seconds for pipeline to complete.
5. Check process output: should show `[whatsapp]` replaced with `[fb-reply]` or similar, template found, reply sent.
6. Check Obsidian log: new entry with real customer message (not "New See all").

**Expected output**:
```
[webhook] ... accountId=1 ...
[fb-reply] === Sending to Maratul Husna (1) ===
<message text from template>
[log] /home/masterhand/Documents/Hermes-Marketplace-inbox/Logs/YYYY/MM_reply.md
[pipeline] accountId=1 classification=reply actionResult=reply messages=N
```

## Risks, Tradeoffs, and Open Questions

1. **FB Marketplace DOM changes**: The chat input selector (`div[role="textbox"][contenteditable="true"]`) may change with FB UI updates. Need to verify selectors against live page.
2. **Message reader accuracy**: Filtering UI noise is fragile. Better approach: navigate to conversation detail and read chat bubbles specifically. This requires understanding FB's conversation URL structure.
3. **Reply delivery confirmation**: Currently no confirmation that the message was actually sent. Need to verify the message appears in the chat after sending.
4. **Template placeholder**: The `@` placeholder in template is for WA link. After removing WA, need a new placeholder strategy or just send the template as-is.
5. **Rate limiting**: FB may rate-limit or block automated replies. Need to add delays between actions.
6. **Session switching**: Fixed in this plan (close old session first), but needs testing with rapid account switches.
7. **Open question**: Should the reply be sent to ALL unread conversations, or only the latest one? Current code processes `messages[0]` (latest). Need to clarify with user.
