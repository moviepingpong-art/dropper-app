// schedule-i18n.js — 予定表ドロッパーの多言語辞書
// 各言語版ページは、このファイルを読み込んだ上で window.LANG を 'ja' / 'en' / 'in' のいずれかに設定する。
// 文言を増やすときは、全言語に同じキーを足すこと。
//
// イベントドロッパーの i18n.js とは別物にしてある。あちらは3フォルダでバイト単位の同一を
// 保つ決まりで、予定表のキーを足すと2つのツールが結合してしまうため。
(function (global) {
  'use strict';

  var I18N = {
    ja: {
      pageTitle: '予定表ドロッパー',
      appName: '予定表ドロッパー',
      lead: '年間行事予定・大会日程・リーグ戦日程などの予定表をドロップ → 一覧で確認 → Googleカレンダーにまとめて登録',
      freeBadge: '🎉 今なら無料公開中',
      // --- ドロッパー切り替えタブ ---
      toolTabsLabel: 'ドロッパーの選択',
      toolEvent: '🎪 イベント',
      toolSchedule: '📅 予定表',
      toolHint: 'イベント＝チラシ1枚から1件 ／ 予定表＝1枚からまとめて何件も',
      // --- ログイン ---
      loginBtn: 'Googleでログイン',
      loginNote: '予定をGoogleカレンダーに登録するため、最初にGoogleログインとカレンダー・ドライブの許可が必要です。',
      msgLoggingIn: 'Googleにログインしています…',
      msgLoginFailed: 'ログインに失敗しました',
      msgLoginCancelled: 'ログインがキャンセルされました',
      msgLoginPreparing: 'Googleログインの準備中です。数秒後にもう一度お試しください。',
      msgSessionExpired: 'ログインの期限切れです。ファイルを入れ直してください。',
      msgSessionExpiredReload: 'ログインの期限切れです。再読み込みしてください。',
      // --- 予定表の形の選択 ---
      shapePrompt: '予定表の形をえらんでください',
      shapeTableName: '表形式',
      shapeTableDesc: '予定が1行に1つずつ\n上から並んでいる',
      shapeGridName: 'カレンダー形式',
      shapeGridDesc: 'マス目の中に\n行事名が書いてある',
      shapeGridNote: 'AIで読み取ります（APIキーが必要）',
      shapeUnknown: 'わからない',
      shapeChange: '変更',
      shapeTableLabel: '予定表の形：表形式',
      shapeTableNote: '※Googleの文字認識で読み取ります。読み取れない予定があるときは「AIで読み直す」をお試しください。',
      shapeGridLabel: '予定表の形：カレンダー形式',
      shapeGridNoteFull: '※マス目の予定表はAIが読み取ります。読み取りに数十秒かかることがあります。',
      shapeUnknownLabel: '予定表の形：わからない',
      shapeUnknownNote: '※まず無料の方法で読み取ります。うまくいかないときは「AIで読み直す」か、「変更」からカレンダー形式を選び直してください。',
      // --- 年度 ---
      fyLabel: '年度：',
      fyPlaceholder: '例 2026',
      fyHint: '空欄なら予定表の「◯◯年度」から自動で判断します。4〜12月はその年、1〜3月は翌年になります。',
      // --- ドロップ ---
      dropTitle: 'ここに予定表ファイルをドラッグ&ドロップ',
      dropSub: 'PDF・画像（JPEG/PNG）対応',
      pickBtn: 'ファイルを選ぶ',
      retryAiBtn: '🤖 AIで読み直す',
      retryAiHint: '読み取れていない予定があるときに使います（APIキーが必要）。',
      msgDropFirst: '先に予定表ファイルをドロップしてください。',
      // --- 読み取り中 ---
      msgOcrReading: '予定表を読み取っています…（Googleで変換）',
      msgAiReading: 'AIで予定表を読み取っています…（数十秒かかることがあります）',
      msgAiReadingShort: 'AIで予定表を読み取っています…',
      msgAiQueued: 'AIの順番待ち中…',
      msgAiRetry: 'AIが混雑しています。別のモデルで再試行中…',
      msgNoneAi: 'この予定表からは予定を読み取れませんでした。年度を入れて、もう一度お試しください。',
      msgNoneOcr: '予定を読み取れませんでした。下の「AIで読み直す」をお試しください。マス目のカレンダー形式なら、「変更」から選び直してください。',
      msgNoYear: '予定表から年度を読み取れませんでした。日付の年が違う場合は、上の「年度」欄に入力してもう一度ドロップしてください。',
      // --- 読み取れた文字 ---
      diagLabel: '読み取れた文字（先頭のみ）：',
      diagCopyBtn: 'この文字をコピー',
      diagMore: '\n…（以下略。全体は {n} 文字）',
      diagCopied: ' コピーしました（{n}文字）',
      // --- エラー ---
      errNoKey: 'APIキーが未設定です。',
      errNoKeyAborted: 'APIキーが未設定のため中止しました。',
      errTooLarge: 'ファイルが大きすぎます。ページを分けてお試しください。',
      errRateMinute: 'AIへの送信が短時間に集中しました。1分ほどおいて、もう一度ドロップしてください。',
      errRateDay: 'AIの無料枠（1日あたり）を使い切ったようです。翌日（太平洋時間0時にリセット）以降にお試しください。通常モードなら今すぐ読み取れます。',
      errBusy: 'AIが混み合っています。少し時間をおいてもう一度お試しください。',
      errBadJson: 'AIの返答を読み取れませんでした。もう一度お試しください。',
      errOther: '失敗: {m}',
      errDriveConvert: 'Drive変換 {code}',
      errTextFetch: 'テキスト取得 {code}',
      ocrTempSuffix: '_OCR一時',
      // --- 一覧 ---
      selAll: 'すべて選ぶ',
      selNone: 'すべて外す',
      selWarn: '⚠のみ外す',
      thReg: '登録',
      thStart: '開催日',
      thEnd: '終了日',
      thTime: '時刻',
      thTitle: '行事名',
      thPlace: '場所',
      endPlaceholder: '（任意）',
      flagNoDate: '⚠日付なし',
      flagOutOfRange: '⚠年度外',
      summaryRead: '{n}件の予定を読み取りました。',
      summaryWarn: '（うち {n}件は要確認）',
      summaryTail: ' 内容を確認し、登録するものだけチェックを残してください。',
      countLabel: '選択中 {n} / {total} 件',
      // --- 登録 ---
      regBtn: 'Googleカレンダーにまとめて登録',
      msgNoTargets: '登録できる予定がありません（日付と行事名が必要です）。',
      msgRegistering: '登録中… {i} / {n}',
      msgRegistered: '{n}件を登録しました。',
      msgRegisterFailed: ' {n}件は失敗しました。',
      // --- APIキー ---
      keyBtn: 'APIキーを変更',
      keyModalTitle: '🔑 Gemini APIキーの設定',
      keyModalNote: 'AIで読み取るには、ご自身のGemini APIキーが必要です。Googleアカウントがあれば無料で取得できます。',
      keyStudioLink: 'Google AI Studio を開く ↗',
      keyWarn: '⚠️ 無料枠では、送信内容がGoogleのサービス改善に利用される場合があります。機密文書はドロップしないでください。',
      keyCancel: 'キャンセル',
      keySave: '保存して使う',
      keyPrivacy: '🔒 キーはお使いの端末内だけに保存され、当方のサーバーには送信も保存もしません。'
    },

    en: {
      pageTitle: 'Schedule Dropper',
      appName: 'Schedule Dropper',
      lead: 'Drop a schedule — a year planner, a fixture list, a season calendar → check the list → add it all to Google Calendar at once',
      freeBadge: '🎉 Now FREE to use!',
      toolTabsLabel: 'Choose a dropper',
      toolEvent: '🎪 Event',
      toolSchedule: '📅 Schedule',
      toolHint: 'Event = one flyer, one entry / Schedule = one sheet, many entries',
      loginBtn: 'Sign in with Google',
      loginNote: 'To add entries to your Google Calendar, please sign in with Google and allow Calendar and Drive access first.',
      msgLoggingIn: 'Signing in to Google…',
      msgLoginFailed: 'Sign-in failed',
      msgLoginCancelled: 'Sign-in was cancelled',
      msgLoginPreparing: 'Google sign-in is still loading. Please try again in a few seconds.',
      msgSessionExpired: 'Your session has expired. Please drop the file again.',
      msgSessionExpiredReload: 'Your session has expired. Please reload the page.',
      shapePrompt: 'What does your schedule look like?',
      shapeTableName: 'Rows',
      shapeTableDesc: 'One entry per row,\nlisted top to bottom',
      shapeGridName: 'Calendar grid',
      shapeGridDesc: 'Entries written inside\nthe day cells',
      shapeGridNote: 'Read by AI (needs an API key)',
      shapeUnknown: 'Not sure',
      shapeChange: 'Change',
      shapeTableLabel: 'Shape: rows',
      shapeTableNote: 'Read with Google text recognition. If some entries are missing, try "Read again with AI".',
      shapeGridLabel: 'Shape: calendar grid',
      shapeGridNoteFull: 'A calendar grid is read by AI. This can take tens of seconds.',
      shapeUnknownLabel: 'Shape: not sure',
      shapeUnknownNote: 'Starting with the free method. If it does not work, try "Read again with AI", or pick the calendar grid under "Change".',
      fyLabel: 'Year:',
      fyPlaceholder: 'e.g. 2026',
      fyHint: 'Leave blank if the schedule itself states the year. Fill this in when the dates show no year.',
      dropTitle: 'Drag & drop your schedule file here',
      dropSub: 'PDF and images (JPEG/PNG)',
      pickBtn: 'Choose a file',
      retryAiBtn: '🤖 Read again with AI',
      retryAiHint: 'Use this when entries are missing (needs an API key).',
      msgDropFirst: 'Please drop a schedule file first.',
      msgOcrReading: 'Reading the schedule… (converting with Google)',
      msgAiReading: 'Reading the schedule with AI… (this can take tens of seconds)',
      msgAiReadingShort: 'Reading the schedule with AI…',
      msgAiQueued: 'Waiting in the AI queue…',
      msgAiRetry: 'The AI is busy. Retrying with another model…',
      msgNoneAi: 'No entries could be read from this schedule. Try entering the year and dropping it again.',
      msgNoneOcr: 'No entries could be read. Try "Read again with AI" below. If it is a calendar grid, pick that shape under "Change".',
      msgNoYear: 'The year could not be read from the schedule. If the dates show the wrong year, enter it in the "Year" box above and drop the file again.',
      diagLabel: 'Text that was recognised (beginning only):',
      diagCopyBtn: 'Copy this text',
      diagMore: '\n… (truncated; {n} characters in total)',
      diagCopied: ' Copied ({n} characters)',
      errNoKey: 'No API key is set.',
      errNoKeyAborted: 'Stopped because no API key is set.',
      errTooLarge: 'The file is too large. Try splitting it into separate pages.',
      errRateMinute: 'Too many requests to the AI in a short time. Wait about a minute and drop the file again.',
      errRateDay: 'The free AI quota for today looks used up. Try again tomorrow (it resets at midnight Pacific time). The normal method works right now.',
      errBusy: 'The AI is busy. Please wait a moment and try again.',
      errBadJson: 'The AI reply could not be read. Please try again.',
      errOther: 'Failed: {m}',
      errDriveConvert: 'Drive conversion {code}',
      errTextFetch: 'Text fetch {code}',
      ocrTempSuffix: '_OCR_temp',
      selAll: 'Select all',
      selNone: 'Clear all',
      selWarn: 'Clear ⚠ only',
      thReg: 'Add',
      thStart: 'Start',
      thEnd: 'End',
      thTime: 'Time',
      thTitle: 'Entry',
      thPlace: 'Location',
      endPlaceholder: '(optional)',
      flagNoDate: '⚠ no date',
      flagOutOfRange: '⚠ outside year',
      summaryRead: 'Read {n} entries.',
      summaryWarn: ' ({n} need checking)',
      summaryTail: ' Check them and leave ticked only the ones you want to add.',
      countLabel: '{n} of {total} selected',
      regBtn: 'Add all to Google Calendar',
      msgNoTargets: 'Nothing can be added (a date and an entry name are required).',
      msgRegistering: 'Adding… {i} / {n}',
      msgRegistered: 'Added {n} entries.',
      msgRegisterFailed: ' {n} failed.',
      keyBtn: 'Change API key',
      keyModalTitle: '🔑 Gemini API key',
      keyModalNote: 'Reading with AI needs your own Gemini API key. It is free to obtain with a Google account.',
      keyStudioLink: 'Open Google AI Studio ↗',
      keyWarn: '⚠️ On the free tier, what you send may be used to improve Google services. Do not drop confidential documents.',
      keyCancel: 'Cancel',
      keySave: 'Save and use',
      keyPrivacy: '🔒 The key is stored only on your device and is never sent to or stored on our servers.'
    },

    "in": {
      pageTitle: 'Schedule Dropper',
      appName: 'Schedule Dropper',
      lead: 'Schedule drop karein — year planner, fixture list, season calendar → list check karein → sab ek saath Google Calendar mein',
      freeBadge: '🎉 Abhi FREE hai!',
      toolTabsLabel: 'Dropper chunein',
      toolEvent: '🎪 Event',
      toolSchedule: '📅 Schedule',
      toolHint: 'Event = ek flyer se ek entry / Schedule = ek sheet se kai entries',
      loginBtn: 'Google se sign in karein',
      loginNote: 'Entries Google Calendar mein add karne ke liye, pehle Google sign in aur Calendar/Drive ki permission chahiye.',
      msgLoggingIn: 'Google mein sign in ho raha hai…',
      msgLoginFailed: 'Sign-in fail ho gaya',
      msgLoginCancelled: 'Sign-in cancel ho gaya',
      msgLoginPreparing: 'Google sign-in load ho raha hai. Kuch second baad phir try karein.',
      msgSessionExpired: 'Session expire ho gaya. File dobara drop karein.',
      msgSessionExpiredReload: 'Session expire ho gaya. Page reload karein.',
      shapePrompt: 'Aapka schedule kaisa dikhta hai?',
      shapeTableName: 'Rows',
      shapeTableDesc: 'Ek row mein ek entry,\nupar se neeche',
      shapeGridName: 'Calendar grid',
      shapeGridDesc: 'Entries date ke\nkhaano ke andar',
      shapeGridNote: 'AI se padha jaata hai (API key chahiye)',
      shapeUnknown: 'Pata nahi',
      shapeChange: 'Badlein',
      shapeTableLabel: 'Shape: rows',
      shapeTableNote: 'Google text recognition se padha jaata hai. Kuch entries chhoot jaayein to "AI se dobara padhein" try karein.',
      shapeGridLabel: 'Shape: calendar grid',
      shapeGridNoteFull: 'Calendar grid AI se padha jaata hai. Isme kuch second se zyada lag sakta hai.',
      shapeUnknownLabel: 'Shape: pata nahi',
      shapeUnknownNote: 'Pehle free tareeke se padh rahe hain. Kaam na kare to "AI se dobara padhein", ya "Badlein" se calendar grid chunein.',
      fyLabel: 'Year:',
      fyPlaceholder: 'jaise 2026',
      fyHint: 'Schedule mein year likha ho to khaali chhod dein. Dates mein year na ho to yahan bhar dein.',
      dropTitle: 'Schedule file yahan drag & drop karein',
      dropSub: 'PDF aur images (JPEG/PNG)',
      pickBtn: 'File chunein',
      retryAiBtn: '🤖 AI se dobara padhein',
      retryAiHint: 'Entries chhoot rahi hon to iska use karein (API key chahiye).',
      msgDropFirst: 'Pehle schedule file drop karein.',
      msgOcrReading: 'Schedule padha ja raha hai… (Google se convert)',
      msgAiReading: 'AI se schedule padha ja raha hai… (thoda samay lag sakta hai)',
      msgAiReadingShort: 'AI se schedule padha ja raha hai…',
      msgAiQueued: 'AI queue mein wait…',
      msgAiRetry: 'AI busy hai. Doosre model se dobara try…',
      msgNoneAi: 'Is schedule se koi entry nahi mili. Year bhar kar dobara drop karein.',
      msgNoneOcr: 'Koi entry nahi mili. Neeche "AI se dobara padhein" try karein. Calendar grid ho to "Badlein" se woh shape chunein.',
      msgNoYear: 'Schedule se year nahi mila. Dates ka year galat ho to upar "Year" mein bhar kar dobara drop karein.',
      diagLabel: 'Jo text pada gaya (sirf shuruaat):',
      diagCopyBtn: 'Yeh text copy karein',
      diagMore: '\n… (aur bhi hai; kul {n} characters)',
      diagCopied: ' Copy ho gaya ({n} characters)',
      errNoKey: 'API key set nahi hai.',
      errNoKeyAborted: 'API key set na hone se ruk gaya.',
      errTooLarge: 'File bahut badi hai. Pages alag karke try karein.',
      errRateMinute: 'Kam samay mein AI ko bahut requests gayin. Ek minute baad dobara drop karein.',
      errRateDay: 'Aaj ka free AI quota khatam lagta hai. Kal try karein (Pacific time aadhi raat ko reset). Normal tareeka abhi bhi kaam karta hai.',
      errBusy: 'AI busy hai. Thodi der baad try karein.',
      errBadJson: 'AI ka jawab padha nahi ja saka. Dobara try karein.',
      errOther: 'Fail: {m}',
      errDriveConvert: 'Drive conversion {code}',
      errTextFetch: 'Text fetch {code}',
      ocrTempSuffix: '_OCR_temp',
      selAll: 'Sab chunein',
      selNone: 'Sab hatayein',
      selWarn: 'Sirf ⚠ hatayein',
      thReg: 'Add',
      thStart: 'Start',
      thEnd: 'End',
      thTime: 'Time',
      thTitle: 'Entry',
      thPlace: 'Location',
      endPlaceholder: '(optional)',
      flagNoDate: '⚠ date nahi',
      flagOutOfRange: '⚠ year ke bahar',
      summaryRead: '{n} entries mili.',
      summaryWarn: ' ({n} check karni hain)',
      summaryTail: ' Check karke sirf woh tick rehne dein jo add karni hain.',
      countLabel: '{total} mein se {n} chuni gayin',
      regBtn: 'Sab Google Calendar mein add karein',
      msgNoTargets: 'Add karne layak kuch nahi (date aur entry name chahiye).',
      msgRegistering: 'Add ho raha hai… {i} / {n}',
      msgRegistered: '{n} entries add ho gayin.',
      msgRegisterFailed: ' {n} fail ho gayin.',
      keyBtn: 'API key badlein',
      keyModalTitle: '🔑 Gemini API key',
      keyModalNote: 'AI se padhne ke liye aapki apni Gemini API key chahiye. Google account ho to free mil jaati hai.',
      keyStudioLink: 'Google AI Studio kholein ↗',
      keyWarn: '⚠️ Free tier par bheja gaya content Google ki services behtar karne mein use ho sakta hai. Confidential documents drop na karein.',
      keyCancel: 'Cancel',
      keySave: 'Save karke use karein',
      keyPrivacy: '🔒 Key sirf aapke device par rehti hai; hamare server par na bheji jaati hai na store hoti hai.'
    }
  };

  // 現在の言語の辞書を返す（未設定や未知の言語は ja にフォールバック）
  function dict() {
    var lang = global.LANG || 'ja';
    return I18N[lang] || I18N.ja;
  }

  // キーから文言を引く。vars を渡すと {n} のような差し込みを置換する。
  function t(key, vars) {
    var d = dict();
    var s = (key in d) ? d[key] : ((key in I18N.ja) ? I18N.ja[key] : key);
    if (vars) { for (var k in vars) { s = s.split('{' + k + '}').join(vars[k]); } }
    return s;
  }

  // data-i18n 属性を持つ要素に文言を流し込む。data-i18n-attr があればその属性に、なければテキストに。
  function applyDom() {
    document.title = t('pageTitle');
    // イベントドロッパーへのリンクは、同じ言語の版へ送る
    var ev = document.getElementById('tabEvent');
    if (ev) {
      ev.href = (global.LANG === 'en') ? '/calendar-en/' : (global.LANG === 'in') ? '/calendar-in/' : '/calendar/';
    }
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

  // 読み込み時に自動でDOMへ文言を流し込む（schedule-app.js の状態に依存させない）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { try { applyDom(); } catch (e) {} });
  } else {
    try { applyDom(); } catch (e) {}
  }
})(window);
