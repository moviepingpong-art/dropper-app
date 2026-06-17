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
