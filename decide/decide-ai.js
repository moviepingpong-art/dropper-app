// decide-ai.js — 決めごとドロッパーのAI抽出
//
// 入力は「話し合いの記録」。会話のスクショと、手書きメモ・ホワイトボード・FAXの両方を受ける。
// できあがった文書ではなく話し合いの途中なので、既存2本と前提が3つ違う。
//   1. 話者がいる（誰が言ったか）
//   2. 話が二転三転する（「やっぱり15日で」で前の発言が無効になる）
//   3. 決まっていないことがある（文書は決まったことしか書かれない）
// このうち 3 を出すのがこのツールの中心。日付の書き写しは第1弾・第2弾がやる。
//
// window.DecideAI = { extract(files, opts) } を公開する。
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
    return '添付は「決めごとの記録」です。次のいずれか、または複数が混ざっています。\n' +
      '　A: チャットアプリ（LINE・Slack・メール・X など）のやりとりのスクリーンショット\n' +
      '　B: 手書きのメモ、打ち合わせのノート、ホワイトボードの写真、FAXなどの紙の記録\n' +
      '　C: 議事録・総会報告・委員会報告・お知らせなど、清書された文書\n' +
      '**渡した順に記録が続いています。** 複数枚は同じ記録の連続した部分で、' +
      '上下が重なって同じ内容が2枚に写っていることがあります。重なった部分は1件として扱ってください。\n' +
      '全体を読んで、JSONのオブジェクトだけを返してください（前置き・説明・コードフェンスは不要）。\n' +
      '■ いちばん大事なこと\n' +
      '・**決まったこと（decided）と、まだ決まっていないこと（undecided）を分けること。** これがこの作業の目的です。\n' +
      '・**判定の軸は「これからのことか」×「確定しているか」の2つです。誰が決めたかではありません。**\n' +
      '　　これから × 確定している　→ decided（決まったこと）\n' +
      '　　これから × まだ確定していない → undecided（まだ決まっていないこと）\n' +
      '　　すでに済んだこと　　　　→ **どちらにも入れない**\n' +
      '・decided に入るのは次のようなものです。\n' +
      '　・話し合いで合意されたこと（例:「9/15に開催で決まり」）\n' +
      '　・文書で「決定した」「承認された」「可決された」「了承された」「一任された」' +
      '「〜することとなった」と書かれていること\n' +
      '　・**「〜する予定」「〜が開催される」のように、日程や実施が確定している事柄。**' +
      'その記録の中で誰かが決めたものでなくても構いません。予定として確定していれば decided です' +
      '（例:「2027年1月1日に合併し発足予定」「3月19日〜9月26日に開催予定」）。\n' +
      '・**すでに済んだ出来事の報告は、decided にも undecided にも入れないこと。** これがいちばん多い誤りです。\n' +
      '　例:「7月25日で特別国会が終了しました」「1月23日解散」「2月8日投開票」は、' +
      '起きたことの振り返りであって、これから確定している事柄ではありません。\n' +
      '　見分け方: 文末が「〜しました」「〜だった」のように**済んだ言い方**なら入れない。' +
      '「〜予定」「〜する」「〜と決定した」のように**これから効く言い方**なら入れる。\n' +
      '・会話では話が二転三転します。**後の発言が前の発言を打ち消している場合、最終的な結論だけを decided に入れ、' +
      '打ち消された方は入れないこと**（例:「12日で」→「やっぱり15日で」なら、決定は15日のみ）。\n' +
      '・「どうする？」「誰か分かる人いますか」のように問いかけたまま返事が無い、' +
      '「候補は2つある」のように選択肢が残っている、返事待ちで止まっている——これらは undecided です。\n' +
      '　C（文書）では「継続審議」「保留」「次回に持ち越し」「今後の課題」「検討中」が undecided にあたります。\n' +
      '・**推測で決定事項を作らないこと。** 記録に書かれていないことは出さない。決まっていなければ undecided に置く。\n' +
      '・**該当が無ければ空配列にしてください。** 随筆や振り返りのように、済んだ話ばかりで' +
      'これから確定していることが何も無い文書では、3項目すべてが空になります。それは正しい答えです。\n' +
      '　ただし**確定した予定が書かれているのに空で返すのは誤りです。** 上の「これから × 確定」に' +
      'あてはまるものは、記録の中で誰かが決めたかどうかに関わらず拾ってください。\n' +
      '■ 話者\n' +
      '・A（スクショ）の場合: 吹き出しが右側（自分の発言）の話者は「自分」としてください。' +
      '左側は表示されている名前を使ってください。\n' +
      '・B（紙の記録）の場合: 発言者や担当者の名前が書かれていればそれを使ってください。' +
      '**書かれていなければ空文字にし、誰の発言か推測しないこと。**\n' +
      '・C（文書）の場合: 決めた主体が会議体なら、その名前（理事会・総会・委員会など）を入れてください。\n' +
      '・**文責者・著者・署名・発行元を who に入れないこと。**「文責：〇〇」と書かれていても、' +
      'その人がその件を決めたとは限りません。書いた人と決めた人は別です。\n' +
      '・いずれの場合も、名前が読み取れないときは空文字にしてください。\n' +
      '■ 手書きの読み取り（Bの場合）\n' +
      '・崩し字や略記があっても、文脈から素直に読める範囲で読み取ってください。' +
      '**読めない箇所を推測で埋めないこと。**\n' +
      '・矢印・囲み・チェック印などの記号は、その意味（つながり・強調・済み）を汲んで内容に反映し、' +
      '記号そのものは出力しないでください。\n' +
      '・**二重線や取り消し線で消された項目は、打ち消されたものとして扱ってください**（decided に入れない）。' +
      'これは会話でいう「やっぱり15日で」と同じ意味を持ちます。\n' +
      '■ 日付\n' +
      '・会話は「来週の火曜」「明日まで」のように相対的に書かれます。' +
      (baseDate ? ('この会話の基準日は ' + baseDate + ' です。これを起点に西暦の絶対日付へ直してください。\n')
                : 'スクリーンショットに日付の区切り（「2026年8月2日」など）が写っていればそれを起点にしてください。\n') +
      '・due は YYYY-MM-DD。**判断できないときは空文字にし、勝手に決めないこと。**\n' +
      '・dueRaw には記録に書かれていた表現をそのまま入れてください（例:「来週の火曜」「8/15まで」）。' +
      '利用者がこれを見て、直した日付が正しいか確かめます。期限の記述が無ければ空文字。\n' +
      '・**拾うのは、これからやることの期限だけです。** 報告書には「1月23日解散」「2月8日投開票」のように' +
      '**過去の経緯を並べた日付**が出てきますが、これは済んだ出来事であって期限ではありません。' +
      'todos にも decided にも入れないでください。\n' +
      '■ 各項目\n' +
      '・decided … {"text":"決まった内容","who":"決めた人・言い出した人（不明なら空文字）",' +
      '"date":"YYYY-MM-DD または空文字","dateRaw":"原文の表現"}\n' +
      '　date は**その決定が指している日付**（開催日・実施日・発足日など）です。' +
      '**決定した日・会議が開かれた日ではありません。**\n' +
      '　「3月19日〜9月26日」のように期間で書かれているときは、**初日**を date に入れてください。' +
      'dateRaw には「3月19日〜9月26日」のように原文のまま入れます。\n' +
      '　日付が書かれていない決定は date も dateRaw も空文字にしてください。**勝手に日付を作らないこと。**\n' +
      '・undecided … {"text":"何が決まっていないか","waiting":"何待ちか・誰の返事待ちか（不明なら空文字）"}\n' +
      '・todos … {"text":"やること","who":"担当（不明なら空文字）","due":"YYYY-MM-DD または空文字","dueRaw":"原文の表現"}\n' +
      '・decided に入れた内容のうち、誰かがやる作業になっているものは todos にも入れてください（重複してよい）。\n' +
      '・該当が無い項目は空配列にしてください。\n' +
      '出力形式（このオブジェクトだけを返す）:\n' +
      '{"decided":[{"text":"","who":"","date":"","dateRaw":""}],"undecided":[{"text":"","waiting":""}],' +
      '"todos":[{"text":"","who":"","due":"","dueRaw":""}]}';
  }

  function promptEn(baseDate) {
    return 'The attachments are a record of things being decided. They are one of, or a mix of:\n' +
      '  A: screenshots of a conversation in a messaging app (LINE, Slack, email, X and so on)\n' +
      '  B: handwritten notes, meeting notes, a photo of a whiteboard, a fax or other paper record\n' +
      '  C: a written-up document such as minutes, a committee or general-meeting report, or an announcement\n' +
      '**They are in order and the record runs across them.** Consecutive images often overlap, ' +
      'so the same content can appear twice. Treat an overlapping part as a single item.\n' +
      'Read the whole thing and return ONLY a JSON object (no preamble, explanation, or code fences).\n' +
      'The most important thing:\n' +
      '- **Separate what was decided (decided) from what is still open (undecided).** That is the point of this task.\n' +
      '- **Judge on two axes: is it still ahead, and is it settled? Not on who decided it.**\n' +
      '    ahead + settled     -> decided\n' +
      '    ahead + not settled -> undecided\n' +
      '    already happened    -> **neither**\n' +
      '- decided covers:\n' +
      '  - what was agreed in the conversation (e.g. "the 15th it is")\n' +
      '  - what a document states as "was decided", "was approved", "was carried", "was endorsed", ' +
      '"was delegated to", "it was agreed that"\n' +
      '  - **anything whose date or execution is settled, such as "is scheduled for" or "will be held".** ' +
      'It does not have to be something decided by anyone in this record. If it is a settled plan, it is decided ' +
      '(e.g. "the merger takes effect on 1 January 2027", "runs from 19 March to 26 September").\n' +
      '- **Do not put already-completed events in decided or undecided. This is the most common mistake.**\n' +
      '  "The special session closed on 25 July", "dissolved on 23 January", "polling day 8 February" all look back ' +
      'at what happened; none of them is settled and ahead.\n' +
      '  Test: past-tense narration ("closed", "was held") stays out; forward-looking wording ("is scheduled", ' +
      '"will run", "was decided") goes in.\n' +
      '- Conversations change course. **If a later message overrides an earlier one, put only the final conclusion ' +
      'in decided and leave the overridden one out** (e.g. "let us do the 12th" then "actually the 15th" — only the 15th is decided).\n' +
      '- A question left unanswered, a choice still open between options, or anything waiting on a reply belongs in undecided.\n' +
      '  In C, "held over", "deferred", "carried to the next meeting", "under consideration" belong in undecided.\n' +
      '- **Do not invent decisions.** If it is not in the record, leave it out; if it is not settled, put it in undecided.\n' +
      '- **Use empty arrays when there is nothing to report.** An essay or a look back that only recounts ' +
      'what already happened will leave all three empty, and that is a correct answer.\n' +
      '  But **returning empty when settled plans are written down is wrong.** Anything matching ' +
      '"ahead + settled" above belongs in decided, whoever decided it.\n' +
      'Speakers:\n' +
      '- For A (screenshots): messages in bubbles on the right are the screenshot owner, so use "me" as the speaker. ' +
      'On the left, use the displayed name.\n' +
      '- For B (paper records): use the name of the speaker or owner if it is written. ' +
      '**If it is not written, use an empty string and do not guess who said it.**\n' +
      '- For C (documents): when a body made the decision, use its name (board, general meeting, committee).\n' +
      '- **Never put the author, byline, signature or publisher in who.** Even when a document says ' +
      '"written by X", that does not mean X decided it. The writer and the decider are different people.\n' +
      '- In every case, use an empty string when the name cannot be read.\n' +
      'Reading handwriting (for B):\n' +
      '- Read cursive or shorthand as far as it can be read plainly from context. **Do not fill in unreadable parts by guessing.**\n' +
      '- Arrows, circles and check marks carry meaning (connection, emphasis, done): reflect that meaning in the content ' +
      'and do not output the marks themselves.\n' +
      '- **Anything struck through or crossed out is overridden: leave it out of decided.** ' +
      'It means the same as "actually, let us do the 15th" in a chat.\n' +
      'Dates:\n' +
      '- Conversations use relative wording such as "next Tuesday" or "by tomorrow". ' +
      (baseDate ? ('The reference date for this conversation is ' + baseDate + '. Resolve relative dates from it.\n')
                : 'If a date separator appears in the screenshots, use it as the reference point.\n') +
      '- due is YYYY-MM-DD. **Leave it empty when you cannot tell; never guess.**\n' +
      '- dueRaw holds the wording used in the record (e.g. "next Tuesday", "by 8/15") so the reader can check ' +
      'the resolved date. Empty string if no deadline was mentioned.\n' +
      '- **Only pick up deadlines for things still to be done.** Reports often list past events by date ' +
      '("dissolved on 23 January", "polling day 8 February"). Those already happened and are not deadlines. ' +
      'Put them in neither todos nor decided.\n' +
      'Fields:\n' +
      '- decided: {"text":"what was decided","who":"who decided or proposed it (empty if unknown)",' +
      '"date":"YYYY-MM-DD or empty","dateRaw":"the original wording"}\n' +
      '  date is **the date the decision refers to** (when it is held, starts, takes effect). ' +
      '**It is not the date the decision was made or the meeting was held.**\n' +
      '  For a range such as "19 March to 26 September", put the **first day** in date and keep the ' +
      'whole range in dateRaw.\n' +
      '  Leave date and dateRaw empty when no date is written. **Never invent a date.**\n' +
      '- undecided: {"text":"what is still open","waiting":"what or whose reply it waits on (empty if unknown)"}\n' +
      '- todos: {"text":"the task","who":"owner (empty if unknown)","due":"YYYY-MM-DD or empty","dueRaw":"original wording"}\n' +
      '- If something in decided is work someone will do, also put it in todos (duplication is fine).\n' +
      '- Use an empty array when there is nothing for a field.\n' +
      'Output exactly this shape:\n' +
      '{"decided":[{"text":"","who":"","date":"","dateRaw":""}],"undecided":[{"text":"","waiting":""}],' +
      '"todos":[{"text":"","who":"","due":"","dueRaw":""}]}';
  }

  function str(v) { return String(v == null ? '' : v).trim(); }

  // 形が合っていても値が壊れていることがある（AIは 2026-13-45 のような日付を返す）。
  // 実在する日付かどうかまで見て、駄目なら空文字にする。
  function ymd(v) {
    var d = str(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
    var p = d.split('-'), dt = new Date(d + 'T00:00:00');
    if (isNaN(dt.getTime()) || dt.getMonth() + 1 !== Number(p[1]) || dt.getDate() !== Number(p[2])) return '';
    return d;
  }

  // AIの返答を、UIが扱いやすい形に整える。
  // 形も値も信用しない（AIは 2026-13-45 のような日付や、空の要素を返すことがある）。
  function normalize(raw) {
    var o = raw || {};
    if (Array.isArray(o)) o = { decided: o };   // 配列だけで返ってくることがある
    var out = { decided: [], undecided: [], todos: [] };

    (Array.isArray(o.decided) ? o.decided : []).forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var t = str(it.text); if (!t) return;
      // 決まったことにも日付を持たせる。「9/15に開催」のような予定は、
      // やることの期限より先にカレンダーへ入れたいことが多い。
      out.decided.push({ text: t, who: str(it.who), date: ymd(it.date), dateRaw: str(it.dateRaw) });
    });
    (Array.isArray(o.undecided) ? o.undecided : []).forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var t = str(it.text); if (!t) return;
      out.undecided.push({ text: t, waiting: str(it.waiting) });
    });
    (Array.isArray(o.todos) ? o.todos : []).forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var t = str(it.text); if (!t) return;
      out.todos.push({ text: t, who: str(it.who), due: ymd(it.due), dueRaw: str(it.dueRaw) });
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
      // 拡張子だけが .pdf でMIMEが空のことがある（端末による）。その場合も PDF として送る。
      var mime = list[n].type || (/\.pdf$/i.test(list[n].name || '') ? 'application/pdf' : 'image/jpeg');
      parts.push({ inline_data: { mime_type: mime, data: b64 } });
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

  global.DecideAI = {
    extract: extract, normalize: normalize, extractJson: extractJson,
    MODELS: MODELS, MAX_FILES: MAX_FILES
  };
})(typeof window !== 'undefined' ? window : this);
