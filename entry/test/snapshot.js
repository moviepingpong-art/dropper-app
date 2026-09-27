// 申込書ドロッパー — 本物の様式をまとめて通し、前に承認した結果と比べる（2026-09-27）
//
//   node entry/test/snapshot.js --forms <様式のフォルダ> [--forms <別のフォルダ> …] --out <結果のフォルダ>
//   node entry/test/snapshot.js --forms … --out … --approve [ファイル名 …]
//
// ★ 規則は、作った人が中身を知っている様式で測ると当たりすぎる（README「踏んだ罠」）。
//   run.js が本物で確かめているのは百万石とスポレクだけなので、初めての様式をたくさん通して
//   「規則を直したら、どの様式の、どの欄が変わったか」だけを見られるようにする。
//
// - 様式・結果は**リポジトリの外**に置く（主催者の文書とその見出し。public リポジトリには入れない）。
//   フォルダが無ければ何もせずに終わる
// - 1様式ずつ、アプリの ③〜④ と同じ道を通す：架空の名簿（fixtures/roster.xlsx）で名前を探し、
//   無ければ空の様式として表を見つけ、各表の1〜2行目に架空の人を選んだことにして、見出しの規則で欄の対応を作る
// - 結果は <out>/current/ に1様式1ファイル。<out>/approved/ と比べ、違いを「- 前 / + 今」で並べる。
//   違いがあれば終了コード 1、無ければ 0
// - --approve：current を approved に写す（ファイル名を並べれば、その様式だけ）。**違いを見て、良くなったと確かめてから**
//
// 規則（entry-*.js）には手を入れない。読むだけ。通信もしない。

var fs = require('fs');
var path = require('path');

