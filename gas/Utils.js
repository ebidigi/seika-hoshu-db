/**
 * 共通ユーティリティ
 */

// ==================== 設定 ====================
const SEIKA_CONFIG = {
  SPREADSHEET_ID: '1Qo9LvDqUgkPVcaoDN-t4p8YKryoILKEMdMugDlpDTIQ',
  PERFORMANCE_SHEET: '実績rawdata',
  SALES_SHEET: '売上報告rawdata',
  SYNC_DAYS: 45,
  BATCH_SIZE: 50,
  SLACK_CHANNEL: 'C0ACA4Q05PB'
};

// 成果報酬チームメンバー一覧
const SEIKA_MEMBERS = [
  '野口', '中村 峻也', '田中克樹', '辻森',
  '松居', '山本', '美除',
  '坪井', '村松', '田中颯汰',
  '宮城'
];

// ==================== Turso API ====================

function getTursoConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    url: props.getProperty('SEIKA_TURSO_DATABASE_URL'),
    token: props.getProperty('SEIKA_TURSO_AUTH_TOKEN')
  };
}

/**
 * Turso Pipeline APIでバッチ実行
 */
function executeTursoPipeline(requests) {
  const config = getTursoConfig();
  if (!config.url || !config.token) {
    throw new Error('Turso credentials not configured. Set SEIKA_TURSO_DATABASE_URL and SEIKA_TURSO_AUTH_TOKEN in Script Properties.');
  }

  const httpUrl = config.url.replace('libsql://', 'https://') + '/v3/pipeline';

  requests.push({ type: 'close' });

  const options = {
    method: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + config.token },
    payload: JSON.stringify({ requests: requests }),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(httpUrl, options);
  const statusCode = response.getResponseCode();

  if (statusCode !== 200) {
    throw new Error('Turso API error: ' + statusCode + ' - ' + response.getContentText());
  }

  return JSON.parse(response.getContentText());
}

/**
 * 単一SQLクエリ実行
 */
function executeTursoQuery(sql, args) {
  const requests = [{
    type: 'execute',
    stmt: {
      sql: sql,
      args: (args || []).map(toTursoArg)
    }
  }];
  return executeTursoPipeline(requests);
}

/**
 * SELECT結果をオブジェクト配列として返す
 */
function queryTurso(sql, args) {
  const result = executeTursoQuery(sql, args);

  if (!result.results || !result.results[0]) return [];

  const r = result.results[0];
  if (r.type === 'error') {
    throw new Error(r.error ? r.error.message : 'Query error');
  }

  const response = r.response;
  if (!response || response.type !== 'execute') return [];

  const cols = response.result.cols.map(c => c.name);
  const rows = response.result.rows || [];

  return rows.map(row => {
    const obj = {};
    row.forEach((cell, i) => {
      obj[cols[i]] = cell.value;
    });
    return obj;
  });
}

/**
 * JavaScript値をTurso APIの引数形式に変換
 */
function toTursoArg(arg) {
  if (arg === null || arg === undefined) return { type: 'null' };
  if (typeof arg === 'number') {
    return Number.isInteger(arg)
      ? { type: 'integer', value: String(arg) }
      : { type: 'float', value: arg };
  }
  return { type: 'text', value: String(arg) };
}

/**
 * 日付をYYYY-MM-DD形式に変換
 */
function formatDateGAS(d) {
  if (!d || isNaN(new Date(d).getTime())) return null;
  const date = new Date(d);
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}

/**
 * 稼働時間内かチェック（8時〜21時）
 */
function isBusinessHoursSeika() {
  const hour = new Date().getHours();
  return hour >= 8 && hour < 21;
}

/**
 * 成果報酬チームメンバーかどうか判定
 */
function isSeikaTeamMember(name) {
  if (!name) return false;
  const normalized = String(name).trim();
  return SEIKA_MEMBERS.some(m => normalized.includes(m));
}

/**
 * Slack通知送信
 */
function sendSlackNotificationSeika(message, channel) {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  if (!token) {
    Logger.log('SLACK_BOT_TOKEN not configured');
    return;
  }

  const payload = {
    channel: channel || SEIKA_CONFIG.SLACK_CHANNEL,
    text: message,
    mrkdwn: true
  };

  UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}
