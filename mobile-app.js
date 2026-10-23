/* Elmeasure PM Hub – Android app mode (the PM Portal as an app) (22-Oct-2026)
 * Loaded by the portal shell (index.html). Registers the service worker (makes the portal installable)
 * and, only when the portal runs as the installed app (or with ?app=1 for testing; ?app=0 turns it off),
 * applies a clean mobile look to the shell and to every dashboard tab inside it.
 * Pinch-zoom and screen rotation stay fully available. The website on a laptop is unchanged.
 */
(function () {
  'use strict';
  if (window.self !== window.top) return;                       // dashboards are styled by the shell
  try {
    if (/[?&]app=1\b/.test(location.search)) localStorage.setItem('pmApp', '1');
    if (/[?&]app=0\b/.test(location.search)) localStorage.removeItem('pmApp');
  } catch (e) {}
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
  var stored = false;
  try { stored = localStorage.getItem('pmApp') === '1'; } catch (e) {}
  var standalone = window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches);
  if (!standalone && !stored) return;

  var V = '1';
  document.documentElement.classList.add('pm-app');
  var css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = '/mobile-app.css?v=' + V;
  document.head.appendChild(css);

  // every dashboard tab is an iframe from the same site: give each one the app stylesheet
  function styleFrame(f) {
    try {
      var d = f.contentDocument;
      if (!d || !d.head || d.getElementById('pm-app-css')) return;
      var l = d.createElement('link');
      l.id = 'pm-app-css'; l.rel = 'stylesheet'; l.href = '/mobile-app-frame.css?v=' + V;
      d.head.appendChild(l);
      d.documentElement.classList.add('app-mode');
    } catch (e) { /* not same-site: leave it */ }
  }
  function hook() {
    var fs = document.querySelectorAll('iframe');
    for (var i = 0; i < fs.length; i++) {
      var f = fs[i];
      if (!f.__pmApp) { f.__pmApp = true; f.addEventListener('load', (function (x) { return function () { styleFrame(x); }; })(f)); }
      styleFrame(f);
    }
  }
  function start() {
    var t = document.querySelector('.brand-title'); if (t) t.textContent = 'PM Hub';
    document.title = 'Elmeasure PM Hub';
    hook();
    setInterval(hook, 1500);                                    // tabs load lazily; catch new / reloaded frames
    // close the menu after a tab is picked
    // (window + capture: the portal's own tab handler stops the click from travelling further)
    window.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.tab-btn');
      if (b) { var s = document.getElementById('tabs'); if (s) setTimeout(function () { s.classList.remove('open'); }, 60); }
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
