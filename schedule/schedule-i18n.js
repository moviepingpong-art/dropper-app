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
      pageTitle: '予定表ドロッパー｜予定表から文章を抽出してGoogleカレンダーへ一括登録',
      appName: '予定表ドロッパー',
      lead: '年間行事予定・大会日程・リーグ戦日程などの予定表をドロップ → 一覧で確認 → Googleカレンダーにまとめて登録',
      // 見出しの下の、周知サイトの使い方ガイドへのリンク。日本語のガイドはいちばん上に使い方の動画がある（2026-09-30、dropper #24）。
      // en / in のガイドには動画が無いので、日本語だけ「動画つき」（イベントの guideLink と同じ文言）
      guideLink: '📖 使い方ガイド（動画つき）↗',
      freeBadge: '完全無料',
      // --- ドロッパー切り替えタブ ---
      toolTabsLabel: 'ドロッパーの選択',
      toolEvent: '🎪 イベント',
      toolSchedule: '📅 予定表',
      toolEntry: '📝 申込書',
      // --- 「何ができる？」ポップアップ（#tools-modal）---
      // 3本の違いは「1枚から何が、いくつ出てくるか」に尽きる。図のラベルもそこだけを言う。
      tmBtn: '🔍 何ができる？',
      tmTitle: '🎁 3つのドロッパー、何ができる？',
      tmIntro: 'どれも「ファイルをドロップするだけ」。違うのは、何が出てくるかです。',
      tmNameEvent: '🎪 イベントドロッパー',
      tmOneEvent: 'チラシ1枚から、予定1件と、そのまま配れる案内文。',
      tmFigFlyer: 'チラシ1枚',
      tmFigOneEntry: 'カレンダーに1件',
      tmFigAnnounce: 'LINE/SNS案内文',
      tmTagEvent1: 'どんなイベントにも',
      tmTagEvent2: '日付・会場を自動で',
      tmTagEvent3: '案内文もワンタップ',
      tmNameSchedule: '📅 予定表ドロッパー',
      tmOneSchedule: '予定表1枚から、中の予定を全部。確認してからまとめて登録。',
      tmFigSheet: '予定表1枚',
      tmFigReview: '一覧で確認',
      tmFigBulk: 'まとめて登録',
      tmTagSchedule1: '1枚からまとめて',
      tmTagSchedule2: 'マス目の予定表もOK',
      tmTagSchedule3: '二重登録を防ぐ',
      tmGoEvent: '🎪 イベントドロッパーを使ってみる',
      tmHere: 'いま使っています',
      tmNameEntry: '📝 申込書ドロッパー',
      tmOneEntry: '大会の申込書に、名簿から生年月日・年齢・住所を埋めて返します。',
      tmFigForm: '申込書（空でも可）',
      tmFigRoster: '名簿から選ぶ',
      tmFigFilled: '記入済みで保存',
      tmTagEntry1: 'ログイン不要で試せる',
      tmTagEntry2: '生年月日・年齢・住所を自動',
      tmTagEntry3: '名簿もこのツールで作れる',
      tmGoEntry: '📝 申込書ドロッパーを使ってみる',
      tmClose: '閉じる',
      tmFoot: '※ この説明は「何ができる？」からいつでも見られます。',
      tmLineTitle: 'LINEでも使えます',
      tmLineText: '公式アカウントに要項の画像やPDFを送るだけ。ログインなしで読み取り結果が返ります。',
      tmLineBtn: '友だち追加して試す',
      tmLineQr: 'パソコンの方はスマホのLINEで読み取り',
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
      modeLabel: '読み取り方：',
      modeNormal: '通常モード（AIなし）',
      modeAi: 'AIモード',
      modeNormalNote: '※Googleの文字認識で読み取ります。読み取れない予定があるときは「AIで読み直す」をお試しください。',
      modeAiNote: '※AIが読み取ります（キーは要りません。1人1日10枚まで）。マス目のカレンダー形式もこちらで読めます。数十秒かかることがあります。',
      gridWarn: '⚠ この予定表はカレンダー形式（マス目）のようです。日付と行事名の対応が正しく取れていない可能性があります。下の「AIで読み直す」をお試しください。',
      // --- 年度 ---
      fyLabel: '年度：',
      fyPlaceholder: '例 2026',
      fyHint: '空欄なら予定表の「◯◯年度」から自動で判断します。4〜12月はその年、1〜3月は翌年になります。',
      // --- ドロップ ---
      dropTitle: 'ここに予定表ファイルをドラッグ&ドロップ',
      dropSub: 'PDF・画像（JPEG/PNG）対応',
      pickBtn: 'ファイルを選ぶ',
      retryAiBtn: '🤖 AIで読み直す',
      retryAiHint: '読み取れていない予定があるときに使います（キーは要りません）。',
      msgDropFirst: '先に予定表ファイルをドロップしてください。',
      // --- 読み取り中 ---
      msgOcrReading: '予定表を読み取っています…（Googleで変換）',
      msgAiReading: 'AIで予定表を読み取っています…（数十秒かかることがあります）',
      msgNoneAi: 'この予定表からは予定を読み取れませんでした。年度を入れて、もう一度お試しください。',
      msgNoneOcr: '予定を読み取れませんでした。下の「AIで読み直す」をお試しください。',
      msgNoYear: '予定表から年度を読み取れませんでした。日付の年が違う場合は、上の「年度」欄に入力してもう一度ドロップしてください。',
      // --- 読み取れた文字 ---
      diagLabel: '読み取れた文字（先頭のみ）：',
      diagCopyBtn: 'この文字をコピー',
      diagMore: '\n…（以下略。全体は {n} 文字）',
      diagCopied: ' コピーしました（{n}文字）',
      // --- エラー ---
      errTooLarge: 'ファイルが大きすぎて、AIに送れません（10MBまで）。ページを分けてお試しください。',
      errBadType: 'この形式のファイルは、AIに送れません（PDF・画像だけ）。',
      errLimit: '今日のAIの回数（1人1日10枚）を使い切りました。明日また使えます。通常モードなら今すぐ読み取れます。',
      errQuota: '今日のAIの枠は、全体で使い切りました。明日また使えます。通常モードなら今すぐ読み取れます。',
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
      // --- AIを使うかの選択 ---
      aiModalTitle: '🤖 AIで読み取り精度を上げますか？',
      aiModalIntro: '予定表の読み取りは、AIを使うとさらに正確になります。マス目のカレンダー形式はAIでしか読めません。利用は任意です。',
      aiModalSkipTitle: 'AIを使わない（通常モード）',
      aiModalSkipDesc: '追加設定なしで、いますぐ無料で使えます。読み取り結果はご自身で確認・修正できます。',
      aiModalUseTitle: 'AIを使う（AIモード）',
      aiModalUseDesc: '設定は要りません。予定表をAIで読み取ります。',
      aiBadgeCard: '🔑 キーは要りません',
      aiBadgeFree: '🆓 0円',
      aiBadgeTime: '📅 1人1日10枚まで',
      aiModalWhy1: '📥 1枚の予定表から何十件・何百件の予定をまとめて読み取ります（実データで157件・211件を確認）。',
      aiModalUse1: '📤 予定表のファイルは、当方の中継（何も保存しません）を通して OpenAI のAIへ送ります。',
      aiModalUse2: '⚠️ 送った内容は、OpenAI がAIの改良に使うことがあります（無料で使える条件です）。個人の情報が入った文書はドロップしないでください。',
      aiModalUse3: '📅 1人1日10枚まで使えます。AIの枠が終わった日も、通常モードでそのまま読み取れます。',
      aiModalSkipBtn: 'AIを使わない',
      aiModalUseBtn: 'AIを使う',
      aiModalFoot: '※あとから「通常モード」「AIモード」を押せば、いつでも切り替えられます。',
    },

    en: {
      pageTitle: 'Schedule Dropper | Extract a whole schedule into Google Calendar',
      appName: 'Schedule Dropper',
      lead: 'Drop a schedule — a year planner, a fixture list, a season calendar → check the list → add it all to Google Calendar at once',
      guideLink: '📖 User guide ↗',
      freeBadge: 'Completely free',
      toolTabsLabel: 'Choose a dropper',
      toolEvent: '🎪 Event',
      toolSchedule: '📅 Schedule',
      toolEntry: '📝 Entry forms',
      tmBtn: '🔍 What can these do?',
      tmTitle: '🎁 Two droppers — what does each one do?',
      tmIntro: 'Both work the same way: drop a file. What differs is what comes out.',
      tmNameEvent: '🎪 Event Dropper',
      tmOneEvent: 'One flyer becomes one calendar entry, plus a ready-to-post announcement.',
      tmFigFlyer: 'One flyer',
      tmFigOneEntry: 'One calendar entry',
      tmFigAnnounce: 'WhatsApp/SNS post',
      tmTagEvent1: 'Any event works',
      tmTagEvent2: 'Date and venue found for you',
      tmTagEvent3: 'Announcement in one tap',
      tmNameSchedule: '📅 Schedule Dropper',
      tmOneSchedule: 'One sheet becomes every entry on it. Check the list, then add them all.',
      tmFigSheet: 'One sheet',
      tmFigReview: 'Check the list',
      tmFigBulk: 'Add them all',
      tmTagSchedule1: 'Many entries from one sheet',
      tmTagSchedule2: 'Calendar grids too',
      tmTagSchedule3: 'No double entries',
      tmGoEvent: '🎪 Try Event Dropper',
      tmHere: 'You are here',
      tmNameEntry: '📝 Entry Form Dropper',
      tmOneEntry: 'Fills a tournament entry form with dates of birth, ages and addresses from your club roster.',
      tmFigForm: 'The entry form',
      tmFigRoster: 'Pick from the roster',
      tmFigFilled: 'Saved, filled in',
      tmTagEntry1: 'No login needed',
      tmTagEntry2: 'Birth dates, ages and addresses',
      tmTagEntry3: 'Build the roster here too',
      tmGoEntry: '📝 Try the Entry Form Dropper',
      tmClose: 'Close',
      tmFoot: 'You can open this again any time from "What can these do?".',
      tmLineTitle: 'Also on LINE',
      tmLineText: 'Send an image or PDF to the official account. No login needed.',
      tmLineBtn: 'Add as friend',
      tmLineQr: 'Scan with LINE on your phone',
      loginBtn: 'Sign in with Google',
      loginNote: 'To add entries to your Google Calendar, please sign in with Google and allow Calendar and Drive access first.',
      msgLoggingIn: 'Signing in to Google…',
      msgLoginFailed: 'Sign-in failed',
      msgLoginCancelled: 'Sign-in was cancelled',
      msgLoginPreparing: 'Google sign-in is still loading. Please try again in a few seconds.',
      msgSessionExpired: 'Your session has expired. Please drop the file again.',
      msgSessionExpiredReload: 'Your session has expired. Please reload the page.',
      modeLabel: 'How to read it:',
      modeNormal: 'Normal (no AI)',
      modeAi: 'AI',
      modeNormalNote: 'Read with Google text recognition. If some entries are missing, try "Read again with AI".',
      modeAiNote: '*AI reads it (no key needed, up to 10 a day per person). Calendar grids can be read here too. It may take several tens of seconds.',
      gridWarn: '⚠ This looks like a calendar grid. The dates and entry names may not have been paired up correctly. Try "Read again with AI" below.',
      fyLabel: 'Year:',
      fyPlaceholder: 'e.g. 2026',
      fyHint: 'Leave blank if the schedule itself states the year. Fill this in when the dates show no year.',
      dropTitle: 'Drag & drop your schedule file here',
      dropSub: 'PDF and images (JPEG/PNG)',
      pickBtn: 'Choose a file',
      retryAiBtn: '🤖 Read again with AI',
      retryAiHint: 'Use this when entries are missing (no key needed).',
      msgDropFirst: 'Please drop a schedule file first.',
      msgOcrReading: 'Reading the schedule… (converting with Google)',
      msgAiReading: 'Reading the schedule with AI… (this can take tens of seconds)',
      msgNoneAi: 'No entries could be read from this schedule. Try entering the year and dropping it again.',
      msgNoneOcr: 'No entries could be read. Try "Read again with AI" below.',
      msgNoYear: 'The year could not be read from the schedule. If the dates show the wrong year, enter it in the "Year" box above and drop the file again.',
      diagLabel: 'Text that was recognised (beginning only):',
      diagCopyBtn: 'Copy this text',
      diagMore: '\n… (truncated; {n} characters in total)',
      diagCopied: ' Copied ({n} characters)',
      errTooLarge: 'This file is too large to send to the AI (up to 10 MB). Try splitting it into separate pages.',
      errBadType: 'This file type can\'t be sent to the AI (PDF or images only).',
      errLimit: 'You have used today\'s AI reads (10 per person per day). You can use it again tomorrow. Standard mode can read it right now.',
      errQuota: 'Today\'s AI allowance has run out for everyone. It will be back tomorrow. Standard mode can read it right now.',
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
      aiModalTitle: '🤖 Read it more accurately with AI?',
      aiModalIntro: 'AI reads a schedule more accurately, and a calendar-grid layout can only be read that way. Using it is optional.',
      aiModalSkipTitle: 'Without AI (normal mode)',
      aiModalSkipDesc: 'Free to use right now, with nothing to set up. You can check and correct the results yourself.',
      aiModalUseTitle: 'With AI (AI mode)',
      aiModalUseDesc: 'No setup needed. AI reads your schedule.',
      aiBadgeCard: '🔑 No key needed',
      aiBadgeFree: '🆓 Free',
      aiBadgeTime: '📅 Up to 10 a day',
      aiModalWhy1: '📥 Reads dozens or hundreds of events from a single schedule at once (157 and 211 confirmed on real files).',
      aiModalUse1: '📤 Your file goes through our relay (which stores nothing) to OpenAI\'s AI.',
      aiModalUse2: '⚠️ OpenAI may use what you send to improve its AI (the condition for offering this free). Please don\'t drop documents with personal information.',
      aiModalUse3: '📅 Up to 10 files per person per day. On days the AI allowance runs out, standard mode still reads your file.',
      aiModalSkipBtn: 'Without AI',
      aiModalUseBtn: 'Use AI',
      aiModalFoot: 'You can switch between "Standard" and "AI" at any time.',
    },

    "in": {
      pageTitle: 'Schedule Dropper | Poore schedule se text extract karke Google Calendar mein',
      appName: 'Schedule Dropper',
      lead: 'Schedule drop karein — year planner, fixture list, season calendar → list check karein → sab ek saath Google Calendar mein',
      guideLink: '📖 Guide ↗',
      freeBadge: 'Bilkul free',
      toolTabsLabel: 'Dropper chunein',
      toolEvent: '🎪 Event',
      toolSchedule: '📅 Schedule',
      toolEntry: '📝 Entry forms',
      tmBtn: '🔍 Ye kya kar sakte hain?',
      tmTitle: '🎁 Do dropper — kaunsa kya karta hai?',
      tmIntro: 'Dono mein bas file drop karni hai. Farq sirf itna hai ki bahar kya aata hai.',
      tmNameEvent: '🎪 Event Dropper',
      tmOneEvent: 'Ek flyer se ek calendar entry, aur saath mein ready announcement.',
      tmFigFlyer: 'Ek flyer',
      tmFigOneEntry: 'Calendar mein ek entry',
      tmFigAnnounce: 'WhatsApp/SNS post',
      tmTagEvent1: 'Koi bhi event',
      tmTagEvent2: 'Date aur venue apne aap',
      tmTagEvent3: 'Announcement ek tap mein',
      tmNameSchedule: '📅 Schedule Dropper',
      tmOneSchedule: 'Ek sheet se usme likhi saari entries. Check karke sab ek saath add karein.',
      tmFigSheet: 'Ek sheet',
      tmFigReview: 'List check karein',
      tmFigBulk: 'Sab ek saath add',
      tmTagSchedule1: 'Ek sheet se kai entries',
      tmTagSchedule2: 'Calendar grid bhi',
      tmTagSchedule3: 'Double entry nahi',
      tmGoEvent: '🎪 Event Dropper try karein',
      tmHere: 'Abhi yahi khula hai',
      tmNameEntry: '📝 Entry Form Dropper',
      tmOneEntry: 'Tournament entry form mein roster se date of birth, age aur address bhar deta hai.',
      tmFigForm: 'Entry form',
      tmFigRoster: 'Roster se chunein',
      tmFigFilled: 'Bhara hua save',
      tmTagEntry1: 'Login ki zaroorat nahin',
      tmTagEntry2: 'Date of birth, age, address',
      tmTagEntry3: 'Roster bhi yahin banayein',
      tmGoEntry: '📝 Entry Form Dropper aazmayein',
      tmClose: 'Band karein',
      tmFoot: 'Ise kabhi bhi "Ye kya kar sakte hain?" se dobara dekh sakte hain.',
      tmLineTitle: 'LINE par bhi',
      tmLineText: 'Official account ko image ya PDF bhejein. Login ki zaroorat nahi.',
      tmLineBtn: 'Friend add karein',
      tmLineQr: 'Phone ke LINE se scan karein',
      loginBtn: 'Google se sign in karein',
      loginNote: 'Entries Google Calendar mein add karne ke liye, pehle Google sign in aur Calendar/Drive ki permission chahiye.',
      msgLoggingIn: 'Google mein sign in ho raha hai…',
      msgLoginFailed: 'Sign-in fail ho gaya',
      msgLoginCancelled: 'Sign-in cancel ho gaya',
      msgLoginPreparing: 'Google sign-in load ho raha hai. Kuch second baad phir try karein.',
      msgSessionExpired: 'Session expire ho gaya. File dobara drop karein.',
      msgSessionExpiredReload: 'Session expire ho gaya. Page reload karein.',
      modeLabel: 'Kaise padhein:',
      modeNormal: 'Normal (AI ke bina)',
      modeAi: 'AI',
      modeNormalNote: 'Google text recognition se padha jaata hai. Kuch entries chhoot jaayein to "AI se dobara padhein" try karein.',
      modeAiNote: '*AI padhega (key ki zaroorat nahi, ek vyakti din mein 10 tak). Calendar grid bhi yahan padh sakte hain. Kuch der lag sakti hai.',
      gridWarn: '⚠ Yeh calendar grid lagta hai. Dates aur entry names ka jod galat ho sakta hai. Neeche "AI se dobara padhein" try karein.',
      fyLabel: 'Year:',
      fyPlaceholder: 'jaise 2026',
      fyHint: 'Schedule mein year likha ho to khaali chhod dein. Dates mein year na ho to yahan bhar dein.',
      dropTitle: 'Schedule file yahan drag & drop karein',
      dropSub: 'PDF aur images (JPEG/PNG)',
      pickBtn: 'File chunein',
      retryAiBtn: '🤖 AI se dobara padhein',
      retryAiHint: 'Entries chhoot rahi hon to iska use karein (key ki zaroorat nahi).',
      msgDropFirst: 'Pehle schedule file drop karein.',
      msgOcrReading: 'Schedule padha ja raha hai… (Google se convert)',
      msgAiReading: 'AI se schedule padha ja raha hai… (thoda samay lag sakta hai)',
      msgNoneAi: 'Is schedule se koi entry nahi mili. Year bhar kar dobara drop karein.',
      msgNoneOcr: 'Koi entry nahi mili. Neeche "AI se dobara padhein" try karein.',
      msgNoYear: 'Schedule se year nahi mila. Dates ka year galat ho to upar "Year" mein bhar kar dobara drop karein.',
      diagLabel: 'Jo text pada gaya (sirf shuruaat):',
      diagCopyBtn: 'Yeh text copy karein',
      diagMore: '\n… (aur bhi hai; kul {n} characters)',
      diagCopied: ' Copy ho gaya ({n} characters)',
      errTooLarge: 'File AI ko bhejne ke liye bahut badi hai (10 MB tak). Pages alag karke try karein.',
      errBadType: 'Is type ki file AI ko nahi bheji ja sakti (sirf PDF ya image).',
      errLimit: 'Aaj ke AI reads (ek vyakti 10 per din) khatam ho gaye. Kal phir use kar sakte hain. Normal mode abhi padh sakta hai.',
      errQuota: 'Aaj sabke liye AI ka quota khatam ho gaya. Kal wapas milega. Normal mode abhi padh sakta hai.',
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
      aiModalTitle: '🤖 AI se aur sahi padhwana hai?',
      aiModalIntro: 'AI schedule ko aur sahi padhta hai, aur calendar-grid layout sirf isi se padha ja sakta hai. Use karna optional hai.',
      aiModalSkipTitle: 'AI ke bina (normal mode)',
      aiModalSkipDesc: 'Bina kuch set kiye, abhi free mein use karein. Result aap khud check aur theek kar sakte hain.',
      aiModalUseTitle: 'AI ke saath (AI mode)',
      aiModalUseDesc: 'Koi setup nahi. AI aapka schedule padhta hai.',
      aiBadgeCard: '🔑 Key ki zaroorat nahi',
      aiBadgeFree: '🆓 Free',
      aiBadgeTime: '📅 Din mein 10 tak',
      aiModalWhy1: '📥 Ek hi schedule se dozens ya hundreds events ek saath padhta hai (real files par 157 aur 211 confirm hue).',
      aiModalUse1: '📤 Aapki file hamare relay se (jo kuch save nahi karta) OpenAI ke AI tak jaati hai.',
      aiModalUse2: '⚠️ Bheji gayi cheez OpenAI apne AI ko behtar banane mein use kar sakta hai (free dene ki shart). Personal information wale documents drop na karein.',
      aiModalUse3: '📅 Ek vyakti din mein 10 files tak. Jis din AI ka quota khatam ho, us din bhi normal mode file padh leta hai.',
      aiModalSkipBtn: 'AI ke bina',
      aiModalUseBtn: 'AI use karein',
      aiModalFoot: '"Normal" aur "AI" ke beech kabhi bhi switch kar sakte hain.',
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
    // 他のドロッパーへのリンクは、同じ言語の版へ送る（en の利用者を ja のページへ飛ばさない）
    var ev = document.getElementById('tabEvent');
    if (ev) {
      ev.href = (global.LANG === 'en') ? '/calendar-en/' : (global.LANG === 'in') ? '/calendar-in/' : '/calendar/';
    }
    // ★ 申込書ドロッパーは日本語のみ（dropper-app/CLAUDE.md）。en/in では出さない。
    //   日本語だけのツールへ飛ばすと行き止まりになる。HTML は3言語ともバイト同一のまま。
    var te = document.getElementById('tabEntry');
    if (te) { te.style.display = (global.LANG === 'ja' || !global.LANG) ? '' : 'none'; }
    // 「何ができる？」の中の申込書も、同じ理由で日本語のときだけ出す
    ['tmTabEntry', 'tmPanelEntry'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.style.display = (global.LANG === 'ja' || !global.LANG) ? '' : 'none'; }
    });
    // 「何ができる？」ポップアップの「使ってみる」。タブと同じく同じ言語の版へ送る。
    // タブと同じ規則なので、リンク先を変えるときは両方そろえること。
    var tmGoE = document.getElementById('tmGoEvent');
    if (tmGoE) {
      tmGoE.href = (global.LANG === 'en') ? '/calendar-en/' : (global.LANG === 'in') ? '/calendar-in/' : '/calendar/';
    }
    // 見出しの下の使い方ガイドへのリンク（2026-09-30）。行き先は HTML の data-site から取り、
    // 同じ言語の版へ送る（イベントの i18n.js の guideLink と同じ作り）。HTMLに直書きの href は ja 用の既定値
    var gl = document.getElementById('guideLink');
    if (gl) {
      var glPre = (global.LANG === 'en') ? 'en/' : (global.LANG === 'in') ? 'in/' : '';
      var glAs = gl.querySelectorAll('a[data-site]');
      for (var gi = 0; gi < glAs.length; gi++) {
        glAs[gi].href = 'https://dropper-tools.com/' + glPre + glAs[gi].getAttribute('data-site');
      }
    }
    // LINE公式アカウントの導線は **日本語のときだけ** 出す。
    // LINE Botは日本語のみで、en/in の利用者はLINEを使わない（WhatsApp圏）。
    // マークアップは9フォルダ共通に置き（index.html のバイト同一性を保つため）、
    // 出し分けはここで行う。annLineBtn と同じ考え方。
    var tmLine = document.getElementById('tmLine');
    if (tmLine) { tmLine.style.display = (global.LANG === 'ja' || !global.LANG) ? '' : 'none'; }
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
