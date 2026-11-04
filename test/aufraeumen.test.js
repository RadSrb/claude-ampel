import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Aufraeumer, indexieren, nachfahren, waisen, gleicheStartzeit, istGeschuetzt, ausnahmenMuster, STANDARD_AUSNAHMEN } from '../lib/aufraeumen.js';

const pr = (p, pp, s, n, c = n) => ({ p, pp, s: String(s), n, c });

function neuer(opt = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ampel-aufr-'));
  const beendet = [];
  const a = new Aufraeumer({
    datei: path.join(dir, 'baum.json'),
    logDatei: path.join(dir, 'aufraeumen.log'),
    eigenePid: 1,
    beenden: async (pid) => {
      beendet.push(pid);
      return true;
    },
    ...opt,
  });
  return { a, beendet, dir };
}

// Eine Session (claude 100) mit Shell 101 -> node-Server 102 -> SDK-claude 103.
const BAUM = [
  pr(1, 0, 10, 'node.exe', 'node server.js'),
  pr(100, 50, 1000, 'claude.exe'),
  pr(101, 100, 1100, 'powershell.exe', 'powershell -Command $__claudeCodeScript = $env:CLAUDE_CODE_SHELL_LAUNCHER_SCRIPT'),
  pr(102, 101, 1200, 'node.exe', 'node server/index.mjs'),
  pr(103, 102, 1300, 'claude.exe', 'claude.exe --output-format stream-json'),
];
const SESSION = { sessionId: 's1', pid: 100, procStart: '1000', name: 'agenten' };

test('gleicheStartzeit vergleicht mit einer Sekunde Spielraum, fehlende Werte nie gleich', () => {
  assert.equal(gleicheStartzeit('134376486577563131', '134376486577563131'), true);
  assert.equal(gleicheStartzeit('134376486577563131', '134376486570000000'), true);
  assert.equal(gleicheStartzeit('134376486577563131', '134376486677563131'), false);
  assert.equal(gleicheStartzeit('', '1'), false);
  assert.equal(gleicheStartzeit(undefined, undefined), false);
});

test('eine Eltern-PID, die juenger als das Kind ist, gilt nicht als Elternteil', () => {
  const idx = indexieren([pr(5, 0, 500, 'x.exe'), pr(6, 5, 100, 'kind.exe')]);
  assert.equal(idx.eltern.has(6), false);
});

test('nachfahren ueberspringt Geschuetztes und lebende Sessions samt Unterbaum', () => {
  const idx = indexieren([
    ...BAUM,
    pr(104, 101, 1400, 'conhost.exe', 'conhost.exe --headless powershell nacht.ps1'),
    pr(105, 104, 1500, 'powershell.exe', 'powershell nacht.ps1'),
    pr(106, 100, 1600, 'claude.exe', 'claude'),
    pr(107, 106, 1700, 'node.exe', 'node dev'),
  ]);
  const liste = nachfahren(idx, idx.nachPid.get(100), {
    geschuetzt: (p) => istGeschuetzt(p, {}),
    sessionPids: new Set([100, 106]),
  });
  assert.deepEqual(liste.map((k) => k.p), [101, 102, 103]);
});

test('beendet nach dem Ende der Session alle gemerkten Nachfahren, Kinder zuerst', async () => {
  const { a, beendet, dir } = neuer();
  await a.takt(BAUM, { lebend: [SESSION], verfolgen: [SESSION] });
  assert.deepEqual(beendet, []);
  // Session weg: claude 100 ist beendet.
  const danach = BAUM.filter((p) => p.p !== 100);
  const res = await a.takt(danach, { lebend: [], verfolgen: [] });
  assert.deepEqual(beendet, [103, 102, 101]);
  assert.equal(res.length, 3);
  const log = fs.readFileSync(path.join(dir, 'aufraeumen.log'), 'utf8');
  assert.match(log, /beendet pid=102 .*session=s1 name=agenten \| node server\/index\.mjs/);
  // Eintrag ist danach vergessen.
  await a.takt(danach, { lebend: [], verfolgen: [] });
  assert.equal(beendet.length, 3);
});

test('der Speicher ueberlebt einen Neustart der Ampel', async () => {
  const { a, beendet } = neuer();
  await a.takt(BAUM, { lebend: [SESSION], verfolgen: [SESSION] });
  const b = new Aufraeumer({ datei: a.datei, logDatei: a.logDatei, eigenePid: 1, beenden: async (pid) => (beendet.push(pid), true) });
  await b.takt(BAUM.filter((p) => p.p !== 100), { lebend: [], verfolgen: [] });
  assert.deepEqual(beendet, [103, 102, 101]);
});

test('eine neu vergebene PID wird nie beendet', async () => {
  const { a, beendet } = neuer();
  await a.takt(BAUM, { lebend: [SESSION], verfolgen: [SESSION] });
  // 102 ist jetzt ein ganz anderer Prozess (spaeter gestartet).
  const danach = BAUM.filter((p) => p.p !== 100).map((p) => (p.p === 102 ? pr(102, 7, 99999999999, 'fremd.exe') : p));
  await a.takt(danach, { lebend: [], verfolgen: [] });
  assert.equal(beendet.includes(102), false);
});

