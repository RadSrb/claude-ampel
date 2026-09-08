// Meldet ein Hook-Ereignis an die Claude-Ampel.
//
// Dieses Skript laeuft in JEDER Claude-Code-Session. Oberste Regel:
// Es darf Claude niemals aufhalten und niemals etwas auf stdout schreiben.
// Egal was schiefgeht -- Exit-Code 0, leere Ausgabe.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 500;

// Der Server verlangt ein Token, weil er ueber den Tunnel oeffentlich
// erreichbar sein kann. Es steht in derselben config.json daneben.
let PORT = 4317;
let TOKEN = '';
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));
  PORT = Number(cfg.port) || PORT;
  TOKEN = typeof cfg.token === 'string' ? cfg.token : '';
} catch {
  /* Ohne Konfiguration einfach den Standardport versuchen. */
}
PORT = Number(process.env.CLAUDE_AMPEL_PORT) || PORT;

function ende() {
  process.exit(0);
}

// Notbremse: falls irgendetwas haengt, ist nach dem Timeout trotzdem Schluss.
const notbremse = setTimeout(ende, TIMEOUT_MS + 200);
notbremse.unref?.();

process.on('uncaughtException', ende);
process.on('unhandledRejection', ende);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('error', ende);
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    return ende();
  }
  if (!payload?.session_id || !payload?.hook_event_name) return ende();

  const body = JSON.stringify({
    session_id: payload.session_id,
    hook_event_name: payload.hook_event_name,
    cwd: payload.cwd ?? null,
    tool_name: payload.tool_name ?? null,
    message: payload.message ?? null,
  });

  const req = http.request(
    {
      host: '127.0.0.1',
      port: PORT,
      path: '/api/hook',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-ampel-token': TOKEN,
      },
      timeout: TIMEOUT_MS,
    },
    (res) => {
      res.resume();
      res.on('end', ende);
    },
  );

  // Dashboard laeuft nicht? Nicht schlimm -- einfach still beenden.
  req.on('error', ende);
  req.on('timeout', () => {
    req.destroy();
    ende();
  });
  req.end(body);
});
