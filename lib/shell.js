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

/** Ruft fn hoechstens alle ttlMs erneut auf und liefert sonst den letzten Wert. */
export function cached(fn, ttlMs) {
  let value = null;
  let at = 0;
  let inflight = null;
  return async () => {
    if (Date.now() - at < ttlMs) return value;
    if (inflight) return inflight;
    inflight = fn()
      .then((v) => {
        if (v !== null) {
          value = v;
          at = Date.now();
        }
        return value;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}
