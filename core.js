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
      // R18（GPT 03）：原本 fn 的承諾失敗沒人接——前面已寫的照樣提交、呼叫的人以為成功（寫一半）。
      // 改成：fn 同步丟出或承諾失敗 → 立刻中止交易（這個交易裡已寫的全部作廢），把錯誤傳出去
      let out, failed = null;
      const fail = e => { if (failed) return; failed = e || new Error('存檔失敗'); try { t.abort(); } catch (_) { /* 已經結束或中止 */ } };
      let p0;
      try { p0 = Promise.resolve(fn(s)); } catch (e) { p0 = Promise.reject(e); }
      p0.then(v => { out = v; }, fail);
      t.oncomplete = () => { db.close(); if (failed) reject(failed); else resolve(out); };
      t.onerror = () => { db.close(); reject(failed || t.error); };
      // 手機空間不足時交易會被中止（abort），沒有這行畫面會一直卡在儲存中（2026-11-11 審查發現）
      t.onabort = () => { db.close(); reject(failed || t.error || new Error('存檔被中止')); };
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
     * R17-01／04／05（GPT 高、中）：後台資料整份寫進手機快取，在「同一個讀寫交易」裡做完：
     *   先讀登入資料——已登出、換了帳號（金鑰不同）就整份不寫，回 false；
     *   再讀上次寫入的後台資料版本（srvDataAt，後台讀資料前取的 serverTime）——這份比較舊（晚到的舊回應）就不寫，回 'stale'；
     *   都通過才把每一項寫進去並更新版本。比較和寫入不分開，換帳號、舊回應晚到、兩邊同時寫都不會蓋錯；任何一筆寫入失敗整個交易作廢（不會只寫一半）
     */
    applyServer: (sentKey, serverTime, entries) => tx('meta', 'readwrite', s => new Promise((resolve, reject) => {
      const rc = s.get('config');
      rc.onerror = () => reject(rc.error);
      rc.onsuccess = () => {
        const cfg = rc.result;
        if (!cfg || !cfg.deviceKey || cfg.deviceKey !== sentKey) { resolve(false); return; }
        const rv = s.get('srvDataAt');
        rv.onerror = () => reject(rv.error);
        rv.onsuccess = () => {
          // 版本跟帳號綁在一起（Gemini R17 待確認：換帳號後上一位的版本不能擋新帳號的資料）
          const pv = rv.result, prev = pv && typeof pv === 'object' && pv.k === sentKey ? Number(pv.t) || 0 : 0, st = Number(serverTime) || 0;
          if (st && prev && st <= prev) { resolve('stale'); return; } // R18（GPT 06）：同一毫秒的兩份也不蓋——先寫進來的留著（兩份都是那一刻讀的，不來回翻）
          try {
            Object.keys(entries).forEach(k => { const w = s.put(entries[k], k); w.onerror = () => reject(w.error); });
            if (st) { const w = s.put({ k: sentKey, t: st }, 'srvDataAt'); w.onerror = () => reject(w.error); }
          } catch (e) { reject(e); return; }
          resolve(true);
        };
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
    // R14-01／02：extra＝同一個交易裡一起讀的其他快取（例如 farmers、trials），交給 keep 第三個參數判斷——
    // 「後台快取裡有沒有它」跟清理在同一個交易，寫回失敗（快取沒有它）就自然留著，不靠另外存的旗標
    pruneByPending: (k, keep, extra) => txBoth((visits, meta, setOut, fail) => {
      const rv = visits.getAll();
      rv.onsuccess = () => {
        const pending = (rv.result || []).filter(x => x.status === 'pending');
        const keys = Array.isArray(extra) ? extra : [], ex = { __visits: rv.result || [] }; // R15：全部拜訪（含已上傳、uploadedAt）也給 keep 判斷
        const go = () => {
          const rm = meta.get(k);
          rm.onsuccess = () => {
            try {
              const local = rm.result || [];
              if (!local.length) return;
              const left = local.filter(l => keep(l, pending, ex));
              if (left.length !== local.length) meta.put(left, k);
              setOut(local.length - left.length);
            } catch (e) { fail(e); }
          };
        };
        if (!keys.length) { go(); return; }
        let n = keys.length;
        keys.forEach(x => { const r = meta.get(x); r.onsuccess = () => { ex[x] = r.result; if (--n === 0) go(); }; });
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
    const limit = g.SYNC_TEST_TIMEOUT_MS || Math.max(90000, 60000 + Math.round(body.length / 8192) * 1000); // 0.4.94 中3：照 64 kbps（每秒 8 KB）給時間，原本 16 KB（128 kbps）
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

  /**
   * sentKey：送出這個請求時用的裝置金鑰（0.4.87 第11任清單高1）。有給就先重讀登入資料：
   * 已經登出、換了別的帳號（金鑰不同）→ 整份回應丟掉，不寫客戶、首頁、任務、已結案（上一位晚到的回應不能蓋掉新帳號的資料）；回 false
   */
  async function rememberServer(data, sentAt, sentKey) {
    // 0.4.91 高1（第11任第三輪清單）：sentKey 改必填——原本省略＝不檢查，syncNow 抓資料那條沒帶，上一位晚到的回應照樣蓋掉新帳號；省略就拒寫並記 console
    if (sentKey === undefined || sentKey === null || sentKey === '') {
      try { if (g.console) g.console.warn('rememberServer 沒帶送出時的裝置金鑰，這份回應不寫入（0.4.91 高1）'); } catch (e) { /* 記不了也不影響 */ }
      return false;
    }
    const now0 = await Store.getMeta('config');
    if (!now0 || !now0.deviceKey || now0.deviceKey !== sentKey) return false;
    // 0.4.94 低4（第11任第五輪）：原本來回超過 5 秒就不校正，緬甸網路常常超過 → 一直沒校正。改成 60 秒內都校正（誤差最多約來回時間的一半），超過 60 秒才放棄
    // 0.4.98（第13任 手機5）：請求途中手機時間被往回調（自動對時、手動改時間）時來回時間會變負數，原本照樣用「一半來回時間」算 → 校正錯好幾分鐘到幾小時；來回時間 < 0 就這次不校正
    const rtt = Date.now() - sentAt;
    const entries = {};
    if (data && data.serverTime && rtt >= 0 && rtt <= 60000) {
      // 伺服器時間 − 手機時間（扣掉一半來回時間），之後離線打卡都用它校正。
      // （第六輪原本只用來回 5 秒內的回應，怕上傳大檔時「一半來回時間」誤差太大；0.4.94 放寬到 60 秒，誤差最多約 30 秒，比完全不校正好）
      // R19（GPT 06）：校正值也放進同一個交易（applyServer）——舊回應、換了帳號的回應整份不寫，校正值也不改
      const now = Date.now();
      entries.clockOffset = Math.round(data.serverTime - (sentAt + now) / 2);
      entries.lastSync = now;
    }
    // R17：客戶、已結案、選單、首頁、試作、任務、後台已收到的編號（known）在同一個交易裡一起寫（Store.applyServer：
    //   換了帳號不寫、比上次舊的回應不寫、任何一項寫入失敗整份作廢）。known 跟 farmers／trials 一定是同一份，清理暫存才靠得住
    if (data && Array.isArray(data.farmers)) entries.farmers = data.farmers;
    if (data && Array.isArray(data.endedMine)) entries.endedMine = data.endedMine; // 0.4.80 中3：自己負責、已結案的農民（只給種植資料分頁用；舊後台沒有就不動）
    if (data && data.options) entries.options = data.options;
    if (data && data.home) entries.home = Object.assign({ syncedAt: Date.now() }, data.home);
    if (data && Array.isArray(data.trials)) entries.trials = data.trials;
    if (data && Array.isArray(data.tasks)) entries.tasks = data.tasks;
    if (data && data.known && typeof data.known === 'object') entries.known = data.known;
    // R21-05（GPT）：記住「最近一份成功回應是不是舊後台」（沒有 known）——清理在同一個交易讀它，舊後台狀態下不清，沒有待上傳、不查後台的那一輪也一樣
    if (data && data.ok) entries.srvOld = !(data.known && typeof data.known === 'object');
    if (!Object.keys(entries).length) return true;
    const r = await Store.applyServer(sentKey, data && data.serverTime, entries);
    return r === true;
  }
  /** 0.4.87 高1：現在登入的還是送出時那把金鑰嗎（登出、換帳號就不是） */
  async function sameLogin(sentKey) {
    const cur = await Store.getMeta('config');
    return !!(cur && cur.deviceKey && cur.deviceKey === sentKey);
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
  // 送出時間在未來（手機時間之後被往回調）也當作過期：不然要卡到手機時間追上來，期間不送、不能取消、背景也不重試（自行審查 S6）
  const isSending = t => !!(t && t.sending && Date.now() - t.sending >= 0 && Date.now() - t.sending < SENDING_STALE_MS);
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
      // 上一次送出中被中斷（標記過期）：那次可能已經到伺服器，這次就算伺服器回忙碌也要維持「未確認」（R9-05）
      return Object.assign({}, t, { sending: now }, t.sending ? { unconfirmed: true } : {});
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
    if (Array.isArray(r.tasks) && await sameLogin(cfg.deviceKey)) await Store.setMeta('tasks', r.tasks); // 0.4.87 高1：送出後換了帳號就不寫上一位的任務
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
      // 上次送出沒收到回覆，伺服器可能已經完成（R7-02）；送出途中程式被關掉、送出中標記過期的也一樣（GPT-6.1 R9-05：原本過期就能取消）
      if (t.unconfirmed || t.sending) { blocked = 'unconfirmed'; return true; }
      return false;
    }));
    if (blocked === 'sending') return { ok: false, sending: true, message: '這個打勾正在送出，不能取消；送出後主管那邊就是「完成」／ပို့နေဆဲ၊ ပယ်ဖျက်၍ မရ' }; // 0.4.94 中2 加緬文
    if (blocked) return { ok: false, unconfirmed: true, message: '上次送出沒收到回覆，主管那邊可能已經是「完成」；等連上網路確認後才知道，不能取消／အဖြေ မရသေး၊ အင်တာနက် ချိတ်ပြီး အတည်ပြုမှ သိရမည်၊ ပယ်ဖျက်၍ မရ' };
    return { ok: true };
  }
  /** 畫面用：這個打勾現在不能取消（送出中，或上次送出結果未確認） */
  const isLocked = t => isSending(t) || !!(t && (t.unconfirmed || t.sending)); // 送出中標記過期（送出途中被中斷）＝結果未確認（R9-05）

  // 第 2 期一筆拜訪可以有多張照片：photos = [{ blob, check, source }]；第 1 期的舊資料只有 photo
  // 0.4.87 中1（第11任驗收改）：逐張讀，讀不到的那張記下來（lost），讀得到的照送；錄音一樣。不丟例外
  async function mediaPayload(v) {
    const list = Array.isArray(v.photos) ? v.photos : (v.photo ? [{ blob: v.photo, check: v.photoCheck || '', source: '相機' }] : []);
    const photos = [];
    let lost = 0, audio = '', audioLost = false;
    for (const p of list) {
      if (!p || !p.blob) continue;
      try { photos.push({ data: await blobToBase64(p.blob), check: p.check || '', source: p.source || '相機' }); } catch (e) { lost++; }
    }
    if (v.audio) { try { audio = await blobToBase64(v.audio); } catch (e) { audioLost = true; } }
    return { photos, audio, lost, audioLost };
  }

  const NEXT_TRY_MAX_MS = 30 * 60000; // 0.4.87 中2：失敗重試最多排 30 分鐘後（下面 Math.min(30, …) 分鐘），超過就是時間被調過
  const READ_FAIL_MAX = 3; // 0.4.87 中1：同一筆讀檔連續失敗幾次後，先把讀得到的送出去
  const LOGIN_LOST_MSG = '登入已失效，回首頁重新登入後會自動補傳／ပြန်ဝင်ပြီးလျှင် တင်မည်'; // 0.4.91 中4
  const SYNC_WARN = '同步資料寫回手機失敗（可能空間不足），稍後再同步／ဒေတာ မသိမ်းနိုင်၊ နောက်မှ ထပ်လုပ်မည်'; // R12-01／R13-01
  const READ_FAIL_MSG = '有拜訪的照片或錄音暫時讀不到（是手機裡的檔案，不是網路問題），稍後自動再試；連續 3 次讀不到會先送文字和其他資料／ဓာတ်ပုံ/အသံ ဖတ်မရသေးပါ၊ အင်တာနက် ပြဿနာ မဟုတ်ပါ';
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
  // 0.4.97（第12任 BUG 審查手機 3）：同一位還有拜訪沒傳成（0.4.95 起逾時排重試更常見）時，原本暫存客戶會留著；
  // 後台客戶清單已經有正式的他（帶回同一個臨時編號 tempId）→ 選單、月分工作進度同時出現兩個他、首頁多算 → 後台已有的就拿掉
  // （沒傳成的拜訪照舊用臨時編號送，後台會對到同一位；拜訪本身帶完整客戶資料，不靠這份暫存）
  // R17（GPT／Gemini）：R12～R16 用旗標、年齡、手機或後台時間「推論」後台收到了沒，每輪都有新破口。改成**後台直接說**（known），
  // 跟 farmers／trials 在同一個交易寫進快取（Store.applyServer），清理也在同一個交易讀它判斷——寫回失敗就讀到舊的 known，自然不會誤清。
  // R19（GPT 01）：R18 讓後台送全部編號，別的業務拿得到別人客戶的臨時編號（含建立者登入金鑰前 6 碼）、資料量也跟著全公司長大 →
  //   改成手機問（buildAsk：只問自己手機上還留著的）、後台只回答這些。答案都是「這個編號、這筆拜訪」的事實，留著舊的也不會錯。
  //   客戶：後台客戶快取有他的 tempId，或 known.customers 有他 → 清；有待上傳拜訪、或後台沒說收到 → 留著
  const knownHas = (ex, k, id) => !!(ex.known && Array.isArray(ex.known[k]) && ex.known[k].indexOf(id) >= 0);
  async function pruneLocalCustomers() {
    return Store.pruneByPending('localCustomers', (l, pending, ex) => {
      if (ex.srvOld === true) return true; // R21-05：最近連到的是舊後台 → 不清
      const srvTmp = new Set((ex.farmers || []).map(f => f && f.tempId).filter(Boolean));
      if (srvTmp.has(l.id)) return false;
      if (pending.some(v => v.farmerId === l.id)) return true;
      return !knownHas(ex, 'customers', l.id);
    }, ['farmers', 'known', 'srvOld']);
  }

  // 結束記號是哪筆拜訪結束／結案的：記號有 by 就用；舊記號沒有 by → 手機留著的拜訪裡，結束這件或結案帶這件試作結果的最新一筆
  const endVisitOf = (l, visits) => (visits || []).filter(v => v && ((v.trial && v.trial.op !== 'start' && v.trial.id === l.id) || (v.closing && v.closing.trialResult && v.closing.trialResult.id === l.id)))
    .sort((a, b) => (b.deviceTime || 0) - (a.deviceTime || 0) || String(b.id).localeCompare(String(a.id)))[0] || null;
  const endByOf = (l, visits) => l.by || (endVisitOf(l, visits) || {}).id || '';

  /** 手機裡暫存的試作（還沒上傳的開始、已結束待上傳的）：對應的拜訪都傳完、後台也說收到了才拿掉 */
  async function pruneLocalTrials() {
    // 0.4.97（第12任 BUG 審查手機 1）：結案時一起填試作結果（closing.trialResult）也會記「這件已結束」，原本只認 v.trial → 結案還沒傳上去，記號就被清掉，試作又變回進行中
    // 「開始」記號：後台試作快取（進行中）有它，或 known.trials 有它（後台收到了，含已結束的）→ 清；否則留著。
    // 「結束」記號只在後台**明確說**時拿掉（R18：快取寫入失敗、還是舊的都不能當成已結束）：
    //   known.ends[記號] 的 by 跟這個記號的 by 一樣，而且 a 是 ended（後台已結束）或 release（那筆拜訪收到了但結束沒成立：
    //   主管退回、後台拒收——R19 GPT 02 客戶改派時結案被拒收）→ 清
    //   舊記號、手機已經找不到那筆拜訪（上傳超過 7 天被刪）：後台進行中快取列它、又不是「結案待主管確認」（held）→ 結案一定沒成立 → 清
    //   其他（待主管確認、還沒收到、後續還沒做完）→ 留著蓋住
    const refs = l => v => (v.trial && (v.trial.tempId === l.id || v.trial.id === l.id)) || (v.closing && v.closing.trialResult && v.closing.trialResult.id === l.id);
    return Store.pruneByPending('localTrials', (l, pending, ex) => {
      if (ex.srvOld === true) return true; // R21-05：最近連到的是舊後台 → 不清
      if (pending.some(refs(l))) return true;
      const srv = (ex.trials || []).find(t => t && (t.id === l.id || (t.temps || []).indexOf(l.id) >= 0));
      if (l.ended) {
        const by = endByOf(l, ex.__visits);
        const ans = ex.known && ex.known.ends && ex.known.ends[l.id];
        if (ans && (ans.by || '') === by && (ans.a === 'ended' || ans.a === 'release')) return false;
        if (!by && srv && !srv.held) return false;
        return true;
      }
      return !(srv || knownHas(ex, 'trials', l.id));
    }, ['trials', 'known', 'srvOld']);
  }

  /** R19：要問後台的——手機上還留著的暫存客戶、試作開始記號、試作結束記號（帶是哪筆拜訪）。各最多 ASK_MAX 個 */
  // R20（GPT 03）：超過上限時原本永遠只問前 500 個，前面一直沒答案就輪不到後面 → 超過時從上次問到的地方接著問（輪流），每一個都輪得到
  const ASK_MAX = 500;
  // R21-04（GPT）：原本記「陣列位置」，清單前面刪一個、後面加一個，同一個記號會一直被跳過 → 改記「上次問到哪個編號」，照編號排序從它後面接著問（繞回開頭），每一個最多兩輪內一定問到
  function askWindow(list, keyOf, after) {
    if (list.length <= ASK_MAX) return { part: list, next: '' };
    const sorted = list.slice().sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
    let from = after ? sorted.findIndex(x => keyOf(x) > after) : 0;
    if (from < 0) from = 0;
    const part = [];
    for (let i = 0; i < ASK_MAX; i++) part.push(sorted[(from + i) % sorted.length]);
    return { part, next: keyOf(part[part.length - 1]) };
  }
  async function buildAsk() {
    try {
      const lc = (await Store.getMeta('localCustomers')) || [], lt = (await Store.getMeta('localTrials')) || [];
      const cur = (await Store.getMeta('askCursor')) || {}, id = x => String(x), lid = l => String(l.id);
      // R21-02（GPT）：客戶暫存清掉後，還有待上傳拜訪、試作記號用著這個臨時編號 → 照樣要問（後台才會回它對到的正式客戶），不然對照會不見
      const allVisits = (await Store.allVisits()) || [];
      const cIds = new Set(lc.filter(l => l && l.id).map(l => String(l.id)));
      allVisits.forEach(v => { if (v && v.status !== 'uploaded' && /^T_/.test(String(v.farmerId || ''))) cIds.add(String(v.farmerId)); });
      lt.forEach(l => { if (l && /^T_/.test(String(l.cid || ''))) cIds.add(String(l.cid)); });
      const c = askWindow([...cIds], id, cur.c);
      const t = askWindow(lt.filter(l => l && l.id && !l.ended).map(l => l.id), id, cur.t);
      const e = askWindow(lt.filter(l => l && l.id && l.ended), lid, cur.e);
      if (c.next || t.next || e.next || cur.c || cur.t || cur.e) await Store.setMeta('askCursor', { c: c.next, t: t.next, e: e.next });
      return { customers: c.part, trials: t.part, ends: e.part.map(l => ({ id: l.id, by: endByOf(l, allVisits) })) };
    } catch (e) { return { customers: [], trials: [], ends: [] }; } // 讀不到就不問（後台照樣回其他資料）
  }

  // R20（GPT 04）：新版後台只要手機有帶 ask，回應一定有 known；成功的回應卻沒有 known＝後台被單獨退回舊版 → 不猜、不清理暫存，提示管理員（手機網頁和後台要一起回退）
  const OLD_SRV_WARN = '後台版本比手機舊，暫存先不清；請管理員把手機網頁和後台一起更新或一起回退／ဆာဗာ ဗားရှင်း ဟောင်းနေသည်';
  const oldServer = data => !!(data && data.ok && !(data.known && typeof data.known === 'object'));

  async function runSyncInner(onProgress) {
    if (running) return { busy: true };
    running = true;
    const report = { sent: 0, left: 0, error: '', tickLeft: 0 };
    try {
      const cfg = await Store.getMeta('config');
      if (!cfg || !cfg.gasUrl || !cfg.deviceKey) return report;
      // 0.4.91 中4：打卡中登入失效、先保留表單的期間（loginLost 記的就是這把金鑰），不再用失效的金鑰整包重傳拜訪、打勾（網頁和背景程式都看這個）
      const lost = await Store.getMeta('loginLost');
      if (lost && lost.key === cfg.deviceKey) { report.error = LOGIN_LOST_MSG; report.code = 'LOGIN_LOST'; return report; }
      const tk = await sendTaskTicks(cfg);
      report.tickLeft = tk.left; // 還沒送出的任務打勾（R6-04：背景同步看這個決定要不要再試）
      if (tk.error) report.error = tk.error;
      if (tk.code === 'BAD_LOGIN' && await sameLogin(cfg.deviceKey)) report.code = 'BAD_LOGIN'; // 0.4.87 高1：換人後上一位的登入失效不算
      const all = (await Store.allVisits()).sort((a, b) => a.deviceTime - b.deviceTime);
      const now = Date.now();
      // R17：暫存清理改看後台的 known，不再靠已上傳的拜訪當憑據 → 已上傳 7 天照舊刪（R16 加的「被記號用到就不刪」拿掉，避免跟舊資料互鎖）
      for (const v of all) {
        if (v.status === 'uploaded' && now - (v.uploadedAt || 0) > KEEP_UPLOADED_MS) await Store.deleteVisit(v.id);
      }
      // 別的帳號存的資料不用這個帳號送（換人登入同一支手機時，避免記到別人名下）
      // 伺服器一直收不了的那筆，越失敗越久才重試（1、2、4…最多 30 分鐘），不要每分鐘整包重送耗流量；但不放棄（第六輪自抓）
      // 0.4.87 中2：nextTry 比現在晚 30 分鐘以上（重試最多只排 30 分鐘後）＝手機時間曾被調快後又調回來，當作過期、照送（同任務打勾 isSending 的做法）
      const waitRetry = v => !!(v.nextTry && v.nextTry > now && v.nextTry - now <= NEXT_TRY_MAX_MS);
      const todo = all.filter(v => v.status !== 'uploaded' && v.status !== 'rejected' && !(v.account && cfg.account && v.account !== cfg.account) && !waitRetry(v));
      report.left = todo.length;
      let serverFails = 0;
      let timeouts = 0; // 0.4.94 中3：連續逾時幾筆（2 筆就先停）
      let pos = 0; // 0.4.98（第13任 手機6）：進度用「第幾筆」：原本用已送成功的筆數＋1，逾時、讀不到檔先跳過的那筆不算 → 畫面一直停在同一個數字
      for (const v of todo) {
        pos++;
        if (onProgress) onProgress({ id: v.id, index: pos, total: todo.length });
        // 0.4.87 中1（第11任驗收改）：照片、錄音逐張讀；讀不到跟網路錯誤分開（原本當成沒網路整輪停住，後面全部卡住、也不能登出）：
        // ① 讀不到 → 這筆記讀檔失敗次數、照一般失敗排 nextTry，先送後面的筆（IndexedDB 讀 Blob 有時只是一時失敗）
        // ② 同一筆連續 READ_FAIL_MAX 次讀不到 → 送出讀得到的照片＋錄音（讀不到就空），其他欄位（打字、價格、結案、試作）照送，
        //    visit 帶 mediaLost {photos, audio}，打字內容後面附一句讓主管看得到。一張壞照片不能丟掉整筆資料
        const media = await mediaPayload(v);
        let text = v.text || '', mediaLost = null;
        if (media.lost || media.audioLost) {
          const readFails = (v.readFails || 0) + 1;
          report.readFail = (report.readFail || 0) + 1;
          if (!report.error) report.error = READ_FAIL_MSG;
          if (readFails < READ_FAIL_MAX) {
            let already = false;
            await Store.updateVisit(v.id, cur => {
              if (!cur || cur.status === 'uploaded' || cur.status === 'rejected') { already = true; return null; }
              return Object.assign({}, cur, { readFails, readError: READ_FAIL_MSG, nextTry: Date.now() + Math.min(30, Math.pow(2, readFails - 1)) * 60000 });
            });
            if (already) report.left--;
            continue; // 這筆晚點再試，先送下一筆
          }
          mediaLost = { photos: media.lost, audio: media.audioLost };
          text += (text ? '\n' : '') + '（' + [media.lost ? '手機照片 ' + media.lost + ' 張讀不到，沒傳' : '', media.audioLost ? '錄音讀不到，沒傳' : ''].filter(Boolean).join('；') + '）';
        } else if (v.readFails) {
          await Store.updateVisit(v.id, cur => (cur && cur.status !== 'uploaded' ? Object.assign({}, cur, { readFails: 0, readError: '' }) : null)); // 這次讀到了：連續失敗歸零
        }
        const photos = media.photos, audio = media.audio;
        const sentAt = Date.now();
        let data;
        try {
          data = await post(cfg.gasUrl, {
            action: 'visit',
            deviceKey: cfg.deviceKey,
            ask: await buildAsk(), // R19：問後台「我手機上這幾個暫存收到了沒」（後台只回答這些）
            visit: {
              id: v.id, farmerId: v.farmerId, tempName: v.tempName || '', category: v.category || '',
              profile: v.profile || null, text, prices: v.prices || [], trial: v.trial || null, trialRef: v.trialRef || '', closing: v.closing || null, // 結案（2026-11-12）：上傳一定要帶，漏了後台就收不到
              plantFailure: v.plantFailure || null, noMeet: v.noMeet || null, stage: v.stage || '', // 0.4.78 生長階段 // 0.4.39 第6任線上實測：0.4.33 種植失敗、0.4.38 沒拜訪原本漏送，後台收不到（手機存的新欄位一定要加在這裡）
              deviceTime: v.deviceTime, clockOffset: v.clockOffset || 0,
              lat: v.lat, lng: v.lng, accuracy: v.accuracy,
              mediaLost // 0.4.87 中1：讀不到沒傳的照片張數、錄音（後台不認也不會壞；沒有就是 null）
            },
            photos,
            audio,
            audioMime: v.audio && audio ? v.audio.type : ''
          });
        } catch (e) {
          report.error = e.timeout ? '上傳逾時（網路太慢），稍後自動重送／အင်တာနက် နှေးသဖြင့် အချိန်ကုန်၊ နောက်မှ အလိုအလျောက် ထပ်တင်မည်'
            : e.badResponse ? '伺服器回應異常（可能是 Google 額度用完或部署設定），稍後自動重送；一直出現請告訴主管／ဆာဗာ အဖြေ မမှန်၊ နောက်မှ ထပ်တင်မည်၊ ဆက်ဖြစ်နေလျှင် မန်နေဂျာကို ပြောပါ'
            : '沒有網路或連不上，稍後自動重送／အင်တာနက် မရှိ (သို့) ချိတ်မရ၊ နောက်မှ အလိုအလျောက် ထပ်တင်မည်'; // 0.4.94 中2 加緬文
          if (e.timeout) {
            // 0.4.94 中3（第11任第五輪）：一筆大檔（長錄音＋多張照片）在慢網路逾時，原本 break → 後面的小筆全被它卡住，每次都從它重來。
            // 改成：這筆照一般失敗排 nextTry（退避 1、2、4…最多 30 分鐘），先送後面的；連續 2 筆都逾時多半是網路整個太慢，這輪先停（省流量）。
            // 後台用拜訪編號防重複：逾時那筆其實已收到的話，重送回成功，不會多一筆
            let already = false;
            await Store.updateVisit(v.id, cur => {
              if (!cur || cur.status === 'uploaded' || cur.status === 'rejected') { already = true; return null; }
              const fails = (cur.fails || 0) + 1;
              return Object.assign({}, cur, { fails, nextTry: Date.now() + Math.min(30, Math.pow(2, fails - 1)) * 60000 });
            });
            if (already) { report.left--; continue; }
            if (++timeouts >= 2) break;
            continue;
          }
          break; // 沒網路、伺服器回應異常：這一輪先停，下次再從這筆開始
        }
        timeouts = 0; // 0.4.94 中3：有回應就重算連續逾時
        // 0.4.87 高1：送出後換了帳號就整份丟掉（拜訪本身的上傳狀態照記）
        // 0.5.16 第2輪 中：寫回客戶清單、首頁等失敗（例如手機空間不足）時不能跳出整個上傳迴圈——後台已經收了，這筆照樣要標「已上傳」，不然每輪整包重送照片錄音
        // R12-01～R14-02：寫回失敗時暫存客戶、試作不會被清——清理改成看後台快取裡有沒有它（見 pruneLocalCustomers），寫回失敗快取就沒有它
        try { await rememberServer(data, sentAt, cfg.deviceKey); } catch (e) { report.syncWarn = SYNC_WARN; }
        if (!report.syncWarn && oldServer(data)) report.syncWarn = OLD_SRV_WARN; // R20（GPT 04）
        // 寫回拜訪狀態一律在同一個交易裡讀最新的再改（R7-03）：已上傳的不會被降回待上傳或被拒
        if (data && data.ok) {
          await Store.updateVisit(v.id, cur => {
            const x = Object.assign({}, cur || v, { status: 'uploaded', uploadedAt: Date.now(), photo: null, audio: null }); // 傳完就把大檔清掉，只留紀錄
            // 0.4.91 低4：清單上的照片張數扣掉讀不到、沒傳的；錄音沒傳就記下來（清單不再寫錄音秒數）
            if (Array.isArray(x.photos)) { x.photoCount = Math.max(0, x.photos.length - (media.lost || 0)); x.photos = []; }
            if (media.audioLost) x.audioLost = true;
            // 0.4.91 低4：後台回 missingCustomer（客戶被刪，結案、試作沒收）→ 記下來，清單那一筆標出來
            if (data.missingCustomer) x.missingCustomer = true;
            // 0.5.16 第1輪：後台說結案沒收（不是負責業務、已有一筆等主管確認…）→ 記下原因，清單那一筆標出來
            if (data.closingDropped) x.closingDropped = String(data.closingDropped).slice(0, 200);
            delete x.nextTry;
            return x;
          });
          report.sent++; report.left--;
        } else if (data && data.code === 'BAD_LOGIN') {
          // 0.4.87 高1：上一位的金鑰被登出停用、回「登入失效」時，現在已經換人登入 → 不回 BAD_LOGIN（不然新帳號會被踢回登入頁）
          report.error = data.message; if (await sameLogin(cfg.deviceKey)) report.code = 'BAD_LOGIN'; break; // 資料留在手機，重新登入後會接著傳
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
          report.error = (data && data.message) || '伺服器沒有回應成功，稍後自動重送／ဆာဗာ မအောင်မြင်၊ နောက်မှ အလိုအလျောက် ထပ်တင်မည်'; // 0.4.94 中2 加緬文
          if (++serverFails >= 2) break;
          continue;
        }
        serverFails = 0;
      }
      // R18（Gemini 2）：這一輪後台資料寫回手機失敗 → 不清理（清理規則本身只認後台明確說的，這裡再多一道保險）
      if (!report.syncWarn) { await pruneLocalCustomers(); await pruneLocalTrials(); }
      return report;
    } finally {
      running = false;
    }
  }

  g.FarmCore = { Store, runSync, post, rememberServer, sameLogin, pruneLocalCustomers, pruneLocalTrials, buildAsk, oldServer, OLD_SRV_WARN, updateTaskDone, untickTask, isSending, isLocked, SYNC_WARN }; // sameLogin：0.4.87 給 app.js 判斷回應是不是現在這個帳號的
})(typeof self !== 'undefined' ? self : this);
