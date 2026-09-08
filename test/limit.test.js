import { test } from 'node:test';
import assert from 'node:assert/strict';

import { limitStand } from '../lib/scanner.js';
import { StateStore } from '../lib/state.js';

// Wortlaut aus einem echten Transkript (WorkExpert, 5 Vorkommen).
const ECHT = "You've hit your session limit · resets 4:50pm (Europe/Vienna)";

test('erkennt das echte Nutzungslimit', () => {
  const s = limitStand(ECHT);
  assert.ok(s, 'sollte erkannt werden');
  assert.equal(s.zurueckUm, '4:50pm');
  assert.equal(s.zone, 'Europe/Vienna');
});

test('erkennt es auch am Ende einer laengeren Nachricht', () => {
  const s = limitStand('Der Lauf ist durch, alles gruen.\n\n' + ECHT);
  assert.ok(s);
  assert.equal(s.zurueckUm, '4:50pm');
});

test('kommt ohne Zonenangabe zurecht', () => {
  const s = limitStand("You've hit your session limit · resets 12:30pm");
  assert.ok(s);
  assert.equal(s.zurueckUm, '12:30pm');
  assert.equal(s.zone, null);
});

test('erkennt die usage-limit-Variante', () => {
  assert.ok(limitStand('Claude usage limit reached. Your limit will reset at 9am.'));
});

test('meldet nichts bei gewoehnlichem Text', () => {
  // Der teuerste Fehler waere ein Fehlalarm: eine fertige Session als
  // blockiert auszuweisen. Deshalb explizit gegengeprueft.
  assert.equal(limitStand('Alles gruen, 121 stimmige Saetze.'), null);
  assert.equal(limitStand('Ich habe das Limit der Spaltenbreite angehoben.'), null);
  assert.equal(limitStand('Wir sollten das session limit im Code pruefen.'), null);
  assert.equal(limitStand(''), null);
  assert.equal(limitStand(null), null);
});

// --- Zusammenspiel mit der Zustandsmaschine -------------------------------

const GRENZE = { zurueckUm: '4:50pm', zone: 'Europe/Vienna' };
const CWD = 'c:\\Projekte\\WorkExpert';

function session(tailOver) {
  return [
    {
      sessionId: 's1',
      pid: 111,
      name: 'workexpert',
      cwd: CWD,
      version: '2.1.263',
      entrypoint: 'claude-vscode',
      startedAt: 1000,
      transcriptPath: 'c:\\x\\s1.jsonl',
      tail: {
        mtime: new Date(),
        size: 100,
        lastEntry: null,
        lastTurn: { type: 'assistant', role: 'assistant', stopReason: 'stop_sequence', hasToolUse: false },
        lastAssistantText: ECHT,
        aiTitle: null,
        frage: false,
        ...tailOver,
      },
    },
  ];
}

const CFG = { stallSeconds: 300, orphanAfterMinutes: 10 };

test('das Limit wird rot und steht ganz oben', () => {
  const store = new StateStore(CFG);
  const [row] = store.update(session({ limit: GRENZE }));
  assert.equal(row.status, 'limit');
  assert.equal(row.color, 'red');
  assert.match(row.note ?? '', /4:50pm/);
});

test('das Limit schlaegt den Stop-Hook, der "fertig" meldet', () => {
  // Der entscheidende Fall: der Hook meldet pflichtgemaess "Turn zu Ende" und
  // faerbte bisher gruen -- obwohl Claude gegen eine Wand gelaufen ist.
  const store = new StateStore(CFG);
  store.handleHook({ session_id: 's1', hook_event_name: 'Stop', cwd: CWD });
  const [row] = store.update(session({ limit: GRENZE }));
  assert.equal(row.status, 'limit', 'darf nicht "done" bleiben');
  assert.equal(row.color, 'red');
});

test('ohne Limit bleibt alles wie bisher', () => {
  const store = new StateStore(CFG);
  const [row] = store.update(
    session({
      limit: null,
      lastAssistantText: 'Alles gruen.',
      lastTurn: { type: 'assistant', role: 'assistant', stopReason: 'end_turn', hasToolUse: false },
    }),
  );
  assert.equal(row.status, 'done');
  assert.equal(row.color, 'green');
});
