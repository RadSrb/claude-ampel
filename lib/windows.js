// Findet das VS-Code-Fenster zu einer Session und holt es in den Vordergrund.
//
// VS-Code-Fenstertitel haben die Form
//   "<Claude-Titel> - <Projektordner> - Visual Studio Code"
// wobei der Claude-Titel bei Bedarf mit "…" gekuerzt wird. Deshalb wird
// zuerst ueber den Titel gematcht (trifft das exakte Fenster, auch wenn
// mehrere Sessions im selben Ordner laufen) und erst danach ueber den Ordner.

import { execFile } from 'node:child_process';

import { runPowerShell, cached } from './shell.js';

export const listWindows = cached(async () => {
  const rows = await runPowerShell('windows.ps1', ['list']);
  return Array.isArray(rows) ? rows : [];
}, 4000);

export async function focusWindow(hwnd) {
  const res = await runPowerShell('windows.ps1', ['focus', String(hwnd)], 5000);
  return Boolean(res?.ok);
}

/**
 * Rueckfallweg, wenn kein Fenster eindeutig zugeordnet werden konnte:
 * `code <ordner>` holt das VS-Code-Fenster nach vorn, in dem dieser Ordner
 * bereits offen ist. Ist er nirgends offen, geht ein neues Fenster auf --
 * besser als ein toter Knopf.
 */
export function focusViaCode(cwd) {
  return new Promise((resolve) => {
    if (!cwd) return resolve(false);
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
 */
export function assignWindows(rows, windows) {
  const vergeben = new Set();
  const ergebnis = new Map();

  for (const row of rows) {
    if (!row.title) continue;
    const treffer = windows.filter((w) => !vergeben.has(w.hwnd) && titleMatches(w.title, row.title));
    if (treffer.length === 1) {
      vergeben.add(treffer[0].hwnd);
      ergebnis.set(row.sessionId, treffer[0]);
    }
  }

  for (const row of rows) {
    if (ergebnis.has(row.sessionId) || !row.folder) continue;
    const frei = windows.filter((w) => !vergeben.has(w.hwnd) && folderMatches(w.title, row.folder));
    if (frei.length) {
      vergeben.add(frei[0].hwnd);
      ergebnis.set(row.sessionId, frei[0]);
    }
  }

  return ergebnis;
}
