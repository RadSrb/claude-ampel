' Startet Server und Overlay ohne sichtbares Konsolenfenster.
' Doppelklick genuegt -- laeuft der Server schon, beendet sich der zweite
' Versuch von selbst (Port belegt) und nur das Overlay kommt dazu.

Option Explicit
Dim sh, fso, basis
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

basis = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = basis

' Fensterstil 0 = unsichtbar, False = nicht auf das Ende warten.
sh.Run "cmd /c node watchdog.js", 0, False
WScript.Sleep 3000

' VS Code setzt ELECTRON_RUN_AS_NODE=1; bleibt das stehen, oeffnet Electron
' kein Fenster. Deshalb hier ausdruecklich leeren.
sh.Run "cmd /c set ""ELECTRON_RUN_AS_NODE="" && node_modules\.bin\electron.cmd overlay\main.cjs", 0, False
