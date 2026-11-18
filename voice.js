/* 第24任 必改清單第五批（2026-11-17，老闆核准）：手機主要文字欄旁的 🎤 語音輸入。
   - 用瀏覽器內建的語音辨識（SpeechRecognition／webkitSpeechRecognition）。瀏覽器不支援 → 整個不顯示。
   - 按一下開始、再按停止；辨識好的字接在原本文字後面（不蓋掉），觸發 input 事件讓存檔鈕跟著更新。
   - 語言預設緬甸語 my-MM，可切成中文 zh-TW，記住選擇（localStorage farm-voice-lang）。
   - 沒網路：按鈕反灰，按了提示「語音輸入需要網路，可以改用錄音」（多數手機的語音辨識要連雲端）。
   - 麥克風權限被拒：依 Android／iPhone、瀏覽器／主畫面 App 教怎麼打開。
   - 辨識中：按鈕變紅「■ 停止」＋下方「🔴 正在聽…」和聽到一半的字。
   - 跟錄音互斥：錄音中不能開語音（提示先結束錄音）；語音中按錄音，app.js 會擋並提示（FarmVoice.active()）。
   - 換客戶、清表單、離開畫面：app.js 呼叫 FarmVoice.stop(true) 丟掉還沒回來的結果，不會掉進下一筆。
   - 新文字只有中文，緬文欄位留空等譯者。
   給 app.js：FarmVoice.init({ toast, isRecording, fields })、FarmVoice.active()、FarmVoice.stop(discard) */
