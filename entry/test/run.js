// 申込書ドロッパーの中核（entry-xlsx.js / entry-roster.js）を Node で確かめる。
//
//   node entry/test/make-fixtures.js     … 試験用データを作り直す（fixtures/）
//   node entry/test/run.js               … 確かめる。落ちたら終了コード 1
//   powershell -File entry/test/excel-check.ps1   … 書き出したファイルを本物の Excel で開いて確かめる
//
// 確かめること:
//   1. 名簿の読み取り（列の推測・生年月日の書き方の混在・電話の先頭の0・空欄）
//   2. 様式ごとに「名前を探す → 伏せ字 → 書き込む → 読み直す」
//   3. ★ 書き換えたセル以外が1バイトも変わっていないこと（書式を壊していない証拠）
//   4. ★ 伏せ字にした内容に、名簿の名前が1つも残っていないこと（AI に名前を送らない証拠）
//   5. entry/test/local/ に本物の様式があれば、それでも 2〜3 を流す（無ければ飛ばす）
var fs = require('fs');
var path = require('path');

global.window = global;
eval(fs.readFileSync(path.join(__dirname, '..', 'entry-xlsx.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'entry-roster.js'), 'utf8'));
var X = window.EntryXlsx, R = window.EntryRoster;

var FIX = path.join(__dirname, 'fixtures');
var OUT = path.join(__dirname, 'out');
var LOCAL = path.join(__dirname, 'local');
var BASE = { y: 2027, m: 4, d: 1 };   // 令和9年4月1日現在

var ng = 0;
function ok(m) { console.log('  OK   ' + m); }
function bad(m) { ng++; console.log('  NG   ' + m); }
function check(cond, m) { if (cond) ok(m); else bad(m); }
function eq(actual, expected, m) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) ok(m); else bad(m + '\n         期待: ' + e + '\n         実際: ' + a);
}
function section(t) { console.log('\n' + t); }
function read(p) { return X.open(fs.readFileSync(p)); }

var expectForExcel = [];

// ===== 伏せ字の確認 =====
function assertMasked(masked, roster, typedTexts, label) {
  var leaks = [];
  var keys = [];
  roster.members.forEach(function (m) {
    keys.push(m.key, m.fold);
    if (m.family && Array.from(m.family).length >= 2) keys.push(R.nameKey(m.family), R.foldKey(m.family));
    if (m.given && Array.from(m.given).length >= 2) keys.push(R.nameKey(m.given));
  });
  typedTexts.forEach(function (t) { keys.push(R.nameKey(t)); });
  masked.forEach(function (c) {
    var k = R.nameKey(c.text), f = R.foldKey(c.text);
    keys.forEach(function (key) { if (key && (k.indexOf(key) >= 0 || f.indexOf(key) >= 0)) leaks.push(c.ref + '=' + c.text); });
  });
  check(leaks.length === 0, label + ': 伏せ字の後に名前が残っていない' + (leaks.length ? ' → ' + leaks.join(', ') : ''));
}

// ===== 書き換えたセル以外が変わっていないか =====
function stripCells(xml, refs) {
  refs.forEach(function (ref) {
    xml = xml.replace(new RegExp('<c\\b(?=[^>]*\\sr="' + ref + '")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)'), '');
  });
  return xml.replace(/<row\b([^>]*?)\/>/g, '<row$1></row>').replace(/<row r="\d+"><\/row>/g, '');
}
function assertPreserved(before, after, writtenBySheet, label) {
  var names = function (b) { return b.entries.map(function (e) { return e.name; }).join('|'); };
  eq(names(after), names(before), label + ': ZIP の中の部品が同じ並び');
  var changed = [];
  before.entries.forEach(function (e) {
    var a = after.byName[e.name];
    var sheet = before.sheets.filter(function (s) { return s.path === e.name; })[0];
    if (sheet && writtenBySheet[sheet.name]) {
      var refs = writtenBySheet[sheet.name];
      if (stripCells(before.parts[e.name], refs) !== stripCells(after.parts[e.name], refs)) changed.push(e.name + '（書いたセル以外）');
      return;
    }
    if (e.name === 'xl/workbook.xml') {
      var norm = function (x) { return x.replace(/<calcPr fullCalcOnLoad="1"\/>/, '').replace(/<calcPr fullCalcOnLoad="1"/, '<calcPr'); };
      if (norm(before.parts[e.name]) !== norm(after.parts[e.name])) changed.push(e.name);
      return;
    }
    if (Buffer.compare(Buffer.from(e.raw), Buffer.from(a.raw)) !== 0) changed.push(e.name);
  });
  check(changed.length === 0, label + ': 書き換えたセル以外は変わっていない' + (changed.length ? ' → ' + changed.join(', ') : ''));
}

// 行が上から、セルが左から並び、同じ番地が2つ無いこと。
// どちらかが崩れると Excel は開けない（2026-09-15 に壊したファイルで確認）。
// excel-check.ps1 でも見抜けるが、Excel の無い環境でも確かめられるようにここでも見る
function assertOrdered(book, label) {
  var bad = [];
  book.sheets.forEach(function (s) {
    var lastRow = 0;
    s.xmlRows = (book.parts[s.path].match(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) || []);
    s.xmlRows.forEach(function (rowXml) {
      var r = Number(/\sr="(\d+)"/.exec(rowXml)[1]);
      if (r <= lastRow) bad.push(s.name + ' 行' + r);
      lastRow = r;
      var lastCol = 0;
      (rowXml.match(/<c\b[^>]*?\sr="[A-Z]+\d+"/g) || []).forEach(function (c) {
        var p = X.parseRef(/\sr="([A-Z]+\d+)"/.exec(c)[1]);
        if (p.row !== r || p.col <= lastCol) bad.push(s.name + ' ' + X.toRef(p.col, p.row));
        lastCol = p.col;
      });
    });
    delete s.xmlRows;
  });
  check(bad.length === 0, label + ': 行とセルが順に並び、同じ番地が2つ無い' + (bad.length ? ' → ' + bad.join(', ') : ''));
}

function valueMap(book, sheet) {
  var o = {};
  X.cells(book, sheet).forEach(function (c) { o[c.ref] = c.value != null ? c.value : c.text; });
  return o;
}

// 名前が確定したあとの1枚ぶん: fill → setCell → save → 読み直し → 確認
function writeForm(label, file, book, sheet, roster, assignments, slots, groups, outName, expected) {
  var written = [], problems = [], ages = {};
  assignments.forEach(function (member, i) {
    if (!member) return;
    var r = R.fill(member, slots[i], { baseDate: BASE });
    ages[i] = r.age;
    r.problems.forEach(function (p) { problems.push(slots[i].fields[0].ref + ' ' + p.field + ':' + p.code); });
    r.writes.forEach(function (w) {
      var res = X.setCell(book, sheet, w.ref, w.value);
      if (!res.ok) problems.push(w.ref + ' write:' + res.reason); else written.push(res.ref);
    });
  });
  (groups || []).forEach(function (g) {
    var list = g.slots.map(function (i) { return ages[i]; });
    if (list.every(function (a) { return a != null; })) {
      var res = X.setCell(book, sheet, g.ageSum, list.reduce(function (s, a) { return s + a; }, 0));
      if (res.ok) written.push(res.ref);
    }
  });
  return X.save(book).then(function (bytes) {
    if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, outName), bytes);
    return Promise.all([read(file), X.open(bytes)]);
  }).then(function (pair) {
    var orig = pair[0], after = pair[1];
    var vals = valueMap(after, sheet);
    var wrong = [];
    Object.keys(expected.values).forEach(function (ref) {
      if (vals[ref] !== expected.values[ref]) wrong.push(ref + ' 期待=' + expected.values[ref] + ' 実際=' + vals[ref]);
    });
    check(wrong.length === 0, label + ': 読み直した値が期待どおり（' + Object.keys(expected.values).length + 'セル）' +
      (wrong.length ? '\n         ' + wrong.join('\n         ') : ''));
    eq(problems.sort(), expected.problems.slice().sort(), label + ': 知らせる内容');
    var by = {}; by[sheet] = written;
    assertPreserved(orig, after, by, label);
    assertOrdered(after, label);
    expectForExcel.push({ file: outName, sheet: sheet, cells: expected.excel || expected.values });
    return after;
  });
}

