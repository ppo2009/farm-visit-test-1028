/* 打卡網頁主程式（第 2 期 2A）：帳號密碼登入 → 首頁四類工作 → 拜訪（客戶資料、照片、相簿、錄音、打字、價格） */
/* global FarmCore, FARM_CONFIG */
(function () {
  const { Store, runSync, post, rememberServer, pruneLocalCustomers, updateTaskDone } = FarmCore;
  // R17：暫存客戶、試作記號記是哪個帳號建的（acct）；同一支手機換人登入時，選單、進度只顯示自己的。R19（GPT 04、05）：舊資料沒有 acct → 看「建立它的那筆拜訪」記在誰名下（客戶＝最早用它的拜訪、開始記號＝開始那筆、結束記號＝by 或最新一筆結束／結案），不再拿第一筆碰到的；那筆拜訪沒記帳號（很舊的版本）＝換人登入時照樣由現在登入的人上傳 → 顯示；手機找不到建立它的拜訪（上傳超過 7 天、拜訪已刪）＝一定早就上傳、後台那位照常看得到 → 不顯示
  function randTag() {
    const a = new Uint8Array(6);
    try { (self.crypto || crypto).getRandomValues(a); } catch (e) { for (let i = 0; i < 6; i++) a[i] = Math.floor(Math.random() * 256); }
    return Array.from(a, b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  }
  /**
   * 這支手機暫存的客戶或試作（k＝'localCustomers' 或試作那份），只留「現在登入的人」建的。
   * 為什麼要篩：一支手機可能先後給兩個業務用，A 新增還沒上傳的農民，不該出現在 B 的選單裡。
   * 新資料直接記了建的人（acct）；舊資料沒記，就回頭找「是哪一筆拜訪建的」，看那筆拜訪是誰送的。
   */
  async function myLocal(k) {
    const list = (await Store.getMeta(k)) || [], cfg = await Store.getMeta('config'), me = cfg && cfg.account;
    if (!me) return list;
    const vs = list.some(l => l && !l.acct) && Store.allVisits ? ((await Store.allVisits()) || []) : [];
    const byTime = (a, b) => (a.deviceTime || 0) - (b.deviceTime || 0) || String(a.id).localeCompare(String(b.id));
    const creator = l => {
      if (k === 'localCustomers') return vs.filter(v => v && v.farmerId === l.id).sort(byTime)[0];
      if (!l.ended) return vs.find(v => v && v.trial && v.trial.op === 'start' && v.trial.tempId === l.id);
      if (l.by) return vs.find(v => v && v.id === l.by);
      return vs.filter(v => v && ((v.trial && v.trial.op !== 'start' && v.trial.id === l.id) || (v.closing && v.closing.trialResult && v.closing.trialResult.id === l.id))).sort(byTime).pop();
    };
    return list.filter(l => { if (!l) return false; if (l.acct) return l.acct === me; const c = creator(l); return !!c && (!c.account || c.account === me); });
  }
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
  /* 第26任 錯誤分類開始：原本手機上什麼錯都說成「可能空間不足」，而且整支程式一行錯誤紀錄都沒有，出事收不到線索。
     isCodeErr：程式本身的錯（TypeError 這類），不是手機資料庫寫不進去；errCode：給畫面和錯誤紀錄看的簡短原因；
     noteErr：寫進主控台，並記在手機資料庫 errQueue（最多 20 筆），下次同步成功時 sendErrs 送到後台「錯誤紀錄」 */
  const isCodeErr = e => !!e && ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError'].indexOf(e.name) >= 0;
  const errCode = e => String((e && e.name && e.name !== 'Error' ? e.name + '：' : '') + ((e && e.message) || e || '不明')).slice(0, 120);
  async function noteErr(where, e) {
    try { console.error('[農場打卡]', where, e); } catch (x) { /* 沒有主控台 */ }
    // 抓BUG第4輪 手機組2：記下當時登入的帳號（換人登入後，上一位的錯誤原本會記成下一位的）
    try {
      const q = (await Store.getMeta('errQueue')) || [], c0 = await Store.getMeta('config');
      q.push({ at: Date.now(), where: String(where), msg: errCode(e), acct: String((c0 && c0.deviceKey && c0.account) || '') });
      await Store.setMeta('errQueue', q.slice(-20));
    } catch (x) { /* 手機資料庫本身壞了：只留在主控台 */ }
  }
  async function sendErrs(cfg) {
    try {
      const q = (await Store.getMeta('errQueue')) || [];
      if (!q.length || !cfg || !cfg.deviceKey) return;
      const r = await post(cfg.gasUrl || FARM_CONFIG.gasUrl, { action: 'clientError', deviceKey: cfg.deviceKey, errors: q.slice(0, 10).map(x => (x.acct !== undefined && x.acct !== String(cfg.account || '') ? Object.assign({}, x, { msg: '（原登入：' + (x.acct || '沒人登入') + '）' + x.msg }) : x)), app: String((typeof FARM_CONFIG !== 'undefined' && FARM_CONFIG.appVersion) || '') });
      if (r && r.ok) { const now = (await Store.getMeta('errQueue')) || []; await Store.setMeta('errQueue', now.slice(Math.min(10, q.length))); }
    } catch (e) { /* 送不出去：留在手機，下次同步再送（不再記一筆，免得越積越多） */ }
  }
  /* 第26任 錯誤分類結束 */
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
  const MAX_PHOTOS = 12; // 跟後台一樣（第28任 2026-11-19 董事長「調高到12張」，原本 6）
  const CAT_TYPES = { 試作: ['農民'], 推廣: ['農民'], 農戶: ['農民'], 結案: ['農民'], 盤商: ['盤商'], 種子商: ['種子商'] }; // 盤商、種子商分開（2026-11-11 董事長）
  const CAT_LABEL = c => (c === '農戶' ? '一般拜訪' : c); // 「農戶」是舊資料的值，畫面上叫「一般拜訪」
  // 業務畫面一律中文＋緬文（2026-11-12 董事長；緬文是示意，待校對）
  const CAT_MY = { 農戶: 'ပုံမှန် လယ်သမား', 試作: 'စမ်းသပ်စိုက်ပျိုး', 推廣: 'မြှင့်တင်ရောင်းချ', 盤商: 'ကုန်သည်', 種子商: 'မျိုးစေ့ဆိုင်', 農民: 'လယ်သမား', 結案: 'ပိတ်သိမ်း' };
  const catBi = c => CAT_LABEL(c) + (CAT_MY[c] ? '／' + CAT_MY[c] : '');

  const state = {
    view: '', cat: '試作', photos: [], audio: null, audioSec: 0, rec: null, recTimer: null, gps: null,
    farmers: [], options: null, original: null, mustChange: false,
    homeMonth: '', // 首頁工作進度目前看哪個月
    homeTop: null, // 0.5.20 E1：上次畫首頁時資料裡最新的月份（變了就跳到最新月）
    monthOpen: '', // 0.4.82 本月成績展開哪一格明細：'' / 'new' / 'trial'
    harvestOpen: false, // 0.4.82 快採收提醒條展開了沒
    formGen: 0, // 每清一次表單就加一；非同步處理完的錄音、照片，世代不同就丟掉
    busyPhotos: 0 // 還在處理的照片張數；大於 0 時不能儲存，免得後面幾張被丟掉（2026-11-11 抓到）
  };

  async function getConfig() { return (await Store.getMeta('config')) || null; }
  /** R24-1：登入資料要被換掉、清掉之前，先替舊格式的快取版本紀錄補記帳號（重新登入同一位時才併得回對照） */
  async function tagOwner() { try { if (Store.tagSrvOwner) await Store.tagSrvOwner(); } catch (e) { /* 補不了：只是重新登入後這一輪少併一次 */ } }
  /** 第24任 必改第四批：人臉／指紋、九宮格解鎖（unlock.js）。只擋畫面，登入設定（裝置金鑰）照留，背景上傳不停。
   *  舊頁面、抽函式跑的舊測試沒有 FarmLock 就整個不做（每個用到的地方各自寫 typeof FarmLock === 'object'：抽單一函式跑的舊測試找不到名字；有些舊測試的假環境把不認得的名字都當成空函式，所以要認「是物件」才算有） */
  function lockHooks() {
    return {
      getConfig,
      getMinutes: async () => { const h = await Store.getMeta('home'); return h && h.unlockMin; }, // 後台「解鎖逾時分鐘」隨首頁資料同步下來；沒有用 10
      getEnabled: async () => { const h = await Store.getMeta('home'); return !(h && h.unlockOn === false); }, // 第24任 第六批：設定分頁「解鎖功能」總開關（沒同步過當開）
      toast: m => toast(m),
      // 九宮格錯 5 次、或按「用密碼重新登入」：跟登入失效一樣只清掉金鑰回登入頁，沒上傳的拜訪留在手機裡，同一人登入後再送
      lockout: async msg => {
        const c = await getConfig();
        // 第24任 第六批（老闆問：錯 5 次會不會丟資料）：正在填、還沒儲存的表單比照「登入失效」——先讓業務存進手機，離開打卡畫面才回登入頁（已儲存的本來就不會丟）
        // 第25任 審查①（安全）：原本這條路只記 loginLost、金鑰照留 → 鎖畫面收起後別人可以繼續用這個登入看客戶資料。改成金鑰一樣立刻清掉，
        //   只是不跳登入頁、表單留著：存檔照 0.5.23 J5「沒人登入、用表單主人存」，存完自動回登入頁；不存回首頁時 showHome 看 lockedOut 跳登入
        const dirty = state.view === 'visit' && typeof formDirty === 'function' && formDirty() && c && c.deviceKey;
        if (typeof tagOwner === 'function') await tagOwner(); await Store.setMeta('config', { gasUrl: (c || {}).gasUrl });
        if (dirty) { state.lockedOut = msg; toast(msg + '。正在填的這一筆可以先儲存在手機裡，之後要用密碼重新登入／။ ယခု ဖြည့်နေသည်ကို ဖုန်းထဲ သိမ်းထားနိုင်သည်၊ နောက်မှ စကားဝှက်ဖြင့် ပြန်ဝင်ရမည်'); return; }
        showLogin(msg);
      }
    };
  }

  function show(view) {
    state.view = view;
    if (document.body && document.body.dataset) document.body.dataset.view = view; // 第24任 第六批①⑱
    const hh = document.getElementById('homeHdr'); if (hh) { hh.classList.remove('open'); const mb = document.getElementById('menuBtn'); if (mb) mb.setAttribute('aria-expanded', 'false'); }
    ['setup', 'home', 'visit'].forEach(v => { $(v).hidden = v !== view; });
    $('logoutBtn').hidden = view === 'setup';
    const fb = document.getElementById('feedbackBtn'); if (fb) fb.hidden = view === 'setup'; // 0.5.03 舊頁面沒有這個鈕就不管
    const ul = document.getElementById('unlockBtn'); if (ul) ul.hidden = view === 'setup' || typeof FarmLock !== 'object'; // 第24任 第四批：登入後才有「解鎖方式」
    window.scrollTo(0, 0);
  }

  /* ───── 登入：帳號＋密碼。第一次登入要改成自己的密碼 ───── */
  function showLogin(msg) {
    // 2號 0.4.69 清單低3（第8任）：換帳號後「我的報告」還用上一位的名字篩 → 回到登入畫面就清掉報告清單、範圍、我是誰
    state.me = ''; state.reportScope = 'all'; state.reports = null;
    if (typeof document !== 'undefined' && document.getElementById('bossTip')) document.getElementById('bossTip').hidden = true; // 0.5.26 抓BUG 低3：登出、登入失效回登入頁，主管提示要收起來
    state.navStack = []; // 第26任：換人登入不帶上一位的「上一頁」
    state.homeMonth = ''; state.homeTop = null; // 0520R4 I3（第19任）：換人登入不要停在上一位點的月份（下一位的首頁照第一次畫的規則）
    // 0.5.23 J4（第21任）：上一位沒送出的建議不留給下一位。原本只在按登出時清，登入失效等其他 4 條回登入頁的路沒清 → 換人登入後用下一位的帳號送出
    if (typeof state.resetFeedback === 'function') state.resetFeedback();
    show('setup');
    $('setupMsg').textContent = msg || '只要登入一次，之後沒網路也能打卡。帳號和密碼請向主管索取（密碼不能自己改）。／တစ်ကြိမ် ဝင်ပြီးလျှင် အင်တာနက်မရှိလည်း မှတ်တမ်းတင်နိုင်သည်။ အကောင့်နှင့် စကားဝှက်ကို မန်နေဂျာထံ တောင်းပါ (စကားဝှက် ကိုယ်တိုင် မပြောင်းနိုင်ပါ)။';
    $('setupMsg').className = msg ? 'sub err' : 'sub';
  }

  // 0.5.16 第2輪 低：登入鈕原本在兩個 await 之後才停用 → 連按兩下送兩次登入，後台多一把沒人用、卻仍啟用的裝置金鑰 → 一進來就鎖住，結束（不論成功失敗）才放開
  async function onLogin(ev) {
    ev.preventDefault();
    if (state.loggingIn) return;
    state.loggingIn = true;
    try { await onLoginInner(); } finally { state.loggingIn = false; }
  }
  async function onLoginInner() {
    const msg = $('setupMsg');
    const account = $('acct').value.trim(), password = $('pw').value;
    if (!account || !password) {
      msg.innerHTML = (!account ? '請輸入帳號<span class="my">အကောင့် ထည့်ပါ</span>' : '請輸入密碼<span class="my">စကားဝှက် ထည့်ပါ</span>');
      msg.className = 'sub err';
      $(!account ? 'acct' : 'pw').focus();
      return;
    } // 第24任 第六批⑲（「帳號」「密碼」緬文沿用欄位標籤；句子緬文等譯者）
    const payload = { action: 'login', account, password, deviceId: deviceId(), ask: (typeof FarmCore !== 'undefined' && FarmCore.buildAsk) ? await FarmCore.buildAsk() : undefined }; // R20：登入回應的客戶、試作也只帶這支手機問過的臨時編號
    if (state.mustChange && !loginNewPw(msg, payload)) return;
    if (await loginOthersPending(msg, account)) return;
    msg.textContent = '確認中… စစ်ဆေးနေသည်'; msg.className = 'sub';
    $('loginBtn').disabled = true;
    let answered = false; // 0.5.24（第21任抓BUG）：後台已經回了才出錯＝手機自己存不進去，不能說成連不上伺服器
    try {
      const sentAt = Date.now();
      const data = await post(FARM_CONFIG.gasUrl, payload);
      answered = true;
      if (data.code === 'MUST_CHANGE') {
        state.mustChange = true; $('newPwBox').hidden = false; $('newPw').focus();
        msg.textContent = data.message; return;
      }
      if (!data.ok) { msg.textContent = data.message || '登入失敗／ဝင်ရောက်မှု မအောင်မြင်'; msg.className = 'sub err'; return; } // 0.4.94 中2 加緬文
      await loginSucceeded(msg, data, sentAt);
    } catch (err) {
      loginFailed(msg, err, answered);
    } finally {
      $('loginBtn').disabled = false;
    }
  }
  /** 登入：後台說帳密對了之後——補標舊資料帳號、存登入設定和後台資料、進首頁（出錯丟給 onLoginInner 的 catch） */
  async function loginSucceeded(msg, data, sentAt) {
    // 0.4.91 高1：rememberServer 改成一定要帶金鑰、而且要等於現在登入的 → 先寫好這次登入，再存登入回應（用這次拿到的金鑰）
    if (typeof tagOwner === 'function') await tagOwner(); // R24-1（抽函式跑的舊測試沒有它）
    // 第 1 期留下、沒有標帳號的待傳資料：歸給這支手機升級後第一個登入的人並標上帳號，
    // 之後換別人登入會被擋，不會記到別人名下（2026-11-11 GPT-6.1 審查 G03）
    // 0524R1-1（GPT 中）：改在寫登入設定「之前」標。標到一半失敗（空間不足）→ 整個登入不算成功（還沒有登入設定，不會同步），
    //   畫面說手機存資料失敗；已標好的歸這個人（換別人登入會被擋），沒標到的下次登入再標，不會被別的帳號帶走
    for (const v of await Store.allVisits()) if (v.status === 'pending' && !v.account) { v.account = data.account; await Store.putVisit(v); }
    await Store.setMeta('config', { gasUrl: FARM_CONFIG.gasUrl, deviceKey: data.deviceKey, name: data.name, account: data.account, role: data.role });
    await Store.setMeta('loginLost', null); state.loginLost = null; state.lockedOut = null; // 0.4.91 中4：重新登入了，先前延後的登入失效作廢（第25任：解鎖鎖死的也作廢）
    // 0.5.24（第21任抓BUG）：登入已經成功、金鑰也存好了，接著存客戶清單等資料失敗（多半是空間不足）
    // → 照樣進首頁、跳提示，不停在登入頁讓業務一直重按（每按一次後台就多發一把金鑰）；同步時會再抓一次
    const warn = (typeof FarmCore !== 'undefined' && FarmCore.SYNC_WARN) || '同步資料寫回手機失敗（可能空間不足），稍後再同步／စင့်ခ်ဒေတာ ဖုန်းထဲ ပြန်သိမ်းမရပါ (နေရာ မလောက်ခြင်း ဖြစ်နိုင်)၊ နောက်မှ ထပ်စင့်ခ်လုပ်မည်';
    let loginWarn = '';
    try { await rememberServer(data, sentAt, data.deviceKey); } catch (e) { loginWarn = warn; }
    // 0.5.25 T1（第21任抓BUG）：寫回失敗時手機上那份後台資料可能是上一位的（首頁、任務、試作、客戶）→ 不是這個帳號的就清掉，
    //   不讓新登入的人看到、勾到上一位的；清不掉就不進首頁（丟到下面 catch，說手機存資料失敗）
    // 0525R2（第22任，GPT 0525R1-2）：帶這次登入的金鑰 → 另一個分頁已經換人登入成功時不清（回 'stale'），這個舊的登入程序停下、不進首頁
    if (loginWarn && Store.clearForeignCache && (await Store.clearForeignCache(data.account, { key: data.deviceKey })) === 'stale') {
      msg.textContent = '另一個畫面已經換人登入，這次登入作廢，請重新整理網頁／အခြား စာမျက်နှာတွင် ဝင်ထားပြီ၊ ပြန်ဖွင့်ပါ'; msg.className = 'sub err'; return;
    }
    ['pw', 'newPw', 'newPw2'].forEach(id => { $(id).value = ''; }); // 密碼不留在畫面上
    state.mustChange = false; $('newPwBox').hidden = true;
    showHome();
    if (loginWarn) toast('已登入。ဝင်ပြီးပါပြီ။ ' + loginWarn);
    syncNow();
    if (typeof FarmLock === 'object') FarmLock.afterLogin(lockHooks()).catch(e => { if (typeof noteErr === 'function') noteErr('解鎖設定', e); }); // 第24任 第四批：剛用密碼登入 → 問要不要啟用人臉／指紋或九宮格（第26任：失敗記下來）
  }
  /** 登入：途中出錯（answered＝後台已經回了，錯在手機自己存不進去或程式錯） */
  function loginFailed(msg, err, answered) {
    msg.textContent = answered
      ? '手機存資料失敗（可能空間不足），請先清出空間再登入／ဖုန်းထဲ သိမ်းမရပါ၊ နေရာလွတ် လုပ်ပြီး ပြန်ဝင်ပါ'
      : '連不上伺服器，第一次登入需要網路／ဆာဗာနှင့် မချိတ်နိုင်ပါ၊ ပထမအကြိမ် ဝင်ရန် အင်တာနက်လိုသည်';
    if (answered && typeof isCodeErr === 'function' && isCodeErr(err)) msg.textContent = '登入途中程式出錯（' + errCode(err) + '），請再按一次；一直出現請告訴主管'; // 第26任：程式錯不說成空間不足
    if (answered && typeof noteErr === 'function') noteErr('登入', err);
    msg.className = 'sub err';
  }
  /** 登入：第一次要改密碼——檢查新密碼、放進 payload；不合格寫提示、回 false */
  function loginNewPw(msg, payload) {
    const np = $('newPw').value, np2 = $('newPw2').value;
    if (np.length < 6) { msg.textContent = '新密碼至少 6 個字／စကားဝှက်အသစ် အနည်းဆုံး ၆ လုံး'; msg.className = 'sub err'; return false; }
    if (np !== np2) { msg.textContent = '兩次輸入的新密碼不一樣／စကားဝှက်နှစ်ခု မတူပါ'; msg.className = 'sub err'; return false; }
    payload.newPassword = np;
    return true;
  }
  /** 登入：這支手機還有前一個人沒上傳的拜訪、任務打勾 → 寫提示、回 true（擋下） */
  async function loginOthersPending(msg, account) {
    // 業務BUG#8：後台比對帳號會去掉所有空白（0.4.39，打「Myint Ko Ko」也能登入 myintkoko），這裡要用同一套，不然被當成別人擋下
    const acctKey = account.toLowerCase().replace(/\s+/g, '');
    const others = (await Store.allVisits()).filter(v => v.status === 'pending' && v.account && v.account !== acctKey);
    // 前一個人還沒送出的任務打勾也要擋：換人後那些打勾永遠送不出去，新的人也登出不了（自行審查 S1）
    const otherTicks = ((await Store.getMeta('taskDone')) || []).filter(t => t.account && t.account !== acctKey);
    if (!others.length && otherTicks.length) {
      msg.textContent = `這支手機還有 ${otherTicks.length} 個「${otherTicks[0].account}」的任務打勾沒上傳，請先用 ${otherTicks[0].account} 登入，等它傳完再換人。／${otherTicks[0].account} ဖြင့် အရင်ဝင်ပြီး မတင်ရသေးသော မှတ်တမ်း တင်ပြီးမှ အကောင့် ပြောင်းပါ။`; // 0.4.92 中2 加緬文
      msg.className = 'sub err'; return true;
    }
    if (others.length) {
      // 換人登入同一支手機：前一個人的資料會被記到新帳號名下，所以先擋（2026-11-11 審查發現）
      msg.textContent = `這支手機還有 ${others.length} 筆「${others[0].account}」沒上傳的資料，請先用 ${others[0].account} 登入，等資料傳完再換人。／${others[0].account} ဖြင့် အရင်ဝင်ပြီး မတင်ရသေးသော မှတ်တမ်း တင်ပြီးမှ အကောင့် ပြောင်းပါ။`; // 0.4.92 中2 加緬文
      msg.className = 'sub err'; return true;
    }
    return false;
  }

  /** 這支手機目前登入的人自己的任務打勾（沒標帳號的舊資料也算他的，跟 core.js 的 mine 同一個規則） */
  async function mineTicks() {
    const cfg = (await Store.getMeta('config')) || {};
    return ((await Store.getMeta('taskDone')) || []).filter(t => !t.account || !cfg.account || t.account === cfg.account);
  }

  async function logout() {
    // 0.4.87 中6：比照返回鍵——打卡畫面還沒儲存要先確認；錄音中先停掉、表單清掉（不讓錄音器開著跑到登入頁）
    if (state.view === 'visit' && formDirty() && !confirm('還沒儲存，確定要登出嗎？剛剛填的資料（照片、錄音、打字等）會不見。\nမသိမ်းရသေးပါ။ ထွက်လျှင် ဖြည့်ထားသည်များ (ဓာတ်ပုံ၊ အသံ၊ စာ စသည်) ပျောက်မည်၊ သေချာပါသလား။')) return;
    // 0.4.91 中2（第11任第三輪清單）：原本這裡就先清表單，接著「還有沒上傳」被擋、或第二次確認按取消 → 表單沒了也沒登出
    // → 待上傳檢查、第二次確認都通過了，才清表單（停錄音）
    // R12-05（GPT 中，不同意 0.5.16 第2輪的不修）：舊版換人可能已留下別人的待上傳拜訪，現在的帳號永遠送不掉 → 只算自己帳號（和沒標帳號的舊資料），
    // 比照任務打勾；別人的資料留在手機，下次登入時照樣提示「先用 X 登入把資料傳完」
    const cfgL = (await Store.getMeta('config')) || {};
    const pending = (await Store.allVisits()).filter(v => v.status === 'pending' && (!v.account || !cfgL.account || v.account === cfgL.account)).length;
    // 任務打勾也要先送出（GPT-6.1 R4-07）；只算自己帳號的：別人的（舊版換人留下的）在這支手機用自己帳號永遠送不掉，不能因此擋住登出（自行審查 S1）
    const ticks = (await mineTicks()).length;
    if (pending || ticks) {
      toast(`還有 ${[pending ? pending + ' 筆拜訪' : '', ticks ? ticks + ' 個任務打勾' : ''].filter(Boolean).join('、')}沒上傳，先連上網路等它傳完再登出／မတင်ရသေးသော မှတ်တမ်းရှိသည်၊ အင်တာနက်ချိတ်ပြီး တင်ပြီးမှ ထွက်ပါ`);
      return;
    }
    if (!confirm('確定要登出嗎？之後要再輸入帳號密碼。\nထွက်မှာ သေချာပါသလား။ နောက်တစ်ကြိမ် အကောင့်နှင့် စကားဝှက် ပြန်ထည့်ရမည်။')) return;
    if (state.view === 'visit' || state.rec) resetForm(); // 0.4.91 中2：全部確認過才清表單、停錄音
    // 0.4.75 董事長「右上角登出，而且實際上也要登出」：先請後台停用這支手機的裝置金鑰（最多等 5 秒；沒網路、逾時、舊後台不認得、出錯都照樣登出）
    const lb = $n('logoutBtn'), lbl = lb.innerHTML; lb.disabled = true; lb.textContent = '登出中…／ထွက်နေသည်'; // 0.4.80 低1：等後台時不讓重按
    // 0533 N2（小助手1號，第23任抓BUG）：用開頭讀到的登入設定（cfgL）送停用，比照 0.5.25 T6；
    //   原本 gasCall 另讀 → 確認框開著時別的分頁換 bo 登入，按確定就停用 bo 的金鑰
    try { await Promise.race([gasCall({ action: 'logout' }, cfgL), new Promise(r => setTimeout(r, 5000))]); } catch (e) { /* 照樣清本機、回登入頁 */ } finally { lb.disabled = false; lb.innerHTML = lbl; }
    if (typeof tagOwner === 'function') await tagOwner(); // R24-1（抽函式跑的舊測試沒有它）
    // 0533 N2：清登入設定在同一個交易裡核對還是開頭那把金鑰；別的分頁已經換人登入 → 不清、不回登入頁（不把新登入的人登出）
    let otherAcct = '';
    if (typeof Store.updateMeta === 'function') {
      await Store.updateMeta('config', c => { if (!c || (c.deviceKey || '') === (cfgL.deviceKey || '')) return null; otherAcct = String(c.account || ''); return c; });
    } else await Store.setMeta('config', null); // 抽函式跑的舊測試沒有 updateMeta
    if (otherAcct) { toast('另一個畫面已經換「' + otherAcct + '」登入，這次沒有登出；請重新整理網頁／အခြား စာမျက်နှာတွင် အခြားသူ ဝင်ထားပြီးဖြစ်၍ ယခု မထွက်ရသေးပါ၊ စာမျက်နှာ ပြန်ဖွင့်ပါ'); return; }
    showLogin(); // 清建議草稿在 showLogin 裡（0.5.23 J4）
  }

  /**
   * 0.5.03 董事長「登出上面改為『提供建議』，傳到後台，看業務使用者有什麼建議」：
   * 按了跳出填寫框 → 送 action 'feedback'（後台寫進「使用者建議」分頁）。要有網路才送得出去（不排進上傳佇列）；
   * 送出失敗時字留著，可以再按一次；送出代號同一則不變，後台收過就不會重複記
   */
  function initFeedback() {
    const btn = document.getElementById('feedbackBtn'), box = document.getElementById('feedbackBox');
    if (!btn || !box) return; // 舊頁面
    const txt = $n('feedbackText'), hint = $n('feedbackHint'), send = $n('feedbackSend');
    let sid = '', sidText = null; // 0.5.19 B3：sidText＝這個送出代號上次送出的內容（沒送過是 null）
    const newSid = () => 'fb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const close = () => { box.hidden = true; if (typeof FarmVoice === 'object' && FarmVoice.active()) FarmVoice.stop(true); }; // 第26任 低風險修正3③：關建議框也停語音（原本麥克風還開著，之後說的話寫進藏起來的框，打卡畫面按錄音又說「正在語音輸入」卻找不到停止鈕）
    // 0.5.24（第21任抓BUG）：草稿記下是誰寫的；另一個分頁換了帳號再回來按送出 → 不用新帳號送（比照 0.5.23 拜訪存檔的表單主人）
    let author = '';
    const curCfg = async () => { try { const c = await Store.getMeta('config'); return c && c.deviceKey && c.account ? c : null; } catch (e) { return null; } };
    // 0.5.25 T7（第21任抓BUG）：讀取失敗回 null（作者不明），跟「沒登入」的空字串分開；作者不明時送出前要本人確認名義
    // 0533 N3（小助手1號，第23任抓BUG）：沒登入時打開框寫的，也當作者不明（null）→ 送出前要本人確認名義（原本回空字串，送出時自動算成另一分頁剛登入的人）
    const curAccount = async () => { try { const c = await Store.getMeta('config'); return c && c.deviceKey && c.account ? String(c.account) : null; } catch (e) { return null; } };
    state.resetFeedback = () => { txt.value = ''; sid = ''; sidText = null; author = ''; hint.textContent = ''; close(); }; // 0.5.16：登出時清草稿
    btn.addEventListener('click', async () => {
      box.hidden = false;
      hint.textContent = '';
      hint.className = 'sub';
      if (!sid) { sid = newSid(); sidText = null; }
      txt.focus();
      if (!author || !txt.value.trim()) author = await curAccount();
    }); // 框是空的＝新的一則，照現在登入的人
    txt.addEventListener('input', () => { if (!txt.value.trim()) author = ''; }); // 0.5.25 T7：框開著時把字清光＝重新寫一則，作者改照送出時登入的人
    $n('feedbackCancel').addEventListener('click', close);
    box.addEventListener('click', e => { if (e.target === box) close(); });
    send.addEventListener('click', async () => {
      const text = txt.value.trim();
      if (!text) { hint.textContent = '請先寫建議內容／အကြံပြုချက် ရေးပါ'; hint.className = 'sub err'; return; }
      const cfgNow = await curCfg(); // 0524R1-2（GPT 中）：比對和送出用同一份登入設定（同一把金鑰）
      // 0524R2-2（GPT 中）：讀不到登入設定（讀取失敗、沒登入、缺帳號或金鑰）→ 不送、字留著；不退回讓 gasCall 另讀（中間可能換人）
      if (!cfgNow) { hint.textContent = '讀不到登入資料，這次沒有送出（字留著）；請確認已登入再按送出／ဝင်ရောက်မှု အချက်အလက် မတွေ့၍ ယခု မပို့ရသေးပါ (စာကျန်နေမည်)၊ ဝင်ထားပြီးမှ ထပ်ပို့ပါ'; hint.className = 'sub err'; return; }
      const nowAcct = String(cfgNow.account);
      // 0.5.25 T7：打開框時讀不到是誰（作者不明）→ 不自動當成現在登入的人，先問本人
      if (author === null) {
        if (typeof confirm !== 'function' || !confirm('這則建議會用「' + nowAcct + '」的名義送出，確定嗎？\n' + nowAcct + ' အမည်ဖြင့် ပို့မည်၊ သေချာပါသလား။')) {
          hint.textContent = '這次沒有送出（字留著）／ယခု မပို့ရသေးပါ (စာကျန်နေမည်)';
          hint.className = 'sub err';
          return;
        }
        author = nowAcct;
      }
      if (!author) author = nowAcct;
      if (author && nowAcct && nowAcct !== author) {
        hint.textContent = '這則建議是「' + author + '」寫的，現在登入的是「' + nowAcct + '」，這次沒有送出（字留著）；請用 ' + author + ' 登入再送／' + author + ' ဖြင့် ဝင်ပြီးမှ ပို့ပါ';
        hint.className = 'sub err';
        return;
      }
      // 0.5.19 B3（第18任抓BUG）：上次沒確定送出（逾時等）、改了字再送 → 換新代號（後台看代號擋重複，同代號只留第一版）；沒改字照用舊代號，不會多一則
      if (!sid || (sidText !== null && sidText !== text)) sid = newSid();
      sidText = text;
      send.disabled = true; hint.className = 'sub'; hint.textContent = '送出中…／ပို့နေသည်';
      let r = null;
      try { r = await gasCall({ action: 'feedback', text, sid, appVersion: String((typeof FARM_CONFIG !== 'undefined' && FARM_CONFIG.appVersion) || '') }, cfgNow); } catch (e) { r = null; }
      send.disabled = false;
      if (r && r.ok) { txt.value = ''; sid = ''; sidText = null; author = ''; close(); toast('已送出，謝謝你的建議／ပို့ပြီးပါပြီ၊ ကျေးဇူးတင်ပါသည်'); return; }
      hint.className = 'sub err';
      hint.textContent = r && r.offline ? '沒有網路，連上網路再按一次送出（字會留著）／အင်တာနက် မရှိပါ၊ အင်တာနက် ချိတ်ပြီး ထပ်ပို့ပါ (စာကျန်နေမည်)'
        : (r && r.message) || '沒有送出去，請再按一次（字會留著）／မပို့နိုင်သေးပါ၊ ထပ်နှိပ်ပါ (စာကျန်နေမည်)';
    });
  }

  /**
   * 0.5.04 董事長「立案就＋1、失敗紅字＋1，相除算出成功、失敗的 %」（看過預覽確認）：歷史成就最上面 6 格，
   * 五類＋合計；大數字＝立案，下面小字「失敗 N（紅）」「成功 X%・失敗 Y%」（分母＝立案；立案 0 寫「—」）。舊後台沒有 caseStats 就全部「—」
   */
  function renderCaseStats(cs) {
    const K = [['msGen', '一般農民'], ['msTrial', '試作農民'], ['msPromo', '推廣農民'], ['msSeeds', '種子商'], ['msDealers', '盤商']];
    const pct = (n, d) => (d ? Math.round(n / d * 100) + '%' : '—');
    const tot = { cases: 0, ok: 0, fail: 0 };
    const put = (id, s) => {
      const b = document.getElementById(id), sm = document.getElementById(id + 'Cs');
      if (b) b.textContent = s ? String(s.cases) : '—';
      if (sm) sm.innerHTML = s ? `立案 စတင် ${s.cases}・<span class="bad">失敗 မအောင်မြင် ${s.fail}</span><br>成功 ${pct(s.ok, s.cases)}・失敗 ${pct(s.fail, s.cases)}` : '';
    };
    K.forEach(([id, k]) => {
      const s = cs && cs[k] ? { cases: Number(cs[k].cases) || 0, ok: Number(cs[k].ok) || 0, fail: Number(cs[k].fail) || 0 } : null;
      if (s) { tot.cases += s.cases; tot.ok += s.ok; tot.fail += s.fail; }
      put(id, s);
    });
    put('msTotal', cs ? tot : null);
  }

  /* ───── 首頁 ───── */
  async function showHome() {
    if (await loginLostCheck()) return; // 0.4.87 中6：打卡時登入失效、先保留表單 → 回首頁這時才跳登入
    show('home');
    state.closeGroup = ''; // 0.4.73 回首頁就不再是「某一種農民結案」
    const cfg = await getConfig();
    $('who').textContent = cfg ? (cfg.name || cfg.account || '') : '';
    // 0.5.26（董事長：GM 用業務網址登入，看到的是業務畫面，搞混了 → 進錯網址要有提示）：主管、總經理帳號在首頁上方提示改用主管頁
    $n('bossTip').hidden = !(cfg && (cfg.role === '主管' || cfg.role === '總經理'));
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
    $('mirrorList').innerHTML = list.map((m, i) => `<li><a href="${esc(m.url)}">${esc(m.url)}</a>${m.url === here ? '<span class="pill ok">現在用的 လက်ရှိ သုံးနေသည်</span>' : ''}`
      + `<button type="button" class="btn2 small" data-copyurl="${i}">複製 ကူးယူ</button></li>`).join('');
    $('mirrorList').querySelectorAll('[data-copyurl]').forEach(b => b.addEventListener('click', async () => {
      const url = list[Number(b.dataset.copyurl)].url;
      try { await navigator.clipboard.writeText(url); toast('已複製網址／ကူးယူပြီး'); } catch (e) { toast(url); } // 不能複製時直接顯示網址，讓他自己抄
    }));
    // 0.5.19 A2（第18任抓BUG）：每個網址的手機資料分開——打開這一段時，這個網址還有沒上傳的就紅字提醒先傳完再換
    const box = $('mirrors');
    if (box && box.addEventListener && !box._pendBound) { box._pendBound = true; box.addEventListener('toggle', () => { if (box.open) mirrorPendingNote(); }); }
  }
  async function mirrorPendingNote() {
    const el = $('mirrorPending'); if (!el) return;
    let n = 0;
    try { n = (await Store.allVisits()).filter(v => v.status !== 'uploaded' && v.status !== 'rejected').length; } catch (e) { n = 0; }
    el.hidden = !n;
    el.textContent = n ? `這個網址還有 ${n} 筆沒上傳，請先在這裡傳完再換網址／ဤလိပ်စာတွင် မတင်ရသေးသော ${n} ခု ရှိသည်၊ ဤနေရာတွင် အရင်တင်ပါ` : '';
  }

  /* 首頁分頁（0.4.26）：記住上次看的分頁（只存在這支手機；存不了就每次從田間打卡開始） */
  const HOME_TABS = ['punch', 'todo', 'mine', 'close', 'plant']; // 0.4.60 結案獨立一個分頁 // 0.4.59 指派任務併進執行任務清單；第四格改種植資料（舊的「assigned」改開執行任務清單）
  /** 第26任：首頁左上 ↩ 回上一頁——回到上一個看的分頁；沒有上一頁就回田間打卡；已經在田間打卡又沒上一頁就變灰 */
  function navBack() {
    const st = state.navStack || [];
    let prev = '';
    while (st.length && !prev) { const t = st.pop(); if (t !== state.homeTab) prev = t; }
    setHomeTab(prev || 'punch', true);
    if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
  }
  function refreshNavBack() {
    const b = typeof document !== 'undefined' && document.getElementById ? document.getElementById('navBack') : null; if (!b) return;
    b.disabled = !(state.navStack && state.navStack.length) && state.homeTab === 'punch';
  }
  function setHomeTab(tab, noHist) {
    if (tab === 'assigned') tab = 'todo'; // 0.4.59 舊的指派任務分頁已併進執行任務清單
    if (HOME_TABS.indexOf(tab) < 0) tab = 'punch';
    // 2號 0.4.63 低#11：舊快取的頁面沒有這一頁（例如 0.4.59 前沒有「結案」）→ 全部分頁都藏起來、首頁空白；頁面上沒有就回田間打卡
    if (typeof document !== 'undefined' && document.getElementById && !document.getElementById('hp-' + tab)) tab = 'punch';
    // 第26任（董事長「每一頁都要有返回上一頁」）：換到別的分頁前，把原本那頁記下來，左上 ↩ 按了回去；按 ↩ 本身不記（noHist）
    if (!noHist && state.homeTab && state.homeTab !== tab) { const st = state.navStack || (state.navStack = []); st.push(state.homeTab); if (st.length > 20) st.shift(); }
    state.homeTab = tab;
    refreshNavBack();
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
    const nb = document.getElementById('navBack'); if (nb) nb.addEventListener('click', navBack); // 第26任：舊頁面沒有這顆就略過
    setHomeTab(saved, true);
  }

  // 0.4.75 董事長「我的進度要改：一般農民、試作農民、推廣農民、種子商、盤商，都要有下拉選單」：五顆切換，每一類一個看得見的下拉選單
  const MINE_TYPES = { 一般農民: 'ပုံမှန် လယ်သမား', 試作農民: 'နှိုင်းယှဉ် လယ်သမား', 推廣農民: 'မြှင့်တင် လယ်သမား', 種子商: 'မျိုးစေ့ဆိုင်', 盤商: 'ကုန်သည်' };
  const FARMER_GROUPS = ['一般農民', '試作農民', '推廣農民']; // 0.4.73 結案分頁三顆
  // 0.5.09 董事長「試算表也要分一般、試作、推廣農民，基本資料從那裡抓」：後台給 kind（客戶清單類型欄寫的那一種，建立時就寫死）。
  // 有 kind 就照 kind 分；舊資料沒有 kind（類型只寫「農民」）才照進行中的試作／推廣推算（0.5.06 的做法）
  const KIND_CAT = { 一般農民: '農戶', 試作農民: '試作', 推廣農民: '推廣' };
  const CAT_KIND = { 農戶: '一般農民', 試作: '試作農民', 推廣: '推廣農民' };
  async function customerById(cid) {
    const all = await allKnownCustomers();
    return all.find(x => x.id === cid) || null;
  }
  async function farmerCatOf(f) {
    if (f && KIND_CAT[f.kind]) return KIND_CAT[f.kind];
    const id = f && f.id;
    return (await activeTrialFor(id, '試作')) ? '試作' : (await activeTrialFor(id, '推廣')) ? '推廣' : '農戶';
  }
  /* 種植進度（0.4.75 起從種植日期算天數）。0.5.14 客戶「每個作物訂個天數追蹤」＋董事長「不用寫死了，改給對方主管填天數」：
     總天數＝選單分頁該作物的「生長天數」（主管自己填；後台 options.cropDays）。**沒填就沒有總天數**：只算第幾天、不畫進度條、提醒主管去填，程式裡不假設任何固定天數 */
  const cropDaysOf = (crop, opts) => { const d = (opts || state.options || {}).cropDays || {}; const n = Number(d[String(crop || '').trim()]); return n > 0 ? n : 0; };
  /** 種植進度：沒填種植日期（或格式不對）回 null；日期在未來＝future；total＝作物生長天數（0＝主管還沒設）。today、plantDate 都是 YYYY-MM-DD（緬甸日期） */
  function growOf(plantDate, today, total) {
    const T = Number(total) > 0 ? Number(total) : 0;
    const pd = String(plantDate || '').slice(0, 10);
    if (!/^\d{4}-\d\d-\d\d$/.test(pd) || !/^\d{4}-\d\d-\d\d$/.test(String(today || ''))) return null;
    const days = Math.round((Date.parse(today) - Date.parse(pd)) / 86400000);
    if (!isFinite(days)) return null;
    if (days < 0) return { days: 0, pct: 0, future: true, full: false, total: T, noTotal: !T };
    if (!T) return { days, pct: 0, future: false, full: false, total: 0, noTotal: true };
    return { days, pct: Math.min(100, Math.round(days / T * 100)), future: false, full: days >= T, total: T, noTotal: false };
  }
  // 畫面寫天數（pct 只拿來畫進度條）：未來＝還沒到種植日期、超過＝已滿 N 天、沒設天數＝第 N 天（未設生長天數）、沒填日期＝未填種植日期
  const growLabel = g => (!g ? '未填種植日期／စိုက်သည့်ရက် မဖြည့်ရသေး' : g.future ? '還沒到種植日期／စိုက်သည့်ရက် မရောက်သေး' : g.noTotal ? `第 ${g.days} 天（未設生長天數）／${g.days} ရက်မြောက် (ကြီးထွားရက် မသတ်မှတ်ရသေး)` : g.full ? `已滿 ${g.total}`
    + ` 天／${g.total} ရက် ပြည့်ပြီ` : `第 ${g.days} 天／${g.total} 天（${g.days} ရက်မြောက်／${g.total} ရက်）`);
  /** 第26任：同 growLabel，但中文、緬文分兩行（小標籤用；緬文照 growLabel 原字） */
  const growLines = g => (!g ? ['未填種植日期', 'စိုက်သည့်ရက် မဖြည့်ရသေး'] : g.future ? ['還沒到種植日期', 'စိုက်သည့်ရက် မရောက်သေး']
    : g.noTotal ? [`第 ${g.days} 天（未設生長天數）`, `${g.days} ရက်မြောက် (ကြီးထွားရက် မသတ်မှတ်ရသေး)`] : g.full ? [`已滿 ${g.total} 天`, `${g.total} ရက် ပြည့်ပြီ`]
    : [`第 ${g.days} 天／${g.total} 天`, `${g.days} ရက်မြောက်／${g.total} ရက်`]);
  function growHtml(g) { // 進度條＋第 N 天／作物天數（跟「主管訂的目標」同一種進度條）
    if (!g) return '<p class="sub">未填種植日期，算不出種植進度（到「種植資料」分頁補填）／စိုက်ပျိုးသည့်ရက် မဖြည့်ရသေး၍ တိုးတက်မှု တွက်မရပါ (「စိုက်ပျိုးမှု」 စာမျက်နှာတွင် ဖြည့်ပါ)</p>';
    if (g.noTotal && !g.future) return `<div class="grow"><span class="lab">種植進度 စိုက်ပျိုးမှု တိုးတက်မှု：<b>第 ${g.days} 天</b> <span class="my">ရက် ${g.days}</span></span>`
      + '<p class="sub">這個作物主管還沒設定生長天數（試算表「選單」分頁、作物那一列的「生長天數」欄），設好就會顯示進度條／ဤသီးနှံအတွက် မန်နေဂျာ ကြီးထွားရက် မသတ်မှတ်ရသေးပါ (Sheet တွင် သတ်မှတ်ပြီးလျှင် တိုးတက်မှုဘား ပြမည်)</p></div>';
    return `<div class="grow"><span class="lab">種植進度 စိုက်ပျိုးမှု တိုးတက်မှု：${g.future ? '<b>還沒到種植日期</b>／စိုက်သည့်ရက် မရောက်သေး' : `<b>第 ${g.days} 天／${g.total}`
      + ` 天</b> <span class="my">${g.days} ရက်မြောက်／${g.total} ရက်</span>`}`
      + `${g.full ? `（已滿 ${g.total} 天 <span class="my">ပြည့်</span>）` : ''}</span>`
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
    return { days: n, lv, text: `距上次拜訪 ${n} 天・${AGE_WORD[lv]}／ယခင်သွားရောက်မှုမှ ${n} ရက်・${{ r: 'မသွားဖြစ်သည်မှာ ကြာပြီ', y: 'ပြန်သွားရန် နီးပြီ', g: 'မကြာသေးမီက သွားပြီး' }[lv]}` };
  }
  /** 0.4.84（BUG清單_0.4.83 低1）：最後拜訪日＝後台 lastVisit 跟這支手機自己帳號的拜訪（myVisits，用緬甸日期 mmDay）取比較新的那天。
      有打字、錄音的拜訪，後台要等背景翻譯（最多約 10 分鐘）才更新 lastVisit；這段時間只看後台會還是紅字 */
  function latestVisitDay(serverDay, cid, mine) {
    // 0.4.91 低2：cid 可以給 [正式編號, 臨時編號]——剛新增的客戶，手機拜訪記的是 T_ 臨時編號，上傳後後台給正式編號（2 號在 customerOut_ 加 tempId）；舊後台沒有 tempId 照舊
    const ids = [].concat(cid).filter(Boolean);
    const own = (mine || []).filter(v => v && v.status !== 'rejected' && ids.indexOf(v.farmerId) >= 0 && Number(v.deviceTime) > 0).map(v => mmDay(0, Number(v.deviceTime))); // 0520R4 I4：被後台拒收（不會進後台）的不算
    return [String(serverDay || '').slice(0, 10)].concat(own).filter(d => /^\d{4}-\d\d-\d\d$/.test(d)).sort().pop() || '';
  }
  const visitAgeHtml = (lastVisit, today) => { const a = visitAge(lastVisit, today); return `<span class="vage ${a.lv}">${esc(a.text)}</span>`; };
  /** 農民分三類，跟結案 group 同一套（closeTrialGroup）：有進行中試作＝試作農民、推廣＝推廣農民、都沒有＝一般農民；盤商、種子商照類型 */
  async function mineGroupOf(f) {
    const type = f.type || '農民';
    if (type !== '農民') return type;
    if (KIND_CAT[f.kind]) return f.kind; // 0.5.10 抓BUG中1：類型欄寫了分類就照分類（試作／推廣農民還沒開始也不會掉到一般農民）
    for (const cat of ['試作', '推廣']) { const t = await activeTrialFor(f.id, cat); if (t) return closeTrialGroup({ cat, t }); }
    return closeTrialGroup(null);
  }
  /**
   * 歷史成就「已結案的農民」：這位業務負責、已經結案（主管確認過）的農民，推廣農民排最前面。
   * 已結案的農民不會出現在田間打卡、執行任務的清單（後台不送），只在這裡留紀錄（董事長 2026-11-19）。
   */
  function renderEndedFarmers(list) {
    const box = document.getElementById('endedFarmers');
    if (!box) return; // 舊頁面沒有這一區
    const order = ['推廣農民', '試作農民', '一般農民'];
    const kindOf = f => (order.indexOf(f.kind) >= 0 ? f.kind : '一般農民');
    const groups = order.map(k => [k, (list || []).filter(f => kindOf(f) === k)]).filter(([, fs]) => fs.length);
    const place = f => [f.town, f.village].filter(Boolean).join('・');
    const row = f => `<li><b>${esc(f.name || '')}</b>｜${esc(f.id)}${place(f) ? '｜' + esc(place(f)) : ''}${f.lastVisit ? `｜最後拜訪 နောက်ဆုံး သွားရောက်မှု ${esc(f.lastVisit)}` : ''}</li>`;
    box.innerHTML = groups.length
      ? groups.map(([k, fs]) => `<h3>${esc(k)}（${fs.length}）</h3><ul>${fs.map(row).join('')}</ul>`).join('')
      : '<p class="sub">還沒有已結案的農民<span class="my">ပိတ်သိမ်းပြီးသော လယ်သမား မရှိသေးပါ</span></p>';
  }
  /** 0.4.57／0.4.73／0.4.75 「我的進度」：自己負責的客戶（不看別人的），五類各幾位、選一類出現下拉、選一位展開進度卡＋過往紀錄；另列農民種植進度 */
  async function fillCloseFarmers() {
    const sel = document.getElementById('closeFarmer');
    if (!sel) return; // 舊頁面沒有這個選單
    const server = (await Store.getMeta('farmers')) || [], local = ((await myLocal('localCustomers')) || []).filter(l => !server.some(f => f.tempId && f.tempId === l.id)); // R13-02：後台已有同一位（tempId）就不重複列
    const me = String(((await getConfig()) || {}).name || '');
    // state.closeList 照舊只放農民（種植資料分頁用）；state.mineAll 是全部自己負責的
    const allMine = server.concat(local.filter(l => !server.some(f => f.id === l.id)))
      .filter(f => f.pending || String(f.staff || '') === me);
    state.mineAll = allMine;
    state.closeList = allMine.filter(f => (f.type || '農民') === '農民');
    state.endedMine = ((await Store.getMeta('endedMine')) || []).filter(f => (f.type || '農民') === '農民' && !state.closeList.some(x => x.id === f.id)); // 0.4.80 中3
    renderEndedFarmers(state.endedMine); // 第28任：歷史成就列出已結案的農民
    const today = mmDay(0); // 業務BUG#4：緬甸的今天（0.4.75 種植進度也用這個日期算）
    const groupOf = {}, growOfId = {};
    // 0.5.14 作物生長天數；0.5.16 第1輪：先讀手機資料庫（每次同步都更新）—— state.options 只在打開打卡畫面時讀一次，主管後來填的天數會看不到
    const optsG = (await Store.getMeta('options')) || state.options || {}; state.optsGrow = optsG;
    for (const f of allMine) { groupOf[f.id] = await mineGroupOf(f); if ((f.type || '農民') === '農民') growOfId[f.id] = growOf(f.plantDate, today, cropDaysOf(f.crop, optsG)); }
    const mtype = MINE_TYPES[state.mineType] ? state.mineType : '一般農民';
    const list = allMine.filter(f => groupOf[f.id] === mtype);
    // 0.5.04：最上面 6 格改成「立案／失敗／成功％」（renderCaseStats，後台算），這裡不再寫人數
    if (typeof document.querySelectorAll === 'function') document.querySelectorAll('#mineType [data-mtype]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mtype === mtype)));
    const isFarmer = FARMER_GROUPS.indexOf(mtype) >= 0;
    const keep = sel.value;
    sel.innerHTML = `<option value="">— 選一位${mtype} ${MINE_TYPES[mtype]} တစ်ဦး ရွေးပါ —</option>` + list.map(f => `<option value="${esc(f.id)}">${esc(f.name)}${f.area ? '｜' + esc(String(f.area).trim() /* 0.4.89 地區完整顯示（業務－地區），不切字 */) : ''}`
      + `${isFarmer ? '｜' + esc(growLabel(growOfId[f.id])) : ''}｜${esc(visitAge(latestVisitDay(f.lastVisit, [f.id, f.tempId], state.myVisitList), today).text.split('／')[0])}`
      + `${f.pending ? '（新，未上傳 အသစ်၊ မတင်ရသေး）' : ''}</option>`).join(''); // 0.4.82 選項加「距上次拜訪 N 天」（選項不能上色，靠文字）
    sel.value = keep && list.some(f => f.id === keep) ? keep : '';
    sel.disabled = !list.length;
    state.mineGrow = growOfId;
    state.mineGroupOf = groupOf; // 0.4.82 執行任務清單左欄用同一套分類
    // 0.4.82 沒選人：修改種植資料的表單也收起（state.plEditCid、plForm）
    if (!sel.value) {
      state.plEditCid = '';
      $n('plForm').hidden = true;
      const b = $n('closeProgress');
      b.hidden = true;
      b.innerHTML = '';
      const hb = $n('closeHistory');
      hb.hidden = true;
      hb.innerHTML = '';
      hb._tok = null;
      const gb = $n('closeGrow');
      gb.hidden = true;
      gb.innerHTML = '';
    }
    $n('closeFarmerCount').textContent = list.length ? `共 ${list.length} 位${mtype}，從下拉選一位看進度和過往拜訪紀錄（照片、錄音）／${list.length} ဦး၊ ရွေးပြီး တိုးတက်မှုနှင့် ယခင် မှတ်တမ်းများ (ဓာတ်ပုံ၊ အသံ) ကြည့်ပါ`
      : `還沒有自己負責的${mtype}／ကိုယ်တာဝန်ယူထားသော ${MINE_TYPES[mtype]} မရှိသေးပါ`;
    // 「主管訂的目標」底下：農民種植進度（三類都列，百分比由高到低；沒填種植日期排最後）
    const gl = document.getElementById('growList');
    if (gl) {
      const dayKey = g => (!g ? -2 : g.future ? -1 : g.days); // 0.4.82 照天數排：天數多的在前，還沒到種植日期其次，沒填最後
      const farmers = state.closeList.slice().sort((a, b) => dayKey(growOfId[b.id]) - dayKey(growOfId[a.id]));
      gl.innerHTML = farmers.map(f => { const g = growOfId[f.id];
        return `<li class="plan"><span>${esc(f.name)}<br><small>${esc(groupOf[f.id])}・${g ? (g.future ? '還沒到種植日期／စိုက်သည့်ရက် မရောက်သေး' : (g.noTotal ? `第 ${g.days}`
          + ` 天（未設生長天數）／${g.days} ရက်မြောက် (ကြီးထွားရက် မသတ်မှတ်ရသေး)` : `第 ${g.days} 天／${g.total} 天（${g.days} ရက်မြောက်）`)) : '未填種植日期／ရက် မဖြည့်ရ'}`
          + `</small><span class="bar"><i style="width:${g ? g.pct : 0}%"></i></span></span>`
          + `${!g ? '<span class="pill wait">未填 မဖြည့်ရ</span>' : g.full ? `<span class="pill ok">已滿 ${g.total} 天 ပြည့်</span>` : g.future ? '<span class="pill wait">還沒到種植日期 စိုက်သည့်ရက် မရောက်သေး</span>' : g.noTotal ? '<span class="pill wait">未設天數 ရက်မသတ်မှတ်ရ</span>' : `<span class="pill wait">第 ${g.days}`
            + ` 天／${g.days} ရက်မြောက်</span>`}</li>`; }).join('')
        || '<li class="empty">還沒有自己負責的農民／ကိုယ်တာဝန်ယူထားသော လယ်သမား မရှိသေးပါ</li>';
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
    const rows = [['種子公司 မျိုးစေ့ ကုမ္ပဏီ', co], ['作物 သီးနှံ', f.crop ? cropText(f.crop) : ''], ['代碼 ကုဒ်', f.varCode], ['種植日期 စိုက်သည့်ရက်', f.plantDate],
      ['目前種植面積 လက်ရှိ စိုက်ဧက', f.areaNow === '' || f.areaNow == null ? '' : `${f.areaNow} ${u}`], ['可種植面積 စိုက်နိုင်သော ဧက', f.areaMax === '' || f.areaMax == null ? '' : `${f.areaMax}`
        + ` ${u}`], ['其他 အခြား', f.fertilizer]];
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
  const farmerReportErr = r => (r && r.offline ? '產生 Word 檔要有網路，請連上網路再按一次／Word ဖိုင် ထုတ်ရန် အင်တာနက် လိုသည်၊ အင်တာနက် ချိတ်ပြီး ထပ်နှိပ်ပါ'
    : r && r.timeout ? 'Word 檔產生太久（照片多或網路慢），請稍後再按一次／Word ဖိုင် ထုတ်ချိန် ကြာနေသည် (ဓာတ်ပုံများခြင်း သို့မဟုတ် အင်တာနက် နှေးခြင်း)၊ ခဏနေမှ ထပ်နှိပ်ပါ'
    : r && r.code === 'BAD_ACTION' ? '後台還沒更新，暫時不能產生 Word 檔，請告訴主管／ဆာဗာ မအပ်ဒိတ်ရသေးသဖြင့် Word မထုတ်နိုင်သေးပါ၊ မန်နေဂျာကို ပြောပါ'
    : (r && r.message) || '產生失敗，請再按一次／မအောင်မြင်၊ ထပ်နှိပ်ပါ');
  /** 按「產生 Word 檔」：後台 farmerReport 做好（種植資料＋全部拜訪＋照片）傳回來，手機下載成 .docx */
  async function downloadFarmerReport(btn) { // 0.4.82 表單搬走後，種植資料頁的提示字改用 plWordHint
    const cid = $n('plFarmer').value;
    if (!cid || btn.disabled) return;
    const label = btn.innerHTML;
    btn.disabled = true; btn.textContent = '產生中…照片多時要 1～2 分鐘／ထုတ်နေသည်၊ ၁～၂ မိနစ် ကြာနိုင်'; $n('plWordHint').textContent = ''; // 0.4.80 中2
    try {
      const k0 = ((await getConfig()) || {}).deviceKey || '';
      const r = await gasCall({ action: 'farmerReport', cid });
      if ((((await getConfig()) || {}).deviceKey || '') !== k0) return; // 0.5.16 第1輪 低：等 Word 的途中登出或換人 → 不下載上一位的檔
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
    const crops = (o.crops || []).map(c => ({ value: c, text: cropText(c) })); crops.push({ value: '其他', text: 'Other／အခြား' });
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
    if (isNaN(now) || isNaN(max)) return '面積要填數字（用 0～9，不要用逗號）／ဧက ဂဏန်းသာ ဖြည့်ပါ (0～9 သုံးပါ၊ ကော်မာ မထည့်ပါနှင့်)';
    if ((now !== null && now < 0) || (max !== null && max < 0)) return '面積不能是負數／ဧက အနုတ် မဖြစ်ရ';
    if (now !== null && max !== null && now > max) return '目前種植面積不能大於可種植面積／လက်ရှိ စိုက်ဧကသည် စိုက်နိုင်သော ဧကထက် မများရပါ';
    const d = String($n('pPlantDate').value || '');
    if (d && d > mmDay(365)) return '種植日期不能超過一年後／စိုက်သည့်ရက်သည် တစ်နှစ်နောက်ပိုင်း ထက် မကျော်ရပါ';
    if (d && d < mmDay(-730)) return '種植日期不能早於 2 年前，請確認年份／စိုက်ရက် နှစ်နှစ်ထက် မစောရ၊ နှစ်ကို စစ်ပါ'; // 0533 C2
    // 第26任 2026-11-18 董事長「代碼要必填」：新增農民沒填代碼不給存（盤商、種子商不用；舊客戶到種植資料補）。整句緬文待譯（_翻譯/待譯_第26任_20261118.md D11）
    if (!String($n('pVarCode').value || '').trim()) return '新增農民要填代碼才能存／လယ်သမားအသစ် ထည့်ရန် ကုဒ် ဖြည့်မှ သိမ်းနိုင်မည်';
    return '';
  }
  // 0533 C2（小助手1號，第23任抓BUG；董事長同意 2 年）：種植日期原本沒下限，1901-01-01 照存 → 進度條幾萬天、生長階段被推成採收。
  //   新增農民、種植資料都擋 2 年（730 天）以前；種植資料只在這次有改日期時檢查（舊資料照樣能改別的欄位）。字寫在兩個函式裡（舊測試只抽單一函式）
  // 2號 0.4.70 清單低1（第8任）：原本檢查整張表單的現值，舊資料本來就不合規定（例：日期 2099、目前＞可種）時，改任何別的欄位都存不了
  // → ch（plantChanges 的結果）有給就只檢查「這次改到的」欄位；面積兩格有一格改到才比大小。打了不是數字的（badInput）不管哪格都擋（不然會被當成清空）
  function plantProblem(ch) {
    const num = id => { const el = $n(id), v = String(el.value == null ? '' : el.value).trim(); if (el.validity && el.validity.badInput) return NaN; return v === '' ? null : Number(v); };
    const touched = k => !ch || k in ch.profile || ch.clear.indexOf(k) >= 0;
    const now = num('plNow'), max = num('plMax');
    if (isNaN(now) || isNaN(max)) return '面積要填數字（用 0～9，不要用逗號）／ဧက ဂဏန်းသာ ဖြည့်ပါ (0～9 သုံးပါ၊ ကော်မာ မထည့်ပါနှင့်)';
    if ((touched('areaNow') && now !== null && now < 0) || (touched('areaMax') && max !== null && max < 0)) return '面積不能是負數／ဧက အနုတ် မဖြစ်ရ';
    if ((touched('areaNow') || touched('areaMax')) && now !== null && max !== null && now > max) return '目前種植面積不能大於可種植面積／လက်ရှိ စိုက်ဧကသည် စိုက်နိုင်သော ဧကထက် မများရပါ';
    const d = String($n('plDate').value || '');
    if (touched('plantDate') && d && d > mmDay(365)) return '種植日期不能超過一年後／စိုက်သည့်ရက်သည် တစ်နှစ်နောက်ပိုင်း ထက် မကျော်ရပါ';
    if (touched('plantDate') && d && d < mmDay(-730)) return '種植日期不能早於 2 年前，請確認年份／စိုက်ရက် နှစ်နှစ်ထက် မစောရ၊ နှစ်ကို စစ်ပါ'; // 0533 C2
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
  /** 0.4.94 中4：種植資料存檔逾時後，同步回來（客戶清單更新）時比對：後台的值已經是送出的值 → 提示「剛才的修改已存好」；超過一天還對不上就不再比
   *  0.4.98（第13任 手機8）：原本只記一筆、不分帳號 → 連續兩位農民逾時，前一位的被蓋掉；換人登入同一支手機，上一位的比對結果提示給下一位。
   *  改成一筆一位（帳號＋客戶編號），只比現在這個帳號的（舊版存的單筆沒有帳號：照舊比） */
  async function plantPendingCheck() {
    const asList = raw => (Array.isArray(raw) ? raw : raw && raw.cid ? [raw] : []);
    const raw0 = await Store.getMeta('plantPending');
    if (!asList(raw0).length) return '';
    const acct = ((await getConfig()) || {}).account || '';
    const farmers = (await Store.getMeta('farmers')) || [];
    const same = (a, b) => {
      const x = String(a == null ? '' : a).trim(), y = String(b == null ? '' : b).trim();
      return x === y || (x !== '' && y !== '' && isFinite(Number(x)) && isFinite(Number(y)) && Number(x) === Number(y));
    };
    let res = '', msgs = [];
    // 0.4.99（第13任，0.4.98 審查手機低）：①手機時間被往回調時「現在－記錄時間」是負數，原本永遠不過期 → 負數也當過期；
    //   ②讀清單、比對、寫回放在同一個資料庫交易（Store.updateMeta）裡，中間另一位剛逾時寫進來的不會被舊清單蓋掉（舊環境沒有 updateMeta 就照舊讀了再寫）
    const work = raw => {
      res = ''; msgs = []; let changed = false;
      const keep = asList(raw).filter(pp => {
        if (!pp || !pp.cid) { changed = true; return false; }
        const age = Date.now() - (pp.at || 0);
        if (age > 86400000 || age < 0) { changed = true; if (!res) res = 'expired'; return false; }
        if (pp.account && acct && pp.account !== acct) return true; // 別的帳號的：留著，等他登入再比
        const f = farmers.find(x => x.id === pp.cid);
        if (!f) return true;
        const ok = Object.keys(pp.profile || {}).every(k => same(f[k], pp.profile[k])) && (pp.clear || []).every(k => String(f[k] == null ? '' : f[k]).trim() === '');
        if (!ok) return true;
        changed = true; res = 'saved';
        msgs.push(`剛才的種植資料修改已存好（${f.name || pp.cid}）／ယခင် ပြင်ဆင်ချက် သိမ်းပြီးပါပြီ`);
        return false;
      });
      return changed ? (keep.length ? keep : null) : raw;
    };
    if (typeof Store.updateMeta === 'function') await Store.updateMeta('plantPending', work);
    else { const out = work(raw0); if (out !== raw0) await Store.setMeta('plantPending', out); }
    msgs.forEach(t => toast(t));
    return res;
  }
  async function savePlant() {
    // 0533 C1（小助手1號，第23任抓BUG）：原本先 await 讀登入、才停用按鈕 → 連按兩下送兩次 plantSave。
    //   改成一進來就鎖（比照 0.5.16 登入鈕），所有提早結束和存完都在最外層 finally 解鎖
    if (state.plSaving) return;
    state.plSaving = true;
    const btn = $n('plSave'); btn.disabled = true;
    try {
    const cid = state.plEditCid || '', cfg = await getConfig(); // 0.4.82 改在月分工作進度：存的是正在改的那位（不是種植資料分頁選的）
    if (!cid) return;
    if (!cfg || !cfg.deviceKey || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      $n('plHint').textContent = '要有網路才能存種植資料，請連上網路再按一次／စိုက်ပျိုးမှု အချက်အလက် သိမ်းရန် အင်တာနက် လိုသည်၊ အင်တာနက် ချိတ်ပြီး ထပ်နှိပ်ပါ';
      return;
    }
    const ch = plantChanges(cid);
    const bad = plantProblem(ch); if (bad) { $n('plHint').textContent = bad; return; } // 低1：只檢查改到的欄位
    if (!Object.keys(ch.profile).length && !ch.clear.length) { $n('plHint').textContent = '沒有改任何資料／ပြောင်းထားတာ မရှိ'; return; }
    $n('plHint').textContent = '存檔中…／သိမ်းနေသည်';
    try {
      let plCfg = null; const plSent = Date.now(); // R21-07：送出時的登入與時間，回應照 rememberServer 的規則寫（讀不到登入就不寫回，不影響存檔本身）
      try { plCfg = await getConfig(); } catch (e) { plCfg = null; }
      const r = await gasCall({ action: 'plantSave', cid, profile: ch.profile, clear: ch.clear, ask: (typeof FarmCore !== 'undefined' && FarmCore.buildAsk) ? await FarmCore.buildAsk() : undefined }, cfg); /* 0.5.25 T6：用開頭核對過的登入設定送（中途換人不改用新金鑰） */ // R20：帶 ask // 業務BUG#3：改走 gasCall，有逾時；種植資料中1（第8任）：只送改過的欄位
      // 0.4.94 中4（第11任第五輪）：逾時不代表沒存到（後台常常其實已存好）→ 不叫業務馬上重按；記下送出的值，下次同步回來比對，已經是送出的值就說「剛才的修改已存好」
      // 0.5.00（第13任，Antigravity 第 1 輪 3／0.4.99 審查手機低 3、4）：①逾時紀錄的新增、清除也走 Store.updateMeta 同一個交易（原本先讀再寫，
      //   跟同步比對交錯時會把剛清掉的寫回去、同一位提示兩次）；②等回應期間換人登入或登出 → 只整理上一位的紀錄，不跳提示、不動現在畫面
      const acct = cfg.account || '';
      const editPending = async fn => {
        const conv = raw => (Array.isArray(raw) ? raw.slice() : raw && raw.cid ? [raw] : []);
        if (typeof Store.updateMeta === 'function') return Store.updateMeta('plantPending', raw => { const out = fn(conv(raw)); return out.length ? out : null; });
        const out = fn(conv(await Store.getMeta('plantPending'))); return Store.setMeta('plantPending', out.length ? out : null);
      };
      const samePerson = async () => { const now = await getConfig(); return !!(now && now.deviceKey === cfg.deviceKey); };
      // 0.5.00（Antigravity 第 2 輪 3）：等回應期間（最多 60 秒）換去改另一位農民 → 這位的結果不能寫進那位的提示、不能把那位正在改的表單關掉
      const stillHere = async () => (await samePerson()) && state.plEditCid === cid;
      const say = async msg => { if (await stillHere()) $n('plHint').textContent = msg; else if (await samePerson()) toast(msg); };
      // 一位一筆（帳號＋客戶編號）；升版前存的舊格式（沒帳號）同一位也一起換掉（0.4.98 審查手機低1）
      const notThis = pp => !(pp && pp.cid === cid && (!pp.account || pp.account === acct));
      if (r && r.timeout) {
        try {
          await editPending(list => { list = list.filter(notThis);
            list.push({ account: acct, cid, profile: ch.profile, clear: ch.clear, at: Date.now() });
            return list; });
        } catch (e) { /* 記不下來：只是之後不會自動提示已存好 */ }
        await say('網路太慢，可能已存好，請稍後到這位農民的進度看一下再決定要不要重按／အင်တာနက် နှေးသည်၊ သိမ်းပြီး ဖြစ်နိုင်သည်၊ ခဏနေမှ တိုးတက်မှုကို ကြည့်ပြီး ထပ်နှိပ်ရန် ဆုံးဖြတ်ပါ');
        return;
      }
      if (!r || !r.ok) { await say((r && r.message) || '存檔失敗，請再試一次／သိမ်းဆည်းမှု မအောင်မြင်ပါ၊ ထပ်ကြိုးစားပါ'); return; }
      try { await editPending(list => list.filter(notThis)); } catch (e) { /* 清不掉：下次比對到一樣會清 */ } // 0.4.94 中4：這位這次存好了，先前逾時那筆不用再比
      // 0.4.99：存檔最多等 60 秒，期間登出、換人登入 → 上一位的回應晚到，不能把他的客戶清單寫進新帳號；0.5.00：提示、重畫也不做
      if (!(await samePerson())) return;
      // R21-07（GPT）：原本直接寫 farmers，晚到的舊回應會蓋掉較新的客戶快取 → 改走 rememberServer（同一個交易比登入、比後台時間，整份一起寫）
      try { if (plCfg && plCfg.deviceKey) await rememberServer(r, plSent, plCfg.deviceKey); } catch (e) { /* 寫不進去：下次同步會再拿 */ }
      const here = state.plEditCid === cid;
      toast('種植資料已存好／သိမ်းပြီး');
      $n('plHistory')._doneCid = null; // 0.4.80 低5：存好了要重讀紀錄
      await fillCloseFarmers();
      if (here) { closePlantEdit(); showCloseProgress(); $n('plHint').textContent = '已存好，主管看得到／သိမ်းပြီး'; } // 0.4.82 存好收起表單、重畫進度卡；0.5.00：已經換去改別位就不關他的表單
    } catch (e) { try {
      const now = await getConfig();
      if (now && now.deviceKey === cfg.deviceKey && state.plEditCid === cid) $n('plHint').textContent = '網路不穩，沒存成功，請再按一次／အင်တာနက် မတည်ငြိမ်၍ မသိမ်းနိုင်ပါ၊ ထပ်နှိပ်ပါ';
    } catch (e2) { /* 畫面寫不了就算了 */ } }
    } finally { state.plSaving = false; btn.disabled = false; }
  }
  /* ───── 0.4.61 董事長：農民試作成功、失敗都要產生一份報表檔，所有人都看得到 ─────
     「我的進度」按「看試作報告」才向後台拿清單（要有網路；不在每次畫首頁時自動拿，省流量）；有 Word 的按一下下載
     業務BUG#3（2號小助手 2026-11-12）：原本直接 fetch 沒上限，緬甸網路「不回也不斷」時按鈕一直停在「存檔中…」→ 加逾時 20 秒（Word 檔 60 秒） */
  async function gasCall(payload) {
    // 0524R1-2：第二個參數（可不給）＝呼叫的人已經核對過的登入設定（提供建議比對作者）→ 用那一份的金鑰，不再另讀（中間換人會錯送）。
    //   函式開頭那行不改：很多舊測試照這一行抓函式
    const useCfg = arguments.length > 1 ? arguments[1] : undefined;
    const cfg = useCfg || await getConfig();
    if (!cfg || !cfg.deviceKey || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { ok: false, offline: true };
    // 1號第2任 0.4.73 讀碼中1（第8任）：照片、錄音（myFile）用 base64 傳，長錄音在緬甸網路 20 秒常傳不完 → 跟報告檔一樣給 60 秒
    const ms = payload && payload.action === 'farmerReport' ? 150000 : payload && (payload.action === 'trialReportFile' || payload.action === 'myFile' || payload.action === 'plantSave') ? 60000 : 20000; // 0.4.94 中4：種植資料存檔 20 秒不夠，改 60 秒 // 0.4.77 種植紀錄 Word 含全部照片，給 120 秒
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl && typeof setTimeout === 'function' ? setTimeout(() => ctl.abort(), ms) : null;
    state.netBusy = (Number(state.netBusy) || 0) + 1; // 0.5.20 G1：有請求送出中（建議、種植資料、下載報告…），新版背景程式先不重整
    try {
      const res = await fetch(FARM_CONFIG.gasUrl, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ deviceKey: cfg.deviceKey }, payload)), signal: ctl ? ctl.signal : undefined });
      const data = await res.json();
      // 0.5.19 B4（第18任抓BUG）：種植資料、照片錄音、Word、進度這些直接查後台的，收到登入失效原本只印一行字、不帶回登入頁 → 跟同步走同一條路
      //   （onLoginExpired 會比對送出時的金鑰：換人登入了就不動；打卡填到一半先保留表單）
      const sentKey = cfg.deviceKey; // 送出時的金鑰
      if (data && data.code === 'BAD_LOGIN' && typeof onLoginExpired === 'function') await onLoginExpired(sentKey, (data.message || '登入已失效') + '。沒上傳的資料還在手機裡，重新登入後會自動補傳。／ပြန်ဝင်ပြီးလျှင် ကျန်သော မှတ်တမ်း တင်မည်။');
      return data;
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, timeout: true, message: '網路太慢，可能沒讀到，請再按一次／အင်တာနက် နှေးနေ၍ မဖတ်နိုင်ခြင်း ဖြစ်နိုင်သည်၊ ထပ်နှိပ်ပါ' };
      throw e;
    } finally { if (timer) clearTimeout(timer); state.netBusy = Math.max(0, (Number(state.netBusy) || 0) - 1); }
  }
  async function loadReports() {
    const btn = $n('reportLoadBtn'); btn.disabled = true; $n('reportHint').textContent = '讀取中…／ဖတ်နေသည်';
    try {
      const r = await gasCall({ action: 'trialReports' });
      if (r && r.offline) { $n('reportHint').textContent = '要有網路才能看試作報告，請連上網路再按一次／စမ်းသပ် အစီရင်ခံစာ ကြည့်ရန် အင်တာနက် လိုသည်၊ အင်တာနက် ချိတ်ပြီး ထပ်နှိပ်ပါ'; return; }
      if (!r || !r.ok || !Array.isArray(r.reports)) { $n('reportHint').textContent = (r && r.message) || '讀取失敗，請再按一次／ဖတ်ရှုမှု မအောင်မြင်ပါ၊ ထပ်နှိပ်ပါ'; return; }
      state.reports = r.reports;
      state.me = String(((await getConfig()) || {}).name || ''); // 0.4.69 分「我的／其他業務」用
      renderReports();
    } catch (e) { $n('reportHint').textContent = '網路不穩，請再按一次／အင်တာနက် မတည်ငြိမ်ပါ၊ ထပ်နှိပ်ပါ'; } finally { btn.disabled = false; }
  }
  const REPORT_PILL = { 成功: 'ok', 失敗: 'late', 結束: 'wait' };
  /* 0.4.69 董事長：首頁右上角「分享我的報告」「觀看其他業務報告」→ 同一份清單分「我的（負責業務＝我）／其他業務」，看的範圍不變 */
  const REPORT_SCOPE = { all: '全部的試作報告／အားလုံး', mine: '我的報告（我負責的試作）／ကျွန်ုပ်၏ အစီရင်ခံစာ (တာဝန်ယူသော စမ်းသပ်မှု)', others: '其他業務的報告／အခြားသူများ' };
  const reportScopeOf = (list, scope, me) => (scope === 'mine' ? list.filter(t => String(t.staff || '') === me)
    : scope === 'others' ? list.filter(t => String(t.staff || '') !== me) : list);
  function renderReports() {
    const scope = REPORT_SCOPE[state.reportScope] ? state.reportScope : 'all';
    if (typeof document.querySelectorAll === 'function') document.querySelectorAll('#reportScope [data-scope]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scope === scope)));
    const now = document.getElementById('reportNow'); if (now) now.textContent = '現在看：လက်ရှိ ကြည့်နေသည် - ' + REPORT_SCOPE[scope];
    const ul = document.getElementById('reportList'); // 舊頁面沒有這一塊：不畫
    if (!ul || !Array.isArray(state.reports)) return;
    const list = reportScopeOf(state.reports, scope, String(state.me || '')), count = s => list.filter(t => t.status === s).length;
    $n('reportHint').textContent = list.length ? `共 ${list.length} 件：成功 ${count('成功')}、失敗 ${count('失敗')}、結束 ${count('結束')}／စုစုပေါင်း ${list.length} ခု (အောင်မြင်・မအောင်မြင်・ပြီးဆုံး)` : '';
    ul.innerHTML = list.map(t => `<li><span>${esc(t.name || '—')}${t.area ? '・' + esc(t.area) : ''}<br><small>${esc(catBi(t.cat || '試作'))}・${esc(cropText(t.item || '—'))}`
      + `・${esc(t.start || '?')}～${esc(t.end || '?')}${t.staff ? '・' + esc(t.staff) : ''}${t.reason ? '<br>失敗原因 မအောင်မြင်သည့် အကြောင်းရင်း：' + esc(t.reason) : ''}</small><br>`
      + (t.hasReport ? `<button type="button" class="btn2 small" data-rep="${esc(t.id)}">⬇ 下載報告（Word）／Word အစီရင်ခံစာ ဒေါင်းလုဒ်</button>`
        : `<small>${t.report === '產生失敗' ? '報告產生失敗，請告訴主管／အစီရင်ခံစာ ထုတ်မရပါ၊ မန်နေဂျာကို ပြောပါ' : '報告製作中，晚點再看／အစီရင်ခံစာ ပြင်ဆင်နေဆဲ၊ နောက်မှ ပြန်ကြည့်ပါ'}</small>`)
      + `</span><span class="pill ${REPORT_PILL[t.status] || 'wait'}">${esc(t.status)}</span></li>`).join('')
      || `<li class="empty">${scope === 'mine' ? '你負責的試作還沒有結束的／သင်တာဝန်ယူထားသော ပြီးဆုံးသည့် စမ်းသပ်မှု မရှိသေးပါ' : scope === 'others' ? '其他業務還沒有結束的試作／အခြား ဝန်ထမ်းများ၏ ပြီးဆုံးသည့် စမ်းသပ်မှု မရှိသေးပါ' : '還沒有結束的試作／ပြီးဆုံးသော စမ်းသပ်မှု မရှိသေး'}</li>`;
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
    // 0.4.75 董事長「種植進度做成進度條」：選到農民 → 進度卡最上面放種植進度條（盤商、種子商沒有）；100%＝該作物的生長天數（0.5.14 起主管在選單分頁填）
    const gb = $n('closeGrow'), f = list.find(x => x.id === cid);
    if (state.plEditCid && state.plEditCid !== cid) closePlantEdit(); // 換人：正在改的那份收起來
    if (cid && f && (f.type || '農民') === '農民') {
      gb.hidden = false;
      // 0.4.82 董事長「修改搬走」：還在種、自己負責、已上傳的農民 → 種植進度下面一顆「修改種植資料」，按了就地打開表單
      gb.innerHTML = growHtml((state.mineGrow || {})[cid] || growOf(f.plantDate, mmDay(0), cropDaysOf(f.crop, state.optsGrow)))
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
  // 第26任 抓BUG 手機組 3、5：進度卡會自動下載最近一次的照片 → ①同一張還在下載中又畫一次，原本會再送一次（共用同一個請求）
  //   ②下載過的一直留在記憶體（base64 整張），一天看幾十位舊手機會撐爆 → 最多留 FILE_CACHE_MAX 張，超過丟最早的
  const filePending = {}, FILE_CACHE_MAX = 30;
  function loadMyFile(cid, fileId, kind, scope) {
    const key = kind + ':' + fileId;
    if (fileCache[key]) return Promise.resolve(fileCache[key]);
    if (!filePending[key]) filePending[key] = loadMyFileOnce(cid, fileId, kind, scope, key).finally(() => { delete filePending[key]; });
    return filePending[key];
  }
  async function loadMyFileOnce(cid, fileId, kind, scope, key) {
    let r;
    // 0.4.75 田間打卡看別人負責的農民：帶 scope:'field'（後台農民任何業務都能讀；盤商、種子商照舊只限負責人）
    try { r = await gasCall(Object.assign({ action: 'myFile', cid, fileId, kind }, scope ? { scope } : {})); } catch (e) { r = null; }
    if (!r || !r.ok || !r.data) return { err: r && r.offline ? '要有網路／အင်တာနက် လိုသည်' : r && r.timeout ? '網路太慢，請再按一次／အင်တာနက် နှေးနေသည်၊ ထပ်နှိပ်ပါ' : (r && r.message) || '讀取失敗，請再按一次／ဖတ်ရှုမှု မအောင်မြင်ပါ၊ ထပ်နှိပ်ပါ' };
    const ks = Object.keys(fileCache); if (ks.length >= FILE_CACHE_MAX) delete fileCache[ks[0]]; // 物件的字串鍵照放入順序，第一個是最早的
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
  // 0.4.96（第12任，模擬業務發現③）：加「播種」（種下當週），第 7 天起才推發芽；後台 Code.gs 同一份
  const STAGE_GUESS = [[0, '播種'], [7, '發芽'], [14, '長大'], [45, '開花'], [70, '結果'], [100, '採收']];
  const STAGES = ['播種', '發芽', '長大', '開花', '結果', '採收', '採收後', '剖面圖']; // 時間軸順序；也是後台只收的 8 個值
  const STAGE_MY = { 播種: 'မျိုးစေ့ချ', 發芽: 'အညှောက်ထွက်', 長大: 'ကြီးထွား', 開花: 'ပန်းပွင့်', 結果: 'အသီးသီး', 採收: 'ရိတ်သိမ်း', 採收後: 'ရိတ်သိမ်းပြီး', 剖面圖: 'ဖြတ်ပိုင်းပုံ' };
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
  /** 第28任 保哥迴圈 R1-04：照片在那次拜訪原本是第幾張（後台有缺號才給 photoNos），對得上業務打字裡的「照片 N」 */
  const pno = (v, i) => ((v && v.photoNos) || [])[i] || i + 1;
  function growthTimelineHtml(visits, plantDate) {
    const by = {}; STAGES.forEach(s => { by[s] = []; });
    let noPd = 0, early = 0, badDay = 0; // 0.4.80 低3：沒有種植日期、拜訪早於種植日期，分開數
    // 0.4.81（0.4.80 巡檢低1）：拜訪日期也要有效，才算「早於種植日期」；壞掉的另外算「日期不明」
    const ymdValid = x => { const s = String(x || '').slice(0, 10); return /^\d{4}-\d\d-\d\d$/.test(s) && isFinite(Date.parse(s)); };
    (visits || []).slice().reverse().forEach(v => { // 後台新到舊 → 這裡由舊到新
      if (v.noMeet && !(v.photos || []).length) return; // 沒見到、沒照片的不算生長紀錄
      if (!v.text && !(v.photos || []).length && !v.closing && !v.closeHidden) return;
      // 0.4.99（第13任，0.4.98 審查 Word 中1、中2）：跟 Word「生長過程」同一套規則（Code.gs farmerReport_ 的 inGrowth）——
      //   待主管確認、被退回的結案不放（退回＝沒結案；待確認＝還沒審核，照片內容不露出），照樣列在下面田間報告；
      //   早於種植日期的拜訪（上一季）不放，只數筆數
      const cst = (v.closingDetail && v.closingDetail.state) || v.closeHidden || (v.closeRejected ? '已退回' : v.closePending ? '待確認' : '');
      if ((v.closing || v.closeHidden) && (cst === '待確認' || cst === '已退回')) return;
      if (ymdValid(plantDate) && ymdValid(v.time) && String(v.time).slice(0, 10) < String(plantDate).slice(0, 10)) { early++; return; }
      // 0.5.00（第13任，0.4.99 審查 Word 中4）：勾了種植失敗的結案＝沒收成，不當「採收」（後台 closeStage_ 也不回採收），改用推算
      let st = STAGES.indexOf(v.stage) >= 0 ? v.stage : v.closing && !v.plantFail ? '採收' : '', guessed = false;
      if (!st) { st = stageGuess(plantDate, v.time); guessed = !!st; }
      if (!st) { const pdOk = ymdValid(plantDate), vOk = ymdValid(v.time); if (pdOk && vOk) early++; else if (!pdOk) noPd++; else badDay++; return; }
      by[st].push({ v, guessed });
    });
    const short = t => { const s = String(t || ''); return s.length > 80 ? s.slice(0, 80) + '…' : s; };
    const li = STAGES.map(st => { const es = by[st];
      return `<li class="${es.length ? 'has' : ''}"><span class="gst">${st} <span class="my">${STAGE_MY[st]}</span></span>`
        + (es.length ? es.map(({ v, guessed }) => `<div class="gent"><b>${esc(String(v.time || '').slice(0, 10))}</b>${guessed ? '<small>（推算 ခန့်မှန်း）</small>' : ''}`
          + `${v.text ? '　' + esc(short(v.text)) : v.closing ? '　' + esc(short(v.closing)) : '' /* 第27任 董事長「生長過程由業務填寫緬文即可，不用翻成中文」：後台 myHistory_ 的 text 已是原文（抓BUG第7輪：改回用 text，typed 沒有錄音逐字稿） */}`
          + `${(v.photos || []).length ? `<div class="pgrid">${v.photos.map((id, i) => `<button type="button" class="btn2 small" data-hph="${esc(id)}">📷 照片 ${pno(v, i)}`
            + `／ဓာတ်ပုံ ${pno(v, i)}</button>`).join('')}</div>` : ''}</div>`).join('')
          : '<div class="gent"><small>還沒有照片／ဓာတ်ပုံ မရှိသေး</small></div>') + '</li>'; }).join('');
    return `<h3>生長過程／ကြီးထွားမှု အဆင့်ဆင့်</h3>${noPd ? `<p class="sub">有 ${noPd} 筆拜訪沒標階段、也沒有種植日期，無法推算／အဆင့်နှင့် စိုက်ရက် မပါသည့် မှတ်တမ်းများ ရှိ၍ မခန့်မှန်းနိုင်ပါ</p>` : ''}`
      + `${early ? `<p class="sub">有 ${early} 筆拜訪早於種植日期（上一季），不列在生長過程／စိုက်ရက်မတိုင်မီ (ယခင်ရာသီ) မှတ်တမ်းများ ရှိ၍ ကြီးထွားမှု အဆင့်ဆင့်တွင် မထည့်ပါ</p>` : ''}${badDay ? `<p class="sub">有 ${badDay}`
        + ` 筆拜訪日期不明，無法推算階段／ရက်စွဲ မသိသည့် မှတ်တမ်းများ ရှိ၍ အဆင့် မခန့်မှန်းနိုင်ပါ</p>` : ''}`
      + `<ol class="growtl">${li}</ol>`;
  }
  /* 0.4.77 董事長「種植資料要詳細列出結案的照片、文字、重量、之前田間報告」＋範例紙卡：結案區塊（照片排格子、量測卡一行一項） */
  const MEASURE_ROWS = [['variety', '品種', 'မျိုး'], ['sample', '樣本', 'နမူနာ'], ['weight', '總重量', 'အလေးချိန်'], ['length', '長度', 'အရှည်'], ['rows', '穗行數', 'အစေ့တန်း'],
    ['sowDate', '播種日', 'မျိုးချရက်'], ['harvestDate', '採收日', 'ရိတ်သိမ်းရက်'], ['days', '生長天數', 'စိုက်ပျိုးရက်']];
  /** 量測卡（像範例紙卡，一行一項；沒填的不列） */
  function measureCardHtml(m) {
    if (!m || typeof m !== 'object') return '';
    const has = x => x !== '' && x != null;
    const val = { variety: m.variety, sample: has(m.sampleCount) ? `${m.sampleCount} ${m.sampleUnit || ''}` : '',
      weight: has(m.weightKg) ? `${thou(m.weightKg)} kg${m.husk ? '（' + m.husk + '）' : ''}` : (m.husk || ''), length: has(m.length) ? `${m.length} ${m.lengthUnit || ''}` : '',
      rows: m.rows, sowDate: m.sowDate, harvestDate: m.harvestDate, days: has(m.days) ? `${m.days} 天／${m.days} ရက်` : '' };
    const li = MEASURE_ROWS.filter(([k]) => has(val[k])).map(([k, zh, my]) => `<li>${zh} <span class="my">${my}</span>：<b>${esc(String(val[k]).trim())}</b></li>`).join('');
    return li ? `<ul class="mcard">${li}</ul>` : '';
  }
  /** 0.4.81 董事長「結案通過主管審核過，才能在種植資料顯示」：結案那筆的審核狀態（closingDetail.state；舊後台沒有就看 closeRejected／closePending；空白＝不用審核） */
  const closeStateOf = v => {
    const d = v && v.closingDetail && typeof v.closingDetail === 'object' ? v.closingDetail : null;
    return (d && d.state) || (v && v.closeRejected ? '已退回' : v && v.closePending ? '待確認' : '');
  };
  /** 0.4.98（第13任 Word7）：千分位（跟後台 thou_ 同一規則：整數部分每三位加逗號；不是數字原樣回）；thouText：舊結案文字裡「價格 12000」「產量 1500」補千分位（同 Word 的做法） */
  const thou = n => { const s = String(n == null ? '' : n).trim(); return /^-?\d+(\.\d+)?$/.test(s) ? s.replace(/^(-?\d+)/, m => m.replace(/\B(?=(\d{3})+(?!\d))/g, ',')) : s; };
  const thouText = t => String(t || '').replace(/(價格|產量) (\d{4,}(?:\.\d+)?)/g, (m0, k, n) => k + ' ' + thou(n));
  /** 最近一筆結案：狀態、文字、價格、產量（重量）、收購客戶…、照片格子、量測卡。後台還沒給 closingDetail 時退回顯示結案那串文字 */
  function closeBlockHtml(v) {
    const d = v.closingDetail && typeof v.closingDetail === 'object' ? v.closingDetail : null;
    const pill = v.closeRejected || (d && d.state === '已退回') ? '<span class="pill late">主管已退回 ပြန်ပို့</span>' : v.closePending || (d && d.state === '待確認') ? '<span class="pill wait">待主管確認 စစ်ဆေးဆဲ</span>' : '<span class="pill ok">已結案 ပိတ်သိမ်းပြီး</span>';
    // 0.4.98（第13任 Word7）：價格、產量千分位；試作結果用後台跟 Word 同一套備援（trialText：結案沒帶就看這一季已結束的試作、以試作分頁為準）；舊後台沒給就照舊
    const rows = d ? [['賣給地區 ရောင်းသည့်ဒေသ', d.region], ['價格 ဈေးနှုန်း', d.priceText || (d.price !== '' && d.price != null ? `${thou(d.price)} ${d.priceUnit || ''}` : '')], ['產量（重量） အထွက်', d.yieldText || (d.yield !== '' && d.yield != null ? `${thou(d.yield)}`
      + ` ${d.yieldUnit || ''}` : '')],
      ['收購客戶 ဝယ်သူ', d.buyer], ['電話 ဖုန်း', d.phone], ['原因 အကြောင်းရင်း', d.reason], ['進度 တိုးတက်မှု', d.progress], ['試作結果 စမ်းသပ် ရလဒ်', d.trialText || d.trialOutcome || (d.trialResult && d.trialResult.outcome) || '']].filter(([, x]) => x !== '' && x != null) : [];
    return `<div class="vclose"><b>${esc(v.time || '')}</b> ${pill}${v.staff ? '｜' + esc(v.staff) : ''}`
      + (rows.length ? `<ul>${rows.map(([k, x]) => `<li>${k}：<b>${esc(String(x).trim())}</b></li>`).join('')}</ul>` : (v.closing ? `<p>${esc(thouText(v.closing))}</p>` : ''))
      + `${v.text ? `<p>${esc(v.text)}</p>` : ''}${v.typed && v.typed !== v.text ? `<p><small>打字原文 ရိုက်ထားသော မူရင်းစာ：${esc(v.typed)}</small></p>` : ''}`
      + `${v.plantFail ? `<p><span class="pill late">種植失敗 စိုက်ပျိုးမှု မအောင်မြင်</span> ${esc(v.plantFail)}</p>` : ''}`
      + `${(v.photos || []).length ? `<div class="pgrid">${v.photos.map((id, i) => `<button type="button" class="btn2 small" data-hph="${esc(id)}">📷 照片 ${pno(v, i)}`
        + `／ဓာတ်ပုံ ${pno(v, i)}</button>`).join('')}</div>` : ''}`
      + `${v.audio ? `<button type="button" class="btn2 small" data-hau="${esc(v.audio)}">🔊 錄音 အသံဖိုင်</button>` : ''}`
      + measureCardHtml(d && d.measure) + '</div>';
  }
  function histHtml(r, o) {
    const addr = [r.area, r.town, r.village].filter(Boolean).join('・');
    const head = o.showAddr ? `<p class="sub">${addr ? '📍 ' + esc(addr) : ''}${r.address ? `${addr ? '　' : '📍 '}${esc(r.address)}` : ''}${r.phone ? `　📞 ${esc(String(r.phone).replace(/^'/, ''))}` : ''}</p>` : '';
    const tl = o.oldFirst ? (r.trials || []).slice().reverse() : (r.trials || []); // 0.4.77 種植資料頁：由舊到新（從頭到尾）
    const trials = tl.map(t => `<li><span class="pill ${TRIAL_PILL[t.status] || 'wait'}">${esc(t.status || '—')}</span> <b>${esc(catBi(t.cat || '試作'))}</b>：${esc(cropText(t.item || '（未填品項）'))}`
      + `${t.crop ? '（' + esc(cropText(t.crop)) + '）' : ''}`
      + `<br><small>${esc(t.start || '?')}～${esc(t.end || (t.status === '進行中' ? '進行中 လုပ်ဆောင်ဆဲ' : '?'))}${t.yield !== '' ? `・產量 အထွက် ${esc(thou(t.yield))} ${esc(t.yieldUnit)}` : ''}${t.comment ? '・農民評價 သုံးသပ်ချက်：' + esc(t.comment) : ''}</small>`
      + `${t.reason ? `<br><small>失敗原因 မအောင်မြင်သည့် အကြောင်းရင်း：${esc(t.reason)}</small>` : ''}${t.conclusion ? `<br><small>結論 နိဂုံး：${esc(t.conclusion)}</small>` : ''}</li>`).join('');
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
      + `${v.text ? `<br>${esc(v.text)}` : ''}${v.typed && v.typed !== v.text ? `<br><small>打字原文 ရိုက်ထားသော မူရင်းစာ：${esc(v.typed)}</small>` : ''}${v.noMeet ? `<br><span class="pill wait">沒見到 မတွေ့ခဲ့</span> ${esc(v.noMeet)}` : ''}${v.prices ? `<br><small>價格 ဈေးနှုန်း：${esc(v.prices)}</small>` : ''}`
      + `${v.plantFail ? `<br><span class="pill late">種植失敗 စိုက်ပျိုးမှု မအောင်မြင်</span> ${esc(v.plantFail)}` : ''}${v.closing ? `<br><small>結案 ပိတ်သိမ်း：${esc(v.closing)}</small>` : ''}${v.closeHidden === '待確認' ? '<br><small>結案等主管審核／စစ်ဆေးဆဲ</small>' : ''}`
      // 0.4.81（第10任）：待確認那筆的照片、錄音也不列（跟後台 Word 一致：待確認不放照片）
      + (v.closeHidden === '待確認' ? '' : `${(v.photos || []).length || v.audio ? '<br>' : ''}${(v.photos || []).map((id, i) => `<button type="button" class="btn2 small" data-hph="${esc(id)}`
        + `">📷 照片 ${pno(v, i)}／ဓာတ်ပုံ ${pno(v, i)}</button>`).join(' ')}`
        + `${v.audio ? ` <button type="button" class="btn2 small" data-hau="${esc(v.audio)}">🔊 錄音 အသံဖိုင်</button>` : ''}`) + '</li>').join('');
    const closeTop = o.closeFirst ? `<h3>結案／ပိတ်သိမ်း</h3>${pendTop ? '<p class="sub">結案等主管審核，通過後才顯示內容／ပိတ်သိမ်းမှု မန်နေဂျာ အတည်ပြုပြီးမှ ပြမည်</p>' : cv ? closeBlockHtml(cv) : '<p class="sub">還沒結案／မပိတ်သိမ်းရသေး</p>'}` : '';
    // 0.4.81（2號後台對齊）：待確認那筆的照片不在生長過程露出（結案文字已藏，也不會被當成「採收」）
    const tlTop = o.timeline ? growthTimelineHtml(hid.length ? all.map(v => v.closeHidden === '待確認' ? Object.assign({}, v, { photos: [] }) : v) : all, o.plantDate) : ''; // 0.4.78 生長過程時間軸（種植資料、田間打卡、結案共用）
    const trialsHtml = (trials ? `<p class="sub">試作／推廣（成功、失敗）／စမ်းသပ်／မြှင့်တင် ရလဒ်（အောင်မြင်・မအောင်မြင်）：</p><ul>${trials}</ul>` : (o.showTrials ? '<p class="sub">沒有試作、推廣紀錄／စမ်းသပ်မှု မရှိ</p>' : '')); // 過去的試作（畫面叫對照）、推廣：成功還是失敗
    // 打卡畫面只放生長過程（上面的進度卡已經有完整紀錄，董事長 11/18 說不要重複），
    // 下面補回對照成敗，和之前拜訪的錄音（董事長 11/19「補回」）：只列有錄音的那幾筆，一行一個錄音鈕
    if (o.timelineOnly) {
      const pendingClose = v => v.closeHidden === '待確認' || (v.closing && closeStateOf(v) === '待確認');
      const withAudio = all.filter(v => v.audio && !pendingClose(v)); // 還在等主管確認的結案，錄音先不給聽
      const audioRow = v => `<li><b>${esc(v.time)}</b>｜${esc(histCatBi(v.cat))}${v.staff ? '｜' + esc(v.staff) : ''} `
        + `<button type="button" class="btn2 small" data-hau="${esc(v.audio)}">🔊 錄音 အသံဖိုင်</button></li>`;
      const audioHtml = withAudio.length ? `<h3>之前的錄音<span class="my">ယခင် အသံသွင်းချက်များ</span></h3><ul>${withAudio.map(audioRow).join('')}</ul>` : '';
      return tlTop + trialsHtml + audioHtml;
    }
    return `${tlTop}${closeTop}<h3>${o.closeFirst ? '之前的田間報告／ယခင် ကွင်းဆင်း အစီရင်ခံစာ' : '過往紀錄／ယခင် မှတ်တမ်း'}</h3>${head}`
      + trialsHtml
      + `<p class="sub">拜訪紀錄 共 ${r.total || 0} 筆${r.more ? '（只列最近 50 筆）' : ''}${o.oldFirst ? '，由舊到新' : ''}；照片、錄音按了才下載／ဓာတ်ပုံ၊ အသံ နှိပ်မှ ဒေါင်းမည်（စုစုပေါင်း မှတ်တမ်း）${r.more ? '（နောက်ဆုံး ၅၀ ခုသာ ပြထားသည်）' : ''}${o.oldFirst ? '၊ အဟောင်းမှ အသစ်သို့' : ''}：</p>`
      + (visits ? `<ul>${visits}</ul>` : '<p>還沒有拜訪紀錄／မှတ်တမ်း မရှိသေး</p>');
  }
  async function renderHistory(cid, el, opts) {
    const o = opts || {}, current = o.current || (() => true);
    if (!el || !el.id) return; // 舊頁面沒有這一塊
    if (!cid || cid === '__new') { el.hidden = true; el.innerHTML = ''; el._tok = null; return; }
    const f = (o.list || []).find(x => x.id === cid) || {};
    if (f.pending) {
      el._tok = null;
      el.hidden = false;
      el.innerHTML = '<p class="sub">剛新增、還沒上傳的客戶，上傳後才看得到過往紀錄／အသစ်ထည့်ပြီး မတင်ရသေးသော ဖောက်သည်သည် တင်ပြီးမှ ယခင် မှတ်တမ်း ကြည့်နိုင်မည်</p>';
      return;
    }
    const tok = {}; el._tok = tok;
    el.hidden = false; el.innerHTML = (o.timelineOnly ? '<h3>生長過程／ကြီးထွားမှု အဆင့်ဆင့်</h3>' : '<h3>過往紀錄／ယခင် မှတ်တမ်း</h3>') + '<p class="sub">讀取中…／ဖတ်နေသည်</p>';
    let r;
    try { r = await gasCall(Object.assign({ action: 'myHistory', cid }, o.scope ? { scope: o.scope } : {})); } catch (e) { r = { ok: false, message: '網路不穩，請再試一次／ထပ်ကြိုးစားပါ' }; }
    if (r && !r.ok && r.code === 'NOT_ALLOWED') r = { ok: false, message: '只能看自己負責的客戶／ကိုယ်တာဝန်ယူထားသော ဖောက်သည်သာ' }; // 0.4.75 舊後台不認得 scope：照實說，不當掉
    if (el._tok !== tok) return; // 讀的途中換了客戶，新的那次接手
    if (!current()) { el.hidden = true; el.innerHTML = ''; el._tok = null; return; }
    if (!r || !r.ok) {
      el.innerHTML = `${o.timelineOnly ? '<h3>生長過程／ကြီးထွားမှု အဆင့်ဆင့်</h3>' : '<h3>過往紀錄／ယခင် မှတ်တမ်း</h3>'}<p class="sub">${esc(r && r.offline ? '要有網路才看得到過往紀錄、照片、錄音／ယခင် မှတ်တမ်း၊ ဓာတ်ပုံ၊ အသံ ကြည့်ရန် အင်တာနက် လိုသည်' : (r && r.message) || '讀取失敗，請再試一次／ထပ်ကြိုးစားပါ')}</p>`;
      return;
    }
    el.innerHTML = histHtml(r, o.timeline ? Object.assign({}, o, { plantDate: f.plantDate }) : o); // 0.4.78 時間軸推算用種植日期
    el.querySelectorAll('[data-hph]').forEach(b => b.addEventListener('click', () => swapButtonForFile(b, cid, 'photo', o.scope)));
    el.querySelectorAll('[data-hau]').forEach(b => b.addEventListener('click', () => swapButtonForFile(b, cid, 'audio', o.scope)));
  }
  /**
   * 「📷 照片 N」「🔊 錄音」按鈕按下去：向後台下載那個檔，按鈕換成圖片或播放器。
   * 下載中按鈕先停用、字改「下載中…」；失敗就把按鈕還原，業務可以再按一次。
   * quiet＝true 時失敗不跳提示：自動載入用的，沒網路時才不會一打開畫面就一直跳。
   */
  async function swapButtonForFile(b, cid, kind, scope, quiet) {
    b.disabled = true;
    const label = b.textContent;
    b.textContent = '下載中…／ဒေါင်းနေသည်';
    const x = await loadMyFile(cid, kind === 'photo' ? b.dataset.hph : b.dataset.hau, kind, scope);
    if (x.err) {
      if (!quiet) toast(x.err);
      b.textContent = label; b.disabled = false;
      return;
    }
    if (kind === 'photo') {
      const img = document.createElement('img'); img.src = x.url; img.alt = label; img.className = 'hphoto';
      b.replaceWith(img);
    } else {
      const au = document.createElement('audio'); au.controls = true; au.src = x.url;
      b.replaceWith(au);
    }
  }

  /* ───── 0.4.72 董事長「執行任務清單：新增幾個一般農民、試作農民、推廣農民、盤商、種子商，詳細的要列出來」（1號）─────
     後台 home.newList＝本月自己新增的客戶（已分好類）；五格各幾位，點一格展開那一類的明細（名字、鎮・村・地區、新增日期），再點收起 */
  const NEW_GROUPS = [['一般農民', 'ပုံမှန် လယ်သမား'], ['試作農民', 'နှိုင်းယှဉ် လယ်သမား'], ['推廣農民', 'မြှင့်တင် လယ်သမား'], ['盤商', 'ကုန်သည်'], ['種子商', 'မျိုးစေ့ဆိုင်']];
  /** 0.4.82 執行任務清單這一頁的五類名稱（董事長截圖用字：一般農戶）；其他頁照舊叫一般農民 */
  const TODO_LABEL = g => g; // 0.4.92 低3（第11任第四輪）：原本這頁寫「一般農戶」、其他頁是「一般農民」→ 統一「一般農民」（只改顯示字）
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
    if (h && h.staleMonth) { box.innerHTML = ''; if (sum) sum.textContent = '這個月的資料要連上網路後才會更新／ဤလ အချက်အလက်သည် အင်တာနက် ချိတ်ပြီးမှ အပ်ဒိတ်ဖြစ်မည်'; return; } // 0.5.16 第1輪：存著的是上個月的
    if (!list) { // 還沒同步過，或後台還是舊版（只有總數）
      box.innerHTML = '';
      if (sum) sum.textContent = h ? `本月新增 ${h.newCustomers == null ? '—' : h.newCustomers} 位（明細要等後台更新）／ဤလ အသစ်ထည့် ဖောက်သည် (အသေးစိတ် ဆာဗာ အပ်ဒိတ် စောင့်ရမည်)` : '連上網路後會顯示／အင်တာနက်ချိတ်ပြီးမှ ပြမည်';
      return;
    }
    if (sum) sum.textContent = `本月新增共 ${list.length} 位／ဤလ ဖောက်သည်အသစ် ${list.length} ဦး`;
    // 0.4.87：每人一行（名字｜編號｜鎮・村・地區，「11/12 新增」放同一行最後的小灰字）；0 筆的分類合成一行
    box.innerHTML = tcGroupsHtml(NEW_GROUPS, g => list.filter(c => c.group === g).map(c => { const place = placeOf(c);
      return `<li><span><b>${esc(c.name || '（未命名）（အမည် မရှိသေး）')}</b>｜${esc(c.id || '')}${place ? '｜' + esc(place) : ''}<small>${esc(String(c.date || '').slice(5).replace('-', '/'))}`
        + ` 新增 အသစ်</small></span></li>`; }));
  }
  /** 0.4.82 左欄「我負責的客戶」：五類（分類同月分工作進度 mineGroupOf），列「名字｜客戶編號｜鎮・村」，點一位開那位的田間打卡（openFromList 鎖類別） */
  const TODO_GROUPS = [['一般農民', 'ပုံမှန် လယ်သမား'], ['試作農民', 'နှိုင်းယှဉ် လယ်သမား'], ['推廣農民', 'မြှင့်တင် လယ်သမား'], ['盤商', 'ကုန်သည်'], ['種子商', 'မျိုးစေ့ဆိုင်']];
  /** 0.5.26（客戶：盤商、種子商「已簽約顯示已簽約，沒簽約用紅字寫沒簽約」）：清單裡的盤商、種子商都還在往來（主管確認簽約後客戶就結束、不在清單）
   *  → 這支手機送過「已簽約」的標「簽約待主管確認」（橘字），其他標「沒簽約」（紅字）。第24任起以後台的 signWait 為準（主管退回的變回「沒簽約」） */
  function dealerSignTag(f) {
    if (!f || (f.type !== '盤商' && f.type !== '種子商')) return '';
    // 0.5.26 第24任：後台有帶 signWait（true／false）就以後台為準——手機已上傳的拜訪 7 天後會刪掉，原本只看手機紀錄，主管 7 天沒確認就變回「沒簽約」；
    //   主管退回的，後台回 false → 不再一直標待確認。手機紀錄只補後台還不知道的：還沒上傳、或上傳時間比這份後台資料（首頁 syncedAt，同一次寫入）晚的
    const srv = typeof f.signWait === 'boolean', at = Number(state.homeSyncedAt) || 0;
    // 抓BUG第1輪（小助手2）：後台拒收的拜訪（status rejected，格式錯等，永遠留在手機不重送）、客戶已被刪（missingCustomer，結案沒收）都不算送過簽約——
    //   原本 rejected 不是 uploaded → 一律當「後台還不知道」→ 永遠標「已簽約（待主管確認）」，連主管退回的紅字也被蓋掉
    const newer = v => v.status !== 'rejected' && !v.missingCustomer && (!srv || v.status !== 'uploaded' || !(Number(v.uploadedAt) < at));
    // 0.5.26 抓BUG 中2-B：後台沒收的（closingDropped，例如不是負責業務）不算送過簽約
    const sent = f.signWait === true || (state.myVisitList || []).some(v => v && !v.closingDropped && (v.farmerId === f.id || (f.tempId && v.farmerId === f.tempId)) && v.closing && typeof v.closing === 'object' && v.closing.outcome === '簽約' && newer(v));
    // 第24任（董事長「已簽約顯示已簽約，沒簽約用紅字寫沒簽約」）：字改「已簽約（待主管確認）」；主管確認後客戶結束、不在清單
    // 第24任：主管退回的簽約（後台 signRejected）寫出來，業務才知道要重談；手機有更新的簽約還沒被後台看到時照樣算待確認
    if (!sent && f.signRejected === true) return ' <span class="signtag no">沒簽約（主管退回簽約）／မချုပ်ရသေး (မန်နေဂျာ ပြန်ပို့)</span>';
    if (sent) return ' <span class="signtag wait">已簽約（待主管確認）／စာချုပ်ပြီး (စောင့်ဆဲ)</span>';
    if (f.signed === true) return ' <span class="signtag ok">已簽約／စာချုပ်ချုပ်ပြီး</span>'; // 第28任：主管確認過的簽約，店家照樣跟著業務、照樣在清單
    return ' <span class="signtag no">沒簽約／မချုပ်ရသေး</span>';
  }
  function renderTodoCust() {
    const box = document.getElementById('todoCust');
    if (!box) return; // 舊頁面沒有這一塊
    const all = state.mineAll || [], gOf = state.mineGroupOf || {};
    box.innerHTML = tcGroupsHtml(TODO_GROUPS, g => all.filter(f => gOf[f.id] === g).map(f => { const tv = [f.town, f.village].filter(Boolean).join('・'); // 0.4.87：0 筆的分類合成一行
      return `<li class="go" data-id="${esc(f.id)}" data-type="${esc(f.type || '農民')}" role="button" tabindex="0"><span><b>${esc(f.name || '（未命名）（အမည် မရှိသေး）')}`
        + `</b>｜${f.pending ? '（新，未上傳 အသစ်၊ မတင်ရသေး）' : esc(f.id)}${tv ? '｜' + esc(tv) : ''}${typeof dealerSignTag === 'function' ? dealerSignTag(f) : ''}</span></li>`; }));
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
      return `<li><span><b>${esc(c.name || '（未命名）（အမည် မရှိသေး）')}</b>${place ? '｜' + esc(place) : ''}<br><small>${esc(c.group || '')}・${esc(md(c.date))} 新增 အသစ်</small></span></li>`; }).join('')
      || '<li class="empty">這個月沒有新增客戶／ဖောက်သည်အသစ် မရှိ</li>';
    return (cur.trialList || []).map(t => `<li><span><b>${esc(t.name || '（未命名）（အမည် မရှိသေး）')}</b>｜${esc(catBi(t.cat === '推廣' ? '推廣' : '試作'))}<br>`
      + `<small>${t.kind === '完成' ? '完成 ပြီးဆုံး' : '開始 စတင်'}・${esc(md(t.date))}${t.item ? '｜' + esc(cropText(t.item)) : ''}${t.outcome ? '｜結果 ရလဒ်：' + esc(t.outcome) : ''}</small></span></li>`).join('')
      || '<li class="empty">這個月沒有開始或完成的試作、推廣／ဤလတွင် စတင် သို့မဟုတ် ပြီးဆုံးသော စမ်းသပ်・မြှင့်တင်မှု မရှိပါ</li>';
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
      tr.innerHTML = ['試作', '推廣'].map(c => `<span>${c} 開始 ${n(c, '開始')}／完成 ${n(c, '完成')}<span class="my">${{ 試作: 'စမ်းသပ်စိုက်ပျိုး', 推廣: 'မြှင့်တင်ရောင်းချ' }[c]}`
        + ` စတင် ${n(c, '開始')}／ပြီးဆုံး ${n(c, '完成')}</span></span>`).join('');
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
    const lv = latestVisitDay(x.lastVisit, [x.cid, x.tempId], state.myVisitList); // 0.4.84 低1：剛拜訪完、後台還沒更新也算
    // 0.4.92 中2：天數、最後拜訪加緬文（待校對）
    const when = left === null ? '' : left < 0 ? `<b class="vage r">已過採收日 ${Math.abs(left)} 天／ရိတ်သိမ်းရက် ${Math.abs(left)} ရက် ကျော်ပြီ</b>` : left === 0 ? '<b class="vage r">今天採收／ယနေ့ ရိတ်သိမ်း</b>' : `<b class="vage ${left <= 3 ? 'r' : 'y'}`
      + `">剩 ${left} 天／${left} ရက် ကျန်</b>`;
    return `<li data-cid="${esc(x.cid)}"><b>${esc(x.name || '（未命名）（အမည် မရှိသေး）')}</b>${x.crop ? '｜' + esc(cropText(x.crop)) : ''}<br>`
      + `<small>預計採收 ရိတ်သိမ်းမည့်ရက် ${esc(String(x.harvestDate || '').slice(5).replace('-', '/'))}</small>${when ? '・' + when : ''}<br>`
      + `<small>最後拜訪 နောက်ဆုံးသွားရက် ${lv ? esc(lv.slice(5).replace('-', '/')) : '還沒拜訪／မသွားရသေး'}</small></li>`;
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

  /* ───── 首頁：拆成三塊（第14任 2026-11-14 董事長「拆 renderHome」）─────
     ① 純計算／組 HTML（不碰畫面、不碰手機資料）：homeIsOldMonth、scheduleItems、scheduleHtml、planHtml、todoPlanHtml、pendingCounts、syncedText
     ② 讀手機資料：readHomeData
     ③ 畫面：renderSchedule、renderPlan、renderMonthStats、addPendingToStats
     renderHome 外層排隊（同一時間只畫一次）、內層只排順序；等待的先後和寫畫面的先後跟拆分前一樣 */

  /** ① 首頁資料是不是上個月的（月初還沒同步過）：上個月的目標、新增客戶不能當本月（0.5.16 第1輪 中） */
  function homeIsOldMonth(h, today) { return !!(h && h.month && String(today || '').slice(0, 7) && h.month !== String(today).slice(0, 7)); }
  /** ① 日程（後台排好的 7 天回訪）：逾期用手機的今天重算 */
  function scheduleItems(h, today) { return (h ? h.schedule : []).map(s => Object.assign({}, s, { late: s.due < today })); }
  /** ① 日程清單 HTML（距上次拜訪幾天合併這支手機的拜訪；快採收的人加標籤） */
  function scheduleHtml(list, h, today, farmers, myList) {
    const lastOf = {}; farmers.forEach(f => { lastOf[f.id] = latestVisitDay(f.lastVisit, [f.id, f.tempId], myList); }); // 0.4.82 日程那列加「距上次拜訪 N 天」；0.4.84 低1 合併這支手機的拜訪
    const soon = {}; ((h && Array.isArray(h.harvestSoon)) ? h.harvestSoon : []).forEach(x => { soon[x.cid] = true; }); // 0.4.82 日程裡快採收的人加標籤
    return list.map(s => `<li class="go" data-id="${esc(s.id)}" data-type="${esc(s.type)}"><span>${esc(s.name)}<br><small>${esc(MINE_TYPES[s.kind] ? s.kind + '／' + MINE_TYPES[s.kind] : catBi(s.type || '農民')) /* 0.5.12 低G：日程寫一般／試作／推廣農民（舊後台沒給 kind 照舊寫農民） */}`
      + `・應回訪 ပြန်သွားရန် ${esc(s.due.slice(5).replace('-', '/'))}</small><br>${visitAgeHtml(lastOf[s.id], today)}${soon[s.id] ? ' <span class="pill late">快採收 ရိတ်သိမ်းခါနီး</span>' : ''}`
      + `</span>${s.late ? '<span class="pill late">逾期 ရက်ကျော်</span>' : s.due === today ? '<span class="pill wait">今天 ယနေ့</span>' : ''}</li>`).join('')
      || `<li class="empty">${h ? '這 7 天沒有排到回訪／၇ ရက်အတွင်း သွားရန် မရှိ' : '連上網路後會顯示／အင်တာနက်ချိတ်ပြီးမှ ပြမည်'}</li>`;
  }
  /** ① 月計劃清單 HTML（只寫 done／target 和進度條；上個月的資料不當本月） */
  // 0520R4 I6（第19任）：那一天所在的週（週一開始）——首頁資料是哪一天的（h.today）跟手機今天不同週時，每週目標的數字是上週的
  const weekOf = d => {
    const p = String(d || '').slice(0, 10).split('-').map(Number);
    if (p.length < 3 || !(p[0] > 0)) return '';
    const t = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    t.setUTCDate(t.getUTCDate() - (t.getUTCDay() + 6) % 7);
    return t.toISOString().slice(0, 10);
  };
  function planHtml(h, homeOld, today) {
    const plan = homeOld ? [] : (h && h.plan) || [];
    const oldWeek = !!(today && h && h.today && weekOf(h.today) && weekOf(today) && weekOf(h.today) !== weekOf(today)); // 舊後台沒有 h.today：照舊
    const staleWeekly = p => oldWeek && p.period === '本週';
    const partsTxt = p => (p.parts ? '<br><small class="planparts">' + ['試作農民', '推廣農民', '一般農民'].map(k => `${esc(k.replace('農民', ''))} ${esc(String(p.parts[k] || 0))}`).join('・')
      + '<span class="my">' + [['試作農民', 'နှိုင်းယှဉ် လယ်သမား'], ['推廣農民', 'မြှင့်တင် လယ်သမား'], ['一般農民', 'ပုံမှန် လယ်သမား']].map(([k, my]) => `${my}`
      + ` ${esc(String(p.parts[k] || 0))}`).join('・') + '</span></small>' : '');
    return plan.map(p => staleWeekly(p) ? `<li class="plan"><span>${esc(p.label)}<br><small>${esc(p.period)}　連上網路後更新／အင်တာနက်ချိတ်ပြီးမှ ပြမည်</small></span><span class="pill wait">—</span></li>` : `<li class="plan"><span>${esc(p.label)}`
      + `<br><small>${esc(p.period)}　${p.done}／${p.target}</small>${partsTxt(p)}
      <span class="bar"><i style="width:${Math.max(0, Math.min(100, p.pct))}%"></i></span></span>${p.done >= p.target ? '<span class="pill ok">達成 ပြည့်မီ</span>' : `<span class="pill wait">${esc(String(p.done))}`
        + `／${esc(String(p.target))}</span>`}</li>`).join('') /* 0.4.82 董事長：不顯示 %，只留 done／target；進度條保留 */
      || `<li class="empty">${homeOld ? '這個月的目標要連上網路後才會更新／ဤလ ပစ်မှတ်သည် အင်တာနက် ချိတ်ပြီးမှ အပ်ဒိတ်ဖြစ်မည်' : h && h.plan ? '這個月沒有訂目標／ဤလ ပစ်မှတ် မရှိ' : '連上網路後會顯示／အင်တာနက်ချိတ်ပြီးမှ ပြမည်'}</li>`; // 舊版留下的首頁資料沒有計劃欄，不能說成沒有目標（第五輪自抓）
  }
  /** ① 執行任務清單右欄「我的進度」：本月拜訪次數＋新增客戶 */
  function todoPlanHtml(h, homeOld) {
    return (h && !homeOld ? `<li class="plan"><span>本月拜訪 ${esc(String(h.monthVisits == null ? '—' : h.monthVisits))} 次・新增客戶 ${esc(String(h.newCustomers == null ? '—' : h.newCustomers))}`
      + ` 位<br><small>ဤလ သွားရောက်မှု・ဖောက်သည်အသစ်</small></span></li>` : '') + $('planList').innerHTML;
  }
  /**
   * ① 這支手機還沒上傳的拜訪，要加到本月數字上的量（0.4.94 低1；0.4.95、0.4.97 手機 3）：
   *   pend＝這個月、而且正在看的是這個月才算；newN＝新客戶（後台已建好正式客戶的臨時編號不算）；custN＝這個月後台還沒算到的客戶；allPending＝全部未上傳（總拜訪不分月份）
   */
  function pendingCounts(myList, farmers, today, cur) {
    const thisMonth = String(today || '').slice(0, 7);
    const pendAll = (myList || []).filter(v => v && v.status === 'pending' && mmDay(0, v.deviceTime).slice(0, 7) === thisMonth);
    const pend = (cur && cur.month && cur.month !== thisMonth) ? [] : pendAll;
    const lvOf = {}, srvTmp = new Set(); farmers.forEach(f => { lvOf[f.id] = String(f.lastVisit || ''); if (f.tempId) { lvOf[f.tempId] = lvOf[f.id]; srvTmp.add(f.tempId); } });
    const newN = new Set(pend.filter(v => /^T_/.test(String(v.farmerId || '')) && !srvTmp.has(v.farmerId)).map(v => v.farmerId)).size;
    const custN = new Set(pend.filter(v => v.farmerId && (lvOf[v.farmerId] || '').slice(0, 7) !== thisMonth).map(v => v.farmerId)).size;
    return { pend, newN, custN, allPending: (myList || []).filter(v => v && v.status === 'pending').length };
  }
  /** ① 首頁「幾點更新」：緬甸時間（UTC+6:30），手機時區不是緬甸也不會差（0.5.16 第1輪 低） */
  function syncedText(syncedAt) {
    const d = new Date(Number(new Date(syncedAt)) + 390 * 60000);
    return `（${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} 更新 အပ်ဒိတ်）`;
  }

  /** ② 首頁要的手機資料：首頁資料、這支手機自己的拜訪（算最後拜訪日）、校正過的今天（phoneToday 會設 state.clockOff） */
  async function readHomeData() {
    const h = (await Store.getMeta('home')) || null;
    state.myVisitList = await myVisits(); // 0.4.84 低1：這支手機自己帳號的拜訪，算最後拜訪日用（下拉、快採收、日程、量測週都用 latestVisitDay）
    const today = await phoneToday(h); // 0.4.87 低3：先校正手機時間，再畫快採收
    state.homeSyncedAt = h && h.syncedAt ? Number(h.syncedAt) || 0 : 0; // 0.5.26 第24任：簽約標示判斷「後台資料比這筆上傳舊」用（同 farmers 一次寫入）
    return { h, today };
  }

  /** ③ 日程清單：畫出來、點了直接進打卡畫面（類別先算好、鎖死） */
  function renderSchedule(list, h, today, farmers) {
    $('scheduleList').innerHTML = scheduleHtml(list, h, today, farmers, state.myVisitList);
    $('scheduleList').querySelectorAll('li.go').forEach(li => li.addEventListener('click', () => {
      openFromList(li.dataset.id, li.dataset.type); // 0.4.63 從清單進來也鎖死類別（先算好是一般／試作／推廣）
    }));
  }
  /** ③ 月計劃、執行任務右欄 */
  function renderPlan(h, homeOld, today) {
    $('planList').innerHTML = planHtml(h, homeOld, today); // 0520R4 I6：帶手機今天，分得出每週目標是不是上週的
    const tp = document.getElementById('todoPlan');
    if (tp) tp.innerHTML = todoPlanHtml(h, homeOld);
  }
  /** ③ 工作進度（最近 3 個月可以切換）與最上面一排數字；回傳正在看的那個月 */
  function renderMonthStats(h, today) {
    // 工作進度：最近 3 個月可以切換
    // 0.5.20 G5（第19任）：換月後還沒同步（手機存的首頁資料最新是上個月）→ 前面補一顆「本月」（stale：後台還沒有本月數字，各格用「—」），
    //   首頁就會停在本月，這個月還沒上傳的拜訪照樣加上去、顯示「含 N 筆未上傳」；同步拿到本月後就換成後台的數字
    const hist0 = (h && h.history) || [], thisM = String(today || '').slice(0, 7);
    const hist = thisM && hist0.length && String(hist0[0].month) < thisM ? [{ month: thisM, stale: true }].concat(hist0) : hist0;
    // 0.5.20 E1（第19任）：換月後同步拿到新月份，上個月仍在清單裡 → 原本一直停在上個月（未上傳筆數也不顯示）。
    //   記下「上次畫的時候最新的是哪個月」：最新月份變了就跳到最新月；同一批資料裡業務自己點的月份照舊保留
    const top = hist.length ? hist[0].month : '';
    if (top !== state.homeTop) { if (state.homeTop != null) state.homeMonth = top; state.homeTop = top; } // 第一次畫（還沒記過）不改，照原本規則
    if (!hist.some(x => x.month === state.homeMonth)) state.homeMonth = top;
    $('monthChips').innerHTML = hist.map(x => `<button type="button" class="chip" data-m="${esc(x.month)}" aria-pressed="${x.month === state.homeMonth}">${Number(x.month.slice(5))} 月／လ</button>`).join('');
    $('monthChips').querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => { state.homeMonth = b.dataset.m; renderHome(); }));
    const cur = hist.find(x => x.month === state.homeMonth), stale = !!(cur && cur.stale);
    $('statVisits').textContent = stale ? '—' : cur ? cur.visits : (h ? h.monthVisits : '—');
    // 0.4.69 最上面一排：本月拜訪（不跟著月份切換）
    // 0.4.97（第12任 BUG 審查手機 2）：存著的首頁資料是上個月的（月初還沒同步過）→ 不能把上個月的數字當本月（0.4.95 起還會再加這個月未上傳的）→ 底數用「—」
    renderCaseStats(h && h.caseStats); // 0.5.04 最上面 6 格
    $n('msVisits').textContent = h && h.totalVisits != null ? String(h.totalVisits) : '—'; // 0.5.04 董事長「本月拜訪改總拜訪」：後台給的全部拜訪次數（舊後台沒有就「—」）；hThisMonth 不再用在這格
    $('statNew').textContent = stale ? '—' : cur ? cur.newCustomers : (h ? h.newCustomers : '—');
    $('statCust').textContent = stale ? '—' : cur ? cur.customersVisited : '—';
    $('statTrials').textContent = !stale && cur ? `${cur.trialsStarted}／${cur.trialsEnded}` : '—';
    renderMonthDetail(stale ? null : cur); // 0.4.82 新增客戶、試作兩格的分類和明細（舊後台沒有明細就照舊）
    // 0.5.16 第2輪 中：兩次重畫交錯（連點月份、返回、同步通知）時，後面 plus 讀畫面上的數字會把未上傳筆數加兩次 → 寫底數時另外記一份，plus 從記下的底數加
    ['statVisits', 'msVisits', 'statNew', 'statCust'].forEach(id => { const e = $n(id); if (e && e.dataset) e.dataset.base = e.textContent; });
    const bc = stale ? {} : cur ? cur.byCategory : (h && h.byCategory) || {};
    $('statByCat').textContent = Object.keys(bc || {}).length ? '類別 အမျိုးအစား：' + Object.entries(bc).map(([k, n]) => `${catBi(k)} ${n} 次 ကြိမ်`).join('、') : '';
    return cur;
  }
  /** ③ 把還沒上傳的拜訪加到數字上（從記下的底數加，兩次重畫交錯也不會加兩次），寫「含 N 筆未上傳」 */
  function addPendingToStats(c) {
    const pend = c.pend;
    const plus = (el, n) => {
      if (!el || !n) return;
      const raw = el.dataset && el.dataset.base != null ? String(el.dataset.base) : String(el.textContent);
      const base = Number(raw);
      el.textContent = String((isFinite(base) && raw.trim() !== '' ? base : 0) + n);
    }; // 0.5.16：從記下的底數加
    plus($n('statVisits'), pend.length); plus($n('msVisits'), c.allPending); /* 0.5.04 總拜訪：還沒上傳的不分月份都加 */ plus($n('statNew'), c.newN); plus($n('statCust'), c.custN);
    const pn = $n('homePendNote'); pn.hidden = !pend.length;
    pn.textContent = pend.length ? `含 ${pend.length} 筆還沒上傳的拜訪（上傳後主管那邊才看得到）／မတင်ရသေးသော ${pend.length} ခု ပါဝင်သည် (တင်ပြီးမှ မန်နေဂျာ ဘက်တွင် မြင်ရမည်)` : '';
  }

  async function renderHome(inner) {
    // 第24任 第六批：首頁重畫（開首頁、同步完成）時看總開關、環境（原本掛在 showHome，但同步完只呼叫 renderHome，瀏覽器流程抓到）
    if (inner !== HOME_INNER) {
      // 第26任：這三件原本失敗就默默不見（例如「主管退回的結案」畫不出來，業務不知道有東西要補）→ 記下來
      const bgErr = where => e => { if (typeof noteErr === 'function') noteErr(where, e); };
      if (typeof FarmLock === 'object' && FarmLock.refresh) FarmLock.refresh(lockHooks()).catch(bgErr('解鎖總開關')); // 第24任 第六批：總開關（同步到「關」就自動解開）
      if (typeof paintEnvFoot === 'function') paintEnvFoot().catch(bgErr('環境標示')); // 第24任 第六批⑳
      if (typeof paintRejected === 'function') paintRejected().catch(bgErr('主管退回的結案')); // 第24任 第七批 C：主管退回的結案
    }
    // R13-03（GPT 中）：同一時間只跑一次首頁重畫——正在畫時又被叫（連點月份、返回、同步通知），記「畫完再畫一次」，畫完照最新狀態重畫一次；
    // 不會再有較舊的重畫在等待後蓋掉較新的（R12-02 的序號只在後段檢查，前段日程、目標仍可能被舊的蓋掉）
    // R14-03（GPT 中）：外層排隊、內層（inner＝HOME_INNER）才真的畫。所有呼叫拿到同一個「整段排隊」的承諾——包含自己要求的補畫，
    // 補畫畫完才算完成；最後一次重畫出錯時，所有等待者都收到那個錯誤（前面幾次的錯誤被後面成功的重畫取代）
    if (inner !== HOME_INNER) {
      if (state.homeBusy) { state.homeAgain = true; return state.homeBusy; }
      state.homeBusy = (async () => {
        let err = null;
        do { state.homeAgain = false; err = null; try { await renderHome(HOME_INNER); } catch (e) { err = e; } } while (state.homeAgain);
        state.homeBusy = null; // 跟上一行的檢查之間沒有等待：之後才來的呼叫會開新的一段，不會被漏掉
        if (err) throw err;
      })();
      return state.homeBusy;
    }
    {
    // R12-02（GPT 中）：每次重畫拿一個序號；等待後發現有更新的重畫就收手（序列化後仍保留當第二道保險）
    const gen = state.homeGen = (state.homeGen || 0) + 1;
    const { h, today } = await readHomeData();
    await renderHarvest(h); // 0.4.82 快採收提醒條
    renderSchedule(scheduleItems(h, today), h, today, (await Store.getMeta('farmers')) || []);
    await renderTasks();
    await renderMyTrials(h);
    await fillCloseFarmers();
    renderTodoCust(); // 0.4.82 執行任務清單左欄：五類自己負責的客戶
    fillPlantFarmers(); // 0.4.59 種植資料分頁共用同一份「自己負責的農民」
    renderReports(); // 0.4.61 試作報告：按過「看試作報告」才有清單，首頁重畫時照舊顯示
    const homeOld = homeIsOldMonth(h, today);
    renderPlan(h, homeOld, today);
    renderNewCust(homeOld ? { staleMonth: true } : h); // 0.4.72（1號）本月新增客戶五類＋明細；0.5.16 上個月的資料不當本月
    if (gen !== state.homeGen) return; // R12-02：上面等待途中已經有更新的重畫
    const cur = renderMonthStats(h, today); // 0.5.20 G5：帶校正過的今天
    const farmers = (await Store.getMeta('farmers')) || [];
    if (gen !== state.homeGen) return; // R12-02：讀客戶清單途中切了月份（更新的重畫已畫好），不加到別的月份
    addPendingToStats(pendingCounts(state.myVisitList, farmers, today, cur));
    if (h && h.syncedAt) $('homeSynced').textContent = syncedText(h.syncedAt);
    }
  }
  const HOME_INNER = {}; // R14-03：renderHome 內層的記號（外層排隊才用它呼叫內層）

  /** 我的試作：伺服器給的進行中試作（只取負責業務是自己的）＋這支手機開了還沒上傳的；這支手機結束的不顯示。
      都是手機裡存的資料，離線也看得到（2026-11-12 董事長同意介面規劃 D） */
  async function renderMyTrials(h) {
    const cfg = await getConfig();
    const me = cfg ? String(cfg.name || '') : '';
    const server = (await Store.getMeta('trials')) || [];
    const local = (await myLocal('localTrials')) || [];
    const ended = new Set(local.filter(l => l.ended).map(l => l.id));
    // 手機記的「已結束」可能是臨時編號（離線開始又結束、只有開始傳上去）：伺服器的試作要連臨時編號一起比（第二輪自行審查 T3）
    // 0.5.16 第1輪 高：新客戶的臨時編號已換成正式編號（後台客戶帶 tempId）時，本機試作還記臨時編號 → 換成正式編號；後台試作的 temps 有這筆就不重複列
    const realOf = {}; ((await Store.getMeta('farmers')) || []).forEach(f => { if (f && f.tempId && f.id) realOf[f.tempId] = f.id; });
    const list = server.filter(t => me && t.staff === me && !ended.has(t.id) && !(t.temps || []).some(x => ended.has(x)))
      .concat(local.filter(l => !l.ended && l.cid && !server.some(t => t.id === l.id || (t.temps || []).indexOf(l.id) >= 0))
        .map(l => (realOf[l.cid] ? Object.assign({}, l, { cid: realOf[l.cid] }) : l)));
    const people = ((await Store.getMeta('farmers')) || []).concat((await myLocal('localCustomers')) || []);
    const nameOf = cid => (people.find(f => f.id === cid) || {}).name || cid;
    const today = await phoneToday(h);
    const isDay = s => /^\d{4}-\d\d-\d\d/.test(String(s || ''));
    const dayDiff = (a, b) => Math.round((Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / 86400000);
    // 最後拜訪日：伺服器的＋這支手機自己存的拜訪（還沒同步的也算，剛量完不會還叫你去量）
    const mine = state.myVisitList || await myVisits(); // 低#6（第8任）：只算目前帳號的；0.4.98（第13任 手機9）：只有 renderHome 呼叫，它剛讀過（state.myVisitList），不再整份重讀一次（含沒上傳的照片錄音）
    const lastOf = cid => { const p0 = people.find(f => f.id === cid) || {}; return latestVisitDay(p0.lastVisit, [cid, p0.tempId], mine); }; // 0.4.91 低2：連臨時編號一起比 // 0.4.84 改用共用的 latestVisitDay（同一套：後台與這支手機取較新）
    /** 量測週：開始後第 2、4、8 週（boss.js 有同一組數字，要改兩邊一起改；2026-11-12 優化 4） */
    const measure = t => {
      if (!isDay(t.start)) return null;
      const w = [2, 4, 8].filter(x => dayDiff(t.start, today) >= x * 7).pop();
      if (!w) return null;
      const due = new Date(Date.parse(String(t.start).slice(0, 10)) + (w * 7 - 3) * 86400000).toISOString().slice(0, 10);
      const lv = lastOf(t.cid);
      return !lv || lv < due ? w : null;
    };
    // 0.5.01 董事長：結案已送、等主管確認 → 這件顯示「結案待確認」，不算進行中、不提醒量測（後台 held；這支手機還沒上傳的結案也算；退回後後台不再標 held，自動回到進行中）
    const localClose = new Set(mine.filter(v => v && v.closing && v.status === 'pending' && v.farmerId).map(v => realOf[v.farmerId] || v.farmerId)); // 0.5.16：臨時編號換正式編號
    const heldOf = t => !!t.held || localClose.has(t.cid);
    // R23-06（GPT）：後台讀不到結案分頁時 held 是 null（不知道有沒有在等確認）→ 顯示「結案狀態未知」，不提醒量測、不算進行中
    const unknownOf = t => !heldOf(t) && t.held === null;
    // 0.5.16 第2輪 低：點進去開哪一類照客戶的類型欄（打卡選單照類型欄分開）；類型欄跟試作類別對不上（主管手改試算表）時，用試作類別會「找不到這位客戶」
    const openCat = t => { const p = people.find(f => f.id === t.cid) || {}; const kc = KIND_CAT[p.kind]; return kc === '試作' || kc === '推廣' ? kc : (t.cat || '試作'); };
    // 第26任 2026-11-18 董事長截圖「改成 進度天數／預計收成天數」「品種」：右邊原本「第 N 週」（從試作開始日算）→ 改成種植進度（種植日期算到今天／作物生長天數，
    //   跟打卡進度條同一套 growOf、growLabel）；作物後面接代碼。量測提醒（從試作開始日算）第27任起寫「試作第 N 天該量測」
    const optsG = (await Store.getMeta('options')) || state.options || {};
    const personOf = cid => people.find(f => f.id === cid) || {};
    // 抓BUG 手機組 4B：手機客戶清單裡沒有這位（舊快取、改派別人）→ 原本寫「未填種植日期」像業務漏填；查不到人就不放標籤
    const growPill = t => {
      if (!people.some(f => f.id === t.cid)) return '';
      const p = personOf(t.cid), g = growOf(p.plantDate, today, cropDaysOf(p.crop || t.item, optsG)), [zh, my] = growLines(g);
      return `<span class="pill wait gpill"><span class="gz">${keepWords(String(zh).replace(/／/g, '／|').replace(/（/g, '|（'))}</span><br><span class="gm">${keepWords(String(my).replace(/ /g, ' |'))}</span></span>`;
    };
    // 抓BUG 手機組 2：標籤窄時要能換行，但瀏覽器會把緬文從字中間斷開（CSS keep-all 擋不住緬文）→ 每一段包成不准斷，只在段跟段之間換行（中文在「／」後、「（」前；緬文在空格）。
    //   用「|」當切點（標籤字裡不會有），不用正規式往回看（舊 iPhone Safari 不支援，整支程式會壞）
    function keepWords(s) { return String(s).split('|').filter(Boolean).map(w => `<span class="gnw">${esc(w)}</span>`).join('<wbr>'); }
    $('trialList').innerHTML = list.map(t => {
      const held = heldOf(t), unk = unknownOf(t), m = held || unk ? null : measure(t), code = String(personOf(t.cid).varCode || '').trim();
      return `<li class="go" data-cid="${esc(t.cid)}" data-cat="${esc(openCat(t))}"><span>${esc(nameOf(t.cid))}<br><small>${esc(catBi(t.cat || '試作'))}・${esc(cropText(t.item || '—'))}`
        + `${code ? '・' + esc(code) : ''}${t.pending ? '（未上傳）မတင်ရသေး' : ''}</small></span>${held ? '<span class="pill wait">結案待確認<br>ပိတ်သိမ်းရန် စစ်ဆေးဆဲ</span>' : unk ? '<span class="pill wait">結案狀態未知，請洽主管<br>ပိတ်သိမ်းမှု အခြေအနေ မသိ</span>' : m ? `<span class="pill late">試作第 ${m * 7} 天該量測</span>` /* 第27任：週改天（同主管頁；緬文待譯 E2） */ : growPill(t)}</li>`;
    }).join('')
      || `<li class="empty">${h ? '目前沒有進行中的試作／လုပ်ဆောင်ဆဲ စမ်းသပ်ကွက် မရှိ' : '連上網路後會顯示／အင်တာနက်ချိတ်ပြီးမှ ပြမည်'}</li>`;
    $('trialList').querySelectorAll('li.go').forEach(li => li.addEventListener('click', () => { state.lockNext = true; openVisit(li.dataset.cat === '推廣' ? '推廣' : '試作', li.dataset.cid); })); // 0.4.63 鎖死
    const ms = $('msTrials'); if (ms) ms.textContent = String(list.filter(t => !heldOf(t) && !unknownOf(t)).length); // 0.4.69 最上面一排：進行中試作（舊頁面沒有這格就不畫）；0.5.01 結案待確認的不算
  }

  /**
   * 手機的「今天」（緬甸日期）：手機時間＋伺服器校正值換成緬甸時間（UTC+6:30）。
   * 原本用上次同步時伺服器給的日期，離線幾天後週數、該量測、逾期都不會往前走（第二輪自行審查 T9）。
   * 從來沒同步過（沒有校正值）才用伺服器給的日期
   */
  async function phoneToday(h) {
    const off = await Store.getMeta('clockOffset');
    if (typeof off === 'number') state.clockOff = off; // 業務BUG#4：給同步用的 mmDay 用
    // 0.4.91 低3：沒有時間校正值時，原本用後台上次給的 h.today（可能是好幾天前的舊日期），其他地方（mmDay）卻用手機時間 → 改成一律手機時間（緬甸），兩邊一致
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
    // 0.5.25 T5：記下這份清單是誰登入時畫的（toggleTask 比對）；讀不到設定就不記（不擋）
    if (typeof state !== 'undefined') { try { const c = await getConfig(); state.tasksAcct = c && c.deviceKey && c.account ? String(c.account) : ''; } catch (e) { state.tasksAcct = null; } } // 抽函式跑的舊測試沒有 state；0525R2（GPT 0525R1-3）：讀不到記 null＝「不知道是誰的」，toggleTask 會擋
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
      ? new Set(farmers.concat((await myLocal('localCustomers')) || []).map(f => f.id)) : null;
    const closed = t => !!(known && t.cid && !known.has(t.cid));
    // 0.4.25（第5任獨立審查 低2）：任務的客戶是盤商或種子商時，用對應的類別打開，不然選單只列農民、找不到人
    const all = (farmers || []).concat((await myLocal('localCustomers')) || []);
    const catOf = cid => { const ty = (all.find(f => f.id === cid) || {}).type; return ty === '盤商' || ty === '種子商' ? ty : '農戶'; };
    const row = (t, isDone) => {
      const wait = !isDone && ticked.has(t.id);
      const busy = wait && sending.has(t.id); // 送出中：請求已經在路上，不能取消（R6-05）
      return `<li class="task${isDone || wait ? ' done' : ''}"><label><input type="checkbox" data-task="${esc(t.id)}"${isDone || wait ? ' checked' : ''}${isDone || busy ? ' disabled' : ''}>
        <span>${t.cid ? `<b>${esc(t.name)}</b>：` : '' /* 第28任：沒綁農民的一般任務只寫內容 */}${esc(t.text)} ${isDone ? '<span class="pill ok">已完成 ပြီးပြီ</span>' : wait ? '<span class="pill wait">已打勾 ခြစ်ပြီး</span>' : '<span class="pill late">還沒做 မလုပ်ရသေး</span>'}`
          + `<br><small>${isDone ? '已完成 ပြီးပြီ ' + esc(String(t.doneAt || '').slice(5, 16)) + '<br>' : busy && unconf.has(t.id) ? '已送出，等連上網路確認（不能取消）／ပို့ပြီး၊ အင်တာနက်ချိတ်ပြီး အတည်ပြုချက် စောင့်နေ (ပယ်ဖျက်၍ မရ)<br>' : busy ? '送出中…（送出後就不能取消）／ပို့နေသည် (ပို့ပြီးလျှင် ပယ်ဖျက်၍ မရ)<br>' : wait ? '已打勾，有網路會自動送出（再按一下可取消）／အမှန်ခြစ်ပြီး၊ အင်တာနက်ရလျှင် အလိုအလျောက် ပို့မည် (ထပ်နှိပ်လျှင် ပယ်ဖျက်)<br>' : ''}`
          + `${esc(t.by || '主管 မန်နေဂျာ') + ' 派 ပေးသည်・' + esc(String(t.at || '').slice(0, 16).replace('T', ' '))}</small></span></label>
        ${isDone ? '' : closed(t) ? '<small class="taskclosed">找不到這位客戶（可能已結案）：做完直接打勾，不用做請主管取消／ဤဖောက်သည် မတွေ့ပါ (ပိတ်သိမ်းပြီး ဖြစ်နိုင်) - ပြီးလျှင် တိုက်ရိုက် အမှန်ခြစ်ပါ၊ မလုပ်ရလျှင် မန်နေဂျာကို ပယ်ဖျက်ခိုင်းပါ</small>' : !t.cid ? '' /* 第28任：一般任務沒有要去拜訪的農民，不放「去拜訪」 */ : `<button type="button" class="btn2 small" data-taskgo="${esc(t.cid)}`
          + `">去拜訪<br>သွားမည်</button>`}</li>`;
    };
    // 0.4.63 董事長：一邊看主管派的任務、一邊看自己的進度 → 上面一行總結＋進度條
    const sum = document.getElementById('taskSummary');
    if (sum) {
      const waitN = open.filter(t => ticked.has(t.id)).length, all0 = open.length + done.length;
      const pct = all0 ? Math.round(done.length / all0 * 100) : 0;
      sum.hidden = !all0;
      // 2號 0.4.63 低#10：後台只回「沒做完＋近 7 天做完」的任務，不是全部 → 字寫清楚，不說成「派了 N 條」
      sum.innerHTML = all0 ? `沒做完＋近 7 天做完的共 <b>${all0}</b> 條：已完成 <b>${done.length}</b>、已打勾等送出 <b>${waitN}</b>、還沒做 <b>${open.length - waitN}</b>／ပြီး ${done.length}`
        + `・ပို့ရန် စောင့်နေ・မလုပ်ရသေး ${open.length - waitN}<span class="bar"><i style="width:${pct}%"></i></span>` : '';
    }
    // 0.5.13 董事長「歷史成就保持做完的，還沒做完的在執行任務」：新頁面有 taskDoneList → 做完的放歷史成就、這裡只列沒做完的；舊頁面照舊合在一起
    const doneUl = document.getElementById('taskDoneList');
    const hasHome = !!(await Store.getMeta('home')); // 0.5.16 第1輪 低：從沒同步過時寫「連上網路後會顯示」，不說成沒做完
    if (doneUl) doneUl.innerHTML = done.map(t => row(t, true)).join('') || `<li class="empty">${hasHome ? '近 7 天還沒有做完的任務／၇ ရက်အတွင်း ပြီးဆုံးသော လုပ်ငန်း မရှိသေးပါ' : '連上網路後會顯示／အင်တာနက်ချိတ်ပြီးမှ ပြမည်'}</li>`;
    $('taskList').innerHTML = open.map(t => row(t, false)).join('') + (doneUl ? '' : done.map(t => row(t, true)).join(''))
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
      <span class="meta">${esc(t.by || '主管 မန်နေဂျာ')} 派 ပေးသည်・${esc(String(t.at || '').slice(0, 16).replace('T', ' '))}</span></li>`).join('')
      || '<li class="empty">目前沒有派給你的任務／ပေးထားသော အလုပ် မရှိ</li>';
  }
  async function toggleTask(id, on) {
    const cfg = await getConfig();
    // 0.5.25 T5（第21任抓BUG）：畫面上的任務清單是 renderTasks 當時登入的人的；另一個分頁登出或換人後再勾 →
    //   不記（原本會記在現在的人或空帳號名下，送出後被後台當成別人的任務刪掉、沒有提示），重畫清單
    const nowAcct = cfg && cfg.deviceKey && cfg.account ? String(cfg.account) : '';
    // 0525R2（第22任，GPT 0525R1-3 中）：畫清單時讀不到帳號（null＝不知道這份清單是誰的）→ 也不記，重畫後再勾
    if (on && (!nowAcct || state.tasksAcct === null || (typeof state.tasksAcct === 'string' && state.tasksAcct !== nowAcct))) {
      toast(!nowAcct ? '已經登出，這次沒有打勾，請重新登入／ထွက်ပြီးဖြစ်၍ ယခု အမှန်မခြစ်ရသေးပါ၊ ပြန်ဝင်ပါ'
        : state.tasksAcct === null ? '讀不到這份任務清單是誰的，已重新整理，請再勾一次／ဤလုပ်ငန်းစာရင်း မည်သူ့ဟာမှန်း ဖတ်မရ၍ ပြန်ဖွင့်ပေးပြီးပါပြီ၊ ထပ်ခြစ်ပါ'
          : '這份任務清單是「' + state.tasksAcct + '」的，現在登入的是「' + nowAcct + '」，這次沒有打勾／ဤလုပ်ငန်းစာရင်းသည် အခြားသူ၏ စာရင်းဖြစ်၍ ယခု အမှန်မခြစ်ရသေးပါ၊ ပြန်စစ်ကြည့်ပါ');
      await renderTasks(); return;
    }
    const at = Date.now() + ((await Store.getMeta('clockOffset')) || 0);
    if (on) {
      // 同一任務只留最新的一次打勾；正在送出的那一次不動（R4-03、R6-05）
      // 0.5.25 T5：存不進去（空間不足）要說，勾選框跟著重畫回沒勾
      try { await updateTaskDone(list => (list.some(t => t.id === id && FarmCore.isLocked(t)) ? list : list.filter(t => t.id !== id).concat([{ id, at, account: nowAcct }]))); }
      catch (e) { toast('打勾沒存進手機（可能空間不足），請再勾一次／အမှန်ခြစ် ဖုန်းထဲ သိမ်းမရပါ (နေရာ မလောက်ခြင်း ဖြစ်နိုင်)၊ ထပ်ခြစ်ပါ'); await renderTasks(); return; }
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
      ? '只能選自己負責的農民。送出後要等<b>主管確認</b>才算結案（確認後不再提醒回訪）；主管退回就當沒結案。<br>ကိုယ်တာဝန်ယူထားသော လယ်သမားသာ ရွေးနိုင်သည်။ မန်နေဂျာ အတည်ပြုမှ ပိတ်သိမ်းမည် (အတည်ပြုပြီးလျှင် ထပ်မသတိပေးပါ)၊ မန်နေဂျာ ပြန်ပို့လျှင် မပိတ်သိမ်းသေးပါ။'
      : '只能選自己負責的農民。存檔後這位農民就結案（不再提醒回訪）。<br>ကိုယ်တာဝန်ယူထားသော လယ်သမားသာ ရွေးနိုင်သည်။ သိမ်းပြီးလျှင် ဤလယ်သမား ပိတ်သိမ်းသွားမည် (ပြန်သွားရန် ထပ်မသတိပေးတော့ပါ)။';
    // 2號 0.4.63 小事（第8任）：盤商、種子商結案提示原本寫死「要等主管確認」，後台其實跟農民一樣看設定（Code.gs 盤商結案也用 closeNeedsConfirm_）
    $n('dcHint').innerHTML = o.closeConfirm
      ? '送出後要等主管確認才算結案；主管退回就照常往來。<br><span class="my">ပို့ပြီးနောက် မန်နေဂျာ အတည်ပြုမှ ပိတ်သိမ်းမည်။ မန်နေဂျာ ပြန်ပို့လျှင် ပုံမှန်အတိုင်း ဆက်ဆံမည်။</span>'
      : '送出後就結案（洽談成功、失敗都會記下來）。<br><span class="my">ပို့ပြီးလျှင် ပိတ်သိမ်းမည် (ဆွေးနွေးမှု အောင်မြင်/မအောင်မြင် မှတ်တမ်းတင်မည်)။</span>';
  }
  /**
   * 作物、品種改成下拉選單（董事長 2026-11-12 手稿：作物有選單可選；品種＝公司名＋代碼，有選單）。
   * 選項由主管在試算表「選單」分頁維護；品種的「值」寫成「公司名 品種名（代碼）」，存進客戶資料的就是整串。
   * 舊客戶原本手打、選單裡沒有的值，照樣放進選單顯示，不會被清掉
   */
  function setSelect(el, items, value, placeholder) {
    const list = items.slice();
    if (value && !list.some(x => x.value === value)) list.push({ value, text: value + '（舊資料 အဟောင်း）' });
    el.innerHTML = `<option value="">${placeholder}</option>` + list.map(x => `<option value="${esc(x.value)}">${esc(x.text)}</option>`).join('');
    el.value = value || '';
  }
  /* 0.4.40 董事長：作物選單顯示「中文／緬文」（存檔的值照舊是中文）。緬文出處見狀態檔；青花菜、洋香瓜網路查不到確證，待緬甸同仁校對 */
  const CROP_MY = { 番茄: 'ခရမ်းချဉ်သီး', 西瓜: 'ဖရဲသီး', 南瓜: 'ရွှေဖရုံသီး', 絲瓜: 'သပွတ်သီး', 茄子: 'ခရမ်းသီး', 苦瓜: 'ကြက်ဟင်းခါးသီး',
    辣椒: 'ငရုတ်သီး', 玉米: 'ပြောင်းဖူး', 花椰菜: 'ပန်းဂေါ်ဖီ', 青花菜: 'ပန်းဂေါ်ဖီစိမ်း', 洋香瓜: 'သခွားမွှေးသီး', 扁蒲: 'ဘူးသီး', 水稻: 'စပါး',
    高麗菜: 'ဂေါ်ဖီထုပ်' /* 0.4.90 董事長「先用，標待校對」：常見譯名，待緬甸同仁校對 */ };
  // 0.5.13 董事長「作物都要改成英文跟緬甸文」：畫面顯示「English／緬文」（試算表存的值照舊是中文，主管網頁、統計不受影響）；英文是常見名稱
  const CROP_EN = { 番茄: 'Tomato', 西瓜: 'Watermelon', 南瓜: 'Pumpkin', 絲瓜: 'Luffa', 茄子: 'Eggplant', 苦瓜: 'Bitter gourd', 辣椒: 'Chili',
    玉米: 'Corn', 花椰菜: 'Cauliflower', 青花菜: 'Broccoli', 洋香瓜: 'Melon', 扁蒲: 'Bottle gourd', 水稻: 'Rice', 高麗菜: 'Cabbage' };
  const cropText = c => (CROP_MY[c] && !/[က-႟]/.test(c) ? `${CROP_EN[c] || c}／${CROP_MY[c]}` : c); // 試算表已經寫了緬文的不重複加；不是選單裡的作物照原字
  function fillCrops(keep) {
    const crops = (state.options ? state.options.crops : []).map(c => ({ value: c, text: cropText(c) }));
    crops.push({ value: '其他', text: 'Other／အခြား' });
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
      + `<option value="${TRIAL_OTHER}">Other／အခြား (ကိုယ်တိုင်ဖြည့်)</option>`;
    sel.value = keep && (keep === TRIAL_OTHER || crops.some(x => x.value === keep)) ? keep : '';
    refreshTrialOther();
  }
  function refreshTrialOther() { const o = $n('tItemOther'); o.hidden = $n('tItem').value !== TRIAL_OTHER; if (o.hidden) o.value = ''; }
  /** 送出的試作品項（欄位名照舊是 item）：選了作物就是作物；選「其他」就是自己填的字（沒填＝空白，必填檢查會擋） */
  // 0534（小助手1號，客戶「新增農民可以選擇作物，下面又可以開始新的推廣，很奇怪」）：新增試作／推廣農民的品項＝上面選的作物（跟著變、不能另外選）
  const trialItemValue = () => {
    if (typeof newTrialFarmer === 'function' && newTrialFarmer()) return String($n('pCrop').value || '').trim();
    const v = String($n('tItem').value || '');
    return v === TRIAL_OTHER ? String($n('tItemOther').value || '').trim() : v.trim();
  };
  /** 0534：這張是「新增試作／推廣農民」（品項＝作物、一定要同時開始） */
  function newTrialFarmer() { return $n('farmer').value === '__new' && (state.cat === '試作' || state.cat === '推廣'); }
  /**
   * 0534：開始表單照「新農民／舊農民」換顯示——
   *   新農民：品項下拉藏起來，改一行顯示上面選的作物（沒選寫「請先選上面的作物」），框上方說明品項就是作物；
   *   都顯示一行品種（客戶「業務推廣看不到推廣的品種」）：種子公司・品種／代碼，跟 renderCropSum 讀同一組欄位（新農民＝表單上的值，舊農民＝帶進來的客戶資料）
   */
  function paintNewTrial() {
    const nf = newTrialFarmer(), crop = String($n('pCrop').value || '').trim(), fx = $n('tItemFixed');
    $n('tItem').hidden = nf;
    if (nf) {
      $n('tItemOther').hidden = true;
      fx.hidden = false;
      fx.textContent = crop ? `${cropText(crop)}（就是上面選的作物，要換請改上面的作物／အပေါ်တွင် ရွေးထားသော သီးနှံ၊ ပြောင်းလိုလျှင် အပေါ်က သီးနှံကို ပြင်ပါ）` : '請先選上面的作物／အပေါ်က သီးနှံ အရင်ရွေးပါ';
      fx.className = crop ? 'sub' : 'sub err';
      if (!state.activeTrial) $n('trialNow').textContent = `新農民：這次${state.cat}的品項就是上面選的作物${crop ? '（' + cropText(crop) + '）' : '（請先選作物）'}／လယ်သမားသစ် - ပစ္စည်း = အပေါ်က သီးနှံ`;
    } else { fx.hidden = true; refreshTrialOther(); }
    const co = String($n('pVarCo').value || '').trim(), code = String($n('pVarCode').value || '').trim();
    let vari = ''; try { vari = String(varietyValue() || '').trim(); } catch (e) { vari = ''; } // 舊頁面沒有品種欄
    const name = !vari || vari === co ? '' : co && vari.indexOf(co + ' ') === 0 ? vari.slice(co.length + 1) : vari;
    const parts = [co, name].filter(Boolean).join('・');
    $n('tVarietyLine').textContent = `品種：${parts || '（還沒選）'}${code ? '／代碼 ' + code : ''}（在上面作物那一行改）／မျိုး - အပေါ်တွင် ပြင်ပါ`;
  }
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
  /** 0.5.05 董事長：客戶選單裡的地區顯示英文（曼德勒區→Mandalay；另兩區一起改，保持一致）。只換畫面上的字，不改資料 */
  const REGION_EN = { 曼德勒區: 'Mandalay', 仰光區: 'Yangon', 奈比多區: 'Nay Pyi Taw' };
  const regionEn = s => String(s).replace(/曼德勒區|仰光區|奈比多區/g, m => REGION_EN[m]);

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
    const SWITCH_LABEL = { 農戶: '一般拜訪農民', 試作: '對照農民', 推廣: '推廣農民' }; // 第27任：試作農民改叫對照農民（只改畫面字，資料照舊叫試作）
    $('catSwitch').dataset.group = groupOf(cat);
    // 0.4.40 董事長：結案不放上方，改成畫面最下面的「結案（送主管審核）」；在結案畫面時同一顆按鈕變「取消結案」
    if (groupOf(cat) !== 'dealer') state.dealerClose = false; // 0.4.42 盤商、種子商的結案模式只在那一組
    $n('dealerCloseBox').hidden = !(state.dealerClose || dealerSignOn()); // 0.4.75 勾了已簽約也打開
    // 0.4.57 董事長：結案入口搬到首頁「我的進度」→ 打卡畫面最下面只在結案畫面出現「取消結案」
    $n('closeModeBtn').hidden = !(cat === '結案' || state.dealerClose);
    $n('closeModeBtn').innerHTML = '← 取消結案<span class="my">ပိတ်သိမ်းမှု ပယ်ဖျက်</span>';
    $n('noteLab').innerHTML = isDealerCat() ? '匯報紀錄<span class="my">အစီရင်ခံ မှတ်တမ်း</span>' /* 0.4.52 */ : '跟農民聊了什麼<span class="my">လယ်သမားနှင့် ပြောခဲ့သည်များ</span>'; // 0.4.58 董事長 // 0.4.42 董事長：盤商、種子商有見到就記討論進度
    $('saveBtn').innerHTML = cat === '結案' || state.dealerClose ? '結案送主管審核（自動上傳）<span class="my">မန်နေဂျာ စစ်ဆေးရန် ပို့မည်</span>' : '儲存（自動上傳）<span class="my">သိမ်းမည်</span>';
    $('catSwitch').innerHTML = CAT_GROUPS[groupOf(cat)].filter(c => c !== '結案').map(c => `<button type="button" data-setcat="${esc(c)}" aria-pressed="${c === cat}`
      + `">${esc(SWITCH_LABEL[c] || CAT_LABEL(c))}<span class="my">${esc(CAT_MY[c] || '')}</span></button>`).join('');
    $('catSwitch').querySelectorAll('[data-setcat]').forEach(b => {
      const locked = (!!state.catLocked && b.dataset.setcat !== state.entryCat) || !!state.closeOnly; // 0.4.51 只能用首頁選的那一種；0.4.57 從「我的進度」進來結案時全部鎖
      if (locked) { b.disabled = true; b.classList.add('locked'); b.title = '從首頁選的類別，不能切換／ပင်မစာမျက်နှာမှ ရွေးထားသော အမျိုးအစားကို ပြောင်း၍မရပါ'; }
      b.addEventListener('click', () => { if (locked) return; state.catManual = true; setCat(b.dataset.setcat); });
    });
    // 第24任 第六批⑦（tomtom 實測：鎖住的「試作／推廣」看起來可以按）：其他類別都不能切時，鎖住的不顯示，選中的那一個改成標題樣子，下面寫怎麼換
    const sw = $('catSwitch'), others = [...sw.querySelectorAll('[data-setcat]')].filter(b => b.getAttribute('aria-pressed') !== 'true');
    const allLocked = others.length > 0 && others.every(b => b.classList.contains('locked'));
    sw.classList.toggle('alllocked', allLocked);
    if (allLocked && typeof document !== 'undefined' && document.createElement) {
      const h = document.createElement('small');
      h.className = 'sub cathint';
      h.innerHTML = '要換類別，請回首頁重新選<span class="my">အမျိုးအစား ပြောင်းလိုလျှင် ပင်မစာမျက်နှာသို့ ပြန်ပြီး ရွေးပါ</span>';
      sw.appendChild(h);
    }
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
      if (before0 && before0 !== '__new') toast('結案只能選自己負責的農民／ပိတ်သိမ်းရန် ကိုယ်တာဝန်ယူထားသော လယ်သမားသာ ရွေးနိုင်သည်');
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
    const fk = await customerById(cid); // 0.5.09 有分類就照分類
    if (fk && KIND_CAT[fk.kind]) want = KIND_CAT[fk.kind];
    else for (const c of ['試作', '推廣']) { if (await activeTrialFor(cid, c)) { want = c; break; } }
    if (gen !== state.formGen || $('farmer').value !== cid || state.catManual) return;
    await setCat(want);
  }

  /**
   * 0.4.63 董事長「執行任務清單點進去，一般拜訪／試作／推廣要改死，不要三個都能切」：
   * 從清單（任務、日程）進來時先算好類別——有進行中的試作就是試作、推廣就是推廣、都沒有是一般拜訪；盤商、種子商照原類別——再鎖死
   */
  async function openFromList(cid, type) {
    let cat = type === '盤商' || type === '種子商' ? type : '農戶';
    if (cat === '農戶' && cid) cat = await farmerCatOf((await customerById(cid)) || { id: cid }); // 0.5.09 有分類照分類，沒有才看進行中的試作
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
    state.farmerPicked = customerId || ''; // 客戶選單「目前選的那位」：新增警告按取消時撥回這位
    hideFarmerPicker(false); // 上一次從「＋ 新增○○農民」進來時收起的客戶選單，這次先打開（新增的話 openNewFarmer 再收）
    applyCatLabels();
    resetForm();
    await loadOptions();
    await loadFarmers();
    if (customerId) {
      // 0.4.24：客戶不在名單（已結案、或名單還沒同步到）時提示，不默默留一個空白的選農民欄
      if ([...$('farmer').options].some(o => o.value === customerId)) { $('farmer').value = customerId; onFarmerChange(); }
      else toast('找不到這位客戶（可能已結案，或名單還沒更新），請從選單選擇／ဤဖောက်သည် မတွေ့ပါ (ပိတ်သိမ်းပြီး သို့မဟုတ် စာရင်း မအပ်ဒိတ်သေး)၊ စာရင်းမှ ရွေးပါ');
    }
    // 0.5.23 J5、J6（第21任）：打開打卡畫面時記下這張表單是誰的（存檔時不再只看當下的登入：別的分頁可能已登出或換人）；沒登入記空的
    { const oc = await getConfig(); state.formOwner = oc && oc.deviceKey && oc.account ? { key: oc.deviceKey, account: String(oc.account) } : null; }
    // 0533 N1（小助手1號，第23任抓BUG）：沒登入（別的分頁登出、登入失效）不開打卡表單 → 回登入頁；不然主人記空的，別的分頁換人登入後會存在那個人名下
    if (!state.formOwner) { showLogin('請先登入／အရင် ဝင်ပါ'); return; }
    show('visit');
    locate();
  }

  async function loadFarmers() {
    state.myName = String(((await getConfig()) || {}).name || ''); // 0.4.80 已簽約要比對負責業務
    state.farmers = (await Store.getMeta('farmers')) || [];
    const local = (await myLocal('localCustomers')) || [];
    // R13-02：暫存客戶的臨時編號已經是後台正式客戶的 tempId（同一位）→ 不再列一次（寫回一半失敗、暫存先留著時會重複）
    const all = state.farmers.concat(local.filter(l => !state.farmers.some(f => f.id === l.id || f.tempId === l.id)));
    const types = CAT_TYPES[state.cat];
    const sel = $('farmer');
    const keep = sel.value;
    let mine = all.filter(f => types.indexOf(f.type || '農民') >= 0);
    // 0.4.33 董事長：怕業務結案按錯 →「結案」只列自己負責的農民（手機剛新增還沒上傳的也算自己的）；其他類別照舊全部列
    // 0.4.64（2號 0.4.63 清單中#2）：從結案分頁進來的盤商、種子商結案也只列自己負責的（跟農民結案同一規則；後台也會擋）
    if (state.cat === '結案') { const me = String(((await getConfig()) || {}).name || ''); mine = mine.filter(f => f.pending || String(f.staff || '') === me); }
    else if (state.closeOnly && isDealerCat()) { const me = String(((await getConfig()) || {}).name || ''); mine = mine.filter(f => f.pending || !String(f.staff || '') || String(f.staff) === me); } // 0.4.82 盤商、種子商結案：負責業務空白照舊算可以（同 dealerIsMine、後台 ownDc）
    // 0.5.06 董事長「試作農民是試作農民，一般農民是一般農民，推廣農民是推廣農民」（選完全分開）：
    // 一般拜訪只列沒有進行中試作／推廣的農民；試作只列有進行中試作的；推廣只列有進行中推廣的（手機剛開始、還沒上傳的也算）。
    // 一般農民要做試作／推廣：在試作／推廣選單用「＋新增農民」另建一筆（董事長同意）
    if (state.cat === '農戶' || state.cat === '試作' || state.cat === '推廣') {
      const gOf = {};
      for (const f of mine) gOf[f.id] = await farmerCatOf(f); // 0.5.09 先看 kind
      mine = mine.filter(f => gOf[f.id] === state.cat);
    }
    // 業務BUG#3（1號）：結案（農民結案、從結案分頁進來的盤商／種子商結案）不能新增客戶，選單不放「＋新增」
    const closing = state.cat === '結案' || !!state.dealerClose || (state.closeOnly && isDealerCat());
    // 0.5.05 董事長截圖：種子商選單不用顯示品類（作物）；地區「曼德勒區」等改顯示英文（只改畫面，存的值照舊是中文）
    const showCrop = state.cat !== '種子商';
    const optOf = f => `<option value="${esc(f.id)}">${esc(f.name)}${f.area ? '｜' + esc(regionEn(String(f.area).trim()) /* 0.4.89 地區完整顯示（業務－地區），不切字 */) : ''}${showCrop && f.crop ? '｜' + esc(cropText(f.crop)) : ''}`
      + `${showCrop && String(f.varCode || '').trim() ? '｜' + esc(String(f.varCode).trim()) : '' /* 第26任 2026-11-18 董事長「這邊為什麼沒有品種編號」：原本只放姓名｜地區｜作物，代碼接在作物後面 */}${f.pending ? '（新，未上傳 အသစ်၊ မတင်ရသေး）' : ''}</option>`;
    let body = mine.map(optOf).join('');
    // 0.4.73 董事長「結案改為一般農民、試作農民、推廣農民結案」：選的那一種排前面（有進行中試作＝試作農民、推廣＝推廣農民、都沒有＝一般農民），
    // 其他自己負責的農民排在後面「其他農民」（分類只看進行中的試作，結束過的會被算一般，所以不藏起來，免得找不到人）
    if (state.cat === '結案' && FARMER_GROUPS.indexOf(state.closeGroup) >= 0) {
      const gOf = {};
      for (const f of mine) gOf[f.id] = CAT_KIND[await farmerCatOf(f)]; // 0.5.09 結案三組也先看 kind
      // 0.5.11 董事長「拿掉」：分類已寫死在類型欄（0.5.09），結案也不能錯位 → 只列按的那一類，不再列「其他農民」
      const hit = mine.filter(f => gOf[f.id] === state.closeGroup);
      body = `<optgroup label="${esc(state.closeGroup)}">${hit.map(optOf).join('') || '<option value="" disabled>（沒有／မရှိ）</option>'}</optgroup>`;
    }
    sel.innerHTML = '<option value="">— 請選擇 ရွေးပါ —</option>' + body +
      (closing ? '' : `<option value="__new">${isDealerCat() ? `＋ 新增${state.cat}（${CAT_MY[state.cat]} အသစ်）` : '＋ 新增農民（လယ်သမားအသစ် ထည့်ရန်）'}</option>`);
    if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
    state.allCustomers = all;
    // 第24任 第六批④：搜尋用的資料（名字、代碼、村、鎮、地區）；「＋新增」按鈕跟著選單有沒有新增那一項
    state.farmerPick = mine.map(f => ({ id: String(f.id), name: String(f.name || ''), sub: [f.id, f.village, f.town, f.area ? regionEn(String(f.area).trim()) : ''].filter(Boolean).join('｜'), key: [f.name, f.id, f.village, f.town, f.area].join(' ').toLowerCase() }));
    if (typeof paintFarmerPick === 'function') paintFarmerPick();
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
    sel.innerHTML = '<option value="">— 選一位帶入（可不選） တစ်ဦး ရွေးပြီး ထည့်ပါ (မရွေးလည်းရ) —</option>' + list.map(c => { const tv = [c.town, c.village].filter(Boolean).join('・');
      return `<option value="${esc(c.id)}">${esc(c.name || '（未命名）（အမည် မရှိသေး）')}｜${esc(c.id)}${tv ? '｜' + esc(tv) : ''}</option>`; }).join('');
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
  const visitDirty = () => !!(state.photos.length || state.busyPhotos || state.audio || state.rec || state.recBusy || $('note').value.trim() || $('plantFail').checked || ['cmpNote1', 'cmpNote2', 'cmpNote3', 'cmpCo', 'cmpCrop'].some(id => String(($n(id) || {}).value || '').trim())); // 0.4.87 高2：錄音處理中也算
  /** 業務BUG#5：返回首頁前要確認的「填了東西」——除了照片錄音打字，還有沒見到匯報、新客戶資料、結案欄位、盤商結案說明、價格、試作表單 */
  const filled = id => { const e = $n(id); return e.type === 'checkbox' ? !!e.checked : !!String((e.value) || '').trim(); }; // 0.4.75 勾選框看有沒有勾（value 永遠是 on）
  // 結案七欄＋盤商結案說明（formDirty、換客戶共用）；2號 0.4.70 低3（第8任）：漏了結案地區 cRegion、洽談結果 dcOutcome（兩個下拉，預設空白、不會自動帶值）
  const CLOSE_IDS = ['cRegion', 'cPrice', 'cYield', 'cBuyer', 'cPhone', 'cReason', 'cProgress', 'dcOutcome', 'dcNote', 'cTrialOutcome', 'cPlantFail', 'dcSigned', 'mCount', 'mWeight', 'mHusk', 'mLength', 'mRows']; // 0.4.74 加試作結果；0.4.75 加種植失敗、已簽約勾選（filled、清除都認得勾選框）
  const formDirty = () => !!(visitDirty() || filled('nmNote')
    || ($('farmer').value === '__new' && Object.values(PROFILE_INPUTS).some(filled))
    || CLOSE_IDS.some(filled)
    || collectPrices().length || trialTouched()); // 第28任：試作表單改看「有沒有被動過」（程式自動打開、沒動不算）
  function clearVisitInput() {
    // 1號清單高#1（第8任 2026-11-12）：換客戶也要換世代、照片計數歸零（跟 resetForm 一樣），
    // 不然還在處理的照片、錄音處理完會掉進下一位客戶的拜訪。世代要在停錄音之前換，onstop 才會丟掉這段。
    state.formGen++;
    state.busyPhotos = 0;
    $('photoBtn').classList.remove('busy'); $('albumBtn').classList.remove('busy');
    clearInterval(state.recTimer);
    if (state.rec) { try { state.rec.stop(); } catch (e) { /* 已經停了 */ } state.rec = null; }
    if (typeof FarmVoice === 'object') FarmVoice.stop(true); // 第24任 必改第五批：語音輸入也停、丟掉還沒回來的字
    $('recBtn').classList.remove('rec', 'done');
    $('recBtn').querySelector('.label').textContent = '錄音';
    state.photos = []; state.audio = null; state.audioSec = 0;
    if (typeof clearCmp === 'function') clearCmp(); // 第27任 對照農民三段打字一起清
    renderThumbs();
    $('photoInput').value = ''; $('albumInput').value = '';
    $('note').value = ''; if (typeof $n === 'function') $n('vStageWhy').value = ''; // 0.5.26 沒選階段的原因一起清
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
    if (prev && val !== prev && (visitDirty() || pricesTyped() || filled('nmNote') || trialTouched() || closeTyped || newTyped)) {
      const extra = (closeTyped ? '、結案資料' : '') + (newTyped ? '、新客戶資料' : '');
      const ask = hasPrices ? `換店家會清掉剛剛的照片、錄音、打字、價格、匯報${extra}，確定要換？\nဆိုင် ပြောင်းလျှင် စောစောက ဓာတ်ပုံ၊ အသံ၊ စာ၊ ဈေးနှုန်း၊ အစီရင်ခံများ ပျောက်မည်။ ပြောင်းမှာ သေချာပါသလား။`
        : `換農民會清掉剛剛的照片、錄音、打字、匯報${extra}，確定要換？\nလယ်သမား ပြောင်းလျှင် စောစောက ဓာတ်ပုံ၊ အသံ၊ စာ၊ အစီရင်ခံများ ပျောက်မည်။ ပြောင်းမှာ သေချာပါသလား။`;
      if (!confirm(ask)) { $('farmer').value = prev; return; }
      clearVisitInput();
      CLOSE_IDS.forEach(id => { const e = $n(id); if (e.type === 'checkbox') { e.checked = false; e.disabled = false; } else e.value = ''; }); // 中1：確定換人，上一位的結案欄位一起清（0.4.75 勾選框取消勾）
    } else if (prev && val !== prev && state.trialMode) {
      // 第28任：程式自動打開、業務沒動過的試作表單不再問（上面不會進去），但照樣要清掉，不然會帶到下一位客戶（其他東西都沒填，清掉不會丟資料）
      clearVisitInput();
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
    if (!val) {
      box.hidden = true;
      $('progressBox').hidden = true;
      renderFarmerInfo(''); // 第28任：農民資料框一起收起
      const hb = $n('closeVisitHist');
      hb.hidden = true;
      hb.innerHTML = '';
      hb._tok = null;
      const vh = $n('visitHistory');
      vh.hidden = true;
      vh.innerHTML = '';
      vh._tok = null;
      refreshTrialBox();
      refreshSave();
      return;
    } // 0.4.35 沒選人：進度、作物品種都收起來；0.4.73、0.4.75 過往紀錄也收
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
    renderFarmerInfo(val); // 第28任：搜尋框正下方先列農民詳細資料
    renderProgress(val); // 0.4.35 選了農民就跳出他之前的進度
    // 0.4.73 董事長「結案要有之前的照片、留言、錄音、地址、詳細過往失敗成功的紀錄」：結案畫面選了農民就列過往紀錄
    if (state.cat === '結案') renderHistory(val, $n('closeVisitHist'), { current: () => $('farmer').value === val, list: state.allCustomers || [], timeline: true, showAddr: true, showTrials: true });
    else { const hb = $n('closeVisitHist'); hb.hidden = true; hb.innerHTML = ''; hb._tok = null; }
    // 0.4.75 董事長「田間打卡：所有的農民之前紀錄都要有之前圖片跟錄音」：一般／試作／推廣農民（不限自己負責）列過往紀錄；盤商、種子商、結案不列
    if (state.cat !== '結案' && groupOf(state.cat) === 'farmer') renderHistory(val, $n('visitHistory'), { current: () => $('farmer').value === val && state.cat !== '結案' && groupOf(state.cat) === 'farmer', list: state.allCustomers || [], showTrials: true, timeline: true, timelineOnly: true, scope: 'field' }); // 第27任：打卡畫面只放生長過程（過往紀錄上面進度卡已有）
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
      if (!(r && r.ok && Array.isArray(r.visits))) return null;
      const vs = r.visits.slice(); if (typeof r.closeWaiting === 'boolean') vs.closeWaiting = r.closeWaiting; // 0.5.18 A1：後台看全部拜訪判斷的「有結案在等主管確認」（舊後台沒有這欄＝undefined，照舊看最近 5 筆）
      if (Number(r.serverTime) > 0) vs.serverTime = Number(r.serverTime); // 0.5.18 R2：這份是後台哪個時間讀的（跟手機快取比新舊）
      return vs;
    } catch (e) { return null; } finally { if (timer) clearTimeout(timer); }
  }
  /** opts（0.4.57 首頁「我的進度」結案選單共用）：box 畫在哪、current() 讀完時還是不是這位、list 客戶清單、home＝首頁（沒紀錄時不去開客戶資料） */
  async function renderProgress(cid, opts) {
    const o = opts || {};
    const box = o.box || $('progressBox');
    const current = o.current || (() => $('farmer').value === cid);
    if (!cid || cid === '__new') { box.hidden = true; box.innerHTML = ''; return; }
    // 0.4.92 低5：換客戶先清掉上一位的「等主管確認」（新增農民不會對到，不用清）
    // 0.4.97（第12任 BUG 審查手機 4B）：原本清成 null → 等後台紀錄的最多 10 秒內不擋結案，這段時間能再送一次 → 先標「查詢中」，查完下面再寫實際結果
    if (!o.box) state.closeWait = { cid, wait: 'checking' };
    if (!o.box) state.waitGen = (Number(state.waitGen) || 0) + 1; // 0518R8-1：等待狀態的版本號（見 applyCloseWait）
    const c = (o.list || state.allCustomers || []).find(f => f.id === cid) || {};
    const H3 = progressHeader(c);
    // 0518R2-4：這是第幾次查（打卡畫面才編號）；之後每次等待完都確認自己還是最新的一次，不是就不寫結果
    const seq = o.box ? 0 : (state.progSeq = (Number(state.progSeq) || 0) + 1);
    const superseded = () => !o.box && state.progSeq !== seq;
    let trials = [];
    for (const cat of ['試作', '推廣']) { const t = await activeTrialFor(cid, cat); if (t) trials.push(Object.assign({ cat }, t)); }
    const local = await progressLocalVisits(cid);
    const local5 = local.slice(0, 5); // R12-03（GPT 中）：等確認判斷看全部（local）；只有畫面顯示取最近 5 筆
    if (!current()) return; // 2號 0.4.69 低4（第8任）：查試作、本機拜訪的途中已經收起或換人 → 不要再把卡片打開寫「讀取中」
    if (superseded()) return; // 0518R2-4
    const tok = {}; box._loadTok = tok; // 這一次讀取的記號：後面判斷「卡片現在還是我寫的讀取中嗎」（比 innerHTML 字串可靠，瀏覽器會改寫跳脫字）
    box.hidden = false;
    box.innerHTML = H3 + '<p class="sub">讀取中…／ဖတ်နေသည်</p>';
    // 0518R4-4：送出查詢「之前」的快取版本——查詢途中快取有任何寫入（cacheRev 換了），這次後台回答就不能壓過快取
    const v0 = !o.box && typeof cacheVersion === 'function' ? await cacheVersion() : null;
    if (superseded()) return;
    // 等後台最多 10 秒；等不到就用手機裡的（線上實測：請求有時遲遲不回，連取消都沒反應 → 不能只靠 AbortController）
    const remote = await Promise.race([fetchHistory(cid), new Promise(r => setTimeout(() => r(null), 10000))]);
    if (!current()) { if (box._loadTok === tok) { box.hidden = true; box.innerHTML = ''; box._loadTok = null; } return; } // 讀的途中換了客戶；低4：卡片還是這次寫的「讀取中」就收掉（別的讀取已接手就不動）
    if (superseded()) return; // 0518R2-4：同一位又查了一次（比較新的那次負責寫結果、畫卡片），這次較舊的回應不寫
    // 業務BUG#6：沒網路時用手機本地日期（toISOString 是世界標準時間，緬甸 00:00～06:30 打的卡會顯示成前一天）
    // 第8任（1號提醒 dayOf）：改用緬甸日期 mmDay，手機時區不是緬甸也不會差一天（跟伺服器的日期同一把尺）
    const dayOf = ms => mmDay(0, ms || 0);
    const recent = remote ? remote : progressLocalRecent(local5);
    // 0.4.92 低5：打卡畫面（不是首頁）的進度卡：記下這位的結案是不是還在等主管確認，存檔鈕跟著擋
    let waitHtml = '';
    if (!o.box) {
      const cw = await progressCloseWait(cid, remote, local, trials, v0, () => current() && !superseded());
      if (!cw) return; // 判斷途中換人或又查了一次
      trials = cw.trials;
      if (cw.wait) waitHtml = PROGRESS_WAIT_HTML();
      if (typeof refreshSave === 'function') refreshSave();
    }
    // 0.4.82 多久沒回訪：後台的最後拜訪日、這支手機剛打（還沒同步）的，取比較新的那天
    const age = `<p class="sub">${visitAgeHtml([c.lastVisit, local[0] ? dayOf(local[0].deviceTime) : ''].filter(Boolean).sort().pop(), mmDay(0))}</p>` + (o.box ? farmerFactsHtml(c, trials, (((await Store.getMeta('options')) || state.options || {}).areaUnit), ((await Store.getMeta('options')) || state.options || {})) : ''); /* 第28任：打卡畫面的農民資料已經放在搜尋框正下方（renderFarmerInfo），進度卡不再重複；首頁「我的進度」照舊列 */ // 抓BUG第6輪 手機組2：先讀手機資料庫（同步存的最新），讀不到才用記憶體那份（同 fillPlantForm） // 第27任：種植日期、面積、種子、備註；抓BUG第5輪 手機組2：首頁「我的進度」還沒讀過選單，單位從手機資料庫讀
    if (o.home && !c.lastVisit && !trials.length && !recent.length) {
      box.innerHTML = H3 + age + `<p>這位${c.type && c.type !== '農民' ? '客戶' : '農民'}還沒有拜訪紀錄。<br>` + '<span class="my">မှတ်တမ်း မရှိသေး</span></p>';
      return;
    }
    if (!c.lastVisit && !trials.length && !recent.length) {
      // 沒有任何進度：跳出新增（補齊）農民資料
      box.innerHTML = SHOW_PROFILE_ON_VISIT ? H3 + age + '<p>這位農民還沒有拜訪紀錄，請先把下面的農民資料填完整（跟新增農民一樣）。<br><span class="my">ဤလယ်သမားတွင် မှတ်တမ်း မရှိသေးပါ၊ အောက်ပါ လယ်သမား အချက်အလက်ကို အပြည့်အစုံ အရင်ဖြည့်ပါ (အသစ်ထည့်သကဲ့သို့)။</span></p>'
        : H3 + age + '<p>這是第一次拜訪這位客戶。<br><span class="my">ပထမဆုံး သွားရောက်မှု</span></p>'; // 0.4.48
      $('profileBox').open = true;
      $('profileTitle').textContent = '補齊農民資料（還沒有拜訪紀錄）／လယ်သမား အချက်အလက် ဖြည့်ရန်';
      return;
    }
    box.innerHTML = progressCardHtml(c, trials, recent, !!remote, `${H3}${age}${waitHtml}`);
    bindProgressPhotos(box, cid);
  }
  /** 第26任 2026-11-18 董事長「上次拜訪要有圖片」：進度卡的照片——最近一次拜訪自動載入（最多 MAX_PHOTOS 張），「看更早的」裡的按了才下載（省緬甸網路流量）；
   *  農民任何業務都能看（scope:'field'，跟後台 farmerHistory_ 一樣）；下載失敗留按鈕可以再按 */
  function bindProgressPhotos(box, cid) {
    if (!box || !box.querySelectorAll) return;
    const load = async (b, manual) => {
      if (b._dl) return b._dl; // 這張正在下載（例如業務手動先點了）：排隊的等它下載完再往下，不會同時下載兩張
      if (b.disabled) return;
      b._dl = loadOne(b, manual);
      try { return await b._dl; } finally { b._dl = null; }
    };
    const loadOne = (b, manual) => swapButtonForFile(b, cid, 'photo', 'field', !manual); // 自動載入失敗不跳提示，按鈕留著自己再按
    const btns = Array.from(box.querySelectorAll('[data-hph]'));
    btns.forEach(b => b.addEventListener('click', () => load(b, true)));
    // 最近一次那筆（不在「看更早的」裡）自動載入。抓BUG第9輪 手機組1（第28任）：照片上限調到 12 後一次同時下載 12 張，網路慢時每張都等到逾時、一張都出不來 → 改成一張一張排隊下載；換了農民（按鈕已不在畫面上）就停
    const auto = btns.filter(b => !(b.closest && b.closest('details')));
    // 換了農民怎麼知道：看按鈕「外面那一格」還在不在畫面上（整張進度卡重畫時那格會被換掉）。
    // 不能只看按鈕本身：照片下載好時按鈕會被換成圖片，也不在畫面上了——那是「這張已經好了」，要跳過、接著排下一張（第10輪 手機組1）
    const holders = auto.map(b => b.parentNode);
    (async () => {
      for (let i = 0; i < auto.length; i++) {
        if (holders[i] && holders[i].isConnected === false) break; // 換農民了，舊的照片不用再下載
        if (auto[i].isConnected === false) continue; // 這張已經載好（業務先手動點了）
        await load(auto[i], false);
      }
    })();
  }
  /* renderProgress 拆出來的（第15任 2026-11-14 董事長「拆 renderProgress」）：① 純計算／組 HTML（不碰畫面、不碰手機資料） ② 記下後台回答
     放在 renderProgress 後面、「試作（2B）」之前：舊測試從 renderProgress 切到那行，會自動一起帶到 */
  /** ① 進度卡標題：農民姓名、電話（點了直接撥）、地址（沒填地址就顯示地區）（0.4.49 董事長） */
  /** 電話號碼轉成「點了能撥」的數字：緬文數字先換成 0-9，再拿掉空白、橫線這些（0.4.92 低2：緬文數字先轉 0-9） */
  const telDigits = phone => String(phone || '').replace(/[\u1040-\u1049]/g, ch => String(ch.charCodeAt(0) - 0x1040)).replace(/[^0-9+]/g, '');
  function progressHeader(c) {
    const tel = telDigits(c.phone);
    const who = [c.name ? `<b>${esc(c.name)}</b>` : '', c.phone ? `📞 <a href="tel:${esc(tel)}">${esc(c.phone)}</a>` : '', (c.address || c.area) ? `📍 ${esc(c.address || c.area)}` : ''].filter(Boolean).join('　');
    return `<h3>之前的進度／ယခင် တိုးတက်မှု${who ? `<span class="who">${who}</span>` : ''}</h3>`;
  }
  /** 第27任 2026-11-18 董事長「業務選農民，備註看不見、幾號種植、拿幾包種子給農民、農民面積，業務端要看得到」：
      選了農民，進度卡上方列這四樣（沒填的不列；盤商、種子商不列）。種子＝進行中試作／推廣開始時填的用量。
      備註是系統自動寫的「業務在現場新增」就不列。新字只有中文，緬文待譯（_翻譯/待譯_第27任_20261118.md） */
  /*
   * 農民資料框、進度卡、店家資料框的欄位名稱緬文（董事長 Antigravity 譯稿 E3、E10、F8、F11）。
   * 欄位名稱用中文當鍵，畫的時候在中文後面接一個緬文 span，例：「種植日期 စိုက်ရက်：2026-10-10」。
   * 試作（畫面叫對照）、推廣兩列的名稱是動態的，另外對照 TRIAL_MY。
   */
  const FACT_MY = {
    編號: 'နံပါတ်', 鎮: 'မြို့နယ်', 村: 'ကျေးရွာ', 作物: 'သီးနှံ', 種子公司: 'မျိုးစေ့ကုမ္ပဏီ', 代碼: 'ကုဒ်',
    面積: 'ဧရိယာ', 種植日期: 'စိုက်ရက်', 生長天數: 'ကြီးထွားရက်', 負責: 'တာဝန်ခံ', 下次回訪: 'နောက်တစ်ကြိမ် ပြန်သွားရန်',
    備註: 'မှတ်ချက်', 電話: 'ဖုန်း', 地址: 'လိပ်စာ', 地區: 'ဒေသ', 簽約: 'စာချုပ်', 老闆: 'ဆိုင်ရှင်', 品牌: 'တံဆိပ်',
  };
  const TRIAL_MY = { 試作: 'နှိုင်းယှဉ်', 推廣: 'မြှင့်တင်' };
  /** 欄位名稱的緬文：固定欄位查 FACT_MY；「試作」「推廣種子」這種動態名稱拆開來拼 */
  function factLabelMy(label) {
    if (FACT_MY[label]) return FACT_MY[label];
    if (TRIAL_MY[label]) return TRIAL_MY[label];
    const seedOf = String(label).replace(/種子$/, '');
    return seedOf !== label && TRIAL_MY[seedOf] ? TRIAL_MY[seedOf] + ' မျိုးစေ့' : '';
  }
  /** 一列「欄位名稱：內容」；名稱後面接緬文（沒有對照的就只有中文） */
  function factLabelHtml(label) {
    const my = factLabelMy(label);
    return `<b>${esc(label)}${my ? `<span class="my">${my}</span>` : ''}</b>`;
  }
  function farmerFactsHtml(c, trials, unit, opts) {
    if (!c || (c.type && c.type !== '農民')) return '';
    const u = unit || (state.options && state.options.areaUnit) || '英畝', has = x => x !== '' && x != null && String(x).trim() !== '';
    const note = String(c.note == null ? '' : c.note).trim();
    // 第27任 2026-11-18 董事長「業務面的之前進度太少了，要像主管頁一樣詳細」：照主管頁客戶履歷那張卡的欄位排（編號、分類、鎮、村、作物、種子公司、代碼、面積、種植日期、生長天數、其他、試作、負責、下次回訪、備註）
    const days = typeof cropDaysOf === 'function' ? cropDaysOf(c.crop, opts) : 0;
    const g = typeof growOf === 'function' && has(c.plantDate) ? growOf(c.plantDate, mmDay(0), days) : null;
    const rows = [
      ['編號', [c.id, c.kind || ''].filter(Boolean).join('・')],
      has(c.town) ? ['鎮', String(c.town)] : null,
      has(c.village) ? ['村', String(c.village)] : null,
      has(c.crop) ? ['作物', cropText(String(c.crop))] : null,
      has(c.variety) ? ['種子公司', String(c.variety)] : null,
      has(c.varCode) ? ['代碼', String(c.varCode)] : null,
      has(c.areaNow) || has(c.areaMax) ? ['面積', areaFactText(c, u, has)] : null,
      has(c.plantDate) ? ['種植日期', String(c.plantDate) + (g && !g.future ? plantDayText(g.days, days) : '')] : null,
      days ? ['生長天數', `${days} 天／${days} ရက်`] : null,
      has(c.fertilizer) ? ['其他', String(c.fertilizer)] : null
    ].concat((trials || []).map(t => [`${t.cat || '試作'}`, [cropText(String(t.item || '（未填品項）')), t.start ? t.start + ' 開始 စတင်' : ''].filter(Boolean).join('，')]))
      .concat((trials || []).filter(t => has(t.dosage)).map(t => [`${t.cat || '試作'}種子`, String(t.dosage)]))
      .concat([has(c.staff) ? ['負責', String(c.staff)] : null, has(c.nextDue) ? ['下次回訪', String(c.nextDue)] : null, note && note !== '業務在現場新增' ? ['備註', note] : null]).filter(Boolean);
    return rows.length ? `<ul class="ffacts">${rows.map(([k, v]) => `<li>${factLabelHtml(k)}：${esc(v)}</li>`).join('')}</ul>` : '';
  }
  /** 面積：「目前 2 英畝、可種 3 英畝」後面括號接緬文（譯稿 E3） */
  function areaFactText(c, unit, has) {
    const zh = [has(c.areaNow) ? `目前 ${c.areaNow} ${unit}` : '', has(c.areaMax) ? `可種 ${c.areaMax} ${unit}` : ''].filter(Boolean);
    const my = [has(c.areaNow) ? `လက်ရှိ ${c.areaNow} ${unit}` : '', has(c.areaMax) ? `စိုက်နိုင်သော ${c.areaMax} ${unit}` : ''].filter(Boolean);
    return zh.join('、') + '（' + my.join('၊ ') + '）';
  }
  /** 種植日期後面的「（第 20 天／90 天）」，再接緬文（譯稿 E10） */
  function plantDayText(dayNo, cropDays) {
    const zh = `（第 ${dayNo} 天${cropDays ? '／' + cropDays + ' 天' : ''}）`;
    const my = `（${dayNo} ရက်မြောက်${cropDays ? '／' + cropDays + ' ရက်' : ''}）`;
    return zh + my;
  }
  /**
   * 打卡畫面：選了農民，搜尋框正下方馬上列出這位的詳細資料（董事長 2026-11-19 截圖）。
   * 列什麼：電話（點了直接撥）、地址、地區，加上 farmerFactsHtml 那一整串（面積、負責業務、作物、生長天數、其他、
   * 給農民幾包種子、種植日期、下次回訪、備註……跟主管頁客戶資料同一套欄位），有田區座標就給導航連結。
   * 資料都在手機裡（同步下來的客戶、進行中的試作／推廣），不用等網路；查試作的途中換了農民就不寫。
   */
  /** 已簽約的盤商、種子商資料（田間打卡搜尋框正下方）：簽約狀態、電話（點了撥）、地址、地區、老闆、作物、品牌、其他、負責、下次回訪、備註；沒填的不列 */
  function dealerInfoHtml(c) {
    const has = x => x !== '' && x != null && String(x).trim() !== '';
    const row = (k, v) => (has(v) ? `<li>${factLabelHtml(k)}：${esc(String(v))}</li>` : '');
    const tel = telDigits(c.phone);
    const rows = [
      `<li>${factLabelHtml('簽約')}：<span class="signtag ok">已簽約／စာချုပ်ချုပ်ပြီး</span></li>`,
      has(c.phone) ? `<li>${factLabelHtml('電話')}：<a href="tel:${esc(tel)}">${esc(c.phone)}</a></li>` : '',
      row('地址', c.address), row('地區', c.area), row('編號', [c.id, c.type].filter(Boolean).join('・')), row('老闆', c.owner),
      row('作物', has(c.crop) ? cropText(String(c.crop)) : ''), row('品牌', c.brand), row('其他', c.fertilizer),
      row('負責', c.staff), row('下次回訪', c.nextDue), row('備註', c.note)
    ].join('');
    const typeMy = CAT_MY[c.type] ? `<span class="my">${CAT_MY[c.type]} အချက်အလက်</span>` : '';
    return `<h3>${esc(c.type)}資料　<b>${esc(c.name || '')}</b>${typeMy}</h3><ul class="ffacts">${rows}</ul>`;
  }
  async function renderFarmerInfo(cid) {
    const box = $n('farmerInfo');
    if (!box) return; // 舊頁面沒有這一格
    const c = (state.allCustomers || []).find(f => f.id === cid);
    const isFarmer = c && (!c.type || c.type === '農民');
    // 已經簽約（主管確認過）的盤商、種子商也列資料（董事長 2026-11-19「如果已經簽約的話，就可以顯示在田間打卡那邊」）
    if (c && cid !== '__new' && (c.type === '盤商' || c.type === '種子商') && c.signed === true) { box.innerHTML = dealerInfoHtml(c); box.hidden = false; return; }
    if (!cid || cid === '__new' || !isFarmer) { box.hidden = true; box.innerHTML = ''; return; }
    const trials = [];
    for (const cat of ['試作', '推廣']) {
      const t = await activeTrialFor(cid, cat);
      if (t) trials.push(Object.assign({ cat }, t));
    }
    if ($('farmer').value !== cid) return; // 查的途中換了農民
    const options = (await Store.getMeta('options')) || state.options || {};
    const tel = telDigits(c.phone);
    const has = x => x !== '' && x != null && String(x).trim() !== '';
    const contact = [
      has(c.phone) ? `<li>${factLabelHtml('電話')}：<a href="tel:${esc(tel)}">${esc(c.phone)}</a></li>` : '',
      has(c.address) ? `<li>${factLabelHtml('地址')}：${esc(c.address)}</li>` : '',
      has(c.area) ? `<li>${factLabelHtml('地區')}：${esc(c.area)}</li>` : '',
      c.lat != null && c.lng != null && c.lat !== '' ? `<li><a href="https://www.google.com/maps/search/?api=1&query=${esc(c.lat)},${esc(c.lng)}" target="_blank" rel="noopener">田區導航 ↗<span class="my">လယ်ကွက် လမ်းညွှန် ↗</span></a></li>` : ''
    ].join('');
    const facts = farmerFactsHtml(c, trials, options.areaUnit, options);
    const list = facts ? facts.replace('<ul class="ffacts">', '<ul class="ffacts">' + contact) : (contact ? `<ul class="ffacts">${contact}</ul>` : ''); // 電話、地址放在同一張清單最上面
    box.innerHTML = `<h3>農民資料　<b>${esc(c.name || '')}</b><span class="my">လယ်သမား အချက်အလက်</span></h3>` + list;
    box.hidden = false;
  }
  /** ① 沒網路時：這支手機記的最近幾筆拜訪，排成跟後台紀錄一樣的格式（日期用緬甸日期） */
  function progressLocalRecent(local5) {
    const dayOf = ms => mmDay(0, ms || 0); // 業務BUG#6／第8任：緬甸日期（手機時區不是緬甸也不會差一天）
    return local5.map(v => ({ time: dayOf(v.deviceTime), staff: '我 ကျွန်ုပ်', cat: CAT_LABEL(v.category || ''), text: v.text || '', plantFail: '', closing: '' }));
  }
  /** ① 這次後台的回答（0518R4）：closeWaiting、後台時間、最新一筆結案是不是在等、送出前的快取記號 */
  function progressAnswer(cid, remote, lastC, v0) {
    return { cid, got: !!remote, closeWaiting: remote && typeof remote.closeWaiting === 'boolean' ? remote.closeWaiting : undefined, serverTime: remote ? Number(remote.serverTime) || 0 : 0,
      lastWait: !!lastC && /（待主管確認）$/.test(String(lastC.closing)), rev: v0 ? v0.rev : '' };
  }
  /** ② 記下後台回答；0518R4-5：不拿較舊的回答（後台時間較早）蓋掉已記下的這位較新回答
      0518R5-2（GPT）：這次失敗（null）或沒有後台時間（舊後台）＝分不出新舊 → 照記這次（got 照實，已上傳本機結案的保守判斷照舊），
        但這位之前查到的「在等」帶過來（prevWait）；每位各記一份（waitKnown，中途看別位再回來也還在），只有之後拿到有時間的有效回答才換掉 */
  function progressRememberAnswer(ans) {
    const prevAns = state.histAns && state.histAns.cid === ans.cid ? state.histAns : null;
    if (prevAns && prevAns.serverTime > ans.serverTime && ans.serverTime > 0) return;
    // 0518R6 待確認 2（GPT）：記「在等」那次的後台時間 t；只有比 t 新的有效回答才解除（失敗後收到較舊的回答不解除）
    const known = state.waitKnown || (state.waitKnown = {});
    // 0518R7-1（GPT）：解除和帶 prevWait 用同一條「嚴格比較新」——同一毫秒分不出先後，保守照在等（原本一邊 >、一邊 >=，同時間的相反回答會放行）
    const timed = ans.got && ans.serverTime > 0, k = known[ans.cid];
    const waitAns = ans.got && (ans.closeWaiting === true || !!ans.lastWait);
    const newer = kn => timed && ans.serverTime > kn.t;
    if (waitAns) known[ans.cid] = { t: Math.max(ans.serverTime, k ? k.t : 0) };
    else if (timed && (!k || newer(k))) delete known[ans.cid];
    const kw = known[ans.cid];
    state.histAns = kw && !waitAns && !newer(kw) ? Object.assign({}, ans, { prevWait: true }) : ans; // 這次自己說在等就不用帶
    state.waitGen = (Number(state.waitGen) || 0) + 1; // 0518R8-1：回答換了 → 版本號換，之前開始的重算不准套用
  }
  /** ① 沒有 closeWaitNow 時（只抽 renderProgress 的舊測試）：0.5.18 第 1 輪的簡單判斷 → 'local'／'server'／'' */
  function progressSimpleWait(local, remote, trials, lastC) {
    const srvWait = (remote && remote.closeWaiting === true) || trials.some(t => t && t.held === true);
    return local.some(v => v && v.closing && !v.closingDropped && !v.missingCustomer && (v.status === 'pending' || (!remote && v.status === 'uploaded'))) ? 'local' /* 0.5.16：後台沒收的結案不算等確認 */ : srvWait ? 'server' : lastC && /（待主管確認）$/.test(String(lastC.closing)) ? 'server' : '';
  }
  /** ② 這位在這支手機（目前帳號）的全部拜訪，新的在前；新客戶還沒上傳完的拜訪記的是臨時編號，也算這位的（0.5.16 第1輪：漏了會放行第二筆結案）
      低#6（第8任）：別的帳號的拜訪不標成「我」（myVisits 只給目前帳號；註解原本誤插在排序那行中間，把排序變成註解，已改正） */
  async function progressLocalVisits(cid) {
    const realOfP = {}; ((await Store.getMeta('farmers')) || []).forEach(f => { if (f && f.tempId && f.id) realOfP[f.tempId] = f.id; });
    const local = (await myVisits()).filter(v => v.farmerId === cid || realOfP[v.farmerId] === cid).sort((a, b) => (b.deviceTime || 0) - (a.deviceTime || 0));
    return local;
  }
  /**
   * ② 打卡畫面：這位的結案是不是在等主管確認 → { wait: 'local'／'server'／'', trials }；判斷途中換人或又查了一次（stillMine() 不成立）回 null。
   *   等確認＝這支手機還有沒上傳、帶結案的拜訪（'local'），或後台最近拜訪裡最新一筆有結案的、結尾是「（待主管確認）」（'server'；退回的結尾不同，可以再送）
   */
  async function progressCloseWait(cid, remote, local, trials, v0, stillMine) {
    const lastC = (remote || []).find(v => v && v.closing);
    if (typeof closeWaitNow === 'function') {
      // 0518R4：記下這次後台的回答，由 closeWaitNow 照當下資料判斷（見 decideCloseWait）；0518R4-5：呼叫前已確認是這位最新的一次查詢，中間沒有等待
      progressRememberAnswer(progressAnswer(cid, remote, lastC, v0));
      // 0518R8-1：重算途中版本號換了（別的回答、別的查詢）→ 這份不套用，用最新的再算（最多 3 次；一直在換就維持「查詢中」，存檔、結束照擋）
      for (let i = 0; i < 3; i++) {
        const cw = await closeWaitNow(cid);
        if (!stillMine()) return null;
        if (applyCloseWait(cid, cw, true) !== false) return { wait: cw.wait, trials: cw.trials };
      }
      return null;
    }
    // 只抽 renderProgress 的舊測試：照 0.5.18 第 1 輪的簡單判斷（沒有新舊比較）
    const w = progressSimpleWait(local, remote, trials, lastC);
    state.closeWait = { cid, wait: w };
    return { wait: w, trials };
  }
  function PROGRESS_WAIT_HTML() { return `<p class="err">⏳ ${esc('這位已送結案、等主管確認中，不能再送一次（主管確認或退回後才能再送）／ပိတ်သိမ်းရန် ပို့ပြီးပါပြီ၊ မန်နေဂျာ စစ်ဆေးနေဆဲ၊ ထပ်မပို့ရ')}</p>`; }
  /** ① 進度卡內容（top＝標題＋多久沒回訪＋等確認）：最後拜訪、下次回訪、進行中的試作、最近一次拜訪（更早的收進「看更早的」） */
  function progressCardHtml(c, trials, recent, online, top) {
    // 0.5.16 第2輪 低：週數跟「我的試作」同一把尺（緬甸日期相減的天數 ÷ 7），原本用手機現在時刻減 UTC 零點，第 7 天 06:30 後兩邊差一週
    // 第27任 2026-11-18 董事長「打卡畫面第 N 週要改成天」：試作／推廣開始到今天第幾天（開始當天＝第 0 天，同我的試作、主管頁的算法）
    const wk = s => { const d = Date.parse(String(s || '').slice(0, 10)); return isFinite(d) ? Math.max(0, Math.round((Date.parse(mmDay(0)) - d) / 86400000)) : null; };
    // 0.4.44 進度小卡：作物品種代碼搬到卡片下面一行（renderCropSum），卡片只留最後拜訪、下次回訪
    const head = [c.lastVisit ? `最後拜訪 နောက်ဆုံး သွားရောက်မှု <span class="nw">${esc(c.lastVisit)}</span>` : '', c.nextDue ? `下次回訪 နောက်တစ်ကြိမ် သွားရန် <span class="nw">${esc(c.nextDue)}</span>` : ''].filter(Boolean).join('｜'); // 低#9（第8任）：日期不拆兩行
    // R24-3（GPT）：後台讀不到結案分頁時 held 是 null → 進度卡也寫「結案狀態未知」，不說進行中、不算週數（跟「我的試作」一致）
    const tr = trials.map(t => t && t.held === null ? `<li><b>${esc(t.cat)}：結案狀態未知，請洽主管</b>：${esc(cropText(t.item || '（未填品項）'))}<span class="my">${esc(t.cat)} - ပိတ်သိမ်းမှု အခြေအနေ မသိ၊ မန်နေဂျာကို မေးပါ - ${esc(cropText(t.item || '（未填品項）'))}</span></li>` : `<li><b>${esc(t.cat)}`
      + `進行中</b>：${esc(cropText(t.item || '（未填品項）'))}${t.start ? `，${esc(t.start)} 開始${wk(t.start) != null ? `（第 ${wk(t.start)} 天）` : ''}` : ''}<span class="my">${esc(t.cat)}`
      + ` လုပ်ဆောင်ဆဲ - ${esc(cropText(t.item || '（未填品項）'))}${t.start ? `၊ ${esc(t.start)} စတင်${wk(t.start) != null ? `（${wk(t.start)} ရက်မြောက်）` : ''}` : ''}</span></li>`).join('');
    const vs = recent.map(v => `<li>${esc(v.time)}｜${esc(v.staff)}｜${esc(CAT_LABEL(v.cat))}${v.text ? `：${esc(v.text).replace(/\n/g, '<br>') /* 第26任：業務原文的換行、「🎤 逐字稿」另起一行照樣顯示 */}` : ''}`
      + `${v.textMy && v.textMy !== v.text ? `<span class="my">${esc(v.textMy)}</span>` : ''}${v.plantFail ? `<br><span class="pill late">種植失敗 စိုက်ပျိုးမှု မအောင်မြင်</span> ${esc(v.plantFail)}` : ''}`
      + `${v.closing ? `<br>${esc(v.closing)}` : ''}${(v.photos || []).length ? `<div class="pgrid">${v.photos.map((id, i) => `<button type="button" class="btn2 small" data-hph="${esc(id)}`
      + `">📷 照片 ${pno(v, i)}／ဓာတ်ပုံ ${pno(v, i)}</button>`).join('')}</div>` : ''}</li>`).join(''); // 第26任：上次拜訪的照片（董事長「這邊要有上次拜訪的圖片」）
    // 0.4.44 只露最近一次拜訪，其他收進「看更早的」
    const vItems = vs ? vs.split('</li>').filter(Boolean).map(x => x + '</li>') : [];
    const more = vItems.length > 1 ? `<details><summary>看更早的 ${vItems.length - 1} 筆／ယခင် မှတ်တမ်းများ ကြည့်ရန်</summary><ul>${vItems.slice(1).join('')}</ul></details>` : '';
    return `${top}${head ? `<p class="sub">${head}</p>` : ''}${tr ? `<ul>${tr}</ul>` : ''}` +
      (vItems.length ? `<p class="sub">上次拜訪${online ? '' : '（沒網路，只有這支手機記的）'}：<span class="my">ယခင် သွားရောက်မှု${online ? '' : '（အင်တာနက် မရှိ၍ ဤဖုန်းထဲတွင်သာ မှတ်ထားသည်）'}`
        + `：</span></p><ul>${vItems[0]}</ul>${more}` : '');
  }

  /* ───── 試作（2B）：開始一件試作、填結果結束（失敗要填失敗紀錄） ───── */
  /**
   * R26-1／2（GPT）：這位客戶有沒有「結案狀態未知」（held === null）的後台試作——
   *   看這位客戶**所有**後台試作、推廣（正式編號、客戶臨時編號都對），不是只看 activeTrialFor 挑中的那一件（本機還沒上傳的開始記號會把後台那件遮掉）；
   *   手機已經記「這件已結束」的不算。存結案前、同步完都重新讀，不靠選客戶當下記住的結果
   */
  async function closeUnknownNow(cid) {
    if (!cid || cid === '__new') return false;
    const server = (await Store.getMeta('trials')) || [];
    if (!server.some(t => t && t.held === null)) return false;
    const local = (await myLocal('localTrials')) || [];
    const ended = new Set(local.filter(l => l && l.ended).map(l => l.id));
    const ids = new Set([cid]);
    ((await Store.getMeta('farmers')) || []).forEach(f => { if (!f) return; if (f.id === cid && f.tempId) ids.add(f.tempId); if (f.tempId === cid && f.id) ids.add(f.id); });
    return server.some(t => t && ids.has(t.cid) && (t.cat === '試作' || t.cat === '推廣') && t.held === null && !ended.has(t.id) && !(t.temps || []).some(x => ended.has(x)));
  }
  async function activeTrialFor(cid, cat) {
    const server = (await Store.getMeta('trials')) || [];
    const local = (await myLocal('localTrials')) || [];
    const ended = new Set(local.filter(l => l.ended).map(l => l.id));
    // 0.5.16 第1輪 高：臨時編號 → 正式編號（後台客戶帶 tempId）。離線新增的客戶上傳後手機暫存客戶被清掉，但還沒傳上去的試作仍記臨時編號
    // 第2輪：只有本機還有記臨時編號的試作才讀客戶清單（平常是空的，不拖慢首頁）
    const realOf = {};
    // R29-2（GPT）：畫面還選著暫存客戶（T_），後台的試作已經掛在正式客戶 → 這位的正式、臨時編號都算同一位
    const cids = new Set([cid]);
    if (/^T_/.test(String(cid)) || local.some(l => !l.ended && /^T_/.test(String(l.cid || '')) && l.cid !== cid)) ((await Store.getMeta('farmers')) || []).forEach(f => { if (f && f.tempId && f.id) {
      realOf[f.tempId] = f.id;
      if (f.tempId === cid) cids.add(f.id);
    } });
    const list = server.filter(t => cids.has(t.cid) && t.cat === cat && !ended.has(t.id) && !(t.temps || []).some(x => ended.has(x)))
      .concat(local.filter(l => !l.ended && (cids.has(l.cid) || cids.has(realOf[l.cid])) && l.cat === cat && !server.some(t => t.id === l.id || (t.temps || []).indexOf(l.id) >= 0))); // R30-2（GPT）：本機試作也用同一組正式／臨時客戶編號比對
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
    // 0536（小助手1號，客戶「目前還沒顯示品種」）：0.4.44 進度卡的作物・品種・代碼搬到這一行，0.4.48 又讓舊客戶不顯示 → 選舊農民時哪裡都看不到品種代碼。
    //   舊農民（不是盤商、種子商）也顯示這一行，唯讀：不出現「✎ 修改」、不展開四格（改資料照舊到種植資料）
    const ro = !!sel && sel !== '__new' && !isDealerCat() && !SHOW_PROFILE_ON_VISIT;
    sum.hidden = !(show || ro) || open;
    $n('cropEditBtn').hidden = ro;
    const t = $n('cropSumText');
    t.textContent = [crop ? `作物 သီးနှံ ${cropText(crop)}` : '', vari ? `品種 မျိုး ${vari}` : '', code ? `代碼 ကုဒ် ${code}` : ''].filter(Boolean).join('｜')
      || (ro ? '作物、品種、代碼還沒填（請到「種植資料」補）／သီးနှံ၊ မျိုး၊ ကုဒ် မဖြည့်ရသေး (「စိုက်ပျိုးမှု」 တွင် ဖြည့်ပါ)' : '');
  }
  /* ───── 「這位有沒有結案在等主管確認」：只在 closeWaitNow 一個地方判斷（0518R4，GPT 0518R3-2～4）─────
     原本進度卡、試作框、同步後、存檔前各自判斷、各存一份新舊旗標，一輪一輪補漏洞（0518R1～R3）；改成需要時用「當下」的資料重算：
       ① 這支手機還有沒上傳的結案 → 'local'
       ② 手機快取（試作 held）＋後台最近一次回答（state.histAns：closeWaiting、後台時間、收到時的快取記號）：
          後台回答比快取新（後台時間 > 快取的後台時間），而且收到之後快取沒被改過（cacheRev 一樣）→ 只照後台；否則保守：任一說在等就擋
       ③ 試作 held 是 null（後台讀不到結案分頁）→ unknown（結束試作先擋）
     快取版本＝[srvDataAt 的後台時間, cacheRev]：舊後台沒給時間時 cacheRev 也會換（0518R3-4）；讀版本→讀試作→再讀版本，前後一樣才算
     重算時機：進度卡查完、試作框重畫、同步之後（refreshTrialWaitAfterSync）、存檔最後一次等待 */

  /** ① 純判斷：local＝這位的本機拜訪、ans＝後台最近一次回答（沒有就 null）、snap＝快取快照 { byCat, trials, ver } */
  function decideCloseWait(local, ans, snap) {
    const got = !!ans && !!ans.got;
    const isLocal = local.some(v => v && v.closing && !v.closingDropped && !v.missingCustomer && (v.status === 'pending' || (!got && v.status === 'uploaded'))); // 沒拿到後台回答時，已上傳（手機留 7 天）的也算（0.4.97 手機 4A）
    const fresh = got && typeof ans.closeWaiting === 'boolean' && ans.serverTime > 0 && !!snap.ver && ans.serverTime > snap.ver.t && ans.rev === snap.ver.rev;
    const helds = snap.trials.map(t => t && t.held).concat(snap.allHeld || []); // 0518R4-3：這位全部後台試作的 held（「結案在等」是整位客戶的事，不只挑中的那一件）
    const srvWait = fresh ? (ans.closeWaiting || !!ans.prevWait) /* 0518R6 待確認 2：比快取新、但比已知在等那次舊 */ :(got && (ans.closeWaiting === true || !!ans.lastWait)) || (!!ans && !!ans.prevWait) || helds.some(h => h === true); // 0518R5-2：prevWait＝之前已知在等、這次分不出新舊
    return { wait: isLocal ? 'local' : srvWait ? 'server' : '', fresh, unknown: helds.some(h => h === null) || snap.unknownAll === true }; // 0518R6-1：unknownAll＝closeUnknownNow
  }
  /** ② 手機快取的版本：[srvDataAt 的後台時間, cacheRev]，同一個交易讀 */
  async function cacheVersion() {
    const [sa, rev] = typeof Store.getMetaMany === 'function' ? await Store.getMetaMany(['srvDataAt', 'cacheRev']) : [await Store.getMeta('srvDataAt'), await Store.getMeta('cacheRev')];
    return { t: sa && typeof sa === 'object' ? Number(sa.t) || 0 : 0, rev: rev || '' };
  }
  /** ② 這位進行中的試作、推廣，跟讀的時候的快取版本（前後版本一樣才算，最多 3 次；一直在變 ver＝null，不採用後台回答） */
  async function trialsSnapshotFor(cid) {
    const read = async () => {
      const byCat = {}, trials = [];
      for (const cat of ['試作', '推廣']) { const t = await activeTrialFor(cid, cat); byCat[cat] = t || null; if (t) trials.push(Object.assign({ cat }, t)); }
      // 0518R4-3：這位（正式、臨時編號都算）在後台快取裡的全部試作的 held
      // 0518R6 待確認 1（GPT）：正式 → 臨時編號也算（跟 closeUnknownNow 同一組）
      const cids = new Set([cid]);
      ((await Store.getMeta('farmers')) || []).forEach(f => {
        if (!f) return;
        if (f.tempId === cid && f.id) cids.add(f.id);
        if (f.id === cid && f.tempId) cids.add(f.tempId);
      });
      // 0518R6-1（GPT）：「整位客戶結案狀態未知」跟結案那邊同一個判斷（closeUnknownNow：手機已記結束的那件不算）；這裡的 null 就不再另外算（沒有它的舊測試照舊算）
      const unknownAll = typeof closeUnknownNow === 'function' ? await closeUnknownNow(cid) : null;
      const allHeld = ((await Store.getMeta('trials')) || []).filter(t => t && cids.has(t.cid)).map(t => (t.held === undefined || (unknownAll !== null && t.held === null) ? false : t.held));
      return { byCat, trials, allHeld, unknownAll };
    };
    for (let i = 0; i < 3; i++) {
      const v1 = await cacheVersion(), r = await read(), v2 = await cacheVersion();
      if (v1.t === v2.t && v1.rev === v2.rev) return Object.assign(r, { ver: v1 });
    }
    return Object.assign(await read(), { ver: null });
  }
  /** ② 用當下的資料判斷這位有沒有結案在等（見上面說明）；回 { wait, fresh, unknown, byCat, trials } */
  async function closeWaitNow(cid) {
    const gen = Number(state.waitGen) || 0; // 0518R8-1：跟 ans 同時記下開始時的版本號；套用前比對（applyCloseWait）
    const ans = state.histAns && state.histAns.cid === cid ? state.histAns : null;
    const realOf = {}; ((await Store.getMeta('farmers')) || []).forEach(f => { if (f && f.tempId && f.id) realOf[f.tempId] = f.id; }); // 新客戶還沒上傳完的拜訪記的是臨時編號
    const local = (await myVisits()).filter(v => v.farmerId === cid || realOf[v.farmerId] === cid);
    const snap = await trialsSnapshotFor(cid);
    return Object.assign(decideCloseWait(local, ans, snap), { byCat: snap.byCat, trials: snap.trials, gen });
  }
  /** ③ 把判斷結果套到畫面狀態：closeWait（結案存檔鈕、提示照它）、試作框那一件（held 用最新的）、試作框文字與結束鈕 */
  /*  0518R8-1（GPT）：重算開始後，等待狀態的版本號（state.waitGen：查詢開始、記下新回答都會換）變了 → 這份是舊的，不套用、回 false
      （呼叫端都是 await closeWaitNow 之後同一段程式直接套用，中間沒有別的等待，比對和寫入之間不會被插隊）；套用了回 true */
  function applyCloseWait(cid, cw, fromQuery) {
    if ($('farmer').value !== cid) return false;
    if (cw.gen !== undefined && cw.gen !== (Number(state.waitGen) || 0)) return false;
    // 0518R4-2：這位正在查後台（checking）時，別的重算（存檔、同步後）不蓋掉「查詢中」——存檔、結束試作照「正在查」擋；查完由那次查詢寫結果
    const checking = !!state.closeWait && state.closeWait.cid === cid && state.closeWait.wait === 'checking';
    if (fromQuery || !checking) state.closeWait = { cid, wait: cw.wait, fresh: !!cw.fresh, unknown: !!cw.unknown }; // 0518R5-1：整位客戶的「結案狀態未知」也記下（試作框、結束檢查照它）
    if ((state.cat === '試作' || state.cat === '推廣') && cw.byCat) state.activeTrial = cw.byCat[state.cat] || null;
    paintTrialWait();
    return true;
  }
  /** 這件試作是不是結案待確認（試作框、結束試作檢查用）：這位已經判斷過就照判斷（closeWait），還沒判斷照試作 held */
  function trialCloseWaiting(cid, t) {
    const w = state.closeWait;
    if (cid && w && w.cid === cid && w.wait !== 'checking') return w.wait === 'local' || w.wait === 'server';
    return !!(t && t.held === true);
  }
  /** 0518R5-1（GPT）：這件不能結束是因為「結案狀態未知」嗎——這件 held 是 null，或這位判斷過、整位客戶有任一件後台試作未知（被選中的可能是本機新試作，沒有 held） */
  function trialUnknown(cid, t) {
    if (t && t.held === null) return true;
    const w = state.closeWait;
    return !!(cid && w && w.cid === cid && w.wait !== 'checking' && w.unknown);
  }
  /** ③ 試作框照「結案待確認／結案狀態未知／進行中」改文字和結束鈕；不能結束時收起已開的結束表單（欄位值留著）。不重畫整個試作框，免得洗掉正在填的欄位 */
  function paintTrialWait() {
    const at = state.activeTrial;
    if (!at || !(state.cat === '試作' || state.cat === '推廣')) return;
    const unk = typeof trialUnknown === 'function' ? trialUnknown($('farmer').value, at) : at.held === null, wait = !unk && trialCloseWaiting($('farmer').value, at); // 0518R5-1
    $('trialNow').textContent = wait ? `結案待確認 ပိတ်သိမ်းရန် စစ်ဆေးဆဲ：${cropText(at.item || '（未填品項）')}（主管確認或退回後才能結束／မန်နေဂျာ စစ်ပြီးမှ ပြီးဆုံးနိုင်）`
      : unk ? `結案狀態未知，請洽主管 ပိတ်သိမ်းမှု အခြေအနေ မသိ၊ မန်နေဂျာကို မေးပါ：${cropText(at.item || '（未填品項）')}` // 0518R3-2：同步後變成未知也要擋
      : `進行中 လုပ်ဆောင်ဆဲ：${cropText(at.item || '（未填品項）')}${at.start ? '，' + at.start + ' 開始 စတင်' : ''}${at.pending ? '（還沒上傳 မတင်ရသေး）' : ''}`;
    $('trialEndBtn').hidden = wait || unk;
    $('trialStartBtn').hidden = true; // 5輪抓BUG第1輪（第24任）：有進行中的就不能再開始新的（同 refreshTrialBox 的規則）；寫「進行中」時一起收起開始鈕，不留前一步畫出來的
    if ((wait || unk) && state.trialMode === 'end' && typeof setTrialMode === 'function') setTrialMode(null);
  }
  /**
   * 0518R2-2／R3-3：同步寫進新快取之後，照最新的快取重新判斷這位（結案存檔檢查、試作框都跟著）。
   *   這位正在查（checking）就不動，查完會用最新的資料判斷；這段途中換了客戶、類別就丟掉
   */
  async function refreshTrialWaitAfterSync() {
    const sel = $('farmer').value, cat = state.cat, gen = state.formGen;
    if (!sel || sel === '__new') return;
    const before = state.activeTrial ? state.activeTrial.id : null;
    const cw = await closeWaitNow(sel);
    if (gen !== state.formGen || sel !== $('farmer').value || cat !== state.cat) return;
    if (state.closeWait && state.closeWait.cid === sel && state.closeWait.wait === 'checking') return;
    const now = (cat === '試作' || cat === '推廣') && cw.byCat[cat] ? cw.byCat[cat].id : null;
    if ((cat === '試作' || cat === '推廣') && now !== before) { await refreshTrialBox(); return; } // 換了一件（或結束了）才整個重畫
    if (applyCloseWait(sel, cw) === false) return; // 0518R8-1：途中有較新的回答，較新的那次會自己套用
    if (typeof refreshSave === 'function') refreshSave();
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
    // 0518R4：試作（held）和「這位有沒有結案在等」用同一份當下的資料判斷（closeWaitNow）
    // 0518R9-1（GPT）：重算途中版本號換了（較新的查詢已套用）→ 這份整份作廢（試作那件、未知、等待狀態都不寫），用最新的再算；
    //   一直在換（3 次）就整個不畫，交給較新的查詢套用。比對和下面的寫入在同一段程式，中間沒有等待
    let cw = null;
    for (let i = 0; sel !== '__new' && typeof closeWaitNow === 'function'; i++) {
      cw = await closeWaitNow(sel);
      if (!(cw.gen !== undefined && cw.gen !== (Number(state.waitGen) || 0))) break;
      if (i >= 2) return;
    }
    const t = sel === '__new' ? null : cw ? cw.byCat[cat] || null : await activeTrialFor(sel, cat);
    if (gen !== state.formGen || sel !== $('farmer').value || cat !== state.cat) return; // 查的途中換了類別（自動切到試作），舊結果丟掉
    state.activeTrial = t;
    if (cw && !(state.closeWait && state.closeWait.cid === sel && state.closeWait.wait === 'checking')) state.closeWait = { cid: sel, wait: cw.wait, fresh: !!cw.fresh, unknown: !!cw.unknown };
    // R25-2（GPT／Gemini）：held 是 null（後台讀不到結案分頁）→ 寫「結案狀態未知」，開始、結束都先不給按（不知道是不是已經在等主管確認）
    // 0518R5-1（GPT）：整位客戶任一件後台試作未知也算（被選中的可能是本機新試作）；這次重算的 unknown 直接用（正在查時 closeWait 不寫）
    const unk = !!t && (t.held === null || !!(cw && cw.unknown) || (typeof trialUnknown === 'function' && trialUnknown(sel, t)));
    // 0.5.18（抓BUG A2）：結案已送、等主管確認（後台 held，或進度卡判斷這位有結案在等）→ 跟首頁一樣寫「結案待確認」，不給按結束
    const waitC = !!t && !unk && typeof trialCloseWaiting === 'function' && trialCloseWaiting(sel, t);
    $('trialNow').textContent = waitC ? `結案待確認 ပိတ်သိမ်းရန် စစ်ဆေးဆဲ：${cropText(t.item || '（未填品項）')}（主管確認或退回後才能結束／မန်နေဂျာ စစ်ပြီးမှ ပြီးဆုံးနိုင်）` : unk ?`結案狀態未知，請洽主管 ပိတ်သိမ်းမှု အခြေအနေ မသိ၊ မန်နေဂျာကို မေးပါ：${cropText(t.item || '（未填品項）')}` : t ? `進行中 လုပ်ဆောင်ဆဲ：${cropText(t.item || '（未填品項）')}`
      + `${t.start ? '，' + t.start + ' 開始 စတင်' : ''}${t.pending ? '（還沒上傳 မတင်ရသေး）' : ''}` : `這位客戶目前沒有進行中的${state.cat}。／ဤဖောက်သည်တွင် လက်ရှိ လုပ်ဆောင်ဆဲ ${CAT_MY[state.cat]} မရှိပါ။`;
    $('trialStartBtn').hidden = !!t || sel === '__new'; $('trialEndBtn').hidden = !t || unk; // 0534：新農民表單本來就自動打開（按了反而收起來）→ 不顯示「＋ 開始新的」
    if (waitC) $('trialEndBtn').hidden = true; // 0.5.18 A2：結案待確認也不給按結束
    // 0.5.19 B1（第18任抓BUG）：別人負責的農民（主管派任務來看的），後台不收開始／結束（handleTrial_ ownTrial）→ 手機也不給按，寫明請負責業務處理。
    //   規則同後台：負責業務空白或是自己才可以；還不知道自己是誰（myName 空）時不擋，交給後台擋並回 trialDropped
    const owner = sel === '__new' ? '' : String(((state.allCustomers || []).find(x => x.id === sel) || {}).staff || '');
    const notMine = !!owner && !!state.myName && owner !== String(state.myName);
    if (notMine) { $('trialStartBtn').hidden = true; $('trialEndBtn').hidden = true; $('trialNow').textContent += `（負責業務：${owner}，開始、結束請由負責業務處理／တာဝန်ခံ ${owner} သာ စတင်၊ ပြီးဆုံးနိုင်သည်）`; }
    trialBoxMode(sel, cat, t, unk, waitC, notMine);
    trialBoxOldKind(sel, cat, t, notMine);
    if (typeof paintNewTrial === 'function') paintNewTrial(); // 0534：新農民改寫框上方說明（不寫「目前沒有進行中」）、品項＝作物、品種那一行
  }
  /**
   * 開始試作表單「有沒有被動過」（第28任 2026-11-19 董事長「沒填就不問」，抓BUG第12輪 手機3）。
   * 0.4.63 起返回鍵、換客戶只要試作表單開著就當成「填過」——那時表單要業務自己按才會開；0.5.08 起新增對照／推廣農民、
   * 0.5.26 起分類就是這一類的舊農民，程式會自動打開並帶入今天、作物，結果什麼都沒填按返回也被問「確定要回首頁？」。
   * 做法：程式自動打開時記下當下的值（markTrialAuto）；之後品項、其他品項、用量、開始日跟記下的不一樣才算動過。業務自己按按鈕打開的照舊一律算。
   */
  const trialStartValues = () => ['tItem', 'tItemOther', 'tDosage', 'tStart'].map(id => String($n(id).value || ''));
  function markTrialAuto() { state.trialAuto = trialStartValues(); }
  function trialTouched() {
    if (!state.trialMode) return false;
    if (!state.trialAuto) return true;
    const now = trialStartValues();
    return now.some((v, i) => v !== state.trialAuto[i]);
  }
  /** 試作框：照這位有沒有進行中的、能不能結束、是不是別人負責，收起或打開開始／結束表單（舊的試作／推廣農民自動打開、帶入作物） */
  function trialBoxMode(sel, cat, t, unk, waitC, notMine) {
    if ((state.trialMode === 'end' && (!t || unk)) || (state.trialMode === 'start' && t) || (state.trialMode === 'end' && waitC) || (notMine && state.trialMode)) setTrialMode(null);
    else if (sel === '__new' && !state.trialMode) { setTrialMode('start'); markTrialAuto(); } // 0.5.08 試作／推廣新增農民：直接打開「開始新的」表單（一定要開始，見 trialProblem）；第28任記成程式自動打開
    else if (sel && sel !== '__new' && !t && !notMine && !state.trialMode && state.trialStartAuto !== sel) {
      // 0.5.26（客戶截圖 U Nga Shint：已經是推廣農民、有作物，還要先按「開始新的推廣」再選一次品項）：
      //   這位的分類就是這一類（推廣農民在推廣、試作農民在試作）而且目前沒有進行中的 → 直接打開開始表單，品項先帶入他的作物（可以改；不想開始就再按一次收起）
      const cust = (state.allCustomers || []).find(x => x.id === sel) || {};
      if (cust.kind === cat + '農民') {
        state.trialStartAuto = sel; // 同一位只自動打開一次（業務收起後不再一直打開）
        setTrialMode('start');
        const crop = String(cust.crop || '').trim(), it = $n('tItem');
        if (crop && !it.value && [...(it.options || [])].some(o => o.value === crop)) { it.value = crop; if (typeof refreshTrialOther === 'function') refreshTrialOther(); }
        markTrialAuto(); // 第28任：程式自動打開、品項是程式帶的，業務沒動就返回不問
        refreshSave(); // 帶入品項後重新檢查存檔（不然還停在「請填推廣品項」）
      }
    }
  }
  /** 試作框：分類就是這一類的舊農民、沒有進行中的 → 按鈕、說明改成「存檔就記成這位的試作／推廣」 */
  function trialBoxOldKind(sel, cat, t, notMine) {
    // 0.5.26 第24任（董事長截圖 U Nga Shint「舊的農民還是出現推廣」）：上面那段表單已自動打開、品項已帶入，但說明還寫「目前沒有進行中的推廣」、
    //   還顯示「＋ 開始新的推廣」→ 看起來像還要再開始一次。董事長選「拿掉按鈕，改一句說明」：分類就是這一類的舊農民、表單開著、沒有進行中的 → 不顯示按鈕，說明改成存檔就記成這位的推廣／試作
    // 抓BUG第2輪（小助手2）：不再要求表單開著——原本收起後只要重畫一次（同步完、換類別再換回來），oldKindFor 就被清掉，
    //   再按「＋ 開始新的」打開表單時按鈕不會變「這次不開始（收起）」、說明也停在「目前沒有進行中」。按鈕字、說明照開／收由 paintOldKindBtn、paintOldKind 自己分
    const oldKind = !!sel && sel !== '__new' && !t && !notMine && ((state.allCustomers || []).find(x => x.id === sel) || {}).kind === cat + '農民';
    state.oldKindFor = oldKind ? { cid: sel, cat } : null; // 抓BUG第1輪（小助手2）：改品項時 refreshSave 用它重寫說明（paintOldKind）
    if (oldKind) {
      if (typeof paintOldKindBtn === 'function') paintOldKindBtn(); else $('trialStartBtn').hidden = true; // 抓BUG第1輪 4（董事長選「加小連結這次不開始」）：按鈕不藏，改「這次不開始（收起）」
      paintOldKind();
    }
  }
  /**
   * 抓BUG第1輪（小助手2）：舊試作／推廣農民的說明照「現在選的品項」寫。
   * 原因（讀程式確認）：原本只在 refreshTrialBox 寫一次，品項下拉的 change 只叫 refreshSave → 業務把帶入的作物改掉，說明還寫「已帶入他的作物（舊的）」；
   *   作物不在清單、說明寫「請選下面的品項」，選好後還是那句；選「其他」再碰到重畫會寫出內部代碼 __other。
   * 跟 paintNewTrial 一樣由 refreshSave 叫（不另外加事件，不動 init 接線）；不是這位、這一類、開始表單就不動
   */
  function paintOldKind() {
    const ok = state.oldKindFor, sel = $n('farmer').value;
    if (!ok || ok.cid !== sel || ok.cat !== state.cat || state.trialMode !== 'start') return;
    const cat = ok.cat, raw = String($n('tItem').value || '').trim();
    const crop = String(((state.allCustomers || []).find(x => x.id === sel) || {}).crop || '').trim();
    const other = raw === TRIAL_OTHER ? String($n('tItemOther').value || '').trim() : '';
    const what = raw === TRIAL_OTHER ? (other ? '品項：' + other : '請在下面填品項')
      : !raw ? '請選下面的品項' : raw === crop ? '品項已帶入他的作物（' + cropText(raw) + '，可以改）' : '品項：' + cropText(raw);
    $('trialNow').textContent = `舊${cat}農民：${what}，存檔就記成這位的${cat}／${CAT_MY[cat] || ''} လယ်သမားဟောင်း - သိမ်းလျှင် ဤလယ်သမား၏ မှတ်တမ်းဝင်မည်`;
  }
  function setTrialMode(m) {
    state.trialMode = m;
    state.trialAuto = null; // 預設當成業務自己打開；程式自動打開的地方呼叫完再記 markTrialAuto()
    $('trialStartForm').hidden = m !== 'start'; $('trialEndForm').hidden = m !== 'end';
    $('trialStartBtn').setAttribute('aria-pressed', String(m === 'start')); $('trialEndBtn').setAttribute('aria-pressed', String(m === 'end'));
    if (m === 'start' && !$('tStart').value) { $('tStart').value = mmDay(0); } // 業務BUG#4：緬甸的今天
    if (m === 'start') fillTrialItems(); // 0.4.89 品項下拉＝最新的作物選項
    if (typeof paintNewTrial === 'function') paintNewTrial(); // 0534
    if (m === 'end' && !$('tYieldUnit').value) $('tYieldUnit').value = (state.options && state.options.yieldUnit) || '籃';
    placeFailBox(); // 0.4.74 失敗欄位放哪、要不要顯示統一由 placeFailBox 決定（試作結束／種植失敗／結案試作失敗）
    $('harvestBox').hidden = $('tOutcome').value === '失敗'; // 0.4.38 成功／結束 → 收成報告；失敗 → 失敗紀錄
    refreshSave();
    if (typeof paintOldKindBtn === 'function') paintOldKindBtn(); // 抓BUG第1輪 4：舊農民按「這次不開始」收起／再打開，按鈕字和說明跟著換
  }
  /**
   * 抓BUG第1輪 4（小助手2 提出，董事長 2026-11-17 選「加小連結這次不開始」）：舊推廣／試作農民開始表單自動打開後，
   *   原本按鈕藏起來 → 只要存檔就一定開始一件，業務只是去看看也沒辦法不開始。
   *   改成：表單開著時按鈕寫「這次不開始（收起）」（同一顆按鈕，按了 setTrialMode(null)）；收起後變回「＋ 開始新的…」、說明寫目前沒有進行中，要開始再按一次。
   *   只管 refreshTrialBox 記下的這一位（state.oldKindFor）、沒有進行中的那一類
   */
  function paintOldKindBtn() {
    const ok = state.oldKindFor, sel = $n('farmer').value, btn = $n('trialStartBtn');
    if (!ok || ok.cid !== sel || ok.cat !== state.cat || state.activeTrial || !btn) return;
    btn.hidden = false;
    if (state.trialMode === 'start') btn.innerHTML = `這次不開始${ok.cat}（收起）<span class="my">ယခုအကြိမ် မစတင်ပါ (ခေါက်သိမ်း)</span>`;
    else {
      btn.innerHTML = `＋ 開始新的${ok.cat}<span class="my">${CAT_MY[ok.cat] || ''} အသစ် စတင်</span>`;
      $n('trialNow').textContent = `這位客戶目前沒有進行中的${ok.cat}。／ဤဖောက်သည်တွင် လက်ရှိ လုပ်ဆောင်ဆဲ ${CAT_MY[ok.cat] || ''} မရှိပါ။`;
    }
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
    const fk = sel && sel !== '__new' ? (state.allCustomers || []).find(x => x.id === sel) : null;
    if (fk && KIND_CAT[fk.kind]) return fk.kind; // 0.5.11 標題照這位的類型欄（試作／推廣農民沒有進行中試作也不會寫成一般農民結案）
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
    const cbx = typeof document !== 'undefined' && document.getElementById && document.getElementById('closeBox'); if (cbx && cbx.classList) cbx.classList.toggle('failed', !!closeFailOn()); // 第24任 第六批⑪
  }
  /** 結案畫面：查這位農民有沒有進行中的試作（先）或推廣，有就顯示結果欄（必填） */
  async function refreshCloseTrial() {
    const box = $n('closeTrialBox'), sel = $('farmer').value;
    if (state.cat !== '結案' || !sel || sel === '__new') {
      state.closeTrial = null;
      state.closeTrialFor = null;
      state.closeTrialSel = null;
      box.hidden = true;
      placeFailBox();
      refreshCloseTitle();
      return;
    }
    if (state.closeTrialFor === sel || state.closeTrialSel === sel) return; // 這位已經查過或正在查（結果欄已經在填，不要洗掉）
    prefillMeasure(sel); // 0.4.77 換農民：量測清空，帶品種、播種日、今天
    state.closeTrial = null; state.closeTrialFor = null; // 查完之前 closeProblem 會擋「讀取中」，不會送出沒帶結果的結案
    state.closeTrialSel = sel; // R27-3：結案畫面現在是這位（查詢途中同步完也知道要重查這位）
    await recheckCloseTrial(true);
  }
  /**
   * R27（GPT 1～4）：結案欄「是哪一件試作、結案狀態未知嗎」只在這裡判斷——選客戶時、前景同步完、背景同步完、按儲存前都呼叫它。
   *   每次查詢有序號（closeSeq）：途中又有新的一次查詢、換了客戶或表單，這次的結果就丟掉（舊的不會蓋掉新的，R27-1、3）；
   *   試作換了一件（同步後才出現、或換成別件）→ 試作結果要重選，價格、量測等其他已填的不動（R27-2）。
   *   回傳：true＝跟原本不同（按儲存前遇到就先不送，請業務再確認）、false＝一樣、null＝這次結果作廢
   */
  async function recheckCloseTrial(first) {
    const sel = $('farmer').value;
    if (state.cat !== '結案' || !sel || sel === '__new' || state.closeTrialSel !== sel) return null;
    const gen = state.formGen, seq = (state.closeSeq = (Number(state.closeSeq) || 0) + 1);
    // R33-1（GPT）：查詢分好幾次讀（後台試作、本機試作、客戶清單…），途中同步把新資料寫進來會讀到一半舊、一半新（例如以為沒有試作、結果沒填就存）→
    //   查詢前後各讀一次資料版本（srvDataAt，每次同步寫入都會換），不一樣就整個重查；最多 3 次還不穩定，這次作廢（存檔就先不送）
    // R34-1（GPT）：版本也要涵蓋手機自己的寫入——清理暫存試作、暫存客戶不會改 srvDataAt，一起比內容才抓得到
    // R35-1（GPT）：三個在同一個交易裡讀（getMetaMany），中間不會插進清理、同步的寫入
    // R36-1（GPT）：有 lookupVersion 就用它（同一個交易裡連拜訪編號一起讀：同步清掉舊拜訪也看得出來）
    const verNow = async () => (typeof Store !== 'undefined' && Store && Store.lookupVersion ? await Store.lookupVersion()
      : typeof Store !== 'undefined' && Store && Store.getMetaMany ? JSON.stringify(((await Store.getMetaMany(['srvDataAt', 'localTrials', 'localCustomers'])) || []).map(x => x || null))
      : typeof Store !== 'undefined' && Store && Store.getMeta ? JSON.stringify([(await Store.getMeta('srvDataAt')) || null, (await Store.getMeta('localTrials')) || null, (await Store.getMeta('localCustomers')) || null]) : '');
    let hit = null, unk = false, stable = false, verOk = '';
    for (let tries = 0; tries < 3 && !stable; tries++) {
      const v0 = await verNow(); verOk = v0;
      hit = null;
      for (const cat of ['試作', '推廣']) { const t = await activeTrialFor(sel, cat); if (t) { hit = { cat, t }; break; } }
      unk = typeof closeUnknownNow === 'function' ? await closeUnknownNow(sel) : false; // R26-1／2：這位所有相關後台試作只要有一件結案狀態未知就擋（抽函式跑的舊測試沒有它）
      stable = (await verNow()) === v0;
    }
    if (gen !== state.formGen || sel !== $('farmer').value || state.cat !== '結案') return; // 查的途中換了客戶或離開結案
    if (!stable) { // R33-1：一直在變（同步中），這次結果作廢
      // R34-2（GPT）：第一次查詢就作廢時，結案畫面會一直停在「正在查」→ 過一下自動再查一次（客戶、表單沒換才查；同步完也會重查）
      // R35-2（GPT）：同步後的重查（first=false）一直不穩定也要排重查（前面第一次查詢也作廢時，不然會卡在「正在查」）
      if (typeof setTimeout === 'function') setTimeout(() => { if (state.closeTrialSel === sel && gen === state.formGen && state.cat === '結案' && (first ? state.closeTrialFor !== sel : true)) recheckCloseTrial(first && state.closeTrialFor !== sel); }, 800);
      return null;
    }
    if (seq !== state.closeSeq) return null; // R27-1／3：途中又有一次較新的查詢，這次的結果作廢
    // R28-3（GPT）：同一件試作從臨時編號變成正式編號（後台 temps 對得到）不算換了一件，結果不清
    const swapped = !first && !sameCloseTrial(state.closeTrial, hit);
    const changed = !first && (swapped || !!state.closeTrialUnknown !== unk);
    if (!hit || swapped) $n('cTrialOutcome').value = ''; // 沒有試作、或換了一件：結果要重選（別件的結果不能沿用）
    state.closeTrial = hit; state.closeTrialFor = sel;
    state.closeTrialUnknown = unk; // R25-2：結案狀態未知 → 先不給送結案
    state.closeVer = verOk; // R37-1：這次判斷是照哪一版資料（存檔時同一個交易裡比對）
    refreshCloseTitle(); // 0.4.75 低3：標題改成這位農民的實際分類（跟送出的 group 同一套）
    paintCloseTrial();
    return changed;
  }
  /** R28-3：兩次查到的是不是同一件試作——編號相同，或其中一件的臨時編號清單（temps）有另一件的編號 */
  function sameCloseTrial(a, b) {
    const ta = a && a.t, tb = b && b.t;
    if (!ta || !tb) return !ta && !tb;
    const ia = String(ta.id), ib = String(tb.id);
    return ia === ib || (Array.isArray(tb.temps) && tb.temps.map(String).indexOf(ia) >= 0) || (Array.isArray(ta.temps) && ta.temps.map(String).indexOf(ib) >= 0);
  }
  /** 結案欄的試作區塊：照 state.closeTrial、state.closeTrialUnknown 畫（選客戶時、同步完重新判斷後都用） */
  function paintCloseTrial() {
    const box = $n('closeTrialBox'), hit = state.closeTrial, unk = !!state.closeTrialUnknown, cat = hit ? hit.cat : '試作';
    box.hidden = !hit && !unk;
    if (hit || unk) {
      $n('closeTrialLab').innerHTML = `${cat}結果（必填）<span class="my">${CAT_MY[cat] || ''} ရလဒ် (မဖြစ်မနေ)</span>`;
      $n('closeTrialNow').textContent = unk ? `結案狀態未知，請洽主管（這位的${cat}可能已經在等主管確認，先不要送結案）／ပိတ်သိမ်းမှု အခြေအနေ မသိ၊ မန်နေဂျာကို မေးပါ (အတည်ပြုစောင့်နေနိုင်၍ ပိတ်သိမ်းမှု မပို့သေးပါနှင့်)` : `進行中 လုပ်ဆောင်ဆဲ：${cropText(hit.t.item || '（未填品項）')}`
        + `${hit.t.start ? '，' + hit.t.start + ' 開始 စတင်' : ''}。結案前請先填${hit.cat}成功或失敗／ပိတ်သိမ်းမီ ရလဒ် ရွေးပါ`;
    }
    syncClosePlantFail(); // 0.4.75 試作失敗 → 種植失敗自動勾
    placeFailBox();
    refreshSave();
  }
  /** R26-1／R27-4：同步完（前景、背景）重新判斷正在填的結案（不在結案畫面就不做） */
  async function refreshCloseUnknown() {
    if (state.view !== 'visit') return;
    if (typeof refreshTrialWaitAfterSync === 'function') await refreshTrialWaitAfterSync(); // 0518R2-2：試作框也照同步後的快取重新判斷
    await recheckCloseTrial(false);
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
  const DC_NOTE_PH = { sign: '寫簽約內容，例如簽了什麼、從什麼時候開始：簽 A 品牌種子代理，12 月起每月進 50 包\nစာချုပ် အကြောင်းအရာ ရေးပါ၊ ဥပမာ - A တံဆိပ် မျိုးစေ့ ကိုယ်စားလှယ် စာချုပ်၊ ဒီဇင်ဘာမှစ၍ လစဉ် အိတ် ၅၀ ယူမည်',
    old: '例：談成，下個月開始進 A 品牌種子／沒談成，老闆只賣自己的品牌\nဥပမာ - သဘောတူပြီ၊ နောက်လ A တံဆိပ် မျိုးစေ့ ယူမည် / မအောင်မြင်၊ ဆိုင်ရှင်က ကိုယ်ပိုင်တံဆိပ်သာ ရောင်းသည်' };
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
    const sh = typeof document !== 'undefined' && document.getElementById ? document.getElementById('signHint') : null; if (sh) sh.hidden = !state.signOnly; // 第24任 第六批⑫
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
    // 0.5.26（第23任，客戶問「這已經沒功能了吧，下面還有可以填聊天的視窗」）：「沒見到」0.5.13 已拿掉、「有見到」一進來就選好，
    // 剩下的綠色「有見到農民 → 寫聊了什麼」按了也沒變化，整塊不再顯示；選好的狀態（meetChosen）照舊，拍照、打字欄照舊出現
    $('noMeetBox').hidden = true;
    if (!shown) state.noMeet = false;
    // 0.5.13 董事長截圖「這個功能拿掉，直接在有見到農民裡面回報就好」＋「盤商／種子商的失敗（沒見到／被拒絕）也移除」：
    // 不再有「沒見到」那顆，「有見到」直接選好（不用多按一下就出現拍照、打字；盤商、種子商的「已簽約」也直接出現）
    $('meetNo').hidden = true;
    if (shown) { state.noMeet = false; state.meetChosen = true; }
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
  function resetNoMeet() {
    state.noMeet = false;
    state.meetChosen = false;
    $('nmReason').selectedIndex = 0;
    $('nmNote').value = '';
    $('nmNext').value = '';
    $('noteBox').hidden = false;
    refreshNoMeet();
  }
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
    const miss = [['fWeather', '天氣 ရာသီဥတု'], ['fTemp', '溫度 အပူချိန်'], ['fFert', '施肥情況 မြေသြဇာ အခြေအနေ'], ['fWater', '水分 ရေ'], ['fPest', '病蟲害 ပိုးမွှား / ရောဂါ'], ['fReason', '失敗原因 မအောင်မြင်သည့် အကြောင်းရင်း']]
      .filter(([id]) => !String($(id).value).trim()).map(([id, n]) => (id === 'fTemp' && $(id).validity && $(id).validity.badInput ? '溫度（只能填數字，不要用逗號） အပူချိန် (ဂဏန်းသာ ဖြည့်ပါ၊ ကော်မာ မထည့်ပါနှင့်)' : n)); // 0.5.18 A3：數字框打「38,5」值是空的，原本說「沒填溫度」
    if ($('fPest').value === '有' && !$('fPestNote').value.trim()) miss.push('病蟲害說明 ပိုးမွှား / ရောဂါ အသေးစိတ်');
    return miss;
  }
  const collectFailure = () => ({ weather: $('fWeather').value, temp: $('fTemp').value, fert: $('fFert').value.trim(), water: $('fWater').value, pest: $('fPest').value, pestNote: $('fPestNote').value.trim(), reason: $('fReason').value.trim() });
  function trialProblem() {
    // 0.5.09：0.5.08 的「試作／推廣新增農民一定要同時開始」拿掉——現在建檔就寫死是試作／推廣農民（客戶清單類型欄），沒開始也不會掉到一般
    if (state.trialMode === 'end' && !state.activeTrial) return `找不到進行中的${state.cat}，請重新選一次客戶／${CAT_MY[state.cat]} ရှာမတွေ့၊ ဖောက်သည် ပြန်ရွေးပါ`; // T9
    if (state.trialMode === 'end' && state.closeWait && state.closeWait.cid === $('farmer').value && state.closeWait.wait === 'checking') return '正在查這位之前的結案紀錄，請等幾秒再按／ယခင် ပိတ်သိမ်းမှု စစ်နေသည်၊ စက္ကန့်အနည်းငယ် စောင့်ပါ'; // 0.5.18 R2（GPT 0518R1-1）：還不知道有沒有結案在等，先不給結束
    if (state.trialMode === 'end' && state.activeTrial && (typeof trialUnknown === 'function' ? trialUnknown($('farmer').value, state.activeTrial) : state.activeTrial.held === null)) return '這件的結案狀態未知（後台讀不到結案紀錄），現在不能結束，請洽主管／ပိတ်သိမ်းမှု အခြေအနေ မသိ (ဆာဗာ ဖတ်မရ)၊ ယခု ပြီးဆုံး၍ မရပါ၊ မန်နေဂျာကို မေးပါ'; // 0518R3-2
    if (state.trialMode === 'end' && typeof trialCloseWaiting === 'function' && trialCloseWaiting($('farmer').value, state.activeTrial)) return `這位已送結案、等主管確認中，現在不能結束${state.cat}`
      + `（主管確認或退回後再做）／ပိတ်သိမ်းရန် ပို့ထားပြီး မန်နေဂျာ စစ်ဆေးဆဲ၊ ယခု ပြီးဆုံး၍ မရပါ (အတည်ပြု သို့မဟုတ် ပြန်ပို့ပြီးမှ လုပ်ပါ)`; // 0.5.18 A2
    // 0.5.18（抓BUG A4）：收成日期不能是未來，也不能早於開始日（年份滑錯原本照收，報告上日期就錯）
    if (state.trialMode === 'end' && $('tOutcome').value !== '失敗') {
      const hd = String(($('hDate') || {}).value || ''), st = String((state.activeTrial && state.activeTrial.start) || '').slice(0, 10);
      if (/^\d{4}-\d\d-\d\d$/.test(hd)) {
        if (hd > mmDay(0)) return '收成日期不能是未來的日期／ရိတ်သိမ်းရက်သည် အနာဂတ် မဖြစ်ရ';
        if (/^\d{4}-\d\d-\d\d$/.test(st) && hd < st) return `收成日期不能早於開始日（${st}）／ရိတ်သိမ်းရက်သည် စတင်ရက်ထက် မစောရ`;
      }
    }
    // 0534（小助手1號）：新增試作／推廣農民一律要同時開始、品項（＝上面的作物）一定要有。
    //   0.5.09 拿掉強制開始，理由是農民分類已寫死在類型欄、不開始也不會掉到一般；但現在品項就是作物（不用多填），
    //   不開始的話這位推廣農民沒有推廣紀錄、主管和業務都看不到推廣的品項品種（客戶反映的問題）→ 新農民恢復一定要有；舊農民照舊可以不開始
    const nf = typeof newTrialFarmer === 'function' && newTrialFarmer();
    if (nf && state.trialMode !== 'start') return `新${state.cat}農民要同時開始這次的${state.cat}，請重新選一次「＋ 新增」／${CAT_MY[state.cat]} လယ်သမားအသစ်အတွက် တစ်ပြိုင်နက် စတင်ရမည်၊ 「＋ အသစ်」 ကို ပြန်ရွေးပါ`;
    if (nf && !trialItemValue()) return `請先選上面的作物（新農民這次${state.cat}的品項就是作物）／အပေါ်က သီးနှံ အရင်ရွေးပါ (လယ်သမားအသစ်အတွက် ပစ္စည်းမှာ သီးနှံ ဖြစ်သည်)`;
    if (state.trialMode === 'start' && !trialItemValue()) return `請填${state.cat}品項／ပစ္စည်းအမည် ဖြည့်ပါ`; // 0.4.89：下拉沒選、選「其他」沒填都擋
    // 0.5.16 第2輪 中：開始日選錯年月（例如 2099、跨年選反）原本照收 → 不算進本月「開始試作」、週數永遠第 1 週；比照種植日期擋未來、也不收一年以前
    if (state.trialMode === 'start') {
      const sd = String(($('tStart') || {}).value || '');
      if (sd && /^\d{4}-\d\d-\d\d$/.test(sd)) {
        const today = mmDay(0), yearAgo = mmDay(-365);
        if (sd > today) return '開始日不能是未來的日期／စတင်ရက်သည် အနာဂတ် မဖြစ်ရ';
        if (sd < yearAgo) return '開始日超過一年前，請確認年份／စတင်ရက် တစ်နှစ်ကျော်၊ နှစ်ကို စစ်ပါ';
      }
    }
    // 0.5.16 第1輪 中：結束時的株高、穗粒數、產量打負數或打成「1,200」（瀏覽器給空值）原本不擋，後台默默丟掉 → 比照採收量測先擋
    if (state.trialMode === 'end') {
      const T_NUMS = [['tHeight', '株高 အပင်အမြင့်'], ['tGrains', '穗粒數 တစ်နှံပါ အစေ့အရေအတွက်'], ['tYield', '產量 အထွက်နှုန်း']];
      const bad = T_NUMS.filter(([id]) => { const el = $(id); return !!(el && el.validity && el.validity.badInput); }).map(([, n]) => n);
      if (bad.length) return `${bad.join('、')}請只填數字（用 0～9 和小數點，不要用逗號）／ဂဏန်းသာ ဖြည့်ပါ (ကော်မာ မထည့်ပါနှင့်)`;
      const negT = T_NUMS.filter(([id]) => { const el = $(id); return !!el && String(el.value).trim() !== '' && !(Number(el.value) >= 0); }).map(([, n]) => n);
      if (negT.length) return `${negT.join('、')}不能是負數／အနုတ် မဖြစ်ရ`;
    }
    if (state.trialMode === 'end' && $('tOutcome').value === '失敗') {
      const miss = failMissing();
      if (miss.length) return `${state.cat}失敗要填：${miss.join('、')}／မအောင်မြင်လျှင် ဖြည့်ရန် လိုသေးသည်`;
    }
    if (plantFailOn()) {
      const miss = failMissing();
      if (miss.length) return `種植失敗要填：${miss.join('、')}／စိုက်ပျိုးမှု မအောင်မြင်လျှင် ဖြည့်ရန် လိုသေးသည်`;
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
    $n('mDays').value = isFinite(d) && d >= 0 ? d + ' 天／' + d + ' ရက်' : '';
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
    // 0.4.92 低1（第11任第四輪）：數字框打成「1,5」「12,000」時瀏覽器給的值是空的（validity.badInput）→ 原本當沒填、整份量測默默不送 → 先擋、請只填數字
    const badM = [['mCount', '樣本數 နမူနာ အရေအတွက်'], ['mWeight', '總重量 စုစုပေါင်း အလေးချိန်'], ['mLength', '長度 အရှည်'], ['mRows', '穗行數 အစေ့တန်း အရေအတွက်']].filter(([id]) => {
      const el = $n(id);
      return !!(el && el.validity && el.validity.badInput);
    }).map(([, n]) => n);
    if (badM.length) return `${badM.join('、')}請只填數字（用 0～9 和小數點，不要用逗號）／ဂဏန်းသာ ဖြည့်ပါ (ကော်မာ မထည့်ပါနှင့်)`;
    const neg = [['mCount', '樣本數 နမူနာ အရေအတွက်'], ['mWeight', '總重量 စုစုပေါင်း အလေးချိန်'], ['mLength', '長度 အရှည်'], ['mRows', '穗行數 အစေ့တန်း အရေအတွက်']].filter(([id]) => String($n(id).value).trim() !== '' && !(Number($n(id).value) >= 0)).map(([, n]) => n);
    if (neg.length) return `${neg.join('、')}不能是負數／အနုတ် မဖြစ်ရ`;
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
  /** 0.5.26：這次農民結案是不是「作物死掉、沒收成」——勾了種植失敗（但進行中那件結果不是「成功」），或進行中試作／推廣結果選「失敗」
   *  抓BUG 中2（小助手1 實走）：勾種植失敗又選結果「成功」互相矛盾 → 不算失敗，價格照樣要填 */
  function closeFailNow() {
    const box = typeof document !== 'undefined' && document.getElementById('closeTrialBox') && !$n('closeTrialBox').hidden;
    const out = box ? $n('cTrialOutcome').value : '';
    if (out === '失敗') return true;
    return !!(typeof closePlantFailOn === 'function' && closePlantFailOn()) && out !== '成功';
  }
  function closeProblem() {
    // 0.4.92 低5（第11任第四輪）：結案（含盤商、種子商結案／簽約）送出後在等主管確認時，同一位還能再送一次 → 後台出兩筆待確認。
    // state.closeWait 由打卡畫面的進度卡寫（renderProgress：後台最近一筆結案還「待主管確認」，或這支手機還有沒上傳的結案）
    const waitOf = cid => !!cid && !!state.closeWait && state.closeWait.cid === cid && !!state.closeWait.wait;
    const WAIT_MSG = state.closeWait && state.closeWait.wait === 'checking' ? '正在查這位之前的結案紀錄，請等幾秒再按／ယခင် ပိတ်သိမ်းမှု စစ်နေသည်၊ စက္ကန့်အနည်းငယ် စောင့်ပါ' // 0.4.97 手機 4B
      : '這位已送結案、等主管確認中，不能再送一次（主管確認或退回後才能再送）／ပိတ်သိမ်းရန် ပို့ပြီးပါပြီ၊ မန်နေဂျာ စစ်ဆေးနေဆဲ၊ ထပ်မပို့ရ';
    if (state.dealerClose) { // 0.4.42 盤商、種子商結案：洽談結果＋說明必填，送主管審核
      const sel = $('farmer').value;
      if (!sel || sel === '__new') return '請先選要結案的' + state.cat + '／ဖောက်သည် ရွေးပါ';
      if (waitOf(sel)) return WAIT_MSG; // 0.4.92 低5
      const miss = [['dcOutcome', '洽談結果 ဆွေးနွေးမှု ရလဒ်'], ['dcNote', '說明 မှတ်ချက်']].filter(([id]) => !String($n(id).value).trim()).map(([, n]) => n);
      return miss.length ? `結案要填：${miss.join('、')}／ပိတ်သိမ်းရန် ဖြည့်ပါ` : '';
    }
    if ((state.cat === '盤商' || state.cat === '種子商') && dealerSignOn() && waitOf($('farmer').value)) return WAIT_MSG; // 0.4.92 低5：簽約同理
    if ((state.cat === '盤商' || state.cat === '種子商') && dealerSignOn()) return String($n('dcNote').value).trim() ? '' : '已簽約要寫簽約內容（簽了什麼、從什麼時候開始）／စာချုပ်ချုပ်ပြီးပါက စာချုပ် အကြောင်းအရာ ရေးပါ (မည်သည်ချုပ်သည်၊ မည်သည့်အချိန် စသည်)'; // 0.4.75
    if (state.cat !== '結案') return '';
    // 業務BUG#3：農民結案只能選已經有的農民，不能在這裡新增（選單已拿掉「＋新增農民」，這裡再擋一次）
    const sel0 = $('farmer').value;
    if (!sel0 || sel0 === '__new') return '請先選要結案的農民／လယ်သမား ရွေးပါ';
    if (waitOf(sel0)) return WAIT_MSG; // 0.4.92 低5
    // 0.4.92 低1：價格打成「12,000」→ 原本被當沒填、提示「結案要填：價格」（明明有打）→ 先說請只填數字
    const badC = [['cPrice', '價格 ဈေးနှုန်း'], ['cYield', '產量 အထွက်နှုန်း']].filter(([id]) => { const el = $(id); return !!(el && el.validity && el.validity.badInput); }).map(([, n]) => n);
    if (badC.length) return `${badC.join('、')}請只填數字（用 0～9 和小數點，不要用逗號）／ဂဏန်းသာ ဖြည့်ပါ (ကော်မာ မထည့်ပါနှင့်)`;
    // 0.5.26（第23任，董事長「結案允許不填價格」）：作物死掉、沒收成——勾了種植失敗，或進行中試作／推廣的結果選「失敗」→ 價格、產量、收購客戶可以不填
    //   （打卡頁的「填結果／結束」拿掉後，失敗的只能在這裡結；後台 saveFarmerClosing_ 同樣放行）；有填的照樣要大於 0
    const failClose = typeof closeFailNow === 'function' && closeFailNow();
    const miss = failClose ? [] : [['cPrice', '價格 ဈေးနှုန်း'], ['cYield', '產量 အထွက်နှုန်း'], ['cBuyer', '收購客戶 ဝယ်သူ']].filter(([id]) => !String($(id).value).trim()).map(([, n]) => n);
    // 抓BUG第1輪（小助手1）：存檔提示裡結案只列這一句；原本沒說作物失敗（勾種植失敗或結果選失敗）就不用填 → 業務以為一定要編價格。舊頁面沒有種植失敗勾選就不加
    // 抓BUG第2輪（小助手2 提、第24任修）：勾了種植失敗、但試作／推廣結果選「成功」＝矛盾，價格照要填 → 原本提示還說「勾種植失敗就不用填」，業務會困惑；這時改說要把結果改成失敗
    const contra = typeof document !== 'undefined' && !!document.getElementById('cPlantFail') && typeof closePlantFailOn === 'function' && closePlantFailOn()
      && !!document.getElementById('closeTrialBox') && !$n('closeTrialBox').hidden && $n('cTrialOutcome').value === '成功';
    if (miss.length) return `結案要填：${miss.join('、')}／ပိတ်သိမ်းရန် ဖြည့်ပါ` + (contra ? '（勾了「種植失敗」但結果選「成功」：真的沒收成請把結果改成「失敗」就不用填／စိုက်ပျိုးမှု မအောင်မြင် ခြစ်ထားသော်လည်း ရလဒ် အောင်မြင် ဖြစ်နေသည် - မရိတ်ရလျှင် ရလဒ်ကို မအောင်မြင် ဟု ပြောင်းပါ）'
      : typeof document !== 'undefined' && document.getElementById('cPlantFail') ? '（作物失敗沒收成：勾「種植失敗」或結果選「失敗」就不用填／သီးနှံ မအောင်မြင်၍ မရိတ်ရလျှင် စိုက်ပျိုးမှု မအောင်မြင် ခြစ်ပါ သို့မဟုတ် ရလဒ် မအောင်မြင် ရွေးပါ）' : '');
    // 2號 0.4.63 低#6：輸入框的 min=0 只有表單送出才擋，這裡自己檢查：價格、產量要大於 0（不能負數或 0）
    const bad = [['cPrice', '價格 ဈေးနှုန်း'], ['cYield', '產量 အထွက်နှုန်း']].filter(([id]) => (!failClose || String($(id).value).trim()) && !(Number($(id).value) > 0)).map(([, n]) => n);
    if (bad.length) return `${bad.join('、')}要大於 0／၀ ထက် ကြီးရမည်`;
    // 0.4.74 董事長「要，先填結果」：有進行中的試作／推廣 → 結果必填；失敗要填失敗紀錄。還沒查完不能送（不然會送出沒帶結果的結案）
    if (typeof document !== 'undefined' && document.getElementById('closeTrialBox')) { // 舊頁面沒有結果欄：照舊不擋（後台照舊寫「結束」）
      if (document.getElementById('measureBox')) { const mp = measureProblem(); if (mp) { $n('measureBox').open = true; return mp; } } // 0.4.80 中1：出錯時打開量測框 // 0.4.77 採收量測（選填，但填了要合理）
      if (state.closeTrialFor !== sel0) return '正在查這位農民有沒有進行中的試作…／စစ်ဆေးနေသည်';
      const ct = state.closeTrial;
      if (state.closeTrialUnknown) return '這件結案狀態未知（後台讀不到結案資料），請先洽主管，先不要送結案／ပိတ်သိမ်းမှု အခြေအနေ မသိ (ဆာဗာ ဖတ်မရ)၊ မန်နေဂျာကို အရင်မေးပါ၊ ပိတ်သိမ်းမှု မပို့သေးပါနှင့်'; // R25-2
      if (ct) {
        const o = $n('cTrialOutcome').value;
        if (o !== '成功' && o !== '失敗') return `請先選${ct.cat}結果（成功或失敗）／${CAT_MY[ct.cat] || ''} ရလဒ် ရွေးပါ`;
        if (o === '失敗') { const fm = failMissing(); if (fm.length) return `${ct.cat}失敗要填：${fm.join('、')}／မအောင်မြင်လျှင် ဖြည့်ရန် လိုသေးသည်`; }
      }
      // 0.4.75 結案勾了「這次發現種植失敗」：失敗紀錄全部必填（試作失敗時上面已經檢查過同一組，不重複；舊頁面沒有這個勾選）
      if (closePlantFailOn() && !closeTrialFailed()) { const fm = failMissing(); if (fm.length) return `種植失敗要填：${fm.join('、')}／စိုက်ပျိုးမှု မအောင်မြင်လျှင် ဖြည့်ရန် လိုသေးသည်`; }
    }
    return '';
  }
  /** 0.4.82 結案分頁的盤商結案／種子商結案：沒有自己負責的那一類就只提示；有就打開那一類的拜訪畫面（結案、只走已簽約） */
  async function signCloseOpen(cat) {
    if (cat !== '盤商' && cat !== '種子商') return;
    const me = String(((await getConfig()) || {}).name || '');
    const all = await allKnownCustomers();
    if (!all.some(f => (f.type || '') === cat && (f.pending || !String(f.staff || '') || String(f.staff) === me))) {
      toast(`你沒有負責的${cat}／${cat === '盤商' ? 'ကုန်သည်' : 'မျိုးစေ့ဆိုင်'} မရှိပါ`); return;
    }
    state.closeGroup = ''; state.closeNext = true; state.signNext = true; state.lockNext = true;
    await openVisit(cat);
    const vt = typeof document !== 'undefined' && document.getElementById ? document.getElementById('visitTitle') : null;
    if (vt) vt.textContent = `${cat}結案（簽約） ${cat === '盤商' ? 'ကုန်သည်' : 'မျိုးစေ့ဆိုင်'} ပိတ်သိမ်း（စာချုပ်）`; // 第24任 第六批⑫：不再像一般拜訪頁（抽函式跑的舊測試沒有 $）
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
    if (!ct) { // 0.5.10 抓BUG低3：沒有進行中的試作時，結案分類照這位農民的類型欄（試作／推廣農民不再記成一般農民）
      const f = (state.allCustomers || []).find(x => x.id === sel);
      return { group: f && KIND_CAT[f.kind] ? f.kind : closeTrialGroup(null), trialResult: null };
    }
    const fk = (state.allCustomers || []).find(x => x.id === sel);
    const group = fk && KIND_CAT[fk.kind] ? fk.kind : closeTrialGroup(ct), outcome = $n('cTrialOutcome').value; // 0.5.11 低E：有類型欄分類就照分類（舊資料才看進行中的試作）
    if (outcome !== '成功' && outcome !== '失敗') return { group, trialResult: null }; // 舊頁面沒有結果欄：不送空結果（後台照舊寫「結束」）
    const tr = { id: ct.t.id, cat: ct.cat, outcome };
    if (outcome === '失敗') tr.failure = collectFailure();
    if (ct.t.pending) tr.startInfo = { item: ct.t.item, dosage: ct.t.dosage, start: ct.t.start }; // 開始那筆還沒上傳（後台目前不用，照約定附上）
    return { group, trialResult: tr };
  }
  /** 「打字」的範例：依這位農民現在的進度換（董事長 2026-11-12：業務報告依農民進度寫範例） */
  function noteExample() {
    const sel = $('farmer').value, t = state.activeTrial;
    const days = t && /^\d{4}-\d\d-\d\d/.test(String(t.start || '')) ? Math.round((Date.parse(mmDay(0)) - Date.parse(String(t.start).slice(0, 10))) / 86400000) : null; // 0.5.16 第2輪：緬甸日期
    const wk = days == null ? null : Math.max(1, Math.ceil(days / 7));
    if (state.cat === '結案') return ['例：已賣給 Golden 糧行，價格比去年好，農民明年還要種', 'ဥပမာ - Golden ဆန်ဆိုင်သို့ ရောင်းပြီး၊ ဈေးကောင်း၊ နောက်နှစ် ဆက်စိုက်မည်'];
    if (state.cat === '種子商') return ['例：老闆想再多進一批種子，下週帶樣品和新品介紹過去', 'ဥပမာ - ဆိုင်ရှင်က မျိုးစေ့ ထပ်မှာချင်၊ နောက်အပတ် နမူနာ ယူလာမည်']; // 0.4.54 種子商沒有價格，範例改成匯報紀錄
    if (isDealerCat()) return ['例：店裡水稻種子賣得好，老闆想多進 A 品牌，價格比上月漲一點', 'ဥပမာ - စပါးမျိုး ရောင်းကောင်း၊ A တံဆိပ် ထပ်မှာချင်၊ ဈေး နည်းနည်းတက်'];
    // 0534：作物、面積已經在上面欄位填，範例改寫農民的反應、需求
    if (sel === '__new') return ['例：第一次拜訪，農民對我們的種子有興趣，但擔心價格；想先看鄰居種的結果，需要我們下週帶樣品和報價', 'ဥပမာ - ပထမအကြိမ်၊ မျိုးစေ့ကို စိတ်ဝင်စားသော်လည်း ဈေးကို စိုးရိမ်၊ အိမ်နီးချင်းရလဒ် ကြည့်ချင်၊ နောက်အပတ် နမူနာနှင့် ဈေးစာရင်း ယူလာရန်'];
    if (state.trialMode === 'start') return ['例：今天開始試作，A 肥料每英畝 2 包，旁邊留一塊不施當對照，秧苗高約 15 公分', 'ဥပမာ - ယနေ့ စမ်းသပ် စတင်၊ A မြေသြဇာ တစ်ဧက ၂ အိတ်၊ ဘေးတွင် နှိုင်းယှဉ်ကွက် ထား၊ ပျိုးပင်အမြင့် ၁၅ စင်တီခန့်'];
    if (state.trialMode === 'end') return ['例：收割了，產量每英畝 60 籃，比對照區多 10 籃，農民願意明年繼續用', 'ဥပမာ - ရိတ်သိမ်းပြီး၊ တစ်ဧက ၆၀ တောင်း၊ နှိုင်းယှဉ်ကွက်ထက် ၁၀ တောင်း ပိုထွက်၊ နောက်နှစ် ဆက်သုံးချင်သည်'];
    if ((state.cat === '試作' || state.cat === '推廣') && t && wk) {
      if (wk <= 3) return [`例：第 ${days} 天，株高 30 公分，葉色比對照區綠，沒有病蟲害`, `ဥပမာ - ${days} ရက်မြောက်၊ အပင်အမြင့် ၃၀ cm၊ အရွက်စိမ်း၊ ပိုးမွှား မရှိ`]; // 緬文開頭照譯稿 E11 改成第幾天，後半沿用原本的緬文
      if (wk <= 7) return [`例：第 ${days} 天，分蘗變多，株高 55 公分，農民很滿意`, `ဥပမာ - ${days} ရက်မြောက်၊ ပင်ပွား ပိုများလာ၊ အမြင့် ၅၅ စင်တီ၊ လယ်သမား ကျေနပ်`];
      return [`例：第 ${days} 天，抽穗整齊，一穗約 120 粒，預計兩週後收割`, `ဥပမာ - ${days} ရက်မြောက်၊ အနှံထွက် ညီညာ၊ တစ်နှံ ၁၂၀ စေ့ခန့်၊ ၂ ပတ်အတွင်း ရိတ်မည်`];
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
    state.closeTrialSel = null; state.closeTrialUnknown = false; state.closeSeq = (Number(state.closeSeq) || 0) + 1; // R28-2（GPT）：清表單後再選同一位要重查（不能當成「正在查」卡住），還在跑的舊查詢作廢
    state.trialStartAuto = ''; // 0.5.26 換客戶：推廣／試作農民可以再自動打開一次開始表單
    // 5輪抓BUG第1輪（第24任本機實走：離線替舊推廣農民存檔開始推廣後再打開他，說明寫「進行中」卻露出「＋ 開始新的推廣」）：
    //   原因：這裡清 activeTrial 後 setTrialMode(null) → paintOldKindBtn 拿上一輪留下的 oldKindFor（同一位）當「沒有進行中」，先把按鈕打開、說明改掉；
    //   之後的重查只靠 paintTrialWait 改說明，沒收回按鈕。→ 清表單時一起清 oldKindFor，交給這次 refreshTrialBox 重新判斷
    state.oldKindFor = null;
    state.stageManual = false; $n('vStage').value = ''; $n('vStageWhy').value = ''; // 0.4.78 換客戶：生長階段重新建議
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
  // 0.5.20 E2（第19任）：原本只在打開打卡畫面時抓一次位置 → 開著畫面走到別塊田、半小時後才存，田區座標、照片浮水印都是舊位置。
  //   記下抓到的時間（gpsAt）；存檔時位置超過 GPS_FRESH_MS 就再抓一次（keep：抓不到就沿用原本的，不會變成無定位）；拍照時舊了也在背景補抓
  const GPS_FRESH_MS = 2 * 60000;
  const gpsStale = () => !state.gps || !(Date.now() - (state.gpsAt || 0) <= GPS_FRESH_MS);
  /** 0.5.20 G4：兩個位置相距幾公尺（近距離用平面近似就夠） */
  // 0520R3 H1（第19任）：「看不出有移動」最多只認 200 m（董事長要求：不要用舊草稿固定天數那個數字，避免混淆；200 m 也讓人沒動時少被換成粗略位置）——原本用新位置誤差的 2 倍，±1000 m 時走到 2 km 外的下一塊田也被當成沒動、留著上一塊田的 ±5 m 座標
  const GPS_SAME_M = 200;
  const gpsDistM = (a, b) => { const k = 111320, dy = (b.lat - a.lat) * k, dx = (b.lng - a.lng) * k * Math.cos(a.lat * Math.PI / 180); return Math.sqrt(dx * dx + dy * dy); };
  function locate(opt) {
    const box = $('gps'), keep = !!(opt && opt.keep); // 位置是手機的、不是哪一張表單的：換客戶（formGen 會變）時抓到的照樣用
    // 0520R1-2（GPT）：拍照、存檔、重新定位可能同時各抓一次，回覆先後會顛倒 → 每次編號（seq），比較晚發出的已經寫進來了，較早那次晚到就丟掉；
    //   抓取時間用定位本身的時間（p.timestamp，快取的舊位置不會被當成剛抓的），也比它舊的不收
    const seq = state.gpsSeq = (Number(state.gpsSeq) || 0) + 1;
    if (!keep) { state.gps = null; state.gpsAt = 0; }
    // 0.4.33 董事長：測試期間定位先「假打開」（在電腦上測開始新的試作）。config.js 有 testFakeGps 才生效，正式上線前拿掉
    const fake = typeof FARM_CONFIG !== 'undefined' && FARM_CONFIG.testFakeGps;
    if (fake && isFinite(fake.lat) && isFinite(fake.lng)) {
      state.gps = { lat: Number(fake.lat), lng: Number(fake.lng), acc: 0 }; state.gpsAt = Date.now();
      box.innerHTML = `📍 <b>測試用假定位</b> ${state.gps.lat}, ${state.gps.lng}（正式上線前會關掉）／စမ်းသပ်ရန် ယာယီ တည်နေရာ (တကယ်သုံးမတိုင်မီ ပိတ်ပါမည်)`;
      return Promise.resolve();
    }
    if (!('geolocation' in navigator)) { box.textContent = '📍 這支手機不支援定位，會標記「無定位」／ဤဖုန်း တည်နေရာ မရပါ၊ 「တည်နေရာ မရှိ」 ဟု မှတ်သားမည်'; return Promise.resolve(); }
    if (!keep) box.textContent = '📍 定位中…（最多 30 秒）တည်နေရာ ရှာနေသည် (အများဆုံး ၃၀ စက္ကန့်)';
    return new Promise(done => navigator.geolocation.getCurrentPosition(p => {
      const fixAt = Number(p.timestamp) > 0 ? Math.min(Number(p.timestamp), Date.now()) : Date.now();
      if (seq < (Number(state.gpsSeqApplied) || 0) || (state.gps && fixAt < (Number(state.gpsAt) || 0))) { done(); return; } // 0520R1-2：過時的回覆
      state.gpsSeqApplied = seq;
      const nw = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) };
      // 0.5.20 G4（第19任）：補抓（keep）拿到的位置明顯比原本不準（誤差超過原本 3 倍、也超過 100 m），而且原本的位置還在新位置誤差的 2 倍範圍內（誤差值只涵蓋約 7 成情況，2 倍約 95%；看不出有移動）
      //   → 保留原本較準的位置，抓取時間更新（這次定位證實人還在原地，不用每次存檔都再等）；離很遠（真的移動了）照樣換新的
      const old = state.gps;
      // 0520R5／0520R6（GPT 低，第20任）：「看不出」的上限——變粗略前最後那個準的位置（＝gpsAt，看不出期間不更新）超過 10 分鐘就結束「看不出」、不再比它
      //   （訊號一直差時，不要每次存檔都多等兩次定位）。要放在下面「保留較好位置」那條之前（R5 放在後面，那條先 return 就判斷不到）
      if (keep && state.gpsAmbig && !(state.gpsRef && Date.now() - (Number(state.gpsAt) || 0) <= GPS_FRESH_MS * 5)) { state.gpsAmbig = false; state.gpsRef = null; }
      // 0520R5（0520R4 GPT 低，第20任）：原本是「看不出有沒有移動」的粗略位置時，保留它但不當成剛抓的、也不清掉 gpsAmbig（原本會清掉 → 存檔不再多抓一次）
      if (keep && old && isFinite(old.acc) && nw.acc > Math.max(old.acc * 3, 100) && gpsDistM(old, nw) <= Math.min(nw.acc * 2, GPS_SAME_M)) {
        if (!state.gpsAmbig) state.gpsAt = fixAt;
        done();
        return;
      }
      // 0520R4 I7（第19任）：補抓只拿到粗略位置（誤差超過 100 m，後台不會拿來寫田區座標）、原本是準的、又看不出有沒有移動（超過 GPS_SAME_M 但在新誤差 2 倍內）
      //   → 照實換成新位置（真的走到別塊田不能留舊座標），但抓取時間不更新（還算舊）、記 gpsAmbig：存檔時再補抓一次、拍照也會再抓，給 GPS 機會鎖到準的位置
      // 0520R5（0520R4 GPT 低，第20任）：已經在「看不出」狀態時，跟「變粗略之前最後那個準的位置」（gpsRef）比——原本跟目前這個粗略的比，
      //   連兩次粗略時第二次 old.acc 超過 100 → 不算看不出、當成剛抓的 → 存檔不再多抓一次。準的位置、重新定位（不是補抓）都會結束「看不出」
      //   （10 分鐘上限在上面已經判斷過：到這裡還在看不出＝準的位置還在 10 分鐘內）
      const ref = keep && state.gpsAmbig && state.gpsRef ? state.gpsRef : old;
      const ambig = !!(keep && ref && isFinite(ref.acc) && ref.acc <= 100 && nw.acc > 100 && gpsDistM(ref, nw) <= nw.acc * 2);
      state.gps = nw;
      if (!ambig) state.gpsAt = fixAt;
      state.gpsAmbig = ambig;
      state.gpsRef = ambig ? ref : null;
      if (typeof fillGpsBox === 'function') fillGpsBox(); // 0520R4 I5：新增客戶表單的「GPS 座標」跟著換（原本只在拍照時填，存檔前補抓到新位置不更新）
      box.innerHTML = `📍 已定位 တည်နေရာရပြီ <b>${state.gps.lat}, ${state.gps.lng}</b>（誤差 ±${state.gps.acc} m）`;
      done();
    }, err => {
      // 0.5.20 E2：補抓失敗 → 沿用原本的位置、畫面不改；0520R1-2：較晚發出的那次已經抓到了，這次的失敗不改畫面
      // 0526 H4（第21任）：拍照的背景補抓還沒回來、又按「重新定位」——①較早那次先失敗：較晚那次還在抓，不能先寫「抓不到」（等最後一次決定）；
      //   ②較早那次先抓到、最後一次失敗：手上已經有位置（存檔會帶這個座標），畫面不能改成「抓不到、會標記無定位」
      if (state.gps || seq < (Number(state.gpsSeq) || 0)) { done(); return; }
      box.innerHTML = err.code === 1
        ? '📍 <b style="color:var(--chili)">定位被關掉了 တည်နေရာ ပိတ်ထားသည်</b>，打卡會標記「無定位」。' + (typeof geoHelp === 'function' ? geoHelp(navigator.userAgent, typeof isStandalone === 'function' && isStandalone()) : '請到手機設定允許「位置」，再按「重新定位」。')
          + '<span class="my">' + (typeof geoHelpMy === 'function' ? geoHelpMy(navigator.userAgent, typeof isStandalone === 'function' && isStandalone()) : 'ဖုန်း ဆက်တင်တွင် 「တည်နေရာ」 ခွင့်ပြုပြီး 「ပြန်ရှာ」 နှိပ်ပါ။')
          + '</span>' // 第24任 第六批②：依手機、開法給步驟（緬文等譯者）
        : '📍 抓不到位置（可能訊號不好），仍可儲存，會標記「無定位」。可以到空曠處按「重新定位」。／တည်နေရာ မရပါ (လိုင်းမကောင်း၍ ဖြစ်နိုင်)၊ သိမ်းနိုင်သော်လည်း 「တည်နေရာ မရှိ」 ဟု မှတ်မည်။ ကွင်းပြင်တွင် 「ပြန်ရှာ」 နှိပ်နိုင်သည်။';
      done();
    }, { enableHighAccuracy: true, timeout: keep ? 15000 : 30000, maximumAge: keep ? 0 : 60000 })); // 0.5.20 E2：補抓不收快取的舊位置
  }

  /** 第24任 第六批②：主畫面 App（沒有網址列）還是瀏覽器 */
  function isStandalone() { try { return !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone); } catch (e) { return false; } }
  /** 第24任 第六批②（tomtom 實測：說明只有一種、寫「網址列」但主畫面 App 沒有網址列）：定位被關時，依 iPhone／Android、瀏覽器／主畫面 App 給步驟 */
  function geoHelp(ua, standalone) {
    const ios = typeof FarmCore === 'object' && FarmCore.isIOS ? FarmCore.isIOS(ua || '') : /iphone|ipad|ipod/i.test(ua || ''), android = /android/i.test(ua || ''), chrome = /CriOS|Chrome\//.test(ua || '');
    if (ios) return '請到 iPhone「設定」→「隱私權與安全性」→「定位服務」打開，往下找到' + (standalone ? '「Safari 網站」' : chrome ? '「Chrome」' : '「Safari 網站」') + '設成「使用 App 期間」' + (standalone ? '，再把田間打卡關掉重開' : '') + '，回來按「重新定位」。';
    if (android) return standalone
      ? '請長按手機主畫面上的「田間打卡」圖示 →「應用程式資訊」（或「網站設定」）→「權限」→「位置」改成允許；也確認手機上方下拉的「定位」是開的，再回來按「重新定位」。'
      : '請按網址列左邊的圖示（鎖頭或調整圖示）→「權限」→「位置」改成允許；也確認手機上方下拉的「定位」是開的，再按「重新定位」。';
    return '請到瀏覽器的網站設定，把這個網站的「位置」改成允許，並確認手機的定位服務是開的，再按「重新定位」。';
  }
  function geoHelpMy(ua, standalone) {
    const ios = typeof FarmCore === 'object' && FarmCore.isIOS ? FarmCore.isIOS(ua || '') : /iphone|ipad|ipod/i.test(ua || ''), android = /android/i.test(ua || ''), chrome = /CriOS|Chrome\//.test(ua || '');
    if (ios) return 'iPhone 「Settings」 → 「Privacy & Security」 → 「Location Services」 ဖွင့်ပြီး အောက်သို့ ဆင်း၍ ရှာပါ ' + (standalone ? '「Safari Websites (ဝဘ်ဆိုက်)」' : chrome ? '「Chrome」' : '「Safari Websites (ဝဘ်ဆိုက်)」')
      + ' 「While Using the App」 ဟု ထားပါ' + (standalone ? '၊ ပြီးနောက် လယ်ကွင်း မှတ်တမ်း ကို ပိတ်ပြီး ပြန်ဖွင့်ပါ' : '') + '၊ ပြန်လာပြီး 「ပြန်ရှာ」 နှိပ်ပါ။';
    if (android) return standalone
      ? 'ဖုန်း ပင်မစာမျက်နှာပေါ်ရှိ 「လယ်ကွင်း မှတ်တမ်း」 အိုင်ကွန်ကို ဖိနှိပ်ထားပါ → 「App Info」（သို့ 「Site Settings」）→ 「Permissions」 → 「Location」 ကို ခွင့်ပြုပါ၊ ဖုန်းအပေါ်မှ 「Location」 ဖွင့်ထားကြောင်း စစ်ပြီး 「ပြန်ရှာ」 နှိပ်ပါ။'
      : 'လိပ်စာဘား ဘယ်ဘက် အိုင်ကွန်（သော့ သို့မဟုတ် ချိန်ညှိပုံ）ကို နှိပ်ပါ → 「Permissions」 → 「Location」 ခွင့်ပြုပါ၊ ဖုန်းအပေါ်မှ 「Location」 ဖွင့်ထားကြောင်း စစ်ပြီး 「ပြန်ရှာ」 နှိပ်ပါ။';
    return 'Browser ၏ ဝဘ်ဆိုက် ဆက်တင်တွင် ဤဝဘ်ဆိုက်၏ 「Location」 ကို ခွင့်ပြုပြီး ဖုန်း တည်နေရာ ဝန်ဆောင်မှု ဖွင့်ထားကြောင်း စစ်၍ 「ပြန်ရှာ」 နှိပ်ပါ။';
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
  const fmtTime = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; // 照片 EXIF 拍攝時間（相機記的當地時間）用
  /** 0.5.16 第2輪 低：現場拍照的浮水印時間用緬甸時間（含校正過的手機時差），手機時區不是緬甸也一致 */
  const mmStamp = () => {
    const d = new Date(Date.now() + (Number(state.clockOff) || 0) + 390 * 60000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  };

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
      ? [mmStamp(), state.gps ? `${state.gps.lat}, ${state.gps.lng} ±${state.gps.acc}m` : '無定位']
      : ['相簿上傳｜' + (taken ? '拍攝 ' + fmtTime(taken) : '沒有拍攝時間'), info.lat !== null ? `照片定位 ${info.lat}, ${info.lng}` : '照片沒有定位'];
    if (source === '相機' && check !== '現場拍攝') lines.push('⚠ ' + check);
    const fs = Math.max(14, Math.round(w / 40));
    ctx.font = `600 ${fs}px sans-serif`;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0, h - (lines.length * fs * 1.35 + fs * .6), w, lines.length * fs * 1.35 + fs * .6);
    ctx.fillStyle = '#fff';
    lines.forEach((l, i) => ctx.fillText(l, fs * .6, h - fs * .5 - (lines.length - 1 - i) * fs * 1.35));
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.75));
    if (!blob) throw new Error('壓縮失敗／ပုံချုံ့ခြင်း မအောင်မြင်');
    return { blob, check, source };
  }

  /** 0.4.71 董事長：新增客戶表單的「GPS 座標」在拍照時自動帶入（只顯示、不能手打；真正存進客戶清單的田區座標照舊由這筆拜訪的定位寫入） */
  function fillGpsBox() {
    if ($('farmer').value !== '__new') return;
    const g = state.gps;
    $n('pGps').value = g ? `${g.lat}, ${g.lng}${g.acc ? `（±${g.acc} m）` : ''}` : '沒有定位／တည်နေရာ မရ';
  }
  async function addPhotos(files, source, btn) {
    const grp0 = state.photoGroup; // 抓BUG第8輪 手機組3：按下時是哪一組就記哪一組（處理途中換組不影響這批）
    const list = [...(files || [])];
    if (!list.length) return;
    if (state.mediaLocked) { toast('正在存檔（等定位），照片等一下再加／သိမ်းနေသည် (တည်နေရာ စောင့်နေ)၊ ဓာတ်ပုံ နောက်မှ ထပ်ထည့်ပါ'); return; } // 0.4.91 中3
    if (source === '相機' && gpsStale()) locate({ keep: true }); // 0.5.20 E2：位置舊了，背景補抓（不等；這批照片浮水印用目前的，存檔時會再確認）；0520R4 I2：打開畫面時沒抓到（沒有位置）也補抓，原本要等按儲存才抓、照片全寫無定位
    const gen = state.formGen;
    const room = MAX_PHOTOS - state.photos.length - state.busyPhotos; // 0.4.87 中4：還在處理的也要扣（兩批同時處理會超過上限，後台只收前 MAX_PHOTOS 張）
    if (room <= 0) { toast(`一次拜訪最多 ${MAX_PHOTOS} 張照片／ဓာတ်ပုံ အများဆုံး ${MAX_PHOTOS} ပုံ`); return; }
    if (list.length > room) toast(`最多 ${MAX_PHOTOS} 張，只取前 ${room} 張／အများဆုံး အရေအတွက် ကျော်လွန်၍ ပထမ ${room} ပုံသာ ယူမည်`);
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
      if (cmpOn()) { p.group = CMP_GROUPS.indexOf(grp0) >= 0 ? grp0 : '自己'; state.photos.push(p); state.photos.sort((x, y) => cmpOrder(x) - cmpOrder(y)); } // 第27任 對照農民：照三組排
      else state.photos.push(p);
      if (source === '相機') fillGpsBox(); // 0.4.71 董事長：拍照時 GPS 座標自動帶入（新增客戶表單）
      renderThumbs(); refreshSave();
    }
    btn.classList.remove('busy');
    if (failed) toast(`有 ${failed} 張照片讀不了（可能是 HEIC 格式），請改拍或換一張／ဓာတ်ပုံ ${failed} ပုံ ဖတ်မရပါ (HEIC ပုံစံ ဖြစ်နိုင်)၊ ပြန်ရိုက် သို့မဟုတ် အခြားပုံ ပြောင်းပါ`);
    renderThumbs();
    refreshSave();
  }

  /** 0.4.78 生長階段下拉：一般／試作／推廣農民、有見到、至少一張照片才出現；還沒自己選過就依種植日期建議 */
  function refreshStage() {
    const box = $n('stageBox'), sel = $n('vStage'), f = $('farmer').value;
    // 0.5.26（第23任，客戶與董事長在 LINE 談定「打卡時選階段，沒得選就選空白、說明原因」）：
    //   原本要先拍照才出現（客戶以為沒有這功能）→ 選好農民就出現；不選階段時要寫原因（stageProblem），原因接在打字內容後面送出
    const show = groupOf(state.cat) === 'farmer' && state.cat !== '結案' && !!f && !noMeetOn();
    box.hidden = !show;
    if (!show) { $n('stageWhyBox').hidden = true; return; }
    const c = (state.allCustomers || []).find(x => x.id === f) || {};
    const pd = f === '__new' ? $n('pPlantDate').value : c.plantDate;
    const g = stageGuess(pd, mmDay(0));
    if (!state.stageManual) sel.value = g;
    $n('stageHint').textContent = g ? `依種植日期建議：${g}（可以改）／စိုက်ရက်အရ အကြံပြု：${STAGE_MY[g]}` : '沒有種植日期，請自己選；沒得選就選「不選」並寫原因（到「種植資料」補上種植日期，之後就會自動建議）／စိုက်ရက် မရှိ၍ ကိုယ်တိုင် ရွေးပါ၊ မရွေးနိုင်လျှင် 「မရွေး」 ရွေးပြီး အကြောင်းရင်း ရေးပါ (「စိုက်ပျိုးမှု」 တွင် စိုက်ရက် ဖြည့်ပြီးလျှင် အလိုအလျောက် အကြံပြုမည်)';
    $n('stageWhyBox').hidden = !!sel.value;
  }
  /** ① 第26任 2026-11-18 董事長（截圖：還在生長期，業務選了「開花」）：選的階段比種植天數推算的還後面 → 回 { guess, days }，沒問題回 null。
   *  「剖面圖」不照時間走、沒有種植日期推不出來、選得比推算早（晚種、長得慢）都不算 */
  function stageTooEarly(stage, plantDate, day) {
    // 抓BUG 手機組 1：推算表最多推到「採收」，推不出「採收後」→ 原本選「採收後」種多久都被當成太早。「採收後」當成跟「採收」同一格比：推算到採收就放行，還沒到採收才警告
    const order = ['播種', '發芽', '長大', '開花', '結果', '採收'];
    const g = stageGuess(plantDate, day), si = order.indexOf(stage === '採收後' ? '採收' : stage), gi = order.indexOf(g);
    if (!g || si < 0 || gi < 0 || si <= gi) return null;
    const days = Math.round((Date.parse(String(day).slice(0, 10)) - Date.parse(String(plantDate).slice(0, 10))) / 86400000);
    return { guess: g, days };
  }
  // 第26任：選的階段比種植天數早的提示。中文一行、緬文一行（緬文照董事長 Antigravity 譯稿 D1；階段名稱兩邊都用「中文／緬文」）
  const stageBi = s => s + (STAGE_MY[s] ? '／' + STAGE_MY[s] : '');
  function stageWarnText(stage, w) {
    const zh = `目前未到「${stageBi(stage)}」期（種植第 ${w.days} 天，依天數應是「${stageBi(w.guess)}」），請檢查選擇是否正確。`;
    const my = `လက်ရှိတွင် 「${stageBi(stage)}」 အဆင့်သို့ မရောက်သေးပါ（စိုက်ပျိုးချိန် ${w.days} ရက်မြောက်၊ ရက်အရ 「${stageBi(w.guess)}」 ဖြစ်သင့်သည်）၊ ရွေးချယ်မှု မှန်မမှန် စစ်ဆေးပါ။`;
    return zh + '\n' + my;
  }
  /** 這次打卡選的階段、這位客戶的種植日期（跟 refreshStage 同一個來源） */
  function stageWarnNow() {
    const st = visitStage(); if (!st || state.cat === '結案') return null;
    const f = $('farmer').value, c = (state.allCustomers || []).find(x => x.id === f) || {};
    const pd = f === '__new' ? $n('pPlantDate').value : c.plantDate;
    const w = stageTooEarly(st, pd, mmDay(0));
    return w ? { stage: st, w } : null;
  }
  /** 第27任 2026-11-18 董事長「業務拜訪農民一定要有照片，要鎖定才能上傳」：一般／試作／推廣農民的拜訪（含沒見到）沒有照片 → 儲存鈕鎖住。
      照片還在處理中另有「照片處理中」提示（refreshSave 本來就擋）；盤商、種子商、結案不限。新字只有中文，緬文待譯 E9 */
  const PHOTO_CATS = ['農戶', '試作', '推廣', '結案']; // 第28任 2026-11-19 董事長「結案也一定要拍照片，鎖死，每次去農民那邊都要拍照，沒有不能上傳」（結案＝農民結案；盤商、種子商結案照舊不限）
  function photoProblem() {
    if (PHOTO_CATS.indexOf(state.cat) < 0 || !$('farmer').value) return '';
    if (cmpOn()) return cmpProblem();
    return (state.photos || []).length ? '' : '拜訪農民一定要有照片：請先拍照或上傳照片／လယ်သမား သွားရောက်ရာတွင် ဓာတ်ပုံ မဖြစ်မနေ ပါရမည် - အရင် ဓာတ်ပုံရိုက်ပါ သို့မဟုတ် ဓာတ်ပုံတင်ပါ';
  }
  /* ───── 第27任 2026-11-18 董事長「對照農民」雛形：三台相機（自己的、別間公司的、別的作物）＋三段打字 ─────
     類別值照舊是「試作」，只改畫面字。每張照片記 group；照片照三組的順序排（上傳後的編號跟打字裡寫的對得上）；
     三段打字合成一份寫進 #note（存檔、上傳、後台都照舊）。三組都要至少一張照片、都要打字；別間公司要寫名字、別的作物要寫是什麼。
     開始／結束試作的表單照舊用一般畫面 */
  const CMP_GROUPS = ['自己', '別家', '別作物'];
  const CMP_TITLE = { 自己: '自己的', 別家: '別間公司', 別作物: '別的作物' };
  const CMP_TITLE_MY = { 自己: 'ကိုယ်ပိုင်', 別家: 'အခြားကုမ္ပဏီ', 別作物: 'အခြားသီးနှံ' }; // 董事長譯稿 E13
  const cmpOn = () => state.cat === '試作' && !state.trialMode;
  const cmpOrder = p => { const i = CMP_GROUPS.indexOf(p.group); return i < 0 ? 99 : i; }; // 抓BUG第8輪 手機組4：沒分組的排最後
  function cmpProblem() {
    const loose = (state.photos || []).filter(p => CMP_GROUPS.indexOf(p.group) < 0).length;
    if (loose) {
      return `有 ${loose} 張照片沒分組（在一般畫面拍的），請按照片上的 × 刪掉，再到三組裡拍`
        + `／အုပ်စုမခွဲရသေးသော ဓာတ်ပုံ ${loose} ပုံ ရှိသည်（သာမန် စာမျက်နှာတွင် ရိုက်ထားသည်）၊ ဓာတ်ပုံပေါ်ရှိ × ကို နှိပ်၍ ဖျက်ပြီး သုံးစုံထဲတွင် ပြန်ရိုက်ပါ`;
    }
    const missGroups = CMP_GROUPS.filter(g => !(state.photos || []).some(p => p.group === g));
    if (missGroups.length) {
      return '對照農民要拍三組照片：還缺「' + missGroups.map(g => CMP_TITLE[g]).join('、') + '」'
        + '／နှိုင်းယှဉ် လယ်သမားအတွက် ဓာတ်ပုံ သုံးစုံ ရိုက်ရမည် - 「' + missGroups.map(g => CMP_TITLE_MY[g]).join('၊ ') + '」 လိုသေးသည်';
    }
    const v = id => String(($n(id) || {}).value || '').trim();
    if (!v('cmpCo')) return '請寫別間公司的名字／အခြားကုမ္ပဏီ နာမည် ရေးပါ';
    if (!v('cmpCrop')) return '請寫別的作物是什麼／မည်သည့် အခြားသီးနှံဖြစ်ကြောင်း ရေးပါ';
    const emptyGroups = [['cmpNote1', '自己'], ['cmpNote2', '別家'], ['cmpNote3', '別作物']].filter(([id]) => !v(id)).map(x => x[1]);
    if (!emptyGroups.length) return '';
    return '對照農民三段都要打字：還缺「' + emptyGroups.map(g => CMP_TITLE[g]).join('、') + '」'
      + '／နှိုင်းယှဉ် လယ်သမား သုံးပိုဒ်လုံး စာရိုက်ရမည် - 「' + emptyGroups.map(g => CMP_TITLE_MY[g]).join('၊ ') + '」 လိုသေးသည်';
  }
  /** 三段打字＋每組是第幾張照片，合成一份打字內容（寫進 #note） */
  function cmpCompose() {
    // 抓BUG第8輪 手機組1、2：原本一進三組就整份蓋掉 #note → 一般畫面或開始表單打的字消失。改成：#note 裡不是上次合成的字，先搬進「自己的」那段
    if (!cmpOn()) {
      if (state.cmpWasOn && $('note').value === (state.cmpLast || '')) { const n1 = $n('cmpNote1'); $('note').value = String(n1.value || ''); n1.value = ''; state.cmpLast = ''; }
      state.cmpWasOn = false;
      return;
    } // 離開三組：「自己的」那段放回一般打字欄（來回切不會重複、不會不見）
    const cur = String($('note').value || '');
    if (cur.trim() && cur !== (state.cmpLast || '')) { const n1 = $n('cmpNote1'); n1.value = n1.value ? n1.value + '\n' + cur : cur; }
    state.cmpWasOn = true;
    const v = id => String(($n(id) || {}).value || '').trim();
    const nums = g => (state.photos || []).map((p, i) => (p.group === g ? i + 1 : 0)).filter(Boolean);
    const sec = (g, head, body) => { const n = nums(g); return body || n.length ? `【${head}】${n.length ? '（照片 ' + n.join('、') + '）' : ''}${body}` : ''; };
    $('note').value = [sec('自己', '自己的', v('cmpNote1')), sec('別家', '別間公司' + (v('cmpCo') ? '：' + v('cmpCo') : ''), v('cmpNote2')), sec('別作物', '別的作物' + (v('cmpCrop') ? '：' + v('cmpCrop') : ''), v('cmpNote3'))].filter(Boolean).join('\n');
    state.cmpLast = $('note').value;
  }
  function paintCmp() {
    const box = $n('cmpBox'), on = cmpOn();
    box.hidden = !on;
    const mb = $n('meetBody'); if (mb.classList) mb.classList.toggle('cmp', on);
    if (!on || !box.querySelectorAll) return;
    box.querySelectorAll('[data-cmpn]').forEach(el => { const n = (state.photos || []).filter(p => p.group === el.dataset.cmpn).length; el.textContent = n ? `已有 ${n} 張／${n} ပုံ ရှိပြီ` : '還沒有照片／ဓာတ်ပုံ မရှိသေးပါ'; });
  }
  function clearCmp() {
    ['cmpNote1', 'cmpNote2', 'cmpNote3', 'cmpCo', 'cmpCrop'].forEach(id => { const e = $n(id); if (e) e.value = ''; });
    state.photoGroup = '';
    state.cmpLast = '';
    state.cmpWasOn = false;
  }
  function bindCmp() {
    const box = $n('cmpBox'); if (!box || !box.querySelectorAll) return;
    box.querySelectorAll('[data-cmpcam]').forEach(b => b.addEventListener('click', () => { state.photoGroup = b.dataset.cmpcam; $('photoInput').click(); }));
    box.querySelectorAll('[data-cmpalb]').forEach(b => b.addEventListener('click', () => { state.photoGroup = b.dataset.cmpalb; $('albumInput').click(); }));
    ['cmpNote1', 'cmpNote2', 'cmpNote3', 'cmpCo', 'cmpCrop'].forEach(id => { const e = $n(id); if (e && e.addEventListener) e.addEventListener('input', () => { cmpCompose(); refreshSave(); }); });
  }
  /** 0.5.26：要選階段的時候沒選、也沒寫原因 → 不給存（打卡照樣可以，只要寫原因） */
  function stageProblem() {
    if ($n('stageBox').hidden || $n('vStage').value) return '';
    // 0.5.26 小助手2 審查低3：舊農民只改客戶資料（沒拍照、錄音、打字、價格、試作）不算一次拜訪，不要求階段；新農民（第一次拜訪）照樣要
    const visitContent = $('farmer').value === '__new' || (state.photos || []).length || state.audio || String(($('note') || {}).value || '').trim()
      || state.trialMode || (typeof collectPrices === 'function' && collectPrices().length);
    if (!visitContent) return '';
    return String($n('vStageWhy').value || '').trim() ? '' : '請選生長階段；沒得選就寫原因／ကြီးထွားမှု အဆင့် ရွေးပါ (မရွေးလျှင် အကြောင်းရင်း ရေးပါ)';
  }
  /** 0.5.26：沒選階段的原因，接在打字內容後面（後台不用改，主管頁看得到） */
  function stageWhyText() {
    if ($n('stageBox').hidden || $n('vStage').value) return '';
    const w = String($n('vStageWhy').value || '').trim();
    return w ? '〔沒選生長階段的原因：' + w + '〕' : '';
  }
  /** 送出的生長階段：結案一律「採收」；農民拜訪看下拉（只收 7 個值）；其他空白 */
  function visitStage() {
    // 0.5.26 抓BUG 中1（小助手1 實走）：作物死掉的結案（種植失敗，或試作／推廣結果失敗）不算採收 → 送空白
    if (state.cat === '結案') return (typeof closeFailNow === 'function' && closeFailNow()) ? '' : '採收';
    const v = $n('vStage').value;
    return !$n('stageBox').hidden && STAGES.indexOf(v) >= 0 ? v : '';
  }
  function renderThumbs() {
    // 0.4.80 1號清單（交接單原記「原因未查」的 ERR_FILE_NOT_FOUND）：原本每次重畫都先釋放上一輪的 blob 網址、再全部重建，
    // addPhotos 連續重畫兩次時，第一輪縮圖還在載入就被釋放 → 主控台錯誤。改成每張照片的網址建一次重複用，只釋放「已經不在畫面上」的
    const prev = state.thumbUrls || [];
    state.thumbUrls = state.photos.map(p => p.thumbUrl || (p.thumbUrl = URL.createObjectURL(p.blob)));
    prev.forEach(u => { if (state.thumbUrls.indexOf(u) < 0) URL.revokeObjectURL(u); }); // 刪掉的照片、換客戶清掉的照片才釋放
    $('thumbs').innerHTML = state.photos.map((p, i) => `<div class="thumb"><img src="${state.thumbUrls[i]}" alt="照片 ${i + 1} ဓာတ်ပုံ ${i + 1}"><span class="tag">${p.group ? esc(CMP_TITLE[p.group] || p.group) : cmpOn() ? '沒分組 အုပ်စုမခွဲရသေး' : p.source === '相簿' ? '相簿 ဓာတ်ပုံ' : '相機 ကင်မရာ'}`
      + `</span><button type="button" class="del" data-i="${i}" aria-label="刪掉這張 ဤပုံကို ဖျက်မည်">×</button></div>`).join('');
    $('thumbs').querySelectorAll('.del').forEach(b => b.addEventListener('click', () => {
      if (state.saving) { toast('存檔中，請等存好再刪照片／သိမ်းနေသည်၊ သိမ်းပြီးမှ ဓာတ်ပုံဖျက်ပါ'); return; }
      state.photos.splice(Number(b.dataset.i), 1);
      renderThumbs();
      refreshSave();
    })); // 抓BUG第7輪 手機組1：存檔中（等定位）不能刪照片
    $('photoBtn').classList.toggle('done', state.photos.some(p => p.source === '相機'));
    const ag = typeof document !== 'undefined' && document.getElementById && document.getElementById('againBtn'); if (ag) ag.hidden = !state.photos.some(p => p.source === '相機'); // 第24任 第六批⑮
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
    // 第24任 必改第五批④：語音輸入跟錄音用同一個麥克風，不能同時開
    if (typeof FarmVoice === 'object' && FarmVoice.active()) { toast('正在語音輸入，請先按「■ 停止」，再錄音／အသံဖြင့် စာရိုက်နေသည်၊ 「■ ရပ်」 အရင်နှိပ်ပြီးမှ အသံသွင်းပါ'); return; }
    // 0.4.87 中5（第11任 0.4.86 清單）：麥克風權限還沒回來時連按兩下會開兩個錄音器，第一個停不掉 → 一進來就設「啟動中」；處理錄音中也不能再開新的
    if (state.recStarting || state.recBusy || state.mediaLocked) return; // 0.4.91 中3：存檔等定位中也不開新錄音
    // 0.4.94（第11任，第五輪審查順帶）：已經有一段錄音時再按，原本直接蓋掉 → 先確認，按取消就保留原本那段
    if (state.audio && !confirm('會蓋掉剛才的錄音，確定重錄？\nယခင် အသံသွင်းချက် ပျက်သွားမည်။ ပြန်သွင်းမှာ သေချာပါသလား။')) return;
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('這支手機的瀏覽器不支援錄音／ဤဖုန်း၏ Browser သည် အသံသွင်းခြင်း မပံ့ပိုးပါ'); return; }
    const m = await recOpenMic();
    if (!m) return;
    const { stream, rec, gen } = m;
    const chunks = [];
    state.rec = rec; state.audioSec = 0; state.audio = null;
    rec.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
    rec.onstop = recOnStop(rec, stream, chunks, gen, btn);
    rec.start(1000);
    btn.classList.add('rec'); btn.classList.remove('done');
    btn.querySelector('.label').textContent = '錄音中 0 秒・再按一下結束／အသံသွင်းနေ 0 စက္ကန့် ・ ရပ်ရန် ထပ်နှိပ်';
    // 0.4.94：錄音鈕旁倒數（剩幾秒），最後 10 秒變紅並跳一次提醒；到上限自己停，跟業務說錄滿了、要補充請用打字（原本到 90 秒默默停掉）
    recCountdown(rec, btn);
    refreshSave();
  }
  /** 錄音：要麥克風權限、建錄音器（啟動中先鎖住儲存鈕，不管怎麼結束都恢復）；不開就回 null，開好回 { stream, rec, gen } */
  async function recOpenMic() {
    state.recStarting = true;
    if (typeof refreshSave === 'function') refreshSave(); // R32 待確認 1（GPT）：錄音啟動中儲存鈕馬上停用
    let stream, rec;
    const gen = state.formGen, view0 = state.view; // 0.5.24：也記下按錄音時在哪個畫面
    try {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) { toast('沒有麥克風權限，請到瀏覽器設定允許麥克風／မိုက်ခရိုဖုန်း ခွင့်ပြုချက် ပေးပါ'); return null; }
      if (gen !== state.formGen) { stream.getTracks().forEach(t => t.stop()); return null; } // 等權限的途中已經換客戶、回首頁：不開
      // 0.5.24（第21任抓BUG）：等權限的途中登入失效跳到登入頁（表單沒換世代）→ 畫面已經不是按錄音時那頁，不開、把麥克風放掉
      if (state.view !== view0) { stream.getTracks().forEach(t => t.stop()); return null; }
      // R31 待確認 1（GPT）：等麥克風權限的途中按了儲存（存檔中鎖住拍照、錄音）→ 權限回來也不開錄音、把麥克風放掉，免得錄到一半表單被存走、清掉
      if (state.mediaLocked) { stream.getTracks().forEach(t => t.stop()); toast('正在存檔，這次沒有開始錄音；存好後再按錄音／သိမ်းနေသည်၊ ယခု အသံမသွင်းရသေးပါ၊ သိမ်းပြီးမှ အသံသွင်းပါ'); return null; }
      try { rec = new MediaRecorder(stream); }
      catch (e) { stream.getTracks().forEach(t => t.stop()); toast('這支手機錄不了音，請改用打字／ဤဖုန်း အသံသွင်း မရပါ၊ စာရိုက်၍ သုံးပါ'); return null; } // 0.4.87：建錄音器失敗要關麥克風
    } finally { state.recStarting = false; if (typeof refreshSave === 'function') refreshSave(); } // R32 待確認 1：權限被拒、取消、開不了錄音器時，儲存鈕馬上恢復
    return { stream, rec, gen };
  }
  /** 錄音：按停（或錄滿）之後——關麥克風、轉檔、記下這段錄音；gen＝按錄音時的表單世代（換了就作廢） */
  function recOnStop(rec, stream, chunks, gen, btn) {
    return async () => {
      clearInterval(state.recTimer);
      { const rh = $n('recHint'); rh.textContent = `最長 ${MAX_REC_SEC} 秒／အများဆုံး ${MAX_REC_SEC} စက္ကန့်`; if (rh.classList) rh.classList.remove('warn'); } // 0.4.94
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
  }
  /** 錄音：錄音鈕旁倒數、每秒更新秒數，剩 10 秒提醒、錄滿自動停 */
  function recCountdown(rec, btn) {
    const hint = $n('recHint');
    const showLeft = () => { const left = Math.max(0, MAX_REC_SEC - state.audioSec); const warn = left <= 10;
      hint.textContent = warn ? `快錄滿了，剩 ${left} 秒／${left} စက္ကန့်သာ ကျန်` : `剩 ${left} 秒／${left} စက္ကန့် ကျန်`; if (hint.classList) hint.classList.toggle('warn', warn); };
    showLeft();
    state.recTimer = setInterval(() => {
      state.audioSec++;
      btn.querySelector('.label').textContent = `錄音中 ${state.audioSec} 秒・再按結束／အသံသွင်းနေ ・ ရပ်ရန် ထပ်နှိပ်`;
      showLeft();
      if (MAX_REC_SEC - state.audioSec === 10) toast('錄音只剩 10 秒，要說的請快說完／အသံသွင်းချိန် ၁၀ စက္ကန့်သာ ကျန်တော့သည်၊ ပြောစရာရှိသည်ကို မြန်မြန်ပြောပါ');
      if (state.audioSec >= MAX_REC_SEC) { toast(`已錄滿 ${MAX_REC_SEC} 秒，錄音自動停了；要補充請用打字／${MAX_REC_SEC} စက္ကန့် ပြည့်ပြီ၊ ထပ်ဖြည့်ရန် စာရိုက်ပါ`); rec.stop(); }
    }, 1000);
  }

  /* ───── 盤商價格 ───── */
  const MAX_PRICES = 20; // 跟後台 Code.gs 的 MAX_PRICES 一樣：超過的後台收不了（第七輪 B-03）
  function refreshPriceBtn() {
    const full = $('priceRows').children.length >= MAX_PRICES;
    $('addPriceBtn').disabled = full;
    $('addPriceBtn').textContent = full ? `一次最多記 ${MAX_PRICES} 筆價格／တစ်ကြိမ် အများဆုံး ဈေးနှုန်း ${MAX_PRICES} ခုသာ မှတ်နိုင်သည်` : '＋ 加一筆價格／ဈေးနှုန်း ထပ်ထည့်';
  }
  /** 0.4.89 價格列作物下拉的選項：文字「中文／緬文」（cropText）、value 中文作物名，最後「其他（自己填）」 */
  function priceCropOptions() {
    const crops = (state.options && state.options.crops) || [];
    return `<option value="">作物 သီးနှံ</option>${crops.map(c => `<option value="${esc(c)}">${esc(cropText(c))}</option>`).join('')}<option value="${TRIAL_OTHER}">Other／အခြား</option>`;
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
      <button type="button" class="del" aria-label="刪掉這筆價格 ဤဈေးနှုန်းကို ဖျက်မည်">×</button>`;
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
      if (bad || price === '') return `「${crop}」的價格沒填或不是數字／သီးနှံ၏ ဈေးနှုန်း မဖြည့်ရသေး သို့မဟုတ် ဂဏန်း မဟုတ်ပါ`;
      if (!isFinite(Number(price)) || Number(price) < 0) return `「${crop}」的價格不能是負數／ဈေးနှုန်း အနုတ် မဖြစ်ရ`;
    }
    return '';
  }

  /* ───── 儲存＋自動上傳 ───── */
  function refreshSave() {
    if (typeof paintCmp === 'function') { paintCmp(); cmpCompose(); } // 第27任 對照農民：三組畫面、三段打字合成
    if (typeof paintNewTrial === 'function' && state.trialMode === 'start') paintNewTrial(); // 0534：改作物、種子公司、代碼都會叫到這裡 → 品項、品種那一行跟著變（不另外加事件，免得動到 init 接線）
    if (typeof paintOldKind === 'function' && state.trialMode === 'start') paintOldKind(); // 抓BUG第1輪（小助手2）：舊農民改品項，說明跟著變
    const sel = $('farmer').value;
    const isNew = sel === '__new';
    const nameOk = !isNew || $('pName').value.trim();
    const hasContent = noMeetOn() || state.photos.length || state.audio || $('note').value.trim() || collectPrices().length || state.trialMode || ((state.cat === '結案' || state.dealerClose || dealerSignOn()) && !closeProblem()) || (sel && sel !== '__new' && collectProfile());
    $('note').placeholder = noteExample().join('\n'); // 範例跟著農民進度換
    // 0.5.26 生長階段：放在 profileProblem 前面（舊測試 test-073fix1112 檢查這行以 profileProblem() 結尾）；抽函式跑的舊測試沒有 stageProblem
    const tp = noMeetProblem() || trialProblem() || closeProblem() || priceProblem() || (typeof stageProblem === 'function' ? stageProblem() : '') || profileProblem() || (typeof photoProblem === 'function' ? photoProblem() : ''); // 第27任：農民拜訪要有照片
    const signNeed = !!state.signOnly && !dealerSignOn(); // 0.4.82 結案分頁的盤商、種子商結案：一定要走「已簽約」才能送（沒見到、還沒按有見到都不能存）
    const ok = sel && nameOk && !state.rec && !state.recBusy && !state.recStarting && !state.busyPhotos && !tp && (isNew || hasContent) && !signNeed && !state.saving; // 業務BUG#4：存檔途中（等定位最多 15 秒）不能再按
    $('saveBtn').disabled = !ok;
    // 0.5.26（董事長：不能按的時候要紅字提示）：已簽約、簽約內容空白 → 簽約內容框下面紅字；存檔鈕下面的原因不能按時改紅字
    if (typeof document !== 'undefined' && document.getElementById('dcNoteWarn')) {
      $n('dcNoteWarn').hidden = !((typeof dealerSignOn === 'function' && dealerSignOn()) && !String($n('dcNote').value || '').trim());
      // 抓BUG 建議：存檔中、錄音中、照片處理中、等麥克風這種「等一下就好」的不用紅字（業務會以為出錯）
      const waitOnly = state.saving || state.rec || state.recBusy || state.recStarting || state.busyPhotos;
      const sh = $('saveHint'); if (sh && sh.style) { sh.style.color = !ok && !waitOnly ? 'var(--chili)' : ''; sh.style.fontWeight = !ok && !waitOnly ? '700' : ''; }
    }
    // 2號 0.4.69 低7（第8任）：存檔中按鈕停用時，提示原本落到「至少做一樣」→ 先說存檔中
    $('saveHint').textContent = !sel ? '' : state.saving ? '存檔中，請稍等…／သိမ်းနေသည်' : state.recStarting ? '等待麥克風權限，請稍候…／မိုက်ခရိုဖုန်း ခွင့်ပြုချက် စောင့်နေသည်' : !nameOk ? '請先填名字／အမည် အရင်ဖြည့်ပါ' : state.recBusy ? '錄音處理中，請稍等…／အသံ ပြင်ဆင်နေ' : state.rec ? '錄音中，先按一下結束錄音／အသံသွင်းနေသည်၊ အရင် ရပ်ပါ' : state.busyPhotos ? `照片處理中（還有 ${state.busyPhotos}`
      + ` 張）… ဓာတ်ပုံ ပြင်ဆင်နေ` : tp ? tp : signNeed ? '盤商、種子商結案：先按「有見到」，再寫簽約內容／ တွေ့ပြီး ကိုနှိပ်ပြီး စာချုပ် အကြောင်းအရာ ရေးပါ' : !ok ? `拍照、上傳照片、錄音、打字${state.cat === '盤商' ? '、記價格' : ''}`
      + `${$('farmer').value === '__new' || SHOW_PROFILE_ON_VISIT ? '（或改客戶資料）' : ''}至少做一樣／ဓာတ်ပုံ၊ အသံ၊ စာ တစ်ခုခု လုပ်ပါ` : '';
    // 第24任（原本一次只顯示一件：上面那串檢查碰到第一個問題就停，業務改好一件才看到下一件，例如種植日期 2 年下限要先選好作物才出現）
    //   → 不是「等一下就好」的狀態時，把所有問題一次列出來（編號、一行一件）；只有一件照舊一行。這些檢查函式都只讀不改畫面
    // 抓BUG第3輪（第24任本機實走：盤商簽約只差簽約內容，卻同時列「至少做一樣」，業務以為還要拍照）：
    //   結案／盤商結案／已簽約這條路，結案內容填好本身就算有內容（hasContent 那串）→ 結案還有問題時不另列「至少做一樣」，等結案填好仍沒內容才會出現
    const closeFillsContent = (state.cat === '結案' || !!state.dealerClose || (typeof dealerSignOn === 'function' && dealerSignOn())) && !!closeProblem();
    const allP = typeof saveProblems === 'function' && sel && !ok && !(state.saving || state.rec || state.recBusy || state.recStarting || state.busyPhotos) ? saveProblems(nameOk, { signNeed, noContent: !(isNew || hasContent) && !closeFillsContent && !(typeof photoProblem === 'function' && photoProblem()) }) : []; // 抓BUG第7輪 手機組2：已列「一定要有照片」就不再列「錄音、打字至少做一樣」（互相矛盾） // 抽函式跑的舊測試沒有 saveProblems
    const sh2 = $('saveHint');
    if (sh2 && sh2.style) sh2.style.whiteSpace = allP.length > 1 ? 'pre-line' : '';
    if (allP.length > 1 && sh2) sh2.textContent = allP.map((p, i) => `${i + 1}. ${p}`).join('\n');
  }
  /** 第24任：存檔前所有沒過的檢查（順序同 refreshSave 那一串），重複的只留一次
   *  抓BUG第1輪（小助手2）：extra＝{ signNeed, noContent }：refreshSave 那串最後兩件（盤商簽約要先按「有見到」、至少做一樣），原本沒列 → 改好列出的幾件後又冒出新的一件（這次要修的就是這種情況） */
  function saveProblems(nameOk, extra) {
    const out = [];
    const add = p => { if (p && out.indexOf(p) < 0) out.push(p); };
    if (!nameOk) add('請先填名字／အမည် အရင်ဖြည့်ပါ');
    [noMeetProblem, trialProblem, closeProblem, priceProblem, typeof stageProblem === 'function' ? stageProblem : null, profileProblem, typeof photoProblem === 'function' ? photoProblem : null].forEach(fn => { if (typeof fn === 'function') add(fn()); });
    // 字跟 refreshSave 那串逐字相同（那串不改：抽 refreshSave 單獨跑的舊測試沒有別的常數）
    if (extra && extra.signNeed) add('盤商、種子商結案：先按「有見到」，再寫簽約內容／ တွေ့ပြီး ကိုနှိပ်ပြီး စာချုပ် အကြောင်းအရာ ရေးပါ');
    if (extra && extra.noContent) add(`拍照、上傳照片、錄音、打字${state.cat === '盤商' ? '、記價格' : ''}${$('farmer').value === '__new' || SHOW_PROFILE_ON_VISIT ? '（或改客戶資料）' : ''}`
      + `至少做一樣／ဓာတ်ပုံ၊ အသံ၊ စာ တစ်ခုခု လုပ်ပါ`);
    return out;
  }

  /**
   * 業務BUG#4（2號小助手推論，第7任讀程式確認）：存檔要等定位最多 15 秒，這段時間打字會觸發 refreshSave 把按鈕又打開，
   * 再按一次就跑第二個 save，兩筆不同編號都存下來。→ 外面包一層「存檔中」鎖：同時只跑一個，結束（不管成功、取消、失敗）一定解鎖
   */
  /** 0.4.91 中3：存檔等定位時，錄音、拍照、相簿三顆鈕停用（等完恢復） */
  function mediaLock(on) {
    // 拍照、相簿是 <label>（裡面包檔案選擇框），label 設 disabled 沒作用 → 連裡面的選擇框一起停用，外觀加 locked（變淡、按不到）
    ['recBtn', 'photoBtn', 'albumBtn', 'photoInput', 'albumInput'].forEach(id => { const b = $n(id); b.disabled = !!on; if (b.classList) b.classList.toggle('locked', !!on); });
    state.mediaLocked = !!on;
  }
  async function save() {
    if (state.saving) return;
    // 第26任 低風險修正3②：語音輸入還在聽就按儲存 → 存檔先讀走文字、清表單時再把語音作廢，停頓後才回來的最後一句就不見了（畫面也沒提示）。先停語音、讓業務看一下文字再按
    if (typeof FarmVoice === 'object' && FarmVoice.active()) { FarmVoice.stop(false); toast('已停止語音輸入，請看一下文字再按儲存'); return; }
    { const pp = typeof photoProblem === 'function' ? photoProblem() : ''; if (pp) { toast(pp); refreshSave(); return; } } // 第27任：按鈕狀態沒即時更新時也擋（農民拜訪要有照片）
    state.saving = true;
    // R30-3（GPT）：原本只在等定位時鎖拍照、相簿、錄音，之後讀暫存客戶、重新判斷結案時又放開 → 期間加的照片還在處理就存檔、照片無聲不見。
    //   整段存檔期間都鎖（已開著的檔案選擇器回來也會被 addPhotos 擋下並提示），不管怎麼結束都解鎖
    if (typeof mediaLock === 'function') mediaLock(true);
    try { await saveOnce(); } finally { if (typeof mediaLock === 'function') mediaLock(false); state.saving = false; refreshSave(); }
  }
  /* ───── 存檔：拆成三塊（第14任 2026-11-14 董事長「純檢查計算、讀寫手機資料、畫面提示」分開）─────
     ① 純檢查計算：不碰畫面、不碰手機資料庫，給同樣的輸入一定得到同樣的結果，可以單獨測
        saveBusyReason、closeConfirmText、dealerSignConfirmText、dealerCloseConfirmText、newVisitIds、buildVisitRecord
     ② 讀寫手機資料：readSavePre（存檔前要讀的）、writeVisit（寫入，回 'ok'／'stale'／'fail'）
     ③ 畫面：readSaveForm（讀表單）、saveStop（提示＋恢復存檔鈕）、askSaveConfirm（確認視窗）、afterSaved（存好之後）
     saveOnce 只排順序：等待 → 檢查 → 確認 → 組資料 → 寫入。
     順序上的約定（之前各輪審查定下的）：最後一次等待之後才做確認視窗；確認視窗之後到寫入之間不能有任何等待（同步、改欄位插不進來，確認看到的就是存進去的） */

  /** ① 錄音、照片還在處理時不能存：回提示文字，沒事回空字串 */
  function saveBusyReason(s) {
    if (s.recStarting) return '錄音正在啟動（等麥克風權限），這次沒有存；等它開始或取消後再按儲存／အသံသွင်းရန် စတင်နေသည် (မိုက်ခရိုဖုန်း ခွင့်ပြုချက် စောင့်နေ)၊ ယခု မသိမ်းရသေးပါ၊ စတင်ပြီး သို့မဟုတ် ပယ်ဖျက်ပြီးမှ သိမ်းပါ';
    if (s.rec || s.recBusy || s.busyPhotos) return '錄音或照片還在處理，這次沒有存；處理完再按一次儲存／အသံ သို့မဟုတ် ဓာတ်ပုံ ပြင်ဆင်နေဆဲ၊ ယခု မသိမ်းရသေးပါ၊ ပြီးမှ ထပ်နှိပ်ပါ';
    return '';
  }
  /** ① 0518R2-1：按儲存後到現在，試作操作（開始／結束）或那一件換了 → 回提示文字（這次不存、欄位留著）；沒變回空字串 */
  function trialChangedReason(mode0, trial0, s) {
    const now = s.activeTrial ? s.activeTrial.id : '';
    if (s.trialMode === mode0 && (mode0 !== 'end' || now === trial0)) return '';
    return '試作狀態剛更新（例如查出這位有結案在等主管確認），這次沒有存，填的內容還在；請確認後再按儲存／စမ်းသပ်မှု အခြေအနေ အပ်ဒိတ်ဖြစ်သွားသည်၊ ယခု မသိမ်းရသေး (ဖြည့်ထားသည်များ ကျန်နေမည်)၊ စစ်ပြီး ထပ်နှိပ်ပါ';
  }
  /** ① 農民結案的確認視窗文字（寫出農民、價格、產量、收購客戶、試作結果） */
  function closeConfirmText(o) {
    // 抓BUG第1輪（小助手1）：推廣農民原本也寫「試作結果」→ 照進行中那件的類別寫
    const tOut = o.trialOutcome ? (o.trialCat === '推廣' ? `\n推廣結果：${o.trialOutcome}／မြှင့်တင် ရလဒ် - ${o.trialOutcome}` : `\n試作結果：${o.trialOutcome}／စမ်းသပ် ရလဒ် - ${o.trialOutcome}`) : '';
    // 第24任 必改第三批⑦：價格、產量加千分位（12000 → 12,000，跟主管頁、Word 一樣）；舊測試只抽這個函式出來跑時沒有 thou → 照原樣
    const tq = x => (typeof thou === 'function' ? thou(x) : x);
    // 抓BUG第1輪（小助手1）：作物失敗的結案可以不填價格、產量、收購客戶，原本視窗照樣寫「價格： 緬幣／籃」「產量： 籃」→ 空的寫「沒收成，不用填」，並寫明是作物失敗
    if (o.fail) {
      const v = (x, u) => (String(x == null ? '' : x).trim() ? `${tq(x)} ${u}` : '（沒收成，不用填）（မရိတ်ရ၍ ဖြည့်ရန် မလို）');
      return `確定要把這位農民結案嗎？\nဤလယ်သမားကို ပိတ်သိမ်းမှာ သေချာပါသလား (ဈေးနှုန်း・အထွက်နှုန်း・ဝယ်သူ)\n\n農民：${o.who}\n結案原因：作物失敗、沒收成／သီးနှံ မအောင်မြင်\n價格：${v(o.price, o.priceUnit || '緬幣／籃')}`
        + `\n產量：${v(o.yield, o.yieldUnit || '籃')}\n收購客戶：${String(o.buyer == null ? '' : o.buyer).trim() || '（沒收成，不用填）（မရိတ်ရ၍ ဖြည့်ရန် မလို）'}${tOut}\n\n${o.closeConfirm ? '送出後要等主管確認才算結案。\nပို့ပြီးနောက် မန်နေဂျာ အတည်ပြုမှ ပိတ်သိမ်းမည်။' : '存檔後這位農民就結案，不再提醒回訪。\nသိမ်းပြီးလျှင် ဤလယ်သမား ပိတ်သိမ်းသွားမည်၊ ပြန်သွားရန် ထပ်မသတိပေးတော့ပါ။'}`;
    }
    return `確定要把這位農民結案嗎？\nဤလယ်သမားကို ပိတ်သိမ်းမှာ သေချာပါသလား (ဈေးနှုန်း・အထွက်နှုန်း・ဝယ်သူ)\n\n農民：${o.who}\n價格：${tq(o.price)} ${o.priceUnit || '緬幣／籃'}\n產量：${tq(o.yield)}`
      + ` ${o.yieldUnit || '籃'}\n收購客戶：${o.buyer}${tOut}\n\n${o.closeConfirm ? '送出後要等主管確認才算結案。\nပို့ပြီးနောက် မန်နေဂျာ အတည်ပြုမှ ပိတ်သိမ်းမည်။' : '存檔後這位農民就結案，不再提醒回訪。\nသိမ်းပြီးလျှင် ဤလယ်သမား ပိတ်သိမ်းသွားမည်၊ ပြန်သွားရန် ထပ်မသတိပေးတော့ပါ။'}`;
  }
  /** ① 盤商、種子商已簽約的確認視窗文字 */
  function dealerSignConfirmText(cat, who, note) {
    return `確定已簽約、送主管確認後結案嗎？\nစာချုပ်ချုပ်ပြီး မန်နေဂျာ အတည်ပြုပြီးနောက် ပိတ်သိမ်းမှာ သေချာပါသလား\n\n${cat}：${who}\n簽約內容：${note}`;
  }
  /** ① 盤商、種子商洽談結案的確認視窗文字 */
  function dealerCloseConfirmText(cat, who, outcome, note) {
    return `確定要送主管審核結案嗎？\nမန်နေဂျာ စစ်ဆေး ပိတ်သိမ်းရန် ပို့မှာ သေချာပါသလား\n\n${cat}：${who}\n洽談結果：${outcome}\n說明：${note}`;
  }
  /**
   * ① 這次存檔的編號：拜訪編號、新客戶臨時編號、試作臨時編號（d＝存檔當下時間，用手機當地時間組成年月日時分秒）。
   *   R20（GPT 01）：前綴用隨機 tag，不用登入金鑰片段；新客戶多加一段亂數，同一秒新增兩位不撞號（G06）
   */
  function newVisitIds(now, tag, rand, rand2, isNew, d) {
    const p2 = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    return { now, visitId: `${tag}_${stamp}_${rand}`, newFarmerId: isNew ? `T_${tag}_${stamp}_${rand}${rand2}` : '', trialTempId: `T_${tag}_${stamp}_tr${rand}` };
  }
  /**
   * ① 從表單內容（readSaveForm 讀好的）組出要存的拜訪，和同一個交易要一起改的手機暫存（metaFns：{ 鍵: 舊清單 => 新清單 }）。
   *   ctx：account 帳號、clockOffset 時差、localPre 這位暫存客戶（還沒上傳的新客戶才有）
   */
  function buildVisitRecord(f, ids, ctx) {
    const isNew = f.isNew;
    let profile = f.profile;
    const changed = isNew ? null : profile; // 這次改了哪些欄位（舊客戶）
    // 對「還沒上傳的新客戶」再記一次拜訪：這一筆也帶完整的客戶資料——第一筆上傳失敗、這一筆先到，後台照樣建出正確的客戶（R1-01）
    let tempName = isNew ? profile.name : '';
    if (!isNew && String(f.sel).startsWith('T_') && ctx.localPre) {
      const base = {};
      Object.keys(ctx.localPre).forEach(k => { if (['id', 'pending'].indexOf(k) < 0) base[k] = ctx.localPre[k]; });
      profile = Object.assign(base, profile || {});
      tempName = profile.name || '';
    }
    const name = isNew ? profile.name : f.name;
    const farmerId = isNew ? ids.newFarmerId : f.sel;
    const visit = {
      id: ids.visitId,
      account: ctx.account || '',
      category: f.cat === '結案' ? '農戶' : f.cat, // 結案記成農民拜訪（統計照舊），另外帶 closing
      photoRule: 1, // 第28任：這筆是「農民拜訪照片必填」生效後的手機存的（後台看到就一律檢查照片，不看手機時間）
      closing: f.closing,
      plantFailure: f.plantFailure,
      noMeet: f.noMeet,
      farmerId,
      tempName,
      farmerLabel: `【${CAT_LABEL(f.cat)}】${name}${isNew ? '（新）' : ''}`, // 「農戶」畫面上叫「一般拜訪」
      profile,
      text: f.text,
      stage: f.stage,
      prices: f.prices,
      trial: f.trial,
      trialRef: f.trialRef, // 一般拜訪也記下存檔當下進行中的試作（R2-07）
      deviceTime: ids.now,
      clockOffset: ctx.clockOffset,
      lat: f.gps ? f.gps.lat : null, lng: f.gps ? f.gps.lng : null, accuracy: f.gps ? f.gps.acc : null,
      photos: f.photos,
      audio: f.audio, audioSec: f.audioSec,
      status: 'pending'
    };
    const metaFns = {};
    if (visit.trial) visitTrialMeta(visit, f, farmerId, metaFns);
    if (visit.closing && visit.closing.outcome === '簽約') visit.farmerLabel += '・已簽約'; // 上傳清單看得出是簽約結案
    const ctr = visit.closing && visit.closing.trialResult; // 結案填了試作結果 → 手機這件試作馬上算結束
    if (ctr && ctr.id && !metaFns.localTrials) metaFns.localTrials = cur => {
      const lt = (cur || []).slice();
      const i = lt.findIndex(l => l.id === ctr.id);
      if (i >= 0) lt[i] = Object.assign({}, lt[i], { ended: true, by: visit.id, acct: visit.account }); else lt.push({ id: ctr.id, ended: true, by: visit.id, acct: visit.account });
      return lt;
    };
    visitCustomerMeta(visit, f, farmerId, isNew, profile, changed, metaFns);
    return { visit, metaFns };
  }
  /** ① 拜訪帶試作：同一個交易把試作記在手機（開始的、結束的），上傳清單標題加「開始／結束」 */
  function visitTrialMeta(visit, f, farmerId, metaFns) {
    // 試作也先記在手機：開始的（下一次拜訪看得到進行中）、結束的（不要再顯示進行中）
    const tr = visit.trial, cat = f.cat;
    metaFns.localTrials = cur => {
      const lt = (cur || []).slice();
      if (tr.op === 'start') lt.push({ id: tr.tempId, cid: farmerId, cat, item: tr.item, dosage: tr.dosage, start: tr.start, pending: true, acct: visit.account });
      else {
        const i = lt.findIndex(l => l.id === tr.id);
        if (i >= 0) lt[i] = Object.assign({}, lt[i], { ended: true, by: visit.id, acct: visit.account }); else lt.push({ id: tr.id, ended: true, by: visit.id, acct: visit.account });
      } // R17：記哪筆拜訪結束的
      return lt;
    };
    visit.farmerLabel += tr.op === 'start' ? `・開始${cat}` : `・結束${cat}（${tr.outcome}）`;
  }
  /** ① 新客戶、還沒上傳的暫存客戶改了資料：同一個交易把手機的暫存客戶寫好 */
  function visitCustomerMeta(visit, f, farmerId, isNew, profile, changed, metaFns) {
    if (isNew) {
      // 還沒上傳前，新客戶先放在手機的選單裡，下一次拜訪也選得到（類別照打卡的類別分）
      const rec = Object.assign({}, profile, { id: farmerId, pending: true, acct: visit.account }, CAT_KIND[f.cat] ? { kind: CAT_KIND[f.cat] } : {});
      metaFns.localCustomers = cur => (cur || []).concat([rec]);
    } else if (changed && String(farmerId).startsWith('T_')) {
      // 還沒上傳的新客戶改了資料：手機暫存也寫回，否則下一次拜訪會用舊資料整包重送，蓋掉這次的修改（B-01）
      metaFns.localCustomers = cur => (cur || []).map(l => (l.id === farmerId ? Object.assign({}, l, changed) : l));
    }
  }

  /** ② 存檔前要讀的手機資料：這位暫存客戶（還沒上傳的新客戶才讀）、時差。在最後一次等待之前讀好（R29、R30-1） */
  async function readSavePre(sel0) {
    const isTemp = String(sel0).startsWith('T_');
    const localPre = isTemp ? (((await Store.getMeta('localCustomers')) || []).find(l => l.id === sel0) || null) : null;
    // 0526 H6（第21任）：這位新客戶的拜訪被後台拒收 → 暫存客戶被清掉（G3），業務若正停在打卡畫面選著他，原本存檔不帶姓名等資料、後台會建成「（未命名）」。
    //   0521R1 曾改成從被拒收的舊拜訪補回客戶資料 → 0521R1 GPT 中：已上傳的拜訪 7 天後會被清掉，手機剩下「全部被拒收」不代表後台沒有他，
    //   補回的舊電話會蓋掉主管改過的。手機沒有可靠的方法知道後台有沒有他（後台只回答手機問的編號），所以不補舊資料：
    //   暫存客戶不在、也看不到後台有他（客戶快取的臨時編號、後台說收到了）、也沒有還在等上傳的拜訪帶著他 → orphan：這次不存，請業務重新選客戶
    let orphan = false;
    if (isTemp && !localPre) {
      try {
        const srv = ((await Store.getMeta('farmers')) || []).some(f => f && String(f.tempId || '').split(/\s+/).indexOf(sel0) >= 0);
        const known = (await Store.getMeta('known')) || {};
        const said = Array.isArray(known.customers) && known.customers.indexOf(sel0) >= 0;
        const waiting = !srv && !said && Store.allVisits ? ((await Store.allVisits()) || []).some(v => v && v.farmerId === sel0 && v.status !== 'uploaded' && v.status !== 'rejected') : false;
        orphan = !srv && !said && !waiting;
      } catch (e) { orphan = false; } // 讀不到就照原本（照存、不擋）
    }
    const clockPre = (await Store.getMeta('clockOffset')) || 0;
    return { localPre, clockPre, orphan };
  }
  /**
   * ② 寫入手機：拜訪、試作暫存、新客戶暫存在同一個交易（R6-02）；expectVer＝結案檢查時的資料版本，交易裡再比一次（R37-1）。
   *   回 'ok'；'stale'＝檢查之後資料剛更新、沒存；'fail'＝存不進去（例如空間不足）
   */
  // 0523R2-2（GPT）：擋下時把「交易當下登入的是誰」留下來給提示用（不再事後重讀：換回原主人時提示會變空白）
  async function writeVisit(visit, metaFns, expectVer, expectOwner) {
    try {
      await Store.saveVisit(visit, metaFns, expectVer, expectOwner);
      return 'ok';
    } catch (e) {
      if (e && e.code === 'OWNER') state.ownerClashAcct = String(e.account || '');
      return e && e.code === 'STALE' ? 'stale' : e && e.code === 'OWNER' ? 'owner' : 'fail';
    }
  }

  /** ③ 讀表單：把畫面上要存的內容讀成一般資料（之後組拜訪只用這份，不再碰畫面）；trialTempId＝開始試作要用的臨時編號 */
  function readSaveForm(trialTempId) {
    const sel = $('farmer').value, isNew = sel === '__new';
    return {
      cat: state.cat, sel, isNew,
      // 還沒上傳的暫存客戶選項文字帶「（新，未上傳 …）」→ 名稱去掉這段（0.5.16 第1輪 低）
      name: isNew ? '' : $('farmer').selectedOptions[0].textContent.split('｜')[0].replace(/（新，未上傳[^）]*）/, '').trim(),
      profile: collectProfile(),
      closing: collectClosing(),
      plantFailure: plantFailOn() || closePlantFailOn() ? collectFailure() : null, // 一般拜訪的種植失敗；農民結案勾（試作失敗時自動帶同一份）
      noMeet: collectNoMeet(), // 沒見到農民／農民拒絕 → 下次再訪
      text: noMeetOn() ? '' : [$('note').value.trim(), typeof stageWhyText === 'function' ? stageWhyText() : ''].filter(Boolean).join('\n'), // 0.5.26 沒選階段的原因接在後面
      stage: noMeetOn() ? '' : visitStage(), // 0.4.78 生長階段（結案＝採收）
      prices: collectPrices(),
      trial: noMeetOn() ? null : collectTrial(trialTempId),
      trialRef: !state.trialMode && (state.cat === '試作' || state.cat === '推廣') && state.activeTrial ? state.activeTrial.id : '',
      gps: state.gps,
      photos: state.photos.map(p => ({ blob: p.blob, check: p.check, source: p.source })),
      audio: state.audio, audioSec: state.audioSec
    };
  }
  /** ③ 這次不存：跳提示、存檔鈕照目前狀態恢復 */
  function saveStop(msg) {
    toast(msg);
    refreshSave();
  }
  /** ③ 送出前的確認視窗（農民結案、盤商種子商已簽約、洽談結案）；按取消回 false */
  function askSaveConfirm() {
    const optText = () => ($('farmer').selectedOptions && $('farmer').selectedOptions[0] ? $('farmer').selectedOptions[0].text : '');
    // 第26任 2026-11-18 董事長「送出前再問一次：你確定作物生長期嗎」：選的階段比種植天數還後面 → 確認視窗，按取消就不存、欄位留著讓他改
    const sw = stageWarnNow();
    if (sw && !confirm(stageWarnText(sw.stage, sw.w) + '\n\n確定生長階段沒選錯、要送出嗎？\nကြီးထွားမှုအဆင့် ရွေးထားသည်မှာ မမှားကြောင်း သေချာပြီး ပို့မည်လား။')) return false;
    if (state.cat === '結案') { // 0.4.33 董事長：怕業務結案按錯 → 送出前再確認一次
      const ou = state.options || {};
      const box = $n('closeTrialBox');
      if (!confirm(closeConfirmText({ who: optText() || $('pName').value, price: $('cPrice').value, yield: $('cYield').value, buyer: $('cBuyer').value,
        trialOutcome: box && !box.hidden && $n('cTrialOutcome').value ? $n('cTrialOutcome').value : '', priceUnit: ou.priceUnit, yieldUnit: ou.yieldUnit, closeConfirm: !!(state.options && state.options.closeConfirm),
        fail: typeof closeFailNow === 'function' && closeFailNow(), trialCat: box && !box.hidden && state.closeTrial ? state.closeTrial.cat : '' }))) return false; // 抓BUG第1輪（小助手1）：作物失敗、推廣結果的字
    }
    if (dealerSignOn() && !confirm(dealerSignConfirmText(state.cat, optText(), $n('dcNote').value.trim()))) return false;
    if (state.dealerClose && !confirm(dealerCloseConfirmText(state.cat, optText(), $n('dcOutcome').value, $n('dcNote').value.trim()))) return false;
    return true;
  }
  /** ③ 存好之後：清表單、提示、回首頁、叫背景上傳 */
  async function afterSaved() {
    resetForm();
    toast('已存在手機裡，會自動上傳／ဖုန်းထဲ သိမ်းပြီး၊ အလိုအလျောက် တင်မည်', 4000); // 第24任 必改第三批⑦：至少留 4 秒、共顯示 5 秒，不被同步提示蓋掉
    await showHome();
    requestBackgroundSync();
    syncNow();
  }

  /** 存檔本體：只排順序（外層 save() 負責「同時只跑一個」和鎖拍照、錄音） */
  async function saveOnce() {
    $('saveBtn').disabled = true;
    // 按下儲存「當下」的表單、客戶、試作操作與那一件（0518R3-1：第一個等待之前就記）；等待途中變了 → 這次不存、欄位留著
    // 等定位最多 15 秒：這段時間回首頁（表單被清掉）或改選客戶，這次就不存，不然會存成空白客戶或掛到別人名下（T2）
    const gen0 = state.formGen, sel0 = $('farmer').value;
    const moved = () => gen0 !== state.formGen || $('farmer').value !== sel0;
    const mode0 = state.trialMode, trial0 = state.activeTrial ? state.activeTrial.id : '';
    // 0.5.23 J5、J6（第21任）：表單主人（openVisit 記的）跟現在的登入比對——
    //   同一個帳號 → 照存；手機上已經沒有人登入（別的分頁登入失效後清掉了）→ 照樣用主人的帳號存進手機（J5，存完回登入頁）；
    //   現在登入的是別人 → 不存、表單留著（J6，不然會記到別人名下）
    const own = state.formOwner;
    const cfg = await getConfig();
    if (!cfg || !cfg.deviceKey) { if (!own) { showLogin('請先登入／အရင် ဝင်ပါ'); return; } }
    else { const w = saveOwnerClash(own, cfg); if (w) { saveStop(w); return; } }
    if (gpsStale()) await saveRelocate(moved);
    let why = saveBusyReason(state);
    if (why) { saveStop(why); return; }
    if (moved()) { saveStop('等定位時換了畫面或客戶，這次沒有存，請再按一次儲存／တည်နေရာ စောင့်နေစဉ် စာမျက်နှာ သို့မဟုတ် ဖောက်သည် ပြောင်းသွား၍ မသိမ်းရသေးပါ၊ ထပ်နှိပ်ပါ'); return; }
    if (!sel0) { saveStop('請先選客戶／ဖောက်သည် ရွေးပါ'); return; }
    const pre = await readSavePre(sel0);
    if (moved()) { saveStop('讀資料時換了畫面或客戶，這次沒有存，請再按一次儲存／ဒေတာ ဖတ်နေစဉ် စာမျက်နှာ သို့မဟုတ် ဖောက်သည် ပြောင်းသွား၍ မသိမ်းရသေးပါ၊ ထပ်နှိပ်ပါ'); return; }
    if (pre.orphan) {
      saveStop('這位新客戶之前的資料被後台退回、已不在手機的客戶清單，這次沒有存；請重新選客戶（或重新新增）後再按儲存／ဤဖောက်သည်အသစ်၏ ယခင်ဒေတာ ဆာဗာမှ ပယ်ချခံရ၍ စာရင်းထဲ မရှိတော့ပါ၊ မသိမ်းရသေးပါ၊ ဖောက်သည် ပြန်ရွေး (သို့မဟုတ် အသစ်ထည့်) ပြီး ထပ်နှိပ်ပါ');
      return;
    } // 0521R2 H6
    if (await saveCloseRecheck(sel0, mode0, moved)) return;
    // 0.5.23 J5、J6：上面等定位、讀資料時，別的分頁可能登出或換人 → 最後一次等待再比一次表單主人
    const cfgNow = await getConfig();
    if (moved()) { saveStop('讀資料時換了畫面或客戶，這次沒有存，請再按一次儲存／ဒေတာ ဖတ်နေစဉ် စာမျက်နှာ သို့မဟုတ် ဖောက်သည် ပြောင်းသွား၍ မသိမ်းရသေးပါ၊ ထပ်နှိပ်ပါ'); return; }
    const noLogin = !cfgNow || !cfgNow.deviceKey;
    if (noLogin && !own) { showLogin('請先登入／အရင် ဝင်ပါ'); return; }
    { const w = noLogin ? '' : saveOwnerClash(own, cfgNow); if (w) { saveStop(w); return; } }
    const account = own ? own.account : cfgNow.account;
    const closeExpectVer = state.cat === '結案' && !state.dealerClose && !dealerSignOn() && typeof Store !== 'undefined' && Store.lookupVersion && state.closeVer ? state.closeVer : undefined; // 寫入時再比一次（R37-1）
    // ── 以下是最後一次等待之後：再查一次錄音照片、試作（R30-3、0518R1-1），然後確認、組資料、寫入，中間不再等待 ──
    why = trialChangedReason(mode0, trial0, state) || saveBusyReason(state) || (state.trialMode === 'end' && typeof trialProblem === 'function' ? trialProblem() : '') || (typeof photoProblem === 'function' ? photoProblem() : ''); // 抓BUG第7輪 手機組1：等定位那幾秒把照片刪光，等完再檢查一次
    if (why) { saveStop(why); return; }
    if (!askSaveConfirm()) { refreshSave(); return; }
    const isNew = $('farmer').value === '__new', now = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);
    const tag = randTag(); // R20（GPT 01）：前綴用隨機，不用登入金鑰片段
    const ids = newVisitIds(now, tag, rand, isNew ? Math.random().toString(36).slice(2, 6) : '', isNew, new Date(now));
    const { visit, metaFns } = buildVisitRecord(readSaveForm(ids.trialTempId), ids, { account, clockOffset: pre.clockPre, localPre: pre.localPre });
    const res = await writeVisit(visit, metaFns, closeExpectVer, account); // 0523R1-1：寫入的同一個交易裡再比一次登入的人
    await saveFinish(res, account);
  }
  /** ③ 表單主人跟現在登入的帳號不同 → 回提示字（同一人、或沒有記主人的舊表單回空字串）
   *  0533 N1：主人記成 null（openVisit 讀到沒登入；undefined＝沒經過 openVisit 記主人的舊路，照舊）但現在有人登入 → 也算換人，不存、表單留著（原本回空字串不擋，會記在新登入的人名下） */
  function saveOwnerClash(o, c) {
    return (o === null && c && c.deviceKey && c.account ? '這張表單是沒登入時開始填的，現在登入的是「' + c.account + '」，這次沒有存（表單留著）；請回首頁重新打開打卡再填／' + c.account + ' ဖြင့် ဝင်ထား၍ မသိမ်းရသေးပါ (ဖောင် ကျန်နေမည်)၊ ပင်မစာမျက်နှာမှ ပြန်ဖွင့်ပြီး ဖြည့်ပါ'
      : !o || !c || !c.account || String(c.account) === o.account ? ''
      : '這張表單是「' + o.account + '」開始填的，現在登入的是「' + c.account + '」，這次沒有存（表單留著）；請用 ' + o.account + ' 登入再按儲存／ဤဖောင်ကို ' + o.account + ' က စဖြည့်ခဲ့သည်၊ ယခု ဝင်ထားသူ မတူ၍ မသိမ်းရသေးပါ (ဖောင် ကျန်နေမည်)၊ '
        + o.account + ' ဖြင့် ဝင်ပြီး သိမ်းပါ');
  }
  /** ③ 0.5.20 E2：沒有位置，或位置是 2 分鐘以前抓的 → 再抓一次（抓不到就沿用原本的）；moved＝按儲存後換了畫面或客戶 */
  async function saveRelocate(moved) {
    toast('再抓一次位置… တည်နေရာ ပြန်ရှာနေ');
    // 等定位時不能再錄音、拍照（save() 整段鎖住、結束時才解鎖，這裡不解鎖）
    mediaLock(true);
    await Promise.race([locate({ keep: true }), new Promise(r => setTimeout(r, 15000))]);
    if (state.gpsAmbig && !moved()) await Promise.race([locate({ keep: true }), new Promise(r => setTimeout(r, 10000))]); // 0520R4 I7：粗略、看不出有沒有移動 → 再給一次機會（只多抓一次）
  }
  /** ③ 結束試作、農民結案送出前的重新判斷；這次不存（已跳提示）回 true */
  async function saveCloseRecheck(sel0, mode0, moved) {
    // 結案送出前當下重新判斷試作（R26、R27）：有變或必填沒過就先不送，請業務確認後再按
    if (state.cat === '結案' && !state.dealerClose && !dealerSignOn() && typeof recheckCloseTrial === 'function') {
      const changed = await recheckCloseTrial(false);
      if (moved() || state.cat !== '結案') { saveStop('查資料時換了畫面或客戶，這次沒有存，請再按一次儲存／ဒေတာ စစ်နေစဉ် စာမျက်နှာ သို့မဟုတ် ဖောက်သည် ပြောင်းသွား၍ မသိမ်းရသေးပါ၊ ထပ်နှိပ်ပါ'); return true; }
      const cp = closeProblem();
      if (changed !== false || cp) { saveStop(cp || '這位的試作資料剛更新，請確認後再按儲存／ဒေတာ အသစ်ပြောင်းထားသည်၊ စစ်ပြီး ထပ်နှိပ်ပါ'); return true; }
    }
    // 0518R4：最後一次等待——結束試作、農民結案前，用當下資料重算「這位有沒有結案在等」（closeWaitNow），試作框、下面的檢查都照它
    if ((mode0 === 'end' || state.cat === '結案') && typeof closeWaitNow === 'function') {
      const cw = await closeWaitNow(sel0);
      if (moved()) { saveStop('查資料時換了畫面或客戶，這次沒有存，請再按一次儲存／ဒေတာ စစ်နေစဉ် စာမျက်နှာ သို့မဟုတ် ဖောက်သည် ပြောင်းသွား၍ မသိမ်းရသေးပါ၊ ထပ်နှိပ်ပါ'); return true; }
      if (applyCloseWait(sel0, cw) === false) { saveStop('這位的結案狀態剛更新，這次沒有存，請確認後再按一次儲存／ပိတ်သိမ်းမှု အခြေအနေ အပ်ဒိတ်ဖြစ်သွား၍ မသိမ်းရသေးပါ၊ စစ်ပြီး ထပ်နှိပ်ပါ'); return true; } // 0518R8-1：重算途中有較新的回答
      // 0518R4-1／G1（GPT、Gemini）：重算之後農民結案再檢查一次（在等主管確認、還在查都擋）；結束試作由下面 trialProblem 檢查
      if (state.cat === '結案' && !state.dealerClose && !dealerSignOn()) { const cp2 = closeProblem(); if (cp2) { saveStop(cp2); return true; } }
    }
    return false;
  }
  /** ③ 寫入之後：照 writeVisit 的結果（'ok'／'stale'／'owner'／'fail'）提示、回登入頁或回首頁；account＝這筆記在誰名下 */
  async function saveFinish(res, account) {
    if (res === 'owner') { // 0523R1-1（GPT）：最後一次比對之後（例如確認視窗開著時）別的分頁換人登入 → 不存、表單留著
      // 0523R2-2：用交易當下擋下的帳號組提示（一定跟主人不同）；萬一沒有，也照樣說「這次沒有存」
      saveStop(saveOwnerClash({ account }, { account: state.ownerClashAcct || '別人' }) || ('這次沒有存（表單留著）；請用 ' + account + ' 登入再按儲存／ယခု မသိမ်းရသေးပါ (ဖောင် ကျန်နေမည်)၊ ' + account + ' ဖြင့် ဝင်ပြီး သိမ်းပါ'));
      return;
    }
    if (res === 'stale') { // 檢查之後資料剛更新 → 不存，重新判斷結案欄，請業務確認後再按（表單留著）
      toast('確認之後這位的資料剛更新，這次沒有存；請確認試作結果後再按儲存／အတည်ပြုပြီးနောက် ဒေတာ အပ်ဒိတ်ဖြစ်သွား၍ မသိမ်းရသေးပါ၊ စမ်းသပ် ရလဒ် စစ်ပြီး ထပ်နှိပ်ပါ');
      if (typeof recheckCloseTrial === 'function') await recheckCloseTrial(false);
      refreshSave();
      return;
    }
    if (res !== 'ok') { saveStop('手機存檔失敗（可能空間不足），資料還在畫面上，請再按一次／ဖုန်းထဲ သိမ်းမရပါ (နေရာ မလောက်ခြင်း ဖြစ်နိုင်)၊ ဒေတာ စာမျက်နှာပေါ် ရှိနေသေးသည်၊ ထပ်နှိပ်ပါ'); return; }
    // 0.5.23 J5：已經存進手機（記在表單主人名下），這時沒有人登入 → 清表單、回登入頁，登入後自動上傳
    // 0523R1-1：存完再讀一次（確認視窗期間可能有人登入或登出），照存完當下決定回登入頁還是回首頁
    // 0523R2-1（GPT）：這時已經存好了，讀設定出錯也不能讓錯誤丟出去（表單留著，再按會多存一筆）→ 讀不到就照一般存完的路（先清表單）
    let cfgAfter;
    try { cfgAfter = await getConfig(); } catch (e) { cfgAfter = undefined; }
    if (cfgAfter !== undefined && (!cfgAfter || !cfgAfter.deviceKey)) {
      resetForm();
      showLogin('登入已失效：剛剛那筆已經存在手機裡，請用 ' + account + ' 重新登入，登入後會自動上傳／ဝင်ရောက်မှု သက်တမ်းကုန် - မှတ်တမ်း ဖုန်းထဲ သိမ်းပြီး၊ ' + account + ' ဖြင့် ပြန်ဝင်လျှင် အလိုအလျောက် တင်မည်');
      return;
    }
    await afterSaved();
  }

  function resetForm() {
    state.formGen++;
    state.farmerVal = ''; // 0.4.91 低1：上一次選的客戶也清掉（不然下次先填結案欄位再選農民，會被誤問「換農民」、取消還跳回上一位）
    // 0.4.54 第6任檢查：上一位客戶的進度卡、作物四格會殘留到下一次打卡畫面 → 進畫面就清掉
    const pbx = $('progressBox'); if (pbx) { pbx.hidden = true; pbx.innerHTML = ''; }
    { const fi = $n('farmerInfo'); if (fi) { fi.hidden = true; fi.innerHTML = ''; } } // 第28任：農民資料框也清掉
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
    if (typeof FarmVoice === 'object') FarmVoice.stop(true); // 第24任 必改第五批：語音輸入也停、丟掉還沒回來的字
    $('recBtn').classList.remove('rec');
    $('photoBtn').classList.remove('busy'); $('albumBtn').classList.remove('busy');
    state.photos = []; state.audio = null; state.audioSec = 0; state.original = null;
    if (typeof clearCmp === 'function') clearCmp(); // 第27任 對照農民三段打字一起清
    renderThumbs();
    $('photoInput').value = ''; $('albumInput').value = '';
    $('recBtn').classList.remove('done');
    $('recBtn').querySelector('.label').textContent = '錄音';
    $('note').value = ''; if (typeof $n === 'function') $n('vStageWhy').value = ''; // 0.5.26 沒選階段的原因一起清
    $('priceRows').innerHTML = '';
    if (isDealerCat()) addPriceRow();
    $('farmer').value = '';
    $('profileBox').hidden = true;
    Object.values(PROFILE_INPUTS).forEach(id => { $n(id).value = ''; });
    // resetTrialForm 已清結案的試作結果、種植失敗勾選（0.5.16 第1輪 R1-02 回報殘留，第2輪核對是誤報：這裡本來就清）
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
      await Store.setMeta('loginLost', { key: sentKey, msg }); // 0.4.91 中4：記在手機裡，背景程式、重新整理後的同步也知道不要再用這把金鑰重傳
      toast('登入已失效：這一筆可以先存在手機裡，回首頁後再重新登入／ဝင်ရောက်မှု သက်တမ်းကုန် - ယခုတစ်ခု ဖုန်းထဲ သိမ်းထားနိုင်သည်၊ ပင်မစာမျက်နှာသို့ ပြန်ပြီး ပြန်ဝင်ပါ');
      return 'later';
    }
    if (typeof tagOwner === 'function') await tagOwner(); // R24-1（抽函式跑的舊測試沒有它）
    await Store.setMeta('config', { gasUrl: now.gasUrl });
    showLogin(msg);
    return 'now';
  }
  /** 0.4.87 中6：離開打卡畫面時，補做先前延後的「登入失效」（金鑰還是同一把才做）；0.4.91 也讀手機裡記的（重新整理過也接得上） */
  async function loginLostCheck() {
    if (state.lockedOut) { const m = state.lockedOut; state.lockedOut = null; showLogin(m); return true; } // 第25任 審查①：解鎖鎖死時正在填表單（金鑰已經清掉），離開打卡畫面就回登入頁
    const L = state.loginLost || (await Store.getMeta('loginLost'));
    if (!L) return false;
    state.loginLost = null; await Store.setMeta('loginLost', null);
    const now = (await Store.getMeta('config')) || {};
    if (!now.deviceKey || now.deviceKey !== L.key) return false;
    if (typeof tagOwner === 'function') await tagOwner(); // R24-1（抽函式跑的舊測試沒有它）
    await Store.setMeta('config', { gasUrl: now.gasUrl });
    showLogin(L.msg);
    return true;
  }
  /** 第25任 審查第三批：每分鐘的自動同步在「沒東西要傳」時原本每次都整份抓後台資料（客戶、首頁、試作、任務…）再重畫首頁 → 手機開著首頁一小時抓 60 次。
   *  改成自動的那次距離上次抓成功不到 5 分鐘就不抓、不重畫；連上網路、切回畫面、存檔後、手動同步不受限制 */
  const AUTO_PULL_MS = 5 * 60 * 1000;
  async function syncNow() {
    const cfg = await getConfig();
    const auto = !!(arguments[0] && arguments[0].auto === true); // 第25任 審查第三批：只有計時器明確給 { auto: true } 才算自動（online 事件會把 Event 物件傳進來）。不寫成參數：很多舊測試用函式開頭那一行（沒有參數）找這個函式；這行註解也不能寫大括號（舊測試數大括號抽函式）
    if (!cfg || !cfg.deviceKey) {
      // 0533 N1：別的分頁登出了（切回這頁、連上網路時會跑同步）→ 這頁也回登入頁。已在登入頁不重畫（不洗掉錯誤訊息）；
      //   打卡頁已經填了東西不跳走（照 0.5.23 J5 先存進手機、存完回登入頁）
      if (state.view && state.view !== 'setup' && !(state.view === 'visit' && formDirty())) showLogin('登入已失效（可能在別的畫面登出了），請重新登入／ဝင်ရောက်မှု သက်တမ်းကုန် (အခြားနေရာတွင် ထွက်သွားခြင်း ဖြစ်နိုင်)၊ ပြန်ဝင်ပါ');
      return;
    }
    // 0.4.91 中4：延後登出期間（打卡中登入失效、保留表單）不上傳、不再跳提示，只更新待上傳筆數；不在打卡畫面了（例如重新整理過）就補做登出
    const lost = state.loginLost || (await Store.getMeta('loginLost'));
    if (lost && lost.key === cfg.deviceKey) {
      if (state.view === 'visit') { await renderQueue(); return; }
      if (await loginLostCheck()) return;
    }
    if (syncing || !navigator.onLine) { await renderQueue(); return; }
    syncing = true;
    try {
      let r = await runSync(p => { $('syncState').textContent = `上傳中 တင်နေသည် ${p.index} / ${p.total}…`; });
      if (r && r.code === 'BAD_LOGIN') {
        // 帳號被停用或重設密碼：手機裡沒傳的資料保留，重新登入後接著傳（0.4.87 高1、中6：交給 onLoginExpired）
        await onLoginExpired(cfg.deviceKey, (r.error || '登入已失效') + '。沒上傳的資料還在手機裡，重新登入後會自動補傳。／ပြန်ဝင်ပြီးလျှင် ကျန်သော မှတ်တမ်း တင်မည်။');
        return;
      }
      // 第25任 審查⑪：背景程式正在上傳（拿不到上傳鎖回 busy）不是「沒東西要傳」——原本照樣再抓一次整份資料、把上傳進度字清掉。傳完背景程式會通知畫面重畫
      // 抓BUG第3輪 手機組1：這行原本在下面「自動那次」後面 → 每分鐘的自動同步先被那行接走，把「背景上傳中」清成空白。移到前面
      if (r && r.busy) { $('syncState').textContent = '背景上傳中…／နောက်ကွယ်မှ တင်နေသည်…'; return; }
      if (r && r.rejected) toast(`有 ${r.rejected} 筆拜訪被後台退回、沒有收／သွားရောက်မှု ${r.rejected} ခုကို ဆာဗာမှ ပြန်ပို့ထားပြီး လက်မခံပါ：${r.rejectMsg || ''}`, 4000); // 第28任保哥式審查：被拒當下就說原因（例如沒拍照要重新打卡）
      // 抓BUG第4輪 手機組1：r.sent 只算拜訪 → 自動同步送出打勾、後台已確認，任務清單卻沒重畫（還寫「再按一下可取消」）。送了打勾也要往下重畫
      if (auto && r && !r.error && !r.sent && !r.ticksSent && Date.now() - (state.lastPullAt || 0) < AUTO_PULL_MS) { $('syncState').textContent = r.syncWarn || ''; return; } // 第25任 審查第三批：自動那次、沒東西傳、5 分鐘內抓過 → 不抓不重畫（finally 照樣更新待上傳筆數）
      if (r && !r.error && !r.sent && await syncPullLatest(cfg, r)) return;
      await syncAfter(cfg, r);
    } catch (e) {
      syncFailed(e);
    } finally {
      syncing = false;
      await renderQueue();
    }
  }
  /** 同步：這次沒有要上傳的 → 順便抓最新的客戶、選單和首頁數字（寫回失敗、後台舊版記在 r.syncWarn，抓失敗記在 r.pullWarn）；登入失效回 true（syncNow 就此結束） */
  async function syncPullLatest(cfg, r) {
    // 沒有要上傳的，順便抓最新的客戶、選單和首頁數字
    const sentAt = Date.now();
    const data = await post(cfg.gasUrl, { action: 'sync', deviceKey: cfg.deviceKey, ask: (typeof FarmCore !== 'undefined' && FarmCore.buildAsk) ? await FarmCore.buildAsk() : undefined }).catch(() => null); // R19：問自己手機上的暫存收到了沒
    if (data && data.ok) { // 0.4.91 高1：帶送出時的金鑰，換了帳號就整份丟掉
      state.lastPullAt = Date.now(); // 第25任 審查第三批：抓成功才算（失敗下一分鐘照樣再抓）
      // R13-01：寫回失敗（空間不足等）不中斷，記住「暫存先別清」、畫面寫提示
      try { await rememberServer(data, sentAt, cfg.deviceKey); } catch (e) { r.syncWarn = FarmCore.SYNC_WARN || '同步資料寫回手機失敗，稍後再同步／စင့်ခ်ဒေတာ ဖုန်းထဲ ပြန်သိမ်းမရပါ၊ နောက်မှ ထပ်စင့်ခ်လုပ်မည်'; } // R14：暫存清理看後台快取，這裡只要提示
      if (!r.syncWarn && typeof FarmCore !== 'undefined' && FarmCore.oldServer && FarmCore.oldServer(data)) r.syncWarn = FarmCore.OLD_SRV_WARN; // R20（GPT 04）：後台被單獨退回舊版 → 不清理、提示
    }
    else if (data && data.code === 'BAD_LOGIN') { await onLoginExpired(cfg.deviceKey, (data.message || '登入已失效') + '。沒上傳的資料還在手機裡，重新登入後會自動補傳。／ပြန်ဝင်ပြီးလျှင် ကျန်သော မှတ်တမ်း တင်မည်။'); return true; } // 0.4.87 高1、中6；0.4.92 中2 比照上傳那條加緬文
    // 第25任 審查⑫：連不上後台（被擋、逾時）或後台回錯誤，原本 .catch(() => null) 之後什麼都不說，首頁數字一直是舊的。只在上傳狀態列寫一行（每分鐘都會跑，不跳提示）；
    //   不放進 r.error：後面「同步成功才做」的判斷照舊
    else r.pullWarn = '抓最新資料失敗，首頁可能不是最新的；一直這樣請改用備用網址／နောက်ဆုံး ဒေတာ ဖတ်မရ၍ ပင်မစာမျက်နှာ မအပ်ဒိတ်သေးနိုင်ပါ၊ ဆက်ဖြစ်နေလျှင် အရန်လိပ်စာ သုံးပါ';
    return false;
  }
  /** 同步：上傳、抓完之後——上傳狀態列、清理暫存、比對種植資料、重畫首頁或選單、送錯誤紀錄 */
  async function syncAfter(cfg, r) {
    $('syncState').textContent = r && r.error ? r.error : r && r.pullWarn && !r.syncWarn ? r.pullWarn : (r && r.syncWarn) || ''; // R13-01：寫回失敗的提示也顯示（第25任 審查⑫：抓資料失敗的提醒也顯示）
    // 0.4.81（0.4.80 巡檢中1）：上傳、同步完成 → 種植資料的紀錄切回來要重讀（這裡不馬上重讀，省流量）
    if (r && !r.error) { const ph = document.getElementById('plHistory'); if (ph) ph._doneCid = null; }
    // R16-05（GPT 中）：前景抓完最新資料後試作記號也要馬上清理（runSync 的清理在抓資料之前），不然主管退回、待確認的試作要再同步一次才看得到
    // R18（Gemini 2）：這一輪後台資料寫回手機失敗 → 不清理（快取、known 還是舊的）
    if (!(r && r.syncWarn)) {
      if (typeof FarmCore !== 'undefined' && FarmCore.pruneLocalTrials) await FarmCore.pruneLocalTrials();
      await pruneLocalCustomers();
  }
  if (r && !r.error) await plantPendingCheck(); // 0.4.94 中4：同步成功（上傳完或抓完最新客戶）就比對逾時的種植資料：後台已是送出的值 → 提示已存好
  if (state.view === 'home') await renderHome();
  // 正在填拜訪而且已經選了客戶，就不重整選單（暫時客戶上傳後會換成正式編號，重整會把選好的清掉；R1-02）
  if (state.view === 'visit' && !$('farmer').value) { await loadOptions(); await loadFarmers(); }
  if (typeof refreshCloseUnknown === 'function') await refreshCloseUnknown(); // R26-1：正在填結案時，照同步後的試作快取重新判斷「結案狀態未知」
  if (r && !r.error && typeof sendErrs === 'function') await sendErrs(cfg); // 第26任：同步成功就順便把手機記下的錯誤送到後台錯誤紀錄
  }
  /** 同步：途中丟錯 → 上傳狀態列寫原因（空間不足或程式錯），並記下來 */
  function syncFailed(e) {
    // 0.5.33（第23任抓BUG P1）：上傳途中讀寫手機資料庫丟錯（多半是空間不足），原本只有 try/finally → 畫面停在「上傳中 1/3…」不說原因
    $('syncState').textContent = '手機存資料失敗（可能空間不足），請清出空間，稍後自動再傳／ဖုန်းထဲ သိမ်းမရပါ (နေရာ မလောက်ခြင်း ဖြစ်နိုင်)၊ နေရာလွတ် လုပ်ပေးပါ၊ နောက်မှ အလိုအလျောက် ပြန်တင်မည်';
    // 第26任：這段也包住畫首頁、重讀選單 → 程式本身出錯時不說成空間不足（業務會去清空間，問題卻還在），並記下來
    if (typeof isCodeErr === 'function' && isCodeErr(e)) $('syncState').textContent = '同步途中程式出錯（' + errCode(e) + '），稍後自動再試；一直出現請告訴主管';
    if (typeof noteErr === 'function') noteErr('同步', e);
  }


  /** 1號清單低#6（第8任）：這支手機裡「目前帳號」的拜訪（跟 renderQueue 同一條規則；沒記帳號的舊資料照算）。換人登入後前一位的拜訪不能被當成「我」 */
  async function myVisits() {
    const cfg = (await Store.getMeta('config')) || {};
    return ((await Store.allVisits()) || []).filter(v => !v.account || !cfg.account || v.account === cfg.account);
  }
  /** 這支手機知道的所有客戶：後台同步下來的，加上這支手機新增、還沒上傳的 */
  async function allKnownCustomers() {
    const fromServer = (await Store.getMeta('farmers')) || [];
    const addedHere = (await myLocal('localCustomers')) || [];
    return fromServer.concat(addedHere);
  }
  async function renderQueue() {
    // 0.4.54 第6任檢查：同一支手機換人登入，別人的紀錄不列、不算「沒上傳」（上傳本來就只送自己帳號的，算進來會永遠掛著）
    const qcfg = (await Store.getMeta('config')) || {};
    const all = (await Store.allVisits()).filter(v => !v.account || !qcfg.account || v.account === qcfg.account).sort((a, b) => b.deviceTime - a.deviceTime);
    const pending = all.filter(v => v.status === 'pending');
    const rejected = all.filter(v => v.status === 'rejected').length;
    const ticks = (await mineTicks()).length; // 只算自己帳號的打勾（自行審查 S1）
    const left = [pending.length ? `${pending.length} 筆拜訪` : '', ticks ? `${ticks} 個任務打勾` : ''].filter(Boolean).join('、');
    $('pendingCount').textContent = (left ? `還有 ${left}沒上傳／မတင်ရသေး ${pending.length + ticks} ကျန်ရှိသည်` : '全部都上傳了／အားလုံး တင်ပြီး') + (rejected ? `（另有 ${rejected}`
      + ` 筆被拒，請洽主管／နောက်ထပ် ${rejected} ခု ပယ်ခံရ၊ မန်နေဂျာကို မေးပါ）` : '');
    $('pendingCount').className = 'count ' + (left ? 'wait' : 'ok');
    if (typeof paintStoreWarn === 'function') paintStoreWarn(pending.length + ticks); // 第24任 必改第二批②（舊測試只抽 renderQueue 出來跑）
    // 同一個狀態也放在首頁最上面，隨時看得到（優化 2）
    $('syncBadge').hidden = false;
    $('syncBadge').className = 'syncbadge ' + (left || rejected ? 'wait' : 'ok');
    $('syncBadge').textContent = left ? `⏳ ${pending.length + ticks} 筆沒上傳 မတင်ရသေး` : rejected ? `⚠ ${rejected} 筆被拒 ပယ်ခံရ` : '✓ 都上傳了 တင်ပြီး';
    const hw = typeof document !== 'undefined' && document.getElementById ? document.getElementById('hdrWait') : null;
    if (hw) {
      hw.hidden = !(left || rejected);
      hw.textContent = left ? `⏳ ${pending.length + ticks} 筆沒上傳` : rejected ? `⚠ ${rejected} 筆被拒` : '';
    } // 第24任 第六批①
    $('queueList').innerHTML = all.filter((v, i) => i < 12 || v.status === 'rejected').map(v => { // 第28任：被拒的就算比較舊也列出來（要看得到原因）
      const d = new Date(Number(v.deviceTime) + 390 * 60000); // 0.5.16 第2輪 低：緬甸時間（下面用 getUTC*），手機時區不是緬甸也不會差一天
      const tag = v.status === 'uploaded' ? '<span class="pill ok">已上傳 တင်ပြီး</span>'
        : v.status === 'rejected' ? '<span class="pill late">被拒 ပယ်ခံရ</span>' : '<span class="pill wait">等上傳 စောင့်နေ</span>';
      const n = Array.isArray(v.photos) && v.photos.length ? v.photos.length : (v.photoCount || (v.photo ? 1 : 0));
      // 0.4.91 低4：照片張數用上傳後記的（扣掉讀不到的）；錄音沒傳成就不寫秒數
      const what = [n ? `照片 ${n} ပုံ` : '', v.audioSec && !v.audioLost ? `錄音 ${v.audioSec} 秒 အသံ` : '', v.text ? '打字 စာ' : '', v.prices && v.prices.length ? `價格 ${v.prices.length} ဈေး` : ''].filter(Boolean).join('・'); // 0.4.94 低2 加緬文
      // 0.4.91 低4：後台說客戶已經不存在（被刪）→ 這筆的結案、試作沒收，標出來
      const miss = (v.missingCustomer ? '<br><small class="err">客戶已不存在，結案／試作沒收，請洽主管／ဖောက်သည် မရှိတော့ပါ၊ ပိတ်သိမ်း/စမ်းသပ်မှု လက်မခံပါ၊ မန်နေဂျာကို မေးပါ</small>' : '')
        + (v.closingDropped && !v.missingCustomer ? `<br><small class="err">${esc(v.closingDropped)}／ပိတ်သိမ်းမှု မလက်ခံပါ၊ မန်နေဂျာကို မေးပါ</small>` : '') // 0.5.16 第1輪：結案沒收要讓業務知道
        + (v.trialDropped && !v.missingCustomer ? `<br><small class="err">${esc(v.trialDropped)}／စမ်းသပ်မှု မလက်ခံပါ၊ မန်နေဂျာကို မေးပါ</small>` : '') // 0.5.19 B1：試作開始／結束沒收也要讓業務知道
        + (v.status === 'rejected' && v.rejectReason ? `<br><small class="err">${esc(v.rejectReason)}</small>` : ''); // 第28任保哥式審查：被拒的寫出原因（例如「拜訪農民一定要有照片…請重新打卡並拍照」）
      return `<li><span>${esc(v.farmerLabel)}<br><small>${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${what ? '・' + esc(what) : ''}`
        + `</small>${miss}</span>${tag}</li>`;
    }).join('') || '<li class="empty">還沒有紀錄／မှတ်တမ်း မရှိသေး</li>';
  }

  /* ───── 小提示 ───── */
  let toastTimer, toastHoldUntil = 0, toastQueued = null, toastQueueTimer = null;
  /**
   * 小提示。第24任 必改第三批⑦：存檔後的「已存在手機裡」原本會被緊接著的同步提示蓋掉，一閃就不見 →
   *   holdMs：這則至少留這麼久（這段時間來的其他提示先排著，時間到再顯示最後一則）；顯示時間＝max(3 秒, holdMs＋1 秒)。沒給 holdMs 跟原本一樣 3 秒
   */
  function toast(t, holdMs) {
    const now = Date.now();
    if (!holdMs && now < toastHoldUntil) {
      toastQueued = t;
      clearTimeout(toastQueueTimer);
      toastQueueTimer = setTimeout(() => { const q = toastQueued; toastQueued = null; if (q) toast(q); }, toastHoldUntil - now);
      return;
    }
    const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer);
    if (holdMs) toastHoldUntil = now + holdMs;
    toastTimer = setTimeout(() => { el.hidden = true; }, Math.max(3000, (holdMs || 0) + 1000));
  }

  /* ───── 啟動 ───── */
  /* 0.4.91 中1（第11任第三輪清單）：網頁（index.html）和程式（app.js）新舊混用時（背景程式逾時各自拿快取），試作品項只剩空白、開不了試作。
     兩邊各放一個版本標記（index.html <meta name="app-build">、這裡的 APP_BUILD），開機比對：不一樣就重新整理一次。
     防無限重整：同一對「網頁標記｜程式標記」只重整一次（記在 sessionStorage）；記不下來就不重整 */
  // 0.4.98（第13任 手機7）：原本固定 '0491-1'，之後 index.html 改過（0.4.96 加「播種」選項）標記沒跟著換 → 新程式配舊網頁偵測不到。
  // 改成跟版號一樣（config.js appVersion、index.html app-build、這裡三個一起改；test-0498_第13任.js 檢查三個相同）
  const APP_BUILD = 'build-20261120-224356'; // 要跟 index.html 的 app-build 一模一樣
  function buildCheck() {
    try {
      const m = document.querySelector && document.querySelector('meta[name="app-build"]');
      const page = m ? String(m.getAttribute('content') || '') : '';
      if (page === APP_BUILD) return false;
      const key = 'farm-build-reload', pair = page + '|' + APP_BUILD;
      let done = '';
      try { done = sessionStorage.getItem(key) || ''; } catch (e) { return false; }
      if (done === pair) return false; // 這一對已經重整過一次了：不再重整，照常開
      try { sessionStorage.setItem(key, pair); } catch (e) { return false; }
      location.reload();
      return true;
    } catch (e) { return false; }
  }
  /** 開機：只排順序（步驟見下面幾個函式；接按鈕的先後跟拆分前一樣，同一個元件上的動作順序不變） */
  async function init() {
    if (buildCheck()) return; // 0.4.91 中1：新舊混用 → 重新整理一次
    $('appVer').textContent = 'v' + FARM_CONFIG.appVersion;
    renderMirrors();
    showInstallTips();
    setupServiceWorker();
    bindHomeMenus();
    bindVisitForm();
    bindCloseAndPlant();
    bindVisitDetails();
    bindAutoSync();
    await startApp();
  }
  /** 加到主畫面的說明（iPhone、Android） */
  function showInstallTips() {
    // 第24任 必改第二批②：iPadOS 13 起冒充 Mac（MacIntel＋觸控）也算；可關閉，記住不再顯示
    const isIOS = typeof FarmCore === 'object' && FarmCore.isIOS ? FarmCore.isIOS(navigator.userAgent) : /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints) > 1); // 第25任 審查第二批：共用 FarmCore.isIOS
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    let iosClosed = false; try { iosClosed = localStorage.getItem('farm-ios-tip') === 'off'; } catch (e) { /* 記不了就每次顯示 */ }
    // 第24任 第六批①：說明預設收起，頂端只留一個 📱 圖示，按了才打開（舊頁面沒有圖示就照舊直接顯示）
    const icon = typeof document !== 'undefined' && document.getElementById ? document.getElementById('tipIcon') : null; // 抽函式跑的舊測試沒有 document
    const showTip = (el, want) => { if (!icon) { el.hidden = !want; return; } el.hidden = true; if (want) { icon.hidden = false; icon.dataset.tip = el.id; } };
    showTip($('iosTip'), isIOS && !standalone && !iosClosed);
    const ic = $n('iosTipClose');
    if (ic) ic.addEventListener('click', () => {
      $('iosTip').hidden = true;
      if (icon) icon.hidden = true;
      try { localStorage.setItem('farm-ios-tip', 'off'); } catch (e) { /* 記不了：這次先關 */ }
    });
    // 0.4.94 低3（第11任第五輪）：Android 也說明「加到主畫面」（比照 iPhone）；LINE 等 App 內建瀏覽器不顯示（inapp.js 已叫他換 Chrome）；可關閉，記住不再顯示
    {
      const ua = navigator.userAgent || '';
      const inApp = /\bLine\/|FBAN|FBAV|FB_IAB|Messenger|Instagram|MicroMessenger|Zalo|Viber|Telegram|; wv\)/i.test(ua);
      let closed = false; try { closed = localStorage.getItem('farm-android-tip') === 'off'; } catch (e) { /* 記不了就每次顯示 */ }
      const at = $n('androidTip');
      const hide = !(/android/i.test(ua) && !inApp && !standalone && !closed);
      const ti = typeof document !== 'undefined' && document.getElementById ? document.getElementById('tipIcon') : null; // 第24任 第六批①：有 📱 圖示就收起來，按圖示才打開
      if (ti) { at.hidden = true; if (!hide) { ti.hidden = false; ti.dataset.tip = 'androidTip'; } } else at.hidden = hide;
      $n('androidTipClose').addEventListener('click', () => { at.hidden = true; if (ti) ti.hidden = true; try { localStorage.setItem('farm-android-tip', 'off'); } catch (e) { /* 記不了：這次先關 */ } });
    }
    if (icon && !icon.dataset.bound) {
      icon.dataset.bound = '1';
      icon.addEventListener('click', () => {
        const t = document.getElementById(icon.dataset.tip || '');
        if (!t) return;
        t.hidden = !t.hidden;
        icon.setAttribute('aria-expanded', t.hidden ? 'false' : 'true');
        if (!t.hidden && t.scrollIntoView) t.scrollIntoView({ block: 'start' });
      });
    }
  }
  /** 背景程式：註冊、有新版時自動更新、背景同步完通知畫面；請瀏覽器別清掉手機資料 */
  function setupServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => { // 0.5.25 T4：背景程式和它載入的 core.js 都不吃瀏覽器 HTTP 快取，新版不會裝到舊核心
        // 有新版：沒在填拜訪、也沒在上傳，就更新。
        // 原本要等「手機裡沒有待上傳的資料」才更新，但一筆一直傳不上去的資料會讓這支手機永遠停在舊版、拿不到修正（第六輪自抓）；
        // 新版一定能讀舊版存的資料（有測試保護），所以不用再等
        // 2號 0.4.69 低6（第8任）：種植資料表單打開（改到一半或正在存）也先不更新，不然 0.6 秒後整頁重整、改的內容不見；下次打開網頁就是新版
        // 0.5.20 F2（第19任）：原本只在「剛裝好那一刻」判斷一次——那時正在填拜訪就一直停在等待（背景自動上傳跑舊版核心），重開網頁也不會再問（updatefound 不會再來）。
        //   改成：剛裝好、或打開網頁時就已經有等待中的新版，都交給 swTryActivate；當下不能更新就每 20 秒再看一次，離開打卡畫面、上傳完就更新
        // 現在可不可以重整：沒在填拜訪、沒在上傳、種植資料沒打開、沒在打字；
        // 0.5.20 G1（第19任）：建議框開著（字還沒送出或正在送）、登入中、有請求送出中（state.netBusy，gasCall 計數）也先不重整，不然寫好的字、送到一半的請求會不見
        const safeNow = () => {
          const plantEditing = !$n('plForm').hidden;
          const ae = typeof document !== 'undefined' && document.activeElement, typing = !!(ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName || '')); // 正在打字（建議、任務等其他欄位）也先不重整
          const fbOpen = !!($n('feedbackBox') && $n('feedbackBox').hidden === false), busyNet = !!state.loggingIn || (Number(state.netBusy) || 0) > 0;
          return { ok: state.view !== 'visit' && !syncing && !plantEditing && !typing && !fbOpen && !busyNet, plantEditing };
        };
        // 0520R1-1（GPT）：送出更新後原本固定 0.6 秒就重整、不再檢查——這段時間業務切到打卡畫面開始填，照樣被重整 → 重整「當下」再檢查一次，不行就每秒再看，可以了才重整
        const reloadWhenSafe = first => setTimeout(() => { if (safeNow().ok) location.reload(); else reloadWhenSafe(false); }, first ? 600 : 1000);
        const tryNow = nw => {
          if (!nw || nw.state !== 'installed' || !navigator.serviceWorker.controller || state.swActivating) return true; // 不用再等（沒有新版、已經在更新）
          const s = safeNow();
          if (s.ok) { state.swActivating = true; nw.postMessage('skipWaiting'); reloadWhenSafe(true); return true; }
          if (s.plantEditing && !state.swToasted) { state.swToasted = true; toast('有新版，種植資料存好後就會更新／ဗားရှင်းအသစ် ရှိသည်၊ စိုက်ပျိုးမှု အချက်အလက် သိမ်းပြီးလျှင် အပ်ဒိတ်ဖြစ်မည်'); }
          return false;
        };
        const watch = nw => {
          if (tryNow(nw)) return;
          clearInterval(state.swTimer);
          state.swTimer = setInterval(() => { if (tryNow(reg.waiting || nw)) clearInterval(state.swTimer); }, 20000);
        };
        if (reg.waiting) watch(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw && nw.addEventListener('statechange', () => { if (nw.state === 'installed') watch(nw); });
        });
        if ('periodicSync' in reg) reg.periodicSync.register('upload-visits', { minInterval: 60 * 60 * 1000 }).catch(() => {});
      }).catch(() => {});
      navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'synced') {
        renderQueue();
        if (state.view === 'home') renderHome();
        if (typeof refreshCloseUnknown === 'function') refreshCloseUnknown();
      } }); // R27-4：背景同步完也重新判斷正在填的結案
    }
    if (typeof checkPersist === 'function') checkPersist(); // 第24任 必改第二批②：原本只申請、不看結果（舊測試只抽這個函式出來跑，沙盒裡沒有 checkPersist）
  }
  /**
   * 第24任 必改第二批②：請瀏覽器別清掉這個網站的手機資料，並記下結果 state.persist：granted／denied（被拒）／unsupported（瀏覽器沒有這功能）／unknown（查失敗）。
   * 沒答應（denied、unsupported）時，有沒上傳的資料就在首頁提醒（renderQueue 畫）：瀏覽器空間不夠或太久沒開，可能把還沒上傳的照片錄音清掉
   */
  async function checkPersist() {
    try {
      if (!navigator.storage || !navigator.storage.persist) state.persist = 'unsupported';
      else {
        let ok = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        if (!ok) ok = await navigator.storage.persist();
        state.persist = ok ? 'granted' : 'denied';
      }
    } catch (e) { state.persist = 'unknown'; }
    try { await renderQueue(); } catch (e) { /* 還沒登入、畫面還沒好：下次畫首頁時會照 state.persist 顯示 */ }
  }
  /** 首頁的「手機資料可能被清掉」提醒：沒答應長期保存＋有沒上傳的（拜訪或任務打勾）才顯示 */
  function paintStoreWarn(left) {
    const el = $n('storeWarn'); if (!el) return;
    const risky = state.persist === 'denied' || state.persist === 'unsupported';
    el.hidden = !(risky && left > 0);
    const zh = $n('storeWarnZh');
    if (zh && !el.hidden) zh.textContent = '⚠ 這支手機的瀏覽器沒有答應長期保存資料，還有 ' + left + ' 筆沒上傳：請盡快連上網路上傳' + ((typeof FarmCore === 'object' && FarmCore.isIOS ? FarmCore.isIOS(navigator.userAgent || '') : /iphone|ipad|ipod/i.test(navigator.userAgent || '')) ? '；iPhone 請把網頁加到主畫面、只從主畫面圖示打開' : '')
      + '，上傳前不要清除瀏覽器資料。';
    const my = el.querySelector ? el.querySelector('.my') : null;
    if (my && !el.hidden) my.textContent = '⚠ ဤဖုန်း Browser သည် ဒေတာ ရေရှည်သိမ်းရန် ခွင့်မပြုသေးပါ၊ ကျန်နေသေးသည်မှာ ' + left + ' ခု မတင်ရသေးပါ - အင်တာနက် အမြန်ချိတ်ပြီး တင်ပါ' + ((typeof FarmCore === 'object' && FarmCore.isIOS ? FarmCore.isIOS(navigator.userAgent || '') : /iphone|ipad|ipod/i.test(navigator.userAgent || '')) ? '၊ iPhone တွင် ပင်မစာမျက်နှာသို့ ထည့်ပြီး ပင်မအိုင်ကွန်မှသာ ဖွင့်ပါ' : '')
      + '၊ မတင်ရသေးမီ Browser ဒေတာ မဖျက်ပါနှင့်။';
  }
  /** 第24任 第六批⑧：執行任務分頁的區塊可收合（標題當開關，鍵盤 Enter／空白鍵也行），收合狀態存在 localStorage farm-todo-fold */
  const TODO_FOLD_DEFAULT = { todoPlanGrow: true, mineFarmers: true };
  function initTodoFold() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('farm-todo-fold') || '{}') || {}; } catch (e) { saved = {}; }
    document.querySelectorAll('#hp-todo #todoLeft, #hp-todo .msec').forEach(sec => {
      const head = sec.querySelector('h2, h3'); if (!head || !sec.id) return;
      sec.classList.add('foldable'); head.classList.add('foldhead'); head.setAttribute('role', 'button'); head.tabIndex = 0;
      const set = f => { sec.classList.toggle('folded', f); head.setAttribute('aria-expanded', f ? 'false' : 'true'); };
      set(sec.id in saved ? !!saved[sec.id] : !!TODO_FOLD_DEFAULT[sec.id]);
      const flip = () => {
        const f = !sec.classList.contains('folded');
        set(f);
        saved[sec.id] = f;
        try { localStorage.setItem('farm-todo-fold', JSON.stringify(saved)); } catch (e) { /* 記不了：這次有效 */ }
      };
      head.addEventListener('click', e => { if (e.target.closest && e.target.closest('a,button,input,select')) return; flip(); });
      head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    });
  }
  /** 第24任 第六批④：選客戶的搜尋結果與「＋新增」按鈕。搜尋只在選單裡有的客戶中找（結案只列可結案的） */
  function paintFarmerPick() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const sel = document.getElementById('farmer'), inp = document.getElementById('farmerSearch'), hits = document.getElementById('farmerHits');
    if (!sel || !inp || !hits) return;
    const has = new Set([...sel.options].map(o => o.value)); // 第27任：「＋ 新增」按鈕已拿掉（新增從選單選）
    const q = inp.value.trim().toLowerCase();
    if (!q) { hits.hidden = true; hits.innerHTML = ''; return; }
    const list = (state.farmerPick || []).filter(f => has.has(f.id) && f.key.indexOf(q) >= 0).slice(0, 30);
    hits.hidden = false;
    hits.innerHTML = list.length ? list.map(f => `<li><button type="button" data-fid="${esc(f.id)}">${esc(f.name)}<span class="sub">${esc(f.sub)}</span></button></li>`).join('')
      : '<li class="none">找不到「' + esc(inp.value.trim()) + '」<span class="my">ရှာမတွေ့ပါ 「' + esc(inp.value.trim()) + '」</span></li>'; // 第27任：「＋ 新增」按鈕拿掉，不再提示按它
  }
  function bindFarmerPick() {
    const sel = document.getElementById('farmer'), inp = document.getElementById('farmerSearch'), hits = document.getElementById('farmerHits');
    if (!sel || !inp || !hits) return;
    const pick = v => { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); inp.value = ''; paintFarmerPick(); };
    inp.addEventListener('input', paintFarmerPick);
    hits.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-fid]'); if (b) pick(b.dataset.fid); });
  }
  /** 第24任 第六批⑳（tomtom 實測：正式版頁尾也寫「第 2 期測試版・緬文待校對」）：設定「環境」＝測試才顯示，正式只顯示版本號；沒同步過照舊顯示（看不出是正式） */
  async function paintEnvFoot() {
    const t = typeof document !== 'undefined' && document.getElementById ? document.getElementById('testTag') : null; if (!t) return;
    const h = await Store.getMeta('home'); t.hidden = !!(h && h.env === '正式');
  }
  /** 第24任 第七批設計版 C：主管退回的結案（後台 home.rejected）放首頁最上面紅框；點了直接打開那筆結案、帶入上次填的內容 */
  async function paintRejected() {
    const box = typeof document !== 'undefined' && document.getElementById ? document.getElementById('rejBox') : null; if (!box) return;
    const h = await Store.getMeta('home'), list = (h && Array.isArray(h.rejected)) ? h.rejected : [];
    box.hidden = !list.length; if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<h2>主管退回，請修改後重送（' + list.length + '）<span class="my">မန်နေဂျာ ပြန်ပို့သည်၊ ပြင်ပြီး ထပ်ပို့ပါ - ' + list.length + '</span></h2>' + list.map((x, i) => `<button type="button" data-rej="${i}`
      + `"><b>${esc(x.name || x.cid)}</b>（${esc(String(x.date || '').slice(5))} 送出 ပို့သည်${x.by ? '，' + esc(x.by) + ' 退回 ပြန်ပို့' : ''}）<span class="sub">原因 အကြောင်းရင်း：${esc(x.reason || '主管沒有寫原因 မန်နေဂျာ အကြောင်းရင်း မရေးထားပါ')}</span></button>`).join('');
    box.querySelectorAll('[data-rej]').forEach(b => b.addEventListener('click', () => openRejectedClose(list[Number(b.dataset.rej)])));
  }
  async function openRejectedClose(x) {
    if (!x) return;
    const all = await allKnownCustomers();
    const c = all.find(f => String(f.id) === String(x.cid)) || {};
    if (x.result || c.type === '盤商' || c.type === '種子商') { // 盤商、種子商：簽約結案
      await signCloseOpen(c.type === '種子商' ? '種子商' : '盤商');
    } else { state.closeGroup = ['一般農民', '試作農民', '推廣農民'].indexOf(x.group) >= 0 ? x.group : '一般農民'; state.closeNext = true; await openVisit('結案'); }
    if (state.view !== 'visit') return;
    const sel = $('farmer'); if (![...sel.options].some(o => o.value === String(x.cid))) { toast('找不到這位客戶（可能已結束），請聯絡主管／ဤဖောက်သည် ရှာမတွေ့ပါ（ပြီးဆုံးပြီး ဖြစ်နိုင်）၊ မန်နေဂျာကို ဆက်သွယ်ပါ'); return; }
    sel.value = String(x.cid); await onFarmerChange();
    const put = (id, v) => { const el = $n(id); if (el && v !== '' && v != null && !el.value) el.value = String(v); };
    if (x.result) put('dcNote', x.closeReason); else {
      put('cPrice', x.price);
      put('cYield', x.yield);
      put('cBuyer', x.buyer);
      put('cPhone', x.phone);
      put('cReason', x.closeReason);
      put('cProgress', x.progress);
    }
    refreshSave(); toast('已帶入上次填的內容，照主管說的改好再送：ယခင် ဖြည့်ထားသည်ကို ထည့်ပြီးပါပြီ၊ မန်နေဂျာ ပြောသည့်အတိုင်း ပြင်ပြီး ထပ်ပို့ပါ：' + (x.reason || ''));
  }
  /** 首頁：登入登出、建議、拜訪類別卡片與下拉選單、首頁分頁、上傳狀態 */
  /** 首頁的按鈕接線（第26任 2026-11-18 老闆「把冗長的函數拆解」：70 行拆成四段，只搬位置、內容一字不改、接線順序不變；test-init拆分 逐字比對拆前紀錄）
   *  ① 登入、密碼眼睛、登出、☰ 選單、解鎖 ② 建議、收合區塊 ③ 語音輸入 ④ 首頁兩張大卡（農民／盤商選單）→ 分頁、上傳狀態 */
  function bindHomeMenus() {
    bindLoginAndHeader();
    initFeedback(); // 0.5.03 提供建議
    // 第24任 第六批⑧（tomtom 實測：執行任務 6 個區塊、3 個螢幕）：每個區塊按標題可以收合，記在手機；預設收起「主管訂的目標／種植進度」「我負責的客戶」
    initTodoFold();
    startVoiceInput();
    bindHubCards();
    initHomeTabs();
    $('syncBadge').addEventListener('click', () => {
      setHomeTab('punch');
      const q = document.querySelector('.queue');
      if (q && q.scrollIntoView) q.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }
  /** 拆自 bindHomeMenus ①：登入表單、密碼眼睛、登出、☰ 選單（點外面收起）、解鎖方式 */
  function bindLoginAndHeader() {
    $('loginForm').addEventListener('submit', onLogin);
    // 第24任 第六批⑨：密碼欄的「👁 顯示」（按一下顯示、再按隱藏）
    document.querySelectorAll('.pweye').forEach(b => b.addEventListener('click', () => {
      const i = document.getElementById(b.dataset.for);
      if (!i) return;
      const show = i.type === 'password';
      i.type = show ? 'text' : 'password';
      b.setAttribute('aria-pressed', show ? 'true' : 'false');
      b.firstChild.textContent = show ? '🙈 隱藏' : '👁 顯示';
      const sp = b.querySelector ? b.querySelector('.my') : null;
      if (sp) sp.textContent = show ? 'ဖျောက်ရန်' : 'ပြရန်';
    }));
    $('logoutBtn').addEventListener('click', logout);
    // 第24任 第六批①：☰ 選單（上傳狀態、名字、提供建議、登出、解鎖方式）；點選單外面收起
    const mb = document.getElementById('menuBtn'), hh = document.getElementById('homeHdr');
    if (mb && hh) {
      mb.addEventListener('click', e => {
        e.stopPropagation();
        const open = !hh.classList.contains('open');
        hh.classList.toggle('open', open);
        mb.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', e => { if (hh.classList.contains('open') && !hh.contains(e.target)) { hh.classList.remove('open'); mb.setAttribute('aria-expanded', 'false'); } });
      const hw = document.getElementById('hdrWait'); if (hw) hw.addEventListener('click', () => $('syncBadge').click());
    }
    const ub = document.getElementById('unlockBtn'); if (ub) ub.addEventListener('click', () => { if (typeof FarmLock === 'object') FarmLock.openSettings(lockHooks()); }); // 第24任 第四批
  }
  /** 拆自 bindHomeMenus ③：第24任 必改第五批：主要文字欄旁加 🎤 語音輸入（瀏覽器不支援就不顯示）。欄位：跟農民聊了什麼、盤商簽約內容、種植失敗原因、提供建議
   *  第26任 2026-11-18 董事長「語音輸入拿掉，手機本身就有內建」：設定 voiceInput 不是 true 就不啟動（不畫 🎤、不出現語言切換） */
  function startVoiceInput() {
    if (typeof FarmVoice === 'object' && typeof FARM_CONFIG !== 'undefined' && FARM_CONFIG.voiceInput === true) FarmVoice.init({ toast: m => toast(m), isRecording: () => !!(state.rec || state.recStarting || state.recBusy), fields: ['note', 'dcNote', 'fReason', 'feedbackText'] });
  }
  /** 拆自 bindHomeMenus ④：首頁兩張大卡（農民、盤商或種子商）的選單和下拉，選了直接進打卡畫面 */
  function bindHubCards() {
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
    // 0.5.07 下拉選單蓋在下面內容上 → 點選單和卡片以外的地方就收起來（不然會擋住上傳狀態）
    document.addEventListener('click', e => {
      if (e.target && e.target.closest && e.target.closest('.hubwrap')) return;
      for (const [m, b] of [['farmerMenu', 'farmerBtn'], ['dealerMenu', 'dealerBtn']]) {
        const menu = document.getElementById(m);
        if (menu && !menu.hidden) { menu.hidden = true; const btn = document.getElementById(b); if (btn) btn.setAttribute('aria-expanded', 'false'); }
      }
    });
    // 0.5.08 董事長「點下去會出現一般農民、試作農民、推廣農民」：卡片上蓋的原生下拉選單，選了直接進那一種（跟上面點選項的流程一樣，一樣鎖死）
    // 選完馬上把選單撥回「請選擇」，下次選同一種也會觸發
    const hubSel = (id, go) => {
      const s = document.getElementById(id);
      if (!s) return; // 舊頁面（快取混版）沒有：照舊用上面的按鈕選單
      s.addEventListener('change', async () => { const v = s.value; s.value = ''; if (v) await go(v); });
    };
    hubSel('farmerSel', async cat => {
      const newKind = newFarmerKindOf(cat);
      if (newKind) { await openNewFarmer(newKind); return; } // 第28任：「＋ 新增○○農民」直接打開那一種的新農民表單
      state.lockNext = true;
      await openVisit(cat);
      if (cat !== '農戶') state.catManual = true;
    });
    addNewFarmerOptions();
    // 後備的按鈕選單（平常點不到）也一樣：三種新增各一顆
    document.querySelectorAll('[data-newkind]').forEach(b => b.addEventListener('click', () => {
      $('farmerMenu').hidden = true; $('farmerBtn').setAttribute('aria-expanded', 'false');
      openNewFarmer(b.dataset.newkind);
    }));
    hubSel('dealerSel', async cat => {
      const newDealer = newDealerKindOf(cat);
      if (newDealer) { await openNewDealer(newDealer); return; } // 第28任：「＋ 新增盤商／種子商」直接打開新店家表單
      state.lockNext = true;
      await openVisit(cat);
    });
    addNewDealerOptions();
  }
  /*
   * 首頁「盤商或種子商」下拉也直接列「＋ 新增盤商」「＋ 新增種子商」（第28任 2026-11-20 董事長：「盤商跟種子商也要改」，同農民的做法）。
   * 選了就打開那一種的打卡畫面、客戶選單直接撥到「新增」，不用進去再選一次。
   * 緬文用程式裡現成的類別緬文＋「အသစ်」（打卡畫面客戶選單「＋ 新增盤商」本來就這樣寫），沒有新寫緬文。
   */
  const NEW_DEALER_KINDS = ['盤商', '種子商'];
  const NEW_DEALER_PREFIX = '__newdealer:';
  /** 下拉選到的值是不是「新增盤商／種子商」；是就回傳那一種，不是回傳空字串 */
  function newDealerKindOf(value) {
    const text = String(value || '');
    if (text.indexOf(NEW_DEALER_PREFIX) !== 0) return '';
    const kind = text.slice(NEW_DEALER_PREFIX.length);
    return NEW_DEALER_KINDS.indexOf(kind) >= 0 ? kind : '';
  }
  /** 跟 addNewFarmerOptions 一樣寫在程式裡（手機快取混版時舊程式看不到，不會當成類別出錯） */
  function addNewDealerOptions() {
    const sel = document.getElementById('dealerSel');
    if (!sel) return;
    NEW_DEALER_KINDS.forEach(kind => {
      const value = NEW_DEALER_PREFIX + kind;
      if ([...sel.options].some(o => o.value === value)) return;
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = '＋ 新增' + kind + '／' + CAT_MY[kind] + ' အသစ်';
      sel.appendChild(opt);
    });
  }
  /** 打開新盤商／種子商的表單：跟首頁選盤商一樣進打卡畫面，再把客戶選單撥到「新增」、收起選客戶那一塊 */
  async function openNewDealer(cat) {
    state.lockNext = true;
    await openVisit(cat);
    if (state.view !== 'visit' || state.cat !== cat) return; // 沒登入被送回登入頁、或途中改選別的
    const hasNew = [...$('farmer').options].some(o => o.value === '__new');
    if (!hasNew) return;
    $('farmer').value = '__new';
    onFarmerChange();
    hideFarmerPicker(true);
  }
  /*
   * 首頁「＋ 新增農民」（第28任 2026-11-20 董事長：「新增哪一種農民，點進來用下拉式選項就好了」）：
   * 農民下拉直接列「＋ 新增一般拜訪農民／＋ 新增對照農民／＋ 新增推廣農民」，選了就打開那一種的新農民表單，
   * 不再另外跳出三顆按鈕讓業務選第二次。例：下拉選「＋ 新增對照農民」→ 直接出現新對照農民的表單。
   */
  // 第三格是緬文（照董事長 Antigravity 譯稿 F25：「＋ 新增○○農民」）
  const NEW_FARMER_KINDS = [['農戶', '一般拜訪農民', 'ပုံမှန်သွားရောက် လယ်သမားအသစ် ထည့်ရန်'], ['試作', '對照農民', 'နှိုင်းယှဉ် လယ်သမားအသစ် ထည့်ရန်'], ['推廣', '推廣農民', 'မြှင့်တင် လယ်သမားအသစ် ထည့်ရန်']];
  const NEW_FARMER_PREFIX = '__newfarmer:';
  /** 下拉選到的值是不是「新增某一種農民」；是就回傳那一種（農戶／試作／推廣），不是回傳空字串 */
  function newFarmerKindOf(value) {
    const text = String(value || '');
    if (text.indexOf(NEW_FARMER_PREFIX) !== 0) return '';
    const kind = text.slice(NEW_FARMER_PREFIX.length);
    return NEW_FARMER_KINDS.some(pair => pair[0] === kind) ? kind : '';
  }
  /** 這三項寫在程式裡、不寫在網頁裡：手機快取混版（新網頁＋舊程式）時舊程式看不到它們，不會把它當成類別而出錯（抓BUG第12輪 手機4） */
  function addNewFarmerOptions() {
    const sel = document.getElementById('farmerSel');
    if (!sel) return;
    NEW_FARMER_KINDS.forEach(([kind, label, labelMy]) => {
      const value = NEW_FARMER_PREFIX + kind;
      if ([...sel.options].some(o => o.value === value)) return;
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = '＋ 新增' + label + '／' + labelMy;
      sel.appendChild(opt);
    });
  }
  /**
   * 從首頁新增進來的表單：上面的「選擇農民」下拉和「也可以打字找」搜尋框用不到（本來就是要新增），收起來。
   * 從首頁選一般／對照／推廣（找舊客戶）進來時 openVisit 會再打開。（第28任 2026-11-20 董事長截圖）
   */
  function hideFarmerPicker(hide) {
    const box = document.getElementById('farmerPickBox');
    if (box) box.hidden = !!hide;
  }
  /*
   * 新增農民前先跳警告（第28任 2026-11-20 董事長：「要從根本預防……一開始就要跳警告視窗出來」）。
   * 起因：Sai Wai Yan 把兩位推廣農民用「一般拜訪」建檔，沒有推廣紀錄，主管頁一直是綠色，只能事後由主管改。
   * 所以不管從哪裡新增（首頁「＋ 新增○○農民」、或打卡畫面客戶選單的「＋ 新增農民」），都先寫清楚選的是哪一種、
   * 那一種代表什麼；選錯就按取消，什麼都不建。例：選了一般拜訪 → 視窗說「不做推廣、對照，要做的請取消改選」。
   * 盤商、種子商不跳（不會跟農民的三種搞混）。中文下面空一行接緬文（董事長 Antigravity 譯稿 F25）。
   */
  const NEW_FARMER_WARN = {
    農戶: '你要新增的是【一般拜訪農民】：只拜訪，不做推廣、不做對照。\n'
      + '這位如果要做推廣或對照，請按「取消」，回首頁改選「＋ 新增推廣農民」或「＋ 新增對照農民」。\n確定是一般拜訪農民嗎？\n\n'
      + 'သင် အသစ်ထည့်မည်မှာ 【ပုံမှန်သွားရောက် လယ်သမား】 ဖြစ်သည် - သွားရောက်ရုံသာဖြစ်ပြီး မြှင့်တင်ခြင်း၊ နှိုင်းယှဉ်ခြင်း မလုပ်ပါ။ '
      + 'ဤသူအတွက် မြှင့်တင် သို့မဟုတ် နှိုင်းယှဉ် လုပ်မည်ဆိုပါက 「ပယ်ဖျက်」 ကို နှိပ်ပြီး ပင်မစာမျက်နှာသို့ ပြန်သွား၍ '
      + '「＋ မြှင့်တင် လယ်သမားအသစ် ထည့်ရန်」 သို့မဟုတ် 「＋ နှိုင်းယှဉ် လယ်သမားအသစ် ထည့်ရန်」 ကို ပြောင်းရွေးပါ။ ပုံမှန်သွားရောက် လယ်သမား ဖြစ်ကြောင်း သေချာပါသလား။',
    試作: '你要新增的是【對照農民】：存檔時會一起開始對照紀錄。\n不是對照農民的話，請按「取消」，回首頁改選別種。\n確定是對照農民嗎？\n\n'
      + 'သင် အသစ်ထည့်မည်မှာ 【နှိုင်းယှဉ် လယ်သမား】 ဖြစ်သည် - သိမ်းသည့်အခါ နှိုင်းယှဉ် မှတ်တမ်းပါ တစ်ပါတည်း စတင်မည်။ '
      + 'နှိုင်းယှဉ် လယ်သမား မဟုတ်ပါက 「ပယ်ဖျက်」 ကို နှိပ်ပြီး ပင်မစာမျက်နှာသို့ ပြန်သွား၍ အခြားအမျိုးအစား ပြောင်းရွေးပါ။ နှိုင်းယှဉ် လယ်သမား ဖြစ်ကြောင်း သေချာပါသလား။',
    推廣: '你要新增的是【推廣農民】：存檔時會一起開始推廣紀錄。\n不是推廣農民的話，請按「取消」，回首頁改選別種。\n確定是推廣農民嗎？\n\n'
      + 'သင် အသစ်ထည့်မည်မှာ 【မြှင့်တင် လယ်သမား】 ဖြစ်သည် - သိမ်းသည့်အခါ မြှင့်တင် မှတ်တမ်းပါ တစ်ပါတည်း စတင်မည်။ '
      + 'မြှင့်တင် လယ်သမား မဟုတ်ပါက 「ပယ်ဖျက်」 ကို နှိပ်ပြီး ပင်မစာမျက်နှာသို့ ပြန်သွား၍ အခြားအမျိုးအစား ပြောင်းရွေးပါ။ မြှင့်တင် လယ်သမား ဖြစ်ကြောင်း သေချာပါသလား။',
  };
  /** 跳新增農民的警告；業務按確定（或這一類不用警告）回 true，按取消回 false */
  function confirmNewFarmerKind(cat) {
    const text = NEW_FARMER_WARN[cat];
    if (!text) return true;
    return confirm(text);
  }
  /** 打卡畫面客戶選單選了一項：選「＋ 新增農民」先跳警告，按取消就撥回原本選的那位（或空白），不打開新農民表單 */
  function onFarmerPicked() {
    const sel = $('farmer');
    if (sel.value === '__new' && !confirmNewFarmerKind(state.cat)) sel.value = state.farmerPicked || '';
    state.farmerPicked = sel.value === '__new' ? state.farmerPicked : sel.value;
    onFarmerChange();
  }
  async function openNewFarmer(cat) {
    if (!confirmNewFarmerKind(cat)) return; // 按取消：留在首頁，什麼都不開
    state.lockNext = true;
    await openVisit(cat);
    // 沒登入被送回登入頁、或載入途中業務又改選了別的類別（抓BUG第12輪 手機待查 1、2）：不要把那張表單撥成新增
    if (state.view !== 'visit' || state.cat !== cat) return;
    if (cat !== '農戶') state.catManual = true;
    const hasNew = [...$('farmer').options].some(o => o.value === '__new');
    if (!hasNew) return; // 這種類別不能新增：停在原本的畫面
    $('farmer').value = '__new';
    onFarmerChange();
    hideFarmerPicker(true);
  }
  /** 打卡畫面：返回、選客戶、客戶資料欄、結案欄、照片錄音、儲存 */
  function bindVisitForm() {
    $('backBtn').addEventListener('click', () => {
      const dirty = formDirty(); // 業務BUG#5
      if (dirty && !confirm('還沒儲存，確定要回首頁？剛剛填的資料（照片、錄音、打字、匯報、結案欄位等）會不見。\nမသိမ်းရသေးပါ၊ ပင်မစာမျက်နှာသို့ ပြန်မှာ သေချာပါသလား။ ဖြည့်ထားသည်များ (ဓာတ်ပုံ၊ အသံ၊ စာ၊ ပိတ်သိမ်း စသည်) ပျောက်မည်။')) return;
      if (state.rec) state.rec.stop();
      resetForm(); showHome();
    });
    $('farmer').addEventListener('change', onFarmerPicked); // 第28任：選「＋ 新增農民」先跳警告
    bindFarmerPick(); // 第24任 第六批④
    Object.values(PROFILE_INPUTS).forEach(id => $n(id).addEventListener('input', refreshSave)); // 0.4.71 $n：舊頁面沒有新欄位時初始化不中斷
    $n('quickFill').addEventListener('change', applyQuickFill); // 0.4.82 新增時從已結案的舊客戶帶入基本資料
    $('pArea').addEventListener('change', refreshSave);
    $('pCrop').addEventListener('change', () => fillVarieties('')); // 換作物就重選品種
    $('pVarCo').addEventListener('change', () => { fillVarieties(''); refreshSave(); }); // 0.4.31 換種子公司就重選品種
    $('plantFail').addEventListener('change', refreshPlantFail); // 0.4.33 一般拜訪勾「種植失敗」
    $('note').addEventListener('input', refreshSave);
    $n('dcSigned').addEventListener('change', () => { refreshDealerSign(); refreshSave(); }); // 0.4.75 勾已簽約 → 打開結案框
    $n('vStage').addEventListener('change', () => {
      state.stageManual = true;
      $n('stageWhyBox').hidden = !!$n('vStage').value;
      refreshSave();
      const sw = stageWarnNow();
      if (sw) toast('⚠ ' + stageWarnText(sw.stage, sw.w), 5000);
    }); // 第26任：選得比種植天數還後面，當下就跳提醒 // 0.4.78 業務自己選了生長階段，之後不再自動建議蓋掉；0.5.26 不選就要寫原因
    $n('vStageWhy').addEventListener('input', refreshSave); // 0.5.26
    ['input', 'change'].forEach(ev => $n('pPlantDate').addEventListener(ev, () => { refreshStage(); refreshSave(); })); // 0.5.26 小助手2 審查低2：新農民填了種植日期，階段建議跟著更新
    ['dcOutcome', 'dcNote'].forEach(id => { $n(id).addEventListener('input', refreshSave); $n(id).addEventListener('change', refreshSave); }); // 0.4.42；低#7（第8任）改 $n：舊頁面沒有這兩格時初始化不中斷
    ['cRegion', 'cPrice', 'cYield', 'cBuyer', 'cPhone'].forEach(id => { $(id).addEventListener('input', refreshSave); $(id).addEventListener('change', refreshSave); });
    $('photoInput').addEventListener('change', e => addPhotos(e.target.files, '相機', $('photoBtn')).finally(() => { e.target.value = ''; }));
    if (typeof bindCmp === 'function') bindCmp(); // 第27任 對照農民三組相機
    const again = document.getElementById('againBtn'); if (again) again.addEventListener('click', () => $('photoInput').click()); // 第24任 第六批⑮：再拍一張
    $('albumInput').addEventListener('change', e => addPhotos(e.target.files, '相簿', $('albumBtn')).finally(() => { e.target.value = ''; }));
    $('recBtn').addEventListener('click', toggleRec);
    $('saveBtn').addEventListener('click', save);
  }
  /** 結案入口、種植資料、我的進度（切換種類、最上面一排數字） */
  function bindCloseAndPlant() {
    // 0.4.57 董事長：結案放在首頁「我的進度」→ 選農民／盤商／種子商結案，直接進結案畫面（不能切去一般拜訪）
    document.querySelectorAll('[data-closecat]').forEach(b => b.addEventListener('click', async () => {
      const cat = b.dataset.closecat;
      state.closeGroup = b.dataset.closegroup || ''; // 0.4.73 董事長：結案改「一般／試作／推廣農民結案」（盤商、種子商結案拿掉）
      state.closeNext = true;
      if (cat !== '結案') state.lockNext = true; // 盤商、種子商結案：另一種也鎖
      // 0.4.64（2號 0.4.63 清單中#1）：結案已經是獨立分頁，不再自動帶「我的進度」看過的農民，免得結錯人；進結案畫面再自己選
      await openVisit(cat);
      // 第24任 第六批⑫（tomtom 實測：沒有可結案的農民仍打開空表單；盤商、種子商卻是提示）：統一——沒有可結案的就回結案分頁、跳同樣的提示
      if (cat === '結案' && state.closeGroup && ![...$('farmer').options].some(o => o.value && o.value !== '__new' && !o.disabled)) {
        const g = state.closeGroup; // 回首頁會清掉 closeGroup，先記下
        resetForm(); await showHome(); if (typeof setHomeTab === 'function') setHomeTab('close');
        toast(`你沒有可結案的${g}／ပိတ်သိမ်းနိုင်သော ${(typeof MINE_TYPES === 'object' && MINE_TYPES[g]) || g} မရှိပါ`); return;
      }
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
      // 0.5.04「我負責的客戶」搬到執行任務：要跳的區塊在別的分頁就先切過去
      const pan = sec.closest ? sec.closest('.hpanel') : null; if (pan && pan.hidden && /^hp-/.test(pan.id)) setHomeTab(pan.id.slice(3));
      if (sec.scrollIntoView) sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }));
    // 打卡畫面最下面「取消結案」：跟左上返回一樣，回首頁（還沒存的要先確認）
    $n('closeModeBtn').addEventListener('click', () => $('backBtn').click());
  }
  /** 打卡畫面其他欄位：重新定位、作物、價格、試作開始／結束、結案試作結果、量測、有沒有見到 */
  function bindVisitDetails() {
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
    MEASURE_IDS.forEach(id => {
      const e = $n(id);
      const f = () => { if (id === 'mSow' || id === 'mHarvest') calcMeasureDays(); refreshSave(); };
      e.addEventListener('input', f);
      e.addEventListener('change', f);
    }); // 0.4.77 量測：日期改了重算天數
    $('meetYes').addEventListener('click', () => setNoMeet(false)); // 0.4.38
    $('meetNo').addEventListener('click', () => setNoMeet(true));
    ['nmReason', 'nmNote', 'nmNext'].forEach(id => { $(id).addEventListener('input', refreshSave); $(id).addEventListener('change', refreshSave); });
    document.querySelectorAll('#trialBox input, #trialBox select, #trialBox textarea').forEach(el => { el.addEventListener('input', refreshSave); el.addEventListener('change', refreshSave); });
  }
  /** 自動上傳的時機：有網路時、切回這個畫面時、每分鐘一次 */
  function bindAutoSync() {
    // 自動上傳的時機：有網路時、切回這個畫面時、每分鐘一次
    window.addEventListener('online', syncNow);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
    setInterval(syncNow, 60 * 1000, { auto: true }); // 第25任 審查第三批：第三個參數會傳給 syncNow，標「自動」——有要上傳的照常傳；沒有的話抓最新資料至少隔 AUTO_PULL_MS
    window.addEventListener('offline', () => { $('syncState').textContent = '沒有網路，資料先存在手機裡／အင်တာနက် မရှိ၊ ဖုန်းထဲ သိမ်းထားသည်'; });
  }
  /** 開網頁：補記版本紀錄的帳號，已登入回首頁並上傳，沒登入顯示登入畫面 */
  async function startApp() {
    if (typeof tagOwner === 'function') await tagOwner(); // R24-1（抽函式跑的舊測試沒有它）：開網頁時先替 0.5.16 留下的版本紀錄補記帳號
    const cfg = await getConfig();
    if (cfg && cfg.deviceKey) {
      // 0525R2（第22任，GPT 0525R1-1 高）：登入時清別人的快取失敗（登入設定已經是新的人、快取還是上一位的）→ 重開網頁不能直接進首頁。
      //   開網頁先再清一次「看得出是別人的」快取；還是清不掉就停在登入頁說手機存資料失敗
      if (typeof Store !== 'undefined' && Store.clearForeignCache) { // 抽函式跑的舊測試（init 行為紀錄）沒有 Store
        // 0525R3（第22任，GPT 0525R2-1 中）：也帶這次讀到的金鑰 → 讀完設定後另一個分頁換人登入了（回 'stale'），不清新的人的快取、不進首頁
        let cr;
        try { cr = await Store.clearForeignCache(cfg.account, { onlyKnown: true, key: cfg.deviceKey }); } catch (e) {
          showLogin('手機存資料失敗（可能空間不足），請先清出空間再登入／ဖုန်းထဲ သိမ်းမရပါ၊ နေရာလွတ် လုပ်ပြီး ပြန်ဝင်ပါ'); return;
        }
        if (cr === 'stale') { showLogin('另一個畫面已經換人登入，請重新整理網頁／အခြား စာမျက်နှာတွင် ဝင်ထားပြီ၊ ပြန်ဖွင့်ပါ'); return; }
      }
      // 第24任 第四批：重開 App 有解鎖設定就先鎖（同步照常）
      // 第26任 老闆核准：解鎖啟動失敗原本照舊不鎖（等於不用解鎖就能看資料）→ 這支手機有設解鎖的話，改成直接要用帳號密碼重新登入；沒設過解鎖的照舊進首頁。看不出有沒有設也當有設（寧可多問一次密碼）
      const lockFail = typeof FarmLock === 'object' && await FarmLock.start(lockHooks()).then(() => false, e => { if (typeof noteErr === 'function') noteErr('解鎖啟動', e); return true; });
      if (lockFail) {
        let had = true; try { const c = FarmLock._t.load(); had = !!(c && (c.method === 'bio' || c.method === 'pattern')); } catch (x) { had = true; }
        if (had) { await lockHooks().lockout('解鎖功能出錯，請用帳號密碼重新登入（沒上傳的資料還在手機裡）'); return; }
      }
      await showHome(); syncNow();
    } else showLogin();
  }

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
  window.__farmTest = { state, exifInfo }; // 本機測試用
  init();
})();
