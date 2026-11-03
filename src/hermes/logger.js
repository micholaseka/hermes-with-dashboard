// src/hermes/logger.js
// Appends timestamped log entries to the Obsidian vault following the SOP:
//   Logs/YYYY/MM/<category>.md
// Category: reply | clarify | handoff | no_action | pending_loaksi | selesai_loaksi
//
// Safety rules (from SOP):
//   - Never save personal data (phone numbers, address details, full
//     conversation copies).
//   - Never log internal paths, host identity, or server IPs.

import fs from "node:fs/promises";
import path from "node:path";

const VAULT_ROOT =
  process.env.HERMES_VAULT_ROOT ||
  "/home/masterhand/Documents/Hermes-Marketplace-inbox";

const CATEGORY_MAP = {
  reply: "reply",
  clarify: "clarify",
  handoff: "handoff",
  no_action: "no_action",
  pending_lokasi: "pending_lokasi",
  selesai_lokasi: "selesai_lokasi",
  pending_loaksi: "pending_lokasi",
  selesai_loaksi: "selesai_lokasi",
};

export class Logger {
  constructor() {
    this.vaultRoot = VAULT_ROOT;
    this.logDir = path.join(VAULT_ROOT, "Logs");
  }

  /** External log categories (not internal). */
  static getInternalCategories() {
    return Object.keys(CATEGORY_MAP);
  }

  async log({
    accountId,
    accountName,
    category,
    message,
    action,
    meta = {},
  }) {
    // Validate category
    const normalized = CATEGORY_MAP[category] || "no_action";
    if (!Logger.isSafeCategory(normalized)) {
      console.warn(`[log] Kategori "${category}" tidak aman, diubah jadi "no_action".`);
      return this.log({ accountId, accountName, category: "no_action", message, action, meta });
    }

    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, "0");
    const logFile = path.join(this.logDir, year.toString(), `${month}_${normalized}.md`);

    const entry = [
      "## " + new Date().toISOString(),
      `- Akun: ${accountName || "(tanpa nama)"} (${accountId})`,
      `- Kategori: ${normalized}`,
      `- Pesan: ${this.sanitize(message || "")}`,
      `- Aksi: ${action || "n/a"}`,
      ...Object.entries(meta).map(([k, v]) => `- ${k}: ${this.sanitize(v)}`),
    ].join("\n") + "\n";

    try {
      await fs.mkdir(path.dirname(logFile), { recursive: true });
      await fs.appendFile(logFile, entry, "utf8");
      console.log(`[log] ${logFile}`);
      return logFile;
    } catch (err) {
      console.error(`[log] Gagal menulis log: ${err.message}`);
      throw err;
    }
  }

  /** Sanitize message to remove personal data before logging. */
  sanitize(text) {
    if (!text) return "";
    // Remove phone number patterns (Indonesian format)
    let result = text.replace(/08[\d\s\-]{7,}/g, "[nomor telepon]");
    // Remove WhatsApp number patterns
    result = result.replace(/62[\d\s\-]{7,}/g, "[nomor telepon]");
    // Remove email patterns
    result = result.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[email]");
    // Remove URLs (internal paths, IP addresses, hostnames)
    result = result.replace(/https?:\/\/[^\s]+/g, "[link]");
    result = result.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[ip]");
    // Replace common personal names with generic placeholder
    result = result.replace(/\b(?:bung|kak|mas|mbak|tante|kakak)\b/gi, "[sapaan]");
    return result.trim();
  }

  /** Check if a category is safe to log (internal classification only). */
  static isSafeCategory(category) {
    return Object.prototype.hasOwnProperty.call(CATEGORY_MAP, category);
  }
}
