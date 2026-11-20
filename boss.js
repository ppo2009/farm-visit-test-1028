/* 主管網頁：帳號密碼登入，從後台讀資料，畫出總覽、日曆、客戶履歷、地圖、紀錄表 */
/* global FARM_CONFIG */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /* 0.5.15 董事長「作物都要改成英文跟緬甸文」（0.5.13 只改了業務手機）：主管網頁客戶的作物也顯示「English／緬文」；對照表跟 app.js 同一份，試算表存的值照舊是中文 */
  const CROP_MY = { 番茄: 'ခရမ်းချဉ်သီး', 西瓜: 'ဖရဲသီး', 南瓜: 'ရွှေဖရုံသီး', 絲瓜: 'သပွတ်သီး', 茄子: 'ခရမ်းသီး', 苦瓜: 'ကြက်ဟင်းခါးသီး',
    辣椒: 'ငရုတ်သီး', 玉米: 'ပြောင်းဖူး', 花椰菜: 'ပန်းဂေါ်ဖီ', 青花菜: 'ပန်းဂေါ်ဖီစိမ်း', 洋香瓜: 'သခွားမွှေးသီး', 扁蒲: 'ဘူးသီး', 水稻: 'စပါး',
    高麗菜: 'ဂေါ်ဖီထုပ်' };
  const CROP_EN = { 番茄: 'Tomato', 西瓜: 'Watermelon', 南瓜: 'Pumpkin', 絲瓜: 'Luffa', 茄子: 'Eggplant', 苦瓜: 'Bitter gourd', 辣椒: 'Chili',
    玉米: 'Corn', 花椰菜: 'Cauliflower', 青花菜: 'Broccoli', 洋香瓜: 'Melon', 扁蒲: 'Bottle gourd', 水稻: 'Rice', 高麗菜: 'Cabbage' };
  const cropText = c => (CROP_MY[c] && !/[က-႟]/.test(c) ? `${CROP_EN[c] || c}／${CROP_MY[c]}` : c);
  /* 0.5.15 客戶「每月找 10 個農民（2/10）試作（0）推廣（2）一般（0）」：後台的新增農民目標有 parts 就多寫一行三類各幾位（跟業務手機同樣寫法）；舊後台沒有 parts 就不寫 */
  const planParts = x => (x && x.parts ? `<small class="sub planparts">${['試作農民', '推廣農民', '一般農民'].map(k => `${k.replace('農民', '')} ${esc(String(x.parts[k] || 0))}`).join('・')}</small>` : '');
  /** 備用網址（0.4.30）：跟業務頁同一份清單（config.js 的 mirrors），主管頁網址＝每個網址＋boss.html；設定留空就不顯示 */
  function renderMirrors() {
    const box = $('mirrors'), ul = $('mirrorList');
    if (!box || !ul) return;
    const list = (typeof FARM_CONFIG !== 'undefined' && Array.isArray(FARM_CONFIG.mirrors)) ? FARM_CONFIG.mirrors : [];
    box.hidden = !list.length;
    // Cloudflare 會把 /boss.html 自動轉成 /boss（0.4.30 實測），比對時兩邊都去掉 .html
    const norm = s => String(s).replace(/\.html$/, '');
    const here = norm(typeof location !== 'undefined' ? location.origin + location.pathname : '');
    ul.innerHTML = list.map(m => { const u = String(m.url).replace(/\/?$/, '/') + 'boss.html';
      return `<li><a href="${esc(u)}">${esc(u)}</a>${norm(u) === here ? '<span class="pill p-grn">現在用的</span>' : ''}</li>`; }).join('');
  }
  const DAY = 86400000;
  const s2d = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const d2s = d => d.toISOString().slice(0, 10);
  const addDays = (s, n) => d2s(new Date(s2d(s).getTime() + n * DAY));
  const md = s => { const d = s2d(s); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };

  const KEY_NAME = 'farm-boss-key';
  const MORE_TABS = ['progress', 'accounts', 'errors', 'myfix']; // 第24任 第七批：地圖、紀錄表、日曆改在「客戶」「拜訪」裡切換 // 第24任 必改第二批⑦：錯誤紀錄 // 收在「更多」底下的分頁（2026-11-12 規劃 C）

  /* ───── 主管網頁中文＋緬文（2026-11-12 董事長；緬文是示意，待校對）─────
     畫面畫好後掃一遍：文字剛好是下表的詞，就在後面補緬文（小字）；輸入框提示也補。不用改每一段畫面程式 */
  const BI = {
    '農戶拜訪總覽': 'လယ်ကွင်းသွားရောက်မှု အကျဉ်းချုပ်', '登入': 'ဝင်ရန်', '登出': 'ထွက်ရန်', '重新整理': 'ပြန်ဖွင့်', '開啟試算表': 'Sheet ဖွင့်',
    '總覽': 'အကျဉ်းချုပ်', '客戶': 'ဖောက်သည်', '日曆': 'ပြက္ခဒိန်', '試作報告': 'စမ်းသပ် အစီရင်ခံစာ', '農民任務': 'လယ်သမား လုပ်ငန်း', '更多 ▾': 'နောက်ထပ်',
    '工作進度明細': 'လုပ်ငန်း တိုးတက်မှု', '田區地圖': 'လယ်ကွက် မြေပုံ', '拜訪紀錄表': 'သွားရောက်မှု မှတ်တမ်း', '業務帳號': 'ဝန်ထမ်း အကောင့်',
    '逾期未回訪': 'ရက်ကျော် မသွားရသေး', '今天該回訪': 'ယနေ့ သွားရန်', '近 7 天拜訪次數': '၇ ရက်အတွင်း သွားရောက်မှု', '追蹤中的客戶': 'စောင့်ကြည့်ဆဲ ဖောက်သည်',
    '每位業務': 'ဝန်ထမ်း တစ်ဦးချင်း', '逾期': 'ရက်ကျော်', '最新拜訪': 'နောက်ဆုံး သွားရောက်မှု', '沒有': 'မရှိ', '各地區': 'ဒေသအလိုက်',
    '要注意的': 'သတိပြုရန်', '快採收待盯': 'ရိတ်သိမ်းခါနီး စောင့်ကြည့်ရန်',
    '全部客戶': 'ဖောက်သည် အားလုံး', '全部業務': 'ဝန်ထမ်း အားလုံး', '全部地區': 'ဒေသ အားလုံး', '全部類型': 'အမျိုးအစား အားလုံး', // 0.4.88 中2：「快採收待盯」的緬文是 0.4.82 示意待校對；註解原本寫在這四個詞條前面，把它們變成註解

    '全部結果': 'ရလဒ် အားလုံး', '全部類別': 'အမျိုးအစား အားလုံး',
    '農民': 'လယ်သမား', '一般農民': 'ပုံမှန် လယ်သမား', '試作農民': 'စမ်းသပ် လယ်သမား', '推廣農民': 'မြှင့်တင် လယ်သမား', /* 0.5.11 低F：三類農民的緬文（同手機 MINE_TYPES，待校對） */ '盤商': 'ကုန်သည်', '種子商': 'မျိုးစေ့ဆိုင်', '試作': 'စမ်းသပ်', '推廣': 'မြှင့်တင်', '農戶': 'ပုံမှန် လယ်သမား', '一般拜訪': 'ပုံမှန်သွားရောက်', '結案': 'ပိတ်သိမ်း',
    '系統': 'စနစ်', '達成': 'ပြည့်မီ', '進行中': 'လုပ်ဆောင်ဆဲ', '成功': 'အောင်မြင်', '失敗': 'မအောင်မြင်', '結束': 'ပြီးဆုံး', '取消': 'ပယ်ဖျက်', '完成': 'ပြီး', '停用': 'ပိတ်ထား',
    '編號': 'နံပါတ်', '類別': 'အမျိုးအစား', '品項': 'ပစ္စည်း', '期間': 'ကာလ', '結果': 'ရလဒ်', '量測': 'တိုင်းတာ', '報告': 'အစီရင်ခံ',
    '業務': 'ဝန်ထမ်း', '拜訪': 'သွားရောက်', '拜訪過的客戶': 'သွားခဲ့သော ဖောက်သည်', '新增客戶': 'ဖောက်သည်သစ်', '試作 開始／完成': 'စမ်းသပ် စ／ပြီး', '計劃達成': 'ပစ်မှတ် ပြည့်မီမှု',
    '地區': 'ဒေသ', '本月拜訪': 'ဤလ သွားရောက်', '進行中的試作': 'လုပ်ဆောင်ဆဲ စမ်းသပ်မှု', '拜訪時間': 'သွားသည့်အချိန်', '作物狀況': 'သီးနှံ အခြေအနေ', '問題': 'ပြဿနာ', '下一步': 'နောက်တစ်ဆင့်', '狀態': 'အခြေအနေ',
    '作物': 'သီးနှံ', '行情': 'ဈေးကွက်', '反應': 'တုံ့ပြန်မှု', '摘要': 'အနှစ်ချုပ်', '打字': 'စာ', '價格': 'ဈေးနှုန်း',
    '開通新的業務帳號': 'ဝန်ထမ်း အကောင့်သစ် ဖွင့်', '開通業務帳號': 'အကောင့် ဖွင့်', '重設密碼': 'စကားဝှက် ပြန်သတ်မှတ်', '我已經記下了': 'မှတ်ပြီးပြီ', '派給業務': 'ဝန်ထမ်းကို ပေး',
    '已拜訪': 'သွားပြီး', '預定回訪': 'သွားရန် စီစဉ်', '逾期（大圓點）': 'ရက်ကျော် (အစက်ကြီး)', '今天該去': 'ယနေ့ သွားရန်', '已排定': 'စီစဉ်ပြီး',
    '⬇ 下載 Word': 'Word ဒေါင်းလုဒ်', '⬇ 試作報告（Word）': '⬇ စမ်းသပ် အစီရင်ခံစာ (Word)', '⬇ 錄音報告 PDF（中文）': 'အသံ အစီရင်ခံစာ PDF (တရုတ်)', '⬇ 錄音報告 PDF（緬文）': 'အသံ အစီရင်ခံစာ PDF (မြန်မာ)', '▶ 聽原始錄音（緬甸語）': '▶ မူရင်းအသံ နားထောင် (မြန်မာဘာသာ)', '🔊 念中文摘要': 'တရုတ် အနှစ်ချုပ် ဖတ်',
    '田區導航 ↗': 'လမ်းညွှန်', '導航 ↗': 'လမ်းညွှန်', '用 Google 地圖導航 ↗': 'Google မြေပုံဖြင့် လမ်းညွှန် ↗', '最近 30 天完成或取消的': 'ရက် ၃၀ အတွင်း ပြီး/ပယ်ဖျက်', '沒有任務': 'လုပ်ငန်း မရှိ', '還沒有': 'မရှိသေး',
    // 總經理、主管匯報、我的任務（2026-11-12）
    '任務': 'လုပ်ငန်း', '主管匯報': 'မန်နေဂျာ အစီရင်ခံစာ', '我的任務': 'ကျွန်ုပ်၏ လုပ်ငန်း', '派出任務': 'လုပ်ငန်း ပေး', '主管': 'မန်နေဂျာ', '總經理': 'အထွေထွေမန်နေဂျာ',
    '寫匯報給總經理': 'အထွေထွေမန်နေဂျာထံ အစီရင်ခံစာ ရေး', '送出匯報': 'အစီရင်ခံစာ ပို့', '我送出的匯報': 'ကျွန်ုပ် ပို့ခဲ့သော အစီရင်ခံစာ', '全部匯報': 'အစီရင်ခံစာ အားလုံး',
    '未讀': 'မဖတ်ရသေး', '已回覆': 'ပြန်စာ ပေးပြီး', '回覆': 'ပြန်စာ', '送出回覆': 'ပြန်စာ ပို့', '總經理回覆': 'အထွေထွေမန်နေဂျာ ပြန်စာ', '系統附上的數字': 'စနစ် ကိန်းဂဏန်း',
    '開通新帳號': 'အကောင့်သစ် ဖွင့်', '開通帳號': 'အကောင့် ဖွင့်', '業務、主管帳號': 'ဝန်ထမ်း၊ မန်နေဂျာ အကောင့်', '完成了': 'ပြီးပြီ', '派給主管的任務': 'မန်နေဂျာထံ ပေးသော လုပ်ငန်း',
    '再送一次確認': 'ထပ်ပို့ပြီး အတည်ပြုပါ', '放棄確認、改成新的一份': 'အတည်ပြုခြင်း ရပ်ပြီး အသစ်တစ်စောင် ပြောင်းရေးမည်',
    // 0.4.94（第11任第五輪 4）主管第一天會按的鈕（緬文示意，待校對）
    '確認結案': 'ပိတ်သိမ်း အတည်ပြု', '退回（不結案）': 'ပြန်ပို့ (မပိတ်သိမ်း)', '派給主管': 'မန်နေဂျာကို ပေး', '取消任務': 'လုပ်ငန်း ပယ်ဖျက်',
    '啟用': 'ဖွင့်', '知道了': 'သိပြီ' // 「派給業務」「停用」上面已經有
  };
  const BI_PH = { '帳號': 'အကောင့်', '密碼': 'စကားဝှက်', '新密碼': 'စကားဝှက်အသစ်', '新密碼再輸入一次': 'စကားဝှက်အသစ် ထပ်ရိုက်ပါ', '搜尋全部客戶：名字、電話、編號、作物': 'ဖောက်သည်အားလုံး ရှာရန် - နာမည်၊ ဖုန်း၊ နံပါတ်၊ သီးနှံ' };
  function biDom(root) {
    if (!root || typeof document.createTreeWalker !== 'function') return; // 本機測試的假畫面沒有這個，略過
    const w = document.createTreeWalker(root, 4); // 4＝只走文字
    const hits = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.nodeValue.trim(), p = n.parentNode;
      if (!t || !BI[t] || !p || /^(SCRIPT|STYLE|TEXTAREA)$/.test(p.nodeName)) continue;
      if (n.nextSibling && n.nextSibling.classList && n.nextSibling.classList.contains('my')) continue; // 已經補過
      hits.push(n);
    }
    hits.forEach(n => {
      const my = BI[n.nodeValue.trim()];
      if (n.parentNode.nodeName === 'OPTION') { if (n.parentNode.hasAttribute('value')) n.nodeValue = n.nodeValue + '／' + my; return; } // 選項裡不能放小字，直接接在後面；沒有 value 的選項文字就是值，不能動
      const s = document.createElement('span'); s.className = 'my'; s.textContent = my;
      n.parentNode.insertBefore(s, n.nextSibling);
    });
    root.querySelectorAll('input[placeholder]').forEach(el => { const my = BI_PH[el.placeholder]; if (my) el.placeholder = el.placeholder + '／' + my; });
  }
  /** 這台裝置的識別碼：第一次用時隨機產生、只存在這台裝置（登出也不清）。登入時帶給後台，
      以前登入成功過的裝置，不會被外人亂猜密碼造成的鎖定擋住（第七輪 A-2）。存不了（無痕模式）就每次新產生 */
  function deviceId() {
    const K = 'farm-device-id';
    try { const old = localStorage.getItem(K); if (old && /^[A-Za-z0-9]{32}$/.test(old)) return old; } catch (e) { /* 存不了 */ }
    const a = new Uint8Array(16); crypto.getRandomValues(a);
    const id = Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(K, id); } catch (e) { /* 存不了 */ }
    return id;
  }
  const state = { key: null, data: null, tab: 'today', trial: null, photos: {}, audios: {}, mustChange: false,
    hist: {},        // 客戶完整履歷（總覽只帶最近 500 筆，點進客戶時另外拿）
    histReq: {},     // 正在拿的履歷
    histErr: {},     // 抓BUG第9輪 主管組2（第28任）：完整履歷沒讀到的原因（畫面要說「沒讀到」，不能說「還沒有拜訪紀錄」）
    rf: {},          // 試作報告篩選
    pm: '',          // 工作進度看哪個月
    prog: {},        // 各月份的工作進度（後台算好的）
    progReq: {},
    photoReq: {},    // 照片下載中的請求，同一張不重複下載
    areq: {},        // 0526 抓BUG C1（第23任）：錄音報告每筆拜訪的狀態 { busy, msg }；記在這裡，整頁重畫後按鈕照樣停用、訊息照樣在
    cf: { q: '', staff: '', area: '', type: '', show: 'attn' }, // 客戶頁的搜尋與篩選；預設只看要注意的（2026-11-12 規劃 B）
    grpOpen: {},     // 客戶頁各業務分組有沒有展開（使用者按過才記）
    moreOpen: false, // 「更多」分頁列有沒有打開
    renderGen: 0,    // 每畫一次加一，舊畫面的照片迴圈看到不同就停
    loadSeq: 0,      // 0.4.75（1號主管清單低5）：每次 load 加一，回來時不是最新那次就丟掉
    dataGen: 0 };    // 畫面資料被動作（確認結案、派任務、標已讀…）改過就加一：在那之前出發的 load 晚到時不採用，改重讀一次
  const STATE_INIT = Object.keys(state).reduce((m, k) => { m[k] = 1; return m; }, {}); // 第26任：一開始就有的欄位（登出時的保險用，見 logout）
  /** 動作回來的資料寫進畫面資料（一律走這裡，dataGen 才會加一） */
  function setData(patch) { Object.assign(state.data, patch); state.dataGen++; }
  // 登入後的金鑰記在這台電腦的瀏覽器裡（存不了就每次重新登入）
  const keyStore = {
    get() { try { return localStorage.getItem(KEY_NAME); } catch (e) { return null; } },
    set(v) { try { if (v) localStorage.setItem(KEY_NAME, v); else localStorage.removeItem(KEY_NAME); } catch (e) { /* 無痕模式存不了 */ } }
  };

  // 0.4.88 中4：請求一定有時間上限（網路卡住不回應也不斷線時，不能永遠白畫面）。照片、錄音、報告檔比較大，給 90 秒
  // 0.5.26 錄音報告：後台要請 Gemini 聽完錄音再做 PDF，給 170 秒（逾時的話後台照樣做完存檔，再按一次就直接拿到）
  const API_TIMEOUT_MS = 30000, API_FILE_TIMEOUT_MS = 90000, API_AREPORT_TIMEOUT_MS = 170000;
  async function api(payload) {
    const sentKey = state.key;
    const ms = payload.action === 'audioReport' ? API_AREPORT_TIMEOUT_MS : ['photo', 'audio', 'report'].indexOf(payload.action) >= 0 ? API_FILE_TIMEOUT_MS : API_TIMEOUT_MS;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    const timer = ctl ? setTimeout(() => { timedOut = true; ctl.abort(); }, (typeof window !== 'undefined' && window.BOSS_TEST_TIMEOUT_MS) || ms) : null;
    let data;
    try {
      const res = await fetch(FARM_CONFIG.gasUrl, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ deviceKey: sentKey }, payload)), signal: ctl ? ctl.signal : undefined
      });
      // 第26任：後台本身出錯（例如試算表服務故障）時回的是錯誤網頁、不是資料，原本解析失敗被說成「連不上伺服器，請確認網路」→ 分開說
      try { data = await res.json(); } catch (pe) {
        if (!pe || pe.name !== 'SyntaxError') throw pe; // 逾時、斷線照舊
        data = { ok: false, code: 'BAD_RESPONSE', message: '伺服器回應異常（狀態 ' + res.status + '），不是網路問題；請稍後再試，一直出現請看錯誤紀錄或告訴總經理' };
      }
    } catch (e) {
      if (timedOut) { const t = new Error('逾時'); t.timeout = true; throw t; }
      throw e;
    } finally { if (timer) clearTimeout(timer); }
    // 請求還在路上時登出或換了別人登入：這個回應是上一個人的，丟掉（不回來，呼叫的地方就不會把它寫進新的人的畫面）
    // （自行審查 S7：原本會把上一位的匯報清單蓋到新的人畫面上，或登出後 state.data 是 null 而出錯）
    if (payload.action !== 'login' && state.key !== sentKey) return new Promise(() => {});
    return data;
  }

  /* ───── 登入：主管帳號＋密碼 ───── */
  function showLogin(msg) {
    $('app').hidden = true; $('login').hidden = false;
    $('loginMsg').textContent = msg || '';
    $('loginMsg').className = msg ? 'sub err' : 'sub';
  }

  async function onLogin(ev) {
    ev.preventDefault();
    const payload = { action: 'login', role: '主管', account: $('acct').value.trim(), password: $('pw').value, deviceId: deviceId() };
    if (state.mustChange) {
      if ($('newPw').value.length < 6) { showLogin('新密碼至少 6 個字／စကားဝှက်အသစ် အနည်းဆုံး ၆ လုံး'); return; }
      if ($('newPw').value !== $('newPw2').value) { showLogin('兩次輸入的新密碼不一樣／စကားဝှက်နှစ်ခု မတူပါ'); return; }
      payload.newPassword = $('newPw').value;
    }
    $('loginMsg').textContent = '確認中…／စစ်ဆေးနေသည်'; $('loginMsg').className = 'sub';
    $('loginBtn').disabled = true;
    try {
      const r = await api(payload);
      if (r.code === 'MUST_CHANGE') { state.mustChange = true; state.mustChangeAcct = payload.account.toLowerCase(); $('newPwBox').hidden = false; $('loginMsg').textContent = r.message; return; }
      if (!r.ok) { showLogin(r.message || '登入失敗／ဝင်ရောက်မှု မအောင်မြင်'); return; }
      state.key = r.deviceKey; keyStore.set(r.deviceKey);
      ['pw', 'newPw', 'newPw2'].forEach(id => { $(id).value = ''; });
      state.mustChange = false; $('newPwBox').hidden = true;
      load();
    } catch (e) {
      showLogin('連不上伺服器，請確認網路後再試／ဆာဗာနှင့် ချိတ်မရပါ၊ အင်တာနက် စစ်ပြီး ထပ်စမ်းပါ');
    } finally {
      $('loginBtn').disabled = false;
    }
  }

  // 登出時把上一個人的畫面狀態全部清掉（同一台電腦換帳號：上一位打開的匯報、草稿、表單不能帶給下一位；
  // 2026-11-12 實測抓到：主管打開過的匯報，總經理一登入就自己展開、被標成已讀）
  // 總經理BUG(2號)低6：「要設定新密碼」只在登入成功時清，換帳號、登出都不清 → 下一個人被卡在改密碼欄
  function clearMustChange() {
    state.mustChange = false;
    const box = $('newPwBox'); if (box) box.hidden = true;
    ['newPw', 'newPw2'].forEach(id => { const e = $(id); if (e) e.value = ''; });
  }
  /** 0.4.80（2號第2任 0.4.79 清單低5）：登出也通知後台停用這把金鑰（跟業務手機同做法）。背景送、最多等 5 秒，失敗照樣登出（畫面先清，不卡住） */
  function serverLogout(key) {
    if (!key || typeof fetch !== 'function') return;
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 5000) : null;
      fetch(FARM_CONFIG.gasUrl, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'logout', deviceKey: key }), signal: ctl ? ctl.signal : undefined })
        .catch(() => {}).finally(() => { if (timer) clearTimeout(timer); });
    } catch (e) { /* 送不出去照樣登出 */ }
  }
  function logout() {
    serverLogout(state.key);
    state.key = null; keyStore.set(null); state.data = null;
    clearMustChange();
    // 讀取中標記與快取也清掉：換人後舊請求的回應會被丟掉（S7），標記不清就永遠是「讀取中」、新的人讀不到（第二輪自行審查 T5）
    Object.assign(state, { progReq: {}, histReq: {}, histErr: {}, photoReq: {}, prog: {}, hist: {}, photos: {}, audios: {}, areq: {}, cacheGen: (state.cacheGen || 0) + 1 }); // areq：登出後舊請求的回應會被丟掉，「正在做」要一起清，不然下一位登入按鈕一直停用
    Object.assign(state, { tab: 'today', trial: null, briefOpen: '', bf: null, replyDraft: {}, tf: null, af: null, newPw: null,
      taskMsg: '', briefMsg: '', acctMsg: '', moreOpen: false, cf: { q: '', staff: '', area: '', type: '', show: 'attn' },
      closeMsg: '', rf: {}, pm: '', grpOpen: {}, lastTab: '', replyRid: {}, loadedAt: 0, closeMsgSeq: 0 }); // 主管BUG#9：換人登入不留上一位的結案訊息、篩選、月份、展開狀態
    try { if (player) player.pause(); player = null; playingId = ''; playingBtn = null; } catch (e) { /* 還沒播過 */ }
    try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch (e) { /* 不支援朗讀 */ }
    // 第26任（保哥角度審查第 14 點）：登出原本靠上面幾行手動列欄位歸零，之後新增欄位忘了加就會留給下一位登入的人 →
    //   再加一道保險：一開始沒有、上面也沒歸零的欄位（執行中才長出來的）全部拿掉；計數器（防舊回應蓋新資料用的）留著
    const RESET_KEEP = ['dataGen', 'loadSeq', 'renderGen', 'cacheGen', 'closeMsgSeq', 'mustChangeAcct', 'errs', 'ef', 'errMsg', 'errsLoading', 'vstaff', 'onlyFlag', 'openCards', 'showTest', 'review', 'closeSending'];
    Object.keys(state).forEach(k => { if (!(k in STATE_INIT) && RESET_KEEP.indexOf(k) < 0 && ['progReq', 'histReq', 'photoReq', 'areq', 'briefOpen', 'bf', 'replyDraft', 'tf', 'af', 'newPw', 'taskMsg', 'briefMsg', 'acctMsg', 'moreOpen', 'cf', 'closeMsg', 'grpOpen', 'lastTab', 'replyRid', 'loadedAt'].indexOf(k) < 0) delete state[k]; });
    Object.assign(state, { errs: null, ef: undefined, errMsg: '', errsLoading: false, vstaff: '', onlyFlag: false, openCards: {}, showTest: false, review: null, closeSending: null }); // 第25任 審查④：錯誤紀錄、第七批的篩選和審核狀態也不留給下一位
    showLogin();
  }

  /** 0.4.88 中4：還沒有畫面（剛打開頁面自動讀取）時，顯示看得見的「讀取中」；失敗時同一塊顯示原因＋「重試」 */
  function showBoot(msg, failed) {
    const b = $('boot');
    if (!b) return;
    $('login').hidden = true; $('app').hidden = true; b.hidden = false;
    $('bootMsg').textContent = msg; $('bootMsg').className = failed ? 'sub err' : 'sub';
    $('bootRetry').hidden = !failed; $('bootLogin').hidden = !failed;
  }
  const hideBoot = () => { const b = $('boot'); if (b) b.hidden = true; };
  const mmToday = () => new Date(Date.now() + 390 * 60000).toISOString().slice(0, 10); // 緬甸日期（UTC+6:30）
  async function load() {
    if (!state.key) { hideBoot(); showLogin(); return; }
    $('loginMsg').textContent = '讀取中…／ဖတ်နေသည်';
    if (!state.data) showBoot('讀取中…／ဖတ်နေသည်…', false);
    else $('updated').textContent = '讀取中…／ဖတ်နေသည်';
    const seq = ++state.loadSeq, gen = state.dataGen;
    let data;
    try { data = await api({ action: 'boss' }); }
    catch (e) { data = { ok: false, code: 'NETWORK', message: e && e.timeout ? '伺服器超過 30 秒沒有回應（網路太慢或卡住），請按「重試」／ဆာဗာ စက္ကန့် ၃၀ ကျော် အဖြေ မပြန်ပါ (လိုင်းနှေး သို့မဟုတ် ရပ်နေ)၊ 「ထပ်စမ်း」 ကို နှိပ်ပါ' : '連不上伺服器，請確認網路後按「重試」／ဆာဗာနှင့် ချိတ်မရပါ၊ အင်တာနက် စစ်ပြီး 「ထပ်စမ်း」 ကို နှိပ်ပါ' }; }
    // 0.4.75（1號主管清單低5）：Apps Script 同時處理好幾個請求，回來順序不一定 → 不是最新那次的結果丟掉；
    // 出發後畫面資料被動作改過（例如剛確認結案）→ 這份可能是改之前的，不採用，重讀一次
    if (seq !== state.loadSeq) return;
    if (gen !== state.dataGen && state.data) { load(); return; }
    if (!data.ok) {
      if (data.code === 'BAD_LOGIN' || data.code === 'NOT_BOSS') { hideBoot(); logout(); showLogin(data.message || '登入失敗／ဝင်ရောက်မှု မအောင်မြင်'); return; }
      // 已經有畫面時，暫時的錯誤只顯示在上方，不要把人踢回登入頁
      if (state.data) { $('updated').textContent = '⚠ ' + (data.message || '更新失敗／အပ်ဒိတ် မအောင်မြင်') + '（顯示的是上次的資料，按「重新整理」再試）／（ယခင် ဒေတာ ပြနေသည်၊ 「ပြန်ဖွင့်」 နှိပ်ပြီး ထပ်စမ်းပါ）'; return; }
      if ($('boot')) { showBoot('⚠ ' + (data.message || '讀取失敗／ဖတ်ရှုမှု မအောင်မြင်'), true); return; } // 0.4.88 中4：原因＋重試
      showLogin(data.message || '讀取失敗／ဖတ်ရှုမှု မအောင်မြင်'); return;
    }
    hideBoot();
    // 0.5.24（第21任抓BUG）：連「正在拿」的標記一起換新、換世代：重讀前發出去的履歷／進度晚到就丟掉，重讀後馬上重拿（原本會被標記擋住、存進舊的）
    Object.assign(state, { hist: {}, prog: {}, histReq: {}, histErr: {}, progReq: {}, cacheGen: (state.cacheGen || 0) + 1 }); // 第28任：按「重新整理」也清掉「沒讀到」，重拿一次
    state.data = data;
    if (window.FarmMyFix) window.FarmMyFix.set(data.myFixes || {}, true); // 第28任：主管改好的畫面緬文
    state.loadedAt = Date.now(); // 0.4.88 低8：切回頁面時判斷要不要重讀
    if (seq > (state.closeMsgSeq || 0)) state.closeMsg = ''; // 0.4.88 低7：讀完新資料，上一次結案的提示清掉（按完確認緊接著那次重讀不清，才看得到「已確認結案」）
    // 0.4.88 低3：進度明細的月份不在最近 6 個月（例如頁面開著跨月）→ 改回本月
    if (state.pm && monthsBack(6).indexOf(state.pm) < 0) state.pm = '';
    // 客戶頁沒有指定客戶時，顯示篩選結果的第一位（custSelected），不再固定第一位客戶
    $('login').hidden = true; $('app').hidden = false;
    $('who').textContent = data.name + (data.role === '總經理' ? '（總經理／အထွေထွေမန်နေဂျာ）' : '（主管／မန်နေဂျာ）');
    // 總經理的帳號分頁管業務和主管（2026-11-12）；分頁名稱換掉後補一次緬文
    const accTab = document.querySelector('.tab[data-tab="accounts"]');
    if (accTab) { accTab.textContent = data.role === '總經理' ? '業務、主管帳號' : '業務帳號'; biDom(accTab.parentNode); }
    $('updated').textContent = (t => '更新於 ' + t + '（緬甸時間）／' + t + ' တွင် အပ်ဒိတ်လုပ်ပြီး (မြန်မာစံတော်ချိန်)')((() => { try { return new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Yangon' }); } catch (e) { return new Date(Date.now() + 6.5 * 3600000).toISOString().slice(11, 16); } })()); // 0.5.18 C8：原本用手機／電腦自己的時區，台灣看差一個半小時
    // 0.4.38 董事長：「開啟試算表」只有總經理有（後台只給總經理網址，主管拿到的是空的就藏起來）
    $('sheetLink').href = data.sheetUrl || '#';
    $('sheetLink').hidden = !(data.role === '總經理' && data.sheetUrl);
    render();
  }

  /* ───── 計算 ───── */
  const active = () => state.data.customers.filter(c => c.status !== '已結束' && c.status !== '暫停');
  // 主管BUG(2號)#8：暫停、已結束的客戶不算逾期／今天（原本地圖畫紅色大圓點、履歷寫逾期，跟總覽不一致）→ 'stop'，地圖畫灰色
  // 0.4.94（第11任第五輪 5）：剛拜訪、後台還沒處理完（最後拜訪日還沒更新）→ 算已回訪，總覽逾期數、逾期清單、客戶頁一致
  const dueState = c => (c.status === '已結束' || c.status === '暫停') ? 'stop' : !c.nextDue ? 'none' : visitingNow(c) ? 'ok' : c.nextDue < state.data.today ? 'late' : c.nextDue === state.data.today ? 'due' : 'ok';
  const visitsOf = id => (state.hist[id] || state.data.visits.filter(v => v.cid === id)).slice().sort((a, b) => b.time.localeCompare(a.time));
  /* 第27任 2026-11-18 董事長「主管的網頁第幾週還沒改成第幾天」：改成跟手機一樣，從客戶的種植日期算「種植第 N 天／作物生長天數」。
     沒填種植日期、日期在後面（還沒種）就不寫天數；量測提醒照試作開始日排，字也改成「試作第 N 天該量測」 */
  const cropDaysOf = crop => { const n = Number(((state.data && state.data.cropDays) || {})[String(crop || '').trim()]); return n > 0 ? n : 0; };
  const growDayOf = (c, date) => {
    const pd = String((c && c.plantDate) || '').slice(0, 10), d = String(date || '').slice(0, 10);
    if (!/^\d{4}-\d\d-\d\d$/.test(pd) || !/^\d{4}-\d\d-\d\d$/.test(d) || d < pd) return null;
    return Math.round((s2d(d) - s2d(pd)) / DAY);
  };
  /* 第27任 2026-11-18 董事長「主管設定業務顏色，業務分顏色主管才看得清楚」：每位業務一個顏色（帳號頁選；沒選的自動從色票配，不跟別人重複）。
     名字前面加一個色點（名字照樣寫，不只靠顏色）；日曆行程、客戶分組、業務卡片也帶色點 */
  const STAFF_COLORS_DEF = ['#1f6fb4', '#d62728', '#2a9d3a', '#8e44ad', '#e67e22', '#0e9aa7', '#8c564b', '#d63384', '#556b2f', '#b8860b', '#34495e', '#c0392b'];
  let scCache = { d: null, gen: -1, m: {} };
  function staffColorMap() {
    if (scCache.d === state.data && scCache.gen === state.dataGen) return scCache.m;
    const d = state.data || {}, set = d.staffColors || {}, pal = (d.colorChoices && d.colorChoices.length ? d.colorChoices : STAFF_COLORS_DEF);
    // 抓BUG第7輪 主管組1：原本按帳號排序、依名次從「沒被手選的色」挑 → 手選一位或新開帳號，其他自動配色的人全部換色。
    //   改成穩定：照試算表帳號列的順序（新帳號排最後），每人從「帳號算出的起點」往後找第一個沒被手選、也沒被前面的人配走的色；只有撞到的人會移
    const people = [];
    (d.salesAccounts || []).concat(d.staffList || []).forEach(x => {
      const acct = String(x.account || '').toLowerCase();
      if (x.name && acct && x.role !== '主管' && !people.some(p => p.acct === acct)) people.push({ acct, name: String(x.name) });
    });
    const used = new Set(Object.values(set)), m = {};
    const start = acct => { let h = 0; for (let k = 0; k < acct.length; k++) h = (h * 31 + acct.charCodeAt(k)) % 9973; return h % pal.length; };
    people.forEach(p => {
      let c = set[p.acct];
      if (!c) { const s0 = start(p.acct); for (let k = 0; k < pal.length && !c; k++) { const x = pal[(s0 + k) % pal.length]; if (!used.has(x)) c = x; } c = c || pal[s0]; used.add(c); }
      // 抓BUG第7輪 主管組3：同名（試算表手改姓名）時名字只能對到一位；帳號頁改用 '@帳號' 查，不受影響
      if (!(p.name in m)) m[p.name] = c; m['@' + p.acct] = c;
    });
    scCache = { d: state.data, gen: state.dataGen, m };
    return m;
  }
  const staffColorOf = name => staffColorMap()[String(name || '')] || '';
  const sdot = name => { const c = staffColorOf(name); return c ? `<i class="sdot" style="--sc:${c}" aria-hidden="true"></i>` : ''; };
  const staffTag = (name, empty) => { const n = String(name || ''); return n ? sdot(n) + esc(n) : esc(empty || ''); };
  const growDayText = (c, date) => { const n = growDayOf(c, date); if (n == null) return ''; const T = cropDaysOf(c.crop); return T ? `第 ${n} 天／${T} 天` : `第 ${n} 天`; };

  function render() {
    state.renderGen++;
    // 第25任：工作進度上方的統計卡原本把測試帳號的客戶、拜訪也算進去，跟同一頁的業務卡片、全員對照表（預設不列測試帳號）對不起來 → 一樣預設不算，「顯示測試資料」才算
    const notTest = x => state.showTest || !isTestStaff(x.staff);
    const cs = active().filter(notTest);
    const late = cs.filter(c => dueState(c) === 'late'), due = cs.filter(c => dueState(c) === 'due');
    const weekAgo = addDays(state.data.today, -6);
    const week = state.data.visits.filter(v => v.time.slice(0, 10) >= weekAgo && notTest(v));
    $('stats').hidden = state.tab !== 'progress'; // 第24任 第七批升級版一-5：「0 逾期」這種統計卡不在首頁佔位置，放到工作進度
    $('stats').innerHTML = [
      ['red', late.length, '逾期未回訪'], ['yel', due.length, '今天該回訪'],
      ['grn', week.length, '近 7 天拜訪次數'], ['', cs.length, '追蹤中的客戶']
    ].map(([k, n, t]) => `<div class="card stat ${k}"><b>${n}</b><span class="sub">${t}</span></div>`).join('');
    document.querySelectorAll('.tab[data-tab]').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === state.tab || ({ today: 'today', latest: 'visits', trial: 'customers' }[t.dataset.tab] === navGroup(state.tab) && navGroup(state.tab) !== 'more'))); // 第七批：拜訪（卡片／表格／日曆）、客戶（清單／地圖）同一顆亮
    // 「更多」裡的分頁（地圖、紀錄表、進度明細、業務帳號）：選到其中一個時，第二列保持打開
    const inMore = MORE_TABS.indexOf(state.tab) >= 0;
    $('moreTabs').hidden = !(state.moreOpen || inMore);
    $('moreBtn').setAttribute('aria-expanded', String(!$('moreTabs').hidden));
    $('moreBtn').setAttribute('aria-selected', String(inMore));
    // 手機上分頁列會橫向捲動：選到的分頁捲進畫面裡
    // 主管BUG#3（1號 0.4.63）：只在換分頁時捲，同一頁重畫（標已讀、載完履歷、派任務）不要把人拉回分頁列
    const curTab = document.querySelector('.tab[data-tab][aria-selected="true"]');
    if (state.tab !== state.lastTab && curTab && curTab.scrollIntoView) curTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    state.lastTab = state.tab;
    // 主管匯報分頁的紅點：總經理＝還沒看過的匯報（含 100 份以外的舊未讀，後台算的 briefUnread）；
    // 主管＝總經理有新回覆、這台電腦還沒打開看過的（總經理BUG(2號)中2，不加試算表欄位，記在瀏覽器）
    const unread = briefUnreadCount(); // 第25任 審查第二批：原本這裡另寫一份同樣的算法
    $('briefBadge').hidden = !unread; $('briefBadge').textContent = unread ? String(unread) : '';
    // 抓BUG第6輪 主管組3：整頁重畫（重新整理、離開 10 分鐘切回來自動重讀）也保留同一位客戶打開的修改框和打到一半的字
    const d0 = $('custDetail'), keepCid = d0 ? d0.dataset.cid : '', keepBoxes = d0 ? openFixBoxes(d0) : [];
    $('panel').innerHTML = segBar() + ({ today: renderToday, overdue: renderOverdue, review: renderReview, moremenu: renderMoreMenu, latest: renderLatest, cal: renderCal, trial: renderTrial, map: renderMap, table: renderTable, reports: renderReports, progress: () => staffCards() + renderProgress(), tasks: renderTasks, accounts: renderAccounts, briefs: renderBriefs, errors: renderErrors, myfix: renderMyFix })[state.tab](); // 第24任 第七批：今天、逾期、審核、更多（手機）；本月目標、每位業務卡片搬到工作進度
    if (state.tab === 'tasks') bindTasks();
    if (state.tab === 'briefs') bindBriefs();
    if (state.tab === 'accounts') bindAccounts();
    if (state.tab === 'errors') bindErrors();
    if (state.tab === 'myfix') bindMyFix();
    if (state.tab === 'trial') bindCustomers();
    bindGo($('panel'));
    biDom($('panel')); biDom($('stats')); // 補緬文
    $('panel').querySelectorAll('[data-staff]').forEach(el => el.addEventListener('click', () => {
      // 點業務卡片：到客戶頁，只看這位業務要注意的客戶
      state.cf = { q: '', staff: el.dataset.staff, area: '', type: '', show: 'attn' }; state.trial = null; state.tab = 'trial'; render();
    }));
    { const d1 = $('custDetail'); if (d1 && keepCid && d1.dataset.cid === keepCid) restoreFixBoxes(d1, keepBoxes); }
    bindMedia($('panel')); syncPlayer($('panel')); // 0.4.88 中8：重畫後舊錄音接到新按鈕，找不到就停
    $('panel').querySelectorAll('[data-filter]').forEach(el => el.addEventListener('change', () => { state.rf[el.dataset.filter] = el.value; render(); }));
    $('panel').querySelectorAll('[data-month]').forEach(el => el.addEventListener('change', () => { state.pm = el.value; render(); }));
    if (state.tab === 'progress') loadProgress(state.pm);
    if (state.tab === 'progress') loadProgress(monthsBack(1)[0]); // 業務卡片的月計劃用本月進度（第七批：卡片搬到工作進度）
    bindNav7(); paintNav7(); // 第24任 第七批
    if (state.tab === 'trial') { loadPhotos(); loadHistory(); }
    // 0.5.18（抓BUG C4）：日曆最少 770 寬，手機上打開只看到上週一到週三 → 橫向捲到「今天」那格
    if (state.tab === 'cal') {
      const w = $('panel').querySelector('.cal-wrap'), td = w && w.querySelector('.day.today');
      if (w && td && w.scrollWidth > w.clientWidth && td.getBoundingClientRect) w.scrollLeft = Math.max(0, w.scrollLeft + td.getBoundingClientRect().left - w.getBoundingClientRect().left - 8);
    }
  }

  /** 播放錄音、朗讀摘要、下載報告的按鈕（整頁重畫和只重畫履歷都用這個；綁過的標 data-mbound 不重複綁） */
  function bindMedia(root) {
    root.querySelectorAll('[data-play]:not([data-mbound]),[data-speak]:not([data-mbound]),[data-report]:not([data-mbound]),[data-areport]:not([data-mbound])').forEach(el => {
      el.dataset.mbound = '1';
      el.addEventListener('click', () => (el.dataset.play ? playAudio(el) : el.dataset.speak ? speak(el) : downloadReport(el)));
    });
    // 第26任：客戶履歷「✎ 改階段」的「存」
    root.querySelectorAll('[data-stsave]:not([data-mbound])').forEach(el => { el.dataset.mbound = '1'; el.addEventListener('click', () => saveStageFix(el)); });
    // 第27任：客戶履歷「✎ 改內容／種植日期／生長天數／回訪」的「存」「清除」
    root.querySelectorAll('[data-fixsave]:not([data-mbound])').forEach(el => { el.dataset.mbound = '1'; el.addEventListener('click', () => saveFix(el, false)); });
    root.querySelectorAll('[data-fixclear]:not([data-mbound])').forEach(el => { el.dataset.mbound = '1'; el.addEventListener('click', () => saveFix(el, true)); });
    // 第28任：逐字稿打開框框時才去後台讀
    root.querySelectorAll('[data-tsload]:not([data-mbound])').forEach(el => {
      el.dataset.mbound = '1';
      const box = el.closest('details');
      if (box) box.addEventListener('toggle', () => loadTranscript(box));
    });
    // 第28任 保哥迴圈 R1-07（Gemini）：完整履歷沒讀到時，只重拿這位客戶（不用整頁重新整理）
    root.querySelectorAll('[data-histretry]:not([data-mbound])').forEach(el => {
      el.dataset.mbound = '1';
      el.addEventListener('click', () => {
        if (state.histErr) delete state.histErr[el.dataset.histretry];
        el.disabled = true;
        if ($('custDetail')) refreshCustDetail(); else render();
        loadHistory();
      });
    });
  }
  /** 主管頁存檔後檢查：後台沒回成功，就在框框下面寫原因（後台沒說原因就寫「沒有存成功，請再試一次」），回 true 讓呼叫的地方停下 */
  function showSaveFailed(r, msg) {
    if (r && r.ok) return false;
    if (msg) msg.textContent = (r && r.message) || '沒有存成功，請再試一次';
    return true;
  }
  /* 第27任 2026-11-18 董事長「主管可以修改業務錯字、天數，設定回訪」：客戶履歷可以改 ① 拜訪的打字內容 ② 種植日期 ③ 作物生長天數（整個作物一起改）④ 下次回訪日（可清除）。
     key＝「種類:編號」（text:拜訪編號、plantDate:客戶編號、nextDue:客戶編號、cropDays:作物）。新字只有中文，緬文待譯 */
  function fixBoxHtml(key, label, input, canClear) {
    return `<details class="stfix"><summary>✎ ${esc(label)}</summary>${input} <button class="btn" type="button" data-fixsave="${esc(key)}">存</button>${canClear ? ` <button class="btn" type="button" data-fixclear="${esc(key)}">清除</button>` : ''}`
      + ` <span class="sub" data-fixmsg></span></details>`;
  }
  /* 「✎ 改」框框的 key＝「種類:編號」，這裡換成送後台的動作。
     第28任 2026-11-20 老闆「主管要能改緬甸錯字」加了兩種：
       ctext:欄位|客戶編號（名字、鎮、村、老闆、地址）、my:欄位|拜訪編號（緬文版那幾行、transcript＝逐字稿） */
  function fixRequestOf(kind, id, val) {
    const bar = id.indexOf('|'), field = id.slice(0, bar), target = id.slice(bar + 1);
    if (kind === 'text') return { action: 'visitTextFix', visitId: id, text: val };
    if (kind === 'cropDays') return { action: 'cropDaysFix', crop: id, days: val };
    if (kind === 'ctext') return { action: 'custTextFix', cid: target, field, value: val };
    if (kind === 'my') return { action: 'visitMyFix', visitId: target, field, text: val };
    return { action: 'custFix', cid: id, what: kind, value: val };
  }
  const CTEXT_MAX = { name: 60, village: 60, town: 60, owner: 60, address: 200 }; // 跟後台 PROFILE_MAP 一樣
  /** 客戶資料的字（名字、鎮、村、老闆、地址）旁邊的「✎ 改」 */
  function ctextFixHtml(c, field) {
    const cur = String(c[field] == null ? '' : c[field]);
    const input = `<input type="text" data-fixin maxlength="${CTEXT_MAX[field]}" value="${esc(cur)}" aria-label="改字">`;
    return fixBoxHtml('ctext:' + field + '|' + c.id, '改', input);
  }
  /** 拜訪那幾行緬文版（摘要、作物、反應、問題、下一步）下面的「✎ 改緬文」 */
  function myFixHtml(v, field, cur) {
    const max = field === 'summary' ? 3000 : 1000; // 跟後台 MY_FIELDS_ 一樣
    const input = `<textarea data-fixin lang="my" maxlength="${max}" rows="3" aria-label="改緬文">${esc(cur)}</textarea>`;
    return fixBoxHtml('my:' + field + '|' + v.id, '改緬文', input);
  }
  /** 逐字稿很長，總覽不帶：主管點開「✎ 看／改逐字稿」才去後台讀（讀過的記在 state.transcripts） */
  function transcriptFixHtml(v) {
    const known = (state.transcripts || {})[v.id];
    const input = `<textarea data-fixin data-tsload="${esc(v.id)}" lang="my" maxlength="40000" rows="6" aria-label="緬文逐字稿">${esc(known || '')}</textarea>`;
    return fixBoxHtml('my:transcript|' + v.id, '看／改逐字稿', input);
  }
  async function loadTranscript(box) {
    const ta = box.querySelector('[data-tsload]'), msg = box.querySelector('[data-fixmsg]');
    if (!ta || !box.open || ta.value || ta.dataset.loaded) return;
    const save = box.querySelector('[data-fixsave]');
    if (save) save.disabled = true;
    if (msg) msg.textContent = '讀取中…';
    let r; try { r = await api({ action: 'visitTranscript', visitId: ta.dataset.tsload }); } catch (e) { r = null; }
    if (save) save.disabled = false;
    if (!r || !r.ok) { if (msg) msg.textContent = (r && r.message) || '沒有讀到逐字稿，請關掉再打開一次'; return; }
    if (msg) msg.textContent = r.text ? '' : '這筆還沒有逐字稿';
    ta.dataset.loaded = '1';
    if (!ta.value) ta.value = r.text; // 讀的時候主管已經開始打字，就不蓋掉
    (state.transcripts = state.transcripts || {})[r.visitId] = r.text;
  }
  /** 總覽和完整履歷裡同一筆拜訪可能各有一份，改完兩邊都要換 */
  function eachVisit(id, fn) {
    [].concat(state.data.visits || [], ...Object.values(state.hist || {})).forEach(v => { if (v && v.id === id) fn(v); });
  }
  /* 客戶資料改好後，畫面上的資料跟著換。名字另外存在拜訪、任務、試作各一份（後台 renameCustomerCopies_ 也一起換），
     不換的話「最新拜訪」「任務」要等重新整理才看到新名字（抓BUG第16輪 主管2） */
  function renameLocal(cid, field, value) {
    (state.data.customers || []).forEach(c => { if (c.id === cid) c[field] = value; });
    if (field !== 'name') return;
    const copies = [].concat(state.data.visits || [], ...Object.values(state.hist || {}), state.data.tasks || [], state.data.trials || []);
    copies.forEach(x => { if (x && x.cid === cid) x.name = value; });
  }
  async function saveFix(btn, clear) {
    const key = btn.dataset.fixsave || btn.dataset.fixclear || '', i = key.indexOf(':'), kind = key.slice(0, i), id = key.slice(i + 1);
    const box = btn.parentNode || btn, inp = box.querySelector('[data-fixin]'), msg = box.querySelector('[data-fixmsg]');
    const val = clear ? '' : String(inp ? inp.value : '').trim();
    const isText = kind === 'text' || kind === 'ctext' || kind === 'my';
    if (!clear && !val && kind !== 'cropDays') { if (msg) msg.textContent = isText ? '內容不能空白' : '請先選日期'; return; }
    box.querySelectorAll('button').forEach(b => { b.disabled = true; }); if (msg) msg.textContent = '存檔中…';
    let r; try { r = await api(fixRequestOf(kind, id, val)); } catch (e) { r = null; }
    box.querySelectorAll('button').forEach(b => { b.disabled = false; });
    if (showSaveFailed(r, msg)) return;
    if (kind === 'text') eachVisit(id, v => { v.text = r.text; });
    else if (kind === 'my' && r.field === 'transcript') (state.transcripts = state.transcripts || {})[r.visitId] = r.text;
    else if (kind === 'my') { if (r.my) eachVisit(r.visitId, v => { v.my = r.my; }); }
    else if (kind === 'ctext') renameLocal(r.cid, r.field, r.value);
    else if (kind === 'cropDays') state.data.cropDays = r.cropDays || {};
    else (state.data.customers || []).forEach(c => { if (c.id === id) c[kind] = kind === 'nextDue' ? r.nextDue : r.plantDate; });
    // 抓BUG第5輪 主管組1：快採收清單跟著後台重算的換；主管組2：畫面資料改了 dataGen 加一（出發較早的重讀晚到時不採用、改重讀）
    setData(Array.isArray(r.harvestSoon) ? { harvestSoon: r.harvestSoon } : {});
    if ($('custDetail')) refreshCustDetail(key);
    // 抓BUG第6輪 主管組2：回訪日、種植日期改了，左邊客戶清單（逾期標籤、要注意的）和上方「今天」紅點也跟著重畫
    const cl = $('custList'); if (cl && kind !== 'text') { cl.innerHTML = renderCustList(); bindGo(cl); }
    if (typeof paintNav7 === 'function') paintNav7();
  }
  /* 第26任 2026-11-18 董事長「業務填錯生長週期，主管後台要能改」：客戶履歷每筆拜訪（結案那筆除外）可以改生長階段 */
  const STAGE_LIST = ['播種', '發芽', '長大', '開花', '結果', '採收', '採收後', '剖面圖']; // 跟手機、後台同一份 8 個值
  function stageFixHtml(v) {
    const cur = String(v.stage || '');
    return `<details class="stfix"><summary>✎ 改階段</summary><select data-stsel="${esc(v.id)}" aria-label="生長階段">${cur ? '' : '<option value="" selected>— 選階段 —</option>'}`
      + `${STAGE_LIST.map(s => `<option value="${s}"${s === cur ? ' selected' : ''}>${s}</option>`).join('')}</select> <button class="btn" type="button" data-stsave="${esc(v.id)}`
      + `">存</button> <span class="sub" data-stmsg="${esc(v.id)}"></span></details>`;
  }
  async function saveStageFix(btn) {
    const id = btn.dataset.stsave, box = btn.parentNode || btn;
    const sel = box.querySelector('[data-stsel]'), msg = box.querySelector('[data-stmsg]');
    const st = sel ? sel.value : '';
    if (!st) { if (msg) msg.textContent = '請先選階段'; return; } // 抓BUG 後台組：原本沒選就送，後台回「資料格式錯誤」看不懂（緬文待譯 D12）
    btn.disabled = true; if (msg) msg.textContent = '存檔中…';
    let r; try { r = await api({ action: 'stageFix', visitId: id, stage: st }); } catch (e) { r = null; }
    btn.disabled = false;
    if (showSaveFailed(r, msg)) return;
    // 畫面上的這筆跟著改（總覽、完整履歷兩份都改），再重畫履歷
    [].concat(state.data.visits || [], ...Object.values(state.hist || {})).forEach(v => { if (v && v.id === id) v.stage = r.stage; });
    state.dataGen++; // 抓BUG第5輪 主管組2：同 saveFix
    // 抓BUG 後台組：存的途中切到別的分頁 → 原本整頁 render() 會洗掉正在打的匯報、任務文字；履歷還在畫面上才重畫履歷，不在就只改資料（回來時照新值畫）
    if ($('custDetail')) refreshCustDetail(id); // 抓BUG第5輪 主管組3：剛存的那格顯示新值、其他打開的格子保留
  }
  /** 點客戶名字：到客戶頁看他的履歷；窄螢幕時履歷在清單下面，自動捲過去 */
  function bindGo(root) {
    root.querySelectorAll('[data-go]:not([data-bound])').forEach(el => (el.dataset.bound = '1', el).addEventListener('click', () => {
      state.trial = el.dataset.go; state.tab = 'trial'; render();
      const d = $('custDetail');
      if (d && d.scrollIntoView && window.matchMedia && window.matchMedia('(max-width:820px)').matches) d.scrollIntoView({ block: 'start' });
    }));
  }

  /** 客戶履歷：總覽只有最近 500 筆，舊客戶的早期拜訪會不見，點進來時拿完整的（2026-11-11 抓到） */
  async function loadHistory() {
    const c = custSelected();
    if (!c || state.hist[c.id] || state.histReq[c.id] || (state.histErr || {})[c.id]) return; // 已經有、或正在拿，不重複要；第28任：沒讀到的不自動一直重拿（每次重畫都會叫），按「重新整理」才重拿
    const gen = state.cacheGen, req = state.histReq, dgen = state.dataGen; // 0.5.24：記下出發時的世代和標記表；抓BUG第6輪 主管組1：也記畫面資料版本
    req[c.id] = true;
    let r;
    try { r = await api({ action: 'history', cid: c.id }); } catch (e) { r = null; } finally { delete req[c.id]; }
    if (gen !== state.cacheGen) return;
    if (!r || !r.ok) { // 第28任 抓BUG第9輪 主管組2：原本讀失敗什麼都不說，畫面寫「還沒有拜訪紀錄」
      (state.histErr = state.histErr || {})[c.id] = (r && r.message) || '網路不穩';
      const now0 = state.tab === 'trial' && custSelected();
      if (now0 && now0.id === c.id) { if ($('custDetail')) refreshCustDetail(); else render(); }
      return;
    }
    if (dgen !== state.dataGen) { loadHistory(); return; } // 出發後主管改過打字、階段等（可能是改之前的資料）→ 不採用，重拿一次
    state.hist[c.id] = r.visits;
    const now = state.tab === 'trial' && custSelected();
    if (now && now.id === c.id) { if ($('custDetail')) refreshCustDetail(); else render(); } // 0.4.75 低3：只重畫履歷，不重建搜尋框
  }

  /* ───── 聲音：原始錄音（緬甸語）＋用手機內建語音念中文摘要 ───── */
  function soundBtns(v) {
    const a = v.audio ? `<button class="btn" type="button" data-play="${esc(v.audio)}">▶ 聽原始錄音（緬甸語）</button>` : '';
    const s = v.summary ? `<button class="btn" type="button" data-speak="${esc(v.id)}">🔊 念中文摘要</button>` : '';
    // 0.5.26 董事長「錄音轉 Word 給主管看報告用」→「改成 PDF，中文跟緬甸語版本」：兩顆按鈕，各下載一種語言
    // 0526 抓BUG C1（第23任）：正在做時（state.areq）兩顆都停用，進度訊息放在按鈕旁的小字（不改按鈕文字），重畫後照樣在
    const q = (typeof state !== 'undefined' && state.areq && state.areq[v.id]) || {}, dis = q.busy ? ' disabled' : '';
    const w = v.audio ? `<button class="btn" type="button" data-areport="${esc(v.id)}" data-lang="zh"${dis}>⬇ 錄音報告 PDF（中文）</button> <button class="btn" type="button" data-areport="${esc(v.id)}`
      + `" data-lang="my"${dis}>⬇ 錄音報告 PDF（緬文）</button> <span class="sub" data-areqmsg="${esc(v.id)}">${esc(q.msg || '')}</span>` : '';
    return a || s ? `<div class="sounds">${a} ${s} ${w}</div>` : '';
  }

  let player = null, playingId = '', playingBtn = null;
  const PLAY_LABEL = '▶ 聽原始錄音（緬甸語）';
  const playHtml = () => esc(PLAY_LABEL) + `<span class="my">${BI[PLAY_LABEL]}</span>`; // 0.4.75（1號主管清單低9）：還原時連緬文小字一起還原
  /** 0.4.88 中7／中8：停掉正在播的錄音，按鈕恢復（朗讀前、登出時用） */
  function stopAudio() {
    try { if (player) player.pause(); } catch (e) { /* 已經停了 */ }
    if (playingBtn && playingBtn.isConnected !== false) playingBtn.innerHTML = playHtml();
    player = null; playingId = ''; playingBtn = null;
  }
  /** 0.4.88 中8：整頁或履歷重畫後，正在播的那段如果畫面上還有按鈕，就接到新按鈕（照播、按鈕寫「停止」）；畫面上找不到了就停掉，不讓它在背景一直播 */
  function syncPlayer(root) {
    if (!player && !playingBtn) return;
    const nb = playingId && root && root.querySelector ? root.querySelector(`[data-play="${CSS && CSS.escape ? CSS.escape(playingId) : playingId}"]`) : null;
    if (nb) { playingBtn = nb; nb.textContent = '⏸ 停止／ရပ်မည်'; return; }
    if (playingBtn && playingBtn.isConnected) return; // 按鈕還在（重畫的不是它那一塊）
    try { if (player) player.pause(); } catch (e) { /* 已經停了 */ }
    player = null; playingId = ''; playingBtn = null;
  }
  async function playAudio(btn) {
    const id = btn.dataset.play;
    if (player && playingId === id) { player.pause(); player = null; playingId = ''; playingBtn = null; btn.innerHTML = playHtml(); return; }
    try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch (e) { /* 不支援朗讀 */ } // 0.4.88 中7：播錄音先停朗讀，不要兩個同時出聲
    // 換聽另一段：上一段停掉，按鈕也要恢復（原本會一直停在「停止」；2026-11-11 抓到）
    if (player) player.pause();
    if (playingBtn && playingBtn !== btn) playingBtn.innerHTML = playHtml();
    player = null; playingId = ''; playingBtn = btn;
    btn.textContent = '讀取錄音中…／အသံဖိုင် ဖတ်နေသည်…';
    if (!state.audios[id]) {
      let r;
      try { r = await api({ action: 'audio', fileId: id }); } catch (e) { r = { ok: false, message: e && e.timeout ? '讀錄音超過時間沒回應，請再按一次／အသံဖိုင် ဖတ်ချိန် ကျော်လွန်၍ အဖြေ မရပါ၊ ထပ်နှိပ်ပါ' : '連不上伺服器，錄音沒讀到，請再按一次／ဆာဗာနှင့် ချိတ်မရ၍ အသံဖိုင် မဖတ်နိုင်ပါ၊ ထပ်နှိပ်ပါ' }; } // 0.4.88 低1：斷線跟不能播分開
      if (playingBtn !== btn) return; // 讀取期間又按了別段
      if (!r.ok) { btn.textContent = r.message || '錄音讀取失敗／အသံဖိုင် ဖတ်မရပါ'; playingBtn = null; return; }
      state.audios[id] = `data:${r.mime};base64,${r.data}`;
    }
    if (playingBtn !== btn) return; // 讀取期間又按了別段
    try {
      player = new Audio(state.audios[id]);
      playingId = id;
      const me = player;
      player.onended = () => { if (playingBtn) playingBtn.innerHTML = playHtml(); if (player === me) { player = null; playingId = ''; playingBtn = null; } };
      await player.play();
      if (player === me && playingBtn) playingBtn.textContent = '⏸ 停止／ရပ်မည်';
    } catch (e) {
      // 0.4.88 低1：被下一段（或停止、朗讀）打斷的不是「不能播」
      if (e && e.name === 'AbortError') { if (playingBtn === btn) { btn.innerHTML = playHtml(); player = null; playingId = ''; playingBtn = null; } return; } // 狀態一起清，下一次按才是「播放」不是「停止」
      btn.textContent = e && e.name === 'NotAllowedError' ? '瀏覽器擋住播放，請再按一次／Browser မှ ဖွင့်ခွင့် တားထားသည်၊ ထပ်နှိပ်ပါ' : '這支手機無法播放這段錄音／ဤဖုန်းသည် ဤအသံဖိုင်ကို မဖွင့်နိုင်ပါ';
      if (playingBtn === btn) { player = null; playingId = ''; playingBtn = null; }
    }
  }

  function speak(btn) {
    // 先找客戶履歷（完整），再找總覽（最近 500 筆）：較舊的拜訪只在履歷裡（第七輪 D-4）
    const inHist = Object.keys(state.hist || {}).map(k => (state.hist[k] || []).find(x => x.id === btn.dataset.speak)).find(Boolean);
    const v = inHist || state.data.visits.find(x => x.id === btn.dataset.speak);
    if (!v || !('speechSynthesis' in window)) { btn.textContent = '這個瀏覽器不支援朗讀／ဤ Browser သည် အသံထွက် ဖတ်ပြခြင်း မပံ့ပိုးပါ'; return; }
    stopAudio(); // 0.4.88 中7：朗讀先停錄音
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(relabelStr(`${v.name}。${v.summary}。問題：${v.issue || '無'}。下一步：${v.next || '無'}。`)); // 抓BUG第9輪 主管組3（第28任）：朗讀不在畫面上，換字要自己做（同確認視窗）
    u.lang = 'zh-TW'; u.rate = 0.95;
    speechSynthesis.speak(u);
  }

  // 結案那筆資料記成一般拜訪（統計照舊），畫面上標「結案」（董事長 2026-11-12）
  // 主管BUG(2號)#9：被退回的結案標「結案（已退回）」灰底，不是綠色結案
  // 結案清單中3（0.4.74）：待主管確認的結案標黃色「結案（待確認）」，跟已確認的綠色分開
  const catPill = v => v.closing && v.closeRejected ? '<span class="pill">結案（已退回）<span class="my">ပိတ်သိမ်း（ပြန်ပို့ပြီး）</span></span> ' : v.closing && v.closePending ? '<span class="pill p-yel">結案（待確認）<span class="my">ပိတ်သိမ်း（စစ်ဆေးဆဲ）</span></span> ' : `<span class="pill p-grn">${esc(v.closing ? '結案' : (v.cat || '試作'))}</span> `;
  /** 沒有摘要時要說清楚原因：處理中、處理失敗、沒送翻譯（原本處理失敗也寫「沒有需要翻譯的內容」；2026-11-11 抓到） */
  function noSummaryText(v) {
    // 後台BUG(2號)中5：待處理但有錯誤訊息＝翻譯延遲（額度不足、Gemini 暫時無法使用、上次失敗等重試），不要再寫「約 10 分鐘內完成」
    // 額度不足／連不上（後台寫的「翻譯額度不足…」「翻譯服務暫時連不上…」，或舊資料的 429／402／503）→「翻譯額度不足，稍後自動補」（第8任定的字樣）
    // 第24任 必改清單 ②③：後台說額度用完（402，要有人儲值，不會自己好）→ 寫清楚要儲值；斷路器暫停中 → 寫幾點後自動再試
    const gm = (typeof state !== 'undefined' && state.data && state.data.gemini) || {};
    const CREDIT_TXT = '⚠ 翻譯額度已用完，需要儲值／ဘာသာပြန်ရန် ငွေပမာဏ ကုန်သွားပြီ၊ ငွေဖြည့်ရန် လိုသည်';
    if (v.status === '待處理' && gm.creditOut) return CREDIT_TXT;
    if (v.status === '待處理' && v.error && /\b402\b|預付額度用完/.test(v.error)) return CREDIT_TXT;
    if (v.status === '待處理' && Number(gm.pausedUntil) > Date.now()) {
      let t = ''; try { t = new Date(Number(gm.pausedUntil)).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Yangon' }); } catch (e) { t = ''; }
      return '⏳ 翻譯服務忙碌，' + t + '（緬甸時間）後自動再試／ဘာသာပြန်ဝန်ဆောင်မှု အလုပ်များနေသည်၊ ' + t + ' (မြန်မာစံတော်ချိန်) နောက်ပိုင်း အလိုအလျောက် ထပ်ကြိုးစားမည်';
    }
    if (v.status === '待處理' && v.error && /翻譯服務忙碌|\b503\b/.test(v.error)) return '⏳ 翻譯服務忙碌（Google 那邊），稍後自動補'; // 第26任 老闆核准：503 是 Google 太忙，不說成額度不足（舊資料的 503 原文也一樣）
    if (v.status === '待處理' && v.error && /額度不足|暫時連不上|\b(429|402|503)\b/.test(v.error)) return '⏳ 翻譯額度不足，稍後自動補／ဘာသာပြန် ခွဲတမ်း မလောက်ပါ၊ နောက်မှ အလိုအလျောက် ဖြည့်ပေးမည်';
    if (v.status === '待處理') return v.error ? '⏳ 翻譯延遲（上次失敗，稍後自動重試）／ဘာသာပြန် နောက်ကျနေ（ယခင် မအောင်မြင်၊ နောက်မှ အလိုအလျောက် ထပ်စမ်းမည်）' : '翻譯處理中，約 10 分鐘內完成／ဘာသာပြန်နေဆဲ၊ ၁၀ မိနစ်ခန့်အတွင်း ပြီးမည်'; // 第24任 必改第二批③：原文不直接秀，收進「詳細」（errDetail）
    if (v.status === '處理異常' || v.status === '翻譯異常') return '⚠ 處理失敗' + '（原因排除後，到試算表選單「農業CRM → 重新處理「處理異常」的拜訪」，或把狀態改回「待處理」、重試次數改 0）' + '／လုပ်ဆောင်မှု မအောင်မြင်（အကြောင်းရင်း ရှင်းပြီးနောက် Sheet မီနူး 「စိုက်ပျိုးရေးCRM → ပြန်လုပ်ရန်」 နှိပ်ပါ သို့မဟုတ် အခြေအနေကို 「စောင့်ဆိုင်းဆဲ」 နှင့် ကြိုးစားမှု 0 ပြောင်းပါ）';
    const hasStuff = v.audio || (v.photos && v.photos.length) || v.text;
    return hasStuff ? '（沒有翻譯：翻譯功能關閉中，或這筆沒有送翻譯）／（ဘာသာပြန် မရှိပါ - ဘာသာပြန် ပိတ်ထားခြင်း သို့မဟုတ် ဘာသာပြန်ရန် မပို့ထားခြင်း ဖြစ်နိုင်）' : '（沒有需要翻譯的內容）／（ဘာသာပြန်ရန် လိုအပ်သော အကြောင်းအရာ မရှိပါ）';
  }
  /** 第24任 必改第二批③：沒有摘要時的錯誤原文（可能是英文技術訊息）收進可展開的「詳細」，平常只看到上面的白話說明 */
  function errDetail(v) { return !v.summary && v.error ? `<details class="errdet"><summary>詳細<span class="my">အသေးစိတ်</span></summary><span class="sub pre">${esc(String(v.error).slice(0, 600))}</span></details>` : ''; }
  function visitItem(v) {
    const flag = v.check && v.check !== '現場拍攝' ? ` <span class="pill p-yel">${esc(v.check)}</span>` : '';
    const st = v.summary ? '' : ` <span class="pill ${v.status === '待處理' ? 'p-yel' : 'p-red'}">${esc(v.status)}</span>`;
    const pending = noSummaryText(v);
    return `<li>${catPill(v)}<b><a href="javascript:void 0" data-go="${esc(v.cid)}">${esc(v.name)}</a></b>｜${staffTag(v.staff)}｜${esc(v.time)}${flag}${st}<br>
      ${v.summary ? esc(v.summary) + `<br><span class="sub">問題／ပြဿနာ：${esc(v.issue || '—')}　下一步／နောက်တစ်ဆင့်：${esc(v.next || '—')}</span>` : `<span class="sub">${esc(pending)}</span>${errDetail(v)}`}
      ${v.closing ? `<br><span class="sub">${esc(v.closing)}</span>` : ''}${v.prices ? `<br><span class="sub pre">價格／ဈေးနှုန်း：${esc(v.prices)}</span>` : ''}
      ${v.plantFail ? `<br><span class="pill p-red">種植失敗<span class="my">စိုက်ပျိုးမှု မအောင်မြင်</span></span> <span class="sub">${esc(v.plantFail)}</span>` : ''}
      ${v.noMeet ? `<br><span class="pill p-yel">沒拜訪<span class="my">မသွားဖြစ်ပါ</span></span> <span class="sub">${esc(v.noMeet)}</span>` : ''}
      ${v.nav ? `<br><a href="${esc(v.nav)}" target="_blank" rel="noopener">導航 ↗</a>` : ''}${soundBtns(v)}</li>`;
  }

  /* ───── 總覽：每位業務一張卡片（任務、逾期、月計劃、試作、最近拜訪）（2026-11-12 規劃 A） ───── */
  const daysBetween = (a, b) => Math.round((s2d(b) - s2d(a)) / DAY);
  const pct = x => Math.max(0, Math.min(100, Number(x) || 0));
  /** 試作量測週：開始後第 2、4、8 週要去量（2026-11-12 董事長同意優化 4；手機 app.js 有同一組數字，要改兩邊一起改）。
      過了某個量測週、而客戶最後拜訪日還早於「那一週前 3 天」，就算該量測沒量測 */
  const MEASURE_WEEKS = [2, 4, 8], MEASURE_EARLY = 3;
  function measureDue(t, lastVisit, today) {
    if (!t || t.status !== '進行中' || !/^\d{4}-\d\d-\d\d/.test(String(t.start || ''))) return null;
    const cs = custOf(t.cid).status; // 0.4.88 中3：客戶暫停、已結束不算該量測（跟後台派量測任務只算往來中的農民一致）
    if (cs === '暫停' || cs === '已結束' || cs === '已結案') return null;
    const days = daysBetween(t.start, today);
    const W = state.data && Array.isArray(state.data.measureWeeks) && state.data.measureWeeks.length ? state.data.measureWeeks : MEASURE_WEEKS; // 第25任 審查第二批：週數由後台送，舊後台沒送用預設
    const w = W.filter(x => days >= x * 7).pop();
    if (!w) return null;
    return !lastVisit || String(lastVisit).slice(0, 10) < addDays(t.start, w * 7 - MEASURE_EARLY) ? w : null;
  }
  const custOf = cid => state.data.customers.find(c => c.id === cid) || {};
  /** 本週（含今天往前 7 天）和上週（再往前 7 天）的拜訪次數；總覽只帶最近 500 筆，上週可能不全時標出來（優化 5） */
  function weekCompare(name) {
    const d = state.data, w1 = addDays(d.today, -6), w2 = addDays(d.today, -13);
    const days = d.visits.filter(v => v.staff === name).map(v => v.time.slice(0, 10));
    const oldest = d.visits.map(v => v.time.slice(0, 10)).sort()[0];
    return { now: days.filter(x => x >= w1).length, prev: days.filter(x => x >= w2 && x < w1).length, partial: d.visits.length >= (d.visitMax || 500) && oldest >= w2 }; // 第25任 審查第二批：上限由後台送（visitMax） // 0.4.88 低4：最舊那筆剛好是上週第一天，那天可能被 500 筆截掉一半，也算可能不全
  }
  function staffCards() {
    const d = state.data, staff = (d.staffList || []).filter(s => state.showTest || !isTestStaff(s.name)); // 第25任④：測試帳號預設不列（同全員對照表）
    if (!staff.length) return '';
    const max = d.maxTasks || 10, idleWarn = cfg7().idleDays; // 第25任②：跟設定「沒拜訪提醒天數」（原本寫死 3）
    const p = state.prog[monthsBack(1)[0]];
    const card = s => {
      const open = (d.tasks || []).filter(t => t.status === '待辦' && t.account === s.account).length;
      const late = active().filter(c => c.staff === s.name && dueState(c) === 'late').length;
      const ts = (d.trials || []).filter(t => t.staff === s.name), n = st => ts.filter(t => t.status === st).length;
      const measure = ts.filter(t => measureDue(t, custOf(t.cid).lastVisit, d.today)).length;
      const wk = weekCompare(s.name);
      const drop = !wk.partial && wk.prev >= 3 && wk.now < wk.prev * 0.8; // 比上週少兩成以上才標紅；上週太少（<3）不比
      const last = d.visits.filter(v => v.staff === s.name).map(v => v.time).sort().pop();
      const idle = last ? daysBetween(last, d.today) : null;
      const ps = p && p.ok ? ((p.staff || []).find(x => x.name === s.name) || { plan: [] }).plan || [] : null;
      const plan = !p ? '<span class="sub">月計劃讀取中…<span class="my">လစဉ် စီမံချက် ဖတ်နေသည်…</span></span>' : !p.ok ? '<span class="sub">月計劃讀取失敗<span class="my">လစဉ် စီမံချက် ဖတ်မရပါ</span></span>'
        : ps.length ? ps.slice(0, 3).map(x => `<span>${esc(x.label)}　${x.done}／${x.target}${x.done >= x.target ? ' <span class="pill p-grn">達成</span>' : ''}${planParts(x)}`
          + `<span class="bar"><i style="width:${pct(x.pct)}%"></i></span></span>`).join('')
          + (ps.length > 3 ? `<span class="sub">還有 ${ps.length - 3} 項，看下面「每位業務的目標明細」<span class="my">နောက်ထပ် ${ps.length - 3} ခု ရှိသေးသည်၊ အောက်ပါ 「ဝန်ထမ်းတစ်ဦးချင်း ပစ်မှတ် အသေးစိတ်」 ကြည့်ပါ</span></span>` : '') // 第25任③：卡片已在工作進度頁
        : '<span class="sub">本月沒有訂目標<span class="my">ဤလ ပစ်မှတ် မသတ်မှတ်ရသေး</span></span>';
      return `<button type="button" class="card scard" data-staff="${esc(s.name)}">
        <span class="top"><b>${staffTag(s.name)}</b><span class="sub">${esc(s.account)}</span></span>
        <span class="row">任務 <b>${open}／${max}</b>${late ? ` <span class="pill p-red">逾期回訪 ${late}<span class="my">ရက်ကျော် ပြန်သွားရန် ${late}</span></span>` : ''}`
          + `${idle == null ? ' <span class="pill p-yel">近期沒有拜訪<span class="my">မကြာသေးမီ သွားရောက်မှု မရှိပါ</span></span>' : idle >= idleWarn ?` <span class="pill p-red">${idle}`
            + ` 天沒拜訪<span class="my">${idle} ရက် မသွားဖြစ်</span></span>` : ''}`
          + `</span>
        ${plan}
        <span class="row">本週拜訪 <b>${wk.now}</b> 次（上週 ${wk.prev}${wk.partial ? '，資料可能不全' : ''}）<span class="my">ယခုအပတ် သွားရောက်မှု ${wk.now} ကြိမ်（ယခင်အပတ် ${wk.prev}`
          + `${wk.partial ? '，ဒေတာ မပြည့်စုံနိုင်ပါ' : ''}）</span>${drop ? ` <span class="pill p-red">比上週少 ${wk.prev - wk.now} 次<span class="my">ယခင်အပတ်ထက် ${wk.prev - wk.now}`
            + ` ကြိမ် နည်းသည်</span></span>` : ''}`
          + `</span>
        <span class="row">試作 ${measure ? `<span class="pill p-red">該量測未量測 ${measure}<span class="my">တိုင်းတာရမည့်ရက် မတိုင်းရသေး ${measure}</span></span>` : ''}`
          + `<span class="pill p-yel">進行中 ${n('進行中')}<span class="my">လုပ်ဆောင်ဆဲ ${n('進行中')}</span></span><span class="pill p-grn">成功 ${n('成功')}<span class="my">အောင်မြင် ${n('成功')}`
          + `</span></span><span class="pill p-red">失敗 ${n('失敗')}<span class="my">မအောင်မြင် ${n('失敗')}</span></span>${n('結束') ? `<span class="pill">結束 ${n('結束')}`
            + `<span class="my">ပြီးဆုံး ${n('結束')}</span></span>` : ''}`
          + `</span>
        <span class="sub">最近拜訪／မကြာသေးမီ သွားရောက်မှု：${last ? esc(last.slice(5, 16)) : '—'}</span></button>`;
    };
    return `<h3>每位業務 <span class="sub">（點卡片看這位業務要注意的客戶）<span class="my">（ကတ်ကို နှိပ်ပြီး ဤဝန်ထမ်း သတိပြုရမည့် ဖောက်သည်များ ကြည့်ပါ）</span></span></h3><div class="staffcards">${staff.map(card).join('')}</div>`;
  }

  /* ───── 第24任 第七批（老闆核准「設計版」＋「升級版」）：主管頁改成「今天」待辦頁、連續審核、精簡拜訪卡片、手機 4 個導覽 ───── */
  // 導覽分組：手機底部「今天｜拜訪｜客戶｜更多」；電腦頂部 7 個（今天、拜訪、客戶、任務、試作報告、主管匯報、更多）
  const NAV = { today: ['today', 'overdue', 'review'], visits: ['latest', 'table', 'cal'], customers: ['trial', 'map'], more: ['moremenu', 'tasks', 'reports', 'briefs', 'progress', 'accounts', 'errors', 'myfix'] };
  const navGroup = t => Object.keys(NAV).find(g => NAV[g].indexOf(t) >= 0) || 'today';
  const SEGS = { visits: [['latest', '卡片<span class="my">ကတ်ပုံစံ</span>'], ['table', '表格<span class="my">ဇယားပုံစံ</span>'], ['cal', '日曆']], customers: [['trial', '清單<span class="my">စာရင်းပုံစံ</span>'], ['map', '地圖<span class="my">မြေပုံ</span>']] };
  const MORE_ITEMS = [['tasks', '任務'], ['reports', '試作報告'], ['briefs', '主管匯報'], ['progress', '工作進度<span class="my">လုပ်ငန်း တိုးတက်မှု</span>'], ['accounts', '業務帳號'], ['errors', '錯誤紀錄<span class="my">အမှား မှတ်တမ်း</span>'], ['myfix', '緬文對照']]; // 第28任：主管改畫面緬文
  /** 主管頁設定（後台設定分頁：主管頁還早時間、沒拜訪提醒天數、測試帳號）；舊後台沒送就用預設 */
  function cfg7() {
    const c = (state.data && state.data.bossCfg) || {};
    const idle = Math.round(Number(c.idleDays));
    return { earlyUntil: /^\d\d:\d\d$/.test(String(c.earlyUntil || '')) ? c.earlyUntil : '10:00', idleDays: idle >= 1 && idle <= 60 ? idle : 3,
      testAccounts: (Array.isArray(c.testAccounts) ? c.testAccounts : []).map(x => String(x).toLowerCase()) };
  }
  /** E：測試帳號（設定分頁「測試帳號」）的業務名字。主管頁預設隱藏他們的拜訪、客戶、結案（右上「顯示測試資料」打開才看） */
  // 第25任 審查第三批：isTestStaff 在 500 筆拜訪的迴圈裡一筆呼叫一次，原本每次都重切設定、重掃名單 → 同一份資料（state.data 同一個、dataGen 沒變）只算一次
  let tnCache = { d: null, gen: -1, m: {} };
  function testNames() {
    if (tnCache.d === state.data && tnCache.gen === state.dataGen) return tnCache.m;
    const m = testNamesCalc(); tnCache = { d: state.data, gen: state.dataGen, m }; return m;
  }
  function testNamesCalc() {
    const t = cfg7().testAccounts; if (!t.length) return {};
    const tn = state.data.bossCfg && state.data.bossCfg.testNames; // 第25任 審查⑧：後台直接給的姓名（含已停用帳號，跟日報同一批）；舊後台沒送才自己從名單換
    if (Array.isArray(tn)) { const m = {}; tn.forEach(n => { m[String(n)] = true; }); return m; }
    const m = {}; (state.data.staffList || []).concat(state.data.bossList || []).forEach(s => { if (t.indexOf(String(s.account).toLowerCase()) >= 0) m[s.name] = true; });
    return m;
  }
  const isTestStaff = name => !!testNames()[name];
  const hideTest = list => (state.showTest ? list : (list || []).filter(x => !isTestStaff(x.staff)));
  /** D：一筆拜訪的警示標籤（防作弊資訊一個都不少，只是整理成標籤；照片明細在「展開」裡） */
  function flagsOf(v) {
    const ck = String(v.check || ''), out = [];
    const old = (ck.match(/非當下拍攝|非現場即時拍攝/g) || []).length;
    const m = ck.match(/位置不符（(\d+(?:\.\d+)?) 公尺）/);
    if (m) { const n = Number(m[1]); out.push({ k: 'loc', txt: '📍 位置不符 ' + (n >= 1000 ? (n / 1000).toFixed(1) + ' 公里' : n + ' 公尺') }); }
    if (/無定位/.test(ck)) out.push({ k: 'nogps', txt: '📍 無定位' });
    // 抓BUG第9輪 主管組1（第28任）：寫出是第幾張（檢查原文「第7張（相簿）：非當下拍攝」），主管才找得到那一張；舊資料沒寫張號就照舊只寫張數
    const oldNos = ck.split('｜').map(p => p.trim()).filter(p => /非當下拍攝|非現場即時拍攝/.test(p)).map(p => (p.match(/^第(\d+)張/) || [])[1]).filter(Boolean);
    if (old) out.push({ k: 'old', txt: oldNos.length === old ? '📷 第 ' + oldNos.join('、') + ' 張非當下拍攝' : '📷 ' + old + ' 張非當下拍攝' });
    if (/照片.{0,8}(無關|不相關)|與田間無關/.test(String(v.issue || '') + String(v.summary || ''))) out.push({ k: 'ai', txt: '🤖 AI：照片與田間無關' });
    if (/^【簡易翻譯】/.test(String(v.summary || ''))) out.push({ k: 'simple', txt: '🔤 簡易翻譯' });
    ck.split('｜').map(p => p.trim()).filter(p => p && !/非當下拍攝|非現場即時拍攝|位置不符|無定位|^現場拍攝$|^第\d+張（[^）]*）：/.test(p)).forEach(p => out.push({ k: 'other', txt: '⚠ ' + p.slice(0, 40) }));
    return out;
  }
  const isSuspicious = v => flagsOf(v).some(f => f.k === 'loc' || f.k === 'old' || f.k === 'ai');
  const SEEN_KEY = 'boss-seen-visits';
  function seenSet() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function markSeen(id) {
    const s = seenSet();
    s[id] = Date.now();
    const keys = Object.keys(s);
    if (keys.length > 500) keys.sort((a, b) => s[a] - s[b]).slice(0, keys.length - 500).forEach(k => delete s[k]);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch (e) { /* 記不了：這次有效 */ }
  }
  /** 可疑拜訪：最近 7 天、有位置不符／非當下拍攝／AI 判斷無關、這台電腦還沒按「已看過」的 */
  function suspiciousList() {
    const from = addDays(state.data.today, -6), seen = seenSet();
    return hideTest(state.data.visits).filter(v => v.time.slice(0, 10) >= from && isSuspicious(v) && !seen[v.id]).sort((a, b) => b.time.localeCompare(a.time));
  }
  function briefUnreadCount() {
    const d = state.data;
    return d.role === '總經理' ? Math.max((d.briefs || []).filter(b => !b.read).length, Number(d.briefUnread) || 0) : (d.briefs || []).filter(newReply).length;
  }
  const mmNowHM = () => { const t = new Date(Date.now() + 390 * 60000); return String(t.getUTCHours()).padStart(2, '0') + ':' + String(t.getUTCMinutes()).padStart(2, '0'); };
  const WEEKDAY = '日一二三四五六'; const WEEKDAY_MY = ['တနင်္ဂနွေ', 'တနင်္လာ', 'အင်္ဂါ', 'ဗုဒ္ဓဟူး', 'ကြာသပတေး', 'သောကြာ', 'စနေ'];
  /** 升級版一-4「團隊今天」：每位業務今天幾筆、最後拜訪時間；超過 N 天沒拜訪黃底。今天有拜訪的排前面，黃底的排最後 */
  function teamToday() {
    const d = state.data, c = cfg7();
    return (d.staffList || []).filter(s => state.showTest || !isTestStaff(s.name)).map(s => {
      const vs = d.visits.filter(v => v.staff === s.name), last = vs.map(v => v.time).sort().pop() || '';
      const idle = last ? daysBetween(last.slice(0, 10), d.today) : null;
      return { name: s.name, today: vs.filter(v => v.time.slice(0, 10) === d.today).length, last, idle, warn: idle == null || idle >= c.idleDays };
    }).sort((a, b) => ((b.today > 0) - (a.today > 0)) || (a.warn - b.warn) || (b.today - a.today) || String(b.last).localeCompare(String(a.last)));
  }
  /** 升級版一-3「需要你處理」：每列一個數字，點了直接進處理畫面 */
  function needList() {
    const d = state.data;
    const late = active().filter(c => dueState(c) === 'late' && (state.showTest || !isTestStaff(c.staff)));
    return [
      { go: 'review:close', n: hideTest(d.closings || []).length, t: '待確認結案', my: 'အတည်ပြုစောင့်ဆဲ ပိတ်သိမ်းမှု' },
      { go: 'review:sus', n: suspiciousList().length, t: '可疑拜訪', my: 'သံသယရှိဖွယ် သွားရောက်မှု', sub: '位置不符／非當下拍攝／AI 判斷照片無關', subMy: 'တည်နေရာ မကိုက်／လက်ငင်းမရိုက်／AI ဓာတ်ပုံ မသက်ဆိုင်' },
      { go: 'overdue', n: late.length, t: '逾期沒回訪', my: 'ရက်ကျော် ပြန်မသွားရသေး' },
      { go: 'overdue', n: Array.isArray(d.harvestSoon) ? hideTest(d.harvestSoon).length : 0, t: '快採收待盯' },
      { go: 'briefs', n: briefUnreadCount(), t: '未讀主管匯報', my: 'မဖတ်ရသေးသော မန်နေဂျာ အစီရင်ခံစာ' }
    ];
  }
  function renderToday() {
    const d = state.data, c = cfg7(), hm = mmNowHM(), dt = s2d(d.today);
    const greet = hm < '11:00' ? '早安' : hm < '18:00' ? '午安' : '晚安'; const greetMy = hm < '11:00' ? 'မင်္ဂလာနံနက်ခင်းပါ' : hm < '18:00' ? 'မင်္ဂလာနေ့လယ်ခင်းပါ' : 'မင်္ဂလာညနေခင်းပါ';
    const team = teamToday(), out = team.filter(x => x.today > 0), idle = team.filter(x => !x.today);
    const early = hm < c.earlyUntil;
    const need = needList(), total = need.reduce((s, x) => s + x.n, 0);
    const staffLink = x => `<a href="javascript:void 0" data-staffv="${esc(x.name)}">${esc(x.name)}</a>`;
    const hello = `<div class="hello"><b>${greet}，${esc(d.name || '')}<span class="my">${greetMy}၊ ${esc(d.name || '')}</span></b><span class="sub">${esc(d.today)}`
      + `（星期${WEEKDAY[dt.getUTCDay()]}）・緬甸時間 ${hm}<span class="my">${esc(d.today)}（${WEEKDAY_MY[dt.getUTCDay()]} နေ့）・မြန်မာစံတော်ချိန် ${hm}</span></span></div>`;
    const one = `<div class="card oneline"><b>今天 ${out.length}／${team.length} 位業務已出門<span class="my">ယနေ့ ဝန်ထမ်း ${out.length}／${team.length} ဦး ထွက်ပြီးပါပြီ</span></b><span class="sub">${!team.length ? '還沒有業務帳號<span class="my">ဝန်ထမ်း အကောင့် မရှိသေးပါ</span>'
      : early && idle.length ? `還早（緬甸 ${esc(c.earlyUntil)} 前不算沒動）<span class="my">စောသေးသည်（မြန်မာ ${esc(c.earlyUntil)} မတိုင်မီ မလှုပ်ရှားဟု မမှတ်ပါ）</span>` : idle.length ? '還沒動／မလှုပ်ရှားသေးသူ：' + idle.map(staffLink).join('、') : '大家都出門了<span class="my">အားလုံး အပြင်ထွက်ပြီးပါပြီ</span>'}</span></div>`;
    const needH = `<section class="need"><h3>需要你處理<span class="my">သင် ဖြေရှင်းရန် လိုသည်</span> <span class="pill ${total ? 'p-red' : 'p-grn'}">${total}</span></h3>${total
      ? `<ul class="needlist">${need.map(x => `<li${x.n ? '' : ' class="zero"'}><button type="button" data-need="${esc(x.go)}"${x.n ? '' : ' disabled'}><span class="nt">${esc(x.t)}`
        + `${x.my ? `<span class="my">${esc(x.my)}</span>` : ''}${x.sub ? `<small class="sub">${esc(x.sub)}${x.subMy ? `<span class="my">${esc(x.subMy)}</span>` : ''}</small>` : ''}`
        + `</span><b>${x.n}</b><span class="arr" aria-hidden="true">＞</span></button></li>`).join('')}</ul>`
      : '<p class="sub allclear">今天沒有要你處理的事<span class="my">ယနေ့ သင် ဖြေရှင်းရမည့် ကိစ္စ မရှိပါ</span></p>'}</section>`;
    const teamH = `<section class="team"><h3>團隊今天<span class="my">အဖွဲ့ ယနေ့ အခြေအနေ</span></h3><ul class="teamlist">${team.map(x => `<li${x.warn ? ' class="warn"' : ''}`
      + `><button type="button" data-staffv="${esc(x.name)}"><span class="nm">${esc(x.name)}${isTestStaff(x.name) ? ' <span class="pill">測試<span class="my">စမ်းသပ်</span></span>' : ''}`
      + `</span><span class="nv">${x.today ? `今天 <b>${x.today}</b> 筆・最後 ${esc(x.last.slice(11, 16))}<span class="my">ယနေ့ ${x.today} ခု・နောက်ဆုံး ${esc(x.last.slice(11, 16))}</span>` : x.last ? '最後／နောက်ဆုံး ' + esc(x.last.slice(5, 16)) : '還沒有拜訪<span class="my">မသွားရောက်ရသေးပါ</span>'}`
      + `${x.warn ? ` <span class="pill p-yel">${x.idle == null ? '沒有拜訪紀錄<span class="my">သွားရောက် မှတ်တမ်း မရှိပါ</span>' : x.idle + ' 天沒拜訪<span class="my">' + x.idle + ' ရက် မသွားဖြစ်ပါ</span>'}</span>` : ''}`
      + `</span></button></li>`).join('') || '<li class="empty">還沒有業務帳號<span class="my">ဝန်ထမ်း အကောင့် မရှိသေးပါ</span></li>'}</ul></section>`;
    return hello + one + (state.closeMsg ? `<p class="sub" id="closeMsg" aria-live="polite">${esc(state.closeMsg)}</p>` : '') + `<div class="today2">${needH}${teamH}</div>`;
  }
  /** 逾期沒回訪、快採收待盯（從「需要你處理」點進來） */
  function renderOverdue() { return `<p><button class="btn" type="button" data-nav="today">← 回今天<span class="my">ယနေ့သို့ ပြန်</span></button></p>` + renderHarvestSoon() + renderTodayLists(); }
  /** 更多（手機）：任務、試作報告、主管匯報、工作進度、帳號、錯誤紀錄；有未讀或待辦顯示紅點數字 */
  /** 第25任 審查⑦：「更多」裡的紅點，選單和手機底部共用一份。錯誤紀錄原本讀 d.errors（後台主管資料沒有這欄、永遠 0）→ 改讀打開過的錯誤紀錄 state.errs */
  function moreBadges() {
    const d = state.data || {}, e = state.errs && state.errs.ok && Array.isArray(state.errs.errors) ? state.errs.errors : [];
    return { briefs: briefUnreadCount(), tasks: (d.tasks || []).filter(t => t.status === '待辦' && t.account === d.account).length, errors: e.filter(x => !x.done).length };
  }
  function renderMoreMenu() {
    const badge = moreBadges();
    return `<ul class="moremenu">${MORE_ITEMS.map(([t, n]) => `<li><button type="button" data-nav="${t}"><span>${n}</span>${badge[t] ? `<b class="badge">${badge[t]}</b>` : ''}`
      + `<span class="arr" aria-hidden="true">＞</span></button></li>`).join('')}</ul>`;
  }
  /** 拜訪、客戶分頁上方的切換（卡片／表格／日曆、清單／地圖） */
  function segBar() {
    const g = navGroup(state.tab), s = SEGS[g]; if (!s) return '';
    return `<div class="segs" role="group" aria-label="切換顯示方式">${s.map(([t, n]) => `<button type="button" data-nav="${t}" aria-pressed="${state.tab === t}">${n}</button>`).join('')}</div>`;
  }
  /* ───── 升級版二：連續審核（待確認結案、可疑拜訪） ───── */
  const nfmt = x => (x === '' || x == null ? '' : isFinite(Number(x)) ? Number(x).toLocaleString('en-US') : String(x));
  const msum7 = m => (m ? [m.variety, m.sampleCount !== '' && m.sampleCount != null ? m.sampleCount + (m.sampleUnit || '') : '', m.weightKg !== '' && m.weightKg != null ? m.weightKg + 'kg' : '', m.husk]
    .filter(x => x !== '' && x != null).join(' ') + (m.days !== '' && m.days != null ? '・' + m.days + ' 天／' + m.days + ' ရက်' : '') : '');
  /** 結案的分類＋試作／推廣結果（例：推廣農民・推廣成功） */
  const closeGroupTxt = c => (c.group ? c.group + (c.trialOutcome ? '・' + (c.trialCat || (c.group === '推廣農民' ? '推廣' : '試作')) + c.trialOutcome : '') : '');
  /** 審核卡上的提醒標籤：客戶已結束、採收量測、分類、結案後還有拜訪（跟舊的待確認清單同一套字） */
  function closeTags(c) {
    return (c.custEnded ? ' <span class="pill p-yel">客戶已經是「已結束」：確認＝維持結束，退回＝不記這筆結案（客戶仍是已結束）<span class="my">ဖောက်သည်သည် 「ပြီးဆုံးပြီး」 ဖြစ်နေသည် - အတည်ပြု＝ဆက်လက် ပြီးဆုံးထားမည်၊ ပြန်ပို့＝ဤပိတ်သိမ်းမှု မမှတ်ယူပါ (ဖောက်သည်မှာ ပြီးဆုံးပြီး အတိုင်း ရှိမည်)</span></span>' : '')
      + (msum7(c.measure) ? ' <span class="pill p-grn">' + esc(msum7(c.measure)) + '</span>' : '')
      + (c.after && (c.after.visits || c.after.trials) ? ' <span class="pill p-red">結案之後還有 ' + (c.after.visits || 0) + ' 筆拜訪' + (c.after.trials ? '、' + c.after.trials + ' 件新開始的試作（確認後新試作不會跟著結束）' : '')
        + '，請先看客戶履歷再決定<span class="my">ပိတ်သိမ်းပြီးနောက် သွားရောက်မှု ' + (c.after.visits || 0) + ' ခု' + (c.after.trials ? '、အသစ်စတင်သော စမ်းသပ်မှု ' + c.after.trials + ' ခု (အတည်ပြုပြီးနောက် စမ်းသပ်မှုအသစ် လိုက်မပိတ်ပါ)' : '')
        + ' ရှိသေးသည်၊ ဖောက်သည် မှတ်တမ်း အရင်ကြည့်ပြီး ဆုံးဖြတ်ပါ</span></span>' : '');
  }
  function closeExtra(c) { return [c.result ? esc(c.result) + (c.result === '已簽約' && c.reason ? '｜說明／မှတ်ချက် ' + esc(c.reason) : '') : '', c.region ? '賣到／ရောင်းသည့်နေရာ ' + esc(c.region) : '', c.phone ? '電話／ဖုန်း ' + esc(c.phone) : '', c.reason && !c.result ? '原因／အကြောင်းရင်း ' + esc(c.reason) : '', c.progress ? '進度／တိုးတက်မှု ' + esc(c.progress) : ''].filter(Boolean).join('｜'); }
  /**
   * 盤商、種子商確認簽約／結案後會怎樣（第28任 抓BUG第12輪 主管1、2）：看客戶清單裡這家店「現在」的負責業務和狀態，不是送結案的那位業務。
   * 例：業務乙送了簽約、之後店家改派給業務丙 → 寫「照樣由業務丙負責」；負責業務已清空、店家是已結束 → 確認只記這筆，不會回到任何業務的清單。
   */
  function dealerAfterConfirm(c) {
    const cu = closingCustNow(c), owner = String(cu.staff || '').trim();
    // 第13輪 主管1：找不到、已結束、沒人負責分開說（原本找不到也寫「沒人負責（已結束）」，往來中、沒人負責的店也被寫成已結束）
    // 第14輪 主管3：新後台的 cust 跟結案清單同一次算，「找不到」就是真的不在客戶清單（被刪、編號打錯），重新整理也一樣 → 直接說確認的後果；
    //   舊後台（沒帶 cust、退回查舊的客戶資料）才可能是還沒更新
    if (!cu.found) return c.cust ? '客戶清單裡找不到這家店（編號 ' + (c.cid || '（空白）') + '，可能已刪掉或打錯）：確認只記下這筆，不會改到任何客戶。'
      : '客戶清單裡找不到這家店（可能剛新增還沒更新，或已從試算表刪掉），請先重新整理再確認。';
    if (cu.status === '已結束') return '這家店目前是已結束：確認只記下這筆，不會回到任何業務的清單。';
    if (!owner) return '這家店目前沒有指定負責業務：確認後照樣沒人負責（每位業務都看得到），請在試算表指定負責業務。';
    return '確認後這家店照樣由' + owner + '負責、可以繼續拜訪。';
  }
  /**
   * 這筆待確認結案的店家「現在」的資料（第28任 抓BUG第13輪 主管1、2）：後台在每筆結案帶 cust（跟結案清單一起更新，確認失敗、
   * 確認一筆後換下一張卡都是新的）；舊後台沒帶才退回查整份客戶資料。回 { found, staff, status, signed }
   */
  /** 這筆簽約之前，這家店有沒有已確認的簽約（第14輪 主管4：先確認晚的那筆，早的那筆不算「再一次簽約」） */
  function signedEarlier(c) {
    const cu = closingCustNow(c);
    return typeof cu.signedBefore === 'boolean' ? cu.signedBefore : cu.signed === true;
  }
  function closingCustNow(c) {
    if (c && c.cust && typeof c.cust === 'object' && 'found' in c.cust) return c.cust;
    const cu = state.data.customers.find(x => x.id === c.cid);
    return cu ? { found: true, staff: cu.staff, status: cu.status, signed: cu.signed === true } : { found: false };
  }
  /** 確認結案的二次確認：沿用舊清單的後果說明（防按錯的最後一道關），有缺資料再列出缺項（設計版 B） */
  function confirmText(c, miss) {
    const signed = c.result === '已簽約', dealer = !!c.result;
    // 第28任起盤商、種子商結案後不改已結束、照樣跟著業務 → 店家這兩句改說實際的後果（原本寫「改已結束、不能再拜訪」，主管可能因此退回正確的簽約；抓BUG第11輪 主管1）。
    //   原本的緬文那句是「要確認結案嗎？確認後這位客戶會結束」，對店家不對 → 店家先不放緬文（新字待譯 F12），農民照舊
    const stays = dealerAfterConfirm(c);
    const farmerMy = '\n\nပိတ်သိမ်းမှုကို အတည်ပြုမလား။ အတည်ပြုပြီးနောက် ဤဖောက်သည် ပိတ်သိမ်းပြီး ဖြစ်မည်';
    return '【' + [c.name, c.staff, c.date].filter(Boolean).join('｜') + '】\n' + (signed ? '確認這家店已簽約？' + (c.reason ? '（' + String(c.reason).slice(0, 40) + '）' : '') + stays
      : dealer ? '確認這家店結案（' + String(c.result).slice(0, 40) + '）？' + stays : '確認這位農民結案？確認後不再提醒回訪，結案前就在進行的試作也會結束。')
      + (miss.length ? '\n⚠ 這筆缺／ဤတစ်ခုတွင် လိုနေသည်：' + miss.join('、') : '') + (dealer ? '' : farmerMy);
  }
  /** 第26任 清死程式：舊清單 renderClosings 的「沒升級提示」搬來審核卡（結案分頁沒有結果欄時，盤商洽談結案的資料全空，不要顯示成農民收成） */
  function noResultCol(c) { return !c.result && !c.group && !c.trialOutcome && !c.buyer && (c.price === '' || c.price == null) && (c.yield === '' || c.yield == null); }
  function closeMissing(c, v) {
    const miss = [];
    const failed = /失敗/.test(String(c.trialOutcome || '')) || /種植失敗/.test(String(c.reason || '')) || (v && v.plantFail);
    if (c.result) { if (!c.reason) miss.push('簽約內容／စာချုပ် အကြောင်းအရာ'); }
    else if (!failed) { if (c.price === '' || c.price == null) miss.push('價格／ဈေးနှုန်း'); if (c.yield === '' || c.yield == null) miss.push('產量／အထွက်နှုန်း'); if (!c.buyer) miss.push('收購客戶／ဝယ်သူ'); }
    if (!reviewPhotos(c.cid, v).length) miss.push('照片／ဓာတ်ပုံ');
    return miss;
  }
  /** 審核卡的照片：這筆的照片；沒有就用這位客戶最近一筆有照片的拜訪（最多 3 張） */
  function reviewPhotos(cid, v) {
    // 抓BUG第9輪 主管組1（第28任）：原本最多 3 張（照片上限 6 時代），上限 12 後有問題的第 7 張主管看不到 → 全放
    // 第28任 R1-04：一起帶原序號（nos，有缺號才有）
    const withNos = src => { const a = src.photos.slice(); a.nos = src.photoNos || null; return a; };
    if (v && v.photos && v.photos.length) return withNos(v);
    const w = visitsOf(cid).find(x => x.photos && x.photos.length); return w ? withNos(w) : [];
  }
  function reviewItems() {
    const R = state.review; if (!R) return [];
    return R.kind === 'close' ? R.ids.map(id => (state.data.closings || []).find(c => c.visitId === id)).filter(Boolean)
      : R.ids.map(id => state.data.visits.find(v => v.id === id)).filter(v => v && !seenSet()[v.id]);
  }
  function startReview(kind) {
    const ids = kind === 'close' ? hideTest(state.data.closings || []).map(c => c.visitId) : suspiciousList().map(v => v.id);
    state.review = { kind, ids, i: 0, rej: null }; state.tab = 'review'; render();
  }
  /**
   * 第15輪 主管1：審核卡原本只記「第幾張」（R.i）。按確認後清單換新，前面少了一筆（例如別的主管剛確認了），同一個位置就變成別家店，
   * 失敗訊息卻還是剛剛那家的。按確認／退回時記下「這一筆」（R.keep），換新清單後先找它在哪裡；找不到（成功了、已從清單移除）才照位置往下一筆
   */
  function followKeptItem(R, items) {
    if (!R.keep) return;
    const at = items.findIndex(it => (R.kind === 'close' ? it.visitId : it.id) === R.keep);
    if (at >= 0) R.i = at; else R.keep = null;
  }
  function renderReview() {
    const R = state.review, items = reviewItems();
    if (!R || !items.length) { state.review = null; state.tab = 'today'; return renderToday(); }
    followKeptItem(R, items);
    if (R.i >= items.length) R.i = items.length - 1;
    const x = items[R.i], close = R.kind === 'close';
    const v = close ? state.data.visits.find(y => y.id === x.visitId) : x;
    const cu = custOf(x.cid), photos = close ? reviewPhotos(x.cid, v) : (x.photos || []).slice(); // 抓BUG第9輪 主管組1：可疑拜訪也全放
    const nosOf = close ? photos.nos : x.photoNos; // 第28任 R1-04：照片原序號（有缺號才有）
    const flags = v ? flagsOf(v) : [];
    const pos = `${close ? '待確認結案<span class="my">အတည်ပြုစောင့်ဆဲ ပိတ်သိမ်းမှု</span>' : '可疑拜訪<span class="my">သံသယရှိဖွယ် သွားရောက်မှု</span>'} ${R.i + 1}／${items.length}`;
    const head = close ? `<h2 class="rh">${esc(x.name || '客戶 ' + (x.cid || '（沒有編號／နံပါတ် မရှိ）'))}・${esc(cu.type || x.group || '')}${cu.crop ? '・' + esc(cropText(cu.crop)) : ''}`
      + `</h2><p class="sub">${staffTag(x.staff, '業務未填／ဝန်ထမ်း မဖြည့်ရသေး')}・送出／ပို့ပြီး ${esc(x.date || '日期未填／ရက်စွဲ မဖြည့်ရသေး')}${isTestStaff(x.staff) ? ' <span class="pill">測試<span class="my">စမ်းသပ်</span></span>' : ''}</p>`
      : `<h2 class="rh">${esc(x.cat || '')}・${esc(x.name)}</h2><p class="sub">${staffTag(x.staff)}・${esc(x.time)}</p>`;
    const cells = close ? `<div class="r4">
        <div><span class="sub">價格</span><b>${x.price === '' || x.price == null ? '—' : esc(nfmt(x.price)) + ' ' + esc(x.priceUnit || '')}</b></div>
        <div><span class="sub">產量<span class="my">အထွက်နှုန်း</span></span><b>${x.yield === '' || x.yield == null ? '—' : esc(nfmt(x.yield)) + ' ' + esc(x.yieldUnit || '')}</b></div>
        <div><span class="sub">收購客戶<span class="my">ဝယ်သူ</span></span><b>${esc(x.buyer || '—')}</b></div>
        <div><span class="sub">結果</span><b>${esc(x.result || closeGroupTxt(x) || ((v && v.plantFail) ? '種植失敗／စိုက်ပျိုးမှု မအောင်မြင်' : noResultCol(x) ? '洽談結果沒記到（結案分頁少了「結果」欄，請在試算表按「第一次安裝／升級」）／ဆွေးနွေးမှု ရလဒ် မမှတ်မိပါ (ပိတ်သိမ်း စာမျက်နှာတွင် 「ရလဒ်」 ကော်လံ လိုနေသည်၊ Sheet တွင် 「ပထမအကြိမ် တပ်ဆင်／အပ်ဒိတ်」 နှိပ်ပါ)' : '收成結案／ရိတ်သိမ်း ပိတ်သိမ်း'))}`
          + `</b></div></div>
      ${closeTags(x) ? `<p class="rtags">${closeTags(x)}</p>` : ''}${closeExtra(x) ? `<p class="sub">${closeExtra(x)}</p>` : ''}` : '';
    const ph = photos.length ? `<div class="rphotos">${photos.map((id, i) => `<figure class="pfig"><button type="button" class="rthumb" data-photo="${esc(id)}" data-big="${esc(id)}`
      + `" aria-label="看大圖 照片 ${(nosOf || [])[i] || i + 1}">讀取中…<span class="my">ဖတ်နေသည်</span></button><figcaption>照片 ${(nosOf || [])[i] || i + 1}</figcaption></figure>`).join('')}</div>` /* 第27任：照片加編號，對得上打字裡的「照片 N」 */ : '<p class="sub">（沒有照片）<span class="my">（ဓာတ်ပုံ မရှိပါ）</span></p>';
    const fl = flags.length ? `<div class="flags big">${flags.map(f => `<span class="flag f-${f.k}">${esc(f.txt)}</span>`).join('')}</div>` : '';
    const sum = v && v.summary ? `<p class="rsum"><button class="btn" type="button" data-speak="${esc(v.id)}" aria-label="念中文摘要">🔊</button> ${esc(v.summary)}</p>` : v ? `<p class="sub">${esc(noSummaryText(v))}</p>` : '';
    const miss = close ? closeMissing(x, v) : [];
    const missH = miss.length ? `<p class="rmiss">⚠ 缺／လိုနေ：${miss.map(esc).join('、')}</p>` : '';
    // 第28任 抓BUG第11輪 主管3：店家簽約後照樣在業務清單，可能又送一次簽約 → 這家已經簽過的，審核卡提醒主管（新字待譯）
    // 第14輪 主管4：後台有帶 signedBefore（比這筆早的已確認簽約）就看它；舊後台才退回看「這家有沒有簽過」
    const againH = close && x.result === '已簽約' && signedEarlier(x) ? '<p class="rmiss">⚠ 這家店之前已經簽過約（主管確認過），這筆是再一次簽約</p>' : '';
    const rej = R.rej === (close ? x.visitId : x.id) ? rejectPanel() : '';
    const btns = close ? `<div class="rbtns"><button class="btn" type="button" data-rv="reject"${state.closeSending ? ' disabled' : ''}>退回（寫原因）<span class="my">ပြန်ပို့（အကြောင်းရင်း ရေး）</span></button><button class="btn primary" type="button" data-rv="confirm"${state.closeSending ? ' disabled' : ''}`
      + `>確認結案</button></div>`
      : `<div class="rbtns"><button class="btn" type="button" data-rv="ask">派任務追問<span class="my">မေးမြန်းရန် လုပ်ငန်း ပေး</span></button><button class="btn primary" type="button" data-rv="seen">已看過<span class="my">ကြည့်ပြီး</span></button></div>`;
    return `<div class="review" id="reviewCard"><div class="rtop"><button class="btn" type="button" data-rv="exit">← 回今天<span class="my">ယနေ့သို့ ပြန်</span></button><b>${pos}`
      + `</b><span><button class="btn" type="button" data-rv="prev" aria-label="上一筆／ယခင်တစ်ခု"${R.i ? '' : ' disabled'}>‹</button><button class="btn" type="button" data-rv="next" aria-label="下一筆／နောက်တစ်ခု"${R.i < items.length - 1 ? '' : ' disabled'}`
      + `>›</button></span></div>
      <div class="rcard">${head}${cells}${ph}${fl}${sum}${againH}${missH}<p class="sub"><a href="javascript:void 0" data-go="${esc(x.cid)}">看這位客戶的完整紀錄<span class="my">ဤဖောက်သည်၏ မှတ်တမ်း အပြည့်အစုံ ကြည့်ရန်</span></a></p>${rej}`
        + `</div>
      <p class="sub" id="closeMsg" aria-live="polite">${esc(state.closeMsg || '')}</p>${btns}</div>`;
  }
  /** 設計版 C：退回原因面板（常用原因可複選＋自己寫，至少一項） */
  const REJ_REASONS = ['價格不合理', '缺照片', '照片非現場', '位置不符', '資料不完整', '其他'];
  function rejectPanel() {
    // 抓BUG第2輪 主管組4：送出途中畫面重畫（照片載完、切回分頁重讀），「送出退回」原本又能按 → 送出中（closeSending）一律停用
    // 第25任 審查⑤：勾選和說明記在 state.review.rejDraft，畫面重讀（切回來超過 10 分鐘、跨午夜）後照樣帶回，不會寫到一半就清空
    const R = state.review, d0 = R && R.rejDraft, dr = d0 && d0.id === R.rej ? d0 : { reasons: [], note: '' }, can = dr.reasons.length || dr.note.trim(); // 草稿跟著那一筆（換到別筆不帶過去）
    return `<fieldset class="rejpanel"><legend>退回原因（至少選一項或寫說明）<span class="my">ပြန်ပို့သည့် အကြောင်းရင်း（အနည်းဆုံး တစ်ခု ရွေးပါ သို့မဟုတ် စာရေးပါ）</span></legend>${REJ_REASONS.map(r => `<label class="rjc"><input type="checkbox" name="rj" value="${esc(r)}`
      + `"${dr.reasons.indexOf(r) >= 0 ? ' checked' : ''}> ${esc(r)}</label>`).join('')}`
      + `
      <textarea id="rejNote" maxlength="300" placeholder="寫給業務看的說明（例：價格比市價低一半，請確認單位）">${esc(dr.note)}</textarea>
      <div class="rbtns"><button class="btn" type="button" data-rv="rejcancel">取消</button><button class="btn primary" type="button" data-rv="rejsend"${can && !state.closeSending ? '' : ' disabled'}`
        + `>送出退回<span class="my">ပြန်ပို့မှု ပေးပို့</span></button></div></fieldset>`;
  }
  function bindReview() {
    const box = $('panel').querySelector ? $('panel').querySelector('#reviewCard') : null; if (!box) return; // 舊測試的假畫面沒有 querySelector
    const R = state.review, items = reviewItems(), x = items[R.i], close = R.kind === 'close';
    const go = d => { R.keep = null; R.i = Math.max(0, Math.min(items.length - 1, R.i + d)); R.rej = null; state.closeMsg = ''; render(); window.scrollTo(0, 0); }; // 自己換張：不再跟著剛剛那筆
    let sx = null; // 左右滑動切換
    box.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 60 && !R.rej) go(dx < 0 ? 1 : -1); });
    const rp = box.querySelector('.rejpanel');
    if (rp) {
      const upd = () => {
        R.rejDraft = { id: R.rej, reasons: [...rp.querySelectorAll('input[name=rj]:checked')].map(i => i.value), note: $('rejNote').value }; // 第25任 審查⑤：記下草稿
        // 抓BUG第3輪 主管組3：送出途中再勾原因，原本又能按「送出退回」（送兩次）→ 送出中一律停用
        rp.querySelector('[data-rv="rejsend"]').disabled = !(R.rejDraft.reasons.length || R.rejDraft.note.trim()) || !!state.closeSending;
      };
      rp.addEventListener('change', upd); $('rejNote').addEventListener('input', upd);
    }
    box.querySelectorAll('[data-big]').forEach(b => b.addEventListener('click', () => { const src = state.photos[b.dataset.big]; if (src) showBig(src); }));
    box.querySelectorAll('[data-rv]').forEach(b => b.addEventListener('click', async () => {
      const a = b.dataset.rv;
      if (a === 'exit') { state.review = null; state.tab = 'today'; state.closeMsg = ''; render(); return; }
      if (a === 'prev') return go(-1);
      if (a === 'next') return go(1);
      if (a === 'seen') { markSeen(x.id); state.closeMsg = '已標「看過」／「ကြည့်ပြီး」 ဟု မှတ်ပြီး'; render(); return; }
      // 第26任 低風險修正3①：原本一按就標「看過」→ 盤商、種子商（任務只能派給農民）或已結束的客戶派不出去，這筆可疑拜訪卻已經從清單消失；
      //   改成：派不了就留在清單、寫原因；派得了就帶到任務頁，任務真的派出去才標「看過」
      if (a === 'ask') { const cu = (state.data.customers || []).find(c => c.id === x.cid);
      if (!cu || (cu.type || '農民') !== '農民' || cu.status === '已結束') {
        state.closeMsg = `這位客戶${cu ? '是' + (cu.status === '已結束' ? '已結束的客戶' : cu.type) : '找不到'}，任務只能派給往來中的農民；請直接聯絡 ${x.staff || '業務'}（這筆先留在清單）`;
        render();
        return;
      }
        const s = (state.data.staffList || []).find(y => y.name === x.staff);
        // 抓BUG第2輪 主管組2：拜訪的業務沒有啟用中的帳號（停用、離職、名字對不上）→ 原本帶到任務頁時選單沒選到人，瀏覽器預設第一位，按送出就派給別人。改成派不了就留在清單、寫原因（緬文待譯 D13）
        if (!s) { state.closeMsg = `${x.staff || '這位業務'} 沒有啟用中的業務帳號，任務派不出去；請直接聯絡，或到任務頁自己選業務（這筆先留在清單）`; render(); return; }
        state.tf = { staff: s ? s.account : '', cid: x.cid, text: `請說明 ${x.time.slice(5, 16)} 這筆拜訪：${flagsOf(x).map(f => f.txt.replace(/^\S+ /, '')).join('、')}`, seenVid: x.id, askStaff: s.account, askCid: x.cid };
        state.review = null;
        state.tab = 'tasks';
        render();
        return; }
      if (a === 'reject') { R.rej = x.visitId; render(); return; }
      if (a === 'rejcancel') { R.rej = null; R.rejDraft = null; render(); return; }
      if (a === 'confirm' || a === 'rejsend') {
        const ok = a === 'confirm', v = state.data.visits.find(y => y.id === x.visitId), miss = ok ? closeMissing(x, v) : [];
        if (ok && !confirm(relabelStr(confirmText(x, miss)))) return; // 抓BUG第8輪 主管組3：確認視窗不在畫面裡，換字要自己做
        const reasons = ok ? [] : [...box.querySelectorAll('input[name=rj]:checked')].map(i => i.value), note = ok ? '' : $('rejNote').value.trim();
        box.querySelectorAll('[data-rv]').forEach(y => { y.disabled = true; });
        state.closeSending = x.visitId;
        R.keep = x.visitId; // 第15輪 主管1：換新清單後先找回這一筆（失敗時留在同一家，成功時它不在了才往下一筆）
        let r;
        try { r = await api(Object.assign({ action: 'closeDecide', visitId: x.visitId, decision: ok ? 'confirm' : 'reject' }, ok ? {} : { reasons, note })); } catch (e) { r = { ok: false, message: '連不上伺服器／ဆာဗာနှင့် ချိတ်မရပါ' }; } finally { state.closeSending = null; }
        // 抓BUG第2輪 主管組3：後台回「已處理過」時原本一律當成功、說「別人處理過了」→ 別人做的跟我相反（我退回、他已確認）也看不出來。
        //   後台有帶 state（已確認／已退回）：跟我這次要做的一樣才當成功；不一樣就寫出實際結果、不跳下一筆（緬文待譯 D14）
        if (r && r.code === 'DONE_ALREADY') r = !r.state || r.state === (ok ? '已確認' : '已退回') ? Object.assign({}, r, { ok: true, already: true })
          // 抓BUG第3輪 主管組2：那筆已不在清單，畫面會換成下一筆 → 訊息只寫「這筆」會被看成眼前那筆；改成寫出是哪一位、已從清單移除（緬文待譯 D14 改這句）
          : Object.assign({}, r, { message: `「${x.name}」已經被別人「${r.state}」，跟你這次要做的（${ok ? '確認結案' : '退回'}）不一樣，已從清單移除；請到客戶履歷看清楚` });
        if (r.closings) setData({ closings: r.closings });
        R.rej = null;
        if (r.ok) {
          R.rejDraft = null;
          state.closeMsg = r.already ? '這筆別人已經處理過了，跳下一筆／ဤတစ်ခုကို အခြားသူ လုပ်ဆောင်ပြီးပါပြီ၊ နောက်တစ်ခုသို့ ကျော်မည်' : ok ? `已確認結案：${x.name}／ပိတ်သိမ်းမှု အတည်ပြုပြီး：${x.name}` : `已退回：${x.name}`
            + `（原因已傳給業務）／ပြန်ပို့ပြီး：${x.name}（အကြောင်းရင်း ဝန်ထမ်းထံ ပို့ပြီး）`;
          state.closeMsgSeq = state.loadSeq + 1;
          render();
          load();
          return;
        } // closeMsgSeq：緊接著的重讀不清掉訊息（同舊清單 0.4.88 低7）
        state.closeMsg = '⚠ ' + (r.message || '處理失敗／မအောင်မြင်ပါ'); render();
        // 第14輪 主管2：失敗但後台帶了新的待確認清單 → 整份也重讀一次，客戶資料、拜訪清單跟結案清單說法一致（成功那條本來就會重讀）
        if (r.closings) { state.closeMsgSeq = state.loadSeq + 1; load(); }
      }
    }));
  }
  function showBig(src) {
    let d = document.getElementById('bigPhoto');
    if (!d) {
      d = document.createElement('div');
      d.id = 'bigPhoto';
      d.className = 'bigphoto';
      d.setAttribute('role', 'dialog');
      d.setAttribute('aria-label', '照片大圖／ဓာတ်ပုံ အကြီး');
      d.addEventListener('click', () => { d.hidden = true; });
      document.body.appendChild(d);
    }
    d.innerHTML = `<img src="${src}" alt="照片大圖／ဓာတ်ပုံ အကြီး"><span class="sub">點一下關閉<span class="my">ပိတ်ရန် တစ်ချက်နှိပ်ပါ</span></span>`; d.hidden = false;
  }
  /* ───── 設計版 D：最新拜訪改精簡卡片（一行標題、有問題才出現警示、縮圖一列、摘要 3 行、展開看全部） ───── */
  function vcard(v) {
    const f = flagsOf(v), ph = (v.photos || []).slice(0, 4);
    const chk = String(v.check || '').split('｜').map(s => s.trim()).filter(Boolean);
    const more = [
      v.summary ? `<p>${esc(v.summary)}</p>` : '',
      v.issue ? `<p class="sub">問題／ပြဿနာ：${esc(v.issue)}</p>` : '', v.next ? `<p class="sub">下一步／နောက်တစ်ဆင့်：${esc(v.next)}</p>` : '',
      chk.length ? `<ul class="sub chk">${chk.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : '',
      v.closing ? `<p class="sub">${esc(v.closing)}</p>` : '', v.prices ? `<p class="sub pre">價格／ဈေးနှုန်း：${esc(v.prices)}</p>` : '',
      v.plantFail ? `<p><span class="pill p-red">種植失敗<span class="my">စိုက်ပျိုးမှု မအောင်မြင်</span></span> <span class="sub">${esc(v.plantFail)}</span></p>` : '',
      v.noMeet ? `<p><span class="pill p-yel">沒拜訪<span class="my">မသွားဖြစ်ပါ</span></span> <span class="sub">${esc(v.noMeet)}</span></p>` : '',
      v.summary ? '' : errDetail(v),
      v.nav ? `<p><a href="${esc(v.nav)}" target="_blank" rel="noopener">導航 ↗</a></p>` : '', soundBtns(v)].join('');
    return `<li class="vcard${f.length ? ' hasflag' : ''}"><div class="vh">${catPill(v)}<b><a href="javascript:void 0" data-go="${esc(v.cid)}">${esc(v.name)}</a></b><span class="sub">・${staffTag(v.staff)}`
      + `${isTestStaff(v.staff) ? '（測試／စမ်းသပ်）' : ''}・${esc(v.time.slice(5, 16))}</span></div>
      ${f.length ? `<div class="flags">${f.map(x => `<span class="flag f-${x.k}">${esc(x.txt)}</span>`).join('')}</div>` : ''}
      ${ph.length ? `<div class="vthumbs">${ph.map(id => `<span class="vthumb lazy" data-lazyphoto="${esc(id)}"></span>`).join('')}</div>` : ''}
      <details class="vmore" data-vid="${esc(v.id)}"${state.openCards && state.openCards[v.id] ? ' open' : ''}><summary class="vsum">${v.summary ? esc(v.summary) : `<span class="sub">${esc(noSummaryText(v))}</span>`}`
        + ` <span class="vexp">展開<span class="my">ချဲ့ကြည့်</span></span></summary>${more}</details></li>`; // 點摘要本身就展開（不另佔一行）
  }
  function renderLatest() {
    let list = hideTest(state.data.visits).slice().sort((a, b) => b.time.localeCompare(a.time));
    if (state.vstaff) list = list.filter(v => v.staff === state.vstaff);
    // 第25任 審查⑥：按鈕上的數字原本只算最新 15 筆、按下去卻從全部篩 → 數字和列出的筆數對不上。改成兩邊都看全部（主管頁讀到的最近 500 筆），再列最新 15 筆
    const flagged = list.filter(v => flagsOf(v).length), nFlag = flagged.length;
    if (state.onlyFlag) list = flagged;
    list = list.slice(0, 15);
    const tools = `<div class="vtools"><button type="button" class="btn" data-onlyflag aria-pressed="${!!state.onlyFlag}">${state.onlyFlag ? '✓ ' : ''}只看有警示的（${nFlag}`
      + `）<span class="my">သတိပေးချက် ရှိသည်သာ（${nFlag}）</span></button>${state.vstaff ? `<button type="button" class="btn" data-vstaffclear>只看 ${esc(state.vstaff)}`
        + ` ✕<span class="my">${esc(state.vstaff)}`
      + ` သာ ကြည့် ✕</span></button>` : ''}</div>`;
    return `<section><h3><span class="pill p-grn">最新拜訪</span> <span class="sub">${state.onlyFlag ? `有警示的最新 15 筆（共 ${nFlag} 筆）<span class="my">သတိပေးချက် ရှိသော နောက်ဆုံး ၁၅ ခု（စုစုပေါင်း ${nFlag} ခု）</span>` : '最近 15 筆<span class="my">နောက်ဆုံး ၁၅ ခု</span>'}`
      + `</span></h3>${tools}<ul class="list vcards">${list.map(vcard).join('') || '<li class="empty">' + (state.onlyFlag ? '沒有警示的拜訪<span class="my">သတိပေးချက် ရှိသော သွားရောက်မှု မရှိပါ</span>' : '還沒有拜訪紀錄。業務用打卡網頁上傳後，這裡就會出現<span class="my">သွားရောက်မှု မှတ်တမ်း မရှိသေးပါ။ ဝန်ထမ်း မှတ်တမ်းတင် ဝဘ်မှ တင်ပြီးလျှင် ဤနေရာတွင် ပေါ်လာမည်</span>')
        + '</li>'}</ul></section>`;
  }
  /** 縮圖：捲到看得到才下載（15 筆 × 照片一次全抓太慢、太耗流量） */
  function lazyPhotos(root) {
    const els = [...root.querySelectorAll('[data-lazyphoto]')]; if (!els.length) return;
    const fill = async el => {
      const id = el.dataset.lazyphoto;
      el.removeAttribute('data-lazyphoto');
      const r = await getPhoto(id);
      if (!el.isConnected) return;
      if (state.photos[id]) {
        el.innerHTML = `<img src="${state.photos[id]}" alt="田間照片" loading="lazy">`;
        el.addEventListener('click', () => showBig(state.photos[id]));
      } else el.textContent = (r && r.message) || '讀取失敗／ဖတ်ရှုမှု မအောင်မြင်';
    };
    if (typeof IntersectionObserver === 'undefined') { els.slice(0, 8).forEach(fill); return; }
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); fill(e.target); } }), { rootMargin: '200px' });
    els.forEach(el => io.observe(el));
  }
  /** 新導覽、今天頁、審核、拜訪卡片的按鈕（render 最後呼叫） */
  function bindNav7() {
    const P = $('panel');
    P.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.nav; state.moreOpen = false; render(); window.scrollTo(0, 0); }));
    P.querySelectorAll('[data-need]').forEach(b => b.addEventListener('click', () => {
      const g = b.dataset.need;
      if (g.indexOf('review:') === 0) startReview(g.slice(7)); else { state.tab = g; render(); window.scrollTo(0, 0); }
    }));
    P.querySelectorAll('[data-staffv]').forEach(b => b.addEventListener('click', () => {
      state.vstaff = b.dataset.staffv;
      state.onlyFlag = false;
      state.tab = 'latest';
      render();
      window.scrollTo(0, 0);
    }));
    // 展開的卡片記住（重畫後照樣打開：正在聽錄音、看照片明細時不會被收回去）
    P.querySelectorAll('details.vmore[data-vid]').forEach(d => d.addEventListener('toggle', () => {
      state.openCards = state.openCards || {};
      if (d.open) state.openCards[d.dataset.vid] = true; else delete state.openCards[d.dataset.vid];
    }));
    P.querySelectorAll('[data-onlyflag]').forEach(b => b.addEventListener('click', () => { state.onlyFlag = !state.onlyFlag; render(); }));
    P.querySelectorAll('[data-vstaffclear]').forEach(b => b.addEventListener('click', () => { state.vstaff = ''; render(); }));
    if (state.tab === 'review') { bindReview(); loadPhotos(); }
    // 設計版 I：表格在窄螢幕變一列一張卡片，每格前面要有欄名 → 沒寫 data-label 的照表頭補上
    if (P.querySelectorAll) P.querySelectorAll('.tbl table').forEach(t => {
      const hs = [...t.querySelectorAll('thead th')].map(h => h.textContent.trim());
      t.querySelectorAll('tbody tr').forEach(r => [...r.children].forEach((td, i) => { if (!td.dataset.label && hs[i]) td.dataset.label = hs[i]; }));
    });
    lazyPhotos(P);
  }
  /** 底部（手機）／頂部（電腦）導覽的選取狀態、紅點 */
  function paintNav7() {
    const g = navGroup(state.tab), need = state.data ? needList().reduce((s, x) => s + x.n, 0) : 0;
    document.querySelectorAll('#bnav [data-bnav]').forEach(b => b.setAttribute('aria-current', b.dataset.bnav === g ? 'page' : 'false'));
    const tb = $('todayBadge'); if (tb) { tb.hidden = !need; tb.textContent = need ? String(need) : ''; }
    const mb = $('moreBadge'); if (mb) { const b = state.data ? moreBadges() : null, n = b ? b.briefs + b.tasks : 0; mb.hidden = !n; mb.textContent = n ? String(n) : ''; } // 第25任 審查⑦：匯報＋自己的待辦任務（錯誤紀錄不算進底部紅點：沒處理的可能一直很多，紅點會一直亮）
    const st = $('showTest');
    if (st) {
      st.hidden = !cfg7().testAccounts.length;
      st.setAttribute('aria-pressed', String(!!state.showTest));
      st.textContent = state.showTest ? '隱藏測試資料／စမ်းသပ် ဒေတာ ဖျောက်ရန်' : '顯示測試資料／စမ်းသပ် ဒေတာ ပြရန်';
    }
  }
  /** 0.4.82 董事長「蔬菜快採收前 10 天要提醒業務到現場、通知主管盯業務」：預計採收日（種植日期＋作物生長天數）0～10 天內，或已過還沒結案（紅字）。舊後台沒送就不顯示 */
  function renderHarvestSoon() {
    if (!Array.isArray(state.data.harvestSoon)) return '';
    const list = typeof hideTest === 'function' ? hideTest(state.data.harvestSoon) : state.data.harvestSoon; // 第25任 審查③：「需要你處理」的數字有排除測試帳號，點進來的清單也要排除（抽函式跑的舊測試沒有 hideTest）
    const left = h => (h.overdue ? `<span class="pill p-red">已過 ${esc(-h.daysLeft)} 天還沒結案<span class="my">${esc(-h.daysLeft)} ရက် ကျော်လွန်ပြီး မပိတ်သိမ်းရသေး</span></span>` : h.daysLeft === 0 ? '<span class="pill p-yel">今天採收<span class="my">ယနေ့ ရိတ်သိမ်း</span></span>' : `<span class="pill p-yel">剩 ${esc(h.daysLeft)}`
      + ` 天<span class="my">${esc(h.daysLeft)} ရက် ကျန်</span></span>`);
    return `<section class="harvest"><h3><span class="pill p-yel">快採收待盯</span> <span class="sub">預計採收日前 10 天內，請業務到現場；紅色＝已過預計採收日還沒結案<span class="my">ခန့်မှန်း ရိတ်သိမ်းရက်မတိုင်မီ ၁၀ ရက်အတွင်း ဝန်ထမ်း ကွင်းဆင်းခိုင်းပါ၊ အနီရောင်＝ရိတ်သိမ်းရက်ကျော်ပြီး မပိတ်သိမ်းရသေး</span></span></h3>
      <ul class="list">${list.map(h => `<li${h.overdue ? ' class="hs-late"' : ''}>${staffTag(h.staff, '未指派／တာဝန် မပေးရသေး')}｜<b><a href="javascript:void 0" data-go="${esc(h.cid)}`
        + `">${esc(h.name)}</a></b>（${esc(cropText(h.crop))}）${left(h)}<br>
        <span class="sub">預計採收 ${esc(h.harvestDate)}（種植 ${esc(h.plantDate)}）｜最後拜訪 ${esc(h.lastVisit || '沒有')}<span class="my">ခန့်မှန်း ရိတ်သိမ်း ${esc(h.harvestDate)}`
          + `（စိုက် ${esc(h.plantDate)}）｜နောက်ဆုံး သွားရောက်မှု ${esc(h.lastVisit || 'မရှိ')}</span></span></li>`).join('') || '<li class="empty">沒有</li>'}</ul></section>`;
  }
  function renderTodayLists() {
    const cs = active().filter(c => state.showTest || !isTestStaff(c.staff)); // 第25任 審查③：同「需要你處理」的逾期數字
    const late = cs.filter(c => dueState(c) === 'late'), due = cs.filter(c => dueState(c) === 'due');
    const li = c => {
      const l = visitsOf(c.id)[0];
      return `<li><b><a href="javascript:void 0" data-go="${esc(c.id)}">${esc(c.name)}</a></b>（${esc(cropText(c.crop) || '—')}）— ${staffTag(c.staff, '未指派／တာဝန် မပေးရသေး')}`
        + `${c.nextDue ? ' — 應回訪／ပြန်သွားရန် ' + md(c.nextDue) : ''}${l && l.issue && l.issue !== '無' ? `<br><span class="sub">上次問題／ယခင် ပြဿနာ：${esc(l.issue)}</span>` : ''}</li>`;
    };
    return `<section><h3><span class="pill p-red">逾期</span></h3><ul class="list">${late.map(li).join('') || '<li class="empty">沒有</li>'}</ul></section>
      <section><h3><span class="pill p-yel">今天該回訪</span></h3><ul class="list">${due.map(li).join('') || '<li class="empty">沒有</li>'}</ul></section>`;
  }
  /* 舊的最新拜訪（一筆一大段）第24任第七批 D 改成精簡卡片，見 vcard／renderLatest */

  function renderCal() {
    const t = s2d(state.data.today);
    const monday = addDays(state.data.today, -((t.getUTCDay() + 6) % 7) - 7);
    const days = Array.from({ length: 21 }, (_, i) => addDays(monday, i));
    const ev = {}; days.forEach(d => { ev[d] = []; });
    // 抓BUG第4輪 主管組2：日曆也照「隱藏測試資料」排除測試帳號的拜訪、客戶（今天、紀錄表都排除了，日曆漏掉 → 跟首頁對不上）
    hideTest(state.data.visits).forEach(v => {
      const d = v.time.slice(0, 10);
      if (ev[d]) ev[d].push(`<button class="ev visit" data-go="${esc(v.cid)}">${sdot(v.staff)}✅ ${esc(v.time.slice(11, 16))} ${esc(v.name)}</button>`);
    });
    hideTest(active()).forEach(c => {
      const s = dueState(c);
      if (s === 'late') ev[state.data.today].unshift(`<button class="ev late" data-go="${esc(c.id)}">${sdot(c.staff)}⚠ 逾期／ရက်ကျော်｜${esc(c.name)}</button>`);
      else if (c.nextDue && ev[c.nextDue]) ev[c.nextDue].push(`<button class="ev follow" data-go="${esc(c.id)}">${sdot(c.staff)}🔔 回訪／ပြန်သွားရန်｜${esc(c.name)}</button>`);
    });
    return `<div class="cal-wrap"><div class="cal">${['一', '二', '三', '四', '五', '六', '日'].map(x => `<div class="dow">週${x}<span class="my">${WEEKDAY_MY['日一二三四五六'.indexOf(x)]}</span></div>`).join('')}
      ${days.map(d => `<div class="day${d === state.data.today ? ' today' : ''}"><span class="d">${md(d)}${d === state.data.today ? ' 今天<span class="my">ယနေ့</span>' : ''}`
        + `</span>${ev[d].join('')}</div>`).join('')}`
        + `</div></div>
      <div class="legend"><span style="--c:var(--paddy)">已拜訪</span><span style="--c:var(--turmeric)">預定回訪</span><span style="--c:var(--chili)">逾期</span></div>
      <p class="sub">點任何一個行程，就會打開那位客戶的試作履歷。✅ 拜訪也在 Google 日曆「農戶拜訪」裡；🔔 回訪、⚠ 逾期只在這裡。<span class="my">မည်သည့် အစီအစဉ်ကိုမဆို နှိပ်လျှင် ထိုဖောက်သည်၏ စမ်းသပ်မှု မှတ်တမ်း ပွင့်လာမည်။ တူညီသော အစီအစဉ် Google ပြက္ခဒိန် 「လယ်သမား သွားရောက်မှု」 တွင်လည်း ရှိသည်။</span></p>`;
  }

  /* ───── 客戶頁：搜尋＋篩選＋按業務分組，預設只列要注意的（2026-11-12 規劃 B） ───── */
  const isActive = c => c.status !== '已結束' && c.status !== '暫停';
  /** 這位客戶為什麼要注意：逾期／今天該回訪／試作進行中／7 天內拜訪過；都不是就回 null */
  /** 0.4.94（第11任第五輪 5）：這位客戶在拜訪清單裡最新的一天（後台翻譯完才更新「最後拜訪日」，今天剛上傳的還沒算進去） */
  let nvCache = { src: null, map: {} };
  /** 這位客戶還沒處理完的拜訪裡最新的一天（只看還沒處理完的；已完成的會更新最後拜訪日） */
  function newestVisitDay(cid) {
    const vs = state.data.visits || [];
    if (nvCache.src !== vs) {
      const m = {};
      vs.forEach(v => { if (v.status === '已完成') return; const day = String(v.time || '').slice(0, 10); if (day > (m[v.cid] || '')) m[v.cid] = day; });
      nvCache = { src: vs, map: m };
    } // 每次讀到新資料才重算一次
    return nvCache.map[cid] || '';
  }
  /** 這位客戶進行中的試作（清單裡第一件）。第15任：原本每次從頭找，排序 3000 位客戶時每次比較都找兩遍（重畫約 1.9 秒）→ 每次讀到新資料才建一次對照表 */
  let atCache = { src: null, map: new Map() };
  function activeTrialOf(cid) {
    const ts = state.data.trials || [];
    if (atCache.src !== ts) { const m = new Map(); ts.forEach(x => { if (x.status === '進行中' && !m.has(x.cid)) m.set(x.cid, x); }); atCache = { src: ts, map: m }; }
    return atCache.map.get(cid);
  }
  /** 7 天內有「還沒處理完」的拜訪（待處理、處理中、處理異常），而且比最後拜訪日新：當作已拜訪。超過 7 天還沒跟上就照常算逾期，不會永遠被蓋掉 */
  function visitingNow(c) { const nv = newestVisitDay(c.id); return !!nv && (!c.lastVisit || nv > c.lastVisit) && nv >= addDays(state.data.today, -6); }
  function attnOf(c) {
    const d = state.data, s = dueState(c);
    if (visitingNow(c)) return { cls: 'p-grn', text: `${md(newestVisitDay(c.id))} 拜訪（處理中）／${md(newestVisitDay(c.id))} သွားရောက်မှု（လုပ်ဆောင်နေဆဲ）`, rank: 3 }; // 剛拜訪、還沒處理完：不算逾期
    if (isActive(c) && s === 'late') return { cls: 'p-red', text: `逾期 ${daysBetween(c.nextDue, d.today)} 天／ရက်ကျော် ${daysBetween(c.nextDue, d.today)} ရက်`, rank: 0 };
    if (isActive(c) && s === 'due') return { cls: 'p-yel', text: '今天該回訪', rank: 1 };
    const t = activeTrialOf(c.id);
    const mw = measureDue(t, c.lastVisit, d.today);
    if (mw) return { cls: 'p-red', text: `試作第 ${mw * 7} 天該量測`, rank: 1.5 }; // 第27任：週改天（量測照試作開始日算：第 2、4、8 週＝第 14、28、56 天；緬文待譯）
    if (t) { const g = growDayText(c, d.today); return { cls: 'p-yel', text: `${t.cat || '試作'}${g ? ' 種植' + g : '中／လုပ်ဆောင်ဆဲ'}`, rank: 2 }; } // 第27任：第幾週改種植第幾天
    if (c.lastVisit && c.lastVisit >= addDays(d.today, -6)) return { cls: 'p-grn', text: `${md(c.lastVisit)} 拜訪／${md(c.lastVisit)} သွားရောက်မှု`, rank: 3 }; // 主管BUG(2號)#11：7 天＝今天往前 6 天（原本 -7 算了 8 天，跟「近 7 天拜訪次數」不一致）
    return null;
  }
  /* 客戶清單右邊的標籤要寫什麼。老闆 2026-11-20：拜訪紀錄那邊有「種植第 N 天」，清單也要有（一般、推廣、對照農民都要）。
     沒在做試作、有填種植日期的農民：綠標後面加「・種植第 N 天／T 天」；原本沒有標籤的，單獨出一個綠標。
     這裡只管「顯示」：排序和「要注意的」篩選照舊看 attnOf，
     例：20 天前拜訪的推廣農民多了天數標籤，但不會因此變成要注意（第28任） */
  function listPillOf(c) {
    const attn = attnOf(c);
    const dealer = c.type === '盤商' || c.type === '種子商';
    if (dealer || c.status === '已結束') return attn;
    const grow = growDayText(c, state.data.today);
    if (!grow) return attn;
    if (!attn) return { cls: 'p-grn', text: '種植' + grow };
    if (attn.cls !== 'p-grn') return attn;
    return { cls: attn.cls, text: attn.text + '・種植' + grow };
  }
  const NO_STAFF = '（未指派）';
  /** 符合篩選的客戶。有打搜尋字時找全部客戶（不限「要注意的」），找不到人才不會以為客戶不見 */
  function custFiltered() {
    const f = state.cf, q = f.q.trim().toLowerCase();
    // 0.4.85 中4（第11任 0.4.84 清單）：搜尋框寫「搜尋全部客戶」→ 有搜尋字時真的搜全部，不受業務、地區、類型篩選限制；
    // 篩選本身沒動，清空搜尋就回到原本的篩選
    if (q) return state.data.customers.filter(c => [c.name, c.phone, c.id, c.crop, c.crop ? cropText(String(c.crop)) : '', c.area].some(x => String(x == null ? '' : x).toLowerCase().includes(q))); // 0.5.18 C3：畫面上作物寫「英文／緬文」，用看到的字也要搜得到
    return state.data.customers.filter(c => (!f.staff || (c.staff || NO_STAFF) === f.staff) && (!f.area || c.area === f.area) && (!f.type || (c.kind || c.type || '農民') === f.type) /* 0.5.11 低B：篩選照一般／試作／推廣農民 */
      && (f.show !== 'attn' || attnOf(c)));
  }
  /** 右邊（手機在下面）要顯示誰的履歷：有指定就是他，沒有就是篩選結果的第一位 */
  function custSelected() {
    const cs = state.data.customers;
    // 0.4.75（1號主管清單低4）：有指定客戶但清單裡已經沒有（被刪、改編號）→ 回 null、畫面寫「找不到」，不悄悄改顯示另一位
    if (state.trial) return cs.find(x => x.id === state.trial) || null;
    return sortByAttn(custFiltered())[0] || null;
  }
  /** 履歷那一欄的內容（低3、低4 共用） */
  function custDetailHtml() {
    const c = custSelected();
    if (c) return renderCustDetail(c);
    if (state.trial) return `<p class="err">找不到這位客戶（編號 ${esc(state.trial)}），可能已經從客戶清單刪掉或改了編號。請按「重新整理」，或在左邊另選一位。<span class="my">ဤဖောက်သည် မတွေ့ပါ（နံပါတ် ${esc(state.trial)}`
      + `）၊ ဖောက်သည် စာရင်းမှ ဖျက်ခံရခြင်း သို့မဟုတ် နံပါတ် ပြောင်းသွားခြင်း ဖြစ်နိုင်သည်။ 「ပြန်ဖွင့်」 နှိပ်ပါ သို့မဟုတ် ဘယ်ဘက်မှ အခြားတစ်ဦး ရွေးပါ။</span></p>`;
    return state.cf.q ? '<p class="empty">找不到符合的客戶。<span class="my">ကိုက်ညီသော ဖောက်သည် မတွေ့ပါ။</span></p>' : '<p class="empty">左邊選一位客戶，就會在這裡看到他的履歷。<span class="my">ဘယ်ဘက်မှ ဖောက်သည် တစ်ဦး ရွေးလျှင် ဤနေရာတွင် သူ၏ မှတ်တမ်း မြင်ရမည်။</span></p>';
  }
  /** 0.4.75（1號主管清單低3）：只重畫履歷那一欄（搜尋時、履歷讀完時），不重畫整頁 → 搜尋框不會被重建、手機鍵盤不會收起來 */
  /** 抓BUG第5、6輪 主管組3：履歷裡打開的修改框（✎ 改內容／種植日期／天數／回訪／改階段）和打到一半的值；savedKey＝剛存好的那格，不保留（顯示新值） */
  function openFixBoxes(d, savedKey) {
    if (!d || !d.querySelectorAll) return [];
    return Array.from(d.querySelectorAll('details.stfix[open]')).map(x => {
      const b = x.querySelector('[data-fixsave],[data-stsave]'), inp = x.querySelector('[data-fixin],[data-stsel]');
      return b ? { k: b.dataset.fixsave ? 'fixsave' : 'stsave', v: b.dataset.fixsave || b.dataset.stsave, val: inp ? inp.value : null } : null;
    }).filter(x => x && x.v !== savedKey);
  }
  function restoreFixBoxes(d, keep) {
    (keep || []).forEach(o => {
      const b = d && Array.from(d.querySelectorAll('[data-' + o.k + ']')).find(x => x.dataset[o.k] === o.v), box = b && b.closest('details');
      if (!box) return;
      box.open = true;
      const inp = box.querySelector('[data-fixin],[data-stsel]'); if (inp && o.val != null) inp.value = o.val;
    });
  }
  function refreshCustDetail(savedKey) {
    const d = $('custDetail');
    if (!d) return;
    state.renderGen++; // 舊畫面的照片迴圈停掉
    const c = custSelected();
    // 抓BUG第5輪 主管組3：履歷重畫（完整履歷載完、別的欄存完）原本把打開的修改框和打到一半的字洗掉 → 同一位客戶就記下來、重畫後放回（剛存好的那格 savedKey 除外，顯示新值）
    const keep = c && d.dataset.cid === c.id ? openFixBoxes(d, savedKey) : [];
    d.dataset.cid = c ? c.id : '';
    d.innerHTML = custDetailHtml();
    restoreFixBoxes(d, keep);
    bindGo(d); bindMedia(d); biDom(d); syncPlayer(d); // 0.4.88 中8
    const box = $('custList');
    if (box) box.querySelectorAll('.crow[data-go]').forEach(b => b.setAttribute('aria-current', String(!!c && b.dataset.go === c.id)));
    loadPhotos(); loadHistory();
  }
  /** 照「要注意的程度」排（逾期最前），同程度照姓名。第15任：先把每位的程度算好一次再排（原本每次比較都重算兩位，3000 位要算好幾萬次）；排出來的順序跟原本一樣 */
  function sortByAttn(list) {
    const rank = new Map(list.map(c => { const a = attnOf(c); return [c, a ? a.rank : 9]; }));
    return list.slice().sort((a, b) => (rank.get(a) - rank.get(b)) || String(a.name).localeCompare(String(b.name)));
  }
  function renderCustList() {
    const list = custFiltered(), sel = custSelected();
    if (!list.length) return `<p class="empty">${state.cf.q ? '找不到符合的客戶<span class="my">ကိုက်ညီသော ဖောက်သည် မတွေ့ပါ</span>' : state.cf.show === 'attn' ? '沒有要注意的客戶（篩選選「全部客戶」可以看全部）<span class="my">သတိပြုရမည့် ဖောက်သည် မရှိပါ（စစ်ထုတ်ရာတွင် 「ဖောက်သည် အားလုံး」 ရွေးပြီး အားလုံး ကြည့်နိုင်သည်）</span>' : '沒有符合篩選的客戶<span class="my">စစ်ထုတ်မှုနှင့် ကိုက်ညီသော ဖောက်သည် မရှိပါ</span>'}</p>`;
    const order = (state.data.staffList || []).map(s => s.name);
    const groups = {};
    list.forEach(c => { const k = c.staff || NO_STAFF; (groups[k] = groups[k] || []).push(c); });
    const names = Object.keys(groups).sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b); });
    const openDefault = list.length <= 40 || names.length === 1;
    return `<p class="sub" style="margin:0 0 6px">共 ${list.length} 位<span class="my">စုစုပေါင်း ${list.length} ဦး</span></p>` + names.map(k => {
      const open = k in state.grpOpen ? state.grpOpen[k] : openDefault;
      return `<details class="grp" data-grp="${esc(k)}"${open ? ' open' : ''}><summary>${k === NO_STAFF ? esc(k) : staffTag(k)}（${groups[k].length}）</summary><ul>${sortByAttn(groups[k]).map(c => {
        const a = listPillOf(c);
        return `<li><button type="button" class="crow" data-go="${esc(c.id)}" aria-current="${sel && sel.id === c.id}"><span><b data-nomyfix>${esc(c.name)}</b><span class="sub">${esc(c.kind || c.type || '農民')}`
          + `${c.crop ? '・' + esc(cropText(c.crop)) : ''}${c.area ? '・' + esc(c.area) : ''}</span></span>${a ? `<span class="pill ${a.cls}">${esc(a.text)}</span>` : ''}</button></li>`;
      }).join('')}</ul></details>`;
    }).join('');
  }
  function bindCustomers() {
    const q = $('custQ');
    if (q) q.addEventListener('input', () => {
      state.cf.q = q.value; const box = $('custList'); box.innerHTML = renderCustList(); bindCustList(box); biDom(box);
      // 0.4.75（1號主管清單低3）：履歷跟著換（指定的客戶不在搜尋結果裡就改看結果第一位）；只重畫履歷那一欄
      if (state.trial && !custFiltered().some(c => c.id === state.trial)) state.trial = null;
      const c = custSelected(), d = $('custDetail');
      if (d && d.dataset.cid !== (c ? c.id : '')) refreshCustDetail();
    });
    $('panel').querySelectorAll('[data-cf]').forEach(el => el.addEventListener('change', () => { state.cf[el.dataset.cf] = el.value; state.trial = null; render(); }));
    bindCustList($('custList'));
  }
  function bindCustList(box) {
    if (!box) return;
    box.querySelectorAll('details[data-grp]').forEach(el => el.addEventListener('toggle', () => { state.grpOpen[el.dataset.grp] = el.open; }));
    bindGo(box); // 綁過的會標 data-bound，render() 再綁整頁時不會重複
  }

  function renderTrial() {
    const cs = state.data.customers;
    if (!cs.length) return '<p class="empty">還沒有客戶。業務在打卡網頁選「臨時新增農民」，或在試算表「客戶清單」新增。<span class="my">ဖောက်သည် မရှိသေးပါ။ ဝန်ထမ်းမှ မှတ်တမ်းတင် ဝဘ်တွင် 「လယ်သမားအသစ် ထည့်」 ရွေးခြင်း သို့မဟုတ် Sheet 「ဖောက်သည် စာရင်း」 တွင် ထည့်နိုင်သည်။</span></p>';
    const f = state.cf;
    const sel = (key, label, values, all) => `<select data-cf="${key}" aria-label="${label}">${all ? `<option value="">${all}</option>` : ''}${values.map(v => {
      const [val, txt] = Array.isArray(v) ? v : [v, v];
      return `<option value="${esc(val)}"${f[key] === val ? ' selected' : ''}>${esc(txt)}</option>`;
    }).join('')}</select>`;
    const uniq = arr => [...new Set(arr.filter(Boolean))];
    // 主管BUG(2號)#13：客戶的負責業務沒有帳號（已刪或打錯）時標「（沒有帳號）」，主管才知道要重新指派；照樣能篩，不然那些客戶篩不出來
    const hasAcct = new Set((state.data.staffList || []).map(s => s.name)), off = new Set(state.data.staffOff || []);
    const staffNames = uniq((state.data.staffList || []).map(s => s.name).concat(cs.map(c => c.staff || NO_STAFF)))
      .map(n => (n === NO_STAFF || hasAcct.has(n) ? n : [n, n + (off.has(n) ? '（已停用／ပိတ်ထားပြီး）' : '（沒有帳號／အကောင့် မရှိ）')])); // 0.4.94（第五輪 8）：停用的寫「已停用」
    const tools = `<div class="custtools"><input type="search" id="custQ" placeholder="搜尋全部客戶：名字、電話、編號、作物" value="${esc(f.q)}" aria-label="搜尋客戶">
      <div class="filters">${sel('show', '顯示', [['attn', '要注意的'], ['all', '全部客戶']])}${sel('staff', '業務', staffNames, '全部業務')}${sel('area', '地區', uniq(cs.map(c => c.area)), '全部地區')}`
        + `${sel('type', '類型', ['一般農民', '試作農民', '推廣農民', '盤商', '種子商'].concat(cs.some(c => (c.type || '農民') === '農民' && !c.kind) ? ['農民'] : []), '全部類型') /* 0.5.11 低B：可以只看一般／試作／推廣農民；還有沒分類的舊資料才多一個「農民」 */}`
        + `</div>
      <span class="sub">要注意的＝逾期、今天該回訪、試作進行中、7 天內拜訪過<span class="my">သတိပြုရန်＝ရက်ကျော်၊ ယနေ့ သွားရန်၊ စမ်းသပ် လုပ်ဆောင်ဆဲ၊ ၇ ရက်အတွင်း သွားခဲ့ပြီး</span></span></div>`;
    const c = custSelected();
    return `<div class="custgrid"><div>${tools}<div id="custList">${renderCustList()}</div></div>
      <div id="custDetail" data-cid="${esc(c ? c.id : '')}">${custDetailHtml()}</div></div>`;
  }

  /** 0.5.23（第21任，客戶主管「這幾句看不到緬文」）：中文下面加一行 Gemini 同時寫的緬文版；舊紀錄沒有就不顯示 */
  function myLine(v, k) {
    const s = v && v.my && typeof v.my[k] === 'string' ? v.my[k].trim() : '';
    if (!s) return '';
    // data-nomyfix：這是資料（Gemini 寫的緬文版），不是程式寫死的字，「緬文對照」的換字不碰（抓BUG第16輪 主管1）
    return `<div class="my-line" lang="my" data-nomyfix>${esc(s)}</div>${v.id ? myFixHtml(v, k, s) : '' /* 第28任：主管改緬甸錯字 */}`;
  }

  /**
   * 客戶履歷最下面那句話。總覽只帶最近 500 筆拜訪，老客戶的早期紀錄要另外讀「完整履歷」，所以有三種情況：
   *   - 完整履歷沒讀到（網路斷、伺服器忙）：一定要說，並給「重試」——就算畫面上已經有最近幾筆，也可能少了早期的（第10輪 主管組2）
   *   - 還在讀：說「讀取中」，不能說「還沒有拜訪紀錄」，不然主管會以為業務從沒去過（第10輪 主管組1）
   *   - 讀完了、真的一筆都沒有：才說「還沒有拜訪紀錄」
   */
  function histStatusHtml(c, hasList) {
    const err = (state.histErr || {})[c.id];
    if (err) return `<p class="err">完整拜訪紀錄沒讀到（${esc(err)}）。 <button type="button" class="btn" data-histretry="${esc(c.id)}">重試</button></p>`;
    if (hasList) return '';
    if (!(state.hist || {})[c.id]) return '<p class="sub">讀取完整拜訪紀錄中…</p>';
    return '<p class="empty">這位客戶還沒有拜訪紀錄。<span class="my">ဤဖောက်သည်တွင် သွားရောက်မှု မှတ်တမ်း မရှိသေးပါ။</span></p>';
  }
  function renderCustDetail(c) {
    const list = visitsOf(c.id), s = dueState(c);
    const dealer = c.type === '盤商' || c.type === '種子商';
    const kv = (k, val) => val !== '' && val != null ? `<span>${k}：${esc(val)}</span>` : '';
    // 第28任 2026-11-20 老闆「主管要能改緬甸錯字」：名字、鎮、村、老闆、地址旁邊多一個「✎ 改」
    const kvFix = (k, val, field) => val !== '' && val != null ? `<span>${k}：<span data-nomyfix>${esc(val)}</span> ${ctextFixHtml(c, field)}</span>` : '';
    const signTag = dealer && c.signed === true ? ' <span class="pill p-grn">已簽約</span>' : ''; // 第28任 抓BUG第11輪 主管3：簽約後不再改已結束，另外標出來（新字待譯）
    return `<div class="card profile"><span><b data-nomyfix>${esc(c.name)}</b>（${esc(c.id)}・${esc(c.kind || c.type || '農民')}）${signTag} ${ctextFixHtml(c, 'name')}</span><span>${esc(c.area || '')}</span>${kvFix('鎮／မြို့နယ်', c.town, 'town')}`
      + `${kvFix('村／ကျေးရွာ', c.village, 'village') /* 0.4.75 董事長「農民改鎮跟村」：鄉改村、鎮放前面 */}${kv('電話／ဖုန်း', c.phone)}
        ${dealer ? kvFix('老闆／ဆိုင်ရှင်', c.owner, 'owner') + kvFix('地址／လိပ်စာ', c.address, 'address') + kv('作物', cropText(c.crop)) + kv('品牌（舊資料）／တံဆိပ်（ဒေတာဟောင်း）', c.brand) + kv('其他／အခြား', c.fertilizer) /* 0.4.73 董事長：盤商、種子商品牌改作物；舊的品牌資料有才顯示 */
          : kv('作物', cropText(c.crop)) + kv('品種／မျိုး', c.variety) + kv('代碼／ကုဒ်', c.varCode) + kv('目前種植面積／လက်ရှိ စိုက်ဧက', c.areaNow === '' || c.areaNow == null ? '' : c.areaNow + ' ' + (state.data.areaUnit || '英畝'))
            + kv('可種植面積／စိုက်နိုင်သော ဧက', c.areaMax === '' || c.areaMax == null ? '' : c.areaMax + ' ' + (state.data.areaUnit || '英畝')) /* 主管BUG#11 */ + `<span>種植日期／စိုက်သည့်ရက်：${esc(c.plantDate || '—')} ${fixBoxHtml('plantDate:' + c.id, '改', `<input type="date" data-fixin value="${esc(c.plantDate || '')}`
            + `" aria-label="種植日期">`)}</span>` /* 第27任：主管改種植日期 */
            + (String(c.crop || '').trim() ? `<span>生長天數：${cropDaysOf(c.crop) ? cropDaysOf(c.crop) + ' 天' : '未設'} ${fixBoxHtml('cropDays:' + String(c.crop).trim(), '改（' + cropText(c.crop) + '全部一起改）', `<input type="number" min="1" max="3650" step="1" data-fixin value="${cropDaysOf(c.crop) || ''}`
              + `" aria-label="生長天數" style="width:6em">`)}</span>` : '') /* 第27任：主管改作物生長天數 */
            + kv('其他／အခြား', c.fertilizer)
            + `<span>試作／စမ်းသပ်：${esc(c.trial || '—')}${c.start ? '（' + md(c.start) + ' 開始／စတင်）' : ''}</span>`}<span>負責／တာဝန်ခံ：${staffTag(c.staff, '—')}</span>
        <span>下次回訪／နောက်တစ်ကြိမ် သွားရန်：${c.nextDue ? md(c.nextDue) : '—'} ${s === 'late' ? '<span class="pill p-red">逾期</span>' : s === 'due' ? '<span class="pill p-yel">今天<span class="my">ယနေ့</span></span>' : s === 'stop' ? `<span class="pill">${esc(c.status)}</span>` : ''}`
          + `${c.status !== '已結束' ? fixBoxHtml('nextDue:' + c.id, '設定回訪', `<input type="date" data-fixin value="${esc(c.nextDue || '')}" aria-label="下次回訪日">`, !!c.nextDue) : '' /* 第27任：系統不再自動排回訪，由主管設 */}`
          + `</span>
        ${c.lat != null && c.lng != null ? `<a href="https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}" target="_blank" rel="noopener">田區導航 ↗</a>` : ''}</div>
      ${(state.data.trials || []).filter(t => t.cid === c.id).map(t => `<div class="card" style="margin-bottom:10px"><b>${esc(t.cat)} ${esc(t.id)}</b>：${esc(t.item || '—')}`
        + `（${esc(t.start || '')} ～ ${esc(t.end || '進行中／လုပ်ဆောင်ဆဲ')}）
        <span class="pill ${t.status === '成功' ? 'p-grn' : t.status === '失敗' ? 'p-red' : 'p-yel'}">${esc(t.status)}</span>
        ${t.hasReport ? ` <button class="btn" type="button" data-report="${esc(t.id)}">⬇ 試作報告（Word）</button>` : ''}
        ${t.conclusion ? `<div class="sub pre" style="margin-top:6px">結論／နိဂုံး：${esc(t.conclusion)}</div>` : ''}</div>`).join('')}
      <div class="timeline">${list.map(v => `<div class="entry">${catPill(v)}${v.stage ? '<span class="pill p-yel">' + esc(v.stage) + '</span> ' : '' /* 0.4.78 生長階段 */}`
        + `${!dealer && !v.closing && v.id ? stageFixHtml(v) : '' /* 第26任：主管改階段 */}<b>${esc(v.time)}</b>${!dealer && growDayText(c, String(v.time).slice(0, 10)) ? `　種植${growDayText(c, String(v.time).slice(0, 10))}` : '' /* 第27任：試作第幾週改種植第幾天 */}`
        + ` <span class="sub">${staffTag(v.staff)}</span>
        <div class="sub">${v.lat != null && v.lng != null ? `📍 <a href="${esc(v.nav)}" target="_blank" rel="noopener">${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}（導航／လမ်းညွှန်）</a>` : '📍 <span style="color:var(--chili)">無定位／တည်နေရာ မရှိ</span>'}`
          + `
        　📷 ${v.check ? esc(v.check) : '現場拍攝／ကွင်းထဲတွင် ရိုက်ထားသည်'}</div>
        <div class="box"><div class="photos">${v.photos.length ? v.photos.map((id, i) => `<figure class="pfig"><div class="photo" data-photo="${esc(id)}">載入中…／ဖတ်နေသည်…</div><figcaption>照片 ${(v.photoNos || [])[i] || i + 1}`
          + `</figcaption></figure>`).join('') /* 第27任 董事長「要，加編號」：對照農民打字寫「照片 N」，格子下面標第幾張 */ : '<div class="photo">沒有照片／ဓာတ်ပုံ မရှိပါ</div>'}`
          + `</div>
        <dl class="kv"><dt>${dealer ? '行情' : '作物'}</dt><dd>${esc(v.crop || '—')}${myLine(v, 'crop')}</dd><dt>反應</dt><dd>${esc(v.feedback || '—')}${myLine(v, 'feedback')}`
          + `</dd><dt>問題</dt><dd>${esc(v.issue || '—')}${myLine(v, 'issue')}</dd><dt>下一步</dt><dd>${esc(v.next || '—')}${myLine(v, 'next')}</dd>
        <dt>摘要</dt><dd>${esc(v.summary || noSummaryText(v))}${errDetail(v)}${myLine(v, 'summary')}</dd>
        ${v.noMeet ? `<dt>沒拜訪<span class="my">မသွားဖြစ်ပါ</span></dt><dd><span class="pill p-yel">沒拜訪<span class="my">မသွားဖြစ်ပါ</span></span> ${esc(v.noMeet)}</dd>` : ''}`
          + `${v.closing ? `<dt>結案</dt><dd>${esc(v.closing)}</dd>` : ''}${v.plantFail ? `<dt>種植失敗<span class="my">စိုက်ပျိုးမှု မအောင်မြင်</span></dt><dd>${esc(v.plantFail)}</dd>` : ''}`
          + `${v.text ? `<dt>打字</dt><dd class="pre" data-nomyfix>${esc(v.text)}${v.id ? fixBoxHtml('text:' + v.id, '改內容', `<textarea data-fixin maxlength="3000" rows="4" aria-label="打字內容">${esc(v.text)}</textarea>`) : '' /* 第27任：主管改業務打錯的字 */}</dd>` : ''}`
          + `${v.id && v.audio ? `<dt>逐字稿</dt><dd>${transcriptFixHtml(v)}</dd>` : '' /* 第28任：主管改緬甸錯字 */}`
          + `${v.prices ? `<dt>價格</dt><dd class="pre">${esc(v.prices)}</dd>` : ''}</dl></div>${soundBtns(v)}</div>`).join('') + histStatusHtml(c, list.length > 0)}</div>`;
  }

  /** 一張照片只下載一次（下載中的也共用同一個請求）；換了畫面，舊畫面的迴圈就停，不再下載別的客戶的照片（2026-11-11 抓到） */
  function getPhoto(id) {
    if (state.photos[id]) return Promise.resolve({ ok: true });
    if (!state.photoReq[id]) {
      state.photoReq[id] = api({ action: 'photo', fileId: id })
        .then(r => { if (r.ok) state.photos[id] = `data:${r.mime};base64,${r.data}`; return r; })
        .catch(() => ({ ok: false, message: '照片讀取失敗／ဓာတ်ပုံ ဖတ်မရပါ' }))
        .finally(() => { delete state.photoReq[id]; });
    }
    return state.photoReq[id];
  }
  // 主管BUG(2號)#14：原本一張一張等，老客戶照片多要等很久 → 同時抓 3 張（太多會被 Apps Script 擋；換畫面照樣停）
  const PHOTO_PARALLEL = 3;
  async function loadPhotos() {
    const gen = state.renderGen;
    const els = [...$('panel').querySelectorAll('[data-photo]')];
    let next = 0;
    const worker = async () => {
      while (next < els.length) {
        if (gen !== state.renderGen) return;
        const el = els[next++], id = el.dataset.photo;
        if (!id) continue;
        const r = await getPhoto(id);
        if (!el.isConnected) continue;
        if (state.photos[id]) el.innerHTML = `<img src="${state.photos[id]}" alt="田間照片">`;
        else el.textContent = (r && r.message) || '照片讀取失敗／ဓာတ်ပုံ ဖတ်မရပါ';
      }
    };
    await Promise.all(Array.from({ length: Math.min(PHOTO_PARALLEL, els.length) }, worker));
  }

  function renderMap() {
    const pts = hideTest(state.data.customers).filter(c => c.lat && c.lng); // 抓BUG第4輪 主管組2：地圖同日曆，隱藏測試帳號的客戶
    if (!pts.length) return '<p class="empty">還沒有田區座標。業務第一次拜訪時的位置會自動記成田區座標。<span class="my">လယ်ကွက် တည်နေရာ မရှိသေးပါ။ ဝန်ထမ်း ပထမဆုံး သွားရောက်သည့် တည်နေရာကို အလိုအလျောက် မှတ်သားပေးမည်။</span></p>';
    const lats = pts.map(c => c.lat), lngs = pts.map(c => c.lng);
    const pad = 0.02, minLat = Math.min(...lats) - pad, maxLat = Math.max(...lats) + pad, minLng = Math.min(...lngs) - pad, maxLng = Math.max(...lngs) + pad;
    const W = 700, H = 420;
    const x = v => 50 + (v - minLng) / (maxLng - minLng) * (W - 160), y = v => 30 + (maxLat - v) / (maxLat - minLat) * (H - 60);
    const color = s => s === 'late' ? 'var(--chili)' : s === 'due' ? 'var(--turmeric)' : s === 'stop' ? '#9a9a9a' : 'var(--paddy)';
    return `<div class="card map"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="田區位置圖">
      <rect width="${W}" height="${H}" fill="var(--bg)" rx="8"/>
      ${pts.map(c => { const s = dueState(c);
      return `<g data-go="${esc(c.id)}" style="cursor:pointer"><circle cx="${x(c.lng)}" cy="${y(c.lat)}" r="${s === 'late' ? 12 : 8}" fill="${color(s)}" fill-opacity=".85" stroke="var(--surface)" stroke-width="2"/>
        <text x="${x(c.lng) + 15}" y="${y(c.lat) + 4}" fill="var(--fg)" font-size="12" font-weight="700">${esc(c.name)}</text></g>`; }).join('')}
      </svg><div class="legend"><span style="--c:var(--paddy)">已排定</span><span style="--c:var(--turmeric)">今天該去</span><span style="--c:var(--chili)">逾期（大圓點）</span><span style="--c:#9a9a9a">暫停／已結束<span class="my">ခေတ္တရပ်／ပြီးဆုံးပြီး</span></span></div></div>
      <ul class="list" style="margin-top:10px">${pts.map(c => `<li>${esc(c.name)}・${esc(c.area || '')}　<a href="https://www.google.com/maps/search/?api=1&query=${c.lat}`
        + `,${c.lng}" target="_blank" rel="noopener">用 Google 地圖導航 ↗</a></li>`).join('')}</ul>`;
  }

  /* ───── 試作報告列表（2B）：依結果、地區、業務篩選，下載 Word ───── */
  function renderReports() {
    const ts = (state.data.trials || []).slice().sort((a, b) => String(b.end || b.start).localeCompare(String(a.end || a.start)));
    if (!ts.length) return '<p class="empty">還沒有試作。業務在打卡網頁選「試作」或「推廣」→「開始新的試作」，結束時填結果，報告會自動產生在這裡。<span class="my">စမ်းသပ်မှု မရှိသေးပါ။ ဝန်ထမ်း မှတ်တမ်းတင် ဝဘ်တွင် 「စမ်းသပ်」 သို့မဟုတ် 「မြှင့်တင်」 → 「စတင်」 ရွေးပြီး ပြီးဆုံးချိန် ရလဒ်ဖြည့်လျှင် ဤနေရာတွင် အစီရင်ခံစာ အလိုအလျောက် ပေါ်လာမည်။</span></p>';
    const f = state.rf;
    const opt = (key, label, values) => `<select data-filter="${key}" aria-label="${label}"><option value="">全部${label}</option>${values.map(v => `<option value="${esc(v)}`
      + `"${f[key] === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
    const uniq = k => [...new Set(ts.map(t => t[k]).filter(Boolean))];
    const list = ts.filter(t => (!f.status || t.status === f.status) && (!f.area || t.area === f.area) && (!f.staff || t.staff === f.staff) && (!f.cat || t.cat === f.cat));
    const pill = s => `<span class="pill ${s === '成功' ? 'p-grn' : s === '失敗' ? 'p-red' : s === '進行中' ? 'p-yel' : ''}">${esc(s)}</span>`;
    const rep = t => t.hasReport ? `<button class="btn" type="button" data-report="${esc(t.id)}">⬇ 下載 Word</button>`
      : t.report === '待產生' ? '<span class="sub">報告產生中（約 10 分鐘）<span class="my">အစီရင်ခံစာ ထုတ်နေသည်（၁၀ မိနစ်ခန့်）</span></span>' : t.report === '產生失敗' ? '<span class="pill p-red">報告產生失敗，請看錯誤紀錄<span class="my">အစီရင်ခံစာ ထုတ်မရပါ၊ အမှား မှတ်တမ်းတွင် ကြည့်ပါ</span></span>' : '<span class="sub">結束後才有報告<span class="my">ပြီးဆုံးပြီးမှ အစီရင်ခံစာ ထွက်မည်</span></span>';
    return `<div class="filters">${opt('status', '結果', ['進行中', '成功', '失敗', '結束'])}${opt('cat', '類別', uniq('cat'))}${opt('area', '地區', uniq('area'))}${opt('staff', '業務', uniq('staff'))}</div>
      <div class="tbl"><table><thead><tr><th>編號</th><th>類別</th><th>客戶</th><th>品項</th><th>期間</th><th>結果</th><th>量測</th><th>報告</th></tr></thead><tbody>
      ${list.map(t => `<tr><td>${esc(t.id)}</td><td>${esc(t.cat)}</td><td><a href="javascript:void 0" data-go="${esc(t.cid)}">${esc(t.name)}</a><br><span class="sub">${esc(t.area || '')}`
        + `・${staffTag(t.staff, '')}</span></td>
        <td>${esc(t.item || '—')}<br><span class="sub">${esc(t.dosage || '')}</span></td><td>${esc(t.start || '')} ～ ${esc(t.end || '')}</td><td>${pill(t.status)}`
          + `${t.reason ? `<br><span class="sub">${esc(t.reason)}</span>` : ''}</td>
        <td class="sub">${[t.height !== '' && t.height != null ? '株高／အပင်အမြင့် ' + esc(t.height) : '', t.grains !== '' && t.grains != null ? '穗粒／အစေ့ ' + esc(t.grains) : '', t.yield !== '' && t.yield != null ? '產量／အထွက်နှုန်း ' + esc(t.yield) + ' ' + esc(t.yieldUnit || '') : '', t.score ? '評分／အမှတ် ' + esc(t.score) : ''].filter(Boolean).join('<br>') || '—'}`
          + `</td><td>${rep(t)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">沒有符合篩選的試作<span class="my">စစ်ထုတ်မှုနှင့် ကိုက်ညီသော စမ်းသပ်မှု မရှိပါ</span></td></tr>'}
      </tbody></table></div><p class="sub">共 ${list.length} 件。Word 報告也存在該客戶的雲端硬碟資料夾。<span class="my">စုစုပေါင်း ${list.length} ခု။ Word အစီရင်ခံစာကို ထိုဖောက်သည်၏ Drive ဖိုင်တွဲတွင်လည်း သိမ်းထားသည်။</span></p>`;
  }

  /** base64 → 檔案下載（錄音報告用；0526 抓BUG C3：原本 Uint8Array.from(atob, 每字一個函式) 幾 MB 慢 20～40 倍，改一般迴圈） */
  function saveB64(data, mime, name) {
    const s = atob(data), bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  // 0526 抓BUG C2：錄音報告的進度、結果訊息附緬文（緬文示意，待校對）
  const AREQ_MSG = {
    busy: '正在做錄音報告，約需一兩分鐘…／အသံ အစီရင်ခံစာ ပြုလုပ်နေသည်၊ ၁～၂ မိနစ်ခန့် စောင့်ပါ…',
    partial: '已下載，但報告不完整（原因在報告最後；過半小時再按會重做）／ဒေါင်းလုဒ်ပြီး၊ သို့သော် အစီရင်ခံစာ မပြည့်စုံပါ (အကြောင်းရင်း အစီရင်ခံစာ အဆုံးတွင် ကြည့်ပါ၊ နာရီဝက်ကြာမှ ထပ်နှိပ်လျှင် ပြန်ထုတ်မည်)',
    timeout: '報告還在做，過一兩分鐘再按一次就能下載／အစီရင်ခံစာ ပြုလုပ်နေဆဲ၊ ၁～၂ မိနစ်နေမှ ထပ်နှိပ်လျှင် ဒေါင်းနိုင်မည်',
    fail: '下載失敗，請再試／ဒေါင်းလုဒ် မအောင်မြင်ပါ၊ ထပ်ကြိုးစားပါ',
    server: '／မအောင်မြင်ပါ၊ ခဏနေမှ ထပ်နှိပ်ပါ' // 接在後台的中文訊息後面
  };
  /** 錄音報告：一筆拜訪一個狀態（中文、緬文兩顆共用，後台按一顆就兩種一起做）；更新「現在畫面上」的按鈕和訊息，不用按下去那顆的舊參照（重畫後它已經不在畫面上） */
  async function downloadAudioReport(btn) {
    const id = btn.dataset.areport;
    if (state.areq[id] && state.areq[id].busy) return;
    const setQ = (busy, msg) => {
      state.areq[id] = { busy, msg };
      document.querySelectorAll('[data-areport]').forEach(b => { if (b.dataset.areport === id) b.disabled = busy; });
      document.querySelectorAll('[data-areqmsg]').forEach(s => { if (s.dataset.areqmsg === id) s.textContent = msg; });
    };
    setQ(true, AREQ_MSG.busy);
    try {
      const r = await api({ action: 'audioReport', visitId: id, lang: btn.dataset.lang === 'my' ? 'my' : 'zh' });
      if (!r.ok) { setQ(false, (r.message || '下載失敗') + AREQ_MSG.server); return; }
      if (!r.data) { setQ(false, AREQ_MSG.fail); return; }
      saveB64(r.data, r.mime, r.name);
      setQ(false, r.complete === false ? AREQ_MSG.partial : '');
    } catch (e) {
      setQ(false, e && e.timeout ? AREQ_MSG.timeout : AREQ_MSG.fail);
    }
  }
  async function downloadReport(btn) {
    if (btn.dataset.areport) return downloadAudioReport(btn); // 0.5.26 錄音報告
    // 0.4.75（1號主管清單低9）：存 innerHTML，緬文小字才不會黏成一串
    // 0.4.85 低4：原文字記在 data 屬性（第一次按才記）——失敗一次後按鈕變成錯誤訊息，再按時不能把錯誤訊息當原文字
    if (btn.dataset.label == null) btn.dataset.label = btn.innerHTML;
    const label = btn.dataset.label;
    btn.textContent = '下載中…／ဒေါင်းနေသည်'; btn.disabled = true;
    try {
      const r = await api({ action: 'report', trialId: btn.dataset.report });
      if (!r.ok) { btn.textContent = r.message || '下載失敗／ဒေါင်းလုဒ် မအောင်မြင်'; return; }
      // 試作報告這段自己寫完整（不叫 saveB64）：舊測試 test-boss0485 只拿 downloadReport 單獨跑；解碼一樣用一般迴圈（0526 抓BUG C3）
      const s = atob(r.data), bytes = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
      const a = document.createElement('a'); a.href = url; a.download = r.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      btn.innerHTML = label;
    } catch (e) {
      btn.textContent = '下載失敗，請再試／မအောင်မြင်';
    } finally { btn.disabled = false; }
  }

  /* ───── 工作進度（2C）：每位業務的數字、月計劃達成、各地區統計 ───── */
  function monthsBack(n) {
    const out = [];
    const [y, m] = state.data.today.split('-').map(Number);
    for (let i = 0; i < n; i++) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(d.toISOString().slice(0, 7)); }
    return out;
  }
  function renderProgress() {
    const months = monthsBack(6);
    if (!state.pm) state.pm = months[0];
    const sel = `<div class="filters"><select data-month="1" aria-label="月份">${months.map(m => `<option value="${m}"${m === state.pm ? ' selected' : ''}>${m.slice(0, 4)}`
      + ` 年 ${Number(m.slice(5))} 月／${m.slice(0, 4)} နှစ် ${Number(m.slice(5))} လ</option>`).join('')}</select></div>`;
    const p = state.prog[state.pm];
    if (!p) return sel + '<p class="sub">讀取中…<span class="my">ဖတ်နေသည်</span></p>';
    if (!p.ok) return sel + `<p class="empty">${esc(p.message || '讀取失敗／ဖတ်ရှုမှု မအောင်မြင်')}</p>`;
    const planHtml = list => list.length ? `<div class="plans">${list.map(x => `<span>${esc(x.label)}（${esc(x.period)}）<span class="bar"><i style="width:${Math.max(0, Math.min(100, x.pct))}`
      + `%"></i></span>${x.done}／${x.target}${x.done >= x.target ? ' <span class="pill p-grn">達成</span>' : ''}${planParts(x)}</span>`).join('')}</div>` : '<span class="sub">沒有目標<span class="my">ပစ်မှတ် မရှိပါ</span></span>';
    const cats = ['試作', '推廣', '農戶', '盤商', '種子商']; // 「農戶」顯示成「一般拜訪」；盤商、種子商分開算（2026-11-11 董事長）
    // 0.4.85 中5：各地區表選過去月份時只有拜訪數照月份，客戶數、進行中試作是今天的 → 表頭寫所選月份、那幾欄標（目前）
    // 第26任 抓BUG第2輪 主管組5：各地區表預設排除測試帳號（後台 regions），勾「顯示測試資料」才用含測試帳號的 regionsAll（舊後台沒有就照用 regions）
    // 第24任 第七批設計版 K：一張全員對照表（一列一人：拜訪、新客戶、試作、三個目標達成率）；全部是 0 的人收到表格下面一行；測試帳號預設不列
    const ppl = p.staff.filter(x => state.showTest || !isTestStaff(x.name));
    const zero = x => !x.visits && !x.newCustomers && !x.trialsStarted && !x.trialsEnded && !(x.plan || []).some(y => y.done);
    const goal = (x, i) => { const g = (x.plan || [])[i]; return g ? `${esc(g.label)} <b>${Math.round(Math.max(0, Number(g.pct) || 0))}%</b>（${g.done}／${g.target}）` : '—'; };
    const live = ppl.filter(x => !zero(x)), idle = ppl.filter(zero);
    return sel + `<h3>全員對照（${esc(p.label)}）<span class="my">အားလုံး နှိုင်းယှဉ်（${esc(p.label)}）</span></h3><div class="tbl"><table><thead><tr><th>業務</th><th>拜訪</th>${cats.map(c => `<th>${c === '農戶' ? '一般拜訪' : c}</th>`).join('')}<th>拜訪過的客戶</th><th>新增客戶</th><th>試作 開始／完成</th><th>目標 1<span class="my">ပစ်မှတ် ၁</span></th><th>目標 2<span class="my">ပစ်မှတ် ၂</span></th><th>目標 3<span class="my">ပစ်မှတ် ၃</span></th></tr></thead><tbody>
      ${live.map(x => `<tr><td data-label="業務／ဝန်ထမ်း"><b>${esc(x.name)}</b></td><td data-label="拜訪／သွားရောက်">${x.visits}</td>${cats.map(c => `<td data-label="${c === '農戶' ? '一般拜訪／ပုံမှန်သွားရောက်' : c}`
        + `">${(x.byCategory || {})[c] || 0}</td>`).join('')}`
        + `<td data-label="拜訪過的客戶／သွားခဲ့သော ဖောက်သည်">${x.customersVisited}</td><td data-label="新增客戶／ဖောက်သည်အသစ်">${x.newCustomers}</td><td data-label="試作 開始／完成／စမ်းသပ် စ／ပြီး">${x.trialsStarted}`
        + `／${x.trialsEnded}</td><td data-label="目標 1／ပစ်မှတ် ၁">${goal(x, 0)}</td><td data-label="目標 2／ပစ်မှတ် ၂">${goal(x, 1)}</td><td data-label="目標 3／ပစ်မှတ် ၃">${goal(x, 2)}</td></tr>`).join('') || `<tr><td colspan="13" class="empty">${ppl.length ? '本月大家都還沒有紀錄<span class="my">ဤလတွင် အားလုံး မှတ်တမ်း မရှိသေးပါ</span>' : '沒有業務帳號<span class="my">ဝန်ထမ်း အကောင့် မရှိပါ</span>'}</td></tr>`}
      </tbody></table></div>${idle.length ? `<p class="sub notask">本月尚無紀錄／ဤလ မှတ်တမ်း မရှိသေး：${idle.map(x => esc(x.name)).join('、')}</p>` : ''}
      <details class="plandet"><summary>每位業務的目標明細<span class="my">ဝန်ထမ်းတစ်ဦးချင်း ပစ်မှတ် အသေးစိတ်</span></summary><ul class="list">${ppl.map(x => `<li><b>${esc(x.name)}`
        + `</b> ${planHtml(x.plan)}</li>`).join('')}</ul></details>
      <h3>各地區（${esc(p.label)}）<span class="my">ဒေသအလိုက်（${esc(p.label)}）</span></h3><div class="tbl"><table><thead><tr><th>地區</th><th>農民（目前）<span class="my">လယ်သမား（လက်ရှိ）</span></th><th>盤商（目前）<span class="my">ကုန်သည်（လက်ရှိ）</span></th><th>種子商（目前）<span class="my">မျိုးစေ့ဆိုင်（လက်ရှိ）</span></th><th>${Number(state.pm.slice(5))} 月拜訪<span class="my">${Number(state.pm.slice(5))} လ သွားရောက်မှု</span></th><th>進行中的試作（目前）<span class="my">လုပ်ဆောင်ဆဲ စမ်းသပ်မှု（လက်ရှိ）</span></th></tr></thead><tbody>      ${(state.showTest && p.regionsAll ? p.regionsAll : p.regions).map(r => `<tr><td>${esc(r.area)}`
        + `</td><td>${r.customers}</td><td>${r.dealers}</td><td>${r.seeds || 0}</td><td>${r.visits}</td><td>${r.trialsActive}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">還沒有客戶<span class="my">ဖောက်သည် မရှိသေးပါ</span></td></tr>'}
      </tbody></table></div><p class="sub">目標在試算表「計劃」分頁設定：月份空白＝每個月都適用；業務空白＝每位業務各自的目標；指標有拜訪次數、拜訪客戶數、新增客戶、開始試作、完成試作、簽約（盤商、種子商結案「已簽約」；還在等主管確認、被退回的不算；類別空白＝兩種都算）。新增客戶的類別填「農戶」時，會另外列出試作、推廣、一般農民各幾位。<span class="my">ပစ်မှတ်ကို Sheet 「စီမံချက်」 စာမျက်နှာတွင် သတ်မှတ်သည် - လ အလွတ်＝လစဉ် အကျုံးဝင်； ဝန်ထမ်း အလွတ်＝ဝန်ထမ်းတစ်ဦးချင်းစီ၏ ပစ်မှတ်； အညွှန်းများမှာ သွားရောက်မှု အကြိမ်၊ သွားခဲ့သော ဖောက်သည်၊ ဖောက်သည်အသစ်၊ စမ်းသပ် စတင်၊ စမ်းသပ် ပြီးဆုံး၊ စာချုပ်ချုပ် (ကုန်သည်/မျိုးစေ့ဆိုင် စာချုပ်ချုပ်ပြီး； စစ်ဆေးဆဲ/ပြန်ပို့ မပါ； အမျိုးအစား အလွတ်＝နှစ်မျိုးလုံး တွက်သည်)။ ဖောက်သည်အသစ်တွင် 「လယ်သမား」 ဖြည့်ပါက စမ်းသပ်၊ မြှင့်တင်၊ ပုံမှန် အရေအတွက် ထပ်ခွဲပြမည်။</span></p>`;
  }
  /* ───── 任務：主管、總經理派給業務（每條跟著一位農民）；總經理另外派給主管（可以不指定客戶）（2026-11-12）─────
     業務在手機打勾；主管在這裡「我的任務」按「完成了」 */
  const isGM = () => state.data.role === '總經理';
  // 總經理BUG(2號)中2：主管看過的回覆時間記在這台電腦（不加試算表欄位）；回覆時間變了＝有新回覆。換電腦第一次會全部標新回覆
  function seenKey() { return 'farm-brief-seen-' + String((state.data && state.data.account) || ''); }
  // 讀不到瀏覽器儲存（無痕模式、被擋）回 null：記不住看過沒，就不標新回覆（不然每次打開都一直亮紅點）
  function seenReplies() { try { if (typeof localStorage === 'undefined') return null; return JSON.parse(localStorage.getItem(seenKey()) || '{}') || {}; } catch (e) { return null; } }
  function markReplySeen(b) { const s = seenReplies(); if (!s) return; s[b.id] = String(b.replyAt || ''); try { localStorage.setItem(seenKey(), JSON.stringify(s)); } catch (e) { /* 無痕模式存不了 */ } }
  function newReply(b) {
    if (!(b && b.reply && b.replyAt && state.data && state.data.role !== '總經理')) return false;
    const s = seenReplies(); return !!s && s[b.id] !== String(b.replyAt);
  }
  // 0.4.24：客戶已結案、任務還沒做 → 標出來，主管看得到該取消；0.4.25 主管「我的任務」也標（第5任獨立審查 低4）
  const closedPill = t => (t.status === '待辦' && t.cid && (state.data.customers || []).some(c => c.id === t.cid && c.status === '已結束') ? '<span class="pill p-red">客戶已結案<span class="my">ဖောက်သည် ပိတ်သိမ်းပြီး</span></span> ' : '');
  function taskLine(t, cancel) {
    const who = t.cid ? `<b><a href="javascript:void 0" data-go="${esc(t.cid)}">${esc(t.name)}</a></b>：` : '';
    // 0.4.24：客戶已結案、任務還沒做 → 標出來，主管看得到該取消（業務手機上這條也沒有「去拜訪」了）
    return `<li>${who}${closedPill(t)}${t.by === '系統建議' ? '<span class="pill p-yel">系統</span> ' : ''}${esc(t.text)}
        <span class="sub">${esc(t.by || '')} ${esc(String(t.at).slice(5, 16))} 派／ပေး</span>${cancel ? ` <button class="btn" type="button" data-taskcancel="${esc(t.id)}">取消</button>` : ''}</li>`;
  }
  function renderTasks() {
    const d = state.data;
    const tasks = d.tasks || [];
    const max = d.maxTasks || 10;
    const staff = d.staffList || []; // [{ account, name }]：用帳號派，同名也分得出來（R4-04）
    const bosses = isGM() ? (d.bossList || []) : [];
    const isBossAcct = acct => bosses.some(b => b.account === acct);
    const farmers = d.customers.filter(c => (c.type || '農民') === '農民' && c.status !== '已結束').sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const allCust = d.customers.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const first = staff[0] || bosses[0];
    const f = state.tf || (state.tf = { staff: first ? first.account : '', cid: '', text: '' });
    const toBoss = isBossAcct(f.staff);
    const openOf = acct => tasks.filter(t => t.status === '待辦' && t.account === acct);
    // 主管自己的任務（總經理派的）：放最上面，按「完成了」
    const mine = d.role === '主管' ? openOf(d.account) : [];
    const myBox = d.role === '主管' ? `<h3>我的任務 <span class="sub">（總經理派給你的）<span class="my">（အထွေထွေမန်နေဂျာက သင့်ထံ ပေးထားသည်）</span></span></h3><ul class="mytasks">${mine.map(t => `<li><span>${t.cid ? `<b><a href="javascript:void 0" data-go="${esc(t.cid)}`
      + `">${esc(t.name)}</a></b>：` : ''}`
      + `${closedPill(t)}${esc(t.text)}
        <span class="sub">${esc(t.by || '')} ${esc(String(t.at).slice(5, 16))} 派／ပေး</span></span><button class="btn" type="button" data-mytaskdone="${esc(t.id)}">完成了</button></li>`).join('') || '<li class="empty">沒有任務</li>'}</ul>` : '';
    const opt = s => `<option value="${esc(s.account)}"${f.staff === s.account ? ' selected' : ''}>${esc(s.name)}（${esc(s.account)}）</option>`;
    const custSel = toBoss
      ? `<select id="tFarmer" aria-label="哪一位客戶（可以不選）"><option value="">— 不指定客戶／ဖောက်သည် မရွေး —</option>${allCust.map(c => `<option value="${esc(c.id)}"${f.cid === c.id ? ' selected' : ''}`
        + `>${esc(c.name)}｜${esc(c.kind || c.type || '農民')}${c.area ? '｜' + esc(c.area) : ''}</option>`).join('')}</select>`
      : (() => {
        // 0.4.94（第11任第五輪 7）：選了業務後，他自己負責的農民排前面（分兩組）
        const selName = ((staff.find(s => s.account === f.staff) || {}).name) || '';
        const fo = c => `<option value="${esc(c.id)}"${f.cid === c.id ? ' selected' : ''}>${esc(c.name)}${c.area ? '｜' + esc(c.area) : ''}${c.staff ? '（' + staffTag(c.staff) + '）' : ''}</option>`;
        // 第24任 第七批設計版 J：選了業務後只列他負責的農民（原本其他人的也列在後面，名單太長）
        const own = selName ? farmers.filter(c => c.staff === selName) : farmers;
        const pre = f.cid && own.indexOf(farmers.find(c => c.id === f.cid)) < 0 ? farmers.find(c => c.id === f.cid) : null; if (pre) own.push(pre); // 第26任 低風險修正3①：從可疑拜訪「派任務追問」帶過來的客戶不是這位業務負責的 → 也列進選單（原本選單空白、送出說「請選一位農民」）
        return `<select id="tFarmer" aria-label="哪一位農民"><option value="">${own.length ? '— 不指定農民（一般任務）—' : '（這位業務沒有負責的農民）／（ဤဝန်ထမ်းတွင် တာဝန်ယူသော လယ်သမား မရှိပါ）'}</option>`
          + own.map(fo).join('') + '</select>';
      })();
    const form = staff.length || bosses.length ? `<h3>派出任務</h3><form class="taskform" id="taskForm">
        <select id="tStaff" aria-label="派給誰">${bosses.length ? `<optgroup label="業務">${staff.map(opt).join('')}</optgroup><optgroup label="主管">${bosses.map(opt).join('')}</optgroup>` : staff.map(opt).join('')}`
          + `</select>
        ${custSel}
        <input id="tText" maxlength="200" placeholder="${toBoss ? '任務內容，例如：這週整理 A 區價格、陪新業務跑一趟／လုပ်ငန်း အကြောင်းအရာ၊ ဥပမာ - ဤအပတ် A ဒေသ ဈေးစုရန်၊ ဝန်ထမ်းသစ်နှင့် လိုက်သွားရန်' : '任務內容，例如：送肥料樣品、量株高／လုပ်ငန်း အကြောင်းအရာ၊ ဥပမာ - မြေသြဇာ နမူနာ ပို့ရန်၊ အပင်အမြင့် တိုင်းရန်'}`
          + `" value="${esc(f.text)}">
        <button class="btn" type="submit" id="tAdd">${toBoss ? '派給主管' : '派給業務'}</button>
        <span class="sub" id="tMsg" aria-live="polite">${esc(state.taskMsg || '')}</span></form>`
      : '<p class="empty">還沒有啟用的業務帳號，先在「更多 → 業務帳號」開通。<span class="my">ဖွင့်ထားသော ဝန်ထမ်း အကောင့် မရှိသေးပါ၊ 「နောက်ထပ် → ဝန်ထမ်း အကောင့်」 တွင် အရင်ဖွင့်ပါ။</span></p>';
    const block = (s, canCancel) => {
      const list = openOf(s.account);
      if (!list.length) return ''; // 第24任 第七批設計版 J：沒任務的人合成一行（見 noTask）
      return `<h3>${esc(s.name)}（${esc(s.account)}）　<span class="sub">還有 ${list.length} 件沒做完（每人最多 ${max} 件）<span class="my">မပြီးသေး ${list.length} ခု ကျန်（တစ်ဦး အများဆုံး ${max}`
        + ` ခု）</span></span></h3><ol class="tasks">${list.map(t => taskLine(t, canCancel)).join('')}</ol>`;
    };
    // 收任務的帳號查不到（被改名、刪掉）：只有總經理看得到、能取消（R8-07）
    // 主管BUG#5（1號 0.4.63）：帳號停用的人不在 staffList／bossList，他沒做完的任務原本整條消失、取消不了，卻還佔 10 條上限
    // → 不在名單裡的待辦都列出來：總經理看全部；主管看派給業務的（後台 taskCancel_ 本來就允許主管取消業務的任務）
    const listed = new Set(staff.concat(bosses).map(s => String(s.account)));
    const orphan = tasks.filter(t => t.status === '待辦' && !listed.has(String(t.account)) && (isGM() || t.role === '業務'));
    const noTask = arr => { const z = arr.filter(s => !openOf(s.account).length); return z.length ? `<p class="sub notask">沒有任務／လုပ်ငန်း မရှိ：${z.map(s => esc(s.name)).join('、')}</p>` : ''; };
    const open = staff.map(s => block(s, true)).join('') + noTask(staff) + (bosses.length ? '<h3>派給主管的任務</h3>' + bosses.map(s => block(s, true)).join('') + noTask(bosses) : '')
      + (orphan.length ? `<h3>帳號停用或查不到的人沒做完的任務<span class="my">အကောင့် ပိတ်ထားသူ သို့မဟုတ် ရှာမတွေ့သူ၏ မပြီးသေးသော လုပ်ငန်းများ</span> <span class="sub">（帳號停用、改名或刪掉；可以按取消，免得佔掉 10 條上限）<span class="my">（အကောင့် ပိတ်ထားခြင်း၊ နာမည်ပြောင်းခြင်း သို့မဟုတ် ဖျက်လိုက်ခြင်း ဖြစ်နိုင်သည်၊ ၁၀ ခု ကန့်သတ်ချက် မပြည့်စေရန် ပယ်ဖျက်နိုင်သည်）</span></span></h3><ol class="tasks">${orphan.map(t => taskLine(t, true).replace('</li>', ` <span class="sub">｜${staffTag(t.staff)}`
        + `（${esc(t.account)}）</span></li>`)).join('')}</ol>` : '');
    // 完成清單：主管看不到總經理派給別的主管的任務
    const done = tasks.filter(t => t.status !== '待辦' && (t.role !== '主管' || isGM() || t.account === d.account)).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
    return myBox + form + open + `<h3>最近 30 天完成或取消的</h3><ul class="donetasks">${done.map(t => `<li>${t.status === '已完成' ? '<span class="pill p-grn">完成</span>' : '<span class="pill">取消</span>'}
      ${t.cid ? `<b>${esc(t.name)}</b>：` : ''}${t.by === '系統建議' ? '<span class="pill p-yel">系統</span> ' : ''}${esc(t.text)}<span class="sub">｜${staffTag(t.staff)}`
        + `${t.role === '主管' ? '（主管／မန်နေဂျာ）' : ''}｜${esc(String(t.doneAt).slice(5, 16))}${t.doneBy === '系統（已拜訪）' ? '（去拜訪後自動完成／သွားရောက်ပြီးနောက် အလိုအလျောက် ပြီးဆုံးမည်）' : ''}`
        + `${t.status === '取消' ? '（' + esc(t.doneBy) + ' 取消／' + esc(t.doneBy) + ' ပယ်ဖျက်）' : ''}</span></li>`).join('') || '<li class="empty">還沒有</li>'}</ul>`;
  }
  function bindTasks() {
    const form = $('taskForm');
    if (form) {
      // 0.4.85 高2（第11任 0.4.84 清單）：keep() 原本整個換掉 state.tf，送出時第一步就呼叫 → rid、ridKey 被清，斷線後再按每次都是新代號（後台認不出、派成兩條）
      // → 只更新三個欄位，原本的 rid、ridKey 留著（內容改了，送出時 ridKey 對不上才換新代號）
      const keep = () => {
        const o = state.tf || {};
        state.tf = { staff: $('tStaff').value, cid: $('tFarmer').value, text: $('tText').value, rid: o.rid || '', ridKey: o.ridKey || '' };
        if (o.seenVid) Object.assign(state.tf, { seenVid: o.seenVid, askStaff: o.askStaff, askCid: o.askCid });
      };
      ['tFarmer', 'tText'].forEach(id => $(id).addEventListener('input', keep));
      // 換對象（業務 ↔ 主管）時客戶選單不一樣，重畫；原本選的客戶清掉
      $('tStaff').addEventListener('change', () => { keep(); state.tf.cid = ''; state.taskMsg = ''; render(); });
      form.addEventListener('submit', async ev => {
        ev.preventDefault(); keep();
        const toBoss = isGM() && (state.data.bossList || []).some(b => b.account === state.tf.staff);
        // 第28任 2026-11-19 董事長：派給業務也可以不選農民（一般任務），原本這裡擋「請選一位農民」
        if (!state.tf.text.trim()) { $('tMsg').textContent = '請填任務內容／လုပ်ငန်း အကြောင်းအရာ ဖြည့်ပါ'; return; }
        $('tAdd').disabled = true; $('tMsg').textContent = '送出中…／ပို့နေသည်';
        // 0.4.66 主管BUG(2號)#4：同一個內容（同人、同農民、同字）重按用同一個送出代號，斷線後再按不會派兩條；內容改了就換新代號
        const key = state.tf.staff + '|' + state.tf.cid + '|' + state.tf.text.trim();
        if (!state.tf.rid || state.tf.ridKey !== key) { state.tf.rid = newRid(); state.tf.ridKey = key; }
        let r;
        // 第26任 老闆裁定「只給現任負責人看」：一般農民任務只能派給負責業務；審核卡帶過來的追問（seenVid）帶 ask，後台准派給拜訪的那位業務
        // 抓BUG第3輪 主管組1：追問帶到任務頁後主管換了業務／農民（改派別的事），原本照樣帶 ask、還把那筆可疑拜訪標「看過」
        //   → 業務和農民都還是追問帶來的那一組才算追問
        const isAsk = !!(state.tf.seenVid && state.tf.staff === state.tf.askStaff && state.tf.cid === state.tf.askCid);
        try { r = await api({ action: 'taskAdd', staff: state.tf.staff, cid: state.tf.cid, text: state.tf.text.trim(), rid: state.tf.rid, ask: isAsk }); } catch (e) { r = { ok: false, message: '連不上伺服器，請再按一次（不會派成兩條）／ဆာဗာနှင့် ချိတ်မရပါ၊ ထပ်နှိပ်ပါ（နှစ်ခု ဖြစ်မသွားပါ）' }; }
        if (r.ok) {
          setData({ tasks: r.tasks });
          state.tf.text = '';
          state.tf.rid = '';
          state.tf.ridKey = '';
          state.taskMsg = toBoss ? '已派出（主管打開主管網頁「任務」就會看到）／ပေးပို့ပြီး (မန်နေဂျာ ဝဘ် 「လုပ်ငန်း」 တွင် မြင်ရမည်)' : '已派出（業務手機下次同步就會看到）／ပေးပို့ပြီး (ဝန်ထမ်းဖုန်း နောက်တစ်ကြိမ် စင့်ခ်လုပ်လျှင် မြင်ရမည်)';
        }
        if (r.ok && isAsk) { markSeen(state.tf.seenVid); state.tf.seenVid = ''; state.tf.askStaff = ''; state.tf.askCid = ''; } // 第26任 低風險修正3①：追問的任務真的派出去，那筆可疑拜訪才標「看過」
        // 第26任 抓BUG第2輪 主管組1（高）：原本 else 接在上一行「成功且是追問」後面 → 一般派任務成功也被蓋成「⚠ 派發失敗」，主管重按就派出兩條。改成只有真的失敗才寫失敗
        if (!r.ok) state.taskMsg = '⚠ ' + (r.message || '派發失敗／မပေးနိုင်ပါ');
        render();
      });
    }
    $('panel').querySelectorAll('[data-taskcancel]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(biText('確定取消這條任務？對方畫面上會消失。', 'ဤလုပ်ငန်းကို ပယ်ဖျက်မလား။ တစ်ဖက်လူ၏ မျက်နှာပြင်မှ ပျောက်သွားမည်'))) return;
      b.disabled = true;
      let r;
      try { r = await api({ action: 'taskCancel', id: b.dataset.taskcancel }); } catch (e) { r = { ok: false, message: '連不上伺服器／ဆာဗာနှင့် ချိတ်မရပါ' }; }
      if (r.ok) { setData({ tasks: r.tasks }); state.taskMsg = '已取消／ပယ်ဖျက်ပြီး'; }
      else { if (r.tasks) setData({ tasks: r.tasks }); state.taskMsg = '⚠ ' + (r.message || '取消失敗／ပယ်ဖျက်မှု မအောင်မြင်'); } // 0.4.75（1號主管清單低6）：已經完成的照實說，清單也換成最新的
      render();
    }));
    // 主管完成自己的任務：用跟業務手機打勾同一個動作（只能完成自己的）
    $('panel').querySelectorAll('[data-mytaskdone]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      let r;
      try { r = await api({ action: 'taskDone', done: [{ id: b.dataset.mytaskdone, at: Date.now() }] }); } catch (e) { r = { ok: false, message: '連不上伺服器，請再試一次／ဆာဗာနှင့် ချိတ်မရပါ၊ ထပ်ကြိုးစားပါ' }; }
      if (r.ok && (r.done || []).indexOf(b.dataset.mytaskdone) >= 0) {
        // 主管BUG(2號)#10：先在畫面上標完成、重畫（按鈕不會卡灰），再整份重讀；重讀失敗也看得到「已完成」
        // 0.5.18（抓BUG C6）：後台說這條其實已被取消（或別的狀態）→ 照實寫，不說「已完成」（舊後台沒有 states 照舊）
        const real = r.states && r.states[b.dataset.mytaskdone];
        const fin = real && real !== '已完成' ? real : '已完成';
        const t = (state.data.tasks || []).find(x => x.id === b.dataset.mytaskdone); if (t) { t.status = '已完成'; if (fin !== '已完成') t.status = fin; state.dataGen++; }
        state.taskMsg = fin === '取消' ? '這條任務已經被取消了，不用再做／ဤလုပ်ငန်း ပယ်ဖျက်ပြီးသား' : fin === '已完成' ? '已完成／ပြီးပါပြီ' : '這條任務已經是「' + fin + '」／ဤလုပ်ငန်းသည် 「' + fin + '」 ဖြစ်ပြီးသားပါ';
        render();
        load();
        return;
      }
      state.taskMsg = '⚠ ' + (r.message || '沒有完成，請再按一次／မပြီးသေးပါ၊ ထပ်နှိပ်ပါ');
      render();
    }));
  }

  /* ───── 主管匯報（2026-11-12）：主管寫給總經理，系統附上這段期間的數字；總經理看、回覆 ───── */
  /** 0.4.94（第11任第五輪 4）：確認框、提示框「中文＋空一行＋緬文」（緬文示意，待校對） */
  const biText = (zh, mm) => zh + (mm ? '\n\n' + mm : '');
  function newRid() { const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, x => x.toString(16).padStart(2, '0')).join(''); }
  /** 匯報內容：有中文翻譯就「中文翻譯」＋「緬文原文」都列（0.4.34 董事長：主管打緬文，總經理要看到緬文跟中文） */
  function briefTexts(b) {
    const orig = `<div class="pre">${esc(b.text)}</div>`;
    if (b.zh) return `<div class="zh-box"><b>中文翻譯<span class="my">တရုတ် ဘာသာပြန်</span></b><div class="pre">${esc(b.zh)}</div></div><div class="orig-box"><b>緬文原文<span class="my">မြန်မာ မူရင်းစာ</span></b>${orig}</div>`;
    if (b.zhState === '待翻譯') return `${orig}<p class="sub">中文翻譯處理中（翻譯額度恢復後自動補上）<span class="my">တရုတ် ဘာသာပြန် လုပ်နေဆဲ（ခွဲတမ်း ပြန်ရလျှင် အလိုအလျောက် ဖြည့်ပေးမည်）</span></p>`;
    if (b.zhState === '翻譯失敗') return `${orig}<p class="sub">⚠ 中文翻譯失敗，請到試算表「主管匯報」把翻譯狀態改回「待翻譯」重試<span class="my">တရုတ် ဘာသာပြန် မအောင်မြင်ပါ၊ Sheet 「မန်နေဂျာ အစီရင်ခံစာ」 တွင် အခြေအနေကို 「ဘာသာပြန်ရန်」 ပြောင်းပြီး ထပ်စမ်းပါ</span></p>`;
    return orig;
  }
  function briefItem(b, gm) {
    const unread = gm && !b.read;
    const fresh = !gm && newReply(b); // 總經理BUG(2號)中2：主管看得到「新回覆」
    return `<details class="brief" data-brief="${esc(b.id)}"${unread ? ' data-unread="1"' : ''}${fresh ? ' data-newreply="1"' : ''}${state.briefOpen === b.id ? ' open' : ''}>
      <summary>${unread ? '<span class="pill p-red">未讀</span>' : ''}${fresh ? '<span class="pill p-red">新回覆<span class="my">ပြန်စာ အသစ်</span></span>' : ''}${b.reply ? '<span class="pill p-grn">已回覆</span>' : ''}`
        + `<b>${esc(b.boss)}</b>
        <span class="sub">${esc(b.from)} ～ ${esc(b.to)}・${esc(String(b.date).slice(5, 16))} 送出／ပို့ပြီး</span></summary>
      <div class="body">${briefTexts(b)}
        <div class="stats-box"><b>系統附上的數字</b><div class="pre">${esc(b.stats)}</div></div>
        ${b.reply ? `<div class="answer"><b>總經理回覆</b><span class="sub">（${esc(b.replyBy)} ${esc(String(b.replyAt).slice(5, 16))}）</span><div class="pre">${esc(b.reply)}</div></div>` : ''}
        ${gm ? `<form class="reply" data-replyform="${esc(b.id)}"><textarea maxlength="1000" placeholder="${b.reply ? '補充回覆給 ' + esc(b.boss) + '（會接在上一則回覆後面，不會蓋掉）／' + esc(b.boss) + ' ထံ ဖြည့်စွက် ပြန်စာ（ယခင် ပြန်စာ နောက်တွင် ဆက်တွဲမည်၊ ဖုံးမသွားပါ）' : '回覆給 ' + esc(b.boss) + '（例如：好，下週先處理 A 區）／' + esc(b.boss) + ' ထံ ပြန်စာ（ဥပမာ - ဟုတ်ကဲ့၊ နောက်အပတ် A ဒေသ အရင်လုပ်ပါမည်）'}`
          + `" aria-label="回覆">${esc((state.replyDraft || {})[b.id] || '')}</textarea>
          <button class="btn" type="submit">送出回覆</button></form>` : ''}
      </div></details>`;
  }
  function renderBriefs() {
    const d = state.data, gm = isGM();
    const list = d.briefs || [];
    if (!d.briefReady) return '<p class="err">試算表還沒有「主管匯報」分頁，請管理員在試算表按「農業CRM → 第一次安裝／升級」一次。<span class="my">Sheet တွင် 「မန်နေဂျာ အစီရင်ခံစာ」 စာမျက်နှာ မရှိသေးပါ၊ စီမံသူကို Sheet တွင် 「စိုက်ပျိုးရေးCRM → ပထမအကြိမ် တပ်ဆင်／အပ်ဒိတ်」 တစ်ကြိမ် နှိပ်ခိုင်းပါ။</span></p>';
    const msg = state.briefMsg ? `<p class="sub" role="status">${esc(state.briefMsg)}</p>` : '';
    if (gm) return msg + `<h3>全部匯報 <span class="sub">（${list.filter(b => !b.read).length} 份未讀；打開就算看過）<span class="my">（${list.filter(b => !b.read).length} ခု မဖတ်ရသေး၊ ဖွင့်ကြည့်လျှင် ဖတ်ပြီးဟု မှတ်မည်）</span></span></h3>`
      + (list.map(b => briefItem(b, true)).join('') || '<p class="empty">還沒有</p>');
    const bf = state.bf || (state.bf = { text: '', rid: '', sentText: '' });
    // 送出後沒收到確認（sentText 有值）：內容鎖住不能改，只能用同一個送出代號再送一次確認；
    // 要改內容就按「放棄確認、改成新的一份」（舊的那份可能已經送到）（GPT-6.1 R8-05）
    const pending = !!bf.sentText;
    return `<h3>寫匯報給總經理</h3><form class="briefform" id="briefForm">
        <p class="sub">寫這段期間做了什麼、遇到什麼問題、需要總經理什麼支援。系統會自動附上數字（拜訪次數、試作成功／失敗、任務、逾期回訪），期間從你上一次匯報的隔天到今天（第一次＝最近 7 天）。送出後會寄通知信給總經理。<span class="my">ဤကာလအတွင်း လုပ်ခဲ့သည်များ၊ ကြုံရသည့် ပြဿနာများနှင့် အထွေထွေမန်နေဂျာထံမှ လိုအပ်သည့် အကူအညီများ ရေးပါ။ စနစ်က ကိန်းဂဏန်းများ（သွားရောက်မှု အကြိမ်၊ စမ်းသပ် အောင်မြင်／မအောင်မြင်၊ လုပ်ငန်း၊ ရက်ကျော် ပြန်သွားရန်）ကို အလိုအလျောက် ထည့်ပေးမည်၊ ကာလမှာ ယခင် အစီရင်ခံစာ နောက်တစ်ရက်မှ ယနေ့အထိ ဖြစ်သည်（ပထမအကြိမ်＝နောက်ဆုံး ၇ ရက်）။ ပို့ပြီးလျှင် အထွေထွေမန်နေဂျာထံ အကြောင်းကြားစာ ပို့မည်။</span></p>
        ${pending ? '<p class="err" role="status">上一次送出沒有收到確認，內容先鎖住；請按「再送一次確認」（不會變成兩份）。<span class="my">ယခင်တစ်ကြိမ် ပို့မှု အတည်ပြုချက် မရသေး၍ စာကို သော့ခတ်ထားသည်၊ 「ထပ်ပို့ပြီး အတည်ပြု」 ကို နှိပ်ပါ（နှစ်စောင် ဖြစ်မသွားပါ）။</span></p>' : ''}`
          + `
        <textarea id="bText" maxlength="2000" placeholder="例如：這週 A 區拜訪 12 次，U Myo Min 試作成功；B 區兩位農民缺肥料，需要總經理同意先送樣品。" aria-label="匯報內容"${pending ? ' readonly' : ''}`
          + `>${esc(pending ? bf.sentText : bf.text)}</textarea>
        <button class="btn primary" type="submit" id="bSend">${pending ? '再送一次確認' : '送出匯報'}</button>
        ${pending ? '<button class="btn" type="button" id="bNew">放棄確認、改成新的一份</button>' : ''}</form>` + msg +
      `<h3>我送出的匯報</h3>` + (list.map(b => briefItem(b, false)).join('') || '<p class="empty">還沒有</p>');
  }
  /** 標已讀／回覆後的未讀數：後台有回 briefUnread 就用；舊後台沒回就用清單自己算（清單已含 100 份以外的舊未讀） */
  const briefUnreadOf = r => (r && r.briefUnread != null ? Number(r.briefUnread) || 0 : (r && r.briefs || []).filter(b => !b.read).length);
  // 第26任 2026-11-18 老闆「拆冗長函式」：bindBriefs 68 行拆成送匯報表單、展開標已讀、回覆表單三段（只搬位置）
  function bindBriefs() {
    const form = $('briefForm');
    if (form) bindBriefForm(form);
    bindBriefToggles();
    bindReplyForms();
  }
  function bindBriefForm(form) {
      $('bText').addEventListener('input', () => { if (!state.bf.sentText) state.bf.text = $('bText').value; });
      if ($('bNew')) $('bNew').addEventListener('click', () => {
        if (!confirm(biText('上一份可能已經送到總經理那邊。確定要改成新的一份？（之後送出會是另一份匯報）', 'ယခင်တစ်စောင် ရောက်ပြီးဖြစ်နိုင်သည်။ အသစ်တစ်စောင် ပြောင်းရေးမလား'))) return;
        state.bf = { text: state.bf.sentText, rid: '', sentText: '' }; state.briefMsg = ''; render();
      });
      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        const text = (state.bf.sentText || $('bText').value).trim();
        if (!text) { state.briefMsg = '請先寫匯報內容／အစီရင်ခံစာ ရေးပါ'; render(); return; }
        // 同一份內容重送用同一個送出代號，網路斷掉再按一次也不會變成兩份；送出時把內容一起記住（鎖住不能改）
        if (!state.bf.rid) state.bf.rid = newRid();
        state.bf.sentText = text;
        $('bSend').disabled = true; $('bSend').textContent = '送出中…／ပို့နေသည်';
        let r;
        try { r = await api({ action: 'briefAdd', text: text, rid: state.bf.rid }); } catch (e) { r = { ok: false, message: '連不上伺服器，請按「再送一次確認」（不會變成兩份）／ဆာဗာနှင့် ချိတ်မရပါ၊ 「ထပ်ပို့ပြီး အတည်ပြု」 ကို နှိပ်ပါ（နှစ်စောင် ဖြစ်မသွားပါ）' }; }
        if (r.ok) {
          setData({ briefs: r.briefs }); state.bf = { text: '', rid: '', sentText: '' };
          // 只有確定寄出才說「已通知」；沒寄出、或重送時伺服器也不知道寄了沒，都照實說（R8-06）
          state.briefMsg = r.mailed === true ? '已送出，已通知總經理／ပို့ပြီးပါပြီ၊ အထွေထွေမန်နေဂျာထံ အကြောင်းကြားပြီး' : r.mailed === false ? '已送出（通知信沒寄出去，總經理打開主管網頁仍看得到）／ပို့ပြီးပါပြီ（အကြောင်းကြားစာ မပို့နိုင်သော်လည်း အထွေထွေမန်နေဂျာ ဝဘ်တွင် မြင်ရမည်）' : '已送出（匯報已存，通知狀態未確認；總經理打開主管網頁看得到）／ပို့ပြီးပါပြီ（အစီရင်ခံစာ သိမ်းပြီး၊ အကြောင်းကြားမှု အတည်မပြုရသေး၊ အထွေထွေမန်နေဂျာ ဝဘ်တွင် မြင်ရမည်）';
        } else if (r.code === 'RID_CONFLICT') {
          // 舊的那份其實已經送到（內容是修改前的）：解開，讓他決定要不要把修改後的另送一份
          if (r.briefs) setData({ briefs: r.briefs });
          state.bf = { text: text, rid: '', sentText: '' };
          state.briefMsg = '⚠ ' + r.message;
        } else {
          // 明確沒處理（忙碌、內容不對、還沒升級）：解開可以改；其他（斷線、伺服器出錯）可能已經存了：維持鎖住
          if (['BUSY', 'BAD_BRIEF', 'NOT_READY', 'BAD_LOGIN', 'NOT_ALLOWED'].indexOf(r.code) >= 0) state.bf = { text: text, rid: '', sentText: '' };
          state.briefMsg = '⚠ ' + (r.message || '沒有送出／မပို့ရသေးပါ');
        }
        render();
      });
  }
  function bindBriefToggles() {
    $('panel').querySelectorAll('details.brief').forEach(el => el.addEventListener('toggle', async () => {
      if (!el.open) { if (state.briefOpen === el.dataset.brief) state.briefOpen = ''; return; }
      // 重畫時本來就開著的那一份也會觸發 toggle：只有「這次才打開」才算看過
      if (state.briefOpen === el.dataset.brief) return;
      state.briefOpen = el.dataset.brief;
      if (el.dataset.newreply === '1' && !isGM()) { // 總經理BUG(2號)中2：主管打開＝看過這次回覆
        const b = (state.data.briefs || []).find(x => x.id === el.dataset.brief); if (b) { markReplySeen(b); render(); } return;
      }
      if (el.dataset.unread !== '1' || !isGM()) return;
      el.dataset.unread = '0';
      let r;
      try { r = await api({ action: 'briefRead', id: el.dataset.brief }); } catch (e) { r = { ok: false }; }
      if (r.ok) { setData({ briefs: r.briefs, briefUnread: briefUnreadOf(r) }); render(); } // 0.4.75（1號主管清單中1）：紅點跟著減
      else el.dataset.unread = '1'; // 沒成功：改回未讀，收起再打開會再標一次（自行審查 S7）
    }));
  }
  function bindReplyForms() {
    $('panel').querySelectorAll('[data-replyform]').forEach(f => {
      const id = f.dataset.replyform, ta = f.querySelector('textarea');
      ta.addEventListener('input', () => { (state.replyDraft || (state.replyDraft = {}))[id] = ta.value; });
      f.addEventListener('submit', async ev => {
        ev.preventDefault();
        if (!ta.value.trim()) { state.briefMsg = '請先寫回覆內容／ပြန်စာ အကြောင်းအရာ အရင်ရေးပါ'; render(); return; }
        f.querySelector('button').disabled = true;
        // 0.4.88 中1：重送判斷改用送出代號 rid（同匯報、派任務）。同一段內容重按用同一個 rid（網路斷掉再按不會變兩段）；內容改了就換新 rid。
        // 原本後台用「跟上一則最後一行一樣」判斷重送，總經理補一句一樣的話會被吞掉、畫面卻寫已回覆
        const text = ta.value.trim(), rr = state.replyRid || (state.replyRid = {});
        if (!rr[id] || rr[id].text !== text) rr[id] = { rid: newRid(), text: text };
        let r;
        try { r = await api({ action: 'briefReply', id: id, text: text, rid: rr[id].rid }); } catch (e) { r = { ok: false, message: '連不上伺服器，請再試一次（不會變成兩段）／ဆာဗာနှင့် ချိတ်မရပါ၊ ထပ်ကြိုးစားပါ（နှစ်ပိုင်း ဖြစ်မသွားပါ）' }; }
        if (r.ok) {
          setData({ briefs: r.briefs, briefUnread: briefUnreadOf(r) });
          delete state.replyDraft[id];
          delete rr[id];
          state.briefMsg = '已回覆';
        } else state.briefMsg = '⚠ ' + (r.message || '回覆失敗／ပြန်စာ ပို့မရပါ');
        render();
      });
    });
  }

  /* ───── 第24任 必改第二批⑦：錯誤紀錄（更多 → 錯誤紀錄）：最新 100 筆，可勾「已處理」，可只看沒處理的、只看某個環境 ───── */
  /* ───── 第28任 2026-11-20 老闆「主管那邊要有個功能可以改緬甸錯字」：「更多 → 緬文對照」 ─────
     畫面上固定的緬文（按鈕、標題、提示）翻錯時在這裡改。清單是把手機、主管頁的程式檔讀下來，
     找出每一段緬文和它前面的中文（例：「送出／…」→ 中文「送出」配那段緬文），主管打中文關鍵字找到那句就能改。
     改好的字存在後台設定「緬文修正」，web/myfix.js 在手機和主管頁的畫面上換掉；程式裡的緬文不動。
     清單本身掛 data-nomyfix：要看得到程式原本的字，才知道改了什麼。後台回的訊息（錯誤提示等）不在清單裡 */
  const MY_FILES = [['index.html', '手機'], ['app.js', '手機'], ['core.js', '手機'], ['unlock.js', '手機'], ['voice.js', '手機'], ['inapp.js', '手機'],
    ['boss.html', '主管頁'], ['boss.js', '主管頁']];
  const MY_LIST_MAX = 100;
  async function loadMyList() {
    if (state.myListLoading || !window.FarmMyFix) return;
    state.myListLoading = true;
    const items = new Map();
    try {
      for (const [file, where] of MY_FILES) {
        const res = await fetch(file, { cache: 'no-store' });
        if (!res.ok) throw new Error(file + ' ' + res.status);
        window.FarmMyFix.scan(await res.text()).forEach(found => addMyItem(items, found, where));
      }
      const sorted = Array.from(items.values()).sort((a, b) => (a.zh[0] || '～').localeCompare(b.zh[0] || '～'));
      state.myList = { ok: true, items: sorted };
    } catch (e) {
      state.myList = { ok: false, message: '讀不到畫面的程式檔（' + String((e && e.message) || e).slice(0, 80) + '），請按重新讀取' };
    }
    state.myListLoading = false;
    if (state.tab === 'myfix') render();
  }
  /** 同一段緬文出現在好幾個地方：合成一筆，中文最多記 3 種說法 */
  function addMyItem(items, found, where) {
    const it = items.get(found.my) || { my: found.my, zh: [], where: [] };
    if (found.zh && it.zh.indexOf(found.zh) < 0 && it.zh.length < 3) it.zh.push(found.zh);
    if (it.where.indexOf(where) < 0) it.where.push(where);
    items.set(found.my, it);
  }
  function myFixMatches() {
    const f = state.mf || (state.mf = { q: '', fixed: false, msg: '' });
    const fixes = window.FarmMyFix ? window.FarmMyFix.get() : {};
    const q = f.q.trim().toLowerCase();
    // 修正表裡有、程式檔裡已經找不到的句子（例：之後照譯稿回填改了那句）也要列，不然看不到、還原不了（抓BUG第16輪 主管3）
    const known = new Set(state.myList.items.map(x => x.my));
    const orphans = Object.keys(fixes).filter(k => !known.has(k)).map(k => ({ my: k, zh: ['（程式裡已經找不到這句，可以按還原）'], where: [] }));
    const hit = orphans.concat(state.myList.items).filter(x => (!f.fixed || x.my in fixes)
      && (!q || x.my.toLowerCase().includes(q) || x.zh.some(z => z.toLowerCase().includes(q))));
    return { hit, fixes };
  }
  function renderMyFixRows() {
    const { hit, fixes } = myFixMatches();
    state.mfShown = hit.slice(0, MY_LIST_MAX);
    const count = `<p class="sub">找到 ${hit.length} 句${hit.length > MY_LIST_MAX ? `（只列前 ${MY_LIST_MAX} 句，請多打幾個字縮小範圍）` : ''}</p>`;
    const rows = state.mfShown.map((x, i) => {
      const now = fixes[x.my];
      return `<li data-mfrow="${i}"><b>${esc(x.zh.join('｜') || '（找不到旁邊的中文）')}</b> <span class="sub">${esc(x.where.join('、'))}</span>`
        + `<div class="sub">原本：<span lang="my">${esc(x.my)}</span></div>`
        + `${now ? `<div>改成：<b lang="my">${esc(now)}</b> <button class="btn" type="button" data-mfundo="${i}">還原</button></div>` : ''}`
        + `<details class="stfix"><summary>✎ 改緬文</summary><textarea data-mfin lang="my" rows="2" maxlength="300" aria-label="改好的緬文">${esc(now || x.my)}</textarea>`
        + ` <button class="btn" type="button" data-mfsave="${i}">存</button> <span class="sub" data-mfmsg></span></details></li>`;
    }).join('');
    return count + `<ul class="list">${rows || '<li class="empty">沒有符合的句子</li>'}</ul>`;
  }
  function renderMyFix() {
    const L = state.myList;
    if (!L) { loadMyList(); return '<p class="sub">讀取畫面上的緬文中…</p>'; }
    if (!L.ok) return `<p class="empty">${esc(L.message)}</p><button class="btn" type="button" id="mfReload">重新讀取</button>`;
    const f = state.mf || (state.mf = { q: '', fixed: false, msg: '' });
    return `<section data-nomyfix><h3>緬文對照 <span class="sub">畫面上固定的緬文翻錯了，在這裡改；手機下次同步、主管頁重新整理後就換成新的字</span></h3>
      <p class="sub"><input type="search" id="mfQ" value="${esc(f.q)}" placeholder="打中文或緬文找句子，例如：送出" aria-label="找句子">
      <label><input type="checkbox" id="mfFixed"${f.fixed ? ' checked' : ''}> 只看改過的</label></p>
      <p class="sub" id="mfMsg" aria-live="polite">${esc(f.msg || '')}</p><div id="mfList">${renderMyFixRows()}</div></section>`;
  }
  function bindMyFixRows(root) {
    root.querySelectorAll('[data-mfsave]').forEach(b => b.addEventListener('click', () => saveMyFix(Number(b.dataset.mfsave), false)));
    root.querySelectorAll('[data-mfundo]').forEach(b => b.addEventListener('click', () => saveMyFix(Number(b.dataset.mfundo), true)));
  }
  function bindMyFix() {
    const rl = $('mfReload'); if (rl) rl.addEventListener('click', () => { state.myList = null; render(); });
    const q = $('mfQ'), fx = $('mfFixed'), list = $('mfList');
    if (q) q.addEventListener('input', () => { state.mf.q = q.value; list.innerHTML = renderMyFixRows(); bindMyFixRows(list); });
    if (fx) fx.addEventListener('change', () => { state.mf.fixed = fx.checked; list.innerHTML = renderMyFixRows(); bindMyFixRows(list); });
    if (list) bindMyFixRows(list);
  }
  /* 存檔失敗：除了那一列，也寫在上方的提示列。等後台回來的時候主管可能在搜尋框打字、清單重畫過，
     那一列已經不在畫面上，只寫那裡會看不到（抓BUG第16輪 主管4） */
  function showMyFixFail(rowMsg, text) {
    if (rowMsg) rowMsg.textContent = text;
    state.mf.msg = '沒有存成功：' + text;
    const top = $('mfMsg'); if (top) top.textContent = state.mf.msg;
  }
  async function saveMyFix(i, undo) {
    const it = (state.mfShown || [])[i], row = document.querySelector(`[data-mfrow="${i}"]`);
    if (!it || !row) return;
    const ta = row.querySelector('[data-mfin]'), msg = row.querySelector('[data-mfmsg]');
    const to = undo ? '' : String(ta ? ta.value : '').trim();
    if (!undo && !to) { if (msg) msg.textContent = '內容不能空白（要改回原本的字請按「還原」）'; return; }
    row.querySelectorAll('button').forEach(b => { b.disabled = true; });
    let r; try { r = await api({ action: 'myFixSet', from: it.my, to }); } catch (e) { r = null; }
    row.querySelectorAll('button').forEach(b => { b.disabled = false; });
    if (!r || !r.ok) { showMyFixFail(msg, (r && r.message) || '沒有存成功，請再試一次'); return; }
    state.data.myFixes = r.myFixes;
    if (window.FarmMyFix) window.FarmMyFix.set(r.myFixes, true);
    state.mf.msg = undo ? '已還原成原本的字' : '已存好；手機下次同步後也會換成新的字';
    render();
  }
  function renderErrors() {
    const e = state.errs;
    if (!e) { if (!state.errsLoading) loadErrors(); return '<p class="sub">讀取中…<span class="my">ဖတ်နေသည်</span></p>'; }
    if (!e.ok) return `<p class="empty">${esc(e.message || '讀取失敗／ဖတ်ရှုမှု မအောင်မြင်')}</p><button class="btn" type="button" id="errReload">重新讀取<span class="my">ပြန်ဖတ်ရန်</span></button>`;
    const f = state.ef || (state.ef = { open: true, env: '' });
    const list = e.errors.filter(x => (!f.open || !x.done) && (!f.env || x.env === f.env));
    const head = `<section><h3><span class="pill p-red">錯誤紀錄<span class="my">အမှား မှတ်တမ်း</span></span> <span class="sub">最新 ${e.errors.length} 筆；處理好就勾「已處理」<span class="my">နောက်ဆုံး ${e.errors.length}`
      + ` ခု၊ ဖြေရှင်းပြီးလျှင် 「ဖြေရှင်းပြီး」 ခြစ်ပါ</span></span></h3>
      <p class="sub"><label><input type="checkbox" id="errOpen"${f.open ? ' checked' : ''}> 只看還沒處理的<span class="my">မဖြေရှင်းရသေးသည်သာ ကြည့်</span></label>
      ${e.hasEnv ? `　<label>環境／ပတ်ဝန်းကျင် <select id="errEnv"><option value="">全部／အားလုံး</option><option value="正式"${f.env === '正式' ? ' selected' : ''}>正式／တရားဝင်</option><option value="測試"${f.env === '測試' ? ' selected' : ''}`
        + `>測試／စမ်းသပ်</option></select></label>` : '　<span class="sub">（試算表還沒有「環境」欄，按一次「第一次安裝／升級」就會補上）<span class="my">（Sheet တွင် 「ပတ်ဝန်းကျင်」 ကော်လံ မရှိသေးပါ၊ 「ပထမအကြိမ် တပ်ဆင်／အပ်ဒိတ်」 တစ်ကြိမ် နှိပ်လျှင် ဖြည့်ပေးမည်）</span></span>'}`
        + `
      　<button class="btn" type="button" id="errReload">重新讀取<span class="my">ပြန်ဖတ်ရန်</span></button></p>
      <p class="sub" aria-live="polite">${esc(state.errMsg || '')}</p>`;
    const rows = list.map(x => `<li><label class="errchk"><input type="checkbox" data-errdone="${x.row}" data-key="${esc(x.key)}"${x.done ? ' checked' : ''}${e.hasDone ? '' : ' disabled'}`
      + `> 已處理<span class="my">ဖြေရှင်းပြီး</span></label>
      <b>${esc(x.job || '（沒寫工作）／（လုပ်ငန်း မရေးထားပါ）')}</b>｜${esc(String(x.time).slice(0, 16))}${x.env ? ' <span class="pill' + (x.env === '測試' ? '' : ' p-yel') + '">' + esc(x.env) + '</span>' : ''}`
        + `${x.target ? '｜<span class="sub">' + esc(x.target) + '</span>' : ''}
      <details class="errdet"><summary>${esc(x.msg.slice(0, 60))}${x.msg.length > 60 ? '…' : ''}</summary><span class="sub pre">${esc(x.msg)}</span></details></li>`).join('');
    return head + `<ul class="list">${rows || '<li class="empty">沒有符合的錯誤紀錄<span class="my">ကိုက်ညီသော အမှား မှတ်တမ်း မရှိပါ</span></li>'}</ul></section>`;
  }
  async function loadErrors() {
    state.errsLoading = true;
    let r;
    try { r = await api({ action: 'errors', limit: 100 }); } catch (e) { r = { ok: false, message: '連不上伺服器，請按重新讀取／ဆာဗာနှင့် ချိတ်မရပါ၊ 「ပြန်ဖတ်ရန်」 ကို နှိပ်ပါ' }; }
    state.errsLoading = false;
    if (r && (r.code === 'BAD_LOGIN' || r.code === 'NOT_BOSS')) return;
    state.errs = r && r.ok ? r : { ok: false, message: (r && r.message) || '讀取失敗／ဖတ်ရှုမှု မအောင်မြင်' };
    if (state.tab === 'errors') render();
  }
  function bindErrors() {
    const rl = $('errReload'); if (rl) rl.addEventListener('click', () => { state.errs = null; state.errMsg = ''; render(); });
    const op = $('errOpen'); if (op) op.addEventListener('change', () => { state.ef.open = op.checked; render(); });
    const ev = $('errEnv'); if (ev) ev.addEventListener('change', () => { state.ef.env = ev.value; render(); });
    $('panel').querySelectorAll('[data-errdone]').forEach(cb => cb.addEventListener('change', async () => {
      const row = Number(cb.dataset.errdone), done = cb.checked;
      cb.disabled = true;
      let r;
      try { r = await api({ action: 'errorDone', row, key: cb.dataset.key, done }); } catch (e) { r = { ok: false, message: '連不上伺服器／ဆာဗာနှင့် ချိတ်မရပါ' }; }
      const it = state.errs && state.errs.errors && state.errs.errors.find(x => x.row === row);
      if (r && r.ok && it) { it.done = done; state.errMsg = done ? '已標「已處理」／「ဖြေရှင်းပြီး」 ဟု မှတ်ပြီး' : '已取消「已處理」／「ဖြေရှင်းပြီး」 ပယ်ဖျက်ပြီး'; }
      else { state.errMsg = '⚠ ' + ((r && r.message) || '沒有存成功，請再試一次／မသိမ်းနိုင်ပါ၊ ထပ်စမ်းပါ'); if (r && r.code === 'CHANGED') state.errs = null; }
      render();
    }));
  }

  /* ───── 帳號：主管開業務帳號、重設業務密碼；總經理另外能開／重設主管帳號（2026-11-12） ───── */
  function renderAccounts() {
    const gm = isGM();
    const list = state.data.salesAccounts || [];
    const f = state.af || (state.af = { account: '', name: '', region: '', password: '', role: '業務' });
    // 業務、主管都只能用上面的人給的密碼（董事長 2026-11-12）：密碼是自己打的，這裡不再顯示密碼
    const pw = state.newPw; // { account, reset, disabled }
    const box = pw ? `<div class="pwbox" role="status"><b>${pw.reset ? '已重設密碼<span class="my">စကားဝှက် ပြန်သတ်မှတ်ပြီး</span>' : '已開通帳號<span class="my">အကောင့် ဖွင့်ပြီး</span>'}`
      + `</b>${pw.disabled ? '<br><span class="err">⚠ 這個帳號目前是停用的，要在下面清單按「啟用」，本人才登入得了。<span class="my">ဤအကောင့်သည် လက်ရှိ ပိတ်ထားသည်၊ အောက်ပါ စာရင်းတွင် 「ဖွင့်」 နှိပ်ပြီးမှ သူ ဝင်နိုင်မည်။</span></span>' : ''}`
      + `
        <div>帳號／အကောင့်：<code>${esc(pw.account)}</code></div>
        <p class="sub">密碼就是你剛剛打的那一組，請當面或私訊告訴本人。本人只能用這組密碼，不能自己改；要換密碼請在下面按「重設密碼」。<span class="my">စကားဝှက်မှာ သင် ယခုရိုက်ထည့်လိုက်သော စကားဝှက် ဖြစ်သည်၊ လူကိုယ်တိုင် သို့မဟုတ် မက်ဆေ့ချ်ဖြင့် ပြောပြပါ။ သူ ဤစကားဝှက်သာ သုံးနိုင်ပြီး ကိုယ်တိုင် မပြောင်းနိုင်ပါ၊ ပြောင်းလိုလျှင် အောက်တွင် 「စကားဝှက် ပြန်သတ်မှတ်」 နှိပ်ပါ။</span></p>
        <button class="btn" type="button" id="pwDone">知道了</button></div>` : '';
    const roleSel = gm ? `<select id="aRole" aria-label="角色"><option value="業務"${f.role !== '主管' ? ' selected' : ''}>業務（用手機）／ဝန်ထမ်း（ဖုန်းဖြင့် သုံး）</option><option value="主管"${f.role === '主管' ? ' selected' : ''}`
      + `>主管（用主管網頁）／မန်နေဂျာ（မန်နေဂျာ ဝဘ် သုံး）</option></select>` : '';
    const form = `<h3>${gm ? '開通新帳號' : '開通新的業務帳號'}</h3><form class="taskform" id="acctForm" autocomplete="off">
        ${roleSel}
        <input id="aAcct" maxlength="30" placeholder="帳號（英文小寫或數字，例如 tom）／အကောင့်" value="${esc(f.account)}" autocapitalize="none" spellcheck="false" aria-label="帳號">
        <input id="aName" maxlength="40" placeholder="姓名（顯示在拜訪紀錄上）／အမည်" value="${esc(f.name)}" aria-label="姓名">
        <input id="aRegion" maxlength="40" placeholder="負責地區（可以留空）／ဒေသ" value="${esc(f.region)}" aria-label="負責地區">
        <input id="aPw" maxlength="64" placeholder="密碼（6 個字以上，由你給他）／စကားဝှက်" value="${esc(f.password)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="密碼">
        <button class="btn" type="submit" id="aAdd">${gm ? '開通帳號' : '開通業務帳號'}</button>
        <span class="sub" id="aMsg" aria-live="polite">${esc(state.acctMsg || '')}</span></form>
        <p class="sub">${gm ? '總經理帳號請在試算表「農業CRM → 開帳號／重設密碼」開。<span class="my">အထွေထွေမန်နေဂျာ အကောင့်ကို Sheet 「စိုက်ပျိုးရေးCRM → အကောင့် ဖွင့်／စကားဝှက် ပြန်သတ်မှတ်」 တွင် ဖွင့်ပါ။</span>' : '主管帳號由總經理開。<span class="my">မန်နေဂျာ အကောင့်ကို အထွေထွေမန်နေဂျာက ဖွင့်ပေးရမည်။</span>'}</p>`;
    const rows = list.map(a => `<li><b>${esc(a.name)}</b>${a.role === '主管' ? ' <span class="pill p-yel">主管</span>' : ''}<span class="sub">${esc(a.account)}${a.region ? '｜' + esc(a.region) : ''}</span>
        ${a.active ? '' : '<span class="pill">停用</span>'}
        <span class="sub">${a.lastLogin ? '最後登入／နောက်ဆုံး ဝင်ချိန် ' + esc(String(a.lastLogin).slice(5, 16)) : '還沒登入過<span class="my">မဝင်ဖူးသေးပါ</span>'}</span>
        <span class="sub" data-ver>${a.lastVer ? '手機版本／ဖုန်း ဗားရှင်း ' + esc(a.lastVer) + (a.lastVerAt ? '（' + esc(String(a.lastVerAt).slice(5, 16)) + '）' : '') : '還沒回報版本<span class="my">ဗားရှင်း မပို့ရသေးပါ</span>'}`
          + `</span>
        <button class="btn" type="button" data-acctreset="${esc(a.account)}" data-name="${esc(a.name)}">重設密碼</button>
        <button class="btn" type="button" data-unlockreset="${esc(a.account)}" data-name="${esc(a.name)}">重設解鎖方式<span class="my">သော့ဖွင့်နည်း ပြန်သတ်မှတ်</span></button><!-- 第24任 必改第四批⑤ -->
        <button class="btn" type="button" data-acctactive="${a.active ? 'off' : 'on'}" data-acct="${esc(a.account)}" data-name="${esc(a.name)}">${a.active ? '停用' : '啟用'}`
          + `</button>${a.role === '主管' ? '' : colorPickHtml(a)}</li>`).join(''); // 主管BUG(2號)#12
    return box + form + `<h3>${gm ? '業務、主管帳號' : '業務帳號'}（${list.length}）</h3><ul class="acctlist">${rows || '<li class="empty">還沒有帳號<span class="my">အကောင့် မရှိသေးပါ</span></li>'}</ul>`;
  }
  /** 第27任：帳號頁每位業務一排色票（點了就存）；「自動」＝拿掉自己選的，由系統配色 */
  function colorPickHtml(a) {
    const acct = String(a.account || '').toLowerCase(), set = (state.data.staffColors || {})[acct] || '', cur = staffColorMap()['@' + acct] || ''; // 抓BUG第7輪 主管組3：用帳號查
    const pal = state.data.colorChoices && state.data.colorChoices.length ? state.data.colorChoices : STAFF_COLORS_DEF;
    const taken = c => Object.keys(state.data.staffColors || {}).some(k => k !== acct && state.data.staffColors[k] === c);
    return `<div class="cpick" role="group" aria-label="${esc(a.name)} 的顏色"><span class="sub">顏色：</span>${pal.map((c, i) => `<button type="button" class="sw${c === cur ? ' on' : ''}`
      + `" style="--sc:${c}" data-scolor="${esc(acct)}" data-c="${c}" aria-pressed="${c === cur}" aria-label="顏色 ${i + 1}${taken(c) ? '（別人選了）' : ''}" title="${taken(c) ? '別人選了' : ''}"></button>`).join('')}`
      + `<button type="button" class="btn sauto" data-scolor="${esc(acct)}" data-c="" aria-pressed="${!set}">自動</button> <span class="sub" data-scmsg="${esc(acct)}"></span></div>`;
  }
  async function saveStaffColor(btn) {
    const acct = btn.dataset.scolor, c = btn.dataset.c || '', box = btn.closest('.cpick'), msg = box && box.querySelector('[data-scmsg]');
    box.querySelectorAll('button').forEach(b => { b.disabled = true; }); if (msg) msg.textContent = '存檔中…';
    let r; try { r = await api({ action: 'staffColor', account: acct, color: c }); } catch (e) { r = null; }
    box.querySelectorAll('button').forEach(b => { b.disabled = false; });
    if (showSaveFailed(r, msg)) return;
    // 抓BUG第7輪 主管組2：連續替兩位選色、回應先後顛倒時，原本整包換掉 → 晚到的舊整包把第二位蓋掉。只改自己這位
    const sc = Object.assign({}, state.data.staffColors || {}); if (c) sc[acct] = c; else delete sc[acct];
    setData({ staffColors: sc });
    render();
  }
  function bindAccounts() {
    const done = $('pwDone');
    if (done) done.addEventListener('click', () => { state.newPw = null; render(); });
    document.querySelectorAll('[data-scolor]').forEach(b => b.addEventListener('click', () => saveStaffColor(b))); // 第27任：業務顏色
    const form = $('acctForm');
    const keep = () => { state.af = { account: $('aAcct').value, name: $('aName').value, region: $('aRegion').value, password: $('aPw').value, role: $('aRole') ? $('aRole').value : '業務' }; };
    ['aAcct', 'aName', 'aRegion', 'aPw', 'aRole'].forEach(id => { if ($(id)) $(id).addEventListener('input', keep); });
    const after = r => {
      if (r.ok) {
        state.newPw = { account: r.account, reset: r.reset, disabled: !!r.disabled };
        setData({ salesAccounts: r.accounts });
        state.acctMsg = '';
        load(); // 重新讀一次：任務的派給誰選單也會出現新帳號
      } else state.acctMsg = '⚠ ' + (r.message || '沒有完成／မပြီးပါ');
      render();
    };
    form.addEventListener('submit', async ev => {
      ev.preventDefault(); keep();
      const a = state.af.account.trim().toLowerCase();
      if (!/^[a-z0-9._-]{2,30}$/.test(a)) { $('aMsg').textContent = '帳號只能用英文小寫、數字、點、底線、減號，2～30 字／အကောင့်တွင် အင်္ဂလိပ် အသေး၊ ဂဏန်း၊ အစက်၊ _၊ - သာ သုံးနိုင်သည်၊ ၂～၃၀ လုံး'; return; }
      if (!state.af.name.trim()) { $('aMsg').textContent = '請填姓名／အမည် ဖြည့်ပါ'; return; }
      if (state.af.password.trim().length < 6) { $('aMsg').textContent = '請幫他設定密碼（6 個字以上）／စကားဝှက် ၆ လုံးအထက် သတ်မှတ်ပါ'; return; }
      $('aAdd').disabled = true; $('aMsg').textContent = '開通中…／ဖွင့်နေသည်…';
      let r;
      try { r = await api({ action: 'accountAdd', account: a, name: state.af.name.trim(), region: state.af.region.trim(), password: state.af.password, role: state.af.role }); } catch (e) { r = { ok: false, message: '連不上伺服器，請再試一次／ဆာဗာနှင့် ချိတ်မရပါ၊ ထပ်ကြိုးစားပါ' }; }
      if (r.ok) state.af = { account: '', name: '', region: '', password: '', role: '業務' }; // 開好就把密碼從畫面清掉
      after(r);
    });
    $('panel').querySelectorAll('[data-acctreset]').forEach(b => b.addEventListener('click', async () => {
      const np0 = prompt(biText('幫「' + b.dataset.name + '」設定新密碼（6 個字以上）。\n他已登入的手機或電腦會全部登出，要用這組新密碼重新登入。', 'စကားဝှက်အသစ် သတ်မှတ်ပါ (၆ လုံးအထက်)။ ဝင်ထားသော ဖုန်း/ကွန်ပျူတာ အားလုံး ထွက်သွားမည်'));
      const np = np0 == null ? null : np0.trim(); // 0.4.94：去前後空白（後台也會整理）
      if (np === null) return;
      if (np.length < 6) { state.acctMsg = '⚠ 新密碼要 6 個字以上／စကားဝှက်အသစ် ၆ လုံးအထက် ရှိရမည်'; render(); return; }
      b.disabled = true;
      let r;
      try { r = await api({ action: 'accountReset', account: b.dataset.acctreset, password: np }); } catch (e) { r = { ok: false, message: '連不上伺服器／ဆာဗာနှင့် ချိတ်မရပါ' }; }
      after(r);
    }));
    // 主管BUG(2號)#12：停用／啟用（離職的業務要能關掉；停用後他的手機全部登出，資料都留著）
    // 第24任 必改第四批⑤：手機遺失時重設解鎖方式（停用這個人所有手機的登入，要用密碼重新登入；密碼不變、沒上傳的資料留在手機）
    $('panel').querySelectorAll('[data-unlockreset]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('要重設「' + b.dataset.name + '」的解鎖方式嗎？\n他所有的手機都要用密碼重新登入，再重新設定人臉／指紋或九宮格。密碼不變；手機裡還沒上傳的資料不會不見。' + '\n\n' + 'ပြန်သတ်မှတ်မည်လား 「' + b.dataset.name
        + '」 ၏ သော့ဖွင့်နည်းကို ပြန်သတ်မှတ်မလား။ သူ၏ ဖုန်းအားလုံး စကားဝှက်ဖြင့် ပြန်ဝင်ပြီး မျက်နှာ／လက်ဗွေ သို့မဟုတ် ပုံစံကွက် ပြန်သတ်မှတ်ရမည်။ စကားဝှက် မပြောင်းပါ၊ မတင်ရသေးသော ဒေတာ မပျောက်ပါ။')) return;
      b.disabled = true;
      let r;
      try { r = await api({ action: 'unlockReset', account: b.dataset.unlockreset }); } catch (e) { r = { ok: false, message: '連不上伺服器，請再試一次／ဆာဗာနှင့် ချိတ်မရပါ၊ ထပ်ကြိုးစားပါ' }; }
      if (r.ok) {
        setData({ salesAccounts: r.accounts });
        state.acctMsg = '已重設解鎖方式：' + r.account + '（' + r.devices + ' 支手機要重新登入）／သော့ဖွင့်နည်း ပြန်သတ်မှတ်ပြီး：' + r.account + '（ဖုန်း ' + r.devices + ' လုံး ပြန်ဝင်ရမည်）';
      }
      else state.acctMsg = '⚠ ' + (r.message || '沒有完成／မပြီးပါ');
      render();
    }));
    $('panel').querySelectorAll('[data-acctactive]').forEach(b => b.addEventListener('click', async () => {
      const on = b.dataset.acctactive === 'on';
      if (!confirm(on ? biText('要重新啟用「' + b.dataset.name + '」嗎？', 'ပြန်ဖွင့်မလား') : biText('要停用「' + b.dataset.name + '」嗎？\n停用後他的手機或電腦會全部登出、不能再登入；拜訪紀錄和客戶都會留著，之後可以再啟用。', 'ပိတ်မလား။ ပိတ်လျှင် ဝင်၍မရတော့ပါ၊ မှတ်တမ်းများ ကျန်ရှိမည်'))) return;
      b.disabled = true;
      let r;
      try { r = await api({ action: 'accountActive', account: b.dataset.acct, active: on }); } catch (e) { r = { ok: false, message: '連不上伺服器，請再試一次／ဆာဗာနှင့် ချိတ်မရပါ၊ ထပ်ကြိုးစားပါ' }; }
      if (r.ok) { setData({ salesAccounts: r.accounts }); state.acctMsg = (on ? '已啟用／ဖွင့်ပြီး ' : '已停用／ပိတ်ပြီး ') + r.account; load(); }
      else state.acctMsg = '⚠ ' + (r.message || '沒有完成／မပြီးပါ');
      render();
    }));
  }

  /** 讀某個月的工作進度：「工作進度明細」看選的月份，「總覽」業務卡片看本月；讀到了，正在看的那頁才重畫 */
  const PROG_RETRY_MS = 30000; // 0.4.88 低2：讀失敗的月份，過 30 秒再畫面時重讀（不是永遠失敗；也不會失敗就一直狂打）
  async function loadProgress(m) {
    const old = state.prog[m];
    if (!m || state.progReq[m] || (old && !(old.failedAt && Date.now() - old.failedAt > PROG_RETRY_MS))) return;
    const gen = state.cacheGen, req = state.progReq; // 0.5.24：同 loadHistory，重讀前發出的晚到就丟掉
    req[m] = true;
    const key = state.key;
    let r;
    try { r = await api({ action: 'progress', month: m }); } catch (e) { r = { ok: false, message: e && e.timeout ? '讀進度超過 30 秒沒回應，等一下會再試／တိုးတက်မှု ဖတ်ချိန် စက္ကန့် ၃၀ ကျော် အဖြေ မရပါ၊ ခဏနေမှ ထပ်စမ်းမည်' : '連不上伺服器，等一下會再試／ဆာဗာနှင့် ချိတ်မရပါ၊ ခဏနေမှ ထပ်စမ်းမည်' }; } finally { delete req[m]; }
    if (key !== state.key || gen !== state.cacheGen) return;
    // 0.4.88 低2：登入失效、不是主管 → 回登入頁（原本只在進度那格寫錯誤，畫面其他地方照用舊資料）
    if (r && (r.code === 'BAD_LOGIN' || r.code === 'NOT_BOSS')) { logout(); showLogin(r.message || '登入已失效，請重新登入／ဝင်ရောက်မှု သက်တမ်းကုန်ပြီ၊ ပြန်ဝင်ပါ'); return; }
    state.prog[m] = r && r.ok ? r : Object.assign({}, r, { ok: false, failedAt: Date.now() });
    if (state.tab === 'progress' && (state.pm === m || monthsBack(1)[0] === m)) render(); // 第25任①：第七批把業務卡片（用本月）搬到工作進度；選過去月份時本月的回來也要重畫（原本只看「今天」分頁）
  }

  const VISIT_TABLE_MAX = 500; // 後台 bossData_ 的 visits 只回最近 500 筆（Code.gs slice(-500)），兩邊要一起改
  function renderTable() {
    const rows = (typeof hideTest === 'function' ? hideTest(state.data.visits) : state.data.visits).slice().sort((a, b) => b.time.localeCompare(a.time)); // 第24任 第七批 E：測試帳號預設不列
    // 0.4.85 中6：後台只給最近 500 筆（slice(-500)）→ 滿 500 筆時說清楚，不讓主管以為全部都在這裡
    const capNote = rows.length >= VISIT_TABLE_MAX ? `<p class="sub">只顯示最近 ${VISIT_TABLE_MAX} 筆，更早的請看客戶履歷或開試算表<span class="my">နောက်ဆုံး ${VISIT_TABLE_MAX} ခုသာ ပြထားသည်၊ ပိုစောသည်များကို ဖောက်သည် မှတ်တမ်း သို့မဟုတ် Sheet တွင် ကြည့်ပါ</span></p>` : '';
    return capNote + `<div class="tbl"><table><thead><tr><th>拜訪時間</th><th>客戶</th><th>業務</th><th>作物狀況</th><th>問題</th><th>下一步</th><th>狀態</th></tr></thead><tbody>
      ${rows.map(v => `<tr><td data-label="拜訪時間／သွားသည့်အချိန်">${esc(v.time)}</td><td data-label="客戶／ဖောက်သည်"><a href="javascript:void 0" data-go="${esc(v.cid)}`
        + `">${esc(v.name)}</a></td><td data-label="業務／ဝန်ထမ်း">${staffTag(v.staff)}</td><td data-label="作物狀況／သီးနှံ အခြေအနေ">${esc(v.crop || v.summary || '—')}</td><td data-label="問題／ပြဿနာ">${esc(v.issue || '—')}`
        + `</td><td data-label="下一步／နောက်တစ်ဆင့်">${esc(v.next || '—')}</td><td data-label="狀態／အခြေအနေ">${esc(v.status)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">還沒有拜訪紀錄<span class="my">မှတ်တမ်း မရှိသေး</span></td></tr>'}
      </tbody></table></div>`;
  }

  document.querySelectorAll('.tab[data-tab]').forEach(t => t.addEventListener('click', () => { state.tab = t.dataset.tab; state.newPw = null; state.moreOpen = false; render(); })); // 換分頁就把開通結果收起來
  $('moreBtn').addEventListener('click', () => {
    // 正在看「更多」裡的分頁時按「更多」不收起來（收起來就看不出現在在哪一頁）
    if (MORE_TABS.indexOf(state.tab) >= 0) return;
    state.moreOpen = !state.moreOpen;
    if (state.data) render(); else $('moreTabs').hidden = !state.moreOpen;
  });
  $('reload').addEventListener('click', load);
  // 第24任 第七批：手機底部導覽（今天｜拜訪｜客戶｜更多）；記住拜訪、客戶上次看的是哪一種顯示方式
  const lastOf = { visits: 'latest', customers: 'trial' };
  document.querySelectorAll('#bnav [data-bnav]').forEach(b => b.addEventListener('click', () => {
    const g = b.dataset.bnav;
    const cur = navGroup(state.tab);
    if (cur === 'visits' || cur === 'customers') lastOf[cur] = state.tab;
    state.tab = g === 'today' ? 'today' : g === 'more' ? 'moremenu' : lastOf[g];
    state.review = null;
    if (state.data) { render(); window.scrollTo(0, 0); }
  }));
  if ($('showTest')) $('showTest').addEventListener('click', () => { state.showTest = !state.showTest; if (state.data) render(); });
  $('logout').addEventListener('click', logout);
  // 0.4.88 中4：開頁自動讀取失敗時的「重試」「改用帳號登入」
  if ($('bootRetry')) $('bootRetry').addEventListener('click', load);
  if ($('bootLogin')) $('bootLogin').addEventListener('click', () => { hideBoot(); logout(); });
  // 0.4.88 低8：頁面開著過了緬甸午夜、或離開超過 10 分鐘再切回來 → 重讀（「今天」、逾期才會對）
  const STALE_MS = 10 * 60000;
  if (typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.key || !state.data) return;
    if (Date.now() - (state.loadedAt || 0) > STALE_MS || state.data.today !== mmToday()) load();
  });
  $('loginForm').addEventListener('submit', onLogin);
  document.querySelectorAll('.pweye').forEach(b => b.addEventListener('click', () => {
    const i = $(b.dataset.for);
    if (!i) return;
    const show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(show));
    b.textContent = show ? '🙈 隱藏／ဖျောက်ရန်' : '👁 顯示／ပြရန်';
  })); // 第24任 第七批 L
  // 總經理BUG(2號)低6：帳號欄改成別人＝不是剛剛被要求改密碼的那位，收起改密碼欄
  $('acct').addEventListener('input', () => { if (state.mustChange && $('acct').value.trim().toLowerCase() !== state.mustChangeAcct) clearMustChange(); });
  biDom(document.body); // 登入頁、標題列、分頁名稱補緬文
  renderMirrors();
  state.key = keyStore.get();
  if (state.key) load(); else showLogin();

  /* 第27任 2026-11-18 董事長「試作農民改叫對照農民，主管頁、日報、Word 也一起改」：程式和資料裡照舊叫「試作」（類別值、分頁名稱都不動），
     只把畫面上看得到的字換成「對照」：畫面每次畫完（MutationObserver），把文字節點和 placeholder／aria-label／title／data-label 裡的「試作」換掉。
     打字欄（textarea、input）裡業務自己打的內容不動；「測試作物」「嘗試作法」這種跨詞的不換。沒有 MutationObserver 的環境就不換。
     抓BUG第8輪 主管組1：字串沒變也寫回 → 觀察器又被叫醒、無限循環整頁卡死。改成：換到不再變為止（處理「試作試作」），真的有變才寫回 */
  const RELABEL_RE = /(^|[^測嘗])試作/g;
  function relabelStr(s) { let t = String(s), prev; do { prev = t; t = t.replace(RELABEL_RE, (m, q) => q + '對照'); } while (t !== prev); return t; }
  const RELABEL_ATTRS = ['placeholder', 'aria-label', 'title', 'data-label'];
  function relabelTrial(root) {
    if (!root || typeof document === 'undefined' || !document.createTreeWalker) return;
    const skip = n => { for (let p = n.parentNode; p; p = p.parentNode) { if (p.nodeType === 1 && /^(TEXTAREA|SCRIPT|STYLE|INPUT)$/.test(p.tagName)) return true; } return false; };
    const fixText = n => { if (n.nodeValue.indexOf('試作') < 0 || skip(n)) return; const nv = relabelStr(n.nodeValue); if (nv !== n.nodeValue) n.nodeValue = nv; };
    const fixAttrs = e => RELABEL_ATTRS.forEach(a => {
      const v = e.getAttribute && e.getAttribute(a);
      if (v && v.indexOf('試作') >= 0) { const nv = relabelStr(v); if (nv !== v) e.setAttribute(a, nv); }
    });
    if (root.nodeType === 3) { fixText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    const w = document.createTreeWalker(root, 4);
    const list = []; for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.indexOf('試作') >= 0) list.push(n);
    list.forEach(fixText);
    const sel = RELABEL_ATTRS.map(a => '[' + a + ']').join(',');
    (root.nodeType === 1 ? [root] : []).concat(Array.from(root.querySelectorAll(sel))).forEach(fixAttrs);
  }
  function startRelabel() {
    if (typeof MutationObserver !== 'function' || typeof document === 'undefined' || !document.body) return;
    relabelTrial(document.body);
    if (document.title && document.title.indexOf('試作') >= 0) document.title = relabelStr(document.title);
    // 抓BUG第8輪 手機組6：程式事後改的 placeholder（打字範例）也要換 → 也看屬性變動
    new MutationObserver(ms => ms.forEach(m => { if (m.type === 'characterData') relabelTrial(m.target); else if (m.type === 'attributes') relabelTrial(m.target); else m.addedNodes.forEach(n => relabelTrial(n)); }))
      .observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: RELABEL_ATTRS });
  }
  startRelabel();
  window.__bossTest = { state, startReview, flagsOf, render, load, logout, measureDue, weekCompare, syncPlayer, stopAudio, mmToday, noSummaryText, planParts }; // 本機測試用（0.4.88 多開幾個給測試；第26任：多給 noSummaryText、planParts，測試整份載入呼叫，不再切原始碼）
})();
