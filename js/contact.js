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

    // WHY microcopy ekspektasi di bawah tombol (samakan pola form inquiry):
    // idempoten bila init dipanggil lebih dari sekali. Tombol adalah anak
    // langsung <form>, jadi <p> tersisip rapi di bawahnya.
    (function addExpectationNote() {
      var submitBtn = document.getElementById('contact-submit');
      if (submitBtn && !document.getElementById('contact-form-note')) {
        var note = document.createElement('p');
        note.id = 'contact-form-note';
        note.className = 'form-note';
        note.textContent = 'Tim kami akan menghubungimu maksimal 1×24 jam.';
        submitBtn.parentNode.insertBefore(note, submitBtn.nextSibling);
      }
    })();

    // WHY kurangi field wajib: Email jadi opsional (keputusan owner
    // 2026-10-17: turunkan friksi). Label form kontak tidak memakai tanda
    // * - helper tetap defensif bila markup berubah. Idempoten.
    (function makeEmailOptional() {
      var input = document.getElementById('contact-email');
      if (input) input.removeAttribute('required');
      var label = document.querySelector('label[for="contact-email"]');
      if (label) {
        var stars = label.querySelectorAll('span');
        Array.prototype.forEach.call(stars, function(sp) {
          if (sp.textContent.trim() === '*') sp.parentNode.removeChild(sp);
        });
        Array.prototype.forEach.call(label.childNodes, function(n) {
          if (n.nodeType === 3) n.nodeValue = n.nodeValue.replace(/\s*\*\s*$/, '');
        });
      }
    })();

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
    // WHY Email opsional sejak 2026-10-17: wajib-diisi dihapus, hanya
    // validasi format bila diisi.
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
      window.App.showToast('Pesan terkirim. Tim kami akan menghubungimu maksimal 1×24 jam.', 'success');
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
