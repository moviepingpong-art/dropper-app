// entry-postal.js — 申込書ドロッパーの名簿づくりで、郵便番号から住所を引く
//
// データは日本郵便の郵便番号データを tools/make-postal.js で変換したもの（entry/postal/0.json 〜 9.json）。
// ★ 読み込むのは、このサイトに置いた postal/ のファイルだけ。外部の住所検索サービスには何も送らない。
//   ファイルは郵便番号の先頭1桁ごとなので、サイトを置いている GitHub に分かるのは先頭1桁まで。
//   entry/test/run.js が「postal/ を読むこと以外の通信が無い」ことを確かめている。
//   ここの fetch の行を変えるときは、run.js の確かめ方も合わせて直すこと。
// ★ 1つの郵便番号に町域が2つ以上あることがある（蘇我／蘇我町、あきる野市／日の出町）。1つに決めず候補をすべて返す。
//
// ★ 逆（住所 → 郵便番号）もできる。データは都道府県ごと（postal/rev/01.json〜47.json）。
//   番地まで入っていても、町名の部分で当たる（いちばん長く前から一致する住所を採る）。
//   ★ 当たるのは町名まで。同じ町名に郵便番号が2つ以上あることがある（119,163 種類中 1,063 種類）ので、
//   そのときは候補を返して画面で選ばせる。
//
// window.EntryPostal = { normalize, fromChunk, lookup, PREFS, prefCode, cleanAddress, fromPrefData, lookupPostal } を公開する。
(function (global) {
  'use strict';

  var BASE = 'postal/';
  var cache = {};

  // 入力された郵便番号を7桁の数字にする。7桁にならなければ null
  // 全角数字・ハイフンの類・〒・空白は受け付ける
  function normalize(input) {
    var s = String(input == null ? '' : input);
    if (s.normalize) s = s.normalize('NFKC');
    s = s.replace(/〒|[\s\-‐‑‒–—―−ー－]/g, '');
    return /^\d{7}$/.test(s) ? s : null;
  }

  // 1桁ぶんのデータから候補を取り出す
  function fromChunk(chunk, code) {
    var list = chunk && chunk.codes && chunk.codes[code.slice(1)];
    if (!list) return [];
    return list.map(function (e) {
      var place = chunk.places[e[0]] || ['', ''];
      return { pref: place[0], city: place[1], town: e[1] };
    });
  }

  function fetchChunk(digit) {
    return fetch(BASE + digit + '.json', { credentials: 'omit' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  // 郵便番号 → Promise<{ code, candidates: [{ pref, city, town }], updated }>
  // 7桁にならない入力は error.code = 'postal-bad'、データを読めなければ 'postal-load'
  // load は試験用（既定はこのサイトの postal/ を読む）
  function lookup(input, load) {
    var code = normalize(input);
    if (!code) {
      var bad = new Error('postal-bad');
      bad.code = 'postal-bad';
      return Promise.reject(bad);
    }
    var d = code[0];
    if (!cache[d]) {
      cache[d] = (load || fetchChunk)(d).catch(function (e) {
        delete cache[d];   // 次に入れ直したとき、もう一度読みに行けるように
        var err = new Error('postal-load');
        err.code = 'postal-load';
        err.cause = e;
        throw err;
      });
    }
    return cache[d].then(function (chunk) {
      return { code: code, candidates: fromChunk(chunk, code), updated: chunk.updated || '' };
    });
  }

  // ===== 住所 → 郵便番号 =====
  // 全国地方公共団体コードの上2桁の順（01 北海道 〜 47 沖縄県）。ファイル名がこの番号
  var PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県',
    '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
    '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
    '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県',
    '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];
  var revCache = {};

  // 都道府県名 → '17' の形。知らない名前なら null
  function prefCode(pref) {
    var s = String(pref == null ? '' : pref);
    if (s.normalize) s = s.normalize('NFKC');
    s = s.replace(/\s/g, '');
    var i = PREFS.indexOf(s);
    return i < 0 ? null : ('0' + (i + 1)).slice(-2);
  }

  // 住所の文字をそろえる。数字は全角も半角も同じに扱う（町名に全角の数字が入る住所があるため）
  function cleanAddress(s) {
    s = String(s == null ? '' : s);
    if (s.normalize) s = s.normalize('NFKC');
    return s.replace(/\s/g, '');
  }

  // 都道府県ぶんのデータから、いちばん長く前から一致する住所を探す
  function fromPrefData(data, address) {
    var typed = cleanAddress(address);
    if (!typed || !data || !data.towns) return null;
    var best = null;
    Object.keys(data.towns).forEach(function (key) {
      var k = cleanAddress(key);
      if (!k || typed.indexOf(k) !== 0) return;
      if (!best || k.length > cleanAddress(best).length) best = key;
    });
    if (!best) return null;
    return { matched: best, candidates: data.towns[best].map(function (x) { return { code: x[0], note: x[1] || '' }; }) };
  }

  function fetchPref(code) {
    return fetch(BASE + 'rev/' + code + '.json', { credentials: 'omit' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  // 都道府県 + 住所 → Promise<{ matched, candidates: [{ code, note }] } | null>
  // 都道府県が分からなければ error.code = 'postal-no-pref'、データを読めなければ 'postal-load'
  function lookupPostal(pref, address, load) {
    var code = prefCode(pref);
    if (!code) {
      var bad = new Error('postal-no-pref');
      bad.code = 'postal-no-pref';
      return Promise.reject(bad);
    }
    if (!revCache[code]) {
      revCache[code] = (load || fetchPref)(code).catch(function (e) {
        delete revCache[code];
        var err = new Error('postal-load');
        err.code = 'postal-load';
        err.cause = e;
        throw err;
      });
    }
    return revCache[code].then(function (data) { return fromPrefData(data, address); });
  }

  global.EntryPostal = {
    normalize: normalize, fromChunk: fromChunk, lookup: lookup,
    PREFS: PREFS, prefCode: prefCode, cleanAddress: cleanAddress,
    fromPrefData: fromPrefData, lookupPostal: lookupPostal
  };
})(window);
