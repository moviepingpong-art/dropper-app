// schedule-app.js — 予定表ドロッパーの画面制御
// 1枚の予定表から取り出したN件の予定を一覧で確認・修正し、Googleカレンダーへまとめて登録する。
//
// OAuthの設定はイベントドロッパーと共有する（同じクライアントID・同じ生成元）。
// スコープは審査承認済みの3つのみ。ここに新しいスコープを足さないこと。
'use strict';

var GOOGLE_CLIENT_ID = '924835597048-lf0e4p3f73373ur5pnujac9bcl5cj820.apps.googleusercontent.com';
var SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/calendar.events'
].join(' ');
var CALENDAR_ID = 'primary';
var EVENT_COLOR_ID = '11';
// GoogleドライブOCRの言語（en/in版は英語、日本語版はja）。イベントドロッパーと同じ決め方。
var OCR_LANG = (window.LANG === 'en' || window.LANG === 'in') ? 'en' : 'ja';

var accessToken = null, tokenClient = null, pendingAuth = null;
var aiMode = false;
var aiChosen = false;   // この画面で一度「AIを使う」を押したか（送り先の説明を読んだ印）
var items = [];        // 画面に出している予定（一覧の1行＝1件）
var lastFile = null;   // 「AIで読み直す」で同じファイルをもう一度読むために覚えておく

var el = function (id) { return document.getElementById(id); };
var loginArea = el('login-area'), workArea = el('work'), dropEl = el('drop');
var msgEl = el('msg'), resultEl = el('result'), rowsEl = el('rows');
var summaryEl = el('summary'), countLabel = el('countLabel'), regBtn = el('reg'), regMsg = el('regMsg');

function setMsg(t) { msgEl.textContent = t || ''; }

/* ===== GA4 計測 =====
   言語は定数で書かず **実行時に window.LANG から読む**。
   このファイルは3フォルダでバイト同一を保つ決まりなので、ja/en/in を直書きすると同期が壊れる。
   tool はこのファイル固有の値なので定数でよい。
   gtag が無い場合（タグ未設置・広告ブロッカー）でも動作に影響を与えないこと。 */
function track(name, params) {
  if (typeof gtag !== 'function') return;
  try {
    gtag('event', name, Object.assign(
      { tool: 'schedule', lang: window.LANG || 'ja' }, params || {}));
  } catch (e) {}
}

/* ===== Googleログイン ===== */
function ensureTokenClient() {
  if (tokenClient) return true;
  if (!(window.google && google.accounts && google.accounts.oauth2)) return false;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES,
    callback: function (resp) {
      if (resp && resp.access_token) {
        accessToken = resp.access_token;
        if (pendingAuth) { pendingAuth.resolve(accessToken); pendingAuth = null; }
      } else if (pendingAuth) {
        pendingAuth.reject(new Error(I18N.t('msgLoginCancelled'))); pendingAuth = null;
      }
    }
  });
  return true;
}
function ensureToken() {
  return new Promise(function (resolve, reject) {
    if (accessToken) { resolve(accessToken); return; }
    if (!ensureTokenClient()) { reject(new Error(I18N.t('msgLoginPreparing'))); return; }
    pendingAuth = { resolve: resolve, reject: reject };
    tokenClient.requestAccessToken();
  });
}
el('loginBtn').addEventListener('click', async function () {
  setMsg(I18N.t('msgLoggingIn'));
  try {
    await ensureToken();
    loginArea.style.display = 'none';
    workArea.style.display = 'block';
    setMsg('');
  } catch (e) { setMsg(e.message || I18N.t('msgLoginFailed')); }
});

/* ===== 読み取り方の切り替え =====
   イベントドロッパーと同じ「AIを使うか使わないか」の2択。
   以前は「予定表の形（表かマス目か）」を利用者に選ばせていたが、
   マス目を通常モードで読むと0件にはならず「それらしい件数のまま日付と行事名の対応だけが
   狂った結果」が出るため、選び間違えた人は気づけなかった。
   いまは読んだあとに looksLikeGrid で見分けて警告する（判定は schedule-parser.js）。 */
