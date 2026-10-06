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

test('die Aktivitaetszeit ist das Juengere aus Hook und Transkript', () => {
  // Ohne Pre-/PostToolUse-Hooks meldet sich der Hook nur beim Prompt. Das
  // Transkript waechst danach mit jedem Werkzeugaufruf weiter -- diese
  // Bewegung muss zaehlen, sonst steht eine arbeitende Session nach fuenf
  // Minuten faelschlich auf "steht".
  const store = new StateStore(CFG);
  const now = Date.now();
  store.handleHook({ session_id: 's1', hook_event_name: 'UserPromptSubmit' });
  store.hookState.get('s1').lastActivity = now - 6 * MINUTE;
  const frisch = new Date(now - 10 * 1000);
  const [s] = store.update([sess({ tail: tail({ lastTurn: turnTool, mtime: frisch }) })], now);
  assert.equal(s.status, 'running');
  assert.equal(s.lastActivity, frisch.getTime());
});

test('ohne Hook-Notiz kommt der Werkzeugname aus dem Transkript', () => {
  const store = new StateStore(CFG);
  store.handleHook({ session_id: 's1', hook_event_name: 'UserPromptSubmit' });
  const [s] = store.update([sess({ tail: tail({ lastTurn: turnTool }) })]);
  assert.equal(s.note, 'Bash');
});

test('eine Freigabe-Anfrage bleibt rot, bis das Gespraech danach weitergeht', () => {
  const store = new StateStore(CFG);
  store.handleHook({ session_id: 's1', hook_event_name: 'Notification', message: 'Claude needs your permission' });
  const anfrage = store.hookState.get('s1').since;

  // Der Werkzeugaufruf stand schon vor der Anfrage im Transkript: weiter rot.
  const davor = { ...turnTool, timestamp: new Date(anfrage - 2000).toISOString() };
  let [s] = store.update([sess({ tail: tail({ lastTurn: davor }) })]);
  assert.equal(s.status, 'attention');

  // Ohne Zeitstempel laesst sich nichts beweisen: weiter rot.
  [s] = store.update([sess({ tail: tail({ lastTurn: turnResult }) })]);
  assert.equal(s.status, 'attention');

  // Das Werkzeugergebnis kam nach der Anfrage: du hast entschieden, es laeuft.
  const danach = { ...turnResult, timestamp: new Date(anfrage + 2000).toISOString() };
  [s] = store.update([sess({ tail: tail({ lastTurn: danach }) })]);
  assert.equal(s.status, 'running');
  assert.equal(s.color, 'yellow');
});

test('eine Anfrage nach beendetem Turn bleibt rot, auch wenn das Transkript juenger ist', () => {
  // "Claude wartet auf deine Eingabe" kommt nach dem Turn-Ende. Ein beendeter
  // Turn ist kein Weiterlaufen -- die Anfrage darf nicht verschwinden.
  const store = new StateStore(CFG);
  store.handleHook({ session_id: 's1', hook_event_name: 'Notification', message: 'waiting' });
  const anfrage = store.hookState.get('s1').since;
  const ende = { ...turnDone, timestamp: new Date(anfrage + 2000).toISOString() };
  const [s] = store.update([sess({ tail: tail({ lastTurn: ende }) })]);
  assert.equal(s.status, 'attention');
});

test('ein arbeitender Subagent haelt die Session gelb, auch wenn das Haupt-Transkript schweigt', () => {
  // Waehrend ein Agent-Werkzeug laeuft, schreibt nur der Subagent -- in
  // <session>/subagents/agent-*.jsonl. Das Haupt-Transkript bleibt stehen.
  const store = new StateStore(CFG);
  const alt = new Date(Date.now() - 400 * 1000);
  const agent = { ...turnTool, toolName: 'Agent' };
  const [s] = store.update([sess({ subagentMtime: Date.now() - 5000, tail: tail({ lastTurn: agent, mtime: alt }) })]);
  assert.equal(s.status, 'running');
  assert.equal(s.color, 'yellow');
});

test('ein offenes Auswahl-Widget ist rot, nicht gelb', () => {
  // Claude hat AskUserQuestion aufgerufen und wartet. Im Transkript steht das
  // als Werkzeugaufruf mit stop_reason tool_use -- wie jede laufende Arbeit.
  const store = new StateStore(CFG);
  const widget = { ...turnTool, toolName: 'AskUserQuestion', wartet: true };
  const [s] = store.update([sess({ tail: tail({ lastTurn: widget }) })]);
  assert.equal(s.status, 'question');
  assert.equal(s.color, 'red');
  assert.equal(s.note, 'Auswahl offen');
});

test('ein offenes Auswahl-Widget schlaegt auch den UserPromptSubmit-Hook', () => {
  const store = new StateStore(CFG);
  store.handleHook({ session_id: 's1', hook_event_name: 'UserPromptSubmit' });
  const widget = { ...turnTool, toolName: 'ExitPlanMode', wartet: true };
  const [s] = store.update([sess({ tail: tail({ lastTurn: widget }) })]);
  assert.equal(s.status, 'question');
});

