// Vorwarnung beim Nutzungslimit.
//
// Geprueft wird nur die Entscheidung "jetzt melden oder schweigen" --
// das Versenden selbst braucht einen Push-Dienst und bleibt aussen vor.

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import { PushDienst, LIMIT_SCHWELLE, limitText, rotText, fertigText } from '../lib/push.js';

function dienst() {
  // Pfad ohne Datei: der Dienst startet ohne Abos und schreibt nichts.
  return new PushDienst({ speicherPfad: path.join(os.tmpdir(), 'ampel-test-abos-gibt-es-nicht.json') });
}

const limitMit = (prozent, resetsAt = '2026-09-08T18:00:00Z') => ({
  sitzung: { prozent, resetsAt, gesperrt: null },
  woche: null,
  proModell: [],
  hoechster: prozent,
  stufe: prozent >= 90 ? 'kritisch' : 'normal',
});

test('meldet, sobald das Fuenf-Stunden-Fenster die Schwelle erreicht', () => {
  const p = dienst();
  const warnung = p.neuKnapp(limitMit(LIMIT_SCHWELLE));
  assert.equal(warnung?.prozent, LIMIT_SCHWELLE);
  assert.equal(warnung?.resetsAt, '2026-09-08T18:00:00Z');
});

test('schweigt unterhalb der Schwelle', () => {
  const p = dienst();
  assert.equal(p.neuKnapp(limitMit(LIMIT_SCHWELLE - 1)), null);
});

test('meldet dasselbe Fenster nur ein einziges Mal', () => {
  const p = dienst();
  assert.notEqual(p.neuKnapp(limitMit(90)), null);
  assert.equal(p.neuKnapp(limitMit(93)), null);
  assert.equal(p.neuKnapp(limitMit(99)), null);
});

test('meldet nach dem Fensterwechsel erneut', () => {
  const p = dienst();
  assert.notEqual(p.neuKnapp(limitMit(91, '2026-09-08T18:00:00Z')), null);
  assert.notEqual(p.neuKnapp(limitMit(91, '2026-09-08T23:00:00Z')), null);
});

test('kommt ohne Limitdaten zurecht', () => {
  const p = dienst();
  assert.equal(p.neuKnapp(null), null);
  assert.equal(p.neuKnapp({}), null);
  assert.equal(p.neuKnapp({ sitzung: null }), null);
  assert.equal(p.neuKnapp({ sitzung: { prozent: null, resetsAt: null } }), null);
});

// --- Text der Meldung -------------------------------------------------------
// Bewusst ohne Uhrzeit: die Restdauer ist unabhaengig von der Zeitzone des
// Rechners pruefbar, eine formatierte Uhrzeit waere es nicht.

test('nennt den Fuellstand im Titel', () => {
  const t = limitText({ prozent: 92, resetsAt: null }, Date.now());
  assert.match(t.title, /92/);
});

test('nennt die verbleibende Zeit bis zur Zuruecksetzung', () => {
  const jetzt = Date.parse('2026-09-08T17:00:00Z');
  const t = limitText({ prozent: 90, resetsAt: '2026-09-08T18:05:00Z' }, jetzt);
  assert.match(t.body, /1 h 5 min/);
});

test('nennt Minuten allein, wenn es weniger als eine Stunde ist', () => {
  const jetzt = Date.parse('2026-09-08T17:00:00Z');
  const t = limitText({ prozent: 90, resetsAt: '2026-09-08T17:12:00Z' }, jetzt);
  assert.match(t.body, /12 min/);
  assert.doesNotMatch(t.body, /h /);
});

test('bleibt ohne Reset-Zeit vollstaendig', () => {
  const t = limitText({ prozent: 95, resetsAt: null }, Date.now());
  assert.doesNotMatch(t.body, /undefined|NaN|null/);
  assert.match(t.body, /95/);
});

test('traegt ein festes Kennzeichen, damit sich die Meldung selbst ersetzt', () => {
  const a = limitText({ prozent: 90, resetsAt: null }, Date.now());
  const b = limitText({ prozent: 97, resetsAt: null }, Date.now());
  assert.equal(a.tag, b.tag);
});

// --- Fertig-Meldung ---------------------------------------------------------

const sitzung = (status, extra = {}) => ({ sessionId: 's1', projekt: 'demo', status, ...extra });

test('meldet den Sprung von laeuft auf fertig', () => {
  const p = dienst();
  assert.deepEqual(p.neuFertig([sitzung('running')], 0), []);
  assert.equal(p.neuFertig([sitzung('done')], 2000).length, 1);
});

test('meldet auch eine stehende Session, die doch noch fertig wird', () => {
  const p = dienst();
  p.neuFertig([sitzung('stalled')], 0);
  assert.equal(p.neuFertig([sitzung('done')], 2000).length, 1);
});

test('schweigt bei Sessions, die beim ersten Blick schon fertig sind', () => {
  // Sonst klingelt das Handy bei jedem Serverstart fuer jede offene Session.
  const p = dienst();
  assert.deepEqual(p.neuFertig([sitzung('done')], 0), []);
  assert.deepEqual(p.neuFertig([sitzung('done')], 2000), []);
});

test('meldet denselben Turn nur einmal', () => {
  const p = dienst();
  p.neuFertig([sitzung('running')], 0);
  assert.equal(p.neuFertig([sitzung('done')], 2000).length, 1);
  assert.deepEqual(p.neuFertig([sitzung('done')], 4000), []);
});

test('meldet eine Frage nicht als fertig', () => {
  // Die Frage ist rot und laeuft ueber neuRot -- sonst kaeme sie doppelt.
  const p = dienst();
  p.neuFertig([sitzung('running')], 0);
  assert.deepEqual(p.neuFertig([sitzung('question')], 2000), []);
});

test('faengt kurzes Flackern ab, meldet den naechsten Turn aber wieder', () => {
  const p = dienst();
  p.neuFertig([sitzung('running')], 0);
  assert.equal(p.neuFertig([sitzung('done')], 2000).length, 1);
  p.neuFertig([sitzung('running')], 4000);
  assert.deepEqual(p.neuFertig([sitzung('done')], 6000), []);
  p.neuFertig([sitzung('running')], 120000);
  assert.equal(p.neuFertig([sitzung('done')], 122000).length, 1);
});

test('fertig-Text nennt Projekt und letzte Antwort', () => {
  const t = fertigText(sitzung('done', { lastText: 'Alle Tests gruen.' }));
  assert.match(t.title, /demo/);
  assert.equal(t.body, 'Alle Tests gruen.');
  assert.equal(t.tag, 's1');
});

test('fertig-Text bleibt ohne letzte Antwort vollstaendig', () => {
  const t = fertigText(sitzung('done', { lastText: null }));
  assert.doesNotMatch(t.body, /undefined|null/);
});

// --- Rot-Meldung ------------------------------------------------------------

test('rot-Text nennt bei einer Frage die Frage, nicht Stillstand', () => {
  const t = rotText(sitzung('question', { lastText: 'Soll ich committen?' }));
  assert.equal(t.body, 'Soll ich committen?');
});

test('rot-Text nennt beim Limit das Limit', () => {
  const t = rotText(sitzung('limit', { note: 'zurueck um 18:00' }));
  assert.match(t.body, /Nutzungslimit/);
  assert.match(t.body, /18:00/);
});

test('rot-Text nennt bei einer Freigabe die Meldung von Claude', () => {
  const t = rotText(sitzung('attention', { note: 'Claude needs your permission to use Bash' }));
  assert.match(t.body, /permission/);
});
