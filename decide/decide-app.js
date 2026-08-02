// decide-app.js — 決めごとドロッパーの画面制御
//
// このツールはAI専用。会話は意味を解釈しないと決定/未決が分けられないため、
// 正規表現モード（既存2本の「通常モード」）は成立しない。
// AI専用の結果、Googleドライブを通らないので **ログインが要らない**。
// カレンダー登録を足す段階（段階3）で、そのときだけログインを求める。
'use strict';

var AI_KEY_STORE = 'dropper_ai_key';   // イベント／予定表ドロッパーと同じ保存先（入れ直しの手間を省く）

function el(id) { return document.getElementById(id); }

var pickedFiles = [];
var lastResult = null;

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

function render(r) {
  lastResult = r;
  renderList_('listDecided', 'emptyDecided', r.decided, function (it) {
    return textRow_(it.text, I18N.t('labWho'), it.who);
  });
  renderList_('listUndecided', 'emptyUndecided', r.undecided, function (it) {
    return textRow_(it.text, I18N.t('labWaiting'), it.waiting);
  });
  renderList_('listTodos', 'emptyTodos', r.todos, function (it) {
    var li = document.createElement('li');
    var p = document.createElement('p');
    p.className = 'row-main';
    p.textContent = it.text;
    li.appendChild(p);
    if (it.who) {
      var w = document.createElement('p');
      w.className = 'row-sub';
      w.textContent = I18N.t('labOwner') + ': ' + it.who;
      li.appendChild(w);
    }
    // 期限は「直した日付」と「会話での言い方」を並べて出す。
    // 相対的な書き方（「来週の火曜」）を直した結果が正しいかは、原文と見比べないと判断できない。
    var d = document.createElement('p');
    d.className = 'row-sub' + (it.due ? '' : ' weak');
    d.textContent = I18N.t('labDue') + ': ' + (it.due || I18N.t('dueUnknown'));
    if (it.dueRaw) d.textContent += '　' + I18N.t('dueFromText', { raw: it.dueRaw });
    li.appendChild(d);
    return li;
  });
  el('result').style.display = '';
}

// コピー用のテキスト。画面の3セクションをそのまま平文にする。
function summaryText(r) {
  var L = [];
  L.push(I18N.t('secDecided'));
  if (!r.decided.length) L.push('・' + I18N.t('emptyDecided'));
  r.decided.forEach(function (it) { L.push('・' + it.text + (it.who ? '（' + I18N.t('labWho') + ': ' + it.who + '）' : '')); });
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
  el('resetBtn').addEventListener('click', function () {
    setFiles([]);
    el('result').style.display = 'none';
    setMsg('');
  });
  el('keyChangeBtn').addEventListener('click', function () { askKey(true); });

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
