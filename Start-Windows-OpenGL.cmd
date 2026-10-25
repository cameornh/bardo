@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install the current LTS release from https://nodejs.org/.
  pause
  exit /b 1
)
node tools\start-windows.mjs --opengl
pause
