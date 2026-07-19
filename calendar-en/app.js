// app.js — ドロッパー（Web版・フェーズ1）GoogleドライブOCR版
'use strict';

/* ===== 設定（ここだけ書き換える） ===== */
var GOOGLE_CLIENT_ID = '924835597048-lf0e4p3f73373ur5pnujac9bcl5cj820.apps.googleusercontent.com';

// クラブ運用モード：?club=hakusan でアクセスしたときだけ有効。
// このときだけ「大会マスタ・シート」への書き出し（出欠システム連携）を行う。一般公開URLでは動かない。
// 運用ルール：クラブモード時は必ず hakusan.large@gmail.com でログインすること（シートがそのアカウント所有になる）。
var CLUB_MODE = (function () {
  try { return new URLSearchParams(window.location.search).get('club') === 'hakusan'; }
  catch (e) { return false; }
})();
var MASTER_SHEET_TITLE = '大会マスタ（出欠連携）';   // クラブモードで新規作成する大会マスタ・シートのタイトル

// OAuthスコープはアクセスモードで出し分ける（OAuth本番審査を軽くするため）。
//   一般公開URL：drive.file（OCR用・アプリが作ったファイルのみ）＋ drive.appdata（フォルダID対応表の端末間共有）＋ calendar.events（予定作成）
//   クラブURL（?club=hakusan）：上記に spreadsheets（大会マスタ書き出し）を追加
// spreadsheets を一般ユーザーの同意対象から外すことで、一般公開の審査対象スコープを減らす。
// クラブ運用は白山クラブ内部のみ（テストユーザー登録済みアカウントで利用）。
var BASE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/calendar.events'
];
var CLUB_EXTRA_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets'
];
var SCOPE = (CLUB_MODE ? BASE_SCOPES.concat(CLUB_EXTRA_SCOPES) : BASE_SCOPES).join(' ');
var CALENDAR_ID = 'primary';
var EVENT_COLOR_ID = '11';   // 赤
var OCR_LANG = (window.LANG === 'en' || window.LANG === 'in') ? 'en' : 'ja';   // GoogleドライブOCRの言語（en/in版は英語、日本語版はja）

/* ===== 状態 ===== */
var accessToken = null;
var tokenClient = null;
var pendingAuth = null;
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
// 「AIを使う」を選択 → キー入力モーダル → 入力できたらAIモードで記憶。キャンセルなら通常モードのまま。
async function chooseAi_() {
  var key = await askAiKey_();
  if (!key) { return; }   // キャンセル＝AI利用選択のポップアップは閉じず再選択を促す
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
  var text = await ocrText_(file);   // OCRのみ。要項の保存は登録ボタンを押したとき（doRegister）に、
                                     // 確定した 年/月/大会名 フォルダへ行う（案X）。
  return { text: text, fileId: null, mimeType: (file.type || '') };
}

// ===== 大会カレンダー登録／年／月／大会名／ の階層フォルダを確保 =====
// drive.file スコープでは files.list（検索）が使えないため、
// 「階層パス→フォルダID」の対応を記録して二重作成を防ぐ。
// 記録先は (1) appDataFolder 上の JSON（端末をまたいで共有）＋ (2) localStorage（高速な手元キャッシュ）の二段。
// これにより、スマホとPCなど別端末でも同じ 年/月/大会名 フォルダを再利用できる。
var CHILD_FOLDER_CACHE_KEY = 'dropperChildFolders';   // { "親ID/子名": "子ID", ... }
var APPDATA_FILE_NAME = 'dropper-folders.json';       // appDataFolder上の対応表ファイル名
var appDataFileId_ = null;                            // その対応表ファイルのID（一度見つけたら保持）
var childFolderMap_ = null;                           // メモリ上の対応表（読み込み後に保持）

// --- localStorage（手元キャッシュ・フォールバック用） ---
function loadLocalCache_() {
  try { return JSON.parse(localStorage.getItem(CHILD_FOLDER_CACHE_KEY) || '{}'); }
  catch (e) { return {}; }
}
function saveLocalCache_(map) {
  try { localStorage.setItem(CHILD_FOLDER_CACHE_KEY, JSON.stringify(map)); } catch (e) {}
}

// --- appDataFolder（端末間で共有される保存先） ---
// appDataFolder内は files.list で検索できる特別な領域。対応表ファイルのIDを探す（無ければ null）。
async function findAppDataFile_() {
  try {
    var q = encodeURIComponent("name='" + APPDATA_FILE_NAME + "'");
    var r = await fetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=' + q + '&fields=files(id)', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    if (r.status === 401) { accessToken = null; throw new Error(I18N.t('msgSessionExpired')); }
    if (!r.ok) return null;
    var data = await r.json();
    return (data.files && data.files.length) ? data.files[0].id : null;
  } catch (e) {
    if (e && e.message === I18N.t('msgSessionExpired')) throw e;
    return null;
  }
}

