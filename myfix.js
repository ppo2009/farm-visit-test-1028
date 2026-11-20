/* 畫面緬文修正（第28任 2026-11-20，老闆「主管那邊要有個功能可以改緬甸錯字」）
   畫面上固定的緬文（按鈕、標題、提示）翻錯時，主管在主管頁「緬文對照」改好，手機和主管頁打開畫面就換成新的字。
   程式裡的緬文照舊不動（照譯稿回填的規則不變），只在「畫面上」換：
     修正表＝{ 原本的緬文: 改好的緬文 }，存在後台設定「緬文修正」。
     手機同步時跟著選單一起拿（core.js），另外記在手機本機，下次開 App、還沒登入的畫面也換得到；主管頁讀資料時拿。
   跟「試作改叫對照」同一種做法（MutationObserver 看畫面每次畫完），但多兩個保護：
     ① 打字欄（textarea、input）裡的內容不換：那是使用者自己打的
     ② 改好的字可能包含原本的字（例：原本「甲乙」改成「甲乙丙」），換過一次的節點記下「寫進去的值」，
        同一個值不再換第二次，不然會越換越長；也只有真的變了才寫回，避免叫醒觀察器無限循環（第27任踩過）
   掛 [data-nomyfix] 的區塊不換（主管頁「緬文對照」要顯示原本的字）。
   提供 window.FarmMyFix：set(修正表, 要不要記在本機)、fixStr(字串)、get()、scan(程式原文) */
