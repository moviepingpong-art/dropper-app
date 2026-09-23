// 申込書の見取り図の「形」を作る（2026-09-24）
//
// ★ ③で「どこに書くか」を画面で見せるため（本人の要望）。いままでは「B列 10〜19行目」と文字で出し、
//   利用者は申込書を Excel で開いて見比べるしかなかった。
// ★ 本物の Excel を映すのではない。このツールがもう読んでいる中身（文字・結合・罫線・列の幅・行の高さ）
//   から描く。外の表示サービスは使わない（使うとファイルを送ることになり、「どこにも送らない」と食い違う）。
// ★ ここは形を決めるだけ。画面の部品は entry-app.js の sheetView が作る（ここは node で試験できる）。
//   書体・色・図形・画像は描かない。「自分の申込書だ」と分かれば足りる。
(function (global) {
  'use strict';

  var MAX_ROWS = 60;     // これより長い範囲は切る。見取り図であって、全部を見せる場所ではない
  var MAX_COLS = 24;
  var ABOVE = 3;         // 表の見出しの上に何行見せるか（大会名や「※年齢は…現在」が入っていることが多い）
  var KEEP_LEFT = 2;     // 列を切るとき、名前の列より左に残す数（No. の列など）
  var MIN_ROW_PX = 18;   // 行が低すぎると字が読めない

  function letter(n) {
    var s = '';
    while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function refOf(col, row) { return letter(col) + row; }
  // ★ Math.min.apply は並びが長いと引数の上限に当たる（書式だけのセルが何万もある様式がある）
  function least(list, key) { return list.reduce(function (m, x) { return Math.min(m, x[key]); }, Infinity); }
  function most(list, key) { return list.reduce(function (m, x) { return Math.max(m, x[key]); }, -Infinity); }

  // Excel の列の幅（文字数）→ 画面の点。標準の書体での目安（Excel 自身の換算に近い）
  function colPx(w) { return Math.max(0, Math.round(w * 7 + 5)); }
  // 行の高さ（ポイント）→ 画面の点
  function rowPx(pt) { return Math.max(0, Math.round(pt * 4 / 3)); }

  var NONE = { t: '', b: '', l: '', r: '' };

  // grid: EntryXlsx.grid の結果。merges: EntryXlsx.merges の結果。layout: EntryXlsx.layout の結果。
  // focus: [{ top, bottom, left, right }]（表の見出しの行〜最後の行、名前の列）。
  //        無ければ、シートで使われている範囲をそのまま描く（表が見つからなかったとき）。
  // 戻り値: { r0, r1, c0, c1, cut: { rows, cols }, cols: [{ col, letter, px }],
  //          rows: [{ row, px, cells: [{ ref, row, col, text, colspan, rowspan, border }] }] }
  //         結合セルは左上の ref で返す（書くのも左上なので、印を付けるときに ref がそろう）。
  function frame(grid, merges, layout, focus) {
    layout = layout || { cols: {}, rows: {}, borders: {}, defColW: 8.43, defRowH: 15 };
    merges = merges || [];
    var used = (grid || []).filter(function (c) { return c.styled || c.text; });
    if (!used.length) return null;

    var r0, r1, fl = null, fr = null;
    if (focus && focus.length) {
      r0 = Math.max(1, least(focus, 'top') - ABOVE);
      r1 = most(focus, 'bottom') + 1;
      fl = least(focus, 'left');
      fr = most(focus, 'right');
    } else {
      r0 = least(used, 'row');
      r1 = most(used, 'row');
    }
    var inRows = used.filter(function (c) { return c.row >= r0 && c.row <= r1; });
    if (!inRows.length) inRows = used;
    var c0 = least(inRows, 'col');
    var c1 = most(inRows, 'col');
    if (fl !== null) { c0 = Math.min(c0, fl); c1 = Math.max(c1, fr); }

    var cut = { rows: false, cols: false };
    if (r1 - r0 + 1 > MAX_ROWS) { r1 = r0 + MAX_ROWS - 1; cut.rows = true; }
    if (c1 - c0 + 1 > MAX_COLS) {
      cut.cols = true;
      // ★ 表の列が切れないように寄せる。表は名前の列から右へ伸びるので、左は少しだけ残す
      if (fl !== null) c0 = Math.max(c0, fl - KEEP_LEFT);
      // 寄せたぶん右へ伸ばすが、使われている列より右へは出ない（空の列を描かない）
      c1 = Math.min(c1, c0 + MAX_COLS - 1);
    }

    // 隠れた列・行は描かない（Excel でも見えない）
    var cols = [], rows = [];
    for (var c = c0; c <= c1; c++) {
      var ci = layout.cols[c] || {};
      var w = (ci.width !== null && ci.width !== undefined) ? ci.width : layout.defColW;
      if (ci.hidden || w === 0) continue;
      cols.push({ col: c, letter: letter(c), px: colPx(w) });
    }
    for (var r = r0; r <= r1; r++) {
      var ri = layout.rows[r] || {};
      var hgt = (ri.height !== null && ri.height !== undefined) ? ri.height : layout.defRowH;
      if (ri.hidden || hgt === 0) continue;
      rows.push({ row: r, px: Math.max(MIN_ROW_PX, rowPx(hgt)), cells: [] });
    }
    if (!cols.length || !rows.length) return null;

    var text = {};
    grid.forEach(function (x) { if (x.text) text[x.ref] = x.text; });
    var border = function (ref) { return layout.borders[ref] || NONE; };

    // 結合: 範囲のうち見えている最初のマスを頭にし、残りは描かない。
    // ★ 範囲の頭が窓の外（上や左）にあっても、見えている部分だけで描く
    var cover = {}, head = {};
    merges.forEach(function (g) {
      var vr = rows.filter(function (x) { return x.row >= g.top && x.row <= g.bottom; });
      var vc = cols.filter(function (x) { return x.col >= g.left && x.col <= g.right; });
      if (!vr.length || !vc.length) return;
      var hr = vr[0].row, hc = vc[0].col;
      head[refOf(hc, hr)] = { g: g, rowspan: vr.length, colspan: vc.length };
      vr.forEach(function (x) {
        vc.forEach(function (y) { if (x.row !== hr || y.col !== hc) cover[refOf(y.col, x.row)] = true; });
      });
    });

    rows.forEach(function (rw) {
      cols.forEach(function (cl) {
        var rf = refOf(cl.col, rw.row);
        if (cover[rf]) return;
        var hd = head[rf];
        if (!hd) {
          rw.cells.push({ ref: rf, row: rw.row, col: cl.col, text: text[rf] || '',
            colspan: 1, rowspan: 1, border: border(rf) });
          return;
        }
        var g = hd.g, anchor = refOf(g.left, g.top);
        // 結合の罫線: 上と左は左上のマス、下は左下のマス、右は右上のマスの罫線を使う
        var tl = border(anchor);
        var bl = border(refOf(g.left, g.bottom)), tr = border(refOf(g.right, g.top));
        rw.cells.push({ ref: anchor, row: g.top, col: g.left, text: text[anchor] || '',
          colspan: hd.colspan, rowspan: hd.rowspan,
          border: { t: tl.t, l: tl.l, b: bl.b || tl.b, r: tr.r || tl.r } });
      });
    });

    return { r0: r0, r1: r1, c0: c0, c1: c1, cut: cut, cols: cols, rows: rows };
  }

  // ===== 印（画面から切り離してある。試験で壊れ方を捕まえるため） =====
  function colNum(letters) {
    var n = 0, s = String(letters || '').toUpperCase();
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n;
  }

  // 見取り図で、表のあたりを見せる範囲。tables: EntryBlank の表
  function focusOf(tables) {
    return (tables || []).map(function (tb) {
      return { top: tb.headerRow || tb.firstRow, bottom: tb.lastRow,
        left: colNum(tb.nameCol || tb.familyCol), right: colNum(tb.nameCol || tb.givenCol) };
    });
  }

  // ③（空の申込書）で付ける印。{ ref: { cls, text } }。text が null ならセルの文字をそのまま出す
  //   sv-put  … 選んだ人が入る欄（名前を出す）
  //   sv-next … 次に選んだ人が入る欄（表ごとに1つ）
  //   sv-slot … まだ空いている書く欄
  //   sv-kana … 上の行がふりがなの様式の、ふりがなの行（書くのはツールが決める）
  //   sv-head … 名前の列の見出し
  // ★ 2枚目に回る人（表の行数より後ろ）は描かない。見取り図は1枚目の姿
  function marks(tables, picks) {
    var out = {};
    var soft = function (ref, m) { if (!out[ref]) out[ref] = m; };
    (tables || []).forEach(function (tb, ti) {
      var list = (picks && picks[ti]) || [];
      tb.rows.forEach(function (row, i) {
        var m = list[i];
        var cls = m ? 'sv-put' : (i === list.length ? 'sv-next' : 'sv-slot');
        // g は表の番号（画面で表ごとに色を分けるため）
        if (tb.nameCol) {
          out[tb.nameCol + row] = { cls: cls, text: m ? m.name : null, g: ti };
        } else {
          // 姓と名が別の欄の様式。名簿で姓・名に分かれていなければ、姓の欄にまとめて見せる
          var split = m && m.family && m.given;
          out[tb.familyCol + row] = { cls: cls, text: m ? (split ? m.family : m.name) : null, g: ti };
          out[tb.givenCol + row] = { cls: cls, text: m ? (split ? m.given : '') : null, g: ti };
        }
        if (tb.kanaAbove) soft((tb.nameCol || tb.familyCol) + (row - 1), { cls: 'sv-kana', text: null, g: ti });
      });
      if (tb.headerRow) soft((tb.nameCol || tb.familyCol) + tb.headerRow, { cls: 'sv-head', text: null, g: ti });
    });
    return out;
  }

  // ★ 教える画面で見取り図のマスを押したとき（2026-09-24）。
  //   1回目＝最初の人のマス（列と開始行）、2回目＝最後の人のマス（終了行）、3回目は選び直し。
  //   2回目に別の列を押しても、列は1回目のものを使う（名前は縦に並ぶので）。
  //   上へ向かって押しても、開始と終了を入れ替えて受け取る。
  //   sel: { col: 'B', from: 10, to: null|19 } または null
  function point(sel, col, row) {
    if (!sel || sel.to !== null) return { col: letter(col), from: row, to: null };
    return { col: sel.col, from: Math.min(sel.from, row), to: Math.max(sel.from, row) };
  }

  // 選んでいる範囲の印（200行まで。EntryBlank.manual と同じ上限）
  function pointMarks(sel) {
    var out = {};
    if (!sel) return out;
    var to = sel.to === null ? sel.from : sel.to;
    for (var r = sel.from; r <= to && r - sel.from < 200; r++) {
      out[sel.col + r] = { cls: r === sel.from ? 'sv-sel sv-sel-start' : 'sv-sel', text: null };
    }
    return out;
  }

  // ===== 表の名前（2026-09-24、本人の要望） =====
  // ★ 作業中に「いま何の欄に入れているか」が分かるようにするため。申込書には書かない（見せるだけ）。
  // ★ 申込書に書いてあれば、それをそのまま使う（本人の判断）。語の一覧は持たない——
  //   卓球の「男子シングルス」も、陸上の「100m」も、合唱の「ソプラノ」も同じ扱いにするため。
  //   本物の様式48表で数えたら、種目の語が近くに無い表が25あった。無ければ本人が付ける。
  var TITLE_UP = 4;       // 表の見出しから何行上まで探すか
  var TITLE_MAX = 25;     // これより長い文字は題ではない（説明文）
  // 指示文は題ではない（「ダブルス①～⑤の番号を記入」「○を付けてください」）
  var INSTRUCT_RE = /記入|ください|下さい|番号を|を付け|をつけ|に○|に〇|丸で|選んで|※/;
  // 記入欄の札は題ではない（「団体名 [____]」「連絡先」「代表者名」「連絡責任者」）
  var FIELD_RE = /(名|番号|住所|電話|TEL|FAX|メール|mail|年月日|先|者|No\.?|№)$|代表|責任|連絡/i;
  // 書き込まれた中身らしいもの（電話・日付・メール・郵便番号）。
  // ★ 「札: 中身」を1つのセルに書いたもの（「参加チーム名: 白山クラブ」）も中身。2026-09-24、本物のスポレクで、
  //   連絡責任者の表の名前がチーム名になっていた
  var DATA_RE = /\d{2,}\s*[-‐－\/.．]\s*\d|@|＠|〒|[:：]\s*\S/;

  function textIndex(grid, merges) {
    var text = {}, anchorOf = {};
    (grid || []).forEach(function (c) { if (c.text) text[c.row + ',' + c.col] = c.text; });
    (merges || []).forEach(function (g) {
      if ((g.bottom - g.top + 1) * (g.right - g.left + 1) > 4000) return;   // 巨大な結合はほどかない
      for (var r = g.top; r <= g.bottom; r++) {
        for (var c = g.left; c <= g.right; c++) anchorOf[r + ',' + c] = g.top + ',' + g.left;
      }
    });
    return function (r, c) {
      var k = anchorOf[r + ',' + c] || (r + ',' + c);
      return { key: k, text: text[k] || '' };
    };
  }

  // 表の横の広がり。見出しの行で、名前の列から左右へ文字のある列が続くところ（1列の空きは続きとみなす）
  function spanOf(at, tb) {
    var nc = colNum(tb.nameCol || tb.familyCol);
    var hr = tb.headerRow || tb.firstRow;
    var has = function (c) { return c >= 1 && !!at(hr, c).text; };
    var lo = nc, hi = nc;
    while (lo > 1 && (has(lo - 1) || has(lo - 2))) lo -= has(lo - 1) ? 1 : 2;
    while (hi - nc < 30 && (has(hi + 1) || has(hi + 2))) hi += has(hi + 1) ? 1 : 2;
    return { lo: Math.max(1, lo - 1), hi: hi, hr: hr };
  }

  var TITLE_PARTS = 3;    // 1行に題らしい文字がこれより多ければ、題の行ではない（見出しや札の並び）
  var TITLE_JOINED = 40;  // 並べた題がこれより長ければ使わない

  // 見せる形に整える。改行は空白に。
  // ★ 1字ずつ空けて並べた字（均等割り付け「シ　ン　グ　ル　ス」）は詰める。
  //   ただし1字が3つ以上続くときだけ（「100m 走」の空白は残す）
  function clean(t) {
    var parts = String(t || '').split(/[\s　]+/).filter(Boolean);
    var out = [], run = [];
    var flush = function () {
      if (run.length >= 3) out.push(run.join(''));
      else out = out.concat(run);
      run = [];
    };
    parts.forEach(function (p) {
      if (p.length === 1) run.push(p);
      else { flush(); out.push(p); }
    });
    flush();
    return out.join(' ');
  }

  // 表の題。見出しのすぐ上から順に探し、最初に題らしい文字が見つかった行のものを返す。
  //   同じ行に2つ以上あれば、書いてあるまま並べる（「シングルス／混合ダブルス」）。
  //   ★ ほかの表の行に入ったら、そこで探すのをやめる（上の表の中身を題と取り違えない）
  //   ★ 記入欄の札・指示文・書き込まれた中身が1つでもある行は、行ごと題にしない。
  //     「連絡責任者｜山田 太郎｜090-…」の行から、人の名前を表の名前として出さないため
  //   戻り値: 文字（無ければ ''）
  function titleOf(grid, merges, tb, tables) {
    // ★ 名前の列の見出しのすぐ上に書いてある語（tb.label。スポレクの「連絡責任者」）を先に使う。
    //   その表のための札なので、いちばん確か。記入欄の札の語（〜者）でも、ここでは題として使う
    //   （横に中身が並ぶ行ではなく、表の真上に1つだけ書いてあるため）
    if (tb.label) {
      var lb = clean(tb.label).replace(/\s+/g, '');
      if (lb && !INSTRUCT_RE.test(lb) && !DATA_RE.test(lb)) return clean(tb.label);
    }
    var at = textIndex(grid, merges);
    var sp = spanOf(at, tb);
    var others = (tables || []).filter(function (x) { return x !== tb; });
    for (var up = 1; up <= TITLE_UP; up++) {
      var r = sp.hr - up;
      if (r < 1) break;
      var inOther = others.some(function (x) {
        return r >= (x.headerRow || x.firstRow) && r <= x.lastRow;
      });
      if (inOther) break;
      var seen = {}, got = [], fieldRow = false;
      for (var c = sp.lo; c <= sp.hi; c++) {
        var cell = at(r, c);
        if (!cell.text || seen[cell.key]) continue;
        seen[cell.key] = true;
        var t = clean(cell.text);
        var bare = t.replace(/\s+/g, '');
        if (!bare || /^\d+$/.test(bare)) continue;
        if (INSTRUCT_RE.test(bare) || FIELD_RE.test(bare) || DATA_RE.test(bare)) { fieldRow = true; continue; }
        if (bare.length > TITLE_MAX) continue;
        if (got.indexOf(t) < 0) got.push(t);   // 左右の表の上に同じ題が2つあることがある
      }
      if (fieldRow) continue;
      if (got.length > TITLE_PARTS) continue;
      var joined = got.join('／');
      if (joined && joined.length <= TITLE_JOINED) return joined;
    }
    return '';
  }

  // 題が無いときの手がかり。表の見出し（氏名・フリガナ・生年月日…）を4つまで
  function headersOf(grid, merges, tb) {
    var at = textIndex(grid, merges);
    var sp = spanOf(at, tb);
    if (!tb.headerRow) return '';
    var seen = {}, out = [];
    for (var c = sp.lo; c <= sp.hi && out.length < 4; c++) {
      var cell = at(sp.hr, c);
      if (!cell.text || seen[cell.key]) continue;
      seen[cell.key] = true;
      out.push(clean(cell.text).replace(/\s+/g, ''));
    }
    return out.join('・');
  }

  // いま入れている表の番号。開いている表があればそれ、無ければ最初のまだ空きのある表。
  // ぜんぶ埋まっていれば -1
  function activeTable(tables, picks, open) {
    if (typeof open === 'number' && open >= 0 && open < (tables || []).length) return open;
    for (var i = 0; i < (tables || []).length; i++) {
      if (((picks && picks[i]) || []).length < tables[i].rows.length) return i;
    }
    return -1;
  }

  // ★ シートの表がぜんぶ埋まったか（2026-09-24、本人の要望。埋まったら次のシートへ移る）。
  //   2枚目を足す表（more）は、いくらでも入るので「埋まった」にならない。表の無いシートも埋まらない
  function sheetDone(tables, picks, more) {
    if (!tables || !tables.length) return false;
    return tables.every(function (tb, ti) {
      if (more && more[ti]) return false;
      return ((picks && picks[ti]) || []).length >= tb.rows.length;
    });
  }

  global.EntryView = { frame: frame, focusOf: focusOf, marks: marks, point: point, pointMarks: pointMarks,
    titleOf: titleOf, headersOf: headersOf, activeTable: activeTable, sheetDone: sheetDone,
    colPx: colPx, rowPx: rowPx, letter: letter, MAX_ROWS: MAX_ROWS, MAX_COLS: MAX_COLS, ABOVE: ABOVE };
})(typeof window !== 'undefined' ? window : this);
