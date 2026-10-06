// Entscheidet im Stop-Hook, ob Claude von selbst weitermacht -- statt darauf
// zu warten, dass jemand "fahre fort" tippt.
//
// Gemessen ueber 21 Tage: 118 von Hand getippte Fortsetzungen, nur 5 davon
// nach einer echten Rueckfrage. Der Rest folgte auf einen Turn, der Arbeit
// angekuendigt oder auf Hintergrund-Agenten gewartet hatte.

import { istFrage, limitStand } from './scanner.js';

// Nur Sitzungen, in denen ein Mensch mitliest. `claude -p` (sdk-cli) liefert
// seine letzte Nachricht an ein Skript -- ein Zusatzzug wuerde sie ersetzen.
const INTERAKTIV = new Set(['claude-vscode', 'cli']);

export const GRUND =
  'Automatisch fortfahren (statt „fahre fort“): Ist im aktuellen Auftrag noch Arbeit offen, ' +
  'die keine Entscheidung des Nutzers braucht, erledige sie jetzt -- auch parallel, waehrend ' +
  'Hintergrund-Agenten laufen. Ist alles erledigt oder bleibt nur das Warten auf ' +
  'Hintergrund-Agenten (die melden sich von selbst), antworte nur mit einem kurzen Satz und beende den Zug.';

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/** Ein Auftrag des Menschen -- keine Werkzeug-Rueckgabe, keine Hintergrund-Meldung. */
function istAuftrag(e) {
  if (e?.type !== 'user' || e.isMeta) return false;
  const c = e.message?.content;
  if (Array.isArray(c) && c.some((b) => b?.type === 'tool_result')) return false;
  const t = textOf(c).trimStart();
  if (!t) return false;
  return !t.startsWith('<') || t.startsWith('<command-');
}

/**
 * @param {object[]} eintraege Transkriptzeilen, aelteste zuerst
 * @param {{stop_hook_active?: boolean, last_assistant_message?: string}} payload Eingabe des Stop-Hooks
 * @param {{aus?: boolean}} [opts]
 * @returns {{decision: 'block', reason: string}|null} null = Claude darf aufhoeren
 */
export function entscheide(eintraege, payload, opts = {}) {
  if (opts.aus || payload?.stop_hook_active) return null;

  const gespraech = eintraege.filter((e) => e?.type === 'user' || e?.type === 'assistant');
  if (!gespraech.length) return null;

  const einstieg = [...eintraege].reverse().find((e) => typeof e?.entrypoint === 'string')?.entrypoint;
  if (!INTERAKTIV.has(einstieg)) return null;

  let letzterText = null;
  for (let i = gespraech.length - 1; i >= 0 && letzterText === null; i--) {
    if (gespraech[i].type === 'assistant') letzterText = textOf(gespraech[i].message?.content).trim() || null;
  }
  if (typeof payload?.last_assistant_message === 'string' && payload.last_assistant_message.trim()) {
    letzterText = payload.last_assistant_message.trim();
  }

  if (limitStand(letzterText)) return null;
  if (istFrage(gespraech, letzterText)) return null;

  // Nur wer im aktuellen Auftrag gearbeitet hat, wird weitergeschickt.
  // Eine reine Antwort auf eine Frage ist fertig, wenn sie dasteht.
  let start = gespraech.length - 1;
  while (start >= 0 && !istAuftrag(gespraech[start])) start--;
  const auftrag = gespraech.slice(start + 1);
  const gearbeitet = auftrag.some(
    (e) => e.type === 'assistant' && Array.isArray(e.message?.content) && e.message.content.some((b) => b?.type === 'tool_use'),
  );
  if (!gearbeitet) return null;

  return { decision: 'block', reason: GRUND };
}
