/**
 * Site Configuration - KapalPro
 * =============================
 * SATU-SATUNYA tempat untuk mengubah data kontak & domain.
 *
 * WHY: Sebelumnya nomor WhatsApp/telepon ditulis literal di 20+ tempat
 * (8 file HTML + 3 file JS + JSON-LD), sehingga ganti nomor berarti
 * 20+ edit dan rawan tidak sinkron. Sekarang semua dari sini.
 *
 * CARA GANTI NOMOR KAMU:
 *   1. Ubah `whatsappNumber` di bawah (format internasional TANPA
 *      tanda '+', TANPA spasi, contoh: 6285648048730).
 *   2. Selesai. Semua link WhatsApp dan tampilan nomor
 *      di seluruh situs ikut berubah otomatis saat halaman dimuat.
 *   3. Untuk SEO, hasil akhir tetap ditulis ke HTML (link WhatsApp dan
 *      teks footer) sehingga crawler tanpa JS tetap membaca nomor
 *      yang benar.
 */

// WHY: Format internasional tanpa '+' / spasi. wa.me/<angka> butuh
// bentuk ini; nomor tampilan dipakai nomorHp yang di bawah.
window.KAPALPRO_CONFIG = {
  // ---------- Kontak (GANTI DI SINI) ----------
  whatsappNumber: '6285648048730',

  // Tampilan nomor di footer/kartu kontak (format manusia)
  displayPhone: '+62 856-4804-8730',

  email: '',

  // ---------- Domain (untuk SEO / schema.org) ----------
  siteUrl: 'https://kapalpro.web.id',

  // ---------- Pengiriman form ke Google Forms (BELUM DIISI) ----------
  // WHY dikumpulkan di sini: sama seperti nomor, URL form dan ID entri
  // adalah pengaturan yang hanya boleh ditulis di SATU tempat. Sebelumnya
  // masing-masing form memuatnya sendiri dengan placeholder yang terlihat
  // seperti ID asli (`entry.1234567890`) - berbahaya, karena mengisi URL
  // saja akan mengirim data ke entri palsu tanpa ada yang protes.
  //
  // CARA MENGISI (dua langkah, keduanya wajib):
  //   1. Buat Google Forms, salin URL-nya (bentuk
  //      https://docs.google.com/forms/d/e/XXX/viewform) ke
  //      inquiryFormUrl / contactFormUrl.
  //   2. Salin ID tiap entri (tampil di URL saat mengedit: entry.1234567890)
  //      ke peta fields di bawah, dipetakan ke nama field form di HTML.
  //
  // SELAMA keduanya belum lengkap, form TIDAK dikirim ke Google Forms:
  // pengirim jatuh ke fallback WhatsApp seperti sebelumnya (lihat
  // KapalProContact.form()). Isi SEBAGIAN dianggap belum siap, bukan
  // "kirim yang ada" - data yang hilang diam-diam lebih mahal daripada
  // pesan yang diketik ulang.
  //
  // Status kedua form dicek tools/check-contact.js (peringatan biasa,
  // menjadi GAGAL dengan --strict sebelum go-live).
  inquiryFormUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSdq1U0-iYwt-Mjeg2vD2fCuGqARTKgQgF5m-eS1vCCk-4az-Q/viewform',
  inquiryFormFields: {
    'nama_lengkap': 'entry.420136394',
    'email': 'entry.712968501',
    'telepon': 'entry.178602181',
    'perusahaan': 'entry.1594666202',
    'jenis_kapal': 'entry.962904770',
    'pesan': 'entry.1333345726',
    'tanggal_survey': 'entry.1156272807',
    'offering_price': 'entry.462386922',
    'vessel_name': 'entry.168278793',
    'vessel_type': 'entry.84202432'
  },

  contactFormUrl: 'https://docs.google.com/forms/d/e/1FAIpQLScsSNKpIAJNC1AwoElrhZTOKH9IYJ_X9Ip2VGuLca98W_tlFA/viewform',
  contactFormFields: {
    'name': 'entry.2073323450',
    'email': 'entry.514358724',
    'phone': 'entry.1097312532',
    'company': 'entry.1818244995',
    'subject': 'entry.214943402',
    'message': 'entry.921153447'
  },

  // ---------- Sosial (kosongkan bila belum dipakai) ----------
  // social: { facebook: '', instagram: '', linkedin: '' }
};

