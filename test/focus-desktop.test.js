import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sessionArt } from '../lib/state.js';
import { scan } from '../lib/scanner.js';
import { gueltigeDesktopId, desktopLink, fokusDesktop } from '../lib/desktop.js';

const ID = 'local_53f1e9fb-8026-4fca-8c60-450e033e352f';

test('art-Zuordnung kennt claude-desktop', () => {
  assert.equal(sessionArt('claude-desktop'), 'desktop');
  assert.equal(sessionArt('claude-vscode'), 'vscode');
  assert.equal(sessionArt('cli'), 'terminal');
  assert.equal(sessionArt('sdk-ts'), null);
  assert.equal(sessionArt(undefined), null);
});

test('scan liest hostSessionId aus der Registry (Desktop-ID weicht von der CLI-ID ab)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ampel-desktop-'));
  try {
    fs.mkdirSync(path.join(dir, 'sessions'));
    const cli = '560ba615-0000-4000-8000-000000000000';
    fs.writeFileSync(
      path.join(dir, 'sessions', '4242.json'),
      JSON.stringify({ sessionId: cli, pid: 4242, cwd: 'C:\\x', entrypoint: 'claude-desktop', hostSessionId: ID }),
    );
    fs.writeFileSync(
      path.join(dir, 'sessions', '4243.json'),
      JSON.stringify({ sessionId: 'abc', pid: 4243, cwd: 'C:\\y', entrypoint: 'cli' }),
    );
    const s = scan({ claudeDir: dir, livePids: new Set([4242, 4243]), zeiten: new Map() });
    const d = s.find((x) => x.sessionId === cli);
    assert.equal(d.hostSessionId, ID);
    assert.notEqual(d.hostSessionId, `local_${cli}`);
    assert.equal(s.find((x) => x.sessionId === 'abc').hostSessionId, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Desktop-ID: gueltige Form angenommen, ungueltige abgelehnt', () => {
  assert.equal(gueltigeDesktopId(ID), ID);
  assert.equal(gueltigeDesktopId('local_' + 'a'.repeat(64)), 'local_' + 'a'.repeat(64));
  for (const schlecht of [
    null,
    undefined,
    '',
    'local_',
    '53f1e9fb',
    'local_' + 'a'.repeat(65),
    'local_x&source=evil',
    'local_x y',
    'local_x\n',
    'local_../x',
    'xlocal_abc',
    42,
  ]) {
    assert.equal(gueltigeDesktopId(schlecht), null, String(schlecht));
  }
});

test('Link hat exakt die Form der App', () => {
  assert.equal(desktopLink(ID), `claude://code/continue?session=${ID}&source=desktop_action`);
});

test('Desktop-Sitzung oeffnet genau den Link und meldet ok', async () => {
  const links = [];
  const r = await fokusDesktop({ art: 'desktop', desktopId: ID }, async (url) => (links.push(url), true));
  assert.deepEqual(links, [`claude://code/continue?session=${ID}&source=desktop_action`]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, weg: 'desktop' });
});

test('ohne Desktop-ID oder mit ungueltiger ID: deutscher Fehler, kein Oeffnen', async () => {
  let aufrufe = 0;
  const oeffne = async () => (aufrufe++, true);
  for (const row of [{ desktopId: null }, {}, { desktopId: 'local_x&evil=1' }]) {
    const r = await fokusDesktop(row, oeffne);
    assert.equal(r.status, 409);
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /Desktop-Sitzung nicht gefunden/);
  }
  assert.equal(aufrufe, 0);
});

test('Oeffnen schlaegt fehl oder wirft: Fehlertext im Feld error', async () => {
  for (const oeffne of [async () => false, async () => { throw new Error('boom'); }]) {
    const r = await fokusDesktop({ desktopId: ID }, oeffne);
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { ok: false, error: 'Claude Desktop konnte nicht geoeffnet werden' });
  }
});

test('/api/focus: VS-Code- und Terminal-Weg rufen die Link-Funktion nicht auf', () => {
  // Der Handler in server.js verzweigt nur bei art === 'desktop' auf fokusDesktop.
  const quelle = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const treffer = quelle.match(/fokusDesktop\(/g) ?? [];
  assert.equal(treffer.length, 1);
  const i = quelle.indexOf('fokusDesktop(row)');
  assert.match(quelle.slice(Math.max(0, i - 120), i), /row\.art === 'desktop'/);
});
