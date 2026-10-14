/**
 * Perbandingan Kapal - KapalPro
 * =============================
 *
 * WHY fitur ini ada: shortlist tanpa cara meletakkan kapal-kapalnya
 * berdampingan hampir tidak berguna. Pembeli kapal tidak membeli
 * berdasarkan nama - mereka membandingkan angka. Kapal A 32 meter
 * 1.500 DWT seawaktu Rp 6 miliar versus kapal B 40 meter 2.200 DWT
 * seawaktu Rp 11 miliar adalah keputusan yang harus dilihat dalam satu
 * layar, bukan dibayangkan dari dua tab terpisah.
 *
 * WHY batas 3 kolom: lebih dari tiga kapal membuat tabel mendatar
 * sehingga tidak bisa dibaca di ponsel tanpa sengaja menggulir
 * horizontal. Tiga kolom muat di 390px kalau nama kapal dibungkus,
 * dan tiga sudah cukup untuk sebagian besar keputusan beli kapal.
 *
 * WHY tanpa server: sama seperti shortlist, pemilihan kolom ini
 * keputusan sementara milik satu perangkat. Menyimpannya di server
 * butuh akun, dan akun adalah hambatan di jalur konversi.
 *
 * BAGIAN MURNI (buildRows, bestIndex, pickDefaults) sengaja tidak
 * menyentuh DOM supaya bisa diuji tanpa browser. Lihat
 * tests/compare.test.js.
 */
