// 申込書ドロッパーの中核（entry-xlsx.js / entry-roster.js / entry-rules.js / entry-map.js）を Node で確かめる。
//
//   node entry/test/make-fixtures.js     … 試験用データを作り直す（fixtures/）
//   node entry/test/run.js               … 確かめる。落ちたら終了コード 1
//   powershell -File entry/test/excel-check.ps1   … 書き出したファイルを本物の Excel で開いて確かめる
//
// 確かめること:
//   1. 名簿の読み取り（列の推測・生年月日の書き方の混在・電話の先頭の0・空欄）
//   2. 様式ごとに「名前を探す → 書き込む → 読み直す」
//   3. ★ 書き換えたセル以外が1バイトも変わっていないこと（書式を壊していない証拠）
//   5. entry/test/local/ に本物の様式があれば、それでも 2〜3 を流す（無ければ飛ばす）
//   6. 欄の対応づくり（見出しの規則。AI は使わない）。規則の答えが、2 で手で書いた欄の対応と一致すること。
//      通信は、このサイトの postal/ を読む1か所だけであること（名簿も申込書もどこにも送らない）
//   9. 郵便番号から住所（tools/make-postal.js の変換と entry-postal.js の引き当て）
//  10. 名簿ファイル（entry-book.js で作る・読む・申込書に書く形にする）
var fs = require('fs');
var path = require('path');

global.window = global;
eval(fs.readFileSync(path.join(__dirname, '..', 'entry-xlsx.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'entry-roster.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'entry-rules.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'entry-map.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'entry-postal.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'entry-book.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'entry-attend.js'), 'utf8'));
var X = window.EntryXlsx, R = window.EntryRoster, RU = window.EntryRules, M = window.EntryMap,
    P = window.EntryPostal, B = window.EntryBook, AT = window.EntryAttend;
var MAKE_POSTAL = require(path.join(__dirname, '..', '..', 'tools', 'make-postal.js'));

// 手で書いた欄の対応を、見出しの規則の答えと比べるために取っておく
var HAND = {};

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
  var roster;

  section('1. 名簿（ツールが作った名簿ファイルを読む）');
  return read(path.join(FIX, 'roster.xlsx')).then(function (book) {
    var got = B.read(book);
    check(got.ok, '名簿ファイルを読めた');
    eq([got.org, (got.people['男子'] || []).length, (got.people['女子'] || []).length],
      ['白山テストクラブ（架空）', 8, 6], '団体名と人数（男子・女子のシート）');
    roster = B.toRoster(got.people);
    eq(roster.members.length, 14, '人数');
    eq(roster.members.map(function (m) { return m.birth ? [m.birth.y, m.birth.m, m.birth.d].join('-') : null; }),
      ['1950-4-1', '1948-12-25', '1955-1-1', '1960-7-7', '1945-3-3', '1989-1-8', '1952-6-6', '1962-2-2',
       '1952-5-10', '1955-2-28', null, '1958-8-15', '1960-3-3', '1956-9-9'],
      '生年月日（Excel の日付。渡辺 明は人が文字（平成元年1月8日）で直した行）');
    eq(roster.members.map(function (m) { return m.gender; }),
      ['男', '男', '男', '男', '男', '男', '男', '男', '女', '女', '女', '女', '女', '女'], '★ 性別はシートから決まる');
    var takahashi = roster.members[1];
    eq([takahashi.name, takahashi.kana, takahashi.phone, takahashi.postal, takahashi.pref, takahashi.addressRest],
      ['髙橋 一郎', 'タカハシ イチロウ', '090-0000-0003', '924-0001', '石川県', '白山市サンプル1-3'], '1人ぶんの中身');
    eq(got.problems.map(function (p) { return p.family + ' ' + p.given + ':' + p.problems.join('+'); }),
      ['斉藤 光:kana-empty+phone-empty', '鈴木 和子:birth-empty'], '名簿そのものの気になる点（止めずに知らせる）');

    section('2. 日付と年齢');
    // 名簿は決まった形になったが、人が Excel で直すことがあるので、いろいろな書き方を読めるままにしておく
    eq([R.parseBirth('S27.5.10'), R.parseBirth('昭和30年2月28日'), R.parseBirth('1958-08-15'), R.parseBirth('19600303')],
      [{ y: 1952, m: 5, d: 10 }, { y: 1955, m: 2, d: 28 }, { y: 1958, m: 8, d: 15 }, { y: 1960, m: 3, d: 3 }],
      '生年月日の書き方（S27.5.10・昭和30年2月28日・1958-08-15・19600303）');
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
    .then(function () { return mapSection(roster); })
    .then(function () { return shrinkSection(roster); })
    .then(function () { return postalSection(); })
    .then(function () { return revSection(); })
    .then(function () { return attendSection(); })
    .then(function () { return bookSection(); })
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
        { field: 'postal', ref: 'G' + r }, { field: 'address', ref: 'H' + r, fmt: 'plain' }, { field: 'phone', ref: 'I' + r }
      ] };
    });
    HAND.A = { slots: slots, names: found.names.concat(found.suspects), cells: cells, book: book, sheet: '申込書', found: found };
    return writeForm('様式A', file, book, '申込書', roster, rows.map(function (r) { return pick[r]; }), slots, null, 'form-a.xlsx', {
      values: {
        B7: '山田 太郎', D7: '男', E7: '1950/4/1', F7: 77, G7: '920-0001', H7: '石川県金沢市テスト町1-1', I7: '076-000-0001',
        B8: '髙橋 一郎', C8: 'タカハシ イチロウ', E8: '1948/12/25', F8: 78, I8: '090-0000-0003',
        B9: '中﨑 良子', D9: '女', E9: '1955/2/28', F9: 72, G9: undefined, H9: '富山県高岡市サンプル5-5',
        B10: '佐藤 次郎', E10: '1955/1/1', F10: 72,
        B11: '伊藤 美穂', F11: 68,
        B12: '鈴木 和子', D12: '女', E12: undefined, F12: undefined,
        A7: 1, A1: 'テスト大会 参加申込書（試験用の架空の様式）'
      },
      excel: { B7: '山田 太郎', F7: 77, I8: '090-0000-0003', B9: '中﨑 良子', E12: '', F11: 68 },
      // フリガナは名簿に入るようになったので「名簿に無い」とは言わない。郵便番号を入れていない人だけ知らせる
      problems: ['B9 postal:not-in-roster', 'B10 postal:not-in-roster',
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

    var rows = [14, 15, 16, 17, 18, 19, 20, 21];
    var slots = rows.map(function (r) {
      return { fields: [
        { field: 'name', ref: 'C' + r }, { field: 'gender', ref: 'F' + r, fmt: 'kanji' },
        { field: 'birthEra', ref: 'G' + r, fmt: 'full' }, { field: 'birthYear', ref: 'H' + r, fmt: 'wareki-num' },
        { field: 'birthMonth', ref: 'I' + r }, { field: 'birthDay', ref: 'J' + r }, { field: 'age', ref: 'K' + r }
      ] };
    });
    HAND.B = { slots: slots.slice(0, 6), names: found.names, cells: cells, book: book, sheet: '個人戦', found: found };
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
      problems: []
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
    eq(X.setCell(book, '申込書', 'G10', 1), { ok: false, ref: 'G10', reason: 'formula' }, '式のセルは上書きしない');

    var rows = [6, 7, 8, 9];
    var slots = rows.map(function (r) {
      return { fields: [
        { field: 'family', ref: 'B' + r }, { field: 'given', ref: 'C' + r },
        { field: 'genderMale', ref: 'D' + r, mark: '○' }, { field: 'genderFemale', ref: 'E' + r, mark: '○' },
        { field: 'birth', ref: 'F' + r, fmt: 'seireki-kanji' }, { field: 'age', ref: 'G' + r },
        { field: 'addressPref', ref: 'H' + r }, { field: 'addressRest', ref: 'I' + r }, { field: 'phone', ref: 'J' + r }
      ] };
    });
    HAND.C = { slots: slots, names: found.names, cells: cells, book: book, sheet: '申込書', found: found };
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
      problems: []
    });
  });
}

// ===== 欄の対応づくり（見出しの規則。AI は使わない） =====
// 2026-09-15 に Gemini をやめ、見出しの規則（entry-rules.js）に置き換えた。
// expected-maps.json は「正しい欄の対応」（手で書いた正解と同じもの）。normalize / slotsFor の試験に使う。
var EXPECTED = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected-maps.json'), 'utf8'));
var GOOD = { A: EXPECTED.A.answer, B: EXPECTED.B.answer, C: EXPECTED.C.answer };

