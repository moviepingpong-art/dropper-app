// decide-app.js — 決めごとドロッパーの画面制御
//
// このツールはAI専用。会話は意味を解釈しないと決定/未決が分けられないため、
// 正規表現モード（既存2本の「通常モード」）は成立しない。
// AI専用の結果、Googleドライブを通らないので **ログインが要らない**。
// カレンダー登録を足す段階（段階3）で、そのときだけログインを求める。
'use strict';

var AI_KEY_STORE = 'dropper_ai_key';   // イベント／予定表ドロッパーと同じ保存先（入れ直しの手間を省く）

// OAuthはイベント／予定表ドロッパーと同じクライアントID。
// ただし **要求するスコープは calendar.events だけ**。このツールはドライブを使わないので、
// drive.file も appdata も要らない。既存2本より小さい同意で済む。新しいスコープは足さないこと。
var GOOGLE_CLIENT_ID = '924835597048-lf0e4p3f73373ur5pnujac9bcl5cj820.apps.googleusercontent.com';
var SCOPES = 'https://www.googleapis.com/auth/calendar.events';
var CALENDAR_ID = 'primary';
var EVENT_COLOR_ID = '11';   // 赤。シリーズで揃えている

function el(id) { return document.getElementById(id); }

var pickedFiles = [];
var lastResult = null;
var accessToken = null, tokenClient = null, pendingAuth = null;

/* ===== Googleログイン =====
   読み取り・コピーまではログイン不要。カレンダーに登録するときだけ、ここで初めて求める。
   「ログインの壁」を入口に置かないための作り。 */
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
      } else {
        if (pendingAuth) { pendingAuth.reject(new Error('cancelled')); pendingAuth = null; }
      }
    }
  });
  return true;
}
function ensureToken() {
  return new Promise(function (resolve, reject) {
    if (accessToken) { resolve(accessToken); return; }
    // GSIスクリプトは async 読み込みなので、間に合っていないことがある
    if (!ensureTokenClient()) { reject(new Error('preparing')); return; }
    pendingAuth = { resolve: resolve, reject: reject };
    tokenClient.requestAccessToken();
  });
}

/* ===== APIキー ===== */
function savedKey() { try { return localStorage.getItem(AI_KEY_STORE) || ''; } catch (e) { return ''; } }

