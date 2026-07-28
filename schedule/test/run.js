// schedule-parser.js を Node で直接動かし、実機のOCR結果からどう抽出されるかを目で確かめる。
//
//   node schedule/test/run.js              … 用意した予定表をすべて流す
//   node schedule/test/run.js tleague      … 名前を指定して1つだけ流す
//
// なぜ要るか:
//   GoogleのOCRは表を「1セル＝1行」に分解して返すが、その並びは予定表ごとに違う。
//   ローカルのPDFテキスト抽出とは別物なので、実機で取れたテキストでしか確かめられない。
//   `schedule-parser.js` を触ったら、修正の前後でこれを流し、件数と中身を見比べること。
var fs = require('fs');
var path = require('path');

global.window = global;
eval(fs.readFileSync(path.join(__dirname, '..', 'schedule-parser.js'), 'utf8'));

// fiscalYear は画面の「年度」欄にあたる。lang は画面の window.LANG。
// expect は現在の結果（回帰に気付くための目安）。
var FIXTURES = [
  {
    name: 'tleague', file: 'ocr-tleague.txt', fiscalYear: 2026, lang: 'ja', expect: 17,
    note: '都道府県と会場が別の列。チーム名が「静岡」「岡山」と県名に一致するのが厄介'
  },
  {
    name: 'zenkoku-shikoku', file: 'ocr-zenkoku-shikoku.txt', fiscalYear: 2026, lang: 'ja', expect: 42,
    note: '場所が「埼玉県 深谷市他」の1行の表と、「高知」＋会場の2行の表が1つの文書に混在'
  },
  {
    name: 'icc-t20', file: 'ocr-icc-t20-2026.txt', fiscalYear: 2026, lang: 'en', expect: 55,
    note: '英語。「7 Feb」＝年の記載が無い。年度で繰り上げると2027年になってしまう'
  },
  {
    name: 'uk-term-dates', file: 'ocr-uk-term-dates-2026-27.txt', fiscalYear: 2026, lang: 'en', expect: 40,
    note: '英語。月と年が見出し行「SEPTEMBER 2026」にあり、日付セルは日だけ。見出しから引き継ぐ'
  },
  {
    name: 'ipl-table', file: 'ocr-ipl-2026-table.txt', fiscalYear: 2026, lang: 'en', expect: 59,
    note: '英語。1〜2ページは1試合＝1行で日付が行の途中。3ページは列ごとに返るため取れない（59/70試合）'
  }
];

var only = process.argv[2];
var targets = FIXTURES.filter(function (f) { return !only || f.name === only; });
if (!targets.length) {
  console.log('該当なし。使えるのは: ' + FIXTURES.map(function (f) { return f.name; }).join(', '));
  process.exit(1);
}

targets.forEach(function (f) {
  var text = fs.readFileSync(path.join(__dirname, f.file), 'utf8');
  var r = window.SchedParser.parse(text, { fiscalYear: f.fiscalYear, lang: f.lang });
  console.log('===== ' + f.name + ' =====');
  console.log(f.note);
  console.log('件数: ' + r.items.length + '（目安 ' + f.expect + '）  除外: ' + r.skipped.length +
    (r.items.length === f.expect ? '' : '   ← 件数が変わっている'));
  console.log('');
  r.items.forEach(function (it, i) {
    console.log(
      String(i + 1).padStart(3) + ' | ' + it.start + (it.end ? '〜' + it.end : '　　　　　　') +
      ' | ' + (it.time || '--:--') +
      ' | 行事名=' + JSON.stringify(it.title) +
      ' | 場所=' + JSON.stringify(it.place)
    );
  });
  if (r.skipped.length) {
    console.log('');
    console.log('--- 予定にしなかった行 ---');
    r.skipped.forEach(function (s) { console.log('  ' + s.reason + ': ' + s.raw); });
  }
  console.log('');
});
