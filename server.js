// Claude-Ampel -- lokaler Server.
//
// Lauscht auf 127.0.0.1 und schreibt nichts unter ~/.claude. Erreichbar wird er
// von aussen nur ueber einen Cloudflare-Tunnel -- und der endet ebenfalls auf
// 127.0.0.1. Deshalb gibt es KEINE Ausnahme fuer localhost beim Token: sonst
// waere der Tunnel eine offene Tuer fuer jeden, der die Adresse kennt.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, spawn } from 'node:child_process';

import { scan } from './lib/scanner.js';
import { StateStore } from './lib/state.js';
import { listPorts, portsForCwd, unmatchedPorts } from './lib/ports.js';
import { listWindows, assignWindows, focusWindow, focusViaCode, isAmbiguous } from './lib/windows.js';
import { groupByProject } from './lib/grouping.js';
import { nutzung } from './lib/usage.js';
import { loadOrCreateSecrets, tokenGleich } from './lib/secrets.js';
import { PushDienst } from './lib/push.js';
import { overlaySucher } from './lib/overlay.js';
import { CODE_PORT_BELEGT } from './lib/watchdog-regel.js';
import { FELDER, oeffentlich, pruefen, sichern, brauchtNeustart } from './lib/settings.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(HERE, 'config.json');

const CONFIG = loadOrCreateSecrets(CONFIG_PATH, {
  port: 4317,
  scanIntervalMs: 2000,
  stallSeconds: 300,
  orphanAfterMinutes: 10,
  ...readConfig(),
});

const push = new PushDienst({
  speicherPfad: path.join(HERE, 'push-abos.json'),
  vapid: CONFIG.vapid,
});

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

// --- Overlay-Steuerung ------------------------------------------------------
// Das Overlay ist ein eigener Electron-Prozess. Der Server startet und beendet
// ihn, damit man ihn aus der Weboberflaeche ein- und ausschalten kann.

let overlayProzess = null;

function overlayLaeuft() {
  return Boolean(overlayProzess && overlayProzess.exitCode === null);
}

// Seit dem Autostart ueber die Aufgabenplanung startet der Server das Overlay
// im Normalfall nicht selbst. overlayLaeuft() allein meldete deshalb dauerhaft
// "nicht gestartet", obwohl es sichtbar auf dem Bildschirm lag.
const fremdesOverlay = overlaySucher(HERE);

/** PID eines laufenden Overlays -- eigenes oder fremd gestartetes. */
async function overlayPid() {
  if (overlayLaeuft()) return overlayProzess.pid;
  const gefunden = await fremdesOverlay();
  return gefunden ? gefunden.pid : null;
}

/**
 * Pfad zur Electron-Binaerdatei. Nicht der .cmd-Starter aus node_modules/.bin:
 * seit einer Sicherheitsaenderung weigert sich Node, .cmd-Dateien ohne Shell
 * zu starten. Das Paket hinterlegt den Dateinamen in path.txt.
 */
function electronPfad() {
  const wurzel = path.join(HERE, 'node_modules', 'electron');
  try {
    const name = fs.readFileSync(path.join(wurzel, 'path.txt'), 'utf8').trim();
    const voll = path.join(wurzel, 'dist', name);
    return fs.existsSync(voll) ? voll : null;
  } catch {
    return null;
  }
}

/**
 * VS Code setzt ELECTRON_RUN_AS_NODE=1 in seinem Terminal. Bleibt die Variable
 * stehen, startet Electron als blosses Node und oeffnet kein Fenster.
 * Sie auf "" zu setzen genuegt nicht -- unter Windows gilt sie dann immer noch
 * als gesetzt. Sie muss ganz verschwinden.
 */
function umgebungOhneNodeModus() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

async function overlayStarten() {
  // Auch ein fremd gestartetes zaehlt -- sonst startet der Knopf ein zweites,
  // das die Einzelinstanz-Sperre sofort wieder beendet.
  if (await overlayPid()) return true;
  const electron = electronPfad();
  if (!electron) return false;
  try {
    overlayProzess = spawn(electron, [path.join('overlay', 'main.cjs')], {
      cwd: HERE,
      windowsHide: true,
      detached: false,
      stdio: 'ignore',
      env: umgebungOhneNodeModus(),
    });
    overlayProzess.on('exit', () => {
      overlayProzess = null;
    });
    return true;
  } catch {
    overlayProzess = null;
    return false;
  }
}

