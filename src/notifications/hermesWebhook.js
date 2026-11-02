const DEFAULT_HERMES_WEBHOOK_URL =
  "http://localhost:8765/webhooks/BotWatcher-Dashboard";
const REQUEST_TIMEOUT_MS = 5000;

export class HermesWebhook {
  constructor({
    url = process.env.HERMES_WEBHOOK_URL || DEFAULT_HERMES_WEBHOOK_URL,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = {}) {
    this.url = url;
    this.timeoutMs = timeoutMs;
  }

  async notifyIfNewInboxMessages({
    accountId,
    accountName,
    unreadCount,
    previousUnreadCount,
  }) {
    const newMessageCount =
      unreadCount - (previousUnreadCount ?? 0);

    if (!Number.isFinite(unreadCount) || newMessageCount <= 0) return false;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          signal: "wake",
          event: "new_inbox_messages",
          accountId,
          accountName,
          hasNewMessages: true,
          newMessageCount,
          unreadCount,
        }),
      });

      if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        console.error(
          `[HermesWebhook] Gagal mengirim webhook (HTTP ${response.status}): ${responseBody}`,
        );
        return false;
      }

      console.log(
        `[HermesWebhook] Sinyal wake dikirim untuk akun "${accountName}" (${newMessageCount} pesan baru).`,
      );
      return true;
    } catch (error) {
      console.error(
        `[HermesWebhook] Gagal mengirim webhook ke ${this.url}: ${error.message}`,
      );
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