global.window = global;
['entry-xlsx.js', 'entry-roster.js', 'entry-rules.js', 'entry-map.js', 'entry-book.js', 'entry-blank.js']
  .forEach(function (f) { eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')); });
var X = window.EntryXlsx, R = window.EntryRoster, RU = window.EntryRules, M = window.EntryMap,
    B = window.EntryBook, BL = window.EntryBlank;

function args() {
  var a = process.argv.slice(2), o = { forms: [], out: '', approve: null };
  for (var i = 0; i < a.length; i++) {
    if (a[i] === '--forms') o.forms.push(a[++i]);
    else if (a[i] === '--out') o.out = a[++i];
    else if (a[i] === '--approve') o.approve = [];
    else if (o.approve) o.approve.push(a[i]);
  }
  return o;
}

// 表と欄の対応を、見比べやすい形にする（並びと書き方を固定する。違いの行が読めるように）
function tableOf(mt, blankTb) {
  var t = {
    name: mt.nameCol ? mt.nameCol : mt.familyCol + '+' + mt.givenCol,
    rows: mt.firstRow + '-' + mt.lastRow,
    fields: mt.fields.map(function (f) {
      return f.col + (f.rowOffset ? '(' + f.rowOffset + ')' : '') + ' ' + f.field + (f.header ? ' 「' + f.header + '」' : '');
    }),
    undecided: (mt.cols || []).filter(function (c) { return !c.field; })
      .map(function (c) { return c.col + (c.header ? ' 「' + String(c.header).slice(0, 40) + '」' : ''); })
  };
  if (mt.pairSize > 1) t.pair = mt.pairSize;
  if (mt.eventCol) t.event = mt.eventCol;
  if (mt.ageSumCol) t.ageSum = mt.ageSumCol;
  if (blankTb) {
    t.writable = blankTb.rows.length;
    if (blankTb.label) t.label = blankTb.label;
  }
  return t;
}

function sheetOf(book, i, s, roster) {
  var out = { sheet: s.name };
  if (s.state && s.state !== 'visible') { out.route = 'hidden'; return out; }
  var cells = X.cells(book, i);
  var merges = X.merges(book, i);
  var found = R.findNames(cells, roster);
  var tables = null;
  if (!found.names.length && !found.suspects.length) {
    // 空の申込書（アプリの analyze と同じ）
    tables = BL.tables(X.grid(book, i));
    var usable = tables.filter(function (tb) { return !tb.skip; });
    if (!usable.length) {
      out.route = BL.isExampleName(s.name) ? 'example-sheet' : (tables.length ? 'refused' : 'no-table');
      if (tables.length) out.refused = tables.map(function (tb) { return tb.skip; });
      return out;
    }
    out.route = 'blank';
    if (usable.length < tables.length) out.refused = tables.filter(function (tb) { return tb.skip; }).map(function (tb) { return tb.skip; });
    // 各表の1〜2行目に架空の人を選んだことにする（アプリの foundFromPicks と同じ形）
    var names = [];
    usable.forEach(function (tb) {
      roster.members.slice(0, 2).forEach(function (m, k) {
        var row = tb.rows[k];
        if (!row) return;
        var refs = tb.nameCol ? [tb.nameCol + row] : [tb.familyCol + row, tb.givenCol + row];
        names.push({ refs: refs, row: row, col: X.parseRef(refs[0]).col, text: m.name, match: { status: 'exact', member: m } });
      });
    });
    found = { names: names, suspects: [], duplicates: [] };
    tables = usable;
  } else {
    out.route = 'names';
  }
  var mp = M.normalize(RU.map(cells, merges, found));
  out.tables = mp.tables.map(function (mt, k) {
    // 空の様式の道では、見つけた表と規則の表を名前の列で突き合わせる
    var bt = tables && tables.filter(function (tb) {
      return (tb.nameCol || tb.familyCol) === (mt.nameCol || mt.familyCol);
    })[0];
    return tableOf(mt, bt);
  });
  if (mp.baseDateRaw) out.baseDate = mp.baseDateRaw;
  if (mp.ageClassesRaw) out.ageClasses = mp.ageClassesRaw;
  if (mp.feeRaw) out.fee = mp.feeRaw;
  if (mp.problems.length) out.problems = mp.problems.map(function (p) { return p.code; });
  return out;
}

// 違いを見るための行（1行＝1つの事実）
function linesOf(snap) {
  var lines = [];
  (snap.sheets || []).forEach(function (s) {
    var head = s.sheet;
    lines.push(head + ' | 道: ' + s.route + (s.refused ? ' 断った表: ' + s.refused.join(',') : ''));
    ['baseDate', 'ageClasses', 'fee'].forEach(function (k) { if (s[k]) lines.push(head + ' | ' + k + ': ' + s[k]); });
    (s.problems || []).forEach(function (p) { lines.push(head + ' | 問題: ' + p); });
    (s.tables || []).forEach(function (t) {
      // 表は「名前の列＋最初の行」で呼ぶ（t.rows は試しに人を入れた行で、表の大きさではない）
      var th = head + ' | 表 ' + t.name + t.rows.split('-')[0] + '〜';
      lines.push(th + (t.label ? ' 「' + t.label + '」' : '') + (t.writable != null ? ' 書ける' + t.writable + '行' : '') +
        (t.pair ? ' ' + t.pair + '人1組' : '') + (t.event ? ' 種目' + t.event : '') + (t.ageSum ? ' 合計年齢' + t.ageSum : ''));
      t.fields.forEach(function (f) { lines.push(th + ' | 書く ' + f); });
      t.undecided.forEach(function (c) { lines.push(th + ' | 決めない ' + c); });
    });
  });
  if (snap.error) lines.push('読めなかった: ' + snap.error);
  return lines;
}

function main() {
  var o = args();
  var dirs = o.forms.filter(function (d) { return d && fs.existsSync(d); });
  if (!o.out || !dirs.length) {
    console.log('様式のフォルダが無いので何もしない（--forms <フォルダ> --out <フォルダ>）');
    return Promise.resolve(0);
  }
  var cur = path.join(o.out, 'current'), app = path.join(o.out, 'approved');
  [o.out, cur, app].forEach(function (d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

  if (o.approve) {
    var names = o.approve.length ? o.approve : fs.readdirSync(cur);
    names.forEach(function (n) {
      var f = /\.json$/.test(n) ? n : n + '.json';
      fs.copyFileSync(path.join(cur, f), path.join(app, f));
      console.log('承認した: ' + f);
    });
    return Promise.resolve(0);
  }

  var files = [];
  dirs.forEach(function (d) {
    fs.readdirSync(d).filter(function (f) { return /\.xlsx$/i.test(f) && !/^~\$/.test(f); }).sort()
      .forEach(function (f) { files.push(path.join(d, f)); });
  });

  return X.open(fs.readFileSync(path.join(__dirname, 'fixtures', 'roster.xlsx'))).then(function (rb) {
    var roster = B.toRoster(B.read(rb).people);
    var changed = 0, fresh = 0, same = 0;
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        var base = path.basename(file) + '.json';
        return X.open(fs.readFileSync(file)).then(function (book) {
          return { file: path.basename(file), sheets: book.sheets.map(function (s, i) { return sheetOf(book, i, s, roster); }) };
        }).catch(function (e) {
          return { file: path.basename(file), error: String(e && (e.code || e.message) || e) };
        }).then(function (snap) {
          fs.writeFileSync(path.join(cur, base), JSON.stringify(snap, null, 1) + '\n');
          var ap = path.join(app, base);
          if (!fs.existsSync(ap)) { fresh++; console.log('\n★ 承認済みが無い: ' + snap.file); linesOf(snap).forEach(function (l) { console.log('    ' + l); }); return; }
          var before = linesOf(JSON.parse(fs.readFileSync(ap, 'utf8'))), now = linesOf(snap);
          var gone = before.filter(function (l) { return now.indexOf(l) < 0; });
          var added = now.filter(function (l) { return before.indexOf(l) < 0; });
          if (!gone.length && !added.length) { same++; return; }
          changed++;
          console.log('\n● 変わった: ' + snap.file);
          gone.forEach(function (l) { console.log('  - ' + l); });
          added.forEach(function (l) { console.log('  + ' + l); });
        });
      });
    });
    return chain.then(function () {
      console.log('\n' + files.length + '件: 変化なし ' + same + ' / 変わった ' + changed + ' / 承認済みが無い ' + fresh);
      if (changed || fresh) console.log('違いを見て、良くなったと確かめてから --approve で承認する');
      return changed || fresh ? 1 : 0;
    });
  });
}

main().then(function (code) { process.exitCode = code; }, function (e) {
  console.log('止まった: ' + (e && e.stack || e));
  process.exitCode = 1;
});
