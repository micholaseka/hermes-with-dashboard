# Plan: Penuntasan Sistem CS Marketplace: Alert Sesi, Portabilitas Windows 10, & Git Commit

## Goal

Menuntaskan 3 komponen tersisa dari sistem CS Marketplace Raffa Computer: menambahkan notifikasi instan Telegram saat sesi akun logout/checkpoint, membuat skrip runner dan path otomatis untuk Windows 10 (laptop bos), serta melakukan commit rapi pada repositori Git.

## Current Context / Assumptions

- **Status Komponen yang Sudah Selesai**:
  - ✅ **Webhook & Seller Inbox Reader**: Mengarah langsung ke `/marketplace/inbox/?targetTab=SELLER` dan membuka percakapan floating Messenger.
  - ✅ **SOP Balasan Baru**: Template WhatsApp Raffa Computer dikirim dalam 1 bubble chat ke pelanggan baru (*first chat*).
  - ✅ **Proteksi Anti-Spam**: Bot memeriksa siapa yang mengirim pesan terakhir di riwayat obrolan; jika penjual (`You` / `Anda`) sudah membalas, bot otomatis `no_action`.
  - ✅ **SOP Tanya Lokasi (Poin 3 & 4)**: Bot mengirim format `Tanya Lokasi!` ke Telegram admin, menyimpan tiket pending di `storage/pending_locations.json`, dan menyediakan handler `handleAdminLocationReply` untuk mengeksekusi balasan admin ke Facebook serta mencatat log `[SELESAI_LOKASI]`.
  - ✅ **Server Webhook**: Aktif di port 8765 dengan crontab auto-restart.

- **3 Komponen yang Belum Selesai (Sisa Pekerjaan)**:
  1. **Alert Sesi / Checkpoint ke Telegram**: Saat rotator di `electron/main.mjs` mendeteksi akun logout, checkpoint, captcha, atau ditangguhkan (`usable === false`), status kartu di dashboard berubah menjadi merah/offline, tetapi admin belum diberi tahu via Telegram.
  2. **Portabilitas Windows 10**: Skrip start saat ini masih Linux bash (`start-hermes.sh`) dan path direktori Electron masih Unix (`~/.config/Electron`). Untuk laptop bos yang memakai Windows 10, diperlukan `start-hermes.bat`, auto-resolusi path `%APPDATA%\Electron`, dan panduan setup `WINDOWS_SETUP_GUIDE.md`.
  3. **Git Commit**: Perubahan kode di `electron/`, `src/`, `server/`, `storage/`, dan `testing/` masih belum dicommit ke repositori Git `BotWatcher-Dashboard-source`.

## Architecture / Proposed Approach

1. Tambahkan metode `notifyAccountError(accountLabel, reason)` di `src/notifications/telegram.js` dan panggil dari `electron/main.mjs` saat `usable === false` atau event `error` terpicu.
2. Buat `start-hermes.bat` dan perbarui `src/config/engine.config.js` serta `server/server.js` agar secara dinamis mendeteksi platform OS (`process.platform === 'win32'` menggunakan `%APPDATA%\Electron`, selain itu `~/.config/Electron`).
3. Tuliskan panduan setup Windows 10 `docs/WINDOWS_SETUP_GUIDE.md` untuk mempermudah pemindahan ke laptop bos, lalu lakukan staging dan commit Git terstruktur.

---

## Step-by-Step Tasks

### Task 1: Tambahkan Notifikasi Akun Checkpoint/Logout ke Telegram

**Files**:
- `src/notifications/telegram.js`
- `electron/main.mjs`

1. Di `src/notifications/telegram.js`, tambahkan fungsi `notifyAccountError`:
   ```javascript
   async notifyAccountError(accountLabel, reason) {
     const text = `⚠️ PERINGATAN AKUN FB!\nAkun: ${accountLabel}\nStatus: ${reason || "Sesi terputus / perlu login ulang"}\nSilakan buka BotWatcher Dashboard dan login ulang akun ini.`;
     if (this.consoleOnly) {
       console.log(`[TelegramNotifier] (console-only) ${text}`);
       return;
     }
     try {
       await fetch(`${TELEGRAM_API}/bot${this.botToken}/sendMessage`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ chat_id: this.chatId, text }),
       });
     } catch (err) {
       console.error(`[TelegramNotifier] Gagal kirim error: ${err.message}`);
     }
   }
   ```
2. Di `electron/main.mjs`, pada event `account_checked` saat `!usable`, dan pada event `error`:
   Panggil `notifier.notifyAccountError(account?.name ?? accountId, reason)`.
   Gunakan debounce sederhana agar tidak mengirim alert berulang-ulang di setiap putaran rotasi jika status error belum berubah.

