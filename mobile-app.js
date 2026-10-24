/* Elmeasure Insights – start screen "Earthrise" v2 (25-Oct-2026)
 * Photo-real globe (NASA Blue Marble day map, city lights at night, moving clouds) rolls into view, the sun rises
 * over its edge with a lens flare, a satellite circles it, and the Elmeasure brand takes centre stage.
 * About 4.5 s, tap to skip. Plain canvas. Images: /splash/earth-day.jpg, earth-night.jpg, earth-clouds.jpg
 * (NASA Blue Marble / Black Marble – public domain, via the three-globe and globe.gl examples).
 */
window.eiSplash = function (opts) {
  opts = opts || {};
  var BASE = opts.base || '/splash/';
  var root = document.createElement('div'); root.id = 'ei-splash';
  root.innerHTML = '<canvas></canvas><div class="brand"><div class="mk"><img src="/elmeasure-mark.png" alt=""></div>' +
    '<div class="w1">ELMEASURE</div><div class="w2">INSIGHTS</div><div class="w3">Possibilities…Infinite</div></div>' +
    '<div class="skip">Tap to skip</div>';
  (opts.parent || document.body).appendChild(root);
  var cv = root.querySelector('canvas'), x = cv.getContext('2d');
  var dpr = Math.min(window.devicePixelRatio || 1, 2.5), W, H;
  function size() { W = root.clientWidth; H = root.clientHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); x.setTransform(dpr, 0, 0, dpr, 0, 0); geo = null; }
  var geo = null; size(); window.addEventListener('resize', size);
  var ease = function (t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return 1 - Math.pow(1 - t, 3); };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var stars = []; for (var s = 0; s < 260; s++) stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.3 + .25, p: Math.random() * 6 });

  // ---- textures ----
  var TX = {}, need = 3, ready = false;
  function load(k, f) {
    var im = new Image(); im.onload = function () {
      var c = document.createElement('canvas'); c.width = im.width; c.height = im.height; var g = c.getContext('2d'); g.drawImage(im, 0, 0);
      TX[k] = { w: im.width, h: im.height, d: g.getImageData(0, 0, im.width, im.height).data };
      if (--need === 0) ready = true;
    }; im.onerror = function () { if (--need === 0) ready = true; }; im.src = BASE + f;
  }
  load('day', 'earth-day.jpg'); load('night', 'earth-night.jpg'); load('cloud', 'earth-clouds.jpg');

  // ---- globe geometry, prepared once per size: texture coordinates + lighting for every pixel ----
  var TILT = 23.4 * Math.PI / 180, ct = Math.cos(TILT), st = Math.sin(TILT);
  var L = [0.66, -0.52, 0.54], ln = Math.hypot(L[0], L[1], L[2]); L = [L[0] / ln, L[1] / ln, L[2] / ln];
  var gc = document.createElement('canvas'), gx = gc.getContext('2d');
  function prep(R) {
    var n = Math.round(R * 2 * dpr), r = n / 2, cnt = 0, i, px, py;
    gc.width = gc.height = n;
    var idx = [], U = [], V = [], DIF = [], RIM = [], SPC = [], AL = [];
    var hx = L[0], hy = L[1], hz = L[2] + 1, hl = Math.hypot(hx, hy, hz);
    for (py = 0; py < n; py++) {
      var yy = (py + .5 - r) / r;
      for (px = 0; px < n; px++) {
        var xx = (px + .5 - r) / r, q2 = xx * xx + yy * yy; if (q2 > 1) continue;
        var zz = Math.sqrt(1 - q2), y2 = yy * ct - xx * st, x2 = xx * ct + yy * st;
        var lat = Math.asin(clamp(-y2, -1, 1)), lon = Math.atan2(x2, zz);
        idx.push(py * n + px); U.push(lon / (2 * Math.PI) + 0.5); V.push(0.5 - lat / Math.PI);
        var dif = xx * L[0] + yy * L[1] + zz * L[2]; DIF.push(dif); RIM.push(Math.pow(1 - zz, 2.6));
        SPC.push(Math.pow(clamp((xx * hx + yy * hy + zz * hz) / hl, 0, 1), 70));
        var e = (1 - Math.sqrt(q2)) * r; AL.push(e < 1.3 ? e / 1.3 : 1);
      }
    }
    geo = { R: R, n: n, idx: idx, U: U, V: V, DIF: DIF, RIM: RIM, SPC: SPC, AL: AL, img: gx.createImageData(n, n) };
  }
  function drawGlobe(rot, cloudRot) {
    var g = geo, d = g.img.data, D = TX.day, N = TX.night, C = TX.cloud, k;
    for (k = 0; k < g.idx.length; k++) {
      var o = g.idx[k] * 4, u = g.U[k] + rot, v = g.V[k];
      u -= Math.floor(u);
      var di = ((v * D.h | 0) * D.w + (u * D.w | 0)) * 4;
      var R0 = D.d[di], G0 = D.d[di + 1], B0 = D.d[di + 2];
      var dif = g.DIF[k], day = clamp(dif * 1.15 + 0.12, 0, 1);
      var ocean = B0 > R0 + 12 && B0 > G0;               // blue pixels = sea: give them the sun glint
      var rr = R0 * day, gg = G0 * day, bb = B0 * day;
      if (ocean && dif > 0) { var sp = g.SPC[k] * 210; rr += sp; gg += sp * .95; bb += sp * .85; }
      if (N && dif < 0.15) {                              // city lights on the night side
        var ni = ((v * N.h | 0) * N.w + (u * N.w | 0)) * 4, nl = N.d[ni] / 255 * clamp((0.15 - dif) * 3, 0, 1);
        rr += 255 * nl; gg += 200 * nl; bb += 110 * nl;
      }
      if (C) {                                            // clouds drift a little faster than the ground
        var cu = u + cloudRot; cu -= Math.floor(cu);
        var ca = C.d[((v * C.h | 0) * C.w + (cu * C.w | 0)) * 4] / 255 * 0.85, cl = clamp(dif * 1.1 + 0.1, 0.02, 1) * 255;
        rr = rr * (1 - ca) + cl * ca; gg = gg * (1 - ca) + cl * ca; bb = bb * (1 - ca) + cl * ca;
      }
      var rim = g.RIM[k], ra = clamp(dif + 0.45, 0.1, 1);   // blue atmosphere at the edge
      rr = rr * (1 - rim) + 110 * rim * ra; gg = gg * (1 - rim) + 190 * rim * ra; bb = bb * (1 - rim) + 255 * rim * ra;
      d[o] = rr > 255 ? 255 : rr; d[o + 1] = gg > 255 ? 255 : gg; d[o + 2] = bb > 255 ? 255 : bb; d[o + 3] = 255 * g.AL[k];
    }
    gx.putImageData(g.img, 0, 0);
  }

  var T0 = null, DUR = opts.duration || 4.6, raf, done = false, tWait = performance.now();
  function frame(now) {
    if (!ready && now - tWait < 2500) { raf = requestAnimationFrame(frame); paintSpace(0); return; }   // wait for the pictures (max 2.5 s)
    if (T0 === null) T0 = now;
    var t = (now - T0) / 1000;
    paintSpace(t);
    // globe: smaller, upper part of the screen, rolls up and grows
    var gi = ease((t - .05) / 1.4), R = Math.min(W * .27, H * .15) * (.6 + .4 * gi), cx = W / 2, cy = H * .3 + (1 - gi) * H * .18;
    var Rf = Math.min(W * .27, H * .15);
    if (!geo || geo.R !== Rf) prep(Rf);
    var rot = 0.217 - (DUR - t) * 0.035;         // rolls west→east and ends with India facing us
    // orbit (back half), glow, globe, orbit (front half)
    var orbR = R * 1.45, oT = -16 * Math.PI / 180, oy = 0.26, sat = t * 1.5 + 1;
    function orbit(front) {
      x.save(); x.translate(cx, cy); x.rotate(oT); x.globalAlpha = .6 * gi; x.strokeStyle = 'rgba(126,240,255,.75)'; x.lineWidth = 1;
      x.beginPath(); x.ellipse(0, 0, orbR, orbR * oy, 0, front ? 0 : Math.PI, front ? Math.PI : 2 * Math.PI); x.stroke();
      var sx = Math.cos(sat) * orbR, sy = Math.sin(sat) * orbR * oy;
      if ((Math.sin(sat) > 0) === front) { x.globalAlpha = gi; x.shadowColor = '#7ef0ff'; x.shadowBlur = 12; x.fillStyle = '#eafeff'; x.beginPath(); x.arc(sx, sy, 2.6, 0, 7); x.fill(); }
      x.restore();
    }
    orbit(false);
    var gl = x.createRadialGradient(cx, cy, R * .92, cx, cy, R * 1.32); gl.addColorStop(0, 'rgba(90,190,255,' + (.5 * gi) + ')'); gl.addColorStop(1, 'rgba(90,190,255,0)');
    x.fillStyle = gl; x.beginPath(); x.arc(cx, cy, R * 1.32, 0, 7); x.fill();
    if (TX.day) { drawGlobe(rot, t * 0.012); x.globalAlpha = clamp(t / .45, 0, 1); x.imageSmoothingQuality = 'high'; x.drawImage(gc, cx - R, cy - R, R * 2, R * 2); x.globalAlpha = 1; }
    orbit(true);
    // sunrise over the upper-right edge
    var fl = ease((t - .8) / .9), fx = cx + R * .74, fy = cy - R * .64;
    if (fl > 0) {
      x.save(); x.globalCompositeOperation = 'lighter';
      var core = x.createRadialGradient(fx, fy, 0, fx, fy, R * .85);
      core.addColorStop(0, 'rgba(255,255,255,' + fl + ')'); core.addColorStop(.1, 'rgba(255,244,214,' + (.85 * fl) + ')');
      core.addColorStop(.35, 'rgba(255,196,110,' + (.22 * fl) + ')'); core.addColorStop(1, 'rgba(255,160,60,0)');
      x.fillStyle = core; x.beginPath(); x.arc(fx, fy, R * .85, 0, 7); x.fill();
      for (var k = 0; k < 12; k++) {
        var a = k * Math.PI / 6 + t * .12, len = R * (k % 3 === 0 ? 1.05 : .5) * fl;
        var sg = x.createLinearGradient(fx, fy, fx + Math.cos(a) * len, fy + Math.sin(a) * len);
        sg.addColorStop(0, 'rgba(255,255,255,' + (.7 * fl) + ')'); sg.addColorStop(1, 'rgba(255,255,255,0)');
        x.strokeStyle = sg; x.lineWidth = k % 3 === 0 ? 1.8 : .9; x.beginPath(); x.moveTo(fx, fy); x.lineTo(fx + Math.cos(a) * len, fy + Math.sin(a) * len); x.stroke();
      }
      var gh = [[.4, 10, '0,115,200'], [.75, 7, '0,179,164'], [1.1, 15, '123,79,214'], [1.5, 6, '255,210,63']];
      for (var q = 0; q < gh.length; q++) {
        var gx2 = fx + (cx - fx) * gh[q][0] * 1.5, gy2 = fy + (cy - fy) * gh[q][0] * 1.5, gr = gh[q][1] * R / 100;
        var g2 = x.createRadialGradient(gx2, gy2, 0, gx2, gy2, gr); g2.addColorStop(0, 'rgba(' + gh[q][2] + ',' + (.3 * fl) + ')'); g2.addColorStop(1, 'rgba(' + gh[q][2] + ',0)');
        x.fillStyle = g2; x.beginPath(); x.arc(gx2, gy2, gr, 0, 7); x.fill();
      }
      x.restore();
    }
    if (t > 1.2) root.classList.add('b1');
    if (t > 1.6) root.classList.add('b2');
    if (t > 2.1) root.classList.add('b3');
    if (t < DUR) raf = requestAnimationFrame(frame); else close();
  }
  function paintSpace(t) {
    var bg = x.createRadialGradient(W * .5, H * .3, 10, W * .5, H * .5, Math.max(W, H) * .95);
    bg.addColorStop(0, '#0c2342'); bg.addColorStop(.5, '#050e1f'); bg.addColorStop(1, '#01040a');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    var n1 = x.createRadialGradient(W * .1, H * .15, 0, W * .1, H * .15, W * .8); n1.addColorStop(0, 'rgba(123,79,214,.2)'); n1.addColorStop(1, 'rgba(123,79,214,0)');
    x.fillStyle = n1; x.fillRect(0, 0, W, H);
    var n2 = x.createRadialGradient(W * .95, H * .85, 0, W * .95, H * .85, W * .8); n2.addColorStop(0, 'rgba(0,179,164,.16)'); n2.addColorStop(1, 'rgba(0,179,164,0)');
    x.fillStyle = n2; x.fillRect(0, 0, W, H);
    var sa = ease(t / .7);
    x.fillStyle = '#fff';
    for (var i = 0; i < stars.length; i++) { var p = stars[i]; x.globalAlpha = (.25 + .3 * sa) + .45 * Math.abs(Math.sin(t * 1.6 + p.p)); x.fillRect(p.x * W, p.y * H, p.r, p.r); }
    x.globalAlpha = 1;
  }
  function close() {
    if (done) return; done = true; root.classList.add('out');
    setTimeout(function () { cancelAnimationFrame(raf); window.removeEventListener('resize', size); root.remove(); if (opts.onDone) opts.onDone(); }, 600);
  }
  root.addEventListener('click', close);
  raf = requestAnimationFrame(frame);
  return { close: close };
};

/* Elmeasure Insights – Android app mode (the PM Portal as an app)
 * 22-Oct-2026: app look for the shell and every dashboard tab; pinch-zoom and rotation stay available.
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

  var V = '7', APP = 'Elmeasure Insights', VERSION = '1.5';
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
  var HIDE_IN_APP = ['authorization', 'control'];          // admin tabs stay on the laptop portal only
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
    splash();
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
