// entry-postal.js — 申込書ドロッパーの名簿づくりで、郵便番号から住所を引く
//
// データは日本郵便の郵便番号データを tools/make-postal.js で変換したもの（entry/postal/0.json 〜 9.json）。
// ★ 読み込むのは、このサイトに置いた postal/ のファイルだけ。外部の住所検索サービスには何も送らない。
//   ファイルは郵便番号の先頭1桁ごとなので、サイトを置いている GitHub に分かるのは先頭1桁まで。
//   entry/test/run.js が「postal/ を読むこと以外の通信が無い」ことを確かめている。
//   ここの fetch の行を変えるときは、run.js の確かめ方も合わせて直すこと。
// ★ 1つの郵便番号に町域が2つ以上あることがある（蘇我／蘇我町、あきる野市／日の出町）。1つに決めず候補をすべて返す。
//
// window.EntryPostal = { normalize, fromChunk, lookup } を公開する。
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

  global.EntryPostal = { normalize: normalize, fromChunk: fromChunk, lookup: lookup };
})(window);
