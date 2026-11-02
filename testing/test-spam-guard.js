// testing/test-spam-guard.js
// Verifies that:
// 1. When the seller was the last to message in a thread, MessageReader returns [] (no_action).
// 2. classifyMessage never resends template when isFirstChat is false or lastSenderRole is seller.
// 3. Zero unwanted messages are dispatched.

import { HermesSessionResolver } from "../src/hermes/sessionResolver.js";
import { MessageReader } from "../src/hermes/messageReader.js";
import {
  classifyMessage,
  SOP_ACTION_REPLY,
  SOP_ACTION_NO_ACTION,
  SOP_ACTION_NOTIFY_ADMIN,
  SOP_ACTION_HANDOFF,
} from "../src/hermes/sop.js";

async function runUnitTests() {
  console.log("=== 1. Pengujian Aturan Klasifikasi SOP (Anti-Spam) ===");

  // Kasus A: Penjual yang terakhir bicara -> HARUS no_action
  const resA = classifyMessage({
    sender: "Maulana",
    content: "Di shere NK kene kn Yo kenek",
    isFirstChat: false,
    lastSenderRole: "seller",
  });
  if (resA !== SOP_ACTION_NO_ACTION) {
    throw new Error(`Kasus A gagal: diharapkan "no_action", didapat "${resA}"`);
  }
  console.log("✅ Kasus A lulus: Pesan terakhir dari penjual -> [no_action]");

  // Kasus B: Pelanggan baru pertama kali chat -> HARUS reply (kirim template WA)
  const resB = classifyMessage({
    sender: "Budi",
    content: "Halo kak apa ini masih ada?",
    isFirstChat: true,
    lastSenderRole: "customer",
  });
  if (resB !== SOP_ACTION_REPLY) {
    throw new Error(`Kasus B gagal: diharapkan "reply", didapat "${resB}"`);
  }
  console.log("✅ Kasus B lulus: Pelanggan baru first chat -> [reply]");

  // Kasus C: Pelanggan lama nanya lokasi/COD -> HARUS notify_admin
  const resC = classifyMessage({
    sender: "Budi",
    content: "bisa cod di trenggalek mana?",
    isFirstChat: false,
    lastSenderRole: "customer",
  });
  if (resC !== SOP_ACTION_NOTIFY_ADMIN) {
    throw new Error(`Kasus C gagal: diharapkan "notify_admin", didapat "${resC}"`);
  }
  console.log("✅ Kasus C lulus: Pelanggan nanya COD/lokasi -> [notify_admin]");

  // Kasus D: Pelanggan lama nanya diskon/keluhan -> HARUS handoff
  const resD = classifyMessage({
    sender: "Budi",
    content: "bisa kurang harganya kak?",
    isFirstChat: false,
    lastSenderRole: "customer",
  });
  if (resD !== SOP_ACTION_HANDOFF) {
    throw new Error(`Kasus D gagal: diharapkan "handoff", didapat "${resD}"`);
  }
  console.log("✅ Kasus D lulus: Minta diskon -> [handoff]");

  // Kasus E: Pelanggan lama tanya hal lain -> HARUS handoff (JANGAN resend template WA!)
  const resE = classifyMessage({
    sender: "Budi",
    content: "ram nya berapa gb kak?",
    isFirstChat: false,
    lastSenderRole: "customer",
  });
  if (resE !== SOP_ACTION_HANDOFF) {
    throw new Error(`Kasus E gagal: diharapkan "handoff", didapat "${resE}"`);
  }
  console.log("✅ Kasus E lulus: Pelanggan lama follow-up umum -> [handoff ke admin, TIDAK spam template WA]");
}

async function runLiveBrowserTest() {
  console.log("\n=== 2. Pengujian Live Browser pada Akun 1 (Maratul Husna) ===");
  const resolver = new HermesSessionResolver({
    projectRoot: "/home/masterhand/Projects/BotWatcher-Dashboard-source",
  });
  const session = await resolver.resolveSession("1");
  if (!session || !session.isLoggedIn) {
    throw new Error("Sesi akun 1 tidak valid.");
  }

  const reader = new MessageReader({ page: session.page });
  const messages = await reader.readInbox();

  // Karena di akun 1 obrolan terakhir (Maulana) sudah dibalas oleh penjual (You)
  // dan belum ada balasan baru dari Maulana, reader HARUS mengembalikan [] (0 obrolan perlu dibalas)
  console.log(`Jumlah obrolan yang perlu dijawab: ${messages.length}`);
  if (messages.length > 0) {
    throw new Error(
      `GAGAL: MessageReader masih mengembalikan ${messages.length} pesan padahal penjual sudah membalas!`,
    );
  }

  console.log("✅ Live Test Lulus: MessageReader mengembalikan 0 pesan karena obrolan sudah selesai dijawab!");

  await session.close();
  console.log("✅ Sesi browser ditutup.");
}

async function main() {
  await runUnitTests();
  await runLiveBrowserTest();
  console.log("\n🎉 SEMUA PENGUJIAN ANTI-SPAM LULUS 100%!");
}

main().catch((err) => {
  console.error("❌ Test Gagal:", err);
  process.exit(1);
});
