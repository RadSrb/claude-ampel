import { test } from 'node:test';
import assert from 'node:assert/strict';

import { entscheide } from '../lib/fortfahren.js';

const mensch = (text) => ({ type: 'user', entrypoint: 'claude-vscode', message: { role: 'user', content: text } });
const werkzeug = (name = 'Bash') => ({
  type: 'assistant',
  entrypoint: 'claude-vscode',
  message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name, input: {} }] },
});
const ergebnis = () => ({
  type: 'user',
  entrypoint: 'claude-vscode',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
});
const ende = (text) => ({
  type: 'assistant',
  entrypoint: 'claude-vscode',
  message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text }] },
});

const arbeit = (schluss) => [mensch('bau das'), werkzeug(), ergebnis(), ende(schluss)];

test('nach getaner Arbeit ohne Frage geht es automatisch weiter', () => {
  const r = entscheide(arbeit('P1.8 ist eingebaut. Die naechsten Pakete starte ich danach.'), {});
  assert.equal(r?.decision, 'block');
  assert.match(r.reason, /fahre fort/i);
});

test('eine Rueckfrage wird nicht uebergangen', () => {
  assert.equal(entscheide(arbeit('Soll ich die Spalte umbenennen?'), {}), null);
});

test('ein offenes Auswahl-Widget wird nicht uebergangen', () => {
  const e = [mensch('bau das'), werkzeug('AskUserQuestion')];
  assert.equal(entscheide(e, {}), null);
});

test('am Nutzungslimit wird nicht weitergedrueckt', () => {
  assert.equal(entscheide(arbeit("You've hit your session limit · resets 12:30pm (Europe/Vienna)"), {}), null);
});

test('eine reine Gespraechsantwort ohne Werkzeug endet normal', () => {
  assert.equal(entscheide([mensch('was ist X'), ende('X ist Y.')], {}), null);
});

test('zweimal hintereinander wird nicht fortgesetzt (keine Endlosschleife)', () => {
  assert.equal(entscheide(arbeit('Fertig.'), { stop_hook_active: true }), null);
});

test('Skriptlaeufe mit claude -p bleiben unangetastet', () => {
  const e = arbeit('Ergebnis: 42').map((x) => ({ ...x, entrypoint: 'sdk-cli' }));
  assert.equal(entscheide(e, {}), null);
});

test('das Terminal-CLI wird genauso fortgesetzt wie VS Code', () => {
  const e = arbeit('Teil 1 steht.').map((x) => ({ ...x, entrypoint: 'cli' }));
  assert.equal(entscheide(e, {})?.decision, 'block');
});

test('Werkzeuge aus einem frueheren Auftrag zaehlen nicht', () => {
  const e = [...arbeit('Erledigt.'), mensch('danke, was heisst das?'), ende('Das heisst Y.')];
  assert.equal(entscheide(e, {}), null);
});

test('eine Hintergrund-Meldung ist kein neuer Auftrag', () => {
  // Nach einer task-notification arbeitet Claude im selben Auftrag weiter.
  const meldung = { type: 'user', isMeta: true, entrypoint: 'claude-vscode', message: { role: 'user', content: 'Another Claude session sent a message: ...' } };
  const notif = { type: 'user', entrypoint: 'claude-vscode', message: { role: 'user', content: '<task-notification>fertig</task-notification>' } };
  const e = [mensch('bau das'), werkzeug('Agent'), ergebnis(), ende('Agent laeuft.'), meldung, notif, ende('Bericht eingearbeitet.')];
  assert.equal(entscheide(e, {})?.decision, 'block');
});

test('der Text aus dem Hook-Aufruf hat Vorrang vor dem Transkript', () => {
  // Der Stop-Hook kann feuern, bevor die letzte Zeile im Transkript steht.
  const r = entscheide(arbeit('Teil 1 steht.'), { last_assistant_message: 'Passt das so?' });
  assert.equal(r, null);
});

test('mit Ausschalter passiert nichts', () => {
  assert.equal(entscheide(arbeit('Teil 1 steht.'), {}, { aus: true }), null);
});
