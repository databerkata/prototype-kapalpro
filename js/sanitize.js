/**
 * Sanitasi bersama - KapalPro
 * ============================
 *
 * Dua fungsi yang MENJAGA data kapal tidak pernah menjadi markup atau
 * URL berbahaya. Keduanya dulunya disalin ke tiap file (escapeHtml
 * ada 4 salinan dalam 2 implementasi berbeda, safeImageUrl 3 salinan
 * dengan 2 kebijakan berbeda), dan salinan itulah akar masalah XSS
 * yang sudah pernah terjadi: index.js punya escapeHtml yang tidak
 * meng-escape tanda kutip, sementara tiga file lain punya yang
 * benar. Perbedaan sekecil itu hanya terlihat kalau ada yang tes.
 *
 * WHY satu berkas: supaya perubahan di masa depan berlaku di semua
 * halaman sekaligus. Kalau escaping diubah lagi, tidak ada lagi
 * tempat keempat yang diam-diam berbeda.
 *
 * Batasnya, jujur: ini bukanzagur anti-XSS. Fungsi ini menutup jalur
 * yang NYATA dipakai data kapal. Yang menutup sisanya adalah
 * ditetapkan bahwa data kapal ini milik kita sendiri, bukan masukan
 * pengguna - lihat catatan di data.js (sanitizeVessel).
 */
(function () {
  'use strict';

  /** Gambar pengganti saat URL tidak boleh ditampilkan. */
  var FALLBACK_IMAGE = 'assets/hero-vessel.jpg';

  /**
   * Host yang boleh dipakai untuk gambar dari luar repo.
   *
   * WHY daftar ini, bukan "https apa pun": dulu safeImageUrl di
   * catalog.js dan vessel.js menerima https:// dari host mana saja.
   * Itu berarti satu nilai main_image_url yang disisipkan orang bisa
   * membuat halaman memuat gambar dari server mana pun - pellet
   * pelacakan dan penyalahgunaanymmetry branding tanpa jejak. Yang
   * Ketat di index.js sudah benar; sekarang semuanya sama.
   *
   * Data saat ini tidak butuh daftar ini sama sekali: nol URL
   * absolut di data/vessels.json dan data/image-variants.json, semua
 * gambar relatif di assets/. Daftar ini ada untuk jalur CDN
 * yang mungkin ditambahkan nanti, bukan untuk mengizinkan apa pun
   * sekarang.
   */
  var ALLOWED_IMAGE_HOSTS = ['kapalpro.web.id', 'res.cloudinary.com'];

  /**
   * Bentuk data URL gambar yang boleh lewat safeImageUrl.
   *
   * WHY ini ada: foto yang di-upload lewat /admin (dev) disimpan di
   * localStorage sebagai data URL - situs statis ini tidak punya server
   * untuk menampung berkas unggahan. Formatnya dibatasi KETAT: hanya
   * base64 PNG/JPEG/WebP. SVG sengaja DITOLAK walau browser tidak
   * menjalankan skrip di <img> - data URL SVG terlalu licin untuk
   * diterima menyeluruh, dan foto kapal tidak akan pernah ber-SVG.
   * CSP tiap halaman sudah mengizinkan img-src data:, jadi tidak ada
   * yang perlu diubah di sana.
   */
  var DATA_IMAGE_PATTERN = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+\/=]+$/;

  /**
   * Escape teks agar aman diletakkan di dalam HTML.
   *
   * Kelima karakter itu wajib, bukan hanya < > &. Nilai kapal masuk
   * ke atribut BERGANDA KUTIP seperti alt="...", jadi hanya
   * meng-escape < > & meninggalkan celah: nama kapal berisi
   * `" onerror="...` menutup atribut dan meng-inject event handler.
   * Inline handler seperti itu lolos CSP karena tidak punya hash.
   *
   * @param {*} text - nilai apa saja
   * @returns {string} teks ter-escape, string kosong untuk null/undefined
   */
  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Terima URL gambar hanya kalau aman ditampilkan.
   *
   * Aturannya satu tempat, bukan tiga: host luar harus ada di
   * ALLOWED_IMAGE_HOSTS, dan path lokal harus berada di assets/
   * tanpa_naiki directory. Path relatif polos tanpa awalan
   * assets/ (mis. "kapal.jpg") ditolak karena bisa keluar dari
   * folder aset lewat ../ dan karena tidak pernah dipakai data ini.
   *
   * @param {*} url - nilai mentah dari data kapal
   * @returns {string} URL yang aman, atau FALLBACK_IMAGE
   */
  function safeImageUrl(url) {
    if (!url || typeof url !== 'string') return FALLBACK_IMAGE;

    var trimmed = url.trim();
    if (!trimmed) return FALLBACK_IMAGE;

    var remote = trimmed.match(/^https?:\/\/([^/?#]+)/i);
    if (remote) {
      var host = remote[1].toLowerCase();
      if (ALLOWED_IMAGE_HOSTS.indexOf(host) === -1) return blocked(trimmed);
      return trimmed;
    }

    // WHY sebelum pemeriksaan path: data URL bukan path relatif, jadi
    // aturan assets/ tidak berlaku untuknya. Hanya bentuk yang cocok
    // pola ketat di atas yang diterima - sisanya tetap diblokir.
    if (DATA_IMAGE_PATTERN.test(trimmed)) return trimmed;

    // WHY leading slash tetap diizinkan hanya di dalam assets/: beberapa
    // tema mungkin menulis /assets/... dan itu tidak keluar dari repo.
    var path = trimmed.charAt(0) === '/' ? trimmed.slice(1) : trimmed;
    if (path.indexOf('..') !== -1) return blocked(trimmed);
    return path.indexOf('assets/') === 0 ? trimmed : blocked(trimmed);
  }

  /**
   * Tolak URL dan beri tahu soal datanya.
   *
   * WHY logger: gambar yang diam-diam diganti placeholder hampir tidak
   * pernah terlihat sampai seseorang melapor "fotonya kok hilang".
   * Peringatan ini membuatnya terlihat saat masih jadi masalah data.
   */
  function blocked(url) {
    console.warn('[Security] Blocked unsafe image URL:', url.slice(0, 60));
    return FALLBACK_IMAGE;
  }

  window.KapalProSanitize = {
    escapeHtml: escapeHtml,
    safeImageUrl: safeImageUrl,
    FALLBACK_IMAGE: FALLBACK_IMAGE,
    ALLOWED_IMAGE_HOSTS: ALLOWED_IMAGE_HOSTS
  };
})();