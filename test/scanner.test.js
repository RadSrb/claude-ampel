import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { slugForCwd, readTranscriptTail, scan } from '../lib/scanner.js';

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ampel-test-'));
  fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(root, 'projects'), { recursive: true });
  return root;
}

function writeSession(root, rec) {
  fs.writeFileSync(path.join(root, 'sessions', `${rec.pid}.json`), JSON.stringify(rec));
}

function writeTranscript(root, slug, sessionId, lines) {
  const dir = path.join(root, 'projects', slug);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

test('slugForCwd bildet die Ordnernamen von Claude Code nach', () => {
  assert.equal(slugForCwd('c:\\Projekte\\Agenten'), 'c--Projekte-Agenten');
  assert.equal(slugForCwd('C:\\Users\\Alexander'), 'C--Users-Alexander');
  assert.equal(slugForCwd('c:\\AktivaRecruiterAI Backup'), 'c--AktivaRecruiterAI-Backup');
  assert.equal(slugForCwd('p:\\VisualStudioCode Alex'), 'p--VisualStudioCode-Alex');
  assert.equal(slugForCwd('c:\\'), 'c--');
});

test('readTranscriptTail erkennt einen beendeten Turn', () => {
  const root = makeFixture();
  const file = writeTranscript(root, 'c--x', 's1', [
    { type: 'user', message: { role: 'user', content: 'hallo' } },
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Fertig, alles erledigt.' }],
      },
    },
  ]);
  const tail = readTranscriptTail(file);
  assert.equal(tail.lastEntry.type, 'assistant');
  assert.equal(tail.lastEntry.stopReason, 'end_turn');
  assert.equal(tail.lastEntry.hasToolUse, false);
  assert.equal(tail.lastAssistantText, 'Fertig, alles erledigt.');
  assert.ok(tail.mtime instanceof Date);
});

test('readTranscriptTail erkennt einen laufenden Tool-Aufruf', () => {
  const root = makeFixture();
  const file = writeTranscript(root, 'c--x', 's2', [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Ich schaue nach.' },
          { type: 'tool_use', name: 'Bash' },
        ],
      },
    },
  ]);
  const tail = readTranscriptTail(file);
  assert.equal(tail.lastEntry.hasToolUse, true);
  assert.equal(tail.lastEntry.toolName, 'Bash');
  assert.equal(tail.lastAssistantText, 'Ich schaue nach.');
});

test('readTranscriptTail verkraftet eine abgeschnittene erste Zeile', () => {
  const root = makeFixture();
  const dir = path.join(root, 'projects', 'c--x');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 's3.jsonl');
  const good = JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] },
  });
  fs.writeFileSync(file, '{"type":"assist' + '\n' + good + '\n');
  // Fenster so gewaehlt, dass es mitten in der ersten (kaputten) Zeile beginnt.
  const tail = readTranscriptTail(file, good.length + 10);
  assert.equal(tail.lastEntry.stopReason, 'end_turn');
});

test('readTranscriptTail vergroessert das Fenster fuer sehr lange Zeilen', () => {
  const root = makeFixture();
  const dir = path.join(root, 'projects', 'c--x');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 's4.jsonl');
  // Ein grosses Tool-Ergebnis, gefolgt von der eigentlich interessanten Zeile.
  const riesig = JSON.stringify({ type: 'user', message: { role: 'user', content: 'x'.repeat(5000) } });
  const good = JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'trotzdem da' }] },
  });
  fs.writeFileSync(file, riesig + '\n' + good + '\n');
  const tail = readTranscriptTail(file, 64);
  assert.equal(tail.lastEntry.stopReason, 'end_turn');
  assert.equal(tail.lastAssistantText, 'trotzdem da');
});

test('ein Turn, der mit einer Frage endet, wird als Frage erkannt', () => {
  const root = makeFixture();
  const file = writeTranscript(root, 'c--x', 'f1', [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Ich habe zwei Wege gefunden. Soll ich den zweiten nehmen?' }],
      },
    },
  ]);
  assert.equal(readTranscriptTail(file).frage, true);
});

test('eine Aussage am Ende ist keine Frage', () => {
  const root = makeFixture();
  const file = writeTranscript(root, 'c--x', 'f2', [
    {
      type: 'assistant',
      message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Alles erledigt, 12 Tests grün.' }] },
    },
  ]);
  assert.equal(readTranscriptTail(file).frage, false);
});

