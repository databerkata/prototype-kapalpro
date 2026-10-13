/**
 * Contact Page Logic
 * Handles contact form validation, WhatsApp fallback, and tracking
 * Compliant with RULES.md Sections 1.6, 1.13
 */

// WHY: IIFE to avoid global scope pollution
(function() {
  'use strict';

  // WHY: Sumber tunggal = js/config.js (window.KAPALPRO_CONFIG).
  // Fallback di bawah hanya bila config.js gagal dimuat (mis. CSP/CDN),
  // supaya halaman tetap punya link yang berfungsi.
  var CFG = window.KAPALPRO_CONFIG || {};
  var WHATSAPP_NUMBER = CFG.whatsappNumber || '6285648048730';

  /** Init after DOM ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    var form = document.getElementById('contact-form');
    if (!form) return;

    form.addEventListener('submit', onSubmit);

    // WHY: Populate vessel dropdown dari vessels.json untuk LOI
    populateVesselDropdown();

    // WHY: Clear error state as soon as the user edits a field again
    var fields = ['contact-name', 'contact-email', 'contact-phone', 'contact-message'];
    fields.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', function() {
          clearError(el);
        });
      }
    });

    console.log('[KapalPro] Contact form initialized');
  }

  /**
   * WHY: Dropdown kapal untuk Letter of Intent — user pilih kapal spesifik
   * yang diminati dari 34 listing. Data dari vessels.json via js/data.js.
   */
  function populateVesselDropdown() {
    var select = document.getElementById('contact-vessel');
    if (!select) return;

    function fill(vessels) {
      vessels.forEach(function(v) {
        if (v.status === 'sold') return; // hanya kapal tersedia
        var opt = document.createElement('option');
        opt.value = v.id + ' - ' + v.name;
        opt.textContent = v.id + ' - ' + v.name;
        select.appendChild(opt);
      });
    }

    if (window.KapalProData && window.KapalProData.getVessels) {
      window.KapalProData.getVessels().then(fill).catch(function() {});
    } else {
      // Fallback: fetch langsung
      fetch('data/vessels.json').then(function(r) { return r.json(); }).then(fill).catch(function() {});
    }
  }

  /**
   * Handle form submit: validate, then either open Google Forms
   * (production) or fall back to WhatsApp with pre-filled message
   */
  function onSubmit(e) {
    e.preventDefault();

    // WHY: Re-query here (not via init closure) so this handler
    // never depends on call context
    var form = document.getElementById('contact-form');

    var data = {
      name: value('contact-name'),
      email: value('contact-email'),
      phone: value('contact-phone'),
      company: value('contact-company'),
      vessel: value('contact-vessel'),
      offer_price: value('contact-offer-price'),
      subject: value('contact-subject'),
      message: value('contact-message')
    };

    // ============================================================
    // VALIDATION (Section 1.6: inline errors, i18n messages)
    // ============================================================
    var valid = true;

    valid = requireField('contact-name', data.name, 'contact.errName') && valid;
    valid = requireField('contact-email', data.email, 'contact.errEmail') && valid;
    if (data.email && !isValidEmail(data.email)) {
      showError('contact-email', 'Format email tidak valid');
      valid = false;
    }
    valid = requireField('contact-phone', data.phone, 'contact.errPhone') && valid;
    valid = requireField('contact-message', data.message, 'contact.errMessage') && valid;

    if (!valid) {
      window.App.showToast('Mohon lengkapi field yang wajib diisi', 'error');
      return;
    }

    // ============================================================
    // ANALYTICS (Minggu 3)
    // ============================================================
    if (window.KapalProAnalytics) {
      window.KapalProAnalytics.track('Contact Submit', {
        subject: data.subject,
        has_company: !!data.company
      });
    }

    // ============================================================
    // SUBMIT
    // WHY: Pengiriman diatur dari SATU tempat (js/config.js). Kalau
    // konfigurasi form belum lengkap, KapalProContact.form() null dan
    // pengiriman jatuh ke fallback WhatsApp dengan pesan pre-filled.
    // ============================================================
    var submitBtn = document.getElementById('contact-submit');
    // WHY guard: tanpa tombol, loading state dilewati tapi pengiriman
    // tetap jalan.
    if (submitBtn) {
      submitBtn.classList.add('loading');
      submitBtn.disabled = true;
    }

    // WHY konfigurasi ada di js/config.js (contactFormUrl +
    // contactFormFields). Selama belum diisi lengkap,
    // KapalProContact.form() mengembalikan null dan pengiriman jatuh ke
    // fallback WhatsApp seperti sebelumnya.
    var googleForm = window.KapalProContact && window.KapalProContact.form('contact');

    if (googleForm) {
      // WHY: Form GET redirect mengisi field Google Forms lalu user submit di sana
      var params = new URLSearchParams();
      // WHY subject dikirim sebagai label (bukan key mentah): cabang
      // WhatsApp memakai subjectLabel(), jadi spreadsheet dan WA konsisten.
      var formData = {
        name: data.name,
        email: data.email,
        phone: data.phone,
        company: data.company,
        vessel: data.vessel,
        offer_price: data.offer_price,
        subject: subjectLabel(data.subject),
        message: data.message
      };
      Object.keys(googleForm.fields).forEach(function(key) {
        var entryId = googleForm.fields[key];
        // WHY hanya field yang terisi: Google Forms menolak entri kosong
        // di beberapa konfigurasi, dan mengirim "" hanya menambah baris
        // kosong di spreadsheet.
        if (entryId && formData[key]) params.set(entryId, formData[key]);
      });
      // WHY pilih '?' atau '&': URL hasil tombol Send Google Forms sudah
      // membawa query (?usp=sf_link). Menambah '?' kedua menghasilkan
      // "...viewform?usp=sf_link?entry.X=..." - browser membaca seluruh
      // sisa sebagai nilai usp, sehingga form terbuka TANPA isian yang
      // sudah diisi. Pengirim mengira data masuk, isian tidak ke mana-
      // mana. Bentrok query seperti ini harus ditangani kode, bukan
      // dititipkan ke catatan setup yang gampang terlewat.
      var sep = googleForm.url.indexOf('?') === -1 ? '?' : '&';
      // WHY cek return value: window.open null jika popup diblokir.
      var formWin = window.open(googleForm.url + sep + params.toString(), '_blank', 'noopener');
      if (!formWin) {
        window.App.showToast('Popup diblokir browser. Izinkan popup untuk situs ini lalu kirim ulang.', 'error');
      } else {
        window.App.showToast('Formulir siap diisi. Google Forms terbuka di tab baru - klik Submit di sana.', 'success');
      }
      resetFormState(form);
    } else {
      // Fallback: WhatsApp pre-filled
      var text =
        'Halo, saya menghubungi melalui website KapalPro untuk Letter of Intent.\n\n' +
        'Nama: ' + data.name + '\n' +
        'Email: ' + data.email + '\n' +
        'Telepon: ' + data.phone + '\n' +
        (data.company ? 'Perusahaan: ' + data.company + '\n' : '') +
        (data.vessel ? 'Kapal diminati: ' + data.vessel + '\n' : '') +
        (data.offer_price ? 'Harga penawaran: Rp ' + Number(data.offer_price).toLocaleString('id-ID') + '\n' : '') +
        'Perihal: ' + subjectLabel(data.subject) + '\n\n' +
        'Pesan:\n' + data.message;

      var waUrl = 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(text);
      // WHY cek return value: popup diblokir -> null, jangan klaim sukses.
      var waWin = window.open(waUrl, '_blank', 'noopener');
      if (!waWin) {
        window.App.showToast('Popup diblokir browser. Izinkan popup untuk situs ini lalu kirim ulang.', 'error');
      } else {
        window.App.showToast('Pesan siap dikirim. WhatsApp akan terbuka di tab baru.', 'success');
      }
      resetFormState(form);
    }
  }

  /**
   * WHY: Satu tempat untuk membersihkan state setelah submit,
   * agar tombol tidak pernah tertinggal di kondisi disabled/loading
   * (Section 1.6: loading state harus selalu selesai)
   */
  function resetFormState(form) {
    var submitBtn = document.getElementById('contact-submit');
    if (form) form.reset();
    if (submitBtn) {
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
    }
  }

  // ============================================================
  // HELPERS
  // ============================================================

  function value(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function isValidEmail(email) {
    // WHY: Simple sanity check, bukan validasi RFC penuh
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function requireField(id, val, i18nKey) {
    if (!val) {
      showError(id, i18nKey);
      return false;
    }
    return true;
  }

  function showError(id, message) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.add('input-error');
    el.setAttribute('aria-invalid', 'true');
    var err = document.getElementById(id + '-error');
    if (err) {
      err.textContent = message;
      // WHY: Tampilkan juga ke user sighted (bukan hanya screen reader)
      err.classList.add('field-error-text');
      err.classList.remove('sr-only');
    }
  }

  function clearError(el) {
    el.classList.remove('input-error');
    el.removeAttribute('aria-invalid');
    var err = document.getElementById(el.id + '-error');
    if (err) {
      err.textContent = '';
      err.classList.remove('field-error-text');
      err.classList.add('sr-only');
    }
  }

  function subjectLabel(val) {
    var label = {
      membeli: 'Saya ingin membeli kapal',
      menjual: 'Saya ingin menjual kapal',
      konsultasi: 'Konsultasi umum',
      lainnya: 'Lainnya'
    }[val];
    return label || val;
  }
})();
