/* 部署設定：Apps Script 發布成網頁應用程式後的網址，部署時由 部署打卡網頁.ps1 -GasUrl 寫進部署複本（也可以手動貼在這裡）（固定網址，之後更新程式用「管理部署 → 編輯 → 新版本」才不會變）
   第 2 期起改用帳號密碼登入，不再需要 Google 登入的 OAuth Client ID。 */
self.FARM_CONFIG = {
  gasUrl: 'https://script.google.com/macros/s/AKfycbwZ36Ob8Nxf8Ss618KqmlF9YWPgjW7WRrGvSIgu8T5ENQpD5oG0Jwgg5Y-R8PhrOLtjgA/exec', // 交付包一律留佔位字；部署時用 部署打卡網頁.ps1 -GasUrl 指定，只寫進部署複本（GPT-6.1 R5-06）
  appVersion: '0.4.25'
};
