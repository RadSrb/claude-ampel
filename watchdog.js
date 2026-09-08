// Haelt server.js am Leben und schreibt mit, was er sagt.
//
// Der Server wurde bisher unsichtbar gestartet (VBS, Fensterstil 0). Stirbt
// er dabei, verschwindet auch seine letzte Fehlermeldung -- im Overlay steht
// dann nur noch "keine Verbindung", ohne jeden Hinweis auf das Warum.
//
//   node watchdog.js

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { overlaySucher } from './lib/overlay.js';
import { electronPfad, umgebungOhneNodeModus } from './lib/electron.js';
import { neustartEntscheidung } from './lib/watchdog-regel.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const LOGORDNER = path.join(HIER, 'logs');
const LOGDATEI = path.join(LOGORDNER, 'server.log');
const MAX_LOG = 2 * 1024 * 1024;

fs.mkdirSync(LOGORDNER, { recursive: true });

// Damit das Log nicht unbegrenzt waechst: der vorige Lauf bleibt als .1
// erhalten, alles davor faellt weg.
try {
  if (fs.statSync(LOGDATEI).size > MAX_LOG) {
    fs.renameSync(LOGDATEI, `${LOGDATEI}.1`);
  }
} catch {
  // Noch kein Log -- nichts zu drehen.
}

const log = fs.createWriteStream(LOGDATEI, { flags: 'a' });
// Ein Fehler auf dem Log-Stream wuerde als unbehandeltes "error"-Ereignis
// den ganzen Waechter beenden -- ausgerechnet den, der alles am Leben haelt.
log.on('error', () => {});

function zeitstempel() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} `
    + `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

/** Nimmt das Zugangstoken aus der Startmeldung -- Logs werden weitergereicht. */
function ohneToken(text) {
  return text.replace(/([?&]t=)[^ &]+/g, '$1***');
}

function notiere(text) {
  const zeile = `${zeitstempel()}  ${ohneToken(text)}
`;
  log.write(zeile);
  // Beim Start ueber die VBS geht stdout ins Leere -- schadet nicht.
  try {
    process.stdout.write(zeile);
  } catch {
    // Keine Konsole (Start ueber die VBS) -- das Log genuegt.
  }
}

/** Haengt an jede Zeile des Servers die Uhrzeit. */
function mitschreiben(strom, kennung) {
  let rest = '';
  strom.setEncoding('utf8');
  strom.on('data', (stueck) => {
    const zeilen = (rest + stueck).split('\n');
    rest = zeilen.pop() ?? '';
    for (const zeile of zeilen) if (zeile.trim()) notiere(`${kennung} ${zeile}`);
  });
  strom.on('end', () => {
    if (rest.trim()) notiere(`${kennung} ${rest}`);
  });
}

let kind = null;
let fehlstarts = 0;
let beendet = false;

function starte() {
  const start = Date.now();
  kind = spawn(process.execPath, ['server.js'], {
    cwd: HIER,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  notiere(`--- Server gestartet, PID ${kind.pid} ---`);

  // Erst nach drei Sekunden: ein Waechter, der wegen belegtem Ports gleich
  // wieder aussteigt, soll kein Overlay anfassen.
  setTimeout(() => {
    if (kind && kind.exitCode === null) aufsichtStarten();
  }, 3000).unref();
  mitschreiben(kind.stdout, ' ');
  mitschreiben(kind.stderr, '!');

  kind.on('exit', (code, signal) => {
    kind = null;
    const laufzeitMs = Date.now() - start;
    const ende = signal ? `Signal ${signal}` : `Code ${code | 0}`;
    notiere(`--- Server beendet (${ende}) nach ${Math.round(laufzeitMs / 1000)} s ---`);

    const urteil = neustartEntscheidung({ code, signal, laufzeitMs, fehlstarts, beendet });
    fehlstarts = urteil.fehlstarts ?? fehlstarts;
    notiere(urteil.grund);

    if (!urteil.neustart) {
      log.end();
      process.exit(code === 0 ? 0 : 1);
    }
    setTimeout(starte, urteil.wartenMs);
  });

  kind.on('error', (err) => notiere(`! Start fehlgeschlagen: ${err.message}`));
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    beendet = true;
    if (overlayKind && overlayKind.exitCode === null) overlayKind.kill();
    notiere('--- Waechter wird beendet ---');
    if (kind) kind.kill();
    setTimeout(() => process.exit(0), 500);
  });
}