async function overlayBeenden() {
  // Ein Overlay, das wir nicht selbst gestartet haben, kennt nur seine PID.
  if (!overlayLaeuft()) {
    const pid = await overlayPid();
    if (!pid) return true;
    await new Promise((f) => exec(`taskkill /PID ${pid} /T /F`, { windowsHide: true }, () => f()));
    return true;
  }
  return new Promise((fertig) => {
    if (!overlayLaeuft()) return fertig(true);
    const p = overlayProzess;
    p.once('exit', () => fertig(true));
    p.kill();
    // Electron startet Kindprozesse; wenn das freundliche Beenden nicht
    // greift, nach kurzer Zeit den ganzen Baum wegraeumen.
    setTimeout(() => {
      if (overlayLaeuft()) {
        exec(`taskkill /PID ${p.pid} /T /F`, { windowsHide: true }, () => fertig(true));
      }
    }, 1500);
  });
}

// Beim Beenden des Servers das Overlay nicht als Waise zuruecklassen.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (overlayLaeuft()) overlayProzess.kill();
    process.exit(0);
  });
}

const COOKIE = 'ampel_token';

function tokenAusAnfrage(req, url) {
  // hook.js laeuft ohne Browser und schickt das Token als Kopfzeile.
  const ausHeader = req.headers['x-ampel-token'];
  if (typeof ausHeader === 'string' && ausHeader) return ausHeader;
  const ausUrl = url.searchParams.get('t');
  if (ausUrl) return ausUrl;
  const cookies = req.headers.cookie ?? '';
  const treffer = cookies.split(';').map((c) => c.trim().split('='));
  const eintrag = treffer.find(([k]) => k === COOKIE);
  return eintrag ? decodeURIComponent(eintrag[1] ?? '') : null;
}

function istBerechtigt(req, url) {
  return tokenGleich(tokenAusAnfrage(req, url) ?? '', CONFIG.token);
}

const store = new StateStore({
  stallSeconds: CONFIG.stallSeconds,
  orphanAfterMinutes: CONFIG.orphanAfterMinutes,
});

/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set();
let snapshot = { projects: [], sessions: [], orphans: [], otherPorts: [], limit: null, updatedAt: 0 };
let lastPayload = '';

async function tick() {
  let sessions;
  try {
    sessions = scan();
  } catch (err) {
    console.error('Scan fehlgeschlagen:', err.message);
    return;
  }

  const rows = store.update(sessions);

  // Ports, Fenster und Nutzungslimit sind langsamer (PowerShell bzw. Netz)
  // und deshalb jeweils zwischengespeichert.
  const [ports, windows, limit] = await Promise.all([listPorts(), listWindows(), nutzung()]);

  // Verwaiste Sessions (Transkript weggeraeumt, kein Hook, lange her) werden
  // nicht angezeigt -- sie doppeln sonst nur ihr lebendiges Geschwister im
  // selben Projekt, ohne eine einzige Information beizutragen.
  const sichtbar = rows.filter((r) => !r.orphan);
  const verwaist = rows.filter((r) => r.orphan);

  const fenster = assignWindows(sichtbar, windows);
  for (const row of sichtbar) {
    row.ports = portsForCwd(ports, row.cwd);
    const win = fenster.get(row.sessionId) ?? null;
    row.hwnd = win?.hwnd ?? null;
    row.windowTitle = win?.title ?? null;
    row.windowAmbiguous = win ? isAmbiguous(windows, { folder: row.folder }) && !row.title : false;
  }

  snapshot = {
    projects: groupByProject(sichtbar),
    limit,
    sessions: sichtbar,
    orphans: verwaist.map((r) => ({ folder: r.folder, pid: r.pid, startedAt: r.startedAt })),
    otherPorts: unmatchedPorts(
      ports,
      sichtbar.map((r) => r.cwd).filter(Boolean),
      { ignore: [CONFIG.port] },
    ),
    updatedAt: Date.now(),
  };

  broadcast();

  for (const session of push.neuRot(sichtbar)) {
    push.melden(session).catch(() => {
      /* Push ist Beiwerk -- ein Fehler darf die Ampel nicht stoppen. */
    });
  }

  // Vorwarnung, bevor das Fuenf-Stunden-Fenster zu ist. Einmal je Fenster --
  // die Entscheidung darueber trifft der Push-Dienst.
  const knapp = push.neuKnapp(limit);
  if (knapp) {
    push.meldenKnapp(knapp).catch(() => {
      /* dito */
    });
  }
}

