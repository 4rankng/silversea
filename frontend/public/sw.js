// TransTing service worker — minimal push/click worker for PWA installability.
//
// Previous versions cached static assets and handled offline fetch fallbacks.
// Those strategies have been retired: the app now requires a live server
// connection for all business actions and loads assets directly from the
// network (Vite-hashed filenames are immutable at the CDN layer).

const CACHE = 'tingting-shell-v3';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop caches left over from previous SW versions (v2 cached assets).
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// ─── Web Push ───────────────────────────────────────────────────────────────
// Surface server-pushed notifications as OS notifications and forward them to
// any open app windows so the in-app drawer can refresh. Clicking focuses an
// open window (and asks it to navigate) or opens a new one.

function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, '').trim();
}

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); }
  catch { data = { body: event.data.text() }; }

  const title = data.title || 'TransTing';
  const url = data.url || '/';
  const body = stripHtml(data.body);
  const type = data.type || 'SYSTEM_ANNOUNCEMENT';
  const actionTitle = /PENALTY/.test(type)
    ? 'Xem phạt'
    : /PAYMENT/.test(type)
      ? 'Đối chiếu'
      : /TRIP/.test(type)
        ? 'Mở chuyến'
        : 'Mở';
  const options = {
    body,
    icon: data.icon || '/assets/transting-logo-192.png?v=4',
    badge: '/assets/transting-sidebar-mark-192.png?v=4',
    tag: data.tag || 'tingting-notification',
    timestamp: Date.now(),
    data: { url },
    actions: [{ action: 'open', title: actionTitle }],
    vibrate: /CANCELED|PENALTY|OVERDUE/.test(type) ? [120, 60, 120] : [80],
    requireInteraction: false,
    renotify: true,
  };

  const notifyClients = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clients) => {
      for (const client of clients) {
        client.postMessage({ type: 'PUSH_NOTIFICATION', payload: { title, body, url } });
      }
    });

  event.waitUntil(Promise.all([
    self.registration.showNotification(title, options),
    notifyClients,
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_CLICK', payload: { url: urlToOpen } });
          return client.focus();
        }
      }
      return self.clients.openWindow(urlToOpen);
    }),
  );
});
