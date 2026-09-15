// 本物の Gemini に、試験用の様式の「欄の対応」を作らせて、期待どおりか確かめる。
//
//   PowerShell:  $env:GEMINI_API_KEY = '（自分のキー）'; node entry/test/live-ai.js
//   Git Bash:    GEMINI_API_KEY=（自分のキー） node entry/test/live-ai.js
//   使えるモデルの一覧だけ出す:  node entry/test/live-ai.js --models
//   モデルを1つに決めて試す:     node entry/test/live-ai.js --model gemini-flash-lite-latest
//     （予備のモデルの質を確かめるとき。主モデルが混んでいなくても、そのモデルだけに聞く）
//
// ★ キーは環境変数からだけ読む。ファイルに書かない・画面に出さない・コミットしない。
// ★ 送るのは架空の試験用データ（fixtures/）を伏せ字にしたものだけ。本物の名簿は使わない。
//   送る直前に entry-ai.js の関所（guard）も通る。
//
// run.js は偽の応答で「当てはめ方」を確かめる。こちらは「説明文（プロンプト）が AI に伝わるか」を確かめる。
// AI の答えは毎回少し揺れるので、落ちたら差分を見て、プロンプトを直すか、期待のほうが厳しすぎるかを判断する。
// 無料枠を1回あたり4リクエストほど使う（5秒おき）。
var fs = require('fs');
var path = require('path');

global.window = global;
['entry-xlsx.js', 'entry-roster.js', 'entry-ai.js'].forEach(function (f) {
  eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
});
var X = window.EntryXlsx, R = window.EntryRoster, AI = window.EntryAI;

var key = process.env.GEMINI_API_KEY;
if (!key) { console.log('GEMINI_API_KEY が設定されていません（先頭のコメントを参照）'); process.exit(1); }

