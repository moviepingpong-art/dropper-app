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
    address: ['plain', 'keep-pref', 'with-postal'],   // plain = いちばん多い都道府県を省く
    addressPref: [], addressRest: [],
    phone: []
  };
  // ★ 名簿に足した項目（2026-09-20）。extra:0, extra:1 … の形で、番号は名簿の列の順。
  //   値の中身はここでは見ない（名簿の側が持っている）
  var EXTRA_RE = /^extra:(\d{1,2})$/;
  function isField(f) { return FIELDS.hasOwnProperty(f) || EXTRA_RE.test(f); }
  function fmtsOf(f) { return FIELDS.hasOwnProperty(f) ? FIELDS[f] : []; }

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

  // 申込書に書かれた年齢区分の文を読む。
  //   「合計年齢（① 119歳以下 ・ ② 120〜134歳 ・ ③ 135〜149歳 ・ ④ 150歳以上）」
  //   → [{ mark: '①', min: null, max: 119 }, { mark: '②', min: 120, max: 134 }, …]
  // ★ 区分は大会ごとに違う。こちらで決め打ちせず、書いてあるものだけを読む。
  //   読めない書き方は、その区分を捨てる（間違った区分を書くより、書かないほうがよい）
  function ageClassesIn(raw) {
    var t = str(raw);
    if (!t) return [];
    // ★ NFKC は使わない。「①」が「1」になって、区分の目印と数字の区別が付かなくなる（2026-09-19）。
    //   そろえるのは数字・空白・波ダッシュだけ
    t = t.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[　\t]/g, ' ').replace(/[〜～~]/g, '~');
    var out = [];
    // 区切りは「・」「、」。先頭の「合計年齢（」などは捨てる
    // 区切りは「・」「、」のほか、目印（①・1.）の直前の空白でも切る
    t.split(/[・、]|\s+(?=[①-⑳]|\(?\d+\s*[.．)])/).forEach(function (part) {
      var mark = (/[①-⑳]|\(\s*\d+\s*\)|\d+\s*[.．)]/.exec(part) || [])[0];
      if (!mark) return;
      mark = mark.replace(/\s+/g, '');
      var body = part.slice(part.indexOf(mark) + mark.length);
      var range = /(\d+)\s*(?:歳)?\s*[~\-–]\s*(\d+)\s*歳/.exec(body);
      var below = /(\d+)\s*歳(以下|未満)/.exec(body);
      var above = /(\d+)\s*歳以上/.exec(body);
      if (range) out.push({ mark: mark, min: Number(range[1]), max: Number(range[2]), text: tidy(part) });
      else if (below) out.push({ mark: mark, min: null, max: below[2] === '未満' ? Number(below[1]) - 1 : Number(below[1]), text: tidy(part) });
      else if (above) out.push({ mark: mark, min: Number(above[1]), max: null, text: tidy(part) });
    });
    return out;
  }

  // 前後のかっこ・中黒・空白を落とす（「④ 150歳以上 ））」→「④ 150歳以上」）
  function tidy(s) { return String(s).replace(/^[\s（(・]+/, '').replace(/[\s）)・]+$/, ''); }

  // 参加料の文から単価を読む。「5,000×　＝」「参加料：団体3,000円×（　）チーム＝合計（　）円」
  // → { price: 3000, per: 'チーム' }。読めなければ null
  // ★ 計算して見せるだけ。申込書には書かない（書く場所が様式ごとに違う）
  function feeIn(raw) {
    var t = str(raw);
    if (!t) return null;
    t = t.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/[　\t]/g, ' ');
    var m = /(\d[\d,]{2,})\s*円?\s*[×✕xX]/.exec(t);
    if (!m) return null;
    var price = Number(m[1].replace(/,/g, ''));
    if (!isFinite(price) || price <= 0) return null;
    var after = t.slice(m.index + m[0].length);
    var per = (/(チーム|団体|組|ペア|名|人)/.exec(after) || /(チーム|団体|組|ペア|名|人)/.exec(t.slice(0, m.index)) || [])[1] || '';
    return { price: price, per: per, text: t.trim() };
  }

  // 合計年齢から区分を選ぶ。どれにも当てはまらなければ null
  function ageClassOf(classes, sum) {
    if (!classes || !classes.length || sum == null) return null;
    for (var i = 0; i < classes.length; i++) {
      var c = classes[i];
      if ((c.min == null || sum >= c.min) && (c.max == null || sum <= c.max)) return c;
    }
    return null;
  }

  function normalize(raw) {
    var o = raw && typeof raw === 'object' ? raw : {};
    var out = { baseDate: dateIn(str(o.baseDateRaw)), baseDateRaw: str(o.baseDateRaw),
      ageClasses: ageClassesIn(o.ageClassesRaw), ageClassesRaw: str(o.ageClassesRaw),
      fee: feeIn(o.feeRaw), feeRaw: str(o.feeRaw),
      tables: [], extras: [], problems: [] };

    (Array.isArray(o.tables) ? o.tables : []).forEach(function (t, ti) {
      if (!t || typeof t !== 'object') return;
      var tb = {
        nameCol: col(t.nameCol), familyCol: col(t.familyCol), givenCol: col(t.givenCol),
        firstRow: int(t.firstRow, 1, 100000, 0), lastRow: int(t.lastRow, 1, 100000, 0),
        headerRow: int(t.headerRow, 0, 100000, 0),
        pairSize: int(t.pairSize, 1, 6, 1), ageSumCol: col(t.ageSumCol), ageSumRowOffset: int(t.ageSumRowOffset, 0, 5, 0),
        eventCol: col(t.eventCol), eventRowOffset: int(t.eventRowOffset, 0, 5, 0),
        fields: []
      };
      if (!tb.nameCol && !(tb.familyCol && tb.givenCol)) { out.problems.push({ code: 'table-no-name-col', table: ti }); return; }
      if (!tb.firstRow || !tb.lastRow || tb.lastRow < tb.firstRow) { out.problems.push({ code: 'table-bad-rows', table: ti }); return; }
      var seen = {};
      (Array.isArray(t.fields) ? t.fields : []).forEach(function (f) {
        if (!f || typeof f !== 'object') return;
        var field = str(f.field);
        if (NAME_FIELDS[field]) return;
        if (!isField(field)) { out.problems.push({ code: 'unknown-field', table: ti, field: field }); return; }
        var c = col(f.col);
        var off = int(f.rowOffset, -5, 5, null);
        if (!c || off === null) { out.problems.push({ code: 'bad-position', table: ti, field: field }); return; }
        var fmts = fmtsOf(field);
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
        var field = isField(str(x.field)) ? str(x.field) : null;
        return { col: c, header: str(x.header).slice(0, 40), near: str(x.near).slice(0, 40), field: field };
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
    // 斜線（×印）が引いてある欄かどうか。画面が EntryXlsx.crossedOut を包んで渡す（試験では渡さない）
    var crossedCache = {};
    var crossed = function (ref) {
      if (!opts.crossedOut) return false;
      if (!crossedCache.hasOwnProperty(ref)) crossedCache[ref] = !!opts.crossedOut(ref);
      return crossedCache[ref];
    };

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

    var slots = [], groupsByKey = {}, problems = [], problemSeen = {};
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
        // ★ 斜線（×印）が引いてある欄は「書かなくてよい」の意味（百万石の監督の行の生年月日・年齢）。
        //   2026-09-19、本人の指摘で分かった
        if (crossed(ref)) {
          problems.push({ code: 'target-crossed-out', ref: ref, field: f.field, name: n.refs[0] });
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

      // 組（2人1組など）。合計年齢と種目は、組につき1つの欄に書く
      if (tb.pairSize > 1 && (tb.ageSumCol || tb.eventCol)) {
        var idx = Math.floor((p.row - tb.firstRow) / tb.pairSize);
        var start = tb.firstRow + idx * tb.pairSize;
        var key = mapping.tables.indexOf(tb) + '#' + start;
        // ★ 組の欄も、式・文字・名前の入った欄には書かない（2026-09-15、Gemini が
        //   表の下の「年齢合計」＝式のセルを4人1組の合計欄と読んだ）。1組につき1回だけ知らせる
        var cellFor = function (colLetter, offset, field) {
          if (!colLetter) return '';
          var ref = anchor(colLetter + (start + offset));
          var why = nameAt[ref] ? 'target-is-name' : formulaAt[ref] ? 'target-is-formula'
            : (textAt[ref] != null && textAt[ref] !== '') ? 'target-has-text'
            : crossed(ref) ? 'target-crossed-out' : '';
          if (!why) return ref;
          if (!problemSeen[ref]) { problemSeen[ref] = true; problems.push({ code: why, ref: ref, field: field }); }
          return '';
        };
        var sumRef = cellFor(tb.ageSumCol, tb.ageSumRowOffset, 'ageSum');
        var eventRef = cellFor(tb.eventCol, tb.eventRowOffset, 'event');
        if (sumRef || eventRef) {
          if (!groupsByKey[key]) groupsByKey[key] = { slots: [], ageSum: sumRef, event: eventRef, size: tb.pairSize };
          groupsByKey[key].slots.push(slots.length - 1);
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
  // ★ 2026-09-20 に作り直した。前は「名前のセルを除いたシート全部の文字」のハッシュだったので、
  //   **大会名や開催日が変わるだけで別の様式になり、覚えた選び直しが毎年捨てられていた**
  //   （本物の神奈川県ラージボール卓球オープン大会の様式で、日時の行を1か所変えただけで
  //   鍵が変わることを確かめた。協会の様式は毎年同じ形で、回数と日付だけが変わる）。
  //   いまは**表の形だけ**で作る: 名前の列・見出しの行・列ごとの見出しの語を、表ごとに並べたもの。
  //   ★ シート名は入れない（「119回相模原」のように回数が入る）。大会名・日付・会場も入らない。
  //   ★ 見出しの語は「いちばん近い1つ」だけ（near）。上まで辿った文字列（header）には
  //     大会名が混じるので使わない。
  //   ★ 見出しの行の番号は入れてある。上に行を足されると別の様式になるが、
  //     **ゆるめて別の様式に前の直しを当てるほうが重い**（黙って違う欄に書く）ので、この形にした
  function keyWord(s) {
    s = String(s == null ? '' : s);
    try { s = s.normalize('NFKC'); } catch (e) {}
    return s.replace(/\s+/g, '');
  }
  function formKey(mapping) {
    var tables = (mapping && mapping.tables) || [];
    var text = 'v2\n' + tables.map(function (tb) {
      var name = tb.nameCol || (tb.familyCol + '+' + tb.givenCol);
      var cols = (tb.cols || []).map(function (c) { return c.col + '=' + keyWord(c.near || c.header); }).join(',');
      return name + '@' + tb.headerRow + '|' + cols;
    }).join('\n');
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  // ===== 表が見つかる前に使う、シートの形の鍵 =====
  // ★ 2026-09-20。③で「教えてもらった形」「直した書く行」を覚えるのに要る。
  //   このときはまだ表が無く、formKey（表の形）は作れない。
  //   **文字は見ず、「どこにセルがあるか」と結合の形だけ**で作るので、
  //   大会名や日付を書き換えても変わらない（セルの有無は文字を変えても変わらない）。
  //   ★ crypto.subtle は Promise を返す。③の組み立ては同期なので使えない。
  //     短い同期のハッシュを3本並べて使う（取り違えても、覚えた行が出てくるだけで
  //     書き込みは起きない。③の画面に列と行が出て、④にも書く場所が出る）
  function hash32(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  function layoutKey(grid, merges) {
    var refs = (grid || []).map(function (c) { return c.ref; }).sort().join(',');
    var mg = (merges || []).map(function (m) { return m.ref; }).sort().join(',');
    return 'L' + hash32(refs) + hash32(mg) + hash32(refs + '|' + mg);
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

  // ===== 名簿に足した項目と、申込書の見出しの照合（2026-09-20） =====
  // ★ 当てるのは**見出しがぴったり同じとき**だけ（本人の判断＝A案）。
  //   「語を含んでいれば当てる」にはしない——本物のシニアフェスタで
  //   「勤務先所在地／会社名」の列に**自宅住所**を書く誤爆が出ており、含み比べはその種を増やす。
  //   ただし次の2つは同じものとして扱う:
  //     - 見出しが**複数行**のとき（「勤務先所在地\r\n会社名」）は、行ごとに比べる
  //     - **うしろの括弧書き**（「所属(混成でも可)」「氏名（ふりがな）」）は外して比べる
  //   ★ 「勤務先所在地会社名」（1行につながっているもの）は当てない。これが含み比べとの境目
  function labelKey(s) {
    s = String(s == null ? '' : s);
    try { s = s.normalize('NFKC'); } catch (e) {}
    return s.replace(/\s+/g, '');
  }
  function labelBare(k) {
    return k.replace(/[(（【〔][^)）】〕]*[)）】〕]$/, '').replace(/※.*$/, '');
  }
  function sameLabel(header, name) {
    var want = labelKey(name);
    if (!want) return false;
    var parts = String(header == null ? '' : header).split(/[\r\n]+/);
    parts.push(header);
    return parts.some(function (p) {
      var k = labelKey(p);
      return k === want || labelBare(k) === want;
    });
  }

  // ★ 同じ項目に複数の列が当たったら、名前の列に**いちばん近い1つ**だけを選ぶ（2026-09-20）。
  //   左右に並ぶ表で、片方にしか人を入れないと左右の境が付かず、
  //   シングルスの表がダブルス側の「所属」まで抱える。両方に書くと、
  //   **誰も入れていないダブルスの行に所属だけ書く**という誤爆になる（本物の神奈川で確かめた）。
  //   hits: [{ col, index }] → 戻り値: { 項目の番号: 列 }
  function nearestCols(nameCol, hits) {
    var base = colNum(String(nameCol || 'A').toUpperCase());
    var best = {};
    (hits || []).forEach(function (x) {
      if (!x || !x.col) return;
      var d = Math.abs(colNum(String(x.col).toUpperCase()) - base);
      var k = String(x.index);
      if (!best[k] || d < best[k].dist) best[k] = { col: x.col, dist: d };
    });
    var out = {};
    Object.keys(best).forEach(function (k) { out[k] = best[k].col; });
    return out;
  }

  // ===== 覚え書きの受け渡し（2026-09-20） =====
  // ★ 団体の幹事が1回教えて、申込書と一緒に配れるようにする。受け取った人は教え直さずに使える。
  //   中身は**列と行の番号、欄の対応、書き方だけ**（名簿は入らない）。
  //   ★ 外から来るファイルなので、**知っている名前の中身だけを残す**。
  //     中の値そのものは、使う所（EntryBlank.manual・applyOverrides・normalize）が検めている
  var MEMO_KIND = 'dropper-entry-memo';
  var MEMO_FIELDS = { rows: 1, taught: 1, fmt: 1, fields: 1, ageClasses: 1,
    eventWrite: 1, eventFmt: 1, feeCount: 1, feeManual: 1 };

  function memoOf(keys) {
    var items = [], seen = {};
    (keys || []).forEach(function (k) {
      if (!k || seen[k]) return;
      seen[k] = true;
      var p = prefs.get(k);
      if (p) items.push({ key: String(k), prefs: p });
    });
    return { kind: MEMO_KIND, version: 1, items: items };
  }

  // 覚え書きを取り込む。戻り値は入れた数（-1 = 覚え書きではない）
  function memoIn(data) {
    if (!data || data.kind !== MEMO_KIND || !Array.isArray(data.items)) return -1;
    var n = 0;
    data.items.forEach(function (it) {
      if (!it || typeof it.key !== 'string' || !/^[A-Za-z0-9]{8,80}$/.test(it.key)) return;
      var src = it.prefs;
      if (!src || typeof src !== 'object') return;
      var clean = {};
      Object.keys(src).forEach(function (f) { if (MEMO_FIELDS[f]) clean[f] = src[f]; });
      if (!Object.keys(clean).length) return;
      prefs.put(it.key, clean);
      n++;
    });
    return n;
  }

  global.EntryMap = {
    FIELDS: FIELDS, normalize: normalize, slotsFor: slotsFor, tableKey: tableKey, applyOverrides: applyOverrides,
    formKey: formKey, layoutKey: layoutKey, prefs: prefs, memoOf: memoOf, memoIn: memoIn, sameLabel: sameLabel, nearestCols: nearestCols, ageClassesIn: ageClassesIn, ageClassOf: ageClassOf, feeIn: feeIn
  };
})(typeof window !== 'undefined' ? window : this);
