/* 打卡網頁主程式（第 2 期 2A）：帳號密碼登入 → 首頁四類工作 → 拜訪（客戶資料、照片、相簿、錄音、打字、價格） */
/* global FarmCore, FARM_CONFIG */
(function () {
  const { Store, runSync, post, rememberServer, pruneLocalCustomers, updateTaskDone } = FarmCore;
  const $ = id => document.getElementById(id);
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
  const CAT_TYPES = { 試作: ['農民'], 推廣: ['農民'], 農戶: ['農民'], 盤商: ['盤商'], 種子商: ['種子商'] }; // 盤商、種子商分開（2026-11-11 董事長）
  const CAT_LABEL = c => (c === '農戶' ? '一般拜訪' : c); // 「農戶」是舊資料的值，畫面上叫「一般拜訪」

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
    $('setupMsg').textContent = msg || '只要登入一次，之後沒網路也能打卡。帳號請向主管索取。';
    $('setupMsg').className = msg ? 'sub err' : 'sub';
  }

  async function onLogin(ev) {
    ev.preventDefault();
    const msg = $('setupMsg');
    const account = $('acct').value.trim(), password = $('pw').value;
    const payload = { action: 'login', account, password, deviceId: deviceId() };
    if (state.mustChange) {
      const np = $('newPw').value, np2 = $('newPw2').value;
      if (np.length < 6) { msg.textContent = '新密碼至少 6 個字'; msg.className = 'sub err'; return; }
      if (np !== np2) { msg.textContent = '兩次輸入的新密碼不一樣'; msg.className = 'sub err'; return; }
      payload.newPassword = np;
    }
    const others = (await Store.allVisits()).filter(v => v.status === 'pending' && v.account && v.account !== account.toLowerCase());
    if (others.length) {
      // 換人登入同一支手機：前一個人的資料會被記到新帳號名下，所以先擋（2026-11-11 審查發現）
      msg.textContent = `這支手機還有 ${others.length} 筆「${others[0].account}」沒上傳的資料，請先用 ${others[0].account} 登入，等資料傳完再換人。`;
      msg.className = 'sub err'; return;
    }
    msg.textContent = '確認中…'; msg.className = 'sub';
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
      msg.textContent = '連不上伺服器，第一次登入需要網路'; msg.className = 'sub err';
    } finally {
      $('loginBtn').disabled = false;
    }
  }

  async function logout() {
    const pending = (await Store.allVisits()).filter(v => v.status === 'pending').length;
    const ticks = ((await Store.getMeta('taskDone')) || []).length; // 任務打勾也要先送出（GPT-6.1 R4-07）
    if (pending || ticks) { toast(`還有 ${[pending ? pending + ' 筆拜訪' : '', ticks ? ticks + ' 個任務打勾' : ''].filter(Boolean).join('、')}沒上傳，先連上網路等它傳完再登出`); return; }
    if (!confirm('確定要登出嗎？之後要再輸入帳號密碼。')) return;
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

  async function renderHome() {
    const h = (await Store.getMeta('home')) || null;
    const list = h ? h.schedule : [];
    $('scheduleList').innerHTML = list.map(s => `<li class="go" data-id="${esc(s.id)}" data-type="${esc(s.type)}"><span>${esc(s.name)}<br><small>${esc(s.type || '')}・應回訪 ${esc(s.due.slice(5).replace('-', '/'))}</small></span>${s.late ? '<span class="pill late">逾期</span>' : s.due === h.today ? '<span class="pill wait">今天</span>' : ''}</li>`).join('')
      || `<li class="empty">${h ? '這 7 天沒有排到回訪' : '連上網路後會顯示'}</li>`;
    $('scheduleList').querySelectorAll('li.go').forEach(li => li.addEventListener('click', () => {
      openVisit(li.dataset.type === '盤商' || li.dataset.type === '種子商' ? li.dataset.type : '試作', li.dataset.id);
    }));
    await renderTasks();
    // 月計劃（2C）
    const plan = (h && h.plan) || [];
    $('planList').innerHTML = plan.map(p => `<li class="plan"><span>${esc(p.label)}<br><small>${esc(p.period)}　${p.done}／${p.target}</small>
      <span class="bar"><i style="width:${Math.max(0, Math.min(100, p.pct))}%"></i></span></span>${p.done >= p.target ? '<span class="pill ok">達成</span>' : `<span class="pill wait">${p.pct}%</span>`}</li>`).join('')
      || `<li class="empty">${h && h.plan ? '這個月沒有訂目標' : '連上網路後會顯示'}</li>`; // 舊版留下的首頁資料沒有計劃欄，不能說成沒有目標（第五輪自抓）
    // 工作進度：最近 3 個月可以切換
    const hist = (h && h.history) || [];
    if (!hist.some(x => x.month === state.homeMonth)) state.homeMonth = hist.length ? hist[0].month : '';
    $('monthChips').innerHTML = hist.map(x => `<button type="button" class="chip" data-m="${esc(x.month)}" aria-pressed="${x.month === state.homeMonth}">${Number(x.month.slice(5))} 月</button>`).join('');
    $('monthChips').querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => { state.homeMonth = b.dataset.m; renderHome(); }));
    const cur = hist.find(x => x.month === state.homeMonth);
    $('statVisits').textContent = cur ? cur.visits : (h ? h.monthVisits : '—');
    $('statNew').textContent = cur ? cur.newCustomers : (h ? h.newCustomers : '—');
    $('statCust').textContent = cur ? cur.customersVisited : '—';
    $('statTrials').textContent = cur ? `${cur.trialsStarted}／${cur.trialsEnded}` : '—';
    const bc = cur ? cur.byCategory : (h && h.byCategory) || {};
    $('statByCat').textContent = Object.keys(bc || {}).length ? '類別：' + Object.entries(bc).map(([k, n]) => `${CAT_LABEL(k)} ${n} 次`).join('、') : '';
    if (h && h.syncedAt) { const d = new Date(h.syncedAt); $('homeSynced').textContent = `（${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())} 更新）`; }
  }

  /* ───── 農民任務：主管派、業務打勾（離線也能勾，有網路再送） ───── */
  async function renderTasks() {
    const tasks = (await Store.getMeta('tasks')) || [];
    const tickList = (await Store.getMeta('taskDone')) || [];
    const ticked = new Set(tickList.map(t => t.id));
    const sending = new Set(tickList.filter(FarmCore.isSending).map(t => t.id));
    const open = tasks.filter(t => t.status === '待辦');
    const done = tasks.filter(t => t.status === '已完成');
    const row = (t, isDone) => {
      const wait = !isDone && ticked.has(t.id);
      const busy = wait && sending.has(t.id); // 送出中：請求已經在路上，不能取消（R6-05）
      return `<li class="task${isDone || wait ? ' done' : ''}"><label><input type="checkbox" data-task="${esc(t.id)}"${isDone || wait ? ' checked' : ''}${isDone || busy ? ' disabled' : ''}>
        <span><b>${esc(t.name)}</b>：${esc(t.text)}<br><small>${isDone ? '已完成 ' + esc(String(t.doneAt || '').slice(5, 16)) : busy ? '送出中…（送出後就不能取消）' : wait ? '已打勾，有網路會自動送出（再按一下可取消）' : esc(t.by || '主管') + ' 派・' + esc(String(t.at || '').slice(5, 10))}</small></span></label>
        ${isDone ? '' : `<button type="button" class="btn2 small" data-taskgo="${esc(t.cid)}">去拜訪</button>`}</li>`;
    };
    $('taskList').innerHTML = open.map(t => row(t, false)).join('') + done.map(t => row(t, true)).join('')
      || `<li class="empty">${(await Store.getMeta('home')) ? '目前沒有主管派的任務' : '連上網路後會顯示'}</li>`;
    $('taskList').querySelectorAll('input[data-task]').forEach(cb => cb.addEventListener('change', () => toggleTask(cb.dataset.task, cb.checked)));
    $('taskList').querySelectorAll('[data-taskgo]').forEach(b => b.addEventListener('click', () => openVisit('農戶', b.dataset.taskgo)));
  }
  async function toggleTask(id, on) {
    const cfg = await getConfig();
    const at = Date.now() + ((await Store.getMeta('clockOffset')) || 0);
    if (on) {
      // 同一任務只留最新的一次打勾；正在送出的那一次不動（R4-03、R6-05）
      await updateTaskDone(list => (list.some(t => t.id === id && FarmCore.isSending(t)) ? list : list.filter(t => t.id !== id).concat([{ id, at, account: (cfg && cfg.account) || '' }])));
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
    $('pArea').innerHTML = '<option value="">— 選擇地區 —</option>' + o.regions.map(x => `<option>${esc(x)}</option>`).join('');
    $('pArea').value = keep;
    document.querySelectorAll('.unit').forEach(el => { el.textContent = `（${o.areaUnit}）`; });
    fillVarieties();
  }
  function fillVarieties() {
    const crop = $('pCrop').value.trim();
    const list = (state.options ? state.options.varieties : []).filter(v => !crop || !v.crop || v.crop === crop);
    $('dlVarieties').innerHTML = list.map(v => `<option value="${esc(v.name)}"></option>`).join('');
  }

  /* ───── 拜訪畫面 ───── */
  const isDealerCat = () => state.cat === '盤商' || state.cat === '種子商';

  async function openVisit(cat, customerId) {
    state.cat = cat;
    $('visitTitle').textContent = isDealerCat() ? cat : '農民・' + CAT_LABEL(cat);
    $('farmerLab').innerHTML = isDealerCat() ? `1. 選擇${cat}<span class="my">${cat === '種子商' ? 'မျိုးစေ့ဆိုင်' : 'ကုန်သည်'} ရွေးပါ</span>` : '1. 選擇農民<span class="my">လယ်သမား ရွေးပါ</span>';
    $('priceBox').hidden = !isDealerCat();
    document.querySelectorAll('.dealer-only').forEach(el => { el.hidden = !isDealerCat(); });
    document.querySelectorAll('.farmer-only').forEach(el => { el.hidden = isDealerCat(); });
    $('pNameLab').textContent = isDealerCat() ? `${cat}名字（公司）` : '農民名字';
    resetForm();
    await loadOptions();
    await loadFarmers();
    if (customerId) { $('farmer').value = customerId; onFarmerChange(); }
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
    const mine = all.filter(f => types.indexOf(f.type || '農民') >= 0);
    sel.innerHTML = '<option value="">— 請選擇 —</option>' +
      mine.map(f => `<option value="${esc(f.id)}">${esc(f.name)}${f.area ? '｜' + esc(String(f.area).split(/[ （(]/)[0]) : ''}${f.crop ? '｜' + esc(f.crop) : ''}${f.pending ? '（新，未上傳）' : ''}</option>`).join('') +
      `<option value="__new">${isDealerCat() ? `＋ 新增${state.cat}` : '＋ 新增農民（ လယ်သမား အသစ် ）'}</option>`;
    if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
    state.allCustomers = all;
  }

  const PROFILE_INPUTS = { name: 'pName', owner: 'pOwner', phone: 'pPhone', area: 'pArea', address: 'pAddress', brand: 'pBrand', crop: 'pCrop', variety: 'pVariety', areaNow: 'pAreaNow', areaMax: 'pAreaMax', plantDate: 'pPlantDate', fertilizer: 'pFert' };
  const DEALER_KEYS = ['name', 'owner', 'phone', 'area', 'address', 'brand'];
  const FARMER_KEYS = ['name', 'phone', 'area', 'crop', 'variety', 'areaNow', 'areaMax', 'plantDate', 'fertilizer'];
  const activeKeys = () => (isDealerCat() ? DEALER_KEYS : FARMER_KEYS);

  function onFarmerChange() {
    const val = $('farmer').value;
    const box = $('profileBox');
    Object.values(PROFILE_INPUTS).forEach(id => { $(id).value = ''; });
    state.original = null;
    if (!val) { box.hidden = true; refreshSave(); return; }
    box.hidden = false;
    $('dealerTypeBox').hidden = true; // 盤商、種子商分開進來，種類就是入口，不用再選
    if (val === '__new') {
      box.open = true;
      $('profileTitle').textContent = isDealerCat() ? `新${state.cat}資料` : '新農民資料';
    } else {
      const c = (state.allCustomers || []).find(f => f.id === val) || {};
      activeKeys().forEach(k => { const el = $(PROFILE_INPUTS[k]); el.value = c[k] == null ? '' : String(c[k]); });
      if ($('pArea').value !== String(c.area || '') && c.area) $('pArea').insertAdjacentHTML('beforeend', `<option>${esc(c.area)}</option>`), $('pArea').value = c.area;
      state.original = {};
      activeKeys().forEach(k => { state.original[k] = $(PROFILE_INPUTS[k]).value; });
      box.open = false;
      $('profileTitle').textContent = '客戶資料（點開可修改）';
    }
    fillVarieties();
    // 換客戶就清掉試作表單：剛剛打的結果不能套到另一位客戶的試作（2026-11-11 第四輪自抓 T8）
    resetTrialForm();
    refreshSave();
    refreshTrialBox();
  }

  /* ───── 試作（2B）：開始一件試作、填結果結束（失敗要填失敗紀錄） ───── */
  async function activeTrialFor(cid, cat) {
    const server = (await Store.getMeta('trials')) || [];
    const local = (await Store.getMeta('localTrials')) || [];
    const ended = new Set(local.filter(l => l.ended).map(l => l.id));
    const list = server.filter(t => t.cid === cid && t.cat === cat && !ended.has(t.id))
      .concat(local.filter(l => !l.ended && l.cid === cid && l.cat === cat));
    return list[list.length - 1] || null;
  }
  async function refreshTrialBox() {
    const sel = $('farmer').value;
    const show = (state.cat === '試作' || state.cat === '推廣') && !!sel;
    $('trialBox').hidden = !show;
    if (!show) { if (state.trialMode) setTrialMode(null); return; }
    $('trialLab').firstChild.textContent = state.cat;
    $('trialStartBtn').textContent = `＋ 開始新的${state.cat}`;
    $('tItemLab').textContent = `${state.cat}品項（必填）`;
    const gen = state.formGen;
    const t = sel === '__new' ? null : await activeTrialFor(sel, state.cat);
    if (gen !== state.formGen || sel !== $('farmer').value) return;
    state.activeTrial = t;
    $('trialNow').textContent = t ? `進行中：${t.item || '（未填品項）'}${t.start ? '，' + t.start + ' 開始' : ''}${t.pending ? '（還沒上傳）' : ''}` : `這位客戶目前沒有進行中的${state.cat}。`;
    $('trialStartBtn').hidden = !!t; $('trialEndBtn').hidden = !t;
    if ((state.trialMode === 'end' && !t) || (state.trialMode === 'start' && t)) setTrialMode(null);
  }
  function setTrialMode(m) {
    state.trialMode = m;
    $('trialStartForm').hidden = m !== 'start'; $('trialEndForm').hidden = m !== 'end';
    $('trialStartBtn').setAttribute('aria-pressed', String(m === 'start')); $('trialEndBtn').setAttribute('aria-pressed', String(m === 'end'));
    if (m === 'start' && !$('tStart').value) { const d = new Date(); $('tStart').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
    if (m === 'end' && !$('tYieldUnit').value) $('tYieldUnit').value = (state.options && state.options.yieldUnit) || '籃';
    $('failBox').hidden = !(m === 'end' && $('tOutcome').value === '失敗');
    refreshSave();
  }
  function trialProblem() {
    if (state.trialMode === 'end' && !state.activeTrial) return `找不到進行中的${state.cat}，請重新選一次客戶`; // T9
    if (state.trialMode === 'start' && !$('tItem').value.trim()) return `請填${state.cat}品項`;
    if (state.trialMode === 'end' && $('tOutcome').value === '失敗') {
      // 失敗紀錄全部必填，沒填就存不了（董事長 2026-11-12）；病蟲害選「有」時說明也要填
      const miss = [['fWeather', '天氣'], ['fTemp', '溫度'], ['fFert', '施肥情況'], ['fWater', '水分'], ['fPest', '病蟲害'], ['fReason', '失敗原因']]
        .filter(([id]) => !String($(id).value).trim()).map(([, n]) => n);
      if ($('fPest').value === '有' && !$('fPestNote').value.trim()) miss.push('病蟲害說明');
      if (miss.length) return `${state.cat}失敗要填：${miss.join('、')}`;
    }
    return '';
  }
  function collectTrial(tempId) {
    if (state.trialMode === 'start') return { op: 'start', tempId, item: $('tItem').value.trim(), dosage: $('tDosage').value.trim(), start: $('tStart').value };
    if (state.trialMode !== 'end' || !state.activeTrial) return null;
    const t = state.activeTrial;
    const o = { op: 'end', id: t.id, outcome: $('tOutcome').value, height: $('tHeight').value, grains: $('tGrains').value, yield: $('tYield').value,
      yieldUnit: $('tYieldUnit').value.trim(), score: $('tScore').value, comment: $('tComment').value.trim(), other: $('tOther').value.trim() };
    if (o.outcome === '失敗') o.failure = { weather: $('fWeather').value, temp: $('fTemp').value, fert: $('fFert').value.trim(), water: $('fWater').value, pest: $('fPest').value, pestNote: $('fPestNote').value.trim(), reason: $('fReason').value.trim() };
    // 開始那筆還沒上傳：結束也帶著開始的資料，萬一順序顛倒後台照樣建得出來
    if (t.pending) o.startInfo = { item: t.item, dosage: t.dosage, start: t.start };
    return o;
  }
  function resetTrialForm() {
    ['tItem', 'tDosage', 'tStart', 'tHeight', 'tGrains', 'tYield', 'tYieldUnit', 'tComment', 'tOther', 'fTemp', 'fFert', 'fPestNote', 'fReason', 'tScore', 'fWeather', 'fWater', 'fPest'].forEach(id => { $(id).value = ''; });
    $('tOutcome').value = '成功';
    state.activeTrial = null;
    setTrialMode(null);
    $('trialBox').hidden = true;
  }

  /** 新客戶：全部欄位；舊客戶：只送有改的欄位 */
  function collectProfile() {
    const val = $('farmer').value;
    const p = {};
    activeKeys().forEach(k => { p[k] = $(PROFILE_INPUTS[k]).value.trim(); });
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
    if (!('geolocation' in navigator)) { box.textContent = '📍 這支手機不支援定位，會標記「無定位」'; return Promise.resolve(); }
    box.textContent = '📍 定位中…（最多 30 秒）';
    return new Promise(done => navigator.geolocation.getCurrentPosition(p => {
      state.gps = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) };
      box.innerHTML = `📍 已定位 <b>${state.gps.lat}, ${state.gps.lng}</b>（誤差 ${state.gps.acc} 公尺）`;
      done();
    }, err => {
      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      box.innerHTML = err.code === 1
        ? '📍 <b style="color:var(--chili)">定位被關掉了</b>，打卡會標記「無定位」。' + (isIOS
          ? '請到 iPhone「設定 → 隱私權與安全性 → 定位服務」打開，並把「Safari 網站」（或 Chrome）設成「使用 App 期間」，再回來按「重新定位」。'
          : '請按網址列左邊的圖示 →「權限」→ 允許「位置」，並確認手機的定位服務是開的，再按「重新定位」。')
        : '📍 抓不到位置（可能訊號不好），仍可儲存，會標記「無定位」。可以到空曠處按「重新定位」。';
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
    if (room <= 0) { toast(`一次拜訪最多 ${MAX_PHOTOS} 張照片`); return; }
    if (list.length > room) toast(`最多 ${MAX_PHOTOS} 張，只取前 ${room} 張`);
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
    if (failed) toast(`有 ${failed} 張照片讀不了（可能是 HEIC 格式），請改拍或換一張`);
    renderThumbs();
    refreshSave();
  }

  function renderThumbs() {
    (state.thumbUrls || []).forEach(u => URL.revokeObjectURL(u));
    state.thumbUrls = state.photos.map(p => URL.createObjectURL(p.blob));
    $('thumbs').innerHTML = state.photos.map((p, i) => `<div class="thumb"><img src="${state.thumbUrls[i]}" alt="照片 ${i + 1}"><span class="tag">${p.source === '相簿' ? '相簿' : '相機'}</span><button type="button" class="del" data-i="${i}" aria-label="刪掉這張">×</button></div>`).join('');
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
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('這支手機的瀏覽器不支援錄音'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { toast('沒有麥克風權限，請到瀏覽器設定允許麥克風'); return; }
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
      btn.querySelector('.label').textContent = '處理錄音中…';
      const raw = new Blob(chunks, { type: rec.mimeType || 'audio/mp4' });
      let audio;
      try { audio = await toWav16k(raw); }
      catch (e) { audio = raw; } // 轉不了就送原檔，後台再判斷
      if (gen !== state.formGen) return;
      state.audio = audio;
      btn.classList.add('done');
      btn.querySelector('.label').innerHTML = `✓ 已錄 ${state.audioSec} 秒`;
      refreshSave();
    };
    rec.start(1000);
    btn.classList.add('rec'); btn.classList.remove('done');
    btn.querySelector('.label').textContent = '錄音中 0 秒・再按一下結束';
    state.recTimer = setInterval(() => {
      state.audioSec++;
      btn.querySelector('.label').textContent = `錄音中 ${state.audioSec} 秒・再按結束`;
      if (state.audioSec >= MAX_REC_SEC) rec.stop();
    }, 1000);
    refreshSave();
  }

  /* ───── 盤商價格 ───── */
  const MAX_PRICES = 20; // 跟後台 Code.gs 的 MAX_PRICES 一樣：超過的後台收不了（第七輪 B-03）
  function refreshPriceBtn() {
    const full = $('priceRows').children.length >= MAX_PRICES;
    $('addPriceBtn').disabled = full;
    $('addPriceBtn').textContent = full ? `一次最多記 ${MAX_PRICES} 筆價格` : '＋ 加一筆價格';
  }
  function addPriceRow(p) {
    if ($('priceRows').children.length >= MAX_PRICES) { refreshPriceBtn(); return; }
    const unit = (state.options && state.options.priceUnit) || '緬幣／籃';
    const div = document.createElement('div');
    div.className = 'price-row';
    div.innerHTML = `<input type="text" class="pc" list="dlCrops" placeholder="作物" maxlength="40">
      <input type="text" class="pv" list="dlVarieties" placeholder="品種（可空白）" maxlength="80">
      <input type="number" class="pp" min="0" step="any" inputmode="decimal" placeholder="價格">
      <input type="text" class="pu" maxlength="30">
      <button type="button" class="del" aria-label="刪掉這筆價格">×</button>`;
    div.querySelector('.pu').value = (p && p.unit) || unit;
    div.querySelector('.del').addEventListener('click', () => { div.remove(); refreshPriceBtn(); refreshSave(); });
    div.querySelectorAll('input').forEach(i => i.addEventListener('input', refreshSave));
    $('priceRows').appendChild(div);
    refreshPriceBtn();
  }
  function collectPrices() {
    if (!isDealerCat()) return [];
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
    const hasContent = state.photos.length || state.audio || $('note').value.trim() || collectPrices().length || state.trialMode || (sel && sel !== '__new' && collectProfile());
    const tp = trialProblem();
    const ok = sel && nameOk && !state.rec && !state.busyPhotos && !tp && (isNew || hasContent);
    $('saveBtn').disabled = !ok;
    $('saveHint').textContent = !sel ? '' : !nameOk ? '請先填名字' : state.rec ? '錄音中，先按一下結束錄音' : state.busyPhotos ? `照片處理中（還有 ${state.busyPhotos} 張）…` : tp ? tp : !ok ? `拍照、上傳照片、錄音、打字${isDealerCat() ? '、記價格' : ''}（或改客戶資料）至少做一樣` : '';
  }

  async function save() {
    $('saveBtn').disabled = true;
    const cfg = await getConfig();
    if (!cfg || !cfg.deviceKey) { showLogin('請先登入'); return; }
    if (!state.gps) { toast('再抓一次位置…'); await Promise.race([locate(), new Promise(r => setTimeout(r, 15000))]); }
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
      category: state.cat,
      farmerId,
      tempName,
      farmerLabel: `【${state.cat}】${name}${isNew ? '（新）' : ''}`,
      profile,
      text: $('note').value.trim(),
      prices: collectPrices(),
      trial: collectTrial(`T_${tag}_${stamp}_tr${rand}`),
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
      toast('手機存檔失敗（可能空間不足），資料還在畫面上，請再按一次');
      refreshSave();
      return;
    }
    resetForm();
    toast('已存在手機裡，會自動上傳');
    await showHome();
    requestBackgroundSync();
    syncNow();
  }

  function resetForm() {
    state.formGen++;
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
      let r = await runSync(p => { $('syncState').textContent = `上傳中 ${p.index} / ${p.total}…`; });
      if (r && r.code === 'BAD_LOGIN') {
        // 帳號被停用或重設密碼：手機裡沒傳的資料保留，重新登入後接著傳
        await Store.setMeta('config', { gasUrl: cfg.gasUrl });
        showLogin((r.error || '登入已失效') + '。沒上傳的資料還在手機裡，重新登入後會自動補傳。');
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
    const all = (await Store.allVisits()).sort((a, b) => b.deviceTime - a.deviceTime);
    const pending = all.filter(v => v.status === 'pending');
    const rejected = all.filter(v => v.status === 'rejected').length;
    const ticks = ((await Store.getMeta('taskDone')) || []).length;
    const left = [pending.length ? `${pending.length} 筆拜訪` : '', ticks ? `${ticks} 個任務打勾` : ''].filter(Boolean).join('、');
    $('pendingCount').textContent = (left ? `還有 ${left}沒上傳` : '全部都上傳了') + (rejected ? `（另有 ${rejected} 筆被拒，請洽主管）` : '');
    $('pendingCount').className = 'count ' + (left ? 'wait' : 'ok');
    $('queueList').innerHTML = all.slice(0, 12).map(v => {
      const d = new Date(v.deviceTime);
      const tag = v.status === 'uploaded' ? '<span class="pill ok">已上傳</span>'
        : v.status === 'rejected' ? '<span class="pill late">被拒，請洽主管</span>' : '<span class="pill wait">等上傳</span>';
      const n = Array.isArray(v.photos) && v.photos.length ? v.photos.length : (v.photoCount || (v.photo ? 1 : 0));
      const what = [n ? `照片 ${n}` : '', v.audioSec ? `錄音 ${v.audioSec} 秒` : '', v.text ? '打字' : '', v.prices && v.prices.length ? `價格 ${v.prices.length}` : ''].filter(Boolean).join('・');
      return `<li><span>${esc(v.farmerLabel)}<br><small>${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}${what ? '・' + esc(what) : ''}</small></span>${tag}</li>`;
    }).join('') || '<li class="empty">還沒有紀錄</li>';
  }

  /* ───── 小提示 ───── */
  let toastTimer;
  function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3000); }

  /* ───── 啟動 ───── */
  async function init() {
    $('appVer').textContent = 'v' + FARM_CONFIG.appVersion;
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
    // 「農民」先展開試作／推廣／一般拜訪三個選項
    $('farmerBtn').addEventListener('click', () => {
      const open = $('farmerCats').hidden;
      $('farmerCats').hidden = !open;
      $('farmerBtn').setAttribute('aria-expanded', String(open));
    });
    $('backBtn').addEventListener('click', () => {
      const dirty = state.photos.length || state.audio || $('note').value.trim();
      if (dirty && !confirm('還沒儲存，確定要回首頁？剛剛的照片、錄音、打字會不見。')) return;
      if (state.rec) state.rec.stop();
      resetForm(); showHome();
    });
    $('farmer').addEventListener('change', onFarmerChange);
    Object.values(PROFILE_INPUTS).forEach(id => $(id).addEventListener('input', refreshSave));
    $('pArea').addEventListener('change', refreshSave);
    $('pCrop').addEventListener('input', fillVarieties);
    $('note').addEventListener('input', refreshSave);
    $('photoInput').addEventListener('change', e => addPhotos(e.target.files, '相機', $('photoBtn')).finally(() => { e.target.value = ''; }));
    $('albumInput').addEventListener('change', e => addPhotos(e.target.files, '相簿', $('albumBtn')).finally(() => { e.target.value = ''; }));
    $('recBtn').addEventListener('click', toggleRec);
    $('saveBtn').addEventListener('click', save);
    $('relocateBtn').addEventListener('click', locate);
    $('addPriceBtn').addEventListener('click', () => addPriceRow());
    $('trialStartBtn').addEventListener('click', () => setTrialMode(state.trialMode === 'start' ? null : 'start'));
    $('trialEndBtn').addEventListener('click', () => setTrialMode(state.trialMode === 'end' ? null : 'end'));
    $('tOutcome').addEventListener('change', () => setTrialMode('end'));
    document.querySelectorAll('#trialBox input, #trialBox select, #trialBox textarea').forEach(el => { el.addEventListener('input', refreshSave); el.addEventListener('change', refreshSave); });

    // 自動上傳的時機：有網路時、切回這個畫面時、每分鐘一次
    window.addEventListener('online', syncNow);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
    setInterval(syncNow, 60 * 1000);
    window.addEventListener('offline', () => { $('syncState').textContent = '沒有網路，資料先存在手機裡'; });

    const cfg = await getConfig();
    if (cfg && cfg.deviceKey) { await showHome(); syncNow(); } else showLogin();
  }
  window.__farmTest = { state, exifInfo }; // 本機測試用
  init();
})();
