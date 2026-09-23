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
eval(fs.readFileSync(path.join(__dirname, '..', 'entry-blank.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'entry-view.js'), 'utf8'));
var X = window.EntryXlsx, R = window.EntryRoster, RU = window.EntryRules, M = window.EntryMap,
    P = window.EntryPostal, B = window.EntryBook, AT = window.EntryAttend, B_ = window.EntryBlank;
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
    // ★ styles.xml は「書式の写しを末尾に足す」だけ変わってよい（縮小して全体を表示／日付の書式を外す）。
    //   足しただけであることをここで確かめる。元の <xf> を1つでも書き換えたら落ちる
    if (e.name === 'xl/styles.xml') {
      var sb = cellXfsOf(before.parts[e.name]), sa = cellXfsOf(after.parts[e.name]);
      var outside = function (x) { var c = cellXfsOf(x); return x.slice(0, c.index) + x.slice(c.index + c.whole.length); };
      var appendOnly = sa.xfs.slice(0, sb.xfs.length).join('') === sb.xfs.join('') &&
        sa.count === sa.xfs.length && outside(before.parts[e.name]) === outside(after.parts[e.name]);
      if (!appendOnly) changed.push(e.name + '（書式の一覧が、末尾に足す以外の形で変わった）');
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

    // ★ 住所は、いちばん多い都道府県を省いて市区町村から書く（2026-09-18、本人の要望）
    var addrOf = function (m, fmt, ctx) {
      return R.fill(m, { fields: [{ ref: 'A1', field: 'address', fmt: fmt }] }, ctx).writes[0].value;
    };
    var yamada = roster.members[0], tanaka = roster.members[4];   // 石川県 / 福井県
    eq([addrOf(yamada, 'plain', { dropPref: '石川県' }), addrOf(tanaka, 'plain', { dropPref: '石川県' })],
      ['金沢市テスト町1-1', '福井県福井市サンプル7-7'], '住所: 多い県は省き、ちがう県の人には県名を付ける');
    eq(addrOf(yamada, 'keep-pref', { dropPref: '石川県' }), '石川県金沢市テスト町1-1', '住所: 「都道府県から書く」を選べば省かない');
    eq(addrOf(yamada, 'plain', {}), '石川県金沢市テスト町1-1', '住所: 省く県が決まっていなければ、そのまま書く');
    eq(addrOf(yamada, 'with-postal', { dropPref: '石川県' }), '〒920-0001 金沢市テスト町1-1', '住所: 〒から書くときも県名を省く');

    // ★ 見出しに空白が入っていても、見出しは名前として拾わない（2026-09-18、かほく市長杯の様式で発覚）
    var headerCells = [
      { ref: 'B4', row: 4, col: 2, text: '氏　名' },
      { ref: 'B5', row: 5, col: 2, text: '山田 太郎' },
      { ref: 'B6', row: 6, col: 2, text: '鈴木 和子' },
      { ref: 'C4', row: 4, col: 3, text: '生年月日' }
    ];
    var hFound = R.findNames(headerCells, roster);
    eq([hFound.names.length, hFound.suspects.length], [2, 0],
      '★ 名前の並びのすぐ上にある見出し「氏　名」を、名前として拾わない（空白を取ってから見出しの語を見る）');

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
    .then(function () { return blankSection(roster); })
    .then(function () { return viewSection(); })
    .then(function () { return eventSection(); })
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
      // ★ G7 は日付の書式（yyyy/m/d）の年齢の欄。数をそのまま書くと Excel が日付として見せてしまう
      //   （本物のスポレク参加申込書で「1900-02-29」と出た）。書式の写しを作って日付の書式を外す
      var byRef = {};
      X.cells(after, '申込書').forEach(function (c) { byRef[c.ref] = c; });
      var fmtOf = function (style) {
        var xfs = cellXfsOf(after.parts['xl/styles.xml']).xfs;
        return (/numFmtId="(\d+)"/.exec(xfs[Number(style || 0)] || '') || [])[1] || '0';
      };
      check(!byRef['G7'].isDate && byRef['G7'].value === 74, '★ 日付の書式の欄に年齢を書いても、日付にならない（1900-02-29 にならない）');
      eq(fmtOf(byRef['G7'].style), '0', '★ そのセルだけ、日付の書式を外した写しを指す');
      // 元の書式を書き換えていないことは、上の「書き換えたセル以外は変わっていない」が見ている
      // （styles.xml は末尾に足す形でしか変わってはいけない）
      eq(fmtOf(byRef['G6'].style), '0', '元から日付でない年齢の欄は、そのままの書式');
      eq(byRef['F6'].text, '1960年3月3日', '生年月日は文字で書くので、書式の影響を受けない');
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
  check(!/key-modal|entry-ai\.js/.test(html), 'index.html に API キーの入力欄・entry-ai.js が無い（AI を使わないので要らない）');
  // ★ 公開にあたって入れたもの（2026-09-19）。ほかの3本と揃っているか。
  check(/googletagmanager\.com\/gtag\/js\?id=G-PQPKYYYXKG/.test(html), 'index.html に GA4 が入っている（ほかの3本と同じ測定ID）');
  check(/hits\.sh\/app\.dropper-tools\.com\/entry\.svg/.test(html), 'index.html に訪問者カウンターが入っている（区分けは entry）');
  check(!/name="robots"/.test(html), 'index.html に noindex が残っていない（検索に出す）');
  check(/rel="canonical" href="https:\/\/app\.dropper-tools\.com\/entry\/"/.test(html), 'index.html に canonical がある');
  // ★ カウンターは window.LANG より後ろに置くこと。ほかの3本でここを間違え、en/in の訪問が ja に混ざった。
  //   ★ 語ではなく「代入そのもの」と「実際の URL」を見る。注意書きにも window.LANG や hits.sh の語が
  //     出てくるので、語で探すと素通りする（2026-09-19 に踏んだ）。コメントを機械で外すのは
  //     URL の // まで削るので、やらない
  var atLang = html.indexOf('window.LANG =');
  var atHits = html.indexOf('hits.sh/app.dropper-tools.com/entry.svg');
  check(atLang >= 0 && atHits >= 0 && atLang < atHits, '訪問者カウンターは window.LANG を設定したあとに走る');
  // ★ entry-app.js が使う組（class）の見た目が、index.html にあるか（2026-09-22 に踏んだ）。
  //   `.link-btn` を「覚え書きでしか使っていない」と思って消し、本番で「編集」「消す」「↑」「↓」
  //   などが大きなボタンに化けた。index.html だけを検めたのが誤りで、使っていたのは JS のほう。
  //   ★ 見た目の無い組は、増えたときに気づけるよう名前で許す（増やすときは、それでよいか考えること）
  var NO_STYLE = { 'ok-text': 1, 'col-grid': 1, 'col-item': 1, 'val': 1 };
  var appSrc = fs.readFileSync(path.join(__dirname, '..', 'entry-app.js'), 'utf8');
  var style = (html.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
  var usedClasses = {}, clsRe = /class:\s*'([^']*)'/g, cm;
  while ((cm = clsRe.exec(appSrc))) {
    cm[1].split(/\s+/).forEach(function (c) { if (/^[a-z][a-z0-9-]*$/.test(c)) usedClasses[c] = 1; });
  }
  check(Object.keys(usedClasses).length > 50, '組の名前を集められている（集め方が壊れたら気づく）');
  eq(Object.keys(usedClasses).filter(function (c) { return !NO_STYLE[c] && style.indexOf('.' + c) < 0; }), [],
    '★ entry-app.js が使う組は、すべて index.html に見た目がある');

  // ★ 画面が呼ぶ文言（data-i18n）が、すべて辞書にあるか。
  //   無いと、その場に鍵の名前がそのまま出る（「whatCan6」のような字が画面に残る）
  var i18nSrc = fs.readFileSync(path.join(__dirname, '..', 'entry-i18n.js'), 'utf8');
  var wantKeys = {}, keyRe = /data-i18n="([^"]+)"/g, km;
  while ((km = keyRe.exec(html))) wantKeys[km[1]] = 1;
  check(Object.keys(wantKeys).length > 40, '画面が呼ぶ文言を集められている（集め方が壊れたら気づく）');
  eq(Object.keys(wantKeys).filter(function (k) { return i18nSrc.indexOf('\n      ' + k + ':') < 0; }), [],
    '★ 画面が呼ぶ文言は、すべて entry-i18n.js にある');

  // ★ 「何ができる？」はほかの3本と同じもの（2026-09-22、本人の指示で写した）。
  //   ずれていないかは tools/sync-check.js の 8 が見る。ここでは、この画面の側だけを見る
  check(/id="tools-modal"/.test(html) && /id="whatBtn"/.test(html), '「何ができる？」が画面にある');
  check(/data-home="entry"/.test(html), '★ 開いたとき申込書のパネルから見せる（data-home）');
  check(/aria-selected="true"\s+id="tmTabEntry"/.test(html) &&
        /<div class="tm-panel on" data-panel="entry"/.test(html) &&
        (html.match(/class="tm-panel on"/g) || []).length === 1,
    '★ 最初に開いているタブとパネルが申込書（1つだけ）');
  check(/<span class="tm-here"[\s\S]{0,400}?data-panel="entry"/.test(html) === false &&
        /data-panel="entry"[\s\S]*?<span class="tm-here"/.test(html),
    '★ 「いま使っています」の印は申込書のパネルにある');
  check(!/id="tmGoEntry"/.test(html) && /id="tmGoDecide"/.test(html),
    '★ 自分への入口は出さず、決めごとへの入口は出す');
  // ★ 図の組（.sheet .bar .fig）は短い名前。申込書ドロッパーの .sheet は「Excelのシート」で
  //   ③④が使っている。囲いの外に置くと、シートの見出しが78pxの白い箱に化ける（2026-09-22）
  check(!/\n    \.(bar|fig|tbl|chk|cal|bub|sheet\.wide)[ .{]/.test(html),
    '★ ポップアップの図の組は #tools-modal の中だけに効かせてある');
  // .sheet だけは申込書ドロッパー自身も使う（Excel のシート）。図のほうが外に出ていないか見る
  check(/\n    \.sheet \{ margin:0 0 18px; \}/.test(html) && !/\n    \.sheet \{ width:/.test(html),
    '★ 申込書ドロッパー自身の .sheet（Excelのシート）が、図の .sheet に潰されていない');

  // ★ 日本語のみと決めたので、他言語版への指示は書かない（CLAUDE.md「申込書ドロッパーは日本語のみ」）
  // ★ 「hreflang」の語ではなく、実際の属性を見る。説明のコメントに反応してはいけない（2026-09-19 に踏んだ）
  check(!/<link\b[^>]*\bhreflang=/.test(html), 'index.html に hreflang の link が無い（日本語のみなので、他言語版への指示は嘘になる）');
  // コメント（<!-- --> の中）を取り除いてから見る。説明の文に反応させない
  check(!/試作/.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'index.html に「試作」の表示が残っていない');
  // ★ noindex を外しても、sitemap に無いと検索に見つけてもらいにくい（2026-09-20 に入れ忘れた）
  var sm = fs.readFileSync(path.join(__dirname, '..', '..', 'sitemap.xml'), 'utf8');
  check(sm.indexOf('<loc>https://app.dropper-tools.com/entry/</loc>') >= 0, 'sitemap.xml に /entry/ がある');

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
    // ★ 2026-09-20 まで「満年齢は見落とす」を期待値にしていた。年齢の見出しを作り直して読めるようにした
    { label: '言い回し（よみがな・ご住所・連絡先（携帯）・満年齢）',
      headers: { C6: 'よみがな', E6: '生年月日', F6: '満年齢', H6: 'ご住所', I6: '連絡先（携帯）' },
      want: 'C:kana D:gender(kanji) E:birth(wareki) F:age G:postal H:address(plain) I:phone' },
    // ★ 本物の東京都卓球連盟の様式にあった書き方
    { label: '大会年齢（本物の東京都卓球選手権の書き方）',
      headers: { F6: '大会年齢' },
      want: 'C:kana D:gender(kanji) E:birth(seireki-slash) F:age G:postal H:address(plain) I:phone' },
    { label: '性別が「男・女」の1列【見落とす】',
      headers: { D6: '男・女' },
      want: 'C:kana E:birth(seireki-slash) F:age G:postal H:address(plain) I:phone' },
    { label: '見出しに「生年月日（西暦）」',
      headers: { E6: '生年月日（西暦）' },
      want: 'C:kana D:gender(kanji) E:birth(seireki-slash) F:age G:postal H:address(plain) I:phone' },
    { label: '名簿に無い欄（段位・所属クラブ・備考）',
      headers: { C6: '段位', G6: '所属クラブ', I6: '備考' },
      want: 'D:gender(kanji) E:birth(seireki-slash) F:age H:address(plain)' },
    // ★ 2026-09-20 まで「年齢区分に年齢を書く＝誤爆」を期待値にしていた。いまは書かない
    { label: 'まぎらわしい語（年齢区分・緊急連絡先・住所（市町村まで））【年齢区分には書かない】',
      headers: { F6: '年齢区分', I6: '緊急連絡先', H6: '住所（市町村まで）' },
      want: 'C:kana D:gender(kanji) E:birth(seireki-slash) G:postal H:address(plain) I:phone' }
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
    return variant({ C6: 'よみがな', E6: '生年月日', F6: '歳', H6: 'ご住所', I6: '連絡先（携帯）' });
  }).then(function (v) {
    var tb = v.mapping.tables[0];
    eq(M.tableKey(tb), 'B@6', '表の鍵は「名前の列＠見出しの行」');
    eq(tb.cols.map(function (x) { return x.col + ':' + (x.field || '-'); }).join(' '), 'C:kana D:gender E:birth F:- G:postal H:address I:phone',
      '一覧には見出しのある列がすべて並び、決められなかった列（「歳」だけの見出し）は種類なし');
    var r = M.applyOverrides(v.mapping, { 'B@6': { F: 'age' } });
    eq(firstRowItems(v, r.mapping), 'C:kana D:gender(kanji) E:birth(wareki) F:age G:postal H:address(plain) I:phone', '見落とした列（「歳」）を年齢に直すと、書くようになる');
    eq(r.mapping.tables[0].cols.filter(function (x) { return x.col === 'F'; })[0], { col: 'F', header: '歳', near: '歳', field: 'age', overridden: true }, '直した列には印が付く（④で「選び直した列」と出す）');
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
  // ★ 基準日の言い回しは「現在」「時点」だけではない（2026-09-18、かほく市長杯の様式）
  var baseCells = [
    { ref: 'A1', row: 1, col: 1, text: '※年齢の基準は、令和9年4月1日とする。監督と選手を兼ねる場合は、両方に記入してください。' },
    { ref: 'A2', row: 2, col: 1, text: '令和8年4月6日' }   // 申込日。こちらは拾わない
  ];
  eq(M.normalize(RU.map(baseCells, [], { names: [], suspects: [] })).baseDate, { y: 2027, m: 4, d: 1 },
    '★ 「年齢の基準は、令和9年4月1日とする」からも基準日を読む（申込日は拾わない）');

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
      // ★ ダブルスの種目の欄（組ごとに1つ。2026-09-18）
      if (/百万石 個人戦/.test(label)) {
        eq(res.groups.map(function (g) { return g.event; }), ['M14', 'M16'], label + ': ダブルスの種目の欄（組ごと）');
      }
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
    // ★ 大会名と日付を書き換えた様式（協会の様式は毎年こうなる）。鍵は同じでなければならない
    //   （2026-09-20。前は文字ぜんぶのハッシュだったので、ここで別の様式になり、
    //    覚えた選び直しが毎年捨てられていた）
    X.setCell(book, '個人戦', 'B1', '第〇〇回 テストオープン卓球大会（ラージ）参加申込書（来年ぶん）');
    X.setCell(book, '個人戦', 'B22', '（年齢は、令和１０年４月１日現在をご記入下さい）');
    var cells3 = X.cells(book, '個人戦');
    var found3 = R.findNames(cells3, roster);
    // ★ 見出しの語を変えた様式。こちらは別の鍵でなければならない（別の様式に前の直しを当てない）
    X.setCell(book, '個人戦', 'F12', '学年');
    var cells4 = X.cells(book, '個人戦');
    var found4 = R.findNames(cells4, roster);
    function keyOf(cells, bk, sheet, found) {
      return M.formKey(M.normalize(RU.map(cells, X.merges(bk, sheet), found)));
    }
    return Promise.all([
      keyOf(HAND.B.cells, HAND.B.book, '個人戦', HAND.B.found),
      keyOf(cells2, book, '個人戦', found2),
      keyOf(HAND.A.cells, HAND.A.book, '申込書', HAND.A.found),
      keyOf(cells3, book, '個人戦', found3),
      keyOf(cells4, book, '個人戦', found4)
    ]);
  }).then(function (keys) {
    check(keys[0] === keys[1], '同じ様式なら、書いた名前や人数が違っても同じ鍵');
    check(keys[0] !== keys[2], '別の様式なら別の鍵');
    check(keys[0] === keys[3], '★ 大会名と日付が変わっても、表の形が同じなら同じ鍵');
    check(keys[0] !== keys[4], '★ 見出しの語が変われば別の鍵（別の様式に前の直しを当てない）');
    var store = {};
    global.localStorage = { getItem: function (k) { return store[k] || null; }, setItem: function (k, v) { store[k] = String(v); } };
    M.prefs.put(keys[0], { fmt: { birthYear: 'seireki' } });
    eq(M.prefs.get(keys[1]), { fmt: { birthYear: 'seireki' } }, '選び直した書き方を、同じ様式の2回目に取り出せる');
    check(!/山田|伊藤|田中|渡辺|吉田|1950/.test(store.dropper_entry_form_prefs), '覚えた中身に名前も生年月日も入っていない');
    delete global.localStorage;
    return tinyKeys();
  });

  // ★ 鍵に何が入っているかを1つずつ確かめる（手で作った小さな様式）。
  //   ゆるいと別の様式に前の直しを当ててしまい（誤爆）、きつすぎると毎年覚え直しになる
  function tinyKeys() {
    function cellsOf(o) {
      var c = [], head = o.headerRow, nc = o.nameCol, sc = o.sexCol || (o.nameCol + 1);
      function put(col, row, text) { c.push({ ref: X.toRef(col, row), row: row, col: col, text: text }); }
      put(1, 1, o.title);
      put(sc, head - 1, o.note);                 // 見出しの1つ上（上まで辿ると見出しに混じる行）
      put(1, head, 'No');
      put(nc, head, '氏名');
      put(sc, head, o.sex);
      for (var i = 1; i <= 3; i++) { put(1, head + i, String(i)); put(nc, head + i, '山田 太郎'); }
      if (o.twice) {
        var h2 = head + 6;
        put(1, h2, 'No'); put(nc, h2, '氏名'); put(sc, h2, o.sex);
        for (i = 1; i <= 3; i++) { put(1, h2 + i, String(i)); put(nc, h2 + i, '山田 花子'); }
      }
      return c;
    }
    function foundOf(o) {
      var names = [], head = o.headerRow, nc = o.nameCol;
      function add(row) { names.push({ refs: [X.toRef(nc, row)], row: row, col: nc, text: 'x', match: { status: 'exact', member: null } }); }
      for (var i = 1; i <= 3; i++) add(head + i);
      if (o.twice) for (i = 1; i <= 3; i++) add(head + 6 + i);
      return { names: names, suspects: [] };
    }
    function keyOf(over) {
      var o = { title: '第1回 テスト大会 参加申込書', note: '会場：テスト体育館', headerRow: 5, nameCol: 3, sex: '性別' };
      Object.keys(over || {}).forEach(function (k) { o[k] = over[k]; });
      return M.formKey(M.normalize(RU.map(cellsOf(o), [], foundOf(o))));
    }
    return Promise.all([keyOf(), keyOf({ title: '第2回 べつのテスト大会 参加申込書' }),
      keyOf({ note: '会場：ちがう体育館' }), keyOf({ headerRow: 7 }), keyOf({ nameCol: 4 }),
      keyOf({ sex: '学年' }), keyOf({ twice: true }),
      keyOf({ nameCol: 3, sexCol: 5 }), keyOf({ nameCol: 4, sexCol: 5 })]).then(function (k) {
      check(k[0] === k[1], '大会名が変わっても同じ鍵');
      check(k[0] === k[2], '★ 見出しの上の行（会場など）が変わっても同じ鍵（いちばん近い見出しだけを見る）');
      check(k[0] !== k[3], '★ 見出しの行が変われば別の鍵');
      check(k[0] !== k[4], '★ 名前の列が変われば別の鍵');
      check(k[0] !== k[5], '見出しの語が変われば別の鍵');
      check(k[0] !== k[6], '★ 同じ表が2つある様式は、1つの様式と別の鍵');
      // ★ ほかの列をそのままにして、名前の列だけを動かす（鍵に名前の列が入っているかを見る）
      check(k[7] !== k[8], '★ ほかが同じで名前の列だけ違えば、別の鍵');
    });
  }
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

// ===== ダブルスの種目（組ごとに1つ書く欄） =====
function eventSection() {
  section('12. ダブルスの種目（組ごとの欄）');

  // 架空の様式: C列に名前、L列に合計年齢、M列に種目。どちらも2行ずつ縦に結合（2人1組）
  var cells = [
    { ref: 'C1', row: 1, col: 3, text: '氏名' }, { ref: 'L1', row: 1, col: 12, text: '合計年齢' },
    { ref: 'M1', row: 1, col: 13, text: '種目' },
    { ref: 'C2', row: 2, col: 3, text: '山田 太郎' }, { ref: 'C3', row: 3, col: 3, text: '山田 花子' },
    { ref: 'C4', row: 4, col: 3, text: '田中 誠' }, { ref: 'C5', row: 5, col: 3, text: '加藤 健' }
  ];
  var merges = [{ top: 2, bottom: 3, left: 12, right: 12 }, { top: 2, bottom: 3, left: 13, right: 13 },
                { top: 4, bottom: 5, left: 12, right: 12 }, { top: 4, bottom: 5, left: 13, right: 13 }];
  var names = ['C2', 'C3', 'C4', 'C5'].map(function (ref, i) {
    var row = i + 2;
    return { refs: [ref], row: row, col: 3, text: cells[3 + i].text, match: { status: 'exact', member: null } };
  });
  var mapping = M.normalize(RU.map(cells, merges, { names: names, suspects: [] }));
  var tb = mapping.tables[0];
  eq([tb.pairSize, tb.ageSumCol, tb.eventCol], [2, 'L', 'M'], '種目の列と、2人1組であることを見つける');

  // ★「年令」（齢ではなく令）と書く様式がある。単独の「年令」は前から読めたのに、
  //   合計のほうだけ抜けていた（2026-09-20、本物の神奈川県の様式5シートで発覚）
  var cellsRei = cells.map(function (c) {
    return c.ref === 'L1' ? { ref: 'L1', row: 1, col: 12, text: '合計\n年令' } : c;
  });
  var tbRei = M.normalize(RU.map(cellsRei, merges, { names: names, suspects: [] })).tables[0];
  eq([tbRei.pairSize, tbRei.ageSumCol], [2, 'L'], '★「合計年令」も合計年齢として読む');

  // ★ 左右に並ぶ表を分ける（2026-09-20、本物の神奈川県の様式5シートで発覚）。
  //   シングルス（B〜E）とダブルス（G〜J）が左右に並ぶ様式。分けないと、どちらの表も
  //   シート全部の列を見てしまい、シングルスがダブルス側の結合で「2人1組」になる。
  //   分ける手がかりは、両方の表が同じ見出しの並びを繰り返していること
  var sideCells = [
    { ref: 'B1', row: 1, col: 2, text: '種目' }, { ref: 'C1', row: 1, col: 3, text: '氏名' },
    { ref: 'D1', row: 1, col: 4, text: '所属' }, { ref: 'E1', row: 1, col: 5, text: '年令' },
    { ref: 'G1', row: 1, col: 7, text: '種目' }, { ref: 'H1', row: 1, col: 8, text: '氏名' },
    { ref: 'I1', row: 1, col: 9, text: '所属' }, { ref: 'J1', row: 1, col: 10, text: '合計年令' },
    { ref: 'C2', row: 2, col: 3, text: '山田 太郎' }, { ref: 'C3', row: 3, col: 3, text: '山田 花子' },
    { ref: 'H2', row: 2, col: 8, text: '田中 誠' }, { ref: 'H3', row: 3, col: 8, text: '加藤 健' }
  ];
  // ダブルス側だけ、種目と合計年令が2行ずつ縦に結合されている（＝2人1組）
  var sideMerges = [{ top: 2, bottom: 3, left: 7, right: 7 }, { top: 2, bottom: 3, left: 10, right: 10 }];
  var sideNames = [['C2', 2, 3], ['C3', 3, 3], ['H2', 2, 8], ['H3', 3, 8]].map(function (a) {
    return { refs: [a[0]], row: a[1], col: a[2], text: 'x', match: { status: 'exact', member: null } };
  });
  var sideTb = M.normalize(RU.map(sideCells, sideMerges, { names: sideNames, suspects: [] })).tables;
  eq(sideTb.map(function (t) { return t.nameCol; }), ['C', 'H'], '左右に並ぶ表を2つとして数える');
  eq(sideTb[0].cols.map(function (c) { return c.col; }), ['D', 'E'],
    '★ 左の表（シングルス）は、自分の列だけを見る');
  eq([sideTb[0].pairSize, !!sideTb[0].ageSumCol, !!sideTb[0].eventCol], [1, false, false],
    '★ 左の表を、右の表の結合を見て「2人1組」にしない');
  eq(sideTb[1].cols.map(function (c) { return c.col; }), ['I'],
    '★ 右の表（ダブルス）も、自分の列だけを見る');
  eq([sideTb[1].pairSize, sideTb[1].ageSumCol, sideTb[1].eventCol], [2, 'J', 'G'],
    '右の表は2人1組で、合計年齢と種目の欄を持つ');
  var res = M.slotsFor(mapping, names, { cells: cells, anchorOf: function (r) { return r; } });
  eq(res.groups.map(function (g) { return g.ageSum + '/' + g.event + '=' + g.slots.join('+'); }),
    ['L2/M2=0+1', 'L4/M4=2+3'], '組ごとに、合計年齢と種目の欄が決まる');

  // 種目の欄しか無い様式でも、その縦結合で組が決まる
  var cells2 = cells.filter(function (c) { return c.ref !== 'L1'; });
  var merges2 = merges.filter(function (m) { return m.left !== 12; });
  var mp2 = M.normalize(RU.map(cells2, merges2, { names: names, suspects: [] }));
  eq([mp2.tables[0].pairSize, mp2.tables[0].ageSumCol, mp2.tables[0].eventCol], [2, '', 'M'],
    '合計年齢の欄が無くても、種目の結合で組が決まる');
  var res2 = M.slotsFor(mp2, names, { cells: cells2, anchorOf: function (r) { return r; } });
  eq(res2.groups.map(function (g) { return (g.ageSum || '-') + '/' + g.event; }), ['-/M2', '-/M4'],
    '合計年齢が無い組でも、種目の欄は決まる');

  // ===== 年齢区分（申込書に書かれている区分を読む） =====
  var HYAKU = '合計年齢　（　① 119歳以下　・　② 120～134歳　・　③ 135～149歳　・　④　150歳以上　）';
  var DANTAI = '４名合計年齢　（　① 249歳以下　・　② 250～289歳　・　③ 290歳以上　）';
  eq(M.ageClassesIn(HYAKU).map(function (c) { return c.mark + ':' + (c.min == null ? '' : c.min) + '-' + (c.max == null ? '' : c.max); }),
    ['①:-119', '②:120-134', '③:135-149', '④:150-'], '★ 申込書に書かれた年齢区分を読む（①〜④）');
  eq(M.ageClassesIn(DANTAI).map(function (c) { return c.mark; }), ['①', '②', '③'], '4名合計の区分も読む');
  eq(M.ageClassesIn('年齢区分（1. 100歳未満 2. 100歳以上）').map(function (c) { return c.mark + ':' + (c.max == null ? '' : c.max); }),
    ['1.:99', '2.:'], '「1. 100歳未満」の形も読む（未満は1つ下まで）');
  eq(M.ageClassesIn('合計年齢は150歳以上とする').length, 0, '区分が1つしか書かれていない文は、区分と見なさない');
  eq(M.ageClassesIn('').length, 0, '何も書かれていなければ区分なし');
  var cls = M.ageClassesIn(HYAKU);
  eq([118, 119, 120, 134, 150, 200].map(function (n) { var c = M.ageClassOf(cls, n); return c ? c.mark : '-'; }),
    ['①', '①', '②', '②', '④', '④'], '合計年齢から区分を決める（境目も正しい）');
  eq(M.ageClassOf(cls, null), null, '合計年齢が分からなければ区分も決めない');
  eq(M.ageClassOf([], 150), null, '区分が書かれていなければ決めない');
  eq(M.ageClassesIn(HYAKU)[3].text, '④ 150歳以上', '区分の文字は、前後のかっこを落として見せる');

  // ===== 参加料の単価（計算して見せるだけ。申込書には書かない） =====
  eq([M.feeIn('5,000×　　　　　＝'), M.feeIn('3,000×　　＝')].map(function (f) { return f && f.price; }), [5000, 3000],
    '「5,000×　＝」から単価を読む（百万石）');
  var kahoku = M.feeIn('参加料：団体3,000円×（　　）チーム＝合計（　　　　）円を添えて上記のとおり、申し込みます。');
  eq([kahoku.price, kahoku.per], [3000, 'チーム'], '「団体3,000円×（ ）チーム」から単価と数え方の言葉を読む');
  eq(M.feeIn('参加費 1人 800円'), null, '「×」が無い文からは読まない（数え方が分からないため）');
  eq(M.feeIn(''), null, '何も書かれていなければ読まない');
  var feeCells = [
    { ref: 'B25', row: 25, col: 2, text: '参加料は、大会受付時に支払います' },
    { ref: 'H25', row: 25, col: 8, text: '3,000×　　　　　＝' }
  ];
  eq(M.normalize(RU.map(feeCells, [], { names: [], suspects: [] })).fee.price, 3000,
    '★ 「参加料」の語と単価が別のセルでも拾う（百万石はこの形）');
  eq(M.normalize(RU.map([{ ref: 'A1', row: 1, col: 1, text: '3人×4組' }], [], { names: [], suspects: [] })).fee, null,
    '参加料と関係ない「×」の文は拾わない');

  // 申込書から区分の文を拾う（規則）
  var classCells = [
    { ref: 'C5', row: 5, col: 3, text: HYAKU },
    { ref: 'A2', row: 2, col: 1, text: '年齢は令和9年4月1日現在' }
  ];
  eq(M.normalize(RU.map(classCells, [], { names: [], suspects: [] })).ageClasses.length, 4,
    '★ 申込書の文から年齢区分を拾う（「①」を数字にそろえない）');

  // ===== 斜線（×印）が引いてある欄には書かない =====
  // ★ 事務局の様式は「ここは書かなくてよい」を斜線で示すことがある（百万石の監督の行の生年月日・年齢。
  //   2026-09-19、本人が本物で気づいた）
  var crossCells = [
    { ref: 'C1', row: 1, col: 3, text: '氏名' }, { ref: 'D1', row: 1, col: 4, text: '生年月日' },
    { ref: 'C2', row: 2, col: 3, text: '山田 太郎' }, { ref: 'C3', row: 3, col: 3, text: '山田 花子' }
  ];
  var crossNames = [2, 3].map(function (row) {
    return { refs: ['C' + row], row: row, col: 3, text: 'x', match: { status: 'exact', member: null } };
  });
  var crossMapping = M.normalize(RU.map(crossCells, [], { names: crossNames, suspects: [] }));
  var crossRes = M.slotsFor(crossMapping, crossNames, { cells: crossCells, anchorOf: function (r) { return r; },
    crossedOut: function (ref) { return ref === 'D2'; } });   // 1人目の生年月日だけ斜線
  eq(crossRes.problems.map(function (p) { return p.code + ' ' + p.ref; }), ['target-crossed-out D2'],
    '★ 斜線が引いてある欄には書かず、理由を知らせる');
  eq(crossRes.slots.map(function (s) { return s.fields.map(function (f) { return f.field + '@' + f.ref; }).join(','); }),
    ['name@C2', 'name@C3,birth@D3'], '斜線の無い欄には今までどおり書く');

  // 実物の xlsx から斜線を見分けられるか（様式D の監督の行。本物の百万石と同じ作り）
  return read(path.join(FIX, 'form-d-blank.xlsx')).then(function (book) {
    eq(['D5', 'E5', 'D6', 'B5'].map(function (ref) { return X.crossedOut(book, 0, ref) ? '斜線' : '—'; }),
      ['斜線', '斜線', '—', '—'], '★ 監督の行の生年月日・年齢だけ斜線と分かる（選手の行は書ける）');
    return eventTail(cells, merges, names);
  });
}

function eventTail(cells, merges, names) {
  // ★ 種目の欄に文字が印刷されていたら書かない（ほかの欄と同じ守り）
  var cells3 = cells.concat([{ ref: 'M2', row: 2, col: 13, text: '男子' }]);
  var res3 = M.slotsFor(M.normalize(RU.map(cells3, merges, { names: names, suspects: [] })), names,
    { cells: cells3, anchorOf: function (r) { return r; } });
  eq(res3.problems.filter(function (p) { return p.field === 'event'; }).map(function (p) { return p.code + ' ' + p.ref; }),
    ['target-has-text M2'], '種目の欄に文字が入っていたら書かずに知らせる');
  return copySheetTail();
}

// ===== 13. 人数が入りきらないとき、2枚目の様式を足す =====
// ★ ここは「セルを埋める」以外で初めてブックをさわる所。踏むと壊れる所を試験で押さえる。
function copySheetTail() {
  return read(path.join(FIX, 'form-e-two-sheets.xlsx')).then(function (book) {
    var before = X.sheetNames(book);
    eq(before, ['申込書 A', '申込書 B'], '2シートの様式を読める');

    var pos = X.copySheet(book, 0);
    eq(pos, 1, '2枚目は元の様式のすぐ後ろに入る');
    eq(X.sheetNames(book), ['申込書 A', '申込書 A (2)', '申込書 B'], '名前は Excel の流儀「(2)」');

    // ★ 印刷範囲は localSheetId＝並び順の番号。途中に挿したら後ろをずらすこと。
    //   これを忘れると、本物の百万石で「個人戦の印刷範囲が団体戦を指す」ことになる
    var defs = (book.parts['xl/workbook.xml'].match(/<definedName\b[^>]*localSheetId="\d+"[^>]*>[\s\S]*?<\/definedName>/g) || [])
      .map(function (d) {
        return (/localSheetId="(\d+)"/.exec(d))[1] + ':' + d.replace(/^[\s\S]*>([^<]*)<\/definedName>$/, '$1');
      }).sort();
    eq(defs, ["0:'申込書 A'!$A$1:$D$8", "1:'申込書 A (2)'!$A$1:$D$8", "2:'申込書 B'!$A$1:$D$8"],
      '★ 印刷範囲: 複製にも付き、後ろのシートの番号がずれない');

    // ★ 2枚足す場合。うしろの枚数から作ると、並びが (2)(3) の順になる（アプリの保存と同じ手順）
    var book2;
    var made = read(path.join(FIX, 'form-e-two-sheets.xlsx')).then(function (b) {
      book2 = b;
      var base = X.sheetNames(b)[0];
      X.copySheet(b, 0, base + ' (3)');
      X.copySheet(b, 0, base + ' (2)');
      eq(X.sheetNames(b), ['申込書 A', '申込書 A (2)', '申込書 A (3)', '申込書 B'],
        '★ 2枚足しても並びが (2)(3) の順になる');
      var ids = (b.parts['xl/workbook.xml'].match(/<definedName\b[^>]*localSheetId="(\d+)"/g) || [])
        .map(function (s) { return (/(\d+)/.exec(s))[1]; }).sort();
      eq(ids, ['0', '1', '2', '3'], '印刷範囲は4枚ぶん、番号が重ならない');
      X.setCell(b, 1, 'B5', '架空 次郎');
      X.setCell(b, 2, 'B5', '架空 三郎');
      return X.save(b).then(function (u8) {
        expectForExcel.push({ file: 'copied-2sheets.xlsx', sheet: '申込書 A (3)', cells: { B5: '架空 三郎' } });
        fs.writeFileSync(path.join(OUT, 'copied-2sheets.xlsx'), Buffer.from(u8));
      });
    });

    // 書いて保存し、読み直しても崩れないか
    X.setCell(book, pos, 'B5', '架空 太郎');
    return made.then(function () { return X.save(book); }).then(function (u8) {
      return X.open(u8).then(function (b2) {
        eq(X.sheetNames(b2), ['申込書 A', '申込書 A (2)', '申込書 B'], '保存して読み直しても3シート');
        var got = X.cells(b2, 1).filter(function (c) { return c.ref === 'B5'; })[0];
        eq(got && got.text, '架空 太郎', '2枚目に書いた名前が残っている');
        eq(X.cells(b2, 0).length, X.cells(book, 0).length, '元のシートは変わっていない');
        // 種類の宣言（これが無いと Excel は開かない）
        var ct = b2.parts['[Content_Types].xml'];
        check(ct.indexOf('PartName="/xl/worksheets/') >= 0 &&
          (ct.match(/spreadsheetml\.worksheet\+xml/g) || []).length === 3,
          '★ [Content_Types].xml に3枚ぶんの宣言がある（宣言が無いと Excel は開かない）');
        expectForExcel.push({ file: 'copied-sheet.xlsx', sheet: '申込書 A (2)', cells: { B5: '架空 太郎' } });
        fs.writeFileSync(path.join(OUT, 'copied-sheet.xlsx'), Buffer.from(u8));
      });
    });
  }).then(function () {
    // ★ シートが自分の rels（printerSettings）を持つ様式。複製に参照だけ残すと Excel が「修復しました」と言う。
    //   本物の百万石と Thanet がこの形。見本には rels が無いので、ここで同じ形を作って試す
    return read(path.join(FIX, 'form-e-two-sheets.xlsx')).then(function (book) {
      var p = book.sheets[0].path;
      book.parts[p] = book.parts[p].replace('</worksheet>',
        '<pageSetup paperSize="9" orientation="portrait" r:id="rId1"/></worksheet>');
      var pos = X.copySheet(book, 0);
      var ps = /<pageSetup\b[^>]*>/.exec(book.parts[book.sheets[pos].path]);
      check(!!ps && ps[0].indexOf('r:id') < 0,
        '★ 複製の pageSetup から r:id を外す（連れて行かない部品を参照しない）');
      check(!!ps && /paperSize="9"/.test(ps[0]) && /orientation="portrait"/.test(ps[0]),
        '用紙と向きは残る（<pageSetup> の属性そのものなので失わない）');
    });
  }).then(function () {
    // ★ 同じ欄への書き込みが重なったら、あとのほうだけ残す（2026-09-20）。
    //   空の申込書では名前をこちらが書くが、欄ごとの書き込みにも名前が入っていて二重になり、
    //   ④の「{n}か所に書き込みます」が水増しされていた（値は同じなので害は無かった）
    var dup = [{ ref: 'B5', value: '山田 太郎' }, { ref: 'C5', value: '1950/4/1' }, { ref: 'B5', value: '山田 太郎' }];
    var seen = {}, once = [];
    dup.forEach(function (w) { if (seen[w.ref]) return; seen[w.ref] = true; once.push(w); });
    eq(once.map(function (w) { return w.ref; }), ['B5', 'C5'],
      '★ 同じ欄への書き込みは1回に数える（件数の水増しを防ぐ。書く順番は変えない）');
    return pdfTail();
  });
}

// ===== PDF は名指しで断る（2026-09-20。対応しないと決めた。CLAUDE.md を参照） =====
function pdfTail() {
  var pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3]);
  var zipish = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0]);
  var ole = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0, 0, 0, 0]);
  return X.open(pdf).then(function () { eq('開けた', '断る', 'PDF は断る'); }, function (e) {
    eq(e.code, 'pdf', '★ PDF は「読めません」ではなく PDF だと名指しで知らせる');
    // 辞書はこの試験に読み込んでいないので、ファイルから見る
    var dict = fs.readFileSync(path.join(__dirname, '..', 'entry-i18n.js'), 'utf8');
    var line = (/'err\.pdf':\s*'([^']*)'/.exec(dict) || [])[1] || '';
    check(/Excel 版/.test(line) && /手書き/.test(line), 'その案内に、次にどうするかが書いてある');
    return X.open(ole).then(function () { eq('開けた', '断る', '.xls は断る'); }, function (e2) {
      eq(e2.code, 'xls-or-password', '.xls とパスワード付きは今までどおり');
      return X.open(zipish).then(function () { eq('開けた', '断る', 'Excel でない ZIP は断る'); }, function (e3) {
        eq(e3.code, 'not-xlsx', 'Excel でないファイルは今までどおり');
      });
    });
  }).then(function () {
    // 連れて行けないものがある様式は、壊れたファイルを作らずに断る
    return read(path.join(FIX, 'form-e-two-sheets.xlsx')).then(function (book) {
      book.parts[book.sheets[0].path] = book.parts[book.sheets[0].path]
        .replace('</worksheet>', '<drawing r:id="rId99"/></worksheet>');
      var code = '';
      try { X.copySheet(book, 0); } catch (e) { code = e.code || e.message; }
      eq(code, 'sheet-has-parts', '★ 図などを持つ様式は、壊れたファイルを作らずに断る');
    });
  });
}

