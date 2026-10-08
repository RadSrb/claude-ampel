import { test } from 'node:test';
import assert from 'node:assert/strict';

import { groupByProject, istAgentSession } from '../lib/grouping.js';

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

test('Terminal-Session: Kachel heisst wie ihr Titel, der Ordner steht im Hinweis', () => {
  const home = { cwd: 'C:\\Users\\Alexander', folder: 'Alexander', projekt: 'Alexander', art: 'terminal' };
  const [mitTitel] = groupByProject([row({ ...home, title: 'iPad-Overlay Session-Öffnung im CMD' })]);
  assert.equal(mitTitel.anzeige, 'iPad-Overlay Session-Öffnung im CMD');
  assert.equal(mitTitel.hinweis, 'Terminal · Alexander');

  const [ohneTitel] = groupByProject([row({ ...home, title: null })]);
  assert.equal(ohneTitel.anzeige, 'Alexander');
  assert.equal(ohneTitel.hinweis, 'Terminal');
});

test('VS-Code-Session und gemischte Gruppe behalten den Projektnamen', () => {
  const [code] = groupByProject([row({ art: 'vscode', title: 'Push und deploy' })]);
  assert.equal(code.anzeige, 'Demo');
  assert.equal(code.hinweis, null);

  const [gemischt] = groupByProject([
    row({ sessionId: 'a', art: 'terminal', title: 'Im CMD' }),
    row({ sessionId: 'b', art: 'vscode', title: 'Im Editor' }),
  ]);
  assert.equal(gemischt.anzeige, 'Demo');
  assert.equal(gemischt.hinweis, null);
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

test('Sessions unter einem Agenten-Ordner gelten als Agenten-Session', () => {
  // Die Website-Sessions legt der Agent an -- zum Mitlesen, nicht zum Anklicken.
  const ordner = ['C:\\Projekte\\01Website'];
  assert.equal(istAgentSession('C:\\Projekte\\01Website\\VeloceEngineeringWebsite', ordner), true);
  assert.equal(istAgentSession('c:/projekte/01website/Demo/', ordner), true);
  assert.equal(istAgentSession('C:\\Projekte\\01Website', ordner), true);
});

test('ein aehnlich benannter Nachbarordner ist keine Agenten-Session', () => {
  const ordner = ['C:\\Projekte\\01Website'];
  assert.equal(istAgentSession('C:\\Projekte\\01WebsiteAlt\\Demo', ordner), false);
  assert.equal(istAgentSession('C:\\Projekte\\ClaudeAmpel', ordner), false);
  assert.equal(istAgentSession(null, ordner), false);
});
