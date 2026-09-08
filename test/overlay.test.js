import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ersterTreffer } from '../lib/overlay.js';

const BASIS = 'C:\\Projekte\\ClaudeAmpel';
const CMD = 'C:\\Projekte\\ClaudeAmpel\\node_modules\\electron\\dist\\electron.exe overlay\\main.cjs';
const FREMD = 'C:\\Projekte\\AndereApp\\node_modules\\electron\\dist\\electron.exe overlay\\main.cjs';

const ALT = { pid: 46676, seit: '2026-09-08T14:53:29.0170720+02:00', eltern: 36444, cmd: CMD };
const JUNG = { pid: 60636, seit: '2026-09-08T15:40:01.0000000+02:00', eltern: 1, cmd: CMD };

test('findet das laufende Overlay', () => {
  assert.deepEqual(ersterTreffer([ALT], BASIS), { pid: 46676, seit: ALT.seit });
});

test('nimmt bei zwei Treffern das aeltere', () => {
  // Das junge gibt wegen der Einzelinstanz-Sperre gleich wieder auf.
  assert.equal(ersterTreffer([JUNG, ALT], BASIS).pid, 46676);
  assert.equal(ersterTreffer([ALT, JUNG], BASIS).pid, 46676);
});

test('ignoriert ein Overlay aus einem anderen Projekt', () => {
  // Sonst meldet die Ampel ein fremdes Electron als ihr eigenes Overlay.
  assert.equal(ersterTreffer([{ ...ALT, cmd: FREMD }], BASIS), null);
  assert.equal(ersterTreffer([{ ...ALT, cmd: FREMD }, ALT], BASIS).pid, 46676);
});

test('vergleicht den Ordner ohne Ruecksicht auf Gross- und Kleinschreibung', () => {
  // Windows liefert den Laufwerksbuchstaben mal so, mal so.
  assert.equal(ersterTreffer([ALT], 'c:\\projekte\\claudeampel').pid, 46676);
});

test('kommt mit einem einzelnen Objekt zurecht', () => {
  // ConvertTo-Json liefert bei genau einem Treffer kein Array.
  assert.equal(ersterTreffer(ALT, BASIS).pid, 46676);
});

test('meldet nichts, wenn kein Overlay laeuft', () => {
  assert.equal(ersterTreffer([], BASIS), null);
  assert.equal(ersterTreffer(null, BASIS), null);
  assert.equal(ersterTreffer(undefined, BASIS), null);
});

test('ignoriert unbrauchbare Eintraege', () => {
  assert.equal(ersterTreffer([{ pid: 0, cmd: CMD }, { pid: null, cmd: CMD }, ALT], BASIS).pid, 46676);
  assert.equal(ersterTreffer([{ pid: 0, cmd: CMD }], BASIS), null);
  assert.equal(ersterTreffer([{ pid: 5 }], BASIS), null);
});

test('kommt ohne Zeitangabe zurecht', () => {
  const ohne = { pid: 999, cmd: CMD };
  assert.equal(ersterTreffer([ohne], BASIS).pid, 999);
  // Ein Treffer mit Zeit schlaegt einen ohne.
  assert.equal(ersterTreffer([ohne, ALT], BASIS).pid, 46676);
});
