#!/bin/bash
# package-for-windows.sh
# Membuat paket bersih yang siap di-copy ke Windows.
# Hasil: ./BotWatcher-Dashboard-package/ + zip opsional

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="${SCRIPT_DIR}/BotWatcher-Dashboard-package"
ZIP_FILE="${SCRIPT_DIR}/BotWatcher-Dashboard-package.zip"

echo "== Membersihkan paket lama..."
rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR"

echo "== Menyalin file penting..."
rsync -a \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.vscode' \
  --exclude='release' \
  --exclude='ui-design/node_modules' \
  --exclude='ui-design/dist' \
  --exclude='ui-design/.git' \
  --exclude='testing' \
  --exclude='playwright-browsers' \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  --exclude='Thumbs.db' \
  --exclude='send_fb_reply.mjs' \
  --exclude='verify_reply.mjs' \
  --exclude='BotWatcher-Dashboard-package' \
  --exclude='BotWatcher-Dashboard-package.zip' \
  "${SCRIPT_DIR}/" "$PACKAGE_DIR/"

echo "== Menghapus file sampah di dalam paket..."
find "$PACKAGE_DIR" -name '*.log' -delete 2>/dev/null || true
find "$PACKAGE_DIR" -name '.DS_Store' -delete 2>/dev/null || true
find "$PACKAGE_DIR" -name 'Thumbs.db' -delete 2>/dev/null || true

echo "== Membuat zip..."
cd "$SCRIPT_DIR"
zip -r "$ZIP_FILE" BotWatcher-Dashboard-package/ > /dev/null

echo ""
echo "SELESAI!"
echo "Paket folder : $PACKAGE_DIR"
echo "Paket zip    : $ZIP_FILE"
echo ""
echo "Cara pakai di Windows:"
echo "1. Extract BotWatcher-Dashboard-package.zip ke C:\BotWatcher\"
echo "2. Copy .env kamu ke dalam folder tsb"
echo "3. Edit .env sesuai setting Windows"
echo "4. Jalankan start-hermes.bat"
