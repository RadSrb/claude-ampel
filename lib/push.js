// Web-Push-Benachrichtigungen, wenn eine Session auf Rot springt oder fertig wird.
//
// Es wird nur beim ÜBERGANG benachrichtigt, nicht bei jedem Takt --
// sonst klingelt das Handy alle zwei Sekunden. Pro Session gilt zusaetzlich
// eine Sperrfrist, damit eine flackernde Session nicht zur Dauerbeschallung wird.

import fs from 'node:fs';
import webpush from 'web-push';

const COOLDOWN_MS = 5 * 60 * 1000;

// "Fertig" kommt einmal pro Turn -- die kurze Sperrfrist faengt nur ein
// Flackern ab, falls die Ableitung aus dem Transkript kurz hin und her springt.
const FERTIG_COOLDOWN_MS = 60 * 1000;

// Aus diesen Zustaenden heraus heisst Gruen "gerade fertig geworden".
// Gruen nach Grau (Serverstart, neue Session) ist kein abgeschlossener Turn.
const ARBEITET = new Set(['running', 'stalled']);

// Ab diesem Fuellstand des Fuenf-Stunden-Fensters wird gewarnt -- dieselbe
// Schwelle, ab der der Balken im Dashboard rot wird.
export const LIMIT_SCHWELLE = 90;

