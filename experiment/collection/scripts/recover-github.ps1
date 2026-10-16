param([switch]$CheckOnly)
$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$nodePath=(Get-Command node -ErrorAction Stop).Source
if($CheckOnly){Write-Output 'PASS: Windows dialogs and Node available.';exit 0}
[System.Windows.Forms.Application]::EnableVisualStyles()
try {
 $folder=New-Object System.Windows.Forms.FolderBrowserDialog
 $folder.Description='Select the extracted zendo-og1-ranked-responses-main folder (containing production), or its production folder.'
 if($folder.ShowDialog() -ne 'OK'){exit 0}
 $inputPath=$folder.SelectedPath
 $backupPath=Join-Path (Get-Location) 'private/production-key-backup.json'
 $localKeyReady=$false
 if((Test-Path -LiteralPath 'private/production-backup-passphrase.dpapi') -and (Test-Path -LiteralPath $backupPath)) {
  try {
  $secure=(Get-Content -LiteralPath 'private/production-backup-passphrase.dpapi' -Raw).Trim() | ConvertTo-SecureString
  $env:ZENDO_BACKUP_PASSPHRASE=(New-Object System.Net.NetworkCredential('', $secure)).Password
  $localKeyReady=$true
  } catch { Remove-Item Env:ZENDO_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue }
 }
 if(-not $localKeyReady) {
  $picker=New-Object System.Windows.Forms.OpenFileDialog
  $picker.Title='Select your encrypted production-recovery JSON backup'
  $picker.Filter='Encrypted recovery backup (*.json)|*.json'
  if($picker.ShowDialog() -ne 'OK'){exit 0}
  $backupPath=$picker.FileName
  $form=New-Object System.Windows.Forms.Form
  $form.Text='Unlock your recovery backup'
  $form.ClientSize=New-Object System.Drawing.Size(520,150)
  $form.StartPosition='CenterScreen'
  $label=New-Object System.Windows.Forms.Label
  $label.Text='Enter the passphrase you chose when creating this backup (once).'
  $label.SetBounds(15,15,490,30)
  $password=New-Object System.Windows.Forms.TextBox
  $password.UseSystemPasswordChar=$true
  $password.SetBounds(15,50,490,25)
  $button=New-Object System.Windows.Forms.Button
  $button.Text='Unlock'
  $button.SetBounds(385,95,120,30)
  $button.DialogResult=[System.Windows.Forms.DialogResult]::OK
  $form.AcceptButton=$button
  $form.Controls.AddRange(@($label,$password,$button))
  if($form.ShowDialog() -ne 'OK'){exit 0}
  $env:ZENDO_BACKUP_PASSPHRASE=$password.Text
  $password.Clear();$form.Dispose()
 }
 $outputPath=Join-Path (Get-Location) 'private/Study data'
 $result=& $nodePath 'scripts/recover-github.mjs' $inputPath $backupPath $outputPath 2>&1
 if($LASTEXITCODE -ne 0){throw ($result -join [Environment]::NewLine)}
 [System.Windows.Forms.MessageBox]::Show(('Recovery completed. Individual sessions and the combined backup are in:'+ [Environment]::NewLine+$outputPath+[Environment]::NewLine+'This is the data present in the downloaded GitHub snapshot.'),'Zendo recovery complete','OK','Information') | Out-Null
} catch {
 [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Zendo recovery did not complete','OK','Error') | Out-Null
} finally {Remove-Item Env:ZENDO_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue}
