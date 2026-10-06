# Dauerlaeufer: fuehrt die Ampel-Skripte in EINEM PowerShell aus, statt fuer
# jeden Aufruf einen neuen zu starten.
#
# Ein Prozessstart kostet ~160 ms, der Add-Type-Block in windows.ps1 nochmal
# ~100-230 ms -- und zwar pro Aufruf. Hier faellt beides genau einmal an.
#
# Protokoll, zeilenweise ueber stdin/stdout:
#   rein:  {"id":1,"script":"windows.ps1","args":["focus","12345"]}
#   raus:  ##AMPEL##1##{"ok":true}
#
# Die Skripte geben ihr JSON einzeilig aus; Zeilenumbrueche werden trotzdem
# entfernt, damit eine Antwort verlaesslich genau eine Zeile bleibt.
#
# Ueber stdin uebergebene Argumente kommen unversehrt an -- anders als bei
# "powershell.exe -File", wo Backslashes verschwinden (siehe overlay.ps1).

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

$HIER = Split-Path -Parent $MyInvocation.MyCommand.Path

while ($true) {
  $zeile = [Console]::In.ReadLine()
  # Node hat die Leitung geschlossen -- Feierabend.
  if ($null -eq $zeile) { break }
  if (-not $zeile.Trim()) { continue }

  $id = -1
  $payload = ''
  try {
    $auftrag = $zeile | ConvertFrom-Json
    $id = $auftrag.id
    $pfad = Join-Path $HIER $auftrag.script
    # Eigene Variable, weil nur "@name" splattet -- "@(...)" waere ein einziges
    # Argument in Array-Form.
    $argListe = @($auftrag.args)
    # & statt . -- ein "exit" im Skript beendet dann nur das Skript, nicht uns.
    $aus = & $pfad @argListe
    $payload = ($aus -join '') -replace '[\r\n]', ''
  } catch {
    # Ein kaputtes Skript darf den Dauerlaeufer nicht mitnehmen. Leere Antwort
    # heisst in Node dasselbe wie frueher ein fehlgeschlagener Prozess: null.
    $payload = ''
  }
  [Console]::Out.WriteLine("##AMPEL##$id##$payload")
  [Console]::Out.Flush()
}
