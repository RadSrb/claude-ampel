import { test } from 'node:test';
import assert from 'node:assert/strict';

import { neuesBuch, buchen, offene, istServer } from '../lib/hintergrund.js';

const MINUTE = 60 * 1000;
const T0 = Date.parse('2026-10-06T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

function bashAufruf(id, command, description = '') {
  return {
    type: 'assistant',
    timestamp: iso(T0),
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command, description, run_in_background: true } }] },
  };
}

function bashGestartet(toolUseId, taskId, ms = T0) {
  return {
    type: 'user',
    timestamp: iso(ms),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: `Command running in background with ID: ${taskId}.` }] },
    toolUseResult: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: taskId },
  };
}

function monitorGestartet(taskId, ms = T0, timeoutMs = 30 * MINUTE, persistent = false) {
  return {
    type: 'user',
    timestamp: iso(ms),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_mon', content: `Monitor started (task ${taskId})` }] },
    toolUseResult: { taskId, timeoutMs, persistent },
  };
}

const meldung = (taskId, status) =>
  `<task-notification>\n<task-id>${taskId}</task-id>\n<status>${status}</status>\n<summary>Background command finished</summary>\n</task-notification>`;

function lauf(eintraege) {
  const buch = neuesBuch();
  for (const e of eintraege) buchen(buch, e);
  return buch;
}

test('ein gestarteter Hintergrund-Befehl ohne Abschlussmeldung ist offen', () => {
  // Agenten 06.10.: der Massenlauf schrieb in eine eigene Datei, kein Subagent
  // war beteiligt -- die Kachel stand gruen, obwohl die Pipeline noch lief.
  const buch = lauf([bashAufruf('toolu_1', 'bash pipeline.sh > pipeline_alle.jsonl', 'Pipeline ueber alle Seiten'), bashGestartet('toolu_1', 'b2yzsdyji')]);
  const offen = offene(buch, { now: T0 + 20 * MINUTE });
  assert.equal(offen.length, 1);
  assert.equal(offen[0].id, 'b2yzsdyji');
  assert.equal(offen[0].art, 'befehl');
  assert.equal(offen[0].beschreibung, 'Pipeline ueber alle Seiten');
});

test('die Abschlussmeldung schliesst den Befehl, egal in welcher Form sie im Transkript steht', () => {
  for (const ende of [
    { type: 'user', message: { role: 'user', content: meldung('b1', 'completed') } },
    { type: 'queue-operation', operation: 'enqueue', content: meldung('b1', 'failed') },
    { type: 'attachment', attachment: { type: 'queued_command', prompt: meldung('b1', 'killed') } },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: meldung('b1', 'stopped') }] } },
  ]) {
    const buch = lauf([bashAufruf('toolu_1', 'npm test'), bashGestartet('toolu_1', 'b1'), ende]);
    assert.deepEqual(offene(buch, { now: T0 + MINUTE }), [], JSON.stringify(ende).slice(0, 60));
  }
});

test('TaskStop schliesst den Befehl', () => {
  const stop = {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_s', name: 'TaskStop', input: { task_id: 'b1' } }] },
  };
  const buch = lauf([bashAufruf('toolu_1', 'npm test'), bashGestartet('toolu_1', 'b1'), stop]);
  assert.deepEqual(offene(buch, { now: T0 + MINUTE }), []);
});

test('ein Ende vor dem Start zaehlt trotzdem -- fortgesetzte Sessions schreiben alte Eintraege erneut', () => {
  const buch = lauf([
    { type: 'queue-operation', content: meldung('b1', 'completed') },
    bashAufruf('toolu_1', 'npm test'),
    bashGestartet('toolu_1', 'b1'),
  ]);
  assert.deepEqual(offene(buch, { now: T0 + MINUTE }), []);
});

test('ein Monitor-Ereignis ohne Status beendet den Monitor nicht', () => {
  const ereignis = {
    type: 'user',
    message: { role: 'user', content: '<task-notification>\n<task-id>bmon</task-id>\n<summary>Monitor event: "Fortschritt"</summary>\n<event>25 Seiten</event>\n</task-notification>' },
  };
  const buch = lauf([monitorGestartet('bmon'), ereignis]);
  const offen = offene(buch, { now: T0 + 10 * MINUTE });
  assert.equal(offen.length, 1);
  assert.equal(offen[0].art, 'monitor');
});

test('ein Monitor gilt nur bis zu seinem Ablauf', () => {
  const buch = lauf([monitorGestartet('bmon', T0, 30 * MINUTE)]);
  assert.equal(offene(buch, { now: T0 + 29 * MINUTE }).length, 1);
  assert.equal(offene(buch, { now: T0 + 31 * MINUTE }).length, 0);
});

