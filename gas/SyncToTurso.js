/**
 * Google Apps Script: Sheets → Turso 同期スクリプト（成果報酬チーム専用）
 *
 * 機能: 実績rawdataシートから成果報酬チームメンバーのデータを抽出してTursoに同期
 *
 * セットアップ手順:
 * 1. GASエディタでこのファイルの内容をコピー
 * 2. スクリプトプロパティに以下を設定:
 *    - SEIKA_TURSO_DATABASE_URL: libsql://seika-hoshu-db-ebidigi.aws-ap-northeast-1.turso.io
 *    - SEIKA_TURSO_AUTH_TOKEN: (Tursoダッシュボードから取得)
 * 3. トリガーを設定: syncPerformanceToTursoSeika を15分毎に実行
 */

// ==================== 実績データ同期 ====================

/**
 * 実績rawdataを成果報酬チームメンバーでフィルタしてTursoに同期（15分毎トリガー用）
 */
function syncPerformanceToTursoSeika() {
  if (!isBusinessHoursSeika()) {
    Logger.log('営業時間外のためスキップ');
    return;
  }

  const sheet = SpreadsheetApp.openById(SEIKA_CONFIG.SPREADSHEET_ID)
    .getSheetByName(SEIKA_CONFIG.PERFORMANCE_SHEET);

  if (!sheet) {
    Logger.log('ERROR: Sheet not found: ' + SEIKA_CONFIG.PERFORMANCE_SHEET);
    return;
  }

  // 同期対象日付範囲
  const today = new Date();
  const syncFrom = new Date(today);
  syncFrom.setDate(syncFrom.getDate() - SEIKA_CONFIG.SYNC_DAYS);
  const syncFromStr = formatDateGAS(syncFrom);

  Logger.log('同期対象期間: ' + syncFromStr + ' 〜 今日');

  // スプレッドシート全行読み取り
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('No data in sheet');
    return;
  }

  const allData = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

  // 成果報酬チームメンバー & 日付範囲でフィルタ
  const targetRows = [];
  for (const row of allData) {
    const memberName = String(row[0] || '').trim();
    if (!memberName || !isSeikaTeamMember(memberName)) continue;

    const inputDate = row[2];
    if (!inputDate) continue;

    const d = new Date(inputDate);
    if (isNaN(d.getTime())) continue;

    const dateStr = formatDateGAS(d);
    if (dateStr >= syncFromStr) {
      targetRows.push(row);
    }
  }

  Logger.log('成果報酬チーム対象行: ' + targetRows.length + '行（全' + allData.length + '行中）');

  if (targetRows.length === 0) {
    Logger.log('同期対象データなし');
    return;
  }

  // バッチでUPSERT
  let upsertedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < targetRows.length; i += SEIKA_CONFIG.BATCH_SIZE) {
    const batch = targetRows.slice(i, i + SEIKA_CONFIG.BATCH_SIZE);
    try {
      const result = upsertPerformanceBatch(batch);
      upsertedCount += result.success;
      errorCount += result.errors;
    } catch (e) {
      Logger.log('Batch error at index ' + i + ': ' + e.message);
      errorCount += batch.length;
    }
  }

  const summary = '成果報酬Turso同期完了: ' + upsertedCount + '件同期, ' + errorCount + '件エラー';
  Logger.log(summary);

  if (errorCount > 0) {
    sendSlackNotificationSeika('⚠️ ' + summary);
  }

  // 非正規名のクリーンアップ
  cleanupNonCanonicalNames();
}

/**
 * 実績データのバッチUPSERT
 */
