// Claude-Ampel Overlay -- schmale Spalte, die ueber allen Fenstern bleibt.
//
// Rahmenlos und transparent, ohne Eintrag in der Taskleiste, ohne Fokus zu
// stehlen. Der Inhalt kommt vom laufenden Ampel-Server (/mini); dieses Modul
// kuemmert sich nur um das Fenster.

const { app, BrowserWindow, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const WURZEL = path.join(__dirname, '..');
const STAND_PFAD = path.join(__dirname, 'position.json');

const BREITE = 240;
const HOEHE = 420;
const RAND = 14;

function config() {
  try {
    return JSON.parse(fs.readFileSync(path.join(WURZEL, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function standLaden() {
  try {
    const s = JSON.parse(fs.readFileSync(STAND_PFAD, 'utf8'));
    if (Number.isInteger(s.x) && Number.isInteger(s.y)) return s;
  } catch {
    /* noch nie verschoben */
  }
  return null;
}

function standSichern(fenster) {
  try {
    const [x, y] = fenster.getPosition();
    const [width, height] = fenster.getSize();
    fs.writeFileSync(STAND_PFAD, JSON.stringify({ x, y, width, height }, null, 2) + '\n');
  } catch {
    /* Position geht dann beim naechsten Start verloren -- kein Drama. */
  }
}

/**
 * Prueft, ob die gemerkte Position noch auf einem angeschlossenen Bildschirm
 * liegt. Sonst landet das Overlay nach dem Abstecken eines Monitors im Nichts.
 */
function sichtbarePosition(stand) {
  if (!stand) return null;
  const schirme = screen.getAllDisplays();
  const passt = schirme.some((d) => {
    const b = d.workArea;
    return stand.x < b.x + b.width - 40 && stand.x + 40 > b.x && stand.y < b.y + b.height - 20 && stand.y + 20 > b.y;
  });
  return passt ? stand : null;
}

function standardPosition() {
  // Rechter Rand, vertikal mittig -- dort liegt bei den wenigsten Programmen etwas Wichtiges.
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - BREITE - RAND,
    y: workArea.y + Math.round((workArea.height - HOEHE) / 2),
    width: BREITE,
    height: HOEHE,
  };
}

function fensterBauen() {
  const cfg = config();
  const port = cfg.port ?? 4317;
  if (!cfg.token) {
    console.error('Kein Token in config.json. Erst den Server (start.cmd) einmal starten.');
    app.quit();
    return;
  }

  const stand = sichtbarePosition(standLaden()) ?? standardPosition();

  const fenster = new BrowserWindow({
    ...stand,
    width: stand.width ?? BREITE,
    height: stand.height ?? HOEHE,
    minWidth: 170,
    minHeight: 120,
    frame: false,
    transparent: true,
    resizable: true,
    // Kein Eintrag in der Taskleiste und kein Fokusklau beim Start --
    // das Overlay soll danebenstehen, nicht die Arbeit unterbrechen.
    skipTaskbar: true,
    focusable: true,
    show: false,
    alwaysOnTop: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 'floating' haelt das Fenster ueber normalen Programmen. Hoehere Stufen
  // legen sich auch ueber Vollbild-Videos, flackern dort aber gern -- deshalb
  // bewusst die zahme Variante.
  fenster.setAlwaysOnTop(true, 'floating');
  fenster.setMenu(null);

  fenster.once('ready-to-show', () => fenster.showInactive());

  let merker = null;
  const merken = () => {
    clearTimeout(merker);
    merker = setTimeout(() => standSichern(fenster), 400);
  };
  fenster.on('move', merken);
  fenster.on('resize', merken);

  // Links aus der Seite (localhost-Ports) gehoeren in den echten Browser,
  // nicht in dieses 240 Pixel breite Fenster.
  fenster.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  fenster.loadURL(`http://127.0.0.1:${port}/mini?t=${encodeURIComponent(cfg.token)}`);

  fenster.webContents.on('did-fail-load', (_ev, code, beschreibung) => {
    console.error(`Seite konnte nicht geladen werden (${code}): ${beschreibung}`);
    console.error('Laeuft der Ampel-Server? start.cmd ausfuehren.');
  });

  if (process.env.AMPEL_DEBUG) {
    fenster.webContents.on('did-finish-load', async () => {
      console.log('geladen:', fenster.webContents.getURL());
      const r = await fenster.webContents
        .executeJavaScript(
          'JSON.stringify({titel: document.title, koerper: document.body.innerHTML.length,' +
            ' anfang: document.body.innerHTML.slice(0,120)})',
        )
        .catch((e) => 'Abfrage fehlgeschlagen: ' + e.message);
      console.log('Inhalt:', r);
    });
  }
}

app.whenReady().then(fensterBauen);
app.on('window-all-closed', () => app.quit());
