// Entdeckt laufende Claude-Code-Sessions. Ausschliesslich lesend --
// unter ~/.claude wird von dieser App nichts geschrieben.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { fensterFuer, settingsModell, envMaxTokens } from './kontextfenster.js';

const TAIL_BYTES = 64 * 1024;
const MAX_TAIL_BYTES = 4 * 1024 * 1024;

// Eintragstypen, die ein echter Gespraechsschritt sind. Alles andere
// (frame-link, atis-latch, ai-title, attachment ...) ist Buchhaltung.
const CONVERSATION_TYPES = new Set(['assistant', 'user']);

/**
 * Woher die Fenstergroesse kommt. Die Modellwahl aus settings.json wird kurz
 * gepuffert, damit nicht bei jeder Datei neu gelesen wird -- sie aendert sich
 * selten, aber eine Aenderung soll spaetestens nach ein paar Sekunden greifen.
 */
let quellenStand = { wert: null, at: 0 };
function aktuelleQuellen() {
  if (Date.now() - quellenStand.at > 5000) {
    quellenStand = { wert: { settingsWert: settingsModell(), envMax: envMaxTokens() }, at: Date.now() };
  }
  return quellenStand.wert;
}

// Schluessel: pfad|groesse|mtime -- aendert sich die Datei, faellt der Eintrag weg.
const tailCache = new Map();

function readChunk(file, size, window) {
  const start = Math.max(0, size - window);
  const length = size - start;
  const buf = Buffer.alloc(length);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, length, start);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return { start, text: buf.toString('utf8') };
}

function parseLines(text, dropFirst) {
  const lines = text.split('\n');
  // Bei einem Offset > 0 ist die erste Zeile mitten im JSON abgeschnitten.
  if (dropFirst) lines.shift();

  const parsed = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      parsed.push(JSON.parse(t));
    } catch {
      // Halbe oder beschaedigte Zeile -- ueberspringen.
    }
  }
  return parsed;
}

export function defaultClaudeDir() {
  return path.join(os.homedir(), '.claude');
}

/**
 * Bildet den Ordnernamen nach, den Claude Code unter projects/ aus dem cwd
 * ableitet: Doppelpunkt, Backslash und Leerzeichen werden zu "-".
 * Gross-/Kleinschreibung bleibt wie im cwd (c--Projekte-Agenten vs C--Users-Alexander).
 */
export function slugForCwd(cwd) {
  return cwd.replace(/[:\\/ ]/g, '-');
}

/** Liest die letzten Bytes einer JSONL-Datei und wertet die letzte gueltige Zeile aus. */
export function readTranscriptTail(file, tailBytes = TAIL_BYTES, kontextQuellen = aktuelleQuellen()) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }

  // Transkripte werden mehrere MB gross. Solange sich Groesse und Zeitstempel
  // nicht aendern, ist das Ergebnis von vorhin noch gueltig.
  const key = `${file}|${stat.size}|${stat.mtimeMs}`;
  const hit = tailCache.get(key);
  if (hit) return hit;

  // Zwei Gruende, das Fenster zu vergroessern:
  // 1. eine einzelne Zeile ist groesser als das Fenster (grosses Tool-Ergebnis),
  // 2. im Fenster stehen nur Buchhaltungseintraege (attachment, ai-title ...)
  //    und kein einziger Gespraechsschritt -- dann waere die Ampel blind.
  let parsed = [];
  let window = tailBytes;
  while (true) {
    const chunk = readChunk(file, stat.size, window);
    if (chunk === null) return null;
    parsed = parseLines(chunk.text, chunk.start > 0);
    const brauchbar = parsed.some((e) => CONVERSATION_TYPES.has(e?.type));
    if (brauchbar || chunk.start === 0 || window >= MAX_TAIL_BYTES) break;
    window *= 2;
  }

  const last = parsed.length ? parsed[parsed.length - 1] : null;

  let lastAssistantText = null;
  for (let i = parsed.length - 1; i >= 0 && lastAssistantText === null; i--) {
    const entry = parsed[i];
    if (entry?.type !== 'assistant') continue;
    lastAssistantText = textOf(entry.message?.content);
  }

  // Der von Claude Code vergebene Titel -- steht so auch im VS-Code-Fenstertitel.
  let aiTitle = null;
  for (let i = parsed.length - 1; i >= 0 && aiTitle === null; i--) {
    if (parsed[i]?.type === 'ai-title' && typeof parsed[i].aiTitle === 'string') {
      aiTitle = parsed[i].aiTitle;
    }
  }

  // frame-link, atis-latch, ai-title u. ae. sind Buchhaltung, keine Gespraechszeilen.
  // Fuer die Ampel zaehlt der letzte echte Gespraechseintrag.
  let lastTurn = null;
  for (let i = parsed.length - 1; i >= 0 && lastTurn === null; i--) {
    if (CONVERSATION_TYPES.has(parsed[i]?.type)) lastTurn = parsed[i];
  }

  const result = {
    mtime: stat.mtime,
    size: stat.size,
    lastEntry: last ? describeEntry(last) : null,
    lastTurn: lastTurn ? describeEntry(lastTurn) : null,
    lastAssistantText,
    aiTitle,
    frage: istFrage(parsed, lastAssistantText),
    kontext: kontextStand(parsed, kontextQuellen),
    verdichtet: schonVerdichtet(parsed),
  };

  // Nur der jeweils juengste Stand pro Datei wird behalten.
  for (const k of tailCache.keys()) if (k.startsWith(`${file}|`)) tailCache.delete(k);
  tailCache.set(key, result);
  return result;
}

