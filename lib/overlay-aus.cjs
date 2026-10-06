// Merkt sich, dass das Overlay absichtlich geschlossen wurde.
//
// Der Waechter holt ein fehlendes Overlay nach Sekunden zurueck -- gedacht fuer
// Abstuerze. Er konnte aber nicht unterscheiden, ob es abgestuerzt war oder ob
// man es mit dem Kreuz geschlossen hatte, und oeffnete es jedes Mal wieder.
// Diese Datei ist der Unterschied: liegt sie da, bleibt das Overlay zu, bis es
// von Hand wieder geoeffnet wird (Verknuepfung oder Einstellungen).
//
// CommonJS, weil sowohl overlay/main.cjs als auch die ESM-Module sie brauchen.

const fs = require('node:fs');
const path = require('node:path');

function merkdatei(basis) {
  return path.join(basis, 'overlay', 'geschlossen');
}

function overlayGeschlossen(basis) {
  return fs.existsSync(merkdatei(basis));
}

function overlaySchliessenMerken(basis) {
  try {
    fs.writeFileSync(merkdatei(basis), `${new Date().toISOString()}\n`);
  } catch {
    // Ohne Merkdatei kommt das Overlay eben wieder -- wie bisher.
  }
}

function overlayFreigeben(basis) {
  try {
    fs.rmSync(merkdatei(basis), { force: true });
  } catch {
    // Bleibt sie liegen, bleibt das Overlay zu -- naechster Versuch beim naechsten Start.
  }
}

module.exports = { merkdatei, overlayGeschlossen, overlaySchliessenMerken, overlayFreigeben };
