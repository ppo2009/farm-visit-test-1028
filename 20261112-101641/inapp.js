/* 在 LINE、Facebook、Messenger、Viber 等 App 裡點開時，Google 登入會變白畫面，所以自動跳到 Chrome：
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

  if (isAndroid) {
    location.href = 'intent://' + hostPath + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(clean) + ';end';
  } else if (isIOS) {
    location.href = 'googlechromes://' + hostPath;
    setTimeout(() => {
      if (document.hidden) return; // 已經跳到 Chrome
      if (inLine && !new URL(location.href).searchParams.has('openExternalBrowser')) location.replace(clean + '?openExternalBrowser=1');
    }, 1500);
  }

  // 萬一沒跳走，留一個提示和「複製網址」按鈕
  const tip = document.createElement('div');
  tip.setAttribute('role', 'alert');
  tip.style.cssText = 'position:sticky;top:0;z-index:99;background:#b23a2b;color:#fff;padding:12px 14px;font-size:15px;line-height:1.5;border-radius:0 0 12px 12px';
  tip.innerHTML = '⚠ 請用 <b>Chrome</b> 打開這個網頁，在 LINE 等 App 裡面無法用 Google 登入。<br>按右下角「⋮」或「分享」→ 選「在 Chrome 開啟」或「以瀏覽器開啟」。' +
    '<br><button type="button" style="margin-top:8px;padding:6px 12px;border-radius:8px;border:0;font:inherit">複製網址</button>';
  tip.querySelector('button').onclick = function () {
    (navigator.clipboard ? navigator.clipboard.writeText(clean) : Promise.reject()).then(
      () => { this.textContent = '已複製，請貼到 Chrome'; },
      () => { this.textContent = clean; });
  };
  document.addEventListener('DOMContentLoaded', () => document.body.prepend(tip));
})();
