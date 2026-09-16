// entry-attend.js — 出欠システム（hakusan-attendance）から、団体名と名前を取り込む
//
// ★ 2026-09-16、本人の要望。出欠システムで団体を作ってあるなら、名前を入れ直さずに済む。
//
// 取れるのは **団体名・氏名・性別（男／女、空のこともある）** の3つだけ。
// 生年月日・住所・電話は向こうに無いので、名簿の画面で足してもらう。
// 「退会」などと書かれた人は、向こうが名簿から外して返す。
//
// ★ ここは申込書ドロッパーで2つ目の通信先（1つ目は郵便番号データ）。
//   送るのは団体ID だけ。名前・住所・生年月日・申込書の中身は送らない。
//   参加者が名前を選ぶ画面と同じ、鍵の要らない道（a=members）を使う。
//   entry/test/run.js が「これ以外の通信が無い」ことを機械で確かめている。
//
// window.EntryAttend = { API_BASE, parseOrgId, fetchMembers } を公開する。
(function (global) {
  'use strict';

  var API_BASE = 'https://api.dropper-tools.com/';

  // 団体ID そのものでも、出欠のURL（?s=... を含むもの）でも受け取る
  function parseOrgId(raw) {
    var s = String(raw == null ? '' : raw).trim();
    var m = /[?&]s=([A-Za-z0-9_-]{10,200})/.exec(s);
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{10,200}$/.test(s) ? s : '';
  }

  function fail(code) {
    var e = new Error(code);
    e.code = code;
    return e;
  }

  // 団体ID → Promise<{ org, members: [{ name, gender }] }>
  // load は試験用（既定は出欠システムの API）
  function fetchMembers(raw, load) {
    var orgId = parseOrgId(raw);
    if (!orgId) return Promise.reject(fail('attend-bad-id'));
    var get = load || function (id) {
      return fetch(API_BASE + '?a=members&s=' + encodeURIComponent(id), { credentials: 'omit' }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      });
    };
    return get(orgId).catch(function (e) {
      var err = fail('attend-load');
      err.cause = e;
      throw err;
    }).then(function (data) {
      if (!data || !data.ok) throw fail(data && data.code === 'orgNotFound' ? 'attend-not-found' : 'attend-load');
      var members = (data.members || []).filter(function (m) { return m && String(m.name || '').trim(); })
        .map(function (m) {
          var g = String(m.gender || '').trim();
          return { name: String(m.name).trim(), gender: g === '男' ? '男子' : (g === '女' ? '女子' : '') };
        });
      return { org: String(data.org || '').trim(), members: members };
    });
  }

  global.EntryAttend = { API_BASE: API_BASE, parseOrgId: parseOrgId, fetchMembers: fetchMembers };
})(window);
