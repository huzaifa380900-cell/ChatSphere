@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 22 LTS from https://nodejs.org then run this again.
  pause
  exit /b 1
)
echo Installing ChatSphere frontend dependencies...
npm install --prefix client
if errorlevel 1 goto failed
echo Installing ChatSphere backend dependencies...
npm install --prefix server
if errorlevel 1 goto failed
echo.
echo Installation complete. Open RUN-CLIENT.bat and RUN-SERVER.bat in separate windows.
pause
exit /b 0
:failed
echo.
echo Installation failed. Copy the full error message before asking for help.
pause
exit /b 1
