import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tonFaellig, MINDESTABSTAND_MS } from '../lib/ton.cjs';

const s = (sessionId, status) => ({ sessionId, status });
// Eine Momentaufnahme, wie der Server sie nach dem ersten Scan schickt.
const snap = (...sessions) => ({ updatedAt: 1, sessions });

test('erster Stand klingelt nicht, auch wenn schon Sessions rot sind', () => {
  const r = tonFaellig(null, snap(s('a', 'attention'), s('b', 'question')), 1000, null);
  assert.equal(r.spielen, false);
  assert.deepEqual(r.stand, { a: 'attention', b: 'question' });
});

test('Wechsel von laeuft nach braucht dich klingelt', () => {
  const r = tonFaellig({ a: 'running' }, snap(s('a', 'attention')), 1000, null);
  assert.equal(r.spielen, true);
});

test('Wechsel von fertig nach fragt dich klingelt', () => {
  const r = tonFaellig({ a: 'done' }, snap(s('a', 'question')), 1000, null);
  assert.equal(r.spielen, true);
});

test('gleichbleibend rot klingelt bei weiteren Staenden nicht', () => {
  const r = tonFaellig({ a: 'attention' }, snap(s('a', 'attention')), 1000, null);
  assert.equal(r.spielen, false);
});

test('Wechsel zwischen braucht dich und fragt dich klingelt nicht', () => {
  assert.equal(tonFaellig({ a: 'attention' }, snap(s('a', 'question')), 1000, null).spielen, false);
  assert.equal(tonFaellig({ a: 'question' }, snap(s('a', 'attention')), 1000, null).spielen, false);
});

test('neue Session, die nach dem Start gleich rot auftaucht, klingelt', () => {
  const r = tonFaellig({ a: 'running' }, snap(s('a', 'running'), s('b', 'question')), 1000, null);
  assert.equal(r.spielen, true);
  assert.deepEqual(r.stand, { a: 'running', b: 'question' });
});

test('Limit und steht klingeln nicht', () => {
  assert.equal(tonFaellig({ a: 'running' }, snap(s('a', 'limit')), 1000, null).spielen, false);
  assert.equal(tonFaellig({ a: 'running' }, snap(s('a', 'stalled')), 1000, null).spielen, false);
});

test('mehrere gleichzeitig rot ergeben genau einen Ton', () => {
  const r = tonFaellig({ a: 'running', b: 'done' }, snap(s('a', 'attention'), s('b', 'question')), 1000, null);
  assert.equal(r.spielen, true);
  // Danach sind beide gemerkt -- der naechste Stand klingelt nicht noch einmal.
  assert.equal(tonFaellig(r.stand, snap(s('a', 'attention'), s('b', 'question')), 9000, 1000).spielen, false);
});

test('innerhalb des Mindestabstands kein zweiter Ton', () => {
  const r = tonFaellig({ a: 'running' }, snap(s('a', 'attention')), 1000 + MINDESTABSTAND_MS - 1, 1000);
  assert.equal(r.spielen, false);
  // Der Stand wird trotzdem fortgeschrieben, sonst klingelte es spaeter nach.
  assert.deepEqual(r.stand, { a: 'attention' });
});

test('nach dem Mindestabstand klingelt es wieder', () => {
  const r = tonFaellig({ a: 'running' }, snap(s('a', 'attention')), 1000 + MINDESTABSTAND_MS, 1000);
  assert.equal(r.spielen, true);
});

test('leere oder fehlende Session-Liste klingelt nicht', () => {
  assert.deepEqual(tonFaellig({ a: 'running' }, snap(), 1000, null), { spielen: false, stand: {} });
  assert.deepEqual(tonFaellig({ a: 'running' }, { updatedAt: 1 }, 1000, null), { spielen: false, stand: {} });
});

test('Stand vor dem ersten Scan des Servers zaehlt nicht als Stand', () => {
  // Overlay verbindet sich, bevor der Server gescannt hat: leere Liste mit updatedAt 0.
  const leer = tonFaellig(null, { updatedAt: 0, sessions: [] }, 1000, null);
  assert.deepEqual(leer, { spielen: false, stand: null });
  // Der erste echte Stand ist dann der Ausgangspunkt -- kein Ton fuer schon rote Sessions.
  const erst = tonFaellig(leer.stand, snap(s('a', 'attention')), 2000, null);
  assert.equal(erst.spielen, false);

  // Neustart des Servers mitten im Betrieb: der gemerkte Stand bleibt erhalten.
  const neustart = tonFaellig({ a: 'attention' }, { updatedAt: 0, sessions: [] }, 3000, null);
  assert.deepEqual(neustart, { spielen: false, stand: { a: 'attention' } });
  assert.equal(tonFaellig(neustart.stand, snap(s('a', 'attention')), 4000, null).spielen, false);
});
