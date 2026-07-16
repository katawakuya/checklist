// Service Worker - 現場管理システム
// キャッシュバージョン（更新時はここを変える）
const CACHE_VERSION = 'v4.0';
const CACHE_NAME = 'kanri-' + CACHE_VERSION;

// キャッシュするファイル一覧
const CACHE_FILES = [
  './index.html',
  './guest.html',
  './roadbed.html',
  './order.html',
  './checklist.html',
  './viewer.html',
  './manage.html',
  './zaimatsu.html',
  './Claude/pdf-crop.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

// インストール：静的ファイルをキャッシュ
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CACHE_FILES.map(function(url) {
        return new Request(url, { cache: 'reload' });
      })).catch(function(err) {
        // ファイルが存在しなくてもインストール継続
        console.warn('[SW] cache.addAll partial fail:', err);
      });
    })
  );
  self.skipWaiting();
});

// アクティベート：古いキャッシュを削除
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// フェッチ：HTMLはネットワーク優先（常に最新）、他はキャッシュ優先
self.addEventListener('fetch', function(event) {
  // FirebaseなどのAPIはキャッシュしない
  var url = event.request.url;
  if (url.includes('firestore') || url.includes('firebase') ||
      url.includes('googleapis') || url.includes('gstatic')) {
    return; // ブラウザデフォルト（ネットワーク）
  }

  // HTMLページ：ネットワーク優先（オフライン時のみキャッシュ）
  // → リロードボタンを押すだけで常に最新版が取得できる
  if (event.request.mode === 'navigate' || url.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        // オフライン時はキャッシュを返す
        return caches.match(event.request).then(function(cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // JS / JSON / 画像：キャッシュ優先（バージョン変更時に自動更新）
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        if (response.ok && (
          url.endsWith('.js') ||
          url.endsWith('.json') ||
          url.endsWith('.png')
        )) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
