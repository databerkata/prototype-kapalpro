/**
 * Plausible Analytics Integration - Consent-Gated
 * ============================================================
 * WHY Plausible:
 * - Cookieless (no personal data stored) -> PDP Law friendly
 * - Lightweight (< 1KB script) -> no Core Web Vitals impact
 * - GDPR/PDP compliant by default
 *
 * WHY consent-gated:
 * - RULES.md Section 10.3: analytics only after user approval
 * - Cookie banner (app.js) stores 'kapalpro-cookie-consent' = 'true'|'false'
 * - This script loads Plausible ONLY when consent === 'true'
 * - On decline, Plausible is blocked and never loaded
 *
 * Custom events tracked (business funnel):
 * - WhatsApp Click   -> sidebar/form/CTA WhatsApp buttons
 * - Inquiry Submit   -> LOI form submission (vessel page)
 * - Search           -> catalog search (debounced)
 * - Filter Applied   -> catalog type/status/price/year/location filters
 * - CTA Click        -> generic data-analytics-event elements
 *
 * HOW to enable (production):
 * 1. Create account at https://plausible.io
 * 2. Add site domain = kapalpro.web.id
 * 3. Update PLAUSIBLE_DOMAIN below (must match your Plausible site)
 * 4. See SETUP-PLAUSIBLE.md for goal/event registration
 *
 * Compliant with RULES.md Sections 2, 10.3, 11.3
 */

