// testing/test-message-reader-regex.js
// Tests the message parsing regex for English and Indonesian Facebook UI labels.

import assert from "node:assert";
import { FB_MESSAGE_LABEL_REGEX } from "../src/hermes/messageReader.js";

const testCases = [
  // English
  {
    label: "sent 5m ago by Budi: Halo kak apakah ready?",
    expectedSender: "Budi",
    expectedContent: "Halo kak apakah ready?",
    isSeller: false,
  },
  {
    label: "At 10:30 AM, You: Ready banyak kak",
    expectedSender: "You",
    expectedContent: "Ready banyak kak",
    isSeller: true,
  },
  // Indonesian
  {
    label: "Dikirim pukul 13:45 oleh Joko Santoso: Lokasi toko di mana ya kak?",
    expectedSender: "Joko Santoso",
    expectedContent: "Lokasi toko di mana ya kak?",
    isSeller: false,
  },
  {
    label: "Pada 13:50, Anda: Lokasi di Durenan kak",
    expectedSender: "Anda",
    expectedContent: "Lokasi di Durenan kak",
    isSeller: true,
  },
  {
    label: "Dikirim 2 mnt lalu oleh Rian: Bisa COD?",
    expectedSender: "Rian",
    expectedContent: "Bisa COD?",
    isSeller: false,
  },
];

console.log("=== Testing Facebook Message Parser Regex ===");
console.log("Active regex:", FB_MESSAGE_LABEL_REGEX);

let passed = 0;
for (const tc of testCases) {
  const m = tc.label.match(FB_MESSAGE_LABEL_REGEX);
  assert.ok(m, `Regex HARUS cocok dengan label: "${tc.label}"`);
  const sender = m[1].trim();
  const content = m[2].trim();
  const isSeller = /^(You|Anda)$/i.test(sender);

  assert.strictEqual(sender, tc.expectedSender, `Sender harus "${tc.expectedSender}"`);
  assert.strictEqual(content, tc.expectedContent, `Content harus "${tc.expectedContent}"`);
  assert.strictEqual(isSeller, tc.isSeller, `isSeller harus ${tc.isSeller}`);
  passed++;
}

console.log(`✅ All ${passed} test cases PASSED!`);
