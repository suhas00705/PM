/* Elmeasure Insights – mobile layer for every dashboard tab (25-Oct-2026)
 * Injected by the app shell (mobile-app.js) into each tab's iframe, ONLY inside the Android app.
 * The laptop / desktop portal never loads this file, so it is not affected.
 *
 * What it does on a phone:
 *  • sections fold (tap a heading); the first ones start open, the rest closed
 *  • explanations (grey sub-text) hidden behind a small ⓘ on each section
 *  • filters folded behind one "Filters" button
 *  • wide tables show only the key columns (tap "All columns" for the full table);
 *    list tables (leads, deals, accounts) become easy-to-read cards
 *  • long tables show the first rows with "Show more"
 *  • first column stays fixed while a table scrolls sideways; charts scroll sideways with a hint
 */
(function () {
  'use strict';
  if (window.__mx) return; window.__mx = true;
  var D = document, KEY = (window.frameElement && window.frameElement.id) || location.pathname;

  /* ---------- per-tab settings ----------
   * keep:  column numbers (0 = first) shown in the compact view
   * cards: show rows as cards; title = column number used as the card title
   * rows:  rows shown before "Show more"
   * open:  how many sections start open                                              */
  var CFG = {
    'frame-leads':      { open: 9, tables: { leadsTable: { cards: true, title: 1, rows: 15 } } },
    'frame-potentials': { open: 9, tables: { potentialsTable: { cards: true, title: 1, keep: [0, 1, 2, 3, 5, 6], rows: 15 } } },
    'frame-pmtracking': { open: 2, tables: {
        mainTable: { keep: [0, 4, 5, 8] }, sTable: { keep: [0, 2, 3, 4], rows: 15 }, gTable2: { rows: 15 } } },
    'frame-oemtracking': { open: 2, tables: { gTable: { keep: [0, 1, 2, 3], rows: 15 }, cTable: { keep: [0, 3, 4, 5], rows: 15 } } },
    'frame-salestracking': { open: 2, tables: {
        rTable: { keep: [0, 1, 3, 5], rows: 15 }, eTable: { keep: [0, 2, 4, 6], rows: 15 }, fpTable: { keep: [0, 6, 7], rows: 15 } } },
    'frame-cpanalytics': { open: 2, tables: {
        basketTable: { keep: [0, 2, 3, 7, 8] }, regionTable: { keep: [0, 2, 3, 5, 6], rows: 15 }, partnerTable: { keep: [0, 1, 3, 4, 8], rows: 15 } } },
    'frame-pathtarget': { open: 2, order: ['secHead', 'secReg', 'secProd', 'secPath', 'secPipe', 'secDem', 'secAcc', 'secPro', 'secMx', 'secCh'], tables: {
        monthTbl: { keep: [0, 3, 4, 5] }, prodTbl: { keep: [0, 1, 5, 7] }, regTbl: { keep: [0, 1, 5, 7], rows: 15 },
        mxTbl: { keep: [0, 11, 13], rows: 15 }, chTbl: { keep: [0, 1, 3, 4] }, proTbl: { keep: [0, 1, 2, 3, 10], rows: 15 },
        proMon: { rows: 15 }, demBody: { keep: [0, 1, 2, 5, 7], rows: 15 }, pipeTbl: { keep: [0, 2, 4, 5], rows: 15 },
        accTbl: { cards: true, title: 1, keep: [1, 2, 4, 5, 7, 8], rows: 12 } } },
    'frame-lvs': { open: 2, tables: {
        projTbl: { keep: [0, 2, 8, 9, 10, 11], rows: 15 }, powTbl: { keep: [0, 1, 3, 4, 8] }, poTbl: { keep: [0, 2, 10, 14, 15, 16], rows: 15 } } },
    'frame-regiontrack': { open: 9, tables: { league: { keep: [0, 1, 2, 3, 7], rows: 30 } } },
    'frame-control': { open: 9, tables: { rows: { cards: true, title: 1, keep: [1, 2, 3, 4, 5, 10] }, pRows: { cards: true, title: 1, keep: [1, 2, 3, 4, 5, 9] } } }
  };
  var C = CFG[KEY] || { open: 3, tables: {} };
  var DEFAULT_ROWS = 20;

  function txt(e) { return (e && (e.innerText || e.textContent) || '').replace(/\s+/g, ' ').trim(); }
  function el(tag, cls, html) { var e = D.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  /* ---------- tables ---------- */
  function headerRow(t) {
    if (t.tHead && t.tHead.rows.length) return t.tHead.rows[t.tHead.rows.length - 1];
    var r = t.rows[0]; return r && r.querySelector('th') ? r : null;
  }
  function tableCfg(t) {
    var ids = [];
    for (var n = t; n && n !== D.body; n = n.parentElement) if (n.id) ids.push(n.id);
    if (t.tBodies[0] && t.tBodies[0].id) ids.unshift(t.tBodies[0].id);
    for (var i = 0; i < ids.length; i++) if (C.tables[ids[i]]) return { id: ids[i], c: C.tables[ids[i]] };
    return { id: ids[0] || '', c: {} };
  }
  var showAll = {}, showRows = {};
  function doTable(t) {
    if (t.closest('.mx-skip') || t.closest('.modal-body') || t.offsetParent === null && !t.closest('.mx-closed')) { /* hidden now: handled when shown */ }
    var hr = headerRow(t); if (!hr) return;
    var tc = tableCfg(t), c = tc.c, id = tc.id || ('t' + Array.prototype.indexOf.call(D.querySelectorAll('table'), t));
    var heads = Array.prototype.map.call(hr.cells, txt);
    var simple = !Array.prototype.some.call(hr.cells, function (x) { return x.colSpan > 1; }) && !(t.tHead && t.tHead.rows.length > 1);
    var compact = c.keep && simple && !showAll[id];
    var cards = c.cards && simple;
    t.classList.add('mx-t');
    t.classList.toggle('mx-cards', !!cards);
    var keep = {}; (c.keep || []).forEach(function (k) { keep[k] = 1; });
    var bodyRows = [];
    Array.prototype.forEach.call(t.rows, function (r) {
      var isHead = r === hr || (r.parentElement && r.parentElement.tagName === 'THEAD');
      if (!isHead) bodyRows.push(r);
      if (!simple) return;
      Array.prototype.forEach.call(r.cells, function (cell, i) {
        var hide = !!(compact && !keep[i]);   // must be true/false: toggle(x, undefined) flips the class on every run
        if (cell.classList.contains('mx-h') !== hide) cell.classList.toggle('mx-h', hide);
        if (cards && !isHead) {
          if (cell.getAttribute('data-l') !== heads[i]) cell.setAttribute('data-l', heads[i] || '');
          cell.classList.toggle('mx-title', i === c.title);
        }
      });
    });
    // rows: first N, then "Show more"
    var limit = showRows[id] || c.rows || DEFAULT_ROWS, data = bodyRows.filter(function (r) { return r.cells.length > 1 || bodyRows.length < 3; });
    var total = data.length;
    data.forEach(function (r, i) { var h = i >= limit; if (r.classList.contains('mx-more') !== h) r.classList.toggle('mx-more', h); });
    // toolbar under / above the table
    var host = t.parentElement;
    var bar = host.querySelector(':scope > .mx-tbar[data-for="' + id + '"]');
    var need = (c.keep && simple) || total > limit;
    if (!need) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = el('div', 'mx-tbar'); bar.setAttribute('data-for', id);
      host.insertBefore(bar, t.nextSibling);
      bar.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.dataset.a === 'cols') showAll[id] = !showAll[id];
        if (b.dataset.a === 'more') showRows[id] = (showRows[id] || c.rows || DEFAULT_ROWS) + (c.cards ? 25 : 40);
        if (b.dataset.a === 'less') showRows[id] = 0;
        run();
      });
    }
    var html = '';
    if (total > limit) html += '<button data-a="more">Show more (' + (total - limit) + ' left)</button>';
    else if (showRows[id] && total > (c.rows || DEFAULT_ROWS)) html += '<button data-a="less">Show less</button>';
    if (c.keep && simple) html += '<button data-a="cols">' + (showAll[id] ? 'Key columns only' : 'All columns (' + heads.length + ')') + '</button>';
    if (bar.innerHTML !== html) bar.innerHTML = html;
  }

  /* ---------- sections fold ---------- */
  var secState = {};
  try { secState = JSON.parse(sessionStorage.getItem('mxSec:' + KEY) || '{}'); } catch (e) {}
  function saveSec() { try { sessionStorage.setItem('mxSec:' + KEY, JSON.stringify(secState)); } catch (e) {} }
  var secCount = {};
  function doSections() {
    var cards = D.querySelectorAll('.card, .table-card, .sec');
    Array.prototype.forEach.call(cards, function (card) {
      if (card.__mx || card.closest('.pop, .drawer, .dr, .modal, #lock, .mx-skip, .mx-sec') || card.classList.contains('tile')) return;
      var h2 = card.querySelector(':scope > h2, :scope > .card-h h2, :scope > div > h2, :scope > .card-h > div > h2, :scope > .sec-h h2');
      if (!h2) return;
      var head = h2; while (head.parentElement && head.parentElement !== card) head = head.parentElement;
      card.__mx = true;
      // sections are counted per view (e.g. LVS "Material planning" and "OB / Stock"), so each view opens its first ones
      var view = card.closest('.wrap > [id], body > [id]') || D.body, vk = view.id || 'body';
      var idx = secCount[vk] = (secCount[vk] || 0) + 1;
      var key = (h2.id || txt(h2)).slice(0, 40);
      card.classList.add('mx-sec');
      head.classList.add('mx-head');
      // chevron and ⓘ sit on the card (not inside the heading, which some pages rewrite)
      var tog = el('span', 'mx-chev', '▾'); card.appendChild(tog);
      if (card.querySelector('.sub, .note')) {
        var info = el('button', 'mx-info', 'ⓘ'); info.title = 'Show notes';
        card.appendChild(info);
        info.addEventListener('click', function (e) { e.stopPropagation(); card.classList.toggle('mx-notes'); });
      }
      var closed = secState[key] != null ? secState[key] : idx > (C.open || 3);
      card.classList.toggle('mx-closed', closed);
      function flip(e) {
        if (e.target.closest('button:not(.mx-info):not(.mx-chev), select, input, a, .toggle, .seg')) return;
        var c2 = !card.classList.contains('mx-closed'); card.classList.toggle('mx-closed', c2);
        secState[key] = c2; saveSec(); if (!c2) run();
      }
      head.addEventListener('click', flip); tog.addEventListener('click', flip);
    });
  }

  /* ---------- filters behind one button ---------- */
  function doFilters() {
    var boxes = D.querySelectorAll('.bar .ctrls, body > .wrap > .filters, .wrap > .filters, .head ~ .filters');
    Array.prototype.forEach.call(boxes, function (f) {
      if (f.__mx || f.id === 'filters' && D.getElementById('filtersToggleBtn')) return;     // leads / potentials have their own button
      f.__mx = true; f.classList.add('mx-fbox', 'mx-fclosed');
      var b = el('button', 'mx-fbtn', '⚙︎ Filters <span>▾</span>');
      f.parentElement.insertBefore(b, f);
      b.addEventListener('click', function () { var o = f.classList.toggle('mx-fclosed'); b.classList.toggle('on', !o); });
    });
  }

  /* ---------- charts: swipe hint ---------- */
  function doCharts() {
    Array.prototype.forEach.call(D.querySelectorAll('.chart, .chartbox, .chart-wrap'), function (c) {
      if (!c.querySelector('svg')) return;
      if (!c.__mx) {
        c.__mx = true; c.classList.add('mx-chart');
        c.addEventListener('scroll', function () { if (c.__auto) { c.__auto = false; return; } c.classList.add('mx-swiped'); }, { passive: true });
      }
      // open on the latest months (right-hand end) until the user swipes
      if (!c.classList.contains('mx-swiped') && c.scrollWidth > c.clientWidth + 4 && c.scrollLeft < c.scrollWidth - c.clientWidth - 4) {
        c.__auto = true; c.scrollLeft = c.scrollWidth;
      }
    });
  }
  /* ---------- most useful sections first (per tab) ---------- */
  var ordered = false;
  function doOrder() {
    if (ordered || !C.order) return;
    var els = C.order.map(function (id) { return D.getElementById(id); }).filter(Boolean);
    if (els.length < 2) return;
    var parent = els[0].parentElement;
    if (els.some(function (e) { return e.parentElement !== parent; })) return;
    ordered = true;
    var anchor = els[0];
    els.slice(1).forEach(function (e) { parent.insertBefore(e, anchor.nextSibling); anchor = e; });
  }

  /* ---------- download / CSV buttons are not useful in the app ---------- */
  function doButtons() {
    Array.prototype.forEach.call(D.querySelectorAll('button, a.btn'), function (b) {
      if (b.__mxb) return; b.__mxb = true;
      if (/\bcsv\b|download/i.test(txt(b)) && !b.closest('.mx-tbar')) b.classList.add('mx-hide');
    });
  }
  /* ---------- section links (e.g. Path to Target) open the section they point to ---------- */
  D.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]'); if (!a) return;
    var t = D.getElementById(a.getAttribute('href').slice(1)); if (!t) return;
    var sec = t.classList.contains('mx-sec') ? t : t.closest('.mx-sec');
    if (sec && sec.classList.contains('mx-closed')) { sec.classList.remove('mx-closed'); run(); }
  }, true);

  var busy = false, timer = null;
  function run() {
    if (busy) return; busy = true;
    try {
      doOrder(); doSections(); doFilters(); doCharts(); doButtons();
      Array.prototype.forEach.call(D.querySelectorAll('table'), function (t) { try { doTable(t); } catch (e) {} });
    } finally { busy = false; }
  }
  function later() { clearTimeout(timer); timer = setTimeout(run, 150); }
  new MutationObserver(function (ms) {
    if (busy) return;
    for (var i = 0; i < ms.length; i++) {
      var t = ms[i].target;
      if (t.nodeType === 1 && (t.classList.contains('mx-tbar') || (t.closest && t.closest('.mx-tbar')))) continue;
      return later();
    }
  }).observe(D.body, { childList: true, subtree: true });
  run();
})();
