// app.js — ドロッパー（Web版・フェーズ1）GoogleドライブOCR版
'use strict';

/* ===== 設定（ここだけ書き換える） ===== */
var GOOGLE_CLIENT_ID = '924835597048-lf0e4p3f73373ur5pnujac9bcl5cj820.apps.googleusercontent.com';
// Drive（OCR用・アプリが作ったファイルのみ）＋ Calendar（予定作成）の最小権限
var SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events';
var CALENDAR_ID = 'primary';
var EVENT_COLOR_ID = '11';   // 赤
var OCR_LANG = 'ja';         // GoogleドライブOCRの言語（日本語）
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
    subtitle: 'スポーツ大会の要項ドロッパー',
    lead: '要項（PDF・画像）をドロップ → 内容を確認 → Googleカレンダーに登録',
    useSportSelector: true
  }
  // 例：今後追加する種類
  // school: { subtitle:'学校行事のプリントをドロップして予定に', lead:'プリントをドロップ → 内容を確認 → カレンダーに登録', useSportSelector:false }
};
var DEFAULT_TYPE = 'sports';
var currentType = DEFAULT_TYPE;

// 競技セレクタを生成（先頭に「自動判定」、続いて各競技。既定は卓球・バドミントン）
(function buildSportSelector() {
  if (!sportSel || !window.Dropper) return;
  var opts = '<option value="auto">自動判定（おまかせ）</option>';
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
    opts += '<option value="' + key + '">' + DROPPER_TYPES[key].subtitle + '</option>';
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
  if (leadEl && t.lead) leadEl.textContent = t.lead;
  if (sportRow) sportRow.style.display = t.useSportSelector ? '' : 'none';
}

/* ===== 入力（ドロップ / 選択） ===== */
// クリック選択は廃止（Googleログインポップアップがブラウザにブロックされるため）。ドロップのみ対応。
['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
drop.addEventListener('drop', function (e) { popAnim(); handleFiles(e.dataTransfer.files); });
regBtn.addEventListener('click', onRegisterClick);

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
        if (pendingAuth) { pendingAuth.reject(new Error('ログインがキャンセルされました')); pendingAuth = null; }
      }
    }
  });
  return true;
}
function ensureToken() {
  return new Promise(function (resolve, reject) {
    if (accessToken) { resolve(accessToken); return; }
    if (!ensureTokenClient()) { reject(new Error('Googleログインの準備中です。数秒後にもう一度お試しください。')); return; }
    pendingAuth = { resolve: resolve, reject: reject };
    tokenClient.requestAccessToken();
  });
}

/* ===== ドロップ処理 ===== */
async function handleFiles(fileList) {
  var files = Array.prototype.slice.call(fileList || []);
  if (!files.length) { unpopAnim(); return; }
  setMsg('Googleにログインします…（初回のみ）');
  try { await ensureToken(); }
  catch (e) { setMsg(e && e.message ? e.message : 'ログインに失敗しました'); unpopAnim(); return; }
  setMsg('');
  for (var i = 0; i < files.length; i++) { await processOne(files[i]); }
  unpopAnim();   // 結果カード（登録画面）が出たので拡大を解除して元に戻す
  if (items.length) bar.style.display = 'flex';
}

