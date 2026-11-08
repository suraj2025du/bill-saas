@echo off
setlocal
cd /d "%~dp0"
title Free GST Billing
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 20 or newer from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
rem A release ZIP is already built and needs nothing else.
if exist dist\index.html if exist dist-server\server.mjs goto :run
rem A source checkout installs the tools and builds the app once.
if not exist node_modules (
  echo Installing dependencies - one time only, please wait...
  call npm install --no-fund --no-audit || goto :fail
)
echo Building the app - one time only, please wait...
call npm run build || goto :fail

:run
echo Starting Free GST Billing at http://127.0.0.1:47371  - keep this window open while you work.
node server.js --open
goto :eof

:fail
echo Setup failed. Please read the messages above.
pause
exit /b 1