// Werkzeuge, mit denen Claude ausdruecklich auf eine Entscheidung wartet.
const WARTE_WERKZEUGE = new Set(['AskUserQuestion', 'ExitPlanMode']);

/**
 * Wie voll ist der Kontext? Entspricht dem Kreis, den Claude Code selbst
 * anzeigt, bevor es verdichtet.
 *
 * Der groesste im Ausschnitt gesehene Verbrauch zaehlt als Beweis fuer die
 * Fenstergroesse: was einmal hineingepasst hat, passt hinein.
 */
export function kontextStand(parsed, quellen = {}) {
  let aktuell = null;
  let hoechster = 0;

  for (let i = parsed.length - 1; i >= 0; i--) {
    const entry = parsed[i];
    if (entry?.type !== 'assistant') continue;
    const u = entry.message?.usage;
    if (!u) continue;

    const tokens =
      (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    if (!tokens) continue;

    if (tokens > hoechster) hoechster = tokens;
    if (!aktuell) aktuell = { tokens, modell: entry.message?.model ?? null };
  }

  if (!aktuell) return null;

  const { fenster, quelle } = fensterFuer(aktuell.modell, hoechster, quellen);
  return {
    tokens: aktuell.tokens,
    fenster,
    fensterQuelle: quelle,
    prozent: Math.min(100, Math.round((aktuell.tokens / fenster) * 100)),
    modell: aktuell.modell,
  };
}

/** Wurde in diesem Ausschnitt bereits verdichtet? */
export function schonVerdichtet(parsed) {
  return parsed.some((e) => e?.subtype === 'compact_boundary' || e?.isCompactSummary === true);
}

/**
 * Wartet Claude auf eine Antwort, obwohl der Turn technisch beendet ist?
 * Zwei Anzeichen: ein Auswahl- oder Freigabe-Werkzeug war das Letzte, was lief,
 * oder der Text endet mit einer Frage.
 */
export function istFrage(parsed, lastAssistantText) {
  // Rueckwaerts bis zum letzten echten Gespraechsschritt: war es eines der
  // Werkzeuge, die auf den Menschen warten?
  for (let i = parsed.length - 1; i >= 0; i--) {
    const entry = parsed[i];
    if (!CONVERSATION_TYPES.has(entry?.type)) continue;
    const blocks = Array.isArray(entry.message?.content) ? entry.message.content : [];
    if (blocks.some((b) => b?.type === 'tool_use' && WARTE_WERKZEUGE.has(b.name))) return true;
    break;
  }

  if (typeof lastAssistantText !== 'string') return false;
  // Aufzaehlungen und Codebloecke am Ende ausklammern -- entscheidend ist der
  // letzte Satz, den Claude tatsaechlich an den Menschen richtet.
  const sauber = lastAssistantText.replace(/```[\s\S]*?```/g, ' ').trim();
  return sauber.endsWith('?');
}

function textOf(content) {
  if (typeof content === 'string') return content.trim() || null;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
  return text || null;
}

function describeEntry(entry) {
  const content = entry.message?.content;
  const blocks = Array.isArray(content) ? content : [];
  const toolUse = blocks.find((c) => c?.type === 'tool_use');
  const toolResult = blocks.find((c) => c?.type === 'tool_result');
  return {
    type: entry.type ?? null,
    role: entry.message?.role ?? null,
    stopReason: entry.message?.stop_reason ?? null,
    hasToolUse: Boolean(toolUse),
    hasToolResult: Boolean(toolResult),
    toolName: toolUse?.name ?? null,
    isMeta: Boolean(entry.isMeta),
    timestamp: entry.timestamp ?? null,
    text: textOf(content),
  };
}

/** Liest die Session-Registry, die Claude Code selbst pflegt. */
export function readSessionRegistry(claudeDir) {
  const dir = path.join(claudeDir, 'sessions');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (rec && typeof rec.sessionId === 'string' && Number.isInteger(rec.pid)) out.push(rec);
    } catch {
      // Datei wird gerade geschrieben oder ist beschaedigt -- ignorieren.
    }
  }
  return out;
}

