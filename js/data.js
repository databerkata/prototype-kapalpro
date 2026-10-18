/**
 * Data Layer - Google Sheets GViz Integration
 * Fetches vessel data from Google Sheets via JSONP
 * Includes caching for performance
 */

// WHY: IIFE to avoid global scope pollution
(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    // WHY: Replace with your Google Sheet ID
    sheetId: '',
    sheetName: 'Vessels',
    cacheDuration: 5 * 60 * 1000, // 5 minutes
    fallbackDataUrl: 'data/vessels.json'
  };

  // Cache
  let cachedData = null;
  let cacheTimestamp = 0;
  // WHY: Permintaan yang sedang berjalan, dipakai untuk mencegah
  // unduhan ganda ketika beberapa modul meminta data hampir bersamaan.
  let inFlightRequest = null;
  // WHY: JSONP tidak bisa memakai inFlightRequest (itu promise fetch
  // fallback). Cabang Sheets punya promise in-flight sendiri supaya dua
  // pemanggilan bersamaan tidak membuat dua script tag + dua callback.
  let inFlightJsonp = null;

  // ============================================================
  // Override data iklan dari Admin (localStorage "kapal_ads")
  // ============================================================
  // WHY: /admin/dashboard.html (khusus pengembangan) menyimpan hasil
  // CRUD iklan kapal di localStorage dengan key "kapal_ads". Kalau key
  // itu ADA, semua pemanggil getVessels() harus memakai datanya - bukan
  // vessels.json - supaya tambah/edit/hapus dari /admin langsung
  // terlihat di beranda dan katalog tanpa deploy ulang.
  var ADMIN_ADS_KEY = 'kapal_ads';

  /**
   * Baca override data kapal dari localStorage.
   *
   * Aturannya:
   *  - key TIDAK ada / kosong    -> null (admin belum pernah simpan;
   *    pakai data default dari file).
   *  - key ada, isi array kosong -> [] (admin sengaja menghapus SEMUA
   *    iklan - itu harus dihormati, bukan di-fallback ke data default,
   *    kalau tidak iklan yang sudah dihapus bisa bangkit lagi).
   *  - key ada, isi tidak valid  -> null + peringatan (pakai default).
   *
   * @returns {Array|null} daftar kapal ternormalisasi, atau null bila
   *   tidak ada override yang sah.
   */
  function getAdminAdsOverride() {
    // WHY typeof: sandbox test Node tidak punya localStorage, dan
    // sebagian browser melempar exception saat localStorage dibuka di
    // mode privat. Keduanya harus jatuh ke data default, bukan crash.
    if (typeof localStorage === 'undefined') return null;
    try {
      var raw = localStorage.getItem(ADMIN_ADS_KEY);
      if (raw === null || raw === '') return null;
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      // WHY sanitasi ulang: isi localStorage ditulis lewat /admin, dan
      // jalurnya sama seperti data dari Sheets - kebersihannya juga
      // dijaga sanitizeVessel (defense in depth).
      return parsed.map(sanitizeVessel).filter(Boolean);
    } catch (e) {
      console.warn('[Data] localStorage "' + ADMIN_ADS_KEY + '" tidak valid, memakai data default:', e && e.message);
      return null;
    }
  }

  // WHY: Manifest varian gambar dibuat oleh tools/generate-image-variants.js
  // berisi lebar asli tiap file + lebar varian yang BENAR-BENAR ada di
  // disk. Tanpa ini buildSrcSet() hanya menebak nama file sehingga
  // srcset bisa menunjuk file yang tidak ada -> 404 saat browser
  // memilih kandidat. Muat sekali lalu pakai sebagai cache.
  const manifestUrl = 'data/image-variants.json';
  let variantManifest = null;
  let manifestPromise = null;

  function loadVariantManifest() {
    if (variantManifest) return Promise.resolve(variantManifest);
    if (manifestPromise) return manifestPromise;
    manifestPromise = fetch(manifestUrl)
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(m) {
        variantManifest = m || null;
        return variantManifest;
      })
      .catch(function(error) {
        // WHY: Manifest hanya optimalisasi. Jika gagal, srcset dilewati
        // agar browser memakai src apa adanya - lebih baik tanpa srcset
        // daripada srcset yang salah dan menghasilkan 404.
        console.warn('[Data] Manifest varian gambar gagal dimuat:', error.message);
        variantManifest = null;
        manifestPromise = null;
        return null;
      });
    return manifestPromise;
  }

  // WHY: Dipakai shouldShowType() untuk mendeteksi apakah kata jenis
  // sudah tercantum di nama kapal (menjadikan badge jenis jadi noise).
  var TYPE_WORDS = {
    tongkang: 'Tongkang',
    tugboat: 'Tugboat',
    lct: 'LCT',
    spob: 'SPOB',
    tanker: 'Tanker',
    oil_barge: 'Oil Barge'
  };

  // WHY: situs ini monolingual Bahasa Indonesia, jadi istilah kapal
  // ditulis langsung, bukan lewat kamus terjemahan. Peta ini adalah
  // satu-satunya sumber label jenis kapal di seluruh aplikasi.
  var LOCALE_ID = 'id-ID';
  var VESSEL_TYPE_LABELS = {
    tongkang: 'Tongkang',
    tugboat: 'Tugboat',
    lct: 'LCT',
    spob: 'SPOB',
    oil_barge: 'Oil Barge',
    tanker: 'Tanker',
    other: 'Lainnya'
  };
  var VESSEL_STATUS_LABELS = {
    available: 'Tersedia',
    sold: 'Terjual',
    reserved: 'Direservasi'
  };

  /**
   * Parse GViz JSONP response
   * @param {object} response - Google Visualization API response
   * @returns {Array} Array of vessel objects
   */
  function parseGVizResponse(response) {
    if (!response || !response.table || !response.table.rows) {
      return [];
    }

    const cols = response.table.cols.map(function(col) {
      return col.label;
    });

    return response.table.rows.map(function(row) {
      const vessel = {};
      cols.forEach(function(col, i) {
        const cell = row.c[i];
        vessel[col] = cell ? cell.v : null;
      });
      return sanitizeVessel(vessel);
    });
  }

  /**
   * WHY: Defense in depth (Section 2.2) - normalisasi & bersihkan
   * data mentah dari Sheets SEBELUM masuk aplikasi. Render layer
   * juga meng-escape (escapeHtml/safeImageUrl), tapi input yang
   * bersih mengurangi permukaan serangan dan bug tak terduga.
   * @param {object} v - Raw vessel dari GViz
   * @returns {object} Vessel ternormalisasi
   */
  /**
   * Parse angka dari string format Indonesia: "6.500.000" -> 6500000,
   * "6.500.000,50" -> 6500000.50. Titik = pemisah ribuan, koma = desimal.
   * WHY: data dari Google Sheets bisa ditulis format lokal. parseFloat
   * murni membaca "6.500.000" sebagai 6.5. Heuristik pola ribuan
   * (titik diikuti tepat 3 digit) membedakannya dari desimal "46.83".
   * @param {*} value
   * @returns {number|null}
   */
  function parseLocalNumber(value) {
    if (typeof value === 'number') return isNaN(value) ? null : value;
    var s = String(value).trim();
    // WHY: buang prefix non-angka ("Rp", "IDR") dulu supaya pola
    // ribuan di bawah bisa dikenali.
    s = s.replace(/^[^\d\-]+/, '');
    // WHY pola ribuan: titik diikuti tepat 3 digit, boleh diawali minus,
    // boleh diakhiri koma desimal. "1,5" (koma tanpa ribuan) juga
    // ditangani di bawah sebagai desimal.
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^-?\d+,\d+$/.test(s)) {
      // WHY: "1,5" -> 1.5 (koma desimal Indonesia tanpa pemisah ribuan)
      s = s.replace(',', '.');
    }
    s = s.replace(/[^0-9.\-]/g, '');
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function sanitizeVessel(v) {
    if (!v || typeof v !== 'object') return null;
    // WHY: id wajib - vessel tanpa id menghasilkan link rusak
    // (vessel-undefined.html) dan getVesselById tidak pernah cocok.
    // Terutama penting untuk jalur Google Sheets di mana baris bisa
    // punya kolom A terisi tapi bukan id yang valid.
    var rawId = v.id;
    if (rawId === null || rawId === undefined || String(rawId).trim() === '') {
      return null;
    }

    var out = {};

    // WHY: String fields - trim, batasi panjang, paksa ke string
    var STRING_FIELDS = [
      'id', 'name', 'type', 'status', 'engine_type', 'engine_power',
      'fuel_type', 'flag_state', 'classification', 'class_notation', 'location',
      'port_location', 'main_image_url', 'gallery_urls', 'description',
      'highlights'
    ];
    var MAX_LEN = {
      id: 30, name: 120, type: 20, status: 20,
      engine_type: 60, engine_power: 40, fuel_type: 40,
      flag_state: 40, classification: 60, class_notation: 60, location: 80,
      port_location: 80, main_image_url: 300, gallery_urls: 1000,
      description: 2000, highlights: 300
    };
    // WHY pengecualian data URL: foto upload lewat /admin (dev) disimpan
    // sebagai data URL berukuran ratusan KB. Batas 300 karakter memotong
    // URL-nya jadi tidak valid (ERR_INVALID_URL, foto tidak muncul).
    // Keamanannya tetap terjaga: pola ketat base64 PNG/JPEG/WebP yang
    // sama divalidasi ulang di js/sanitize.js (safeImageUrl).
    var DATA_URL_IMAGE_RE = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+\/=]+$/;
    STRING_FIELDS.forEach(function(f) {
      if (v[f] !== null && v[f] !== undefined) {
        var value = String(v[f]).trim();
        if (f === 'main_image_url' && DATA_URL_IMAGE_RE.test(value)) {
          out[f] = value;
        } else {
          out[f] = value.slice(0, MAX_LEN[f] || 200);
        }
      }
    });

    // WHY: Numeric fields - cast, buang yang bukan angka
    ['year_built', 'price', 'dwt', 'gross_tonnage', 'net_tonnage',
     'length', 'beam', 'depth', 'draft', 'speed_knots'].forEach(function(f) {
      if (v[f] !== null && v[f] !== undefined && v[f] !== '') {
        out[f] = parseLocalNumber(v[f]);
      }
    });

    // WHY: Whitelist enum - nilai di luar daftar jadi fallback aman
    var VALID_TYPES = ['tongkang', 'tugboat', 'lct', 'spob', 'oil_barge', 'tanker', 'other'];
    if (out.type && VALID_TYPES.indexOf(out.type) === -1) out.type = 'other';
    var VALID_STATUS = ['available', 'reserved', 'sold'];
    if (out.status && VALID_STATUS.indexOf(out.status) === -1) out.status = 'available';

    // WHY: Boolean-ish
    out.is_negotiable = v.is_negotiable === true || v.is_negotiable === 'TRUE';

    // WHY: Flag promo badge kartu ("Baru"/"Turun Harga") — tanpa ini
    // badge batch 1 tidak pernah tampil karena sanitizeVessel memutihkan field.
    out.is_new = v.is_new === true;
    out.price_drop = v.price_drop === true;

    return out;
  }

  /**
   * Fetch data from Google Sheets via JSONP
   * @returns {Promise<Array>} Array of vessel objects
   */
  function fetchFromSheets() {
    return new Promise(function(resolve, reject) {
      // WHY paling awal, sebelum cache: override admin adalah sumber
      // paling segar. Ia mengalahkan cache (yang bisa berisi snapshot
      // pra-edit) dan SELALU dibaca ulang di sini, sehingga perubahan
      // yang disimpan dari tab /admin langsung terlihat saat halaman
      // publik dimuat ulang - tanpa menyentuh cache sama sekali.
      var adminAds = getAdminAdsOverride();
      if (adminAds !== null) {
        resolve(adminAds);
        return;
      }

      // WHY: Cache diperiksa DULUAN, sebelum pengecekan sheetId. Cache dulu
      // ada setelah pengecekan sheetId sehingga jalur fallback (sheetId
      // kosong) sama sekali tidak pernah memakai cache dan setiap
      // pemanggilan getVessels() mengunduh data/vessels.json lagi.
      if (cachedData && (Date.now() - cacheTimestamp) < CONFIG.cacheDuration) {
        resolve(cachedData);
        return;
      }

      // WHY: Permintaan yang masih berjalan dipakai ulang, supaya dua
      // pemanggilan hampir bersamaan (mis. init + render ulang bahasa)
      // tidak memicu dua fetch file yang sama.
      if (inFlightRequest) {
        inFlightRequest.then(resolve).catch(reject);
        return;
      }

      // WHY: Check if sheet ID is configured
      if (!CONFIG.sheetId) {
        console.warn('[Data] Google Sheet ID not configured, using fallback data');
        inFlightRequest = fetchFallbackData();
        inFlightRequest.then(function(data) {
          inFlightRequest = null;
          resolve(data);
        }).catch(function(error) {
          inFlightRequest = null;
          reject(error);
        });
        return;
      }

      const query = encodeURIComponent('SELECT * WHERE A IS NOT NULL');
      const url = 'https://docs.google.com/spreadsheets/d/' + CONFIG.sheetId + 
                  '/gviz/tq?sheet=' + CONFIG.sheetName + 
                  '&tqx=out:json&tq=' + query;

      // WHY dedup: promise in-flight dipakai ulang oleh pemanggil kedua,
      // supaya dua pemanggilan bersamaan tidak membuat dua script tag.
      if (inFlightJsonp) {
        inFlightJsonp.then(resolve).catch(reject);
        return;
      }

      inFlightJsonp = new Promise(function(jResolve, jReject) {
        // WHY: JSONP callback name must be unique
        const callbackName = 'handleSheetData_' + Date.now();

        // Create script element for JSONP (dideklarasikan dulu supaya
        // done() bisa mengaksesnya)
        const script = document.createElement('script');

        function done() {
          inFlightJsonp = null;
          delete window[callbackName];
          if (script.parentNode) {
            script.parentNode.removeChild(script);
          }
        }

        // Set global callback
        window[callbackName] = function(response) {
          try {
            const data = parseGVizResponse(response).filter(Boolean); // WHY: buang row yang gagal sanitasi
            cachedData = data;
            cacheTimestamp = Date.now();
            done();
            jResolve(data);
          } catch (error) {
            console.error('[Data] Parse error:', error);
            done();
            jReject(error);
          }
        };

        script.src = url + '&tqx=responseHandler:' + callbackName;
        script.onerror = function() {
          console.error('[Data] Failed to load from Google Sheets');
          done();
          fetchFallbackData().then(jResolve).catch(jReject);
        };

        // WHY: Timeout after 10 seconds
        setTimeout(function() {
          if (window[callbackName]) {
            console.warn('[Data] Request timeout, using fallback');
            done();
            fetchFallbackData().then(jResolve).catch(jReject);
          }
        }, 10000);

        document.head.appendChild(script);
      });

      inFlightJsonp.then(resolve).catch(reject);
    });
  }

  /**
   * Fetch fallback data from local JSON
   * @returns {Promise<Array>} Array of vessel objects
   */
  function fetchFallbackData() {
    return new Promise(function(resolve, reject) {
      fetch(CONFIG.fallbackDataUrl)
        .then(function(response) {
          if (!response.ok) {
            throw new Error('Failed to fetch fallback data');
          }
          return response.json();
        })
        .then(function(data) {
          // WHY: fallback JSON melewati sanitasi yang sama dengan Sheets (defense in depth)
          cachedData = (Array.isArray(data) ? data : [])
            .map(sanitizeVessel)
            .filter(Boolean);
          cacheTimestamp = Date.now();
          resolve(cachedData);
        })
        .catch(function(error) {
          console.error('[Data] Fallback fetch error:', error);
          // WHY TIDAK lagi memakai data demo di sini (regresi 2026-10):
          // getDemoData() berisi 3 kapal FIKTIF (TK001, TB001, LCT001)
          // yang tidak ada di vessels.json dan tidak punya halaman
          // vessel-*.html sama sekali - link detailnya selalu 404.
          // Harga di dalamnya (12M / 8,5M / 6M) terlihat nyata,
          // jadi listing fiktif bisa dibaca sebagai tawaran sungguhan
          // oleh calon pembeli - risiko hukum dan reputasi untuk
          // shipbroker.
          //
          // Honesty beats fake inventory: sekarang data kosong dan UI
          // menampilkan empty state yang jujur. Untuk pengembangan,
          // pakai ?demo=1 atau jalankan di localhost - lihat
          // shouldUseDemoData().
          if (shouldUseDemoData()) {
            console.warn('[Data] memakai data demo (mode pengembangan)');
            cachedData = getDemoData().map(sanitizeVessel).filter(Boolean);
            cacheTimestamp = Date.now();
            resolve(cachedData);
            return;
          }
          cachedData = [];
          cacheTimestamp = Date.now();
          resolve([]);
        });
    });
  }

  /**
   * Apakah data demo boleh dipakai?
   *
   * Syarat: SELALU localhost (untuk pengembangan) atau query param
   * ?demo=1 (untuk memeriksa tampilan katalog tanpa data asli).
   * Di domain publik, data demo tidak pernah boleh muncul - berisi
   * kapal fiktif yang tidak dijual.
   */
  function shouldUseDemoData() {
    var host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
    try {
      return new URLSearchParams(window.location.search).get('demo') === '1';
    } catch (e) {
      return false;
    }
  }

  /**
   * Get demo data untuk pengembangan saja - JANGAN dipanggil di
   * domain publik tanpa shouldUseDemoData() lebih dulu.
   * @returns {Array} Demo vessel data
   */
  function getDemoData() {
    return [
      {
        id: 'TK001',
        name: 'Tongkang 300ft Steel 2018',
        type: 'tongkang',
        status: 'available',
        year_built: 2018,
        price: 12000000000,
        is_negotiable: true,
        length: 91.44,
        beam: 18.29,
        depth: 3.66,
        draft: 2.5,
        dwt: 5000,
        gross_tonnage: 3000,
        flag_state: 'Indonesia',
        classification: 'Bureau Veritas',
        location: 'Surabaya, Jawa Timur',
        port_location: 'Pelabuhan Tanjung Perak',
        main_image_url: 'assets/hero-vessel.jpg',
        gallery_urls: '',
        description: 'Tongkang steel 300ft dalam kondisi baik. Cocok untuk angkut batu bara, semen, dan curah kering lainnya. Docking terakhir 2024.',
        highlights: ['Docking 2024', 'Kondisi prima', 'SI Persero & SIUD lengkap']
      },
      {
        id: 'TB001',
        name: 'Tugboat 2000HP 2020',
        type: 'tugboat',
        status: 'available',
        year_built: 2020,
        price: 8500000000,
        is_negotiable: true,
        length: 30,
        beam: 10,
        depth: 4,
        draft: 3,
        dwt: 500,
        gross_tonnage: 200,
        engine_type: 'CAT 3512',
        engine_power: '2000 HP',
        fuel_type: 'diesel',
        flag_state: 'Indonesia',
        classification: 'Bureau Veritas',
        location: 'Jakarta',
        port_location: 'Pelabuhan Tanjung Priok',
        main_image_url: 'assets/hero-vessel.jpg',
        gallery_urls: '',
        description: 'Tugboat powerful 2000HP. Cocok untuk towing tongkang dan operasi pelabuhan. Kondisi mesin prima.',
        highlights: ['Mesin CAT 3512', 'Kondisi prima', 'Siap operasi']
      },
      {
        id: 'LCT001',
        name: 'LCT 1000DWT 2015',
        type: 'lct',
        status: 'available',
        year_built: 2015,
        price: 6000000000,
        is_negotiable: true,
        length: 70,
        beam: 15,
        depth: 3,
        draft: 2,
        dwt: 1000,
        gross_tonnage: 800,
        engine_type: 'Yanmar',
        engine_power: '800 HP',
        fuel_type: 'diesel',
        flag_state: 'Indonesia',
        classification: 'Bureau Veritas',
        location: 'Balikpapan, Kalimantan',
        port_location: 'Pelabuhan Semayang',
        main_image_url: 'assets/hero-vessel.jpg',
        gallery_urls: '',
        description: 'LCT 1000DWT. Cocok untuk angkut alat berat dan material proyek. Ramp condition baik.',
        highlights: ['Ramp condition baik', 'Cocok alat berat', 'Lokasi Kalimantan']
      }
    ];
  }

  /**
   * Get all vessels
   * @returns {Promise<Array>} Array of vessel objects
   */
  function getVessels() {
    return fetchFromSheets();
  }

  /**
   * Get vessel by ID
   * @param {string} id - Vessel ID
   * @returns {Promise<object|null>} Vessel object or null
   */
  function getVesselById(id) {
    return fetchFromSheets().then(function(vessels) {
      return vessels.find(function(v) {
        return v.id === id;
      }) || null;
    });
  }

  /**
   * Get vessels by type
   * @param {string} type - Vessel type
   * @returns {Promise<Array>} Array of vessel objects
   */
  function getVesselsByType(type) {
    return fetchFromSheets().then(function(vessels) {
      if (!type || type === 'all') return vessels;
      return vessels.filter(function(v) {
        return v.type === type;
      });
    });
  }

  /**
   * Search vessels
   * @param {string} query - Search query
   * @returns {Promise<Array>} Array of vessel objects
   */
  function searchVessels(query) {
    return fetchFromSheets().then(function(vessels) {
      if (!query) return vessels;
      
      var lowerQuery = query.toLowerCase();
      return vessels.filter(function(v) {
        return (v.name && v.name.toLowerCase().indexOf(lowerQuery) !== -1) ||
               (v.description && v.description.toLowerCase().indexOf(lowerQuery) !== -1) ||
               (v.location && v.location.toLowerCase().indexOf(lowerQuery) !== -1);
      });
    });
  }

  /**
   * Filter vessels
   * @param {object} filters - Filter criteria
   * @returns {Promise<Array>} Filtered vessels
   */
  function filterVessels(filters) {
    return fetchFromSheets().then(function(vessels) {
      return vessels.filter(function(v) {
        // Type filter
        if (filters.type && filters.type !== 'all' && v.type !== filters.type) {
          return false;
        }
        
        // Status filter
        if (filters.status && filters.status !== 'all' && v.status !== filters.status) {
          return false;
        }
        
        // Price range filter
        if (filters.minPrice && v.price < filters.minPrice) {
          return false;
        }
        if (filters.maxPrice && v.price > filters.maxPrice) {
          return false;
        }
        
        // Year range filter
        if (filters.minYear && v.year_built < filters.minYear) {
          return false;
        }
        if (filters.maxYear && v.year_built > filters.maxYear) {
          return false;
        }
        
        // Location filter
        // WHY sama dengan js/catalog.js: kapal tanpa lokasi tidak
        // boleh lolos filter kota yang sedang aktif.
        if (filters.location && filters.location !== 'all') {
          if (!v.location || v.location.indexOf(filters.location) === -1) {
            return false;
          }
        }
        
        return true;
      });
    });
  }

  /**
   * Konversi Rupiah ke dolar AS memakai kurs dari config.
   *
   * WHY kurs di config dan bukan angka tetap di sini: kurs bergerak,
   * dan angka yang tertanam di kode tidak akan pernah diperbarui.
   * Satu nilai di js/config.js bisa diubah tanpa menyentuh kode.
   *
   * @param {number} price - Harga dalam Rupiah
   * @returns {number} perkiraan harga dalam dolar AS
   */
  /**
   * Kode lokalitas untuk pemisah ribuan dan desimal.
   *
   * WHY Konstanta, bukan fungsi: situs ini monolingual Bahasa
   * Indonesia, jadi pemisah desimal harus koma dan pemisah ribuan
   * titik. Fungsi yang membaca bahasa aktif pernah ada di sini dan
   * kini tidak ada gunanya - pemanggilnya tidak bisa mengembalikan
   * locale lain.
   *
   * @returns {string} 'id-ID'
   */
  function locale() {
    return LOCALE_ID;
  }

  /**
   * Label Bahasa Indonesia untuk jenis dan status kapal.
   *
   * WHY satu peta di sini, bukan di setiap modul: sebelum bahasa
   * Inggris dihapus, index.js dan compare.js sama-sama membangun kunci
   * 'vesselTypes.' + type lalu menerjemahkannya sendiri. Dua salinan
   * itu bisa berbeda someday. Sekarang data.js yang memiliki istilah
   * kapal, jadi siapa pun yang menampilkan label cukup memanggil.
   *
   * Nilai yang tidak dikenal dikembalikan apa adanya supaya data baru
   * tidak pernah tampil sebagai string kosong.
   *
   * @param {string} type
   * @returns {string}
   */
  function vesselTypeLabel(type) {
    var key = String(type || 'other');
    return VESSEL_TYPE_LABELS[key] || key;
  }

  /**
   * Daftar tipe kapal yang dikenal, urut sesuai VESSEL_TYPE_LABELS.
   * WHY diekspos: filter tipe di katalog dibangun dinamis dari data
   * (bukan daftar statis di HTML) supaya tipe baru di data tidak
   * pernah hilang dari filter. Urutan mengikuti peta label.
   * @returns {Array<{key: string, label: string}>}
   */
  function vesselTypes() {
    return Object.keys(VESSEL_TYPE_LABELS).map(function(key) {
      return { key: key, label: VESSEL_TYPE_LABELS[key] };
    });
  }

  /**
   * @param {string} status
   * @returns {string}
   */
  function vesselStatusLabel(status) {
    var key = String(status || 'available');
    return VESSEL_STATUS_LABELS[key] || key;
  }

  /**
   * Ringkas jumlah besar agar enak dibaca.
   *
   * WHY tidak memakai angka penuh: "Rp 38.000.000.000" jauh lebih
   * sulit dibandingkan dengan cara industri menulisnya ("28,5M").
   * Pembeli kapal sudah terbiasa dengan satuan besar, dan angka
   * penuh justru menutupi besarnya.
   *
   * @param {number} n - angka dalam Rupiah
   * @returns {string} contoh "38 Milyar", "850 Juta"
   */
  function ringkasRupiah(n) {
    // WHY ambangnya 1e6 dan bukan 1000: variabel jt sudah dalam JUTA,
    // jadi 1 miliar = 1.000 juta dan 1 triliun = 1.000.000 juta.
    // Dengan ambang 1000, harga Rp 4,5 miliar (4.500 juta) terbaca
    // "4,5 Triliun" - keliru sepuluh kali.
    //
    // WHY promote setelah pembulatan: Rp 999.999.999.999 (999.999 juta)
    // membulat jadi "1.000 Milyar", yang setiap orang pasti tafsirkan
    // sebagai 1 Triliun. Men-promote ke satuan berikutnya membuat
    // tampilan tidak pernah bertentangan dengan dirinya sendiri.
    //
    // WHY satuan lewat i18n: situs punya tombol English. Tanpa ini
    // harga berbunyi "Rp 38 Milyar" bahkan di halaman berbahasa Inggris.
    var jt = n / 1e6;
    if (jt >= 1e6) return trimRibuan(jt / 1e6) + ' Triliun';
    if (jt >= 1000) {
      var milyar = Number((jt / 1000).toFixed(1));
      if (milyar >= 1000) {
        return trimRibuan(milyar / 1000) + ' Triliun';
      }
      return trimRibuan(milyar) + ' Milyar';
    }
    if (jt >= 1) return trimRibuan(jt) + ' Juta';
    return n.toLocaleString(locale());
  }

  /**
   * Bulatkan ke satu angka desimal tanpa pembulatan banker's yang
   * membingungkan (2,5 jadi 2,5 bukan 2).
   * @param {number} n
   * @returns {string}
   */
  function trimRibuan(n) {
    return n.toLocaleString(locale(), {
      minimumFractionDigits: 0, maximumFractionDigits: 1
    });
  }

  /**
   * Format harga dalam Rupiah saja.
   *
   * WHY tidak ada konversi dolar lagi: harga kapal di situs ini
   * selalu ditulis dan disepakati dalam Rupiah. Menampilkan
   * perkiraan USD sempat membuat baris harga jadi dua baris di
   * sidebar, dengan mata uang terpisah dari angkanya. Satu satuan
   * juga menghindari pertanyaan "harga ini yang mana, dolar atau
   * rupiah?" dari calon pembeli. Keputusan produk, bukan pilihan
   * teknis.
   *
   * @param {number} price - Harga dalam Rupiah
   * @returns {string} contoh "Rp 38 Milyar"
   */
  function formatPrice(price) {
    if (!price) return 'Harga Hubungi Kami';
    return 'Rp ' + ringkasRupiah(price);
  }

  /**
   * Apakah badge STATUS perlu ditampilkan di kartu?
   *
   * WHY: Semua kapal berstatus 'available' - badge "Tersedia" muncul di
   * setiap kartu tanpa membawa informasi apa pun, hanya menambah noise
   * visual. Badge baru bermakna ketika status BERUBAH (reserved/sold).
   * Aturan ini membuat badge muncul otomatis begitu ada kapal yang
   * RESERVED/SOLD, dan hilang lagi saat semua tersedia.
   *
   * @param {object} vessel
   * @returns {boolean}
   */
  function shouldShowStatus(vessel) {
    // WHY: tanda kurung wajib - tanpa itu operator && mengikat lebih
    // kuat dari || sehingga klausa kedua dievaluasi walau vessel null
    // dan melempar TypeError.
    if (!vessel) return false;
    return vessel.status === 'reserved' || vessel.status === 'sold';
  }

  /**
   * Apakah badge JENIS perlu ditampilkan di kartu?
   *
   * WHY: Nama kapal sudah menyebut jenisnya ("Tugboat 1500 HP",
   * "Tanker 3.570 DWT 38M") - badge "Tanker" di atas nama yang sama
   * adalah pengulangan. Pada 14 dari 15 kapal badge ini murni duplikat,
   * jadi dihilangkan.
   *
   * Kalau ada kapal yang namanya TIDAK menyebut jenisnya, badge-nya
   * muncul otomatis. Satu pengecualian disengaja: type 'other' tidak
   * punya label di TYPE_WORDS, jadi tidak pernah menghasilkan badge -
   * memunculkan label "Lainnya"/"Other" di atas "Floating Crane
   * Barge 20M" adalah noise, bukan informasi.
   *
   * @param {object} vessel
   * @returns {boolean}
   */
  function shouldShowType(vessel) {
    if (!vessel) return false;
    var label = TYPE_WORDS[vessel.type];
    if (!label) return false;
    return (vessel.name || '').toLowerCase().indexOf(label.toLowerCase()) === -1;
  }

  /**
   * Build a responsive srcset for a vessel image path.
   *
   * WHY: Audit showed images = 88% of page transfer because every vessel
   * photo is 1600px wide while cards render at ~400px. Variants are
   * generated by tools/generate-image-variants.js; this helper only emits
   * srcset entries for files that ACTUALLY exist, so a missing variant
   * degrades gracefully to the original instead of 404ing.
   *
   * @param {string} url - Original image URL (e.g. 'assets/vessels/X/main.jpg')
   * @param {number[]} widths - Candidate widths in px, ascending
   * @returns {string} srcset attribute value ('' if no variants exist)
   */
  function buildSrcSet(url, widths) {
    if (!url || typeof url !== 'string') return '';
    if (/^https?:\/\//i.test(url)) return '';  // remote/CDN image: leave to server
    var dot = url.lastIndexOf('.');
    if (dot === -1) return '';
    var stem = url.slice(0, dot);

    // WHY: Varian harus sudah dipastikan ada. Kalau manifest belum dimuat
    // (mis. panggilan pertama sebelum fetch selesai) kita tidak boleh
    // menebak nama file, karena kandidat yang tidak ada akan dipilih
    // browser dan menghasilkan 404.
    var entry = variantManifest ? variantManifest[url] : null;
    if (!entry) return '';

    var maxWidth = entry.width || 0;
    var candidates = [];
    // WHY: Hanya terima lebar yang tercatat di manifest, tidak lebih dari
    // lebar asli, dan yang diminta pemanggil.
    (widths || []).forEach(function(w) {
      if (entry.variants.indexOf(w) === -1) return;
      if (w > maxWidth) return;
      candidates.push(stem + '-' + w + 'w.jpg ' + w + 'w');
    });
    candidates.push(url + ' ' + maxWidth + 'w');
    return candidates.join(', ');
  }

  /**
   * Bangun srcset versi WebP untuk dipakai di dalam <picture><source>.
   *
   * WHY: WebP 85% lebih kecil dari JPEG pada foto kapal ini (4,0 MB
   * banding 25,9 MB untuk seluruh varian), dan semua browser modern
   * mendukungnya. <picture> memberi browser pilihan lebih dulu, dan
   * <img> di dalamnya tetap JPEG sebagai cadangan - jadi kalau file
   * WebP tidak ada, halaman tidak pernah rusak.
   *
   * @param {boolean} [includeFull] - Kalau true, tambahkan juga WebP
   *   berkas asli sebagai kandidat terakhir (dipakai gambar utama kapal)
   *
   * Mengembalikan string kosong kalau tidak ada varian WebP yang
   * tercatat di manifest. Pemanggil lalu tidak membuat <source>
   * sama sekali, sehingga markup-nya persis seperti sebelumnya.
   */
  function buildSrcSetWebp(url, widths, includeFull) {
    if (!url || typeof url !== 'string') return '';
    if (/^https?:\/\//i.test(url)) return '';
    var dot = url.lastIndexOf('.');
    if (dot === -1) return '';
    var stem = url.slice(0, dot);

    var entry = variantManifest ? variantManifest[url] : null;
    // WHY: Hanya gunakan daftar webp di manifest. Kalau enkoder WebP gagal
    // untuk sebuah gambar, daftar ini kosong dan kita tidak menebak nama
    // file - menebak akan menghasilkan 404 yang lolos dari validator.
    if (!entry || !entry.webp || !entry.webp.length) return '';

    var maxWidth = entry.width || 0;
    var candidates = [];
    (widths || []).forEach(function(w) {
      if (entry.webp.indexOf(w) === -1) return;
      if (w > maxWidth) return;
      candidates.push(stem + '-' + w + 'w.webp ' + w + 'w');
    });
    // WHY: Di layar retina srcset memilih kandidat TERBESAR. Kalau
    // kandidat terbesar cuma 800w, browser akan memakai JPEG asli
    // 1600px dari <img> yang jauh lebih besar. Karena itu WebP untuk
    // berkas asli ikut dicatat sebagai webpFull di manifest, dan di sini
    // ditambahkan sebagai kandidat terakhir.
    if (includeFull && entry.webpFull > 0) {
      // WHY: hanya tambah kalau memang lebih lebar dari kandidat terbesar.
      // Kalau ada varian WebP 1600w, keduanya nama berkas sama sekali dan
      // menambahkannya hanya menghasilkan duplikat di srcset.
      var lastW = candidates.length ? parseInt(candidates[candidates.length - 1].split(' ')[1], 10) : 0;
      if (entry.webpFull > lastW) {
        candidates.push(url.replace(/\.jpg$/i, '.webp') + ' ' + entry.webpFull + 'w');
      }
    }
    return candidates.join(', ');
  }

  /**
   * Bangun markup <picture> lengkap untuk sebuah gambar.
   *
   * @param {string} url - Path gambar (relatif)
   * @param {Array<number>} widths - Lebar varian yang diminta
   * @param {string} imgAttrs - Atribut untuk <img>, sudah di-escape
   * @param {string} sizes - Nilai atribut sizes untuk <source>
   * @returns {string} Markup <picture>, atau <img> biasa sebagai cadangan
   */
  function buildPicture(url, widths, imgAttrs, sizes, includeFull) {
    var webp = buildSrcSetWebp(url, widths, includeFull);
    // WHY: Kalau tidak ada varian WebP, kembalikan <img> polos. Dengan
    // begitu halaman tidak pernah punya <source> yang menunjuk file
    // yang tidak ada, dan penataannya sama persis seperti sebelumnya.
    if (!webp) return '<img ' + imgAttrs + '>';
    return '<picture><source type="image/webp" srcset="' + webp + '"' +
      (sizes ? ' sizes="' + sizes + '"' : '') + '>' +
      '<img ' + imgAttrs + '></picture>';
  }

  /**
   * Format number with dots
   * @param {number} num - Number to format
   * @returns {string} Formatted number
   */
  function formatNumber(num) {
    if (!num) return '-';
    return num.toLocaleString('id-ID');
  }

  /**
   * Badge lokasi kecil untuk baris harga kartu katalog.
   *
   * WHY di samping harga, bukan baris sendiri: baris tambahan menggeser
   * foto di bawah porsi 65% tinggi kartu; menempel di baris harga tidak
   * mengubah tinggi zona teks sama sekali.
   *
   * @param {object} v - Data kapal yang sudah lewat sanitizeVessel
   * @returns {string} Markup .catalog-card-location, atau '' bila kosong
   */
  function buildCardLocationHtml(v) {
    // WHY fallback: jika js/sanitize.js gagal dimuat, situs tidak boleh mati total.
    var Sanitize = window.KapalProSanitize || {
      escapeHtml: function(str) {
        return String(str == null ? '' : str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }
    };
    var loc = String(v.location || '').trim();
    if (!loc) return '';
    return '<span class="catalog-card-location">'
      + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">'
      +   '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>'
      +   '<circle cx="12" cy="10" r="3"></circle>'
      + '</svg>'
      + '<span>' + Sanitize.escapeHtml(loc) + '</span>'
      + '</span>';
  }

  // ---------- Kartu katalog (dipakai beranda DAN catalog.html) ----------

  // WHY konstanta, bukan literal di objek ekspor: pembangun kartu di bawah
  // memakai lebar yang sama, dan dua definisi terpisah (satu untuk ekspor,
  // satu untuk pemakaian internal) adalah cara termudah membuat srcset JPEG
  // dan <source> WebP menunjuk lebar berbeda lalu memotong gambar.
  var CARD_WIDTHS = [400, 800];
  var THUMB_WIDTHS = [150, 300];

  /**
   * Batas foto per kartu.
   *
   * WHY maksimal 3: kartu adalah ringkasan, bukan galeri penuh (itu tugas
   * halaman detail). Slide tersembunyi tidak diunduh browser (loading=lazy
   * + display:none tidak punya box, jadi tidak pernah mendekati viewport).
   */
  var MAX_CARD_PHOTOS = 3;

  /** Foto-foto kartu: utama + gallery_urls (dipisah koma), dipangkas. */
  function cardPhotos(v) {
    var gallery = String(v.gallery_urls || '')
      .split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    return [v.main_image_url].concat(gallery).slice(0, MAX_CARD_PHOTOS);
  }

  /**
   * Markup lengkap satu kartu kapal (.catalog-card).
   *
   * WHY satu pembangun untuk dua halaman: versi sebelumnya MENYALIN markup
   * ini di js/index.js dan js/catalog.js, dan salinannya sudah berbeda
   * tanpa disadari - beranda menampilkan carousel, katalog tidak, padahal
   * kapalnya sama. Kini perbedaan antar halaman hanya mungkin lewat opsi
   * di bawah, bukan lewat salinan yang bisa menyimpang.
   *
   * @param {object} v - kapal, sudah lewat sanitizeVessel
   * @param {object} opts
   * @param {string} opts.sizes - atribut sizes. Grid tiap halaman beda
   *   (beranda 3 kolom ~30vw, katalog ~31vw), jadi pemanggil yang tahu
   *   lebar rendernya - tanpa ini browser memilih kandidat terlalu besar.
   * @param {boolean} [opts.carousel] - tampilkan thumbnail foto.
   *   Tanpa opsi ini hanya foto utama yang dirender (perilaku katalog).
   * @param {boolean} [opts.saveButton] - tombol simpan shortlist; fitur
   *   khas catalog.html, bukan beranda.
   * @returns {string} markup <article class="catalog-card">
   */
  function buildCardHtml(v, opts) {
    // WHY fallback: jika js/sanitize.js gagal dimuat, situs tidak boleh mati total.
    var Sanitize = window.KapalProSanitize || {
      escapeHtml: function(str) {
        return String(str == null ? '' : str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }
    };
    var options = opts || {};
    var sizes = options.sizes || '(max-width: 767px) 92vw, (max-width: 1099px) 46vw, 30vw';
    var vesselId = encodeURIComponent(v.id || '');

    // WHY badge hanya untuk status yang informatif: 'available' adalah
    // default semua kapal, jadi badge itu selalu muncul tanpa membawa
    // informasi apa pun.
    var badges = '';
    if (shouldShowStatus(v)) {
      badges += '<span class="catalog-card-badge'
        + (v.status === 'sold' ? ' is-sold' : '')
        + '">' + Sanitize.escapeHtml(vesselStatusLabel(v.status)) + '</span>';
    }
    // WHY badge "Baru"/"Turun Harga": sinyal kebaruan & urgensi ala
    // marketplace kapal internasional; hanya muncul bila flag datanya
    // ada di vessels.json (is_new / price_drop).
    if (v.is_new) {
      badges += '<span class="catalog-card-badge is-new">Baru</span>';
    }
    if (v.price_drop) {
      badges += '<span class="catalog-card-badge is-drop">Turun Harga</span>';
    }
    // WHY dibungkus .catalog-card-badges: badge overlay absolute di
    // media; tanpa wrapper, badge kedua menumpuk tepat di atas badge
    // pertama (sama-sama top/left).
    var badge = badges ? '<div class="catalog-card-badges">' + badges + '</div>' : '';

    // WHY atribut <img> dirangkai di fungsi kecil, bukan ditulis inline di
    // dalam daftar argumen: baris lanjutan yang diawali "+" di DALAM daftar
    // argumen dibaca sebagai unary plus (a, + b), bukan operator
    // penjumlahan. Hasilnya setiap literal 'src="' berubah jadi NaN dan
    // markup menjadi <img NaNassets/...>, yang lolos syntax check tapi
    // tidak punya satu pun atribut src yang sah.
    // WHY width/height 800x600: rasio 4:3 media (lihat CSS) - pasangan ini
    // menjaga CLS tetap nol sebelum gambar termuat.
    function imgAttrs(url, alt) {
      return 'src="' + Sanitize.escapeHtml(url) + '"'
        + ' srcset="' + Sanitize.escapeHtml(buildSrcSet(url, CARD_WIDTHS)) + '"'
        + ' sizes="' + Sanitize.escapeHtml(sizes) + '"'
        + ' alt="' + Sanitize.escapeHtml(alt) + '"'
        + ' loading="lazy"'
        + ' decoding="async"'
        + ' width="800"'
        + ' height="600"';
    }

    // Foto utama selalu slide pertama. Dengan carousel, foto gallery menjadi
    // slide tersembunyi yang baru diunduh saat dipilih; tanpa carousel hanya
    // foto utama yang masuk markup.
    var photos = cardPhotos(v);
    var slides = (options.carousel ? photos : photos.slice(0, 1)).map(function(url, i) {
      var alt = i === 0 ? v.name : v.name + ' - Foto ' + (i + 1);
      return '<div class="catalog-card-slide" data-slide="' + i + '"'
        + (i > 0 ? ' hidden' : '') + '>'
        + buildPicture(url, CARD_WIDTHS, imgAttrs(url, alt), sizes)
        + '</div>';
    }).join('');

    // Thumbnail: HANYA bila carousel dinyalakan dan memang ada
    // lebih dari satu foto. Tombol (bukan <a>) supaya menekannya tidak
    // menavigasi; slide aktif diumumkan lewat aria-pressed.
    var thumbs = '';
    if (options.carousel && photos.length > 1) {
      thumbs = '<div class="catalog-card-thumbs">'
        + photos.map(function(url, i) {
            return '<button type="button" class="catalog-card-thumb'
              + (i === 0 ? ' is-active' : '')
              + '" data-slide="' + i + '"'
              + ' aria-pressed="' + (i === 0 ? 'true' : 'false') + '"'
              + ' aria-label="Lihat foto ' + (i + 1) + ' dari ' + photos.length + '">'
              + buildPicture(
                  url,
                  THUMB_WIDTHS,
                  'src="' + Sanitize.escapeHtml(url) + '"'
                  + ' srcset="' + Sanitize.escapeHtml(buildSrcSet(url, THUMB_WIDTHS)) + '"'
                  + ' sizes="44px"'
                  + ' alt=""'
                  + ' loading="lazy"'
                  + ' decoding="async"'
                  + ' width="150"'
                  + ' height="150"',
                  '44px')
              + '</button>';
          }).join('')
        + '</div>';
    }

    // WHY tombol simpan di LUAR link judul: seluruh kartu bisa diklik lewat
    // stretched link judul, dan tombol di dalam tautan akan ikut memicu
    // navigasi ketika ditekan.
    var saveButton = '';
    if (options.saveButton) {
      saveButton = '<button type="button" class="save-btn card-save-btn" data-vessel-id="'
        + Sanitize.escapeHtml(vesselId) + '" aria-pressed="false" '
        + 'aria-label="' + Sanitize.escapeHtml(v.name) + '">'
        + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">'
        +   '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>'
        + '</svg>'
        + '</button>';
    }

    // WHY struktur foto-atas-teks-bawah: foto adalah elemen paling dominan
    // di kartu - teks di bawah hanya nama + harga (+ lokasi di samping
    // harga), tanpa deskripsi dan tanpa daftar spesifikasi (itu chip
    // overlay di atas foto). Perbandingan lengkap ada di halaman detail.
    // WHY seluruh kartu klikabel lewat judul (stretched link): satu <a>
    // dengan teks nama kapal, dibentangkan menutupi kartu lewat CSS.
    return ''
      + '<article class="catalog-card">'
      +   saveButton
      +   '<div class="catalog-card-media">'
      +     badge
      +     slides
      +     thumbs
      +   '</div>'
      +   '<div class="catalog-card-body">'
      +     '<h3 class="catalog-card-title">'
      +       '<a class="catalog-card-title-link" href="vessel-' + vesselId + '.html">'
      +         Sanitize.escapeHtml(v.name)
      +       '</a>'
      +     '</h3>'
      +     '<div class="catalog-card-price-row">'
      +       '<p class="catalog-card-price">' + formatPrice(v.price) + '</p>'
      +       buildCardLocationHtml(v)
      +     '</div>'
      +   '</div>'
      + '</article>';
  }

  /**
   * Clear cache
   */
  function clearCache() {
    cachedData = null;
    cacheTimestamp = 0;
    inFlightRequest = null;
    inFlightJsonp = null;
  }

  // Expose public API
  /**
   * Ubah "2024-05" menjadi "Mei 2024" mengikuti bahasa aktif.
   *
   * WHY Intl dan bukan daftar nama bulan sendiri: daftar itu harus
   * dirawat dua kali dan cepat menyimpang dari bawaan browser.
   * Nilai yang tidak berbentuk tahun atau tahun-bulan dikembalikan
   * apa adanya, supaya data tidak baku tetap terbaca dan tidak ikut
   * hilang.
   *
   * WHY di sini dan bukan di halaman kapal: halaman kapal dan tabel
   * perbandingan sama-sama butuh pemformatan yang sama. Dua salinan
   * pasti akan berbeda begitu salah satunya diubah.
   *
   * @param {string} value - "YYYY", "YYYY-MM", atau teks bebas
   * @returns {string}
   */
  function formatLastDock(value) {
    var text = String(value == null ? '' : value).trim();
    var m = /^(\d{4})(?:-(\d{2}))?$/.exec(text);
    if (!m) return text;
    if (!m[2]) return m[1];
    var month = Number(m[2]);
    if (month < 1 || month > 12) return text;
    try {
      return new Date(Date.UTC(Number(m[1]), month - 1, 1)).toLocaleDateString(
        locale(),
        { month: 'long', year: 'numeric', timeZone: 'UTC' }
      );
    } catch (e) {
      return text;
    }
  }

  window.VesselData = {
    getVessels: getVessels,
    getVesselById: getVesselById,
    getVesselsByType: getVesselsByType,
    searchVessels: searchVessels,
    filterVessels: filterVessels,
    formatPrice: formatPrice,
    
    formatNumber: formatNumber,
    formatLastDock: formatLastDock,
    buildSrcSet: buildSrcSet,
    loadVariantManifest: loadVariantManifest,
    buildSrcSetWebp: buildSrcSetWebp,
    buildPicture: buildPicture,
    buildCardLocationHtml: buildCardLocationHtml,
    buildCardHtml: buildCardHtml,
    // WHY: Lebar varian kartu dan thumbnail punya SATU definisi (di atas,
    // sebelum pembangun kartu) supaya srcset JPEG dan <source> WebP selalu
    // meminta lebar yang sama. Kalau berbeda, browser memilih lebar berbeda
    // per format dan gambar bisa terpotong.
    CARD_WIDTHS: CARD_WIDTHS,
    THUMB_WIDTHS: THUMB_WIDTHS,
    // WHY: Halaman kapal butuh dimensi asli foto untuk mengisi
    // og:image:width / og:image:height. Manifest sudah mencatatnya, jadi
    // tidak perlu membaca berkas gambar satu per satu.
    getVariantInfo: function (url) {
      return variantManifest ? variantManifest[url] || null : null;
    },
    shouldShowStatus: shouldShowStatus,
    shouldShowType: shouldShowType,
    vesselTypeLabel: vesselTypeLabel,
    vesselTypes: vesselTypes,
    vesselStatusLabel: vesselStatusLabel,
    clearCache: clearCache,
    getDemoData: getDemoData,
    setConfig: function(key, value) {
      CONFIG[key] = value;
    }
  };
})();
