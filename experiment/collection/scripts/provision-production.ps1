$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$env:WRANGLER_LOG_PATH = Join-Path $PWD '.wrangler/logs'
$env:XDG_CONFIG_HOME = Join-Path $PWD '.wrangler/config'
$env:WRANGLER_SEND_METRICS = 'false'
New-Item -ItemType Directory -Force -Path private | Out-Null
function Get-OrCreateProtectedSecret([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $secret = [Convert]::ToBase64String($bytes)
        $secret | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $Path -NoNewline
    }
    $secure = (Get-Content -LiteralPath $Path -Raw).Trim() | ConvertTo-SecureString
    return (New-Object System.Net.NetworkCredential('', $secure)).Password
}
try {
    $env:ZENDO_ADMIN_TOKEN = Get-OrCreateProtectedSecret 'private/production-admin.dpapi'
    $env:ZENDO_BACKUP_PASSPHRASE = Get-OrCreateProtectedSecret 'private/production-backup-passphrase.dpapi'
    $env:ZENDO_ARCHIVE_KEY_ID = 'og1-ranked-production-1'
    if (-not (Test-Path -LiteralPath 'private/production-key-backup.json')) {
        node scripts/researcher.mjs key-backup private/production-key-backup.json
        if ($LASTEXITCODE -ne 0) { throw 'Key backup failed.' }
    }
    $env:ZENDO_ADMIN_TOKEN | node ../../node_modules/wrangler/bin/wrangler.js secret put ADMIN_TOKEN --config wrangler.jsonc
    if ($LASTEXITCODE -ne 0) { throw 'Admin installation failed.' }
    node scripts/researcher.mjs install-key private/production-key-backup.json wrangler.jsonc
    if ($LASTEXITCODE -ne 0) { throw 'Archive key installation failed.' }
    Write-Host 'Production secrets installed. Complete portable recovery backup using Researcher tools.'
} finally {
    Remove-Item Env:ZENDO_ADMIN_TOKEN,Env:ZENDO_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
}
