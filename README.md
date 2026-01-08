# 情シスの番猫シスにゃん (GAS Slack Helpdesk Bot)

Slack上の質問に対して社内ナレッジ（Spreadsheet）を参照して自動回答するBotです。
Google Apps Script (GAS) だけで動作し、サーバー構築は不要です。

## 🚀 特徴
- **自動回答**: Gemini / Groq API を使用し、自然な日本語で回答。
- **解決判定**: ユーザーからの「ありがとう」等の感謝言葉で解決とみなし、完了メッセージを送信。
- **有人エスカレーション**: Botへの返信が「感謝」以外の場合、自動で管理者チャンネルへエスカレーション（Reply-All-Escalate仕様）。
- **分析レポート**: 週次で対応件数や削減工数を自動集計してSlack投稿。

## 📂 プロジェクト構成
```text
.
├── appsscript.json      # GAS設定
├── .clasp.json          # clasp設定
└── src/
    ├── 00_config.js     # 定数・設定
    ├── 01_main.js       # トリガーエントリーポイント
    ├── 02_botApp.js     # メインロジック
    ├── 03_services.js   # 各種サービスクラス (Slack, AI, KB)
    ├── 04_logger.js     # ログ・レポート機能
    ├── 99_utils.js      # 便利関数
    └── setup.js         # ★初回セットアップ用