// ===== 空の様式から「名前を書く表」を見つける =====
function shownOf(tables) {
  return tables.map(function (t) {
    return (t.nameCol || (t.familyCol + '+' + t.givenCol)) + ':' + t.firstRow + '-' + t.lastRow;
  });
}
function blankSection(roster) {
  section('11. 空の様式から表を見つける（entry-blank.js）');

  // 名前を消して「空の様式」にしてから測る
  function blankOf(file, sheet, nameRefs) {
    return read(file).then(function (book) {
      nameRefs.forEach(function (ref) { X.setCell(book, sheet, ref, ''); });
      return X.save(book).then(function (bytes) { return X.open(bytes); });
    });
  }
  function shown(tables) { return shownOf(tables); }

  // 手で作った小さな表で、細かい決まりを確かめる（grid は { ref, row, col, text, styled } の並び）
  var cell = function (col, row, text) { return { ref: X.toRef(col, row), row: row, col: col, text: text || '', styled: true }; };
  // 下の罫線つき（点線＝1人の中の区切り、実線＝人と人の区切り）
  var cellB = function (col, row, text, bottom) {
    var c = cell(col, row, text); c.bottom = bottom || ''; return c;
  };
  eq(B_.tables([cell(1, 1, '姓'), cell(1, 2, ''), cell(1, 3, '')]), [],
    '★ 「姓」だけで「名」の見出しが無い表は作らない（名前を書き分けられないため）');
  eq(shownOf(B_.tables([cell(1, 1, '姓'), cell(2, 1, '名'), cell(1, 2, ''), cell(2, 2, ''), cell(1, 3, ''), cell(2, 3, '')])),
    ['A+B:2-3'], '「姓」と「名」が並んでいれば1つの表にする');
  eq(shownOf(B_.tables([cell(2, 1, '氏　名'), cell(1, 2, '監督'), cell(2, 2, ''), cell(1, 3, '1'), cell(2, 3, '')])),
    ['B:2-3'], '見出しの空白と、左の行の名札（監督）を越えて数える');
  eq(shownOf(B_.tables([cell(3, 1, '氏名'), cell(1, 2, '監督'), cell(3, 2, ''), cell(1, 3, '1'), cell(3, 3, '')])),
    ['C:2-3'], '名札が2つ左にあっても名札として数える（百万石の監督の行）');

  // ★ 同じ形の表が左右に並ぶ様式（2026-09-20、本物の八王子市バレーボール連盟のエントリー用紙）。
  //   名札とみなすのを「すぐ左」に限らないと、**左の表は右の表の「監督」で止まり、右の表は止まらない**。
  //   同じ形の表なのに左15行・右17行になり、右だけ余計な2行に名前を書いていた
  function sideBySide() {
    var g = [cell(1, 4, '番号'), cell(2, 4, '氏名'), cell(4, 4, '番号'), cell(5, 4, '氏名')];
    for (var r = 5; r <= 7; r++) {
      g.push(cell(1, r, String(r - 4)), cell(2, r, ''), cell(4, r, String(r - 4)), cell(5, r, ''));
    }
    g.push(cell(1, 8, '監督'), cell(2, 8, ''), cell(4, 8, '監督'), cell(5, 8, ''));   // 名札の行
    g.push(cell(1, 9, ''), cell(2, 9, ''), cell(4, 9, ''), cell(5, 9, ''));
    return B_.tables(g);
  }
  eq(shownOf(sideBySide()), ['B:5-7', 'E:5-7'], '★ 左右に同じ表が並ぶとき、左と右を同じ行数に読む');

  // ★ 遠くの短い文字は自分の名札ではない（隣の表のもの）。そこで自分の表は終わり
  eq(shownOf(B_.tables([
    cell(4, 1, '氏名'),
    cell(1, 2, ''), cell(4, 2, ''),
    cell(1, 3, ''), cell(4, 3, ''),
    cell(1, 4, '監督'), cell(4, 4, '')
  ])), ['D:2-3'], '★ 3つ左の短い文字は名札とみなさない（隣の表のものなので、そこで終わり）');

  // ★ 見出しのすぐ下に「記入例」を載せる様式がある（2026-09-20、本物の関東ラージボール大会）。
  //   そこで行き止まりになり、表を1つも見つけられずシートごと落ちていた。
  //   札は結合で先頭行にしか無いので、名前の欄が空く行まで飛ばし続ける
  eq(shownOf(B_.tables([
    cell(2, 1, '氏名'),
    cell(1, 2, '記入例'), cell(2, 2, '取手太郎'), cell(3, 2, '男'),   // 見本の行（札はここだけ）
    cell(2, 3, '藤代華子'), cell(3, 3, '女'),                        // 見本の続き（札が無い）
    cell(2, 4, ''), cell(3, 4, ''), cell(2, 5, ''), cell(3, 5, '')   // ここから書ける
  ])), ['B:4-5'], '★ 記入例の行を飛ばして、その下の書ける行から数える');

  // 見本のあとに表が無ければ、表は作らない（飛ばした結果、何も無いのに表を作らない）
  eq(B_.tables([cell(2, 1, '氏名'), cell(1, 2, '記入例'), cell(2, 2, '取手太郎')]), [],
    '記入例だけで書ける行が無ければ、表は作らない');

  // ★ 名前の列そのものに「フリガナ」と印刷してある様式がある（2026-09-20、本物の武蔵野市）。
  //   ふりがな欄を名前の上に置く作りで、名前の行と**交互**に並ぶ。飛ばさないと1行目で行き止まり。
  //   ★ 飛ばした行は「書ける行」に入れない。入れると、ふりがなの欄に名前を書いてしまう
  var kanaTb = B_.tables([
    cell(3, 7, '選　手　名'),
    cell(3, 8, 'フリガナ'), cell(4, 8, ''),      // ふりがなの行
    cell(3, 9, ''), cell(4, 9, ''),              // 名前の行
    cell(3, 10, 'フリガナ'), cell(4, 10, ''),
    cell(3, 11, ''), cell(4, 11, ''),
    cell(3, 12, 'フリガナ'), cell(4, 12, ''),
    cell(3, 13, ''), cell(4, 13, '')
  ]);
  eq(shownOf(kanaTb), ['C:9-13'], '★ ふりがなの行を飛ばして、名前の行から数える');
  eq(kanaTb[0].rows, [9, 11, 13], '★ 書ける行にふりがなの行を入れない（そこへ名前を書かないため）');

  // ★ 1人分を2行に分けて書く様式（2026-09-20、本物の青梅市少年軟式野球連盟「選手登録届」）。
  //   上の行がふりがな、下の行が氏名。「フリガナ」と印刷していないので飛ばす手がかりが無く、
  //   1行で行き止まりになる。そのまま書くと **1人だけ・しかも「ふりがなの行」に** 書いてしまう。
  //   黙って違う行に書くほうが重いので、この形と分かったら表ごと諦める
  function stripeGrid(pairs) {
    var g = [cell(2, 3, '選手名')];
    for (var i = 0; i < pairs; i++) {
      var top = 4 + i * 2;
      g.push(cell(1, top, String(i + 1)), cell(2, top, ''), cell(3, top, ''));   // 連番は上の行だけ
      g.push(cell(2, top + 1, ''), cell(3, top + 1, ''));                        // 下の行は形が違う
    }
    return g;
  }
  var stripe = B_.tables(stripeGrid(5));
  eq(stripe.length, 1, '1人=2行の様式でも、表そのものは見つかる');
  eq(stripe[0].rows, [4], '★ そのままでは1行しか数えられない（しかもふりがなの行）');
  eq(stripe[0].skip, 'two-rows', '★ 1人=2行と分かったら、諦める印を付ける（違う行に書かないため）');

  // ★ 表が見つからない様式は、名前の列と書く行を本人に教えてもらう（2026-09-20）。
  //   様式は競技ごと団体ごとに無数にあり、見出しの規則で網羅はできないと決めた
  eq(B_.manual('C', 5, 8),
    { headerRow: 4, firstRow: 5, lastRow: 8, rows: [5, 6, 7, 8], label: '', nameCol: 'C', taught: true },
    '★ 教わった列と行から、見つけたときと同じ形の表を作る');
  eq(B_.manual('ｃ列', '5', '8').nameCol, 'C', '全角・小文字・「列」つきでも受け取る');
  eq(B_.manual('C', 5, 5).rows, [5], '1行だけでも受け取る');
  eq(B_.manual('C', 1, 3).headerRow, 1, '1行目から書く様式でも作れる');
  eq(B_.manual('', 5, 8), null, '列が無ければ受け取らない');
  eq(B_.manual('C1', 5, 8), null, '列に数字が混じれば受け取らない');
  eq(B_.manual('C', 8, 5), null, '終わりが始まりより前なら受け取らない');
  eq(B_.manual('C', 0, 8), null, '0行目は受け取らない');
  eq(B_.manual('C', 1, 300), null, '200行を超える指定は受け取らない');
  eq(B_.manual('C', 'あ', 8), null, '数でない行は受け取らない');

  // ★ 教えてもらった形・直した「書く行」を覚える（2026-09-20）。一度教えたら次から聞かない
  eq(B_.remember([{ nameCol: 'B', firstRow: 5, lastRow: 19 },
    { nameCol: 'E', firstRow: 6, lastRow: 6, taught: true }]),
    { rows: { B: [5, 19], E: [6, 6] }, taught: ['E'] },
    '★ 覚えるのは列と行の番号だけ（名前も生年月日も入らない）');

  // 表が見つかっているとき: 覚えている行に直す
  var found2 = [{ nameCol: 'B', firstRow: 5, lastRow: 21, rows: [5, 6] }];
  var back = B_.restore(found2, { rows: { B: [5, 19] }, taught: [] });
  eq([back.changed, back.taught, found2[0].firstRow, found2[0].lastRow, found2[0].rows.length],
    [true, false, 5, 19, 15], '★ 見つけた表に、覚えている書く行を当てる');
  eq(B_.restore([{ nameCol: 'B', firstRow: 5, lastRow: 19, rows: [] }],
    { rows: { B: [5, 19] }, taught: [] }).changed, false, '同じ行なら「直した」とは言わない');
  eq(B_.restore([{ nameCol: 'B', firstRow: 5, lastRow: 19, rows: [] }],
    { rows: { C: [1, 3] }, taught: [] }).changed, false, '別の列の覚えは当てない');
  eq(B_.restore([{ nameCol: 'B', firstRow: 5, lastRow: 19, rows: [] }], null).changed, false,
    '覚えが無ければ何もしない');

  // 表が1つも見つからないとき: 教えてもらった形から作る
  var made = B_.restore([], { rows: { E: [6, 8] }, taught: ['E'] });
  eq([made.taught, made.changed, made.tables.length, made.tables[0].nameCol, made.tables[0].rows],
    [true, true, 1, 'E', [6, 7, 8]], '★ 教えてもらった形から表を作り直す（もう一度聞かない）');
  eq(B_.restore([], { rows: {}, taught: ['E'] }).tables, [], '行の覚えが無ければ作らない');
  eq(B_.restore([], { rows: { E: [6, 8] }, taught: [] }).tables, [],
    '★ 教えたのでない表は作らない（見つけた表の行だけを覚えているとき）');
  eq(B_.restore([], null).tables, [], '覚えが無ければ作らない');

  // ★ シートの名前が「記入例」なら、表が無くても教えてもらわない（書く紙ではない）
  check(B_.isExampleName('記入例') && B_.isExampleName('記載例') && B_.isExampleName('見本'),
    '★ 記入例のシートを名前で見分ける');
  check(!B_.isExampleName('提出用') && !B_.isExampleName('申込書') && !B_.isExampleName('９人制'),
    '書く紙のシートは記入例とみなさない');

  // ★ 覚えたことを配る仕組み（覚え書き）は 2026-09-22 に外した。
  //   申込書は大会事務局から必ずもらえるので、会員どうしで配る必要がなかった。
  //   外に出す口が無いことを、ここで確かめる（戻すときは PR #106）
  check(!M.memoOf && !M.memoIn, '★ 覚えたことを外へ出す口は無い');
  var memoSrc = fs.readFileSync(path.join(__dirname, '..', 'entry-app.js'), 'utf8');
  var memoHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  check(memoSrc.indexOf('memo') < 0 && memoHtml.indexOf('memo') < 0,
    '★ 画面にも覚え書きの残りかすが無い');

  // ★ ③で使う鍵は、シートの形（どこにセルがあるか・結合）だけで作る。文字は見ない
  var gA = [{ ref: 'A1', row: 1, col: 1, text: '第1回 テスト大会' }, { ref: 'B5', row: 5, col: 2, text: '' }];
  var gB = [{ ref: 'A1', row: 1, col: 1, text: '第99回 まったく別の大会' }, { ref: 'B5', row: 5, col: 2, text: '' }];
  var gC = gA.concat([{ ref: 'C5', row: 5, col: 3, text: '' }]);
  eq(M.layoutKey(gA, []), M.layoutKey(gB, []),
    '★ 大会名を書き換えてもシートの形の鍵は変わらない（覚えた形が次の年も使える）');
  check(M.layoutKey(gA, []) !== M.layoutKey(gC, []), 'セルが増えれば別の鍵');
  check(M.layoutKey(gA, []) !== M.layoutKey(gA, [{ ref: 'A1:B1' }]), '結合が違えば別の鍵');
  check(/^L[0-9a-f]{24}$/.test(M.layoutKey(gA, [])), '鍵の形（L と16進24文字）');

  var teachSrc = fs.readFileSync(path.join(__dirname, '..', 'entry-app.js'), 'utf8');
  check(/sh\.teach = true;/.test(teachSrc) && /if \(tables\.length\) return;/.test(teachSrc),
    '★ 何も見つからなかったシートは捨てずに教える道へ（1人=2行と分かったものは断ったまま）');
  // ★ 文言があるかだけを見ない（2026-09-20）。条件を消しても文言は残るので素通りする
  check(teachSrc.indexOf("tb.fields.push({ field: 'kana', col: tb.nameCol, rowOffset: -1 })") >= 0,
    '★ 上の行がふりがなの様式では、名前の列の1つ上にフリガナを書く');
  check(teachSrc.indexOf('var st = tb.kanaAbove ? 2 : 1;') >= 0,
    '★ 書く行を直しても、1つ飛ばしを守る（ふりがなの行に名前を書かない）');
  check(teachSrc.indexOf('sh.layoutKey = M.layoutKey(grid, sh.merges)') >= 0,
    '★ ③で使う鍵は、シートの形から作る（表が見つかる前なので formKey は作れない）');
  check(teachSrc.indexOf('saveRows(sh);') >= 0 && teachSrc.indexOf('BL.remember(sh.tables)') >= 0,
    '教えた形と、直した書く行を覚える');
  check(teachSrc.indexOf("sh.restored = 'teach'") >= 0 && teachSrc.indexOf("sh.restored = 'rows'") >= 0 &&
    /teachRestored/.test(teachSrc) && /rowsRestored/.test(teachSrc),
    '★ 覚えていた形を当てたときは、そう見せる（黙って当てない）');
  check(teachSrc.indexOf('state.sheets.some(function (sh) { return sh.teach; })') >= 0 &&
    /teachWait/.test(teachSrc), '★ 教えてもらう途中のシートしか無いときは「次へ」を止める');
  check(teachSrc.indexOf('state.sheets = state.sheets.filter(function (sh) { return !sh.teach; });') >= 0,
    '★ 教えてもらえなかったシートは使わない（④以降へ持ち込まない）');
  check(/state\.sheets\.filter\(function \(x\) \{ return x !== sh; \}\)/.test(teachSrc),
    '教えずに「このシートは使わない」も選べる');
  var teachI18n = fs.readFileSync(path.join(__dirname, '..', 'entry-i18n.js'), 'utf8');
  check(['teachTitle', 'teachHint', 'teachCol', 'teachRows', 'teachApply', 'teachSkip', 'teachBad',
    'teachDone', 'teachWait'].every(function (k) { return new RegExp(k + ':').test(teachI18n); }),
    '教える画面の文言がそろっている');

  // 見張り：本当に1行しか書けない表は諦めない（本物の様式にいくつもある）
  var oneRow = B_.tables([cell(2, 3, '氏名'), cell(1, 4, '1'), cell(2, 4, ''), cell(3, 4, ''),
    cell(2, 5, ''), cell(3, 5, ''), cell(2, 6, ''), cell(3, 6, ''), cell(2, 7, ''), cell(3, 7, '')]);
  eq(oneRow[0].rows, [4], '本当に1行しか書けない表');
  eq(oneRow[0].skip, undefined, '★ 2行ひと組がくり返していなければ諦めない');
  eq(B_.tables(stripeGrid(2))[0].skip, undefined, '2組だけでは決めない（3組くり返して初めて決める）');

  // ★ 実線の枠の中が点線で区切られていたら、上段はふりがな（2026-09-20、本人の判断）。
  //   日本の様式のふつうの書き方で、様式に「ふりがな」と印刷されていなくてもそう読んでよい。
  //   名前は**下の行**に書き、上の行にはフリガナを入れる
  function dottedGrid(pairs) {
    var g = [cell(2, 3, '選手名')];
    for (var i = 0; i < pairs; i++) {
      var top = 4 + i * 2;
      g.push(cellB(1, top, String(i + 1), 'thin'), cellB(2, top, '', 'dotted'), cellB(3, top, '', 'dotted'));
      g.push(cellB(2, top + 1, '', 'thin'), cellB(3, top + 1, '', 'thin'));
    }
    return g;
  }
  var dotted = B_.tables(dottedGrid(4));
  eq(dotted.length, 1, '点線の様式でも表は1つ');
  eq(dotted[0].skip, undefined, '★ 点線があれば諦めない（どちらの行が氏名か分かるため）');
  eq(dotted[0].kanaAbove, true, '★ 上の行はふりがなの印を付ける');
  eq(dotted[0].rows, [5, 7, 9, 11], '★ 名前を書くのは点線の下の行（1つ飛ばし）');
  eq([dotted[0].firstRow, dotted[0].lastRow], [5, 11], '書く行の範囲も下の行で数える');
  eq(B_.tables(stripeGrid(4))[0].kanaAbove, undefined,
    '★ 点線が無ければ、ふりがなとは決めない（断るまま）');

  // 見張り：どの行も点線なら「1人の枠」が無い＝どちらが氏名か決められない
  function allDottedGrid(pairs) {
    var g = [cell(2, 3, '選手名')];
    for (var i = 0; i < pairs; i++) {
      var top = 4 + i * 2;
      g.push(cellB(1, top, String(i + 1), 'dotted'), cellB(2, top, '', 'dotted'), cellB(3, top, '', 'dotted'));
      g.push(cellB(2, top + 1, '', 'dotted'), cellB(3, top + 1, '', 'dotted'));
    }
    return g;
  }
  eq(B_.tables(allDottedGrid(4))[0].kanaAbove, undefined,
    '★ どの行も点線なら、ふりがなとは決めない（下の行が実線であることまで見る）');
  eq(B_.tables(allDottedGrid(4))[0].skip, 'two-rows', 'そのときは今までどおり断る');

  // 1つ飛ばしの表は、行を直しても1つ飛ばしのまま
  eq(B_.manual('D', 21, 27, 2).rows, [21, 23, 25, 27], '★ 1つ飛ばしで数え直せる');
  eq(B_.manual('D', 21, 24).rows, [21, 22, 23, 24], 'ふつうの表は今までどおり');
  var keep = [{ nameCol: 'D', firstRow: 21, lastRow: 39, rows: [], kanaAbove: true }];
  B_.restore(keep, { rows: { D: [21, 27] }, taught: [] });
  eq(keep[0].rows, [21, 23, 25, 27], '★ 覚えていた行を当て直しても、1つ飛ばしを守る');

  // 見張り：すぐ下の行に文字が印刷してあれば、それは「1人の2行目」ではなく別の欄
  eq(B_.tables([cell(2, 3, '氏名'), cell(1, 4, '1'), cell(2, 4, ''), cell(3, 4, ''),
    cell(2, 5, '監督'), cell(3, 5, ''),
    cell(1, 6, '2'), cell(2, 6, ''), cell(3, 6, ''), cell(2, 7, ''), cell(3, 7, ''),
    cell(1, 8, '3'), cell(2, 8, ''), cell(3, 8, ''), cell(2, 9, ''), cell(3, 9, '')
  ])[0].skip, undefined, '★ 下の行に文字があるなら2行ひと組ではない（諦めない）');

  // 見張り：上下の形が同じなら、ただ途中で止まっただけ（「合計」の行などで止まる）
  eq(B_.tables([cell(2, 3, '氏名'),
    cell(1, 4, '1'), cell(2, 4, ''), cell(3, 4, ''),
    cell(1, 5, '合計12人'), cell(2, 5, ''), cell(3, 5, ''),
    cell(1, 6, '2'), cell(2, 6, ''), cell(3, 6, ''),
    cell(1, 7, '3'), cell(2, 7, ''), cell(3, 7, ''),
    cell(1, 8, '4'), cell(2, 8, ''), cell(3, 8, ''),
    cell(1, 9, '5'), cell(2, 9, ''), cell(3, 9, '')
  ])[0].skip, undefined, '★ 上下の形が同じなら2行ひと組ではない（諦めない）');

  // 画面の側：諦めた表は使わず、何の様式かを名指しで断る
  var appSrc = fs.readFileSync(path.join(__dirname, '..', 'entry-app.js'), 'utf8');
  check(/usable\s*=\s*tables\.filter/.test(appSrc) && /!tb\.skip/.test(appSrc),
    '★ 諦めた表は使わない（entry-app が印の付いた表を外す）');
  check(/state\.skipped\s*\?\s*'twoRowForm'/.test(appSrc) &&
    /twoRowForm:/.test(fs.readFileSync(path.join(__dirname, '..', 'entry-i18n.js'), 'utf8')),
    '★ 断るときは「1人=2行の様式」と名指しで知らせる');

  // ★ 規則のほうでも、ふりがなの行を「表の切れ目」と見なさない。
  //   見なすと、1人ずつの表にばらばらに割れる（本物の武蔵野市で5つに割れていた）
  var kanaCells = [
    { ref: 'C7', row: 7, col: 3, text: '選　手　名' }, { ref: 'G7', row: 7, col: 7, text: '所属' },
    { ref: 'C8', row: 8, col: 3, text: 'フリガナ' },
    { ref: 'C9', row: 9, col: 3, text: '山田 太郎' },
    { ref: 'C10', row: 10, col: 3, text: 'フリガナ' },
    { ref: 'C11', row: 11, col: 3, text: '山田 花子' }
  ];
  var kanaNames = [[9], [11]].map(function (a) {
    return { refs: ['C' + a[0]], row: a[0], col: 3, text: 'x', match: { status: 'exact', member: null } };
  });
  var kanaMap = M.normalize(RU.map(kanaCells, [], { names: kanaNames, suspects: [] }));
  eq(kanaMap.tables.length, 1, '★ ふりがなの行で表を割らない（1人ずつにばらけさせない）');
  eq([kanaMap.tables[0].firstRow, kanaMap.tables[0].lastRow], [9, 11], 'その表は9〜11行');

  // ★ 見出しのすぐ下に「入力見本」を置く様式がある（2026-09-20、本物の東京都卓球連盟）。
  //   見本の行を飛ばさないと、**見本の値が見出しとして読まれ**、その列の種類が決まらない
  var exCells = [
    { ref: 'A5', row: 5, col: 1, text: '種目番号' }, { ref: 'C5', row: 5, col: 3, text: 'チーム名(カナ)' },
    { ref: 'E5', row: 5, col: 5, text: '氏　名' }, { ref: 'F5', row: 5, col: 6, text: '氏名(カナ)' },
    { ref: 'G5', row: 5, col: 7, text: '生年月日' },
    { ref: 'A6', row: 6, col: 1, text: '入力見本' }, { ref: 'C6', row: 6, col: 3, text: 'トウタククラブ' },
    { ref: 'E6', row: 6, col: 5, text: '東京 太郎' }, { ref: 'F6', row: 6, col: 6, text: 'トウキョウ タロウ' },
    { ref: 'G6', row: 6, col: 7, text: '1965/1/23' },
    { ref: 'E7', row: 7, col: 5, text: '山田 太郎' }, { ref: 'E8', row: 8, col: 5, text: '山田 花子' }
  ];
  var exNames = [7, 8].map(function (r) {
    return { refs: ['E' + r], row: r, col: 5, text: 'x', match: { status: 'exact', member: null } };
  });
  var exTb = M.normalize(RU.map(exCells, [], { names: exNames, suspects: [] })).tables[0];
  var exGot = {};
  (exTb.cols || []).forEach(function (c) { exGot[c.col] = c.field || null; });
  eq(exGot.F, 'kana', '★ 入力見本の行を飛ばし、その上の本当の見出し（氏名(カナ)）を読む');
  // ★ 「チーム名(カナ)」を人のフリガナと読まない。団体名の読みの欄に、人のセイ・メイを書いてしまう
  eq(exGot.C, null, '★ 「チーム名(カナ)」を人のフリガナと読まない（誤爆を防ぐ）');
  eq(exGot.G, 'birth', '生年月日は今までどおり読む');

  // ★ 表が始まったあとの記入例は飛ばさない。飛ばすと、その先の行まで1つの表に飲み込む
  eq(shownOf(B_.tables([
    cell(2, 1, '氏名'),
    cell(2, 2, ''), cell(3, 2, ''),                                   // 書ける行
    cell(2, 3, ''), cell(3, 3, ''),
    cell(1, 4, '記入例'), cell(2, 4, '取手太郎'), cell(3, 4, '男'),    // ここから先は別の話
    cell(2, 5, ''), cell(3, 5, '')
  ])), ['B:2-3'], '★ 表が始まったあとの記入例は飛ばさない（その先まで飲み込まない）');
  // 表の名前は、見出しのすぐ上の同じ列の短い文字だけ（遠くの文字は拾わない）
  eq(B_.tables([cell(2, 1, '連絡責任者'), cell(2, 2, '氏名'), cell(2, 3, ''), cell(3, 3, '')])[0].label, '連絡責任者',
    '表の名前を、見出しのすぐ上から拾う');
  eq(B_.tables([cell(2, 2, '氏名'), cell(2, 3, ''), cell(3, 3, '')])[0].label, '', '拾えなければ名前なし');

  var cases = [
    { label: '様式A（1人1行）', file: path.join(FIX, 'form-a-all-fields.xlsx'), sheet: 0,
      names: ['B7', 'B8', 'B9', 'B10', 'B11', 'B12'], want: ['B:7-12'] },
    { label: '様式B（2人1組・結合）', file: path.join(FIX, 'form-b-pairs.xlsx'), sheet: 0,
      names: ['C14', 'C15', 'C16', 'C17', 'C18', 'C19'], want: ['C:14-21'] },
    { label: '様式C（姓と名が別の欄）', file: path.join(FIX, 'form-c-split.xlsx'), sheet: 0,
      names: ['B6', 'B7', 'B8', 'B9', 'C6', 'C7', 'C8', 'C9'], want: ['B+C:6-9'] },
    { label: '様式D（もともと空・監督の行つきの表が2つ）', file: path.join(FIX, 'form-d-blank.xlsx'), sheet: 0,
      names: [], want: ['B:5-11', 'B:15-21'] }
  ];

  return cases.reduce(function (p, c) {
    return p.then(function () {
      return blankOf(c.file, c.sheet, c.names).then(function (book) {
        eq(shown(B_.tables(X.grid(book, c.sheet))), c.want, c.label + ': 名前の列と書ける行');
      });
    });
  }, Promise.resolve()).then(function () {
    // ★ 本物の様式（local/）。無ければ飛ばす
    if (!fs.existsSync(LOCAL)) return;
    var files = fs.readdirSync(LOCAL);
    var hyaku = files.filter(function (f) { return /百万石.*\.xlsx$/.test(f); })[0];
    var sporec = files.filter(function (f) { return /スポレク.*\.xlsx$/.test(f); })[0];
    var jobs = [];
    if (hyaku) {
      jobs.push({ label: '本物の百万石 団体戦', file: path.join(LOCAL, hyaku), sheet: 0,
        names: ['C14', 'C15', 'C16', 'C17', 'C18', 'C19'], want: ['C:14-19'] });
      jobs.push({ label: '本物の百万石 個人戦', file: path.join(LOCAL, hyaku), sheet: 1,
        names: ['C14', 'C15', 'C16', 'C17', 'C18', 'C19', 'C20', 'C21'], want: ['C:14-21'] });
    }
    if (sporec) {
      // ★ スポレクには本物の名前が書き込まれている。消してから測る（表示も期待値にも出さない）
      jobs.push({ label: '本物のスポレク シート1', file: path.join(LOCAL, sporec), sheet: 0,
        names: ['B10', 'B13', 'B14', 'B15', 'B16', 'B17', 'B18'], want: ['B:10-10', 'B:13-18'] });
    }
    // ★ 1人=2行の様式（本物の選手登録届）。表を全部諦めるのが正しい
    var twoRow = files.filter(function (f) { return /選手登録届.*\.xlsx$/.test(f); })[0];
    if (twoRow) jobs.push({ label: '本物の選手登録届（点線の上がふりがな）', file: path.join(LOCAL, twoRow),
      sheet: 0, names: [], want: ['D:21-39', 'O:21-39'] });
    // ★ 左右に同じ表が並ぶ様式（本物のエントリー用紙）。左右が同じ行数になること
    var side = files.filter(function (f) { return /エントリー用紙.*\.xlsx$/.test(f); })[0];
    if (side) jobs.push({ label: '本物のエントリー用紙（左右に同じ表）', file: path.join(LOCAL, side),
      sheet: 0, names: [], want: ['B:5-19', 'E:5-19'] });
    if (!jobs.length) { console.log('  --   本物の様式が entry/test/local/ に無いので飛ばします'); return; }
    return jobs.reduce(function (p, j) {
      return p.then(function () {
        return blankOf(j.file, j.sheet, j.names).then(function (book) {
          var tb = B_.tables(X.grid(book, j.sheet));
          eq(shown(tb), j.want, j.label + ': 名前の列と書ける行');
        });
      });
    }, Promise.resolve());
  });
}

