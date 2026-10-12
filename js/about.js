/**
 * About Page Statistics - KapalPro
 * =================================
 * Menghitung angka statistik di about.html LANGSUNG dari data/vessels.json.
 *
 * WHY: Angka sebelumnya di-hardcode ("50+ kapal terdaftar") padahal data
 * hanya berisi 15 kapal. Klaim yang tidak cocok dengan data sendiri
 * merusak kepercayaan - dan angka hardcode selalu ikut basi saat data
 * berubah. Sekarang semua dihitung dari sumber kebenaran yang sama.
 *
 * Elemen yang disentuh harus punya atribut data-stat="<kunci>".
 */
(function() {
  'use strict';

  var targets = document.querySelectorAll('[data-stat]');
  if (!targets.length) return;

  function setValue(el, value, suffix) {
    // Counter di anim.js membaca data-count saat pertama kali terlihat.
    // Kita perbarui KEDUA atribut supaya angka & animasi selalu sinkron.
    el.setAttribute('data-count', String(value));
    if (suffix) el.setAttribute('data-suffix', suffix);
    el.textContent = String(value) + (suffix || '');
  }

  function compute(vessels) {
    var locs = {};
    var types = {};
    var classified = 0;

    vessels.forEach(function(v) {
      if (v.location) locs[v.location] = true;
      if (v.port_location) locs[v.port_location] = true;
      if (v.type) types[v.type] = true;
      if (v.classification) classified++;
    });

    return {
      vessels: vessels.length,
      types: Object.keys(types).length,
      ports: Object.keys(locs).length,
      // WHY: Persentase hanya bermakna kalau penyebutnya >= 1.
      classified: vessels.length
        ? Math.round((classified / vessels.length) * 100)
        : 0
    };
  }

  // WHY: Guard eksplisit. Module ini dijadwalkan setelah DOM siap, tapi
  // bila data.js gagal dimuat (404 / CSP) window.VesselData undefined -
  // tanpa guard, pemanggilan berikutnya melempar TypeError dan seluruh
  // statistik + daftar kota diam-diam tidak ter-render.
  if (!window.VesselData || typeof window.VesselData.getVessels !== 'function') {
    console.warn('[About] VesselData tidak tersedia - statistik memakai nilai bawaan di HTML.');
    return;
  }

  window.VesselData.getVessels().then(function(vessels) {
    var list = vessels || [];
    var stats = compute(list);
    Array.prototype.forEach.call(targets, function(el) {
      var key = el.getAttribute('data-stat');
      if (!(key in stats)) return;
      var suffix = el.getAttribute('data-suffix') || '';
      setValue(el, stats[key], suffix);
    });

    renderLocations(list);

    // WHY: anim.js mungkin sudah men-scan counter sebelum angka final
    // datang. Minta rescan supaya animasi memakai nilai yang benar.
    if (window.KapalProAnim && window.KapalProAnim.rescan) {
      window.KapalProAnim.rescan();
    }
  }).catch(function(err) {
    // WHY: statistik tidak boleh menggagalkan halaman about
    console.warn('[About] Gagal menghitung statistik:', err);
  });

  /**
   * Daftar kota jangkauan, langsung dari lokasi kapal yang ada.
   * WHY: auditan menemukan 4 dari 8 kota yang ditampilkan TIDAK punya
   * kapal sama sekali - klaim falsifikasi. Now the list can never
   * overstate coverage.
   */
  function renderLocations(vessels) {
    var ul = document.getElementById('about-locations');
    if (!ul) return;

    var seen = {};
    var cities = [];
    vessels.forEach(function(v) {
      if (v.location && !seen[v.location]) {
        seen[v.location] = true;
        cities.push(v.location);
      }
    });
    cities.sort();

    if (!cities.length) {
      // WHY: Jangan tampilkan daftar kosong yang membingungkan; sembunyikan
      // saja sekalian bila memang tidak ada data.
      var card = ul.closest('.card');
      if (card) card.hidden = true;
      return;
    }

    ul.innerHTML = cities.map(function(city) {
      var text = document.createElement('span');
      text.textContent = city;
      var badge = document.createElement('span');
      badge.className = 'badge badge-primary';
      badge.appendChild(text);
      var li = document.createElement('li');
      li.className = 'flex items-center';
      li.style.gap = 'var(--space-2)';
      li.appendChild(badge);
      return li.outerHTML;
    }).join('');
  }
})();
