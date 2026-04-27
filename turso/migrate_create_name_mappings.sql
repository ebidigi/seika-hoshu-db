-- ============================================================
-- マイグレーション: 名前マッピングテーブル作成
-- 目的: GAS Utils.jsのMEMBER_NAME_MAPをDB管理に移行
-- ============================================================

CREATE TABLE IF NOT EXISTS member_name_mappings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  raw_name TEXT NOT NULL UNIQUE,
  canonical_name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mnm_canonical ON member_name_mappings(canonical_name);
