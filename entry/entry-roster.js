// entry-roster.js — 申込書ドロッパーの名簿まわり
// window.EntryRoster = { rowsFromCells, decodeCsv, rowsFromCsv, load, matchName, findNames, mask,
//                        fill, parseBirth, ageAt, toWareki, nameKey, foldKey } を公開する。
//
// ★ 名簿は個人情報そのもの。このファイルは通信を一切しない。
//   AI に渡してよいのは mask() を通したものだけ。名前は〔氏名1〕に置き換え、
//   名簿の項目（生年月日・住所・電話）はそもそも様式に書かれていないので渡らない。
//
// 流れ: 名簿を load() → 様式のセルから findNames() → 確認 → mask() して AI へ（設定づくり）
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

  // ===== 名簿の表 =====
  // 表は「行の配列、行はセルの配列」。セルは { text, value, isDate } か文字列。
  function rowsFromCells(cells) {
    var rows = [];
    cells.forEach(function (c) {
      if (!rows[c.row - 1]) rows[c.row - 1] = [];
      rows[c.row - 1][c.col - 1] = { text: c.text, value: c.value, isDate: c.isDate };
    });
    for (var i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  // CSV は Excel が書くと Shift_JIS になる。UTF-8 として正しく読めなければ Shift_JIS で読む。
  function decodeCsv(u8) {
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return new TextDecoder('utf-8').decode(u8.subarray(3));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); }
    catch (e) { return new TextDecoder('shift_jis').decode(u8); }
  }
  function rowsFromCsv(text) {
    var rows = [], row = [], field = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (q) {
        if (ch === '"') { if (text.charAt(i + 1) === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.map(function (r) { return r.map(function (t) { return { text: t, value: null, isDate: false }; }); });
  }

  // 見出しの言い方。★ 並び順に意味がある——「氏名（フリガナ）」はフリガナ、を先に判定するため。
  var HEADER_RULES = [
    ['kana', /(フリガナ|ふりがな|カナ|よみがな|ヨミガナ)/],
    ['birth', /(生年月日|誕生日|生まれ)/],
    ['age', /年齢/],
    ['gender', /(性別|男女)/],
    ['postal', /(郵便|〒)/],
    ['address', /(住所|所在地)/],
    ['phone', /(電話|TEL|携帯|連絡先)/i],
    ['family', /^(姓|苗字|名字)$/],
    ['given', /^名$/],
    ['name', /(氏名|名前|選手名|会員名|フルネーム)/]
  ];

  function cellText(c) { return c == null ? '' : (typeof c === 'string' ? c : c.text || ''); }

  // 見出しの行を探して、どの列が何かを推測する。本人に確認してもらう前提の「推測」。
  function guessColumns(rows) {
    var best = null;
    for (var r = 0; r < Math.min(rows.length, 20); r++) {
      var cols = {}, hits = 0;
      (rows[r] || []).forEach(function (c, i) {
        var t = nfkc(cellText(c)).replace(/\s+/g, '');
        if (!t) return;
        for (var k = 0; k < HEADER_RULES.length; k++) {
          var key = HEADER_RULES[k][0];
          if (HEADER_RULES[k][1].test(t)) { if (cols[key] === undefined) { cols[key] = i; hits++; } break; }
        }
      });
      var hasName = cols.name !== undefined || (cols.family !== undefined && cols.given !== undefined);
      if (hasName && hits >= 2 && (!best || hits > best.hits)) best = { headerRow: r, columns: cols, hits: hits };
    }
    return best;
  }

  // ===== 名簿を読む =====
  // columns を渡さなければ推測する。戻り値の columns を画面で見せ、直されたら渡し直す。
  function load(rows, columns, headerRow) {
    if (!columns) {
      var g = guessColumns(rows);
      if (!g) return { ok: false, code: 'no-header' };
      columns = g.columns; headerRow = g.headerRow;
    }
    var members = [], byKey = {}, byFold = {};
    for (var r = headerRow + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      var at = function (key) { return columns[key] === undefined ? null : row[columns[key]]; };
      var name = columns.name !== undefined ? nfkc(cellText(at('name'))).replace(/\s+/g, ' ')
        : [nfkc(cellText(at('family'))), nfkc(cellText(at('given')))].filter(Boolean).join(' ');
      if (!nameKey(name)) continue;
      var m = { row: r + 1, name: name, problems: [] };
      var parts = name.split(' ');
      if (columns.family !== undefined && columns.name === undefined) { m.family = nfkc(cellText(at('family'))); m.given = nfkc(cellText(at('given'))); }
      else if (parts.length === 2) { m.family = parts[0]; m.given = parts[1]; }
      else { m.family = null; m.given = null; }
      m.kana = columns.kana !== undefined ? (nfkc(cellText(at('kana'))) || null) : null;

      var bc = at('birth');
      m.birth = columns.birth === undefined ? null : parseBirth(bc);
      if (columns.birth !== undefined) {
        if (!cellText(bc) && (bc == null || bc.value == null)) m.problems.push('birth-empty');
        else if (!m.birth) m.problems.push('birth-unreadable');
      }

      var gRaw = nfkc(cellText(at('gender')));
      m.gender = parseGender(gRaw);
      if (columns.gender !== undefined && !m.gender) m.problems.push(gRaw ? 'gender-unreadable' : 'gender-empty');

      var ac = at('age');
      m.rosterAge = ac && ac.value != null ? ac.value : (/^\d+$/.test(nfkc(cellText(ac))) ? Number(nfkc(cellText(ac))) : null);

      var addr = splitAddress(nfkc(cellText(at('address'))));
      var postal = nfkc(cellText(at('postal'))).replace(/^〒\s*/, '');
      m.postal = postal || addr.postal;
      m.address = addr.body;
      m.pref = addr.pref;
      m.addressRest = addr.rest;

      var pc = at('phone');
      m.phone = nfkc(cellText(pc)) || null;
      // Excel が電話番号を数値にすると、先頭の 0 が消える（09012345678 → 9012345678）
      if (pc && pc.value != null && /^[1-9]\d{8,9}$/.test(String(pc.value))) {
        m.phone = '0' + pc.value;
        m.problems.push('phone-zero-restored');
      }

      m.key = nameKey(name);
      m.fold = foldKey(name);
      (byKey[m.key] = byKey[m.key] || []).push(m);
      (byFold[m.fold] = byFold[m.fold] || []).push(m);
      members.push(m);
    }
    return { ok: true, columns: columns, headerRow: headerRow, members: members, byKey: byKey, byFold: byFold };
  }

  // ===== 生年月日・性別・住所 =====
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
  function parseGender(s) {
    s = nfkc(s).replace(/\s+/g, '').toLowerCase();
    if (/^(男|男性|m|male|♂)$/.test(s)) return '男';
    if (/^(女|女性|f|female|♀)$/.test(s)) return '女';
    return null;
  }
  var PREF_RE = /^(北海道|東京都|京都府|大阪府|.{2,3}県)/;
  function splitAddress(s) {
    var out = { postal: null, body: s || null, pref: null, rest: null };
    if (!s) return out;
    var m = /^〒?\s*(\d{3})-?(\d{4})\s*/.exec(s);
    if (m) { out.postal = m[1] + '-' + m[2]; out.body = s.slice(m[0].length); }
    var p = PREF_RE.exec(out.body);
    if (p) { out.pref = p[1]; out.rest = out.body.slice(p[1].length).trim(); }
    return out;
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
  // ★ suspects を拾うのは、AI に送る前に伏せ字にするためでもある。拾い漏れた誤字は名前のまま送られる。
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
        if (!NAMEISH_RE.test(t) || LABEL_RE.test(t)) return;
        var nb = byPos[c.row + ':' + (Number(col) + 1)];
        var text = t, refs = [c.ref];
        var m = matchName(roster, t);
        if (nb && !used[nb.ref] && NAMEISH_RE.test(nfkc(nb.text)) && !LABEL_RE.test(nb.text)) {
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

  // AI に渡してよい形にする。名前（候補・誤字の疑いを含む）のセルを〔氏名N〕に置き換える。
  // 戻り値のセルは { ref, text } だけ（value などの付随情報も落とす）。
  function mask(cells, found) {
    var label = {}, n = 0;
    found.names.concat(found.suspects).sort(function (a, b) { return a.row - b.row || a.col - b.col; })
      .forEach(function (x) {
        n++;
        x.refs.forEach(function (r, i) { label[r] = '〔氏名' + n + (x.refs.length > 1 ? (i === 0 ? '・姓' : '・名') : '') + '〕'; });
      });
    return cells.map(function (c) { return { ref: c.ref, text: label[c.ref] || c.text }; });
  }

  // ===== 書き込む値を作る =====
  // slot: { fields: [{ field, ref, fmt }] } … 1人ぶんの欄。設定（AI が作る）の1要素。
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
          put(f, age);
          // 名簿の年齢は「名簿を作った日」の値なので、基準日と1歳ずれるのは普通。
          // 2歳以上ずれたら、名簿の生年月日か年齢のどちらかが誤っている疑いとして知らせる
          if (member.rosterAge != null && Math.abs(member.rosterAge - age) >= 2) problems.push({ ref: f.ref, field: 'age', code: 'age-differs', roster: member.rosterAge, computed: age });
          break;
        case 'postal': if (member.postal) put(f, member.postal); else miss(f, 'not-in-roster'); break;
        case 'address':
          if (!member.address) { miss(f, 'not-in-roster'); break; }
          put(f, f.fmt === 'with-postal' && member.postal ? '〒' + member.postal + ' ' + member.address : member.address);
          break;
        case 'addressPref': if (member.pref) put(f, member.pref); else miss(f, 'address-unsplit'); break;
        case 'addressRest': if (member.addressRest) put(f, member.addressRest); else miss(f, 'address-unsplit'); break;
        case 'phone': if (member.phone) put(f, member.phone); else miss(f, 'not-in-roster'); break;
        default: miss(f, 'unknown-field');
      }
    });
    return { writes: writes, problems: problems, age: age };
  }

  global.EntryRoster = {
    rowsFromCells: rowsFromCells, decodeCsv: decodeCsv, rowsFromCsv: rowsFromCsv,
    guessColumns: guessColumns, load: load, matchName: matchName, findNames: findNames, mask: mask,
    fill: fill, parseBirth: parseBirth, parseGender: parseGender, splitAddress: splitAddress,
    ageAt: ageAt, toWareki: toWareki, nameKey: nameKey, foldKey: foldKey, distance: distance
  };
})(typeof window !== 'undefined' ? window : this);
