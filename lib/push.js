// Web-Push-Benachrichtigungen, wenn eine Session auf Rot springt.
//
// Es wird nur beim ÜBERGANG nach Rot benachrichtigt, nicht bei jedem Takt --
// sonst klingelt das Handy alle zwei Sekunden. Pro Session gilt zusaetzlich
// eine Sperrfrist, damit eine flackernde Session nicht zur Dauerbeschallung wird.

import fs from 'node:fs';
import webpush from 'web-push';

const COOLDOWN_MS = 5 * 60 * 1000;

// Ab diesem Fuellstand des Fuenf-Stunden-Fensters wird gewarnt -- dieselbe
// Schwelle, ab der der Balken im Dashboard rot wird.
export const LIMIT_SCHWELLE = 90;

/** "1 h 5 min" bzw. "12 min" -- ohne Uhrzeit, also ohne Zeitzonenfrage. */
function restdauer(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
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
  constructor({ speicherPfad, vapid, kontakt = 'mailto:ampel@localhost' }) {
    this.speicherPfad = speicherPfad;
    this.abos = this.#laden();
    this.zuletztRot = new Map();
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
    const grund =
      session.status === 'attention'
        ? (session.note ?? 'wartet auf deine Antwort')
        : 'steht seit Längerem still';

    await this.#senden({
      title: `${session.folder ?? session.name ?? 'Claude'} braucht dich`,
      body: grund,
      tag: session.sessionId,
    });
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
