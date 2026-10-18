/**
 * Katalog Kapal di Halaman Depan - KapalPro
 * ==========================================
 *
 * Section "Katalog Kapal" di index.html. Semula hanya menampilkan 3
 * kapal dengan harga tertinggi; sekarang menampilkan SELURUH armada,
 * dengan pengurutan, potongan 6 kapal, dan tombol "Muat lebih banyak".
 *
 * Pola diambil dari riset UI marketplace, bukan dari tebakan:
 *
 *   - "Muat lebih banyak", bukan infinite scroll. Riset pola halaman
 *     hasil Finds: infinite scroll cocok untuk feed sosial, tapi untuk
 *     katalog yang pemirunya membandingkan sebelum membeli, tombol
 *     eksplisit lebih baik karena posisi pengguna tidak melompat
 *     sendiri saat daftar bertambah.
 *   - Jumlah hasil selalu terlihat ("Menampilkan 6 dari 15 kapal").
 *     Tanpa angka ini pengguna tidak tahu ada kapal yang belum
 *     dimuat, dan menganggap katalog hanya berisi 6 kapal.
 *   - Hanya pengurutan, tanpa filter. Filter sudah lengkap di
 *     catalog.html; menduplikasiinya di beranda membuat dua tempat
 *     yang harus dirawat dan tetap sama.
 *   - Specifications singkat sebagai CHIP OVERLAY di atas foto.
 *     Pembeli kapal membandingkan angka (GT, DWT, tahun) sekilas tanpa
 *     meninggalkan beranda, tapi angka itu menempel di foto - bukan di
 *     zona teks - supaya tinggi zona teks tetap maksimal sepertiga kartu.
 *
 * Sifat penting: kalau data gagal dimuat, container TIDAK dikosongkan
 * diam-diam. Keadaan itu dicatat di konsol dan empty state ditampilkan.
 *
 * Compliant with RULES.md Section 2 (XSS), 3 (i18n), 1.13 (tak crash)
 */
