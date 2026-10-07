// Die Aufgabenplanung startet ihre Aufgaben mit Prioritaet 7 -- das ist
// "BelowNormal", und Watchdog, Server, Overlay und die PowerShell-Spur erben
// das. Laufen nebenher Builds oder mehrere Claude-Sessions, bekam der Server
// so minutenlang keine Rechenzeit: gemessen bis 295 s Stillstand. Ein Klick
// im Overlay holte das Fenster dann erst Minuten spaeter -- oder scheinbar nie.

import os from 'node:os';

const { PRIORITY_NORMAL } = os.constants.priority;

/**
 * Hebt den eigenen Prozess auf normale Prioritaet, falls er darunter laeuft.
 * Hoeher geht es nie -- die Ampel soll mithalten, nicht vordraengeln.
 *
 * @returns {boolean} ob angehoben wurde
 */
export function normalePrioritaet({ lesen = os.getPriority, setzen = os.setPriority } = {}) {
  try {
    // Groessere Zahl heisst niedrigere Prioritaet.
    if (lesen(0) <= PRIORITY_NORMAL) return false;
    setzen(0, PRIORITY_NORMAL);
    return true;
  } catch {
    // Verweigert -- dann eben mit der geerbten Prioritaet weiter.
    return false;
  }
}
