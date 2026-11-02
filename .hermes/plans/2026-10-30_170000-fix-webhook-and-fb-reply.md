# Plan: Fix Webhook "Always True" + FB Marketplace Reply Inside Browser

## Goal

Fix BotWatcher-Dashboard so it only sends the "new inbox" webhook to Hermes when there are genuinely new messages (not every check cycle). Also make Hermes reply directly in the FB Marketplace browser chat using the Obsidian template (with WA links preserved for customers to click). Remove all WhatsApp sending by Hermes.

## Current Context / Assumptions

- **BotWatcher-Dashboard** monitors FB Marketplace inbox per account. On each check cycle, it emits `account_checked` with `{ accountId, loggedIn, unreadCount, reason }`.
- **electron/main.mjs** (line 193-227) handles `account_checked`: reads `previousUnreadCount` from `manager.getStatus()`, calls `manager.updateStatus()`, then calls `hermesWebhook.notifyIfNewInboxMessages()`.
- **Bug**: `notifyIfNewInboxMessages` computes `newMessageCount = unreadCount - (previousUnreadCount ?? 0)`. If `previousUnreadCount` is `null` (first check after restart, or status not persisted), `newMessageCount = unreadCount`. If unreadCount > 0, a webhook is sent even if those messages were already there. Also, `hasNewMessages: true` is hardcoded in the payload, so every webhook looks like "ada inbox nih = true".
- **Hermes server** (`server/server.js`, port 8765): receives webhook, runs `Processor.process()` → resolve session → read inbox → classify (SOP) → reply on FB Marketplace → log to Obsidian.
- **Template**: `template/template chat.md` in Obsidian vault. Contains WA links (`wa.me/6281223330`, `wa.me/c/6281223143330`) and TikTok link. These are INTENTIONAL — customers click to chat with shop admin on WhatsApp (admin manages WA, not Hermes).
- **Telegram**: Bot token + chat ID from `/home/masterhand/.hermes/.env`. Used only for admin notifications (handoff, location/COD).
- **Hermes does NOT manage WhatsApp.** Only FB Marketplace inbox.

### Root Cause of "Always True" Bug

In `electron/main.mjs` line 201-202:
```js
const previousUnreadCount = manager.getStatus(accountId)?.unreadCount ?? null;
```

If `getStatus` returns `null` (account not in memory map) or `unreadCount` is `null` (DB has NULL), then `previousUnreadCount` is `null`. Then in `hermesWebhook.js`:
```js
const newMessageCount = unreadCount - (previousUnreadCount ?? 0);
// = unreadCount - 0 = unreadCount
if (newMessageCount <= 0) return false; // false if unreadCount > 0
```

So if `unreadCount = 5` and `previousUnreadCount = null`, `newMessageCount = 5 > 0`, webhook is sent. This happens on EVERY check after a restart (because in-memory state is lost) or if the DB unread_count is NULL.

Additionally, there's no tracking of "last webhook sent for this unread count" — so if the rotator re-checks and the count hasn't changed but previousUnreadCount was null, a duplicate webhook is sent.

## Architecture / Proposed Approach

### Part A: Fix "Always True" Webhook (BotWatcher-Dashboard side)

1. **Track last notified unread count**: Add a `lastNotifiedUnreadCount` field to the account status (in-memory + DB). Only send a webhook if `unreadCount > lastNotifiedUnreadCount`.
2. **Persist across restarts**: Store `lastNotifiedUnreadCount` in the DB so it survives restarts.
3. **Guard against null**: If `previousUnreadCount` is `null` (first time), set `lastNotifiedUnreadCount = unreadCount` WITHOUT sending a webhook (to avoid flooding on first check). Only send on subsequent increases.

### Part B: FB Marketplace Reply Inside Browser (Hermes side)

1. **Create `FBMarketplaceReplySender`**: Types reply into FB Marketplace chat via browser page.
2. **Remove `sendWhatsAppReply`** from ResponseSender (keep Telegram methods).
3. **Update Processor**: Use `FBMarketplaceReplySender` with template text (preserving WA links).
4. **Fix MessageReader**: Filter UI noise, read real customer messages.
5. **Keep template as-is**: WA links are intentional.