// 貼り付けた直後に「このキーで本当に使えるか」を返す。イベント／予定表と同じ作り。
// 叩くのは ListModels。generateContent でダミー送信すると無料枠の1日あたり回数を検証だけで消費する。
function testKey(key) {
  var models = (window.DecideAI && window.DecideAI.MODELS) || ['gemini-flash-latest'];
  var url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key);
  return fetch(url).then(function (res) {
    if (res.ok) {
      return res.json().then(function (data) {
        var names = [], list = (data && data.models) || [];
        for (var i = 0; i < list.length; i++) names.push(String(list[i].name || '').replace(/^models\//, ''));
        var model = models[0];
        for (var m = 0; m < models.length; m++) { if (names.indexOf(models[m]) >= 0) { model = models[m]; break; } }
        return { ok: true, model: model };
      }).catch(function () { return { ok: true, model: models[0] }; });
    }
    if (res.status === 400 || res.status === 401) return { ok: false, reason: 'invalid' };
    if (res.status === 403) return { ok: false, reason: 'forbidden' };
    if (res.status === 429) return { ok: false, reason: 'quota' };
    return { ok: false, reason: 'other' };
  }).catch(function () { return { ok: false, reason: 'network' }; });
}

function askKey(force) {
  var have = savedKey();
  if (have && !force) return Promise.resolve(have);
  var modal = el('key-modal'), input = el('keyInput');
  var eyeBtn = el('keyEyeBtn'), checkEl = el('keyCheck');
  return new Promise(function (resolve) {
    var checkTimer = null, checkSeq = 0;

    function setCheck(cls, text) {
      if (!checkEl) return;
      checkEl.className = 'key-check show ' + cls;
      checkEl.textContent = text;
    }
    function clearCheck() {
      if (checkTimer) { clearTimeout(checkTimer); checkTimer = null; }
      checkSeq++;
      if (checkEl) { checkEl.className = 'key-check'; checkEl.textContent = ''; }
    }
    function close(v) {
      modal.classList.remove('show');
      el('keySave').removeEventListener('click', onSave);
      el('keyCancel').removeEventListener('click', onCancel);
      input.removeEventListener('input', onInput);
      if (eyeBtn) eyeBtn.removeEventListener('click', onEye);
      clearCheck();
      input.type = 'password';   // 次に開いたときも伏せた状態から始める
      resolve(v);
    }
    // キーの形が整ってから1回だけ。1文字ごとには叩かない。
    var KEY_SHAPE = /^AIza[\w-]{30,}$/;
    function onInput() {
      var k = (input.value || '').trim();
      clearCheck();
      if (!KEY_SHAPE.test(k)) return;
      setCheck('testing', I18N.t('keyTestRunning'));
      var seq = checkSeq;
      checkTimer = setTimeout(function () {
        testKey(k).then(function (r) {
          if (seq !== checkSeq) return;   // その後に入力が変わっていたら捨てる
          if (r.ok) { setCheck('ok', I18N.t('keyTestOk', { model: r.model })); return; }
          var keys = { invalid: 'keyTestInvalid', forbidden: 'keyTestForbidden', quota: 'keyTestQuota', network: 'keyTestNetwork' };
          setCheck('ng', I18N.t(keys[r.reason] || 'keyTestOther'));
        });
      }, 600);
    }
    function onEye() {
      var toShow = (input.type === 'password');
      input.type = toShow ? 'text' : 'password';
      eyeBtn.textContent = toShow ? '🙈' : '👁';
      eyeBtn.setAttribute('aria-pressed', toShow ? 'true' : 'false');
      eyeBtn.setAttribute('aria-label', I18N.t(toShow ? 'keyHide' : 'keyShow'));
      input.focus();
    }
    function onSave() {
      var k = (input.value || '').trim();
      if (!k) { input.focus(); return; }
      // 接続テストがNGでも保存は通す。通信エラーで保存できないと、そこで詰んでしまう。
      try { localStorage.setItem(AI_KEY_STORE, k); } catch (e) {}
      close(k);
    }
    function onCancel() { close(''); }

    input.value = have || '';
    input.type = 'password';
    if (eyeBtn) {
      eyeBtn.textContent = '👁';
      eyeBtn.setAttribute('aria-pressed', 'false');
      eyeBtn.setAttribute('aria-label', I18N.t('keyShow'));
      eyeBtn.addEventListener('click', onEye);
    }
    clearCheck();
    el('keySave').addEventListener('click', onSave);
    el('keyCancel').addEventListener('click', onCancel);
    input.addEventListener('input', onInput);
    // 保存済みのキーで開いたときは、そのキーがまだ生きているかその場で確かめる
    // （ListModels は無料枠を消費しないので、開くたびに叩いても回数は減らない）。
    if (have) onInput();
    modal.classList.add('show');
    setTimeout(function () { input.focus(); }, 50);
  });
}

/* ===== 画像の受け取り ===== */
function setMsg(t, cls) {
  var m = el('msg');
  m.textContent = t || '';
  m.className = 'msg' + (cls ? ' ' + cls : '');
}

// 受け取るのは画像（スクショ・ノートやホワイトボードの写真）とPDF（FAXやスキャンした議事録）。
// Gemini は PDF をそのまま読めるので、変換は要らない。
function acceptable_(f) {
  return /^image\//.test(f.type) || f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
}

function setFiles(list) {
  pickedFiles = Array.prototype.slice.call(list || []).filter(acceptable_);
  el('picked').textContent = pickedFiles.length ? I18N.t('filesPicked', { n: pickedFiles.length }) : '';
  el('runBtn').disabled = !pickedFiles.length;
}

/* ===== 結果の表示 ===== */
function textRow_(main, subLabel, subValue) {
  var li = document.createElement('li');
  var p = document.createElement('p');
  p.className = 'row-main';
  p.textContent = main;
  li.appendChild(p);
  if (subValue) {
    var s = document.createElement('p');
    s.className = 'row-sub';
    s.textContent = subLabel + ': ' + subValue;
    li.appendChild(s);
  }
  return li;
}

function renderList_(ulId, emptyKey, items, build) {
  var ul = el(ulId);
  ul.innerHTML = '';
  if (!items.length) {
    var li = document.createElement('li');
    li.className = 'empty';
    li.textContent = I18N.t(emptyKey);
    ul.appendChild(li);
    return;
  }
  items.forEach(function (it) { ul.appendChild(build(it)); });
}

// 日付のある行を作る。チェックを出してカレンダー登録の対象にする。
// 直した日付と原文の言い方を並べて出す（相対的な書き方から直した結果を確かめられるように）。
function datedRow_(it, dateKey, rawKey, labelKey, subLabelKey, subValue) {
  var li = document.createElement('li');
  var head = document.createElement('div');
  head.className = 'row-head';
  if (it[dateKey]) {
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'reg-chk';
    cb.checked = true;
    li.__item = { text: it.text, who: it.who, date: it[dateKey], raw: it[rawKey] };
    head.appendChild(cb);
  }
  var p = document.createElement('p');
  p.className = 'row-main';
  p.textContent = it.text;
  head.appendChild(p);
  li.appendChild(head);
  if (subValue) {
    var s = document.createElement('p');
    s.className = 'row-sub';
    s.textContent = I18N.t(subLabelKey) + ': ' + subValue;
    li.appendChild(s);
  }
  var d = document.createElement('p');
  d.className = 'row-sub' + (it[dateKey] ? '' : ' weak');
  d.textContent = I18N.t(labelKey) + ': ' + (it[dateKey] || I18N.t(dateKey === 'due' ? 'dueUnknown' : 'dateUnknown'));
  if (it[rawKey]) d.textContent += '　' + I18N.t('dueFromText', { raw: it[rawKey] });
  li.appendChild(d);
  return li;
}

function render(r) {
  lastResult = r;
  renderList_('listDecided', 'emptyDecided', r.decided, function (it) {
    return datedRow_(it, 'date', 'dateRaw', 'labDate', 'labWho', it.who);
  });
  renderList_('listUndecided', 'emptyUndecided', r.undecided, function (it) {
    return textRow_(it.text, I18N.t('labWaiting'), it.waiting);
  });
  renderList_('listTodos', 'emptyTodos', r.todos, function (it) {
    return datedRow_(it, 'due', 'dueRaw', 'labDue', 'labOwner', it.who);
  });
  // 済んだことは控えとして出すだけ。チェックを付けないので、カレンダー登録の対象に入らない。
  renderList_('listRecords', 'emptyRecords', r.records, function (it) {
    var li = document.createElement('li');
    var p = document.createElement('p');
    p.className = 'row-main';
    p.textContent = it.text;
    li.appendChild(p);
    if (it.date || it.dateRaw) {
      var d = document.createElement('p');
      d.className = 'row-sub';
      d.textContent = I18N.t('labDate') + ': ' + (it.date || I18N.t('dateUnknown'));
      if (it.dateRaw) d.textContent += '　' + I18N.t('dueFromText', { raw: it.dateRaw });
      li.appendChild(d);
    }
    return li;
  });
  el('result').style.display = '';
  // 登録ボタンは、日付のある項目が「決まったこと」「やること」のどちらかに1件でもあるときだけ出す
  var hasDated = r.decided.some(function (it) { return !!it.date; })
              || r.todos.some(function (it) { return !!it.due; });
  el('regWrap').style.display = hasDated ? '' : 'none';
  el('regMsg').textContent = '';
}

/* ===== カレンダー登録 ===== */
function addDay_(ymd) {
  var d = new Date(ymd + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

// 登録用に整えた形（{text, who, date, raw}）を受け取る。決まったこと・やることで同じ形にしてある。
function buildEvent_(it) {
  // 日付だけで時刻を伴わないので終日予定にする。終了日は+1（Google側が排他的に扱うため）。
  var ev = {
    summary: it.text,
    colorId: EVENT_COLOR_ID,
    start: { date: it.date },
    end: { date: addDay_(it.date) }
  };
  var desc = [];
  if (it.who) desc.push(it.who);
  // 相対的な書き方や期間から直した日付なので、元の言い方も残しておく（後から検証できるように）
  if (it.raw) desc.push(I18N.t('dueFromText', { raw: it.raw }));
  desc.push(I18N.t('evFrom'));
  ev.description = desc.join('\n');
  return ev;
}

// 決まったこと・やることの両方から、チェックの入っている行を集める
function regTargets_() {
  var out = [];
  ['listDecided', 'listTodos'].forEach(function (id) {
    var lis = el(id).querySelectorAll('li');
    for (var i = 0; i < lis.length; i++) {
      var cb = lis[i].querySelector('.reg-chk');
      if (cb && cb.checked && lis[i].__item) out.push({ cb: cb, it: lis[i].__item });
    }
  });
  return out;
}

async function register() {
  var targets = regTargets_();
  if (!targets.length) { el('regMsg').textContent = I18N.t('msgRegNoTarget'); return; }

  el('regBtn').disabled = true;
  el('regMsg').textContent = I18N.t('msgSigningIn');
  try {
    await ensureToken();
  } catch (e) {
    var c = String(e && e.message);
    el('regMsg').textContent = I18N.t(c === 'preparing' ? 'msgLoginPreparing' : c === 'cancelled' ? 'msgLoginCancelled' : 'msgLoginFailed');
    el('regBtn').disabled = false;
    return;
  }

  var ok = 0, ng = 0;
  for (var i = 0; i < targets.length; i++) {
    el('regMsg').textContent = I18N.t('msgRegistering', { i: i + 1, n: targets.length });
    try {
      var res = await fetch('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(CALENDAR_ID) + '/events', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildEvent_(targets[i].it))
      });
      // 期限切れの判定は合言葉で行う。文言そのもので判定すると多言語化で壊れる。
      if (res.status === 401) { accessToken = null; throw new Error('expired'); }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      ok++;
      targets[i].cb.checked = false;   // 二重登録を防ぐ
      targets[i].cb.disabled = true;
    } catch (e2) {
      ng++;
      if (String(e2 && e2.message) === 'expired') { el('regMsg').textContent = I18N.t('msgSessionExpired'); break; }
    }
  }
  if (String(el('regMsg').textContent) !== I18N.t('msgSessionExpired')) {
    el('regMsg').textContent = I18N.t('msgRegDone', { ok: ok }) + (ng ? I18N.t('msgRegFail', { ng: ng }) : '');
  }
  el('regBtn').disabled = false;
}

// コピー用のテキスト。画面の3セクションをそのまま平文にする。
function summaryText(r) {
  var L = [];
  L.push(I18N.t('secDecided'));
  if (!r.decided.length) L.push('・' + I18N.t('emptyDecided'));
  r.decided.forEach(function (it) {
    var s = '・' + it.text;
    if (it.date) s += ' ／ ' + I18N.t('labDate') + ': ' + it.date;
    if (it.who) s += ' ／ ' + I18N.t('labWho') + ': ' + it.who;
    L.push(s);
  });
  L.push('');
  L.push(I18N.t('secUndecided'));
  if (!r.undecided.length) L.push('・' + I18N.t('emptyUndecided'));
  r.undecided.forEach(function (it) { L.push('・' + it.text + (it.waiting ? '（' + I18N.t('labWaiting') + ': ' + it.waiting + '）' : '')); });
  L.push('');
  L.push(I18N.t('secTodos'));
  if (!r.todos.length) L.push('・' + I18N.t('emptyTodos'));
  r.todos.forEach(function (it) {
    var s = '・' + it.text;
    if (it.who) s += ' ／ ' + I18N.t('labOwner') + ': ' + it.who;
    s += ' ／ ' + I18N.t('labDue') + ': ' + (it.due || I18N.t('dueUnknown'));
    if (it.dueRaw) s += '（' + I18N.t('dueFromText', { raw: it.dueRaw }) + '）';
    L.push(s);
  });
  if (r.records.length) {
    L.push('');
    L.push(I18N.t('secRecords'));
    r.records.forEach(function (it) {
      var s = '・' + it.text;
      if (it.date) s += ' ／ ' + I18N.t('labDate') + ': ' + it.date;
      else if (it.dateRaw) s += ' ／ ' + I18N.t('dueFromText', { raw: it.dateRaw });
      L.push(s);
    });
  }
  return L.join('\n');
}

/* ===== 読み取り ===== */
var STATUS_KEYS = { queued: 'msgQueued', running: 'msgRunning', retry: 'msgRetry' };
var ERROR_KEYS = {
  'no-key': 'msgNoKey', 'no-file': 'msgNoFiles', 'too-many': 'msgTooMany', 'too-large': 'msgTooLarge',
  'rate-minute': 'msgRateMinute', 'rate-day': 'msgRateDay', 'busy': 'msgBusy', 'bad-json': 'msgBadJson'
};

async function run() {
  if (!pickedFiles.length) { setMsg(I18N.t('msgNoFiles'), 'ng'); return; }
  var key = await askKey(false);
  if (!key) { setMsg(I18N.t('msgNoKey'), 'ng'); return; }

  el('runBtn').disabled = true;
  el('result').style.display = 'none';
  try {
    var r = await window.DecideAI.extract(pickedFiles, {
      apiKey: key,
      baseDate: el('baseDate').value || '',
      lang: window.LANG,
      onStatus: function (s) { if (STATUS_KEYS[s]) setMsg(I18N.t(STATUS_KEYS[s]), 'wait'); }
    });
    render(r);
    setMsg(I18N.t('msgDone'), 'ok');
  } catch (e) {
    var code = (e && e.message) ? e.message : '';
    setMsg(ERROR_KEYS[code] ? I18N.t(ERROR_KEYS[code]) : (I18N.t('msgError') + code), 'ng');
  }
  el('runBtn').disabled = false;
}

/* ===== 配線 ===== */
(function wire() {
  var drop = el('drop'), fileInput = el('fileInput');

  el('pickBtn').addEventListener('click', function () { fileInput.value = ''; fileInput.click(); });
  fileInput.addEventListener('change', function (e) { setFiles(e.target.files); });

  drop.addEventListener('click', function () { fileInput.value = ''; fileInput.click(); });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) setFiles(e.dataTransfer.files);
  });

  el('runBtn').addEventListener('click', run);
  el('keyChangeBtn').addEventListener('click', function () { askKey(true); });
  el('regBtn').addEventListener('click', register);

  el('copyBtn').addEventListener('click', function () {
    if (!lastResult) return;
    var txt = summaryText(lastResult);
    var done = function () {
      var b = el('copyBtn'), old = b.textContent;
      b.textContent = I18N.t('copiedBtn');
      setTimeout(function () { b.textContent = old; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, done);
    } else { done(); }
  });

  // 基準日の既定は今日。「来週の火曜」を直す起点になるので、空のままにしない。
  var d = new Date();
  el('baseDate').value = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  el('runBtn').disabled = true;
})();