(function() {
  'use strict';

  // ============================================================
  // CONFIG - update these for production
  // ============================================================
  var CONFIG = {
    // WHY: Must match the domain registered in your Plausible dashboard
    PLAUSIBLE_DOMAIN: 'kapalpro.web.id',
    // WHY: Default Plausible SaaS script. Self-hosted: '/js/script.js' on your domain
    PLAUSIBLE_SRC: 'https://plausible.io/js/script.js',
    // WHY: Same key app.js cookie consent uses
    CONSENT_KEY: 'kapalpro-cookie-consent',
    // WHY: Custom DOM event dispatched by app.js when user answers the banner
    CONSENT_EVENT: 'kapalpro:consent'
  };

  // WHY: Never track local development
  var isLocalhost = window.location.hostname === 'localhost' ||
                    window.location.hostname === '127.0.0.1';

  // ============================================================
  // STATE
  // ============================================================
  var plausibleLoaded = false;
  var loadStarted = false;

  // WHY: Buffer events fired before Plausible finishes loading,
  // then flush them in order once the script is ready.
  var eventQueue = [];

  // ============================================================
  // CONSENT
  // ============================================================

  /**
   * Read current consent value
   * @returns {string|null} 'true', 'false', or null (not answered yet)
   */
  function getConsent() {
    try {
      return localStorage.getItem(CONFIG.CONSENT_KEY);
    } catch (e) {
      // WHY: localStorage can throw in private mode - treat as no consent
      return null;
    }
  }

  /**
   * Load the Plausible script into <head>
   * WHY: Standard Plausible embed, adapted to defer + consent gate
   */
  function loadPlausible() {
    // WHY: Never load on localhost - keeps dev traffic out of
    // production stats (matches SETUP-PLAUSIBLE.md behavior)
    if (isLocalhost) {
      console.log('[Analytics] (dev) Plausible load skipped on localhost');
      return;
    }
    if (loadStarted) return;
    loadStarted = true;

    try {
      var script = document.createElement('script');
      script.defer = true;
      script.dataset.domain = CONFIG.PLAUSIBLE_DOMAIN;
      script.src = CONFIG.PLAUSIBLE_SRC;

      // WHY: Flush buffered events once Plausible is ready
      script.addEventListener('load', function() {
        plausibleLoaded = true;
        flushQueue();
        console.log('[Analytics] Plausible loaded for domain:', CONFIG.PLAUSIBLE_DOMAIN);
      });

      script.addEventListener('error', function() {
        // WHY: Analytics failure must never break the site (Section 1.13)
        console.warn('[Analytics] Plausible script failed to load - tracking disabled');
      });

      document.head.appendChild(script);
    } catch (e) {
      console.warn('[Analytics] Failed to inject Plausible:', e.message);
    }
  }

  /**
   * Block analytics (user declined)
   * WHY: belt-and-suspenders - if Plausible was already injected
   * (consent then revoked), remove it and neutralize window.plausible
   */
  function blockPlausible() {
    var scripts = document.querySelectorAll('script[src*="plausible"]');
    scripts.forEach(function(s) { s.remove(); });
    // WHY: Replace with no-op so perf.js / track() calls stay safe
    window.plausible = function() {};
    plausibleLoaded = false;
    loadStarted = true; // WHY: prevent re-loading this session
    eventQueue.length = 0;
    console.log('[Analytics] Tracking blocked (no consent)');
  }

  // ============================================================
  // EVENT TRACKING
  // ============================================================

  /**
   * Track a custom event
   * @param {string} eventName - e.g. 'WhatsApp Click'
   * @param {Object} [props] - event properties (flatten to scalars)
   *
   * WHY: Plausible custom events use this exact call signature:
   *   plausible('Event Name', { props: { key: value } })
   * Events fired before Plausible loads are queued and replayed.
   */
  function track(eventName, props) {
    if (isLocalhost) {
      // WHY: Local debugging without polluting production stats
      console.log('[Analytics] (dev, not sent)', eventName, props || {});
      return;
    }
    if (getConsent() !== 'true') return; // WHY: hard consent gate
    if (!plausibleLoaded) {
      eventQueue.push({ name: eventName, props: props || {} });
      return;
    }
    sendEvent(eventName, props || {});
  }

  /**
   * Send event via window.plausible
   */
  function sendEvent(name, props) {
    try {
      if (typeof window.plausible === 'function') {
        window.plausible(name, { props: props });
      }
    } catch (e) {
      console.warn('[Analytics] Event failed:', name, e.message);
    }
  }

  /**
   * Flush queued events after Plausible loads
   */
  function flushQueue() {
    while (eventQueue.length) {
      var ev = eventQueue.shift();
      sendEvent(ev.name, ev.props);
    }
  }

  // ============================================================
  // AUTO-TRACKING: data-analytics-event attributes
  // ============================================================

  /**
   * Delegate clicks on any element with [data-analytics-event]
   * WHY: Lets HTML declare tracking without wiring JS per page.
   * Example:
   *   <a href="..." data-analytics-event="CTA Click"
   *      data-analytics-location="hero">Lihat Katalog</a>
   */
  function initClickDelegation() {
    document.addEventListener('click', function(e) {
      var el = e.target.closest('[data-analytics-event]');
      if (!el) return;

      track(el.getAttribute('data-analytics-event'), {
        location: el.getAttribute('data-analytics-location') || 'unknown',
        text: (el.textContent || '').trim().slice(0, 50)
      });
      // WHY: no preventDefault - tracking never changes behavior
    });
  }

  // ============================================================
  // INIT
  // ============================================================

  function init() {
    var consent = getConsent();

    if (consent === 'true') {
      loadPlausible();
    }
    // WHY: 'false' or null -> do nothing; Plausible never loads
    // until the user accepts the cookie banner.

    // WHY: React when the user answers the banner mid-session
    document.addEventListener(CONFIG.CONSENT_EVENT, function(e) {
      if (e.detail && e.detail.consent === 'true') {
        // WHY loadStarted di-reset: pengguna bisa berubah pikiran via
        // "Kelola Cookie" (tolak dulu, setuju kemudian). blockPlausible()
        // mengunci loadStarted=true, dan tanpa reset ini Plausible tidak
        // pernah dimuat walau consent sudah diberikan.
        loadStarted = false;
        loadPlausible();
      } else {
        // WHY: Covers decline AND the edge case where consent was
        // given earlier in the session then revoked (re-answer)
        blockPlausible();
      }
    });

    initClickDelegation();
    console.log('[Analytics] Initialized, consent =', consent);
  }

  // WHY: Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  window.KapalProAnalytics = {
    track: track,
    isLoaded: function() { return plausibleLoaded; },
    getConsent: getConsent,
    // WHY: expose config for debugging / SETUP-PLAUSIBLE.md verification
    CONFIG: CONFIG
  };
})();
