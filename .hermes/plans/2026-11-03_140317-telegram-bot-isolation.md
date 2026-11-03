# Plan: Pisahkan bot Telegram Hermes Agent dan CS Marketplace

## Goal
Membuat Hermes Agent tetap bisa dipakai lewat Telegram sekaligus memastikan BotWatcher/Hermes CS menerima balasan admin tanpa konflik `getUpdates` HTTP 409.

## Current context / assumptions

- Repo aktif: `/home/masterhand/Projects/BotWatcher-Dashboard-source`.
- Hermes CS server berjalan dari `server/server.js` di `127.0.0.1:8765`.
- BotWatcher mengirim webhook ke Hermes CS.
- Hermes CS memakai long polling Telegram (`getUpdates`) melalui `src/hermes/telegramListener.js`.
- Hermes Agent utama juga aktif dengan Telegram enabled di `/home/masterhand/.hermes/config.yaml`.
- Log nyata menunjukkan `Conflict: terminated by other getUpdates request`; satu token Telegram sedang dipakai dua proses.
- Kredensial tetap hanya di `/home/masterhand/.hermes/.env`; jangan menaruh token di Git, source code, plan, atau output log.
- Target beban: satu admin, satu Hermes Agent Telegram, satu Hermes CS server, dan 2–10 akun Facebook.
- Perubahan lokal yang sudah ada dan harus dipertahankan: `src/hermes/sessionResolver.js` dan `src/hermes/telegramListener.js`. Jangan mencampur perubahan baru dengan commit yang tidak terkait.

## Architecture / proposed approach

Gunakan dua bot Telegram yang benar-benar berbeda: satu khusus Hermes Agent utama dan satu khusus CS Marketplace. Hermes Agent tetap menerima percakapan normal melalui tokennya sendiri, sedangkan `TELEGRAM_CS_BOT_TOKEN` hanya dipoll oleh `server/server.js`; keduanya mengarah ke chat Telegram admin yang sesuai. Tambahkan pemeriksaan startup dan test konfigurasi agar token yang sama terdeteksi sebelum masuk produksi, tanpa menambah service atau dependency baru.

## Step-by-step tasks

### 1. Inventarisasi proses dan konfigurasi tanpa membuka secret

- Jalankan dari repo:

```bash
ps -ef | grep -E '[h]ermes|[n]ode server/server.js|[e]lectron' || true
printf 'configured vars:\n'
grep -E '^(TELEGRAM_CS_BOT_TOKEN|TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID|TELEGRAM_HOME_CHANNEL)=' /home/masterhand/.hermes/.env | sed -E 's/=.*/=<set>/'
```

- Expected output: terlihat proses Hermes Agent dan server CS; variabel hanya tampil sebagai `<set>`, tidak ada token.
- Catat proses mana yang memegang polling Telegram. Jangan mematikan proses pada tahap ini.

### 2. Dapatkan bot token Hermes Agent yang berbeda

- Di Telegram, buka `@BotFather` dan pilih bot yang memang dipakai untuk mengakses Hermes Agent utama. Buat/regenerate token bila perlu.
- Pasang token langsung di file lokal `/home/masterhand/.hermes/.env`, tanpa mengirimnya lewat chat:

```text
TELEGRAM_BOT_TOKEN=<TOKEN_HERMES_AGENT>
TELEGRAM_CS_BOT_TOKEN=<TOKEN_CS_MARKETPLACE>
TELEGRAM_CHAT_ID=<CHAT_ID_ADMIN_CS>
```

- Jika Hermes Agent memakai nama environment lain, temukan nama sebenarnya dengan perintah read-only dan sesuaikan hanya nama variabel yang sudah didukung instalasi Hermes; jangan menebak format baru.
- Expected verification, tanpa menampilkan nilai:

```bash
grep -E '^(TELEGRAM_CS_BOT_TOKEN|TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)=' /home/masterhand/.hermes/.env | sed -E 's/=.*/=<set>/'
```

Output harus menunjukkan ketiga nama tersedia.

### 3. Tambahkan test gagal untuk mendeteksi token Telegram yang sama (RED)

- Buat `testing/test-telegram-token-isolation.js`.
- Test harus mengimpor helper validasi konfigurasi yang akan dibuat pada task 4 dan memakai environment sementara:

```js
import assert from "node:assert/strict";
import { assertTelegramTokenIsolation } from "../src/config/telegram.config.js";

assert.throws(
  () => assertTelegramTokenIsolation({
    agentToken: "same-token",
    csToken: "same-token",
  }),
  /berbeda/,
);

assert.doesNotThrow(() => assertTelegramTokenIsolation({
  agentToken: "agent-token",
  csToken: "cs-token",
}));

console.log("PASS: Telegram token isolation");
```

- Jalankan:

```bash
node testing/test-telegram-token-isolation.js
```

- Expected RED result: gagal karena `src/config/telegram.config.js` belum ada.

### 4. Implementasi minimum validasi konfigurasi (GREEN)

- Buat `src/config/telegram.config.js` dengan isi berikut:

```js
export function assertTelegramTokenIsolation({ agentToken, csToken } = {}) {
  if (agentToken && csToken && agentToken === csToken) {
    throw new Error("Token Telegram Hermes Agent dan CS harus berbeda.");
  }
  return true;
}
```

- Di `server/server.js`, setelah pemuatan environment dan sebelum membuat `TelegramListener`, tambahkan validasi CS saja terhadap token Hermes Agent jika variabel agent tersedia. Jangan log nilai token.
- Panggil helper dengan:

```js
assertTelegramTokenIsolation({
  agentToken: process.env.TELEGRAM_AGENT_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN_AGENT,
  csToken: process.env.TELEGRAM_CS_BOT_TOKEN,
});
```

- Jika konfigurasi Hermes Agent memakai `TELEGRAM_BOT_TOKEN` yang sama dengan CS saat ini, jangan membuat server crash tanpa pesan jelas. Prioritaskan konfigurasi eksplisit `TELEGRAM_AGENT_BOT_TOKEN` untuk Agent dan `TELEGRAM_CS_BOT_TOKEN` untuk CS; dokumentasikan nama tersebut di setup guide. Jangan mengubah token lama secara otomatis.
- Jalankan:

```bash
node testing/test-telegram-token-isolation.js
node --check src/config/telegram.config.js
node --check server/server.js
```

- Expected GREEN result: `PASS: Telegram token isolation`; semua syntax check lulus.

### 5. Tambahkan test bahwa listener CS tetap memilih token CS

- Tambahkan test kecil ke `testing/test-telegram-token-isolation.js` atau buat `testing/test-telegram-listener-config.js` yang membuat `TelegramListener` dengan `telegramBotToken: "cs-token"` dan memastikan `listener.token === "cs-token"`.
- Jalankan sebelum perubahan bila perlu untuk memastikan test gagal jika constructor berubah; implementasi yang ada seharusnya langsung lulus.
- Expected output: `PASS: CS listener uses dedicated token`.

### 6. Dokumentasikan operasi dua bot

- Ubah `docs/WINDOWS_SETUP_GUIDE.md` atau README bagian konfigurasi Telegram yang sudah ada; jangan menambah dokumen baru jika bagian yang cocok tersedia.
- Isi minimal yang harus ada:
  - bot Hermes Agent dan bot CS Marketplace wajib berbeda;
  - `TELEGRAM_CS_BOT_TOKEN` hanya untuk `node server/server.js`;
  - jangan gunakan token CS pada konfigurasi Telegram Hermes Agent;
  - HTTP 409 berarti ada dua proses melakukan `getUpdates` dengan token sama;
  - balasan admin wajib memakai Reply pada notifikasi `Tanya Lokasi!`.
- Jangan menulis token atau chat ID nyata.

### 7. Matikan proses lama dan jalankan satu instance per fungsi

- Setelah token terpisah terpasang, lakukan restart terkontrol:

```bash
pkill -f 'node server/server.js' || true
pkill -f 'hermes.*telegram' || true
```

- Jalankan Hermes CS dari repo:

```bash
node server/server.js
```

- Jalankan Hermes Agent utama dengan perintah normal instalasi yang dipakai mesin ini, setelah memastikan ia memakai token Agent, bukan token CS.
- Expected output CS:

```text
[hermes] webhook server listening on :8765
[telegram-listener] Memulai polling Telegram untuk admin ...
```

- Expected negative check: tidak muncul `Konflik HTTP 409` selama minimal 60 detik.
- Cek proses tanpa menampilkan environment:

```bash
ps -ef | grep -E '[h]ermes|[n]ode server/server.js'
```