function main() {
  var roster, rosterCsv;

  section('1. 名簿');
  return read(path.join(FIX, 'roster.xlsx')).then(function (book) {
    roster = R.load(R.rowsFromCells(X.cells(book, 0)));
    check(roster.ok, 'xlsx の名簿を読めた');
    eq(roster.columns, { name: 1, gender: 2, birth: 3, age: 4, address: 5, phone: 6 }, '列の推測');
    eq(roster.members.length, 14, '人数');
    eq(roster.members.map(function (m) { return m.birth ? [m.birth.y, m.birth.m, m.birth.d].join('-') : null; }),
      ['1950-4-1', '1952-5-10', '1948-12-25', '1955-1-1', '1960-7-7', '1955-2-28', null, '1945-3-3',
       '1958-8-15', '1989-1-8', '1960-3-3', '1952-6-6', '1956-9-9', '1962-2-2'],
      '生年月日（Excelの日付・S27.5.10・昭和30年2月28日・1958-08-15・平成元年・19600303 が混在）');
    eq(roster.members.map(function (m) { return m.gender; }),
      ['男', '女', '男', '男', '男', '女', '女', '男', '女', '男', '女', '男', '女', null], '性別（男性・M・F の書き方をそろえる）');
    var takahashi = roster.members[2];
    eq([takahashi.phone, takahashi.postal, takahashi.pref, takahashi.addressRest],
      ['09000000003', '924-0001', '石川県', '白山市サンプル1-3'], '電話の先頭の0を戻す／〒と都道府県を切り分ける');
    eq(roster.members.filter(function (m) { return m.problems.length; }).map(function (m) { return m.name + ':' + m.problems.join('+'); }),
      ['髙橋 一郎:phone-zero-restored', '鈴木 和子:birth-empty', '斉藤 光:gender-empty'], '名簿そのものの問題');

    var csvText = R.decodeCsv(new Uint8Array(fs.readFileSync(path.join(FIX, 'roster.csv'))));
    rosterCsv = R.load(R.rowsFromCsv(csvText));
    eq(rosterCsv.members.map(function (m) { return [m.name, m.gender, m.birth && m.birth.y, m.phone]; }),
      roster.members.map(function (m) { return [m.name, m.gender, m.birth && m.birth.y, m.phone]; }), 'CSV の名簿も同じ中身になる');
    // 「山田」を Shift_JIS で書いたバイト列（Excel が書く CSV の文字コード）
    eq(R.decodeCsv(new Uint8Array([0x8E, 0x52, 0x93, 0x63])), '山田', 'Shift_JIS の CSV を読める');

    section('2. 日付と年齢');
    eq(R.toWareki({ y: 1989, m: 1, d: 7 }), { era: '昭和', short: 'S', n: 64 }, '1989-01-07 は昭和64年');
    eq(R.toWareki({ y: 1989, m: 1, d: 8 }), { era: '平成', short: 'H', n: 1 }, '1989-01-08 は平成元年');
    eq(R.toWareki({ y: 2019, m: 4, d: 30 }), { era: '平成', short: 'H', n: 31 }, '2019-04-30 は平成31年');
    eq(R.toWareki({ y: 2019, m: 5, d: 1 }), { era: '令和', short: 'R', n: 1 }, '2019-05-01 は令和元年');
    eq(R.ageAt({ y: 1950, m: 4, d: 1 }, BASE), 77, '基準日が誕生日なら、その歳');
    eq(R.ageAt({ y: 1950, m: 4, d: 2 }, BASE), 76, '基準日の翌日が誕生日なら、まだ前の歳');
    eq(R.parseBirth('S27.2.30'), null, '存在しない日付は読まない');
    eq(R.parseBirth('R1.5.1'), { y: 2019, m: 5, d: 1 }, 'R1.5.1');

    return formA(roster);
  }).then(function () { return formB(roster); })
    .then(function () { return formC(roster); })
    .then(function () { return localForms(roster); })
    .then(function () {
      fs.writeFileSync(path.join(OUT, 'expect.json'), JSON.stringify(expectForExcel, null, 1), 'utf8');
      console.log('\n' + (ng ? 'NG が ' + ng + ' 件あります' : 'すべて OK') +
        '（Excel で開く確認: powershell -File entry/test/excel-check.ps1）');
      process.exit(ng ? 1 : 0);
    });
}

