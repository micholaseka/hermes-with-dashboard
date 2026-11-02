// src/rotation/accountRotator.js
//
// OTAK-nya "cek banyak akun bergilir, per BATCH". Alurnya per putaran:
//   1. Acak urutan semua accountId.
//   2. Bagi jadi batch berukuran random (minBatchSize..maxBatchSize).
//   3. Tiap batch: buka sesi SEMUA akun di batch itu SECARA BERSAMAAN
//      (Promise.all), cek unread, tutup semua.
//   4. Jeda random, lanjut ke batch berikutnya.
//   5. Setelah semua batch (= semua akun) kelar, itu 1 "putaran".
//      Jeda roundIntervalMs, ulangi dari awal (urutan diacak ulang).
//
// Kenapa batch, bukan 1-per-1 atau semua sekaligus:
//   - Semua sekaligus (150 browser hidup bareng) -> RAM meledak.
//   - 1-per-1 -> buat 150 akun, satu putaran bisa berjam-jam.
//   - Batch 5-10 -> beban RAM terkendali, tapi throughput jauh lebih
//     cepat, dan ukuran batch yang random (bukan selalu tepat 5 atau
//     tepat 10) bikin pola lebih natural.

import { EventEmitter } from "events";
import { MarketplaceSession } from "../marketplace/session.js";
import {
  checkUnreadCount,
  describeUnusable,
  InboxNavigationTimeoutError,
} from "../monitor/checkUnread.js";

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export class AccountRotator extends EventEmitter {
  /**
   * @param {string[]} accountIds
   * @param {Object} opts
   * @param {number} [opts.minBatchSize] - ukuran batch minimum (default 5)
   * @param {number} [opts.maxBatchSize] - ukuran batch maksimum (default 10)
   * @param {number} [opts.delayBetweenBatchesMs] - jeda antar batch
   * @param {number} [opts.roundIntervalMs] - jeda antar 1 putaran penuh ke putaran berikutnya
   */
  constructor(
    accountIds,
    {
      minBatchSize = 5,
      maxBatchSize = 10,
      delayBetweenBatchesMs = 5000,
      roundIntervalMs = 5 * 60 * 1000,
    } = {},
  ) {
    super();
    this.accountIds = accountIds;
    this.minBatchSize = minBatchSize;
    this.maxBatchSize = maxBatchSize;
    this.delayBetweenBatchesMs = delayBetweenBatchesMs;
    this.roundIntervalMs = roundIntervalMs;
    this.running = false;
    this.round = 0;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.emit(
      "log",
      `Rotasi dimulai untuk ${this.accountIds.length} akun (batch ${this.minBatchSize}-${this.maxBatchSize}).`,
      "info",
    );

    while (this.running) {
      this.round += 1;
      await this._runOneRound();
      if (!this.running) break;

      this.emit(
        "log",
        `Satu putaran selesai. Nunggu ${this.roundIntervalMs / 1000} detik sebelum mulai lagi.`,
        "info",
      );
      await this._sleep(this.roundIntervalMs);
    }
  }

  stop() {
    this.running = false;
    this.emit("log", "Rotasi dihentikan.", "info");
  }

  async _runOneRound() {
    const shuffled = shuffle(this.accountIds);
    let i = 0;

    this.emit("round_started", {
      round: this.round,
      totalAccounts: shuffled.length,
    });

    while (i < shuffled.length && this.running) {
      const batchSize = randomInt(this.minBatchSize, this.maxBatchSize);
      const batch = shuffled.slice(i, i + batchSize);
      i += batch.length;

      // Event progres buat UI: footer "Putaran #N — X/Y akun dicek",
      // baris "Sedang cek: ...", dan highlight "Mengecek..." di kartu.
      this.emit("batch_started", {
        batch,
        checkedSoFar: i,
        totalAccounts: shuffled.length,
      });
      this.emit(
        "log",
        `Cek batch (${batch.length} akun): ${batch.join(", ")}`,
        "info",
      );
      await Promise.allSettled(
        batch.map((accountId) => this._checkOneAccount(accountId)),
      );
      this.emit("batch_finished", {
        checkedSoFar: i,
        totalAccounts: shuffled.length,
      });

      if (i < shuffled.length && this.running) {
        await this._sleep(this.delayBetweenBatchesMs);
      }
    }
  }

  async _checkOneAccount(accountId) {
    // headless: pengecekan background, jangan munculkan window browser.
    const session = new MarketplaceSession({ accountId, headless: true });

    try {
      this.emit("log", `[${accountId}] Membuka sesi...`, "info");

      await session.open();

      // lanjut kode lama...
      if (!session.isLoggedIn) {
        this.emit(
          "log",
          `[${accountId}] Belum login / sesi gak ada. Dilewati.`,
          "warn",
        );
        this.emit("account_checked", {
          accountId,
          loggedIn: false,
          unreadCount: null,
          reason: "Sesi login belum tersedia.",
        });
        return;
      }

      const unreadCount = await checkUnreadCount(session.page);

      // null = dashboard tidak terbaca (sesi kadaluarsa, akun
      // ditangguhkan, atau banned). Jangan dilaporkan "0 unread, aktif".
      if (unreadCount === null) {
        const reason = describeUnusable(session.page?.url() ?? "");
        this.emit("log", `[${accountId}] ${reason}`, "warn");
        this.emit("account_checked", {
          accountId,
          loggedIn: false,
          unreadCount: null,
          reason,
        });
        return;
      }

      this.emit(
        "log",
        `[${accountId}] ${unreadCount} pesan belum dijawab.`,
        unreadCount > 0 ? "success" : "info",
      );
      this.emit("account_checked", {
        accountId,
        loggedIn: true,
        unreadCount,
      });
    } catch (err) {
      if (err instanceof InboxNavigationTimeoutError) {
        const reason = `${err.message} Akun dilewati pada putaran ini.`;
        this.emit("log", `[${accountId}] ${reason}`, "warn");
        this.emit("account_checked", {
          accountId,
          loggedIn: false,
          unreadCount: null,
          reason,
        });
      } else if (String(err.message).includes("ERR_TOO_MANY_REDIRECTS")) {
        // Facebook memantulkan dashboard <-> login berkali-kali: cookie
        // akun ADA tapi ditolak (sesi bermasalah / kena limit) — ini
        // kondisi "Tidur", bukan error teknis.
        const reason =
          "Sesi ditolak Facebook (redirect berulang) — perlu login ulang.";
        this.emit("log", `[${accountId}] ${reason}`, "warn");
        this.emit("account_checked", {
          accountId,
          loggedIn: false,
          unreadCount: null,
          reason,
        });
      } else {
        this.emit("log", `[${accountId}] Error: ${err.message}`, "error");
        this.emit("error", { accountId, error: err });
      }
    } finally {
      await session.close();
    }
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}
