// Vorwarnung beim Nutzungslimit.
//
// Geprueft wird nur die Entscheidung "jetzt melden oder schweigen" --
// das Versenden selbst braucht einen Push-Dienst und bleibt aussen vor.

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import { PushDienst, LIMIT_SCHWELLE, limitText } from '../lib/push.js';

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
