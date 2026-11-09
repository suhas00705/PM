/* table-scroll.js (09-Nov-2026) – every table in every dashboard tab scrolls inside its own box and its header row
 * stays frozen while scrolling (user request). Loaded into each tab by index.html (desktop portal AND mobile app).
 *   • desktop: box up to 68% of the screen (max 680 px)
 *   • app (html.app-mode): box up to 62% of the screen; tables the app shows as cards (.mx-cards) are left as cards
 * Tables in drawers / pop-ups are left alone. Safe to load twice.
 */
(function () {
  'use strict';
  var D = document;
  if (window.__dkScroll) return;
  window.__dkScroll = true;
  D.documentElement.classList.add('dkx');
  var css = D.createElement('style'); css.id = 'dk-scroll-css';
  // html.dkx … .dk-scroll.dk-scroll.dk-scroll = strong enough to beat the app's "no inner scroll boxes" rule
  css.textContent =
    'html.dkx .dk-scroll.dk-scroll.dk-scroll{max-height:min(68vh,680px)!important;overflow:auto!important;overscroll-behavior:contain;position:relative;-webkit-overflow-scrolling:touch}' +
    'html.dkx.app-mode .dk-scroll.dk-scroll.dk-scroll{max-height:62vh!important}' +
    'html.dkx.app-mode .dk-scroll.dk-scroll.dk-scroll:has(>table.mx-cards){max-height:none!important;overflow:visible!important}' +
    '.dk-scroll>table>thead{position:sticky;top:0;z-index:4}' +
    '.dk-scroll>table>tbody>tr.dk-h>th,.dk-scroll>table>tr.dk-h>th{position:sticky;top:0;z-index:4}' +
    '.dk-scroll::-webkit-scrollbar{width:10px;height:10px}.dk-scroll::-webkit-scrollbar-thumb{background:#c5d0e0;border-radius:6px}' +
    '.dk-scroll::-webkit-scrollbar-track{background:transparent}';
  (D.head || D.documentElement).appendChild(css);

  var SKIP = '.dr, .drawer, .modal, .modal-box, .modal-body, .modal-overlay, .pop, .pop-box, .ms-panel, .dk-skip, #ei-prof, #ei-more';
  function opaque(el) {                       // a frozen header needs a solid background, or the rows show through it
    var bg = getComputedStyle(el).backgroundColor;
    if (!bg || bg === 'transparent' || /rgba\(.*,\s*0\)$/.test(bg)) el.style.backgroundColor = '#f5f7fb';
  }
  function fix(t) {
    if (t.__dk || t.closest(SKIP) || !t.rows || !t.rows.length) return;
    if (t.parentElement && t.parentElement.closest('table')) return;      // table inside a table cell: the outer one scrolls
    var host = t.parentElement; if (!host) return;
    var onlyChild = host.children.length === 1 && /^(DIV|SECTION)$/.test(host.tagName) && !host.classList.contains('card');
    if (!onlyChild) { var w = D.createElement('div'); host.insertBefore(w, t); w.appendChild(t); host = w; }
    host.classList.add('dk-scroll');
    t.__dk = true;
    if (t.tHead) Array.prototype.forEach.call(t.tHead.querySelectorAll('th,td'), opaque);
    else { var r = t.rows[0]; if (r && r.querySelector('th')) { r.classList.add('dk-h'); Array.prototype.forEach.call(r.cells, opaque); } }
  }
  function run() {
    Array.prototype.forEach.call(D.querySelectorAll('table'), function (t) {
      if (t.__dk && !(t.parentElement && t.parentElement.classList.contains('dk-scroll'))) t.__dk = false;   // re-rendered
      fix(t);
    });
  }
  var timer = null;
  function later() { clearTimeout(timer); timer = setTimeout(run, 150); }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', run); else run();
  new MutationObserver(later).observe(D.body || D.documentElement, { childList: true, subtree: true });
})();
