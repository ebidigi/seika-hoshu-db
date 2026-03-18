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
  '松居', '山本', '美除', '村上夢果',
  '坪井', '村松', '田中颯汰',
  '宮城 啓生'
];

// スプレッドシート名 → DB正規名マッピング
const MEMBER_NAME_MAP = {
  'tanaka sota': '田中颯汰',
  '中村 峻也': '中村た',
  '中村峻也': '中村た',
  '田中克樹': '田中か',
  '田中颯汰': '田中颯汰',
  '宮城 啓生': '宮城',
  '宮城啓生': '宮城',
  '宮城一平': '宮城',
  '野口純': '野口',
  '野口 純': '野口',
  '坪井 秀斗': '坪井',
  '坪井秀斗': '坪井',
  '松居和輝': '松居',
  '松居 和輝': '松居',
  '村松和哉': '村松',
  '村松 和哉': '村松',
  '辻森誠也': '辻森',
  '辻森 誠也': '辻森',
  '山本匠太郎': '山本',
  '山本 匠太郎': '山本',
  '美除直生': '美除',
  '美除 直生': '美除',
  '村上夢果': '村上',
  '村上 夢果': '村上'
};

/**
 * スプレッドシートの担当者名をDB正規名に変換
 */
function normalizeMemberName(rawName) {
  if (!rawName) return '';
  let name = String(rawName).trim();

  // Slack形式 "@名前/id" から名前部分を抽出
  const slackMatch = name.match(/^@(.+?)\//);
  if (slackMatch) {
    name = slackMatch[1].trim();
  } else if (name.startsWith('@')) {
    // "@名前" 形式（/なし）
    name = name.substring(1).trim();
  }

  // 完全一致
  if (MEMBER_NAME_MAP[name]) return MEMBER_NAME_MAP[name];

  // スペースなし版で再チェック
  const noSpace = name.replace(/\s+/g, '');
  if (MEMBER_NAME_MAP[noSpace]) return MEMBER_NAME_MAP[noSpace];

  // 部分一致（長いキーから先に評価して誤マッチ防止）
  var entries = Object.entries(MEMBER_NAME_MAP).sort(function(a, b) { return b[0].length - a[0].length; });
  for (const [key, val] of entries) {
    if (name.includes(key) || noSpace.includes(key.replace(/\s+/g, ''))) return val;
  }
  return name;
}

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

  const pipeline = requests.concat([{ type: 'close' }]);

  const options = {
    method: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + config.token },
    payload: JSON.stringify({ requests: pipeline }),
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
 * 正規化後の名前でもマッチするよう、normalizeMemberName() を通してから判定
 */
function isSeikaTeamMember(name) {
  if (!name) return false;
  const raw = String(name).trim();
  // 元名でマッチ
  if (SEIKA_MEMBERS.some(m => raw.includes(m))) return true;
  // 正規化名でマッチ
  const normalized = normalizeMemberName(raw);
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

  var resp = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var body = JSON.parse(resp.getContentText());
  if (!body.ok) {
    Logger.log('Slack API error: ' + (body.error || 'unknown'));
  }
}
