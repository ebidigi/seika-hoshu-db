/**
 * Slack → Turso アポイントステータス同期
 *
 * TAANから C090PAKGPAP チャンネルに届く商談通知を読み取り、
 * appointmentsテーブルのステータスを更新する。
 *
 * メッセージパターン:
 *   :tada: 商談が承認されました     → 実施
 *   :no_entry_sign: 商談が却下されました → キャンセル
 *   :memo: 商談が更新されました（フェーズ:要対応）→ リスケ
 *   :inbox_tray: 商談が作成されました → 新規（情報のみ、更新不要）
 *
 * 15分毎トリガーで実行。前回チェック時刻以降のメッセージのみ処理。
 */

const SLACK_APPO_CHANNEL = 'C090PAKGPAP';

/**
 * Slackチャンネルからアポ承認/却下メッセージを読み取りDBを更新
 */
function syncSlackAppoStatusToTurso() {
  if (!isBusinessHoursSeika()) {
    Logger.log('営業時間外のためスキップ');
    return;
  }

  const token = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN');
  if (!token) {
    Logger.log('SLACK_BOT_TOKEN not configured');
    return;
  }

  // 前回チェック時刻を取得（なければ1時間前）
  const props = PropertiesService.getScriptProperties();
  const lastChecked = props.getProperty('SLACK_APPO_LAST_CHECKED');
  const oldest = lastChecked || String(Date.now() / 1000 - 3600);

  // Slack API: conversations.history
  const url = 'https://slack.com/api/conversations.history'
    + '?channel=' + SLACK_APPO_CHANNEL
    + '&oldest=' + oldest
    + '&limit=100';

  const response = UrlFetchApp.fetch(url, {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true
  });

  const data = JSON.parse(response.getContentText());
  if (!data.ok) {
    Logger.log('Slack API error: ' + (data.error || 'unknown'));
    return;
  }

  const messages = data.messages || [];
  if (messages.length === 0) {
    Logger.log('新規メッセージなし');
    // タイムスタンプを更新
    props.setProperty('SLACK_APPO_LAST_CHECKED', String(Date.now() / 1000));
    return;
  }

  Logger.log('処理対象メッセージ: ' + messages.length + '件');

  let updatedCount = 0;
  let skippedCount = 0;
  const requests = [];

  for (const msg of messages) {
    const parsed = parseSlackAppoMessage(msg);
    if (!parsed) {
      skippedCount++;
      continue;
    }

    // customer_nameとscheduled_dateでアポイントを特定し、ステータスを更新
    // confirmation_dateも設定してGAS同期での上書きを防止
    const now = new Date().toISOString().replace('T', ' ').split('.')[0];

    // 株式会社を除いた短縮名を作成（部分一致用）
    const shortName = parsed.customerName
      .replace(/株式会社/g, '')
      .replace(/　/g, '')
      .trim();

    if (parsed.action === 'approved') {
      requests.push({
        type: 'execute',
        stmt: {
          sql: `UPDATE appointments
                SET status = '実施',
                    confirmation_date = ?,
                    confirmed_by = 'TAAN/Slack',
                    memo = CASE WHEN memo IS NULL OR memo = '' THEN ? ELSE memo || ' / ' || ? END,
                    updated_at = datetime('now')
                WHERE (customer_name = ? OR customer_name LIKE '%' || ? || '%')
                  AND scheduled_date = ?
                  AND status != '実施'`,
          args: [
            toTursoArg(formatDateGAS(new Date())),
            toTursoArg('承認: ' + (parsed.service || '')),
            toTursoArg('承認: ' + (parsed.service || '')),
            toTursoArg(parsed.customerName),
            toTursoArg(shortName),
            toTursoArg(parsed.scheduledDate)
          ]
        }
      });
    } else if (parsed.action === 'rejected') {
      requests.push({
        type: 'execute',
        stmt: {
          sql: `UPDATE appointments
                SET status = 'キャンセル',
                    confirmation_date = ?,
                    confirmed_by = 'TAAN/Slack',
                    memo = CASE WHEN memo IS NULL OR memo = '' THEN ? ELSE memo || ' / ' || ? END,
                    updated_at = datetime('now')
                WHERE (customer_name = ? OR customer_name LIKE '%' || ? || '%')
                  AND scheduled_date = ?
                  AND status != 'キャンセル'`,
          args: [
            toTursoArg(formatDateGAS(new Date())),
            toTursoArg('却下: ' + (parsed.service || '')),
            toTursoArg('却下: ' + (parsed.service || '')),
            toTursoArg(parsed.customerName),
            toTursoArg(shortName),
            toTursoArg(parsed.scheduledDate)
          ]
        }
      });
    } else if (parsed.action === 'reschedule') {
      requests.push({
        type: 'execute',
        stmt: {
          sql: `UPDATE appointments
                SET status = 'リスケ',
                    confirmation_date = ?,
                    confirmed_by = 'TAAN/Slack',
                    reschedule_date = ?,
                    memo = CASE WHEN memo IS NULL OR memo = '' THEN ? ELSE memo || ' / ' || ? END,
                    updated_at = datetime('now')
                WHERE (customer_name = ? OR customer_name LIKE '%' || ? || '%')
                  AND scheduled_date = ?
                  AND status NOT IN ('リスケ', 'キャンセル')`,
          args: [
            toTursoArg(formatDateGAS(new Date())),
            toTursoArg(parsed.newScheduledDate || null),
            toTursoArg('リスケ: ' + (parsed.service || '')),
            toTursoArg('リスケ: ' + (parsed.service || '')),
            toTursoArg(parsed.customerName),
            toTursoArg(shortName),
            toTursoArg(parsed.scheduledDate)
          ]
        }
      });
    }
  }

  if (requests.length > 0) {
    try {
      const result = executeTursoPipeline(requests);
      for (const r of result.results) {
        if (r.type === 'ok' && r.response && r.response.result && r.response.result.affected_row_count > 0) {
          updatedCount += r.response.result.affected_row_count;
        }
      }
    } catch (e) {
      Logger.log('Turso更新エラー: ' + e.message);
    }
  }

  // タイムスタンプを更新（最新メッセージのts + 0.001）
  const latestTs = messages.reduce((max, m) => Math.max(max, parseFloat(m.ts)), 0);
  props.setProperty('SLACK_APPO_LAST_CHECKED', String(latestTs + 0.001));

  const summary = 'Slackアポ同期: ' + updatedCount + '件更新, ' + skippedCount + '件スキップ（対象外）';
  Logger.log(summary);
}

