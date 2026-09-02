---
name: deploy-check
description: dropper-appの3言語同期チェックとGitHubアップロード手順の提示。app.js/parser.js/i18n.js/index.htmlを修正した後、GitHubに反映する前に必ず使う。
---

# dropper-app デプロイ前チェック

## 手順1：同期チェックを流す

```
node tools/sync-check.js
```

これ1本で、`CLAUDE.md` に書かれている「壊すと気づきにくい」約束ごとをまとめて見る。
**1つでも落ちたら終了コード 1**。直してからアップロードすること。

| # | 内容 |
|---|---|
| 1 | 3言語フォルダの共有JSがバイト同一か（`calendar*` `schedule*` `decide*` の**全JS**） |
| 2 | `index.html` の `</head>` 以降が `window.LANG` 以外は同一か |
| 3 | JSの構文（`node --check`） |
| 4 | i18n の ja / en / in にキーの過不足が無いか |
| 5 | `attend/` が原本（`hakusan-attendance`）とバイト同一か |
| 6 | `LICENSE` が3リポジトリでバイト同一か |
| 7 | `BASE_SCOPES` が審査済みの3つのままか |

### ★ head の中は揃えない

`index.html` で同一でなければならないのは **`</head>` から後ろ**だけ。
head の中の `title` / `description` / `canonical` / `og:*` / `twitter:*` / JSON-LD は
**言語ごとに違うのが正しい**（現在28行）。ここを揃えると多言語SEOが壊れる。

以前この手順書には「`window.LANG` を置換して diff を取り、差分ゼロなら正しい」と書いてあったが、
それだとファイル全体を見るため**必ず28行の差が出る**。誤検知するので、その方法は使わないこと。

### スクリプトが見ていないもの

- **`?v=` の繰り上げ**。変えたファイルと `index.html` の対応は人が決める。
  `app.js` や `i18n.js` を直したら、3ビルドの `index.html` の `?v=` も一緒に上げること
  （上げ忘れると、一度でも開いた端末は古いJSを使い続ける）。
- 5・6 は隣に別リポジトリが要る（`drop-repos/` に並んでいること）。無ければその項目だけ飛ばす。

---

## 手順2：OAuth審査に触れていないか

スクリプトの 7 が機械的に見るが、**増えていたときの判断は人がする**。

新しいスコープが増えていたら**コミットせず**、ユーザーに
「その機能にはスコープ追加が必要で、Googleの再審査（数週間）が発生します」と伝えて判断を仰ぐ。

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