// 比べるのは欄の種類・番地・書き方・印だけ（規則は見出しの文字 header も返すが、正解には無い）
function plainSlots(slots) {
  return slots.map(function (s) {
    return s.fields.map(function (f) {
      var o = { field: f.field, ref: f.ref };
      if (f.fmt) o.fmt = f.fmt;
      if (f.mark) o.mark = f.mark;
      return o;
    });
  });
}
function rulesFor(book, sheet, cells, found) {
  return M.normalize(RU.map(cells, X.merges(book, sheet), found));
}
function sortedNames(found) {
  return found.names.concat(found.suspects).sort(function (a, b) { return a.row - b.row || a.col - b.col; });
}

function mapSection(roster) {
  section('7. 欄の対応づくり（見出しの規則。AI は使わない）');

  // --- どこにも送らない（通信は、このサイトの postal/ を読む1か所だけ） ---
  var netRe = /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts|generativelanguage|googleapis\.com\/(?!css)/;
  // ★ 通信してよいのはこの3か所だけ。ここを変えるときは、変えてよいのかを先に考えること
  var POSTAL_FETCHES = [
    "fetch(BASE + digit + '.json', { credentials: 'omit' })",
    "fetch(BASE + 'rev/' + code + '.json', { credentials: 'omit' })",
    "fetch(API_BASE + '?action=members&s=' + encodeURIComponent(id), { credentials: 'omit' })"
  ];
  var srcOf = function (f) { return fs.readFileSync(path.join(__dirname, '..', f), 'utf8'); };
  var strip = function (code) {
    POSTAL_FETCHES.forEach(function (x) { code = code.split(x).join(''); });
    return code;
  };
  var talkers = ['entry-app.js', 'entry-map.js', 'entry-rules.js', 'entry-roster.js', 'entry-xlsx.js', 'entry-i18n.js',
    'entry-postal.js', 'entry-book.js', 'entry-attend.js'].filter(function (f) {
    return netRe.test(strip(srcOf(f)).replace(/\/\/[^\n]*/g, ''));
  });
  eq(talkers, [], '申込書ドロッパーの JS に、郵便番号データと出欠システムの名前以外の通信が無い（名簿も申込書も送らない）');

  var attendSrc = srcOf('entry-attend.js');
  eq(attendSrc.split(POSTAL_FETCHES[2]).length - 1, 1, '出欠システムを呼ぶ fetch は entry-attend.js の1か所だけ');
  check(attendSrc.indexOf("var API_BASE = 'https://api.dropper-tools.com/';") >= 0 &&
    (attendSrc.match(/\bAPI_BASE\s*=/g) || []).length === 1, '呼び先は出欠システムの API だけ（ほかへ付け替えていない）');
  check(!/method\s*:\s*'POST'|body\s*:/.test(attendSrc), '★ 出欠システムへは団体IDを付けて読むだけ（何も送りつけない）');
  var postalSrc = srcOf('entry-postal.js');
  eq(POSTAL_FETCHES.slice(0, 2).map(function (x) { return postalSrc.split(x).length - 1; }), [1, 1],
    '郵便番号データを読む fetch は entry-postal.js の2か所だけ（郵便番号から住所／住所から郵便番号）');
  check((postalSrc.match(/\bBASE\s*=/g) || []).length === 1 && postalSrc.indexOf("var BASE = 'postal/';") >= 0,
    '読みに行く先は、このサイトの相対パス postal/ だけ（ほかへ付け替えていない）');
  var urlLines = postalSrc.split(/\r?\n/).filter(function (l) { return /https?:|\/\/[a-z0-9.-]+\.[a-z]/i.test(l) && !/^\s*\/\//.test(l); });
  eq(urlLines, [], 'entry-postal.js のコメント以外に、よそのサイトの URL が無い');
  check(!fs.existsSync(path.join(__dirname, '..', 'entry-ai.js')), 'Gemini を呼ぶ entry-ai.js は無い');
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  check(!/gtag|googletagmanager|hits\.sh|key-modal|entry-ai\.js/.test(html), 'index.html に解析・訪問者カウンター・キー入力・entry-ai.js が無い（試作中）');

  // --- 自作の様式3つ: 規則の答えが、手で書いた正解と一致する ---
  ['A', 'B', 'C'].forEach(function (k) {
    var h = HAND[k];
    var mapping = rulesFor(h.book, h.sheet, h.cells, h.found);
    eq(mapping.problems, [], '様式' + k + ': 規則の答えに問題が出ない');
    eq(mapping.baseDate, { y: 2027, m: 4, d: 1 }, '様式' + k + ': 基準日を申込書の記載から読む');
    var res = M.slotsFor(mapping, sortedNames(h.found), { cells: h.cells, anchorOf: function (r) { return X.anchorOf(h.book, h.sheet, r); } });
    eq(res.problems, [], '様式' + k + ': 当てはめに問題が出ない');
    eq(plainSlots(res.slots), plainSlots(h.slots), '様式' + k + ': 見出しの規則で、手で書いた欄の対応と同じになる');
    check(res.slots.every(function (s) { return s.fields.every(function (f) { return /^(name|family|given)$/.test(f.field) || f.header; }); }),
      '様式' + k + ': 書く欄にはすべて申込書の見出しの文字が付く（④の表に出す）');
    if (k === 'B') {
      eq(res.groups.map(function (g) { return g.ageSum + '=' + g.slots.join('+'); }), ['L14=0+1', 'L16=2+3', 'L18=4+5'], '様式B: 2人1組の合計年齢の欄');
    }
  });

  // --- 見出しの書き方を変えた6通り（様式A）。今分かっている見落とし・誤爆も、そのまま期待値にしてある ---
  // ★ ここが変わったら、規則を直した結果かどうかを確かめること。誤爆が増えるのは悪化
  var VARIANTS = [
    { label: '表記ゆれ（ﾌﾘｶﾞﾅ・性　別・生 年 月 日・年令・〒・現住所・TEL）',
      headers: { C6: 'ﾌﾘｶﾞﾅ', D6: '性　別', E6: '生 年 月 日', F6: '年令', G6: '〒', H6: '現住所', I6: 'TEL' },
      want: 'C:kana D:gender(kanji) E:birth(wareki) F:age G:postal H:address(plain) I:phone' },
    { label: '言い回し（よみがな・ご住所・連絡先（携帯）・満年齢）【満年齢は見落とす】',
      headers: { C6: 'よみがな', E6: '生年月日', F6: '満年齢', H6: 'ご住所', I6: '連絡先（携帯）' },
      want: 'C:kana D:gender(kanji) E:birth(wareki) G:postal H:address(plain) I:phone' },
    { label: '性別が「男・女」の1列【見落とす】',
      headers: { D6: '男・女' },
      want: 'C:kana E:birth(seireki-slash) F:age G:postal H:address(plain) I:phone' },
    { label: '見出しに「生年月日（西暦）」',
      headers: { E6: '生年月日（西暦）' },
      want: 'C:kana D:gender(kanji) E:birth(seireki-slash) F:age G:postal H:address(plain) I:phone' },
    { label: '名簿に無い欄（段位・所属クラブ・備考）',
      headers: { C6: '段位', G6: '所属クラブ', I6: '備考' },
      want: 'D:gender(kanji) E:birth(seireki-slash) F:age H:address(plain)' },
    { label: 'まぎらわしい語（年齢区分・緊急連絡先・住所（市町村まで））【年齢区分に年齢を書く＝誤爆】',
      headers: { F6: '年齢区分', I6: '緊急連絡先', H6: '住所（市町村まで）' },
      want: 'C:kana D:gender(kanji) E:birth(seireki-slash) F:age G:postal H:address(plain) I:phone' }
  ];
  var variantsDone = VARIANTS.reduce(function (p, v) {
    return p.then(function () {
      return read(path.join(FIX, 'form-a-all-fields.xlsx')).then(function (book) {
        Object.keys(v.headers).forEach(function (ref) { X.setCell(book, '申込書', ref, v.headers[ref]); });
        var cells = X.cells(book, '申込書');
        var found = R.findNames(cells, roster);
        var res = M.slotsFor(rulesFor(book, '申込書', cells, found), sortedNames(found), { cells: cells });
        var got = res.slots[0].fields.filter(function (f) { return f.field !== 'name'; })
          .map(function (f) { return f.ref.replace(/\d+$/, '') + ':' + f.field + (f.fmt ? '(' + f.fmt + ')' : ''); }).join(' ');
        eq(got, v.want, '見出しの書き方を変える: ' + v.label);
      });
    });
  }, Promise.resolve());

  // --- 本人の直し（④の「書く欄の対応」で選び直す） ---
  // 見出しを変えた様式Aで、規則の見落とし・誤爆を直せること。直しは「名前の列＋見出しの行」で表を見分けて当てる
  function variant(headers, typedRows) {
    return read(path.join(FIX, 'form-a-all-fields.xlsx')).then(function (book) {
      Object.keys(headers).forEach(function (ref) { X.setCell(book, '申込書', ref, headers[ref]); });
      if (typedRows) [7, 8, 9, 10, 11, 12].forEach(function (r) { if (typedRows.indexOf(r) < 0) X.setCell(book, '申込書', 'B' + r, ''); });
      var cells = X.cells(book, '申込書');
      var found = R.findNames(cells, roster);
      return { book: book, cells: cells, found: found, mapping: rulesFor(book, '申込書', cells, found) };
    });
  }
  function firstRowItems(v, mapping) {
    var res = M.slotsFor(mapping, sortedNames(v.found), { cells: v.cells });
    return res.slots[0].fields.filter(function (f) { return f.field !== 'name'; })
      .map(function (f) { return f.ref.replace(/\d+$/, '') + ':' + f.field + (f.fmt ? '(' + f.fmt + ')' : ''); }).join(' ');
  }
  var overridesDone = variantsDone.then(function () {
    return variant({ C6: 'よみがな', E6: '生年月日', F6: '満年齢', H6: 'ご住所', I6: '連絡先（携帯）' });
  }).then(function (v) {
    var tb = v.mapping.tables[0];
    eq(M.tableKey(tb), 'B@6', '表の鍵は「名前の列＠見出しの行」');
    eq(tb.cols.map(function (x) { return x.col + ':' + (x.field || '-'); }).join(' '), 'C:kana D:gender E:birth F:- G:postal H:address I:phone',
      '一覧には見出しのある列がすべて並び、決められなかった列（満年齢）は種類なし');
    var r = M.applyOverrides(v.mapping, { 'B@6': { F: 'age' } });
    eq(firstRowItems(v, r.mapping), 'C:kana D:gender(kanji) E:birth(wareki) F:age G:postal H:address(plain) I:phone', '見落とした「満年齢」を年齢に直すと、書くようになる');
    eq(r.mapping.tables[0].cols.filter(function (x) { return x.col === 'F'; })[0], { col: 'F', header: '満年齢', field: 'age', overridden: true }, '直した列には印が付く（④で「選び直した列」と出す）');
    eq(r.duplicates, [], '重ならなければ警告は出ない');
    // 同じ種類を2列
    var d = M.applyOverrides(v.mapping, { 'B@6': { F: 'age', G: 'age' } });
    eq(d.duplicates.map(function (x) { return x.field + ':' + x.cols.join('+'); }), ['age:F+G'], '同じ種類を2つの列に選ぶと警告する');
    // 受け付けない直し
    var ng = M.applyOverrides(v.mapping, { 'B@6': { B: 'age', Z: 'age', C: 'name', D: 'unknown' } });
    eq(firstRowItems(v, ng.mapping), firstRowItems(v, v.mapping), '名前の列・見出しの無い列・名前の欄・知らない種類への直しは受け付けない');
    return variant({ F6: '年齢区分' });
  }).then(function (v) {
    var r = M.applyOverrides(v.mapping, { 'B@6': { F: 'none' } });
    eq(firstRowItems(v, r.mapping), 'C:kana D:gender(kanji) E:birth(seireki-slash) G:postal H:address(plain) I:phone', '誤爆した「年齢区分」を「書かない」に直すと、書かなくなる');
    return variant({ D6: '男・女' });
  }).then(function (v) {
    var r = M.applyOverrides(v.mapping, { 'B@6': { D: 'gender' } });
    eq(firstRowItems(v, r.mapping).split(' ')[1], 'D:gender(kanji)', '見落とした「男・女」の列を性別に直すと、男／女で書く');
    // 名前を書いた人数が変わっても、同じ直しが効く（表の鍵が変わらない）
    return Promise.all([variant({ F6: '満年齢' }), variant({ F6: '満年齢' }, [8, 9]), variant({}, [11, 12])]);
  }).then(function (pair) {
    // ★ 見出し（6行目）から5行以上離れた行だけに名前を書いても、見出しを見つける（空いた記入行の上まで探す）
    var far = pair[2];
    eq([M.tableKey(far.mapping.tables[0]), firstRowItems(far, far.mapping)],
      ['B@6', 'C:kana D:gender(kanji) E:birth(seireki-slash) F:age G:postal H:address(plain) I:phone'],
      '見出しから5行離れた行（11・12行目）だけに名前を書いても、見出しを見つけて全欄を決める');
    check(far.mapping.tables[0].cols.every(function (x) { return x.col !== 'A'; }), '番号が印刷済みの「No」の列は一覧に出さない');
    var all = pair[0], few = pair[1];
    eq([M.tableKey(all.mapping.tables[0]), M.tableKey(few.mapping.tables[0])], ['B@6', 'B@6'], '名前を書いた人数や行が変わっても、表の鍵は同じ');
    var r = M.applyOverrides(few.mapping, { 'B@6': { F: 'age' } });
    check(M.slotsFor(r.mapping, sortedNames(few.found), { cells: few.cells }).slots.every(function (s) {
      return s.fields.some(function (f) { return f.field === 'age' && /^F/.test(f.ref); });
    }), '2人だけ書いた申込書にも、同じ直しが効く');
  });

  // --- 対応を検める（規則が外れても書かない） ---
  var weird = M.normalize({
    tables: [
      { nameCol: 'C', firstRow: 14, lastRow: 21, fields: [
        { field: 'grade', col: 'M', rowOffset: 0 }, { field: 'gender', col: 'ZZZZ', rowOffset: 0 },
        { field: 'age', col: 'K', rowOffset: 9 }, { field: 'name', col: 'C', rowOffset: 0 },
        { field: 'birthYear', col: 'H', rowOffset: 0, fmt: '???' }, { field: 'birthMonth', col: 'H', rowOffset: 0 }
      ] },
      { nameCol: '', firstRow: 1, lastRow: 2, fields: [] },
      { nameCol: 'B', firstRow: 9, lastRow: 3, fields: [] }
    ]
  });
  eq(weird.problems.map(function (p) { return p.code + (p.field ? ':' + p.field : ''); }),
    ['unknown-field:grade', 'bad-position:gender', 'bad-position:age', 'same-cell-twice:birthMonth', 'table-no-name-col', 'table-bad-rows'],
    '使えない欄の対応は捨てて、理由を残す');
  eq(weird.tables[0].fields, [{ field: 'birthYear', col: 'H', rowOffset: 0, fmt: 'wareki' }], '使える欄だけ残り、知らない書き方は既定に戻す');
  eq(['C', 'c', 'C14', 'C:E', 'C14:E14', '$C', 'C列', 'Ｃ', 'AB', 'AB7', '14', '', '列C'].map(function (v) {
    var t = M.normalize({ tables: [{ nameCol: v, firstRow: 1, lastRow: 2, fields: [] }] }).tables[0];
    return t ? t.nameCol : '-';
  }), ['C', 'C', 'C', 'C', 'C', 'C', 'C', 'C', 'AB', 'AB', '-', '-', '-'], '列は「C14」「C:E」「$C」「C列」「Ｃ」でも C と読む');
  eq(M.normalize({ baseDateRaw: '（年齢は、令和９年４月１日現在をご記入下さい）', tables: [] }).baseDate, { y: 2027, m: 4, d: 1 }, '基準日は文の中から日付だけを読む');

  var hA = HAND.A;
  var wrongA = M.normalize({ tables: [{ nameCol: 'B', firstRow: 7, lastRow: 12, fields: [
    { field: 'kana', col: 'A', rowOffset: 0 }, { field: 'phone', col: 'B', rowOffset: 0 }, { field: 'age', col: 'F', rowOffset: -1 }
  ] }] });
  var wr = M.slotsFor(wrongA, sortedNames(hA.found), { cells: hA.cells });
  eq(wr.problems.filter(function (p) { return p.name === 'B7'; }).map(function (p) { return p.code + ':' + p.ref; }),
    ['target-has-text:A7', 'target-is-name:B7', 'offset-crosses-person:F6'], '文字の入った欄・名前の欄・ほかの人の行には書かない');
  eq(wr.slots[0].fields, [{ field: 'name', ref: 'B7' }], '書けない欄を除いた対応だけが残る');

  var hB0 = HAND.B;
  var shifted = JSON.parse(JSON.stringify(GOOD.B));
  shifted.tables[0].fields.forEach(function (f) { if (/^birth/.test(f.field)) f.rowOffset = 1; });
  var sh = M.slotsFor(M.normalize(shifted), sortedNames(hB0.found), { cells: hB0.cells, anchorOf: function (r) { return X.anchorOf(hB0.book, hB0.sheet, r); } });
  eq([sh.problems.length, sh.problems.every(function (p) { return p.code === 'offset-crosses-person'; })], [24, true],
    '1人1行の表で1行ずれた対応は、ほかの人の行に書かずに知らせる（6人×生年月日4欄）');

  var kanaBelow = M.normalize({ tables: [{ nameCol: 'B', firstRow: 7, lastRow: 12, fields: [{ field: 'kana', col: 'B', rowOffset: 1 }] }] });
  var everyOther = sortedNames(hA.found).filter(function (n) { return n.row === 7 || n.row === 9 || n.row === 11; });
  var kb = M.slotsFor(kanaBelow, everyOther, { cells: [] });
  eq([kb.problems, kb.slots[0].fields[1]], [[], { field: 'kana', ref: 'B8' }], '名前が1行おきなら、1行下（ふりがなの欄）には書ける');

  var unpaired = JSON.parse(JSON.stringify(GOOD.C));
  unpaired.tables[0].fields = unpaired.tables[0].fields.filter(function (f) { return f.field !== 'genderMale'; });
  eq(M.normalize(unpaired).problems, [{ code: 'gender-mark-unpaired', table: 0, missing: 'genderMale' }], '男・女の列が片方だけなら知らせる');

  var hC = HAND.C;
  var realC = JSON.parse(JSON.stringify(GOOD.C));
  realC.tables[0].pairSize = 4; realC.tables[0].ageSumCol = 'G'; realC.tables[0].ageSumRowOffset = 4;
  var rc = M.slotsFor(M.normalize(realC), sortedNames(hC.found), { cells: hC.cells });
  eq([rc.groups.length, rc.problems.map(function (p) { return p.code + ':' + p.ref; })], [0, ['target-is-formula:G10']], '合計年齢の欄が式のセルなら書かない');

  var outside = M.slotsFor(M.normalize(GOOD.A), [{ refs: ['B20'], row: 20, col: 2, text: 'x' }], { cells: [] });
  eq(outside.problems.map(function (p) { return p.code; }), ['name-outside-table'], '表の範囲の外の名前は知らせる');

  // --- 本物の申込書（手元だけ） ---
  var localFiles = fs.existsSync(LOCAL) ? fs.readdirSync(LOCAL) : [];
  var hyaku = localFiles.filter(function (f) { return /百万石.*\.xlsx$/.test(f); })[0];
  var sporec = localFiles.filter(function (f) { return /スポレク.*\.xlsx$/.test(f); })[0];
  var BIRTH_SPLIT = function (r) {
    return [{ field: 'name', ref: 'C' + r }, { field: 'gender', ref: 'F' + r, fmt: 'kanji' }, { field: 'birthEra', ref: 'G' + r, fmt: 'full' },
            { field: 'birthYear', ref: 'H' + r, fmt: 'wareki-num' }, { field: 'birthMonth', ref: 'I' + r },
            { field: 'birthDay', ref: 'J' + r }, { field: 'age', ref: 'K' + r }];
  };
  function localCase(label, file, sheet, typed, expectSlots, expectGroups) {
    return read(path.join(LOCAL, file)).then(function (book) {
      var si = typeof sheet === 'number' ? sheet : book.sheets.map(function (s) { return s.name; }).indexOf(sheet);
      // 名前の欄は架空の名前に置き換えてから使う（本物の名前は表示しない・書き出さない）
      Object.keys(typed).forEach(function (ref) { X.setCell(book, si, ref, typed[ref]); });
      var cells = X.cells(book, si);
      var found = R.findNames(cells, roster);
      var res = M.slotsFor(rulesFor(book, si, cells, found), sortedNames(found), { cells: cells, anchorOf: function (r) { return X.anchorOf(book, si, r); } });
      eq(plainSlots(res.slots), expectSlots, label + ': 見出しの規則で全欄が正しい');
      eq(res.groups.map(function (g) { return g.ageSum + '=' + g.slots.join('+'); }), expectGroups, label + ': 合計年齢の欄');
      return rulesFor(book, si, cells, found);
    }).then(function (mapping) {
      if (/スポレク/.test(label)) {
        eq(mapping.tables.map(function (tb) { return M.tableKey(tb) + ' ' + tb.cols.map(function (x) { return x.col + ':' + (x.field || '-'); }).join(' '); }),
          ['B@9 E:address F:phone', 'B@12 C:birth D:age E:address F:phone G:-'],
          label + ': 連絡責任者と選手を別の表として見分け、それぞれの列の一覧を出す（市町（チーム）名は決められない列）');
      }
    });
  }
  var localDone = overridesDone;
  if (hyaku) {
    localDone = localDone.then(function () {
      return localCase('本物の百万石 個人戦', hyaku, 'ラージ個人戦申込書', { C14: '山田太郎', C15: '山田　花子', C16: '伊藤 美穂', C17: '田中誠' },
        [14, 15, 16, 17].map(BIRTH_SPLIT), ['L14=0+1', 'L16=2+3']);
    }).then(function () {
      return localCase('本物の百万石 団体戦', hyaku, 'ラージ団体戦申込書', { C14: '加藤健', C15: '山田 太郎', C16: '山田花子', C17: '伊藤美穂', C18: '渡辺　明' },
        [14, 15, 16, 17, 18].map(BIRTH_SPLIT), []);
    });
  } else console.log('  --   百万石の申込書が無いので飛ばした');
  if (sporec) {
    // スポレク参加申込書: 同じB列に「連絡責任者」（9〜10行目）と「選手」（12〜18行目）の表が上下に並ぶ。3シートとも同じ形
    var SP_EXPECT = [[{ field: 'name', ref: 'B10' }, { field: 'address', ref: 'E10', fmt: 'plain' }, { field: 'phone', ref: 'F10' }]]
      .concat([13, 14, 15, 16, 17, 18].map(function (r) {
        return [{ field: 'name', ref: 'B' + r }, { field: 'birth', ref: 'C' + r, fmt: 'wareki' }, { field: 'age', ref: 'D' + r },
                { field: 'address', ref: 'E' + r, fmt: 'plain' }, { field: 'phone', ref: 'F' + r }];
      }));
    var SP_TYPED = { B10: '加藤健', B13: '山田太郎', B14: '山田 花子', B15: '伊藤美穂', B16: '田中　誠', B17: '渡辺明', B18: '吉田恵' };
    localDone = localDone.then(function () {
      return [0, 1, 2].reduce(function (p, si) {
        return p.then(function () { return localCase('本物のスポレク シート' + (si + 1), sporec, si, SP_TYPED, SP_EXPECT, []); });
      }, Promise.resolve());
    });
  } else console.log('  --   スポレクの申込書が無いので飛ばした');

  // --- 同じ様式の鍵と、覚える書き方 ---
  return localDone.then(function () {
    return read(path.join(FIX, 'form-b-pairs.xlsx'));
  }).then(function (book) {
    X.setCell(book, '個人戦', 'C14', '加藤健'); X.setCell(book, '個人戦', 'C15', '');
    X.setCell(book, '個人戦', 'C20', '小林さくら');
    var cells2 = X.cells(book, '個人戦');
    var found2 = R.findNames(cells2, roster);
    return Promise.all([
      M.formKey('個人戦', HAND.B.cells, X.merges(HAND.B.book, '個人戦'), HAND.B.found),
      M.formKey('個人戦', cells2, X.merges(book, '個人戦'), found2),
      M.formKey('申込書', HAND.A.cells, X.merges(HAND.A.book, '申込書'), HAND.A.found)
    ]);
  }).then(function (keys) {
    check(keys[0] === keys[1], '同じ様式なら、書いた名前や人数が違っても同じ鍵');
    check(keys[0] !== keys[2], '別の様式なら別の鍵');
    var store = {};
    global.localStorage = { getItem: function (k) { return store[k] || null; }, setItem: function (k, v) { store[k] = String(v); } };
    M.prefs.put(keys[0], { fmt: { birthYear: 'seireki' } });
    eq(M.prefs.get(keys[1]), { fmt: { birthYear: 'seireki' } }, '選び直した書き方を、同じ様式の2回目に取り出せる');
    check(!/山田|伊藤|田中|渡辺|吉田|1950/.test(store.dropper_entry_form_prefs), '覚えた中身に名前も生年月日も入っていない');
    delete global.localStorage;
  });
}

// ===== 縮小して全体を表示（2026-09-15、本人の要望） =====
// styles.xml は「書き換えたセル以外は変えない」の例外。変わるのは cellXfs の末尾への追加と count だけであること。
function cellXfsOf(stylesXml) {
  var m = /<cellXfs\b[^>]*count="(\d+)"[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  return { count: Number(m[1]), xfs: m[2].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) || [], index: m.index, whole: m[0] };
}
function styleOfCell(book, sheet, ref) {
  var s = book.sheets.filter(function (x) { return x.name === sheet; })[0];
  var m = new RegExp('<c\\b(?=[^>]*\\sr="' + ref + '")[^>]*?\\ss="(\\d+)"').exec(book.parts[s.path]);
  return m ? Number(m[1]) : 0;
}

function shrinkSection(roster) {
  section('8. 縮小して全体を表示／西暦で書くときの元号の欄');

  // 折り返しを外す・揃えは残す・protection より前に alignment を置く（合成した書式の一覧で）
  var fake = { parts: { 'xl/styles.xml': '<styleSheet><cellXfs count="3"><xf numFmtId="0"/>' +
    '<xf numFmtId="0" applyAlignment="1"><alignment horizontal="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" applyProtection="1"><protection locked="0"/></xf></cellXfs></styleSheet>' }, dirty: {} };
  var i1 = X.shrinkStyle(fake, '1'), i2 = X.shrinkStyle(fake, '2'), i1b = X.shrinkStyle(fake, '1');
  var fx = cellXfsOf(fake.parts['xl/styles.xml']);
  eq([i1, i2, i1b, fx.count, fx.xfs.length], ['3', '4', '3', 5, 5], '同じ元の書式からは写しを1つだけ作り、count も合わせる');
  eq(fx.xfs[3], '<xf numFmtId="0" applyAlignment="1"><alignment horizontal="center" shrinkToFit="1"/></xf>', '折り返し（wrapText）を外し、中央揃えは残す');
  eq(fx.xfs[4], '<xf numFmtId="0" applyProtection="1" applyAlignment="1"><alignment shrinkToFit="1"/><protection locked="0"/></xf>', 'alignment は protection より前に置く');

  // 西暦で書くときは元号の欄を空にする
  var yamada = roster.members[0];
  var f = R.fill(yamada, { fields: [{ field: 'birthEra', ref: 'G14', fmt: 'none' }, { field: 'birthYear', ref: 'H14', fmt: 'seireki' }] }, { baseDate: BASE });
  eq(f.writes, [{ ref: 'G14', value: '' }, { ref: 'H14', value: 1950 }], '西暦を選ぶと、元号の欄は空・年の欄は 1950');

  var jobs = [
    { label: '様式B', file: path.join(FIX, 'form-b-pairs.xlsx'), sheet: '個人戦', out: 'form-b-shrink.xlsx',
      writes: { C14: '山田 太郎（とても長い名前のつもり）', C15: '山田 花子', C12: null, H20: 25, D30: '表の外（セルが無い行）' } },
    { label: '本物の百万石', file: path.join(LOCAL, 'x'), sheet: 'ラージ個人戦申込書', out: 'local-shrink.xlsx', local: true,
      writes: { C14: '山田 太郎（とても長い名前のつもり）', C15: '山田 花子', F14: '男', K14: 77 } }
  ];
  var localFile = fs.existsSync(LOCAL) && fs.readdirSync(LOCAL).filter(function (x) { return /百万石.*\.xlsx$/.test(x); })[0];
  if (localFile) jobs[1].file = path.join(LOCAL, localFile); else jobs.pop();

  return jobs.reduce(function (p, job) {
    return p.then(function () {
      var before;
      return read(job.file).then(function (b0) {
        before = b0;
        return read(job.file);
      }).then(function (book) {
        var written = [];
        Object.keys(job.writes).forEach(function (ref) {
          var v = job.writes[ref];
          if (v === null) return;   // 見出しには書かない（書かないセルの書式が変わらないことを見る）
          var r = X.setCell(book, job.sheet, ref, v, { shrink: true });
          if (r.ok) written.push(r.ref);
        });
        return X.save(book).then(function (bytes) {
          if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
          fs.writeFileSync(path.join(OUT, job.out), bytes);
          return X.open(bytes);
        }).then(function (after) {
          var sb = cellXfsOf(before.parts['xl/styles.xml']), sa = cellXfsOf(after.parts['xl/styles.xml']);
          var added = sa.xfs.slice(sb.xfs.length);
          check(sa.xfs.slice(0, sb.xfs.length).join('') === sb.xfs.join('') && added.length >= 1 && sa.count === sa.xfs.length,
            job.label + ': 元の書式は1つも変わらず、末尾に' + added.length + 'つ足しただけ（count ' + sb.count + '→' + sa.count + '）');
          var outsideCellXfs = function (x) { var c = cellXfsOf(x); return x.slice(0, c.index) + x.slice(c.index + c.whole.length); };
          check(outsideCellXfs(before.parts['xl/styles.xml']) === outsideCellXfs(after.parts['xl/styles.xml']),
            job.label + ': 書式の一覧の cellXfs 以外（フォント・罫線・色など）は変わらない');
          check(added.every(function (x) { return /shrinkToFit="1"/.test(x) && /applyAlignment="1"/.test(x) && !/wrapText="1"/.test(x); }),
            job.label + ': 足した書式はすべて縮小あり・折り返しなし');
          var bad = written.filter(function (ref) { return styleOfCell(after, job.sheet, ref) < sb.xfs.length; });
          eq(bad, [], job.label + ': 書き込んだセルはすべて足した書式を指す');
          var c12Before = styleOfCell(before, job.sheet, 'C12'), c12After = styleOfCell(after, job.sheet, 'C12');
          eq(c12After, c12Before, job.label + ': 書き込んでいないセル（見出し C12）の書式は変わらない');
          // 同じ元の書式を使っていたセルは、同じ写しを指す（写しが増えすぎない）
          var sameBase = written.filter(function (ref) { return styleOfCell(before, job.sheet, ref) === styleOfCell(before, job.sheet, written[0]); });
          check(sameBase.every(function (ref) { return styleOfCell(after, job.sheet, ref) === styleOfCell(after, job.sheet, written[0]); }),
            job.label + ': 元の書式が同じセルは、同じ写しを指す');
          var by = {}; by[job.sheet] = written;
          // 書式の一覧以外は、書いたセルを除いて変わらない（assertPreserved は styles.xml を「変えていない部品」として比べるので、ここでは外して比べる）
          var changed = [];
          before.entries.forEach(function (e) {
            if (e.name === 'xl/styles.xml') return;
            var sheet = before.sheets.filter(function (s) { return s.path === e.name; })[0];
            if (sheet && sheet.name === job.sheet) {
              if (stripCells(before.parts[e.name], written) !== stripCells(after.parts[e.name], written)) changed.push(e.name);
              return;
            }
            if (Buffer.compare(Buffer.from(e.raw), Buffer.from(after.byName[e.name].raw)) !== 0) changed.push(e.name);
          });
          eq(changed, [], job.label + ': 書式の一覧と書いたセル以外は、1バイトも変わらない');
          assertOrdered(after, job.label);
          var vals = {}; written.forEach(function (ref) { vals[ref] = job.writes[ref]; });
          expectForExcel.push({ file: job.out, sheet: job.sheet, cells: vals, shrink: written });
        });
      });
    });
  }, Promise.resolve());
}

// ===== 郵便番号から住所 =====
function postalSection() {
  section('9. 郵便番号から住所（tools/make-postal.js の変換・entry-postal.js の引き当て）');

  // --- 入力の受け付け ---
  eq(['924-0001', '〒９２４－０００１', '924 0001', '９２４ー０００１', '9240001'].map(P.normalize),
    ['9240001', '9240001', '9240001', '9240001', '9240001'], '郵便番号: ハイフン・全角・〒・空白・長音の入力を7桁にする');
  eq(['92400', '92400012', '924-000a', '', null].map(P.normalize), [null, null, null, null, null], '郵便番号: 7桁にならない入力は受け付けない');

  // --- 町域名から、住所に書かない文字を取り除く ---
  var ct = MAKE_POSTAL.cleanTown;
  eq([ct('札幌市中央区', '以下に掲載がない場合'), ct('岡谷市', '岡谷市の次に番地がくる場合'), ct('利島村', '利島村一円')],
    ['', '', ''], '決まり文句（以下に掲載がない場合・○○の次に番地がくる場合・○○村一円）は町域を空にする');
  eq(ct('犬上郡多賀町', '一円'), '一円', '★ 多賀町の「一円」は本当の地名なので残す');
  eq([ct('札幌市南区', '常盤（その他）'), ct('名古屋市中村区', '名駅ミッドランドスクエア（高層棟）（１階）'),
      ct('宮古市', '川井（第９地割〜第１１地割）'), ct('白山市', '八田町')],
    ['常盤', '名駅ミッドランドスクエア', '川井', '八田町'], '括弧書きは括弧から後ろを取り除く');

  // --- 変換（架空の行で） ---
  var row = function (code, pref, city, town, upd) {
    return ['00000', '"' + code.slice(0, 3) + '  "', '"' + code + '"', '"ア"', '"イ"', '"ウ"',
      '"' + pref + '"', '"' + city + '"', '"' + town + '"', '0', '0', '0', '0', upd || '0', '0'].join(',');
  };
  var csv = String.fromCharCode(0xFEFF) + [
    row('9240001', '石川県', '白山市', '八田町'),
    row('2600822', '千葉県', '千葉市中央区', '蘇我'),
    row('2600822', '千葉県', '千葉市中央区', '蘇我町'),
    row('9806101', '宮城県', '仙台市青葉区', '中央アエル（１階）'),
    row('9806101', '宮城県', '仙台市青葉区', '中央アエル（地階・階層不明）'),
    row('1900100', '東京都', 'あきる野市', '以下に掲載がない場合'),
    row('1900100', '東京都', '西多摩郡日の出町', '以下に掲載がない場合'),
    row('9240002', '石川県', '白山市', '八田中町', '2')
  ].join('\r\n') + '\r\n';
  var built = MAKE_POSTAL.build(csv, '2026-08-31');
  eq(Object.keys(built).sort(), ['1', '2', '9'], '変換: 先頭1桁ごとに分ける（BOM と CRLF を受け付ける）');
  eq(P.fromChunk(built['9'], '9240001'), [{ pref: '石川県', city: '白山市', town: '八田町' }], '変換: 1つの番号に1つの町域');
  eq(P.fromChunk(built['9'], '9240002'), [], '変換: 廃止（更新フラグ 2）の行は入れない');
  eq(P.fromChunk(built['2'], '2600822').map(function (c) { return c.town; }), ['蘇我', '蘇我町'], '変換: 1つの番号に町域が2つあれば、候補を2つとも残す');
  eq(P.fromChunk(built['9'], '9806101').map(function (c) { return c.town; }), ['中央アエル'], '変換: 括弧を取り除いて同じになった候補は1つにする');
  eq(P.fromChunk(built['1'], '1900100').map(function (c) { return c.city + '/' + c.town; }), ['あきる野市/', '西多摩郡日の出町/'],
    '変換: 市区町村から違う候補も残す');
  eq(built['9'].places, [['石川県', '白山市'], ['宮城県', '仙台市青葉区']], '変換: 都道府県と市区町村の組は1回だけ書く');

  // --- 置いてあるデータ（entry/postal/） ---
  var POSTAL = path.join(__dirname, '..', 'postal');
  var files = fs.existsSync(POSTAL) ? fs.readdirSync(POSTAL).sort() : [];
  eq(files, ['0.json', '1.json', '2.json', '3.json', '4.json', '5.json', '6.json', '7.json', '8.json', '9.json', 'rev'],
    'entry/postal/ に 0.json〜9.json と rev/ がそろっている（ほかのファイルは置かない）');
  var chunkFiles = files.filter(function (f) { return /^\d\.json$/.test(f); });
  if (chunkFiles.length !== 10) return Promise.resolve();
  var chunks = {};
  chunkFiles.forEach(function (f) { chunks[f[0]] = JSON.parse(fs.readFileSync(path.join(POSTAL, f), 'utf8')); });
  var updates = Object.keys(chunks).map(function (d) { return chunks[d].updated; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
  check(updates.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(updates[0]), 'データ: 10個とも同じ更新日（' + updates.join(',') + '）');
  var total = 0, leftovers = [];
  Object.keys(chunks).forEach(function (d) {
    var c = chunks[d];
    Object.keys(c.codes).forEach(function (k) {
      total++;
      c.codes[k].forEach(function (e) {
        if (/[（）]|以下に掲載がない場合|の次に番地がくる場合/.test(e[1]) || !c.places[e[0]]) leftovers.push(d + k + ':' + e[1]);
      });
    });
  });
  check(total > 100000, 'データ: 郵便番号が10万個より多い（' + total + ' 個。途中で切れていない）');
  eq(leftovers.slice(0, 5), [], 'データ: 括弧書き・決まり文句が残っていない／市区町村の番号が壊れていない');

  var fromFiles = function (d) { return Promise.resolve(chunks[d]); };
  var townsOf = function (r) { return r.candidates.map(function (c) { return c.pref + c.city + '|' + c.town; }); };
  return P.lookup('924-0001', fromFiles).then(function (r) {
    eq([r.code, townsOf(r)], ['9240001', ['石川県白山市|八田町']], '引き当て: 924-0001 → 石川県 白山市 八田町');
    return P.lookup('〒522-0317', fromFiles);
  }).then(function (r) {
    eq(townsOf(r), ['滋賀県犬上郡多賀町|一円'], '引き当て: 522-0317 → 多賀町 一円（本当の地名）');
    return P.lookup('2600822', fromFiles);
  }).then(function (r) {
    eq(townsOf(r), ['千葉県千葉市中央区|蘇我', '千葉県千葉市中央区|蘇我町'], '引き当て: 260-0822 → 候補が2つ');
    return P.lookup('1900100', fromFiles);
  }).then(function (r) {
    eq(townsOf(r), ['東京都あきる野市|', '東京都西多摩郡日の出町|'], '引き当て: 190-0100 → 市区町村から違う候補が2つ（町域は空）');
    return P.lookup('060-0000', fromFiles);
  }).then(function (r) {
    eq(townsOf(r), ['北海道札幌市中央区|'], '引き当て: 060-0000 → 札幌市中央区（以下に掲載がない場合 → 町域は空）');
    return P.lookup('9999999', fromFiles);
  }).then(function (r) {
    eq(r.candidates, [], '引き当て: 無い郵便番号は候補0');
    return P.lookup('92400', fromFiles).then(function () { bad('7桁でない入力が通った'); }, function (e) { eq(e.code, 'postal-bad', '引き当て: 7桁でない入力は postal-bad'); });
  }).then(function () {
    var calls = 0;
    var failing = function () { calls++; return Promise.reject(new Error('offline')); };
    return P.lookup('3000000', failing).then(function () { bad('読めないのに通った'); }, function (e) {
      eq(e.code, 'postal-load', '引き当て: データを読めなければ postal-load');
      return P.lookup('3000000', fromFiles).then(function (r) {
        check(r.candidates.length >= 1 && calls === 1, '引き当て: 読めなかった桁は覚えず、次に入れ直せば読みに行く');
      }, function () { bad('引き当て: 読めなかった桁を覚えてしまい、入れ直しても読みに行かない'); });
    }).then(function () {
      return P.lookup('3000000', failing).then(function () {
        eq(calls, 1, '引き当て: 読めた桁は覚えていて、2回は読みに行かない');
      }, function () { bad('引き当て: 読めたはずの桁で失敗した（読みに行った回数 ' + calls + '）'); });
    });
  });
}

// ===== 住所 → 郵便番号（逆引き） =====
function revSection() {
  section('9b. 住所から郵便番号（逆引き）');

  eq([P.prefCode('石川県'), P.prefCode('北海道'), P.prefCode('沖縄県'), P.prefCode('ほげ県'), P.prefCode('')],
    ['17', '01', '47', null, null], '都道府県名 → ファイルの番号（全国地方公共団体コードの上2桁）');

  // 変換（架空の行で）
  var row = function (jis, code, pref, city, town) {
    return [jis + '000', '"' + code.slice(0, 3) + '  "', '"' + code + '"', '"ア"', '"イ"', '"ウ"',
      '"' + pref + '"', '"' + city + '"', '"' + town + '"', '0', '0', '0', '0', '0', '0'].join(',');
  };
  var csv = [
    row('17', '9240001', '石川県', '白山市', '八田町'),
    row('13', '1000013', '東京都', '千代田区', '霞が関（次のビルを除く）'),
    row('13', '1006001', '東京都', '千代田区', '霞が関霞が関ビル（１階）'),
    row('12', '2600822', '千葉県', '千葉市中央区', '蘇我'),
    row('12', '2600823', '千葉県', '千葉市中央区', '蘇我（丁目）')
  ].join('\r\n') + '\r\n';
  var rev = MAKE_POSTAL.buildRev(csv, '2026-08-31');
  eq(Object.keys(rev).sort(), ['12', '13', '17'], '逆引き: 都道府県ごとに分ける');
  eq(P.fromPrefData(rev['17'], '白山市八田町1-2-3'), { matched: '白山市八田町', candidates: [{ code: '9240001', note: '' }] },
    '★ 番地が付いていても、町名の部分で当たる');
  eq(P.fromPrefData(rev['12'], '千葉市中央区蘇我5-1').candidates.map(function (c) { return c.code; }), ['2600822', '2600823'],
    '★ 同じ町名に郵便番号が2つ以上あれば、候補をすべて返す（画面で選ばせる）');
  eq(P.fromPrefData(rev['13'], '千代田区霞が関霞が関ビル3階').matched, '千代田区霞が関霞が関ビル',
    '★ いちばん長く前から一致する住所を採る（ビル名のほうが町名より長い）');
  eq(P.fromPrefData(rev['13'], '千代田区霞が関1-1-1').candidates[0].note, '（次のビルを除く）',
    '逆引きでは但し書き（括弧書き）を残す（どの番号か選ぶ手がかり）');
  eq(P.fromPrefData(rev['17'], '金沢市どこか1-1'), null, '当たらなければ null');
  eq(P.fromPrefData(rev['17'], '白山市八田町１ー２'), { matched: '白山市八田町', candidates: [{ code: '9240001', note: '' }] },
    '全角の数字が混じっても当たる');

  // 置いてあるデータ
  var REV = path.join(__dirname, '..', 'postal', 'rev');
  var revFiles = fs.existsSync(REV) ? fs.readdirSync(REV).sort() : [];
  eq(revFiles.length, 47, 'entry/postal/rev/ に47都道府県ぶんある');
  eq(revFiles.filter(function (f) { return !/^\d{2}\.json$/.test(f); }), [], 'rev/ にはファイル名が2桁の数字のものだけ');
  if (revFiles.length !== 47) return Promise.resolve();

  var loadPref = function (code) {
    return Promise.resolve(JSON.parse(fs.readFileSync(path.join(REV, code + '.json'), 'utf8')));
  };
  var cases = [
    ['石川県', '白山市八田町1-2-3', '9240001'],
    ['石川県', '小松市白江町ろ11', '9230811'],
    ['石川県', 'かほく市宇野気ニ100', '9291125'],
    ['富山県', '高岡市末広町1-8', '9330023'],
    ['大阪府', '大阪市北区梅田1-1-1', '5300001']
  ];
  return cases.reduce(function (p, c) {
    return p.then(function () {
      return P.lookupPostal(c[0], c[1], loadPref).then(function (r) {
        eq(r && r.candidates[0].code, c[2], '引き当て: ' + c[0] + c[1] + ' → ' + c[2]);
      });
    });
  }, Promise.resolve()).then(function () {
    return P.lookupPostal('ほげ県', 'どこか1-1', loadPref).then(function () { bad('知らない都道府県が通った'); },
      function (e) { eq(e.code, 'postal-no-pref', '知らない都道府県は postal-no-pref'); });
  }).then(function () {
    var calls = 0;
    var counting = function (code) { calls++; return loadPref(code); };
    return P.lookupPostal('東京都', '千代田区霞が関1-1', counting).then(function (r) {
      check(r && r.candidates.length >= 1, '引き当て: 東京都千代田区霞が関');
      return P.lookupPostal('東京都', '港区赤坂1-1', counting);
    }).then(function () {
      eq(calls, 1, '読んだ都道府県は覚えていて、2回は読みに行かない');
    });
  });
}

// ===== 出欠システムから名前を取り込む =====
function attendSection() {
  section('9c. 出欠システムから名前を取り込む（entry-attend.js）');

  eq(['abcdefghij', 'https://app.dropper-tools.com/attend/?s=abcdefghij', 'attend/?s=abcdefghij#my',
      'https://app.dropper-tools.com/attend/', 'abc', ''].map(AT.parseOrgId),
    ['abcdefghij', 'abcdefghij', 'abcdefghij', '', '', ''], '団体ID: URL からも取り出す。短すぎる・無いものは受け付けない');

  // 出欠システムの応答（本物と同じ形の、架空の返事）
  var answer = { ok: true, org: '架空ラージボール卓球クラブ', lang: 'ja', members: [
    { name: '山田 太郎', gender: '男', note: '', retired: false },
    { name: '鈴木 花子', gender: '女', note: '', retired: false },
    { name: '斉藤 光', gender: '', note: '', retired: false },
    { name: '  ', gender: '男', note: '', retired: false }
  ] };
  var calls = [];
  var fake = function (id) { calls.push(id); return Promise.resolve(answer); };

  return AT.fetchMembers('https://app.dropper-tools.com/attend/?s=abcdefghij', fake).then(function (r) {
    eq(calls, ['abcdefghij'], '★ 送るのは団体IDだけ');
    eq(r.org, '架空ラージボール卓球クラブ', '団体名を受け取る');
    eq(r.members.map(function (m) { return m.name + '/' + m.gender; }),
      ['山田 太郎/男子', '鈴木 花子/女子', '斉藤 光/'], '性別は男子・女子のシートに読み替える。名前が空の人は捨てる');
    return AT.fetchMembers('abc', fake).then(function () { bad('短すぎるIDが通った'); },
      function (e) { eq(e.code, 'attend-bad-id', '団体IDが読めなければ attend-bad-id'); });
  }).then(function () {
    var notFound = function () { return Promise.resolve({ ok: false, notFound: true, code: 'orgNotFound' }); };
    return AT.fetchMembers('abcdefghij', notFound).then(function () { bad('無い団体が通った'); },
      function (e) { eq(e.code, 'attend-not-found', '見つからない団体は attend-not-found'); });
  }).then(function () {
    var offline = function () { return Promise.reject(new Error('offline')); };
    return AT.fetchMembers('abcdefghij', offline).then(function () { bad('通信できないのに通った'); },
      function (e) { eq(e.code, 'attend-load', '問い合わせられなければ attend-load'); });
  }).then(function () {
    var broken = function () { return Promise.resolve({ ok: false, code: 'somethingElse' }); };
    return AT.fetchMembers('abcdefghij', broken).then(function () { bad('ok でない返事が通った'); },
      function (e) { eq(e.code, 'attend-load', 'ok でない返事も止める'); });
  }).then(function () {
    // ★ 2026-09-16 に踏んだ: 合図を action ではなく a と書いていたので、API が「行事の一覧」を返し、
    //   ok:true のまま名簿が空（0人）に見えていた。返事の形まで見ないと、間違いに気づけない
    var eventsAnswer = function () { return Promise.resolve({ ok: true, org: '架空クラブ', lang: 'ja', member: null, events: [] }); };
    return AT.fetchMembers('abcdefghij', eventsAnswer).then(function () { bad('名簿でない返事が「0人」として通った'); },
      function (e) { eq(e.code, 'attend-bad-answer', '★ 名簿とは違う返事（行事の一覧）は、0人ではなく間違いとして止める'); });
  }).then(function () {
    // 呼び出しの合図が action=members であること（a=members だと上の間違いが起きる）
    var src = fs.readFileSync(path.join(__dirname, '..', 'entry-attend.js'), 'utf8');
    check(src.indexOf("'?action=members&s='") >= 0 && src.indexOf("'?a=members&s='") < 0,
      '★ 出欠システムを呼ぶ合図は action=members');
  });
}

// ===== 名簿ファイル =====
// 人・団体・住所・電話番号はすべて架空
function bookSection() {
  section('10. 名簿ファイル（作る・読む・申込書に書く形にする）');

  var data = {
    org: '架空ラージボール卓球クラブ',
    today: '2026-09-16',
    extraHeaders: { 男子: ['備考'], 女子: [] },
    people: {
      男子: [
        { family: '山田', given: '太郎', kanaFamily: 'ヤマダ', kanaGiven: 'タロウ', birth: { y: 1950, m: 4, d: 1 },
          postal: '924-0001', pref: '石川県', address: '白山市八田町1-2-3', phone: '090-0000-0001', extras: ['会計'] },
        { family: '髙橋', given: '一郎', kanaFamily: 'タカハシ', kanaGiven: 'イチロウ', birth: { y: 1948, m: 12, d: 25 },
          postal: '060-0000', pref: '北海道', address: '札幌市中央区1-1', phone: '090-0000-0003', extras: [] },
        { family: '佐藤', given: '実', kanaFamily: 'サトウ', kanaGiven: 'ミノル', birth: null, birthText: '',
          postal: '', pref: '', address: '', phone: '', extras: [] }
      ],
      女子: [
        { family: '鈴木', given: '花子', kanaFamily: 'スズキ', kanaGiven: 'ハナコ', birth: { y: 1952, m: 5, d: 10 },
          postal: '924-0002', pref: '石川県', address: '白山市八田中町4-5', phone: '090-0000-0002', extras: [] }
      ]
    }
  };

  eq(B.fileName('架空ラージボール卓球クラブ'), '名簿_架空ラージボール卓球クラブ.xlsx', 'ファイル名は団体名から作る');
  eq(B.fileName('  '), '名簿.xlsx', '団体名が空ならファイル名は 名簿.xlsx');
  eq(B.fileName('架空/クラブ:1'), '名簿_架空クラブ1.xlsx', 'ファイル名に使えない文字は落とす');

  var first;
  return B.make(data).then(function (bytes) {
    first = bytes;
    fs.writeFileSync(path.join(OUT, 'roster-book.xlsx'), Buffer.from(bytes));
    return X.open(bytes);
  }).then(function (book) {
    eq(X.sheetNames(book), ['男子', '女子', 'この名簿について'], 'シートは 男子・女子・この名簿について');
    var got = B.read(book);
    check(got.ok, '作った名簿ファイルを読める');
    eq([got.org, got.version], ['架空ラージボール卓球クラブ', 1], '団体名と形式の版を読み取る');
    eq(got.extraHeaders, { 男子: ['備考'], 女子: [] }, '自分で足した列の見出しを読み取る');
    eq(got.people['男子'].map(function (p) { return p.family + p.given; }), ['山田太郎', '髙橋一郎', '佐藤実'], '男子の並びは入れた順のまま');
    var t = got.people['男子'][0];
    eq([t.kanaFamily, t.kanaGiven, t.postal, t.pref, t.address, t.phone, t.extras[0], t.row],
      ['ヤマダ', 'タロウ', '924-0001', '石川県', '白山市八田町1-2-3', '090-0000-0001', '会計', 2], '1人ぶんの中身が往復する');
    eq(got.people['男子'][0].birth, { y: 1950, m: 4, d: 1 }, '生年月日は Excel の日付として往復する');
    eq(got.people['男子'][1].postal, '060-0000', '★ 郵便番号の先頭の 0 が消えない（文字として書く）');
    // ★ 往復するだけでは足りない。Excel で開いたときの持ち方（書式）まで見る
    var byRef = {};
    X.cells(book, '男子').forEach(function (c) { byRef[c.ref] = c; });
    var numFmtOf = function (style) {
      var xfs = (/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(book.parts['xl/styles.xml']) || ['', ''])[1];
      var list = xfs.match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) || [];
      var m = /numFmtId="(\d+)"/.exec(list[Number(style || 0)] || '');
      return m ? m[1] : '';
    };
    eq([numFmtOf(byRef['F2'].style), numFmtOf(byRef['I2'].style)], ['49', '49'],
      '★ 郵便番号と電話は「文字」の書式（Excel で入れ直しても先頭の 0 が消えないように）');
    check(byRef['E2'].isDate && byRef['E2'].value === B.serialOf({ y: 1950, m: 4, d: 1 }),
      '★ 生年月日は Excel の日付（数値＋日付の書式）で入っている（並べ替えや計算ができるように）');
    eq(got.people['女子'][0].phone, '090-0000-0002', '電話の先頭の 0 が消えない');
    eq(got.problems.map(function (p) { return p.family + p.given + ':' + p.problems.join('+'); }),
      ['佐藤実:birth-empty+address-empty+phone-empty'], '空欄のある人だけを知らせる（止めはしない）');

    // 申込書に書く形
    var roster = B.toRoster(got.people);
    eq(roster.members.map(function (m) { return m.name + '/' + m.gender; }),
      ['山田 太郎/男', '髙橋 一郎/男', '佐藤 実/男', '鈴木 花子/女'], '★ 性別はシートから決まる（性別の列は無い）');
    eq(roster.members[0].kana, 'ヤマダ タロウ', 'フリガナは姓と名をつなげる');
    eq(roster.members[0].address, '石川県白山市八田町1-2-3', '住所は都道府県とそれ以下をつなげる（1つの欄しかない申込書のため）');
    eq(R.matchName(roster, '山田太郎').status, 'exact', '名前の突き合わせに使える');
    eq(R.matchName(roster, '高橋一郎').status, 'variant', '異体字（髙/高）の突き合わせも効く');
    // ★ 画面で足したばかりの人は「気になる点」をまだ持っていない。それでも突き合わせに使えること
    //   （2026-09-16、ここで止まって③に反映されない不具合があった）
    var justAdded = { family: '新井', given: '一', kanaFamily: '', kanaGiven: '', birth: null, birthText: '',
      postal: '', pref: '', address: '', phone: '', extras: [] };
    var r2 = B.toRoster({ 男子: [justAdded], 女子: [] });
    eq([r2.members.length, r2.members[0].name, r2.members[0].gender, r2.members[0].problems.length > 0],
      [1, '新井 一', '男', true], '★ 画面で足したばかりの人（気になる点をまだ持たない）でも突き合わせに使える');

    var filled = R.fill(roster.members[3], { fields: [{ ref: 'C5', field: 'gender' }, { ref: 'D5', field: 'age' }] }, { baseDate: BASE });
    eq(filled.writes.map(function (w) { return w.ref + '=' + w.value; }), ['C5=女', 'D5=74'], '性別と年齢を申込書に書く値にできる');

    return B.make(got).then(function (again) {
      eq(Buffer.compare(Buffer.from(again), Buffer.from(first)), 0, '読んでから作り直すと、1バイトも変わらない');
    });
  }).then(function () {
    // 人が Excel で直したあと（生年月日を文字で書く・空行を空ける・余分な列を足す）
    return X.open(first).then(function (book) {
      X.setCell(book, '男子', 'E4', 'S30.2.28');
      X.setCell(book, '女子', 'A4', '田中');
      X.setCell(book, '女子', 'B4', '幸子');
      return X.save(book);
    }).then(function (bytes) { return X.open(bytes); }).then(function (book) {
      var got = B.read(book);
      check(got.ok, 'Excel で直したあとでも読める');
      eq(got.people['男子'][2].birth, { y: 1955, m: 2, d: 28 }, '★ 生年月日を文字（S30.2.28）で直しても読む');
      eq(got.people['女子'].map(function (p) { return p.family + p.given + '@' + p.row; }), ['鈴木花子@2', '田中幸子@4'],
        '空けた行は飛ばし、その下の人も読む');
    });
  }).then(function () {
    // 見出しを変えたファイルは読まない
    return X.open(first).then(function (book) {
      X.setCell(book, '男子', 'C1', 'ふりがな');
      return X.save(book);
    }).then(function (bytes) { return X.open(bytes); }).then(function (book) {
      var got = B.read(book);
      eq([got.ok, got.code], [false, 'book-header'], '★ 見出しを変えたファイルは読まない（どの列が何かを推測しない）');
      check(/男子/.test(got.detail) && /C1/.test(got.detail), 'どのシートのどのセルが違うかを知らせる（' + got.detail + '）');
    });
  }).then(function () {
    // 形式の版が新しいファイル
    return X.open(first).then(function (book) {
      X.setCell(book, B.INFO_SHEET, 'B2', '2');
      return X.save(book);
    }).then(function (bytes) { return X.open(bytes); }).then(function (book) {
      eq(B.read(book).code, 'book-newer', '新しい版の名簿ファイルは、読まずに知らせる');
    });
  }).then(function () {
    // 名簿ではない Excel（申込書）
    return read(path.join(FIX, 'form-a-all-fields.xlsx')).then(function (book) {
      eq(B.read(book).code, 'book-sheets', '名簿でない Excel は「男子・女子のシートが無い」と知らせる');
    });
  }).then(function () {
    var vals = {};
    vals['A2'] = '山田'; vals['B2'] = '太郎'; vals['C2'] = 'ヤマダ';
    vals['E2'] = String(B.serialOf({ y: 1950, m: 4, d: 1 })); vals['F2'] = '924-0001'; vals['I2'] = '090-0000-0001';
    expectForExcel.push({ file: 'roster-book.xlsx', sheet: '男子', cells: vals });
  });
}

main().catch(function (e) { console.error(e); process.exit(1); });
