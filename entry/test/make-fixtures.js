// 申込書ドロッパーの試験用データを作る。
//
//   node entry/test/make-fixtures.js
//
// ★ ここに出てくる人・団体・住所・電話番号はすべて架空。本物の名簿は絶対に置かないこと（public リポジトリ）。
// ★ 本物の大会の様式も置かない（主催者の文書のため）。本物で試すときは entry/test/local/ に置く（.gitignore 済み）。
//
// 作るもの（fixtures/）:
//   roster.xlsx              … 架空の名簿。★ ツールが作る形（entry-book.js）で作る。
//                              表記ゆれ・同姓同名・空欄などの罠を仕込んである
//   form-a-all-fields.xlsx   … 全項目型。1人1行。セルが無いところへ書き込む道を通す
//   form-b-pairs.xlsx        … 百万石型。2人1組・結合セル・年月日の3欄。罫線つきの空セルを置き換える道を通す
//   form-c-split.xlsx        … 分割型。姓と名が別欄・男女の列に○・都道府県が別欄・式のセル
//   form-d-blank.xlsx        … ★ 空の様式（名前が1つも書かれていない）。監督の行つきの表が2つ。
//                              空の申込書から表を見つける道（entry-blank.js）を試す
// 様式にはすでに「幹事が名前だけ書いた」状態で名前が入っている。
var fs = require('fs');
var path = require('path');

global.window = global;
eval(fs.readFileSync(path.join(__dirname, '..', 'entry-xlsx.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'entry-roster.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'entry-book.js'), 'utf8'));
var X = window.EntryXlsx, B = window.EntryBook;

var OUT = path.join(__dirname, 'fixtures');

// ===== 架空の名簿（ツールが作る形） =====
// [姓, 名, セイ, メイ, 生年月日（[y,m,d] か、人が Excel で直したときの文字）, 郵便番号, 都道府県, 住所, 電話]
var PEOPLE = {
  男子: [
    ['山田', '太郎', 'ヤマダ', 'タロウ', [1950, 4, 1], '920-0001', '石川県', '金沢市テスト町1-1', '076-000-0001'],
    ['髙橋', '一郎', 'タカハシ', 'イチロウ', [1948, 12, 25], '924-0001', '石川県', '白山市サンプル1-3', '090-0000-0003'],
    ['佐藤', '次郎', 'サトウ', 'ジロウ', [1955, 1, 1], '', '石川県', '野々市市テスト3-3', '076-000-0004'],   // 同姓同名その1
    ['佐藤', '次郎', 'サトウ', 'ジロウ', [1960, 7, 7], '', '石川県', '能美市テスト4-4', '076-000-0005'],     // 同姓同名その2
    ['田中', '誠', 'タナカ', 'マコト', [1945, 3, 3], '', '福井県', '福井市サンプル7-7', '0776-00-0008'],
    ['渡辺', '明', 'ワタナベ', 'アキラ', '平成元年1月8日', '', '石川県', '加賀市テスト9-9', '090-0000-0010'], // 人が文字で直した生年月日
    ['加藤', '健', 'カトウ', 'ケン', [1952, 6, 6], '', '東京都', '千代田区テスト11', '03-0000-0012'],
    ['斉藤', '光', '', '', [1962, 2, 2], '', '', 'テスト市13', '']                                            // フリガナ・都道府県・電話が空
  ],
  女子: [
    ['山田', '花子', 'ヤマダ', 'ハナコ', [1952, 5, 10], '', '石川県', '白山市テスト町2-2', '090-0000-0002'],
    ['中﨑', '良子', 'ナカサキ', 'リョウコ', [1955, 2, 28], '', '富山県', '高岡市サンプル5-5', '0766-00-0006'],
    ['鈴木', '和子', 'スズキ', 'カズコ', '', '', '石川県', '小松市テスト6-6', '0761-00-0007'],                // 生年月日が空
    ['伊藤', '美穂', 'イトウ', 'ミホ', [1958, 8, 15], '921-0009', '石川県', '金沢市テスト8-8', '076-000-0009'],
    ['小林', 'さくら', 'コバヤシ', 'サクラ', [1960, 3, 3], '', '石川県', '白山市サンプル10', '080-0000-0011'],
    ['吉田', '恵', 'ヨシダ', 'メグミ', [1956, 9, 9], '', '大阪府', '大阪市テスト12', '06-0000-0013']
  ]
};

