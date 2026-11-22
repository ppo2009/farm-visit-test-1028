/* 第24任 必改清單第四批（2026-11-17，老闆核准）：手機「人臉／指紋」＋「九宮格」解鎖，像銀行 App。
   設計（見 _test/第四批_解鎖說明.md）：
   - 解鎖只擋「畫面」：這支手機已登入的裝置金鑰照樣留在手機裡，背景上傳不受影響（鎖住時沒上傳的拜訪照常送出）。
   - 人臉／指紋：WebAuthn 通行密鑰（平台驗證器、userVerification＝required）。Apps Script 沒有內建的簽章驗證，所以在手機端驗證「這支手機的驗證器有通過本人驗證」，
     後台不驗簽章（安全性差別寫在說明檔）。
   - 九宮格：至少 4 點，只存 PBKDF2-SHA256（15 萬次、隨機 16 位元組鹽）雜湊，不存圖形本身；錯 5 次 → 這支手機要用密碼重新登入（未上傳的拜訪留著）。
   - 設定綁定這把裝置金鑰（存金鑰雜湊的前 24 字）：重新登入拿到新金鑰、主管重設（後台停用金鑰）後，舊設定自動作廢，要重新設。
   - 什麼時候鎖：重新打開網頁；或切到背景超過 N 分鐘（後台設定「解鎖逾時分鐘」，預設 10，手機從同步的首頁資料拿）。
   - 新文字只有中文，緬文欄位留空（data-tr="待譯"）等譯者。
   給 app.js 用：FarmLock.start(hooks)、FarmLock.afterLogin(hooks)、FarmLock.openSettings(hooks)。hooks：{ getConfig, getMinutes, lockout(msg), toast(msg) } */
