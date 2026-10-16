$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$env:WRANGLER_LOG_PATH = Join-Path $PWD '.wrangler/logs'
$env:XDG_CONFIG_HOME = Join-Path $PWD '.wrangler/config'
$env:WRANGLER_SEND_METRICS = 'false'
Write-Host 'Use a fine-grained GitHub token limited to danajarutar/zendo-og1-ranked-responses, with Contents: Read and write.'
$protectedToken = Read-Host 'Paste the repository-specific token (hidden)' -AsSecureString
try {
    $env:ZENDO_RANKED_ARCHIVE_TOKEN = (New-Object System.Net.NetworkCredential('', $protectedToken)).Password
    node scripts/install-archive-token.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Archive connection failed.' }
} finally { Remove-Item Env:ZENDO_RANKED_ARCHIVE_TOKEN -ErrorAction SilentlyContinue }
