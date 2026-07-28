// schedule-parser.js — 予定表ドロッパーの抽出エンジン
// 1枚の予定表（年間行事予定・大会日程表・リーグ戦日程など）から、N件の予定を取り出す。
// window.SchedParser = { parse(text, opts), fiscalYearOf(text) } を公開する。
//
// イベントドロッパー（parser.js）との違い：
//   あちらは「1枚 = 1イベント」、こちらは「1枚 = N件の別々の予定」。
//   表の1行に複数のレコードが横並びになるため、日付の出現位置で行を切り分ける。
(function (global) {
  'use strict';

  // ===== 前処理 =====
  // 予定表は全角数字（２０２５年度）や康熙部首が混ざる。NFKCで揃えないと年度も日付も拾えない。
  var RADICAL_FIX = {
    '⻄': '西', '⻑': '長', '⻒': '長', '⺼': '月',
    '⻝': '食', '⻞': '食', '⻤': '鬼', '⻩': '黄',
    '⻫': '斉', '⻲': '亀'
  };
  function normalize(s) {
    s = String(s);
    try { s = s.normalize ? s.normalize('NFKC') : s; } catch (e) {}
    s = s.replace(/[⺀-⻳]/g, function (c) { return RADICAL_FIX[c] || c; });
    return s.replace(/　/g, ' ');
  }

  // ===== 年度の判定 =====
  // 「2025年度」「令和8年度」を最優先。無ければ「2026年」等の年、それも無ければ null（利用者が指定する）。
  function fiscalYearOf(rawText) {
    var t = normalize(rawText);
    var m = t.match(/(\d{4})\s*年\s*度/);
    if (m) return Number(m[1]);
    var r = t.match(/(?:令和|R)\s*(\d{1,2})\s*年\s*度/);
    if (r) return 2018 + Number(r[1]);
    var y = t.match(/(\d{4})\s*年/);
    if (y) return Number(y[1]);
    var r2 = t.match(/(?:令和|R)\s*(\d{1,2})\s*年/);
    if (r2) return 2018 + Number(r2[1]);
    return null;
  }

  // ===== 日付トークン =====
  // スラッシュ表記と漢字表記を別々に書く。ひとつの正規表現で「日?」を共用すると、
  // 「25/3/19 ～22 日本選手権」の "日本" の日まで日付の一部として食べてしまうため。
  //   スラッシュ: 4/13 / 25/3/19 / 6/14～15 / 7/25(土)
  //   漢字      : 4月13日 / 7月30日～8月2日
  var WD = '(?:\\s*[（(]\\s*[月火水木金土日祝・]{1,3}\\s*[）)])?';   // 曜日かっこ
  var RANGE = '[～~〜ー]';                                        // 範囲の区切り（ハイフンは対戦表と紛れるため除く）
  var DATE_RE = new RegExp(
    '(?:(\\d{2})\\/)?(\\d{1,2})\\/(\\d{1,2})' + WD +
      '(?:\\s*' + RANGE + '\\s*(?:(\\d{1,2})\\/)?(\\d{1,2}))?' +
    '|' +
    '(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日' + WD +
      '(?:\\s*' + RANGE + '\\s*(?:(\\d{1,2})\\s*月\\s*)?(\\d{1,2})\\s*日)?',
    'g');

  // 説明文・注記の行は予定ではない（「2025/1/22 現在の予定であり…」等）
  var PROSE_RE = /(います|ます|ください|下さい|致し|申し上げ|おります|ですので|ございま|場合があります|変更する|予定であり)/;
  // 表の見出し行（「期　日 場　所」「大会名」だけの行）
  var HEADER_RE = /^(?:期\s*日|日\s*程|月\s*日|期\s*間|大\s*会\s*名|行\s*事\s*名|場\s*所|会\s*場|備\s*考|曜\s*日|県\s*名|体\s*育\s*館|試\s*合\s*日|試\s*合\s*開\s*始|対\s*戦|都\s*道\s*府\s*県)+$/;
  // 場所欄の見つけ方。予定表によって2通りの書かれ方がある。
  //   「埼玉県 深谷市他」… 1行に都道府県つきで書かれる → その行から後ろが場所
  //   「高知」＋「高知県民体育館」… 県名だけの行と会場の行に分かれる → 県名の行から後ろが場所
  var PREF_STEM = '青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|東京|神奈川|新潟|富山|' +
    '石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|京都|大阪|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|' +
    '山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄';
  var PREF_HEAD_RE = new RegExp('^(?:北海道|(?:' + PREF_STEM + ')(?:都|府|県))');
  // 県名だけの表記は、Tリーグ日程表の「静岡」「岡山」のようなチーム名と見分けが付かない。
  // 拾ってよいのは場所欄の位置（後ろから2行以内）に来たときだけ。
  var PREF_ONLY_RE = new RegExp('^(?:北海道|(?:' + PREF_STEM + ')(?:都|府|県)?)$');
  // 「★ ★」のような飾りだけの行。表の末尾に置かれ、直前の予定に吸い込まれてしまう。
  // ハイフンは入れないこと（「静岡 - KM東京」の対戦表記が壊れる）。
  var NOISE_RE = /^[\s★☆◆◇■□●○▲△▼▽※＊*＝=…・]+$/;

  /* ===== 英語の予定表（en/in版） =====
     英語でもGoogleのOCRは表を「1セル＝1行」で返す（実データで確認済み）。
     行を集める仕組みは日本語と同じものを使い、日付・時刻・区切り語だけを差し替える。 */
  var EN_MON = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|' +
    'Aug(?:ust)?|Sept(?:ember)?|Sep|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
  var EN_ORD = '(?:st|nd|rd|th)?';
  // 「7 Feb」「21st March 2024」「20 – 22 June」／「Feb 7」「Mar 15, 2026」「Jun 20 - 21」
  // 日の直後の (?!\d) が肝心。無いと見出しの「MAY 2027」を 5月20日 と読んでしまう。
  // 月名の直後の \b も要る。無いと「Term 1 marks」の "1 mar" を 3月1日 と読む（実データで発生）。
  var EN_DATE_RE = new RegExp(
    '(\\d{1,2})' + EN_ORD + '(?!\\d)(?:\\s*[-–—]\\s*(\\d{1,2})' + EN_ORD + '(?!\\d))?\\s*(' + EN_MON + ')\\b\\.?(?:,?\\s*(\\d{4})(?!\\d))?' +
    '|' +
    '(' + EN_MON + ')\\b\\.?\\s+(\\d{1,2})' + EN_ORD + '(?!\\d)(?:\\s*[-–—]\\s*(\\d{1,2})' + EN_ORD + '(?!\\d))?(?:,?\\s*(\\d{4})(?!\\d))?',
    'gi');
  // 「7:30 PM」「7 pm」。24時間制と取り違えると 19:30 が 07:30 になる。
  var EN_TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?\b/i;
  // 曜日だけの行。英語の予定表では日付とは別の列に置かれ、行事名に混ざる。
  var EN_WD_RE = /^(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|sday|nesday|rsday|urday)?\.?$/i;
  var EN_HEADER_RE = /^(?:date|day|time|match|fixture|opponent|versus|venue|location|place|activity|event|details|notes?|organiser|organizer|contact(?:\s+details)?)$/i;
  var EN_TBC_RE = /^(?:tbc|tba|t\.b\.c\.?|to be confirmed|to be advised|n\/a)$/i;
  // 曜日・時刻・TBC・記号だけでできた行事名は予定ではない。ポスター体裁の予定表は
  // OCRが列ごとに返すため、時刻の列や曜日の列がまるごと行事名になってしまう。
  // ※行事名の途中の曜日は消さないこと。「University holiday - Easter Monday」が壊れる。
  var EN_JUNK_RE = /(?:\b(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|sday|nesday|rsday|urday)?\b|\b\d{1,2}(?::\d{2})?\s*[ap]\.?\s*m\.?|\btbc\b|\btba\b|[\s,.;:()\-–—/]+)/gi;
  // 注記の文。英語の日付を拾えるようにすると「Approved by Senate 21st March 2024」が予定になる。
  var EN_PROSE_RE = /\b(?:will|shall|must|please|approved by|correct at|subject to change|notified|informed?|for more information)\b/i;
  var EN_MON_NUM = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  // 表の見出しのうち、場所を表す語。見出しの末尾に何列並んでいるかを数えて、
  // 各行の後ろ何行が場所なのかを決める（Tリーグは「都道府県」＋「会場」の2列）。
  var VENUE_HEAD_RE = /^(?:venue|location|place|ground|stadium|会場|場所|体育館|開催地|開催場所)$/i;
  var REGION_HEAD_RE = /^(?:prefecture|state|region|country|area|都道府県|県名|開催県)$/i;
  function enMonth(name) { return EN_MON_NUM[String(name).slice(0, 3).toLowerCase()] || 0; }
  // 祝日・休業日の名前は「予定」ではないので、行事名から取り除く。
  // 「地域訪問 秋分の日」のように本来の予定と同じ欄に並ぶことがあるため、行ごと捨てずに語だけ消す。
  var HOLIDAY_RE = /(元日|成人の日|建国記念の日|建国記念日|天皇誕生日|春分の日|昭和の日|憲法記念日|みどりの日|こどもの日|子どもの日|海の日|山の日|敬老の日|秋分の日|スポーツの日|体育の日|文化の日|勤労感謝の日|振替休日|国民の休日|祝日|大晦日)/g;

  function iso(y, m, d) { return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2); }
  function valid(m, d) { return m >= 1 && m <= 12 && d >= 1 && d <= 31; }

  // 年度は4月始まり。1〜3月は翌年になる。
  function yearFor(month, fy) { return month >= 4 ? fy : fy + 1; }

  // 行末に残りがちな記号・区切りを落とす
  function tidy(s) {
    return String(s)
      .replace(/^[\s|｜:：・･,，、\-–—]+/, '')
      .replace(/[\s|｜:：・･,，、\-–—]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ===== 本体 =====
  // opts.fiscalYear : 年度（未指定なら本文から判定。判定できなければ予定は返すが year は null 扱い）
  // 戻り値: { fiscalYear, yearKnown, items:[{start,end,time,title,place,raw}], skipped:[…] }
  function parse(rawText, opts) {
    opts = opts || {};
    // 英語版（en/in）は日付・時刻・区切り語が別物。画面の window.LANG をそのまま渡してもらう。
    var EN = (opts.lang === 'en' || opts.lang === 'in');
    var text = normalize(rawText);
    var fy = opts.fiscalYear || fiscalYearOf(rawText);
    var yearKnown = !!fy;
    if (!fy) fy = new Date().getFullYear();

    var items = [], skipped = [];
    // GoogleのOCRは表を「1セル＝1行」に分解して返すことがある（日付だけの行が続く）。
    // 行をまたいで本文を拾えるよう、配列にしてから位置を見て処理する。
    var lines = text.split(/\r?\n/)
      .map(function (s) { return s.replace(/\t/g, ' ').trim(); })
      .filter(Boolean);

    // 1行の中の日付をすべて拾う（1行に複数レコードが並ぶ表に対応）。
    // 日本語と英語で正規表現が違うので、取り出した値をここで同じ形に揃える。
    function dateHits(line) {
      var re = EN ? EN_DATE_RE : DATE_RE, out = [], m;
      re.lastIndex = 0;
      while ((m = re.exec(line)) !== null) {
        var g;
        if (EN) {
          // 日が先（1〜4）と月が先（5〜8）のどちらで当たったかを揃える。yyyy は西暦4桁。
          g = (m[3] !== undefined)
            ? { mo: enMonth(m[3]), da: m[1], ed: m[2], em: undefined, yyyy: m[4] }
            : { mo: enMonth(m[5]), da: m[6], ed: m[7], em: undefined, yyyy: m[8] };
        } else {
          // スラッシュ表記（1〜5）と漢字表記（6〜9）のどちらで当たったかを揃える
          g = (m[1] !== undefined || m[2] !== undefined)
            ? { yy: m[1], mo: m[2], da: m[3], em: m[4], ed: m[5] }
            : { yy: undefined, mo: m[6], da: m[7], em: m[8], ed: m[9] };
        }
        if (!g.mo || !valid(Number(g.mo), Number(g.da))) continue;
        out.push({ i: m.index, len: m[0].length, g: g });
      }
      return out;
    }
    function hasDate(s) { return dateHits(s).length > 0; }
    function isHeader(s) {
      return HEADER_RE.test(s.replace(/\s/g, '')) || (EN && EN_HEADER_RE.test(s));
    }
    function isProse(s) { return EN ? EN_PROSE_RE.test(s) : PROSE_RE.test(s); }
    // 英語には都道府県のような手がかりが無いので、「表の末尾が場所の列」という並びを使う。
    function headWord(s, re) { return re.test(s.replace(/\s/g, '')) || re.test(s.trim()); }
    // 見出しの末尾に場所の列が何本並んでいるかを数える。
    // ICC「Date/Match/Venue」＝1、Tリーグ「…/都道府県/会場」＝2、
    // ASA「…/Venue/Organiser/Contact」＝0（会場が最後でないので発動しない）。
    function venueColsOf(head) {
      var n = 0;
      for (var i = head.length - 1; i >= 0; i--) {
        if (n === 0 && headWord(head[i], VENUE_HEAD_RE)) { n = 1; continue; }
        if (n > 0 && headWord(head[i], REGION_HEAD_RE)) { n++; continue; }
        break;
      }
      return n;
    }
    // 行ごとに「直前の見出しでは後ろ何列が場所か」を持たせる。1つの文書に表が何枚も入り、
    // 列構成が途中で変わるため（全国大会は「場所」1列、四国は「県名＋体育館」2列）。
    var venueColsAt = [];
    (function () {
      var cur = 0, i = 0;
      while (i < lines.length) {
        if (isHeader(lines[i])) {
          var j = i, head = [];
          while (j < lines.length && isHeader(lines[j])) { head.push(lines[j]); j++; }
          cur = venueColsOf(head);
          for (var k = i; k < j; k++) venueColsAt[k] = cur;
          i = j;
        } else {
          venueColsAt[i] = cur;
          i++;
        }
      }
    })();

    lines.forEach(function (line, li) {
      if (isHeader(line)) return;

      var hits = dateHits(line);
      if (!hits.length) {
        if (/未\s*定/.test(line) || (EN && EN_TBC_RE.test(line))) {
          skipped.push({ reason: 'undecided', raw: tidy(line) });
        }
        return;
      }

      hits.forEach(function (h, k) {
        var end = (k + 1 < hits.length) ? hits[k + 1].i : line.length;
        // 日付より前の文字も本文に入れる。日付が行の途中にある予定表があるため
        // （IPLは「Kolkata Knight Riders 1st Match Sun Mar 15, 2026 …」とチーム名が先）。
        // 2件目以降の日付では、手前は前の予定の本文としてすでに使われているので足さない。
        var head = (k === 0) ? tidy(line.slice(0, h.i)) : '';
        var body = tidy(line.slice(h.i + h.len, end));
        if (head) body = tidy(head + ' ' + body);
        // 同じ行に本文が無いとき（＝1セル1行で返ってきたとき）は、
        // 次の日付が現れるまでの行をまとめて本文にする。
        var place = '';
        if (!body && k === hits.length - 1) {
          var buf = [];
          for (var j = li + 1; j < lines.length && buf.length < 8; j++) {
            if (hasDate(lines[j]) || isHeader(lines[j])) break;
            // 「未定」は日付の無い別の予定、「◯◯予定表」は次の表の見出し。
            // どちらもここで区切らないと、直前の予定の行事名に吸い込まれる。
            if (/未\s*定/.test(lines[j]) || /(?:予\s*定\s*表|日\s*程\s*表)/.test(lines[j])) break;
            if (EN && EN_TBC_RE.test(lines[j])) break;
            if (NOISE_RE.test(lines[j])) continue;
            if (EN && EN_WD_RE.test(lines[j])) continue;   // 曜日だけの行は行事名ではない
            buf.push(lines[j]);
          }
          // 場所は行の末尾に置かれる。後ろから2行以内だけを候補にする
          // （途中にあるチーム名の「岡山」等を場所と読み違えないため）。
          // 先頭に来た場合は行事名が無くなってしまうので分けない。
          var pi = -1;
          for (var q = Math.max(1, buf.length - 2); q < buf.length; q++) {
            if (PREF_HEAD_RE.test(buf[q]) || PREF_ONLY_RE.test(buf[q])) { pi = q; break; }
          }
          // 都道府県で見つからないときの受け皿。見出しの末尾が場所の列なら、行の末尾が場所。
          // 英語の予定表にはこれしか手がかりが無い。日本語でも「台湾新竹県」のように
          // 47都道府県に当てはまらない場所を拾える。
          var vc = venueColsAt[li] || 0;
          if (pi < 0 && vc > 0 && buf.length > vc) pi = buf.length - vc;
          if (pi > 0) {
            place = tidy(buf.slice(pi).join(' '));
            buf = buf.slice(0, pi);
          }
          body = tidy(buf.join(' '));
        }
        // 日付の直後が説明文なら、それは予定ではなく注記
        if (isProse(body)) { skipped.push({ reason: 'prose', raw: body.slice(0, 60) }); return; }

        var yy = h.g.yy, mo = Number(h.g.mo), da = Number(h.g.da);
        var em = h.g.em ? Number(h.g.em) : null, ed = h.g.ed ? Number(h.g.ed) : null;
        // 年の決め方が言語で違う。英語には「年度」が無いので、入力された年をそのまま使う。
        // 年度のつもりで 4月始まりに繰り上げると、ICC日程の「7 Feb」が翌年になってしまう。
        var year = EN
          ? (h.g.yyyy ? Number(h.g.yyyy) : fy)
          : (yy ? (2000 + Number(yy)) : yearFor(mo, fy));
        var startD = iso(year, mo, da);
        var endD = '';
        if (ed && valid(em || mo, ed)) {
          var eMonth = em || mo;
          // 「7月30日～8月2日」のように月をまたぐ場合、終わりの月が小さければ翌年へ
          var eYear = em ? (yy ? year : yearFor(eMonth, fy)) : year;
          if (eMonth < mo && !em) eYear = year + 1;
          if (em && eMonth < mo) eYear = year + 1;
          endD = iso(eYear, eMonth, ed);
          if (endD <= startD) endD = '';   // 逆転・同日は範囲にしない
        }

        // 時刻（19:00 / 13時30分 / 7:30 PM）
        var time = '';
        // 午前午後つきを先に見る。24時間制と取り違えると「7:30 PM」が 07:30 になる。
        var tp = EN ? body.match(EN_TIME_RE) : null;
        var t1 = body.match(/(\d{1,2}):(\d{2})/);
        // 「3時間授業」「約2時間」の "時間" は所要時間であって時刻ではないので拾わない
        var t2 = body.match(/(\d{1,2})\s*時(?!\s*間)\s*(?:(\d{1,2})\s*分)?/);
        if (tp) {
          var ph = Number(tp[1]) % 12;
          if (/p/i.test(tp[3])) ph += 12;
          time = ('0' + ph).slice(-2) + ':' + (tp[2] || '00');
          body = tidy(body.replace(tp[0], ' '));
        }
        else if (t1) { time = ('0' + t1[1]).slice(-2) + ':' + t1[2]; body = tidy(body.replace(t1[0], ' ')); }
        else if (t2) { time = ('0' + t2[1]).slice(-2) + ':' + ('0' + (t2[2] || '0')).slice(-2); body = tidy(body.replace(t2[0], ' ')); }

        // 祝日名を落とす。残りが無ければ祝日だけの行なので予定にしない。
        var hadHoliday = HOLIDAY_RE.test(body);
        HOLIDAY_RE.lastIndex = 0;
        if (hadHoliday) body = tidy(body.replace(HOLIDAY_RE, ' '));
        if (!body) { skipped.push({ reason: hadHoliday ? 'holiday' : 'empty', raw: line.slice(0, 60) }); return; }
        // 曜日や時刻だけが残った行事名は、列ごとに返ってきた表のかけら
        if (EN) {
          EN_JUNK_RE.lastIndex = 0;
          if (!body.replace(EN_JUNK_RE, '').trim()) {
            skipped.push({ reason: 'fragment', raw: body.slice(0, 40) }); return;
          }
        }
        // 記号や1文字だけの断片は予定名として意味をなさない
        if (body.replace(/[\s()（）「」『』・,，、.．:：;；\/\\|｜~〜～\-–—★☆＊*※]/g, '').length < 2) {
          skipped.push({ reason: 'fragment', raw: body.slice(0, 40) }); return;
        }
        // 年度（4月〜翌3月）の外に出た予定は、勝手に直さず印だけ付けて利用者に確認してもらう。
        // 「25/1/17」のように年が明記された行が混ざることがあるため。
        // 英語には年度が無いので、外れているかどうかは暦年で見る。
        // 4月始まりの窓で見ると、2月・3月の予定がすべて⚠になってしまう。
        var outOfRange = yearKnown && (EN
          ? (startD < iso(fy, 1, 1) || startD > iso(fy, 12, 31))
          : (startD < iso(fy, 4, 1) || startD > iso(fy + 1, 3, 31)));
        items.push({
          start: startD, end: endD, time: time,
          title: body, place: place, raw: body,
          year: year, yearWritten: !!yy, outOfRange: outOfRange
        });
      });
    });

    return { fiscalYear: fy, yearKnown: yearKnown, items: items, skipped: skipped };
  }

  global.SchedParser = { parse: parse, fiscalYearOf: fiscalYearOf, normalize: normalize };
})(typeof window !== 'undefined' ? window : this);
