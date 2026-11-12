/* 部署設定：Apps Script 發布成網頁應用程式後，把網址貼在這裡（固定網址，之後更新程式用「管理部署 → 編輯 → 新版本」才不會變）
   第 2 期起改用帳號密碼登入，不再需要 Google 登入用戶端 ID。 */
self.FARM_CONFIG = {
  gasUrl: 'https://script.google.com/macros/s/AKfycbwZ36Ob8Nxf8Ss618KqmlF9YWPgjW7WRrGvSIgu8T5ENQpD5oG0Jwgg5Y-R8PhrOLtjgA/exec', // 測試網址 farm-visit-test-1028 的收件窗口（不是密碼）
  appVersion: '0.4.0'
};
