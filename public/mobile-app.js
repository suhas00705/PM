/* ===== start screen "Insight Bars" (v1.7, 25-Oct-2026): warm isometric 3D bars + trend line, logo in a five-colour ring ===== */

/* Elmeasure Insights – warm industry start screens. SVG + CSS only (light on phones). */
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  // isometric helpers (x right-down, y left-down, z up)
  function P(o, x, y, z) { var c = 0.866 * o.s, s = 0.5 * o.s; return [o.cx + (x - y) * c, o.cy + (x + y) * s - z * o.s]; }
  function poly(pts) { return pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '); }
  function box(g, o, x, y, w, d, h, cols) {   // cols: [top, left, right]
    var a = P(o, x, y, h), b = P(o, x + w, y, h), c = P(o, x + w, y + d, h), e = P(o, x, y + d, h);
    var a0 = P(o, x, y + d, 0), b0 = P(o, x + w, y + d, 0), c0 = P(o, x + w, y, 0);
    el('polygon', { points: poly([e, c, b0, a0]), fill: cols[1] }, g);
    el('polygon', { points: poly([c, b, c0, b0]), fill: cols[2] }, g);
    el('polygon', { points: poly([a, b, c, e]), fill: cols[0] }, g);
  }
  window.EIW = { el: el, P: P, poly: poly, box: box };
})();

