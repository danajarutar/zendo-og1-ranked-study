@echo off
title Zendo - Create recovery backup
cd /d "%~dp0"
powershell.exe -NoProfile -STA -File "%~dp0scripts\recovery-dialog.ps1"
echo.
pause
