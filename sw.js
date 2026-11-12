/* 背景程式：讓網頁沒網路也打得開，並在 Android 手機一有網路時於背景自動上傳 */
/* global self, caches, clients, FarmCore */
const VERSION = 'build-20261112-141957';
const CACHE = 'farm-visit-' + VERSION;
const SHELL = ['./', './index.html', './app.js', './core.js', './config.js', './inapp.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.importScripts('./core.js');

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // 上傳不經過快取
  // 網頁本身（html）先抓網路上的新版，沒網路才用手機裡存的，避免更新後還看到舊畫面
  // 有網路一律用最新版（測試期常更新），沒網路才用手機裡存的
  if (true) {
    // 0.4.46 第6任查到：Firebase 對「/」快取 1 小時、GitHub 全部 10 分鐘 → 一律跟伺服器確認最新版（cache:'no-cache'），不吃瀏覽器舊快取，避免舊頁面＋新程式
    e.respondWith(caches.open(CACHE).then(c => fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })
      .catch(() => c.match(e.request, { ignoreSearch: true }).then(hit => hit || c.match('./index.html')))));
    return;
  }
  // 其他檔案先用手機裡的版本（離線也能開），同時在背景抓新版
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit || Response.error());
    return hit || net;
  }));
});

async function syncAndTell() {
  const result = await FarmCore.runSync();
  const list = await clients.matchAll({ includeUncontrolled: true });
  list.forEach(c => c.postMessage({ type: 'synced', result }));
  // 拜訪或任務打勾還有沒送出的，就讓瀏覽器稍後再試（R6-04：只有打勾時原本不會再試）
  if (result && result.error && (result.left || result.tickLeft)) throw new Error('retry');
}

// Android Chrome：網頁關掉後，一有網路就會叫醒這裡
self.addEventListener('sync', e => {
  if (e.tag === 'upload-visits') e.waitUntil(syncAndTell());
});
self.addEventListener('periodicsync', e => {
  if (e.tag === 'upload-visits') e.waitUntil(syncAndTell().catch(() => {}));
});