/** "1 h 5 min" bzw. "12 min" -- ohne Uhrzeit, also ohne Zeitzonenfrage. */
function restdauer(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Anzeigename wie im Dashboard: das Projekt, nicht der Unterordner. */
function name(session) {
  return session.projekt ?? session.folder ?? session.name ?? 'Claude';
}

/** Text der Meldung, wenn eine Session rot wird. */
export function rotText(session) {
  const grund =
    {
      attention: session.note ?? 'wartet auf deine Freigabe',
      question: session.lastText ?? 'hat dir eine Frage gestellt',
      limit: session.note ? `Nutzungslimit erreicht, ${session.note}` : 'Nutzungslimit erreicht',
    }[session.status] ?? 'steht seit Längerem still';

  return { title: `${name(session)} braucht dich`, body: grund, tag: session.sessionId };
}

/** Text der Meldung, wenn eine Session ihren Turn abgeschlossen hat. */
export function fertigText(session) {
  return {
    title: `${name(session)} ist fertig`,
    body: session.lastText ?? 'Wartet auf einen neuen Auftrag.',
    // Dasselbe Kennzeichen wie die Rot-Meldung: je Session steht immer nur
    // die neueste Nachricht auf dem Sperrbildschirm.
    tag: session.sessionId,
  };
}

/** Text der Limit-Meldung. Rein, damit er ohne Netz pruefbar bleibt. */
export function limitText(warnung, jetzt = Date.now()) {
  const rest = warnung.resetsAt ? Date.parse(warnung.resetsAt) - jetzt : NaN;
  const dauer = Number.isFinite(rest) && rest > 0 ? restdauer(rest) : null;
  const kern = `Fünf-Stunden-Fenster zu ${warnung.prozent} % ausgeschöpft`;

  return {
    title: `Nutzungslimit zu ${warnung.prozent} % voll`,
    body: dauer ? `${kern}, Zurücksetzung in ${dauer}.` : `${kern}.`,
    // Festes Kennzeichen: eine neue Limitmeldung ersetzt die alte,
    // statt sich daneben zu legen.
    tag: 'limit',
  };
}

export class PushDienst {
  // Apples Push-Dienst verweigert "localhost" als Absender mit 403 BadJwtToken --
  // dann kommt am iPhone keine einzige Meldung an. Die Adresse muss nur gueltig
  // aussehen, zugestellt wird an sie nichts.
  constructor({ speicherPfad, vapid, kontakt = 'mailto:claude-ampel@example.com' }) {
    this.speicherPfad = speicherPfad;
    this.abos = this.#laden();
    this.zuletztRot = new Map();
    this.zuletztStatus = new Map();
    this.zuletztFertig = new Map();
    this.gemeldetesFenster = null;
    this.aktiv = Boolean(vapid?.publicKey && vapid?.privateKey);
    if (this.aktiv) webpush.setVapidDetails(kontakt, vapid.publicKey, vapid.privateKey);
  }

  #laden() {
    try {
      const roh = JSON.parse(fs.readFileSync(this.speicherPfad, 'utf8'));
      return Array.isArray(roh) ? roh : [];
    } catch {
      return [];
    }
  }

  #sichern() {
    try {
      fs.writeFileSync(this.speicherPfad, JSON.stringify(this.abos, null, 2) + '\n');
    } catch {
      /* Ohne Speicher gehen die Abos beim Neustart verloren -- kein Grund abzustuerzen. */
    }
  }

  anzahl() {
    return this.abos.length;
  }

  anmelden(subscription) {
    if (!subscription?.endpoint) return false;
    if (this.abos.some((a) => a.endpoint === subscription.endpoint)) return true;
    this.abos.push(subscription);
    this.#sichern();
    return true;
  }

  abmelden(endpoint) {
    const vorher = this.abos.length;
    this.abos = this.abos.filter((a) => a.endpoint !== endpoint);
    if (this.abos.length !== vorher) this.#sichern();
    return vorher !== this.abos.length;
  }

  /**
   * Vergleicht die neue Lage mit der vorigen und meldet die Sessions,
   * die gerade eben rot geworden sind.
   */
  neuRot(sessions, now = Date.now()) {
    const treffer = [];
    const lebendig = new Set(sessions.map((s) => s.sessionId));
    for (const id of this.zuletztRot.keys()) if (!lebendig.has(id)) this.zuletztRot.delete(id);

    for (const s of sessions) {
      if (s.color !== 'red') {
        // Sobald eine Session wieder aus dem Rot raus ist, darf sie erneut melden.
        this.zuletztRot.delete(s.sessionId);
        continue;
      }
      const zuletzt = this.zuletztRot.get(s.sessionId);
      if (zuletzt && now - zuletzt < COOLDOWN_MS) continue;
      this.zuletztRot.set(s.sessionId, now);
      treffer.push(s);
    }
    return treffer;
  }

  /**
   * Meldet die Sessions, die seit dem letzten Takt von "laeuft" auf "fertig"
   * gesprungen sind. Eine Session, die schon gruen war, als der Server sie
   * zum ersten Mal sah, meldet nichts.
   */
  neuFertig(sessions, now = Date.now()) {
    const treffer = [];
    const lebendig = new Set(sessions.map((s) => s.sessionId));
    for (const id of this.zuletztStatus.keys()) if (!lebendig.has(id)) this.zuletztStatus.delete(id);
    for (const id of this.zuletztFertig.keys()) if (!lebendig.has(id)) this.zuletztFertig.delete(id);

    for (const s of sessions) {
      const vorher = this.zuletztStatus.get(s.sessionId);
      this.zuletztStatus.set(s.sessionId, s.status);
      if (s.status !== 'done' || !ARBEITET.has(vorher)) continue;

      const zuletzt = this.zuletztFertig.get(s.sessionId);
      if (zuletzt && now - zuletzt < FERTIG_COOLDOWN_MS) continue;
      this.zuletztFertig.set(s.sessionId, now);
      treffer.push(s);
    }
    return treffer;
  }

  /**
   * Meldet einmal je Fuenf-Stunden-Fenster, sobald es die Schwelle reisst.
   *
   * Anders als bei den Sessions hilft hier keine Sperrfrist: einmal ueber der
   * Schwelle bleibt das Fenster dort, bis es zurueckgesetzt wird. Gemerkt wird
   * deshalb der Reset-Zeitpunkt -- das naechste Fenster darf wieder melden.
   */
  neuKnapp(limit) {
    const sitzung = limit?.sitzung;
    if (typeof sitzung?.prozent !== 'number') return null;
    if (sitzung.prozent < LIMIT_SCHWELLE) return null;

    const fenster = sitzung.resetsAt ?? 'unbekannt';
    if (this.gemeldetesFenster === fenster) return null;
    this.gemeldetesFenster = fenster;
    return { prozent: sitzung.prozent, resetsAt: sitzung.resetsAt ?? null };
  }

  async melden(session) {
    await this.#senden(rotText(session));
  }

  async meldenFertig(session) {
    await this.#senden(fertigText(session));
  }

  async meldenKnapp(warnung) {
    await this.#senden(limitText(warnung));
  }

  async #senden(inhalt) {
    if (!this.aktiv || !this.abos.length) return;

    const payload = JSON.stringify(inhalt);
    const tot = [];
    await Promise.all(
      this.abos.map(async (abo) => {
        try {
          await webpush.sendNotification(abo, payload);
        } catch (err) {
          // 404/410 = Abo vom Push-Dienst verworfen (App deinstalliert o. ae.).
          if (err?.statusCode === 404 || err?.statusCode === 410) tot.push(abo.endpoint);
        }
      }),
    );

    if (tot.length) {
      this.abos = this.abos.filter((a) => !tot.includes(a.endpoint));
      this.#sichern();
    }
  }
}
