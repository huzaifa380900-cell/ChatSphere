@echo off
cd /d "%~dp0client"
if not exist node_modules (
  echo Dependencies are missing. Run INSTALL.bat first.
  pause
  exit /b 1
)
npm run dev
pause
