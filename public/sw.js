// Elmeasure PM Portal – service worker (22-Oct-2026).
// Needed so Android can install the portal as an app. It caches NOTHING: every page and every
// data call always goes to the network, so the app always shows the same live data as the website.
// Only when the phone is offline does it show a short "You are offline" page instead of an error.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;               // data, scripts, images: untouched
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="font-family:sans-serif;background:#f3f6f8;color:#103a52;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">' +
    '<div><h2 style="margin:0 0 8px">You are offline</h2><p style="margin:0;color:#5b7083">Connect to the internet and pull down to reload.</p></div>',
    { headers: { 'content-type': 'text/html; charset=utf-8' } })));
});

// 30-Oct-2026: target alerts (phone notifications) – sent by lib/pushAlerts.js.
// Tapping one opens the app on the right tab (Region Tracking, or PM Cumulative with the current month).
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Elmeasure Insights', {
    body: d.body || '', icon: '/icon-192.png', badge: '/badge-96.png', tag: d.tag || undefined, renotify: !!d.tag,
    timestamp: Date.now(), data: { url: d.url || '/?app=1' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/?app=1', self.location.origin).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.startsWith(self.location.origin)) {
        try { const n = await c.navigate(url); if (n) return n.focus(); } catch (x) { /* fall through */ }
        try { return await c.focus(); } catch (x) {}
      }
    }
    return self.clients.openWindow(url);
  })());
});
