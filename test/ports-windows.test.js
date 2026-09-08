import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractPaths, portsForCwd, unmatchedPorts, isTooBroad, mergeByPort } from '../lib/ports.js';
import { matchWindow, isAmbiguous, assignWindows } from '../lib/windows.js';

// Echte Kommandozeilen von diesem Rechner.
const NEXT_V2 =
  '"C:\\Program Files\\nodejs\\node.exe" C:\\Projekte\\ExusConnectWebsiteV2\\node_modules\\next\\dist\\server\\lib\\start-server.js';
const PY_OUT =
  'C:\\Users\\Alexander\\AppData\\Local\\Programs\\Python\\Python313\\python.exe -m http.server 4321 --directory C:/Projekte/ExusConnectWebsiteV3/out';
const PY_NACKT = 'C:\\Users\\Alexander\\AppData\\Local\\Programs\\Python\\Python313\\python.exe -m http.server 8000 --bind 127.0.0.1';

test('extractPaths findet Pfade auch mit Schraegstrichen und Anfuehrungszeichen', () => {
  assert.ok(extractPaths(NEXT_V2).includes('c:\\projekte\\exusconnectwebsitev2\\node_modules\\next\\dist\\server\\lib\\start-server.js'));
  assert.ok(extractPaths(PY_OUT).some((p) => p.startsWith('c:\\projekte\\exusconnectwebsitev3\\out')));
  assert.deepEqual(extractPaths(null), []);
});

const PORTS = [
  { port: 3001, pid: 1, process: 'node.exe', paths: extractPaths(NEXT_V2) },
  { port: 4321, pid: 2, process: 'python.exe', paths: extractPaths(PY_OUT) },
  { port: 8000, pid: 3, process: 'python.exe', paths: extractPaths(PY_NACKT) },
];

test('portsForCwd ordnet den Dev-Server dem richtigen Projekt zu', () => {
  assert.deepEqual(portsForCwd(PORTS, 'c:\\Projekte\\ExusConnectWebsiteV2'), [3001]);
  assert.deepEqual(portsForCwd(PORTS, 'c:\\Projekte\\ExusConnectWebsiteV3'), [4321]);
});

test('portsForCwd verwechselt Projekte mit gemeinsamem Namensanfang nicht', () => {
  // "ExusConnectWebsite" ist ein Praefix von "ExusConnectWebsiteV2" -- darf nicht greifen.
  assert.deepEqual(portsForCwd(PORTS, 'c:\\Projekte\\ExusConnectWebsite'), []);
});

test('portsForCwd ist unabhaengig von Gross-/Kleinschreibung und Schraegstrichen', () => {
  assert.deepEqual(portsForCwd(PORTS, 'C:/PROJEKTE/exusconnectwebsitev2/'), [3001]);
});

test('unmatchedPorts listet Ports ohne erkennbares Projekt', () => {
  const rest = unmatchedPorts(PORTS, ['c:\\Projekte\\ExusConnectWebsiteV2', 'c:\\Projekte\\ExusConnectWebsiteV3']);
  assert.deepEqual(rest, [{ port: 8000, process: 'python.exe' }]);
});

test('unmatchedPorts blendet Windows-Dienste und den eigenen Port aus', () => {
  const mitLaerm = [
    ...PORTS,
    { port: 5357, pid: 4, process: 'System', paths: [] },
    { port: 4317, pid: 5, process: 'node.exe', paths: [] },
  ];
  const rest = unmatchedPorts(mitLaerm, [], { ignore: [4317] });
  assert.deepEqual(
    rest.map((r) => r.port),
    [3001, 4321, 8000],
  );
});

test('mergeByPort vereinigt die Pfade aller Lauscher eines Ports', () => {
  // Echter Fall: auf 4399 lauschen zwei Prozesse, nur einer kennt den Projektpfad.
  const roh = [
    { port: 4399, pid: 10, process: 'node.exe', cmd: '"C:\\Program Files\\nodejs\\node.exe"' },
    {
      port: 4399,
      pid: 11,
      process: 'node.exe',
      cmd: '"node" "C:\\Projekte\\WorkExpert\\node_modules\\.bin\\..\\astro\\astro.js" dev --port 4399',
    },
  ];
  const zusammen = mergeByPort(roh);
  assert.equal(zusammen.length, 1);
  assert.deepEqual(portsForCwd(zusammen, 'c:\\Projekte\\WorkExpert'), [4399]);
});

test('mergeByPort bevorzugt einen echten Laufzeitprozess als Namen', () => {
  const zusammen = mergeByPort([
    { port: 5000, pid: 1, process: 'svchost.exe', cmd: '' },
    { port: 5000, pid: 2, process: 'python.exe', cmd: 'python app.py' },
  ]);
  assert.equal(zusammen[0].process, 'python.exe');
});

test('isTooBroad schuetzt vor Home- und Laufwerksordnern', () => {
  assert.equal(isTooBroad('C:\\Users\\Alexander'), true);
  assert.equal(isTooBroad('c:\\'), true);
  assert.equal(isTooBroad('C:\\Users\\Alexander\\meinprojekt'), false);
  assert.equal(isTooBroad('c:\\Projekte\\Demo'), false);
});

