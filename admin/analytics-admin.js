/**
 * Analitik Admin - KapalPro
 * ==========================
 * Tab "Analitik" di dashboard admin. Data diambil dari endpoint
 * /admin/api/analytics yang dilindungi Cloudflare Access (sesi login
 * email yang sama dengan panel ini) — tidak ada kunci di sisi klien.
 * Nilai dirender via textContent/createElement (CSP ketat, tanpa
 * innerHTML untuk data dinamis).
 */
(function () {
  'use strict';

  // ---- Tab switching -------------------------------------------------
  var tabs = document.querySelectorAll('.admin-tab');
  var loaded = false;
  tabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      tabs.forEach(function (b) { b.classList.toggle('is-active', b === btn); });
      ['tab-ads', 'tab-analytics'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.hidden = id !== btn.getAttribute('data-tab');
      });
      if (btn.getAttribute('data-tab') === 'tab-analytics' && !loaded) {
        loaded = true;
        load();
      }
    });
  });

  // ---- Helpers -------------------------------------------------------
  function fmt(n) { return Number(n || 0).toLocaleString('id-ID'); }
  function fmtBytes(b) {
    b = Number(b || 0);
    if (b > 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
    if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB';
    if (b > 1024) return (b / 1024).toFixed(1) + ' KB';
    return b + ' B';
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function table(elm, head, rows) {
    elm.textContent = '';
    var thead = el('thead'), tr = el('tr');
    head.forEach(function (h) { tr.appendChild(el('th', null, h)); });
    thead.appendChild(tr); elm.appendChild(thead);
    var tb = el('tbody');
    rows.forEach(function (r) {
      var tr2 = el('tr');
      r.forEach(function (c, i) { tr2.appendChild(el('td', i === 0 ? null : 'num', c)); });
      tb.appendChild(tr2);
    });
    elm.appendChild(tb);
  }
  function bars(elm, rows) {
    elm.textContent = '';
    if (!rows || !rows.length) { elm.appendChild(el('p', 'an-hint', 'Belum ada data.')); return; }
    var max = Math.max.apply(null, rows.map(function (r) { return r.count; }));
    rows.slice(0, 8).forEach(function (r) {
      var row = el('div', 'an-bar-row');
      row.appendChild(el('div', 'an-bar-label', r.name));
      var track = el('div', 'an-bar-track'), fill = el('div', 'an-bar-fill');
      fill.style.width = Math.max(2, Math.round(r.count / max * 100)) + '%';
      track.appendChild(fill); row.appendChild(track);
      row.appendChild(el('div', 'an-bar-num', fmt(r.count)));
      elm.appendChild(row);
    });
  }

  // ---- Load + render ---------------------------------------------------
  function load() {
    var status = document.getElementById('an-status');
    fetch('/admin/api/analytics', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error('Sesi login tidak valid. Muat ulang halaman dan login lagi.');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) {
        status.hidden = true;
        document.getElementById('an-content').hidden = false;
        if (d.generated_at) {
          document.getElementById('an-updated').textContent =
            'Diperbarui ' + new Date(d.generated_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
        }

        var s7 = d.totals.d7, s30 = d.totals.d30;
        var cards = [
          ['Page Views (7 hari)', fmt(s7.pageViews), '30 hari: ' + fmt(s30.pageViews)],
          ['Pengunjung Unik (7 hari)', fmt(s7.uniques), '30 hari: ' + fmt(s30.uniques)],
          ['Total Requests (7 hari)', fmt(s7.requests), '30 hari: ' + fmt(s30.requests)],
          ['Bandwidth (7 hari)', fmtBytes(s7.bytes), '30 hari: ' + fmtBytes(s30.bytes)]
        ];
        var wrap = document.getElementById('an-cards');
        wrap.textContent = '';
        cards.forEach(function (c) {
          var card = el('div', 'an-card');
          card.appendChild(el('div', 'an-card-label', c[0]));
          card.appendChild(el('div', 'an-card-value', c[1]));
          card.appendChild(el('div', 'an-card-sub', c[2]));
          wrap.appendChild(card);
        });

        var chart = document.getElementById('an-chart');
        chart.textContent = '';
        var daily = d.daily; // API: urut kronologis menaik
        var max = Math.max.apply(null, daily.map(function (x) { return x.pageViews; }).concat([1]));
        var step = Math.ceil(daily.length / 6);
        var labels = [];
        daily.forEach(function (day, i) {
          var bar = el('div', 'an-bar');
          var h = Math.max(1, Math.round(day.pageViews / max * 100));
          bar.style.height = h + '%';
          bar.title = day.date + ' — ' + fmt(day.pageViews) + ' views, ' + fmt(day.uniques) + ' unik';
          chart.appendChild(bar);
          labels.push(i % step === 0 || i === daily.length - 1 ? day.date.slice(5) : '');
        });
        var xl = document.getElementById('an-xlabels');
        xl.textContent = '';
        labels.forEach(function (t) { xl.appendChild(el('span', null, t)); });

        table(document.getElementById('an-vessel-table'), ['Halaman', 'Views'],
          d.top_vessel_pages.map(function (r) { return [r.path, fmt(r.views)]; }));
        table(document.getElementById('an-pages-table'), ['Halaman', 'Views'],
          d.top_pages.map(function (r) { return [r.path, fmt(r.views)]; }));
        bars(document.getElementById('an-countries'), d.top_countries);
        bars(document.getElementById('an-browsers'), d.top_browsers);
      })
      .catch(function (e) {
        status.hidden = false;
        status.textContent = 'Gagal memuat analitik: ' + e.message;
      });
  }
})();