test('Dev-Server und Vorschauen sind keine Arbeit -- sie laufen bis zum Session-Ende', () => {
  const buch = lauf([bashAufruf('toolu_1', 'npx astro dev --port 4321'), bashGestartet('toolu_1', 'b1')]);
  assert.deepEqual(offene(buch, { now: T0 + MINUTE }), []);
});

test('istServer erkennt die Server aus echten Transkripten', () => {
  for (const befehl of [
    'npm run dev',
    'npm run dev:web',
    'npm run dev -w @voice/web -- -p 3010 > .web-3010.log 2>&1',
    'cd /c/Projekte/WorkExpert && npm run dev -- --port 4399 > log',
    'npx astro preview --port 4321',
    'cd x && PUBLIC_DRAFT=true npx astro dev --port 4321 --host 127.0.0.1',
    'npx next dev -p 3000 > "$TEMP/crm-dev.log" 2>&1',
    'npx next start -H 127.0.0.1 -p 4599 > log',
    'npx --yes serve -s dist -l 4173',
    'python -m http.server 4790 --bind 127.0.0.1 --directory dist',
    'cd /c/Projekte/Jarvis/web && JARVIS_TUNNEL=1 npx vite --host 127.0.0.1 --port 5173 --strictPort',
    '"/c/Program Files (x86)/cloudflared/cloudflared.exe" tunnel --url http://localhost:3010 > .tunnel-api.log 2>&1',
    'PYTHONIOENCODING=utf-8 python -u "C:/Users/Alexander/.claude/skills/mirroring-live-websites/tools/serve.py" --port 8000',
  ]) {
    assert.equal(istServer(befehl), true, befehl);
  }
});

test('istServer laesst Arbeit als Arbeit gelten', () => {
  for (const befehl of [
    'npm test',
    'npm run build',
    'npx next build',
    'npm run alle 2>&1 | tail -25',
    'npx vercel --prod --yes > "$TEMP/vercel-deploy.log" 2>&1',
    'powershell -NoProfile -ExecutionPolicy Bypass -File C:\\Projekte\\Agenten\\website-relaunch-agent\\relaunch.ps1',
    "until grep -qE 'Prueflaeufe' \"${TEMP}/alle4.txt\"; do sleep 5; done",
    'cd /c/Projekte/01Website && bash deploy.sh "fix"',
  ]) {
    assert.equal(istServer(befehl), false, befehl);
  }
});

test('auch die Beschreibung verraet einen Server', () => {
  assert.equal(istServer('npx tsx apps/voice/src/index.ts', 'Start voice dev server'), true);
  assert.equal(istServer('node scripts/dev-demo.mjs', 'Vorschau-Server starten'), true);
  assert.equal(istServer('node scripts/ernte.mjs', 'Ernte ueber alle Seiten'), false);
});

test('Befehle aus einem frueheren Prozess der Session zaehlen nicht', () => {
  // Nach einem Neustart (--resume) sind die alten Hintergrund-Befehle tot,
  // stehen aber ohne Abschlussmeldung im Transkript.
  const buch = lauf([bashAufruf('toolu_1', 'npm test'), bashGestartet('toolu_1', 'b1', T0)]);
  assert.deepEqual(offene(buch, { seit: T0 + MINUTE, now: T0 + 2 * MINUTE }), []);
});

test('ein Befehl ohne Abschlussmeldung gilt nach zwei Stunden nicht mehr als Arbeit', () => {
  // Im Korpus fehlte bei einzelnen Befehlen die Meldung -- ohne Grenze stuende
  // die Kachel fuer den Rest der Session auf gelb.
  const buch = lauf([bashAufruf('toolu_1', 'npm test'), bashGestartet('toolu_1', 'b1')]);
  assert.equal(offene(buch, { now: T0 + 119 * MINUTE }).length, 1);
  assert.equal(offene(buch, { now: T0 + 121 * MINUTE }).length, 0);
});

test('ein automatisch in den Hintergrund geschobener Befehl wird ebenso gezaehlt', () => {
  // Ohne run_in_background, aber mit backgroundTaskId im Ergebnis.
  const aufruf = bashAufruf('toolu_1', 'npm run alle');
  delete aufruf.message.content[0].input.run_in_background;
  const buch = lauf([aufruf, bashGestartet('toolu_1', 'b1')]);
  assert.equal(offene(buch, { now: T0 + MINUTE }).length, 1);
});
