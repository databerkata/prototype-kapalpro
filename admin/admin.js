/**
 * Dashboard Admin - KapalPro (khusus pengembangan)
 * ================================================
 *
 * CRUD iklan kapal. Sumber data:
 *   1. localStorage "kapal_ads" kalau sudah ada (hasil edit admin, atau
 *      hasil seed pertama di bawah).
 *   2. data/vessels.json untuk seed PERTAMA - langsung disimpan ke
 *      localStorage supaya tambah/edit/hapus berikutnya bekerja di atas
 *      salinan yang sama.
 *
 * js/data.js membaca key "kapal_ads" yang sama, jadi beranda dan katalog
 * otomatis menampilkan hasil edit admin ini.
 *
 * CATATAN KEAMANAN: sejak 2026-10-20 panel ini digerbang Worker dengan
 * kunci akses (cookie HttpOnly 30 hari) — tidak ada kredensial di file
 * ini. Jangan pernah menulis kunci/kredensial apa pun ke JavaScript.
 */
(function () {
  'use strict';

  var ADS_KEY = 'kapal_ads';
  var DEFAULT_DATA_URL = '../data/vessels.json';
  var FALLBACK_IMG = '../assets/hero-vessel.jpg';
  var MAX_PHOTO_DIM = 1000; // px - batas sisi terpanjang foto upload

  // ------------------------------------------------------------
  // Referensi DOM
  // ------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  var tbody = $('ads-tbody');
  var emptyEl = $('ads-empty');
  var countEl = $('ads-count');
  var addBtn = $('add-btn');
  var exportBtn = $('export-btn');
  var logoutBtn = $('logout-btn');
  var formPanel = $('form-panel');
  var formTitle = $('form-title');
  var form = $('ads-form');
  var nameInput = $('f-name');
  var priceInput = $('f-price');
  var typeSelect = $('f-type');
  var locationInput = $('f-location');
  var statusSelect = $('f-status');
  var photoInput = $('f-photo');
  var photoUrlInput = $('f-photo-url');
  var photoPreview = $('photo-preview');
  var photoClearBtn = $('photo-clear');
  var descInput = $('f-desc');
  var cancelBtn = $('cancel-btn');
  var toastEl = $('admin-toast');

  // escapeHtml memakai js/sanitize.js (satu kebijakan dengan situs utama),
  // dengan fallback minimal kalau berkas itu gagal dimuat.
  var Sanitize = window.KapalProSanitize;
  function escapeHtml(text) {
    if (Sanitize && typeof Sanitize.escapeHtml === 'function') {
      return Sanitize.escapeHtml(text);
    }
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * URL gambar untuk pratinjau TABEL di dashboard (alat internal):
   * data URL, assets/, dan https semuanya boleh. Catatan: kebijakan
   * halaman PUBLIK tetap ketat lewat js/sanitize.js - di sini longgar
   * supaya admin bisa memeriksa foto URL apa pun sebelum dipakai.
   */
  function previewImg(url) {
    var s = String(url || '').trim();
    if (!s) return FALLBACK_IMG;
    if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(s)) return s;
    if (/^https?:\/\//i.test(s)) return s;
    // WHY prefix ../: path di data (assets/vessels/..) relatif ke ROOT
    // situs, sedangkan halaman admin ada di /admin/. Tanpa naik satu
    // direktori, semua thumbnail /admin 404 (bug yang pernah terjadi).
    if (/^\.\.\/assets\//.test(s)) return s;
    if (/^assets\//.test(s)) return '../' + s;
    return FALLBACK_IMG;
  }

  // ------------------------------------------------------------
  // Toast
  // ------------------------------------------------------------
  var toastTimer = null;
  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3200);
  }

  // ------------------------------------------------------------
  // Penyimpanan
  // ------------------------------------------------------------
  var ads = [];
  var seedFailed = false;

  function readAds() {
    try {
      var raw = localStorage.getItem(ADS_KEY);
      if (raw === null || raw === '') return null;
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * @returns {boolean} false berarti gagal (mis. kuota penuh) dan
   *   pemanggil WAJIB tidak menganggap operasi berhasil.
   */
  function writeAds(list) {
    try {
      localStorage.setItem(ADS_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      toast('Gagal menyimpan: penyimpanan browser penuh. Gunakan foto yang lebih kecil.');
      return false;
    }
  }

  /**
   * Export data admin (localStorage "kapal_ads") ke file vessels.json.
   *
   * Kenapa perlu: CRUD admin hanya menulis ke localStorage browser ini.
   * Pengunjung lain / situs yang di-deploy membaca data/vessels.json,
   * jadi tanpa export, edit admin tidak terlihat publik. Alur pakai:
   *   1. Klik "Export vessels.json" di toolbar.
   *   2. File vessels.json terunduh — timpa data/vessels.json di project.
   *   3. Commit + deploy ulang supaya perubahan tampil di situs live.
   * Catatan: foto yang di-upload lewat admin tersimpan sebagai data URL
   * di dalam JSON (bisa besar); untuk foto baru di situs live, taruh file
   * di assets/ dan isi path-nya seperti listing lain.
   */
  function exportVesselsJson() {
    var list = readAds();
    if (!list || list.length === 0) {
      toast('Tidak ada data untuk di-export.');
      return;
    }
    try {
      var blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'vessels.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast(list.length + ' iklan ter-export. Timpa data/vessels.json lalu deploy ulang.');
    } catch (e) {
      toast('Export gagal: ' + (e && e.message ? e.message : 'error tidak dikenal'));
    }
  }

  function findAd(id) {
    for (var i = 0; i < ads.length; i++) {
      if (String(ads[i].id) === String(id)) return ads[i];
    }
    return null;
  }

  // ------------------------------------------------------------
  // Format tampilan
  // ------------------------------------------------------------
  function trimNum(n) {
    return n.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  }

  function formatPrice(price) {
    var num = Number(price);
    if (!num || isNaN(num) || num <= 0) return 'Hubungi Kami';
    var jt = num / 1e6;
    if (jt >= 1e6) return 'Rp ' + trimNum(jt / 1e6) + ' Triliun';
    if (jt >= 1000) return 'Rp ' + trimNum(jt / 1000) + ' Milyar';
    if (jt >= 1) return 'Rp ' + trimNum(jt) + ' Juta';
    return 'Rp ' + num.toLocaleString('id-ID');
  }

  var STATUS_LABELS = { available: 'Tersedia', reserved: 'Direservasi', sold: 'Terjual' };

  function statusBadge(status) {
    var key = STATUS_LABELS[status] ? status : 'available';
    return '<span class="status-badge status-' + key + '">' + STATUS_LABELS[key] + '</span>';
  }

  // ------------------------------------------------------------
  // Render tabel
  // ------------------------------------------------------------
  function rowHtml(v) {
    return ''
      + '<tr>'
      +   '<td><img class="ads-thumb" src="' + escapeHtml(previewImg(v.main_image_url)) + '"'
      +        ' alt="' + escapeHtml(v.name || 'Kapal') + '" loading="lazy"></td>'
      +   '<td><span class="ads-name">' + escapeHtml(v.name || '(tanpa nama)') + '</span>'
      +        '<span class="ads-id">' + escapeHtml(v.id || '-')
      +          (v.location ? ' &middot; ' + escapeHtml(v.location) : '')
      +        '</span></td>'
      +   '<td class="ads-price">' + escapeHtml(formatPrice(v.price)) + '</td>'
      +   '<td>' + statusBadge(v.status) + '</td>'
      +   '<td class="ads-actions">'
      +     '<button type="button" class="btn btn-secondary btn-sm" data-action="edit" data-id="' + escapeHtml(v.id) + '">Edit</button>'
      +     '<button type="button" class="btn btn-danger btn-sm" data-action="delete" data-id="' + escapeHtml(v.id) + '">Hapus</button>'
      +   '</td>'
      + '</tr>';
  }

  function render() {
    if (!tbody) return;
    tbody.innerHTML = ads.map(rowHtml).join('');
    if (emptyEl) emptyEl.hidden = ads.length > 0;
    if (countEl) {
      countEl.textContent = seedFailed
        ? 'Data default gagal dimuat. Jalankan situs lewat server dev (node server.js) lalu muat ulang.'
        : ads.length + ' iklan kapal';
    }
  }

  // ------------------------------------------------------------
  // Muat data: localStorage dulu, kalau kosong seed dari vessels.json
  // ------------------------------------------------------------
  function seedFromDefault() {
    return fetch(DEFAULT_DATA_URL)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (list) {
        ads = Array.isArray(list) ? list : [];
        // WHY seed langsung disimpan: setelah ini "kapal_ads" adalah
        // sumber kebenaran, dan data default tidak perlu diambil lagi.
        writeAds(ads);
        render();
      })
      .catch(function (err) {
        seedFailed = true;
        ads = [];
        render();
        toast('Gagal memuat data default kapal.');
        console.error('[Admin] Seed vessels.json gagal:', err);
      });
  }

  function init() {
    var stored = readAds();
    if (stored !== null) {
      ads = stored;
      render();
      return;
    }
    seedFromDefault();
  }

  // ------------------------------------------------------------
  // Form tambah / edit
  // ------------------------------------------------------------
  var editingId = null;   // null = mode tambah
  var pendingPhoto = '';  // data URL hasil upload yang belum disimpan
  var photoRemoved = false;

  function resetFormState() {
    editingId = null;
    pendingPhoto = '';
    photoRemoved = false;
    if (form) form.reset();
    updatePhotoPreview();
  }

  function showForm() {
    if (formPanel) formPanel.hidden = false;
  }

  function hideForm() {
    if (formPanel) formPanel.hidden = true;
    resetFormState();
  }

  function updatePhotoPreview() {
    var url = '';
    if (pendingPhoto) {
      url = pendingPhoto;
      if (photoClearBtn) photoClearBtn.hidden = false;
    } else if (editingId) {
      var v = findAd(editingId);
      url = v && v.main_image_url ? v.main_image_url : '';
      if (photoClearBtn) photoClearBtn.hidden = photoRemoved || !url;
    } else {
      if (photoClearBtn) photoClearBtn.hidden = true;
    }
    if (photoPreview) {
      if (photoRemoved || !url) {
        photoPreview.hidden = true;
        photoPreview.removeAttribute('src');
      } else {
        photoPreview.src = previewImg(url);
        photoPreview.hidden = false;
      }
    }
  }

  function openAddForm() {
    resetFormState();
    if (formTitle) formTitle.textContent = 'Tambah Iklan Kapal';
    showForm();
    if (nameInput) nameInput.focus();
  }

  function openEditForm(id) {
    var v = findAd(id);
    if (!v) {
      toast('Iklan tidak ditemukan.');
      return;
    }
    resetFormState();
    editingId = String(v.id);
    if (formTitle) formTitle.textContent = 'Edit Iklan: ' + (v.name || v.id);
    if (nameInput) nameInput.value = v.name || '';
    if (priceInput) priceInput.value = v.price ? String(v.price) : '';
    if (typeSelect) {
      // WHY daftar lokal: <select> hanya punya 7 option enum ini; nilai
      // di luar daftar membuat <select> jadi kosong tanpa pesan.
      var VALID_TYPES = ['tongkang', 'tugboat', 'lct', 'spob', 'oil_barge', 'tanker', 'other'];
      typeSelect.value = VALID_TYPES.indexOf(v.type) !== -1 ? v.type : 'other';
    }
    if (locationInput) locationInput.value = v.location || '';
    if (statusSelect) statusSelect.value = STATUS_LABELS[v.status] ? v.status : 'available';
    if (descInput) descInput.value = v.description || '';
    // WHY URL tidak diisi dengan data URL: base64 ratusan KB membuat
    // input tidak terbaca. Pratinjau + tombol "Kosongkan foto" yang
    // menggantikan perannya.
    if (photoUrlInput) {
      photoUrlInput.value = /^data:image\//i.test(String(v.main_image_url || ''))
        ? '' : String(v.main_image_url || '');
    }
    updatePhotoPreview();
    showForm();
    if (formPanel) formPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (nameInput) nameInput.focus();
  }

  /** ID baru: lanjutkan urutan ADM001, ADM002, ... yang sudah ada. */
  function nextId() {
    var max = 0;
    ads.forEach(function (a) {
      var m = /^ADM(\d+)$/i.exec(String(a && a.id || ''));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return 'ADM' + String(max + 1).padStart(3, '0');
  }

  /** Terima "3.500.000.000", "3 500 000 000", "3500000000" -> number. */
  function parsePrice(raw) {
    var digits = String(raw || '').replace(/[^\d]/g, '');
    if (!digits) return null;
    var n = Number(digits);
    return isNaN(n) || n <= 0 ? null : n;
  }

  /** Kumpulkan nilai foto efektif dari ketiga sumber (upload/URL/lama). */
  function effectivePhoto(existingUrl) {
    if (pendingPhoto) return pendingPhoto;
    if (photoUrlInput && photoUrlInput.value.trim()) return photoUrlInput.value.trim();
    if (photoRemoved) return '';
    return existingUrl || '';
  }

  function buildVesselFields(existing) {
    return {
      name: nameInput ? nameInput.value.trim() : '',
      type: typeSelect ? (typeSelect.value || 'other') : 'other',
      status: statusSelect ? (statusSelect.value || 'available') : 'available',
      price: parsePrice(priceInput ? priceInput.value : ''),
      location: locationInput ? locationInput.value.trim() : '',
      port_location: locationInput ? locationInput.value.trim() : '',
      description: descInput ? descInput.value.trim() : '',
      main_image_url: effectivePhoto(existing ? existing.main_image_url : '')
    };
  }

  function newVesselEntry() {
    var fields = buildVesselFields(null);
    var location = fields.location;
    // Struktur mengikuti data/vessels.json supaya beranda me-render
    // iklan admin dengan jalur yang sama persis seperti kapal lain.
    return {
      id: nextId(),
      name: fields.name,
      type: fields.type,
      status: fields.status,
      price: fields.price,
      is_negotiable: true,
      year_built: null,
      length: null,
      beam: null,
      depth: null,
      draft: null,
      dwt: null,
      gross_tonnage: null,
      net_tonnage: null,
      speed_knots: null,
      engine_type: '',
      engine_power: '',
      fuel_type: '',
      flag_state: 'Indonesia',
      classification: '',
      class_notation: '',
      location: location,
      port_location: location,
      main_image_url: fields.main_image_url,
      gallery_urls: '',
      description: fields.description,
      highlights: []
    };
  }

  // ------------------------------------------------------------
  // Aksi CRUD
  // ------------------------------------------------------------
  function saveForm(ev) {
    ev.preventDefault();

    var name = nameInput ? nameInput.value.trim() : '';
    if (!name) {
      toast('Nama kapal wajib diisi.');
      if (nameInput) nameInput.focus();
      return;
    }

    if (editingId) {
      var existing = findAd(editingId);
      if (!existing) {
        toast('Iklan tidak ditemukan.');
        return;
      }
      var updated = Object.assign({}, existing, buildVesselFields(existing));
      var nextAds = ads.map(function (a) {
        return String(a.id) === editingId ? updated : a;
      });
      if (!writeAds(nextAds)) return; // kuota penuh: biarkan data lama
      ads = nextAds;
      toast('Perubahan disimpan.');
    } else {
      var entry = newVesselEntry();
      var withNew = ads.concat([entry]);
      if (!writeAds(withNew)) return;
      ads = withNew;
      toast('Iklan "' + entry.name + '" ditambahkan.');
    }

    hideForm();
    render();
  }

  function deleteAd(id) {
    var v = findAd(id);
    if (!v) return;
    // Konfirmasi sesuai permintaan: "Yakin mau hapus?"
    if (!window.confirm('Yakin mau hapus "' + (v.name || v.id) + '" (' + v.id + ')?')) {
      return;
    }
    var nextAds = ads.filter(function (a) { return String(a.id) !== String(id); });
    if (!writeAds(nextAds)) return;
    ads = nextAds;
    // Kalau form sedang mengedit item yang baru dihapus, tutup formnya.
    if (editingId === String(id)) hideForm();
    render();
    toast('Iklan "' + (v.name || v.id) + '" dihapus.');
  }

  // ------------------------------------------------------------
  // Upload foto -> data URL (dikecilkan dulu biar muat di localStorage)
  // ------------------------------------------------------------
  function downscaleImage(dataUrl, callback) {
    var img = new Image();
    img.onload = function () {
      var scale = Math.min(1, MAX_PHOTO_DIM / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      if (!ctx) {
        callback(dataUrl);
        return;
      }
      // WHY fill putih dulu: PNG transparan yang diubah ke JPEG akan
      // berlatar hitam tanpa ini.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      try {
        callback(canvas.toDataURL('image/jpeg', 0.85));
      } catch (e) {
        callback(dataUrl); // canvas gagal diserialisasi - pakai aslinya
      }
    };
    img.onerror = function () {
      toast('Gambar tidak bisa dibaca.');
    };
    img.src = dataUrl;
  }

  function handlePhotoFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) {
      toast('Berkas harus berupa gambar.');
      if (photoInput) photoInput.value = '';
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      downscaleImage(String(reader.result || ''), function (dataUrl) {
        pendingPhoto = dataUrl;
        photoRemoved = false;
        updatePhotoPreview();
      });
    };
    reader.onerror = function () {
      toast('Gagal membaca berkas gambar.');
    };
    reader.readAsDataURL(file);
  }

  // ------------------------------------------------------------
  // Events (semuanya addEventListener - CSP melarang inline handler)
  // ------------------------------------------------------------
  if (addBtn) {
    addBtn.addEventListener('click', openAddForm);
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', exportVesselsJson);
  }

  if (tbody) {
    tbody.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('button[data-action]') : null;
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var action = btn.getAttribute('data-action');
      if (action === 'edit') openEditForm(id);
      else if (action === 'delete') deleteAd(id);
    });
  }

  if (form) {
    form.addEventListener('submit', saveForm);
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', hideForm);
  }

  if (photoInput) {
    photoInput.addEventListener('change', function () {
      handlePhotoFile(photoInput.files && photoInput.files[0]);
    });
  }

  if (photoClearBtn) {
    photoClearBtn.addEventListener('click', function () {
      pendingPhoto = '';
      photoRemoved = true;
      if (photoInput) photoInput.value = '';
      if (photoUrlInput) photoUrlInput.value = '';
      updatePhotoPreview();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      // Logout = hapus cookie kunci di Worker.
      location.href = '/admin/logout';
    });
  }

  // ------------------------------------------------------------
  // Init
  // ------------------------------------------------------------
  init();
})();
