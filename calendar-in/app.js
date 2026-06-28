// app.js — ドロッパー（Web版・フェーズ1）GoogleドライブOCR版
'use strict';

/* ===== 設定（ここだけ書き換える） ===== */
var GOOGLE_CLIENT_ID = '924835597048-lf0e4p3f73373ur5pnujac9bcl5cj820.apps.googleusercontent.com';
// Drive（OCR用・アプリが作ったファイルのみ）＋ Calendar（予定作成）の最小権限
var SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events';
var CALENDAR_ID = 'primary';
var EVENT_COLOR_ID = '11';   // 赤
var OCR_LANG = (window.LANG === 'en' || window.LANG === 'in') ? 'en' : 'ja';   // GoogleドライブOCRの言語（en/in版は英語、日本語版はja）
var DROPPER_FOLDER_NAME = 'DropperFiles';   // 要項を保存するアプリ専用フォルダ（自動作成）

/* ===== 状態 ===== */
var accessToken = null;
var tokenClient = null;
var pendingAuth = null;
var dropperFolderId = null;   // DropperFilesフォルダのID（一度見つけ/作ったらキャッシュ）
var items = [];   // { file, card, fileId }

/* ===== DOM ===== */
var drop = document.getElementById('drop');
var fileInput = document.getElementById('file');
var list = document.getElementById('list');
var bar = document.getElementById('bar');
var msg = document.getElementById('msg');
var regBtn = document.getElementById('reg');
var loginBtn = document.getElementById('loginBtn');
var pickBtn = document.getElementById('pickBtn');
var loginArea = document.getElementById('login-area');
var workArea = document.getElementById('work');
var sportSel = document.getElementById('sport');
var typeSel = document.getElementById('dropperType');
var leadEl = document.getElementById('lead');
var sportRow = sportSel ? sportSel.closest('.sport-row') : null;

// ===== カレンダードロッパーの種類定義 =====
// 種類を増やすときはここに1件足すだけ。
//   subtitle        : サブタイトル（種類セレクタの表示文言）
//   lead            : 操作の流れ説明（ヘッダーのリード文）
//   useSportSelector: 競技セレクタを表示するか（スポーツ用途のみtrue）
// 将来：種類ごとの抽出設定（parserへ渡すモード等）をここに追加していく。
var DROPPER_TYPES = {
  sports: {
    subtitleKey: 'typeSports',
    leadKey: 'leadSports',
    useSportSelector: true
  }
  // 例：今後追加する種類（辞書に typeXxx/leadXxx を足してキーで参照）
  // school: { subtitleKey:'typeSchool', leadKey:'leadSchool', useSportSelector:false }
};
var DEFAULT_TYPE = 'sports';
var currentType = DEFAULT_TYPE;

// 多言語：HTMLのdata-i18n要素に現在の言語の文言を流し込む
if (window.I18N) { try { I18N.applyDom(); } catch (e) {} }

// 競技セレクタを生成（先頭に「自動判定」、続いて各競技。既定は卓球・バドミントン）
(function buildSportSelector() {
  if (!sportSel || !window.Dropper) return;
  var opts = '<option value="auto">' + I18N.t('sportAuto') + '</option>';
  window.Dropper.sports().forEach(function (s) {
    opts += '<option value="' + s.key + '">' + s.label + '</option>';
  });
  sportSel.innerHTML = opts;
  sportSel.value = window.Dropper.DEFAULT_SPORT || 'auto';
})();

// 種類セレクタを生成し、選択に応じて表示を切り替える
(function buildTypeSelector() {
  if (!typeSel) return;
  var opts = '';
  Object.keys(DROPPER_TYPES).forEach(function (key) {
    opts += '<option value="' + key + '">' + I18N.t(DROPPER_TYPES[key].subtitleKey) + '</option>';
  });
  typeSel.innerHTML = opts;
  typeSel.value = DEFAULT_TYPE;
  applyType(DEFAULT_TYPE);
  typeSel.addEventListener('change', function () { applyType(typeSel.value); });
})();

// 選択中の種類に合わせてリード文・競技セレクタの表示を切り替える
function applyType(key) {
  var t = DROPPER_TYPES[key];
  if (!t) return;
  currentType = key;
  if (leadEl && t.leadKey) leadEl.textContent = I18N.t(t.leadKey);
  if (sportRow) sportRow.style.display = t.useSportSelector ? '' : 'none';
}

