// Listet die laufenden Dev-Server und ordnet sie Projekten zu.
// Mit --kill werden sie beendet -- der Ampel-Server selbst niemals.
//
//   node tools/dev-server.js
//   node tools/dev-server.js --kill

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { listPorts } from '../lib/ports.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const DEV = /^(node|python\d*|pythonw|deno|bun|php|dotnet|ruby|java|go)(\.exe)?$/i;
const PROJEKT = /[\\/]projekte[\\/]([^\\/]+)/i;

function eigenerPort() {
  try {
    return JSON.parse(fs.readFileSync(path.join(HERE, '..', 'config.json'), 'utf8')).port ?? 4317;
  } catch {
    return 4317;
  }
}

function projektVon(pfade) {
  for (const p of pfade) {
    const t = p.match(PROJEKT);
    if (t) return t[1];
  }
  return null;
}

const toeten = process.argv.includes('--kill');
const schutz = eigenerPort();

const ports = await listPorts();
const server = ports
  .filter((p) => DEV.test(p.process ?? ''))
  .map((p) => ({ ...p, projekt: projektVon(p.paths) }))
  .filter((p) => p.port !== schutz)
  .sort((a, b) => (a.projekt ?? 'zzz').localeCompare(b.projekt ?? 'zzz') || a.port - b.port);

console.log('Port    PID      Prozess        Projekt');
console.log('-'.repeat(66));
for (const s of server) {
  console.log(
    String(s.port).padEnd(8) + String(s.pid).padEnd(9) + (s.process ?? '').padEnd(15) + (s.projekt ?? '(unbekannt)'),
  );
}

// Projekte mit mehr als einem Server -- genau das, was nicht sein soll.
const proProjekt = new Map();
for (const s of server) {
  if (!s.projekt) continue;
  proProjekt.set(s.projekt, [...(proProjekt.get(s.projekt) ?? []), s.port]);
}
const doppelt = [...proProjekt].filter(([, ports]) => ports.length > 1);

console.log(`\n${server.length} Dev-Server, ${proProjekt.size} Projekte, Ampel-Port ${schutz} ausgenommen.`);
if (doppelt.length) {
  console.log('\nMehr als ein Server pro Projekt:');
  for (const [projekt, ports] of doppelt) console.log(`  ${projekt}: ${ports.join(', ')}`);
}

if (!toeten) {
  console.log('\nZum Beenden: node tools/dev-server.js --kill');
  process.exit(0);
}

console.log('\nBeende …');
const pids = [...new Set(server.map((s) => s.pid))];
let erledigt = 0;
await Promise.all(
  pids.map(
    (pid) =>
      new Promise((fertig) => {
        // /T nimmt die Kindprozesse mit -- npm-Starter haengen den Server als Kind darunter.
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (err) => {
          if (!err) erledigt++;
          fertig();
        });
      }),
  ),
);
console.log(`${erledigt} von ${pids.length} Prozessen beendet.`);
