// Kleiner Helfer, um die PowerShell-Skripte aufzurufen, ohne dass ein Fehler
// dort das Dashboard umbringt. Ergebnisse werden kurz zwischengespeichert,
// damit der 2-Sekunden-Takt nicht dauernd PowerShell startet.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function runPowerShell(script, args = [], timeout = 10000) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, script), ...args],
      { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) return resolve(null);
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(null);
        }
      },
    );
  });
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
