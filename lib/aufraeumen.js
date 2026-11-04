// Raeumt hinter beendeten Claude-Sessions auf.
//
// Solange eine Session lebt, merkt sich die Ampel ihren Prozessbaum (alle
// Nachfahren mit PID und Startzeit). Ist die Session weg, werden die noch
// lebenden Nachfahren beendet -- Dev-Server, MCP-Server, SDK-Prozesse, die
// eine Claude-Shell gestartet hat. Windows haengt Waisen nicht um: ohne diesen
// Speicher waere nach dem Tod der Session nicht mehr zu sehen, wem sie gehoerten.
//
// Der Speicher liegt in einer Datei, damit ein Neustart der Ampel nichts
// vergisst. Vor jedem Beenden werden PID UND Startzeit gegengeprueft -- eine
// inzwischen neu vergebene PID wird nie getroffen.
//
// Niemals beendet (und nie durchwandert, d. h. auch ihre Kinder nicht):
//   - Prozesse mit geschuetztem Namen (VS Code, Terminal, conhost, Explorer,
//     spacedesk, Systemdienste, Aufgabenplanung)
//   - die Ampel selbst samt Vorfahren (watchdog) und Kindern (host.ps1)
//   - alles, dessen Kommandozeile auf eine Ausnahme passt (config.json
//     "aufraeumenAusnahmen", z. B. iPad-Cockpit, Nachtlaeufe)
//   - andere lebende Claude-Sessions samt ihren Baeumen
// Sessions, die aus der Aufgabenplanung stammen, werden gar nicht verfolgt.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const GESCHUETZTE_NAMEN = new Set([
  'code.exe',
  'code - insiders.exe',
  'cursor.exe',
  'windsurf.exe',
  'vscodium.exe',
  'windowsterminal.exe',
  'openconsole.exe',
  'conhost.exe',
  'explorer.exe',
  'spacedeskservice.exe',
  'spacedeskservicetray.exe',
  'svchost.exe',
  'taskhostw.exe',
  'taskeng.exe',
  'services.exe',
  'wininit.exe',
  'winlogon.exe',
  'csrss.exe',
  'smss.exe',
  'lsass.exe',
  'dwm.exe',
  'sihost.exe',
  'system',
]);

// Prozesse, die die Aufgabenplanung startet, haengen unter diesen.
const PLANER = new Set(['svchost.exe', 'taskhostw.exe', 'taskeng.exe']);

// Kommandozeilen, die nie beendet werden -- ergaenzbar ueber config.json.
// Nachtlaeufe laufen bewusst weiter, auch wenn die Session, die sie
// angestossen hat, laengst zu ist.
export const STANDARD_AUSNAHMEN = [
  'ClaudeAmpel',
  'iPadCockpit',
  'spacedesk',
  'seedvr',
  'nachtlauf',
  'Speicher-Aufraeumen',
  'docker',
];

// Die Bash-/PowerShell-Huelle des Bash-Werkzeugs von Claude Code. Ihre
// Kommandozeile traegt diesen Namen -- sonst startet ihn niemand.
const CLAUDE_SHELL = 'CLAUDE_CODE_SHELL_LAUNCHER_SCRIPT';

// Eine Sekunde: Registry (procStart) und WMI runden unterschiedlich.
const START_TOLERANZ = 10_000_000n;

function zahl(s) {
  return typeof s === 'string' && /^[0-9]+$/.test(s) ? BigInt(s) : null;
}

/** Gleiche Startzeit (FILETIME als Text)? Fehlt eine, ist es NICHT derselbe Prozess. */
export function gleicheStartzeit(a, b) {
  const x = zahl(a);
  const y = zahl(b);
  if (x === null || y === null) return false;
  const d = x - y;
  return (d < 0n ? -d : d) <= START_TOLERANZ;
}

/**
 * Baut Nachschlagewerke aus der Prozessliste. Eine Eltern-Kind-Kante zaehlt
 * nur, wenn der Elternteil VOR dem Kind gestartet ist -- sonst ist die
 * Eltern-PID laengst neu vergeben und der Prozess dort ein Fremder.
 *
 * @param {{p:number, pp:number, s:string, n:string, c:string}[]} prozesse
 */
