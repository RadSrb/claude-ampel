// Erkennt ein laufendes Overlay unabhaengig davon, wer es gestartet hat.
//
// Der Server merkte sich bisher nur seinen eigenen Kindprozess. Seit das
// Overlay ueber die Aufgabenplanung startet, kennt er es deshalb nicht mehr
// und meldete in den Einstellungen dauerhaft "nicht gestartet" -- obwohl es
// sichtbar auf dem Bildschirm lag.

import { runPowerShell, cached } from './shell.js';

/**
 * Waehlt aus der Prozessliste das Overlay dieses Projekts.
 *
 * Der Ordner wird hier gefiltert und nicht in overlay.ps1: Node uebergibt
 * Argumente an "powershell.exe -File" so, dass Backslashes verloren gehen.
 *
 * Aeltester Treffer statt erster: laeuft durch einen Fehlstart doch einmal
 * ein zweites Overlay, ist das langlebige das echte -- das junge gibt wegen
 * der Einzelinstanz-Sperre gleich wieder auf.
 *
 * @param {unknown} rohdaten Ausgabe von overlay.ps1
 * @param {string} basis Projektordner
 * @returns {{pid: number, seit: string|null}|null}
 */
export function ersterTreffer(rohdaten, basis) {
  // ConvertTo-Json liefert bei genau einem Treffer ein Objekt statt einer Liste.
  const liste = Array.isArray(rohdaten) ? rohdaten : rohdaten ? [rohdaten] : [];
  const suche = String(basis ?? '').toLowerCase();

  const gueltig = liste.filter(
    (p) =>
      p &&
      Number.isInteger(p.pid) &&
      p.pid > 0 &&
      typeof p.cmd === 'string' &&
      (!suche || p.cmd.toLowerCase().includes(suche)),
  );
  if (!gueltig.length) return null;

  const zeit = (p) => {
    const t = Date.parse(p.seit ?? '');
    return Number.isNaN(t) ? Infinity : t;
  };
  const gewaehlt = gueltig.reduce((a, b) => (zeit(b) < zeit(a) ? b : a));
  return { pid: gewaehlt.pid, seit: gewaehlt.seit ?? null };
}

/**
 * @param {string} basis Projektordner
 * @param {number} ttlMs
 */
export function overlaySucher(basis, ttlMs = 3000) {
  // Zwischenspeicher, weil die Einstellungsseite bei jedem Aufruf fragt und
  // ein PowerShell-Start teurer ist als die Antwort.
  return cached(async () => ersterTreffer(await runPowerShell('overlay.ps1'), basis), ttlMs);
}
