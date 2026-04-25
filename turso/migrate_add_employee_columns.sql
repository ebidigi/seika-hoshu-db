-- ============================================================
-- マイグレーション: members テーブルに社員情報カラムを追加
-- 目的: digiman-talent DB 統合のため、社員マスター情報を members に持たせる
-- 実行前に必ずバックアップを取ること
-- ============================================================

-- 社員種別 (社員/インターン/業務委託)
ALTER TABLE members ADD COLUMN employee_type TEXT;

-- 部署名
ALTER TABLE members ADD COLUMN department TEXT;

-- 入社日 (YYYY-MM-DD)
ALTER TABLE members ADD COLUMN hire_date TEXT;

-- 退社日 (YYYY-MM-DD, NULLなら在籍中)
ALTER TABLE members ADD COLUMN retire_date TEXT;
