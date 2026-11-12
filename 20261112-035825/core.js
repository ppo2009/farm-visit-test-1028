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
     * 改一筆拜訪：讀和寫在同一個讀寫交易裡（GPT-6.1 R7-03）。fn(目前的資料) 回傳新資料；回 null 就不寫。
     * 原本失敗分支先 getVisit、再 putVisit 是兩個交易，中間別的執行環境寫了「已上傳」，會被舊資料蓋回「待上傳」
     */
    updateVisit: (id, fn) => tx('visits', 'readwrite', s => new Promise((resolve, reject) => {
      const r = s.get(id);
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        let next;
        try { next = fn(r.result); } catch (e) { reject(e); return; }
        if (!next) { resolve(null); return; }
        const w = s.put(next);
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
  const MAX_TICKS_PER_SEND = 50; // 後台一次最多處理 50 筆（taskDone_ 的 slice），兩邊要一起改
  async function sendTaskTicks(cfg) {
    const now = Date.now();
    let sent = [], skipped = 0;
    await updateTaskDone(list => list.map(t => {
      if (!mine(cfg)(t) || isSending(t)) return t; // 別的環境正在送的，不重複送
      if (sent.length >= MAX_TICKS_PER_SEND) { skipped++; return t; }
      sent.push({ id: t.id, at: t.at });
      return Object.assign({}, t, { sending: now });
    }));
    const countLeft = async () => ((await Store.getMeta('taskDone')) || []).filter(mine(cfg)).length;
    if (!sent.length) return { left: await countLeft(), error: '' };
    // 手機自己知道沒網路（飛航、沒訊號）：請求根本出不去，就不送，打勾照樣可以取消（R7-02 自我檢查：不然離線時每個打勾都會被鎖住不能改）
    if (g.navigator && g.navigator.onLine === false) {
      await updateTaskDone(list => list.map(t => (t.sending === now ? Object.assign({}, t, { sending: 0 }) : t)));
      return { left: await countLeft(), error: '任務打勾還沒送出（沒有網路），有網路會自動送' };
    }
    // uncertain＝請求可能已經到伺服器（斷線、逾時、回應壞掉）：標「結果未確認」，不能取消，下次重送由伺服器確認（GPT-6.1 R7-02）
    const clearSending = uncertain => updateTaskDone(list => list.map(t => (t.sending === now ? Object.assign({}, t, { sending: 0 }, uncertain ? { unconfirmed: true } : {}) : t)));
    let r;
    try { r = await post(cfg.gasUrl, { action: 'taskDone', deviceKey: cfg.deviceKey, done: sent }); }
    catch (e) { await clearSending(true); return { left: await countLeft(), error: '任務打勾送出後沒收到回覆，稍後自動重送確認' }; }
    // 伺服器明確回錯誤（忙碌、登入失效）：這次沒有處理，但之前若是「未確認」照樣保留
    // 伺服器回錯誤：只有確定「沒有處理」的（忙碌、登入失效、格式錯）才解除、可以取消；
    // 伺服器出錯（SERVER）或不認得的錯誤，可能已經完成了一部分，一律標未確認（GPT-6.1 R8-03）
    if (!r || !r.ok) {
      const notProcessed = !!r && ['BUSY', 'BAD_LOGIN', 'BAD_REQUEST', 'BAD_ACTION'].indexOf(r.code) >= 0;
      await clearSending(!notProcessed);
      return { left: await countLeft(), error: (r && r.message) || '任務打勾還沒送出，稍後自動重送', code: r && r.code };
    }
    const got = new Set((r.done || []).concat(r.unknown || [])); // unknown：伺服器沒有這個任務，留著也送不出去
    const sentAt = {};
    sent.forEach(s => { sentAt[s.id] = s.at; });
    await updateTaskDone(list => list
      .filter(t => !(got.has(t.id) && t.at === sentAt[t.id] && t.sending === now)) // 只拿掉送出的那一次
      // 伺服器回成功卻沒確認的：解除送出中、留著下次再送，但標未確認（可能已經完成了，不能讓人取消；R8-03）
      .map(t => (t.sending === now ? Object.assign({}, t, { sending: 0, unconfirmed: true }) : t)));
    if (Array.isArray(r.tasks)) await Store.setMeta('tasks', r.tasks);
    // 伺服器回成功、卻沒確認其中幾筆（或這次沒送完）：要回錯誤，背景同步才會再試（GPT-6.1 R7-04：原本 error 是空的，卡著沒人重送）
    const miss = sent.filter(s => !got.has(s.id)).length;
    const error = miss ? `有 ${miss} 個任務打勾伺服器沒確認，稍後自動重送` : skipped ? `還有 ${skipped} 個任務打勾沒送，稍後自動送` : '';
    return { left: await countLeft(), error };
  }

  /**
   * 取消一個還沒送出的打勾（手機畫面用）。正在送出中就不取消，回 { ok: false, sending: true }（R6-05）
   */
  async function untickTask(id) {
    let blocked = '';
    await updateTaskDone(list => list.filter(t => {
      if (t.id !== id) return true;
      if (isSending(t)) { blocked = 'sending'; return true; }
      if (t.unconfirmed) { blocked = 'unconfirmed'; return true; } // 上次送出沒收到回覆，伺服器可能已經完成（R7-02）
      return false;
    }));
    if (blocked === 'sending') return { ok: false, sending: true, message: '這個打勾正在送出，不能取消；送出後主管那邊就是「完成」' };
    if (blocked) return { ok: false, unconfirmed: true, message: '上次送出沒收到回覆，主管那邊可能已經是「完成」；等連上網路確認後才知道，不能取消' };
    return { ok: true };
  }
  /** 畫面用：這個打勾現在不能取消（送出中，或上次送出結果未確認） */
  const isLocked = t => isSending(t) || !!(t && t.unconfirmed);

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
              profile: v.profile || null, text: v.text || '', prices: v.prices || [], trial: v.trial || null, trialRef: v.trialRef || '', closing: v.closing || null, // 結案（2026-11-12）：上傳一定要帶，漏了後台就收不到
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
        // 寫回拜訪狀態一律在同一個交易裡讀最新的再改（R7-03）：已上傳的不會被降回待上傳或被拒
        if (data && data.ok) {
          await Store.updateVisit(v.id, cur => {
            const x = Object.assign({}, cur || v, { status: 'uploaded', uploadedAt: Date.now(), photo: null, audio: null }); // 傳完就把大檔清掉，只留紀錄
            if (Array.isArray(x.photos)) { x.photoCount = x.photos.length; x.photos = []; }
            delete x.nextTry;
            return x;
          });
          report.sent++; report.left--;
        } else if (data && data.code === 'BAD_LOGIN') {
          report.error = data.message; report.code = 'BAD_LOGIN'; break; // 資料留在手機，重新登入後會接著傳
        } else if (data && (data.code === 'BAD_ID' || data.code === 'BAD_REQUEST')) {
          // 伺服器確定收不了的（格式錯）：標成被拒、留在手機，不再重送，也不擋後面的
          await Store.updateVisit(v.id, cur => (cur && cur.status === 'uploaded' ? null : Object.assign({}, cur || v, { status: 'rejected', rejectReason: data.message || data.code })));
          report.left--;
        } else if (data && data.code === 'BUSY') {
          report.error = data.message; break; // 伺服器忙，整批晚點再來
        } else {
          // 其他錯誤（伺服器處理失敗）：這筆留著下次重送，先換下一筆，免得一筆壞資料卡住全部（2026-11-11 審查發現）。
          // 連續 2 筆都失敗，多半是伺服器整個出問題，就先停，省流量。
          // 別的同步（網頁或背景程式）已經傳好的，不要用舊的狀態蓋掉「已上傳」（G08）；讀和寫在同一個交易（R7-03：原本分兩個交易，中間仍會被插隊）
          let already = false;
          await Store.updateVisit(v.id, cur => {
            if (!cur || cur.status === 'uploaded' || cur.status === 'rejected') { already = true; return null; }
            const fails = (cur.fails || 0) + 1;
            return Object.assign({}, cur, { fails, nextTry: Date.now() + Math.min(30, Math.pow(2, fails - 1)) * 60000 });
          });
          if (already) { report.left--; continue; }
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

  g.FarmCore = { Store, runSync, post, rememberServer, pruneLocalCustomers, pruneLocalTrials, updateTaskDone, untickTask, isSending, isLocked };
})(typeof self !== 'undefined' ? self : this);
