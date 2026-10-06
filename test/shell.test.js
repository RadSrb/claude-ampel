import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cached, runPowerShell, entlassen } from '../lib/shell.js';

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

// --- Dauerlaeufer -----------------------------------------------------------
// Diese Tests starten echtes PowerShell. Sie sind der einzige Nachweis, dass
// das Zeilenprotokoll zwischen Node und host.ps1 wirklich zusammenpasst.

test('fuehrt ein Skript aus und liefert dessen JSON', async () => {
  const rows = await runPowerShell('windows.ps1', ['list']);
  assert.ok(Array.isArray(rows));
});

test('derselbe Dauerlaeufer bedient mehrere Auftraege nacheinander', async () => {
  // Der zweite Aufruf stolperte frueher ueber den schon vorhandenen Typ aus
  // Add-Type -- deshalb die Abfrage in windows.ps1, ob es ihn schon gibt.
  const a = await runPowerShell('windows.ps1', ['list']);
  const b = await runPowerShell('windows.ps1', ['list']);
  assert.ok(Array.isArray(a) && Array.isArray(b));
});

test('Abfragen und Aktionen blockieren einander nicht', async () => {
  const [abfrage, aktion] = await Promise.all([
    runPowerShell('windows.ps1', ['list']),
    runPowerShell('windows.ps1', ['list'], { spur: 'aktion' }),
  ]);
  assert.ok(Array.isArray(abfrage));
  assert.ok(Array.isArray(aktion));
});

test('eine unbekannte Aktion liefert das Fehler-JSON statt null', async () => {
  const res = await runPowerShell('windows.ps1', ['quatsch']);
  assert.equal(res?.ok, false);
});

test('ein Skript, das es nicht gibt, liefert null und laesst den Laeufer leben', async () => {
  assert.equal(await runPowerShell('gibtsnicht.ps1'), null);
  assert.ok(Array.isArray(await runPowerShell('windows.ps1', ['list'])));
});

test('ein haengender Auftrag laeuft in die Frist und blockiert nichts dauerhaft', async () => {
  // typeforeground wartet bis zu 2 s auf einen Editor im Vordergrund. Mit
  // 200 ms Frist muss der Dauerlaeufer weggeworfen und neu gestartet werden.
  const res = await runPowerShell('windows.ps1', ['typeforeground'], { timeout: 200, spur: 'frist-test' });
  assert.equal(res, null);
  assert.ok(Array.isArray(await runPowerShell('windows.ps1', ['list'], { spur: 'frist-test' })));
});

test('entlassen beendet ruhende Dauerlaeufer, der naechste Auftrag startet neu', async () => {
  // Der Waechter braucht PowerShell nur, wenn das Overlay fehlt. Ohne
  // Entlassen blieb sein Dauerlaeufer danach fuer immer stehen.
  assert.ok(Array.isArray(await runPowerShell('windows.ps1', ['list'], { spur: 'entlass-test' })));

  const pids = entlassen();
  assert.ok(pids.length >= 1);

  // host.ps1 geht von selbst, sobald seine Eingabe zu ist.
  const lebt = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < 50 && pids.some(lebt); i++) await new Promise((f) => setTimeout(f, 100));
  assert.deepEqual(pids.filter(lebt), []);

  assert.ok(Array.isArray(await runPowerShell('windows.ps1', ['list'], { spur: 'entlass-test' })));
});