test('ein Fragezeichen in einem Codeblock zaehlt nicht', () => {
  const root = makeFixture();
  const file = writeTranscript(root, 'c--x', 'f3', [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Fertig. Der Regex steht jetzt so:\n\n```js\n/ab?c/\n```' }],
      },
    },
  ]);
  assert.equal(readTranscriptTail(file).frage, false);
});

test('ein offenes Auswahl-Widget gilt als Frage', () => {
  const root = makeFixture();
  const file = writeTranscript(root, 'c--x', 'f4', [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Zwei Wege sind denkbar.' },
          { type: 'tool_use', name: 'AskUserQuestion' },
        ],
      },
    },
  ]);
  assert.equal(readTranscriptTail(file).frage, true);
});

test('eine wartende Plan-Freigabe gilt als Frage', () => {
  const root = makeFixture();
  const file = writeTranscript(root, 'c--x', 'f5', [
    {
      type: 'assistant',
      message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'ExitPlanMode' }] },
    },
  ]);
  assert.equal(readTranscriptTail(file).frage, true);
});

test('ein gewoehnlicher Werkzeugaufruf ist keine Frage', () => {
  const root = makeFixture();
  const file = writeTranscript(root, 'c--x', 'f6', [
    {
      type: 'assistant',
      message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Bash' }] },
    },
  ]);
  assert.equal(readTranscriptTail(file).frage, false);
});

test('eine Bitte am Ende gilt als Frage, auch ohne Fragezeichen', () => {
  const root = makeFixture();
  const file = writeTranscript(root, 'c--x', 'f7', [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: `Jetzt brauche ich die Links.

Schick mir einfach die URLs. Ich zerlege sie dann und lege dir den Entwurf vor. Erst danach schreibe ich Code.`,
          },
        ],
      },
    },
  ]);
  assert.equal(readTranscriptTail(file).frage, true);
});

test('eine Frage vor einer Optionsliste gilt als Frage', () => {
  const root = makeFixture();
  const file = writeTranscript(root, 'c--x', 'f8', [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: `Der Zweig hat 14 Commits. Was soll damit geschehen?

1. Lokal zusammenfuehren
2. Pull Request anlegen
3. So stehen lassen`,
          },
        ],
      },
    },
  ]);
  assert.equal(readTranscriptTail(file).frage, true);
});

test('ein Fragezeichen in Inline-Code zaehlt nicht', () => {
  const root = makeFixture();
  const file = writeTranscript(root, 'c--x', 'f9', [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Fertig. Pruefen kannst du es mit `GET /api/lauf?probe=1`.' }],
      },
    },
  ]);
  assert.equal(readTranscriptTail(file).frage, false);
});

test('ein Fragezeichen in einem Zitat zaehlt nicht', () => {
  const root = makeFixture();
  const file = writeTranscript(root, 'c--x', 'f10', [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Der Bot antwortet jetzt auf „gibt es neue Bewerber?“ statt zu schweigen.' }],
      },
    },
  ]);
  assert.equal(readTranscriptTail(file).frage, false);
});

test('ein Bericht ohne Bitte bleibt fertig, auch nach einer Frage weiter oben', () => {
  const root = makeFixture();
  const file = writeTranscript(root, 'c--x', 'f11', [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: `Warum war das langsam? Weil der Index fehlte.

Er steht jetzt. Der lokale Server laeuft weiter auf Port 8080.`,
          },
        ],
      },
    },
  ]);
  assert.equal(readTranscriptTail(file).frage, false);
});

test('kontextStand rechnet den Kontext aus der letzten Nachricht', () => {
  const root = makeFixture();
  const file = writeTranscript(root, 'c--x', 'k1', [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-opus-5',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 2, cache_read_input_tokens: 99_998, cache_creation_input_tokens: 0 },
      },
    },
  ]);
  const k = readTranscriptTail(file, undefined, {}).kontext;
  assert.equal(k.tokens, 100_000);
  assert.equal(k.fenster, 200_000);
  assert.equal(k.prozent, 50);
  assert.equal(k.modell, 'claude-opus-5');
});

test('ueber 200k belegt der Verbrauch selbst das grosse Fenster', () => {
  const root = makeFixture();
  const file = writeTranscript(root, 'c--x', 'k2', [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 2, cache_read_input_tokens: 443_390, cache_creation_input_tokens: 0 },
      },
    },
  ]);
  const k = readTranscriptTail(file, undefined, {}).kontext;
  assert.equal(k.fenster, 1_000_000);
  assert.equal(k.prozent, 44);
});

