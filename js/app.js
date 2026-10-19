/**
 * Main Application Logic
 * Handles mobile menu, toast notifications, and utility functions
 */

// WHY: IIFE to avoid global scope pollution
(function() {
  'use strict';
  // WHY dinaikkan ke scope IIFE, bukan tetap di dalam initMobileMenu:
  // trapFocus() di bawah memakainya dari luar fungsi itu, dan
  // window.App mengeksposkannya. Versi pertama menyebutnya dari luar
  // initMobileMenu dan melempar ReferenceError yang menghentikan
  // SELURUH app.js - termasuk window.App, sehingga catalog.js gagal
  // di window.App.debounce. Gejalanya jauh dari penyebabnya: filter
  // katalog tidak merespons klik Reset.
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
                  'select:not([disabled]), textarea:not([disabled]), ' +
                  '[tabindex]:not([tabindex="-1"])';


  /**
   * Mobile Menu Toggle
   */
  function initMobileMenu() {
    var menuBtn = document.getElementById('mobile-menu-btn');
    var mobileMenu = document.getElementById('mobile-menu');
    var menuIcon = menuBtn ? menuBtn.querySelector('.menu-icon') : null;
    var closeIcon = menuBtn ? menuBtn.querySelector('.close-icon') : null;

    if (!menuBtn || !mobileMenu) return;

    // WHY konstanta: 768 adalah breakpoint tablet di css/style.css -
    // menu mobile hanya relevan di bawah itu. Ditulis sekali supaya
    // perubahan breakpoint tidak membelah logika JS dan CSS.
    var TABLET_BREAKPOINT = 768;

    // WHY: Nilai overflow asli disimpan sebelum dikunci, lalu dipulihkan
    // persis seperti semula. Versi lama menulis '' apa adanya, yang
    // menghapus aturan inline milik halaman lain (mis. drawer filter).
    var previousOverflow = '';

    // WHY: Konten di luar menu diberi inert + aria-hidden supaya tidak
    // bisa difokuskan dengan Tab maupun dibaca screen reader selagi
    // menu terbuka. Node-level inert diberi fallback aria-hidden
    // karena belum didukung di semua browser lama.
    function getBackgroundNodes() {
      var nodes = [];
      var all = document.body.children;
      for (var i = 0; i < all.length; i++) {
        var node = all[i];
        if (node === mobileMenu || node.contains(mobileMenu) || node.contains(menuBtn)) continue;
        nodes.push(node);
      }
      return nodes;
    }

    function setBackgroundInert(isInert) {
      var nodes = getBackgroundNodes();
      nodes.forEach(function(node) {
        if (isInert) {
          if (!node.hasAttribute('data-prev-aria-hidden')) {
            node.setAttribute('data-prev-aria-hidden', node.getAttribute('aria-hidden') || '');
          }
          node.setAttribute('aria-hidden', 'true');
          if ('inert' in HTMLElement.prototype) node.inert = true;
        } else {
          var prev = node.getAttribute('data-prev-aria-hidden');
          if (prev === null) return;
          if (prev === '') node.removeAttribute('aria-hidden');
          else node.setAttribute('aria-hidden', prev);
          node.removeAttribute('data-prev-aria-hidden');
          if ('inert' in HTMLElement.prototype) node.inert = false;
        }
      });
    }

    function getFocusableInMenu() {
      return Array.prototype.filter.call(
        mobileMenu.querySelectorAll(FOCUSABLE),
        function(el) {
          return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
        }
      );
    }

    function openMenu() {
      mobileMenu.classList.add('active');
      menuBtn.setAttribute('aria-expanded', 'true');
      // WHY: Label tombol harus ikut berubah. Kalau tetap "Buka menu"
      // saat menu sudah terbuka, pembaca layar memberi informasi yang
      // salah tentang state tombol tersebut.
      menuBtn.setAttribute('aria-label', 'Tutup menu');
      if (menuIcon) menuIcon.style.display = 'none';
      if (closeIcon) closeIcon.style.display = 'block';

      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      setBackgroundInert(true);

      // WHY: Fokus langsung masuk ke link menu pertama. Tanpa ini fokus
      // tetap di <body>, sehingga pembaca layar tidak tahu menu sudah
      // terbuka dan Tab mulai dari skip-link di belakang panel.
      var items = getFocusableInMenu();
      if (items.length) items[0].focus();
    }

    function closeMenu(returnFocus) {
      mobileMenu.classList.remove('active');
      menuBtn.setAttribute('aria-expanded', 'false');
      menuBtn.setAttribute('aria-label', 'Buka menu');
      if (menuIcon) menuIcon.style.display = 'block';
      if (closeIcon) closeIcon.style.display = 'none';
      document.body.style.overflow = previousOverflow;
      previousOverflow = '';
      setBackgroundInert(false);

      // WHY: Fokus dikembalikan ke tombol pemicu supaya alur keyboard
      // tidak hilang ke atas halaman setelah menu tertutup.
      if (returnFocus !== false) menuBtn.focus();
    }

    function toggleMenu() {
      if (mobileMenu.classList.contains('active')) closeMenu();
      else openMenu();
    }

    menuBtn.addEventListener('click', toggleMenu);

    // WHY: Menu diposisikan fixed menutupi seluruh layar, jadi klik di
    // luar panel (area gelap di bawahnya) harus menutup menu.
    mobileMenu.addEventListener('click', function(e) {
      if (e.target === mobileMenu) closeMenu();
    });

    // WHY: Close menu when clicking a link
    var menuLinks = mobileMenu.querySelectorAll('.mobile-menu-link');
    menuLinks.forEach(function(link) {
      link.addEventListener('click', function() {
        if (mobileMenu.classList.contains('active')) {
          // WHY: Fokus tidak dikembalikan ke tombol di sini - halaman
          // sedang berpindah, memaksa fokus ke tombol yang akan lenyap
          // akan menyisakan fokus di <body>.
          closeMenu(false);
        }
      });
    });

    // WHY: Escape menutup menu, Tab diputar di dalam panel, dan fokus
    // yang keluar dari panel (mis. diklik lewat script) ditarik
    // kembali ke dalam menu.
    document.addEventListener('keydown', function(e) {
      if (!mobileMenu.classList.contains('active')) return;

      if (e.key === 'Escape' || e.key === 'Esc') {
        closeMenu();
        return;
      }

      if (e.key !== 'Tab') return;

      var items = getFocusableInMenu();
      if (!items.length) {
        e.preventDefault();
        return;
      }

      var first = items[0];
      var last = items[items.length - 1];
      var active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || !mobileMenu.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !mobileMenu.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    });

    // WHY: Bila fokus berpindah ke luar panel tanpa lewat Tab
    // (klik atau script lain), tarik kembali ke dalam menu.
    document.addEventListener('focusin', function(e) {
      if (!mobileMenu.classList.contains('active')) return;
      if (mobileMenu.contains(e.target)) return;
      if (e.target === menuBtn) return;
      var items = getFocusableInMenu();
      if (items.length) items[0].focus();
    });

    // WHY: Close menu on resize to desktop
    window.addEventListener('resize', function() {
      if (window.innerWidth >= TABLET_BREAKPOINT && mobileMenu.classList.contains('active')) {
        closeMenu(false);
      }
    });
  }

  /**
   * Toast Notifications (Section 1.13)
   * @param {string} message - Toast message (PLAIN TEXT - di-escape
   *   sebelum di-render, JANGAN pernah kirim HTML ke sini)
   * @param {string} type - 'success', 'error', or 'info'
   * @param {number} duration - Duration in ms (default: 5000)
   */
  function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 5000;

    // WHY: XSS hardening (Section 2.2) - message bisa berisi data
    // dari user (mis. error validasi dengan cuplikan input). Escape
    // agar innerHTML di bawah tidak pernah mengeksekusi markup.
    // WHY sumber tunggal: KapalProSanitize.escapeHtml (js/sanitize.js).
    // WHY fallback inline: jika sanitize.js gagal dimuat, toast tidak boleh
    // melempar - ini single point of failure untuk seluruh situs.
    var esc = window.KapalProSanitize ? window.KapalProSanitize.escapeHtml : function(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };
    message = esc(String(message));

    var container = document.querySelector('.toast-container');
    
    // WHY: Create container if it doesn't exist
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'true');
      document.body.appendChild(container);
    }

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.setAttribute('role', 'alert');

    // WHY: Icon based on type
    var iconSvg = '';
    if (type === 'success') {
      iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
    } else if (type === 'error') {
      iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
    } else {
      iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    }

    toast.innerHTML = 
      '<span class="toast-icon">' + iconSvg + '</span>' +
      '<span class="toast-message">' + message + '</span>' +
      '<button class="toast-close" aria-label="Close notification">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<line x1="18" y1="6" x2="6" y2="18"></line>' +
          '<line x1="6" y1="6" x2="18" y2="18"></line>' +
        '</svg>' +
      '</button>';

    container.appendChild(toast);

    // WHY: Close button handler
    var closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', function() {
      removeToast(toast);
    });

    // WHY: Auto-remove after duration
    setTimeout(function() {
      removeToast(toast);
    }, duration);
  }

  /**
   * Remove toast with animation
   * @param {HTMLElement} toast - Toast element to remove
   */
  function removeToast(toast) {
    if (!toast || !toast.parentNode) return;
    
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 200ms ease';
    
    setTimeout(function() {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 200);
  }

  /**
   * Smooth scroll to element
   * @param {string} targetId - Target element ID
   */
  function scrollTo(targetId) {
    var target = document.getElementById(targetId);
    if (target) {
      // WHY: Tinggi header DIUKUR, bukan ditulis 72 di sini. Nilai
      // hardcoded sudah salah begitu header memakai padding-top dari
      // safe-area notch - hasil scroll berhenti di belakang header.
      // Fallback 72 hanya untuk halaman tanpa .header (mis. 404).
      var headerEl = document.querySelector('.header');
      var headerHeight = headerEl ? headerEl.getBoundingClientRect().height : 72;
      var targetPosition = target.getBoundingClientRect().top + window.pageYOffset - headerHeight;
      
      window.scrollTo({
        top: targetPosition,
        behavior: 'smooth'
      });
    }
  }

  /**
   * Debounce function (Section 12.3)
   * @param {Function} func - Function to debounce
   * @param {number} wait - Wait time in ms
   * @returns {Function} Debounced function
   */
  function debounce(func, wait) {
    var timeout;
    return function() {
      var context = this;
      var args = arguments;
      clearTimeout(timeout);
      timeout = setTimeout(function() {
        func.apply(context, args);
      }, wait);
    };
  }

  /**
   * Throttle function (Section 12.3)
   * @param {Function} func - Function to throttle
   * @param {number} limit - Limit time in ms
   * @returns {Function} Throttled function
   */
  function throttle(func, limit) {
    var inThrottle;
    return function() {
      var context = this;
      var args = arguments;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(function() {
          inThrottle = false;
        }, limit);
      }
    };
  }

  /**
   * Get URL parameters
   * @param {string} name - Parameter name
   * @returns {string|null} Parameter value
   */
  function getUrlParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  /**
   * Set URL parameter without reload
   * @param {string} key - Parameter key
   * @param {string} value - Parameter value
   */
  function setUrlParam(key, value) {
    var params = new URLSearchParams(window.location.search);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    var newUrl = window.location.pathname + '?' + params.toString();
    window.history.replaceState({}, '', newUrl);
  }

  /**
   * Cookie Consent (Section 10.3)
   */
  function initCookieConsent() {
    var consentKey = 'kapalpro-cookie-consent';
    var consentBanner = document.getElementById('cookie-consent');

    if (!consentBanner) return;

    // WHY try/catch: localStorage melempar di private mode / storage
    // penuh. Tanpa ini init() terhenti dan initServiceWorker()
    // tidak pernah jalan.
    function readConsent() {
      try { return localStorage.getItem(consentKey); } catch (e) { return null; }
    }
    function writeConsent(value) {
      try { localStorage.setItem(consentKey, value); } catch (e) {}
    }

    // WHY diekspos: setelah banner di-dismiss tidak ada cara mengubah
    // pilihan selain hapus localStorage manual. Footer punya tautan
    // "Kelola Cookie" yang memanggil reset() ini.
    // WHY didefinisikan SEBELUM early return: pengunjung yang sudah
    // pernah consent langsung return di bawah, dan tanpa ini
    // window.KapalProCookies tidak ada sehingga tombol "Kelola Cookie"
    // mati total bagi mereka.
    window.KapalProCookies = {
      reset: function() {
        try { localStorage.removeItem(consentKey); } catch (e) {}
        if (consentBanner) consentBanner.classList.add('active');
      }
    };

    // WHY: Check if user already consented
    if (readConsent()) {
      return;
    }
    
    // WHY: Show banner after 2 seconds
    setTimeout(function() {
      consentBanner.classList.add('active');
    }, 2000);
    
    /**
     * WHY: Broadcast the consent decision so other modules
     * (analytics.js) can react without polling localStorage.
     * Section 1.13: loose coupling via DOM events.
     */
    function dispatchConsent(consentValue) {
      document.dispatchEvent(new CustomEvent('kapalpro:consent', {
        detail: { consent: consentValue }
      }));
    }

    // WHY: Accept button
    var acceptBtn = consentBanner.querySelector('.cookie-accept');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', function() {
        writeConsent('true');
        consentBanner.classList.remove('active');
        dispatchConsent('true');
        showToast('Cookie preferences saved', 'success');
      });
    }
    
    // WHY: Decline button
    var declineBtn = consentBanner.querySelector('.cookie-decline');
    if (declineBtn) {
      declineBtn.addEventListener('click', function() {
        writeConsent('false');
        consentBanner.classList.remove('active');
        dispatchConsent('false');
        showToast('Analytics dinonaktifkan', 'info');
      });
    }
  }

  /**
   * Apakah service worker boleh didaftarkan di lokasi ini?
   *
   * WHY dipisah sebagai fungsi murni: keputusan ini tidak bisa diuji
   * lewat halaman sungguhan - pengujian berjalan di localhost, yang
   * justru termasuk lokasi yang harus DITOLAK. Sebagai fungsi murni,
   * tests/pwa.test.js bisa memanggilnya lewat window.App dengan lokasi
   * buatan untuk kedua sisi keputusan.
   *
   * WHY bukan window.isSecureContext: localhost JUGA konteks aman,
   * jadi isSecureContext bernilai true di mesin pengembang - justru di
   * situ service worker paling merugikan, karena berkas yang sedang
   * disunting terus disajikan dari cache dan perubahannya tidak pernah
   * terlihat. Daftar nama host di bawah menutup kasus itu.
   *
   * @param {object} loc - objek mirip window.location
   * @returns {boolean}
   */
  function shouldRegisterServiceWorker(loc) {
    if (!('serviceWorker' in navigator)) return false;
    if (!loc) return false;

    var host = String(loc.hostname || '').toLowerCase();
    if (host === '' || host === 'localhost' || host === '127.0.0.1' ||
        host === '::1' || host === '[::1]') return false;

    // WHY wajib https: service worker hanya berjalan di konteks aman, dan
    // konteks aman non-https hanyalah localhost - yang sudah ditolak di
    // atas. Host uji di jaringan lokal (mis. 192.168.1.5) karena itu
    // ditolak di sini, bukan dicoba lalu gagal di console.
    if (loc.protocol !== 'https:') return false;

    return true;
  }

  /**
   * Registrasi service worker (mode offline + instalasi PWA).
   *
   * WHY setelah 'load': registrasi menarik sw.js dan, saat install,
   * lima berkas precache - menjalankannya sebelum halaman selesai
   * memuat hanya menambah beban pada koneksi yang sama. Tanpa service
   * worker pun situs tetap berfungsi penuh, jadi kegagalan di sini
   * tidak pernah ditampilkan ke pengunjung.
   */
  function initServiceWorker() {
    if (!shouldRegisterServiceWorker(window.location)) return;

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        // WHY console, bukan toast: gagal registrasi tidak mengurangi
        // apa pun yang bisa dipakai pengunjung.
        console.log('[KapalPro] Service worker gagal didaftarkan:', err && err.message);
      });
    });
  }

  /**
   * Initialize all components
   */
  function init() {
    initMobileMenu();
    initCookieConsent();
    initCookieManage();
    initServiceWorker();

    // WHY: Log initialization for debugging (Section 1.13)
    console.log('[KapalPro] Application initialized');
  }

  /**
   * WHY: Tautan "Kelola Cookie" di footer membuka ulang banner persetujuan.
   * Delegasi ke document supaya tetap jalan walau footer di-render belakangan.
   */
  function initCookieManage() {
    document.addEventListener('click', function(e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-manage-cookies]') : null;
      if (!btn) return;
      e.preventDefault();
      if (window.KapalProCookies) window.KapalProCookies.reset();
    });
  }

  /**
   * Kunci fokus di dalam sebuah panel sampai Escape ditekan.
   *
   * WHY modul ini ada: menu mobile sudah punya focus trap sendiri,
   * tapi drawer filter katalog dan drawer perbandingan kapal tidak.
   * Tanpa trap, Tab dari tombol tutup akan berjalan ke belakang panel
   * dan masuk ke kontrol di halaman yang justru tersembunyi - pembaca
   * layar membaca tombol yang tidak terlihat, dan pengguna keyboard
   * kehilangan tempatnya. Ini WCAG 2.4.3 (Focus Order).
   *
   * BUKAN modal HTML: <dialog>.showModal() sudah melakukan ini,
   * tapi tidak didukung di browser lama yang masih jadi target, dan
   * drawer di sini perlu animasi slide-up yang showModal() tidak
   * punya.
   *
   * @param {HTMLElement} panel  elemen yang menahan fokus
   * @param {object} opts
   * @param {boolean} opts.isOpen()      apakah panel sedang terbuka
   * @param {function} opts.onClose()    dipanggil saat Esc ditekan
   * @returns {function} lepaskan trap
   */
  function trapFocus(panel, opts) {
    if (!panel) return function () {};

    function focusable() {
      return Array.prototype.filter.call(
        panel.querySelectorAll(FOCUSABLE),
        function (el) {
          // WHY filter berdasarkan ukuran: node yang di-DOM tapi
          // tersembunyi (display:none lewat CSS) akan membuat
          // .focus() diam-diam gagal, dan fokus terjebak di panel.
          return el.offsetWidth > 0 || el.offsetHeight > 0 ||
                 el.getClientRects().length > 0;
        }
      );
    }

    function onKeydown(e) {
      if (e.key !== 'Tab') return;
      if (opts.isOpen && !opts.isOpen()) return;
      var items = focusable();
      if (items.length === 0) return;
      var first = items[0];
      var last = items[items.length - 1];
      var active = document.activeElement;

      // WHY dua kasus, bukan satu: Tab dari elemen terakhir harus
      // kembali ke pertama, dan Shift+Tab dari elemen pertama harus
      // maju ke terakhir. Hanya salah satu yang ditangani akan
      // membuat satu arah terlewat.
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }

    function onEsc(e) {
      if (e.key !== 'Escape') return;
      if (opts.isOpen && !opts.isOpen()) return;
      if (opts.onClose) opts.onClose();
    }

    document.addEventListener('keydown', onKeydown);
    document.addEventListener('keydown', onEsc);

    return function release() {
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('keydown', onEsc);
    };
  }

  // WHY: Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose public API
  window.App = {
    showToast: showToast,
    scrollTo: scrollTo,
    debounce: debounce,
    throttle: throttle,
    getUrlParam: getUrlParam,
    setUrlParam: setUrlParam,
    trapFocus: trapFocus,
    FOCUSABLE: FOCUSABLE,
    shouldRegisterServiceWorker: shouldRegisterServiceWorker
  };
})();