(function () {
  'use strict';
  const STORE = 'farm-myfix';
  const ATTRS = ['placeholder', 'aria-label', 'title', 'data-label'];
  // 緬文字母區 U+1000～U+109F（用字元代碼組出來：編輯工具會把 \u 跳脫寫成真的緬文字，緬文守門會擋）
  const MY_LO = String.fromCharCode(0x1000), MY_HI = String.fromCharCode(0x109f);
  const MY_CLASS = '[' + MY_LO + '-' + MY_HI + ']';
  const isMyanmarCode = code => code >= 0x1000 && code <= 0x109f;
  let map = {};
  let pairs = []; // [原本, 改好]，長的先換（短的可能是長的一部分）
  // 換過的節點記下「原本的值、寫進去的值」：同一個值不再換第二次；修正表改了（含還原）時，先把畫面上換過的換回原本的字再重換
  const written = new WeakMap(); // 文字節點 → { orig, val }；元素 → { 屬性: { orig, val } }
  const touched = new Set();

  function hasMyanmar(s) {
    for (let i = 0; i < s.length; i++) if (isMyanmarCode(s.charCodeAt(i))) return true;
    return false;
  }
  /** 只收「原本的字有緬文、改好的字不空白、兩個不一樣」的 */
  function cleanMap(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.keys(raw).forEach(from => {
      const to = raw[from];
      if (typeof to !== 'string' || !to.trim() || to === from || !hasMyanmar(from)) return;
      out[from] = to;
    });
    return out;
  }
  function fixStr(s) {
    let text = String(s == null ? '' : s);
    if (!pairs.length || !hasMyanmar(text)) return text;
    pairs.forEach(([from, to]) => { if (text.indexOf(from) >= 0) text = text.split(from).join(to); });
    return text;
  }
  function skipped(node) {
    for (let p = node.parentNode; p; p = p.parentNode) {
      if (p.nodeType !== 1) continue;
      if (/^(TEXTAREA|SCRIPT|STYLE|INPUT)$/.test(p.tagName)) return true;
      if (p.hasAttribute && p.hasAttribute('data-nomyfix')) return true;
    }
    return false;
  }
  function fixText(node) {
    const cur = node.nodeValue, rec = written.get(node);
    if ((rec && rec.val === cur) || skipped(node)) return;
    const next = fixStr(cur);
    if (next === cur) return;
    node.nodeValue = next;
    written.set(node, { orig: cur, val: next });
    touched.add(node);
  }
  function fixAttrs(el) {
    if (!el.getAttribute || (el.closest && el.closest('[data-nomyfix]'))) return;
    const done = written.get(el) || {};
    ATTRS.forEach(name => {
      const cur = el.getAttribute(name);
      if (!cur || (done[name] && done[name].val === cur)) return;
      const next = fixStr(cur);
      if (next === cur) return;
      el.setAttribute(name, next);
      done[name] = { orig: cur, val: next };
      written.set(el, done);
      touched.add(el);
    });
  }
  function fixNode(root) {
    if (!pairs.length || !root || typeof document === 'undefined' || !document.createTreeWalker) return;
    if (root.nodeType === 3) { fixText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    const walker = document.createTreeWalker(root, 4);
    const texts = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (hasMyanmar(n.nodeValue)) texts.push(n);
    texts.forEach(fixText);
    const sel = ATTRS.map(a => '[' + a + ']').join(',');
    (root.nodeType === 1 ? [root] : []).concat(Array.from(root.querySelectorAll(sel))).forEach(fixAttrs);
    // 主管頁一直重畫：已經不在畫面上的節點不用再記（不然越記越多）
    if (touched.size > 2000) touched.forEach(n => { if (!n.isConnected) touched.delete(n); });
  }
  function fixPage() {
    if (typeof document === 'undefined' || !document.body) return;
    fixNode(document.body);
    if (document.title) document.title = fixStr(document.title);
  }
  /** 畫面上換過、而且之後沒被程式改掉的字，換回原本的（還原、改成別的字時用） */
  function undoAll() {
    touched.forEach(node => {
      const rec = written.get(node);
      written.delete(node);
      if (!rec || !node.isConnected) return;
      if (node.nodeType === 3) { if (node.nodeValue === rec.val) node.nodeValue = rec.orig; return; }
      Object.keys(rec).forEach(name => { if (node.getAttribute(name) === rec[name].val) node.setAttribute(name, rec[name].orig); });
    });
    touched.clear();
  }
  function set(raw, keep) {
    undoAll();
    map = cleanMap(raw);
    pairs = Object.keys(map).sort((a, b) => b.length - a.length).map(k => [k, map[k]]);
    if (keep) { try { localStorage.setItem(STORE, JSON.stringify(map)); } catch (e) { /* 本機存不了就只用這一次 */ } }
    fixPage();
  }
  /* 主管頁「緬文對照」用：從程式原文找出每一段緬文，配上它前面最近的中文（當作「這句在講什麼」）。
     例：'送出／（送出的緬文）' → { my: '（送出的緬文）', zh: '送出' } */
  const FRAG_RE = new RegExp(MY_CLASS + '(?:[' + MY_LO + '-' + MY_HI + String.fromCharCode(0x200b, 0x200c, 0x200d) + ' ]*' + MY_CLASS + ')?', 'g');
  const ZH_RE = new RegExp('[' + String.fromCharCode(0x3400) + '-' + String.fromCharCode(0x9fff) + '][^<>`\'"${}' + MY_LO + '-' + MY_HI + ']*', 'g');
  function zhBefore(line, at) {
    const before = (line.slice(0, at).match(ZH_RE) || []).pop();
    const any = before || (line.match(ZH_RE) || [])[0] || '';
    return any.replace(/[／/（(\s]+$/, '').trim().slice(-60);
  }
  function scan(source) {
    const found = [];
    String(source || '').split('\n').forEach(line => {
      if (!hasMyanmar(line)) return;
      let m;
      FRAG_RE.lastIndex = 0;
      while ((m = FRAG_RE.exec(line))) found.push({ my: m[0], zh: zhBefore(line, m.index) });
    });
    return found;
  }
  function start() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { saved = {}; }
    map = cleanMap(saved);
    pairs = Object.keys(map).sort((a, b) => b.length - a.length).map(k => [k, map[k]]);
    if (typeof document === 'undefined') return;
    const go = () => {
      fixPage();
      if (typeof MutationObserver !== 'function' || !document.body) return;
      new MutationObserver(list => list.forEach(m => {
        if (m.type === 'childList') m.addedNodes.forEach(fixNode);
        else fixNode(m.target);
      })).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
    // 確認、提示視窗不在畫面節點裡，要自己換
    ['alert', 'confirm', 'prompt'].forEach(name => {
      const native = window[name];
      if (typeof native !== 'function') return;
      window[name] = function (msg, ...rest) { return native.call(window, fixStr(msg), ...rest); };
    });
  }
  window.FarmMyFix = { set, fixStr, get: () => Object.assign({}, map), scan, hasMyanmar };
  start();
})();
