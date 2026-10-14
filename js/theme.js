/**
 * Theme Toggle - Dark/Light Mode
 * Compliant with RULES.md Section 1.3
 * - Default: light mode (SELALU, bukan mengikuti sistem)
 * - Toggle via button
 * - Persist: localStorage
 */

// WHY: IIFE to avoid global scope pollution
(function() {
  'use strict';

  const STORAGE_KEY = 'kapalpro-theme';
  const DARK_THEME = 'dark';
  const LIGHT_THEME = 'light';

  /**
   * Get stored theme, defaulting to LIGHT.
   * @returns {string} 'dark' or 'light'
   */
  function getStoredTheme() {
    // WHY try/catch: localStorage melempar di private mode / storage penuh.
    // Tanpa ini seluruh script tema mati dan halaman tanpa tema sama sekali.
    let stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (stored === DARK_THEME || stored === LIGHT_THEME) {
      return stored;
    }
    // WHY: Default HARUS light dan tidak mengikuti preferensi sistem.
    // Sebelumnya fallback ke prefers-color-scheme membuat pengunjung
    // dengan OS dark-mode langsung melihat situs dalam dark - padahal
    // desain & foto produk dibuat untuk latar terang (kartu kapal,
    // harga biru, kontras foto). Light adalah default yang disengaja;
    // mode dark tetap tersedia lewat tombol toggle.
    return LIGHT_THEME;
  }

  /**
   * Apply theme to document
   * @param {string} theme - 'dark' or 'light'
   */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    // WHY try/catch: pilihan tetap diterapkan ke DOM walau tidak bisa
    // disimpan - lebih baik tema benar sesi ini daripada throw.
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
    
    // WHY: Ada DUA meta theme-color di setiap halaman, satu untuk
    // prefers-color-scheme light dan satu untuk dark, supaya browser bisa
    // memilih warna chrome-nya sendiri sebelum JavaScript dieksekusi.
    // Setelah tema aktif diketahui, keduanya ditulis ulang agar warna
    // address bar pasti sama dengan tema - kalau hanya yang pertama yang
    // diubah, meta dark akan tetap menyala dan menimpa hasil di atas.
    const color = theme === DARK_THEME ? '#0f172a' : '#ffffff';
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    for (let i = 0; i < metas.length; i++) {
      metas[i].setAttribute('content', color);
    }
  }

  /**
   * Toggle between dark and light themes
   */
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === DARK_THEME ? LIGHT_THEME : DARK_THEME;
    applyTheme(next);
    // WHY: Label tombol harus menyatakan aksi berikutnya, jadi ia
    // berubah setiap kali tema ditukar - bukan hanya saat halaman dimuat.
    refreshToggleLabel();
  }

  /**
   * Tulis aria-label tombol tema dalam Bahasa Indonesia.
   * WHY: Nilai lama ditulis langsung dalam Bahasa Inggris ('Switch to
   * light mode'), padahal situs ini Bahasa Indonesia. Label harus
   * menyatakan aksi berikutnya, jadi ia ditulis ulang setiap kali tema
   * ditukar - toggleTheme() memanggil fungsi ini secara langsung.
   */
  function refreshToggleLabel() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const isDark = document.documentElement.getAttribute('data-theme') === DARK_THEME;
    const translated = isDark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap';
    // WHY: Tombol harus memberitahu aksi yang AKAN dilakukan, bukan
    // state saat ini - itu yang diharapkan pengguna dan pembaca layar.
    btn.setAttribute('aria-label', translated);
  }

  /**
   * Initialize theme on page load
   */
  function initTheme() {
    const theme = getStoredTheme();
    applyTheme(theme);

    // WHY: Bind toggle button if exists
    const toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', toggleTheme);
    }

    refreshToggleLabel();
  }

  // WHY: Run immediately to prevent flash of wrong theme
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }

  // WHY: Listener prefers-color-scheme DIHAPUS. Default sekarang selalu
  // light. Jika mengikuti perubahan tema sistem, pengunjung bisa
  // dipindahkan ke dark tanpa pernah menyentuh tombol toggle, sehingga
  // preferensi yang tersimpan jadi tidak konsisten dengan yang
  // ditampilkan. Mode gelap hanya aktif setelah user memilihnya.

  // Expose for other modules
  window.ThemeToggle = {
    toggle: toggleTheme,
    getTheme: function() {
      return document.documentElement.getAttribute('data-theme');
    },
    setTheme: applyTheme
  };
})();
