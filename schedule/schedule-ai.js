// schedule-ai.js — 予定表ドロッパーのAI読み取り（当方の中継を通して OpenAI に頼む。2026-10-18〜）
//
// テキスト抽出では、カレンダー方眼形式（マス目に行事名が入る年間行事予定表など）を扱えない。
// 2次元の配置を1次元の文字列にした時点で、日付と行事名の対応が失われるため。
// そこで AIモードでは OCRテキストではなく、PDF・画像そのものを AI に渡して読ませる。
//
// ・利用者はキーを入れない。中継（ai.dropper-tools.com/schedule）が当方の OpenAI キーで頼む。
// ・送るのはファイルと、言語・年度だけ。頼み文は中継が持つ（dropper の workers/monster-ai/tool-prompts.js）。
// ・★ ドライブの OCR の文字は送らないこと（Google の Limited Use。AI の学習に使われる先へ渡せない）。
// ・上限は中継が決める（全体の1日の枠・1人1日10枚）。
//
// window.SchedAI = { extract(file, opts) } を公開する。
//   opts.fiscalYear : 年度（分かっていれば渡す。空欄なら本文から判断させる）
//   opts.lang       : 'ja' | 'en' | 'in'
// 失敗は Error の message で返す: 'quota' | 'limit' | 'too-large' | 'type' | 'busy' | 'bad-json' | 'network'
(function (global) {
  'use strict';

  var RELAY = 'https://ai.dropper-tools.com/schedule';
  var MAX_BYTES = 10 * 1024 * 1024;   // 中継が受け付けるファイルの大きさ（base64 にして約1.4倍になる）
  var IMAGE_MAX = 2400;               // 画像は長い辺をここまで縮めて JPEG で送る（マス目の字が読める大きさ）
  var MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  function readDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('read failed')); };
      fr.onload = function () { resolve(String(fr.result)); };
      fr.readAsDataURL(file);
    });
  }

  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, IMAGE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        var g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);   // 透明な PNG を黒くしない
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  // AIの返答（JSON文字列）を、UIが扱いやすい形に整える
  function normalizeItems(raw) {
    var arr = raw;
    if (arr && !Array.isArray(arr) && Array.isArray(arr.items)) arr = arr.items;   // {items:[…]} で返ることがある
    if (!Array.isArray(arr)) return [];
    var out = [];
    arr.forEach(function (o) {
      if (!o || typeof o !== 'object') return;
      var d = String(o.date || '').trim();
      var e = String(o.end || '').trim();
      var t = String(o.time || '').trim();
      var title = String(o.title || '').trim();
      if (!title) return;
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) d = '';
      if (e && !/^\d{4}-\d{2}-\d{2}$/.test(e)) e = '';
      if (e && d && e <= d) e = '';
      // 形だけでなく値も見る（AIが 25:99 のような時刻を返すことがある）
      var tm = t.match(/^(\d{1,2}):(\d{2})$/);
      t = (tm && Number(tm[1]) <= 23 && Number(tm[2]) <= 59)
        ? ('0' + tm[1]).slice(-2) + ':' + tm[2] : '';
      out.push({
        start: d, end: e, time: t,
        title: title, place: String(o.place || '').trim(),
        outOfRange: false, fromAi: true
      });
    });
    return out;
  }

  function extractJson(text) {
    var s = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(s); } catch (e) {}
    // 前後に説明が混ざった場合に備えて、最初の配列部分だけを取り出す
    var a = s.indexOf('['), b = s.lastIndexOf(']');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) {} }
    return null;
  }

  async function extract(file, opts) {
    opts = opts || {};
    var mime = file.type || (/\.pdf$/i.test(file.name || '') ? 'application/pdf' : '');
    var dataUrl = null;
    if (/^image\//.test(mime)) {
      try { dataUrl = await shrinkImage(file); mime = 'image/jpeg'; } catch (e) { dataUrl = null; }
    }
    if (MIMES.indexOf(mime) < 0) throw new Error('type');
    if (!dataUrl) {
      if (file.size > MAX_BYTES) throw new Error('too-large');
      dataUrl = await readDataUrl(file);
    }
    var b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    if (b64.length > MAX_BYTES * 1.37) throw new Error('too-large');

    var url = RELAY + '?lang=' + encodeURIComponent(opts.lang || 'ja') +
      (opts.fiscalYear ? '&fy=' + encodeURIComponent(opts.fiscalYear) : '') +
      '&mime=' + encodeURIComponent(mime);
    var res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: b64 });
    } catch (e) { throw new Error('network'); }
    // ★ fetch は 4xx/5xx でも例外を投げない。応答の status と中身を必ず見る（CLAUDE.md）。
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (res.ok && data && data.answer && typeof data.answer === 'object') return normalizeItems(data.answer);
    var err = (data && data.error) || '';
    if (!err) console.warn('AI relay', res.status);
    if (err === 'quota' || err === 'limit' || err === 'busy' || err === 'type') throw new Error(err);
    if (err === 'slow') throw new Error('busy');
    if (err === 'size') throw new Error('too-large');
    throw new Error('bad-json');
  }

  global.SchedAI = { extract: extract, normalizeItems: normalizeItems, extractJson: extractJson, RELAY: RELAY };
})(typeof window !== 'undefined' ? window : this);
