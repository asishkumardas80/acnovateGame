@echo off
REM ============================================================
REM  DevRush Arena - event launcher
REM  Double-click this to start the game server AND a public
REM  Cloudflare tunnel so remote teams can join over the internet.
REM ============================================================
cd /d "%~dp0"

echo Starting DevRush Arena server on http://localhost:3000 ...
start "DevRush Server" cmd /k node server.js

REM give the server a moment to bind the port
ping -n 3 127.0.0.1 >nul

set "CF=C:\Program Files (x86)\cloudflared\cloudflared.exe"
if not exist "%CF%" set "CF=cloudflared"

echo Opening public tunnel ...
start "DevRush Tunnel - SHARE THE trycloudflare.com URL" cmd /k ""%CF%" tunnel --url http://localhost:3000"

echo.
echo Two windows opened:
echo   1) DevRush Server   - leave it running
echo   2) DevRush Tunnel   - copy the https://XXXX.trycloudflare.com line and share it with teams
echo.
echo The tunnel URL is NEW every time you launch. Host console: open the URL, click
echo "Host Console", enter the passcode from public/index.html (HOST_CODE).
echo.
pause
