import { test } from 'node:test';
import assert from 'node:assert/strict';

import { StateStore } from '../lib/state.js';

const CFG = { stallSeconds: 300, orphanAfterMinutes: 10 };

const MINUTE = 60 * 1000;

function sess(over = {}) {
  return {
    sessionId: 's1',
    pid: 111,
    name: 'projekt-ab',
    cwd: 'c:\\Projekte\\Demo',
    version: '2.1.263',
    entrypoint: 'claude-vscode',
    startedAt: 1000,
    transcriptPath: 'c:\\x\\s1.jsonl',
    tail: null,
    ...over,
  };
}

function tail(over = {}) {
  return {
    mtime: new Date(),
    size: 100,
    lastEntry: null,
    lastTurn: null,
    lastAssistantText: null,
    aiTitle: null,
    frage: false,
    ...over,
  };
}

const turnDone = { type: 'assistant', role: 'assistant', stopReason: 'end_turn', hasToolUse: false };
const turnTool = { type: 'assistant', role: 'assistant', stopReason: 'tool_use', hasToolUse: true, toolName: 'Bash' };
const turnResult = { type: 'user', role: 'user', stopReason: null, hasToolUse: false, hasToolResult: true };

test('ohne Transkript ist der Status unbekannt, nicht geraten', () => {
  const store = new StateStore(CFG);
  const [s] = store.update([sess({ transcriptPath: null, tail: null, startedAt: Date.now() })]);
  assert.equal(s.status, 'unknown');
  assert.equal(s.color, 'grey');
  assert.equal(s.source, 'none');
  assert.equal(s.orphan, false);
});

test('eine frische Session ohne Transkript gilt nicht als verwaist', () => {
  const store = new StateStore(CFG);
  const [s] = store.update([sess({ transcriptPath: null, tail: null, startedAt: Date.now() - 2 * MINUTE })]);
  assert.equal(s.orphan, false);
});

test('eine alte Session ohne Transkript gilt als verwaist', () => {
  // Genau der Fall der beiden grauen Kacheln: Claude Code hat das Transkript
  // laengst weggeraeumt, die Session laeuft nur noch als vergessener Prozess.
  const store = new StateStore(CFG);
  const [s] = store.update([sess({ transcriptPath: null, tail: null, startedAt: Date.now() - 6 * 24 * 60 * MINUTE })]);
  assert.equal(s.orphan, true);
});

test('ein Hook holt eine verwaiste Session sofort zurueck', () => {
  const store = new StateStore(CFG);
  const alt = { transcriptPath: null, tail: null, startedAt: Date.now() - 6 * 24 * 60 * MINUTE };
  assert.equal(store.update([sess(alt)])[0].orphan, true);
  store.handleHook({ session_id: 's1', hook_event_name: 'UserPromptSubmit' });
  const zurueck = store.update([sess(alt)])[0];
  assert.equal(zurueck.orphan, false);
  assert.equal(zurueck.color, 'yellow');
});

test('eine Session MIT Transkript ist nie verwaist, egal wie alt', () => {
  const store = new StateStore(CFG);
  const [s] = store.update([
    sess({ startedAt: Date.now() - 30 * 24 * 60 * MINUTE, tail: tail({ lastTurn: turnDone }) }),
  ]);
  assert.equal(s.orphan, false);
});

test('abgeleitet: beendeter Turn ist gruen', () => {
  const store = new StateStore(CFG);
  const [s] = store.update([sess({ tail: tail({ lastTurn: turnDone }) })]);
  assert.equal(s.status, 'done');
  assert.equal(s.color, 'green');
  assert.equal(s.source, 'derived');
});

test('abgeleitet: laufender Tool-Aufruf ist gelb', () => {
  const store = new StateStore(CFG);
  const [s] = store.update([sess({ tail: tail({ lastTurn: turnTool }) })]);
  assert.equal(s.status, 'running');
  assert.equal(s.color, 'yellow');
});

