// decide-i18n.js — 決めごとドロッパーの多言語辞書（window.I18N）
//
// イベント側の i18n.js・予定表側の schedule-i18n.js とは別物。
// 3つのツールで辞書を共有すると、片方の文言変更が他方に波及するため分けてある。
//
// キーは ja / en / in の3言語すべてに足すこと（片方だけ足さない）。
// ※ en / in の文言は暫定。日本語版で抽出精度を詰めたあと、段階4で見直す。
(function (global) {
  'use strict';

  var I18N = {
    ja: {
      pageTitle: '決めごとドロッパー｜会話のスクショ・打ち合わせメモ・議事録から、決まったこと・未決事項を取り出す',
      appName: '決めごとドロッパー',
      // ツール切り替えタブ
      typePrompt: 'ドロッパーを選ぶ',
      toolEvent: 'イベント',
      toolSchedule: '予定表',
      toolDecide: '決めごと',
      toolHint: '入れるものが違います。チラシ1枚ならイベント、予定表ならN件、会話のスクショ・打ち合わせメモ・議事録なら決めごと。',
      lead: '「結局これ決まったんだっけ？」を読み返して探す時間をなくします。',
      // プライバシー（このツールは投げ込むもの自体が私的な会話なので、正面から書く）
      privTitle: '入れたものの扱い',
      priv1: '当方はサーバーを持っていないため、こちらには画像も読み取った内容も残りません。',
      priv2: '送信先はあなたのキーで動く Google の Gemini API だけです。',
      priv3: '⚠️ 無料枠では、送信内容がGoogleのサービス改善に利用される場合があります（有料枠では利用されません）。他人が写った会話や、名前の入った打ち合わせメモ・議事録を入れる前にご確認ください。',
      // ドロップ
      dropTitle: '会話のスクショ・打ち合わせメモ・議事録を入れる',
      dropSub: 'ここにドラッグ、またはタップして選ぶ',
      pickBtn: 'ファイルを選ぶ',
      dropNote: 'チャットのスクリーンショット、手書きのノート、ホワイトボードの写真、議事録や総会報告などの文書、FAX（PDFも可）。複数枚をまとめて入れられます（最大10枚）。記録の順に並べてください。上下が重なっていても大丈夫です。',
      filesPicked: '{n}件を選びました',
      // 基準日
      baseDateLabel: 'この記録の基準日',
      baseDateHint: '「来週の火曜」のような書き方を西暦に直すのに使います。スクショを撮った日、またはメモを書いた日を入れてください。',
      runBtn: '読み取る',
      resetBtn: '入れ直す',
      // 状態
      msgQueued: 'AIの順番待ち中…',
      msgRunning: 'AIが記録を読んでいます…',
      msgRetry: 'AIが混雑しています。自動で再試行中…',
      msgDone: '読み取りました。内容を必ずご確認ください。',
      msgNoFiles: 'ファイルが選ばれていません。',
      msgTooMany: '一度に入れられるのは10件までです。',
      msgTooLarge: 'ファイルの合計が大きすぎます。件数を減らしてください。',
      msgNoKey: 'APIキーが未設定のため中止しました。',
      msgRateMinute: '短時間に送りすぎました。1分ほど待ってからもう一度お試しください。',
      msgRateDay: '本日の無料枠を使い切りました。明日までお待ちください。',
      msgBusy: 'AIが混雑しています。しばらくしてからお試しください。',
      msgBadJson: 'AIの返答を読み取れませんでした。もう一度お試しください。',
      msgError: '読み取りに失敗しました: ',
      // 結果
      secDecided: '✅ 決まったこと',
      secUndecided: '❓ まだ決まっていないこと',
      secTodos: '📌 やること',
      emptyDecided: '決まったことは見つかりませんでした。',
      emptyUndecided: '未決の項目は見つかりませんでした。',
      emptyTodos: 'やることは見つかりませんでした。',
      labWho: '発言者',
      labWaiting: '何待ち',
      labOwner: '担当',
      labDue: '期限',
      dueFromText: '原文では「{raw}」',
      dueUnknown: '期限の記載なし',
      checkHint: 'AIの読み取りです。特に日付は、併記された原文の表現と見比べてご確認ください。手書きの読み取りは崩し字で外すことがあります。',
      copyBtn: 'まとめをコピー',
      copiedBtn: 'コピーしました',
      // カレンダー登録（期限のある「やること」だけが対象。ここで初めてログインを求める）
      regNote: '期限のある項目をカレンダーに入れられます。ここで初めてGoogleログインを求めます。読み取りとコピーだけならログインは要りません。',
      regBtn: 'カレンダーに登録',
      msgSigningIn: 'Googleにログインしています…',
      msgLoginPreparing: 'Googleログインの準備中です。数秒後にもう一度お試しください。',
      msgLoginCancelled: 'ログインがキャンセルされました。',
      msgLoginFailed: 'ログインに失敗しました。',
      msgRegNoTarget: '登録する項目が選ばれていません。',
      msgRegistering: '{n}件中 {i}件目を登録しています…',
      msgRegDone: '{ok}件を登録しました。',
      msgRegFail: '（{ng}件は登録できませんでした）',
      msgSessionExpired: 'ログインの期限が切れました。もう一度「カレンダーに登録」を押してください。',
      evFrom: '決めごとドロッパーで作成',
      // APIキー（イベント／予定表と同じ保存先・同じ作り）
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
      keyFoot: '🔒 キーはお使いの端末内（ブラウザ）だけに保存され、当方のサーバーには送信も保存もしません。',
      keyChange: 'APIキーを変更'
    },

    en: {
      pageTitle: 'Decide Dropper | Pull decisions and open questions out of chat screenshots, notes and minutes',
      appName: 'Decide Dropper',
      typePrompt: 'Choose a dropper',
      toolEvent: 'Event',
      toolSchedule: 'Schedule',
      toolDecide: 'Decide',
      toolHint: 'Each takes something different. One flyer for Event, a schedule sheet for Schedule, chat screenshots, meeting notes or minutes for Decide.',
      lead: 'Stop scrolling back asking "so what did we actually decide?"',
      privTitle: 'What happens to what you drop',
      priv1: 'We run no server, so neither the files nor what is read from them reaches us.',
      priv2: 'They go only to Google\'s Gemini API, running on your own key.',
      priv3: '⚠️ On the free tier, what you send may be used to improve Google\'s services (the paid tier does not). Please check this before dropping a conversation that involves other people, or notes and minutes with names in them.',
      dropTitle: 'Drop chat screenshots, notes or minutes',
      dropSub: 'Drag them here, or tap to choose',
      pickBtn: 'Choose files',
      dropNote: 'Chat screenshots, handwritten notes, a photo of a whiteboard, documents such as minutes or committee reports, a fax (PDF is fine). Up to 10 at once. Keep them in order. Overlapping images are fine.',
      filesPicked: '{n} file(s) selected',
      baseDateLabel: 'Date of this record',
      baseDateHint: 'Used to turn wording like "next Tuesday" into a real date. Enter the day the screenshots were taken or the notes were written.',
      runBtn: 'Read it',
      resetBtn: 'Start over',
      msgQueued: 'Waiting in the AI queue…',
      msgRunning: 'The AI is reading the record…',
      msgRetry: 'The AI is busy. Retrying automatically…',
      msgDone: 'Done. Please check the result carefully.',
      msgNoFiles: 'No files selected.',
      msgTooMany: 'You can drop at most 10 files at a time.',
      msgTooLarge: 'The files are too large in total. Please use fewer.',
      msgNoKey: 'Stopped because no API key is set.',
      msgRateMinute: 'Too many requests in a short time. Please wait about a minute and try again.',
      msgRateDay: 'Today\'s free quota is used up. Please try again tomorrow.',
      msgBusy: 'The AI is busy. Please try again shortly.',
      msgBadJson: 'Could not read the AI\'s reply. Please try again.',
      msgError: 'Reading failed: ',
      secDecided: '✅ Decided',
      secUndecided: '❓ Still open',
      secTodos: '📌 To do',
      emptyDecided: 'No decisions found.',
      emptyUndecided: 'Nothing left open.',
      emptyTodos: 'No tasks found.',
      labWho: 'Said by',
      labWaiting: 'Waiting on',
      labOwner: 'Owner',
      labDue: 'Due',
      dueFromText: 'Original wording: "{raw}"',
      dueUnknown: 'No deadline mentioned',
      checkHint: 'This was read by AI. Check the dates especially, against the original wording shown beside them. Handwriting can be misread.',
      copyBtn: 'Copy the summary',
      copiedBtn: 'Copied',
      regNote: 'Items with a deadline can go into your calendar. Only here are you asked to sign in with Google. Reading and copying need no sign-in.',
      regBtn: 'Add to calendar',
      msgSigningIn: 'Signing in with Google…',
      msgLoginPreparing: 'Google sign-in is still loading. Please try again in a few seconds.',
      msgLoginCancelled: 'Sign-in was cancelled.',
      msgLoginFailed: 'Sign-in failed.',
      msgRegNoTarget: 'No items are selected.',
      msgRegistering: 'Adding {i} of {n}…',
      msgRegDone: 'Added {ok} item(s).',
      msgRegFail: ' ({ng} could not be added)',
      msgSessionExpired: 'Your sign-in expired. Please press "Add to calendar" again.',
      evFrom: 'Created with Decide Dropper',
      keyTitle: '🔑 Set up your Gemini API key',
      keyNote: 'Reading with AI needs your own Gemini API key. It is free to obtain with a Google account (about 3 minutes). You are never asked for a credit card.',
      keyStepsTitle: 'How to get one',
      keyStep1: 'Open Google AI Studio from the link below',
      keyStep2: 'Sign in with your Google account',
      keyStep3: 'Click "Create API key"',
      keyStep4: 'Copy the key and paste it in the field below',
      keyStudioLink: 'Open Google AI Studio ↗',
      keyLabel: '🔑 API key',
      keyShow: 'Show the key you entered',
      keyHide: 'Hide the key you entered',
      keyTestRunning: 'Checking the connection…',
      keyTestOk: '✓ Connected successfully (model: {model})',
      keyTestInvalid: '✕ This key could not connect. Please check that it was copied in full.',
      keyTestForbidden: '✕ This key is not set up to use the Gemini API. Please create a new one in AI Studio.',
      keyTestQuota: '△ You seem to have reached today\'s usage limit. You can still save the key.',
      keyTestNetwork: '△ Could not check the connection (please check your network). You can still save it.',
      keyTestOther: '△ Could not check the connection. You can still save it.',
      keyTrustTitle: '🔒 What happens to your key',
      keyTrust1: 'It is stored only on this device (in your browser). It is not synced to other devices.',
      keyTrust2: 'We run no server, so we can receive neither your key nor what is read.',
      keyTrust3: 'It is sent only to Google\'s Gemini API. To stop, delete the key in Google AI Studio and it is void at once.',
      keyMoreLink: 'Why no credit card and no cost, explained in detail ↗',
      keyCancel: 'Cancel',
      keySave: 'Save and use',
      keyFoot: '🔒 Your key is stored only on your device (browser). It is never sent to or stored on our server.',
      keyChange: 'Change the API key'
    },

    "in": {
      pageTitle: 'Decide Dropper | Chat screenshots, notes aur minutes se decisions aur open points nikaalein',
      appName: 'Decide Dropper',
      typePrompt: 'Dropper chunein',
      toolEvent: 'Event',
      toolSchedule: 'Schedule',
      toolDecide: 'Decide',
      toolHint: 'Har ek alag cheez leta hai. Ek flyer ke liye Event, schedule sheet ke liye Schedule, chat screenshots, meeting notes ya minutes ke liye Decide.',
      lead: 'Group chat scroll karke "aakhir tay kya hua?" dhoondhne ka time bachaiye.',
      privTitle: 'Aap jo daalte hain uska kya hota hai',
      priv1: 'Hamara koi server nahi hai, isliye na images na padha gaya content hum tak aata hai.',
      priv2: 'Ye sirf Google ke Gemini API tak jaata hai, aapki apni key par.',
      priv3: '⚠️ Free tier par, jo aap bhejte hain wo Google ki services improve karne mein use ho sakta hai (paid tier par nahi). Dusron ki baatcheet ya naam wale notes/minutes daalne se pehle ye dekh lein.',
      dropTitle: 'Chat screenshots, notes ya minutes daalein',
      dropSub: 'Yahan drag karein, ya tap karke chunein',
      pickBtn: 'Files chunein',
      dropNote: 'Chat screenshots, handwritten notes, whiteboard ki photo, minutes ya committee report jaise documents, fax (PDF bhi chalega). Ek baar mein max 10. Order mein rakhein. Overlap ho to bhi theek hai.',
      filesPicked: '{n} file chune gaye',
      baseDateLabel: 'Is record ki tareekh',
      baseDateHint: '"Next Tuesday" jaisi baaton ko asli date banane ke liye. Screenshot lene ya note likhne ka din daalein.',
      runBtn: 'Padhein',
      resetBtn: 'Phir se karein',
      msgQueued: 'AI ki queue mein hain…',
      msgRunning: 'AI record padh raha hai…',
      msgRetry: 'AI busy hai. Apne aap dobara koshish ho rahi hai…',
      msgDone: 'Ho gaya. Result zaroor check karein.',
      msgNoFiles: 'Koi file nahi chuni gayi.',
      msgTooMany: 'Ek baar mein zyada se zyada 10 files.',
      msgTooLarge: 'Files ka total size bahut bada hai. Kam files use karein.',
      msgNoKey: 'API key set nahi hai, isliye rok diya.',
      msgRateMinute: 'Bahut jaldi-jaldi bheja gaya. Ek minute ruk kar dobara koshish karein.',
      msgRateDay: 'Aaj ka free quota khatam ho gaya. Kal dobara koshish karein.',
      msgBusy: 'AI busy hai. Thodi der baad koshish karein.',
      msgBadJson: 'AI ka jawab padha nahi ja saka. Dobara koshish karein.',
      msgError: 'Padhne mein dikkat: ',
      secDecided: '✅ Jo tay hua',
      secUndecided: '❓ Jo abhi tay nahi hua',
      secTodos: '📌 Karne wale kaam',
      emptyDecided: 'Koi decision nahi mila.',
      emptyUndecided: 'Kuch pending nahi mila.',
      emptyTodos: 'Koi kaam nahi mila.',
      labWho: 'Kisne kaha',
      labWaiting: 'Kiska intezaar',
      labOwner: 'Zimmedari',
      labDue: 'Deadline',
      dueFromText: 'Original: "{raw}"',
      dueUnknown: 'Koi deadline nahi likhi thi',
      checkHint: 'Ye AI ne padha hai. Khaas kar dates ko, paas mein diye original shabdon se mila kar dekh lein. Handwriting galat padhi ja sakti hai.',
      copyBtn: 'Summary copy karein',
      copiedBtn: 'Copy ho gaya',
      regNote: 'Deadline wale items calendar mein daal sakte hain. Sign-in sirf yahin maanga jaata hai. Sirf padhne aur copy karne ke liye sign-in ki zaroorat nahi.',
      regBtn: 'Calendar mein daalein',
      msgSigningIn: 'Google se sign in ho raha hai…',
      msgLoginPreparing: 'Google sign-in abhi load ho raha hai. Kuch second baad dobara koshish karein.',
      msgLoginCancelled: 'Sign-in cancel ho gaya.',
      msgLoginFailed: 'Sign-in nahi ho paya.',
      msgRegNoTarget: 'Koi item select nahi hai.',
      msgRegistering: '{n} mein se {i} daal rahe hain…',
      msgRegDone: '{ok} item daal diye.',
      msgRegFail: ' ({ng} nahi daale ja sake)',
      msgSessionExpired: 'Sign-in expire ho gaya. "Calendar mein daalein" dobara dabayein.',
      evFrom: 'Decide Dropper se banaya gaya',
      keyTitle: '🔑 Gemini API key set karein',
      keyNote: 'AI se padhne ke liye aapki apni Gemini API key chahiye. Google account ho to free mil jaati hai (lagbhag 3 minute). Credit card kabhi nahi maanga jaata.',
      keyStepsTitle: 'Kaise len',
      keyStep1: 'Niche wale link se Google AI Studio kholein',
      keyStep2: 'Apne Google account se sign in karein',
      keyStep3: '"Create API key" par click karein',
      keyStep4: 'Key copy karke niche wale field mein paste karein',
      keyStudioLink: 'Google AI Studio kholein ↗',
      keyLabel: '🔑 API key',
      keyShow: 'Entered key dikhayein',
      keyHide: 'Entered key chhupayein',
      keyTestRunning: 'Connection check ho raha hai…',
      keyTestOk: '✓ Connection successful (model: {model})',
      keyTestInvalid: '✕ Is key se connect nahi hua. Check karein ki key puri copy hui hai.',
      keyTestForbidden: '✕ Is key par Gemini API enabled nahi hai. AI Studio mein nayi key banayein.',
      keyTestQuota: '△ Aaj ki limit khatam lag rahi hai. Key phir bhi save kar sakte hain.',
      keyTestNetwork: '△ Connection check nahi ho paya (apna network dekh lein). Aap phir bhi save kar sakte hain.',
      keyTestOther: '△ Connection check nahi ho paya. Aap phir bhi save kar sakte hain.',
      keyTrustTitle: '🔒 Aapki key ka kya hota hai',
      keyTrust1: 'Ye sirf is device par (browser mein) save hoti hai. Dusre devices par sync nahi hoti.',
      keyTrust2: 'Hamara koi server nahi hai, isliye na key na padha gaya content hum tak aata hai.',
      keyTrust3: 'Ye sirf Google ke Gemini API tak jaati hai. Band karna ho to Google AI Studio mein key delete kar dein, turant band ho jayegi.',
      keyMoreLink: 'Credit card kyun nahi aur kharcha kyun zero, poora explanation ↗',
      keyCancel: 'Cancel',
      keySave: 'Save karke use karein',
      keyFoot: '🔒 Aapki key sirf aapke device (browser) mein save hoti hai. Hamare server par kabhi nahi jaati.',
      keyChange: 'API key badlein'
    }
  };

  function dict() {
    var l = global.LANG;
    return (l && I18N[l]) ? I18N[l] : I18N.ja;
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
    // <html lang> を表示言語に合わせる。3フォルダで index.html を同一に保つため、ここで書き換える。
    // in が 'en-IN' なのは sitemap の hreflang に合わせているため（勝手に変えない）。
    try {
      document.documentElement.lang = (global.LANG === 'en') ? 'en' : (global.LANG === 'in') ? 'en-IN' : 'ja';
    } catch (e) {}
    // 他のドロッパーへのリンクは、同じ言語の版へ送ること（en の利用者を ja のページへ飛ばさない）
    var ev = document.getElementById('tabEvent');
    if (ev) ev.href = (global.LANG === 'en') ? '/calendar-en/' : (global.LANG === 'in') ? '/calendar-in/' : '/calendar/';
    var sc = document.getElementById('tabSchedule');
    if (sc) sc.href = (global.LANG === 'en') ? '/schedule-en/' : (global.LANG === 'in') ? '/schedule-in/' : '/schedule/';
    // APIキーの案内ページ（周知サイト）も同じ言語の版へ
    var akPath = (global.LANG === 'en') ? 'en/apikey.html' : (global.LANG === 'in') ? 'in/apikey.html' : 'apikey.html';
    var km = document.getElementById('keyMoreLink');
    if (km) km.href = 'https://dropper-tools.com/' + akPath;

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { try { applyDom(); } catch (e) {} });
  } else {
    try { applyDom(); } catch (e) {}
  }
})(window);