function setMode(useAi) {
  aiMode = useAi;
  el('modeNormal').classList.toggle('on', !useAi);
  el('modeAi').classList.toggle('on', useAi);
  el('ocrNote').textContent = I18N.t(useAi ? 'modeAiNote' : 'modeNormalNote');
}

/* AIを使うかどうかのポップアップ。イベントドロッパーと同じ流れにそろえてある。
   キーは要らないが、「送ったファイルは OpenAI が AI の改良に使うことがある」を必ず先に見せたいので、
   AIモードへの入口はここ1つに統一する。 */
function openAiModal() { el('ai-modal').classList.add('show'); }
function closeAiModal() { el('ai-modal').classList.remove('show'); }
el('aiSkipBtn').addEventListener('click', function () { closeAiModal(); setMode(false); });
el('aiUseBtn').addEventListener('click', function () {
  aiChosen = true;
  closeAiModal();
  setMode(true);
});

el('modeNormal').addEventListener('click', function () { setMode(false); });
el('modeAi').addEventListener('click', function () { openAiModal(); });
setMode(false);   // 既定は通常モード。案内文もここで入る

// 通常モードで読んだが取りこぼした、というときの逃げ道。
// モードそのものをAIへ切り替える。切り替えずにAIで読むと、画面は「通常モード」を選択中と
// 表示したままAIが動くことになり、何が起きているのか分からなくなる。
el('retryAiBtn').addEventListener('click', async function () {
  if (!lastFile) { setMsg(I18N.t('msgDropFirst')); return; }
  // まだAIモードを選んだことが無い人には、先に説明のポップアップを見せる（送り先と学習の話を読まずに送らせない）。
  // 「AIを使う」を押せばAIモードになるので、もう一度このボタンを押せば読み直せる。
  if (!aiChosen) { openAiModal(); return; }
  setMode(true);
  await handleFile(lastFile);
});

/* ===== ドロップ ===== */
['dragenter', 'dragover'].forEach(function (ev) {
  dropEl.addEventListener(ev, function (e) { e.preventDefault(); dropEl.classList.add('over'); });
});
['dragleave', 'drop'].forEach(function (ev) {
  dropEl.addEventListener(ev, function (e) { e.preventDefault(); dropEl.classList.remove('over'); });
});
dropEl.addEventListener('drop', function (e) { handleFile(e.dataTransfer.files[0]); });
el('pickBtn').addEventListener('click', function () { el('file').click(); });
el('file').addEventListener('change', function (e) { handleFile(e.target.files[0]); });

function fiscalYearInput() {
  var v = (el('fy').value || '').trim();
  var n = Number(v);
  return (n >= 1900 && n <= 2999) ? n : null;
}

// 読み取れた文字を画面に出す。うまくいかない予定表の原因を、コンソールを開かずに確かめられる。
function showDiag() {
  var t = window.lastOcrText;
  var box = el('diag'), pre = el('diagText');
  if (!box || !pre) return;
  if (!t) { box.style.display = 'none'; return; }
  pre.textContent = t.slice(0, 3000) + (t.length > 3000 ? I18N.t('diagMore', { n: t.length }) : '');
  box.style.display = 'block';
}
if (el('diagCopy')) {
  el('diagCopy').addEventListener('click', function () {
    var t = window.lastOcrText || '';
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () {
      el('diagCopied').textContent = I18N.t('diagCopied', { n: t.length });
    });
  });
}

