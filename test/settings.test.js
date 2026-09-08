import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { oeffentlich, pruefen, sichern, brauchtNeustart, FELDER } from '../lib/settings.js';

test('oeffentlich liefert Standardwerte und niemals Geheimnisse', () => {
  const o = oeffentlich({ token: 'geheim', vapid: { privateKey: 'auch geheim' }, stallSeconds: 60 });
  assert.equal(o.stallSeconds, 60);
  assert.equal(o.orphanAfterMinutes, FELDER.orphanAfterMinutes.standard);
  assert.equal(o.token, undefined);
  assert.equal(o.vapid, undefined);
});

test('pruefen uebernimmt gueltige Werte und rundet', () => {
  const { uebernommen, fehler } = pruefen({ stallSeconds: '120', orphanAfterMinutes: 5.6 });
  assert.deepEqual(uebernommen, { stallSeconds: 120, orphanAfterMinutes: 6 });
  assert.deepEqual(fehler, []);
});

test('pruefen weist Werte ausserhalb der Grenzen zurueck', () => {
  const { uebernommen, fehler } = pruefen({ stallSeconds: 5, port: 99999 });
  assert.deepEqual(uebernommen, {});
  assert.equal(fehler.length, 2);
});

test('pruefen verwirft unbekannte Felder -- auch das Token', () => {
  const { uebernommen } = pruefen({ token: 'uebernommen?', vapid: { x: 1 }, stallSeconds: 90 });
  assert.deepEqual(uebernommen, { stallSeconds: 90 });
});

test('pruefen meldet Unsinn statt ihn zu uebernehmen', () => {
  const { uebernommen, fehler } = pruefen({ stallSeconds: 'bald' });
  assert.deepEqual(uebernommen, {});
  assert.equal(fehler.length, 1);
});

test('sichern laesst Token und Schluessel unangetastet', () => {
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ampel-cfg-')), 'config.json');
  fs.writeFileSync(datei, JSON.stringify({ token: 'geheim', vapid: { privateKey: 'k' }, stallSeconds: 300 }));

  const neu = sichern(datei, { stallSeconds: 45 });
  assert.equal(neu.stallSeconds, 45);
  assert.equal(neu.token, 'geheim');
  assert.equal(neu.vapid.privateKey, 'k');

  const vonPlatte = JSON.parse(fs.readFileSync(datei, 'utf8'));
  assert.equal(vonPlatte.token, 'geheim');
  assert.equal(vonPlatte.stallSeconds, 45);
});

test('brauchtNeustart meldet nur die wirklich geaenderten Neustart-Felder', () => {
  assert.deepEqual(brauchtNeustart({ port: 4318 }, { port: 4317 }), ['port']);
  assert.deepEqual(brauchtNeustart({ port: 4317 }, { port: 4317 }), []);
  assert.deepEqual(brauchtNeustart({ stallSeconds: 60 }, { stallSeconds: 300 }), []);
});