test('eine Session im Home-Ordner reisst nicht alle Ports an sich', () => {
  assert.deepEqual(portsForCwd(PORTS, 'C:\\Users\\Alexander'), []);
});

// Echte Fenstertitel von diesem Rechner.
const FENSTER = [
  { hwnd: 1, pid: 18172, app: 'Code', title: 'WorkExpert parity status - WorkExpert - Visual Studio Code' },
  { hwnd: 2, pid: 18172, app: 'Code', title: 'Tomo Pool und Gartenbau … - SaltlinePoolsWebsiteKopie - Visual Studio Code' },
  { hwnd: 3, pid: 18172, app: 'Code', title: 'Selbst anrufen und testen - Multi-Tenant-Voice-Platform - Visual Studio Code' },
  { hwnd: 4, pid: 18172, app: 'Code', title: 'Ampel für Claude Code Se… - Visual Studio Code' },
  { hwnd: 5, pid: 18172, app: 'Code', title: 'Deploy vorbereiten - Multi-Tenant-Voice-Platform - Visual Studio Code' },
];

test('matchWindow trifft ueber den gekuerzten Claude-Titel', () => {
  const w = matchWindow(FENSTER, { title: 'Tomo Pool und Gartenbau Website umbauen', folder: 'SaltlinePoolsWebsiteKopie' });
  assert.equal(w.hwnd, 2);
});

test('matchWindow trifft ein Fenster ohne geoeffneten Ordner', () => {
  const w = matchWindow(FENSTER, { title: 'Ampel für Claude Code Sessions', folder: 'Alexander' });
  assert.equal(w.hwnd, 4);
});

test('matchWindow faellt auf den Ordner zurueck, wenn kein Titel bekannt ist', () => {
  const w = matchWindow(FENSTER, { title: null, folder: 'WorkExpert' });
  assert.equal(w.hwnd, 1);
});

test('matchWindow unterscheidet zwei Sessions im selben Ordner ueber den Titel', () => {
  assert.equal(matchWindow(FENSTER, { title: 'Deploy vorbereiten', folder: 'Multi-Tenant-Voice-Platform' }).hwnd, 5);
  assert.equal(matchWindow(FENSTER, { title: 'Selbst anrufen und testen', folder: 'Multi-Tenant-Voice-Platform' }).hwnd, 3);
});

test('matchWindow liefert null, wenn nichts passt', () => {
  assert.equal(matchWindow(FENSTER, { title: 'Gibt es nicht', folder: 'GibtEsAuchNicht' }), null);
});

test('assignWindows vergibt kein Fenster zweimal', () => {
  // Der reale Fall: zwei Sessions im selben Ordner, aber nur ein Fenster.
  // Die mit Titel gewinnt, die andere geht leer aus -- statt beide auf dasselbe
  // Fenster zu zeigen und beim Knopfdruck die falsche Session zu holen.
  const rows = [
    { sessionId: 'mit-titel', title: 'Selbst anrufen und testen', folder: 'Multi-Tenant-Voice-Platform' },
    { sessionId: 'ohne-titel', title: null, folder: 'Multi-Tenant-Voice-Platform' },
  ];
  const zuordnung = assignWindows(rows, [FENSTER[2]]);
  assert.equal(zuordnung.get('mit-titel').hwnd, 3);
  assert.equal(zuordnung.get('ohne-titel'), undefined);
});

test('assignWindows bedient beide, wenn es zwei Fenster gibt', () => {
  const rows = [
    { sessionId: 'a', title: 'Selbst anrufen und testen', folder: 'Multi-Tenant-Voice-Platform' },
    { sessionId: 'b', title: null, folder: 'Multi-Tenant-Voice-Platform' },
  ];
  const zuordnung = assignWindows(rows, [FENSTER[2], FENSTER[4]]);
  assert.equal(zuordnung.get('a').hwnd, 3);
  assert.equal(zuordnung.get('b').hwnd, 5);
});

test('assignWindows laesst Titeltreffer vor Ordnerratern zum Zug kommen', () => {
  // Reihenfolge im Array darf keine Rolle spielen: der Ordner-Rater steht vorn.
  const rows = [
    { sessionId: 'rater', title: null, folder: 'Multi-Tenant-Voice-Platform' },
    { sessionId: 'treffer', title: 'Deploy vorbereiten', folder: 'Multi-Tenant-Voice-Platform' },
  ];
  const zuordnung = assignWindows(rows, [FENSTER[4]]);
  assert.equal(zuordnung.get('treffer').hwnd, 5);
  assert.equal(zuordnung.get('rater'), undefined);
});

test('isAmbiguous erkennt mehrere Fenster im selben Ordner', () => {
  assert.equal(isAmbiguous(FENSTER, { folder: 'Multi-Tenant-Voice-Platform' }), true);
  assert.equal(isAmbiguous(FENSTER, { folder: 'WorkExpert' }), false);
});