async function handleFile(file) {
  if (!file) return;
  var useAi = aiMode;
  // 読み取りを始める前に送る。drop はあるが extract_ok が無い＝途中で失敗した人の数になる。
  track('drop', { mode: useAi ? 'ai' : 'normal' });
  lastFile = file;
  resultEl.style.display = 'none';
  el('diag').style.display = 'none';
  el('retryAi').style.display = 'none';
  el('gridWarn').style.display = 'none';
  window.lastOcrText = '';
  try {
    await ensureToken();
  } catch (e) { setMsg(e.message); return; }

  try {
    var fy = fiscalYearInput();
    var noYear = false;
    if (useAi) {
      setMsg(I18N.t('msgAiReading'));
      items = await window.SchedAI.extract(file, { fiscalYear: fy, lang: window.LANG });
      // AIが年を返せなかった行に、年度から年を補う
      items.forEach(function (it) { it.outOfRange = false; });
    } else {
      setMsg(I18N.t('msgOcrReading'));
      var text = await ocrText(file);
      // 読み取れなかったときの調査用。ブラウザのコンソールで
      //   copy(window.lastOcrText)
      // とすると、OCRが実際に返した文字列を取り出せる。
      window.lastOcrText = text;
      // lang は必ず渡すこと。英語の日付・時刻はこれが無いと一切拾えない。
      var r = window.SchedParser.parse(text, { fiscalYear: fy || null, lang: window.LANG });
      items = r.items;
      if (!fy && r.yearKnown) el('fy').value = String(r.fiscalYear);
      noYear = (!r.yearKnown && !fy);
    }
    items.forEach(function (it) { it.on = !!it.start; });   // 日付が取れた行だけ最初から選択
    render();
    // 0件も送る。「読めなかった」がどのモード・どの言語で起きているかを知りたいため。
    track('extract_ok', { count: items.length, mode: useAi ? 'ai' : 'normal' });
    // OCRで読んだあとは、取りこぼしてもモードを切り替えずに済むよう逃げ道を出す
    el('retryAi').style.display = useAi ? 'none' : 'block';
    // マス目を通常モードで読んでしまった場合の警告。件数が出ていても対応が狂っているので、
    // 利用者が自力で気づくのは難しい。勝手にAIへ切り替えはせず、押すかどうかは委ねる。
    el('gridWarn').style.display = (!useAi && window.SchedParser.looksLikeGrid(window.lastOcrText || '')) ? 'block' : 'none';
    // 案内は render のあとに出す（先に出すと render 後の setMsg で消えてしまう）
    if (!items.length) {
      setMsg(I18N.t(useAi ? 'msgNoneAi' : 'msgNoneOcr'));
      showDiag();   // 実際に読み取れた文字を見せる（原因が分かるように）
    } else if (noYear) {
      setMsg(I18N.t('msgNoYear'));
    } else {
      setMsg('');
    }
  } catch (e) {
    var m = String(e && e.message || e);
    if (m === 'too-large') setMsg(I18N.t('errTooLarge'));
    else if (m === 'type') setMsg(I18N.t('errBadType'));
    else if (m === 'limit') setMsg(I18N.t('errLimit'));
    else if (m === 'quota') setMsg(I18N.t('errQuota'));
    else if (m === 'busy' || m === 'network') setMsg(I18N.t('errBusy'));
    else if (m === 'bad-json') setMsg(I18N.t('errBadJson'));
    else setMsg(I18N.t('errOther', { m: m }));
  }
}

/* ===== 通常モード：GoogleドライブのOCR ===== */
async function ocrText(file) {
  var boundary = '----sched' + Date.now();
  var metadata = { name: (file.name || 'yotei') + I18N.t('ocrTempSuffix'), mimeType: 'application/vnd.google-apps.document' };
  var head = '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) + '\r\n' +
    '--' + boundary + '\r\n' + 'Content-Type: ' + (file.type || 'application/octet-stream') + '\r\n\r\n';
  var body = new Blob([head, file, '\r\n--' + boundary + '--'], { type: 'multipart/related; boundary=' + boundary });
  var up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&ocrLanguage=' + OCR_LANG, {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + accessToken }, body: body
  });
  if (up.status === 401) { accessToken = null; throw new Error(I18N.t('msgSessionExpired')); }
  if (!up.ok) throw new Error(I18N.t('errDriveConvert', { code: up.status }));
  var id = (await up.json()).id;
  try {
    var ex = await fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text/plain', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    if (!ex.ok) throw new Error(I18N.t('errTextFetch', { code: ex.status }));
    return await ex.text();
  } finally {
    fetch('https://www.googleapis.com/drive/v3/files/' + id, {
      method: 'DELETE', headers: { 'Authorization': 'Bearer ' + accessToken }
    }).catch(function () {});
  }
}

