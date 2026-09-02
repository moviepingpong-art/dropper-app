#!/usr/bin/env node
'use strict';

/*
 * sync-check.js — アップロード前の同期チェック
 *
 *   node tools/sync-check.js
 *
 * CLAUDE.md に書かれている「壊すと気づきにくい」約束ごとを、まとめて機械で確かめる。
 * どれも画面には出ないので、目視では抜ける。落ちたら直してからアップロードすること。
 *
 * 見ているもの:
 *   1. 3言語フォルダの共有JSがバイト同一か（3言語同期の鉄則）
 *   2. index.html の本文が window.LANG 以外は同一か
 *   3. JSの構文
 *   4. i18n の ja / en / in にキーの過不足が無いか
 *   5. attend/ が原本（hakusan-attendance）と同一か
 *   6. LICENSE が3リポジトリで同一か
 *   7. OAuthスコープが承認済みの3つのままか
 *
 * 5・6 は隣に別リポジトリが要る。無ければその項目だけ飛ばす（落とさない）。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SIBLINGS = path.resolve(ROOT, '..');
const GROUPS = ['calendar', 'schedule', 'decide'];
const LANGS = ['ja', 'en', 'in'];

/* 2026-07-19 に本番審査を通したスコープ。増やすと再審査になる */
const APPROVED_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/calendar.events'
];

let ng = 0;
const ok      = (m) => console.log('  OK   ' + m);
const bad     = (m) => { ng++; console.log('  NG   ' + m); };
const skipped = (m) => console.log('  --   ' + m + '（飛ばした）');
const section = (t) => console.log('\n' + t);

const exists = (p) => fs.existsSync(p);

/* ---- リポジトリをまたぐ比較は「保存されている中身」を見る ----
 * この環境は core.autocrlf = true。リポジトリはLFで保存し、作業ツリーにはCRLFで展開する。
 * そのため作業ツリーのバイトを比べると、中身が同じでも改行の違いで落ちることがある
 * （実際に LICENSE で誤検知した）。git に保存されている中身どうしを比べる。
 * 同じ作業ツリーの中どうし（1・2）は同じ変換がかかるので、そのまま比べてよい。
 */