// ===== 使えるモデルの一覧（ListModels。generateContent の無料枠は消費しない） =====
if (process.argv.indexOf('--models') >= 0) {
  fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=' + encodeURIComponent(key))
    .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
    .then(function (res) {
      if (res.status !== 200) { console.log('一覧を取れませんでした: HTTP ' + res.status); process.exit(1); }
      var names = (res.body.models || [])
        .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; })
        .map(function (m) { return m.name.replace(/^models\//, ''); })
        .filter(function (n) { return /flash/i.test(n); })
        .sort();
      console.log('generateContent に使える flash 系のモデル（' + names.length + '件）:');
      names.forEach(function (n) { console.log('  ' + n + (AI.MODELS.indexOf(n) >= 0 ? '   ← いま MODELS に入っている' : '')); });
      AI.MODELS.forEach(function (n) { if (names.indexOf(n) < 0) console.log('  ★ MODELS の ' + n + ' は一覧に無い'); });
    });
  return;
}

// --model 名前: MODELS をその1つだけにする（試験用。entry-ai.js の MODELS は同じ配列なので中身を差し替える）
var mi = process.argv.indexOf('--model');
if (mi >= 0) {
  var only = process.argv[mi + 1];
  if (!only) { console.log('--model の後にモデル名を書いてください'); process.exit(1); }
  AI.MODELS.splice(0, AI.MODELS.length, only);
}
console.log('聞くモデル: ' + AI.MODELS.join(' → '));

var FIX = path.join(__dirname, 'fixtures');
var LOCAL = path.join(__dirname, 'local');
var EXPECTED = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected-maps.json'), 'utf8'));

// 本物の百万石の様式があれば、それも試す（期待は様式Bと同じ形）
var localFile = fs.existsSync(LOCAL) && fs.readdirSync(LOCAL).filter(function (f) { return /百万石.*\.xlsx$/.test(f); })[0];
var jobs = ['A', 'B', 'C'].map(function (k) {
  return { label: '様式' + k, file: path.join(FIX, EXPECTED[k].file), sheet: EXPECTED[k].sheet, answer: EXPECTED[k].answer };
});
if (localFile) {
  jobs.push({ label: '本物の百万石（個人戦）', file: path.join(LOCAL, localFile), sheet: 'ラージ個人戦申込書',
    typed: { C14: '山田太郎', C15: '山田　花子', C16: '伊藤 美穂', C17: '田中誠' },
    answer: EXPECTED.B.answer, compareSlotsOnly: true });
}

var ng = 0;
function show(label, a, e) {
  var sa = JSON.stringify(a), se = JSON.stringify(e);
  if (sa === se) { console.log('  OK   ' + label); return; }
  ng++;
  console.log('  NG   ' + label + '\n         期待: ' + se + '\n         AI  : ' + sa);
}
function fieldText(f) { return f.field + '@' + f.ref + (f.fmt ? '(' + f.fmt + ')' : '') + (f.mark ? '[' + f.mark + ']' : ''); }

// 名前ごとの欄を比べ、違うところだけ出す（全部並べると画面に収まらない）
function showSlots(got, want) {
  var diffs = [];
  var n = Math.max(got.length, want.length);
  for (var i = 0; i < n; i++) {
    var g = (got[i] || { fields: [] }).fields.map(fieldText);
    var w = (want[i] || { fields: [] }).fields.map(fieldText);
    var who = ((want[i] || got[i]).name || {}).refs;
    var missing = w.filter(function (x) { return g.indexOf(x) < 0; });
    var extra = g.filter(function (x) { return w.indexOf(x) < 0; });
    if (missing.length || extra.length) {
      diffs.push('名前 ' + (who ? who.join('+') : '#' + i) + (missing.length ? '  期待にあってAIに無い: ' + missing.join(', ') : '') +
        (extra.length ? '  AIだけ: ' + extra.join(', ') : ''));
    }
  }
  if (!diffs.length) { console.log('  OK   欄の対応（' + want.length + '人ぶん）'); return; }
  ng++;
  console.log('  NG   欄の対応（' + diffs.length + '人に差）');
  diffs.forEach(function (d) { console.log('         ' + d); });
}

X.open(fs.readFileSync(path.join(FIX, 'roster.xlsx'))).then(function (rb) {
  var roster = R.load(R.rowsFromCells(X.cells(rb, 0)));
  return jobs.reduce(function (p, job) {
    return p.then(function () {
      return X.open(fs.readFileSync(job.file)).then(function (book) {
        if (job.typed) Object.keys(job.typed).forEach(function (ref) { X.setCell(book, job.sheet, ref, job.typed[ref]); });
        var cells = X.cells(book, job.sheet);
        var found = R.findNames(cells, roster);
        var names = found.names.concat(found.suspects).sort(function (a, b) { return a.row - b.row || a.col - b.col; });
        var lay = AI.layout(job.sheet, cells, X.merges(book, job.sheet), found);
        var anchorOf = function (r) { return X.anchorOf(book, job.sheet, r); };
        console.log('\n' + job.label);
        var raw = null;
        var onStatus = function (s, detail) {
          if (s === 'fallback') console.log('  --   予備のモデルへ: ' + detail);
          if (s === 'answer') raw = detail;
        };
        return AI.map(lay, { apiKey: key, roster: roster, found: found, onStatus: onStatus }).then(function (got) {
          var want = AI.normalize(job.answer);
          if (got.problems.length) {
            console.log('  --   AI の答えから捨てたもの: ' + JSON.stringify(got.problems));
            // 推測で直さないために、捨てる前の答えの実物を出す（名前は最初から入っていない）
            console.log('  --   AI の答え（整える前）: ' + JSON.stringify(raw && raw.tables));
          }
          var slotsGot = AI.slotsFor(got, names, { cells: cells, anchorOf: anchorOf });
          var slotsWant = AI.slotsFor(want, names, { cells: cells, anchorOf: anchorOf });
          showSlots(slotsGot.slots, slotsWant.slots);
          show('合計年齢の欄', slotsGot.groups.map(function (g) { return g.ageSum + '=' + g.slots.join('+'); }),
            slotsWant.groups.map(function (g) { return g.ageSum + '=' + g.slots.join('+'); }));
          if (slotsGot.problems.length) console.log('  --   当てはめで書かなかった欄: ' + JSON.stringify(slotsGot.problems));
          show('基準日', got.baseDate, want.baseDate);
          // extras は画面で「名簿に無い項目です」と知らせるための情報。書き込みには使わないので NG にしない
          // （都道府県名・チーム名のような団体の欄を挙げるかは、AI によって揺れる。どちらも誤りではない）
          console.log('  --   名簿から埋められない欄: ' + (got.extras.map(function (x) { return x.col + ' ' + x.label; }).join(' / ') || 'なし'));
        }, function (e) {
          ng++;
          console.log('  NG   ' + (e.code || e.message));
        });
      });
    });
  }, Promise.resolve());
}).then(function () {
  console.log('\n' + (ng ? 'NG が ' + ng + ' 件' : 'すべて OK'));
  process.exit(ng ? 1 : 0);
}).catch(function (e) { console.error(e); process.exit(1); });
