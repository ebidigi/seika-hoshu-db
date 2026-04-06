-- 成果報酬DB スキーマ定義
-- Database: seika-hoshu-db-ebidigi.aws-ap-northeast-1.turso.io

-- チームマスタ
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  team_name TEXT NOT NULL UNIQUE,
  leader_name TEXT,
  status TEXT DEFAULT 'active'
);

-- メンバーマスタ
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  member_name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  team_name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

-- 案件マスタ
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  project_name TEXT NOT NULL UNIQUE,
  client_name TEXT,
  unit_price INTEGER DEFAULT 0,
  monthly_cap_count INTEGER,
  monthly_cap_amount INTEGER,
  call_list_url TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 実績データ
CREATE TABLE IF NOT EXISTS performance_rawdata (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  member_name TEXT NOT NULL,
  project_name TEXT NOT NULL,
  input_date TEXT NOT NULL,
  call_hours REAL DEFAULT 0,
  call_count INTEGER DEFAULT 0,
  pr_count INTEGER DEFAULT 0,
  appointment_count INTEGER DEFAULT 0,
  appointment_amount INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(member_name, project_name, input_date)
);

-- アポイント詳細・確認管理
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  member_name TEXT NOT NULL,
  project_name TEXT NOT NULL,
  acquisition_date TEXT NOT NULL,
  scheduled_date TEXT,
  actual_date TEXT,
  unit_price INTEGER DEFAULT 0,
  amount INTEGER DEFAULT 0,
  status TEXT DEFAULT '未確認',
  confirmation_date TEXT,
  confirmed_by TEXT,
  reschedule_date TEXT,
  customer_name TEXT,
  memo TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_appo_unique ON appointments(member_name, project_name, acquisition_date, customer_name);
CREATE INDEX IF NOT EXISTS idx_appo_member ON appointments(member_name);
CREATE INDEX IF NOT EXISTS idx_appo_project ON appointments(project_name);
CREATE INDEX IF NOT EXISTS idx_appo_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appo_scheduled ON appointments(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_appo_acquisition ON appointments(acquisition_date);

-- 案件月次キャップ管理
CREATE TABLE IF NOT EXISTS project_monthly_caps (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  project_name TEXT NOT NULL,
  year_month TEXT NOT NULL,
  cap_count INTEGER,
  cap_amount INTEGER,
  actual_count INTEGER DEFAULT 0,
  actual_amount INTEGER DEFAULT 0,
  UNIQUE(project_name, year_month)
);

-- 目標管理
CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  target_type TEXT NOT NULL,
  target_name TEXT NOT NULL,
  year_month TEXT NOT NULL,
  sales_target INTEGER DEFAULT 0,
  execution_target INTEGER DEFAULT 0,
  call_hours_target REAL DEFAULT 0,
  call_count_target INTEGER DEFAULT 0,
  pr_count_target INTEGER DEFAULT 0,
  appointment_count_target INTEGER DEFAULT 0,
  appointment_amount_target INTEGER DEFAULT 0,
  UNIQUE(target_type, target_name, year_month)
);

-- 日次目標
CREATE TABLE IF NOT EXISTS daily_targets (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  member_name TEXT NOT NULL,
  target_date TEXT NOT NULL,
  call_count_target INTEGER DEFAULT 0,
  pr_count_target INTEGER DEFAULT 0,
  appointment_count_target INTEGER DEFAULT 0,
  appointment_amount_target INTEGER DEFAULT 0,
  memo TEXT,
  UNIQUE(member_name, target_date)
);

-- 休日マスタ
CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY
);

-- 設定KV
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- チーム所属履歴（月次）
CREATE TABLE IF NOT EXISTS member_team_history (
  id TEXT PRIMARY KEY,
  member_name TEXT NOT NULL,
  team_name TEXT NOT NULL,
  year_month TEXT NOT NULL,
  UNIQUE(member_name, year_month)
);
CREATE INDEX IF NOT EXISTS idx_mth_ym ON member_team_history(year_month);
CREATE INDEX IF NOT EXISTS idx_mth_member ON member_team_history(member_name);