### 8. Uji end-to-end dengan dua fungsi Telegram

- Dari akun admin, kirim pesan biasa ke bot Hermes Agent. Expected: Hermes Agent membalas/merespons normal.
- Kirim chat customer baru yang meminta lokasi/COD. Expected:
  - BotWatcher mengirim webhook;
  - log Hermes menunjukkan `classification=notify_admin` dan `actionResult=pending_lokasi`;
  - notifikasi `Tanya Lokasi!` masuk ke bot CS;
  - balas dengan Reply pada notifikasi tersebut;
  - log Hermes menunjukkan `Menerima balasan dari admin`, `Menemukan tiket cocok`, lalu hasil Facebook.
- Jangan memakai chat baru tanpa Reply untuk balasan template.
- Verifikasi log dengan kata kunci saja, tanpa menyalin token atau data pribadi:

```bash
# gunakan output proses atau log service yang dipakai; cari hanya status
journalctl --user --since '5 minutes ago' --no-pager 2>/dev/null | grep -Ei 'webhook|pipeline|telegram-listener|SELESAI_LOKASI|409|Gagal' | tail -100
```

### 9. Jalankan regresi dan commit terpisah

- Jalankan:

```bash
node testing/test-telegram-token-isolation.js
node testing/test-telegram-location-api.js
node testing/test-admin-reply.js
node testing/test-p1.js
node testing/test-hermes-webhook.js
git diff --check
```

- Expected: semua test berakhir dengan `PASS`; `git diff --check` tidak mengeluarkan error.
- Review scope:

```bash
git status --short
git diff --stat
git diff -- src/config/telegram.config.js server/server.js testing/test-telegram-token-isolation.js README.md docs/WINDOWS_SETUP_GUIDE.md
```

- Commit hanya perubahan source/test/docs terkait:

```bash
git add src/config/telegram.config.js server/server.js testing/test-telegram-token-isolation.js README.md docs/WINDOWS_SETUP_GUIDE.md
git commit -m "fix(telegram): isolate Hermes and CS bot polling"
git push origin main
```

- Expected: commit berhasil, push ke `origin/main` berhasil, dan `.env` tidak muncul pada staged files.

## Tests / validation

- TDD task 3: test isolation harus RED sebelum helper dibuat.
- TDD task 4: helper/config validation harus GREEN setelah implementasi.
- Existing tests: `test-telegram-location-api.js`, `test-admin-reply.js`, `test-p1.js`, dan `test-hermes-webhook.js` harus tetap PASS.
- Runtime validation: dua bot menerima tugas masing-masing selama minimal 60 detik tanpa HTTP 409.
- End-to-end acceptance: pesan normal ke bot Hermes Agent tetap dilayani, sementara Reply pada notifikasi CS mengirim balasan ke customer Facebook.
- Remote validation setelah push:

```bash
git status --short
git log -1 --oneline
gh api repos/micholaseka/hermes-with-dashboard/commits/$(git rev-parse HEAD) --jq '.sha'
```

Expected: working tree bersih, SHA remote sama dengan SHA lokal.

## Risks, tradeoffs, and open questions

- Jika token CS yang pernah dikirim ke chat belum direvoke, revoke setelah token baru aktif; jangan menjalankan dua bot dengan token lama dan baru secara bersamaan tanpa tujuan.
- Pemisahan token menyelesaikan konflik polling, tetapi tidak memperbaiki sesi Facebook yang benar-benar logout. Jika pipeline masih gagal, diagnosis berikutnya harus dari log `sessionResolver` dan profil akun.
- HTTP 409 bisa tetap muncul sebentar saat proses lama berhenti; tunggu masa lease Telegram habis sebelum menyimpulkan konfigurasi masih salah.
- Perintah `pkill -f 'hermes.*telegram'` harus ditinjau sebelum dijalankan di mesin produksi agar tidak mematikan sesi Hermes Agent yang tidak dimaksud; implementer wajib melihat daftar proses terlebih dahulu.
- Open question: nama environment token Telegram Agent yang dipakai instalasi Hermes utama perlu dikonfirmasi dari dokumentasi/runtime sebelum mengubah konfigurasi; jangan menebak nama variabel.
- Tidak perlu webhook Telegram untuk solusi ini; long polling sudah cukup untuk satu bot CS dan satu bot Agent yang terisolasi.
