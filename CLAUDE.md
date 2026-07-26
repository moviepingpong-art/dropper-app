# dropper-app — イベントドロッパー（ツール本体）

GitHub Pages で公開している静的サイト。サーバーは無い。
公開URL: https://app.dropper-tools.com/calendar/ （en: /calendar-en/ 、Hinglish: /calendar-in/ ）

## 構成

- `calendar/` `calendar-en/` `calendar-in/` — 3言語版のツール
- `add/index.html` — 案内文リンク用の中継ページ（言語共通）

## 3言語同期の鉄則

- `app.js` `parser.js` `i18n.js` は **3フォルダで完全同一**（バイト単位で同じ）。片方だけ直さない。
- `index.html` は **`window.LANG` の値だけが違う**。丸ごとコピーすると壊れる。追加部分だけ差し込むこと。
- 検証方法: `index.html` の `window.LANG` を置換して diff を取り、一致すればOK。
- `i18n.js` に文言を足すときは **ja / en / in すべてに同じキー**を足す。

---

# ⚠️ 絶対に変更してはいけないもの（Google OAuth審査）

2026-07-19 に `calendar.events`（機密スコープ）の本番審査に**承認済み**。
以下を変更すると**新たな検証申請が必要**になり、承認済みの状態が壊れる。

## 1. OAuthスコープを増やさない（最重要）

`app.js` の `BASE_SCOPES`:

```js
var BASE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/calendar.events'   // ← 審査承認済みの機密スコープ
];
```

- **この配列に新しいスコープを足さない。**
- 新機能に別のスコープが必要になった場合は、**実装せずに必ず先にユーザーへ確認する**。
  「その機能にはスコープ追加が必要で、Googleの再審査（数週間）が発生します」と伝えること。
- `CLUB_EXTRA_SCOPES`（`spreadsheets`）は `?club=hakusan` のクラブモード専用で、テストユーザー運用。
  **`BASE_SCOPES` 側へ移さない。**

## 2. 同意画面の登録内容と食い違わせない

Googleに登録済み: アプリ名「ドロッパー」／ホームページ `https://dropper-tools.com` ／
プライバシーポリシー `https://dropper-tools.com/privacy.html`

- 承認済みJavaScript生成元は `https://app.dropper-tools.com` のみ。
  別ホストで動かす前提のコードや、生成元の追加を必要とする変更を入れない。

---

# ハマり所（既知）

## LINEでのリンク共有（案内文ジェネレーター）

案内文に貼るリンクには、実測で判明した2つの制約がある。

1. **`%` を含むURLはLINEが壊す** — 本文中URLの `%`（日本語のエンコード部分）をタップ時に再エンコードし、
   Googleに渡るタイトル・場所が文字化けする。
   → 対策済み: 案内リンクは `%` を含まない base64url に符号化し、`add/index.html` の中継ページ経由で
   正規のGoogleカレンダー／地図URLへ組み立て直す。**この経路を外さない。**
2. **長いURLはリンク化されない** — 青下線にもタップ可能にもならず、ただの文字列になる。
   実測: 128字・237字＝OK、453字＝NG。
   → カレンダー追加リンクは **大会名＋日程＋会場名のみ**に保つ。詳細（試合形式・締切・住所・
   key_info）をリンクに詰め込むと再発する。

## GitHub Pages

コミットしても**古いファイルが配信され続ける**ことがある。原因は build ジョブ失敗 → deploy が Skipped。
再アップロードで解決する。配信中の実物は `https://app.dropper-tools.com/calendar/` を直接取得して確認する
（ブラウザキャッシュと切り分けるため）。

## AI（Gemini BYOK）

- APIキーはユーザー自身のもの。`localStorage` の `dropper_ai_key` に端末内保持し、サーバーへ送らない。
- 抽出プロンプトは `promptJa` / `promptEn` を `window.LANG` で選択する。
  **en/in 版で日本語プロンプトを使わないこと**（英語要項が日本語に翻訳されてしまう）。
- レート制限対策で約5秒のスロットルを入れている（`AI_MIN_INTERVAL_MS`）。外さない。

## その他

- `?club` の値は厳密に `hakusan`。末尾に余計な文字が付くと `CLUB_MODE=false` になる。
- ツール本体に `<footer>` は無い（`<header>` と `<main>` のみ）。導線はヘッダーに置く。

---

# 主要な定数・ID

- Cloud Console プロジェクトID: `dropper-499204`（組織 movie-pingpong-org）
- ROOT_FOLDER_ID: `1q_3cknEoJzFezW3yuiLTKQ4mo1siicQM`
- REVIEW_SHEET_ID: `10p2LrxC01UpvjTekBF_wiS9kvWLXWcgmYGWKYBdIczE`
- AI_MIN_INTERVAL_MS: `5000`（Gemini RPM対策のスロットル）
- 白山クラブ用GAS版: `hakusan_calendar_v17k.gs`（抽出ロジックはWeb版 `parser.js` と同期が必要）

---

# 進め方（ユーザーの好み）

- **一気に全部やらず、区切りごとに確認を取る。**
- 変更したら、**確認URLと確認ポイント**をセットで伝える。
- 3言語まとめて扱う。
