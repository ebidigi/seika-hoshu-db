# コードレビュー結果

## 要修正（高優先度）

### 1. isSeikaTeamMember が正規化前の名前でフィルタしている
- **ファイル**: gas/Utils.js, gas/SyncToTurso.js
- **影響**: スペースなし表記（`宮城啓生`）などの場合、SEIKA_MEMBERS とマッチせずデータが同期されない
- **対策**: isSeikaTeamMember を正規名ベースに変更。normalizeMemberName() の結果で判定する

### 2. syncSlackAppoStatusToTurso() が未定義
- **ファイル**: gas/Code.js:25, 58
- **影響**: `?action=sync` 実行時とトリガー登録時に ReferenceError
- **対策**: 実装を追加するか呼び出しを削除

### 3. 歩留まりアラート（alertFlag）が常に false
- **ファイル**: app.js renderYield内
- **影響**: `toFixed()` は文字列を返すため `typeof profitIndex === 'string'` が常に true → アラートが一切出ない
- **対策**: profitIndex を数値型で保持してから比較

### 4. SlackNotify.js に宮城Team未追加 + 田中颯汰の名前不一致
- **ファイル**: gas/SlackNotify.js:93
- **影響**: Slack通知のチーム別集計に宮城が含まれない。田中颯 → 田中颯汰に要修正
- **対策**: teams オブジェクトに宮城Team追加、DB正規名と完全一致に統一

### 5. executeTursoPipeline の破壊的 push
- **ファイル**: gas/Utils.js:77
- **影響**: requests 配列を再利用した場合に close が複数付与される（現状は実害なし）
- **対策**: `[...requests, { type: 'close' }]` でコピーを作成

## 要修正（中優先度）

### 6. アポ確認テーブルの日付がUTCベース
- **ファイル**: app.js:770
- **影響**: JST 0〜9時に前日扱いになる
- **対策**: `new Date().toISOString().split('T')[0]` → `formatDate(new Date())`

### 7. 設定タブのチーム目標に宮城Team未追加
- **ファイル**: app.js renderSettings内
- **影響**: 宮城Teamの月次目標が設定できない
- **対策**: チーム配列に '宮城Team' を追加

### 8. CSS変数 var(--border) が未定義
- **ファイル**: style.css（today-summary-card）
- **影響**: カードの枠線が意図した色にならない
- **対策**: `var(--border)` → `var(--border-color)` に修正

### 9. Slack API レスポンス未検証
- **ファイル**: gas/Utils.js sendSlackNotificationSeika
- **影響**: Slack API が ok:false を返してもエラー検知されない
- **対策**: レスポンスの ok フィールドを検証

### 10. SlackNotify.js の includes() によるメンバーマッチ
- **ファイル**: gas/SlackNotify.js:101
- **影響**: 部分一致のため将来的に誤マッチリスク
- **対策**: 完全一致 `===` に変更

## 改善推奨（低優先度）

### 11. executeTurso がqueryTursoのラッパーで冗長
- app.js:88-90 → 削除してqueryTursoに統一

### 12. filterAppoStatus / toggleAppoRange で未使用変数
- `const filter = getFilters()` が使われていない → 削除

### 13. switchTab で localStorage に保存するがページ読み込み時に復元しない
- 保存処理を削除するか復元ロジックを追加

### 14. MEMBER_NAME_MAP の恒等変換エントリ
- `'田中颯汰': '田中颯汰'` は不要 → 削除

### 15. normalizeMemberName の部分一致ループ順序
- キー長降順でソートして長い名前から先にマッチさせる（将来の安全性）

## セキュリティ

### 16. Turso authToken がソースコードにハードコード
- **ファイル**: app.js:3-4
- **影響**: ブラウザDevToolsやGitリポジトリから誰でも取得可能
- **対策**: 中間APIを設けるか、トークンのIP制限を設ける（構造的課題のため別途検討）

### 17. GAS doGet に認証なし
- **ファイル**: gas/Code.js:11-47
- **影響**: URLを知っていれば誰でも `?action=sync` を叩ける
- **対策**: シークレットトークンによる認証を追加