/* ===== 入力（ドロップ / 選択） ===== */
// クリック選択は廃止（Googleログインポップアップがブラウザにブロックされるため）。ドロップのみ対応。
['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
drop.addEventListener('drop', function (e) { popAnim(); handleFiles(e.dataTransfer.files); });
regBtn.addEventListener('click', onRegisterClick);

// 最初に「Googleでログイン」ボタンをタップ → ポップアップが正しく開く（タップ直後のため）
// ログイン成功で作業エリアを表示。以降はログイン済みなのでファイル選択でポップアップ問題は起きない。
if (loginBtn) {
  loginBtn.addEventListener('click', async function () {
    loginBtn.disabled = true;
    setMsg(I18N.t('msgSigningIn'));
    try {
      await ensureToken();
      setMsg('');
      if (loginArea) loginArea.style.display = 'none';
      if (workArea) workArea.style.display = '';
    } catch (e) {
      setMsg(e && e.message ? e.message : I18N.t('msgLoginFailed'));
      loginBtn.disabled = false;
    }
  });
}

// ファイル選択ボタン（スマホの主動線）。ログイン済みなのでダイアログを開くだけ。
if (pickBtn) {
  pickBtn.addEventListener('click', function () {
    fileInput.value = '';
    fileInput.click();
  });
}
if (fileInput) {
  fileInput.addEventListener('change', function (e) { popAnim(); handleFiles(e.target.files); });
}

function setMsg(t) { msg.textContent = t || ''; }

// ドロップ/選択した瞬間に、アニメ部分（カレンダー＋紙）だけを一回り拡大して戻す
function popAnim() {
  var a = document.querySelector('#drop .anim');
  if (!a) return;
  a.classList.remove('pop');
  void a.offsetWidth;   // リフローして毎回再生し直せるようにする
  a.classList.add('pop');
}

// 結果カード（登録画面）が出たら、拡大を解除して元の大きさ・色に戻す
function unpopAnim() {
  var a = document.querySelector('#drop .anim');
  if (a) a.classList.remove('pop');
}

/* ===== Googleログイン ===== */
function ensureTokenClient() {
  if (tokenClient) return true;
  if (!(window.google && google.accounts && google.accounts.oauth2)) return false;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPE,
    callback: function (resp) {
      if (resp && resp.access_token) {
        accessToken = resp.access_token;
        if (pendingAuth) { pendingAuth.resolve(accessToken); pendingAuth = null; }
      } else {
        if (pendingAuth) { pendingAuth.reject(new Error(I18N.t('msgLoginCancelled'))); pendingAuth = null; }
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

/* ===== ドロップ処理 ===== */
async function handleFiles(fileList) {
  var files = Array.prototype.slice.call(fileList || []);
  if (!files.length) { unpopAnim(); return; }
  setMsg(I18N.t('msgReading'));
  try { await ensureToken(); }
  catch (e) { setMsg(e && e.message ? e.message : I18N.t('msgLoginFailed')); unpopAnim(); return; }
  setMsg('');
  for (var i = 0; i < files.length; i++) { await processOne(files[i]); }
  unpopAnim();   // 結果カード（登録画面）が出たので拡大を解除して元に戻す
  if (items.length) bar.style.display = 'flex';
}

async function processOne(file) {
  var card = addCard(file.name);
  try {
    card.setStatus(I18N.t('stReading'), 'wait');
    var res = await ocrViaDrive(file);
    var fields = window.Dropper.parse(res.text, sportSel ? sportSel.value : undefined);
    card.setText(res.text);
    card.fill(fields);
    items.push({ file: file, card: card, fileId: res.fileId, mimeType: res.mimeType });
  } catch (e) {
    card.setStatus(I18N.t('stFailedPrefix') + (e && e.message ? e.message : e), 'ng');
  }
}

/* ===== GoogleドライブのOCR＋元要項の保存 =====
   ・先にOCRでテキストを取得（失敗時はDriveに何も残さない）
   ・成功したら、元の要項（PDF/画像）を DropperFiles フォルダにそのまま保存して残す（＝カレンダー添付の対象）
   ・OCR用に作るGoogleドキュメント変換ファイルは使い捨て（毎回削除）
   すべて drive.file（アプリが作ったファイル/フォルダのみ）の範囲で完結する。 */
async function ocrViaDrive(file) {
  var text = await ocrText_(file);                      // 先にOCR
  var folderId = await ensureDropperFolder();           // 保存先フォルダ（無ければ自動作成）
  var fileId = await uploadOriginal_(file, folderId);   // 元要項を保存して残す → ファイルID
  return { text: text, fileId: fileId, mimeType: (file.type || '') };
}

// DropperFiles フォルダを確保してIDを返す。
// drive.file スコープでは files.list（検索）が使えないため、フォルダIDを localStorage にキャッシュする方式を採用。
//   1) メモリキャッシュ（dropperFolderId）があればそのまま使う
//   2) localStorage に保存済みIDがあれば、実際に存在するか確認してから使う（削除済みなら再作成）
//   3) どちらもなければ新規作成 → メモリ＆localStorage の両方に保存
var FOLDER_ID_STORAGE_KEY = 'dropperFolderId';
async function ensureDropperFolder() {
  // 1) メモリキャッシュ
  if (dropperFolderId) return dropperFolderId;

  // 2) localStorage から取得して存在確認
  var cached = null;
  try { cached = localStorage.getItem(FOLDER_ID_STORAGE_KEY); } catch (e) {}
  if (cached) {
    var check = await fetch('https://www.googleapis.com/drive/v3/files/' + cached + '?fields=id,trashed', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    if (check.status === 401) { accessToken = null; throw new Error(I18N.t('msgSessionExpired')); }
    if (check.ok) {
      var info = await check.json();
      if (!info.trashed) {
        dropperFolderId = cached;
        return dropperFolderId;
      }
    }
    // 存在しない or ゴミ箱済み → キャッシュ破棄して再作成へ
    try { localStorage.removeItem(FOLDER_ID_STORAGE_KEY); } catch (e) {}
  }

  // 3) 新規作成
  var c = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DROPPER_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
  });
  if (c.status === 401) { accessToken = null; throw new Error(I18N.t('msgSessionExpired')); }
  if (!c.ok) { throw new Error('フォルダ作成 ' + c.status + ': ' + (await c.text()).slice(0, 140)); }
  dropperFolderId = (await c.json()).id;
  try { localStorage.setItem(FOLDER_ID_STORAGE_KEY, dropperFolderId); } catch (e) {}
  return dropperFolderId;
}

// 元ファイルを保存して残す → ファイルIDを返す。
// multipart（メタデータ＋本体の手組み）で400になるため、よりシンプルで確実な方式に変更：
//  (1) メディアのみアップロード（本体だけ送る／手組みの境界・改行が不要）→ ファイルID取得
//  (2) 名前を元ファイル名に更新し、DropperFilesフォルダへ移動（どちらもbest-effort）
async function uploadOriginal_(file, folderId) {
  var up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=media&fields=id', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': (file.type || 'application/octet-stream')
    },
    body: file
  });
  if (up.status === 401) { accessToken = null; throw new Error(I18N.t('msgSessionExpired')); }
  if (!up.ok) { throw new Error('要項の保存 ' + up.status + ': ' + (await up.text()).slice(0, 140)); }
  var fileId = (await up.json()).id;

  // 名前を元ファイル名に、保存先をDropperFilesフォルダに（best-effort：失敗してもファイルは残る＝添付可能）
  try {
    var params = 'fields=id';
    if (folderId) params += '&addParents=' + folderId + '&removeParents=root';
    await fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?' + params, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: (file.name || 'youkou') })
    });
  } catch (e) { /* 名前変更・移動の失敗は無視（ファイルはマイドライブ直下に残る） */ }

  return fileId;
}

