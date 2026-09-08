import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fensterFuer, passtZurFamilie, STANDARD_FENSTER, GROSSES_FENSTER } from '../lib/kontextfenster.js';

test('ohne Anhaltspunkt gilt das Standardfenster', () => {
  assert.deepEqual(fensterFuer('claude-opus-5', 50_000), { fenster: STANDARD_FENSTER, quelle: 'standard' });
});

test('der [1m]-Zusatz aus den Einstellungen ergibt das grosse Fenster', () => {
  const r = fensterFuer('claude-opus-5', 50_000, { settingsWert: 'opus[1m]' });
  assert.deepEqual(r, { fenster: GROSSES_FENSTER, quelle: 'einstellung' });
});

test('eine Sonnet-Session erbt das grosse Opus-Fenster nicht', () => {
  // Genau der Fehler, den ein reiner Blick in settings.json machen wuerde.
  const r = fensterFuer('claude-sonnet-5', 50_000, { settingsWert: 'opus[1m]' });
  assert.equal(r.fenster, STANDARD_FENSTER);
});

test('ohne [1m] bleibt es beim Standardfenster', () => {
  assert.equal(fensterFuer('claude-opus-5', 50_000, { settingsWert: 'opus' }).fenster, STANDARD_FENSTER);
});

test('gemessener Verbrauch ueber 200k beweist das grosse Fenster', () => {
  const r = fensterFuer('claude-opus-5', 443_392);
  assert.deepEqual(r, { fenster: GROSSES_FENSTER, quelle: 'gemessen' });
});

test('die Umgebungsvariable schlaegt alles', () => {
  const r = fensterFuer('claude-opus-5', 500_000, { settingsWert: 'opus[1m]', envMax: 350_000 });
  assert.deepEqual(r, { fenster: 350_000, quelle: 'env' });
});

test('passtZurFamilie trennt die Modellfamilien', () => {
  assert.equal(passtZurFamilie('claude-opus-5', 'opus[1m]'), true);
  assert.equal(passtZurFamilie('claude-opus-5-20260101', 'opus[1m]'), true);
  assert.equal(passtZurFamilie('claude-sonnet-5', 'opus[1m]'), false);
  assert.equal(passtZurFamilie('claude-fable-5-1', 'opus[1m]'), false);
  assert.equal(passtZurFamilie(null, 'opus[1m]'), false);
  assert.equal(passtZurFamilie('claude-opus-5', null), false);
});
