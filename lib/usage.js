// Nutzungslimit von Claude Code.
//
// Fragt denselben Endpunkt ab, den auch /usage im CLI benutzt:
//   GET https://api.anthropic.com/api/oauth/usage
// mit dem OAuth-Token aus ~/.claude/.credentials.json.
//
// Der Token wird bei jedem Aufruf frisch gelesen (Claude Code erneuert ihn
// regelmaessig), geht ausschliesslich an api.anthropic.com und taucht weder
// im Protokoll noch in der Antwort dieses Servers auf.
//
// Der Endpunkt ist nicht dokumentiert und kann sich mit einer neuen
// Claude-Code-Version aendern. Faellt er aus, bleibt die Anzeige leer --
// die Ampel selbst haengt nicht daran.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { cached } from './shell.js';

const ENDPUNKT = 'https://api.anthropic.com/api/oauth/usage';

function credentialsPfad() {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

function tokenLesen() {
  try {
    const c = JSON.parse(fs.readFileSync(credentialsPfad(), 'utf8'));
    const o = c?.claudeAiOauth;
    if (!o?.accessToken) return null;
    // Abgelaufene Token nicht verwenden -- erneuern ist Sache von Claude Code.
    if (o.expiresAt && Date.now() > o.expiresAt) return null;
    return o.accessToken;
  } catch {
    return null;
  }
}

/**
 * Formt die Antwort in das um, was auf eine schmale Kachel passt.
 * Reine Funktion, damit sie ohne Netz pruefbar ist.
 */
export function summarize(daten) {
  if (!daten || typeof daten !== 'object') return null;

  const fenster = (roh) =>
    roh && typeof roh.utilization === 'number'
      ? { prozent: Math.round(roh.utilization), resetsAt: roh.resets_at ?? null, gesperrt: roh.locked_reason ?? null }
      : null;

  const sitzung = fenster(daten.five_hour);
  const woche = fenster(daten.seven_day);

  // Modellbezogene Wochenlimits (Opus, Sonnet, ...) stehen in "limits".
  const proModell = Array.isArray(daten.limits)
    ? daten.limits
        .filter((l) => l?.kind === 'weekly_scoped' && l?.scope?.model?.display_name && typeof l.percent === 'number')
        .map((l) => ({ name: l.scope.model.display_name, prozent: Math.round(l.percent) }))
        .sort((a, b) => b.prozent - a.prozent)
    : [];

  if (!sitzung && !woche && !proModell.length) return null;

  // Die Farbe richtet sich nach dem am weitesten gefuellten Topf.
  const hoechster = Math.max(sitzung?.prozent ?? 0, woche?.prozent ?? 0, ...proModell.map((m) => m.prozent));
  const stufe = hoechster >= 90 ? 'kritisch' : hoechster >= 75 ? 'warnung' : 'normal';

  return { sitzung, woche, proModell, hoechster, stufe, standVon: Date.now() };
}

async function abrufen() {
  const token = tokenLesen();
  if (!token) return null;

  try {
    const antwort = await fetch(ENDPUNKT, {
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!antwort.ok) return null;
    return summarize(await antwort.json());
  } catch {
    // Kein Netz, Endpunkt geaendert, Token abgelehnt -- alles kein Grund,
    // die Ampel zu stoeren.
    return null;
  }
}

// Eine Minute reicht: Prozentwerte springen nicht sekuendlich.
export const nutzung = cached(abrufen, 60_000);
