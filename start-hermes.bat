@echo off
setlocal
title Hermes Webhook Server - FB Marketplace Raffa Computer

:: Pindah ke folder tempat file batch ini berada
cd /d "%~dp0"

:: Set port default dan environment
if "%PORT%"=="" set PORT=8765
if "%NODE_ENV%"=="" set NODE_ENV=production

:: Muat kredensial Telegram dari .env lokal jika ada
if exist ".env" (
  for /f "usebackq tokens=1,2 delims==" %%A in (".env") do (
    if "%%A"=="TELEGRAM_CS_BOT_TOKEN" set "TELEGRAM_CS_BOT_TOKEN=%%B"
    if "%%A"=="TELEGRAM_CHAT_ID" set "TELEGRAM_CHAT_ID=%%B"
    if "%%A"=="HERMES_WEBHOOK_SECRET" set "HERMES_WEBHOOK_SECRET=%%B"
    if "%%A"=="ENGINE_MODE" set "ENGINE_MODE=%%B"
    if "%%A"=="BOTWATCHER_DATA_DIR" set "BOTWATCHER_DATA_DIR=%%B"
  )
)

:: Muat kredensial Telegram dari Hermes .env jika ada
if exist "%USERPROFILE%\.hermes\.env" (
  for /f "usebackq tokens=1,2 delims==" %%A in ("%USERPROFILE%\.hermes\.env") do (
    if "%%A"=="TELEGRAM_BOT_TOKEN" set "TELEGRAM_BOT_TOKEN=%%B"
    if "%%A"=="TELEGRAM_HOME_CHANNEL" set "TELEGRAM_CHAT_ID=%%B"
  )
)

echo ====================================================
echo  Hermes Webhook Server - FB Marketplace CS
echo  Platform : Windows 10
echo  Port     : %PORT%
echo ====================================================

node server\server.js

if %ERRORLEVEL% neq 0 (
  echo.
  echo [ERROR] Server berhenti dengan kode keluar %ERRORLEVEL%.
  pause
)