/* ===== 一覧の描画 ===== */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function render() {
  rowsEl.innerHTML = '';
  items.forEach(function (it, idx) {
    var tr = document.createElement('tr');
    tr.className = (it.on ? '' : 'off') + (it.outOfRange || !it.start ? ' warn' : '');
    tr.innerHTML =
      '<td><input type="checkbox" data-k="on"' + (it.on ? ' checked' : '') + '></td>' +
      '<td class="col-date"><input type="text" data-k="start" value="' + esc(it.start) + '" placeholder="YYYY-MM-DD"></td>' +
      '<td class="col-date"><input type="text" data-k="end" value="' + esc(it.end) + '" placeholder="' + esc(I18N.t('endPlaceholder')) + '"></td>' +
      '<td class="col-time"><input type="text" data-k="time" value="' + esc(it.time) + '" placeholder="--:--"></td>' +
      '<td><input type="text" data-k="title" value="' + esc(it.title) + '"></td>' +
      '<td><input type="text" data-k="place" value="' + esc(it.place || '') + '"></td>' +
      '<td>' + (!it.start ? '<span class="flag">' + esc(I18N.t('flagNoDate')) + '</span>'
        : (it.outOfRange ? '<span class="flag">' + esc(I18N.t('flagOutOfRange')) + '</span>' : '')) + '</td>';
    tr.querySelectorAll('input').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var k = inp.getAttribute('data-k');
        items[idx][k] = (inp.type === 'checkbox') ? inp.checked : inp.value.trim();
        if (k === 'on') tr.classList.toggle('off', !inp.checked);
        updateCount();
      });
    });
    rowsEl.appendChild(tr);
  });
  var warn = items.filter(function (i) { return i.outOfRange || !i.start; }).length;
  summaryEl.textContent = I18N.t('summaryRead', { n: items.length })
    + (warn ? I18N.t('summaryWarn', { n: warn }) : '')
    + I18N.t('summaryTail');
  resultEl.style.display = items.length ? 'block' : 'none';
  updateCount();
}
function updateCount() {
  var n = items.filter(function (i) { return i.on; }).length;
  countLabel.textContent = I18N.t('countLabel', { n: n, total: items.length });
  regBtn.disabled = (n === 0);
}
function setAll(v) { items.forEach(function (i) { i.on = v; }); render(); }
el('selAll').addEventListener('click', function () { setAll(true); });
el('selNone').addEventListener('click', function () { setAll(false); });
el('selWarn').addEventListener('click', function () {
  items.forEach(function (i) { if (i.outOfRange || !i.start) i.on = false; });
  render();
});

