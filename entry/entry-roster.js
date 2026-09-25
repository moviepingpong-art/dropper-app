// entry-roster.js — 申込書ドロッパーの「名前の突き合わせ」と「書き込む値づくり」
// window.EntryRoster = { matchName, findNames, fill, parseBirth, ageAt, toWareki,
//                        nameKey, foldKey, distance, majorityPref } を公開する。
//
// ★ 名簿は個人情報そのもの。このファイルは通信を一切しない。
//   どこにも送らない（2026-09-15 までは AI に送る前に伏せ字にしていたが、AI をやめたので伏せ字の関数も無くした）。
// ★ 2026-09-16: 手持ちの名簿を読み取る処理（列の推測・CSV・Shift_JIS・性別や住所の書き方の吸収）は
//   ここから無くした。名簿は entry-book.js が決まった形で作り・読む。
//
// 流れ: entry-book.js が名簿を読む → 様式のセルから findNames() → 確認 → entry-rules.js が欄の対応を作る
//       → 設定（slots）と名簿から fill() → EntryXlsx.setCell で書き込む
(function (global) {
  'use strict';

  // ===== 文字をそろえる =====
  function nfkc(s) {
    s = s == null ? '' : String(s);
    try { s = s.normalize('NFKC'); } catch (e) {}
    return s.trim();
  }
  // 突き合わせの鍵。空白（全角・半角）を消す。「山田 太郎」と「山田太郎」を同じにする
  function nameKey(s) { return nfkc(s).replace(/\s+/g, ''); }

  // 名前によく出る異体字。★ NFKC ではそろわない（髙・﨑は互換文字ではなく別の字として登録されている）。
  // ここで一致したものは「表記ゆれ」として知らせ、書き込むのは名簿の表記にする。
  var VARIANTS = {
    '髙': '高', '﨑': '崎', '嵜': '崎', '𠮷': '吉', '邊': '辺', '邉': '辺', '齋': '斉', '齊': '斉',
    '斎': '斉', '澤': '沢', '濱': '浜', '櫻': '桜', '廣': '広', '國': '国', '眞': '真', '惠': '恵',
    '德': '徳', '瀨': '瀬', '龍': '竜', '實': '実', '藪': '薮', '槇': '槙', '冨': '富', '曾': '曽',
    '淺': '浅', '榮': '栄', '彌': '弥', '萬': '万', '壽': '寿', '埜': '野', '峯': '峰', '嶋': '島',
    '嶌': '島', '圓': '円', '禮': '礼', '靜': '静', '藏': '蔵'
  };
  // ※ 祐/佑 のように「別の名前として両方ある」字は入れない。入れると別人を同じ人として結び付ける
  function foldKey(s) {
    return Array.from(nameKey(s)).map(function (c) { return VARIANTS[c] || c; }).join('');
  }

  // 1文字ずつ（サロゲートペアを割らずに）数える編集距離
  function distance(a, b) {
    a = Array.from(a); b = Array.from(b);
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // ===== 生年月日 =====
  // 名簿ファイルの生年月日は Excel の日付だが、人が Excel で直すと文字になることがあるので、
  // S27.5.10・昭和30年2月28日・19600303 なども読めるままにしてある
  function cellText(c) { return c == null ? '' : (typeof c === 'string' ? c : c.text || ''); }
  var ERAS = [   // 始まりの日。和暦の年 = 西暦 - base + 1
    { name: '令和', short: 'R', base: 2019, start: [2019, 5, 1] },
    { name: '平成', short: 'H', base: 1989, start: [1989, 1, 8] },
    { name: '昭和', short: 'S', base: 1926, start: [1926, 12, 25] },
    { name: '大正', short: 'T', base: 1912, start: [1912, 7, 30] },
    { name: '明治', short: 'M', base: 1868, start: [1868, 1, 25] }
  ];
  function validDate(y, m, d) {
    if (!(y > 1800 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    var t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCMonth() === m - 1 ? { y: y, m: m, d: d } : null;
  }
  // セル（{text,value,isDate}）か文字列から { y, m, d }。読めなければ null。
  function parseBirth(c) {
    if (c && typeof c === 'object' && c.value != null && !cellText(c).match(/[\/年.\-]/)) {
      var v = c.value;
      if (v > 1000 && v < 80000) {   // Excel の日付（1900年基準）。生年月日の列なので日付の書式が無くても日付とみなす
        var t = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
        return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
      }
    }
    var s = nfkc(cellText(c)).replace(/\s+/g, '');
    if (!s) return null;
    var m = /^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/.exec(s);
    if (m) return validDate(+m[1], +m[2], +m[3]);
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (m) return validDate(+m[1], +m[2], +m[3]);
    m = /^(明治|大正|昭和|平成|令和|明|大|昭|平|令|[MTSHR])\.?(\d{1,2}|元)[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/i.exec(s);
    if (m) {
      var key = m[1].toUpperCase();
      var era = ERAS.filter(function (e) { return e.name === key || e.short === key || e.name.charAt(0) === key; })[0];
      if (!era) return null;
      var n = m[2] === '元' ? 1 : +m[2];
      return validDate(era.base + n - 1, +m[3], +m[4]);
    }
    return null;
  }
  function toWareki(b) {
    var ymd = b.y * 10000 + b.m * 100 + b.d;
    for (var i = 0; i < ERAS.length; i++) {
      var st = ERAS[i].start;
      if (ymd >= st[0] * 10000 + st[1] * 100 + st[2]) return { era: ERAS[i].name, short: ERAS[i].short, n: b.y - ERAS[i].base + 1 };
    }
    return null;
  }
  // 基準日の時点の満年齢
  function ageAt(b, base) {
    if (!b || !base) return null;
    return base.y - b.y - ((base.m < b.m || (base.m === b.m && base.d < b.d)) ? 1 : 0);
  }
  // ===== 名前の突き合わせ =====
  // status: exact（一致）/ variant（表記ゆれで一致）/ ambiguous（同姓同名）/ none（無い。近い候補つき）
  function matchName(roster, text) {
    var k = nameKey(text);
    if (!k) return null;
    var hit = roster.byKey[k];
    if (hit) return hit.length === 1 ? { status: 'exact', member: hit[0] } : { status: 'ambiguous', members: hit };
    var f = foldKey(text);
    hit = roster.byFold[f];
    if (hit) return hit.length === 1 ? { status: 'variant', member: hit[0] } : { status: 'ambiguous', members: hit };
    var limit = Array.from(f).length <= 3 ? 1 : 2;
    var cands = roster.members.map(function (m) { return { member: m, distance: distance(f, m.fold) }; })
      .filter(function (c) { return c.distance <= limit; })
      .sort(function (a, b) { return a.distance - b.distance; })
      .slice(0, 3);
    return { status: 'none', candidates: cands };
  }

  // 様式の見出しに使われる語。名前らしく見えても名前の候補にしない。
  var LABEL_RE = /(氏名|名前|選手|監督|コーチ|主将|記入|フリガナ|ふりがな|住所|性別|年齢|生年月日|合計|備考|団体|チーム|責任者|連絡|電話|申込|種目|番号|都道府県)/;
  var NAMEISH_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆ヶ ]{2,12}$/u;

  // 様式のセル（EntryXlsx.cells の形）から名前を探す。
  // 戻り値: { names: [{ refs, text, match }], suspects: [{ ref, text, candidates }], duplicates: [[名前, ...]] }
  //   names    … 名簿と結び付いたセル（exact / variant / ambiguous）
  //   suspects … 名簿に無いが、名前の並びの中にあって名前らしいセル（誤字の疑い）
  // ★ suspects は、画面の③で「名簿にない名前」として本人に選んでもらうために拾う。
  function findNames(cells, roster) {
    var byPos = {};
    cells.forEach(function (c) { byPos[c.row + ':' + c.col] = c; });
    var used = {}, names = [];

    cells.forEach(function (c) {
      if (used[c.ref] || c.formula || !nameKey(c.text)) return;
      var m = matchName(roster, c.text);
      if (m && m.status !== 'none') { names.push({ refs: [c.ref], row: c.row, col: c.col, text: c.text, match: m }); used[c.ref] = true; return; }
      // 姓と名が別の欄に分かれている様式。右隣（3列まで）の文字とつないで試す
      for (var dc = 1; dc <= 3; dc++) {
        var nb = byPos[c.row + ':' + (c.col + dc)];
        if (!nb) continue;
        if (used[nb.ref] || nb.formula) break;
        var m2 = matchName(roster, c.text + ' ' + nb.text);
        if (m2 && m2.status !== 'none') {
          names.push({ refs: [c.ref, nb.ref], row: c.row, col: c.col, text: c.text + ' ' + nb.text, match: m2 });
          used[c.ref] = used[nb.ref] = true;
        }
        break;
      }
    });

    // 名前の並ぶ列ごとに、行の間隔（2行で1人の様式もある）を見て、並びの中と前後1人ぶんを調べる
    var suspects = [];
    var byCol = {};
    names.forEach(function (n) { (byCol[n.col] = byCol[n.col] || []).push(n.row); });
    Object.keys(byCol).forEach(function (col) {
      var rowsHit = byCol[col].sort(function (a, b) { return a - b; });
      var step = 1;
      if (rowsHit.length >= 2) {
        step = Infinity;
        for (var i = 1; i < rowsHit.length; i++) step = Math.min(step, rowsHit[i] - rowsHit[i - 1]);
        if (!(step >= 1)) step = 1;
      }
      var top = rowsHit[0] - step, bottom = rowsHit[rowsHit.length - 1] + step;
      cells.forEach(function (c) {
        if (String(c.col) !== col || used[c.ref] || c.formula) return;
        if (c.row < top || c.row > bottom || (c.row - rowsHit[0]) % step !== 0) return;
        var t = nfkc(c.text);
        // ★ 見出しの語は、空白を取ってから見る（2026-09-18）。「氏　名」「氏　　　名」のように
        //   空白を入れた見出しが、名前の並びのすぐ上にあると、見出しを名前として拾っていた
        if (!NAMEISH_RE.test(t) || LABEL_RE.test(nameKey(t))) return;
        var nb = byPos[c.row + ':' + (Number(col) + 1)];
        var text = t, refs = [c.ref];
        var m = matchName(roster, t);
        if (nb && !used[nb.ref] && NAMEISH_RE.test(nfkc(nb.text)) && !LABEL_RE.test(nameKey(nb.text))) {
          var m2 = matchName(roster, t + ' ' + nb.text);
          if (m2 && m2.candidates && m2.candidates.length) { m = m2; text = t + ' ' + nfkc(nb.text); refs.push(nb.ref); }
        }
        suspects.push({ refs: refs, row: c.row, col: c.col, text: text, candidates: (m && m.candidates) || [] });
        refs.forEach(function (r) { used[r] = true; });
      });
    });

    // 同じ人が2回
    var seen = {}, duplicates = [];
    names.forEach(function (n) {
      if (n.match.status === 'ambiguous') return;
      var k = n.match.member.key;
      if (seen[k]) duplicates.push([seen[k], n]); else seen[k] = n;
    });

    names.sort(function (a, b) { return a.row - b.row || a.col - b.col; });
    suspects.sort(function (a, b) { return a.row - b.row || a.col - b.col; });
    return { names: names, suspects: suspects, duplicates: duplicates };
  }

  // ===== 書き込む値を作る =====
  // slot: { fields: [{ field, ref, fmt }] } … 1人ぶんの欄。欄の対応（entry-rules.js が作る）の1要素。
  // 戻り値: { writes: [{ ref, value }], problems: [{ ref, field, code }], age }
  function fill(member, slot, ctx) {
    ctx = ctx || {};
    var writes = [], problems = [];
    var put = function (f, v) { writes.push({ ref: f.ref, value: v }); };
    var miss = function (f, code) { problems.push({ ref: f.ref, field: f.field, code: code }); };
    var b = member.birth;
    var age = ageAt(b, ctx.baseDate);
    var w = b ? toWareki(b) : null;

    (slot.fields || []).forEach(function (f) {
      switch (f.field) {
        case 'name': put(f, member.name); break;
        case 'family': if (member.family) put(f, member.family); else miss(f, 'name-unsplit'); break;
        case 'given': if (member.given) put(f, member.given); else miss(f, 'name-unsplit'); break;
        case 'kana': if (member.kana) put(f, member.kana); else miss(f, 'not-in-roster'); break;
        case 'gender':
          if (!member.gender) miss(f, 'gender-missing');
          else put(f, f.fmt === 'full' ? member.gender + '性' : member.gender);
          break;
        case 'genderMale': case 'genderFemale':
          if (!member.gender) miss(f, 'gender-missing');
          else put(f, (member.gender === '男') === (f.field === 'genderMale') ? (f.mark || '○') : '');
          break;
        case 'birth':
          if (!b) { miss(f, 'birth-missing'); break; }
          if (f.fmt === 'wareki') put(f, w.era + (w.n === 1 ? '元' : w.n) + '年' + b.m + '月' + b.d + '日');
          else if (f.fmt === 'wareki-short') put(f, w.short + w.n + '.' + b.m + '.' + b.d);
          else if (f.fmt === 'seireki-kanji') put(f, b.y + '年' + b.m + '月' + b.d + '日');
          else put(f, b.y + '/' + b.m + '/' + b.d);
          break;
        case 'birthEra':
          if (f.fmt === 'none') { put(f, ''); break; }   // 西暦で書くときは元号の欄を空にする
          if (!b) miss(f, 'birth-missing'); else put(f, f.fmt === 'short' ? w.short : w.era);
          break;
        case 'birthYear':
          if (!b) { miss(f, 'birth-missing'); break; }
          if (f.fmt === 'wareki') put(f, w.era + w.n);
          else if (f.fmt === 'wareki-short') put(f, w.short + w.n);
          else if (f.fmt === 'wareki-num') put(f, w.n);
          else put(f, b.y);
          break;
        case 'birthMonth': if (!b) miss(f, 'birth-missing'); else put(f, b.m); break;
        case 'birthDay': if (!b) miss(f, 'birth-missing'); else put(f, b.d); break;
        case 'age':
          if (age == null) { miss(f, ctx.baseDate ? 'birth-missing' : 'base-date-missing'); break; }
          // 年齢は名簿に持たず、生年月日と基準日から毎回計算する（大会ごとに基準日が違うため）
          put(f, age);
          break;
        case 'postal': if (member.postal) put(f, member.postal); else miss(f, 'not-in-roster'); break;
        case 'address':
          if (!member.address) { miss(f, 'not-in-roster'); break; }
          // ★ いちばん多い都道府県は省いて、市区町村から書く（2026-09-18、本人の要望）。
          //   ほとんどが同じ県なので、そのほうが読みやすい。ちがう県の人には県名を付ける。
          //   省く県は画面が ctx.dropPref で渡す（名簿には県名を持ったまま）
          var addr = member.address;
          if (f.fmt !== 'keep-pref' && ctx.dropPref && member.pref === ctx.dropPref && member.addressRest) addr = member.addressRest;
          put(f, f.fmt === 'with-postal' && member.postal ? '〒' + member.postal + ' ' + addr : addr);
          break;
        case 'addressPref': if (member.pref) put(f, member.pref); else miss(f, 'address-unsplit'); break;
        case 'addressRest': if (member.addressRest) put(f, member.addressRest); else miss(f, 'address-unsplit'); break;
        case 'phone': if (member.phone) put(f, member.phone); else miss(f, 'not-in-roster'); break;
        default:
          // ★ 名簿に足した項目（extra:0 …、2026-09-20）。番号は名簿の列の順。
          //   入れていない人は「名簿に無い」として知らせる（黙って空にしない）
          var em = /^extra:(\d{1,2})$/.exec(f.field);
          if (!em) { miss(f, 'unknown-field'); break; }
          var ev = (member.extras || [])[Number(em[1])];
          if (ev) put(f, ev); else miss(f, 'not-in-roster');
          break;
      }
    });
    return { writes: writes, problems: problems, age: age };
  }

  // ★ この申込書に書く人のうち、いちばん多い都道府県。単独で最多なら、住所は省いて市区町村から書く
  //   （2026-09-18、本人の要望。ほとんどが同じ県なので、そのほうが読みやすい）。
  //   同数で並んだら省かない（どちらを省いても分かりにくいため）。
  //   members は**申込書に書く人すべて**（2枚目以降に入る人も。2026-09-26、1枚目の人だけを数えていた）
  //   → { pref, n, total } か null
  function majorityPref(members) {
    var counts = {}, total = 0;
    (members || []).forEach(function (m) {
      if (!m || !m.pref || !m.addressRest) return;
      counts[m.pref] = (counts[m.pref] || 0) + 1;
      total++;
    });
    var prefs = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    if (!prefs.length) return null;
    if (prefs.length > 1 && counts[prefs[0]] === counts[prefs[1]]) return null;   // 同数で並んだ
    return { pref: prefs[0], n: counts[prefs[0]], total: total };
  }

  global.EntryRoster = {
    matchName: matchName, findNames: findNames, fill: fill, parseBirth: parseBirth,
    ageAt: ageAt, toWareki: toWareki, nameKey: nameKey, foldKey: foldKey, distance: distance,
    majorityPref: majorityPref
  };
})(typeof window !== 'undefined' ? window : this);