function broadcast() {
  // "since" und "lastActivity" sind absolute Zeitstempel -- die Uhr laeuft im Browser,
  // deshalb muss nur bei echten Aenderungen gesendet werden.
  const payload = JSON.stringify(snapshot);
  if (payload === lastPayload) return;
  lastPayload = payload;

  const frame = `data: ${payload}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve) => {
    let data = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      if (tooBig) return;
      data += chunk;
      if (data.length > limit) {
        tooBig = true;
        data = '';
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  // Der Service Worker muss vom Stammverzeichnis aus ohne Token ladbar sein,
  // sonst darf er nicht fuer die ganze Seite zustaendig sein. Er enthaelt
  // keinerlei Daten -- nur die Anzeige-Logik fuer eingehende Push-Nachrichten.
  const OHNE_TOKEN = {
    '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
    '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
    '/icon.png': ['icon.png', 'image/png'],
  };
  if (req.method === 'GET' && OHNE_TOKEN[url.pathname]) {
    const [datei, typ] = OHNE_TOKEN[url.pathname];
    try {
      res.writeHead(200, { 'content-type': typ, 'cache-control': 'no-store' });
      res.end(fs.readFileSync(path.join(HERE, 'public', datei)));
    } catch {
      res.writeHead(404).end();
    }
    return;
  }

  if (!istBerechtigt(req, url)) {
    res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<meta charset="utf-8"><body style="font:15px system-ui;background:#0e1116;color:#e7ecf3;padding:40px">Kein gültiges Token.</body>');
    return;
  }

  // Token kam per URL: in ein Cookie umwandeln und die Adresse saeubern,
  // damit es nicht in Verlauf, Lesezeichen oder Weitergabe haengen bleibt.
  if (url.searchParams.has('t')) {
    res.writeHead(302, {
      location: url.pathname,
      'set-cookie': `${COOKIE}=${encodeURIComponent(CONFIG.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ felder: FELDER, werte: oeffentlich(CONFIG), overlay: (await overlayPid()) !== null }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings') {
    const body = await readBody(req);
    let eingabe = null;
    try {
      eingabe = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, fehler: ['unlesbare Anfrage'] }));
      return;
    }

    const { uebernommen, fehler } = pruefen(eingabe);
    if (fehler.length) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, fehler }));
      return;
    }

    const vorher = oeffentlich(CONFIG);
    sichern(CONFIG_PATH, uebernommen);
    Object.assign(CONFIG, uebernommen);
    // Was sofort wirken kann, wirkt sofort.
    store.config.stallSeconds = CONFIG.stallSeconds;
    store.config.orphanAfterMinutes = CONFIG.orphanAfterMinutes;
    setImmediate(tick);

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, werte: oeffentlich(CONFIG), neustart: brauchtNeustart(uebernommen, vorher) }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/overlay') {
    const body = await readBody(req);
    let aktion = null;
    try {
      aktion = JSON.parse(body)?.aktion ?? null;
    } catch {
      /* unten abgefangen */
    }
    if (aktion !== 'start' && aktion !== 'stop') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, fehler: 'aktion muss start oder stop sein' }));
      return;
    }
    const ok = aktion === 'start' ? await overlayStarten() : await overlayBeenden();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok, laeuft: (await overlayPid()) !== null }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/vapid') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ publicKey: CONFIG.vapid?.publicKey ?? null }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/subscribe') {
    const body = await readBody(req);
    let ok = false;
    try {
      ok = push.anmelden(JSON.parse(body));
    } catch {
      /* unten als Fehler gemeldet */
    }
    res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok, abos: push.anzahl() }));
    return;
  }

  const SEITEN = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/mini': 'mini.html',
    '/settings': 'settings.html',
  };
  if (req.method === 'GET' && SEITEN[url.pathname]) {
    let html;
    try {
      html = fs.readFileSync(path.join(HERE, 'public', SEITEN[url.pathname]));
    } catch {
      res.writeHead(500).end(`${SEITEN[url.pathname]} fehlt`);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
    return;
  }

  // Das Overlay hat keine Adressleiste -- der Knopf "grosses Dashboard"
  // laesst den Server den Standardbrowser oeffnen, samt Token.
  if (req.method === 'POST' && url.pathname === '/api/open-dashboard') {
    exec(`start "" "http://127.0.0.1:${CONFIG.port}/?t=${CONFIG.token}"`, { windowsHide: true }, () => {});
    res.writeHead(204).end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(snapshot, null, 2));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/hook') {
    const body = await readBody(req);
    try {
      const changed = store.handleHook(JSON.parse(body));
      // Ein Hook ist die praeziseste Information, die es gibt -- sofort auswerten.
      if (changed) setImmediate(tick);
    } catch {
      // Kaputtes Hook-JSON darf den Server nicht stoeren.
    }
    res.writeHead(204).end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/focus') {
    const body = await readBody(req);
    let sessionId = null;
    try {
      sessionId = JSON.parse(body)?.sessionId ?? null;
    } catch {
      /* unten als Fehler behandelt */
    }
    const row = snapshot.sessions.find((s) => s.sessionId === sessionId);
    if (!row) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Session unbekannt' }));
      return;
    }

    // Erst das genau zugeordnete Fenster. Gibt es keins, uebernimmt die
    // VS-Code-Kommandozeile -- die holt das Fenster mit diesem Ordner nach vorn.
    let ok = row.hwnd ? await focusWindow(row.hwnd) : false;
    let weg = ok ? 'fenster' : null;
    if (!ok) {
      ok = await focusViaCode(row.cwd);
      weg = ok ? 'code' : null;
    }

    res.writeHead(ok ? 200 : 500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok, weg }));
    return;
  }

  res.writeHead(404).end('nicht gefunden');
});