/* ===== カレンダーへ一括登録 ===== */
function addDays(iso, n) {
  var p = iso.split('-'), d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function buildEvent(it) {
  var ev = { summary: it.title, colorId: EVENT_COLOR_ID };
  if (it.place) ev.location = it.place;
  if (it.time && !it.end) {
    // 時刻があるときは1時間の予定にする（終了時刻は予定表に書かれないことが多い）
    var sh = Number(it.time.slice(0, 2)), sm = it.time.slice(3);
    var eh = sh + 1, eDate = it.start;
    if (eh > 23) { eh -= 24; eDate = addDays(it.start, 1); }   // 23時台は終了が翌日になる
    ev.start = { dateTime: it.start + 'T' + it.time + ':00', timeZone: 'Asia/Tokyo' };
    ev.end = { dateTime: eDate + 'T' + ('0' + eh).slice(-2) + ':' + sm + ':00', timeZone: 'Asia/Tokyo' };
  } else {
    // 期間があるときは終日の連続予定にする。時刻より日数のほうが失うと痛いため、
    // 両方ある場合は期間を優先する（時刻は一覧に表示されたまま残る）。
    ev.start = { date: it.start };
    ev.end = { date: addDays(it.end || it.start, 1) };   // 終日予定の終了は翌日（排他的）
  }
  return ev;
}
regBtn.addEventListener('click', async function () {
  var targets = items.filter(function (i) { return i.on && /^\d{4}-\d{2}-\d{2}$/.test(i.start) && i.title; });
  if (!targets.length) { regMsg.textContent = I18N.t('msgNoTargets'); return; }
  regBtn.disabled = true;
  var ok = 0, ng = 0;
  for (var i = 0; i < targets.length; i++) {
    regMsg.textContent = I18N.t('msgRegistering', { i: i + 1, n: targets.length });
    try {
      var res = await fetch('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(CALENDAR_ID) + '/events', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildEvent(targets[i]))
      });
      // 期限切れの判定は合言葉で行う。文言そのもので判定すると多言語化で壊れる。
      if (res.status === 401) { accessToken = null; throw new Error('expired'); }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      ok++;
      targets[i].on = false;   // 二重登録を防ぐ
    } catch (e) {
      ng++;
      if (String(e && e.message) === 'expired') { regMsg.textContent = I18N.t('msgSessionExpiredReload'); break; }
    }
  }
  render();
  regMsg.textContent = I18N.t('msgRegistered', { n: ok }) + (ng ? I18N.t('msgRegisterFailed', { n: ng }) : '');
  track('calendar_add', { count: ok, failed: ng });
});


// 「何ができる？」ポップアップ（#tools-modal）。3本それぞれの入力と出力を図で見せる。
// タブ（.tool-tab）は今までどおり直行させ、説明はこのポップアップに分けてある。
// タブを押すたびに説明を挟むと、行き来する人に毎回1クリック増えるため。
/* ★ 初回の自動表示はやめた（2026-09-03、利用者の判断）。**戻さないこと。**
   何も押していないのに説明が出るのは、初めての人ほど戸惑う。
   知りたい人は「何ができる？」を押す。押さない人には要らなかった、というだけ。
   「見た印」（dropper_tools_seen）も一緒に消した——出し分ける必要がもう無い。 */

// 開くときは必ず「いま開いているドロッパー」のタブから見せる。
// どれが自分かは #tools-modal の data-home が持つ（3本でこのJSを同一に保つため）。
function openToolsModal_() {
  var m = document.getElementById('tools-modal');
  if (!m) return;
  selectToolsTab_(m.getAttribute('data-home') || 'event');
  m.classList.add('show');
}
function closeToolsModal_() {
  var m = document.getElementById('tools-modal');
  if (m) m.classList.remove('show');
}

// 中のタブを切り替える（ポップアップを閉じずに3本を見比べられるようにする）
function selectToolsTab_(name) {
  var m = document.getElementById('tools-modal');
  if (!m) return;
  var tabs = m.querySelectorAll('.tm-tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].setAttribute('aria-selected', tabs[i].getAttribute('data-tab') === name ? 'true' : 'false');
  }
  var panels = m.querySelectorAll('.tm-panel');
  for (var j = 0; j < panels.length; j++) {
    var on = (panels[j].getAttribute('data-panel') === name);
    if (on) { panels[j].classList.add('on'); } else { panels[j].classList.remove('on'); }
  }
}

(function wireToolsModal_() {
  var m = document.getElementById('tools-modal');
  if (!m) return;

  var btn = document.getElementById('whatBtn');
  if (btn) btn.addEventListener('click', function () { openToolsModal_(); });

  var tabs = m.querySelectorAll('.tm-tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function () { selectToolsTab_(this.getAttribute('data-tab')); });
  }
  // 背景をクリック、または「閉じる」で閉じる（「使ってみる」はそのまま移動する）
  m.addEventListener('click', function (e) {
    if (e.target === m || (e.target.hasAttribute && e.target.hasAttribute('data-tm-close'))) closeToolsModal_();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && m.classList.contains('show')) closeToolsModal_();
  });
})();