export function indexieren(prozesse) {
  const nachPid = new Map();
  for (const pr of prozesse ?? []) if (Number.isInteger(pr?.p)) nachPid.set(pr.p, pr);
  const eltern = new Map();
  const kinder = new Map();
  for (const pr of nachPid.values()) {
    const e = nachPid.get(pr.pp);
    if (!e || e.p === pr.p) continue;
    const se = zahl(e.s);
    const sk = zahl(pr.s);
    if (se === null || sk === null || se > sk) continue;
    eltern.set(pr.p, e);
    if (!kinder.has(e.p)) kinder.set(e.p, []);
    kinder.get(e.p).push(pr);
  }
  return { nachPid, eltern, kinder };
}

export function vorfahren(idx, pr) {
  const out = [];
  const gesehen = new Set([pr.p]);
  let e = idx.eltern.get(pr.p);
  while (e && !gesehen.has(e.p)) {
    out.push(e);
    gesehen.add(e.p);
    e = idx.eltern.get(e.p);
  }
  return out;
}

function nachkommen(idx, pr) {
  const out = [];
  const stapel = [...(idx.kinder.get(pr.p) ?? [])];
  const gesehen = new Set([pr.p]);
  while (stapel.length) {
    const k = stapel.pop();
    if (gesehen.has(k.p)) continue;
    gesehen.add(k.p);
    out.push(k);
    stapel.push(...(idx.kinder.get(k.p) ?? []));
  }
  return out;
}

/** Die Ampel selbst: eigener Prozess, alle Vorfahren (watchdog), alle Kinder (host.ps1). */
export function eigeneProzesse(idx, eigenePid) {
  const set = new Set([eigenePid]);
  const ich = idx.nachPid.get(eigenePid);
  if (ich) {
    for (const v of vorfahren(idx, ich)) set.add(v.p);
    for (const k of nachkommen(idx, ich)) set.add(k.p);
  }
  return set;
}

export function ausnahmenMuster(liste) {
  const out = [];
  for (const m of liste ?? []) {
    if (typeof m !== 'string' || !m) continue;
    try {
      out.push(new RegExp(m, 'i'));
    } catch {
      // Kein gueltiger regulaerer Ausdruck -- dann als woertlicher Text.
      out.push(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
  }
  return out;
}

export function istGeschuetzt(pr, { ausnahmen = [], eigene = new Set() } = {}) {
  if (!pr) return true;
  if (eigene.has(pr.p)) return true;
  if (GESCHUETZTE_NAMEN.has(String(pr.n ?? '').toLowerCase())) return true;
  const c = String(pr.c ?? '');
  return ausnahmen.some((re) => re.test(c));
}

// Fenster, aus denen ein Mensch Claude startet. Windows Terminal haengt selbst
// unter einem svchost (DCOM) -- wer auf dem Weg nach oben zuerst hier
// vorbeikommt, stammt nicht aus der Aufgabenplanung.
const INTERAKTIV = new Set(['windowsterminal.exe', 'explorer.exe', 'code.exe', 'code - insiders.exe', 'cursor.exe', 'windsurf.exe', 'vscodium.exe']);

/**
 * Stammt der Prozess aus der Aufgabenplanung? Die Kommandozeile der svchost
 * ist ohne Adminrechte nicht lesbar -- deshalb: der erste svchost/taskhostw
 * nach oben, ohne vorher an einem interaktiven Fenster vorbeizukommen.
 */
export function vomPlaner(idx, pr) {
  for (const v of vorfahren(idx, pr)) {
    const n = String(v.n ?? '').toLowerCase();
    if (INTERAKTIV.has(n)) return false;
    if (PLANER.has(n)) return true;
  }
  return false;
}

/**
 * Alle Nachfahren einer Wurzel, Eltern vor Kindern. Geschuetzte Prozesse und
 * andere lebende Sessions werden samt ihrem ganzen Unterbaum uebersprungen.
 */
export function nachfahren(idx, wurzel, { geschuetzt = () => false, sessionPids = new Set() } = {}) {
  const out = [];
  const gesehen = new Set([wurzel.p]);
  const besuchen = (pr) => {
    for (const k of idx.kinder.get(pr.p) ?? []) {
      if (gesehen.has(k.p)) continue;
      gesehen.add(k.p);
      if (sessionPids.has(k.p) || geschuetzt(k)) continue;
      out.push({ p: k.p, s: k.s, n: k.n, c: k.c });
      besuchen(k);
    }
  };
  besuchen(wurzel);
  return out;
}

/**
 * Waisen ohne gemerkte Zugehoerigkeit: eine Shell des Bash-Werkzeugs von
 * Claude Code, deren Elternprozess (das claude.exe) nicht mehr lebt -- das ist
 * der Nachweis, dass die Session tot ist. Liefert je Waise die Shell und ihren
 * Unterbaum (Eltern vor Kindern).
 */
export function waisen(idx, { geschuetzt = () => false, sessionPids = new Set() } = {}) {
  const out = [];
  for (const pr of idx.nachPid.values()) {
    if (!String(pr.c ?? '').includes(CLAUDE_SHELL)) continue;
    if (idx.eltern.has(pr.p)) continue; // Elternteil lebt (und ist aelter) -- keine Waise.
    if (zahl(pr.s) === null || sessionPids.has(pr.p) || geschuetzt(pr)) continue;
    const baum = nachfahren(idx, pr, { geschuetzt, sessionPids });
    out.push([{ p: pr.p, s: pr.s, n: pr.n, c: pr.c }, ...baum]);
  }
  return out;
}

function taskkill(pid) {
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true, timeout: 10000 }, (err) => resolve(!err));
  });
}