(function() {
  'use strict';

  var container = document.getElementById('featured-vessels');
  if (!container) return;

  var countEl = document.getElementById('catalog-count');
  var emptyEl = document.getElementById('catalog-empty');
  var sortEl = document.getElementById('catalog-sort');
  var loadMoreEl = document.getElementById('catalog-load-more');

  // WHY 6 bukan 3: 6 cukup untuk mengisi satu baris penuh di
  // desktop (3 kolom) dan dua baris di tablet, jadi grid terlihat
  // lengkap tanpa membuat beranda jadi salinan catalog.html.
  var PAGE_SIZE = 6;

  // Cache lokal: re-render saat bahasa berubah tidak boleh fetch ulang.
  var allVessels = [];
  var shown = PAGE_SIZE;

  // WHY tidak ada escapeHtml/safeImageUrl di berkas ini lagi: kartu
  // dibangun VesselData.buildCardHtml() (lihat js/data.js), dan di sana
  // escaping memakai window.KapalProSanitize - satu implementasi yang
  // otoritatif. Versi lokal di file ini dulu tidak meng-escape tanda
  // kutip, dan itu pernah menghasilkan XSS tersimpan di alt="...".

  // ---------- Badge class helpers ----------
  // WHY dihapus: kartu ringkas memakai .catalog-card-badge (satu
  // badge status saja). Fungsi statusBadgeClass dulu dibutuhkan
  // untuk kombinasi badge status + badge jenis pada kartu bergaya
  // foto besar, dan tidak ada lagi pemanggilnya.

  // ---------- Sorting ----------
  /**
   * WHY urutan bawaan "Terbaru" dan bukan "Harga tertinggi" seperti
   * Featured yang lama: price-desc membuat kapal termahal selalu
   * mengisi baris pertama, sehingga semua pengunjung melihat kapal
   * yang sama. Tahun pembuatan lebih mewakili armada yang baru,
   * dan dipakai juga untuk urutan yang adil antar kapal.
   */
  function sortVessels(list, mode) {
    var out = list.slice();
    if (mode === 'price-asc') {
      return out.sort(function(a, b) { return (a.price || 0) - (b.price || 0); });
    }
    if (mode === 'price-desc') {
      return out.sort(function(a, b) { return (b.price || 0) - (a.price || 0); });
    }
    // 'newest': tahun pembuatan turun. Kapal tanpa tahun tidak
    // terlempar ke akhir - ia ikut tersusun dengan tahun terkecil,
    // jadi tetap terlihat dan tidak mengacaukan hitungan.
    return out.sort(function(a, b) {
      return (b.year_built || 0) - (a.year_built || 0);
    });
  }

  // ---------- Kartu beranda ----------
  // WHY ukuran kandidat CARD_WIDTHS (400/800): kartu memakai foto BESAR
  // selebar kartu (±330-390px di desktop, ~92vw di ponsel), bukan
  // thumbnail 112px seperti dulu. Kandidat 150/300 membuat browser
  // mengunduh varian terkecil lalu me-rencatkannya jadi buram.
  // WHY `sizes`: kolom grid 3 di desktop (~30vw), 2 di tablet (46vw), 1 di
  // ponsel (92vw setelah padding kontainer). Angka ini yang membuat srcset
  // memilih lebar render yang benar, bukan menebak.
  var CARD_SIZES = '(max-width: 767px) 92vw, (max-width: 1099px) 46vw, 30vw';

  /**
   * Kartu kapal beranda: markup SAMA PERSIS dengan katalog, ditambah
   * carousel (thumbnail + counter) karena beranda menampilkan lebih
   * sedikit kartu sehingga ruang untuk foto tambahan memang ada.
   *
   * WHY memanggil VesselData.buildCardHtml alih-alih menyusun markup di
   * sini: salinan kedua markup ini dulu hidup di js/catalog.js, dan
   * keduanya sudah menyimpang tanpa disadari - carousel hanya muncul di
   * beranda, tombol simpan hanya di katalog.
   */
  function renderCard(v) {
    return window.VesselData.buildCardHtml(v, { sizes: CARD_SIZES, carousel: true });
  }

  // ---------- Render ----------
  function renderCount() {
    if (!countEl) return;
    var total = allVessels.length;
    var visible = Math.min(shown, total);
    if (!total) { countEl.textContent = ''; return; }
    var text = (visible < total
      ? 'Menampilkan {shown} dari {total} kapal'
      : 'Menampilkan semua {total} kapal')
      .replace('{shown}', String(visible))
      .replace('{total}', String(total));
    countEl.textContent = text;
  }

  function render() {
    var sorted = sortVessels(allVessels, sortEl ? sortEl.value : 'newest');
    var visible = sorted.slice(0, shown);

    container.innerHTML = visible.map(renderCard).join('');
    renderCount();

    if (emptyEl) emptyEl.hidden = sorted.length > 0;
    if (loadMoreEl) loadMoreEl.hidden = sorted.length <= shown;

    // WHY: trigger anim.js scan supaya elemen baru dapat animasi reveal
    if (window.KapalProAnim && window.KapalProAnim.rescan) {
      window.KapalProAnim.rescan();
    }
  }

  function renderVessels() {
    // WHY Manifest varian gambar dimuat bersamaan dengan data kapal
    // supaya buildSrcSet() di renderCard() punya daftar varian yang
    // benar-benar ada di disk.
    Promise.all([
      window.VesselData.getVessels(),
      window.VesselData.loadVariantManifest()
    ]).then(function(res) {
      // WHY filter sold: katalog beranda hanya menampilkan kapal tersedia.
      allVessels = (res[0] || []).filter(function(v) { return v && v.status !== 'sold'; });
      render();
    }).catch(function(err) {
      console.error('[Index] Gagal merender katalog kapal:', err);
      // WHY: container sengaja dibiarkan apa adanya. Mengosongkan
      // grid yang tadinya berisi kartu statis akan menghapus isi
      // tanpa menjelaskan apa pun kepada pengunjung.
      if (emptyEl) {
        emptyEl.hidden = false;
        emptyEl.textContent = 'Belum ada kapal yang tersedia saat ini.';
      }
      if (countEl) countEl.textContent = '';
      if (loadMoreEl) loadMoreEl.hidden = true;
    });
  }

  // ---------- Events ----------
  if (sortEl) {
    sortEl.addEventListener('change', function() {
      shown = PAGE_SIZE;
      render();
    });
  }

  if (loadMoreEl) {
    loadMoreEl.addEventListener('click', function() {
      // WHY tampilkan semua sekaligus: label tombol "Lihat Semua"
      // harus benar - bukan tambah 6 per klik.
      shown = allVessels.length;
      render();
      // WHY fokus dikembalikan ke tombol: setelah grid bertambah,
      // posisi fokus tidak berubah dan pembaca layar tetap tahu
      // di mana dirinya. Tombol ini disembunyikan otomatis saat
      // semua kapal sudah tampil, jadi fokus dipindah ke container
      // supaya tidak hilang ke body.
      if (loadMoreEl.hidden && container) {
        container.setAttribute('tabindex', '-1');
        container.focus();
      }
    });
  }

  // ---------- Mini carousel (CSP: tanpa inline handler) ----------
  // WHY delegasi ke container, bukan listener per tombol: kartu ditulis
  // ulang setiap kali render() berjalan (sort, muat lebih banyak,
  // sinkronisasi antar-tab), dan listener per tombol akan menggantung
  // pada elemen yang sudah dibuang.
  // WHY preventDefault + stopPropagation: tanpa ini, klik yang tidak
  // tepat sasaran (mis. tepat di tepi gambar thumbnail) jatuh ke
  // stretched link judul yang menutupi seluruh kartu dan memicu
  // navigasi alih-alih berganti foto.
  container.addEventListener('click', function(e) {
    var btn = e.target && e.target.closest
      ? e.target.closest('.catalog-card-thumb') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    var card = btn.closest('.catalog-card');
    if (!card) return;
    var idx = btn.getAttribute('data-slide');

    var slides = card.querySelectorAll('.catalog-card-slide');
    var thumbs = card.querySelectorAll('.catalog-card-thumb');
    for (var i = 0; i < slides.length; i++) {
      slides[i].hidden = slides[i].getAttribute('data-slide') !== idx;
    }
    for (var j = 0; j < thumbs.length; j++) {
      var aktif = thumbs[j].getAttribute('data-slide') === idx;
      thumbs[j].classList.toggle('is-active', aktif);
      thumbs[j].setAttribute('aria-pressed', aktif ? 'true' : 'false');
    }
    // WHY counter ikut diperbarui di sini: markup awal selalu "1/N";
    // tanpa baris ini indikator berbohong setelah foto diganti.
    var counter = card.querySelector('.catalog-card-slide-count');
    if (counter) counter.textContent = (Number(idx) + 1) + '/' + slides.length;
  });

  // ---------- Sinkronisasi live antar-tab ----------
  // WHY event storage: tab /admin menulis localStorage "kapal_ads", dan
  // event storage DIKIRIM ke semua tab lain dengan origin sama (tidak ke
  // tab penulisnya) - persis jalur komunikasi yang dibutuhkan.
  // WHY tidak perlu clearCache(): getVessels() membaca ulang override
  // admin di awal SETIAP pemanggilan (sebelum cache), jadi cukup render
  // ulang - tanpa reload halaman. e.key === null berarti clear().
  window.addEventListener('storage', function(e) {
    if (e.key !== 'kapal_ads' && e.key !== null) return;
    renderVessels();
  });

  // ---------- Init ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderVessels);
  } else {
    renderVessels();
  }
})();