// OCR本体（従来どおり）：Googleドキュメント変換で一時アップロード→本文取得→一時ファイル削除（使い捨て）
async function ocrText_(file) {
  var boundary = '----dropper' + Date.now();
  var metadata = { name: (file.name || 'youkou') + '_OCR一時', mimeType: 'application/vnd.google-apps.document' };
  var head = '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: ' + (file.type || 'application/octet-stream') + '\r\n\r\n';
  var tail = '\r\n--' + boundary + '--';
  var body = new Blob([head, file, tail], { type: 'multipart/related; boundary=' + boundary });

  var up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&ocrLanguage=' + OCR_LANG, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + accessToken },
    body: body
  });
  if (up.status === 401) { accessToken = null; throw new Error(I18N.t('msgSessionExpired')); }
  if (!up.ok) { throw new Error('Drive変換 ' + up.status + ': ' + (await up.text()).slice(0, 140)); }
  var created = await up.json();
  var id = created.id;

  try {
    var ex = await fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text/plain', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    if (!ex.ok) { throw new Error('テキスト取得 ' + ex.status); }
    return await ex.text();
  } finally {
    // OCR用の変換ファイルは必ず削除（結果に関わらず）
    fetch('https://www.googleapis.com/drive/v3/files/' + id, {
      method: 'DELETE', headers: { 'Authorization': 'Bearer ' + accessToken }
    }).catch(function () {});
  }
}

