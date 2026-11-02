# Plan: Roadmap & Gap Analysis: Menuntaskan Otomasi CS Inbox Facebook Marketplace

## Goal

Menuntaskan fitur-fitur yang masih kurang pada sistem otomasi CS Facebook Marketplace Raffa Computer agar sistem dapat menangani balasan lokasi dari admin Telegram (SOP Poin 4), melaporkan sesi/checkpoint bermasalah ke admin, mendukung migrasi ke Windows 10, dan tersimpan rapi di repositori git.

## Current Context / Assumptions

- **Yang Sudah Berjalan**:
  - ✅ Webhook server berjalan di port 8765 (`server/server.js`) dengan daemon persisten via `start-hermes.sh` dan crontab.
  - ✅ BotWatcher-Dashboard berhasil mendeteksi unread count per akun dan mengirim webhook hanya saat ada pesan baru (`last_notified_unread_count`).
  - ✅ Sesi Playwright login permanen per akun (Akun 1 Maratul Husna & Akun 2 akun kedua terverifikasi `isLoggedIn: true`).
  - ✅ Navigasi langsung ke Seller Inbox (`/marketplace/inbox/?targetTab=SELLER`) dan membuka obrolan mengambang (floating Messenger thread).
  - ✅ Template salam WhatsApp Raffa Computer dimuat dari Obsidian vault (`template/template chat.md`) dan dikirim dalam 1 bubble chat.
  - ✅ Proteksi anti-spam: jika pesan terakhir dikirim oleh penjual (You/Anda), bot otomatis `no_action` (tidak kirim pesan apa pun).
  - ✅ Notifikasi outbound Telegram terhubung menggunakan token dan chat ID dari `/home/masterhand/.hermes/.env`.
  - ✅ Pencatatan log ke Obsidian vault (`Logs/YYYY/MM/`) terformat rapi dan tersanitasi data pribadi.

- **Yang Masih Kurang (Gaps)**:
  1. **SOP Poin 4: Eksekusi Balasan Admin via Telegram**: Saat pelanggan menanyakan lokasi/COD, bot mengirim notifikasi `Tanya Lokasi!` ke Telegram admin dan statusnya `[PENDING_LOKASI]`. Namun, bot belum memiliki penerima balasan (listener) Telegram untuk membaca teks alamat dari admin, membalaskannya ke pelanggan di Facebook, dan mengubah log menjadi `[SELESAI_LOKASI]`.
  2. **Alert Sesi / Checkpoint Bermasalah**: Jika akun Facebook tiba-tiba logout, checkpoint, captcha, atau ditangguhkan, bot saat ini hanya error di console lokal tanpa memberitahu admin via Telegram.
  3. **Kompatibilitas Windows 10 (Laptop Bos)**: Pengguna berencana memindahkan sistem ini ke laptop bos berbasis Windows 10. Saat ini script start masih bash (`start-hermes.sh`), path profil hardcoded Unix (`~/.config/Electron`), dan startup masih crontab Linux. Butuh runner `.bat`/`.ps1` dan konfigurasi environment path otomatis.
  4. **Versi & Git Commit**: File integrasi Hermes (`server/`, `src/hermes/`, testing scripts) masih belum dicommit ke git repository `BotWatcher-Dashboard-source`.

## Architecture / Proposed Approach

1. **Telegram Inbound Listener**: Tambahkan modul `src/hermes/telegramListener.js` (long-polling ringan via Telegram Bot API) untuk menangkap balasan admin yang me-reply pesan `Tanya Lokasi!`, lalu memanggil `Processor.replyPendingLocation(chatId, replyText)`.
2. **Error Notification Handler**: Bungkus error di `processor.js` dan `server.js` agar kegagalan sesi / checkpoint langsung mengirim alert ke admin Telegram.
3. **Windows 10 Cross-Platform Runner**: Buat script `start-hermes.bat` dan deteksi path otomatis (`process.env.APPDATA` di Windows vs `os.homedir()/.config` di Linux).
4. **Git Versioning**: Lakukan commit terstruktur untuk mendokumentasikan fitur integrasi webhook dan anti-spam ini.

---

## Step-by-Step Tasks

### Task 1: Implementasi SOP Poin 4 — Telegram Inbound Reply untuk [PENDING_LOKASI]

**Files**:
- `src/hermes/pendingStore.js` (menyimpan tiket lokasi pending `{ id, accountId, customerName, message, timestamp }`)
- `src/hermes/telegramListener.js` (long polling getUpdates khusus balasan admin)
- `src/hermes/processor.js` (metode `handleAdminLocationReply`)

1. **Pending Store**:
   Saat pesan diklasifikasikan sebagai `notify_admin` (tanya lokasi), simpan tiket ke file JSON lokal atau memory map di `pendingStore.js`:
   ```javascript
   // Menyimpan: { ticketId, accountId, accountName, customerName, timestamp }
   ```
2. **Telegram Poller**:
   Gunakan polling `getUpdates` dengan parameter `offset`:
   - Jika admin me-reply pesan bot di Telegram dengan teks lokasi (misal: *"Lokasi kami di Kendalrejo Durenan kak..."*):
   - Ambil tiket pending yang sesuai.
   - Buka sesi akun FB tersebut, cari percakapan atas nama pembeli, kirimkan balasan persis seperti isi chat admin.
   - Perbarui log Obsidian harian menjadi `[SELESAI_LOKASI]`.
   - Balas di Telegram: *"✅ Berhasil dikirim ke [Nama Pembeli] di akun [Nama Akun]"*.