export class Aufraeumer {
  /**
   * @param {object} o
   * @param {string} o.datei      Speicher der Prozessbaeume (JSON)
   * @param {string} o.logDatei   Protokoll jeder Beendigung
   * @param {string[]} [o.ausnahmen] Kommandozeilen-Muster, die nie beendet werden
   * @param {boolean} [o.waisenBeenden] Waisen ohne gemerkte Zugehoerigkeit beenden?
   */
  constructor({ datei, logDatei, ausnahmen = STANDARD_AUSNAHMEN, waisenBeenden = false, eigenePid = process.pid, beenden = taskkill, jetzt = () => new Date() }) {
    this.datei = datei;
    this.logDatei = logDatei;
    this.ausnahmen = ausnahmenMuster(ausnahmen);
    this.waisenBeenden = waisenBeenden;
    this.eigenePid = eigenePid;
    this.beenden = beenden;
    this.jetzt = jetzt;
    this.gemeldet = new Set();
    this.speicher = this.laden();
  }

  laden() {
    try {
      const j = JSON.parse(fs.readFileSync(this.datei, 'utf8'));
      return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
    } catch {
      return {};
    }
  }

  speichern() {
    const text = JSON.stringify(this.speicher);
    if (text === this.zuletzt) return;
    try {
      fs.mkdirSync(path.dirname(this.datei), { recursive: true });
      fs.writeFileSync(`${this.datei}.tmp`, text);
      fs.renameSync(`${this.datei}.tmp`, this.datei);
      this.zuletzt = text;
    } catch {
      // Beim naechsten Takt noch einmal.
    }
  }

  log(zeile) {
    try {
      fs.mkdirSync(path.dirname(this.logDatei), { recursive: true });
      fs.appendFileSync(this.logDatei, `${this.jetzt().toISOString()} ${zeile}\n`);
    } catch {
      /* Protokoll ist Beiwerk. */
    }
  }

