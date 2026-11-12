/* 在 LINE、Facebook、Messenger、Viber 等 App 裡點開時（App 內建的小瀏覽器很多功能不穩：存不了離線資料、上傳照片、錄音常出問題），自動跳到 Chrome：
   - Android：用 intent 網址直接叫出 Chrome（沒裝 Chrome 就用預設瀏覽器）
   - iPhone：先試著叫出 Chrome，沒裝 Chrome 時，LINE 改用 Safari（openExternalBrowser=1），其他 App 顯示提示 */
(function () {
  const ua = navigator.userAgent || '';
  const inLine = /\bLine\//i.test(ua);
  const inApp = inLine || /FBAN|FBAV|FB_IAB|Messenger|Instagram|MicroMessenger|Zalo|Viber|Telegram|; wv\)/i.test(ua);
  if (!inApp) return;
  const isAndroid = /android/i.test(ua);
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const clean = location.origin + location.pathname;
  const hostPath = location.host + location.pathname;
  // 0.4.92 中1（第11任第四輪）：Android 沒裝 Chrome 時，intent 會照 fallback 網址回到同一個 App 內建瀏覽器 → 又跑一次這裡、又跳 intent → 無限重新載入。
  // fallback 網址加 ?inapp=1：看到這個記號就不再跳，只顯示下面的提示（iOS 的 openExternalBrowser 同樣只試一次）
  let tried = false;
  try { tried = new URL(location.href).searchParams.has('inapp'); } catch (e) { tried = /[?&]inapp=/.test(String(location.href || '')); }

  if (isAndroid && !tried) {
    location.href = 'intent://' + hostPath + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(clean + '?inapp=1') + ';end';
  } else if (isIOS) {
    location.href = 'googlechromes://' + hostPath;
    setTimeout(() => {
      if (document.hidden) return; // 已經跳到 Chrome
      if (inLine && !new URL(location.href).searchParams.has('openExternalBrowser')) location.replace(clean + '?openExternalBrowser=1');
    }, 1500);
  }

  // 萬一沒跳走，留一個提示和「複製網址」按鈕
  // 0.4.92 中2：第 2 期起改用帳號密碼登入，拿掉過時的「無法用 Google 登入」；中文＋緬文
  const tip = document.createElement('div');
  tip.setAttribute('role', 'alert');
  tip.style.cssText = 'position:sticky;top:0;z-index:99;background:#b23a2b;color:#fff;padding:12px 14px;font-size:15px;line-height:1.5;border-radius:0 0 12px 12px';
  tip.innerHTML = '⚠ 請用 <b>Chrome</b> 打開這個網頁：在 LINE 等 App 裡面打開，資料可能存不住、照片和錄音也可能傳不上去。<br>按右上角「⋮」或「分享」→ 選「在 Chrome 開啟」或「以瀏覽器開啟」。' +
    '<br><span lang="my">⚠ <b>Chrome</b> ဖြင့် ဖွင့်ပါ။ LINE စသည့် App ထဲတွင် ဖွင့်လျှင် မှတ်တမ်း မသိမ်းနိုင်၊ ဓာတ်ပုံ၊ အသံ မတင်နိုင် ဖြစ်နိုင်သည်။ 「⋮」 သို့မဟုတ် 「Share」 → 「Chrome ဖြင့်ဖွင့်ရန်」 ကို ရွေးပါ။</span>' +
    '<br><button type="button" style="margin-top:8px;padding:6px 12px;border-radius:8px;border:0;font:inherit">複製網址／လင့်ခ် ကူးယူရန်</button>';
  tip.querySelector('button').onclick = function () {
    (navigator.clipboard ? navigator.clipboard.writeText(clean) : Promise.reject()).then(
      () => { this.textContent = '已複製，請貼到 Chrome／ကူးယူပြီး၊ Chrome တွင် ကပ်ပါ'; },
      () => { this.textContent = clean; });
  };
  document.addEventListener('DOMContentLoaded', () => document.body.prepend(tip));
})();
