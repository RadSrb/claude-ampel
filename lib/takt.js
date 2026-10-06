// Zwei kleine Bausteine fuer den Takt des Servers. Bewusst ohne Abhaengigkeit
// zum Server selbst, damit sie pruefbar sind.

/**
 * Macht aus fn eine Funktion, die nie zweimal gleichzeitig laeuft. Aufrufe
 * waehrend eines Laufs werden zu genau einem Nachlauf zusammengefasst --
 * zehn Hooks in einer Sekunde kosten dann einen Scan, nicht zehn.
 *
 * @param {() => Promise<void>} fn
 * @param {(err: unknown) => void} [beiFehler]
 */
export function einzelflug(fn, beiFehler = () => {}) {
  let laeuft = null;
  let nochmal = false;

  const lauf = async () => {
    do {
      nochmal = false;
      try {
        await fn();
      } catch (err) {
        // Ein misslungener Lauf darf den Takt nicht anhalten.
        beiFehler(err);
      }
    } while (nochmal);
  };

  return () => {
    if (laeuft) {
      nochmal = true;
      return laeuft;
    }
    laeuft = lauf().finally(() => {
      laeuft = null;
    });
    return laeuft;
  };
}

// Felder, die sich bewegen, ohne dass eine Oberflaeche sie anzeigt: updatedAt
// laeuft bei jedem Takt weiter, lastActivity bei jedem Schreibvorgang einer
// arbeitenden Session. Im gesendeten Paket bleiben beide enthalten.
const NUR_UHR = new Set(['updatedAt', 'lastActivity']);

/**
 * Entscheidet, ob eine Momentaufnahme an die Oberflaechen gehen muss.
 * Verglichen wird ohne die Felder aus NUR_UHR -- sonst saehe jede
 * Momentaufnahme neu aus und es wuerde immer gesendet.
 *
 * @returns {string|null} der neue Vergleichswert, oder null wenn nichts zu senden ist
 */
export function sendenswert(snapshot, letzterKern) {
  const kern = JSON.stringify(snapshot, (schluessel, wert) => (NUR_UHR.has(schluessel) ? undefined : wert));
  return kern === letzterKern ? null : kern;
}