// ===== 様式A 全項目型 =====
function formA(roster) {
  var file = path.join(FIX, 'form-a-all-fields.xlsx');
  section('3. 様式A 全項目型（1人1行・セルが無いところへ書く）');
  return read(file).then(function (book) {
    var cells = X.cells(book, '申込書');
    var found = R.findNames(cells, roster);
    eq(found.names.map(function (n) { return n.refs.join('+') + ':' + n.match.status; }),
      ['B7:exact', 'B8:variant', 'B9:variant', 'B10:ambiguous', 'B12:exact'], '名前の見つけ方（表記ゆれ・同姓同名）');
    eq(found.suspects.map(function (s) { return s.refs.join('+') + ':' + s.text + '→' + s.candidates.map(function (c) { return c.member.name; }).join('/'); }),
      ['B11:伊藤美穗→伊藤 美穂'], '名簿に無い名前を「誤字の疑い」として拾い、候補を出す');
    assertMasked(R.mask(cells, found), roster, cells.filter(function (c) { return /^B(7|8|9|10|11|12)$/.test(c.ref); }).map(function (c) { return c.text; }), '様式A');

    // 画面で本人が選んだ、という想定
    var pick = {};
    found.names.forEach(function (n) {
      pick[n.row] = n.match.status === 'ambiguous'
        ? n.match.members.filter(function (m) { return m.birth.y === 1955; })[0] : n.match.member;
    });
    pick[11] = found.suspects[0].candidates[0].member;
    var rows = [7, 8, 9, 10, 11, 12];
    var slots = rows.map(function (r) {
      return { fields: [
        { field: 'name', ref: 'B' + r }, { field: 'kana', ref: 'C' + r }, { field: 'gender', ref: 'D' + r, fmt: 'kanji' },
        { field: 'birth', ref: 'E' + r, fmt: 'seireki-slash' }, { field: 'age', ref: 'F' + r },
        { field: 'postal', ref: 'G' + r }, { field: 'address', ref: 'H' + r }, { field: 'phone', ref: 'I' + r }
      ] };
    });
    return writeForm('様式A', file, book, '申込書', roster, rows.map(function (r) { return pick[r]; }), slots, null, 'form-a.xlsx', {
      values: {
        B7: '山田 太郎', D7: '男', E7: '1950/4/1', F7: 77, G7: '920-0001', H7: '石川県金沢市テスト町1-1', I7: '076-000-0001',
        B8: '髙橋 一郎', E8: '1948/12/25', F8: 78, I8: '09000000003',
        B9: '中﨑 良子', D9: '女', E9: '1955/2/28', F9: 72, G9: undefined, H9: '富山県高岡市サンプル5-5',
        B10: '佐藤 次郎', E10: '1955/1/1', F10: 72,
        B11: '伊藤 美穂', F11: 68,
        B12: '鈴木 和子', D12: '女', E12: undefined, F12: undefined,
        A7: 1, A1: 'テスト大会 参加申込書（試験用の架空の様式）'
      },
      excel: { B7: '山田 太郎', F7: 77, I8: '09000000003', B9: '中﨑 良子', E12: '', F11: 68 },
      problems: ['B7 kana:not-in-roster', 'B8 kana:not-in-roster', 'B9 kana:not-in-roster', 'B10 kana:not-in-roster',
                 'B11 kana:not-in-roster', 'B12 kana:not-in-roster', 'B9 postal:not-in-roster', 'B10 postal:not-in-roster',
                 'B12 postal:not-in-roster', 'B12 birth:birth-missing', 'B12 age:birth-missing']
    });
  });
}

