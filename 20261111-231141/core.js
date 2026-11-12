/* 打卡網頁和背景程式（sw.js）共用：手機裡的暫存區＋自動上傳。不能用 window，背景程式沒有它。 */
/* global self, indexedDB, fetch, FileReader */
(function (g) {
  const DB_NAME = 'farm-visit';
  const DB_VER = 1;
  const KEEP_UPLOADED_MS = 7 * 24 * 3600 * 1000; // 已上傳的留 7 天再刪，多一層保險

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('visits')) db.createObjectStore('visits', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function tx(store, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => { db.close(); resolve(out); };
      t.onerror = () => { db.close(); reject(t.error); };
      // 手機空間不足時交易會被中止（abort），沒有這行畫面會一直卡在儲存中（2026-11-11 審查發現）
      t.onabort = () => { db.close(); reject(t.error || new Error('存檔被中止')); };
    });
  }
  const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const Store = {
    putVisit: v => tx('visits', 'readwrite', s => reqP(s.put(v))),
    allVisits: () => tx('visits', 'readonly', s => reqP(s.getAll())),
    deleteVisit: id => tx('visits', 'readwrite', s => reqP(s.delete(id))),
    getVisit: id => tx('visits', 'readonly', s => reqP(s.get(id))),
    getMeta: k => tx('meta', 'readonly', s => reqP(s.get(k))),
    setMeta: (k, v) => tx('meta', 'readwrite', s => reqP(s.put(v, k)))
  };

  // 背景程式不一定有 FileReader，所以自己把位元組轉成 Base64
  async function blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  /**
   * 送一次請求。一定有時間上限：網路卡住（不回應也不斷線）時不能永遠等，否則「上傳中」一直佔著，
   * 之後所有自動上傳都不會跑（2026-11-11 第六輪自抓）。上限依資料大小放寬：90 秒起跳，每 16 KB 多 1 秒（慢網路照樣傳得完）。
   * 錯誤分三種：e.timeout（逾時）、e.badResponse（伺服器回的不是 JSON，例如 Google 錯誤頁、額度用完）、其他（沒有網路）。
   */
  async function post(url, payload) {
    const body = JSON.stringify(payload);
    const limit = g.SYNC_TEST_TIMEOUT_MS || Math.max(90000, 60000 + Math.round(body.length / 16384) * 1000);
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null, timedOut = false;
    if (ctrl) timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, limit);
    try {
      // 用 text/plain 送，瀏覽器才不會先發預檢請求（Apps Script 不回應預檢）
      const res = await fetch(url, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body,
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!res.ok) { const e = new Error('HTTP ' + res.status); e.badResponse = true; throw e; }
      try { return await res.json(); } catch (e) { const e2 = new Error('伺服器回應不是 JSON'); e2.badResponse = true; throw e2; }
    } catch (e) {
      if (timedOut) { const e3 = new Error('逾時'); e3.timeout = true; throw e3; }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function rememberServer(data, sentAt) {
    if (data && data.serverTime && Date.now() - sentAt <= 5000) {
      // 伺服器時間 − 手機時間（扣掉一半來回時間），之後離線打卡都用它校正。
      // 只用來回 5 秒內的回應：上傳大檔花很久時，「一半來回時間」的誤差會到好幾分鐘（第六輪自抓）
      const now = Date.now();
      const offset = Math.round(data.serverTime - (sentAt + now) / 2);
      await Store.setMeta('clockOffset', offset);
      await Store.setMeta('lastSync', now);
    }
    if (data && Array.isArray(data.farmers)) await Store.setMeta('farmers', data.farmers);
    if (data && data.options) await Store.setMeta('options', data.options);
    if (data && data.home) await Store.setMeta('home', Object.assign({ syncedAt: Date.now() }, data.home));
    if (data && Array.isArray(data.trials)) await Store.setMeta('trials', data.trials);
    if (data && Array.isArray(data.tasks)) await Store.setMeta('tasks', data.tasks);
  }

  /**
   * 農民任務的打勾：手機離線時先存在 taskDone，有網路時先送這個（很小），再送拜訪。
   * 伺服器回「收到」的才從清單拿掉；送的期間又勾了別條，重讀清單再拿，不會弄丟
   */
  async function sendTaskTicks(cfg) {
    const ticks = ((await Store.getMeta('taskDone')) || []).filter(t => !t.account || !cfg.account || t.account === cfg.account);
    if (!ticks.length) return;
    let r;
    try { r = await post(cfg.gasUrl, { action: 'taskDone', deviceKey: cfg.deviceKey, done: ticks.map(t => ({ id: t.id, at: t.at })) }); } catch (e) { return; } // 沒網路：下次再送
    if (!r || !r.ok) return;
    const got = new Set(r.done || []);
    await Store.setMeta('taskDone', ((await Store.getMeta('taskDone')) || []).filter(t => !got.has(t.id)));
    if (Array.isArray(r.tasks)) await Store.setMeta('tasks', r.tasks);
  }

  // 第 2 期一筆拜訪可以有多張照片：photos = [{ blob, check, source }]；第 1 期的舊資料只有 photo
  async function photosPayload(v) {
    const list = Array.isArray(v.photos) ? v.photos : (v.photo ? [{ blob: v.photo, check: v.photoCheck || '', source: '相機' }] : []);
    const out = [];
    for (const p of list) if (p && p.blob) out.push({ data: await blobToBase64(p.blob), check: p.check || '', source: p.source || '相機' });
    return out;
  }

  let running = false;
  /**
   * 把暫存區裡還沒上傳的拜訪，一筆一筆送出去。回傳 { sent, left, error }。
   * 網頁和背景程式（sw.js）各有自己的 running 變數，所以再用瀏覽器的 Web Locks 讓兩邊不會同時上傳同一批
   * （2026-11-11 另一家審查 R1-02；不支援 Web Locks 的舊瀏覽器照舊，後台本來就會擋重複）
   */
  async function runSync(onProgress) {
    const nav = g.navigator;
    if (nav && nav.locks && nav.locks.request) {
      return nav.locks.request('farm-sync', { ifAvailable: true }, lock => (lock ? runSyncInner(onProgress) : { busy: true }));
    }
    return runSyncInner(onProgress);
  }

  /** 上傳完，伺服器已經有的新客戶，就把手機裡的暫時資料拿掉（網頁和背景程式都會做） */
  async function pruneLocalCustomers() {
    const local = (await Store.getMeta('localCustomers')) || [];
    if (!local.length) return;
    const waiting = new Set((await Store.allVisits()).filter(v => v.status === 'pending').map(v => v.farmerId));
    const keep = local.filter(l => waiting.has(l.id));
    if (keep.length !== local.length) await Store.setMeta('localCustomers', keep);
  }

  /** 手機裡暫存的試作（還沒上傳的開始、已結束待上傳的）：對應的拜訪都傳完就拿掉 */
  async function pruneLocalTrials() {
    const local = (await Store.getMeta('localTrials')) || [];
    if (!local.length) return;
    const refs = new Set();
    (await Store.allVisits()).filter(v => v.status === 'pending' && v.trial).forEach(v => { refs.add(v.trial.tempId); refs.add(v.trial.id); });
    const keep = local.filter(l => refs.has(l.id));
    if (keep.length !== local.length) await Store.setMeta('localTrials', keep);
  }

  async function runSyncInner(onProgress) {
    if (running) return { busy: true };
    running = true;
    const report = { sent: 0, left: 0, error: '' };
    try {
      const cfg = await Store.getMeta('config');
      if (!cfg || !cfg.gasUrl || !cfg.deviceKey) return report;
      await sendTaskTicks(cfg);
      const all = (await Store.allVisits()).sort((a, b) => a.deviceTime - b.deviceTime);
      const now = Date.now();
      for (const v of all) {
        if (v.status === 'uploaded' && now - (v.uploadedAt || 0) > KEEP_UPLOADED_MS) await Store.deleteVisit(v.id);
      }
      // 別的帳號存的資料不用這個帳號送（換人登入同一支手機時，避免記到別人名下）
      // 伺服器一直收不了的那筆，越失敗越久才重試（1、2、4…最多 30 分鐘），不要每分鐘整包重送耗流量；但不放棄（第六輪自抓）
      const todo = all.filter(v => v.status !== 'uploaded' && v.status !== 'rejected' && !(v.account && cfg.account && v.account !== cfg.account) && !(v.nextTry && v.nextTry > now));
      report.left = todo.length;
      let serverFails = 0;
      for (const v of todo) {
        if (onProgress) onProgress({ id: v.id, index: report.sent + 1, total: todo.length });
        const sentAt = Date.now();
        let data;
        try {
          data = await post(cfg.gasUrl, {
            action: 'visit',
            deviceKey: cfg.deviceKey,
            visit: {
              id: v.id, farmerId: v.farmerId, tempName: v.tempName || '', category: v.category || '',
              profile: v.profile || null, text: v.text || '', prices: v.prices || [], trial: v.trial || null, trialRef: v.trialRef || '',
              deviceTime: v.deviceTime, clockOffset: v.clockOffset || 0,
              lat: v.lat, lng: v.lng, accuracy: v.accuracy
            },
            photos: await photosPayload(v),
            audio: v.audio ? await blobToBase64(v.audio) : '',
            audioMime: v.audio ? v.audio.type : ''
          });
        } catch (e) {
          report.error = e.timeout ? '上傳逾時（網路太慢），稍後自動重送'
            : e.badResponse ? '伺服器回應異常（可能是 Google 額度用完或部署設定），稍後自動重送；一直出現請告訴主管'
            : '沒有網路或連不上，稍後自動重送';
          break; // 這一輪先停，下次再從這筆開始
        }
        await rememberServer(data, sentAt);
        if (data && data.ok) {
          v.status = 'uploaded'; v.uploadedAt = Date.now(); v.photo = null; v.audio = null; // 傳完就把大檔清掉，只留紀錄
          if (Array.isArray(v.photos)) { v.photoCount = v.photos.length; v.photos = []; }
          await Store.putVisit(v);
          report.sent++; report.left--;
        } else if (data && data.code === 'BAD_LOGIN') {
          report.error = data.message; report.code = 'BAD_LOGIN'; break; // 資料留在手機，重新登入後會接著傳
        } else if (data && (data.code === 'BAD_ID' || data.code === 'BAD_REQUEST')) {
          // 伺服器確定收不了的（格式錯）：標成被拒、留在手機，不再重送，也不擋後面的
          v.status = 'rejected'; v.rejectReason = data.message || data.code;
          await Store.putVisit(v);
          report.left--;
        } else if (data && data.code === 'BUSY') {
          report.error = data.message; break; // 伺服器忙，整批晚點再來
        } else {
          // 其他錯誤（伺服器處理失敗）：這筆留著下次重送，先換下一筆，免得一筆壞資料卡住全部（2026-11-11 審查發現）。
          // 連續 2 筆都失敗，多半是伺服器整個出問題，就先停，省流量。
          // 寫回前再讀一次：如果別的同步（網頁或背景程式）已經傳好，不要用舊的狀態蓋掉「已上傳」（2026-11-11 GPT-6.1 審查 G08）
          const latest = await Store.getVisit(v.id);
          if (latest && latest.status === 'uploaded') { report.left--; continue; }
          v.fails = (v.fails || 0) + 1;
          v.nextTry = Date.now() + Math.min(30, Math.pow(2, v.fails - 1)) * 60000;
          await Store.putVisit(v);
          report.error = (data && data.message) || '伺服器沒有回應成功，稍後自動重送';
          if (++serverFails >= 2) break;
          continue;
        }
        serverFails = 0;
      }
      await pruneLocalCustomers();
      await pruneLocalTrials();
      return report;
    } finally {
      running = false;
    }
  }

  g.FarmCore = { Store, runSync, post, rememberServer, pruneLocalCustomers };
})(typeof self !== 'undefined' ? self : this);
