import { test } from 'node:test';
import assert from 'node:assert/strict';

import { groupByProject } from '../lib/grouping.js';

function row(over = {}) {
  return {
    sessionId: 's1',
    cwd: 'c:\\Projekte\\Demo',
    folder: 'Demo',
    color: 'green',
    status: 'done',
    since: 1000,
    ports: [],
    ...over,
  };
}

test('eine einzelne Session ergibt eine Gruppe mit einer Untersession', () => {
  const [g] = groupByProject([row()]);
  assert.equal(g.folder, 'Demo');
  assert.equal(g.sessions.length, 1);
  assert.equal(g.color, 'green');
});

test('zwei Sessions im selben Projekt landen in einer Gruppe', () => {
  const gruppen = groupByProject([
    row({ sessionId: 'a' }),
    row({ sessionId: 'b', color: 'yellow', status: 'running' }),
  ]);
  assert.equal(gruppen.length, 1);
  assert.deepEqual(
    gruppen[0].sessions.map((s) => s.sessionId),
    ['b', 'a'],
  );
});

test('die Gruppe traegt den dringendsten Zustand ihrer Sessions', () => {
  const [g] = groupByProject([
    row({ sessionId: 'a', color: 'green', status: 'done' }),
    row({ sessionId: 'b', color: 'red', status: 'attention' }),
    row({ sessionId: 'c', color: 'yellow', status: 'running' }),
  ]);
  assert.equal(g.color, 'red');
  assert.equal(g.status, 'attention');
  // Innerhalb der Gruppe steht das Dringendste oben.
  assert.deepEqual(
    g.sessions.map((s) => s.sessionId),
    ['b', 'c', 'a'],
  );
});

test('gleicher Ordnername in verschiedenen Pfaden bleibt getrennt', () => {
  const gruppen = groupByProject([
    row({ sessionId: 'a', cwd: 'c:\\Projekte\\Demo', folder: 'Demo' }),
    row({ sessionId: 'b', cwd: 'd:\\Anderswo\\Demo', folder: 'Demo' }),
  ]);
  assert.equal(gruppen.length, 2);
});

test('Gross-/Kleinschreibung im Pfad trennt nicht', () => {
  const gruppen = groupByProject([
    row({ sessionId: 'a', cwd: 'c:\\Projekte\\Demo' }),
    row({ sessionId: 'b', cwd: 'C:\\PROJEKTE\\Demo' }),
  ]);
  assert.equal(gruppen.length, 1);
  assert.equal(gruppen[0].sessions.length, 2);
});

test('Ports des Projekts stehen einmal auf der Gruppe, nicht je Session', () => {
  const [g] = groupByProject([
    row({ sessionId: 'a', ports: [3000, 3001] }),
    row({ sessionId: 'b', ports: [3000] }),
  ]);
  assert.deepEqual(g.ports, [3000, 3001]);
});

test('Gruppen sind nach Dringlichkeit sortiert', () => {
  const gruppen = groupByProject([
    row({ sessionId: 'a', cwd: 'c:\\p\\gruen', folder: 'gruen', color: 'green', status: 'done' }),
    row({ sessionId: 'b', cwd: 'c:\\p\\rot', folder: 'rot', color: 'red', status: 'stalled' }),
    row({ sessionId: 'c', cwd: 'c:\\p\\gelb', folder: 'gelb', color: 'yellow', status: 'running' }),
  ]);
  assert.deepEqual(
    gruppen.map((g) => g.folder),
    ['rot', 'gelb', 'gruen'],
  );
});

test('bei gleichem Zustand entscheidet die aeltere Gruppe', () => {
  const gruppen = groupByProject([
    row({ sessionId: 'neu', cwd: 'c:\\p\\neu', folder: 'neu', color: 'red', status: 'stalled', since: 5000 }),
    row({ sessionId: 'alt', cwd: 'c:\\p\\alt', folder: 'alt', color: 'red', status: 'stalled', since: 1000 }),
  ]);
  assert.deepEqual(
    gruppen.map((g) => g.folder),
    ['alt', 'neu'],
  );
});