// appDataFolderから対応表を読む（無ければ空オブジェクト）。ファイルIDは appDataFileId_ に保持。
async function readAppDataMap_() {
  try {
    if (!appDataFileId_) appDataFileId_ = await findAppDataFile_();
    if (!appDataFileId_) return {};
    var r = await fetch('https://www.googleapis.com/drive/v3/files/' + appDataFileId_ + '?alt=media', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    if (r.status === 401) { accessToken = null; throw new Error(I18N.t('msgSessionExpired')); }
    if (!r.ok) return {};
    return await r.json();
  } catch (e) {
    if (e && e.message === I18N.t('msgSessionExpired')) throw e;
    return {};
  }
}

// 対応表を appDataFolder に書き戻す（既存ファイルがあれば更新、無ければ新規作成）。best-effort。
async function writeAppDataMap_(map) {
  var body = JSON.stringify(map);
  try {
    if (!appDataFileId_) appDataFileId_ = await findAppDataFile_();
    if (appDataFileId_) {
      // 既存ファイルの中身を更新（media アップロード）
      var u = await fetch('https://www.googleapis.com/upload/drive/v3/files/' + appDataFileId_ + '?uploadType=media', {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: body
      });
      if (u.status === 401) { accessToken = null; throw new Error(I18N.t('msgSessionExpired')); }
      return;
    }
    // 新規作成：multipart で メタデータ（appDataFolder配下）＋本体 を一度に送る
    var boundary = 'dropper' + Date.now();
    var meta = { name: APPDATA_FILE_NAME, parents: ['appDataFolder'] };
    var multipart =
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
      '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + body +
      '\r\n--' + boundary + '--';
    var c = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'multipart/related; boundary=' + boundary },
      body: multipart
    });
    if (c.status === 401) { accessToken = null; throw new Error(I18N.t('msgSessionExpired')); }
    if (c.ok) { appDataFileId_ = (await c.json()).id; }
  } catch (e) {
    if (e && e.message === I18N.t('msgSessionExpired')) throw e;
    // 書き込み失敗は致命的でない（localStorageが手元に残る）。次回リトライされる。
  }
}

// メモリ上の対応表を初期化して返す（未初期化なら appDataFolder＋localStorage を読んで統合）。
// 統合方針：両方のキーを合わせ持つ（どちらかにしか無いIDも活かす）。以後はメモリを使う。
async function getChildFolderMap_() {
  if (childFolderMap_) return childFolderMap_;
  var local = loadLocalCache_();
  var remote = await readAppDataMap_();
  var merged = {};
  var k;
  for (k in local) if (Object.prototype.hasOwnProperty.call(local, k)) merged[k] = local[k];
  for (k in remote) if (Object.prototype.hasOwnProperty.call(remote, k)) merged[k] = remote[k];
  childFolderMap_ = merged;
  return childFolderMap_;
}

// 対応表を保存（メモリ＋localStorage＋appDataFolder）。appDataは端末間共有のため best-effort で書く。
async function saveChildFolderMap_(map) {
  childFolderMap_ = map;
  saveLocalCache_(map);
  await writeAppDataMap_(map);
}

// 指定フォルダIDが実在し、ゴミ箱でなければ true
async function folderExists_(id) {
  try {
    var r = await fetch('https://www.googleapis.com/drive/v3/files/' + id + '?fields=id,trashed', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    if (r.status === 401) { accessToken = null; throw new Error(I18N.t('msgSessionExpired')); }
    if (!r.ok) return false;
    var info = await r.json();
    return !info.trashed;
  } catch (e) {
    if (e && e.message === I18N.t('msgSessionExpired')) throw e;
    return false;
  }
}

// parentId の下に name フォルダを作り、IDを返す（drive.file：自分で作るのでアクセス可能）
async function createChildFolder_(parentId, name) {
  var c = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
  });
  if (c.status === 401) { accessToken = null; throw new Error(I18N.t('msgSessionExpired')); }
  if (!c.ok) { throw new Error('フォルダ作成 ' + c.status + ': ' + (await c.text()).slice(0, 140)); }
  return (await c.json()).id;
}

// parentId の下の name フォルダを確保（対応表優先、無ければ作成）してIDを返す。
// 対応表は appDataFolder＋localStorage 統合版（端末をまたいでも同じフォルダを再利用できる）。
async function ensureChildFolder_(parentId, name) {
  var cache = await getChildFolderMap_();
  var key = parentId + '/' + name;
  if (cache[key]) {
    if (await folderExists_(cache[key])) return cache[key];
    delete cache[key];   // 消えていたら作り直す
  }
  var id = await createChildFolder_(parentId, name);
  cache[key] = id;
  await saveChildFolderMap_(cache);
  return id;
}

