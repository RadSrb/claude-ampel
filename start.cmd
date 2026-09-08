@echo off
REM Claude-Ampel starten und im Browser oeffnen.
cd /d "%~dp0"
REM Der Server gibt die Adresse samt Token aus.
node watchdog.js
pause
