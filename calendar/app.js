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
var aiMode = 'hybrid';   // 'hybrid'=正規表現＋必要時AI / 'ai'=最初から全項目AIで取り直す

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

// AI利用の選択はログイン直後のポップアップで行う（画面内のモードセレクタは廃止）。
// 選択は localStorage に記憶し、次回からは出さない。「AI設定を変更」で再表示できる。
var AI_CHOICE_STORE = 'dropper_ai_choice';   // 'ai' | 'hybrid'

// ポップアップを出すべきか（未選択のときだけ自動表示）
function maybeShowAiModal_() {
  var choice = '';
  try { choice = localStorage.getItem(AI_CHOICE_STORE) || ''; } catch (e) {}
  if (choice === 'ai') { aiMode = 'ai'; renderModeBanner_(); return; }
  if (choice === 'hybrid') { aiMode = 'hybrid'; renderModeBanner_(); return; }
  openAiModal_();
}

// 現在のモード（aiMode）を画面上部の帯バナーに反映する
function renderModeBanner_() {
  var b = document.getElementById('mode-banner');
  if (!b) return;
  var isAi = (aiMode === 'ai');
  b.classList.remove('mode-ai', 'mode-hybrid');
  b.classList.add(isAi ? 'mode-ai' : 'mode-hybrid');
  var icon = b.querySelector('.mode-banner-icon');
  var title = b.querySelector('.mode-banner-title');
  var desc = b.querySelector('.mode-banner-desc');
  if (icon) icon.textContent = isAi ? '🤖' : '✋';
  if (title) title.textContent = I18N.t(isAi ? 'bannerAiTitle' : 'bannerHybridTitle');
  if (desc) desc.textContent = I18N.t(isAi ? 'bannerAiDesc' : 'bannerHybridDesc');
  renderSportRow_();
}

// 種目行の見せ方をモードで切り替える。
//  通常モード：手動セレクタ＋「① 競技を選ぶ：」（ユーザーが選ぶ）
//  AIモード：セレクタを隠し「🤖 競技は要項から自動判定します」と表示（AI結果で確定）
function renderSportRow_() {
  var isAi = (aiMode === 'ai');
  var stepNum = document.querySelector('.step-num');
  var auto = document.getElementById('sport-auto');
  if (sportSel) sportSel.style.display = isAi ? 'none' : '';
  if (stepNum) stepNum.style.display = isAi ? 'none' : '';
  if (auto) {
    auto.style.display = isAi ? '' : 'none';
    if (isAi && !auto.textContent) auto.textContent = I18N.t('sportAutoWaiting');
  }
}

// 現在選択中の競技プロファイルの「試合形式」欄ラベル（formatLabel）を返す。無ければ既定（fldFormat）。
function currentSportFormatLabel_() {
  var def = I18N.t('fldFormat');
  if (!sportSel || !window.Dropper || !window.Dropper.sports) return def;
  var cur = sportSel.value;
  var found = (window.Dropper.sports() || []).filter(function (s) { return s.key === cur; })[0];
  return (found && found.formatLabel) ? found.formatLabel : def;
}

function openAiModal_() {
  var m = document.getElementById('ai-modal');
  if (m) m.classList.add('show');
}
function closeAiModal_() {
  var m = document.getElementById('ai-modal');
  if (m) m.classList.remove('show');
}

// 「AIを使わない」を選択
function chooseHybrid_() {
  aiMode = 'hybrid';
  try { localStorage.setItem(AI_CHOICE_STORE, 'hybrid'); } catch (e) {}
  closeAiModal_();
  renderModeBanner_();
  updateAiRecheckVisibility_();
}
// 「AIを使う」を選択 → キー入力 → 入力できたらAIモードで記憶。未入力なら通常モードのまま。
function chooseAi_() {
  var key = getAiKey_();
  if (!key) { return; }   // キー未入力ならポップアップは閉じず再選択を促す
  aiMode = 'ai';
  try { localStorage.setItem(AI_CHOICE_STORE, 'ai'); } catch (e) {}
  closeAiModal_();
  renderModeBanner_();
  updateAiRecheckVisibility_();
}

// AIモードのときは各カードの「この大会をAIで検算」ボタンと「どの項目にもかけられます」注意文を隠す
// （全項目が最初からAI取得済みで、項目ごとの検算は使わないため不要）
function updateAiRecheckVisibility_() {
  var isAi = (aiMode === 'ai');
  var btns = document.querySelectorAll('.ai-recheck');
  for (var i = 0; i < btns.length; i++) { btns[i].style.display = isAi ? 'none' : ''; }
  var notes = document.querySelectorAll('.ai-anyfield');
  for (var j = 0; j < notes.length; j++) { notes[j].style.display = isAi ? 'none' : ''; }
}

