import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cached } from '../lib/shell.js';

test('liefert innerhalb der Frist den gemerkten Wert', async () => {
  let rufe = 0;
  const holen = cached(async () => ++rufe, 60_000);

  assert.equal(await holen(), 1);
  assert.equal(await holen(), 1);
  assert.equal(rufe, 1);
});

test('vergisst auf Zuruf und fragt neu', async () => {
  // Ohne das meldete der Overlay-Start nach einem Stop noch das eben
  // beendete Overlay -- und tat wortlos nichts.
  let rufe = 0;
  const holen = cached(async () => ++rufe, 60_000);

  assert.equal(await holen(), 1);
  holen.vergessen();
  assert.equal(await holen(), 2);
});

test('vergessen waehrend eines laufenden Abrufs verwirft dessen Ergebnis', async () => {
  // Sonst schreibt die alte, noch unterwegs befindliche Antwort den
  // geleerten Speicher wieder voll.
  let loesen;
  let rufe = 0;
  const holen = cached(() => {
    rufe++;
    return new Promise((f) => {
      loesen = f;
    });
  }, 60_000);

  const unterwegs = holen();
  holen.vergessen();
  loesen('alt');
  await unterwegs;

  const zweiter = holen();
  loesen('neu');
  assert.equal(await zweiter, 'neu');
  assert.equal(rufe, 2);
});