(function () {
  'use strict';

  // WHY 3: lihat catatan di atas file ini.
  var MAX = 3;

  /**
   * Definisi baris tabel perbandingan.
   *
   * `better` menentukan penanda "Terbaik":
   *   'min'  - nilai lebih kecil lebih baik (harga, tahun, draft)
   *   'max'  - nilai lebih besar lebih baik (panjang, tonase, DWT)
   *   null   - tidak ada nilai yang secara umum lebih baik
   *
   * WHY beberapa baris sengaja dibiarkan null: "mesin terbaik" dan "lokasi terbaik" bukan aturan umum. Menandai salah satunya sebagai
   * terbaik akan mengarang kesimpulan yang tidak bisa dipertanggungjawabkan,
   * dan pembeli kapal sudah tahu bahwa itu penilaian mereka sendiri.
   */
  var ROWS = [
    { key: 'price', labelKey: 'compare.specPrice', better: 'min', format: 'price' },
    { key: 'year_built', labelKey: 'compare.specYear', better: 'max' },
    { key: 'type', labelKey: 'compare.specType', better: null, format: 'type' },
    { key: 'length', labelKey: 'compare.specLength', better: 'max', unit: 'm' },
    { key: 'beam', labelKey: 'compare.specBeam', better: null, unit: 'm' },
    { key: 'depth', labelKey: 'compare.specDepth', better: null, unit: 'm' },
    { key: 'draft', labelKey: 'compare.specDraft', better: null, unit: 'm' },
    { key: 'gross_tonnage', labelKey: 'compare.specGt', better: 'max', unit: 'GT' },
    { key: 'net_tonnage', labelKey: 'compare.specNt', better: null, unit: 'NT' },
    { key: 'dwt', labelKey: 'compare.specDwt', better: 'max', unit: 'DWT' },
    { key: 'engine_type', labelKey: 'compare.specEngine', better: null },
    { key: 'engine_power', labelKey: 'compare.specPower', better: null },
    { key: 'speed_knots', labelKey: 'compare.specSpeed', better: 'max', unit: 'kn' },
    { key: 'fuel_type', labelKey: 'compare.specFuel', better: null },
    // WHY drydock dikumpulkan bersama bahan bakar, bukan di akhir:
    // keduanya menjawab pertanyaan "seberapa siap kapal ini
    // dipakai", bukan sekadar ukuran atau tahun pembuatannya.
    { key: 'last_dock', labelKey: 'compare.specLastDock', better: null, format: 'lastdock' },
    { key: 'flag_state', labelKey: 'compare.specFlag', better: null },
    { key: 'classification', labelKey: 'compare.specClass', better: null },
    { key: 'location', labelKey: 'compare.specLocation', better: null },
    { key: 'status', labelKey: 'compare.specStatus', better: null, format: 'status' }
  ];

  /**
   * Angka satu baris, atau null kalau tidak ada / tidak bisa diurai.
   *
   * WHY menolak nilai 0 dan string kosong: DWT 0 dan tahun 0 bukan
   * data, dan membandingkan "0" sebagai yang terbaik akan
   * menandai kapal yang tidak punya data sebagaihmenang. Ini baru
   * terjadi karena DWT baru terisi di 5 dari 15 kapal.
   */
  function numeric(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) && v > 0 ? v : null;
    if (typeof v === 'string') {
      // WHY parseFloat dan bukan Number(): data kapal kadang berisi
      // "7500 DWT" atau "46.83 m". Number() akan mengembalikan NaN
      // dan kapal dengan data yang bisa dibaca akan ikut tersaring.
      var n = parseFloat(v.replace(/[^0-9.]/g, ''));
      return isFinite(n) && n > 0 ? n : null;
    }
    return null;
  }

  /**
   * Indeks nilai terbaik pada satu baris, atau -1 kalau tidak ada.
   *
   * WHY mengembalikan indeks, bukan nilai: ketika dua kapal seri
   * (misalnya dua kapal tahun 2018 dengan harga sama), hanya kolom
   * pertama yang ditandai. Menandai keduanya berarti "terbaik" tidak
   * lagi berarti apa pun, dan tabel jadi lebih ramai tanpa
   * menambah informasi.
   *
   * WHY -1 kalau hanya satu nilai valid: satu kolom tidak sedang
   * dibandingkan dengan siapa pun, jadi tidak ada yang lebih baik.
   */
  function bestIndex(values, better) {
    if (better !== 'min' && better !== 'max') return -1;
    var nums = values.map(numeric);
    var valid = nums.filter(function (n) { return n !== null; });
    if (valid.length < 2) return -1;

    var target = better === 'min'
      ? valid.reduce(function (a, b) { return b < a ? b : a; })
      : valid.reduce(function (a, b) { return b > a ? b : a; });

    for (var i = 0; i < nums.length; i++) {
      if (nums[i] === target) return i;
    }
    return -1;
  }

  /**
   * Kapal yang akan dibandingkan pertama kali.
   *
   * WHY hanya yang sudah ada di shortlist: menawarkan kapal yang belum
   * disimpan membuat daftar kehilangan fungsinya sebagai filter.
   * Urutan shortlist dipertahankan karena itu urutan yang disusun
   * pengguna, bukan urutan acak.
   */
  function pickDefaults(savedIds, known) {
    var out = [];
    for (var i = 0; i < savedIds.length && out.length < MAX; i++) {
      if (known.indexOf(savedIds[i]) !== -1) out.push(savedIds[i]);
    }
    return out;
  }

  /**
   * Baris tabel yang sudah diformat: nilai tampilan + indeks terbaik.
   *
   * Dipisah dari render DOM supaya seluruh keputusan format dan
   * penilaian "terbaik" bisa diuji tanpa browser.
   */
  function buildRows(vessels, deps) {
    var t = (deps && deps.t) || function (k) { return k; };
    var noData = 'tidak tercatat';
    var fmtPrice = (deps && deps.formatPrice) || String;
    var fmtNumber = (deps && deps.formatNumber) || String;
    var fmtLastDock = (deps && deps.formatLastDock) || String;
    // WHY penjaga: label jenis/status ada di js/data.js sebagai satu
    // sumber. Bila data.js gagal dimuat (jaring putus, skrip diblokir),
    // memanggilnya tanpa cek melempar TypeError dan seluruh tabel
    // perbandingan mati - lebih baik menampilkan key mentah daripada
    // tidak menampilkan tabel sama sekali.
    var vd = window.VesselData || {};
    var typeLabel = vd.vesselTypeLabel || function (raw) { return raw; };
    var statusLabel = vd.vesselStatusLabel || function (raw) { return raw; };

    return ROWS.map(function (row) {
      var values = vessels.map(function (v) {
        var raw = v[row.key];
        if (raw === null || raw === undefined || raw === '' || raw === 'N/A') return noData;
        if (row.format === 'price') return fmtPrice(raw);
        if (row.format === 'type') return typeLabel(raw);
        if (row.format === 'status') return statusLabel(raw);
        if (row.format === 'lastdock') return fmtLastDock(raw);
        if (row.key === 'year_built') return String(raw);
        if (typeof raw === 'number') return fmtNumber(raw);
        return String(raw);
      });
      // WHY satuan dibuang kalau semua kolom kosong: "tidak
      // tercatat m" adalah kalimat yang tidak masuk akal, dan
      // memunculkan satuan di kolom yang kosong membuat tabel terlihat
      // seperti punya data.
      var semuaKosong = values.every(function (val) { return val === noData; });
      return {
        key: row.key,
        label: t(row.labelKey),
        unit: semuaKosong ? '' : (row.unit || ''),
        values: values,
        best: bestIndex(vessels.map(function (v) { return v[row.key]; }), row.better)
      };
    });
  }

  // ---- Bagian yang menyentuh DOM ----
  // WHY dipisah dari atas: file ini bisa diuji penuh tanpa browser
  // hanya karena logika\\) murni berada di fungsi yang tidak
  // membaca document sama sekali.

  var allVessels = [];
  var selected = [];
  var lastFocus = null;
  var releaseTrap = null;
  var previousOverflow = '';

  // WHY delegasi ke js/sanitize.js: ini satu-satunya tempat escaping
  // yang dipakai seluruh situs. compare.js pernah punya versinya
  // sendiri dengan bentuk berbeda dari tiga file lain - belum bisa
  // dieksploitasi karena semua atribut di sini BERGANDA KUTIP, tapi
  // itu berubah begitu ada satu atribut yang pindah ke kutip tunggal.
  // WHY fallback: jika js/sanitize.js gagal dimuat, situs tidak boleh mati total.
  var Sanitize = window.KapalProSanitize || {
    escapeHtml: function(str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  };
  function escapeHtml(str) { return Sanitize.escapeHtml(str); }

  /**
   * Judul baris tabel perbandingan.
   *
   * WHY peta ini ada di sini: dukungan bahasa Inggris dihapus dari
   * repo beserta js/i18n.js, jadi kunci `compare.spec*` tidak punya
   * arti lagi di mana pun. Akibatnya ada DUA kegagalan sekaligus:
   * render() melempar ReferenceError karena variabel `t` ikut
   * terhapus - drawer tidak pernah terbuka sama sekali (is-open
   * ditambahkan SESUDAH render()), dan kalau `t` hanya dibuat
   * pengembalian key, pengguna membaca "compare.specPrice" sebagai
   * judul kolom. Nilainya disalin apa adanya dari kamus lama.
   */
  var ROW_LABELS = {
    'compare.specPrice': 'Harga',
    'compare.specYear': 'Tahun Pembuatan',
    'compare.specType': 'Jenis',
    'compare.specLength': 'Panjang',
    'compare.specBeam': 'Lebar',
    'compare.specDepth': 'Kedalaman',
    'compare.specDraft': 'Daya Apung',
    'compare.specGt': 'Tonase Kasar',
    'compare.specNt': 'Tonase Bersih',
    'compare.specDwt': 'DWT',
    'compare.specEngine': 'Mesin',
    'compare.specPower': 'Daya Mesin',
    'compare.specSpeed': 'Kecepatan',
    'compare.specFuel': 'Bahan Bakar',
    'compare.specLastDock': 'Drydock Terakhir',
    'compare.specFlag': 'Bendera',
    'compare.specClass': 'Kelas',
    'compare.specLocation': 'Lokasi',
    'compare.specStatus': 'Status'
  };

  function t(key, fallback) {
    return ROW_LABELS[key] || fallback || key;
  }

  function byId(id) {
    for (var i = 0; i < allVessels.length; i++) {
      if (allVessels[i].id === id) return allVessels[i];
    }
    return null;
  }

  function savedIds() {
    return window.KapalProShortlist ? window.KapalProShortlist.getAll() : [];
  }

  function knownIds() {
    return allVessels.map(function (v) { return v.id; });
  }

  function renderBar() {
    var bar = document.getElementById('compare-bar');
    if (!bar) return;
    var ids = savedIds();
    // WHY dua kapal: satu kapal tidak bisa dibandingkan dengan apa pun.
    bar.classList.toggle('is-visible', ids.length >= 2);
    var label = document.getElementById('compare-bar-text');
    if (label) {
      label.textContent = ids.length + ' ' + 'kapal tersimpan';
    }
  }

  function chipsHtml() {
    var ids = savedIds();
    if (ids.length === 0) return '';
    return ids.map(function (id) {
      var v = byId(id);
      var name = v ? v.name : id;
      var on = selected.indexOf(id) !== -1;
      var disabled = !on && selected.length >= MAX;
      return '<button type="button" class="btn ' + (on ? 'btn-primary' : 'btn-ghost') +
        ' btn-sm" data-compare-id="' + escapeHtml(id) + '"' +
        (disabled ? ' disabled' : '') +
        ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
        escapeHtml(name) + '</button>';
    }).join(' ');
  }

  function render() {
    var body = document.getElementById('compare-body');
    if (!body) return;
    var hint = document.getElementById('compare-hint');

    if (savedIds().length < 2) {
      body.innerHTML = '<p class="compare-empty">' + escapeHtml('Simpan minimal 2 kapal untuk membuka perbandingan.') + '</p>';
      if (hint) hint.textContent = 'Pilih 2 sampai 3 kapal dari daftar tersimpan untuk melihat spesifikasinya berdampingan.';
      return;
    }
    if (selected.length >= MAX) {
      if (hint) hint.textContent = 'Perbandingan dibatasi 3 kapal. Lepas salah satu untuk menambah yang lain.';
    }

    var chosen = selected.map(byId).filter(Boolean);
    if (chosen.length === 0) {
      body.innerHTML = '<p class="compare-empty">' + escapeHtml('Simpan minimal 2 kapal untuk membuka perbandingan.') + '</p>';
      return;
    }

    var rows = buildRows(chosen, {
      t: t,
      formatPrice: window.VesselData ? window.VesselData.formatPrice : String,
      formatNumber: window.VesselData ? window.VesselData.formatNumber : String,
      formatLastDock: window.VesselData ? window.VesselData.formatLastDock : String
    });

    var html = '<div class="compare-chips" style="display: flex; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-4);">' +
      chipsHtml() + '</div>';
    html += '<table class="compare-table"><thead><tr><th scope="col"></th>';
    chosen.forEach(function (v) {
      html += '<th scope="col"><a href="vessel-' + encodeURIComponent(v.id) + '.html">' +
        escapeHtml(v.name) + '</a></th>';
    });
    html += '</tr></thead><tbody>';
    rows.forEach(function (row) {
      html += '<tr><th scope="row">' + escapeHtml(row.label) + '</th>';
      row.values.forEach(function (val, i) {
        var isBest = row.best === i;
        html += '<td class="' + (isBest ? 'is-best' : '') + '">' + escapeHtml(val) +
          (row.unit ? ' ' + escapeHtml(row.unit) : '') +
          (isBest ? '<span class="compare-best-tag">' + escapeHtml('Terbaik') + '</span>' : '') +
          '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    body.innerHTML = html;
  }

  function open() {
    var drawer = document.getElementById('compare-drawer');
    if (!drawer) return;
    if (selected.length === 0) selected = pickDefaults(savedIds(), knownIds());
    render();
    drawer.hidden = false;
    drawer.classList.add('is-open');
    lastFocus = document.activeElement;

    // WHY overflow asli disimpan dulu: drawer filter katalog juga
    // mengunci scroll, dan dua yang saling menimpa membuat halaman
    // terkunci setelah drawer pertama ditutup.
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('has-compare-drawer');

    // WHY nama variabelnya closeBtn, bukan close: `var close` di sini
    // membayangi fungsi close() modul di bawah. Akibatnya onClose
    // menerima ELEMEN DOM, dan Escape memanggilnya -> TypeError
    // "close is not a function", jadi drawer tidak pernah tertutup
    // lewat keyboard. Fokus tetap di panel yang sudah tidak terlihat.
    var closeBtn = document.getElementById('compare-close');
    if (closeBtn) closeBtn.focus();

    // WHY Tab dikurung di dalam drawer: tanpa ini Tab dari tombol
    // tutup berjalan ke kontrol katalog di belakang panel yang
    // sekarang tertutup, dan pembaca layar membacakan tombol yang
    // tidak terlihat (WCAG 2.4.3).
    if (window.App && window.App.trapFocus) {
      releaseTrap = window.App.trapFocus(document.querySelector('.compare-panel'), {
        isOpen: function () {
          var d = document.getElementById('compare-drawer');
          return !!(d && d.classList.contains('is-open'));
        },
        onClose: close
      });
    }
  }

  function close() {
    var drawer = document.getElementById('compare-drawer');
    if (!drawer) return;
    drawer.hidden = true;
    drawer.classList.remove('is-open');
    document.body.style.overflow = previousOverflow;
    previousOverflow = '';
    document.body.classList.remove('has-compare-drawer');

    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /**
   * WHY: id yang hilang dari shortlist harus keluar dari
   * `selected`. Kalau tidak, tabel menampilkan kapal yang sudah
   * dihapus tanpa cara menghentikannya.
   */
  function prune() {
    var ids = savedIds();
    selected = selected.filter(function (id) { return ids.indexOf(id) !== -1; });
  }

  function toggleSelected(id) {
    var at = selected.indexOf(id);
    if (at !== -1) {
      selected.splice(at, 1);
    } else {
      // WHY menolak di atas batas, bukan mengganti yang lama: diam-diam
      // membuang pilihan pengguna adalah perilaku yang membingungkan.
      if (selected.length >= MAX) return false;
      selected.push(id);
    }
    return true;
  }

  function bind() {
    var openBtn = document.getElementById('compare-open');
    if (openBtn) openBtn.addEventListener('click', open);

    ['compare-close', 'compare-done', 'compare-backdrop'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', close);
    });

    var clearBtn = document.getElementById('compare-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (window.KapalProShortlist) window.KapalProShortlist.clear();
        selected = [];
      });
    }

    // WHY delegasi: isi tabel dibangun ulang setiap render, jadi
    // listener per tombol akan menggantung pada elemen yang sudah
    // dibuang.
    var body = document.getElementById('compare-body');
    if (body) {
      body.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('[data-compare-id]') : null;
        if (!btn) return;
        var id = btn.getAttribute('data-compare-id');
        if (!id) return;
        if (!toggleSelected(id)) {
          // WHY window.App.showToast, bukan window.KapalProToast:
          // API itu TIDAK PERNAH ADA di mana pun di repo ini, jadi
          // memanggilnya selalu jatuh ke falsy check dan tidak pernah
          // menampilkan apa pun. Toast sungguhan diekspos js/app.js
          // sebagai App.showToast.
          //
          // CATATAN JUJUR: cabang ini praktis tidak terjangkau lewat
          // klik pengguna. chipsHtml() merender chip ke-4 dengan
          // atribut disabled ketika selected sudah == MAX, dan tombol
          // disabled tidak memancarkan click. Jadi ini defensive code,
          // bukan perbaikan bug yang dilihat user - bug aslinya "user
          // klik tapi tidak ada kejadian" tidak pernah terjadi, karena
          // chip-nya memang tampil redup. Yang diperbaiki di sini
          // adalah referensi ke API yang tidak ada, supaya tidak
          // menyesatkan pembaca kode di masa depan.
          if (window.App && window.App.showToast) {
            window.App.showToast('Perbandingan dibatasi 3 kapal. Lepas salah satu untuk menambah yang lain.', 'info');
          }
          return;
        }
        render();
      });
    }

    // WHY Escape TIDAK didaftarkan di sini: trapFocus di js/app.js
    // sudah menangani Escape untuk panel ini. Dua listener Escape
    // berarti satu ketukan menutup drawer dua kali dan mengembalikan
    // fokus ke elemen yang sudah tidak ada.

    // WHY event yang sama dipakai shortlist.js: daftar bisa berubah
    // dari halaman kapal di tab lain? Tidak - tapi bisa berubah dari
    // filter "tersimpan saja" yang memanggil remove, jadi tetap
    // listening.
    document.addEventListener('kapalpro:shortlist', function () {
      prune();
      renderBar();
      var drawer = document.getElementById('compare-drawer');
      if (drawer && drawer.classList.contains('is-open')) render();
    });
  }

  function init() {
    if (!window.VesselData || typeof window.VesselData.getVessels !== 'function') return;
    bind();
    window.VesselData.getVessels().then(function (vessels) {
      allVessels = vessels || [];
      prune();
      renderBar();
      var drawer = document.getElementById('compare-drawer');
      if (drawer && drawer.classList.contains('is-open')) render();
    }).catch(function () {
      // WHY diamkan: tabel perbandingan adalah tambahan. Kalau data
      // kapal gagal dimuat, halaman katalog lain tetap harus bekerja.
      allVessels = [];
    });

    }

  window.KapalProCompare = {
    MAX: MAX,
    ROWS: ROWS,
    // Bagian murni, diekspor untuk tests/compare.test.js.
    numeric: numeric,
    bestIndex: bestIndex,
    pickDefaults: pickDefaults,
    buildRows: buildRows,
    // Bagian DOM.
    open: open,
    close: close,
    toggleSelected: toggleSelected,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();