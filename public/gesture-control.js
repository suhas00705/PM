/* Elmeasure PM Portal - camera gesture control  (v1, 19-Oct-2026)
 * Adds a "Gesture" button (top right). When switched on, the webcam + Google MediaPipe hand
 * tracking (runs inside the browser - no video is recorded or sent anywhere) lets you:
 *   Index finger up ............ move the on-screen pointer
 *   Open palm, move hand ........ scroll up / down / left / right (further from start = faster)
 *   Quick pinch (thumb+index) ... click / Enter on whatever the pointer is on
 *   Pinch & hold, move up/down .. zoom in / zoom out
 *   Fist for 1 second ........... pause  (open palm for 1 second resumes)
 * Works on the portal shell (index.html, reaches into the dashboard iframes) and on any page
 * opened on its own. Inside a portal iframe it does nothing - the shell drives it.
 */
(function () {
  'use strict';
  if (window.__gcLoaded) return;
  window.__gcLoaded = true;
  // Inside the portal (same-origin parent page) the shell drives everything - do nothing here.
  if (window.self !== window.top) { try { if (window.top.document) return; } catch (e) { /* cross-origin parent: run standalone */ } }

  var MP_VER = '0.10.14';
  var MP_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VER + '/vision_bundle.mjs';
  var WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VER + '/wasm';
  var MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  var SS_KEY = 'gc_on';

  // tuning
  var EXT_RATIO = 1.5;       // finger tip / knuckle distance from wrist above which the finger is "up"
  var PINCH_ON = 0.33, PINCH_OFF = 0.48;   // thumb-index gap / hand size
  var CLICK_MAX_MS = 450, CLICK_MAX_MOVE = 0.06;
  var DEAD = 0.035, SCROLL_K = 420, SCROLL_MAX = 60;
  var ZOOM_K = 2.2, ZOOM_MIN = 0.5, ZOOM_MAX = 2.5;
  var HOLD_MS = 1000;

  var S = {
    on: false, busy: false, stream: null, video: null, lmk: null, raf: 0, lastVT: -1,
    px: innerWidth / 2, py: innerHeight / 2, sx: null, sy: null,
    raw: 'none', rawN: 0, mode: 'none', paused: false,
    pinch: false, pinchT: 0, pinchP: null, pinchZoomed: false, zoomBase: 1, zoomDoc: null, zoomY0: 0,
    anchor: null, hist: [], fistT: 0, palmT: 0, holdDone: false, lostT: 0, status: ''
  };

  // ---------------------------------------------------------------- UI
  function css() {
    var s = document.createElement('style');
    s.id = 'gc-style';
    s.textContent = [
      '#gc-btn{display:flex;align-items:center;gap:7px;cursor:pointer;font:700 13.5px/1 system-ui,-apple-system,"Segoe UI",sans-serif;',
      ' border-radius:9px;padding:8px 14px;border:1.5px solid rgba(255,255,255,.32);background:rgba(255,255,255,.14);color:#fff;white-space:nowrap}',
      '#gc-btn:hover{background:rgba(255,255,255,.24)}',
      '#gc-btn.gc-float{position:fixed;top:10px;right:12px;z-index:2147483600;background:#142a5c;border-color:#142a5c;box-shadow:0 3px 10px rgba(0,0,0,.2)}',
      '#gc-btn.gc-float:hover{background:#1d3a7a}',
      '#gc-btn.on{background:#16a34a!important;border-color:#16a34a!important}',
      '#gc-btn .gc-dot{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.55)}',
      '#gc-btn.on .gc-dot{background:#fff;animation:gcBlink 1.2s infinite}',
      '@keyframes gcBlink{50%{opacity:.25}}',
      '#gc-panel{position:fixed;right:12px;bottom:12px;width:200px;z-index:2147483601;background:#0f1d3d;color:#e8eefc;border-radius:12px;',
      ' box-shadow:0 8px 24px rgba(0,0,0,.35);font:12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden;display:none}',
      '#gc-panel .gc-cam{position:relative;width:200px;height:150px;background:#000}',
      '#gc-panel video,#gc-panel canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}',
      '#gc-panel .gc-st{padding:7px 9px;font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:6px}',
      '#gc-panel .gc-st button{background:rgba(255,255,255,.12);color:#fff;border:0;border-radius:6px;padding:3px 7px;cursor:pointer;font:inherit;font-weight:700}',
      '#gc-panel .gc-help{padding:0 9px 8px;color:#b9c6e6;display:none}',
      '#gc-panel .gc-help div{padding:1px 0}',
      '#gc-panel.help .gc-help{display:block}',
      '#gc-ptr{position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;z-index:2147483602;pointer-events:none;',
      ' border:3px solid #2f80ed;background:rgba(47,128,237,.18);box-shadow:0 0 0 2px #fff;display:none;transition:width .12s,height .12s,margin .12s,border-color .12s}',
      '#gc-ptr.scroll{border-color:#f59e0b;background:rgba(245,158,11,.2)}',
      '#gc-ptr.pinch{width:16px;height:16px;margin:-8px 0 0 -8px;border-color:#16a34a;background:rgba(22,163,74,.35)}',
      '#gc-ptr.zoom{border-color:#a855f7;background:rgba(168,85,247,.25)}',
      '#gc-ptr.paused{border-color:#9ca3af;background:rgba(156,163,175,.2)}',
      '#gc-ptr span{position:absolute;left:30px;top:-2px;font:700 12px system-ui,sans-serif;color:#fff;background:rgba(15,29,61,.85);padding:2px 6px;border-radius:5px;white-space:nowrap}',
      '.gc-ripple{position:fixed;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;border:3px solid #16a34a;z-index:2147483602;pointer-events:none;animation:gcRip .45s ease-out forwards}',
      '@keyframes gcRip{to{transform:scale(3);opacity:0}}',
      '#gc-toast{position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:2147483603;background:#111827;color:#fff;padding:10px 16px;border-radius:9px;',
      ' font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);max-width:min(560px,90vw);display:none}',
      '@media print{#gc-btn,#gc-panel,#gc-ptr,#gc-toast{display:none!important}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  var btn, panel, stEl, ptr, ptrLbl, toastEl, toastTimer, canvas, ctx;

  function buildUI() {
    css();
    btn = document.createElement('button');
    btn.id = 'gc-btn';
    btn.type = 'button';
    btn.title = 'Control the dashboard with hand gestures via your camera';
    btn.innerHTML = '<span class="gc-dot"></span><span>&#9995; Gesture</span>';
    btn.addEventListener('click', function () { S.on ? stop(true) : start(); });
    var fs = document.getElementById('fsBtn');            // portal shell top bar
    if (fs && fs.parentNode) fs.parentNode.insertBefore(btn, fs);
    else { btn.className = 'gc-float'; document.body.appendChild(btn); }

    panel = document.createElement('div');
    panel.id = 'gc-panel';
    panel.innerHTML =
      '<div class="gc-cam"><video playsinline muted></video><canvas width="320" height="240"></canvas></div>' +
      '<div class="gc-st"><span id="gc-stx">Starting camera…</span><span style="display:flex;gap:4px">' +
      '<button type="button" data-a="z" title="Reset zoom to 100%">100%</button>' +
      '<button type="button" data-a="h" title="Show gestures">?</button>' +
      '<button type="button" data-a="x" title="Turn off">&#10005;</button></span></div>' +
      '<div class="gc-help">' +
      '<div>&#9757;&#65039; Index finger up – move pointer</div>' +
      '<div>&#9995; Open palm, move – scroll &#8593;&#8595;&#8592;&#8594;</div>' +
      '<div>&#129295; Quick pinch – click / Enter</div>' +
      '<div>&#129295; Pinch &amp; hold, move up/down – zoom in/out</div>' +
      '<div>&#9994; Fist 1 s – pause · &#9995; palm 1 s – resume</div></div>';
    document.body.appendChild(panel);
    S.video = panel.querySelector('video');
    canvas = panel.querySelector('canvas');
    ctx = canvas.getContext('2d');
    stEl = panel.querySelector('#gc-stx');
    panel.addEventListener('click', function (e) {
      var a = e.target && e.target.getAttribute && e.target.getAttribute('data-a');
      if (a === 'x') stop(true);
      else if (a === 'h') panel.classList.toggle('help');
      else if (a === 'z') resetZoom();
    });

    ptr = document.createElement('div');
    ptr.id = 'gc-ptr';
    ptr.innerHTML = '<span></span>';
    ptrLbl = ptr.firstChild;
    document.body.appendChild(ptr);

    toastEl = document.createElement('div');
    toastEl.id = 'gc-toast';
    document.body.appendChild(toastEl);
  }

  function toast(msg, ms) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.display = 'none'; }, ms || 4500);
  }
  function status(t) { if (t !== S.status) { S.status = t; if (stEl) stEl.textContent = t; } }

  // ---------------------------------------------------------------- start / stop
  function start() {
    if (S.on || S.busy) return;
    if (!window.isSecureContext) { toast('Camera needs the secure (https) portal link.'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('This browser has no camera access. Please use Chrome or Edge.'); return; }
    S.busy = true;
    btn.classList.add('on');
    panel.style.display = 'block';
    panel.classList.add('help');
    setTimeout(function () { if (panel) panel.classList.remove('help'); }, 9000);
    status('Starting camera…');
    navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false })
      .then(function (stream) {
        S.stream = stream;
        S.video.srcObject = stream;
        return S.video.play();
      })
      .then(function () {
        status('Loading hand tracking…');
        return loadModel();
      })
      .then(function () {
        S.busy = false; S.on = true;
        try { sessionStorage.setItem(SS_KEY, '1'); } catch (e) {}
        status('Show your hand ✋');
        loop();
      })
      .catch(function (err) {
        S.busy = false;
        var n = err && err.name;
        if (n === 'NotAllowedError' || n === 'SecurityError') toast('Camera is blocked. Click the camera / lock icon in the address bar, allow the camera, then press Gesture again.', 8000);
        else if (n === 'NotFoundError' || n === 'OverconstrainedError') toast('No camera found on this computer.');
        else if (n === 'NotReadableError') toast('Camera is busy in another app (Teams/Zoom?). Close it and try again.', 7000);
        else toast('Gesture control could not start: ' + ((err && err.message) || err) + '. Check internet access to cdn.jsdelivr.net and storage.googleapis.com.', 9000);
        stop(false);
      });
  }

  function loadModel() {
    if (S.lmk) return Promise.resolve();
    return import(MP_URL).then(function (mp) {
      return mp.FilesetResolver.forVisionTasks(WASM_URL).then(function (fsr) {
        var opts = function (d) {
          return { baseOptions: { modelAssetPath: MODEL_URL, delegate: d }, runningMode: 'VIDEO', numHands: 1,
                   minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.5 };
        };
        return mp.HandLandmarker.createFromOptions(fsr, opts('GPU'))
          .catch(function () { return mp.HandLandmarker.createFromOptions(fsr, opts('CPU')); });
      });
    }).then(function (l) { S.lmk = l; });
  }

  function stop(byUser) {
    S.on = false; S.busy = false;
    cancelAnimationFrame(S.raf);
    if (S.stream) { S.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); }
    S.stream = null;
    if (S.video) S.video.srcObject = null;
    if (btn) btn.classList.remove('on');
    if (panel) panel.style.display = 'none';
    if (ptr) ptr.style.display = 'none';
    S.mode = 'none'; S.pinch = false; S.anchor = null; S.paused = false;
    if (byUser) { try { sessionStorage.removeItem(SS_KEY); } catch (e) {} }
  }

  function loop() {
    if (!S.on) return;
    S.raf = requestAnimationFrame(loop);
    var v = S.video;
    if (!v || v.readyState < 2 || v.currentTime === S.lastVT) return;
    S.lastVT = v.currentTime;
    var now = performance.now(), res;
    try { res = S.lmk.detectForVideo(v, now); } catch (e) { return; }
    var lm = res && res.landmarks && res.landmarks[0];
    draw(lm);
    handle(lm || null, now);
  }

  function draw(lm) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!lm) return;
    ctx.fillStyle = S.paused ? '#9ca3af' : '#38bdf8';
    for (var i = 0; i < lm.length; i++) {
      ctx.beginPath();
      ctx.arc(lm[i].x * canvas.width, lm[i].y * canvas.height, (i === 4 || i === 8) ? 5 : 3, 0, 6.3);
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------- gesture engine
  function d2(a, b) { var x = a.x - b.x, y = a.y - b.y; return Math.sqrt(x * x + y * y); }
  function up(lm, tip, mcp) { return d2(lm[0], lm[tip]) > d2(lm[0], lm[mcp]) * EXT_RATIO; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function classify(lm) {
    var size = d2(lm[0], lm[9]) || 1e-6;
    var gap = d2(lm[4], lm[8]) / size;
    var idxOut = d2(lm[0], lm[8]) > d2(lm[0], lm[5]) * 1.25;   // a fist also brings thumb & index together
    S.pinch = idxOut && (S.pinch ? gap < PINCH_OFF : gap < PINCH_ON);
    var fi = up(lm, 8, 5), fm = up(lm, 12, 9), fr = up(lm, 16, 13), fp = up(lm, 20, 17);
    var n = (fi ? 1 : 0) + (fm ? 1 : 0) + (fr ? 1 : 0) + (fp ? 1 : 0);
    if (S.pinch && !(fm && fr && fp && gap > PINCH_ON)) return 'pinch';
    if (n === 4) return 'palm';
    if (n === 0) return 'fist';
    if (fi && !fr && !fp) return 'point';
    return 'idle';
  }

  function handle(lm, t) {
    if (!lm) {
      if (!S.lostT) S.lostT = t;
      if (t - S.lostT > 400) {
        endPinch(false);
        S.mode = 'none'; S.anchor = null; S.raw = 'none'; S.rawN = 0; S.holdDone = false;
        ptr.style.display = 'none';
        status(S.paused ? 'Paused – open palm 1 s to resume' : 'Show your hand ✋');
      }
      return;
    }
    S.lostT = 0;
    var g = classify(lm);
    if (g === S.raw) S.rawN++; else { S.raw = g; S.rawN = 1; }
    var need = g === 'pinch' ? 2 : 3;          // debounce: gesture must be steady for a few frames
    var mode = S.rawN >= need ? g : S.mode;

    // ---- pause / resume holds
    if (mode === 'fist' && !S.paused) {
      if (S.mode !== 'fist') { S.fistT = t; S.holdDone = false; }
      if (!S.holdDone && t - S.fistT >= HOLD_MS) { S.paused = true; S.holdDone = true; toast('Gestures paused – hold an open palm for 1 second to resume', 3000); }
    }
    if (S.paused) {
      if (mode === 'palm') {
        if (S.mode !== 'palm') S.palmT = t;
        if (t - S.palmT >= HOLD_MS) { S.paused = false; S.anchor = null; toast('Gestures resumed', 1500); }
      }
      S.mode = mode;
      ptr.className = 'paused'; ptr.style.display = 'block'; ptrLbl.textContent = 'Paused';
      status('Paused – open palm 1 s to resume');
      return;
    }

    var hx = 1 - lm[8].x, hy = lm[8].y;          // mirrored index tip
    var cx = 1 - lm[9].x, cy = lm[9].y;          // mirrored palm centre

    if (mode !== 'pinch' && S.mode === 'pinch') endPinch(true);
    if (mode !== 'palm') S.anchor = null;

    if (mode === 'point' && g === 'point') {
      var tx = clamp((hx - 0.2) / 0.6, 0, 1) * innerWidth;
      var ty = clamp((hy - 0.15) / 0.6, 0, 1) * innerHeight;
      if (S.sx == null) { S.sx = tx; S.sy = ty; }
      S.sx += (tx - S.sx) * 0.35; S.sy += (ty - S.sy) * 0.35;
      S.px = S.sx; S.py = S.sy;
      S.hist.push({ t: t, x: S.px, y: S.py }); if (S.hist.length > 20) S.hist.shift();
      showPtr('', '');
      status('Pointer');
    } else if (mode === 'point') {
      showPtr('', '');
    } else if (mode === 'palm') {
      if (!S.anchor) S.anchor = { x: cx, y: cy };
      var dx = cx - S.anchor.x, dy = cy - S.anchor.y;
      var vx = Math.abs(dx) > DEAD ? clamp((dx - Math.sign(dx) * DEAD) * SCROLL_K, -SCROLL_MAX, SCROLL_MAX) : 0;
      var vy = Math.abs(dy) > DEAD ? clamp((dy - Math.sign(dy) * DEAD) * SCROLL_K, -SCROLL_MAX, SCROLL_MAX) : 0;
      var arrow = (vy < 0 ? '↑' : vy > 0 ? '↓' : '') + (vx < 0 ? '←' : vx > 0 ? '→' : '');
      if (vx || vy) scrollAt(S.px, S.py, vx, vy);
      showPtr('scroll', arrow ? 'Scroll ' + arrow : 'Scroll – move hand');
      status(arrow ? 'Scrolling ' + arrow : 'Scroll: move palm');
    } else if (mode === 'pinch') {
      if (S.mode !== 'pinch') {
        S.pinchT = t; S.pinchP = { x: hx, y: hy }; S.pinchZoomed = false;
        // closing the fingers drags the index tip - go back to where the pointer was just before
        for (var k = S.hist.length - 1; k >= 0; k--) { if (t - S.hist[k].t >= 200 || k === 0) { S.px = S.hist[k].x; S.py = S.hist[k].y; S.sx = S.px; S.sy = S.py; break; } }
        S.hist = [];
      }
      if (!S.pinchZoomed && t - S.pinchT > CLICK_MAX_MS) {
        S.pinchZoomed = true;
        var hit = deepHit(S.px, S.py);
        S.zoomDoc = hit ? hit.doc : document;
        S.zoomBase = getZoom(S.zoomDoc);
        S.zoomY0 = hy;
      }
      if (S.pinchZoomed) {
        var z = clamp(S.zoomBase * (1 + (S.zoomY0 - hy) * ZOOM_K), ZOOM_MIN, ZOOM_MAX);
        setZoom(S.zoomDoc, z);
        showPtr('zoom', 'Zoom ' + Math.round(z * 100) + '%');
        status('Zoom ' + Math.round(z * 100) + '% (move up/down)');
      } else {
        showPtr('pinch', '');
        status('Pinch…');
      }
    } else if (mode === 'fist') {
      showPtr('paused', 'Hold to pause');
      status('Fist – hold 1 s to pause');
    } else {
      showPtr('', '');
      status('Ready');
    }
    S.mode = mode;
  }

  function endPinch(fire) {
    if (!S.pinchP) return;
    var quick = performance.now() - S.pinchT <= CLICK_MAX_MS + 150;
    if (fire && !S.pinchZoomed && quick) clickAt(S.px, S.py);
    S.pinchP = null; S.pinchZoomed = false;
  }

  function showPtr(cls, label) {
    ptr.className = cls;
    ptr.style.display = 'block';
    ptr.style.transform = 'translate(' + Math.round(S.px) + 'px,' + Math.round(S.py) + 'px)';
    ptrLbl.textContent = label;
    ptrLbl.style.display = label ? 'block' : 'none';
  }

  // ---------------------------------------------------------------- actions (reach into same-origin iframes)
  function deepHit(x, y) {
    var doc = document, win = window, cx = x, cy = y, el = null;
    for (var depth = 0; depth < 6; depth++) {
      el = doc.elementFromPoint(cx, cy);
      if (!el) return null;
      if ((el.tagName === 'IFRAME' || el.tagName === 'FRAME')) {
        var inner = null;
        try { inner = el.contentDocument; } catch (e) { inner = null; }
        if (!inner || !inner.documentElement) break;
        var r = el.getBoundingClientRect();
        cx = cx - r.left - el.clientLeft; cy = cy - r.top - el.clientTop;
        doc = inner; win = el.contentWindow;
        continue;
      }
      break;
    }
    return { el: el, doc: doc, win: win, x: cx, y: cy };
  }

  function canScroll(el, axis, dir) {
    var w = el.ownerDocument.defaultView, st;
    var d = el.ownerDocument, isRoot = el === (d.scrollingElement || d.documentElement);
    if (!isRoot && (el === d.body || el === d.documentElement)) return false;   // page scrolling is handled via scrollingElement
    if (!isRoot) {
      try { st = w.getComputedStyle(el); } catch (e) { return false; }
      var ov = axis === 'y' ? st.overflowY : st.overflowX;
      if (!/(auto|scroll|overlay)/.test(ov)) return false;
    }
    if (axis === 'y') return dir < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    return dir < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  }

  function findScroller(hit, axis, dir) {
    var el = hit ? hit.el : null, doc = hit ? hit.doc : document;
    for (var guard = 0; guard < 8 && doc; guard++) {
      for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
        if (n.id === 'gc-panel') return null;
        if (canScroll(n, axis, dir)) return n;
      }
      var root = doc.scrollingElement || doc.documentElement;
      if (root && canScroll(root, axis, dir)) return root;
      var fe = null;
      try { fe = doc.defaultView && doc.defaultView.frameElement; } catch (e) { fe = null; }
      if (!fe) return null;
      el = fe; doc = fe.ownerDocument;
    }
    return null;
  }

  function scrollAt(x, y, vx, vy) {
    var hit = deepHit(x, y);
    if (vy) { var sy = findScroller(hit, 'y', vy); if (sy) sy.scrollTop += vy; }
    if (vx) { var sx = findScroller(hit, 'x', vx); if (sx) sx.scrollLeft += vx; }
  }

  function clickAt(x, y) {
    var rip = document.createElement('div');
    rip.className = 'gc-ripple';
    rip.style.left = x + 'px'; rip.style.top = y + 'px';
    document.body.appendChild(rip);
    setTimeout(function () { rip.remove(); }, 500);
    var hit = deepHit(x, y);
    if (!hit || !hit.el) return;
    var el = hit.el;
    if (el.closest && el.closest('#gc-panel')) { el.click(); return; }
    var a = el.closest ? el.closest('a[href]') : null;
    if (a && (a.target === '_blank' || /^https?:\/\/crm\.zoho/i.test(a.href)) && !/^javascript:/i.test(a.getAttribute('href') || '')) {
      var w = null;
      try { w = window.open(a.href, '_blank', 'noopener'); } catch (e) { w = null; }
      if (!w) toast('Browser blocked the new tab. Click the pop-up icon at the right of the address bar → "Always allow pop-ups" for this site, then pinch again.', 8000);
      return;
    }
    var o = { bubbles: true, cancelable: true, composed: true, view: hit.win, clientX: hit.x, clientY: hit.y, button: 0 };
    try {
      var PE = hit.win.PointerEvent || hit.win.MouseEvent;
      el.dispatchEvent(new PE('pointerdown', o));
      el.dispatchEvent(new hit.win.MouseEvent('mousedown', o));
      if (el.focus) { try { el.focus({ preventScroll: true }); } catch (e) {} }
      el.dispatchEvent(new PE('pointerup', o));
      el.dispatchEvent(new hit.win.MouseEvent('mouseup', o));
      el.dispatchEvent(new hit.win.MouseEvent('click', o));
    } catch (e) { try { el.click(); } catch (e2) {} }
  }

  function getZoom(doc) { var z = parseFloat(doc && doc.body && doc.body.style.zoom); return z > 0 ? z : 1; }
  function setZoom(doc, z) { if (doc && doc.body) doc.body.style.zoom = String(Math.round(z * 100) / 100); }
  function resetZoom() {
    setZoom(document, 1);
    var fr = document.querySelectorAll('iframe');
    for (var i = 0; i < fr.length; i++) { try { if (fr[i].contentDocument) setZoom(fr[i].contentDocument, 1); } catch (e) {} }
    toast('Zoom reset to 100%', 1500);
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    try {
      buildUI();
      var again = false;
      try { again = sessionStorage.getItem(SS_KEY) === '1'; } catch (e) {}
      if (again && navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'camera' }).then(function (p) { if (p.state === 'granted') start(); }).catch(function () {});
      }
    } catch (e) { if (window.console) console.warn('[gesture] init failed', e); }
  }
  window.GestureControl = { start: start, stop: function () { stop(true); }, _feed: handle, _state: S };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