/* global self, crypto, localStorage, navigator, document, TextEncoder */
(function (g) {
  'use strict';
  const KEY = 'farm-unlock', HID = 'farm-unlock-hidden';
  const MAX_FAILS = 5, MIN_POINTS = 4, ITER = 150000, DEFAULT_MIN = 10;
  const RELOGIN_MSG = '請用帳號密碼重新登入／အကောင့်နှင့် စကားဝှက်ဖြင့် ပြန်ဝင်ပါ'; // 用密碼重新登入（「用密碼重新登入」那顆、登入已失效共用）

  /* ───── 純計算與儲存（測試直接呼叫） ───── */
  const b64u = buf => { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64u = s => {
    const t = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));
    const u = new Uint8Array(t.length);
    for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
    return u;
  };
  const rand = n => { const u = new Uint8Array(n); crypto.getRandomValues(u); return u; };
  const hex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  function load() { try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c && typeof c === 'object' ? c : null; } catch (e) { return null; } }
  function save(c) { try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); return true; } catch (e) { return false; } }
  /** 裝置金鑰的標記（SHA-256 前 24 字）：設定綁這個，不存金鑰本身 */
  async function keyTag(deviceKey) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('farm-unlock|' + String(deviceKey || '')))).slice(0, 24); }
  /** 現在這把金鑰有沒有有效的解鎖設定（有＝要鎖）；金鑰換了就作廢 */
  async function activeFor(cfg) {
    const c = load();
    if (!c || !cfg || !cfg.deviceKey || (c.method !== 'bio' && c.method !== 'pattern')) return null;
    return c.dk === await keyTag(cfg.deviceKey) ? c : null;
  }
  /** 九宮格圖形 → 雜湊。seq：點的編號 0～8 陣列；salt：base64url */
  async function patternHash(seq, salt, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode('p|' + seq.join('-')), 'PBKDF2', false, ['deriveBits']);
    return b64u(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64u(salt), iterations: iter || ITER }, base, 256));
  }
  const validPattern = seq => Array.isArray(seq) && seq.length >= MIN_POINTS && seq.length <= 9 && new Set(seq).size === seq.length && seq.every(n => Number.isInteger(n) && n >= 0 && n <= 8);
  async function setPattern(cfg, seq) {
    if (!validPattern(seq)) throw new Error('九宮格至少要連 4 個點，同一點不能重複／ပုံစံကွက် အနည်းဆုံး အစက် ၄ စက် ဆက်ရမည်၊ တစ်စက်တည်း ထပ်မဆက်ရ');
    const salt = b64u(rand(16));
    const c = { method: 'pattern', dk: await keyTag(cfg.deviceKey), salt, iter: ITER, hash: await patternHash(seq, salt, ITER), fails: 0, at: Date.now() };
    if (!save(c)) throw new Error('手機存不進去（可能空間不足或封鎖了網站資料）／ဖုန်းထဲ သိမ်းမရပါ（နေရာ မလောက်ခြင်း သို့မဟုတ် ဝဘ်ဆိုက် ဒေတာ ပိတ်ထားခြင်း ဖြစ်နိုင်）');
    return c;
  }
  /** 驗證九宮格：回 { ok, fails, locked（錯滿 5 次）} */
  async function checkPattern(cfg, seq) {
    const c = await activeFor(cfg);
    if (!c || c.method !== 'pattern') return { ok: false, fails: 0, locked: false, none: true };
    const ok = validPattern(seq) && (await patternHash(seq, c.salt, c.iter || ITER)) === c.hash;
    c.fails = ok ? 0 : (Number(c.fails) || 0) + 1;
    const locked = !ok && c.fails >= MAX_FAILS;
    save(locked ? null : c); // 錯滿就整個作廢（要重新用密碼登入、重新設）
    return { ok, fails: c.fails, locked };
  }
  /* ───── 人臉／指紋（WebAuthn） ───── */
  async function bioAvailable() {
    try { return !!(g.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; }
  }
  async function setBio(cfg) {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: rand(32), rp: { name: '田間打卡', id: g.location && g.location.hostname },
      user: { id: rand(16), name: String(cfg.account || 'user'), displayName: String(cfg.name || cfg.account || '業務') },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000, attestation: 'none' } });
    if (!cred || !cred.rawId) throw new Error('沒有建立成功／သတ်မှတ်မှု မအောင်မြင်ပါ');
    const c = { method: 'bio', dk: await keyTag(cfg.deviceKey), cred: b64u(cred.rawId), fails: 0, at: Date.now() };
    if (!save(c)) throw new Error('手機存不進去（可能空間不足或封鎖了網站資料）／ဖုန်းထဲ သိမ်းမရပါ（နေရာ မလောက်ခြင်း သို့မဟုတ် ဝဘ်ဆိုက် ဒေတာ ပိတ်ထားခြင်း ဖြစ်နိုင်）');
    return c;
  }
  /** 驗證人臉／指紋：通過回 true；取消、失敗回 false（不算錯誤次數） */
  async function checkBio(cfg) {
    const c = await activeFor(cfg);
    if (!c || c.method !== 'bio') return false;
    try {
      const a = await navigator.credentials.get({ publicKey: { challenge: rand(32), allowCredentials: [{ type: 'public-key', id: unb64u(c.cred), transports: ['internal'] }], userVerification: 'required', timeout: 60000, rpId: g.location && g.location.hostname } });
      return !!(a && a.rawId && b64u(a.rawId) === c.cred);
    } catch (e) { return false; }
  }
  /** 切到背景超過幾分鐘要鎖（minutes：後台設定，壞值用 10） */
  const needLockAfterHidden = (hiddenAt, now, minutes) => { const m = Number(minutes) > 0 ? Number(minutes) : DEFAULT_MIN; return Number(hiddenAt) > 0 && now - Number(hiddenAt) >= m * 60000; };

  /* ───── 畫面 ───── */
  let H = null, locked = false;
  const el = id => document.getElementById(id);
  function ensureDom() {
    if (el('lockScreen')) return;
    const d = document.createElement('div');
    d.innerHTML = `<div id="lockScreen" class="lockscreen" hidden role="dialog" aria-modal="true" aria-labelledby="lockTitle">
      <div class="lockcard"><h2 id="lockTitle">🔒 已上鎖<span class="my">သော့ခတ်ထားသည်</span></h2><p class="sub" id="lockWho"></p>
        <button type="button" class="btn primary" id="lockBio" hidden>用人臉／指紋解鎖<span class="my">မျက်နှာ／လက်ဗွေဖြင့် ဖွင့်ရန်</span></button>
        <div id="lockPat" hidden><p class="sub">畫九宮格解鎖<span class="my">ပုံစံကွက် ဆွဲပြီး ဖွင့်ရန်</span></p><div class="patgrid" id="lockGrid"></div></div>
        <p class="sub err" id="lockMsg" aria-live="polite"></p>
        <p class="sub">背景上傳照常進行，沒上傳的資料不會不見。<span class="my">နောက်ကွယ်မှ ပုံမှန် တင်ပေးနေသည်၊ မတင်ရသေးသော ဒေတာ မပျောက်ပါ။</span></p>
        <button type="button" class="link" id="lockPw">忘記了，用密碼重新登入<span class="my">မေ့သွားပြီ၊ စကားဝှက်ဖြင့် ပြန်ဝင်မည်</span></button></div></div>
      <div id="unlockSet" class="lockscreen" hidden role="dialog" aria-modal="true" aria-labelledby="unlockSetTitle">
      <div class="lockcard"><h2 id="unlockSetTitle">解鎖方式<span class="my">သော့ဖွင့်နည်း</span></h2>
        <p class="sub" id="unlockSetIntro">以後打開 App、或離開一段時間再回來，用人臉／指紋或九宮格解鎖，不用再打密碼。<span class="my">နောက်ပိုင်း App ဖွင့်လျှင် သို့မဟုတ် ခဏထွက်ပြီး ပြန်ဝင်လျှင် မျက်နှာ／လက်ဗွေ သို့မဟုတ် ပုံစံကွက်ဖြင့် ဖွင့်နိုင်သည်၊ စကားဝှက် ထပ်ရိုက်ရန် မလိုပါ။</span></p>
        <button type="button" class="btn primary" id="setBio" hidden>啟用人臉／指紋解鎖<span class="my">မျက်နှာ／လက်ဗွေ သော့ဖွင့် ဖွင့်ရန်</span></button>
        <button type="button" class="btn" id="setPat">設定九宮格<span class="my">ပုံစံကွက် သတ်မှတ်ရန်</span></button>
        <div id="setPatBox" hidden><p class="sub" id="setPatHint"></p><div class="patgrid" id="setGrid"></div></div>
        <p class="sub" id="unlockSetMsg" aria-live="polite"></p>
        <button type="button" class="btn" id="setOff" hidden>關閉解鎖（不上鎖）<span class="my">သော့ခတ်ခြင်း ပိတ်ရန်（သော့မခတ်ပါ）</span></button>
        <button type="button" class="link" id="setLater">先不用<span class="my">မသုံးသေးပါ</span></button></div></div>`;
    while (d.firstChild) document.body.appendChild(d.firstChild);
  }
  /** 畫一個 3×3 的九宮格：手指滑過或一顆一顆點都可以；放開（或點滿後按完成）呼叫 done(seq) */
  function grid(box, done) {
    box.innerHTML = Array.from({ length: 9 }, (_, i) => `<button type="button" class="patdot" data-i="${i}" aria-label="第 ${i + 1} 點"></button>`).join('') + '<button type="button" class="btn patok" data-ok>完成</button>';
    // 兩種畫法：手指一筆滑過（這一筆連到 2 點以上，放開就送出）；一顆一顆點（每點一下算一點，點完按「完成」）。
    // 點的時候只認 pointerdown，click 只給鍵盤用（detail＝0），不然點一下會記兩次、送出後還留一點在下一次（第四批瀏覽器實測前抓到）
    let seq = [], drawing = false, stroke = 0;
    const paint = () => box.querySelectorAll('.patdot').forEach(b => b.classList.toggle('on', seq.indexOf(Number(b.dataset.i)) >= 0));
    const add = i => { if (seq.indexOf(i) < 0) { seq.push(i); stroke++; paint(); } };
    const finish = () => { if (!seq.length) return; const s = seq; seq = []; drawing = false; stroke = 0; paint(); done(s); };
    box.querySelectorAll('.patdot').forEach(b => {
      b.addEventListener('pointerdown', e => {
        drawing = true;
        stroke = 0;
        add(Number(b.dataset.i));
        if (b.releasePointerCapture && e.pointerId != null) try { b.releasePointerCapture(e.pointerId); } catch (x) { /* 沒抓住也沒關係 */ }
      });
      b.addEventListener('pointerenter', () => { if (drawing) add(Number(b.dataset.i)); });
      b.addEventListener('click', e => { if (e.detail === 0) add(Number(b.dataset.i)); }); // 鍵盤（Enter／空白鍵）
    });
    // 第26任：滑了 2 點以上卻不到 4 點就放開＝畫失敗的一筆 → 清掉重來（原本點留在格子上，下一次畫變成「殘點＋新圖形」被判錯、錯誤次數 +1）。一顆一顆點（每筆 1 點）不受影響
    const up = () => { if (drawing && stroke >= 2 && seq.length >= MIN_POINTS) finish(); else { if (drawing && stroke >= 2) { seq = []; paint(); } drawing = false; } };
    // 第25任 審查②：box 每次上鎖都是同一個元素，原本每畫一次就多掛一組 pointerup → 只綁一次，換成呼叫這一次的處理函式
    // 第26任：放開、取消改掛在整頁 document——按下時已放掉指標鎖定，手指在九宮格外面放開，九宮格收不到放開（畫面沒反應、再畫一次也一樣）
    box._up = up; box._cancel = () => { drawing = false; };
    if (!box._bound) { box._bound = true; document.addEventListener('pointerup', () => box._up()); document.addEventListener('pointercancel', () => box._cancel()); }
    box.querySelector('[data-ok]').addEventListener('click', finish);
    return { reset() { seq = []; drawing = false; paint(); } };
  }
  async function showLock(c) {
    ensureDom(); locked = true;
    // 抓BUG第18輪 手機1（第28任）：照片大圖（#bigPhoto，層級比解鎖畫面高）開著時上鎖 → 沒解鎖也看得到、存得到照片。上鎖先把大圖關掉
    const big = document.getElementById('bigPhoto'); if (big) big.hidden = true;
    // 抓BUG第19輪 手機1、2（第29任）：「解鎖方式」設定框和鎖畫面同一層、比它晚放所以蓋在上面 → 撿到手機的人在設定框改設新圖形就能解開；
    // 「提供建議」框層級也比鎖畫面高，開著上鎖時沒解鎖也看得到草稿、還能用業務的名義送出。上鎖一律先關掉這兩個。
    // 建議框只是收起來（草稿留著）；它開著時才停語音，跟 app.js 關建議框的做法一樣（打卡畫面的語音不受影響）
    if (el('unlockSet')) el('unlockSet').hidden = true;
    const fb = document.getElementById('feedbackBox');
    if (fb && !fb.hidden) {
      fb.hidden = true;
      if (typeof FarmVoice === 'object' && FarmVoice.active()) FarmVoice.stop(true);
    }
    // 抓BUG第21輪 手機1、3（第29任）：讀設定失敗時 app.js 改成回登入頁，但原本整頁已經先設成不能操作、「鎖住」也沒清 →
    //   登入頁點不動、之後不再上鎖。改成先讀設定（失敗就清掉鎖住再往外丟），讀完、鎖畫面要出現時才擋後面
    let cfg;
    try { cfg = (await H.getConfig()) || {}; } catch (e) { locked = false; throw e; }
    blockBehind();
    el('lockWho').textContent = (cfg.name || cfg.account || '') + (c.method === 'pattern' && c.fails ? `（已錯 ${c.fails} 次，錯 ${MAX_FAILS} 次要用密碼重新登入）／（${c.fails} ကြိမ် မှားပြီး၊ ${MAX_FAILS}`
      + ` ကြိမ် မှားလျှင် စကားဝှက်ဖြင့် ပြန်ဝင်ရမည်）` : '');
    el('lockMsg').textContent = '';
    el('lockBio').hidden = c.method !== 'bio'; el('lockPat').hidden = c.method !== 'pattern';
    el('lockScreen').hidden = false;
    let checking = false; // 第25任 審查②：驗證要跑十幾萬次雜湊（慢手機近 1 秒），途中再畫一次會兩次同時讀到同一個錯誤次數、各自 +1 寫回 → 少算一次
    if (c.method === 'pattern') grid(el('lockGrid'), async seq => {
      if (checking) return; checking = true;
      let r; try { r = await checkPattern(await H.getConfig(), seq); } finally { checking = false; }
      if (!locked) return; // 驗證途中已經用別的方式解開或登出了
      if (r.ok) return unlock();
      // 第26任 抓BUG第2輪 手機組1：鎖畫面開著時登入失效（主管重設密碼、背景同步收到 BAD_LOGIN，金鑰被清掉）→ 找不到這把金鑰的解鎖設定（none）。
      //   原本當成「圖形不對」，畫對也一直說不對、次數不減、出不去 → 改成直接帶去用密碼重新登入（同「用密碼重新登入」那顆）
      if (r.none) return lockout(RELOGIN_MSG);
      if (r.locked) return lockout('九宮格錯了 ' + MAX_FAILS + ' 次，請用密碼重新登入（沒上傳的資料還在手機裡）／ပုံစံကွက် မှားနေသည် ' + MAX_FAILS + ' ကြိမ် မှားပြီ၊ စကားဝှက်ဖြင့် ပြန်ဝင်ပါ（မတင်ရသေးသော ဒေတာ ဖုန်းထဲတွင် ရှိနေသည်）');
      el('lockWho').textContent = (cfg.name || cfg.account || '') + `（已錯 ${r.fails} 次，錯 ${MAX_FAILS} 次要用密碼重新登入）／（${r.fails} ကြိမ် မှားပြီး၊ ${MAX_FAILS} ကြိမ် မှားလျှင် စကားဝှက်ဖြင့် ပြန်ဝင်ရမည်）`; // 第26任 低風險修正3④：上面的「已錯 N 次」原本只在上鎖時寫一次，跟下面「還可以試」對不起來
      el('lockMsg').textContent = `圖形不對，還可以試 ${MAX_FAILS - r.fails} 次／ပုံစံ မမှန်ပါ၊ နောက်ထပ် ${MAX_FAILS - r.fails} ကြိမ် စမ်းနိုင်သည်`;
    });
    if (c.method === 'bio') { el('lockBio').onclick = tryBio; tryBio(); }
    el('lockPw').onclick = () => { if (confirm('要改用帳號密碼重新登入嗎？\n這支手機的解鎖設定會清掉，登入後可以重新設定。沒上傳的資料留在手機裡，登入後會再送出。\nအကောင့်နှင့် စကားဝှက်ဖြင့် ပြန်ဝင်မလား။ ဤဖုန်း၏ သော့ဖွင့် ဆက်တင် ရှင်းသွားမည်၊ ဝင်ပြီးမှ ပြန်သတ်မှတ်နိုင်သည်။ မတင်ရသေးသော ဒေတာ ကျန်နေပြီး ဝင်ပြီးလျှင် ပြန်ပို့ပေးမည်။')) lockout(RELOGIN_MSG); };
  }
  async function tryBio() {
    el('lockMsg').textContent = '';
    const cfg = await H.getConfig();
    if (!(await activeFor(cfg))) return lockout(RELOGIN_MSG); // 第26任 抓BUG第2輪 手機組1：登入已失效（找不到這把金鑰的設定）→ 直接用密碼重新登入，不說「認不出來」
    if (await checkBio(cfg)) return unlock();
    el('lockMsg').textContent = '沒有解鎖（取消了或認不出來），請再按一次；不行就用密碼重新登入／သော့မဖွင့်နိုင်ပါ（ပယ်ဖျက်ခြင်း သို့မဟုတ် မမှတ်မိခြင်း）၊ ထပ်နှိပ်ပါ၊ မရလျှင် စကားဝှက်ဖြင့် ပြန်ဝင်ပါ';
  }
  /* 抓BUG第20輪 手機1（第29任）：鎖畫面只是蓋上去的一層，後面的按鈕、輸入框照樣拿得到鍵盤焦點 →
     藍牙鍵盤按 Tab 走得到「提供建議」、按 Enter 又把建議框開在鎖畫面上；上鎖前正在打字的搜尋框，上鎖後打字照樣寫進去。
     上鎖時把鎖畫面以外的整頁設成不能操作（inert）、焦點拿掉；解鎖時只還原我們設的那些（本來就 inert 的不動） */
  let inertSet = [];
  function blockBehind() {
    const lock = el('lockScreen');
    const kids = document.body && document.body.children;
    if (!kids || typeof kids.length !== 'number') return; // 舊測試的假畫面沒有這些：不做（真瀏覽器一定有）
    Array.prototype.slice.call(kids).forEach(node => {
      if (node === lock || node.inert) return;
      node.inert = true;
      inertSet.push(node);
    });
    const focused = document.activeElement;
    if (focused && focused !== document.body && typeof focused.blur === 'function' && !(lock && lock.contains && lock.contains(focused))) focused.blur();
  }
  function unblockBehind() {
    inertSet.forEach(node => { node.inert = false; });
    inertSet = [];
  }
  function unlock() { locked = false; unblockBehind(); if (el('lockScreen')) el('lockScreen').hidden = true; try { localStorage.removeItem(HID); } catch (e) { /* 記不了沒關係 */ } }
  async function lockout(msg) { save(null); unlock(); await H.lockout(msg); }
  const enabled = async () => { try { return !H.getEnabled || (await H.getEnabled()) !== false; } catch (e) { return true; } }; // 第24任 第六批：設定分頁「解鎖功能」總開關
  async function maybeLock(force) {
    if (!(await enabled())) { unlock(); return false; }
    const cfg = await H.getConfig();
    const c = await activeFor(cfg);
    if (!c) { unlock(); return false; }
    if (!force) {
      let hid = 0; try { hid = Number(localStorage.getItem(HID)) || 0; } catch (e) { hid = 0; }
      if (!needLockAfterHidden(hid, Date.now(), await H.getMinutes())) return false;
    }
    if (!locked) await showLock(c);
    return true;
  }
  /** 解鎖方式設定（登入後問一次；首頁「解鎖方式」也打開這個） */
  async function openSettings(intro) {
    ensureDom();
    if (locked) return; // 鎖住時不准打開設定框（不然不用原本的圖形就能改設新圖形，抓BUG第19輪 手機1）
    const cfg = await H.getConfig(); if (!cfg || !cfg.deviceKey) return;
    if (!(await enabled())) { H.toast('主管已關閉解鎖功能／မန်နေဂျာက သော့ဖွင့် လုပ်ဆောင်ချက်ကို ပိတ်ထားသည်'); return; }
    const cur = await activeFor(cfg), bio = await bioAvailable();
    el('unlockSetIntro').textContent = intro || (cur ? '目前用' + (cur.method === 'bio' ? '人臉／指紋' : '九宮格') + '解鎖。可以換成另一種，或關閉。／လက်ရှိ သုံးနေသည် ' + (cur.method === 'bio' ? 'မျက်နှာ／လက်ဗွေ' : 'ပုံစံကွက်')
      + ' သော့ဖွင့်။ အခြားနည်း ပြောင်းနိုင်သည် သို့မဟုတ် ပိတ်နိုင်သည်။' : '以後打開 App、或離開一段時間再回來，用人臉／指紋或九宮格解鎖，不用再打密碼。／နောက်ပိုင်း App ဖွင့်လျှင် သို့မဟုတ် ခဏထွက်ပြီး ပြန်ဝင်လျှင် မျက်နှာ／လက်ဗွေ သို့မဟုတ် ပုံစံကွက်ဖြင့် ဖွင့်နိုင်သည်၊ စကားဝှက် ထပ်ရိုက်ရန် မလိုပါ။');
    el('setBio').hidden = !bio; el('setOff').hidden = !cur; el('setPatBox').hidden = true; el('unlockSetMsg').textContent = '';
    if (locked) return; // 上面在等讀設定的途中剛好上鎖了，也不打開
    el('unlockSet').hidden = false;
    const close = () => { el('unlockSet').hidden = true; };
    el('setLater').onclick = close;
    el('setOff').onclick = () => { save(null); close(); H.toast('已關閉解鎖／သော့ဖွင့်ခြင်း ပိတ်ပြီးပါပြီ'); };
    el('setBio').onclick = async () => {
      el('unlockSetMsg').textContent = '請照手機的提示驗證人臉或指紋…／ဖုန်း ညွှန်ကြားချက်အတိုင်း မျက်နှာ သို့မဟုတ် လက်ဗွေ စစ်ဆေးပါ…';
      try {
        await setBio(await H.getConfig());
        close();
        H.toast('已啟用人臉／指紋解鎖／မျက်နှာ／လက်ဗွေ သော့ဖွင့် ဖွင့်ပြီးပါပြီ');
      } catch (e) {
        const no = e && e.name === 'NotAllowedError', msg = !no && e && e.message;
        el('unlockSetMsg').textContent = '沒有啟用成功（' + (no ? '取消了或手機不允許' : msg || '不明原因') + '），可以改用九宮格／ဖွင့်၍ မအောင်မြင်ပါ' + (no ? ' - ပယ်ဖျက်လိုက်ခြင်း သို့မဟုတ် ဖုန်းမှ ခွင့်မပြုခြင်း' : msg ? '' : ' - မသိသော အကြောင်းရင်း')
          + '၊ ပုံစံကွက် ပြောင်းသုံးနိုင်သည်';
      }
    };
    el('setPat').onclick = () => {
      el('setPatBox').hidden = false; let first = null;
      el('setPatHint').textContent = '畫一個圖形（至少連 4 個點）／ပုံစံတစ်ခု ဆွဲပါ（အနည်းဆုံး ၄ စက် ဆက်ပါ）';
      const gr = grid(el('setGrid'), async seq => {
        if (!validPattern(seq)) { el('setPatHint').textContent = '至少要連 4 個點，請重畫／အနည်းဆုံး ၄ စက် ဆက်ရမည်၊ ပြန်ဆွဲပါ'; return; }
        if (!first) { first = seq; el('setPatHint').textContent = '再畫一次確認／အတည်ပြုရန် နောက်တစ်ကြိမ် ထပ်ဆွဲပါ'; return; }
        if (first.join() !== seq.join()) { first = null; el('setPatHint').textContent = '兩次不一樣，請重新畫第一次／နှစ်ကြိမ် မတူပါ၊ ပထမအကြိမ်မှ ပြန်စဆွဲပါ'; gr.reset(); return; }
        try {
          await setPattern(await H.getConfig(), seq);
          close();
          H.toast('已設定九宮格解鎖／ပုံစံကွက် သော့ဖွင့် သတ်မှတ်ပြီးပါပြီ');
        } catch (e) { el('setPatHint').textContent = (e && e.message) || '設定失敗／သတ်မှတ်မှု မအောင်မြင်ပါ'; }
      });
    };
  }
  /* ───── 給 app.js 的入口 ───── */
  function hookPage() {
    if (hookPage.done) return; hookPage.done = true;
    const mark = () => { try { if (!locked) localStorage.setItem(HID, String(Date.now())); } catch (e) { /* 記不了沒關係 */ } };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') mark(); else maybeLock(false); });
    g.addEventListener && g.addEventListener('pagehide', mark);
  }
  /** 開網頁：已登入、有解鎖設定 → 一律先鎖（重開 App 要解鎖） */
  async function start(hooks) { H = hooks; hookPage(); return maybeLock(true); }
  /** 剛用密碼登入：舊設定（別的金鑰）作廢，問要不要啟用 */
  async function afterLogin(hooks) {
    H = hooks; hookPage();
    const cfg = await H.getConfig(); const c = load();
    if (c && !(await activeFor(cfg))) save(null);
    if (!(await activeFor(cfg)) && (await enabled())) await openSettings('要用人臉／指紋或九宮格解鎖這支手機嗎？以後打開 App 不用再打密碼。／ဤဖုန်းကို မျက်နှာ／လက်ဗွေ သို့မဟုတ် ပုံစံကွက်ဖြင့် ဖွင့်မလား။ နောက်ပိုင်း App ဖွင့်လျှင် စကားဝှက် ရိုက်ရန် မလိုတော့ပါ။');
  }
  /** 第24任 第六批：同步後重畫首頁時呼叫——總開關關了就解開鎖畫面、藏起「解鎖方式」入口 */
  async function refresh(hooks) { H = hooks || H; if (!H) return; const on = await enabled(); const b = el('unlockBtn'); if (b) b.hidden = !on || b.hidden; if (!on && locked) unlock(); }
  g.FarmLock = { start, afterLogin, refresh, openSettings: hooks => { H = hooks || H; return openSettings(); }, isLocked: () => locked,
    _t: { load, save, keyTag, activeFor, patternHash, validPattern, setPattern, checkPattern, needLockAfterHidden, b64u, unb64u, MAX_FAILS, MIN_POINTS, KEY, HID } };
})(typeof self !== 'undefined' ? self : this);