/* ===== カード（プレビュー＆その場修正） ===== */
function addCard(name) {
  var li = document.createElement('li');
  li.className = 'card';
  li.innerHTML =
    '<div class="hd"><label class="chk"><input type="checkbox" checked> <span class="fn"></span></label><span class="st wait">' + I18N.t('stReadingShort') + '</span></div>' +
    '<div class="fields" style="display:none">' +
    '<p class="edit-hint">' + I18N.t('editHint') + '</p>' +
    fieldHtml(I18N.t('fldName'), 'taikai_mei') +
    fieldHtml(I18N.t('fldDates'), 'kaisai_dates') +
    fieldHtml(I18N.t('fldVenue'), 'kaijo') +
    fieldHtml(I18N.t('fldAddress'), 'kaijo_jusho') +
    fieldHtml(I18N.t('fldOpening'), 'kaikai_jikan') +
    fieldHtml(I18N.t('fldFormat'), 'shiai_keishiki') +
    fieldHtml(I18N.t('fldDeadline'), 'shimekiri') +
    fieldHtml(I18N.t('fldNote'), 'note') +
    '</div>' +
    '<div class="card-foot" style="display:none;margin-top:6px">' +
      '<p class="warn-notice" style="display:none;margin:0 0 6px;padding:6px 8px;background:#fff7e6;border:1px solid #ffd591;border-radius:6px;font-size:12px;color:#7a4f01"></p>' +
      '<button type="button" class="ai-recheck" style="font-size:13px;padding:5px 10px;border:1px solid #36cfc9;background:#e6fffb;color:#006d75;border-radius:6px;cursor:pointer">' + I18N.t('aiCheckCard') + '</button>' +
      '<span class="ai-status" style="margin-left:8px;font-size:12px;color:#555"></span>' +
      '<p class="ai-anyfield" style="font-size:11px;color:#888;margin:4px 0 0">' + I18N.t('aiAnyFieldNote') + '</p>' +
    '</div>';
  li.querySelector('.fn').textContent = name;
  list.appendChild(li);
  var stEl = li.querySelector('.st');
  var ocrText = '';   // この要項のOCR生テキスト（AI検算で使用）

  // 開催日が入力されたら警告を消す
  var dateInput = li.querySelector('[data-k="kaisai_dates"]');
  if (dateInput) dateInput.addEventListener('input', function () { markDateWarn_(li, !dateInput.value.trim()); });

  // AI検算ボタン（この大会の全項目をAIで取り直す。⚠の有無に関わらず実行できる）
  var aiBtn = li.querySelector('.ai-recheck');
  if (aiBtn) aiBtn.addEventListener('click', function () { runAiRecheck_(li, ocrText); });

  var cardApi = {
    el: li,
    setText: function (t) { ocrText = t || ''; },
    setStatus: function (t, cls) { stEl.textContent = t; stEl.className = 'st ' + (cls || 'wait'); },
    fill: function (fields) {
      stEl.textContent = I18N.t('stDone'); stEl.className = 'st ok';
      li.querySelector('.fields').style.display = 'block';
      li.querySelector('.card-foot').style.display = 'block';
      setVal(li, 'taikai_mei', fields.taikai_mei);
      setVal(li, 'kaisai_dates', (fields.kaisai_dates || []).join(', '));
      setVal(li, 'kaijo', fields.kaijo);
      setVal(li, 'kaijo_jusho', fields.kaijo_jusho);
      setVal(li, 'kaikai_jikan', fields.kaikai_jikan);
      setVal(li, 'shiai_keishiki', fields.shiai_keishiki);
      setVal(li, 'shimekiri', fields.shimekiri);
      setVal(li, 'note', fields.note);
      markDateWarn_(li, !(fields.kaisai_dates && fields.kaisai_dates.length));   // 開催日が空なら強調
      renderWarnings_(li, fields.warnings || []);   // 採点係：⚠を該当項目に表示
    },
    isChecked: function () { return li.querySelector('.chk input').checked; },
    read: function () {
      return {
        taikai_mei: getVal(li, 'taikai_mei'),
        kaisai_dates: getVal(li, 'kaisai_dates').split(/[,、\s]+/).map(function (s) { return s.trim(); }).filter(Boolean),
        kaijo: getVal(li, 'kaijo'),
        kaijo_jusho: getVal(li, 'kaijo_jusho'),
        kaikai_jikan: getVal(li, 'kaikai_jikan'),
        shiai_keishiki: getVal(li, 'shiai_keishiki'),
        shimekiri: getVal(li, 'shimekiri'),
        note: getVal(li, 'note')
      };
    },
    markDateEmpty: function () { markDateWarn_(li, true); },
    focusDate: function () {
      var f = li.querySelector('[data-k="kaisai_dates"]');
      if (f) { li.scrollIntoView({ behavior: 'smooth', block: 'center' }); f.focus(); }
    }
  };
  return cardApi;
}

