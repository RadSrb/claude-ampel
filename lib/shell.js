// Kleiner Helfer, um die PowerShell-Skripte aufzurufen, ohne dass ein Fehler
// dort das Dashboard umbringt. Ergebnisse werden kurz zwischengespeichert,
// damit der 2-Sekunden-Takt nicht dauernd PowerShell startet.
//
// Die Aufrufe laufen ueber einen Dauerlaeufer (host.ps1) statt ueber einen
// frischen powershell.exe je Aufruf: der Prozessstart kostet ~160 ms, der
// Add-Type-Block in windows.ps1 nochmal ~100-230 ms. Beides faellt jetzt
// einmal an statt jedes Mal.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const ANTWORT = /^##AMPEL##(-?\d+)##(.*)$/;

// Ein einziger Aufraeumer fuer alle Dauerlaeufer. Ein Handler je Start wuerde
// sich bei jedem Neustart anhaeufen, bis Node vor zu vielen Zuhoerern warnt.
const laufende = new Set();
process.once('exit', () => {
  for (const proc of laufende) proc.kill();
});

/**
 * Ein Dauerlaeufer. Er arbeitet seine Auftraege der Reihe nach ab -- deshalb
 * gibt es zwei davon: waehrend die Abfragespur ihre knappe halbe Sekunde
 * Ports einsammelt, darf ein Knopfdruck nicht dahinter warten muessen.
 */
class Arbeiter {
  constructor() {
    this.proc = null;
    this.offen = new Map();
    this.naechsteId = 1;
  }

  starten() {
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'host.ps1')],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
    );
    proc.stdout.setEncoding('utf8');
    // Eigener Lesepuffer je Prozess. Ein gemeinsamer koennte von einem
    // Nachzuegler des weggeworfenen Laeufers verunreinigt werden.
    let rest = '';
    proc.stdout.on('data', (stueck) => {
      if (proc !== this.proc) return;
      rest = this.aufnehmen(rest + stueck);
    });
    proc.once('exit', () => this.wegwerfen(proc));
    proc.once('error', () => this.wegwerfen(proc));
    proc.stdin.on('error', () => {
      /* Leitung zu -- das 'exit'-Ereignis raeumt gleich auf. */
    });
    // Ohne unref haengt der Node-Prozess am Dauerlaeufer und beendet sich nie.
    // Solange Auftraege offen sind, wird wieder ref-t -- sonst faellt Node aus
    // dem Ereignisreigen, bevor die Antwort da ist.
    this.ruhen(proc);
    laufende.add(proc);
    proc.once('exit', () => laufende.delete(proc));
    this.proc = proc;
    return proc;
  }

  /** Haelt Node wach, solange etwas unterwegs ist -- und laesst sonst los. */
  ruhen(proc) {
    const wach = this.offen.size > 0;
    for (const teil of [proc, proc.stdout, proc.stdin]) {
      if (wach) teil.ref?.();
      else teil.unref?.();
    }
  }

  /** Arbeitet alle vollstaendigen Zeilen ab und gibt den angebrochenen Rest zurueck. */
  aufnehmen(puffer) {
    let bruch;
    while ((bruch = puffer.indexOf('\n')) !== -1) {
      const zeile = puffer.slice(0, bruch).trim();
      puffer = puffer.slice(bruch + 1);
      const treffer = ANTWORT.exec(zeile);
      if (!treffer) continue;
      const auftrag = this.offen.get(Number(treffer[1]));
      if (!auftrag) continue;
      this.offen.delete(Number(treffer[1]));
      clearTimeout(auftrag.wecker);
      auftrag.fertig(treffer[2]);
      if (this.proc) this.ruhen(this.proc);
    }
    return puffer;
  }

  /** Prozess ist weg oder haengt: alle Wartenden loesen, beim naechsten Mal neu starten. */
  wegwerfen(proc) {
    if (proc !== this.proc) return;
    this.proc = null;
    try {
      proc.kill();
    } catch {
      /* war schon tot */
    }
    for (const auftrag of this.offen.values()) {
      clearTimeout(auftrag.wecker);
      auftrag.fertig('');
    }
    this.offen.clear();
  }

  ausfuehren(script, args, timeout) {
    if (!this.proc) this.starten();
    const proc = this.proc;
    const id = this.naechsteId++;

    return new Promise((resolve) => {
      const fertig = (payload) => resolve(payload);
      const wecker = setTimeout(() => {
        // Ein Auftrag, der nicht antwortet, blockiert alle dahinter. Deshalb
        // wird der ganze Dauerlaeufer weggeworfen statt nur dieser Auftrag.
        this.wegwerfen(proc);
      }, timeout);
      wecker.unref?.();
      this.offen.set(id, { fertig, wecker });
      this.ruhen(proc);

      try {
        proc.stdin.write(`${JSON.stringify({ id, script, args })}\n`);
      } catch {
        this.wegwerfen(proc);
      }
    });
  }
}

