# Listet lauschende localhost-Ports samt Prozess und Kommandozeile als JSON.
# Die Zuordnung Port -> Projekt passiert in Node, weil in der Kommandozeile
# eines Dev-Servers fast immer der Projektpfad steht.
#
# netstat statt Get-NetTCPConnection: dasselbe Ergebnis in 37 ms statt 1300 ms.
# Get-NetTCPConnection geht ueber WMI und war der teuerste Einzelposten im
# 2-Sekunden-Takt der Ampel.

# Kommandozeilen, die der Aufrufer schon kennt, als "pid,pid,pid". Fuer die
# wird WMI nicht mehr befragt -- die Kommandozeile eines laufenden Prozesses
# aendert sich nicht mehr. Sind alle PIDs bekannt, faellt die teuerste Zeile
# dieses Skripts ganz weg und es bleiben ~40 ms netstat uebrig.
param([string]$Bekannt = '')

$ErrorActionPreference = 'Stop'

# Ohne das liefert PowerShell die Ausgabe in der Konsolen-Codepage:
# Umlaute und … kommen dann zerstoert in Node an.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Lauschende Sockets erkennt man an der leeren Gegenstelle, NICHT am
# Statuswort: das heisst je nach Windows-Sprache "LISTENING" oder "ABHOEREN".
$LAUSCHT = '^(0\.0\.0\.0|\[::\]):0$'

$gesehen = @{}
$sockets = @()

# Ohne -p TCP: "netstat -p TCP" listet ausschliesslich IPv4. Sonst fehlen
# alle Dienste, die nur auf [::] lauschen. UDP-Zeilen fallen unten durch die
# Feldpruefung heraus, sie tragen keinen Status.
foreach ($zeile in (netstat -ano)) {
  $f = -split $zeile.Trim()
  if ($f.Count -lt 5 -or $f[0] -ne 'TCP') { continue }
  if ($f[2] -notmatch $LAUSCHT) { continue }

  $port = [int]($f[1] -replace '^.*:', '')
  # Der dynamische Windows-Bereich sind fluechtige Hilfsports, keine Dev-Server.
  if ($port -le 1024 -or $port -ge 49152) { continue }

  $prozess = [int]$f[4]
  # Auf einem Port lauschen oft mehrere Sockets (IPv4/IPv6). Nur echte
  # Duplikate wegwerfen, nicht die Geschwisterprozesse -- sonst faellt genau
  # der Prozess raus, dessen Kommandozeile den Projektpfad traegt.
  $schluessel = "$port/$prozess"
  if ($gesehen.ContainsKey($schluessel)) { continue }
  $gesehen[$schluessel] = $true
  $sockets += [pscustomobject]@{ port = $port; pid = $prozess }
}

if ($sockets.Count -eq 0) {
  Write-Output '[]'
  exit 0
}

$bekanntePids = @{}
foreach ($teil in ($Bekannt -split ',')) {
  if ($teil -match '^\d+$') { $bekanntePids[[int]$teil] = $true }
}
$offen = @($sockets | Where-Object { -not $bekanntePids.ContainsKey($_.pid) })

# Die Kommandozeile gibt es nur ueber WMI (~370 ms) -- der teuerste Posten,
# der uebrig ist. Ein -Filter ueber die gesuchten PIDs bringt nichts: die
# WMI-Verbindung kostet, nicht die Datenmenge (gemessen 498 ms gefiltert
# gegen 372 ms ungefiltert). Deshalb lieber gar nicht fragen, wenn nichts
# Neues dazugekommen ist.
$procs = @{}
if ($offen.Count -gt 0) {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
    $procs[[int]$_.ProcessId] = $_
  }
}

# Zwei Zeilenarten: fuer frisch nachgeschlagene PIDs mit "process"/"cmd",
# fuer bekannte ohne. Node erkennt am fehlenden Feld, dass es seinen eigenen
# Merkzettel nehmen soll.
$rows = $sockets | ForEach-Object {
  if ($bekanntePids.ContainsKey($_.pid)) {
    return [pscustomobject]@{ port = $_.port; pid = $_.pid }
  }
  $p = $procs[$_.pid]
  if ($null -eq $p) { return }
  [pscustomobject]@{
    port    = $_.port
    pid     = $_.pid
    process = $p.Name
    cmd     = $p.CommandLine
  }
} | Sort-Object port, pid

ConvertTo-Json -InputObject @($rows) -Compress -Depth 3