test('ein offenes Widget kippt nach Minuten nicht auf "steht"', () => {
  const store = new StateStore(CFG);
  const widget = { ...turnTool, toolName: 'AskUserQuestion', wartet: true };
  const [s] = store.update([sess({ tail: tail({ lastTurn: widget, mtime: new Date(Date.now() - 20 * MINUTE) }) })]);
  assert.equal(s.status, 'question');
});

test('nach der Antwort auf das Widget laeuft es wieder', () => {
  const store = new StateStore(CFG);
  store.handleHook({ session_id: 's1', hook_event_name: 'UserPromptSubmit' });
  const [s] = store.update([sess({ tail: tail({ lastTurn: turnResult }) })]);
  assert.equal(s.status, 'running');
});

test('eine Session, die nach dem Stop-Hook von selbst weiterlaeuft, wird wieder gelb', () => {
  // Meldet ein Hintergrund-Agent sich zurueck (task-notification, agent-message),
  // arbeitet Claude ohne neue Eingabe weiter -- es kommt kein UserPromptSubmit.
  // Der Stop-Hook hielt die Kachel bis zum naechsten Stop faelschlich gruen.
  const store = new StateStore(CFG);
  store.handleHook({ session_id: 's1', hook_event_name: 'Stop' });
  const stop = store.hookState.get('s1').since;
  const weiter = { ...turnTool, timestamp: new Date(stop + 3000).toISOString() };
  const [s] = store.update([sess({ tail: tail({ lastTurn: weiter }) })]);
  assert.equal(s.status, 'running');
  assert.equal(s.color, 'yellow');
});

test('nach dem Stop-Hook bleibt es gruen, solange das Transkript nichts Neueres zeigt', () => {
  const store = new StateStore(CFG);
  store.handleHook({ session_id: 's1', hook_event_name: 'Stop' });
  const stop = store.hookState.get('s1').since;
  const ende = { ...turnDone, timestamp: new Date(stop - 500).toISOString() };
  const [s] = store.update([sess({ tail: tail({ lastTurn: ende }) })]);
  assert.equal(s.status, 'done');
});

test('Hintergrund-Agenten halten eine Session mit beendetem Turn gelb', () => {
  // Der Haupt-Turn ist zu Ende, aber Agenten mit run_in_background schreiben
  // weiter in subagents/. Die Session arbeitet -- nur nicht im sichtbaren Chat.
  const store = new StateStore(CFG);
  store.handleHook({ session_id: 's1', hook_event_name: 'Stop' });
  const ende = { ...turnDone, timestamp: new Date(Date.now() - 4 * MINUTE).toISOString() };
  const [s] = store.update([sess({ subagentMtime: Date.now() - 2000, tail: tail({ lastTurn: ende }) })]);
  assert.equal(s.status, 'running');
  assert.equal(s.note, 'Hintergrund-Agenten');
});

test('ein Subagent, der vor dem Turn-Ende zuletzt schrieb, haelt nichts gelb', () => {
  const store = new StateStore(CFG);
  const endeMs = Date.now() - 60 * 1000;
  const ende = { ...turnDone, timestamp: new Date(endeMs).toISOString() };
  const [s] = store.update([sess({ subagentMtime: endeMs - 5000, tail: tail({ lastTurn: ende }) })]);
  assert.equal(s.status, 'done');
});

test('ein seit Langem stiller Hintergrund-Agent faerbt eine fertige Session nicht gelb', () => {
  const store = new StateStore(CFG);
  const ende = { ...turnDone, timestamp: new Date(Date.now() - 20 * MINUTE).toISOString() };
  const [s] = store.update([sess({ subagentMtime: Date.now() - 10 * MINUTE, tail: tail({ lastTurn: ende }) })]);
  assert.equal(s.status, 'done');
});

test('eine Frage bleibt rot, auch wenn Hintergrund-Agenten arbeiten', () => {
  const store = new StateStore(CFG);
  const ende = { ...turnDone, timestamp: new Date(Date.now() - MINUTE).toISOString() };
  const [s] = store.update([sess({ subagentMtime: Date.now() - 2000, tail: tail({ lastTurn: ende, frage: true }) })]);
  assert.equal(s.status, 'question');
});

test('ein seit Langem stiller Subagent kippt trotzdem auf rot', () => {
  const store = new StateStore(CFG);
  const alt = new Date(Date.now() - 400 * 1000);
  const agent = { ...turnTool, toolName: 'Agent' };
  const [s] = store.update([sess({ subagentMtime: Date.now() - 350 * 1000, tail: tail({ lastTurn: agent, mtime: alt }) })]);
  assert.equal(s.status, 'stalled');
});

test('nach einer erledigten Freigabe verschwindet auch ihr Hinweistext', () => {
  const store = new StateStore(CFG);
  store.handleHook({ session_id: 's1', hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' });
  const anfrage = store.hookState.get('s1').since;
  const danach = { ...turnTool, toolName: 'Write', timestamp: new Date(anfrage + 2000).toISOString() };
  const [s] = store.update([sess({ tail: tail({ lastTurn: danach }) })]);
  assert.equal(s.status, 'running');
  assert.equal(s.note, 'Write');
});
