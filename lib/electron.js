// Gemeinsame Kleinigkeiten, um Electron zu starten.
//
// Bisher standen beide Funktionen nur in server.js. Seit der Waechter das
// Overlay selbst am Leben haelt, braucht er sie auch.

import fs from 'node:fs';
import path from 'node:path';

/**
 * Pfad zur Electron-Binaerdatei.
 *
 * Bewusst NICHT der .cmd-Starter aus node_modules/.bin: Node weigert sich
 * seit einer Sicherheitsaenderung, .cmd-Dateien ohne Shell zu starten.
 *
 * @param {string} basis Projektordner
 * @returns {string|null}
 */
export function electronPfad(basis) {
  const wurzel = path.join(basis, 'node_modules', 'electron');
  try {
    const name = fs.readFileSync(path.join(wurzel, 'path.txt'), 'utf8').trim();
    const voll = path.join(wurzel, 'dist', name);
    return fs.existsSync(voll) ? voll : null;
  } catch {
    return null;
  }
}

/**
 * Umgebung ohne ELECTRON_RUN_AS_NODE.
 *
 * VS Code setzt die Variable in seinen Terminals. Bleibt sie stehen, laeuft
 * Electron als schlichtes Node und oeffnet nie ein Fenster. Sie auf ''
 * zu setzen genuegt unter Windows NICHT -- sie gilt dann weiterhin als
 * gesetzt. Sie muss weg.
 */
export function umgebungOhneNodeModus(env = process.env) {
  const kopie = { ...env };
  delete kopie.ELECTRON_RUN_AS_NODE;
  return kopie;
}
