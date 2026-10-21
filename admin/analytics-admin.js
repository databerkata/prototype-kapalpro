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
  // showValues=true: angka nilai tampil di atas tiap batang.
  function vchart(chartEl, labelEl, rows, labelEvery, showValues) {
    chartEl.textContent = ''; labelEl.textContent = '';
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
    rows.forEach(function (r, i) {
      var pct = Math.max(1, Math.round(r.value / max * 100));
      if (showValues) {
        var col = el('div', 'an-col');
        var val = el('div', 'an-bar-val', fmt(r.value));
        val.style.bottom = pct + '%';
        var barIn = el('div', 'an-bar');
        barIn.style.height = pct + '%';
        barIn.title = r.title;
        col.appendChild(val); col.appendChild(barIn);
        chartEl.appendChild(col);
      } else {
        var bar = el('div', 'an-bar');
        bar.style.height = pct + '%';
        bar.title = r.title;
        chartEl.appendChild(bar);
      }
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
    table(document.getElementById('an-pages-table'), ['Halaman', 'Views'],
      (p30 ? d.top_pages_30 : d.top_pages).map(function (r) { return [r.path, fmt(r.views)]; }));
    bars(document.getElementById('an-countries'), p30 ? d.top_countries_30 : d.top_countries);
    bars(document.getElementById('an-devices'), p30 ? d.devices_30 : d.devices_7);
    bars(document.getElementById('an-status-bars'), p30 ? d.status_30 : d.status_7);
  }

  function fmtPrice(p) {
    if (p == null || p === '') return 'Hubungi Kami';
    p = Number(p);
    if (isNaN(p)) return String(p);
    if (p >= 1e9) { var m = p / 1e9; return 'Rp ' + (Math.round(m * 10) / 10).toLocaleString('id-ID') + ' M'; }
    if (p >= 1e6) return 'Rp ' + Math.round(p / 1e6).toLocaleString('id-ID') + ' jt';
    return 'Rp ' + fmt(p);
  }
  function statusLabel(s) {
    return { available: 'Tersedia', sold: 'Terjual', reserved: 'Direservasi' }[s] || (s || '-');
  }

  function renderContact(d) {
    var wrap = document.getElementById('an-contact-cards');
    var leadLine = document.getElementById('an-lead-line');
    wrap.textContent = '';
    var c = d.contact || { wa: {}, tel: {} };
    var f = d.forms || {};
    function card(label, value) {
      var cd = el('div', 'an-card');
      cd.appendChild(el('div', 'an-card-label', label));
      cd.appendChild(el('div', 'an-card-value', value));
      wrap.appendChild(cd);
    }
    card('Klik WhatsApp', fmt(c.wa.d7));
    if (f.error) {
      card('Formulir Inquiry', '-');
      card('Pesan Kontak', '-');
      leadLine.textContent = '';
      leadLine.className = 'an-lead-line';
    } else {
      card('Formulir Inquiry', fmt(f.inquiry.real));
      card('Pesan Kontak', fmt(f.contact.real));
      var totalLeads = Number(c.wa.d30 || 0) +
        Number(f.inquiry.real || 0) + Number(f.contact.real || 0);
      if (totalLeads > 0) {
        var actions = [];
        if (Number(c.wa.d30 || 0) > 0) actions.push('cek WhatsApp');
        if (Number(f.inquiry.real || 0) + Number(f.contact.real || 0) > 0) actions.push('cek formulir masuk');
        leadLine.textContent = 'Ada calon pembeli yang sudah menghubungi: ' + actions.join(' · ') + '.';
        leadLine.className = 'an-lead-line an-lead-ok';
      } else {
        leadLine.textContent = 'Belum ada calon pembeli yang menghubungi.';
        leadLine.className = 'an-lead-line an-lead-zero';
      }
    }
  }

  function renderVessels(d) {
    table(document.getElementById('an-vessels-table'),
      ['Kapal', 'Status', 'Harga', 'Dilihat 7 hari', 'Dilihat 30 hari', 'Inquiry', 'Klik'],
      (d.vessels || []).map(function (v) {
        return [
          (v.name || v.id) + ' (' + v.id + ')',
          statusLabel(v.status),
          fmtPrice(v.price),
          fmt(v.views7), fmt(v.views30), fmt(v.inquiries), fmt(v.clicks30)
        ];
      }));
  }

  function renderClickRecent(d) {
    var box = document.getElementById('an-click-recent');
    box.textContent = '';
    ((d.contact || {}).recent || []).slice(0, 5).forEach(function (ev) {
      box.appendChild(el('div', 'an-recent-row', ev.label + ' · ' + ev.ch + ' · ' + ev.src));
    });
  }

  function renderSources(d) {
    var w = d.web_analytics || {};
    var total = document.getElementById('an-source-total');
    total.textContent = w.d7 ? fmt(w.d7) + ' kunjungan browser asli · minggu ini' : '';
    bars(document.getElementById('an-sources'), w.referrers || []);
  }

  function renderSplit(d) {
    var s = (d.traffic_split || {}).d7;
    var donut = document.getElementById('an-donut');
    var pct = document.getElementById('an-donut-pct');
    var legend = document.getElementById('an-donut-legend');
    legend.textContent = '';
    if (!s) { pct.textContent = '-'; legend.textContent = 'Belum ada data.'; return; }
    var segs = [['Manusia', s.human_pct, '#0e5aa8'], ['Abu-abu', s.grey_pct, '#b8c9da'],
      ['Robot', s.bot_pct, '#374151']].filter(function (x) { return x[1] > 0; });
    var acc = 0, stops = [];
    segs.forEach(function (x) {
      stops.push(x[2] + ' ' + acc + '% ' + (acc + x[1]) + '%');
      acc += x[1];
    });
    donut.style.background = 'conic-gradient(' + stops.join(', ') + ')';
    pct.textContent = s.human_pct + '%';
    segs.forEach(function (x) {
      var row = el('div', null);
      var dot = el('span', 'an-dot');
      dot.style.background = x[2];
      row.appendChild(dot);
      row.appendChild(document.createTextNode(x[0] + ' ' + x[1] + '%'));
      legend.appendChild(row);
    });
  }

  function renderTop5(d) {
    var wrap = document.getElementById('an-top5');
    wrap.textContent = '';
    var vs = (d.vessels || []).slice()
      .sort(function (a, b) { return (b.views30 || 0) - (a.views30 || 0); })
      .slice(0, 5);
    if (!vs.length) { wrap.appendChild(el('p', 'an-hint', 'Belum ada data.')); return; }
    var max = Math.max.apply(null, vs.map(function (v) { return v.views30 || 0; }).concat([1]));
    vs.forEach(function (v, i) {
      var row = el('div', 'an-top-row');
      row.appendChild(el('div', 'an-top-rank', String(i + 1)));
      var main = el('div', 'an-top-main');
      var nameLine = el('div', 'an-top-name', (v.name || v.id) + ' ');
      nameLine.appendChild(el('span', 'an-top-code', v.id));
      if (v.status === 'sold') nameLine.appendChild(el('span', 'an-top-sold', 'Terjual'));
      main.appendChild(nameLine);
      var sub = fmtPrice(v.price);
      if (Number(v.inquiries || 0) > 0) sub += ' · ' + fmt(v.inquiries) + ' orang bertanya soal kapal ini';
      main.appendChild(el('div', 'an-top-sub', sub));
      var track = el('div', 'an-bar-track'), fill = el('div', 'an-bar-fill');
      fill.style.width = Math.max(2, Math.round((v.views30 || 0) / max * 100)) + '%';
      track.appendChild(fill); main.appendChild(track);
      row.appendChild(main);
      var num = el('div', 'an-top-num', fmt(v.views30));
      num.appendChild(el('span', null, 'dilihat'));
      row.appendChild(num);
      wrap.appendChild(row);
    });
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
    var yest = d.daily[d.daily.length - 2] || t;
    var cards = [
      ['Kemarin', fmt(yest.pageViews)],
      ['Minggu Ini', fmt(s7.pageViews)],
      ['Bulan Ini', fmt(s30.pageViews)]
    ];
    var wrap = document.getElementById('an-cards');
    wrap.textContent = '';
    cards.forEach(function (c) {
      var card = el('div', 'an-card');
      card.appendChild(el('div', 'an-card-label', c[0]));
      card.appendChild(el('div', 'an-card-value', c[1]));
      wrap.appendChild(card);
    });

    vchart(document.getElementById('an-chart14'), document.getElementById('an-xlabels14'),
      d.daily.slice(-14).map(function (day) {
        return { label: day.date.slice(5), value: day.pageViews,
          title: day.date + ' · dibuka ' + fmt(day.pageViews) + ' kali, ' + fmt(day.uniques) + ' pengunjung' };
      }), 3, true);

    renderSplit(d);
    renderTop5(d);

    vchart(document.getElementById('an-hourly-chart'), document.getElementById('an-hourly-labels'),
      d.hourly_today.map(function (h) {
        return { label: h.hour.slice(0, 2), value: h.pageViews,
          title: 'Jam ' + h.hour + ' WIB · ' + fmt(h.pageViews) + ' views, ' + fmt(h.uniques) + ' unik, ' + fmt(h.requests) + ' requests' };
      }), 3);

    renderPeriod();
    renderContact(d);
    renderClickRecent(d);
    renderSources(d);
    renderVessels(d);
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

  // Tab Analitik adalah tab default: muat data langsung saat halaman dibuka.
  var defaultBtn = document.querySelector('.admin-tab.is-active');
  if (defaultBtn && defaultBtn.getAttribute('data-tab') === 'tab-analytics' && !loaded) {
    loaded = true;
    load();
  }
})();
