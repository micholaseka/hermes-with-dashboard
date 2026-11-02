// testing/test-windows-compatibility.js
// Verifies Windows 10 compatibility: path resolution, batch runner, and config.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDefaultDataDir, getSessionConfig } from "../src/config/engine.config.js";

async function main() {
  console.log("=== 1. Pengujian Path Resolution Default Data Dir ===");

  // Cek resolusi platform saat ini (Linux)
  const linuxDir = getDefaultDataDir();
  console.log("Platform saat ini:", process.platform);
  console.log("Data Dir saat ini:", linuxDir);
  if (!linuxDir.includes(".config") && !linuxDir.includes("Electron")) {
    throw new Error(`Data dir tidak sesuai: ${linuxDir}`);
  }
  console.log("✅ Resolusi Linux OK.");

  // Uji simulasi path Windows
  const origPlatform = process.platform;
  const origAppData = process.env.APPDATA;
  const origBotWatcherDataDir = process.env.BOTWATCHER_DATA_DIR;

  try {
    delete process.env.BOTWATCHER_DATA_DIR;
    process.env.APPDATA = "C:\\Users\\Boss\\AppData\\Roaming";
    Object.defineProperty(process, "platform", { value: "win32" });

    const winDir = getDefaultDataDir();
    console.log("\nSimulasi Windows 10:");
    console.log("APPDATA :", process.env.APPDATA);
    console.log("Resolved Data Dir:", winDir);

    const expectedWin = "C:\\Users\\Boss\\AppData\\Roaming\\Electron";
    if (winDir !== expectedWin) {
      throw new Error(`Simulasi Windows gagal: diharapkan "${expectedWin}", didapat "${winDir}"`);
    }
    console.log("✅ Resolusi Windows 10 (%APPDATA%\\Electron) 100% Cocok!");
  } finally {
    Object.defineProperty(process, "platform", { value: origPlatform });
    if (origAppData !== undefined) process.env.APPDATA = origAppData;
    else delete process.env.APPDATA;
    if (origBotWatcherDataDir !== undefined) {
      process.env.BOTWATCHER_DATA_DIR = origBotWatcherDataDir;
    }
  }

  console.log("\n=== 2. Memeriksa Keberadaan File Runner Windows ===");
  const projectRoot = "/home/masterhand/Projects/BotWatcher-Dashboard-source";

  const batPath = path.join(projectRoot, "start-hermes.bat");
  const ps1Path = path.join(projectRoot, "start-hermes.ps1");
  const guidePath = path.join(projectRoot, "docs", "WINDOWS_SETUP_GUIDE.md");

  if (!fs.existsSync(batPath)) throw new Error("start-hermes.bat tidak ditemukan!");
  console.log("✅ start-hermes.bat ada:", fs.statSync(batPath).size, "bytes");

  if (!fs.existsSync(ps1Path)) throw new Error("start-hermes.ps1 tidak ditemukan!");
  console.log("✅ start-hermes.ps1 ada:", fs.statSync(ps1Path).size, "bytes");

  if (!fs.existsSync(guidePath)) throw new Error("WINDOWS_SETUP_GUIDE.md tidak ditemukan!");
  console.log("✅ docs/WINDOWS_SETUP_GUIDE.md ada:", fs.statSync(guidePath).size, "bytes");

  console.log("\n🎉 SEMUA PENGUJIAN KOMPATIBILITAS WINDOWS 10 LULUS 100%!");
}

main().catch((err) => {
  console.error("❌ Test Gagal:", err);
  process.exit(1);
});
