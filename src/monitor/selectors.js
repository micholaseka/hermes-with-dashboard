// src/monitor/selectors.js
//
// PETA, bukan OTAK. File ini isinya cuma "di mana elemen X berada di
// halaman", dipisah dari logic supaya kalau Facebook ubah tampilan
// (sering banget), kamu cuma perlu update file ini — gak perlu sentuh
// checkUnread.js sama sekali.
//
// STATUS SAAT INI (uji coba tahap awal):
// Kita belum butuh baca nama pengirim / per-percakapan. Target sekarang
// cuma: "ada inbox masuk atau enggak" — dibaca dari badge counter
// "Chats to answer" di halaman inbox.
//
// unreadBadge diambil dari HTML asli (hasil inspect manual):
//   <a href="/marketplace/inbox/?targetTab=SELLER" role="link">
//     ...
//     <span dir="auto">Chats to answer</span>
//     ...
//     <span dir="auto">0</span>   <-- ini yang mau diambil
//   </a>
//
// CATATAN RESIKO: dipilih pakai :last-child karena span angka adalah
// span[dir="auto"] TERAKHIR di dalam link itu. Kalau nanti Facebook
// nambah elemen lain di dalam link ini, selector ini bisa salah ambil.
// Kalau ketemu atribut yang lebih unik (misal aria-label khusus di
// span angkanya), ganti ke situ.

export const marketplaceInboxSelectors = {
  // PENTING: harus ke halaman DASHBOARD, bukan langsung ke /inbox/.
  // Card "Obrolan yang perlu dijawab" cuma ada di halaman ini.
  inboxUrl: "https://www.facebook.com/marketplace/you/dashboard/?locale=id_ID",

  // Badge "Obrolan yang perlu dijawab" (bahasa Indonesia) / "Chats to
  // answer" (bahasa Inggris) — angka di sampingnya = jumlah belum dijawab.
  // Pakai href, bukan teks, biar gak kepengaruh bahasa akun.
  // CATATAN: JANGAN tambah ":last-child" di sini — itu CSS pseudo-class
  // yang artinya "anak terakhir di parent-nya SENDIRI", bukan "elemen
  // terakhir dari semua yang ketemu". Karena teks & angka sama-sama anak
  // tunggal di div masing-masing, keduanya kena ":last-child" dan bikin
  // salah ambil. Ambil elemen terakhirnya pakai .last() di kode JS, bukan
  // di sini.
  unreadBadge: 'a[href*="targetTab=SELLER"] span[dir="auto"]',

  // URL Inbox Penjual asli - tempat daftar obrolan pembeli dan chat thread
  sellerInboxUrl: "https://www.facebook.com/marketplace/inbox/?targetTab=SELLER&locale=id_ID",

  // Daftar obrolan di halaman Seller Inbox (di dalam kontainer role="main")
  conversationItem: 'div[role="main"] div[role="button"][tabindex="0"]',

  // Messenger floating chat container & log
  chatLog: 'div[role="log"][aria-label*="Messages in conversation"], div[role="log"]',
  composerRegion: 'div[role="region"][aria-label="Thread composer"]',
  chatInput: 'div[role="textbox"][contenteditable="true"]',
  sendButton: 'div[aria-label="Press enter to send"], div[aria-label*="Kirim"], div[aria-label*="Send"]',

  unavailableText: [
    "your account has been suspended",
    "your account has been temporarily suspended",
    "we suspended your account",
    "your account has been disabled",
    "we disabled your account",
    "this account has been disabled",
    "akun anda ditangguhkan",
    "akun anda telah ditangguhkan",
    "akun anda dinonaktifkan",
    "akun anda telah dinonaktifkan",
  ],
};