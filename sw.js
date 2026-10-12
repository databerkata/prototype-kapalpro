/**
 * Service Worker - KapalPro
 * =========================
 * Bukan modul halaman: berkas ini TIDAK dimuat lewat <script>, jadi
 * tidak ada di daftar aset tools/stamp-assets.js dan tidak punya token
 * versi. Browser mengambilnya langsung saat registrasi di js/app.js.
 *
 * Strategi per kelas permintaan (bukan satu aturan untuk semua):
 *
 *   HTML (navigasi)  network-first. Halaman kapal dan katalog berubah
 *                    setiap kali armada diperbarui; menyajikan salinan
 *                    lama lebih berbahaya daripada menunggu jaringan.
 *                    Salinan yang pernah dilihat tetap disimpan sebagai
 *                    cadangan offline, dan bila tidak ada sama sekali
 *                    barulah offline.html dipakai.
 *   Gambar + aset    stale-while-revalidate. Nama berkasnya sudah
 *   ber-token ?v=    berisi lebar (hero-vessel-800w.webp) atau token
 *                    versi (?v=77dec226), jadi isinya tidak pernah
 *                    berubah tanpa nama berubah - aman disajikan dari
 *                    cache sambil diperbarui di latar belakang.
 *   Lintas asal      TIDAK PERNAH disentuh. Permintaan ke Plausible
 *                    (analytics) dan docs.google.com (form) punya
 *                    aturan sendiri, berisi data pengguna, dan
 *                    jawabannya bergantung waktu - meng-cache-nya
 *                    berarti membuat analitik dan form bohong.
 *   POST dan lain    Diteruskan apa adanya. Meng-cache permintaan non-GET
 *                    dilarang Cache API, dan form memang harus sampai
 *                    ke server.
 *
 * Aturan versi: PRECACHE berisi berkas yang tidak pernah berubah nama,
 * jadi isinya hanya diperbarui saat install berikutnya - yaitu ketika
 * BYTE sw.js ini berubah. Setiap kali offline.html disunting, OFFLINE_HASH
 * di bawah WAJIB ikut diperbarui; tests/pwa.test.js gagal bila keduanya
 * tidak cocok. Tanpa penjaga itu, pengunjung akan terus disajikan
 * halaman offline versi lama tanpa ada yang tahu.
 */
'use strict';

/** Naikkan angka ini bila kelas cache berubah, bukan tiap kali berkas berubah. */
const CACHE_VERSION = 'v1';

const PRECACHE = 'kapalpro-precache-' + CACHE_VERSION;
const RUNTIME = 'kapalpro-runtime-' + CACHE_VERSION;

/**
 * Alamat absolut halaman offline.
 *
 * WHY absolut, bukan 'offline.html' saja: service worker boleh disajikan
 * pada navigasi ke URL sedalam apa pun (termasuk path yang tidak ada),
 * dan caches.match() mencocokkan alamat lengkap. Menyusun alamatnya dari
 * lokasi sw.js membuat kuncinya selalu sama dengan kunci precache.
 */
const OFFLINE_URL = new URL('offline.html', self.location.href).href;

/**
 * Sidik jari offline.html - HANYA dibaca tests/pwa.test.js, browser
 * tidak memakainya. Lihat "Aturan versi" di atas.
 */
const OFFLINE_HASH = '4a628fa08a2b8062';

/**
 * Berkas yang harus ada SEBELUM offline pertama.
 * WHY hanya ini: precache berjalan sekali saat install, jadi isinya
 * harus kecil dan stabil. HTML sengaja tidak ikut - 1,2 MB halaman
 * kapal tidak boleh diunduh hanya karena pengunjung membuka beranda.
 */
const PRECACHE_URLS = [
  OFFLINE_URL,
  'assets/favicon.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-512.png'
];

const GAMBAR = /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i;
const ASET = /\.(?:css|js)$/i;

