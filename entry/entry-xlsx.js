// entry-xlsx.js — 申込書ドロッパーの xlsx 読み書き
// window.EntryXlsx = { open(buf), sheetNames(book), cells(book, sheet), merges(book, sheet),
//                      setCell(book, sheet, ref, value), save(book), parseRef, toRef, zip } を公開する。
//
// ★ 書き換えたセル以外は1バイトも変えない。
//   事務局の様式は罫線・結合・印刷設定まで作り込まれている。一般的なライブラリで読んで保存し直すと
//   書式や印刷範囲が落ちることがあるので、ここでは ZIP の中身を直接扱う。
//   - 書き換えていない部品（styles.xml など）は、圧縮済みのバイト列をそのまま詰め直す
//   - 書き換えたシートも、対象の <c> 要素だけを差し替える（XML を組み立て直さない）
//   ブラウザと Node の両方にある DecompressionStream / CompressionStream だけを使う（外部ライブラリなし）。
//
// ★ 名簿（個人情報）はここを通っても外へ出ない。通信は一切しない。
(function (global) {
  'use strict';

  function fail(code, detail) {
    var e = new Error(code + (detail ? ': ' + detail : ''));
    e.code = code;   // 画面は文言ではなく code で判定する（多言語化で壊さないため）
    return e;
  }

  // ===== ZIP =====
  function u16(d, o) { return d[o] | (d[o + 1] << 8); }
  function u32(d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0; }
  function w16(d, o, v) { d[o] = v & 255; d[o + 1] = (v >>> 8) & 255; }
  function w32(d, o, v) { d[o] = v & 255; d[o + 1] = (v >>> 8) & 255; d[o + 2] = (v >>> 16) & 255; d[o + 3] = (v >>> 24) & 255; }

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function readZip(u8) {
    var eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
      if (u32(u8, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw fail('not-xlsx');
    var count = u16(u8, eocd + 10);
    var cdOff = u32(u8, eocd + 16);
    if (count === 0xFFFF || cdOff === 0xFFFFFFFF) throw fail('zip64');   // 申込書の大きさでは起きない
    var entries = [];
    var p = cdOff;
    for (var n = 0; n < count; n++) {
      if (u32(u8, p) !== 0x02014b50) throw fail('broken-zip');
      var e = {
        versionMade: u16(u8, p + 4), versionNeeded: u16(u8, p + 6), flags: u16(u8, p + 8),
        method: u16(u8, p + 10), time: u16(u8, p + 12), date: u16(u8, p + 14),
        crc: u32(u8, p + 16), csize: u32(u8, p + 20), usize: u32(u8, p + 24),
        internalAttr: u16(u8, p + 36), externalAttr: u32(u8, p + 38)
      };
      var nlen = u16(u8, p + 28), xlen = u16(u8, p + 30), clen = u16(u8, p + 32);
      var lho = u32(u8, p + 42);
      if (e.flags & 1) throw fail('encrypted');
      e.nameBytes = u8.slice(p + 46, p + 46 + nlen);
      e.name = new TextDecoder().decode(e.nameBytes);
      p += 46 + nlen + xlen + clen;
      if (u32(u8, lho) !== 0x04034b50) throw fail('broken-zip');
      var start = lho + 30 + u16(u8, lho + 26) + u16(u8, lho + 28);
      e.raw = u8.subarray(start, start + e.csize);
      entries.push(e);
    }
    return entries;
  }

  function pump(u8, stream) {
    return new Response(new Blob([u8]).stream().pipeThrough(stream))
      .arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function inflate(e) {
    if (e.method === 0) return Promise.resolve(e.raw.slice());
    if (e.method !== 8) return Promise.reject(fail('zip-method', String(e.method)));
    return pump(e.raw, new DecompressionStream('deflate-raw'));
  }
  function deflate(u8) { return pump(u8, new CompressionStream('deflate-raw')); }

  // entries: readZip の形。変えていない項目は raw（圧縮済み）をそのまま使う。
  function writeZip(entries) {
    var locals = [], centrals = [], offset = 0;
    entries.forEach(function (e) {
      var flags = e.flags & ~0x0008;           // サイズは先頭に書くので data descriptor は使わない
      var name = e.nameBytes;
      var lh = new Uint8Array(30 + name.length);
      w32(lh, 0, 0x04034b50); w16(lh, 4, e.versionNeeded); w16(lh, 6, flags); w16(lh, 8, e.method);
      w16(lh, 10, e.time); w16(lh, 12, e.date); w32(lh, 14, e.crc); w32(lh, 18, e.raw.length);
      w32(lh, 22, e.usize); w16(lh, 26, name.length); w16(lh, 28, 0);
      lh.set(name, 30);
      var ch = new Uint8Array(46 + name.length);
      w32(ch, 0, 0x02014b50); w16(ch, 4, e.versionMade); w16(ch, 6, e.versionNeeded); w16(ch, 8, flags);
      w16(ch, 10, e.method); w16(ch, 12, e.time); w16(ch, 14, e.date); w32(ch, 16, e.crc);
      w32(ch, 20, e.raw.length); w32(ch, 24, e.usize); w16(ch, 28, name.length); w16(ch, 30, 0);
      w16(ch, 32, 0); w16(ch, 34, 0); w16(ch, 36, e.internalAttr); w32(ch, 38, e.externalAttr);
      w32(ch, 42, offset);
      ch.set(name, 46);
      locals.push(lh, e.raw);
      centrals.push(ch);
      offset += lh.length + e.raw.length;
    });
    var cdSize = centrals.reduce(function (s, c) { return s + c.length; }, 0);
    var end = new Uint8Array(22);
    w32(end, 0, 0x06054b50); w16(end, 8, entries.length); w16(end, 10, entries.length);
    w32(end, 12, cdSize); w32(end, 16, offset);
    var out = new Uint8Array(offset + cdSize + 22);
    var q = 0;
    locals.concat(centrals, [end]).forEach(function (part) { out.set(part, q); q += part.length; });
    return out;
  }

  // ===== XML の小道具 =====
  // 様式の XML は Excel などが機械的に書いたものなので、正規表現で要素を切り出す。
  // DOMParser で読み直して書き出すと、属性の順や名前空間の書き方が変わってしまうため使わない。
  function attrs(tag) {
    var o = {};
    tag.replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, function (_, k, a, b) {
      o[k] = decodeXml(a !== undefined ? a : b);
    });
    return o;
  }
  function decodeXml(s) {
    return String(s)
      .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(Number(d)); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      // Excel は改行などを _x000D_ の形で書く
      .replace(/_x([0-9A-F]{4})_/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); });
  }
  function encodeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/_(x[0-9A-Fa-f]{4})_/g, '_x005F_$1_')   // 文字としての "_x000D_" を守る
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  // <si> や <is> の中の文字。★ <rPh>（ふりがな）は捨てる。
  // 捨てないと「氏名」が「氏　名シメイ」と読める（実際の申込書で確認）。
  function richText(inner) {
    var s = String(inner || '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    var out = '';
    s.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, function (_, t) { out += decodeXml(t); });
    return out;
  }

  // ===== セル番地 =====
  function colToNum(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n;
  }
  function numToCol(n) {
    var s = '';
    while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function parseRef(ref) {
    var m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(String(ref).toUpperCase());
    if (!m) throw fail('bad-ref', ref);
    return { col: colToNum(m[1]), row: Number(m[2]) };
  }
  function toRef(col, row) { return numToCol(col) + row; }

  // ===== 開く =====
  function partPath(base, target) {
    if (target.charAt(0) === '/') return target.slice(1);
    var parts = (base + target).split('/'), out = [];
    parts.forEach(function (p) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); });
    return out.join('/');
  }

  function open(buf) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    // 古い .xls と、パスワード付きの .xlsx は、どちらも OLE の箱（D0 CF 11 E0）で来る
    if (u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0) return Promise.reject(fail('xls-or-password'));
    if (!(u8[0] === 0x50 && u8[1] === 0x4B)) return Promise.reject(fail('not-xlsx'));
    var entries;
    try { entries = readZip(u8); } catch (e) { return Promise.reject(e); }
    var byName = {};
    entries.forEach(function (e) { byName[e.name] = e; });

    function text(name) {
      var e = byName[name];
      if (!e) return Promise.resolve(null);
      return inflate(e).then(function (b) { return new TextDecoder().decode(b); });
    }

    var book = { entries: entries, byName: byName, parts: {}, dirty: {} };
    return Promise.all([
      text('xl/workbook.xml'), text('xl/_rels/workbook.xml.rels'),
      text('xl/sharedStrings.xml'), text('xl/styles.xml')
    ]).then(function (r) {
      if (!r[0] || !r[1]) throw fail('not-xlsx');
      book.parts['xl/workbook.xml'] = r[0];
      var rels = {};
      r[1].replace(/<Relationship\b[^>]*>/g, function (tag) { var a = attrs(tag); rels[a.Id] = a.Target; });
      book.sheets = [];
      r[0].replace(/<sheet\b[^>]*>/g, function (tag) {
        var a = attrs(tag);
        var rid = a['r:id'] || a.id;
        if (rels[rid]) book.sheets.push({ name: a.name, state: a.state || 'visible', path: partPath('xl/', rels[rid]) });
      });
      book.sst = [];
      if (r[2]) {
        r[2].replace(/<si(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/si>)/g, function (_, inner) { book.sst.push(richText(inner)); });
      }
      book.dateStyles = dateStyles(r[3] || '');
      if (r[3]) book.parts['xl/styles.xml'] = r[3];   // 縮小して全体を表示を足すときに使う（使わなければ保存しても元のバイト列のまま）
      return Promise.all(book.sheets.map(function (s) {
        return text(s.path).then(function (x) {
          if (x == null) throw fail('broken-xlsx', s.path);
          book.parts[s.path] = x;
        });
      }));
    }).then(function () { return book; });
  }

  // 日付の書式を持つスタイル番号の集合。名簿の生年月日が Excel の日付（数値）で入っているとき、
  // それが日付だと分かるように使う。
  function dateStyles(stylesXml) {
    var builtin = {};
    [14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]
      .forEach(function (id) { builtin[id] = true; });
    var custom = {};
    stylesXml.replace(/<numFmt\b[^>]*>/g, function (tag) {
      var a = attrs(tag);
      var code = String(a.formatCode || '').replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '')
        .replace(/general/gi, '').replace(/E[+-]/gi, '');   // 指数表記の E を和暦の e と取り違えない
      // y d e g（和暦）があれば日付。m だけなら、時刻（h や s）と一緒でないときに限る
      if (/[ydeg]/i.test(code) || (/m/i.test(code) && !/[hs]/i.test(code))) custom[a.numFmtId] = true;
    });
    var set = {};
    var xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
    if (xfs) {
      var i = 0;
      xfs[1].replace(/<xf\b[^>]*>/g, function (tag) {
        var id = Number(attrs(tag).numFmtId || 0);
        if (builtin[id] || custom[id]) set[i] = true;
        i++;
      });
    }
    return set;
  }

  function sheetOf(book, sheet) {
    var s = typeof sheet === 'number' ? book.sheets[sheet]
      : book.sheets.filter(function (x) { return x.name === sheet; })[0];
    if (!s) throw fail('no-sheet', String(sheet));
    return s;
  }
  function sheetNames(book) { return book.sheets.map(function (s) { return s.name; }); }

  // ===== 読む =====
  var CELL_RE = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

  function sheetData(xml) {
    var m = /<sheetData\b[^>]*?(?:\/>|>([\s\S]*?)<\/sheetData>)/.exec(xml);
    return m ? (m[1] || '') : '';
  }

  // 値の入っているセルを並べる。{ ref, row, col, text, value, isDate, formula, style }
  function cells(book, sheet) {
    var s = sheetOf(book, sheet);
    var out = [];
    var re = new RegExp(CELL_RE.source, 'g'), m;
    var data = sheetData(book.parts[s.path]);
    while ((m = re.exec(data))) {
      var a = attrs('<c ' + m[1] + '>');
      var inner = m[2] || '';
      if (!a.r) continue;
      var v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      var raw = v ? decodeXml(v[1]) : '';
      var cell = { ref: a.r, text: '', value: null, isDate: false, formula: /<f\b/.test(inner), style: a.s || '' };
      var pr = parseRef(a.r); cell.row = pr.row; cell.col = pr.col;
      if (a.t === 's') cell.text = book.sst[Number(raw)] || '';
      else if (a.t === 'inlineStr') cell.text = richText((/<is>([\s\S]*?)<\/is>/.exec(inner) || [])[1]);
      else if (a.t === 'str' || a.t === 'e') cell.text = raw;
      else if (a.t === 'b') cell.text = raw === '1' ? 'TRUE' : 'FALSE';
      else if (raw !== '') {
        cell.value = Number(raw);
        cell.text = raw;
        cell.isDate = !!book.dateStyles[Number(a.s || 0)];
      }
      if (cell.text === '' && !cell.formula) continue;
      out.push(cell);
    }
    return out;
  }

  // 空のセルも含めて、シートに置かれているセルを並べる。{ ref, row, col, text, styled }
  // ★ cells() は値の入ったセルだけを返す。空の様式（罫線だけ引いてある記入欄）を読むには、
  //   空のセルの位置も要る（entry-blank.js が「書ける行」を数えるのに使う）。
  function grid(book, sheet) {
    var s = sheetOf(book, sheet);
    var texts = {};
    cells(book, sheet).forEach(function (c) { texts[c.ref] = c.text; });
    var out = [];
    var re = new RegExp(CELL_RE.source, 'g'), m;
    var data = sheetData(book.parts[s.path]);
    while ((m = re.exec(data))) {
      var a = attrs('<c ' + m[1] + '>');
      if (!a.r) continue;
      var pr = parseRef(a.r);
      out.push({ ref: a.r, row: pr.row, col: pr.col, text: texts[a.r] || '', styled: a.s !== undefined });
    }
    return out;
  }

  function merges(book, sheet) {
    var s = sheetOf(book, sheet);
    var out = [];
    book.parts[s.path].replace(/<mergeCell\b[^>]*>/g, function (tag) {
      var ref = attrs(tag).ref;
      if (!ref || ref.indexOf(':') < 0) return;
      var ab = ref.split(':'), p = parseRef(ab[0]), q = parseRef(ab[1]);
      out.push({ ref: ref, top: Math.min(p.row, q.row), left: Math.min(p.col, q.col),
                 bottom: Math.max(p.row, q.row), right: Math.max(p.col, q.col) });
    });
    return out;
  }

  // 結合セルの途中に書くと表示されない。左上に寄せる。
  function anchorOf(book, sheet, ref) {
    var p = parseRef(ref);
    var hit = merges(book, sheet).filter(function (g) {
      return p.row >= g.top && p.row <= g.bottom && p.col >= g.left && p.col <= g.right;
    })[0];
    return hit ? toRef(hit.left, hit.top) : toRef(p.col, p.row);
  }

  // ===== 書く =====
  // value: 数値 → 数値のセル／文字列 → 文字のセル（inlineStr）／null・'' → 空にする（書式は残す）
  // opts.shrink: true なら、そのセルの書式の写しに「縮小して全体を表示」を付けて使う（shrinkStyle）
  // 戻り値: { ok, ref, reason }。★ 式の入ったセルは上書きしない（reason: 'formula'）。
  function setCell(book, sheet, ref, value, opts) {
    var s = sheetOf(book, sheet);
    ref = anchorOf(book, sheet, ref);
    var pos = parseRef(ref);
    var xml = book.parts[s.path];
    var shrink = !!(opts && opts.shrink) && !(value === null || value === undefined || value === '');

    var cellRe = new RegExp('<c\\b(?=[^>]*\\sr="' + ref + '")([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/c>)');
    var hit = cellRe.exec(xml);
    var style = '';
    if (hit) {
      if (/<f\b/.test(hit[2] || '')) return { ok: false, ref: ref, reason: 'formula' };
      var a = attrs('<c ' + hit[1] + '>');
      style = a.s || '';
    }
    var build = function (st) {
      // ★ 数を、日付の書式が付いたセルに書かない（2026-09-18、本人が本物の申込書で発見）。
      //   年齢の欄のうち1つだけ日付の書式（yyyy-mm-dd）が付いていて、60 と書いたら Excel が
      //   「1900-02-29」と表示した。そのセルだけ、書式の写しを作って日付の書式を外す
      if (typeof value === 'number' && isFinite(value) && book.dateStyles && book.dateStyles[Number(st || 0)]) {
        st = plainNumberStyle(book, st);
      }
      if (shrink) st = shrinkStyle(book, st);
      var head = '<c r="' + ref + '"' + (st ? ' s="' + st + '"' : '');
      if (value === null || value === undefined || value === '') return head + '/>';
      if (typeof value === 'number' && isFinite(value)) return head + '><v>' + value + '</v></c>';
      return head + ' t="inlineStr"><is><t xml:space="preserve">' + encodeXml(value) + '</t></is></c>';
    };

    if (hit) {
      xml = xml.slice(0, hit.index) + build(style) + xml.slice(hit.index + hit[0].length);
    } else {
      xml = insertCell(xml, pos, function (inheritStyle) { return build(inheritStyle); });
    }
    book.parts[s.path] = xml;
    book.dirty[s.path] = true;
    return { ok: true, ref: ref };
  }

  // 日付の書式を外した書式の写しを作る（罫線・フォント・揃えはそのまま）。
  // 作り方は shrinkStyle と同じ決まり: 元の <xf> は書き換えず、cellXfs の末尾に足すだけ。
  function plainNumberStyle(book, st) {
    var made = cloneXf(book, st, 'numberMap', function (attrsPart) {
      return attrsPart.replace(/\s+numFmtId="[^"]*"/, '').replace(/\s+applyNumberFormat="[^"]*"/, '') +
        ' numFmtId="0" applyNumberFormat="1"';
    });
    if (made != null) book.dateStyles[Number(made)] = false;
    return made == null ? st : made;
  }

  // ===== 縮小して全体を表示 =====
  // Excel の書式は styles.xml の cellXfs に並んだ <xf> の番号でセルから指される。
  // 元の書式（罫線・フォント・揃え）を写した <xf> を末尾に足し、alignment に shrinkToFit="1" を付ける。
  // ★ 元の <xf> は書き換えない。同じ書式を使うほかのセル（見出しなど）まで縮小されてしまうため。
  // ★ styles.xml は「書き換えたセル以外は変えない」の例外。変わるのは cellXfs の末尾への追加と count だけ
  //   （run.js が確かめる）。同じ元の書式からの写しは1つだけ作る（book.shrinkMap）。
  // ★ wrapText（折り返して全体を表示）があると Excel は縮小しないので、写しからは外す。
  function shrinkStyle(book, st) {
    var made = cloneXf(book, st, 'shrinkMap',
      function (attrsPart) { return attrsPart.replace(/\s+applyAlignment="[^"]*"/, '') + ' applyAlignment="1"'; },
      function (inner) {
        if (/<alignment\b/.test(inner)) {
          return inner.replace(/<alignment\b([^>]*?)(\/?)>/, function (_, a, slash) {
            a = a.replace(/\s+shrinkToFit="[^"]*"/, '').replace(/\s+wrapText="[^"]*"/, '');
            return '<alignment' + a + ' shrinkToFit="1"' + slash + '>';
          });
        }
        return '<alignment shrinkToFit="1"/>' + inner;   // alignment は protection より前に置く決まり
      });
    return made == null ? st : made;
  }

  // 書式（<xf>）の写しを cellXfs の末尾に足して、その番号を返す。同じ元からの写しは1つだけ（book[mapName]）。
  // 書式の一覧が無いブック（まず無い）や、元の書式が見つからないときは null を返す（呼び元は元の書式のまま書く）。
  function cloneXf(book, st, mapName, fixAttrs, fixInner) {
    var path = 'xl/styles.xml';
    var xml = book.parts[path];
    if (!xml) return null;
    book[mapName] = book[mapName] || {};
    var key = st || '0';
    if (book[mapName][key] != null) return book[mapName][key];

    var block = /<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/.exec(xml);
    if (!block) return null;
    var xfs = block[2].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) || [];
    var base = xfs[Number(key)] || xfs[0];
    if (!base) return null;

    var open = /^<xf\b([^>]*?)(\/?)>/.exec(base);
    var attrsPart = fixAttrs ? fixAttrs(open[1]) : open[1];
    var inner = open[2] === '/' ? '' : base.slice(open[0].length, base.length - '</xf>'.length);
    if (fixInner) inner = fixInner(inner);
    var clone = inner ? '<xf' + attrsPart + '>' + inner + '</xf>' : '<xf' + attrsPart + '/>';

    var index = xfs.length;
    var head = block[1].replace(/\s+count="\d+"/, '') + ' count="' + (index + 1) + '"';
    var newBlock = '<cellXfs' + head + '>' + block[2] + clone + '</cellXfs>';
    book.parts[path] = xml.slice(0, block.index) + newBlock + xml.slice(block.index + block[0].length);
    book.dirty[path] = true;
    book[mapName][key] = String(index);
    return String(index);
  }

  // セルが無いところへ書くときは、列順を守って行に差し込む。書式は行か列の設定を引き継ぐ。
  function insertCell(xml, pos, build) {
    var rowRe = new RegExp('<row\\b(?=[^>]*\\sr="' + pos.row + '")([^>]*?)(\\/>|>([\\s\\S]*?)<\\/row>)');
    var rm = rowRe.exec(xml);
    if (rm) {
      var ra = attrs('<row ' + rm[1] + '>');
      var st = (ra.customFormat === '1' || ra.customFormat === 'true') ? ra.s : colStyle(xml, pos.col);
      var cellXml = build(st || '');
      var inner = rm[3] || '';
      var re = new RegExp(CELL_RE.source, 'g'), m, at = inner.length;
      while ((m = re.exec(inner))) {
        var r = attrs('<c ' + m[1] + '>').r;
        if (r && parseRef(r).col > pos.col) { at = m.index; break; }
      }
      var newInner = inner.slice(0, at) + cellXml + inner.slice(at);
      var openTag = '<row' + rm[1].replace(/\s*\/$/, '') + '>';
      return xml.slice(0, rm.index) + openTag + newInner + '</row>' + xml.slice(rm.index + rm[0].length);
    }
    // 行そのものが無い
    var rowXml = '<row r="' + pos.row + '">' + build(colStyle(xml, pos.col) || '') + '</row>';
    var sd = /<sheetData\b([^>]*?)(\/>|>([\s\S]*?)<\/sheetData>)/.exec(xml);
    if (!sd) throw fail('broken-xlsx', 'sheetData');
    var body = sd[3] || '';
    var rre = /<row\b([^>]*?)(?:\/>|>[\s\S]*?<\/row>)/g, rx, at2 = body.length;
    while ((rx = rre.exec(body))) {
      if (Number(attrs('<row ' + rx[1] + '>').r) > pos.row) { at2 = rx.index; break; }
    }
    var newBody = body.slice(0, at2) + rowXml + body.slice(at2);
    return xml.slice(0, sd.index) + '<sheetData' + sd[1].replace(/\s*\/$/, '') + '>' + newBody + '</sheetData>' +
      xml.slice(sd.index + sd[0].length);
  }

  function colStyle(xml, col) {
    var st = '';
    xml.replace(/<col\b[^>]*>/g, function (tag) {
      var a = attrs(tag);
      if (Number(a.min) <= col && col <= Number(a.max) && a.style) st = a.style;
    });
    return st;
  }

  // ===== 保存 =====
  function save(book) {
    var enc = new TextEncoder();
    var paths = Object.keys(book.dirty);
    // 式のあるブックは、開いたときに計算し直させる（年齢の合計などが古い値のまま見えるのを防ぐ）
    var wbPath = 'xl/workbook.xml';
    if (paths.length && book.sheets.some(function (s) { return /<f\b/.test(book.parts[s.path]); })) {
      var wb = book.parts[wbPath];
      if (!/fullCalcOnLoad="(1|true)"/.test(wb)) {
        if (/<calcPr\b/.test(wb)) wb = wb.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"');
        else {
          var at = wb.search(/<(oleSize|customWorkbookViews|pivotCaches|smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\b|<\/workbook>/);
          wb = wb.slice(0, at) + '<calcPr fullCalcOnLoad="1"/>' + wb.slice(at);
        }
        book.parts[wbPath] = wb;
        paths.push(wbPath);
      }
    }
    var changed = {};
    return Promise.all(paths.map(function (p) {
      var data = enc.encode(book.parts[p]);
      return deflate(data).then(function (raw) { changed[p] = { data: data, raw: raw }; });
    })).then(function () {
      var out = book.entries.map(function (e) {
        var c = changed[e.name];
        if (!c) return e;
        var n = {};
        for (var k in e) n[k] = e[k];
        n.method = 8; n.raw = c.raw; n.crc = crc32(c.data); n.usize = c.data.length;
        if (n.versionNeeded < 20) n.versionNeeded = 20;
        return n;
      });
      return writeZip(out);
    });
  }

  global.EntryXlsx = {
    open: open, sheetNames: sheetNames, cells: cells, grid: grid, merges: merges, anchorOf: anchorOf,
    setCell: setCell, save: save, parseRef: parseRef, toRef: toRef, shrinkStyle: shrinkStyle,
    // 試験用データを作るときにだけ使う
    zip: { read: readZip, write: writeZip, inflate: inflate, deflate: deflate, crc32: crc32 }
  };
})(typeof window !== 'undefined' ? window : this);
