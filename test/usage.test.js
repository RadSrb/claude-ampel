import { test } from 'node:test';
import assert from 'node:assert/strict';

import { summarize } from '../lib/usage.js';

// Gekuerzte, aber echte Antwort von GET /api/oauth/usage.
const ECHT = {
  five_hour: { utilization: 21.0, resets_at: '2026-09-08T14:30:00.203462+00:00', locked_reason: null },
  seven_day: { utilization: 25.0, resets_at: '2026-09-14T20:00:00.203501+00:00', locked_reason: null },
  seven_day_opus: null,
  nimbus_quill: { utilization: 0.0, resets_at: null },
  extra_usage: { is_enabled: false },
  limits: [
    { kind: 'session', group: 'session', percent: 21, severity: 'normal', resets_at: '2026-09-08T14:30:00Z', scope: null },
    { kind: 'weekly_all', group: 'weekly', percent: 25, severity: 'normal', resets_at: '2026-09-14T20:00:00Z', scope: null },
    {
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: 10,
      resets_at: '2026-09-14T20:00:00Z',
      scope: { model: { id: null, display_name: 'Fable' }, surface: null },
    },
    {
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: 42,
      resets_at: '2026-09-14T20:00:00Z',
      scope: { model: { id: null, display_name: 'Opus' }, surface: null },
    },
  ],
};

test('summarize zieht Sitzungs- und Wochenfenster heraus', () => {
  const u = summarize(ECHT);
  assert.equal(u.sitzung.prozent, 21);
  assert.equal(u.woche.prozent, 25);
  assert.equal(u.sitzung.resetsAt, '2026-09-08T14:30:00.203462+00:00');
});

test('summarize listet Modell-Limits, das vollste zuerst', () => {
  const u = summarize(ECHT);
  assert.deepEqual(u.proModell, [
    { name: 'Opus', prozent: 42 },
    { name: 'Fable', prozent: 10 },
  ]);
});

test('die Stufe richtet sich nach dem vollsten Topf', () => {
  assert.equal(summarize(ECHT).stufe, 'normal');
  assert.equal(summarize(ECHT).hoechster, 42);

  const warn = summarize({ ...ECHT, five_hour: { utilization: 80, resets_at: null } });
  assert.equal(warn.stufe, 'warnung');

  const krit = summarize({ ...ECHT, seven_day: { utilization: 95, resets_at: null } });
  assert.equal(krit.stufe, 'kritisch');
});

test('summarize rundet auf ganze Prozent', () => {
  const u = summarize({ five_hour: { utilization: 21.6, resets_at: null }, limits: [] });
  assert.equal(u.sitzung.prozent, 22);
});

test('summarize verkraftet leere und kaputte Antworten', () => {
  assert.equal(summarize(null), null);
  assert.equal(summarize('nein'), null);
  assert.equal(summarize({}), null);
  assert.equal(summarize({ five_hour: null, seven_day: null, limits: [] }), null);
});

test('summarize ignoriert Limits ohne Modellnamen', () => {
  const u = summarize({
    five_hour: { utilization: 5, resets_at: null },
    limits: [{ kind: 'weekly_scoped', percent: 9, scope: { model: {} } }, { kind: 'weekly_all', percent: 3 }],
  });
  assert.deepEqual(u.proModell, []);
});

test('eine Sperre wird durchgereicht', () => {
  const u = summarize({ five_hour: { utilization: 100, resets_at: null, locked_reason: 'limit erreicht' }, limits: [] });
  assert.equal(u.sitzung.gesperrt, 'limit erreicht');
  assert.equal(u.stufe, 'kritisch');
});
