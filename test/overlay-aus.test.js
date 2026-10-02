import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { overlayGeschlossen, overlaySchliessenMerken, overlayFreigeben } from '../lib/overlay-aus.cjs';

function basis() {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'ampel-'));
  fs.mkdirSync(path.join(ordner, 'overlay'));
  return ordner;
}

test('von Hand geschlossenes Overlay bleibt zu, bis es freigegeben wird', () => {
  const b = basis();
  assert.equal(overlayGeschlossen(b), false);
  overlaySchliessenMerken(b);
  assert.equal(overlayGeschlossen(b), true);
  overlayFreigeben(b);
  assert.equal(overlayGeschlossen(b), false);
});

test('Freigeben ohne Merker ist kein Fehler', () => {
  // Jeder Start ueber die Verknuepfung gibt frei, auch wenn nichts geschlossen war.
  assert.doesNotThrow(() => overlayFreigeben(basis()));
});