  /**
   * Ein Durchgang.
   * @param {object[]} prozesse  Ausgabe von prozesse.ps1
   * @param {{lebend: object[], verfolgen: object[]}} sessions
   *   lebend: alle lebenden Sessions (deren Baeume sind tabu);
   *   verfolgen: die, deren Baum gemerkt wird (Scanner-Zeilen mit pid, sessionId).
   * @returns {Promise<object[]>} die beendeten Prozesse
   */
  async takt(prozesse, { lebend = [], verfolgen = [] } = {}) {
    if (!Array.isArray(prozesse) || prozesse.length === 0) return [];
    const idx = indexieren(prozesse);
    const eigene = eigeneProzesse(idx, this.eigenePid);
    const geschuetzt = (pr) => istGeschuetzt(pr, { ausnahmen: this.ausnahmen, eigene });
    const sessionPids = new Set(lebend.map((s) => s.pid).filter(Number.isInteger));
    const lebendIds = new Set(lebend.map((s) => s.sessionId));

    // 1. Lebende Sessions: Baum frisch merken. Ersetzen statt anhaeufen --
    // was sich bewusst abgekoppelt hat (Start-Process, conhost --headless),
    // faellt so beim naechsten Durchgang wieder heraus.
    for (const s of verfolgen) {
      const wurzel = idx.nachPid.get(s.pid);
      if (!wurzel) continue;
      if (s.procStart && !gleicheStartzeit(wurzel.s, s.procStart)) continue;
      if (vomPlaner(idx, wurzel)) {
        delete this.speicher[s.sessionId];
        continue;
      }
      this.speicher[s.sessionId] = {
        pid: wurzel.p,
        s: wurzel.s,
        name: s.name ?? null,
        cwd: s.cwd ?? null,
        nachfahren: nachfahren(idx, wurzel, { geschuetzt, sessionPids }),
      };
    }

    // 2. Beendete Sessions: gemerkte Nachfahren beenden, Kinder zuerst.
    const beendet = [];
    for (const [id, eintrag] of Object.entries(this.speicher)) {
      if (lebendIds.has(id)) continue;
      const wurzel = idx.nachPid.get(eintrag?.pid);
      // Prozess lebt noch, fehlt nur gerade in der Liste -- abwarten.
      if (wurzel && gleicheStartzeit(wurzel.s, eintrag.s)) continue;
      for (const k of [...(eintrag?.nachfahren ?? [])].reverse()) {
        const ziel = await this.pruefenUndBeenden(idx, k, { geschuetzt, sessionPids, grund: `session=${id} name=${eintrag.name ?? '?'}` });
        if (ziel) beendet.push(ziel);
      }
      delete this.speicher[id];
    }

    // 3. Waisen ohne gemerkte Zugehoerigkeit (Shell einer toten Session).
    for (const baum of waisen(idx, { geschuetzt, sessionPids })) {
      const schluessel = `${baum[0].p}|${baum[0].s}`;
      if (!this.waisenBeenden) {
        if (!this.gemeldet.has(schluessel)) {
          this.gemeldet.add(schluessel);
          this.log(`waise erkannt (nicht beendet) ${baum.map((k) => `pid=${k.p} ${k.n}`).join(', ')} | ${kurz(baum[baum.length - 1].c)}`);
        }
        continue;
      }
      for (const k of [...baum].reverse()) {
        const ziel = await this.pruefenUndBeenden(idx, k, { geschuetzt, sessionPids, grund: 'waise einer toten session' });
        if (ziel) beendet.push(ziel);
      }
    }

    this.speichern();
    return beendet;
  }

  async pruefenUndBeenden(idx, k, { geschuetzt, sessionPids, grund }) {
    const jetzt = idx.nachPid.get(k.p);
    // Weg, oder PID inzwischen neu vergeben.
    if (!jetzt || !gleicheStartzeit(jetzt.s, k.s)) return null;
    if (geschuetzt(jetzt) || sessionPids.has(jetzt.p)) return null;
    // Haengt (wieder) unter einer lebenden Session oder etwas Geschuetztem.
    if (vorfahren(idx, jetzt).some((v) => sessionPids.has(v.p) || geschuetzt(v))) return null;
    const ok = await this.beenden(jetzt.p);
    this.log(`${ok ? 'beendet' : 'beenden fehlgeschlagen'} pid=${jetzt.p} start=${jetzt.s} name=${jetzt.n} ${grund} | ${kurz(jetzt.c)}`);
    return ok ? { pid: jetzt.p, name: jetzt.n, cmd: jetzt.c, grund } : null;
  }
}

function kurz(c) {
  const t = String(c ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 400 ? `${t.slice(0, 400)}...` : t;
}
