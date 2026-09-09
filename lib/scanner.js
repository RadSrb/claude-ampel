// Entdeckt laufende Claude-Code-Sessions. Ausschliesslich lesend --
// unter ~/.claude wird von dieser App nichts geschrieben.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
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
    limit: limitStand(lastAssistantText),
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

// Stellen, an denen ein "?" nichts ueber die Absicht aussagt: Code, Linkziele,
// Zitate. `GET /api/lauf?probe=1` ist keine Rueckfrage an den Menschen, und
// "antwortet jetzt auf „gibt es neue Bewerber?“" ist ein Bericht.
function ohneBeiwerk(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\]\([^)\s]*\)/g, '] ')
    .replace(/[„“»"][^\n]{0,200}?[“”«"]/g, ' ')
    .trim();
}

const istAufzaehlung = (absatz) =>
  absatz.split('\n').every((zeile) => /^\s*([-*+]|\d+[.)]|\|)/.test(zeile));

/**
 * Der Schluss einer Nachricht: der letzte Fliesstext-Absatz mitsamt der Liste
 * oder Tabelle, die daran haengt. Genau diese Form hat die haeufigste
 * Rueckfrage -- "Was soll damit geschehen?" und darunter die Moeglichkeiten.
 * Wer nur den allerletzten Absatz ansieht, findet dort bloss die Aufzaehlung.
 */
function schlussAbschnitt(text) {
  const absaetze = ohneBeiwerk(text)
    .split(/\n\s*\n/)
    .map((a) => a.trim())
    .filter(Boolean);
  let i = absaetze.length - 1;
  while (i > 0 && istAufzaehlung(absaetze[i])) i--;
  return absaetze.slice(i).join('\n');
}

// Eine Bitte ist eine Frage ohne Fragezeichen: "Schick mir die URLs." wartet
// genauso auf den Menschen wie "Passt das so?".
const BITTE =
  /\b(sag|sagt|schreib|schreibt|schick|schickt|gib|gebt|nenn|nennt)\s*,?\s*(mir|uns|mal|kurz|bescheid|was|wo|wie|ob|welche[rsnm]?)\b|\bsag(t)? bescheid\b|\blass(t)? mich wissen\b|\bwenn du (willst|magst)\b/i;

/**
 * Wartet Claude auf eine Antwort, obwohl der Turn technisch beendet ist?
 * Drei Anzeichen: ein Auswahl- oder Freigabe-Werkzeug war das Letzte, was lief,
 * im Schluss steht ein Fragezeichen, oder der Schluss bittet um etwas.
 *
 * Gegen 2874 beendete Turns aus 98 echten Transkripten geprueft. Die fruehere
 * Regel "der Text endet auf ?" fand 164 davon (5,7 %) -- sie war blind fuer
 * jede Rueckfrage, hinter der noch ein Satz stand, und fuer jede Bitte ohne
 * Fragezeichen. Beides ist der Normalfall, nicht die Ausnahme.
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
  const schluss = schlussAbschnitt(lastAssistantText);
  return schluss.includes('?') || BITTE.test(schluss);
}

// Claude meldet ein erreichtes Nutzungslimit im Klartext der letzten Nachricht
// und beendet den Zug mit stop_reason "stop_sequence". Gegen 332 echte
// Nutzereingaben geprueft: 5 Treffer, 0 Fehlalarme. Das ist kein Fertigwerden,
// sondern eine Wand -- und darf deshalb niemals gruen angezeigt werden.
const LIMIT = /(hit your (session|usage) limit)|((claude )?(ai )?usage limit reached)/i;

/**
 * @param {string|null|undefined} lastAssistantText
 * @returns {{zurueckUm: string|null, zone: string|null}|null}
 */
export function limitStand(lastAssistantText) {
  if (typeof lastAssistantText !== "string" || !lastAssistantText) return null;
  if (!LIMIT.test(lastAssistantText)) return null;

  // "... resets 4:50pm (Europe/Vienna)" -- beide Angaben sind freiwillig.
  const zeit = lastAssistantText.match(/resets? (?:at )?([^ (.,]+)/i);
  const zone = lastAssistantText.match(/[(]([A-Za-z]+[/][A-Za-z_]+)[)]/);
  return { zurueckUm: zeit ? zeit[1] : null, zone: zone ? zone[1] : null };
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
// tasklist kostet rund 350 ms. Synchron bei jedem Takt aufgerufen hielt es
// den Server ein Viertel der Zeit an. Jetzt wird im Hintergrund aufgefrischt
// und der Takt blockiert nie.
const PID_TTL = 5000;
let pidStand = { set: new Set(), at: 0 };
let pidLaeuft = false;

/** @param {string} csv Ausgabe von tasklist /FO CSV /NH */
export function pidsAusCsv(csv) {
  const pids = new Set();
  // fromCharCode(10) statt Escape-Sequenz -- siehe Kommentar im Commit.
  for (const zeile of String(csv ?? "").split(String.fromCharCode(10))) {
    const m = zeile.match(/^"[^"]*","([0-9]+)"/);
    if (m) pids.add(Number(m[1]));
  }
  return pids;
}

const TASKLIST = ["/FI", "IMAGENAME eq claude.exe", "/FO", "CSV", "/NH"];

function pidsAuffrischen() {
  if (pidLaeuft) return;
  pidLaeuft = true;
  execFile("tasklist", TASKLIST, { encoding: "utf8", windowsHide: true, timeout: 5000 }, (err, out) => {
    pidLaeuft = false;
    if (!err && out) pidStand = { set: pidsAusCsv(out), at: Date.now() };
  });
}

/**
 * Billiger Existenztest. Faengt eine beendete Session sofort ab, statt bis
 * zur naechsten Auffrischung zu warten -- kostet 0,01 ms statt 350 ms.
 * EPERM heisst: es gibt den Prozess, wir duerfen ihn nur nicht anfassen.
 */
export function pidLebt(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

export function getLivePids() {
  if (!pidStand.at) {
    // Erster Aufruf: einmal blockierend, damit der Start sofort stimmt.
    try {
      pidStand = {
        set: pidsAusCsv(execFileSync("tasklist", TASKLIST, { encoding: "utf8", windowsHide: true, timeout: 5000 })),
        at: Date.now(),
      };
    } catch {
      pidStand = { set: new Set(), at: Date.now() };
    }
  } else if (Date.now() - pidStand.at > PID_TTL) {
    pidsAuffrischen();
  }

  // Der Zwischenspeicher darf bis zu PID_TTL alt sein; der Existenztest
  // sortiert inzwischen beendete Sessions sofort aus.
  const lebend = new Set();
  for (const pid of pidStand.set) if (pidLebt(pid)) lebend.add(pid);
  return lebend;
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