async function processOne(file) {
  var card = addCard(file.name);
  try {
    card.setStatus('読み取り中…（Googleで変換）', 'wait');
    var res = await ocrViaDrive(file);
    var fields = window.Dropper.parse(res.text, sportSel ? sportSel.value : undefined);
    card.fill(fields);
    items.push({ file: file, card: card, fileId: res.fileId, mimeType: res.mimeType });
  } catch (e) {
    card.setStatus('失敗: ' + (e && e.message ? e.message : e), 'ng');
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
    if (check.status === 401) { accessToken = null; throw new Error('ログインの期限切れです。ファイルを入れ直してください。'); }
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
  if (c.status === 401) { accessToken = null; throw new Error('ログインの期限切れです。ファイルを入れ直してください。'); }
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
  if (up.status === 401) { accessToken = null; throw new Error('ログインの期限切れです。ファイルを入れ直してください。'); }
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
  if (up.status === 401) { accessToken = null; throw new Error('ログインの期限切れです。ファイルを入れ直してください。'); }
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
    '<div class="hd"><label class="chk"><input type="checkbox" checked> <span class="fn"></span></label><span class="st wait">読み取り中…</span></div>' +
    '<div class="fields" style="display:none">' +
    '<p class="edit-hint">内容を確認してください。訂正、追加等はそのまま入力欄で書き換え可能です。メモ・備考欄にコメントの追加もできます。</p>' +
    fieldHtml('大会名', 'taikai_mei') +
    fieldHtml('開催日（YYYY-MM-DD、複数はカンマ区切り）', 'kaisai_dates') +
    fieldHtml('会場', 'kaijo') +
    fieldHtml('住所', 'kaijo_jusho') +
    fieldHtml('開会式', 'kaikai_jikan') +
    fieldHtml('試合形式', 'shiai_keishiki') +
    fieldHtml('申込締切', 'shimekiri') +
    fieldHtml('メモ・備考', 'note') +
    '</div>';
  li.querySelector('.fn').textContent = name;
  list.appendChild(li);
  var stEl = li.querySelector('.st');

  return {
    el: li,
    setStatus: function (t, cls) { stEl.textContent = t; stEl.className = 'st ' + (cls || 'wait'); },
    fill: function (fields) {
      stEl.textContent = '読み取り完了'; stEl.className = 'st ok';
      li.querySelector('.fields').style.display = 'block';
      setVal(li, 'taikai_mei', fields.taikai_mei);
      setVal(li, 'kaisai_dates', (fields.kaisai_dates || []).join(', '));
      setVal(li, 'kaijo', fields.kaijo);
      setVal(li, 'kaijo_jusho', fields.kaijo_jusho);
      setVal(li, 'kaikai_jikan', fields.kaikai_jikan);
      setVal(li, 'shiai_keishiki', fields.shiai_keishiki);
      setVal(li, 'shimekiri', fields.shimekiri);
      setVal(li, 'note', fields.note);
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
    }
  };
}
function fieldHtml(label, key) {
  return '<label class="f"><span>' + label + '</span><input data-k="' + key + '" type="text"></label>';
}
function setVal(li, k, v) { var el = li.querySelector('[data-k="' + k + '"]'); if (el) el.value = v || ''; }
function getVal(li, k) { var el = li.querySelector('[data-k="' + k + '"]'); return el ? el.value : ''; }

/* ===== 登録 ===== */
function onRegisterClick() {
  regBtn.disabled = true;
  doRegister().catch(function (e) { setMsg('エラー: ' + (e && e.message ? e.message : e)); regBtn.disabled = false; });
}
async function doRegister() {
  await ensureToken();
  var targets = items.filter(function (it) { return it.card.isChecked() && !it.registered; });
  if (!targets.length) { setMsg('登録する項目がありません。'); regBtn.disabled = false; return; }
  var ok = 0, ng = 0;
  for (var i = 0; i < targets.length; i++) {
    var f = targets[i].card.read();
    try {
      if (!f.taikai_mei) throw new Error('大会名が空です');
      if (!f.kaisai_dates.length) throw new Error('開催日が空です');
      await createEvent(f, targets[i].fileId, targets[i].mimeType);   // 要項ファイルを添付
      targets[i].registered = true;              // 登録済み（再実行でスキップ・ファイルは保持）
      targets[i].card.setStatus('登録しました（要項を添付）', 'ok');
      ok++;
    } catch (e) {
      targets[i].card.setStatus('登録失敗: ' + (e && e.message ? e.message : e), 'ng');
      ng++;
    }
  }
  await cleanupUnregistered_();   // 登録しなかった（チェックを外した）要項はDropperFilesから削除
  if (ok) {
    var folderUrl = dropperFolderId ? 'https://drive.google.com/drive/folders/' + dropperFolderId : 'https://drive.google.com/drive/';
    msg.innerHTML =
      ok + ' 件を登録しました。要項はGoogleドライブの' +
      '<a href="' + folderUrl + '" target="_blank" rel="noopener">DropperFilesフォルダ</a>' +
      'に保存し、カレンダーの予定に添付しています。このフォルダのファイルを削除するとカレンダーの添付も消えます。' +
      (ng ? '　' + ng + ' 件は失敗。' : '');
  } else {
    setMsg(ng ? ng + ' 件の登録に失敗しました。' : '登録する項目がありません。');
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
    f.shiai_keishiki ? '試合形式: ' + f.shiai_keishiki : '',
    f.shimekiri ? '申込締切: ' + f.shimekiri : '',
    f.kaikai_jikan ? '開会式: ' + f.kaikai_jikan : '',
    f.note ? '備考: ' + f.note : '',
    fileId ? '要項: Googleドライブ DropperFilesフォルダ ( ' + folderUrl + ' )\n※フォルダのファイルを削除するとこの添付も消えます。' : ''
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
  if (res.status === 401) { accessToken = null; throw new Error('ログインの期限切れです。もう一度「登録」を押してください。'); }
  if (!res.ok) { var t = await res.text(); throw new Error('カレンダーAPI ' + res.status + ': ' + t.slice(0, 140)); }
  return await res.json();
}
