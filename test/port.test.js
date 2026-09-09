import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { portBelegt, portAusConfig } from '../lib/port.js';

test('erkennt einen belegten Port', async () => {
  const server = net.createServer();
  await new Promise((f) => server.listen(0, '127.0.0.1', f));
  const port = server.address().port;
  try {
    assert.equal(await portBelegt(port), true);
  } finally {
    await new Promise((f) => server.close(f));
  }
});

test('erkennt einen freien Port', async () => {
  // Erst belegen, um eine sicher freie Nummer zu bekommen, dann freigeben.
  const server = net.createServer();
  await new Promise((f) => server.listen(0, '127.0.0.1', f));
  const port = server.address().port;
  await new Promise((f) => server.close(f));
  assert.equal(await portBelegt(port), false);
});

test('gibt den Port frei, den es zum Pruefen belegt hat', async () => {
  // Sonst haette die Pruefung selbst den Server ausgesperrt.
  const server = net.createServer();
  await new Promise((f) => server.listen(0, '127.0.0.1', f));
  const port = server.address().port;
  await new Promise((f) => server.close(f));

  assert.equal(await portBelegt(port), false);
  const danach = net.createServer();
  await new Promise((f, x) => {
    danach.once('error', x);
    danach.listen(port, '127.0.0.1', f);
  });
  await new Promise((f) => danach.close(f));
});

test('liest den Port aus der config.json', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'ampel-'));
  fs.writeFileSync(path.join(ordner, 'config.json'), JSON.stringify({ port: 5555 }));
  assert.equal(portAusConfig(ordner), 5555);
});

test('faellt auf den Standard zurueck', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'ampel-'));
  assert.equal(portAusConfig(ordner), 4317, 'keine Datei');

  fs.writeFileSync(path.join(ordner, 'config.json'), 'kein JSON');
  assert.equal(portAusConfig(ordner), 4317, 'kaputte Datei');

  fs.writeFileSync(path.join(ordner, 'config.json'), JSON.stringify({ port: 'abc' }));
  assert.equal(portAusConfig(ordner), 4317, 'unbrauchbarer Wert');

  fs.writeFileSync(path.join(ordner, 'config.json'), JSON.stringify({ port: 0 }));
  assert.equal(portAusConfig(ordner), 4317, 'Port 0 waere zufaellig');
});
