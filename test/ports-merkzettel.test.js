import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ergaenzen, mergeByPort, portsForCwd } from '../lib/ports.js';

const CMD = '"C:\\Program Files\\nodejs\\node.exe" C:\\Projekte\\CRM\\node_modules\\next\\dist\\server\\lib\\start-server.js';

test('gemerkte Kommandozeile ersetzt die WMI-Abfrage beim naechsten Mal', () => {
  const zettel = new Map();

  // Erster Durchgang: ports.ps1 hat die PID nachgeschlagen.
  const erst = ergaenzen([{ port: 3001, pid: 42, process: 'node.exe', cmd: CMD }], zettel);
  assert.equal(erst[0].cmd, CMD);

  // Zweiter: ports.ps1 kennt die PID als bekannt und schickt nur Port und PID.
  const zweit = ergaenzen([{ port: 3001, pid: 42 }], zettel);
  assert.equal(zweit[0].cmd, CMD);
  assert.equal(zweit[0].process, 'node.exe');
  assert.deepEqual(portsForCwd(mergeByPort(zweit), 'c:\\Projekte\\CRM'), [3001]);
});

test('eine PID, die nicht mehr lauscht, faellt aus dem Merkzettel', () => {
  // Sonst wuechse der Zettel unbegrenzt -- und Windows vergibt PIDs wieder.
  const zettel = new Map();
  ergaenzen([{ port: 3001, pid: 42, process: 'node.exe', cmd: CMD }], zettel);
  ergaenzen([{ port: 4001, pid: 43, process: 'node.exe', cmd: CMD }], zettel);

  assert.deepEqual([...zettel.keys()], [43]);
});

test('unbekannte PID ohne Kommandozeile wird nicht geraten', () => {
  // Lieber eine Zeile weglassen als einen Port dem falschen Projekt zuschlagen.
  const zettel = new Map();
  assert.deepEqual(ergaenzen([{ port: 3001, pid: 42 }], zettel), []);
});

test('ein Prozess ohne Kommandozeile gilt trotzdem als bekannt', () => {
  // System- und svchost-Prozesse liefern cmd = null. Ohne diese Unterscheidung
  // wuerde ports.ps1 fuer sie in jedem Takt erneut WMI befragen.
  const zettel = new Map();
  ergaenzen([{ port: 5357, pid: 4, process: 'System', cmd: null }], zettel);

  const zweit = ergaenzen([{ port: 5357, pid: 4 }], zettel);
  assert.equal(zweit.length, 1);
  assert.equal(zweit[0].cmd, null);
});
