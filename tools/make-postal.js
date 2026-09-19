#!/usr/bin/env node
// make-postal.js — 日本郵便の郵便番号データから、申込書ドロッパーの住所の自動入力に使うデータを作る
//
//   node tools/make-postal.js <utf_ken_all.csv> <更新日 YYYY-MM-DD>
//   → entry/postal/0.json 〜 9.json      郵便番号 → 住所（郵便番号の先頭1桁ごと）
//   → entry/postal/rev/01.json 〜 47.json 住所 → 郵便番号（都道府県ごと。番号は全国地方公共団体コードの上2桁）
//
// 元データ: 日本郵便「住所の郵便番号（1レコード1行、UTF-8形式）（CSV形式）」の utf_ken_all.zip を展開した CSV。
//   https://www.post.japanpost.jp/service/search/zipcode/download/utf-zip.html
//   「郵便番号データに限っては日本郵便株式会社は著作権を主張しません。自由に配布していただいて結構です。」
//   （https://www.post.japanpost.jp/service/search/zipcode/download/utf-readme.html）
//   CSV そのものはリポジトリに入れない。更新日はダウンロードしたページの表記を渡す。
//
// 使う列（0 始まり）: 2 郵便番号7桁 / 6 都道府県 / 7 市区町村 / 8 町域名（どれも漢字）/ 13 更新フラグ（2 は廃止）
//
// ★ 町域名には、住所に書いてはいけない文字が混じっている（2026-09-16 に数えた）
//   - 「以下に掲載がない場合」1,870件 /「○○市の次に番地がくる場合」17件 /「○○村一円」22件 → 町域は空
//     ただし滋賀県多賀町の「一円」は本当の地名なので残す（市区町村名 + 一円 のときだけ空にする）
//   - 括弧書き 約5,000件（常盤（その他）・中央アエル（１階）・川井（第９地割〜第１１地割））→ 括弧から後ろを取り除く
// ★ 取り除くと、1つの郵便番号に町域が2つ以上残ることがある（1,267個。うち134個は市区町村から違う）。
//   1つに決めず、すべて候補として残す（画面で選ばせる）
//
// 出力の形（1桁ぶん）:
//   { "source": "…", "updated": "2026-08-31", "digit": "9",
//     "places": [["石川県","白山市"], …],                 … 都道府県と市区町村の組は1回だけ書く
//     "codes": { "240001": [[番号, "八田町"]], … } }      … 郵便番号の残り6桁 → [places の番号, 町域] の候補
'use strict';
const fs = require('fs');
const path = require('path');

const SOURCE = '日本郵便 郵便番号データ（住所の郵便番号 1レコード1行 UTF-8形式）';

function parseLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// 町域名から、住所に書かない文字を取り除く
function cleanTown(city, town) {
  if (town === '以下に掲載がない場合') return '';
  if (/の次に番地がくる場合$/.test(town)) return '';
  if (town === city + '一円') return '';
  const i = town.indexOf('（');
  return i >= 0 ? town.slice(0, i) : town;
}

// CSV の文字列 → { digit: chunk }
function build(csvText, updated) {
  const text = csvText.charCodeAt(0) === 0xFEFF ? csvText.slice(1) : csvText;
  const chunks = {};
  const seen = {};
  text.split(/\r?\n/).forEach(function (line) {
    if (!line) return;
    const r = parseLine(line);
    if (r.length < 14) throw new Error('列の数が足りない行: ' + line.slice(0, 60));
    const code = r[2];
    if (!/^\d{7}$/.test(code)) throw new Error('郵便番号が7桁でない行: ' + line.slice(0, 60));
    if (r[13] === '2') return;   // 廃止
    const pref = r[6], city = r[7], town = cleanTown(city, r[8]);
    const d = code[0];
    const c = chunks[d] = chunks[d] || { source: SOURCE, updated: updated, digit: d, places: [], codes: {}, placeIdx: {} };
    const pk = pref + '\t' + city;
    if (!(pk in c.placeIdx)) { c.placeIdx[pk] = c.places.length; c.places.push([pref, city]); }
    const key = code + '\t' + pk + '\t' + town;
    if (seen[key]) return;   // 括弧を取り除いて同じになった候補は1つにする
    seen[key] = true;
    const rest = code.slice(1);
    (c.codes[rest] = c.codes[rest] || []).push([c.placeIdx[pk], town]);
  });
  Object.keys(chunks).forEach(function (d) {
    const c = chunks[d];
    delete c.placeIdx;
    const sorted = {};
    Object.keys(c.codes).sort().forEach(function (k) { sorted[k] = c.codes[k]; });
    c.codes = sorted;
  });
  return chunks;
}

