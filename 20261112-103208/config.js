/* 部署設定：Apps Script 發布成網頁應用程式後的網址，部署時由 部署打卡網頁.ps1 -GasUrl 寫進部署複本（也可以手動貼在這裡）（固定網址，之後更新程式用「管理部署 → 編輯 → 新版本」才不會變）
   第 2 期起改用帳號密碼登入，不再需要 Google 登入的 OAuth Client ID。 */
self.FARM_CONFIG = {
  gasUrl: 'https://script.google.com/macros/s/AKfycbwZ36Ob8Nxf8Ss618KqmlF9YWPgjW7WRrGvSIgu8T5ENQpD5oG0Jwgg5Y-R8PhrOLtjgA/exec', // 交付包一律留佔位字；部署時用 部署打卡網頁.ps1 -GasUrl 指定，只寫進部署複本（GPT-6.1 R5-06）
  appVersion: '0.4.32',
  // 備用網址（0.4.30）：緬甸網路常擋某些網站主機，同一份網頁放在不同公司的主機，業務頁、主管頁的「網址打不開時改用這個」都讀這份。
  // 後台、資料都一樣。正式交付時換成客戶自己的網址；不想顯示就留空 []
  mirrors: [
    { url: 'https://ppo2009.github.io/farm-visit-test-1028/', name: 'GitHub' },
    { url: 'https://farmvisit-mm1028.farmvisit-mm1028.workers.dev/', name: 'Cloudflare' },
    { url: 'https://farm-visit-test-1028.web.app/', name: 'Firebase' }
  ]
};
