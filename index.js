// index.js
//
// Titik masuk utama (CLI). Alur:
//   AccountManager  -> load accounts.json
//   AccountRotator  -> cek semua akun bergilir per batch (5-10 akun
//                      bersamaan, urutan diacak tiap putaran)
//   TelegramNotifier -> kirim "dari <akun>: <jumlah> pesan yang perlu dijawab"
//                       tiap kali account_checked nemu unread > 0
//
// Catatan: ini gantiin pendekatan lama (InboxMonitor per akun, semua
// browser hidup bareng terus-terusan) -- sekarang pakai AccountRotator
// yang jauh lebih hemat resource buat skala ~150 akun.

import { AccountManager } from "./src/accounts/accountManager.js";
import { AccountRotator } from "./src/rotation/accountRotator.js";
import { HermesWebhook } from "./src/notifications/hermesWebhook.js";
import { TelegramNotifier } from "./src/notifications/telegram.js";

async function main() {
  const manager = new AccountManager();
  const notifier = new TelegramNotifier();
  const hermesWebhook = new HermesWebhook();

  await manager.load();
  const accounts = manager.getEnabledAccounts();
  const accountIds = accounts.map((a) => a.accountId);

  if (accountIds.length === 0) {
    console.log("Tidak ada akun aktif di accounts.json.");
    return;
  }

  const rotator = new AccountRotator(accountIds, {
    minBatchSize: 5,
    maxBatchSize: 10,
    delayBetweenBatchesMs: 5000,
    roundIntervalMs:
      Number(process.env.ROTATION_INTERVAL_MS) || 5 * 60 * 1000,
  });

  manager.on("status", (status) => {
    console.log(
      `>> [${status.name}] loggedIn=${status.loggedIn} unread=${status.unreadCount}`,
    );
  });

  rotator.on("log", (message, level) => {
    if (level === "error") console.error(message);
    else console.log(message);
  });

  rotator.on("account_checked", ({ accountId, loggedIn, unreadCount, reason }) => {
    // Aktif hanya kalau dashboard benar-benar terbaca (angka). null =
    // sesi kadaluarsa / akun ditangguhkan / banned -> Tidur, bukan Aktif.
    const usable =
      loggedIn === true &&
      unreadCount !== null &&
      unreadCount !== undefined;
    const previousUnreadCount =
      manager.getStatus(accountId)?.unreadCount ?? null;

    manager.updateStatus(accountId, {
      loggedIn: usable,
      unreadCount,
      lastCheckedAt: new Date(),
      state: usable ? "monitoring" : "offline",
      error: usable ? null : (reason ?? null),
    });

    if (usable && unreadCount > 0) {
      const account = manager.getAccount(accountId);
      notifier.notifyUnread(account?.name ?? accountId, unreadCount);
    }

    if (usable) {
      const account = manager.getAccount(accountId);
      void hermesWebhook.notifyIfNewInboxMessages({
        accountId,
        accountName: account?.name ?? accountId,
        unreadCount,
        previousUnreadCount,
      });
    }
  });

  rotator.on("error", ({ accountId, error }) => {
    manager.updateStatus(accountId, { state: "error", error: error.message });
  });

  const shutdown = () => {
    console.log("\nMenghentikan rotasi...");
    rotator.stop();
    // Rotator berhenti setelah batch yang sedang jalan kelar (browser
    // yang lagi kebuka ditutup rapi lewat finally block di dalamnya),
    // jadi tinggal tunggu proses natural selesai lalu exit.
    setTimeout(() => process.exit(0), 2000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`Memulai rotasi untuk ${accountIds.length} akun aktif...`);
  await rotator.start();
}

main().catch((err) => {
  console.error("Gagal memulai:", err.message);
  process.exit(1);
});
