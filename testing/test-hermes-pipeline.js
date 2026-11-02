// testing/test-hermes-pipeline.js
// End-to-end integration test for the Hermes Marketplace CS Inbox automation.
// Dry-run mode: exercises browser navigation, inbox reading, chat opening,
// SOP classification, and input typing (then clears input without sending).

import fs from "node:fs";
import { HermesSessionResolver } from "../src/hermes/sessionResolver.js";
import { MessageReader } from "../src/hermes/messageReader.js";
import { classifyMessage } from "../src/hermes/sop.js";
import { VaultStore } from "../src/hermes/store.js";

async function main() {
  console.log("=== 1. Memeriksa Kredensial & Vault Store ===");
  const store = new VaultStore();
  await store.load();
  const templateKey = "TEMPLATE CHAT JIKA ADA CUSTOMER BARU DENGAN CHAT PERTAMA:";
  const template = store.getTemplate(templateKey);
  if (!template) {
    throw new Error(`Template "${templateKey}" tidak ditemukan di vault.`);
  }
  console.log("✅ Template vault terbaca:", template.split("\n")[0]);

  console.log("\n=== 2. Membuka Sesi Akun 1 (Maratul Husna) ===");
  const resolver = new HermesSessionResolver({
    projectRoot: "/home/masterhand/Projects/BotWatcher-Dashboard-source",
  });
  const session = await resolver.resolveSession("1");
  if (!session || !session.isLoggedIn) {
    throw new Error("Sesi akun 1 tidak valid / belum login.");
  }
  console.log("✅ Sesi akun 1 aktif & login terkonfirmasi.");

  console.log("\n=== 3. Menjalankan MessageReader (Halaman Seller Inbox) ===");
  const reader = new MessageReader({ page: session.page });
  const messages = await reader.readInbox();
  console.log(`✅ Pesan terbaca: ${messages.length} obrolan`);

  if (messages.length === 0) {
    console.log("Tidak ada obrolan untuk diuji.");
    await session.close();
    return;
  }

  const latest = messages[0];
  console.log("Detail Obrolan Terakhir:");
  console.log("  - Pengirim:", latest.sender);
  console.log("  - Listing :", latest.listingTitle);
  console.log("  - Cuplikan/Pesan:", latest.content.substring(0, 100));
  console.log("  - First Chat?:", latest.isFirstChat);

  console.log("\n=== 4. Menguji Klasifikasi SOP ===");
  const classification = classifyMessage({
    sender: latest.sender,
    content: latest.content,
    isFirstChat: latest.isFirstChat,
  });
  console.log(`✅ Hasil Klasifikasi SOP: [${classification}]`);

  console.log("\n=== 5. Menguji Input Chat Composer (Dry-Run Aman) ===");
  const page = session.page;
  const input = page.locator('div[role="textbox"][contenteditable="true"]').first();
  const hasInput = (await input.count()) > 0;
  if (!hasInput) {
    throw new Error("Elemen kotak ketik (role=textbox) tidak ditemukan.");
  }

  await input.click();
  await page.waitForTimeout(300);

  const testText = "Halo kak, tes balasan CS otomatis (dry run)";
  await input.fill(testText);
  await page.waitForTimeout(500);

  const filledText = await input.innerText();
  console.log("✅ Teks berhasil diketik ke composer:", filledText.trim());

  // Bersihkan kembali teks agar tidak terkirim ke customer
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(500);
  console.log("✅ Kotak ketik berhasil dikosongkan kembali (aman, tidak ada chat terkirim).");

  console.log("\n=== 6. Menutup Sesi Browser ===");
  await session.close();
  console.log("✅ Sesi ditutup dengan bersih.");

  console.log("\n🎉 SEMUA PENGUJIAN INTEGRASI BERHASIL!");
}

main().catch(async (err) => {
  console.error("❌ Test Gagal:", err);
  process.exit(1);
});
