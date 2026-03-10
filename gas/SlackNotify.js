/**
 * Slack定時通知スクリプト（成果報酬チーム）
 *
 * トリガー設定:
 * - sendSeikaSlackNotification を時間ベーストリガーで以下の時間に実行:
 *   12:00, 15:00, 18:00, 20:00
 */

/**
 * メイン: Slack売上速報通知
 */
function sendSeikaSlackNotification() {
  try {
    const now = new Date();
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const timeLabel = hour + ':' + minute;

    // 今月のデータ取得
    const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const startDate = ym + '-01';
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const endDate = ym + '-' + String(lastDay).padStart(2, '0');

    // Tursoからデータ取得
    const perfData = queryTurso(
      "SELECT member_name, SUM(call_count) as calls, SUM(pr_count) as pr, SUM(appointment_count) as appo, SUM(appointment_amount) as amount FROM performance_rawdata WHERE input_date >= ? AND input_date <= ? GROUP BY member_name",
      [startDate, endDate]
    );

    const settings = queryTurso("SELECT * FROM settings");
    const settingsMap = {};
    settings.forEach(function(s) { settingsMap[s.key] = s.value; });

    const monthlyTarget = parseInt(settingsMap.monthly_target_total || '9000000');

    // 全体集計
    let totalCalls = 0, totalPR = 0, totalAppo = 0, totalAmount = 0;
    perfData.forEach(function(d) {
      totalCalls += parseInt(d.calls) || 0;
      totalPR += parseInt(d.pr) || 0;
      totalAppo += parseInt(d.appo) || 0;
      totalAmount += parseInt(d.amount) || 0;
    });

    const achieveRate = monthlyTarget > 0 ? (totalAmount / monthlyTarget * 100).toFixed(1) : '0';

    // 実施確定金額
    const appoData = queryTurso(
      "SELECT status, SUM(amount) as total FROM appointments WHERE acquisition_date >= ? AND acquisition_date <= ? GROUP BY status",
      [startDate, endDate]
    );

    let executedAmount = 0;
    appoData.forEach(function(a) {
      if (a.status === '実施') executedAmount = parseInt(a.total) || 0;
    });

    // 営業日数計算
    const holidays = queryTurso("SELECT date FROM holidays");
    const holidaySet = {};
    holidays.forEach(function(h) { holidaySet[h.date] = true; });

    let totalDays = 0, elapsed = 0;
    for (let d = 1; d <= lastDay; d++) {
      const date = new Date(now.getFullYear(), now.getMonth(), d);
      const dateStr = formatDateGAS(date);
      const dow = date.getDay();
      if (dow === 0 || dow === 6 || holidaySet[dateStr]) continue;
      totalDays++;
      if (date <= now) elapsed++;
    }

    const standardProgress = totalDays > 0 ? (elapsed / totalDays * 100).toFixed(1) : '0';
    const remaining = totalDays - elapsed;

    // 本日の実績
    const todayStr = formatDateGAS(now);
    const todayData = queryTurso(
      "SELECT SUM(call_count) as calls, SUM(pr_count) as pr, SUM(appointment_count) as appo, SUM(appointment_amount) as amount FROM performance_rawdata WHERE input_date = ?",
      [todayStr]
    );

    const todayCalls = todayData.length > 0 ? (parseInt(todayData[0].calls) || 0) : 0;
    const todayPR = todayData.length > 0 ? (parseInt(todayData[0].pr) || 0) : 0;
    const todayAppo = todayData.length > 0 ? (parseInt(todayData[0].appo) || 0) : 0;
    const todayAmount = todayData.length > 0 ? (parseInt(todayData[0].amount) || 0) : 0;

    // チーム別集計
    const teams = {
      '野口Team': ['野口', '中村た', '田中か', '辻森'],
      '松居Team': ['松居', '山本', '美除'],
      '坪井Team': ['坪井', '村松', '田中颯']
    };

    let teamLines = '';
    for (var teamName in teams) {
      var teamMembers = teams[teamName];
      var teamAmount = 0;
      perfData.forEach(function(d) {
        if (teamMembers.some(function(m) { return d.member_name && d.member_name.includes(m); })) {
          teamAmount += parseInt(d.amount) || 0;
        }
      });
      var teamRate = monthlyTarget > 0 ? (teamAmount / monthlyTarget * 100 * 3).toFixed(1) : '0'; // チーム目標は全体の1/3想定
      teamLines += teamName + ': ¥' + teamAmount.toLocaleString() + '\n';
    }

    // メッセージ構築
    const gap = monthlyTarget - totalAmount;
    const dailyNeeded = remaining > 0 ? Math.ceil(gap / remaining) : gap;

    let alertLine = '';
    if (parseFloat(achieveRate) < parseFloat(standardProgress) - 5) {
      alertLine = '\n⚠️ アラート: 目標差分 -¥' + gap.toLocaleString() + '（残' + remaining + '日で日次¥' + dailyNeeded.toLocaleString() + '必要）';
    }

    const message = '📊 成果報酬チーム 売上速報（' + timeLabel + '時点）\n'
      + '━━━━━━━━━━━━━━━━━━\n'
      + '🎯 月間目標: ¥' + monthlyTarget.toLocaleString() + '\n'
      + '📈 取得金額: ¥' + totalAmount.toLocaleString() + '（' + achieveRate + '%）\n'
      + '✅ 実施確定: ¥' + executedAmount.toLocaleString() + '\n'
      + '📊 標準進捗: ' + standardProgress + '%\n'
      + '\n'
      + '【本日の実績】\n'
      + '架電: ' + todayCalls + '件 | PR: ' + todayPR + '件 | アポ: ' + todayAppo + '件\n'
      + '金額: ¥' + todayAmount.toLocaleString() + '\n'
      + '\n'
      + '【チーム別】\n'
      + teamLines
      + alertLine;

    sendSlackNotificationSeika(message);
    Logger.log('Slack通知送信完了: ' + timeLabel);

  } catch (error) {
    Logger.log('Slack通知エラー: ' + error.message);
    sendSlackNotificationSeika('❌ 成果報酬チーム売上速報の生成でエラーが発生しました: ' + error.message);
  }
}
