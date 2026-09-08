import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pidsAusCsv, pidLebt } from '../lib/scanner.js';

// Echtes Format von: tasklist /FI "IMAGENAME eq claude.exe" /FO CSV /NH
const CSV = [
  '"claude.exe","12345","Console","1","250.000 K"',
  '"claude.exe","67890","Console","1","310.000 K"',
].join('\r\n');

test('liest die PIDs aus der tasklist-Ausgabe', () => {
  const pids = pidsAusCsv(CSV);
  assert.equal(pids.size, 2);
  assert.ok(pids.has(12345));
  assert.ok(pids.has(67890));
});

test('kommt mit Windows-Zeilenenden zurecht', () => {
  // Das Wagenruecklaufzeichen darf die Zahl nicht verfaelschen.
  assert.ok(pidsAusCsv('"claude.exe","42","Console","1","1 K"\r\n').has(42));
});

test('meldet nichts bei leerer oder unbrauchbarer Ausgabe', () => {
  // tasklist antwortet bei null Treffern mit einem Hinweistext, keiner CSV.
  assert.equal(pidsAusCsv('').size, 0);
  assert.equal(pidsAusCsv(null).size, 0);
  assert.equal(pidsAusCsv(undefined).size, 0);
  assert.equal(pidsAusCsv('INFO: Es werden keine Aufgaben ausgefuehrt.').size, 0);
});

test('erkennt den eigenen Prozess als lebend', () => {
  assert.equal(pidLebt(process.pid), true);
});

test('erkennt eine unmoegliche PID als tot', () => {
  // 0 und negative Werte sind keine gueltigen Prozesskennungen; process.kill(0)
  // wuerde sonst die ganze Prozessgruppe treffen.
  assert.equal(pidLebt(0), false);
  assert.equal(pidLebt(-1), false);
  assert.equal(pidLebt(null), false);
  assert.equal(pidLebt('123'), false);
  assert.equal(pidLebt(1.5), false);
});

test('erkennt eine sehr hohe PID als tot', () => {
  assert.equal(pidLebt(2147483646), false);
});