## Step-by-Step Tasks

### Task 1: Add `lastNotifiedUnreadCount` to AccountManager

**File**: `src/accounts/accountManager.js`

1a. Add field to `mapStatus`:
```js
lastNotifiedUnreadCount:
  row?.last_notified_unread_count === null || row?.last_notified_unread_count === undefined
    ? null
    : Number(row?.last_notified_unread_count),
```

1b. Add to `updateStatus` patch handling:
```js
// In updateStatus, add to the next object:
lastNotifiedUnreadCount:
  patch.lastNotifiedUnreadCount !== undefined
    ? patch.lastNotifiedUnreadCount
    : current.lastNotifiedUnreadCount,
```

1c. Add to the DB update in `repository.updateStatus` (Task 2).

**Verification**: `node --check src/accounts/accountManager.js` → no errors.

### Task 2: Add `last_notified_unread_count` Column to DB

**File**: `src/database/database.js`

Add column to `account_status` table:
```sql
ALTER TABLE account_status ADD COLUMN last_notified_unread_count INTEGER;
```

In the `CREATE TABLE` statement, add:
```sql
last_notified_unread_count INTEGER,
```

**Verification**: `node -e "import('./src/database/database.js').then(m => { const db = m.createDatabase('/tmp/test.db'); console.log('OK'); db.close(); })"` → no errors.

### Task 3: Update AccountRepository for New Column

**File**: `src/accounts/accountRepository.js`

3a. In `listAccountsWithStatus()` SELECT, add `s.last_notified_unread_count`.
3b. In `updateStatus()`, add `last_notified_unread_count = ?` to SET clause and `status.lastNotifiedUnreadCount ?? null` to params.
3c. In `mapStatus` (accountManager.js), already done in Task 1.

**Verification**: `node --check src/accounts/accountRepository.js` → no errors.

### Task 4: Fix Webhook Logic in electron/main.mjs

**File**: `electron/main.mjs`

Replace lines 213-226 with logic that only sends webhook when unread count genuinely increased since last notification:

```js
if (usable) {
  const account = manager.getAccount(accountId);
  const lastNotified = manager.getStatus(accountId)?.lastNotifiedUnreadCount ?? null;

  // Only notify if unread count increased since last notification.
  // On first check (lastNotified === null), set baseline without sending
  // to avoid flooding on restart.
  if (lastNotified === null) {
    manager.updateStatus(accountId, {
      lastNotifiedUnreadCount: unreadCount,
    });
  } else if (unreadCount > lastNotified) {
    manager.updateStatus(accountId, {
      lastNotifiedUnreadCount: unreadCount,
    });
    void hermesWebhook.notifyIfNewInboxMessages({
      accountId,
      accountName: account?.name ?? accountId,
      unreadCount,
      previousUnreadCount: lastNotified,
    });
  }
}
```

**Verification**: `node --check electron/main.mjs` → no errors.