**Verification**:
```bash
node -e "import('./src/hermes/pendingStore.js').then(m => console.log('PendingStore OK'))"
```

---

### Task 2: Notifikasi Otomatis saat Akun FB Checkpoint / Logout

**File**: `src/hermes/processor.js` dan `server/server.js`

1. Di `processor.js`, saat `resolver.resolveSession(accountId)` atau `reader.readInbox()` menangkap error login/checkpoint/suspend:
   Kirimkan pesan instan ke admin Telegram:
   ```text
   ⚠️ PERINGATAN AKUN FACEBOOK!
   Akun: [Nama Akun] ([ID])
   Status: Sesi Terputus / Checkpoint / Perlu Login Ulang
   Pesan Error: [Detail singkat]
   Silakan buka BotWatcher Dashboard di desktop dan klik 'Balas Sekarang' / 'Login Ulang' untuk memulihkan sesi.
   ```
2. Catat log error ke Obsidian `Logs/YYYY/MM/error.md`.

**Verification**:
```bash
node -e "import('./src/hermes/processor.js').then(() => console.log('Processor Syntax OK'))"
```

---

### Task 3: Dukungan Skrip & Path untuk Windows 10 (Laptop Bos)

**Files**:
- `src/config/engine.config.js` (pastikan resolver path mendukung Windows)
- `server/server.js` (pastikan path default `BOTWATCHER_DATA_DIR` membaca `%APPDATA%\Electron` atau `%APPDATA%\BotWatcherDashboard`)
- `start-hermes.bat` (batch script untuk start server di Windows)
- `start-hermes.ps1` (PowerShell runner alternatif)

1. **Path Resolution**:
   ```javascript
   // src/config/engine.config.js / server.js
   const defaultDataDir = process.platform === "win32"
     ? path.join(process.env.APPDATA || "", "Electron")
     : path.join(os.homedir(), ".config", "Electron");
   ```
2. **Windows Runner (`start-hermes.bat`)**:
   ```bat
   @echo off
   set NODE_ENV=production
   set PORT=8765
   cd /d "%~dp0"
   node server\server.js
   ```

**Verification**:
```bash
node -e "import('./src/config/engine.config.js').then(m => console.log(m.getSessionConfig()))"
```

---

### Task 4: Dokumentasi & Panduan Import ke Windows 10

**File**: `docs/WINDOWS_SETUP_GUIDE.md`

Tuliskan panduan langkah demi langkah yang ramah orang awam untuk memindahkan aplikasi ke laptop bos:
1. Prasyarat yang harus diinstall di laptop bos (Node.js LTS, Git).
2. Copy folder proyek `BotWatcher-Dashboard-source` dan vault Obsidian.
3. Login 1x akun-akun Facebook di BotWatcher Dashboard di Windows (agar profil tersimpan di `%APPDATA%\Electron\storage\profiles`).
4. Setup autorun `start-hermes.bat` di Startup folder Windows (`shell:startup`) atau Task Scheduler agar otomatis nyala saat Windows dinyalakan.
5. Verifikasi koneksi webhook lokal `http://localhost:8765/webhooks/BotWatcher-Dashboard`.

---

### Task 5: Commit Bersih Perubahan ke Git

**File**: Repositori Git `BotWatcher-Dashboard-source`

1. Periksa `git diff` dan `git status`.
2. Stage file-file perbaikan webhook, anti-spam, messageReader, dan runner:
   - `git add electron/ src/ database/ server/ testing/ start-hermes.sh`
3. Commit dengan pesan yang jelas:
   `feat(hermes): integrasi webhook cs marketplace, seller inbox reader, dan proteksi anti-spam`

**Verification**:
```bash
git -C /home/masterhand/Projects/BotWatcher-Dashboard-source status
# Expected: Working tree clean or ready for push.
```

---

## Tests / Validation

1. **Tes Tanya Lokasi -> Notifikasi Telegram**:
   Simulasikan pesan pembeli bertanya lokasi: pastikan pesan Telegram masuk dengan template lokasi, dan tercatat `[PENDING_LOKASI]` di log Obsidian.
2. **Tes Error Alert**:
   Uji dengan akun dummy / tanpa sesi: pastikan bot mengirim alert Telegram meminta login manual.
3. **Tes Cross-Platform Path**:
   Jalankan check path di platform Linux untuk memastikan tidak ada regresi dan siap dipindahkan ke Windows.

---

## Risks, Tradeoffs, and Open Questions

1. **Telegram Listener (Polling vs Webhook)**:
   - Karena server berjalan di laptop lokal tanpa IP publik / SSL domain, kita menggunakan Telegram `Long Polling` (`getUpdates`).
   - *Tradeoff*: Sangat praktis, tidak butuh ngrok / domain publik, aman di jaringan lokal/Wi-Fi mana pun.
2. **Kecepatan Admin Membalas**:
   - Jika admin baru membalas pesan lokasi setelah beberapa jam, floating chat di Facebook pembeli mungkin sudah tertutup.
   - *Mitigation*: Handler balasan admin akan membuka kembali Seller Inbox akun terkait secara otomatis dan mencari obrolan pembeli berdasarkan nama/identitas tiket.
