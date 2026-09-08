// Entscheidet, ob der Server nach einem Ende neu gestartet wird.
// Bewusst als reine Funktion, damit die Regeln pruefbar sind, ohne
// tatsaechlich Prozesse zu starten.

// Der Server beendet sich mit diesem Code, wenn der Port belegt ist.
// Das ist kein Absturz, sondern eine Ansage -- ein Neustart wuerde nur
// in einer Endlosschleife enden.
export const CODE_PORT_BELEGT = 3;

// Ein Start, der so schnell wieder endet, hat nie richtig gelaufen.
export const FEHLSTART_MS = 5000;
export const MAX_FEHLSTARTS = 5;

/**
 * @param {object} lage
 * @param {number|null} lage.code       Exit-Code des Servers
 * @param {string|null} [lage.signal]   Signal, falls beendet
 * @param {number} lage.laufzeitMs      wie lange der Server lief
 * @param {number} lage.fehlstarts      bisherige kurze Laeufe in Folge
 * @param {boolean} [lage.beendet]      Wir selbst fahren herunter
 */
export function neustartEntscheidung(lage) {
  const { code, laufzeitMs, fehlstarts } = lage;

  if (lage.beendet) {
    return { neustart: false, wartenMs: 0, grund: 'Wird heruntergefahren.' };
  }

  if (code === CODE_PORT_BELEGT) {
    return { neustart: false, wartenMs: 0, grund: 'Port belegt -- laeuft der Server schon?' };
  }

  const kurz = laufzeitMs < FEHLSTART_MS;
  const zaehler = kurz ? fehlstarts + 1 : 0;

  if (zaehler >= MAX_FEHLSTARTS) {
    return {
      neustart: false,
      wartenMs: 0,
      fehlstarts: zaehler,
      grund: `${zaehler} Fehlstarts hintereinander -- gebe auf, bitte Log ansehen.`,
    };
  }

  // Nach einem sauberen langen Lauf sofort wieder hoch, nach einem
  // Fehlstart mit wachsendem Abstand.
  const wartenMs = kurz ? Math.min(1000 * 2 ** zaehler, 30000) : 1000;
  return {
    neustart: true,
    wartenMs,
    fehlstarts: zaehler,
    grund: kurz ? `Fehlstart ${zaehler} nach ${laufzeitMs} ms.` : 'Server beendet.',
  };
}
