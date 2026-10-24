/* Elmeasure Insights – Android app mode (the PM Portal as an app)
 * 22-Oct-2026: app look for the shell and every dashboard tab; pinch-zoom and rotation stay available.
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

  var V = '2', APP = 'Elmeasure Insights';
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
          setUser({ name: r.name || name, mobile: mob, token: r.token });
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
    if (u && s) { s.textContent = 'Hi, ' + u.name.split(' ')[0]; }
  }

  function checkUser() {
    var u = getUser();
    if (!u || !u.token) return showGate();
    greet();
    api({ action: 'check', mobile: u.mobile, token: u.token }).then(function (r) {
      if (r.ok) { if (r.name && r.name !== u.name) { u.name = r.name; setUser(u); greet(); } return; }
      if (r.reason === 'blocked') { try { localStorage.removeItem('eiUser'); } catch (e) {} return showGate('Your access has been blocked. Contact the administrator.'); }
      if (r.reason === 'register') return showGate('Please verify your mobile number again.');
      // server problem: do not lock the user out
    }).catch(function () {});
  }

  /* ---------- start-up animation (once per app launch, tap to skip) ---------- */
  function splash() {
    try { if (sessionStorage.getItem('eiSplash')) return; sessionStorage.setItem('eiSplash', '1'); } catch (e) {}
    var s = document.createElement('div'); s.id = 'ei-splash';
    var dots = '';
    for (var i = 0; i < 18; i++) {
      dots += '<i style="left:' + (8 + Math.random() * 84).toFixed(1) + '%;top:' + (35 + Math.random() * 55).toFixed(1) +
        '%;animation-delay:' + (Math.random() * 2).toFixed(2) + 's"></i>';
    }
    s.innerHTML = '<div class="floor"></div><div class="dots">' + dots + '</div>' +
      '<div class="stage"><div class="ring r3"></div><div class="ring r2"></div><div class="ring r1"></div><div class="mark"></div></div>' +
      '<svg class="wave" viewBox="0 0 260 46"><defs><linearGradient id="eiG" x1="0" x2="1"><stop offset="0" stop-color="#4fc3ff"/>' +
      '<stop offset=".5" stop-color="#9b5cff"/><stop offset="1" stop-color="#5dff9e"/></linearGradient></defs>' +
      '<path d="M0 23 C16 2 32 2 48 23 S80 44 96 23 S128 2 144 23 S176 44 192 23 S224 2 240 23 L260 23"/></svg>' +
      '<div class="t1">ELMEASURE <b>INSIGHTS</b></div><div class="t2">POSSIBILITIES…INFINITE</div>';
    document.body.appendChild(s);
    var done = false;
    function close() { if (done) return; done = true; s.classList.add('out'); setTimeout(function () { s.remove(); }, 650); }
    s.addEventListener('click', close);
    setTimeout(close, 3200);
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
