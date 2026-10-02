' Startet die Claude-Ampel ohne sichtbares Konsolenfenster.
' Doppelklick genuegt. Laeuft sie schon, sieht der zweite Waechter den
' belegten Port und beendet sich nach einer Sekunde von selbst.

Option Explicit
Dim sh, fso, basis
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

basis = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = basis

' Von Hand gestartet (Doppelklick, Verknuepfung): ein zuvor geschlossenes
' Overlay wieder zulassen -- ein laufender Waechter holt es dann in Sekunden.
' Die Aufgabenplanung uebergibt /auto und laesst ein geschlossenes Overlay zu.
Dim merker, automatisch
merker = basis & "\overlay\geschlossen"
automatisch = False
If WScript.Arguments.Count > 0 Then automatisch = (LCase(WScript.Arguments(0)) = "/auto")
If Not automatisch And fso.FileExists(merker) Then fso.DeleteFile merker

' Fensterstil 0 = unsichtbar, False = nicht auf das Ende warten.
sh.Run "cmd /c node watchdog.js", 0, False
' Das Overlay startet der Waechter selbst, sobald der Server steht.
' Frueher stand es hier -- dann startete jede Wiederholung der Aufgabe ein
' komplettes Electron, das die Einzelinstanz-Sperre sofort wieder beendete.
