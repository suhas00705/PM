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
