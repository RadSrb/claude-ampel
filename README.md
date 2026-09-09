# Claude-Ampel

Lokales Dashboard, das alle offenen Claude-Code-Sessions in VS Code als Ampel zeigt —
am PC und am Handy.

| Farbe | Zustand | Bedeutung |
|---|---|---|
| 🔴 rot | braucht dich | Claude wartet auf eine Freigabe oder Antwort (Notification-Hook) |
| 🔴 rot | fragt dich | Der Turn ist zu Ende, endet aber mit einer **Frage oder einem Vorschlag** — oder ein Auswahl-Widget bzw. eine Plan-Freigabe steht offen |
| 🔴 rot | steht | Läuft angeblich, rührt sich aber seit 5 Minuten nicht |
| 🟡 gelb | läuft | Arbeitet gerade |
| 🟢 grün | fertig | Turn abgeschlossen, wartet auf einen neuen Auftrag |
| ⚪ grau | unbekannt | Kein Transkript vorhanden |

Neben jedem Namen sitzt ein **Kontext-Ring** wie im Compact-Fenster von Claude
Code: der gefüllte Anteil zeigt, wie voll der Kontext ist, bevor verdichtet wird.
Ab 70 % wird er gelb, ab 90 % rot. Beim Darüberfahren stehen Tokenzahlen, Modell
und **woher die Fenstergröße stammt**.

### Wie die Fenstergröße ermittelt wird

Claude Code rechnet intern mit 200 000 Tokens, für Modelle mit großem Fenster mit
1 000 000. Das Problem: **welche Variante eine Session benutzt, steht nirgends im
Transkript** — dort heißt das Modell immer `claude-opus-5`, ohne den `[1m]`-Zusatz.
Deshalb drei Stufen, von der stärksten Evidenz abwärts:

1. `CLAUDE_CODE_MAX_CONTEXT_TOKENS` — dieselbe Umgebungsvariable, die Claude Code kennt.
2. **Gemessen**: lag im bisherigen Verlauf schon mehr als 200 000 im Kontext, ist
   das Fenster bewiesenermaßen groß.
3. **Einstellung**: `"model": "opus[1m]"` in `~/.claude/settings.json`, aber nur
   für Sessions derselben Modellfamilie — eine Sonnet-Session erbt das große
   Opus-Fenster nicht.

Sonst gilt das Standardfenster. Der Tooltip nennt die verwendete Stufe, damit die
Zahl nachprüfbar bleibt.

## Starten

**Am einfachsten:** die Verknüpfung **Claude-Ampel** auf dem Desktop. Sie startet
Server und Overlay ohne sichtbares Konsolenfenster (`Ampel starten.vbs`).
Läuft der Server schon, kommt nur das Overlay dazu.

| Datei | Wozu |
|---|---|
| `Ampel starten.vbs` | Server + Overlay, ohne Konsolenfenster. Ziel der Desktop-Verknüpfung. |
| `start.cmd` | Nur der Server, mit sichtbarem Protokoll. Für die Fehlersuche. |
| `overlay.cmd` | Nur die Spalte. Setzt einen laufenden Server voraus. |
| `tunnel.cmd` | Zugriff vom Handy, zeigt einen QR-Code. |
| `autostart.cmd` | Start bei der Anmeldung ein- oder ausschalten. |

`start.cmd` gibt die Adresse **samt Token** aus:

```
Claude-Ampel: http://127.0.0.1:4317/?t=<token>
```

Einmal aufrufen — das Token wandert in ein Cookie, danach genügt `http://127.0.0.1:4317`.

### Bei der Anmeldung mitstarten

```
autostart.cmd ein      trägt die Ampel in die Aufgabenplanung ein
autostart.cmd          zeigt, ob sie eingetragen ist
autostart.cmd aus      entfernt den Eintrag wieder
```

Die Aufgabe heißt **Claude-Ampel**, läuft im eigenen Benutzerkonto und braucht
keine Administratorrechte. Sie startet dieselbe `Ampel starten.vbs` wie die
Desktop-Verknüpfung, also ohne Konsolenfenster, und ist auch im Akkubetrieb
erlaubt. War der Rechner bei der Anmeldung noch beschäftigt, wird der Start
nachgeholt statt ausgelassen.

Zu sehen ist der Eintrag außerdem in der **Aufgabenplanung** (`taskschd.msc`)
unter *Aufgabenplanungsbibliothek*. Von Hand entfernen geht dort ebenso —
`autostart.cmd aus` ist nur der kürzere Weg.

> Startet die Ampel bereits im Hintergrund, tut ein zusätzlicher Doppelklick
> auf die Verknüpfung nichts: der Server sieht seinen Port belegt und der
> Wächter gibt auf, das Overlay lässt nur eine Spalte zu.

## Eine Kachel pro Projekt, Untersessions darin

