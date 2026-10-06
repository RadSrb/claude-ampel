import { test } from 'node:test';
import assert from 'node:assert/strict';

import { einzelflug, sendenswert } from '../lib/takt.js';

const pause = (ms) => new Promise((f) => setTimeout(f, ms));

test('einzelflug laesst keine zwei Laeufe gleichzeitig zu', async () => {
  let gleichzeitig = 0;
  let hoechstens = 0;
  let laeufe = 0;
  const takt = einzelflug(async () => {
    laeufe++;
    gleichzeitig++;
    hoechstens = Math.max(hoechstens, gleichzeitig);
    await pause(20);
    gleichzeitig--;
  });

  // Drei Aufrufe waehrend des ersten Laufs: einer laeuft, die anderen werden
  // zu genau einem Nachlauf zusammengefasst.
  await Promise.all([takt(), takt(), takt()]);
  assert.equal(hoechstens, 1);
  assert.equal(laeufe, 2);
});

test('einzelflug laeuft nach einem Fehler weiter', async () => {
  let n = 0;
  const takt = einzelflug(async () => {
    n++;
    if (n === 1) throw new Error('einmal kaputt');
  });
  await takt();
  await takt();
  assert.equal(n, 2);
});

test('sendenswert ignoriert den Zeitstempel updatedAt', () => {
  const a = { sessions: [{ id: 1, status: 'running' }], updatedAt: 1000 };
  const b = { sessions: [{ id: 1, status: 'running' }], updatedAt: 2000 };
  const kernA = sendenswert(a, '');
  assert.ok(kernA, 'erste Momentaufnahme wird gesendet');
  assert.equal(sendenswert(b, kernA), null, 'nur die Uhr ist weitergelaufen -- nicht senden');
});

test('sendenswert ignoriert lastActivity, auch verschachtelt', () => {
  // Eine laufende Session schreibt staendig ins Transkript. Das bewegt nur
  // lastActivity -- keine Oberflaeche zeigt es an, also kein Grund zu senden.
  const bild = (t) => ({
    projects: [{ key: 'p', sessions: [{ id: 1, status: 'running', lastActivity: t }] }],
    sessions: [{ id: 1, status: 'running', lastActivity: t }],
    updatedAt: t,
  });
  const kern = sendenswert(bild(1000), '');
  assert.equal(sendenswert(bild(2000), kern), null);
});

test('sendenswert meldet eine echte Aenderung', () => {
  const a = { sessions: [{ id: 1, status: 'running' }], updatedAt: 1000 };
  const b = { sessions: [{ id: 1, status: 'done' }], updatedAt: 1000 };
  const kernA = sendenswert(a, '');
  const kernB = sendenswert(b, kernA);
  assert.ok(kernB);
  assert.notEqual(kernB, kernA);
});
