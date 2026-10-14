/**
 * Redirect URL kapal lama ke URL bersih.
 *
 * WHY file ini ada: sebelum tools/generate-vessel-pages.js, semua kapal
 * hanya hidup di /vessel.html?id=<ID>. Milling itu sekarang menulis
 * /vessel-<ID>.html yang berisi HTML penuh - nama, harga, spesifikasi,
 * JSON-LD - jadi bisa di-crawl tanpa menjalankan JavaScript. URL lama
 * harus tetap hidup karena bisa saja sudah terindeks atau sudah dibagikan
 * lewat WhatsApp, tapi tidak boleh jadi duplicate content.
 *
 * Sifat penting:
 *   - location.replace, bukan assign. Onexit tidak masuk riwayat browser,
 *     jadi tombol "kembali" tidak memunculkan bounce.
 *   - Hanya ID yang lolos pola[A-Za-z0-9_-]+ yang diteruskan. Parameter
 *     lain bentuknya tidak boleh masuk ke path, karena bisa dipakai
 *     membuat path menunjuk ke berkas yang tidak ada.
 *   - Kalau ID-nya tidak dikenal, halaman dibiarkan apa adanya supaya
 *     vessel.html masih bisa menampilkan pesan "kapal tidak ditemukan"
 *     yang berguna, bukan blank.
 *
 * Sisi tanpa JavaScript ditangani .htaccess dan _redirects, yang
 * mengirim 301 sejati sebelum HTML sampai ke browser.
 */
(function () {
  'use strict';

  var id = new URLSearchParams(window.location.search).get('id');
  if (!id || !/^[A-Za-z0-9_-]{1,32}$/.test(id)) return;

  var target = 'vessel-' + id + '.html';
  // Jangan berputar kalau path-nya sudah benar - ?id= boleh saja muncul
  // pada halaman statis, yang sah secara teknis.
  if (window.location.pathname.split('/').pop() === target) return;

  window.location.replace(target);
})();