Startest du im selben Projektordner eine zweite Session, erscheint sie als
**Untersession** unter derselben Kachel statt als zweite gleichnamige Kachel.
Die Kachel trägt immer den dringendsten Zustand ihrer Sessions — eine Session,
die dich braucht, kann nicht hinter einer fertigen verschwinden. Jede
Untersession hat eigene Farbe, eigenen Titel und eigenen **Fenster**-Knopf; die
localhost-Ports stehen einmal oben am Projekt.

Gruppiert wird über den **Pfad**, nicht den Ordnernamen — `c:\Projekte\Demo` und
`d:\Anderswo\Demo` bleiben getrennt.

## Mini-Overlay (immer sichtbar)

`overlay.cmd` startet eine schmale Spalte am rechten Bildschirmrand, die
**über allen anderen Fenstern bleibt** — egal welches Programm gerade vorn ist.
Pro Projekt eine Zeile: Farbpunkt, Name, Dauer; rote Zeilen sind hinterlegt.
Eine Zahl hinter dem Namen bedeutet mehrere Sessions in diesem Projekt.

- **Klick auf eine Zeile** holt das zugehörige VS-Code-Fenster nach vorn.
  Zuerst wird das genau zugeordnete Fenster angesprochen; gibt es keins,
  übernimmt `code --reuse-window <ordner>` — der Sprung klappt also immer,
  solange VS Code auf dem `PATH` liegt.
- **Unten das Nutzungslimit**: 5-Stunden-Fenster, Woche und modellbezogene
  Wochenlimits als Balken. Beim Darüberfahren steht der Reset-Zeitpunkt.
  Ab 75 % wird der Balken gelb, ab 90 % rot.
- **Ziehen** am Kopf verschiebt das Overlay, Ränder ziehen ändert die Größe —
  beides wird in `overlay/position.json` gemerkt. Liegt die gemerkte Position
  auf einem inzwischen abgesteckten Monitor, springt das Fenster zurück an den
  rechten Rand des Hauptbildschirms.
- **⧉** öffnet das große Dashboard im Standardbrowser, **✕** schließt das Overlay.
- Kein Eintrag in der Taskleiste, kein Fokusklau beim Start.

Setzt voraus, dass `start.cmd` bereits läuft. Die Fensterebene ist bewusst
`floating`: über normalen Programmen, aber nicht über Vollbild-Videos — höhere
Stufen flackern dort.

> Läuft `overlay.cmd` aus einem VS-Code-Terminal, muss `ELECTRON_RUN_AS_NODE`
> geleert werden, sonst startet Electron als reines Node und öffnet kein Fenster.
> `overlay.cmd` erledigt das selbst.

## Einstellungen

Im Dashboard oben rechts auf **⚙ Einstellungen** (`/settings`). Dort lässt sich:

- das **Overlay starten und beenden** — der Server verwaltet den Electron-Prozess,
  du brauchst dafür keine Kommandozeile;
- die **Steht-Schwelle** ändern (ab wann Gelb auf Rot kippt);
- die **Schonfrist** für vergessene Sessions ändern;
- **Takt** und **Port** ändern — beides wirkt erst nach einem Neustart des Servers,
  was die Seite auch dazuschreibt.

Die ersten beiden Werte wirken sofort. Gespeichert wird in `config.json`, wobei
Token und VAPID-Schlüssel unangetastet bleiben: der Einstellungsbereich nimmt
ausschließlich die Felder an, die er selbst kennt.

## Handy-Zugriff

`tunnel.cmd` starten. Es öffnet einen Cloudflare-Quick-Tunnel und zeigt einen
**QR-Code** mit der vollständigen Adresse inklusive Token — am Handy scannen, fertig.

> ⚠️ Die `trycloudflare.com`-Adresse ist **öffentlich erreichbar**. Der einzige
> Schutz ist das Token in der URL. Nicht weitergeben, nicht in Chats posten.
> Bei jedem Neustart des Tunnels gibt es eine neue Adresse.

Kein Cloudflare-Konto nötig. Wer eine feste Adresse und echte Zugangskontrolle
will, richtet stattdessen einen benannten Tunnel mit Cloudflare Access ein
(`cloudflared tunnel login`) und trägt Port 4317 als Ziel ein.

Am Handy entfällt der **Fenster**-Knopf — der Rechner steht woanders.

### Benachrichtigung bei Rot

Über den Tunnel (HTTPS) erscheint oben ein **🔔 Benachrichtigen**-Knopf.
Einmal antippen, Erlaubnis erteilen — danach kommt eine Push-Nachricht, sobald
eine Session auf Rot springt, auch bei geschlossenem Browser.

- Gemeldet wird nur der **Übergang** nach Rot, nicht jeder Takt.
- Ebenso kommt eine Meldung, wenn das **Fünf-Stunden-Fenster 90 % erreicht** —
  einmal je Fenster, mit der verbleibenden Zeit bis zur Zurücksetzung. Die
  Schwelle ist dieselbe, ab der der Balken rot wird.
