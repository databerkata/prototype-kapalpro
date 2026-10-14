/**
 * Performance Monitoring - Core Web Vitals
 * Tracks FCP, LCP, CLS, FID, TTFB
 * Compliant with RULES.md Section 11.3
 */

(function() {
  'use strict';

  // WHY: Only run in production
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    console.log('[Perf] Skipped in development');
    return;
  }

  var metrics = {};
  var observers = [];

  // WHY: Guard kirim-tunggal. Metrik dikirim SATU kali per halaman;
  // tanpa ini setiap event consent berikutnya mengirim ulang laporan
  // yang sama dan angka Core Web Vitals jadi terhitung berkali-kali.
  var reportSent = false;

  // WHY: Listener consent yang sedang menunggu (null kalau tidak ada).
  // Dipertahankan sebagai referensi supaya bisa dilepas setelah kirim.
  var consentListener = null;

  // WHY: Kunci dan nama event yang sama dengan js/app.js dan
  // js/analytics.js - sumbernya satu di sana, salinan di sini hanya
  // untuk membaca tanpa membuat ketergantungan bundling.
  var CONSENT_KEY = 'kapalpro-cookie-consent';
  var CONSENT_EVENT = 'kapalpro:consent';

  function readConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch (e) {
      // WHY: localStorage bisa melempar di private mode - anggap belum
      // dijawab, bukan dianggap setuju.
      return null;
    }
  }

  /**
   * Track First Contentful Paint (FCP)
   * WHY: FCP measures when first content appears - target < 1.5s
   */
  function trackFCP() {
    if ('PerformanceObserver' in window) {
      var observer = new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        entries.forEach(function(entry) {
          if (entry.name === 'first-contentful-paint') {
            metrics.fcp = Math.round(entry.startTime);
            console.log('[Perf] FCP:', metrics.fcp + 'ms');
          }
        });
      });
      observer.observe({ type: 'paint', buffered: true });
      observers.push(observer);
    }
  }

  /**
   * Track Largest Contentful Paint (LCP)
   * WHY: LCP measures loading performance - target < 2.5s
   */
  function trackLCP() {
    if ('PerformanceObserver' in window) {
      var observer = new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        var lastEntry = entries[entries.length - 1];
        metrics.lcp = Math.round(lastEntry.startTime);
        console.log('[Perf] LCP:', metrics.lcp + 'ms');
      });
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
      observers.push(observer);
    }
  }

  /**
   * Track Cumulative Layout Shift (CLS)
   * WHY: CLS measures visual stability - target < 0.1
   */
  function trackCLS() {
    if ('PerformanceObserver' in window) {
      var observer = new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        entries.forEach(function(entry) {
          if (!entry.hadRecentInput) {
            metrics.cls = (metrics.cls || 0) + entry.value;
          }
        });
        console.log('[Perf] CLS:', metrics.cls.toFixed(4));
      });
      observer.observe({ type: 'layout-shift', buffered: true });
      observers.push(observer);
    }
  }

  /**
   * Track First Input Delay (FID)
   * WHY: FID measures interactivity - target < 100ms
   */
  function trackFID() {
    if ('PerformanceObserver' in window) {
      var observer = new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        entries.forEach(function(entry) {
          metrics.fid = Math.round(entry.processingStart - entry.startTime);
          console.log('[Perf] FID:', metrics.fid + 'ms');
        });
      });
      observer.observe({ type: 'first-input', buffered: true });
      observers.push(observer);
    }
  }

  /**
   * Track Time to First Byte (TTFB)
   * WHY: TTFB measures server response time - target < 800ms
   */
  function trackTTFB() {
    if ('performance' in window) {
      var navEntry = performance.getEntriesByType('navigation')[0];
      if (navEntry) {
        metrics.ttfb = Math.round(navEntry.responseStart - navEntry.requestStart);
        console.log('[Perf] TTFB:', metrics.ttfb + 'ms');
      }
    }
  }

  /**
   * Track Total Blocking Time (TBT)
   * WHY: TBT measures main thread blocking - target < 200ms
   */
  function trackTBT() {
    if ('PerformanceObserver' in window) {
      var observer = new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        entries.forEach(function(entry) {
          if (entry.duration > 50) {
            metrics.tbt = (metrics.tbt || 0) + (entry.duration - 50);
          }
        });
      });
      observer.observe({ type: 'longtask', buffered: true });
      observers.push(observer);
    }
  }

  /**
   * Kirim metrik bila consent sudah diberikan. Tanpa consent: TIDAK
   * dikirim (aturan yang sama dengan seluruh js/analytics.js).
   *
   * WHY urutannya penting: laporan lama berjalan tepat 3 detik setelah
   * load dan memanggil window.plausible langsung. Banner consent
   * muncul di detik ke-2, jadi hampir selalu laporan jatuh SEBELUM
   * pengguna menjawab - dan window.plausible belum ada (Plausible baru
   * dimuat setelah consent). Akibatnya setiap kunjungan pertama Core
   * Web Vitals hilang diam-diam, persis saat datanya paling dibutuhkan.
   *
   * Perbaikannya dua lapis:
   *   1. Kirim lewat KapalProAnalytics.track(), yang mengantre event
   *      sampai skrip Plausible benar-benar siap (bukan memanggil
   *      window.plausible yang bisa belum terdefinisi).
   *   2. Kalau consent belum dijawab, metrik TIDAK dibuang - listener
   *      dipasang di event kapalpro:consent dan kirim terjadi begitu
   *      pengguna menerima. Ditolak = tidak pernah dikirim.
   *
   * @returns {boolean} true kalau terkirim pada panggilan ini
   */
  function sendMetrics() {
    if (reportSent) return false;
    if (readConsent() !== 'true') return false;

    reportSent = true;
    if (consentListener) {
      document.removeEventListener(CONSENT_EVENT, consentListener);
      consentListener = null;
    }

    if (window.KapalProAnalytics && typeof window.KapalProAnalytics.track === 'function') {
      // WHY track() menangani antrean sampai Plausible load dan
      // menolak localhost, jadi satu panggilan ini cukup.
      window.KapalProAnalytics.track('Performance', metrics);
    } else if (typeof window.plausible === 'function') {
      // WHY fallback: analytics.js gagal dimuat, tapi Plausible tetap
      // ada (mis. disuntik host). Lebih baik terkirim lewat jalur lama
      // daripada hilang.
      window.plausible('Performance', { props: metrics });
    }
    return true;
  }

  /**
   * Pasang penunggu consent - hanya dipanggil kalau saat laporan
   * consent BELUM dijawab (atau ditolak; jawaban bisa berubah).
   */
  function waitForConsent() {
    if (consentListener) return;
    consentListener = function(e) {
      var value = (e && e.detail && e.detail.consent) || readConsent();
      // WHY: Hanya 'true' yang mengirim. 'false' - bahkan setelah
      // banner dijawab - berarti tetap tanpa kirim.
      if (value === 'true') sendMetrics();
    };
    document.addEventListener(CONSENT_EVENT, consentListener);
  }

  /**
   * Report metrics after page load
   */
  function reportMetrics() {
    // WHY: Wait for all metrics to be collected
    setTimeout(function() {
      console.log('[Perf] === Core Web Vitals Report ===');
      console.log('[Perf] FCP:', (metrics.fcp || 'N/A') + 'ms (target: <1500ms)');
      console.log('[Perf] LCP:', (metrics.lcp || 'N/A') + 'ms (target: <2500ms)');
      console.log('[Perf] CLS:', (typeof metrics.cls === 'number' ? metrics.cls.toFixed(4) : 'N/A') + ' (target: <0.1)');
      console.log('[Perf] FID:', (metrics.fid || 'N/A') + 'ms (target: <100ms)');
      console.log('[Perf] TTFB:', (metrics.ttfb || 'N/A') + 'ms (target: <800ms)');
      console.log('[Perf] TBT:', (metrics.tbt || 'N/A') + 'ms (target: <200ms)');
      console.log('[Perf] ================================');

      // WHY: Laporan ulang (PerfMetrics.report) setelah terkirim tidak
      // boleh memasang listener baru yang tidak berguna.
      if (reportSent) return;

      // WHY: Kirim dulu kalau sudah boleh; kalau belum, jangan buang -
      // antre sampai pengguna menjawab banner (lihat sendMetrics).
      if (!sendMetrics()) {
        waitForConsent();
        console.log('[Perf] Consent belum diberikan - laporan diantre sampai banner dijawab');
      }
    }, 3000);
  }

  /**
   * Initialize performance tracking
   */
  function init() {
    trackFCP();
    trackLCP();
    trackCLS();
    trackFID();
    trackTTFB();
    trackTBT();
    
    // WHY: Report after page fully loads
    if (document.readyState === 'complete') {
      reportMetrics();
    } else {
      window.addEventListener('load', reportMetrics);
    }
  }

  // WHY: Run immediately
  init();

  // Expose for debugging
  window.PerfMetrics = {
    getMetrics: function() { return metrics; },
    report: reportMetrics
  };
})();
