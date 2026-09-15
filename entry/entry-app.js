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
      B = window.EntryBook, P = window.EntryPostal;

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
  var state = { form: null, book: null, roster: null, sheets: [], tab: null, editing: null, filter: '', dirty: false };

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

  // ===== 1人ぶんの入力 =====
  var PF = ['family', 'given', 'kanaFamily', 'kanaGiven', 'birthText', 'postal', 'pref', 'address', 'phone'];

  function editingPerson() {
    var e = state.editing;
    if (e.index == null) return { family: '', given: '', kanaFamily: '', kanaGiven: '', birthText: '',
      postal: '', pref: '', address: '', phone: '', extras: [] };
    var p = peopleOf(e.gender)[e.index];
    var copy = { extras: (p.extras || []).slice() };
    PF.forEach(function (k) { copy[k] = k === 'birthText' ? (p.birth ? p.birth.y + '/' + p.birth.m + '/' + p.birth.d : (p.birthText || '')) : (p[k] || ''); });
    return copy;
  }

  function field(id, label, value, opts) {
    var input = h('input', { type: 'text', id: 'pf-' + id, value: value || '', autocomplete: 'off' });
    if (opts && opts.oninput) input.addEventListener('input', opts.oninput);
    if (opts && opts.onchange) input.addEventListener('change', opts.onchange);
    if (opts && opts.mode) input.setAttribute('inputmode', opts.mode);
    return h('div', { class: 'pf-item' + (opts && opts.wide ? ' wide' : '') },
      [h('label', { for: 'pf-' + id, text: label }), input]);
  }
  function pfVal(id) { return el('pf-' + id) ? el('pf-' + id).value : ''; }

  function personForm() {
    var p = editingPerson();
    var box = h('div', { class: 'person-form' });
    box.appendChild(h('p', { class: 'sub-title',
      text: state.editing.index == null ? t('formAdd', { g: state.editing.gender }) : t('formEdit', { g: state.editing.gender }) }));

    var grid = h('div', { class: 'pf-grid' }, [
      field('family', t('colFamily'), p.family),
      field('given', t('colGiven'), p.given),
      field('kanaFamily', t('colKanaFamily'), p.kanaFamily, { onchange: function (ev) { ev.target.value = toKatakana(ev.target.value); } }),
      field('kanaGiven', t('colKanaGiven'), p.kanaGiven, { onchange: function (ev) { ev.target.value = toKatakana(ev.target.value); } }),
      field('birthText', t('colBirth'), p.birthText, { oninput: showBirth }),
      field('postal', t('colPostal'), p.postal, { mode: 'numeric', oninput: onPostalInput }),
      field('pref', t('colPref'), p.pref),
      field('address', t('colAddress'), p.address, { wide: true }),
      field('phone', t('colPhone'), p.phone, { mode: 'tel' })
    ]);
    box.appendChild(grid);
    box.appendChild(h('p', { class: 'msg', id: 'pfBirthMsg' }));
    box.appendChild(h('div', { id: 'pfPostal' }));
    box.appendChild(h('p', { class: 'msg', id: 'pfMsg' }));
    box.appendChild(h('div', { class: 'btns' }, [
      h('button', { type: 'button', text: t('formOkBtn'), onclick: onPersonSave }),
      h('button', { type: 'button', class: 'btn-sub', text: t('formCancel'),
        onclick: function () { state.editing = null; renderRoster(); } })
    ]));
    setTimeout(function () { if (el('pf-family')) el('pf-family').focus(); showBirth(); }, 0);
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
    var p = { extras: editingPerson().extras };
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

    if (e.index == null) list.push(p); else list[e.index] = p;
    state.editing = null;
    markDirty();
    rebuildRoster();
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
    book.sheets.forEach(function (s, i) {
      if (s.state && s.state !== 'visible') return;   // 隠しシートは見ない
      var cells = X.cells(book, i);
      var found = R.findNames(cells, state.roster);
      if (!found.names.length && !found.suspects.length) return;
      state.sheets.push({ index: i, name: s.name, cells: cells, merges: X.merges(book, i), found: found,
        pick: {}, key: null, mapping: null, fmt: {}, baseDate: null });
    });
    hideFrom('stepNames');
    show('stepNames');
    if (!state.sheets.length) {
      clear(el('namesBody'));
      setMsg('namesMsg', t('noNamesFound'), 'ng');
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

  function renderNames() {
    var body = clear(el('namesBody'));
    state.sheets.forEach(function (sh) {
      var sec = h('div', { class: 'sheet' }, [h('h3', { text: t('sheetTitle', { name: sh.name }) })]);
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
        }

        var m = memberOf(sh, e);
        if (m) {
          if (chosen[m.key]) li.appendChild(h('p', { class: 'name-note ng', text: t('nameDuplicate', { ref: chosen[m.key] }) }));
          else chosen[m.key] = e.n.refs[0];
        }
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      body.appendChild(sec);
    });
    var left = unresolvedCount();
    el('namesNext').disabled = left > 0;
    setMsg('namesMsg', left ? t('namesLeft', { n: left }) : t('namesReady'), left ? 'wait' : 'ok');
    hideFrom('stepReview');
  }

  /* ===== 欄の対応（見出しの規則。AI は使わない） ===== */
  // 規則は一瞬で終わるので、③の「次へ」でそのまま④へ進む。
  // 様式ごとに覚えるのは、本人が④で選び直した書き方（fmt）と書く欄（fields）だけ（EntryMap.prefs。個人情報は入らない）
  function onNamesNext() {
    Promise.all(state.sheets.map(function (sh) {
      sh.mapping = M.normalize(window.EntryRules.map(sh.cells, sh.merges, sh.found));
      return M.formKey(sh.name, sh.cells, sh.merges, sh.found).then(function (k) {
        sh.key = k;
        var saved = M.prefs.get(k);
        sh.fmt = (saved && saved.fmt) || {};
        sh.overrides = (saved && saved.fields) || {};
        sh.colsOpen = null;   // null = 決められなかった列があるときだけ開く。本人が開け閉めしたらそれに従う
      });
    })).then(function () {
      show('stepReview');
      renderReview();
      el('stepReview').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (e) { setMsg('namesMsg', errText(e), 'ng'); });
  }

  /* ===== ④ 書き込む内容の確認 ===== */
  // 本人の直し（書く欄の選び直し）を当てはめた対応。以降の判定（生年月日の問い・書き方・値の表）はすべてこれを使う
  function effectiveMapping(sh) {
    var r = M.applyOverrides(sh.mapping, sh.overrides);
    sh.duplicates = r.duplicates;
    return r.mapping;
  }
  function savePrefs(sh) { M.prefs.put(sh.key, { fmt: sh.fmt, fields: sh.overrides }); }

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

  function computeSheet(sh) {
    var mapping = withFmt(sh);
    var entries = entriesOf(sh).filter(function (e) { return memberOf(sh, e); });
    var anchorOf = function (r) { return X.anchorOf(state.form.book, sh.index, r); };
    var res = M.slotsFor(mapping, entries.map(function (e) { return e.n; }), { cells: sh.cells, anchorOf: anchorOf });
    var base = sh.baseDate || mapping.baseDate;
    var people = res.slots.map(function (slot) {
      var e = entries.filter(function (x) { return x.n === slot.name; })[0];
      var member = memberOf(sh, e);
      return { entry: e, member: member, slot: slot, fill: R.fill(member, slot, { baseDate: base }) };
    });
    var groups = res.groups.map(function (g) {
      var ages = g.slots.map(function (i) { return people[i] ? people[i].fill.age : null; });
      var ok = ages.length && ages.every(function (a) { return a != null; });
      return { ref: g.ageSum, ages: ages, sum: ok ? ages.reduce(function (s, a) { return s + a; }, 0) : null };
    });
    var writes = [];
    people.forEach(function (p) { p.fill.writes.forEach(function (w) { writes.push(w); }); });
    groups.forEach(function (g) { if (g.sum != null) writes.push({ ref: g.ref, value: g.sum }); });
    return { mapping: mapping, res: res, base: base, people: people, groups: groups, writes: writes };
  }

  function display(v) { return v == null ? '' : String(v); }

  function renderReview() {
    var body = clear(el('reviewBody'));
    var total = 0, waitingBirth = 0;
    state.sheets.forEach(function (sh) {
      var bi = birthInstruction(sh);
      sh.birthNeeded = bi.needed;
      if (bi.needed && sh.birthStyle == null) sh.birthStyle = lsGet(BIRTH_STYLE_LS) || null;
      if (bi.needed && !sh.birthStyle) waitingBirth++;
      var c = computeSheet(sh);
      total += c.writes.length;
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
          h('span', { text: t('field.' + f) }),
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
      if (c.groups.length) {
        var gl = h('ul', { class: 'plain' });
        c.groups.forEach(function (g) {
          gl.appendChild(h('li', { text: g.sum != null
            ? t('groupSum', { ref: g.ref, ages: g.ages.join(' + '), sum: g.sum })
            : t('groupSumMissing', { ref: g.ref }) }));
        });
        sec.appendChild(h('p', { class: 'sub-title', text: t('groupTitle') }));
        sec.appendChild(gl);
      }

      // 知らせること
      // 同じ欄・同じ理由はまとめて1行にする（「フリガナは名簿に無い」が人数ぶん並ぶと、大事な知らせが埋もれる）
      var notes = [], grouped = {}, order = [];
      c.people.forEach(function (p) {
        p.fill.problems.forEach(function (pr) {
          if (pr.code === 'age-differs') {
            notes.push(t('note.age-differs', { who: p.member.name + '（' + p.slot.fields[0].ref + '）', roster: pr.roster, computed: pr.computed }));
            return;
          }
          var k = pr.field + '|' + pr.code;
          if (!grouped[k]) { grouped[k] = []; order.push(k); }
          grouped[k].push(p.member.name);
        });
        if (p.member.problems.indexOf('phone-zero-restored') >= 0) notes.push(t('note.phone-zero-restored', { who: p.member.name }));
      });
      order.forEach(function (k) {
        var parts = k.split('|');
        notes.push(t('field.' + parts[0]) + ' ' + t('note.' + parts[1]) + t('noteWho', { list: grouped[k].join('、'), n: grouped[k].length }));
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
          fields: s.fields.map(function (f) { return t('field.' + f); }).join('・'),
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
      var failed = [], count = 0;
      state.sheets.forEach(function (sh) {
        var c = computeSheet(sh);
        c.writes.forEach(function (w) {
          var r = X.setCell(book, sh.index, w.ref, w.value, { shrink: el('shrinkChk').checked });
          if (r.ok) count++; else failed.push(sh.name + ' ' + r.ref + '（' + t('skip.target-is-formula', { ref: r.ref, field: '' }) + '）');
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
        setMsg('saveMsg', t('saved', { name: name, n: count }) + (failed.length ? ' ' + t('savedFailed', { list: failed.join('、') }) : ''), 'ok');
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