test('abgeleitet: ein Tool-Ergebnis bedeutet, Claude arbeitet weiter', () => {
  const store = new StateStore(CFG);
  const [s] = store.update([sess({ tail: tail({ lastTurn: turnResult }) })]);
  assert.equal(s.status, 'running');
  assert.equal(s.color, 'yellow');
});

test('gelb kippt nach der Stall-Schwelle auf rot', () => {
  const store = new StateStore(CFG);
  const alt = new Date(Date.now() - 400 * 1000);
  const [s] = store.update([sess({ tail: tail({ lastTurn: turnTool, mtime: alt }) })]);
  assert.equal(s.status, 'stalled');
  assert.equal(s.color, 'red');
});

test('gruen kippt NICHT auf rot, egal wie alt', () => {
  const store = new StateStore(CFG);
  const uralt = new Date(Date.now() - 86400 * 1000);
  const [s] = store.update([sess({ tail: tail({ lastTurn: turnDone, mtime: uralt }) })]);
  assert.equal(s.status, 'done');
  assert.equal(s.color, 'green');
});

test('ein Turn, der mit einer Frage endet, ist rot statt gruen', () => {
  const store = new StateStore(CFG);
  const [s] = store.update([sess({ tail: tail({ lastTurn: turnDone, frage: true }) })]);
  assert.equal(s.status, 'question');
  assert.equal(s.color, 'red');
});

test('ein Turn ohne Frage bleibt gruen', () => {
  const store = new StateStore(CFG);
  const [s] = store.update([sess({ tail: tail({ lastTurn: turnDone, frage: false }) })]);
  assert.equal(s.color, 'green');
});

test('der Stop-Hook macht aus einer Frage kein Fertig', () => {
  // Der Hook meldet nur "Turn zu Ende" -- die Frage steht nur im Transkript.
  const store = new StateStore(CFG);
  store.handleHook({ session_id: 's1', hook_event_name: 'Stop' });
  const [s] = store.update([sess({ tail: tail({ lastTurn: turnDone, frage: true }) })]);
  assert.equal(s.status, 'question');
  assert.equal(s.color, 'red');
});

