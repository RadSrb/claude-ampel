// Ermittelt das Kontextfenster einer Session -- so nah an Claude Code wie möglich.
//
// Claude Code rechnet das intern so (aus der Binärdatei nachgelesen):
//   Standardfenster                       200_000
//   Modelle mit grossem Fenster         1_000_000
//   Umgehung per CLAUDE_CODE_MAX_CONTEXT_TOKENS
//
// Der Haken: welche Variante eine Session benutzt, steht NICHT im Transkript.
// Der Modellname dort ist immer "claude-opus-5" -- ohne den [1m]-Zusatz, der
// das grosse Fenster markiert. Die einzige Konfigurationsquelle ist
// ~/.claude/settings.json ("model": "opus[1m]").
//
// Deshalb drei Stufen, von der stärksten Evidenz abwärts.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const STANDARD_FENSTER = 200_000;
export const GROSSES_FENSTER = 1_000_000;

/** Liest die Modellwahl aus ~/.claude/settings.json, z. B. "opus[1m]". */
export function settingsModell(claudeDir = path.join(os.homedir(), '.claude')) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'));
    return typeof s.model === 'string' ? s.model : null;
  } catch {
    return null;
  }
}

/**
 * Gehört der Modellname aus dem Transkript zu der in den Einstellungen
 * gewählten Familie? "opus[1m]" passt auf "claude-opus-5", nicht auf
 * "claude-sonnet-5" -- eine Session, die auf Sonnet umgestellt wurde, bekommt
 * also nicht fälschlich das grosse Fenster.
 */
export function passtZurFamilie(modell, settingsWert) {
  if (!modell || !settingsWert) return false;
  const familie = settingsWert.replace(/\[.*\]$/, '').toLowerCase();
  if (!familie) return false;
  return modell.toLowerCase().includes(familie);
}

/**
 * @param {string|null} modell         Modellname aus dem Transkript
 * @param {number} beobachtet          bisher grösster gesehener Kontextverbrauch
 * @param {object} quellen             { settingsWert, envMax }
 */
export function fensterFuer(modell, beobachtet = 0, quellen = {}) {
  const { settingsWert = null, envMax = null } = quellen;

  // 1. Ausdrückliche Umgehung gewinnt -- dieselbe Variable, die Claude Code kennt.
  if (Number.isFinite(envMax) && envMax > 0) {
    return { fenster: envMax, quelle: 'env' };
  }

  // 2. Gemessen schlägt geraten: was schon im Kontext lag, passt auch hinein.
  if (beobachtet > STANDARD_FENSTER) {
    return { fenster: GROSSES_FENSTER, quelle: 'gemessen' };
  }

  // 3. Die Konfiguration -- der [1m]-Zusatz markiert das grosse Fenster.
  if (settingsWert?.includes('[1m]') && passtZurFamilie(modell, settingsWert)) {
    return { fenster: GROSSES_FENSTER, quelle: 'einstellung' };
  }

  return { fenster: STANDARD_FENSTER, quelle: 'standard' };
}

export function envMaxTokens() {
  const roh = Number(process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS);
  return Number.isFinite(roh) && roh > 0 ? roh : null;
}
