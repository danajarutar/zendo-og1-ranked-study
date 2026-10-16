param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$nodePath = (Get-Command node -ErrorAction Stop).Source
function Read-ProtectedValue([string]$Path) {
    $secureValue = (Get-Content -LiteralPath $Path -Raw).Trim() | ConvertTo-SecureString
    return (New-Object System.Net.NetworkCredential('', $secureValue)).Password
}
function Write-DialogStatus([string]$State, [string]$BackupPath = '') {
    @{ state=$State; backup_path=$BackupPath; process_id=$PID; updated_at=[DateTime]::UtcNow.ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath 'private/recovery-dialog-status.json' -Encoding UTF8
}
# Preflight before displaying any password field. No credentials are printed.
$env:ZENDO_ADMIN_TOKEN = Read-ProtectedValue 'private/production-admin.dpapi'
$env:ZENDO_BACKUP_PASSPHRASE = Read-ProtectedValue 'private/production-backup-passphrase.dpapi'
$env:ZENDO_COLLECTOR_URL = 'https://zendo-og1-ranked-collector.rutar-danaja.workers.dev'
if ($CheckOnly) {
    Remove-Item Env:ZENDO_ADMIN_TOKEN,Env:ZENDO_BACKUP_PASSPHRASE
    Write-Output 'PASS: dialog libraries, Node and protected credentials are available; no backup created.'
    exit 0
}
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Zendo - Encrypted recovery backup'
$form.ClientSize = New-Object System.Drawing.Size(620, 385)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

$intro = New-Object System.Windows.Forms.Label
$intro.Text = "Choose a NEW passphrase of at least 16 characters.`r`nEnter the same passphrase in both boxes. Keep it in your password manager."
$intro.SetBounds(22, 18, 575, 55)
$label1 = New-Object System.Windows.Forms.Label
$label1.Text = '1. New backup passphrase'
$label1.SetBounds(22, 84, 560, 24)
$first = New-Object System.Windows.Forms.TextBox
$first.UseSystemPasswordChar = $true
$first.SetBounds(22, 112, 575, 30)
$first.TabIndex = 0
$label2 = New-Object System.Windows.Forms.Label
$label2.Text = '2. Enter the SAME passphrase again'
$label2.SetBounds(22, 158, 560, 24)
$second = New-Object System.Windows.Forms.TextBox
$second.UseSystemPasswordChar = $true
$second.SetBounds(22, 186, 575, 30)
$second.TabIndex = 1
$create = New-Object System.Windows.Forms.Button
$create.Text = 'Create backup'
$create.SetBounds(22, 239, 180, 38)
$create.TabIndex = 2
$result = New-Object System.Windows.Forms.Label
$result.SetBounds(22, 294, 575, 75)
$result.Text = 'Type only in these two boxes. Nothing is sent to a website.'
$form.Controls.AddRange(@($intro, $label1, $first, $label2, $second, $create, $result))
$first.Add_KeyDown({ if ($_.KeyCode -eq 'Enter') { $_.SuppressKeyPress=$true; $second.Focus() } })
$second.Add_KeyDown({ if ($_.KeyCode -eq 'Enter') { $_.SuppressKeyPress=$true; $create.PerformClick() } })
$create.Add_Click({
    if ($first.Text.Length -lt 16) {
        $result.Text = 'Please use at least 16 characters in the first box.'
        $first.Focus()
        return
    }
    if ($first.Text -cne $second.Text) {
        $result.Text = 'The two entries do not match. Please check and try again.'
        $second.Focus()
        return
    }
    $create.Enabled = $false
    try {
        $env:ZENDO_NEW_BACKUP_PASSPHRASE = $first.Text
        $outputPath = 'private/recovery/production-recovery-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.json'
        # Only file paths are command arguments. Passwords remain in the child environment.
        $toolOutput = & $nodePath 'scripts/researcher.mjs' 'recovery-backup' 'private/production-key-backup.json' $outputPath 2>&1
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputPath)) { throw 'Backup generation failed.' }
        $first.Clear(); $second.Clear()
        $first.Enabled=$false; $second.Enabled=$false
        $result.ForeColor=[System.Drawing.Color]::DarkGreen
        $result.Text = "BACKUP CREATED AND VERIFIED.`r`nKeep your passphrase separately. Copy the new file from private/recovery to your backup drive. You can close this window."
        Write-DialogStatus 'complete' $outputPath
    } catch {
        $result.ForeColor=[System.Drawing.Color]::DarkRed
        $result.Text = 'The backup could not be created. No password is shown here. Tell Codex this message; leave this window open.'
        Write-DialogStatus 'failed'
        $create.Enabled=$true
    } finally {
        $toolOutput=$null
        Remove-Item Env:ZENDO_NEW_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
    }
})
$form.Add_Shown({ $form.Activate(); $first.Focus(); Write-DialogStatus 'awaiting_input' })
try { [void]$form.ShowDialog() }
finally {
    $first.Clear(); $second.Clear(); $form.Dispose()
    Remove-Item Env:ZENDO_ADMIN_TOKEN,Env:ZENDO_BACKUP_PASSPHRASE,Env:ZENDO_NEW_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
}