function upsertPerformanceBatch(rows) {
  const requests = [];

  for (const row of rows) {
    // スプシカラム: 担当者, 案件名, 日付, 架電時間, 架電数, PR数, アポ数, 定性FB
    const [memberName, projectName, inputDate, callHours, callCount, prCount, appointmentCount] = row;

    const formattedDate = formatDateGAS(inputDate);
    if (!formattedDate) continue;

    // appointment_amountはスプシに存在しないため0（後でprojectsテーブルの単価から計算）
    const args = [
      normalizeMemberName(memberName),
      String(projectName || '').trim(),
      formattedDate,
      parseFloat(callHours) || 0,
      parseInt(callCount) || 0,
      parseInt(prCount) || 0,
      parseInt(appointmentCount) || 0,
      0
    ];

    requests.push({
      type: 'execute',
      stmt: {
        sql: `INSERT OR REPLACE INTO performance_rawdata
          (id, member_name, project_name, input_date, call_hours, call_count, pr_count, appointment_count, appointment_amount, updated_at)
          VALUES (
            COALESCE(
              (SELECT id FROM performance_rawdata WHERE member_name = ? AND project_name = ? AND input_date = ?),
              lower(hex(randomblob(16)))
            ),
            ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')
          )`,
        args: [
          // COALESCE用
          ...args.slice(0, 3).map(toTursoArg),
          // INSERT用
          ...args.map(toTursoArg)
        ]
      }
    });
  }

  if (requests.length === 0) return { success: 0, errors: 0 };

  const result = executeTursoPipeline(requests);

  let success = 0;
  let errors = 0;
  for (const r of result.results) {
    if (r.type === 'ok') success++;
    else if (r.type === 'error') {
      Logger.log('SQL error: ' + (r.error ? r.error.message : 'unknown'));
      errors++;
    }
  }

  return { success, errors };
}

// ==================== 売上報告データ同期 ====================

/**
 * 売上報告rawdataからアポイントデータを同期
 */
