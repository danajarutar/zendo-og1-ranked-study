param([ValidateSet('menu','status','export','recovery')][string]$Action = 'menu')
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
function Read-ProtectedValue([string]$Path) {
    $secure = (Get-Content -LiteralPath $Path -Raw).Trim() | ConvertTo-SecureString
    return (New-Object System.Net.NetworkCredential('', $secure)).Password
}
function Invoke-NodeTool([string[]]$Arguments) {
    & node @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'The operation failed. Keep existing files and contact the researcher/setup support.' }
}
try {
    $env:ZENDO_COLLECTOR_URL = 'https://zendo-og1-ranked-collector.rutar-danaja.workers.dev'
    $env:ZENDO_ADMIN_TOKEN = Read-ProtectedValue 'private/production-admin.dpapi'
    if ($Action -eq 'menu') {
        Write-Host 'Zendo researcher tools - REAL participant collection'
        Write-Host '1  Check received data and GitHub archive'
        Write-Host '2  Download new data (update individual sessions and combined backup)'
        Write-Host '3  Create portable encrypted recovery backup'
        $choice = Read-Host 'Choose 1, 2 or 3'
        $Action = switch ($choice) { '1' {'status'} '2' {'export'} '3' {'recovery'} default {throw 'No operation selected.'} }
    }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    if ($Action -eq 'status') {
        Invoke-NodeTool @('scripts/researcher.mjs','status')
    } elseif ($Action -eq 'export') {
        Invoke-NodeTool @('scripts/sync-study-data.mjs')
        Write-Host 'Open private/Study data/Sessions for individual sessions. Backup/full-checkpoints.json contains the full history.'
    } elseif ($Action -eq 'recovery') {
        $Host.UI.RawUI.WindowTitle = 'Zendo - Create recovery backup'
        Write-Host 'ZENDO RECOVERY BACKUP'
        Write-Host 'Enter the passphrase ONCE at each prompt and press Enter.'
        Write-Host 'Wait for the SECOND prompt before typing it again. Typing is hidden.'
        do {
            $secure = Read-Host 'STEP 1 OF 2 - New passphrase (at least 16 characters)' -AsSecureString
            $env:ZENDO_NEW_BACKUP_PASSPHRASE = (New-Object System.Net.NetworkCredential('', $secure)).Password
            if ($env:ZENDO_NEW_BACKUP_PASSPHRASE.Length -lt 16) {
                Write-Host 'Too short. Please try again with at least 16 characters.'
                continue
            }
            $confirm = Read-Host 'STEP 2 OF 2 - Enter the SAME passphrase again' -AsSecureString
            $confirmationText = (New-Object System.Net.NetworkCredential('', $confirm)).Password
            if ($env:ZENDO_NEW_BACKUP_PASSPHRASE -ceq $confirmationText) { break }
            Write-Host 'The two entries did not match. Please start again below.'
        } while ($true)
        $env:ZENDO_BACKUP_PASSPHRASE = Read-ProtectedValue 'private/production-backup-passphrase.dpapi'
        $output = "private/recovery/production-recovery-$stamp.json"
        Invoke-NodeTool @('scripts/researcher.mjs','recovery-backup','private/production-key-backup.json',$output)
        Write-Host "Copy $output to two separate backup locations. Keep the passphrase separately."
        Write-Host 'FINISHED - do not enter the passphrase again.'
    }
} finally {
    $confirmationText = $null
    Remove-Item Env:ZENDO_ADMIN_TOKEN,Env:ZENDO_BACKUP_PASSPHRASE,Env:ZENDO_NEW_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
}
