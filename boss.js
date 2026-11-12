/* 主管網頁：帳號密碼登入，從後台讀資料，畫出總覽、日曆、客戶履歷、地圖、紀錄表 */
/* global FARM_CONFIG */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  const MORE_TABS = ['progress', 'map', 'table', 'accounts']; // 收在「更多」底下的分頁（2026-11-12 規劃 C）

  /* ───── 主管網頁中文＋緬文（2026-11-12 董事長；緬文是示意，待校對）─────
     畫面畫好後掃一遍：文字剛好是下表的詞，就在後面補緬文（小字）；輸入框提示也補。不用改每一段畫面程式 */
  const BI = {
    '農戶拜訪總覽': 'လယ်ကွင်းသွားရောက်မှု အကျဉ်းချုပ်', '登入': 'ဝင်ရန်', '登出': 'ထွက်ရန်', '重新整理': 'ပြန်ဖွင့်', '開啟試算表': 'Sheet ဖွင့်',
    '總覽': 'အကျဉ်းချုပ်', '客戶': 'ဖောက်သည်', '日曆': 'ပြက္ခဒိန်', '試作報告': 'စမ်းသပ် အစီရင်ခံစာ', '農民任務': 'လယ်သမား လုပ်ငန်း', '更多 ▾': 'နောက်ထပ်',
    '工作進度明細': 'လုပ်ငန်း တိုးတက်မှု', '田區地圖': 'လယ်ကွက် မြေပုံ', '拜訪紀錄表': 'သွားရောက်မှု မှတ်တမ်း', '業務帳號': 'ဝန်ထမ်း အကောင့်',
    '逾期未回訪': 'ရက်ကျော် မသွားရသေး', '今天該回訪': 'ယနေ့ သွားရန်', '近 7 天拜訪次數': '၇ ရက်အတွင်း သွားရောက်မှု', '追蹤中的客戶': 'စောင့်ကြည့်ဆဲ ဖောက်သည်',
    '每位業務': 'ဝန်ထမ်း တစ်ဦးချင်း', '逾期': 'ရက်ကျော်', '最新拜訪': 'နောက်ဆုံး သွားရောက်မှု', '沒有': 'မရှိ', '各地區': 'ဒေသအလိုက်',
    '要注意的': 'သတိပြုရန်', '全部客戶': 'ဖောက်သည် အားလုံး', '全部業務': 'ဝန်ထမ်း အားလုံး', '全部地區': 'ဒေသ အားလုံး', '全部類型': 'အမျိုးအစား အားလုံး',
    '全部結果': 'ရလဒ် အားလုံး', '全部類別': 'အမျိုးအစား အားလုံး',
    '農民': 'လယ်သမား', '盤商': 'ကုန်သည်', '種子商': 'မျိုးစေ့ဆိုင်', '試作': 'စမ်းသပ်', '推廣': 'မြှင့်တင်', '農戶': 'ပုံမှန်', '一般拜訪': 'ပုံမှန်သွားရောက်', '結案': 'ပိတ်သိမ်း',
    '系統': 'စနစ်', '達成': 'ပြည့်မီ', '進行中': 'လုပ်ဆောင်ဆဲ', '成功': 'အောင်မြင်', '失敗': 'မအောင်မြင်', '結束': 'ပြီးဆုံး', '取消': 'ပယ်ဖျက်', '完成': 'ပြီး', '停用': 'ပိတ်ထား',
    '編號': 'နံပါတ်', '類別': 'အမျိုးအစား', '品項': 'ပစ္စည်း', '期間': 'ကာလ', '結果': 'ရလဒ်', '量測': 'တိုင်းတာ', '報告': 'အစီရင်ခံ',
    '業務': 'ဝန်ထမ်း', '拜訪': 'သွားရောက်', '拜訪過的客戶': 'သွားခဲ့သော ဖောက်သည်', '新增客戶': 'ဖောက်သည်သစ်', '試作 開始／完成': 'စမ်းသပ် စ／ပြီး', '計劃達成': 'ပစ်မှတ် ပြည့်မီမှု',
    '地區': 'ဒေသ', '本月拜訪': 'ဤလ သွားရောက်', '進行中的試作': 'လုပ်ဆောင်ဆဲ စမ်းသပ်', '拜訪時間': 'သွားသည့်အချိန်', '作物狀況': 'သီးနှံ အခြေအနေ', '問題': 'ပြဿနာ', '下一步': 'နောက်တစ်ဆင့်', '狀態': 'အခြေအနေ',
    '作物': 'သီးနှံ', '行情': 'ဈေးကွက်', '反應': 'တုံ့ပြန်မှု', '摘要': 'အနှစ်ချုပ်', '打字': 'စာ', '價格': 'ဈေးနှုန်း',
    '開通新的業務帳號': 'ဝန်ထမ်း အကောင့်သစ် ဖွင့်', '開通業務帳號': 'အကောင့် ဖွင့်', '重設密碼': 'စကားဝှက် ပြန်သတ်မှတ်', '我已經記下了': 'မှတ်ပြီးပြီ', '派給業務': 'ဝန်ထမ်းကို ပေး',
    '已拜訪': 'သွားပြီး', '預定回訪': 'သွားရန် စီစဉ်', '逾期（大圓點）': 'ရက်ကျော် (အစက်ကြီး)', '今天該去': 'ယနေ့ သွားရန်', '已排定': 'စီစဉ်ပြီး',
    '⬇ 下載 Word': 'Word ဒေါင်းလုဒ်', '⬇ 試作報告（Word）': 'Word ဒေါင်းလုဒ်', '▶ 聽原始錄音（緬甸語）': 'မူရင်းအသံ နားထောင်', '🔊 念中文摘要': 'တရုတ် အနှစ်ချုပ် ဖတ်',
    '田區導航 ↗': 'လမ်းညွှန်', '導航 ↗': 'လမ်းညွှန်', '用 Google 地圖導航 ↗': 'Google မြေပုံ လမ်းညွှန်', '最近 30 天完成或取消的': 'ရက် ၃၀ အတွင်း ပြီး/ပယ်ဖျက်', '沒有任務': 'လုပ်ငန်း မရှိ', '還沒有': 'မရှိသေး',
    // 總經理、主管匯報、我的任務（2026-11-12）
    '任務': 'လုပ်ငန်း', '主管匯報': 'မန်နေဂျာ အစီရင်ခံစာ', '我的任務': 'ကျွန်ုပ်၏ လုပ်ငန်း', '派出任務': 'လုပ်ငန်း ပေး', '主管': 'မန်နေဂျာ', '總經理': 'အထွေထွေမန်နေဂျာ',
    '寫匯報給總經理': 'အထွေထွေမန်နေဂျာထံ အစီရင်ခံစာ ရေး', '送出匯報': 'အစီရင်ခံစာ ပို့', '我送出的匯報': 'ကျွန်ုပ် ပို့ခဲ့သော အစီရင်ခံစာ', '全部匯報': 'အစီရင်ခံစာ အားလုံး',
    '未讀': 'မဖတ်ရသေး', '已回覆': 'ပြန်စာ ပေးပြီး', '回覆': 'ပြန်စာ', '送出回覆': 'ပြန်စာ ပို့', '總經理回覆': 'အထွေထွေမန်နေဂျာ ပြန်စာ', '系統附上的數字': 'စနစ် ကိန်းဂဏန်း',
    '開通新帳號': 'အကောင့်သစ် ဖွင့်', '開通帳號': 'အကောင့် ဖွင့်', '業務、主管帳號': 'ဝန်ထမ်း၊ မန်နေဂျာ အကောင့်', '完成了': 'ပြီးပြီ', '派給主管的任務': 'မန်နေဂျာထံ ပေးသော လုပ်ငန်း',
    '再送一次確認': 'ထပ်ပို့ပြီး အတည်ပြု', '放棄確認、改成新的一份': 'အသစ်တစ်စောင် ပြောင်းရေး'
  };
  const BI_PH = { '帳號': 'အကောင့်', '密碼': 'စကားဝှက်', '新密碼': 'စကားဝှက်အသစ်', '新密碼再輸入一次': 'ထပ်ရိုက်ပါ', '搜尋全部客戶：名字、電話、編號、作物': 'ဖောက်သည် ရှာရန်' };
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
    rf: {},          // 試作報告篩選
    pm: '',          // 工作進度看哪個月
    prog: {},        // 各月份的工作進度（後台算好的）
    progReq: {},
    photoReq: {},    // 照片下載中的請求，同一張不重複下載
    cf: { q: '', staff: '', area: '', type: '', show: 'attn' }, // 客戶頁的搜尋與篩選；預設只看要注意的（2026-11-12 規劃 B）
    grpOpen: {},     // 客戶頁各業務分組有沒有展開（使用者按過才記）
    moreOpen: false, // 「更多」分頁列有沒有打開
    renderGen: 0 };  // 每畫一次加一，舊畫面的照片迴圈看到不同就停
  // 登入後的金鑰記在這台電腦的瀏覽器裡（存不了就每次重新登入）
  const keyStore = {
    get() { try { return localStorage.getItem(KEY_NAME); } catch (e) { return null; } },
    set(v) { try { if (v) localStorage.setItem(KEY_NAME, v); else localStorage.removeItem(KEY_NAME); } catch (e) { /* 無痕模式存不了 */ } }
  };

  async function api(payload) {
    const sentKey = state.key;
    const res = await fetch(FARM_CONFIG.gasUrl, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ deviceKey: sentKey }, payload))
    });
    const data = await res.json();
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
      if ($('newPw').value.length < 6) { showLogin('新密碼至少 6 個字'); return; }
      if ($('newPw').value !== $('newPw2').value) { showLogin('兩次輸入的新密碼不一樣'); return; }
      payload.newPassword = $('newPw').value;
    }
    $('loginMsg').textContent = '確認中…'; $('loginMsg').className = 'sub';
    $('loginBtn').disabled = true;
    try {
      const r = await api(payload);
      if (r.code === 'MUST_CHANGE') { state.mustChange = true; $('newPwBox').hidden = false; $('loginMsg').textContent = r.message; return; }
      if (!r.ok) { showLogin(r.message || '登入失敗'); return; }
      state.key = r.deviceKey; keyStore.set(r.deviceKey);
      ['pw', 'newPw', 'newPw2'].forEach(id => { $(id).value = ''; });
      state.mustChange = false; $('newPwBox').hidden = true;
      load();
    } catch (e) {
      showLogin('連不上伺服器，請確認網路後再試');
    } finally {
      $('loginBtn').disabled = false;
    }
  }

  // 登出時把上一個人的畫面狀態全部清掉（同一台電腦換帳號：上一位打開的匯報、草稿、表單不能帶給下一位；
  // 2026-11-12 實測抓到：主管打開過的匯報，總經理一登入就自己展開、被標成已讀）
  function logout() {
    state.key = null; keyStore.set(null); state.data = null;
    // 讀取中標記與快取也清掉：換人後舊請求的回應會被丟掉（S7），標記不清就永遠是「讀取中」、新的人讀不到（第二輪自行審查 T5）
    Object.assign(state, { progReq: {}, histReq: {}, photoReq: {}, prog: {}, hist: {}, photos: {}, audios: {} });
    Object.assign(state, { tab: 'today', trial: null, briefOpen: '', bf: null, replyDraft: {}, tf: null, af: null, newPw: null,
      taskMsg: '', briefMsg: '', acctMsg: '', moreOpen: false, cf: { q: '', staff: '', area: '', type: '', show: 'attn' } });
    showLogin();
  }

  async function load() {
    if (!state.key) { showLogin(); return; }
    $('loginMsg').textContent = '讀取中…';
    let data;
    try { data = await api({ action: 'boss' }); }
    catch (e) { data = { ok: false, code: 'NETWORK', message: '連不上伺服器，請確認網路後重新整理' }; }
    if (!data.ok) {
      if (data.code === 'BAD_LOGIN' || data.code === 'NOT_BOSS') { logout(); showLogin(data.message || '登入失敗'); return; }
      // 已經有畫面時，暫時的錯誤只顯示在上方，不要把人踢回登入頁
      if (state.data) { $('updated').textContent = '⚠ ' + (data.message || '更新失敗') + '（顯示的是上次的資料）'; return; }
      showLogin(data.message || '讀取失敗'); return;
    }
    state.hist = {}; state.prog = {};
    state.data = data;
    // 客戶頁沒有指定客戶時，顯示篩選結果的第一位（custSelected），不再固定第一位客戶
    $('login').hidden = true; $('app').hidden = false;
    $('who').textContent = data.name + (data.role === '總經理' ? '（總經理）' : '（主管）');
    // 總經理的帳號分頁管業務和主管（2026-11-12）；分頁名稱換掉後補一次緬文
    const accTab = document.querySelector('.tab[data-tab="accounts"]');
    if (accTab) { accTab.textContent = data.role === '總經理' ? '業務、主管帳號' : '業務帳號'; biDom(accTab.parentNode); }
    $('updated').textContent = '更新於 ' + new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    // 0.4.38 董事長：「開啟試算表」只有總經理有（後台只給總經理網址，主管拿到的是空的就藏起來）
    $('sheetLink').href = data.sheetUrl || '#';
    $('sheetLink').hidden = !(data.role === '總經理' && data.sheetUrl);
    render();
  }

  /* ───── 計算 ───── */
  const active = () => state.data.customers.filter(c => c.status !== '已結束' && c.status !== '暫停');
  const dueState = c => !c.nextDue ? 'none' : c.nextDue < state.data.today ? 'late' : c.nextDue === state.data.today ? 'due' : 'ok';
  const visitsOf = id => (state.hist[id] || state.data.visits.filter(v => v.cid === id)).slice().sort((a, b) => b.time.localeCompare(a.time));
  const weekNo = (c, date) => c.start ? Math.max(1, Math.ceil((s2d(date) - s2d(c.start)) / DAY / 7)) : null;
  /** 履歷裡一筆拜訪是「試作第幾週」：只算掛在試作底下、而且在那件試作期間內的（原本拿客戶最後一件試作的開始日算每一筆；第二輪自行審查 T8） */
  const visitWeek = v => {
    const t = v.trialId && (state.data.trials || []).find(x => x.id === v.trialId);
    const day = String(v.time).slice(0, 10);
    if (!t || !t.start || day < t.start || (t.end && day > t.end)) return null;
    return weekNo({ start: t.start }, day);
  };

  function render() {
    state.renderGen++;
    const cs = active();
    const late = cs.filter(c => dueState(c) === 'late'), due = cs.filter(c => dueState(c) === 'due');
    const weekAgo = addDays(state.data.today, -6);
    const week = state.data.visits.filter(v => v.time.slice(0, 10) >= weekAgo);
    $('stats').innerHTML = [
      ['red', late.length, '逾期未回訪'], ['yel', due.length, '今天該回訪'],
      ['grn', week.length, '近 7 天拜訪次數'], ['', cs.length, '追蹤中的客戶']
    ].map(([k, n, t]) => `<div class="card stat ${k}"><b>${n}</b><span class="sub">${t}</span></div>`).join('');
    document.querySelectorAll('.tab[data-tab]').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === state.tab));
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
    // 主管匯報分頁的紅點：總經理＝還沒看過的匯報
    const unread = state.data.role === '總經理' ? (state.data.briefs || []).filter(b => !b.read).length : 0;
    $('briefBadge').hidden = !unread; $('briefBadge').textContent = unread ? String(unread) : '';
    $('panel').innerHTML = ({ today: renderToday, latest: renderLatest, cal: renderCal, trial: renderTrial, map: renderMap, table: renderTable, reports: renderReports, progress: renderProgress, tasks: renderTasks, accounts: renderAccounts, briefs: renderBriefs })[state.tab]();
    if (state.tab === 'tasks') bindTasks();
    if (state.tab === 'briefs') bindBriefs();
    if (state.tab === 'accounts') bindAccounts();
    if (state.tab === 'trial') bindCustomers();
    bindGo($('panel'));
    biDom($('panel')); biDom($('stats')); // 補緬文
    $('panel').querySelectorAll('[data-staff]').forEach(el => el.addEventListener('click', () => {
      // 點業務卡片：到客戶頁，只看這位業務要注意的客戶
      state.cf = { q: '', staff: el.dataset.staff, area: '', type: '', show: 'attn' }; state.trial = null; state.tab = 'trial'; render();
    }));
    // 0.4.33 主管確認／退回結案
    $('panel').querySelectorAll('[data-closedecide]').forEach(b => b.addEventListener('click', async () => {
      const ok = b.dataset.closedecide === 'confirm';
      if (!confirm(ok ? '確認這位農民結案？確認後不再提醒回訪，進行中的試作也會結束。' : '退回這筆結案？客戶照常追蹤，當作沒結案。')) return;
      $('panel').querySelectorAll('[data-closedecide]').forEach(x => { x.disabled = true; });
      let r;
      try { r = await api({ action: 'closeDecide', visitId: b.dataset.vid, decision: b.dataset.closedecide }); } catch (e) { r = { ok: false, message: '連不上伺服器' }; }
      if (r.closings) state.data.closings = r.closings;
      state.closeMsg = r.ok ? (ok ? '已確認結案' : '已退回') : '⚠ ' + (r.message || '處理失敗');
      if (r.ok && ok) { render(); load(); return; } // 確認結案會改客戶狀態、試作：整份重讀；主管BUG#4：先重畫（按鈕恢復、看到成功訊息），重讀失敗也不會卡灰
      render();
    }));
    $('panel').querySelectorAll('[data-play]').forEach(el => el.addEventListener('click', () => playAudio(el)));
    $('panel').querySelectorAll('[data-speak]').forEach(el => el.addEventListener('click', () => speak(el)));
    $('panel').querySelectorAll('[data-report]').forEach(el => el.addEventListener('click', () => downloadReport(el)));
    $('panel').querySelectorAll('[data-filter]').forEach(el => el.addEventListener('change', () => { state.rf[el.dataset.filter] = el.value; render(); }));
    $('panel').querySelectorAll('[data-month]').forEach(el => el.addEventListener('change', () => { state.pm = el.value; render(); }));
    if (state.tab === 'progress') loadProgress(state.pm);
    if (state.tab === 'today') loadProgress(monthsBack(1)[0]); // 業務卡片的月計劃用本月進度
    if (state.tab === 'trial') { loadPhotos(); loadHistory(); }
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
    if (!c || state.hist[c.id] || state.histReq[c.id]) return; // 已經有、或正在拿，不重複要
    state.histReq[c.id] = true;
    let r;
    try { r = await api({ action: 'history', cid: c.id }); } catch (e) { r = null; } finally { delete state.histReq[c.id]; }
    if (!r || !r.ok) return;
    state.hist[c.id] = r.visits;
    const now = state.tab === 'trial' && custSelected();
    if (now && now.id === c.id) render();
  }

  /* ───── 聲音：原始錄音（緬甸語）＋用手機內建語音念中文摘要 ───── */
  function soundBtns(v) {
    const a = v.audio ? `<button class="btn" type="button" data-play="${esc(v.audio)}">▶ 聽原始錄音（緬甸語）</button>` : '';
    const s = v.summary ? `<button class="btn" type="button" data-speak="${esc(v.id)}">🔊 念中文摘要</button>` : '';
    return a || s ? `<div class="sounds">${a} ${s}</div>` : '';
  }

  let player = null, playingId = '', playingBtn = null;
  const PLAY_LABEL = '▶ 聽原始錄音（緬甸語）';
  async function playAudio(btn) {
    const id = btn.dataset.play;
    if (player && playingId === id) { player.pause(); player = null; playingId = ''; btn.textContent = PLAY_LABEL; return; }
    // 換聽另一段：上一段停掉，按鈕也要恢復（原本會一直停在「停止」；2026-11-11 抓到）
    if (player) player.pause();
    if (playingBtn && playingBtn !== btn) playingBtn.textContent = PLAY_LABEL;
    player = null; playingId = ''; playingBtn = btn;
    btn.textContent = '讀取錄音中…';
    try {
      if (!state.audios[id]) {
        const r = await api({ action: 'audio', fileId: id });
        if (!r.ok) { btn.textContent = r.message || '錄音讀取失敗'; return; }
        state.audios[id] = `data:${r.mime};base64,${r.data}`;
      }
      if (playingBtn !== btn) return; // 讀取期間又按了別段
      player = new Audio(state.audios[id]);
      playingId = id;
      const me = player;
      player.onended = () => { btn.textContent = PLAY_LABEL; if (player === me) { player = null; playingId = ''; } };
      await player.play();
      btn.textContent = '⏸ 停止';
    } catch (e) { btn.textContent = '這支手機無法播放這段錄音'; }
  }

  function speak(btn) {
    // 先找客戶履歷（完整），再找總覽（最近 500 筆）：較舊的拜訪只在履歷裡（第七輪 D-4）
    const inHist = Object.keys(state.hist || {}).map(k => (state.hist[k] || []).find(x => x.id === btn.dataset.speak)).find(Boolean);
    const v = inHist || state.data.visits.find(x => x.id === btn.dataset.speak);
    if (!v || !('speechSynthesis' in window)) { btn.textContent = '這個瀏覽器不支援朗讀'; return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(`${v.name}。${v.summary}。問題：${v.issue || '無'}。下一步：${v.next || '無'}。`);
    u.lang = 'zh-TW'; u.rate = 0.95;
    speechSynthesis.speak(u);
  }

  // 結案那筆資料記成一般拜訪（統計照舊），畫面上標「結案」（董事長 2026-11-12）
  const catPill = v => `<span class="pill p-grn">${esc(v.closing ? '結案' : (v.cat || '試作'))}</span> `;
  /** 沒有摘要時要說清楚原因：處理中、處理失敗、沒送翻譯（原本處理失敗也寫「沒有需要翻譯的內容」；2026-11-11 抓到） */
  function noSummaryText(v) {
    if (v.status === '待處理') return '翻譯處理中，約 10 分鐘內完成';
    if (v.status === '處理異常' || v.status === '翻譯異常') return '⚠ 處理失敗' + (v.error ? '：' + v.error.slice(0, 80) : '') + '（請到試算表看錯誤，修好後把狀態改回「待處理」會重新處理）';
    const hasStuff = v.audio || (v.photos && v.photos.length) || v.text;
    return hasStuff ? '（沒有翻譯：翻譯功能關閉中，或這筆沒有送翻譯）' : '（沒有需要翻譯的內容）';
  }
  function visitItem(v) {
    const flag = v.check && v.check !== '現場拍攝' ? ` <span class="pill p-yel">${esc(v.check)}</span>` : '';
    const st = v.summary ? '' : ` <span class="pill ${v.status === '待處理' ? 'p-yel' : 'p-red'}">${esc(v.status)}</span>`;
    const pending = noSummaryText(v);
    return `<li>${catPill(v)}<b><a href="javascript:void 0" data-go="${esc(v.cid)}">${esc(v.name)}</a></b>｜${esc(v.staff)}｜${esc(v.time)}${flag}${st}<br>
      ${v.summary ? esc(v.summary) + `<br><span class="sub">問題：${esc(v.issue || '—')}　下一步：${esc(v.next || '—')}</span>` : `<span class="sub">${esc(pending)}</span>`}
      ${v.closing ? `<br><span class="sub">${esc(v.closing)}</span>` : ''}${v.prices ? `<br><span class="sub pre">價格：${esc(v.prices)}</span>` : ''}
      ${v.plantFail ? `<br><span class="pill p-red">種植失敗</span> <span class="sub">${esc(v.plantFail)}</span>` : ''}
      ${v.noMeet ? `<br><span class="pill p-yel">沒拜訪</span> <span class="sub">${esc(v.noMeet)}</span>` : ''}
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
    const days = daysBetween(t.start, today);
    const w = MEASURE_WEEKS.filter(x => days >= x * 7).pop();
    if (!w) return null;
    return !lastVisit || String(lastVisit).slice(0, 10) < addDays(t.start, w * 7 - MEASURE_EARLY) ? w : null;
  }
  const custOf = cid => state.data.customers.find(c => c.id === cid) || {};
  /** 本週（含今天往前 7 天）和上週（再往前 7 天）的拜訪次數；總覽只帶最近 500 筆，上週可能不全時標出來（優化 5） */
  function weekCompare(name) {
    const d = state.data, w1 = addDays(d.today, -6), w2 = addDays(d.today, -13);
    const days = d.visits.filter(v => v.staff === name).map(v => v.time.slice(0, 10));
    const oldest = d.visits.map(v => v.time.slice(0, 10)).sort()[0];
    return { now: days.filter(x => x >= w1).length, prev: days.filter(x => x >= w2 && x < w1).length, partial: d.visits.length >= 500 && oldest > w2 };
  }
  function staffCards() {
    const d = state.data, staff = d.staffList || [];
    if (!staff.length) return '';
    const max = d.maxTasks || 10;
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
      const plan = !p ? '<span class="sub">月計劃讀取中…</span>' : !p.ok ? '<span class="sub">月計劃讀取失敗</span>'
        : ps.length ? ps.slice(0, 3).map(x => `<span>${esc(x.label)}　${x.done}／${x.target}${x.done >= x.target ? ' <span class="pill p-grn">達成</span>' : ''}<span class="bar"><i style="width:${pct(x.pct)}%"></i></span></span>`).join('')
          + (ps.length > 3 ? `<span class="sub">還有 ${ps.length - 3} 項，看「更多 → 工作進度明細」</span>` : '')
        : '<span class="sub">本月沒有訂目標</span>';
      return `<button type="button" class="card scard" data-staff="${esc(s.name)}">
        <span class="top"><b>${esc(s.name)}</b><span class="sub">${esc(s.account)}</span></span>
        <span class="row">任務 <b>${open}／${max}</b>${late ? ` <span class="pill p-red">逾期回訪 ${late}</span>` : ''}${idle == null ? ' <span class="pill p-yel">近期沒有拜訪</span>' : idle >= 3 ? ` <span class="pill p-red">${idle} 天沒拜訪</span>` : ''}</span>
        ${plan}
        <span class="row">本週拜訪 <b>${wk.now}</b> 次（上週 ${wk.prev}${wk.partial ? '，資料可能不全' : ''}）${drop ? ` <span class="pill p-red">比上週少 ${wk.prev - wk.now} 次</span>` : ''}</span>
        <span class="row">試作 ${measure ? `<span class="pill p-red">該量測未量測 ${measure}</span>` : ''}<span class="pill p-yel">進行中 ${n('進行中')}</span><span class="pill p-grn">成功 ${n('成功')}</span><span class="pill p-red">失敗 ${n('失敗')}</span>${n('結束') ? `<span class="pill">結束 ${n('結束')}</span>` : ''}</span>
        <span class="sub">最近拜訪：${last ? esc(last.slice(5, 16)) : '—'}</span></button>`;
    };
    return `<h3>每位業務 <span class="sub">（點卡片看這位業務要注意的客戶）</span></h3><div class="staffcards">${staff.map(card).join('')}</div>`;
  }

  function renderToday() {
    return renderClosings() + staffCards() + renderTodayLists();
  }
  /** 待確認結案（0.4.33 董事長：怕業務結案按錯 → 主管確認才算）：有才顯示，放總覽最上面 */
  function renderClosings() {
    const list = state.data.closings || [];
    if (!list.length) return '';
    return `<section class="closings"><h3><span class="pill p-red">待確認結案 ${list.length} 筆</span> <span class="sub">業務按了結案，確認後才真的結案；按錯就退回</span></h3>
      <ul class="list">${list.map(c => `<li><b><a href="javascript:void 0" data-go="${esc(c.cid)}">${esc(c.name)}</a></b>｜${esc(c.staff)}｜${esc(c.date)}<br>
        <span class="sub">${c.result ? esc(c.result) /* 0.4.42 盤商、種子商洽談成功／失敗 */ : `賣給 ${esc(c.buyer || '—')}（${esc(c.region || '地區未填')}）｜價格 ${esc(c.price)} ${esc(c.priceUnit || '')}｜產量 ${esc(c.yield)} ${esc(c.yieldUnit || '')}${c.phone ? '｜電話 ' + esc(c.phone) : ''}${c.reason ? '｜原因 ' + esc(c.reason) : ''}${c.progress ? '｜進度 ' + esc(c.progress) : ''}`}</span><br>
        <button class="btn primary" type="button" data-closedecide="confirm" data-vid="${esc(c.visitId)}">確認結案</button>
        <button class="btn" type="button" data-closedecide="reject" data-vid="${esc(c.visitId)}">退回（不結案）</button></li>`).join('')}</ul>
      <p class="sub" id="closeMsg" aria-live="polite">${esc(state.closeMsg || '')}</p></section>`;
  }
  function renderTodayLists() {
    const cs = active();
    const late = cs.filter(c => dueState(c) === 'late'), due = cs.filter(c => dueState(c) === 'due');
    const li = c => { const l = visitsOf(c.id)[0]; return `<li><b><a href="javascript:void 0" data-go="${esc(c.id)}">${esc(c.name)}</a></b>（${esc(c.crop || '—')}）— ${esc(c.staff || '未指派')}${c.nextDue ? ' — 應回訪 ' + md(c.nextDue) : ''}${l && l.issue && l.issue !== '無' ? `<br><span class="sub">上次問題：${esc(l.issue)}</span>` : ''}</li>`; };
    return `<section><h3><span class="pill p-red">逾期</span></h3><ul class="list">${late.map(li).join('') || '<li class="empty">沒有</li>'}</ul></section>
      <section><h3><span class="pill p-yel">今天該回訪</span></h3><ul class="list">${due.map(li).join('') || '<li class="empty">沒有</li>'}</ul></section>`;
  }
  /** 最新拜訪（0.4.28 董事長：總覽一頁不要放太多東西 → 從總覽拆出來成獨立分頁） */
  function renderLatest() {
    const recent = state.data.visits.slice().sort((a, b) => b.time.localeCompare(a.time)).slice(0, 15);
    return `<section><h3><span class="pill p-grn">最新拜訪</span> <span class="sub">最近 15 筆</span></h3><ul class="list">${recent.map(visitItem).join('') || '<li class="empty">還沒有拜訪紀錄。業務用打卡網頁上傳後，這裡就會出現。</li>'}</ul></section>`;
  }

  function renderCal() {
    const t = s2d(state.data.today);
    const monday = addDays(state.data.today, -((t.getUTCDay() + 6) % 7) - 7);
    const days = Array.from({ length: 21 }, (_, i) => addDays(monday, i));
    const ev = {}; days.forEach(d => { ev[d] = []; });
    state.data.visits.forEach(v => { const d = v.time.slice(0, 10); if (ev[d]) ev[d].push(`<button class="ev visit" data-go="${esc(v.cid)}">✅ ${esc(v.time.slice(11, 16))} ${esc(v.name)}</button>`); });
    active().forEach(c => {
      const s = dueState(c);
      if (s === 'late') ev[state.data.today].unshift(`<button class="ev late" data-go="${esc(c.id)}">⚠ 逾期｜${esc(c.name)}</button>`);
      else if (c.nextDue && ev[c.nextDue]) ev[c.nextDue].push(`<button class="ev follow" data-go="${esc(c.id)}">🔔 回訪｜${esc(c.name)}</button>`);
    });
    return `<div class="cal-wrap"><div class="cal">${['一', '二', '三', '四', '五', '六', '日'].map(x => `<div class="dow">週${x}</div>`).join('')}
      ${days.map(d => `<div class="day${d === state.data.today ? ' today' : ''}"><span class="d">${md(d)}${d === state.data.today ? ' 今天' : ''}</span>${ev[d].join('')}</div>`).join('')}</div></div>
      <div class="legend"><span style="--c:var(--paddy)">已拜訪</span><span style="--c:var(--turmeric)">預定回訪</span><span style="--c:var(--chili)">逾期</span></div>
      <p class="sub">點任何一個行程，就會打開那位客戶的試作履歷。同樣的行程也在 Google 日曆「農戶拜訪」裡。</p>`;
  }

  /* ───── 客戶頁：搜尋＋篩選＋按業務分組，預設只列要注意的（2026-11-12 規劃 B） ───── */
  const isActive = c => c.status !== '已結束' && c.status !== '暫停';
  /** 這位客戶為什麼要注意：逾期／今天該回訪／試作進行中／7 天內拜訪過；都不是就回 null */
  function attnOf(c) {
    const d = state.data, s = dueState(c);
    if (isActive(c) && s === 'late') return { cls: 'p-red', text: `逾期 ${daysBetween(c.nextDue, d.today)} 天`, rank: 0 };
    if (isActive(c) && s === 'due') return { cls: 'p-yel', text: '今天該回訪', rank: 1 };
    const t = (d.trials || []).find(x => x.cid === c.id && x.status === '進行中');
    const mw = measureDue(t, c.lastVisit, d.today);
    if (mw) return { cls: 'p-red', text: `第 ${mw} 週該量測`, rank: 1.5 };
    if (t) { const w = weekNo({ start: t.start }, d.today); return { cls: 'p-yel', text: `${t.cat || '試作'}${w ? '第 ' + w + ' 週' : '中'}`, rank: 2 }; }
    if (c.lastVisit && c.lastVisit >= addDays(d.today, -7)) return { cls: 'p-grn', text: `${md(c.lastVisit)} 拜訪`, rank: 3 };
    return null;
  }
  const NO_STAFF = '（未指派）';
  /** 符合篩選的客戶。有打搜尋字時找全部客戶（不限「要注意的」），找不到人才不會以為客戶不見 */
  function custFiltered() {
    const f = state.cf, q = f.q.trim().toLowerCase();
    return state.data.customers.filter(c => (!f.staff || (c.staff || NO_STAFF) === f.staff) && (!f.area || c.area === f.area) && (!f.type || (c.type || '農民') === f.type)
      && (q ? [c.name, c.phone, c.id, c.crop, c.area].some(x => String(x == null ? '' : x).toLowerCase().includes(q)) : (f.show !== 'attn' || attnOf(c))));
  }
  /** 右邊（手機在下面）要顯示誰的履歷：有指定就是他，沒有就是篩選結果的第一位 */
  function custSelected() {
    const cs = state.data.customers;
    return cs.find(x => x.id === state.trial) || custFiltered().slice().sort(custOrder)[0] || null;
  }
  function custOrder(a, b) {
    const ra = attnOf(a), rb = attnOf(b);
    return ((ra ? ra.rank : 9) - (rb ? rb.rank : 9)) || String(a.name).localeCompare(String(b.name));
  }
  function renderCustList() {
    const list = custFiltered(), sel = custSelected();
    if (!list.length) return `<p class="empty">${state.cf.q ? '找不到符合的客戶' : state.cf.show === 'attn' ? '沒有要注意的客戶（篩選選「全部客戶」可以看全部）' : '沒有符合篩選的客戶'}</p>`;
    const order = (state.data.staffList || []).map(s => s.name);
    const groups = {};
    list.forEach(c => { const k = c.staff || NO_STAFF; (groups[k] = groups[k] || []).push(c); });
    const names = Object.keys(groups).sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b); });
    const openDefault = list.length <= 40 || names.length === 1;
    return `<p class="sub" style="margin:0 0 6px">共 ${list.length} 位</p>` + names.map(k => {
      const open = k in state.grpOpen ? state.grpOpen[k] : openDefault;
      return `<details class="grp" data-grp="${esc(k)}"${open ? ' open' : ''}><summary>${esc(k)}（${groups[k].length}）</summary><ul>${groups[k].slice().sort(custOrder).map(c => {
        const a = attnOf(c);
        return `<li><button type="button" class="crow" data-go="${esc(c.id)}" aria-current="${sel && sel.id === c.id}"><span><b>${esc(c.name)}</b><span class="sub">${esc(c.type || '農民')}${c.crop ? '・' + esc(c.crop) : ''}${c.area ? '・' + esc(c.area) : ''}</span></span>${a ? `<span class="pill ${a.cls}">${esc(a.text)}</span>` : ''}</button></li>`;
      }).join('')}</ul></details>`;
    }).join('');
  }
  function bindCustomers() {
    const q = $('custQ');
    if (q) q.addEventListener('input', () => { state.cf.q = q.value; const box = $('custList'); box.innerHTML = renderCustList(); bindCustList(box); biDom(box); });
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
    if (!cs.length) return '<p class="empty">還沒有客戶。業務在打卡網頁選「臨時新增農民」，或在試算表「客戶清單」新增。</p>';
    const f = state.cf;
    const sel = (key, label, values, all) => `<select data-cf="${key}" aria-label="${label}">${all ? `<option value="">${all}</option>` : ''}${values.map(v => { const [val, txt] = Array.isArray(v) ? v : [v, v]; return `<option value="${esc(val)}"${f[key] === val ? ' selected' : ''}>${esc(txt)}</option>`; }).join('')}</select>`;
    const uniq = arr => [...new Set(arr.filter(Boolean))];
    const staffNames = uniq((state.data.staffList || []).map(s => s.name).concat(cs.map(c => c.staff || NO_STAFF)));
    const tools = `<div class="custtools"><input type="search" id="custQ" placeholder="搜尋全部客戶：名字、電話、編號、作物" value="${esc(f.q)}" aria-label="搜尋客戶">
      <div class="filters">${sel('show', '顯示', [['attn', '要注意的'], ['all', '全部客戶']])}${sel('staff', '業務', staffNames, '全部業務')}${sel('area', '地區', uniq(cs.map(c => c.area)), '全部地區')}${sel('type', '類型', ['農民', '盤商', '種子商'], '全部類型')}</div>
      <span class="sub">要注意的＝逾期、今天該回訪、試作進行中、7 天內拜訪過</span></div>`;
    const c = custSelected();
    return `<div class="custgrid"><div>${tools}<div id="custList">${renderCustList()}</div></div>
      <div id="custDetail">${c ? renderCustDetail(c) : '<p class="empty">左邊選一位客戶，就會在這裡看到他的履歷。</p>'}</div></div>`;
  }

  function renderCustDetail(c) {
    const list = visitsOf(c.id), s = dueState(c);
    const dealer = c.type === '盤商' || c.type === '種子商';
    const kv = (k, val) => val !== '' && val != null ? `<span>${k}：${esc(val)}</span>` : '';
    return `<div class="card profile"><span><b>${esc(c.name)}</b>（${esc(c.id)}・${esc(c.type || '農民')}）</span><span>${esc(c.area || '')}</span>${kv('電話', c.phone)}
        ${dealer ? kv('老闆', c.owner) + kv('地址', c.address) + kv('品牌', c.brand)
          : kv('作物', c.crop) + kv('品種', c.variety) + kv('代碼', c.varCode) + kv('目前種植面積', c.areaNow) + kv('可種植面積', c.areaMax) + kv('種植日期', c.plantDate) + kv('使用肥料', c.fertilizer)
            + `<span>試作：${esc(c.trial || '—')}${c.start ? '（' + md(c.start) + ' 開始）' : ''}</span>`}<span>負責：${esc(c.staff || '—')}</span>
        <span>下次回訪：${c.nextDue ? md(c.nextDue) : '—'} ${s === 'late' ? '<span class="pill p-red">逾期</span>' : s === 'due' ? '<span class="pill p-yel">今天</span>' : ''}</span>
        ${c.lat != null && c.lng != null ? `<a href="https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}" target="_blank" rel="noopener">田區導航 ↗</a>` : ''}</div>
      ${(state.data.trials || []).filter(t => t.cid === c.id).map(t => `<div class="card" style="margin-bottom:10px"><b>${esc(t.cat)} ${esc(t.id)}</b>：${esc(t.item || '—')}（${esc(t.start || '')} ～ ${esc(t.end || '進行中')}）
        <span class="pill ${t.status === '成功' ? 'p-grn' : t.status === '失敗' ? 'p-red' : 'p-yel'}">${esc(t.status)}</span>
        ${t.hasReport ? ` <button class="btn" type="button" data-report="${esc(t.id)}">⬇ 試作報告（Word）</button>` : ''}
        ${t.conclusion ? `<div class="sub pre" style="margin-top:6px">結論：${esc(t.conclusion)}</div>` : ''}</div>`).join('')}
      <div class="timeline">${list.map(v => `<div class="entry">${catPill(v)}<b>${esc(v.time)}</b>${!dealer && visitWeek(v) ? `　試作第 ${visitWeek(v)} 週` : ''} <span class="sub">${esc(v.staff)}</span>
        <div class="sub">${v.lat != null && v.lng != null ? `📍 <a href="${esc(v.nav)}" target="_blank" rel="noopener">${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}（導航）</a>` : '📍 <span style="color:var(--chili)">無定位</span>'}
        　📷 ${v.check ? esc(v.check) : '現場拍攝'}</div>
        <div class="box"><div class="photos">${v.photos.length ? v.photos.map(id => `<div class="photo" data-photo="${esc(id)}">載入中…</div>`).join('') : '<div class="photo">沒有照片</div>'}</div>
        <dl class="kv"><dt>${dealer ? '行情' : '作物'}</dt><dd>${esc(v.crop || '—')}</dd><dt>反應</dt><dd>${esc(v.feedback || '—')}</dd><dt>問題</dt><dd>${esc(v.issue || '—')}</dd><dt>下一步</dt><dd>${esc(v.next || '—')}</dd>
        <dt>摘要</dt><dd>${esc(v.summary || noSummaryText(v))}</dd>
        ${v.closing ? `<dt>結案</dt><dd>${esc(v.closing)}</dd>` : ''}${v.plantFail ? `<dt>種植失敗</dt><dd>${esc(v.plantFail)}</dd>` : ''}${v.text ? `<dt>打字</dt><dd class="pre">${esc(v.text)}</dd>` : ''}${v.prices ? `<dt>價格</dt><dd class="pre">${esc(v.prices)}</dd>` : ''}</dl></div>${soundBtns(v)}</div>`).join('') || '<p class="empty">這位客戶還沒有拜訪紀錄。</p>'}</div>`;
  }

  /** 一張照片只下載一次（下載中的也共用同一個請求）；換了畫面，舊畫面的迴圈就停，不再下載別的客戶的照片（2026-11-11 抓到） */
  function getPhoto(id) {
    if (state.photos[id]) return Promise.resolve({ ok: true });
    if (!state.photoReq[id]) {
      state.photoReq[id] = api({ action: 'photo', fileId: id })
        .then(r => { if (r.ok) state.photos[id] = `data:${r.mime};base64,${r.data}`; return r; })
        .catch(() => ({ ok: false, message: '照片讀取失敗' }))
        .finally(() => { delete state.photoReq[id]; });
    }
    return state.photoReq[id];
  }
  async function loadPhotos() {
    const gen = state.renderGen;
    for (const el of $('panel').querySelectorAll('[data-photo]')) {
      if (gen !== state.renderGen) return;
      const id = el.dataset.photo;
      if (!id) continue;
      const r = await getPhoto(id);
      if (!el.isConnected) continue;
      if (state.photos[id]) el.innerHTML = `<img src="${state.photos[id]}" alt="田間照片">`;
      else el.textContent = (r && r.message) || '照片讀取失敗';
    }
  }

  function renderMap() {
    const pts = state.data.customers.filter(c => c.lat && c.lng);
    if (!pts.length) return '<p class="empty">還沒有田區座標。業務第一次拜訪時的位置會自動記成田區座標。</p>';
    const lats = pts.map(c => c.lat), lngs = pts.map(c => c.lng);
    const pad = 0.02, minLat = Math.min(...lats) - pad, maxLat = Math.max(...lats) + pad, minLng = Math.min(...lngs) - pad, maxLng = Math.max(...lngs) + pad;
    const W = 700, H = 420;
    const x = v => 50 + (v - minLng) / (maxLng - minLng) * (W - 160), y = v => 30 + (maxLat - v) / (maxLat - minLat) * (H - 60);
    const color = s => s === 'late' ? 'var(--chili)' : s === 'due' ? 'var(--turmeric)' : 'var(--paddy)';
    return `<div class="card map"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="田區位置圖">
      <rect width="${W}" height="${H}" fill="var(--bg)" rx="8"/>
      ${pts.map(c => { const s = dueState(c); return `<g data-go="${esc(c.id)}" style="cursor:pointer"><circle cx="${x(c.lng)}" cy="${y(c.lat)}" r="${s === 'late' ? 12 : 8}" fill="${color(s)}" fill-opacity=".85" stroke="var(--surface)" stroke-width="2"/>
        <text x="${x(c.lng) + 15}" y="${y(c.lat) + 4}" fill="var(--fg)" font-size="12" font-weight="700">${esc(c.name)}</text></g>`; }).join('')}
      </svg><div class="legend"><span style="--c:var(--paddy)">已排定</span><span style="--c:var(--turmeric)">今天該去</span><span style="--c:var(--chili)">逾期（大圓點）</span></div></div>
      <ul class="list" style="margin-top:10px">${pts.map(c => `<li>${esc(c.name)}・${esc(c.area || '')}　<a href="https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}" target="_blank" rel="noopener">用 Google 地圖導航 ↗</a></li>`).join('')}</ul>`;
  }

  /* ───── 試作報告列表（2B）：依結果、地區、業務篩選，下載 Word ───── */
  function renderReports() {
    const ts = (state.data.trials || []).slice().sort((a, b) => String(b.end || b.start).localeCompare(String(a.end || a.start)));
    if (!ts.length) return '<p class="empty">還沒有試作。業務在打卡網頁選「試作」或「推廣」→「開始新的試作」，結束時填結果，報告會自動產生在這裡。</p>';
    const f = state.rf;
    const opt = (key, label, values) => `<select data-filter="${key}" aria-label="${label}"><option value="">全部${label}</option>${values.map(v => `<option value="${esc(v)}"${f[key] === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
    const uniq = k => [...new Set(ts.map(t => t[k]).filter(Boolean))];
    const list = ts.filter(t => (!f.status || t.status === f.status) && (!f.area || t.area === f.area) && (!f.staff || t.staff === f.staff) && (!f.cat || t.cat === f.cat));
    const pill = s => `<span class="pill ${s === '成功' ? 'p-grn' : s === '失敗' ? 'p-red' : s === '進行中' ? 'p-yel' : ''}">${esc(s)}</span>`;
    const rep = t => t.hasReport ? `<button class="btn" type="button" data-report="${esc(t.id)}">⬇ 下載 Word</button>`
      : t.report === '待產生' ? '<span class="sub">報告產生中（約 10 分鐘）</span>' : t.report === '產生失敗' ? '<span class="pill p-red">報告產生失敗，請看錯誤紀錄</span>' : '<span class="sub">結束後才有報告</span>';
    return `<div class="filters">${opt('status', '結果', ['進行中', '成功', '失敗', '結束'])}${opt('cat', '類別', uniq('cat'))}${opt('area', '地區', uniq('area'))}${opt('staff', '業務', uniq('staff'))}</div>
      <div class="tbl"><table><thead><tr><th>編號</th><th>類別</th><th>客戶</th><th>品項</th><th>期間</th><th>結果</th><th>量測</th><th>報告</th></tr></thead><tbody>
      ${list.map(t => `<tr><td>${esc(t.id)}</td><td>${esc(t.cat)}</td><td><a href="javascript:void 0" data-go="${esc(t.cid)}">${esc(t.name)}</a><br><span class="sub">${esc(t.area || '')}・${esc(t.staff || '')}</span></td>
        <td>${esc(t.item || '—')}<br><span class="sub">${esc(t.dosage || '')}</span></td><td>${esc(t.start || '')} ～ ${esc(t.end || '')}</td><td>${pill(t.status)}${t.reason ? `<br><span class="sub">${esc(t.reason)}</span>` : ''}</td>
        <td class="sub">${[t.height !== '' && t.height != null ? '株高 ' + esc(t.height) : '', t.grains !== '' && t.grains != null ? '穗粒 ' + esc(t.grains) : '', t.yield !== '' && t.yield != null ? '產量 ' + esc(t.yield) + ' ' + esc(t.yieldUnit || '') : '', t.score ? '評分 ' + esc(t.score) : ''].filter(Boolean).join('<br>') || '—'}</td><td>${rep(t)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">沒有符合篩選的試作</td></tr>'}
      </tbody></table></div><p class="sub">共 ${list.length} 件。Word 報告也存在該客戶的雲端硬碟資料夾。</p>`;
  }

  async function downloadReport(btn) {
    const label = btn.textContent;
    btn.textContent = '下載中…'; btn.disabled = true;
    try {
      const r = await api({ action: 'report', trialId: btn.dataset.report });
      if (!r.ok) { btn.textContent = r.message || '下載失敗'; return; }
      const bytes = Uint8Array.from(atob(r.data), ch => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
      const a = document.createElement('a'); a.href = url; a.download = r.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      btn.textContent = label;
    } catch (e) { btn.textContent = '下載失敗，請再試'; } finally { btn.disabled = false; }
  }

  /* ───── 工作進度（2C）：每位業務的數字、月計劃達成、各地區統計 ───── */
  function monthsBack(n) { const out = []; const [y, m] = state.data.today.split('-').map(Number); for (let i = 0; i < n; i++) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(d.toISOString().slice(0, 7)); } return out; }
  function renderProgress() {
    const months = monthsBack(6);
    if (!state.pm) state.pm = months[0];
    const sel = `<div class="filters"><select data-month="1" aria-label="月份">${months.map(m => `<option value="${m}"${m === state.pm ? ' selected' : ''}>${m.slice(0, 4)} 年 ${Number(m.slice(5))} 月</option>`).join('')}</select></div>`;
    const p = state.prog[state.pm];
    if (!p) return sel + '<p class="sub">讀取中…</p>';
    if (!p.ok) return sel + `<p class="empty">${esc(p.message || '讀取失敗')}</p>`;
    const planHtml = list => list.length ? `<div class="plans">${list.map(x => `<span>${esc(x.label)}（${esc(x.period)}）<span class="bar"><i style="width:${Math.max(0, Math.min(100, x.pct))}%"></i></span>${x.done}／${x.target}${x.done >= x.target ? ' <span class="pill p-grn">達成</span>' : ''}</span>`).join('')}</div>` : '<span class="sub">沒有目標</span>';
    const cats = ['試作', '推廣', '農戶', '盤商', '種子商']; // 「農戶」顯示成「一般拜訪」；盤商、種子商分開算（2026-11-11 董事長）
    return sel + `<h3>每位業務（${esc(p.label)}）</h3><div class="tbl"><table><thead><tr><th>業務</th><th>拜訪</th>${cats.map(c => `<th>${c === '農戶' ? '一般拜訪' : c}</th>`).join('')}<th>拜訪過的客戶</th><th>新增客戶</th><th>試作 開始／完成</th><th>計劃達成</th></tr></thead><tbody>
      ${p.staff.map(s => `<tr><td><b>${esc(s.name)}</b></td><td>${s.visits}</td>${cats.map(c => `<td>${s.byCategory[c] || 0}</td>`).join('')}<td>${s.customersVisited}</td><td>${s.newCustomers}</td><td>${s.trialsStarted}／${s.trialsEnded}</td><td>${planHtml(s.plan)}</td></tr>`).join('') || '<tr><td colspan="11" class="empty">沒有業務帳號</td></tr>'}
      </tbody></table></div>
      <h3>各地區</h3><div class="tbl"><table><thead><tr><th>地區</th><th>農民</th><th>盤商</th><th>種子商</th><th>本月拜訪</th><th>進行中的試作</th></tr></thead><tbody>
      ${p.regions.map(r => `<tr><td>${esc(r.area)}</td><td>${r.customers}</td><td>${r.dealers}</td><td>${r.seeds || 0}</td><td>${r.visits}</td><td>${r.trialsActive}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">還沒有客戶</td></tr>'}
      </tbody></table></div><p class="sub">目標在試算表「計劃」分頁設定：月份空白＝每個月都適用；業務空白＝每位業務各自的目標；指標有拜訪次數、拜訪客戶數、新增客戶、開始試作、完成試作。</p>`;
  }
  /* ───── 任務：主管、總經理派給業務（每條跟著一位農民）；總經理另外派給主管（可以不指定客戶）（2026-11-12）─────
     業務在手機打勾；主管在這裡「我的任務」按「完成了」 */
  const isGM = () => state.data.role === '總經理';
  // 0.4.24：客戶已結案、任務還沒做 → 標出來，主管看得到該取消；0.4.25 主管「我的任務」也標（第5任獨立審查 低4）
  const closedPill = t => (t.status === '待辦' && t.cid && (state.data.customers || []).some(c => c.id === t.cid && c.status === '已結束') ? '<span class="pill p-red">客戶已結案</span> ' : '');
  function taskLine(t, cancel) {
    const who = t.cid ? `<b><a href="javascript:void 0" data-go="${esc(t.cid)}">${esc(t.name)}</a></b>：` : '';
    // 0.4.24：客戶已結案、任務還沒做 → 標出來，主管看得到該取消（業務手機上這條也沒有「去拜訪」了）
    return `<li>${who}${closedPill(t)}${t.by === '系統建議' ? '<span class="pill p-yel">系統</span> ' : ''}${esc(t.text)}
        <span class="sub">${esc(t.by || '')} ${esc(String(t.at).slice(5, 16))} 派</span>${cancel ? ` <button class="btn" type="button" data-taskcancel="${esc(t.id)}">取消</button>` : ''}</li>`;
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
    const myBox = d.role === '主管' ? `<h3>我的任務 <span class="sub">（總經理派給你的）</span></h3><ul class="mytasks">${mine.map(t => `<li><span>${t.cid ? `<b><a href="javascript:void 0" data-go="${esc(t.cid)}">${esc(t.name)}</a></b>：` : ''}${closedPill(t)}${esc(t.text)}
        <span class="sub">${esc(t.by || '')} ${esc(String(t.at).slice(5, 16))} 派</span></span><button class="btn" type="button" data-mytaskdone="${esc(t.id)}">完成了</button></li>`).join('') || '<li class="empty">沒有任務</li>'}</ul>` : '';
    const opt = s => `<option value="${esc(s.account)}"${f.staff === s.account ? ' selected' : ''}>${esc(s.name)}（${esc(s.account)}）</option>`;
    const custSel = toBoss
      ? `<select id="tFarmer" aria-label="哪一位客戶（可以不選）"><option value="">— 不指定客戶 —</option>${allCust.map(c => `<option value="${esc(c.id)}"${f.cid === c.id ? ' selected' : ''}>${esc(c.name)}｜${esc(c.type || '農民')}${c.area ? '｜' + esc(c.area) : ''}</option>`).join('')}</select>`
      : `<select id="tFarmer" aria-label="哪一位農民"><option value="">— 選擇農民 —</option>${farmers.map(c => `<option value="${esc(c.id)}"${f.cid === c.id ? ' selected' : ''}>${esc(c.name)}${c.area ? '｜' + esc(c.area) : ''}${c.staff ? '（' + esc(c.staff) + '）' : ''}</option>`).join('')}</select>`;
    const form = staff.length || bosses.length ? `<h3>派出任務</h3><form class="taskform" id="taskForm">
        <select id="tStaff" aria-label="派給誰">${bosses.length ? `<optgroup label="業務">${staff.map(opt).join('')}</optgroup><optgroup label="主管">${bosses.map(opt).join('')}</optgroup>` : staff.map(opt).join('')}</select>
        ${custSel}
        <input id="tText" maxlength="200" placeholder="${toBoss ? '任務內容，例如：這週整理 A 區價格、陪新業務跑一趟' : '任務內容，例如：送肥料樣品、量株高'}" value="${esc(f.text)}">
        <button class="btn" type="submit" id="tAdd">${toBoss ? '派給主管' : '派給業務'}</button>
        <span class="sub" id="tMsg" aria-live="polite">${esc(state.taskMsg || '')}</span></form>`
      : '<p class="empty">還沒有啟用的業務帳號，先在「更多 → 業務帳號」開通。</p>';
    const block = (s, canCancel) => {
      const list = openOf(s.account);
      return `<h3>${esc(s.name)}（${esc(s.account)}）　<span class="sub">${list.length}／${max} 條沒完成</span></h3><ol class="tasks">${list.map(t => taskLine(t, canCancel)).join('') || '<li class="empty">沒有任務</li>'}</ol>`;
    };
    // 收任務的帳號查不到（被改名、刪掉）：只有總經理看得到、能取消（R8-07）
    // 主管BUG#5（1號 0.4.63）：帳號停用的人不在 staffList／bossList，他沒做完的任務原本整條消失、取消不了，卻還佔 10 條上限
    // → 不在名單裡的待辦都列出來：總經理看全部；主管看派給業務的（後台 taskCancel_ 本來就允許主管取消業務的任務）
    const listed = new Set(staff.concat(bosses).map(s => String(s.account)));
    const orphan = tasks.filter(t => t.status === '待辦' && !listed.has(String(t.account)) && (isGM() || t.role === '業務'));
    const open = staff.map(s => block(s, true)).join('') + (bosses.length ? '<h3>派給主管的任務</h3>' + bosses.map(s => block(s, true)).join('') : '')
      + (orphan.length ? `<h3>帳號停用或查不到的人沒做完的任務 <span class="sub">（帳號停用、改名或刪掉；可以按取消，免得佔掉 10 條上限）</span></h3><ol class="tasks">${orphan.map(t => taskLine(t, true).replace('</li>', ` <span class="sub">｜${esc(t.staff)}（${esc(t.account)}）</span></li>`)).join('')}</ol>` : '');
    // 完成清單：主管看不到總經理派給別的主管的任務
    const done = tasks.filter(t => t.status !== '待辦' && (t.role !== '主管' || isGM() || t.account === d.account)).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
    return myBox + form + open + `<h3>最近 30 天完成或取消的</h3><ul>${done.map(t => `<li>${t.status === '已完成' ? '<span class="pill p-grn">完成</span>' : '<span class="pill">取消</span>'}
      ${t.cid ? `<b>${esc(t.name)}</b>：` : ''}${t.by === '系統建議' ? '<span class="pill p-yel">系統</span> ' : ''}${esc(t.text)}<span class="sub">｜${esc(t.staff)}${t.role === '主管' ? '（主管）' : ''}｜${esc(String(t.doneAt).slice(5, 16))}${t.doneBy === '系統（已拜訪）' ? '（去拜訪後自動完成）' : ''}${t.status === '取消' ? '（' + esc(t.doneBy) + ' 取消）' : ''}</span></li>`).join('') || '<li class="empty">還沒有</li>'}</ul>`;
  }
  function bindTasks() {
    const form = $('taskForm');
    if (form) {
      const keep = () => { state.tf = { staff: $('tStaff').value, cid: $('tFarmer').value, text: $('tText').value }; };
      ['tFarmer', 'tText'].forEach(id => $(id).addEventListener('input', keep));
      // 換對象（業務 ↔ 主管）時客戶選單不一樣，重畫；原本選的客戶清掉
      $('tStaff').addEventListener('change', () => { keep(); state.tf.cid = ''; state.taskMsg = ''; render(); });
      form.addEventListener('submit', async ev => {
        ev.preventDefault(); keep();
        const toBoss = isGM() && (state.data.bossList || []).some(b => b.account === state.tf.staff);
        if (!toBoss && !state.tf.cid) { $('tMsg').textContent = '請選一位農民'; return; }
        if (!state.tf.text.trim()) { $('tMsg').textContent = '請填任務內容'; return; }
        $('tAdd').disabled = true; $('tMsg').textContent = '送出中…';
        let r;
        try { r = await api({ action: 'taskAdd', staff: state.tf.staff, cid: state.tf.cid, text: state.tf.text.trim() }); } catch (e) { r = { ok: false, message: '連不上伺服器，請再試一次' }; }
        if (r.ok) { state.data.tasks = r.tasks; state.tf.text = ''; state.taskMsg = toBoss ? '已派出（主管打開主管網頁「任務」就會看到）' : '已派出（業務手機下次同步就會看到）'; }
        else state.taskMsg = '⚠ ' + (r.message || '派發失敗');
        render();
      });
    }
    $('panel').querySelectorAll('[data-taskcancel]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('確定取消這條任務？對方畫面上會消失。')) return;
      b.disabled = true;
      let r;
      try { r = await api({ action: 'taskCancel', id: b.dataset.taskcancel }); } catch (e) { r = { ok: false, message: '連不上伺服器' }; }
      if (r.ok) { state.data.tasks = r.tasks; state.taskMsg = '已取消'; } else state.taskMsg = '⚠ ' + (r.message || '取消失敗');
      render();
    }));
    // 主管完成自己的任務：用跟業務手機打勾同一個動作（只能完成自己的）
    $('panel').querySelectorAll('[data-mytaskdone]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      let r;
      try { r = await api({ action: 'taskDone', done: [{ id: b.dataset.mytaskdone, at: Date.now() }] }); } catch (e) { r = { ok: false, message: '連不上伺服器，請再試一次' }; }
      if (r.ok && (r.done || []).indexOf(b.dataset.mytaskdone) >= 0) { state.taskMsg = '已完成'; await load(); return; }
      state.taskMsg = '⚠ ' + (r.message || '沒有完成，請再按一次');
      render();
    }));
  }

  /* ───── 主管匯報（2026-11-12）：主管寫給總經理，系統附上這段期間的數字；總經理看、回覆 ───── */
  function newRid() { const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, x => x.toString(16).padStart(2, '0')).join(''); }
  /** 匯報內容：有中文翻譯就「中文翻譯」＋「緬文原文」都列（0.4.34 董事長：主管打緬文，總經理要看到緬文跟中文） */
  function briefTexts(b) {
    const orig = `<div class="pre">${esc(b.text)}</div>`;
    if (b.zh) return `<div class="zh-box"><b>中文翻譯</b><div class="pre">${esc(b.zh)}</div></div><div class="orig-box"><b>緬文原文</b>${orig}</div>`;
    if (b.zhState === '待翻譯') return `${orig}<p class="sub">中文翻譯處理中（翻譯額度恢復後自動補上）</p>`;
    if (b.zhState === '翻譯失敗') return `${orig}<p class="sub">⚠ 中文翻譯失敗，請到試算表「主管匯報」把翻譯狀態改回「待翻譯」重試</p>`;
    return orig;
  }
  function briefItem(b, gm) {
    const unread = gm && !b.read;
    return `<details class="brief" data-brief="${esc(b.id)}"${unread ? ' data-unread="1"' : ''}${state.briefOpen === b.id ? ' open' : ''}>
      <summary>${unread ? '<span class="pill p-red">未讀</span>' : ''}${b.reply ? '<span class="pill p-grn">已回覆</span>' : ''}<b>${esc(b.boss)}</b>
        <span class="sub">${esc(b.from)} ～ ${esc(b.to)}・${esc(String(b.date).slice(5, 16))} 送出</span></summary>
      <div class="body">${briefTexts(b)}
        <div class="stats-box"><b>系統附上的數字</b><div class="pre">${esc(b.stats)}</div></div>
        ${b.reply ? `<div class="answer"><b>總經理回覆</b><span class="sub">（${esc(b.replyBy)} ${esc(String(b.replyAt).slice(5, 16))}）</span><div class="pre">${esc(b.reply)}</div></div>` : ''}
        ${gm ? `<form class="reply" data-replyform="${esc(b.id)}"><textarea maxlength="1000" placeholder="回覆給 ${esc(b.boss)}（例如：好，下週先處理 A 區）" aria-label="回覆">${esc((state.replyDraft || {})[b.id] || '')}</textarea>
          <button class="btn" type="submit">送出回覆</button></form>` : ''}
      </div></details>`;
  }
  function renderBriefs() {
    const d = state.data, gm = isGM();
    const list = d.briefs || [];
    if (!d.briefReady) return '<p class="err">試算表還沒有「主管匯報」分頁，請管理員在試算表按「農業CRM → 第一次安裝／升級」一次。</p>';
    const msg = state.briefMsg ? `<p class="sub" role="status">${esc(state.briefMsg)}</p>` : '';
    if (gm) return msg + `<h3>全部匯報 <span class="sub">（${list.filter(b => !b.read).length} 份未讀；打開就算看過）</span></h3>` + (list.map(b => briefItem(b, true)).join('') || '<p class="empty">還沒有</p>');
    const bf = state.bf || (state.bf = { text: '', rid: '', sentText: '' });
    // 送出後沒收到確認（sentText 有值）：內容鎖住不能改，只能用同一個送出代號再送一次確認；
    // 要改內容就按「放棄確認、改成新的一份」（舊的那份可能已經送到）（GPT-6.1 R8-05）
    const pending = !!bf.sentText;
    return `<h3>寫匯報給總經理</h3><form class="briefform" id="briefForm">
        <p class="sub">寫這段期間做了什麼、遇到什麼問題、需要總經理什麼支援。系統會自動附上數字（拜訪次數、試作成功／失敗、任務、逾期回訪），期間從你上一次匯報的隔天到今天（第一次＝最近 7 天）。送出後會寄通知信給總經理。</p>
        ${pending ? '<p class="err" role="status">上一次送出沒有收到確認，內容先鎖住；請按「再送一次確認」（不會變成兩份）。</p>' : ''}
        <textarea id="bText" maxlength="2000" placeholder="例如：這週 A 區拜訪 12 次，U Myo Min 試作成功；B 區兩位農民缺肥料，需要總經理同意先送樣品。" aria-label="匯報內容"${pending ? ' readonly' : ''}>${esc(pending ? bf.sentText : bf.text)}</textarea>
        <button class="btn primary" type="submit" id="bSend">${pending ? '再送一次確認' : '送出匯報'}</button>
        ${pending ? '<button class="btn" type="button" id="bNew">放棄確認、改成新的一份</button>' : ''}</form>` + msg +
      `<h3>我送出的匯報</h3>` + (list.map(b => briefItem(b, false)).join('') || '<p class="empty">還沒有</p>');
  }
  function bindBriefs() {
    const form = $('briefForm');
    if (form) {
      $('bText').addEventListener('input', () => { if (!state.bf.sentText) state.bf.text = $('bText').value; });
      if ($('bNew')) $('bNew').addEventListener('click', () => {
        if (!confirm('上一份可能已經送到總經理那邊。確定要改成新的一份？（之後送出會是另一份匯報）')) return;
        state.bf = { text: state.bf.sentText, rid: '', sentText: '' }; state.briefMsg = ''; render();
      });
      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        const text = (state.bf.sentText || $('bText').value).trim();
        if (!text) { state.briefMsg = '請先寫匯報內容'; render(); return; }
        // 同一份內容重送用同一個送出代號，網路斷掉再按一次也不會變成兩份；送出時把內容一起記住（鎖住不能改）
        if (!state.bf.rid) state.bf.rid = newRid();
        state.bf.sentText = text;
        $('bSend').disabled = true; $('bSend').textContent = '送出中…';
        let r;
        try { r = await api({ action: 'briefAdd', text: text, rid: state.bf.rid }); } catch (e) { r = { ok: false, message: '連不上伺服器，請按「再送一次確認」（不會變成兩份）' }; }
        if (r.ok) {
          state.data.briefs = r.briefs; state.bf = { text: '', rid: '', sentText: '' };
          // 只有確定寄出才說「已通知」；沒寄出、或重送時伺服器也不知道寄了沒，都照實說（R8-06）
          state.briefMsg = r.mailed === true ? '已送出，已通知總經理' : r.mailed === false ? '已送出（通知信沒寄出去，總經理打開主管網頁仍看得到）' : '已送出（匯報已存，通知狀態未確認；總經理打開主管網頁看得到）';
        } else if (r.code === 'RID_CONFLICT') {
          // 舊的那份其實已經送到（內容是修改前的）：解開，讓他決定要不要把修改後的另送一份
          if (r.briefs) state.data.briefs = r.briefs;
          state.bf = { text: text, rid: '', sentText: '' };
          state.briefMsg = '⚠ ' + r.message;
        } else {
          // 明確沒處理（忙碌、內容不對、還沒升級）：解開可以改；其他（斷線、伺服器出錯）可能已經存了：維持鎖住
          if (['BUSY', 'BAD_BRIEF', 'NOT_READY', 'BAD_LOGIN', 'NOT_ALLOWED'].indexOf(r.code) >= 0) state.bf = { text: text, rid: '', sentText: '' };
          state.briefMsg = '⚠ ' + (r.message || '沒有送出');
        }
        render();
      });
    }
    $('panel').querySelectorAll('details.brief').forEach(el => el.addEventListener('toggle', async () => {
      if (!el.open) { if (state.briefOpen === el.dataset.brief) state.briefOpen = ''; return; }
      // 重畫時本來就開著的那一份也會觸發 toggle：只有「這次才打開」才算看過
      if (state.briefOpen === el.dataset.brief) return;
      state.briefOpen = el.dataset.brief;
      if (el.dataset.unread !== '1' || !isGM()) return;
      el.dataset.unread = '0';
      let r;
      try { r = await api({ action: 'briefRead', id: el.dataset.brief }); } catch (e) { r = { ok: false }; }
      if (r.ok) { state.data.briefs = r.briefs; render(); }
      else el.dataset.unread = '1'; // 沒成功：改回未讀，收起再打開會再標一次（自行審查 S7）
    }));
    $('panel').querySelectorAll('[data-replyform]').forEach(f => {
      const id = f.dataset.replyform, ta = f.querySelector('textarea');
      ta.addEventListener('input', () => { (state.replyDraft || (state.replyDraft = {}))[id] = ta.value; });
      f.addEventListener('submit', async ev => {
        ev.preventDefault();
        if (!ta.value.trim()) { state.briefMsg = '請先寫回覆內容'; render(); return; }
        f.querySelector('button').disabled = true;
        let r;
        try { r = await api({ action: 'briefReply', id: id, text: ta.value.trim() }); } catch (e) { r = { ok: false, message: '連不上伺服器，請再試一次' }; }
        if (r.ok) { state.data.briefs = r.briefs; delete state.replyDraft[id]; state.briefMsg = '已回覆'; } else state.briefMsg = '⚠ ' + (r.message || '回覆失敗');
        render();
      });
    });
  }

  /* ───── 帳號：主管開業務帳號、重設業務密碼；總經理另外能開／重設主管帳號（2026-11-12） ───── */
  function renderAccounts() {
    const gm = isGM();
    const list = state.data.salesAccounts || [];
    const f = state.af || (state.af = { account: '', name: '', region: '', password: '', role: '業務' });
    // 業務、主管都只能用上面的人給的密碼（董事長 2026-11-12）：密碼是自己打的，這裡不再顯示密碼
    const pw = state.newPw; // { account, reset, disabled }
    const box = pw ? `<div class="pwbox" role="status"><b>${pw.reset ? '已重設密碼' : '已開通帳號'}</b>${pw.disabled ? '<br><span class="err">⚠ 這個帳號目前是停用的，要在試算表「帳號」分頁勾選「啟用」，本人才登入得了。</span>' : ''}
        <div>帳號：<code>${esc(pw.account)}</code></div>
        <p class="sub">密碼就是你剛剛打的那一組，請當面或私訊告訴本人。本人只能用這組密碼，不能自己改；要換密碼請在下面按「重設密碼」。</p>
        <button class="btn" type="button" id="pwDone">知道了</button></div>` : '';
    const roleSel = gm ? `<select id="aRole" aria-label="角色"><option value="業務"${f.role !== '主管' ? ' selected' : ''}>業務（用手機）</option><option value="主管"${f.role === '主管' ? ' selected' : ''}>主管（用主管網頁）</option></select>` : '';
    const form = `<h3>${gm ? '開通新帳號' : '開通新的業務帳號'}</h3><form class="taskform" id="acctForm" autocomplete="off">
        ${roleSel}
        <input id="aAcct" maxlength="30" placeholder="帳號（英文小寫或數字，例如 tom）" value="${esc(f.account)}" autocapitalize="none" spellcheck="false" aria-label="帳號">
        <input id="aName" maxlength="40" placeholder="姓名（顯示在拜訪紀錄上）" value="${esc(f.name)}" aria-label="姓名">
        <input id="aRegion" maxlength="40" placeholder="負責地區（可以留空）" value="${esc(f.region)}" aria-label="負責地區">
        <input id="aPw" maxlength="64" placeholder="密碼（6 個字以上，由你給他）" value="${esc(f.password)}" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="密碼">
        <button class="btn" type="submit" id="aAdd">${gm ? '開通帳號' : '開通業務帳號'}</button>
        <span class="sub" id="aMsg" aria-live="polite">${esc(state.acctMsg || '')}</span></form>
        <p class="sub">${gm ? '總經理帳號請在試算表「農業CRM → 開帳號／重設密碼」開。' : '主管帳號由總經理開。'}</p>`;
    const rows = list.map(a => `<li><b>${esc(a.name)}</b>${a.role === '主管' ? ' <span class="pill p-yel">主管</span>' : ''}<span class="sub">${esc(a.account)}${a.region ? '｜' + esc(a.region) : ''}</span>
        ${a.active ? '' : '<span class="pill">停用</span>'}
        <span class="sub">${a.lastLogin ? '最後登入 ' + esc(String(a.lastLogin).slice(5, 16)) : '還沒登入過'}</span>
        <button class="btn" type="button" data-acctreset="${esc(a.account)}" data-name="${esc(a.name)}">重設密碼</button></li>`).join('');
    return box + form + `<h3>${gm ? '業務、主管帳號' : '業務帳號'}（${list.length}）</h3><ul class="acctlist">${rows || '<li class="empty">還沒有帳號</li>'}</ul>`;
  }
  function bindAccounts() {
    const done = $('pwDone');
    if (done) done.addEventListener('click', () => { state.newPw = null; render(); });
    const form = $('acctForm');
    const keep = () => { state.af = { account: $('aAcct').value, name: $('aName').value, region: $('aRegion').value, password: $('aPw').value, role: $('aRole') ? $('aRole').value : '業務' }; };
    ['aAcct', 'aName', 'aRegion', 'aPw', 'aRole'].forEach(id => { if ($(id)) $(id).addEventListener('input', keep); });
    const after = r => {
      if (r.ok) {
        state.newPw = { account: r.account, reset: r.reset, disabled: !!r.disabled };
        state.data.salesAccounts = r.accounts;
        state.acctMsg = '';
        load(); // 重新讀一次：任務的派給誰選單也會出現新帳號
      } else state.acctMsg = '⚠ ' + (r.message || '沒有完成');
      render();
    };
    form.addEventListener('submit', async ev => {
      ev.preventDefault(); keep();
      const a = state.af.account.trim().toLowerCase();
      if (!/^[a-z0-9._-]{2,30}$/.test(a)) { $('aMsg').textContent = '帳號只能用英文小寫、數字、點、底線、減號，2～30 字'; return; }
      if (!state.af.name.trim()) { $('aMsg').textContent = '請填姓名'; return; }
      if (state.af.password.length < 6) { $('aMsg').textContent = '請幫他設定密碼（6 個字以上）'; return; }
      $('aAdd').disabled = true; $('aMsg').textContent = '開通中…';
      let r;
      try { r = await api({ action: 'accountAdd', account: a, name: state.af.name.trim(), region: state.af.region.trim(), password: state.af.password, role: state.af.role }); } catch (e) { r = { ok: false, message: '連不上伺服器，請再試一次' }; }
      if (r.ok) state.af = { account: '', name: '', region: '', password: '', role: '業務' }; // 開好就把密碼從畫面清掉
      after(r);
    });
    $('panel').querySelectorAll('[data-acctreset]').forEach(b => b.addEventListener('click', async () => {
      const np = prompt('幫「' + b.dataset.name + '」設定新密碼（6 個字以上）。\n他已登入的手機或電腦會全部登出，要用這組新密碼重新登入。');
      if (np === null) return;
      if (np.length < 6) { state.acctMsg = '⚠ 新密碼要 6 個字以上'; render(); return; }
      b.disabled = true;
      let r;
      try { r = await api({ action: 'accountReset', account: b.dataset.acctreset, password: np }); } catch (e) { r = { ok: false, message: '連不上伺服器' }; }
      after(r);
    }));
  }

  /** 讀某個月的工作進度：「工作進度明細」看選的月份，「總覽」業務卡片看本月；讀到了，正在看的那頁才重畫 */
  async function loadProgress(m) {
    if (!m || state.prog[m] || state.progReq[m]) return;
    state.progReq[m] = true;
    let r;
    try { r = await api({ action: 'progress', month: m }); } catch (e) { r = { ok: false, message: '連不上伺服器' }; } finally { delete state.progReq[m]; }
    state.prog[m] = r;
    if ((state.tab === 'progress' && state.pm === m) || (state.tab === 'today' && monthsBack(1)[0] === m)) render();
  }

  function renderTable() {
    const rows = state.data.visits.slice().sort((a, b) => b.time.localeCompare(a.time));
    return `<div class="tbl"><table><thead><tr><th>拜訪時間</th><th>客戶</th><th>業務</th><th>作物狀況</th><th>問題</th><th>下一步</th><th>狀態</th></tr></thead><tbody>
      ${rows.map(v => `<tr><td>${esc(v.time)}</td><td><a href="javascript:void 0" data-go="${esc(v.cid)}">${esc(v.name)}</a></td><td>${esc(v.staff)}</td><td>${esc(v.crop || v.summary || '—')}</td><td>${esc(v.issue || '—')}</td><td>${esc(v.next || '—')}</td><td>${esc(v.status)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">還沒有拜訪紀錄</td></tr>'}
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
  $('logout').addEventListener('click', logout);
  $('loginForm').addEventListener('submit', onLogin);
  biDom(document.body); // 登入頁、標題列、分頁名稱補緬文
  renderMirrors();
  state.key = keyStore.get();
  if (state.key) load(); else showLogin();
  window.__bossTest = { state, render, load, logout }; // 本機測試用
})();
