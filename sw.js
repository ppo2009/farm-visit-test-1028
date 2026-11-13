/* 背景程式：讓網頁沒網路也打得開，並在 Android 手機一有網路時於背景自動上傳 */
/* global self, caches, clients, FarmCore */
const VERSION = 'build-20261113-183955';
const CACHE = 'farm-visit-' + VERSION;
const NET_TIMEOUT_MS = 4000; // 0.4.87 中7：網路 4 秒還沒回，手機裡有快取就先用
const SLOW = {};               // 逾時的記號
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

// 0.4.91 中1（第11任第三輪清單）：原本每個檔各自決定新舊（4 秒沒回就用快取）→ 同一次開網頁可能「新網頁＋舊程式」，試作品項只剩空白。
// 改成「網頁那次怎麼拿，同一次載入的程式檔就怎麼拿」：網頁用了快取（舊版）→ 程式檔也直接用快取（舊版一整套）；
// 網頁是網路上的新版 → 程式檔也等網路（等久一點 NET_TIMEOUT_SUB_MS，真的不回才用快取；萬一還是混到，app.js 開機比對版本標記會重新整理一次）
const NET_TIMEOUT_SUB_MS = 15000;
const NAV_MODE = {};           // 這次載入的分頁 → { mode: 'cache' | 'net', t }
const NAV_MODE_TTL = 60000;    // 一分鐘內載入的程式檔才跟著網頁走
function navModeFor(e) {
  const now = Date.now();
  Object.keys(NAV_MODE).forEach(k => { if (now - NAV_MODE[k].t > NAV_MODE_TTL) delete NAV_MODE[k]; });
  return NAV_MODE[e.clientId] || NAV_MODE._last || null;
}
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // 上傳不經過快取
  // 網頁本身（html）先抓網路上的新版，沒網路才用手機裡存的，避免更新後還看到舊畫面
  // 有網路一律用最新版（測試期常更新），沒網路才用手機裡存的
  // 0.4.46 第6任查到：Firebase 對「/」快取 1 小時、GitHub 全部 10 分鐘 → 一律跟伺服器確認最新版（cache:'no-cache'），不吃瀏覽器舊快取，避免舊頁面＋新程式
  // 0.4.87（第11任清單中7）：訊號很弱時網路一直不回 → 等 NET_TIMEOUT_MS 還沒回，手機裡有這個檔就先用（網路那邊繼續等，回來照樣更新快取）；
  // 沒有快取才繼續等網路。網路失敗照舊改用快取（找不到就給首頁）。安裝、啟用、換版的流程不動
  const isNav = e.request.mode === 'navigate';
  const prev = isNav ? null : navModeFor(e);
  e.respondWith(caches.open(CACHE).then(async c => {
    const remember = mode => { if (!isNav) return; const v = { mode, t: Date.now() }; if (e.resultingClientId) NAV_MODE[e.resultingClientId] = v; NAV_MODE._last = v; };
    const offline = () => c.match(e.request, { ignoreSearch: true }).then(hit => hit || c.match('./index.html'));
    if (prev && prev.mode === 'cache') { // 網頁這次用的是快取：程式檔也用快取，一整套同一版（背景照樣抓新版存起來）
      const hit = await c.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; });
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      try { return await net; } catch (err) { return offline(); }
    }
    const net = fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; });
    let timer = null;
    const slow = new Promise(res => { timer = setTimeout(() => res(SLOW), isNav ? NET_TIMEOUT_MS : NET_TIMEOUT_SUB_MS); });
    try {
      const first = await Promise.race([net, slow]);
      if (first !== SLOW) { remember('net'); return first; }
      const hit = await c.match(e.request, { ignoreSearch: true });
      if (hit) { remember('cache'); e.waitUntil(net.catch(() => {})); return hit; } // 背景把新版抓完存起來，下次就是新的
      const r = await net; remember('net'); return r;
    } catch (err) {
      remember('cache');
      return offline();
    } finally { clearTimeout(timer); }
  }));
  // （0.4.91 拿掉原本永遠跑不到的「其他檔案先用快取」那段：if (true) 之後的死程式）
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
