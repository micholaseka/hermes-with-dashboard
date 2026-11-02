import { createDatabase } from "../database/database.js";

export class AccountRepository {
  constructor(db) {
    this.db = db;
  }

  createAccount({ accountId, name, city = "", postCount = null }) {
    this.db.exec("BEGIN");

    try {
      this.db
        .prepare(
          `
        INSERT INTO accounts (
          account_id,
          name,
          city,
          post_count,
          enabled
        )
        VALUES (?, ?, ?, ?, 1)
        `,
        )
        .run(accountId, name, city, postCount ?? null);

      this.db
        .prepare(
          `
        INSERT INTO account_status (
          account_id,
          state,
          logged_in,
          unread_count,
          last_checked_at,
          last_error
        )
        VALUES (?, 'idle', NULL, NULL, NULL, NULL)
        `,
        )
        .run(accountId);

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");

      if (
        String(error.message).includes(
          "UNIQUE constraint failed: accounts.account_id",
        )
      ) {
        throw new Error(`Account ID "${accountId}" sudah digunakan.`);
      }

      throw error;
    }
  }

  listAccountsWithStatus() {
    return this.db
      .prepare(
        `
      SELECT
        a.account_id,
        a.name,
        a.city,
        a.post_count,
        a.enabled,

        COALESCE(s.state, 'idle') AS state,
        s.logged_in,
        s.unread_count,
        s.last_notified_unread_count,
        s.last_checked_at,
        s.last_error

      FROM accounts a

      LEFT JOIN account_status s
        ON s.account_id = a.account_id

      ORDER BY a.id
    `,
      )
      .all();
  }
  getAccount(accountId) {
    return this.db
      .prepare(
        `
        SELECT
          account_id,
          name,
          city,
          enabled
        FROM accounts
        WHERE account_id = ?
      `,
      )
      .get(accountId);
  }

  updateAccount(accountId, { name, city, postCount }) {
    const result = this.db
      .prepare(
        `
        UPDATE accounts
        SET
          name = ?,
          city = ?,
          post_count = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE account_id = ?
      `,
      )
      .run(name, city, postCount ?? null, accountId);

    if (result.changes === 0) {
      throw new Error(`Akun "${accountId}" tidak ditemukan.`);
    }
  }

  deleteAccount(accountId) {
    const result = this.db
      .prepare(
        `
        DELETE FROM accounts
        WHERE account_id = ?
      `,
      )
      .run(accountId);

    if (result.changes === 0) {
      throw new Error(`Akun "${accountId}" tidak ditemukan.`);
    }
  }

  ensureStatus(accountId) {
    this.db
      .prepare(
        `
        INSERT INTO account_status (
          account_id,
          state
        )
        VALUES (?, 'idle')
        ON CONFLICT(account_id) DO NOTHING
      `,
      )
      .run(accountId);
  }

  updateStatus(accountId, status) {
    this.ensureStatus(accountId);

    this.db
      .prepare(
        `
        UPDATE account_status
        SET
          state = ?,
          logged_in = ?,
          unread_count = ?,
          last_notified_unread_count = ?,
          last_checked_at = ?,
          last_error = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE account_id = ?
      `,
      )
      .run(
        status.state,
        status.loggedIn === null || status.loggedIn === undefined
          ? null
          : status.loggedIn
            ? 1
            : 0,
        status.unreadCount ?? null,
        status.lastNotifiedUnreadCount ?? null,
        status.lastCheckedAt
          ? new Date(status.lastCheckedAt).toISOString()
          : null,
        status.error ?? null,
        accountId,
      );
  }

  getStatus(accountId) {
    return this.db
      .prepare(
        `
        SELECT
          account_id,
          state,
          logged_in,
          unread_count,
          last_checked_at,
          last_error
        FROM account_status
        WHERE account_id = ?
      `,
      )
      .get(accountId);
  }

  close() {
    this.db.close();
  }
}