**Verification**:
```bash
node --check src/notifications/telegram.js
node --check electron/main.mjs
# Expected: no syntax errors
```

---

### Task 2: Dukungan Cross-Platform Path & Skrip Windows 10 (`start-hermes.bat`)

**Files**:
- `src/config/engine.config.js`
- `server/server.js`
- `start-hermes.bat`

1. **Auto-Resolusi Path di `server/server.js` dan `engine.config.js`**:
   Pastikan pembacaan folder data Electron otomatis mengenali Windows `%APPDATA%`:
   ```javascript
   import os from "node:os";
   import path from "node:path";

   export function getDefaultDataDir() {
     if (process.env.BOTWATCHER_DATA_DIR) {
       return process.env.BOTWATCHER_DATA_DIR;
     }
     if (process.platform === "win32") {
       return path.join(process.env.APPDATA || "C:\\Users\\Default\\AppData\\Roaming", "Electron");
     }
     return path.join(os.homedir(), ".config", "Electron");
   }
   ```
2. **Skrip Runner Windows (`start-hermes.bat`)**:
   Buat file `start-hermes.bat` di root proyek:
   ```bat
   @echo off
   title Hermes Webhook Server - FB Marketplace
   echo Memulai Hermes Webhook Server di port 8765...
   cd /d "%~dp0"
   set NODE_ENV=production
   set PORT=8765
   node server\server.js
   pause
   ```

**Verification**:
```bash
node -e "import('./src/config/engine.config.js').then(m => console.log('Path Resolver OK'))"
node --check server/server.js
# Expected: no syntax errors
```

---

### Task 3: Buat Panduan Setup Windows 10 untuk Laptop Bos

**File**: `docs/WINDOWS_SETUP_GUIDE.md`

Tulis dokumentasi berbahasa Indonesia santai dan jelas:
1. Instalasi Node.js LTS di Windows (v20 atau v22+).
2. Copy folder `BotWatcher-Dashboard-source` dan vault Obsidian ke laptop bos.
3. Menjalankan `pnpm install` atau `npm install`.
4. Membuka BotWatcher Dashboard di Windows dan login akun-akun FB (agar sesi tersimpan otomatis di `%APPDATA%\Electron\storage\profiles`).
5. Menjalankan `start-hermes.bat` untuk mengaktifkan webhook server.
6. Cara membuat shortcut `start-hermes.bat` di folder `shell:startup` Windows agar bot otomatis aktif saat laptop dinyalakan.

---

### Task 4: Bersihkan dan Commit Perubahan ke Git

**File**: Git repository `BotWatcher-Dashboard-source`

1. Periksa `git status` dan pastikan file sensitif (cookie/session/credential) diabaikan oleh `.gitignore`.
2. Stage file perubahan:
   - `git add .gitignore electron/ src/ server/ testing/ docs/ start-hermes.sh start-hermes.bat`
3. Buat commit terstruktur:
   `feat(hermes): integrasi webhook cs marketplace, seller inbox reader, anti-spam, dan balasan admin`

**Verification**:
```bash
git -C /home/masterhand/Projects/BotWatcher-Dashboard-source status
# Expected: Working tree clean.
```

---

## Tests / Validation

1. **Uji Notifikasi Error Akun**:
   Panggil `notifier.notifyAccountError("Akun Test", "Sesi kadaluarsa")` dan pastikan pesan peringatan sampai di Telegram admin.
2. **Uji Path Windows**:
   Simulasikan `process.platform === 'win32'` dan pastikan path mengarah ke `%APPDATA%\Electron`.
3. **Uji Status Git**:
   Pastikan tidak ada file rahasia/token/cookie yang ikut ter-stage.

---

## Risks, Tradeoffs, and Open Questions

1. **Notifikasi Error Berulang (Spamming Alert)**:
   - Jika akun offline selama 1 jam dan rotator berputar tiap 5 menit, bot bisa mengirim 12 alert error.
   - *Mitigation*: Simpan status `lastAlertedState` per akun di memory. Alert hanya dikirim saat state pertama kali berubah dari `monitoring` ke `offline`/`error`.
2. **Browser Engine di Windows (Chrome Portable vs Playwright)**:
   - Di Linux kita memakai Patchright Chromium bawaan. Di Windows, proyek ini sudah mendukung mode `chrome-portable` jika ingin memakai Google Chrome asli. Keduanya didukung penuh oleh arsitektur sesi ini.
