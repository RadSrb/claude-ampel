// Preload des Overlays. Die Seite /mini laeuft auch im Browser und am Handy;
// nur hier gibt es window.ampelOverlay -- daran erkennt sie das Overlay und
// spielt nur hier den Ton.

const { contextBridge } = require('electron');
const { tonFaellig } = require('../lib/ton.cjs');

contextBridge.exposeInMainWorld('ampelOverlay', { tonFaellig });