function sofort(text) {
  try {
    fs.appendFileSync(LOGDATEI, `${zeitstempel()}  ${text}${os.EOL}`);
  } catch {
    // Wenn nicht einmal mehr das geht, ist ohnehin Schluss.
  }
}

// Zweimal sind Waechter und Server spurlos verschwunden: das Log endete mit
// einem sauberen Start und dann Stille. Ohne diese Handler kann der Waechter
// seinen eigenen Tod nicht melden -- genau das soll hier aufhoeren.
for (const art of ['uncaughtException', 'unhandledRejection']) {
  process.on(art, (fehler) => {
    sofort(`!!! ${art}: ${fehler instanceof Error ? fehler.stack : fehler}`);
    process.exit(1);
  });
}

process.on('exit', (code) => {
  // Faellt bei einem harten Abschuss von aussen (TerminateProcess) NICHT an.
  // Fehlt diese Zeile im Log, war es kein Fehler im Waechter selbst.
  sofort(`--- Waechter endet, Code ${code} ---`);
});

// --- Overlay am Leben halten ---------------------------------------------
//
// Bisher startete die VBS bei jeder Wiederholung der Aufgabe ein komplettes
// Electron, das die Einzelinstanz-Sperre nach vier Sekunden wieder beendete:
// alle zwei Minuten sechs Prozesse fuer nichts. Jetzt sorgt der Waechter
// dafuer -- und ein abgestuerztes Overlay ist in Sekunden zurueck statt erst
// beim naechsten Takt der Aufgabenplanung.

const overlaySuche = overlaySucher(HIER, 5000);
let overlayKind = null;
let fremdeOverlayPid = null;
let aufsichtLaeuft = false;

/** Billiger Existenztest -- 0,01 ms statt eines PowerShell-Starts. */
function lebt(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err) && err.code === "EPERM";
  }
}

async function overlaySichern() {
  if (overlayKind && overlayKind.exitCode === null) return;
  if (lebt(fremdeOverlayPid)) return;

  // Erst nachsehen, ob schon eins laeuft -- sonst startet der Waechter ein
  // zweites, das die Sperre sofort beendet, und versucht es endlos wieder.
  const gefunden = await overlaySuche();
  if (gefunden) {
    if (fremdeOverlayPid !== gefunden.pid) notiere(`Overlay laeuft bereits, PID ${gefunden.pid}`);
    fremdeOverlayPid = gefunden.pid;
    return;
  }
  fremdeOverlayPid = null;

  const electron = electronPfad(HIER);
  if (!electron) return notiere("! Electron nicht gefunden -- Overlay bleibt aus");

  overlayKind = spawn(electron, [path.join("overlay", "main.cjs")], {
    cwd: HIER,
    windowsHide: true,
    stdio: "ignore",
    env: umgebungOhneNodeModus(),
  });
  notiere(`Overlay gestartet, PID ${overlayKind.pid}`);
  overlayKind.on("error", (err) => notiere(`! Overlay-Start fehlgeschlagen: ${err.message}`));
}

/** Startet die Aufsicht, sobald der Server sich als der echte erwiesen hat. */
function aufsichtStarten() {
  if (aufsichtLaeuft) return;
  aufsichtLaeuft = true;
  const takt = () => overlaySichern().catch((err) => notiere(`! Overlay-Aufsicht: ${err.message}`));
  takt();
  setInterval(takt, 10000).unref();
}

starte();
