---
name: deploy-check
description: dropper-appの3言語同期チェックとGitHubアップロード手順の提示。app.js/parser.js/i18n.js/index.htmlを修正した後、GitHubに反映する前に必ず使う。
---

# dropper-app デプロイ前チェック

## 手順1：3言語ファイルの同期確認

3フォルダ（`calendar/` `calendar-en/` `calendar-in/`）で以下を検証する。

### 1-1. 共通JSは完全同一か

`app.js` `parser.js` `i18n.js` は**バイト単位で同じ**でなければならない。

```
md5sum calendar/app.js calendar-en/app.js calendar-in/app.js
md5sum calendar/parser.js calendar-en/parser.js calendar-in/parser.js
md5sum calendar/i18n.js calendar-en/i18n.js calendar-in/i18n.js
```

3つのハッシュが一致すればOK。1つでも違えば同期漏れ。

### 1-2. index.html は window.LANG だけが違うか

丸ごとコピーすると壊れる。**追加部分だけ差し込む**こと。

検証方法：`window.LANG` の値を揃えて diff を取り、差分ゼロなら正しい。

```
sed "s/window.LANG *= *'[a-z]*'/window.LANG='X'/" calendar/index.html > /tmp/ja.html
sed "s/window.LANG *= *'[a-z]*'/window.LANG='X'/" calendar-en/index.html > /tmp/en.html
diff /tmp/ja.html /tmp/en.html
```

### 1-3. 構文チェック

```
node --check calendar/app.js
node --check calendar/parser.js
node --check calendar/i18n.js
```

### 1-4. i18n キーの過不足

`i18n.js` に文言を足したときは **ja / en / in すべてに同じキー**があるか確認する。

---

## 手順2：OAuth審査に触れていないか（必ず確認）

`app.js` の `BASE_SCOPES` に**新しいスコープが増えていないか**を確認する。
増えていたらコミットせず、ユーザーに「再審査（数週間）が発生する」と伝えて判断を仰ぐ。

---

## 手順3：GitHubアップロード手順の提示

ユーザーにファイルを渡すときは、必ず以下をセットで提示する。

1. **アップロード先**（どのフォルダのどのファイルを差し替えるか）
2. **反映後の確認URL**
   - 日本語：https://app.dropper-tools.com/calendar/
   - 英語：https://app.dropper-tools.com/calendar-en/
   - Hinglish：https://app.dropper-tools.com/calendar-in/
3. **確認ポイント**（何が変わったか、どこを見れば動作確認できるか）

3言語分は1つのZIPにまとめて渡す。

---

## 注意

- **1言語だけ更新しない**（必ず3言語まとめて）
- GitHub Pages はコミット後も**古いファイルが配信され続ける**ことがある
  （build失敗→deploy Skipped）。再アップロードで解決する。
  切り分けは確認URLを直接取得して行う（ブラウザキャッシュと区別するため）。