// ポップアップのボタン・設定リンクを配線
(function wireAiModal_() {
  var skip = document.getElementById('aiSkipBtn');
  var use = document.getElementById('aiUseBtn');
  var settings = document.getElementById('aiSettingsLink');
  if (skip) skip.addEventListener('click', chooseHybrid_);
  if (use) use.addEventListener('click', chooseAi_);
  if (settings) settings.addEventListener('click', openAiModal_);   // 再選択（いつでも変更可）
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
      maybeShowAiModal_();   // ログイン直後：未選択ならAI利用ポップアップを出す
      renderModeBanner_();   // 現在のモードを帯バナーに表示
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
    // 「最初からAI」モード：正規表現の結果はフォールバックとして裏で保持し画面では隠す。
    // AI成功→AI結果を表示、AI失敗→正規表現の結果を表示し理由を添える（案①）。
    if (aiMode === 'ai') {
      card.hideFields();   // 正規表現結果のちらつきを防ぐ
      await runAiRecheck_(card.el, res.text, true);   // 第3引数=AIモード（失敗時フォールバック説明を出す）
    }
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
    '<div class="day-rows-wrap">' +
      '<div class="day-rows"></div>' +
      '<button type="button" class="day-add">' + I18N.t('dayAddBtn') + '</button>' +
    '</div>' +
    fieldHtml(I18N.t('fldVenue'), 'kaijo') +
    fieldHtml(I18N.t('fldAddress'), 'kaijo_jusho') +
    fieldHtml(I18N.t('fldOpening'), 'kaikai_jikan') +
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
  var rowsEl = li.querySelector('.day-rows');

  // ===== day-row（開催日＋試合形式のペア行）管理 =====
  // 行番号ラベル（1日目／2日目…）を振り直す
  function renumberRows_() {
    var rows = rowsEl.querySelectorAll('[data-day-row]');
    rows.forEach(function (row, idx) {
      var lab = row.querySelector('.day-row-label');
      if (lab) lab.textContent = dayLabel_(idx + 1);
    });
    markDateRowsWarn_();
  }
  // この大会カードで使う「試合形式」欄のラベル。通常モードは競技プロファイルのformatLabel、
  // AIモードはAIのformat_labelで上書きされる。未設定なら既定（fldFormat）。
  var formatLabel_ = currentSportFormatLabel_();
  // 行を1行追加（date/formatの初期値を指定可）
  function addRow_(date, format) {
    var div = document.createElement('div');
    div.innerHTML = dayRowHtml_(rowsEl.children.length + 1, formatLabel_);
    var row = div.firstChild;
    rowsEl.appendChild(row);
    var dEl = row.querySelector('[data-k="day_date"]');
    var fEl = row.querySelector('[data-k="day_format"]');
    if (dEl) dEl.value = date || '';
    if (fEl) fEl.value = format || '';
    if (dEl) dEl.addEventListener('input', markDateRowsWarn_);
    var rmBtn = row.querySelector('.day-row-remove');
    if (rmBtn) rmBtn.addEventListener('click', function () {
      if (rowsEl.children.length <= 1) { return; }   // 最低1行は残す
      row.remove();
      renumberRows_();
    });
    return row;
  }
  // 現在の行をすべて消して、日付配列（＋任意で日付→試合形式の対応表）から作り直す
  function rebuildRows_(dates, formatByDate) {
    rowsEl.innerHTML = '';
    formatByDate = formatByDate || {};
    if (!dates || !dates.length) { addRow_('', ''); }
    else { dates.forEach(function (d) { addRow_(d, formatByDate[d] || ''); }); }
    renumberRows_();
  }
  // 「試合形式」欄のラベルを差し替え、全行のラベル表示を更新する（AIのformat_label反映用）
  function setFormatLabel_(label) {
    formatLabel_ = (label && label.trim()) ? label.trim() : I18N.t('fldFormat');
    var spans = rowsEl.querySelectorAll('.day-row-format .format-label-text');
    for (var i = 0; i < spans.length; i++) { spans[i].textContent = formatLabel_; }
  }
  // 「＋日を追加」ボタン
  var addBtn = li.querySelector('.day-add');
  if (addBtn) addBtn.addEventListener('click', function () { addRow_('', ''); });
  // 開催日が1件も無い（全行空）時に警告
  function markDateRowsWarn_() {
    var rows = rowsEl.querySelectorAll('[data-day-row]');
    var anyFilled = Array.prototype.some.call(rows, function (row) {
      var d = row.querySelector('[data-k="day_date"]');
      return d && d.value.trim();
    });
    rows.forEach(function (row) {
      var label = row.querySelector('.day-row-date');
      if (!label) return;
      if (!anyFilled) label.classList.add('warn'); else label.classList.remove('warn');
    });
  }
  rebuildRows_([], {});   // 初期状態：1行だけ（空）

  // AI検算ボタン（この大会の全項目をAIで取り直す。⚠の有無に関わらず実行できる）
  var aiBtn = li.querySelector('.ai-recheck');
  if (aiBtn) aiBtn.addEventListener('click', function () { runAiRecheck_(li, ocrText); });
  if (aiMode === 'ai') {   // AIモードでは検算ボタン・any-field注意文は不要
    if (aiBtn) aiBtn.style.display = 'none';
    var anyNote = li.querySelector('.ai-anyfield');
    if (anyNote) anyNote.style.display = 'none';
  }

  var cardApi = {
    el: li,
    setText: function (t) { ocrText = t || ''; },
    setStatus: function (t, cls) { stEl.textContent = t; stEl.className = 'st ' + (cls || 'wait'); },
    // fields.kaisai_dates: string[]、fields.schedule: [{date, events}]（あれば日付ごとの試合形式に割当）、
    // fields.shiai_keishiki: 旧来の単一文字列（scheduleが無い時のフォールバック、1行目に入れる）
    fill: function (fields) {
      stEl.textContent = I18N.t('stDone'); stEl.className = 'st ok';
      li.querySelector('.fields').style.display = 'block';
      li.querySelector('.card-foot').style.display = 'block';
      setVal(li, 'taikai_mei', fields.taikai_mei);
      var dates = fields.kaisai_dates || [];
      var formatByDate = {};
      (fields.schedule || []).forEach(function (s) { if (s && s.date) formatByDate[s.date] = s.events || ''; });
      rebuildRows_(dates, formatByDate);
      if (!Object.keys(formatByDate).length && fields.shiai_keishiki && dates.length) {
        var firstFmt = rowsEl.querySelector('[data-k="day_format"]');
        if (firstFmt) firstFmt.value = fields.shiai_keishiki;
      }
      setVal(li, 'kaijo', fields.kaijo);
      setVal(li, 'kaijo_jusho', fields.kaijo_jusho);
      setVal(li, 'kaikai_jikan', fields.kaikai_jikan);
      setVal(li, 'shimekiri', fields.shimekiri);
      setVal(li, 'note', fields.note);
      renderWarnings_(li, fields.warnings || []);   // 採点係：⚠を該当項目に表示
    },
    isChecked: function () { return li.querySelector('.chk input').checked; },
    read: function () {
      var rows = rowsEl.querySelectorAll('[data-day-row]');
      var dates = [], formats = [];
      rows.forEach(function (row) {
        var d = (row.querySelector('[data-k="day_date"]').value || '').trim();
        var f = (row.querySelector('[data-k="day_format"]').value || '').trim();
        if (d) { dates.push(d); formats.push({ date: d, format: f }); }
      });
      return {
        taikai_mei: getVal(li, 'taikai_mei'),
        kaisai_dates: dates,
        shiai_keishiki_by_day: formats,   // [{date, format}] 日ごとの試合形式
        kaijo: getVal(li, 'kaijo'),
        kaijo_jusho: getVal(li, 'kaijo_jusho'),
        kaikai_jikan: getVal(li, 'kaikai_jikan'),
        shimekiri: getVal(li, 'shimekiri'),
        note: getVal(li, 'note')
      };
    },
    markDateEmpty: function () { markDateRowsWarn_(); },
    focusDate: function () {
      var f = rowsEl.querySelector('[data-k="day_date"]');
      if (f) { li.scrollIntoView({ behavior: 'smooth', block: 'center' }); f.focus(); }
    },
    // AI検算（runAiRecheck_）から呼ぶ窓口：day-rowsの再構築だけを行う（他項目はrunAiRecheck_側でsetVal）
    applyDayRows: function (dates, schedule) {
      var formatByDate = {};
      (schedule || []).forEach(function (s) { if (s && s.date) formatByDate[s.date] = s.events || ''; });
      rebuildRows_(dates, formatByDate);
      return formatByDate;
    },
    // 入力欄を隠す（AIモードで正規表現結果のちらつきを防ぐ。fill直後に呼ぶ）
    hideFields: function () {
      var f = li.querySelector('.fields'); if (f) f.style.display = 'none';
      var foot = li.querySelector('.card-foot'); if (foot) foot.style.display = 'none';
    },
    // 入力欄を表示する（AI成功時、またはAI失敗でフォールバック表示するとき）
    showFields: function () {
      var f = li.querySelector('.fields'); if (f) f.style.display = 'block';
      var foot = li.querySelector('.card-foot'); if (foot) foot.style.display = 'block';
    },
    // AI失敗時：正規表現の結果を表示しつつ、フォールバックである旨と理由をカード上部に出す
    showAiFallback: function (reason) {
      this.showFields();
      var box = li.querySelector('.ai-fallback');
      if (!box) {
        box = document.createElement('p');
        box.className = 'ai-fallback';
        var fieldsEl = li.querySelector('.fields');
        if (fieldsEl) fieldsEl.insertBefore(box, fieldsEl.firstChild);
      }
      box.textContent = I18N.t('aiFallbackNotice') + (reason ? '（' + reason + '）' : '');
      box.style.display = 'block';
    },
    // 「試合形式」欄のラベルを差し替える（AIのformat_label反映用）
    setFormatLabel: function (label) { setFormatLabel_(label); }
  };
  li.__cardApi = cardApi;   // runAiRecheck_からli経由でcardApiを参照できるようにする
  return cardApi;
}

// 採点係の結果（warnings）を、該当項目の入力枠の「強調＋点滅」で示す（理由文は出さない）。値は変えない。
var WARN_CODE_KEY = {
  multi_day_events: 'warnMultiDayEvents',
  many_dates: 'warnManyDates',
  date_in_deadline: 'warnDateInDeadline',
  deadline_after_event: 'warnDeadlineAfterEvent',
  venue_suspect: 'warnVenueSuspect',
  format_empty: 'warnFormatEmpty'
};
// 点滅アニメ用のスタイルを一度だけ注入
(function ensureWarnStyle_() {
  if (document.getElementById('dropper-warn-style')) return;
  var st = document.createElement('style');
  st.id = 'dropper-warn-style';
  st.textContent =
    '@keyframes dropperBlink{0%,100%{box-shadow:0 0 0 0 rgba(212,56,13,.0);border-color:#d4380d}' +
    '50%{box-shadow:0 0 0 3px rgba(212,56,13,.35);border-color:#ff4d4f}}' +
    '.f.warn-blink input{border:2px solid #d4380d!important;background:#fff1f0;animation:dropperBlink 1s ease-in-out infinite}';
  (document.head || document.documentElement).appendChild(st);
})();
function renderWarnings_(li, warnings) {
  // 既存の強調をクリア
  li.querySelectorAll('.f.warn-blink').forEach(function (el) { el.classList.remove('warn-blink'); });
  (warnings || []).forEach(function (w) {
    // 注意：day-row化により kaisai_dates / shiai_keishiki の単一欄は廃止。
    //   これらを field に指す採点係の警告は現状ターゲットが無く点滅しない（parser側の対応は別タスク）。
    var input = li.querySelector('[data-k="' + w.field + '"]');
    if (!input) return;
    var label = input.closest('.f');
    if (label) label.classList.add('warn-blink');   // 入力枠を強調＋点滅
  });
  var notice = li.querySelector('.warn-notice');
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

async function runAiRecheck_(li, ocrText, isAiMode) {
  var statusEl = li.querySelector('.ai-status');
  var setAi = function (t) { if (statusEl) statusEl.textContent = t || ''; };
  // AIモードの失敗時：正規表現の結果を表示し、フォールバックである旨＋理由を添える
  var fallback = function (reason) {
    if (isAiMode && li.__cardApi && li.__cardApi.showAiFallback) li.__cardApi.showAiFallback(reason);
  };
  if (!ocrText) { setAi(I18N.t('aiFail') + 'no text'); fallback('no text'); return; }
  var key = getAiKey_();
  if (!key) { setAi(I18N.t('aiNoKey')); fallback(I18N.t('aiNoKey')); return; }

  setAi(I18N.t('aiRunning'));
  var prompt =
    'あなたはスポーツ大会の要項から情報を抽出するアシスタントです。' +
    '次のテキストから、実際に試合が行われる開催日・大会名・会場・住所・開会式時刻・試合形式・申込締切・競技種目を読み取り、' +
    'JSONのみを返してください（前置き・説明・コードフェンスは不要）。' +
    '開催日は YYYY-MM-DD の配列。練習日・受付日・申込締切日は開催日に含めないこと。' +
    '複数日開催なら schedule に日ごとの種目（events）を入れる。' +
    'schedule は kaisai_dates の各日付に対応する要素を必ず1件ずつ作り、date は kaisai_dates と同じ YYYY-MM-DD 形式にすること。' +
    'その日の種目が不明なら events は空文字でよいが、要素自体は省略しないこと。値が不明な項目は空文字または空配列。\n' +
    'sport は競技種目で、要項に書かれている競技名を簡潔な日本語で1つ答えること（例：卓球、バドミントン、バレーボール、サッカー、剣道）。' +
    '複数競技の大会なら主要なものを1つ、判断できなければ空文字。\n' +
    'format_label は、その競技で「試合形式」に相当する項目の自然な見出し名（例：卓球なら「試合形式」、陸上なら「実施種目」、駅伝なら「区間」、武道なら「部門・階級」）。判断できなければ空文字。\n' +
    'eligibility は参加資格・出場制限を、参加者が読んで分かるよう簡潔にまとめた文（年齢・性別・所属・段位・出場できない条件など。複数あれば「、」で区切る）。記載が無ければ空文字。\n' +
    'fee は参加費・参加料を、金額と単位が分かるよう簡潔にまとめた文（例「1人8,000円（3名1チーム24,000円）」）。記載が無ければ空文字。\n' +
    'payment_deadline は参加費の振込・支払期限。YYYY-MM-DD 形式、無ければ空文字。\n' +
    'スキーマ: {"taikai_mei":"","kaisai_dates":[],"kaijo":"","kaijo_jusho":"","kaikai_jikan":"","shiai_keishiki":"","shimekiri":"","schedule":[{"date":"","events":""}],"sport":"","format_label":"","eligibility":"","fee":"","payment_deadline":""}\n\n' +
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
    if (resp.status === 429) { setAi(I18N.t('aiLimit')); fallback(I18N.t('aiLimit')); return; }
    if (!resp.ok) {
      var et = await resp.text();
      if (resp.status === 400 && /API key not valid|API_KEY_INVALID/i.test(et)) { try { localStorage.removeItem(AI_KEY_STORE); } catch (e) {} }
      setAi(I18N.t('aiFail') + resp.status); fallback('HTTP ' + resp.status); return;
    }
    var data = await resp.json();
    var txt = ((((data.candidates || [])[0] || {}).content || {}).parts || [])
      .map(function (p) { return p.text || ''; }).join('').trim();
    txt = txt.replace(/^```(?:json)?|```$/g, '').trim();
    var obj = JSON.parse(txt);

    // AI結果を入力欄へ反映（必ず人が確認する前提）
    if ('taikai_mei' in obj) setVal(li, 'taikai_mei', obj.taikai_mei);
    var dates = obj.kaisai_dates || [];
    if (li.__cardApi && (dates.length || obj.schedule)) {
      li.__cardApi.applyDayRows(dates, obj.schedule);
    }
    if ('kaijo' in obj) setVal(li, 'kaijo', obj.kaijo);
    if ('kaijo_jusho' in obj) setVal(li, 'kaijo_jusho', obj.kaijo_jusho);
    if ('kaikai_jikan' in obj) setVal(li, 'kaikai_jikan', obj.kaikai_jikan);
    if ('shimekiri' in obj) setVal(li, 'shimekiri', obj.shimekiri);
    // schedule が無く shiai_keishiki のみの場合は、1行目の試合形式欄に入れる（従来挙動の温存）
    if ((!obj.schedule || !obj.schedule.length) && obj.shiai_keishiki) {
      var firstFmt = li.querySelector('[data-k="day_format"]');
      if (firstFmt && !firstFmt.value) firstFmt.value = obj.shiai_keishiki;
    }
    // AIが判定した競技種目を自動表示欄にそのまま表示（方式Q：自由記述・プロファイル照合なし）
    if (isAiMode) {
      var auto = document.getElementById('sport-auto');
      if (auto) {
        var sp = (typeof obj.sport === 'string') ? obj.sport.trim() : '';
        auto.textContent = sp ? (I18N.t('sportAutoLabel') + sp) : I18N.t('sportAutoUnknown');
      }
      // AIが答えた format_label（競技に合った項目名）を「試合形式」欄ラベルに反映
      if (li.__cardApi && li.__cardApi.setFormatLabel && typeof obj.format_label === 'string') {
        li.__cardApi.setFormatLabel(obj.format_label);
      }
      // 参加するにあたって重要な情報（参加資格・参加費・振込期限）をメモ欄にカテゴリ見出し付きで追記
      appendParticipationInfo_(li, obj);
    }
    if (li.__cardApi) li.__cardApi.markDateEmpty();   // 行の警告状態を再計算
    if (isAiMode && li.__cardApi && li.__cardApi.showFields) {
      li.__cardApi.showFields();   // AIモード：成功したので結果を表示
      var fb = li.querySelector('.ai-fallback'); if (fb) fb.style.display = 'none';
    }
    renderWarnings_(li, []);   // AI反映後は採点係の⚠を一旦消す（再確認はユーザー）
    setAi(I18N.t('aiDone'));
  } catch (e) {
    setAi(I18N.t('aiFail') + (e && e.message ? e.message : e));
    fallback(e && e.message ? e.message : String(e));
  }
}

// 参加するにあたって重要な情報（参加資格・参加費・振込期限）を、カテゴリ見出し付きでメモ欄に追記する。
// 既存のメモ内容は残し、その下に足す（重複追記は防ぐ）。値が無い項目は出さない。
function appendParticipationInfo_(li, obj) {
  var note = li.querySelector('[data-k="note"]');
  if (!note) return;
  var parts = [];
  var elig = (typeof obj.eligibility === 'string') ? obj.eligibility.trim() : '';
  var fee = (typeof obj.fee === 'string') ? obj.fee.trim() : '';
  var pay = (typeof obj.payment_deadline === 'string') ? obj.payment_deadline.trim() : '';
  if (elig) parts.push(I18N.t('noteEligibility') + elig);
  if (fee) parts.push(I18N.t('noteFee') + fee);
  if (pay) parts.push(I18N.t('notePayment') + pay);
  if (!parts.length) return;
  var block = parts.join('\n');
  var cur = note.value || '';
  if (cur.indexOf(block) !== -1) return;   // 同一内容が既にあれば追記しない
  note.value = cur ? (cur + '\n' + block) : block;
}

function fieldHtml(label, key) {
  return '<label class="f"><span>' + label + '</span><input data-k="' + key + '" type="text"></label>';
}

// 「○日目」ラベル（t()のプレースホルダ拡張版：辞書は dayLabel: '{n}日目' / 'Day {n}' 等）
function dayLabel_(n) { return I18N.t('dayLabel', { n: n }); }

// 開催日＋試合形式のペア行を1行分のHTMLで返す（n=1始まりの行番号）
function dayRowHtml_(n, formatLabel) {
  var fmtLbl = formatLabel || I18N.t('fldFormat');
  return '' +
    '<div class="day-row" data-day-row>' +
      '<span class="day-row-label">' + dayLabel_(n) + '</span>' +
      '<label class="f day-row-date"><span>' + I18N.t('fldDates') + '</span><input data-k="day_date" type="text"></label>' +
      '<label class="f day-row-format"><span class="format-label-text">' + fmtLbl + '</span><input data-k="day_format" type="text"></label>' +
      '<button type="button" class="day-row-remove" title="' + I18N.t('dayRemoveBtn') + '">' + I18N.t('dayRemoveBtn') + '</button>' +
    '</div>';
}
// 開催日フィールドの警告（赤枠＋注意文）は、各カード内の markDateRowsWarn_（day-row方式）に移行済み。
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

  // 試合形式：日付順に並べ、複数日のときだけ各行に日付（M/D）を付ける。1日開催は形式のみ。
  var byDay = (f.shiai_keishiki_by_day || []).slice().sort(function (a, b) {
    return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
  });
  var filled = byDay.filter(function (s) { return s.format; });
  var formatText = '';
  if (filled.length) {
    if (dates.length <= 1) {
      formatText = filled.map(function (s) { return s.format; }).join(' / ');
    } else {
      formatText = filled.map(function (s) {
        var md = s.date.replace(/^\d+-0?(\d+)-0?(\d+)$/, '$1/$2');
        return md + ' ' + s.format;
      }).join(' / ');
    }
  }

  var description = [
    formatText ? I18N.t('descFormat') + formatText : '',
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
