// Web-Push-Benachrichtigungen, wenn eine Session auf Rot springt.
//
// Es wird nur beim ÜBERGANG nach Rot benachrichtigt, nicht bei jedem Takt --
// sonst klingelt das Handy alle zwei Sekunden. Pro Session gilt zusaetzlich
// eine Sperrfrist, damit eine flackernde Session nicht zur Dauerbeschallung wird.

import fs from 'node:fs';
import webpush from 'web-push';

const COOLDOWN_MS = 5 * 60 * 1000;

export class PushDienst {
  constructor({ speicherPfad, vapid, kontakt = 'mailto:ampel@localhost' }) {
    this.speicherPfad = speicherPfad;
    this.abos = this.#laden();
    this.zuletztRot = new Map();
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

  async melden(session) {
    if (!this.aktiv || !this.abos.length) return;

    const grund =
      session.status === 'attention'
        ? (session.note ?? 'wartet auf deine Antwort')
        : 'steht seit Längerem still';

    const payload = JSON.stringify({
      title: `${session.folder ?? session.name ?? 'Claude'} braucht dich`,
      body: grund,
      tag: session.sessionId,
    });

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
