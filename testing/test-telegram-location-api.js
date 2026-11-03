// testing/test-telegram-location-api.js
// Tests the HTTP location reply endpoint and TelegramListener handleUpdate.

import assert from "node:assert";
import http from "node:http";
import { PendingLocationStore } from "../src/hermes/pendingStore.js";
import { TelegramListener } from "../src/hermes/telegramListener.js";

async function main() {
  console.log("=== 1. Test: TelegramListener.handleUpdate Unit Test ===");

  const storageDir = "/home/masterhand/Projects/BotWatcher-Dashboard-source/storage";
  const store = new PendingLocationStore({ storageDir });
  await store.load();

  // Keep the fixture deterministic even if a previous test left pending tickets.
  for (const pending of await store.listPending()) {
    await store.markCompleted(pending.id);
  }

  // Create a pending location ticket
  const ticketMsgId = "tg-msg-" + Date.now();
  const ticket = await store.addTicket({
    telegramMessageId: ticketMsgId,
    accountId: "1",
    accountName: "Maratul Husna",
    customerName: "Siti Rahma",
    customerMessage: "Alamat tokonya di mana kak?",
  });

  let dispatched = null;
  const mockProcessor = {
    async handleAdminLocationReply({ ticket, replyText }) {
      dispatched = { ticketId: ticket.id, replyText };
      return { ok: true };
    },
  };

  const listener = new TelegramListener({
    telegramBotToken: "mock-token",
    telegramChatId: "12345678",
    processor: mockProcessor,
    pendingStore: store,
    responseSender: null,
  });

  // Test handleUpdate as a quote reply
  const replyUpdate = {
    update_id: 1001,
    message: {
      message_id: 2001,
      chat: { id: 12345678 },
      text: "Lokasi kami di Jl. Raya Durenan kak, ready COD",
      reply_to_message: {
        message_id: ticketMsgId,
      },
    },
  };

  await listener.handleUpdate(replyUpdate);

  assert.ok(dispatched, "handleUpdate harus mengeksekusi handleAdminLocationReply");
  assert.strictEqual(dispatched.ticketId, ticket.id, "Ticket ID harus cocok");
  assert.strictEqual(dispatched.replyText, "Lokasi kami di Jl. Raya Durenan kak, ready COD");
  console.log("✅ PASS: TelegramListener.handleUpdate berhasil memproses balasan admin.");

  // Test 2: HTTP Endpoint POST /api/reply-location
  console.log("\n=== 2. Test: HTTP POST /api/reply-location endpoint ===");
  const apiTicket = await store.addTicket({
    telegramMessageId: `api-ticket-${Date.now()}`,
    accountId: "1",
    accountName: "Maratul Husna",
    customerName: "Budi API",
    customerMessage: "Lokasi API di mana kak?",
  });
  const postData = JSON.stringify({
    ticketId: apiTicket.id,
    replyText: "Lokasi kami di Durenan kak via API",
  });

  const res = await new Promise((resolve, reject) => {
    const req = http.request(
      "http://localhost:8765/api/reply-location",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
          "x-hermes-secret": process.env.HERMES_WEBHOOK_SECRET || "p1-test-secret",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body || "{}") }));
      },
    );
    req.on("error", reject);
    req.write(postData);
    req.end();
  });

  assert.strictEqual(res.status, 200, "HTTP status harus 200");
  assert.strictEqual(res.body.ok, true, "Response harus { ok: true }");
  console.log("✅ PASS: Endpoint POST /api/reply-location berhasil dipanggil dan merespons 200 OK.");
}

main().catch((err) => {
  console.error("❌ FAIL:", err.message);
  process.exit(1);
});
