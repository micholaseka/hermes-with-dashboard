// testing/test-session-close.js
// Tests that HermesSessionResolver properly closes the browser session
// and releases the profile lock so other processes can access it.

import assert from "node:assert";
import { HermesSessionResolver } from "../src/hermes/sessionResolver.js";
import { getDefaultDataDir } from "../src/config/engine.config.js";
import path from "node:path";
import fs from "node:fs/promises";

async function main() {
  console.log("=== Test: HermesSessionResolver async close & lock release ===");

  const resolver = new HermesSessionResolver({
    projectRoot: process.cwd(),
  });

  // Verify resolver has async close method
  assert.strictEqual(typeof resolver.close, "function", "resolver.close harus berupa fungsi");

  // Buka sesi akun 1
  console.log("Membuka sesi...");
  const session = await resolver.resolveSession("1");
  assert.ok(session, "Sesi harus berhasil dibuka");
  assert.ok(session.context, "Browser context harus aktif");
  assert.strictEqual(session.headless, true, "Sesi background Hermes harus headless");

  const lockPath = path.join(getDefaultDataDir(), "storage", "profiles", "1", "SingletonLock");

  // Tutup sesi
  console.log("Menutup sesi...");
  await resolver.close();

  // Pastikan session bernilai null dan context tertutup
  assert.strictEqual(resolver.session, null, "resolver.session harus null setelah close");
  assert.strictEqual(session.context, null, "session.context harus null setelah close");

  // Pastikan lockfile dilepas (tidak ada symlink aktif)
  let lockExists = false;
  try {
    const stat = await fs.lstat(lockPath);
    if (stat.isSymbolicLink()) {
      try {
        await fs.stat(lockPath);
        lockExists = true;
      } catch {
        lockExists = false; // dangling symlink is fine
      }
    }
  } catch {
    lockExists = false;
  }
  assert.strictEqual(lockExists, false, "SingletonLock tidak boleh aktif setelah close");

  console.log("✅ PASS: Sesi dan SingletonLock berhasil ditutup & dilepas secara bersih.");
}

main().catch((err) => {
  console.error("❌ FAIL:", err.message);
  process.exit(1);
});