/**
 * Respons yang boleh disimpan.
 *
 * WHY bukan sekadar response.ok: respons lintas asal bertipe 'opaque'
 * selalu punya status 0 dan ok=false, jadi pemeriksaan status saja
 * sudah menolaknya - tapi tanpa cek type, respons opaque yang lolos
 * (mis. dari no-cors) akan tersimpan sebagai isi yang tidak bisa
 * dibaca siapa pun. Halaman error berstatus 404 juga tidak boleh
 * menang atas jaringan: pengunjung harus melihat pesan "offline",
 * bukan halaman "tidak ditemukan" yang menyesatkan.
 */
function isCacheable(response) {
  return !!response && response.ok && response.type === 'basic';
}

/**
 * Apakah permintaan aset ini boleh dilayani dari cache lebih dulu.
 *
 * @param {URL} url
 * @returns {boolean}
 */
function shouldCache(url) {
  if (GAMBAR.test(url.pathname)) return true;
  // WHY perlu token: js/analytics.js tanpa ?v= bisa berubah isinya tanpa
  // berubah namanya, dan menyajikan versi lama dari cache berarti bug
  // yang sudah diperbaiki muncul kembali.
  return url.searchParams.has('v') && ASET.test(url.pathname);
}

/**
 * HTML: coba jaringan lebih dulu, baru cache.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
function networkFirst(request) {
  return caches.open(RUNTIME).then(function (cache) {
    return fetch(request).then(function (response) {
      if (isCacheable(response)) cache.put(request, response.clone());
      return response;
    }).catch(function () {
      return cache.match(request).then(function (cached) {
        if (cached) return cached;
        return caches.match(OFFLINE_URL).then(function (offline) {
          // WHY Response.error() sebagai jalan terakhir: mengembalikan
          // Response('') akan tampak seperti halaman kosong yang berhasil
          // dimuat, sehingga pengunjung tidak tahu koneksinya putus.
          return offline || Response.error();
        });
      });
    });
  });
}

/**
 * Aset: sajikan cache lebih dulu, perbarui di latar belakang.
 *
 * @param {Request} request
 * @param {FetchEvent} event
 * @returns {Promise<Response>}
 */
function staleWhileRevalidate(request, event) {
  return caches.open(RUNTIME).then(function (cache) {
    return cache.match(request).then(function (cached) {
      const dariJaringan = fetch(request).then(function (response) {
        if (!isCacheable(response)) return response;
        return cache.put(request, response.clone()).then(function () {
          return response;
        });
      }).catch(function () {
        return cached || Response.error();
      });

      if (!cached) return dariJaringan;

      // WHY event.waitUntil: begitu respons cache dikembalikan, browser
      // boleh mematikan service worker - tanpa ini pembaruan di latar
      // belakang sering terpotong di tengah dan aset tidak pernah segar.
      event.waitUntil(dariJaringan.catch(function () {}));
      return cached;
    });
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(PRECACHE).then(function (cache) {
      // WHY addAll dan bukan loop yang menelan error: satu berkas
      // precache yang hilang berarti halaman offline tidak akan pernah
      // bisa dibuka, dan itu lebih baik ketahuan saat install daripada
      // saat pengunjung sedang benar-benar tanpa jaringan.
      return cache.addAll(PRECACHE_URLS);
    }).then(function () {
      // WHY skipWaiting: situs statis tanpa state di klien, jadi menahan
      // service worker baru sampai semua tab ditutup hanya membuat
      // pengunjung memakai JS lama selama sesi - persis kebalikan dari
      // yang diinginkan.
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (name) {
        return name !== PRECACHE && name !== RUNTIME;
      }).map(function (name) {
        return caches.delete(name);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;

  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  if (url.origin !== self.location.origin) return;

  // WHY sw.js selalu dari jaringan: menyajikan service worker dari cache
  // membuat pembaruan situs tidak pernah sampai - cache akan memuat
  // service worker lama, yang lalu menyajikan aset lama.
  if (url.pathname.endsWith('/sw.js')) return;

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (shouldCache(url)) event.respondWith(staleWhileRevalidate(request, event));
});