function syncSalesReportToTursoSeika() {
  if (!isBusinessHoursSeika()) {
    Logger.log('営業時間外のためスキップ');
    return;
  }

  const sheet = SpreadsheetApp.openById(SEIKA_CONFIG.SPREADSHEET_ID)
    .getSheetByName(SEIKA_CONFIG.SALES_SHEET);

  if (!sheet) {
    Logger.log('ERROR: Sheet not found: ' + SEIKA_CONFIG.SALES_SHEET);
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  // 売上報告rawdataカラム構成（16列）:
  // A:営業担当者, B:売上種別, C:案件名, D:会社名, E:取得日, F:実施日時, G:金額,
  // H:部署, I:役職, J:名前, K:電話番号, L:メールアドレス, M:架電ヒアリング,
  // N:営業区分, O:リスケ, P:取引
  const allData = sheet.getRange(2, 1, lastRow - 1, 16).getValues();

  const today = new Date();
  const syncFrom = new Date(today);
  syncFrom.setDate(syncFrom.getDate() - SEIKA_CONFIG.SYNC_DAYS);
  const syncFromStr = formatDateGAS(syncFrom);

  const targetRows = [];
  for (const row of allData) {
    const memberName = String(row[0] || '').trim();
    if (!memberName || !isSeikaTeamMember(memberName)) continue;

    const acquisitionDate = row[4]; // E列: 取得日
    if (!acquisitionDate) continue;

    const d = new Date(acquisitionDate);
    if (isNaN(d.getTime())) continue;

    const dateStr = formatDateGAS(d);
    if (dateStr >= syncFromStr) {
      targetRows.push(row);
    }
  }

  Logger.log('売上報告 成果報酬チーム対象: ' + targetRows.length + '行');

  if (targetRows.length === 0) return;

  // 案件をprojectsテーブルに自動登録（未登録のもの）
  const projectNames = [...new Set(targetRows.map(r => String(r[2] || '').trim()).filter(Boolean))];
  if (projectNames.length > 0) {
    const projRequests = projectNames.map(name => ({
      type: 'execute',
      stmt: {
        sql: `INSERT OR IGNORE INTO projects (id, project_name, unit_price)
              VALUES (lower(hex(randomblob(16))), ?, 0)`,
        args: [toTursoArg(name)]
      }
    }));
    try {
      executeTursoPipeline(projRequests);
      Logger.log('案件マスタ自動登録: ' + projectNames.length + '件チェック');
    } catch (e) {
      Logger.log('案件マスタ登録エラー: ' + e.message);
    }
  }

  // 案件ごとの代表単価をprojectsテーブルに更新（最新の金額を使用）
  const projectPrices = {};
  for (const row of targetRows) {
    const pn = String(row[2] || '').trim();
    const amt = parseInt(row[6]) || 0;
    if (pn && amt > 0) projectPrices[pn] = amt;
  }
  if (Object.keys(projectPrices).length > 0) {
    const priceRequests = Object.entries(projectPrices).map(([name, price]) => ({
      type: 'execute',
      stmt: {
        sql: `UPDATE projects SET unit_price = ? WHERE project_name = ? AND (unit_price IS NULL OR unit_price = 0)`,
        args: [toTursoArg(price), toTursoArg(name)]
      }
    }));
    try {
      executeTursoPipeline(priceRequests);
      Logger.log('案件単価更新: ' + Object.keys(projectPrices).length + '件');
    } catch (e) {
      Logger.log('案件単価更新エラー: ' + e.message);
    }
  }

  let upserted = 0;
  let errors = 0;

  for (let i = 0; i < targetRows.length; i += SEIKA_CONFIG.BATCH_SIZE) {
    const batch = targetRows.slice(i, i + SEIKA_CONFIG.BATCH_SIZE);
    try {
      const result = upsertAppointmentBatch(batch);
      upserted += result.success;
      errors += result.errors;
    } catch (e) {
      Logger.log('Appointment batch error: ' + e.message);
      errors += batch.length;
    }
  }

  Logger.log('売上報告同期完了: ' + upserted + '件, エラー' + errors + '件');

  // 非正規名のクリーンアップ
  cleanupNonCanonicalNames();
}

/**
 * アポイントデータのバッチUPSERT
 */
function upsertAppointmentBatch(rows) {
  const requests = [];

  for (const row of rows) {
    // A:営業担当者, B:売上種別, C:案件名, D:会社名, E:取得日, F:実施日時, G:金額,
    // H:部署, I:役職, J:名前, K:電話番号, L:メールアドレス, M:架電ヒアリング,
    // N:営業区分, O:リスケ, P:取引
    const memberName = normalizeMemberName(row[0]);         // A: 営業担当者
    const projectName = String(row[2] || '').trim();      // C: 案件名
    const customerName = String(row[3] || '').trim();     // D: 会社名
    const acquisitionDate = formatDateGAS(row[4]);        // E: 取得日
    const scheduledDate = formatDateGAS(row[5]);          // F: 実施日時
    const amount = parseInt(row[6]) || 0;                 // G: 金額
    const contactName = String(row[9] || '').trim();      // J: 名前（担当者名）
    const rescheduleInfo = String(row[14] || '').trim();  // O: リスケ
    const dealInfo = String(row[15] || '').trim();        // P: 取引

    if (!acquisitionDate) continue;

    // ステータス判定: リスケ列 or 取引列からステータスを推定
    let status = '未確認';
    if (rescheduleInfo === 'リスケ' || (dealInfo && dealInfo.includes('リスケ'))) {
      status = 'リスケ';
    } else if (dealInfo && dealInfo.includes('キャンセル')) {
      status = 'キャンセル';
    } else if (dealInfo && (dealInfo.includes('実施') || dealInfo.includes('成約'))) {
      status = '実施';
    }

    // メモ: 担当者名 + 営業区分
    const salesType = String(row[13] || '').trim();       // N: 営業区分
    const memo = [contactName, salesType].filter(Boolean).join(' / ');

    requests.push({
      type: 'execute',
      stmt: {
        sql: `INSERT INTO appointments (id, member_name, project_name, acquisition_date, scheduled_date, unit_price, amount, customer_name, status, memo)
              VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(member_name, project_name, acquisition_date, customer_name)
              DO UPDATE SET scheduled_date=excluded.scheduled_date, unit_price=excluded.unit_price,
                amount=excluded.amount,
                status=CASE WHEN appointments.confirmation_date IS NOT NULL THEN appointments.status ELSE excluded.status END,
                memo=excluded.memo, updated_at=datetime('now')`,
        args: [memberName, projectName, acquisitionDate, scheduledDate, amount, amount, customerName, status, memo].map(toTursoArg)
      }
    });
  }

  if (requests.length === 0) return { success: 0, errors: 0 };

  const result = executeTursoPipeline(requests);

  let success = 0;
  let errors = 0;
  for (const r of result.results) {
    if (r.type === 'ok') success++;
    else if (r.type === 'error') errors++;
  }

  return { success, errors };
}

// ==================== 非正規名クリーンアップ ====================

/**
 * DB内の非正規メンバー名を検出して削除
 * 正規名: 野口, 中村た, 田中か, 辻森, 松居, 山本, 美除, 坪井, 村松, 田中颯汰, 宮城
 */
function cleanupNonCanonicalNames() {
  var canonicalNames = ['野口', '中村た', '田中か', '辻森', '松居', '山本', '美除', '村上', '坪井', '村松', '田中颯汰', '宮城'];
  var inClause = canonicalNames.map(function(n) { return "'" + n + "'"; }).join(',');

  // Step 1: 非正規名の行を取得
  var checkResult;
  try {
    checkResult = executeTursoPipeline([{
      type: 'execute',
      stmt: { sql: "SELECT DISTINCT member_name FROM performance_rawdata WHERE member_name NOT IN (" + inClause + ")" }
    }]);
  } catch (e) {
    Logger.log('クリーンアップチェックエラー: ' + e.message);
    return;
  }

  var nonCanonRows = checkResult.results && checkResult.results[0] && checkResult.results[0].type === 'ok'
    ? (checkResult.results[0].response.result.rows || [])
    : [];

  if (nonCanonRows.length === 0) return;

  var requests = [];

  // Step 2: 非正規名を正規名に変換して更新（重複がある場合は非正規名側を削除）
  for (var i = 0; i < nonCanonRows.length; i++) {
    var rawName = nonCanonRows[i][0];
    var canonical = normalizeMemberName(rawName);
    if (!canonical || canonical === rawName || !canonicalNames.includes(canonical)) {
      // 正規化できない場合は削除
      requests.push({
        type: 'execute',
        stmt: { sql: "DELETE FROM performance_rawdata WHERE member_name = ?", args: [toTursoArg(rawName)] }
      });
      requests.push({
        type: 'execute',
        stmt: { sql: "DELETE FROM appointments WHERE member_name = ?", args: [toTursoArg(rawName)] }
      });
      continue;
    }

    // 重複行（正規名と同じproject+date）を削除
    requests.push({
      type: 'execute',
      stmt: {
        sql: "DELETE FROM performance_rawdata WHERE member_name = ? AND EXISTS (SELECT 1 FROM performance_rawdata b WHERE b.member_name = ? AND b.project_name = performance_rawdata.project_name AND b.input_date = performance_rawdata.input_date)",
        args: [toTursoArg(rawName), toTursoArg(canonical)]
      }
    });
    requests.push({
      type: 'execute',
      stmt: {
        sql: "DELETE FROM appointments WHERE member_name = ? AND EXISTS (SELECT 1 FROM appointments b WHERE b.member_name = ? AND b.project_name = appointments.project_name AND b.acquisition_date = appointments.acquisition_date AND b.customer_name = appointments.customer_name)",
        args: [toTursoArg(rawName), toTursoArg(canonical)]
      }
    });

    // 重複のない行は正規名に更新
    requests.push({
      type: 'execute',
      stmt: { sql: "UPDATE performance_rawdata SET member_name = ? WHERE member_name = ?", args: [toTursoArg(canonical), toTursoArg(rawName)] }
    });
    requests.push({
      type: 'execute',
      stmt: { sql: "UPDATE appointments SET member_name = ? WHERE member_name = ?", args: [toTursoArg(canonical), toTursoArg(rawName)] }
    });
  }

  if (requests.length === 0) return;

  try {
    var result = executeTursoPipeline(requests);
    var totalAffected = 0;
    for (var j = 0; j < result.results.length; j++) {
      if (result.results[j].type === 'ok') {
        totalAffected += result.results[j].response.result.affected_row_count || 0;
      }
    }
    if (totalAffected > 0) {
      Logger.log('非正規名クリーンアップ: ' + totalAffected + '行処理 (' + nonCanonRows.length + '名分)');
    }
  } catch (e) {
    Logger.log('クリーンアップエラー: ' + e.message);
  }
}