-- 初期データ: チーム
INSERT OR IGNORE INTO teams (team_name, leader_name) VALUES ('三善Team', '三善');
INSERT OR IGNORE INTO teams (team_name, leader_name) VALUES ('轟Team', '轟');
INSERT OR IGNORE INTO teams (team_name, leader_name) VALUES ('野口Team', '野口');
INSERT OR IGNORE INTO teams (team_name, leader_name) VALUES ('松居Team', '松居');
INSERT OR IGNORE INTO teams (team_name, leader_name) VALUES ('坪井Team', '坪井');
INSERT OR IGNORE INTO teams (team_name, leader_name, status) VALUES ('菊池Team', '菊池', 'inactive');
INSERT OR IGNORE INTO teams (team_name, leader_name, status) VALUES ('宮城Team', '宮城', 'inactive');

-- 初期データ: メンバー
-- 三善Team
INSERT OR IGNORE INTO members (member_name, team_name) VALUES ('三善', '三善Team');
INSERT OR IGNORE INTO members (member_name, team_name) VALUES ('宮城', '三善Team');
INSERT OR IGNORE INTO members (member_name, team_name) VALUES ('田中颯汰', '三善Team');
-- 轟Team
INSERT OR IGNORE INTO members (member_name, team_name) VALUES ('轟', '轟Team');
INSERT OR IGNORE INTO members (member_name, team_name) VALUES ('堀切', '轟Team');
INSERT OR IGNORE INTO members (member_name, team_name) VALUES ('田端', '轟Team');
-- 野口Team
INSERT OR IGNORE INTO members (member_name, team_name) VALUES ('野口', '野口Team');
INSERT OR IGNORE INTO members (member_name, team_name) VALUES ('中村た', '野口Team');
INSERT OR IGNORE INTO members (member_name, team_name) VALUES ('野上', '野口Team');
INSERT OR IGNORE INTO members (member_name, team_name) VALUES ('村上', '野口Team');
-- 松居Team
INSERT OR IGNORE INTO members (member_name, team_name) VALUES ('松居', '松居Team');
INSERT OR IGNORE INTO members (member_name, team_name) VALUES ('山本', '松居Team');
INSERT OR IGNORE INTO members (member_name, team_name) VALUES ('美除', '松居Team');
-- 坪井Team
INSERT OR IGNORE INTO members (member_name, team_name) VALUES ('坪井', '坪井Team');
INSERT OR IGNORE INTO members (member_name, team_name) VALUES ('池田', '坪井Team');
INSERT OR IGNORE INTO members (member_name, team_name) VALUES ('村松', '坪井Team');
INSERT OR IGNORE INTO members (member_name, team_name) VALUES ('田中か', '三善Team');
-- 非アクティブ
INSERT OR IGNORE INTO members (member_name, team_name, status) VALUES ('菊池', '菊池Team', 'inactive');
INSERT OR IGNORE INTO members (member_name, team_name, status) VALUES ('辻森', '野口Team', 'inactive');

-- 案件×メンバー アサイン管理（月次）
CREATE TABLE IF NOT EXISTS project_member_assignments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  member_name TEXT NOT NULL,
  project_name TEXT NOT NULL,
  year_month TEXT NOT NULL,
  rank TEXT DEFAULT 'C',
  project_type TEXT DEFAULT '成果報酬',
  pm_name TEXT,
  cap_count INTEGER DEFAULT 0,
  cap_amount INTEGER DEFAULT 0,
  target_count INTEGER DEFAULT 0,
  sheet_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(member_name, project_name, year_month)
);
CREATE INDEX IF NOT EXISTS idx_pma_year_month ON project_member_assignments(year_month);
CREATE INDEX IF NOT EXISTS idx_pma_member ON project_member_assignments(member_name);

-- メンバー月次コスト（給与）
CREATE TABLE IF NOT EXISTS member_monthly_costs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  member_name TEXT NOT NULL,
  year_month TEXT NOT NULL,
  salary INTEGER DEFAULT 0,
  memo TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(member_name, year_month)
);

-- チーム月次損益サマリ
CREATE TABLE IF NOT EXISTS team_monthly_pl (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  year_month TEXT NOT NULL UNIQUE,
  revenue INTEGER DEFAULT 0,
  cost_total INTEGER DEFAULT 0,
  gross_profit INTEGER DEFAULT 0,
  memo TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- フィードバック/改修依頼
CREATE TABLE IF NOT EXISTS feedback_requests (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  reporter TEXT,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now'))
);

-- 初期データ: デフォルト設定
INSERT OR IGNORE INTO settings (key, value) VALUES ('cancel_rate_default', '0.8');
INSERT OR IGNORE INTO settings (key, value) VALUES ('next_month_flow_rate', '0.5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('monthly_target_total', '9000000');
