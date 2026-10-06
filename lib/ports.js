// Ordnet lauschende localhost-Ports den Projektordnern zu.

import { runPowerShell, cached } from './shell.js';

const QUOTED = /"([^"]+)"/g;
const LOOKS_LIKE_PATH = /^[A-Za-z]:[\\/]/;

// Windows lauscht selbst auf einem guten Dutzend Ports (Hyper-V, WSD, AMT ...).
// Interessant sind nur Ports, hinter denen etwas Selbstgebautes steckt.
const DEV_RUNTIMES = /^(node|python\d*|pythonw|deno|bun|php|dotnet|ruby|java|go|caddy|nginx|httpd)(\.exe)?$/i;

/**
 * Kommandozeile und Prozessname je PID. Die aendern sich zu Lebzeiten eines
 * Prozesses nicht mehr -- gemerkt spart das die WMI-Abfrage in ports.ps1,
 * den mit Abstand teuersten Posten im Takt (690 ms gegen 88 ms).
 */
const merkzettel = new Map();
let letzteVollabfrage = 0;

// Windows vergibt PIDs wieder. Ein Eintrag wird zwar geloescht, sobald sein
// Port nicht mehr lauscht -- aber falls doch einmal etwas durchrutscht, ist
// der Merkzettel spaetestens nach einer Minute wieder frisch.
const VOLLABFRAGE_ALLE_MS = 60_000;

export const listPorts = cached(async () => {
  const vollstaendig = Date.now() - letzteVollabfrage >= VOLLABFRAGE_ALLE_MS;
  const bekannt = vollstaendig ? '' : [...merkzettel.keys()].join(',');

  const rows = await runPowerShell('ports.ps1', [bekannt]);
  if (!Array.isArray(rows)) return mergeByPort([]);
  if (vollstaendig) {
    letzteVollabfrage = Date.now();
    merkzettel.clear();
  }

  return mergeByPort(ergaenzen(rows));
}, 15000);

/**
 * Fuellt die Zeilen auf, fuer die ports.ps1 nichts nachgeschlagen hat, und
 * wirft aus dem Merkzettel, was nicht mehr lauscht.
 */
export function ergaenzen(rows, zettel = merkzettel) {
  const lebend = new Set();
  const voll = [];

  for (const r of rows) {
    if (!Number.isInteger(r?.pid)) continue;
    lebend.add(r.pid);

    if ('cmd' in r) {
      zettel.set(r.pid, { process: r.process ?? null, cmd: r.cmd ?? null });
      voll.push(r);
      continue;
    }

    const gemerkt = zettel.get(r.pid);
    // Kein Eintrag heisst: ports.ps1 wurde nach dieser PID nicht gefragt, wir
    // wissen aber auch nichts. Die Zeile taugt dann nicht zur Zuordnung.
    if (!gemerkt) continue;
    voll.push({ ...r, process: gemerkt.process, cmd: gemerkt.cmd });
  }

  for (const pid of zettel.keys()) if (!lebend.has(pid)) zettel.delete(pid);

  return voll;
}

/**
 * Fasst alle Prozesse zusammen, die auf demselben Port lauschen, und vereinigt
 * ihre Pfade. Wichtig, weil bei "npm run dev" der lauschende Prozess ein
 * Wrapper ohne Projektpfad sein kann, ein Geschwisterprozess ihn aber traegt.
 */
export function mergeByPort(rows) {
  const byPort = new Map();
  for (const r of rows) {
    if (!Number.isInteger(r?.port)) continue;
    const eintrag = byPort.get(r.port) ?? { port: r.port, pid: r.pid, process: null, paths: [] };
    // Als Prozessname den ersten nehmen, der nach einer Laufzeitumgebung aussieht.
    if (!eintrag.process || (DEV_RUNTIMES.test(r.process ?? '') && !DEV_RUNTIMES.test(eintrag.process))) {
      eintrag.process = r.process ?? eintrag.process;
      eintrag.pid = r.pid;
    }
    for (const p of extractPaths(r.cmd)) if (!eintrag.paths.includes(p)) eintrag.paths.push(p);
    byPort.set(r.port, eintrag);
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

/**
 * Alle Windows-Pfade aus einer Kommandozeile, normalisiert auf Backslash + Kleinschreibung.
 * Zwei Durchgaenge, weil Pfade mit Leerzeichen in Anfuehrungszeichen stehen,
 * mehrere Pfade in einer Zeile aber durch Leerzeichen getrennt sind.
 */
export function extractPaths(cmd) {
  if (typeof cmd !== 'string') return [];

  const found = [];
  const rest = cmd.replace(QUOTED, (_, inner) => {
    if (LOOKS_LIKE_PATH.test(inner)) found.push(inner);
    return ' ';
  });
  for (const token of rest.split(/\s+/)) {
    const clean = token.replace(/[;,|]+$/, '');
    if (LOOKS_LIKE_PATH.test(clean)) found.push(clean);
  }

  return [...new Set(found.map((p) => p.replace(/\//g, '\\').trim().toLowerCase()))];
}

/**
 * Ports, die zu diesem Projektordner gehoeren.
 * Ein Port zaehlt dazu, wenn in der Kommandozeile seines Prozesses ein Pfad
 * unterhalb des Projektordners vorkommt -- so trifft es Next, Vite, python -m http.server
 * mit --directory und alles andere, was seinen Pfad mitschleppt.
 */
export function portsForCwd(ports, cwd) {
  if (!cwd || isTooBroad(cwd)) return [];
  const needle = cwd.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '');
  if (!needle) return [];
  return ports
    .filter((p) => p.paths.some((candidate) => candidate === needle || candidate.startsWith(needle + '\\')))
    .map((p) => p.port)
    .sort((a, b) => a - b);
}

/**
 * Ein Laufwerks- oder Benutzerprofil-Ordner ist kein Projekt. Wuerde man ihn
 * zulassen, saugte eine Session mit cwd C:\Users\Name jeden Port des Rechners
 * an sich -- inklusive der internen Ports von VS Code.
 */
export function isTooBroad(cwd) {
  const p = cwd.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '');
  const teile = p.split('\\').filter(Boolean);
  if (teile.length <= 1) return true; // c:\ oder c:
  // c:\users\<name> -- aber c:\users\<name>\projekt ist in Ordnung.
  if (teile.length === 3 && teile[1] === 'users') return true;
  return false;
}


/** Ports, die keinem der uebergebenen Projektordner zugeordnet werden konnten. */
export function unmatchedPorts(ports, cwds, { ignore = [] } = {}) {
  const claimed = new Set(ignore);
  for (const cwd of cwds) for (const port of portsForCwd(ports, cwd)) claimed.add(port);
  return ports
    .filter((p) => !claimed.has(p.port) && DEV_RUNTIMES.test(p.process ?? ''))
    .map((p) => ({ port: p.port, process: p.process }))
    .sort((a, b) => a.port - b.port);
}
