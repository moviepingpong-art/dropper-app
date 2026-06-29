// i18n.js — カレンダードロッパーの多言語辞書
// 各言語版ページは、このファイルを読み込んだ上で window.LANG を 'ja' / 'en' / 'in' のいずれかに設定する。
// 文言を増やすときは、全言語に同じキーを足すこと。
(function (global) {
  'use strict';

  var I18N = {
    ja: {
      // --- ページ全体 ---
      pageTitle: 'カレンダードロッパー',
      appName: 'カレンダードロッパー',
      // --- ヘッダー（種類セレクタ＝サブタイトル、リード文） ---
      // 種類ごとのサブタイトル・リード文は app.js の DROPPER_TYPES が辞書キーで参照する
      typeSports: 'スポーツ大会の要項ドロッパー',
      leadSports: '要項（PDF・画像）をドロップ → 内容を確認 → Googleカレンダーに登録',
      // --- ログイン ---
      loginBtn: 'Googleでログイン',
      loginNote: '大会の予定をGoogleカレンダーに登録するため、最初にGoogleログインとカレンダー・ドライブの許可が必要です。',
      // --- 競技セレクタ ---
      sportLabel: '競技：',
      sportAuto: '自動判定（おまかせ）',
      // --- ドロップゾーン ---
      dropTitle: 'ここに要項ファイルをドラッグ&ドロップ',
      dropSub: 'PDF・画像（JPEG/PNG）対応。複数ファイルをまとめてドロップもOK。',
      pickBtn: 'ファイルを選ぶ',
      // --- 注意書き ---
      note: '※読み取りはGoogleのOCRで変換して必要項目を抽出します。要項はGoogleドライブのDropperFilesフォルダに保存され、カレンダーの予定に添付（リンクが保存）されます。',
      // --- 登録ボタン ---
      registerBtn: 'Googleカレンダーに登録',
      // --- メッセージ（ログイン・読み込み） ---
      msgSigningIn: 'Googleにログインしています…',
      msgLoginFailed: 'ログインに失敗しました',
      msgLoginCancelled: 'ログインがキャンセルされました',
      msgLoginPreparing: 'Googleログインの準備中です。数秒後にもう一度お試しください。',
      msgReading: '要項を読み込んでいます…',
      msgSessionExpired: 'ログインの期限切れです。ファイルを入れ直してください。',
      // --- カード（抽出結果） ---
      stReading: '読み取り中…（Googleで変換）',
      stReadingShort: '読み取り中…',
      stDone: '読み取り完了',
      stFailedPrefix: '失敗: ',
      editHint: '内容を確認してください。訂正、追加等はそのまま入力欄で書き換え可能です。メモ・備考欄にコメントの追加もできます。',
      dateWarn: '⚠ 開催日を入力してください',
      msgDateEmptyA: '開催日が未入力の大会が ',
      msgDateEmptyB: ' 件あります。日付を入力するか、チェックを外してください。',
      // --- 要チェック（採点係）＆AI ---
      warnNotice: '点滅している枠は「特に注意したい箇所」の目印です。点滅していない項目にも誤りがある場合があります。気になる項目はそのまま手で直すか、AIで確認できます。',
      warnMultiDayEvents: '複数日開催です。日ごとの種目や、練習日が混じっていないかご確認ください。',
      warnManyDates: '開催日が多めです。締切日・練習日などが混じっていないかご確認ください。',
      warnDateInDeadline: '申込期間と重なる日付があります。締切日が混じっている可能性があります。',
      warnDeadlineAfterEvent: '締切が開催日より後になっています。ご確認ください。',
      warnVenueSuspect: '会場名が正しく取れていないかもしれません。',
      warnFormatEmpty: '試合形式が取得できていません。',
      aiCheckField: 'AIで確認',
      aiCheckCard: 'この大会をAIで検算',
      aiAnyFieldNote: 'AIの確認は⚠が付いた項目に限らず、どの項目にもかけられます。',
      aiKeyPrompt: 'GeminiのAPIキーを貼り付けてください。\n（あなたのキーはこの端末内だけで使われ、当方サーバーには保存しません）',
      aiRunning: 'AIで確認中…',
      aiNoKey: 'APIキーが未設定のため中止しました。',
      aiDone: 'AIの結果を反映しました。内容を必ずご確認ください。',
      aiFail: 'AI確認に失敗しました: ',
      aiLimit: '本日のAI無料枠を使い切ったようです。翌日（太平洋時間0時にリセット）以降に再度お試しください。',
      modeLabel: 'モード：',
      modeHybrid: '通常モード（AIを使わない）',
      modeAi: 'AIモード（最初からAIで読み取る）',
      msgError: 'エラー: ',
      stRegistered: '登録しました（要項を添付）',
      // --- フィールドラベル ---
      fldName: '大会名',
      fldDates: '開催日（YYYY-MM-DD、複数はカンマ区切り）',
      fldVenue: '会場',
      fldAddress: '住所',
      fldOpening: '開会式',
      fldFormat: '試合形式',
      fldDeadline: '申込締切',
      fldNote: 'メモ・備考',
      // --- 登録結果 ---
      msgNoItems: '登録する項目がありません。',
      msgRegDoneA: ' 件を登録しました。要項はGoogleドライブの',
      msgFolderName: 'DropperFilesフォルダ',
      msgRegDoneB: 'に保存し、カレンダーの予定に添付しています。このフォルダのファイルを削除するとカレンダーの添付も消えます。',
      msgRegFailCount: ' 件は失敗。',
      msgRegAllFail: ' 件の登録に失敗しました。',
      // --- カレンダー説明欄 ---
      descFormat: '試合形式: ',
      descDeadline: '申込締切: ',
      descOpening: '開会式: ',
      descNote: '備考: ',
      descFlyer: '要項: Googleドライブ DropperFilesフォルダ ( ',
      descFlyerTail: ' )\n※フォルダのファイルを削除するとこの添付も消えます。'
    },
    en: {
      pageTitle: 'Calendar Dropper',
      appName: 'Calendar Dropper',
      typeSports: 'Sports event flyer dropper',
      leadSports: 'Drop a flyer (PDF / image) → Review the details → Add to Google Calendar',
      loginBtn: 'Sign in with Google',
      loginNote: 'To add events to your Google Calendar, please sign in with Google and allow Calendar and Drive access first.',
      sportLabel: 'Sport:',
      sportAuto: 'Auto-detect',
      dropTitle: 'Drag & drop your flyer here',
      dropSub: 'PDF and images (JPEG/PNG) supported. You can drop several files at once.',
      pickBtn: 'Choose a file',
      note: 'The file is converted with Google OCR to pull out the key details. Your flyer is saved to the DropperFiles folder in your Google Drive and linked to the calendar event.',
      registerBtn: 'Add to Google Calendar',
      msgSigningIn: 'Signing in with Google…',
      msgLoginFailed: 'Sign-in failed.',
      msgLoginCancelled: 'Sign-in was cancelled.',
      msgLoginPreparing: 'Google sign-in is getting ready. Please try again in a few seconds.',
      msgReading: 'Reading the flyer…',
      msgSessionExpired: 'Your session has expired. Please add the file again.',
      stReading: 'Reading… (converting with Google)',
      stReadingShort: 'Reading…',
      stDone: 'Done',
      stFailedPrefix: 'Failed: ',
      editHint: 'Please check the details. You can edit any field directly, and add comments in the Notes field.',
      dateWarn: '⚠ Please enter the date',
      msgDateEmptyA: 'There are ',
      msgDateEmptyB: ' event(s) without a date. Please enter a date or uncheck them.',
      warnNotice: 'A blinking box marks a spot worth double-checking. Items without a blink can still be wrong. Fix anything by hand, or check it with AI.',
      warnMultiDayEvents: 'Multi-day event. Please check the events per day, and whether a practice day slipped in.',
      warnManyDates: 'Many dates found. Please check that deadline or practice days are not mixed in.',
      warnDateInDeadline: 'A date overlaps the entry period. A deadline date may be mixed in.',
      warnDeadlineAfterEvent: 'The deadline is after the event date. Please check.',
      warnVenueSuspect: 'The venue may not have been read correctly.',
      warnFormatEmpty: 'No format was detected.',
      aiCheckField: 'Check with AI',
      aiCheckCard: 'Recheck this event with AI',
      aiAnyFieldNote: 'AI check is not limited to flagged items — you can run it on any field.',
      aiKeyPrompt: 'Paste your Gemini API key.\n(Your key is used only on this device and is not stored on our server.)',
      aiRunning: 'Checking with AI…',
      aiNoKey: 'Cancelled: no API key set.',
      aiDone: 'AI result applied. Please review it carefully.',
      aiFail: 'AI check failed: ',
      aiLimit: 'Your daily free AI quota seems used up. Please try again after the daily reset (midnight Pacific Time).',
      modeLabel: 'Mode: ',
      modeHybrid: 'Standard mode (no AI)',
      modeAi: 'AI mode (read everything with AI)',
      msgError: 'Error: ',
      stRegistered: 'Added (flyer attached)',
      fldName: 'Event name',
      fldDates: 'Date (YYYY-MM-DD, comma-separated for multiple)',
      fldVenue: 'Venue',
      fldAddress: 'Address',
      fldOpening: 'Opening ceremony',
      fldFormat: 'Format',
      fldDeadline: 'Entry deadline',
      fldNote: 'Notes',
      msgNoItems: 'There is nothing to add.',
      msgRegDoneA: ' event(s) added. The flyer is saved in your Google Drive ',
      msgFolderName: 'DropperFiles folder',
      msgRegDoneB: ' and attached to the calendar event. Deleting the file from this folder will also remove it from the calendar event.',
      msgRegFailCount: ' failed.',
      msgRegAllFail: ' event(s) failed to be added.',
      descFormat: 'Format: ',
      descDeadline: 'Entry deadline: ',
      descOpening: 'Opening ceremony: ',
      descNote: 'Notes: ',
      descFlyer: 'Flyer: DropperFiles folder in Google Drive ( ',
      descFlyerTail: ' )\nNote: deleting the file from this folder will also remove this attachment.'
    },
    "in": {
      pageTitle: 'Calendar Dropper',
      appName: 'Calendar Dropper',
      typeSports: 'Sports event ka flyer dropper',
      leadSports: 'Flyer (PDF / image) drop karein → Details check karein → Google Calendar mein add karein',
      loginBtn: 'Google se sign in karein',
      loginNote: 'Events ko aapke Google Calendar mein add karne ke liye, pehle Google se sign in karke Calendar aur Drive ka access allow karein.',
      sportLabel: 'Sport:',
      sportAuto: 'Auto-detect',
      dropTitle: 'Apna flyer yahan drag & drop karein',
      dropSub: 'PDF aur images (JPEG/PNG) supported hain. Aap ek saath kai files bhi drop kar sakte hain.',
      pickBtn: 'File choose karein',
      note: 'File ko Google OCR se convert karke zaroori details nikaali jaati hain. Aapka flyer aapke Google Drive ke DropperFiles folder mein save hota hai aur calendar event se link ho jaata hai.',
      registerBtn: 'Google Calendar mein add karein',
      msgSigningIn: 'Google se sign in ho raha hai…',
      msgLoginFailed: 'Sign-in fail ho gaya.',
      msgLoginCancelled: 'Sign-in cancel ho gaya.',
      msgLoginPreparing: 'Google sign-in ready ho raha hai. Kuch second baad dobara try karein.',
      msgReading: 'Flyer read ho raha hai…',
      msgSessionExpired: 'Aapka session expire ho gaya hai. File dobara add karein.',
      stReading: 'Read ho raha hai… (Google se convert)',
      stReadingShort: 'Read ho raha hai…',
      stDone: 'Ho gaya',
      stFailedPrefix: 'Fail: ',
      editHint: 'Details check karein. Aap kisi bhi field ko directly edit kar sakte hain, aur Notes field mein comment add kar sakte hain.',
      dateWarn: '⚠ Kripya date enter karein',
      msgDateEmptyA: '',
      msgDateEmptyB: ' event(s) mein date nahi hai. Date daalein ya unhe uncheck karein.',
      warnNotice: 'Blink karta box us jagah ko mark karta hai jise double-check karna chahiye. Bina blink wale items bhi galat ho sakte hain. Kisi bhi field ko haath se theek karein, ya AI se check karein.',
      warnMultiDayEvents: 'Multi-day event hai. Har din ke events, aur kahin practice day to mix nahi hua, check karein.',
      warnManyDates: 'Kaafi dates mili hain. Deadline ya practice day mix to nahi hue, check karein.',
      warnDateInDeadline: 'Ek date entry period se overlap karti hai. Deadline date mix ho sakti hai.',
      warnDeadlineAfterEvent: 'Deadline event date ke baad hai. Kripya check karein.',
      warnVenueSuspect: 'Venue shayad sahi se read nahi hua.',
      warnFormatEmpty: 'Koi format detect nahi hua.',
      aiCheckField: 'AI se check karein',
      aiCheckCard: 'Is event ko AI se recheck karein',
      aiAnyFieldNote: 'AI check sirf flagged items tak seemit nahi hai — aap kisi bhi field par chala sakte hain.',
      aiKeyPrompt: 'Apni Gemini API key paste karein.\n(Aapki key sirf is device par use hoti hai, hamare server par store nahi hoti.)',
      aiRunning: 'AI se check ho raha hai…',
      aiNoKey: 'Cancel: koi API key set nahi hai.',
      aiDone: 'AI result apply ho gaya. Kripya ise dhyaan se review karein.',
      aiFail: 'AI check fail hua: ',
      aiLimit: 'Aapka daily free AI quota khatam lag raha hai. Daily reset (midnight Pacific Time) ke baad try karein.',
      modeLabel: 'Mode: ',
      modeHybrid: 'Standard mode (AI ke bina)',
      modeAi: 'AI mode (sab kuch AI se padhein)',
      fldName: 'Event ka naam',
      fldDates: 'Date (YYYY-MM-DD, multiple ke liye comma se alag karein)',
      fldVenue: 'Venue',
      fldAddress: 'Address',
      fldOpening: 'Opening ceremony',
      fldFormat: 'Format',
      fldDeadline: 'Entry deadline',
      fldNote: 'Notes',
      msgNoItems: 'Add karne ke liye kuch nahi hai.',
      msgRegDoneA: ' event add ho gaye. Flyer aapke Google Drive ',
      msgFolderName: 'DropperFiles folder',
      msgRegDoneB: ' mein save hai aur calendar event se attach hai. Is folder se file delete karne par calendar ka attachment bhi hat jaayega.',
      msgRegFailCount: ' fail.',
      msgRegAllFail: ' event add nahi ho paaye.',
      descFormat: 'Format: ',
      descDeadline: 'Entry deadline: ',
      descOpening: 'Opening ceremony: ',
      descNote: 'Notes: ',
      descFlyer: 'Flyer: Google Drive ka DropperFiles folder ( ',
      descFlyerTail: ' )\nNote: is folder se file delete karne par yeh attachment bhi hat jaayega.',
      msgError: 'Error: ',
      stRegistered: 'Add ho gaya (flyer attached)'
    }
  };

  // 現在の言語の辞書を返す（未設定や未知の言語は ja にフォールバック）
  function dict() {
    var lang = global.LANG || 'ja';
    return I18N[lang] || I18N.ja;
  }

  // キーから文言を引く
  function t(key) {
    var d = dict();
    return (key in d) ? d[key] : ((key in I18N.ja) ? I18N.ja[key] : key);
  }

  // data-i18n 属性を持つ要素に文言を流し込む。data-i18n-attr があればその属性に、なければテキストに。
  function applyDom() {
    document.title = t('pageTitle');
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) {
      var key = els[i].getAttribute('data-i18n');
      var attr = els[i].getAttribute('data-i18n-attr');
      var val = t(key);
      if (attr) { els[i].setAttribute(attr, val); }
      else { els[i].textContent = val; }
    }
  }

  global.I18N = { t: t, dict: dict, applyDom: applyDom };

  // 読み込み時に自動でDOMへ文言を流し込む（app.jsの状態に依存させない）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { try { applyDom(); } catch (e) {} });
  } else {
    try { applyDom(); } catch (e) {}
  }
})(window);
