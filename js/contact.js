/**
 * Contact Page Logic
 * Handles contact form validation, direct Google Forms submission, and tracking
 * Compliant with RULES.md Sections 1.6, 1.13
 */

// WHY: IIFE to avoid global scope pollution
(function() {
  'use strict';

  // WHY: Sumber tunggal = js/config.js (window.KAPALPRO_CONFIG).
  var CFG = window.KAPALPRO_CONFIG || {};

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
    // SUBMIT — langsung ke Google Forms (POST /formResponse, no-cors).
    // Tanpa tab baru, tanpa WhatsApp (keputusan owner 2026-10-17:
    // nomor pribadi tidak dipakai di alur form).
    // ============================================================
    var submitBtn = document.getElementById('contact-submit');
    // WHY guard: tanpa tombol, loading state dilewati tapi pengiriman
    // tetap jalan.
    if (submitBtn) {
      submitBtn.classList.add('loading');
      submitBtn.disabled = true;
    }

    var googleForm = window.KapalProContact && window.KapalProContact.form('contact');

    if (!googleForm) {
      window.App.showToast('Formulir belum dapat dikirim saat ini. Silakan coba lagi nanti.', 'error');
      resetFormState(form, false);
      return;
    }

    // WHY: Bangun payload dari mapping config (bukan hardcode entry ID).
    var params = new URLSearchParams();
    // WHY subject dikirim sebagai label (bukan key mentah) supaya
    // spreadsheet konsisten dengan tampilan.
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
      // WHY hanya field yang terisi: mengirim "" hanya menambah sel
      // kosong di spreadsheet.
      if (entryId && formData[key]) params.set(entryId, formData[key]);
    });

    // WHY URL dibangun dari config, bukan hardcode ID:
    // /viewform -> /formResponse.
    var submitUrl = googleForm.url.replace(/\/viewform.*$/, '/formResponse');

    // WHY no-cors: Google Forms tidak mengirim header CORS; respons
    // opaque tapi data tercatat andal. fetch hanya reject bila network
    // gagal - saat itu data form dipertahankan untuk kirim ulang.
    fetch(submitUrl, {
      method: 'POST',
      mode: 'no-cors',
      body: params
    }).then(function() {
      window.App.showToast('Pesan terkirim. Kami akan menghubungi Anda segera.', 'success');
      resetFormState(form, true);
    }).catch(function() {
      window.App.showToast('Gagal mengirim. Periksa koneksi internet lalu kirim ulang.', 'error');
      resetFormState(form, false);
    });
  }

  /**
   * WHY: Satu tempat untuk membersihkan state setelah submit,
   * agar tombol tidak pernah tertinggal di kondisi disabled/loading
   * (Section 1.6: loading state harus selalu selesai)
   */
  function resetFormState(form, clear) {
    var submitBtn = document.getElementById('contact-submit');
    // WHY clear=false saat kirim gagal: data dipertahankan supaya user
    // bisa kirim ulang tanpa mengetik ulang.
    if (form && clear !== false) form.reset();
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
