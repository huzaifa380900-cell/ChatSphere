@echo off
cd /d "%~dp0server"
if not exist node_modules (
  echo Dependencies are missing. Run INSTALL.bat first.
  pause
  exit /b 1
)
if not exist .env copy .env.example .env
npm run dev
pause
