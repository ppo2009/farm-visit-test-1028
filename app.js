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
    const others = (await Store.allVisits()).filter(v => v.status === 'pending' && v.account && v.account !== account.toLowerCase());
    // 前一個人還沒送出的任務打勾也要擋：換人後那些打勾永遠送不出去，新的人也登出不了（自行審查 S1）
    const otherTicks = ((await Store.getMeta('taskDone')) || []).filter(t => t.account && t.account !== account.toLowerCase());
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
    const pending = (await Store.allVisits()).filter(v => v.status === 'pending').length;
    // 任務打勾也要先送出（GPT-6.1 R4-07）；只算自己帳號的：別人的（舊版換人留下的）在這支手機用自己帳號永遠送不掉，不能因此擋住登出（自行審查 S1）
    const ticks = (await mineTicks()).length;
    if (pending || ticks) { toast(`還有 ${[pending ? pending + ' 筆拜訪' : '', ticks ? ticks + ' 個任務打勾' : ''].filter(Boolean).join('、')}沒上傳，先連上網路等它傳完再登出／မတင်ရသေးသော မှတ်တမ်းရှိသည်၊ အင်တာနက်ချိတ်ပြီး တင်ပြီးမှ ထွက်ပါ`); return; }
    if (!confirm('確定要登出嗎？之後要再輸入帳號密碼。\nထွက်မှာ သေချာပါသလား။ နောက်တစ်ကြိမ် အကောင့်နှင့် စကားဝှက် ပြန်ထည့်ရမည်။')) return;
    await Store.setMeta('config', null);
    showLogin();
  }

  /* ───── 首頁 ───── */
  async function showHome() {
    show('home');
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
    state.homeTab = tab;
    HOME_TABS.forEach(t => {
      const b = $('htab-' + t), p = $('hp-' + t);
      if (b) b.setAttribute('aria-selected', String(t === tab));
      if (p) p.hidden = t !== tab;
    });
    try { localStorage.setItem('farm-home-tab', tab); } catch (e) { /* 存不了 */ }
  }
  function initHomeTabs() {
    let saved = '';
    try { saved = localStorage.getItem('farm-home-tab') || ''; } catch (e) { /* 讀不了 */ }
    document.querySelectorAll('[data-htab]').forEach(b => b.addEventListener('click', () => { setHomeTab(b.dataset.htab); window.scrollTo(0, 0); }));
    setHomeTab(saved);
  }

  /** 0.4.57 董事長：「我的進度」結案下面的選單：挑自己負責的農民、列出進度（跟打卡畫面結案只列自己的一樣） */
  async function fillCloseFarmers() {
    const sel = document.getElementById('closeFarmer');
    if (!sel) return; // 舊頁面沒有這個選單
    const server = (await Store.getMeta('farmers')) || [], local = (await Store.getMeta('localCustomers')) || [];
    const me = String(((await getConfig()) || {}).name || '');
    const list = server.concat(local.filter(l => !server.some(f => f.id === l.id)))
      .filter(f => (f.type || '農民') === '農民' && (f.pending || String(f.staff || '') === me));
    state.closeList = list;
    const keep = sel.value;
    sel.innerHTML = '<option value="">— 請選擇 ရွေးပါ —</option>' + list.map(f => `<option value="${esc(f.id)}">${esc(f.name)}${f.area ? '｜' + esc(String(f.area).split(/[ （(]/)[0]) : ''}${f.pending ? '（新，未上傳 မတင်ရသေး）' : ''}</option>`).join('');
    sel.value = keep && list.some(f => f.id === keep) ? keep : '';
    if (!sel.value) { const b = $n('closeProgress'); b.hidden = true; b.innerHTML = ''; }
    // 0.4.57 董事長：列出找到哪幾個農民、每位的進度（狀態、進行中的試作、最後拜訪、下次回訪）
    const ul = document.getElementById('closeFarmerList');
    if (!ul) return;
    $n('closeFarmerCount').textContent = `我找到的農民：${list.length} 位／ကျွန်ုပ်ရှာတွေ့သော လယ်သမား ${list.length} ဦး`;
    const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; // 手機的今天
    const rows = [];
    for (const f of list) {
      const tr = [];
      for (const cat of ['試作', '推廣']) { const t = await activeTrialFor(f.id, cat); if (t) tr.push(`${cat}中：${t.item || '（未填品項）'}${t.start ? `（${t.start} 開始）` : ''}`); }
      const parts = [f.pending ? '剛新增，還沒上傳' : (f.status || ''), ...tr,
        f.lastVisit ? `最後拜訪 ${f.lastVisit}` : '還沒拜訪過', f.nextDue ? `下次回訪 ${f.nextDue}` : ''].filter(Boolean);
      const late = f.nextDue && f.nextDue < today;
      rows.push(`<li class="go" data-cid="${esc(f.id)}"><span><b>${esc(f.name)}</b>${f.area ? '｜' + esc(String(f.area).split(/[ （(]/)[0]) : ''}${f.crop ? '｜' + esc(f.crop) : ''}<br><small>${esc(parts.join('・'))}</small></span>${late ? '<span class="pill late">逾期 ရက်ကျော်</span>' : ''}</li>`);
    }
    ul.innerHTML = rows.join('') || '<li class="empty">還沒有自己負責的農民／တာဝန်ယူထားသော လယ်သမား မရှိသေး</li>';
    ul.querySelectorAll('li.go').forEach(li => li.addEventListener('click', () => {
      sel.value = li.dataset.cid; showCloseProgress();
      const b = $n('closeProgress'); if (b.scrollIntoView) b.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }));
  }
  /* ───── 0.4.59 首頁「種植資料」分頁：選自己負責的農民，改種植資料直接存（不算拜訪） ───── */
  function fillPlantFarmers() {
    const sel = document.getElementById('plFarmer');
    if (!sel) return; // 舊頁面沒有這個分頁
    const list = (state.closeList || []).filter(f => !f.pending); // 剛新增還沒上傳的，後台還沒有這位
    const keep = sel.value;
    sel.innerHTML = '<option value="">— 請選擇 ရွေးပါ —</option>' + list.map(f => `<option value="${esc(f.id)}">${esc(f.name)}${f.area ? '｜' + esc(String(f.area).split(/[ （(]/)[0]) : ''}</option>`).join('');
    sel.value = keep && list.some(f => f.id === keep) ? keep : '';
    if (!sel.value) { $n('plForm').hidden = true; $n('plCard').hidden = true; $n('plEditBtn').hidden = true; }
  }
  /** 0.4.61 董事長「選擇農民後下面的資料應該是自動載入，不是要填寫的」：唯讀卡片（沒填的寫「未填」） */
  function plantCardHtml(f, o) {
    const v = String(f.variety || ''), cos = o.seedCompanies || [];
    const co = cos.find(c => v === c || v.indexOf(c + ' ') === 0) || v;
    const u = o.areaUnit || '英畝', blank = '<span class="sub">未填 မဖြည့်ရသေး</span>';
    const val = x => (x === '' || x == null ? blank : esc(String(x)));
    const rows = [['種子公司', co], ['作物', f.crop ? cropText(f.crop) : ''], ['代碼', f.varCode], ['種植日期', f.plantDate],
      ['目前種植面積', f.areaNow === '' || f.areaNow == null ? '' : `${f.areaNow} ${u}`], ['可種植面積', f.areaMax === '' || f.areaMax == null ? '' : `${f.areaMax} ${u}`], ['使用肥料', f.fertilizer]];
    return `<h3>目前種植資料／လက်ရှိ အချက်အလက်<span class="who"><b>${esc(f.name)}</b></span></h3><ul>${rows.map(([k, x]) => `<li>${k}：${val(x)}</li>`).join('')}</ul>`;
  }
  function setPlantEditing(on) {
    $n('plForm').hidden = !on; $n('plCard').hidden = on; $n('plEditBtn').hidden = on;
  }
  /** 選了農民：先顯示目前種植資料（唯讀），表單也先填好，按「修改」才打開 */
  async function onPlantFarmer() {
    const cid = $n('plFarmer').value, f = (state.closeList || []).find(x => x.id === cid);
    $n('plHint').textContent = '';
    if (!f) { $n('plForm').hidden = true; $n('plCard').hidden = true; $n('plEditBtn').hidden = true; return; }
    const o0 = (await Store.getMeta('options')) || {};
    $n('plCard').innerHTML = plantCardHtml(f, o0);
    setPlantEditing(false);
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
  }
  /** 要送的種植資料（品種：沒換公司就留原本的；換了公司就記公司名；跟打卡畫面 varietyValue 同一規則） */
  function collectPlant() {
    const co = $n('plCo').value.trim(), old = $n('plCo').dataset.old || '';
    const variety = !co ? old : (old && (old === co || old.indexOf(co + ' ') === 0) ? old : co);
    return { crop: $n('plCrop').value, variety, varCode: $n('plCode').value.trim(), plantDate: $n('plDate').value,
      areaNow: $n('plNow').value, areaMax: $n('plMax').value, fertilizer: $n('plFert').value.trim() };
  }
  async function savePlant() {
    const cid = $n('plFarmer').value, cfg = await getConfig();
    if (!cid) return;
    if (!cfg || !cfg.deviceKey || (typeof navigator !== 'undefined' && navigator.onLine === false)) { $n('plHint').textContent = '要有網路才能存種植資料，請連上網路再按一次／အင်တာနက် လိုသည်'; return; }
    const btn = $n('plSave'); btn.disabled = true; $n('plHint').textContent = '存檔中…／သိမ်းနေသည်';
    try {
      const res = await fetch(FARM_CONFIG.gasUrl, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'plantSave', deviceKey: cfg.deviceKey, cid, profile: collectPlant() }) });
      const r = await res.json();
      if (!r || !r.ok) { $n('plHint').textContent = (r && r.message) || '存檔失敗，請再試一次／မအောင်မြင်'; return; }
      if (Array.isArray(r.farmers)) await Store.setMeta('farmers', r.farmers);
      $n('plHint').textContent = '已存好，主管看得到／သိမ်းပြီး';
      toast('種植資料已存好／သိမ်းပြီး');
      await fillCloseFarmers(); await onPlantFarmer(); $n('plHint').textContent = '已存好，主管看得到／သိမ်းပြီး';
    } catch (e) { $n('plHint').textContent = '網路不穩，沒存成功，請再按一次／ထပ်နှိပ်ပါ'; } finally { btn.disabled = false; }
  }
  /* ───── 0.4.61 董事長：農民試作成功、失敗都要產生一份報表檔，所有人都看得到 ─────
     「我的進度」按「看試作報告」才向後台拿清單（要有網路；不在每次畫首頁時自動拿，省流量）；有 Word 的按一下下載 */
  async function gasCall(payload) {
    const cfg = await getConfig();
    if (!cfg || !cfg.deviceKey || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { ok: false, offline: true };
    const res = await fetch(FARM_CONFIG.gasUrl, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ deviceKey: cfg.deviceKey }, payload)) });
    return res.json();
  }
  async function loadReports() {
    const btn = $n('reportLoadBtn'); btn.disabled = true; $n('reportHint').textContent = '讀取中…／ဖတ်နေသည်';
    try {
      const r = await gasCall({ action: 'trialReports' });
      if (r && r.offline) { $n('reportHint').textContent = '要有網路才能看試作報告，請連上網路再按一次／အင်တာနက် လိုသည်'; return; }
      if (!r || !r.ok || !Array.isArray(r.reports)) { $n('reportHint').textContent = (r && r.message) || '讀取失敗，請再按一次／ထပ်နှိပ်ပါ'; return; }
      state.reports = r.reports;
      renderReports();
    } catch (e) { $n('reportHint').textContent = '網路不穩，請再按一次／ထပ်နှိပ်ပါ'; } finally { btn.disabled = false; }
  }
  const REPORT_PILL = { 成功: 'ok', 失敗: 'late', 結束: 'wait' };
  function renderReports() {
    const ul = document.getElementById('reportList'); // 舊頁面沒有這一塊：不畫
    if (!ul || !Array.isArray(state.reports)) return;
    const list = state.reports, count = s => list.filter(t => t.status === s).length;
    $n('reportHint').textContent = list.length ? `共 ${list.length} 件：成功 ${count('成功')}、失敗 ${count('失敗')}、結束 ${count('結束')}／စုစုပေါင်း ${list.length}` : '';
    ul.innerHTML = list.map(t => `<li><span>${esc(t.name || '—')}${t.area ? '・' + esc(t.area) : ''}<br><small>${esc(catBi(t.cat || '試作'))}・${esc(t.item || '—')}・${esc(t.start || '?')}～${esc(t.end || '?')}${t.staff ? '・' + esc(t.staff) : ''}${t.reason ? '<br>失敗原因 အကြောင်းရင်း：' + esc(t.reason) : ''}</small><br>`
      + (t.hasReport ? `<button type="button" class="btn2 small" data-rep="${esc(t.id)}">⬇ 下載報告（Word）／ဒေါင်းလုဒ်</button>`
        : `<small>${t.report === '產生失敗' ? '報告產生失敗，請告訴主管／မအောင်မြင်' : '報告製作中，晚點再看／ပြင်ဆင်နေဆဲ'}</small>`)
      + `</span><span class="pill ${REPORT_PILL[t.status] || 'wait'}">${esc(t.status)}</span></li>`).join('')
      || '<li class="empty">還沒有結束的試作／ပြီးဆုံးသော စမ်းသပ်မှု မရှိသေး</li>';
    ul.querySelectorAll('[data-rep]').forEach(b => b.addEventListener('click', () => downloadTrialReport(b)));
  }
  async function downloadTrialReport(btn) {
    const label = btn.textContent;
    btn.textContent = '下載中…／ဒေါင်းနေသည်'; btn.disabled = true;
    try {
      const r = await gasCall({ action: 'trialReportFile', trialId: btn.dataset.rep });
      if (!r || !r.ok || !r.data) { btn.textContent = (r && r.offline) ? '要有網路／အင်တာနက် လိုသည်' : (r && r.message) || '下載失敗，請再試／မအောင်မြင်'; return; }
      const bytes = Uint8Array.from(atob(r.data), ch => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
      const a = document.createElement('a'); a.href = url; a.download = r.name || (btn.dataset.rep + '.docx'); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      btn.textContent = label;
    } catch (e) { btn.textContent = '下載失敗，請再試／မအောင်မြင်'; } finally { btn.disabled = false; }
  }

  function showCloseProgress() {
    const sel = document.getElementById('closeFarmer'), cid = sel ? sel.value : '';
    renderProgress(cid, { box: $n('closeProgress'), current: () => !!sel && sel.value === cid, list: state.closeList || [], home: true });
  }

  async function renderHome() {
    const h = (await Store.getMeta('home')) || null;
    const today = await phoneToday(h);
    const list = (h ? h.schedule : []).map(s => Object.assign({}, s, { late: s.due < today })); // 逾期用手機的今天重算
    $('scheduleList').innerHTML = list.map(s => `<li class="go" data-id="${esc(s.id)}" data-type="${esc(s.type)}"><span>${esc(s.name)}<br><small>${esc(catBi(s.type || '農民'))}・應回訪 ပြန်သွားရန် ${esc(s.due.slice(5).replace('-', '/'))}</small></span>${s.late ? '<span class="pill late">逾期 ရက်ကျော်</span>' : s.due === today ? '<span class="pill wait">今天 ယနေ့</span>' : ''}</li>`).join('')
      || `<li class="empty">${h ? '這 7 天沒有排到回訪／၇ ရက်အတွင်း သွားရန် မရှိ' : '連上網路後會顯示／အင်တာနက်ချိတ်ပြီးမှ ပြမည်'}</li>`;
    $('scheduleList').querySelectorAll('li.go').forEach(li => li.addEventListener('click', () => {
      openVisit(li.dataset.type === '盤商' || li.dataset.type === '種子商' ? li.dataset.type : '農戶', li.dataset.id); // 農民：有進行中的試作會自動切到試作
    }));
    await renderTasks();
    await renderMyTrials(h);
    await fillCloseFarmers();
    fillPlantFarmers(); // 0.4.59 種植資料分頁共用同一份「自己負責的農民」
    renderReports(); // 0.4.61 試作報告：按過「看試作報告」才有清單，首頁重畫時照舊顯示
    // 月計劃（2C）
    const plan = (h && h.plan) || [];
    $('planList').innerHTML = plan.map(p => `<li class="plan"><span>${esc(p.label)}<br><small>${esc(p.period)}　${p.done}／${p.target}</small>
      <span class="bar"><i style="width:${Math.max(0, Math.min(100, p.pct))}%"></i></span></span>${p.done >= p.target ? '<span class="pill ok">達成 ပြည့်မီ</span>' : `<span class="pill wait">${p.pct}%</span>`}</li>`).join('')
      || `<li class="empty">${h && h.plan ? '這個月沒有訂目標／ဤလ ပစ်မှတ် မရှိ' : '連上網路後會顯示／အင်တာနက်ချိတ်ပြီးမှ ပြမည်'}</li>`; // 舊版留下的首頁資料沒有計劃欄，不能說成沒有目標（第五輪自抓）
    // 工作進度：最近 3 個月可以切換
    const hist = (h && h.history) || [];
    if (!hist.some(x => x.month === state.homeMonth)) state.homeMonth = hist.length ? hist[0].month : '';
    $('monthChips').innerHTML = hist.map(x => `<button type="button" class="chip" data-m="${esc(x.month)}" aria-pressed="${x.month === state.homeMonth}">${Number(x.month.slice(5))} 月／လ</button>`).join('');
    $('monthChips').querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => { state.homeMonth = b.dataset.m; renderHome(); }));
    const cur = hist.find(x => x.month === state.homeMonth);
    $('statVisits').textContent = cur ? cur.visits : (h ? h.monthVisits : '—');
    $('statNew').textContent = cur ? cur.newCustomers : (h ? h.newCustomers : '—');
    $('statCust').textContent = cur ? cur.customersVisited : '—';
    $('statTrials').textContent = cur ? `${cur.trialsStarted}／${cur.trialsEnded}` : '—';
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
    const mine = await Store.allVisits();
    const localDay = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const lastOf = cid => [(people.find(f => f.id === cid) || {}).lastVisit || ''].concat(mine.filter(v => v.farmerId === cid).map(v => localDay(v.deviceTime))).sort().pop();
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
    $('trialList').querySelectorAll('li.go').forEach(li => li.addEventListener('click', () => openVisit(li.dataset.cat === '推廣' ? '推廣' : '試作', li.dataset.cid)));
  }

  /**
   * 手機的「今天」（緬甸日期）：手機時間＋伺服器校正值換成緬甸時間（UTC+6:30）。
   * 原本用上次同步時伺服器給的日期，離線幾天後週數、該量測、逾期都不會往前走（第二輪自行審查 T9）。
   * 從來沒同步過（沒有校正值）才用伺服器給的日期
   */
  async function phoneToday(h) {
    const off = await Store.getMeta('clockOffset');
    if (typeof off !== 'number' && h && h.today) return h.today;
    return new Date(Date.now() + (Number(off) || 0) + 6.5 * 3600000).toISOString().slice(0, 10);
  }

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
        <span><b>${esc(t.name)}</b>：${esc(t.text)}<br><small>${isDone ? '已完成 ပြီးပြီ ' + esc(String(t.doneAt || '').slice(5, 16)) : busy && unconf.has(t.id) ? '已送出，等連上網路確認（不能取消）／ပို့ပြီး၊ အတည်ပြုချက် စောင့်နေ (ပယ်ဖျက်၍ မရ)' : busy ? '送出中…（送出後就不能取消）／ပို့နေသည် (ပယ်ဖျက်၍ မရ)' : wait ? '已打勾，有網路會自動送出（再按一下可取消）／အမှန်ခြစ်ပြီး၊ အင်တာနက်ရလျှင် ပို့မည် (ထပ်နှိပ်လျှင် ပယ်ဖျက်)' : esc(t.by || '主管') + ' 派 ပေးသည်・' + esc(String(t.at || '').slice(5, 10))}</small></span></label>
        ${isDone ? '' : closed(t) ? '<small class="taskclosed">找不到這位客戶（可能已結案）：做完直接打勾，不用做請主管取消／ဖောက်သည် မတွေ့ပါ</small>' : `<button type="button" class="btn2 small" data-taskgo="${esc(t.cid)}">去拜訪<br>သွားမည်</button>`}</li>`;
    };
    $('taskList').innerHTML = open.map(t => row(t, false)).join('') + done.map(t => row(t, true)).join('')
      || `<li class="empty">${(await Store.getMeta('home')) ? '目前沒有派給你的任務／ပေးထားသော အလုပ် မရှိ' : '連上網路後會顯示／အင်တာနက်ချိတ်ပြီးမှ ပြမည်'}</li>`;
    $('taskList').querySelectorAll('input[data-task]').forEach(cb => cb.addEventListener('change', () => toggleTask(cb.dataset.task, cb.checked)));
    $('taskList').querySelectorAll('[data-taskgo]').forEach(b => b.addEventListener('click', () => openVisit(catOf(b.dataset.taskgo), b.dataset.taskgo)));
    // 0.4.26：分頁標籤上顯示還沒做（也還沒打勾）的任務數
    const left = open.filter(t => !ticked.has(t.id)).length;
    $('todoBadge').textContent = left ? String(left) : '';
    $('todoBadge').hidden = !left;
    renderAssigned(tasks, ticked);
  }
  /** 指派任務分頁（0.4.26）：主管、總經理派給我的任務紀錄，新派的在前面；只看不勾，打勾在「執行任務清單」 */
  function renderAssigned(tasks, ticked) {
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
    $('visitTitle').textContent = isDealerCat() ? '盤商或種子商 ကုန်သည် / မျိုးစေ့ဆိုင်' : '農民 လယ်သမား';
    $('farmerLab').innerHTML = isDealerCat() ? `選擇${cat}<span class="my">${cat === '種子商' ? 'မျိုးစေ့ဆိုင်' : 'ကုန်သည်'} ရွေးပါ</span>` : '選擇農民<span class="my">လယ်သမား ရွေးပါ</span>';
    $('priceBox').hidden = cat !== '盤商' || !!state.dealerClose; // 0.4.41 董事長：種子商那邊不需要價格，只有盤商有
    document.querySelectorAll('.dealer-only').forEach(el => { el.hidden = !isDealerCat(); });
    document.querySelectorAll('.farmer-only').forEach(el => { el.hidden = isDealerCat(); });
    $('closeBox').hidden = cat !== '結案';
    $('recBtn').hidden = cat === '結案'; // 結案手稿只有拍照、圖片上傳
    $('pNameLab').innerHTML = isDealerCat() ? `${cat}名字（公司）<span class="my">${CAT_MY[cat]} အမည် (ကုမ္ပဏီ)</span>` : '農民名字<span class="my">လယ်သမား အမည်</span>';
    // 0.4.32 董事長 2026-11-12：打卡畫面上方按鈕寫「一般拜訪農民／試作農民／推廣農民」（只改這裡，統計、紀錄照舊叫一般拜訪、試作、推廣）
    const SWITCH_LABEL = { 農戶: '一般拜訪農民', 試作: '試作農民', 推廣: '推廣農民' };
    $('catSwitch').dataset.group = groupOf(cat);
    // 0.4.40 董事長：結案不放上方，改成畫面最下面的「結案（送主管審核）」；在結案畫面時同一顆按鈕變「取消結案」
    if (groupOf(cat) !== 'dealer') state.dealerClose = false; // 0.4.42 盤商、種子商的結案模式只在那一組
    $n('dealerCloseBox').hidden = !state.dealerClose;
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

  async function openVisit(cat, customerId) {
    state.cat = cat; state.entryCat = cat; state.catManual = false; state.dealerClose = false;
    state.closeOnly = !!state.closeNext; state.closeNext = false; // 0.4.57 從「我的進度」結案進來
    if (state.closeOnly) state.catManual = true; // 結案畫面不自動切到試作
    // 0.4.47 董事長「一般拜訪農民的時候，試作農民跟推廣農民要鎖死」：只鎖從首頁選一般拜訪進來的；任務、客戶清單進來的照舊（有進行中的試作會自動切過去）
    state.catLocked = !!state.lockNext && ['農戶', '試作', '推廣', '盤商', '種子商'].indexOf(cat) >= 0; state.lockNext = false; // 0.4.53 盤商、種子商也鎖
    if (state.catLocked) state.catManual = true; // 鎖死就不自動切到試作
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
    state.farmers = (await Store.getMeta('farmers')) || [];
    const local = (await Store.getMeta('localCustomers')) || [];
    const all = state.farmers.concat(local.filter(l => !state.farmers.some(f => f.id === l.id)));
    const types = CAT_TYPES[state.cat];
    const sel = $('farmer');
    const keep = sel.value;
    let mine = all.filter(f => types.indexOf(f.type || '農民') >= 0);
    // 0.4.33 董事長：怕業務結案按錯 →「結案」只列自己負責的農民（手機剛新增還沒上傳的也算自己的）；其他類別照舊全部列
    if (state.cat === '結案') { const me = String(((await getConfig()) || {}).name || ''); mine = mine.filter(f => f.pending || String(f.staff || '') === me); }
    sel.innerHTML = '<option value="">— 請選擇 ရွေးပါ —</option>' +
      mine.map(f => `<option value="${esc(f.id)}">${esc(f.name)}${f.area ? '｜' + esc(String(f.area).split(/[ （(]/)[0]) : ''}${f.crop ? '｜' + esc(f.crop) : ''}${f.pending ? '（新，未上傳 မတင်ရသေး）' : ''}</option>`).join('') +
      `<option value="__new">${isDealerCat() ? `＋ 新增${state.cat}（${CAT_MY[state.cat]} အသစ်）` : '＋ 新增農民（ လယ်သမား အသစ် ）'}</option>`;
    if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
    state.allCustomers = all;
  }

  const PROFILE_INPUTS = { name: 'pName', owner: 'pOwner', phone: 'pPhone', area: 'pArea', address: 'pAddress', brand: 'pBrand', crop: 'pCrop', variety: 'pVariety', varCode: 'pVarCode', areaNow: 'pAreaNow', areaMax: 'pAreaMax', plantDate: 'pPlantDate', fertilizer: 'pFert' };
  const DEALER_KEYS = ['name', 'owner', 'phone', 'area', 'address', 'brand'];
  const FARMER_KEYS = ['name', 'phone', 'area', 'crop', 'variety', 'varCode', 'areaNow', 'areaMax', 'plantDate', 'fertilizer'];
  const activeKeys = () => (isDealerCat() ? DEALER_KEYS : FARMER_KEYS);

  function onFarmerChange() {
    const val = $('farmer').value;
    const box = $('profileBox');
    Object.values(PROFILE_INPUTS).forEach(id => { $(id).value = ''; });
    $('pVarCo').value = ''; // 0.4.31：換客戶就重選公司，不帶上一位的
    state.original = null;
    state.cropOpen = false; // 0.4.44 換客戶：作物四格先收起來（沒填才自動展開）
    resetNoMeet(); // 0.4.38 換客戶就回到「有見到農民」；0.4.44 起改成回到「還沒選有沒有見到」
    if (!val) { box.hidden = true; $('progressBox').hidden = true; refreshTrialBox(); refreshSave(); return; } // 0.4.35 沒選人：進度、作物品種都收起來
    box.hidden = val !== '__new' && !SHOW_PROFILE_ON_VISIT; // 0.4.48 舊客戶不顯示客戶資料（資料照樣讀進來，開始試作時的品種代碼仍用得到）
    $('dealerTypeBox').hidden = true; // 盤商、種子商分開進來，種類就是入口，不用再選
    if (val === '__new') {
      box.open = true;
      $('profileTitle').textContent = isDealerCat() ? `新${state.cat}資料／${CAT_MY[state.cat]} အသစ်` : '新農民資料／လယ်သမား အသစ်';
    } else {
      const c = (state.allCustomers || []).find(f => f.id === val) || {};
      activeKeys().forEach(k => { const el = $(PROFILE_INPUTS[k]); el.value = c[k] == null ? '' : String(c[k]); });
      if ($('pArea').value !== String(c.area || '') && c.area) $('pArea').insertAdjacentHTML('beforeend', `<option>${esc(c.area)}</option>`), $('pArea').value = c.area;
      if (!isDealerCat()) { fillCrops(c.crop == null ? '' : String(c.crop)); fillVarieties(c.variety == null ? '' : String(c.variety)); } // 下拉選單：選單裡沒有的舊值也要放回去
      state.original = {};
      activeKeys().forEach(k => { state.original[k] = $(PROFILE_INPUTS[k]).value; });
      if ('variety' in state.original) state.original.variety = varietyValue(); // 0.4.50 跟 collectProfile 用同一算法，沒改就不會誤判成有改
      box.open = false;
      $('profileTitle').textContent = '客戶資料（點開可修改）／ဖောက်သည် အချက်အလက် (နှိပ်ပြီး ပြင်နိုင်)';
    }
    fillVarieties();
    renderProgress(val); // 0.4.35 選了農民就跳出他之前的進度
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
    const local = ((await Store.allVisits()) || []).filter(v => v.farmerId === cid).sort((a, b) => (b.deviceTime || 0) - (a.deviceTime || 0)).slice(0, 5);
    box.hidden = false;
    box.innerHTML = H3 + '<p class="sub">讀取中…／ဖတ်နေသည်</p>';
    // 等後台最多 10 秒；等不到就用手機裡的（線上實測：請求有時遲遲不回，連取消都沒反應 → 不能只靠 AbortController）
    const remote = await Promise.race([fetchHistory(cid), new Promise(r => setTimeout(() => r(null), 10000))]);
    if (!current()) return; // 讀的途中換了客戶
    const recent = remote ? remote : local.map(v => ({ time: new Date(v.deviceTime || 0).toISOString().slice(0, 10), staff: '我', cat: CAT_LABEL(v.category || ''), text: v.text || '', plantFail: '', closing: '' }));
    if (o.home && !c.lastVisit && !trials.length && !recent.length) { box.innerHTML = H3 + '<p>這位農民還沒有拜訪紀錄。<br><span class="my">မှတ်တမ်း မရှိသေး</span></p>'; return; }
    if (!c.lastVisit && !trials.length && !recent.length) {
      // 沒有任何進度：跳出新增（補齊）農民資料
      box.innerHTML = SHOW_PROFILE_ON_VISIT ? H3 + '<p>這位農民還沒有拜訪紀錄，請先把下面的農民資料填完整（跟新增農民一樣）。<br><span class="my">မှတ်တမ်း မရှိသေး၊ လယ်သမား အချက်အလက် ဖြည့်ပါ</span></p>'
        : H3 + '<p>這是第一次拜訪這位客戶。<br><span class="my">ပထမဆုံး သွားရောက်မှု</span></p>'; // 0.4.48
      $('profileBox').open = true;
      $('profileTitle').textContent = '補齊農民資料（還沒有拜訪紀錄）／လယ်သမား အချက်အလက် ဖြည့်ရန်';
      return;
    }
    const wk = s => { const d = Date.parse(String(s || '').slice(0, 10)); return isFinite(d) ? Math.max(1, Math.ceil((Date.now() - d) / 604800000)) : null; };
    // 0.4.44 進度小卡：作物品種代碼搬到卡片下面一行（renderCropSum），卡片只留最後拜訪、下次回訪
    const head = [c.lastVisit ? `最後拜訪 ${esc(c.lastVisit)}` : '', c.nextDue ? `下次回訪 ${esc(c.nextDue)}` : ''].filter(Boolean).join('｜');
    const tr = trials.map(t => `<li><b>${esc(t.cat)}進行中</b>：${esc(t.item || '（未填品項）')}${t.start ? `，${esc(t.start)} 開始${wk(t.start) ? `（第 ${wk(t.start)} 週）` : ''}` : ''}</li>`).join('');
    const vs = recent.map(v => `<li>${esc(v.time)}｜${esc(v.staff)}｜${esc(CAT_LABEL(v.cat))}${v.closing ? '' : ''}${v.text ? `：${esc(v.text)}` : ''}${v.plantFail ? `<br><span class="pill late">種植失敗</span> ${esc(v.plantFail)}` : ''}${v.closing ? `<br>${esc(v.closing)}` : ''}</li>`).join('');
    // 0.4.44 只露最近一次拜訪，其他收進「看更早的」
    const vItems = vs ? vs.split('</li>').filter(Boolean).map(x => x + '</li>') : [];
    const more = vItems.length > 1 ? `<details><summary>看更早的 ${vItems.length - 1} 筆／ယခင်များ</summary><ul>${vItems.slice(1).join('')}</ul></details>` : '';
    box.innerHTML = `${H3}${head ? `<p class="sub">${head}</p>` : ''}${tr ? `<ul>${tr}</ul>` : ''}` +
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
    $('cropBox').hidden = !open;
    const sum = $n('cropSum');
    sum.hidden = !show || open;
    const t = $n('cropSumText');
    t.textContent = [crop ? `作物 ${cropText(crop)}` : '', vari ? `品種 ${vari}` : '', code ? `代碼 ${code}` : ''].filter(Boolean).join('｜');
  }
  async function refreshTrialBox() {
    const sel = $('farmer').value;
    const show = (state.cat === '試作' || state.cat === '推廣') && !!sel;
    $('trialBox').hidden = !show;
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
    if (m === 'start' && !$('tStart').value) { const d = new Date(); $('tStart').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
    if (m === 'end' && !$('tYieldUnit').value) $('tYieldUnit').value = (state.options && state.options.yieldUnit) || '籃';
    $('failBox').hidden = !((m === 'end' && $('tOutcome').value === '失敗') || plantFailOn());
    $('harvestBox').hidden = $('tOutcome').value === '失敗'; // 0.4.38 成功／結束 → 收成報告；失敗 → 失敗紀錄
    refreshSave();
  }
  /* 一般拜訪的種植失敗（0.4.33）：同一組失敗欄位（failBox）搬到一般拜訪下面用；切回試作結束時再搬回去 */
  const plantFailOn = () => state.cat === '農戶' && !!$('farmer').value && $('plantFail').checked;
  function refreshPlantFail() {
    const show = state.cat === '農戶' && !!$('farmer').value && !noMeetOn();
    $('plantFailBox').hidden = !show;
    if (!show) $('plantFail').checked = false;
    const box = $('failBox');
    if (plantFailOn()) { if (box.parentElement !== $('plantFailSlot')) $('plantFailSlot').appendChild(box); box.hidden = false; }
    else {
      if (box.parentElement === $('plantFailSlot')) $('trialEndForm').appendChild(box);
      box.hidden = !(state.trialMode === 'end' && $('tOutcome').value === '失敗');
    }
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
    if (on && !$('nmNext').value) { const d = new Date(Date.now() + 7 * 86400000); $('nmNext').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
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
    const v = $('nmNext').value, d = new Date(), today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const max = new Date(Date.now() + 365 * 86400000), maxS = `${max.getFullYear()}-${pad(max.getMonth() + 1)}-${pad(max.getDate())}`;
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
    if (state.trialMode === 'start' && !$('tItem').value.trim()) return `請填${state.cat}品項／ပစ္စည်းအမည် ဖြည့်ပါ`;
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
  /** 結案（2026-11-12 手稿）：價格、產量、收購客戶必填；地區、電話可空 */
  function closeProblem() {
    if (state.dealerClose) { // 0.4.42 盤商、種子商結案：洽談結果＋說明必填，送主管審核
      const sel = $('farmer').value;
      if (!sel || sel === '__new') return '請先選要結案的' + state.cat + '／ဖောက်သည် ရွေးပါ';
      const miss = [['dcOutcome', '洽談結果'], ['dcNote', '說明']].filter(([id]) => !String($(id).value).trim()).map(([, n]) => n);
      return miss.length ? `結案要填：${miss.join('、')}／ပိတ်သိမ်းရန် ဖြည့်ပါ` : '';
    }
    if (state.cat !== '結案') return '';
    const miss = [['cPrice', '價格'], ['cYield', '產量'], ['cBuyer', '收購客戶']].filter(([id]) => !String($(id).value).trim()).map(([, n]) => n);
    return miss.length ? `結案要填：${miss.join('、')}／ပိတ်သိမ်းရန် ဖြည့်ပါ` : '';
  }
  function collectClosing() {
    if (state.dealerClose) return { outcome: $n('dcOutcome').value, note: $n('dcNote').value.trim() }; // 0.4.42 盤商、種子商
    if (state.cat !== '結案') return null;
    return { region: $('cRegion').value, price: $('cPrice').value.trim(), yield: $('cYield').value.trim(), buyer: $('cBuyer').value.trim(), phone: $('cPhone').value.trim() };
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
    if (state.trialMode === 'start') return { op: 'start', tempId, item: $('tItem').value.trim(), dosage: $('tDosage').value.trim(), start: $('tStart').value };
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
    $('tOutcome').value = '成功';
    $('plantFail').checked = false; // 0.4.33
    state.activeTrial = null;
    setTrialMode(null);
    refreshPlantFail();
    $('trialBox').hidden = true;
  }

  /** 新客戶：全部欄位；舊客戶：只送有改的欄位 */
  function collectProfile() {
    const val = $('farmer').value;
    const p = {};
    activeKeys().forEach(k => { p[k] = $(PROFILE_INPUTS[k]).value.trim(); });
    if ('variety' in p) p.variety = varietyValue(); // 0.4.50
    if (val === '__new') {
      p.type = isDealerCat() ? state.cat : '農民';
      return p;
    }
    const changed = {};
    activeKeys().forEach(k => { if (state.original && p[k] !== String(state.original[k]).trim()) changed[k] = p[k]; });
    return Object.keys(changed).length ? changed : null;
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

  async function addPhotos(files, source, btn) {
    const list = [...(files || [])];
    if (!list.length) return;
    const gen = state.formGen;
    const room = MAX_PHOTOS - state.photos.length;
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
      renderThumbs(); refreshSave();
    }
    btn.classList.remove('busy');
    if (failed) toast(`有 ${failed} 張照片讀不了（可能是 HEIC 格式），請改拍或換一張／ဓာတ်ပုံ ${failed} ပုံ ဖွင့်မရ၊ ပြန်ရိုက်ပါ`);
    renderThumbs();
    refreshSave();
  }

  function renderThumbs() {
    (state.thumbUrls || []).forEach(u => URL.revokeObjectURL(u));
    state.thumbUrls = state.photos.map(p => URL.createObjectURL(p.blob));
    $('thumbs').innerHTML = state.photos.map((p, i) => `<div class="thumb"><img src="${state.thumbUrls[i]}" alt="照片 ${i + 1}"><span class="tag">${p.source === '相簿' ? '相簿 ဓာတ်ပုံ' : '相機 ကင်မရာ'}</span><button type="button" class="del" data-i="${i}" aria-label="刪掉這張">×</button></div>`).join('');
    $('thumbs').querySelectorAll('.del').forEach(b => b.addEventListener('click', () => { state.photos.splice(Number(b.dataset.i), 1); renderThumbs(); refreshSave(); }));
    $('photoBtn').classList.toggle('done', state.photos.some(p => p.source === '相機'));
    $('albumBtn').classList.toggle('done', state.photos.some(p => p.source === '相簿'));
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
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('這支手機的瀏覽器不支援錄音／ဤဖုန်း အသံသွင်း မရ'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { toast('沒有麥克風權限，請到瀏覽器設定允許麥克風／မိုက်ခရိုဖုန်း ခွင့်ပြုချက် ပေးပါ'); return; }
    const chunks = [];
    const gen = state.formGen;
    const rec = new MediaRecorder(stream);
    state.rec = rec; state.audioSec = 0; state.audio = null;
    rec.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
    rec.onstop = async () => {
      clearInterval(state.recTimer);
      stream.getTracks().forEach(t => t.stop());
      if (state.rec === rec) state.rec = null;
      if (gen !== state.formGen) return; // 錄到一半回首頁：這段錄音作廢，不能掉進下一筆拜訪（2026-11-11 抓到）
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
      refreshSave();
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
  function addPriceRow(p) {
    if ($('priceRows').children.length >= MAX_PRICES) { refreshPriceBtn(); return; }
    const unit = (state.options && state.options.priceUnit) || '緬幣／籃';
    const div = document.createElement('div');
    div.className = 'price-row';
    div.innerHTML = `<input type="text" class="pc" list="dlCrops" placeholder="作物 သီးနှံ" maxlength="40">
      <input type="text" class="pv" list="dlVarieties" placeholder="品種 မျိုး（可空白）" maxlength="80">
      <input type="number" class="pp" min="0" step="any" inputmode="decimal" placeholder="價格 ဈေးနှုန်း">
      <input type="text" class="pu" maxlength="30">
      <button type="button" class="del" aria-label="刪掉這筆價格">×</button>`;
    div.querySelector('.pu').value = (p && p.unit) || unit;
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
    })).filter(p => (p.crop || p.variety) && p.price !== '' && isFinite(Number(p.price)));
  }

  /* ───── 儲存＋自動上傳 ───── */
  function refreshSave() {
    const sel = $('farmer').value;
    const isNew = sel === '__new';
    const nameOk = !isNew || $('pName').value.trim();
    const hasContent = noMeetOn() || state.photos.length || state.audio || $('note').value.trim() || collectPrices().length || state.trialMode || ((state.cat === '結案' || state.dealerClose) && !closeProblem()) || (sel && sel !== '__new' && collectProfile());
    $('note').placeholder = noteExample().join('\n'); // 範例跟著農民進度換
    const tp = noMeetProblem() || trialProblem() || closeProblem();
    const ok = sel && nameOk && !state.rec && !state.busyPhotos && !tp && (isNew || hasContent);
    $('saveBtn').disabled = !ok;
    $('saveHint').textContent = !sel ? '' : !nameOk ? '請先填名字／အမည် အရင်ဖြည့်ပါ' : state.rec ? '錄音中，先按一下結束錄音／အသံသွင်းနေသည်၊ အရင် ရပ်ပါ' : state.busyPhotos ? `照片處理中（還有 ${state.busyPhotos} 張）… ဓာတ်ပုံ ပြင်ဆင်နေ` : tp ? tp : !ok ? `拍照、上傳照片、錄音、打字${state.cat === '盤商' ? '、記價格' : ''}${$('farmer').value === '__new' || SHOW_PROFILE_ON_VISIT ? '（或改客戶資料）' : ''}至少做一樣／ဓာတ်ပုံ၊ အသံ၊ စာ တစ်ခုခု လုပ်ပါ` : '';
  }

  async function save() {
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
      plantFailure: plantFailOn() ? collectFailure() : null, // 0.4.33 一般拜訪的種植失敗
      noMeet: collectNoMeet(), // 0.4.38 沒見到農民／農民拒絕 → 下次再訪
      farmerId,
      tempName,
      farmerLabel: `【${state.cat}】${name}${isNew ? '（新）' : ''}`,
      profile,
      text: noMeetOn() ? '' : $('note').value.trim(),
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
    state.cropOpen = false; $('cropBox').hidden = true; $n('cropSum').hidden = true;
    ['cPrice', 'cYield', 'cBuyer', 'cPhone'].forEach(id => { $(id).value = ''; });
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
    Object.values(PROFILE_INPUTS).forEach(id => { $(id).value = ''; });
    resetTrialForm();
    state.dealerClose = false; $n('dcOutcome').value = ''; $n('dcNote').value = ''; applyCatLabels(); // 0.4.42 存完回到一般拜訪
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
  async function syncNow() {
    const cfg = await getConfig();
    if (!cfg || !cfg.deviceKey) return;
    if (syncing || !navigator.onLine) { await renderQueue(); return; }
    syncing = true;
    try {
      let r = await runSync(p => { $('syncState').textContent = `上傳中 တင်နေသည် ${p.index} / ${p.total}…`; });
      if (r && r.code === 'BAD_LOGIN') {
        // 帳號被停用或重設密碼：手機裡沒傳的資料保留，重新登入後接著傳
        await Store.setMeta('config', { gasUrl: cfg.gasUrl });
        showLogin((r.error || '登入已失效') + '。沒上傳的資料還在手機裡，重新登入後會自動補傳。／ပြန်ဝင်ပြီးလျှင် ကျန်သော မှတ်တမ်း တင်မည်။');
        return;
      }
      if (r && !r.error && !r.sent) {
        // 沒有要上傳的，順便抓最新的客戶、選單和首頁數字
        const sentAt = Date.now();
        const data = await post(cfg.gasUrl, { action: 'sync', deviceKey: cfg.deviceKey }).catch(() => null);
        if (data && data.ok) await rememberServer(data, sentAt);
        else if (data && data.code === 'BAD_LOGIN') { await Store.setMeta('config', { gasUrl: cfg.gasUrl }); showLogin(data.message); return; }
      }
      $('syncState').textContent = r && r.error ? r.error : '';
      await pruneLocalCustomers();
      if (state.view === 'home') await renderHome();
      // 正在填拜訪而且已經選了客戶，就不重整選單（暫時客戶上傳後會換成正式編號，重整會把選好的清掉；R1-02）
      if (state.view === 'visit' && !$('farmer').value) { await loadOptions(); await loadFarmers(); }
    } finally {
      syncing = false;
      await renderQueue();
    }
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
            if (state.view !== 'visit' && !syncing) { nw.postMessage('skipWaiting'); setTimeout(() => location.reload(), 600); }
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
      const dirty = state.photos.length || state.audio || $('note').value.trim();
      if (dirty && !confirm('還沒儲存，確定要回首頁？剛剛的照片、錄音、打字會不見。\nမသိမ်းရသေးပါ။ ပြန်သွားလျှင် ဓာတ်ပုံ၊ အသံ၊ စာ ပျောက်မည်။')) return;
      if (state.rec) state.rec.stop();
      resetForm(); showHome();
    });
    $('farmer').addEventListener('change', onFarmerChange);
    Object.values(PROFILE_INPUTS).forEach(id => $(id).addEventListener('input', refreshSave));
    $('pArea').addEventListener('change', refreshSave);
    $('pCrop').addEventListener('change', () => fillVarieties('')); // 換作物就重選品種
    $('pVarCo').addEventListener('change', () => { fillVarieties(''); refreshSave(); }); // 0.4.31 換種子公司就重選品種
    $('plantFail').addEventListener('change', refreshPlantFail); // 0.4.33 一般拜訪勾「種植失敗」
    $('note').addEventListener('input', refreshSave);
    ['dcOutcome', 'dcNote'].forEach(id => { $(id).addEventListener('input', refreshSave); $(id).addEventListener('change', refreshSave); }); // 0.4.42
    ['cRegion', 'cPrice', 'cYield', 'cBuyer', 'cPhone'].forEach(id => { $(id).addEventListener('input', refreshSave); $(id).addEventListener('change', refreshSave); });
    $('photoInput').addEventListener('change', e => addPhotos(e.target.files, '相機', $('photoBtn')).finally(() => { e.target.value = ''; }));
    $('albumInput').addEventListener('change', e => addPhotos(e.target.files, '相簿', $('albumBtn')).finally(() => { e.target.value = ''; }));
    $('recBtn').addEventListener('click', toggleRec);
    $('saveBtn').addEventListener('click', save);
    // 0.4.57 董事長：結案放在首頁「我的進度」→ 選農民／盤商／種子商結案，直接進結案畫面（不能切去一般拜訪）
    document.querySelectorAll('[data-closecat]').forEach(b => b.addEventListener('click', async () => {
      const cat = b.dataset.closecat;
      state.closeNext = true;
      if (cat !== '結案') state.lockNext = true; // 盤商、種子商結案：另一種也鎖
      const pick = cat === '結案' ? $n('closeFarmer').value : ''; // 上面選單挑了農民：進結案畫面直接帶這位
      await openVisit(cat, pick || undefined);
      if (cat !== '結案') { // 0.4.42 盤商、種子商：不換類別，打開結案模式（洽談成功或失敗都送主管審核）
        state.dealerClose = true; state.noMeet = false; $n('dcOutcome').value = ''; $n('dcNote').value = '';
        applyCatLabels(); refreshNoMeet(); refreshSave();
      }
    }));
    $n('closeFarmer').addEventListener('change', showCloseProgress); // 0.4.57 結案選單挑農民 → 列出進度
    $n('plFarmer').addEventListener('change', onPlantFarmer); // 0.4.59 種植資料
    $n('plSave').addEventListener('click', savePlant);
    $n('plEditBtn').addEventListener('click', () => { $n('plHint').textContent = ''; setPlantEditing(true); }); // 0.4.61 按修改才變表單
    $n('plCancel').addEventListener('click', () => onPlantFarmer()); // 取消：表單換回原本的值、回到唯讀卡片
    $n('reportLoadBtn').addEventListener('click', loadReports); // 0.4.61 試作報告（成功／失敗）
    // 打卡畫面最下面「取消結案」：跟左上返回一樣，回首頁（還沒存的要先確認）
    $n('closeModeBtn').addEventListener('click', () => $('backBtn').click());
    $('relocateBtn').addEventListener('click', locate);
    $n('cropEditBtn').addEventListener('click', () => { state.cropOpen = true; renderCropSum(); }); // 0.4.44
    $('addPriceBtn').addEventListener('click', () => addPriceRow());
    $('trialStartBtn').addEventListener('click', () => setTrialMode(state.trialMode === 'start' ? null : 'start'));
    $('trialEndBtn').addEventListener('click', () => setTrialMode(state.trialMode === 'end' ? null : 'end'));
    $('tOutcome').addEventListener('change', () => setTrialMode('end'));
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