/* ---------- D · 3D insight bars ---------- */
function sceneD(svg) {
  var W = window.EIW, o = { cx: 175, cy: 280, s: 16 };
  var pl = W.el('g', { class: 'rise', style: 'animation-delay:.05s' }, svg);
  W.el('polygon', { points: W.poly([W.P(o, -6, -2.2, 0), W.P(o, 6, -2.2, 0), W.P(o, 6, 2.2, 0), W.P(o, -6, 2.2, 0)]), fill: '#ffe8d4' }, pl);
  for (var gx = -6; gx <= 6; gx += 2) W.el('line', { x1: W.P(o, gx, -2.2, 0)[0], y1: W.P(o, gx, -2.2, 0)[1], x2: W.P(o, gx, 2.2, 0)[0], y2: W.P(o, gx, 2.2, 0)[1], stroke: '#f6d2b5', 'stroke-width': 1 }, pl);
  var H = [3, 4.6, 3.8, 6.2, 8], C = [['#ffd7b0', '#ffb27a', '#f29a5f'], ['#ffc2b3', '#f79a85', '#e77f69'], ['#bfe6df', '#8fd3c7', '#6cc5b8'], ['#ffe0a3', '#f5b841', '#e09e2a'], ['#ffb7c2', '#f27a8a', '#dc6274']], tips = [];
  H.forEach(function (h, i) {
    var x = -5.4 + i * 2.3, g = W.el('g', { class: 'grow', style: 'animation-delay:' + (.35 + i * .16) + 's;transform-origin:' + W.P(o, x + .7, 0, 0).join('px ') + 'px' }, svg);
    W.box(g, o, x, -.7, 1.4, 1.4, h, C[i]); tips.push(W.P(o, x + .7, 0, h + .8));
  });
  var d = 'M' + tips.map(function (p) { return p.join(','); }).join(' L');
  W.el('path', { d: d, stroke: '#3d2c4a', 'stroke-width': 2.4, fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', class: 'draw', style: 'animation-delay:1.3s' }, svg);
  tips.forEach(function (p, i) { W.el('circle', { cx: p[0], cy: p[1], r: 4.5, fill: '#fff', stroke: '#3d2c4a', 'stroke-width': 2, class: 'pop', style: 'animation-delay:' + (1.4 + i * .12) + 's' }, svg); });
  var arrow = tips[4]; W.el('path', { d: 'M' + (arrow[0] - 4) + ',' + (arrow[1] - 12) + ' l10,-6 l-2,11', stroke: '#3d2c4a', 'stroke-width': 2.4, fill: 'none', 'stroke-linecap': 'round', class: 'pop', style: 'animation-delay:2s' }, svg);
}

/* mount one scene: eiWarm('A'|'B'|'C'|'D', container, {onDone, loop}) */
function eiWarm(k, host, opts) {
  opts = opts || {};
  var root = document.createElement('div'); root.className = 'eiw s' + k; root.style.setProperty('--b1', ({ A: '1.9s', B: '1.7s', C: '1.7s', D: '1.8s' })[k]);
  var fs = Math.max(11, Math.min(17, (host.clientWidth || window.innerWidth) / 24));
  root.style.fontSize = fs + 'px';
  root.innerHTML = '<svg viewBox="0 0 360 420" preserveAspectRatio="xMidYMid meet"><defs>' +
    '<radialGradient id="dialG"><stop offset="0" stop-color="#fffaf4"/><stop offset="1" stop-color="#fde6d3"/></radialGradient>' +
    '<linearGradient id="arcG"><stop offset="0" stop-color="#6cc5b8"/><stop offset=".55" stop-color="#f5b841"/><stop offset="1" stop-color="#f27a8a"/></linearGradient>' +
    '<radialGradient id="sunG"><stop offset="0" stop-color="#fff3d6"/><stop offset=".55" stop-color="#ffc98f"/><stop offset="1" stop-color="#ffb27a" stop-opacity="0"/></radialGradient>' +
    '</defs></svg><div class="eiw-brand"><div class="mk"><svg class="ring" viewBox="0 0 120 120">' +
    '<circle cx="60" cy="60" r="56" fill="none" stroke="#fbe2cd" stroke-width="5"/>' +
    [['#ffb27a', 0], ['#f79a85', 1], ['#8fd3c7', 2], ['#f5b841', 3], ['#f27a8a', 4]].map(function (c) {
      return '<circle class="eiw-seg" cx="60" cy="60" r="56" fill="none" stroke="' + c[0] + '" stroke-width="5" stroke-linecap="round" pathLength="100" ' +
        'stroke-dasharray="17 83" transform="rotate(' + (-90 + c[1] * 72) + ' 60 60)" style="animation-delay:calc(var(--b1) + ' + (c[1] * .12) + 's)"/>'; }).join('') +
    '<circle class="dots" cx="60" cy="60" r="49" fill="none" stroke="#f3c7a6" stroke-width="1.4" stroke-dasharray="1 5" stroke-linecap="round"/>' +
    '</svg><div class="core"><img src="/elmeasure-mark.png" alt=""></div></div><div class="w1">ELMEASURE</div><div class="w2">INSIGHTS</div>' +
    '<div class="w3">Possibilities<b>…</b>Infinite</div></div><div class="skip">Tap to skip</div>';
  host.appendChild(root);
  sceneD(root.querySelector('svg'));
  return root;
}

window.eiSplash = function () {
  var host = document.createElement('div'); host.id = 'ei-splash';
  document.body.appendChild(host);
  eiWarm('D', host);
  var done = false;
  function close() { if (done) return; done = true; host.classList.add('out'); setTimeout(function () { host.remove(); }, 550); }
  host.addEventListener('click', close);
  setTimeout(close, 4300);
};

/* Elmeasure Insights – Android app mode (the PM Portal as an app)
 * 22-Oct-2026: app look for the shell and every dashboard tab; pinch-zoom and rotation stay available.
 * 25-Oct-2026: v1.8 – no flash of the laptop layout while the app opens (early cover in index.html, removed here).
 * 25-Oct-2026: v1.7 – light-orange theme (#FEF2E5) and the warm "Insight Bars" start screen with a colour ring round the logo.
 * 25-Oct-2026: v1.6 – Create Lead tab hidden in the app; space start screen switched off (a warm industry one is being chosen).
 * 25-Oct-2026: v1.5 – start screen v2: photo-real globe (NASA Blue Marble, clouds, city lights), smaller globe, much bigger brand.
 * 25-Oct-2026: v1.4 – new start screen "Earthrise": real-map 3D globe, sunrise flare, orbiting satellite, brand line in Elmeasure colours.
 * 25-Oct-2026: v1.3 – vibrant theme; Control tab not shown in the app (laptop only).
 * 25-Oct-2026: v1.2 – bottom navigation bar (Leads, Deals, Target, Sales, More) and the tab name as the header title.
 * 25-Oct-2026: v1.1 – mobile layer for every tab (mobile-app-frame.js), profile sheet with log out.
 * 24-Oct-2026: renamed "Elmeasure Insights"; the app asks for name + mobile once and verifies it with an SMS OTP
 *              (/api/app-otp). Registered users are listed in the Control tab, where they can be blocked.
 * Only active when the portal runs as the installed app (or with ?app=1 for testing; ?app=0 turns it off).
 * The website on a laptop is unchanged.
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
  var twa = /^android-app:\/\//.test(document.referrer || '');
  if (!standalone && !stored && !twa) return;

  var V = '10', APP = 'Elmeasure Insights', VERSION = '1.8';
  document.documentElement.classList.add('pm-app');
  var css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = '/mobile-app.css?v=' + V;
  document.head.appendChild(css);

  /* ---------- registration (mobile + SMS OTP) ---------- */
  function getUser() { try { return JSON.parse(localStorage.getItem('eiUser') || 'null'); } catch (e) { return null; } }
  function setUser(u) { try { localStorage.setItem('eiUser', JSON.stringify(u)); } catch (e) {} }
  function api(data) {
    return fetch('/api/app-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().catch(function () { return { error: 'Server error ' + r.status }; }); });
  }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function showGate(note) {
    if (document.getElementById('ei-gate')) return;
    var u = getUser() || {};
    var g = document.createElement('div'); g.id = 'ei-gate';
    g.innerHTML =
      '<div class="card"><img src="/elmeasure-logo.png" alt="Elmeasure">' +
      '<h1>' + APP + '</h1><p class="s">Register your mobile number to continue</p>' +
      '<div id="eiStep1"><label for="eiName">Your name</label><input id="eiName" autocomplete="name" maxlength="60" value="' + esc(u.name) + '">' +
      '<label for="eiMob">Mobile number</label><div class="mob"><span>+91</span><input id="eiMob" type="tel" inputmode="numeric" maxlength="10" autocomplete="tel-national" value="' + esc(u.mobile) + '"></div>' +
      '<button class="go" id="eiSend">Send OTP</button></div>' +
      '<div id="eiStep2" style="display:none"><label for="eiOtp">Enter the 6-digit OTP sent to <b id="eiTo"></b></label>' +
      '<input id="eiOtp" type="tel" inputmode="numeric" maxlength="6" autocomplete="one-time-code">' +
      '<button class="go" id="eiVerify">Verify &amp; continue</button>' +
      '<button class="lnk" id="eiResend" disabled>Resend OTP</button> · <button class="lnk" id="eiChange">Change number</button></div>' +
      '<div class="msg" id="eiMsg">' + esc(note || '') + '</div><div class="ft">Elmeasure · Possibilities…Infinite</div></div>';
    document.body.appendChild(g);
    var $ = function (id) { return document.getElementById(id); }, timer = null, busy = false;
    function msg(t, ok) { var m = $('eiMsg'); m.textContent = t || ''; m.className = 'msg' + (ok ? ' ok' : ''); }
    function cooldown() {
      var s = 30, b = $('eiResend'); b.disabled = true; clearInterval(timer);
      timer = setInterval(function () { s--; b.textContent = s > 0 ? 'Resend OTP (' + s + 's)' : 'Resend OTP'; if (s <= 0) { b.disabled = false; clearInterval(timer); } }, 1000);
    }
    function send() {
      var name = $('eiName').value.trim(), mob = $('eiMob').value.replace(/\D/g, '');
      if (name.length < 2) return msg('Enter your name.');
      if (!/^[6-9]\d{9}$/.test(mob)) return msg('Enter a valid 10-digit mobile number.');
      $('eiSend').disabled = true; $('eiResend').disabled = true; msg('Sending OTP…', true);
      api({ action: 'send', name: name, mobile: mob }).then(function (r) {
        $('eiSend').disabled = false;
        if (!r.ok) { $('eiResend').disabled = false; return msg(r.error || 'Could not send the OTP.'); }
        $('eiStep1').style.display = 'none'; $('eiStep2').style.display = '';
        $('eiTo').textContent = '+91 ' + mob; msg('OTP sent.', true); cooldown();
        setTimeout(function () { $('eiOtp').focus(); }, 50);
      }).catch(function () { $('eiSend').disabled = false; msg('No internet connection.'); });
    }
    function verify() {
      var otp = $('eiOtp').value.replace(/\D/g, ''), name = $('eiName').value.trim(), mob = $('eiMob').value.replace(/\D/g, '');
      if (otp.length !== 6) return msg('Enter the 6-digit OTP.');
      if (busy) return; busy = true;
      $('eiVerify').disabled = true; msg('Checking…', true);
      api({ action: 'verify', name: name, mobile: mob, otp: otp, device: ((navigator.userAgent || '').match(/\(([^)]*)\)/) || ['', ''])[1] })
        .then(function (r) {
          busy = false; $('eiVerify').disabled = false;
          if (!r.ok) return msg(r.error || 'Could not verify.');
          setUser({ name: r.name || name, mobile: mob, token: r.token, registered: r.registered || new Date().toISOString() });
          g.remove(); greet();
        }).catch(function () { busy = false; $('eiVerify').disabled = false; msg('No internet connection.'); });
    }
    $('eiSend').onclick = send; $('eiResend').onclick = send; $('eiVerify').onclick = verify;
    $('eiChange').onclick = function () { $('eiStep2').style.display = 'none'; $('eiStep1').style.display = ''; msg(''); };
    $('eiOtp').addEventListener('input', function () { if (this.value.replace(/\D/g, '').length === 6) verify(); });
    $('eiMob').addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
  }

  function greet() {
    var u = getUser(), s = document.querySelector('.brand-sub');
    if (s) { s.textContent = u ? 'Hi, ' + u.name.split(' ')[0] : ''; s.style.display = u ? '' : 'none'; }
    var b = document.getElementById('eiMe');
    if (!b) {
      var ham = document.getElementById('hambWrap') || document.getElementById('hamburgerBtn'); if (!ham || !ham.parentElement) return;
      b = document.createElement('button'); b.id = 'eiMe'; b.type = 'button'; b.title = 'My profile';
      ham.parentElement.insertBefore(b, ham);
      b.addEventListener('click', showProfile);
    }
    b.textContent = initials(u && u.name);
  }
  function initials(n) { n = String(n || '').trim(); if (!n) return '👤'; var p = n.split(/\s+/); return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }


  /* ---------- bottom navigation (replaces the Menu button in the app) ---------- */
  var ICON = {
    leads: '<path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/>',
    potentials: '<path d="M3 17l5-5 4 4 8-8M14 8h6v6"/>',
    pathtarget: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
    salestracking: '<path d="M4 20h16M7 16v-5m5 5V7m5 9v-8"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
  };
  var HIDE_IN_APP = ['authorization', 'control', 'createleads', 'regiontrack'];   // regiontrack: web only until approved for the app          // admin tabs stay on the laptop portal only
  var MAIN = [['leads', 'Leads'], ['potentials', 'Deals'], ['pathtarget', 'Target'], ['salestracking', 'Sales']];
  function svg(k) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON[k] + '</svg>'; }
  function tabBtns() { return Array.prototype.filter.call(document.querySelectorAll('#tabs .tab-btn'), function (b) { return b.dataset.target && b.style.display !== 'none' && HIDE_IN_APP.indexOf(b.dataset.target) < 0; }); }
  function label(b) { return (b.textContent || '').replace(/^[^A-Za-z0-9]+/, '').trim(); }
  function go(k) { if (typeof window.showPortalTab === 'function') window.showPortalTab(k); closeMore(); markNav(); }
  function closeMore() { var m = document.getElementById('ei-more'); if (m) { m.classList.remove('on'); setTimeout(function () { m.remove(); }, 220); } }
  function markNav() {
    var act = document.querySelector('#tabs .tab-btn.active'), k = act ? act.dataset.target : '';
    var inMain = MAIN.some(function (m) { return m[0] === k; });
    Array.prototype.forEach.call(document.querySelectorAll('#ei-nav button'), function (b) { b.classList.toggle('on', b.dataset.k === k || (b.dataset.k === 'more' && !inMain && !!k)); });
    var t = document.querySelector('.brand-title'); if (t && act) t.textContent = label(act).replace('Channel Partner Analytics', 'CP Analytics').replace('PM Cumulative Tracking', 'PM Tracking');
  }
  function openMore() {
    if (document.getElementById('ei-more')) return closeMore();
    var mainKeys = MAIN.map(function (m) { return m[0]; });
    var items = tabBtns().filter(function (b) { return mainKeys.indexOf(b.dataset.target) < 0; });
    var m = document.createElement('div'); m.id = 'ei-more';
    m.innerHTML = '<div class="sheet"><div class="grab"></div><div class="ttl">All dashboards</div><div class="grid">' +
      items.map(function (b) { var tx = b.textContent.trim(), em = (tx.match(/^[^A-Za-z0-9]+/) || [''])[0].trim();
        return '<button data-k="' + b.dataset.target + '"' + (b.classList.contains('active') ? ' class="on"' : '') + '><span class="em">' + esc(em || '•') + '</span><span>' + esc(label(b)) + '</span></button>'; }).join('') +
      '</div></div>';
    document.body.appendChild(m);
    requestAnimationFrame(function () { m.classList.add('on'); });
    m.addEventListener('click', function (e) { var b = e.target.closest('button[data-k]'); if (b) return go(b.dataset.k); if (e.target === m) closeMore(); });
  }
  function bottomNav() {
    if (document.getElementById('ei-nav') || !document.getElementById('tabs')) return;
    var visible = tabBtns().map(function (b) { return b.dataset.target; });
    var n = document.createElement('nav'); n.id = 'ei-nav';
    n.innerHTML = MAIN.filter(function (m) { return visible.indexOf(m[0]) >= 0; }).map(function (m) {
      return '<button data-k="' + m[0] + '">' + svg(m[0]) + '<span>' + m[1] + '</span></button>'; }).join('') +
      '<button data-k="more">' + svg('more') + '<span>More</span></button>';
    document.body.appendChild(n);
    document.documentElement.classList.add('ei-hasnav');
    n.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; if (b.dataset.k === 'more') openMore(); else go(b.dataset.k); });
    new MutationObserver(markNav).observe(document.getElementById('tabs'), { attributes: true, subtree: true, attributeFilter: ['class', 'style'] });
    markNav();
  }

  /* ---------- profile sheet: name, mobile, app info, log out ---------- */
  function showProfile() {
    var u = getUser(); if (!u) return showGate();
    var old = document.getElementById('ei-prof'); if (old) old.remove();
    var reg = u.registered ? new Date(u.registered).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    var p = document.createElement('div'); p.id = 'ei-prof';
    p.innerHTML = '<div class="sheet"><div class="grab"></div>' +
      '<div class="av">' + esc(initials(u.name)) + '</div><div class="nm">' + esc(u.name) + '</div>' +
      '<div class="mb">+91 ' + esc(u.mobile) + '</div>' +
      '<div class="rows"><div><span>Registered</span><b>' + esc(reg) + '</b></div>' +
      '<div><span>App</span><b>' + APP + ' v' + VERSION + '</b></div>' +
      '<div><span>Data</span><b>Synced every 2 hours, 7 AM – 9 PM</b></div></div>' +
      '<button class="pbtn" id="eiReload">⟳ Refresh data</button>' +
      '<button class="pbtn out" id="eiLogout">Log out</button>' +
      '<button class="pbtn ghost" id="eiClose">Close</button>' +
      '<div class="ft">Elmeasure · Possibilities…Infinite</div></div>';
    document.body.appendChild(p);
    requestAnimationFrame(function () { p.classList.add('on'); });
    function close() { p.classList.remove('on'); setTimeout(function () { p.remove(); }, 250); }
    p.addEventListener('click', function (e) { if (e.target === p) close(); });
    document.getElementById('eiClose').onclick = close;
    document.getElementById('eiReload').onclick = function () { location.reload(); };
    document.getElementById('eiLogout').onclick = function () {
      if (!confirm('Log out of ' + APP + '? You will need an OTP to sign in again.')) return;
      api({ action: 'logout', mobile: u.mobile, token: u.token }).catch(function () {});
      try { localStorage.removeItem('eiUser'); } catch (e) {}
      close(); greet(); showGate('You have logged out. Verify your mobile number to sign in again.');
    };
  }

  function checkUser() {
    var u = getUser();
    if (!u || !u.token) return showGate();
    greet();
    api({ action: 'check', mobile: u.mobile, token: u.token }).then(function (r) {
      if (r.ok) { var ch = false;
        if (r.name && r.name !== u.name) { u.name = r.name; ch = true; }
        if (r.registered && r.registered !== u.registered) { u.registered = r.registered; ch = true; }
        if (ch) { setUser(u); greet(); } return; }
      if (r.reason === 'blocked') { try { localStorage.removeItem('eiUser'); } catch (e) {} return showGate('Your access has been blocked. Contact the administrator.'); }
      if (r.reason === 'register') return showGate('Please verify your mobile number again.');
      // server problem: do not lock the user out
    }).catch(function () {});
  }

  /* ---------- start-up animation "Earthrise" (once per app launch, tap to skip) – see window.eiSplash below ---------- */
  function splash() {
    try { if (sessionStorage.getItem('eiSplash')) return; sessionStorage.setItem('eiSplash', '1'); } catch (e) {}
    if (window.eiSplash) window.eiSplash();
  }

  /* ---------- app look for every dashboard tab ---------- */
  function styleFrame(f) {
    try {
      var d = f.contentDocument;
      if (!d || !d.head || d.getElementById('pm-app-css')) return;
      var l = d.createElement('link');
      l.id = 'pm-app-css'; l.rel = 'stylesheet'; l.href = '/mobile-app-frame.css?v=' + V;
      d.head.appendChild(l);
      d.documentElement.classList.add('app-mode');
      var sc = d.createElement('script');                         // folding sections, key columns, cards, show-more
      sc.id = 'pm-app-js'; sc.src = '/mobile-app-frame.js?v=' + V;
      (d.body || d.head).appendChild(sc);
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
    var t = document.querySelector('.brand-title'); if (t) t.textContent = 'INSIGHTS';
    document.title = APP;
    var tc = document.querySelector('meta[name=theme-color]'); if (tc) tc.setAttribute('content', '#f08c5a');
    splash();
    document.documentElement.classList.remove('ei-boot');   // early cover from index.html: the start screen / app now covers the page
    bottomNav(); setTimeout(bottomNav, 1500); setTimeout(markNav, 1600);
    checkUser();
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
