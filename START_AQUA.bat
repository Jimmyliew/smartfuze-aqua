@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title SMARTFUZE AQUA v2.0.3
color 0B

echo.
echo   ==================================================
echo     SMARTFUZE AQUA  v2.0.3
echo     Shrimp pond monitoring - real ESP32 data only
echo   ==================================================
echo.

rem ---- 1. Check Node.js -------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js is not installed.
  echo.
  echo       Install the LTS version from https://nodejs.org
  echo       then double-click START_AQUA.bat again.
  echo.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (
  echo   [X] Node.js 18 or newer is required. Installed major version: %NODE_MAJOR%
  echo       Install the current LTS from https://nodejs.org
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo   [OK] Node.js %%v

rem ---- 2. Install dependencies if missing ---------------------------------
set NEED_INSTALL=0
if not exist "node_modules\aedes\package.json" set NEED_INSTALL=1
if not exist "node_modules\express\package.json" set NEED_INSTALL=1
if not exist "node_modules\ws\package.json" set NEED_INSTALL=1

if "%NEED_INSTALL%"=="1" (
  echo   [..] First start: installing dependencies. This needs internet once.
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   [X] Dependency installation failed. Check the internet connection and try again.
    pause
    exit /b 1
  )
  echo   [OK] Dependencies installed
) else (
  echo   [OK] Dependencies already installed
)

if not exist "data" mkdir "data"
if not exist "data\readings" mkdir "data\readings"

rem ---- 3. Start MQTT broker + backend + dashboard (one process) ----------
echo.
echo   Starting MQTT broker, backend and dashboard...
echo.
echo     Dashboard:  http://localhost:3000
echo     MQTT:       1883
echo.
echo   The browser opens automatically. Keep this window open.
echo   If Windows Firewall asks, allow Node.js on PRIVATE networks.
echo.

set AQUA_OPEN_BROWSER=1
node server.js

echo.
echo   SMARTFUZE AQUA has stopped.
pause
