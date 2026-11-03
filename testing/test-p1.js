import assert from "node:assert/strict";
import { PendingLocationStore } from "../src/hermes/pendingStore.js";

const storageDir = `/tmp/hermes-p1-${Date.now()}`;
const store = new PendingLocationStore({ storageDir });

const first = await store.addTicket({
  telegramMessageId: "tg-1",
  accountId: "1",
  accountName: "Akun 1",
  customerName: "Siti",
  customerMessage: "Lokasinya dimana?",
});
const duplicate = await store.addTicket({
  telegramMessageId: "tg-2",
  accountId: "1",
  accountName: "Akun 1",
  customerName: "Siti",
  customerMessage: "Lokasinya dimana?",
});
assert.equal(duplicate.id, first.id);
assert.equal((await store.listPending()).length, 1);

console.log("P1 PASS: tiket duplikat diabaikan.");
