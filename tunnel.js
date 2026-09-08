// Startet einen Cloudflare-Quick-Tunnel auf die Ampel und zeigt die
// Handy-Adresse als QR-Code an.
//
// Quick-Tunnel heisst: kein Cloudflare-Konto noetig, aber die Adresse ist
// oeffentlich erreichbar und aendert sich bei jedem Neustart. Der Schutz ist
// allein das Token in der URL -- deshalb wird hier die vollstaendige URL
// inklusive Token in den QR-Code gepackt und sonst nirgends hinterlegt.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import qr from 'qrcode-terminal';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const KANDIDATEN = [
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  'C:\\Program Files\\cloudflared\\cloudflared.exe',
  'cloudflared',
];

function config() {
  try {
    return JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));
  } catch {
    console.error('config.json nicht gefunden. Erst server.js einmal starten.');
    process.exit(1);
  }
}

const { port = 4317, token } = config();
if (!token) {
  console.error('Kein Token in config.json. Erst server.js einmal starten.');
  process.exit(1);
}

const binary = KANDIDATEN.find((p) => p === 'cloudflared' || fs.existsSync(p));

console.log(`Starte Tunnel auf http://localhost:${port} …\n`);

const kind = spawn(binary, ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], {
  windowsHide: true,
});

let gemeldet = false;

function pruefeAusgabe(text) {
  if (gemeldet) return;
  const treffer = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (!treffer) return;
  gemeldet = true;

  const url = `${treffer[0]}/?t=${token}`;
  console.log('\n' + '='.repeat(64));
  console.log('  Am Handy scannen:\n');
  qr.generate(url, { small: true }, (code) => console.log(code));
  console.log(`  ${url}\n`);
  console.log('  Diese Adresse ist oeffentlich erreichbar. Nur das Token schuetzt sie.');
  console.log('  Nicht weitergeben. Beim naechsten Start gibt es eine neue Adresse.');
  console.log('='.repeat(64) + '\n');
}

// cloudflared schreibt die Adresse je nach Version nach stdout oder stderr.
kind.stdout.on('data', (d) => pruefeAusgabe(String(d)));
kind.stderr.on('data', (d) => pruefeAusgabe(String(d)));

kind.on('error', (err) => {
  console.error(`cloudflared konnte nicht gestartet werden: ${err.message}`);
  process.exit(1);
});
kind.on('exit', (code) => {
  console.log(`Tunnel beendet (Code ${code}).`);
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  kind.kill();
  process.exit(0);
});
