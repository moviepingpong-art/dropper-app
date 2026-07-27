// schedule-ai.js — 予定表ドロッパーのAI読み取り（BYOK：利用者自身のGemini APIキー）
//
// テキスト抽出では、カレンダー方眼形式（マス目に行事名が入る年間行事予定表など）を扱えない。
// 2次元の配置を1次元の文字列にした時点で、日付と行事名の対応が失われるため。
// そこで AIモードでは OCRテキストではなく、PDF・画像そのものを Gemini に渡して読ませる。
//
// window.SchedAI = { extract(file, opts) } を公開する。
//   opts.apiKey     : Gemini APIキー（端末内のみ。サーバーへは送らない）
//   opts.fiscalYear : 年度（分かっていれば渡す。空欄なら本文から判断させる）
//   opts.lang       : 'ja' | 'en'
//   opts.onStatus   : 進捗を伝えるコールバック
(function (global) {
  'use strict';

  // 主モデル → 混雑時のフォールバック。イベントドロッパー（app.js の AI_MODELS）と揃える。
  // 無料枠はモデルごとに数えられるため、実績のあるモデルを主に使う。
  var MODELS = ['gemini-flash-latest', 'gemini-2.0-flash'];
  var MIN_INTERVAL_MS = 5000;      // レート制限対策のスロットル。外さないこと
  var MAX_BYTES = 15 * 1024 * 1024;   // Geminiのインライン送信の上限に対する安全側の目安
  var lastCallAt = 0;

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function throttle() {
    var since = Date.now() - lastCallAt;
    if (lastCallAt && since < MIN_INTERVAL_MS) await wait(MIN_INTERVAL_MS - since);
    lastCallAt = Date.now();
  }

  // ファイルを base64 にする（Geminiのinline_dataで送るため）
  function toBase64(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('read failed')); };
      fr.onload = function () {
        var s = String(fr.result);
        var i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      fr.readAsDataURL(file);
    });
  }

  function promptJa(fy) {
    return '添付は予定表です（年間行事予定表・大会日程表・リーグ戦日程・月間カレンダーなど）。' +
      'この予定表に載っている予定を、ひとつ残らず読み取ってJSONの配列だけで返してください（前置き・説明・コードフェンスは不要）。\n' +
      '■ 読み取り方\n' +
      '・カレンダーのマス目形式（日付のマスの中に行事名が書かれている形）の場合は、マスの位置をよく見て、日付と行事名を正しく対応付けること。\n' +
      '・1つのマスに複数の行事があれば、それぞれ別の要素にすること。\n' +
      '・表形式で1行に複数の予定が横に並ぶ場合も、それぞれ別の要素にすること。\n' +
      '■ 日付\n' +
      '・date は開始日、end は終了日（1日だけなら end は空文字）。どちらも YYYY-MM-DD。\n' +
      (fy ? ('・この予定表は ' + fy + '年度です。4月〜12月は ' + fy + '年、1月〜3月は ' + (fy + 1) + '年として西暦を補うこと。\n')
          : '・表に「令和◯年度」「◯◯年度」の記載があればそれに従い、4月〜12月は年度の年、1月〜3月は翌年として西暦を補うこと。年が全く分からない場合のみ date を空文字にすること。\n') +
      '■ 除外するもの\n' +
      '・祝日の名前（元日・成人の日・建国記念の日・春分の日・昭和の日・憲法記念日・みどりの日・こどもの日・海の日・山の日・敬老の日・秋分の日・スポーツの日・文化の日・勤労感謝の日・天皇誕生日・振替休日・国民の休日）は予定に含めないこと。\n' +
      '・「未定」「行事なし」など日付や内容が定まらないものは含めないこと。\n' +
      '・表の見出し行（「期日」「場所」「大会名」など）は含めないこと。\n' +
      '■ 各項目\n' +
      '・title は行事名。祝日名や日付・曜日は title に入れないこと。\n' +
      '・place は会場・場所（書かれていなければ空文字）。\n' +
      '・time は開始時刻 HH:MM（書かれていなければ空文字）。\n' +
      '出力形式（この配列だけを返す）:\n' +
      '[{"date":"YYYY-MM-DD","end":"","time":"","title":"","place":""}]';
  }

  function promptEn(fy) {
    return 'The attachment is a schedule (annual event calendar, competition schedule, league fixture list, or monthly calendar grid). ' +
      'Read every scheduled item and return ONLY a JSON array (no preamble, explanation, or code fences).\n' +
      'How to read it:\n' +
      '- For a calendar grid (event names written inside date cells), look carefully at cell positions and pair each date with the right event name.\n' +
      '- If one cell holds several events, make each one a separate element. The same applies when one table row holds several entries side by side.\n' +
      'Dates:\n' +
      '- date is the start date and end is the end date (empty string for a single day). Both in YYYY-MM-DD.\n' +
      (fy ? ('- This schedule is for fiscal year ' + fy + '. Months April to December are ' + fy + ', January to March are ' + (fy + 1) + '.\n')
          : '- If the sheet states a fiscal year, follow it: April to December take that year, January to March the next. Only leave date empty if the year cannot be determined at all.\n') +
      'Exclude:\n' +
      '- Public holiday names, and rows marked as undecided or "no events".\n' +
      '- Table header rows such as "date", "venue", "event name".\n' +
      'Fields:\n' +
      '- title is the event name (no holiday names, dates or weekdays inside it).\n' +
      '- place is the venue (empty string if absent). time is the start time HH:MM (empty string if absent).\n' +
      'Output exactly this shape:\n' +
      '[{"date":"YYYY-MM-DD","end":"","time":"","title":"","place":""}]';
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
    var say = opts.onStatus || function () {};
    if (!opts.apiKey) throw new Error('no-key');
    if (file.size > MAX_BYTES) throw new Error('too-large');

    var b64 = await toBase64(file);
    var mime = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/jpeg');
    var prompt = (opts.lang === 'en' || opts.lang === 'in')
      ? promptEn(opts.fiscalYear) : promptJa(opts.fiscalYear);

    var resp = null, busy = false, rate = false;
    for (var i = 0; i < MODELS.length; i++) {
      if (i === 0) { say('queued'); await throttle(); } else { say('retry'); }
      say('running');
      var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODELS[i] +
        ':generateContent?key=' + encodeURIComponent(opts.apiKey);
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' }
        })
      });
      busy = ([500, 502, 503, 504].indexOf(resp.status) !== -1);
      rate = (resp.status === 429);
      // 無料枠はモデルごとに数えられるので、上限に当たったら別のモデルも試す
      if (!busy && !rate) break;
    }
    if (!resp) throw new Error('no-response');
    if (resp.status === 429) {
      // 429 は「1分あたりの上限」と「1日あたりの上限」の両方で返る。
      // どちらかで待ち時間がまったく違うため、応答の中身を見て区別する。
      var q = '';
      try { q = await resp.text(); } catch (e) {}
      throw new Error(/per\s*minute|PerMinute|per_minute/i.test(q) ? 'rate-minute' : 'rate-day');
    }
    if (busy) throw new Error('busy');
    if (!resp.ok) {
      var body = await resp.text();
      throw new Error('http-' + resp.status + ': ' + body.slice(0, 120));
    }
    var data = await resp.json();
    var txt = ((((data.candidates || [])[0] || {}).content || {}).parts || [])
      .map(function (p) { return p.text || ''; }).join('');
    var json = extractJson(txt);
    if (!json) throw new Error('bad-json');
    return normalizeItems(json);
  }

  global.SchedAI = { extract: extract, normalizeItems: normalizeItems, extractJson: extractJson, MODELS: MODELS };
})(typeof window !== 'undefined' ? window : this);
