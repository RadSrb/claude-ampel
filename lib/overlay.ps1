# Listet laufende Overlay-Prozesse, egal wer sie gestartet hat.
#
# Seit dem Autostart ueber die Aufgabenplanung startet der Server das Overlay
# im Normalfall NICHT selbst -- er kann es also nicht an seinem eigenen
# Kindprozess erkennen. Deshalb wird hier nach dem echten Prozess gesucht.
#
# BEWUSST OHNE PARAMETER: Node uebergibt Argumente an "powershell.exe -File"
# so, dass Backslashes verschwinden -- aus "C:\Projekte\ClaudeAmpel" wird
# "C:ProjekteClaudeAmpel". Der Projektordner wird deshalb erst in overlay.js
# gefiltert, wo der Pfad unversehrt vorliegt.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Electron startet Hilfsprozesse (--type=renderer, --type=gpu-process ...),
# die dieselbe Befehlszeile tragen. Nur der Hauptprozess zaehlt.
$treffer = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -and
    $_.CommandLine -like '*main.cjs*' -and
    $_.CommandLine -notlike '*--type=*'
  }

$liste = @($treffer | ForEach-Object {
    [ordered]@{
      pid    = $_.ProcessId
      seit   = $_.CreationDate.ToString('o')
      eltern = $_.ParentProcessId
      cmd    = $_.CommandLine
    }
  })

ConvertTo-Json -InputObject $liste -Depth 3 -Compress
