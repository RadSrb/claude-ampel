// Stop-Hook: laesst Claude von selbst weitermachen, statt auf "fahre fort"
// zu warten. Die Entscheidung steht in lib/fortfahren.js.
//
// Wie hook.js gilt: niemals Claude aufhalten. Jeder Fehler endet mit
// Exit-Code 0 und leerer Ausgabe -- dann hoert Claude ganz normal auf.
//
// Ausschalten: Datei "fortfahren-aus" neben dieses Skript legen
// oder CLAUDE_FORTFAHREN=0 setzen.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { entscheide } from './lib/fortfahren.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Reicht weit ueber einen Auftrag hinaus, ohne ein 12-MB-Transkript ganz zu lesen.
const TAIL_BYTES = 2 * 1024 * 1024;

function ende() {
  process.exit(0);
}

const notbremse = setTimeout(ende, 3000);
notbremse.unref?.();
process.on('uncaughtException', ende);
process.on('unhandledRejection', ende);

function leseEnde(file) {
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - TAIL_BYTES);
  const buf = Buffer.alloc(size - start);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buf, 0, buf.length, start);
  } finally {
    fs.closeSync(fd);
  }
  const zeilen = buf.toString('utf8').split('\n');
  if (start > 0) zeilen.shift();
  const out = [];
  for (const z of zeilen) {
    if (!z.trim()) continue;
    try {
      out.push(JSON.parse(z));
    } catch {
      /* halbe Zeile */
    }
  }
  return out;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  input += c;
});
process.stdin.on('error', ende);
process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  const aus = process.env.CLAUDE_FORTFAHREN === '0' || fs.existsSync(path.join(HERE, 'fortfahren-aus'));
  if (aus || payload?.stop_hook_active || typeof payload?.transcript_path !== 'string') return ende();

  const urteil = entscheide(leseEnde(payload.transcript_path), payload);
  // Erst beenden, wenn die Ausgabe draussen ist -- an einer Pipe schreibt
  // Windows asynchron, ein sofortiges exit schnitte sie ab.
  if (urteil) process.stdout.write(JSON.stringify(urteil), ende);
  else ende();
});
