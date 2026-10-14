/**
 * Catalog Page Logic
 * Optimized for large datasets (100+ items)
 * Handles filtering, search, sort, and mobile filter drawer
 */

(function() {
  'use strict';

  // Constants
  var SEARCH_DEBOUNCE_MS = 300;
  var FILTER_CACHE_SIZE = 50;
  // WHY origin dari config: nilai yang sama ditulis di tiga tempat
  // (config.js, catalog.js, vessel.js) dan pasti drift. Sumber tunggal
  // adalah window.KAPALPRO_CONFIG.siteUrl; fallback menjaga halaman tetap
  // jalan kalau config.js gagal dimuat. config.js selalu dimuat sebelum
  // file ini (defer berurutan).
  var SITE_ORIGIN = (window.KAPALPRO_CONFIG && window.KAPALPRO_CONFIG.siteUrl) || 'https://databerkata.github.io/prototype-kapalpro';

  // Nilai meta yang asli, disalin sekali sebelum JavaScript menyentuhnya.
  // Diperlukan supaya meta bisa dikembalikan persis ke keadaan semula
  // ketika pengguna mengosongkan semua filter.
  var ORIGINAL_META = null;

  // State
  var allVessels = [];
  // WHY: Lokasi unik dari data. Daftar kota hardcoded sebelumnya
  // mengandung Surabaya/Balikpapan/Lampung/Makassar yang TIDAK ada
  // di vessels.json (filter tersebut selalu 0 hasil), sementara
  // Jambi/Tegal/"Indonesia" tidak bisa dipilih sama sekali.
  var allLocations = [];

  /** Bangun opsi filter lokasi dari data kapal yang benar-benar ada. */
  /**
   * Bangun daftar filter jenis kapal dari data armada.
   *
   * WHY dinamis, bukan statis di HTML: daftar statis pernah tidak
   * mencakup 2 tipe yang ada di data (oil_barge, other) sehingga
   * 2 kapal tidak bisa ditemukan lewat filter jenis. Hanya tipe
   * yang punya kapal yang ditampilkan - opsi tanpa kapal adalah
   * filter yang selalu kosong.
   */
  function populateTypeFilter() {
    var list = document.getElementById('type-filter-list');
    if (!list) return;
    var counts = {};
    allVessels.forEach(function(v) {
      var t = (v.type || 'other').trim() || 'other';
      counts[t] = (counts[t] || 0) + 1;
    });
    var known = (window.VesselData && window.VesselData.vesselTypes)
      ? window.VesselData.vesselTypes()
      : [];
    var labelOf = {};
    known.forEach(function(t) { labelOf[t.key] = t.label; });
    var keys = Object.keys(counts).sort(function(a, b) {
      var ia = known.findIndex(function(t) { return t.key === a; });
      var ib = known.findIndex(function(t) { return t.key === b; });
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    // WHY: nilai ?type= dari URL yang tidak ada di data dibuang - kalau
    // tidak, filter menghasilkan nol kapal tanpa penjelasan di UI.
    currentFilters.types = currentFilters.types.filter(function(t) {
      return counts[t] > 0;
    });
    list.innerHTML = keys.map(function(key) {
      var checked = currentFilters.types.indexOf(key) !== -1 ? 'checked' : '';
      var label = labelOf[key] || key;
      return '<label style="display: flex; align-items: center; gap: var(--space-2); cursor: pointer; min-height: 44px;">' +
        '<input type="checkbox" name="type" value="' + escapeHtml(key) + '" class="filter-checkbox" ' + checked + '>' +
        '<span class="text-sm">' + escapeHtml(label) +
        ' <span class="text-xs" style="color: var(--text-muted);">(' + counts[key] + ')</span>' +
        '</span></label>';
    }).join('');

    // WHY listener dipasang DI SINI: daftar tipe baru ada setelah data
    // dimuat, sedangkan bindEvents() berjalan lebih dulu.
    list.querySelectorAll('input[name="type"]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        collectFilters();
        currentPage = 1;
        applyFilters();
        trackEvent('Filter Applied', {
          filter_type: 'type',
          filter_value: (cb.value || '').slice(0, 30),
          checked: cb.checked
        });
      });
    });
  }

  function populateLocationFilter() {
    var seen = {};
    allLocations = [];
    allVessels.forEach(function(v) {
      if (v.location && !seen[v.location]) {
        seen[v.location] = true;
        allLocations.push(v.location);
      }
    });
    allLocations.sort();

    var select = document.getElementById('location-filter');
    if (!select) return;
    // WHY currentFilters.location ikut dibaca: ?loc= dari URL dibaca SEBELUM
    // opsi dibangun (loadUrlParams jalan di bindEvents, opsi dibangun di
    // sini setelah data dimuat). Tanpa ini dropdown tidak mencerminkan
    // filter lokasi yang aktif, dan filter itu hilang diam-diam begitu
    // pengguna menyentuh filter lain.
    var current = select.value || currentFilters.location;
    var label = 'Semua Lokasi';
    var html = '<option value="">' + escapeHtml(label) + '</option>';
    allLocations.forEach(function(loc) {
      html += '<option value="' + escapeHtml(loc) + '">' + escapeHtml(loc) + '</option>';
    });
    select.innerHTML = html;
    // WHY: Pertahankan filter yang sedang aktif bila lokasi tsb masih ada.
    // Nilai URL yang tidak ada di data dibuang dari state - kalau tidak,
    // filter menghasilkan nol kapal tanpa penjelasan di UI.
    if (current && allLocations.indexOf(current) !== -1) {
      select.value = current;
    } else {
      select.value = '';
      if (currentFilters.location) currentFilters.location = '';
    }
  }

  /**
   * Bangun daftar filter kelas dari data kapal.
   *
   * WHY bukan daftar statis di HTML: kelas yang ada berubah setiap
   * kali armada berubah, dan daftar statis pasti akan memuat
   * kelas yang tidak punya kapal - filter yang selalu kosong, seperti
   * filter kota versi lama.
   */
  function populateClassFilter() {
    var list = document.getElementById('class-filter-list');
    if (!list) return;
    var counts = {};
    allVessels.forEach(function(v) {
      var c = (v.classification || '').trim();
      if (!c || c === 'N/A') return;
      counts[c] = (counts[c] || 0) + 1;
    });
    var names = Object.keys(counts).sort();
    // WHY: nilai ?cls= dari URL yang tidak ada di data dibuang - kalau
    // tidak, filter menghasilkan nol kapal tanpa penjelasan di UI.
    // (Checkbox-nya memang tidak ada, tapi state-nya tetap memfilter.)
    currentFilters.classes = currentFilters.classes.filter(function(c) {
      return names.indexOf(c) !== -1;
    });
    if (names.length === 0) {
      list.innerHTML = '';
      return;
    }
    // WHY label-wrap checkbox dengan teks: pola yang sama seperti
    // filter jenis kapal, supaya check-i18n tidak melihat atribut
    // hardcode dan target sentuh tetap dihitung oleh audit.
    list.innerHTML = names.map(function(name) {
      var checked = currentFilters.classes.indexOf(name) !== -1 ? 'checked' : '';
      return '<label style="display: flex; align-items: center; gap: var(--space-2); cursor: pointer; min-height: 44px;">' +
        '<input type="checkbox" name="class" value="' + escapeHtml(name) + '" class="filter-checkbox" ' + checked + '>' +
        '<span class="text-sm">' + escapeHtml(name) +
        ' <span class="text-xs" style="color: var(--text-muted);">(' + counts[name] + ')</span>' +
        '</span></label>';
    }).join('');

    // WHY listener dipasang DI SINI, bukan di bindEvents(): daftar
    // kelas baru ada setelah data kapal dimuat, sedangkan
    // bindEvents() berjalan lebih dulu. Versi tanpa baris ini
    // membuat checkbox kelas terlihat bisa diklik tapi diam-diam
    // tidak memfilter apa pun - bug yang lolos karena tidak ada test.
    list.querySelectorAll('input[name="class"]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        collectFilters();
        currentPage = 1;
        applyFilters();
        trackEvent('Filter Applied', {
          filter_type: 'class',
          filter_value: (cb.value || '').slice(0, 30),
          checked: cb.checked
        });
      });
    });
  }
  var filteredVessels = [];
  var searchIndex = {};
  var filterCache = {};
  var currentPage = 1;
  var releaseFilterTrap = null;
  var filterOverflowBefore = '';
  var currentFilters = {
    types: [],
    statuses: ['available'],
    minPrice: null,
    maxPrice: null,
    minYear: null,
    maxYear: null,
    minLength: null,
    maxLength: null,
    minDwt: null,
    maxDwt: null,
    classes: [],
    location: '',
    savedOnly: false,
    search: ''
  };

  // WHY shortlist dibaca satu kali per applyFilters: daftar kapal
  // disimpan per perangkat di localStorage, dan filter ini yang
  // memakainya. Membaca ulang setiap kapal di loop akan membiarkan
  // daftar berubah di tengah render.
  function savedIds() {
    return window.KapalProShortlist ? window.KapalProShortlist.getAll() : [];
  }

  /**
   * Selaraskan semua tombol "simpan" dengan isi shortlist saat ini.
   *
   * WHY satu fungsi untuk semua tombol: status tersimpan bisa berubah
   * dari tiga tempat (tombol kartu ini, tombol di halaman kapal, atau
   * localStorage yang diubah tab lain). Menulis aturan yang sama tiga
   * kali berarti tiga tempat bisa berbeda - dan tombol yang terlihat
   * "tersimpan" padahal kapal sudah dihapus adalah kebohongan kecil
   * yang merusak kepercayaan.
   */
  function updateAllSaveButtons() {
    if (!window.KapalProShortlist) return;
    document.querySelectorAll('.save-btn[data-vessel-id]').forEach(function(btn) {
      var id = btn.getAttribute('data-vessel-id');
      if (!id) return;
      var saved = window.KapalProShortlist.has(id);
      btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
      btn.classList.toggle('is-saved', saved);
      var label = btn.querySelector('.save-label');
      if (label) {
        label.textContent = saved ? 'Tersimpan' : 'Simpan Kapal';
      }
    });
  }

  // Type name mapping
  // DIHAPUS TYPE_NAMES: badge jenis kartu tidak dirender lagi (jenis
  // kapal sudah tertulis di nama dan di filter), jadi peta itu tidak
  // pernah lagi terbaca.

  // DIHAPUS STATUS_NAMES: label status kini datang dari
  // VesselData.vesselStatusLabel() - sumber yang sama dengan badge kartu di
  // pembangun bersama. Salinan lokal pernah membuat label filter dan label
  // badge bisa berbeda tanpa ada yang menyadarinya.

  // DIHAPUS STATUS_BADGES: kartu katalog kini memakai badge overlay
  // .catalog-card-badge (gaya sama dengan beranda), jadi pemetaan
  // kelas .badge-* tidak pernah lagi terbaca.

  // WHY: Remember last search term so we only track once per unique query
  // (applyFilters also runs on checkbox changes, not just typing)
  var lastTrackedSearch = '';

  /**
   * Analytics helper (Minggu 3)
   * WHY: Safe no-op if analytics.js fails to load - tracking
   * must never break catalog functionality (Section 1.13)
   */
  function trackEvent(name, props) {
    if (window.KapalProAnalytics) {
      window.KapalProAnalytics.track(name, props);
    }
  }

  /**
   * Initialize catalog
   */
  // WHY: Nilai sizes yang sama dipakai untuk <source> WebP dan <img>
  // JPEG. Kalau keduanya berbeda, browser akan memilih lebar berbeda
  // untuk tiap format dan memotong gambar pada beberapa kondisi.
  // WHY angka mengikuti breakpoint .vessels-grid (1 kolom < 640px,
  // 2 kolom < 1024px, 3 kolom selebihnya), bukan breakpoint beranda.
  var CARD_SIZES = '(max-width: 639px) 92vw, (max-width: 1023px) 46vw, 31vw';

  function init() {
    // WHY guard: kalau js/data.js gagal dimuat, window.VesselData undefined
    // dan init() mati dengan TypeError. Tampilkan empty state yang jujur,
    // bukan skeleton loading selamanya.
    if (!window.VesselData || !window.VesselData.getVessels) {
      showLoading(false);
      var grid = document.getElementById('vessels-grid');
      if (grid) grid.style.display = 'none';
      var empty = document.getElementById('empty-state');
      if (empty) empty.style.display = 'block';
      if (window.App && window.App.showToast) {
        window.App.showToast('Gagal memuat data kapal. Muat ulang halaman.', 'error');
      }
      return;
    }

    showLoading(true);

    // WHY: Manifest varian gambar harus siap SEBELUM kartu dirender,
    // karena buildSrcSet() sengaja tidak menebak nama file bila
    // manifest belum tersedia (srcset kosong = unduhan 1600px penuh).
    Promise.all([
      window.VesselData.getVessels(),
      window.VesselData.loadVariantManifest()
    ]).then(function(res) {
      var vessels = res[0];
      allVessels = vessels;
      // WHY: Daftar lokasi SEBELUM applyFilters() - filter lokasi harus
      // dibangun dari data, bukan daftar kota hardcoded.
      populateTypeFilter();
      populateLocationFilter();
      populateClassFilter();
      // WHY syncDesktopToMobile() di sini JUGA: drawer mobile dibangun
      // sekali di init() saat allLocations masih kosong, sehingga dropdown
      // lokasi & kelas versi mobile tidak punya opsi. Dibangun ulang
      // setelah data siap - memakai currentFilters (sudah berisi nilai
      // dari URL), jadi pilihan tidak hilang.
      syncDesktopToMobile();
      buildSearchIndex();
      applyFilters();
      // WHY setelah applyFilters: kartu baru ada setelah render. Tanpa
      // ini tombol simpan muncul dalam keadaan "belum tersimpan"
      // apa adanya, sehingga kapal yang sebenarnya sudah tersimpan akan
      // terlihat belum tersimpan sampai pengguna mengetuk sekali.
      updateAllSaveButtons();
      showLoading(false);
    }).catch(function(err) {
      // WHY: tanpa catch, skeleton loading tampil selamanya saat data
      // gagal dimuat - pengguna tidak dapat feedback apa pun.
      console.error('[Catalog] Gagal memuat data:', err);
      showLoading(false);
      var grid = document.getElementById('vessels-grid');
      if (grid) grid.style.display = 'none';
      var empty = document.getElementById('empty-state');
      if (empty) {
        empty.style.display = 'block';
        empty.textContent = 'Gagal memuat data kapal. Periksa koneksi lalu muat ulang halaman.';
      }
    });

    bindEvents();
    syncDesktopToMobile();

    // ---------- Sinkronisasi live antar-tab ----------
    // WHY event storage: tab /admin menulis localStorage "kapal_ads" dan
    // event storage dikirim ke semua tab lain dengan origin sama -
    // persis jalur yang dibutuhkan. Tanpa ini beranda ikut segar (lihat
    // js/index.js) tapi katalog menampilkan armada basi sampai reload.
    // WHY tidak perlu clearCache(): getVessels() membaca ulang override
    // admin di awal SETIAP pemanggilan.
    window.addEventListener('storage', function (e) {
      if (e.key !== 'kapal_ads' && e.key !== null) return;
      Promise.all([
        window.VesselData.getVessels(),
        window.VesselData.loadVariantManifest()
      ]).then(function (res) {
        allVessels = res[0] || [];
        // WHY filterCache dibuang: cache disimpan per currentFilters,
        // dan filter aktif tidak berubah saat armada berubah. Tanpa ini
        // hasil 16 kapal lama tersaji dari cache meski allVessels sudah
        // 15 - persis pola yang dijalankan tombol filter "tersimpan".
        filterCache = {};
        populateTypeFilter();
        populateLocationFilter();
        populateClassFilter();
        // WHY drawer mobile ikut dibangun ulang: daftar lokasi/kelas bisa
        // berubah dari tab /admin.
        // WHY skip jika drawer terbuka: rebuild dari currentFilters akan
        // menghapus centangan yang belum di-Apply oleh pengguna.
        var drawer = document.getElementById('filter-drawer');
        if (!drawer || !drawer.classList.contains('active')) {
          syncDesktopToMobile();
        }
        buildSearchIndex();
        // WHY currentPage kembali 1: armada bisa menyusut di bawah
        // halaman yang sedang tampil; tanpa reset, grid bisa tampak
        // kosong padahal masih ada kapal di halaman lain.
        currentPage = 1;
        applyFilters();
        updateAllSaveButtons();
      }).catch(function (err) {
        console.error('[Catalog] Gagal sinkronisasi antar-tab:', err);
      });
    });

    }

  /**
   * WHY: Build search index for fast filtering
   * Pre-computes searchable text for each vessel
   */
  function buildSearchIndex() {
    searchIndex = {};
    allVessels.forEach(function(v) {
      searchIndex[v.id] = (
        /* WHY: ID kapal ikut di-index supaya konsisten dengan autocomplete
           (js/search-autocomplete.js) yang juga cocok berdasarkan ID,
           mis. ketik "TB003" menyaring grid ke Tugboat 1200 HP 2008. */
        (v.id || '') + ' ' +
        (v.name || '') + ' ' +
        (v.description || '') + ' ' +
        (v.location || '') + ' ' +
        (v.type || '') + ' ' +
        (v.port_location || '')
      ).toLowerCase();
    });
  }

  /**
   * WHY: Generate cache key for filter results
   */
  function getFilterCacheKey() {
    return JSON.stringify(currentFilters);
  }

  /**
   * WHY: Clear old cache entries when size exceeds limit
   */
  function clearOldCache() {
    var keys = Object.keys(filterCache);
    if (keys.length > FILTER_CACHE_SIZE) {
      delete filterCache[keys[0]];
    }
  }

  /**
   * Bind all event listeners
   */
  function bindEvents() {
    // WHY helper on(): satu id yang hilang dari HTML tidak boleh mematikan
    // seluruh binding halaman dengan TypeError. Pola guard ini sudah dipakai
    // untuk input length/dwt - sekarang konsisten di semua binding.
    function on(id, event, handler) {
      var el = document.getElementById(id);
      if (el) el.addEventListener(event, handler);
    }

    // Search
    on('catalog-search', 'input', window.App.debounce(function() {
      currentFilters.search = this.value.trim();
      currentPage = 1;
      applyFilters();
      // WHY URL ditulis di sini juga: sebelumnya hanya checkbox dan input
      // angka yang menulis URL, jadi kata kunci pencarian hilang begitu
      // halaman dimuat ulang dan hasil pencarian tidak bisa dibagikan.
      updateUrlParams();
      // WHY: Track search only when non-empty and changed (avoids spam)
      if (currentFilters.search && currentFilters.search !== lastTrackedSearch) {
        lastTrackedSearch = currentFilters.search;
        trackEvent('Search', { query_length: currentFilters.search.length, results: filteredVessels.length });
      }
    }, SEARCH_DEBOUNCE_MS));

    // Sort
    on('sort-select', 'change', function() {
      currentPage = 1;
      applyFilters();
      trackEvent('Sort Applied', { option: this.value });
    });

    // Filter shortlist
    var savedOnly = document.getElementById('saved-only');
    if (savedOnly) {
      savedOnly.addEventListener('change', function() {
        currentFilters.savedOnly = this.checked;
        currentPage = 1;
        // WHY cache dibuang di sini: filterCache disimpan per
        // currentFilters, dan isinya tidak bergantung pada isi
        // shortlist. Kalau daftar berubah tanpa cache dibuang, filter
        // "tersimpan" akan menampilkan hasil basi.
        filterCache = {};
        applyFilters();
        updateUrlParams();
      });
    }

    // Simpan kapal dari kartu katalog.
    // WHY delegasi ke grid, bukan listener per tombol: kartu ditulis
    // ulang setiap kali filter atau halaman berubah. Listener per
    // tombol akan menggantung pada elemen yang sudah dibuang.
    var grid = document.getElementById('vessels-grid');
    if (grid) {
      grid.addEventListener('click', function(e) {
        var btn = e.target.closest ? e.target.closest('.save-btn') : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-vessel-id');
        if (!id) return;
        var nowSaved = window.KapalProShortlist.toggle(id);
        updateAllSaveButtons();
        filterCache = {};
        if (currentFilters.savedOnly) { currentPage = 1; applyFilters(); }
        trackEvent('Shortlist Toggle', { vessel_id: id, saved: nowSaved });
      });
    }

    // WHY event dari shortlist.js: tombol di halaman kapal mengubah
    // daftar yang sama, dan perubahan itu harus terlihat di katalog
    // tanpa perlu memuat ulang.
    document.addEventListener('kapalpro:shortlist', function() {
      updateAllSaveButtons();
      filterCache = {};
      if (currentFilters.savedOnly) { currentPage = 1; applyFilters(); }
    });

    // Filter checkboxes (desktop)
    // WHY hanya yang statis di sini: checkbox tipe & kelas dibangun
    // dinamis SETELAH data dimuat, dan listenernya dipasang di
    // populateTypeFilter()/populateClassFilter(). Kalau dipasang di
    // sini, daftarnya masih kosong.
    document.querySelectorAll('.catalog-filters input[name="status"]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        collectFilters();
        currentPage = 1;
        applyFilters();
        // WHY: Track filter usage to learn buyer intent (type vs status vs price)
        trackEvent('Filter Applied', {
          filter_type: 'status',
          filter_value: (cb.value || '').slice(0, 30),
          checked: cb.checked
        });
      });
    });

    // Price inputs
    ['price-min', 'price-max'].forEach(function(id) {
      on(id, 'input', window.App.debounce(function() {
        collectFilters();
        currentPage = 1;
        applyFilters();
      }, SEARCH_DEBOUNCE_MS));
    });

    // Year inputs
    ['year-min', 'year-max'].forEach(function(id) {
      on(id, 'input', window.App.debounce(function() {
        collectFilters();
        currentPage = 1;
        applyFilters();
      }, SEARCH_DEBOUNCE_MS));
    });

    // Ukuran inputs (panjang dan DWT)
    ['length-min', 'length-max', 'dwt-min', 'dwt-max'].forEach(function(id) {
      on(id, 'input', window.App.debounce(function() {
        collectFilters();
        currentPage = 1;
        applyFilters();
      }, SEARCH_DEBOUNCE_MS));
    });

    // Location
    on('location-filter', 'change', function() {
      currentFilters.location = this.value;
      currentPage = 1;
      applyFilters();
      // WHY updateUrlParams: handler ini menulis currentFilters secara
      // langsung tanpa lewat collectFilters(), jadi tanpa panggilan ini
      // URL/canonical/judul tidak ikut berubah - filter lokasi tidak
      // bisa dibagikan dan crawler melihat semua hasil saringan sebagai
      // satu halaman. Jalur checkbox & mobile sudah lewat collectFilters.
      updateUrlParams();
      if (this.value) {
        trackEvent('Filter Applied', { filter_type: 'location', filter_value: this.value.slice(0, 30) });
      }
    });

    // Reset
    on('filter-reset', 'click', resetFilters);
    on('empty-reset', 'click', resetFilters);

    // Mobile filter drawer
    on('filter-toggle', 'click', openFilterDrawer);
    on('filter-drawer-close', 'click', closeFilterDrawer);
    on('filter-drawer-backdrop', 'click', closeFilterDrawer);
    on('mobile-filter-apply', 'click', function() {
      collectFiltersFromMobile();
      closeFilterDrawer();
      currentPage = 1;
      applyFilters();
    });
    on('mobile-filter-reset', 'click', function() {
      resetFilters();
      syncDesktopToMobile();
    });

    // Escape ditangani trapFocus di js/app.js selagi drawer terbuka.

    // URL params on load
    loadUrlParams();
  }

  /**
   * Collect filters from desktop checkboxes
   */
  function collectFilters() {
    // WHY val(): baca nilai input dengan aman - elemen yang hilang
    // dianggap kosong, bukan TypeError.
    function val(id) {
      var el = document.getElementById(id);
      return el ? el.value : '';
    }

    // Types
    currentFilters.types = [];
    // WHY selector-nya dibatasi ke .catalog-filters: drawer mobile
    // (#mobile-filters) punya salinan checkbox yang sama persis.
    // Selector tanpa batas menghitung setiap pilihan dua kali, dan
    // itu membuat badge jumlah filter selalu meleset satu. Gejalanya
    // baru terlihat setelah menambah filter kelas, karena baris
    // "kelas aktif" jadi satu-satunya baris yang benar.
    document.querySelectorAll('.catalog-filters input[name="type"]:checked').forEach(function(cb) {
      currentFilters.types.push(cb.value);
    });

    // Statuses
    currentFilters.statuses = [];
    document.querySelectorAll('.catalog-filters input[name="status"]:checked').forEach(function(cb) {
      currentFilters.statuses.push(cb.value);
    });
    if (currentFilters.statuses.length === 0) currentFilters.statuses = ['available'];

    // Price
    var priceMin = val('price-min');
    var priceMax = val('price-max');
    currentFilters.minPrice = priceMin ? parseInt(priceMin, 10) : null;
    currentFilters.maxPrice = priceMax ? parseInt(priceMax, 10) : null;

    // Year
    var yearMin = val('year-min');
    var yearMax = val('year-max');
    currentFilters.minYear = yearMin ? parseInt(yearMin, 10) : null;
    currentFilters.maxYear = yearMax ? parseInt(yearMax, 10) : null;

    // Ukuran (panjang dan DWT)
    var lengthMin = val('length-min');
    var lengthMax = val('length-max');
    currentFilters.minLength = lengthMin ? parseFloat(lengthMin) : null;
    currentFilters.maxLength = lengthMax ? parseFloat(lengthMax) : null;

    var dwtMin = val('dwt-min');
    var dwtMax = val('dwt-max');
    currentFilters.minDwt = dwtMin ? parseFloat(dwtMin) : null;
    currentFilters.maxDwt = dwtMax ? parseFloat(dwtMax) : null;

    // Kelas
    currentFilters.classes = [];
    document.querySelectorAll('.catalog-filters input[name="class"]:checked').forEach(function(cb) {
      currentFilters.classes.push(cb.value);
    });

    // Location
    currentFilters.location = val('location-filter');

    updateFilterCount();
    updateUrlParams();
  }

  /**
   * Collect filters from mobile drawer
   */
  function collectFiltersFromMobile() {
    // WHY copy(): target desktop juga di-guard - drawer mobile tidak boleh
    // throw kalau pasangan desktop-nya hilang.
    function copy(mobileId, desktopId) {
      var mEl = document.getElementById(mobileId);
      var dEl = document.getElementById(desktopId);
      if (mEl && dEl) dEl.value = mEl.value;
    }

    // Copy mobile filter values to desktop
    // WHY tidak pakai querySelector dengan value mentah: nilai dengan
    // tanda kutip (mis. dari Sheets) merusak sintaks selector (CSS injection).
    // Bandingkan di JS seperti di loadUrlParams.
    document.querySelectorAll('#mobile-filters input[type="checkbox"]').forEach(function(mCb) {
      document.querySelectorAll('.catalog-filters input[name="' + mCb.name + '"]').forEach(function(dCb) {
        if (dCb.value === mCb.value) dCb.checked = mCb.checked;
      });
    });

    copy('mobile-price-min', 'price-min');
    copy('mobile-price-max', 'price-max');
    copy('mobile-year-min', 'year-min');
    copy('mobile-year-max', 'year-max');
    copy('mobile-location-filter', 'location-filter');
    copy('mobile-length-min', 'length-min');
    copy('mobile-length-max', 'length-max');
    copy('mobile-dwt-min', 'dwt-min');
    copy('mobile-dwt-max', 'dwt-max');

    collectFilters();
  }

  /**
   * Sync desktop filters to mobile drawer
   */
  function syncDesktopToMobile() {
    var mobileContainer = document.getElementById('mobile-filters');
    // WHY guard: tanpa container tidak ada yang bisa di-sync.
    if (!mobileContainer) return;
    mobileContainer.innerHTML = '';

    // WHY opsi dibaca dari DOM desktop, bukan daftar hardcoded: filter
    // baru yang ditambah ke desktop otomatis muncul di drawer mobile
    // tanpa edit ganda. (Sebelumnya ['tongkang',...] dan
    // ['available',...] ditulis manual di sini dan rawan drift.)
    function mobileCheckboxGroup(name, activeValues) {
      var html = '';
      var boxes = document.querySelectorAll('.catalog-filters input[name="' + name + '"]');
      Array.prototype.forEach.call(boxes, function(dCb) {
        var labelEl = dCb.parentElement ? dCb.parentElement.querySelector('span') : null;
        // WHY hanya teks label: span desktop berisi "Label (jumlah)" dan
        // jumlahnya tidak perlu ikut ke drawer mobile.
        var label = dCb.value;
        if (labelEl && labelEl.firstChild && labelEl.firstChild.textContent) {
          label = labelEl.firstChild.textContent.trim() || dCb.value;
        }
        var checked = activeValues.indexOf(dCb.value) !== -1 ? 'checked' : '';
        html += '<label style="display: flex; align-items: center; gap: var(--space-2); cursor: pointer; min-height: 44px;">';
        html += '<input type="checkbox" name="' + name + '" value="' + escapeHtml(dCb.value) + '" class="filter-checkbox mobile-filter-checkbox" ' + checked + '>';
        html += '<span class="text-sm">' + escapeHtml(label) + '</span>';
        html += '</label>';
      });
      return html;
    }

    // Type
    var typeHtml = '<div style="margin-bottom: var(--space-6);">';
    typeHtml += '<h3 class="catalog-filter-title">Jenis Kapal</h3>';
    typeHtml += '<div style="display: flex; flex-direction: column; gap: var(--space-2);">';
    typeHtml += mobileCheckboxGroup('type', currentFilters.types);
    typeHtml += '</div></div>';

    // Status
    var statusHtml = '<div style="margin-bottom: var(--space-6);">';
    statusHtml += '<h3 class="catalog-filter-title">Status</h3>';
    statusHtml += '<div style="display: flex; flex-direction: column; gap: var(--space-2);">';
    statusHtml += mobileCheckboxGroup('status', currentFilters.statuses);
    statusHtml += '</div></div>';

    // Price
    // WHY: XSS fix - currentFilters berasal dari URL params.
    // Gunakan parseInt + escapeHtml sebelum masuk attribute value.
    var minPrice = parseInt(currentFilters.minPrice, 10) || '';
    var maxPrice = parseInt(currentFilters.maxPrice, 10) || '';
    var priceHtml = '<div style="margin-bottom: var(--space-6);">';
    priceHtml += '<h3 class="catalog-filter-title">Harga (Rp)</h3>';
    priceHtml += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3);">';
    priceHtml += '<div><label class="text-xs" style="color: var(--text-muted);">Minimum</label>';
    priceHtml += '<input type="number" id="mobile-price-min" class="form-input" style="padding: var(--space-2) var(--space-3); font-size: var(--text-sm);" placeholder="0" min="0" value="' + minPrice + '"></div>';
    priceHtml += '<div><label class="text-xs" style="color: var(--text-muted);">Maksimum</label>';
    priceHtml += '<input type="number" id="mobile-price-max" class="form-input" style="padding: var(--space-2) var(--space-3); font-size: var(--text-sm);" placeholder="99999999999" min="0" value="' + maxPrice + '"></div>';
    priceHtml += '</div></div>';

    // Year
    // WHY: XSS fix - cast ke number sebelum masuk attribute value
    var minYear = parseInt(currentFilters.minYear, 10) || '';
    var maxYear = parseInt(currentFilters.maxYear, 10) || '';
    var yearHtml = '<div style="margin-bottom: var(--space-6);">';
    yearHtml += '<h3 class="catalog-filter-title">Tahun</h3>';
    yearHtml += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3);">';
    yearHtml += '<div><label class="text-xs" style="color: var(--text-muted);">Dari</label>';
    yearHtml += '<input type="number" id="mobile-year-min" class="form-input" style="padding: var(--space-2) var(--space-3); font-size: var(--text-sm);" placeholder="2000" min="1990" max="2030" value="' + minYear + '"></div>';
    yearHtml += '<div><label class="text-xs" style="color: var(--text-muted);">Sampai</label>';
    yearHtml += '<input type="number" id="mobile-year-max" class="form-input" style="padding: var(--space-2) var(--space-3); font-size: var(--text-sm);" placeholder="2026" min="1990" max="2030" value="' + maxYear + '"></div>';
    yearHtml += '</div></div>';

    // Location
    var locHtml = '<div style="margin-bottom: var(--space-6);">';
    locHtml += '<h3 class="catalog-filter-title">Lokasi</h3>';
    locHtml += '<select id="mobile-location-filter" class="form-input form-select" style="padding: var(--space-2) var(--space-3); font-size: var(--text-sm);">';
    // WHY: Opsi dari data yang sama (allLocations), bukan daftar kota
    // hardcoded - supaya tidak pernah lagi kota yang tidak ada kapalnya.
    locHtml += '<option value="">' + escapeHtml(
      'Semua Lokasi'
    ) + '</option>';
    allLocations.forEach(function(loc) {
      var selected = currentFilters.location === loc ? 'selected' : '';
      locHtml += '<option value="' + escapeHtml(loc) + '" ' + selected + '>' + escapeHtml(loc) + '</option>';
    });
    locHtml += '</select></div>';

    // Ukuran (panjang dan DWT)
    var minLength = parseFloat(currentFilters.minLength) || '';
    var maxLength = parseFloat(currentFilters.maxLength) || '';
    var minDwt = parseFloat(currentFilters.minDwt) || '';
    var maxDwt = parseFloat(currentFilters.maxDwt) || '';
    var sizeHtml = '<div style="margin-bottom: var(--space-6);">';
    sizeHtml += '<h3 class="catalog-filter-title">' + escapeHtml('Ukuran') + '</h3>';
    sizeHtml += '<p class="text-xs" style="color: var(--text-muted);">' + escapeHtml('Panjang (m)') + '</p>';
    sizeHtml += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3);">';
    sizeHtml += '<div><label class="text-xs" style="color: var(--text-muted);">' + escapeHtml('Minimum') + '</label>';
    sizeHtml += '<input type="number" id="mobile-length-min" class="form-input" style="padding: var(--space-2) var(--space-3); font-size: var(--text-sm);" placeholder="0" min="0" step="1" value="' + minLength + '"></div>';
    sizeHtml += '<div><label class="text-xs" style="color: var(--text-muted);">' + escapeHtml('Maksimum') + '</label>';
    sizeHtml += '<input type="number" id="mobile-length-max" class="form-input" style="padding: var(--space-2) var(--space-3); font-size: var(--text-sm);" placeholder="999" min="0" step="1" value="' + maxLength + '"></div>';
    sizeHtml += '</div>';
    sizeHtml += '<p class="text-xs" style="color: var(--text-muted); margin-top: var(--space-3);">' + escapeHtml('DWT') + '</p>';
    sizeHtml += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3);">';
    sizeHtml += '<div><label class="text-xs" style="color: var(--text-muted);">' + escapeHtml('Minimum') + '</label>';
    sizeHtml += '<input type="number" id="mobile-dwt-min" class="form-input" style="padding: var(--space-2) var(--space-3); font-size: var(--text-sm);" placeholder="0" min="0" step="100" value="' + minDwt + '"></div>';
    sizeHtml += '<div><label class="text-xs" style="color: var(--text-muted);">' + escapeHtml('Maksimum') + '</label>';
    sizeHtml += '<input type="number" id="mobile-dwt-max" class="form-input" style="padding: var(--space-2) var(--space-3); font-size: var(--text-sm);" placeholder="99999" min="0" step="100" value="' + maxDwt + '"></div>';
    sizeHtml += '</div>';
    sizeHtml += '<p class="text-xs" style="color: var(--text-muted); margin-top: var(--space-2);">' + escapeHtml('') + '</p>';
    sizeHtml += '</div>';

    // Kelas
    var classBoxes = document.querySelectorAll('.catalog-filters input[name="class"]');
    var classHtml = '';
    if (classBoxes.length > 0) {
      classHtml = '<div style="margin-bottom: var(--space-6);">';
      classHtml += '<h3 class="catalog-filter-title">' + escapeHtml('Kelas') + '</h3>';
      classHtml += '<div style="display: flex; flex-direction: column; gap: var(--space-2);">';
      classBoxes.forEach(function(dCb) {
        var checked = currentFilters.classes.indexOf(dCb.value) !== -1 ? 'checked' : '';
        classHtml += '<label style="display: flex; align-items: center; gap: var(--space-2); cursor: pointer; min-height: 44px;">';
        classHtml += '<input type="checkbox" name="class" value="' + escapeHtml(dCb.value) + '" class="filter-checkbox mobile-filter-checkbox" ' + checked + '>';
        classHtml += '<span class="text-sm">' + escapeHtml(dCb.value) + '</span>';
        classHtml += '</label>';
      });
      classHtml += '</div></div>';
    }

    mobileContainer.innerHTML = typeHtml + statusHtml + priceHtml + yearHtml + sizeHtml + classHtml + locHtml;

    // Bind mobile checkboxes
    mobileContainer.querySelectorAll('.mobile-filter-checkbox').forEach(function(cb) {
      cb.addEventListener('change', function() {
        // WHY tidak pakai querySelector dengan value mentah: CSS selector
        // injection jika value mengandung kutip. Bandingkan di JS.
        var val = this.value, name = this.name, checked = this.checked;
        document.querySelectorAll('.catalog-filters input[name="' + name + '"]').forEach(function(dCb) {
          if (dCb.value === val) dCb.checked = checked;
        });
      });
    });
  }

  /**
   * WHY: Apply all filters with caching for performance
   */
  function applyFilters() {
    var cacheKey = getFilterCacheKey();
    
    // WHY: Use cached results if available
    if (filterCache[cacheKey]) {
      filteredVessels = filterCache[cacheKey];
    } else {
      filteredVessels = allVessels.filter(function(v) {
        var savedSet = currentFilters.savedOnly ? savedIds() : [];
        // Type filter
        if (currentFilters.types.length > 0 && currentFilters.types.indexOf(v.type) === -1) {
          return false;
        }

        // Status filter
        if (currentFilters.statuses.length > 0 && currentFilters.statuses.indexOf(v.status) === -1) {
          return false;
        }

        // Price filter (fast comparison)
        // WHY kapal tanpa harga dikeluarkan saat filter harga aktif:
        // harga kosong berarti "tidak diketahui". Sebelumnya null < min
        // bernilai true (dikeluarkan) tapi null > max bernilai false
        // (lolos) - perlakuan ganda yang menyesatkan. Prinsip yang sama
        // dengan filter DWT di bawah.
        if (currentFilters.minPrice || currentFilters.maxPrice) {
          if (v.price === null || v.price === undefined) return false;
          if (currentFilters.minPrice && v.price < currentFilters.minPrice) return false;
          if (currentFilters.maxPrice && v.price > currentFilters.maxPrice) return false;
        }

        // Year filter (fast comparison)
        // WHY sama dengan filter harga: tahun kosong = "tidak diketahui",
        // dikeluarkan saat filter tahun aktif (prinsip yang sama).
        if (currentFilters.minYear || currentFilters.maxYear) {
          if (v.year_built === null || v.year_built === undefined) return false;
          if (currentFilters.minYear && v.year_built < currentFilters.minYear) return false;
          if (currentFilters.maxYear && v.year_built > currentFilters.maxYear) return false;
        }

        // Filter panjang
        if (currentFilters.minLength && !(parseFloat(v.length) >= currentFilters.minLength)) return false;
        if (currentFilters.maxLength && !(parseFloat(v.length) <= currentFilters.maxLength)) return false;

        // Filter DWT. WHY kapal tanpa DWT dikeluarkan, bukan dianggap
        // lolos: DWT kosong berarti "tidak diketahui", danjadi dianggap 0
        // akan membuat kapal tanpa data terlihat memenuhi filter
        // minimum apa pun. The UI sudah menjelaskan hal ini.
        if (currentFilters.minDwt || currentFilters.maxDwt) {
          var dwt = parseFloat(v.dwt);
          if (!isFinite(dwt) || dwt <= 0) return false;
          if (currentFilters.minDwt && dwt < currentFilters.minDwt) return false;
          if (currentFilters.maxDwt && dwt > currentFilters.maxDwt) return false;
        }

        // Filter kelas
        if (currentFilters.classes.length > 0) {
          if (currentFilters.classes.indexOf((v.classification || '').trim()) === -1) return false;
        }

        // Location filter
        // WHY `!v.location ||` ada di dalam syarat, bukan di luar:
        // versi lama hanya menolak kapal yang lokasiNYA ADA tapi tidak
        // cocok. Kapal dengan lokasi kosong sama sekali lolos dari
        // filter kota mana pun - jadi memilih "Surabaya" bisa
        // menampilkan kapal yang tidak di Surabaya.
        // Seluruh 15 kapal sekarang punya lokasi, jadi bug ini belum
        // terlihat; ini penjaga saat armada bertambah.
        if (currentFilters.location &&
            (!v.location || v.location.indexOf(currentFilters.location) === -1)) {
          return false;
        }

        // Filter shortlist
        if (currentFilters.savedOnly && savedSet.indexOf(v.id) === -1) {
          return false;
        }

        // WHY: Search using pre-built index (faster than concatenating strings)
        if (currentFilters.search) {
          var q = currentFilters.search.toLowerCase();
          if (searchIndex[v.id] && searchIndex[v.id].indexOf(q) === -1) return false;
        }

        return true;
      });

      // WHY: Cache the results
      filterCache[cacheKey] = filteredVessels;
      clearOldCache();
    }

    // Sort
    sortVessels();

    // WHY guard: elemen tampilan opsional - filter tetap jalan walau
    // satu panel hilang dari HTML.
    function setDisplay(id, value) {
      var el = document.getElementById(id);
      if (el) el.style.display = value;
    }

    // Update count
    var resultsNumber = document.getElementById('results-number');
    if (resultsNumber) resultsNumber.textContent = filteredVessels.length;

    // Show empty or results
    if (filteredVessels.length === 0) {
      setDisplay('vessels-grid', 'none');
      setDisplay('empty-state', 'block');
      setDisplay('pagination', 'none');
    } else {
      setDisplay('vessels-grid', '');
      setDisplay('empty-state', 'none');
      renderPage();
    }

    updateFilterCount();
  }

  /**
   * Sort vessels
   */
  function sortVessels() {
    var sortValue = document.getElementById('sort-select').value;

    filteredVessels.sort(function(a, b) {
      switch (sortValue) {
        case 'newest':
          return (b.year_built || 0) - (a.year_built || 0);
        case 'oldest':
          return (a.year_built || 0) - (b.year_built || 0);
        case 'price-low':
          return (a.price || 0) - (b.price || 0);
        case 'price-high':
          return (b.price || 0) - (a.price || 0);
        case 'name':
          return (a.name || '').localeCompare(b.name || '');
        case 'size-desc':
          return (parseFloat(b.length) || 0) - (parseFloat(a.length) || 0);
        case 'tonnage-desc':
          return (parseFloat(b.gross_tonnage) || 0) - (parseFloat(a.gross_tonnage) || 0);
        default:
          return 0;
      }
    });
  }

  /**
   * WHY: Render current page using document fragment for performance
   * Batch DOM insertion reduces reflows by 90%+
   */
  function renderPage() {
    var grid = document.getElementById('vessels-grid');
    // WHY guard: tanpa grid tidak ada yang bisa di-render.
    if (!grid) return;
    // WHY: pagination dihapus — semua kapal tampil sekaligus.
    var pageItems = filteredVessels;
    // WHY: Use document fragment for batch insertion
    var fragment = document.createDocumentFragment();

    pageItems.forEach(function(v) {
      // WHY <template>: markup kartu dibangun satu pembangun bersama
      // (VesselData.buildCardHtml, dipakai beranda juga) dan hasilnya sudah
      // berupa <article class="catalog-card">. Menaruhnya di <template>
      // membuat elemen itu bisa disalin ke fragment - batching DOM tetap
      // satu reflow seperti sebelumnya, tanpa .catalog-card bersarang.
      var cetakan = document.createElement('template');
      cetakan.innerHTML = window.VesselData.buildCardHtml(v, {
        // WHY CARD_SIZES milik halaman ini, bukan milik data.js: lebar
        // grid katalog (3 kolom ~31vw) beda dari beranda (~30vw), dan
        // sizes yang salah membuat srcset memilih kandidat kelewat besar.
        sizes: CARD_SIZES,
        // WHY hanya katalog: tombol simpan shortlist memang fitur halaman
        // ini. Beranda sebaliknya menyalakan carousel foto.
        saveButton: true
      });
      // WHY guard: buildCardHtml tidak pernah mengembalikan string kosong
      // saat ini, tapi appendChild(null) akan throw tanpa guard ini.
      var cardEl = cetakan.content.firstElementChild;
      if (cardEl) fragment.appendChild(cardEl);
    });

    // WHY: Clear and insert in single reflow
    grid.innerHTML = '';
    grid.appendChild(fragment);

    renderPagination();
  }

  /**
   * WHY Escape HTML to prevent XSS (Section 2.2)
   * WHY delegasi ke js/sanitize.js: implementasi tunggal, bukan
   * satu per file. Salinan yang berbeda-beda di empat file inilah
   * yang dulu membuat satu halaman punya escaping lebih ketat dari
   * yang lain tanpa ada yang menyadarinya.
   */
  // WHY fallback: jika js/sanitize.js gagal dimuat (404/network), situs
  // tidak boleh mati total. Fallback minimal ini cukup untuk escaping dasar.
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

  // WHY: Seluruh markup kartu (termasuk src dan srcset) dibangun di
  // VesselData.buildCardHtml(), jadi exit code 0 untuk jalur tanpa DOM.
  // Jika ini fungsi ditambahkan di sini, sisa checklist (buildCardHtml) harus
  // tetap di tempat tersebut.

  /**
   * WHY: Render pagination with document fragment for performance
   */
  function renderPagination() {
    // WHY: pagination dihapus — semua kapal tampil sekaligus,
    // jadi kontrol halaman selalu disembunyikan.
    var container = document.getElementById('pagination');
    if (container) container.style.display = 'none';
  }

  /**
   * Update filter count badge
   */
  function updateFilterCount() {
    var count = 0;
    if (currentFilters.types.length > 0) count++;
    if (currentFilters.statuses.length !== 1 || currentFilters.statuses[0] !== 'available') count++;
    if (currentFilters.minPrice || currentFilters.maxPrice) count++;
    if (currentFilters.minYear || currentFilters.maxYear) count++;
    if (currentFilters.minLength || currentFilters.maxLength) count++;
    if (currentFilters.minDwt || currentFilters.maxDwt) count++;
    // WHY kelas punya barisnya sendiri: populateClassFilter()
    // berjalan setelah data dimuat, jadi checkbox kelas tidak ikut
    // terhitung lewat loop .filter-checkbox di bindEvents().
    if (currentFilters.classes.length > 0) count++;
    if (currentFilters.location) count++;

    var badge = document.getElementById('filter-count');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }

  /**
   * WHY: Reset all filters and clear cache
   */
  function resetFilters() {
    // WHY helper set(): reset tidak boleh throw kalau satu input hilang.
    function set(id, value) {
      var el = document.getElementById(id);
      if (el) el.value = value;
    }

    // Checkboxes
    document.querySelectorAll('.catalog-filters input[name="type"]').forEach(function(cb) {
      cb.checked = false;
    });
    document.querySelectorAll('.catalog-filters input[name="status"]').forEach(function(cb) {
      cb.checked = cb.value === 'available';
    });

    // Price
    set('price-min', '');
    set('price-max', '');

    // Year
    set('year-min', '');
    set('year-max', '');

    // Ukuran
    ['length-min', 'length-max', 'dwt-min', 'dwt-max'].forEach(function(id) {
      set(id, '');
    });

    // Kelas
    document.querySelectorAll('.catalog-filters input[name="class"]').forEach(function(cb) {
      cb.checked = false;
    });

    // Location
    set('location-filter', '');

    // Shortlist
    var savedOnly = document.getElementById('saved-only');
    if (savedOnly) savedOnly.checked = false;

    // Search
    set('catalog-search', '');

    // Reset state
    currentFilters = {
      types: [],
      statuses: ['available'],
      minPrice: null,
      maxPrice: null,
      minYear: null,
      maxYear: null,
      minLength: null,
      maxLength: null,
      minDwt: null,
      maxDwt: null,
      classes: [],
      location: '',
      savedOnly: false,
      search: ''
    };

    // WHY: Clear filter cache on reset
    filterCache = {};

    currentPage = 1;
    syncDesktopToMobile();
    applyFilters();
    updateUrlParams();
  }

  /**
   * Loading state
   */
  function showLoading(show) {
    // WHY guard: skeleton/grid tidak ada (mis. HTML berubah) tidak boleh
    // mematikan init().
    var skeleton = document.getElementById('loading-skeleton');
    var grid = document.getElementById('vessels-grid');
    if (skeleton) skeleton.style.display = show ? '' : 'none';
    if (grid) grid.style.display = show ? 'none' : '';
  }

  /**
   * Mobile filter drawer
   */
  function openFilterDrawer() {
    syncDesktopToMobile();
    document.getElementById('filter-drawer').classList.add('active');
    // WHY overflow asli disimpan dulu: drawer perbandingan kapal
    // juga mengunci scroll, dan menimpa nilai blindly membuat
    // halaman terkunci scroll setelah salah satu ditutup.
    filterOverflowBefore = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // WHY fokus masuk ke drawer: tanpa ini fokus tetap di tombol
    // filter yang berada di belakang panel yang terbuka, jadi
    // pembaca layar menganggap drawer belum terbuka (WCAG 2.4.3).
    if (window.App && window.App.trapFocus) {
      releaseFilterTrap = window.App.trapFocus(
        document.getElementById('filter-drawer'),
        {
          isOpen: function () {
            var d = document.getElementById('filter-drawer');
            return !!(d && d.classList.contains('active'));
          },
          onClose: closeFilterDrawer
        }
      );
    }
  }

  function closeFilterDrawer() {
    var drawer = document.getElementById('filter-drawer');
    if (!drawer) return;
    drawer.classList.remove('active');
    document.body.style.overflow = filterOverflowBefore;
    filterOverflowBefore = '';
    if (releaseFilterTrap) { releaseFilterTrap(); releaseFilterTrap = null; }

    // WHY fokus dikembalikan ke tombol pemicu: setelah drawer
    // tertutup, fokus yang masih di dalam panel yang tersembunyi
    // membuat Tab berikutnya melompat ke tempat yang tidak
    // terduga. Ini pola yang sama dengan menu mobile.
    var toggle = document.getElementById('filter-toggle');
    if (toggle && toggle.focus) toggle.focus();
  }

  /** Parameter URL dari state filter. URL dan canonical lahir dari daftar
   *  yang sama; shortlist dilewati lewat skipSaved (isinya per pengunjung). */
  function filterParams(skipSaved) {
    var p = new URLSearchParams(), f = currentFilters;
    if (f.types.length) p.set('type', f.types.join(','));
    if (f.search) p.set('q', f.search);
    if (f.location) p.set('loc', f.location);
    // WHY status default tidak ditulis: 'available' = mayoritas.
    if (f.statuses.join(',') !== 'available') p.set('status', f.statuses.join(','));
    if (f.minPrice) p.set('pmin', f.minPrice);
    if (f.maxPrice) p.set('pmax', f.maxPrice);
    if (f.minYear) p.set('ymin', f.minYear);
    if (f.maxYear) p.set('ymax', f.maxYear);
    if (f.minLength) p.set('lmin', f.minLength);
    if (f.maxLength) p.set('lmax', f.maxLength);
    if (f.minDwt) p.set('dmin', f.minDwt);
    if (f.maxDwt) p.set('dmax', f.maxDwt);
    if (f.classes.length) p.set('cls', f.classes.join(','));
    if (!skipSaved && f.savedOnly) p.set('saved', '1');
    return p;
  }

  function updateUrlParams() {
    var s = filterParams().toString();
    window.history.replaceState({}, '', window.location.pathname + (s ? '?' + s : ''));
    syncFilterMeta();
  }

  /** Ringkasan filter aktif untuk judul/deskripsi (status default dan
   *  shortlist sengaja tidak muncul - keduanya bukan kriteria). */
  function filterSummary() {
    var f = currentFilters, p = [];
    if (f.types.length) p.push(f.types.map(function(t) { return window.VesselData.vesselTypeLabel(t); }).join(' / '));
    if (f.location) p.push(f.location);
    if (f.statuses.join(',') !== 'available') p.push(f.statuses.map(function(s) { return window.VesselData.vesselStatusLabel(s); }).join(' / '));
    if (f.classes.length) p.push('kelas ' + f.classes.join(' / '));
    if (f.minYear || f.maxYear) p.push('tahun ' + (f.minYear || '') + '-' + (f.maxYear || ''));
    if (f.minLength || f.maxLength) p.push('panjang ' + (f.minLength || '') + '-' + (f.maxLength || '') + ' m');
    if (f.minDwt || f.maxDwt) p.push('DWT ' + (f.minDwt || '') + '-' + (f.maxDwt || ''));
    if (f.minPrice || f.maxPrice) p.push('harga sesuai rentang');
    if (f.search) p.push('"' + f.search + '"');
    return p.join(' \u00b7 ');
  }

  /**
   * Selaraskan canonical/robots/judul/deskripsi dengan filter aktif.
   * WHY canonical self saat ada filter: canonical statis tanpa parameter
   * membuat tiap hasil saringan diringkas ke satu halaman. WHY shortlist
   * noindex: isinya per pengunjung, jadi URL sama bisa tampil beda.
   */
  function syncFilterMeta() {
    if (!ORIGINAL_META) {
      var d0 = document.querySelector('meta[name="description"]');
      ORIGINAL_META = { desc: d0 ? d0.getAttribute('content') : '', title: document.title };
    }
    var qs = filterParams(true).toString();
    var url = SITE_ORIGIN + '/catalog.html' + (qs ? '?' + qs : '');
    var canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', url);
    var robots = document.querySelector('meta[name="robots"]');
    if (robots) robots.setAttribute('content', currentFilters.savedOnly ? 'noindex, follow' : 'index, follow');
    var summary = filterSummary();
    var desc = document.querySelector('meta[name="description"]');
    var titleEl = document.querySelector('title');
    if (summary) {
      if (desc) desc.setAttribute('content', ('Katalog kapal ' + summary + '. Spesifikasi lengkap, harga transparan.').slice(0, 158));
      if (titleEl) titleEl.textContent = 'Katalog Kapal ' + summary + ' | KapalPro';
    } else {
      if (desc) desc.setAttribute('content', ORIGINAL_META.desc);
      if (titleEl) titleEl.textContent = ORIGINAL_META.title;
    }
  }

  function loadUrlParams() {
    var params = new URLSearchParams(window.location.search);

    // WHY: Security - whitelist tipe yang valid, dan JANGAN pakai
    // querySelector dengan string URL mentah (CSS selector injection).
    // Daftar dari VESSEL_TYPE_LABELS (bukan hardcoded) supaya tipe baru
    // tidak perlu diubah di dua tempat. Checkbox dicentang nanti di
    // populateTypeFilter() dari currentFilters.
    var VALID_TYPES = (window.VesselData && window.VesselData.vesselTypes)
      ? window.VesselData.vesselTypes().map(function(t) { return t.key; })
      : ['tongkang', 'tugboat', 'lct', 'spob', 'oil_barge', 'tanker', 'other'];

    if (params.get('type')) {
      var types = params.get('type').split(',');
      types.forEach(function(t) {
        if (VALID_TYPES.indexOf(t) === -1) return; // WHY: reject nilai asing
        // WHY dedupe: ?type=a,a tidak boleh menggandakan state.
        if (currentFilters.types.indexOf(t) !== -1) return;
        currentFilters.types.push(t);
      });
    }

    // WHY set(): loadUrlParams jalan di bindEvents, dan elemen yang hilang
    // tidak boleh melempar - konsisten dengan guard di fungsi lain.
    function set(id, value) {
      var el = document.getElementById(id);
      if (el) el.value = value;
    }

    if (params.get('q')) {
      // WHY: .value assignment aman (bukan HTML injection), tapi
      // batasi panjang untuk sanity
      var q = params.get('q').slice(0, 100);
      set('catalog-search', q);
      currentFilters.search = q;
    }

    if (params.get('loc')) {
      var loc = params.get('loc').slice(0, 50);
      // WHY opsi belum ada saat ini (dibangun setelah data dimuat), jadi
      // dropdown diselaraskan di populateLocationFilter(). Nilai disimpan
      // dulu di state.
      currentFilters.location = loc;
    }

    if (params.get('pmin')) {
      currentFilters.minPrice = parseInt(params.get('pmin'), 10) || null;
      set('price-min', currentFilters.minPrice || '');
    }
    if (params.get('pmax')) {
      currentFilters.maxPrice = parseInt(params.get('pmax'), 10) || null;
      set('price-max', currentFilters.maxPrice || '');
    }

    if (params.get('ymin')) {
      currentFilters.minYear = parseInt(params.get('ymin'), 10) || null;
      set('year-min', currentFilters.minYear || '');
    }
    if (params.get('ymax')) {
      currentFilters.maxYear = parseInt(params.get('ymax'), 10) || null;
      set('year-max', currentFilters.maxYear || '');
    }

    // WHY parseFloat, bukan parseInt: panjang kapal pecahan (46.83 m)
    // dan DWT bisa bernilai desimal. parseInt akan membulatkan ke
    // bawah dan kapal 46.83 m tidak akan muncul di filter "46 m
    // ke atas" padahal jelas boleh.
    [['lmin', 'minLength', 'length-min'], ['lmax', 'maxLength', 'length-max'],
     ['dmin', 'minDwt', 'dwt-min'], ['dmax', 'maxDwt', 'dwt-max']
    ].forEach(function(pair) {
      if (!params.get(pair[0])) return;
      var val = parseFloat(params.get(pair[0]));
      if (!isFinite(val) || val < 0) return;
      currentFilters[pair[1]] = val;
      set(pair[2], val);
    });

    if (params.get('cls')) {
      params.get('cls').split(',').forEach(function(c) {
        var name = c.slice(0, 40);
        document.querySelectorAll('.catalog-filters input[name="class"]').forEach(function(cb) {
          if (cb.value === name) cb.checked = true;
        });
        if (currentFilters.classes.indexOf(name) !== -1) return;
        currentFilters.classes.push(name);
      });
    }

    // Status - whitelist seperti tipe: nilai URL dipakai untuk mencentang.
    if (params.get('status')) {
      var VALID_STATUS = ['available', 'reserved', 'sold'];
      var chosenStatus = params.get('status').split(',').filter(function(s) { return VALID_STATUS.indexOf(s) !== -1; });
      // WHY hanya ganti kalau ada yang valid: sampah tidak boleh mematikan default.
      if (chosenStatus.length) {
        currentFilters.statuses = chosenStatus;
        document.querySelectorAll('.catalog-filters input[name="status"]').forEach(function(cb) {
          cb.checked = chosenStatus.indexOf(cb.value) !== -1;
        });
      }
    }
    // Shortlist (per pengunjung)
    if (params.get('saved') === '1') {
      var savedBox = document.getElementById('saved-only');
      if (savedBox) savedBox.checked = true;
      currentFilters.savedOnly = true;
    }

    updateFilterCount();
    // WHY di sini: state dari URL sudah lengkap, jadi canonical dan meta
    // bisa selaras sejak muat pertama, bukan baru saat filter disentuh.
    syncFilterMeta();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
