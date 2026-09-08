import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  neustartEntscheidung,
  CODE_PORT_BELEGT,
  FEHLSTART_MS,
  MAX_FEHLSTARTS,
} from '../lib/watchdog-regel.js';

const LANG = FEHLSTART_MS * 10;

test('nach einem langen Lauf wird sofort neu gestartet', () => {
  const u = neustartEntscheidung({ code: 1, laufzeitMs: LANG, fehlstarts: 0 });
  assert.equal(u.neustart, true);
  assert.equal(u.wartenMs, 1000);
  assert.equal(u.fehlstarts, 0);
});

test('ein langer Lauf setzt den Fehlstartzaehler zurueck', () => {
  const u = neustartEntscheidung({ code: 1, laufzeitMs: LANG, fehlstarts: 3 });
  assert.equal(u.neustart, true);
  assert.equal(u.fehlstarts, 0);
});

test('belegter Port fuehrt nie zum Neustart', () => {
  // Sonst dreht sich der Waechter im Kreis, waehrend der echte Server laeuft.
  const u = neustartEntscheidung({ code: CODE_PORT_BELEGT, laufzeitMs: 200, fehlstarts: 0 });
  assert.equal(u.neustart, false);
  assert.match(u.grund, /Port belegt/);
});

test('Fehlstarts warten immer laenger', () => {
  const eins = neustartEntscheidung({ code: 1, laufzeitMs: 100, fehlstarts: 0 });
  const zwei = neustartEntscheidung({ code: 1, laufzeitMs: 100, fehlstarts: 1 });
  const drei = neustartEntscheidung({ code: 1, laufzeitMs: 100, fehlstarts: 2 });
  assert.equal(eins.wartenMs, 2000);
  assert.equal(zwei.wartenMs, 4000);
  assert.equal(drei.wartenMs, 8000);
  assert.equal(drei.fehlstarts, 3);
});

test('die Wartezeit waechst nicht ins Uferlose', () => {
  const u = neustartEntscheidung({ code: 1, laufzeitMs: 100, fehlstarts: MAX_FEHLSTARTS - 2 });
  assert.ok(u.neustart);
  assert.ok(u.wartenMs <= 30000);
});

test('nach genug Fehlstarts gibt der Waechter auf', () => {
  const u = neustartEntscheidung({ code: 1, laufzeitMs: 100, fehlstarts: MAX_FEHLSTARTS - 1 });
  assert.equal(u.neustart, false);
  assert.match(u.grund, /Fehlstarts/);
});

test('beim eigenen Herunterfahren kein Neustart', () => {
  const u = neustartEntscheidung({ code: null, signal: 'SIGTERM', laufzeitMs: LANG, fehlstarts: 0, beendet: true });
  assert.equal(u.neustart, false);
});

test('auch ein sauberes Ende wird wieder hochgezogen', () => {
  // Der Server soll dauerhaft laufen -- Code 0 heisst nicht "gewollt beendet".
  const u = neustartEntscheidung({ code: 0, laufzeitMs: LANG, fehlstarts: 0 });
  assert.equal(u.neustart, true);
});
