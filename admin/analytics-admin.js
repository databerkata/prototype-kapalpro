/**
 * Analitik Admin - KapalPro
 * ==========================
 * Tab "Analitik" di dashboard admin. Data dari endpoint /admin/api/analytics
 * (digerbang kunci Worker yang sama dengan panel ini; cookie sesi).
 * Sumber data: agregasi Cloudflare GraphQL tiap 1 jam (aggregate.py -> KV).
 * Semua nilai dirender via textContent/createElement (CSP ketat).
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
    if (!rows.length) {
      var trE = el('tr'), tdE = el('td', null, 'Belum ada data.');
      tdE.colSpan = head.length; trE.appendChild(tdE); tb.appendChild(trE);
    }
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
    var max = Math.max.apply(null, rows.map(function (r) { return r.count; }).concat([1]));
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
  // Grafik batang vertikal generik. rows: [{label, value, title}]
  function vchart(chartEl, labelEl, rows, labelEvery) {
    chartEl.textContent = ''; labelEl.textContent = '';
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
    rows.forEach(function (r, i) {
      var bar = el('div', 'an-bar');
      bar.style.height = Math.max(1, Math.round(r.value / max * 100)) + '%';
      bar.title = r.title;
      chartEl.appendChild(bar);
      labelEl.appendChild(el('span', null,
        (i % labelEvery === 0 || i === rows.length - 1) ? r.label : ''));
    });
  }

  // ---- State + render --------------------------------------------------
  var DATA = null;
  var period = '7';

  function renderPeriod() {
    var d = DATA, p30 = period === '30';
    document.querySelectorAll('.an-per-label').forEach(function (s) {
      s.textContent = p30 ? '30 hari' : '7 hari';
    });
    document.querySelectorAll('.an-period-btn').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-period') === period);
    });
    table(document.getElementById('an-vessel-table'), ['Halaman', 'Views'],
      (p30 ? d.top_vessel_pages_30 : d.top_vessel_pages).map(function (r) { return [r.path, fmt(r.views)]; }));
    table(document.getElementById('an-pages-table'), ['Halaman', 'Views'],
      (p30 ? d.top_pages_30 : d.top_pages).map(function (r) { return [r.path, fmt(r.views)]; }));
    bars(document.getElementById('an-countries'), p30 ? d.top_countries_30 : d.top_countries);
    bars(document.getElementById('an-browsers'), p30 ? d.top_browsers_30 : d.top_browsers);
    bars(document.getElementById('an-devices'), p30 ? d.devices_30 : d.devices_7);
    bars(document.getElementById('an-os'), p30 ? d.os_30 : d.os_7);
    bars(document.getElementById('an-status-bars'), p30 ? d.status_30 : d.status_7);
  }

  function render(d) {
    DATA = d;
    document.getElementById('an-status').hidden = true;
    document.getElementById('an-content').hidden = false;
    if (d.generated_at) {
      document.getElementById('an-updated').textContent =
        'Diperbarui ' + new Date(d.generated_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
    }

    var t = d.today, s7 = d.totals.d7, s30 = d.totals.d30;
    var cards = [
      ['Page Views (hari ini)', fmt(t.pageViews), 'Requests ' + fmt(t.requests) + ' · Unik ' + fmt(t.uniques)],
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

    vchart(document.getElementById('an-hourly-chart'), document.getElementById('an-hourly-labels'),
      d.hourly_today.map(function (h) {
        return { label: h.hour.slice(0, 2), value: h.pageViews,
          title: 'Jam ' + h.hour + ' WIB — ' + fmt(h.pageViews) + ' views, ' + fmt(h.uniques) + ' unik, ' + fmt(h.requests) + ' requests' };
      }), 3);

    vchart(document.getElementById('an-chart'), document.getElementById('an-xlabels'),
      d.daily.map(function (day) {
        return { label: day.date.slice(5), value: day.pageViews,
          title: day.date + ' — ' + fmt(day.pageViews) + ' views, ' + fmt(day.uniques) + ' unik' };
      }), 5);

    renderPeriod();
  }

  document.querySelectorAll('.an-period-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      period = b.getAttribute('data-period');
      if (DATA) renderPeriod();
    });
  });

  function load() {
    var status = document.getElementById('an-status');
    fetch('/admin/api/analytics', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error('Sesi kunci tidak valid. Muat ulang halaman dan buka kunci lagi.');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(render)
      .catch(function (e) {
        status.hidden = false;
        status.textContent = 'Gagal memuat analitik: ' + e.message;
      });
  }
})();
