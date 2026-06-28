// parser.js — 要項テキストから項目を推定
// window.Dropper = { parse(text), addDays(iso,n), isPast(dates) } を公開する。
(function (global) {
  'use strict';
  var PAST_GRACE_DAYS = 10;

  // ===== 競技プロファイル =====
  // 競技ごとの語彙をここで定義する。UIの競技セレクタで選んだキーを使う。
  //   key           : 内部キー（UIの選択値）
  //   label         : 表示名
  //   sportKeywords : この競技の名前キーワード（自動判定・除外の保護に使う）
  //   formats       : 試合形式の抽出ルール配列。各ルール { re, label, skipIfAny, skipIfNone }
  //       re         : この正規表現が本文にマッチしたら label を候補に追加
  //       skipIfAny  : 既に追加済みのラベルのいずれかがこの正規表現に当たる場合は追加しない（排他用）
  //       skipIfNone : 既に追加済みのラベルのどれかがこの正規表現に当たる「とき以外」は追加しない（フォールバック用）
  // excludeSports は全競技共通リスト（ALL_SPORTS）を使い、「選択中の競技キーワードに該当しなければ弾く」方式。
  // 汎用モード（competition:'auto'で競技未特定など）は弾かない。

  // 全競技名の共通リスト（大会名に他競技が混入した場合に空にする判定用）
  var ALL_SPORTS = /(卓\s*球|ラ\s*ー\s*ジ\s*ボ\s*ー\s*ル|ピ\s*ン\s*ポ\s*ン|バ\s*ド\s*ミ\s*ン\s*ト\s*ン|バ\s*レ\s*ー\s*ボ\s*ー\s*ル|バ\s*ス\s*ケ\s*ッ\s*ト\s*ボ\s*ー\s*ル|柔\s*道|空\s*手|剣\s*道|弓\s*道|サ\s*ッ\s*カ\s*ー|フ\s*ッ\s*ト\s*サ\s*ル|野\s*球|ソ\s*フ\s*ト\s*ボ\s*ー\s*ル|ホ\s*ッ\s*ケ\s*ー|水\s*泳|陸\s*上\s*競\s*技|体\s*操|ラ\s*グ\s*ビ\s*ー|テ\s*ニ\s*ス|カ\s*ヌ\s*ー)/;

  var SPORT_PROFILES = {
    tabletennis: {
      label: '卓球・バドミントン',
      sportKeywords: /卓\s*球|ラ\s*ー\s*ジ\s*ボ\s*ー\s*ル|ピ\s*ン\s*ポ\s*ン|バ\s*ド\s*ミ\s*ン\s*ト\s*ン/,
      formats: [
        { re: /団\s*体/, label: '団体戦' },
        { re: /個\s*人\s*戦/, label: '個人戦' },
        { re: /男\s*女\s*シングルス/, label: '男女シングルス' },
        { re: /シングルス/, label: 'シングルス', skipIfAny: /シングルス/ },
        { re: /混\s*合\s*ダブルス/, label: '混合ダブルス' },
        { re: /男\s*女\s*ダブルス/, label: '男女ダブルス' },
        { re: /男\s*子\s*ダブルス/, label: '男子ダブルス' },
        { re: /女\s*子\s*ダブルス/, label: '女子ダブルス' },
        { re: /ダブルス/, label: 'ダブルス', skipIfAny: /ダブルス/ }
      ]
    },
    volleyball: {
      label: 'バレーボール',
      sportKeywords: /バ\s*レ\s*ー\s*ボ\s*ー\s*ル|バ\s*レ\s*ー/,
      formats: [
        { re: /6\s*人\s*制|６\s*人\s*制/, label: '6人制' },
        { re: /9\s*人\s*制|９\s*人\s*制/, label: '9人制' },
        { re: /ビ\s*ー\s*チ\s*バ\s*レ\s*ー/, label: 'ビーチ' },   // 連語限定（単独「ビーチ」誤検出対策）
        { re: /混\s*合/, label: '混合' },
        { re: /男\s*女/, label: '男女' }
      ]
    },
    basketball: {
      label: 'バスケットボール',
      sportKeywords: /バ\s*ス\s*ケ\s*ッ\s*ト\s*ボ\s*ー\s*ル|バ\s*ス\s*ケ|ミ\s*ニ\s*バ\s*ス/,
      formats: [
        { re: /3\s*[xX×]\s*3|３\s*[xX×]\s*３/, label: '3x3' },
        { re: /ミ\s*ニ\s*バ\s*ス/, label: 'ミニバス' },
        { re: /ト\s*ー\s*ナ\s*メ\s*ン\s*ト/, label: 'トーナメント' },
        { re: /リ\s*ー\s*グ\s*戦/, label: 'リーグ戦' },
        { re: /男\s*女/, label: '男女' }
      ]
    },
    budo: {
      label: '柔道・空手',
      sportKeywords: /柔\s*道|空\s*手|剣\s*道/,
      formats: [
        { re: /団\s*体/, label: '団体' },
        { re: /個\s*人/, label: '個人' },
        { re: /組\s*手/, label: '組手' },
        // 「形」は文脈限定（「形式」「型番号」の誤検出対策）
        { re: /(?:個人|団体|男子|女子|種目|部門)\s*[・、]?\s*形|形\s*[・、]?\s*(?:組手|の部|競技)|形\s*の\s*部/, label: '形' },
        { re: /体\s*重\s*別|階\s*級\s*別/, label: '体重別' },
        { re: /無\s*差\s*別/, label: '無差別' },
        { re: /男\s*女/, label: '男女' }
      ]
    },
    soccer: {
      label: 'サッカー・フットサル',
      sportKeywords: /サ\s*ッ\s*カ\s*ー|フ\s*ッ\s*ト\s*サ\s*ル/,
      formats: [
        { re: /フ\s*ッ\s*ト\s*サ\s*ル/, label: 'フットサル' },
        { re: /予\s*選\s*リ\s*ー\s*グ/, label: '予選リーグ' },
        { re: /決\s*勝\s*ト\s*ー\s*ナ\s*メ\s*ン\s*ト/, label: '決勝トーナメント' },
        { re: /ト\s*ー\s*ナ\s*メ\s*ン\s*ト/, label: 'トーナメント', skipIfAny: /トーナメント/ },
        { re: /リ\s*ー\s*グ\s*戦/, label: 'リーグ戦', skipIfAny: /リーグ/ },
        { re: /男\s*女/, label: '男女' }
      ]
    },
    baseball: {
      label: '野球・ソフトボール',
      sportKeywords: /野\s*球|ソ\s*フ\s*ト\s*ボ\s*ー\s*ル/,
      formats: [
        { re: /硬\s*式/, label: '硬式' },
        { re: /軟\s*式/, label: '軟式' },
        { re: /学\s*童|少\s*年/, label: '学童・少年' },
        { re: /ト\s*ー\s*ナ\s*メ\s*ン\s*ト/, label: 'トーナメント' },
        { re: /リ\s*ー\s*グ\s*戦/, label: 'リーグ戦' },
        { re: /男\s*女/, label: '男女' }
      ]
    }
  };

  // 既定の競技キー
  var DEFAULT_SPORT = 'tabletennis';

  // =====================================================================
  // 英語要項用ロジック（dropper_parser_en.py を移植）
  // window.LANG が 'en' / 'in' のとき parseEn() を使う。
  // 戻り値は日本語版と同じ8キー（taikai_mei, kaisai_dates, kaikai_jikan,
  // kaijo, kaijo_jusho, shimekiri, shiai_keishiki, note）で互換。
  // =====================================================================

  // 英語競技プロファイル（7競技）。試合形式語彙は875件の実データ分析に基づく。
  var SPORT_PROFILES_EN = {
    soccer: {
      label: 'Soccer / Futsal',
      sportKeywords: /\b(soccer|football|futsal)\b/i,
      formats: [
        { re: /\bfutsal\b/i, label: 'Futsal' },
        { re: /\bcup\b/i, label: 'Cup' },
        { re: /\bknockout\b/i, label: 'Knockout' },
        { re: /\bleague\b/i, label: 'League' },
        { re: /\b(women|girls)\b/i, label: 'Women/Girls' },
        { re: /\b(men|boys)\b/i, label: 'Men/Boys' }
      ]
    },
    tennis: {
      label: 'Tennis',
      sportKeywords: /\btennis\b/i,
      formats: [
        { re: /\bmixed\s+doubles\b/i, label: 'Mixed Doubles' },
        { re: /\b(women|ladies)(?:'s)?\s+doubles\b/i, label: "Women's Doubles" },
        { re: /\b(men|gentlemen)(?:'s)?\s+doubles\b/i, label: "Men's Doubles" },
        { re: /\bdoubles\b/i, label: 'Doubles', skipIfAny: /Doubles/ },
        { re: /\bsingles\b/i, label: 'Singles' }
      ]
    },
    basketball: {
      label: 'Basketball',
      sportKeywords: /\bbasketball\b/i,
      formats: [
        { re: /\b3\s*[xX×]\s*3\b/, label: '3x3' },
        { re: /\bknockout\b/i, label: 'Knockout' },
        { re: /\bround\s+robin\b/i, label: 'Round Robin' },
        { re: /\bleague\b/i, label: 'League' },
        { re: /\b(women|girls)\b/i, label: 'Women/Girls' },
        { re: /\b(men|boys)\b/i, label: 'Men/Boys' }
      ]
    },
    netball: {
      label: 'Netball',
      sportKeywords: /\bnetball\b/i,
      formats: [
        { re: /\b(graded|division|grade)\b/i, label: 'Graded/Division' },
        { re: /\bmixed\b/i, label: 'Mixed' },
        { re: /\bround\s+robin\b/i, label: 'Round Robin' },
        { re: /\bknockout\b/i, label: 'Knockout' },
        { re: /\bleague\b/i, label: 'League' }
      ]
    },
    cricket: {
      label: 'Cricket',
      sportKeywords: /\bcricket\b/i,
      formats: [
        { re: /\bt20\b/i, label: 'T20' },
        { re: /\bone\s*day\b/i, label: 'One Day' },
        { re: /\bknockout\b/i, label: 'Knockout' },
        { re: /\bleague\b/i, label: 'League' },
        { re: /\b(women|girls)\b/i, label: 'Women/Girls' },
        { re: /\b(men|boys)\b/i, label: 'Men/Boys' }
      ]
    },
    swimming: {
      label: 'Swimming',
      sportKeywords: /\bswimming\b/i,
      formats: [
        { re: /\bfreestyle\b/i, label: 'Freestyle' },
        { re: /\b(individual\s+medley|IM)\b/, label: 'IM' },
        { re: /\brelay\b/i, label: 'Relay' },
        { re: /\bbackstroke\b/i, label: 'Backstroke' },
        { re: /\bbreaststroke\b/i, label: 'Breaststroke' },
        { re: /\bbutterfly\b/i, label: 'Butterfly' }
      ]
    },
    golf: {
      label: 'Golf',
      sportKeywords: /\bgolf\b/i,
      formats: [
        { re: /\bhandicap\b/i, label: 'Handicap' },
        { re: /\bstroke\s+play\b/i, label: 'Stroke Play' },
        { re: /\bstableford\b/i, label: 'Stableford' },
        { re: /\bmatch\s+play\b/i, label: 'Match Play' },
        { re: /\bfoursome\b/i, label: 'Foursome' },
        { re: /\bscratch\b/i, label: 'Scratch' }
      ]
    }
  };
  var DEFAULT_SPORT_EN = 'soccer';

  // インド競技プロファイル（7競技・英語版と顔ぶれが違う）。dropper_parser_in.py 由来。
  var SPORT_PROFILES_IN = {
    football: {
      label: 'Football',
      sportKeywords: /football|soccer|futsal/i,
      excludeSports: /badminton|table tennis|kabaddi|carrom|cricket|athletics|hockey|american football/i,
      formats: [
        { re: /futsal/i, label: 'Futsal' },
        { re: /knock\s*-?\s*out|knockout/i, label: 'Knockout' },
        { re: /\bleague\b/i, label: 'League' },
        { re: /group\s+stage/i, label: 'Group Stage' },
        { re: /\bmen'?s|\bboys'?/i, label: 'Men/Boys' },
        { re: /women'?s|girls'?/i, label: 'Women/Girls' }
      ]
    },
    cricket: {
      label: 'Cricket',
      sportKeywords: /cricket/i,
      excludeSports: /badminton|table tennis|kabaddi|carrom|football|soccer|athletics|hockey/i,
      formats: [
        { re: /\bT\s*20\b|twenty\s*20/i, label: 'T20' },
        { re: /one\s*day|\bODI\b|50\s*over/i, label: 'One Day' },
        { re: /test\s+match/i, label: 'Test' },
        { re: /\bleague\b/i, label: 'League' },
        { re: /knock\s*-?\s*out|knockout/i, label: 'Knockout' },
        { re: /\bmen'?s|\bboys'?/i, label: 'Men/Boys' },
        { re: /women'?s|girls'?/i, label: 'Women/Girls' }
      ]
    },
    tabletennis: {
      label: 'Table Tennis',
      sportKeywords: /table tennis|\bTT\b|ping[- ]?pong/i,
      excludeSports: /badminton|cricket|kabaddi|carrom|football|soccer|athletics|hockey|lawn tennis/i,
      formats: [
        { re: /\bmen'?s\s+singles|boys'?\s+singles/i, label: "Men's Singles" },
        { re: /women'?s\s+singles|girls'?\s+singles/i, label: "Women's Singles" },
        { re: /mixed\s+doubles/i, label: 'Mixed Doubles' },
        { re: /doubles/i, label: 'Doubles', skipIfAny: /Doubles/i },
        { re: /singles/i, label: 'Singles', skipIfAny: /Singles/i },
        { re: /\bteam\b/i, label: 'Team' }
      ]
    },
    badminton: {
      label: 'Badminton',
      sportKeywords: /badminton|shuttle/i,
      excludeSports: /table tennis|cricket|kabaddi|carrom|football|soccer|athletics|hockey|volleyball|tennis(?! )/i,
      formats: [
        { re: /\bmen'?s\s+singles|boys'?\s+singles/i, label: "Men's Singles" },
        { re: /women'?s\s+singles|girls'?\s+singles/i, label: "Women's Singles" },
        { re: /mixed\s+doubles/i, label: 'Mixed Doubles' },
        { re: /\bmen'?s\s+doubles/i, label: "Men's Doubles" },
        { re: /women'?s\s+doubles/i, label: "Women's Doubles" },
        { re: /doubles/i, label: 'Doubles', skipIfAny: /Doubles/i },
        { re: /singles/i, label: 'Singles', skipIfAny: /Singles/i },
        { re: /\bteam\s+event\b/i, label: 'Team' }
      ]
    },
    kabaddi: {
      label: 'Kabaddi',
      sportKeywords: /kabaddi/i,
      excludeSports: /badminton|table tennis|cricket|carrom|football|soccer|athletics|hockey/i,
      formats: [
        { re: /knock\s*-?\s*out|knockout/i, label: 'Knockout' },
        { re: /\bleague\b/i, label: 'League' },
        { re: /round\s*robin/i, label: 'Round Robin' },
        { re: /\bmen'?s|\bboys'?/i, label: 'Men/Boys' },
        { re: /women'?s|girls'?/i, label: 'Women/Girls' }
      ]
    },
    carrom: {
      label: 'Carrom',
      sportKeywords: /carrom|carom/i,
      excludeSports: /badminton|table tennis|cricket|kabaddi|football|soccer|athletics|hockey/i,
      formats: [
        { re: /singles/i, label: 'Singles', skipIfAny: /Singles/i },
        { re: /doubles/i, label: 'Doubles', skipIfAny: /Doubles/i },
        { re: /\bteam\b/i, label: 'Team' },
        { re: /\bmen'?s|\bboys'?/i, label: 'Men/Boys' },
        { re: /women'?s|girls'?/i, label: 'Women/Girls' }
      ]
    },
    athletics: {
      label: 'Athletics',
      sportKeywords: /athletics|track and field|track\s*&\s*field/i,
      excludeSports: /badminton|table tennis|kabaddi|carrom|football|soccer|cricket|hockey/i,
      formats: [
        { re: /100\s*m\b|200\s*m\b|400\s*m\b|sprint/i, label: 'Sprint' },
        { re: /800\s*m\b|1500\s*m\b|5000\s*m\b|long distance|marathon/i, label: 'Distance' },
        { re: /relay/i, label: 'Relay' },
        { re: /long jump|high jump|triple jump/i, label: 'Jump' },
        { re: /shot put|javelin|discus|hammer/i, label: 'Throw' },
        { re: /hurdles/i, label: 'Hurdles' },
        { re: /\bmen'?s|\bboys'?/i, label: 'Men/Boys' },
        { re: /women'?s|girls'?/i, label: 'Women/Girls' }
      ]
    }
  };
  var DEFAULT_SPORT_IN = 'cricket';

  // 月名→月番号
  var EN_MONTHS = {
    january:1,february:2,march:3,april:4,may:5,june:6,july:7,
    august:8,september:9,october:10,november:11,december:12,
    jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12
  };
  var EN_MONTH = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';

  function enIso(y, mo, d) {
    return ('000' + y).slice(-4) + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
  }
  function enMonthNum(name) {
    return EN_MONTHS[String(name).toLowerCase().replace(/\.$/, '')] || null;
  }

  // 英語の各種日付表記をISO(YYYY-MM-DD)へ正規化。locale: 'uk'/'us'/'auto'
  function enExtractDates(text, locale) {
    locale = locale || 'uk';   // 収集データは英連邦圏中心 → 既定UK式(DD/MM)
    var out = [], m;
    // "May 4, 2026" / "May 4 2026"
    var re1 = new RegExp('\\b(' + EN_MONTH + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b', 'ig');
    while ((m = re1.exec(text)) !== null) { var mo = enMonthNum(m[1]); if (mo) out.push(enIso(m[3], mo, m[2])); }
    // "4 May 2026" / "4th May, 2026"
    var re2 = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + EN_MONTH + ')\\.?,?\\s+(\\d{4})\\b', 'ig');
    while ((m = re2.exec(text)) !== null) { var mo2 = enMonthNum(m[2]); if (mo2) out.push(enIso(m[3], mo2, m[1])); }
    // "4 May to 30 August 2026"（月またぎ範囲・年は末尾）
    var re3 = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + EN_MONTH + ')\\.?\\s*(?:to|[-\\u2013\\u2014])\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + EN_MONTH + ')\\.?,?\\s+(\\d{4})\\b', 'ig');
    while ((m = re3.exec(text)) !== null) {
      var y = m[5], a = enMonthNum(m[2]), b = enMonthNum(m[4]);
      if (a) out.push(enIso(y, a, m[1]));
      if (b) out.push(enIso(y, b, m[3]));
    }
    // "May 4-5, 2026"（同月内範囲・月が先）
    var re4 = new RegExp('\\b(' + EN_MONTH + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*[-\\u2013\\u2014]\\s*(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b', 'ig');
    while ((m = re4.exec(text)) !== null) {
      var mo4 = enMonthNum(m[1]);
      if (mo4) { out.push(enIso(m[4], mo4, m[2])); out.push(enIso(m[4], mo4, m[3])); }
    }
    // "4-5 July 2026"（同月内範囲・日が先）
    var re4b = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*[-\\u2013\\u2014]\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + EN_MONTH + ')\\.?,?\\s+(\\d{4})\\b', 'ig');
    while ((m = re4b.exec(text)) !== null) {
      var mo4b = enMonthNum(m[3]);
      if (mo4b) { out.push(enIso(m[4], mo4b, m[1])); out.push(enIso(m[4], mo4b, m[2])); }
    }
    // ISO "2026-05-04"
    var re5 = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
    while ((m = re5.exec(text)) !== null) out.push(enIso(m[1], m[2], m[3]));
    // "4/5/2026" / "4.5.2026"（曖昧時は locale で判定）
    var re6 = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g;
    while ((m = re6.exec(text)) !== null) {
      var p = Number(m[1]), q = Number(m[2]), yy = m[3];
      if (p > 12 && q <= 12) out.push(enIso(yy, q, p));
      else if (q > 12 && p <= 12) out.push(enIso(yy, p, q));
      else if (p <= 12 && q <= 12) {
        if (locale === 'us') out.push(enIso(yy, p, q));
        else out.push(enIso(yy, q, p));   // uk / auto は DD/MM
      }
    }
    return Array.from(new Set(out)).sort();
  }

  // 開会時刻 "9:00 AM" / "09:00" / "9 a.m." / "9am" / "9.00am"
  function enExtractTime(text) {
    var m = text.match(/\b(\d{1,2})[:.](\d{2})\s*(a\.?m\.?|p\.?m\.?)?/i);
    if (m) {
      var h = Number(m[1]), mm = m[2], ap = (m[3] || '').toLowerCase().replace(/\./g, '');
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      return ('0' + h).slice(-2) + ':' + mm;
    }
    m = text.match(/\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)/i);
    if (m) {
      var h2 = Number(m[1]), ap2 = m[2].toLowerCase().replace(/\./g, '');
      if (ap2 === 'pm' && h2 < 12) h2 += 12;
      if (ap2 === 'am' && h2 === 12) h2 = 0;
      return ('0' + h2).slice(-2) + ':00';
    }
    return '';
  }

  // 大会名パターン・除外パターン
  var EN_TITLE_SUFFIX = /(Championships?|Tournament|Open|Cup|Classic|Invitational|Games|League|Series|Festival|Meet|Trophy|Challenge)/i;
  var EN_GREETING = /\b(dear|we are pleased|welcome|on behalf|thank you|please find|hereby|invite)\b/i;
  // 大会要項でない文書（議事録・規則集・告知など）を弾く
  var EN_NONEVENT = /\b(meeting|committee|minutes|agenda|handbook|policy|policies|newsletter|disciplinary|booth|memorandum|circular|press release|annual report|financial|rules and regulations|code of conduct|constitution|by-?laws)\b/i;
  // インド版：教育/採用/判例ドメインのノイズを大幅に拡張
  var EN_NONEVENT_IN = /\b(meeting|committee|minutes|agenda|handbook|policy|policies|newsletter|disciplinary|booth|memorandum|circular|press release|annual report|financial|rules and regulations|code of conduct|constitution|by-?laws|prospectus|admission|brochure|enrolment|enrollment|recruitment|judgment|judgement|high court|supreme court|achievements?|performance analysis|fan guide|sports calendar|college calendar|sr\.?\s*sec\.?\s*school|autonomous\)|naac|cgpa|affiliated to|founded in|owned by|employment notice|vacancy|sports quota|direct entry|opening date|bid\/offer|budget|manifesto|webinar|expo|eligible list|probable players|selection trial|scholarship|change of venue|willingness)\b/i;
  var EN_FORM = /\b(entry form|application form|registration form|name of|signature|please print|full name)\b/i;
  // 全競技共通：明らかに別競技の語（profileのsportKeywordsに該当しなければ弾く）
  var EN_OTHER_SPORTS = /\b(hockey|softball|handball|baseball|rugby|lacrosse|squash)\b/i;

  function enCleanTitle(s, profile, region) {
    s = String(s).replace(/^[\uFEFF\u200B]+/, '').trim().replace(/^["\u201C\u201D\u2018\u2019]+|["\u201C\u201D\u2018\u2019]+$/g, '').trim();
    // 先頭の番号・記号
    s = s.replace(/^\s*(?:no\.?\s*\d+|\d+[.)]\s*)/i, '');
    // 末尾の事務語
    s = s.replace(/\s*[-\u2013\u2014:]\s*(entry form|application|guidelines?|regulations?|prospectus|information|details?)\s*$/i, '');
    s = s.replace(/\s*\((?:draft|tentative|revised|final)\)\s*$/i, '');
    var sk = profile.sportKeywords;
    // 他競技語（自競技キーワードに該当しなければ弾く）
    if (s && EN_OTHER_SPORTS.test(s) && !(sk && sk.test(s))) s = '';
    // インド：判例（A v. B 形式）を弾く
    if (region === 'in' && s && /\b[Vv]\.\s+[A-Z]|\bvs\.?\s+[A-Z]/.test(s) && /court|state|union|ltd|private limited/i.test(s)) s = '';
    // あいさつ・非大会文書は除外（インドは拡張リスト）
    if (EN_GREETING.test(s)) s = '';
    if ((region === 'in' ? EN_NONEVENT_IN : EN_NONEVENT).test(s)) s = '';
    if (/\.$/.test(s) && s.split(/\s+/).length > 12) s = '';
    return s.trim();
  }

  // 住所判定（英・豪・米）
  var EN_POSTCODE_UK = /[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}/;
  var EN_ZIP_US = /\b[0-9]{5}(?:-[0-9]{4})?\b/;
  var EN_STREET_KW = /\b(?:Street|St|Road|Rd|Avenue|Ave|Lane|Drive|Way|Close|Court|Crescent|Terrace|Boulevard|Highway)\b/i;

  // 申込締切の文脈（開催日候補からの除外と締切抽出の両方で共通利用）
  var EN_DEADLINE_RE = /\b(entry deadline|deadline for entries|last date(?:\s+for\s+(?:entry|entries|registration|submission))?|registration closes?|registrations? close|closing date|closing:|deadline|entries close|entries must be received|receipt of entries|register by|registration by|applications? close|apply by|rsvp by|due (?:date|by)|cut[- ]?off)\b/i;

  // 会場名の前に連結された「日付ラベル＋日付」「開始/開会時刻」を行頭から繰り返し除去
  var EN_DATE_PREFIX_RE = /^\s*(date|dates|when|schedule|held on|scheduled (?:on|for)|event date|tournament date|match date)\s*[:\-]?\s*/i;
  var EN_START_PREFIX_RE = /^\s*(start|starts|starting|commences?|commencing|begins?|kick\s*-?\s*off|tip\s*-?\s*off|opening|warm\s*-?\s*up)\s*[:\-]?\s*/i;
  var EN_LEADING_DATE_TOK = /^\s*(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s*)?(?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+(?:\s+\d{4})?|[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})\s*/i;
  var EN_LEADING_TIME_TOK = /^\s*\d{1,2}([:.]\d{2})?\s*(a\.?m\.?|p\.?m\.?)\s*/i;

  function enStripLeadingDateTime(s) {
    var prev = null;
    while (s && s !== prev) {
      prev = s;
      s = s.replace(EN_DATE_PREFIX_RE, '');
      s = s.replace(EN_START_PREFIX_RE, '');
      s = s.replace(EN_LEADING_DATE_TOK, '');
      s = s.replace(EN_LEADING_TIME_TOK, '');
    }
    return s.trim();
  }

  // 会場文字列内で住所が始まる位置を返す（無ければnull）
  function enStreetCut(s) {
    var sm = /,\s*[0-9]+[A-Za-z]?\s/.exec(s);
    if (sm && EN_STREET_KW.test(s.slice(sm.index))) return sm.index + 1;
    // カンマ無しで「施設名 番地 通り名」が連結（例: "... Centre 12 Park Road"）
    var sm2 = /\s[0-9]+[A-Za-z]?\s+[A-Z][A-Za-z]*/.exec(s);
    if (sm2 && EN_STREET_KW.test(s.slice(sm2.index))) return sm2.index;
    return null;
  }

  // 会場文字列から住所部分を分離。戻り { venue, address }
  function enSplitVenueAddress(s) {
    if (!s) return { venue: s, address: '' };
    var pc = EN_POSTCODE_UK.exec(s) || EN_ZIP_US.exec(s);
    var cut = null;
    if (pc) {
      var comma = s.lastIndexOf(',', pc.index);
      cut = comma >= 0 ? comma + 1 : pc.index;
    } else {
      cut = enStreetCut(s);
    }
    if (cut !== null) {
      var venue = s.slice(0, cut).replace(/[\s,.]+$/, '');
      var addr = s.slice(cut).replace(/^[\s,.]+|[\s,.]+$/g, '');
      // ポストコードで切っても会場側に番地が残る場合、さらに番地で切る
      var v2 = enStreetCut(venue);
      if (v2 !== null) {
        addr = (venue.slice(v2).replace(/^[\s,.]+|[\s,.]+$/g, '') + ' ' + addr).trim();
        venue = venue.slice(0, v2).replace(/[\s,.]+$/, '');
      }
      if (venue) return { venue: venue, address: addr };
    }
    return { venue: s.replace(/^[\s,.]+|[\s,.]+$/g, ''), address: '' };
  }

  function enCleanVenue(s, region) {
    s = String(s).trim().replace(/^["\u201C\u201D]+|["\u201C\u201D]+$/g, '').trim();
    // 不具合1対策: 会場名の前に連結された日付・開始時刻を除去
    s = enStripLeadingDateTime(s);
    // ラベル除去後にもう一度（"Date: ... Venue: ..." の順序ゆれに対応）
    s = s.replace(/^\s*(venue|location|place|site|held at|ground|grounds|course|pool|address)\s*[:\-]\s*/i, '');
    s = s.replace(/\s*\d{1,2}:\d{2}\s*(a\.?m\.?|p\.?m\.?)?\s*$/i, '');
    if (region === 'in') {
      // インド：電話("Tel +91 ..." 等)・参加費(₹/Rs./INR)を除去
      s = s.replace(/\s*(tel|phone|fax|mob(?:ile)?|contact)[:.]?\s*\+?[\d\s\-()]{6,}$/i, '');
      s = s.replace(/\s*(tel|phone|fax|mob(?:ile)?|contact)[:.]?\s*$/i, '');
      s = s.replace(/\s*(?:₹|Rs\.?|INR)\s*[\d,]+\/?-?/ig, '');
      s = s.replace(/\s*\+?91[\d\s\-]{8,}/g, '');
    } else {
      s = s.replace(/\s*(tel|phone|fax)[:.]?\s*[\d\-()\s]+$/i, '');
    }
    return s.replace(/^[\s.,:\-]+|[\s.,:\-]+$/g, '');
  }

  var EN_VENUE_RE = /\b(Arena|Stadium|Gymnasium|Gym|Centre|Center|Hall|Complex|Court|Field|Park|Dome|Pavilion|University|College|School|Club|Course|Ground|Grounds|Racket|Racquet|Aquatics|Pool|Links|Oval|Recreation|Academy)\b/i;
  var EN_VENUE_NG = /\b(federation|association|committee|organi[sz]er|sponsor|contact|email|website)\b/i;

  // 英語/インド版：競技プロファイルと自動判定を解決
  function enResolveProfile(text, sport, region) {
    var profiles = (region === 'in') ? SPORT_PROFILES_IN : SPORT_PROFILES_EN;
    var fallback = (region === 'in') ? DEFAULT_SPORT_IN : DEFAULT_SPORT_EN;
    if (sport === 'auto' || !sport) {
      var best = null, bestCount = 0;
      Object.keys(profiles).forEach(function (key) {
        var mm = text.match(new RegExp(profiles[key].sportKeywords.source, 'gi'));
        var c = mm ? mm.length : 0;
        if (c > bestCount) { bestCount = c; best = key; }
      });
      if (best) return profiles[best];
      return profiles[fallback];
    }
    return profiles[sport] || profiles[fallback];
  }

  // 英語/インド要項の解析本体（dropper_parser_en.py / _in.py の parse_text 相当）
  // region: 'en'（英語圏）/ 'in'（インド）
  function parseEn(rawText, sport, region) {
    region = region || 'en';
    var text = String(rawText).replace(/\uFEFF/g, '').replace(/\u200B/g, '').replace(/\r/g, '\n');
    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var profile = enResolveProfile(text, sport || 'auto', region);
    var locale = (region === 'in') ? 'uk' : (profile.locale || 'uk');
    var nonevent = (region === 'in') ? EN_NONEVENT_IN : EN_NONEVENT;

    var r = { taikai_mei: '', kaisai_dates: [], kaikai_jikan: '', kaijo: '', kaijo_jusho: '', shimekiri: '', shiai_keishiki: '', note: '' };

    // --- 大会名：種別語を含む行から、あいさつ・フォーム・非大会文書行を除外 ---
    var titleCands = lines.filter(function (l) {
      return EN_TITLE_SUFFIX.test(l) && !EN_GREETING.test(l) && !EN_FORM.test(l) && !nonevent.test(l) && l.length <= 90;
    });
    if (titleCands.length) {
      var titled = null;
      for (var i = 0; i < titleCands.length; i++) {
        if (/\b(19|20)\d{2}\b|\b\d+(?:st|nd|rd|th)\b/.test(titleCands[i])) { titled = titleCands[i]; break; }
      }
      var picked = titled || titleCands.slice().sort(function (a, b) { return a.length - b.length; })[0];
      r.taikai_mei = enCleanTitle(picked, profile, region);
    }

    // --- 開催日（3段階フォールバック・締切行は全段階で除外）---
    var dates = [];
    // 段階1: 開催日を明示するラベル行を優先（締切行は除外）
    var dateLabelRe = /\b(date of (?:event|tournament|competition|championship|meet)|dates?|when|schedule|held on|scheduled (?:on|for)|to be held|event date|tournament date|match date|fixture)\b\s*[:\-]?/i;
    for (var j = 0; j < lines.length; j++) {
      if (EN_DEADLINE_RE.test(lines[j])) continue;   // 不具合2: 締切行はラベル段階で除外
      if (dateLabelRe.test(lines[j])) {
        var d1 = enExtractDates(lines[j], locale);
        if (d1.length) { dates = d1; break; }
      }
    }
    // 段階2: ラベルが無ければ、表組みのセル内日付を拾う（締切行は除外）
    if (!dates.length) {
      var schedKw = /\b(round|day|match|fixture|game|heat|final|semi|quarter|leg|session|will (?:take place|be held)|held on|scheduled)\b/i;
      var cell = [];
      for (var c = 0; c < lines.length; c++) {
        var l = lines[c];
        if (EN_DEADLINE_RE.test(l)) continue;   // 不具合2: 締切行は開催日候補から除外
        // 年度範囲(2025-26)・電話を含む行は除外
        if (/\b(19|20)\d{2}\s*[-/]\s*\d{2}\b/.test(l) || /\+?\d{2,4}[\s-]\d{4,}/.test(l)) continue;
        // 短い行（80字以内）、またはスケジュール語を含む長い行なら日付を拾う
        if (l.length <= 80 || schedKw.test(l)) {
          var dc = enExtractDates(l, locale);
          if (dc.length) cell = cell.concat(dc);
        }
      }
      cell = Array.from(new Set(cell)).sort();
      if (cell.length) dates = cell;
    }
    // 段階3: それでも無ければ全文から（締切行は除外）
    if (!dates.length) {
      var nonDeadline = lines.filter(function (l) { return !EN_DEADLINE_RE.test(l); }).join('\n');
      dates = enExtractDates(nonDeadline, locale);
    }
    // 段階4（最終手段）: 年なし日付の補完（文書内に年が1つだけのとき "3 March"/"August 1st" 等を補う）
    if (!dates.length) {
      var yrs = Array.from(new Set(text.match(/\b20\d{2}\b/g) || []));
      if (yrs.length === 1) {
        var yy = yrs[0], cand = [];
        for (var q = 0; q < lines.length; q++) {
          var ln = lines[q];
          if (EN_DEADLINE_RE.test(ln)) continue;
          var mm, reMD = new RegExp('\\b(' + EN_MONTH + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b', 'ig');
          while ((mm = reMD.exec(ln)) !== null) { var moA = enMonthNum(mm[1]); if (moA) cand.push(enIso(yy, moA, mm[2])); }
          var reDM = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + EN_MONTH + ')\\.?\\b', 'ig');
          while ((mm = reDM.exec(ln)) !== null) { var moB = enMonthNum(mm[2]); if (moB) cand.push(enIso(yy, moB, mm[1])); }
        }
        cand = Array.from(new Set(cand)).sort();
        if (cand.length && cand.length <= 6) dates = cand;
      }
    }
    // 段階5（最終救出）: 大会名/会場の上位行に紛れた日付を拾う（"@7.35pm Sun June 15th 2026 Final" 等）
    if (!dates.length) {
      var cand5 = [];
      for (var p = 0; p < Math.min(6, lines.length); p++) {
        var l5 = lines[p];
        if (EN_DEADLINE_RE.test(l5)) continue;
        if (/\b(19|20)\d{2}\s*[-/]\s*\d{2}\b/.test(l5) || /\+?\d{2,4}[\s-]\d{4,}/.test(l5)) continue;
        var d5 = enExtractDates(l5, locale);
        if (d5.length) cand5 = cand5.concat(d5);
      }
      cand5 = Array.from(new Set(cand5)).sort();
      if (cand5.length && cand5.length <= 6) dates = cand5;
    }
    r.kaisai_dates = dates;

    // --- 開会時刻 ---
    var tline = null;
    for (var k = 0; k < lines.length; k++) {
      if (/\b(start|starts?|commenc\w+|begins?|kick\s*-?\s*off|tip\s*-?\s*off|first\s+match|first\s+race|warm\s*-?\s*up|opening|play\s+starts?)\b/i.test(lines[k])) { tline = lines[k]; break; }
    }
    r.kaikai_jikan = tline ? enExtractTime(tline) : '';

    // --- 会場 ---
    for (var v = 0; v < lines.length; v++) {
      if (EN_VENUE_RE.test(lines[v]) && !EN_VENUE_NG.test(lines[v])) {
        var lab = /\b(venue|location|held at|ground|grounds|course|pool|address)\b\s*[:\-]\s*(.+)$/i.exec(lines[v]);
        var cleaned = enCleanVenue(lab ? lab[2] : lines[v], region);
        var split = enSplitVenueAddress(cleaned);
        r.kaijo = split.venue;
        r.kaijo_jusho = split.address;
        break;
      }
    }

    // --- 申込締切（en/in共通のDEADLINE_RE）---
    for (var d = 0; d < lines.length; d++) {
      if (EN_DEADLINE_RE.test(lines[d])) {
        var dl = enExtractDates(lines[d], locale);
        if (!dl.length && d + 1 < lines.length) dl = enExtractDates(lines[d + 1], locale);
        if (dl.length) { r.shimekiri = dl[0]; break; }
      }
    }

    // --- 試合形式（profile.formats を順に適用）---
    var fmts = [];
    (profile.formats || []).forEach(function (rule) {
      if (!rule.re.test(text)) return;
      if (rule.skipIfAny && fmts.some(function (f) { return rule.skipIfAny.test(f); })) return;
      if (rule.skipIfNone && !fmts.some(function (f) { return rule.skipIfNone.test(f); })) return;
      fmts.push(rule.label);
    });
    r.shiai_keishiki = fmts.join(', ');

    buildSchedule(r);
    return r;
  }


  function toHalfWidthDigits(s) {
    return String(s).replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  }
  function iso(y, mo, d) { return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2); }

  // 日ごとに種目を持てる器を作る（案イ：events は空。日ごとの割り当ては後段=正規表現の試作/AIに任せる）
  // r.kaisai_dates と既存の r.shiai_keishiki はそのまま維持し、schedule と day_split を「追加」するだけ。
  function buildSchedule(r) {
    var dates = (r.kaisai_dates || []);
    r.schedule = dates.map(function (d) { return { date: d, events: '' }; });
    r.day_split = false;  // 日ごとに種目を割り当てられたか（現段階は常に false）
    return r;
  }

  function collapseCjkSpaces(s) {
    var C = '\\u3040-\\u30ff\\u3400-\\u9fff\\uff66-\\uff9f々〆〇';
    var H = '[ \\t\\u3000]+';
    var re1 = new RegExp('([' + C + '])' + H + '(?=[' + C + '])', 'g');
    var re2 = new RegExp('([' + C + '])' + H + '(?=[0-9])', 'g');
    var re3 = new RegExp('([0-9])' + H + '(?=[' + C + '])', 'g');
    return String(s).replace(re1, '$1').replace(re1, '$1').replace(re2, '$1').replace(re3, '$1');
  }

  function extractDates(line) {
    var out = [], baseYear = null, m;
    var reW = /令\s*和\s*(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/g;
    while ((m = reW.exec(line)) !== null) { baseYear = 2018 + Number(m[1]); out.push(iso(baseYear, m[2], m[3])); }
    var reG = /(\d{4})\s*年\s*(\d+)\s*月\s*(\d+)\s*日/g;
    while ((m = reG.exec(line)) !== null) { baseYear = Number(m[1]); out.push(iso(baseYear, m[2], m[3])); }
    if (baseYear) {
      var reMD = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
      while ((m = reMD.exec(line)) !== null) {
        var v = iso(baseYear, m[1], m[2]);
        if (out.indexOf(v) === -1) out.push(v);
      }
    }
    return Array.from(new Set(out)).sort();
  }

  function extractDeadline(lines, labelRe, fallbackYear) {
    for (var i = 0; i < lines.length; i++) {
      if (!labelRe.test(lines[i])) continue;
      // ラベル行の直前〜+2行を探索（「令和8年7月12日（日）」の次行に「締切」だけ来る要項に対応）
      for (var j = Math.max(0, i - 1); j <= i + 2 && j < lines.length; j++) {
        var d = extractDates(lines[j]);
        if (!d.length && fallbackYear) {
          var md = [], m, reMD = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
          while ((m = reMD.exec(lines[j])) !== null) md.push(iso(fallbackYear, m[1], m[2]));
          d = Array.from(new Set(md)).sort();
        }
        if (d.length) return d.length >= 2 ? (d[0] + '～' + d[d.length - 1]) : d[0];
      }
    }
    return '';
  }

  function pickValue(lines, labelRe, excludeRe) {
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!labelRe.test(ln) || (excludeRe && excludeRe.test(ln))) continue;
      var v = ln.replace(/^\s*\d+\s*/, '')
        .replace(new RegExp('^.*?' + labelRe.source + '\\s*[:：]?\\s*'), '')
        .trim();
      if (v) return v;
      return (i + 1 < lines.length) ? lines[i + 1].trim() : '';
    }
    return '';
  }

  // 大会名クリーニング
  function cleanTaikaiMei(name, activeProfile, genericMode) {
    // BOM除去
    name = name.replace(/^[\uFEFF\u00EF\u00BB\u00BF]+/, '');
    // 】までの前置きを除去（「大会情報】」「参加者募集】」等）
    name = name.replace(/^[^】]*】\s*/, '');
    // 先頭の記号・番号を除去（「・」「1.」「①」等）
    name = name.replace(/^[\s　]*[・●▶►◆■▪\-－―]+[\s　]*/, '');
    name = name.replace(/^[\s　]*\d+[\.．]\s*/, '');
    // 末尾の不要語を除去
    name = name.replace(/[\s　。．、,]*[（(][^）)]*[）)]\s*(実\s*施|要\s*項|開\s*催)[\s。．]*$/, '');
    name = name.replace(/[\s　。．、,]*(実\s*施要\s*項|実\s*施|要\s*項|に\s*つ\s*い\s*て|の?\s*ご?\s*案\s*内|開\s*催\s*要\s*項|開\s*催)[\s。．]*$/, '');
    // 末尾の事務的な語を除去（概要・規約・募集・受付係 等）
    name = name.replace(/[\s　。．、,]*(開\s*催\s*概\s*要|概\s*要|試\s*合\s*規\s*約|大\s*会\s*規\s*定|参\s*加\s*選\s*手\s*募\s*集|選\s*手\s*募\s*集|募\s*集\s*要\s*綱|募\s*集|広\s*告\s*受\s*付\s*係?|受\s*付\s*係)[\s。．]*$/, '');
    // 先頭の「大会名」「名称」ラベルを除去
    name = name.replace(/^(?:大\s*会\s*名|名\s*称)\s*[:：]?\s*/, '');
    // 日付・時刻の混入を除去
    name = name.replace(/[\s　]*\d{4}年\d+月\d+日[^）]*$/, '');
    name = name.replace(/[\s　]*[（(]\d{4}年[^）)]*[）)].*$/, '');
    name = name.replace(/[\s　]*(午前|午後)\d+時.*$/, '');
    // 先頭の「兼〜」を除去
    name = name.replace(/^兼\s*/, '');
    // 本文混入（参加資格・〜による等）は空にする
    if (/(参\s*加\s*資\s*格|ほ\s*か\s*次\s*に\s*よ\s*る|\d+\s*項\s*に\s*よ\s*る|総\s*則\s*\d)/.test(name)) name = '';
    // 余分な末尾語を除去（「等を」「掲載」「会場図」等）
    name = name.replace(/[\s　]*(等\s*を|掲\s*載.*$|会\s*場\s*図.*$)/, '');
    // 「要項掲載（日付）」を除去
    name = name.replace(/[\s　]*要\s*項\s*掲\s*載[^）]*[）)]?.*$/, '');
    // 記事的な文末を除去（「が6月」等）
    name = name.replace(/[\s　]*(が|は|を|に|で|も)\d*[月日].*$/, '');
    // 選択中の競技以外の競技名を含む場合は空にする（汎用モードはスキップ）
    if (!genericMode && ALL_SPORTS.test(name) &&
        !(activeProfile.sportKeywords && activeProfile.sportKeywords.test(name))) name = '';
    // サイト名・更新情報を除去
    name = name.replace(/[\s　]*[-–—―|｜][\s　]*.{2,20}$/, '');
    name = name.replace(/[\s　]*[（(][^）)]*更新[^）)]*[）)].*$/, '');
    // 括弧内の「令和N年度」を除去
    name = name.replace(/[（(]\s*令和[^）)]*[）)]?.*$/, '');
    // 先頭の日付プレフィックスを除去
    name = name.replace(/^\d+\/\d+\s*[（(][月火水木金土日][）)]\s*/, '');
    name = name.replace(/^\d+月\d+日[（(][月火水木金土日][）)]?\s*/, '');
    // 先頭の番号・記号を除去
    name = name.replace(/^(?:[①-⑳Ⅰ-Ⅻ]+|[（(]\d+[）)](?:\s*名\s*称)?)\s*/, '');
    // 余分な末尾語を除去（「ランキング」「無条件出場」等）
    name = name.replace(/[\s　]*(ラ\s*ン\s*キ\s*ン\s*グ|無\s*条\s*件\s*出\s*場.*)$/, '');
    // 他競技は空にする（汎用モードはスキップ）
    if (!genericMode && ALL_SPORTS.test(name) &&
        !(activeProfile.sportKeywords && activeProfile.sportKeywords.test(name))) name = '';
    // 議事録・通知文は空にする
    if (/(理\s*事\s*会|報\s*告\s*事\s*項|宗\s*片|事\s*務\s*局|日\s*程\s*と\s*会\s*場\s*一\s*覧|宿\s*泊\s*要\s*項|優\s*先\s*出\s*場\s*対\s*象)/.test(name)) name = '';
    // 先頭の「(兼〜)」を除去
    name = name.replace(/^[（(]兼[^）)]*[）)]\s*/, '');
    // 末尾の「要項（年度）」を除去
    name = name.replace(/[\s　]*[（(]?(要\s*項)[\s　]*[（(][^）)]*[）)].*$/, '');
    name = name.replace(/[\s　]*(実\s*施)?\s*要\s*項\s*[（(][^）)]*[）)].*$/, '');
    // 目次混入（「・・・数字」）を除去
    name = name.replace(/[\s　]*[・．]{3,}.*$/, '');
    name = name.replace(/[\s　]*\d+$/, '');
    // 先頭の会長名・役職名を除去
    name = name.replace(/^(会\s*長|理\s*事\s*長|会\s*頭)[\s　]?[^第]{1,8}(?=第)/, '');
    // 番号プレフィックスを除去
    name = name.replace(/^\d{1,2}\s*本\s*大\s*会\s*[①-⑳]?\s*/, '');
    name = name.replace(/^[⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳][（(][^）)]*[）)]\s*/, '');
    // 末尾の「実施要項主催〜」を除去
    name = name.replace(/[\s　]*(実\s*施)?\s*要\s*項\s*主\s*催.*$/, '');
    // 末尾の「からの推薦〜」を除去
    name = name.replace(/[\s　]*から\s*の\s*推\s*薦.*$/, '');
    // 半角カナを全角に変換
    name = name.replace(/[ｦ-ﾟ]+/g, function(s) {
      var r = '';
      for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        r += (c >= 0xFF61 && c <= 0xFF9F) ? String.fromCharCode(c - 0xFF61 + 0x30A1) : s[i];
      }
      return r;
    });
    // 先頭の主催者情報を除去
    name = name.replace(/^.{2,20}(主\s*催|指\s*定\s*管\s*理\s*者)[^第]*(?=第)/, '');
    // 末尾の主催者・協会情報を除去
    name = name.replace(/[\s　]*[\/／]\s*(ｵｰﾌﾟﾝ|オープン).*(主\s*催|協\s*議\s*会|連\s*盟).*$/, '');
    name = name.replace(/[\s　]*(主\s*催|協\s*議\s*会|連\s*盟)\s*.{2,20}$/, '');
    // 「要項(案)」「1主催」等は上記パターンで対応済み
    // 末尾の「について」「御案内」を除去
    name = name.replace(/[\s　]*(に\s*つ\s*い\s*て)?[（(]?御?\s*案\s*内[）)]?[\s。．]*$/, '');
    // 不適切な大会名パターンを空にする
    // 複数の大会名が「兼」で連結されている場合は最初の大会名のみ取得
    var kanMatch = name.match(/^(.{5,35}?(?:大会|選手権|フェスティバル))(?:兼|／|\/).*/);
    if (kanMatch) name = kanMatch[1].trim();
    // 会場・日程情報が混入している場合を除去
    name = name.replace(/[\s　]*[（(]\s*(一般|ジュニア|カデット|ホープス|小学生|中学生|高校生|硬式|軟式)[^）)]*[）)].*$/, function(m, p1) {
      // 種別情報は保持（短い場合）
      return m.length < 15 ? m : '';
    });
    // 50文字超は空にする
    if (name.replace(/\s/g, '').length > 50) name = '';
    // 前後の記号・空白を除去
    name = name.replace(/^[【「\s　\uFEFF『]+/, '').replace(/[】」\s　』]+$/, '');
    return name.trim();
  }

  // 会場名クリーニング
  function cleanVenue(s) {
    if (!s) return '';
    // 先頭の括弧・記号を除去
    s = s.replace(/^[【『「\[◆●▶►■♦\(（]+\s*/, '').replace(/[】』」\]\)）]+$/, '');
    // 「地域名：」プレフィックスを除去
    s = s.replace(/^[^\s　：:]{2,5}[：:]\s*/, '');
    // 付記を除去（現・旧・控室・サブ等）
    s = s.replace(/[（(](現|旧|控\s*室|サ\s*ブ|予\s*定)[^）)]*[）)]/g, '').trim();
    // 未閉じ括弧を除去
    s = s.replace(/[（(][^）)]*$/, '').trim();
    // 先頭の「…」「・〜：」を除去
    s = s.replace(/^[…・]+\s*[^：:]*[：:]?\s*/, '');
    // 括弧内の住所を除去
    s = s.replace(/[（(][^）)]*[市区町村]\d[^）)]*[）)]/g, '').trim();
    s = s.replace(/^[（(]\d+[）)]\s*(総\s*合\s*開\s*会\s*式|競\s*技)?\s*/, '');
    // 「日程・競技会場〜」プレフィックスを除去
    s = s.replace(/^[・\s　]*[日程競技会場]+[\s　（(\d)）)]*[：:･・\s　]*/, '');
    // 先頭の番号を除去
    s = s.replace(/^[\s　]*(?:[\d１-９][\.．）)]|[①-⑳])\s*/, '');
    // 日付が先頭に混入している場合除去
    s = s.replace(/^\d+月\d+日[（(][月火水木金土日][）)]?\s*[、,：:･・\s　]*/, '');
    s = s.replace(/^[^：:]*[：:]\s*/, '');
    // 括弧内の電話番号を除去
    s = s.replace(/[（(][\d\-－\s]{6,}[）)]/g, '');
    // TEL・電話・郵便番号以降を除去
    s = s.replace(/[\s　]*(ＴＥＬ|TEL|℡|Tel|電話|FAX|☎|〒).*$/i, '');
    s = s.replace(/[\s　]*[（(][^）)]*tel[^）)]*[）)].*$/i, '');
    s = s.replace(/[\s　]*\d{2,4}[-－]\d{3,4}[-－]\d{4}.*$/, '');
    // 試合説明・注意事項
    s = s.replace(/[\s　]*[①-⑳\d１-９]+[．.。]\s*(試合|競技|男|女|種目|一部|二部).*$/, '');
    s = s.replace(/[\s　]*[※★☆]\s*.*$/, '');
    // 日付混入
    s = s.replace(/[\s　]*(令和|[12][09]\d\d年|\d+月\d+日).*$/, '');
    // 「午前」「開始」等
    s = s.replace(/[\s　]*(午前|午後|開始|開館|開場).*$/, '');
    // サイト名の混入を除去
    s = s.replace(/[\s　]*[-–—―]\s*.{2,15}$/, '');
    s = s.trim();
    // 括弧内の住所を除去
    s = s.replace(/[（(][^）)]*[市町村]\d[^）)]*[）)]/g, '').trim();
    // 施設名に直結した住所を除去
    s = s.replace(/((?:体育館|アリーナ|ホール|センター|競技場|ドーム))[^、。\n]*[市町村]\S+$/, '$1').trim();
    // 先頭・末尾の括弧を除去
    s = s.replace(/^[「『【◆]/, '').replace(/[」』】]$/, '');
    // 他競技施設は空にする
    if (/(陸\s*上\s*競\s*技\s*場|競\s*泳|カ\s*ヌ\s*ー|ボ\s*ク\s*シ\s*ン\s*グ|レ\s*ス\s*リ\s*ン\s*グ)/.test(s) && !/(体\s*育|アリーナ|ホール|センター)/.test(s)) s = '';
    // 大会名が混入した場合は空にする
    if (/(大\s*会|選\s*手\s*権|選\s*抜)/.test(s) && !/(体\s*育|アリーナ|ホール|センター|競\s*技\s*場)/.test(s)) s = '';
    // 25文字超なら施設名で切る（括弧内の別名は保持）
    if (s.length > 25) {
      var suffixRe = /(体育館|アリーナ|ARENA|武道館|会館|センター|ホール|競技場|ドーム|プラザ|記念館|野球場|球場|運動場)/i;
      var m = s.match(suffixRe);
      if (m) {
        var end = m.index + m[0].length;
        var rest = s.slice(end);
        var closeP = rest.match(/^[^）)]*[）)]/);
        if (closeP) end += closeP[0].length;
        s = s.slice(0, end).trim();
      }
    }
    if (s.length > 30 && /[はがをにでも]/.test(s)) s = '';
    // 不適切な会場名パターンを空にする
    // 「略称SC」「予定」のみの場合
    if (/^(略称|予定|未定|調整中)$/.test(s.trim())) s = '';
    // 住所のみ（施設名なし）の場合
    if (/^[〒]/.test(s) || /^\d{3}-\d{4}/.test(s)) s = '';
    return s;
  }

  // 住所文字列からラベル(N 会場/場所/住所)・電話を除去して整える
  function cleanAddress_(s) {
    s = String(s).trim();
    // 先頭のラベル（…会場/場所/住所/所在地）までを除去
    s = s.replace(/^.*?(会\s*場|場\s*所|住\s*所|所\s*在\s*地)\s*[:：]?\s*/, '');
    // 電話・FAX・☎ 以降を除去
    s = s.replace(/[\s　]*(ＴＥＬ|TEL|℡|Tel|電話|FAX|☎).*$/i, '');
    // 末尾の括弧電話番号を除去
    s = s.replace(/[（(][\d\-－\s]{6,}[）)]\s*$/, '');
    return s.trim();
  }

  function splitVenue(s) {
    s = String(s).replace(/^\s*\d+\s*/, '').replace(/^.*?(会\s*場|場\s*所)\s*[:：]?\s*/, '').trim();
    // OCRが日付・開会式・住所などの値を1行に連結するケース：先頭の日付/開会式/開始時刻を除去
    s = s.replace(/^\s*(?:令\s*和\s*\d+\s*年|平\s*成\s*\d+\s*年|\d{4}\s*年)?\s*\d+\s*月\s*\d+\s*日\s*[（(]?[月火水木金土日]?[）)]?\s*/, '');
    s = s.replace(/^(?:(?:開\s*会\s*式|開\s*始|受\s*付)[：:]?\s*午\s*[前後]\s*\d+\s*時(?:\s*\d+\s*分)?\s*)+/, '');
    var suffixRe = /(体育館|アリーナ|ARENA|武道館|会館|センター|ホール|競技場|ドーム|広場|公園|プラザ|グラウンド|運動場|記念館|野球場|球場)/gi;
    var last = null, m;
    while ((m = suffixRe.exec(s)) !== null) last = m;
    if (last) {
      var end = last.index + last[0].length;
      var venue = s.slice(0, end).trim();
      var address = s.slice(end).replace(/^[\s　、,，：:･・]+/, '').trim();
      var alias = address.match(/^[（(][^）)]*(館|アリーナ|ARENA|体育|総合|センター|ホール|広場|公園)[^）)]*[）)]/);
      if (alias) { venue += ' ' + alias[0]; address = address.slice(alias[0].length).replace(/^[\s　、,，：:･・]+/, '').trim(); }
      address = address.replace(/\s*(ＴＥＬ|TEL|℡|Tel|電話|FAX|☎).*$/i, '').trim();
      if (!/(〒|市|町|村|区|\d)/.test(address)) address = '';
      return { venue: venue, address: address };
    }
    var addrRe = /(〒|ＴＥＬ|TEL|℡|Tel|電話|FAX|☎|\d+\s*番地|\d+\s*丁目)/;
    var am = s.match(addrRe);
    if (!am) return { venue: s, address: '' };
    var venue2 = s.slice(0, am.index).trim();
    var address2 = s.slice(am.index).replace(/\s*(ＴＥＬ|TEL|℡|Tel|電話|FAX|☎).*$/i, '').trim();
    return { venue: venue2, address: address2 };
  }

  // 競技プロファイルと自動判定を解決する
  //   sport: 'auto'（自動判定）/ 競技キー / 未指定（=DEFAULT_SPORT）
  // 戻り: { profile, generic } generic=true なら競技で大会名を弾かない（汎用フォールバック）
  function resolveProfile(text, sport) {
    if (sport === 'auto') {
      // 本文から競技を推定：sportKeywordsのヒット数が最多の競技を選ぶ
      var best = null, bestCount = 0;
      Object.keys(SPORT_PROFILES).forEach(function (key) {
        var m = text.match(new RegExp(SPORT_PROFILES[key].sportKeywords.source, 'g'));
        var c = m ? m.length : 0;
        if (c > bestCount) { bestCount = c; best = key; }
      });
      if (best) return { profile: SPORT_PROFILES[best], generic: false };
      // どの競技も検出できない（複合大会など）→ 汎用フォールバック（弾かない）
      return { profile: SPORT_PROFILES[DEFAULT_SPORT], generic: true };
    }
    var p = SPORT_PROFILES[sport] || SPORT_PROFILES[DEFAULT_SPORT];
    return { profile: p, generic: false };
  }

  // 現在の言語が英語系（en / in）なら英語ロジックを使う
  function isEnglishLang() {
    var lang = global.LANG || 'ja';
    return lang === 'en' || lang === 'in';
  }

  function parse(rawText, sport) {
    var lang = global.LANG || 'ja';
    // 英語系の言語では英語/インドparserへ委譲
    if (lang === 'in') return parseEn(rawText, sport, 'in');
    if (lang === 'en') return parseEn(rawText, sport, 'en');

    var text = collapseCjkSpaces(toHalfWidthDigits(rawText));
    var lines = text.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);

    var resolved = resolveProfile(text, sport || DEFAULT_SPORT);
    var activeProfile = resolved.profile;
    var genericMode = resolved.generic;

    var r = { taikai_mei: '', kaisai_dates: [], kaikai_jikan: '', kaijo: '', kaijo_jusho: '', shimekiri: '', shiai_keishiki: '', note: '' };

    // 大会名
    var greetingRe = /(さて|平素|拝啓|この度|このたび|各位|を開催|することと|お待ち|申し上げ|ご参加|いたします|となりました|ください)/;
    var formRe = /(申\s*込\s*書|代\s*表\s*者|フリガナ|登\s*録\s*番\s*号|選\s*考\s*基\s*準|解\s*説|掲\s*載\s*し)/;
    var nameCands = lines.filter(function (ln) {
      return /第\s*\d+\s*回/.test(ln)
        && /(大会|選手権|フェスティバル)/.test(ln)
        && !greetingRe.test(ln)
        && !formRe.test(ln)
        && ln.replace(/\s/g, '').length <= 70;
    });
    if (nameCands.length) {
      var titled = nameCands.find(function (ln) { return /要\s*項/.test(ln); });
      var picked = titled || nameCands.slice().sort(function (a, b) { return a.length - b.length; })[0];
      r.taikai_mei = cleanTaikaiMei(picked, activeProfile, genericMode);
    }
    if (!r.taikai_mei) {
      var titleKw = /(大会|選手権|オープン|カップ|杯|トーナメント|交流会|親善|フェスティバル)/;
      var docSuffix = /(の?ご?案内|要\s*項|について|開催)/;
      var cand = lines.find(function (ln) {
        return titleKw.test(ln) && docSuffix.test(ln) && !greetingRe.test(ln) && !formRe.test(ln)
          && !/(本\s*大\s*会|全\s*国\s*大\s*会|予\s*選\s*通\s*過|参加資格|日\s*程|解\s*説|掲\s*載)/.test(ln)
          && ln.replace(/\s/g, '').length <= 45;
      });
      if (cand) r.taikai_mei = cleanTaikaiMei(cand, activeProfile, genericMode);
    }

    // 開催日
    var scanText = text;
    var honPos = scanText.search(/本\s*大\s*会\s*日\s*程/);
    if (honPos !== -1) scanText = scanText.slice(0, honPos);

    var dates = [];
    var dateLns = scanText.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    // 申込・締切などの文脈行は開催日として拾わない（開催日は要項前半の日時欄に書かれるのが通例）
    var applyCtx = /(申込|締切|必着|受付|応募|エントリー)/;
    // 締切日が「日付だけの単独行」で、キーワードが直前/直後の別行にある要項があるため近傍行も見る
    function nearDeadline(i) {
      if (applyCtx.test(dateLns[i] || '')) return true;
      if (i > 0 && applyCtx.test(dateLns[i - 1] || '')) return true;
      if (i + 1 < dateLns.length && applyCtx.test(dateLns[i + 1] || '')) return true;
      return false;
    }

    // ラベル付き日付を最優先（日時・期日・開催日・大会日の直後の日付）
    var labelDateRe = /(?:日\s*時|期\s*日|開\s*催\s*日|大\s*会\s*日)[^0-9令平]{0,8}((?:令\s*和\s*\d+|平\s*成\s*\d+|\d{4})\s*年\s*\d+\s*月\s*\d+\s*日)/;
    var mdMatch = scanText.match(labelDateRe);
    if (mdMatch) dates = extractDates(mdMatch[1]);

    // 曜日付き日付パターン（令和）— 申込・締切系の行（近傍含む）は除外
    if (!dates.length) {
      dateLns.forEach(function (ln, i) {
        if (nearDeadline(i)) return;
        var dm, reWD = /(令\s*和\s*\d+\s*年\s*\d+\s*月\s*\d+\s*日)\s*[（(][月火水木金土日][）)]/g;
        while ((dm = reWD.exec(ln)) !== null) {
          extractDates(dm[1]).forEach(function (d) { if (dates.indexOf(d) === -1) dates.push(d); });
        }
      });
      dates.sort();
    }
    // 曜日付き日付パターン（西暦）— 申込・締切系の行（近傍含む）は除外
    if (!dates.length) {
      dateLns.forEach(function (ln, i) {
        if (nearDeadline(i)) return;
        var dm2, reGD = /(\d{4}\s*年\s*\d+\s*月\s*\d+\s*日)\s*[（(][月火水木金土日][）)]/g;
        while ((dm2 = reGD.exec(ln)) !== null) {
          extractDates(dm2[1]).forEach(function (d) { if (dates.indexOf(d) === -1) dates.push(d); });
        }
      });
      dates.sort();
    }
    // 年なし「M月D日（曜）」の補完 — 既に年あり日付を拾えている場合、2日目以降が年省略でも同じ年で補う
    // （例: 「令和8年8月22日(土)」＋「8月23日(日)」→ 8/23も拾う。締切近傍行は除外）
    if (dates.length) {
      var yBase = Number(dates[0].split('-')[0]);
      dateLns.forEach(function (ln, i) {
        if (nearDeadline(i)) return;
        var ym, reMDw = /(?:令\s*和\s*\d+\s*年|\d{4}\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*[（(][月火水木金土日][）)]/g;
        while ((ym = reMDw.exec(ln)) !== null) {
          var mo = Number(ym[1]), da = Number(ym[2]);
          if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
            var v = iso(yBase, mo, da);
            if (dates.indexOf(v) === -1) dates.push(v);
          }
        }
      });
      dates = Array.from(new Set(dates)).sort();
    }
    // 「M/D（曜日）」形式の日付を取得 — 申込・締切系の行（近傍含む）は除外
    if (!dates.length) {
      var yearM = scanText.match(/(?:令\s*和\s*(\d+)|(\d{4}))\s*年/);
      if (yearM) {
        var baseYr = yearM[1] ? (2018 + Number(yearM[1])) : Number(yearM[2]);
        dateLns.forEach(function (ln, i) {
          if (nearDeadline(i)) return;
          var sm, reMDSlash = /(\d{1,2})\/(\d{1,2})\s*[（(][月火水木金土日][）)]/g;
          while ((sm = reMDSlash.exec(ln)) !== null) {
            var v = iso(baseYr, sm[1], sm[2]);
            if (dates.indexOf(v) === -1) dates.push(v);
          }
        });
        dates = Array.from(new Set(dates)).sort();
      }
    }
    // 最終手段：全文スキャン（締切・更新行を除外、最初の日付のみ）
    if (!dates.length) {
      var lns = scanText.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      for (var k = 0; k < lns.length; k++) {
        if (/(締切|申込|必着|更新|掲載|投稿|公開|登録)/.test(lns[k])) continue;
        var d = extractDates(lns[k]);
        if (d.length) { dates = d; break; }
      }
    }
    // 段階5（最終救出）: 大会名/会場の上位行に紛れた日付を拾う（会場名末尾の "6/28" 等。年は文書内から補完）
    if (!dates.length) {
      var ym5 = text.match(/(?:令\s*和\s*(\d+)|(\d{4}))\s*年/);
      var by5 = ym5 ? (ym5[1] ? (2018 + Number(ym5[1])) : Number(ym5[2])) : null;
      var cand5j = [];
      for (var p5 = 0; p5 < Math.min(6, lines.length); p5++) {
        var l5j = lines[p5];
        if (/(締切|申込|必着|受付|応募|エントリー)/.test(l5j)) continue;
        // 完全な日付（令和/西暦 年月日）
        extractDates(l5j).forEach(function (d) { if (cand5j.indexOf(d) === -1) cand5j.push(d); });
        // 年なしの m/d を文書内の年で補完（前後が数字＝年や別数値の一部は除外）
        if (by5) {
          var sm5, reMD5 = /(\d{1,2})\s*\/\s*(\d{1,2})/g;
          while ((sm5 = reMD5.exec(l5j)) !== null) {
            var before = sm5.index > 0 ? l5j.charAt(sm5.index - 1) : '';
            var afterIdx = sm5.index + sm5[0].length;
            var after = afterIdx < l5j.length ? l5j.charAt(afterIdx) : '';
            if (/\d/.test(before) || /\d/.test(after)) continue;
            var mo5 = Number(sm5[1]), da5 = Number(sm5[2]);
            if (mo5 >= 1 && mo5 <= 12 && da5 >= 1 && da5 <= 31) {
              var v5 = iso(by5, mo5, da5);
              if (v5 && cand5j.indexOf(v5) === -1) cand5j.push(v5);
            }
          }
        }
      }
      cand5j = Array.from(new Set(cand5j)).sort();
      if (cand5j.length && cand5j.length <= 5) dates = cand5j;
    }
    // 日付が5件超の場合は一覧ページとみなし破棄
    if (dates.length > 5) dates = [];
    r.kaisai_dates = dates;

    // 開会式の時刻
    for (var a = 0; a < lines.length; a++) {
      var mt = lines[a].match(/開\s*会\s*式[^0-9]*?(\d{1,2})\s*[:：時]\s*(\d{1,2})?/);
      if (mt) { r.kaikai_jikan = ('0' + mt[1]).slice(-2) + ':' + ('0' + (mt[2] || '0')).slice(-2); break; }
    }

    // 会場・住所
    var venueRe = /(体育館|アリーナ|ARENA|武道館|記念|会館|センター|ホール|競技場|ドーム|グラウンド|総合運動|プラザ)/i;
    var venueNg = /(協会|連盟|主催|後援|協賛|主管|受付|支払|振込|問合|申込)/;
    var addrNg = /(申込|受付|問合|協会|連盟|郵送|宛|事務局|送付|部会)/;
    var kaijoIdx = -1;
    for (var ki = 0; ki < lines.length; ki++) {
      if (venueRe.test(lines[ki]) && !venueNg.test(lines[ki])) { kaijoIdx = ki; break; }
    }
    if (kaijoIdx >= 0) {
      var v = splitVenue(lines[kaijoIdx]);
      r.kaijo = cleanVenue(v.venue);
      if (v.address) r.kaijo_jusho = cleanAddress_(v.address);
      // 住所が同じ行に無い（会場名が単独行）の場合、会場ラベル行や直後の行から住所を拾う
      if (!r.kaijo_jusho) {
        for (var ai = kaijoIdx; ai <= kaijoIdx + 2 && ai < lines.length; ai++) {
          var cand = lines[ai];
          var hasLabel = /(会\s*場|場\s*所|住\s*所)/.test(cand);
          if ((ai > kaijoIdx || hasLabel) && /(市|町|村|区)/.test(cand) && /\d/.test(cand) && !addrNg.test(cand)) {
            var ca = cleanAddress_(cand);
            if (ca && ca !== r.kaijo) { r.kaijo_jusho = ca; break; }
          }
        }
      }
    } else {
      r.kaijo = cleanVenue(pickValue(lines, /(会\s*場|場\s*所)/, venueNg));
    }
    if (!r.kaijo_jusho) {
      var jusho = lines.find(function (ln) {
        return /(市|町|村)/.test(ln) && /\d/.test(ln) && /(番地|丁目|〒|TEL|-)/.test(ln) && !addrNg.test(ln);
      });
      if (jusho) r.kaijo_jusho = cleanAddress_(jusho);
    }

    // 申込締切
    var lastEvent = (r.kaisai_dates && r.kaisai_dates.length) ? r.kaisai_dates[r.kaisai_dates.length - 1] : '';
    var eventYear = lastEvent ? Number(lastEvent.split('-')[0]) : null;
    var dlCands = [
      extractDeadline(lines, /(締\s*切|必\s*着)/, eventYear),
      extractDeadline(lines, /参\s*加\s*申\s*込/, eventYear),
      extractDeadline(lines, /申\s*込/, eventYear)
    ];
    r.shimekiri = dlCands.find(function (c) { return c && (!lastEvent || c <= lastEvent); }) || '';

    // 試合形式（プロファイルの formats ルールを順に適用）
    var fmtZone = text, fmts = [];
    (activeProfile.formats || []).forEach(function (rule) {
      if (!rule.re.test(fmtZone)) return;
      // skipIfAny: 既出ラベルのいずれかがこの正規表現に当たるならスキップ（排他）
      if (rule.skipIfAny && fmts.some(function (f) { return rule.skipIfAny.test(f); })) return;
      // skipIfNone: 既出ラベルのどれかがこの正規表現に当たる「とき以外」はスキップ
      if (rule.skipIfNone && !fmts.some(function (f) { return rule.skipIfNone.test(f); })) return;
      fmts.push(rule.label);
    });
    r.shiai_keishiki = fmts.join('、');

    buildSchedule(r);
    return r;
  }

  function addDays(isoStr, n) {
    var p = isoStr.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function isPast(dates) {
    if (!dates || !dates.length) return false;
    var latest = dates.slice().sort().pop();
    var p = latest.split('-');
    var limit = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    limit.setDate(limit.getDate() + PAST_GRACE_DAYS);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    return limit < today;
  }

  // 言語に応じた競技プロファイル群を返す
  function profilesForLang() {
    var lang = global.LANG || 'ja';
    if (lang === 'in') return SPORT_PROFILES_IN;
    if (lang === 'en') return SPORT_PROFILES_EN;
    return SPORT_PROFILES;
  }

  // UIの競技セレクタ用：競技キーと表示名の一覧を返す（言語に応じて競技構成が変わる）
  function sports() {
    var profiles = profilesForLang();
    return Object.keys(profiles).map(function (key) {
      return { key: key, label: profiles[key].label };
    });
  }

  // 既定の競技キー（言語に応じて切替）
  function defaultSport() {
    var lang = global.LANG || 'ja';
    if (lang === 'in') return DEFAULT_SPORT_IN;
    if (lang === 'en') return DEFAULT_SPORT_EN;
    return DEFAULT_SPORT;
  }

  global.Dropper = {
    parse: parse, addDays: addDays, isPast: isPast, sports: sports,
    get DEFAULT_SPORT() { return defaultSport(); }
  };
})(window);