// ===== 様式B 百万石型 =====
function formB(roster) {
  var file = path.join(FIX, 'form-b-pairs.xlsx');
  section('4. 様式B 百万石型（2人1組・結合セル・年月日の3欄・罫線つきの空セル）');
  return read(file).then(function (book) {
    var cells = X.cells(book, '個人戦');
    var found = R.findNames(cells, roster);
    eq(found.names.map(function (n) { return n.refs.join('+') + ':' + n.match.status; }),
      ['C14:exact', 'C15:exact', 'C16:exact', 'C17:exact', 'C18:exact', 'C19:exact'], '名前（全角スペース・空白なしでも一致）');
    eq(found.suspects.length, 0, '誤字の疑いなし（見出しの「氏　　　名」「No」を名前と見なさない）');
    assertMasked(R.mask(cells, found), roster, [], '様式B');

    var rows = [14, 15, 16, 17, 18, 19, 20, 21];
    var slots = rows.map(function (r) {
      return { fields: [
        { field: 'name', ref: 'C' + r }, { field: 'gender', ref: 'F' + r, fmt: 'kanji' },
        { field: 'birthEra', ref: 'G' + r }, { field: 'birthYear', ref: 'H' + r, fmt: 'wareki-num' },
        { field: 'birthMonth', ref: 'I' + r }, { field: 'birthDay', ref: 'J' + r }, { field: 'age', ref: 'K' + r }
      ] };
    });
    var members = rows.map(function (r) {
      var n = found.names.filter(function (x) { return x.row === r; })[0];
      return n ? n.match.member : null;
    });
    // L15 は L14:L15 の結合の途中。書き込みは左上（L14）へ寄る
    var groups = [{ slots: [0, 1], ageSum: 'L15' }, { slots: [2, 3], ageSum: 'L16' }, { slots: [4, 5], ageSum: 'L18' }, { slots: [6, 7], ageSum: 'L20' }];
    return writeForm('様式B', file, book, '個人戦', roster, members, slots, groups, 'form-b.xlsx', {
      values: {
        C14: '山田 太郎', F14: '男', G14: '昭和', H14: 25, I14: 4, J14: 1, K14: 77,
        C15: '山田 花子', F15: '女', G15: '昭和', H15: 27, K15: 74, L14: 151,
        C17: '田中 誠', G17: '昭和', H17: 20, K17: 82, L16: 150,
        C18: '渡辺 明', G18: '平成', H18: 1, K18: 38, L18: 108,
        L20: undefined, B14: 1, C12: '氏　　　名'
      },
      problems: ['C17 age:age-differs']
    });
  });
}

