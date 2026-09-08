// Zustandsmaschine: verbindet Hook-Ereignisse mit dem, was der Scanner sieht,
// und macht daraus eine Ampelfarbe pro Session.

const COLOR = {
  attention: 'red',
  question: 'red',
  stalled: 'red',
  running: 'yellow',
  done: 'green',
  unknown: 'grey',
};

// Reihenfolge im Dashboard: was dich braucht, steht oben.
const RANK = { attention: 0, question: 1, stalled: 2, running: 3, done: 4, unknown: 5 };

const DEFAULTS = { stallSeconds: 300, orphanAfterMinutes: 10 };

export class StateStore {
  constructor(config = {}) {
    this.config = { ...DEFAULTS, ...config };
    /** @type {Map<string, {status: string, since: number, lastActivity: number, note: string|null}>} */
    this.hookState = new Map();
    /** @type {Map<string, {status: string, since: number}>} */
    this.shown = new Map();
  }

  /** Nimmt ein Hook-Ereignis entgegen. Unbekannte Ereignisse werden ignoriert. */
  handleHook(payload) {
    const id = payload?.session_id;
    const event = payload?.hook_event_name;
    if (typeof id !== 'string' || !id || typeof event !== 'string') return false;

    const now = Date.now();
    const prev = this.hookState.get(id);

    if (event === 'SessionEnd') {
      this.hookState.delete(id);
      return true;
    }

    let status = prev?.status ?? 'unknown';
    let note = prev?.note ?? null;

    switch (event) {
      case 'SessionStart':
        status = 'done';
        note = null;
        break;
      case 'UserPromptSubmit':
        status = 'running';
        note = null;
        break;
      case 'PreToolUse':
      case 'PostToolUse':
        status = 'running';
        note = payload.tool_name ?? null;
        break;
      case 'Notification':
        status = 'attention';
        note = typeof payload.message === 'string' ? payload.message : null;
        break;
      case 'Stop':
        status = 'done';
        note = null;
        break;
      case 'SubagentStop':
        // Ein Subagent ist fertig, der Haupt-Turn laeuft weiter.
        status = status === 'attention' ? 'attention' : 'running';
        break;
      default:
        return false;
    }

    this.hookState.set(id, { status, since: now, lastActivity: now, note });
    return true;
  }

  /**
   * Verrechnet die aktuelle Scanner-Momentaufnahme mit den Hook-Ereignissen.
   * Gibt die fertig sortierte Anzeige-Liste zurueck.
   */
  update(sessions, now = Date.now()) {
    const alive = new Set(sessions.map((s) => s.sessionId));
    for (const id of this.hookState.keys()) if (!alive.has(id)) this.hookState.delete(id);
    for (const id of this.shown.keys()) if (!alive.has(id)) this.shown.delete(id);

    const rows = sessions.map((session) => this.#row(session, now));
    rows.sort((a, b) => RANK[a.status] - RANK[b.status] || a.since - b.since);
    return rows;
  }

  #row(session, now) {
    const hook = this.hookState.get(session.sessionId);
    const derived = deriveFromTranscript(session);

    // Ein Hook weiss immer mehr als eine Ableitung aus der Transkriptdatei.
    let status = hook ? hook.status : derived.status;

    // Ausnahme: der Stop-Hook meldet nur "Turn zu Ende". Ob Claude dabei eine
    // Frage gestellt hat, steht allein im Transkript -- und dann wartet die
    // Session auf dich, statt fertig zu sein.
    if (status === 'done' && derived.status === 'question') status = 'question';
    let note = hook ? hook.note : derived.note;
    let lastActivity = hook ? hook.lastActivity : derived.lastActivity;
    const source = hook ? 'hook' : derived.source;

    // "Steht geblieben": laeuft angeblich, ruehrt sich aber nicht mehr.
    if (status === 'running' && lastActivity && now - lastActivity > this.config.stallSeconds * 1000) {
      status = 'stalled';
      note = note ?? null;
    }

    const previous = this.shown.get(session.sessionId);
    const since = previous && previous.status === status ? previous.since : now;
    this.shown.set(session.sessionId, { status, since });

    // Verwaist: Claude Code hat das Transkript weggeraeumt und die Session hat
    // sich seit Langem nicht gemeldet -- ein vergessener Prozess in einem alten
    // Fenster. Die Schonfrist schuetzt frisch gestartete Sessions, die ihr
    // Transkript noch nicht angelegt haben. Ein einziger Hook holt sie zurueck.
    const zuJung = session.startedAt && now - session.startedAt < this.config.orphanAfterMinutes * 60 * 1000;
    const orphan = !hook && derived.source === 'none' && !zuJung;

    return {
      orphan,
      sessionId: session.sessionId,
      pid: session.pid,
      name: session.name,
      title: session.tail?.aiTitle ?? null,
      cwd: session.cwd,
      folder: basename(session.cwd),
      version: session.version,
      startedAt: session.startedAt,
      status,
      color: COLOR[status],
      source,
      note,
      since,
      lastActivity,
      lastText: trim(session.tail?.lastAssistantText, 240),
      kontext: session.tail?.kontext ?? null,
      verdichtet: Boolean(session.tail?.verdichtet),
      hasTranscript: Boolean(session.transcriptPath),
    };
  }
}

function deriveFromTranscript(session) {
  const tail = session.tail;
  const turn = tail?.lastTurn;
  if (!session.transcriptPath || !tail || !turn) {
    // Claude Code raeumt alte Transkripte weg -- dann lieber grau als geraten.
    return { status: 'unknown', note: null, lastActivity: null, source: 'none' };
  }

  const lastActivity = tail.mtime instanceof Date ? tail.mtime.getTime() : null;

  // Turn sauber beendet. Aber: endet er mit einer Frage oder einem Vorschlag,
  // auf den Claude eine Antwort braucht, ist das kein "fertig" -- dann steht
  // die Session genauso still wie bei einer Freigabe-Anfrage.
  if (turn.type === 'assistant' && turn.stopReason === 'end_turn') {
    if (tail.frage) return { status: 'question', note: null, lastActivity, source: 'derived' };
    return { status: 'done', note: null, lastActivity, source: 'derived' };
  }
  // Tool-Aufruf abgeschickt oder Tool-Ergebnis zurueck -> Claude ist mittendrin.
  return {
    status: 'running',
    note: turn.toolName ?? null,
    lastActivity,
    source: 'derived',
  };
}

function basename(p) {
  if (!p) return null;
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

function trim(text, max) {
  if (typeof text !== 'string') return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}
