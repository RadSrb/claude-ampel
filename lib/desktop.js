// Claude-Desktop-Sitzungen direkt in Claude Desktop oeffnen.
//
// Der Link claude://code/continue?session=local_<id> ist nicht dokumentiert,
// sondern im App-Bundle gefunden. Die App verlangt fuer die ID
// ^local_[A-Za-z0-9-]{1,64}$. Die Desktop-ID steht als hostSessionId in der
// Session-Registry; sie ist NICHT immer "local_" + CLI-ID, also nie zusammensetzen.

import { execFile } from 'node:child_process';

const ID_FORM = /^local_[A-Za-z0-9-]{1,64}$/;

/** @returns {string|null} die Desktop-ID, wenn sie die Form der App erfuellt */
export function gueltigeDesktopId(id) {
  return typeof id === 'string' && ID_FORM.test(id) ? id : null;
}

export function desktopLink(id) {
  return `claude://code/continue?session=${id}&source=desktop_action`;
}

/** Standard-Oeffner: ohne Shell, ohne sichtbares Fenster. Loest bei Fehler auf false. */
export function oeffneLink(url) {
  return new Promise((resolve) => {
    execFile('rundll32', ['url.dll,FileProtocolHandler', url], { windowsHide: true, timeout: 8000 }, (err) =>
      resolve(!err),
    );
  });
}

/**
 * Oeffnet eine Desktop-Sitzung. Gibt Status und JSON-Antwort fuer /api/focus zurueck.
 * @param {{desktopId?: string|null}} row
 * @param {(url: string) => Promise<boolean>} [oeffne] injizierbar fuer Tests
 */
export async function fokusDesktop(row, oeffne = oeffneLink) {
  const id = gueltigeDesktopId(row?.desktopId);
  if (!id) {
    return {
      status: 409,
      body: { ok: false, error: 'Desktop-Sitzung nicht gefunden (keine gueltige Desktop-ID in der Registry)' },
    };
  }
  let ok = false;
  try {
    ok = (await oeffne(desktopLink(id))) === true;
  } catch {
    ok = false;
  }
  return ok
    ? { status: 200, body: { ok: true, weg: 'desktop' } }
    : { status: 500, body: { ok: false, error: 'Claude Desktop konnte nicht geoeffnet werden' } };
}
