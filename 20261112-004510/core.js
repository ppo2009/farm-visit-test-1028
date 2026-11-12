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

  /**
   * 「拜訪」和「手機暫存」兩個資料表放在同一個讀寫交易裡做（GPT-6.1 R6-02）：
   * fn(visits, meta, setOut, fail) 只能用回呼（不能 await），交易才不會中途自己提交。
   * 瀏覽器保證範圍重疊的讀寫交易一次只跑一個（網頁和背景程式之間也是）
   */
  async function txBoth(fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(['visits', 'meta'], 'readwrite');
      let out, err = null;
      try { fn(t.objectStore('visits'), t.objectStore('meta'), v => { out = v; }, e => { err = e; try { t.abort(); } catch (x) { /* 已經結束 */ } }); }
      catch (e) { err = e; try { t.abort(); } catch (x) { /* 已經結束 */ } }
      t.oncomplete = () => { db.close(); if (err) reject(err); else resolve(out); };
      t.onerror = () => { db.close(); reject(err || t.error); };
      t.onabort = () => { db.close(); reject(err || t.error || new Error('存檔被中止')); };
    });
  }

  const Store = {
    putVisit: v => tx('visits', 'readwrite', s => reqP(s.put(v))),
    allVisits: () => tx('visits', 'readonly', s => reqP(s.getAll())),
    deleteVisit: id => tx('visits', 'readwrite', s => reqP(s.delete(id))),
    getVisit: id => tx('visits', 'readonly', s => reqP(s.get(id))),
    getMeta: k => tx('meta', 'readonly', s => reqP(s.get(k))),
    setMeta: (k, v) => tx('meta', 'readwrite', s => reqP(s.put(v, k))),
    /**
     * 讀、改、寫在「同一個」讀寫交易裡做完。瀏覽器保證同一個資料表的讀寫交易一次只跑一個，
     * 網頁和背景程式（不同執行環境）也一樣，所以不會用舊清單蓋掉別人剛寫的（GPT-6.1 R5-03）。
     * 用回呼不用 await：交易在等 Promise 時可能自己提交掉，舊瀏覽器尤其如此
     */
    updateMeta: (k, fn) => tx('meta', 'readwrite', s => new Promise((resolve, reject) => {
      const r = s.get(k);
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        let next;
        try { next = fn(r.result); } catch (e) { reject(e); return; }
        const w = s.put(next, k);
        w.onsuccess = () => resolve(next);
        w.onerror = () => reject(w.error);
      };
    })),
    /**
     * 存一筆拜訪，同時改手機暫存清單（metaFns：{ 鍵: 舊清單 => 新清單 }，要同步函式），全部在同一個交易裡（R6-02）。
     * 原本先存拜訪、再分開讀寫 localCustomers／localTrials，背景清理夾在中間就會用舊清單蓋掉新客戶
     */
    saveVisit: (v, metaFns) => txBoth((visits, meta, setOut, fail) => {
      visits.put(v);
      Object.keys(metaFns || {}).forEach(k => {
        const r = meta.get(k);
        r.onsuccess = () => { try { meta.put(metaFns[k](r.result), k); } catch (e) { fail(e); } };
      });
      setOut(true);
    }),
    /**
     * 清理暫存清單：讀待上傳的拜訪、讀清單、留下 keep(項目, 待上傳拜訪) 為真的、寫回，全部在同一個交易裡（R6-02）
     */
    pruneByPending: (k, keep) => txBoth((visits, meta, setOut, fail) => {
      const rv = visits.getAll();
      rv.onsuccess = () => {
        const pending = (rv.result || []).filter(x => x.status === 'pending');
        const rm = meta.get(k);
        rm.onsuccess = () => {
          try {
            const local = rm.result || [];
            if (!local.length) return;
            const left = local.filter(l => keep(l, pending));
            if (left.length !== local.length) meta.put(left, k);
            setOut(local.length - left.length);
          } catch (e) { fail(e); }
        };
      };
    })
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
  /**
   * 改「任務打勾」清單一律走這裡（GPT-6.1 R4-03）。讀、改、寫放在同一個資料庫讀寫交易裡（Store.updateMeta），
   * 互斥靠資料庫本身，網頁和背景程式之間、有沒有 Web Locks 都成立（R5-03：原本沒有 Web Locks 時只在各自的環境裡排隊，跨環境會互蓋）。
   * fn 收到清單複本，回傳新清單；fn 要是同步函式（交易裡不能等別的事）
   */
  function updateTaskDone(fn) {
    return Store.updateMeta('taskDone', cur => fn((cur || []).slice()));
  }

  // 「送出中」的打勾超過這個時間還沒結果（例如背景程式被系統關掉），當作沒在送，允許取消、下次重送
  const SENDING_STALE_MS = 3 * 60 * 1000;
  const isSending = t => !!(t && t.sending && Date.now() - t.sending < SENDING_STALE_MS);
  const mine = cfg => t => !t.account || !cfg.account || t.account === cfg.account;

  /**
   * 送任務打勾。回傳 { left, error, code }：left＝送完後這個帳號還沒送出的打勾數（R6-04：要算進同步結果，背景同步才會再試）。
   * 送之前在清單上標「送出中」（記下送出時間），畫面就不給取消（R6-05：請求已經送出去，取消只刪手機那筆，後台照樣完成）。
   * 伺服器回「收到」時，只拿掉「送出的那一次」（任務編號＋打勾時間都一樣）；送出期間同一任務換成新的一次打勾，不會被舊回覆清掉（R6-05）
   */
  async function sendTaskTicks(cfg) {
    const now = Date.now();
    let sent = [];
    await updateTaskDone(list => list.map(t => {
      if (!mine(cfg)(t) || isSending(t)) return t; // 別的環境正在送的，不重複送
      sent.push({ id: t.id, at: t.at });
      return Object.assign({}, t, { sending: now });
    }));
    const countLeft = async () => ((await Store.getMeta('taskDone')) || []).filter(mine(cfg)).length;
    if (!sent.length) return { left: await countLeft(), error: '' };
    const clearSending = () => updateTaskDone(list => list.map(t => (t.sending === now ? Object.assign({}, t, { sending: 0 }) : t)));
    let r;
    try { r = await post(cfg.gasUrl, { action: 'taskDone', deviceKey: cfg.deviceKey, done: sent }); }
    catch (e) { await clearSending(); return { left: await countLeft(), error: '任務打勾還沒送出（沒有網路），稍後自動重送' }; }
    if (!r || !r.ok) { await clearSending(); return { left: await countLeft(), error: (r && r.message) || '任務打勾還沒送出，稍後自動重送', code: r && r.code }; }
    const got = new Set(r.done || []);
    const sentAt = {};
    sent.forEach(s => { sentAt[s.id] = s.at; });
    await updateTaskDone(list => list
      .filter(t => !(got.has(t.id) && t.at === sentAt[t.id] && t.sending === now)) // 只拿掉送出的那一次
      .map(t => (t.sending === now ? Object.assign({}, t, { sending: 0 }) : t)));  // 伺服器沒收的（例如任務已取消）解除送出中，留著下次再送
    if (Array.isArray(r.tasks)) await Store.setMeta('tasks', r.tasks);
    return { left: await countLeft(), error: '' };
  }

  /**
   * 取消一個還沒送出的打勾（手機畫面用）。正在送出中就不取消，回 { ok: false, sending: true }（R6-05）
   */
  async function untickTask(id) {
    let blocked = false;
    await updateTaskDone(list => list.filter(t => {
      if (t.id !== id) return true;
      if (isSending(t)) { blocked = true; return true; }
      return false;
    }));
    return blocked ? { ok: false, sending: true, message: '這個打勾正在送出，不能取消；送出後主管那邊就是「完成」' } : { ok: true };
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
  // 讀待上傳拜訪、讀清單、寫回都在同一個交易裡（R6-02：原本分三個交易，存新客戶夾在中間會被洗掉）
  function pruneLocalCustomers() {
    return Store.pruneByPending('localCustomers', (l, pending) => pending.some(v => v.farmerId === l.id));
  }

  /** 手機裡暫存的試作（還沒上傳的開始、已結束待上傳的）：對應的拜訪都傳完就拿掉 */
  function pruneLocalTrials() {
    return Store.pruneByPending('localTrials', (l, pending) => pending.some(v => v.trial && (v.trial.tempId === l.id || v.trial.id === l.id)));
  }

  async function runSyncInner(onProgress) {
    if (running) return { busy: true };
    running = true;
    const report = { sent: 0, left: 0, error: '', tickLeft: 0 };
    try {
      const cfg = await Store.getMeta('config');
      if (!cfg || !cfg.gasUrl || !cfg.deviceKey) return report;
      const tk = await sendTaskTicks(cfg);
      report.tickLeft = tk.left; // 還沒送出的任務打勾（R6-04：背景同步看這個決定要不要再試）
      if (tk.error) report.error = tk.error;
      if (tk.code === 'BAD_LOGIN') report.code = 'BAD_LOGIN';
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

  g.FarmCore = { Store, runSync, post, rememberServer, pruneLocalCustomers, pruneLocalTrials, updateTaskDone, untickTask, isSending };
})(typeof self !== 'undefined' ? self : this);