function rosterBook() {
  var people = {};
  Object.keys(PEOPLE).forEach(function (g) {
    people[g] = PEOPLE[g].map(function (m) {
      return { family: m[0], given: m[1], kanaFamily: m[2], kanaGiven: m[3],
        birth: Array.isArray(m[4]) ? { y: m[4][0], m: m[4][1], d: m[4][2] } : null,
        birthText: Array.isArray(m[4]) ? '' : m[4],
        postal: m[5], pref: m[6], address: m[7], phone: m[8], extras: [] };
    });
  });
  return B.make({ org: '白山テストクラブ（架空）', today: '2026-09-16', people: people, extraHeaders: {} });
}

function serial(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); }

// ===== 最小の xlsx を組み立てる =====
// s: 0 標準 / 1 罫線 / 2 見出し（色・中央・罫線）/ 3 日付＋罫線 / 4 表題（太字14pt）
//    5 罫線＋斜線（★「ここは書かなくてよい」を斜線で示す欄。百万石の監督の行がこれだった）
var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="176" formatCode="yyyy/m/d"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="游ゴシック"/><family val="3"/><charset val="128"/></font>' +
  '<font><b/><sz val="14"/><name val="游ゴシック"/><family val="3"/><charset val="128"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right>' +
  '<top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>' +
  '<border diagonalUp="1" diagonalDown="1"><left style="thin"><color auto="1"/></left>' +
  '<right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top>' +
  '<bottom style="thin"><color auto="1"/></bottom>' +
  '<diagonal style="thin"><color auto="1"/></diagonal></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '<xf numFmtId="176" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="標準" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// sheets: [{ name, cols: [幅...], cells: { A1: { v, s, f } }, merges: ['A1:C1'] }]
