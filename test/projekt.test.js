import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { projektName, projektWurzel } from '../lib/projekt.js';

function tempBaum() {
  const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'ampel-'));
  const repo = path.join(wurzel, 'MeinProjekt');
  fs.mkdirSync(path.join(repo, '.git', 'worktrees', 'feature'), { recursive: true });
  return { wurzel, repo };
}

test('ein normales Repo heisst wie sein Ordner', () => {
  const { repo } = tempBaum();
  assert.equal(projektName(repo), 'MeinProjekt');
});

test('ein Unterordner traegt den Namen des Projekts', () => {
  const { repo } = tempBaum();
  const unter = path.join(repo, 'lib', 'tief');
  fs.mkdirSync(unter, { recursive: true });
  assert.equal(projektName(unter), 'MeinProjekt');
});

test('ein Worktree traegt den Namen des Hauptrepos', () => {
  const { wurzel, repo } = tempBaum();
  const baum = path.join(wurzel, 'MeinProjekt-feature');
  fs.mkdirSync(baum);
  fs.writeFileSync(path.join(baum, '.git'), `gitdir: ${path.join(repo, '.git', 'worktrees', 'feature')}\n`);
  assert.equal(projektName(baum), 'MeinProjekt');
  assert.equal(projektWurzel(baum), repo);
});

test('ein Ordner ohne Repo behaelt seinen eigenen Namen', () => {
  const { wurzel } = tempBaum();
  const lose = path.join(wurzel, 'Kein-Repo');
  fs.mkdirSync(lose);
  assert.equal(projektName(lose), 'Kein-Repo');
});

test('ohne cwd gibt es keinen Namen', () => {
  assert.equal(projektName(null), null);
  assert.equal(projektName(''), null);
});