// Ein einmal gefundener Transkriptpfad aendert sich nicht mehr.
const transcriptCache = new Map();

export function findTranscript(claudeDir, cwd, sessionId) {
  const cached = transcriptCache.get(sessionId);
  if (cached !== undefined) {
    if (cached === null || fs.existsSync(cached)) return cached;
    transcriptCache.delete(sessionId);
  }

  const projects = path.join(claudeDir, 'projects');
  const guess = path.join(projects, slugForCwd(cwd), `${sessionId}.jsonl`);
  if (fs.existsSync(guess)) {
    transcriptCache.set(sessionId, guess);
    return guess;
  }

  // Der Slug ist nicht die Quelle der Wahrheit: notfalls alle Projektordner absuchen.
  let dirs;
  try {
    dirs = fs.readdirSync(projects, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const candidate = path.join(projects, d.name, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) {
      transcriptCache.set(sessionId, candidate);
      return candidate;
    }
  }

  // Noch kein Transkript (frische Session) -- nicht negativ cachen.
  return null;
}

/** PIDs aller laufenden claude-Prozesse. Ein Aufruf pro Scan, nicht einer pro PID. */
export function getLivePids() {
  const pids = new Set();
  try {
    const csv = execFileSync('tasklist', ['/FI', 'IMAGENAME eq claude.exe', '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    for (const line of csv.split('\n')) {
      const m = line.match(/^"[^"]*","(\d+)"/);
      if (m) pids.add(Number(m[1]));
    }
  } catch {
    // tasklist nicht verfuegbar -> leeres Set, der Aufrufer entscheidet.
  }
  return pids;
}

/**
 * Momentaufnahme aller lebenden Sessions.
 * livePids wird injiziert, damit Tests ohne echte Prozesse auskommen.
 */
export function scan({ claudeDir = defaultClaudeDir(), livePids = getLivePids() } = {}) {
  const sessions = [];
  const seen = new Set();

  for (const rec of readSessionRegistry(claudeDir)) {
    if (!livePids.has(rec.pid)) continue;
    // Nach einem Neustart kann eine SessionId unter zwei PIDs stehen: neueste gewinnt.
    if (seen.has(rec.sessionId)) continue;
    seen.add(rec.sessionId);

    const transcriptPath = findTranscript(claudeDir, rec.cwd ?? '', rec.sessionId);
    sessions.push({
      sessionId: rec.sessionId,
      pid: rec.pid,
      name: rec.name ?? null,
      cwd: rec.cwd ?? null,
      version: rec.version ?? null,
      entrypoint: rec.entrypoint ?? null,
      startedAt: rec.startedAt ?? null,
      transcriptPath,
      tail: transcriptPath ? readTranscriptTail(transcriptPath) : null,
    });
  }

  return sessions;
}

// Direkt aufrufbar zum Pruefen: node lib/scanner.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sessions = scan();
  console.log(`${sessions.length} lebende Session(s)\n`);
  for (const s of sessions) {
    const last = s.tail?.lastEntry;
    console.log(
      [
        (s.name ?? '?').padEnd(34),
        (s.entrypoint ?? '?').padEnd(14),
        String(s.pid).padStart(6),
        s.transcriptPath ? 'transkript ok ' : 'KEIN TRANSKRIPT',
        last ? `${last.type}/${last.stopReason ?? '-'}${last.hasToolUse ? '/tool' : ''}` : '-',
      ].join(' '),
    );
  }
}
