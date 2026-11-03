#!/bin/bash
# Start Hermes webhook server if not already running
cd /home/masterhand/Projects/BotWatcher-Dashboard-source || exit 1
if ! pgrep -f "node server/server.js" > /dev/null 2>&1; then
  export BOTWATCHER_DATA_DIR="${BOTWATCHER_DATA_DIR:-/home/masterhand/.config/Electron}"
  # Load project .env if present
  if [ -f ".env" ]; then
    set -a
    source .env
    set +a
  fi
  # Load Telegram credentials from Hermes .env
  if [ -f /home/masterhand/.hermes/.env ]; then
    export TELEGRAM_BOT_TOKEN="$(grep '^TELEGRAM_BOT_TOKEN=' /home/masterhand/.hermes/.env | cut -d= -f2-)"
    export TELEGRAM_CHAT_ID="$(grep '^TELEGRAM_HOME_CHANNEL=' /home/masterhand/.hermes/.env | cut -d= -f2-)"
  fi
  setsid env DISPLAY=:0 BOTWATCHER_DATA_DIR="$BOTWATCHER_DATA_DIR" TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID" node server/server.js > /tmp/hermes-webhook.log 2>&1 < /dev/null &
  echo "$(date '+%Y-%m-%d %H:%M:%S') server started (pid $!)" >> /tmp/hermes-webhook.log
fi
