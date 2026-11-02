import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

export function createDatabase(dbPath) {
  const directory = path.dirname(dbPath);
  fs.mkdirSync(directory, { recursive: true });

  const db = new DatabaseSync(dbPath);

  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      post_count INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS account_status (
      account_id TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'idle',
      logged_in INTEGER,
      unread_count INTEGER,
      last_notified_unread_count INTEGER,
      last_checked_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (account_id)
        REFERENCES accounts(account_id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS monitor_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      unread_count INTEGER,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (account_id)
        REFERENCES accounts(account_id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_monitor_events_account
      ON monitor_events(account_id);

    CREATE INDEX IF NOT EXISTS idx_monitor_events_created
      ON monitor_events(created_at);
  `);

  // Migrasi: kolom post_count (jumlah postingan manual) ditambahkan setelah
  // rilis awal. DB lama sudah punya tabel accounts, dan CREATE TABLE IF NOT
  // EXISTS TIDAK menambah kolom ke tabel yang sudah ada -- jadi butuh ALTER
  // eksplisit, dijaga biar tidak error kalau kolomnya sudah ada.
  const accountColumns = db
    .prepare("PRAGMA table_info(accounts)")
    .all()
    .map((row) => row.name);

  if (!accountColumns.includes("post_count")) {
    db.exec("ALTER TABLE accounts ADD COLUMN post_count INTEGER;");
  }

  // Migrasi: kolom last_notified_unread_count di account_status (untuk
  // mencegah webhook "ada inbox nih" dikirim berulang saat unread count
  // tidak berubah). DB lama sudah punya tabel account_status, jadi butuh
  // ALTER eksplisit.
  const statusColumns = db
    .prepare("PRAGMA table_info(account_status)")
    .all()
    .map((row) => row.name);

  if (!statusColumns.includes("last_notified_unread_count")) {
    db.exec(
      "ALTER TABLE account_status ADD COLUMN last_notified_unread_count INTEGER;",
    );
  }

  return db;
}
