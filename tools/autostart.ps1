# Traegt die Claude-Ampel in die Aufgabenplanung ein: Start bei der Anmeldung,
# ohne sichtbares Fenster. Die Aufgabe laeuft im eigenen Benutzerkonto und
# braucht deshalb keine Administratorrechte.
#
#   autostart.cmd          Zustand anzeigen
#   autostart.cmd ein      eintragen
#   autostart.cmd aus      entfernen

param([ValidateSet('ein', 'aus', 'status')] [string] $Was = 'status')

$Name = 'Claude-Ampel'
$Basis = Split-Path -Parent $PSScriptRoot
$Ziel = Join-Path $Basis 'Ampel starten.vbs'

function Aufgabe {
    Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
}

switch ($Was) {

    'ein' {
        if (-not (Test-Path -LiteralPath $Ziel)) {
            Write-Host "Nicht gefunden: $Ziel"
            exit 1
        }

        # wscript.exe statt cscript.exe -- nur so bleibt die Konsole aus.
        $aktion = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"{0}"' -f $Ziel) -WorkingDirectory $Basis
        $ausloeser = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"

        # Zweiter Ausloeser: alle zwei Minuten nachsehen. Der Waechter prueft
        # zuerst den Port und steigt still aus, wenn die Ampel laeuft -- das
        # kostet 100 ms und schreibt nichts. Faellt sie aus, uebernimmt er.
        $takt = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 2)
        $takt.Repetition.Duration = ''
        $takt.Repetition.StopAtDurationEnd = $false

        # Dritter Ausloeser: beim Aufwachen aus dem Schlaf. Dabei raeumt Windows
        # die Konsole ab und toetet Waechter, Server und Overlay
        # (Exit-Code 0x40010004). Ohne diesen Ausloeser waere die Ampel bis zum
        # naechsten Takt weg, mit ihm nach gut zehn Sekunden zurueck.
        $klasse = Get-CimClass -ClassName MSFT_TaskEventTrigger -Namespace Root/Microsoft/Windows/TaskScheduler
        $aufwachen = New-CimInstance -CimClass $klasse -ClientOnly
        $aufwachen.Enabled = $true
        $aufwachen.Delay = 'PT10S'
        $aufwachen.Subscription = '<QueryList><Query Id="0" Path="System"><Select Path="System">*[System[Provider[@Name=''Microsoft-Windows-Kernel-Power''] and (EventID=107)]]</Select></Query></QueryList>'

        # Auf dem Notebook soll die Ampel auch im Akkubetrieb kommen, und wenn
        # der Rechner beim Anmelden noch beschaeftigt ist, lieber spaeter als
        # gar nicht. Ohne Zeitlimit, weil der Server dauerhaft laeuft.
        $regeln = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)

        Register-ScheduledTask -TaskName $Name -Action $aktion -Trigger @($ausloeser, $takt, $aufwachen) -Settings $regeln `
            -Description 'Startet Waechter, Server und Overlay der Claude-Ampel bei der Anmeldung.' -Force | Out-Null

        Write-Host "Eingetragen. Bei der naechsten Anmeldung startet:"
        Write-Host "  wscript.exe `"$Ziel`""
        Write-Host ""
        Write-Host "Wieder loswerden:  autostart.cmd aus"
    }

    'aus' {
        if (-not (Aufgabe)) {
            Write-Host "Kein Autostart eingetragen -- nichts zu tun."
            return
        }
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
        Write-Host "Entfernt. Die Ampel startet nur noch von Hand."
    }

    default {
        $a = Aufgabe
        if (-not $a) {
            Write-Host "Autostart: aus.  Einschalten mit:  autostart.cmd ein"
            return
        }
        $info = Get-ScheduledTaskInfo -TaskName $Name
        Write-Host "Autostart: ein  (Zustand: $($a.State))"
        Write-Host "  Ziel:      $Ziel"
        Write-Host "  Ausloeser: $((Get-ScheduledTask -TaskName $Name).Triggers.Count) (Anmeldung, 2-Minuten-Takt, Aufwachen)"
        if ($info.LastRunTime -and $info.LastRunTime.Year -gt 1999) {
            Write-Host "  Zuletzt:   $($info.LastRunTime)  (Ergebnis $($info.LastTaskResult))"
        }
        Write-Host "  Abschalten mit:  autostart.cmd aus"
    }
}