function gitShow(repo, rel) {
  try {
    return execFileSync('git', ['-C', repo, 'show', 'HEAD:' + rel], { maxBuffer: 1 << 28 });
  } catch (e) {
    return null;
  }
}
function gitFiles(repo, prefix) {
  try {
    return execFileSync('git', ['-C', repo, 'ls-files', '-z', '--', prefix], { encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\0').filter(Boolean).sort();
  } catch (e) {
    return null;
  }
}

/* ---------- 1. 3言語フォルダの共有JS ---------- */
section('1. 3言語フォルダの共有JS（バイト同一であること）');
for (const g of GROUPS) {
  const base = path.join(ROOT, g);
  if (!exists(base)) { skipped(g + '/ が無い'); continue; }
  const files = fs.readdirSync(base).filter((f) => f.endsWith('.js')).sort();
  if (files.length === 0) { skipped(g + '/ にJSが無い'); continue; }
  for (const f of files) {
    const a = fs.readFileSync(path.join(base, f));
    for (const suffix of ['-en', '-in']) {
      const p = path.join(ROOT, g + suffix, f);
      if (!exists(p)) { bad(`${g}${suffix}/${f} が無い`); continue; }
      if (a.equals(fs.readFileSync(p))) ok(`${g}${suffix}/${f}`);
      else bad(`${g}${suffix}/${f} が ${g}/${f} と違う`);
    }
  }
}

/* ---------- 2. index.html の本文 ----------
 * head の中は title / description / canonical / og / JSON-LD が言語ごとに違うのが正しい。
 * 同一でなければならないのは </head> から後ろ。window.LANG の値だけは違ってよい。
 */
section('2. index.html の本文（</head>以降。window.LANG 以外は同一であること）');
function bodyOf(file) {
  const s = fs.readFileSync(file, 'utf8');
  const i = s.indexOf('</head>');
  return (i < 0 ? s : s.slice(i))
    .replace(/window\.LANG\s*=\s*['"][a-zA-Z-]*['"]/g, 'window.LANG=LANGMARK');
}
for (const g of GROUPS) {
  const base = path.join(ROOT, g, 'index.html');
  if (!exists(base)) { skipped(g + '/index.html が無い'); continue; }
  const a = bodyOf(base);
  for (const suffix of ['-en', '-in']) {
    const p = path.join(ROOT, g + suffix, 'index.html');
    if (!exists(p)) { bad(`${g}${suffix}/index.html が無い`); continue; }
    if (bodyOf(p) === a) ok(`${g}${suffix}/index.html`);
    else bad(`${g}${suffix}/index.html の本文が ${g}/index.html と違う`);
  }
}

/* ---------- 3. 構文チェック ---------- */
section('3. JSの構文');
for (const g of GROUPS) {
  const base = path.join(ROOT, g);
  if (!exists(base)) continue;
  for (const f of fs.readdirSync(base).filter((x) => x.endsWith('.js')).sort()) {
    const p = path.join(base, f);
    try {
      execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
      ok(`${g}/${f}`);
    } catch (e) {
      bad(`${g}/${f} — ${String(e.stderr || e.message).split('\n')[0]}`);
    }
  }
}

/* ---------- 4. i18n のキーの過不足 ----------
 * 辞書は (function(global){ ... })(window) の形。window と document を用意して読み込み、
 * window.LANG を切り替えながら dict() のキーを見る。
 */
section('4. i18n のキー（ja / en / in で過不足が無いこと）');
function loadDictKeys(file) {
  const stubEl = new Proxy({}, {
    get: (t, k) => (k === 'style' ? {} : (typeof k === 'string' ? '' : undefined)),
    set: () => true
  });
  const doc = {
    readyState: 'complete',
    documentElement: {},
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return stubEl; }
  };
  const win = { document: doc };
  win.window = win;
  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  if (!ctx.I18N || typeof ctx.I18N.dict !== 'function') return null;
  const out = {};
  for (const lang of LANGS) {
    ctx.LANG = lang;
    out[lang] = Object.keys(ctx.I18N.dict());
  }
  return out;
}
for (const g of GROUPS) {
  const base = path.join(ROOT, g);
  if (!exists(base)) continue;
  const f = fs.readdirSync(base).find((x) => /i18n\.js$/.test(x));
  if (!f) { skipped(g + '/ に i18n が無い'); continue; }
  let keys;
  try {
    keys = loadDictKeys(path.join(base, f));
  } catch (e) {
    bad(`${g}/${f} を読み込めない — ${e.message}`);
    continue;
  }
  if (!keys) { bad(`${g}/${f} が I18N.dict を出していない`); continue; }
  /* ja を基準に、en / in の過不足を見る */
  const ref = new Set(keys.ja);
  let drift = false;
  for (const lang of ['en', 'in']) {
    const has = new Set(keys[lang]);
    const missing = keys.ja.filter((k) => !has.has(k));
    const extra = keys[lang].filter((k) => !ref.has(k));
    if (missing.length) { bad(`${g}/${f} の ${lang} に足りないキー ${missing.length}件: ${missing.slice(0, 8).join(', ')}`); drift = true; }
    if (extra.length) { bad(`${g}/${f} の ${lang} に余分なキー ${extra.length}件: ${extra.slice(0, 8).join(', ')}`); drift = true; }
  }
  if (!drift) ok(`${g}/${f}（${keys.ja.length}キー × 3言語）`);
}

/* ---------- 5. attend/ が原本と同一か ----------
 * 原本は hakusan-attendance。こちらは配信用のコピーで、バイト単位で同一に保つ。
 */
section('5. attend/（原本 hakusan-attendance と同一であること）');
const originRepo = path.join(SIBLINGS, 'hakusan-attendance');
const mineFiles = gitFiles(ROOT, 'attend/');
const originFiles = exists(originRepo) ? gitFiles(originRepo, 'attend/') : null;
if (!mineFiles || mineFiles.length === 0) skipped('attend/ が無い');
else if (!originFiles) skipped('隣に hakusan-attendance が無い');
else {
  const onlyMine = mineFiles.filter((f) => !originFiles.includes(f));
  const onlyOrigin = originFiles.filter((f) => !mineFiles.includes(f));
  onlyMine.forEach((f) => bad(`${f} は原本に無い`));
  onlyOrigin.forEach((f) => bad(`${f} が原本にあるのに欠けている`));
  let diff = 0;
  for (const f of mineFiles.filter((x) => originFiles.includes(x))) {
    const a = gitShow(ROOT, f);
    const b = gitShow(originRepo, f);
    if (!a || !b) { bad(`${f} を git から取り出せない`); diff++; continue; }
    if (!a.equals(b)) { bad(`${f} が原本と違う`); diff++; }
  }
  if (!diff && !onlyMine.length && !onlyOrigin.length) ok(`${mineFiles.length}ファイルすべて原本と同一`);
}

/* ---------- 6. LICENSE が3リポジトリで同一か ---------- */
section('6. LICENSE（dropper / dropper-app / hakusan-attendance で同一であること）');
const licenseRepos = [
  ['dropper-app', ROOT],
  ['dropper', path.join(SIBLINGS, 'dropper')],
  ['hakusan-attendance', path.join(SIBLINGS, 'hakusan-attendance')]
].filter(([, r]) => exists(r));
const licenses = licenseRepos
  .map(([name, repo]) => [name, gitShow(repo, 'LICENSE')])
  .filter(([, buf]) => buf);
if (licenses.length < 2) skipped('隣のリポジトリが無いので比べられない');
else {
  const [refName, ref] = licenses[0];
  let drift = false;
  for (const [name, buf] of licenses.slice(1)) {
    if (buf.equals(ref)) continue;
    drift = true;
    bad(`${name} の LICENSE が ${refName} と違う`);
  }
  if (!drift) ok(`${licenses.length}リポジトリで同一`);
}

/* ---------- 7. OAuthスコープ ---------- */
section('7. OAuthスコープ（審査済みの3つから増やさないこと）');
const appJs = path.join(ROOT, 'calendar', 'app.js');
if (!exists(appJs)) skipped('calendar/app.js が無い');
else {
  const m = /var\s+BASE_SCOPES\s*=\s*\[([\s\S]*?)\]/.exec(fs.readFileSync(appJs, 'utf8'));
  if (!m) bad('BASE_SCOPES が見つからない');
  else {
    const found = (m[1].match(/'([^']+)'|"([^"]+)"/g) || []).map((s) => s.slice(1, -1));
    const added = found.filter((s) => !APPROVED_SCOPES.includes(s));
    const lost = APPROVED_SCOPES.filter((s) => !found.includes(s));
    if (added.length) bad('承認されていないスコープが増えている: ' + added.join(', ') + ' → 再審査（数週間）が要る。コミットせずユーザーに確認すること');
    if (lost.length) bad('承認済みのスコープが消えている: ' + lost.join(', '));
    if (!added.length && !lost.length) ok('審査済みの3つのまま');
  }
}

/* ---------- まとめ ---------- */
console.log('\n' + '='.repeat(56));
if (ng === 0) {
  console.log('すべて通った。アップロードしてよい。');
  process.exit(0);
}
console.log(`${ng}件が引っかかった。直してからアップロードすること。`);
process.exit(1);
