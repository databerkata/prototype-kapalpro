/**
 * Aksi Cepat Halaman Kapal - KapalPro
 * ==================================
 *
 * Berisi dua hal yang kecil tapi dampaknya besar: tombol cetak dan
 * bilah aksi tetap di layar ponsel.
 *
 * WHY tombol cetak: di jual beli kapal bekas, dokumen yang bergerak
 * bolak-balik hampir selalu berupa berkas - spec sheet untuk
 * surveyor, lampiran untuk underwriting, dokumen untuk bank.
 * setiap shipbroker punya spec sheet PDF yang bisa
 * diunduh. Di sini window.print() + @media print di style.css
 * menghasilkan dokumen yang sama tanpa satu pun baris backend.
 * Di Chrome dan Safari, dialog cetak juga punya "Save as PDF".
 *
 * WHY bilah aksi: form penawaran adalah satu-satunya jalur konversi
 * situs ini, dan di ponsel ia berada jauh di bawah lipatan -
 * gallery kapal bisa membuat halaman setinggi beberapa ribu piksel.
 * Bilah tetap membuat WhatsApp selalu satu ketukan dari mana pun.
 *
 * File ini sengaja kecil. Logika yang layak diuji ada di test file
 * masing-masing; yang di sini hanya pengikatan event.
 */
(function () {
  'use strict';

  /**
   * Aktifkan tombol cetak.
   *
   * WHY tidak memakai markup statis: <button onclick> melanggar CSP dan
   * check-html-syntax. Penangan event dan logika di tempatnya.
   */
  function initPrint() {
    var btn = document.getElementById('print-vessel');
    if (!btn) return;
    btn.addEventListener('click', function () {
      // WHY guard: window.print tidak ada di beberapa browser
      // tertanam lama. Menjalankannya tanpa memeriksa akan
      // menjatuhkan error dan membatalkan sisa handler.
      if (typeof window.print !== 'function') return;
      window.print();
      if (window.KapalProAnalytics) {
        window.KapalProAnalytics.track('Spec Sheet Printed');
      }
    });
  }

  /**
   * Aktifkan bilah aksi tetap.
   *
   * WHY kelas body baru di-set di sini, bukan di HTML: ruang bawah
   * 72px hanya dibutuhkan kalau bilahnya benar-benar terlihat, yaitu
   * di bawah 768px. Meletakkannya di HTML akan menambah celah kosong
   * di footer pada halaman tanpa JavaScript dan di desktop.
   */
  function initStickyCta() {
    var bar = document.getElementById('sticky-cta');
    if (!bar) return;
    document.body.classList.add('has-sticky-cta');

    // WHY satu klik langsung ke form, bukan ke WhatsApp: pengguna
    // yang sudah menggulir ke bawah biasanya sudah memutuskan.
    var offer = document.getElementById('sticky-offer');
    if (offer) {
      offer.addEventListener('click', function () {
        if (window.KapalProAnalytics) {
          window.KapalProAnalytics.track('Sticky CTA Clicked', { action: 'offer' });
        }
      });
    }

    var wa = document.getElementById('sticky-whatsapp');
    if (wa) {
      wa.addEventListener('click', function () {
        if (window.KapalProAnalytics) {
          window.KapalProAnalytics.track('Sticky CTA Clicked', { action: 'whatsapp' });
        }
      });
    }
  }

  function init() {
    initPrint();
    initStickyCta();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();