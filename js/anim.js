/**
 * Animation Layer - KapalPro
 * ==========================
 * Scroll-reveal, stagger, counter angka, ripple klik, dan micro-interactions.
 * Hormati prefers-reduced-motion. ES5-style, IIFE (konsisten dengan codebase).
 *
 * Markup API:
 *   <div data-animate>              -> fade-up (default)
 *   <div data-animate="fade">       -> fade saja
 *   <div data-animate="left|right|zoom"> -> arah lain
 *   <container data-animate-group>  -> anak-anak di-stagger otomatis
 *   <span data-count="50" data-suffix="+">0</span> -> angka berhitung
 */
(function() {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Scroll Reveal ----------
  var observer = null;
  if ('IntersectionObserver' in window && !reducedMotion) {
    observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (!entry.isIntersecting) return;
        reveal(entry.target);
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
  }

  function reveal(el) {
    el.classList.add('is-revealed');
    el.classList.remove('reveal-pending');
  }

  function prepare(el, index) {
    if (el.dataset.animPrepared) return;
    el.dataset.animPrepared = '1';
    // WHY: --animate-delay untuk stagger; cap 420ms agar tidak terasa lambat
    el.style.setProperty('--animate-delay', Math.min(index * 70, 420) + 'ms');
    if (observer) {
      el.classList.add('reveal-pending');
      observer.observe(el);
    } else {
      // WHY: browser lama / reduced-motion -> langsung tampil tanpa animasi
      reveal(el);
    }
  }

  function scanAll() {
    var i = 0;
    Array.prototype.forEach.call(document.querySelectorAll('[data-animate]'), function(el) {
      if (el.dataset.animPrepared) return;
      prepare(el, i++);
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-animate-group]'), function(group) {
      Array.prototype.forEach.call(group.children, function(child, idx) {
        if (child.hasAttribute('data-animate')) return;
        child.setAttribute('data-animate', '');
        prepare(child, idx);
      });
    });
  }

  // ---------- Counter angka ----------
  function animateCounter(el) {
    if (el.dataset.counted) return;
    el.dataset.counted = '1';
    var target = parseFloat(el.getAttribute('data-count'));
    var suffix = el.getAttribute('data-suffix') || '';
    if (isNaN(target)) return;
    if (reducedMotion || !('requestAnimationFrame' in window)) {
      el.textContent = String(target) + suffix;
      return;
    }
    var duration = 1200;
    var start = null;
    function tick(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      el.textContent = String(Math.round(target * eased)) + (p === 1 ? suffix : '');
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function scanCounters() {
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-count]'), animateCounter);
      return;
    }
    var io = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (!entry.isIntersecting) return;
        animateCounter(entry.target);
        io.unobserve(entry.target);
      });
    }, { threshold: 0.4 });
    Array.prototype.forEach.call(document.querySelectorAll('[data-count]'), function(el) {
      io.observe(el);
    });
  }

  // ---------- Ripple klik ----------
  function bindRipple() {
    if (reducedMotion) return;
    document.addEventListener('click', function(e) {
      var target = e.target;
      if (!target || !target.closest) return;
      var btn = target.closest('.btn, .pagination-btn');
      if (!btn) return;
      var rect = btn.getBoundingClientRect();
      var size = Math.max(rect.width, rect.height);
      var ripple = document.createElement('span');
      ripple.className = 'ripple';
      ripple.style.width = size + 'px';
      ripple.style.height = size + 'px';
      ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
      ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
      btn.appendChild(ripple);
      setTimeout(function() {
        if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
      }, 650);
    });
  }

  // ---------- Header shadow saat scroll ----------
  function bindHeader() {
    var header = document.querySelector('.header');
    if (!header) return;
    var ticking = false;
    window.addEventListener('scroll', function() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function() {
        header.classList.toggle('is-scrolled', window.scrollY > 8);
        ticking = false;
      });
    }, { passive: true });
  }

  // ---------- Gallery: main image fade saat ganti ----------
  function bindGallery() {
    var main = document.getElementById('vessel-main-image');
    if (!main) return;
    main.addEventListener('load', function() {
      if (reducedMotion) return;
      main.classList.remove('image-enter');
      void main.offsetWidth; // WHY: reflow agar animasi restart
      main.classList.add('image-enter');
    });
  }

  // ---------- Fallback scroll check ----------
  // WHY: IO bisa ter-pause saat tab occluded / scroll teleport cepat;
  // fallback ini menjamin elemen pending selalu ter-reveal saat masuk viewport.
  function revealInView() {
    if (!observer) return;
    Array.prototype.forEach.call(document.querySelectorAll('.reveal-pending'), function(el) {
      // WHY: cukup cek top - elemen yang sudah terlewati (di atas viewport)
      // juga harus ter-reveal agar tidak nyangkut saat scroll cepat/teleport.
      if (el.getBoundingClientRect().top < window.innerHeight * 0.95) {
        reveal(el);
        observer.unobserve(el);
      }
    });
  }

  function bindScrollFallback() {
    if (!('IntersectionObserver' in window) || reducedMotion) return;
    var timer = null;
    window.addEventListener('scroll', function() {
      if (timer) return;
      timer = setTimeout(function() {
        timer = null;
        revealInView();
      }, 200);
    }, { passive: true });
    revealInView(); // WHY: tangkap elemen yang sudah in-view saat load
  }

  // ---------- Konten dinamis (render JS) ----------
  // WHY: katalog & related vessels merender ulang kartu via innerHTML;
  // MutationObserver memicu rescan otomatis tanpa menyentuh file JS lain.
  function observeDynamic() {
    if (!('MutationObserver' in window)) return;
    var io = new MutationObserver(function() { scanAll(); });
    ['vessels-grid', 'featured-vessels', 'related-vessels'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) io.observe(el, { childList: true, subtree: false });
    });
  }

  function init() {
    scanAll();
    scanCounters();
    bindRipple();
    bindHeader();
    bindGallery();
    bindScrollFallback();
    observeDynamic();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.KapalProAnim = {
    // WHY: rescan ikut menghitung ulang counter supaya elemen data-count
    // yang di-inject JS setelah init tetap ikut animasi (dulu hanya
    // scanAll() yg dipanggil, sehingga counter dinamis diam di nilai awal).
    rescan: function() {
      scanAll();
      scanCounters();
    }
  };
})();
