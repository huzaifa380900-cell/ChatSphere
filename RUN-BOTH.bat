@echo off
cd /d "%~dp0"
if not exist client\node_modules (
  echo Run INSTALL.bat first.
  pause
  exit /b 1
)
if not exist server\node_modules (
  echo Run INSTALL.bat first.
  pause
  exit /b 1
)
if not exist server\.env copy server\.env.example server\.env
start "ChatSphere Backend" /D "%~dp0server" cmd /k "npm run dev"
start "ChatSphere Frontend" /D "%~dp0client" cmd /k "npm run dev"
