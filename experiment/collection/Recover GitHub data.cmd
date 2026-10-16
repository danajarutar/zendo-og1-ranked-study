@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -STA -File "%~dp0scripts\recover-github.ps1"
