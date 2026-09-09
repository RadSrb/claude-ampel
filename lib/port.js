// Prueft, ob auf einem Port bereits jemand lauscht.
//
// Der Waechter braucht das, bevor er irgendetwas startet: die Aufgabenplanung
// ruft ihn alle zwei Minuten auf, und im Normalfall laeuft die Ampel laengst.
// Frueher startete er dafuer jedes Mal einen Server, liess ihn an EADDRINUSE
// scheitern und schrieb drei Zeilen ins Log -- rund 2000 Zeilen Rauschen am
// Tag, in denen die etwa zehn echten Ereignisse untergingen.

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>} true, wenn der Port belegt ist
 */
export function portBelegt(port, host = '127.0.0.1') {
  return new Promise((fertig) => {
    const probe = net.createServer();

    probe.once('error', (err) => {
      // EADDRINUSE heisst belegt. Alles andere (z. B. EACCES) ist kein Beweis
      // fuer eine laufende Ampel -- dann lieber starten und es versuchen.
      fertig(err && err.code === 'EADDRINUSE');
    });

    probe.once('listening', () => probe.close(() => fertig(false)));
    probe.listen(port, host);
  });
}

/**
 * Port aus der config.json, mit Rueckfallwert.
 * @param {string} basis Projektordner
 */
export function portAusConfig(basis, standard = 4317) {
  try {
    const roh = JSON.parse(fs.readFileSync(path.join(basis, 'config.json'), 'utf8'));
    return Number.isInteger(roh.port) && roh.port > 0 ? roh.port : standard;
  } catch {
    return standard;
  }
}