// フォルダ名に使えない文字を除去し、長すぎる場合は詰める（大会名フォルダ用）
function sanitizeFolderName_(name) {
  var s = String(name || '').replace(/[\/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) s = '名称未設定';
  if (s.length > 80) s = s.slice(0, 80);
  return s;
}

// 開催日(YYYY-MM-DD) と 大会名 から、マイドライブ直下に 「<年> Tournaments／<月>／大会名／」 を確保して末端IDを返す。
// 例: 2026 Tournaments／10／第三回…大会／。開催日が空/不正なら Uncategorized Tournaments に入れる（年月を決められないため）。
// drive.file スコープでは既存フォルダの検索ができないため、Web版が作ったフォルダのIDを
// localStorage にキャッシュして再利用する（他アプリ/手動で作った同名フォルダとは統合されない）。
//
// 【フォルダ名は全言語で英語に統一（v43）】
//   2026 Tournaments ／ 09 ／ 大会名        （月はゼロ埋め2桁＝ドライブ上で月順に並ぶ）
//   開催日が読めないとき : Uncategorized Tournaments ／ 大会名
// 大会名フォルダだけは要項どおりの名前（日本語の大会なら日本語のまま）。
//
// ⚠️ v42以前は「2026大会 ／ 9月」という日本語名だった。対応表のキーはフォルダ名なので、
//    この変更で旧フォルダとは別系統になる。drive.file スコープでは既存フォルダを検索できず、
//    ツール側での自動統合は不可能（旧フォルダは手作業で移動するしかない）。
//    利用者が開発者のみの段階で入れた変更。
function folderNames_(m) {
  if (!m) return { year: 'Uncategorized Tournaments', month: '' };
  return {
    year:  m[1] + ' Tournaments',   // 例: 2026 Tournaments
    month: m[2]                     // 例: 09（ゼロ埋め2桁のまま。月順に並ぶ）
  };
}

async function ensureEventFolder_(kaisaiDate, taikaiMei) {
  var m = /^(\d{4})-(\d{2})-\d{2}$/.exec(kaisaiDate || '');
  var names = folderNames_(m);
  var yearName = names.year;
  var monthName = names.month;
  // 'root' = マイドライブ直下（drive.file でも parents:['root'] で作成可能）
  var yearId = await ensureChildFolder_('root', yearName);
  var parentForName = monthName ? await ensureChildFolder_(yearId, monthName) : yearId;
  var nameId = await ensureChildFolder_(parentForName, sanitizeFolderName_(taikaiMei));
  return nameId;
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

  // 名前を元ファイル名に、保存先を渡されたフォルダ（大会名フォルダ）に（best-effort：失敗してもファイルは残る＝添付可能）
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
    '<div class="keyinfo-wrap" style="display:none">' +
      '<p class="keyinfo-head">' + I18N.t('keyInfoHead') + '</p>' +
      '<div class="keyinfo-rows"></div>' +
    '</div>' +
    '</div>' +
    '<div class="card-foot" style="display:none;margin-top:6px">' +
      '<p class="warn-notice" style="display:none;margin:0 0 6px;padding:6px 8px;background:#fff7e6;border:1px solid #ffd591;border-radius:6px;font-size:12px;color:#7a4f01"></p>' +
      (CLUB_MODE ?
        '<label class="master-optin" style="display:block;margin:0 0 8px;padding:7px 10px;background:#f0f5ff;border:1px solid #adc6ff;border-radius:8px;font-size:13px;color:#1d39c4;cursor:pointer">' +
          '<input type="checkbox" class="master-chk" checked style="margin-right:6px;vertical-align:middle">' +
          '出欠フォームに載せる（大会マスタへ書き出し）' +
        '</label>' : '') +
      '<button type="button" class="ai-recheck" style="font-size:13px;padding:5px 10px;border:1px solid #36cfc9;background:#e6fffb;color:#006d75;border-radius:6px;cursor:pointer">' + I18N.t('aiCheckCard') + '</button>' +
      '<span class="ai-status" style="margin-left:8px;font-size:12px;color:#555"></span>' +
      '<p class="ai-anyfield" style="font-size:11px;color:#888;margin:4px 0 0">' + I18N.t('aiAnyFieldNote') + '</p>' +
    '</div>';
  li.querySelector('.fn').textContent = name;
  list.appendChild(li);
  var stEl = li.querySelector('.st');
  var ocrText = '';   // この要項のOCR生テキスト（AI検算で使用）
  var rowsEl = li.querySelector('.day-rows');
  var keyInfoWrap = li.querySelector('.keyinfo-wrap');
  var keyInfoRows = li.querySelector('.keyinfo-rows');

  // ===== 重要情報欄（AIモードのみ。参加者にとって重要な情報を最大5項目、欄ごとに表示） =====
  // items = [{label, text}] を受け取り、欄を作り直す。空なら欄ごと隠す。
  function setKeyInfo_(items) {
    if (!keyInfoRows || !keyInfoWrap) return;
    keyInfoRows.innerHTML = '';
    items = (items || []).slice(0, 5);   // 最大5項目
    if (!items.length) { keyInfoWrap.style.display = 'none'; return; }
    keyInfoWrap.style.display = 'block';
    items.forEach(function (it) {
      var row = document.createElement('div');
      row.className = 'keyinfo-row';
      row.setAttribute('data-keyinfo-row', '');
      row.innerHTML =
        '<input type="checkbox" class="keyinfo-chk" checked title="' + I18N.t('keyInfoInclude') + '">' +
        '<input type="text" class="keyinfo-label" value="">' +
        '<input type="text" class="keyinfo-text" value="">';
      keyInfoRows.appendChild(row);
      row.querySelector('.keyinfo-label').value = (it.label || '').trim();
      row.querySelector('.keyinfo-text').value = (it.text || '').trim();
    });
  }
  // チェックされた重要情報を [{label, text}] で返す（カレンダー登録の説明文用）
  function readKeyInfo_() {
    if (!keyInfoRows) return [];
    var out = [];
    keyInfoRows.querySelectorAll('[data-keyinfo-row]').forEach(function (row) {
      var chk = row.querySelector('.keyinfo-chk');
      if (!chk || !chk.checked) return;
      var label = (row.querySelector('.keyinfo-label').value || '').trim();
      var text = (row.querySelector('.keyinfo-text').value || '').trim();
      if (label || text) out.push({ label: label, text: text });
    });
    return out;
  }


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
      // 試合形式の補完：scheduleの器はあっても events が全部空なら、全体の試合形式(shiai_keishiki)を1行目へ。
      // （parserは常にscheduleを空eventsで返すため、「キーの有無」でなく「値が全部空か」で判定する）
      var fmtVals = Object.keys(formatByDate).map(function (k) { return (formatByDate[k] || '').trim(); });
      var noDayFormats = !fmtVals.length || fmtVals.every(function (v) { return !v; });
      if (noDayFormats && fields.shiai_keishiki && dates.length) {
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
        note: getVal(li, 'note'),
        key_info: readKeyInfo_()   // チェックされた重要情報 [{label,text}]（カレンダー説明文用）
      };
    },
    markDateEmpty: function () { markDateRowsWarn_(); },
    focusDate: function () {
      var f = rowsEl.querySelector('[data-k="day_date"]');
      if (f) { li.scrollIntoView({ behavior: 'smooth', block: 'center' }); f.focus(); }
    },
    // 競技方法（試合形式）欄の最初の行にフォーカス。種目が読み取れず手入力を促すときに使う。
    focusFormat: function () {
      var f = rowsEl.querySelector('[data-k="day_format"]');
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
    // AIが混み合っていて読み取れなかったとき：数字やHTTPを見せず、やさしい案内を出す。
    // 下に表示中の読み取り結果を確認・手直しできることを伝える（reason文字列は付けない）。
    showAiBusy: function () {
      this.showFields();
      var box = li.querySelector('.ai-fallback');
      if (!box) {
        box = document.createElement('p');
        box.className = 'ai-fallback';
        var fieldsEl = li.querySelector('.fields');
        if (fieldsEl) fieldsEl.insertBefore(box, fieldsEl.firstChild);
      }
      box.textContent = I18N.t('aiBusyNotice');
      box.style.display = 'block';
    },
    // 「試合形式」欄のラベルを差し替える（AIのformat_label反映用）
    setFormatLabel: function (label) { setFormatLabel_(label); },
    // 重要情報欄をセット（AIモードのみ）／チェックされた重要情報を読み取る
    setKeyInfo: function (items) { setKeyInfo_(items); },
    readKeyInfo: function () { return readKeyInfo_(); },
    // 「出欠フォームに載せる」チェックの状態（クラブモード限定。チェックが無い＝一般モードは true 扱い）
    masterOptIn: function () {
      var chk = li.querySelector('.master-chk');
      return chk ? chk.checked : true;
    }
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

// ===== AIリクエストのスロットル（毎分制限=RPM回避） =====
// Gemini無料枠のFlashは約10〜15リクエスト/分。連続ドロップで一気に送ると429になるため、
// 各AIリクエストの間に最低 AI_MIN_INTERVAL_MS の間隔を空けて1件ずつ順番に処理する。
var AI_MIN_INTERVAL_MS = 5000;   // 約5秒間隔（15回/分でも安全側）
var aiLastRequestAt_ = 0;        // 直近のAIリクエスト時刻
var aiThrottleChain_ = Promise.resolve();   // 直列化用チェーン

// 前のAIリクエストから AI_MIN_INTERVAL_MS 経つまで待つ。呼び出しは直列化される。
function aiThrottleWait_() {
  aiThrottleChain_ = aiThrottleChain_.then(function () {
    var now = Date.now();
    var wait = Math.max(0, AI_MIN_INTERVAL_MS - (now - aiLastRequestAt_));
    aiLastRequestAt_ = now + wait;
    return wait ? new Promise(function (r) { setTimeout(r, wait); }) : null;
  });
  return aiThrottleChain_;
}

// 保存済みのAIキーを返す（無ければ空文字）。入力を求めるときは askAiKey_() を使う。
function getAiKey_() {
  try { return localStorage.getItem(AI_KEY_STORE) || ''; } catch (e) { return ''; }
}

// ===== APIキー入力モーダル =====
// window.prompt では取得手順やリンクを示せず、キーの取り方が分からない人が詰まるため、
// 手順・AI Studioへのボタン・注意書きを備えた専用モーダルで入力してもらう。
// 保存済みなら即その値を返す。未保存ならモーダルを開き、Promiseでキー（またはキャンセル時は空文字）を返す。
function askAiKey_() {
  var saved = getAiKey_();
  if (saved) return Promise.resolve(saved);

  var modal = document.getElementById('key-modal');
  var input = document.getElementById('keyInput');
  var errEl = document.getElementById('keyError');
  var saveBtn = document.getElementById('keySaveBtn');
  var cancelBtn = document.getElementById('keyCancelBtn');
  if (!modal || !input || !saveBtn || !cancelBtn) return Promise.resolve('');

  return new Promise(function (resolve) {
    var finish = function (value) {
      modal.classList.remove('show');
      saveBtn.removeEventListener('click', onSave);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      resolve(value);
    };
    var onSave = function () {
      var k = (input.value || '').trim();
      if (!k) {
        if (errEl) { errEl.textContent = I18N.t('keyModalEmpty'); errEl.style.display = 'block'; }
        input.focus();
        return;
      }
      try { localStorage.setItem(AI_KEY_STORE, k); } catch (e) {}
      finish(k);
    };
    var onCancel = function () { finish(''); };
    var onKey = function (e) { if (e.key === 'Enter') { e.preventDefault(); onSave(); } };

    input.value = '';
    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
    saveBtn.addEventListener('click', onSave);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
    modal.classList.add('show');
    setTimeout(function () { input.focus(); }, 50);
  });
}

async function runAiRecheck_(li, ocrText, isAiMode) {
  var statusEl = li.querySelector('.ai-status');
  var setAi = function (t) { if (statusEl) statusEl.textContent = t || ''; };
  // AIモードの失敗時：正規表現の結果を表示し、フォールバックである旨＋理由を添える
  var fallback = function (reason) {
    if (isAiMode && li.__cardApi && li.__cardApi.showAiFallback) li.__cardApi.showAiFallback(reason);
  };
  if (!ocrText) { setAi(I18N.t('aiFail') + 'no text'); fallback('no text'); return; }
  var key = await askAiKey_();
  if (!key) { setAi(I18N.t('aiNoKey')); fallback(I18N.t('aiNoKey')); return; }

  setAi(I18N.t('aiRunning'));
  var prompt =
    'あなたはスポーツ大会の要項から情報を抽出するアシスタントです。' +
    '次のテキストから、実際に試合が行われる開催日・大会名・会場・住所・開会式時刻・試合形式・申込締切・競技種目を読み取り、' +
    'JSONのみを返してください（前置き・説明・コードフェンスは不要）。' +
    '開催日は YYYY-MM-DD の配列。練習日・受付日・申込締切日は開催日に含めないこと。' +
    'schedule は kaisai_dates の各日付に対応する要素を必ず1件ずつ作り、date は kaisai_dates と同じ YYYY-MM-DD 形式にすること。' +
    'events には、その日に行われる試合形式・競技方法・種目（例：トーナメント方式、予選リーグ、優勝決定戦、個人戦、団体戦、◯◯の部 など）を必ず入れること。' +
    '1日開催の場合も、要項に競技方法・試合形式・種目の記載があれば、その内容を schedule の events に必ず入れること（要項本文の「競技方法」「試合方法」「試合内容」「試合形式」などの項目を必ず参照する）。' +
    'その日の種目がどうしても判断できないときのみ events を空文字にしてよいが、要素自体は省略しないこと。値が不明な項目は空文字または空配列。\n' +
    'sport は競技種目で、要項に書かれている競技名を簡潔な日本語で1つ答えること（例：卓球、バドミントン、バレーボール、サッカー、剣道）。' +
    '複数競技の大会なら主要なものを1つ、判断できなければ空文字。\n' +
    'format_label は、その競技で「試合形式」に相当する項目の自然な見出し名（例：卓球なら「試合形式」、陸上なら「実施種目」、駅伝なら「区間」、武道なら「部門・階級」）。判断できなければ空文字。\n' +
    'key_info は、この大会に参加するにあたって参加者が知っておくべき重要な情報を、要項から重要な順に最大5件抜き出した配列。' +
    '各要素は {"label":"短い見出し","text":"内容"} の形。' +
    'label は「参加資格」「参加費」「申込締切」「エントリー制限」「持ち物」「駐車場」「安全・注意」「表彰」など内容に合った簡潔な見出し。' +
    'text はその具体的な内容を参加者が読んで分かるよう簡潔にまとめる。' +
    '参加資格・出場制限・参加費・支払期限なども、要項に記載があり重要と判断すれば key_info に含めること。' +
    '重要な情報が無ければ空配列。最大5件を厳守し、些末な事務的記述は省く。\n' +
    'スキーマ: {"taikai_mei":"","kaisai_dates":[],"kaijo":"","kaijo_jusho":"","kaikai_jikan":"","shiai_keishiki":"","shimekiri":"","schedule":[{"date":"","events":""}],"sport":"","format_label":"","key_info":[{"label":"","text":""}]}\n\n' +
    '--- 要項テキスト ---\n' + ocrText;

  try {
    // 一時的なサーバーエラー（混雑・過負荷）のときは1回だけ再試行する。
    // 一般利用者には待ち時間が長く感じられるため、2回→1回に短縮（体感重視）。
    // 各試行の間隔は既存のスロットル(aiThrottleWait_ = 約5秒)を使うのでRPM制限も同時に守られる。
    var resp = null;
    var busy = false;   // 混雑系エラー(500/502/503/504)を最後に受けたか
    for (var attempt = 0; attempt <= 1; attempt++) {
      // 毎分制限(RPM)回避：前のAIリクエストから一定間隔を空ける。待つ間は状態表示。
      setAi(attempt === 0 ? I18N.t('aiQueued') : I18N.t('aiRetry'));
      await aiThrottleWait_();
      setAi(I18N.t('aiRunning'));
      var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + AI_MODEL + ':generateContent?key=' + encodeURIComponent(key);
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' }
        })
      });
      busy = ([500, 502, 503, 504].indexOf(resp.status) !== -1);
      // 混雑系エラーのときだけ再試行。それ以外は抜けて通常判定へ。
      if (!busy) break;
    }
    if (resp.status === 429) { setAi(I18N.t('aiLimit')); fallback(I18N.t('aiLimit')); return; }
    // 混雑・過負荷（500/502/503/504）は、数字やHTTPを見せず「混み合っている」旨のやさしい文言で返す。
    // 下に表示中の読み取り結果を確認・手直しできることも伝える（aiBusyNotice）。
    if (busy || [500, 502, 503, 504].indexOf(resp.status) !== -1) {
      setAi(I18N.t('aiBusyStatus'));
      if (isAiMode && li.__cardApi && li.__cardApi.showAiBusy) li.__cardApi.showAiBusy();
      return;
    }
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
    // 競技方法（試合形式）の補完：schedule.events が空でも shiai_keishiki に値があれば、
    // 空の day_format 欄をそれで埋める。1日開催で events が漏れるケースの保険。
    if (obj.shiai_keishiki) {
      var fmtInputs = li.querySelectorAll('[data-k="day_format"]');
      // 全行が空のときだけ補完（既にAIがscheduleで日別に入れている場合は尊重）
      var allEmpty = Array.prototype.every.call(fmtInputs, function (el) { return !el.value.trim(); });
      if (allEmpty && fmtInputs.length) { fmtInputs[0].value = obj.shiai_keishiki; }
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
      // 参加するにあたって重要な情報（AIが要項ごとに最大5件判断）を重要情報欄に表示
      if (li.__cardApi && li.__cardApi.setKeyInfo) {
        li.__cardApi.setKeyInfo(Array.isArray(obj.key_info) ? obj.key_info : []);
      }
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
  // クラブモード：登録は済んだがマスタ追記だけ失敗した大会（再試行対象）。カレンダー登録は再実行しない＝重複予定を作らない。
  var retryTargets = CLUB_MODE ? items.filter(function (it) { return it.registered && !it.masterAppended && it.fileId; }) : [];
  if (!targets.length && !retryTargets.length) { setMsg(I18N.t('msgNoItems')); regBtn.disabled = false; return; }

  // ② 登録前チェック：チェック済みで開催日が空のカードがあれば警告して中断
  var emptyCards = targets.filter(function (it) { return !it.card.read().kaisai_dates.length; });
  if (emptyCards.length) {
    emptyCards.forEach(function (it) { it.card.markDateEmpty(); });
    setMsg(I18N.t('msgDateEmptyA') + emptyCards.length + I18N.t('msgDateEmptyB'));
    emptyCards[0].card.focusDate();
    regBtn.disabled = false;
    return;
  }

  // ②-2 登録前チェック（クラブモード限定）：出欠フォームに載せるカードなのに、
  // 競技方法欄から種目を1つも取り出せない（masterEvents_が空）ものがあれば、
  // 手入力を促して中断する。空でも競技方法しか無い場合でもメッセージは同一（A案）。
  // 出欠フォームは1項目=1種目で並ぶため、D列（種目）が空だと選択肢を作れないのを防ぐ。
  if (CLUB_MODE) {
    var noEventCards = targets.filter(function (it) {
      if (!it.card.masterOptIn()) return false;   // 「載せない」カードは対象外
      return !masterEvents_(it.card.read().shiai_keishiki_by_day);   // 種目が空なら対象
    });
    if (noEventCards.length) {
      setMsg(I18N.t('msgEventEmptyA') + noEventCards.length + I18N.t('msgEventEmptyB'));
      noEventCards[0].card.focusFormat();
      regBtn.disabled = false;
      return;
    }
  }

  var ok = 0, ng = 0;
  var lastFolderId = null;   // 登録成功時の保存先（メッセージのリンク用に最後の1件を覚える）
  for (var i = 0; i < targets.length; i++) {
    var f = targets[i].card.read();
    try {
      if (!f.taikai_mei) throw new Error('大会名が空です');
      if (!f.kaisai_dates.length) throw new Error('開催日が空です');
      // 案X：登録した瞬間に、確定した 年/月/大会名 フォルダを作って要項を保存する。
      var fileId = targets[i].fileId;
      if (!fileId && targets[i].file) {
        var folderId = await ensureEventFolder_(f.kaisai_dates[0], f.taikai_mei);
        fileId = await uploadOriginal_(targets[i].file, folderId);
        targets[i].fileId = fileId;
        lastFolderId = folderId;
      }
      await createEvent(f, fileId, targets[i].mimeType);   // 要項ファイルを添付
      targets[i].registered = true;              // 登録済み（再実行でスキップ・ファイルは保持）
      targets[i].card.setStatus(I18N.t('stRegistered'), 'ok');
      ok++;
      // クラブ運用モード（?club=hakusan）のときだけ、大会マスタ・シートに1行追記（出欠システム連携）。
      // 追記失敗はカレンダー登録の成否に影響させない（best-effort。状態表示に注記のみ）。
      // 失敗した大会は masterAppended が立たず、もう一度「登録」を押すと追記だけ再試行される。
      if (CLUB_MODE) {
        if (!targets[i].card.masterOptIn()) {
          targets[i].masterAppended = true;   // 「載せない」を選択＝追記対象外（再試行もしない）
        } else {
          try {
            await appendMasterRow_(f, fileId);
            targets[i].masterAppended = true;
          } catch (me) {
            targets[i].masterAppended = false;
            targets[i].card.setStatus(I18N.t('stRegistered') + '（マスタ追記失敗: ' + (me && me.message ? me.message : me) + '。もう一度「登録」を押すと追記だけ再試行します）', 'ok');
          }
        }
      } else {
        targets[i].masterAppended = true;   // 一般モードでは追記対象外＝再試行不要の印
      }
    } catch (e) {
      targets[i].card.setStatus(I18N.t('stFailedPrefix') + (e && e.message ? e.message : e), 'ng');
      ng++;
    }
  }
  // 案X では登録した要項だけを保存するため、未登録要項の後始末（cleanupUnregistered_）は不要。
  // クラブモード：マスタ追記だけ失敗していた大会の再試行（カレンダー登録はしない）
  for (var r = 0; r < retryTargets.length; r++) {
    if (!retryTargets[r].card.masterOptIn()) { retryTargets[r].masterAppended = true; continue; }   // 後からチェックを外した場合も尊重
    try {
      await appendMasterRow_(retryTargets[r].card.read(), retryTargets[r].fileId);
      retryTargets[r].masterAppended = true;
      retryTargets[r].card.setStatus(I18N.t('stRegistered'), 'ok');
      ok++;
    } catch (re) {
      retryTargets[r].card.setStatus(I18N.t('stRegistered') + '（マスタ追記失敗: ' + (re && re.message ? re.message : re) + '。もう一度「登録」を押すと追記だけ再試行します）', 'ok');
    }
  }
  if (ok) {
    var folderUrl = lastFolderId ? 'https://drive.google.com/drive/folders/' + lastFolderId
                  : 'https://drive.google.com/drive/';
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

// ===== クラブ運用時のみ：大会マスタ・シート書き出し（出欠システム連携。案1） =====
// 出欠システムが読む1大会=1行のデータを作る。列：
//   大会名 / 開催日 / 申込締切 / 種目 / 要項ファイルID / 要項リンク / 登録日時
var MASTER_HEADERS = ['大会名', '開催日', '申込締切', '種目', '要項ファイルID', '要項リンク', '登録日時'];

// 締切を単一日付（必着＝終了日）にする。範囲 "A～B" なら B を返す。単一ならそのまま。
function masterDeadline_(shimekiri) {
  if (!shimekiri) return '';
  var parts = String(shimekiri).split(/[~～]/).map(function (s) { return s.trim(); }).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

// 種目候補から「競技方法・進行の説明」を除外する判定。
// 出欠フォームは1項目=1種目として並ぶため、種目でない記述（予選リーグ、決勝トーナメント、
// 競技方法の一文など）が混ざると誤った選択肢になる。種目名には現れにくい競技方法特有の語で弾く。
var NON_EVENT_RE = /(競技方法|試合方法|試合形式|予選|決勝|リーグ戦|トーナメント|勝ち抜け|順位|決定戦|敗者|総当|ラウンドロビン|進出|による)/;
function isEventName_(name) {
  var s = (name || '').trim();
  if (!s) return false;
  if (NON_EVENT_RE.test(s)) return false;   // 競技方法らしい語を含む＝種目でない
  return true;
}

// 種目を「、」区切り文字列にする。合意ルール：全日まとめる（A案）。
// ただし「同名種目が複数日にまたがる」ときだけ、その種目に「N日目 」接頭辞を付けて一意化する。
// f.shiai_keishiki_by_day = [{date, format}]（format自体が「、」区切りの複数種目）を想定。
// 競技方法の説明が混ざっている場合は除外し、種目だけを出す。
function masterEvents_(byDay) {
  var days = (byDay || []).filter(function (d) { return d && d.format && d.format.trim(); });
  if (!days.length) return '';
  // まず各日の種目を配列化し、競技方法（非種目）を除外
  var perDay = days.map(function (d) {
    return d.format.split(/[、,]/).map(function (s) { return s.trim(); }).filter(isEventName_);
  });
  // 全種目を通して出現回数を数え、複数日で同名が出るものを検出
  var count = {};
  perDay.forEach(function (list) {
    var uniqInDay = {};
    list.forEach(function (name) { uniqInDay[name] = true; });
    Object.keys(uniqInDay).forEach(function (name) { count[name] = (count[name] || 0) + 1; });
  });
  var out = [];
  perDay.forEach(function (list, i) {
    list.forEach(function (name) {
      // 同名が2日以上に出る場合だけ「N日目 」を付けて一意化
      out.push(count[name] >= 2 ? ((i + 1) + '日目 ' + name) : name);
    });
  });
  return out.join('、');
}

// 開催日を単一日付にする（複数日開催なら開始日1つ）。f.kaisai_dates は昇順配列を想定。
function masterEventDate_(dates) {
  if (!dates || !dates.length) return '';
  return dates.slice().sort()[0];
}

// 登録データ f と要項fileId から、大会マスタの1行（配列）を作る
function masterRowFromFields_(f, fileId) {
  var flyerLink = fileId ? 'https://drive.google.com/file/d/' + fileId + '/view' : '';
  var stamp = new Date().toISOString();
  return [
    f.taikai_mei || '',
    masterEventDate_(f.kaisai_dates),
    masterDeadline_(f.shimekiri),
    masterEvents_(f.shiai_keishiki_by_day),
    fileId || '',
    flyerLink,
    stamp
  ];
}

// 大会マスタ・シートのIDを確保する。appDataの対応表に 'master_sheet_id' で記録し端末間共有。
// 無ければ新規スプレッドシートを作成し、1行目にヘッダーを書く。
async function ensureMasterSheet_() {
  var map = await getChildFolderMap_();
  var KEY = 'master_sheet_id';
  if (map[KEY]) {
    // 実在確認（ゴミ箱でないか）。消えていたら作り直す。
    if (await folderExists_(map[KEY])) return map[KEY];
    delete map[KEY];
  }
  // 新規スプレッドシート作成（Sheets API）
  var c = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: MASTER_SHEET_TITLE } })
  });
  if (c.status === 401) { accessToken = null; throw new Error(I18N.t('msgSessionExpired')); }
  if (!c.ok) { throw new Error('シート作成 ' + c.status + ': ' + (await c.text()).slice(0, 140)); }
  var sheetId = (await c.json()).spreadsheetId;
  // ヘッダー行を書く
  await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + sheetId +
              '/values/A1:append?valueInputOption=USER_ENTERED', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [MASTER_HEADERS] })
  });
  map[KEY] = sheetId;
  await saveChildFolderMap_(map);
  return sheetId;
}