// 採点係の結果（warnings）を該当フィールドの下に⚠表示する。値は変えない（印だけ）。
var WARN_CODE_KEY = {
  multi_day_events: 'warnMultiDayEvents',
  many_dates: 'warnManyDates',
  date_in_deadline: 'warnDateInDeadline',
  deadline_after_event: 'warnDeadlineAfterEvent',
  venue_suspect: 'warnVenueSuspect',
  format_empty: 'warnFormatEmpty'
};
function renderWarnings_(li, warnings) {
  // 既存の⚠表示をクリア
  li.querySelectorAll('.field-warn').forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
  var notice = li.querySelector('.warn-notice');
  (warnings || []).forEach(function (w) {
    var input = li.querySelector('[data-k="' + w.field + '"]');
    if (!input) return;
    var label = input.closest('.f');
    if (!label) return;
    var span = document.createElement('span');
    span.className = 'field-warn';
    span.style.cssText = 'display:block;margin-top:3px;font-size:12px;color:#d4380d';
    span.textContent = '⚠ ' + I18N.t(WARN_CODE_KEY[w.code] || w.code);
    label.appendChild(span);
  });
  if (notice) {
    if ((warnings || []).length) { notice.textContent = I18N.t('warnNotice'); notice.style.display = 'block'; }
    else { notice.style.display = 'none'; }
  }
}

/* ===== AI検算（BYOK：ユーザー自身のGeminiキーで実行） =====
   ・キーはこの端末のみ（localStorage）に保持し、当方サーバーには送らない／保存しない。
   ・⚠の有無に関わらず、この大会の全項目をAIで取り直す。結果は必ず人が確認する前提。
   ・無料枠超過(429)時は「翌日まで利用不可」を表示する。 */
var AI_MODEL = 'gemini-flash-latest';   // 必要に応じて 'gemini-2.0-flash' 等に変更可
var AI_KEY_STORE = 'dropper_ai_key';

function getAiKey_() {
  var k = '';
  try { k = localStorage.getItem(AI_KEY_STORE) || ''; } catch (e) {}
  if (!k) {
    k = (window.prompt(I18N.t('aiKeyPrompt')) || '').trim();
    if (k) { try { localStorage.setItem(AI_KEY_STORE, k); } catch (e) {} }
  }
  return k;
}

