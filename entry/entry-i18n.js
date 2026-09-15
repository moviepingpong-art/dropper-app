// entry-i18n.js — 申込書ドロッパーの辞書（window.I18N）
//
// ほかの3本の辞書とは別物（辞書を跨がせない決まり）。
// いまは日本語だけ。申込書の Excel・和暦・年齢区分は日本の事情が強く、en/in は作っていない。
// en/in を足すときは、同じキーを全部そろえ、tools/sync-check.js の GROUPS に entry を足すこと。
(function (global) {
  'use strict';

  var I18N = {
    ja: {
      pageTitle: '申込書ドロッパー（試作）｜名前を書いた申込書に、名簿から生年月日や住所を埋める',
      appName: '申込書ドロッパー',
      trialBadge: '試作中',
      lead: '大会の申込書に名前だけ書いて入れると、名簿から性別・生年月日・年齢・住所・電話番号を埋めて返します。',

      privTitle: '入れたものの扱い',
      priv1: '申込書も名簿も、この端末の中（ブラウザ）だけで扱います。当方はサーバーを持っていないため、受け取れません。',
      priv2: 'どこにも送りません。AI も使いません。どの欄に何を書くかは、申込書の見出し（「生年月日」「住所」など）から決めます。',
      priv3: '名簿はこの端末に覚えません。画面を閉じると消えます。',

      step1Title: '① 申込書を入れる',
      formDropTitle: '名前だけ書いた申込書（Excel）',
      formDropSub: 'ここにドラッグ、またはタップして選ぶ',
      formPick: 'ファイルを選ぶ',
      formNote: '大会事務局の Excel の申込書に、出る人の名前だけを書いてから入れてください。.xlsx だけ読めます。',

      step2Title: '② 名簿を入れる',
      rosterDropTitle: '団体の名簿（Excel か CSV）',
      rosterDropSub: 'ここにドラッグ、またはタップして選ぶ',
      rosterPick: 'ファイルを選ぶ',
      rosterNote: '1行目あたりに「氏名」「生年月日」などの見出しがある名簿を使えます。毎回入れてください（覚えません）。',

      step3Title: '③ 名前の確認',
      step3Hint: '申込書に書かれた名前を、名簿と突き合わせました。⚠ の人は選んでください。',
      namesNext: '次へ',

      // 画面の段は ①申込書 ②名簿 ③名前の確認 ④書き込む内容の確認 ⑤保存（2026-09-15 に AI の段を無くして振り直した）
      step5Title: '④ 書き込む内容の確認',
      step5Hint: 'この内容で申込書に書き込みます。値は名簿から作っています。どの欄に書くかは申込書の見出しから決めたので、表の見出しの下の小さな文字（申込書の見出し）が合っているかも見てください。直したいときは名簿を直して入れ直すか、保存したあと Excel で直してください。',
      step6Title: '⑤ 保存',
      saveBtn: '記入済みの申込書を保存',
      saveNote: '元の申込書は変わりません。書き込んだ写しを保存します。',

      reading: '読み込んでいます…',
      formOk: '「{name}」を読み込みました（シート{n}枚）。',
      rosterOk: '名簿を{n}人ぶん読み込みました。',
      rosterProblemsCount: 'うち{n}人は名簿に気になる点があります（下の「名簿の気になる点」）。',
      rosterProblemsTitle: '名簿の気になる点',
      rosterRow: '{row}行目 {name}',
      colHint: '名簿の列を次のように読みました。違っていれば選び直してください。',
      colNone: '（なし）',

      dateText: '{y}年{m}月{d}日生',
      noBirth: '生年月日なし',
      memberLabel: '{name}（{birth}）',
      sheetTitle: 'シート「{name}」',
      noNamesFound: '申込書に、名簿の人の名前が見つかりませんでした。名前を書いた申込書か、名簿の「氏名」の列が合っているかをご確認ください。',
      nameExact: '✅ 名簿と一致',
      nameVariant: '🔤 名簿の「{name}」として書きます（字の違いをそろえました）',
      nameAmbiguous: '👥 名簿に同じ名前が{n}人います。どの人か選んでください',
      nameSuspect: '❓ 名簿にありません。近い名前から選んでください',
      nameSuspectNoCand: '❓ 名簿にありません。名簿から選ぶか、「名前ではない」を選んでください',
      nameDuplicate: '⚠ {ref} と同じ人です',
      pickPlease: '選んでください',
      pickCandidates: '近い名前',
      pickAll: '名簿の全員',
      pickNotName: '名前ではない（何も書かない）',
      namesLeft: 'あと{n}人、選んでください。',
      namesReady: '全員そろいました。',

      formHeader: '申込書:「{text}」',

      baseDateLabel: '年齢の基準日',
      baseDateFrom: '申込書の記載：{raw}',
      baseDateNone: '申込書から基準日を読み取れませんでした。',
      baseDateNeeded: '⚠ 年齢を書くには基準日が要ります。入れてください。',
      fmtTitle: '書き方',
      birthAsk: '📅 申込書に生年月日の書き方の指示がありません。どちらで書きますか？',
      birthAskNeeded: '⚠ 西暦か和暦を選んでください（選ぶまで保存できません）。',
      'birthStyle.seirekiOne': '西暦（1950/4/1）',
      'birthStyle.warekiOne': '和暦（昭和25年4月1日）',
      'birthStyle.seirekiSplit': '西暦（年の欄に 1950。元号の欄は空）',
      'birthStyle.warekiSplit': '和暦（元号の欄に 昭和、年の欄に 25）',
      'birthStyleName.seireki': '西暦',
      'birthStyleName.wareki': '和暦',
      birthFollowsForm: '生年月日は、申込書の指示に合わせて{style}で書きます（下の「書き方」で変えられます）。',
      saveWaitBirth: '④で、生年月日を西暦で書くか和暦で書くかを選んでください。',
      shrinkLabel: 'セルに収まらない文字は、小さくして収める',
      shrinkNote: 'Excel の「縮小して全体を表示」を、書き込んだセルに付けます。収まる文字はそのままの大きさです。「折り返して全体を表示」になっている欄は折り返しを外します。Excel 以外のアプリでは効かないことがあります。',
      groupTitle: '合計年齢',
      groupSum: '{ref}：{ages} = {sum}',
      groupSumMissing: '{ref}：年齢が分からない人がいるので書きません',
      blankMark: '（空にする）',
      missMark: '書けません',
      notesTitle: '知らせること（{n}件）',
      noteWho: '：{list}（{n}人）',
      extras: '名簿から埋められない欄があります。保存したあと Excel で書いてください：{list}',

      'field.name': '氏名', 'field.family': '姓', 'field.given': '名', 'field.kana': 'フリガナ',
      'field.gender': '性別', 'field.genderMale': '男の欄', 'field.genderFemale': '女の欄',
      'field.birth': '生年月日', 'field.birthEra': '元号', 'field.birthYear': '生まれ年',
      'field.birthMonth': '生まれ月', 'field.birthDay': '生まれ日', 'field.age': '年齢',
      'field.postal': '郵便番号', 'field.address': '住所', 'field.addressPref': '都道府県',
      'field.addressRest': '住所（都道府県より後）', 'field.phone': '電話番号', 'field.ageSum': '合計年齢',

      'fmt.gender.kanji': '男／女', 'fmt.gender.full': '男性／女性',
      'fmt.birth.wareki': '昭和25年4月1日', 'fmt.birth.seireki-slash': '1950/4/1',
      'fmt.birth.seireki-kanji': '1950年4月1日', 'fmt.birth.wareki-short': 'S25.4.1',
      'fmt.birthEra.full': '昭和', 'fmt.birthEra.short': 'S', 'fmt.birthEra.none': '空にする（西暦）',
      'fmt.birthYear.wareki': '昭和25', 'fmt.birthYear.seireki': '1950',
      'fmt.birthYear.wareki-num': '25（元号は別の欄）', 'fmt.birthYear.wareki-short': 'S25',
      'fmt.address.plain': '住所だけ', 'fmt.address.with-postal': '〒から書く',

      'prob.birth-empty': '生年月日が空',
      'prob.birth-unreadable': '生年月日が読めない',
      'prob.gender-empty': '性別が空',
      'prob.gender-unreadable': '性別が読めない',
      'prob.phone-zero-restored': '電話番号の先頭の0が消えていたので戻した',

      'note.not-in-roster': 'は名簿に無いので書きません',
      'note.name-unsplit': 'は、名簿の氏名に空白が無く姓と名に分けられないので書きません',
      'note.gender-missing': 'は、名簿の性別が空か読めないので書きません',
      'note.birth-missing': 'は、名簿の生年月日が空か読めないので書きません',
      'note.base-date-missing': 'は、基準日が無いので書きません',
      'note.address-unsplit': 'は、住所から都道府県を切り分けられないので書きません',
      'note.unknown-field': 'は書き方が分からないので書きません',
      'note.age-differs': '{who}：名簿の年齢（{roster}歳）と、生年月日から計算した年齢（{computed}歳）が2歳以上違います。名簿の生年月日をご確認ください',
      'note.phone-zero-restored': '{who}：名簿の電話番号の先頭の0が消えていたので、0を付けて書きます',

      'skip.target-is-formula': '式の入ったセル',
      'skipGroup.name-outside-table': '欄の並びの外にある名前には、何も書きません：{refs}',
      'skipGroup.target-has-text': 'すでに文字が入っている欄には書きません（{fields}）：{refs}',
      'skipGroup.target-is-formula': '式の入ったセルには書きません（{fields}）：{refs}',
      'skipGroup.target-is-name': '名前の欄には書きません（{fields}）：{refs}',
      'skipGroup.offset-crosses-person': '⚠ {fields}の欄が、ほかの人の行にずれてしまうので書きません（{n}か所：{refs}）。申込書の見出しの読み取りがずれています。保存したあと Excel で書いてください',
      andMore: 'ほか{n}か所',

      'mapprob.unknown-field': '知らない欄の種類（{field}）があったので使いません',
      'mapprob.bad-position': '{field}の欄の位置が読めないので使いません',
      'mapprob.same-cell-twice': '同じ欄に2つの項目を書く答えだったので、{field}は使いません',
      'mapprob.table-no-name-col': '名前の列が読めない表がありました',
      'mapprob.table-bad-rows': '行の範囲が読めない表がありました',
      'mapprob.no-table': '申込書の見出しから、書く欄を決められませんでした。見出し（「生年月日」「住所」など）がある申込書かご確認ください',
      'mapprob.gender-mark-unpaired': '「男」「女」の列の片方しか見つかりませんでした。性別の印が片方だけになります',

      saveReady: '{n}か所に書き込みます。',
      saveNothing: '書き込むものがありません。',
      saving: '書き込んでいます…',
      fileSuffix: '_記入済み',
      saved: '「{name}」を保存しました（{n}か所に書き込み）。中身を Excel でご確認ください。',
      savedFailed: '書けなかった欄：{list}',

      'err.xls-or-password': '古い形式（.xls）か、パスワード付きのファイルは読めません。Excel で「.xlsx」として保存し直してから入れてください。',
      'err.not-xlsx': 'Excel のファイル（.xlsx）として読めませんでした。',
      'err.zip64': 'ファイルが大きすぎて読めません。',
      'err.encrypted': 'パスワード付きのファイルは読めません。',
      'err.broken-zip': 'ファイルが壊れているようで読めません。',
      'err.broken-xlsx': 'ファイルが壊れているようで読めません。',
      'err.zip-method': 'このファイルの保存形式には対応していません。Excel で保存し直してから入れてください。',
      'err.no-sheet': 'シートが見つかりません。',
      'err.bad-ref': 'セルの番地が読めませんでした。',
      'err.no-header': '名簿の見出し（「氏名」「生年月日」など）が見つかりません。見出しの行がある名簿を使ってください。',
      'err.no-name-col': '「氏名」の列か、「姓」と「名」の列を選んでください。',
      'err.other': 'うまくいきませんでした（{code}）。'

    }
  };

  function dict() { return I18N[global.LANG] || I18N.ja; }
  function t(key, vars) {
    var s = dict()[key];
    if (s == null) s = I18N.ja[key];
    if (s == null) return key;
    return String(s).replace(/\{(\w+)\}/g, function (_, k) { return (vars && vars[k] != null) ? vars[k] : ''; });
  }
  // data-i18n 属性を持つ要素に文言を流し込む。data-i18n-attr があればその属性に、なければテキストに。
  function applyDom() {
    document.title = t('pageTitle');
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) {
      var key = els[i].getAttribute('data-i18n');
      var attr = els[i].getAttribute('data-i18n-attr');
      if (attr) els[i].setAttribute(attr, t(key));
      else els[i].textContent = t(key);
    }
  }

  global.I18N = { t: t, dict: dict, applyDom: applyDom };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { try { applyDom(); } catch (e) {} });
  } else {
    try { applyDom(); } catch (e) {}
  }
})(window);