test('fehlt die Session nur in der Liste, lebt ihr Prozess aber, wird nichts beendet', async () => {
  const { a, beendet } = neuer();
  await a.takt(BAUM, { lebend: [SESSION], verfolgen: [SESSION] });
  await a.takt(BAUM, { lebend: [], verfolgen: [] });
  assert.deepEqual(beendet, []);
});

test('Ausnahmen, eigene Prozesse und andere Sessions werden nie beendet', async () => {
  const { a, beendet } = neuer({ ausnahmen: [...STANDARD_AUSNAHMEN, 'seedvr_nacht'] });
  const baum = [
    ...BAUM,
    pr(110, 101, 1100, 'powershell.exe', 'powershell -File C:\\Projekte\\ki-mitarbeiter-film\\scripts\\seedvr_nacht.ps1'),
    pr(111, 101, 1100, 'electron.exe', 'electron C:\\Projekte\\iPadCockpit\\main.cjs'),
    pr(112, 101, 1100, 'Code.exe', 'Code.exe'),
    pr(113, 1, 1100, 'powershell.exe', 'powershell -File C:\\Projekte\\ClaudeAmpel\\lib\\host.ps1'),
  ];
  await a.takt(baum, { lebend: [SESSION], verfolgen: [SESSION] });
  await a.takt(baum.filter((p) => p.p !== 100), { lebend: [], verfolgen: [] });
  assert.deepEqual(beendet, [103, 102, 101]);
});

test('Sessions aus der Aufgabenplanung werden nicht verfolgt', async () => {
  const { a, beendet } = neuer();
  const baum = [pr(40, 4, 100, 'svchost.exe', 'svchost.exe -k netsvcs -p -s Schedule'), ...BAUM.map((p) => (p.p === 100 ? pr(100, 40, 1000, 'claude.exe') : p))];
  await a.takt(baum, { lebend: [SESSION], verfolgen: [SESSION] });
  await a.takt(baum.filter((p) => p.p !== 100), { lebend: [], verfolgen: [] });
  assert.deepEqual(beendet, []);
});

test('ein Nachfahre, der unter eine lebende Session gehoert, bleibt', async () => {
  const { a, beendet } = neuer();
  const zweite = { sessionId: 's2', pid: 102, procStart: '1200' };
  await a.takt(BAUM, { lebend: [SESSION], verfolgen: [SESSION] });
  await a.takt(BAUM.filter((p) => p.p !== 100), { lebend: [zweite], verfolgen: [] });
  // 102 ist selbst eine lebende Session, 103 haengt darunter.
  assert.deepEqual(beendet, [101]);
});

test('Waisen einer toten Session werden erkannt, aber ohne Freigabe nicht beendet', async () => {
  const ohne = BAUM.filter((p) => p.p !== 100);
  const idx = indexieren(ohne);
  const gefunden = waisen(idx, { geschuetzt: (p) => istGeschuetzt(p, {}) });
  assert.deepEqual(gefunden.map((b) => b.map((k) => k.p)), [[101, 102, 103]]);

  const { a, beendet, dir } = neuer();
  await a.takt(ohne, { lebend: [], verfolgen: [] });
  assert.deepEqual(beendet, []);
  assert.match(fs.readFileSync(path.join(dir, 'aufraeumen.log'), 'utf8'), /waise erkannt \(nicht beendet\)/);

  const mit = neuer({ waisenBeenden: true });
  await mit.a.takt(ohne, { lebend: [], verfolgen: [] });
  assert.deepEqual(mit.beendet, [103, 102, 101]);
});

test('die Shell einer lebenden Session ist keine Waise', () => {
  const idx = indexieren(BAUM);
  assert.deepEqual(waisen(idx, {}), []);
});

test('ungueltige Ausnahme-Muster werden woertlich genommen', () => {
  const [re] = ausnahmenMuster(['a(b']);
  assert.equal(re.test('x a(b y'), true);
});

test('Sessions aus Windows Terminal (das unter svchost haengt) werden verfolgt', async () => {
  const { a, beendet } = neuer();
  const baum = [
    pr(40, 4, 100, 'svchost.exe', ''),
    pr(41, 40, 200, 'WindowsTerminal.exe', 'wt'),
    pr(42, 41, 300, 'powershell.exe', 'powershell'),
    ...BAUM.map((p) => (p.p === 100 ? pr(100, 42, 1000, 'claude.exe') : p)),
  ];
  await a.takt(baum, { lebend: [SESSION], verfolgen: [SESSION] });
  await a.takt(baum.filter((p) => p.p !== 100), { lebend: [], verfolgen: [] });
  assert.deepEqual(beendet, [103, 102, 101]);
});