// WHY: Helper agar HTML/JS lain tidak perlu hitung ulang format nomor.
// Dipasangkan ke window supaya bisa dipakai inline di markup & modul JS.
(function() {
  var c = window.KAPALPRO_CONFIG;
  window.KapalProContact = {
    whatsappUrl: function(message) {
      var base = 'https://wa.me/' + c.whatsappNumber;
      // WHY: wa.me menerima ?text= URL-encoded; pesan opsional.
      return message ? base + '?text=' + encodeURIComponent(message) : base;
    },
    displayPhone: function() {
      return c.displayPhone;
    },
    email: function() {
      return c.email;
    },

    /**
     * Konfigurasi pengiriman form, SUDAH dicek kesiapannya.
     *
     * WHY di satu tempat: vessel.js dan contact.js dulu punya masing-
     * masing `GOOGLE_FORM_URL = ''` dengan placeholder ID entri. Dua
     * salinan berarti dua tempat yang bisa lupa disinkronkan, dan
     * placeholder yang terlihat asli membuat konfigurasi setengah jadi
     * tampak selesai.
     *
     * @param {'inquiry'|'contact'} kind  jenis form
     * @returns {?{url: string, fields: Object}} null kalau BELUM siap
     */
    form: function(kind) {
      var isContact = kind === 'contact';
      var url = isContact ? c.contactFormUrl : c.inquiryFormUrl;
      var fields = isContact ? c.contactFormFields : c.inquiryFormFields;
      if (!url || !fields) return null;

      var keys = Object.keys(fields);
      if (!keys.length) return null;
      for (var i = 0; i < keys.length; i++) {
        // WHY ditolak kalau ada satu yang kosong: URL sudah terisi tapi
        // entri belum berarti form terkirim tanpa isian itu - kehilangan
        // data yang SULIT terdeteksi karena halaman tetap menampilkan
        // pesan sukses.
        if (!fields[keys[i]]) {
          if (window.console) {
            console.warn('[Config] Form "' + kind + '" belum lengkap: field "' +
              keys[i] + '" belum punya ID entri. Mengirim ke fallback WhatsApp.');
          }
          return null;
        }
      }
      return { url: url, fields: fields };
    }
  };
})();

/**
 * Terapkan konfigurasi ke seluruh elemen yang ditandai di HTML.
 *
 * WHY: HTML ditulis dengan nomor placeholder supaya tetap valid & bisa
 * di-index sebelum JS dimuat. Modul ini menyinkronkan tampilan + href
 * begitu JS berjalan, sehingga markup tetap punya fallback tanpa-JS.
 *
 * Atribut yang dikenali:
 *   data-wa          -> href = wa.me + pesan dari data-wa-msg
 *   data-wa-msg      -> pesan opsional pada link WhatsApp
 *   data-phone-text  -> teks tampilan nomor
 *   data-email-link  -> href = mailto:<email>
 *   data-phone-jsonld-> teks untuk JSON-LD ContactPoint
 */
(function() {
  var c = window.KAPALPRO_CONFIG;
  var contact = window.KapalProContact;

  function apply(root) {
    var scope = root || document;

    Array.prototype.forEach.call(scope.querySelectorAll('[data-phone-text]'), function(el) {
      el.textContent = contact.displayPhone();
    });

    Array.prototype.forEach.call(scope.querySelectorAll('[data-email-link]'), function(el) {
      el.setAttribute('href', 'mailto:' + contact.email());
    });

    Array.prototype.forEach.call(scope.querySelectorAll('[data-wa]'), function(el) {
      var msg = el.getAttribute('data-wa-msg');
      el.setAttribute('href', contact.whatsappUrl(msg));
    });

    // WHY: JSON-LD structured data ditulis sebagai <script type="application/ld+json">,
    // jadi tidak bisa di-querySelector. Cari lewat tag lalu update field telephone.
    Array.prototype.forEach.call(
      document.querySelectorAll('script[type="application/ld+json"]'),
      function(s) {
        if (!s.textContent || s.textContent.indexOf('telephone') === -1) return;
        try {
          var parsed = JSON.parse(s.textContent);
          var changed = false;
          if (parsed.telephone) { parsed.telephone = '+' + c.whatsappNumber; changed = true; }
          if (parsed.contactPoint) {
            // WHY: schema.org mengizinkan contactPoint sebagai SATU objek
            // atau array. Handle keduanya supaya tidak melempar TypeError.
            var points = Array.isArray(parsed.contactPoint)
              ? parsed.contactPoint
              : [parsed.contactPoint];
            points.forEach(function(cp) {
              if (cp && cp.telephone) { cp.telephone = '+' + c.whatsappNumber; changed = true; }
            });
          }
          if (changed) s.textContent = JSON.stringify(parsed, null, 2);
        } catch (err) {
          // WHY: JSON-LD rusak tidak boleh menghentikan halaman
          console.warn('[Config] Gagal memperbarui JSON-LD:', err);
        }
      }
    );
  }

  // WHY: Terapkan segera bila DOM sudah siap, atau tunggu DOMContentLoaded.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { apply(); });
  } else {
    apply();
  }

  window.KapalProConfig = { apply: apply, config: c };
})();
