/* 打卡網頁主程式（第 2 期 2A）：帳號密碼登入 → 首頁四類工作 → 拜訪（客戶資料、照片、相簿、錄音、打字、價格） */
/* global FarmCore, FARM_CONFIG */
(function () {
  const { Store, runSync, post, rememberServer, pruneLocalCustomers, updateTaskDone } = FarmCore;
  const $ = id => document.getElementById(id);
  /* 0.4.42 第6任線上實測：手機有時拿到舊版頁面＋新版程式（快取混版），新加的元件找不到就整個畫面空白。
     新元件一律用 $n：找不到就給一個不顯示的假元件，舊頁面照樣能用（重新整理後就是新版） */
  const NO_EL = () => ({ hidden: true, value: '', innerHTML: '', textContent: '', dataset: {}, selectedIndex: 0, options: [], addEventListener() {}, scrollIntoView() {}, setAttribute() {} });
  const $n = id => document.getElementById(id) || NO_EL();
  /* 0.4.48 董事長：「客戶資料在這邊應該不用顯示，建檔的時候就要有了」→ 拜訪舊客戶時先不顯示作物／品種／代碼與客戶資料（暫時拿掉，改回 true 就恢復）；新增客戶照常填 */
  const SHOW_PROFILE_ON_VISIT = false;
  /* 0.4.50 董事長：品種拿掉（暫時藏起來，改回 true 就恢復）。藏起來時「品種」欄存選的種子公司；舊客戶原本的完整品種不會被蓋掉 */
  const SHOW_VARIETY = false;
  /** 要存的品種：品種選單藏起來時，沒換公司就保留原本的（品種開頭是公司名），換了公司就記公司名 */
  const varietyValue = () => {
    const v = $('pVariety').value.trim(), co = $('pVarCo').value.trim();
    if (SHOW_VARIETY || !co) return v;
    return v && (v === co || v.indexOf(co + ' ') === 0) ? v : co;
  };
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAX_REC_SEC = 90;
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
  const MAX_PHOTOS = 6; // 跟後台一樣
  const CAT_TYPES = { 試作: ['農民'], 推廣: ['農民'], 農戶: ['農民'], 結案: ['農民'], 盤商: ['盤商'], 種子商: ['種子商'] }; // 盤商、種子商分開（2026-11-11 董事長）
  const CAT_LABEL = c => (c === '農戶' ? '一般拜訪' : c); // 「農戶」是舊資料的值，畫面上叫「一般拜訪」
  // 業務畫面一律中文＋緬文（2026-11-12 董事長；緬文是示意，待校對）
  const CAT_MY = { 農戶: 'ပုံမှန်သွားရောက်', 試作: 'စမ်းသပ်စိုက်ပျိုး', 推廣: 'မြှင့်တင်ရောင်းချ', 盤商: 'ကုန်သည်', 種子商: 'မျိုးစေ့ဆိုင်', 農民: 'လယ်သမား', 結案: 'ပိတ်သိမ်း' };
  const catBi = c => CAT_LABEL(c) + (CAT_MY[c] ? '／' + CAT_MY[c] : '');

  const state = {
    view: '', cat: '試作', photos: [], audio: null, audioSec: 0, rec: null, recTimer: null, gps: null,
    farmers: [], options: null, original: null, mustChange: false,
    homeMonth: '', // 首頁工作進度目前看哪個月
    monthOpen: '', // 0.4.82 本月成績展開哪一格明細：'' / 'new' / 'trial'
    harvestOpen: false, // 0.4.82 快採收提醒條展開了沒
    formGen: 0, // 每清一次表單就加一；非同步處理完的錄音、照片，世代不同就丟掉
    busyPhotos: 0 // 還在處理的照片張數；大於 0 時不能儲存，免得後面幾張被丟掉（2026-11-11 抓到）
  };

  async function getConfig() { return (await Store.getMeta('config')) || null; }

  function show(view) {
    state.view = view;
    ['setup', 'home', 'visit'].forEach(v => { $(v).hidden = v !== view; });
    $('logoutBtn').hidden = view === 'setup';
    window.scrollTo(0, 0);
  }

  /* ───── 登入：帳號＋密碼。第一次登入要改成自己的密碼 ───── */
  function showLogin(msg) {
    // 2號 0.4.69 清單低3（第8任）：換帳號後「我的報告」還用上一位的名字篩 → 回到登入畫面就清掉報告清單、範圍、我是誰
    state.me = ''; state.reportScope = 'all'; state.reports = null;
    show('setup');
    $('setupMsg').textContent = msg || '只要登入一次，之後沒網路也能打卡。帳號和密碼請向主管索取（密碼不能自己改）。／တစ်ကြိမ် ဝင်ပြီးလျှင် အင်တာနက်မရှိလည်း မှတ်တမ်းတင်နိုင်သည်။ အကောင့်နှင့် စကားဝှက်ကို မန်နေဂျာထံ တောင်းပါ။';
    $('setupMsg').className = msg ? 'sub err' : 'sub';
  }

  async function onLogin(ev) {
    ev.preventDefault();
    const msg = $('setupMsg');
    const account = $('acct').value.trim(), password = $('pw').value;
    const payload = { action: 'login', account, password, deviceId: deviceId() };
    if (state.mustChange) {
      const np = $('newPw').value, np2 = $('newPw2').value;
      if (np.length < 6) { msg.textContent = '新密碼至少 6 個字／စကားဝှက်အသစ် အနည်းဆုံး ၆ လုံး'; msg.className = 'sub err'; return; }
      if (np !== np2) { msg.textContent = '兩次輸入的新密碼不一樣／စကားဝှက်နှစ်ခု မတူပါ'; msg.className = 'sub err'; return; }
      payload.newPassword = np;
    }
    // 業務BUG#8：後台比對帳號會去掉所有空白（0.4.39，打「Myint Ko Ko」也能登入 myintkoko），這裡要用同一套，不然被當成別人擋下
    const acctKey = account.toLowerCase().replace(/\s+/g, '');
    const others = (await Store.allVisits()).filter(v => v.status === 'pending' && v.account && v.account !== acctKey);
    // 前一個人還沒送出的任務打勾也要擋：換人後那些打勾永遠送不出去，新的人也登出不了（自行審查 S1）
    const otherTicks = ((await Store.getMeta('taskDone')) || []).filter(t => t.account && t.account !== acctKey);
    if (!others.length && otherTicks.length) {
      msg.textContent = `這支手機還有 ${otherTicks.length} 個「${otherTicks[0].account}」的任務打勾沒上傳，請先用 ${otherTicks[0].account} 登入，等它傳完再換人。`;
      msg.className = 'sub err'; return;
    }
    if (others.length) {
      // 換人登入同一支手機：前一個人的資料會被記到新帳號名下，所以先擋（2026-11-11 審查發現）
      msg.textContent = `這支手機還有 ${others.length} 筆「${others[0].account}」沒上傳的資料，請先用 ${others[0].account} 登入，等資料傳完再換人。`;
      msg.className = 'sub err'; return;
    }
    msg.textContent = '確認中… စစ်ဆေးနေသည်'; msg.className = 'sub';
    $('loginBtn').disabled = true;
    try {
      const sentAt = Date.now();
      const data = await post(FARM_CONFIG.gasUrl, payload);
      if (data.code === 'MUST_CHANGE') {
        state.mustChange = true; $('newPwBox').hidden = false; $('newPw').focus();
        msg.textContent = data.message; return;
      }
      if (!data.ok) { msg.textContent = data.message || '登入失敗'; msg.className = 'sub err'; return; }
      await rememberServer(data, sentAt);
      await Store.setMeta('config', { gasUrl: FARM_CONFIG.gasUrl, deviceKey: data.deviceKey, name: data.name, account: data.account, role: data.role });
      // 第 1 期留下、沒有標帳號的待傳資料：歸給這支手機升級後第一個登入的人並標上帳號，
      // 之後換別人登入會被擋，不會記到別人名下（2026-11-11 GPT-6.1 審查 G03）
      for (const v of await Store.allVisits()) if (v.status === 'pending' && !v.account) { v.account = data.account; await Store.putVisit(v); }
      ['pw', 'newPw', 'newPw2'].forEach(id => { $(id).value = ''; }); // 密碼不留在畫面上
      state.mustChange = false; $('newPwBox').hidden = true;
      showHome();
      syncNow();
    } catch (err) {
      msg.textContent = '連不上伺服器，第一次登入需要網路／ဆာဗာနှင့် မချိတ်နိုင်ပါ၊ ပထမအကြိမ် ဝင်ရန် အင်တာနက်လိုသည်'; msg.className = 'sub err';
    } finally {
      $('loginBtn').disabled = false;
    }
  }

  /** 這支手機目前登入的人自己的任務打勾（沒標帳號的舊資料也算他的，跟 core.js 的 mine 同一個規則） */
  async function mineTicks() {
    const cfg = (await Store.getMeta('config')) || {};
    return ((await Store.getMeta('taskDone')) || []).filter(t => !t.account || !cfg.account || t.account === cfg.account);
  }

  async function logout() {
    // 0.4.87 中6：比照返回鍵——打卡畫面還沒儲存要先確認；錄音中先停掉、表單清掉（不讓錄音器開著跑到登入頁）
    if (state.view === 'visit' && formDirty() && !confirm('還沒儲存，確定要登出嗎？剛剛填的資料（照片、錄音、打字等）會不見。\nမသိမ်းရသေးပါ။ ထွက်လျှင် ပျောက်မည်။')) return;
    if (state.view === 'visit' || state.rec) resetForm();
    const pending = (await Store.allVisits()).filter(v => v.status === 'pending').length;
    // 任務打勾也要先送出（GPT-6.1 R4-07）；只算自己帳號的：別人的（舊版換人留下的）在這支手機用自己帳號永遠送不掉，不能因此擋住登出（自行審查 S1）
    const ticks = (await mineTicks()).length;
    if (pending || ticks) { toast(`還有 ${[pending ? pending + ' 筆拜訪' : '', ticks ? ticks + ' 個任務打勾' : ''].filter(Boolean).join('、')}沒上傳，先連上網路等它傳完再登出／မတင်ရသေးသော မှတ်တမ်းရှိသည်၊ အင်တာနက်ချိတ်ပြီး တင်ပြီးမှ ထွက်ပါ`); return; }
    if (!confirm('確定要登出嗎？之後要再輸入帳號密碼。\nထွက်မှာ သေချာပါသလား။ နောက်တစ်ကြိမ် အကောင့်နှင့် စကားဝှက် ပြန်ထည့်ရမည်။')) return;
    // 0.4.75 董事長「右上角登出，而且實際上也要登出」：先請後台停用這支手機的裝置金鑰（最多等 5 秒；沒網路、逾時、舊後台不認得、出錯都照樣登出）
    const lb = $n('logoutBtn'), lbl = lb.innerHTML; lb.disabled = true; lb.textContent = '登出中…／ထွက်နေသည်'; // 0.4.80 低1：等後台時不讓重按
    try { await Promise.race([gasCall({ action: 'logout' }), new Promise(r => setTimeout(r, 5000))]); } catch (e) { /* 照樣清本機、回登入頁 */ } finally { lb.disabled = false; lb.innerHTML = lbl; }
    await Store.setMeta('config', null);
    showLogin();
  }

  /* ───── 首頁 ───── */
  async function showHome() {
    if (await loginLostCheck()) return; // 0.4.87 中6：打卡時登入失效、先保留表單 → 回首頁這時才跳登入
    show('home');
    state.closeGroup = ''; // 0.4.73 回首頁就不再是「某一種農民結案」
    const cfg = await getConfig();
    $('who').textContent = cfg ? (cfg.name || cfg.account || '') : '';
    await renderHome();
    renderQueue();
  }

  /* 備用網址（0.4.29）：緬甸網路常擋某些主機，同一份網頁放在不同公司的主機上，後台、資料都一樣。
     部署設定可以用 FARM_CONFIG.mirrors 換掉這份清單（客戶正式上線換成自己的網址） */
  const MIRRORS = [
    { url: 'https://ppo2009.github.io/farm-visit-test-1028/', name: 'GitHub' },
    { url: 'https://farmvisit-mm1028.farmvisit-mm1028.workers.dev/', name: 'Cloudflare' },
    { url: 'https://farm-visit-test-1028.web.app/', name: 'Firebase' }
  ];
  function renderMirrors() {
    const list = (typeof FARM_CONFIG !== 'undefined' && Array.isArray(FARM_CONFIG.mirrors)) ? FARM_CONFIG.mirrors : MIRRORS;
    $('mirrors').hidden = !list.length; // 設定留空＝不顯示
    const here = location.origin + location.pathname.replace(/[^/]*$/, '');
    $('mirrorList').innerHTML = list.map((m, i) => `<li><a href="${esc(m.url)}">${esc(m.url)}</a>${m.url === here ? '<span class="pill ok">現在用的 ယခု</span>' : ''}<button type="button" class="btn2 small" data-copyurl="${i}">複製 ကူးယူ</button></li>`).join('');
    $('mirrorList').querySelectorAll('[data-copyurl]').forEach(b => b.addEventListener('click', async () => {
      const url = list[Number(b.dataset.copyurl)].url;
      try { await navigator.clipboard.writeText(url); toast('已複製網址／ကူးယူပြီး'); } catch (e) { toast(url); } // 不能複製時直接顯示網址，讓他自己抄
    }));
  }

  /* 首頁分頁（0.4.26）：記住上次看的分頁（只存在這支手機；存不了就每次從田間打卡開始） */
  const HOME_TABS = ['punch', 'todo', 'mine', 'close', 'plant']; // 0.4.60 結案獨立一個分頁 // 0.4.59 指派任務併進執行任務清單；第四格改種植資料（舊的「assigned」改開執行任務清單）
  function setHomeTab(tab) {
    if (tab === 'assigned') tab = 'todo'; // 0.4.59 舊的指派任務分頁已併進執行任務清單
    if (HOME_TABS.indexOf(tab) < 0) tab = 'punch';
    // 2號 0.4.63 低#11：舊快取的頁面沒有這一頁（例如 0.4.59 前沒有「結案」）→ 全部分頁都藏起來、首頁空白；頁面上沒有就回田間打卡
    if (typeof document !== 'undefined' && document.getElementById && !document.getElementById('hp-' + tab)) tab = 'punch';
    state.homeTab = tab;
    HOME_TABS.forEach(t => {
      const b = $('htab-' + t), p = $('hp-' + t);
      if (b) b.setAttribute('aria-selected', String(t === tab));
      if (p) p.hidden = t !== tab;
    });
    try { localStorage.setItem('farm-home-tab', tab); } catch (e) { /* 存不了 */ }
    renderPlantHistory(); // 0.4.77 種植資料的完整紀錄：只有在這一頁才讀、離開就收起（換掉讀取記號，晚到的結果不會再打開）
  }
  function initHomeTabs() {
    let saved = '';
    try { saved = localStorage.getItem('farm-home-tab') || ''; } catch (e) { /* 讀不了 */ }
    document.querySelectorAll('[data-htab]').forEach(b => b.addEventListener('click', () => { setHomeTab(b.dataset.htab); window.scrollTo(0, 0); }));
    setHomeTab(saved);
  }

  // 0.4.75 董事長「我的進度要改：一般農民、試作農民、推廣農民、種子商、盤商，都要有下拉選單」：五顆切換，每一類一個看得見的下拉選單
  const MINE_TYPES = { 一般農民: 'ပုံမှန် လယ်သမား', 試作農民: 'စမ်းသပ် လယ်သမား', 推廣農民: 'မြှင့်တင် လယ်သမား', 種子商: 'မျိုးစေ့ဆိုင်', 盤商: 'ကုန်သည်' };
  const FARMER_GROUPS = ['一般農民', '試作農民', '推廣農民']; // 0.4.73 結案分頁三顆
  /* 0.4.75 董事長「主管訂的目標進度，農民 150 天做成一個進度 100%」：從種植日期算起，150 天＝100%（全專案只有這裡定天數） */
  const GROW_DAYS = 150;
  /** 種植進度：沒填（或格式不對）回 null；日期在未來＝0%；超過 150 天顯示 100%、full＝true。today、plantDate 都是 YYYY-MM-DD（緬甸日期） */
  function growOf(plantDate, today) {
    const pd = String(plantDate || '').slice(0, 10);
    if (!/^\d{4}-\d\d-\d\d$/.test(pd) || !/^\d{4}-\d\d-\d\d$/.test(String(today || ''))) return null;
    const days = Math.round((Date.parse(today) - Date.parse(pd)) / 86400000);
    if (!isFinite(days)) return null;
    if (days < 0) return { days: 0, pct: 0, future: true, full: false };
    return { days, pct: Math.min(100, Math.round(days / GROW_DAYS * 100)), future: false, full: days >= GROW_DAYS };
  }
  // 0.4.82 董事長「百分比改天數」：畫面只寫天數（pct 只拿來畫進度條）；未來＝還沒到種植日期、超過＝已滿 150 天、沒填＝未填種植日期
  const growLabel = g => (!g ? '未填種植日期' : g.future ? '還沒到種植日期' : g.full ? `已滿 ${GROW_DAYS} 天` : `第 ${g.days} 天／${GROW_DAYS} 天`);
  function growHtml(g) { // 進度條＋第 N 天／150 天（跟「主管訂的目標」同一種進度條）
    if (!g) return '<p class="sub">未填種植日期，算不出種植進度（到「種植資料」分頁補填）／စိုက်ပျိုးသည့်ရက် မဖြည့်ရသေး</p>';
    return `<div class="grow"><span class="lab">種植進度 စိုက်ပျိုးမှု တိုးတက်မှု：${g.future ? '<b>還沒到種植日期</b>／မစိုက်ရသေး' : `<b>第 ${g.days} 天／${GROW_DAYS} 天</b> <span class="my">ရက် ${g.days}／${GROW_DAYS}</span>`}${g.full ? `（已滿 ${GROW_DAYS} 天 <span class="my">ပြည့်</span>）` : ''}</span>`
      + `<span class="bar"><i style="width:${g.pct}%"></i></span></div>`;
  }
  /* 0.4.82 董事長「業務端客戶多久沒回訪要上色」：距最後拜訪日 10 天以上紅、5～9 天黃、0～4 天綠；從沒拜訪過＝紅「還沒拜訪」。
     天數用緬甸日期（mmDay）；顏色之外一定有文字（久未回訪／快該回訪／最近有去），不能只靠顏色 */
  const AGE_WORD = { r: '久未回訪', y: '快該回訪', g: '最近有去' };
  function visitAge(lastVisit, today) {
    const a = String(lastVisit || '').slice(0, 10), t = String(today || '').slice(0, 10);
    const d = /^\d{4}-\d\d-\d\d$/.test(a) && /^\d{4}-\d\d-\d\d$/.test(t) ? Math.round((Date.parse(t) - Date.parse(a)) / 86400000) : NaN;
    if (!isFinite(d)) return { days: null, lv: 'r', text: '還沒拜訪／မသွားရသေး' };
    const n = Math.max(0, d), lv = n >= 10 ? 'r' : n >= 5 ? 'y' : 'g'; // 手機時間比後台慢、最後拜訪日看起來在明天：當 0 天
    return { days: n, lv, text: `距上次拜訪 ${n} 天・${AGE_WORD[lv]}／ရက် ${n}` };
  }
  /** 0.4.84（BUG清單_0.4.83 低1）：最後拜訪日＝後台 lastVisit 跟這支手機自己帳號的拜訪（myVisits，用緬甸日期 mmDay）取比較新的那天。
      有打字、錄音的拜訪，後台要等背景翻譯（最多約 10 分鐘）才更新 lastVisit；這段時間只看後台會還是紅字 */
  function latestVisitDay(serverDay, cid, mine) {
    const own = (mine || []).filter(v => v && v.farmerId === cid && Number(v.deviceTime) > 0).map(v => mmDay(0, Number(v.deviceTime)));
    return [String(serverDay || '').slice(0, 10)].concat(own).filter(d => /^\d{4}-\d\d-\d\d$/.test(d)).sort().pop() || '';
  }
  const visitAgeHtml = (lastVisit, today) => { const a = visitAge(lastVisit, today); return `<span class="vage ${a.lv}">${esc(a.text)}</span>`; };
  /** 農民分三類，跟結案 group 同一套（closeTrialGroup）：有進行中試作＝試作農民、推廣＝推廣農民、都沒有＝一般農民；盤商、種子商照類型 */
  async function mineGroupOf(f) {
    const type = f.type || '農民';
    if (type !== '農民') return type;
    for (const cat of ['試作', '推廣']) { const t = await activeTrialFor(f.id, cat); if (t) return closeTrialGroup({ cat, t }); }
    return closeTrialGroup(null);
  }
  /** 0.4.57／0.4.73／0.4.75 「我的進度」：自己負責的客戶（不看別人的），五類各幾位、選一類出現下拉、選一位展開進度卡＋過往紀錄；另列農民種植進度 */
  async function fillCloseFarmers() {
    const sel = document.getElementById('closeFarmer');
    if (!sel) return; // 舊頁面沒有這個選單
    const server = (await Store.getMeta('farmers')) || [], local = (await Store.getMeta('localCustomers')) || [];
    const me = String(((await getConfig()) || {}).name || '');
    // state.closeList 照舊只放農民（種植資料分頁用）；state.mineAll 是全部自己負責的
    const allMine = server.concat(local.filter(l => !server.some(f => f.id === l.id)))
      .filter(f => f.pending || String(f.staff || '') === me);
    state.mineAll = allMine;
    state.closeList = allMine.filter(f => (f.type || '農民') === '農民');
    state.endedMine = ((await Store.getMeta('endedMine')) || []).filter(f => (f.type || '農民') === '農民' && !state.closeList.some(x => x.id === f.id)); // 0.4.80 中3
    const today = mmDay(0); // 業務BUG#4：緬甸的今天（0.4.75 種植進度也用這個日期算）
    const groupOf = {}, growOfId = {};
    for (const f of allMine) { groupOf[f.id] = await mineGroupOf(f); if ((f.type || '農民') === '農民') growOfId[f.id] = growOf(f.plantDate, today); }
    const mtype = MINE_TYPES[state.mineType] ? state.mineType : '一般農民';
    const list = allMine.filter(f => groupOf[f.id] === mtype);
    const cnt = t => allMine.filter(f => groupOf[f.id] === t).length;
    [['msGen', '一般農民'], ['msTrial', '試作農民'], ['msPromo', '推廣農民'], ['msSeeds', '種子商'], ['msDealers', '盤商']].forEach(([id, t]) => { $n(id).textContent = String(cnt(t)); });
    if (typeof document.querySelectorAll === 'function') document.querySelectorAll('#mineType [data-mtype]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mtype === mtype)));
    const isFarmer = FARMER_GROUPS.indexOf(mtype) >= 0;
    const keep = sel.value;
    sel.innerHTML = `<option value="">— 選一位${mtype} ${MINE_TYPES[mtype]} ရွေးပါ —</option>` + list.map(f => `<option value="${esc(f.id)}">${esc(f.name)}${f.area ? '｜' + esc(String(f.area).trim() /* 0.4.89 地區完整顯示（業務－地區），不切字 */) : ''}${isFarmer ? '｜' + esc(growLabel(growOfId[f.id])) : ''}｜${esc(visitAge(latestVisitDay(f.lastVisit, f.id, state.myVisitList), today).text.split('／')[0])}${f.pending ? '（新，未上傳 မတင်ရသေး）' : ''}</option>`).join(''); // 0.4.82 選項加「距上次拜訪 N 天」（選項不能上色，靠文字）
    sel.value = keep && list.some(f => f.id === keep) ? keep : '';
    sel.disabled = !list.length;
    state.mineGrow = growOfId;
    state.mineGroupOf = groupOf; // 0.4.82 執行任務清單左欄用同一套分類
    // 0.4.82 沒選人：修改種植資料的表單也收起（state.plEditCid、plForm）
    if (!sel.value) { state.plEditCid = ''; $n('plForm').hidden = true; const b = $n('closeProgress'); b.hidden = true; b.innerHTML = ''; const hb = $n('closeHistory'); hb.hidden = true; hb.innerHTML = ''; hb._tok = null; const gb = $n('closeGrow'); gb.hidden = true; gb.innerHTML = ''; }
    $n('closeFarmerCount').textContent = list.length ? `共 ${list.length} 位${mtype}，從下拉選一位看進度和過往拜訪紀錄（照片、錄音）／${list.length} ဦး၊ ရွေးပြီး ကြည့်ပါ`
      : `還沒有自己負責的${mtype}／${MINE_TYPES[mtype]} မရှိသေး`;
    // 「主管訂的目標」底下：農民種植進度（三類都列，百分比由高到低；沒填種植日期排最後）
    const gl = document.getElementById('growList');
    if (gl) {
      const dayKey = g => (!g ? -2 : g.future ? -1 : g.days); // 0.4.82 照天數排：天數多的在前，還沒到種植日期其次，沒填最後
      const farmers = state.closeList.slice().sort((a, b) => dayKey(growOfId[b.id]) - dayKey(growOfId[a.id]));
      gl.innerHTML = farmers.map(f => { const g = growOfId[f.id];
        return `<li class="plan"><span>${esc(f.name)}<br><small>${esc(groupOf[f.id])}・${g ? (g.future ? '還沒到種植日期／မစိုက်ရသေး' : `第 ${g.days} 天／${GROW_DAYS} 天（ရက် ${g.days}）`) : '未填種植日期／ရက် မဖြည့်ရ'}</small><span class="bar"><i style="width:${g ? g.pct : 0}%"></i></span></span>`
          + `${!g ? '<span class="pill wait">未填 မဖြည့်ရ</span>' : g.full ? `<span class="pill ok">已滿 ${GROW_DAYS} 天 ပြည့်</span>` : g.future ? '<span class="pill wait">還沒到種植日期</span>' : `<span class="pill wait">第 ${g.days} 天</span>`}</li>`; }).join('')
        || '<li class="empty">還沒有自己負責的農民／လယ်သမား မရှိသေး</li>';
    }
  }
  /* ───── 0.4.59 首頁「種植資料」分頁：選自己負責的農民，改種植資料直接存（不算拜訪） ───── */
  /** 0.4.80 中3：種植資料選單的人＝自己負責、已結案的（ended 標記）
      0.4.82 董事長「要先結案、等主管審核過才會產出種植資料」（選「名單只列審核過的；修改搬走」）：只列 endedMine（主管審核過才會變已結束；沒開審核直接結案的也算），還在種的不列 */
  const plantPool = () => (state.endedMine || []).map(f => Object.assign({}, f, { ended: true }));
  function fillPlantFarmers() {
    const sel = document.getElementById('plFarmer');
    if (!sel) return; // 舊頁面沒有這個分頁
    const ended = state.endedMine || [];
    const keep = sel.value;
    const opt = f => `<option value="${esc(f.id)}">${esc(f.name)}${f.area ? '｜' + esc(String(f.area).trim() /* 0.4.89 地區完整顯示（業務－地區），不切字 */) : ''}</option>`;
    sel.innerHTML = (ended.length ? '<option value="">— 請選擇 ရွေးပါ —</option>' : '<option value="">還沒有審核通過的結案農民／အတည်ပြုပြီး ပိတ်သိမ်းထားသော လယ်သမား မရှိသေး</option>') + ended.map(opt).join(''); // 全部都是已結案：不再分組
    sel.disabled = !ended.length;
    sel.value = keep && ended.some(f => f.id === keep) ? keep : '';
    if (!sel.value) { $n('plCard').hidden = true; $n('plBtns').hidden = true; renderPlantHistory(); }
  }
  /** 0.4.61 董事長「選擇農民後下面的資料應該是自動載入，不是要填寫的」：唯讀卡片（沒填的寫「未填」） */
  function plantCardHtml(f, o) {
    const v = String(f.variety || ''), cos = o.seedCompanies || [];
    const co = cos.find(c => v === c || v.indexOf(c + ' ') === 0) || v;
    const u = o.areaUnit || '英畝', blank = '<span class="sub">未填 မဖြည့်ရသေး</span>';
    const val = x => (x === '' || x == null ? blank : esc(String(x)));
    const rows = [['種子公司', co], ['作物', f.crop ? cropText(f.crop) : ''], ['代碼', f.varCode], ['種植日期', f.plantDate],
      ['目前種植面積', f.areaNow === '' || f.areaNow == null ? '' : `${f.areaNow} ${u}`], ['可種植面積', f.areaMax === '' || f.areaMax == null ? '' : `${f.areaMax} ${u}`], ['其他', f.fertilizer]];
    return `<h3>目前種植資料／လက်ရှိ အချက်အလက်<span class="who"><b>${esc(f.name)}</b></span></h3><ul>${rows.map(([k, x]) => `<li>${k}：${val(x)}</li>`).join('')}</ul>`;
  }
  function setPlantEditing(on) {
    $n('plForm').hidden = !on; $n('plCard').hidden = on; $n('plBtns').hidden = on; // 0.4.77 修改時 Word、修改兩顆按鈕一起藏
  }
  /* ───── 0.4.77 董事長「目前種植資料要有從頭到尾紀錄的文字、圖片」「修改種植資料改為生成 WORD 檔」 ───── */
  /** 種植資料的完整紀錄：在這一頁、選了農民才讀（由舊到新，只有這一頁這樣排）；其他情況收起 */
  function renderPlantHistory(force) {
    const sel = $('plFarmer'), cid = sel ? sel.value : '';
    const el = $('plHistory') || $n('plHistory'); // 舊頁面沒有這一塊：給不顯示的假元件
    if (!cid) { el.hidden = true; el.innerHTML = ''; el._tok = null; el._doneCid = null; return; }
    if (state.homeTab !== 'plant') { el.hidden = true; el._tok = null; return; } // 0.4.80 低5：離開分頁只藏起來（還在讀的取消，讀完的留著）
    if (!force && el._doneCid === cid && el.innerHTML) { el.hidden = false; return; } // 同一位已經讀完：直接顯示，不重新下載
    el._doneCid = null;
    const p = renderHistory(cid, el, { list: plantPool(), current: () => !!sel && sel.value === cid && state.homeTab === 'plant', showTrials: true, oldFirst: true, closeFirst: true, timeline: true }); // 0.4.77 最上面放結案
    if (p && p.then) p.then(() => { if (sel.value === cid && state.homeTab === 'plant' && !el.hidden && el.innerHTML && el._tok) el._doneCid = cid; });
  }
  /** 產生 Word 檔失敗時給業務看的話（沒網路、逾時、舊後台、後台說的原因） */
  const farmerReportErr = r => (r && r.offline ? '產生 Word 檔要有網路，請連上網路再按一次／အင်တာနက် လိုသည်'
    : r && r.timeout ? 'Word 檔產生太久（照片多或網路慢），請稍後再按一次／ကြာနေသည်၊ ထပ်နှိပ်ပါ'
    : r && r.code === 'BAD_ACTION' ? '後台還沒更新，暫時不能產生 Word 檔，請告訴主管／နောက်မှ ထပ်ကြိုးစားပါ'
    : (r && r.message) || '產生失敗，請再按一次／မအောင်မြင်၊ ထပ်နှိပ်ပါ');
  /** 按「產生 Word 檔」：後台 farmerReport 做好（種植資料＋全部拜訪＋照片）傳回來，手機下載成 .docx */
  async function downloadFarmerReport(btn) { // 0.4.82 表單搬走後，種植資料頁的提示字改用 plWordHint
    const cid = $n('plFarmer').value;
    if (!cid || btn.disabled) return;
    const label = btn.innerHTML;
    btn.disabled = true; btn.textContent = '產生中…照片多時要 1～2 分鐘／ထုတ်နေသည်၊ ၁～၂ မိနစ် ကြာနိုင်'; $n('plWordHint').textContent = ''; // 0.4.80 中2
    try {
      const r = await gasCall({ action: 'farmerReport', cid });
      if (!r || !r.ok || !r.data) { const m = farmerReportErr(r); toast(m); $n('plWordHint').textContent = m; return; }
      const bytes = Uint8Array.from(atob(r.data), ch => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: r.mime || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      const a = document.createElement('a'); a.href = url; a.download = r.name || ('種植紀錄_' + cid + '.docx'); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      $n('plWordHint').textContent = 'Word 檔已下載／ဒေါင်းပြီး';
    } catch (e) { const m = farmerReportErr(null); toast(m); $n('plWordHint').textContent = m; } finally { btn.disabled = false; btn.innerHTML = label; }
  }
  /** 選了農民（0.4.82 起只有審核過的已結案農民）：顯示目前種植資料（唯讀）＋完整紀錄＋產生 Word；不能修改 */
  async function onPlantFarmer() {
    const cid = $n('plFarmer').value, f = plantPool().find(x => x.id === cid);
    $n('plWordHint').textContent = '';
    if (!f) { $n('plCard').hidden = true; $n('plBtns').hidden = true; renderPlantHistory(); return; }
    const o0 = (await Store.getMeta('options')) || {};
    $n('plCard').innerHTML = plantCardHtml(f, o0);
    $n('plCard').hidden = false; $n('plBtns').hidden = false;
    $n('plEditBtn').hidden = true; // 0.4.82 修改搬到月分工作進度
    renderPlantHistory(); // 0.4.77 卡片下面列這位農民從頭到尾的紀錄
  }
  /* ───── 0.4.82 董事長「修改搬走」：修改種植資料在月分工作進度，選了還在種、自己負責的農民 → 種植進度下面「修改種植資料」→ 就地打開原本那份表單（id 不變、存檔走同一個 plantSave） ───── */
  /** 可以改的人：自己負責、還在種（closeList）、已經上傳（後台有這位） */
  const plantEditable = cid => (state.closeList || []).find(x => x.id === cid && !x.pending) || null;
  async function openPlantEdit(cid) {
    const f = plantEditable(cid);
    if (!f) return;
    state.plEditCid = cid;
    $n('plHint').textContent = '';
    await fillPlantForm(f);
    $n('plForm').hidden = false;
    const eb = $n('pfEditBtn'); eb.hidden = true;
  }
  function closePlantEdit() {
    state.plEditCid = ''; $n('plForm').hidden = true;
    const eb = $n('pfEditBtn'); eb.hidden = false;
  }
  /** 表單先填好這位農民現在的種植資料（原本 onPlantFarmer 的後半段） */
  async function fillPlantForm(f) {
    const cid = f.id;
    const o = (await Store.getMeta('options')) || {};
    document.querySelectorAll('.unit').forEach(el => { el.textContent = `（${o.areaUnit || '英畝'}）`; });
    const crops = (o.crops || []).map(c => ({ value: c, text: cropText(c) })); crops.push({ value: '其他', text: '其他／အခြား' });
    setSelect($n('plCrop'), crops, f.crop || '', '— 選擇作物 သီးနှံရွေးပါ —');
    const cos = o.seedCompanies || [], v = String(f.variety || '');
    const co = cos.find(c => v === c || v.indexOf(c + ' ') === 0) || '';
    setSelect($n('plCo'), cos.map(c => ({ value: c, text: c })), co || (cos.length ? '' : v), '— 選擇種子公司 ကုမ္ပဏီရွေးပါ —');
    $n('plCo').dataset.old = v; // 沒換公司就保留原本的品種（品種開頭是公司名）
    $n('plCode').value = f.varCode || ''; $n('plDate').value = f.plantDate || '';
    $n('plNow').value = f.areaNow == null ? '' : f.areaNow; $n('plMax').value = f.areaMax == null ? '' : f.areaMax;
    $n('plFert').value = f.fertilizer || '';
    state.plantOrig = { cid, vals: collectPlant() }; // 種植資料中1（第8任）：記下表單一開始的值，存檔只送改過的欄位
  }
  /**
   * 種植資料中2、低3（第8任 2026-11-12，2號清單）：面積負數、不是數字（緬文數字、逗號）、目前大於可種、日期太遠，
   * 原本手機照送、後台默默丟掉、畫面還說「已存好」→ 存檔前擋下並說哪裡錯
   */
  /**
   * 2號 0.4.70 清單低4（第8任）：打卡「＋新增農民」的面積、種植日期沒有檢查 → 負數被後台默默丟掉、2099 年或目前大於可種照樣存，之後種植資料就卡住。
   * 跟種植資料分頁同一套規則；只管新增農民（舊客戶的客戶資料拜訪時不顯示）
   */
  function profileProblem() {
    if ($('farmer').value !== '__new' || isDealerCat()) return '';
    const num = id => { const el = $n(id), v = String(el.value == null ? '' : el.value).trim(); if (el.validity && el.validity.badInput) return NaN; return v === '' ? null : Number(v); };
    const now = num('pAreaNow'), max = num('pAreaMax');
    if (isNaN(now) || isNaN(max)) return '面積要填數字（用 0～9，不要用逗號）／ဧက ဂဏန်း ဖြည့်ပါ';
    if ((now !== null && now < 0) || (max !== null && max < 0)) return '面積不能是負數／ဧက အနုတ် မဖြစ်ရ';
    if (now !== null && max !== null && now > max) return '目前種植面積不能大於可種植面積／လက်ရှိ ဧက များနေသည်';
    const d = String($n('pPlantDate').value || '');
    if (d && d > mmDay(365)) return '種植日期不能超過一年後／ရက် မှားနေသည်';
    return '';
  }
  // 2號 0.4.70 清單低1（第8任）：原本檢查整張表單的現值，舊資料本來就不合規定（例：日期 2099、目前＞可種）時，改任何別的欄位都存不了
  // → ch（plantChanges 的結果）有給就只檢查「這次改到的」欄位；面積兩格有一格改到才比大小。打了不是數字的（badInput）不管哪格都擋（不然會被當成清空）
  function plantProblem(ch) {
    const num = id => { const el = $n(id), v = String(el.value == null ? '' : el.value).trim(); if (el.validity && el.validity.badInput) return NaN; return v === '' ? null : Number(v); };
    const touched = k => !ch || k in ch.profile || ch.clear.indexOf(k) >= 0;
    const now = num('plNow'), max = num('plMax');
    if (isNaN(now) || isNaN(max)) return '面積要填數字（用 0～9，不要用逗號）／ဧက ဂဏန်း ဖြည့်ပါ';
    if ((touched('areaNow') && now !== null && now < 0) || (touched('areaMax') && max !== null && max < 0)) return '面積不能是負數／ဧက အနုတ် မဖြစ်ရ';
    if ((touched('areaNow') || touched('areaMax')) && now !== null && max !== null && now > max) return '目前種植面積不能大於可種植面積／လက်ရှိ ဧက များနေသည်';
    const d = String($n('plDate').value || '');
    if (touched('plantDate') && d && d > mmDay(365)) return '種植日期不能超過一年後／ရက် မှားနေသည်';
    return '';
  }
  /** 種植資料中1、低4（第8任）：跟表單一開始的值比，只送改過的；改成空白的放 clear（後台才知道是刻意清掉，不是沒帶到值） */
  function plantChanges(cid) {
    const cur = collectPlant(), orig = state.plantOrig && state.plantOrig.cid === cid ? state.plantOrig.vals : {};
    const profile = {}, clear = [];
    Object.keys(cur).forEach(k => {
      const a = String(cur[k] == null ? '' : cur[k]).trim(), b = String(orig[k] == null ? '' : orig[k]).trim();
      if (a === b) return;
      if (a === '') clear.push(k); else profile[k] = cur[k];
    });
    return { profile, clear };
  }
  /** 要送的種植資料（品種：沒換公司就留原本的；換了公司就記公司名；跟打卡畫面 varietyValue 同一規則） */
  function collectPlant() {
    const co = $n('plCo').value.trim(), old = $n('plCo').dataset.old || '';
    const variety = !co ? old : (old && (old === co || old.indexOf(co + ' ') === 0) ? old : co);
    return { crop: $n('plCrop').value, variety, varCode: $n('plCode').value.trim(), plantDate: $n('plDate').value,
      areaNow: $n('plNow').value, areaMax: $n('plMax').value, fertilizer: $n('plFert').value.trim() };
  }
  async function savePlant() {
    const cid = state.plEditCid || '', cfg = await getConfig(); // 0.4.82 改在月分工作進度：存的是正在改的那位（不是種植資料分頁選的）
    if (!cid) return;
    if (!cfg || !cfg.deviceKey || (typeof navigator !== 'undefined' && navigator.onLine === false)) { $n('plHint').textContent = '要有網路才能存種植資料，請連上網路再按一次／အင်တာနက် လိုသည်'; return; }
    const ch = plantChanges(cid);
    const bad = plantProblem(ch); if (bad) { $n('plHint').textContent = bad; return; } // 低1：只檢查改到的欄位
    if (!Object.keys(ch.profile).length && !ch.clear.length) { $n('plHint').textContent = '沒有改任何資料／ပြောင်းထားတာ မရှိ'; return; }
    const btn = $n('plSave'); btn.disabled = true; $n('plHint').textContent = '存檔中…／သိမ်းနေသည်';
    try {
      const r = await gasCall({ action: 'plantSave', cid, profile: ch.profile, clear: ch.clear }); // 業務BUG#3：改走 gasCall，有逾時；種植資料中1（第8任）：只送改過的欄位
      if (r && r.timeout) { $n('plHint').textContent = '網路太慢，可能沒存成功，請再按一次／ထပ်နှိပ်ပါ'; return; } // 後台可能其實已存好，重按同樣的值不會壞事
      if (!r || !r.ok) { $n('plHint').textContent = (r && r.message) || '存檔失敗，請再試一次／မအောင်မြင်'; return; }
      if (Array.isArray(r.farmers)) await Store.setMeta('farmers', r.farmers);
      $n('plHint').textContent = '已存好，主管看得到／သိမ်းပြီး';
      toast('種植資料已存好／သိမ်းပြီး');
      $n('plHistory')._doneCid = null; // 0.4.80 低5：存好了要重讀紀錄
      await fillCloseFarmers(); closePlantEdit(); showCloseProgress(); $n('plHint').textContent = '已存好，主管看得到／သိမ်းပြီး'; // 0.4.82 存好收起表單、重畫進度卡與 150 天進度
    } catch (e) { $n('plHint').textContent = '網路不穩，沒存成功，請再按一次／ထပ်နှိပ်ပါ'; } finally { btn.disabled = false; }
  }
  /* ───── 0.4.61 董事長：農民試作成功、失敗都要產生一份報表檔，所有人都看得到 ─────
     「我的進度」按「看試作報告」才向後台拿清單（要有網路；不在每次畫首頁時自動拿，省流量）；有 Word 的按一下下載
     業務BUG#3（2號小助手 2026-11-12）：原本直接 fetch 沒上限，緬甸網路「不回也不斷」時按鈕一直停在「存檔中…」→ 加逾時 20 秒（Word 檔 60 秒） */
  async function gasCall(payload) {
    const cfg = await getConfig();
    if (!cfg || !cfg.deviceKey || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { ok: false, offline: true };
    // 1號第2任 0.4.73 讀碼中1（第8任）：照片、錄音（myFile）用 base64 傳，長錄音在緬甸網路 20 秒常傳不完 → 跟報告檔一樣給 60 秒
    const ms = payload && payload.action === 'farmerReport' ? 150000 : payload && (payload.action === 'trialReportFile' || payload.action === 'myFile') ? 60000 : 20000; // 0.4.77 種植紀錄 Word 含全部照片，給 120 秒
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl && typeof setTimeout === 'function' ? setTimeout(() => ctl.abort(), ms) : null;
    try {
      const res = await fetch(FARM_CONFIG.gasUrl, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ deviceKey: cfg.deviceKey }, payload)), signal: ctl ? ctl.signal : undefined });
      return await res.json();
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, timeout: true, message: '網路太慢，可能沒讀到，請再按一次／ထပ်နှိပ်ပါ' };
      throw e;
    } finally { if (timer) clearTimeout(timer); }
  }
  async function loadReports() {
    const btn = $n('reportLoadBtn'); btn.disabled = true; $n('reportHint').textContent = '讀取中…／ဖတ်နေသည်';
    try {
      const r = await gasCall({ action: 'trialReports' });
      if (r && r.offline) { $n('reportHint').textContent = '要有網路才能看試作報告，請連上網路再按一次／အင်တာနက် လိုသည်'; return; }
      if (!r || !r.ok || !Array.isArray(r.reports)) { $n('reportHint').textContent = (r && r.message) || '讀取失敗，請再按一次／ထပ်နှိပ်ပါ'; return; }
      state.reports = r.reports;
      state.me = String(((await getConfig()) || {}).name || ''); // 0.4.69 分「我的／其他業務」用
      renderReports();
    } catch (e) { $n('reportHint').textContent = '網路不穩，請再按一次／ထပ်နှိပ်ပါ'; } finally { btn.disabled = false; }
  }
  const REPORT_PILL = { 成功: 'ok', 失敗: 'late', 結束: 'wait' };
  /* 0.4.69 董事長：首頁右上角「分享我的報告」「觀看其他業務報告」→ 同一份清單分「我的（負責業務＝我）／其他業務」，看的範圍不變 */
  const REPORT_SCOPE = { all: '全部的試作報告／အားလုံး', mine: '我的報告（我負責的試作）／ကျွန်ုပ်၏', others: '其他業務的報告／အခြားသူများ' };
  const reportScopeOf = (list, scope, me) => (scope === 'mine' ? list.filter(t => String(t.staff || '') === me)
    : scope === 'others' ? list.filter(t => String(t.staff || '') !== me) : list);
  function renderReports() {
    const scope = REPORT_SCOPE[state.reportScope] ? state.reportScope : 'all';
    if (typeof document.querySelectorAll === 'function') document.querySelectorAll('#reportScope [data-scope]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scope === scope)));
    const now = document.getElementById('reportNow'); if (now) now.textContent = '現在看：' + REPORT_SCOPE[scope];
    const ul = document.getElementById('reportList'); // 舊頁面沒有這一塊：不畫
    if (!ul || !Array.isArray(state.reports)) return;
    const list = reportScopeOf(state.reports, scope, String(state.me || '')), count = s => list.filter(t => t.status === s).length;
    $n('reportHint').textContent = list.length ? `共 ${list.length} 件：成功 ${count('成功')}、失敗 ${count('失敗')}、結束 ${count('結束')}／စုစုပေါင်း ${list.length}` : '';
    ul.innerHTML = list.map(t => `<li><span>${esc(t.name || '—')}${t.area ? '・' + esc(t.area) : ''}<br><small>${esc(catBi(t.cat || '試作'))}・${esc(t.item || '—')}・${esc(t.start || '?')}～${esc(t.end || '?')}${t.staff ? '・' + esc(t.staff) : ''}${t.reason ? '<br>失敗原因 အကြောင်းရင်း：' + esc(t.reason) : ''}</small><br>`
      + (t.hasReport ? `<button type="button" class="btn2 small" data-rep="${esc(t.id)}">⬇ 下載報告（Word）／ဒေါင်းလုဒ်</button>`
        : `<small>${t.report === '產生失敗' ? '報告產生失敗，請告訴主管／မအောင်မြင်' : '報告製作中，晚點再看／ပြင်ဆင်နေဆဲ'}</small>`)
      + `</span><span class="pill ${REPORT_PILL[t.status] || 'wait'}">${esc(t.status)}</span></li>`).join('')
      || `<li class="empty">${scope === 'mine' ? '你負責的試作還沒有結束的／ကျွန်ုပ်၏ ပြီးဆုံးသော စမ်းသပ်မှု မရှိသေး' : scope === 'others' ? '其他業務還沒有結束的試作／အခြားသူများ၏ မရှိသေး' : '還沒有結束的試作／ပြီးဆုံးသော စမ်းသပ်မှု မရှိသေး'}</li>`;
    ul.querySelectorAll('[data-rep]').forEach(b => b.addEventListener('click', () => downloadTrialReport(b)));
  }
  /** 0.4.69 首頁右上角兩顆入口：切到「我的進度」、打開試作報告、選好「我的」或「其他業務」，還沒讀過就讀一次 */
  async function openReports(scope) {
    state.reportScope = scope;
    state.me = String(((await getConfig()) || {}).name || '');
    const tab = document.getElementById('htab-mine'); if (tab) tab.click();
    const sec = document.getElementById('mineReports'); if (sec && sec.tagName === 'DETAILS') sec.open = true;
    renderReports();
    if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (!Array.isArray(state.reports)) await loadReports();
  }
  async function downloadTrialReport(btn) {
    const label = btn.textContent;
    btn.textContent = '下載中…／ဒေါင်းနေသည်'; btn.disabled = true;
    try {
      const r = await gasCall({ action: 'trialReportFile', trialId: btn.dataset.rep });
      // 2號 0.4.63 小事（第8任）：下載失敗原本把按鈕字換成錯誤訊息就不換回來 → 錯誤改用提示，按鈕字恢復原樣可以再按
      if (!r || !r.ok || !r.data) { toast((r && r.offline) ? '下載報告要有網路／အင်တာနက် လိုသည်' : (r && r.message) || '下載失敗，請再試／မအောင်မြင်'); btn.textContent = label; return; }
      const bytes = Uint8Array.from(atob(r.data), ch => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
      const a = document.createElement('a'); a.href = url; a.download = r.name || (btn.dataset.rep + '.docx'); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      btn.textContent = label;
    } catch (e) { toast('下載失敗，請再試／မအောင်မြင်'); btn.textContent = label; } finally { btn.disabled = false; }
  }

  function showCloseProgress() {
    const sel = document.getElementById('closeFarmer'), cid = sel ? sel.value : '';
    const current = () => !!sel && sel.value === cid, list = state.mineAll || state.closeList || [];
    // 0.4.75 董事長「農民 150 天做成一個進度 100%」：選到農民 → 進度卡最上面放種植進度條（盤商、種子商沒有）
    const gb = $n('closeGrow'), f = list.find(x => x.id === cid);
    if (state.plEditCid && state.plEditCid !== cid) closePlantEdit(); // 換人：正在改的那份收起來
    if (cid && f && (f.type || '農民') === '農民') {
      gb.hidden = false;
      // 0.4.82 董事長「修改搬走」：還在種、自己負責、已上傳的農民 → 種植進度下面一顆「修改種植資料」，按了就地打開表單
      gb.innerHTML = growHtml((state.mineGrow || {})[cid] || growOf(f.plantDate, mmDay(0)))
        + (plantEditable(cid) ? `<button type="button" class="btn2 small" id="pfEditBtn"${state.plEditCid === cid ? ' hidden' : ''}>✎ 修改種植資料<span class="my">စိုက်ပျိုးမှု အချက်အလက် ပြင်ရန်</span></button>` : '');
      const eb = document.getElementById('pfEditBtn'); if (eb) eb.onclick = () => openPlantEdit(cid);
    }
    else { gb.hidden = true; gb.innerHTML = ''; }
    renderProgress(cid, { box: $n('closeProgress'), current, list, home: true });
    renderHistory(cid, $n('closeHistory'), { current, list }); // 0.4.73 董事長：點進去要有之前拜訪過的紀錄及照片及錄音
  }

  /* ───── 0.4.73 董事長「我的進度：點進去要有之前拜訪過的紀錄及照片及錄音」「結案：要有之前的照片、留言、錄音、地址、詳細過往失敗成功的紀錄」─────
     後台 myHistory（這位客戶全部拜訪，最多 50 筆＋試作／推廣紀錄＋地址）、myFile（照片／錄音，只限自己負責的客戶）。
     照片、錄音點了才下載（緬甸網路慢、省流量），下載過的記在 fileCache，同一次開網頁不重抓 */
  const fileCache = {};
  async function loadMyFile(cid, fileId, kind, scope) {
    const key = kind + ':' + fileId;
    if (fileCache[key]) return fileCache[key];
    let r;
    // 0.4.75 田間打卡看別人負責的農民：帶 scope:'field'（後台農民任何業務都能讀；盤商、種子商照舊只限負責人）
    try { r = await gasCall(Object.assign({ action: 'myFile', cid, fileId, kind }, scope ? { scope } : {})); } catch (e) { r = null; }
    if (!r || !r.ok || !r.data) return { err: r && r.offline ? '要有網路／အင်တာနက် လိုသည်' : r && r.timeout ? '網路太慢，請再按一次／ထပ်နှိပ်ပါ' : (r && r.message) || '讀取失敗，請再按一次／ထပ်နှိပ်ပါ' };
    return (fileCache[key] = { url: `data:${r.mime || (kind === 'photo' ? 'image/jpeg' : 'audio/wav')};base64,${r.data}` });
  }
  const TRIAL_PILL = { 成功: 'ok', 失敗: 'late', 結束: 'wait', 進行中: 'wait' };
  /** 0.4.75 收起過往紀錄框（換掉讀取記號，還在讀的結果回來也不會再打開） */
  const hideHist = id => { const hb = $n(id); hb.hidden = true; hb.innerHTML = ''; hb._tok = null; };
  /* 1號清單低4（0.4.75）：過往紀錄的類別加緬文；後台會給「結案（已退回）」「結案（待確認）」，括號裡的狀態也加緬文（示意，待校對） */
  const HIST_STATE_MY = { 已退回: 'ပြန်ပို့ပြီး', 待確認: 'စစ်ဆေးရန်' };
  const histCatBi = c => { const s = String(c || ''), m = s.match(/^(.*?)（(.+)）$/);
    return m ? `${catBi(m[1])}（${m[2]}${HIST_STATE_MY[m[2]] ? '／' + HIST_STATE_MY[m[2]] : ''}）` : catBi(s); };
  /* ───── 0.4.78 生長階段＋「生長過程」時間軸（圖文並茂）─────
     推算表跟後台 STAGE_GUESS 同一份（2 號第2任對齊）：[下限天數（含當天）, 階段]；天數＝拜訪日（緬甸日期）−種植日期；
     天數 <0、沒有種植日期、日期不對 → 不推算；「採收後」「剖面圖」只能業務自己選；結案那筆一律當「採收」 */
  const STAGE_GUESS = [[0, '發芽'], [14, '長大'], [45, '開花'], [70, '結果'], [100, '採收']];
  const STAGES = ['發芽', '長大', '開花', '結果', '採收', '採收後', '剖面圖']; // 時間軸順序；也是後台只收的 7 個值
  const STAGE_MY = { 發芽: 'အညှောက်ထွက်', 長大: 'ကြီးထွား', 開花: 'ပန်းပွင့်', 結果: 'အသီးသီး', 採收: 'ရိတ်သိမ်း', 採收後: 'ရိတ်သိမ်းပြီး', 剖面圖: 'ဖြတ်ပိုင်းပုံ' };
  /** 依種植日期推算某一天是哪個階段；推不出來回空字串 */
  function stageGuess(plantDate, day) {
    const a = String(plantDate || '').slice(0, 10), b = String(day || '').slice(0, 10);
    if (!/^\d{4}-\d\d-\d\d$/.test(a) || !/^\d{4}-\d\d-\d\d$/.test(b)) return '';
    const d = Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
    if (!isFinite(d) || d < 0) return '';
    let s = '';
    STAGE_GUESS.forEach(([min, st]) => { if (d >= min) s = st; });
    return s;
  }
  /** 生長過程時間軸：每個階段列那個階段的拜訪（日期＋文字摘要＋照片，照片按了才下載）；沒標階段的用種植日期推算並標「（推算）」 */
  function growthTimelineHtml(visits, plantDate) {
    const by = {}; STAGES.forEach(s => { by[s] = []; });
    let noPd = 0, early = 0, badDay = 0; // 0.4.80 低3：沒有種植日期、拜訪早於種植日期，分開數
    // 0.4.81（0.4.80 巡檢低1）：拜訪日期也要有效，才算「早於種植日期」；壞掉的另外算「日期不明」
    const ymdValid = x => { const s = String(x || '').slice(0, 10); return /^\d{4}-\d\d-\d\d$/.test(s) && isFinite(Date.parse(s)); };
    (visits || []).slice().reverse().forEach(v => { // 後台新到舊 → 這裡由舊到新
      if (v.noMeet && !(v.photos || []).length) return; // 沒見到、沒照片的不算生長紀錄
      if (!v.text && !(v.photos || []).length && !v.closing) return;
      let st = STAGES.indexOf(v.stage) >= 0 ? v.stage : v.closing ? '採收' : '', guessed = false;
      if (!st) { st = stageGuess(plantDate, v.time); guessed = !!st; }
      if (!st) { const pdOk = ymdValid(plantDate), vOk = ymdValid(v.time); if (pdOk && vOk) early++; else if (!pdOk) noPd++; else badDay++; return; }
      by[st].push({ v, guessed });
    });
    const short = t => { const s = String(t || ''); return s.length > 80 ? s.slice(0, 80) + '…' : s; };
    const li = STAGES.map(st => { const es = by[st];
      return `<li class="${es.length ? 'has' : ''}"><span class="gst">${st} <span class="my">${STAGE_MY[st]}</span></span>`
        + (es.length ? es.map(({ v, guessed }) => `<div class="gent"><b>${esc(String(v.time || '').slice(0, 10))}</b>${guessed ? '<small>（推算 ခန့်မှန်း）</small>' : ''}${v.text ? '　' + esc(short(v.text)) : v.closing ? '　' + esc(short(v.closing)) : ''}`
          + `${(v.photos || []).length ? `<div class="pgrid">${v.photos.map((id, i) => `<button type="button" class="btn2 small" data-hph="${esc(id)}">📷 照片 ${i + 1}</button>`).join('')}</div>` : ''}</div>`).join('')
          : '<div class="gent"><small>還沒有照片／ဓာတ်ပုံ မရှိသေး</small></div>') + '</li>'; }).join('');
    return `<h3>生長過程／ကြီးထွားမှု အဆင့်ဆင့်</h3>${noPd ? `<p class="sub">有 ${noPd} 筆拜訪沒標階段、也沒有種植日期，無法推算／အဆင့် မသိနိုင်</p>` : ''}${early ? `<p class="sub">有 ${early} 筆拜訪早於種植日期，無法推算階段／စိုက်ရက်မတိုင်မီ</p>` : ''}${badDay ? `<p class="sub">有 ${badDay} 筆拜訪日期不明，無法推算階段／ရက်စွဲ မသိ</p>` : ''}<ol class="growtl">${li}</ol>`;
  }
  /* 0.4.77 董事長「種植資料要詳細列出結案的照片、文字、重量、之前田間報告」＋範例紙卡：結案區塊（照片排格子、量測卡一行一項） */
  const MEASURE_ROWS = [['variety', '品種', 'မျိုး'], ['sample', '樣本', 'နမူနာ'], ['weight', '總重量', 'အလေးချိန်'], ['length', '長度', 'အရှည်'], ['rows', '穗行數', 'အစေ့တန်း'],
    ['sowDate', '播種日', 'မျိုးချရက်'], ['harvestDate', '採收日', 'ရိတ်သိမ်းရက်'], ['days', '生長天數', 'စိုက်ပျိုးရက်']];
  /** 量測卡（像範例紙卡，一行一項；沒填的不列） */
  function measureCardHtml(m) {
    if (!m || typeof m !== 'object') return '';
    const has = x => x !== '' && x != null;
    const val = { variety: m.variety, sample: has(m.sampleCount) ? `${m.sampleCount} ${m.sampleUnit || ''}` : '',
      weight: has(m.weightKg) ? `${m.weightKg} kg${m.husk ? '（' + m.husk + '）' : ''}` : (m.husk || ''), length: has(m.length) ? `${m.length} ${m.lengthUnit || ''}` : '',
      rows: m.rows, sowDate: m.sowDate, harvestDate: m.harvestDate, days: has(m.days) ? `${m.days} 天` : '' };
    const li = MEASURE_ROWS.filter(([k]) => has(val[k])).map(([k, zh, my]) => `<li>${zh} <span class="my">${my}</span>：<b>${esc(String(val[k]).trim())}</b></li>`).join('');
    return li ? `<ul class="mcard">${li}</ul>` : '';
  }
  /** 0.4.81 董事長「結案通過主管審核過，才能在種植資料顯示」：結案那筆的審核狀態（closingDetail.state；舊後台沒有就看 closeRejected／closePending；空白＝不用審核） */
  const closeStateOf = v => { const d = v && v.closingDetail && typeof v.closingDetail === 'object' ? v.closingDetail : null; return (d && d.state) || (v && v.closeRejected ? '已退回' : v && v.closePending ? '待確認' : ''); };
  /** 最近一筆結案：狀態、文字、價格、產量（重量）、收購客戶…、照片格子、量測卡。後台還沒給 closingDetail 時退回顯示結案那串文字 */
  function closeBlockHtml(v) {
    const d = v.closingDetail && typeof v.closingDetail === 'object' ? v.closingDetail : null;
    const pill = v.closeRejected || (d && d.state === '已退回') ? '<span class="pill late">主管已退回 ပြန်ပို့</span>' : v.closePending || (d && d.state === '待確認') ? '<span class="pill wait">待主管確認 စစ်ဆေးဆဲ</span>' : '<span class="pill ok">已結案 ပိတ်သိမ်းပြီး</span>';
    const rows = d ? [['賣給地區 ရောင်းသည့်ဒေသ', d.region], ['價格 ဈေးနှုန်း', d.price !== '' && d.price != null ? `${d.price} ${d.priceUnit || ''}` : ''], ['產量（重量） အထွက်', d.yield !== '' && d.yield != null ? `${d.yield} ${d.yieldUnit || ''}` : ''],
      ['收購客戶 ဝယ်သူ', d.buyer], ['電話 ဖုန်း', d.phone], ['原因 အကြောင်းရင်း', d.reason], ['進度 တိုးတက်မှု', d.progress], ['試作結果 ရလဒ်', d.trialOutcome || (d.trialResult && d.trialResult.outcome) || '']].filter(([, x]) => x !== '' && x != null) : [];
    return `<div class="vclose"><b>${esc(v.time || '')}</b> ${pill}${v.staff ? '｜' + esc(v.staff) : ''}`
      + (rows.length ? `<ul>${rows.map(([k, x]) => `<li>${k}：<b>${esc(String(x).trim())}</b></li>`).join('')}</ul>` : (v.closing ? `<p>${esc(v.closing)}</p>` : ''))
      + `${v.text ? `<p>${esc(v.text)}</p>` : ''}${v.typed && v.typed !== v.text ? `<p><small>打字原文 မူရင်း：${esc(v.typed)}</small></p>` : ''}`
      + `${v.plantFail ? `<p><span class="pill late">種植失敗</span> ${esc(v.plantFail)}</p>` : ''}`
      + `${(v.photos || []).length ? `<div class="pgrid">${v.photos.map((id, i) => `<button type="button" class="btn2 small" data-hph="${esc(id)}">📷 照片 ${i + 1}</button>`).join('')}</div>` : ''}`
      + `${v.audio ? `<button type="button" class="btn2 small" data-hau="${esc(v.audio)}">🔊 錄音</button>` : ''}`
      + measureCardHtml(d && d.measure) + '</div>';
  }
  function histHtml(r, o) {
    const addr = [r.area, r.town, r.village].filter(Boolean).join('・');
    const head = o.showAddr ? `<p class="sub">${addr ? '📍 ' + esc(addr) : ''}${r.address ? `${addr ? '　' : '📍 '}${esc(r.address)}` : ''}${r.phone ? `　📞 ${esc(String(r.phone).replace(/^'/, ''))}` : ''}</p>` : '';
    const tl = o.oldFirst ? (r.trials || []).slice().reverse() : (r.trials || []); // 0.4.77 種植資料頁：由舊到新（從頭到尾）
    const trials = tl.map(t => `<li><span class="pill ${TRIAL_PILL[t.status] || 'wait'}">${esc(t.status || '—')}</span> <b>${esc(catBi(t.cat || '試作'))}</b>：${esc(t.item || '（未填品項）')}${t.crop ? '（' + esc(t.crop) + '）' : ''}`
      + `<br><small>${esc(t.start || '?')}～${esc(t.end || (t.status === '進行中' ? '進行中' : '?'))}${t.yield !== '' ? `・產量 အထွက် ${esc(t.yield)} ${esc(t.yieldUnit)}` : ''}${t.comment ? '・農民評價 သုံးသပ်ချက်：' + esc(t.comment) : ''}</small>`
      + `${t.reason ? `<br><small>失敗原因 အကြောင်းရင်း：${esc(t.reason)}</small>` : ''}${t.conclusion ? `<br><small>結論 နိဂုံး：${esc(t.conclusion)}</small>` : ''}</li>`).join('');
    const raw = r.visits || [];
    // 0.4.81 董事長「結案通過主管審核過，才能在種植資料顯示」（只有種植資料頁 closeFirst）：待確認、已退回那筆的結案內容先藏起來，拜訪本身照列
    const hid = o.closeFirst ? raw.filter(v => v.closing && /^(待確認|已退回)$/.test(closeStateOf(v))) : [];
    const all = hid.length ? raw.map(v => hid.indexOf(v) < 0 ? v : Object.assign({}, v, { closing: '', closingDetail: null, closeHidden: closeStateOf(v) })) : raw;
    const lastClose = o.closeFirst ? raw.find(v => v.closing && closeStateOf(v) !== '已退回') : null; // 退回的當作沒結案，往前找
    const pendTop = !!lastClose && closeStateOf(lastClose) === '待確認'; // 最近一筆還在等主管：區塊只說等審核
    const cv = o.closeFirst && !pendTop ? all.find(v => v.closing) : null; // 0.4.77 種植資料頁：後台新到舊，第一筆有結案的就是最近一筆結案
    const rest = cv ? all.filter(v => v !== cv) : all;
    const vl = o.oldFirst ? rest.slice().reverse() : rest;
    const visits = vl.map(v => `<li><b>${esc(v.time)}</b>｜${esc(histCatBi(v.cat))}${v.staff ? '｜' + esc(v.staff) : ''}`
      // 1號第2任讀碼中2（第8任）：text 是中文摘要，業務自己打的（常是緬文）看不到 → 摘要跟打字原文不一樣時，原文另外列一行
      + `${v.text ? `<br>${esc(v.text)}` : ''}${v.typed && v.typed !== v.text ? `<br><small>打字原文 မူရင်း：${esc(v.typed)}</small>` : ''}${v.noMeet ? `<br><span class="pill wait">沒見到</span> ${esc(v.noMeet)}` : ''}${v.prices ? `<br><small>價格：${esc(v.prices)}</small>` : ''}`
      + `${v.plantFail ? `<br><span class="pill late">種植失敗</span> ${esc(v.plantFail)}` : ''}${v.closing ? `<br><small>結案 ပိတ်သိမ်း：${esc(v.closing)}</small>` : ''}${v.closeHidden === '待確認' ? '<br><small>結案等主管審核／စစ်ဆေးဆဲ</small>' : ''}`
      // 0.4.81（第10任）：待確認那筆的照片、錄音也不列（跟後台 Word 一致：待確認不放照片）
      + (v.closeHidden === '待確認' ? '' : `${(v.photos || []).length || v.audio ? '<br>' : ''}${(v.photos || []).map((id, i) => `<button type="button" class="btn2 small" data-hph="${esc(id)}">📷 照片 ${i + 1}</button>`).join(' ')}`
        + `${v.audio ? ` <button type="button" class="btn2 small" data-hau="${esc(v.audio)}">🔊 錄音</button>` : ''}`) + '</li>').join('');
    const closeTop = o.closeFirst ? `<h3>結案／ပိတ်သိမ်း</h3>${pendTop ? '<p class="sub">結案等主管審核，通過後才顯示內容／ပိတ်သိမ်းမှု မန်နေဂျာ အတည်ပြုပြီးမှ ပြမည်</p>' : cv ? closeBlockHtml(cv) : '<p class="sub">還沒結案／မပိတ်သိမ်းရသေး</p>'}` : '';
    // 0.4.81（2號後台對齊）：待確認那筆的照片不在生長過程露出（結案文字已藏，也不會被當成「採收」）
    const tlTop = o.timeline ? growthTimelineHtml(hid.length ? all.map(v => v.closeHidden === '待確認' ? Object.assign({}, v, { photos: [] }) : v) : all, o.plantDate) : ''; // 0.4.78 生長過程時間軸（種植資料、田間打卡、結案共用）
    return `${tlTop}${closeTop}<h3>${o.closeFirst ? '之前的田間報告／ယခင် ကွင်းဆင်း အစီရင်ခံစာ' : '過往紀錄／ယခင် မှတ်တမ်း'}</h3>${head}`
      + (trials ? `<p class="sub">試作／推廣（成功、失敗）／စမ်းသပ်မှု ရလဒ်：</p><ul>${trials}</ul>` : (o.showTrials ? '<p class="sub">沒有試作、推廣紀錄／စမ်းသပ်မှု မရှိ</p>' : ''))
      + `<p class="sub">拜訪紀錄 共 ${r.total || 0} 筆${r.more ? '（只列最近 50 筆）' : ''}${o.oldFirst ? '，由舊到新' : ''}；照片、錄音按了才下載／ဓာတ်ပုံ၊ အသံ နှိပ်မှ ဒေါင်းမည်：</p>`
      + (visits ? `<ul>${visits}</ul>` : '<p>還沒有拜訪紀錄／မှတ်တမ်း မရှိသေး</p>');
  }
  async function renderHistory(cid, el, opts) {
    const o = opts || {}, current = o.current || (() => true);
    if (!el || !el.id) return; // 舊頁面沒有這一塊
    if (!cid || cid === '__new') { el.hidden = true; el.innerHTML = ''; el._tok = null; return; }
    const f = (o.list || []).find(x => x.id === cid) || {};
    if (f.pending) { el._tok = null; el.hidden = false; el.innerHTML = '<p class="sub">剛新增、還沒上傳的客戶，上傳後才看得到過往紀錄／တင်ပြီးမှ ကြည့်နိုင်</p>'; return; }
    const tok = {}; el._tok = tok;
    el.hidden = false; el.innerHTML = '<h3>過往紀錄／ယခင် မှတ်တမ်း</h3><p class="sub">讀取中…／ဖတ်နေသည်</p>';
    let r;
    try { r = await gasCall(Object.assign({ action: 'myHistory', cid }, o.scope ? { scope: o.scope } : {})); } catch (e) { r = { ok: false, message: '網路不穩，請再試一次／ထပ်ကြိုးစားပါ' }; }
    if (r && !r.ok && r.code === 'NOT_ALLOWED') r = { ok: false, message: '只能看自己負責的客戶／ကိုယ်တာဝန်ယူထားသော ဖောက်သည်သာ' }; // 0.4.75 舊後台不認得 scope：照實說，不當掉
    if (el._tok !== tok) return; // 讀的途中換了客戶，新的那次接手
    if (!current()) { el.hidden = true; el.innerHTML = ''; el._tok = null; return; }
    if (!r || !r.ok) { el.innerHTML = `<h3>過往紀錄／ယခင် မှတ်တမ်း</h3><p class="sub">${esc(r && r.offline ? '要有網路才看得到過往紀錄、照片、錄音／အင်တာနက် လိုသည်' : (r && r.message) || '讀取失敗，請再試一次／ထပ်ကြိုးစားပါ')}</p>`; return; }
    el.innerHTML = histHtml(r, o.timeline ? Object.assign({}, o, { plantDate: f.plantDate }) : o); // 0.4.78 時間軸推算用種植日期
    el.querySelectorAll('[data-hph]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true; const label = b.textContent; b.textContent = '下載中…';
      const x = await loadMyFile(cid, b.dataset.hph, 'photo', o.scope);
      if (x.err) { toast(x.err); b.textContent = label; b.disabled = false; return; }
      const img = document.createElement('img'); img.src = x.url; img.alt = label; img.className = 'hphoto'; b.replaceWith(img);
    }));
    el.querySelectorAll('[data-hau]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true; const label = b.textContent; b.textContent = '下載中…';
      const x = await loadMyFile(cid, b.dataset.hau, 'audio', o.scope);
      if (x.err) { toast(x.err); b.textContent = label; b.disabled = false; return; }
      const au = document.createElement('audio'); au.controls = true; au.src = x.url; b.replaceWith(au);
    }));
  }

  /* ───── 0.4.72 董事長「執行任務清單：新增幾個一般農民、試作農民、推廣農民、盤商、種子商，詳細的要列出來」（1號）─────
     後台 home.newList＝本月自己新增的客戶（已分好類）；五格各幾位，點一格展開那一類的明細（名字、鎮・村・地區、新增日期），再點收起 */
  const NEW_GROUPS = [['一般農民', 'ပုံမှန် လယ်သမား'], ['試作農民', 'စမ်းသပ် လယ်သမား'], ['推廣農民', 'မြှင့်တင် လယ်သမား'], ['盤商', 'ကုန်သည်'], ['種子商', 'မျိုးစေ့ဆိုင်']];
  /** 0.4.82 執行任務清單這一頁的五類名稱（董事長截圖用字：一般農戶）；其他頁照舊叫一般農民 */
  const TODO_LABEL = g => (g === '一般農民' ? '一般農戶' : g);
  // 0.4.75 董事長「農民改鎮跟村」：鎮放前面（town＝鎮、village＝村）
  const placeOf = c => { const place = [c.town, c.village, c.area ? String(c.area).trim() /* 0.4.89 地區完整顯示，不切字 */ : ''].filter(Boolean).join('・'); return place; };
  /** 一類一小區塊：標題帶人數，沒有就寫「沒有」 */
  const tcGroupHtml = (g, my, items) => `<section class="tcgrp"><h3>${esc(TODO_LABEL(g))}（${items.length}）<span class="my">${esc(my)}</span></h3>`
    + (items.length ? `<ul>${items.join('')}</ul>` : '<p class="sub none">沒有／မရှိ</p>') + '</section>';
  /** 0.4.87 董事長「兩欄太亂」：有人的分類照舊標題＋名單；0 筆的分類不再各佔一個標題＋「沒有」，合成一行灰色小字（例：試作農民 0・推廣農民 0・盤商 0） */
  function tcGroupsHtml(groups, itemsOf) {
    const rows = groups.map(([g, my]) => ({ g, my, items: itemsOf(g) }));
    const zero = rows.filter(r => !r.items.length);
    return rows.filter(r => r.items.length).map(r => tcGroupHtml(r.g, r.my, r.items)).join('')
      + (zero.length ? `<p class="tczero">${zero.map(r => `${esc(TODO_LABEL(r.g))} 0`).join('・')}</p>` : '');
  }
  /** 0.4.82 右欄「已開發的客戶」：本月新增照五類直接列出名字＋客戶編號（取代 0.4.72 點了才看的 chips） */
  function renderNewCust(h) {
    const box = document.getElementById('newCustList');
    if (!box) return; // 舊頁面沒有這一塊
    const list = h && Array.isArray(h.newList) ? h.newList : null;
    const sum = document.getElementById('newCustSum');
    if (!list) { // 還沒同步過，或後台還是舊版（只有總數）
      box.innerHTML = '';
      if (sum) sum.textContent = h ? `本月新增 ${h.newCustomers == null ? '—' : h.newCustomers} 位（明細要等後台更新）／အသေးစိတ် နောက်မှ` : '連上網路後會顯示／အင်တာနက်ချိတ်ပြီးမှ ပြမည်';
      return;
    }
    if (sum) sum.textContent = `本月新增共 ${list.length} 位／ဤလ ဖောက်သည်အသစ် ${list.length} ဦး`;
    // 0.4.87：每人一行（名字｜編號｜鎮・村・地區，「11/12 新增」放同一行最後的小灰字）；0 筆的分類合成一行
    box.innerHTML = tcGroupsHtml(NEW_GROUPS, g => list.filter(c => c.group === g).map(c => { const place = placeOf(c);
      return `<li><span><b>${esc(c.name || '（未命名）')}</b>｜${esc(c.id || '')}${place ? '｜' + esc(place) : ''}<small>${esc(String(c.date || '').slice(5).replace('-', '/'))} 新增 အသစ်</small></span></li>`; }));
  }
  /** 0.4.82 左欄「我負責的客戶」：五類（分類同月分工作進度 mineGroupOf），列「名字｜客戶編號｜鎮・村」，點一位開那位的田間打卡（openFromList 鎖類別） */
  const TODO_GROUPS = [['一般農民', 'ပုံမှန် လယ်သမား'], ['試作農民', 'စမ်းသပ် လယ်သမား'], ['推廣農民', 'မြှင့်တင် လယ်သမား'], ['盤商', 'ကုန်သည်'], ['種子商', 'မျိုးစေ့ဆိုင်']];
  function renderTodoCust() {
    const box = document.getElementById('todoCust');
    if (!box) return; // 舊頁面沒有這一塊
    const all = state.mineAll || [], gOf = state.mineGroupOf || {};
    box.innerHTML = tcGroupsHtml(TODO_GROUPS, g => all.filter(f => gOf[f.id] === g).map(f => { const tv = [f.town, f.village].filter(Boolean).join('・'); // 0.4.87：0 筆的分類合成一行
      return `<li class="go" data-id="${esc(f.id)}" data-type="${esc(f.type || '農民')}" role="button" tabindex="0"><span><b>${esc(f.name || '（未命名）')}</b>｜${f.pending ? '（新，未上傳 မတင်ရသေး）' : esc(f.id)}${tv ? '｜' + esc(tv) : ''}</span></li>`; }));
    box.querySelectorAll('li.go').forEach(li => {
      li.onclick = () => openFromList(li.dataset.id, li.dataset.type);
      li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFromList(li.dataset.id, li.dataset.type); } };
    });
  }

  /* ───── 0.4.82 董事長截圖「本月成績」：新增客戶看得出是哪幾位、哪一類；試作分出試作、推廣，是哪位農民 ─────
     後台每個月給 newList（同 home.newList）、trialList（{trialId, cid, name, cat 試作／推廣, kind 開始／完成, date, item, outcome}）；
     有明細：新增客戶那格多一行分類計數、試作那格改兩行，整格可點，在兩排卡片下面展開（同時只開一格，再點收起，跟著月份切換）；
     舊後台沒有明細：照舊只有數字、不能點 */
  const md = d => String(d || '').slice(5).replace('-', '/');
  function monthDetailHtml(kind, cur) {
    if (kind === 'new') return (cur.newList || []).map(c => { const place = [c.town, c.village, c.area ? String(c.area).trim() /* 0.4.89 地區完整顯示，不切字 */ : ''].filter(Boolean).join('・');
      return `<li><span><b>${esc(c.name || '（未命名）')}</b>${place ? '｜' + esc(place) : ''}<br><small>${esc(c.group || '')}・${esc(md(c.date))} 新增 အသစ်</small></span></li>`; }).join('')
      || '<li class="empty">這個月沒有新增客戶／ဖောက်သည်အသစ် မရှိ</li>';
    return (cur.trialList || []).map(t => `<li><span><b>${esc(t.name || '（未命名）')}</b>｜${esc(catBi(t.cat === '推廣' ? '推廣' : '試作'))}<br>`
      + `<small>${t.kind === '完成' ? '完成 ပြီးဆုံး' : '開始 စတင်'}・${esc(md(t.date))}${t.item ? '｜' + esc(t.item) : ''}${t.outcome ? '｜結果 ရလဒ်：' + esc(t.outcome) : ''}</small></span></li>`).join('')
      || '<li class="empty">這個月沒有開始或完成的試作、推廣／မရှိ</li>';
  }
  function renderMonthDetail(cur) {
    const nb = document.getElementById('statNewBox'), tb = document.getElementById('statTrialBox'), ul = document.getElementById('statDetail');
    if (!nb || !tb || !ul) return; // 舊頁面沒有這一塊
    const has = { new: !!cur && Array.isArray(cur.newList), trial: !!cur && Array.isArray(cur.trialList) };
    if (!has[state.monthOpen]) state.monthOpen = ''; // 換到沒有明細的月份（或舊後台）：收起
    // 新增客戶：數字下面一行分類計數（只列有的類）
    const sub = $n('statNewSub');
    if (has.new) { const cnt = NEW_GROUPS.map(([g]) => [g, cur.newList.filter(c => c.group === g).length]).filter(([, n]) => n);
      sub.textContent = cnt.map(([g, n]) => `${g} ${n}`).join('・'); sub.hidden = !cnt.length; } else { sub.textContent = ''; sub.hidden = true; }
    // 試作：兩行「試作 開始 n／完成 n」「推廣 開始 n／完成 n」
    const tr = $n('statTrials'), lab = $n('statTrialsLab');
    if (has.trial) {
      const n = (cat, kind) => cur.trialList.filter(t => (t.cat === '推廣' ? '推廣' : '試作') === cat && t.kind === kind).length;
      tr.className = 'two';
      tr.innerHTML = ['試作', '推廣'].map(c => `<span>${c} 開始 ${n(c, '開始')}／完成 ${n(c, '完成')}</span>`).join('');
      lab.innerHTML = '試作、推廣 開始／完成<br>စမ်းသပ်・မြှင့်တင် စတင်／ပြီးဆုံး';
    } else { tr.className = ''; lab.innerHTML = '試作 開始／完成<br>စမ်းသပ် စတင်／ပြီးဆုံး'; } // 數字照舊由 renderHome 寫
    [['new', nb], ['trial', tb]].forEach(([k, box]) => {
      const on = has[k];
      box.classList.toggle('go', on);
      if (on) { box.setAttribute('role', 'button'); box.tabIndex = 0; box.setAttribute('aria-expanded', String(state.monthOpen === k)); }
      else { box.removeAttribute('role'); box.removeAttribute('tabindex'); box.removeAttribute('aria-expanded'); }
      const toggle = () => { if (!on) return; state.monthOpen = state.monthOpen === k ? '' : k; renderMonthDetail(cur); };
      box.onclick = toggle; // 用 onclick（不是 addEventListener）：renderHome 常重畫，不會疊好幾個
      box.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
    });
    ul.hidden = !state.monthOpen;
    ul.innerHTML = state.monthOpen ? monthDetailHtml(state.monthOpen, cur) : '';
  }

  /* ───── 0.4.82 董事長「蔬菜快採收前 10 天要跳通知給業務、要到現場」（選「打開就跳提醒」，不做推播）─────
     後台 home.harvestSoon＝[{cid, name, crop, plantDate, harvestDate, daysLeft, lastVisit, overdue}]（自己負責、0～10 天內或已過採收日還沒結案）
     首頁最上面紅色提醒條「X 位農民快採收，請到現場」，點了展開清單，點一位開那位的田間打卡；
     「今天先收起」記在手機（哪一天、哪個帳號、當時有誰），隔天、換人、或多了新的人就再跳；舊後台沒這欄就不顯示 */
  /** 要不要跳：有人、而且今天這個帳號沒收起過（或收起後多了新的人） */
  function harvestShow(list, seen, account, today) {
    if (!Array.isArray(list) || !list.length) return false;
    if (!seen || seen.day !== today || seen.account !== account) return true;
    const ids = seen.ids || [];
    return list.some(x => ids.indexOf(String(x.cid)) < 0);
  }
  /** 0.4.87 中3：剩幾天用預計採收日跟手機的今天（緬甸日期）重算——同步當下的 daysLeft 離線幾天後會過期；採收日壞掉才退回 daysLeft；都沒有就回 null（不寫 NaN） */
  function harvestDaysLeft(x) {
    const hd = String(x.harvestDate || '').slice(0, 10), t = mmDay(0);
    if (/^\d{4}-\d\d-\d\d$/.test(hd) && isFinite(Date.parse(hd))) return Math.round((Date.parse(hd) - Date.parse(t)) / 86400000);
    const n = x.daysLeft === '' || x.daysLeft == null ? NaN : Number(x.daysLeft);
    return isFinite(n) ? n : null;
  }
  function harvestItemHtml(x) {
    const left = harvestDaysLeft(x);
    const lv = latestVisitDay(x.lastVisit, x.cid, state.myVisitList); // 0.4.84 低1：剛拜訪完、後台還沒更新也算
    const when = left === null ? '' : left < 0 ? `<b class="vage r">已過採收日 ${Math.abs(left)} 天</b>` : left === 0 ? '<b class="vage r">今天採收</b>' : `<b class="vage ${left <= 3 ? 'r' : 'y'}">剩 ${left} 天</b>`;
    return `<li data-cid="${esc(x.cid)}"><b>${esc(x.name || '（未命名）')}</b>${x.crop ? '｜' + esc(x.crop) : ''}<br>`
      + `<small>預計採收 ရိတ်သိမ်းမည့်ရက် ${esc(String(x.harvestDate || '').slice(5).replace('-', '/'))}</small>${when ? '・' + when : ''}<br>`
      + `<small>最後拜訪 ${lv ? esc(lv.slice(5).replace('-', '/')) : '還沒拜訪'}</small></li>`;
  }
  /* 0.4.82 董事長「快採收紅色提醒條能讓手機發出響聲嗎」：提醒條出現（有新的、今天沒收起）時嗶一聲（Web Audio 產生約 0.5 秒，不用外部音檔）＋震動 [200,100,200]（有才呼叫，iPhone 沒有就略過）。
     首頁常重畫（每次同步）→ 另外記「今天已經為哪些人響過」（harvestBeeped，跟收起用的 harvestSeen 同一套判斷）：同一天同一份名單只響一次，多了新的人才再響。
     瀏覽器擋自動播放（還沒碰過畫面）：等使用者第一次點畫面時補播一次。全部包 try，失敗不影響畫面 */
  const BEEP_GESTURES = ['pointerdown', 'touchstart', 'keydown'];
  function harvestBeep() {
    let AC = null;
    try { AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext); } catch (e) { AC = null; }
    const buzz = () => { try { if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate([200, 100, 200]); } catch (e) { /* 震動失敗不影響畫面 */ } };
    if (!AC) { buzz(); return 'noaudio'; }
    let ac;
    try { ac = new AC(); } catch (e) { buzz(); return 'noaudio'; }
    const play = () => {
      try {
        const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.5);
        o.onended = () => { try { ac.close(); } catch (e) { /* 關不掉沒關係 */ } };
      } catch (e) { /* 播不出來不影響畫面 */ }
      buzz();
    };
    if (ac.state !== 'suspended') { play(); return 'played'; }
    // 還沒碰過畫面：瀏覽器把聲音暫停 → 等第一次點畫面再補播一次
    const once = () => {
      try { BEEP_GESTURES.forEach(t => document.removeEventListener(t, once, true)); } catch (e) { /* 拿不掉也只會多播一次 */ }
      try { Promise.resolve(ac.resume()).then(play, () => {}); } catch (e) { /* 播不出來不影響畫面 */ }
    };
    try { BEEP_GESTURES.forEach(t => document.addEventListener(t, once, true)); } catch (e) { /* 掛不上就算了 */ }
    return 'waiting';
  }
  /** 要不要響：今天這個帳號還沒為這些人響過（多了新的人也算）→ 響、記下來 */
  async function harvestAlert(list, account, today) {
    try {
      const beeped = await Store.getMeta('harvestBeeped');
      if (!harvestShow(list, beeped, account, today)) return false;
      await Store.setMeta('harvestBeeped', { day: today, account, ids: list.map(x => String(x.cid)) });
      harvestBeep();
      return true;
    } catch (e) { return false; } // 響不了不影響提醒條
  }
  async function renderHarvest(h) {
    const bar = document.getElementById('harvestBar');
    if (!bar) return; // 舊頁面沒有這一塊
    const list = h && Array.isArray(h.harvestSoon) ? h.harvestSoon : null; // 舊後台沒有這欄：不顯示
    const cfg = (await getConfig()) || {}, today = mmDay(0);
    const seen = await Store.getMeta('harvestSeen');
    if (!harvestShow(list, seen, String(cfg.account || ''), today)) { bar.hidden = true; return; }
    bar.hidden = false;
    await harvestAlert(list, String(cfg.account || ''), today); // 0.4.82 提醒條出現時嗶一聲＋震動（同一天同一份名單只響一次）
    const head = $n('harvestHead'), ul = $n('harvestList');
    head.innerHTML = `⚠ ${list.length} 位農民快採收，請到現場${state.harvestOpen ? '　▴' : '　▾'}<span class="my">လယ်သမား ${list.length} ဦး ရိတ်သိမ်းခါနီး၊ ကွင်းဆင်းပါ</span>`;
    head.setAttribute('aria-expanded', String(!!state.harvestOpen));
    ul.hidden = !state.harvestOpen;
    ul.innerHTML = state.harvestOpen ? list.map(harvestItemHtml).join('') : '';
    ul.querySelectorAll('li[data-cid]').forEach(li => { li.onclick = () => openFromList(li.dataset.cid, '農民'); });
    head.onclick = () => { state.harvestOpen = !state.harvestOpen; renderHarvest(h); }; // onclick：重畫不會疊好幾個
    $n('harvestHide').onclick = async () => {
      await Store.setMeta('harvestSeen', { day: today, account: String(cfg.account || ''), ids: list.map(x => String(x.cid)) });
      state.harvestOpen = false; bar.hidden = true;
    };
  }

  async function renderHome() {
    const h = (await Store.getMeta('home')) || null;
    state.myVisitList = await myVisits(); // 0.4.84 低1：這支手機自己帳號的拜訪，算最後拜訪日用（下拉、快採收、日程、量測週都用 latestVisitDay）
    const today = await phoneToday(h); // 0.4.87 低3：先校正手機時間（phoneToday 會設 state.clockOff），再畫快採收（剩幾天、今天響過沒都用 mmDay）
    await renderHarvest(h); // 0.4.82 快採收提醒條
    const list = (h ? h.schedule : []).map(s => Object.assign({}, s, { late: s.due < today })); // 逾期用手機的今天重算
    const lastOf = {}; ((await Store.getMeta('farmers')) || []).forEach(f => { lastOf[f.id] = latestVisitDay(f.lastVisit, f.id, state.myVisitList); }); // 0.4.82 日程那列加「距上次拜訪 N 天」；0.4.84 低1 合併這支手機的拜訪
    const soon = {}; ((h && Array.isArray(h.harvestSoon)) ? h.harvestSoon : []).forEach(x => { soon[x.cid] = true; }); // 0.4.82 日程裡快採收的人加標籤
    $('scheduleList').innerHTML = list.map(s => `<li class="go" data-id="${esc(s.id)}" data-type="${esc(s.type)}"><span>${esc(s.name)}<br><small>${esc(catBi(s.type || '農民'))}・應回訪 ပြန်သွားရန် ${esc(s.due.slice(5).replace('-', '/'))}</small><br>${visitAgeHtml(lastOf[s.id], today)}${soon[s.id] ? ' <span class="pill late">快採收 ရိတ်သိမ်းခါနီး</span>' : ''}</span>${s.late ? '<span class="pill late">逾期 ရက်ကျော်</span>' : s.due === today ? '<span class="pill wait">今天 ယနေ့</span>' : ''}</li>`).join('')
      || `<li class="empty">${h ? '這 7 天沒有排到回訪／၇ ရက်အတွင်း သွားရန် မရှိ' : '連上網路後會顯示／အင်တာနက်ချိတ်ပြီးမှ ပြမည်'}</li>`;
    $('scheduleList').querySelectorAll('li.go').forEach(li => li.addEventListener('click', () => {
      openFromList(li.dataset.id, li.dataset.type); // 0.4.63 從清單進來也鎖死類別（先算好是一般／試作／推廣）
    }));
    await renderTasks();
    await renderMyTrials(h);
    await fillCloseFarmers();
    renderTodoCust(); // 0.4.82 執行任務清單左欄：五類自己負責的客戶
    fillPlantFarmers(); // 0.4.59 種植資料分頁共用同一份「自己負責的農民」
    renderReports(); // 0.4.61 試作報告：按過「看試作報告」才有清單，首頁重畫時照舊顯示
    // 月計劃（2C）
    const plan = (h && h.plan) || [];
    $('planList').innerHTML = plan.map(p => `<li class="plan"><span>${esc(p.label)}<br><small>${esc(p.period)}　${p.done}／${p.target}</small>
      <span class="bar"><i style="width:${Math.max(0, Math.min(100, p.pct))}%"></i></span></span>${p.done >= p.target ? '<span class="pill ok">達成 ပြည့်မီ</span>' : `<span class="pill wait">${esc(String(p.done))}／${esc(String(p.target))}</span>`}</li>`).join('') /* 0.4.82 董事長：不顯示 %，只留 done／target；進度條保留 */
      || `<li class="empty">${h && h.plan ? '這個月沒有訂目標／ဤလ ပစ်မှတ် မရှိ' : '連上網路後會顯示／အင်တာနက်ချိတ်ပြီးမှ ပြမည်'}</li>`; // 舊版留下的首頁資料沒有計劃欄，不能說成沒有目標（第五輪自抓）
    // 0.4.63 執行任務清單右欄「我的進度」：本月拜訪次數＋月計劃（跟我的進度分頁同一份）
    const tp = document.getElementById('todoPlan');
    if (tp) tp.innerHTML = (h ? `<li class="plan"><span>本月拜訪 ${esc(String(h.monthVisits == null ? '—' : h.monthVisits))} 次・新增客戶 ${esc(String(h.newCustomers == null ? '—' : h.newCustomers))} 位<br><small>ဤလ သွားရောက်မှု・ဖောက်သည်အသစ်</small></span></li>` : '') + $('planList').innerHTML;
    renderNewCust(h); // 0.4.72（1號）本月新增客戶五類＋明細
    // 工作進度：最近 3 個月可以切換
    const hist = (h && h.history) || [];
    if (!hist.some(x => x.month === state.homeMonth)) state.homeMonth = hist.length ? hist[0].month : '';
    $('monthChips').innerHTML = hist.map(x => `<button type="button" class="chip" data-m="${esc(x.month)}" aria-pressed="${x.month === state.homeMonth}">${Number(x.month.slice(5))} 月／လ</button>`).join('');
    $('monthChips').querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => { state.homeMonth = b.dataset.m; renderHome(); }));
    const cur = hist.find(x => x.month === state.homeMonth);
    $('statVisits').textContent = cur ? cur.visits : (h ? h.monthVisits : '—');
    $n('msVisits').textContent = h && h.monthVisits != null ? String(h.monthVisits) : '—'; // 0.4.69 最上面一排：本月拜訪（不跟著月份切換）
    $('statNew').textContent = cur ? cur.newCustomers : (h ? h.newCustomers : '—');
    $('statCust').textContent = cur ? cur.customersVisited : '—';
    $('statTrials').textContent = cur ? `${cur.trialsStarted}／${cur.trialsEnded}` : '—';
    renderMonthDetail(cur); // 0.4.82 新增客戶、試作兩格的分類和明細（舊後台沒有明細就照舊）
    const bc = cur ? cur.byCategory : (h && h.byCategory) || {};
    $('statByCat').textContent = Object.keys(bc || {}).length ? '類別 အမျိုးအစား：' + Object.entries(bc).map(([k, n]) => `${catBi(k)} ${n} 次`).join('、') : '';
    if (h && h.syncedAt) { const d = new Date(h.syncedAt); $('homeSynced').textContent = `（${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())} 更新 အပ်ဒိတ်）`; }
  }

  /** 我的試作：伺服器給的進行中試作（只取負責業務是自己的）＋這支手機開了還沒上傳的；這支手機結束的不顯示。
      都是手機裡存的資料，離線也看得到（2026-11-12 董事長同意介面規劃 D） */
  async function renderMyTrials(h) {
    const cfg = await getConfig();
    const me = cfg ? String(cfg.name || '') : '';
    const server = (await Store.getMeta('trials')) || [];
    const local = (await Store.getMeta('localTrials')) || [];
    const ended = new Set(local.filter(l => l.ended).map(l => l.id));
    // 手機記的「已結束」可能是臨時編號（離線開始又結束、只有開始傳上去）：伺服器的試作要連臨時編號一起比（第二輪自行審查 T3）
    const list = server.filter(t => me && t.staff === me && !ended.has(t.id) && !(t.temps || []).some(x => ended.has(x)))
      .concat(local.filter(l => !l.ended && l.cid && !server.some(t => t.id === l.id)));
    const people = ((await Store.getMeta('farmers')) || []).concat((await Store.getMeta('localCustomers')) || []);
    const nameOf = cid => (people.find(f => f.id === cid) || {}).name || cid;
    const today = await phoneToday(h);
    const isDay = s => /^\d{4}-\d\d-\d\d/.test(String(s || ''));
    const dayDiff = (a, b) => Math.round((Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / 86400000);
    const week = s => (isDay(s) ? Math.max(1, Math.ceil(dayDiff(s, today) / 7)) : null);
    // 最後拜訪日：伺服器的＋這支手機自己存的拜訪（還沒同步的也算，剛量完不會還叫你去量）
    const mine = await myVisits(); // 低#6（第8任）：只算目前帳號的
    const localDay = ms => mmDay(0, ms); // 業務BUG#4：拜訪日也用緬甸日期，跟伺服器的最後拜訪日同一把尺
    const lastOf = cid => latestVisitDay((people.find(f => f.id === cid) || {}).lastVisit, cid, mine); // 0.4.84 改用共用的 latestVisitDay（同一套：後台與這支手機取較新）
    /** 量測週：開始後第 2、4、8 週（boss.js 有同一組數字，要改兩邊一起改；2026-11-12 優化 4） */
    const measure = t => {
      if (!isDay(t.start)) return null;
      const w = [2, 4, 8].filter(x => dayDiff(t.start, today) >= x * 7).pop();
      if (!w) return null;
      const due = new Date(Date.parse(String(t.start).slice(0, 10)) + (w * 7 - 3) * 86400000).toISOString().slice(0, 10);
      const lv = lastOf(t.cid);
      return !lv || lv < due ? w : null;
    };
    $('trialList').innerHTML = list.map(t => { const w = week(t.start), m = measure(t); return `<li class="go" data-cid="${esc(t.cid)}" data-cat="${esc(t.cat || '試作')}"><span>${esc(nameOf(t.cid))}<br><small>${esc(catBi(t.cat || '試作'))}・${esc(t.item || '—')}${t.pending ? '（未上傳）မတင်ရသေး' : ''}</small></span>${m ? `<span class="pill late">第 ${m} 週該量測<br>အပတ် ${m} တိုင်းရန်</span>` : w ? `<span class="pill wait">第 ${w} 週<br>အပတ် ${w}</span>` : ''}</li>`; }).join('')
      || `<li class="empty">${h ? '目前沒有進行中的試作／လုပ်ဆောင်ဆဲ စမ်းသပ်ကွက် မရှိ' : '連上網路後會顯示／အင်တာနက်ချိတ်ပြီးမှ ပြမည်'}</li>`;
    $('trialList').querySelectorAll('li.go').forEach(li => li.addEventListener('click', () => { state.lockNext = true; openVisit(li.dataset.cat === '推廣' ? '推廣' : '試作', li.dataset.cid); })); // 0.4.63 鎖死
    const ms = $('msTrials'); if (ms) ms.textContent = String(list.length); // 0.4.69 最上面一排：進行中試作（舊頁面沒有這格就不畫）
  }

  /**
   * 手機的「今天」（緬甸日期）：手機時間＋伺服器校正值換成緬甸時間（UTC+6:30）。
   * 原本用上次同步時伺服器給的日期，離線幾天後週數、該量測、逾期都不會往前走（第二輪自行審查 T9）。
   * 從來沒同步過（沒有校正值）才用伺服器給的日期
   */
  async function phoneToday(h) {
    const off = await Store.getMeta('clockOffset');
    if (typeof off === 'number') state.clockOff = off; // 業務BUG#4：給同步用的 mmDay 用
    if (typeof off !== 'number' && h && h.today) return h.today;
    return new Date(Date.now() + (Number(off) || 0) + 6.5 * 3600000).toISOString().slice(0, 10);
  }
  /**
   * 業務BUG#4（1號 2026-11-12）：同步版的「緬甸今天＋N 天」（手機時間＋伺服器校正值換成 UTC+6:30）。
   * 原本用 new Date() 取手機當地日期：手機時區不是緬甸時，選「明天」會被後台（用緬甸日期比）判成今天而丟掉。
   * ms 有給就換算那個時間點的緬甸日期（手機記的拜訪時間）
   */
  const mmDay = (addDays, ms) => new Date((ms == null ? Date.now() : Number(ms)) + (Number(state.clockOff) || 0) + 6.5 * 3600000 + (addDays || 0) * 86400000).toISOString().slice(0, 10);

  /* ───── 農民任務：主管派、業務打勾（離線也能勾，有網路再送） ───── */
  async function renderTasks() {
    const tasks = (await Store.getMeta('tasks')) || [];
    const tickList = (await Store.getMeta('taskDone')) || [];
    const ticked = new Set(tickList.map(t => t.id));
    const sending = new Set(tickList.filter(FarmCore.isLocked).map(t => t.id)); // 送出中或上次結果未確認：都不能取消（R6-05、R7-02）
    const unconf = new Set(tickList.filter(t => t.unconfirmed && !FarmCore.isSending(t)).map(t => t.id));
    const open = tasks.filter(t => t.status === '待辦');
    const done = tasks.filter(t => t.status === '已完成');
    // 0.4.24：後台送來的客戶名單不含「已結束」的客戶，這些客戶的任務按「去拜訪」會找不到人（選農民欄空白）→ 改標「客戶已結案」。
    // 還沒拿到客戶名單（沒同步過）時不判斷，照舊給「去拜訪」，免得每條都被誤標
    const farmers = await Store.getMeta('farmers');
    const known = Array.isArray(farmers) && farmers.length
      ? new Set(farmers.concat((await Store.getMeta('localCustomers')) || []).map(f => f.id)) : null;
    const closed = t => !!(known && t.cid && !known.has(t.cid));
    // 0.4.25（第5任獨立審查 低2）：任務的客戶是盤商或種子商時，用對應的類別打開，不然選單只列農民、找不到人
    const all = (farmers || []).concat((await Store.getMeta('localCustomers')) || []);
    const catOf = cid => { const ty = (all.find(f => f.id === cid) || {}).type; return ty === '盤商' || ty === '種子商' ? ty : '農戶'; };
    const row = (t, isDone) => {
      const wait = !isDone && ticked.has(t.id);
      const busy = wait && sending.has(t.id); // 送出中：請求已經在路上，不能取消（R6-05）
      return `<li class="task${isDone || wait ? ' done' : ''}"><label><input type="checkbox" data-task="${esc(t.id)}"${isDone || wait ? ' checked' : ''}${isDone || busy ? ' disabled' : ''}>
        <span><b>${esc(t.name)}</b>：${esc(t.text)} ${isDone ? '<span class="pill ok">已完成 ပြီးပြီ</span>' : wait ? '<span class="pill wait">已打勾 ခြစ်ပြီး</span>' : '<span class="pill late">還沒做 မလုပ်ရသေး</span>'}<br><small>${isDone ? '已完成 ပြီးပြီ ' + esc(String(t.doneAt || '').slice(5, 16)) + '<br>' : busy && unconf.has(t.id) ? '已送出，等連上網路確認（不能取消）／ပို့ပြီး၊ အတည်ပြုချက် စောင့်နေ (ပယ်ဖျက်၍ မရ)<br>' : busy ? '送出中…（送出後就不能取消）／ပို့နေသည် (ပယ်ဖျက်၍ မရ)<br>' : wait ? '已打勾，有網路會自動送出（再按一下可取消）／အမှန်ခြစ်ပြီး၊ အင်တာနက်ရလျှင် ပို့မည် (ထပ်နှိပ်လျှင် ပယ်ဖျက်)<br>' : ''}${esc(t.by || '主管') + ' 派 ပေးသည်・' + esc(String(t.at || '').slice(0, 16).replace('T', ' '))}</small></span></label>
        ${isDone ? '' : closed(t) ? '<small class="taskclosed">找不到這位客戶（可能已結案）：做完直接打勾，不用做請主管取消／ဖောက်သည် မတွေ့ပါ</small>' : `<button type="button" class="btn2 small" data-taskgo="${esc(t.cid)}">去拜訪<br>သွားမည်</button>`}</li>`;
    };
    // 0.4.63 董事長：一邊看主管派的任務、一邊看自己的進度 → 上面一行總結＋進度條
    const sum = document.getElementById('taskSummary');
    if (sum) {
      const waitN = open.filter(t => ticked.has(t.id)).length, all0 = open.length + done.length;
      const pct = all0 ? Math.round(done.length / all0 * 100) : 0;
      sum.hidden = !all0;
      // 2號 0.4.63 低#10：後台只回「沒做完＋近 7 天做完」的任務，不是全部 → 字寫清楚，不說成「派了 N 條」
      sum.innerHTML = all0 ? `沒做完＋近 7 天做完的共 <b>${all0}</b> 條：已完成 <b>${done.length}</b>、已打勾等送出 <b>${waitN}</b>、還沒做 <b>${open.length - waitN}</b>／ပြီး ${done.length}・မလုပ်ရသေး ${open.length - waitN}<span class="bar"><i style="width:${pct}%"></i></span>` : '';
    }
    $('taskList').innerHTML = open.map(t => row(t, false)).join('') + done.map(t => row(t, true)).join('')
      || `<li class="empty">${(await Store.getMeta('home')) ? '目前沒有派給你的任務／ပေးထားသော အလုပ် မရှိ' : '連上網路後會顯示／အင်တာနက်ချိတ်ပြီးမှ ပြမည်'}</li>`;
    $('taskList').querySelectorAll('input[data-task]').forEach(cb => cb.addEventListener('change', () => toggleTask(cb.dataset.task, cb.checked)));
    $('taskList').querySelectorAll('[data-taskgo]').forEach(b => b.addEventListener('click', () => openFromList(b.dataset.taskgo, catOf(b.dataset.taskgo)))); // 0.4.63 鎖死
    // 0.4.26：分頁標籤上顯示還沒做（也還沒打勾）的任務數
    const left = open.filter(t => !ticked.has(t.id)).length;
    $('todoBadge').textContent = left ? String(left) : '';
    $('todoBadge').hidden = !left;
    renderAssigned(tasks, ticked);
  }
  /** 指派任務分頁（0.4.26）：主管、總經理派給我的任務紀錄，新派的在前面；只看不勾，打勾在「執行任務清單」 */
  function renderAssigned(tasks, ticked) {
    if (!document.getElementById('assignedList')) return; // 0.4.63 指派任務紀錄併進上面的任務清單（每條都有誰派、何時、狀態），新頁面沒有這一塊
    const list = tasks.filter(t => t.status === '待辦' || t.status === '已完成')
      .sort((a, b) => (a.status === b.status ? String(b.at || '').localeCompare(String(a.at || '')) : a.status === '待辦' ? -1 : 1));
    const state1 = t => (t.status === '已完成' ? `<span class="pill ok">已完成 ပြီးပြီ ${esc(String(t.doneAt || '').slice(5, 10))}</span>`
      : ticked.has(t.id) ? '<span class="pill wait">已打勾，等送出 ပို့ရန်</span>' : '<span class="pill late">還沒做 မလုပ်ရသေး</span>');
    $('assignedList').innerHTML = list.map(t => `<li class="assigned"><b>${esc(t.name)}</b>：${esc(t.text)} ${state1(t)}
      <span class="meta">${esc(t.by || '主管')} 派 ပေးသည်・${esc(String(t.at || '').slice(0, 16).replace('T', ' '))}</span></li>`).join('')
      || '<li class="empty">目前沒有派給你的任務／ပေးထားသော အလုပ် မရှိ</li>';
  }
  async function toggleTask(id, on) {
    const cfg = await getConfig();
    const at = Date.now() + ((await Store.getMeta('clockOffset')) || 0);
    if (on) {
      // 同一任務只留最新的一次打勾；正在送出的那一次不動（R4-03、R6-05）
      await updateTaskDone(list => (list.some(t => t.id === id && FarmCore.isLocked(t)) ? list : list.filter(t => t.id !== id).concat([{ id, at, account: (cfg && cfg.account) || '' }])));
    } else {
      const r = await FarmCore.untickTask(id); // 送出中不能取消（R6-05）
      if (!r.ok) toast(r.message);
    }
    await renderTasks();
    if (on) { requestBackgroundSync(); syncNow(); } // 登記背景同步：網頁關掉後有網路也會補送（R6-04）
  }

  /* ───── 選單資料（作物、品種、肥料、品牌、地區） ───── */
  async function loadOptions() {
    const o = state.options = (await Store.getMeta('options')) || { regions: [], crops: [], varieties: [], fertilizers: [], brands: [], areaUnit: '英畝', priceUnit: '緬幣／籃' };
    const opt = arr => arr.map(x => `<option value="${esc(x)}"></option>`).join('');
    $('dlCrops').innerHTML = opt(o.crops);
    refreshPriceCrops(); // 0.4.89 價格列作物下拉：先建好的列補上作物選項
    $('dlFerts').innerHTML = opt(o.fertilizers);
    $('dlBrands').innerHTML = opt(o.brands);
    const keep = $('pArea').value;
    $('pArea').innerHTML = '<option value="">— 選擇地區 ဒေသရွေးပါ —</option>' + o.regions.map(x => `<option>${esc(x)}</option>`).join('');
    $('pArea').value = keep;
    document.querySelectorAll('.unit').forEach(el => { el.textContent = `（${o.areaUnit}）`; });
    document.querySelectorAll('.cunit-price').forEach(el => { el.textContent = `（${o.priceUnit || '緬幣／籃'}）`; });
    document.querySelectorAll('.cunit-yield').forEach(el => { el.textContent = `（${o.yieldUnit || '籃'}）`; });
    const keepR = $('cRegion').value;
    $('cRegion').innerHTML = '<option value="">— 選擇地區 ဒေသရွေးပါ —</option>' + o.regions.map(x => `<option>${esc(x)}</option>`).join('');
    $('cRegion').value = keepR;
    fillCrops($('pCrop').value);
    fillVarieties();
    // 0.4.33：後台開了「結案要主管確認」時，結案提示改寫
    $('closeHint').innerHTML = o.closeConfirm
      ? '只能選自己負責的農民。送出後要等<b>主管確認</b>才算結案（確認後不再提醒回訪）；主管退回就當沒結案。<br>ကိုယ်တာဝန်ယူထားသော လယ်သမားသာ ရွေးနိုင်သည်။ မန်နေဂျာ အတည်ပြုမှ ပိတ်သိမ်းမည်။'
      : '只能選自己負責的農民。存檔後這位農民就結案（不再提醒回訪）。<br>ကိုယ်တာဝန်ယူထားသော လယ်သမားသာ ရွေးနိုင်သည်။';
    // 2號 0.4.63 小事（第8任）：盤商、種子商結案提示原本寫死「要等主管確認」，後台其實跟農民一樣看設定（Code.gs 盤商結案也用 closeNeedsConfirm_）
    $n('dcHint').innerHTML = o.closeConfirm
      ? '送出後要等主管確認才算結案；主管退回就照常往來。<br><span class="my">မန်နေဂျာ အတည်ပြုမှ ပိတ်သိမ်းမည်။</span>'
      : '送出後就結案（洽談成功、失敗都會記下來）。<br><span class="my">သိမ်းပြီးလျှင် ပိတ်သိမ်းမည်။</span>';
  }
  /**
   * 作物、品種改成下拉選單（董事長 2026-11-12 手稿：作物有選單可選；品種＝公司名＋代碼，有選單）。
   * 選項由主管在試算表「選單」分頁維護；品種的「值」寫成「公司名 品種名（代碼）」，存進客戶資料的就是整串。
   * 舊客戶原本手打、選單裡沒有的值，照樣放進選單顯示，不會被清掉
   */
  function setSelect(el, items, value, placeholder) {
    const list = items.slice();
    if (value && !list.some(x => x.value === value)) list.push({ value, text: value + '（舊資料 ဟောင်း）' });
    el.innerHTML = `<option value="">${placeholder}</option>` + list.map(x => `<option value="${esc(x.value)}">${esc(x.text)}</option>`).join('');
    el.value = value || '';
  }
  /* 0.4.40 董事長：作物選單顯示「中文／緬文」（存檔的值照舊是中文）。緬文出處見狀態檔；青花菜、洋香瓜網路查不到確證，待緬甸同仁校對 */
  const CROP_MY = { 番茄: 'ခရမ်းချဉ်သီး', 西瓜: 'ဖရဲသီး', 南瓜: 'ရွှေဖရုံသီး', 絲瓜: 'သပွတ်သီး', 茄子: 'ခရမ်းသီး', 苦瓜: 'ကြက်ဟင်းခါးသီး',
    辣椒: 'ငရုတ်သီး', 玉米: 'ပြောင်းဖူး', 花椰菜: 'ပန်းဂေါ်ဖီ', 青花菜: 'ပန်းဂေါ်ဖီစိမ်း', 洋香瓜: 'သခွားမွှေးသီး', 扁蒲: 'ဘူးသီး', 水稻: 'စပါး' };
  const cropText = c => (CROP_MY[c] && !/[က-႟]/.test(c) ? `${c}／${CROP_MY[c]}` : c); // 試算表已經寫了緬文的不重複加
  function fillCrops(keep) {
    const crops = (state.options ? state.options.crops : []).map(c => ({ value: c, text: cropText(c) }));
    crops.push({ value: '其他', text: '其他／အခြား' });
    setSelect($('pCrop'), crops, keep, '— 選擇作物 သီးနှံရွေးပါ —');
    fillDealerCrop($n('pDCrop').value);
  }
  /* 0.4.89 董事長截圖：試作品項改成下拉＝作物選項（options.crops，同新增客戶作物下拉、中文／緬文），最後「其他（自己填）」選了才出現文字框 */
  const TRIAL_OTHER = '__other';
  function fillTrialItems() {
    const sel = $n('tItem');
    const crops = (state.options ? state.options.crops || [] : []).map(c => ({ value: c, text: cropText(c) }));
    const keep = sel.value;
    sel.innerHTML = '<option value="">— 選擇品項 ရွေးပါ —</option>' + crops.map(x => `<option value="${esc(x.value)}">${esc(x.text)}</option>`).join('')
      + `<option value="${TRIAL_OTHER}">其他（自己填）／အခြား (ကိုယ်တိုင်ဖြည့်)</option>`;
    sel.value = keep && (keep === TRIAL_OTHER || crops.some(x => x.value === keep)) ? keep : '';
    refreshTrialOther();
  }
  function refreshTrialOther() { const o = $n('tItemOther'); o.hidden = $n('tItem').value !== TRIAL_OTHER; if (o.hidden) o.value = ''; }
  /** 送出的試作品項（欄位名照舊是 item）：選了作物就是作物；選「其他」就是自己填的字（沒填＝空白，必填檢查會擋） */
  const trialItemValue = () => { const v = String($n('tItem').value || ''); return v === TRIAL_OTHER ? String($n('tItemOther').value || '').trim() : v.trim(); };
  /** 0.4.73 董事長：盤商、種子商新增表單「品牌」改成作物下拉（跟農民同一份作物清單）；選單沒有的寫在下面「其他」 */
  function fillDealerCrop(keep) {
    const el = $n('pDCrop'); if (!el.id) return; // 舊頁面沒有這格（$n 給的假元件）就不畫
    const crops = (state.options ? state.options.crops : []).map(c => ({ value: c, text: cropText(c) }));
    setSelect(el, crops, keep, '— 選擇作物 သီးနှံရွေးပါ —');
  }
  /** 品種屬於哪間種子公司：品種的值寫成「公司名 品種名（代碼）」，看開頭是不是公司名 */
  const coOf = (name, cos) => cos.find(c => name === c || String(name).indexOf(c + ' ') === 0) || '';
  function fillVarieties(keep) {
    const crop = $('pCrop').value.trim();
    const all = state.options ? state.options.varieties : [];
    const cos = (state.options && state.options.seedCompanies) || [];
    const value = keep === undefined ? $('pVariety').value : keep;
    // 0.4.31：先選種子公司。帶進舊資料（keep）時從品種名稱推回公司；選單沒有公司時這一欄藏起來，照舊只選品種
    let co = keep !== undefined && value ? coOf(value, cos) : $('pVarCo').value;
    // 0.4.50 董事長：「一般農民用其他公司的種子，試作、推廣用農友的種子」→ 公司選單跟著類別：一般拜訪不列農友，試作／推廣只列農友（只有一間就直接選好）
    const isKY = c => /known-?you|農友/i.test(String(c));
    const own = state.cat === '試作' || state.cat === '推廣';
    const shown = own ? cos.filter(isKY) : state.cat === '農戶' ? cos.filter(c => !isKY(c)) : cos;
    const list0 = shown.length ? shown : cos; // 選單沒有農友時照舊全列，不會變成空的
    // 自動帶公司只對「新增客戶」：舊客戶存好的公司不能被偷改（不然存檔會被當成改了資料）
    if (keep === undefined && $('farmer').value === '__new') {
      if (own && list0.length === 1 && !isKY(co)) co = list0[0];
      else if (state.cat === '農戶' && isKY(co)) co = '';
    } else if (own && !co && list0.length === 1 && $('farmer').value === '__new') co = list0[0];
    setSelect($('pVarCo'), list0.map(c => ({ value: c, text: c })), cos.indexOf(co) >= 0 ? co : '', '— 全部公司 ကုမ္ပဏီအားလုံး —');
    $('pVarCo').parentElement.hidden = !cos.length;
    const cur = $('pVarCo').value;
    // 選了作物就只列那個作物的品種；作物是「其他」或沒選，就全部列。選了公司就只列那間公司的，選單上省略公司名
    const list = all.filter(v => (!crop || crop === '其他' || !v.crop || v.crop === crop) && (!cur || coOf(v.name, [cur])))
      .map(v => ({ value: v.name, text: cur ? (v.name.slice(cur.length).trim() || v.name) : v.name }));
    setSelect($('pVariety'), list, value, '— 選擇品種 မျိုးရွေးပါ —');
  }

  /* ───── 拜訪畫面 ───── */
  const isDealerCat = () => state.cat === '盤商' || state.cat === '種子商';

  /** 打卡畫面上方的類別切換：農民一組、盤商或種子商一組（2026-11-12 董事長同意優化 1：首頁少點一層） */
  const CAT_GROUPS = { farmer: ['農戶', '試作', '推廣', '結案'], dealer: ['盤商', '種子商'] }; // 結案：農民收成賣掉後（2026-11-12 手稿）
  const groupOf = c => (CAT_TYPES[c][0] === '農民' ? 'farmer' : 'dealer');
  function applyCatLabels() {
    const cat = state.cat;
    $('visitTitle').textContent = isDealerCat() ? '盤商或種子商 ကုန်သည် / မျိုးစေ့ဆိုင်'
      : cat === '結案' && closeGroupNow() ? `${closeGroupNow()}結案 ပိတ်သိမ်း` : '農民 လယ်သမား'; // 0.4.73 結案標出是哪一種農民；0.4.75 低3 選了農民後依實際分類
    $('farmerLab').innerHTML = isDealerCat() ? `選擇${cat}<span class="my">${cat === '種子商' ? 'မျိုးစေ့ဆိုင်' : 'ကုန်သည်'} ရွေးပါ</span>` : '選擇農民<span class="my">လယ်သမား ရွေးပါ</span>';
    $('priceBox').hidden = cat !== '盤商' || !!state.dealerClose; // 0.4.41 董事長：種子商那邊不需要價格，只有盤商有
    document.querySelectorAll('.dealer-only').forEach(el => { el.hidden = !isDealerCat(); });
    document.querySelectorAll('.farmer-only').forEach(el => { el.hidden = isDealerCat(); });
    $('closeBox').hidden = cat !== '結案';
    // 第8任 2026-11-12 董事長「要加錄音」（1號 TEST2 實測發現）：農民結案原本藏錄音鈕（當初設計只拍結案手稿），
    // 盤商、種子商結案卻有 → 統一都能錄音；後台存錄音本來就不分類別（Code.gs 錄音連結），不用改
    $('recBtn').hidden = false;
    $('pNameLab').innerHTML = isDealerCat() ? `${cat}名字（公司）<span class="my">${CAT_MY[cat]} အမည် (ကုမ္ပဏီ)</span>` : '農民名字<span class="my">လယ်သမား အမည်</span>';
    // 0.4.32 董事長 2026-11-12：打卡畫面上方按鈕寫「一般拜訪農民／試作農民／推廣農民」（只改這裡，統計、紀錄照舊叫一般拜訪、試作、推廣）
    const SWITCH_LABEL = { 農戶: '一般拜訪農民', 試作: '試作農民', 推廣: '推廣農民' };
    $('catSwitch').dataset.group = groupOf(cat);
    // 0.4.40 董事長：結案不放上方，改成畫面最下面的「結案（送主管審核）」；在結案畫面時同一顆按鈕變「取消結案」
    if (groupOf(cat) !== 'dealer') state.dealerClose = false; // 0.4.42 盤商、種子商的結案模式只在那一組
    $n('dealerCloseBox').hidden = !(state.dealerClose || dealerSignOn()); // 0.4.75 勾了已簽約也打開
    // 0.4.57 董事長：結案入口搬到首頁「我的進度」→ 打卡畫面最下面只在結案畫面出現「取消結案」
    $n('closeModeBtn').hidden = !(cat === '結案' || state.dealerClose);
    $n('closeModeBtn').innerHTML = '← 取消結案<span class="my">ပိတ်သိမ်းမှု ပယ်ဖျက်</span>';
    $n('noteLab').innerHTML = isDealerCat() ? '匯報紀錄<span class="my">အစီရင်ခံ မှတ်တမ်း</span>' /* 0.4.52 */ : '跟農民聊了什麼<span class="my">လယ်သမားနှင့် ပြောခဲ့သည်များ</span>'; // 0.4.58 董事長 // 0.4.42 董事長：盤商、種子商有見到就記討論進度
    $('saveBtn').innerHTML = cat === '結案' || state.dealerClose ? '結案送主管審核（自動上傳）<span class="my">မန်နေဂျာ စစ်ဆေးရန် ပို့မည်</span>' : '儲存（自動上傳）<span class="my">သိမ်းမည်</span>';
    $('catSwitch').innerHTML = CAT_GROUPS[groupOf(cat)].filter(c => c !== '結案').map(c => `<button type="button" data-setcat="${esc(c)}" aria-pressed="${c === cat}">${esc(SWITCH_LABEL[c] || CAT_LABEL(c))}<span class="my">${esc(CAT_MY[c] || '')}</span></button>`).join('');
    $('catSwitch').querySelectorAll('[data-setcat]').forEach(b => {
      const locked = (!!state.catLocked && b.dataset.setcat !== state.entryCat) || !!state.closeOnly; // 0.4.51 只能用首頁選的那一種；0.4.57 從「我的進度」進來結案時全部鎖
      if (locked) { b.disabled = true; b.classList.add('locked'); b.title = '從首頁選的類別，不能切換'; }
      b.addEventListener('click', () => { if (locked) return; state.catManual = true; setCat(b.dataset.setcat); });
    });
  }
  /** 換類別：同一組農民（一般／試作／推廣）客戶清單一樣，只重算試作區；盤商↔種子商客戶清單不同，要重讀 */
  async function setCat(cat) {
    if (!CAT_TYPES[cat] || cat === state.cat) return;
    if (state.catLocked && ['農戶', '試作', '推廣', '盤商', '種子商'].indexOf(cat) >= 0 && cat !== state.entryCat) return; // 0.4.51 鎖死：任何路徑都不能切到另外兩種（結案、回到原類別照常）
    if (state.closeOnly && cat !== state.entryCat) return; // 0.4.57 從「我的進度」進來結案：不能切去拜訪
    const sameTypes = CAT_TYPES[cat][0] === CAT_TYPES[state.cat][0];
    const closingSwitch = (cat === '結案') !== (state.cat === '結案'); // 0.4.33：切進／切出結案，農民名單不一樣（結案只列自己的）
    state.cat = cat;
    applyCatLabels();
    if (sameTypes && !closingSwitch) { resetTrialForm(); refreshTrialBox(); refreshSave(); return; }
    if (sameTypes) {
      const before0 = $('farmer').value;
      await loadFarmers();
      if ($('farmer').value === before0) { resetTrialForm(); refreshTrialBox(); refreshSave(); return; } // 選的人還在名單：資料照留
      if (before0 && before0 !== '__new') toast('結案只能選自己負責的農民／ကိုယ်တာဝန်ယူထားသော လယ်သမားသာ');
      onFarmerChange(); return;
    }
    const before = $('farmer').value;
    await loadFarmers();
    if (before === '__new' && $('farmer').value === '__new') { $('profileTitle').textContent = `新${state.cat}資料／${CAT_MY[state.cat]} အသစ်`; refreshSave(); return; } // 正在填的新客戶資料不清掉
    onFarmerChange();
  }
  /** 沒自己按過類別時：選到的農民有進行中的試作（或推廣）就自動切過去，沒有就回到進來時的類別 */
  async function autoCat(cid) {
    const gen = state.formGen;
    let want = state.entryCat;
    for (const c of ['試作', '推廣']) { if (await activeTrialFor(cid, c)) { want = c; break; } }
    if (gen !== state.formGen || $('farmer').value !== cid || state.catManual) return;
    await setCat(want);
  }

  /**
   * 0.4.63 董事長「執行任務清單點進去，一般拜訪／試作／推廣要改死，不要三個都能切」：
   * 從清單（任務、日程）進來時先算好類別——有進行中的試作就是試作、推廣就是推廣、都沒有是一般拜訪；盤商、種子商照原類別——再鎖死
   */
  async function openFromList(cid, type) {
    let cat = type === '盤商' || type === '種子商' ? type : '農戶';
    if (cat === '農戶' && cid) for (const c of ['試作', '推廣']) { if (await activeTrialFor(cid, c)) { cat = c; break; } }
    state.lockNext = true;
    await openVisit(cat, cid);
  }
  async function openVisit(cat, customerId) {
    state.cat = cat; state.entryCat = cat; state.catManual = false; state.dealerClose = false;
    state.closeOnly = !!state.closeNext; state.closeNext = false; // 0.4.57 從「我的進度」結案進來
    if (state.closeOnly) state.catManual = true; // 結案畫面不自動切到試作
    // 0.4.47 董事長「一般拜訪農民的時候，試作農民跟推廣農民要鎖死」：只鎖從首頁選一般拜訪進來的；任務、客戶清單進來的照舊（有進行中的試作會自動切過去）
    state.catLocked = !!state.lockNext && ['農戶', '試作', '推廣', '盤商', '種子商'].indexOf(cat) >= 0; state.lockNext = false; // 0.4.53 盤商、種子商也鎖
    if (state.catLocked) state.catManual = true; // 鎖死就不自動切到試作
    state.signOnly = !!state.signNext; state.signNext = false; // 0.4.82 結案分頁的盤商、種子商結案：只走「已簽約」
    applyCatLabels();
    resetForm();
    await loadOptions();
    await loadFarmers();
    if (customerId) {
      // 0.4.24：客戶不在名單（已結案、或名單還沒同步到）時提示，不默默留一個空白的選農民欄
      if ([...$('farmer').options].some(o => o.value === customerId)) { $('farmer').value = customerId; onFarmerChange(); }
      else toast('找不到這位客戶（可能已結案，或名單還沒更新），請從選單選擇／ဖောက်သည် မတွေ့ပါ');
    }
    show('visit');
    locate();
  }

  async function loadFarmers() {
    state.myName = String(((await getConfig()) || {}).name || ''); // 0.4.80 已簽約要比對負責業務
    state.farmers = (await Store.getMeta('farmers')) || [];
    const local = (await Store.getMeta('localCustomers')) || [];
    const all = state.farmers.concat(local.filter(l => !state.farmers.some(f => f.id === l.id)));
    const types = CAT_TYPES[state.cat];
    const sel = $('farmer');
    const keep = sel.value;
    let mine = all.filter(f => types.indexOf(f.type || '農民') >= 0);
    // 0.4.33 董事長：怕業務結案按錯 →「結案」只列自己負責的農民（手機剛新增還沒上傳的也算自己的）；其他類別照舊全部列
    // 0.4.64（2號 0.4.63 清單中#2）：從結案分頁進來的盤商、種子商結案也只列自己負責的（跟農民結案同一規則；後台也會擋）
    if (state.cat === '結案') { const me = String(((await getConfig()) || {}).name || ''); mine = mine.filter(f => f.pending || String(f.staff || '') === me); }
    else if (state.closeOnly && isDealerCat()) { const me = String(((await getConfig()) || {}).name || ''); mine = mine.filter(f => f.pending || !String(f.staff || '') || String(f.staff) === me); } // 0.4.82 盤商、種子商結案：負責業務空白照舊算可以（同 dealerIsMine、後台 ownDc）
    // 業務BUG#3（1號）：結案（農民結案、從結案分頁進來的盤商／種子商結案）不能新增客戶，選單不放「＋新增」
    const closing = state.cat === '結案' || !!state.dealerClose || (state.closeOnly && isDealerCat());
    const optOf = f => `<option value="${esc(f.id)}">${esc(f.name)}${f.area ? '｜' + esc(String(f.area).trim() /* 0.4.89 地區完整顯示（業務－地區），不切字 */) : ''}${f.crop ? '｜' + esc(f.crop) : ''}${f.pending ? '（新，未上傳 မတင်ရသေး）' : ''}</option>`;
    let body = mine.map(optOf).join('');
    // 0.4.73 董事長「結案改為一般農民、試作農民、推廣農民結案」：選的那一種排前面（有進行中試作＝試作農民、推廣＝推廣農民、都沒有＝一般農民），
    // 其他自己負責的農民排在後面「其他農民」（分類只看進行中的試作，結束過的會被算一般，所以不藏起來，免得找不到人）
    if (state.cat === '結案' && FARMER_GROUPS.indexOf(state.closeGroup) >= 0) {
      const gOf = {};
      for (const f of mine) gOf[f.id] = (await activeTrialFor(f.id, '試作')) ? '試作農民' : (await activeTrialFor(f.id, '推廣')) ? '推廣農民' : '一般農民';
      const hit = mine.filter(f => gOf[f.id] === state.closeGroup), rest = mine.filter(f => gOf[f.id] !== state.closeGroup);
      body = `<optgroup label="${esc(state.closeGroup)}">${hit.map(optOf).join('') || '<option value="" disabled>（沒有／မရှိ）</option>'}</optgroup>`
        + (rest.length ? `<optgroup label="其他農民／အခြား လယ်သမား">${rest.map(optOf).join('')}</optgroup>` : '');
    }
    sel.innerHTML = '<option value="">— 請選擇 ရွေးပါ —</option>' + body +
      (closing ? '' : `<option value="__new">${isDealerCat() ? `＋ 新增${state.cat}（${CAT_MY[state.cat]} အသစ်）` : '＋ 新增農民（ လယ်သမား အသစ် ）'}</option>`);
    if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
    state.allCustomers = all;
  }

  // 0.4.71 董事長截圖：地區旁加「鎮」「村」（業務手打；0.4.75 原本叫「鄉」改叫「村」、鎮在前）；「使用肥料」改叫「其他」（資料照存使用肥料欄）；一般／試作／推廣農民、盤商、種子商都要有
  // 0.4.73 董事長：盤商、種子商「品牌」改「作物」（dcrop → 送出時改名 crop）；品牌欄不再出現在表單，舊資料留在試算表不動
  const PROFILE_INPUTS = { name: 'pName', owner: 'pOwner', phone: 'pPhone', area: 'pArea', village: 'pVillage', town: 'pTown', address: 'pAddress', brand: 'pBrand', dcrop: 'pDCrop', crop: 'pCrop', variety: 'pVariety', varCode: 'pVarCode', areaNow: 'pAreaNow', areaMax: 'pAreaMax', plantDate: 'pPlantDate', fertilizer: 'pFert' };
  const DEALER_KEYS = ['name', 'owner', 'phone', 'area', 'village', 'town', 'address', 'dcrop', 'fertilizer'];
  const FARMER_KEYS = ['name', 'phone', 'area', 'village', 'town', 'crop', 'variety', 'varCode', 'areaNow', 'areaMax', 'plantDate', 'fertilizer'];
  const activeKeys = () => (isDealerCat() ? DEALER_KEYS : FARMER_KEYS);
  /* ───── 0.4.82 董事長截圖：新增農民（盤商、種子商也一樣）時「快速帶入舊客戶資料」─────
     選項＝Store 的 endedMine 原始資料（自己負責、已結案；state.endedMine 只留農民，這裡另外讀）中同類型的：農民頁列農民、盤商頁列盤商、種子商頁列種子商。
     選了只帶基本資料；作物、品種、代碼、種植日期、目前種植面積、GPS 不帶（新一季要重填）。帶完可以再改；存檔照舊建新客戶（新編號），不動舊客戶 */
  const QUICK_KEYS = ['name', 'phone', 'area', 'town', 'village', 'address', 'owner', 'brand', 'areaMax'];
  const quickType = () => (isDealerCat() ? state.cat : '農民');
  async function fillQuickFill() {
    const box = $n('quickFillBox'), sel = $n('quickFill');
    const want = quickType();
    const list = ((await Store.getMeta('endedMine')) || []).filter(c => (c.type || '農民') === want);
    state.quickList = list;
    box.hidden = !list.length; // 沒有舊客戶就不顯示
    sel.innerHTML = '<option value="">— 選一位帶入（可不選） ရွေးပါ —</option>' + list.map(c => { const tv = [c.town, c.village].filter(Boolean).join('・');
      return `<option value="${esc(c.id)}">${esc(c.name || '（未命名）')}｜${esc(c.id)}${tv ? '｜' + esc(tv) : ''}</option>`; }).join('');
    sel.value = '';
  }
  function applyQuickFill() {
    const c = (state.quickList || []).find(x => x.id === $n('quickFill').value);
    if (!c) return;
    QUICK_KEYS.forEach(k => { const el = $n(PROFILE_INPUTS[k]); el.value = c[k] == null ? '' : String(c[k]); });
    if (c.area && $n('pArea').value !== String(c.area)) { try { $n('pArea').insertAdjacentHTML('beforeend', `<option>${esc(c.area)}</option>`); } catch (e) { /* 舊頁面 */ } $n('pArea').value = c.area; } // 選單裡沒有的舊地區也放回去
    refreshSave();
  }

  // 業務BUG#1（2號小助手 2026-11-12）：換農民時上一位的打字、照片、錄音、種植失敗會留著，存檔就記到新農民身上
  const FAIL_IDS = ['fWeather', 'fTemp', 'fFert', 'fWater', 'fPest', 'fPestNote', 'fReason'];
  const visitDirty = () => !!(state.photos.length || state.busyPhotos || state.audio || state.rec || state.recBusy || $('note').value.trim() || $('plantFail').checked); // 0.4.87 高2：錄音處理中也算
  /** 業務BUG#5：返回首頁前要確認的「填了東西」——除了照片錄音打字，還有沒見到匯報、新客戶資料、結案欄位、盤商結案說明、價格、試作表單 */
  const filled = id => { const e = $n(id); return e.type === 'checkbox' ? !!e.checked : !!String((e.value) || '').trim(); }; // 0.4.75 勾選框看有沒有勾（value 永遠是 on）
  // 結案七欄＋盤商結案說明（formDirty、換客戶共用）；2號 0.4.70 低3（第8任）：漏了結案地區 cRegion、洽談結果 dcOutcome（兩個下拉，預設空白、不會自動帶值）
  const CLOSE_IDS = ['cRegion', 'cPrice', 'cYield', 'cBuyer', 'cPhone', 'cReason', 'cProgress', 'dcOutcome', 'dcNote', 'cTrialOutcome', 'cPlantFail', 'dcSigned', 'mCount', 'mWeight', 'mHusk', 'mLength', 'mRows']; // 0.4.74 加試作結果；0.4.75 加種植失敗、已簽約勾選（filled、清除都認得勾選框）
  const formDirty = () => !!(visitDirty() || filled('nmNote')
    || ($('farmer').value === '__new' && Object.values(PROFILE_INPUTS).some(filled))
    || CLOSE_IDS.some(filled)
    || collectPrices().length || state.trialMode);
  function clearVisitInput() {
    // 1號清單高#1（第8任 2026-11-12）：換客戶也要換世代、照片計數歸零（跟 resetForm 一樣），
    // 不然還在處理的照片、錄音處理完會掉進下一位客戶的拜訪。世代要在停錄音之前換，onstop 才會丟掉這段。
    state.formGen++;
    state.busyPhotos = 0;
    $('photoBtn').classList.remove('busy'); $('albumBtn').classList.remove('busy');
    clearInterval(state.recTimer);
    if (state.rec) { try { state.rec.stop(); } catch (e) { /* 已經停了 */ } state.rec = null; }
    $('recBtn').classList.remove('rec', 'done');
    $('recBtn').querySelector('.label').textContent = '錄音';
    state.photos = []; state.audio = null; state.audioSec = 0;
    renderThumbs();
    $('photoInput').value = ''; $('albumInput').value = '';
    $('note').value = '';
    $('plantFail').checked = false;
    FAIL_IDS.forEach(id => { $(id).value = ''; });
  }
  function onFarmerChange() {
    const val = $('farmer').value;
    const prev = state.farmerVal || '';
    // 業務BUG#2（1號）：價格、沒見到的匯報、試作表單也算「填過」，換客戶前一起問；換了就清掉價格（不然會存到另一家盤商名下）
    const hasPrices = state.cat === '盤商' && !state.dealerClose; // 只有盤商有價格列（種子商、結案沒有）
    const pricesTyped = () => hasPrices && [...$('priceRows').querySelectorAll('.pc, .pv, .pp')].some(i => i.value.trim());
    // 2號 0.4.69 清單中1、中2（第8任）：結案欄位、盤商結案說明、還在填的新客戶資料也算「填過」（跟返回鍵的 formDirty 同一套），
    // 原本換客戶不問 → 結案價格、收購客戶帶到下一位；新客戶資料填一半改選舊客戶被整份清空
    const closeTyped = CLOSE_IDS.some(filled), newTyped = prev === '__new' && Object.values(PROFILE_INPUTS).some(filled);
    if (prev && val !== prev && (visitDirty() || pricesTyped() || filled('nmNote') || state.trialMode || closeTyped || newTyped)) {
      const extra = (closeTyped ? '、結案資料' : '') + (newTyped ? '、新客戶資料' : '');
      const ask = hasPrices ? `換店家會清掉剛剛的照片、錄音、打字、價格、匯報${extra}，確定要換？\nဆိုင် ပြောင်းလျှင် ဓာတ်ပုံ၊ အသံ၊ စာ၊ ဈေးနှုန်း ပျောက်မည်။`
        : `換農民會清掉剛剛的照片、錄音、打字、匯報${extra}，確定要換？\nလယ်သမား ပြောင်းလျှင် ဓာတ်ပုံ၊ အသံ၊ စာ ပျောက်မည်။`;
      if (!confirm(ask)) { $('farmer').value = prev; return; }
      clearVisitInput();
      CLOSE_IDS.forEach(id => { const e = $n(id); if (e.type === 'checkbox') { e.checked = false; e.disabled = false; } else e.value = ''; }); // 中1：確定換人，上一位的結案欄位一起清（0.4.75 勾選框取消勾）
    }
    if (prev && val !== prev && hasPrices) { $('priceRows').innerHTML = ''; addPriceRow(); refreshPriceBtn(); }
    state.farmerVal = val;
    const box = $('profileBox');
    Object.values(PROFILE_INPUTS).forEach(id => { $n(id).value = ''; }); // 0.4.71 用 $n：舊頁面沒有鎮、村也不當
    $n('pGps').value = ''; // 0.4.71 GPS 座標：換客戶就清掉，拍照時再帶入
    $('pVarCo').value = ''; // 0.4.31：換客戶就重選公司，不帶上一位的
    state.original = null;
    state.cropOpen = false; // 0.4.44 換客戶：作物四格先收起來（沒填才自動展開）
    resetNoMeet(); // 0.4.38 換客戶就回到「有見到農民」；0.4.44 起改成回到「還沒選有沒有見到」
    if (!val) { box.hidden = true; $('progressBox').hidden = true; const hb = $n('closeVisitHist'); hb.hidden = true; hb.innerHTML = ''; hb._tok = null; const vh = $n('visitHistory'); vh.hidden = true; vh.innerHTML = ''; vh._tok = null; refreshTrialBox(); refreshSave(); return; } // 0.4.35 沒選人：進度、作物品種都收起來；0.4.73、0.4.75 過往紀錄也收
    box.hidden = val !== '__new' && !SHOW_PROFILE_ON_VISIT; // 0.4.48 舊客戶不顯示客戶資料（資料照樣讀進來，開始試作時的品種代碼仍用得到）
    $('dealerTypeBox').hidden = true; // 盤商、種子商分開進來，種類就是入口，不用再選
    $n('quickFillBox').hidden = true; // 0.4.82 帶入舊客戶：只有新增時才出現
    if (val === '__new') {
      fillQuickFill();
      box.open = true;
      $('profileTitle').textContent = isDealerCat() ? `新${state.cat}資料／${CAT_MY[state.cat]} အသစ်` : '新農民資料／လယ်သမား အသစ်';
    } else {
      const c = (state.allCustomers || []).find(f => f.id === val) || {};
      activeKeys().forEach(k => { const el = $n(PROFILE_INPUTS[k]); el.value = c[k] == null ? '' : String(c[k]); });
      if ($('pArea').value !== String(c.area || '') && c.area) $('pArea').insertAdjacentHTML('beforeend', `<option>${esc(c.area)}</option>`), $('pArea').value = c.area;
      if (!isDealerCat()) { fillCrops(c.crop == null ? '' : String(c.crop)); fillVarieties(c.variety == null ? '' : String(c.variety)); } // 下拉選單：選單裡沒有的舊值也要放回去
      else fillDealerCrop(c.crop == null ? '' : String(c.crop)); // 0.4.73 盤商、種子商的作物（存在主要作物欄）
      state.original = {};
      activeKeys().forEach(k => { state.original[k] = $n(PROFILE_INPUTS[k]).value; });
      if ('variety' in state.original) state.original.variety = varietyValue(); // 0.4.50 跟 collectProfile 用同一算法，沒改就不會誤判成有改
      box.open = false;
      $('profileTitle').textContent = '客戶資料（點開可修改）／ဖောက်သည် အချက်အလက် (နှိပ်ပြီး ပြင်နိုင်)';
    }
    fillVarieties();
    renderProgress(val); // 0.4.35 選了農民就跳出他之前的進度
    // 0.4.73 董事長「結案要有之前的照片、留言、錄音、地址、詳細過往失敗成功的紀錄」：結案畫面選了農民就列過往紀錄
    if (state.cat === '結案') renderHistory(val, $n('closeVisitHist'), { current: () => $('farmer').value === val, list: state.allCustomers || [], timeline: true, showAddr: true, showTrials: true });
    else { const hb = $n('closeVisitHist'); hb.hidden = true; hb.innerHTML = ''; hb._tok = null; }
    // 0.4.75 董事長「田間打卡：所有的農民之前紀錄都要有之前圖片跟錄音」：一般／試作／推廣農民（不限自己負責）列過往紀錄；盤商、種子商、結案不列
    if (state.cat !== '結案' && groupOf(state.cat) === 'farmer') renderHistory(val, $n('visitHistory'), { current: () => $('farmer').value === val && state.cat !== '結案' && groupOf(state.cat) === 'farmer', list: state.allCustomers || [], showTrials: true, timeline: true, scope: 'field' });
    else { const vh = $n('visitHistory'); vh.hidden = true; vh.innerHTML = ''; vh._tok = null; }
    // 換客戶就清掉試作表單：剛剛打的結果不能套到另一位客戶的試作（2026-11-11 第四輪自抓 T8）
    resetTrialForm();
    refreshSave();
    refreshTrialBox();
    if (!state.catManual && groupOf(state.cat) === 'farmer' && val !== '__new') autoCat(val);
  }

  /* ───── 這位農民之前的進度（0.4.35 董事長：選擇農民後跳出之前進度；沒有進度就跳出新增農民）───── */
  async function fetchHistory(cid) {
    const cfg = await getConfig();
    if (!cfg || !cfg.deviceKey || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), 8000) : null;
    try {
      const res = await fetch(FARM_CONFIG.gasUrl, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'farmerHistory', deviceKey: cfg.deviceKey, cid }), signal: ac ? ac.signal : undefined });
      const r = await res.json();
      return r && r.ok && Array.isArray(r.visits) ? r.visits : null;
    } catch (e) { return null; } finally { if (timer) clearTimeout(timer); }
  }
  /** opts（0.4.57 首頁「我的進度」結案選單共用）：box 畫在哪、current() 讀完時還是不是這位、list 客戶清單、home＝首頁（沒紀錄時不去開客戶資料） */
  async function renderProgress(cid, opts) {
    const o = opts || {};
    const box = o.box || $('progressBox');
    const current = o.current || (() => $('farmer').value === cid);
    if (!cid || cid === '__new') { box.hidden = true; box.innerHTML = ''; return; }
    const c = (o.list || state.allCustomers || []).find(f => f.id === cid) || {};
    // 0.4.49 董事長：進度卡標題旁顯示農民姓名、電話（點了直接撥）、地址（農民多半只有地區，沒填地址就顯示地區）
    const tel = String(c.phone || '').replace(/[^\d+]/g, '');
    const who = [c.name ? `<b>${esc(c.name)}</b>` : '', c.phone ? `📞 <a href="tel:${esc(tel)}">${esc(c.phone)}</a>` : '', (c.address || c.area) ? `📍 ${esc(c.address || c.area)}` : ''].filter(Boolean).join('　');
    const H3 = `<h3>之前的進度／ယခင် တိုးတက်မှု${who ? `<span class="who">${who}</span>` : ''}</h3>`;
    const trials = [];
    for (const cat of ['試作', '推廣']) { const t = await activeTrialFor(cid, cat); if (t) trials.push(Object.assign({ cat }, t)); }
    // 低#6（第8任）：別的帳號的拜訪不標成「我」（註解原本誤插在這行中間，把後面的排序、取 5 筆變成註解，已改正）
    const local = (await myVisits()).filter(v => v.farmerId === cid).sort((a, b) => (b.deviceTime || 0) - (a.deviceTime || 0)).slice(0, 5);
    if (!current()) return; // 2號 0.4.69 低4（第8任）：查試作、本機拜訪的途中已經收起或換人 → 不要再把卡片打開寫「讀取中」
    const tok = {}; box._loadTok = tok; // 這一次讀取的記號：後面判斷「卡片現在還是我寫的讀取中嗎」（比 innerHTML 字串可靠，瀏覽器會改寫跳脫字）
    box.hidden = false;
    box.innerHTML = H3 + '<p class="sub">讀取中…／ဖတ်နေသည်</p>';
    // 等後台最多 10 秒；等不到就用手機裡的（線上實測：請求有時遲遲不回，連取消都沒反應 → 不能只靠 AbortController）
    const remote = await Promise.race([fetchHistory(cid), new Promise(r => setTimeout(() => r(null), 10000))]);
    if (!current()) { if (box._loadTok === tok) { box.hidden = true; box.innerHTML = ''; box._loadTok = null; } return; } // 讀的途中換了客戶；低4：卡片還是這次寫的「讀取中」就收掉（別的讀取已接手就不動）
    // 業務BUG#6：沒網路時用手機本地日期（toISOString 是世界標準時間，緬甸 00:00～06:30 打的卡會顯示成前一天）
    // 第8任（1號提醒 dayOf）：改用緬甸日期 mmDay，手機時區不是緬甸也不會差一天（跟伺服器的日期同一把尺）
    const dayOf = ms => mmDay(0, ms || 0);
    const recent = remote ? remote : local.map(v => ({ time: dayOf(v.deviceTime), staff: '我', cat: CAT_LABEL(v.category || ''), text: v.text || '', plantFail: '', closing: '' }));
    // 0.4.82 多久沒回訪：後台的最後拜訪日、這支手機剛打（還沒同步）的，取比較新的那天
    const age = `<p class="sub">${visitAgeHtml([c.lastVisit, local[0] ? dayOf(local[0].deviceTime) : ''].filter(Boolean).sort().pop(), mmDay(0))}</p>`;
    if (o.home && !c.lastVisit && !trials.length && !recent.length) { box.innerHTML = H3 + age + `<p>這位${c.type && c.type !== '農民' ? '客戶' : '農民'}還沒有拜訪紀錄。<br>` + '<span class="my">မှတ်တမ်း မရှိသေး</span></p>'; return; }
    if (!c.lastVisit && !trials.length && !recent.length) {
      // 沒有任何進度：跳出新增（補齊）農民資料
      box.innerHTML = SHOW_PROFILE_ON_VISIT ? H3 + age + '<p>這位農民還沒有拜訪紀錄，請先把下面的農民資料填完整（跟新增農民一樣）。<br><span class="my">မှတ်တမ်း မရှိသေး၊ လယ်သမား အချက်အလက် ဖြည့်ပါ</span></p>'
        : H3 + age + '<p>這是第一次拜訪這位客戶。<br><span class="my">ပထမဆုံး သွားရောက်မှု</span></p>'; // 0.4.48
      $('profileBox').open = true;
      $('profileTitle').textContent = '補齊農民資料（還沒有拜訪紀錄）／လယ်သမား အချက်အလက် ဖြည့်ရန်';
      return;
    }
    const wk = s => { const d = Date.parse(String(s || '').slice(0, 10)); return isFinite(d) ? Math.max(1, Math.ceil((Date.now() - d) / 604800000)) : null; };
    // 0.4.44 進度小卡：作物品種代碼搬到卡片下面一行（renderCropSum），卡片只留最後拜訪、下次回訪
    const head = [c.lastVisit ? `最後拜訪 <span class="nw">${esc(c.lastVisit)}</span>` : '', c.nextDue ? `下次回訪 <span class="nw">${esc(c.nextDue)}</span>` : ''].filter(Boolean).join('｜'); // 低#9（第8任）：日期不拆兩行
    const tr = trials.map(t => `<li><b>${esc(t.cat)}進行中</b>：${esc(t.item || '（未填品項）')}${t.start ? `，${esc(t.start)} 開始${wk(t.start) ? `（第 ${wk(t.start)} 週）` : ''}` : ''}</li>`).join('');
    const vs = recent.map(v => `<li>${esc(v.time)}｜${esc(v.staff)}｜${esc(CAT_LABEL(v.cat))}${v.closing ? '' : ''}${v.text ? `：${esc(v.text)}` : ''}${v.plantFail ? `<br><span class="pill late">種植失敗</span> ${esc(v.plantFail)}` : ''}${v.closing ? `<br>${esc(v.closing)}` : ''}</li>`).join('');
    // 0.4.44 只露最近一次拜訪，其他收進「看更早的」
    const vItems = vs ? vs.split('</li>').filter(Boolean).map(x => x + '</li>') : [];
    const more = vItems.length > 1 ? `<details><summary>看更早的 ${vItems.length - 1} 筆／ယခင်များ</summary><ul>${vItems.slice(1).join('')}</ul></details>` : '';
    box.innerHTML = `${H3}${age}${head ? `<p class="sub">${head}</p>` : ''}${tr ? `<ul>${tr}</ul>` : ''}` +
      (vItems.length ? `<p class="sub">上次拜訪${remote ? '' : '（沒網路，只有這支手機記的）'}：</p><ul>${vItems[0]}</ul>${more}` : '');
  }

  /* ───── 試作（2B）：開始一件試作、填結果結束（失敗要填失敗紀錄） ───── */
  async function activeTrialFor(cid, cat) {
    const server = (await Store.getMeta('trials')) || [];
    const local = (await Store.getMeta('localTrials')) || [];
    const ended = new Set(local.filter(l => l.ended).map(l => l.id));
    const list = server.filter(t => t.cid === cid && t.cat === cat && !ended.has(t.id) && !(t.temps || []).some(x => ended.has(x)))
      .concat(local.filter(l => !l.ended && l.cid === cid && l.cat === cat));
    return list[list.length - 1] || null;
  }
  /** 0.4.44 進度卡下面一行：作物｜品種｜代碼 ✎修改。資料沒填的話直接展開讓業務補 */
  function renderCropSum() {
    const sel = $('farmer').value, show = !!sel && !isDealerCat() && (sel === '__new' || SHOW_PROFILE_ON_VISIT); // 0.4.48 舊客戶不顯示
    const crop = $('pCrop').value, vari = varietyValue(), code = $('pVarCode').value.trim(); // 0.4.50 品種藏起來時顯示公司
    if (show && (sel === '__new' || !crop)) state.cropOpen = true; // 要補資料：打開後就保持開著（選完作物不會突然收起來）
    const open = show && !!state.cropOpen;
    $n('cropBox').hidden = !open; // 低#7（第8任）：0.4.44 新元件，舊頁面沒有也不當
    const sum = $n('cropSum');
    sum.hidden = !show || open;
    const t = $n('cropSumText');
    t.textContent = [crop ? `作物 ${cropText(crop)}` : '', vari ? `品種 ${vari}` : '', code ? `代碼 ${code}` : ''].filter(Boolean).join('｜');
  }
  async function refreshTrialBox() {
    const sel = $('farmer').value;
    const show = (state.cat === '試作' || state.cat === '推廣') && !!sel;
    $('trialBox').hidden = !show;
    refreshCloseTrial(); // 0.4.74 結案：有進行中的試作／推廣就要先填結果（自己處理換客戶的競態）
    refreshPlantFail(); // 0.4.33 一般拜訪的種植失敗勾選：換類別、換客戶時跟著顯示／收起
    if (sel && !isDealerCat()) fillVarieties(); // 0.4.50 換類別時種子公司選單跟著換（一般＝其他公司、試作推廣＝農友）
    renderCropSum(); // 0.4.44 作物、品種、代碼縮成一行；新農民、沒填或按「修改」才展開四格（0.4.35 起選了農民就看得到）
    refreshNoMeet(); // 0.4.38 沒拜訪：換類別、換客戶時跟著顯示／收起
    if (noMeetOn()) { $('trialBox').hidden = true; if (state.trialMode) setTrialMode(null); return; }
    if (!show) { if (state.trialMode) setTrialMode(null); return; }
    $('trialLab').innerHTML = `${esc(state.cat)}<span class="my">${CAT_MY[state.cat] || ''}</span>`;
    $('trialStartBtn').innerHTML = `＋ 開始新的${state.cat}<span class="my">${CAT_MY[state.cat]} အသစ် စတင်</span>`;
    $('tItemLab').innerHTML = `${state.cat}品項（必填）<span class="my">ပစ္စည်းအမည် (မဖြစ်မနေ)</span>`;
    const gen = state.formGen, cat = state.cat;
    const t = sel === '__new' ? null : await activeTrialFor(sel, cat);
    if (gen !== state.formGen || sel !== $('farmer').value || cat !== state.cat) return; // 查的途中換了類別（自動切到試作），舊結果丟掉
    state.activeTrial = t;
    $('trialNow').textContent = t ? `進行中 လုပ်ဆောင်ဆဲ：${t.item || '（未填品項）'}${t.start ? '，' + t.start + ' 開始 စတင်' : ''}${t.pending ? '（還沒上傳 မတင်ရသေး）' : ''}` : `這位客戶目前沒有進行中的${state.cat}。／လုပ်ဆောင်ဆဲ ${CAT_MY[state.cat]} မရှိ`;
    $('trialStartBtn').hidden = !!t; $('trialEndBtn').hidden = !t;
    if ((state.trialMode === 'end' && !t) || (state.trialMode === 'start' && t)) setTrialMode(null);
  }
  function setTrialMode(m) {
    state.trialMode = m;
    $('trialStartForm').hidden = m !== 'start'; $('trialEndForm').hidden = m !== 'end';
    $('trialStartBtn').setAttribute('aria-pressed', String(m === 'start')); $('trialEndBtn').setAttribute('aria-pressed', String(m === 'end'));
    if (m === 'start' && !$('tStart').value) { $('tStart').value = mmDay(0); } // 業務BUG#4：緬甸的今天
    if (m === 'start') fillTrialItems(); // 0.4.89 品項下拉＝最新的作物選項
    if (m === 'end' && !$('tYieldUnit').value) $('tYieldUnit').value = (state.options && state.options.yieldUnit) || '籃';
    placeFailBox(); // 0.4.74 失敗欄位放哪、要不要顯示統一由 placeFailBox 決定（試作結束／種植失敗／結案試作失敗）
    $('harvestBox').hidden = $('tOutcome').value === '失敗'; // 0.4.38 成功／結束 → 收成報告；失敗 → 失敗紀錄
    refreshSave();
  }
  /* 一般拜訪的種植失敗（0.4.33）：同一組失敗欄位（failBox）搬到一般拜訪下面用；切回試作結束時再搬回去 */
  const plantFailOn = () => state.cat === '農戶' && !!$('farmer').value && $('plantFail').checked;
  // 0.4.75 董事長「『這次發現種植失敗（要寫原因）』這邊移除，但是要移到所有農民結案這邊」：一般拜訪不再顯示（改回 true 就恢復；程式、plantFailure 欄位保留，舊資料照常顯示）
  const PLANT_FAIL_ON_VISIT = false;
  function refreshPlantFail() {
    const show = PLANT_FAIL_ON_VISIT && state.cat === '農戶' && !!$('farmer').value && !noMeetOn();
    $('plantFailBox').hidden = !show;
    if (!show) $('plantFail').checked = false;
    placeFailBox();
    refreshSave();
  }
  /* ───── 0.4.74 董事長「要，先填結果」：農民結案時，這位農民有進行中的試作（或推廣）→ 先填結果（成功／失敗，失敗要填失敗紀錄）─────
     同時有試作和推廣時以試作為準（推廣那筆後台照舊寫「結束」）。欄位約定見 2 號確認：closing.trialResult {id, cat, outcome, failure?, startInfo?}、closing.group */
  /** 送出的 group 和結案標題共用：有進行中試作＝試作農民、推廣＝推廣農民、都沒有＝一般農民 */
  const closeTrialGroup = ct => (ct ? (ct.cat === '試作' ? '試作農民' : '推廣農民') : '一般農民');
  /** 0.4.75 低3：結案標題用哪一種——選了農民、而且查完試作 → 實際分類；還沒選（或還在查）→ 按的那顆按鈕 */
  const closeGroupNow = () => { const sel = $('farmer').value;
    if (sel && sel !== '__new' && state.closeTrialFor === sel) return closeTrialGroup(state.closeTrial);
    return FARMER_GROUPS.indexOf(state.closeGroup) >= 0 ? state.closeGroup : ''; };
  function refreshCloseTitle() { if (state.cat === '結案' && closeGroupNow()) $('visitTitle').textContent = `${closeGroupNow()}結案 ပိတ်သိမ်း`; }
  /** 結案：這位農民的試作（推廣）結果選了失敗 */
  const closeTrialFailed = () => state.cat === '結案' && !!state.closeTrial && state.closeTrialFor === $('farmer').value && $n('cTrialOutcome').value === '失敗';
  /** 0.4.75 結案的「這次發現種植失敗」有勾（試作失敗時會自動勾） */
  const closePlantFailOn = () => state.cat === '結案' && !!$('farmer').value && !!$n('cPlantFail').checked;
  const closeFailOn = () => (closeTrialFailed() || closePlantFailOn()) && typeof document !== 'undefined' && !!document.getElementById('closeFailSlot');
  /** 0.4.75：試作結果選失敗 → 種植失敗自動勾、鎖住（同一份失敗紀錄，不要填兩次）；改回成功或換人 → 解開、取消自動勾的那一次 */
  function syncClosePlantFail() {
    const cb = $n('cPlantFail');
    if (closeTrialFailed()) { if (!cb.checked) state.plantFailAuto = true; cb.checked = true; cb.disabled = true; } // 業務自己先勾的，不算自動勾
    else { cb.disabled = false; if (state.plantFailAuto) { cb.checked = false; state.plantFailAuto = false; } }
  }
  /** 同一組失敗欄位（failBox）只有一份：種植失敗 → 一般拜訪下面（0.4.75 起不顯示）；結案試作失敗或結案種植失敗 → 結案區；其他 → 回試作結束表單 */
  function placeFailBox() {
    const box = $('failBox');
    const slot = plantFailOn() ? $('plantFailSlot') : closeFailOn() ? $n('closeFailSlot') : $('trialEndForm');
    if (box.parentElement !== slot) slot.appendChild(box);
    box.hidden = !(plantFailOn() || closeFailOn() || (state.trialMode === 'end' && $('tOutcome').value === '失敗'));
  }
  /** 結案畫面：查這位農民有沒有進行中的試作（先）或推廣，有就顯示結果欄（必填） */
  async function refreshCloseTrial() {
    const box = $n('closeTrialBox'), sel = $('farmer').value;
    if (state.cat !== '結案' || !sel || sel === '__new') { state.closeTrial = null; state.closeTrialFor = null; box.hidden = true; placeFailBox(); refreshCloseTitle(); return; }
    if (state.closeTrialFor === sel) return; // 這位已經查過（結果欄已經在填，不要洗掉）
    prefillMeasure(sel); // 0.4.77 換農民：量測清空，帶品種、播種日、今天
    const gen = state.formGen;
    state.closeTrial = null; state.closeTrialFor = null; // 查完之前 closeProblem 會擋「讀取中」，不會送出沒帶結果的結案
    let hit = null;
    for (const cat of ['試作', '推廣']) { const t = await activeTrialFor(sel, cat); if (t) { hit = { cat, t }; break; } }
    if (gen !== state.formGen || sel !== $('farmer').value || state.cat !== '結案') return; // 查的途中換了客戶或離開結案
    state.closeTrial = hit; state.closeTrialFor = sel;
    refreshCloseTitle(); // 0.4.75 低3：標題改成這位農民的實際分類（跟送出的 group 同一套）
    box.hidden = !hit;
    if (hit) {
      $n('closeTrialLab').innerHTML = `${hit.cat}結果（必填）<span class="my">${CAT_MY[hit.cat] || ''} ရလဒ် (မဖြစ်မနေ)</span>`;
      $n('closeTrialNow').textContent = `進行中 လုပ်ဆောင်ဆဲ：${hit.t.item || '（未填品項）'}${hit.t.start ? '，' + hit.t.start + ' 開始 စတင်' : ''}。結案前請先填${hit.cat}成功或失敗／ပိတ်သိမ်းမီ ရလဒ် ရွေးပါ`;
    } else $n('cTrialOutcome').value = '';
    syncClosePlantFail(); // 0.4.75 試作失敗 → 種植失敗自動勾
    placeFailBox();
    refreshSave();
  }
  /* ───── 沒拜訪 → 下次再訪（0.4.38 董事長手稿：農民進度 → 拜訪；NO＝沒見到農民或農民拒絕 → 下次再訪）───── */
  // 0.4.42 董事長：盤商、種子商也照農民進度拜訪（被拒絕就下次再訪）；結案畫面不顯示
  const noMeetShown = () => { const s = $('farmer').value; return !!s && s !== '__new' && state.cat !== '結案' && !state.dealerClose; };
  const NM_TEXT = {
    // 0.4.58 董事長：農民只要跑到「有見到面 → 跟農民聊了什麼；沒見到面 → 匯報了什麼」，存起來給主管看
    farmer: { yes: '有見到農民 → 寫聊了什麼<span class="my">တွေ့ပြီ → ပြောခဲ့သည်များ ရေးမည်</span>', no: '沒見到／農民拒絕 → 寫匯報、下次再訪<span class="my">မတွေ့ / ငြင်း → အစီရင်ခံ ရေးမည်</span>',
      opts: [['沒見到農民', '沒見到農民／မတွေ့'], ['農民拒絕', '農民拒絕／ငြင်းဆို'], ['其他', '其他／အခြား']] },
    // 0.4.52 董事長：種子商跟盤商一樣拜訪「失敗就下次拜訪，成功就寫匯報紀錄」
    dealer: { yes: '成功拜訪 → 寫匯報紀錄<span class="my">တွေ့ပြီ → အစီရင်ခံ ရေးမည်</span>', no: '失敗（沒見到／被拒絕）→ 下次拜訪<span class="my">မအောင်မြင် → နောက်တစ်ကြိမ်</span>',
      opts: [['沒見到老闆', '沒見到老闆／ပိုင်ရှင် မတွေ့'], ['對方拒絕', '對方拒絕／ငြင်းဆို'], ['其他', '其他／အခြား']] }
  };
  /** 沒見到的按鈕字、原因選項：農民和盤商／種子商用不同說法（換組才重畫，選好的原因不會被洗掉） */
  function nmLabels() {
    const g = groupOf(state.cat) === 'dealer' ? 'dealer' : 'farmer', sel = $('nmReason');
    if (sel.dataset && sel.dataset.group === g) return;
    if (sel.dataset) sel.dataset.group = g;
    $('meetYes').innerHTML = NM_TEXT[g].yes; $('meetNo').innerHTML = NM_TEXT[g].no;
    sel.innerHTML = NM_TEXT[g].opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    sel.value = NM_TEXT[g].opts[0][0];
  }
  const noMeetOn = () => !!state.noMeet && noMeetShown();
  /* ───── 0.4.75 董事長「盤商跟種子商變成以簽約才結案」：盤商、種子商有見到之後勾「已簽約」→ 打開結案框（不選洽談結果，固定送「簽約」），
     簽約內容必填，送主管確認後結案；沒勾就是一般拜訪（不結案、不送 closing）。舊的「洽談成功／失敗」結案模式（state.dealerClose）留著不呼叫 ───── */
  const DC_NOTE_LAB = { sign: '簽約內容（必填）<span class="my">စာချုပ် အကြောင်းအရာ (မဖြစ်မနေ)</span>', old: '說明（必填）<span class="my">မှတ်ချက် (မဖြစ်မနေ)</span>' };
  const DC_NOTE_PH = { sign: '寫簽約內容，例如簽了什麼、從什麼時候開始：簽 A 品牌種子代理，12 月起每月進 50 包\nဥပမာ - A တံဆိပ် ကိုယ်စားလှယ် စာချုပ်၊ ဒီဇင်ဘာမှ စတင်',
    old: '例：談成，下個月開始進 A 品牌種子／沒談成，老闆只賣自己的品牌\nဥပမာ - သဘောတူပြီ / မအောင်မြင်' };
  /** 「已簽約」勾選什麼時候出現：盤商、種子商、選了已經有的客戶、按了「有見到」、不是舊的結案模式 */
  const dealerSignBase = () => { const s = $('farmer').value; return isDealerCat() && !state.dealerClose && !!s && s !== '__new' && !!state.meetChosen && !noMeetOn(); };
  /** 0.4.80 高1：這家是不是我負責的（負責業務空白照舊算可以，跟後台 ownDc 同一規則） */
  const dealerIsMine = () => { const c = (state.allCustomers || []).find(x => x.id === $('farmer').value) || {}; return !String(c.staff || '') || String(c.staff) === String(state.myName || ''); };
  const dealerSignShown = () => dealerSignBase() && dealerIsMine();
  const dealerSignOn = () => dealerSignShown() && !!$n('dcSigned').checked;
  function refreshDealerSign() {
    const lab = $n('dcSignedLab'), cb = $n('dcSigned');
    lab.hidden = !dealerSignShown();
    $n('dcSignNote').hidden = !(dealerSignBase() && !dealerIsMine()); // 0.4.80 別人負責的：說清楚為什麼沒有「已簽約」
    if (state.signOnly) { cb.checked = !lab.hidden; cb.disabled = true; } else cb.disabled = false; // 0.4.82 結案分頁進來：有見到就自動勾「已簽約」、不能取消（一定走簽約）
    if (lab.hidden) cb.checked = false; // 換成農民、沒見到、換人：勾選一起取消
    if (state.dealerClose) return; // 舊的結案模式自己管結案框
    const on = dealerSignOn();
    $n('dealerCloseBox').hidden = !on;
    $n('dcOutcomeRow').hidden = on; // 簽約不用選洽談結果
    $n('dcNoteLab').innerHTML = on ? DC_NOTE_LAB.sign : DC_NOTE_LAB.old;
    $n('dcNote').placeholder = on ? DC_NOTE_PH.sign : DC_NOTE_PH.old;
    if (isDealerCat()) $n('saveBtn').innerHTML = on ? '簽約送主管確認（自動上傳）<span class="my">မန်နေဂျာ အတည်ပြုရန် ပို့မည်</span>' : '儲存（自動上傳）<span class="my">သိမ်းမည်</span>';
  }
  function refreshNoMeet() {
    const shown = noMeetShown();
    nmLabels();
    $('noMeetBox').hidden = !shown;
    if (!shown) state.noMeet = false;
    const on = noMeetOn();
    // 0.4.44 董事長「資訊太多」→ 第 3 步只問「有見到嗎」：還沒選，兩顆都不亮、下面拍照打字試作都先不出現
    // 0.4.54 第6任檢查：還沒選客戶時也先不露拍照、打字、價格（第 1 步先選客戶）
    const chosen = (!shown && !!$('farmer').value) || on || !!state.meetChosen;
    $('meetYes').setAttribute('aria-pressed', String(shown && chosen && !on)); $('meetNo').setAttribute('aria-pressed', String(on));
    const mb = $('meetBody'); if (mb) mb.hidden = !chosen;
    $('noMeetForm').hidden = !on;
    // 沒見到人：不填拜訪內容、試作、種植失敗（照片仍可拍，當作有去過的證明）
    ['noteBox', 'trialBox', 'plantFailBox'].forEach(id => { if (on) $(id).hidden = true; });
    const pb = $('priceBox'); if (pb) pb.hidden = on || state.cat !== '盤商' || !!state.dealerClose; // 盤商沒見到：不記價格
    if (on && !$('nmNext').value) { $('nmNext').value = mmDay(7); } // 業務BUG#4：緬甸日期 7 天後
    refreshDealerSign(); // 0.4.75 盤商、種子商「已簽約」勾選跟著有見到／沒見到、換人顯示或收起
    if (typeof refreshStage === 'function') refreshStage(); // 0.4.78 生長階段跟著有見到／沒見到、換人
  }
  function setNoMeet(on) {
    state.noMeet = !!on; state.meetChosen = true; // 0.4.44 按過其中一顆才展開
    if (on) { setTrialMode(null); $('plantFail').checked = false; refreshPlantFail(); }
    else { $('noteBox').hidden = false; }
    refreshNoMeet();
    if (!on) refreshTrialBox();
    refreshSave();
  }
  function resetNoMeet() { state.noMeet = false; state.meetChosen = false; $('nmReason').selectedIndex = 0; $('nmNote').value = ''; $('nmNext').value = ''; $('noteBox').hidden = false; refreshNoMeet(); }
  /** 沒拜訪時要的日期：必須是明天到一年內 */
  function noMeetProblem() {
    if (noMeetShown() && !state.noMeet && !state.meetChosen) return '請先選：有見到嗎？／တွေ့ခဲ့သလား အရင်ရွေးပါ'; // 0.4.44
    if (!noMeetOn()) return '';
    if (!String($('nmNote').value || '').trim()) return '請寫匯報了什麼／အစီရင်ခံ ရေးပါ'; // 0.4.58 董事長：沒見到面要寫匯報，存給主管看
    // 業務BUG#4：跟後台同一把尺（緬甸日期：明天～一年內），手機時區不是緬甸也不會被後台丟掉
    const v = $('nmNext').value, today = mmDay(0), maxS = mmDay(365);
    if (!/^\d{4}-\d\d-\d\d$/.test(v)) return '請選下次再訪日期／နောက်တစ်ကြိမ် ရက် ရွေးပါ';
    if (v <= today || v > maxS) return '下次再訪日期要在明天到一年內／မနက်ဖြန်မှ တစ်နှစ်အတွင်း ရွေးပါ';
    return '';
  }
  const collectNoMeet = () => (noMeetOn() ? { reason: $('nmReason').value, note: $('nmNote').value.trim(), next: $('nmNext').value } : null);

  /** 失敗紀錄全部必填（董事長 2026-11-12）；病蟲害選「有」時說明也要填。回傳缺哪些 */
  function failMissing() {
    const miss = [['fWeather', '天氣'], ['fTemp', '溫度'], ['fFert', '施肥情況'], ['fWater', '水分'], ['fPest', '病蟲害'], ['fReason', '失敗原因']]
      .filter(([id]) => !String($(id).value).trim()).map(([, n]) => n);
    if ($('fPest').value === '有' && !$('fPestNote').value.trim()) miss.push('病蟲害說明');
    return miss;
  }
  const collectFailure = () => ({ weather: $('fWeather').value, temp: $('fTemp').value, fert: $('fFert').value.trim(), water: $('fWater').value, pest: $('fPest').value, pestNote: $('fPestNote').value.trim(), reason: $('fReason').value.trim() });
  function trialProblem() {
    if (state.trialMode === 'end' && !state.activeTrial) return `找不到進行中的${state.cat}，請重新選一次客戶／${CAT_MY[state.cat]} ရှာမတွေ့၊ ဖောက်သည် ပြန်ရွေးပါ`; // T9
    if (state.trialMode === 'start' && !trialItemValue()) return `請填${state.cat}品項／ပစ္စည်းအမည် ဖြည့်ပါ`; // 0.4.89：下拉沒選、選「其他」沒填都擋
    if (state.trialMode === 'end' && $('tOutcome').value === '失敗') {
      const miss = failMissing();
      if (miss.length) return `${state.cat}失敗要填：${miss.join('、')}／မအောင်မြင်မှု မှတ်တမ်း မပြည့်စုံသေး`;
    }
    if (plantFailOn()) {
      const miss = failMissing();
      if (miss.length) return `種植失敗要填：${miss.join('、')}／မအောင်မြင်မှု မှတ်တမ်း မပြည့်စုံသေး`;
    }
    return '';
  }
  /* ───── 0.4.77 董事長範例（玉米＋手寫紙卡）：結案「採收量測」，全部選填 ───── */
  const MEASURE_IDS = ['mVariety', 'mCount', 'mCountUnit', 'mWeight', 'mHusk', 'mLength', 'mLenUnit', 'mRows', 'mSow', 'mHarvest', 'mDays'];
  const MEASURE_FILLED = ['mCount', 'mWeight', 'mHusk', 'mLength', 'mRows']; // 業務自己量的；這幾格都空＝沒量，不送 measure
  const ymdOk = x => /^\d{4}-\d\d-\d\d$/.test(String(x || ''));
  /** 生長天數＝採收日−播種日（唯讀，自動算） */
  function calcMeasureDays() {
    const a = $n('mSow').value, b = $n('mHarvest').value;
    const d = ymdOk(a) && ymdOk(b) ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) : NaN;
    $n('mDays').value = isFinite(d) && d >= 0 ? d + ' 天' : '';
  }
  /** 換農民：清空，品種、播種日帶這位農民的資料，採收日預設緬甸今天，穗行數只有玉米才顯示 */
  function prefillMeasure(cid) {
    const c = (state.allCustomers || []).find(f => f.id === cid) || {};
    MEASURE_IDS.forEach(id => { $n(id).value = ''; });
    $n('mCountUnit').value = '穗'; $n('mLenUnit').value = '英寸';
    { const cos = (state.options && state.options.seedCompanies) || [], v0 = String(c.variety || ''), co = cos.find(x => v0 === x || v0.indexOf(x + ' ') === 0);
      $n('mVariety').value = !co ? v0 : v0.slice(co.length).trim(); } // 0.4.80 低6：不要把種子公司名當品種
    $n('mSow').value = ymdOk(c.plantDate) && c.plantDate <= mmDay(0) ? c.plantDate : ''; // 0.4.80 中1：種植日期在未來就不預帶
    $n('mHarvest').value = mmDay(0);
    $n('mRowsBox').hidden = !/玉米|corn|maize|ပြောင်း/i.test(String(c.crop || ''));
    calcMeasureDays();
  }
  /** 量測檢查：數字不能負、採收日不能早於播種日、不能晚於今天 */
  function measureProblem() {
    const neg = [['mCount', '樣本數'], ['mWeight', '總重量'], ['mLength', '長度'], ['mRows', '穗行數']].filter(([id]) => String($n(id).value).trim() !== '' && !(Number($n(id).value) >= 0)).map(([, n]) => n);
    if (neg.length) return `${neg.join('、')}不能是負數／အနှုတ် မဖြစ်ရ`;
    if (!MEASURE_FILLED.some(id => String($n(id).value).trim() !== '')) return ''; // 0.4.80 中1：沒量就不檢查日期（預帶的日期不能擋結案）
    const a = $n('mSow').value, b = $n('mHarvest').value;
    if (ymdOk(a) && ymdOk(b) && b < a) return '採收日不能早於播種日／ရိတ်သိမ်းရက်သည် မျိုးချရက်ထက် မစောရ';
    if (ymdOk(b) && b > mmDay(0)) return '採收日不能晚於今天／ရိတ်သိမ်းရက်သည် ယနေ့ထက် နောက်မကျရ';
    return '';
  }
  /** 送出的 measure（鍵名跟 2 號約定）；業務自己量的幾格都空就回 null（不送） */
  function collectMeasure() {
    if (!MEASURE_FILLED.some(id => String($n(id).value).trim() !== '')) return null;
    const num = id => { const x = String($n(id).value).trim(); return x === '' ? '' : Number(x); };
    const days = parseInt($n('mDays').value, 10);
    return { variety: $n('mVariety').value.trim(), sampleCount: num('mCount'), sampleUnit: $n('mCountUnit').value, weightKg: num('mWeight'), husk: $n('mHusk').value,
      length: num('mLength'), lengthUnit: $n('mLenUnit').value, rows: $n('mRowsBox').hidden ? '' : num('mRows'), sowDate: $n('mSow').value, harvestDate: $n('mHarvest').value, days: isFinite(days) ? days : '' };
  }
  /** 結案（2026-11-12 手稿）：價格、產量、收購客戶必填；地區、電話可空 */
  function closeProblem() {
    if (state.dealerClose) { // 0.4.42 盤商、種子商結案：洽談結果＋說明必填，送主管審核
      const sel = $('farmer').value;
      if (!sel || sel === '__new') return '請先選要結案的' + state.cat + '／ဖောက်သည် ရွေးပါ';
      const miss = [['dcOutcome', '洽談結果'], ['dcNote', '說明']].filter(([id]) => !String($n(id).value).trim()).map(([, n]) => n);
      return miss.length ? `結案要填：${miss.join('、')}／ပိတ်သိမ်းရန် ဖြည့်ပါ` : '';
    }
    if ((state.cat === '盤商' || state.cat === '種子商') && dealerSignOn()) return String($n('dcNote').value).trim() ? '' : '已簽約要寫簽約內容（簽了什麼、從什麼時候開始）／စာချုပ် အကြောင်းအရာ ရေးပါ'; // 0.4.75
    if (state.cat !== '結案') return '';
    // 業務BUG#3：農民結案只能選已經有的農民，不能在這裡新增（選單已拿掉「＋新增農民」，這裡再擋一次）
    const sel0 = $('farmer').value;
    if (!sel0 || sel0 === '__new') return '請先選要結案的農民／လယ်သမား ရွေးပါ';
    const miss = [['cPrice', '價格'], ['cYield', '產量'], ['cBuyer', '收購客戶']].filter(([id]) => !String($(id).value).trim()).map(([, n]) => n);
    if (miss.length) return `結案要填：${miss.join('、')}／ပိတ်သိမ်းရန် ဖြည့်ပါ`;
    // 2號 0.4.63 低#6：輸入框的 min=0 只有表單送出才擋，這裡自己檢查：價格、產量要大於 0（不能負數或 0）
    const bad = [['cPrice', '價格'], ['cYield', '產量']].filter(([id]) => !(Number($(id).value) > 0)).map(([, n]) => n);
    if (bad.length) return `${bad.join('、')}要大於 0／၀ ထက် ကြီးရမည်`;
    // 0.4.74 董事長「要，先填結果」：有進行中的試作／推廣 → 結果必填；失敗要填失敗紀錄。還沒查完不能送（不然會送出沒帶結果的結案）
    if (typeof document !== 'undefined' && document.getElementById('closeTrialBox')) { // 舊頁面沒有結果欄：照舊不擋（後台照舊寫「結束」）
      if (document.getElementById('measureBox')) { const mp = measureProblem(); if (mp) { $n('measureBox').open = true; return mp; } } // 0.4.80 中1：出錯時打開量測框 // 0.4.77 採收量測（選填，但填了要合理）
      if (state.closeTrialFor !== sel0) return '正在查這位農民有沒有進行中的試作…／စစ်ဆေးနေသည်';
      const ct = state.closeTrial;
      if (ct) {
        const o = $n('cTrialOutcome').value;
        if (o !== '成功' && o !== '失敗') return `請先選${ct.cat}結果（成功或失敗）／${CAT_MY[ct.cat] || ''} ရလဒ် ရွေးပါ`;
        if (o === '失敗') { const fm = failMissing(); if (fm.length) return `${ct.cat}失敗要填：${fm.join('、')}／မအောင်မြင်မှု မှတ်တမ်း မပြည့်စုံသေး`; }
      }
      // 0.4.75 結案勾了「這次發現種植失敗」：失敗紀錄全部必填（試作失敗時上面已經檢查過同一組，不重複；舊頁面沒有這個勾選）
      if (closePlantFailOn() && !closeTrialFailed()) { const fm = failMissing(); if (fm.length) return `種植失敗要填：${fm.join('、')}／မအောင်မြင်မှု မှတ်တမ်း မပြည့်စုံသေး`; }
    }
    return '';
  }
  /** 0.4.82 結案分頁的盤商結案／種子商結案：沒有自己負責的那一類就只提示；有就打開那一類的拜訪畫面（結案、只走已簽約） */
  async function signCloseOpen(cat) {
    if (cat !== '盤商' && cat !== '種子商') return;
    const me = String(((await getConfig()) || {}).name || '');
    const all = ((await Store.getMeta('farmers')) || []).concat((await Store.getMeta('localCustomers')) || []);
    if (!all.some(f => (f.type || '') === cat && (f.pending || !String(f.staff || '') || String(f.staff) === me))) {
      toast(`你沒有負責的${cat}／${cat === '盤商' ? 'ကုန်သည်' : 'မျိုးစေ့ဆိုင်'} မရှိပါ`); return;
    }
    state.closeGroup = ''; state.closeNext = true; state.signNext = true; state.lockNext = true;
    await openVisit(cat);
    refreshDealerSign(); refreshSave();
  }
  function collectClosing() {
    if (state.dealerClose) return { outcome: $n('dcOutcome').value, note: $n('dcNote').value.trim() }; // 0.4.42 盤商、種子商
    if ((state.cat === '盤商' || state.cat === '種子商') && dealerSignOn()) return { outcome: '簽約', note: $n('dcNote').value.trim() }; // 0.4.75 董事長：盤商、種子商以簽約才結案（後台由 2 號接受「簽約」）
    if (state.cat !== '結案') return null;
    // 0.4.62 董事長：結案加原因、進度（可不填；舊頁面沒有這兩格送空白）；0.4.74 加 group、trialResult（用 Object.assign，舊手機瀏覽器不支援物件展開）
    return Object.assign({ region: $('cRegion').value, price: $('cPrice').value.trim(), yield: $('cYield').value.trim(), buyer: $('cBuyer').value.trim(), phone: $('cPhone').value.trim(),
      reason: $n('cReason').value.trim(), progress: $n('cProgress').value.trim() }, closeTrialFields(),
      typeof document !== 'undefined' && document.getElementById('measureBox') && collectMeasure() ? { measure: collectMeasure() } : {}); // 0.4.77 採收量測（全空不送）
  }
  /** 0.4.74 董事長「要讓主管看到」＋「要，先填結果」：group 依送出當下這位農民的實際狀態（不看按哪一顆結案鈕）；trialResult 格式照 2 號約定 */
  function closeTrialFields() {
    const sel = $('farmer').value, ct = state.closeTrialFor === sel ? state.closeTrial : null;
    if (!ct) return { group: closeTrialGroup(null), trialResult: null };
    const group = closeTrialGroup(ct), outcome = $n('cTrialOutcome').value;
    if (outcome !== '成功' && outcome !== '失敗') return { group, trialResult: null }; // 舊頁面沒有結果欄：不送空結果（後台照舊寫「結束」）
    const tr = { id: ct.t.id, cat: ct.cat, outcome };
    if (outcome === '失敗') tr.failure = collectFailure();
    if (ct.t.pending) tr.startInfo = { item: ct.t.item, dosage: ct.t.dosage, start: ct.t.start }; // 開始那筆還沒上傳（後台目前不用，照約定附上）
    return { group, trialResult: tr };
  }
  /** 「打字」的範例：依這位農民現在的進度換（董事長 2026-11-12：業務報告依農民進度寫範例） */
  function noteExample() {
    const sel = $('farmer').value, t = state.activeTrial;
    const days = t && /^\d{4}-\d\d-\d\d/.test(String(t.start || '')) ? Math.floor((Date.now() - Date.parse(String(t.start).slice(0, 10))) / 86400000) : null;
    const wk = days == null ? null : Math.max(1, Math.ceil(days / 7));
    if (state.cat === '結案') return ['例：已賣給 Golden 糧行，價格比去年好，農民明年還要種', 'ဥပမာ - Golden ဆန်ဆိုင်သို့ ရောင်းပြီး၊ ဈေးကောင်း၊ နောက်နှစ် ဆက်စိုက်မည်'];
    if (state.cat === '種子商') return ['例：老闆想再多進一批種子，下週帶樣品和新品介紹過去', 'ဥပမာ - ဆိုင်ရှင်က မျိုးစေ့ ထပ်မှာချင်၊ နောက်အပတ် နမူနာ ယူလာမည်']; // 0.4.54 種子商沒有價格，範例改成匯報紀錄
    if (isDealerCat()) return ['例：店裡水稻種子賣得好，老闆想多進 A 品牌，價格比上月漲一點', 'ဥပမာ - စပါးမျိုး ရောင်းကောင်း၊ A တံဆိပ် ထပ်မှာချင်၊ ဈေး နည်းနည်းတက်'];
    if (sel === '__new') return ['例：第一次拜訪，種水稻 5 英畝，目前用尿素，對我們的肥料有興趣，下週帶樣品', 'ဥပမာ - ပထမအကြိမ်၊ စပါး ၅ ဧက၊ ယူရီးယားသုံး၊ နမူနာ နောက်အပတ် ယူလာမည်'];
    if (state.trialMode === 'start') return ['例：今天開始試作，A 肥料每英畝 2 包，旁邊留一塊不施當對照，秧苗高約 15 公分', 'ဥပမာ - ယနေ့ စတင်၊ A မြေသြဇာ တစ်ဧက ၂ အိတ်၊ နှိုင်းယှဉ်ကွက် ထား'];
    if (state.trialMode === 'end') return ['例：收割了，產量每英畝 60 籃，比對照區多 10 籃，農民願意明年繼續用', 'ဥပမာ - ရိတ်သိမ်းပြီး၊ တစ်ဧက ၆၀ တောင်း၊ ၁၀ တောင်း ပိုထွက်'];
    if ((state.cat === '試作' || state.cat === '推廣') && t && wk) {
      if (wk <= 3) return [`例：第 ${wk} 週，株高 30 公分，葉色比對照區綠，沒有病蟲害`, `ဥပမာ - အပတ် ${wk}၊ အမြင့် ၃၀ စင်တီ၊ အရွက်စိမ်း၊ ပိုးမရှိ`];
      if (wk <= 7) return [`例：第 ${wk} 週，分蘗變多，株高 55 公分，農民很滿意`, `ဥပမာ - အပတ် ${wk}၊ ပွားများ၊ အမြင့် ၅၅ စင်တီ၊ လယ်သမား ကျေနပ်`];
      return [`例：第 ${wk} 週，抽穗整齊，一穗約 120 粒，預計兩週後收割`, `ဥပမာ - အပတ် ${wk}၊ အနှံညီ၊ တစ်နှံ ၁၂၀ စေ့ခန့်၊ ၂ ပတ်အတွင်း ရိတ်မည်`];
    }
    if (state.cat === '推廣') return ['例：介紹 A 肥料給 3 位鄰居，大家覺得價格可以，下次帶報價單', 'ဥပမာ - အိမ်နီး ၃ ဦးကို မိတ်ဆက်၊ ဈေးလက်ခံ၊ နောက်တစ်ခါ ဈေးစာရင်း ယူလာမည်'];
    return ['例：作物長得正常，農民問什麼時候追肥，下次回訪帶施肥表', 'ဥပမာ - သီးနှံ ပုံမှန်၊ မြေသြဇာ ထပ်ကျွေးချိန် မေး၊ နောက်တစ်ခါ ဇယား ယူလာမည်'];
  }

  function collectTrial(tempId) {
    if (state.trialMode === 'start') return { op: 'start', tempId, item: trialItemValue(), dosage: $('tDosage').value.trim(), start: $('tStart').value };
    if (state.trialMode !== 'end' || !state.activeTrial) return null;
    const t = state.activeTrial;
    const o = { op: 'end', id: t.id, outcome: $('tOutcome').value, height: $('tHeight').value, grains: $('tGrains').value, yield: $('tYield').value,
      yieldUnit: $('tYieldUnit').value.trim(), score: $('tScore').value, comment: $('tComment').value.trim(), other: $('tOther').value.trim() };
    if (o.outcome === '失敗') o.failure = collectFailure();
    else o.harvest = { date: $('hDate').value, quality: $('hQuality').value, compare: $('hCompare').value.trim(), again: $('hAgain').value }; // 0.4.38 收成報告
    // 開始那筆還沒上傳：結束也帶著開始的資料，萬一順序顛倒後台照樣建得出來
    if (t.pending) o.startInfo = { item: t.item, dosage: t.dosage, start: t.start };
    return o;
  }
  function resetTrialForm() {
    ['tItem', 'tDosage', 'tStart', 'tHeight', 'tGrains', 'tYield', 'tYieldUnit', 'tComment', 'tOther', 'fTemp', 'fFert', 'fPestNote', 'fReason', 'tScore', 'fWeather', 'fWater', 'fPest', 'hDate', 'hQuality', 'hCompare', 'hAgain'].forEach(id => { $(id).value = ''; });
    refreshTrialOther(); // 0.4.89 品項下拉清空：「其他」文字框也收起清掉
    $('tOutcome').value = '成功';
    $('plantFail').checked = false; // 0.4.33
    state.activeTrial = null;
    state.closeTrial = null; state.closeTrialFor = null; $n('cTrialOutcome').value = ''; $n('closeTrialBox').hidden = true; // 0.4.74 換客戶：結案的試作結果也清掉、重查
    state.stageManual = false; $n('vStage').value = ''; // 0.4.78 換客戶：生長階段重新建議
    { const cb = $n('cPlantFail'); cb.checked = false; cb.disabled = false; state.plantFailAuto = false; } // 0.4.75 結案的種植失敗勾選也清掉
    setTrialMode(null);
    refreshPlantFail();
    $('trialBox').hidden = true;
  }

  /** 新客戶：全部欄位；舊客戶：只送有改的欄位 */
  function collectProfile() {
    const val = $('farmer').value;
    const p = {};
    activeKeys().forEach(k => { p[k] = String($n(PROFILE_INPUTS[k]).value || '').trim(); });
    if ('variety' in p) p.variety = varietyValue(); // 0.4.50
    // 0.4.73 董事長：盤商、種子商「品牌」改「作物」→ 畫面用 dcrop（pDCrop），送後台時改名成 crop（寫進主要作物欄，後台不用改）
    const toCrop = o => { if (o && 'dcrop' in o) { o.crop = o.dcrop; delete o.dcrop; } return o; };
    if (val === '__new') {
      p.type = isDealerCat() ? state.cat : '農民';
      return toCrop(p);
    }
    const changed = {};
    activeKeys().forEach(k => { if (state.original && p[k] !== String(state.original[k]).trim()) changed[k] = p[k]; });
    return Object.keys(changed).length ? toCrop(changed) : null;
  }

  /* ───── 定位 ───── */
  function locate() {
    const box = $('gps');
    state.gps = null;
    // 0.4.33 董事長：測試期間定位先「假打開」（在電腦上測開始新的試作）。config.js 有 testFakeGps 才生效，正式上線前拿掉
    const fake = typeof FARM_CONFIG !== 'undefined' && FARM_CONFIG.testFakeGps;
    if (fake && isFinite(fake.lat) && isFinite(fake.lng)) {
      state.gps = { lat: Number(fake.lat), lng: Number(fake.lng), acc: 0 };
      box.innerHTML = `📍 <b>測試用假定位</b> ${state.gps.lat}, ${state.gps.lng}（正式上線前會關掉）／စမ်းသပ်ရန် တည်နေရာ`;
      return Promise.resolve();
    }
    if (!('geolocation' in navigator)) { box.textContent = '📍 這支手機不支援定位，會標記「無定位」／ဤဖုန်း တည်နေရာ မရ'; return Promise.resolve(); }
    box.textContent = '📍 定位中…（最多 30 秒）တည်နေရာ ရှာနေသည်';
    return new Promise(done => navigator.geolocation.getCurrentPosition(p => {
      state.gps = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) };
      box.innerHTML = `📍 已定位 တည်နေရာရပြီ <b>${state.gps.lat}, ${state.gps.lng}</b>（誤差 ±${state.gps.acc} m）`;
      done();
    }, err => {
      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      box.innerHTML = err.code === 1
        ? '📍 <b style="color:var(--chili)">定位被關掉了 တည်နေရာ ပိတ်ထားသည်</b>，打卡會標記「無定位」。' + (isIOS
          ? '請到 iPhone「設定 → 隱私權與安全性 → 定位服務」打開，並把「Safari 網站」（或 Chrome）設成「使用 App 期間」，再回來按「重新定位」。'
          : '請按網址列左邊的圖示 →「權限」→ 允許「位置」，並確認手機的定位服務是開的，再按「重新定位」。')
        : '📍 抓不到位置（可能訊號不好），仍可儲存，會標記「無定位」。可以到空曠處按「重新定位」。／တည်နေရာ မရပါ၊ သိမ်းနိုင်သည်။ ကွင်းပြင်တွင် ပြန်ရှာပါ။';
      done();
    }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 }));
  }

  /* ───── 照片：讀拍攝時間與照片定位、壓縮、印浮水印 ───── */
  /** 讀 JPEG 的拍攝時間（0x9003）和 GPS；讀不到的欄位就是 null */
  function exifInfo(buf) {
    const out = { date: null, lat: null, lng: null };
    try {
      const v = new DataView(buf);
      if (v.getUint16(0) !== 0xFFD8) return out;
      let off = 2;
      while (off < v.byteLength - 4) {
        const marker = v.getUint16(off), size = v.getUint16(off + 2);
        if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) {
          const t = off + 10, le = v.getUint16(t) === 0x4949;
          const u16 = o => v.getUint16(t + o, le), u32 = o => v.getUint32(t + o, le);
          const readStr = (o, n) => { let s = ''; for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint8(t + o + i)); return s; };
          const findTag = (ifd, tag) => {
            const n = u16(ifd);
            for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (u16(e) === tag) return e; }
            return -1;
          };
          const ifd0 = u32(4);
          const exifPtr = findTag(ifd0, 0x8769);
          if (exifPtr >= 0) {
            const dt = findTag(u32(exifPtr + 8), 0x9003);
            if (dt >= 0) {
              const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(readStr(u32(dt + 8), u32(dt + 4)));
              if (m) out.date = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
            }
          }
          const gpsPtr = findTag(ifd0, 0x8825);
          if (gpsPtr >= 0) {
            const g = u32(gpsPtr + 8);
            const rat = (e, i) => { const o = u32(e + 8) + i * 8; const d = u32(o + 4); return d ? u32(o) / d : NaN; };
            const dms = e => rat(e, 0) + rat(e, 1) / 60 + rat(e, 2) / 3600;
            const ref = e => String.fromCharCode(v.getUint8(t + e + 8));
            const la = findTag(g, 2), lo = findTag(g, 4), laR = findTag(g, 1), loR = findTag(g, 3);
            if (la >= 0 && lo >= 0) {
              const lat = dms(la) * (laR >= 0 && ref(laR) === 'S' ? -1 : 1), lng = dms(lo) * (loR >= 0 && ref(loR) === 'W' ? -1 : 1);
              if (isFinite(lat) && isFinite(lng) && (lat || lng)) { out.lat = +lat.toFixed(6); out.lng = +lng.toFixed(6); }
            }
          }
          return out;
        }
        off += 2 + size;
      }
    } catch (e) { /* 格式不認得就當沒有 */ }
    return out;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const fmtTime = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  /** 一張照片 → { blob, check, source }。相機：檢查是不是現場即時拍；相簿：記下照片本身的拍攝時間和定位 */
  async function processPhoto(file, source) {
    const info = exifInfo(await file.slice(0, 256 * 1024).arrayBuffer());
    // iPhone 會把照片裡的拍攝時間拿掉，這時改看檔案時間
    const taken = info.date || (file.lastModified ? new Date(file.lastModified) : null);
    const old = taken && Math.abs(Date.now() - taken.getTime()) > 10 * 60 * 1000;
    let check;
    if (source === '相機') check = old ? '非現場即時拍攝（可能是相簿舊圖）' : '現場拍攝';
    else {
      const parts = [taken ? '拍攝 ' + fmtTime(taken) : '沒有拍攝時間'];
      if (info.lat !== null) parts.push('照片定位 ' + info.lat + ',' + info.lng);
      if (old) parts.push('非當下拍攝');
      check = parts.join('，');
    }

    const img = await loadImage(file);
    const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(img.src);
    const lines = source === '相機'
      ? [fmtTime(new Date()), state.gps ? `${state.gps.lat}, ${state.gps.lng} ±${state.gps.acc}m` : '無定位']
      : ['相簿上傳｜' + (taken ? '拍攝 ' + fmtTime(taken) : '沒有拍攝時間'), info.lat !== null ? `照片定位 ${info.lat}, ${info.lng}` : '照片沒有定位'];
    if (source === '相機' && check !== '現場拍攝') lines.push('⚠ ' + check);
    const fs = Math.max(14, Math.round(w / 40));
    ctx.font = `600 ${fs}px sans-serif`;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0, h - (lines.length * fs * 1.35 + fs * .6), w, lines.length * fs * 1.35 + fs * .6);
    ctx.fillStyle = '#fff';
    lines.forEach((l, i) => ctx.fillText(l, fs * .6, h - fs * .5 - (lines.length - 1 - i) * fs * 1.35));
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.75));
    if (!blob) throw new Error('壓縮失敗');
    return { blob, check, source };
  }

  /** 0.4.71 董事長：新增客戶表單的「GPS 座標」在拍照時自動帶入（只顯示、不能手打；真正存進客戶清單的田區座標照舊由這筆拜訪的定位寫入） */
  function fillGpsBox() {
    if ($('farmer').value !== '__new') return;
    const g = state.gps;
    $n('pGps').value = g ? `${g.lat}, ${g.lng}${g.acc ? `（±${g.acc} m）` : ''}` : '沒有定位／တည်နေရာ မရ';
  }
  async function addPhotos(files, source, btn) {
    const list = [...(files || [])];
    if (!list.length) return;
    const gen = state.formGen;
    const room = MAX_PHOTOS - state.photos.length - state.busyPhotos; // 0.4.87 中4：還在處理的也要扣（兩批同時處理會超過 6 張，後台只收前 6 張）
    if (room <= 0) { toast(`一次拜訪最多 ${MAX_PHOTOS} 張照片／ဓာတ်ပုံ အများဆုံး ${MAX_PHOTOS} ပုံ`); return; }
    if (list.length > room) toast(`最多 ${MAX_PHOTOS} 張，只取前 ${room} 張／ပထမ ${room} ပုံသာ ယူမည်`);
    btn.classList.add('busy');
    const todo = list.slice(0, room);
    state.busyPhotos += todo.length;
    refreshSave();
    let failed = 0;
    for (const f of todo) {
      let p;
      try { p = await processPhoto(f, source); } catch (e) { failed++; }
      if (gen !== state.formGen) { btn.classList.remove('busy'); return; } // 已經離開這一筆拜訪，照片不要掉進下一筆（計數已在清表單時歸零）
      state.busyPhotos = Math.max(0, state.busyPhotos - 1);
      if (!p) continue;
      state.photos.push(p);
      if (source === '相機') fillGpsBox(); // 0.4.71 董事長：拍照時 GPS 座標自動帶入（新增客戶表單）
      renderThumbs(); refreshSave();
    }
    btn.classList.remove('busy');
    if (failed) toast(`有 ${failed} 張照片讀不了（可能是 HEIC 格式），請改拍或換一張／ဓာတ်ပုံ ${failed} ပုံ ဖွင့်မရ၊ ပြန်ရိုက်ပါ`);
    renderThumbs();
    refreshSave();
  }

  /** 0.4.78 生長階段下拉：一般／試作／推廣農民、有見到、至少一張照片才出現；還沒自己選過就依種植日期建議 */
  function refreshStage() {
    const box = $n('stageBox'), sel = $n('vStage'), f = $('farmer').value;
    const show = groupOf(state.cat) === 'farmer' && state.cat !== '結案' && !!f && !noMeetOn() && state.photos.length > 0;
    box.hidden = !show;
    if (!show) return;
    const c = (state.allCustomers || []).find(x => x.id === f) || {};
    const pd = f === '__new' ? $n('pPlantDate').value : c.plantDate;
    const g = stageGuess(pd, mmDay(0));
    if (!state.stageManual) sel.value = g;
    $n('stageHint').textContent = g ? `依種植日期建議：${g}（可以改）／အကြံပြု：${STAGE_MY[g]}` : '沒有種植日期，請自己選／ကိုယ်တိုင် ရွေးပါ';
  }
  /** 送出的生長階段：結案一律「採收」；農民拜訪看下拉（只收 7 個值）；其他空白 */
  function visitStage() {
    if (state.cat === '結案') return '採收';
    const v = $n('vStage').value;
    return !$n('stageBox').hidden && STAGES.indexOf(v) >= 0 ? v : '';
  }
  function renderThumbs() {
    // 0.4.80 1號清單（交接單原記「原因未查」的 ERR_FILE_NOT_FOUND）：原本每次重畫都先釋放上一輪的 blob 網址、再全部重建，
    // addPhotos 連續重畫兩次時，第一輪縮圖還在載入就被釋放 → 主控台錯誤。改成每張照片的網址建一次重複用，只釋放「已經不在畫面上」的
    const prev = state.thumbUrls || [];
    state.thumbUrls = state.photos.map(p => p.thumbUrl || (p.thumbUrl = URL.createObjectURL(p.blob)));
    prev.forEach(u => { if (state.thumbUrls.indexOf(u) < 0) URL.revokeObjectURL(u); }); // 刪掉的照片、換客戶清掉的照片才釋放
    $('thumbs').innerHTML = state.photos.map((p, i) => `<div class="thumb"><img src="${state.thumbUrls[i]}" alt="照片 ${i + 1}"><span class="tag">${p.source === '相簿' ? '相簿 ဓာတ်ပုံ' : '相機 ကင်မရာ'}</span><button type="button" class="del" data-i="${i}" aria-label="刪掉這張">×</button></div>`).join('');
    $('thumbs').querySelectorAll('.del').forEach(b => b.addEventListener('click', () => { state.photos.splice(Number(b.dataset.i), 1); renderThumbs(); refreshSave(); }));
    $('photoBtn').classList.toggle('done', state.photos.some(p => p.source === '相機'));
    $('albumBtn').classList.toggle('done', state.photos.some(p => p.source === '相簿'));
    if (typeof refreshStage === 'function') refreshStage(); // 0.4.78 有照片才出現生長階段（舊測試只抽 renderThumbs，沒有這個函式時略過）
  }

  /* ───── 錄音：錄完轉成 16kHz 單聲道 WAV（約 32 KB／秒） ───── */
  async function toWav16k(blob) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const decoded = await ac.decodeAudioData(await blob.arrayBuffer());
    ac.close && ac.close();
    const rate = 16000;
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
    const src = off.createBufferSource();
    src.buffer = decoded; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const buf = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true); }
    return new Blob([buf], { type: 'audio/wav' });
  }

  async function toggleRec() {
    const btn = $('recBtn');
    if (state.rec) { state.rec.stop(); return; }
    // 0.4.87 中5（第11任 0.4.86 清單）：麥克風權限還沒回來時連按兩下會開兩個錄音器，第一個停不掉 → 一進來就設「啟動中」；處理錄音中也不能再開新的
    if (state.recStarting || state.recBusy) return;
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('這支手機的瀏覽器不支援錄音／ဤဖုန်း အသံသွင်း မရ'); return; }
    state.recStarting = true;
    let stream, rec;
    const gen = state.formGen;
    try {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) { toast('沒有麥克風權限，請到瀏覽器設定允許麥克風／မိုက်ခရိုဖုန်း ခွင့်ပြုချက် ပေးပါ'); return; }
      if (gen !== state.formGen) { stream.getTracks().forEach(t => t.stop()); return; } // 等權限的途中已經換客戶、回首頁：不開
      try { rec = new MediaRecorder(stream); }
      catch (e) { stream.getTracks().forEach(t => t.stop()); toast('這支手機錄不了音，請改用打字／အသံသွင်း မရ၊ စာရိုက်ပါ'); return; } // 0.4.87：建錄音器失敗要關麥克風
    } finally { state.recStarting = false; }
    const chunks = [];
    state.rec = rec; state.audioSec = 0; state.audio = null;
    rec.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
    rec.onstop = async () => {
      clearInterval(state.recTimer);
      stream.getTracks().forEach(t => t.stop());
      if (state.rec === rec) state.rec = null;
      if (gen !== state.formGen) return; // 錄到一半回首頁：這段錄音作廢，不能掉進下一筆拜訪（2026-11-11 抓到）
      // 0.4.87 高2：按停到轉檔完成的空窗也算「有填東西」（visitDirty、存檔鈕、返回確認都看 recBusy），換客戶會問、會換世代，錄音不會掉到下一位
      state.recBusy = rec; refreshSave();
      try {
        btn.classList.remove('rec');
        btn.querySelector('.label').textContent = '處理錄音中… အသံ ပြင်ဆင်နေ';
        const raw = new Blob(chunks, { type: rec.mimeType || 'audio/mp4' });
        let audio;
        try { audio = await toWav16k(raw); }
        catch (e) { audio = raw; } // 轉不了就送原檔，後台再判斷
        if (gen !== state.formGen) return;
        state.audio = audio;
        btn.classList.add('done');
        btn.querySelector('.label').innerHTML = `✓ 已錄 ${state.audioSec} 秒<br>${state.audioSec} စက္ကန့် သွင်းပြီး`;
      } finally { if (state.recBusy === rec) state.recBusy = null; refreshSave(); }
    };
    rec.start(1000);
    btn.classList.add('rec'); btn.classList.remove('done');
    btn.querySelector('.label').textContent = '錄音中 0 秒・再按一下結束／ရပ်ရန် ထပ်နှိပ်';
    state.recTimer = setInterval(() => {
      state.audioSec++;
      btn.querySelector('.label').textContent = `錄音中 ${state.audioSec} 秒・再按結束／ရပ်ရန် ထပ်နှိပ်`;
      if (state.audioSec >= MAX_REC_SEC) rec.stop();
    }, 1000);
    refreshSave();
  }

  /* ───── 盤商價格 ───── */
  const MAX_PRICES = 20; // 跟後台 Code.gs 的 MAX_PRICES 一樣：超過的後台收不了（第七輪 B-03）
  function refreshPriceBtn() {
    const full = $('priceRows').children.length >= MAX_PRICES;
    $('addPriceBtn').disabled = full;
    $('addPriceBtn').textContent = full ? `一次最多記 ${MAX_PRICES} 筆價格／အများဆုံး ${MAX_PRICES} ခု` : '＋ 加一筆價格／ဈေးနှုန်း ထပ်ထည့်';
  }
  /** 0.4.89 價格列作物下拉的選項：文字「中文／緬文」（cropText）、value 中文作物名，最後「其他（自己填）」 */
  function priceCropOptions() {
    const crops = (state.options && state.options.crops) || [];
    return `<option value="">作物 သီးနှံ</option>${crops.map(c => `<option value="${esc(c)}">${esc(cropText(c))}</option>`).join('')}<option value="${TRIAL_OTHER}">其他（自己填）／အခြား</option>`;
  }
  /** 打卡畫面打開時第一列價格會比作物選項先建（resetForm 早於 loadOptions）→ 選項載入後把已經有的列補上，選好的保留 */
  function refreshPriceCrops() {
    const box = document.getElementById('priceRows');
    if (!box) return;
    box.querySelectorAll('.pcs').forEach(s => { const keep = s.value; s.innerHTML = priceCropOptions(); s.value = keep; if (s.value !== keep) s.value = ''; });
  }
  function addPriceRow(p) {
    if ($('priceRows').children.length >= MAX_PRICES) { refreshPriceBtn(); return; }
    const unit = (state.options && state.options.priceUnit) || '緬幣／籃';
    const div = document.createElement('div');
    div.className = 'price-row';
    // 0.4.89 董事長截圖：作物欄原本是輸入框＋清單（只顯示中文）→ 改成下拉，顯示「中文／緬文」（同上面作物下拉的 cropText），最後「其他（自己填）」；
    // 存的值照舊只存中文作物名：真正送出的還是 .pc（選作物時寫進中文名、選其他時變成文字框讓業務自己打）
    div.innerHTML = `<div class="pcw"><select class="pcs" aria-label="作物">${priceCropOptions()}</select>
      <input type="text" class="pc" placeholder="自己填作物 သီးနှံ" maxlength="40" hidden></div>
      <input type="text" class="pv" list="dlVarieties" placeholder="品種 မျိုး（可空白）" maxlength="80">
      <input type="number" class="pp" min="0" step="any" inputmode="decimal" placeholder="價格 ဈေးနှုန်း">
      <input type="text" class="pu" maxlength="30">
      <button type="button" class="del" aria-label="刪掉這筆價格">×</button>`;
    div.querySelector('.pu').value = (p && p.unit) || unit;
    const pcs = div.querySelector('.pcs'), pc = div.querySelector('.pc');
    pcs.addEventListener('change', () => { // 0.4.89：選作物 → .pc 存中文名（藏著）；選「其他」→ .pc 變成文字框自己打
      const other = pcs.value === TRIAL_OTHER;
      pc.hidden = !other; pc.value = other ? '' : pcs.value;
      if (other) { try { pc.focus(); } catch (e) { /* 舊瀏覽器 */ } }
      refreshSave();
    });
    div.querySelector('.del').addEventListener('click', () => { div.remove(); refreshPriceBtn(); refreshSave(); });
    div.querySelectorAll('input').forEach(i => i.addEventListener('input', refreshSave));
    $('priceRows').appendChild(div);
    refreshPriceBtn();
  }
  function collectPrices() {
    if (state.cat !== '盤商' || noMeetOn() || state.dealerClose) return []; // 0.4.41 董事長：種子商不用價格（從盤商切過來時藏起來的價格也不送）
    return [...$('priceRows').querySelectorAll('.price-row')].map(r => ({
      crop: r.querySelector('.pc').value.trim(), variety: r.querySelector('.pv').value.trim(),
      price: r.querySelector('.pp').value.trim(), unit: r.querySelector('.pu').value.trim()
    })).filter(p => (p.crop || p.variety) && p.price !== '' && isFinite(Number(p.price)) && Number(p.price) >= 0);
  }
  /**
   * 1號清單低#5（第8任 2026-11-12）：價格填負數（或只填一半）時，手機原本照樣讓存、後台 num_ 只收 ≥0 就默默丟掉，留下一筆空白拜訪。
   * → 有填卻不合格的價格列，擋存檔並說哪裡錯（全空的列、只有預設單位的列不算）
   */
  function priceProblem() {
    if (state.cat !== '盤商' || noMeetOn() || state.dealerClose) return '';
    for (const r of [...$('priceRows').querySelectorAll('.price-row')]) {
      const crop = r.querySelector('.pc').value.trim() || r.querySelector('.pv').value.trim();
      const pp = r.querySelector('.pp'), price = pp.value.trim(), bad = !!(pp.validity && pp.validity.badInput); // 數字框打了不是數字的字：value 會是空的
      if (!crop && !price && !bad) continue;
      if (!crop) return '價格那一列要填作物／ဈေးနှုန်း သီးနှံ ဖြည့်ပါ';
      if (bad || price === '') return `「${crop}」的價格沒填或不是數字／ဈေးနှုန်း ဖြည့်ပါ`;
      if (!isFinite(Number(price)) || Number(price) < 0) return `「${crop}」的價格不能是負數／ဈေးနှုန်း အနုတ် မဖြစ်ရ`;
    }
    return '';
  }

  /* ───── 儲存＋自動上傳 ───── */
  function refreshSave() {
    const sel = $('farmer').value;
    const isNew = sel === '__new';
    const nameOk = !isNew || $('pName').value.trim();
    const hasContent = noMeetOn() || state.photos.length || state.audio || $('note').value.trim() || collectPrices().length || state.trialMode || ((state.cat === '結案' || state.dealerClose || dealerSignOn()) && !closeProblem()) || (sel && sel !== '__new' && collectProfile());
    $('note').placeholder = noteExample().join('\n'); // 範例跟著農民進度換
    const tp = noMeetProblem() || trialProblem() || closeProblem() || priceProblem() || profileProblem();
    const signNeed = !!state.signOnly && !dealerSignOn(); // 0.4.82 結案分頁的盤商、種子商結案：一定要走「已簽約」才能送（沒見到、還沒按有見到都不能存）
    const ok = sel && nameOk && !state.rec && !state.recBusy && !state.busyPhotos && !tp && (isNew || hasContent) && !signNeed && !state.saving; // 業務BUG#4：存檔途中（等定位最多 15 秒）不能再按
    $('saveBtn').disabled = !ok;
    // 2號 0.4.69 低7（第8任）：存檔中按鈕停用時，提示原本落到「至少做一樣」→ 先說存檔中
    $('saveHint').textContent = !sel ? '' : state.saving ? '存檔中，請稍等…／သိမ်းနေသည်' : !nameOk ? '請先填名字／အမည် အရင်ဖြည့်ပါ' : state.recBusy ? '錄音處理中，請稍等…／အသံ ပြင်ဆင်နေ' : state.rec ? '錄音中，先按一下結束錄音／အသံသွင်းနေသည်၊ အရင် ရပ်ပါ' : state.busyPhotos ? `照片處理中（還有 ${state.busyPhotos} 張）… ဓာတ်ပုံ ပြင်ဆင်နေ` : tp ? tp : signNeed ? '盤商、種子商結案：先按「有見到」，再寫簽約內容／ တွေ့ပြီး ကိုနှိပ်ပြီး စာချုပ် အကြောင်းအရာ ရေးပါ' : !ok ? `拍照、上傳照片、錄音、打字${state.cat === '盤商' ? '、記價格' : ''}${$('farmer').value === '__new' || SHOW_PROFILE_ON_VISIT ? '（或改客戶資料）' : ''}至少做一樣／ဓာတ်ပုံ၊ အသံ၊ စာ တစ်ခုခု လုပ်ပါ` : '';
  }

  /**
   * 業務BUG#4（2號小助手推論，第7任讀程式確認）：存檔要等定位最多 15 秒，這段時間打字會觸發 refreshSave 把按鈕又打開，
   * 再按一次就跑第二個 save，兩筆不同編號都存下來。→ 外面包一層「存檔中」鎖：同時只跑一個，結束（不管成功、取消、失敗）一定解鎖
   */
  async function save() {
    if (state.saving) return;
    state.saving = true;
    try { await saveOnce(); } finally { state.saving = false; refreshSave(); }
  }
  async function saveOnce() {
    $('saveBtn').disabled = true;
    const cfg = await getConfig();
    if (!cfg || !cfg.deviceKey) { showLogin('請先登入／အရင် ဝင်ပါ'); return; }
    // 等定位最多 15 秒：這段時間回首頁（表單被清掉）或改選客戶，這次就不存，不然會存成空白客戶或掛到別人名下（第二輪自行審查 T2）
    const gen0 = state.formGen, sel0 = $('farmer').value;
    if (!state.gps) { toast('再抓一次位置… တည်နေရာ ပြန်ရှာနေ'); await Promise.race([locate(), new Promise(r => setTimeout(r, 15000))]); }
    if (gen0 !== state.formGen || $('farmer').value !== sel0) { toast('等定位時換了畫面或客戶，這次沒有存，請再按一次儲存／မသိမ်းရသေး၊ ထပ်နှိပ်ပါ'); refreshSave(); return; }
    if (!sel0) { toast('請先選客戶／ဖောက်သည် ရွေးပါ'); refreshSave(); return; }
    // 0.4.33 董事長：怕業務結案按錯 → 送出前再確認一次（寫出農民、價格、產量、收購客戶）
    if (state.cat === '結案') {
      const who = ($('farmer').selectedOptions && $('farmer').selectedOptions[0] ? $('farmer').selectedOptions[0].text : '') || $('pName').value;
      const msg = `確定要把這位農民結案嗎？\nလယ်သမား ပိတ်သိမ်းမှာ သေချာပါသလား\n\n農民：${who}\n價格：${$('cPrice').value}\n產量：${$('cYield').value}\n收購客戶：${$('cBuyer').value}\n\n${state.options && state.options.closeConfirm ? '送出後要等主管確認才算結案。' : '存檔後這位農民就結案，不再提醒回訪。'}`;
      if (!confirm(msg)) { refreshSave(); return; }
    }
    if (dealerSignOn()) { // 0.4.75 盤商、種子商已簽約：送出前確認
      const who = $('farmer').selectedOptions && $('farmer').selectedOptions[0] ? $('farmer').selectedOptions[0].text : '';
      if (!confirm(`確定已簽約、送主管確認後結案嗎？
စာချုပ်ချုပ်ပြီး မန်နေဂျာထံ ပို့မှာ သေချာပါသလား

${state.cat}：${who}
簽約內容：${$n('dcNote').value.trim()}`)) { refreshSave(); return; }
    }
    if (state.dealerClose) { // 0.4.42 盤商、種子商結案：送出前確認
      const who = $('farmer').selectedOptions && $('farmer').selectedOptions[0] ? $('farmer').selectedOptions[0].text : '';
      if (!confirm(`確定要送主管審核結案嗎？
မန်နေဂျာထံ ပိတ်သိမ်းရန် ပို့မှာ သေချာပါသလား

${state.cat}：${who}
洽談結果：${$n('dcOutcome').value}
說明：${$n('dcNote').value.trim()}`)) { refreshSave(); return; }
    }
    const sel = $('farmer').value;
    const isNew = sel === '__new';
    const now = Date.now(), d = new Date(now);
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const rand = Math.random().toString(36).slice(2, 7);
    const tag = cfg.deviceKey.slice(0, 6);
    let profile = collectProfile();
    const changed = isNew ? null : profile; // 這次改了哪些欄位（舊客戶）
    // 對「還沒上傳的新客戶」再記一次拜訪：這一筆也帶完整的客戶資料。
    // 萬一第一筆上傳失敗、這一筆先到，後台照樣建出正確的客戶，不會變成「（未命名）」（2026-11-11 另一家審查 R1-01）
    let tempName = isNew ? profile.name : '';
    if (!isNew && String(sel).startsWith('T_')) {
      const local = ((await Store.getMeta('localCustomers')) || []).find(l => l.id === sel);
      if (local) {
        const base = {};
        Object.keys(local).forEach(k => { if (['id', 'pending'].indexOf(k) < 0) base[k] = local[k]; });
        profile = Object.assign(base, profile || {});
        tempName = profile.name || '';
      }
    }
    const name = isNew ? profile.name : ($('farmer').selectedOptions[0].textContent.split('｜')[0]);
    const farmerId = isNew ? `T_${tag}_${stamp}_${rand}${Math.random().toString(36).slice(2, 6)}` : sel; // 加亂數：同一秒新增兩位不撞號（G06）
    const visit = {
      id: `${tag}_${stamp}_${rand}`,
      account: cfg.account || '',
      category: state.cat === '結案' ? '農戶' : state.cat, // 結案記成農民拜訪（統計照舊），另外帶 closing
      closing: collectClosing(),
      plantFailure: plantFailOn() || closePlantFailOn() ? collectFailure() : null, // 0.4.33 一般拜訪的種植失敗；0.4.75 改在農民結案勾（試作失敗時自動帶同一份）
      noMeet: collectNoMeet(), // 0.4.38 沒見到農民／農民拒絕 → 下次再訪
      farmerId,
      tempName,
      farmerLabel: `【${state.cat}】${name}${isNew ? '（新）' : ''}`,
      profile,
      text: noMeetOn() ? '' : $('note').value.trim(),
      stage: noMeetOn() ? '' : visitStage(), // 0.4.78 生長階段（結案＝採收）
      prices: collectPrices(),
      trial: noMeetOn() ? null : collectTrial(`T_${tag}_${stamp}_tr${rand}`),
      // 一般拜訪也記下「存檔當下進行中的試作」：試作之後結束了，晚到的這筆照樣掛回去（GPT-6.1 R2-07）
      trialRef: !state.trialMode && (state.cat === '試作' || state.cat === '推廣') && state.activeTrial ? state.activeTrial.id : '',
      deviceTime: now,
      clockOffset: (await Store.getMeta('clockOffset')) || 0,
      lat: state.gps ? state.gps.lat : null, lng: state.gps ? state.gps.lng : null, accuracy: state.gps ? state.gps.acc : null,
      photos: state.photos.map(p => ({ blob: p.blob, check: p.check, source: p.source })),
      audio: state.audio, audioSec: state.audioSec,
      status: 'pending'
    };
    // 拜訪本身、試作暫存、新客戶暫存在「同一個交易」裡一起存（GPT-6.1 R6-02）：
    // 原本分開讀寫，背景程式剛好在清理暫存時，會用舊清單把剛建的新客戶從選單洗掉
    const metaFns = {};
    if (visit.trial) {
      // 試作也先記在手機：開始的（下一次拜訪看得到進行中）、結束的（不要再顯示進行中）
      const tr = visit.trial, cat = state.cat;
      metaFns.localTrials = cur => {
        const lt = (cur || []).slice();
        if (tr.op === 'start') lt.push({ id: tr.tempId, cid: farmerId, cat, item: tr.item, dosage: tr.dosage, start: tr.start, pending: true });
        else { const i = lt.findIndex(l => l.id === tr.id); if (i >= 0) lt[i] = Object.assign({}, lt[i], { ended: true }); else lt.push({ id: tr.id, ended: true }); }
        return lt;
      };
      visit.farmerLabel += tr.op === 'start' ? `・開始${cat}` : `・結束${cat}（${tr.outcome}）`;
    }
    const ctr = visit.closing && visit.closing.trialResult; // 0.4.80 低2：結案填了試作結果 → 手機這件試作馬上算結束（我的試作、我的進度不再當進行中）
    if (ctr && ctr.id && !metaFns.localTrials) metaFns.localTrials = cur => { const lt = (cur || []).slice(); const i = lt.findIndex(l => l.id === ctr.id); if (i >= 0) lt[i] = Object.assign({}, lt[i], { ended: true }); else lt.push({ id: ctr.id, ended: true }); return lt; };
    if (isNew) {
      // 還沒上傳前，新客戶先放在手機的選單裡，下一次拜訪也選得到
      const rec = Object.assign({}, profile, { id: farmerId, pending: true });
      metaFns.localCustomers = cur => (cur || []).concat([rec]);
    } else if (changed && String(farmerId).startsWith('T_')) {
      // 還沒上傳的新客戶改了資料：手機裡的暫存客戶也要寫回，
      // 否則下一次拜訪會用建立當時的舊資料整包重送，把這次的修改蓋掉（第七輪 B-01）
      metaFns.localCustomers = cur => (cur || []).map(l => (l.id === farmerId ? Object.assign({}, l, changed) : l));
    }
    try {
      await Store.saveVisit(visit, metaFns);
    } catch (e) {
      toast('手機存檔失敗（可能空間不足），資料還在畫面上，請再按一次／သိမ်း၍ မရ၊ ထပ်နှိပ်ပါ');
      refreshSave();
      return;
    }
    resetForm();
    toast('已存在手機裡，會自動上傳／ဖုန်းထဲ သိမ်းပြီး၊ အလိုအလျောက် တင်မည်');
    await showHome();
    requestBackgroundSync();
    syncNow();
  }

  function resetForm() {
    state.formGen++;
    // 0.4.54 第6任檢查：上一位客戶的進度卡、作物四格會殘留到下一次打卡畫面 → 進畫面就清掉
    const pbx = $('progressBox'); if (pbx) { pbx.hidden = true; pbx.innerHTML = ''; }
    { const hb = $n('closeVisitHist'); hb.hidden = true; hb.innerHTML = ''; hb._tok = null; } // 0.4.73 結案過往紀錄也清掉
    hideHist('visitHistory'); // 0.4.75 田間打卡過往紀錄也清掉
    state.cropOpen = false; $n('cropBox').hidden = true; $n('cropSum').hidden = true;
    ['cPrice', 'cYield', 'cBuyer', 'cPhone'].forEach(id => { $(id).value = ''; });
    ['cReason', 'cProgress'].forEach(id => { $n(id).value = ''; }); // 0.4.62 原因、進度也清掉
    MEASURE_IDS.forEach(id => { $n(id).value = ''; }); $n('mCountUnit').value = '穗'; $n('mLenUnit').value = '英寸'; // 0.4.77 採收量測也清掉
    $('cRegion').innerHTML = '<option value="">— 選擇地區 ဒေသရွေးပါ —</option>' + ((state.options && state.options.regions) || []).map(x => `<option>${esc(x)}</option>`).join('');
    state.busyPhotos = 0;
    clearInterval(state.recTimer);
    if (state.rec) { try { state.rec.stop(); } catch (e) { /* 已經停了 */ } state.rec = null; }
    $('recBtn').classList.remove('rec');
    $('photoBtn').classList.remove('busy'); $('albumBtn').classList.remove('busy');
    state.photos = []; state.audio = null; state.audioSec = 0; state.original = null;
    renderThumbs();
    $('photoInput').value = ''; $('albumInput').value = '';
    $('recBtn').classList.remove('done');
    $('recBtn').querySelector('.label').textContent = '錄音';
    $('note').value = '';
    $('priceRows').innerHTML = '';
    if (isDealerCat()) addPriceRow();
    $('farmer').value = '';
    $('profileBox').hidden = true;
    Object.values(PROFILE_INPUTS).forEach(id => { $n(id).value = ''; });
    resetTrialForm();
    state.dealerClose = false; $n('dcOutcome').value = ''; $n('dcNote').value = ''; $n('dcSigned').checked = false; applyCatLabels(); // 0.4.42 存完回到一般拜訪；0.4.75 已簽約也取消
    resetNoMeet();
    refreshSave();
  }

  async function requestBackgroundSync() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg.sync) await reg.sync.register('upload-visits');
    } catch (e) { /* iPhone 不支援，靠打開網頁時自動補傳 */ }
  }

  let syncing = false;
  /**
   * 0.4.87 高1（app.js 那半）＋中6：同步回「登入失效」時——
   * ① 先重讀 config：裝置金鑰已經不是送出時那把（上一位登出、換人登入了），這是上一位晚到的回應，什麼都不動（不能把新帳號踢回登入）
   * ② 正在打卡畫面而且有填東西：先提示、保留表單；等離開打卡畫面（回首頁）才清登入、跳登入頁
   * ③ 其他：照舊清掉裝置金鑰、跳登入頁（沒上傳的資料留在手機）
   */
  async function onLoginExpired(sentKey, msg) {
    const now = (await Store.getMeta('config')) || {};
    if (!now.deviceKey || now.deviceKey !== sentKey) return 'stale';
    if (state.view === 'visit' && formDirty()) {
      state.loginLost = { key: sentKey, msg };
      toast('登入已失效：這一筆可以先存在手機裡，回首頁後再重新登入／ဝင်ရောက်မှု သက်တမ်းကုန်၊ ပြန်ဝင်ပါ');
      return 'later';
    }
    await Store.setMeta('config', { gasUrl: now.gasUrl });
    showLogin(msg);
    return 'now';
  }
  /** 0.4.87 中6：離開打卡畫面時，補做先前延後的「登入失效」（金鑰還是同一把才做） */
  async function loginLostCheck() {
    const L = state.loginLost;
    if (!L) return false;
    state.loginLost = null;
    const now = (await Store.getMeta('config')) || {};
    if (!now.deviceKey || now.deviceKey !== L.key) return false;
    await Store.setMeta('config', { gasUrl: now.gasUrl });
    showLogin(L.msg);
    return true;
  }
  async function syncNow() {
    const cfg = await getConfig();
    if (!cfg || !cfg.deviceKey) return;
    if (syncing || !navigator.onLine) { await renderQueue(); return; }
    syncing = true;
    try {
      let r = await runSync(p => { $('syncState').textContent = `上傳中 တင်နေသည် ${p.index} / ${p.total}…`; });
      if (r && r.code === 'BAD_LOGIN') {
        // 帳號被停用或重設密碼：手機裡沒傳的資料保留，重新登入後接著傳（0.4.87 高1、中6：交給 onLoginExpired）
        await onLoginExpired(cfg.deviceKey, (r.error || '登入已失效') + '。沒上傳的資料還在手機裡，重新登入後會自動補傳。／ပြန်ဝင်ပြီးလျှင် ကျန်သော မှတ်တမ်း တင်မည်။');
        return;
      }
      if (r && !r.error && !r.sent) {
        // 沒有要上傳的，順便抓最新的客戶、選單和首頁數字
        const sentAt = Date.now();
        const data = await post(cfg.gasUrl, { action: 'sync', deviceKey: cfg.deviceKey }).catch(() => null);
        if (data && data.ok) await rememberServer(data, sentAt);
        else if (data && data.code === 'BAD_LOGIN') { await onLoginExpired(cfg.deviceKey, data.message); return; } // 0.4.87 高1、中6
      }
      $('syncState').textContent = r && r.error ? r.error : '';
      // 0.4.81（0.4.80 巡檢中1）：上傳、同步完成 → 種植資料的紀錄切回來要重讀（這裡不馬上重讀，省流量）
      if (r && !r.error) { const ph = document.getElementById('plHistory'); if (ph) ph._doneCid = null; }
      await pruneLocalCustomers();
      if (state.view === 'home') await renderHome();
      // 正在填拜訪而且已經選了客戶，就不重整選單（暫時客戶上傳後會換成正式編號，重整會把選好的清掉；R1-02）
      if (state.view === 'visit' && !$('farmer').value) { await loadOptions(); await loadFarmers(); }
    } finally {
      syncing = false;
      await renderQueue();
    }
  }


  /** 1號清單低#6（第8任）：這支手機裡「目前帳號」的拜訪（跟 renderQueue 同一條規則；沒記帳號的舊資料照算）。換人登入後前一位的拜訪不能被當成「我」 */
  async function myVisits() {
    const cfg = (await Store.getMeta('config')) || {};
    return ((await Store.allVisits()) || []).filter(v => !v.account || !cfg.account || v.account === cfg.account);
  }
  async function renderQueue() {
    // 0.4.54 第6任檢查：同一支手機換人登入，別人的紀錄不列、不算「沒上傳」（上傳本來就只送自己帳號的，算進來會永遠掛著）
    const qcfg = (await Store.getMeta('config')) || {};
    const all = (await Store.allVisits()).filter(v => !v.account || !qcfg.account || v.account === qcfg.account).sort((a, b) => b.deviceTime - a.deviceTime);
    const pending = all.filter(v => v.status === 'pending');
    const rejected = all.filter(v => v.status === 'rejected').length;
    const ticks = (await mineTicks()).length; // 只算自己帳號的打勾（自行審查 S1）
    const left = [pending.length ? `${pending.length} 筆拜訪` : '', ticks ? `${ticks} 個任務打勾` : ''].filter(Boolean).join('、');
    $('pendingCount').textContent = (left ? `還有 ${left}沒上傳／မတင်ရသေး ${pending.length + ticks}` : '全部都上傳了／အားလုံး တင်ပြီး') + (rejected ? `（另有 ${rejected} 筆被拒，請洽主管／${rejected} ခု ပယ်ခံရ၊ မန်နေဂျာကို မေးပါ）` : '');
    $('pendingCount').className = 'count ' + (left ? 'wait' : 'ok');
    // 同一個狀態也放在首頁最上面，隨時看得到（優化 2）
    $('syncBadge').hidden = false;
    $('syncBadge').className = 'syncbadge ' + (left || rejected ? 'wait' : 'ok');
    $('syncBadge').textContent = left ? `⏳ ${pending.length + ticks} 筆沒上傳 မတင်ရသေး` : rejected ? `⚠ ${rejected} 筆被拒 ပယ်ခံရ` : '✓ 都上傳了 တင်ပြီး';
    $('queueList').innerHTML = all.slice(0, 12).map(v => {
      const d = new Date(v.deviceTime);
      const tag = v.status === 'uploaded' ? '<span class="pill ok">已上傳 တင်ပြီး</span>'
        : v.status === 'rejected' ? '<span class="pill late">被拒 ပယ်ခံရ</span>' : '<span class="pill wait">等上傳 စောင့်နေ</span>';
      const n = Array.isArray(v.photos) && v.photos.length ? v.photos.length : (v.photoCount || (v.photo ? 1 : 0));
      const what = [n ? `照片 ${n}` : '', v.audioSec ? `錄音 ${v.audioSec} 秒` : '', v.text ? '打字' : '', v.prices && v.prices.length ? `價格 ${v.prices.length}` : ''].filter(Boolean).join('・');
      return `<li><span>${esc(v.farmerLabel)}<br><small>${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}${what ? '・' + esc(what) : ''}</small></span>${tag}</li>`;
    }).join('') || '<li class="empty">還沒有紀錄／မှတ်တမ်း မရှိသေး</li>';
  }

  /* ───── 小提示 ───── */
  let toastTimer;
  function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3000); }

  /* ───── 啟動 ───── */
  async function init() {
    $('appVer').textContent = 'v' + FARM_CONFIG.appVersion;
    renderMirrors();
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    $('iosTip').hidden = !(isIOS && !standalone);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw && nw.addEventListener('statechange', async () => {
            if (nw.state !== 'installed' || !navigator.serviceWorker.controller) return;
            // 有新版：沒在填拜訪、也沒在上傳，就更新。
            // 原本要等「手機裡沒有待上傳的資料」才更新，但一筆一直傳不上去的資料會讓這支手機永遠停在舊版、拿不到修正（第六輪自抓）；
            // 新版一定能讀舊版存的資料（有測試保護），所以不用再等
            // 2號 0.4.69 低6（第8任）：種植資料表單打開（改到一半或正在存）也先不更新，不然 0.6 秒後整頁重整、改的內容不見；下次打開網頁就是新版
            const plantEditing = !$n('plForm').hidden;
            if (state.view !== 'visit' && !syncing && !plantEditing) { nw.postMessage('skipWaiting'); setTimeout(() => location.reload(), 600); }
            else if (plantEditing) toast('有新版，種植資料存好後重新打開網頁就會更新／ဗားရှင်းအသစ် ရှိသည်');
          });
        });
        if ('periodicSync' in reg) reg.periodicSync.register('upload-visits', { minInterval: 60 * 60 * 1000 }).catch(() => {});
      }).catch(() => {});
      navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'synced') { renderQueue(); if (state.view === 'home') renderHome(); } });
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    $('loginForm').addEventListener('submit', onLogin);
    $('logoutBtn').addEventListener('click', logout);
    document.querySelectorAll('.cat[data-cat]').forEach(b => b.addEventListener('click', () => openVisit(b.dataset.cat)));
    // 首頁兩張大卡直接進打卡畫面；一般／試作／推廣、盤商／種子商在打卡畫面上方切換（優化 1）
    // 0.4.32 董事長：「農民」改成下拉選單（一般拜訪農民／試作農民／推廣農民），選了直接進那一種
    $('farmerBtn').addEventListener('click', () => {
      const open = $('farmerMenu').hidden;
      $('farmerMenu').hidden = !open; $('farmerBtn').setAttribute('aria-expanded', String(open));
      $n('dealerMenu').hidden = true; // 0.4.53 兩個選單一次只開一個
    });
    document.querySelectorAll('[data-farmercat]').forEach(b => b.addEventListener('click', async () => {
      $('farmerMenu').hidden = true; $('farmerBtn').setAttribute('aria-expanded', 'false');
      const cat = b.dataset.farmercat;
      state.lockNext = true; // 0.4.47 一般拜訪鎖死試作、推廣；0.4.51 董事長：試作、推廣進來也一樣，另外兩種都鎖死（openVisit 會讀這個）
      await openVisit(cat);
      if (cat !== '農戶') state.catManual = true; // 明確選了試作／推廣：選農民後不要自動跳回別的類別
    }));
    // 0.4.53 董事長：盤商、種子商也要互相鎖死 → 首頁「盤商或種子商」改成點開選一種（跟農民一樣），選了就鎖另一種
    $('dealerBtn').addEventListener('click', () => {
      const m = $n('dealerMenu');
      if (!document.getElementById('dealerMenu')) { openVisit('盤商'); return; } // 舊頁面（快取混版）沒有選單：照舊直接進盤商
      const open = m.hidden; m.hidden = !open; $('dealerBtn').setAttribute('aria-expanded', String(open));
      $('farmerMenu').hidden = true; $('farmerBtn').setAttribute('aria-expanded', 'false');
    });
    document.querySelectorAll('[data-dealercat]').forEach(b => b.addEventListener('click', async () => {
      $n('dealerMenu').hidden = true; $('dealerBtn').setAttribute('aria-expanded', 'false');
      state.lockNext = true;
      await openVisit(b.dataset.dealercat);
    }));
    initHomeTabs();
    $('syncBadge').addEventListener('click', () => { setHomeTab('punch'); const q = document.querySelector('.queue'); if (q && q.scrollIntoView) q.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
    $('backBtn').addEventListener('click', () => {
      const dirty = formDirty(); // 業務BUG#5
      if (dirty && !confirm('還沒儲存，確定要回首頁？剛剛填的資料（照片、錄音、打字、匯報、結案欄位等）會不見。\nမသိမ်းရသေးပါ။ ပြန်သွားလျှင် ဖြည့်ထားသည်များ ပျောက်မည်။')) return;
      if (state.rec) state.rec.stop();
      resetForm(); showHome();
    });
    $('farmer').addEventListener('change', onFarmerChange);
    Object.values(PROFILE_INPUTS).forEach(id => $n(id).addEventListener('input', refreshSave)); // 0.4.71 $n：舊頁面沒有新欄位時初始化不中斷
    $n('quickFill').addEventListener('change', applyQuickFill); // 0.4.82 新增時從已結案的舊客戶帶入基本資料
    $('pArea').addEventListener('change', refreshSave);
    $('pCrop').addEventListener('change', () => fillVarieties('')); // 換作物就重選品種
    $('pVarCo').addEventListener('change', () => { fillVarieties(''); refreshSave(); }); // 0.4.31 換種子公司就重選品種
    $('plantFail').addEventListener('change', refreshPlantFail); // 0.4.33 一般拜訪勾「種植失敗」
    $('note').addEventListener('input', refreshSave);
    $n('dcSigned').addEventListener('change', () => { refreshDealerSign(); refreshSave(); }); // 0.4.75 勾已簽約 → 打開結案框
    $n('vStage').addEventListener('change', () => { state.stageManual = true; }); // 0.4.78 業務自己選了生長階段，之後不再自動建議蓋掉
    ['dcOutcome', 'dcNote'].forEach(id => { $n(id).addEventListener('input', refreshSave); $n(id).addEventListener('change', refreshSave); }); // 0.4.42；低#7（第8任）改 $n：舊頁面沒有這兩格時初始化不中斷
    ['cRegion', 'cPrice', 'cYield', 'cBuyer', 'cPhone'].forEach(id => { $(id).addEventListener('input', refreshSave); $(id).addEventListener('change', refreshSave); });
    $('photoInput').addEventListener('change', e => addPhotos(e.target.files, '相機', $('photoBtn')).finally(() => { e.target.value = ''; }));
    $('albumInput').addEventListener('change', e => addPhotos(e.target.files, '相簿', $('albumBtn')).finally(() => { e.target.value = ''; }));
    $('recBtn').addEventListener('click', toggleRec);
    $('saveBtn').addEventListener('click', save);
    // 0.4.57 董事長：結案放在首頁「我的進度」→ 選農民／盤商／種子商結案，直接進結案畫面（不能切去一般拜訪）
    document.querySelectorAll('[data-closecat]').forEach(b => b.addEventListener('click', async () => {
      const cat = b.dataset.closecat;
      state.closeGroup = b.dataset.closegroup || ''; // 0.4.73 董事長：結案改「一般／試作／推廣農民結案」（盤商、種子商結案拿掉）
      state.closeNext = true;
      if (cat !== '結案') state.lockNext = true; // 盤商、種子商結案：另一種也鎖
      // 0.4.64（2號 0.4.63 清單中#1）：結案已經是獨立分頁，不再自動帶「我的進度」看過的農民，免得結錯人；進結案畫面再自己選
      await openVisit(cat);
      if (cat !== '結案') { // 0.4.42 盤商、種子商：不換類別，打開結案模式（洽談成功或失敗都送主管審核）
        state.dealerClose = true; state.noMeet = false; $n('dcOutcome').value = ''; $n('dcNote').value = '';
        applyCatLabels(); refreshNoMeet(); refreshSave();
      }
    }));
    // 0.4.82 董事長截圖：結案分頁第二排「盤商結案」「種子商結案」→ 那一類的拜訪畫面、只列自己負責的（負責業務空白也算），選了店家按「有見到」直接走「已簽約」
    // 舊的 state.dealerClose 結案模式送「成功／失敗」，跟後台 0.4.76 收的「簽約」不一致，所以不用它
    document.querySelectorAll('[data-signclose]').forEach(b => b.addEventListener('click', () => signCloseOpen(b.dataset.signclose)));
    $n('closeFarmer').addEventListener('change', showCloseProgress); // 0.4.57 結案選單挑農民 → 列出進度
    $n('plFarmer').addEventListener('change', onPlantFarmer); // 0.4.59 種植資料
    $n('plSave').addEventListener('click', savePlant);
    // 0.4.82 修改搬到月分工作進度（pfEditBtn 在 showCloseProgress 畫）：種植資料頁的 plEditBtn 一律藏起來、不再掛修改
    $n('plWordBtn').addEventListener('click', () => downloadFarmerReport($n('plWordBtn'))); // 0.4.77 產生 Word 檔
    $n('plCancel').addEventListener('click', () => { $n('plHint').textContent = ''; closePlantEdit(); }); // 取消：收起表單（0.4.82 在月分工作進度；下次打開會重新填原本的值）
    // 0.4.73 董事長「試作報告拿掉」：業務手機不再有試作報告區、首頁右上角兩個入口（loadReports 等函式留著不呼叫，後台 trialReports 也留著）
    // 0.4.73 我的進度：切換看農民／盤商／種子商（最上面一排數字也能點）；換種類就收起展開的那一位
    const pickMineType = t => { if (!MINE_TYPES[t]) return; state.mineType = t; const s = document.getElementById('closeFarmer'); if (s) s.value = ''; fillCloseFarmers(); };
    document.querySelectorAll('#mineType [data-mtype]').forEach(b => b.addEventListener('click', () => pickMineType(b.dataset.mtype)));
    document.querySelectorAll('#mineStats [data-jump]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.mtype) pickMineType(b.dataset.mtype);
      const sec = document.getElementById(b.dataset.jump); if (!sec) return;
      if (sec.scrollIntoView) sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }));
    // 打卡畫面最下面「取消結案」：跟左上返回一樣，回首頁（還沒存的要先確認）
    $n('closeModeBtn').addEventListener('click', () => $('backBtn').click());
    $('relocateBtn').addEventListener('click', locate);
    $n('cropEditBtn').addEventListener('click', () => { state.cropOpen = true; renderCropSum(); }); // 0.4.44
    $('addPriceBtn').addEventListener('click', () => addPriceRow());
    $('trialStartBtn').addEventListener('click', () => setTrialMode(state.trialMode === 'start' ? null : 'start'));
    $n('tItem').addEventListener('change', () => { refreshTrialOther(); refreshSave(); }); // 0.4.89 選「其他」才出現文字框
    $n('tItemOther').addEventListener('input', refreshSave);
    $('trialEndBtn').addEventListener('click', () => setTrialMode(state.trialMode === 'end' ? null : 'end'));
    $('tOutcome').addEventListener('change', () => setTrialMode('end'));
    $n('cTrialOutcome').addEventListener('change', () => { syncClosePlantFail(); placeFailBox(); refreshSave(); }); // 0.4.74 結案試作結果：選失敗就展開失敗紀錄；0.4.75 種植失敗跟著自動勾
    $n('cPlantFail').addEventListener('change', () => { placeFailBox(); refreshSave(); }); // 0.4.75 結案勾「這次發現種植失敗」→ 展開失敗紀錄
    MEASURE_IDS.forEach(id => { const e = $n(id); const f = () => { if (id === 'mSow' || id === 'mHarvest') calcMeasureDays(); refreshSave(); }; e.addEventListener('input', f); e.addEventListener('change', f); }); // 0.4.77 量測：日期改了重算天數
    $('meetYes').addEventListener('click', () => setNoMeet(false)); // 0.4.38
    $('meetNo').addEventListener('click', () => setNoMeet(true));
    ['nmReason', 'nmNote', 'nmNext'].forEach(id => { $(id).addEventListener('input', refreshSave); $(id).addEventListener('change', refreshSave); });
    document.querySelectorAll('#trialBox input, #trialBox select, #trialBox textarea').forEach(el => { el.addEventListener('input', refreshSave); el.addEventListener('change', refreshSave); });

    // 自動上傳的時機：有網路時、切回這個畫面時、每分鐘一次
    window.addEventListener('online', syncNow);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
    setInterval(syncNow, 60 * 1000);
    window.addEventListener('offline', () => { $('syncState').textContent = '沒有網路，資料先存在手機裡／အင်တာနက် မရှိ၊ ဖုန်းထဲ သိမ်းထားသည်'; });

    const cfg = await getConfig();
    if (cfg && cfg.deviceKey) { await showHome(); syncNow(); } else showLogin();
  }
  window.__farmTest = { state, exifInfo }; // 本機測試用
  init();
})();
