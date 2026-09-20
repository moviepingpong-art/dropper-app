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
  //   [{ nameCol, familyCol, givenCol, headerRow, firstRow, lastRow, rows }]
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
                   rows: span.rows });
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

  // 行のどこかにある「数字でない文字」。★ 名前の列より左の短い文字は、行の名札（「監督」「選手」）
  function otherText(g, r, col) {
    for (var c = 1; c <= Math.min(g.maxCol, col + 15); c++) {
      var t = g.text(r, c);
      if (!t || /^\d+$/.test(t)) continue;
      if (c < col && t.length <= LABEL_MAX) continue;
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

  global.EntryBlank = { tables: tables };
})(typeof window !== 'undefined' ? window : this);
