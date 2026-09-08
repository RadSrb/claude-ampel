// Service Worker der Claude-Ampel.
//
// Enthaelt bewusst keine Daten und kein Token -- er wird ohne Token
// ausgeliefert, damit er fuer die ganze Seite zustaendig sein darf.
// Seine einzige Aufgabe: eingehende Push-Nachrichten anzeigen und beim
// Antippen das Dashboard nach vorn holen.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (ev) => ev.waitUntil(self.clients.claim()));

self.addEventListener('push', (ev) => {
  let daten = { title: 'Claude-Ampel', body: 'Eine Session braucht dich.' };
  try {
    if (ev.data) daten = { ...daten, ...ev.data.json() };
  } catch {
    /* Nutzlast unlesbar -- dann eben der Standardtext. */
  }

  ev.waitUntil(
    self.registration.showNotification(daten.title, {
      body: daten.body,
      // Gleiches tag = die Meldung derselben Session ersetzt sich selbst,
      // statt den Sperrbildschirm zuzumuellen.
      tag: daten.tag || 'ampel',
      renotify: true,
      requireInteraction: true,
      badge: '/icon.png',
      icon: '/icon.png',
    }),
  );
});

self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  ev.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((liste) => {
      for (const client of liste) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/');
    }),
  );
});
