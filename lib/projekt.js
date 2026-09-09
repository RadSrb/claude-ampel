// Ein Worktree oder ein Unterordner ist ein eigener Pfad, aber kein eigenes
// Projekt. Beide sollen den Namen des ganzen Projekts tragen.
//
// Ein normales Repo hat .git als Ordner -- dessen Elternordner ist die Wurzel.
// Ein Worktree hat .git als Datei mit "gitdir: <hauptrepo>/.git/worktrees/x";
// daraus faellt das Hauptrepo heraus.

import fs from 'node:fs';
import path from 'node:path';

const cache = new Map();

export function projektWurzel(cwd) {
  if (!cwd) return null;
  if (cache.has(cwd)) return cache.get(cwd);
  const wurzel = suche(cwd);
  cache.set(cwd, wurzel);
  return wurzel;
}

export function projektName(cwd) {
  if (!cwd) return null;
  return path.basename(projektWurzel(cwd) ?? cwd);
}

function suche(cwd) {
  let dir = path.resolve(cwd);
  while (true) {
    const marker = path.join(dir, '.git');
    let stat = null;
    try {
      stat = fs.statSync(marker);
    } catch {
      stat = null;
    }
    if (stat?.isDirectory()) return dir;
    if (stat?.isFile()) return ausGitdir(marker) ?? dir;

    const oben = path.dirname(dir);
    // Bei der Laufwerkswurzel liefert dirname denselben Pfad zurueck.
    if (oben === dir) return null;
    dir = oben;
  }
}

function ausGitdir(datei) {
  let text = '';
  try {
    text = fs.readFileSync(datei, 'utf8');
  } catch {
    return null;
  }
  const treffer = /^\s*gitdir:\s*(.+?)\s*$/m.exec(text);
  if (!treffer) return null;
  // <hauptrepo>/.git/worktrees/<name> -- alles vor /.git ist die Wurzel.
  const zeiger = treffer[1].replace(/\\/g, '/');
  const schnitt = zeiger.toLowerCase().indexOf('/.git/worktrees/');
  if (schnitt < 0) return null;
  return path.normalize(zeiger.slice(0, schnitt));
}