async function runAiRecheck_(li, ocrText) {
  var statusEl = li.querySelector('.ai-status');
  var setAi = function (t) { if (statusEl) statusEl.textContent = t || ''; };
  if (!ocrText) { setAi(I18N.t('aiFail') + 'no text'); return; }
  var key = getAiKey_();
  if (!key) { setAi(I18N.t('aiNoKey')); return; }

  setAi(I18N.t('aiRunning'));
  var prompt =
    'あなたはスポーツ大会の要項から情報を抽出するアシスタントです。' +
    '次のテキストから、実際に試合が行われる開催日・大会名・会場・住所・開会式時刻・試合形式・申込締切を読み取り、' +
    'JSONのみを返してください（前置き・説明・コードフェンスは不要）。' +
    '開催日は YYYY-MM-DD の配列。練習日・受付日・申込締切日は開催日に含めないこと。' +
    '複数日開催なら schedule に日ごとの種目を入れる。値が不明な項目は空文字または空配列。\n' +
    'スキーマ: {"taikai_mei":"","kaisai_dates":[],"kaijo":"","kaijo_jusho":"","kaikai_jikan":"","shiai_keishiki":"","shimekiri":"","schedule":[{"date":"","events":""}]}\n\n' +
    '--- 要項テキスト ---\n' + ocrText;

  try {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + AI_MODEL + ':generateContent?key=' + encodeURIComponent(key);
    var resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' }
      })
    });
    if (resp.status === 429) { setAi(I18N.t('aiLimit')); return; }
    if (!resp.ok) {
      var et = await resp.text();
      if (resp.status === 400 && /API key not valid|API_KEY_INVALID/i.test(et)) { try { localStorage.removeItem(AI_KEY_STORE); } catch (e) {} }
      setAi(I18N.t('aiFail') + resp.status); return;
    }
    var data = await resp.json();
    var txt = ((((data.candidates || [])[0] || {}).content || {}).parts || [])
      .map(function (p) { return p.text || ''; }).join('').trim();
    txt = txt.replace(/^```(?:json)?|```$/g, '').trim();
    var obj = JSON.parse(txt);

    // AI結果を入力欄へ反映（必ず人が確認する前提）
    if ('taikai_mei' in obj) setVal(li, 'taikai_mei', obj.taikai_mei);
    if ('kaisai_dates' in obj) setVal(li, 'kaisai_dates', (obj.kaisai_dates || []).join(', '));
    if ('kaijo' in obj) setVal(li, 'kaijo', obj.kaijo);
    if ('kaijo_jusho' in obj) setVal(li, 'kaijo_jusho', obj.kaijo_jusho);
    if ('kaikai_jikan' in obj) setVal(li, 'kaikai_jikan', obj.kaikai_jikan);
    if ('shiai_keishiki' in obj) setVal(li, 'shiai_keishiki', obj.shiai_keishiki);
    if ('shimekiri' in obj) setVal(li, 'shimekiri', obj.shimekiri);
    if (obj.schedule && obj.schedule.length) {
      var note = li.querySelector('[data-k="note"]');
      var sched = obj.schedule.filter(function (s) { return s && (s.date || s.events); })
        .map(function (s) { return s.date + '：' + (s.events || ''); }).join(' / ');
      if (note && sched) note.value = (note.value ? note.value + ' / ' : '') + sched;
    }
    markDateWarn_(li, !getVal(li, 'kaisai_dates').trim());
    renderWarnings_(li, []);   // AI反映後は採点係の⚠を一旦消す（再確認はユーザー）
    setAi(I18N.t('aiDone'));
  } catch (e) {
    setAi(I18N.t('aiFail') + (e && e.message ? e.message : e));
  }
}
function fieldHtml(label, key) {
  return '<label class="f"><span>' + label + '</span><input data-k="' + key + '" type="text"></label>';
}
// 開催日フィールドの警告（赤枠＋注意文）を on/off する
function markDateWarn_(li, on) {
  var f = li.querySelector('[data-k="kaisai_dates"]');
  if (!f) return;
  var label = f.closest('.f');
  if (!label) return;
  var warnEl = label.querySelector('.date-warn');
  if (on) {
    label.classList.add('warn');
    if (!warnEl) {
      warnEl = document.createElement('span');
      warnEl.className = 'date-warn';
      warnEl.textContent = I18N.t('dateWarn');
      label.appendChild(warnEl);
    }
  } else {
    label.classList.remove('warn');
    if (warnEl && warnEl.parentNode) warnEl.parentNode.removeChild(warnEl);
  }
}
function setVal(li, k, v) { var el = li.querySelector('[data-k="' + k + '"]'); if (el) el.value = v || ''; }
function getVal(li, k) { var el = li.querySelector('[data-k="' + k + '"]'); return el ? el.value : ''; }