/**
 * Slackメッセージをパースして構造化データを返す
 * @returns {Object|null} {action, customerName, scheduledDate, service, newScheduledDate}
 */
function parseSlackAppoMessage(msg) {
  const text = msg.text || '';

  // アクション判定
  let action = null;
  if (text.includes('商談が承認されました')) {
    action = 'approved';
  } else if (text.includes('商談が却下されました')) {
    action = 'rejected';
  } else if (text.includes('商談が更新されました')) {
    // 更新メッセージはフェーズ確認が必要
    action = 'updated';
  } else {
    // 作成・メッセージ通知等はスキップ
    return null;
  }

  // attachmentsからデータ抽出
  const attachments = msg.attachments || [];
  if (attachments.length === 0) return null;

  let customerName = '';
  let scheduledDate = '';
  let service = '';
  let phase = '';
  let newScheduledDate = '';

  for (const att of attachments) {
    const blocks = att.blocks || [];
    for (const block of blocks) {
      // sectionからカスタマー名を取得
      if (block.type === 'section' && block.text) {
        const t = block.text.text || '';
        const match = t.match(/\|([^>]+)>\*/);
        if (match) {
          customerName = match[1];
        }
      }

      // contextからサービス名・商談日時・フェーズ取得
      if (block.type === 'context' && block.elements) {
        for (const el of block.elements) {
          const et = el.text || '';
          if (et.includes('サービス:')) {
            const sm = et.match(/\*([^*]+)\*/);
            if (sm) service = sm[1];
          }
          if (et.includes('商談日時:')) {
            const dm = et.match(/\*(\d{4}\/\d{2}\/\d{2})/);
            if (dm) scheduledDate = dm[1].replace(/\//g, '-');
          }
          if (et.includes('フェーズ:')) {
            const pm = et.match(/\*([^*]+)\*/);
            if (pm) phase = pm[1];
          }
        }
      }

      // fieldsからリスケ情報取得
      if (block.type === 'section' && block.fields) {
        for (const f of block.fields) {
          const ft = f.text || '';
          if (ft.includes('~リスケ~') || ft.includes('~')) {
            // リスケフラグ
          }
          const dateMatch = ft.match(/(\d{4}\/\d{2}\/\d{2})/);
          if (dateMatch) {
            newScheduledDate = dateMatch[1].replace(/\//g, '-');
          }
        }
      }
    }
  }

  if (!customerName || !scheduledDate) return null;

  // 更新メッセージの場合、フェーズで判断
  if (action === 'updated') {
    if (phase === '要対応') {
      // リスケの可能性が高い
      action = 'reschedule';
    } else if (phase === '承認待ち') {
      // まだ承認前なのでスキップ
      return null;
    } else {
      // その他の更新はスキップ
      return null;
    }
  }

  return {
    action,
    customerName,
    scheduledDate,
    service,
    newScheduledDate
  };
}
