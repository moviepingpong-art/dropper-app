// entry-make.js — 様式が無いとき、選んだ項目で「空の申込書」を作る
//
// ★ 2026-09-26、本人の要望。事務局の様式が無い（自由書式の）申込もある。そのときは
//   項目を選んで空の申込書をここで作り、**いままでの「空の申込書」の道（③人を選ぶ ④確認 ⑤保存）に流す**。
//   書き込みは作った Excel に対して今までどおり行うので、見出しの規則・④の確かめ・書式の守りがそのまま効く。
//
// 形:
//   1行目     題（本人が打つ。空なら「申込書」）。★ 結合しない（下の注意）
//   2行目     年齢の基準日（入れたときだけ。「※年齢は 2027年4月1日 現在」）。入れなければ空ける
//   3行目     見出し。A 列「No.」、B 列「氏名」、C 列から選んだ項目
//   4行目〜   記入行。罫線つきの空のセルを全部の列に置く（entry-blank.js が「書ける行」を数えるのに要る）
//
// ★ 見出しの語は entry-rules.js が必ず読める語にする（ITEMS の label）。言い換えると見落としになる。
// ★ 題は見出しから1行離し、結合もしない。entry-blank.js は見出しのすぐ上の短い文字を表の名前に採り、
//   entry-rules.js は見出しの上（最大4行）を読む。題が見出しの語と読まれないように、
//   題は A 列（No. の上）にだけ置く。No. の列は数字だけなので、欄の種類は決まらない。
// ★ 「大会」とは限らない（教室・発表会・講習会もある）。題はこちらで作らず、本人が打ったとおりに書く。
// ★ 基準日は entry-rules.js が「〜現在」と日付を含む文から読む（④で聞かれなくなる。印刷した紙にも残る）。
//   先頭の「※」は、entry-view.js の titleOf がこの行を表の名前にしないための目印（INSTRUCT_RE）。外さないこと。
//   A 列に置くのは題と同じ理由（A 列は見出しの「No.」が近いので、欄の種類に読まれない）
//
// window.EntryMake = { ITEMS, make, fileName } を公開する。
(function (global) {
  'use strict';

  var SHEET = '申込書';
  // ★ entry-blank.js は見出しの下を LOOK_DOWN（60行）までしか数えない。それより多く作ると、
  //   61行目から先が「書ける行」にならない（2026-09-26、試験で踏んだ）。多い人数は「2枚目を足す」で書く
  var MAX_ROWS = 60;
  var DEFAULT_ROWS = 20;

  // 名簿から埋められる項目。label は entry-rules.js が読む見出しの語（言い換えないこと）
  var ITEMS = [
    { key: 'kana', label: 'フリガナ', width: 18 },
    { key: 'gender', label: '性別', width: 6 },
    { key: 'birth', label: '生年月日', width: 14 },
    { key: 'age', label: '年齢', width: 6 },
    { key: 'postal', label: '郵便番号', width: 10 },
    { key: 'address', label: '住所', width: 40 },
    { key: 'phone', label: '電話番号', width: 15 }
  ];
  var OTHER_WIDTH = 14;

  // ZIP に書く日時は固定にする（entry-book.js と同じ理由）
  var DOS_DATE = ((2026 - 1980) << 9) | (9 << 5) | 26;

  function plain(s) { return s == null ? '' : String(s).trim(); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }
  function colName(n) {
    var s = '';
    while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
    return s;
  }

  function fileName(title) {
    var name = plain(title).replace(/[\\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
    return name ? name + '.xlsx' : '申込書.xlsx';
  }

  // 書式: 0 ふつう / 1 題（太字・大きめ）/ 2 見出し（太字・地色・罫線・中央）/ 3 記入欄（罫線）/ 4 No.（罫線・中央）
  // ★ 記入欄は「文字」の書式にしない。年齢は数として書くので、文字の書式だと Excel が緑の三角を出す
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="3"><font><sz val="11"/><name val="ＭＳ Ｐゴシック"/><family val="2"/><charset val="128"/></font>' +
    '<font><b/><sz val="14"/><name val="ＭＳ Ｐゴシック"/><family val="2"/><charset val="128"/></font>' +
    '<font><b/><sz val="11"/><name val="ＭＳ Ｐゴシック"/><family val="2"/><charset val="128"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right>' +
    '<top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="5">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
    '<alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">' +
    '<alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">' +
    '<alignment horizontal="center" vertical="center"/></xf>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="標準" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  function textCell(ref, s, v) {
    return '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
  }

  // 列の並びを決める。items は ITEMS の key、extras は名簿に足した項目の見出し、others は本人が足した項目。
  // 同じ見出しが2度出たら1つにする（名簿の項目と、打ち込んだ項目が同じ語のとき）
  function columnsOf(opts) {
    var cols = [{ label: 'No.', width: 5 }, { label: '氏名', width: 16 }];
    var seen = { 'No.': true, '氏名': true };
    function add(label, width) {
      label = plain(label);
      if (!label || seen[label]) return;
      seen[label] = true;
      cols.push({ label: label, width: width });
    }
    var want = {};
    (opts.items || []).forEach(function (k) { want[k] = true; });
    ITEMS.forEach(function (it) { if (want[it.key]) add(it.label, it.width); });
    (opts.extras || []).forEach(function (l) { add(l, OTHER_WIDTH); });
    (opts.others || []).forEach(function (l) { add(l, OTHER_WIDTH); });
    return cols;
  }

  // 基準日の文。{ y, m, d } → '※年齢は 2027年4月1日 現在'（無ければ ''）
  function baseDateText(b) {
    if (!b || !(b.y >= 1900) || !(b.m >= 1 && b.m <= 12) || !(b.d >= 1 && b.d <= 31)) return '';
    return '※年齢は ' + b.y + '年' + b.m + '月' + b.d + '日 現在';
  }

  function sheetXml(title, cols, rows, baseDate) {
    var last = colName(cols.length);
    var body = '<row r="1" ht="24" customHeight="1">' + textCell('A1', 1, plain(title) || '申込書') + '</row>';
    var base = baseDateText(baseDate);
    if (base) body += '<row r="2">' + textCell('A2', 0, base) + '</row>';
    body += '<row r="3" ht="20" customHeight="1">' + cols.map(function (c, k) {
      return textCell(colName(k + 1) + '3', 2, c.label);
    }).join('') + '</row>';
    for (var i = 1; i <= rows; i++) {
      var r = i + 3;
      body += '<row r="' + r + '" ht="20" customHeight="1">' +
        '<c r="A' + r + '" s="4"><v>' + i + '</v></c>' +
        cols.slice(1).map(function (c, k) { return '<c r="' + colName(k + 2) + r + '" s="3"/>'; }).join('') +
        '</row>';
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
      '<dimension ref="A1:' + last + (rows + 3) + '"/>' +
      '<cols>' + cols.map(function (c, k) {
        return '<col min="' + (k + 1) + '" max="' + (k + 1) + '" width="' + c.width + '" customWidth="1"/>';
      }).join('') + '</cols>' +
      '<sheetData>' + body + '</sheetData>' +
      '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
      // ★ 横に長くなるので、横向き・横幅を1ページに収める（縦は何ページでもよい）
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
      '</worksheet>';
  }

  // opts: { title, items: ['kana', 'birth', …], extras: ['所属'], others: ['種目'], rows: 20, baseDate: { y, m, d } }
  // → Promise<Uint8Array>
  function make(opts) {
    var X = global.EntryXlsx;
    opts = opts || {};
    var rows = Math.floor(Number(opts.rows));
    if (!(rows >= 1)) rows = DEFAULT_ROWS;
    if (rows > MAX_ROWS) rows = MAX_ROWS;
    var cols = columnsOf(opts);

    var parts = {};
    parts['[Content_Types].xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';
    parts['_rels/.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';
    parts['xl/workbook.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + SHEET + '" sheetId="1" r:id="rId1"/></sheets>' +
      // 印刷のたびに見出しが出るように（2ページ目以降も何の列か分かる）
      '<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">' + SHEET + '!$3:$3</definedName></definedNames>' +
      '</workbook>';
    parts['xl/_rels/workbook.xml.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';
    parts['xl/styles.xml'] = STYLES;
    parts['xl/worksheets/sheet1.xml'] = sheetXml(opts.title, cols, rows, opts.baseDate);

    var enc = new TextEncoder();
    var names = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
      'xl/styles.xml', 'xl/worksheets/sheet1.xml'];
    return Promise.all(names.map(function (name) {
      var bytes = enc.encode(parts[name]);
      return X.zip.deflate(bytes).then(function (raw) {
        return { nameBytes: enc.encode(name), name: name, versionMade: 20, versionNeeded: 20, flags: 0x0800,
                 method: 8, time: 0, date: DOS_DATE, crc: X.zip.crc32(bytes), usize: bytes.length,
                 raw: raw, internalAttr: 0, externalAttr: 0 };
      });
    })).then(function (entries) { return X.zip.write(entries); });
  }

  global.EntryMake = { ITEMS: ITEMS, SHEET: SHEET, MAX_ROWS: MAX_ROWS, DEFAULT_ROWS: DEFAULT_ROWS,
    make: make, fileName: fileName, columnsOf: columnsOf, baseDateText: baseDateText };
})(window);