server.listen(CONFIG.port, '127.0.0.1', () => {
  console.log(`Claude-Ampel: http://127.0.0.1:${CONFIG.port}/?t=${CONFIG.token}`);
  console.log(`Takt ${CONFIG.scanIntervalMs} ms, Stall-Schwelle ${CONFIG.stallSeconds} s`);
  console.log(`Push-Abos: ${push.anzahl()}`);
  console.log(`Fuers Handy: tunnel.cmd starten.`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${CONFIG.port} ist belegt. Anderen Port in config.json eintragen.`);
    // Eigener Code: watchdog.js darf hier NICHT neu starten, sonst dreht er sich im Kreis.
    process.exit(CODE_PORT_BELEGT);
  }
  throw err;
});

// Ein Absturz soll wenigstens eine Spur hinterlassen. Danach beenden wir
// bewusst: der Zustand nach einer unbehandelten Ausnahme ist nicht mehr
// vertrauenswuerdig, und watchdog.js startet sauber neu.
for (const art of ['uncaughtException', 'unhandledRejection']) {
  process.on(art, (fehler) => {
    console.error(`${art}:`, fehler instanceof Error ? fehler.stack : fehler);
    if (overlayLaeuft()) overlayProzess.kill();
    process.exit(1);
  });
}

tick();
setInterval(tick, CONFIG.scanIntervalMs);

// SSE-Verbindungen offen halten, auch wenn sich lange nichts aendert.
setInterval(() => {
  for (const res of clients) {
    try {
      res.write(': ping\n\n');
    } catch {
      clients.delete(res);
    }
  }
}, 20000);