function buildXlsx(sheets) {
  var sst = [], sstIndex = {};
  function si(t) { if (!(t in sstIndex)) { sstIndex[t] = sst.length; sst.push(t); } return sstIndex[t]; }

  var parts = {};
  parts['[Content_Types].xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets.map(function (s, i) {
      return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '</Types>';
  parts['_rels/.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  parts['xl/workbook.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' + sheets.map(function (s, i) {
      return '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
    }).join('') + '</sheets>' +
    // ★ 印刷範囲は localSheetId＝並び順の番号で紐づく。シートを途中に挿すと後ろがずれる。
    //   本物の百万石で踏んだ罠なので、見本にも仕込んでどこでも試せるようにする（2026-09-20）
    (sheets.some(function (s) { return s.printArea; })
      ? '<definedNames>' + sheets.map(function (s, i) {
        return s.printArea
          ? '<definedName name="_xlnm.Print_Area" localSheetId="' + i + '">' +
            "'" + s.name.replace(/'/g, "''") + "'!" + s.printArea + '</definedName>'
          : '';
      }).join('') + '</definedNames>'
      : '') +
    '</workbook>';
  var n = sheets.length;
  parts['xl/_rels/workbook.xml.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map(function (s, i) {
      return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
    }).join('') +
    '<Relationship Id="rId' + (n + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId' + (n + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
    '</Relationships>';
  parts['xl/styles.xml'] = STYLES;

  sheets.forEach(function (s, i) {
    var byRow = {};
    Object.keys(s.cells).forEach(function (ref) {
      var p = X.parseRef(ref);
      (byRow[p.row] = byRow[p.row] || []).push({ ref: ref, col: p.col, c: s.cells[ref] });
    });
    var rows = Object.keys(byRow).map(Number).sort(function (a, b) { return a - b; }).map(function (r) {
      return '<row r="' + r + '">' + byRow[r].sort(function (a, b) { return a.col - b.col; }).map(function (x) {
        var c = x.c, head = '<c r="' + x.ref + '"' + (c.s ? ' s="' + c.s + '"' : '');
        if (c.f) return head + '><f>' + esc(c.f) + '</f><v>0</v></c>';
        if (c.v === undefined || c.v === '') return head + '/>';
        if (typeof c.v === 'number') return head + '><v>' + c.v + '</v></c>';
        return head + ' t="s"><v>' + si(c.v) + '</v></c>';
      }).join('') + '</row>';
    }).join('');
    parts['xl/worksheets/sheet' + (i + 1) + '.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      (s.cols ? '<cols>' + s.cols.map(function (w, k) {
        return '<col min="' + (k + 1) + '" max="' + (k + 1) + '" width="' + w + '" customWidth="1"/>';
      }).join('') + '</cols>' : '') +
      '<sheetData>' + rows + '</sheetData>' +
      (s.merges && s.merges.length ? '<mergeCells count="' + s.merges.length + '">' +
        s.merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>' : '') +
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
  });
  parts['xl/sharedStrings.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + sst.length + '" uniqueCount="' + sst.length + '">' +
    sst.map(function (t) { return '<si><t xml:space="preserve">' + esc(t) + '</t></si>'; }).join('') + '</sst>';

  // 日時は固定（作り直しても同じバイト列になるように）。2026-09-15 00:00
  var dosDate = ((2026 - 1980) << 9) | (9 << 5) | 15;
  var enc = new TextEncoder();
  var names = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml']
    .concat(sheets.map(function (s, i) { return 'xl/worksheets/sheet' + (i + 1) + '.xml'; }), ['xl/sharedStrings.xml']);
  return Promise.all(names.map(function (name) {
    var data = enc.encode(parts[name]);
    return X.zip.deflate(data).then(function (raw) {
      return { nameBytes: enc.encode(name), name: name, versionMade: 20, versionNeeded: 20, flags: 0x0800, method: 8,
               time: 0, date: dosDate, crc: X.zip.crc32(data), usize: data.length, raw: raw, internalAttr: 0, externalAttr: 0 };
    });
  })).then(function (entries) { return X.zip.write(entries); });
}

// 範囲の全セルを、罫線つきの空セルとして置く（事務局の様式によくある形）
function box(cells, from, to, s) {
  var a = X.parseRef(from), b = X.parseRef(to);
  for (var r = a.row; r <= b.row; r++) for (var c = a.col; c <= b.col; c++) {
    var ref = X.toRef(c, r);
    if (!cells[ref]) cells[ref] = { s: s || 1 };
  }
}

// ===== 様式A 全項目型 =====
function formA() {
  var cells = {
    A1: { v: 'テスト大会 参加申込書（試験用の架空の様式）', s: 4 },
    A2: { v: '年齢は2027年4月1日現在で記入してください' },
    A4: { v: '団体名', s: 2 }, B4: { s: 1 }, C4: { s: 1 }, D4: { s: 1 },
    A6: { v: 'No', s: 2 }, B6: { v: '氏名', s: 2 }, C6: { v: 'フリガナ', s: 2 }, D6: { v: '性別', s: 2 },
    // 記入例は名簿に無い日付にする（run.js の「名簿の生年月日が載っていない」確認に引っかからないように）
    E6: { v: '生年月日（例：1965/1/23）', s: 2 }, F6: { v: '年齢', s: 2 }, G6: { v: '郵便番号', s: 2 }, H6: { v: '住所', s: 2 },
    I6: { v: '電話番号', s: 2 }
  };
  // 幹事が書いた名前（わざと崩してある）
  var typed = ['山田太郎', '高橋 一郎', '中崎良子', '佐藤次郎', '伊藤美穗', '鈴木 和子'];
  typed.forEach(function (t, i) {
    cells['A' + (7 + i)] = { v: i + 1, s: 1 };
    cells['B' + (7 + i)] = { v: t, s: 1 };
    // C〜I 列はセルを置かない（セルが無いところへ書き込む道を試す）
  });
  return { name: '申込書', cols: [5, 14, 16, 6, 12, 6, 10, 36, 15], cells: cells, merges: ['B4:D4'] };
}

// ===== 様式B 百万石型（2人1組） =====
function formB() {
  var cells = {
    B1: { v: '第〇回 テストオープン卓球大会（ラージ）参加申込書（試験用の架空の様式）', s: 4 },
    B4: { v: '【種目】混合ダブルス個人戦' },
    C5: { v: '合計年齢（① 119歳以下 ・ ② 120～134歳 ・ ③ 135～149歳 ・ ④ 150歳以上）' },
    C8: { v: '都道府県名', s: 2 }, E8: { s: 1 }, C9: { v: 'チーム名', s: 2 }, E9: { s: 1 },
    B12: { v: 'No', s: 2 }, C12: { v: '氏　　　名', s: 2 }, F12: { v: '性別', s: 2 }, G12: { v: '生　年　月　日', s: 2 },
    G13: { v: '元号', s: 2 }, H13: { v: '年', s: 2 }, I13: { v: '月', s: 2 }, J13: { v: '日', s: 2 },
    K12: { v: '年齢', s: 2 }, L12: { v: '合計', s: 2 }, L13: { v: '年齢', s: 2 }, M12: { v: '参加', s: 2 }, M13: { v: '種目', s: 2 },
    B22: { v: '（年齢は、令和９年４月１日現在をご記入下さい）' }
  };
  box(cells, 'B12', 'M13', 2);
  var merges = ['B1:M1', 'C8:D8', 'E8:J8', 'C9:D9', 'E9:J9', 'B12:B13', 'C12:E13', 'F12:F13', 'G12:J12', 'K12:K13'];
  for (var p = 0; p < 4; p++) {
    var r = 14 + p * 2;
    cells['B' + r] = { v: p + 1, s: 1 };
    merges.push('B' + r + ':B' + (r + 1), 'L' + r + ':L' + (r + 1), 'M' + r + ':M' + (r + 1),
                'C' + r + ':E' + r, 'C' + (r + 1) + ':E' + (r + 1));
  }
  var typed = { C14: '山田 太郎', C15: '山田花子', C16: '伊藤美穂', C17: '田中　誠', C18: '渡辺明', C19: '吉田恵' };
  Object.keys(typed).forEach(function (ref) { cells[ref] = { v: typed[ref], s: 1 }; });
  box(cells, 'B14', 'M21', 1);   // 残りは罫線つきの空セル（置き換える道を試す）
  return { name: '個人戦', cols: [2, 5, 10, 4, 4, 6, 6, 5, 4, 4, 6, 7, 7], cells: cells, merges: merges };
}

// ===== 様式C 分割型 =====
function formC() {
  var cells = {
    A1: { v: 'テスト交流大会 申込書（試験用の架空の様式）', s: 4 },
    A2: { v: '年齢は2027年4月1日現在' },
    A5: { v: 'No', s: 2 }, B5: { v: '姓', s: 2 }, C5: { v: '名', s: 2 }, D5: { v: '男', s: 2 }, E5: { v: '女', s: 2 },
    F5: { v: '生年月日（例：1965年1月23日）', s: 2 }, G5: { v: '年齢', s: 2 }, H5: { v: '都道府県', s: 2 }, I5: { v: '住所', s: 2 },
    J5: { v: '電話', s: 2 },
    F10: { v: '年齢合計', s: 2 }, G10: { f: 'SUM(G6:G9)', s: 1 }
  };
  var typed = [['小林', 'さくら'], ['加藤', '健'], ['吉田', '恵'], ['加藤', '健']];   // 4行目は同じ人の重複
  typed.forEach(function (t, i) {
    var r = 6 + i;
    cells['A' + r] = { v: i + 1, s: 1 };
    cells['B' + r] = { v: t[0], s: 1 };
    cells['C' + r] = { v: t[1], s: 1 };
  });
  box(cells, 'A6', 'J9', 1);
  // ★ 年齢の欄のうち1つだけ、日付の書式（s:3）にしておく。本物のスポレク参加申込書がこうなっていて、
  //   年齢の 60 を書いたら Excel が「1900-02-29」と表示した（2026-09-18、本人が発見）
  cells['G7'] = { s: 3 };
  return { name: '申込書', cols: [5, 8, 8, 4, 4, 16, 6, 10, 30, 15], cells: cells, merges: [] };
}

// ===== 様式D 空の様式（名前が1つも書かれていない） =====
// ★ 空の申込書から「名前を書く表」を見つける道（entry-blank.js）を試すためのもの。
//   かほく市長杯の様式と同じ形（監督の行つきの表が2つ、見出しに空白入りの「氏　名」）。
//   人・団体・大会名は架空。
function formD() {
  var cells = { A1: { v: '第1回 テスト市長杯ラージボール大会参加申込書（試験用の架空の様式）', s: 4 } };
  [3, 13].forEach(function (top) {
    cells['A' + top] = { v: 'チーム名', s: 2 };
    cells['B' + top] = { s: 1 };
    cells['D' + top] = { v: '部門', s: 2 };
    cells['E' + top] = { v: '男 子', s: 1 };
    cells['F' + top] = { v: '女 子', s: 1 };
    var head = top + 1;
    cells['A' + head] = { v: 'No', s: 2 };
    cells['B' + head] = { v: '氏　名', s: 2 };      // ★ 見出しに空白が入っている
    cells['C' + head] = { v: '性別', s: 2 };
    cells['D' + head] = { v: '生年月日', s: 2 };
    cells['E' + head] = { v: '年齢', s: 2 };
    cells['F' + head] = { v: '現　住　所', s: 2 };
    cells['A' + (head + 1)] = { v: '監督', s: 1 };   // ★ 行の名札（名前の列より左）
    for (var i = 1; i <= 6; i++) cells['A' + (head + 1 + i)] = { v: i, s: 1 };
    box(cells, 'B' + (head + 1), 'F' + (head + 7), 1);
    // ★ 監督の行の生年月日・年齢には斜線が引いてある（書かなくてよい、の意味。本物の百万石と同じ）
    cells['D' + (head + 1)] = { s: 5 };
    cells['E' + (head + 1)] = { s: 5 };
  });
  cells['A23'] = { v: '※年齢の基準は、令和9年4月1日とする。監督と選手を兼ねる場合は、両方に記入してください。' };
  cells['A24'] = { v: '大会長　架空　太郎　殿' };
  return { name: '参加申込書', cols: [6, 18, 6, 14, 6, 34], cells: cells, merges: [] };
}

// ★ 2シート＋印刷範囲つきの様式（2026-09-20）。2枚目のシートを足す道で使う。
//   印刷範囲は localSheetId＝並び順の番号で紐づくので、**途中に挿すと後ろがずれる**。
//   本物の百万石でしか出ない罠だったので、見本にも同じ形を入れて、どこでも試せるようにした。
//   名前に空白を入れてあるのは、印刷範囲に書くとき ' で囲む必要があるため（本物に「V & C」があった）。
function formE(which) {
  var cells = { A1: { v: '第1回 架空カップ 参加申込書（' + which + '）', s: 4 } };
  cells['A3'] = { v: 'チーム名', s: 2 };
  cells['B3'] = { s: 1 };
  cells['A4'] = { v: 'No', s: 2 };
  cells['B4'] = { v: '氏名', s: 2 };
  cells['C4'] = { v: '生年月日', s: 2 };
  cells['D4'] = { v: '年齢', s: 2 };
  for (var i = 1; i <= 4; i++) cells['A' + (4 + i)] = { v: i, s: 1 };   // 4人しか書けない＝あふれる
  box(cells, 'B5', 'D8', 1);
  return {
    name: '申込書 ' + which, cols: [6, 18, 14, 6], cells: cells, merges: [],
    printArea: '$A$1:$D$8'
  };
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
Promise.all([
  rosterBook().then(function (b) { fs.writeFileSync(path.join(OUT, 'roster.xlsx'), Buffer.from(b)); }),
  buildXlsx([formA()]).then(function (b) { fs.writeFileSync(path.join(OUT, 'form-a-all-fields.xlsx'), b); }),
  buildXlsx([formB()]).then(function (b) { fs.writeFileSync(path.join(OUT, 'form-b-pairs.xlsx'), b); }),
  buildXlsx([formC()]).then(function (b) { fs.writeFileSync(path.join(OUT, 'form-c-split.xlsx'), b); }),
  buildXlsx([formD()]).then(function (b) { fs.writeFileSync(path.join(OUT, 'form-d-blank.xlsx'), b); }),
  buildXlsx([formE('A'), formE('B')]).then(function (b) { fs.writeFileSync(path.join(OUT, 'form-e-two-sheets.xlsx'), b); })
]).then(function () {
  console.log('fixtures を作りました: ' + fs.readdirSync(OUT).join(', '));
}).catch(function (e) { console.error(e); process.exit(1); });
