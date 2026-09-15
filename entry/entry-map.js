// entry-map.js — 申込書ドロッパーの「欄の対応」を整えて、名前に当てはめる
//
// 欄の対応（どの列が性別で、どの列が生年月日か）は entry-rules.js が見出しの語から作る。
// ここはそれを検めて（normalize）、見つけた名前に当てはめる（slotsFor）。値は entry-roster.js の fill() が作る。
//
// ★ 2026-09-15 までは Gemini に欄の対応を作らせていた（entry-ai.js）。やめた理由は3つ。
//   - 名簿に無い人の名前（連絡責任者など）は伏せ字にならず、AI に送られていた（スポレク参加申込書で確認）
//   - 見出しの規則のほうが、初めての申込書でも外れ方が安全側だった（見落としはあっても誤爆が無い）
//   - APIキーが要らず、混雑（503）や提供終了（404）の影響も受けない
//   経緯と測った数字は保管庫の作業ログ（ドロッパー 2026-09）。
//
// ★ 対応は形も値も信用しない。規則が外れても、ほかの人の行・見出し・式・名前の欄には書かない。
//
// window.EntryMap = { FIELDS, normalize, slotsFor, tableKey, applyOverrides, formKey, prefs } を公開する。
(function (global) {
  'use strict';

  var PREFS_LS = 'dropper_entry_form_prefs';
  var PREFS_MAX = 50;

  // 欄の種類と、使える書き方（先頭が既定）。entry-roster.js の fill() と対。片方だけ足さないこと。
  var FIELDS = {
    name: [], family: [], given: [], kana: [],
    gender: ['kanji', 'full'],
    genderMale: [], genderFemale: [],
    birth: ['wareki', 'seireki-slash', 'seireki-kanji', 'wareki-short'],
    birthEra: ['full', 'short', 'none'],   // none: 西暦で書くとき、元号の欄を空にする（画面で選ぶ）
    birthYear: ['wareki', 'seireki', 'wareki-num', 'wareki-short'],
    birthMonth: [], birthDay: [],
    age: [],
    postal: [],
    address: ['plain', 'with-postal'],
    addressPref: [], addressRest: [],
    phone: []
  };
  // 名前そのものの欄は fields からは受け取らない（位置は名前の列から決まる）
  var NAME_FIELDS = { name: true, family: true, given: true };

  // ===== 対応を検める =====
  // 使えない欄は捨てて problems に残す（画面で知らせる）。
  function str(v) { return v == null ? '' : String(v).trim(); }
  // 列は英字で受け取る。「C14」「C:E」「$C」「C列」「Ｃ」でも先頭の英字を採る
  // （2026-09-15、Gemini が氏名の結合セル C14:E14 を範囲で答え、表ごと捨てていた名残。規則でも害は無い）
  function col(v) {
    var s = str(v);
    try { s = s.normalize('NFKC'); } catch (e) {}
    var m = /^\$?([A-Za-z]{1,3})(?![A-Za-z])/.exec(s);
    return m ? m[1].toUpperCase() : '';
  }
  function int(v, lo, hi, dflt) {
    var n = Number(v);
    return (isFinite(n) && Math.floor(n) === n && n >= lo && n <= hi) ? n : dflt;
  }

  // 文の中から日付の部分だけを抜き出して読む（「（年齢は、令和９年４月１日現在をご記入下さい）」でも読めるように）
  function dateIn(s) {
    if (!s) return null;
    var t = String(s);
    try { t = t.normalize('NFKC'); } catch (e) {}
    var m = /(明治|大正|昭和|平成|令和|[MTSHR]\.?)?\s*(\d{1,4}|元)\s*[年.\/-]\s*(\d{1,2})\s*[月.\/-]\s*(\d{1,2})\s*日?/i.exec(t);
    return m ? global.EntryRoster.parseBirth(m[0].replace(/\s+/g, '')) : null;
  }

  function normalize(raw) {
    var o = raw && typeof raw === 'object' ? raw : {};
    var out = { baseDate: dateIn(str(o.baseDateRaw)), baseDateRaw: str(o.baseDateRaw), tables: [], extras: [], problems: [] };

    (Array.isArray(o.tables) ? o.tables : []).forEach(function (t, ti) {
      if (!t || typeof t !== 'object') return;
      var tb = {
        nameCol: col(t.nameCol), familyCol: col(t.familyCol), givenCol: col(t.givenCol),
        firstRow: int(t.firstRow, 1, 100000, 0), lastRow: int(t.lastRow, 1, 100000, 0),
        headerRow: int(t.headerRow, 0, 100000, 0),
        pairSize: int(t.pairSize, 1, 6, 1), ageSumCol: col(t.ageSumCol), ageSumRowOffset: int(t.ageSumRowOffset, 0, 5, 0),
        fields: []
      };
      if (!tb.nameCol && !(tb.familyCol && tb.givenCol)) { out.problems.push({ code: 'table-no-name-col', table: ti }); return; }
      if (!tb.firstRow || !tb.lastRow || tb.lastRow < tb.firstRow) { out.problems.push({ code: 'table-bad-rows', table: ti }); return; }
      var seen = {};
      (Array.isArray(t.fields) ? t.fields : []).forEach(function (f) {
        if (!f || typeof f !== 'object') return;
        var field = str(f.field);
        if (NAME_FIELDS[field]) return;
        if (!FIELDS.hasOwnProperty(field)) { out.problems.push({ code: 'unknown-field', table: ti, field: field }); return; }
        var c = col(f.col);
        var off = int(f.rowOffset, -5, 5, null);
        if (!c || off === null) { out.problems.push({ code: 'bad-position', table: ti, field: field }); return; }
        var fmts = FIELDS[field];
        var fmt = str(f.fmt);
        if (fmts.length && fmts.indexOf(fmt) < 0) fmt = fmts[0];
        if (!fmts.length) fmt = '';
        var key = c + ':' + off;
        if (seen[key]) { out.problems.push({ code: 'same-cell-twice', table: ti, field: field, other: seen[key] }); return; }
        seen[key] = field;
        var nf = { field: field, col: c, rowOffset: off };
        if (fmt) nf.fmt = fmt;
        if (field === 'genderMale' || field === 'genderFemale') nf.mark = str(f.mark) || '○';
        // その列の見出しの文字。⑤で「どの見出しの欄に書くか」を見せ、読み違い（「年齢区分」に年齢など）に気づけるようにする
        if (f.header) nf.header = str(f.header).slice(0, 40);
        tb.fields.push(nf);
      });
      // 男・女の列に印を付ける形は、2列が対でないと片方の性別の欄が空のまま出る
      var hasM = tb.fields.some(function (f) { return f.field === 'genderMale'; });
      var hasF = tb.fields.some(function (f) { return f.field === 'genderFemale'; });
      if (hasM !== hasF) out.problems.push({ code: 'gender-mark-unpaired', table: ti, missing: hasM ? 'genderFemale' : 'genderMale' });
      // ④の「申込書の列 → 書くもの」の一覧（見出しのある列すべて。決められなかった列は field: null）
      var colSeen = {};
      tb.cols = (Array.isArray(t.cols) ? t.cols : []).map(function (x) {
        var c = x && col(x.col);
        if (!c || colSeen[c] || NAME_FIELDS[str(x.field)]) return null;
        colSeen[c] = true;
        var field = FIELDS.hasOwnProperty(str(x.field)) ? str(x.field) : null;
        return { col: c, header: str(x.header).slice(0, 40), field: field };
      }).filter(Boolean);
      out.tables.push(tb);
    });
    (Array.isArray(o.extras) ? o.extras : []).forEach(function (x) {
      if (x && col(x.col)) out.extras.push({ col: col(x.col), label: str(x.label) });
    });
    if (!out.tables.length) out.problems.push({ code: 'no-table' });
    return out;
  }

  // ===== 当てはめる =====
  // 対応（normalize の結果）と、見つけた名前から、fill() に渡す slots と合計年齢の groups を作る。
  // opts.cells   … EntryXlsx.cells（書き込み先に文字が入っていないかを見る）
  // opts.anchorOf … 結合セルの左上を返す関数（EntryXlsx.anchorOf を包んだもの）
  // 戻り値: { slots: [{ name, fields }], groups: [{ slots, ageSum }], problems }
  function slotsFor(mapping, names, opts) {
    opts = opts || {};
    var anchor = opts.anchorOf || function (r) { return r; };
    var X = global.EntryXlsx;
    var textAt = {}, formulaAt = {};
    (opts.cells || []).forEach(function (c) {
      textAt[anchor(c.ref)] = c.text;
      if (c.formula) formulaAt[anchor(c.ref)] = true;
    });
    var nameAt = {};
    names.forEach(function (n) { n.refs.forEach(function (r) { nameAt[anchor(r)] = true; }); });

    function tableOf(n) {
      var row = X.parseRef(n.refs[0]).row;
      var letters = n.refs.map(function (r) { return /^[A-Z]+/.exec(r)[0]; });
      return mapping.tables.filter(function (t) {
        var colOk = n.refs.length === 2 ? (t.familyCol === letters[0] && t.givenCol === letters[1])
          : (t.nameCol === letters[0]);
        return colOk && row >= t.firstRow && row <= t.lastRow;
      })[0];
    }

    // 表ごとの「1人ぶんの行数」を、見つけた名前の行の間隔から測る（名前が1つだけなら分からない）。
    // ★ 名前と違う行に書く指示が、この間隔以上ずれていたら、ほかの人の行に入る。書かずに知らせる。
    //   2026-09-15、本物の百万石の様式（見出しが「生年月日」の下に「年・月・日」の2段）で、
    //   Gemini が生年月日の4欄を名前の1行下と答えた。そのまま書くと1人目の生年月日が2人目の行に入り、
    //   その欄は空なので「文字の入った欄には書かない」もすり抜けて、黙って間違った申込書ができる。
    var rowsByTable = new Map();
    names.forEach(function (n) {
      var t = tableOf(n);
      if (!t) return;
      if (!rowsByTable.has(t)) rowsByTable.set(t, []);
      rowsByTable.get(t).push(X.parseRef(n.refs[0]).row);
    });
    function stepOf(t) {
      var rows = (rowsByTable.get(t) || []).slice().sort(function (a, b) { return a - b; });
      var step = 0;
      for (var i = 1; i < rows.length; i++) {
        var d = rows[i] - rows[i - 1];
        if (d > 0 && (!step || d < step)) step = d;
      }
      return step;   // 0 = 分からない
    }

    var slots = [], groupsByKey = {}, problems = [];
    names.forEach(function (n) {
      var p = X.parseRef(n.refs[0]);
      var tb = tableOf(n);
      if (!tb) { problems.push({ code: 'name-outside-table', ref: n.refs[0] }); return; }
      var step = stepOf(tb);

      var fields = n.refs.length === 2
        ? [{ field: 'family', ref: n.refs[0] }, { field: 'given', ref: n.refs[1] }]
        : [{ field: 'name', ref: n.refs[0] }];
      tb.fields.forEach(function (f) {
        var ref = anchor(f.col + (p.row + f.rowOffset));
        if (step && Math.abs(f.rowOffset) >= step) {
          problems.push({ code: 'offset-crosses-person', ref: ref, field: f.field, name: n.refs[0], rowOffset: f.rowOffset, step: step });
          return;
        }
        if (nameAt[ref]) { problems.push({ code: 'target-is-name', ref: ref, field: f.field, name: n.refs[0] }); return; }
        if (formulaAt[ref]) { problems.push({ code: 'target-is-formula', ref: ref, field: f.field, name: n.refs[0] }); return; }
        if (textAt[ref] != null && textAt[ref] !== '') {
          // 見出しの上や、幹事がすでに書いた欄には黙って書かない
          problems.push({ code: 'target-has-text', ref: ref, field: f.field, name: n.refs[0] });
          return;
        }
        var nf = { field: f.field, ref: ref };
        if (f.fmt) nf.fmt = f.fmt;
        if (f.mark) nf.mark = f.mark;
        if (f.header) nf.header = f.header;
        fields.push(nf);
      });
      var slot = { name: n, fields: fields };
      slots.push(slot);

      if (tb.pairSize > 1 && tb.ageSumCol) {
        var idx = Math.floor((p.row - tb.firstRow) / tb.pairSize);
        var start = tb.firstRow + idx * tb.pairSize;
        var sumRef = anchor(tb.ageSumCol + (start + tb.ageSumRowOffset));
        // ★ 合計の欄も、式・文字・名前の入った欄には書かない（2026-09-15、Gemini が
        //   表の下の「年齢合計」＝式のセルを4人1組の合計欄と読んだ）。1組につき1回だけ知らせる
        var why = nameAt[sumRef] ? 'target-is-name' : formulaAt[sumRef] ? 'target-is-formula'
          : (textAt[sumRef] != null && textAt[sumRef] !== '') ? 'target-has-text' : '';
        if (why) {
          if (!groupsByKey.hasOwnProperty(sumRef)) { groupsByKey[sumRef] = null; problems.push({ code: why, ref: sumRef, field: 'ageSum' }); }
        } else {
          if (!groupsByKey[sumRef]) groupsByKey[sumRef] = { slots: [], ageSum: sumRef, size: tb.pairSize };
          groupsByKey[sumRef].slots.push(slots.length - 1);
        }
      }
    });
    var groups = Object.keys(groupsByKey).map(function (k) { return groupsByKey[k]; }).filter(Boolean);
    return { slots: slots, groups: groups, problems: problems };
  }

  // ===== 本人の直しを当てはめる =====
  // ★ 2026-09-15、本人と決めた形: ④に「申込書の列 → 書くもの」の一覧を出し、1列ずつ選び直せるようにする。
  //   見出しの規則の見落とし（満年齢・男・女の1列）と誤爆（年齢区分 → 年齢）を、本人が直すための道。
  //   直しは「その申込書だけ」に覚える（ほかの大会の申込書には広げない。誤った直しが広がらないように）。
  //
  // 表の見分け: 名前の列＋いちばん近い見出しの行。名前を書いた人数（firstRow / lastRow）に左右されない。
  function tableKey(tb) {
    return (tb.nameCol || (tb.familyCol + '+' + tb.givenCol)) + '@' + (tb.headerRow || 0);
  }

  // overrides: { 表の鍵: { 列: 欄の種類 | 'none' } }
  // 戻り値: { mapping（直しを当てはめた写し）, duplicates: [{ table, field, cols }] }
  // ★ 書く行は名前と同じ行に固定する（rowOffset 0）。ずれた行に書く誤りを、人の操作で作らないため
  function applyOverrides(mapping, overrides) {
    var m = JSON.parse(JSON.stringify(mapping));
    var duplicates = [];
    overrides = overrides || {};
    m.tables.forEach(function (tb, ti) {
      var ov = overrides[tableKey(tb)] || {};
      Object.keys(ov).forEach(function (c) {
        var field = ov[c];
        var entry = (tb.cols || []).filter(function (x) { return x.col === c; })[0];
        if (!entry) return;   // 申込書の形が変わって、その列に見出しが無くなった直しは使わない
        if (field !== 'none' && !FIELDS.hasOwnProperty(field)) return;
        if (NAME_FIELDS[field]) return;
        var old = tb.fields.filter(function (f) { return f.col === c && f.rowOffset === 0; })[0];
        tb.fields = tb.fields.filter(function (f) { return !(f.col === c && f.rowOffset === 0); });
        entry.field = field === 'none' ? null : field;
        entry.overridden = true;
        if (field === 'none') return;
        var nf = { field: field, col: c, rowOffset: 0, header: entry.header };
        // 同じ種類のまま選び直したなら、規則が決めた書き方を残す。種類を変えたなら既定の書き方から
        if (old && old.field === field && old.fmt) nf.fmt = old.fmt;
        else if (FIELDS[field].length) nf.fmt = FIELDS[field][0];
        if (field === 'genderMale' || field === 'genderFemale') nf.mark = '○';
        tb.fields.push(nf);
      });
      // 元号の欄があるなら、年の欄は数字だけ（元号は別の欄に書く）
      var hasEra = tb.fields.some(function (f) { return f.field === 'birthEra'; });
      tb.fields.forEach(function (f) { if (f.field === 'birthYear' && hasEra && f.fmt === 'wareki') f.fmt = 'wareki-num'; });
      tb.fields.sort(function (a, b) { return colNum(a.col) - colNum(b.col); });
      // 同じ種類を2つの列に選んでいたら知らせる（「年齢」が D 列と H 列、など）
      var byField = {};
      tb.fields.forEach(function (f) { (byField[f.field] = byField[f.field] || []).push(f.col); });
      Object.keys(byField).forEach(function (f) {
        if (byField[f].length > 1) duplicates.push({ table: ti, field: f, cols: byField[f] });
      });
    });
    return { mapping: m, duplicates: duplicates };
  }
  function colNum(l) { var n = 0; for (var i = 0; i < l.length; i++) n = n * 26 + (l.charCodeAt(i) - 64); return n; }

  // ===== 同じ様式かどうか =====
  // 名前のセルを除いた「見出しと結合の形」から鍵を作る。書いた人や人数が違っても、同じ様式なら同じ鍵になる。
  function formKey(sheetName, cells, merges, found) {
    var nameRefs = {};
    found.names.concat(found.suspects).forEach(function (n) { n.refs.forEach(function (r) { nameRefs[r] = true; }); });
    var text = sheetName + '\n' + merges.map(function (m) { return m.ref; }).sort().join(' ') + '\n' +
      cells.filter(function (c) { return !nameRefs[c.ref] && !c.formula; })
        .map(function (c) { return c.ref + '\t' + String(c.text).replace(/\s+/g, ' ').trim(); }).join('\n');
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  // 様式ごとに、本人が選び直した書き方を覚える（個人情報は入らない）。端末の localStorage に置く。
  var prefs = {
    get: function (key) {
      try {
        var all = JSON.parse(global.localStorage.getItem(PREFS_LS) || '{}');
        return all[key] ? all[key].prefs : null;
      } catch (e) { return null; }
    },
    put: function (key, value) {
      try {
        var all = JSON.parse(global.localStorage.getItem(PREFS_LS) || '{}');
        all[key] = { prefs: value, savedAt: Date.now() };
        var keys = Object.keys(all).sort(function (a, b) { return all[b].savedAt - all[a].savedAt; });
        keys.slice(PREFS_MAX).forEach(function (k) { delete all[k]; });
        global.localStorage.setItem(PREFS_LS, JSON.stringify(all));
      } catch (e) {
        // 覚えられなくても続ける（次回もう一度選ぶだけ）。黙らずに残す
        if (global.console) console.warn('entry-map: prefs put failed', e);
      }
    }
  };

  global.EntryMap = {
    FIELDS: FIELDS, normalize: normalize, slotsFor: slotsFor, tableKey: tableKey, applyOverrides: applyOverrides,
    formKey: formKey, prefs: prefs
  };
})(typeof window !== 'undefined' ? window : this);