/* global self, document, navigator, localStorage */
(function (g) {
  'use strict';
  const LANG_KEY = 'farm-voice-lang', LANGS = ['my-MM', 'zh-TW'];
  const LANG_NAME = { 'my-MM': '緬甸語', 'zh-TW': '中文' };
  const LANG_MY = { 'my-MM': 'မြန်မာဘာသာ', 'zh-TW': 'တရုတ်' };
  const OFFLINE_MSG = '語音輸入需要網路，可以改用錄音／အသံဖြင့် စာရိုက်ရန် အင်တာနက် လိုသည်၊ အသံသွင်းခြင်းကို ပြောင်းသုံးနိုင်သည်';

  /* ───── 純計算（測試直接呼叫） ───── */
  const SRClass = () => g.SpeechRecognition || g.webkitSpeechRecognition || null;
  function getLang() { try { const v = localStorage.getItem(LANG_KEY); return LANGS.indexOf(v) >= 0 ? v : 'my-MM'; } catch (e) { return 'my-MM'; } }
  function setLang(v) { if (LANGS.indexOf(v) < 0) return getLang(); try { localStorage.setItem(LANG_KEY, v); } catch (e) { /* 記不了就只用這一次 */ } return v; }
  /** 把辨識結果接在原本文字後面：中間補一個空白（原本是空的、或結尾已經是空白／換行就不補）；超過欄位上限就截斷 */
  function appendText(old, add, max) {
    const a = String(add || '').trim(); if (!a) return String(old || '');
    const o = String(old || '');
    let s = o + (o && !/\s$/.test(o) ? ' ' : '') + a;
    if (max > 0 && s.length > max) s = s.slice(0, max);
    return s;
  }
  /** 麥克風被拒時教怎麼打開：看是 iPhone／Android、是不是從主畫面圖示打開 */
  function permHelp(ua, standalone) {
    const ios = typeof FarmCore === 'object' && FarmCore.isIOS ? FarmCore.isIOS(ua || '') : /iphone|ipad|ipod/i.test(ua || ''), android = /android/i.test(ua || ''); // 第25任 審查第二批：iPad 也認得（共用 FarmCore.isIOS）
    if (ios) return standalone
      ? '麥克風被關掉了：請到 iPhone「設定」→「Safari」→「麥克風」改成「允許」，再回來關掉 App 重開。／မိုက်ခရိုဖုန်း ပိတ်ထားသည် - iPhone 「Settings」 → 「Safari」 → 「Microphone」 ကို 「Allow」 ပြောင်းပြီး App ပိတ်၍ ပြန်ဖွင့်ပါ။'
      : '麥克風被關掉了：請按網址列左邊的「大小」(aA) →「網站設定」→「麥克風」改成「允許」，再重新整理。／မိုက်ခရိုဖုန်း ပိတ်ထားသည် - လိပ်စာဘား ဘယ်ဘက် 「aA」 → 「Website Settings」 → 「Microphone」 ကို 「Allow」 ပြောင်းပြီး ပြန်ဖွင့်ပါ။';
    if (android) return standalone
      ? '麥克風被關掉了：請長按主畫面上的「田間打卡」圖示 →「應用程式資訊」或「網站設定」→「麥克風」改成「允許」，再回來重開。／မိုက်ခရိုဖုန်း ပိတ်ထားသည် - ပင်မစာမျက်နှာပေါ်ရှိ 「လယ်ကွင်း မှတ်တမ်း」 အိုင်ကွန်ကို ဖိနှိပ် → 「App Info」 သို့မဟုတ် 「Site Settings」 → 「Microphone」 ကို 「Allow」 ပြောင်းပြီး ပြန်ဖွင့်ပါ။'
      : '麥克風被關掉了：請按網址列左邊的圖示（鎖頭或「⋮」裡的「設定」）→「權限」→「麥克風」改成「允許」，再重新整理。／မိုက်ခရိုဖုန်း ပိတ်ထားသည် - လိပ်စာဘား ဘယ်ဘက် အိုင်ကွန်（သော့ သို့မဟုတ် 「⋮」 ထဲရှိ Settings）→ 「Permissions」 → 「Microphone」 ကို 「Allow」 ပြောင်းပြီး ပြန်ဖွင့်ပါ။';
    return '麥克風被關掉了：請到瀏覽器的網站設定，把這個網站的「麥克風」改成「允許」，再重新整理。／မိုက်ခရိုဖုန်း ပိတ်ထားသည် - Browser ၏ ဝဘ်ဆိုက် ဆက်တင်တွင် ဤဝဘ်ဆိုက်၏ 「Microphone」 ကို 「Allow」 ပြောင်းပြီး ပြန်ဖွင့်ပါ။';
  }
  /** 辨識錯誤代碼 → 給業務看的話 */
  function errorText(code, ua, standalone) {
    if (code === 'not-allowed' || code === 'service-not-allowed') return permHelp(ua, standalone);
    if (code === 'network') return OFFLINE_MSG;
    if (code === 'no-speech') return '沒有聽到聲音，請靠近手機再按一次 🎤／အသံ မကြားရပါ၊ ဖုန်းနား ကပ်ပြီး 🎤 ထပ်နှိပ်ပါ';
    if (code === 'audio-capture') return '找不到麥克風，或麥克風正被別的程式使用／မိုက်ခရိုဖုန်း ရှာမတွေ့ပါ သို့မဟုတ် အခြား App က သုံးနေသည်';
    if (code === 'language-not-supported') return '這支手機不支援這個語言的語音辨識，請切換語言或改用錄音／ဤဖုန်းသည် ဤဘာသာစကား အသံဖတ်ခြင်း မပံ့ပိုးပါ၊ ဘာသာစကား ပြောင်းပါ သို့မဟုတ် အသံသွင်း သုံးပါ';
    return '語音輸入沒有成功，請再按一次，或改用錄音／အသံဖြင့် စာရိုက် မအောင်မြင်ပါ၊ ထပ်နှိပ်ပါ သို့မဟုတ် အသံသွင်း သုံးပါ';
  }

  /* ───── 畫面 ───── */
  let H = { toast() {}, isRecording: () => false }, cur = null; // cur：{ rec, field, btn, discard }
  const el = id => document.getElementById(id);
  const standalone = () => { try { return !!((g.matchMedia && g.matchMedia('(display-mode: standalone)').matches) || navigator.standalone); } catch (e) { return false; } };
  const online = () => navigator.onLine !== false;
  function paintAll() {
    document.querySelectorAll('.voicebtn').forEach(b => {
      const on = !!cur && cur.btn === b;
      b.classList.toggle('on', on); b.classList.toggle('off', !online() && !on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.querySelector('.vlabel').textContent = on ? '■ 停止／ရပ်' : '🎤 語音輸入／အသံဖြင့် စာရိုက်';
    });
    document.querySelectorAll('.voicelang').forEach(b => { b.textContent = '語言：' + LANG_NAME[getLang()] + '／ဘာသာစကား：' + LANG_MY[getLang()]; });
    document.querySelectorAll('.voicestat').forEach(s => { if (!cur || s.dataset.for !== cur.field.id) { s.hidden = true; s.textContent = ''; } });
  }
  function status(field, txt) { const s = document.querySelector('.voicestat[data-for="' + field.id + '"]'); if (s) { s.hidden = !txt; s.textContent = txt || ''; } }
  function stop(discard) {
    const c = cur; if (!c) return;
    c.discard = !!discard; cur = null;
    try { if (discard && c.rec.abort) c.rec.abort(); else c.rec.stop(); } catch (e) { /* 已經停了 */ }
    paintAll();
  }
  function start(field, btn) {
    const SR = SRClass(); if (!SR) return;
    if (!online()) { H.toast(OFFLINE_MSG); return; }
    if (H.isRecording()) { H.toast('正在錄音，請先按一下結束錄音，再用語音輸入／အသံသွင်းနေသည်၊ အသံသွင်းခြင်းကို အရင်ရပ်ပြီးမှ အသံဖြင့် စာရိုက် သုံးပါ'); return; }
    if (cur) stop(false);
    const rec = new SR();
    rec.lang = getLang(); rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    const c = { rec, field, btn, discard: false };
    rec.onresult = e => {
      if (c.discard) return;
      let fin = '', mid = '';
      for (let i = e.resultIndex || 0; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) fin += r[0].transcript; else mid += r[0].transcript; }
      if (fin) {
        const max = Number(field.getAttribute('maxlength')) || 0;
        field.value = appendText(field.value, fin, max);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (cur === c) status(field, '🔴 正在聽…／နားထောင်နေသည်…' + (mid ? '「' + mid + '」' : ''));
    };
    rec.onerror = e => { if (c.discard) return; const code = e && e.error; if (code !== 'aborted') H.toast(errorText(code, navigator.userAgent, standalone())); };
    rec.onend = () => { if (cur === c) { cur = null; paintAll(); } };
    cur = c;
    try { rec.start(); } catch (e) { cur = null; H.toast(errorText('', navigator.userAgent, standalone())); }
    paintAll(); if (cur === c) status(field, '🔴 正在聽…（' + LANG_NAME[rec.lang] + '）／နားထောင်နေသည်… - ' + LANG_MY[rec.lang]);
  }
  function attach(id) {
    const field = el(id); if (!field || field.dataset.voice) return;
    field.dataset.voice = '1';
    const bar = document.createElement('div'); bar.className = 'voicebar';
    bar.innerHTML = `<button type="button" class="voicebtn" aria-pressed="false"><span class="vlabel">🎤 語音輸入／အသံဖြင့် စာရိုက်</span></button>`
      + `<button type="button" class="voicelang link" aria-label="切換語音輸入的語言"></button>`
      + `<p class="voicestat sub" data-for="${id}" aria-live="polite" hidden></p>`;
    field.insertAdjacentElement('afterend', bar);
    const btn = bar.querySelector('.voicebtn');
    btn.addEventListener('click', () => { if (cur && cur.btn === btn) stop(false); else start(field, btn); });
    bar.querySelector('.voicelang').addEventListener('click', () => {
      setLang(getLang() === 'my-MM' ? 'zh-TW' : 'my-MM');
      if (cur) { const f = cur.field, b = cur.btn; stop(false); start(f, b); } // 聽到一半換語言：用新語言重來
      paintAll(); H.toast('語音輸入改用' + LANG_NAME[getLang()] + '／အသံဖြင့် စာရိုက် ပြောင်းသုံး ' + LANG_MY[getLang()]);
    });
  }
  function init(hooks) {
    if (!SRClass()) return false; // 不支援：不顯示任何按鈕
    H = Object.assign(H, hooks || {});
    (hooks && hooks.fields || []).forEach(attach);
    g.addEventListener && g.addEventListener('online', paintAll);
    g.addEventListener && g.addEventListener('offline', () => { if (cur) stop(false); paintAll(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && cur) stop(false); }); // 切走就停，麥克風不留著
    paintAll();
    return true;
  }
  g.FarmVoice = { init, active: () => !!cur, stop, supported: () => !!SRClass(),
    _t: { appendText, permHelp, errorText, getLang, setLang, LANG_KEY, OFFLINE_MSG } };
})(typeof self !== 'undefined' ? self : this);