/* ===== 登録 ===== */
function onRegisterClick() {
  regBtn.disabled = true;
  doRegister().catch(function (e) { setMsg(I18N.t('msgError') + (e && e.message ? e.message : e)); regBtn.disabled = false; });
}
async function doRegister() {
  await ensureToken();
  var targets = items.filter(function (it) { return it.card.isChecked() && !it.registered; });
  if (!targets.length) { setMsg(I18N.t('msgNoItems')); regBtn.disabled = false; return; }

  // ② 登録前チェック：チェック済みで開催日が空のカードがあれば警告して中断
  var emptyCards = targets.filter(function (it) { return !it.card.read().kaisai_dates.length; });
  if (emptyCards.length) {
    emptyCards.forEach(function (it) { it.card.markDateEmpty(); });
    setMsg(I18N.t('msgDateEmptyA') + emptyCards.length + I18N.t('msgDateEmptyB'));
    emptyCards[0].card.focusDate();
    regBtn.disabled = false;
    return;
  }

  var ok = 0, ng = 0;
  for (var i = 0; i < targets.length; i++) {
    var f = targets[i].card.read();
    try {
      if (!f.taikai_mei) throw new Error('大会名が空です');
      if (!f.kaisai_dates.length) throw new Error('開催日が空です');
      await createEvent(f, targets[i].fileId, targets[i].mimeType);   // 要項ファイルを添付
      targets[i].registered = true;              // 登録済み（再実行でスキップ・ファイルは保持）
      targets[i].card.setStatus(I18N.t('stRegistered'), 'ok');
      ok++;
    } catch (e) {
      targets[i].card.setStatus(I18N.t('stFailedPrefix') + (e && e.message ? e.message : e), 'ng');
      ng++;
    }
  }
  await cleanupUnregistered_();   // 登録しなかった（チェックを外した）要項はDropperFilesから削除
  if (ok) {
    var folderUrl = dropperFolderId ? 'https://drive.google.com/drive/folders/' + dropperFolderId : 'https://drive.google.com/drive/';
    msg.innerHTML =
      ok + I18N.t('msgRegDoneA') +
      '<a href="' + folderUrl + '" target="_blank" rel="noopener">' + I18N.t('msgFolderName') + '</a>' +
      I18N.t('msgRegDoneB') +
      (ng ? '　' + ng + I18N.t('msgRegFailCount') : '');
  } else {
    setMsg(ng ? ng + I18N.t('msgRegAllFail') : I18N.t('msgNoItems'));
  }
  regBtn.disabled = false;
}

// チェックを外した（＝登録しない）要項の保存ファイルを削除。登録済みの項目のファイルは消さない（添付済みのため）
async function cleanupUnregistered_() {
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it.registered && !it.card.isChecked() && it.fileId) {
      var id = it.fileId;
      it.fileId = null;
      fetch('https://www.googleapis.com/drive/v3/files/' + id, {
        method: 'DELETE', headers: { 'Authorization': 'Bearer ' + accessToken }
      }).catch(function () {});
    }
  }
}

async function createEvent(f, fileId, mimeType) {
  var dates = f.kaisai_dates.slice().sort();
  var folderUrl = dropperFolderId ? 'https://drive.google.com/drive/folders/' + dropperFolderId : 'https://drive.google.com/drive/';
  var description = [
    f.shiai_keishiki ? I18N.t('descFormat') + f.shiai_keishiki : '',
    f.shimekiri ? I18N.t('descDeadline') + f.shimekiri : '',
    f.kaikai_jikan ? I18N.t('descOpening') + f.kaikai_jikan : '',
    f.note ? I18N.t('descNote') + f.note : '',
    fileId ? I18N.t('descFlyer') + folderUrl + I18N.t('descFlyerTail') : ''
  ].filter(Boolean).join('\n');

  var event = {
    summary: f.taikai_mei,
    location: [f.kaijo, f.kaijo_jusho].filter(Boolean).join(' '),
    description: description,
    colorId: EVENT_COLOR_ID,
    start: { date: dates[0] },
    end: { date: window.Dropper.addDays(dates[dates.length - 1], 1) }
  };
  // 要項ファイル（DropperFilesに保存した元PDF/画像）を予定に添付
  if (fileId) {
    var att = {
      fileUrl: 'https://drive.google.com/open?id=' + fileId,
      title: (f.taikai_mei || '要項') + ' 要項'
    };
    if (mimeType) att.mimeType = mimeType;
    event.attachments = [att];
  }

  var url = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(CALENDAR_ID) +
    '/events?supportsAttachments=true';
  var res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });
  if (res.status === 401) { accessToken = null; throw new Error(I18N.t('msgSessionExpired')); }
  if (!res.ok) { var t = await res.text(); throw new Error('カレンダーAPI ' + res.status + ': ' + t.slice(0, 140)); }
  return await res.json();
}
