# チーム900 管理DB - 開発ドキュメント

## 概要
成果報酬チーム（チーム900）の売上・実績管理を一元化するダッシュボードシステム。
Google Sheetsの#REF!エラー多発・構造複雑化の課題を解決するために構築。

## アーキテクチャ

```
[Google Sheets: 実績rawdata / 売上報告rawdata]
  → [GAS 15分同期] → [Turso DB (SQLite互換)]
                            ↓
[ブラウザ Dashboard] ← [Turso HTTP API 直接クエリ]
                            ↓
[GAS 定時トリガー] → [Slack通知]
```

### 技術スタック
| レイヤー | 技術 |
|----------|------|
| Frontend | HTML/CSS/JS (Vanilla SPA) |
| DB | Turso (SQLite互換) |
| API/Sync | Google Apps Script |
| データソース | Google Sheets |
| 通知 | Slack API via GAS |

## チーム構成

```
チーム900 全体（月間目標: ¥9,000,000）
├── 野口Team（野口, 中村 峻也, 田中克樹, 辻森）目標: ¥3,800,000
├── 松居Team（松居, 山本, 美除）目標: ¥2,240,000
└── 坪井Team（坪井, 村松, 田中颯汰）目標: ¥3,184,000
```

## ファイル構成

```
成果報酬DB/
├── index.html          # メインダッシュボード（タブ切替式SPA）
├── app.js              # フロントエンドロジック
├── style.css           # スタイル（DigiManブランド）
├── schema.sql          # DBスキーマ定義
├── deploy.sh           # CSSとJSをインライン化した単一HTMLを生成
├── CLAUDE.md           # Claude Code用プロジェクトドキュメント
├── DEVELOPMENT.md      # この開発ドキュメント
└── gas/
    ├── .clasp.json     # clasp設定（scriptId）※Gitには含めない
    ├── appsscript.json # GASマニフェスト
    ├── Code.js         # GAS APIエンドポイント
    ├── SyncToTurso.js  # 実績・売上報告データ同期
    ├── SlackNotify.js  # Slack定時通知（12/15/18/20時）
    └── Utils.js        # 共通ユーティリティ・設定
```

## 主要設定値

### Turso DB
- **URL**: `libsql://seika-hoshu-db-ebidigi.aws-ap-northeast-1.turso.io`
- **HTTP API**: `https://seika-hoshu-db-ebidigi-ebidigi.aws-ap-northeast-1.turso.io`
- **API形式**: v2 (`statements: [{q: sql, params: args}]`)

### Google Sheets
- **スプレッドシートID**: `1Qo9LvDqUgkPVcaoDN-t4p8YKryoILKEMdMugDlpDTIQ`
- **実績rawdata**: 8列（担当者, 案件名, 日付, 架電時間, 架電数, PR数, アポ数, 定性FB）
- **売上報告rawdata**: 16列（営業担当者, 売上種別, 案件名, 会社名, 取得日, 実施日時, 金額, 部署, 役職, 名前, 電話番号, メールアドレス, 架電ヒアリング, 営業区分, リスケ, 取引）

### Team900シート
- **スプレッドシートID**: `1zTZbAcp-K9AlzJLGoIABXAd-l-BkvdXXW7A3s9i6GTs`
- 各ペアシートのH56に目標金額

### GAS
- **scriptId**: `1GCT9yxq5-YLT80OEDh5tVWhRZe_7DBpegGpqZ22sIY7F_kJrwFMD_VQ1`
- **Slackチャンネル**: `C0ACA4Q05PB`
- **同期対象日数**: 45日

## データベーススキーマ

### テーブル一覧
| テーブル | 用途 |
|----------|------|
| `teams` | チームマスタ |
| `members` | メンバーマスタ |
| `projects` | 案件マスタ |
| `performance_rawdata` | 実績データ（架電数/PR数/アポ数） |
| `appointments` | アポイント詳細・確認管理 |
| `project_monthly_caps` | 案件月次キャップ管理 |
| `project_member_assignments` | 案件×メンバー アサイン管理（月次） |
| `targets` | 月次目標管理 |
| `daily_targets` | 日次目標 |
| `holidays` | 休日マスタ |
| `settings` | 設定KV |

### 重要なユニーク制約
- `performance_rawdata`: `UNIQUE(member_name, project_name, input_date)`
- `appointments`: `UNIQUE INDEX(member_name, project_name, acquisition_date, customer_name)`
- `project_member_assignments`: `UNIQUE(member_name, project_name, year_month)`
- `targets`: `UNIQUE(target_type, target_name, year_month)`