// 住所 → 郵便番号（都道府県ごと）
// { source, updated, code: '17', pref: '石川県', towns: { '白山市八田町': [['9240001', '（但し書き）']] } }
// ★ 但し書き（括弧書き）は、逆引きのときだけ残す。「次のビルを除く」などは、どの番号か選ぶ手がかりになる
function buildRev(csvText, updated) {
  const text = csvText.charCodeAt(0) === 0xFEFF ? csvText.slice(1) : csvText;
  const out = {};
  text.split(/\r?\n/).forEach(function (line) {
    if (!line) return;
    const r = parseLine(line);
    if (r.length < 14 || r[13] === '2') return;
    const jis = String(r[0]).slice(0, 2);
    if (!/^\d{2}$/.test(jis)) throw new Error('全国地方公共団体コードが読めない行: ' + line.slice(0, 60));
    const pref = r[6], city = r[7], raw = r[8];
    const town = cleanTown(city, raw);
    const i = raw.indexOf('（');
    const note = (i >= 0 && town) ? raw.slice(i) : '';
    const p = out[jis] = out[jis] || { source: SOURCE, updated: updated, code: jis, pref: pref, towns: {} };
    const key = city + town;
    const list = p.towns[key] = p.towns[key] || [];
    if (!list.some(function (x) { return x[0] === r[2] && x[1] === note; })) list.push([r[2], note]);
  });
  Object.keys(out).forEach(function (jis) {
    const p = out[jis];
    const sorted = {};
    Object.keys(p.towns).sort().forEach(function (k) { sorted[k] = p.towns[k]; });
    p.towns = sorted;
  });
  return out;
}

function main() {
  const csv = process.argv[2], updated = process.argv[3];
  if (!csv || !/^\d{4}-\d{2}-\d{2}$/.test(updated || '')) {
    console.error('使い方: node tools/make-postal.js <utf_ken_all.csv> <更新日 YYYY-MM-DD>');
    process.exit(2);
  }
  const chunks = build(fs.readFileSync(csv, 'utf8'), updated);
  const outDir = path.join(__dirname, '..', 'entry', 'postal');
  fs.mkdirSync(outDir, { recursive: true });
  let codes = 0, multi = 0, bytes = 0;
  '0123456789'.split('').forEach(function (d) {
    const c = chunks[d];
    if (!c) throw new Error('先頭 ' + d + ' の郵便番号が1つも無い（CSV が途中で切れていないか）');
    const body = JSON.stringify(c) + '\n';
    fs.writeFileSync(path.join(outDir, d + '.json'), body, 'utf8');
    const n = Object.keys(c.codes).length;
    codes += n;
    multi += Object.keys(c.codes).filter(function (k) { return c.codes[k].length > 1; }).length;
    bytes += Buffer.byteLength(body);
    console.log(d + '.json  ' + n + ' 個  ' + Buffer.byteLength(body) + ' バイト');
  });
  console.log('郵便番号 ' + codes + ' 個（候補が2つ以上: ' + multi + ' 個）、合計 ' + bytes + ' バイト、更新日 ' + updated);

  // 住所 → 郵便番号
  const revDir = path.join(outDir, 'rev');
  fs.mkdirSync(revDir, { recursive: true });
  const rev = buildRev(fs.readFileSync(csv, 'utf8'), updated);
  const jisList = Object.keys(rev).sort();
  if (jisList.length !== 47) throw new Error('都道府県が47ではない（' + jisList.length + '）');
  let towns = 0, revMulti = 0, revBytes = 0;
  jisList.forEach(function (jis) {
    const p = rev[jis];
    const body = JSON.stringify(p) + '\n';
    fs.writeFileSync(path.join(revDir, jis + '.json'), body, 'utf8');
    const keys = Object.keys(p.towns);
    towns += keys.length;
    revMulti += keys.filter(function (k) {
      const cs = p.towns[k].map(function (x) { return x[0]; });
      return cs.filter(function (v, i, a) { return a.indexOf(v) === i; }).length > 1;
    }).length;
    revBytes += Buffer.byteLength(body);
  });
  console.log('逆引き: 都道府県47、住所 ' + towns + ' 種類（郵便番号が2つ以上: ' + revMulti + ' 種類）、合計 ' + revBytes + ' バイト');

  // 古いファイルが残っていないか（都道府県が減ることは無いが、作り方を変えたときの取り残しを見る）
  fs.readdirSync(revDir).forEach(function (f) {
    if (!/^\d{2}\.json$/.test(f)) console.log('!! 見覚えのないファイルが rev/ にあります: ' + f);
  });
}

if (require.main === module) main();
module.exports = { parseLine: parseLine, cleanTown: cleanTown, build: build, buildRev: buildRev };
