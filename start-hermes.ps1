# start-hermes.ps1 - PowerShell launcher untuk Windows 10
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$env:PORT = if ($env:PORT) { $env:PORT } else { "8765" }
$env:NODE_ENV = "production"

# Muat kredensial dari .env lokal jika ada
$localEnv = Join-Path $ScriptDir ".env"
if (Test-Path $localEnv) {
    Get-Content $localEnv | ForEach-Object {
        $line = $_.Trim()
        if ($line -match "^TELEGRAM_CS_BOT_TOKEN=(.+)$") {
            $env:TELEGRAM_CS_BOT_TOKEN = $matches[1].Trim()
        }
        if ($line -match "^TELEGRAM_CHAT_ID=(.+)$") {
            $env:TELEGRAM_CHAT_ID = $matches[1].Trim()
        }
        if ($line -match "^HERMES_WEBHOOK_SECRET=(.+)$") {
            $env:HERMES_WEBHOOK_SECRET = $matches[1].Trim()
        }
        if ($line -match "^ENGINE_MODE=(.+)$") {
            $env:ENGINE_MODE = $matches[1].Trim()
        }
        if ($line -match "^BOTWATCHER_DATA_DIR=(.+)$") {
            $env:BOTWATCHER_DATA_DIR = $matches[1].Trim()
        }
    }
}

# Muat Telegram credentials dari Hermes .env jika ada
$envFile = Join-Path $env:USERPROFILE ".hermes\.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -match "^TELEGRAM_BOT_TOKEN=(.+)$") {
            $env:TELEGRAM_BOT_TOKEN = $matches[1].Trim()
        }
        if ($line -match "^TELEGRAM_HOME_CHANNEL=(.+)$") {
            $env:TELEGRAM_CHAT_ID = $matches[1].Trim()
        }
    }
}

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host " Hermes Webhook Server - FB Marketplace CS" -ForegroundColor Green
Write-Host " Platform : Windows 10 (PowerShell)" -ForegroundColor Cyan
Write-Host " Port     : $env:PORT" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

node server\server.js
