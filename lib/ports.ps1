# Listet lauschende localhost-Ports samt Prozess und Kommandozeile als JSON.
# Die Zuordnung Port -> Projekt passiert in Node, weil in der Kommandozeile
# eines Dev-Servers fast immer der Projektpfad steht.

$ErrorActionPreference = 'Stop'

# Ohne das liefert PowerShell die Ausgabe in der Konsolen-Codepage:
# Umlaute und … kommen dann zerstoert in Node an.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$procs = @{}
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
  $procs[[int]$_.ProcessId] = $_
}

$rows = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object {
    $_.LocalPort -gt 1024 -and
    # Der dynamische Windows-Bereich sind fluechtige Hilfsports, keine Dev-Server.
    $_.LocalPort -lt 49152
  } |
  ForEach-Object {
    $p = $procs[[int]$_.OwningProcess]
    if ($null -eq $p) { return }
    [pscustomobject]@{
      port    = [int]$_.LocalPort
      pid     = [int]$_.OwningProcess
      process = $p.Name
      cmd     = $p.CommandLine
    }
  } |
  # Auf einem Port lauschen oft mehrere Prozesse (IPv4/IPv6, Wrapper und
  # eigentlicher Server). Nur echte Duplikate wegwerfen, nicht die Geschwister --
  # sonst faellt genau der Prozess raus, dessen Kommandozeile den Projektpfad traegt.
  Sort-Object port, pid -Unique

ConvertTo-Json -InputObject @($rows) -Compress -Depth 3