### Task 5: Create FB Marketplace Reply Sender

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
    const inputSelector = 'div[role="textbox"][contenteditable="true"]';
    const input = this.page.locator(inputSelector).first();
    await input.waitFor({ state: "visible", timeout: 15_000 });
    await input.click();
    await this.page.waitForTimeout(500);
    await input.fill(message);
    await this.page.waitForTimeout(500);

    const sendBtn = this.page.locator(
      'div[role="button"][aria-label*="Kirim"], div[role="button"][aria-label*="Send"], button[aria-label*="Kirim"], button[aria-label*="Send"]'
    ).first();
    await sendBtn.waitFor({ state: "visible", timeout: 5_000 });
    await sendBtn.click();

    await this.page.waitForTimeout(3_000);
    return true;
  }
}
```

**Verification**: `node --check src/hermes/fbMarketplaceReplySender.js` → no errors.

### Task 6: Remove sendWhatsAppReply from ResponseSender

**File**: `src/hermes/responseSender.js`

Remove the `sendWhatsAppReply` method. Keep `sendTelegramAdminNotification` and `sendHumanHandoff`. Add comment.

**Verification**: `node --check src/hermes/responseSender.js` → no errors. `grep -i "whatsapp\|wa.me" src/hermes/responseSender.js` → no matches.

### Task 7: Update Processor to Use FBMarketplaceReplySender

**File**: `src/hermes/processor.js`

In `SOP_ACTION_REPLY` case, use `FBMarketplaceReplySender` with template text (preserving WA links). Keep `ResponseSender` for Telegram.

```js
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
  const replySender = new FBMarketplaceReplySender({ page: session.page });
  await replySender.sendReply(template);
  actionResult = "reply";
  break;
}
```

**Verification**: `node --check src/hermes/processor.js` → no errors.

### Task 8: Fix MessageReader — Filter UI Noise

**File**: `src/hermes/messageReader.js`

Add UI noise filter and skip noise in extraction loop. Also add `readConversationDetail()` method.

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

In extraction loop:
```js
const raw = (await el.innerText()).trim();
if (!raw || isNoise(raw)) continue;
```

**Verification**: Run pipeline test, check Obsidian log shows real customer messages.

### Task 9: Remove WhatsApp References from server.js

**File**: `server/server.js`

Ensure no WhatsApp-related env vars or config. Server only needs: `PORT`, `BOTWATCHER_DATA_DIR`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

**Verification**: `grep -i "whatsapp\|wa.me\|wa_link" server/server.js` → no matches.

### Task 10: Update start-hermes.sh

**File**: `start-hermes.sh`

Ensure only Telegram credentials are loaded. Remove any WhatsApp-related env vars.

**Verification**: `grep -i "whatsapp\|wa.me" start-hermes.sh` → no matches.

### Task 11: End-to-End Test

1. Kill existing server.
2. Start server with env vars.
3. Trigger webhook for account 1.
4. Wait 60 seconds.
5. Check process output: reply sent on FB Marketplace with template text (WA links preserved).
6. Check Obsidian log: new entry with real customer message.
7. Verify no duplicate webhooks on second check cycle (unreadCount unchanged → no webhook).

**Expected output**:
```
[webhook] ... accountId=1 ...
[fb-reply] === Sending to Maratul Husna (1) ===
<template text with WA links preserved>
[log] /home/masterhand/Documents/Hermes-Marketplace-inbox/Logs/YYYY/MM_reply.md
[pipeline] accountId=1 classification=reply actionResult=reply messages=N
```

## Risks, Tradeoffs, and Open Questions

1. **FB Marketplace DOM changes**: Chat input selector and send button may change with FB UI updates. Need to verify against live page.
2. **Message reader accuracy**: Filtering UI noise is fragile. Navigating to conversation detail and reading chat bubbles is more reliable.
3. **Reply delivery confirmation**: No confirmation that message was actually sent. Need to verify message appears in chat after sending.
4. **Rate limiting**: FB may rate-limit automated replies. Need delays between actions.
5. **Session switching**: Fixed (close old session first), but needs testing with rapid account switches.
6. **Open question**: Should reply be sent to ALL unread conversations, or only latest? Current code processes `messages[0]`.
7. **Open question**: Template has `@` placeholder for WA link. Since Hermes sends template as-is on FB Marketplace, `@` will appear in FB chat. Should it be replaced with actual WA link? (Recommendation: replace `@` with WA link so customers can click in FB chat.)
8. **Telegram admin flow**: One-way (Hermes → admin). Two-way (admin replies via Telegram → Hermes forwards to customer) requires Telegram bot webhook receiver — not yet implemented.
9. **"Always true" fix migration**: Existing accounts in DB have `last_notified_unread_count = NULL`. On first run after migration, `lastNotified` is `null`, so baseline is set without sending webhook. This prevents flooding on first check. Subsequent checks only send when unread count increases.
