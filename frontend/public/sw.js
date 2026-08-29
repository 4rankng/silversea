// TransTing service worker — powers Android installability + an offline app shell.
//
// Strategy (keeps live data live, ships fresh UI fast):
//   • HTML navigations        → network-first   (every deploy = newest shell; offline fallback)
//   • hashed static assets     → cache-first     (immutable: JS/CSS/fonts/images with content hashes)
//   • /api/* + cross-origin    → never cached     (trip/ledger/financial data always hits network)
//
// To force every client onto a new SW after a breaking change, bump `CACHE`
// (e.g. tingting-shell-v2); the activate step purges any older cache version.

const CACHE = 'tingting-shell-v2';

// Same-origin static asset extensions worth caching long-term.
const ASSET_RE = /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|gif|svg|avif|webp|ico)$/i;

self.addEventListener('install', () => {
  // Skip waiting so a newly deployed SW activates immediately (no stale-shell limbo).
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop caches left over from any previous SW version.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    // Take control of all open tabs right away.
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

// ─── Periodic Background Sync ──────────────────────────────────────────────
// Keeps the journey board fresh even when the driver hasn't opened the app.
// The browser fires this every ~15 min (Chrome); we poll the API and surface
// any new dispatch orders as OS notifications.

const JOURNEY_BOARD_URL = '/api/driver/me/journey-board';

self.addEventListener('periodicsync', (event) => {
  if (event.tag !== 'refresh-journey-board') return;
  event.waitUntil((async () => {
    try {
      const res = await fetch(JOURNEY_BOARD_URL, { credentials: 'include' });
      if (!res.ok) return;
      const cards = await res.json();
      const newOrders = Array.isArray(cards) ? cards.filter((c) => c.bucket === 'NEW') : [];
      if (newOrders.length === 0) return;
      // Only notify if there are new orders the driver hasn't seen.
      const lastCount = parseInt((await caches.match('/__journey-new-count'))?.body ?? '0', 10) || 0;
      const cache = await caches.open('tingting-shell-v2');
      cache.put('/__journey-new-count', new Response(String(newOrders.length)));
      if (newOrders.length > lastCount) {
        const latest = newOrders[0];
        await self.registration.showNotification('Lệnh vận chuyển mới', {
          body: `Bạn có ${newOrders.length} lệnh mới. ${latest.routeName || ''}`.trim(),
          icon: '/assets/transting-logo-192.png?v=4',
          tag: 'tingting-new-order',
          data: { url: '/my-trips' },
          vibrate: [120, 60, 120],
        });
      }
    } catch {
      /* best-effort — network may be unavailable */
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only intercept safe GETs; let POST/PUT/DELETE pass through untouched.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API responses and cross-origin requests are never cached — straight to network.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // 1) HTML navigations → network-first (always serve the newest app shell).
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE);
        cache.put(request, fresh.clone());
        return fresh;
      } catch {
        // Offline (or server down) → fall back to the cached shell or app entry.
        return (await caches.match(request)) || (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  // 2) Hashed static assets → cache-first (immutable, so never stale).
  if (ASSET_RE.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const fresh = await fetch(request);
        if (fresh.ok) cache.put(request, fresh.clone());
        return fresh;
      } catch {
        return cached || Response.error();
      }
    })());
    return;
  }

  // 3) Everything else (manifest.json, etc.) falls through to the browser default.
});
