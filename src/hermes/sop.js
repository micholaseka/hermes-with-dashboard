// src/hermes/sop.js
// SOP rule engine for classifying customer messages.
// Rules are derived from:
//   - Refrensi/SOP-Costumer-Service-RaffaComputer.md
//   - Refrensi/sop tambahan.md
//
// Output: SOP_ACTION_REPLY | SOP_ACTION_CLARIFY | SOP_ACTION_HANDOFF |
//          SOP_ACTION_NO_ACTION | SOP_ACTION_NOTIFY_ADMIN (location)

export const SOP_ACTION_REPLY = "reply";
export const SOP_ACTION_CLARIFY = "clarify";
export const SOP_ACTION_HANDOFF = "handoff";
export const SOP_ACTION_NO_ACTION = "no_action";
export const SOP_ACTION_NOTIFY_ADMIN = "notify_admin";

// Keywords that trigger the "notify admin" (location/address/COD) branch.
const LOCATION_KEYWORDS = [
  "lokasi",
  "alamat",
  "dimana",
  "posisi",
  "tempat",
  "toko",
  "cod",
  "lengkapi",
  "tujuan",
  "kirim",
  "delivery",
  "pengiriman",
  "shareloc",
  "share loc",
  "shere",
  "serlok",
  "ser lok",
  "sharelok",
  "ancer",
];

// Handoff triggers (from sop tambahan.md):
//   - pelanggan mengeluh, minta refund/pembatalan, mempermasalahkan transaksi
//   - minta diskon, janji, pengecualian yang tidak tercakup aturan
//   - jawaban butuh info tidak tersedia / keyakinan rendah
//   - data sensitif, ancaman, masalah hukum, situasi berpotensi merugikan
//   - percakapan, pengirim, atau maksud tidak dapat diidentifikasi dengan yakin
//   - worker melaporkan sesi/login/checkpoint/browser bermasalah
const HANDOFF_PATTERNS = [
  // Keluhan / membuat masalah
  "mengeluh",
  "kebingungan",
  "sulit",
  "sombong",
  "menyiksa",
  "benci",
  "kasihan",
  "kecewa",
  "rusak",
  "jelek",
  // Refund / pembatalan
  "refund",
  "pengembalian",
  "pembatalan",
  "batalkan",
  "gagal bayar",
  "nyerah",
  "kembalikan",
  // Diskon / janji / pengecualian
  "diskon",
  "minta diskon",
  "kurang",
  "bisa kurang",
  "nego",
  "net",
  "pasnya",
  "voucher",
  "promo",
  "giveaway",
  "gratis",
  // Clear handoff signals (ambiguous/unavailable/info missing)
  "tidak jelas",
  "tidak tahu",
  "tidak bisa",
  "tidak pantas",
  "tidak dapat",
  // Sensitive / legal / threatening
  "ancam",
  "ancaman",
  "hukum",
  "sensitif",
  "pribadi",
  "data",
  "polisi",
  "penipuan",
  "lapor",
];

// Normalization helpers: lower-case, strip accents, remove punctuation/whitespace.
function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Check if a message signals a complaint, refund request, or dispute. */
export function containsHandoffSignal(text) {
  const normalizedText = normalize(text);

  for (const pattern of HANDOFF_PATTERNS) {
    if (normalizedText.includes(pattern)) return true;
  }

  return false;
}

/**
 * Classify a customer message into an SOP action.
 * @param {Object} msg
 * @param {string} msg.sender
 * @param {string} msg.content
 * @param {boolean} [msg.isFirstChat=false]
 * @param {string} [msg.lastSenderRole="customer"]
 * @returns {string} One of the SOP_ACTION_* constants.
 */
export function classifyMessage({
  sender,
  content,
  isFirstChat = false,
  lastSenderRole = "customer",
}) {
  // If the last message was sent by the seller, there is nothing to reply to
  if (lastSenderRole === "seller") {
    return SOP_ACTION_NO_ACTION;
  }

  const text = `${content || ""}`;
  const normalized = normalize(text);

  // 1) Location / address / COD questions -> notify admin
  if (LOCATION_KEYWORDS.some((kw) => normalized.includes(kw))) {
    return SOP_ACTION_NOTIFY_ADMIN;
  }

  // 2) Handoff triggers (complaint, refund, discount, unclear info, sensitive)
  if (containsHandoffSignal(text)) {
    return SOP_ACTION_HANDOFF;
  }

  // 3) First chat without special signals -> reply with WhatsApp template
  if (isFirstChat) {
    return SOP_ACTION_REPLY;
  }

  // 4) Existing customer follow-up without known automated template:
  // Hand off to human admin to avoid sending duplicate/spam first-chat templates
  return SOP_ACTION_HANDOFF;
}
