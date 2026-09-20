// entry-rules.js — 申込書の見出しの語から「欄の対応」を作る（AI を使わない）
//
// window.EntryRules = { map(cells, merges, found) } を公開する。
// 戻り値は EntryMap.normalize にそのまま渡せる形:
//   { baseDateRaw, tables: [{ nameCol | familyCol+givenCol, firstRow, lastRow, headerRow, pairSize, ageSumCol,
//                             fields: [{ field, col, rowOffset, fmt, mark, header }],
//                             cols: [{ col, header, field | null }] }], extras }
//   cols は④の「申込書の列 → 書くもの」の一覧（見出しのある列すべて。本人が選び直す）。
//   headerRow は表の鍵（EntryMap.tableKey）に使う。名前を書いた行に左右されないこと
//
// 考え方（日本の申込書によくある表の形を想定。特定の申込書に合わせて作らない）:
//   1. 名前の位置は、名簿との突き合わせで分かっている（EntryRoster.findNames）。
//      名前の列ごとに表とみなす。★ 同じ列でも、名前と名前の間に名前でない文字（「氏名」などの見出し）があれば表を分ける
//      （スポレク参加申込書は、B列に「連絡責任者」と「選手」の表が上下に並ぶ。分けないと選手の生年月日・年齢を見落とした）
//   2. 各列について、表の最初の名前の行より上（最大4行、上の表の最後の行まで）を下から上へ見て、見出しの文字を集める
//      （結合セルは左上の文字）
//   3. いちばん近い見出しから順に、語で欄の種類を決める（「年」「月」「日」は、上に「生年月日」があるときだけ）
//   4. 書き方は、見出しの記入例（例：1965/1/23 など）や「西暦」から決める。無ければ既定（和暦）。
//      生年月日に指示が無いときは、画面（entry-app.js）で本人に西暦か和暦かを聞く
//   5. 合計年齢は、見出しに「合計」と「年齢」があり、名前の行をまたいで縦に結合されていれば組とみなす
//   6. 基準日は、シートのどこかにある「〜現在」「〜時点」「年齢の基準は〜」の日付（申込日などは拾わない）
//
// ★ 知らない言い回しの見出しは、その欄を書かない（見落とし）。書く欄の種類を推測で広げないこと。
//   見落としは⑤で「名簿から埋められない欄」として見えるが、誤爆（「年齢区分」に年齢を書くなど）は気づきにくい。
//   ⑤には各欄の見出しの文字を並べ、読み違いに気づけるようにしてある。
//
// 測った結果（2026-09-15、entry/test/run.js の 7）:
//   自作の様式3つ・本物の百万石2シート・本物のスポレク3シートで全欄正解。
//   見出しの書き方を変えた7通りでは、見落とし1（「男・女」の1列）、誤爆0。
//   ★ 2026-09-20 まで、見落とし2（満年齢）と誤爆1（年齢区分 → 年齢）があった。年齢の見出しを作り直して消えた。
(function (global) {
  'use strict';

  var HEADER_ROWS_ABOVE = 4;
  // ★ 名前の列そのものに印刷される「ふりがな」の札。名前の行と交互に並ぶ様式がある
  //   （2026-09-20、本物の武蔵野市の様式）。entry-blank.js にも同じものがある
  var KANA_LABEL_RE = /^(フリガナ|ふりがな|カナ|かな|ヨミ|よみ|読み|読み方)$/;
  // ★ 見出しのすぐ下に書き方の見本を置く様式がある（entry-blank.js にも同じものがある）
  var EXAMPLE_RE = /記入例|記載例|見本|例示/;

  function nfkc(s) { s = s == null ? '' : String(s); try { s = s.normalize('NFKC'); } catch (e) {} return s; }
  function squash(s) { return nfkc(s).replace(/\s+/g, ''); }
  function isNumberOnly(t) { return /^[#№Nn]?[oO]?\.?\s*\d+[.)）]?$/.test(t) && /\d/.test(t); }
  function colToNum(l) { var n = 0; for (var i = 0; i < l.length; i++) n = n * 26 + (l.charCodeAt(i) - 64); return n; }
  function numToCol(n) { var s = ''; while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }

  function map(cells, merges, found) {
    var at = {};
    cells.forEach(function (c) { at[c.row + ':' + c.col] = c; });
    function mergeOf(row, col) {
      for (var i = 0; i < merges.length; i++) {
        var m = merges[i];
        if (row >= m.top && row <= m.bottom && col >= m.left && col <= m.right) return m;
      }
      return null;
    }
    // (row, col) に見えている文字。結合セルの途中なら左上の文字
    function textAt(row, col) {
      var m = mergeOf(row, col);
      var c = m ? at[m.top + ':' + m.left] : at[row + ':' + col];
      return c && !c.formula ? squash(c.text) : '';
    }

    var maxCol = cells.reduce(function (n, c) { return Math.max(n, c.col); }, 1);

    // その行が書き方の見本の行か（名前の列より左にある札を見る。entry-blank.js と同じ見方）
    function isExampleRow(row, nameCol) {
      for (var c = 1; c < nameCol; c++) {
        var t = textAt(row, c);
        if (t && EXAMPLE_RE.test(nfkc(t))) return true;
      }
      return false;
    }

    var people = found.names.concat(found.suspects);
    var nameRefs = {};
    people.forEach(function (n) { n.refs.forEach(function (r) { nameRefs[r] = true; }); });

    // 1. 名前の列ごとに表を作り、間に見出しがあれば分ける
    var byCol = {};
    people.forEach(function (n) {
      var letters = n.refs.map(function (r) { return /^[A-Z]+/.exec(r)[0]; });
      var key = letters.join('+');
      if (!byCol[key]) byCol[key] = { letters: letters, rows: [] };
      byCol[key].rows.push(n.row);
    });
    var groups = [];
    Object.keys(byCol).forEach(function (key) {
      var g = byCol[key];
      var col = colToNum(g.letters[0]);
      var rows = g.rows.slice().sort(function (a, b) { return a - b; });
      var cur = [rows[0]], prevLast = 0;
      for (var i = 1; i < rows.length; i++) {
        var between = false;
        for (var r = rows[i - 1] + 1; r < rows[i]; r++) {
          var tx = textAt(r, col);
          // ★ 名前の列に「フリガナ」と印刷してある様式がある（2026-09-20、本物の武蔵野市）。
          //   ふりがな欄を名前の上に置く作りで、名前の行と交互に並ぶ。表の切れ目と見なさない
          if (tx && KANA_LABEL_RE.test(nfkc(tx).replace(/\s/g, ''))) continue;
          if (tx && !nameRefs[numToCol(col) + r]) { between = true; break; }
        }
        if (between) {
          groups.push({ letters: g.letters, rows: cur, above: prevLast });
          prevLast = cur[cur.length - 1];
          cur = [];
        }
        cur.push(rows[i]);
      }
      groups.push({ letters: g.letters, rows: cur, above: prevLast });
    });

    // ★ 左右に並ぶ表を分ける（2026-09-20、本物の神奈川県の様式5シートで発覚）。
    //   シングルスとダブルスが左右に並ぶ様式があり、どちらの表も**シート全部の列**を見ていたため、
    //   別の表の列を抱え、シングルスをダブルス側の結合を見て「2人1組」と誤認していた。
    //
    //   分ける手がかり: **両方の表が同じ見出しの並びを繰り返している**。
    //   （種目・氏名・所属・年令 ／ 種目・氏名・所属・合計年令）
    //   だから「自分より左にもある語」が名前の列より右に再び出てきたら、そこが次の表の始まり。
    //   ★ 行が重なる表が1つしかなければ、左右の境は付けない（今までと同じ動き）。
    //     百万石・スポレク・自作の様式を壊さないための歯止め
    function headerWordAt(hr, col) {
      var t = nfkc(textAt(hr, col) || '').replace(/\s/g, '');
      return t && !isNumberOnly(t) ? t : '';
    }
    function nameHeaderRow(firstRow, col) {
      for (var r = firstRow - 1; r >= Math.max(1, firstRow - 12); r--) {
        if (headerWordAt(r, col)) return r;
      }
      return 0;
    }
    function limitsFor(g, firstRow, lastRow, nameCol) {
      // 行が重なる表の名前の列を、左から順に並べる（重ならない＝上下に並ぶ表は関係ない）
      var cols = [];
      groups.forEach(function (o) {
        var oFirst = o.rows[0], oLast = o.rows[o.rows.length - 1];
        if (oLast < firstRow || oFirst > lastRow) return;
        var c = colToNum(o.letters[0]);
        if (cols.indexOf(c) < 0) cols.push(c);
      });
      cols.sort(function (a, b) { return a - b; });
      if (cols.length < 2) return { left: 1, right: maxCol };   // 今までどおり
      var hr = nameHeaderRow(firstRow, nameCol);
      if (!hr) return { left: 1, right: maxCol };

      // ★ 左から順に区切る。左の境は「前の表の右端の次」。
      //   右の境は「自分より左にもある見出しの語が、また出てきた所の手前」
      var left = 1;
      for (var i = 0; i < cols.length; i++) {
        var here = cols[i];
        var right = maxCol;
        if (i + 1 < cols.length) {
          var next = cols[i + 1];
          var mine = {};
          for (var c1 = left; c1 < here; c1++) { var w1 = headerWordAt(hr, c1); if (w1) mine[w1] = true; }
          right = next - 1;
          for (var c2 = next - 1; c2 > here; c2--) {
            var w2 = headerWordAt(hr, c2);
            if (w2 && mine[w2]) right = c2 - 1;
          }
        }
        if (here === nameCol) return { left: left, right: right };
        left = right + 1;
      }
      return { left: 1, right: maxCol };
    }

    var tables = [], extras = [], extraCols = {};
    groups.forEach(function (g) {
      var firstRow = g.rows[0], lastRow = g.rows[g.rows.length - 1];
      var nameCols = g.letters.map(colToNum);
      var limits = limitsFor(g, firstRow, lastRow, nameCols[0]);
      // 名前の欄が横に結合されていれば、その右端までを名前の欄とみなす
      var nameRight = Math.max.apply(null, nameCols.map(function (c) {
        var m = mergeOf(firstRow, c); return m ? m.right : c;
      }));
      // ★ 名前の行より上に、まだ名前を書いていない記入行が続くことがある（20人枠の下の方だけに書いた、など）。
      //   名前の欄が空で、ほかに数字以外の文字が無い行は記入行とみなし、その上から見出しを探す。
      //   こうしないと、見出しが遠くて見つからないうえ、書き始めの行によって表の鍵（見出しの行）が変わり、
      //   本人の直しが効かなくなる（2026-09-15、2行目から書いた様式Aで表の鍵が変わった）
      var dataTop = firstRow;
      for (var rr = firstRow - 1; rr > g.above && rr >= firstRow - 60; rr--) {
        if (textAt(rr, nameCols[0])) break;
        var wordy = false;
        for (var cc = 1; cc <= maxCol; cc++) {
          var tx = textAt(rr, cc);
          if (tx && !isNumberOnly(tx)) { wordy = true; break; }
        }
        if (wordy) break;
        dataTop = rr;
      }
      var top = Math.max(1, dataTop - HEADER_ROWS_ABOVE, g.above + 1);

      // 2. 列ごとの見出し（近い順）。いちばん近い見出しの行も覚える（表の見分けに使う）
      // ★ 数字だけの文字（No. の列の 1・2・3 など）は見出しと見なさない
      var headerRow = 0;
      function chain(col) {
        var out = [];
        for (var r = dataTop - 1; r >= top; r--) {
          // ★ 見出しのすぐ下に「入力見本」を置く様式がある（2026-09-20、本物の東京都卓球連盟）。
          //   見本の行を飛ばさないと、**見本の値（「トウキョウタロウ」など）が見出しとして読まれ**、
          //   その列の種類が決まらなくなる。entry-blank.js の表さがしと同じ知識がここにも要る
          if (isExampleRow(r, nameCols[0])) continue;
          var t = textAt(r, col);
          if (t && isNumberOnly(t)) continue;
          if (t && out[out.length - 1] !== t) {
            if (!out.length) headerRow = Math.max(headerRow, r);
            out.push(t);
          }
        }
        return out;
      }
      var cols = [];
      for (var col = limits.left; col <= limits.right; col++) {
        if (nameCols.indexOf(col) >= 0 || (col > nameCols[0] && col <= nameRight)) continue;
        var m0 = mergeOf(firstRow, col);
        if (m0 && m0.left !== col) continue;   // 横に結合された欄の途中の列は、左上の列で扱う
        var ch = chain(col);
        if (ch.length) cols.push({ col: col, chain: ch });
      }

      // 3. 語で欄の種類を決める
      var hasBirthParent = function (ch) { return ch.some(function (t) { return /生年月日|誕生日|生まれ/.test(t); }); };
      var fields = [], ageSum = null, event = null, undecided = [];
      cols.forEach(function (c) {
        var near = c.chain[0], all = c.chain.join('|');
        var f = null;
        // ★ 「チーム名(カナ)」を人のフリガナと読んではいけない（2026-09-20、本物の東京都卓球連盟）。
        //   団体の名前の読みを書く欄に、人のセイ・メイを書いてしまう（誤爆）
        if (/フリガナ|ふりがな|カナ|よみ/.test(near) && !/チーム|団体|学校|所属|クラブ|会社|部名/.test(near)) f = 'kana';
        else if (/^男(性)?$/.test(near)) f = 'genderMale';
        else if (/^女(性)?$/.test(near)) f = 'genderFemale';
        else if (/性別|男女/.test(near)) f = 'gender';
        // ★「年令」（齢ではなく令）と書く様式がある。単独の「年令」は下で見ているのに、
        //   合計のほうだけ抜けていた（2026-09-20、本物の神奈川県の様式5シートで発覚）
        else if (/合計/.test(all) && /年[齢令]/.test(all)) f = 'ageSum';
        // ★ ダブルスの種目（男子／女子／混合）。組ごとに1つ書く欄（2026-09-18、本人の要望）
        else if (/^(種目|参加種目|種別)$/.test(near)) f = 'event';
        // ★ 年齢の見出し（2026-09-20 に作り直した）。前は「年齢で始まる」だけを見ていて、
        //   **外すべきものに当たり、当てるべきものを外していた**——
        //   「年齢区分」「年齢制限」に年齢を書き（誤爆）、「大会年齢」「満年齢」を見落としていた。
        //   いまは「年齢／年令を含む。ただし区分・制限など“くくり”を表す語が続くものは除く」。
        //   ★ 合計年齢は手前の ageSum で拾うので、ここには来ない
        else if (/年[齢令]/.test(near) && !/年[齢令]\s*(区分|制限|層|別|順|区切)/.test(near)) f = 'age';
        else if (/郵便|〒/.test(near)) f = 'postal';
        else if (/都道府県/.test(near)) f = 'addressPref';
        else if (/住所|所在地/.test(near)) f = 'address';
        else if (/電話|TEL|携帯|連絡先/i.test(near)) f = 'phone';
        else if (hasBirthParent(c.chain)) {
          if (/^(元号|和暦)$/.test(near)) f = 'birthEra';
          else if (/^年$/.test(near)) f = 'birthYear';
          else if (/^月$/.test(near)) f = 'birthMonth';
          else if (/^日$/.test(near)) f = 'birthDay';
          else if (/生年月日|誕生日|生まれ/.test(near)) f = 'birth-or-era';   // 下で決める
        }
        if (!f) {
          // 名簿から埋められない欄（見出しが表の中にあるものだけ）。④の一覧には「決められなかった列」として出す
          // ★ 名前の行すべてに文字が印刷済みの列（No. の番号など）は、何も書けないので出さない
          //   （出すと、どの申込書でも毎回「決められなかった列」の警告が出る）
          var prefilled = g.rows.every(function (r) { return !!textAt(r, c.col); });
          if (!prefilled && !/申込|記入/.test(near)) {
            undecided.push({ col: numToCol(c.col), header: c.chain.slice().reverse().join(' / '),
                             near: near, field: null });
            if (!extraCols[c.col]) { extraCols[c.col] = true; extras.push({ col: numToCol(c.col), label: near }); }
          }
          return;
        }
        if (f === 'ageSum') { ageSum = c; return; }
        if (f === 'event') { event = c; return; }
        fields.push({ field: f, col: numToCol(c.col), rowOffset: 0, chain: c.chain,
                     header: c.chain.slice().reverse().join(' / '), near: near });
      });

      // 「生年月日」の見出しだけの列: 同じ見出しの下に年の列があれば元号の欄、無ければ1欄の生年月日
      var hasYear = fields.some(function (f) { return f.field === 'birthYear'; });
      fields.forEach(function (f) { if (f.field === 'birth-or-era') f.field = hasYear ? 'birthEra' : 'birth'; });
      // 住所が2列（都道府県＋住所）なら、住所は都道府県より後ろの欄
      if (fields.some(function (f) { return f.field === 'addressPref'; })) {
        fields.forEach(function (f) { if (f.field === 'address') f.field = 'addressRest'; });
      }

      // 4. 書き方
      var allHeaderText = cols.map(function (c) { return c.chain.join('|'); }).join('|');
      var hasEra = fields.some(function (x) { return x.field === 'birthEra'; });
      fields.forEach(function (f) {
        var ch = f.chain.join('|');
        if (f.field === 'birth') {
          if (/例.*\d{4}\/\d{1,2}\/\d{1,2}/.test(ch)) f.fmt = 'seireki-slash';
          else if (/例.*\d{4}年\d{1,2}月\d{1,2}日/.test(ch)) f.fmt = 'seireki-kanji';
          else if (/例.*[MTSHR]\d{1,2}\.\d{1,2}\.\d{1,2}/i.test(ch)) f.fmt = 'wareki-short';
          else if (/西暦/.test(ch)) f.fmt = 'seireki-slash';
          else f.fmt = 'wareki';
        } else if (f.field === 'birthYear') {
          f.fmt = hasEra ? 'wareki-num' : /西暦/.test(ch) ? 'seireki' : 'wareki';
        } else if (f.field === 'birthEra') {
          f.fmt = /例.*[MTSHR]\d/i.test(allHeaderText) ? 'short' : 'full';
        } else if (f.field === 'gender') {
          f.fmt = /男性|女性/.test(ch) ? 'full' : 'kanji';
        } else if (f.field === 'address') {
          f.fmt = /〒|郵便/.test(ch) ? 'with-postal' : 'plain';
        } else if (f.field === 'genderMale' || f.field === 'genderFemale') {
          f.mark = '○';
        }
        delete f.chain;
      });

      // 5. 組（ダブルス）: 合計年齢や種目の欄が名前の行で縦に結合されていれば、その行数で組を作る
      var pairSize = 1, ageSumCol = '', eventCol = '';
      if (ageSum) {
        var m = mergeOf(firstRow, ageSum.col);
        if (m && m.bottom > m.top) { pairSize = m.bottom - m.top + 1; ageSumCol = numToCol(ageSum.col); }
      }
      if (event) {
        var me = mergeOf(firstRow, event.col);
        if (me && me.bottom > me.top) {
          eventCol = numToCol(event.col);
          if (pairSize === 1) pairSize = me.bottom - me.top + 1;
        } else if (pairSize > 1) {
          eventCol = numToCol(event.col);   // 合計年齢で組が分かっていれば、結合していなくても組ごとに書く
        }
      }

      // ④の「申込書の列 → 書くもの」の一覧。見出しのある列をすべて、列の順に並べる（合計年齢の列は組の決まりで扱うので出さない）
      var colList = fields.map(function (f) { return { col: f.col, header: f.header, near: f.near, field: f.field }; })
        .concat(undecided)
        .sort(function (a, b) { return colToNum(a.col) - colToNum(b.col); });

      var tb = { firstRow: firstRow, lastRow: lastRow, headerRow: headerRow, pairSize: pairSize,
                 ageSumCol: ageSumCol, ageSumRowOffset: 0, eventCol: eventCol, eventRowOffset: 0,
                 fields: fields, cols: colList };
      if (g.letters.length === 2) { tb.nameCol = ''; tb.familyCol = g.letters[0]; tb.givenCol = g.letters[1]; }
      else tb.nameCol = g.letters[0];
      tables.push(tb);
    });

    // 6b. 年齢区分の説明（「合計年齢（① 119歳以下・② 120〜134歳・③ 135〜149歳・④ 150歳以上）」）
    // ★ 申込書に書かれている区分をそのまま読む。こちらで区分を決め打ちしない（大会ごとに違う）
    var ageClassesRaw = '';
    cells.forEach(function (c) {
      // ★ ここは nfkc を通さない。「①」が「1」になって、区分の目印が消える（2026-09-19）
      var t = String(c.text == null ? '' : c.text);
      if (ageClassesRaw || !/歳(以下|以上|未満)/.test(t)) return;
      var marks = t.match(/[①-⑳]|\(\s*\d+\s*\)|\d+\s*[.．)]/g) || [];
      if (marks.length >= 2) ageClassesRaw = t.trim();
    });

    // 6c. 参加料の単価（「5,000×　　＝」「参加料：団体3,000円×（　）チーム＝合計（　）円」）
    // ★ 計算して見せるだけ。申込書には書かない（書く場所は様式ごとに違い、文の途中の空欄のこともある）
    // ★ 「参加料」の語と単価が別のセルに分かれている様式がある（百万石は B「参加料は…」・H「3,000×　＝」）。
    //   シートのどこかに「参加料」の語があれば、「数×」の形のセルを単価とみなす（2026-09-19）
    var feeRaw = '';
    var feeWord = cells.some(function (c) { return /(参加料|参加費|申込料)/.test(String(c.text || '')); });
    cells.forEach(function (c) {
      var t = String(c.text == null ? '' : c.text);
      if (feeRaw || !/[×✕xX]/.test(t) || !/\d[\d,]{2,}/.test(t)) return;
      if (feeWord || /円/.test(t)) feeRaw = t.trim();
    });

    // 6. 基準日
    var baseDateRaw = '';
    var dateLike = /(明治|大正|昭和|平成|令和|[MTSHR])?\s*\d{1,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}/;
    cells.forEach(function (c) {
      var t = nfkc(c.text);
      // ★「〜現在」「〜時点」のほか、「年齢の基準は、令和9年4月1日とする」の形もある（かほく市長杯、2026-09-18）
      if (!baseDateRaw && /(現在|時点|基準)/.test(t) && dateLike.test(t)) baseDateRaw = t.trim();
    });

    return { baseDateRaw: baseDateRaw, ageClassesRaw: ageClassesRaw, feeRaw: feeRaw, tables: tables, extras: extras };
  }

  global.EntryRules = { map: map };
})(typeof window !== 'undefined' ? window : this);
