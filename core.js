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
  /* 交易出錯時，真正的原因在「出錯的那一個讀寫要求」身上（事件的 target.error）。
     交易自己的 t.error 要等交易中止後才會有值，onerror 那一刻還是 null：
     原本直接傳 t.error，錯誤紀錄只能寫「同步：不明」（tomtom 2026-11-18 那筆，背景瀏覽器實測 onerror 當下 t.error=null）。（第28任） */
  const txErrOf = (t, ev) => t.error || (ev && ev.target && ev.target.error) || null;
  async function tx(store, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      // R18（GPT 03）：原本 fn 的承諾失敗沒人接——前面已寫的照樣提交、呼叫的人以為成功（寫一半）。
      // 改成：fn 同步丟出或承諾失敗 → 立刻中止交易（這個交易裡已寫的全部作廢），把錯誤傳出去
      let out, failed = null;
      const fail = e => { if (failed) return; failed = e || new Error('存檔失敗／သိမ်းဆည်းမှု မအောင်မြင်'); try { t.abort(); } catch (_) { /* 已經結束或中止 */ } };
      let p0;
      try { p0 = Promise.resolve(fn(s)); } catch (e) { p0 = Promise.reject(e); }
      p0.then(v => { out = v; }, fail);
      t.oncomplete = () => { db.close(); if (failed) reject(failed); else resolve(out); };
      t.onerror = ev => { db.close(); reject(failed || txErrOf(t, ev)); };
      // 手機空間不足時交易會被中止（abort），沒有這行畫面會一直卡在儲存中（2026-11-11 審查發現）
      t.onabort = () => { db.close(); reject(failed || t.error || new Error('存檔被中止／သိမ်းဆည်းမှု ရပ်ဆိုင်းသွားသည်')); };
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
      t.onerror = ev => { db.close(); reject(err || txErrOf(t, ev)); };
      t.onabort = () => { db.close(); reject(err || t.error || new Error('存檔被中止／သိမ်းဆည်းမှု ရပ်ဆိုင်းသွားသည်')); };
    });
  }

  /**
   * R22-02：這輪沒問到的臨時編號，把舊快取同一件（同 id）的對照併回來。
   * R23-05（GPT）：這輪**問過**的編號以後台答案為準（後台說它在哪一件就在哪一件，沒列就是沒有）→ 舊對照只留「這輪沒問到、新資料也沒有任何一件用著」的；
   * R23-04（GPT）：客戶 tempId 畫面都當單一編號用 → 不再串成好幾個，只在新資料是空的時候補回舊的那一個
   */
  function mergeTemps(k, list, prevList, askedSet) {
    if (!Array.isArray(prevList) || !prevList.length) return list;
    const asked = askedSet instanceof Set ? askedSet : new Set(), prev = {}, used = new Set();
    prevList.forEach(x => { if (x && x.id) prev[x.id] = x; });
    list.forEach(x => { if (!x) return; (k === 'trials' ? (Array.isArray(x.temps) ? x.temps : []) : [x.tempId]).forEach(t => { if (t) used.add(String(t)); }); });
    const keepOld = t => !!t && !asked.has(String(t)) && !used.has(String(t));
    return list.map(x => {
      const p = x && x.id && prev[x.id];
      if (!p) return x;
      if (k === 'trials') {
        const a = Array.isArray(x.temps) ? x.temps : [], add = (Array.isArray(p.temps) ? p.temps : []).filter(keepOld);
        return add.length ? Object.assign({}, x, { temps: a.concat(add) }) : x;
      }
      return !x.tempId && keepOld(p.tempId) ? Object.assign({}, x, { tempId: p.tempId }) : x;
    });
  }

  /**
   * R36-1／R37-1：結案查詢用到的所有資料的版本（後台資料版本、本機試作記號、暫存客戶、拜訪編號清單），在呼叫者的交易裡讀。
   * lookupVersion 和 saveVisit（存檔前比對）共用，兩邊算出來的一定是同一種格式
   */
  function readLookupVer(visits, meta, done, fail) {
    // R38-1（GPT）：後台沒給時間時 srvDataAt 不會變 → 多比一格 cacheRev（applyServer 每次寫快取都換新），放最後一格，前四格位置不變
    const out = [], keys = ['srvDataAt', 'localTrials', 'localCustomers'], pos = [0, 1, 2];
    keys.push('cacheRev'); pos.push(4);
    let left = keys.length + 1;
    const one = () => { if (--left === 0) done(JSON.stringify(out)); };
    keys.forEach((k, i) => { const r = meta.get(k); r.onsuccess = () => { out[pos[i]] = r.result || null; one(); }; r.onerror = () => fail(r.error); });
    const rv = visits.getAllKeys ? visits.getAllKeys() : visits.getAll();
    rv.onsuccess = () => { out[3] = (rv.result || []).map(x => (x && typeof x === 'object' ? x.id : x)).map(String).sort(); one(); };
    rv.onerror = () => fail(rv.error);
  }
  /** R38-1：每次寫後台快取換一個新記號（不靠後台時間、不靠手機時間是否往前；同一毫秒兩次也不同） */
  let cacheRevSeq = 0;
  function newCacheRev() { cacheRevSeq += 1; return Date.now().toString(36) + '.' + cacheRevSeq + '.' + Math.random().toString(36).slice(2, 10); }

  const Store = {
    putVisit: v => tx('visits', 'readwrite', s => reqP(s.put(v))),
    allVisits: () => tx('visits', 'readonly', s => reqP(s.getAll())),
    deleteVisit: id => tx('visits', 'readwrite', s => reqP(s.delete(id))),
    getVisit: id => tx('visits', 'readonly', s => reqP(s.get(id))),
    getMeta: k => tx('meta', 'readonly', s => reqP(s.get(k))),
    /** R35-1（GPT）：在同一個交易裡讀好幾個（一致的快照：中間不會插進別的寫入） */
    getMetaMany: keys => tx('meta', 'readonly', s => Promise.all(keys.map(k => reqP(s.get(k))))),
    /**
     * R36-1（GPT）：結案查詢用到的所有資料的版本，**在同一個交易裡**讀：後台資料版本、本機試作記號、暫存客戶，加上拜訪編號清單
     *   （查詢會看拜訪判斷舊暫存是誰的；同步清掉 7 天前的舊拜訪也算資料變了）。拜訪只讀編號（有 getAllKeys 就用，不載照片錄音）
     */
    lookupVersion: () => txBoth((visits, meta, setOut, fail) => readLookupVer(visits, meta, setOut, fail)),
    setMeta: (k, v) => tx('meta', 'readwrite', s => reqP(s.put(v, k))),
    /** 0.5.18 B2：快取記號（cacheRev）還是 rev 才寫 k（同一個交易比對、寫入）；回 true＝寫了、false＝中間有同步寫進新資料、沒寫 */
    setMetaIfRev: (k, v, rev) => tx('meta', 'readwrite', s => new Promise((resolve, reject) => {
      const r = s.get('cacheRev');
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        if ((r.result || null) !== (rev || null)) { resolve(false); return; }
        const w = s.put(v, k); w.onsuccess = () => resolve(true); w.onerror = () => reject(w.error);
      };
    })),
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
    /**
     * 0.5.25 T1（第21任抓BUG）：登入成功、但後台資料寫回手機失敗（多半是空間不足）時用。
     * 手機上那份後台資料（客戶、首頁、試作、任務、已結案、known）是別的帳號留下的 → 同一個交易裡整組刪掉、換快取記號，
     * 免得新登入的人看到上一位的首頁、任務，勾到上一位的任務。是同一個帳號的就不動（回 false）
     * 0525R2（第22任，GPT 0525R1-2 中）：opts.key 有給 → 同一個交易裡先看「目前登入」是不是發起清理的那次登入（金鑰、帳號都要一樣），
     *   不是（另一個分頁已經換人登入成功）就不動、回 'stale'，舊的登入程序不能清掉現在這個人的快取。
     * 0525R2（GPT 0525R1-1 高）：opts.onlyKnown → 開網頁時檢查用：只清「看得出是別人的」；看不出是誰的（舊版快取沒記帳號）不清，
     *   免得沒網路時一開網頁就把客戶清單清光
     */
    clearForeignCache: (account, opts) => tx('meta', 'readwrite', s => new Promise((resolve, reject) => {
      const o = opts || {};
      const rc = s.get('config');
      rc.onerror = () => reject(rc.error);
      rc.onsuccess = () => {
        const cfg = rc.result;
        if (o.key != null && !(cfg && cfg.deviceKey && cfg.deviceKey === o.key && String(cfg.account || '') === String(account || ''))) { resolve('stale'); return; }
        const rv = s.get('srvDataAt');
        rv.onerror = () => reject(rv.error);
        rv.onsuccess = () => {
          const pv = rv.result;
          const owner = pv && typeof pv === 'object' && pv.a ? String(pv.a) : '';
          if (owner && owner === String(account || '')) { resolve(false); return; }
          if (o.onlyKnown && !owner) { resolve(false); return; }
          try {
            ['farmers', 'endedMine', 'home', 'trials', 'tasks', 'known', 'srvDataAt'].forEach(k => { const d = s.delete(k); d.onerror = () => reject(d.error); });
            const wr = s.put(newCacheRev(), 'cacheRev'); wr.onerror = () => reject(wr.error);
          } catch (e) { reject(e); return; }
          resolve(true);
        };
      };
    })),
    applyServer: (sentKey, serverTime, entries, askedTemps, sentAt) => tx('meta', 'readwrite', s => new Promise((resolve, reject) => {
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
          // R24-2：「是不是舊後台」（srvOld）在這個交易裡判斷、寫——登入不同不寫（上面已擋）。
          // R25-1（GPT）：R24 用手機送出時間排先後，手機時間往回調就會設不進去 → 改用**後台時間**（不會被手機調）：
          //   舊後台的回應（沒有 known）一律設 true（保守：先停清理），記下當時的後台時間 srvOldAt＝max(這份的後台時間, 目前資料版本)；
          //   只有之後一份新後台回應、而且後台時間**比 srvOldAt 新**，才改回 false。最壞情況是清理多停一輪，不會在舊後台狀態下清
          const flag = typeof entries.srvOld === 'boolean' ? entries.srvOld : null;
          delete entries.srvOld;
          const writeFlag = done => {
            if (flag === null) { done(); return; }
            const ra = s.get('srvOldAt');
            ra.onerror = () => reject(ra.error);
            ra.onsuccess = () => {
              const pa = ra.result && typeof ra.result === 'object' ? Number(ra.result.t) || 0 : 0;
              try {
                if (flag === true) {
                  const w1 = s.put(true, 'srvOld'); w1.onerror = () => reject(w1.error);
                  const w2 = s.put({ k: sentKey, t: Math.max(st, prev, pa) }, 'srvOldAt'); w2.onerror = () => reject(w2.error);
                } else if (st && st > pa) {
                  const w1 = s.put(false, 'srvOld'); w1.onerror = () => reject(w1.error);
                }
              } catch (e) { reject(e); return; }
              done();
            };
          };
          if (prev && (!st || st <= prev)) {
            // R22 待確認：已有版本時，沒帶後台時間的回應也當舊的（分不出先後就不蓋資料）；R23-07：但舊後台的回應照樣要記 srvOld
            if (flag === true) writeFlag(() => resolve('stale')); else resolve('stale');
            return;
          } // R18（GPT 06）：同一毫秒的兩份也不蓋——先寫進來的留著（兩份都是那一刻讀的，不來回翻）
          // R22-02（GPT）：後台只回這輪問到的臨時編號（超過 500 個時輪流問）→ 沒問到的那幾件 temps／tempId 是空的，
          //   直接蓋掉會讓手機對不上自己的記號（結束的試作又顯示成進行中）。臨時編號對到哪一件正式資料是不會變的事實 →
          //   同一個交易裡把舊快取同一件（同 id）的臨時編號併回來
          //   上一份快取是同一次登入、或同一個帳號（R23-01：重新登入）寫的才併；換成別的帳號不把上一位的對照帶進來
          const sameOwner = pv && typeof pv === 'object' && (pv.k === sentKey || (!!pv.a && !!cfg.account && pv.a === cfg.account));
          const keep = sameOwner ? ['trials', 'farmers', 'endedMine'].filter(k => Array.isArray(entries[k])) : [];
          const askedSet = new Set(Array.isArray(askedTemps) ? askedTemps.map(String) : []);
          const old = {};
          const write = () => {
            try {
              keep.forEach(k => { entries[k] = mergeTemps(k, entries[k], old[k], askedSet); });
              Object.keys(entries).forEach(k => { const w = s.put(entries[k], k); w.onerror = () => reject(w.error); });
              { const wr = s.put(newCacheRev(), 'cacheRev'); wr.onerror = () => reject(wr.error); } // R38-1（GPT）：快取一改就換記號（同一個交易），結案存檔比對看得到
              if (st) { const w = s.put({ k: sentKey, t: st, a: cfg.account || '' }, 'srvDataAt'); w.onerror = () => reject(w.error); } // R23-01：一起記帳號（重新登入時判斷是不是同一位）
            } catch (e) { reject(e); return; }
            resolve(true);
          };
          const next = i => {
            if (i >= keep.length) { write(); return; }
            const r = s.get(keep[i]);
            r.onerror = () => reject(r.error);
            r.onsuccess = () => { old[keep[i]] = r.result; next(i + 1); };
          };
          writeFlag(() => next(0));
        };
      };
    })),
    /**
     * R24-1（GPT）：0.5.16 寫的版本紀錄 srvDataAt 沒有帳號（a）→ 同帳號重新登入時判斷不出「是同一位的快取」而不併對照。
     * 在登入資料還在的時候（開網頁、登出、登入失效、登入前），同一個交易確認版本紀錄是這把金鑰寫的，就補記這把金鑰的帳號
     */
    tagSrvOwner: () => tx('meta', 'readwrite', s => new Promise((resolve, reject) => {
      const rc = s.get('config'); rc.onerror = () => reject(rc.error);
      rc.onsuccess = () => {
        const cfg = rc.result, rv = s.get('srvDataAt'); rv.onerror = () => reject(rv.error);
        rv.onsuccess = () => {
          const pv = rv.result;
          if (pv && typeof pv === 'object' && !pv.a && cfg && cfg.deviceKey && cfg.account && pv.k === cfg.deviceKey) {
            const w = s.put(Object.assign({}, pv, { a: cfg.account }), 'srvDataAt'); w.onerror = () => reject(w.error);
            resolve(true); return;
          }
          resolve(false);
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
    // R37-1（GPT）：expectVer＝結案最後一次檢查時的資料版本（lookupVersion）；有給就在**同一個交易**裡重算比對，
    //   不一樣（檢查之後同步、清理改了資料）就整個不存，丟 code='STALE' 的錯，請業務確認後再存
    // 0523R1-1（GPT，第21任）：expectOwner＝這筆拜訪記在誰名下。也在**同一個交易**裡讀登入設定比對：
    //   現在有人登入、而且不是他（最後一次比對之後、確認視窗期間別的分頁換人）→ 整個不存，丟 code='OWNER'；沒有人登入照存（0.5.23 J5）
    saveVisit: (v, metaFns, expectVer, expectOwner) => txBoth((visits, meta, setOut, fail) => {
      const go = () => {
        visits.put(v);
        Object.keys(metaFns || {}).forEach(k => {
          const r = meta.get(k);
          r.onsuccess = () => { try { meta.put(metaFns[k](r.result), k); } catch (e) { fail(e); } };
        });
        setOut(true);
      };
      const verThenGo = () => {
        if (expectVer === undefined || expectVer === null) { go(); return; }
        readLookupVer(visits, meta, ver => {
          if (ver !== expectVer) { const e = new Error('結案檢查之後資料剛更新，這次沒有存／ပိတ်သိမ်းမှု စစ်ဆေးပြီးနောက် ဒေတာ အသစ်ပြောင်းသွား၍ ယခု မသိမ်းရသေးပါ'); e.code = 'STALE'; fail(e); return; }
          go();
        }, fail);
      };
      if (!expectOwner) { verThenGo(); return; }
      const rc = meta.get('config');
      rc.onerror = () => fail(rc.error);
      rc.onsuccess = () => {
        const c = rc.result;
        if (c && c.deviceKey && c.account && String(c.account) !== String(expectOwner)) {
          const e = new Error('換了別人登入，這次沒有存／အခြားသူ ဝင်ထား၍ ယခု မသိမ်းရသေးပါ');
          e.code = 'OWNER';
          e.account = String(c.account);
          fail(e);
          return;
        }
        verThenGo();
      };
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
  /** 第24任 必改第二批①：這支手機的程式版本（網頁：config.js 的 appVersion＋部署時寫的 appBuild；背景程式：sw.js 的 VERSION），後台只記不擋 */
  function clientVer() {
    const c = g.FARM_CONFIG || {};
    const build = c.appBuild || (typeof VERSION !== 'undefined' ? String(VERSION) : ''); // 背景程式裡沒有 FARM_CONFIG，用 sw.js 的版本戳記
    return [c.appVersion || '', build].filter(Boolean).join(' ').slice(0, 60);
  }
  async function post(url, payload) {
    if (payload && typeof payload === 'object' && !payload.clientVer) { const v = clientVer(); if (v) payload = Object.assign({}, payload, { clientVer: v }); } // 同步、上傳、登入都經過這裡
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
      try { return await res.json(); } catch (e) { const e2 = new Error('伺服器回應不是 JSON／ဆာဗာ အဖြေသည် JSON မဟုတ်ပါ'); e2.badResponse = true; throw e2; }
    } catch (e) {
      if (timedOut) { const e3 = new Error('逾時／အချိန်ကုန်'); e3.timeout = true; throw e3; }
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
    // R23-07：舊後台的回應（沒有 known）就算因為沒帶後台時間被當成舊的、整份不寫，也記下「連到舊後台」→ 清理先停
    // R24-2：這個旗標改在 applyServer 同一個交易寫（比登入、比送出時間），不在交易外補寫
    const r = await Store.applyServer(sentKey, data && data.serverTime, entries, data && data.askedTemps, sentAt);
    // 第28任：主管改好的畫面緬文（web/myfix.js；背景程式 sw.js 也載入這個檔，那裡沒有 FarmMyFix 就跳過）
    if (r === true && entries.options && typeof self !== 'undefined' && self.FarmMyFix) self.FarmMyFix.set(entries.options.myFixes || {}, true);
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
      return { left: await countLeft(), error: '任務打勾還沒送出（沒有網路），有網路會自動送／လုပ်ငန်း အမှန်ခြစ် မပို့ရသေးပါ (အင်တာနက် မရှိ)၊ အင်တာနက်ရလျှင် အလိုအလျောက် ပို့မည်' };
    }
    // uncertain＝請求可能已經到伺服器（斷線、逾時、回應壞掉）：標「結果未確認」，不能取消，下次重送由伺服器確認（GPT-6.1 R7-02）
    const clearSending = uncertain => updateTaskDone(list => list.map(t => (t.sending === now ? Object.assign({}, t, { sending: 0 }, uncertain ? { unconfirmed: true } : {}) : t)));
    let r;
    const revBefore = (await Store.getMeta('cacheRev')) || null; // 0.5.18 B2：送出前的快取記號（同步寫進新資料就會換）
    try { r = await post(cfg.gasUrl, { action: 'taskDone', deviceKey: cfg.deviceKey, done: sent }); }
    catch (e) { await clearSending(true); return { left: await countLeft(), error: '任務打勾送出後沒收到回覆，稍後自動重送確認／လုပ်ငန်း အမှန်ခြစ် ပို့ပြီး အဖြေ မရသေးပါ၊ နောက်မှ အလိုအလျောက် ထပ်စစ်ပေးမည်' }; }
    // 伺服器明確回錯誤（忙碌、登入失效）：這次沒有處理，但之前若是「未確認」照樣保留
    // 伺服器回錯誤：只有確定「沒有處理」的（忙碌、登入失效、格式錯）才解除、可以取消；
    // 伺服器出錯（SERVER）或不認得的錯誤，可能已經完成了一部分，一律標未確認（GPT-6.1 R8-03）
    if (!r || !r.ok) {
      const notProcessed = !!r && ['BUSY', 'BAD_LOGIN', 'BAD_REQUEST', 'BAD_ACTION'].indexOf(r.code) >= 0;
      await clearSending(!notProcessed);
      return { left: await countLeft(), error: (r && r.message) || '任務打勾還沒送出，稍後自動重送／လုပ်ငန်း အမှန်ခြစ် မပို့ရသေးပါ၊ နောက်မှ အလိုအလျောက် ပြန်ပို့မည်', code: r && r.code };
    }
    const got = new Set((r.done || []).concat(r.unknown || [])); // unknown：伺服器沒有這個任務，留著也送不出去
    const sentAt = {};
    sent.forEach(s => { sentAt[s.id] = s.at; });
    await updateTaskDone(list => list
      .filter(t => !(got.has(t.id) && t.at === sentAt[t.id] && t.sending === now)) // 只拿掉送出的那一次
      // 伺服器回成功卻沒確認的：解除送出中、留著下次再送，但標未確認（可能已經完成了，不能讓人取消；R8-03）
      .map(t => (t.sending === now ? Object.assign({}, t, { sending: 0, unconfirmed: true }) : t)));
    // 0.4.87 高1：送出後換了帳號就不寫上一位的任務
    // 0.5.18（抓BUG B2）：回應沒有後台時間、分不出新舊——送出途中同步已經寫進比較新的任務清單（快取記號換了）就不蓋，交給同步的那份；
    //   比對和寫入在同一個交易（setMetaIfRev）
    if (Array.isArray(r.tasks) && await sameLogin(cfg.deviceKey)) await Store.setMetaIfRev('tasks', r.tasks, revBefore);
    // 伺服器回成功、卻沒確認其中幾筆（或這次沒送完）：要回錯誤，背景同步才會再試（GPT-6.1 R7-04：原本 error 是空的，卡著沒人重送）
    const miss = sent.filter(s => !got.has(s.id)).length;
    const error = miss ? `有 ${miss} 個任務打勾伺服器沒確認，稍後自動重送／လုပ်ငန်း အမှန်ခြစ် ${miss} ခု ဆာဗာမှ အတည်မပြုရသေးပါ၊ နောက်မှ အလိုအလျောက် ပြန်ပို့မည်` : skipped ? `還有 ${skipped}`
      + ` 個任務打勾沒送，稍後自動送／မပို့ရသေးသော လုပ်ငန်း အမှန်ခြစ် ${skipped} ခု ကျန်သေးသည်၊ နောက်မှ အလိုအလျောက် ပို့မည်` : '';
    return { left: await countLeft(), error, ticksSent: sent.length - miss }; // 抓BUG第4輪 手機組1：這次後台確認了幾個打勾（syncNow 自動那次要看）
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
    if (blocked === 'sending') return { ok: false, sending: true, message: '這個打勾正在送出，不能取消；送出後主管那邊就是「完成」／ဤအမှန်ခြစ်ကို ပို့နေဆဲ၊ ပယ်ဖျက်၍ မရပါ။ ပို့ပြီးလျှင် မန်နေဂျာဘက်တွင် 「ပြီးပြီ」 ဖြစ်သွားမည်' }; // 0.4.94 中2 加緬文
    if (blocked) return { ok: false, unconfirmed: true, message: '上次送出沒收到回覆，主管那邊可能已經是「完成」；等連上網路確認後才知道，不能取消／ယခင်ပို့မှု အဖြေ မရသေးပါ၊ မန်နေဂျာဘက်တွင် 「ပြီးပြီ」 ဖြစ်နေနိုင်သည်။ အင်တာနက် ချိတ်ပြီး အတည်ပြုမှ သိရမည်၊ ပယ်ဖျက်၍ မရပါ' };
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
      try { photos.push({ data: await blobToBase64(p.blob), check: p.check || '', source: p.source || '相機', no: list.indexOf(p) + 1 }); } catch (e) { lost++; } // 抓BUG第9輪 後台組3（第28任）：帶這張原本是第幾張（no），中間有一張讀不到時後面的不往前移，重送時後台不會把別張當成已存過的舊檔
    }
    if (v.audio) { try { audio = await blobToBase64(v.audio); } catch (e) { audioLost = true; } }
    return { photos, audio, lost, audioLost };
  }

  const NEXT_TRY_MAX_MS = 30 * 60000; // 0.4.87 中2：失敗重試最多排 30 分鐘後（下面 Math.min(30, …) 分鐘），超過就是時間被調過
  const READ_FAIL_MAX = 3; // 0.4.87 中1：同一筆讀檔連續失敗幾次後，先把讀得到的送出去
  const LOGIN_LOST_MSG = '登入已失效，回首頁重新登入後會自動補傳／ဝင်ရောက်မှု သက်တမ်းကုန်၊ ပင်မစာမျက်နှာသို့ ပြန်သွားပြီး ပြန်ဝင်လျှင် အလိုအလျောက် တင်ပေးမည်'; // 0.4.91 中4
  const LOGIN_LOST_TAIL = '。沒上傳的資料還在手機裡，重新登入後會自動補傳。／ပြန်ဝင်ပြီးလျှင် ကျန်သော မှတ်တမ်း တင်မည်။'; // 0.5.19 A1：跟 app.js syncNow 給 onLoginExpired 的字一樣
  /** 0.5.19 A1（第18任抓BUG）：確認是同一把金鑰登入失效 → 記在手機裡（loginLost），這一輪停下；背景程式之後看到就不再用這把金鑰整包重送照片錄音（原本只有網頁打開時才記） */
  async function noteLoginLost(cfg, msg) { await Store.setMeta('loginLost', { key: cfg.deviceKey, msg: (msg || '登入已失效／ဝင်ရောက်မှု သက်တမ်းကုန်ပြီ') + LOGIN_LOST_TAIL }); }
  const SYNC_WARN = '同步資料寫回手機失敗（可能空間不足），稍後再同步／စင့်ခ်ဒေတာ ဖုန်းထဲ ပြန်သိမ်းမရပါ (နေရာ မလောက်ခြင်း ဖြစ်နိုင်)၊ နောက်မှ ထပ်စင့်ခ်လုပ်မည်'; // R12-01／R13-01
  const READ_FAIL_MSG = '有拜訪的照片或錄音暫時讀不到（是手機裡的檔案，不是網路問題），稍後自動再試；連續 3 次讀不到會先送文字和其他資料／ဓာတ်ပုံ သို့မဟုတ် အသံ ယာယီ ဖတ်မရသေးပါ (ဖုန်းထဲက ဖိုင်ပြဿနာ၊ အင်တာနက် မဟုတ်ပါ)၊ နောက်မှ ထပ်စမ်းမည်။ ၃ ကြိမ်ဆက်တိုက် မရလျှင် စာနှင့် အခြားဒေတာ အရင်ပို့မည်';
  let running = false;
  // 0.5.33（第23任抓BUG P1，小助手2）：上傳迴圈裡寫手機失敗（多半是空間不足）不能讓整輪中斷
  const STORE_FULL_MSG = '手機空間不足，上傳狀態存不進手機（已送到的後台都有收到），請清出空間／ဖုန်းထဲ နေရာ မလောက်၍ တင်ပြီးအခြေအနေ သိမ်းမရပါ (ပို့ပြီးသည်များ ဆာဗာ ရောက်ပြီး)၊ နေရာလွတ် လုပ်ပေးပါ';
  // 後台已收、「標已上傳」寫不進手機的：記在記憶體（id → 標記要用的欄位），之後每輪先補標、補標前不再重送（這個網頁或背景程式還開著就有效；關掉後重開會再送一次，後台用拜訪編號擋重複）
  const unmarked = new Map();
  // 「排晚點再試」寫不進手機的：記在記憶體的下次再試時間（id → nextTry），照樣不每分鐘整包重送
  const memNextTry = new Map();
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
      // 0.5.20 G3（第19任）：帶這位新客戶的拜訪全部被後台拒收（rejected，不會再送）→ 後台不會有這位，清掉（不然選單一直多一位）
      const mine = (ex.__visits || []).filter(v => v && v.farmerId === l.id);
      if (mine.length && mine.every(v => v.status === 'rejected')) return false;
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
        // 0520R3 H2（第19任）：結束那筆（或結案帶試作結果那筆）被後台拒收（rejected，不會再送）→ 這次結束不會成立，記號拿掉，試作回到進行中、業務可以再結束一次
        //   （那筆根本沒進後台，後台不會回 ended／release，原本永遠 hold）。還有待上傳的拜訪帶這件時上面已經留著
        const byV = by ? (ex.__visits || []).find(v => v && v.id === by) : null;
        if (byV && byV.status === 'rejected') return false;
        const ans = ex.known && ex.known.ends && ex.known.ends[l.id];
        if (ans && (ans.by || '') === by && (ans.a === 'ended' || ans.a === 'release')) return false;
        if (!by && srv && srv.held === false) return false; // R22-03（GPT）：held 是 null（後台讀不到結案分頁、不知道）就不清
        return true;
      }
      // 0.5.20 F1（第19任）：開始記號——帶它的那筆拜訪已上傳、後台回「試作沒收」（trialDropped：不是負責業務、編號對不上）→ 這件試作不會成立，清掉；
      //   不然畫面一直顯示一件進行中的幻影試作。只看「開始」那筆（op start、tempId 是這個記號），而且同一個記號沒有別筆還沒上傳的拜訪（上面已經擋）
      // 0.5.20 G2、G3（第19任）：同樣不會成立的還有：後台回「客戶不存在」（missingCustomer：主管刪了客戶，後台不建試作也不回 trialDropped）、
      //   那筆拜訪被後台拒收（rejected：格式錯，之後不會再送）。帶這個開始記號的拜訪「每一筆」都是這三種之一才清（有一筆正常上傳就等後台說）
      const starts = (ex.__visits || []).filter(v => v && v.trial && v.trial.op === 'start' && v.trial.tempId === l.id);
      const dropped = starts.length > 0 && starts.every(v => v.status === 'rejected' || (v.status === 'uploaded' && (v.trialDropped || v.missingCustomer)));
      return !(srv || knownHas(ex, 'trials', l.id) || dropped);
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
  async function buildAsk(visitsIn) {
    try {
      const lc = (await Store.getMeta('localCustomers')) || [], lt = (await Store.getMeta('localTrials')) || [];
      const cur = (await Store.getMeta('askCursor')) || {}, id = x => String(x), lid = l => String(l.id);
      // R21-02（GPT）：客戶暫存清掉後，還有待上傳拜訪、試作記號用著這個臨時編號 → 照樣要問（後台才會回它對到的正式客戶），不然對照會不見
      const allVisits = Array.isArray(visitsIn) ? visitsIn : ((await Store.allVisits()) || []); // R22 待確認：上傳時傳進這輪已讀好的拜訪，不每筆都重讀全部
      const cIds = new Set(lc.filter(l => l && l.id).map(l => String(l.id)));
      // 0526 H7（第21任）：被後台拒收的拜訪不會再送，不用為它問（原本 rejected 也算 → 暫存客戶清掉後每輪同步照樣問、永遠不停）
      allVisits.forEach(v => { if (v && v.status !== 'uploaded' && v.status !== 'rejected' && /^T_/.test(String(v.farmerId || ''))) cIds.add(String(v.farmerId)); });
      lt.forEach(l => { if (l && /^T_/.test(String(l.cid || ''))) cIds.add(String(l.cid)); });
      const c = askWindow([...cIds], id, cur.c);
      const t = askWindow(lt.filter(l => l && l.id && !l.ended).map(l => l.id), id, cur.t);
      const e = askWindow(lt.filter(l => l && l.id && l.ended), lid, cur.e);
      if (c.next || t.next || e.next || cur.c || cur.t || cur.e) await Store.setMeta('askCursor', { c: c.next, t: t.next, e: e.next });
      return { customers: c.part, trials: t.part, ends: e.part.map(l => ({ id: l.id, by: endByOf(l, allVisits) })) };
    } catch (e) { return { customers: [], trials: [], ends: [] }; } // 讀不到就不問（後台照樣回其他資料）
  }

  // R20（GPT 04）：新版後台只要手機有帶 ask，回應一定有 known；成功的回應卻沒有 known＝後台被單獨退回舊版 → 不猜、不清理暫存，提示管理員（手機網頁和後台要一起回退）
  const OLD_SRV_WARN = '後台版本比手機舊，暫存先不清；請管理員把手機網頁和後台一起更新或一起回退／ဆာဗာ ဗားရှင်းက ဖုန်းထက် ဟောင်းနေ၍ ယာယီမှတ်တမ်း မဖျက်သေးပါ။ စီမံသူကို ဖုန်းစာမျက်နှာနှင့် ဆာဗာ အတူတူ အပ်ဒိတ်လုပ်ခိုင်းပါ';
  const oldServer = data => !!(data && data.ok && !(data.known && typeof data.known === 'object'));

  /* runSyncInner 拆出來的（第15任 2026-11-14 董事長「拆 runSyncInner」）：挑要送的、讀照片錄音、組請求、錯誤訊息、標已上傳、排重試 */
  /**
   * 這輪要送的拜訪：還沒上傳、沒被拒、是這個帳號的（換人登入同一支手機時，避免記到別人名下）、不在等重試。
   * 伺服器一直收不了的那筆，越失敗越久才重試（1、2、4…最多 30 分鐘），不要每分鐘整包重送耗流量；但不放棄（第六輪自抓）
   * 0.4.87 中2：nextTry 比現在晚 30 分鐘以上（重試最多只排 30 分鐘後）＝手機時間曾被調快後又調回來，當作過期、照送（同任務打勾 isSending 的做法）
   */
  function syncTodo(all, cfg, now) {
    const waitRetry = v => !!(v.nextTry && v.nextTry > now && v.nextTry - now <= NEXT_TRY_MAX_MS);
    return all.filter(v => v.status !== 'uploaded' && v.status !== 'rejected' && !(v.account && cfg.account && v.account !== cfg.account) && !waitRetry(v));
  }
  /** 先送任務打勾（很小），結果記進 report：tickLeft（R6-04：背景同步看這個決定要不要再試）、error、code */
  async function syncTicksFirst(cfg, report) {
    const tk = await sendTaskTicks(cfg);
    report.tickLeft = tk.left;
    if (tk.error) report.error = tk.error;
    if (tk.ticksSent) report.ticksSent = tk.ticksSent;
    if (tk.code === 'BAD_LOGIN' && await sameLogin(cfg.deviceKey)) report.code = 'BAD_LOGIN'; // 0.4.87 高1：換人後上一位的登入失效不算
  }
  /** 已上傳超過 7 天的拜訪刪掉。R17：暫存清理改看後台的 known，不再靠已上傳的拜訪當憑據（R16 加的「被記號用到就不刪」拿掉，避免跟舊資料互鎖） */
  async function dropOldUploaded(all, now) {
    for (const v of all) {
      if (v.status === 'uploaded' && now - (v.uploadedAt || 0) > KEEP_UPLOADED_MS) await Store.deleteVisit(v.id);
    }
  }
  /** 退避：第 n 次失敗後 1、2、4…最多 30 分鐘再試 */
  const retryAt = n => Date.now() + Math.min(30, Math.pow(2, n - 1)) * 60000;
  const nextFail = cur => { const fails = (cur.fails || 0) + 1; return { fails, nextTry: retryAt(fails) }; };
  /**
   * 這筆排晚點再試（patchOf(cur) 回要改的欄位）。讀和寫在同一個交易（R7-03）；別的同步（網頁或背景程式）已經傳好、或已被拒的不動（G08）。
   * 回 true＝已經不用送了（別人傳好／被拒）
   */
  async function scheduleRetry(id, patchOf) {
    let already = false;
    await Store.updateVisit(id, cur => {
      if (!cur || cur.status === 'uploaded' || cur.status === 'rejected') { already = true; return null; }
      return Object.assign({}, cur, patchOf(cur));
    });
    return already;
  }
  /** 0.5.33 P1：寫手機失敗時記下來（不覆蓋已有的提示；有提示就不清暫存） */
  function noteStoreFull(report) {
    report.storeFull = true;
    if (!report.syncWarn) report.syncWarn = STORE_FULL_MSG;
  }
  /**
   * 0.5.33 P1：scheduleRetry 寫不進手機（空間不足）→ 不中斷整輪：下次再試時間改記在記憶體、跳過這筆。回 true＝已經不用送了
   */
  async function retryLater(v, patchOf, report) {
    try { const already = await scheduleRetry(v.id, patchOf); memNextTry.delete(v.id); return already; } catch (e) {
      noteStoreFull(report);
      const p = patchOf(v);
      if (p && p.nextTry) memNextTry.set(v.id, p.nextTry);
      return false;
    }
  }
  /** 0.5.33 P1：標已上傳要用的欄位（不留照片錄音內容，只留張數） */
  const markKeep = (data, media) => ({ data: { missingCustomer: data.missingCustomer, closingDropped: data.closingDropped, trialDropped: data.trialDropped }, media: { lost: media.lost || 0, audioLost: !!media.audioLost } });
  /**
   * 0.4.87 中1（第11任驗收改）：照片、錄音逐張讀；讀不到跟網路錯誤分開（原本當成沒網路整輪停住，後面全部卡住、也不能登出）：
   * ① 讀不到 → 這筆記讀檔失敗次數、照一般失敗排 nextTry，回 null（先送後面的筆；IndexedDB 讀 Blob 有時只是一時失敗）
   * ② 同一筆連續 READ_FAIL_MAX 次讀不到 → 送出讀得到的照片＋錄音（讀不到就空），其他欄位（打字、價格、結案、試作）照送，
   *    visit 帶 mediaLost {photos, audio}，打字內容後面附一句讓主管看得到。一張壞照片不能丟掉整筆資料
   * 回 { media, text, mediaLost }；會改 report（readFail、error、left）
   */
  async function readVisitMedia(v, report) {
    const media = await mediaPayload(v);
    let text = v.text || '', mediaLost = null;
    if (media.lost || media.audioLost) {
      const readFails = (v.readFails || 0) + 1;
      report.readFail = (report.readFail || 0) + 1;
      if (!report.error) report.error = READ_FAIL_MSG;
      if (readFails < READ_FAIL_MAX) {
        if (await retryLater(v, () => ({ readFails, readError: READ_FAIL_MSG, nextTry: retryAt(readFails) }), report)) report.left--;
        return null;
      }
      mediaLost = { photos: media.lost, audio: media.audioLost };
      text += (text ? '\n' : '') + '（' + [media.lost ? '手機照片 ' + media.lost + ' 張讀不到，沒傳' : '', media.audioLost ? '錄音讀不到，沒傳' : ''].filter(Boolean).join('；') + '）';
    } else if (v.readFails) {
      try { await Store.updateVisit(v.id, cur => (cur && cur.status !== 'uploaded' ? Object.assign({}, cur, { readFails: 0, readError: '' }) : null)); } catch (e) { noteStoreFull(report); } // 這次讀到了：連續失敗歸零（0.5.33 P1：寫不進去照送）
    }
    return { media, text, mediaLost };
  }
  /** 上傳一筆拜訪的請求內容（手機存的新欄位一定要加在這裡） */
  function visitPayload(cfg, v, text, mediaLost, media, ask) {
    return {
      action: 'visit',
      deviceKey: cfg.deviceKey,
      ask,
      visit: {
        id: v.id, farmerId: v.farmerId, tempName: v.tempName || '', category: v.category || '',
        profile: v.profile || null, text, prices: v.prices || [], trial: v.trial || null, trialRef: v.trialRef || '', closing: v.closing || null, // 結案（2026-11-12）：上傳一定要帶，漏了後台就收不到
        plantFailure: v.plantFailure || null, noMeet: v.noMeet || null, stage: v.stage || '', // 0.4.78 生長階段 // 0.4.39 第6任線上實測：0.4.33 種植失敗、0.4.38 沒拜訪原本漏送，後台收不到（手機存的新欄位一定要加在這裡）
        deviceTime: v.deviceTime, clockOffset: v.clockOffset || 0,
        photoRule: v.photoRule ? 1 : 0, // 第28任：存的時候照片必填已生效（後台一律檢查照片）
        lat: v.lat, lng: v.lng, accuracy: v.accuracy,
        mediaLost // 0.4.87 中1：讀不到沒傳的照片張數、錄音（後台不認也不會壞；沒有就是 null）
      },
      photos: media.photos,
      audio: media.audio,
      audioMime: v.audio && media.audio ? v.audio.type : ''
    };
  }
  /** 送出失敗的訊息：逾時／伺服器回應異常／沒有網路（0.4.94 中2 加緬文） */
  function postError(e) {
    return e.timeout ? '上傳逾時（網路太慢），稍後自動重送／အင်တာနက် နှေးသဖြင့် အချိန်ကုန်၊ နောက်မှ အလိုအလျောက် ထပ်တင်မည်'
      : e.badResponse ? '伺服器回應異常（可能是 Google 額度用完或部署設定），稍後自動重送；一直出現請告訴主管／ဆာဗာ အဖြေ မမှန်ပါ (Google ခွဲတမ်းကုန် သို့မဟုတ် ဆက်တင် ပြဿနာ ဖြစ်နိုင်)၊ နောက်မှ ထပ်တင်မည်။ ဆက်ဖြစ်နေလျှင် မန်နေဂျာကို ပြောပါ'
      : '沒有網路或連不上，稍後自動重送／အင်တာနက် မရှိ (သို့) ချိတ်မရ၊ နောက်မှ အလိုအလျောက် ထပ်တင်မည်';
  }
  /** 後台收了：標已上傳、把大檔清掉只留紀錄。寫回拜訪狀態一律在同一個交易裡讀最新的再改（R7-03）：已上傳的不會被降回待上傳或被拒 */
  async function markUploaded(v, data, media) {
    await Store.updateVisit(v.id, cur => {
      const x = Object.assign({}, cur || v, { status: 'uploaded', uploadedAt: Date.now(), photo: null, audio: null }); // 傳完就把大檔清掉，只留紀錄
      // 0.4.91 低4：清單上的照片張數扣掉讀不到、沒傳的；錄音沒傳就記下來（清單不再寫錄音秒數）
      if (Array.isArray(x.photos)) { x.photoCount = Math.max(0, x.photos.length - (media.lost || 0)); x.photos = []; }
      if (media.audioLost) x.audioLost = true;
      // 0.4.91 低4：後台回 missingCustomer（客戶被刪，結案、試作沒收）→ 記下來，清單那一筆標出來
      if (data.missingCustomer) x.missingCustomer = true;
      // 0.5.16 第1輪：後台說結案沒收（不是負責業務、已有一筆等主管確認…）→ 記下原因，清單那一筆標出來
      if (data.closingDropped) x.closingDropped = String(data.closingDropped).slice(0, 200);
      // 0.5.19 B1：後台說試作開始／結束沒收（不是負責業務、試作編號對不上）→ 記下原因，清單那一筆標出來
      if (data.trialDropped) x.trialDropped = String(data.trialDropped).slice(0, 200);
      delete x.nextTry;
      return x;
    });
  }

  /** 0.5.33 P1：後台已收的標「已上傳」；寫不進手機（空間不足）不中斷：記在記憶體、之後每輪補標，這輪接著送下一筆 */
  async function markSent(v, data, media, report) {
    try { await markUploaded(v, data, media); unmarked.delete(v.id); } catch (e) { unmarked.set(v.id, markKeep(data, media)); noteStoreFull(report); }
    memNextTry.delete(v.id);
  }
  /** 0.5.33 P1：上次標不上「已上傳」的先補標（不用網路）。回這輪不要再送的編號（補標成功的也算：all 是補標前讀的） */
  async function remarkUploaded(all, report) {
    const skip = new Set(unmarked.keys());
    for (const [id, m] of Array.from(unmarked)) {
      const v = all.find(x => x.id === id);
      if (!v) { unmarked.delete(id); continue; } // 拜訪已不在手機（例如登出清掉）：不補
      try { await markUploaded(v, m.data, m.media); unmarked.delete(id); } catch (e) { noteStoreFull(report); }
    }
    return skip;
  }
  /** 0.5.33 P1：排重試寫不進手機時，記在記憶體的下次再試時間還沒到（規則同 syncTodo） */
  const memWait = (v, now) => { const t = memNextTry.get(v.id); return !!(t && t > now && t - now <= NEXT_TRY_MAX_MS); };
  /** 這輪要送的：syncTodo，再扣掉 0.5.33 P1 上次標不上「已上傳」的（先補標，這輪不重送）、記憶體裡還在等重試的 */
  async function pickTodo(all, cfg, now, report) {
    const skip = await remarkUploaded(all, report);
    return syncTodo(all, cfg, now).filter(v => !skip.has(v.id) && !memWait(v, now));
  }

  /* 第26任 2026-11-18（老闆「把冗長的函數拆解」）：runSyncInner 80 行拆出「送出出錯」「收到回應」兩段，內容只搬位置；
     計數（連續逾時、連續伺服器失敗）和 break／continue 仍留在迴圈裡，兩個函式只回這筆的結果 */
  /** 拆自 runSyncInner：送出時出錯 → 'retried'（排了重試，這筆不算剩下）／'timeout'／'bad'（錯誤頁）／'stop'（沒網路，這輪先停） */
  async function onSendError(e, v, report) {
    report.error = postError(e);
    // 0.4.94 中3（第11任第五輪）：一筆大檔（長錄音＋多張照片）在慢網路逾時，原本 break → 後面的小筆全被它卡住，每次都從它重來。
    // 改成：這筆照一般失敗排 nextTry（退避 1、2、4…最多 30 分鐘），先送後面的；連續 2 筆都逾時多半是網路整個太慢，這輪先停（省流量）。後台用拜訪編號防重複：逾時那筆其實已收到的話，重送回成功，不會多一筆
    if (e.timeout) {
      if (await retryLater(v, nextFail, report)) { report.left--; return 'retried'; }
      return 'timeout';
    }
    if (e.badResponse) { if (await retryLater(v, nextFail, report)) { report.left--; return 'retried'; } return 'bad'; } // 0.5.33 P2：錯誤頁（非 JSON／HTTP 錯誤）原本跟沒網路一樣 break，同一筆每次錯誤頁就整個佇列卡住 → 比照伺服器處理失敗：排晚點再試、先送下一筆（連續 2 筆才停）
    return 'stop'; // 沒網路：這一輪先停，下次再從這筆開始
  }
  /** 拆自 runSyncInner：後台有回應 → 'done'（收了或確定收不了）／'retried'（排了重試）／'failed'（伺服器失敗、沒排到重試）／'stop'（登入失效、伺服器忙） */
  async function applyReply(v, data, media, sentAt, cfg, report) {
    // 0.4.87 高1：送出後換了帳號就整份丟掉（拜訪本身的上傳狀態照記）
    // 0.5.16 第2輪 中：寫回客戶清單、首頁等失敗（例如手機空間不足）時不能跳出整個上傳迴圈——後台已經收了，這筆照樣要標「已上傳」，不然每輪整包重送照片錄音
    // R12-01～R14-02：寫回失敗時暫存客戶、試作不會被清——清理改成看後台快取裡有沒有它（見 pruneLocalCustomers），寫回失敗快取就沒有它
    try { await rememberServer(data, sentAt, cfg.deviceKey); } catch (e) { report.syncWarn = SYNC_WARN; }
    if (!report.syncWarn && oldServer(data)) report.syncWarn = OLD_SRV_WARN; // R20（GPT 04）
    // 寫回拜訪狀態一律在同一個交易裡讀最新的再改（R7-03）：已上傳的不會被降回待上傳或被拒
    if (data && data.ok) {
      await markSent(v, data, media, report); // 0.5.33 P1：寫不進手機不中斷，見 markSent
      report.sent++; report.left--;
      return 'done';
    }
    if (data && data.code === 'BAD_LOGIN') {
      // 0.4.87 高1：上一位的金鑰被登出停用、回「登入失效」時，現在已經換人登入 → 不回 BAD_LOGIN（不然新帳號會被踢回登入頁）
      report.error = data.message; if (await sameLogin(cfg.deviceKey)) { report.code = 'BAD_LOGIN'; await noteLoginLost(cfg, data.message); } return 'stop'; // 資料留在手機，重新登入後會接著傳；0.5.19 A1 記下失效
    }
    if (data && (data.code === 'BAD_ID' || data.code === 'BAD_REQUEST')) {
      // 伺服器確定收不了的（格式錯）：標成被拒、留在手機，不再重送，也不擋後面的
      report.rejected = (report.rejected || 0) + 1; report.rejectMsg = data.message || data.code; // 第28任保哥式審查：原因要讓業務看到（畫面原本只寫「被拒，請洽主管」）
      try { await Store.updateVisit(v.id, cur => (cur && cur.status === 'uploaded' ? null : Object.assign({}, cur || v, { status: 'rejected', rejectReason: data.message || data.code }))); } catch (e) { noteStoreFull(report); } // 0.5.33 P1：寫不進去不中斷
      report.left--;
      return 'done';
    }
    if (data && data.code === 'BUSY') { report.error = data.message; return 'stop'; } // 伺服器忙，整批晚點再來
    // 其他錯誤（伺服器處理失敗）：這筆留著下次重送，先換下一筆，免得一筆壞資料卡住全部（2026-11-11 審查發現）。
    // 連續 2 筆都失敗，多半是伺服器整個出問題，就先停，省流量。
    // 別的同步（網頁或背景程式）已經傳好的，不要用舊的狀態蓋掉「已上傳」（G08）；讀和寫在同一個交易（R7-03，見 scheduleRetry）
    if (await retryLater(v, nextFail, report)) { report.left--; return 'retried'; }
    report.error = (data && data.message) || '伺服器沒有回應成功，稍後自動重送／ဆာဗာ မအောင်မြင်၊ နောက်မှ အလိုအလျောက် ထပ်တင်မည်'; // 0.4.94 中2 加緬文
    return 'failed';
  }
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
      await syncTicksFirst(cfg, report);
      if (report.code === 'BAD_LOGIN') { await noteLoginLost(cfg, report.error); return report; } // 0.5.19 A1：打勾已經回登入失效（同一把金鑰），不再送拜訪
      const all = (await Store.allVisits()).sort((a, b) => a.deviceTime - b.deviceTime);
      const now = Date.now();
      await dropOldUploaded(all, now);
      // 0.5.33 P1：後台已收、上次標不上「已上傳」的，先補標（不用網路）；補標前這一輪不再重送它
      const todo = await pickTodo(all, cfg, now, report); // 規則見 syncTodo（別的帳號不送、等重試的不送、時間被調過的照送）
      report.left = todo.length;
      let serverFails = 0;
      let timeouts = 0; // 0.4.94 中3：連續逾時幾筆（2 筆就先停）
      let pos = 0; // 0.4.98（第13任 手機6）：進度用「第幾筆」：原本用已送成功的筆數＋1，逾時、讀不到檔先跳過的那筆不算 → 畫面一直停在同一個數字
      for (const v of todo) {
        pos++;
        if (onProgress) onProgress({ id: v.id, index: pos, total: todo.length });
        const rd = await readVisitMedia(v, report);
        if (!rd) continue; // 讀不到、還沒到第 READ_FAIL_MAX 次：這筆晚點再試，先送下一筆
        const { media, text, mediaLost } = rd;
        const sentAt = Date.now(); let data;
        try {
          const ask = await buildAsk(all); // R19：問後台「我手機上這幾個暫存收到了沒」（後台只回答這些）
          data = await post(cfg.gasUrl, visitPayload(cfg, v, text, mediaLost, media, ask));
        } catch (e) {
          const k = await onSendError(e, v, report);
          if (k === 'stop' || (k === 'timeout' && ++timeouts >= 2) || (k === 'bad' && ++serverFails >= 2)) break;
          continue;
        }
        timeouts = 0; // 0.4.94 中3：有回應就重算連續逾時
        const k = await applyReply(v, data, media, sentAt, cfg, report);
        if (k === 'stop' || (k === 'failed' && ++serverFails >= 2)) break;
        if (k === 'retried' || k === 'failed') continue;
        serverFails = 0;
      }
      // R18（Gemini 2）：這一輪後台資料寫回手機失敗 → 不清理（清理規則本身只認後台明確說的，這裡再多一道保險）
      if (!report.syncWarn) { await pruneLocalCustomers(); await pruneLocalTrials(); }
      return report;
    } finally {
      running = false;
    }
  }

  /** 第25任 審查第二批：是不是 iPhone／iPad（app.js、voice.js 共用；原本寫 5 次，只有一處認得 iPadOS 13 起冒充 Mac 的 iPad → iPad 的定位、麥克風說明給成 Android 版） */
  function isIOS(ua) {
    const n = typeof navigator !== 'undefined' ? navigator : {};
    return /iphone|ipad|ipod/i.test(String(ua == null ? n.userAgent || '' : ua)) || (n.platform === 'MacIntel' && Number(n.maxTouchPoints) > 1);
  }
  g.FarmCore = { Store, runSync, post, rememberServer, sameLogin, pruneLocalCustomers, pruneLocalTrials, buildAsk, oldServer, OLD_SRV_WARN, updateTaskDone, untickTask, isSending, isLocked, SYNC_WARN, isIOS }; // sameLogin：0.4.87 給 app.js 判斷回應是不是現在這個帳號的
})(typeof self !== 'undefined' ? self : this);
