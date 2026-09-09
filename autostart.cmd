@echo off
REM Autostart der Claude-Ampel ein- oder ausschalten.
REM   autostart.cmd        zeigt, ob sie eingetragen ist
REM   autostart.cmd ein    traegt sie in die Aufgabenplanung ein
REM   autostart.cmd aus    entfernt sie wieder
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\autostart.ps1" %*
pause
