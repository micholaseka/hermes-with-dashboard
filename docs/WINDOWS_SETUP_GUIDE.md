# Panduan Setup BotWatcher & Hermes di Laptop Windows 10

Dokumen ini berisi panduan langkah demi langkah untuk mengimpor dan menjalankan sistem otomasi CS Facebook Marketplace Raffa Computer di laptop bos yang menggunakan Windows 10.

---

## 1. Prasyarat yang Diinstal di Laptop Bos

Sebelum menjalankan aplikasi, pastikan di laptop Windows 10 sudah terpasang:
1. **Node.js (LTS Version)**:
   - Unduh dari: https://nodejs.org/ (pilih versi LTS, minimal v20 atau v22).
   - Saat install, centang pilihan *"Automatically install the necessary tools"*.
   - Verifikasi di Command Prompt (cmd):
     ```cmd
     node -v
     npm -v
     ```
2. **Git for Windows** (opsional tapi disarankan):
   - Unduh dari: https://git-scm.com/download/win

---

## 2. Memindahkan Folder Proyek & Vault Obsidian

1. Copy seluruh folder proyek `BotWatcher-Dashboard-source` ke laptop bos (misal di `C:\Projects\BotWatcher-Dashboard-source` atau `D:\BotWatcher-Dashboard-source`).
2. Copy folder Obsidian Vault `Hermes-Marketplace-inbox` ke `Documents` di laptop bos (misal di `C:\Users\<NamaBos>\Documents\Hermes-Marketplace-inbox`).

---

## 3. Install Dependencies di Windows

Buka Command Prompt (cmd) atau PowerShell, lalu arahkan ke folder proyek:
```cmd
cd /d C:\Projects\BotWatcher-Dashboard-source
npm install
```
*(Atau jika menggunakan pnpm: `pnpm install`)*

---

## 4. Buka BotWatcher Dashboard & Login Akun Facebook

1. Di terminal cmd, jalankan dashboard:
   ```cmd
   npm start
   ```
2. Tambahkan akun Facebook yang akan dipantau (misal Akun 1, Akun 2).
3. Klik tombol **"Login Manual"** / **"Balas Sekarang"** pada tiap kartu akun di dashboard.
4. Jendela browser akan terbuka. Silakan login ke Facebook seperti biasa (masukkan email & password).
5. Setelah berhasil login, tutup browser. Sesi login akan tersimpan **secara permanen** di:
   `%APPDATA%\Electron\storage\profiles\<accountId>`

---

## 5. Menjalankan Hermes Webhook Server

1. Buka folder proyek di Windows Explorer.
2. Klik ganda (double-click) file **`start-hermes.bat`** (atau jalankan via PowerShell: `.\start-hermes.ps1`).
3. Jendela konsol akan muncul dan menampilkan:
   ```
   ====================================================
    Hermes Webhook Server - FB Marketplace CS
    Platform : Windows 10
    Port     : 8765
   ====================================================
   [hermes] webhook server listening on :8765
   ```
4. Server webhook sekarang aktif menerima sinyal notifikasi inbox dari BotWatcher Dashboard dan membalas otomatis.

---

## 6. Membuat Server Otomatis Nyala saat Laptop Dinyalakan (Auto-Start)

Agar bos tidak perlu menyalakan `start-hermes.bat` manual setiap kali menyalakan laptop:
1. Tekan tombol **Windows + R** di keyboard.
2. Ketik `shell:startup` lalu tekan Enter. Jendela folder Startup Windows akan terbuka.
3. Klik kanan di dalam folder tersebut -> **New** -> **Shortcut**.
4. Masukkan target lokasi file: `C:\Projects\BotWatcher-Dashboard-source\start-hermes.bat`.
5. Beri nama shortcut: `Hermes CS Marketplace`.
6. Selesai! Sekarang setiap kali laptop bos dinyalakan, server webhook akan otomatis aktif di latar belakang.

---

## 7. Troubleshooting di Windows

- **Port 8765 bentrok**:
  Jika port 8765 dipakai aplikasi lain, ubah `PORT=8766` di `start-hermes.bat` dan sesuaikan port webhook di BotWatcher settings.
- **Profil terkunci (SingletonLock)**:
  Jika terjadi crash mendadak, buka folder `%APPDATA%\Electron\storage\profiles\<id>` dan hapus file `lockfile` / `SingletonLock` jika ada.
- **Lokasi Obsidian Vault berbeda**:
  Jika lokasi vault di laptop bos tidak berada di `C:\Users\<user>\Documents\Hermes-Marketplace-inbox`, sesuaikan `VAULT_ROOT` di `src/hermes/store.js` dan `src/hermes/logger.js`.
