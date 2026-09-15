// entry-app.js — 申込書ドロッパーの画面
//
// 流れ: ① 申込書（名前だけ書いた Excel）② 名簿（Excel / CSV）③ 名前の確認
//       ④ 欄の対応（前に使った様式なら AI を呼ばない。初めてなら送る内容を見せてから送る）
//       ⑤ 書き込む内容の確認 ⑥ 記入済みの申込書を保存
//
// ★ 名簿は端末の外に出さない。このファイルは Gemini（entry-ai.js 経由）以外と通信しない。
//   名簿の中身を console に出さないこと。画面に出すのは本人の端末の中だけ。
// ★ 名簿は覚えない（localStorage に入れない）。端末に保存するのは欄の対応（entry-ai.js の cache）と APIキーだけ。
// ★ 文言は entry-i18n.js。値（名前・住所など）は textContent で入れる（innerHTML を使わない）。
(function () {
  'use strict';

  var X = window.EntryXlsx, R = window.EntryRoster, AI = window.EntryAI;
  var AI_KEY_STORE = 'dropper_ai_key';   // ほかの3本と共通

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
    if (/^http-\d+/.test(code)) return t('err.http', { code: code.replace(/^http-/, '').replace(/:.*$/, '') });
    return has('err.' + code) ? t('err.' + code) : t('err.other', { code: code });
  }
  function ymdText(b) { return b ? t('dateText', { y: b.y, m: b.m, d: b.d }) : t('noBirth'); }
  function byPos(a, b) { return a.n.row - b.n.row || a.n.col - b.n.col; }

  var state = { form: null, rosterRows: null, roster: null, sheets: [] };

  /* ===== ① 申込書 ===== */
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

  /* ===== ② 名簿 ===== */
  function onRoster(file) {
    state.roster = null;
    state.rosterRows = null;
    hideFrom('stepNames');
    clear(el('rosterCols'));
    el('rosterColsCard').hidden = true;
    setMsg('rosterMsg', t('reading'), 'wait');
    readFile(file).then(function (bytes) {
      if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return R.rowsFromCsv(R.decodeCsv(bytes));
      if (/\.xls$/i.test(file.name)) { var e = new Error('xls-or-password'); e.code = 'xls-or-password'; throw e; }
      return X.open(bytes).then(function (book) {
        // 見出しの見つかるシートを使う（表紙のシートが先頭にある名簿がある）
        for (var i = 0; i < book.sheets.length; i++) {
          var rows = R.rowsFromCells(X.cells(book, i));
          if (R.guessColumns(rows)) return rows;
        }
        return R.rowsFromCells(X.cells(book, 0));
      });
    }).then(function (rows) {
      state.rosterRows = rows;
      var r = R.load(rows);
      if (!r.ok) { setMsg('rosterMsg', t('err.' + r.code), 'ng'); return; }
      state.roster = r;
      renderRoster();
      analyze();
    }).catch(function (e) { setMsg('rosterMsg', errText(e), 'ng'); });
  }

  var ROSTER_FIELDS = ['name', 'family', 'given', 'kana', 'gender', 'birth', 'age', 'postal', 'address', 'phone'];

  // 見つけた列を見せ、違っていれば選び直せるようにする
  function renderRoster() {
    var r = state.roster;
    var box = clear(el('rosterCols'));
    el('rosterColsCard').hidden = false;
    var header = state.rosterRows[r.headerRow] || [];
    var withProblems = r.members.filter(function (m) { return m.problems.length; });
    setMsg('rosterMsg', t('rosterOk', { n: r.members.length }) +
      (withProblems.length ? ' ' + t('rosterProblemsCount', { n: withProblems.length }) : ''), 'ok');

    var grid = h('div', { class: 'col-grid' });
    ROSTER_FIELDS.forEach(function (f) {
      var sel = h('select', { id: 'col-' + f, onchange: onColumnChange });
      sel.appendChild(h('option', { value: '', text: t('colNone') }));
      header.forEach(function (c, i) {
        var label = c && (typeof c === 'string' ? c : c.text);
        if (!label) return;
        sel.appendChild(h('option', { value: String(i), text: X.toRef(i + 1, r.headerRow + 1).replace(/\d+$/, '') + '列 ' + label }));
      });
      sel.value = r.columns[f] === undefined ? '' : String(r.columns[f]);
      grid.appendChild(h('label', { class: 'col-item' }, [h('span', { text: t('field.' + f) }), sel]));
    });
    box.appendChild(h('p', { class: 'hint', text: t('colHint') }));
    box.appendChild(grid);

    if (withProblems.length) {
      var ul = h('ul', { class: 'plain' });
      withProblems.forEach(function (m) {
        ul.appendChild(h('li', { text: t('rosterRow', { row: m.row, name: m.name }) + '：' +
          m.problems.map(function (p) { return t('prob.' + p); }).join('／') }));
      });
      box.appendChild(h('details', { class: 'more' }, [h('summary', { text: t('rosterProblemsTitle') }), ul]));
    }
  }

  function onColumnChange() {
    var cols = {};
    ROSTER_FIELDS.forEach(function (f) {
      var v = el('col-' + f).value;
      if (v !== '') cols[f] = Number(v);
    });
    if (cols.name === undefined && (cols.family === undefined || cols.given === undefined)) {
      setMsg('rosterMsg', t('err.no-name-col'), 'ng');
      hideFrom('stepNames');
      return;
    }
    var r = R.load(state.rosterRows, cols, state.roster.headerRow);
    state.roster = r;
    renderRoster();
    analyze();
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
        pick: {}, lay: null, key: null, mapping: null, fmt: {}, baseDate: null, fromCache: false });
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
    hideFrom('stepMap');
  }

  /* ===== ④ 欄の対応 ===== */
  function onNamesNext() {
    show('stepMap');
    var body = clear(el('mapBody'));
    setMsg('mapMsg', '', '');
    Promise.all(state.sheets.map(function (sh) {
      sh.lay = AI.layout(sh.name, sh.cells, sh.merges, sh.found);
      return AI.cacheKey(sh.lay).then(function (k) {
        sh.key = k;
        var cached = AI.cache.get(k);
        sh.mapping = cached;
        sh.fromCache = !!cached;
      });
    })).then(function () {
      state.sheets.forEach(function (sh) { body.appendChild(mapSection(sh)); });
      afterMapping();
    }).catch(function (e) { setMsg('mapMsg', errText(e), 'ng'); });
    el('stepMap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function mapSection(sh) {
    var sec = h('div', { class: 'sheet', id: 'map-' + sh.index }, [h('h3', { text: t('sheetTitle', { name: sh.name }) })]);
    var msg = h('p', { class: 'msg' });
    if (sh.mapping) {
      sec.appendChild(h('p', { class: 'name-note ok', text: sh.fromCache ? t('mapCached') : t('mapDone') }));
      sec.appendChild(h('p', { class: 'small' }, [h('button', { type: 'button', class: 'link-btn', text: t('mapAskAgain'), onclick: function () {
        AI.cache.forget(sh.key);
        sh.mapping = null;
        sh.fromCache = false;
        sec.parentNode.replaceChild(mapSection(sh), sec);
        afterMapping();
      } })]));
      return sec;
    }
    // 送る内容をそのまま見せる（名前は伏せ字）。これを見て本人がボタンを押したときだけ送る
    var lines = sh.lay.cells.map(function (c) { return c.ref + '\t' + c.text; }).join('\n');
    sec.appendChild(h('p', { class: 'hint', text: t('mapIntro') }));
    sec.appendChild(h('details', { class: 'more' }, [
      h('summary', { text: t('mapPreview', { n: sh.lay.cells.length }) }),
      h('pre', { class: 'preview', text: lines + (sh.lay.merges.length ? '\n\n' + t('mapMerges') + ' ' + sh.lay.merges.join(' ') : '') })
    ]));
    var btn = h('button', { type: 'button', text: t('mapSend'), onclick: function () {
      btn.disabled = true;
      askKey(false).then(function (key) {
        if (!key) { msg.textContent = t('err.no-key'); msg.className = 'msg ng'; btn.disabled = false; return null; }
        return AI.map(sh.lay, {
          apiKey: key, roster: state.roster, found: sh.found,
          onStatus: function (s) { if (has('status.' + s)) { msg.textContent = t('status.' + s); msg.className = 'msg wait'; } }
        }).then(function (mapping) {
          sh.mapping = mapping;
          sh.fromCache = false;
          if (mapping.tables.length) AI.cache.put(sh.key, mapping);
          sec.parentNode.replaceChild(mapSection(sh), sec);
          afterMapping();
        });
      }).catch(function (e) {
        msg.textContent = errText(e);
        msg.className = 'msg ng';
        btn.disabled = false;
      });
    } });
    sec.appendChild(h('div', { class: 'btns' }, [btn]));
    sec.appendChild(msg);
    return sec;
  }

  function afterMapping() {
    var left = state.sheets.filter(function (sh) { return !sh.mapping; }).length;
    if (left) { hideFrom('stepReview'); return; }
    show('stepReview');
    renderReview();
  }

  /* ===== ⑤ 書き込む内容の確認 ===== */
  // ★ 生年月日を西暦で書くか和暦で書くか（2026-09-15、本人の要望）。
  //   申込書に指示が無いときは、名簿の書き方に関係なく本人に選んでもらい、選ぶまで保存させない。
  //   選んだ方は端末に覚え、次の申込書では最初から選ばれた状態にする（聞くこと自体は毎回する）。
  //   指示があるときは聞かず、AI（または規則）が決めた書き方を使う。下の「書き方」でいつでも変えられる。
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
    sh.mapping.tables.forEach(function (tb) {
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
    return sh.mapping.tables.some(function (tb) { return tb.fields.some(function (f) { return f.field === 'birthYear'; }); });
  }

  // 書き方の選び直し（西暦／和暦の選択 → 欄ごとの sh.fmt の順）を対応に当てはめた写しを返す
  function withFmt(sh) {
    var m = JSON.parse(JSON.stringify(sh.mapping));
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

  function computeSheet(sh) {
    var mapping = withFmt(sh);
    var entries = entriesOf(sh).filter(function (e) { return memberOf(sh, e); });
    var anchorOf = function (r) { return X.anchorOf(state.form.book, sh.index, r); };
    var res = AI.slotsFor(mapping, entries.map(function (e) { return e.n; }), { cells: sh.cells, anchorOf: anchorOf });
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

      // 生年月日は西暦か和暦か
      if (bi.needed) sec.appendChild(birthStyleBox(sh));
      else if (bi.has) sec.appendChild(h('p', { class: 'hint', text: t('birthFollowsForm', { style: t('birthStyleName.' + bi.hint) }) }));

      // 書き方（複数の書き方がある欄だけ）
      var fmtFields = [];
      c.mapping.tables.forEach(function (tb) {
        tb.fields.forEach(function (f) {
          if (AI.FIELDS[f.field] && AI.FIELDS[f.field].length > 1 && fmtFields.indexOf(f.field) < 0) fmtFields.push(f.field);
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
            AI.cache.put(sh.key, withFmt(sh));   // 選び直した書き方は、次に同じ様式を使うときも効くように保存する
            renderReview();
          } });
          AI.FIELDS[field].forEach(function (f) { sel.appendChild(h('option', { value: f, text: t('fmt.' + field + '.' + f) })); });
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
      var table = h('table', { class: 'review' });
      table.appendChild(h('thead', {}, [h('tr', {}, cols.map(function (f) { return h('th', { text: t('field.' + f) }); }))]));
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
      // ★ ほかの人の行にずれる対応は、端末に保存したままにしない。残すと次に同じ申込書を使ったときも
      //   AI を呼ばずに同じずれが出る。消しておけば、次は AI に聞き直す道になる
      if (skipBy['offset-crosses-person']) { AI.cache.forget(sh.key); sh.fromCache = false; }
      c.mapping.problems.forEach(function (pr) {
        notes.push(has('mapprob.' + pr.code) ? t('mapprob.' + pr.code, pr) : t('err.other', { code: pr.code }));
      });
      if (notes.length) {
        var nl = h('ul', { class: 'plain notes' });
        notes.forEach(function (n) { nl.appendChild(h('li', { text: n })); });
        sec.appendChild(h('p', { class: 'sub-title', text: t('notesTitle', { n: notes.length }) }));
        sec.appendChild(nl);
      }
      if (c.mapping.extras.length) {
        sec.appendChild(h('p', { class: 'hint', text: t('extras', { list: c.mapping.extras.map(function (x) { return x.col + '列 ' + x.label; }).join('、') }) }));
      }
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
  var STEPS = ['stepNames', 'stepMap', 'stepReview', 'stepSave'];
  function show(id) { el(id).hidden = false; }
  function hideFrom(id) {
    var i = STEPS.indexOf(id);
    STEPS.slice(i).forEach(function (s) { el(s).hidden = true; });
  }

  /* ===== APIキー（決めごとドロッパーと同じ作り） ===== */
  function savedKey() { try { return localStorage.getItem(AI_KEY_STORE) || ''; } catch (e) { return ''; } }

  // 叩くのは ListModels。generateContent でダミー送信すると無料枠の1日あたり回数を検証だけで消費する。
  function testKey(key) {
    var models = AI.MODELS;
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
      function setCheck(cls, text) { checkEl.className = 'key-check show ' + cls; checkEl.textContent = text; }
      function clearCheck() {
        if (checkTimer) { clearTimeout(checkTimer); checkTimer = null; }
        checkSeq++;
        checkEl.className = 'key-check';
        checkEl.textContent = '';
      }
      function close(v) {
        modal.classList.remove('show');
        el('keySave').removeEventListener('click', onSave_);
        el('keyCancel').removeEventListener('click', onCancel);
        input.removeEventListener('input', onInput);
        eyeBtn.removeEventListener('click', onEye);
        clearCheck();
        input.type = 'password';
        resolve(v);
      }
      var KEY_SHAPE = /^AIza[\w-]{30,}$/;
      function onInput() {
        var k = (input.value || '').trim();
        clearCheck();
        if (!KEY_SHAPE.test(k)) return;
        setCheck('testing', t('keyTestRunning'));
        var seq = checkSeq;
        checkTimer = setTimeout(function () {
          testKey(k).then(function (r) {
            if (seq !== checkSeq) return;
            if (r.ok) { setCheck('ok', t('keyTestOk', { model: r.model })); return; }
            var keys = { invalid: 'keyTestInvalid', forbidden: 'keyTestForbidden', quota: 'keyTestQuota', network: 'keyTestNetwork' };
            setCheck('ng', t(keys[r.reason] || 'keyTestOther'));
          });
        }, 600);
      }
      function onEye() {
        var toShow = (input.type === 'password');
        input.type = toShow ? 'text' : 'password';
        eyeBtn.textContent = toShow ? '🙈' : '👁';
        eyeBtn.setAttribute('aria-pressed', toShow ? 'true' : 'false');
        eyeBtn.setAttribute('aria-label', t(toShow ? 'keyHide' : 'keyShow'));
        input.focus();
      }
      function onSave_() {
        var k = (input.value || '').trim();
        if (!k) { input.focus(); return; }
        // 接続テストがNGでも保存は通す。通信エラーで保存できないと、そこで詰んでしまう。
        try { localStorage.setItem(AI_KEY_STORE, k); } catch (e) {}
        close(k);
      }
      function onCancel() { close(''); }

      input.value = have || '';
      input.type = 'password';
      eyeBtn.textContent = '👁';
      eyeBtn.setAttribute('aria-pressed', 'false');
      eyeBtn.setAttribute('aria-label', t('keyShow'));
      eyeBtn.addEventListener('click', onEye);
      clearCheck();
      el('keySave').addEventListener('click', onSave_);
      el('keyCancel').addEventListener('click', onCancel);
      input.addEventListener('input', onInput);
      if (have) onInput();
      modal.classList.add('show');
      setTimeout(function () { input.focus(); }, 50);
    });
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
  wireDrop('rosterDrop', 'rosterInput', 'rosterPick', onRoster);
  el('namesNext').addEventListener('click', onNamesNext);
  el('saveBtn').addEventListener('click', onSave);
  // 縮小して全体を表示: 既定は入れる。外した人には外したまま覚えておく
  el('shrinkChk').checked = lsGet(SHRINK_LS) !== 'off';
  el('shrinkChk').addEventListener('change', function () { lsSet(SHRINK_LS, el('shrinkChk').checked ? 'on' : 'off'); });
  el('keyChangeBtn').addEventListener('click', function () { askKey(true); });
})();
