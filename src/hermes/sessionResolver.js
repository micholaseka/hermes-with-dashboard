// src/hermes/sessionResolver.js
// Resolves a Playwright session for a given accountId. Reuses the existing
// MarketplaceSession class from src/marketplace/session.js so we keep the
// same login-detection + stealth logic. Standalone (no Electron, no IPC).
// Run: node server/server.js  (default port 8644)

import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { getSessionConfig } from "../../src/config/engine.config.js";
import { MarketplaceSession } from "../../src/marketplace/session.js";

export class HermesSessionResolver extends EventEmitter {
  constructor({ projectRoot }) {
    super();
    this.projectRoot = projectRoot;
    this.session = null;
  }

  get profileDirectory() {
    // Pakai engine config supaya path profil sesuai dengan yang dipakai
    // Electron app (BOTWATCHER_DATA_DIR) atau mode chrome-portable.
    return getSessionConfig().profileDirectory;
  }

  get sessionDirectory() {
    return getSessionConfig().sessionDirectory;
  }

  async resolveSession(accountId) {
    // 1) Try permanent profile directory
    const profileDir = path.join(this.profileDirectory, accountId);
    try {
      await fs.access(profileDir);
      const session = await this.ensureSession(accountId);
      if (session.isLoggedIn) return session;
    } catch {
      // profile not present, fall through to legacy JSON
    }

    // 2) Try legacy JSON session file (storageState.json format)
    const legacyFile = path.join(this.sessionDirectory, `${accountId}.json`);
    try {
      await fs.access(legacyFile);
      const session = await this.ensureSession(accountId);
      if (session.isLoggedIn) return session;
    } catch {
      // no session file either
    }

    throw new Error(`Tidak ada sesi login untuk akun "${accountId}".`);
  }

  async ensureSession(accountId) {
    // Already have a live session for this account and it is logged in.
    if (this.session && this.session.accountId === accountId && this.session.isLoggedIn) {
      return this.session;
    }

    // Have a session for this account but not logged in yet; wait for
    // the login_status event before returning.
    if (this.session && this.session.accountId === accountId) {
      return this.waitForLogin(this.session);
    }

    // Switching accounts: close the previous session first to avoid
    // SingletonLock conflicts and resource leaks.
    if (this.session) {
      console.log(`[session] Menutup sesi akun ${this.session.accountId} sebelum buka akun ${accountId}...`);
      await this.session.close().catch(() => {});
      this.session = null;
    }

    // Create new session.
    this.session = new MarketplaceSession({ accountId });
    this.session.on("login_status", (status) => {
      this.emit("login_status", status);
    });
    await this.session.open();
    return this.session;
  }

  waitForLogin(session, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.removeAllListeners("login_status");
        reject(
          new Error(`Timeout menunggu login untuk akun ${session.accountId}`),
        );
      }, timeoutMs);

      session.once("login_status", (status) => {
        clearTimeout(timer);
        session.removeAllListeners("login_status");
        if (status.isLoggedIn) resolve(session);
        else reject(new Error(`Login gagal untuk akun ${session.accountId}`));
      });
    });
  }

  close() {
    if (this.session) {
      this.session.close().catch(() => {});
      this.session = null;
    }
  }
}
