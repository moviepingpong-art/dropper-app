// entry-app.js — 申込書ドロッパーの画面
//
// 流れ: ① 名簿（このツールで作る・前に保存したファイルを開く）② 申込書（名前だけ書いた Excel）
//       ③ 名前の確認（欄の対応は見出しの規則で作る。画面の段は無い）④ 書き込む内容の確認 ⑤ 保存
//       ※ HTML の id は stepNames / stepReview / stepSave のまま（見出しの番号だけ振り直した）
//
// ★ 名簿も申込書も、端末の外に出さない。通信するのは entry-postal.js が郵便番号データを読むときだけ。
//   名簿の中身を console に出さないこと。画面に出すのは本人の端末の中だけ。
// ★ 名簿は覚えない（localStorage に入れない）。端末に覚えるのは、様式ごとの書き方の選び直し・西暦／和暦の選択・縮小のチェックだけ。
// ★ 文言は entry-i18n.js。値（名前・住所など）は textContent で入れる（innerHTML を使わない）。
(function () {
  'use strict';

  var X = window.EntryXlsx, R = window.EntryRoster, M = window.EntryMap,
      B = window.EntryBook, P = window.EntryPostal, A = window.EntryAttend, BL = window.EntryBlank;

  function t(k, v) { return window.I18N.t(k, v); }
  function has(k) { return Object.prototype.hasOwnProperty.call(window.I18N.dict(), k); }
  function el(id) { return document.getElementById(id); }
  function h(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v;
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function setMsg(id, text, cls) {
    var m = el(id);
    if (!m) return;
    m.textContent = text || '';
    m.className = 'msg' + (cls ? ' ' + cls : '');
  }

  // エラーは文言ではなく code で判定する
  function errText(e) {
    var code = (e && e.code) || (e && e.message) || String(e);
    return has('err.' + code) ? t('err.' + code) : t('err.other', { code: code });
  }
  function ymdText(b) { return b ? t('dateText', { y: b.y, m: b.m, d: b.d }) : t('noBirth'); }
  function byPos(a, b) { return a.n.row - b.n.row || a.n.col - b.n.col; }

  // book: 名簿ファイルの中身（作業中のもの）／roster: 名前の突き合わせに使う形／dirty: 保存していない変更
  // autoPostal: こちらが住所から入れた郵便番号（本人が入れた番号は勝手に書き換えないための目印）
  var state = { form: null, book: null, roster: null, sheets: [], tab: null, editing: null, filter: '', dirty: false,
    autoPostal: null, kanaTouched: {} };

  /* ===== ② 申込書 ===== */
  function readFile(file) {
    return file.arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  function onForm(file) {
    state.form = null;
    state.sheets = [];
    hideFrom('stepNames');
    if (/\.xls$/i.test(file.name)) { setMsg('formMsg', t('err.xls-or-password'), 'ng'); return; }
    setMsg('formMsg', t('reading'), 'wait');
    readFile(file).then(function (bytes) {
      return X.open(bytes).then(function (book) {
        state.form = { name: file.name, bytes: bytes, book: book };
        setMsg('formMsg', t('formOk', { name: file.name, n: book.sheets.length }), 'ok');
        analyze();
      });
    }).catch(function (e) { setMsg('formMsg', errText(e), 'ng'); });
  }

  /* ===== ① 名簿（このツールで作る） ===== */
  // ★ 2026-09-16: 団体ごとに名簿の形がばらばらなので、手持ちの名簿を読み取るのをやめ、
  //   決まった形の名簿ファイルをこの画面で作る（entry-book.js）。
  // ★ ブラウザには覚えない。保存していない変更があるうちは、閉じる前にブラウザが確認する。
  var GENDERS = B.SHEETS;

  function todayText() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function todayYmd() {
    var d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
  function toKatakana(s) {
    return String(s || '').replace(/[ぁ-ゖ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); });
  }

  function openRoster(data, msg) {
    state.book = data;
    state.tab = GENDERS[0];
    state.editing = null;
    state.filter = '';
    state.dirty = false;
    el('rosterEditor').hidden = false;
    el('orgInput').value = data.org || '';   // 開いた名簿の団体名を入力欄に戻す（保存するファイル名になる）
    setMsg('rosterMsg', msg || '', 'ok');
    renderRoster();
    rebuildRoster();
  }

  // 名簿が変わったら、申込書との突き合わせもやり直す
  function rebuildRoster() {
    state.roster = state.book ? B.toRoster(state.book.people) : null;
    analyze();
  }
  function markDirty() {
    state.dirty = true;
    renderRoster();
  }
  function peopleOf(g) { return (state.book.people[g] || []); }

  function onRosterFile(file) {
    if (state.dirty && !window.confirm(t('rosterDropConfirm'))) return;
    setMsg('rosterMsg', t('reading'), 'wait');
    if (/\.xls$/i.test(file.name)) { setMsg('rosterMsg', t('err.xls-or-password'), 'ng'); return; }
    readFile(file).then(function (bytes) {
      return X.open(bytes).then(function (book) {
        var r = B.read(book);
        if (!r.ok) {
          var err = new Error(r.code);
          err.code = r.code;
          err.detail = r.detail;
          throw err;
        }
        var n = GENDERS.reduce(function (s, g) { return s + (r.people[g] || []).length; }, 0);
        openRoster({ org: r.org, people: r.people, extraHeaders: r.extraHeaders },
          t('rosterFileOk', { name: file.name, n: n }));
      });
    }).catch(function (e) {
      // どのセルの見出しが違うかは、直しようがあるので出す（シート名は文言に入っているので足さない）
      setMsg('rosterMsg', errText(e) + (e && e.code === 'book-header' && e.detail ? '（' + e.detail + '）' : ''), 'ng');
    });
  }

  function onNewRoster() {
    if (state.dirty && !window.confirm(t('rosterDropConfirm'))) return;
    openRoster(B.blank(), t('rosterNewMsg'));
  }

  // ★ 名簿づくりをやめて、①の選び直しに戻る（2026-09-20、本人の指摘）。
  //   出欠システムの箱には「やめる」があるのに、名簿編集には閉じる手段が無かった。
  //   ★ 名簿を閉じたら③以降も畳む。名簿が無いまま名前の確認だけ残ると、辻褄が合わない
  function onCloseRoster() {
    if (state.dirty && !window.confirm(t('rosterCloseConfirm'))) return;
    state.book = null;
    state.editing = null;
    state.dirty = false;
    el('rosterEditor').hidden = true;
    el('attendBox').hidden = true;
    state.attend = null;
    el('orgInput').value = '';
    rebuildRoster();                       // state.roster を消し、③以降を作り直す
    hideFrom('stepNames');
    setMsg('rosterMsg', t('rosterClosed'), 'ok');
    el('rosterDrop').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ===== 一覧 =====
  function personName(p) { return [p.family, p.given].filter(Boolean).join(' '); }
  function personKana(p) { return [p.kanaFamily, p.kanaGiven].filter(Boolean).join(' '); }
  function birthLabel(p) {
    if (!p.birth) return p.birthText || '';
    var age = R.ageAt(p.birth, todayYmd());
    return t('birthWithAge', { y: p.birth.y, m: p.birth.m, d: p.birth.d, age: age });
  }
  function addressLabel(p) { return [p.pref, p.address].filter(Boolean).join(''); }

  function matchesFilter(p) {
    var q = state.filter;
    if (!q) return true;
    return (personName(p) + personKana(p) + addressLabel(p)).indexOf(q) >= 0;
  }

  function renderRoster() {
    var box = clear(el('rosterBody'));
    if (!state.book) return;

    // 男子・女子の切り替え
    var tabs = h('div', { class: 'tabs' });
    GENDERS.forEach(function (g) {
      tabs.appendChild(h('button', { type: 'button', class: 'tab' + (state.tab === g ? ' on' : ''),
        text: t('tabCount', { g: g, n: peopleOf(g).length }),
        onclick: function () { state.tab = g; state.editing = null; renderRoster(); } }));
    });
    box.appendChild(tabs);

    var list = peopleOf(state.tab);
    var shown = list.filter(matchesFilter);
    var filter = h('input', { type: 'text', class: 'filter', value: state.filter, placeholder: t('filterPlaceholder'),
      oninput: function (ev) { state.filter = ev.target.value; renderRoster(); } });
    box.appendChild(h('div', { class: 'list-head' }, [filter,
      h('span', { class: 'hint', text: t('listCount', { n: shown.length, all: list.length }) })]));

    if (!list.length) {
      box.appendChild(h('p', { class: 'hint', text: t('listEmpty') }));
    } else if (!shown.length) {
      box.appendChild(h('p', { class: 'hint', text: t('listNoMatch', { q: state.filter }) }));
    } else {
      var table = h('table', { class: 'roster' });
      var head = h('tr', {}, [t('colName'), t('colKana'), t('colBirth'), t('colAddress'), t('colPhone'), '']
        .map(function (x) { return h('th', { text: x }); }));
      table.appendChild(h('thead', {}, [head]));
      var tbody = h('tbody');
      shown.forEach(function (p) {
        var i = list.indexOf(p);
        var probs = B.problemsOf(p);
        var nameCell = h('td', {}, [h('span', { text: personName(p) })]);
        if (probs.length) {
          nameCell.appendChild(h('span', { class: 'warn-mark', text: ' ⚠',
            title: probs.map(function (c) { return t('prob.' + c); }).join('／') }));
        }
        tbody.appendChild(h('tr', {}, [
          nameCell,
          h('td', { text: personKana(p) }),
          h('td', { text: birthLabel(p) }),
          h('td', { text: addressLabel(p) }),
          h('td', { text: p.phone || '' }),
          h('td', { class: 'row-btns' }, [
            h('button', { type: 'button', class: 'link-btn', text: t('editBtn'),
              onclick: function () { state.editing = { gender: state.tab, index: i }; renderRoster(); } }),
            h('button', { type: 'button', class: 'link-btn', text: t('deleteBtn'),
              onclick: function () {
                if (!window.confirm(t('deleteConfirm', { name: personName(p) }))) return;
                list.splice(i, 1);
                state.editing = null;
                markDirty();
                rebuildRoster();
              } })
          ])
        ]));
      });
      table.appendChild(tbody);
      box.appendChild(h('div', { class: 'table-wrap' }, [table]));
    }

    box.appendChild(state.extraOpen ? extraBox() : extraRow());

    if (state.editing) box.appendChild(personForm());
    else {
      box.appendChild(h('div', { class: 'btns' }, [
        h('button', { type: 'button', text: t('addBtn', { g: state.tab }),
          onclick: function () { state.editing = { gender: state.tab, index: null }; renderRoster(); } })
      ]));
    }

    // 保存
    var saveRow = h('div', { class: 'btns' }, [
      h('button', { type: 'button', class: state.dirty ? '' : 'btn-sub', text: t('rosterSaveBtn'), onclick: saveRosterFile })
    ]);
    box.appendChild(h('p', { class: state.dirty ? 'dirty' : 'hint',
      text: state.dirty ? t('rosterDirty') : t('rosterSaveNote') }));
    box.appendChild(saveRow);
  }

  // ★ 名簿の項目を増やせるようにする（2026-09-20、本人の要望）。
  //   競技や文化活動によって要る項目が違う。本物の様式15ファイルを機械で調べて、
  //   いちばん多かったのが「所属」（3ファイル・12回）。ほかに学年・在住市町村・勤務先会社名・背番号。
  //   調べた範囲では、バレー/バスケ＝背番号・身長・ポジション、吹奏楽＝学校名・学年・パート、
  //   囲碁将棋＝段位級位・学校名、文化祭＝所属団体。
  //   ★ 増やした項目は、申込書の**同じ見出し**の欄にだけ書く（見出しの語で当てにいかない）。
  //     当てにいくと「勤務先所在地 → 自宅住所」のような誤爆が増える（本物のシニアフェスタで発覚）
  var EXTRA_PRESETS = ['所属', '学校名', '会社名', '学年', '身長', '段位・級位', '背番号',
    'パート・ポジション', '緊急連絡先'];

  function extraNames() {
    if (!state.book) return [];
    var eh = state.book.extraHeaders || {};
    return (eh[state.tab] || []).slice();
  }

  // ★ どの組にも同じ項目を足す（名簿ファイルの形をそろえる。p.extras は番号で並ぶため）
  function addExtra(name) {
    name = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
    if (!name) { setMsg('rosterMsg', t('extraBad'), 'ng'); return false; }
    if (name.length > 20) name = name.slice(0, 20);
    var eh = state.book.extraHeaders = state.book.extraHeaders || {};
    var dup = false;
    GENDERS.forEach(function (g) {
      eh[g] = eh[g] || [];
      if (eh[g].indexOf(name) >= 0) dup = true;
    });
    if (dup) { setMsg('rosterMsg', t('extraDup'), 'ng'); return false; }
    GENDERS.forEach(function (g) { eh[g].push(name); });
    markDirty();
    return true;
  }

  function removeExtra(i) {
    var eh = state.book.extraHeaders || {};
    GENDERS.forEach(function (g) {
      if (!eh[g] || i >= eh[g].length) return;
      eh[g].splice(i, 1);
      (state.book.people[g] || []).forEach(function (p) {
        if (p.extras && i < p.extras.length) p.extras.splice(i, 1);
      });
    });
    markDirty();
  }

  // 「項目を足す」の一覧（一度に1つ足す。その他は自分で入力）
  function extraBox() {
    var box = h('div', { class: 'extra-box' });
    box.appendChild(h('p', { class: 'sub-title', text: t('extraPick') }));
    var list = h('div', { class: 'extra-list' });
    EXTRA_PRESETS.forEach(function (name) {
      list.appendChild(h('button', { type: 'button', class: 'btn-sub', text: name,
        onclick: function () {
          if (!addExtra(name)) return;
          state.extraOpen = false;
          rebuildRoster();
          renderRoster();   // ★ markDirty() が先に描いているので、閉じたあともう一度描く
          setMsg('rosterMsg', t('extraAdded', { name: name }), 'ok');
        } }));
    });
    box.appendChild(list);
    var other = h('input', { type: 'text', class: 'filter', placeholder: t('extraOtherPh'), maxlength: '20' });
    box.appendChild(h('div', { class: 'list-head' }, [other,
      h('button', { type: 'button', class: 'btn-sub', text: t('extraAddBtn'),
        onclick: function () {
          var name = other.value;
          if (!addExtra(name)) return;
          state.extraOpen = false;
          rebuildRoster();
          renderRoster();   // ★ markDirty() が先に描いているので、閉じたあともう一度描く
          setMsg('rosterMsg', t('extraAdded', { name: name.trim() }), 'ok');
        } }),
      h('button', { type: 'button', class: 'link-btn', text: t('extraCancel'),
        onclick: function () { state.extraOpen = false; renderRoster(); } })]));
    box.appendChild(h('p', { class: 'hint', text: t('extraNote') }));
    return box;
  }

  // いま足してある項目の並び（消せる）
  function extraRow() {
    var row = h('p', { class: 'small extra-row' }, [h('span', { text: t('extraTitle') }),
      h('span', { class: 'extra-base', text: t('extraBase') })]);
    extraNames().forEach(function (name, i) {
      row.appendChild(h('span', { class: 'extra-chip' }, [
        h('span', { text: name }),
        h('button', { type: 'button', class: 'link-btn', text: '✕', title: t('extraRemove'),
          onclick: function () {
            if (!window.confirm(t('extraRemoveConfirm', { name: name }))) return;
            removeExtra(i);
            rebuildRoster();
          } })]));
    });
    row.appendChild(h('button', { type: 'button', class: 'btn-sub extra-add', text: t('extraAdd'),
      onclick: function () { state.extraOpen = true; renderRoster(); } }));
    return row;
  }

  // ===== 1人ぶんの入力 =====
  var PF = ['family', 'given', 'kanaFamily', 'kanaGiven', 'birthText', 'postal', 'pref', 'address', 'phone'];

  function editingPerson() {
    var e = state.editing;
    if (e.index == null) {
      var blankPerson = { family: '', given: '', kanaFamily: '', kanaGiven: '', birthText: '',
        postal: '', pref: '', address: '', phone: '', extras: [] };
      if (e.prefill) Object.keys(e.prefill).forEach(function (k) { blankPerson[k] = e.prefill[k]; });
      return blankPerson;
    }
    var p = peopleOf(e.gender)[e.index];
    var copy = { extras: (p.extras || []).slice() };
    PF.forEach(function (k) { copy[k] = k === 'birthText' ? (p.birth ? p.birth.y + '/' + p.birth.m + '/' + p.birth.d : (p.birthText || '')) : (p[k] || ''); });
    return copy;
  }

  // ★ 姓・名を打つと、セイ・メイが入る（2026-09-16、本人の要望）。
  //   漢字から読みは分からないので、**日本語入力の変換前の読み**を拾う（confirm する直前の ひらがな）。
  //   変換が始まると候補（漢字）が来るので、**ひらがなだけの間の文字を覚えておき**、確定したときにカタカナで足す。
  //   ローマ字入力・かな入力のどちらでも効く。貼り付けや、日本語入力を使わない入力では入らない（そのときは手で）。
  //   フリガナの欄を自分で打った人には、もう触らない。
  function wireKana(nameId, kanaId) {
    var name = el(nameId), kana = el(kanaId);
    if (!name || !kana) return;
    var reading = '', before = '';
    name.addEventListener('compositionstart', function () { reading = ''; before = name.value; });
    name.addEventListener('compositionupdate', function (ev) {
      var s = String(ev.data == null ? '' : ev.data);
      if (s && /^[ぁ-んーゝゞ・]+$/.test(s)) reading = s;   // 変換前のよみだけ覚える
    });
    name.addEventListener('compositionend', function () {
      if (!reading || state.kanaTouched[kanaId]) { reading = ''; return; }
      // 打ち足したのか、打ち直したのか。打ち直し（前の名前が頭に残っていない）なら、フリガナも入れ直す
      var added = before && name.value.indexOf(before) === 0;
      kana.value = added ? kana.value + toKatakana(reading) : toKatakana(reading);
      reading = '';
    });
    name.addEventListener('input', function (ev) {
      if (ev.isComposing) return;
      // 名前を消したら、こちらが入れたフリガナも消す（打ち直しのとき二重にならないように）
      if (!name.value && !state.kanaTouched[kanaId]) kana.value = '';
    });
    kana.addEventListener('input', function () { state.kanaTouched[kanaId] = true; });
  }

  function field(id, label, value, opts) {
    var input = h('input', { type: 'text', id: 'pf-' + id, value: value || '', autocomplete: 'off',
      placeholder: opts && opts.hint ? opts.hint : null });
    if (opts && opts.oninput) input.addEventListener('input', opts.oninput);
    if (opts && opts.onchange) input.addEventListener('change', opts.onchange);
    if (opts && opts.mode) input.setAttribute('inputmode', opts.mode);
    // ★ 入れなくてよい欄が分かるように、見出しに印を付ける（2026-09-20、本人の要望）。
    //   必須は姓と名だけ。ほかは空のままでも保存できる
    var need = !!(opts && opts.need);
    var label2 = h('label', { for: 'pf-' + id }, [
      h('span', { text: label }),
      h('span', { class: need ? 'pf-need' : 'pf-any', text: need ? t('pfNeed') : t('pfAny') })
    ]);
    return h('div', { class: 'pf-item' + (opts && opts.wide ? ' wide' : '') },
      [label2, input,
       opts && opts.note ? h('p', { class: 'pf-note', text: opts.note }) : null]);
  }
  function pfVal(id) { return el('pf-' + id) ? el('pf-' + id).value : ''; }

  function personForm() {
    var p = editingPerson();
    state.autoPostal = null;      // 入力欄を開くたびに、目印をまっさらにする
    // すでにフリガナが入っている人を直すときは、勝手に足さない
    state.kanaTouched = { 'pf-kanaFamily': !!p.kanaFamily, 'pf-kanaGiven': !!p.kanaGiven };
    var box = h('div', { class: 'person-form' });
    box.appendChild(h('p', { class: 'sub-title',
      text: state.editing.index == null ? t('formAdd', { g: state.editing.gender }) : t('formEdit', { g: state.editing.gender }) }));
    // ★ 主役は「申込書に反映させる項目を入力してください」（2026-09-20、本人の指摘）。
    //   前は「入れるのは姓と名だけで構いません」を先に出していて、
    //   **ほかは入れなくてよい**と読めてしまっていた。入れた項目だけが申込書に出る
    box.appendChild(h('p', { class: 'pf-lead', text: t('pfLead') }));
    box.appendChild(h('p', { class: 'hint', text: t('pfAnyNote') }));

    var grid = h('div', { class: 'pf-grid' }, [
      field('family', t('colFamily'), p.family, { need: true }),
      field('given', t('colGiven'), p.given, { need: true }),
      field('kanaFamily', t('colKanaFamily'), p.kanaFamily, { onchange: function (ev) { ev.target.value = toKatakana(ev.target.value); } }),
      field('kanaGiven', t('colKanaGiven'), p.kanaGiven, { onchange: function (ev) { ev.target.value = toKatakana(ev.target.value); } }),
      field('birthText', t('colBirth'), p.birthText, { oninput: showBirth, hint: t('phBirth'), note: t('noteBirth') }),
      field('postal', t('colPostal'), p.postal, { mode: 'numeric', oninput: onPostalInput, hint: t('phPostal'), note: t('notePostal') }),
      field('pref', t('colPref'), p.pref),
      field('address', t('colAddress'), p.address, { wide: true, oninput: onAddressInput, onchange: onAddressChange,
        hint: t('phAddress'), note: t('noteAddress') }),
      field('phone', t('colPhone'), p.phone, { mode: 'tel' })
    ]);
    // ★ 足した項目（所属・学校名など）。番号で並ぶので、名簿ファイルの列と同じ順に出す
    extraNames().forEach(function (name, i) {
      grid.appendChild(field('extra' + i, name, (p.extras || [])[i] || ''));
    });
    box.appendChild(grid);
    box.appendChild(h('p', { class: 'hint', text: t('formHint') }));
    box.appendChild(h('p', { class: 'msg', id: 'pfBirthMsg' }));
    box.appendChild(h('div', { id: 'pfPostal' }));
    box.appendChild(h('p', { class: 'msg', id: 'pfMsg' }));
    box.appendChild(h('div', { class: 'btns' }, [
      h('button', { type: 'button', text: t('formOkBtn'), onclick: onPersonSave }),
      h('button', { type: 'button', class: 'btn-sub', text: t('formCancel'),
        onclick: function () { state.editing = null; renderRoster(); } })
    ]));
    setTimeout(function () {
      if (el('pf-family')) el('pf-family').focus();
      wireKana('pf-family', 'pf-kanaFamily');
      wireKana('pf-given', 'pf-kanaGiven');
      showBirth();
      // 申込書から持ってきた名前を分けられなかったときは、その場で知らせる
      if (state.editing && state.editing.prefill && !p.given) setMsg('pfMsg', t('splitNameHint'), 'wait');
    }, 0);
    return box;
  }

  // 生年月日の読み取りを、入れたそばから見せる（入れ間違いに気づけるように）
  function showBirth() {
    var m = el('pfBirthMsg');
    if (!m) return;
    var s = pfVal('birthText').trim();
    if (!s) { m.textContent = ''; m.className = 'msg'; return; }
    var b = R.parseBirth(s);
    if (!b) { m.textContent = t('birthBad'); m.className = 'msg ng'; return; }
    var w = R.toWareki(b);
    m.textContent = t('birthRead', { era: w ? w.era : '', n: w ? w.n : '', y: b.y, m: b.m, d: b.d,
      age: R.ageAt(b, todayYmd()) });
    m.className = 'msg ok';
  }

  // 郵便番号 → 住所（このサイトに置いた郵便番号データを読む。外には送らない）
  var postalBusy = null;
  function onPostalInput() {
    var box = el('pfPostal');
    if (!box) return;
    state.autoPostal = null;   // 本人が郵便番号を打ったので、以後この欄は住所から書き換えない
    var code = P.normalize(pfVal('postal'));
    if (!code || code === postalBusy) return;
    postalBusy = code;
    clear(box);
    P.lookup(code).then(function (r) {
      if (postalBusy !== code || !el('pfPostal')) return;
      if (!r.candidates.length) { setMsg('pfMsg', t('postalNone', { code: code }), 'ng'); return; }
      setMsg('pfMsg', '', '');
      if (r.candidates.length === 1) { putAddress(r.candidates[0]); return; }
      // 1つの郵便番号に住所が2つ以上あることがある（蘇我／蘇我町、市区町村から違うものも）
      var box2 = clear(el('pfPostal'));
      box2.appendChild(h('p', { class: 'hint', text: t('postalPick') }));
      var sel = h('select', { onchange: function (ev) {
        var c = r.candidates[Number(ev.target.value)];
        if (c) putAddress(c);
      } });
      sel.appendChild(h('option', { value: '', text: t('postalPickNone') }));
      r.candidates.forEach(function (c, i) {
        sel.appendChild(h('option', { value: String(i), text: c.pref + c.city + c.town }));
      });
      box2.appendChild(sel);
    }).catch(function (e) {
      if (postalBusy !== code) return;
      setMsg('pfMsg', errText(e), 'ng');
    });
  }
  // 住所 → 郵便番号（都道府県ごとのデータを読む）。郵便番号が空のときだけ、入れ終わったら自動で引く
  var addrTimer = null;
  function onAddressInput() {
    // 打ち終わるのを待ってから引く（1文字ごとに引かない）
    if (addrTimer) clearTimeout(addrTimer);
    addrTimer = setTimeout(onAddressChange, 500);
  }

  function onAddressChange() {
    if (!el('pf-address')) return;
    movePrefFromAddress();
    // ★ 自分で入れた郵便番号は触らない。ただし、こちらが自動で入れた番号は入れ直す。
    //   「白山市」まで打った時点で 9240000 が入り、そのあと町名を足しても直らなかった
    //   （2026-09-16、本人が発見）。打ちかけ・ブラウザの自動入力が残っているときも引き直す
    var now = pfVal('postal');
    if (P.normalize(now) && now !== state.autoPostal) return;
    if (!pfVal('address').trim() || !pfVal('pref').trim()) return;
    var pref = pfVal('pref'), address = pfVal('address');
    P.lookupPostal(pref, address).then(function (r) {
      var cur = el('pf-postal') ? pfVal('postal') : null;
      if (cur === null || (P.normalize(cur) && cur !== state.autoPostal)) return;
      if (!r) { setMsg('pfMsg', t('postalRevNone'), 'wait'); return; }
      if (r.candidates.length === 1) {
        el('pf-postal').value = r.candidates[0].code;
        state.autoPostal = r.candidates[0].code;
        setMsg('pfMsg', t('postalRevOk', { town: r.matched, code: r.candidates[0].code }), 'ok');
        clear(el('pfPostal'));
        return;
      }
      // 同じ町名に郵便番号が2つ以上ある（丁目やビルで分かれている）
      setMsg('pfMsg', '', '');
      var box = clear(el('pfPostal'));
      box.appendChild(h('p', { class: 'hint', text: t('postalRevPick', { town: r.matched }) }));
      var sel = h('select', { onchange: function (ev) {
        if (ev.target.value && el('pf-postal')) {
          el('pf-postal').value = ev.target.value;
          state.autoPostal = ev.target.value;
        }
      } });
      sel.appendChild(h('option', { value: '', text: t('postalPickNone') }));
      r.candidates.forEach(function (c) {
        sel.appendChild(h('option', { value: c.code, text: c.code + (c.note ? ' ' + c.note : '') }));
      });
      box.appendChild(sel);
    }).catch(function (e) {
      if (e && e.code === 'postal-no-pref') return;   // 都道府県が空か、知らない書き方。黙って何もしない
      setMsg('pfMsg', errText(e), 'ng');
    });
  }

  // 住所の欄に「石川県白山市…」と都道府県から書かれていたら、都道府県の欄へ移す
  function movePrefFromAddress() {
    var address = pfVal('address').trim();
    if (!address || pfVal('pref').trim()) return;
    for (var i = 0; i < P.PREFS.length; i++) {
      if (address.indexOf(P.PREFS[i]) === 0) {
        el('pf-pref').value = P.PREFS[i];
        el('pf-address').value = address.slice(P.PREFS[i].length);
        return;
      }
    }
  }

  function putAddress(c) {
    if (el('pf-pref')) el('pf-pref').value = c.pref;
    if (el('pf-address')) {
      var rest = el('pf-address').value;
      var head = c.city + c.town;
      // 前に入れた町名を二重に足さない
      el('pf-address').value = rest.indexOf(head) === 0 ? rest : head;
      el('pf-address').focus();
      var n = el('pf-address').value.length;
      el('pf-address').setSelectionRange(n, n);
    }
  }

  function onPersonSave() {
    var p = { extras: (editingPerson().extras || []).slice() };
    extraNames().forEach(function (name, i) { p.extras[i] = pfVal('extra' + i); });
    PF.forEach(function (k) { p[k] = pfVal(k).trim(); });
    p.kanaFamily = toKatakana(p.kanaFamily);
    p.kanaGiven = toKatakana(p.kanaGiven);
    if (!p.family || !p.given) { setMsg('pfMsg', t('formNeedName'), 'ng'); return; }
    p.birth = p.birthText ? R.parseBirth(p.birthText) : null;
    if (p.birthText && !p.birth) { setMsg('pfMsg', t('birthBad'), 'ng'); return; }

    var e = state.editing;
    var list = peopleOf(e.gender);
    var same = null;
    GENDERS.forEach(function (g) {
      peopleOf(g).forEach(function (q, i) {
        if (g === e.gender && i === e.index) return;
        if (personName(q) !== personName(p)) return;
        var qb = q.birth ? q.birth.y + '-' + q.birth.m + '-' + q.birth.d : '';
        var pb = p.birth ? p.birth.y + '-' + p.birth.m + '-' + p.birth.d : '';
        if (qb === pb) same = q;
      });
    });
    if (same && !window.confirm(t('sameConfirm', { name: personName(p) }))) return;

    p.problems = B.problemsOf(p);   // 一覧の ⚠ と、③の突き合わせに使う
    if (e.index == null) list.push(p); else list[e.index] = p;
    state.editing = null;
    markDirty();
    rebuildRoster();
    // ③から足しに来たときは、③へ戻る（突き合わせはやり直してある）
    if (state.backToNames && !el('stepNames').hidden) {
      state.backToNames = false;
      el('stepNames').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // 「山田 太郎」なら空白で、「山田太郎」なら名簿にある姓と見比べて切り分ける
  function splitName(raw) {
    var s = String(raw || '').replace(/[\s　]+/g, ' ').trim();
    var parts = s.split(' ');
    if (parts.length >= 2) return { family: parts[0], given: parts.slice(1).join(' ') };
    return splitByKnownFamily(s);
  }

  // 申込書には「山田太郎」と区切らずに書かれることが多い。名簿にある姓と見比べて切り分ける。
  // 見つからなければ姓の欄に全部入れて、本人に分けてもらう（間違った位置で切らない）
  function splitByKnownFamily(s) {
    var families = {};
    GENDERS.forEach(function (g) { peopleOf(g).forEach(function (p) { if (p.family) families[p.family] = true; }); });
    var best = '';
    Object.keys(families).forEach(function (f) {
      if (s.length > f.length && s.slice(0, f.length) === f && f.length > best.length) best = f;
    });
    return best ? { family: best, given: s.slice(best.length) } : { family: s, given: '' };
  }

  // ③ で「名簿に無い」と出た名前を、そのまま①の入力欄に入れて足す
  function addFromNames(typed, gender) {
    if (!state.book) return;
    var s = String(typed || '').replace(/[\s　]+/g, ' ').trim();
    var prefill = splitName(s);
    state.tab = gender;
    state.editing = { gender: gender, index: null, prefill: prefill };
    state.backToNames = true;
    renderRoster();
    el('rosterEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMsg('rosterMsg', t('addFromNames', { name: s, g: gender }), 'wait');
  }

  /* ===== 出欠システムから名前を取り込む ===== */
  // ★ 取れるのは 団体名・氏名・性別 だけ（生年月日・住所・電話は向こうに無い）。
  //   送るのは団体IDだけで、名簿の中身は送らない。
  function onAttendOpen() {
    if (!state.book) openRoster(B.blank(), t('rosterNewMsg'));
    state.attend = null;
    renderAttendBox();
    el('attendBox').hidden = false;
    el('attendId').focus();
  }

  function renderAttendBox() {
    var box = clear(el('attendBox'));
    box.appendChild(h('p', { class: 'sub-title', text: t('attendTitle') }));
    box.appendChild(h('p', { class: 'hint', text: t('attendHint') }));
    var input = h('input', { type: 'text', id: 'attendId', autocomplete: 'off', placeholder: t('attendPlaceholder') });
    input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); onAttendFetch(); } });
    box.appendChild(h('div', { class: 'field' }, [input]));
    box.appendChild(h('div', { class: 'btns' }, [
      h('button', { type: 'button', text: t('attendFetch'), onclick: onAttendFetch }),
      h('button', { type: 'button', class: 'btn-sub', text: t('formCancel'),
        onclick: function () { el('attendBox').hidden = true; state.attend = null; } })
    ]));
    box.appendChild(h('p', { class: 'msg', id: 'attendMsg' }));
    box.appendChild(h('div', { id: 'attendList' }));
  }

  function onAttendFetch() {
    var raw = el('attendId').value;
    setMsg('attendMsg', t('attendFetching'), 'wait');
    clear(el('attendList'));
    A.fetchMembers(raw).then(function (r) {
      state.attend = r;
      renderAttendPreview();
    }).catch(function (e) { setMsg('attendMsg', errText(e), 'ng'); });
  }

  // 取り込む前に見せる。すでに名簿にいる人は飛ばし、性別が空の人は男子か女子かを選んでもらう
  function renderAttendPreview() {
    var r = state.attend;
    var box = clear(el('attendList'));
    var have = {};
    GENDERS.forEach(function (g) { peopleOf(g).forEach(function (p) { have[R.nameKey(personName(p))] = g; }); });

    var fresh = [], already = 0;
    r.members.forEach(function (m) {
      if (have[R.nameKey(m.name)]) { already++; return; }
      fresh.push(m);
    });
    r.fresh = fresh;
    setMsg('attendMsg', t('attendFound', { org: r.org, n: r.members.length, add: fresh.length, skip: already }), 'ok');
    if (!fresh.length) return;

    // 手当てが要る人だけ出す: 性別が空／姓と名に分けられない（出欠の名前は空白なしのことがある）
    var needsGender = fresh.filter(function (m) { return !m.gender; });
    var needsSplit = fresh.filter(function (m) { return !splitName(m.name).given; });
    if (needsGender.length) box.appendChild(h('p', { class: 'hint', text: t('attendPickGender', { n: needsGender.length }) }));
    if (needsSplit.length) box.appendChild(h('p', { class: 'hint', text: t('attendSplitHint', { n: needsSplit.length }) }));
    if (needsGender.length || needsSplit.length) {
      var list = h('div', { class: 'attend-picks' });
      fresh.forEach(function (m) {
        var needName = needsSplit.indexOf(m) >= 0, needGender = needsGender.indexOf(m) >= 0;
        if (!needName && !needGender) return;
        var row = h('label', { class: 'attend-pick' });
        if (needName) {
          row.appendChild(h('input', { type: 'text', value: m.name, onchange: function (ev) { m.name = ev.target.value; } }));
        } else {
          row.appendChild(h('span', { text: m.name }));
        }
        if (needGender) {
          var sel = h('select', { onchange: function (ev) { m.gender = ev.target.value; } });
          sel.appendChild(h('option', { value: '', text: t('attendSkip') }));
          GENDERS.forEach(function (g) { sel.appendChild(h('option', { value: g, text: g })); });
          row.appendChild(sel);
        } else {
          row.appendChild(h('span', { class: 'hint', text: m.gender }));
        }
        list.appendChild(row);
      });
      box.appendChild(list);
    }
    box.appendChild(h('div', { class: 'btns' }, [
      h('button', { type: 'button', text: t('attendImport', { n: fresh.length }), onclick: onAttendImport })
    ]));
  }

  function onAttendImport() {
    var r = state.attend;
    if (!r) return;
    var added = 0, skipped = 0;
    r.fresh.forEach(function (m) {
      if (!m.gender) { skipped++; return; }   // 男子か女子かを選ばなかった人は入れない
      var parts = splitName(m.name);
      var p = { family: parts.family, given: parts.given, kanaFamily: '', kanaGiven: '', birth: null, birthText: '',
        postal: '', pref: '', address: '', phone: '', extras: [] };
      p.problems = B.problemsOf(p);
      peopleOf(m.gender).push(p);
      added++;
    });
    if (!el('orgInput').value.trim() && r.org) {
      el('orgInput').value = r.org;
      state.book.org = r.org;
    }
    state.attend = null;
    el('attendBox').hidden = true;
    markDirty();
    rebuildRoster();
    setMsg('rosterMsg', t('attendDone', { n: added, skip: skipped }), 'ok');
  }

  // ===== 保存 =====
  function saveRosterFile() {
    var data = { org: el('orgInput').value.trim(), today: todayText(),
      people: state.book.people, extraHeaders: state.book.extraHeaders };
    state.book.org = data.org;
    setMsg('rosterMsg', t('saving'), 'wait');
    B.make(data).then(function (bytes) {
      var name = B.fileName(data.org);
      download(bytes, name);
      state.dirty = false;
      renderRoster();
      var n = GENDERS.reduce(function (s, g) { return s + peopleOf(g).length; }, 0);
      setMsg('rosterMsg', t('rosterSaved', { name: name, n: n }), 'ok');
    }).catch(function (e) { setMsg('rosterMsg', errText(e), 'ng'); });
  }

  function download(bytes, name) {
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /* ===== ③ 名前の確認 ===== */
  function analyze() {
    if (!state.form || !state.roster) return;
    var book = state.form.book;
    state.sheets = [];
    state.skipped = false;
    book.sheets.forEach(function (s, i) {
      if (s.state && s.state !== 'visible') return;   // 隠しシートは見ない
      var cells = X.cells(book, i);
      var found = R.findNames(cells, state.roster);
      var sh = { index: i, name: s.name, cells: cells, merges: X.merges(book, i), found: found,
        pick: {}, key: null, mapping: null, fmt: {}, baseDate: null };
      if (!found.names.length && !found.suspects.length) {
        // ★ 名前が1つも書かれていない申込書。見出しと空の記入欄から表を見つけ、名簿から選んでもらう
        var grid = X.grid(book, i);
        var tables = BL.tables(grid);
        // ★ 前に教えてもらった形・直した書く行（シートの形の鍵。大会名や日付では変わらない）
        sh.layoutKey = M.layoutKey(grid, sh.merges);
        var remembered = M.prefs.get(sh.layoutKey) || {};
        // ★ 読めないと分かった表（1人=2行）は諦める。黙って違う行に書くより、断るほうがよい
        var usable = tables.filter(function (tb) { return !tb.skip; });
        if (usable.length < tables.length) state.skipped = true;
        if (!usable.length) {
          // ★ 1人=2行と分かった様式は断る（行が飛ぶので、範囲では教えられない）
          if (tables.length) return;
          // 前に教えてもらった形があれば、それで読む（もう一度聞かない）
          var back = BL.restore([], remembered);
          if (!back.tables.length) {
            // ★ 「記入例」という名前のシートは書く紙ではない。教えてもらわず、今までどおり飛ばす
            if (BL.isExampleName(sh.name)) return;
            sh.teach = true;
            state.sheets.push(sh);
            return;
          }
          usable = back.tables;
          sh.restored = 'teach';
        } else if (BL.restore(usable, remembered).changed) {
          sh.restored = 'rows';
        }
        sh.blank = true;
        sh.tables = usable;
        sh.picks = usable.map(function () { return []; });   // 表ごとに「入れる人」の並び
        state.sheets.push(sh);
        return;
      }
      // ③で「同じ人が2回」を表ごとに見るために、欄の対応をここで作っておく（規則なので一瞬）
      sh.rules = M.normalize(window.EntryRules.map(cells, sh.merges, found));
      state.sheets.push(sh);
    });
    hideFrom('stepNames');
    show('stepNames');
    if (!state.sheets.length) {
      clear(el('namesBody'));
      setMsg('namesMsg', t(state.skipped ? 'twoRowForm' : 'noNamesFound'), 'ng');
      el('namesNext').disabled = true;
      return;
    }
    renderNames();
  }

  function refKey(n) { return n.refs.join('+'); }
  function entriesOf(sh) {
    return sh.found.names.map(function (n) { return { n: n, kind: n.match.status }; })
      .concat(sh.found.suspects.map(function (s) { return { n: s, kind: 'suspect' }; }))
      .sort(byPos);
  }
  function memberOf(sh, e) {
    if (e.kind === 'exact' || e.kind === 'variant') return e.n.match.member;
    var p = sh.pick[refKey(e.n)];
    return (p && p !== 'not-name') ? p : null;
  }
  function unresolvedCount() {
    return state.sheets.reduce(function (sum, sh) {
      return sum + entriesOf(sh).filter(function (e) {
        return (e.kind === 'ambiguous' || e.kind === 'suspect') && !sh.pick[refKey(e.n)];
      }).length;
    }, 0);
  }
  function memberLabel(m) { return t('memberLabel', { name: m.name, birth: ymdText(m.birth) }); }

  // その名前がどの表のものか。見出しの規則が分けた表（連絡責任者／選手 など）の番号を返す。
  // どの表にも入らなければ、その場所そのものを鍵にする（ほかと混ざらないように）
  function tableOf(sh, n) {
    var tables = (sh.rules && sh.rules.tables) || [];
    for (var i = 0; i < tables.length; i++) {
      var tb = tables[i];
      if (n.row < tb.firstRow || n.row > tb.lastRow) continue;
      var cols = [tb.nameCol, tb.familyCol, tb.givenCol].filter(Boolean);
      var col = X.toRef(n.col, 1).replace(/\d+$/, '');
      if (cols.indexOf(col) >= 0) return 'T' + i;
    }
    return 'R' + n.row + 'C' + n.col;
  }

  /* ===== ③ 空の申込書：名簿から誰を入れるか選ぶ ===== */
  // ★ 2026-09-18。名前が1つも書かれていない申込書では、表（名前の列と書ける行）を見つけて、
  //   名簿から人を選んでもらう。選んだ人は、名前ごとこちらが書き込む。
  function tableLabel(tb) {
    var col = tb.nameCol || (tb.familyCol + '・' + tb.givenCol);
    var n = tb.rows.length;
    var where = (tb.firstRow === tb.lastRow ? t('pickRowsOne', { col: col, from: tb.firstRow })
      : t('pickRowsMany', { col: col, from: tb.firstRow, to: tb.lastRow })) +
      (n === 1 ? t('pickCapOne') : t('pickCap', { n: n }));
    return tb.label ? t('pickTableNamed', { label: tb.label, where: where }) : where;
  }

  // ★ 2枚目を足せない様式かどうか（図などが入っていると写せない）。理由の語を返す
  function copyBlocker(sh) {
    if (!state.form || !state.form.book) return '';
    try { return X.copyBlocker(state.form.book, sh.index) || ''; } catch (e) { return ''; }
  }

  // その表を何枚に分けて書くか（2枚目を足さないなら必ず1）
  function pagesOfTable(sh, ti) {
    var tb = sh.tables && sh.tables[ti];
    if (!tb || !tb.rows.length) return 1;
    var more = !!(sh.more && sh.more[ti]);
    if (!more) return 1;
    return Math.max(1, Math.ceil((sh.picks[ti] || []).length / tb.rows.length));
  }
  // そのシート全体で何枚要るか
  function pagesOf(sh) {
    if (!sh.blank || !sh.tables) return 1;
    return sh.tables.reduce(function (n, tb, ti) { return Math.max(n, pagesOfTable(sh, ti)); }, 1);
  }

  // ★ 教えてもらった形と、直した「書く行」を覚える（2026-09-20）。
  //   様式は無数にあるので、規則で網羅するのではなく、**一度教えたら次から聞かない**形にする。
  //   覚えるのは列と行の番号だけ（個人情報は入らない）
  function saveRows(sh) {
    if (!sh.layoutKey || !sh.tables) return;
    M.prefs.put(sh.layoutKey, BL.remember(sh.tables));
  }

  // ★ 表が見つからなかったシート。名前の列と書く行を教えてもらう（2026-09-20）
  function renderTeachSheet(sh, sec, canSkip) {
    sec.appendChild(h('p', { class: 'name-note ng', text: t('teachTitle') }));
    sec.appendChild(h('p', { class: 'hint', text: t('teachHint') }));
    if (canSkip) sec.appendChild(h('p', { class: 'hint', text: t('teachSkipNote') }));
    var col = h('input', { type: 'text', class: 'row-num', value: sh.teachCol || '', maxlength: '3' });
    var from = h('input', { type: 'number', class: 'row-num', min: '1', max: '2000' });
    var to = h('input', { type: 'number', class: 'row-num', min: '1', max: '2000' });
    sec.appendChild(h('p', { class: 'small pick-rows' }, [
      h('span', { text: t('teachCol') }), col,
      h('span', { text: t('teachRows') }), from, h('span', { text: '〜' }), to,
      h('span', { text: t('pickRowsUnit') })
    ]));
    sec.appendChild(h('p', {}, [
      h('button', { type: 'button', class: 'btn-sub', text: t('teachApply'), onclick: function () {
        var tb = BL.manual(col.value, from.value, to.value);
        if (!tb) { setMsg('namesMsg', t('teachBad'), 'ng'); return; }
        sh.teach = false;
        sh.blank = true;
        sh.tables = [tb];
        sh.picks = [[]];
        saveRows(sh);
        renderNames();
        setMsg('namesMsg', t('teachDone'), 'ok');
      } }),
      h('button', { type: 'button', class: 'link-btn', text: t('teachSkip'), onclick: function () {
        state.sheets = state.sheets.filter(function (x) { return x !== sh; });
        renderNames();
      } })
    ]));
  }

  function renderPickSheet(sh, sec) {
    sh.tables.forEach(function (tb, ti) {
      var picks = sh.picks[ti];
      var box = h('div', { class: 'pick-table' });
      box.appendChild(h('p', { class: 'sub-title', text: tableLabel(tb) }));

      // ★ 2枚目を足すかどうか。足すなら、表の行数を超えて選べる（2026-09-20）
      var cap = tb.rows.length;
      var more = !!(sh.more && sh.more[ti]);
      var pages = more ? Math.max(1, Math.ceil(picks.length / cap) + (picks.length % cap === 0 ? 1 : 0)) : 1;
      if (pages > 1) box.appendChild(h('p', { class: 'hint',
        text: t('pickPages', { pages: Math.ceil(picks.length / cap) || 1, n: picks.length, cap: cap }) }));

      // 選んだ人（上の行から順に入る）
      if (!picks.length) {
        box.appendChild(h('p', { class: 'hint', text: t('pickNobody') }));
      } else {
        var ul = h('ol', { class: 'picked' });
        picks.forEach(function (m, i) {
          var row = tb.rows[i % cap];
          var page = Math.floor(i / cap);
          ul.appendChild(h('li', {}, [
            h('span', { class: 'ref', text: (page ? t('pickPageMark', { p: page + 1 }) + ' ' : '') +
              (tb.nameCol || tb.familyCol) + row }),
            h('span', { class: 'typed', text: m.name }),
            h('span', { class: 'hint', text: ymdText(m.birth) }),
            h('button', { type: 'button', class: 'link-btn', text: t('pickUp'), disabled: i === 0,
              onclick: function () { picks.splice(i - 1, 0, picks.splice(i, 1)[0]); renderNames(); } }),
            h('button', { type: 'button', class: 'link-btn', text: t('pickDown'), disabled: i === picks.length - 1,
              onclick: function () { picks.splice(i + 1, 0, picks.splice(i, 1)[0]); renderNames(); } }),
            h('button', { type: 'button', class: 'link-btn', text: t('pickRemove'),
              onclick: function () { picks.splice(i, 1); renderNames(); } })
          ]));
        });
        box.appendChild(ul);
      }

      // 名簿から選ぶ（男子・女子）
      // ★ ちょうど入りきったときは「いっぱいです」と出さない（入れすぎたと勘違いする。2026-09-19、本人の指摘）。
      //   「ちょうどそろいました」と伝え、入れ替えは上の一覧の「外す」でできることを添える
      var full = !more && picks.length >= cap;
      var details = h('details', { class: 'cols-box' + (full ? ' done' : ''), open: !picks.length || sh.pickOpen === ti });
      details.addEventListener('toggle', function () { sh.pickOpen = details.open ? ti : null; });
      details.appendChild(h('summary', { class: full ? 'done' : null,
        text: full ? t('pickComplete', { n: cap }) : t('pickFrom') }));
      if (!full) {
        B.SHEETS.forEach(function (g) {
          var list = (state.book && state.book.people[g]) || [];
          if (!list.length) return;
          details.appendChild(h('p', { class: 'sub-title', text: g }));
          var wrap = h('div', { class: 'pick-people' });
          list.forEach(function (p) {
            var m = state.roster.members.filter(function (x) { return x.sheet === g && x.row === p.row; })[0];
            if (!m) return;
            var already = picks.indexOf(m) >= 0;
            // ★ 同姓同名は、そのままでは見分けられない。生まれ年を添える
            var sameName = state.roster.members.filter(function (x) { return x.key === m.key; }).length > 1;
            var label = sameName ? t('pickSameName', { name: m.name, year: m.birth ? m.birth.y : '?' }) : m.name;
            wrap.appendChild(h('button', { type: 'button', class: 'btn-sub pick-one', disabled: already,
              text: label, title: ymdText(m.birth),
              onclick: function () {
                if (!more && picks.length >= cap) return;
                picks.push(m);
                sh.pickOpen = ti;
                renderNames();
              } }));
          });
          details.appendChild(wrap);
        });
      }
      box.appendChild(details);

      // ★ 表がいっぱいになったら「2枚目を足す」を出す。勝手には増やさない（驚くため）
      var why = copyBlocker(sh);
      if (picks.length >= cap && !more && !why) {
        box.appendChild(h('p', {}, [
          h('button', { type: 'button', class: 'btn-sub', text: t('pickMore'),
            onclick: function () {
              sh.more = sh.more || {};
              sh.more[ti] = true;
              sh.pickOpen = ti;
              renderNames();
            } })
        ]));
      } else if (picks.length >= cap && !more && why) {
        box.appendChild(h('p', { class: 'warn', text: t('pickMoreCannot', { why: why }) }));
      } else if (more) {
        box.appendChild(h('p', { class: 'small' }, [
          h('span', { class: 'ok-text', text: t('pickMoreOn') }),
          h('button', { type: 'button', class: 'link-btn', text: t('pickMoreOff'),
            onclick: function () {
              sh.more[ti] = false;
              sh.picks[ti] = picks.slice(0, cap);
              renderNames();
            } })
        ]));
        box.appendChild(h('p', { class: 'hint', text: t('pickMoreNote') }));
      }

      // ★ 表の見つけ方が外れたときの逃げ道。書く行を本人が直せる
      var from = h('input', { type: 'number', class: 'row-num', value: String(tb.firstRow), min: '1', max: '2000' });
      var to = h('input', { type: 'number', class: 'row-num', value: String(tb.lastRow), min: '1', max: '2000' });
      var apply = function () {
        var f = Number(from.value), t2 = Number(to.value);
        if (!(f >= 1 && t2 >= f && t2 - f < 200)) { setMsg('namesMsg', t('pickRowsBad'), 'ng'); return; }
        tb.firstRow = f; tb.lastRow = t2;
        tb.rows = [];
        // ★ 上の行がふりがなの様式は、1つ飛ばしで数える（ふりがなの行に名前を書かないため）
        var st = tb.kanaAbove ? 2 : 1;
        for (var r = f; r <= t2; r += st) tb.rows.push(r);
        // 2枚目を足すなら、行数を超えていても切らない（何枚に分けるかが変わるだけ）
        if (!(sh.more && sh.more[ti])) sh.picks[ti] = picks.slice(0, tb.rows.length);
        saveRows(sh);
        renderNames();
      };
      from.addEventListener('change', apply);
      to.addEventListener('change', apply);
      box.appendChild(h('p', { class: 'small pick-rows' }, [
        h('span', { text: t('pickRowsLabel') }), from, h('span', { text: '〜' }), to, h('span', { text: t('pickRowsUnit') })
      ]));
      sec.appendChild(box);
    });
  }

  // 選んだ人から、いままでの道（見出しの規則・④・⑤）が使う形を作る
  // page: 何枚目か（0 が元の様式）。2枚目以降は、同じ行に続きの人を当てる
  function foundFromPicks(sh, page) {
    page = page || 0;
    var names = [];
    sh.tables.forEach(function (tb, ti) {
      var cap = tb.rows.length;
      var slice = (sh.more && sh.more[ti]) ? sh.picks[ti].slice(page * cap, (page + 1) * cap)
        : (page ? [] : sh.picks[ti]);
      slice.forEach(function (m, i) {
        var row = tb.rows[i];
        if (!row) return;
        var refs = tb.nameCol ? [tb.nameCol + row] : [tb.familyCol + row, tb.givenCol + row];
        var col = X.parseRef(refs[0]).col;
        names.push({ refs: refs, row: row, col: col, text: m.name, match: { status: 'exact', member: m } });
      });
    });
    return { names: names, suspects: [], duplicates: [] };
  }

  function renderNames() {
    var body = clear(el('namesBody'));
    var anyBlank = state.sheets.some(function (sh) { return sh.blank; });
    el('stepNamesTitle').textContent = anyBlank && state.sheets.every(function (sh) { return sh.blank; })
      ? t('step3TitlePick') : t('step3Title');
    el('stepNamesHint').textContent = anyBlank ? t('step3HintPick') : t('step3Hint');
    state.sheets.forEach(function (sh) {
      var sec = h('div', { class: 'sheet' }, [h('h3', { text: t('sheetTitle', { name: sh.name }) })]);
      if (sh.teach) {
        renderTeachSheet(sh, sec, state.sheets.some(function (x) { return !x.teach; }));
        body.appendChild(sec);
        return;
      }
      if (sh.blank) {
        // ★ 覚えていた形を当てたときは、そう見せる（黙って当てない）
        if (sh.restored) sec.appendChild(h('p', { class: 'name-note',
          text: t(sh.restored === 'teach' ? 'teachRestored' : 'rowsRestored') }));
        renderPickSheet(sh, sec);
        body.appendChild(sec);
        return;
      }
      var ul = h('ul', { class: 'names' });
      var chosen = {};
      entriesOf(sh).forEach(function (e) {
        var key = refKey(e.n);
        var li = h('li', { class: 'name-row kind-' + e.kind });
        var head = h('div', { class: 'name-head' }, [
          h('span', { class: 'ref', text: e.n.refs.join('・') }),
          h('span', { class: 'typed', text: e.n.text })
        ]);
        li.appendChild(head);

        if (e.kind === 'exact') {
          li.appendChild(h('p', { class: 'name-note ok', text: t('nameExact') }));
        } else if (e.kind === 'variant') {
          li.appendChild(h('p', { class: 'name-note', text: t('nameVariant', { name: e.n.match.member.name }) }));
        } else {
          var sel = h('select', { onchange: function (ev) {
            var v = ev.target.value;
            if (v === '') delete sh.pick[key];
            else if (v === 'not-name') sh.pick[key] = 'not-name';
            else sh.pick[key] = state.roster.members[Number(v)];
            renderNames();
          } });
          sel.appendChild(h('option', { value: '', text: t('pickPlease') }));
          var idx = function (m) { return String(state.roster.members.indexOf(m)); };
          if (e.kind === 'ambiguous') {
            li.appendChild(h('p', { class: 'name-note warn', text: t('nameAmbiguous', { n: e.n.match.members.length }) }));
            e.n.match.members.forEach(function (m) { sel.appendChild(h('option', { value: idx(m), text: memberLabel(m) })); });
          } else {
            li.appendChild(h('p', { class: 'name-note warn', text: e.n.candidates.length ? t('nameSuspect') : t('nameSuspectNoCand') }));
            if (e.n.candidates.length) {
              var g1 = h('optgroup', { label: t('pickCandidates') });
              e.n.candidates.forEach(function (c) { g1.appendChild(h('option', { value: idx(c.member), text: memberLabel(c.member) })); });
              sel.appendChild(g1);
            }
            var g2 = h('optgroup', { label: t('pickAll') });
            state.roster.members.forEach(function (m) { g2.appendChild(h('option', { value: idx(m), text: memberLabel(m) })); });
            sel.appendChild(g2);
            sel.appendChild(h('option', { value: 'not-name', text: t('pickNotName') }));
          }
          var cur = sh.pick[key];
          sel.value = !cur ? '' : cur === 'not-name' ? 'not-name' : idx(cur);
          li.appendChild(sel);
          // 名簿に無い人は、その場で名簿に足せる（①に戻って入力欄を開く）
          if (e.kind === 'suspect') {
            var row = h('p', { class: 'small add-row' }, [h('span', { class: 'hint', text: t('addToRosterLabel') })]);
            GENDERS.forEach(function (g) {
              row.appendChild(h('button', { type: 'button', class: 'link-btn', text: t('addToRoster', { g: g }),
                onclick: function () { addFromNames(e.n.text, g); } }));
            });
            li.appendChild(row);
          }
        }

        // ★ 「同じ人が2回」は表ごとに見る。連絡責任者・監督の欄と選手の表に同じ人がいるのは
        //   ふつうのこと（2026-09-18、本人の指摘）。防ぎたいのは、選手の表に同じ人が2回入ること
        var m = memberOf(sh, e);
        if (m) {
          var key = tableOf(sh, e.n) + '|' + m.key;
          if (chosen[key]) li.appendChild(h('p', { class: 'name-note ng', text: t('nameDuplicate', { ref: chosen[key] }) }));
          else chosen[key] = e.n.refs[0];
        }
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      body.appendChild(sec);
    });
    var picked = state.sheets.reduce(function (sum, sh) {
      return sum + (sh.blank ? sh.picks.reduce(function (s, p) { return s + p.length; }, 0) : 0);
    }, 0);
    var left = unresolvedCount();
    // ★ 教えてもらう途中のシートしか無いときは進ませない（何も書かないまま進むため）。
    //   ほかに使えるシートがあれば進める。そのシートには書かないと、教える箱に出してある
    if (state.sheets.some(function (sh) { return sh.teach; }) &&
        !state.sheets.some(function (sh) { return !sh.teach; })) {
      el('namesNext').disabled = true;
      setMsg('namesMsg', t('teachWait'), 'wait');
      hideFrom('stepReview');
      return;
    }
    if (anyBlank) {
      el('namesNext').disabled = left > 0 || picked === 0;
      setMsg('namesMsg', picked ? t('pickReady', { n: picked }) : t('pickNone'), picked ? 'ok' : 'wait');
    } else {
      el('namesNext').disabled = left > 0;
      setMsg('namesMsg', left ? t('namesLeft', { n: left }) : t('namesReady'), left ? 'wait' : 'ok');
    }
    hideFrom('stepReview');
  }

  /* ===== 欄の対応（見出しの規則。AI は使わない） ===== */
  // 規則は一瞬で終わるので、③の「次へ」でそのまま④へ進む。
  // 様式ごとに覚えるのは、本人が④で選び直した書き方（fmt）と書く欄（fields）だけ（EntryMap.prefs。個人情報は入らない）
  function onNamesNext() {
    // 教えてもらえなかったシートは使わない（何も書かない）
    state.sheets = state.sheets.filter(function (sh) { return !sh.teach; });
    Promise.all(state.sheets.map(function (sh) {
      // 空の申込書は、選んでもらった人から「名前がそこに書かれている」形を作って、いままでの道に合流する
      if (sh.blank) {
        sh.found = foundFromPicks(sh);
        sh.rules = null;
      }
      sh.mapping = sh.rules || M.normalize(window.EntryRules.map(sh.cells, sh.merges, sh.found));
      addKanaAbove(sh);
      addExtraFields(sh);
      return M.formKey(sh.mapping).then(function (k) {
        sh.key = k;
        var saved = M.prefs.get(k);
        sh.fmt = (saved && saved.fmt) || {};
        sh.overrides = (saved && saved.fields) || {};
        // ★ 覚えていた選び直しを当てているときは、そう見せる（同じ形の別の様式に当たっていないか、
        //   本人が気づけるようにするため。2026-09-20 に鍵をゆるめたので、この知らせが歯止めになる）
        sh.remembered = Object.keys(sh.overrides).length > 0;
        // 大会の決まり（前にこの申込書で入れたもの）
        sh.ageClassesRaw = (saved && saved.ageClasses) || '';
        sh.eventWrite = (saved && saved.eventWrite) || '';
        sh.eventFmt = (saved && saved.eventFmt) || '';
        sh.feeCount = (saved && saved.feeCount) || '';
        sh.feeManual = (saved && saved.feeManual) || '';
        sh.colsOpen = null;   // null = 決められなかった列があるときだけ開く。本人が開け閉めしたらそれに従う
        // ★ 覚えていた直しを当てているときも開く。当てた中身を見せないと、歯止めにならない
        if (sh.remembered) sh.colsOpen = true;
      });
    })).then(function () {
      show('stepReview');
      renderReview();
      el('stepReview').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (e) { setMsg('namesMsg', errText(e), 'ng'); });
  }

  // 足した項目の名前（どの組も同じ並び。④や⑤で名前を出すのに使う）
  function extraNamesOf() {
    var eh = (state.book && state.book.extraHeaders) || {};
    for (var i = 0; i < GENDERS.length; i++) {
      if ((eh[GENDERS[i]] || []).length) return eh[GENDERS[i]];
    }
    return [];
  }
  function fieldLabel(f) {
    var m = /^extra:(\d{1,2})$/.exec(String(f));
    if (!m) return t('field.' + f);
    return extraNamesOf()[Number(m[1])] || t('extraOtherName');
  }

  // ★ 足した項目は、申込書の**同じ見出し**の欄にだけ書く（2026-09-20、本人の判断＝A案）。
  //   見出しは改行を含むことがある（「勤務先所在地／会社名」で1つのセル）。**行ごとに分けて
  //   ぴったり同じ**なら当てる。語を含んでいれば当てる、にはしない——
  //   本物のシニアフェスタで「勤務先所在地・会社名」の列に**自宅住所**を書く誤爆が出ており、
  //   当てにいく規則はその種の誤爆を増やす

  // 見出しがぴったり合う列に、足した項目を割り当てる
  // ★ 見るのは**セルの生の文字**（2026-09-20）。規則が作る見出し（near）は空白と改行を
  //   取ってつなげてあり、「勤務先所在地\r\n会社名」が「勤務先所在地会社名」になって
  //   行ごとの照合ができない。cells から引き直す
  function addExtraFields(sh) {
    var names = extraNamesOf();
    if (!names.length || !sh.mapping) return;
    var textAt = {};
    (sh.cells || []).forEach(function (x) { textAt[x.ref] = x.text; });
    (sh.mapping.tables || []).forEach(function (tb) {
      var hits = [], byCol = {};
      (tb.cols || []).forEach(function (c) {
        var top = Math.max(1, (tb.headerRow || 1) - 3);
        for (var r = tb.headerRow || 1; r >= top; r--) {
          var raw = textAt[c.col + r];
          if (!raw) continue;
          for (var i = 0; i < names.length; i++) {
            if (!M.sameLabel(raw, names[i])) continue;
            hits.push({ col: c.col, index: i });
            byCol[c.col] = c;
            return;
          }
        }
      });
      // ★ 同じ項目に2つ以上の列が当たったら、名前の列にいちばん近い1つだけ（M.nearestCols）
      var pick = M.nearestCols(tb.nameCol || tb.familyCol || 'A', hits);
      Object.keys(pick).forEach(function (k) {
        var c = byCol[pick[k]];
        if (!c) return;
        // ★ 見出しがぴったり同じなら、見出しの規則より名簿の項目を優先する。
        //   本物のシニアフェスタの「勤務先所在地／会社名」に**自宅住所**を書く誤爆を、これで止める
        tb.fields = tb.fields.filter(function (f) { return !(f.col === c.col && f.rowOffset === 0); });
        tb.fields.push({ field: 'extra:' + k, col: c.col, rowOffset: 0, header: c.header });
        c.field = 'extra:' + k;
      });
    });
  }

  // ★ 実線の枠の中が点線で区切られた様式では、上の行がふりがな欄（2026-09-20、本人の判断）。
  //   名前の列の**1つ上の行**にフリガナを書く。見出しの規則はこの形を見つけられない
  //   （「フリガナ」と印刷されていないため）ので、表を見つけた側の知識をここで足す
  function addKanaAbove(sh) {
    if (!sh.blank || !sh.tables || !sh.mapping) return;
    var cols = {};
    sh.tables.forEach(function (tb) { if (tb.kanaAbove && tb.nameCol) cols[tb.nameCol] = true; });
    if (!Object.keys(cols).length) return;
    (sh.mapping.tables || []).forEach(function (tb) {
      if (!tb.nameCol || !cols[tb.nameCol]) return;
      if (tb.fields.some(function (f) { return f.field === 'kana'; })) return;   // 別に欄があるなら足さない
      tb.fields.push({ field: 'kana', col: tb.nameCol, rowOffset: -1 });
    });
  }

  /* ===== ④ 書き込む内容の確認 ===== */
  // 本人の直し（書く欄の選び直し）を当てはめた対応。以降の判定（生年月日の問い・書き方・値の表）はすべてこれを使う
  function effectiveMapping(sh) {
    var r = M.applyOverrides(sh.mapping, sh.overrides);
    sh.duplicates = r.duplicates;
    return r.mapping;
  }
  // 様式ごとに覚えるもの。★ 個人情報は入れない（書き方と欄の対応、大会の決まりだけ）
  function savePrefs(sh) {
    M.prefs.put(sh.key, { fmt: sh.fmt, fields: sh.overrides,
      ageClasses: sh.ageClassesRaw || '', eventWrite: sh.eventWrite || '', eventFmt: sh.eventFmt || '',
      feeCount: sh.feeCount || '', feeManual: sh.feeManual || '' });
  }

  // ★ 生年月日を西暦で書くか和暦で書くか（2026-09-15、本人の要望）。
  //   申込書に指示が無いときは、名簿の書き方に関係なく本人に選んでもらい、選ぶまで保存させない。
  //   選んだ方は端末に覚え、次の申込書では最初から選ばれた状態にする（聞くこと自体は毎回する）。
  //   指示があるときは聞かず、見出しの規則が決めた書き方を使う。下の「書き方」でいつでも変えられる。
  var BIRTH_STYLE_LS = 'dropper_entry_birth_style';
  var SHRINK_LS = 'dropper_entry_shrink';
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function colOf(ref) { return /^[A-Z]+/.exec(ref)[0]; }
  var BIRTH_FIELDS = { birth: true, birthEra: true, birthYear: true };

  // 生年月日の欄の見出し（最初の名前の行より上4行、結合セルは左上の文字）と、名前の行に印刷済みの文字に、
  // 書き方の手がかり（西暦・和暦・元号・昭和・記入例など）があるかを見る
  function birthInstruction(sh) {
    var cols = {}, first = Infinity, nameRows = {};
    effectiveMapping(sh).tables.forEach(function (tb) {
      first = Math.min(first, tb.firstRow);
      tb.fields.forEach(function (f) { if (/^birth/.test(f.field)) cols[f.col] = true; });
    });
    if (!Object.keys(cols).length) return { has: false, needed: false };
    entriesOf(sh).forEach(function (e) { nameRows[e.n.row] = true; });
    var texts = [];
    sh.cells.forEach(function (c) {
      if (!cols[colOf(c.ref)] || c.formula) return;
      if ((c.row < first && c.row >= first - 4) || nameRows[c.row]) texts.push(c.text);
    });
    sh.merges.forEach(function (m) {
      if (m.bottom < first - 4 || m.top >= first) return;
      var covers = Object.keys(cols).some(function (L) { var n = X.parseRef(L + '1').col; return n >= m.left && n <= m.right; });
      if (!covers) return;
      var anchor = sh.cells.filter(function (c) { return c.row === m.top && c.col === m.left; })[0];
      if (anchor) texts.push(anchor.text);
    });
    var s = texts.join(' ');
    try { s = s.normalize('NFKC'); } catch (e) {}
    var hint = /西暦|例[^0-9]{0,4}(19|20)\d\d/.test(s) ? 'seireki'
      : /和暦|元号|年号|明治|大正|昭和|平成|令和|例[^0-9A-Z]{0,4}[MTSHR]\s?\d/i.test(s) ? 'wareki' : null;
    return { has: true, needed: !hint, hint: hint };
  }

  // 選んだ書き方を、生年月日の欄に当てはめる（年・月・日が別の欄なら、元号の欄と年の欄で書き分ける）
  function applyBirthStyle(m, style) {
    m.tables.forEach(function (tb) {
      var hasEra = tb.fields.some(function (f) { return f.field === 'birthEra'; });
      tb.fields.forEach(function (f) {
        if (f.field === 'birth') f.fmt = style === 'seireki' ? (/^seireki/.test(f.fmt) ? f.fmt : 'seireki-slash') : (/^wareki/.test(f.fmt) ? f.fmt : 'wareki');
        if (f.field === 'birthYear') f.fmt = style === 'seireki' ? 'seireki' : (hasEra ? 'wareki-num' : 'wareki');
        if (f.field === 'birthEra') f.fmt = style === 'seireki' ? 'none' : (f.fmt && f.fmt !== 'none' ? f.fmt : 'full');
      });
    });
  }

  function isSplitBirth(sh) {
    return effectiveMapping(sh).tables.some(function (tb) { return tb.fields.some(function (f) { return f.field === 'birthYear'; }); });
  }

  // 書く欄の選び直し → 西暦／和暦の選択 → 欄ごとの書き方（sh.fmt）の順に当てはめた写しを返す
  function withFmt(sh) {
    var m = effectiveMapping(sh);
    if (sh.birthNeeded && sh.birthStyle) applyBirthStyle(m, sh.birthStyle);
    m.tables.forEach(function (tb) {
      tb.fields.forEach(function (f) { if (sh.fmt[f.field]) f.fmt = sh.fmt[f.field]; });
    });
    return m;
  }

  function birthStyleBox(sh) {
    var split = isSplitBirth(sh);
    var name = 'birthStyle-' + sh.index;
    var choice = function (value) {
      var input = h('input', { type: 'radio', name: name, value: value, onchange: function () {
        sh.birthStyle = value;
        lsSet(BIRTH_STYLE_LS, value);
        Object.keys(BIRTH_FIELDS).forEach(function (f) { delete sh.fmt[f]; });   // 欄ごとの選び直しより、この選択を優先する
        renderReview();
      } });
      input.checked = sh.birthStyle === value;
      return h('label', { class: 'choice' }, [input, h('span', { text: t('birthStyle.' + value + (split ? 'Split' : 'One')) })]);
    };
    return h('div', { class: 'ask' + (sh.birthStyle ? '' : ' pending') }, [
      h('p', { class: 'ask-title', text: t('birthAsk') }),
      h('div', { class: 'choices' }, [choice('seireki'), choice('wareki')]),
      sh.birthStyle ? null : h('p', { class: 'name-note ng', text: t('birthAskNeeded') })
    ]);
  }

  // ④の「書く欄の対応」。表ごとに、見出しのある列をすべて並べ、1列ずつ選び直せるようにする
  // ★ 決めた形（2026-09-15、本人と相談）: 列の一覧で1列ずつ選ぶ／決められなかった列があるときだけ開く／直しはその申込書だけに覚える
  // ★ 名前の列そのものと、書く行（名前と同じ行）は選ばせない（EntryMap.applyOverrides が rowOffset 0 に固定する）
  var PICKABLE = ['kana', 'gender', 'genderMale', 'genderFemale', 'birth', 'birthEra', 'birthYear', 'birthMonth', 'birthDay',
                  'age', 'postal', 'address', 'addressPref', 'addressRest', 'phone'];

  function colsBox(sh, mapping) {
    var undecidedCount = 0;
    mapping.tables.forEach(function (tb) {
      undecidedCount += (tb.cols || []).filter(function (x) { return x.field == null && !x.overridden; }).length;
    });
    var details = h('details', { class: 'cols-box' });
    details.open = sh.colsOpen == null ? undecidedCount > 0 : sh.colsOpen;
    details.addEventListener('toggle', function () { sh.colsOpen = details.open; });
    details.appendChild(h('summary', { class: undecidedCount ? 'warn' : '',
      text: undecidedCount ? t('colsSummaryUndecided', { n: undecidedCount }) : t('colsSummary') }));
    details.appendChild(h('p', { class: 'hint', text: t('colsHint') }));

    mapping.tables.forEach(function (tb, ti) {
      var key = M.tableKey(tb);
      var original = sh.mapping.tables[ti];   // 見出しの規則が決めたまま（直しを当てる前）
      var nameLetters = tb.nameCol || (tb.familyCol + '・' + tb.givenCol);
      var people = entriesOf(sh).filter(function (e) {
        var L = e.n.refs.map(colOf).join('+');
        return (L === tb.nameCol || L === tb.familyCol + '+' + tb.givenCol) && e.n.row >= tb.firstRow && e.n.row <= tb.lastRow;
      }).length;
      var box = h('div', { class: 'cols-table' }, [h('p', { class: 'sub-title', text: tb.firstRow === tb.lastRow
        ? t('colsTableOne', { col: nameLetters, from: tb.firstRow, n: people })
        : t('colsTable', { col: nameLetters, from: tb.firstRow, to: tb.lastRow, n: people }) })]);
      if (!(tb.cols || []).length) box.appendChild(h('p', { class: 'hint', text: t('colsEmpty') }));

      (tb.cols || []).forEach(function (x) {
        var sel = h('select', { onchange: function (ev) {
          var v = ev.target.value;
          var was = ((original.cols || []).filter(function (o) { return o.col === x.col; })[0] || {}).field || 'none';
          sh.overrides[key] = sh.overrides[key] || {};
          if (v === was) delete sh.overrides[key][x.col]; else sh.overrides[key][x.col] = v;
          if (!Object.keys(sh.overrides[key]).length) delete sh.overrides[key];
          savePrefs(sh);
          sh.colsOpen = true;
          renderReview();
        } });
        sel.appendChild(h('option', { value: 'none', text: t('colsNone') }));
        PICKABLE.forEach(function (f) { sel.appendChild(h('option', { value: f, text: t('field.' + f) })); });
        // 足した項目（名簿の列）も選べるようにする
        extraNamesOf().forEach(function (name, i) {
          sel.appendChild(h('option', { value: 'extra:' + i, text: name }));
        });
        sel.value = x.field || 'none';
        var mark = x.overridden ? h('span', { class: 'cols-mark edited', text: t('colsOverridden') })
          : x.field == null ? h('span', { class: 'cols-mark undecided', text: t('colsUndecided') }) : null;
        box.appendChild(h('label', { class: 'cols-row' + (x.field == null && !x.overridden ? ' undecided' : '') }, [
          h('span', { class: 'cols-label', text: t('colsLabel', { col: x.col, header: x.header }) }),
          h('span', { class: 'cols-arrow', text: '→' }), sel, mark
        ]));
      });
      (sh.duplicates || []).filter(function (d) { return d.table === ti; }).forEach(function (d) {
        box.appendChild(h('p', { class: 'name-note ng', text: t('colsDup', { field: t('field.' + d.field), cols: d.cols.join('・') }) }));
      });
      details.appendChild(box);
    });

    if (sh.remembered) details.appendChild(h('p', { class: 'name-note', text: t('colsRemembered') }));
    if (Object.keys(sh.overrides || {}).length) {
      details.appendChild(h('p', { class: 'small' }, [h('button', { type: 'button', class: 'link-btn', text: t('colsReset'), onclick: function () {
        sh.overrides = {};
        savePrefs(sh);
        sh.colsOpen = true;
        renderReview();
      } })]));
    }
    return details;
  }

  // page: 何枚目ぶんを作るか（0 が元の様式。2枚目以降は写した様式に同じ形で書く）
  function computeSheet(sh, page) {
    var keep = null;
    if (page) { keep = sh.found; sh.found = foundFromPicks(sh, page); }
    try { return computeSheet_(sh); }
    finally { if (keep) sh.found = keep; }
  }

  function computeSheet_(sh) {
    var mapping = withFmt(sh);
    // ★ 年齢区分は、申込書に書かれていなければ本人が④で貼り付けたものを使う（要項の文）
    if (sh.ageClassesRaw) {
      mapping.ageClasses = M.ageClassesIn(sh.ageClassesRaw);
      mapping.ageClassesRaw = sh.ageClassesRaw;
    }
    var entries = entriesOf(sh).filter(function (e) { return memberOf(sh, e); });
    var anchorOf = function (r) { return X.anchorOf(state.form.book, sh.index, r); };
    var res = M.slotsFor(mapping, entries.map(function (e) { return e.n; }), { cells: sh.cells, anchorOf: anchorOf,
      // ★ 斜線が引いてある欄には書かない（「書かなくてよい」の意味。百万石の監督の行）
      crossedOut: function (ref) { return X.crossedOut(state.form.book, sh.index, ref); } });
    var base = sh.baseDate || mapping.baseDate;
    var people = res.slots.map(function (slot) {
      var e = entries.filter(function (x) { return x.n === slot.name; })[0];
      var member = memberOf(sh, e);
      return { entry: e, member: member, slot: slot,
        fill: R.fill(member, slot, { baseDate: base, dropPref: state.dropPref && state.dropPref.pref }) };
    });
    var groups = res.groups.map(function (g, gi) {
      var ages = g.slots.map(function (i) { return people[i] ? people[i].fill.age : null; });
      var ok = ages.length && ages.every(function (a) { return a != null; });
      var members = g.slots.map(function (i) { return people[i] && people[i].member; }).filter(Boolean);
      // ★ ダブルスの種目（男子／女子／混合）。組の性別から決め、本人が直せる（2026-09-18）
      var key = sh.index + '#' + (g.event || g.ageSum || gi);
      var auto = eventOf(members);
      var chosen = sh.events && sh.events[key];
      var sum = ok ? ages.reduce(function (s, a) { return s + a; }, 0) : null;
      return { ref: g.ageSum, ages: ages, sum: sum,
        eventRef: g.event, members: members, size: g.size || g.slots.length, key: key,
        event: chosen || auto, autoEvent: auto, warn: eventWarning(chosen || auto, members),
        // ★ 年齢区分（申込書に書かれている区分から、合計年齢で決める。2026-09-19）
        ageClass: M.ageClassOf(mapping.ageClasses, sum) };
    });
    var writes = [];
    // ★ 空の申込書では、名前もこちらが書く（名前が書いてある申込書では、名前はもう入っている）
    if (sh.blank) {
      people.forEach(function (p) {
        var refs = p.entry.n.refs, m = p.member;
        if (refs.length >= 2) {
          writes.push({ ref: refs[0], value: m.family || m.name });
          writes.push({ ref: refs[1], value: m.given || '' });
        } else {
          writes.push({ ref: refs[0], value: m.name });
        }
      });
    }
    people.forEach(function (p) { p.fill.writes.forEach(function (w) { writes.push(w); }); });
    groups.forEach(function (g) {
      if (g.sum != null && g.ref) writes.push({ ref: g.ref, value: g.sum });
      // 組がそろっている（2人とも入っている）ときだけ、種目の欄に書く。
      // ★ その欄に「種目」を書くか「年齢区分」を書くかは本人が選ぶ（百万石は年齢区分を書く欄だった）
      if (g.eventRef && g.members.length === g.size) {
        var what = sh.eventWrite || 'event';
        if (what === 'event' && g.event) {
          writes.push({ ref: g.eventRef, value: t('event.' + g.event + '.' + (sh.eventFmt || 'short')) });
        } else if (what === 'ageClass' && g.ageClass) {
          writes.push({ ref: g.eventRef, value: g.ageClass.mark });
        }
      }
    });
    // ★ 同じ欄への書き込みが重なっていたら、先のほうだけ残す（2026-09-20）。
    //   空の申込書では名前をこちらが書くが、欄ごとの書き込みにも名前が入っていて二重になり、
    //   「24か所に書き込みます」のように件数が水増しされていた（値は同じなので害は無かった）。
    //   先のほうを残すのは、書く順番を変えないため
    var seen = {}, once = [];
    writes.forEach(function (w) {
      if (seen[w.ref]) return;
      seen[w.ref] = true;
      once.push(w);
    });
    return { mapping: mapping, res: res, base: base, people: people, groups: groups, writes: once };
  }

  function display(v) { return v == null ? '' : String(v); }

  /* ===== ダブルスの種目（2026-09-18、本人の要望） ===== */
  // 組の性別から種目を決める。男男→男子、女女→女子、男女→混合。
  // ★ 男子ダブルスに女子が入ってもよい大会があるので、④で「男子」に直せる（決めつけない）
  function eventOf(members) {
    if (!members.length) return '';
    var men = members.filter(function (m) { return m.gender === '男'; }).length;
    var women = members.filter(function (m) { return m.gender === '女'; }).length;
    if (men && !women) return 'men';
    if (women && !men) return 'women';
    return 'mixed';
  }
  // 決まりに合わない組を知らせる。★ 男子に女子が入るのは（本人の大会の決まりで）可なので知らせない
  function eventWarning(event, members) {
    if (!event || members.length < 2) return '';
    var men = members.filter(function (m) { return m.gender === '男'; }).length;
    var women = members.filter(function (m) { return m.gender === '女'; }).length;
    if (event === 'women' && men) return 'women-has-man';
    if (event === 'mixed' && (men !== 1 || women !== 1)) return 'mixed-not-pair';
    return '';
  }

  // ★ この申込書に書く人のうち、いちばん多い都道府県。単独で最多なら省いて市区町村から書く
  //   （2026-09-18、本人の要望。ほとんどが同じ県なので、そのほうが読みやすい）。
  //   同数で並んだら省かない（どちらを省いても分かりにくいため）
  function majorityPref() {
    var counts = {}, total = 0;
    state.sheets.forEach(function (sh) {
      entriesOf(sh).forEach(function (e) {
        var m = memberOf(sh, e);
        if (!m || !m.pref || !m.addressRest) return;
        counts[m.pref] = (counts[m.pref] || 0) + 1;
        total++;
      });
    });
    var prefs = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    if (!prefs.length) return null;
    if (prefs.length > 1 && counts[prefs[0]] === counts[prefs[1]]) return null;   // 同数で並んだ
    return { pref: prefs[0], n: counts[prefs[0]], total: total };
  }

  function renderReview() {
    var body = clear(el('reviewBody'));
    var total = 0, waitingBirth = 0;
    state.dropPref = majorityPref();
    state.sheets.forEach(function (sh) {
      var bi = birthInstruction(sh);
      sh.birthNeeded = bi.needed;
      if (bi.needed && sh.birthStyle == null) sh.birthStyle = lsGet(BIRTH_STYLE_LS) || null;
      if (bi.needed && !sh.birthStyle) waitingBirth++;
      var c = computeSheet(sh);
      total += c.writes.length;
      // ★ 2枚目以降も同じだけ書く。④の件数に入れないと、保存の数と合わない（2026-09-20）
      for (var pg = 1; pg < pagesOf(sh); pg++) total += computeSheet(sh, pg).writes.length;
      var sec = h('div', { class: 'sheet' }, [h('h3', { text: t('sheetTitle', { name: sh.name }) })]);

      // 基準日
      var dateVal = c.base ? [c.base.y, ('0' + c.base.m).slice(-2), ('0' + c.base.d).slice(-2)].join('-') : '';
      var dateInput = h('input', { type: 'date', value: dateVal, onchange: function (ev) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ev.target.value);
        sh.baseDate = m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
        renderReview();
      } });
      var usesAge = c.mapping.tables.some(function (tb) { return tb.fields.some(function (f) { return f.field === 'age'; }); });
      sec.appendChild(h('div', { class: 'field' }, [
        h('label', { text: t('baseDateLabel') }), dateInput,
        h('p', { class: 'hint', text: c.mapping.baseDateRaw ? t('baseDateFrom', { raw: c.mapping.baseDateRaw }) : t('baseDateNone') }),
        (usesAge && !c.base) ? h('p', { class: 'name-note ng', text: t('baseDateNeeded') }) : null
      ]));

      // 書く欄の対応（申込書の列 → 書くもの）。見出しの規則の見落とし・誤爆を本人が直す
      sec.appendChild(colsBox(sh, c.mapping));

      // 生年月日は西暦か和暦か
      if (bi.needed) sec.appendChild(birthStyleBox(sh));
      else if (bi.has) sec.appendChild(h('p', { class: 'hint', text: t('birthFollowsForm', { style: t('birthStyleName.' + bi.hint) }) }));

      // 書き方（複数の書き方がある欄だけ）
      var fmtFields = [];
      c.mapping.tables.forEach(function (tb) {
        tb.fields.forEach(function (f) {
          if (M.FIELDS[f.field] && M.FIELDS[f.field].length > 1 && fmtFields.indexOf(f.field) < 0) fmtFields.push(f.field);
        });
      });
      if (fmtFields.length) {
        var fmtBox = h('div', { class: 'col-grid' });
        fmtFields.forEach(function (field) {
          var current = sh.fmt[field] || (c.mapping.tables.map(function (tb) {
            return (tb.fields.filter(function (f) { return f.field === field; })[0] || {}).fmt;
          }).filter(Boolean)[0]);
          var sel = h('select', { onchange: function (ev) {
            sh.fmt[field] = ev.target.value;
            savePrefs(sh);   // 選び直した書き方は、次に同じ様式を使うときも効くように覚える
            renderReview();
          } });
          M.FIELDS[field].forEach(function (f) { sel.appendChild(h('option', { value: f, text: t('fmt.' + field + '.' + f) })); });
          sel.value = current;
          fmtBox.appendChild(h('label', { class: 'col-item' }, [h('span', { text: t('field.' + field) }), sel]));
        });
        sec.appendChild(h('p', { class: 'sub-title', text: t('fmtTitle') }));
        sec.appendChild(fmtBox);
      }
      // 住所の県名を省いたときは、そう書いたことを見せる（黙って省かない）
      var writesAddress = c.mapping.tables.some(function (tb) {
        return tb.fields.some(function (f) { return f.field === 'address' && f.fmt !== 'keep-pref'; });
      });
      if (state.dropPref && writesAddress) {
        sec.appendChild(h('p', { class: 'hint', text: t('dropPrefNote', state.dropPref) }));
      }

      // 表：人ごとに書く値
      var cols = [];
      c.people.forEach(function (p) {
        p.slot.fields.forEach(function (f) { if (cols.indexOf(f.field) < 0) cols.push(f.field); });
      });
      // 列の見出しに、申込書側の見出しの文字も並べる。規則の読み違い（「年齢区分」の列に年齢など）に気づけるように
      var headersOf = {};
      c.people.forEach(function (p) {
        p.slot.fields.forEach(function (f) {
          if (!f.header) return;
          headersOf[f.field] = headersOf[f.field] || [];
          if (headersOf[f.field].indexOf(f.header) < 0) headersOf[f.field].push(f.header);
        });
      });
      var table = h('table', { class: 'review' });
      table.appendChild(h('thead', {}, [h('tr', {}, cols.map(function (f) {
        return h('th', {}, [
          h('span', { text: fieldLabel(f) }),
          headersOf[f] ? h('span', { class: 'form-header', text: t('formHeader', { text: headersOf[f].join('／') }) }) : null
        ]);
      }))]));
      var tbody = h('tbody');
      c.people.forEach(function (p) {
        var byField = {};
        p.slot.fields.forEach(function (f) {
          var w = p.fill.writes.filter(function (x) { return x.ref === f.ref; })[0];
          byField[f.field] = { ref: f.ref, value: w ? w.value : null, written: !!w };
        });
        tbody.appendChild(h('tr', {}, cols.map(function (f) {
          var v = byField[f];
          if (!v) return h('td', { class: 'none', text: '—' });
          return h('td', { class: v.written ? '' : 'miss', title: v.ref }, [
            h('span', { class: 'val', text: v.written ? (display(v.value) || t('blankMark')) : t('missMark') }),
            h('span', { class: 'cell-ref', text: v.ref })
          ]);
        })));
      });
      table.appendChild(tbody);
      sec.appendChild(h('div', { class: 'table-wrap' }, [table]));

      // 合計年齢
      if (c.groups.some(function (g) { return g.ref; })) {
        var gl = h('ul', { class: 'plain' });
        c.groups.forEach(function (g) {
          if (!g.ref) return;
          var line = g.sum != null
            ? t('groupSum', { ref: g.ref, ages: g.ages.join(' + '), sum: g.sum })
            : t('groupSumMissing', { ref: g.ref });
          // ★ 申込書に年齢区分が書かれていれば、合計年齢から区分も見せる
          if (g.sum != null && g.ageClass) line += t('ageClassSuffix', { mark: g.ageClass.mark, text: g.ageClass.text });
          gl.appendChild(h('li', { text: line }));
        });
        sec.appendChild(h('p', { class: 'sub-title', text: t('groupTitle') }));
        sec.appendChild(gl);
      }

      // ★ 年齢区分（2026-09-19）。申込書に書かれていないこともある（要項にはある）ので、
      //   要項の文を貼り付けて読ませる。読んだ区分はその申込書について覚える
      if (c.groups.length) {
        sec.appendChild(h('p', { class: 'sub-title', text: t('ageClassTitle') }));
        var fromForm = (sh.mapping && sh.mapping.ageClassesRaw) || '';
        if (fromForm) sec.appendChild(h('p', { class: 'hint', text: t('ageClassFrom', { raw: fromForm }) }));
        var classInput = h('input', { type: 'text', value: sh.ageClassesRaw || '', placeholder: t('ageClassPlaceholder') });
        var applyClasses = function () {
          sh.ageClassesRaw = classInput.value.trim();
          savePrefs(sh);
          renderReview();
        };
        classInput.addEventListener('change', applyClasses);
        sec.appendChild(h('div', { class: 'field' }, [
          h('label', { text: t('ageClassInput') }), classInput,
          h('p', { class: 'hint', text: c.mapping.ageClasses.length
            ? t('ageClassRead', { n: c.mapping.ageClasses.length, list: c.mapping.ageClasses.map(function (x) { return x.text; }).join(' / ') })
            : t('ageClassNotRead') })
        ]));
      }

      // ★ ダブルスの種目（組ごと）。性別から決めたものを見せ、選び直せる
      var eventGroups = c.groups.filter(function (g) { return g.eventRef; });
      if (eventGroups.length) {
        sec.appendChild(h('p', { class: 'sub-title', text: t('eventTitle') }));
        // ★ その欄に何を書くか（種目／年齢区分／書かない）。百万石は年齢区分を書く欄だった
        var whatSel = h('select', { onchange: function (ev) { sh.eventWrite = ev.target.value; renderReview(); } });
        [['event', t('eventWrite.event')], ['ageClass', t('eventWrite.ageClass')], ['none', t('eventWrite.none')]]
          .forEach(function (o) {
            if (o[0] === 'ageClass' && !c.mapping.ageClasses.length) return;   // 区分が書かれていない申込書では出さない
            whatSel.appendChild(h('option', { value: o[0], text: o[1] }));
          });
        whatSel.value = sh.eventWrite || 'event';
        sec.appendChild(h('p', { class: 'small' }, [h('span', { text: t('eventWriteTitle') + '：' }), whatSel]));
        sec.appendChild(h('p', { class: 'hint', text: t('eventNote') }));
        var el2 = h('ul', { class: 'plain' });
        eventGroups.forEach(function (g) {
          var li = h('li', { class: 'event-row' });
          if (g.members.length < g.size || !g.event) {
            li.appendChild(h('span', { text: t('eventRowNone', { ref: g.eventRef }) }));
          } else {
            li.appendChild(h('span', { text: t('eventRow', { ref: g.eventRef,
              names: g.members.map(function (m) { return m.name; }).join('・'),
              event: t('event.' + g.event + '.' + (sh.eventFmt || 'short')) }) }));
            var sel = h('select', { onchange: function (ev) {
              sh.events = sh.events || {};
              sh.events[g.key] = ev.target.value;
              renderReview();
            } });
            ['men', 'women', 'mixed'].forEach(function (k) {
              sel.appendChild(h('option', { value: k, text: t('event.' + k + '.long') }));
            });
            sel.value = g.event;
            li.appendChild(sel);
            if (g.warn) li.appendChild(h('span', { class: 'event-warn', text: t('eventWarn.' + g.warn) }));
          }
          el2.appendChild(li);
        });
        sec.appendChild(el2);
        // 書き方（男子／男子ダブルス）
        var fmtSel = h('select', { onchange: function (ev) { sh.eventFmt = ev.target.value; renderReview(); } });
        ['short', 'long'].forEach(function (k) {
          fmtSel.appendChild(h('option', { value: k, text: t('eventFmt.' + k) }));
        });
        fmtSel.value = sh.eventFmt || 'short';
        sec.appendChild(h('p', { class: 'small' }, [h('span', { text: t('eventFmtTitle') + '：' }), fmtSel]));
      }

      // ★ 参加料（2026-09-19、本人の要望）。計算して見せるだけで、申込書には書かない
      //   （書く場所は様式ごとに違い、文の途中の空欄のこともあるため）
      var fee = c.mapping.fee;
      var fullGroups = c.groups.filter(function (g) { return g.members.length === g.size; }).length;
      var counts = { people: c.people.length, groups: fullGroups, sheet: 1 };
      if (fee || sh.feeManual) {
        sec.appendChild(h('p', { class: 'sub-title', text: t('feeTitle') }));
        if (fee) sec.appendChild(h('p', { class: 'hint', text: t('feeFrom', { raw: fee.text }) }));
        var priceInput = h('input', { type: 'number', class: 'row-num', value: String(sh.feePrice || (fee && fee.price) || ''), min: '0' });
        var countSel = h('select');
        // ★ 数え方は大会ごとに違う（1人いくら／1組いくら／1チームいくら）。選ぶまで計算しない
        countSel.appendChild(h('option', { value: '', text: t('feeCount.choose') }));
        [['people', t('feeCount.people', { n: counts.people })],
         ['groups', t('feeCount.groups', { n: counts.groups })],
         ['sheet', t('feeCount.sheet')],
         ['manual', t('feeCount.manual')]].forEach(function (o) {
          if (o[0] === 'groups' && !c.groups.length) return;
          countSel.appendChild(h('option', { value: o[0], text: o[1] }));
        });
        countSel.value = sh.feeCount || '';
        var manualInput = h('input', { type: 'number', class: 'row-num', value: String(sh.feeManual || ''), min: '0' });
        manualInput.hidden = countSel.value !== 'manual';
        var n = countSel.value === 'manual' ? Number(sh.feeManual || 0) : counts[countSel.value];
        var price = Number(priceInput.value || 0);
        var apply = function () {
          sh.feePrice = Number(priceInput.value || 0);
          sh.feeCount = countSel.value;
          sh.feeManual = manualInput.value;
          savePrefs(sh);
          renderReview();
        };
        [priceInput, countSel, manualInput].forEach(function (x) { x.addEventListener('change', apply); });
        var line = h('p', { class: 'small fee-line' }, [
          priceInput, h('span', { text: t('feeYenTimes') }), countSel, manualInput,
          h('span', { class: 'fee-total', text: (countSel.value && price && n)
            ? t('feeTotal', { total: (price * n).toLocaleString('ja-JP'), n: n })
            : t('feeTotalWait') })
        ]);
        sec.appendChild(line);
        sec.appendChild(h('p', { class: 'hint', text: t('feeNote') }));
      }

      // 知らせること
      // 同じ欄・同じ理由はまとめて1行にする（「フリガナは名簿に無い」が人数ぶん並ぶと、大事な知らせが埋もれる）
      var notes = [], grouped = {}, order = [];
      c.people.forEach(function (p) {
        p.fill.problems.forEach(function (pr) {
          var k = pr.field + '|' + pr.code;
          if (!grouped[k]) { grouped[k] = []; order.push(k); }
          grouped[k].push(p.member.name);
        });
      });
      order.forEach(function (k) {
        var parts = k.split('|');
        notes.push(fieldLabel(parts[0]) + ' ' + t('note.' + parts[1]) + t('noteWho', { list: grouped[k].join('、'), n: grouped[k].length }));
      });
      // 書かない欄も、理由ごとに1行にまとめる（1行ずれた答えだと、人数×4欄が並ぶ）
      var skipBy = {}, skipOrder = [];
      c.res.problems.forEach(function (pr) {
        if (!skipBy[pr.code]) { skipBy[pr.code] = { refs: [], fields: [] }; skipOrder.push(pr.code); }
        var s = skipBy[pr.code];
        if (pr.ref && s.refs.indexOf(pr.ref) < 0) s.refs.push(pr.ref);
        if (pr.field && s.fields.indexOf(pr.field) < 0) s.fields.push(pr.field);
      });
      skipOrder.forEach(function (code) {
        var s = skipBy[code];
        notes.push(t('skipGroup.' + code, {
          fields: s.fields.map(fieldLabel).join('・'),
          refs: s.refs.length > 6 ? s.refs.slice(0, 6).join('、') + ' ' + t('andMore', { n: s.refs.length - 6 }) : s.refs.join('、'),
          n: s.refs.length
        }));
      });
      c.mapping.problems.forEach(function (pr) {
        notes.push(has('mapprob.' + pr.code) ? t('mapprob.' + pr.code, pr) : t('err.other', { code: pr.code }));
      });
      if (notes.length) {
        var nl = h('ul', { class: 'plain notes' });
        notes.forEach(function (n) { nl.appendChild(h('li', { text: n })); });
        sec.appendChild(h('p', { class: 'sub-title', text: t('notesTitle', { n: notes.length }) }));
        sec.appendChild(nl);
      }
      // 書かない列（決められなかった列と、本人が「書かない」にした列）。本人の直しを反映した一覧から作る
      var notWritten = [], seenCol = {};
      c.mapping.tables.forEach(function (tb) {
        (tb.cols || []).forEach(function (x) {
          if (x.field == null && !seenCol[x.col]) { seenCol[x.col] = true; notWritten.push(x.col + '列 ' + x.header); }
        });
      });
      if (notWritten.length) sec.appendChild(h('p', { class: 'hint', text: t('extras', { list: notWritten.join('、') }) }));
      body.appendChild(sec);
      sh.computed = c;
    });
    show('stepSave');
    el('saveBtn').disabled = total === 0 || waitingBirth > 0;
    if (waitingBirth) setMsg('saveMsg', t('saveWaitBirth'), 'ng');
    else setMsg('saveMsg', total ? t('saveReady', { n: total }) : t('saveNothing'), total ? '' : 'ng');
  }

  /* ===== ⑥ 保存 ===== */
  function onSave() {
    var btn = el('saveBtn');
    btn.disabled = true;
    setMsg('saveMsg', t('saving'), 'wait');
    // 元のバイト列から開き直して書く（確認画面で選び直しても、書き込みが重ならないように）
    X.open(state.form.bytes).then(function (book) {
      var failed = [], count = 0, added = 0;

      // ★ 2枚目以降は「書く前に」写す。書いたあとに写すと、1枚目の名前まで写ってしまう。
      //   シートを足すと後ろのシートの番号がずれるので、**うしろから**作り、
      //   書くときは番号ではなく名前で引く（2026-09-20）
      var plan = state.sheets.map(function (sh) {
        return { sh: sh, names: [X.sheetNames(book)[sh.index]] };
      });
      for (var i = state.sheets.length - 1; i >= 0; i--) {
        var sh = state.sheets[i], P = pagesOf(sh);
        if (P < 2) continue;
        var base = X.sheetNames(book)[sh.index];
        for (var p = P - 1; p >= 1; p--) {     // うしろの枚数から作ると、並びが 1,2,3… になる
          var pos = X.copySheet(book, sh.index, base + ' (' + (p + 1) + ')');
          plan[i].names[p] = X.sheetNames(book)[pos];
          added++;
        }
      }

      plan.forEach(function (pl) {
        pl.names.forEach(function (name, page) {
          var idx = X.sheetNames(book).indexOf(name);
          if (idx < 0) return;
          computeSheet(pl.sh, page).writes.forEach(function (w) {
            var r = X.setCell(book, idx, w.ref, w.value, { shrink: el('shrinkChk').checked });
            if (r.ok) count++; else failed.push(name + ' ' + r.ref + '（' + t('skip.target-is-formula', { ref: r.ref, field: '' }) + '）');
          });
        });
      });
      return X.save(book).then(function (bytes) {
        var name = state.form.name.replace(/\.xlsx$/i, '') + t('fileSuffix') + '.xlsx';
        var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        var url = URL.createObjectURL(blob);
        var a = h('a', { href: url, download: name });
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
        setMsg('saveMsg', t('saved', { name: name, n: count }) +
          (added ? ' ' + t('savedPages', { n: added }) : '') +
          (failed.length ? ' ' + t('savedFailed', { list: failed.join('、') }) : ''), 'ok');
        btn.disabled = false;
      });
    }).catch(function (e) {
      setMsg('saveMsg', errText(e), 'ng');
      btn.disabled = false;
    });
  }

  /* ===== 段の出し入れ ===== */
  var STEPS = ['stepNames', 'stepReview', 'stepSave'];
  function show(id) { el(id).hidden = false; }
  function hideFrom(id) {
    var i = STEPS.indexOf(id);
    STEPS.slice(i).forEach(function (s) { el(s).hidden = true; });
  }

  /* ===== 配線 ===== */
  function wireDrop(zoneId, inputId, pickId, handler) {
    var zone = el(zoneId), input = el(inputId);
    var pick = function () { input.value = ''; input.click(); };
    zone.addEventListener('click', pick);
    zone.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
    el(pickId).addEventListener('click', function (ev) { ev.stopPropagation(); pick(); });
    input.addEventListener('change', function () { if (input.files && input.files[0]) handler(input.files[0]); });
    ['dragenter', 'dragover'].forEach(function (n) {
      zone.addEventListener(n, function (ev) { ev.preventDefault(); zone.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (n) {
      zone.addEventListener(n, function (ev) { ev.preventDefault(); zone.classList.remove('over'); });
    });
    zone.addEventListener('drop', function (ev) {
      var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f) handler(f);
    });
  }

  wireDrop('formDrop', 'formInput', 'formPick', onForm);
  wireDrop('rosterDrop', 'rosterInput', 'rosterPick', onRosterFile);
  el('rosterNew').addEventListener('click', function (ev) { ev.stopPropagation(); onNewRoster(); });
  el('rosterClose').addEventListener('click', onCloseRoster);
  el('attendOpen').addEventListener('click', function (ev) { ev.stopPropagation(); onAttendOpen(); });
  el('orgInput').addEventListener('input', function () { if (state.book) { state.book.org = el('orgInput').value; markDirty(); } });
  // ★ 名簿はブラウザに覚えないので、保存しないまま閉じると消える
  window.addEventListener('beforeunload', function (ev) {
    if (!state.dirty) return;
    ev.preventDefault();
    ev.returnValue = '';
  });
  el('namesNext').addEventListener('click', onNamesNext);
  el('saveBtn').addEventListener('click', onSave);
  // 縮小して全体を表示: 既定は入れる。外した人には外したまま覚えておく
  el('shrinkChk').checked = lsGet(SHRINK_LS) !== 'off';
  el('shrinkChk').addEventListener('change', function () { lsSet(SHRINK_LS, el('shrinkChk').checked ? 'on' : 'off'); });})();
