// testing/test-error-alert.js
// Tests the account error and checkpoint alert notification for Telegram.

import { TelegramNotifier } from "../src/notifications/telegram.js";

async function main() {
  console.log("=== Pengujian Notifikasi Alert Akun Checkpoint/Logout ===");

  const notifier = new TelegramNotifier();
  console.log("Console only mode?:", notifier.consoleOnly);

  // Uji format pesan alert
  console.log("\nMencoba trigger alert akun simulasi...");
  await notifier.notifyAccountError(
    "Akun Contoh (Akun 1)",
    "Sesi login kadaluarsa / Akun Facebook ditangguhkan",
  );

  console.log("✅ Alert akun berhasil diproses tanpa error.");
}

main().catch((err) => {
  console.error("❌ Test Gagal:", err);
  process.exit(1);
});
