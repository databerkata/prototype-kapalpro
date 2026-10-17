/**
 * Vessel Detail Page Logic
 * Handles gallery, specs, lightbox, inquiry form, related vessels
 */

(function() {
  'use strict';

  // ============================================================
  // SECURITY HELPERS (Section 2.2)
  // WHY: Data kapal berasal dari Google Sheets yang bisa diedit
  // siapa pun dengan akses - semua nilai harus di-escape sebelum
  // masuk innerHTML, dan URL gambar harus divalidasi whitelist
  // protokolnya.
  // ============================================================

  /**
   * Escape HTML entities untuk mencegah XSS
   * WHY delegasi ke js/sanitize.js: implementasi tunggal untuk
   * seluruh situs. Yang lokal di file ini sudah cukup ketat, tapi
   * tetap harus dijaga seragam - dan itu tidak pernah terjadi
   * ketika salah satunya lupa diperbarui.
   */
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
   * Origin situs. Dipakai untuk membangun URL absolut pada canonical,
   * og:url, og:image, twitter:image, dan JSON-LD.
   * WHY: Halaman kapal menyimpan path gambar relatif di vessels.json.
   * Crawler media sosial dan validator structured data menolak URL
   * relatif, sehingga preview-nya hilang total tanpa error yang terlihat.
   * WHY dari config: nilai ini ditulis di tiga tempat (config.js,
   * catalog.js, vessel.js) dan pasti drift. Sumber tunggal adalah
   * window.KAPALPRO_CONFIG.siteUrl; fallback menjaga halaman tetap
   * jalan kalau config.js gagal dimuat.
   */
  var SITE_ORIGIN = (window.KAPALPRO_CONFIG && window.KAPALPRO_CONFIG.siteUrl) || 'https://databerkata.github.io/prototype-kapalpro';

  /**
   * Validasi URL gambar: hanya host yang diizinkan dan path di assets/
   * WHY: Memblokir javascript:, data:, dan host asing yang bisa dipakai
   * untuk(Constants) memuat gambar dari server lain tanpa jejak.
   */
  function safeImageUrl(url) { return Sanitize.safeImageUrl(url); }

  /**
   * WHY: Get vessel ID dari URL.
   * Tiga sumber, berurutan dari yang paling eksplisit:
   *   1. ?id=...  - vessel.html?id=X (URL lama, masih dipakai)
   *   2. <body data-vessel-id="X"> - ditulis generator halaman statis,
   *      jadi ID tidak pernah hilang walau path-nya di-rewrite server
   *   3. /vessel-X.html - pola nama berkas hasil generate-vessel-pages.js
   * Tanpa (2) dan (3), halaman statis akan melihat ID null dan
   * menampilkan "Vessel ID not found" di atas konten yang sudah lengkap.
   */
  function getVesselId() {
    var params = new URLSearchParams(window.location.search);
    var fromQuery = params.get('id');
    if (fromQuery) return fromQuery;

    var bodyId = document.body && document.body.getAttribute('data-vessel-id');
    if (bodyId) return bodyId;

    var m = window.location.pathname.match(/\/vessel-([A-Za-z0-9_-]+)\.html$/);
    return m ? m[1] : null;
  }

  // WHY: Spec label dalam Bahasa Indonesia. Dulu peta ini punya
  // cabang {id: ..., en: ...} karena tabel spesifikasi ikut berubah
  // saat tombol bahasa ditekan.
  var SPEC_LABELS = {
    year_built: 'Tahun Pembuatan',
    length: 'Panjang',
    beam: 'Lebar (Beam)',
    depth: 'Kedalaman (Depth)',
    draft: 'Draft',
    dwt: 'DWT (Deadweight Tonnage)',
    gross_tonnage: 'Gross Tonnage',
    net_tonnage: 'Net Tonnage',
    speed_knots: 'Kecepatan',
    engine_type: 'Tipe Mesin',
    engine_power: 'Daya Mesin',
    fuel_type: 'Tipe Bahan Bakar',
    flag_state: 'Bendera',
    classification: 'Klasifikasi',
    class_notation: 'Notasi Klasifikasi',
    last_dock: 'Drydock Terakhir'
  };

  // WHY: Helper - ambil label spesifikasi Bahasa Indonesia
  function specLabel(key) {
    return SPEC_LABELS[key] || key;
  }

  var SPEC_UNITS = {
    length: 'm',
    beam: 'm',
    depth: 'm',
    draft: 'm',
    dwt: 'DWT',
    gross_tonnage: 'GT',
    net_tonnage: 'NT',
    speed_knots: 'knots'
  };

  // WHY: Type name mapping// WHY: Label jenis dan status kapal TIDAK boleh didefinisikan di sini.
// Satu-satunya sumbernya VesselData.vesselTypeLabel() dan
// vesselStatusLabel(). Versi lama punya salinan sendiri (TYPE_NAMES /
// STATUS_NAMES) dengan kamus en di sampingnya, jadi label yang sama
// punya dua tempatnancya - dan saat data menambah jenis baru, hanya
// salah satu yang ikut diperbarui.

  // WHY: Nilai sizes yang sama untuk <source> WebP dan <img> JPEG pada
  // kartu kapal sejenis.
  var RELATED_CARD_SIZES = '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px';

  var STATUS_BADGES = {
    available: 'badge-success',
    sold: 'badge-danger',
    reserved: 'badge-warning'
  };

  /**
   * Ubah path relatif menjadi URL absolut.
   * Diperlukan untuk og:image / twitter:image yang hanya diterima crawler
   * dalam bentuk absolut. URL yang sudah absolut tidak diubah.
   */
  function absoluteUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    // WHY: data URL (upload foto via /admin) bukan path relatif - prepend
    // origin akan menghasilkan og:image tidak valid.
    if (/^data:/i.test(path)) return path;
    return SITE_ORIGIN + '/' + String(path).replace(/^\/+/, '');
  }

  /**
   * URL kanonik satu kapal.
   *
   * WHY selalu URL bersih (vessel-<ID>.html) dan bukan vessel.html?id=<ID>:
   * tools/generate-vessel-pages.js menulis berkas statis dengan nama itu,
   * sehingga canonical, JSON-LD @id, dan tautan antar kapal semuanya
   * menunjuk satu alamat yang benar-benar ada di server. URL lama tetap
   * dibaca (getVesselId) dan dialihkan, tapi tidak pernah dipropagasikan.
   */
  function vesselUrl(id) {
    return SITE_ORIGIN + '/vessel-' + encodeURIComponent(id) + '.html';
  }

  /**
   * Tautan relatif untuk di dalam <a href>, mengikuti halaman asal.
   * Dipakai supaya tautan tetap bekerja di localhost tanpa konfigurasi.
   */
  function vesselHref(id) {
    return 'vessel-' + encodeURIComponent(id) + '.html';
  }

  /**
   * Pasang ATAU lepas <source type="image/webp"> untuk gambar utama kapal.
   *
   * WHY <picture> sudah ada di vessel.html, bukan disisipkan lewat JS:
   * elemen <source> hanya dibaca browser bila induknya benar-benar
   * <picture>. Versi lama menyisipkan <source> ke dalam <div> wrapper,
   * sehingga browser diam-diam mengabaikannya dan mengunduh JPEG 1600px.
   *
   * WHY fungsi ini PEMILIK TUNGGAL ada/tidaknya elemen itu, bukan
   * pemanggilnya: templet vessel.html membawa srcset statis milik foto
   * hero, dan browser memilih kandidat srcset MENGABAIKAN src. Jadi saat
   * fotonya tidak punya varian WebP (mis. data URL upload /admin),
   * elemen source harus benar-benar DIHAPUS, bukan sekadar dikosongkan.
   * Versi sebelumnya memeriksa keberadaan varian TANPA includeFull di
   * pemanggil lalu memasangnya DENGAN includeFull di sini: dua predikat
   * berbeda untuk satu keputusan, dan manifest yang hanya punya webpFull
   * membuat source yang sebenarnya terisi ikut terhapus - halaman tetap
   * benar tapi diam-diam menyajikan JPEG besar.
   *
   * WHY elemen dibuat ulang kalau hilang: render kapal lain di halaman
   * yang sama bisa saja punya varian WebP; tanpa pembuatan ulang,
   * optimasi itu hilang diam-diam untuk render berikutnya.
   */
  function applyWebpToMainImage(url) {
    var mainImage = document.getElementById('vessel-main-image');
    var picture = mainImage ? mainImage.parentNode : null;
    var source = document.getElementById('vessel-main-webp');

    // WHY includeFull=true: berkas WebP penuh juga varian WebP. Predikat
    // ini yang menentukan elemen dipertahankan atau dihapus.
    var webp = window.VesselData.buildSrcSetWebp(url, window.VesselData.CARD_WIDTHS, true);

    if (!webp) {
      if (source && source.parentNode) source.parentNode.removeChild(source);
      return;
    }

    if (!source) {
      if (!picture) return;
      source = document.createElement('source');
      source.id = 'vessel-main-webp';
      source.type = 'image/webp';
      // WHY sizes ditiru dari <img>, bukan ditulis ulang sebagai literal:
      // nilai yang berbeda antara <source> dan <img> membuat browser
      // memilih lebar berbeda per format lalu memotong gambar.
      var imgSizes = mainImage.getAttribute('sizes');
      if (imgSizes) source.setAttribute('sizes', imgSizes);
      picture.insertBefore(source, picture.firstChild);
    }
    source.setAttribute('srcset', webp);
  }

  /**
   * Update meta tags for SEO
   */
  function updateMetaTags(vessel) {
    var cleanUrl = vesselUrl(vessel.id);
    var typeName = window.VesselData.vesselTypeLabel(vessel.type);
    var description = vessel.description || (vessel.name + ' - ' + typeName + ' di ' + (vessel.location || 'Indonesia'));
    
    // Title
    var titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = vessel.name + ' | ' + typeName + ' - KapalPro';
    
    // Meta description
    var descEl = document.getElementById('page-description');
    if (descEl) descEl.setAttribute('content', description.substring(0, 160));
    
    // Keywords
    var kwEl = document.getElementById('page-keywords');
    if (kwEl) kwEl.setAttribute('content', vessel.name + ', ' + typeName + ', kapal, ' + (vessel.location || ''));
    
    // Canonical
    var canonicalEl = document.getElementById('page-canonical');
    if (canonicalEl) canonicalEl.setAttribute('href', cleanUrl);
    
    // Open Graph
    var ogTitle = document.getElementById('og-title');
    if (ogTitle) ogTitle.setAttribute('content', vessel.name + ' - KapalPro');
    
    var ogDesc = document.getElementById('og-description');
    if (ogDesc) ogDesc.setAttribute('content', description.substring(0, 200));
    
    var ogUrl = document.getElementById('og-url');
    if (ogUrl) ogUrl.setAttribute('content', cleanUrl);
    
    // WHY: og:image WAJIB URL absolut. main_image_url di vessels.json
    // disimpan relatif ("assets/vessels/..."), dan crawler Facebook,
    // Twitter/X, serta LinkedHost menolaknya - hasilnya tautan kapal
    // yang dibagikan tidak punya preview sama sekali.
    var ogImage = document.getElementById('og-image');
    if (ogImage && vessel.main_image_url) {
      ogImage.setAttribute('content', absoluteUrl(vessel.main_image_url));
    }
    // WHY: Dimensi og:image harus ikut foto kapal, bukan angka statis
    // 1200x630 milik gambar bawaan. Tanpa ini platform sosial memotong
    // atau meregangkan preview. Sumbernya manifest varian, yang sudah
    // mencatat ukuran asli tiap foto.
    var info = (window.VesselData && window.VesselData.getVariantInfo)
      ? window.VesselData.getVariantInfo(vessel.main_image_url)
      : null;
    var ogImageW = document.getElementById('og-image-width');
    var ogImageH = document.getElementById('og-image-height');
    if (ogImageW && info && info.width) ogImageW.setAttribute('content', String(info.width));
    if (ogImageH && info && info.height) ogImageH.setAttribute('content', String(info.height));
    
    // Twitter Card
    var twTitle = document.getElementById('tw-title');
    if (twTitle) twTitle.setAttribute('content', vessel.name + ' - KapalPro');
    
    var twDesc = document.getElementById('tw-description');
    if (twDesc) twDesc.setAttribute('content', description.substring(0, 200));
    
    var twImage = document.getElementById('tw-image');
    if (twImage && vessel.main_image_url) {
      twImage.setAttribute('content', absoluteUrl(vessel.main_image_url));
    }
  }

  /**
   * Halaman kapal yang tidak ada harus TIDAK terlihat seperti halaman
   * yang berhasil dimuat.
   *
   * WHY ini penting: server mengembalikan HTTP 200 untuk
   * /vessel.html?id=NGGAWUR karena berkasnya memang ada - yang hilang
   * hanya record-nya. Akibatnya crawler menyimpang "halaman valid dengan
   * konten tipis" dan tetap menahan URL tersebut di indeks. Sebelum ini
   * meta robots tetap "index, follow" dan form inquiry lengkap beserta
   * tombol WhatsApp masih tampil, sehingga pengunjung mengira kapal ada.
   *
   * Yang dilakukan di sini:
   *   1. meta robots -> noindex, follow (follow supaya tautan keluar
   *      dari halaman ini tetap dirayapi)
   *   2. sembunyikan blok yang membuat halaman tampak "berisi":
   *      form inquiry, sidebar harga, dan related. Menampilkan tombol
   *      "Kirim Inquiry" untuk kapal yang tidak ada adalah ajakan
   *      untuk menanyakan barang yang tidak dijual.
   *   3. sisipkan tautan ke katalog sebagai jalan keluar.
   */
  function markVesselMissing() {
        var robots = document.querySelector('meta[name="robots"]');
    if (robots) robots.setAttribute('content', 'noindex, follow');

    var canonical = document.getElementById('page-canonical');
    if (canonical) canonical.remove();

    ['inquiry-section', 'related-vessels', 'all-vessels'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.hidden = true;
    });
    // Sidebar tidak punya id, jadi harus dicari lewat kelas.
    Array.prototype.forEach.call(
      document.querySelectorAll('.vessel-sidebar'),
      function(el) { el.hidden = true; }
    );

    var note = document.createElement('p');
    note.className = 'text-sm';
    note.style.color = 'var(--text-muted)';
    note.style.marginTop = 'var(--space-4)';
    note.innerHTML = '<a href="catalog.html">' + escapeHtml('Katalog') + '</a>';
    var title = document.getElementById('vessel-title');
    if (title && title.parentNode) title.parentNode.insertBefore(note, title.nextSibling);
  }

  /**
   * Render vessel data to page
   */
  function renderVessel(vessel) {
    // WHY set()/setVal(): render tidak boleh throw kalau satu id hilang
    // dari HTML - konsisten dengan guard di modul katalog.
    function set(id, value) {
      var el = document.getElementById(id);
      if (el) el.textContent = value;
    }
    function setVal(id, value) {
      var el = document.getElementById(id);
      if (el) el.value = value;
    }

    /**
     * Pastikan opsi tipe kapal ada di dropdown inquiry.
     * WHY: tipe di luar daftar hardcoded (mis. oil_barge di vessel.html)
     * membuat setVal gagal diam-diam dan dropdown kosong.
     */
    function ensureTypeOption(type) {
      var select = document.getElementById('inquiry-vessel-type-select');
      if (!select || !type) return;
      var exists = false;
      for (var i = 0; i < select.options.length; i++) {
        if (select.options[i].value === type) { exists = true; break; }
      }
      if (!exists) {
        var label = (window.VesselData && window.VesselData.vesselTypeLabel)
          ? window.VesselData.vesselTypeLabel(type)
          : type;
        var opt = document.createElement('option');
        opt.value = type;
        opt.textContent = label;
        select.appendChild(opt);
      }
    }

    // WHY: Pesan error ikut dua bahasa - sebelumnya teks Indonesia
    // keras sehingga tetap Bahasa Indonesia saat pengguna beralih ke English.
        if (!vessel) {
      set('vessel-title', 'Kapal tidak ditemukan');
      set('breadcrumb-name', 'Kapal tidak ditemukan');
      markVesselMissing();
      return;
    }

        // WHY: Update page title
    document.title = vessel.name + ' - KapalPro';
    
    // WHY: Update meta tags for SEO
    updateMetaTags(vessel);
    
    // WHY: Add structured data for search engines
    addStructuredData(vessel);

    // Breadcrumbs
    set('breadcrumb-name', vessel.name);

    // Badges - hanya ditampilkan bila membawa informasi baru.
    // Status 'available' adalah default semua kapal, dan jenis sudah
    // tertulis di nama kapal pada hampir semua kasus.
    var typeBadge = document.getElementById('vessel-type-badge');
    if (window.VesselData.shouldShowType(vessel)) {
      typeBadge.textContent = window.VesselData.vesselTypeLabel(vessel.type);
      typeBadge.hidden = false;
    } else {
      typeBadge.hidden = true;
    }

    var statusBadge = document.getElementById('vessel-status-badge');
    if (window.VesselData.shouldShowStatus(vessel)) {
      statusBadge.textContent = window.VesselData.vesselStatusLabel(vessel.status);
      statusBadge.className = 'badge ' + (STATUS_BADGES[vessel.status] || 'badge-primary');
      statusBadge.hidden = false;
    } else {
      statusBadge.hidden = true;
    }

    // Year
    var yearEl = document.getElementById('vessel-year');
    if (yearEl) yearEl.textContent = vessel.year_built ? 'Tahun ' + vessel.year_built : '';

    // WHY: Kalau semua anak tersembunyi (tidak ada badge, kapal tanpa
    // tahun pembuatan), wrapper flex akan meninggalkan celah kosong
    // setinggi margin-bottom-nya. Sembunyikan wrapper-nya juga.
    var badgesWrap = document.getElementById('vessel-badges');
    if (badgesWrap) {
      var hasVisible = false;
      Array.prototype.forEach.call(badgesWrap.children, function(child) {
        if (!child.hidden && child.textContent.trim()) hasVisible = true;
      });
      badgesWrap.hidden = !hasVisible;
    }

    // Title
    set('vessel-title', vessel.name);

    // Location
    set('vessel-location', vessel.location || '-');
    set('vessel-port', vessel.port_location || '-');
    // WHY baris pelabuhan disembunyikan kalau isinya sama dengan lokasi:
    // dua baris identik dengan ikon berbeda terlihat seperti baris hasil
    // duplikasi, bukan informasi. Aturan yang sama dengan yang di-
    // tools/generate-vessel-pages.js untuk halaman statis.
    var portRow = document.getElementById('vessel-port-row');
    if (portRow) {
      portRow.hidden = !vessel.port_location ||
        vessel.port_location === vessel.location;
    }

    // Highlights
    renderHighlights(vessel.highlights);

    // Specs table
    renderSpecs(vessel);

    // Sidebar
    renderSidebar(vessel);

    // Gallery
    renderGallery(vessel);

    // WhatsApp links
    renderWhatsApp(vessel);

    // Hidden form fields
    setVal('inquiry-vessel-name', vessel.name);
    setVal('inquiry-vessel-type', vessel.type);
    // WHY opsi ditambah dinamis: vessel.html (jalur ?id=) opsinya hardcoded
    // tanpa oil_barge, sedangkan halaman statis disisipi generator. Tanpa
    // ini dropdown jatuh ke kosong untuk tipe di luar daftar.
    ensureTypeOption(vessel.type);
    setVal('inquiry-vessel-type-select', vessel.type);

    // Related vessels
    renderRelatedVessels(vessel);

    // Tombol shortlist
    var saveBtn = document.getElementById('save-vessel');
    if (saveBtn) {
      saveBtn.setAttribute('data-vessel-id', vessel.id);
      updateSaveButton(saveBtn);
    }
  }

  /**
   * Selaraskan satu tombol simpan dengan isi shortlist.
   *
   * WHY fungsi terpisah (bukan inline di dua tempat): halaman ini dan
   * katalog menampilkan tombol yang sama persis. Dua salinan aturan
   * akan berbeda begitu salah satunya diubah.
   */
  function updateSaveButton(btn) {
    if (!btn || !window.KapalProShortlist) return;
    var id = btn.getAttribute('data-vessel-id');
    if (!id) return;
    var saved = window.KapalProShortlist.has(id);
    btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
    btn.classList.toggle('is-saved', saved);
    var label = btn.querySelector('.save-label');
    if (label) {
      label.textContent = saved ? 'Tersimpan' : 'Simpan Kapal';
    }
  }

  /**
   * Pasang tombol simpan kapal di halaman detail.
   *
   * WHY boleh dilewati sepenuhnya: js/shortlist.js adalah skrip
   * tambahan, dan halaman ini harus tetap berfungsi penuh tanpanya.
   */
  /**
   * Bangun blok dokumen untuk jalur runtime (vessel.html?id=).
   *
   * WHY memeriksa keberadaan grid, bukan selalu menulis ulang: pada
   * halaman statis hasil generator, kartu dokumen sudah ada di HTML.
   * Menuliskannya lagi akan membuang isi yang sudah benar dan
   * membuat halaman statis kehilangan bentuk yang lebih baik - persis
   * arah yang salah untuk SEO tanpa JavaScript.
   */
  function renderDocuments(vessel) {
    var section = document.getElementById('vessel-docs');
    if (!section) return;
    if (section.querySelector('.docs-grid')) return;

    var labels = {
      docRegistry: 'Sertifikat Registry',
      docClass: 'Sertifikat Klasifikasi',
      docSurvey: 'Laporan Survey Marina',
      docOwnership: 'Dokumen Kepemilikan',
      docBuilder: 'Sertifikat Pembangun'
    };

    var items = [
      ['docRegistry', vessel.flag_state ? 'Bendera: ' + vessel.flag_state : ''],
      ['docClass', vessel.classification ? 'Kelas: ' + vessel.classification : ''],
      ['docSurvey', ''],
      ['docOwnership', ''],
      ['docBuilder', vessel.class_notation || '']
    ].filter(function (row) { return row[1]; });

    var icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>' +
      '<polyline points="14 2 14 8 20 8"></polyline>' +
      '<polyline points="9 15 11 17 15 13"></polyline></svg>';

    var cards = items.map(function (row) {
      return '<div class="docs-item">' + icon +
        '<div class="docs-item-body">' +
        '<div class="docs-item-name">' + escapeHtml(labels[row[0]]) + '</div>' +
        '<div class="docs-item-note">' + escapeHtml(row[1]) + '</div>' +
        '</div></div>';
    }).join('');

    var notes = ['Salinan dokumen di atas bisa dibagikan sebelum survei, dengan persetujuan pemilik kapal.',
      'Spesifikasi berasal dari pemilik dan sewaktu-waktu dapat berubah. Cocokkan seluruh angka dengan laporan survei sebelum menandatangani MOA.'];

    section.innerHTML = '<div class="docs-grid">' + cards + '</div>' +
      notes.map(function (n) { return '<p class="docs-disclaimer">' + escapeHtml(n) + '</p>'; }).join('');
  }

  function initSaveButton() {
    var btn = document.getElementById('save-vessel');
    if (!btn || !window.KapalProShortlist) return;

    btn.addEventListener('click', function() {
      var id = btn.getAttribute('data-vessel-id');
      if (!id) return;
      var nowSaved = window.KapalProShortlist.toggle(id);
      updateSaveButton(btn);

      if (window.App && window.App.showToast) {
        window.App.showToast(
          nowSaved ? 'Tersimpan' : 'Dihapus dari daftar',
          'success');
      }
      if (window.KapalProAnalytics) {
        window.KapalProAnalytics.track('Shortlist Toggle', { vessel_id: id, saved: nowSaved });
      }
    });

    // WHY perubahan dari tab lain atau halaman lain harus terlihat
    // seketika. Id kapal diisi oleh renderVessel(), yang juga memanggil
    // updateSaveButton, jadi tidak perlu penyelarasan tambahan di sini.
    document.addEventListener('kapalpro:shortlist', function() { updateSaveButton(btn); });
  }

  /**
   * Render highlights as badges
   */
  function renderHighlights(highlights) {
    var container = document.getElementById('vessel-highlights');
    if (!container) return;
    var section = container.closest('section') || container.parentElement;

    var items = highlights
      ? (Array.isArray(highlights) ? highlights : String(highlights).split(','))
      : [];
    items = items.map(function(h) { return String(h).trim(); }).filter(Boolean);

    // WHY: Semua kapal saat ini punya highlights kosong. Menampilkan
    // judul "Keunggulan" + tanda hubung "-" di bawahnya lebih merugikan
    // daripada tidak menampilkan bagian sama sekali - pembaca mengira
    // ada data yang hilang. Sembunyikan seksi sepenuhnya.
    if (items.length === 0) {
      if (section) section.hidden = true;
      container.innerHTML = '';
      return;
    }

    if (section) section.hidden = false;
    // WHY: XSS fix - highlights berasal dari Google Sheets
    container.innerHTML = items.map(function(h) {
      return '<span class="badge badge-primary">' + escapeHtml(h) + '</span>';
    }).join('');
  }

  /**
   * Render specs table
   */
  function renderSpecs(vessel) {
    var tbody = document.querySelector('#vessel-specs-table tbody');
    if (!tbody) return;

    var specs = [];

    // WHY: Iterasi daftar field spec eksplisit (bukan Object.keys(SPEC_LABELS))
    // supaya urutan baris tabel stabil dan field yang tidak ingin
    // ditampilkan tidak ikut muncul.
    var SPEC_FIELDS = [
      'year_built', 'length', 'beam', 'depth', 'draft', 'dwt',
      'gross_tonnage', 'net_tonnage', 'speed_knots', 'engine_type',
      'engine_power', 'fuel_type', 'flag_state', 'classification',
      'class_notation', 'last_dock'
    ];
  // WHY didelegasikan ke VesselData: halaman kapal dan tabel
  // perbandingan harus menampilkan tanggal drydock dengan format
  // yang sama persis. Implementasinya hanya ada di js/data.js.
  function formatLastDock(value) {
    if (window.VesselData && window.VesselData.formatLastDock) {
      return window.VesselData.formatLastDock(value);
    }
    return String(value == null ? '' : value);
  }

    SPEC_FIELDS.forEach(function(key) {
      var value = vessel[key];
      if (value !== null && value !== undefined && value !== '' && value !== 'N/A') {
        var unit = SPEC_UNITS[key] || '';
        // last_dock disimpan sebagai tahun-bulan, tapi ditampilkan
        // sebagai nama bulan supaya terbaca wajar.
        var shown = key === 'last_dock' ? formatLastDock(value) : String(value);
        specs.push({
          label: specLabel(key),
          value: key === 'dwt' || key === 'gross_tonnage' || key === 'net_tonnage'
            ? window.VesselData.formatNumber(value) + ' ' + unit
            : shown + (unit ? ' ' + unit : '')
        });
      }
    });

    if (specs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="2" style="text-align: center; color: var(--text-muted); padding: var(--space-8);">Spesifikasi belum tersedia</td></tr>';
      return;
    }

    tbody.innerHTML = specs.map(function(s) {
      // WHY: XSS fix - s.value berasal dari data sheet mentah
      return '<tr><th>' + escapeHtml(s.label) + '</th><td>' + escapeHtml(s.value) + '</td></tr>';
    }).join('');
  }

  /**
   * Render sidebar
   */
  function renderSidebar(vessel) {
        // Price
    var priceEl = document.getElementById('sidebar-price');
    // WHY guard: sidebar parsial tidak boleh mematikan render galeri.
    if (priceEl) {
      if (vessel.price) {
        priceEl.textContent = window.VesselData.formatPrice(vessel.price);
      } else {
        priceEl.textContent = 'Harga Hubungi Kami';
      }
    }

    // Negotiable
    var negotiableEl = document.getElementById('sidebar-negotiable');
    if (negotiableEl) {
      if (vessel.is_negotiable === false || vessel.is_negotiable === 'FALSE') {
        negotiableEl.textContent = 'Harga fix';
      } else {
        negotiableEl.textContent = 'Harga negotiable';
      }
    }

    // Status
    var statusEl = document.getElementById('sidebar-status');
    var statusText = window.VesselData.vesselStatusLabel(vessel.status);
    var statusBadge = STATUS_BADGES[vessel.status] || 'badge-primary';
    if (statusEl) statusEl.innerHTML = '<span class="badge ' + statusBadge + '">' + escapeHtml(statusText) + '</span>';

    // Quick specs
    renderDocuments(vessel);
    var quickSpecs = document.getElementById('sidebar-quick-specs');
    if (!quickSpecs) return;
    // WHY: Label quick spec ditulis langsung dalam Bahasa Indonesia; dulu
    // bentuknya {id: {...}, en: {...}}[lang] karena labelnya ikut
    // berubah saat tombol bahasa ditekan.
    var QL = { year: 'Tahun', length: 'Panjang', beam: 'Lebar', engine: 'Mesin', location: 'Lokasi' };
    var quickItems = [
      { label: QL.year, value: vessel.year_built || '' },
      { label: QL.length, value: vessel.length ? vessel.length + ' m' : '' },
      { label: QL.beam, value: vessel.beam ? vessel.beam + ' m' : '' },
      { label: 'DWT', value: vessel.dwt ? window.VesselData.formatNumber(vessel.dwt) + ' DWT' : '' },
      { label: QL.engine, value: vessel.engine_power || '' },
      { label: QL.location, value: vessel.location || '' }
    ].filter(function(item) { return item.value !== ''; });

    quickSpecs.innerHTML = quickItems.map(function(item) {
      // WHY: XSS fix - item.value bisa berisi data sheet mentah
      return '<div style="display: flex; justify-content: space-between; padding: var(--space-2) 0; border-bottom: 1px solid var(--border-secondary);">' +
        '<span class="text-sm" style="color: var(--text-secondary);">' + escapeHtml(item.label) + '</span>' +
        '<span class="text-sm" style="font-weight: var(--font-weight-medium);">' + escapeHtml(item.value) + '</span>' +
      '</div>';
    }).join('');
  }

  /**
   * Render gallery
   */
  function renderGallery(vessel) {
    var mainImage = document.getElementById('vessel-main-image');
    var thumbnailsContainer = document.getElementById('vessel-thumbnails');
    // WHY guard: tanpa foto utama tidak ada yang bisa di-render.
    if (!mainImage) return;

    // WHY: Build image list from main + gallery
    var images = [];
    if (vessel.main_image_url) {
      images.push(vessel.main_image_url);
    }
    if (vessel.gallery_urls) {
      var galleryUrls = Array.isArray(vessel.gallery_urls)
        ? vessel.gallery_urls
        : vessel.gallery_urls.split(',');
      galleryUrls.forEach(function(url) {
        var trimmed = url.trim();
        if (trimmed) images.push(trimmed);
      });
    }

    // WHY: If no images, use placeholder
    if (images.length === 0) {
      images.push('assets/hero-vessel.jpg');
    }

    // WHY: Sanitize semua URL gambar sebelum dipakai (Section 2.2)
    images = images.map(safeImageUrl);

    // WHY: simpan untuk slider lightbox (prev/next/swipe)
    galleryImages = images;
    galleryAltBase = vessel.name;
    galleryCurrent = 0;

    // Main image
    mainImage.src = images[0];
    mainImage.alt = vessel.name + ' - photo 1';
    // WHY: Box foto utama ~800px CSS; tanpa srcset browser mengunduh file
    // 1600px penuh. Lightbox tetap memakai galleryImages (file asli) agar
    // zoom 4x masih punya resolusi.
    // WHY srcset HARUS dihapus bila gambar tidak punya varian: templet
    // vessel.html membawa srcset statis milik foto hero, dan browser
    // memilih kandidat srcset MENGABAIKAN src. Tanpa ini, render dinamis
    // (vessel.html?id= dan fallback kapal admin dengan foto data URL)
    // selalu menampilkan foto hero, bukan foto kapalnya.
    var mainSet = window.VesselData.buildSrcSet(images[0], window.VesselData.CARD_WIDTHS);
    if (mainSet) {
      mainImage.setAttribute('srcset', mainSet);
    } else {
      mainImage.removeAttribute('srcset');
    }
    mainImage.setAttribute('sizes', '(max-width: 768px) 100vw, 66vw');
    // WHY: sekaligus melepas <source> WebP statis templet (milik foto hero)
    // bila foto kapal ini tidak punya varian WebP, mis. data URL upload
    // admin - lihat applyWebpToMainImage(), satu-satunya pemilik keberadaan
    // elemen itu. Tanpa itu browser memilih kandidat hero dan foto kapal
    // tidak pernah tampil.
    applyWebpToMainImage(images[0]);

    // Thumbnails
    // WHY guard: container thumbnail opsional - foto utama tetap jalan.
    if (thumbnailsContainer) {
    if (images.length > 1) {
      // WHY: XSS fix - url dan vessel.name di-escape untuk konteks attribute
      thumbnailsContainer.innerHTML = images.map(function(url, i) {
        var safeUrl = escapeHtml(url);
        // WHY: Thumbnail dirender 150px, sebelumnya mengunduh file 1600px
        // (~320KB per gambar!). srcset 150/300w menurunkan ke ~8-23KB.
        var thumbSet = window.VesselData.buildSrcSet(url, window.VesselData.THUMB_WIDTHS);
        return window.VesselData.buildPicture(
          url,
          window.VesselData.THUMB_WIDTHS,
          'src="' + safeUrl + '"' +
          ' srcset="' + escapeHtml(thumbSet) + '"' +
          ' sizes="150px"' +
          ' alt="' + escapeHtml(vessel.name) + ' - photo ' + (i + 1) + '"' +
          ' class="vessel-thumbnail' + (i === 0 ? ' active' : '') + '"' +
          ' data-full="' + safeUrl + '"' +
          ' loading="lazy" decoding="async" width="150" height="150"',
          '150px'
        );
      }).join('');

      // WHY: Click thumbnail to change main image
      thumbnailsContainer.querySelectorAll('.vessel-thumbnail').forEach(function(thumb) {
        thumb.addEventListener('click', function() {
          mainImage.src = this.dataset.full;
          mainImage.alt = this.alt;
          galleryCurrent = galleryImages.indexOf(this.dataset.full);
          if (galleryCurrent === -1) galleryCurrent = 0;
          thumbnailsContainer.querySelectorAll('.vessel-thumbnail').forEach(function(t) {
            t.classList.remove('active');
          });
          this.classList.add('active');
        });
      });
    } else {
      thumbnailsContainer.innerHTML = '';
    }
    }

    // WHY: Click main image to open lightbox
    mainImage.style.cursor = 'pointer';
    mainImage.addEventListener('click', function() {
      openLightbox(galleryCurrent);
    });
  }

  // WHY: state slider lightbox - daftar foto galeri vessel aktif
  var galleryImages = [];
  var galleryAltBase = '';
  var galleryCurrent = 0;

  /**
   * Lightbox
   */
  function openLightbox(index) {
    if (!galleryImages.length) return;
    if (typeof index !== 'number' || index < 0) index = 0;
    galleryCurrent = index;
    var lightbox = document.getElementById('lightbox');
    // WHY guard: tanpa lightbox tidak ada yang bisa dibuka - klik foto
    // utama diam-diam tidak melakukan apa-apa, bukan throw.
    if (!lightbox) return;
    showLightboxImage();
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';

    // WHY: Focus trap
    var closeBtn = document.getElementById('lightbox-close');
    if (closeBtn) closeBtn.focus();
  }

  // WHY: tampilan satu foto + nav + counter + sinkron thumbnail di bawah
  function showLightboxImage() {
    var lightboxImage = document.getElementById('lightbox-image');
    var prevBtn = document.getElementById('lightbox-prev');
    var nextBtn = document.getElementById('lightbox-next');
    var counter = document.getElementById('lightbox-counter');
    var mainImage = document.getElementById('vessel-main-image');
    var single = galleryImages.length < 2;

    // WHY guard: dipanggil dari rantai lightbox yang sudah di-guard,
    // tapi tetap jangan throw kalau satu elemen hilang.
    if (!lightboxImage) return;
    lightboxImage.src = galleryImages[galleryCurrent];
    lightboxImage.alt = galleryAltBase + ' - foto ' + (galleryCurrent + 1);

    // WHY: Ganti foto -> kembali ke zoom 1x (bukan mewarisi zoom foto sebelumnya)
    window.dispatchEvent(new CustomEvent('kapalpro:zoom-reset'));

    if (prevBtn) prevBtn.style.display = single ? 'none' : '';
    if (nextBtn) nextBtn.style.display = single ? 'none' : '';
    if (counter) counter.textContent = single ? '' : (galleryCurrent + 1) + ' / ' + galleryImages.length;

    // WHY: restart animasi fade tiap ganti foto
    lightboxImage.classList.remove('image-enter');
    void lightboxImage.offsetWidth;
    lightboxImage.classList.add('image-enter');

    // WHY: sinkron foto utama + thumbnail aktif agar posisi sama saat ditutup
    if (mainImage) {
      mainImage.src = galleryImages[galleryCurrent];
      mainImage.alt = lightboxImage.alt;
    }
    var thumbs = document.querySelectorAll('.vessel-thumbnail');
    Array.prototype.forEach.call(thumbs, function(t, i) {
      t.classList.toggle('active', i === galleryCurrent);
    });
  }

  function lightboxNav(step) {
    if (galleryImages.length < 2) return;
    galleryCurrent = (galleryCurrent + step + galleryImages.length) % galleryImages.length;
    showLightboxImage();
  }

  function closeLightbox() {
    var lightbox = document.getElementById('lightbox');
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
    // WHY: Tutup -> reset zoom supaya reopen berikutnya mulai dari 1x
    window.dispatchEvent(new CustomEvent('kapalpro:zoom-reset'));
  }

  // WHY initLightbox(): binding lightbox dulunya jalan di level IIFE -
  // satu elemen #lightbox* yang hilang melempar saat script load dan
  // mematikan SELURUH modul vessel.js. Sekarang dipanggil dari init()
  // dengan guard, konsisten dengan modul zoom di bawah yang sudah guard.
  function initLightbox() {
    var lightbox = document.getElementById('lightbox');
    var closeBtn = document.getElementById('lightbox-close');
    var prevBtn = document.getElementById('lightbox-prev');
    var nextBtn = document.getElementById('lightbox-next');
    if (!lightbox || !closeBtn || !prevBtn || !nextBtn) return;

    closeBtn.addEventListener('click', closeLightbox);
    prevBtn.addEventListener('click', function() { lightboxNav(-1); });
    nextBtn.addEventListener('click', function() { lightboxNav(1); });
    lightbox.addEventListener('click', function(e) {
      if (e.target === this) closeLightbox();
    });
    document.addEventListener('keydown', function(e) {
      if (!lightbox.classList.contains('active')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') lightboxNav(-1);
      if (e.key === 'ArrowRight') lightboxNav(1);
    });

    // WHY: swipe di layar sentuh
    var startX = null;
    lightbox.addEventListener('touchstart', function(e) {
      startX = e.touches[0].clientX;
    }, { passive: true });
    lightbox.addEventListener('touchend', function(e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) lightboxNav(dx < 0 ? 1 : -1);
      startX = null;
    }, { passive: true });
  }

  // ---------- Zoom: pinch + double-tap + wheel ----------
  // WHY: Menyatukan semua gesture zoom di satu modul supaya tidak ada
  // listener yang saling berebut. State zoom disimpan di objek `zoom`
  // agar reset & clamping cukup satu sumber kebenaran.
  (function() {
    var stage = document.getElementById('lightbox-zoom-stage');
    var img = document.getElementById('lightbox-image');
    if (!stage || !img) return;

    var MAX_SCALE = 4;
    var MIN_SCALE = 1;
    var DOUBLE_TAP_SCALE = 2.5; // WHY: 2.5x cukup untuk lihat detail deklarasi
    var DOUBLE_TAP_MS = 300;
    var DOUBLE_TAP_SLOP = 30; // px - toleransi pergerakan tap kedua

    var zoom = { scale: MIN_SCALE, x: 0, y: 0 };
    var points = {};         // WHY: peta touch id -> koordinat untuk pinch 2-jarik
    var pinchStartDist = 0;
    var pinchStartScale = MIN_SCALE;
    var panStart = null;
    var lastTapTime = 0;
    var lastTapX = 0;
    var lastTapY = 0;

    function clamp(v, lo, hi) {
      return Math.max(lo, Math.min(hi, v));
    }

    // WHY: Batasi pan per sumbu supaya bagian atas/bawah foto tidak
    // pernah hilang saat di-zoom.
    function limitPan(scale) {
      var stageRect = stage.getBoundingClientRect();
      var imgRect = img.getBoundingClientRect();
      // Selisih ukuran visual img terhadap area stage = ruang gerak pan.
      var maxX = Math.max(0, (imgRect.width - stageRect.width) / 2);
      var maxY = Math.max(0, (imgRect.height - stageRect.height) / 2);
      return { x: maxX, y: maxY };
    }

    function apply(animate) {
      var s = clamp(zoom.scale, MIN_SCALE, MAX_SCALE);
      zoom.scale = s;
      if (s <= MIN_SCALE) {
        zoom.x = 0;
        zoom.y = 0;
      } else {
        var lim = limitPan(s);
        zoom.x = clamp(zoom.x, -lim.x, lim.x);
        zoom.y = clamp(zoom.y, -lim.y, lim.y);
      }
      if (!animate) img.classList.add('is-gesturing');
      img.style.transform = 'translate(' + zoom.x + 'px,' + zoom.y + 'px) scale(' + zoom.scale + ')';
      if (!animate) {
        // WHY: lepas kelas gesture setelah frame supaya transition normal aktif lagi
        requestAnimationFrame(function() { img.classList.remove('is-gesturing'); });
      }
      stage.classList.toggle('is-zoomed', zoom.scale > MIN_SCALE);
      img.setAttribute('data-zoom-level', zoom.scale.toFixed(2));
    }

    function resetZoom() {
      zoom.scale = MIN_SCALE;
      zoom.x = 0;
      zoom.y = 0;
      img.style.transform = '';
      img.classList.remove('is-gesturing');
      stage.classList.remove('is-zoomed');
      img.setAttribute('data-zoom-level', '1.00');
    }

    function toggleDoubleTap(clientX, clientY) {
      if (zoom.scale > MIN_SCALE) {
        resetZoom();
        return;
      }
      zoom.scale = DOUBLE_TAP_SCALE;
      // WHY: Fokuskan titik yang di-tap (bukan center) supaya user melihat
      // detail yang sedang disentuh, bukan tengah gambar.
      var rect = img.getBoundingClientRect();
      var dx = (rect.left + rect.width / 2) - clientX;
      var dy = (rect.top + rect.height / 2) - clientY;
      zoom.x = dx;
      zoom.y = dy;
      apply(true);
    }

    function dist(t1, t2) {
      var dx = t1.clientX - t2.clientX;
      var dy = t1.clientY - t2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    // ---------- Touch: pinch, pan, double-tap ----------
    stage.addEventListener('touchstart', function(e) {
      points = {};
      for (var i = 0; i < e.touches.length; i++) {
        points[e.touches[i].identifier] = {
          clientX: e.touches[i].clientX,
          clientY: e.touches[i].clientY
        };
      }
      var ids = Object.keys(points);
      if (ids.length === 2) {
        // WHY: mulai pinch - simpan jarak & scale awal
        pinchStartDist = dist(points[ids[0]], points[ids[1]]);
        pinchStartScale = zoom.scale;
        panStart = null;
        img.classList.add('is-gesturing');
      } else if (ids.length === 1 && zoom.scale > MIN_SCALE) {
        panStart = {
          x: points[ids[0]].clientX,
          y: points[ids[0]].clientY,
          ox: zoom.x,
          oy: zoom.y
        };
        stage.classList.add('is-dragging');
      }
    }, { passive: true });

    stage.addEventListener('touchmove', function(e) {
      if (!e.touches.length) return;
      var ids = Object.keys(points);

      if (e.touches.length === 2 && pinchStartDist > 0) {
        var d = dist(e.touches[0], e.touches[1]);
        if (pinchStartDist > 0) {
          zoom.scale = pinchStartScale * (d / pinchStartDist);
          apply(false);
        }
        e.preventDefault(); // WHY: cegah scroll halaman saat pinch
      } else if (e.touches.length === 1 && panStart) {
        var t = e.touches[0];
        zoom.x = panStart.ox + (t.clientX - panStart.x);
        zoom.y = panStart.oy + (t.clientY - panStart.y);
        apply(false);
        e.preventDefault();
      }
    }, { passive: false });

    function endTouches(e) {
      points = {};
      pinchStartDist = 0;
      panStart = null;
      stage.classList.remove('is-dragging');
      img.classList.remove('is-gesturing');
    }
    stage.addEventListener('touchend', endTouches, { passive: true });
    stage.addEventListener('touchcancel', endTouches, { passive: true });

    // ---------- Double tap (via touchend agar tidak fired setelah drag) ----------
    stage.addEventListener('touchend', function(e) {
      if (e.touches.length > 0) return;
      var changed = e.changedTouches[0];
      if (!changed) return;
      var now = Date.now();
      var isTap = Math.abs(changed.clientX - lastTapX) < DOUBLE_TAP_SLOP &&
                  Math.abs(changed.clientY - lastTapY) < DOUBLE_TAP_SLOP;
      if (now - lastTapTime < DOUBLE_TAP_MS && isTap) {
        toggleDoubleTap(changed.clientX, changed.clientY);
        lastTapTime = 0; // WHY: cegah triple-tap trigger ulang
      } else {
        lastTapTime = now;
        lastTapX = changed.clientX;
        lastTapY = changed.clientY;
      }
    }, { passive: true });

    // ---------- Mouse: double-click + wheel + drag-pan ----------
    stage.addEventListener('dblclick', function(e) {
      e.preventDefault();
      toggleDoubleTap(e.clientX, e.clientY);
    });

    stage.addEventListener('wheel', function(e) {
      e.preventDefault();
      if (zoom.scale <= MIN_SCALE && e.deltaY > 0) return; // WHY: scroll down saat belum zoom -> biarkan
      var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoom.scale *= factor;
      apply(true);
    }, { passive: false });

    stage.addEventListener('mousedown', function(e) {
      if (zoom.scale <= MIN_SCALE || e.button !== 0) return;
      panStart = { x: e.clientX, y: e.clientY, ox: zoom.x, oy: zoom.y };
      stage.classList.add('is-dragging');
      img.classList.add('is-gesturing');
      e.preventDefault();
    });

    window.addEventListener('mousemove', function(e) {
      if (!panStart) return;
      zoom.x = panStart.ox + (e.clientX - panStart.x);
      zoom.y = panStart.oy + (e.clientY - panStart.y);
      apply(false);
    });

    window.addEventListener('mouseup', function() {
      if (!panStart) return;
      panStart = null;
      stage.classList.remove('is-dragging');
      img.classList.remove('is-gesturing');
    });

    // WHY: Reset zoom saat ganti foto / buka / tutup lightbox supaya
    // tidak mewarisi zoom dari foto sebelumnya.
    window.addEventListener('kapalpro:zoom-reset', resetZoom);
  })();

  /**
   * Render WhatsApp links
   */
  function renderWhatsApp(vessel) {
    // WHY: WhatsApp number from config (replace with your number)
    // WHY: Nomor WhatsApp dari js/config.js (sumber tunggal),
    // dengan fallback bila config.js gagal dimuat.
    var whatsappNumber = (window.KAPALPRO_CONFIG && window.KAPALPRO_CONFIG.whatsappNumber) || '6285648048730';
    var message = 'Halo, saya tertarik dengan ' + vessel.name + '. ';
    if (vessel.price) {
      message += 'Harga: ' + window.VesselData.formatPrice(vessel.price) + '. ';
    }
    message += 'Bisa info lebih lanjut?';

    var encodedMessage = encodeURIComponent(message);
    var whatsappUrl = 'https://wa.me/' + whatsappNumber + '?text=' + encodedMessage;

    var sidebarWhatsapp = document.getElementById('sidebar-whatsapp');
    var formWhatsapp = document.getElementById('inquiry-whatsapp');

    if (sidebarWhatsapp) {
      sidebarWhatsapp.href = whatsappUrl;
      // WHY: Analytics - track which WhatsApp entry point converts (Minggu 3)
      sidebarWhatsapp.setAttribute('data-analytics-event', 'WhatsApp Click');
      sidebarWhatsapp.setAttribute('data-analytics-location', 'vessel-sidebar');
    }
    if (formWhatsapp) {
      formWhatsapp.href = whatsappUrl;
      formWhatsapp.setAttribute('data-analytics-event', 'WhatsApp Click');
      formWhatsapp.setAttribute('data-analytics-location', 'inquiry-form');
    }
  }

  /**
   * Render related vessels
   */
  function renderRelatedVessels(currentVessel) {
    var container = document.getElementById('related-vessels');
    if (!container) return;

    window.VesselData.getVessels().then(function(vessels) {
      // WHY: Filter by same type, exclude current
      var related = vessels.filter(function(v) {
        return v.type === currentVessel.type && v.id !== currentVessel.id;
      }).slice(0, 3);

      if (related.length === 0) {
        // WHY: If no same type, show random 3
        related = vessels.filter(function(v) {
          return v.id !== currentVessel.id;
        }).slice(0, 3);
      }

      if (related.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); grid-column: 1 / -1; text-align: center; padding: var(--space-8);">' +
          ('Belum ada kapal sejenis') + '</p>';
        return;
      }

            container.innerHTML = related.map(function(v) {
        // WHY: XSS fix + placeholder .jpg lama sudah dihapus, ganti ke .svg
        var imageUrl = safeImageUrl(v.main_image_url);
        var typeName = window.VesselData.vesselTypeLabel(v.type);
        var statusName = window.VesselData.vesselStatusLabel(v.status);
        var statusBadge = STATUS_BADGES[v.status] || 'badge-primary';
        // WHY: srcset agar kartu kapal sejenis tidak mengunduh foto 1600px
        var cardSrcSet = window.VesselData.buildSrcSet(v.main_image_url, window.VesselData.CARD_WIDTHS);

        // WHY: Badge hanya dirender bila membawa informasi baru.
        // Status 'available' = default semua kapal (tidak infosif), dan
        // badge jenis mengulang kata yang sudah ada di nama kapal.
        var badges = '';
        if (window.VesselData.shouldShowStatus(v)) {
          badges += '<span class="badge ' + statusBadge + '">' + escapeHtml(statusName) + '</span>';
        }
        if (window.VesselData.shouldShowType(v)) {
          badges += '<span class="badge badge-primary">' + escapeHtml(typeName) + '</span>';
        }

        return '<article class="card">' +
          window.VesselData.buildPicture(
            v.main_image_url,
            window.VesselData.CARD_WIDTHS,
            'src="' + escapeHtml(imageUrl) + '"' +
            ' srcset="' + escapeHtml(cardSrcSet) + '"' +
            ' sizes="' + RELATED_CARD_SIZES + '"' +
            ' alt="' + escapeHtml(v.name) + '"' +
            ' class="card-image"' +
            ' loading="lazy" decoding="async" width="400" height="250"',
            RELATED_CARD_SIZES
          ) +
          '<div class="card-body">' +
            (badges
              ? '<div style="display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2);">' + badges + '</div>'
              : '') +
            '<h3 class="card-title">' + escapeHtml(v.name) + '</h3>' +
            '<p class="card-price">' + (v.price ? window.VesselData.formatPrice(v.price) : ('Harga Hubungi Kami')) + '</p>' +
            window.VesselData.buildCardSpecChips(v) +
            '<div class="card-location">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
                '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>' +
                '<circle cx="12" cy="10" r="3"></circle>' +
              '</svg>' +
              '<span>' + escapeHtml(v.location || '-') + '</span>' +
            '</div>' +
            '<a href="' + vesselHref(v.id) + '" class="card-link">' +
              ('Lihat Detail') +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
                '<line x1="5" y1="12" x2="19" y2="12"></line>' +
                '<polyline points="12 5 19 12 12 19"></polyline>' +
              '</svg>' +
            '</a>' +
          '</div>' +
        '</article>';
      }).join('');
    });
  }

  /**
   * Inquiry form submission
   * WHY: Redirects to Google Forms with pre-filled data
   */
  function initInquiryForm() {
    var form = document.getElementById('inquiry-form');
    if (!form) return;

    // === UX RAPiHAN form inquiry ===
    // WHY via DOM injection: 33 halaman vessel statis - satu push JS
    // menjangkau semuanya tanpa edit HTML. Semua idempoten: aman bila
    // init dipanggil lebih dari sekali.
    (function enhanceInquiryUX() {
      // 1. Judul + subline sebelum form. WHY class CSS existing
      // (.inquiry-form-title/.inquiry-subtitle): konsisten dengan desain
      // form tanpa menambah CSS baru.
      if (!document.getElementById('inquiry-form-heading')) {
        var heading = document.createElement('h2');
        heading.id = 'inquiry-form-heading';
        heading.className = 'inquiry-form-title';
        heading.textContent = 'Ajukan Penawaran';
        var subline = document.createElement('p');
        subline.id = 'inquiry-form-subline';
        subline.className = 'inquiry-subtitle';
        subline.textContent = 'Isi formulir di bawah ini untuk mengajukan penawaran kapal ini.';
        form.parentNode.insertBefore(heading, form);
        form.parentNode.insertBefore(subline, form);
      }

      // 2. Sembunyikan select "Jenis Kapal" yang redundan (sudah terisi
      // otomatis sesuai halaman). WHY display:none bukan remove: kode
      // sinkronisasi dropdown existing tetap jalan dan hidden field
      // vessel_type tetap terisi. Select tidak required - validasi aman.
      var typeSel = document.getElementById('inquiry-vessel-type-select');
      if (typeSel) {
        var group = typeSel.closest ? typeSel.closest('.form-group') : typeSel.parentNode;
        if (group) group.style.display = 'none';
      }

      // 3. Samakan istilah tombol dengan langkah proses: "Ajukan Penawaran".
      // WHY ganti span saja: tombol berisi SVG ikon yang harus dipertahankan.
      var submitBtn = document.getElementById('inquiry-submit');
      if (submitBtn) {
        var label = submitBtn.querySelector('span');
        if (label) label.textContent = 'Ajukan Penawaran';

        // 4. Microcopy ekspektasi di bawah tombol. WHY sisip setelah
        // pembungkus tombol (flex row): <p> jadi blok di bawahnya,
        // bukan item flex.
        if (!document.getElementById('inquiry-form-note')) {
          var note = document.createElement('p');
          note.id = 'inquiry-form-note';
          note.className = 'form-note';
          note.textContent = 'Tim kami akan menghubungimu maksimal 1×24 jam.';
          var btnRow = submitBtn.parentNode;
          btnRow.parentNode.insertBefore(note, btnRow.nextSibling);
        }
      }
    })();

    // WHY konfigurasi ada di js/config.js: lihat catatan
    // inquiryFormUrl di sana. Selama belum diisi lengkap,
    // KapalProContact.form() mengembalikan null dan pengiriman jatuh ke
    // fallback WhatsApp - perilaku yang sama seperti sebelumnya.

    // WHY sinkronkan dropdown ke hidden field: select "Jenis Kapal" bisa
    // diubah pengunjung, tapi pesan WhatsApp membaca hidden field yang
    // hanya diisi sekali saat render. Akibatnya pilihan pengguna diam-diam
    // dibuang, dan jenis kapal yang terkirim selalu milik kapal yang sedang
    // dilihat - persis informasi yang salah untuk buyer. Daftarkan di
    // luar handler submit supaya berlaku sejak halaman siap, bukan
    // sesudah klik pertama.
    var typeSelect = document.getElementById('inquiry-vessel-type-select');
    var typeHidden = document.getElementById('inquiry-vessel-type');
    if (typeSelect && typeHidden) {
      typeSelect.addEventListener('change', function() {
        if (typeSelect.value) typeHidden.value = typeSelect.value;
      });
    }

    form.addEventListener('submit', function(e) {
      e.preventDefault();

      // WHY fval(): field yang hilang dianggap kosong -> validasi
      // "lengkapi field" yang tampil, bukan TypeError.
      function fval(id) {
        var el = document.getElementById(id);
        return el ? el.value.trim() : '';
      }

      // WHY: Validate required fields
      var name = fval('inquiry-name');
      var email = fval('inquiry-email');
      var phone = fval('inquiry-phone');
      var message = fval('inquiry-message');

      if (!name || !email || !phone || !message) {
        window.App.showToast('Mohon lengkapi field yang wajib diisi', 'error');
        return;
      }

      // WHY: Email validation
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        window.App.showToast('Format email tidak valid', 'error');
        return;
      }

      var submitBtn = document.getElementById('inquiry-submit');
      if (submitBtn) {
        submitBtn.classList.add('loading');
        submitBtn.disabled = true;
      }

      // WHY: Analytics - LOI submissions are the core conversion (Minggu 3)
      if (window.KapalProAnalytics) {
        var vesselId = new URLSearchParams(window.location.search).get('id') || 'unknown';
        window.KapalProAnalytics.track('Inquiry Submit', {
          vessel_id: vesselId,
          has_company: !!(document.getElementById('inquiry-company') && document.getElementById('inquiry-company').value),
          has_survey_date: !!(document.getElementById('inquiry-survey-date') && document.getElementById('inquiry-survey-date').value),
          has_offer_price: !!(document.getElementById('inquiry-offer-price') && document.getElementById('inquiry-offer-price').value)
        });
      }

      // WHY dibaca saat submit, bukan saat init: konfigurasi bisa saja
      // diisi ulang tanpa memuat ulang halaman, dan membaca langsung
      // dari config membuat jalur ini bisa diuji dengan menimpa
      // window.KAPALPRO_CONFIG di test.
      var googleForm = window.KapalProContact && window.KapalProContact.form('inquiry');

      // WHY restore tombol di satu tempat: loading state harus selalu
      // selesai, baik kirim sukses maupun gagal.
      function restoreBtn() {
        if (submitBtn) {
          submitBtn.classList.remove('loading');
          submitBtn.disabled = false;
        }
      }

      if (!googleForm) {
        // WHY tanpa fallback WhatsApp: keputusan owner 2026-10-17, nomor
        // pribadi tidak dipakai di alur form. Jangan buka tab baru.
        window.App.showToast('Formulir belum dapat dikirim saat ini. Silakan coba lagi nanti.', 'error');
        restoreBtn();
        return;
      }

      // WHY submit LANGSUNG ke Google Forms (POST /formResponse, no-cors):
      // pola lama membuka pre-fill di tab baru sehingga pembeli harus klik
      // Submit dua kali - inquiry hilang kalau tab ditutup. Respons fetch
      // opaque di mode no-cors, tapi Google mencatat data dengan andal;
      // fetch hanya reject bila network gagal.
      var params = new URLSearchParams();
      var formData = new FormData(form);

      formData.forEach(function(value, key) {
        var formEntry = googleForm.fields[key];
        if (formEntry && value) {
          params.append(formEntry, value);
        }
      });

      // WHY URL dibangun dari config, bukan hardcode ID:
      // /viewform -> /formResponse.
      var submitUrl = googleForm.url.replace(/\/viewform.*$/, '/formResponse');

      fetch(submitUrl, {
        method: 'POST',
        mode: 'no-cors',
        body: params
      }).then(function() {
        window.App.showToast('Penawaran terkirim. Tim kami akan menghubungimu maksimal 1×24 jam.', 'success');
        form.reset();
        restoreBtn();
      }).catch(function() {
        // WHY data TIDAK di-clear saat gagal: pembeli bisa kirim ulang
        // tanpa mengetik ulang.
        window.App.showToast('Gagal mengirim. Periksa koneksi internet lalu kirim ulang.', 'error');
        restoreBtn();
      });
    });
  }

  /**
   * Structured data (JSON-LD) untuk kapal.
   *
   * WHY schema di sini dibuat sama dengan yang ditulis
   * tools/generate-vessel-pages.js: skrip statis #vessel-schema dihapus
   * lalu diganti dengan versi ini, jadi halaman yang dirender JS dan
   * halaman statis harus menghasilkan data yang sama persis.
   * Kalau runtime lebih tipis, SEO tanpa JavaScript malah jadi lebih
   * baik - itu arah yang salah.
   */
  function addStructuredData(vessel) {
    var existingScript = document.getElementById('vessel-schema');
    if (existingScript) existingScript.remove();

    var schema = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      'name': vessel.name,
      'description': vessel.description || (vessel.name + ' - ' + (window.VesselData.vesselTypeLabel(vessel.type))),
      'sku': vessel.id,
      'url': vesselUrl(vessel.id),
      'image': [vessel.main_image_url ? absoluteUrl(vessel.main_image_url) : (SITE_ORIGIN + '/assets/og-image.jpg')],
      'category': window.VesselData.vesselTypeLabel(vessel.type),
      'offers': {
        '@type': 'Offer',
        'priceCurrency': 'IDR',
        'price': vessel.price || '0',
        'availability': vessel.status === 'available' ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        'itemCondition': 'https://schema.org/UsedCondition',
        'seller': {
          '@type': 'Organization',
          'name': 'KapalPro',
          'url': SITE_ORIGIN
        }
      },
      'additionalProperty': []
    };

    // WHY brand TIDAK diisi "KapalPro": brand di schema.org berarti
    // MEREK produk itu sendiri. KapalPro adalah broker, bukan shipyard -
    // mengisi brand berarti menyatakan ke Google bahwa KapalPro adalah
    // pembuat kapal tersebut. Itu klaim yang salah dan justru merusak
    // kredibilitas listing. Peran broker sudah benar tercermin di
    // offers.seller.
    if (vessel.builder) {
      schema.manufacturer = { '@type': 'Organization', 'name': String(vessel.builder) };
    }

    // WHY mpn memakai id kapal: satu-satunya pengenal yang stabil dan
    // unik per unit, bukan per tipe.
    schema.mpn = String(vessel.id);
    
    // WHY memakai daftar label lengkap, bukan subset: JSON-LD yang
    // lebih tipis daripada tabel spesifikasi yang terlihat manusia
    // membuat crawler memahami lebih sedikit dari yang sudah ditulis
    // tangan di halaman yang sama. Label dan satuan di sini harus
    // sama persis dengan SPEC_LABELS/SPEC_UNITS di
    // tools/generate-vessel-pages.js - kedua sisi diverifikasi oleh
    // tests/generator.test.js.
    var specMap = {
      'year_built': 'Tahun Pembuatan',
      'length': 'Panjang',
      'beam': 'Lebar (Beam)',
      'depth': 'Kedalaman (Depth)',
      'draft': 'Draft',
      'dwt': 'DWT (Deadweight Tonnage)',
      'gross_tonnage': 'Gross Tonnage',
      'net_tonnage': 'Net Tonnage',
      'speed_knots': 'Kecepatan',
      'engine_type': 'Tipe Mesin',
      'engine_power': 'Daya Mesin',
      'fuel_type': 'Tipe Bahan Bakar',
      'flag_state': 'Bendera',
      'classification': 'Klasifikasi',
      'class_notation': 'Notasi Klasifikasi'
    };
    var specUnits = {
      'length': 'm', 'beam': 'm', 'depth': 'm', 'draft': 'm',
      'dwt': 'DWT', 'gross_tonnage': 'GT', 'net_tonnage': 'NT', 'speed_knots': 'knots'
    };

    Object.keys(specMap).forEach(function(key) {
      var val = vessel[key];
      if (val === null || val === undefined || String(val).trim() === '') return;
      var unit = specUnits[key];
      schema.additionalProperty.push({
        '@type': 'PropertyValue',
        'name': specMap[key],
        'value': unit ? String(val) + ' ' + unit : String(val)
      });
    });
    
    // WHY: XSS fix - JSON.stringify tidak meng-escape '</script>'.
    // Nilai seperti nama kapal "</script><script>alert(1)</script>"
    // bisa breakout dari blok JSON-LD dan mengeksekusi script.
    // Escape < dan > menjadi unicode escape \u003C \u003E (praktik
    // standar Google untuk JSON-in-script).
    var json = JSON.stringify(schema)
      .replace(/</g, '\\u003C')
      .replace(/>/g, '\\u003E')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

    var script = document.createElement('script');
    script.id = 'vessel-schema';
    script.type = 'application/ld+json';
    script.textContent = json;
    document.head.appendChild(script);

    addBreadcrumbData(vessel);
  }

  /**
   * BreadcrumbList JSON-LD.
   *
   * WHY skrip terpisah, bukan array: Google membaca satu skrip per
   * entitas, dan tools/generate-vessel-pages.js menulisnya dengan cara
   * yang sama supaya vessel.html?id=... (yang tidak di-build) tidak
   * kehilangan breadcrumb hanya karena tidak punya file statis.
   */
  function addBreadcrumbData(vessel) {
    var old = document.getElementById('vessel-breadcrumb');
    if (old) old.remove();

    var schema = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', position: 1, name: 'Beranda', item: SITE_ORIGIN + '/' },
        { '@type': 'ListItem', position: 2, name: 'Katalog Kapal', item: SITE_ORIGIN + '/catalog.html' },
        { '@type': 'ListItem', position: 3, name: vessel.name, item: vesselUrl(vessel.id) }
      ]
    };

    var json = JSON.stringify(schema, null, 2)
      .replace(/</g, '\\u003C')
      .replace(/>/g, '\\u003E')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

    var script = document.createElement('script');
    script.id = 'vessel-breadcrumb';
    script.type = 'application/ld+json';
    script.textContent = json;
    document.head.appendChild(script);
  }

  /**
   * Initialize page
   */
  function init() {
    var vesselId = getVesselId();

    if (!vesselId) {
      // WHY: No ID in URL - show error, and treat it exactly like a
      // missing record: noindex plus form inquiry disembunyikan.
      // WHY guard: dua baris ini jalan sebelum render apa pun, jadi
      // elemennya pun di-guard.
      var noIdTitle = document.getElementById('vessel-title');
      if (noIdTitle) noIdTitle.textContent = 'Kapal tidak ditemukan';
      var noIdCrumb = document.getElementById('breadcrumb-name');
      if (noIdCrumb) noIdCrumb.textContent = 'Terjadi kesalahan';
      markVesselMissing();
      return;
    }

    // WHY guard: kalau js/data.js gagal dimuat, window.VesselData undefined
    // dan Promise.all melempar TypeError synchronous. Perlakukan seperti
    // kapal tidak ditemukan: noindex + form disembunyikan.
    if (!window.VesselData || !window.VesselData.getVesselById) {
      var titleEl = document.getElementById('vessel-title');
      if (titleEl) titleEl.textContent = 'Gagal memuat data kapal';
      markVesselMissing();
      return;
    }

    // WHY: Fetch vessel data
    // Manifest varian gambar dimuat bersama data kapal karena renderVessel()
    // memanggil buildSrcSet() yang butuh manifest siap (lihat data.js).
    var currentVessel = null;
    Promise.all([
      window.VesselData.getVesselById(vesselId),
      window.VesselData.loadVariantManifest()
    ]).then(function(res) {
      currentVessel = res[0];
      renderVessel(currentVessel);
    }).catch(function(err) {
      // WHY: tanpa catch, halaman tampil kosong tanpa penjelasan saat
      // data gagal dimuat.
      console.error('[Vessel] Gagal memuat data kapal:', err);
      var title = document.getElementById('vessel-title');
      if (title) title.textContent = 'Gagal memuat data kapal';
      var desc = document.getElementById('vessel-description');
      if (desc) desc.textContent = 'Periksa koneksi internet lalu muat ulang halaman.';
    });

    initInquiryForm();
    initSaveButton();
    initLightbox();
  }

  // WHY: Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
