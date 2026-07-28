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
  // 「都道府県だけの行」は、場所欄の始まり。47都道府県の完全一致に限る。
  // 「◯◯県」で広く拾うと「県大会」のような行事名を場所と読み違えるため。
  var PREF_RE = /^(?:北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)$/;
  // 「★ ★」のような飾りだけの行。表の末尾に置かれ、直前の予定に吸い込まれてしまう。
  // ハイフンは入れないこと（「静岡 - KM東京」の対戦表記が壊れる）。
  var NOISE_RE = /^[\s★☆◆◇■□●○▲△▼▽※＊*＝=…・]+$/;
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

    function hasDate(s) {
      DATE_RE.lastIndex = 0;
      var mm;
      while ((mm = DATE_RE.exec(s)) !== null) {
        var mo = mm[2] !== undefined ? mm[2] : mm[6];
        var da = mm[3] !== undefined ? mm[3] : mm[7];
        if (mo && valid(Number(mo), Number(da))) return true;
      }
      return false;
    }
    function isHeader(s) { return HEADER_RE.test(s.replace(/\s/g, '')); }

    lines.forEach(function (line, li) {
      if (isHeader(line)) return;

      // 行内のすべての日付位置を拾う（1行に複数レコードが並ぶ表に対応）
      var hits = [], m;
      DATE_RE.lastIndex = 0;
      while ((m = DATE_RE.exec(line)) !== null) {
        // スラッシュ表記（1〜5）と漢字表記（6〜9）のどちらで当たったかを揃える
        var g = m[1] !== undefined || m[2] !== undefined
          ? { yy: m[1], mo: m[2], da: m[3], em: m[4], ed: m[5] }
          : { yy: undefined, mo: m[6], da: m[7], em: m[8], ed: m[9] };
        if (!g.mo || !valid(Number(g.mo), Number(g.da))) continue;
        hits.push({ i: m.index, len: m[0].length, g: g });
      }
      if (!hits.length) {
        if (/未\s*定/.test(line)) skipped.push({ reason: 'undecided', raw: tidy(line) });
        return;
      }

      hits.forEach(function (h, k) {
        var end = (k + 1 < hits.length) ? hits[k + 1].i : line.length;
        var body = tidy(line.slice(h.i + h.len, end));
        // 同じ行に本文が無いとき（＝1セル1行で返ってきたとき）は、
        // 次の日付が現れるまでの行をまとめて本文にする。
        var place = '';
        if (!body && k === hits.length - 1) {
          var buf = [];
          for (var j = li + 1; j < lines.length && buf.length < 8; j++) {
            if (hasDate(lines[j]) || isHeader(lines[j])) break;
            if (NOISE_RE.test(lines[j])) continue;
            buf.push(lines[j]);
          }
          // 都道府県だけの行から後ろは会場（都道府県と会場が別の列になっている表）。
          // 先頭に来た場合は行事名が無くなってしまうので分けない。
          var pi = -1;
          for (var q = 0; q < buf.length; q++) { if (PREF_RE.test(buf[q])) { pi = q; break; } }
          if (pi > 0 && pi < buf.length - 1) {
            place = tidy(buf.slice(pi).join(' '));
            buf = buf.slice(0, pi);
          }
          body = tidy(buf.join(' '));
        }
        // 日付の直後が説明文なら、それは予定ではなく注記
        if (PROSE_RE.test(body)) { skipped.push({ reason: 'prose', raw: body.slice(0, 60) }); return; }

        var yy = h.g.yy, mo = Number(h.g.mo), da = Number(h.g.da);
        var em = h.g.em ? Number(h.g.em) : null, ed = h.g.ed ? Number(h.g.ed) : null;
        var year = yy ? (2000 + Number(yy)) : yearFor(mo, fy);
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

        // 時刻（19:00 / 13時30分）
        var time = '';
        var t1 = body.match(/(\d{1,2}):(\d{2})/);
        // 「3時間授業」「約2時間」の "時間" は所要時間であって時刻ではないので拾わない
        var t2 = body.match(/(\d{1,2})\s*時(?!\s*間)\s*(?:(\d{1,2})\s*分)?/);
        if (t1) { time = ('0' + t1[1]).slice(-2) + ':' + t1[2]; body = tidy(body.replace(t1[0], ' ')); }
        else if (t2) { time = ('0' + t2[1]).slice(-2) + ':' + ('0' + (t2[2] || '0')).slice(-2); body = tidy(body.replace(t2[0], ' ')); }

        // 祝日名を落とす。残りが無ければ祝日だけの行なので予定にしない。
        var hadHoliday = HOLIDAY_RE.test(body);
        HOLIDAY_RE.lastIndex = 0;
        if (hadHoliday) body = tidy(body.replace(HOLIDAY_RE, ' '));
        if (!body) { skipped.push({ reason: hadHoliday ? 'holiday' : 'empty', raw: line.slice(0, 60) }); return; }
        // 記号や1文字だけの断片は予定名として意味をなさない
        if (body.replace(/[\s()（）「」『』・,，、.．:：;；\/\\|｜~〜～\-–—★☆＊*※]/g, '').length < 2) {
          skipped.push({ reason: 'fragment', raw: body.slice(0, 40) }); return;
        }
        // 年度（4月〜翌3月）の外に出た予定は、勝手に直さず印だけ付けて利用者に確認してもらう。
        // 「25/1/17」のように年が明記された行が混ざることがあるため。
        var outOfRange = yearKnown && (startD < iso(fy, 4, 1) || startD > iso(fy + 1, 3, 31));
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