// ===== 様式C 分割型 =====
function formC(roster) {
  var file = path.join(FIX, 'form-c-split.xlsx');
  section('5. 様式C 分割型（姓と名が別欄・男女の列に○・都道府県が別欄・式のセル）');
  return read(file).then(function (book) {
    var cells = X.cells(book, '申込書');
    var found = R.findNames(cells, roster);
    eq(found.names.map(function (n) { return n.refs.join('+') + ':' + n.match.status; }),
      ['B6+C6:exact', 'B7+C7:exact', 'B8+C8:exact', 'B9+C9:exact'], '姓と名の2欄をつないで見つける');
    eq(found.duplicates.map(function (d) { return d[0].refs[0] + '=' + d[1].refs[0]; }), ['B7=B9'], '同じ人が2回');
    var masked = R.mask(cells, found);
    eq(masked.filter(function (c) { return c.ref === 'B6' || c.ref === 'C6'; }).map(function (c) { return c.text; }),
      ['〔氏名1・姓〕', '〔氏名1・名〕'], '伏せ字は姓と名を分けて示す');
    assertMasked(masked, roster, [], '様式C');
    eq(X.setCell(book, '申込書', 'G10', 1), { ok: false, ref: 'G10', reason: 'formula' }, '式のセルは上書きしない');

    var rows = [6, 7, 8, 9];
    var slots = rows.map(function (r) {
      return { fields: [
        { field: 'family', ref: 'B' + r }, { field: 'given', ref: 'C' + r },
        { field: 'genderMale', ref: 'D' + r }, { field: 'genderFemale', ref: 'E' + r },
        { field: 'birth', ref: 'F' + r, fmt: 'seireki-kanji' }, { field: 'age', ref: 'G' + r },
        { field: 'addressPref', ref: 'H' + r }, { field: 'addressRest', ref: 'I' + r }, { field: 'phone', ref: 'J' + r }
      ] };
    });
    return writeForm('様式C', file, book, '申込書', roster, found.names.map(function (n) { return n.match.member; }), slots, null, 'form-c.xlsx', {
      values: {
        // ○を付けない側は「空にする」（罫線は残る）ので、読み直すと値が無い
        B6: '小林', C6: 'さくら', D6: undefined, E6: '○', F6: '1960年3月3日', G6: 67, H6: '石川県', I6: '白山市サンプル10',
        D7: '○', E7: undefined, G7: 74, H7: '東京都', I7: '千代田区テスト11', J8: '06-0000-0013', G9: 74
      },
      // 式は Excel が開いたときに計算し直す（fullCalcOnLoad）。67+74+70+74
      excel: { B6: '小林', E6: '○', D7: '○', G10: 285 },
      problems: []
    }).then(function (after) {
      check(/fullCalcOnLoad="1"/.test(after.parts['xl/workbook.xml']), '式のあるブックは、開いたときに計算し直させる');
    });
  });
}

