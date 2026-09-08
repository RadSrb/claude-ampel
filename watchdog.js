// Haelt server.js am Leben und schreibt mit, was er sagt.
//
// Der Server wurde bisher unsichtbar gestartet (VBS, Fensterstil 0). Stirbt
// er dabei, verschwindet auch seine letzte Fehlermeldung -- im Overlay steht
// dann nur noch "keine Verbindung", ohne jeden Hinweis auf das Warum.
//
//   node watchdog.js

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

function zeitstempel() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
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
  process.stdout.write(zeile);
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
    notiere('--- Waechter wird beendet ---');
    if (kind) kind.kill();
    setTimeout(() => process.exit(0), 500);
  });
}

starte();
