@echo off
REM Cloudflare-Tunnel fuer den Handy-Zugriff starten.
cd /d "%~dp0"
node tunnel.js
pause
