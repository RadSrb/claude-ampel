// Zugangstoken und VAPID-Schluessel. Werden beim ersten Start erzeugt und in
// config.json abgelegt, damit die Adresse fuers Handy stabil bleibt.

import fs from 'node:fs';
import crypto from 'node:crypto';
import webpush from 'web-push';

export function loadOrCreateSecrets(configPath, config) {
  let veraendert = false;
  const next = { ...config };

  if (typeof next.token !== 'string' || next.token.length < 24) {
    next.token = crypto.randomBytes(24).toString('base64url');
    veraendert = true;
  }

  if (!next.vapid?.publicKey || !next.vapid?.privateKey) {
    next.vapid = webpush.generateVAPIDKeys();
    veraendert = true;
  }

  if (veraendert) {
    // Nur die Datei anlegen/ergaenzen, nie den Rest der Konfiguration verwerfen.
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n');
    try {
      // Auf Windows kein echtes chmod, aber unter POSIX ist es das Richtige.
      fs.chmodSync(configPath, 0o600);
    } catch {
      /* nicht kritisch */
    }
  }

  return next;
}

/**
 * Zeitkonstanter Vergleich -- verhindert, dass jemand das Token ueber
 * Antwortzeiten Zeichen fuer Zeichen erraet.
 */
export function tokenGleich(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
