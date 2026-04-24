# 成果報酬チーム管理DB

成果報酬チーム（チーム900）の売上・実績管理ダッシュボード。
Google Sheets のデータを Turso DB に同期し、ブラウザ上でリアルタイムに可視化する。

## アーキテクチャ

```
Google Sheets (実績rawdata / 売上報告rawdata)
       │
       │  GAS 15分同期トリガー
       ▼
Turso DB (SQLite互換・クラウド)
       │
       │  HTTP API (v3 Pipeline)
       ▼
ブラウザ Dashboard (Vanilla JS SPA)

       +── GAS 定時トリガー ──▶ Slack通知 (12/15/18/20時)
```

| レイヤー | 技術 |
|----------|------|
| Frontend | HTML / CSS / JavaScript (フレームワークなし) |
| DB | [Turso](https://turso.tech) (libSQL / SQLite互換) |
| 同期 / API | Google Apps Script |
| データソース | Google Sheets |
| 通知 | Slack Bot API |
| グラフ | Chart.js + chartjs-plugin-datalabels |

## セットアップ

### 前提条件

- Node.js (clasp 用)
- Google アカウント (GAS アクセス権)
- [clasp](https://github.com/nicedayfor/clasp) インストール済み

```bash
npm install -g @google/clasp
clasp login
```

### 1. リポジトリのクローン

```bash
git clone https://github.com/ebidigi/seika-hoshu-db.git
cd seika-hoshu-db
```

### 2. GAS プロジェクトの接続

`gas/.clasp.json` に scriptId が設定済み。初回は以下で認証:

```bash
clasp login
```

### 3. GAS スクリプトプロパティの設定

GAS エディタ > プロジェクトの設定 > スクリプトプロパティ に以下を設定:

| キー | 値 | 説明 |
|------|-----|------|
| `SEIKA_TURSO_DATABASE_URL` | `libsql://seika-hoshu-db-ebidigi-ebidigi.aws-ap-northeast-1.turso.io` | Turso 接続URL |
| `SEIKA_TURSO_AUTH_TOKEN` | (Turso ダッシュボードから取得) | DB 認証トークン |
| `SLACK_BOT_TOKEN` | (Slack App 管理画面から取得) | Slack Bot トークン |

### 4. GAS トリガーの設定

GAS エディタで `setupTriggersSeika()` を1回実行。以下のトリガーが自動作成される:

| 関数 | 頻度 | 用途 |
|------|------|------|
| `syncPerformanceToTursoSeika` | 15分毎 | 実績データ同期 |
| `syncSalesReportToTursoSeika` | 15分毎 | 売上報告同期 |
| `sendTaaanDailySummary18` | 毎日18時 | TAAAN日次サマリ |
| `syncSlackAppoStatusToTurso` | 15分毎 | Slackアポステータス同期 |

営業時間外 (8時前 / 21時以降) は自動スキップ。

## ファイル構成

```
seika-hoshu-db/
├── index.html            # ダッシュボード HTML (タブ切替式 SPA)
├── app.js                # フロントエンドロジック (227KB)
├── style.css             # スタイル (DigiMan ブランド)
├── schema.sql            # DB スキーマ定義
├── deploy.sh             # CSS/JS をインライン化した単一 HTML を生成
├── CLAUDE.md             # Claude Code 用コンテキスト
├── DEVELOPMENT.md        # 詳細開発ドキュメント
├── docs/
│   ├── requirements.md           # 要件定義
│   ├── dashboard-requirements.md # ダッシュボード機能仕様
│   ├── dashboard-improvement-plan.md
│   └── code-review.md
└── gas/
    ├── .clasp.json         # clasp 設定 (scriptId)
    ├── appsscript.json     # GAS マニフェスト
    ├── Code.js             # API エンドポイント & トリガーセットアップ
    ├── SyncToTurso.js      # Sheets → Turso 同期 (実績 + 売上報告)
    ├── SlackNotify.js      # Slack 定時通知
    ├── SlackAppoSync.js    # Slack アポステータス双方向同期
    └── Utils.js            # 共通ユーティリティ (Turso API, メンバー名正規化)
```

## 開発ワークフロー

### ダッシュボード (HTML/CSS/JS)

```bash
# ローカル確認
python3 -m http.server 8000
# → http://localhost:8000 をブラウザで開く

# 本番用単一 HTML 生成
bash deploy.sh
# → ~/seika_hoshu_db.html に出力
```

### GAS

```bash
# ローカルの変更を GAS に反映
cd gas && clasp push

# GAS エディタを開く
open "https://script.google.com/d/1GCT9yxq5-YLT80OEDh5tVWhRZe_7DBpegGpqZ22sIY7F_kJrwFMD_VQ1/edit"
```

### GitHub Pages

`main` ブランチへの push で自動公開:
```
https://ebidigi.github.io/seika-hoshu-db/
```

## データフロー詳細

### 同期の流れ

1. メンバーが Google Sheets に架電実績・アポ情報を入力
2. GAS が15分毎にシートを読み取り、Turso DB に UPSERT
3. ダッシュボードがブラウザから Turso HTTP API を直接クエリして表示
4. GAS が定時に Slack へ進捗通知を送信

### メンバー名の正規化

スプレッドシートには様々な表記（フルネーム、メールアドレス、Slack形式）が混在する。
`Utils.js` の `normalizeMemberName()` が DB 登録名に統一する:

```
"坪井 秀斗"          → "坪井"
"s.tsuboi@digi-man.com" → "坪井"
"@坪井/U12345"       → "坪井"
```

マッピングは `Utils.js` の `MEMBER_NAME_MAP` で管理。
新メンバー追加時はここにエントリを追加する。

### アポステータス管理

| ステータス | 意味 | 請求 |
|-----------|------|------|
| 未確認 | 同期直後の初期値 | 見込み (80%) |
| 実施 | 実施確定 | 請求可 |
| リスケ | 日程変更 | 翌月以降 |
| キャンセル | キャンセル | 請求不可 |

ダッシュボードで確認済み (`confirmation_date` 有) のアポは、GAS 再同期時にステータスを上書きしない。

## チーム構成 (2026年4月時点)

```
成果報酬チーム（月間目標: ¥9,000,000）
├── 三善Team: 三善, 宮城, 田中か
├── 轟Team:   轟, 堀切
├── 野口Team: 野口, 中村た, 野上, 村上
├── 松居Team: 松居, 山本, 美除
└── 坪井Team: 坪井, 池田, 村松, 田中颯汰
```

メンバーの追加・異動は:
1. `schema.sql` に INSERT 文を追加
2. DB に直接 INSERT (ダッシュボードの設定タブからも可)
3. `Utils.js` の `MEMBER_NAME_MAP` にマッピングを追加

## 外部サービス

| サービス | 用途 | ダッシュボード URL |
|---------|------|-------------------|
| [Turso](https://app.turso.tech) | DB 管理・使用量確認 | app.turso.tech |
| [GAS](https://script.google.com) | 同期スクリプト管理 | 上記 scriptId リンク |
| Google Sheets | 元データ (ID: `1Qo9LvD...`) | - |
| Slack | 通知チャンネル `C0ACA4Q05PB` | - |

## トラブルシューティング

### 同期が止まっている

1. **GAS エディタでログ確認**: `syncPerformanceToTursoSeika` の実行履歴を見る
2. **Turso プランの確認**: Starter プラン (無料) は月間書き込み上限あり。上限超過で全 INSERT がブロックされる。`app.turso.tech` で Usage を確認
3. **手動同期**: GAS エディタで `syncPerformanceToTursoSeika()` → `syncSalesReportToTursoSeika()` を順に実行
4. **診断**: `diagnoseTursoSync()` を実行すると、接続・SELECT・INSERT を個別にテストしてログに出力

### ダッシュボードにデータが表示されない

1. ブラウザの開発者ツール > Console でエラーを確認
2. Turso の認証トークン期限切れの可能性 → `app.js` 冒頭の `TURSO_CONFIG.authToken` を更新
3. ネットワークタブで Turso API のレスポンスを確認

### メンバー名が正しく変換されない

1. `Utils.js` の `MEMBER_NAME_MAP` に対象の名前/メールアドレスのエントリがあるか確認
2. GAS エディタで `diagnoseTursoSync()` を実行 → ログにスプレッドシートの名前変換結果が表示される

### 全データの再同期 (リカバリ)

```
GAS エディタで backfillAllToTurso() を実行
```

全期間のデータを一括で UPSERT する。通常の同期は直近45日分のみ。

## セキュリティ注意事項

- `app.js` に Turso 認証トークンがハードコードされている (読み取り専用用途)
- GAS のシークレットはスクリプトプロパティで管理 (リポジトリには含まれない)
- Turso トークンは定期的にローテーション推奨

## 関連ドキュメント

- [DEVELOPMENT.md](DEVELOPMENT.md) — 詳細な開発ドキュメント (ビジネスロジック、PL計算等)
- [docs/requirements.md](docs/requirements.md) — 要件定義
- [docs/dashboard-requirements.md](docs/dashboard-requirements.md) — ダッシュボード機能仕様
