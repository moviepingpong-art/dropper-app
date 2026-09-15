// entry-ai.js — 申込書ドロッパーのAI（欄の対応づくり）
//
// 様式のどの欄に何を書くか（性別は F 列、生年月日は年・月・日の3欄…）を Gemini に決めさせる。
// 値は作らせない。値は entry-roster.js が名簿から作る。
//
// ★ AI に名前を送らない。
//   送るのは EntryRoster.mask() を通したセルだけ（名前は〔氏名N〕）。さらに送る直前に guard() が
//   本文を名簿の氏名・幹事が書いた文字と突き合わせ、1つでも見つかったら送らずに止める（code: 'name-leak'）。
//   名簿の生年月日・住所・電話は、様式に書かれていないので最初から載らない。
//
// ★ 答えは「人ごと」ではなく「行の型」で受け取る。
//   「名前の列から見て、性別は F 列・同じ行」の形なら、名前の人数や位置が変わっても当てはめられる。
//   同じ様式の2回目からは、保存した対応（cache）を使って AI を呼ばない。
//
// window.EntryAI = { layout, guard, prompt, map, normalize, slotsFor, cacheKey, cache, MODELS, FIELDS } を公開する。
(function (global) {
  'use strict';

  // 主モデル → 混雑時のフォールバック。
  // ★ 予備も「latest」の名前にする（2026-09-15）。版番号つきの gemini-2.0-flash は提供が終わって 404 を返し、
  //   主モデルが 503 のとき必ず失敗していた。版番号つきの名前は、いつか必ず同じことになる。
  //   軽量版を選んだのは、主モデルと別のモデルで同時に混みにくいため。質は live-ai.js --model で確かめる
  var MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
  var MIN_INTERVAL_MS = 5000;   // レート制限対策のスロットル。外さないこと
  var MAX_CELLS = 3000;         // これより多い様式は、申込書ではない表を落とした可能性が高い
  var CACHE_LS = 'dropper_entry_maps';
  var CACHE_MAX = 50;
  var lastCallAt = 0;

  function fail(code, detail) {
    var e = new Error(code + (detail ? ': ' + detail : ''));
    e.code = code;   // 画面は文言ではなく code で判定する
    return e;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function throttle() {
    var since = Date.now() - lastCallAt;
    var p = (lastCallAt && since < MIN_INTERVAL_MS) ? wait(MIN_INTERVAL_MS - since) : Promise.resolve();
    return p.then(function () { lastCallAt = Date.now(); });
  }

  // 欄の種類と、使える書き方（先頭が既定）。entry-roster.js の fill() と対。片方だけ足さないこと。
  var FIELDS = {
    name: [], family: [], given: [], kana: [],
    gender: ['kanji', 'full'],
    genderMale: [], genderFemale: [],
    birth: ['wareki', 'seireki-slash', 'seireki-kanji', 'wareki-short'],
    birthEra: ['full', 'short'],
    birthYear: ['wareki', 'seireki', 'wareki-num', 'wareki-short'],
    birthMonth: [], birthDay: [],
    age: [],
    postal: [],
    address: ['plain', 'with-postal'],
    addressPref: [], addressRest: [],
    phone: []
  };
  // 名前そのものの欄は、AI の fields からは受け取らない（位置は名前の列から決まる）
  var NAME_FIELDS = { name: true, family: true, given: true };

  // ===== 送る形 =====
  // cells は EntryXlsx.cells の形、found は EntryRoster.findNames の結果。
  function layout(sheetName, cells, merges, found) {
    if (cells.length > MAX_CELLS) throw fail('too-many-cells', String(cells.length));
    var masked = global.EntryRoster.mask(cells, found);
    var nameRefs = {};
    found.names.concat(found.suspects).forEach(function (n) { n.refs.forEach(function (r) { nameRefs[r] = true; }); });
    return {
      sheet: sheetName,
      cells: masked.map(function (c) { return { ref: c.ref, text: String(c.text).replace(/\s+/g, ' ').trim() }; })
        .filter(function (c) { return c.text !== ''; }),
      merges: merges.map(function (m) { return m.ref; }),
      nameRefs: nameRefs
    };
  }

  function nameKey(s) { return global.EntryRoster.nameKey(s); }

  // ★ 送る直前の最後の関所。本文に名簿の氏名（空白・表記ゆれを無視して）か、
  //   様式の名前のセルに書かれていた文字が入っていたら、送らずに止める。
  // ※ 姓だけ・名だけでは止めない。「吉田町体育館」のような会場名で誤って止まるため。
  //   名前のセルは mask() が丸ごと伏せるので、姓だけが漏れる経路は無い。
  function guard(text, roster, found) {
    var body = nameKey(text), bodyFold = global.EntryRoster.foldKey(text);
    var needles = [];
    roster.members.forEach(function (m) { needles.push(m.key, m.fold); });
    found.names.concat(found.suspects).forEach(function (n) { needles.push(nameKey(n.text), global.EntryRoster.foldKey(n.text)); });
    for (var i = 0; i < needles.length; i++) {
      var k = needles[i];
      if (k && Array.from(k).length >= 2 && (body.indexOf(k) >= 0 || bodyFold.indexOf(k) >= 0)) throw fail('name-leak');
    }
    return true;
  }

  function prompt(lay) {
    var lines = lay.cells.map(function (c) { return c.ref + '\t' + c.text; }).join('\n');
    return 'これは大会の参加申込書（Excel）の1枚のシート「' + lay.sheet + '」です。' +
      'セルの番地と中身を1行ずつ渡します（番地<TAB>中身）。空のセルは載せていません。\n' +
      '名前は個人情報なので伏せ字にしてあります。〔氏名1〕は1人の氏名、〔氏名1・姓〕〔氏名1・名〕は姓と名が別の欄に書かれた1人です。\n' +
      '**あなたの仕事は、名簿から埋める欄の位置を決めることです。** 値を作る必要はありません。\n' +
      'JSONのオブジェクトだけを返してください（前置き・説明・コードフェンスは不要）。\n' +
      '■ 返す形\n' +
      '{"baseDateRaw":"","baseDate":"","tables":[{"nameCol":"","familyCol":"","givenCol":"","firstRow":0,"lastRow":0,' +
      '"fields":[{"field":"","col":"","rowOffset":0,"fmt":"","mark":""}],"pairSize":1,"ageSumCol":"","ageSumRowOffset":0}],' +
      '"extras":[{"col":"","label":""}]}\n' +
      '■ tables（名前を書く列ごとに1つ）\n' +
      '・nameCol は氏名を書く列の**英字だけ**（例: "C"。行番号や範囲は付けない）。' +
      '**氏名の欄が C〜E 列の結合セルなら、左端の "C" です。** 姓と名が別の列なら nameCol は空文字にし、familyCol と givenCol を入れる。\n' +
      '・firstRow と lastRow は、名前を書く欄が並ぶ最初と最後の行番号。**まだ空の欄も含めます。見出しの行は含めません。**\n' +
      '　監督・選手のように役割の違う行が同じ列に続いていても、欄の並びが同じなら1つの table にまとめてください。\n' +
      '・fields は、その人の名前の行から見た欄です。col は列の英字、rowOffset は名前の行との差' +
      '（同じ行なら 0、ふりがなの欄が名前の1行下なら 1）。**結合セルは左上の番地で考えてください。**\n' +
      '　**1人が1行の表では、rowOffset はすべて 0 です。** 見出しが2段（「生年月日」の下に「年」「月」「日」）でも、' +
      '書く欄は名前と同じ行にあります。見出しの段数に合わせてずらさないでください。\n' +
      '・pairSize は、2人1組（ダブルス）で組ごとに合計年齢などを書く様式なら 2、3人1組なら 3、それ以外は 1。\n' +
      '・ageSumCol は組ごとの「合計年齢」の欄の列（無ければ空文字）。ageSumRowOffset は組の最初の人の行との差。\n' +
      '　**表の下などにある「年齢合計」「合計」の1欄（全員の合計）は、組ではないので入れないでください。** その場合 pairSize は 1、ageSumCol は空文字。\n' +
      '■ field の種類（これ以外は使わない）と fmt\n' +
      '　kana … フリガナ\n' +
      '　gender … 性別を文字で書く欄。fmt: "kanji"（男／女）, "full"（男性／女性）\n' +
      '　genderMale / genderFemale … 「男」「女」の列に印を付ける形。mark に付ける記号（既定は ○）。' +
      '**必ず genderMale と genderFemale の2つを対で入れてください**（片方だけにしない。extras にも入れない）\n' +
      '　birth … 生年月日を1つの欄に書く。fmt: "wareki"（昭和25年4月1日）, "seireki-slash"（1950/4/1）, ' +
      '"seireki-kanji"（1950年4月1日）, "wareki-short"（S25.4.1）\n' +
      '　birthEra … 元号だけを書く欄。fmt: "full"（昭和）, "short"（S）\n' +
      '　birthYear … 年だけを書く欄。fmt: "wareki"（昭和25）, "seireki"（1950）, "wareki-num"（25。元号は別の欄か印刷済み）, "wareki-short"（S25）\n' +
      '　birthMonth / birthDay … 月だけ・日だけの欄\n' +
      '　age … 年齢\n' +
      '　postal … 郵便番号　address … 住所を1つの欄に（fmt: "plain", "with-postal"＝〒を付けて郵便番号から）\n' +
      '　addressPref … 都道府県だけの欄　addressRest … 都道府県より後ろの住所の欄\n' +
      '　phone … 電話番号\n' +
      '・名前の欄そのもの（氏名・姓・名）は fields に入れないでください。\n' +
      '・**名簿から埋められない欄**（所属・段位・参加種目・備考・区分・学年など）は fields に入れず、extras に列と見出しを入れてください。\n' +
      '・**どの欄か判断できないものは入れないこと。推測で欄を作らないこと。**\n' +
      '■ 生年月日の書き方\n' +
      '・**見出しや記入例に書き方の例（「例：1965/1/23」「昭和40年1月23日」など）があれば、その形の fmt を選んでください。** これが最優先です。\n' +
      '・年の欄の近くに「昭和」「平成」「S」「H」「19」などが印刷されているか、見出しに「和暦」「西暦」とあるかを見て fmt を決めてください。\n' +
      '・年・月・日が別の欄で、その左に見出しの無い欄があるときは、そこが元号の欄（birthEra）であることが多いです。' +
      'その場合、年の欄は "wareki-num"、元号の欄は、記入例が「S」「H」の形でなければ "full"（昭和）です。\n' +
      '・手がかりが無いときは、読み手が迷わない "wareki"（昭和25）を選んでください。\n' +
      '■ 年齢の基準日\n' +
      '・「令和9年4月1日現在」のような記載があれば、原文を baseDateRaw に、西暦の日付を baseDate（YYYY-MM-DD）に入れてください。' +
      '無ければどちらも空文字。**書かれていない基準日を作らないこと。**\n' +
      '■ シート\n' + lines + '\n' +
      (lay.merges.length ? '■ 結合セル\n' + lay.merges.join(' ') + '\n' : '');
  }

  // ===== 答えを整える =====
  // 形も値も信用しない。使えない欄は捨てて problems に残す（画面で知らせる）。
  function str(v) { return v == null ? '' : String(v).trim(); }
  // 列は英字で受け取るが、AI は「C14」「C:E」「$C」「C列」「Ｃ」と書いてくることがある。先頭の英字を採る。
  // ★ 2026-09-15、本物の百万石の様式（氏名が C14:E14 の結合）で、名前の列が読めずに表ごと捨てていた
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
    var out = { baseDate: null, baseDateRaw: str(o.baseDateRaw), tables: [], extras: [], problems: [] };

    // 基準日は原文をこちらで読み直す。AI の西暦とずれたら原文を採る（和暦の換算を AI に任せない）
    var fromRaw = dateIn(out.baseDateRaw);
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(o.baseDate));
    var fromAi = m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
    out.baseDate = fromRaw || fromAi;
    if (fromRaw && fromAi && (fromRaw.y !== fromAi.y || fromRaw.m !== fromAi.m || fromRaw.d !== fromAi.d)) {
      out.problems.push({ code: 'base-date-differs', raw: out.baseDateRaw, ai: str(o.baseDate) });
    }

    (Array.isArray(o.tables) ? o.tables : []).forEach(function (t, ti) {
      if (!t || typeof t !== 'object') return;
      var tb = {
        nameCol: col(t.nameCol), familyCol: col(t.familyCol), givenCol: col(t.givenCol),
        firstRow: int(t.firstRow, 1, 100000, 0), lastRow: int(t.lastRow, 1, 100000, 0),
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
        tb.fields.push(nf);
      });
      // 男・女の列に印を付ける形は、2列が対でないと片方の性別の欄が空のまま出る（2026-09-15、軽量版が「男」の列を落とした）
      var hasM = tb.fields.some(function (f) { return f.field === 'genderMale'; });
      var hasF = tb.fields.some(function (f) { return f.field === 'genderFemale'; });
      if (hasM !== hasF) out.problems.push({ code: 'gender-mark-unpaired', table: ti, missing: hasM ? 'genderFemale' : 'genderMale' });
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
    //   AI が生年月日の4欄を名前の1行下と答えた。そのまま書くと1人目の生年月日が2人目の行に入り、
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
        fields.push(nf);
      });
      var slot = { name: n, fields: fields };
      slots.push(slot);

      if (tb.pairSize > 1 && tb.ageSumCol) {
        var idx = Math.floor((p.row - tb.firstRow) / tb.pairSize);
        var start = tb.firstRow + idx * tb.pairSize;
        var sumRef = anchor(tb.ageSumCol + (start + tb.ageSumRowOffset));
        // ★ 合計の欄も、式・文字・名前の入った欄には書かない（2026-09-15、本物の Gemini が
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

  // ===== 同じ様式かどうか =====
  // 名前のセルを除いた「見出しと結合の形」から鍵を作る。幹事や人数が違っても、同じ様式なら同じ鍵になる。
  function cacheKey(lay) {
    var text = lay.sheet + '\n' + lay.merges.slice().sort().join(' ') + '\n' +
      lay.cells.filter(function (c) { return !lay.nameRefs[c.ref]; })
        .map(function (c) { return c.ref + '\t' + c.text; }).join('\n');
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  // 保存するのは欄の対応だけ（個人情報は入っていない）。端末の localStorage に置く。
  var cache = {
    get: function (key) {
      try {
        var all = JSON.parse(global.localStorage.getItem(CACHE_LS) || '{}');
        return all[key] ? all[key].mapping : null;
      } catch (e) { return null; }
    },
    put: function (key, mapping) {
      try {
        var all = JSON.parse(global.localStorage.getItem(CACHE_LS) || '{}');
        all[key] = { mapping: mapping, savedAt: Date.now() };
        var keys = Object.keys(all).sort(function (a, b) { return all[b].savedAt - all[a].savedAt; });
        keys.slice(CACHE_MAX).forEach(function (k) { delete all[k]; });
        global.localStorage.setItem(CACHE_LS, JSON.stringify(all));
      } catch (e) {
        // 保存できなくても続ける（次回もう一度 AI に聞くだけ）。黙らずに残す
        if (global.console) console.warn('entry-ai: cache put failed', e);
      }
    },
    forget: function (key) {
      try {
        var all = JSON.parse(global.localStorage.getItem(CACHE_LS) || '{}');
        delete all[key];
        global.localStorage.setItem(CACHE_LS, JSON.stringify(all));
      } catch (e) {}
    }
  };

  function extractJson(text) {
    var s = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(s); } catch (e) {}
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) {} }
    return null;
  }

  // ===== AI に聞く =====
  // opts: { apiKey, roster, found, onStatus, fetch }
  //   fetch と throttle:false は試験用（偽の Gemini に差し替え、5秒待たない）。画面からは渡さない
  function map(lay, opts) {
    opts = opts || {};
    var say = opts.onStatus || function () {};
    var doFetch = opts.fetch || global.fetch.bind(global);
    if (!opts.apiKey) return Promise.reject(fail('no-key'));
    if (!opts.roster || !opts.found) return Promise.reject(fail('no-roster'));
    var text = prompt(lay);
    try { guard(text, opts.roster, opts.found); } catch (e) { return Promise.reject(e); }

    var body = JSON.stringify({
      contents: [{ parts: [{ text: text }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' }
    });
    var i = 0;
    function attempt() {
      say(i === 0 ? 'running' : 'retry', MODELS[i]);
      var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODELS[i] +
        ':generateContent?key=' + encodeURIComponent(opts.apiKey);
      return doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body })
        .then(function (resp) {
          var busy = [500, 502, 503, 504].indexOf(resp.status) !== -1;
          // 無料枠はモデルごとに数えられるので、上限に当たったら別のモデルも試す。
          // ★ 404 は「そのモデルはもう無い」。次のモデルを試す（2026-09-15、予備の gemini-2.0-flash が 404 を返した）
          if ((busy || resp.status === 429 || resp.status === 404) && i < MODELS.length - 1) {
            say('fallback', MODELS[i] + ' → ' + resp.status);
            i++;
            return attempt();
          }
          return resp;
        });
    }
    say('queued');
    return (opts.throttle === false ? Promise.resolve() : throttle()).then(attempt).then(function (resp) {
      if (resp.status === 429) {
        // 429 は「1分あたり」と「1日あたり」の両方で返る。待ち時間がまったく違うので中身で区別する
        return resp.text().catch(function () { return ''; }).then(function (q) {
          throw fail(/per\s*minute|PerMinute|per_minute/i.test(q) ? 'rate-minute' : 'rate-day');
        });
      }
      if ([500, 502, 503, 504].indexOf(resp.status) !== -1) throw fail('busy');
      if (resp.status === 404) {
        return resp.text().catch(function () { return ''; }).then(function (t) {
          if (global.console) console.warn('entry-ai: model not found', t.slice(0, 300));
          throw fail('model-unavailable');   // ツール側の MODELS を直す必要がある。利用者の操作では直らない
        });
      }
      if (!resp.ok) {
        return resp.text().catch(function () { return ''; }).then(function (t) {
          if (global.console) console.warn('entry-ai: http ' + resp.status, t.slice(0, 300));
          throw fail('http-' + resp.status);
        });
      }
      return resp.json().then(function (data) {
        var txt = ((((data.candidates || [])[0] || {}).content || {}).parts || [])
          .map(function (p) { return p.text || ''; }).join('');
        var json = extractJson(txt);
        // "文字列" や [配列] も JSON としては正しいので、オブジェクトでなければ壊れた答えとして止める
        if (!json || typeof json !== 'object' || Array.isArray(json)) throw fail('bad-json');
        // 整える前の答え。捨てた理由を調べるときに見る（名前は最初から入っていない）
        say('answer', json);
        return normalize(json);
      });
    });
  }

  global.EntryAI = {
    layout: layout, guard: guard, prompt: prompt, map: map, normalize: normalize, slotsFor: slotsFor,
    cacheKey: cacheKey, cache: cache, extractJson: extractJson, MODELS: MODELS, FIELDS: FIELDS
  };
})(typeof window !== 'undefined' ? window : this);
