# start-hermes.ps1 - PowerShell launcher untuk Windows 10
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$env:PORT = if ($env:PORT) { $env:PORT } else { "8765" }
$env:NODE_ENV = "production"

# Muat Telegram credentials dari ~/.hermes/.env jika ada
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
