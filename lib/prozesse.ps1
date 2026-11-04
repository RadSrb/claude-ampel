# Alle Prozesse mit Eltern-PID, Startzeit (FILETIME UTC), Name und
# Kommandozeile als einzeiliges JSON -- fuer lib/aufraeumen.js.
#
#   powershell -File prozesse.ps1

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$liste = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
  $start = ''
  if ($_.CreationDate) { $start = [string]$_.CreationDate.ToFileTimeUtc() }
  [pscustomobject]@{
    p  = [int]$_.ProcessId
    pp = [int]$_.ParentProcessId
    s  = $start
    n  = [string]$_.Name
    c  = [string]$_.CommandLine
  }
}

ConvertTo-Json -InputObject @($liste) -Compress