const spuren = new Map();

function spur(name) {
  let a = spuren.get(name);
  if (!a) {
    a = new Arbeiter();
    spuren.set(name, a);
  }
  return a;
}

/**
 * @param {string} script Dateiname des Skripts in diesem Ordner
 * @param {string[]} args
 * @param {{timeout?: number, spur?: 'abfrage'|'aktion'}} opt
 *   `spur: 'aktion'` fuer alles, was ein Mensch gerade angeklickt hat -- das
 *   landet auf einem eigenen Dauerlaeufer und wartet nicht hinter dem Takt.
 */
export function runPowerShell(script, args = [], { timeout = 10000, spur: name = 'abfrage' } = {}) {
  return spur(name)
    .ausfuehren(script, args, timeout)
    .then((payload) => {
      if (!payload) return null;
      try {
        return JSON.parse(payload);
      } catch {
        return null;
      }
    });
}

/**
 * Beendet alle Dauerlaeufer, die gerade nichts zu tun haben. Fuer Aufrufer,
 * die PowerShell nur selten brauchen: ein wartender Dauerlaeufer haelt sonst
 * dauerhaft rund 80 MB fest. Der naechste Auftrag startet ihn neu.
 *
 * @returns {number[]} PIDs der entlassenen Prozesse
 */
export function entlassen() {
  const pids = [];
  for (const a of spuren.values()) {
    if (!a.proc || a.offen.size > 0) continue;
    const proc = a.proc;
    // Erst vergessen, dann schliessen -- so startet ein Auftrag, der genau
    // jetzt kommt, einen frischen Laeufer statt in die zugehende Leitung zu schreiben.
    a.proc = null;
    proc.stdin.end();
    pids.push(proc.pid);
  }
  return pids;
}

/**
 * Startet die Dauerlaeufer, bevor sie gebraucht werden, und laesst jeden
 * einmal windows.ps1 laufen. Ohne das zahlt der erste Knopfdruck nach dem
 * Serverstart den PowerShell-Start UND die Add-Type-Uebersetzung -- zusammen
 * rund 400 ms, und zwar ausgerechnet beim ersten Mal.
 */
export function vorwaermen() {
  for (const name of ['abfrage', 'aktion']) {
    runPowerShell('windows.ps1', ['list'], { spur: name }).catch(() => {
      /* Vorwaermen ist Beiwerk -- scheitert es, kostet der erste Klick eben mehr. */
    });
  }
}

/**
 * Ruft fn hoechstens alle ttlMs erneut auf und liefert sonst den letzten Wert.
 *
 * `vergessen()` wirft den gemerkten Wert weg. Noetig, wenn der Aufrufer selbst
 * gerade das veraendert hat, was hier zwischengespeichert liegt -- sonst
 * antwortet der Speicher noch aus der Zeit davor.
 */
export function cached(fn, ttlMs) {
  let value = null;
  let at = 0;
  let inflight = null;
  // Zaehlt bei jedem vergessen() hoch. Ein Abruf, der vor dem Vergessen
  // losgeschickt wurde, erkennt daran, dass sein Ergebnis veraltet ist, und
  // schreibt den geleerten Speicher nicht wieder voll.
  let stand = 0;

  const holen = async () => {
    if (at && Date.now() - at < ttlMs) return value;
    if (inflight) return inflight;
    const meiner = stand;
    inflight = fn()
      .then((v) => {
        if (v !== null && meiner === stand) {
          value = v;
          at = Date.now();
        }
        return v !== null ? v : value;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  holen.vergessen = () => {
    stand++;
    value = null;
    at = 0;
    inflight = null;
  };

  return holen;
}
