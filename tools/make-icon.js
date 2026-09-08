// Erzeugt public/icon.png (fuer die Weboberflaeche) und public/icon.ico
// (fuer die Windows-Verknuepfung) -- eine Ampel als Symbol.
// Minimaler PNG- und ICO-Schreiber, damit dafuer keine Bildbibliothek noetig ist.
//
//   node tools/make-icon.js

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GROESSE = Number(process.argv[2]) || 512;

const HINTERGRUND = [14, 17, 22];
const GEHAEUSE = [30, 35, 44];
const LAMPEN = [
  { y: 0.28, farbe: [242, 69, 61] },
  { y: 0.5, farbe: [245, 165, 36] },
  { y: 0.72, farbe: [46, 204, 113] },
];

const pixel = Buffer.alloc(GROESSE * GROESSE * 3);

function setze(x, y, [r, g, b]) {
  const i = (y * GROESSE + x) * 3;
  pixel[i] = r;
  pixel[i + 1] = g;
  pixel[i + 2] = b;
}

// Hintergrund
for (let y = 0; y < GROESSE; y++) for (let x = 0; x < GROESSE; x++) setze(x, y, HINTERGRUND);

// Gehaeuse mit runden Ecken
const links = Math.round(GROESSE * 0.3);
const rechts = Math.round(GROESSE * 0.7);
const oben = Math.round(GROESSE * 0.12);
const unten = Math.round(GROESSE * 0.88);
const radius = Math.round(GROESSE * 0.09);

for (let y = oben; y < unten; y++) {
  for (let x = links; x < rechts; x++) {
    const dx = Math.max(links + radius - x, x - (rechts - radius), 0);
    const dy = Math.max(oben + radius - y, y - (unten - radius), 0);
    if (dx * dx + dy * dy <= radius * radius) setze(x, y, GEHAEUSE);
  }
}

// Lampen
const lampenRadius = Math.round(GROESSE * 0.12);
for (const lampe of LAMPEN) {
  const cx = GROESSE / 2;
  const cy = GROESSE * lampe.y;
  for (let y = Math.floor(cy - lampenRadius); y <= Math.ceil(cy + lampenRadius); y++) {
    for (let x = Math.floor(cx - lampenRadius); x <= Math.ceil(cx + lampenRadius); x++) {
      if (x < 0 || y < 0 || x >= GROESSE || y >= GROESSE) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d <= lampenRadius) setze(x, y, lampe.farbe);
    }
  }
}

// PNG zusammensetzen: jede Zeile bekommt ein Filter-Byte 0 (kein Filter).
const roh = Buffer.alloc(GROESSE * (GROESSE * 3 + 1));
for (let y = 0; y < GROESSE; y++) {
  roh[y * (GROESSE * 3 + 1)] = 0;
  pixel.copy(roh, y * (GROESSE * 3 + 1) + 1, y * GROESSE * 3, (y + 1) * GROESSE * 3);
}

function chunk(typ, daten) {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length);
  const koerper = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(koerper) >>> 0);
  return Buffer.concat([laenge, koerper, crc]);
}

const CRC_TABELLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABELLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(GROESSE, 0);
ihdr.writeUInt32BE(GROESSE, 4);
ihdr[8] = 8; // Bittiefe
ihdr[9] = 2; // Farbtyp RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(roh, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const ziel = path.join(HERE, '..', 'public', `icon${GROESSE === 512 ? '' : GROESSE}.png`);
fs.writeFileSync(ziel, png);
console.log(`${ziel} geschrieben, ${png.length} Bytes`);

// Windows-Verknuepfungen brauchen .ico. Moderne Windows-Versionen akzeptieren
// ein PNG im ICO-Container; die Groessenbytes sind 0, was "256" bedeutet.
if (GROESSE === 256) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); // reserviert
  dir.writeUInt16LE(1, 2); // Typ 1 = Symbol
  dir.writeUInt16LE(1, 4); // ein Bild

  const eintrag = Buffer.alloc(16);
  eintrag[0] = 0; // Breite 0 = 256
  eintrag[1] = 0; // Hoehe 0 = 256
  eintrag[2] = 0; // keine Palette
  eintrag[3] = 0; // reserviert
  eintrag.writeUInt16LE(1, 4); // Ebenen
  eintrag.writeUInt16LE(32, 6); // Bits pro Pixel
  eintrag.writeUInt32LE(png.length, 8);
  eintrag.writeUInt32LE(22, 12); // Offset hinter Kopf + Eintrag

  const ico = Buffer.concat([dir, eintrag, png]);
  const icoZiel = path.join(HERE, '..', 'public', 'icon.ico');
  fs.writeFileSync(icoZiel, ico);
  console.log(`${icoZiel} geschrieben, ${ico.length} Bytes`);
}
