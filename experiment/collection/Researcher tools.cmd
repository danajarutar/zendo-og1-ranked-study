@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -File "%~dp0scripts\researcher-tools.ps1"
pause