## ダッシュボード タブ構成

1. **概要**: チーム全体KPI（取得金額/実施金額の両方表示）、チーム別・個人別進捗
2. **アポ確認**: 週次確認ビュー、ステータス変更（実施/リスケ/キャンセル）、確認率
3. **歩留まり**: ファネル分析（架電→PR→アポ）、診断・示唆、架電/時間ベース判定
4. **案件管理**: 案件一覧、月次キャップ、案件×メンバーアサイン管理（CRUD）
5. **詳細分析**: 日次/週次/月次切替、メンバー×案件マトリクス
6. **設定**: 目標入力、レート設定、メンバー/チーム管理

## ビジネスロジック

### 売上計算
- **取得金額**: `appointments`テーブルで`acquisition_date`が当月のレコードの`amount`合計
- **実施金額**: `appointments`テーブルで`scheduled_date`が当月（キャンセル/リスケ除外）の`amount`合計
- **実施見込**: 実施確定 + 未確認 × キャンセル率(80%)

### アポステータス管理
| ステータス | 意味 | 請求 |
|-----------|------|------|
| 未確認 | 未確認 | 見込み |
| 実施 | 実施確定 | 請求可 |
| リスケ | 日程変更 | 翌月以降 |
| キャンセル | キャンセル | 請求不可 |

### GAS同期時のステータス保護
ダッシュボードで確認済み（`confirmation_date IS NOT NULL`）のアポは、GAS同期時にステータスを上書きしない:
```sql
status = CASE WHEN appointments.confirmation_date IS NOT NULL
         THEN appointments.status
         ELSE excluded.status END
```

### 歩留まり診断
- 架電/時間 < 40件 → オペレーション課題
- 架電toPR率が低い → リスト品質問題
- PRtoアポ率が低い → トーク品質問題
- 単価 × 架電toアポ率 < 7 → 案件収益性アラート

### レート設定
- キャンセル率デフォルト: 80%（`settings`テーブル `cancel_rate_default`）
- 次月流れ率: 50%（`settings`テーブル `next_month_flow_rate`）

## メンバー名マッピング

スプレッドシート上の名前とDBの対応:
| スプシ名 | DB member_name | チーム |
|----------|---------------|--------|
| 野口 | 野口 | 野口Team |
| 中村 峻也 | 中村 峻也 | 野口Team |
| 田中克樹 | 田中克樹 | 野口Team |
| 辻森 | 辻森 | 野口Team |
| 松居 | 松居 | 松居Team |
| 山本 | 山本 | 松居Team |
| 美除 | 美除 | 松居Team |
| 坪井 | 坪井 | 坪井Team |
| 村松 | 村松 | 坪井Team |
| 田中颯汰 | 田中颯汰 | 坪井Team |

`isSeikaTeamMember()`は`includes()`で部分一致判定。

## デプロイ手順

### ダッシュボード
```bash
bash deploy.sh
# → /Users/ebineryota/seika_hoshu_db.html に出力
```

### GAS
```bash
cd gas
clasp push
```

### GitHub Pages
mainブランチにプッシュすると自動でPages公開:
```
https://ebidigi.github.io/seika-hoshu-db/
```

## GASトリガー設定

| 関数 | 頻度 | 用途 |
|------|------|------|
| `syncPerformanceToTursoSeika` | 15分毎 | 実績rawdata同期 |
| `syncSalesReportToTursoSeika` | 15分毎 | 売上報告rawdata同期 |
| `sendSlackReportSeika` | 12/15/18/20時 | Slack定時通知 |

※ 営業時間外（8時前/21時以降）はスキップ

## アポ確認ワークフロー

1. **メンバー**: スプレッドシートに実績入力（従来通り）
2. **GAS同期**: 15分毎にTurso DBに同期（新規アポは「未確認」ステータス）
3. **TL**: ダッシュボードTab2でアポステータスを確認・更新
4. **マネージャー**: 概要タブで全体進捗・確認率を確認
5. **GAS再同期**: 確認済みアポのステータスは上書きしない（`confirmation_date`チェック）

## 既知の注意事項

- Team900シートの目論見修正はエラーなし（GASはrawdataシートのみ参照）
- 各ペア目標合計(¥9,224,000)と全体目標(¥9,000,000)は一致しない（留意事項）
- `田中颯汰`は今後稼働予定のメンバー
- `gas/.clasp.json`はGitに含めない（スクリプトID含む）
