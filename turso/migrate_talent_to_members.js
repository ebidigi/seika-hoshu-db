#!/usr/bin/env node
/**
 * digiman-talent DB → seika-hoshu-db マイグレーションスクリプト
 *
 * employees テーブルのデータを members テーブルに統合する。
 * - employees.name と members.member_name を基準にマッチング
 * - 既存メンバーは employee_type, department, hire_date, retire_date を UPDATE
 * - 存在しないメンバーはコンソールに一覧出力 (INSERT はしない)
 *
 * 環境変数:
 *   SEIKA_HOSHU_URL, SEIKA_HOSHU_TOKEN
 *   DIGIMAN_TALENT_URL, DIGIMAN_TALENT_TOKEN
 *
 * 使い方:
 *   node migrate_talent_to_members.js --dry-run   # 結果を確認のみ
 *   node migrate_talent_to_members.js              # 実際にUPDATE実行
 */

const isDryRun = process.argv.includes('--dry-run');

// ==================== 環境変数チェック ====================
const SEIKA_HOSHU_URL = process.env.SEIKA_HOSHU_URL;
const SEIKA_HOSHU_TOKEN = process.env.SEIKA_HOSHU_TOKEN;
const DIGIMAN_TALENT_URL = process.env.DIGIMAN_TALENT_URL;
const DIGIMAN_TALENT_TOKEN = process.env.DIGIMAN_TALENT_TOKEN;

const missing = [];
if (!SEIKA_HOSHU_URL) missing.push('SEIKA_HOSHU_URL');
if (!SEIKA_HOSHU_TOKEN) missing.push('SEIKA_HOSHU_TOKEN');
if (!DIGIMAN_TALENT_URL) missing.push('DIGIMAN_TALENT_URL');
if (!DIGIMAN_TALENT_TOKEN) missing.push('DIGIMAN_TALENT_TOKEN');

if (missing.length > 0) {
    console.error(`[ERROR] 以下の環境変数が未設定です: ${missing.join(', ')}`);
    console.error('');
    console.error('設定例:');
    console.error('  export SEIKA_HOSHU_URL="https://seika-hoshu-db-ebidigi-ebidigi.aws-ap-northeast-1.turso.io"');
    console.error('  export SEIKA_HOSHU_TOKEN="your-token-here"');
    console.error('  export DIGIMAN_TALENT_URL="https://digiman-talent-ebidigi.aws-ap-northeast-1.turso.io"');
    console.error('  export DIGIMAN_TALENT_TOKEN="your-token-here"');
    process.exit(1);
}

// ==================== Turso HTTP API ====================
async function queryTurso(url, token, sql, args = []) {
    const payload = {
        statements: [{ q: sql, params: args }]
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`Turso API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    if (result[0] && result[0].error) {
        throw new Error(result[0].error.message || JSON.stringify(result[0].error));
    }

    const queryResult = result[0];
    if (!queryResult || !queryResult.results) {
        return [];
    }

    const cols = queryResult.results.columns || [];
    const rows = queryResult.results.rows || [];

    return rows.map(row => {
        const obj = {};
        row.forEach((cell, i) => {
            obj[cols[i]] = cell;
        });
        return obj;
    });
}

// ==================== メイン処理 ====================
async function main() {
    console.log('========================================');
    console.log('digiman-talent → seika-hoshu-db マイグレーション');
    console.log(`モード: ${isDryRun ? '🔍 DRY-RUN (変更なし)' : '⚡ 実行モード'}`);
    console.log('========================================\n');

    // 1. digiman-talent の employees を全件取得
    console.log('[1/3] digiman-talent の employees テーブルを取得中...');
    const employees = await queryTurso(
        DIGIMAN_TALENT_URL,
        DIGIMAN_TALENT_TOKEN,
        'SELECT name, employee_type, department, hire_date, retire_date FROM employees'
    );
    console.log(`  → ${employees.length} 件取得\n`);

    // 2. seika-hoshu-db の members を全件取得
    console.log('[2/3] seika-hoshu-db の members テーブルを取得中...');
    const members = await queryTurso(
        SEIKA_HOSHU_URL,
        SEIKA_HOSHU_TOKEN,
        'SELECT member_name FROM members'
    );
    const memberNames = new Set(members.map(m => m.member_name));
    console.log(`  → ${members.length} 件取得\n`);

    // 3. マッチング＆更新
    console.log('[3/3] マッチング処理...\n');

    const matched = [];
    const unmatched = [];

    for (const emp of employees) {
        if (memberNames.has(emp.name)) {
            matched.push(emp);
        } else {
            unmatched.push(emp);
        }
    }

    // マッチした社員の UPDATE
    console.log(`--- マッチした社員: ${matched.length} 件 (UPDATE対象) ---`);
    for (const emp of matched) {
        const typeLabel = emp.employee_type || '(未設定)';
        const dept = emp.department || '(未設定)';
        const hire = emp.hire_date || '(未設定)';
        const retire = emp.retire_date || '在籍中';
        console.log(`  ✅ ${emp.name} | 種別: ${typeLabel} | 部署: ${dept} | 入社: ${hire} | 退社: ${retire}`);

        if (!isDryRun) {
            await queryTurso(
                SEIKA_HOSHU_URL,
                SEIKA_HOSHU_TOKEN,
                `UPDATE members
                 SET employee_type = ?, department = ?, hire_date = ?, retire_date = ?
                 WHERE member_name = ?`,
                [emp.employee_type, emp.department, emp.hire_date, emp.retire_date, emp.name]
            );
        }
    }

    // マッチしなかった社員の一覧
    if (unmatched.length > 0) {
        console.log(`\n--- マッチしなかった社員: ${unmatched.length} 件 (INSERT対象外) ---`);
        console.log('  ※ 方針未決定のため INSERT は行いません。必要に応じて手動で対応してください。');
        for (const emp of unmatched) {
            const retire = emp.retire_date || '在籍中';
            console.log(`  ❌ ${emp.name} | 種別: ${emp.employee_type || '(未設定)'} | 退社: ${retire}`);
        }
    }

    // サマリ
    console.log('\n========================================');
    console.log('サマリ:');
    console.log(`  employees 総数:    ${employees.length}`);
    console.log(`  members 総数:      ${members.length}`);
    console.log(`  マッチ (UPDATE):   ${matched.length}`);
    console.log(`  アンマッチ:        ${unmatched.length}`);
    if (isDryRun) {
        console.log('\n  ※ DRY-RUN モードのため、DB への変更は行っていません。');
        console.log('  実行するには --dry-run フラグを外してください。');
    } else {
        console.log(`\n  ✅ ${matched.length} 件の UPDATE を実行しました。`);
    }
    console.log('========================================');
}

main().catch(err => {
    console.error('[FATAL]', err.message);
    process.exit(1);
});
