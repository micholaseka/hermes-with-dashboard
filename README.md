# BotWatcher Dashboard

BotWatcher Dashboard adalah aplikasi desktop Electron untuk memantau akun
Facebook Marketplace dan jumlah percakapan yang perlu dijawab. Aplikasi
menjalankan pengecekan akun bergiliran, menampilkan statusnya di dashboard,
dan dapat mengirim notifikasi ke Telegram serta webhook lokal Hermes.

**Versi source saat ini: `2.1.0`** (tag release: `v2.1.0`).
Sesi browser menggunakan koneksi jaringan langsung; pengaturan dan import
proxy tidak tersedia.

## Fitur dan alur kerja

1. `AccountManager` memuat daftar akun dan statusnya dari database SQLite.
2. `AccountRotator` mengacak urutan akun, lalu memeriksanya dalam batch
   (default 5-10 akun bersamaan), dengan jeda antar-batch dan antar-putaran.
3. Setiap akun dibuka melalui `MarketplaceSession` menggunakan profil browser
   permanen. Pengecekan berjalan headless; sesi untuk membalas atau login
   manual berjalan dengan jendela browser.
4. `checkUnreadCount` membuka dashboard Marketplace dan membaca badge
   percakapan yang perlu dijawab. Jumlah `0` berarti dashboard terbaca dan
   tidak ada unread; `null` berarti akun atau dashboard tidak tersedia.
5. Login, checkpoint, suspend, disable, blokir, atau navigasi yang timeout
   tidak dianggap sebagai nol pesan. Dashboard dibatasi 15 detik untuk
   navigasi agar satu akun bermasalah tidak menahan rotasi akun berikutnya.
6. Ketika jumlah unread bertambah, aplikasi mengirim notifikasi Telegram
   (jika dikonfigurasi) dan POST ke Hermes. UI Electron menerima status dan
   progres melalui IPC.

Orkestrator utama berada di `src/rotation/accountRotator.js`. Penjelasan
khusus engine ada di [`src/engine/README.md`](src/engine/README.md).

## Webhook Hermes

Endpoint default:

```text
http://localhost:8765/webhooks/BotWatcher-Dashboard
```

Ubah endpoint dengan environment variable `HERMES_WEBHOOK_URL`. Setiap POST
menggunakan `Content-Type: application/json` dan format:

```json
{
  "signal": "wake",
  "event": "new_inbox_messages",
  "accountId": "account-7",
  "accountName": "Toko Kediri",
  "hasNewMessages": true,
  "newMessageCount": 2,
  "unreadCount": 5
}
```

Webhook hanya dikirim jika unread bertambah dibandingkan hasil pemeriksaan
sebelumnya. `newMessageCount` adalah selisih tersebut dan `unreadCount`
adalah jumlah terbaru. Pada pemeriksaan pertama, unread yang sudah ada
dihitung sebagai pesan baru karena belum ada jumlah sebelumnya untuk
dibandingkan. Penurunan jumlah unread tidak mengirim webhook. Timeout atau
gagalnya endpoint dicatat ke log dan tidak menghentikan siklus rotasi.

Endpoint `localhost` menunjuk ke komputer tempat aplikasi berjalan. Pastikan
Hermes aktif dan menerima koneksi di port `8644` pada komputer yang sama.

## Data akun, profil, dan upgrade

Dalam aplikasi Electron, data disimpan di direktori data pengguna Electron,
bukan di folder tempat program dipasang:

- Database akun: `<userData>/botwatcher.db`
- Profil browser permanen: `<userData>/storage/profiles/<accountId>/`
- Sesi lama untuk seeding: `<userData>/storage/sessions/`

Di Windows, `<userData>` umumnya berada di
`%APPDATA%/botwatcher-dashboard/`. Lokasi ditentukan oleh Electron
`app.getPath("userData")`; `appId` electron-builder saat ini adalah
`com.micholaseka.botwatcherdashboard`.

Upgrade manual dilakukan dengan menjalankan **Setup NSIS EXE** versi terbaru
di atas instalasi yang sudah ada. Tutup aplikasi terlebih dahulu dan jangan
menghapus folder data pengguna. Data akun dan profil browser berada di luar
folder instalasi sehingga tidak semestinya terhapus saat update. Untuk
menjaga instalasi dikenali sebagai aplikasi yang sama, jangan mengubah
`appId`. Uji upgrade dari versi yang sudah dipakai user sebelum distribusi
luas.

