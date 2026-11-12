/* 主管網頁：帳號密碼登入，從後台讀資料，畫出總覽、日曆、客戶履歷、地圖、紀錄表 */
/* global FARM_CONFIG */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 86400000;
  const s2d = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const d2s = d => d.toISOString().slice(0, 10);
  const addDays = (s, n) => d2s(new Date(s2d(s).getTime() + n * DAY));
  const md = s => { const d = s2d(s); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };

  const KEY_NAME = 'farm-boss-key';
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
    renderGen: 0 };  // 每畫一次加一，舊畫面的照片迴圈看到不同就停
  // 登入後的金鑰記在這台電腦的瀏覽器裡（存不了就每次重新登入）
  const keyStore = {
    get() { try { return localStorage.getItem(KEY_NAME); } catch (e) { return null; } },
    set(v) { try { if (v) localStorage.setItem(KEY_NAME, v); else localStorage.removeItem(KEY_NAME); } catch (e) { /* 無痕模式存不了 */ } }
  };

  async function api(payload) {
    const res = await fetch(FARM_CONFIG.gasUrl, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ deviceKey: state.key }, payload))
    });
    return res.json();
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

  function logout() { state.key = null; keyStore.set(null); state.data = null; showLogin(); }

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
    if (!state.trial && data.customers.length) state.trial = data.customers[0].id;
    $('login').hidden = true; $('app').hidden = false;
    $('who').textContent = data.name;
    $('updated').textContent = '更新於 ' + new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    $('sheetLink').href = data.sheetUrl;
    render();
  }

  /* ───── 計算 ───── */
  const active = () => state.data.customers.filter(c => c.status !== '已結束' && c.status !== '暫停');
  const dueState = c => !c.nextDue ? 'none' : c.nextDue < state.data.today ? 'late' : c.nextDue === state.data.today ? 'due' : 'ok';
  const visitsOf = id => (state.hist[id] || state.data.visits.filter(v => v.cid === id)).slice().sort((a, b) => b.time.localeCompare(a.time));
  const weekNo = (c, date) => c.start ? Math.max(1, Math.ceil((s2d(date) - s2d(c.start)) / DAY / 7)) : null;

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
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === state.tab));
    // 手機上分頁列會橫向捲動：選到的分頁捲進畫面裡（例如最右邊的「業務帳號」）
    const curTab = document.querySelector('.tab[aria-selected="true"]');
    if (curTab && curTab.scrollIntoView) curTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    $('panel').innerHTML = ({ today: renderToday, cal: renderCal, trial: renderTrial, map: renderMap, table: renderTable, reports: renderReports, progress: renderProgress, tasks: renderTasks, accounts: renderAccounts })[state.tab]();
    if (state.tab === 'tasks') bindTasks();
    if (state.tab === 'accounts') bindAccounts();
    $('panel').querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => { state.trial = el.dataset.go; state.tab = 'trial'; render(); }));
    $('panel').querySelectorAll('[data-play]').forEach(el => el.addEventListener('click', () => playAudio(el)));
    $('panel').querySelectorAll('[data-speak]').forEach(el => el.addEventListener('click', () => speak(el)));
    $('panel').querySelectorAll('[data-report]').forEach(el => el.addEventListener('click', () => downloadReport(el)));
    $('panel').querySelectorAll('[data-filter]').forEach(el => el.addEventListener('change', () => { state.rf[el.dataset.filter] = el.value; render(); }));
    $('panel').querySelectorAll('[data-month]').forEach(el => el.addEventListener('change', () => { state.pm = el.value; render(); }));
    if (state.tab === 'progress') loadProgress();
    if (state.tab === 'trial') { loadPhotos(); loadHistory(); }
  }

  /** 客戶履歷：總覽只有最近 500 筆，舊客戶的早期拜訪會不見，點進來時拿完整的（2026-11-11 抓到） */
  async function loadHistory() {
    const c = state.data.customers.find(x => x.id === state.trial) || state.data.customers[0];
    if (!c || state.hist[c.id] || state.histReq[c.id]) return; // 已經有、或正在拿，不重複要
    state.histReq[c.id] = true;
    let r;
    try { r = await api({ action: 'history', cid: c.id }); } catch (e) { r = null; } finally { delete state.histReq[c.id]; }
    if (!r || !r.ok) return;
    state.hist[c.id] = r.visits;
    if (state.tab === 'trial' && (state.trial || state.data.customers[0].id) === c.id) render();
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

  const catPill = v => `<span class="pill p-grn">${esc(v.cat || '試作')}</span> `;
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
      ${v.prices ? `<br><span class="sub pre">價格：${esc(v.prices)}</span>` : ''}
      ${v.nav ? `<br><a href="${esc(v.nav)}" target="_blank" rel="noopener">導航 ↗</a>` : ''}${soundBtns(v)}</li>`;
  }

  function renderToday() {
    const cs = active();
    const late = cs.filter(c => dueState(c) === 'late'), due = cs.filter(c => dueState(c) === 'due');
    const recent = state.data.visits.slice().sort((a, b) => b.time.localeCompare(a.time)).slice(0, 15);
    const li = c => { const l = visitsOf(c.id)[0]; return `<li><b><a href="javascript:void 0" data-go="${esc(c.id)}">${esc(c.name)}</a></b>（${esc(c.crop || '—')}）— ${esc(c.staff || '未指派')}${c.nextDue ? ' — 應回訪 ' + md(c.nextDue) : ''}${l && l.issue && l.issue !== '無' ? `<br><span class="sub">上次問題：${esc(l.issue)}</span>` : ''}</li>`; };
    return `<section><h3><span class="pill p-red">逾期</span></h3><ul class="list">${late.map(li).join('') || '<li class="empty">沒有</li>'}</ul></section>
      <section><h3><span class="pill p-yel">今天該回訪</span></h3><ul class="list">${due.map(li).join('') || '<li class="empty">沒有</li>'}</ul></section>
      <section><h3><span class="pill p-grn">最新拜訪</span></h3><ul class="list">${recent.map(visitItem).join('') || '<li class="empty">還沒有拜訪紀錄。業務用打卡網頁上傳後，這裡就會出現。</li>'}</ul></section>`;
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

  function renderTrial() {
    const cs = state.data.customers;
    if (!cs.length) return '<p class="empty">還沒有客戶。業務在打卡網頁選「臨時新增農民」，或在試算表「客戶清單」新增。</p>';
    const c = cs.find(x => x.id === state.trial) || cs[0];
    const list = visitsOf(c.id), s = dueState(c);
    const dealer = c.type === '盤商' || c.type === '種子商';
    const kv = (k, val) => val !== '' && val != null ? `<span>${k}：${esc(val)}</span>` : '';
    return `<div class="chips">${cs.map(x => `<button class="chip" data-go="${esc(x.id)}" aria-pressed="${x.id === c.id}">${esc(x.name)}</button>`).join('')}</div>
      <div class="card profile"><span><b>${esc(c.name)}</b>（${esc(c.id)}・${esc(c.type || '農民')}）</span><span>${esc(c.area || '')}</span>${kv('電話', c.phone)}
        ${dealer ? kv('老闆', c.owner) + kv('地址', c.address) + kv('品牌', c.brand)
          : kv('作物', c.crop) + kv('品種', c.variety) + kv('目前種植面積', c.areaNow) + kv('可種植面積', c.areaMax) + kv('種植日期', c.plantDate) + kv('使用肥料', c.fertilizer)
            + `<span>試作：${esc(c.trial || '—')}${c.start ? '（' + md(c.start) + ' 開始）' : ''}</span>`}<span>負責：${esc(c.staff || '—')}</span>
        <span>下次回訪：${c.nextDue ? md(c.nextDue) : '—'} ${s === 'late' ? '<span class="pill p-red">逾期</span>' : s === 'due' ? '<span class="pill p-yel">今天</span>' : ''}</span>
        ${c.lat ? `<a href="https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}" target="_blank" rel="noopener">田區導航 ↗</a>` : ''}</div>
      ${(state.data.trials || []).filter(t => t.cid === c.id).map(t => `<div class="card" style="margin-bottom:10px"><b>${esc(t.cat)} ${esc(t.id)}</b>：${esc(t.item || '—')}（${esc(t.start || '')} ～ ${esc(t.end || '進行中')}）
        <span class="pill ${t.status === '成功' ? 'p-grn' : t.status === '失敗' ? 'p-red' : 'p-yel'}">${esc(t.status)}</span>
        ${t.hasReport ? ` <button class="btn" type="button" data-report="${esc(t.id)}">⬇ 試作報告（Word）</button>` : ''}
        ${t.conclusion ? `<div class="sub pre" style="margin-top:6px">結論：${esc(t.conclusion)}</div>` : ''}</div>`).join('')}
      <div class="timeline">${list.map(v => `<div class="entry">${catPill(v)}<b>${esc(v.time)}</b>${!dealer && weekNo(c, v.time) ? `　試作第 ${weekNo(c, v.time)} 週` : ''} <span class="sub">${esc(v.staff)}</span>
        <div class="sub">${v.lat ? `📍 <a href="${esc(v.nav)}" target="_blank" rel="noopener">${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}（導航）</a>` : '📍 <span style="color:var(--chili)">無定位</span>'}
        　📷 ${v.check ? esc(v.check) : '現場拍攝'}</div>
        <div class="box"><div class="photos">${v.photos.length ? v.photos.map(id => `<div class="photo" data-photo="${esc(id)}">載入中…</div>`).join('') : '<div class="photo">沒有照片</div>'}</div>
        <dl class="kv"><dt>${dealer ? '行情' : '作物'}</dt><dd>${esc(v.crop || '—')}</dd><dt>反應</dt><dd>${esc(v.feedback || '—')}</dd><dt>問題</dt><dd>${esc(v.issue || '—')}</dd><dt>下一步</dt><dd>${esc(v.next || '—')}</dd>
        <dt>摘要</dt><dd>${esc(v.summary || noSummaryText(v))}</dd>
        ${v.text ? `<dt>打字</dt><dd class="pre">${esc(v.text)}</dd>` : ''}${v.prices ? `<dt>價格</dt><dd class="pre">${esc(v.prices)}</dd>` : ''}</dl></div>${soundBtns(v)}</div>`).join('') || '<p class="empty">這位客戶還沒有拜訪紀錄。</p>'}</div>`;
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
    const opt = (key, label, values) => `<select data-filter="${key}" aria-label="${label}"><option value="">全部${label}</option>${values.map(v => `<option${f[key] === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
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
  /* ───── 農民任務：主管派給業務，每條跟著一位農民；業務在手機打勾完成 ───── */
  function renderTasks() {
    const d = state.data;
    const tasks = d.tasks || [];
    const max = d.maxTasks || 10;
    const staff = d.staffList || []; // [{ account, name }]：用帳號派，同名也分得出來（R4-04）
    const farmers = d.customers.filter(c => (c.type || '農民') === '農民' && c.status !== '已結束').sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const f = state.tf || (state.tf = { staff: staff[0] ? staff[0].account : '', cid: '', text: '' });
    const openOf = acct => tasks.filter(t => t.status === '待辦' && t.account === acct);
    const form = staff.length ? `<form class="taskform" id="taskForm">
        <select id="tStaff" aria-label="派給哪位業務">${staff.map(s => `<option value="${esc(s.account)}"${f.staff === s.account ? ' selected' : ''}>${esc(s.name)}（${esc(s.account)}）</option>`).join('')}</select>
        <select id="tFarmer" aria-label="哪一位農民"><option value="">— 選擇農民 —</option>${farmers.map(c => `<option value="${esc(c.id)}"${f.cid === c.id ? ' selected' : ''}>${esc(c.name)}${c.area ? '｜' + esc(c.area) : ''}${c.staff ? '（' + esc(c.staff) + '）' : ''}</option>`).join('')}</select>
        <input id="tText" maxlength="200" placeholder="任務內容，例如：送肥料樣品、量株高" value="${esc(f.text)}">
        <button class="btn" type="submit" id="tAdd">派給業務</button>
        <span class="sub" id="tMsg" aria-live="polite">${esc(state.taskMsg || '')}</span></form>`
      : '<p class="empty">還沒有啟用的業務帳號，先在試算表「帳號」分頁建立。</p>';
    const open = staff.map(s => {
      const list = openOf(s.account);
      return `<h3>${esc(s.name)}（${esc(s.account)}）　<span class="sub">${list.length}／${max} 條沒完成</span></h3><ol class="tasks">${list.map(t => `<li><b><a href="javascript:void 0" data-go="${esc(t.cid)}">${esc(t.name)}</a></b>：${esc(t.text)}
        <span class="sub">${esc(String(t.at).slice(5, 16))} 派</span> <button class="btn" type="button" data-taskcancel="${esc(t.id)}">取消</button></li>`).join('') || '<li class="empty">沒有任務</li>'}</ol>`;
    }).join('');
    const done = tasks.filter(t => t.status !== '待辦').sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
    return form + open + `<h3>最近 30 天完成或取消的</h3><ul>${done.map(t => `<li>${t.status === '已完成' ? '<span class="pill p-grn">完成</span>' : '<span class="pill">取消</span>'}
      <b>${esc(t.name)}</b>：${esc(t.text)}<span class="sub">｜${esc(t.staff)}｜${esc(String(t.doneAt).slice(5, 16))}${t.status === '取消' ? '（' + esc(t.doneBy) + ' 取消）' : ''}</span></li>`).join('') || '<li class="empty">還沒有</li>'}</ul>`;
  }
  function bindTasks() {
    const form = $('taskForm');
    if (form) {
      const keep = () => { state.tf = { staff: $('tStaff').value, cid: $('tFarmer').value, text: $('tText').value }; };
      ['tStaff', 'tFarmer', 'tText'].forEach(id => $(id).addEventListener('input', keep));
      form.addEventListener('submit', async ev => {
        ev.preventDefault(); keep();
        if (!state.tf.cid) { $('tMsg').textContent = '請選一位農民'; return; }
        if (!state.tf.text.trim()) { $('tMsg').textContent = '請填任務內容'; return; }
        $('tAdd').disabled = true; $('tMsg').textContent = '送出中…';
        let r;
        try { r = await api({ action: 'taskAdd', staff: state.tf.staff, cid: state.tf.cid, text: state.tf.text.trim() }); } catch (e) { r = { ok: false, message: '連不上伺服器，請再試一次' }; }
        if (r.ok) { state.data.tasks = r.tasks; state.tf.text = ''; state.taskMsg = '已派出（業務手機下次同步就會看到）'; }
        else state.taskMsg = '⚠ ' + (r.message || '派發失敗');
        render();
      });
    }
    $('panel').querySelectorAll('[data-taskcancel]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('確定取消這條任務？業務手機上會消失。')) return;
      b.disabled = true;
      let r;
      try { r = await api({ action: 'taskCancel', id: b.dataset.taskcancel }); } catch (e) { r = { ok: false, message: '連不上伺服器' }; }
      if (r.ok) { state.data.tasks = r.tasks; state.taskMsg = '已取消'; } else state.taskMsg = '⚠ ' + (r.message || '取消失敗');
      render();
    }));
  }

  /* ───── 業務帳號：主管在這裡（手機也可以）開業務帳號、重設業務密碼（2026-11-12） ───── */
  function renderAccounts() {
    const list = state.data.salesAccounts || [];
    const f = state.af || (state.af = { account: '', name: '', region: '' });
    const pw = state.newPw; // { account, password, reset, disabled }：臨時密碼只在這次畫面顯示，換分頁或重新整理就不見
    const box = pw ? `<div class="pwbox" role="status"><b>${pw.reset ? '已重設密碼' : '已開通帳號'}</b>${pw.disabled ? '<br><span class="err">⚠ 這個帳號目前是停用的，要在試算表「帳號」分頁勾選「啟用」，本人才登入得了。</span>' : ''}
        <div>帳號：<code>${esc(pw.account)}</code></div><div>臨時密碼：<code>${esc(pw.password)}</code></div>
        <p class="sub">臨時密碼只顯示這一次，請當面或私訊告訴本人。本人第一次登入時，系統會要求他改成自己的密碼。</p>
        <button class="btn" type="button" id="pwDone">我已經記下了</button></div>` : '';
    const form = `<h3>開通新的業務帳號</h3><form class="taskform" id="acctForm" autocomplete="off">
        <input id="aAcct" maxlength="30" placeholder="帳號（英文小寫或數字，例如 tom）" value="${esc(f.account)}" autocapitalize="none" spellcheck="false" aria-label="帳號">
        <input id="aName" maxlength="40" placeholder="姓名（顯示在拜訪紀錄上）" value="${esc(f.name)}" aria-label="姓名">
        <input id="aRegion" maxlength="40" placeholder="負責地區（可以留空）" value="${esc(f.region)}" aria-label="負責地區">
        <button class="btn" type="submit" id="aAdd">開通業務帳號</button>
        <span class="sub" id="aMsg" aria-live="polite">${esc(state.acctMsg || '')}</span></form>
        <p class="sub">主管帳號請在試算表「農業CRM → 開帳號／重設密碼」開。</p>`;
    const rows = list.map(a => `<li><b>${esc(a.name)}</b><span class="sub">${esc(a.account)}${a.region ? '｜' + esc(a.region) : ''}</span>
        ${a.active ? '' : '<span class="pill">停用</span>'}${a.mustChange ? '<span class="pill p-yel">還沒改密碼</span>' : ''}
        <span class="sub">${a.lastLogin ? '最後登入 ' + esc(String(a.lastLogin).slice(5, 16)) : '還沒登入過'}</span>
        <button class="btn" type="button" data-acctreset="${esc(a.account)}" data-name="${esc(a.name)}">重設密碼</button></li>`).join('');
    return box + form + `<h3>業務帳號（${list.length}）</h3><ul class="acctlist">${rows || '<li class="empty">還沒有業務帳號</li>'}</ul>`;
  }
  function bindAccounts() {
    const done = $('pwDone');
    if (done) done.addEventListener('click', () => { state.newPw = null; render(); });
    const form = $('acctForm');
    const keep = () => { state.af = { account: $('aAcct').value, name: $('aName').value, region: $('aRegion').value }; };
    ['aAcct', 'aName', 'aRegion'].forEach(id => $(id).addEventListener('input', keep));
    const after = r => {
      if (r.ok) {
        state.newPw = { account: r.account, password: r.password, reset: r.reset, disabled: !!r.disabled };
        state.data.salesAccounts = r.accounts;
        state.acctMsg = '';
        load(); // 重新讀一次：農民任務的業務選單也會出現新帳號
      } else state.acctMsg = '⚠ ' + (r.message || '沒有完成');
      render();
    };
    form.addEventListener('submit', async ev => {
      ev.preventDefault(); keep();
      const a = state.af.account.trim().toLowerCase();
      if (!/^[a-z0-9._-]{2,30}$/.test(a)) { $('aMsg').textContent = '帳號只能用英文小寫、數字、點、底線、減號，2～30 字'; return; }
      if (!state.af.name.trim()) { $('aMsg').textContent = '請填姓名'; return; }
      $('aAdd').disabled = true; $('aMsg').textContent = '開通中…';
      let r;
      try { r = await api({ action: 'accountAdd', account: a, name: state.af.name.trim(), region: state.af.region.trim() }); } catch (e) { r = { ok: false, message: '連不上伺服器，請再試一次' }; }
      if (r.ok) state.af = { account: '', name: '', region: '' };
      after(r);
    });
    $('panel').querySelectorAll('[data-acctreset]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('確定重設「' + b.dataset.name + '」的密碼？他已登入的手機會全部登出，要用新的臨時密碼重新登入。')) return;
      b.disabled = true;
      let r;
      try { r = await api({ action: 'accountReset', account: b.dataset.acctreset }); } catch (e) { r = { ok: false, message: '連不上伺服器' }; }
      after(r);
    }));
  }

  async function loadProgress() {
    const m = state.pm;
    if (!m || state.prog[m] || state.progReq[m]) return;
    state.progReq[m] = true;
    let r;
    try { r = await api({ action: 'progress', month: m }); } catch (e) { r = { ok: false, message: '連不上伺服器' }; } finally { delete state.progReq[m]; }
    state.prog[m] = r;
    if (state.tab === 'progress' && state.pm === m) render();
  }

  function renderTable() {
    const rows = state.data.visits.slice().sort((a, b) => b.time.localeCompare(a.time));
    return `<div class="tbl"><table><thead><tr><th>拜訪時間</th><th>客戶</th><th>業務</th><th>作物狀況</th><th>問題</th><th>下一步</th><th>狀態</th></tr></thead><tbody>
      ${rows.map(v => `<tr><td>${esc(v.time)}</td><td><a href="javascript:void 0" data-go="${esc(v.cid)}">${esc(v.name)}</a></td><td>${esc(v.staff)}</td><td>${esc(v.crop || v.summary || '—')}</td><td>${esc(v.issue || '—')}</td><td>${esc(v.next || '—')}</td><td>${esc(v.status)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">還沒有拜訪紀錄</td></tr>'}
      </tbody></table></div>`;
  }

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { state.tab = t.dataset.tab; state.newPw = null; render(); })); // 換分頁就把臨時密碼收起來
  $('reload').addEventListener('click', load);
  $('logout').addEventListener('click', logout);
  $('loginForm').addEventListener('submit', onLogin);
  state.key = keyStore.get();
  if (state.key) load(); else showLogin();
  window.__bossTest = { state, render, load }; // 本機測試用
})();