// ===== 本物の様式（手元だけ） =====
function localForms(roster) {
  section('6. 本物の様式（entry/test/local/）');
  var file = fs.existsSync(LOCAL) && fs.readdirSync(LOCAL).filter(function (f) { return /百万石.*\.xlsx$/.test(f); })[0];
  if (!file) { console.log('  --   百万石の申込書が無いので飛ばした'); return Promise.resolve(); }
  var full = path.join(LOCAL, file);
  var sheet = 'ラージ個人戦申込書';
  var typedPath = path.join(OUT, 'local-typed.xlsx');
  // まず「幹事が名前だけ書いた」状態を作る（架空の名簿の名前を、書き方を崩して入れる）
  return read(full).then(function (book) {
    var typed = { C14: '山田太郎', C15: '山田　花子', C16: '伊藤 美穂', C17: '田中誠' };
    Object.keys(typed).forEach(function (ref) { X.setCell(book, sheet, ref, typed[ref]); });
    return X.save(book);
  }).then(function (bytes) {
    fs.writeFileSync(typedPath, bytes);
    return read(typedPath);
  }).then(function (book) {
    var cells = X.cells(book, sheet);
    var found = R.findNames(cells, roster);
    eq(found.names.map(function (n) { return n.refs.join('+') + ':' + n.match.status; }),
      ['C14:exact', 'C15:exact', 'C16:exact', 'C17:exact'], '本物の様式で名前を見つける');
    eq(found.suspects.length, 0, '誤字の疑いなし（ふりがな付きの見出しを名前と見なさない）');
    assertMasked(R.mask(cells, found), roster, [], '本物の様式');
    var rows = [14, 15, 16, 17];
    var slots = rows.map(function (r) {
      return { fields: [
        { field: 'name', ref: 'C' + r }, { field: 'gender', ref: 'F' + r, fmt: 'kanji' },
        { field: 'birthEra', ref: 'G' + r }, { field: 'birthYear', ref: 'H' + r, fmt: 'wareki-num' },
        { field: 'birthMonth', ref: 'I' + r }, { field: 'birthDay', ref: 'J' + r }, { field: 'age', ref: 'K' + r }
      ] };
    });
    var groups = [{ slots: [0, 1], ageSum: 'L14' }, { slots: [2, 3], ageSum: 'L16' }];
    return writeForm('本物の様式', typedPath, book, sheet, roster, found.names.map(function (n) { return n.match.member; }), slots, groups, 'local-filled.xlsx', {
      values: { C14: '山田 太郎', F14: '男', G14: '昭和', H14: 25, I14: 4, J14: 1, K14: 77, C15: '山田 花子', L14: 151, K17: 82, L16: 150 },
      problems: ['C17 age:age-differs']
    });
  });
}

main().catch(function (e) { console.error(e); process.exit(1); });
