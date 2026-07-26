# dropper-app — イベントドロッパー

大会要項（PDF・画像）を**ドラッグ&ドロップするだけ**で、大会名・日程・会場などを読み取り、
そのまま **Google カレンダー**に予定として登録できる Web ツールです。

サーバーを持たない**静的サイト**で、GitHub Pages で公開しています。

## 公開URL

| 言語 | URL |
|---|---|
| 日本語 | https://app.dropper-tools.com/calendar/ |
| English | https://app.dropper-tools.com/calendar-en/ |
| Hinglish | https://app.dropper-tools.com/calendar-in/ |

- サービスサイト（紹介・使い方ガイド・プライバシーポリシー）: https://dropper-tools.com

## できること

1. **競技を選ぶ** — 競技に合わせて読み取りを最適化します。
2. **要項ファイルをドロップ** — PDF・画像（JPEG/PNG）に対応。複数まとめてドロップも可。
3. **内容を確認・修正** — 大会名・開催日・試合形式・会場などを画面上で確認して直せます。
4. **Google カレンダーに登録** — 確認した内容をそのまま予定として追加します。
   要項ファイルは Google ドライブの `DropperFiles` フォルダに保存され、予定にリンクが添付されます。
5. **案内文ジェネレーター** — 大会の案内文を生成し、LINE などで共有できます。
   共有リンクはタップでカレンダー追加／地図表示につながります。

### 読み取りの2モード

- **通常モード** — 追加設定なしで、すぐ無料で使えます。Google の OCR で変換し、必要項目を抽出します。
- **AIモード（任意）** — 利用者ご自身の **Google Gemini APIキー**を使って、全項目を AI で読み取ります。
  精度が上がります。キーは**利用者の端末内（ブラウザ）だけに保存**され、当方のサーバーには送信も保存もしません。

## プライバシー

- 処理は**利用者のブラウザ内で完結**します（当方のサーバーはありません）。
- Gemini APIキーや読み取り結果を、当方が収集・保存することはありません。
- Google カレンダー／ドライブへのアクセスは、利用者自身の認可（OAuth）にもとづいて行われます。
- 詳細は[プライバシーポリシー](https://dropper-tools.com/privacy.html)をご覧ください。

## 構成

```
calendar/      日本語版（app.js / parser.js / i18n.js / index.html）
calendar-en/   English 版
calendar-in/   Hinglish 版
add/           案内文リンク用の中継ページ（言語共通）
CNAME          カスタムドメイン設定（app.dropper-tools.com）
.nojekyll      GitHub Pages の Jekyll ビルドをスキップ
```

- `app.js` `parser.js` `i18n.js` は **3言語フォルダで完全同一**です。
- `index.html` は `window.LANG` の値だけが異なります。

## 技術

- 静的サイト（HTML / CSS / バニラ JavaScript）— ビルド不要、サーバーレス
- Google Identity Services（OAuth）／ Google Calendar API ／ Google Drive API
- Google Gemini API（利用者の BYOK：Bring Your Own Key、任意）
- ホスティング: GitHub Pages（カスタムドメイン `app.dropper-tools.com`）

## 開発について

開発上の注意事項（3言語同期の鉄則、OAuth 審査で変更してはいけない箇所、既知のハマり所など）は
[`CLAUDE.md`](CLAUDE.md) にまとめています。

## ライセンス

本ソフトウェアは**無断利用禁止（All Rights Reserved）**です。閲覧目的でのみ公開しています。
複製・改変・再配布・他サービスへの利用には、著作権者の事前の許可が必要です。
詳細は [`LICENSE`](LICENSE) をご覧ください。
