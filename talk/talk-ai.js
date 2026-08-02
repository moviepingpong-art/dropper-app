// talk-ai.js — やりとりドロッパーのAI抽出
//
// 入力は「会話のスクリーンショット」。文書ではなく会話なので、既存2本と前提が3つ違う。
//   1. 話者がいる（誰が言ったか）
//   2. 話が二転三転する（「やっぱり15日で」で前の発言が無効になる）
//   3. 決まっていないことがある（文書は決まったことしか書かれない）
// このうち 3 を出すのがこのツールの中心。日付の書き写しは第1弾・第2弾がやる。
//
// window.TalkAI = { extract(files, opts) } を公開する。
//   opts.apiKey    : Gemini APIキー（端末内のみ。サーバーへは送らない）
//   opts.baseDate  : 基準日 'YYYY-MM-DD'（「来週の火曜」を絶対日付に直すのに使う）
//   opts.lang      : 'ja' | 'en'
//   opts.onStatus  : 進捗を伝えるコールバック
(function (global) {
  'use strict';

  // 主モデル → 混雑時のフォールバック。イベント／予定表ドロッパーと揃える。
  var MODELS = ['gemini-flash-latest', 'gemini-2.0-flash'];
  var MIN_INTERVAL_MS = 5000;            // レート制限対策のスロットル。外さないこと
  var MAX_TOTAL_BYTES = 15 * 1024 * 1024;   // 全画像の合計に対する安全側の目安
  var MAX_FILES = 10;                    // 1回に渡せる枚数の上限
  var lastCallAt = 0;

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function throttle() {
    var since = Date.now() - lastCallAt;
    if (lastCallAt && since < MIN_INTERVAL_MS) await wait(MIN_INTERVAL_MS - since);
    lastCallAt = Date.now();
  }

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

  function promptJa(baseDate) {
    return '添付は、チャットアプリ（LINE・Slack・メール・X など）のやりとりのスクリーンショットです。' +
      '**渡した順に会話が続いています。** 複数枚は同じ会話の連続した部分で、' +
      '上下が重なって同じ発言が2枚に写っていることがあります。重なった発言は1件として扱ってください。\n' +
      '会話全体を読んで、JSONのオブジェクトだけを返してください（前置き・説明・コードフェンスは不要）。\n' +
      '■ いちばん大事なこと\n' +
      '・**決まったこと（decided）と、まだ決まっていないこと（undecided）を分けること。** これがこの作業の目的です。\n' +
      '・会話では話が二転三転します。**後の発言が前の発言を打ち消している場合、最終的な結論だけを decided に入れ、' +
      '打ち消された方は入れないこと**（例:「12日で」→「やっぱり15日で」なら、決定は15日のみ）。\n' +
      '・「どうする？」「誰か分かる人いますか」のように問いかけたまま返事が無い、' +
      '「候補は2つある」のように選択肢が残っている、返事待ちで止まっている——これらは undecided です。\n' +
      '・**推測で決定事項を作らないこと。** 会話に書かれていないことは出さない。決まっていなければ undecided に置く。\n' +
      '■ 話者\n' +
      '・吹き出しが右側（自分の発言）の話者は「自分」としてください。左側は表示されている名前を使ってください。\n' +
      '・名前が読み取れないときは空文字にしてください。\n' +
      '■ 日付\n' +
      '・会話は「来週の火曜」「明日まで」のように相対的に書かれます。' +
      (baseDate ? ('この会話の基準日は ' + baseDate + ' です。これを起点に西暦の絶対日付へ直してください。\n')
                : 'スクリーンショットに日付の区切り（「2026年8月2日」など）が写っていればそれを起点にしてください。\n') +
      '・due は YYYY-MM-DD。**判断できないときは空文字にし、勝手に決めないこと。**\n' +
      '・dueRaw には会話に書かれていた表現をそのまま入れてください（例:「来週の火曜」「8/15まで」）。' +
      '利用者がこれを見て、直した日付が正しいか確かめます。期限の記述が無ければ空文字。\n' +
      '■ 各項目\n' +
      '・decided … {"text":"決まった内容","who":"決めた人・言い出した人（不明なら空文字）"}\n' +
      '・undecided … {"text":"何が決まっていないか","waiting":"何待ちか・誰の返事待ちか（不明なら空文字）"}\n' +
      '・todos … {"text":"やること","who":"担当（不明なら空文字）","due":"YYYY-MM-DD または空文字","dueRaw":"原文の表現"}\n' +
      '・decided に入れた内容のうち、誰かがやる作業になっているものは todos にも入れてください（重複してよい）。\n' +
      '・該当が無い項目は空配列にしてください。\n' +
      '出力形式（このオブジェクトだけを返す）:\n' +
      '{"decided":[{"text":"","who":""}],"undecided":[{"text":"","waiting":""}],' +
      '"todos":[{"text":"","who":"","due":"","dueRaw":""}]}';
  }

  function promptEn(baseDate) {
    return 'The attachments are screenshots of a conversation in a messaging app (LINE, Slack, email, X and so on). ' +
      '**They are in order and the conversation runs across them.** Consecutive screenshots often overlap, ' +
      'so the same message can appear twice. Treat an overlapping message as a single message.\n' +
      'Read the whole conversation and return ONLY a JSON object (no preamble, explanation, or code fences).\n' +
      'The most important thing:\n' +
      '- **Separate what was decided (decided) from what is still open (undecided).** That is the point of this task.\n' +
      '- Conversations change course. **If a later message overrides an earlier one, put only the final conclusion ' +
      'in decided and leave the overridden one out** (e.g. "let us do the 12th" then "actually the 15th" — only the 15th is decided).\n' +
      '- A question left unanswered, a choice still open between options, or anything waiting on a reply belongs in undecided.\n' +
      '- **Do not invent decisions.** If it is not in the conversation, leave it out; if it is not settled, put it in undecided.\n' +
      'Speakers:\n' +
      '- Messages in bubbles on the right are the screenshot owner: use "me" as the speaker. On the left, use the displayed name.\n' +
      '- Use an empty string when the name cannot be read.\n' +
      'Dates:\n' +
      '- Conversations use relative wording such as "next Tuesday" or "by tomorrow". ' +
      (baseDate ? ('The reference date for this conversation is ' + baseDate + '. Resolve relative dates from it.\n')
                : 'If a date separator appears in the screenshots, use it as the reference point.\n') +
      '- due is YYYY-MM-DD. **Leave it empty when you cannot tell; never guess.**\n' +
      '- dueRaw holds the wording used in the conversation (e.g. "next Tuesday", "by 8/15") so the reader can check ' +
      'the resolved date. Empty string if no deadline was mentioned.\n' +
      'Fields:\n' +
      '- decided: {"text":"what was decided","who":"who decided or proposed it (empty if unknown)"}\n' +
      '- undecided: {"text":"what is still open","waiting":"what or whose reply it waits on (empty if unknown)"}\n' +
      '- todos: {"text":"the task","who":"owner (empty if unknown)","due":"YYYY-MM-DD or empty","dueRaw":"original wording"}\n' +
      '- If something in decided is work someone will do, also put it in todos (duplication is fine).\n' +
      '- Use an empty array when there is nothing for a field.\n' +
      'Output exactly this shape:\n' +
      '{"decided":[{"text":"","who":""}],"undecided":[{"text":"","waiting":""}],' +
      '"todos":[{"text":"","who":"","due":"","dueRaw":""}]}';
  }

  function str(v) { return String(v == null ? '' : v).trim(); }

  // AIの返答を、UIが扱いやすい形に整える。
  // 形も値も信用しない（AIは 2026-13-45 のような日付や、空の要素を返すことがある）。
  function normalize(raw) {
    var o = raw || {};
    if (Array.isArray(o)) o = { decided: o };   // 配列だけで返ってくることがある
    var out = { decided: [], undecided: [], todos: [] };

    (Array.isArray(o.decided) ? o.decided : []).forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var t = str(it.text); if (!t) return;
      out.decided.push({ text: t, who: str(it.who) });
    });
    (Array.isArray(o.undecided) ? o.undecided : []).forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var t = str(it.text); if (!t) return;
      out.undecided.push({ text: t, waiting: str(it.waiting) });
    });
    (Array.isArray(o.todos) ? o.todos : []).forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var t = str(it.text); if (!t) return;
      var d = str(it.due);
      // 形が合っていても値が壊れていることがあるので、実在する日付かまで見る
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) d = '';
      if (d) {
        var p = d.split('-'), dt = new Date(d + 'T00:00:00');
        if (isNaN(dt.getTime()) || dt.getMonth() + 1 !== Number(p[1]) || dt.getDate() !== Number(p[2])) d = '';
      }
      out.todos.push({ text: t, who: str(it.who), due: d, dueRaw: str(it.dueRaw) });
    });
    return out;
  }

  function extractJson(text) {
    var s = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(s); } catch (e) {}
    // 前後に説明が混ざった場合に備えて、オブジェクト（無ければ配列）の部分だけを取り出す
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) {} }
    a = s.indexOf('['); b = s.lastIndexOf(']');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e3) {} }
    return null;
  }

  // 複数枚を「1回のリクエスト」でまとめて渡す。
  // 1枚ずつ処理すると画像の境目で文脈が切れ、「やっぱり15日で」のような訂正を取り逃す。
  // ここが既存2本（1ファイル＝独立処理）と作りが違うところ。
  async function extract(files, opts) {
    opts = opts || {};
    var say = opts.onStatus || function () {};
    var list = Array.prototype.slice.call(files || []);
    if (!opts.apiKey) throw new Error('no-key');
    if (!list.length) throw new Error('no-file');
    if (list.length > MAX_FILES) throw new Error('too-many');
    var total = list.reduce(function (n, f) { return n + (f.size || 0); }, 0);
    if (total > MAX_TOTAL_BYTES) throw new Error('too-large');

    var parts = [{ text: (opts.lang === 'en' || opts.lang === 'in') ? promptEn(opts.baseDate) : promptJa(opts.baseDate) }];
    for (var n = 0; n < list.length; n++) {
      var b64 = await toBase64(list[n]);
      parts.push({ inline_data: { mime_type: list[n].type || 'image/jpeg', data: b64 } });
    }

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
          contents: [{ parts: parts }],
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
      // 429 は「1分あたり」と「1日あたり」の両方で返る。待ち時間がまったく違うので中身で区別する。
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
    return normalize(json);
  }

  global.TalkAI = {
    extract: extract, normalize: normalize, extractJson: extractJson,
    MODELS: MODELS, MAX_FILES: MAX_FILES
  };
})(typeof window !== 'undefined' ? window : this);
