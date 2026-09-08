@echo off
REM Mini-Overlay starten (immer im Vordergrund, rechter Bildschirmrand).
REM Setzt voraus, dass start.cmd bereits laeuft.
cd /d "%~dp0"

REM VS Code setzt ELECTRON_RUN_AS_NODE=1 in seinem Terminal. Bleibt das stehen,
REM startet Electron als reines Node und kennt kein Fenster-API.
set "ELECTRON_RUN_AS_NODE="

start "" /b "node_modules\.bin\electron.cmd" "overlay\main.cjs"
