// src/hermes/pendingStore.js
// Stores and manages pending location tickets for customer inquiries.
// When a customer asks about location/COD, a ticket is created.
// When the admin replies via Telegram, the ticket is used to dispatch
// the answer to the correct Facebook chat.

import fs from "node:fs/promises";
import path from "node:path";

export class PendingLocationStore {
  constructor({ storageDir } = {}) {
    this.filePath =
      storageDir ||
      process.env.HERMES_STORAGE_DIR ||
      path.join(process.cwd(), "storage", "pending_locations.json");
    this.tickets = [];
    this._loaded = false;
  }

  async load() {
    try {
      const data = await fs.readFile(this.filePath, "utf8");
      this.tickets = JSON.parse(data);
    } catch {
      this.tickets = [];
    }
    this._loaded = true;
    return this.tickets;
  }

  async save() {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(
        this.filePath,
        JSON.stringify(this.tickets, null, 2),
        "utf8",
      );
    } catch (err) {
      console.error(`[pendingStore] Gagal menyimpan tiket: ${err.message}`);
    }
  }

  async addTicket({
    telegramMessageId,
    accountId,
    accountName,
    customerName,
    customerMessage,
  }) {
    if (!this._loaded) await this.load();

    const ticket = {
      id: telegramMessageId ? String(telegramMessageId) : Date.now().toString(),
      telegramMessageId: telegramMessageId ? String(telegramMessageId) : null,
      accountId: String(accountId),
      accountName: accountName || "Akun FB",
      customerName: customerName || "Pelanggan",
      customerMessage: customerMessage || "",
      status: "pending", // "pending" | "completed"
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    const duplicate = this.tickets.find(
      (t) =>
        t.status === "pending" &&
        t.accountId === ticket.accountId &&
        t.customerName === ticket.customerName &&
        t.customerMessage === ticket.customerMessage,
    );
    if (duplicate) return duplicate;

    this.tickets = this.tickets.filter((t) => t.id !== ticket.id);
    this.tickets.push(ticket);
    await this.save();
    console.log(
      `[pendingStore] Tiket dibuat: ID=${ticket.id} (${ticket.customerName} @ ${ticket.accountName})`,
    );
    return ticket;
  }

  async getTicket(identifier) {
    if (!this._loaded) await this.load();
    const idStr = String(identifier);
    return (
      this.tickets.find(
        (t) =>
          t.status === "pending" &&
          (t.id === idStr || t.telegramMessageId === idStr),
      ) || null
    );
  }

  async getLatestPending(accountId = null) {
    if (!this._loaded) await this.load();
    const pending = this.tickets.filter((t) => {
      if (t.status !== "pending") return false;
      if (accountId && t.accountId !== String(accountId)) return false;
      return true;
    });
    return pending[pending.length - 1] || null;
  }

  async markCompleted(ticketId) {
    if (!this._loaded) await this.load();
    const idStr = String(ticketId);
    const ticket = this.tickets.find(
      (t) => t.id === idStr || t.telegramMessageId === idStr,
    );
    if (ticket) {
      ticket.status = "completed";
      ticket.completedAt = new Date().toISOString();
      await this.save();
      console.log(`[pendingStore] Tiket diselesaikan: ID=${ticket.id}`);
      return true;
    }
    return false;
  }

  async listPending() {
    if (!this._loaded) await this.load();
    return this.tickets.filter((t) => t.status === "pending");
  }
}
