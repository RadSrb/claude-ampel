import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';

import { normalePrioritaet } from '../lib/prioritaet.js';

const { PRIORITY_NORMAL, PRIORITY_BELOW_NORMAL, PRIORITY_LOW, PRIORITY_HIGH } = os.constants.priority;

function prozess(start) {
  const p = { stufe: start, gesetzt: [] };
  p.lesen = () => p.stufe;
  p.setzen = (pid, stufe) => {
    p.gesetzt.push([pid, stufe]);
    p.stufe = stufe;
  };
  return p;
}

test('hebt BelowNormal aus der Aufgabenplanung auf Normal', () => {
  const p = prozess(PRIORITY_BELOW_NORMAL);
  assert.equal(normalePrioritaet(p), true);
  assert.deepEqual(p.gesetzt, [[0, PRIORITY_NORMAL]]);
});

test('hebt auch Low auf Normal', () => {
  const p = prozess(PRIORITY_LOW);
  assert.equal(normalePrioritaet(p), true);
  assert.equal(p.stufe, PRIORITY_NORMAL);
});

test('laesst Normal und hoeher in Ruhe', () => {
  for (const stufe of [PRIORITY_NORMAL, PRIORITY_HIGH]) {
    const p = prozess(stufe);
    assert.equal(normalePrioritaet(p), false);
    assert.deepEqual(p.gesetzt, []);
  }
});

test('ein verweigertes Setzen bricht den Start nicht ab', () => {
  const p = prozess(PRIORITY_BELOW_NORMAL);
  p.setzen = () => {
    throw new Error('EACCES');
  };
  assert.equal(normalePrioritaet(p), false);
});
