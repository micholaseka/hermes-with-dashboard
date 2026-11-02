@echo off
setlocal
title Hermes Webhook Server - FB Marketplace Raffa Computer

:: Pindah ke folder tempat file batch ini berada
cd /d "%~dp0"

:: Set port default dan environment
if "%PORT%"=="" set PORT=8765
if "%NODE_ENV%"=="" set NODE_ENV=production

:: Muat kredensial Telegram dari .env jika ada
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
