// Findet das VS-Code-Fenster zu einer Session und holt es in den Vordergrund.
//
// VS-Code-Fenstertitel haben die Form
//   "<Claude-Titel> - <Projektordner> - Visual Studio Code"
// wobei der Claude-Titel bei Bedarf mit "…" gekuerzt wird. Deshalb wird
// zuerst ueber den Titel gematcht (trifft das exakte Fenster, auch wenn
// mehrere Sessions im selben Ordner laufen) und erst danach ueber den Ordner.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runPowerShell, cached } from './shell.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const listWindows = cached(async () => {
  const rows = await runPowerShell('windows.ps1', ['list']);
  return Array.isArray(rows) ? rows : [];
}, 8000);

/** `taste: false` holt das Fenster nur vor, ohne F13 in den Claude-Chat. */
export async function focusWindow(hwnd, { taste = true } = {}) {
  const res = await runPowerShell('windows.ps1', [taste ? 'focus' : 'vor', String(hwnd)], { timeout: 5000, spur: 'aktion' });
  return Boolean(res?.ok);
}

/**
 * Fuer Sessions im Terminal (Windows Terminal, conhost): deren Fenster ist
 * kein Editorfenster und taucht in listWindows nie auf. Gefunden wird es ueber
 * die Konsole des Claude-Prozesses.
 *
 * Bewusst ein eigener powershell.exe statt des Dauerlaeufers: dafuer haengt
 * sich der Prozess an die fremde Konsole und verliert seine eigene. Die PID
 * ist eine Zahl -- der Backslash-Verlust von "-File" spielt hier keine Rolle.
 *
 * Liefert die Antwort des Skripts ({ ok, hwnd } bzw. { ok: false, error })
 * oder null, wenn PowerShell gar nicht geantwortet hat (Zeitlimit, Absturz).
 * Der Unterschied zaehlt: "keine sichtbare konsole" ist eine sichere Auskunft,
 * null nur ein Fehlschlag, nach dem sich ein zweiter Versuch lohnt.
 */
export function focusConsole(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve({ ok: false, error: 'keine pid' });
  const argumente = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'windows.ps1'), 'konsole', String(pid)];
  return new Promise((resolve) => {
    execFile('powershell.exe', argumente, { windowsHide: true, timeout: 12000 }, (err, aus) => {
      try {
        resolve(err ? null : JSON.parse(String(aus).trim()));
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Rueckfallweg, wenn kein Fenster eindeutig zugeordnet werden konnte:
 * `code <ordner>` holt das VS-Code-Fenster nach vorn, in dem dieser Ordner
 * bereits offen ist. Ist er nirgends offen, geht ein neues Fenster auf --
 * besser als ein toter Knopf.
 *
 * Danach derselbe Schreibfokus wie beim direkten Weg: `code` kehrt sofort
 * zurueck, das Fenster kommt erst spaeter -- deshalb wartet die PowerShell-Seite
 * auf einen Editor im Vordergrund, bevor sie die Taste schickt.
 */
export async function focusViaCode(cwd) {
  if (!cwd) return false;
  const gestartet = await codeReuseWindow(cwd);
  if (!gestartet) return false;
  await runPowerShell('windows.ps1', ['typeforeground'], { timeout: 8000, spur: 'aktion' });
  return true;
}

function codeReuseWindow(cwd) {
  return new Promise((resolve) => {
    execFile('cmd', ['/c', 'code', '--reuse-window', cwd], { windowsHide: true, timeout: 8000 }, (err) => {
      resolve(!err);
    });
  });
}

const TRUNCATION = /[…\.]{1,3}$/;

function titleSegments(title) {
  return String(title ?? '')
    .split(' - ')
    .map((s) => s.trim());
}

/** Findet das passende Fenster. Gibt null zurueck, wenn nichts eindeutig passt. */
export function matchWindow(windows, { title, folder }) {
  const byTitle = title ? windows.filter((w) => titleMatches(w.title, title)) : [];
  if (byTitle.length === 1) return byTitle[0];

  // Mehrere Titeltreffer: der Ordner entscheidet.
  if (byTitle.length > 1 && folder) {
    const genauer = byTitle.filter((w) => folderMatches(w.title, folder));
    if (genauer.length === 1) return genauer[0];
  }

  if (!folder) return byTitle[0] ?? null;

  const byFolder = windows.filter((w) => folderMatches(w.title, folder));
  // Mehrere Fenster im selben Ordner sind nicht unterscheidbar -- das erste
  // ist besser als gar keins, die Oberflaeche sagt dazu, dass es mehrdeutig ist.
  return byFolder[0] ?? null;
}

function titleMatches(windowTitle, sessionTitle) {
  const first = titleSegments(windowTitle)[0];
  if (!first) return false;
  const stripped = first.replace(TRUNCATION, '').trim();
  if (!stripped) return false;
  const wanted = sessionTitle.trim();
  return wanted === first || wanted.toLowerCase().startsWith(stripped.toLowerCase());
}

function folderMatches(windowTitle, folder) {
  const segments = titleSegments(windowTitle);
  // Letztes Segment ist der Editorname, davor steht der Ordner.
  return segments.length >= 2 && segments[segments.length - 2].toLowerCase() === folder.toLowerCase();
}

export function isAmbiguous(windows, { folder }) {
  if (!folder) return false;
  return windows.filter((w) => folderMatches(w.title, folder)).length > 1;
}

/**
 * Verteilt die Fenster auf die Sessions -- jedes Fenster hoechstens einmal.
 *
 * Erst bekommen alle Sessions ihr Fenster, die es ueber den Claude-Titel
 * eindeutig treffen. Erst danach duerfen die uebrigen ueber den Ordner raten,
 * und nur noch aus den unbeanspruchten Fenstern. Sonst zeigt bei zwei Sessions
 * im selben Projekt der "Fenster"-Knopf der einen auf das Fenster der anderen.
 *
 * Sessions aus dem Terminal (art "terminal") haben ihr eigenes Fenster, siehe
 * focusConsole. Sie raten ganz zum Schluss und nur ueber den Ordner -- fuer
 * claude im Terminal eines Editors. Sonst schnappte eine cmd-Session einer
 * VS-Code-Session im selben Ordner das Fenster weg.
 */
export function assignWindows(rows, windows) {
  const vergeben = new Set();
  const ergebnis = new Map();
  const editor = rows.filter((r) => r.art !== 'terminal');
  const terminal = rows.filter((r) => r.art === 'terminal');

  for (const row of editor) {
    if (!row.title) continue;
    const treffer = windows.filter((w) => !vergeben.has(w.hwnd) && titleMatches(w.title, row.title));
    if (treffer.length === 1) {
      vergeben.add(treffer[0].hwnd);
      ergebnis.set(row.sessionId, treffer[0]);
    }
  }

  for (const row of [...editor, ...terminal]) {
    if (ergebnis.has(row.sessionId) || !row.folder) continue;
    const frei = windows.filter((w) => !vergeben.has(w.hwnd) && folderMatches(w.title, row.folder));
    if (frei.length) {
      vergeben.add(frei[0].hwnd);
      ergebnis.set(row.sessionId, frei[0]);
    }
  }

  return ergebnis;
}
