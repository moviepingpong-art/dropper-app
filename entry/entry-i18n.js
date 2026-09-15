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
      priv2: 'AI（あなたのキーで動く Gemini）に送るのは、名前を〔氏名1〕のように伏せた申込書の文字だけです。名簿の中身は送りません。送る前に、送る内容をお見せします。',
      priv3: '名簿はこの端末に覚えません。画面を閉じると消えます。',
      priv4: '⚠️ 無料枠では、送信内容（名前を伏せた申込書の文字）がGoogleのサービス改善に利用される場合があります。',

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

      step4Title: '④ どの欄に何を書くか',
      step5Title: '⑤ 書き込む内容の確認',
      step5Hint: 'この内容で申込書に書き込みます。値は名簿から作っています。直したいときは名簿を直して入れ直すか、保存したあと Excel で直してください。',
      step6Title: '⑥ 保存',
      saveBtn: '記入済みの申込書を保存',
      saveNote: '元の申込書は変わりません。書き込んだ写しを保存します。',
      keyChange: 'APIキーを変更',

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

      mapIntro: 'はじめて使う申込書です。どの欄に何を書くかを AI に決めてもらいます。送るのは下の内容だけで、名前は伏せてあります。',
      mapPreview: 'AI に送る内容を見る（{n}セル）',
      mapMerges: '結合セル:',
      mapSend: 'この内容を AI に送る',
      mapCached: '✅ 前に使った申込書です。保存してある欄の対応を使います（AI には送りません）。',
      mapDone: '✅ 欄の対応ができました。次に同じ申込書を使うときは、AI に送らずに済みます。',
      mapAskAgain: 'AI にもう一度聞き直す',
      'status.queued': '順番を待っています…',
      'status.running': 'AI が申込書を読んでいます…',
      'status.retry': '別の AI で聞き直しています…',
      'status.fallback': '混み合っているので、別の AI で聞き直しています…',

      baseDateLabel: '年齢の基準日',
      baseDateFrom: '申込書の記載：{raw}',
      baseDateNone: '申込書から基準日を読み取れませんでした。',
      baseDateNeeded: '⚠ 年齢を書くには基準日が要ります。入れてください。',
      fmtTitle: '書き方',
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
      'fmt.birthEra.full': '昭和', 'fmt.birthEra.short': 'S',
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
      'skipGroup.offset-crosses-person': '⚠ {fields}の欄が、ほかの人の行にずれてしまうので書きません（{n}か所：{refs}）。AI の答えが1行ずれています。「AI にもう一度聞き直す」を押してください',
      andMore: 'ほか{n}か所',

      'mapprob.base-date-differs': '基準日は、AI の答え（{ai}）ではなく申込書の記載「{raw}」を使います',
      'mapprob.unknown-field': 'AI が知らない欄の種類（{field}）を答えたので使いません',
      'mapprob.bad-position': 'AI の答えの{field}の欄の位置が読めないので使いません',
      'mapprob.same-cell-twice': '同じ欄に2つの項目を書く答えだったので、{field}は使いません',
      'mapprob.table-no-name-col': 'AI の答えに、名前の列が読めない表がありました',
      'mapprob.table-bad-rows': 'AI の答えに、行の範囲が読めない表がありました',
      'mapprob.no-table': 'AI が欄の対応を作れませんでした。AI にもう一度聞き直してください',
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
      'err.name-leak': '送る内容に名前が残っていたので、AI に送るのを止めました。申込書の名前以外の欄に名前が書かれていないかご確認ください。',
      'err.no-key': 'AI に送るには APIキーが要ります。',
      'err.no-roster': '名簿を入れてください。',
      'err.rate-minute': '1分あたりの利用上限に達しました。1分ほど待ってから、もう一度押してください。',
      'err.rate-day': '本日の利用上限に達しました。明日もう一度お試しください。',
      'err.busy': 'AI が混み合っています。少し待ってから、もう一度押してください。',
      'err.model-unavailable': 'AI のモデルが使えなくなっています。ツールの側の直しが必要です。',
      'err.bad-json': 'AI の答えが読めませんでした。もう一度押してください。',
      'err.too-many-cells': 'シートが大きすぎます。申込書のシートかご確認ください。',
      'err.http': 'AI に送れませんでした（HTTP {code}）。',
      'err.other': 'うまくいきませんでした（{code}）。',

      keyTitle: '🔑 Gemini APIキーの設定',
      keyNote: 'AIで読み取るには、ご自身のGemini APIキーが必要です。Googleアカウントがあれば無料で取得できます（3分ほど）。クレジットカードの登録は求められません。',
      keyStepsTitle: '取得のしかた',
      keyStep1: '下のリンクから Google AI Studio を開く',
      keyStep2: 'Googleアカウントでログインする',
      keyStep3: '「APIキーを作成」をクリックする',
      keyStep4: 'できたキーをコピーして、下の欄に貼り付ける',
      keyStudioLink: 'Google AI Studio を開く ↗',
      keyLabel: '🔑 APIキー',
      keyShow: '入力したキーを表示する',
      keyHide: '入力したキーを隠す',
      keyTestRunning: '接続を確認しています…',
      keyTestOk: '✓ 正常に接続できました（モデル: {model}）',
      keyTestInvalid: '✕ このキーでは接続できませんでした。コピー漏れがないかご確認ください。',
      keyTestForbidden: '✕ このキーでは Gemini API が使えない設定になっています。AI Studio で作り直してください。',
      keyTestQuota: '△ 本日の利用上限に達しているようです。キーはこのまま保存できます。',
      keyTestNetwork: '△ 接続を確認できませんでした（通信環境をご確認ください）。このまま保存もできます。',
      keyTestOther: '△ 接続を確認できませんでした。このまま保存もできます。',
      keyTrustTitle: '🔒 入力したキーの扱い',
      keyTrust1: '保存先は、お使いの端末の中（ブラウザ）だけです。他の端末には同期されません。',
      keyTrust2: '当方はサーバーを持っていないため、キーも読み取った内容も受け取れません。',
      keyTrust3: '送信先は Google の Gemini API だけです。やめたいときは Google AI Studio でキーを削除すれば、その場で無効になります。',
      keyMoreLink: 'クレカ不要で0円な理由・安全性の詳しい説明 ↗',
      keyCancel: 'キャンセル',
      keySave: '保存して使う',
      keyFoot: '🔒 キーはお使いの端末内（ブラウザ）だけに保存され、当方のサーバーには送信も保存もしません。'
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