- Pro Session gilt danach 5 Minuten Ruhe, damit eine flackernde Session nicht dauerklingelt.
- **iPhone:** Web-Push funktioniert erst, wenn die Seite über *Teilen → Zum Home-Bildschirm*
  installiert wurde. Danach die App vom Home-Bildschirm öffnen und dort den Knopf antippen.
- Über nacktes `http://` im WLAN bleibt der Knopf aus — Push verlangt einen sicheren Kontext.

## Vergessene Sessions

Sessions, deren Transkript Claude Code bereits aufgeräumt hat und die sich seit
mindestens 10 Minuten nicht gemeldet haben, werden **nicht als Kachel gezeigt** —
sie doppeln sonst nur ihr lebendiges Geschwister im selben Projekt, ohne etwas
beizutragen. Sie stehen namentlich in der Fußzeile, damit nichts stillschweigend
verschwindet. Ein einziges Hook-Ereignis holt so eine Session sofort zurück.

## Genauigkeit: Hooks

Ohne Hooks leitet die Ampel den Status aus der Transkriptdatei ab. Das erkennt
zuverlässig „läuft" und „fertig", aber **nicht** den Unterschied zwischen
„Claude denkt nach" und „Claude wartet auf deine Freigabe". Solche Sessions sind
mit `≈` markiert.

Für die präzise Ampel den Inhalt von `hooks-snippet.json` in
`~/.claude/settings.json` einfügen. Claude Code lädt die Datei im laufenden
Betrieb neu — die Hooks greifen sofort, auch in bereits offenen Sessions.

## Konfiguration

`config.json` wird beim ersten Start angelegt und enthält **Token und privaten
VAPID-Schlüssel** — nicht weitergeben, nicht einchecken (steht in `.gitignore`).

```json
{
  "port": 4317,
  "scanIntervalMs": 2000,
  "stallSeconds": 300,
  "orphanAfterMinutes": 10
}
```

`stallSeconds` ist die Schwelle, ab der eine gelbe Kachel ohne Lebenszeichen auf
Rot kippt. `orphanAfterMinutes` ist die Schonfrist, bevor eine Session ohne
Transkript als vergessen gilt.

## Wie es funktioniert

- **Entdeckung**: `~/.claude/sessions/<pid>.json` — die Registry, die Claude Code
  selbst pflegt. Tote Einträge werden über `tasklist` aussortiert.
- **Ableitung**: Ende des Transkripts `~/.claude/projects/<slug>/<sessionId>.jsonl`.
  Buchhaltungseinträge (`attachment`, `ai-title`, `frame-link`, `atis-latch`) werden
  übersprungen; das Lesefenster wächst, bis ein echter Gesprächsschritt darin liegt.
  Ergebnisse werden über Größe und Zeitstempel zwischengespeichert — Transkripte
  werden zweistellige MB groß.
- **Hooks**: `hook.js` meldet `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
  `Notification`, `Stop`, `SessionStart`, `SessionEnd` an den Server.
- **Ports**: `Get-NetTCPConnection` + Kommandozeile des lauschenden Prozesses.
  Auf einem Port lauschen oft mehrere Prozesse — ihre Pfade werden vereinigt,
  weil bei `npm run dev` nur ein Geschwisterprozess den Projektpfad trägt.
  Home- und Laufwerksordner sind als Projekt ausgeschlossen, sonst zöge eine
  Session in `C:\Users\<Name>` jeden Port des Rechners an sich.
- **Fenster**: `EnumWindows` über alle VS-Code-Fenster. Zugeordnet wird über den
  Fenstertitel `<Claude-Titel> - <Projektordner> - Visual Studio Code`. Fenster
  werden **exklusiv** vergeben: erst die Sessions, die ihr Fenster über den Titel
  eindeutig treffen, danach dürfen die übrigen aus den freien raten.

- **Nutzungslimit**: `GET https://api.anthropic.com/api/oauth/usage` mit dem
  OAuth-Token aus `~/.claude/.credentials.json` — derselbe Endpunkt, den auch
  `/usage` im CLI benutzt. Der Token wird bei jedem Aufruf frisch gelesen, geht
  ausschließlich an `api.anthropic.com` und taucht weder im Protokoll noch in
  der Antwort dieses Servers auf. **Der Endpunkt ist nicht dokumentiert** und
  kann sich mit einer neuen Claude-Code-Version ändern; fällt er aus, bleibt
  die Anzeige einfach leer.

Die App **schreibt nichts** unter `~/.claude`. Sie liest nur.

## Verlässlichkeit des Hooks

`hook.js` läuft in jeder Session. Er beendet sich **immer** mit Exit-Code 0 und
leerer Ausgabe — auch wenn das Dashboard gar nicht läuft, das JSON kaputt ist
oder die Verbindung hängt (500 ms Zeitlimit). Ein abgestürztes Dashboard darf
niemals eine Claude-Session ausbremsen.

## Tests

```
node --test test/*.test.js
```
