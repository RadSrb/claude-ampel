// Einstellungen, die sich zur Laufzeit aendern lassen.
//
// Token und VAPID-Schluessel stehen zwar in derselben config.json, sind hier
// aber bewusst nicht aufgefuehrt: sie werden nie ausgeliefert und nie
// ueberschrieben.

import fs from 'node:fs';

/** Was der Einstellungsbereich anfassen darf, mit Grenzen und Beschreibung. */
export const FELDER = {
  stallSeconds: {
    label: 'Steht-Schwelle',
    einheit: 'Sekunden',
    hinweis: 'Ab wann eine laufende Session ohne Lebenszeichen auf Rot kippt.',
    min: 30,
    max: 7200,
    standard: 300,
  },
  orphanAfterMinutes: {
    label: 'Schonfrist für vergessene Sessions',
    einheit: 'Minuten',
    hinweis: 'Wie lange eine Session ohne Transkript sichtbar bleibt, bevor sie ausgeblendet wird.',
    min: 1,
    max: 1440,
    standard: 10,
  },
  scanIntervalMs: {
    label: 'Takt',
    einheit: 'Millisekunden',
    hinweis: 'Wie oft nach Änderungen gesucht wird. Wirkt erst nach einem Neustart des Servers.',
    min: 500,
    max: 30000,
    standard: 2000,
    neustart: true,
  },
  port: {
    label: 'Port',
    einheit: '',
    hinweis: 'Adresse des Servers. Wirkt erst nach einem Neustart.',
    min: 1025,
    max: 65535,
    standard: 4317,
    neustart: true,
  },
};

/** Nur die anzeigbaren Werte -- niemals Token oder Schluessel. */
export function oeffentlich(config) {
  const raus = {};
  for (const [name, feld] of Object.entries(FELDER)) {
    raus[name] = config[name] ?? feld.standard;
  }
  return raus;
}

/**
 * Prueft eingehende Werte und gibt die uebernommenen zurueck.
 * Unbekannte Felder werden verworfen, nicht durchgereicht -- sonst koennte
 * ueber diesen Weg das Token ueberschrieben werden.
 */
export function pruefen(eingabe) {
  const uebernommen = {};
  const fehler = [];

  for (const [name, wert] of Object.entries(eingabe ?? {})) {
    const feld = FELDER[name];
    if (!feld) continue;

    const zahl = Number(wert);
    if (!Number.isFinite(zahl)) {
      fehler.push(`${feld.label}: keine Zahl`);
      continue;
    }
    const ganz = Math.round(zahl);
    if (ganz < feld.min || ganz > feld.max) {
      fehler.push(`${feld.label}: muss zwischen ${feld.min} und ${feld.max} liegen`);
      continue;
    }
    uebernommen[name] = ganz;
  }

  return { uebernommen, fehler };
}

/**
 * Schreibt die Werte in config.json, ohne alles andere anzutasten --
 * insbesondere bleiben Token und VAPID-Schluessel unveraendert.
 */
export function sichern(pfad, werte) {
  let vorhanden = {};
  try {
    vorhanden = JSON.parse(fs.readFileSync(pfad, 'utf8'));
  } catch {
    /* wird neu angelegt */
  }
  const neu = { ...vorhanden, ...werte };
  fs.writeFileSync(pfad, JSON.stringify(neu, null, 2) + '\n');
  return neu;
}

/** Welche der geaenderten Felder erst nach einem Neustart wirken? */
export function brauchtNeustart(werte, vorher) {
  return Object.keys(werte).filter((name) => FELDER[name]?.neustart && werte[name] !== vorher[name]);
}