test('ohne Verbrauchsangabe gibt es keinen Kontextstand', () => {
  const root = makeFixture();
  const file = writeTranscript(root, 'c--x', 'k3', [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  ]);
  assert.equal(readTranscriptTail(file).kontext, null);
});

test('eine Verdichtung wird erkannt', () => {
  const root = makeFixture();
  const mit = writeTranscript(root, 'c--x', 'k4', [
    { type: 'system', subtype: 'compact_boundary' },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'weiter' }] } },
  ]);
  assert.equal(readTranscriptTail(mit).verdichtet, true);

  const ohne = writeTranscript(root, 'c--x', 'k5', [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  ]);
  assert.equal(readTranscriptTail(ohne).verdichtet, false);
});

test('readTranscriptTail liefert null fuer eine fehlende Datei', () => {
  assert.equal(readTranscriptTail(path.join(os.tmpdir(), 'gibt-es-nicht-xyz.jsonl')), null);
});

test('scan liefert nur lebende Sessions und findet ihr Transkript', () => {
  const root = makeFixture();
  writeSession(root, {
    pid: 111,
    sessionId: 's-live',
    cwd: 'c:\\Projekte\\Agenten',
    name: 'agenten-5d',
    startedAt: 1788847170331,
    version: '2.1.258',
    entrypoint: 'claude-vscode',
  });
  writeSession(root, {
    pid: 222,
    sessionId: 's-tot',
    cwd: 'c:\\Projekte\\Alt',
    name: 'alt-99',
    startedAt: 1788847170331,
    version: '2.1.258',
    entrypoint: 'claude-vscode',
  });
  writeTranscript(root, 'c--Projekte-Agenten', 's-live', [
    {
      type: 'assistant',
      message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Erledigt.' }] },
    },
  ]);

  const beide = scan({ claudeDir: root, livePids: new Set([111, 222]) });
  assert.deepEqual(beide.map((s) => s.sessionId).sort(), ['s-live', 's-tot']);

  const live = beide.find((s) => s.sessionId === 's-live');
  assert.equal(live.name, 'agenten-5d');
  assert.equal(live.cwd, 'c:\\Projekte\\Agenten');
  assert.ok(live.transcriptPath.endsWith('s-live.jsonl'));
  assert.equal(live.tail.lastEntry.stopReason, 'end_turn');

  const nurLebende = scan({ claudeDir: root, livePids: new Set([111]) });
  assert.deepEqual(
    nurLebende.map((s) => s.sessionId),
    ['s-live'],
  );
});

test('scan findet das Transkript auch wenn der Slug nicht passt', () => {
  const root = makeFixture();
  writeSession(root, {
    pid: 444,
    sessionId: 's-odd',
    cwd: 'c:\\Ganz\\Anders',
    name: 'odd-01',
    startedAt: 1,
    version: '2.1.258',
    entrypoint: 'claude-vscode',
  });
  writeTranscript(root, 'irgendein--anderer-ordner', 's-odd', [
    {
      type: 'assistant',
      message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'da' }] },
    },
  ]);
  const [s] = scan({ claudeDir: root, livePids: new Set([444]) });
  assert.ok(s.transcriptPath && s.transcriptPath.endsWith('s-odd.jsonl'));
});

test('scan uebersteht eine kaputte Session-Datei', () => {
  const root = makeFixture();
  fs.writeFileSync(path.join(root, 'sessions', '999.json'), '{kaputt');
  writeSession(root, {
    pid: 111,
    sessionId: 's-ok',
    cwd: 'c:\\A',
    name: 'a',
    startedAt: 1,
    version: '2.1.258',
    entrypoint: 'claude-vscode',
  });
  const sessions = scan({ claudeDir: root, livePids: new Set([111, 999]) });
  assert.deepEqual(
    sessions.map((s) => s.sessionId),
    ['s-ok'],
  );
});

test('scan liefert eine Session ohne Transkript ohne zu werfen', () => {
  const root = makeFixture();
  writeSession(root, {
    pid: 555,
    sessionId: 's-frisch',
    cwd: 'c:\\Neu',
    name: 'neu-01',
    startedAt: 1,
    version: '2.1.258',
    entrypoint: 'claude-vscode',
  });
  const [s] = scan({ claudeDir: root, livePids: new Set([555]) });
  assert.equal(s.transcriptPath, null);
  assert.equal(s.tail, null);
});
