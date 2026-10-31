@echo off
setlocal
cd /d "%~dp0"
title SMARTFUZE AQUA - backup
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set STAMP=%%i
if not exist "backups" mkdir "backups"
echo Copying the data folder to backups\data-%STAMP% ...
robocopy "data" "backups\data-%STAMP%" /E /NFL /NDL /NJH /NJS /NP >nul
if %errorlevel% GEQ 8 (
  echo Backup FAILED.
) else (
  echo Backup complete: backups\data-%STAMP%
  echo Copy that folder to a USB drive or cloud storage for safe keeping.
)
pause
