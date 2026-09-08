// Fasst mehrere Sessions im selben Projektordner zu einer Kachel zusammen.
// Startet man im selben Projekt eine zweite Session, erscheint sie als
// Untersession unter derselben Kachel statt als zweite gleichnamige Kachel.

const RANK = { attention: 0, stalled: 1, running: 2, done: 3, unknown: 4 };

export function groupByProject(rows) {
  const gruppen = new Map();

  for (const row of rows) {
    // Der Pfad ist der Schluessel, nicht der Ordnername -- sonst landen
    // c:\Projekte\Demo und d:\Anderswo\Demo in einem Topf.
    const key = (row.cwd ?? row.sessionId).toLowerCase().replace(/[\\/]+$/, '');
    const gruppe = gruppen.get(key) ?? {
      key,
      cwd: row.cwd,
      folder: row.folder,
      ports: [],
      sessions: [],
    };
    gruppe.sessions.push(row);
    for (const p of row.ports ?? []) if (!gruppe.ports.includes(p)) gruppe.ports.push(p);
    gruppen.set(key, gruppe);
  }

  const liste = [...gruppen.values()];
  for (const gruppe of liste) {
    gruppe.sessions.sort((a, b) => RANK[a.status] - RANK[b.status] || a.since - b.since);
    gruppe.ports.sort((a, b) => a - b);
    // Die Kachel zeigt den dringendsten Zustand ihrer Sessions: eine Session,
    // die dich braucht, darf nicht hinter einer fertigen verschwinden.
    const fuehrend = gruppe.sessions[0];
    gruppe.status = fuehrend.status;
    gruppe.color = fuehrend.color;
    gruppe.since = Math.min(...gruppe.sessions.map((s) => s.since));
  }

  liste.sort((a, b) => RANK[a.status] - RANK[b.status] || a.since - b.since);
  return liste;
}
