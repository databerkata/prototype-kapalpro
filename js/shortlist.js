/**
 * Shortlist Kapal - KapalPro
 * ==========================
 *
 * WHY fitur ini ada: hampir semua marketplace kapal yang serius
 * (YachtWorld, Boats.com, Boat Trader, Bursa Kapal) punya "save this
 * listing". Bukan karena unpatentable - harga kapal bekas punya rentang
 * puluhan miliar, dan pembeli nyata perlu membandingkan 3-5 kapal
 * sebelum memutuskan. Tanpa daftar itu, kandidat yang sedang
 * dipertimbangkan hilang begitu tab ditutup.
 *
 * WHY localStorage, bukan server: situs ini sengaja tanpa backend.
 * Shortlist adalah preferensi pribadi perangkat, bukan data yang perlu
 * bertahan lintas perangkat - dan menyimpannya di server berarti
 * butuh akun, yang menjadi hambatan besar di jalur konversi.
 *
 * Batasnya jelas dan sebaiknya disebut: daftar hilang kalau pengguna
 * membersihkan data peramban atau berpindah perangkat. Untuk daftar
 * sementara yang sangat wajar, dan jauh lebih baik daripada tidak punya
 * fitur sama sekali.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'kapalpro.shortlist';

  // WHY dibatasi: localStorage hanya bisa menampung beberapa ratus KB
  // dan penuhnya akan melemahkan SELURUH situs, bukan hanya shortlist.
  // 50 kapal sudah jauh melebihi yang realistis dicatat orang.
  var MAX_ITEMS = 50;

  var memory = null;   // cache fallback saat localStorage tidak tersedia

  function readStore() {
    if (memory) return memory;
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ids: [] };
      var parsed = JSON.parse(raw);
      // WHY dua lapis validasi: localStorage bisa berisi apa saja -
      // versi lama situs,(users yang mengedit manual lewat devtools,
      // atau data rusak. Bentuk lain harus diabaikan diam-diam, bukan
      // membuat setiap pembaca shortlist gagal.
      if (!Array.isArray(parsed)) return { ids: [] };
      return { ids: parsed.filter(function (id) {
        return typeof id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(id);
      }) };
    } catch (e) {
      return { ids: [] };
    }
  }

  function writeStore(ids) {
    memory = { ids: ids };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch (e) {
      // WHY tidak melempar: localStorage penuh atau ditolak (mode
      // privat). Cache di memori tetap membuat fitur berfungsi selama
      // halaman ini terbuka - lebih baik daripada form yang error.
    }
  }

  function emit(ids) {
    // WHY CustomEvent: halaman kapal dan katalog bisa menampilkan
    // jumlah kapal yang disimpan di header. Mereka tidak tahu satu
    // sama lain, jadi perubahan harus disiarkan lewat event.
    try {
      document.dispatchEvent(new CustomEvent('kapalpro:shortlist', {
        detail: { ids: ids.slice() }
      }));
    } catch (e) { /* browser tanpa CustomEvent: tombol tetap berfungsi */ }
  }

  var api = {
    KEY: STORAGE_KEY,
    MAX_ITEMS: MAX_ITEMS,

    /** Semua id kapal yang tersimpan, urut seperti disimpan. */
    getAll: function () {
      return readStore().ids.slice();
    },

    /** True kalau kapal ini sudah ada di daftar. */
    has: function (id) {
      return readStore().ids.indexOf(String(id)) !== -1;
    },

    count: function () {
      return readStore().ids.length;
    },

    /**
     * Tambah atau hapus kapal dari daftar.
     * @returns {boolean} true kalau sekarang tersimpan, false kalau dihapus
     */
    toggle: function (id) {
      var key = String(id);
      var ids = readStore().ids.slice();
      var at = ids.indexOf(key);
      if (at !== -1) {
        ids.splice(at, 1);
        writeStore(ids);
        emit(ids);
        return false;
      }
      // WHY menolak id yang tidak valid, bukan menerima diam-diam: id
      // inilah yang jadi bagian URL, dan membangun URL dari data tak
      // tepercaya adalah kelas bug yang sudah pernah terjadi di sini.
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(key)) return false;
      if (ids.length >= MAX_ITEMS) return false;
      ids.push(key);
      writeStore(ids);
      emit(ids);
      return true;
    },

    remove: function (id) {
      var ids = readStore().ids.filter(function (x) { return x !== String(id); });
      writeStore(ids);
      emit(ids);
    },

    clear: function () {
      writeStore([]);
      emit([]);
    }
  };

  window.KapalProShortlist = api;
})();