Saat ini belum ada auto-updater di dalam aplikasi. User mengunduh Setup EXE
dari GitHub Release dan menjalankannya sendiri. Jangan memilih artefak
Portable untuk memperbarui instalasi NSIS.

## Pengembangan lokal

Persyaratan utama:

- Node.js 22 (workflow Windows menggunakan Node.js 22)
- pnpm `10.34.5` (lihat `packageManager` di `package.json`)

Install dependency dan jalankan aplikasi:

```bash
pnpm install
cd ui-design
pnpm install
cd ..
pnpm run start
```

`start` menjalankan Vite untuk UI dan Electron secara bersamaan. Untuk
membangun UI saja:

```bash
pnpm run build:ui
```

Mode browser diatur lewat `ENGINE_MODE` dalam
`src/config/engine.config.js`:

- `dev` (default): Chromium dari Patchright. Di Electron, profil permanen
  disimpan di user data aplikasi. Saat development, data root dapat diarahkan
  melalui `BOTWATCHER_DATA_DIR`.
- `chrome-portable`: memakai Chrome Portable dan profil yang telah login.
  Atur `CHROME_PORTABLE_PATH` dan `CHROME_PORTABLE_USER_DATA_DIR` untuk
  menentukan executable dan direktori data Chrome.

## Tes

Tes otomatis/mocked yang tidak perlu membuka akun Facebook:

```bash
node testing/test-check-unread.js
node testing/test-unusable-reason.js
node testing/test-hermes-webhook.js
node testing/test-rotation-events.js
node testing/test-account-manager.js
```

Tes sesi seperti `node testing/test-session.js [accountId]` membuka browser
dan mungkin memerlukan login manual. `testing/test-monitor-debug.js` dan
`testing/test-rotator.js` juga merupakan alat debugging/manual, bukan bagian
dari proses rilis.

## Build dan rilis Windows

Build lokal Windows menghasilkan installer NSIS dan aplikasi Portable:

```powershell
pnpm install
cd ui-design
pnpm install
cd ..
pnpm run build:ui
pnpm run build:playwright-browsers
npx --yes electron-builder@26.15.7 --win nsis portable --x64 --publish never
```

Artefak build berada di `release/`. Installer untuk user bernama seperti
`BotWatcher-Dashboard-Setup-2.1.0-x64.exe`; artefak `Portable` tidak
meng-upgrade instalasi NSIS.

GitHub Actions workflow ada di
`.github/workflows/windows-release.yml`:

- Push ke `main` dan run manual membangun UI dan Chromium Patchright di
  Windows, lalu menjalankan smoke test packaged Windows app. Workflow ini
  tidak menunggu build Linux.
- Jika build berhasil dan tag `v<versi package.json>` belum ada, workflow
  membuat tag. Jika GitHub Release untuk tag itu belum ada, workflow membuat
  release dan mengunggah artefak `.exe`, `.yml`, serta `.blockmap`.
- Run manual (`workflow_dispatch`) wajib memasukkan tag yang sama dengan
  versi di `package.json`; saat ini default-nya `v2.1.0`.
- Jika tag sudah ada tetapi GitHub Release belum ada, push ke `main` tetap
  membuat release. Jika release sudah ada, push tidak menerbitkan ulang
  release tersebut. Untuk rilis berikutnya, naikkan `version` di
  `package.json`.

Sebelum rilis: cek versi dan tag, pastikan workflow selesai sukses, lalu
unduh Setup EXE dari GitHub Release dan uji upgrade tanpa menghapus instalasi
lama maupun direktori data pengguna.

Workflow GitHub Actions release saat ini hanya membuat artefak Windows.
Paket Linux `.deb` dan `.rpm` tidak dibuat atau dilampirkan oleh workflow ini.

## Struktur proyek

```text
electron/                  Electron main process dan preload
src/accounts/              Manajemen akun dan repository SQLite
src/config/                Konfigurasi engine dan lokasi data
src/database/              Inisialisasi database
src/marketplace/           Sesi browser dan konfigurasi Patchright
src/monitor/               Selektor Marketplace dan pembacaan unread
src/notifications/         Notifikasi Telegram dan webhook Hermes
src/rotation/               Siklus rotasi akun
src/storage/               Helper data sesi
ui-design/                 UI React + Vite
testing/                   Tes dan alat debugging manual
.github/workflows/          Build, smoke test, dan GitHub Release
```