// 大会1件を大会マスタ・シートの末尾に1行追記する（クラブモード時のみ呼ぶ）
async function appendMasterRow_(f, fileId) {
  var sheetId = await ensureMasterSheet_();
  var row = masterRowFromFields_(f, fileId);
  var r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + sheetId +
                      '/values/A1:append?valueInputOption=USER_ENTERED', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] })
  });
  if (r.status === 401) { accessToken = null; throw new Error(I18N.t('msgSessionExpired')); }
  if (!r.ok) { throw new Error('シート追記 ' + r.status + ': ' + (await r.text()).slice(0, 140)); }
  return sheetId;
}

async function createEvent(f, fileId, mimeType) {
  var dates = f.kaisai_dates.slice().sort();
  // 添付要項へのリンク（保存したファイル自体を指す。フォルダIDに依存しない）
  var fileUrl = fileId ? 'https://drive.google.com/file/d/' + fileId + '/view' : '';

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

  // チェックされた重要情報を「【見出し】内容」改行区切りでまとめる
  var keyInfoText = (f.key_info || []).map(function (it) {
    var lbl = (it.label || '').trim();
    var txt = (it.text || '').trim();
    if (lbl && txt) return '【' + lbl + '】' + txt;
    return lbl ? ('【' + lbl + '】') : txt;
  }).filter(Boolean).join('\n');

  var description = [
    formatText ? I18N.t('descFormat') + formatText : '',
    f.shimekiri ? I18N.t('descDeadline') + f.shimekiri : '',
    f.kaikai_jikan ? I18N.t('descOpening') + f.kaikai_jikan : '',
    keyInfoText ? keyInfoText : '',
    f.note ? I18N.t('descNote') + f.note : '',
    fileId ? I18N.t('descFlyer') + fileUrl + I18N.t('descFlyerTail') : ''
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