test('eine laufende Session wird durch eine alte Frage nicht rot', () => {
  const store = new StateStore(CFG);
  store.handleHook({ session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash' });
  const [s] = store.update([sess({ tail: tail({ lastTurn: turnTool, frage: true }) })]);
  assert.equal(s.color, 'yellow');
});

test('Frage sortiert hinter eine echte Rueckfrage, aber vor alles andere', () => {
  const store = new StateStore(CFG);
  const rows = store.update([
    sess({ sessionId: 'laeuft', tail: tail({ lastTurn: turnTool }) }),
    sess({ sessionId: 'frage', tail: tail({ lastTurn: turnDone, frage: true }) }),
    sess({ sessionId: 'fertig', tail: tail({ lastTurn: turnDone }) }),
  ]);
  store.handleHook({ session_id: 'freigabe', hook_event_name: 'Notification', message: 'darf ich?' });
  const mitFreigabe = store.update([
    sess({ sessionId: 'freigabe' }),
    ...[
      sess({ sessionId: 'laeuft', tail: tail({ lastTurn: turnTool }) }),
      sess({ sessionId: 'frage', tail: tail({ lastTurn: turnDone, frage: true }) }),
      sess({ sessionId: 'fertig', tail: tail({ lastTurn: turnDone }) }),
    ],
  ]);
  assert.deepEqual(
    mitFreigabe.map((r) => r.sessionId),
    ['freigabe', 'frage', 'laeuft', 'fertig'],
  );
  assert.equal(rows[0].sessionId, 'frage');
});

test('Notification-Hook macht rot und traegt den Text', () => {
  const store = new StateStore(CFG);
  store.update([sess({ tail: tail({ lastTurn: turnTool }) })]);
  store.handleHook({ session_id: 's1', hook_event_name: 'Notification', message: 'Claude braucht deine Erlaubnis fuer Bash' });
  const [s] = store.update([sess({ tail: tail({ lastTurn: turnTool }) })]);
  assert.equal(s.status, 'attention');
  assert.equal(s.color, 'red');
  assert.equal(s.note, 'Claude braucht deine Erlaubnis fuer Bash');
  assert.equal(s.source, 'hook');
});

test('Hook schlaegt die Ableitung dauerhaft', () => {
  const store = new StateStore(CFG);
  store.handleHook({ session_id: 's1', hook_event_name: 'Stop' });
  // Das Transkript sagt "laeuft" -- der Hook weiss es besser.
  const [s] = store.update([sess({ tail: tail({ lastTurn: turnTool }) })]);
  assert.equal(s.status, 'done');
  assert.equal(s.source, 'hook');
});

test('Hook-Reihenfolge Prompt -> Tool -> Stop faerbt gelb, gelb, gruen', () => {
  const store = new StateStore(CFG);
  store.handleHook({ session_id: 's1', hook_event_name: 'UserPromptSubmit' });
  assert.equal(store.update([sess()])[0].color, 'yellow');

  store.handleHook({ session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Edit' });
  const laufend = store.update([sess()])[0];
  assert.equal(laufend.color, 'yellow');
  assert.equal(laufend.note, 'Edit');

  store.handleHook({ session_id: 's1', hook_event_name: 'Stop' });
  assert.equal(store.update([sess()])[0].color, 'green');
});

test('Notification bleibt rot, bis wirklich etwas passiert', () => {
  const store = new StateStore(CFG);
  store.handleHook({ session_id: 's1', hook_event_name: 'Notification', message: 'wartet' });
  assert.equal(store.update([sess()])[0].color, 'red');
  // Ein Scan allein darf das Rot nicht wegwischen.
  assert.equal(store.update([sess({ tail: tail({ lastTurn: turnDone }) })])[0].color, 'red');
  store.handleHook({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Bash' });
  assert.equal(store.update([sess()])[0].color, 'yellow');
});

test('SubagentStop laesst eine laufende Session gelb', () => {
  const store = new StateStore(CFG);
  store.handleHook({ session_id: 's1', hook_event_name: 'UserPromptSubmit' });
  store.handleHook({ session_id: 's1', hook_event_name: 'SubagentStop' });
  assert.equal(store.update([sess()])[0].color, 'yellow');
});

test('verschwundene Sessions fallen aus der Liste', () => {
  const store = new StateStore(CFG);
  store.update([sess(), sess({ sessionId: 's2', pid: 222 })]);
  const nurEine = store.update([sess()]);
  assert.deepEqual(
    nurEine.map((s) => s.sessionId),
    ['s1'],
  );
});

test('since wird nur bei echtem Statuswechsel neu gesetzt', async () => {
  const store = new StateStore(CFG);
  const ersteRunde = store.update([sess({ tail: tail({ lastTurn: turnDone }) })])[0];
  await new Promise((r) => setTimeout(r, 12));
  const zweiteRunde = store.update([sess({ tail: tail({ lastTurn: turnDone }) })])[0];
  assert.equal(ersteRunde.since, zweiteRunde.since);

  const gewechselt = store.update([sess({ tail: tail({ lastTurn: turnTool }) })])[0];
  assert.notEqual(gewechselt.since, ersteRunde.since);
});

test('Sortierung: rot vor gelb vor gruen vor grau', () => {
  const store = new StateStore(CFG);
  const sessions = [
    sess({ sessionId: 'gruen', tail: tail({ lastTurn: turnDone }) }),
    sess({ sessionId: 'grau', transcriptPath: null }),
    sess({ sessionId: 'gelb', tail: tail({ lastTurn: turnTool }) }),
    sess({ sessionId: 'rot', tail: tail({ lastTurn: turnTool, mtime: new Date(Date.now() - 400e3) }) }),
  ];
  assert.deepEqual(
    store.update(sessions).map((s) => s.sessionId),
    ['rot', 'gelb', 'gruen', 'grau'],
  );
});

test('unbekannte Hook-SessionId legt keinen Geisterzustand an', () => {
  const store = new StateStore(CFG);
  store.handleHook({ session_id: 'gibt-es-nicht', hook_event_name: 'Stop' });
  assert.deepEqual(store.update([sess()]).map((s) => s.sessionId), ['s1']);
});