// ===== 名簿ファイル =====
// 人・団体・住所・電話番号はすべて架空
// ===== 申込書の見取り図（2026-09-24） =====
// ★ 申込書を Excel で開いて見比べなくても、③でどこに書くかが画面で分かるようにした（本人の要望）。
//   本物の Excel を映すのではなく、もう読んでいる中身から描く（entry-view.js が形、entry-app.js が画面）
function viewSection() {
  section('見取り図（③で申込書の形を描く）');
  var V = window.EntryView;

  // --- 形：結合・隠れた行と列・列の幅・行の高さ・罫線 ---
  var g = [];
  for (var r = 1; r <= 12; r++) {
    for (var c = 1; c <= 5; c++) g.push({ ref: V.letter(c) + r, row: r, col: c, text: '', styled: true, bottom: '' });
  }
  var put = function (ref, t) { g.filter(function (x) { return x.ref === ref; })[0].text = t; };
  put('A1', '第1回 テスト大会'); put('B4', '氏名'); put('C4', 'フリガナ');
  var mg = [{ ref: 'A1:E1', top: 1, left: 1, bottom: 1, right: 5 },    // 大会名の横長の結合
            { ref: 'D5:D6', top: 5, left: 4, bottom: 6, right: 4 }];   // 縦の結合
  var L = { cols: { 3: { width: 20, hidden: false }, 5: { width: 9, hidden: true } },
            rows: { 8: { height: 30, hidden: false }, 9: { height: null, hidden: true } },
            borders: { A1: { t: 'thin', b: '', l: 'thin', r: '' }, E1: { t: '', b: '', l: '', r: 'thick' } },
            defColW: 8.43, defRowH: 15 };
  var f = V.frame(g, mg, L, null);
  eq(f.cols.map(function (x) { return x.letter; }), ['A', 'B', 'C', 'D'], '★ 隠れた列は描かない（Excel でも見えない）');
  check(f.rows.every(function (x) { return x.row !== 9; }) && f.rows.length === 11, '★ 隠れた行は描かない');
  var r1 = f.rows[0].cells;
  eq([r1.length, r1[0].ref, r1[0].colspan, r1[0].text], [1, 'A1', 4, '第1回 テスト大会'],
    '★ 横長の結合は1マスにまとめ、見えている列だけ数える（E は隠れているので 4）');
  eq([r1[0].border.t, r1[0].border.l, r1[0].border.r], ['thin', 'thin', 'thick'],
    '結合の罫線：上と左は左上のマス、右は右上のマスから取る');
  var row5 = f.rows.filter(function (x) { return x.row === 5; })[0].cells;
  var row6 = f.rows.filter(function (x) { return x.row === 6; })[0].cells;
  check(row5.some(function (x) { return x.ref === 'D5' && x.rowspan === 2; }) &&
        !row6.some(function (x) { return x.col === 4; }), '★ 縦の結合も1マス。下の段は描かない');
  eq([f.cols[0].px, f.cols[2].px], [V.colPx(8.43), V.colPx(20)], '列の幅は様式のとおり（無ければ Excel の既定）');
  eq([f.rows[0].px, f.rows.filter(function (x) { return x.row === 8; })[0].px], [V.rowPx(15), V.rowPx(30)],
    '行の高さも様式のとおり');
  eq(V.frame([], [], L, null), null, '描くものが無いシートは描かない（空のシート）');

  // --- 範囲：長い表・広い様式は切る。ただし表の列は切らない ---
  var big = [];
  for (var rr = 1; rr <= 100; rr++) {
    for (var cc = 1; cc <= 40; cc++) big.push({ ref: V.letter(cc) + rr, row: rr, col: cc, text: '', styled: true, bottom: '' });
  }
  var fb = V.frame(big, [], null, [{ top: 10, bottom: 90, left: 30, right: 30 }]);
  eq([fb.r0, fb.rows.length, fb.cut.rows], [10 - V.ABOVE, V.MAX_ROWS, true],
    '★ 表の見出しの上を少し見せ、長い表は決まった行数で切る');
  eq([fb.cols[0].col, fb.cols[fb.cols.length - 1].col, fb.cut.cols], [28, 40, true],
    '★ 広い様式は、名前の列の2つ左から描く（表の列が切れない）。使っていない右の列は描かない');
  var fs2 = V.frame(big, [], null, [{ top: 10, bottom: 20, left: 2, right: 2 }]);
  eq([fs2.cols[0].col, fs2.cols.length], [1, V.MAX_COLS], '左端の表なら、左から決まった列数');

  // --- 印：③で選んだ人・次に入る行・書く欄 ---
  var tables = [{ nameCol: 'B', headerRow: 4, firstRow: 5, lastRow: 8, rows: [5, 6, 7, 8] }];
  var m = V.marks(tables, [[{ name: '山田 太郎' }, { name: '伊藤 美穂' }]]);
  eq([m.B5.cls, m.B5.text, m.B6.cls, m.B6.text], ['sv-put', '山田 太郎', 'sv-put', '伊藤 美穂'],
    '★ 選んだ人は、上の行から順にその欄に入って見える');
  eq([m.B7.cls, m.B8.cls, m.B4.cls], ['sv-next', 'sv-slot', 'sv-head'], '次に入る行・空いている欄・見出しに印');
  eq(Object.keys(m).filter(function (k) { return m[k].cls === 'sv-next'; }).length, 1, '★ 次に入る行は表ごとに1つだけ');
  var full = V.marks(tables, [[1, 2, 3, 4, 5, 6].map(function (i) { return { name: 'N' + i }; })]);
  eq([full.B8.text, Object.keys(full).filter(function (k) { return full[k].cls === 'sv-next'; }).length,
      Object.keys(full).some(function (k) { return full[k].text === 'N5'; })], ['N4', 0, false],
    '★ いっぱいなら次の行は無く、2枚目に回る人は描かない（見取り図は1枚目の姿）');
  var kana = V.marks([{ nameCol: 'C', kanaAbove: true, headerRow: 4, firstRow: 6, lastRow: 8, rows: [6, 8] }], [[]]);
  eq([kana.C5.cls, kana.C7.cls, kana.C6.cls], ['sv-kana', 'sv-kana', 'sv-next'], '上の行がふりがなの様式は、その行も薄く塗る');
  var split = [{ familyCol: 'B', givenCol: 'C', firstRow: 5, lastRow: 6, rows: [5, 6] }];
  var sm = V.marks(split, [[{ name: '山田 太郎', family: '山田', given: '太郎' }, { name: '伊藤美穂' }]]);
  eq([sm.B5.text, sm.C5.text, sm.B6.text, sm.C6.text], ['山田', '太郎', '伊藤美穂', ''],
    '姓と名が別の欄の様式：分かれていれば姓と名に、分かれていなければ姓の欄にまとめる');
  eq(V.focusOf(tables), [{ top: 4, bottom: 8, left: 2, right: 2 }], '見せる範囲は、見出しの行〜最後の行と名前の列');

  // --- 教える：マスを押して、名前の列と行を指す ---
  var s1 = V.point(null, 2, 10);
  eq(s1, { col: 'B', from: 10, to: null }, '★ 1回目に押したマスが、名前の列と始めの行');
  var s2 = V.point(s1, 5, 19);
  eq(s2, { col: 'B', from: 10, to: 19 }, '★ 2回目で終わりの行。別の列を押しても列は1回目のまま');
  eq(V.point({ col: 'B', from: 19, to: null }, 2, 10), { col: 'B', from: 10, to: 19 }, '上へ向かって押しても受け取る');
  eq(V.point(s2, 3, 4), { col: 'C', from: 4, to: null }, '3回目は選び直し');
  var pm = V.pointMarks(s2);
  eq([Object.keys(pm).length, pm.B10.cls, pm.B19.cls], [10, 'sv-sel sv-sel-start', 'sv-sel'], '選んだ範囲に印');
  eq(Object.keys(V.pointMarks({ col: 'A', from: 1, to: 900 })).length, 200, '印は200行まで（教えられる上限と同じ）');
  var taught = B_.manual(s2.col, s2.from, s2.to);
  eq([taught && taught.nameCol, taught && taught.rows.length], ['B', 10],
    '★ 押して選んだ範囲は、打ち込んだときと同じ表になる（EntryBlank.manual に渡す）');

  // --- 画面の配線 ---
  var appSrc = fs.readFileSync(path.join(__dirname, '..', 'entry-app.js'), 'utf8');
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  check(appSrc.indexOf('V.marks(sh.tables, sh.picks)') >= 0 && appSrc.indexOf('V.focusOf(sh.tables)') >= 0,
    '③の見取り図は、表と選んだ人から印を付ける');
  check(appSrc.indexOf('sh.teachSel = V.point(sh.teachSel, c, r)') >= 0 && appSrc.indexOf('marks: V.pointMarks(s)') >= 0,
    '★ 教える画面で押したマスが、列と行になる');
  check(/value: s \? s\.col/.test(appSrc), '押して選んだ列と行が、下の入力欄にも入る（打ち込みでも直せる）');
  var atView = html.indexOf('<script src="entry-view.js">'), atApp = html.indexOf('<script src="entry-app.js">');
  check(atView > 0 && atView < atApp, 'entry-view.js は entry-app.js より前に読む');
  check(!/officeapps|docs\.google\.com\/viewer|sheet\.zoho/i.test(appSrc + html),
    '★ 外の表示サービスを使わない（使うとファイルを送ることになり「どこにも送らない」と食い違う）');

  // --- 本物の読み：試験用の様式から、列の幅と罫線を読んで描く ---
  return read(path.join(FIX, 'form-d-blank.xlsx')).then(function (book) {
    var lay = X.layout(book, 0);
    eq([lay.cols[1].width, lay.cols[2].width], [6, 18], '列の幅を読む（様式の <col>）');
    eq(lay.borders.A3, { t: 'thin', b: 'thin', l: 'thin', r: 'thin' }, '★ 四辺の罫線を読む（いままでは下だけだった）');
    var grid = X.grid(book, 0);
    var tbs = B_.tables(grid).filter(function (t) { return !t.skip; });
    var fr = V.frame(grid, X.merges(book, 0), lay, V.focusOf(tbs));
    check(!!fr && fr.r0 === 1 && fr.rows.some(function (x) {
      return x.cells.some(function (c) { return c.text.replace(/\s/g, '') === '氏名'; });
    }), '様式の見出し（氏名）が見取り図に出る');
  });
}

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

  // ★ 名簿に足した項目を、申込書の同じ見出しの欄に書く（2026-09-20、本人の要望）。
  //   競技や文化活動で要る項目が違う。本物15ファイルで最多だったのは「所属」。
  //   ★ 当てるのは**見出しがぴったり同じとき**だけ（A案）。語を含めば当てる、にはしない
  var exMember = { name: '山田 太郎', extras: ['白山中学校', ''] };
  var exFill = R.fill(exMember, { fields: [{ field: 'extra:0', ref: 'C5' }] }, {});
  eq(exFill.writes, [{ ref: 'C5', value: '白山中学校' }], '★ 足した項目の中身を書く');
  eq(R.fill(exMember, { fields: [{ field: 'extra:1', ref: 'D5' }] }, {}).problems,
    [{ ref: 'D5', field: 'extra:1', code: 'not-in-roster' }],
    '入れていない人は「名簿に無い」と知らせる（黙って空にしない）');
  eq(R.fill(exMember, { fields: [{ field: 'extra:99', ref: 'E5' }] }, {}).writes, [],
    '名簿に無い番号の項目は書かない');
  eq(R.fill(exMember, { fields: [{ field: 'nandemo', ref: 'F5' }] }, {}).problems,
    [{ ref: 'F5', field: 'nandemo', code: 'unknown-field' }], '知らない種類は今までどおり');

  // 欄の対応を検めるところも extra: を通す
  var exMap = M.normalize({ tables: [{ nameCol: 'B', firstRow: 2, lastRow: 3, headerRow: 1,
    fields: [{ field: 'extra:0', col: 'C', rowOffset: 0 }, { field: 'extra:x', col: 'D', rowOffset: 0 }],
    cols: [{ col: 'C', header: '学校名', field: 'extra:0' }] }] });
  eq(exMap.tables[0].fields, [{ field: 'extra:0', col: 'C', rowOffset: 0 }],
    '★ extra:番号 は受け取り、それ以外の extra: は受け取らない');
  eq(exMap.problems, [{ code: 'unknown-field', table: 0, field: 'extra:x' }], '受け取らなかったものは知らせる');
  eq(exMap.tables[0].cols[0].field, 'extra:0', '④の一覧にも出る');

  // 名簿の中身を、突き合わせに渡すところまで持って行く
  var exRoster = B.toRoster({ 男子: [{ family: '白山', given: '太郎', kanaFamily: 'ハクサン',
    kanaGiven: 'タロウ', extras: ['白山中学校'] }], 女子: [] });
  eq(exRoster.members[0].extras, ['白山中学校'], '★ 足した項目を、申込書に書く側まで渡す');

  // ★ 照合そのもの（A案の中身）。ここがゆるむと誤爆が増える
  check(M.sameLabel('会社名', '会社名'), 'ぴったり同じなら当てる');
  check(M.sameLabel('会 社 名', '会社名'), '空白は無視する');
  check(M.sameLabel('勤務先所在地\r\n会社名', '会社名'), '★ 複数行の見出しは、行ごとに比べる');
  check(!M.sameLabel('勤務先所在地会社名', '会社名'),
    '★ 1行につながっているものは当てない（含み比べにしない。誤爆の元）');
  check(M.sameLabel('所属(混成でも可)', '所属'), '★ うしろの括弧書きは外して比べる');
  check(M.sameLabel('氏名（ふりがな）', '氏名'), '全角の括弧書きも外す');
  check(!M.sameLabel('前所属', '所属'), '★ 前に字が付いていたら当てない');
  check(!M.sameLabel('所属チーム', '所属'), '★ うしろに字が付いていても当てない');
  check(!M.sameLabel('会社名', ''), '名前が空なら当てない');

  // ★ 同じ項目に2つ以上の列が当たったら、名前の列にいちばん近い1つだけ（2026-09-20）。
  //   本物の神奈川の様式で、シングルスとダブルスの「所属」が左右に並ぶ。
  //   片方にしか人を入れないと左右の境が付かず、**誰も入れていないダブルスの行に**
  //   所属だけ書く誤爆になっていた
  eq(M.nearestCols('C', [{ col: 'D', index: 0 }, { col: 'I', index: 0 }]), { '0': 'D' },
    '★ 名前の列に近いほうを選ぶ（シングルスの表は、シングルスの所属に書く）');
  eq(M.nearestCols('H', [{ col: 'D', index: 0 }, { col: 'I', index: 0 }]), { '0': 'I' },
    '★ 名前の列が右にあれば、右の所属を選ぶ');
  eq(M.nearestCols('C', [{ col: 'B', index: 0 }, { col: 'E', index: 0 }]), { '0': 'B' },
    '左右どちらでも、近いほうを選ぶ');
  eq(M.nearestCols('C', [{ col: 'D', index: 0 }, { col: 'F', index: 1 }]), { '0': 'D', '1': 'F' },
    '別の項目どうしは、それぞれ選ぶ');
  eq(M.nearestCols('C', []), {}, '当たる列が無ければ何も選ばない');

  var exSrc = fs.readFileSync(path.join(__dirname, '..', 'entry-app.js'), 'utf8');
  check(['所属', '学校名', '会社名', '学年', '身長', '段位・級位', '背番号'].every(function (w) {
    return exSrc.indexOf("'" + w + "'") >= 0;
  }), '★ 足せる項目の一覧がある（本物の様式で多かったもの＋本人の指定）');
  check(exSrc.indexOf('GENDERS.forEach(function (g) { eh[g].push(name); });') >= 0,
    '★ 項目はどの組にも同じ番号で足す（名簿ファイルの列がずれないため）');
  check(exSrc.indexOf("extraNames().forEach(function (name, i) { p.extras[i] = pfVal('extra' + i); });") >= 0,
    '1人ずつの入力から、足した項目の中身を拾う');
  check(/extraRemoveConfirm/.test(exSrc) && exSrc.indexOf('p.extras.splice(i, 1)') >= 0,
    '★ 項目を消すときは確かめてから（入れてある中身も消えるため）');
  check(exSrc.indexOf('var raw = textAt[c.col + r];') >= 0,
    '★ 照合はセルの生の文字で行う（規則が作る見出しは改行が取れている）');
  check(exSrc.indexOf("var pick = M.nearestCols(tb.nameCol || tb.familyCol || 'A', hits);") >= 0,
    '★ 画面の側も「いちばん近い1つ」を使う（当たった列ぜんぶには書かない）');
  check(exSrc.indexOf("tb.fields = tb.fields.filter(function (f) { return !(f.col === c.col && f.rowOffset === 0); });") >= 0,
    '★ 見出しがぴったり同じなら、見出しの規則より名簿の項目を優先する（誤爆を止める）');
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
