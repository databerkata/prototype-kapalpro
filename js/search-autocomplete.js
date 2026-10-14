/**
 * KapalPro Search Autocomplete — V1 (minimal clean)
 *
 * Auto-init: setiap elemen [data-search-autocomplete] di-enhance otomatis.
 * Mode:
 *   "hero"    — di hero beranda. Pilih kapal -> halaman detail,
 *               Enter -> catalog.html?q=...
 *   "catalog" — ditempel ke input #catalog-search yang sudah ada.
 *               Pilih kapal -> halaman detail, Enter -> filter katalog
 *               (filter teks katalog yang sudah ada tetap jalan).
 *
 * Sumber suggestion: data listing real via window.VesselData.getVessels().
 * Recent: riwayat pencarian user (localStorage). Trending: tipe kapal
 * terbanyak dari data real.
 */
(function () {
  'use strict';

  var RECENT_KEY = 'kapalpro-recent-searches';
  var MAX_RECENT = 5;
  var MAX_SUGGEST = 8;

  var ICON_SEARCH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
  var ICON_CLOCK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
  var ICON_TREND = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>';
  var ICON_ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>';

  var vesselsPromise = null;
  function loadVessels() {
    if (!vesselsPromise) {
      vesselsPromise = (window.VesselData && window.VesselData.getVessels
        ? window.VesselData.getVessels()
        : Promise.resolve([])
      ).then(function (list) {
        return Array.isArray(list) ? list : [];
      }).catch(function () {
        return [];
      });
    }
    return vesselsPromise;
  }

  function typeLabel(v) {
    try {
      if (window.VesselData && window.VesselData.vesselTypeLabel) {
        return window.VesselData.vesselTypeLabel(v.type);
      }
    } catch (e) { /* abaikan, pakai fallback */ }
    return v.type || '';
  }

  function isSold(v) {
    return String(v.status || '').toLowerCase() === 'sold';
  }

  function getRecent() {
    try {
      var r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(r) ? r : [];
    } catch (e) {
      return [];
    }
  }

  function saveRecent(term) {
    term = String(term || '').trim();
    if (!term) return;
    try {
      var r = getRecent().filter(function (t) {
        return String(t).toLowerCase() !== term.toLowerCase();
      });
      r.unshift(term);
      localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, MAX_RECENT)));
    } catch (e) { /* abaikan */ }
  }

  /* WHY: trending dihitung dari data real (tipe kapal terbanyak),
     bukan daftar statis, supaya selalu mencerminkan isi katalog. */
  function trendingTerms(vessels) {
    var counts = {};
    vessels.forEach(function (v) {
      var t = String(v.type || 'other');
      if (t === 'other') return;
      counts[t] = (counts[t] || 0) + 1;
    });
    return Object.keys(counts)
      .sort(function (a, b) { return counts[b] - counts[a]; })
      .slice(0, 4)
      .map(function (t) { return typeLabel({ type: t }); });
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hi(text, q) {
    text = String(text);
    if (!q) return esc(text);
    var i = text.toLowerCase().indexOf(q);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }

  function goVessel(id) {
    window.location.href = 'vessel-' + id + '.html';
  }

  function init(root) {
    var mode = root.getAttribute('data-search-mode') || 'hero';
    var input = root.tagName === 'INPUT' ? root : root.querySelector('input');
    if (!input) return;

    var container = root.tagName === 'INPUT' ? root.parentElement : root;
    container.classList.add('kp-search-enhanced');

    /* WHY: dropdown & tombol clear dibuat oleh JS (bukan di HTML) supaya
       mode katalog tidak perlu restrukturisasi markup yang sudah ada. */
    var drop = document.createElement('div');
    drop.className = 'kp-search-drop';
    drop.setAttribute('role', 'listbox');
    container.appendChild(drop);

    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'kp-search-clear';
    clearBtn.setAttribute('aria-label', 'Hapus pencarian');
    clearBtn.innerHTML = '&times;';
    var box = root.querySelector('.kp-search-box');
    (box || container).appendChild(clearBtn);

    var vesselsCache = [];

    function open() {
      drop.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
    }
    function close() {
      drop.classList.remove('open');
      input.setAttribute('aria-expanded', 'false');
    }
    function isOpen() {
      return drop.classList.contains('open');
    }

    function rows() {
      return Array.prototype.slice.call(drop.querySelectorAll('.kp-s-item'));
    }

    function setActive(list, idx) {
      list.forEach(function (r) { r.classList.remove('active'); });
      if (idx >= 0 && list[idx]) {
        list[idx].classList.add('active');
        list[idx].scrollIntoView({ block: 'nearest' });
      }
      return idx;
    }

    function vesselRow(v, q) {
      var sold = isSold(v);
      var badge = sold
        ? '<span class="kp-s-badge sold">Terjual</span>'
        : '<span class="kp-s-badge">' + esc(typeLabel(v)) + '</span>';
      return '<button type="button" class="kp-s-item" role="option" data-kind="vessel" data-id="' + esc(v.id) + '">' +
        '<span class="kp-s-ic">' + ICON_ARROW + '</span>' +
        '<span class="kp-s-t">' + hi(v.name, q) + '</span>' +
        badge +
        '</button>';
    }

    function termRow(icon, term) {
      return '<button type="button" class="kp-s-item" role="option" data-kind="term" data-term="' + esc(term) + '">' +
        '<span class="kp-s-ic">' + icon + '</span>' +
        '<span class="kp-s-t">' + esc(term) + '</span>' +
        '</button>';
    }

    function bindRows() {
      drop.querySelectorAll('.kp-s-item').forEach(function (r) {
        r.addEventListener('mousedown', function (e) {
          /* WHY mousedown (bukan click): mencegah input kehilangan fokus
             sebelum pilihan terbaca. */
          e.preventDefault();
          pick(r);
        });
      });
    }

    function pick(row) {
      var kind = row.getAttribute('data-kind');
      if (kind === 'vessel') {
        var id = row.getAttribute('data-id');
        var v = null;
        vesselsCache.forEach(function (x) { if (String(x.id) === id) v = x; });
        saveRecent(v ? v.name : '');
        close();
        goVessel(id);
      } else {
        applyTerm(row.getAttribute('data-term'));
      }
    }

    function applyTerm(term) {
      input.value = term;
      saveRecent(term);
      if (mode === 'catalog') {
        /* WHY: picu ulang filter teks katalog yang sudah ada (debounced
           di catalog.js) supaya hasil langsung tersaring. */
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      render();
      open();
      input.focus();
    }

    function submitQuery() {
      var q = input.value.trim();
      if (!q) return;
      saveRecent(q);
      close();
      if (mode === 'hero') {
        window.location.href = 'catalog.html?q=' + encodeURIComponent(q);
      }
      /* Mode katalog: filter teks sudah live saat mengetik, jadi cukup tutup. */
    }

    function score(v, q) {
      var name = String(v.name || '').toLowerCase();
      var label = String(typeLabel(v)).toLowerCase();
      var id = String(v.id || '').toLowerCase();
      var s = 0;
      if (name.indexOf(q) === 0) s += 3;
      else if (name.indexOf(q) > 0) s += 2;
      if (label.indexOf(q) >= 0) s += 1;
      if (id.indexOf(q) >= 0) s += 1;
      if (isSold(v)) s -= 5;
      return s;
    }

    function render() {
      var q = input.value.trim().toLowerCase();
      clearBtn.style.display = input.value ? 'block' : 'none';
      loadVessels().then(function (vessels) {
        vesselsCache = vessels;
        var html = '';
        if (!q) {
          var recent = getRecent();
          html += '<div class="kp-s-sec">Recent</div>';
          html += recent.length
            ? recent.map(function (t) { return termRow(ICON_CLOCK, t); }).join('')
            : '<div class="kp-s-muted">Belum ada riwayat pencarian.</div>';
          var trending = trendingTerms(vessels);
          if (trending.length) {
            html += '<div class="kp-s-sec">Trending</div>';
            html += trending.map(function (t) { return termRow(ICON_TREND, t); }).join('');
          }
        } else {
          var res = vessels
            .filter(function (v) {
              return String(v.name || '').toLowerCase().indexOf(q) > -1 ||
                String(typeLabel(v)).toLowerCase().indexOf(q) > -1 ||
                String(v.id || '').toLowerCase().indexOf(q) > -1;
            })
            .sort(function (a, b) { return score(b, q) - score(a, q); })
            .slice(0, MAX_SUGGEST);
          if (!res.length) {
            html = '<div class="kp-s-empty">Tidak ada hasil untuk &ldquo;<b>' +
              esc(input.value.trim()) + '</b>&rdquo;<br>Coba kata kunci lain.</div>';
          } else {
            html = res.map(function (v) { return vesselRow(v, q); }).join('');
          }
        }
        drop.innerHTML = html;
        bindRows();
      });
    }

    input.addEventListener('focus', function () { render(); open(); });
    input.addEventListener('input', function () { render(); open(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen()) { render(); open(); return; }
        var list = rows();
        if (!list.length) return;
        var cur = list.indexOf(drop.querySelector('.kp-s-item.active'));
        var next = e.key === 'ArrowDown'
          ? (cur + 1) % list.length
          : (cur - 1 + list.length) % list.length;
        setActive(list, next);
      } else if (e.key === 'Enter') {
        var active = drop.querySelector('.kp-s-item.active');
        if (active) {
          e.preventDefault();
          pick(active);
        } else {
          submitQuery();
        }
      } else if (e.key === 'Escape') {
        close();
        input.blur();
      }
    });

    clearBtn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      input.value = '';
      if (mode === 'catalog') {
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      render();
      open();
      input.focus();
    });

    document.addEventListener('mousedown', function (e) {
      if (!container.contains(e.target)) close();
    });

    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
  }

  function boot() {
    document.querySelectorAll('[data-search-autocomplete]').forEach(init);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
