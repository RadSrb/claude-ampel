// Entscheidet, wann das Overlay einen Ton spielt.
//
// Geklingelt wird nur, wenn eine Session NEU auf "braucht dich" oder "fragt
// dich" springt -- nicht bei jedem Takt, solange sie dort steht, und nicht
// beim Start fuer Sessions, die schon vorher rot waren.
//
// CommonJS, weil das Preload des Overlays sie mit require() holt und die
// Tests sie als ESM importieren.

// Nur diese beiden warten auf eine Antwort. "Limit" und "steht" sind zwar
// auch rot, dort kann man aber nichts beantworten.
const TON_ZUSTAENDE = new Set(['attention', 'question']);

// Mehrere Sessions kurz hintereinander geben einen Ton, keinen Dauerton.
const MINDESTABSTAND_MS = 3000;

/**
 * Vergleicht den neuen Stand mit dem gemerkten.
 *
 * @param {Record<string, string>|null} vorher sessionId -> status vom letzten
 *   Stand; null beim ersten Stand nach dem Laden
 * @param {{updatedAt?: number, sessions?: Array<{sessionId: string, status: string}>}} snapshot
 *   Momentaufnahme vom Server
 * @param {number} jetzt Zeitstempel in ms
 * @param {number|null} letzterTon Zeitstempel des letzten Tons in ms
 * @returns {{spielen: boolean, stand: Record<string, string>|null}} stand ist
 *   das neue vorher fuer den naechsten Aufruf
 */
function tonFaellig(vorher, snapshot, jetzt, letzterTon) {
  // updatedAt 0: der Server hat nach seinem Start noch nicht gescannt. Die
  // leere Liste ist kein echter Stand -- sonst taeuchten danach alle roten
  // Sessions als "neu" auf und es klingelte beim Start.
  if (!snapshot?.updatedAt) return { spielen: false, stand: vorher };

  const stand = {};
  for (const s of snapshot.sessions ?? []) {
    if (s?.sessionId) stand[s.sessionId] = s.status;
  }

  // Erster Stand: was schon rot ist, hat man beim Start ohnehin vor Augen.
  if (!vorher) return { spielen: false, stand };

  // Neu ist auch eine Session, die nach dem Start gleich rot auftaucht.
  // Ein Wechsel zwischen den beiden Ton-Zustaenden zaehlt nicht: gewartet
  // wurde schon vorher.
  const neuRot = Object.entries(stand).some(
    ([id, status]) => TON_ZUSTAENDE.has(status) && !TON_ZUSTAENDE.has(vorher[id]),
  );
  const zuFrueh = letzterTon != null && jetzt - letzterTon < MINDESTABSTAND_MS;
  return { spielen: neuRot && !zuFrueh, stand };
}

module.exports = { TON_ZUSTAENDE, MINDESTABSTAND_MS, tonFaellig };
