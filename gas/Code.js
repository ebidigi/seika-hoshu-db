/**
 * Google Apps Script: 成果報酬チームDB APIエンドポイント
 *
 * このファイルはGASのWebアプリとしてデプロイし、
 * 外部からのAPI呼び出しに対応する（必要に応じて）
 */

/**
 * GET リクエストハンドラ
 */
function doGet(e) {
  const action = e.parameter.action || 'status';

  try {
    let result;

    switch (action) {
      case 'status':
        result = { status: 'ok', timestamp: new Date().toISOString() };
        break;

      case 'sync':
        syncPerformanceToTursoSeika();
        syncSalesReportToTursoSeika();
        result = { status: 'ok', message: 'Sync completed' };
        break;

      case 'notify':
        sendSeikaSlackNotification();
        result = { status: 'ok', message: 'Notification sent' };
        break;

      default:
        result = { error: 'Unknown action: ' + action };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * トリガーセットアップ（初回のみ実行）
 */
function setupTriggersSeika() {
  // 既存トリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    const name = trigger.getHandlerFunction();
    if (name === 'syncPerformanceToTursoSeika' ||
        name === 'syncSalesReportToTursoSeika' ||
        name === 'sendSeikaSlackNotification12' ||
        name === 'sendSeikaSlackNotification15' ||
        name === 'sendSeikaSlackNotification18' ||
        name === 'sendSeikaSlackNotification20') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 実績同期: 15分毎
  ScriptApp.newTrigger('syncPerformanceToTursoSeika')
    .timeBased()
    .everyMinutes(15)
    .create();

  // 売上報告同期: 15分毎
  ScriptApp.newTrigger('syncSalesReportToTursoSeika')
    .timeBased()
    .everyMinutes(15)
    .create();

  // Slack通知: 12:00
  ScriptApp.newTrigger('sendSeikaSlackNotification12')
    .timeBased()
    .atHour(12)
    .nearMinute(0)
    .everyDays(1)
    .create();

  // Slack通知: 15:00
  ScriptApp.newTrigger('sendSeikaSlackNotification15')
    .timeBased()
    .atHour(15)
    .nearMinute(0)
    .everyDays(1)
    .create();

  // Slack通知: 18:00
  ScriptApp.newTrigger('sendSeikaSlackNotification18')
    .timeBased()
    .atHour(18)
    .nearMinute(0)
    .everyDays(1)
    .create();

  // Slack通知: 20:00
  ScriptApp.newTrigger('sendSeikaSlackNotification20')
    .timeBased()
    .atHour(20)
    .nearMinute(0)
    .everyDays(1)
    .create();

  Logger.log('All triggers set up successfully');
}

// 各時間帯用のラッパー関数
function sendSeikaSlackNotification12() { sendSeikaSlackNotification(); }
function sendSeikaSlackNotification15() { sendSeikaSlackNotification(); }
function sendSeikaSlackNotification18() { sendSeikaSlackNotification(); }
function sendSeikaSlackNotification20() { sendSeikaSlackNotification(); }
