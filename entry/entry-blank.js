// entry-blank.js — 空の申込書から「名前を書く表」を見つける
//
// ★ 2026-09-18、本人の要望。これまでは「幹事が名前だけ書いた申込書」を入れる形だったが、
//   **空の申込書を入れて、名簿から人を選ぶ**形も使えるようにする。打ち間違いと表記ゆれが無くなる。
//
// 名前が1つも書かれていない様式には、名前の位置という手がかりが無い。見出しと、罫線を引いた
// 空のセルの並びから、表（名前の列と、書ける行）を見つける。
//
// 考え方（測って決めた。数字は entry/test/README.md）:
//   1. 「氏名」「選手名」「姓」「名」の見出しを探す（★ 空白を取ってから見る。「氏　名」がある）
//   2. その下に続く行を数える。次のどれかで終わり:
//      - 名前の欄に文字が入っている行（別の表の見出し）
//      - 数字以外の文字がある行（★ ただし、名前の列より左の短い文字は行の名札とみなす。「監督」「選手」「No.」）
//      - セルの並び（どの列にセルがあるか）が変わった行（★ 表の下に空けてある行・次の表の枠）
//      - 何も無い行
//   3. 見出しが2行に分かれている様式（「生年月日」の下に「年」「月」「日」）は、
//      記入行が始まる前なら読み飛ばす
//
// ★ 外れたときの逃げ道を必ず用意すること（画面で行の範囲を直せるようにする）。
//   規則は、作った人が知っている様式では当たりすぎる（2026-09-15 に踏んだ）。
//
// window.EntryBlank = { tables } を公開する。
(function (global) {
  'use strict';

  var LOOK_DOWN = 60;          // 見出しの下を、これだけの行まで見る
  var LABEL_MAX = 4;           // 名前の列より左にある「行の名札」とみなす文字の長さ
  var LABEL_NEAR = 2;          // 名札とみなすのは、名前の列からこれだけ左まで

  var NAME_RE = /^(氏名|名前|選手名|会員名|フルネーム|参加者名|選手氏名)$/;
  var FAMILY_RE = /^(姓|苗字|名字)$/;
  var GIVEN_RE = /^名$/;

  function nfkc(s) {
    s = String(s == null ? '' : s);
    try { s = s.normalize('NFKC'); } catch (e) {}
    return s.trim();
  }
  function key(s) { return nfkc(s).replace(/\s+/g, ''); }
  function colName(n) {
    var s = '';
    while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
    return s;
  }

  // grid（EntryXlsx.grid の形）から、引きやすい形を作る
  function index(grid) {
    var at = {}, maxCol = 1;
    grid.forEach(function (c) {
      at[c.row + ':' + c.col] = c;
      if (c.col > maxCol) maxCol = c.col;
    });
    return {
      at: function (r, c) { return at[r + ':' + c] || null; },
      text: function (r, c) { var x = at[r + ':' + c]; return x ? nfkc(x.text) : ''; },
      maxCol: maxCol
    };
  }

  // 空の様式から表を探す。戻り値:
  //   [{ nameCol, familyCol, givenCol, headerRow, firstRow, lastRow, rows, skip }]
  //   nameCol / familyCol+givenCol は列の英字。rows は書ける行の並び
  function tables(grid) {
    var g = index(grid);
    var found = [];
    grid.forEach(function (c) {
      var t = key(c.text);
      var kind = NAME_RE.test(t) ? 'name' : (FAMILY_RE.test(t) ? 'family' : (GIVEN_RE.test(t) ? 'given' : null));
      if (!kind) return;
      var span = rowsBelow(g, c.row, c.col);
      if (!span) return;
      found.push({ kind: kind, col: c.col, headerRow: c.row, firstRow: span.from, lastRow: span.to,
                   rows: span.rows,
                   skip: span.rows.length === 1 && striped(g, span.from, c.col) ? 'two-rows' : '' });
    });

    // 「姓」と「名」が同じ行に並んでいたら、1つの表にまとめる
    var out = [];
    found.forEach(function (f) {
      if (f.kind === 'given') return;
      if (f.kind === 'family') {
        var given = found.filter(function (x) {
          return x.kind === 'given' && x.headerRow === f.headerRow && x.col > f.col && x.col <= f.col + 3 &&
            x.firstRow === f.firstRow && x.lastRow === f.lastRow;
        })[0];
        if (!given) return;   // 「姓」だけの表は扱わない（「名」が見つからないと書けない）
        out.push(make(f, { familyCol: colName(f.col), givenCol: colName(given.col) }, g));
        return;
      }
      out.push(make(f, { nameCol: colName(f.col) }, g));
    });
    return out.sort(function (a, b) { return a.firstRow - b.firstRow || a.headerRow - b.headerRow; });
  }

  function make(f, cols, g) {
    // ★ 飛ばした行（ふりがなの行）は書ける行に入れない。rows が無いときだけ、上から下まで並べる
    var rows = f.rows && f.rows.length ? f.rows.slice() : [];
    if (!rows.length) for (var r = f.firstRow; r <= f.lastRow; r++) rows.push(r);
    var t = { headerRow: f.headerRow, firstRow: f.firstRow, lastRow: f.lastRow, rows: rows, label: labelOf(g, f) };
    if (f.skip) t.skip = f.skip;                 // 読めないと分かった表（1人=2行）
    Object.keys(cols).forEach(function (k) { t[k] = cols[k]; });
    return t;
  }

  // 表の名前。見出しのすぐ上の、同じ列にある短い文字を使う（スポレクの「連絡責任者」）。
  // ★ 遠くの文字は拾わない。見当違いの名前を付けるより、名前が無いほうがよい
  function labelOf(g, f) {
    if (!g) return '';
    var t = g.text(f.headerRow - 1, f.col);
    return (t && t.length <= 10 && !/^\d+$/.test(t)) ? t : '';
  }

  // ★ 「記入例」の札。見出しのすぐ下に書き方の見本を載せる様式がある（2026-09-20、本物の
  //   関東ラージボール卓球大会の様式で発覚。7〜10行目が取手太郎などの見本で、そこで行き止まりになり
  //   表を1つも見つけられず、シートごと落ちていた）
  var EXAMPLE_RE = /記入例|記載例|見本|例示/;

  // その行が見本の行か（名前の列より左にある札を見る。札は結合されて先頭行にしか無いことがある）
  function isExampleRow(g, r, col) {
    for (var c = 1; c < col; c++) {
      var t = g.text(r, c);
      if (t && EXAMPLE_RE.test(nfkc(t))) return true;
    }
    return false;
  }

  // ★ 名前の列そのものに「フリガナ」と印刷してある様式がある（2026-09-20、本物の武蔵野市の様式）。
  //   ふりがな欄を名前の上に置く作りで、「フリガナ」の行と名前の行が**交互**に並ぶ。
  //   飛ばさないと1行目で行き止まりになり、表が見つからない。
  //   ★ 飛ばした行は「書ける行」に入れない。入れると、ふりがなの欄に名前を書いてしまう
  var KANA_LABEL_RE = /^(フリガナ|ふりがな|カナ|かな|ヨミ|よみ|読み|読み方)$/;

  // ★ 1人分を2行に分けて書く様式（上の行がふりがな、下の行が氏名）。2026-09-20、本物の
  //   青梅市少年軟式野球連盟「選手登録届」で発覚。No と背番号は2行にまたがって結合してあるのに、
  //   名前の欄だけが2行に分かれている。行の並びが1行で行き止まりになるため、
  //   **1人だけ・しかも「ふりがなの行」に**名前を書いていた。
  //   黙って違う欄に書くほうが、書かないより重い。この形と分かった表は諦める（skip を付けて返す）。
  //   ★ 対応そのものは別の話。どちらが氏名の行かは文字の大きさで分かる（10pt と 16pt）が、
  //     取り違えると全員分を間違えるので、まず止めるほうを先にした
  var STRIPE_MIN = 3;          // 同じ形が3回くり返したら「2行で1人」と決める

  // 1行で行き止まりになった表の下に、「2行ひと組」の並びが続いているか
  function striped(g, from, col) {
    var even = shapeOf(g, from, col), odd = shapeOf(g, from + 1, col);
    if (!g.at(from + 1, col) || g.text(from + 1, col) || odd === even) return false;
    for (var k = 1; k < STRIPE_MIN; k++) {
      var a = from + k * 2, b = a + 1;
      if (!g.at(a, col) || g.text(a, col) || shapeOf(g, a, col) !== even) return false;
      if (!g.at(b, col) || g.text(b, col) || shapeOf(g, b, col) !== odd) return false;
    }
    return true;
  }

  // 見出しの下に続く「書ける行」を数える。rows は実際に書ける行の並び（飛ばした行は入らない）
  function rowsBelow(g, headerRow, col) {
    var from = null, to = null, shape = null, inExample = false, rows = [];
    for (var r = headerRow + 1; r <= headerRow + LOOK_DOWN; r++) {
      var cell = g.at(r, col);
      var own = cell ? nfkc(cell.text) : '';
      // ★ 見本の行は飛ばす。札は結合で先頭行にしかないことがあるので、いちど見たら
      //   名前の欄が空く行まで飛ばし続ける。表が始まったあとは飛ばさない（別の表の見出しを吸わないため）
      if (from == null) {
        if (isExampleRow(g, r, col)) inExample = true;
        if (inExample) { if (own) continue; inExample = false; }
      }
      if (own && KANA_LABEL_RE.test(own.replace(/\s/g, ''))) continue;   // ふりがなの行は飛ばす
      if (own && !/^\d+$/.test(own)) break;              // 名前の欄に文字（別の表の見出し）
      if (otherText(g, r, col)) {
        if (from == null) continue;                     // 見出しの2行目（「年」「月」「日」）は読み飛ばす
        break;
      }
      if (!cell) { if (from != null) break; else continue; }
      if (from == null) { from = r; to = r; shape = shapeOf(g, r, col); rows.push(r); continue; }
      if (shapeOf(g, r, col) !== shape) break;          // セルの並びが変わった（空けてある行・次の表の枠）
      to = r;
      rows.push(r);
    }
    return from == null ? null : { from: from, to: to, rows: rows };
  }

  // 行のどこかにある「数字でない文字」。★ 名前の列のすぐ左の短い文字は、行の名札（「監督」「選手」）
  // ★ 名札とみなすのは「すぐ左」だけ（2026-09-20、本物の八王子市バレーボール連盟のエントリー用紙）。
  //   同じ形の表が左右に並ぶ様式で、**左の表は右の表の「監督」で止まり、右の表は止まらない**という
  //   食い違いが出ていた（左15行・右17行）。遠くの短い文字は自分の名札ではなく、隣の表のもの。
  //   隣の表の文字が出てきたら、そこで自分の表は終わりでよい
  function otherText(g, r, col) {
    for (var c = 1; c <= Math.min(g.maxCol, col + 15); c++) {
      var t = g.text(r, c);
      if (!t || /^\d+$/.test(t)) continue;
      if (c < col && c >= col - LABEL_NEAR && t.length <= LABEL_MAX) continue;
      return t;
    }
    return '';
  }

  // その行の「どの列にセルがあるか」
  function shapeOf(g, r, col) {
    var cols = [];
    for (var c = 1; c <= Math.min(g.maxCol, col + 15); c++) if (g.at(r, c)) cols.push(c);
    return cols.join(',');
  }

  // ★ 表が見つからなかった様式で、本人が「名前の列と書く行」を教える道（2026-09-20）。
  //   様式は競技ごと団体ごとに無数にあり、見出しの規則で網羅はできないと決めた。
  //   規則が外れても、指してもらえば書ける。tables() と同じ形を返す（taught の印つき）。
  //   ★ 受け取れない指定は null を返す。呼び手が画面で知らせること
  function manual(col, from, to) {
    var c = String(col == null ? '' : col);
    try { c = c.normalize('NFKC'); } catch (e) {}
    c = c.replace(/\s+/g, '').replace(/列$/, '').toUpperCase();
    if (!/^[A-Z]{1,3}$/.test(c)) return null;
    var f = Math.floor(Number(from)), t = Math.floor(Number(to));
    if (!(f >= 1 && t >= f && t - f < 200)) return null;
    var rows = [];
    for (var r = f; r <= t; r++) rows.push(r);
    return { headerRow: Math.max(1, f - 1), firstRow: f, lastRow: t, rows: rows,
             label: '', nameCol: c, taught: true };
  }

  // ★ 前に教えてもらった形・直した「書く行」を当てる（2026-09-20）。
  //   覚える形は { rows: { 列: [開始, 終了] }, taught: [列, ...] }（列と行の番号だけ。個人情報は入らない）。
  //   - 表が見つかっているとき: 覚えている行に直す
  //   - 表が1つも見つからないとき: 教えてもらった形から作る（もう一度聞かない）
  //   戻り値 { tables, changed, taught }。changed が true のときは画面でそう知らせること
  function restore(tables, remembered) {
    var rows = (remembered && remembered.rows) || {};
    if (tables && tables.length) {
      var changed = false;
      tables.forEach(function (tb) {
        var got = tb.nameCol && rows[tb.nameCol];
        if (!got || got.length !== 2) return;
        var tb2 = manual(tb.nameCol, got[0], got[1]);
        if (!tb2 || (tb.firstRow === tb2.firstRow && tb.lastRow === tb2.lastRow)) return;
        tb.firstRow = tb2.firstRow; tb.lastRow = tb2.lastRow; tb.rows = tb2.rows;
        changed = true;
      });
      return { tables: tables, changed: changed, taught: false };
    }
    var made = ((remembered && remembered.taught) || []).map(function (col) {
      var got = rows[col];
      return got && got.length === 2 ? manual(col, got[0], got[1]) : null;
    }).filter(Boolean);
    return { tables: made, changed: made.length > 0, taught: made.length > 0 };
  }

  // 覚える形を、いまの表から作る
  function remember(tables) {
    var rows = {}, taught = [];
    (tables || []).forEach(function (tb) {
      if (!tb.nameCol) return;
      rows[tb.nameCol] = [tb.firstRow, tb.lastRow];
      if (tb.taught) taught.push(tb.nameCol);
    });
    return { rows: rows, taught: taught };
  }

  // ★ シートの名前そのものが「記入例」の様式がある（2026-09-20、本物の青梅市の登録名簿）。
  //   書く紙ではないので、表が見つからなくても教えてもらわない（前は黙って飛ばしていた）
  function isExampleName(name) { return EXAMPLE_RE.test(nfkc(name)); }

  global.EntryBlank = { tables: tables, manual: manual, restore: restore, remember: remember,
                        isExampleName: isExampleName };
})(typeof window !== 'undefined' ? window : this);
