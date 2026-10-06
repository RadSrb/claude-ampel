// Buchfuehrung ueber Hintergrund-Befehle und Monitore einer Session.
//
// Ein Bash-Befehl mit run_in_background oder ein Monitor arbeitet weiter,
// nachdem Claude den Turn beendet hat -- ohne einen Subagenten und ohne eine
// Zeile ins Haupt-Transkript. Die Ampel zeigte solche Sessions gruen, obwohl
// zum Beispiel ein Massenlauf ueber hundert Seiten noch lief.
//
// Der Start steht im Werkzeugergebnis (backgroundTaskId bzw. taskId mit
// timeoutMs), das Ende als <task-notification> mit <status> oder als TaskStop.
// Fortgesetzte Sessions schreiben alte Eintraege erneut ins Transkript, ein
// Ende kann also vor seinem Start stehen -- deshalb Mengen statt Reihenfolge.

// Gegen 1379 Hintergrund-Starts aus allen Transkripten geprueft: bei einzelnen
// Arbeitsbefehlen fehlte die Abschlussmeldung. Ohne Grenze stuende die Kachel
// dann bis zum Ende der Session auf gelb.
const BEFEHL_HOECHSTENS_MS = 2 * 60 * 60 * 1000;

// Server laufen, bis die Session endet -- sie sind Werkzeug, keine Arbeit.
// Gesammelt aus den Befehlen, die im Korpus nie eine Abschlussmeldung bekamen.
const SERVER = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|preview|serve)(?::[\w-]+)?(?=\s|$|[;&|>])/,
  /\bnpx\s+(?:--?[\w-]+\s+)*(?:next|astro|nuxt|remix)\s+(?:dev|start|preview)\b/,
  /\bnpx\s+(?:--?[\w-]+\s+)*vite\b(?!\s+build)/,
  /\bnpx\s+(?:--?[\w-]+\s+)*(?:serve|http-server|live-server)\b/,
  /\bhttp\.server\b/,
  /\bserve\.py\b/,
  /\bcloudflared\b/,
  /\bngrok\b/,
  /\buvicorn\b/,
  /\bflask\s+run\b/,
  /\bwrangler\s+dev\b/,
];

// Claude beschreibt jeden Befehl in einem Satz -- "Start voice dev server".
const SERVER_BESCHREIBUNG = /server|tunnel/i;

/**
 * Laeuft der Befehl als Server bis zum Session-Ende?
 * @param {string|null|undefined} befehl
 * @param {string|null|undefined} [beschreibung]
 */
export function istServer(befehl, beschreibung) {
  if (typeof beschreibung === 'string' && SERVER_BESCHREIBUNG.test(beschreibung)) return true;
  if (typeof befehl !== 'string') return false;
  return SERVER.some((re) => re.test(befehl));
}

export function neuesBuch() {
  return {
    /** @type {Map<string, {id: string, art: 'befehl'|'monitor', start: number, bis: number|null, befehl: string|null, beschreibung: string|null}>} */
    starts: new Map(),
    /** @type {Set<string>} */
    enden: new Set(),
    // Aufrufe, deren Ergebnis noch aussteht: tool_use-id -> Befehl.
    /** @type {Map<string, {befehl: string|null, beschreibung: string|null}>} */
    aufrufe: new Map(),
  };
}

const MELDUNG = /<task-notification>[\s\S]*?<\/task-notification>/g;
const MAX_AUFRUFE = 50;

function texte(entry) {
  const out = [];
  const c = entry?.message?.content;
  if (typeof c === 'string') out.push(c);
  else if (Array.isArray(c)) for (const b of c) if (b?.type === 'text' && typeof b.text === 'string') out.push(b.text);
  if (typeof entry?.content === 'string') out.push(entry.content);
  if (typeof entry?.attachment?.prompt === 'string') out.push(entry.attachment.prompt);
  return out;
}

/** Verbucht einen Transkript-Eintrag. */
export function buchen(buch, entry) {
  const blocks = Array.isArray(entry?.message?.content) ? entry.message.content : [];

  for (const b of blocks) {
    if (b?.type !== 'tool_use') continue;
    if (b.name === 'TaskStop') {
      const id = b.input?.task_id ?? b.input?.shell_id;
      if (typeof id === 'string') buch.enden.add(id);
    } else if (b.name === 'Bash' || b.name === 'PowerShell' || b.name === 'Monitor') {
      buch.aufrufe.set(b.id, {
        befehl: typeof b.input?.command === 'string' ? b.input.command : null,
        beschreibung: typeof b.input?.description === 'string' ? b.input.description : null,
      });
      // Gewoehnliche Ergebnisse liest der Scanner gar nicht erst -- ohne
      // Grenze sammelte sich hier jeder Befehl der Session.
      if (buch.aufrufe.size > MAX_AUFRUFE) buch.aufrufe.delete(buch.aufrufe.keys().next().value);
    }
  }

  const r = entry?.toolUseResult;
  if (r && typeof r === 'object') {
    const ergebnis = blocks.find((b) => b?.type === 'tool_result');
    const aufruf = ergebnis ? buch.aufrufe.get(ergebnis.tool_use_id) : undefined;
    if (ergebnis) buch.aufrufe.delete(ergebnis.tool_use_id);
    const start = Date.parse(entry.timestamp ?? '');
    const monitor = typeof r.taskId === 'string' && typeof r.timeoutMs === 'number';
    const id = typeof r.backgroundTaskId === 'string' ? r.backgroundTaskId : monitor ? r.taskId : null;
    if (id && Number.isFinite(start) && !buch.starts.has(id)) {
      buch.starts.set(id, {
        id,
        art: monitor && !r.backgroundTaskId ? 'monitor' : 'befehl',
        start,
        bis: monitor && !r.persistent ? start + r.timeoutMs : null,
        befehl: aufruf?.befehl ?? null,
        beschreibung: aufruf?.beschreibung ?? null,
      });
    }
  }

  for (const text of texte(entry)) {
    if (!text.includes('<task-notification>')) continue;
    for (const m of text.match(MELDUNG) ?? []) {
      // Monitor-Ereignisse tragen keinen Status -- der Monitor laeuft weiter.
      if (!/<status>[^<]+<\/status>/.test(m)) continue;
      const id = m.match(/<task-id>([^<]+)<\/task-id>/)?.[1];
      if (id) buch.enden.add(id);
    }
  }
}

/**
 * Was laeuft gerade im Hintergrund und ist Arbeit?
 * @param {ReturnType<typeof neuesBuch>} buch
 * @param {{seit?: number|null, now?: number}} [opts] seit: Start des Session-Prozesses
 */
export function offene(buch, { seit = null, now = Date.now() } = {}) {
  const out = [];
  for (const s of buch.starts.values()) {
    if (buch.enden.has(s.id)) continue;
    // Aus einem frueheren Prozess der Session -- der ist samt Kindern tot.
    if (seit && s.start < seit) continue;
    if (s.art === 'monitor') {
      if (s.bis !== null && now >= s.bis) continue;
    } else {
      if (istServer(s.befehl, s.beschreibung)) continue;
      if (now - s.start > BEFEHL_HOECHSTENS_MS) continue;
    }
    out.push(s);
  }
  return out;
}
