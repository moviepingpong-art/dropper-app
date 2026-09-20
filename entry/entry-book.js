// entry-book.js — 申込書ドロッパーの「名簿ファイル」を作る・読む
//
// ★ 2026-09-16 に方針を変えた。団体ごとに名簿の形と書き方がばらばらなので、
//   手持ちの名簿を読み取って列を推測するのをやめ、このツールで決まった形に作ってもらう。
//   作った名簿はファイルとして本人が持つ（ブラウザには覚えさせない）。
//
// ファイルの形（形式 1）:
//   シート「男子」「女子」  1行1人。1行目が見出し。性別の列は無く、どちらのシートにいるかが性別
//   シート「この名簿について」  形式の版・団体名・作った日・注意書き
//   列 A〜I: 姓 / 名 / セイ / メイ / 生年月日 / 郵便番号 / 都道府県 / 住所 / 電話
//   - 年齢の列は置かない（大会ごとに基準日が違うので、生年月日から毎回計算する）
//   - 住所は「都道府県」と「それ以下」に分ける（都道府県だけの欄がある申込書のため）
//   - 郵便番号と電話は文字として書く（先頭の 0 が消えないように）
//   - J 列から先に本人が足した列は、中身を触らずそのまま残す
//
// ★ 見出しが違うファイルは読まない（どの列が何かを推測しない）。推測をやめたのがこの作りの主旨。
//
// window.EntryBook = { VERSION, SHEETS, INFO_SHEET, HEADERS, blank, make, read, toRoster, fileName } を公開する。
(function (global) {
  'use strict';

  var VERSION = 1;
  var SHEETS = ['男子', '女子'];
  var INFO_SHEET = 'この名簿について';
  var HEADERS = ['姓', '名', 'セイ', 'メイ', '生年月日', '郵便番号', '都道府県', '住所', '電話'];
  var KEYS = ['family', 'given', 'kanaFamily', 'kanaGiven', 'birth', 'postal', 'pref', 'address', 'phone'];
  var TOOL_URL = 'https://app.dropper-tools.com/entry/';

  // ZIP に書く日時は固定にする（同じ中身なら同じバイト列になり、変わったかどうかを見やすくするため）
  var DOS_DATE = ((2026 - 1980) << 9) | (9 << 5) | 16;

  function nfkc(s) {
    s = s == null ? '' : String(s);
    try { s = s.normalize('NFKC'); } catch (e) {}
    return s.trim();
  }
  // 団体名は書いたとおりに残す（NFKC だと「（架空）」が「(架空)」になってしまう）。
  // 名前や住所は突き合わせに使うので、NFKC でそろえる。
  function plain(s) { return s == null ? '' : String(s).trim(); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }
  function serialOf(b) {
    return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(1899, 11, 30)) / 86400000);
  }
  function dateOfSerial(v) {
    var t = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }

  function blank() {
    var people = {};
    SHEETS.forEach(function (g) { people[g] = []; });
    return { org: '', people: people, extraHeaders: {} };
  }

  function fileName(org) {
    var name = plain(org).replace(/[\\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
    return name ? '名簿_' + name + '.xlsx' : '名簿.xlsx';
  }

  // ===== 作る =====
  // 書式: 0 ふつう / 1 見出し（太字）/ 2 生年月日（yyyy/m/d）/ 3 文字（郵便番号・電話）
  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="176" formatCode="yyyy/m/d"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="ＭＳ Ｐゴシック"/><family val="2"/><charset val="128"/></font>' +
    '<font><b/><sz val="11"/><name val="ＭＳ Ｐゴシック"/><family val="2"/><charset val="128"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="176" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="標準" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  var WIDTHS = [10, 10, 12, 12, 12, 10, 10, 30, 15];

  function colName(n) {   // 1 → A
    var s = '';
    while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
    return s;
  }

  // セル1つぶんの XML。{ t: 'text' | 'num' | 'date' | 'head', v }
  function cellXml(ref, c) {
    if (c == null || c.v === '' || c.v == null) return '';
    if (c.t === 'num') return '<c r="' + ref + '"><v>' + c.v + '</v></c>';
    if (c.t === 'date') return '<c r="' + ref + '" s="2"><v>' + c.v + '</v></c>';
    var s = c.t === 'head' ? ' s="1"' : (c.t === 'str' ? ' s="3"' : '');
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + esc(c.v) + '</t></is></c>';
  }

  function sheetXml(rows, widths, freeze) {
    var body = rows.map(function (row, i) {
      var r = i + 1;
      var cellsXml = row.map(function (c, k) { return cellXml(colName(k + 1) + r, c); }).join('');
      return cellsXml ? '<row r="' + r + '">' + cellsXml + '</row>' : '';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      (freeze ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>' : '') +
      (widths && widths.length ? '<cols>' + widths.map(function (w, k) {
        return '<col min="' + (k + 1) + '" max="' + (k + 1) + '" width="' + w + '" customWidth="1"/>';
      }).join('') + '</cols>' : '') +
      '<sheetData>' + body + '</sheetData>' +
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
  }

  function personRow(p, extras) {
    var row = [
      { v: nfkc(p.family) }, { v: nfkc(p.given) }, { v: nfkc(p.kanaFamily) }, { v: nfkc(p.kanaGiven) },
      p.birth ? { t: 'date', v: serialOf(p.birth) } : { v: nfkc(p.birthText) },
      { t: 'str', v: nfkc(p.postal) }, { v: nfkc(p.pref) }, { v: nfkc(p.address) }, { t: 'str', v: nfkc(p.phone) }
    ];
    (extras || []).forEach(function (_, k) { row.push({ v: nfkc((p.extras || [])[k]) }); });
    return row;
  }

  // data: { org, people: { 男子: [人], 女子: [人] }, extraHeaders: { 男子: ['備考'] }, today: 'YYYY-MM-DD' }
  // → Promise<Uint8Array>
  function make(data) {
    var X = global.EntryXlsx;
    var sheets = SHEETS.map(function (g) {
      var extras = (data.extraHeaders || {})[g] || [];
      var rows = [HEADERS.concat(extras).map(function (h) { return { t: 'head', v: h }; })];
      ((data.people || {})[g] || []).forEach(function (p) { rows.push(personRow(p, extras)); });
      return { name: g, rows: rows, widths: WIDTHS.concat(extras.map(function () { return 15; })), freeze: true };
    });
    var info = [
      ['このファイルは「申込書ドロッパー」の名簿です', ''],
      ['形式', String(VERSION)],
      ['団体名', plain(data.org)],
      ['作った日', plain(data.today)],
      ['注意', '1行目の見出しを変えたり、列を入れ替えたりしないでください。読めなくなります'],
      ['', 'J 列から先に足した列は、そのまま残します'],
      ['', '個人情報です。ファイルの置き場所と渡し方に気をつけてください'],
      ['ツール', TOOL_URL]
    ].map(function (r) { return [{ t: 'head', v: r[0] }, { v: r[1] }]; });
    sheets.push({ name: INFO_SHEET, rows: info, widths: [16, 60], freeze: false });

    var n = sheets.length;
    var parts = {};
    parts['[Content_Types].xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map(function (s, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';
    parts['_rels/.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';
    parts['xl/workbook.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + sheets.map(function (s, i) {
        return '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join('') + '</sheets></workbook>';
    parts['xl/_rels/workbook.xml.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) {
        return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join('') +
      '<Relationship Id="rId' + (n + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';
    parts['xl/styles.xml'] = STYLES;
    sheets.forEach(function (s, i) {
      parts['xl/worksheets/sheet' + (i + 1) + '.xml'] = sheetXml(s.rows, s.widths, s.freeze);
    });

    var enc = new TextEncoder();
    var names = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml']
      .concat(sheets.map(function (s, i) { return 'xl/worksheets/sheet' + (i + 1) + '.xml'; }));
    return Promise.all(names.map(function (name) {
      var bytes = enc.encode(parts[name]);
      return X.zip.deflate(bytes).then(function (raw) {
        return { nameBytes: enc.encode(name), name: name, versionMade: 20, versionNeeded: 20, flags: 0x0800,
                 method: 8, time: 0, date: DOS_DATE, crc: X.zip.crc32(bytes), usize: bytes.length,
                 raw: raw, internalAttr: 0, externalAttr: 0 };
      });
    })).then(function (entries) { return X.zip.write(entries); });
  }

  // ===== 読む =====
  // EntryXlsx.open() で開いた book → { ok, code, org, version, people, extraHeaders, problems }
  // 読めないときは ok:false と code（book-sheets / book-header / book-newer）
  function read(book) {
    var X = global.EntryXlsx;
    var names = X.sheetNames(book);
    var missing = SHEETS.filter(function (g) { return names.indexOf(g) < 0; });
    if (missing.length) return { ok: false, code: 'book-sheets', detail: missing.join('・') };

    var info = names.indexOf(INFO_SHEET) >= 0 ? gridOf(X.cells(book, INFO_SHEET)) : {};
    var org = '', version = VERSION, today = '';
    Object.keys(info).forEach(function (key) {
      if (!/C1$/.test(key)) return;
      var row = key.slice(1).split('C')[0];
      var label = nfkc(info[key].text), right = info['R' + row + 'C2'];
      if (!right) return;
      if (label === '団体名') org = plain(right.text);
      if (label === '作った日') today = nfkc(right.text);
      if (label === '形式') version = Number(nfkc(right.text)) || version;
    });
    if (version > VERSION) return { ok: false, code: 'book-newer', detail: String(version) };

    var people = {}, extraHeaders = {}, problems = [];
    var headerBad = null;
    SHEETS.forEach(function (g) {
      if (headerBad) return;
      var grid = gridOf(X.cells(book, g));
      var headers = [];
      for (var c = 1; c <= 200; c++) {
        var h = grid['R1C' + c];
        if (!h) { if (c > HEADERS.length) break; headers.push(''); continue; }
        headers.push(nfkc(h.text));
      }
      for (var i = 0; i < HEADERS.length; i++) {
        if (headers[i] !== HEADERS[i]) {
          headerBad = { code: 'book-header', detail: g + ' シートの ' + colName(i + 1) + '1（「' + HEADERS[i] + '」のはずが「' + (headers[i] || '空') + '」）' };
          return;
        }
      }
      var extras = headers.slice(HEADERS.length).map(function (h) { return nfkc(h); });
      while (extras.length && !extras[extras.length - 1]) extras.pop();
      extraHeaders[g] = extras;

      var list = [];
      var lastRow = 1;
      Object.keys(grid).forEach(function (k) { var r = Number(k.slice(1).split('C')[0]); if (r > lastRow) lastRow = r; });
      for (var r = 2; r <= lastRow; r++) {
        var at = function (col) { return grid['R' + r + 'C' + col] || null; };
        var p = { row: r, gender: g, problems: [] };
        KEYS.forEach(function (key, k) {
          if (key === 'birth') return;
          p[key] = nfkc(at(k + 1) ? at(k + 1).text : '');
        });
        if (!p.family && !p.given) continue;   // 空行は飛ばす
        var bc = at(5);
        p.birthText = nfkc(bc ? bc.text : '');
        p.birth = birthOf(bc);
        p.extras = extras.map(function (_, k) { var c = at(HEADERS.length + k + 1); return c ? nfkc(c.text) : ''; });
        p.problems = problemsOf(p);
        if (p.problems.length) problems.push(p);
        list.push(p);
      }
      people[g] = list;
    });
    if (headerBad) return { ok: false, code: headerBad.code, detail: headerBad.detail };
    return { ok: true, org: org, today: today, version: version, people: people, extraHeaders: extraHeaders, problems: problems };
  }

  // 1人ぶんの気になる点。★ 止めるためではなく知らせるため（申込書にその欄があると困る、と分かるように）
  function problemsOf(p) {
    var out = [];
    if (!nfkc(p.given)) out.push('given-empty');
    var birthText = nfkc(p.birthText);
    if (!p.birth && !birthText) out.push('birth-empty');
    else if (!p.birth) out.push('birth-unreadable');
    if (!nfkc(p.kanaFamily) && !nfkc(p.kanaGiven)) out.push('kana-empty');
    if (!nfkc(p.pref) && !nfkc(p.address)) out.push('address-empty');
    if (!nfkc(p.phone)) out.push('phone-empty');
    if (nfkc(p.postal) && !/^\d{3}-?\d{4}$/.test(nfkc(p.postal))) out.push('postal-bad');
    return out;
  }

  // セルの一覧を R<行>C<列> の引きやすい形にする
  function gridOf(cells) {
    var grid = {};
    cells.forEach(function (c) { grid['R' + c.row + 'C' + c.col] = c; });
    return grid;
  }

  // 生年月日のセル → { y, m, d }。Excel の日付（数値）と、人が直した文字（S27.5.10 など）の両方を読む
  function birthOf(c) {
    if (!c) return null;
    if (c.value != null && c.value > 1000 && c.value < 80000 && !/[\/年.\-]/.test(c.text || '')) return dateOfSerial(c.value);
    var R = global.EntryRoster;
    return R ? R.parseBirth(c) : null;
  }

  // ===== 申込書に書くための形にする =====
  // 名前の突き合わせ（EntryRoster.matchName / findNames）と fill() が使う形に合わせる
  function toRoster(people) {
    var R = global.EntryRoster;
    var members = [], byKey = {}, byFold = {};
    SHEETS.forEach(function (g) {
      (people[g] || []).forEach(function (p) {
        var name = [p.family, p.given].filter(Boolean).join(' ');
        var kana = [p.kanaFamily, p.kanaGiven].filter(Boolean).join(' ');
        var m = {
          row: p.row, sheet: g, name: name, family: p.family || null, given: p.given || null,
          kana: kana || null, gender: g === '男子' ? '男' : '女', birth: p.birth || null,
          postal: p.postal || null,
          pref: p.pref || null, addressRest: p.address || null,
          address: [p.pref, p.address].filter(Boolean).join('') || null,
          phone: p.phone || null, problems: (p.problems || problemsOf(p)).slice(),
          // ★ 自分で足した項目（所属・学校名など、2026-09-20）。番号は名簿の列の順のまま渡す
          extras: (p.extras || []).slice()
        };
        m.key = R.nameKey(name);
        m.fold = R.foldKey(name);
        (byKey[m.key] = byKey[m.key] || []).push(m);
        (byFold[m.fold] = byFold[m.fold] || []).push(m);
        members.push(m);
      });
    });
    return { ok: true, members: members, byKey: byKey, byFold: byFold };
  }

  global.EntryBook = {
    VERSION: VERSION, SHEETS: SHEETS, INFO_SHEET: INFO_SHEET, HEADERS: HEADERS, KEYS: KEYS,
    blank: blank, make: make, read: read, toRoster: toRoster, fileName: fileName, serialOf: serialOf,
    problemsOf: problemsOf
  };
})(window);
