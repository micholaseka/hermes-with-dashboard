// testing/test-rotator-interval.js
// Tests that AccountRotator uses 5 minutes (300,000 ms) as its default round interval.

import assert from "node:assert";
import { AccountRotator } from "../src/rotation/accountRotator.js";

async function main() {
  console.log("=== Test: AccountRotator Default Interval ===");

  const rotator = new AccountRotator(["1", "2"]);
  const expectedMs = 5 * 60 * 1000; // 5 menit = 300,000 ms

  console.log(`Current roundIntervalMs: ${rotator.roundIntervalMs} ms`);
  assert.strictEqual(
    rotator.roundIntervalMs,
    expectedMs,
    `roundIntervalMs harus 5 menit (${expectedMs} ms), didapat ${rotator.roundIntervalMs} ms`
  );

  console.log("✅ PASS: Default roundIntervalMs tepat 5 menit!");
}

main().catch((err) => {
  console.error("❌ FAIL:", err.message);
  process.exit(1);
});
