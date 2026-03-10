// ==================== Turso DB 設定 ====================
const TURSO_CONFIG = {
    url: 'https://seika-hoshu-db-ebidigi-ebidigi.aws-ap-northeast-1.turso.io',
    authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzMxMDE2NTgsImlkIjoiMDE5Y2Q1MTgtMTYwMS03NDUzLTg2NTktZDdhZGRhNDY2ZDJhIiwicmlkIjoiNDQ4MTQ4ODAtZDdlZS00NTBlLWFjYTgtMDczYzI2Njk2MDhlIn0.YuB6UZYWy9iE1MxrQe4oKX7OyPjAqtT12RRZeaOzjSueyqR9_HbZUPvmPhiK8fQi-5a3iK3CqkG4lLhVrRn1Cg'
};

// ==================== グローバル状態 ====================
let currentTab = 'overview';
let performanceData = [];
let appointmentsData = [];
let membersData = [];
let teamsData = [];
let projectsData = [];
let targetsData = [];
let settingsMap = {};
let holidaysSet = new Set();
let charts = {};
let currentAppoFilter = 'all';
let currentAnalysisView = 'daily';
let currentAnalysisChart = 'calls';
let assignmentsData = [];
let editingAssignmentId = null;
let executionAppoData = []; // 当月実施予定のアポ（前月以前取得含む）
let appoShowAll = false; // false=今日まで, true=全一覧

// ==================== 初期化 ====================
document.addEventListener('DOMContentLoaded', () => {
    // 月フィルターを今月に設定
    const now = new Date();
    const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById('filterMonth').value = ym;

    // 日次目標の日付をデフォルトで明日に
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('dailyTargetDate').value = formatDate(tomorrow);

    // 概要タブがデフォルトなのでフィルターを非表示
    const filters = document.getElementById('globalFilters');
    if (filters) filters.style.display = 'none';

    // URL パラメータで外部共有モード
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'external') {
        enterExternalMode(params.get('project'));
    }

    loadAllData();
});

// ==================== Turso API ====================
async function queryTurso(sql, args = []) {
    const payload = {
        statements: [{ q: sql, params: args }]
    };

    const response = await fetch(TURSO_CONFIG.url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${TURSO_CONFIG.authToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`Turso API error: ${response.status}`);
    }

    const result = await response.json();
    if (result[0] && result[0].error) {
        throw new Error(result[0].error.message || result[0].error);
    }

    const queryResult = result[0];
    if (!queryResult || !queryResult.results) return [];

    const cols = queryResult.results.columns || [];
    const rows = queryResult.results.rows || [];

    return rows.map(row => {
        const obj = {};
        row.forEach((cell, i) => { obj[cols[i]] = cell; });
        return obj;
    });
}

async function executeTurso(sql, args = []) {
    return queryTurso(sql, args);
}

// ==================== データ読み込み ====================
async function loadAllData() {
    showLoading();
    try {
        console.log('Loading master data...');
        const results = await Promise.all([
            queryTurso("SELECT * FROM members WHERE status = 'active' ORDER BY team_name, member_name"),
            queryTurso("SELECT * FROM teams WHERE status = 'active'"),
            queryTurso("SELECT * FROM projects WHERE status = 'active' ORDER BY project_name"),
            queryTurso("SELECT * FROM settings"),
            queryTurso("SELECT date FROM holidays")
        ]);

        membersData = results[0];
        teamsData = results[1];
        projectsData = results[2];
        settingsMap = {};
        results[3].forEach(s => { settingsMap[s.key] = s.value; });
        holidaysSet = new Set(results[4].map(h => h.date));

        console.log('Master data loaded:', membersData.length, 'members,', teamsData.length, 'teams,', projectsData.length, 'projects');

        populateMemberFilter();
        populateDailyTargetMember();

        await loadMonthData();

        document.getElementById('lastUpdated').textContent = `最終更新: ${new Date().toLocaleString('ja-JP')}`;
    } catch (error) {
        console.error('Data load error:', error);
        showError('データの読み込みに失敗しました: ' + error.message);
    } finally {
        hideLoading();
    }
}

async function loadMonthData() {
    const ym = document.getElementById('filterMonth').value;
    const startDate = ym + '-01';
    const endDate = getEndOfMonth(ym);

    console.log('Loading month data:', ym, startDate, '~', endDate);

    const results = await Promise.all([
        queryTurso(
            "SELECT * FROM performance_rawdata WHERE input_date >= ? AND input_date <= ? ORDER BY input_date",
            [startDate, endDate]
        ),
        queryTurso(
            "SELECT * FROM appointments WHERE acquisition_date >= ? AND acquisition_date <= ? ORDER BY acquisition_date DESC",
            [startDate, endDate]
        ),
        queryTurso(
            "SELECT * FROM targets WHERE year_month = ?",
            [ym]
        ),
        queryTurso(
            "SELECT * FROM project_member_assignments WHERE year_month = ? ORDER BY rank, project_name, member_name",
            [ym]
        ),
        // 当月実施予定アポ（前月以前取得含む）
        queryTurso(
            "SELECT * FROM appointments WHERE scheduled_date >= ? AND scheduled_date <= ? ORDER BY scheduled_date",
            [startDate, endDate]
        )
    ]);

    performanceData = results[0];
    appointmentsData = results[1];
    targetsData = results[2];
    assignmentsData = results[3] || [];
    executionAppoData = results[4] || [];

    // appointment_amountが0の場合、案件マスタの単価×アポ数で補完
    const projectPriceMap = {};
    projectsData.forEach(p => { projectPriceMap[p.project_name] = p.unit_price || 0; });

    performanceData.forEach(d => {
        if (!d.appointment_amount && d.appointment_count > 0) {
            const unitPrice = projectPriceMap[d.project_name] || 0;
            d.appointment_amount = unitPrice * d.appointment_count;
        }
    });

    console.log('Month data loaded:', performanceData.length, 'perf rows,', appointmentsData.length, 'appointments,', targetsData.length, 'targets');

    renderAll();
}

function refreshData() {
    const btn = document.getElementById('refreshBtn');
    btn.disabled = true;
    loadAllData().finally(() => { btn.disabled = false; });
}

// ==================== レンダリング統合 ====================
function renderAll() {
    const filter = getFilters();
    const filteredPerf = filterPerformance(performanceData, filter);
    const filteredAppo = filterAppointments(appointmentsData, filter);
    const filteredExecAppo = filterAppointments(executionAppoData, filter);

    // 概要は常にフィルタなし（全体表示）
    const noFilter = { team: 'all', member: 'all', month: filter.month };
    renderOverview(performanceData, appointmentsData, executionAppoData, noFilter);

    // 他のタブはフィルター適用
    renderAppointments();
    renderYield(filteredPerf, filter);
    renderProjects();
    renderAnalysis(filteredPerf, filter);
    renderSettings();
}

// ==================== フィルター ====================
function getFilters() {
    return {
        team: document.getElementById('filterTeam').value,
        member: document.getElementById('filterMember').value,
        month: document.getElementById('filterMonth').value
    };
}

function filterPerformance(data, filter) {
    let result = data;
    if (filter.team !== 'all') {
        const teamMembers = membersData.filter(m => m.team_name === filter.team).map(m => m.member_name);
        result = result.filter(d => teamMembers.includes(d.member_name));
    }
    if (filter.member !== 'all') {
        result = result.filter(d => d.member_name === filter.member);
    }
    return result;
}

function filterAppointments(data, filter) {
    let result = data;
    if (filter.team !== 'all') {
        const teamMembers = membersData.filter(m => m.team_name === filter.team).map(m => m.member_name);
        result = result.filter(d => teamMembers.includes(d.member_name));
    }
    if (filter.member !== 'all') {
        result = result.filter(d => d.member_name === filter.member);
    }
    return result;
}

function applyFilters() {
    // チーム選択時にメンバーフィルターを更新
    const team = document.getElementById('filterTeam').value;
    const memberSelect = document.getElementById('filterMember');
    const currentMember = memberSelect.value;

    memberSelect.innerHTML = '<option value="all">全員</option>';
    const filtered = team === 'all' ? membersData : membersData.filter(m => m.team_name === team);
    filtered.forEach(m => {
        memberSelect.innerHTML += `<option value="${m.member_name}">${displayName(m.member_name)}</option>`;
    });

    // 以前の選択を維持できる場合は維持
    if (filtered.some(m => m.member_name === currentMember)) {
        memberSelect.value = currentMember;
    }

    loadMonthData();
}

function populateMemberFilter() {
    const select = document.getElementById('filterMember');
    select.innerHTML = '<option value="all">全員</option>';
    membersData.forEach(m => {
        select.innerHTML += `<option value="${m.member_name}">${displayName(m.member_name)}</option>`;
    });
}

function populateDailyTargetMember() {
    const select = document.getElementById('dailyTargetMember');
    select.innerHTML = '';
    membersData.forEach(m => {
        select.innerHTML += `<option value="${m.member_name}">${displayName(m.member_name)}</option>`;
    });
}

// ==================== Tab 1: 概要 ====================
function renderOverview(perfData, appoData, execAppoData, filter) {
    const ym = filter.month;
    const totalTarget = getTarget('total', 'all', ym);
    const monthlyTarget = totalTarget ? totalTarget.appointment_amount_target : parseInt(settingsMap.monthly_target_total || '9000000');
    const executionTarget = totalTarget ? (totalTarget.execution_target || monthlyTarget) : monthlyTarget;

    // 稼働実績集計（performance_rawdata）
    const totalCalls = sum(perfData, 'call_count');
    const totalPR = sum(perfData, 'pr_count');
    const totalAppo = sum(perfData, 'appointment_count');
    const totalHours = sum(perfData, 'call_hours');

    // 取得金額（当月 acquisition_date のアポ金額合計）
    const acquisitionAmount = appoData.reduce((s, a) => s + (a.amount || 0), 0);

    // 実施金額（当月 scheduled_date のアポ、前月以前取得含む）
    const execTotal = execAppoData.reduce((s, a) => s + (a.amount || 0), 0);
    const execConfirmed = execAppoData.filter(a => a.status === '実施').reduce((s, a) => s + (a.amount || 0), 0);
    const execUnconfirmed = execAppoData.filter(a => a.status === '未確認').reduce((s, a) => s + (a.amount || 0), 0);
    const execCancelled = execAppoData.filter(a => a.status === 'キャンセル').reduce((s, a) => s + (a.amount || 0), 0);
    const execReschedule = execAppoData.filter(a => a.status === 'リスケ').reduce((s, a) => s + (a.amount || 0), 0);
    // 実施見込み = 確定 + 未確認（キャンセル・リスケ除く）
    const execExpected = execConfirmed + execUnconfirmed;

    // 営業日計算
    const { elapsed, total: totalDays } = getBusinessDays(ym);
    const standardProgress = totalDays > 0 ? Math.round(elapsed / totalDays * 1000) / 10 : 0;
    const remaining = totalDays - elapsed;

    document.getElementById('progressBadge').textContent = `標準進捗: ${standardProgress}%`;
    document.getElementById('dateInfo').textContent = `${ym} | 経過 ${elapsed}日 / 全${totalDays}営業日`;

    // 取得目標 進捗バー
    const acqRate = monthlyTarget > 0 ? Math.round(acquisitionAmount / monthlyTarget * 1000) / 10 : 0;
    const acqBarWidth = Math.min(acqRate, 100);
    const acqBarColor = acqRate >= standardProgress ? '#86aaec' : acqRate >= standardProgress * 0.8 ? '#ede07d' : '#ef947a';

    // 実施目標 進捗バー
    const execRate = executionTarget > 0 ? Math.round(execExpected / executionTarget * 1000) / 10 : 0;
    const execBarWidth = Math.min(execRate, 100);
    const execBarColor = execRate >= standardProgress ? '#86aaec' : execRate >= standardProgress * 0.8 ? '#ede07d' : '#ef947a';

    document.getElementById('salesTargetCard').innerHTML = `
        <div class="sales-target-card" style="grid-template-columns:1fr;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
                <div>
                    <div class="sales-target-label">取得金額（目標: ¥${monthlyTarget.toLocaleString()}）</div>
                    <div class="sales-target-amount">¥${acquisitionAmount.toLocaleString()}</div>
                    <div class="sales-target-bar-wrap" style="margin-top:8px;">
                        <div class="sales-target-bar-info">
                            <span>達成率 ${acqRate}%</span>
                            <span>残 ¥${Math.max(0, monthlyTarget - acquisitionAmount).toLocaleString()}</span>
                        </div>
                        <div class="sales-target-bar">
                            <div class="sales-target-bar-fill" style="width:${acqBarWidth}%;background:${acqBarColor};"></div>
                            <div class="sales-target-bar-line" style="left:${Math.min(standardProgress, 100)}%;"></div>
                        </div>
                    </div>
                </div>
                <div>
                    <div class="sales-target-label">実施金額（目標: ¥${executionTarget.toLocaleString()}）</div>
                    <div class="sales-target-amount">¥${execExpected.toLocaleString()}</div>
                    <div class="sales-target-bar-wrap" style="margin-top:8px;">
                        <div class="sales-target-bar-info">
                            <span>見込率 ${execRate}%</span>
                            <span>確定 ¥${execConfirmed.toLocaleString()}</span>
                        </div>
                        <div class="sales-target-bar">
                            <div class="sales-target-bar-fill" style="width:${execBarWidth}%;background:${execBarColor};"></div>
                            <div class="sales-target-bar-line" style="left:${Math.min(standardProgress, 100)}%;"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // アラート
    const alerts = [];
    if (acqRate < standardProgress - 10) {
        const gap = monthlyTarget - acquisitionAmount;
        const dailyNeeded = remaining > 0 ? Math.ceil(gap / remaining) : gap;
        alerts.push(`取得目標差分 -¥${gap.toLocaleString()}（残${remaining}日で日次¥${dailyNeeded.toLocaleString()}必要）`);
    }
    const unconfirmedCount = execAppoData.filter(a => a.status === '未確認').length;
    if (unconfirmedCount > 0) {
        alerts.push(`当月実施予定で未確認アポが ${unconfirmedCount}件 あります`);
    }
    if (execCancelled > 0) {
        alerts.push(`当月キャンセル ¥${execCancelled.toLocaleString()} / リスケ ¥${execReschedule.toLocaleString()}`);
    }

    document.getElementById('alertBanners').innerHTML = alerts.map(a =>
        `<div class="alert-banner"><span class="alert-banner-icon">&#9888;</span><span class="alert-banner-text">${a}</span></div>`
    ).join('');

    // 必要アポ数
    const appoCount = appoData.length;
    if (remaining > 0 && monthlyTarget > acquisitionAmount) {
        const avgUnitPrice = appoCount > 0 ? Math.round(acquisitionAmount / appoCount) : 30000;
        const neededAppo = Math.ceil((monthlyTarget - acquisitionAmount) / avgUnitPrice);
        const dailyAppo = Math.ceil(neededAppo / remaining);
        document.getElementById('requiredAppoCard').innerHTML = `
            <div class="required-appo-card">
                <div class="required-appo-label">目標達成に必要な残アポ数</div>
                <div class="required-appo-value">${neededAppo}件</div>
                <div class="required-appo-label">（日次 ${dailyAppo}件 × 残${remaining}日 | 平均単価 ¥${avgUnitPrice.toLocaleString()}）</div>
            </div>
        `;
    } else {
        document.getElementById('requiredAppoCard').innerHTML = '';
    }

    // KPIカード
    document.getElementById('kpiCards').innerHTML = `
        <div class="kpi-grid">
            <div class="kpi-card highlight">
                <div class="kpi-label">取得金額</div>
                <div class="kpi-value">¥${acquisitionAmount.toLocaleString()}</div>
                <div class="kpi-sub">目標 ¥${monthlyTarget.toLocaleString()} | ${acqRate}%</div>
            </div>
            <div class="kpi-card highlight">
                <div class="kpi-label">実施見込金額</div>
                <div class="kpi-value">¥${execExpected.toLocaleString()}</div>
                <div class="kpi-sub">確定 ¥${execConfirmed.toLocaleString()} | 未確認 ¥${execUnconfirmed.toLocaleString()}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-label">架電数</div>
                <div class="kpi-value">${totalCalls.toLocaleString()}</div>
                <div class="kpi-sub">架電/H: ${totalHours > 0 ? (totalCalls / totalHours).toFixed(1) : '-'}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-label">PR数</div>
                <div class="kpi-value">${totalPR.toLocaleString()}</div>
                <div class="kpi-sub">架電toPR: ${totalCalls > 0 ? (totalPR / totalCalls * 100).toFixed(1) + '%' : '-'}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-label">アポ数（取得）</div>
                <div class="kpi-value">${appoCount.toLocaleString()}</div>
                <div class="kpi-sub">PRtoアポ: ${totalPR > 0 ? (appoCount / totalPR * 100).toFixed(1) + '%' : '-'}</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-label">稼働時間</div>
                <div class="kpi-value">${totalHours.toFixed(1)}h</div>
                <div class="kpi-sub">アポ数（実績rawdata）: ${totalAppo}</div>
            </div>
        </div>
    `;

    // チームカード
    renderTeamCards(perfData, appoData, execAppoData, standardProgress);

    // メンバーカード
    renderMemberCards(perfData, appoData, standardProgress);
}

function renderTeamCards(perfData, appoData, execAppoData, standardProgress) {
    const ym = document.getElementById('filterMonth').value;

    const teamNames = ['野口Team', '坪井Team', '松居Team'];
    let html = '<div class="team-grid">';

    teamNames.forEach(teamName => {
        const teamMembers = membersData.filter(m => m.team_name === teamName).map(m => m.member_name);
        const teamPerf = perfData.filter(d => teamMembers.includes(d.member_name));
        const teamAppo = appoData.filter(d => teamMembers.includes(d.member_name));
        const teamExec = execAppoData.filter(d => teamMembers.includes(d.member_name));

        const calls = sum(teamPerf, 'call_count');
        const pr = sum(teamPerf, 'pr_count');
        const hours = sum(teamPerf, 'call_hours');

        // 取得金額（当月取得アポ）
        const acqAmount = teamAppo.reduce((s, a) => s + (a.amount || 0), 0);
        const acqCount = teamAppo.length;

        // 実施金額（当月実施予定、前月取得含む）
        const execAmount = teamExec.filter(a => a.status !== 'キャンセル' && a.status !== 'リスケ').reduce((s, a) => s + (a.amount || 0), 0);

        const teamTarget = getTarget('team', teamName, ym);
        const target = teamTarget ? teamTarget.appointment_amount_target : 0;
        const execTarget = teamTarget ? (teamTarget.execution_target || target) : 0;
        const acqRate = target > 0 ? Math.round(acqAmount / target * 1000) / 10 : 0;
        const execRate = execTarget > 0 ? Math.round(execAmount / execTarget * 1000) / 10 : 0;
        const barColor = acqRate >= standardProgress ? 'var(--success)' : acqRate >= standardProgress * 0.8 ? 'var(--warning)' : 'var(--danger)';

        html += `
            <div class="team-card">
                <div class="team-card-header">
                    <span class="team-name">${teamName}</span>
                    <span class="team-progress" style="color:${barColor};">${acqRate}%</span>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                    <div>
                        <div style="font-size:0.7rem;color:var(--text-light);">取得</div>
                        <div class="number" style="font-size:0.95rem;font-weight:600;">¥${acqAmount.toLocaleString()}</div>
                        <div style="font-size:0.65rem;color:var(--text-light);">${target > 0 ? '目標 ¥' + (target / 10000).toFixed(0) + '万' : ''}</div>
                    </div>
                    <div>
                        <div style="font-size:0.7rem;color:var(--text-light);">実施見込</div>
                        <div class="number" style="font-size:0.95rem;font-weight:600;">¥${execAmount.toLocaleString()}</div>
                        <div style="font-size:0.65rem;color:var(--text-light);">${execTarget > 0 ? '目標 ¥' + (execTarget / 10000).toFixed(0) + '万' : ''}</div>
                    </div>
                </div>
                <div class="progress-bar">
                    <div class="progress-bar-fill" style="width:${Math.min(acqRate, 100)}%;background:${barColor};"></div>
                    <div class="progress-bar-line" style="left:${Math.min(standardProgress, 100)}%;"></div>
                </div>
                <div class="team-stats">
                    <div class="team-stat">
                        <div class="team-stat-label">架電</div>
                        <div class="team-stat-value">${calls.toLocaleString()}</div>
                    </div>
                    <div class="team-stat">
                        <div class="team-stat-label">PR</div>
                        <div class="team-stat-value">${pr}</div>
                    </div>
                    <div class="team-stat">
                        <div class="team-stat-label">アポ</div>
                        <div class="team-stat-value">${acqCount}</div>
                    </div>
                    <div class="team-stat">
                        <div class="team-stat-label">時間</div>
                        <div class="team-stat-value">${hours.toFixed(0)}h</div>
                    </div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    document.getElementById('teamCards').innerHTML = html;
}

function renderMemberCards(perfData, appoData, standardProgress) {
    let html = '<div class="member-grid">';

    membersData.forEach(member => {
        const memberPerf = perfData.filter(d => d.member_name === member.member_name);
        const memberAppo = appoData.filter(d => d.member_name === member.member_name);
        const calls = sum(memberPerf, 'call_count');
        const pr = sum(memberPerf, 'pr_count');
        const appo = memberAppo.length;
        const amount = memberAppo.reduce((s, a) => s + (a.amount || 0), 0);
        const hours = sum(memberPerf, 'call_hours');

        const ym = document.getElementById('filterMonth').value;
        const memberTarget = getTarget('member', member.member_name, ym);
        const target = memberTarget ? memberTarget.appointment_amount_target : 0;
        const rate = target > 0 ? Math.round(amount / target * 1000) / 10 : 0;

        const barColor = rate >= standardProgress ? 'var(--success)' : rate >= standardProgress * 0.8 ? 'var(--warning)' : 'var(--danger)';

        html += `
            <div class="member-card">
                <div class="member-card-header">
                    <span class="member-name">${displayName(member.member_name)}</span>
                    <span class="member-team-badge">${member.team_name}</span>
                </div>
                ${target > 0 ? `
                <div class="progress-bar">
                    <div class="progress-bar-fill" style="width:${Math.min(rate, 100)}%;background:${barColor};"></div>
                    <div class="progress-bar-line" style="left:${Math.min(standardProgress || 0, 100)}%;"></div>
                </div>
                <div style="font-size:0.75rem;color:var(--text-light);margin-bottom:4px;">¥${amount.toLocaleString()} / ¥${target.toLocaleString()} (${rate}%)</div>
                ` : `<div style="font-size:0.75rem;color:var(--text-light);margin-bottom:4px;">¥${amount.toLocaleString()}</div>`}
                <div class="member-stats">
                    <div class="member-stat">
                        <div class="member-stat-label">架電</div>
                        <div class="member-stat-value">${calls}</div>
                    </div>
                    <div class="member-stat">
                        <div class="member-stat-label">PR</div>
                        <div class="member-stat-value">${pr}</div>
                    </div>
                    <div class="member-stat">
                        <div class="member-stat-label">アポ</div>
                        <div class="member-stat-value">${appo}</div>
                    </div>
                    <div class="member-stat">
                        <div class="member-stat-label">時間</div>
                        <div class="member-stat-value">${hours.toFixed(1)}h</div>
                    </div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    document.getElementById('memberCards').innerHTML = html;
}

// ==================== Tab 2: アポ確認管理 ====================
function renderAppointments() {
    const filter = getFilters();
    const allData = filterAppointments(executionAppoData, filter);

    // サマリーは常に当月全体で計算
    const statusCounts = { '未確認': 0, '実施': 0, 'リスケ': 0, 'キャンセル': 0 };
    const statusAmounts = { '未確認': 0, '実施': 0, 'リスケ': 0, 'キャンセル': 0 };
    allData.forEach(a => {
        if (statusCounts[a.status] !== undefined) {
            statusCounts[a.status]++;
            statusAmounts[a.status] += a.amount || 0;
        }
    });

    // 未確認バッジ
    const badge = document.getElementById('unconfirmedBadge');
    if (statusCounts['未確認'] > 0) {
        badge.textContent = statusCounts['未確認'];
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }

    // ステータスサマリ
    document.getElementById('appo-status-summary').innerHTML = `
        <div class="rate-grid" style="margin-bottom:20px;">
            <div class="rate-card">
                <div class="rate-value" style="color:var(--text-dark);">${allData.length}</div>
                <div class="rate-label">総アポ数</div>
            </div>
            <div class="rate-card">
                <div class="rate-value" style="color:var(--primary-blue);">${statusCounts['実施']}</div>
                <div class="rate-label">実施確定 (¥${statusAmounts['実施'].toLocaleString()})</div>
            </div>
            <div class="rate-card">
                <div class="rate-value" style="color:#8a7a00;">${statusCounts['リスケ']}</div>
                <div class="rate-label">リスケ (¥${statusAmounts['リスケ'].toLocaleString()})</div>
            </div>
            <div class="rate-card">
                <div class="rate-value" style="color:var(--primary-red);">${statusCounts['キャンセル']}</div>
                <div class="rate-label">キャンセル</div>
            </div>
        </div>
    `;

    // テーブル用データ: 今日までフィルタ + ステータスフィルタ
    let tableData = allData;
    if (!appoShowAll) {
        const today = new Date().toISOString().split('T')[0];
        tableData = tableData.filter(a => a.scheduled_date <= today);
    }
    const filtered = currentAppoFilter === 'all' ? tableData : tableData.filter(a => a.status === currentAppoFilter);

    const tbody = document.getElementById('appoTableBody');
    tbody.innerHTML = filtered.map(a => {
        const statusClass = a.status === '未確認' ? 'status-unconfirmed' :
                           a.status === '実施' ? 'status-executed' :
                           a.status === 'リスケ' ? 'status-rescheduled' : 'status-cancelled';
        return `
            <tr>
                <td>${a.acquisition_date || '-'}</td>
                <td>${displayName(a.member_name)}</td>
                <td>${a.project_name}</td>
                <td>${a.customer_name || '-'}</td>
                <td>${a.scheduled_date || '-'}</td>
                <td class="text-right number">¥${(a.amount || 0).toLocaleString()}</td>
                <td><span class="status-badge ${statusClass}">${a.status}</span></td>
                <td>
                    <div style="display:flex;gap:4px;">
                        ${a.status === '未確認' ? `
                            <button class="status-btn btn-execute" onclick="updateAppoStatus('${a.id}','実施')">実施</button>
                            <button class="status-btn btn-reschedule" onclick="updateAppoStatus('${a.id}','リスケ')">リスケ</button>
                            <button class="status-btn btn-cancel" onclick="updateAppoStatus('${a.id}','キャンセル')">取消</button>
                        ` : `
                            <button class="status-btn" onclick="updateAppoStatus('${a.id}','未確認')">戻す</button>
                        `}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // 確認率サマリ
    const total = allData.length;
    const cancelRate = total > 0 ? (statusCounts['キャンセル'] / total * 100).toFixed(1) : '0';
    const rescheduleRate = total > 0 ? (statusCounts['リスケ'] / total * 100).toFixed(1) : '0';
    const executeRate = total > 0 ? (statusCounts['実施'] / total * 100).toFixed(1) : '0';
    const nonExecuteRate = total > 0 ? ((statusCounts['リスケ'] + statusCounts['キャンセル']) / total * 100).toFixed(1) : '0';

    document.getElementById('appoRateGrid').innerHTML = `
        <div class="rate-card">
            <div class="rate-value" style="color:var(--primary-blue);">${executeRate}%</div>
            <div class="rate-label">実施率</div>
        </div>
        <div class="rate-card">
            <div class="rate-value" style="color:var(--primary-red);">${cancelRate}%</div>
            <div class="rate-label">キャンセル率</div>
        </div>
        <div class="rate-card">
            <div class="rate-value" style="color:#8a7a00;">${rescheduleRate}%</div>
            <div class="rate-label">リスケ率</div>
        </div>
        <div class="rate-card">
            <div class="rate-value" style="color:var(--text-dark);">${nonExecuteRate}%</div>
            <div class="rate-label">非実施率(リスケ+取消)</div>
        </div>
    `;
}

function filterAppoStatus(status) {
    currentAppoFilter = status;
    document.querySelectorAll('.appo-status-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.status === status);
    });
    const filter = getFilters();
    renderAppointments();
}

function toggleAppoRange() {
    appoShowAll = !appoShowAll;
    const btn = document.getElementById('appoShowAllBtn');
    btn.textContent = appoShowAll ? '今日までを表示' : '全一覧を表示';
    const filter = getFilters();
    renderAppointments();
}


async function updateAppoStatus(id, newStatus) {
    console.log('updateAppoStatus called:', id, newStatus);
    try {
        const now = new Date().toISOString().split('T')[0];
        if (newStatus === '未確認') {
            await executeTurso(
                "UPDATE appointments SET status = ?, confirmation_date = NULL, confirmed_by = NULL, updated_at = datetime('now') WHERE id = ?",
                [newStatus, id]
            );
        } else {
            await executeTurso(
                "UPDATE appointments SET status = ?, confirmation_date = ?, confirmed_by = 'dashboard', updated_at = datetime('now') WHERE id = ?",
                [newStatus, now, id]
            );
        }
        console.log('DB update done');

        // ローカルデータ更新（両方のリストを更新）
        [appointmentsData, executionAppoData].forEach(list => {
            const appo = list.find(a => a.id === id);
            if (appo) {
                appo.status = newStatus;
                appo.confirmation_date = newStatus !== '未確認' ? now : null;
            }
        });
        console.log('Local data updated');

        const filter = getFilters();
        renderAppointments();
        console.log('renderAppointments done');
    } catch (error) {
        console.error('Status update error:', error, error.stack);
        alert('ステータス更新に失敗しました: ' + error.message);
    }
}

// ==================== Tab 3: 歩留まり分析 ====================
function renderYield(perfData, filter) {
    const totalCalls = sum(perfData, 'call_count');
    const totalPR = sum(perfData, 'pr_count');
    const totalAppo = sum(perfData, 'appointment_count');

    const callToPR = totalCalls > 0 ? (totalPR / totalCalls * 100) : 0;
    const prToAppo = totalPR > 0 ? (totalAppo / totalPR * 100) : 0;
    const callToAppo = totalCalls > 0 ? (totalAppo / totalCalls * 100) : 0;

    // ファネル
    const maxHeight = 160;
    const callH = maxHeight;
    const prH = totalCalls > 0 ? Math.max(20, totalPR / totalCalls * maxHeight) : 20;
    const appoH = totalCalls > 0 ? Math.max(20, totalAppo / totalCalls * maxHeight) : 20;

    document.getElementById('funnelContainer').innerHTML = `
        <div class="funnel-stage">
            <div class="funnel-bar" style="width:100px;height:${callH}px;background:var(--blue-100);"></div>
            <div class="funnel-value">${totalCalls.toLocaleString()}</div>
            <div class="funnel-label">架電数</div>
        </div>
        <div style="text-align:center;">
            <div class="funnel-arrow">→</div>
            <div class="funnel-rate">${callToPR.toFixed(1)}%</div>
        </div>
        <div class="funnel-stage">
            <div class="funnel-bar" style="width:100px;height:${prH}px;background:var(--cyan-100);"></div>
            <div class="funnel-value">${totalPR.toLocaleString()}</div>
            <div class="funnel-label">PR数</div>
        </div>
        <div style="text-align:center;">
            <div class="funnel-arrow">→</div>
            <div class="funnel-rate">${prToAppo.toFixed(1)}%</div>
        </div>
        <div class="funnel-stage">
            <div class="funnel-bar" style="width:100px;height:${appoH}px;background:var(--yellow-100);"></div>
            <div class="funnel-value">${totalAppo.toLocaleString()}</div>
            <div class="funnel-label">アポ数</div>
        </div>
    `;

    // メンバー/チーム別歩留まりテーブル
    const entities = filter.team !== 'all'
        ? membersData.filter(m => m.team_name === filter.team)
        : filter.member !== 'all'
            ? membersData.filter(m => m.member_name === filter.member)
            : membersData;

    let yieldRows = '';
    entities.forEach(entity => {
        const ep = perfData.filter(d => d.member_name === entity.member_name);
        const c = sum(ep, 'call_count');
        const p = sum(ep, 'pr_count');
        const a = sum(ep, 'appointment_count');
        const amt = sum(ep, 'appointment_amount');

        const ctp = c > 0 ? (p / c * 100).toFixed(1) : '-';
        const pta = p > 0 ? (a / p * 100).toFixed(1) : '-';
        const cta = c > 0 ? (a / c * 100).toFixed(2) : '-';

        // 単価 × 架電toアポ率
        const avgUnit = a > 0 ? amt / a : 0;
        const profitIndex = c > 0 ? (avgUnit * a / c).toFixed(0) : '-';
        const alertFlag = typeof profitIndex === 'string' ? false : parseFloat(profitIndex) < 7;

        yieldRows += `
            <tr${alertFlag ? ' style="background:var(--red-50);"' : ''}>
                <td>${displayName(entity.member_name)}</td>
                <td class="text-right number">${c.toLocaleString()}</td>
                <td class="text-right number">${p.toLocaleString()}</td>
                <td class="text-right number">${a}</td>
                <td class="text-right number">${ctp}%</td>
                <td class="text-right number">${pta}%</td>
                <td class="text-right number">${cta}%</td>
                <td class="text-right number">${profitIndex}${alertFlag ? ' <span style="color:var(--primary-red);font-weight:700;">&#9873;</span>' : ''}</td>
            </tr>
        `;
    });

    // 合計行
    yieldRows += `
        <tr style="font-weight:700;background:var(--gray-100);">
            <td>合計</td>
            <td class="text-right number">${totalCalls.toLocaleString()}</td>
            <td class="text-right number">${totalPR.toLocaleString()}</td>
            <td class="text-right number">${totalAppo}</td>
            <td class="text-right number">${callToPR.toFixed(1)}%</td>
            <td class="text-right number">${prToAppo.toFixed(1)}%</td>
            <td class="text-right number">${callToAppo.toFixed(2)}%</td>
            <td class="text-right number">-</td>
        </tr>
    `;
    document.getElementById('yieldTableBody').innerHTML = yieldRows;

    // 診断パネル
    renderDiagnosis(perfData, totalCalls, totalPR, totalAppo);

    // 案件別歩留まり
    renderProjectYield(perfData);
}

function renderDiagnosis(perfData, totalCalls, totalPR, totalAppo) {
    const diagCards = [];
    const ym = document.getElementById('filterMonth').value;
    const { elapsed } = getBusinessDays(ym);

    const totalHours = sum(perfData, 'call_hours');
    const callsPerHour = totalHours > 0 ? totalCalls / totalHours : 0;

    // Data or Die ベースライン指標
    const BASELINE = {
        callToPR: 0.15,    // A: 架電to着電率 15%
        prToAppo: 0.30,    // B: 着電toアポ率 30%
        callToAppo: 0.03,  // C: 架電toアポ率 3% (A×B≒4.5%だが実績ベース3%)
        callsPerHour: 40   // オペレーション基準 40件/h
    };

    const actualCallToPR = totalCalls > 0 ? totalPR / totalCalls : 0;
    const actualPrToAppo = totalPR > 0 ? totalAppo / totalPR : 0;
    const actualCallToAppo = totalCalls > 0 ? totalAppo / totalCalls : 0;

    // 比率ベースの乖離度（actual/baseline - 1）: マイナスが大きいほど改善余地大
    const gaps = [];
    if (totalCalls > 0) {
        gaps.push({
            key: 'callToPR',
            label: '架電to着電率（リスト品質）',
            actual: actualCallToPR,
            baseline: BASELINE.callToPR,
            ratio: actualCallToPR / BASELINE.callToPR - 1,
            suggestion: 'リストの精度向上、業種・時間帯の見直し、受付突破トークの改善を検討してください。'
        });
    }
    if (totalPR > 0) {
        gaps.push({
            key: 'prToAppo',
            label: '着電toアポ率（トーク品質）',
            actual: actualPrToAppo,
            baseline: BASELINE.prToAppo,
            ratio: actualPrToAppo / BASELINE.prToAppo - 1,
            suggestion: 'トークスクリプトの改善、ロープレ、ヒアリング精度の向上を検討してください。'
        });
    }
    if (totalCalls > 0) {
        gaps.push({
            key: 'callToAppo',
            label: '架電toアポ率（総合効率）',
            actual: actualCallToAppo,
            baseline: BASELINE.callToAppo,
            ratio: actualCallToAppo / BASELINE.callToAppo - 1,
            suggestion: 'リスト品質とトーク品質の両面から改善を検討してください。'
        });
    }

    // オペレーション診断
    if (totalHours > 0) {
        const opsRatio = callsPerHour / BASELINE.callsPerHour - 1;
        diagCards.push({
            alert: opsRatio < -0.1,
            title: 'オペレーション',
            text: `時間あたり架電数 ${callsPerHour.toFixed(1)}件/h（基準: ${BASELINE.callsPerHour}件/h、乖離: ${opsRatio >= 0 ? '+' : ''}${(opsRatio * 100).toFixed(0)}%）` +
                (opsRatio < -0.1 ? '。架電オペレーションの効率化やリスト準備の改善を検討してください。' : '。良好な水準です。')
        });
    } else {
        diagCards.push({ alert: false, title: 'オペレーション', text: '稼働時間データなし' });
    }

    // 乖離度の大きい順にソート（最も改善余地の大きい指標を特定）
    gaps.sort((a, b) => a.ratio - b.ratio);

    // 各指標の診断カード
    gaps.forEach((g, i) => {
        const pct = (g.actual * 100).toFixed(1);
        const basePct = (g.baseline * 100).toFixed(1);
        const gapPct = (g.ratio * 100).toFixed(0);
        const isWorst = i === 0 && g.ratio < -0.1;

        let text = `実績 ${pct}%（基準: ${basePct}%、乖離: ${g.ratio >= 0 ? '+' : ''}${gapPct}%）`;
        if (isWorst) {
            text += `。最も改善インパクトが大きい指標です。${g.suggestion}`;
        } else if (g.ratio < -0.1) {
            text += `。${g.suggestion}`;
        } else {
            text += '。基準値を満たしています。';
        }

        diagCards.push({
            alert: g.ratio < -0.1,
            priority: isWorst,
            title: g.label + (isWorst ? ' [最優先]' : ''),
            text
        });
    });

    document.getElementById('diagnosisGrid').innerHTML = diagCards.map(d => `
        <div class="diagnosis-card ${d.alert ? 'alert' : 'ok'}${d.priority ? ' priority' : ''}">
            <div class="diagnosis-title">${d.title}</div>
            <div class="diagnosis-text">${d.text}</div>
        </div>
    `).join('');
}

function renderProjectYield(perfData) {
    // 案件ごとに集計
    const projectMap = {};
    perfData.forEach(d => {
        if (!projectMap[d.project_name]) {
            projectMap[d.project_name] = { calls: 0, pr: 0, appo: 0, amount: 0 };
        }
        projectMap[d.project_name].calls += d.call_count || 0;
        projectMap[d.project_name].pr += d.pr_count || 0;
        projectMap[d.project_name].appo += d.appointment_count || 0;
        projectMap[d.project_name].amount += d.appointment_amount || 0;
    });

    let rows = '';
    Object.keys(projectMap).sort().forEach(name => {
        const p = projectMap[name];
        const ctp = p.calls > 0 ? (p.pr / p.calls * 100).toFixed(1) : '-';
        const pta = p.pr > 0 ? (p.appo / p.pr * 100).toFixed(1) : '-';
        const cta = p.calls > 0 ? (p.appo / p.calls * 100).toFixed(2) : '-';

        const proj = projectsData.find(pr => pr.project_name === name);
        const unitPrice = proj ? proj.unit_price : (p.appo > 0 ? Math.round(p.amount / p.appo) : 0);
        const profitCheck = p.calls > 0 ? unitPrice * p.appo / p.calls : 0;
        const alertFlag = p.calls > 0 && profitCheck < 7;

        rows += `
            <tr${alertFlag ? ' style="background:var(--red-50);"' : ''}>
                <td>${name}</td>
                <td class="text-right number">${p.calls.toLocaleString()}</td>
                <td class="text-right number">${p.pr.toLocaleString()}</td>
                <td class="text-right number">${p.appo}</td>
                <td class="text-right number">${ctp}%</td>
                <td class="text-right number">${pta}%</td>
                <td class="text-right number">${cta}%</td>
                <td>${alertFlag ? '<span style="color:var(--primary-red);font-weight:700;">&#9873; 収益性アラート</span>' : '<span style="color:var(--success);">OK</span>'}</td>
            </tr>
        `;
    });

    document.getElementById('projectYieldTableBody').innerHTML = rows;
}

// ==================== Tab 4: 案件管理 ====================
function renderProjects() {
    // 案件カード
    let html = '';
    projectsData.forEach(p => {
        html += `
            <div class="project-card">
                <div class="project-card-header">
                    <div>
                        <div class="project-name">${p.project_name}</div>
                        <div class="project-client">${p.client_name || '-'}</div>
                    </div>
                    <span class="kpi-badge good">${p.status}</span>
                </div>
                <div class="project-meta">
                    <div class="project-meta-item">
                        <div class="project-meta-label">アポ単価</div>
                        <div class="project-meta-value">¥${(p.unit_price || 0).toLocaleString()}</div>
                    </div>
                    <div class="project-meta-item">
                        <div class="project-meta-label">月次キャップ</div>
                        <div class="project-meta-value">${p.monthly_cap_count ? p.monthly_cap_count + '件' : '-'}</div>
                    </div>
                </div>
                ${p.call_list_url ? `<div style="margin-top:12px;"><a href="${escapeHtml(p.call_list_url)}" target="_blank" style="color:var(--text-muted);font-size:0.8rem;">架電リスト →</a></div>` : ''}
            </div>
        `;
    });
    document.getElementById('projectGrid').innerHTML = html || '<p style="color:var(--text-light);padding:20px;">案件が登録されていません。</p>';

    // キャップテーブル
    renderCapTable();
    // アサイン管理テーブル
    renderAssignments();
}

async function renderCapTable() {
    const ym = document.getElementById('filterMonth').value;
    try {
        const caps = await queryTurso("SELECT * FROM project_monthly_caps WHERE year_month = ?", [ym]);
        let rows = '';
        caps.forEach(c => {
            const countRate = c.cap_count > 0 ? (c.actual_count / c.cap_count * 100).toFixed(0) : '-';
            const amountRate = c.cap_amount > 0 ? (c.actual_amount / c.cap_amount * 100).toFixed(0) : '-';
            const barWidth = c.cap_count > 0 ? Math.min(c.actual_count / c.cap_count * 100, 100) : 0;

            rows += `
                <tr>
                    <td>${c.project_name}</td>
                    <td class="text-right number">${c.cap_count || '-'}</td>
                    <td class="text-right number">${c.actual_count}</td>
                    <td class="text-right number">${countRate}%</td>
                    <td class="text-right number">¥${(c.cap_amount || 0).toLocaleString()}</td>
                    <td class="text-right number">¥${(c.actual_amount || 0).toLocaleString()}</td>
                    <td>
                        <div class="progress-bar" style="width:100px;">
                            <div class="progress-bar-fill" style="width:${barWidth}%;background:var(--success);"></div>
                        </div>
                    </td>
                </tr>
            `;
        });
        document.getElementById('capTableBody').innerHTML = rows || '<tr><td colspan="7" style="text-align:center;color:var(--text-light);">データなし</td></tr>';
    } catch (e) {
        console.error('Cap table error:', e);
    }
}

// ==================== アサイン管理 ====================
function renderAssignments() {
    const filter = getFilters();
    let filtered = assignmentsData.slice();

    if (filter.team !== 'all') {
        const teamMembers = membersData.filter(m => m.team_name === filter.team).map(m => m.member_name);
        filtered = filtered.filter(a => teamMembers.includes(a.member_name));
    }
    if (filter.member !== 'all') {
        filtered = filtered.filter(a => a.member_name === filter.member);
    }

    // 実績を紐づけ
    filtered.forEach(a => {
        const perfRows = performanceData.filter(p =>
            p.member_name === a.member_name && p.project_name === a.project_name
        );
        a._calls = sum(perfRows, 'call_count');
        a._pr = sum(perfRows, 'pr_count');
        a._appo = sum(perfRows, 'appointment_count');
        a._amount = sum(perfRows, 'appointment_amount');

        a._callToPR = a._calls > 0 ? (a._pr / a._calls * 100).toFixed(1) : '-';
        a._prToAppo = a._pr > 0 ? (a._appo / a._pr * 100).toFixed(1) : '-';
        a._callToAppo = a._calls > 0 ? (a._appo / a._calls * 100).toFixed(1) : '-';

        // アポステータス集計
        const appoRows = appointmentsData.filter(ap =>
            ap.member_name === a.member_name && ap.project_name === a.project_name
        );
        a._confirmedAmount = appoRows.filter(ap => ap.status === '実施').reduce((s, ap) => s + (ap.amount || 0), 0);
        a._pendingAmount = appoRows.filter(ap => ap.status === '未確認').reduce((s, ap) => s + (ap.amount || 0), 0);
        a._cancelCount = appoRows.filter(ap => ap.status === 'キャンセル').length;
        a._totalAppoCount = appoRows.length;
        a._approvalRate = a._totalAppoCount > 0 ? ((a._totalAppoCount - a._cancelCount) / a._totalAppoCount * 100).toFixed(0) : '-';

        // 進捗
        a._progress = a.cap_amount > 0 ? Math.round(a._amount / a.cap_amount * 100) : 0;

        // アラート: 単価×架電toアポ率 < 7
        const proj = projectsData.find(p => p.project_name === a.project_name);
        const unitPrice = proj ? (proj.unit_price || 0) : 0;
        const cta = a._calls > 0 ? (a._appo / a._calls) : 0;
        a._alertScore = unitPrice * cta;
        a._hasAlert = a._calls >= 100 && a._alertScore < 7;
    });

    const rankColors = { 'A': '#ef947a', 'B': '#ede07d', 'C': '#86aaec', 'D': '#b1b4ba', '立ち上げ': '#a1d7ea' };

    let rows = '';
    filtered.forEach(a => {
        const rankColor = rankColors[a.rank] || '#b1b4ba';
        const progressColor = a._progress >= 100 ? 'var(--success)' : a._progress >= 70 ? '#ede07d' : '#ef947a';
        const progressWidth = Math.min(a._progress, 100);

        rows += `
            <tr>
                <td><span class="rank-badge" style="background:${rankColor};">${a.rank || '-'}</span></td>
                <td>${a.project_name}</td>
                <td><span class="type-badge ${a.project_type === '成果報酬' ? 'seika' : 'kadou'}">${a.project_type || '-'}</span></td>
                <td>${a.pm_name || '-'}</td>
                <td>${displayName(a.member_name)}</td>
                <td class="text-right number">${a.cap_count || '-'}</td>
                <td class="text-right number">${a.cap_amount ? '¥' + a.cap_amount.toLocaleString() : '-'}</td>
                <td class="text-right number">${a.target_count || '-'}</td>
                <td class="text-right number">${a._calls}</td>
                <td class="text-right number">${a._pr}</td>
                <td class="text-right number">${a._appo}</td>
                <td class="text-right number">${a._callToPR}%</td>
                <td class="text-right number">${a._prToAppo}%</td>
                <td class="text-right number">${a._callToAppo}%</td>
                <td class="text-right number">¥${a._confirmedAmount.toLocaleString()}</td>
                <td class="text-right number">¥${a._pendingAmount.toLocaleString()}</td>
                <td class="text-right number">${a._approvalRate}%</td>
                <td>
                    <div class="progress-bar" style="width:80px;">
                        <div class="progress-bar-fill" style="width:${progressWidth}%;background:${progressColor};"></div>
                    </div>
                    <span class="number" style="font-size:0.75rem;">${a._progress}%</span>
                </td>
                <td>${a._hasAlert ? '<span class="alert-flag">⚠</span>' : ''}</td>
                <td>
                    ${a.sheet_url ? `<a href="${escapeHtml(a.sheet_url)}" target="_blank" class="link-btn" title="シート">📋</a>` : ''}
                </td>
                <td>
                    <button class="icon-btn" onclick="openAssignmentForm('${a.id}')" title="編集">✏️</button>
                    <button class="icon-btn" onclick="deleteAssignment('${a.id}')" title="削除">🗑</button>
                </td>
            </tr>
        `;
    });

    document.getElementById('assignmentTableBody').innerHTML = rows || '<tr><td colspan="21" style="text-align:center;color:var(--text-light);padding:20px;">アサインが登録されていません。「+ 新規アサイン」から追加してください。</td></tr>';
    document.getElementById('assignmentCount').textContent = `${filtered.length}件`;
}

function openAssignmentForm(editId) {
    editingAssignmentId = editId || null;
    const modal = document.getElementById('assignmentFormModal');
    modal.classList.remove('hidden');

    // メンバー・案件ドロップダウン設定
    const memberSelect = document.getElementById('asgFormMember');
    memberSelect.innerHTML = membersData.map(m =>
        `<option value="${m.member_name}">${displayName(m.member_name)}（${m.team_name}）</option>`
    ).join('');

    const projectSelect = document.getElementById('asgFormProject');
    projectSelect.innerHTML = projectsData.map(p =>
        `<option value="${p.project_name}">${p.project_name}</option>`
    ).join('');

    if (editId) {
        const a = assignmentsData.find(x => x.id === editId);
        if (a) {
            document.getElementById('assignmentFormTitle').textContent = 'アサイン編集';
            memberSelect.value = a.member_name;
            projectSelect.value = a.project_name;
            document.getElementById('asgFormRank').value = a.rank || 'C';
            document.getElementById('asgFormType').value = a.project_type || '成果報酬';
            document.getElementById('asgFormPM').value = a.pm_name || '';
            document.getElementById('asgFormCapCount').value = a.cap_count || '';
            document.getElementById('asgFormCapAmount').value = a.cap_amount || '';
            document.getElementById('asgFormTargetCount').value = a.target_count || '';
            document.getElementById('asgFormSheetUrl').value = a.sheet_url || '';
        }
    } else {
        document.getElementById('assignmentFormTitle').textContent = '新規アサイン追加';
        document.getElementById('asgFormRank').value = 'C';
        document.getElementById('asgFormType').value = '成果報酬';
        document.getElementById('asgFormPM').value = '';
        document.getElementById('asgFormCapCount').value = '';
        document.getElementById('asgFormCapAmount').value = '';
        document.getElementById('asgFormTargetCount').value = '';
        document.getElementById('asgFormSheetUrl').value = '';
    }
}

function closeAssignmentForm() {
    document.getElementById('assignmentFormModal').classList.add('hidden');
    editingAssignmentId = null;
}

async function submitAssignmentForm() {
    const memberName = document.getElementById('asgFormMember').value;
    const projectName = document.getElementById('asgFormProject').value;
    const ym = document.getElementById('filterMonth').value;
    const rank = document.getElementById('asgFormRank').value;
    const projectType = document.getElementById('asgFormType').value;
    const pmName = document.getElementById('asgFormPM').value || null;
    const capCount = parseInt(document.getElementById('asgFormCapCount').value) || 0;
    const capAmount = parseInt(document.getElementById('asgFormCapAmount').value) || 0;
    const targetCount = parseInt(document.getElementById('asgFormTargetCount').value) || 0;
    const sheetUrl = document.getElementById('asgFormSheetUrl').value || null;

    if (!memberName || !projectName) return;

    try {
        await executeTurso(
            `INSERT INTO project_member_assignments
             (id, member_name, project_name, year_month, rank, project_type, pm_name, cap_count, cap_amount, target_count, sheet_url)
             VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(member_name, project_name, year_month)
             DO UPDATE SET rank=excluded.rank, project_type=excluded.project_type, pm_name=excluded.pm_name,
               cap_count=excluded.cap_count, cap_amount=excluded.cap_amount, target_count=excluded.target_count,
               sheet_url=excluded.sheet_url, updated_at=datetime('now')`,
            [memberName, projectName, ym, rank, projectType, pmName, capCount, capAmount, targetCount, sheetUrl]
        );

        closeAssignmentForm();
        assignmentsData = await queryTurso(
            "SELECT * FROM project_member_assignments WHERE year_month = ? ORDER BY rank, project_name, member_name",
            [ym]
        );
        renderAssignments();
    } catch (error) {
        alert('アサインの保存に失敗しました: ' + error.message);
    }
}

async function deleteAssignment(id) {
    if (!confirm('このアサインを削除しますか？')) return;
    try {
        const ym = document.getElementById('filterMonth').value;
        await executeTurso("DELETE FROM project_member_assignments WHERE id = ?", [id]);
        assignmentsData = await queryTurso(
            "SELECT * FROM project_member_assignments WHERE year_month = ? ORDER BY rank, project_name, member_name",
            [ym]
        );
        renderAssignments();
    } catch (error) {
        alert('削除に失敗しました: ' + error.message);
    }
}

async function copyAssignmentsToNextMonth() {
    const ym = document.getElementById('filterMonth').value;
    const [y, m] = ym.split('-').map(Number);
    const nextYm = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;

    if (!confirm(`${ym}のアサイン（${assignmentsData.length}件）を${nextYm}にコピーしますか？\n既存のアサインは上書きされません。`)) return;

    try {
        for (const a of assignmentsData) {
            await executeTurso(
                `INSERT OR IGNORE INTO project_member_assignments
                 (id, member_name, project_name, year_month, rank, project_type, pm_name, cap_count, cap_amount, target_count, sheet_url)
                 VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [a.member_name, a.project_name, nextYm, a.rank, a.project_type, a.pm_name, a.cap_count, a.cap_amount, a.target_count, a.sheet_url]
            );
        }
        alert(`${nextYm}にコピーしました。月フィルターを切り替えて確認してください。`);
    } catch (error) {
        alert('コピーに失敗しました: ' + error.message);
    }
}

// ==================== Tab 5: 詳細分析 ====================
function renderAnalysis(perfData, filter) {
    if (currentAnalysisView === 'daily') {
        renderDailyAnalysis(perfData, filter);
    } else if (currentAnalysisView === 'weekly') {
        renderWeeklyAnalysis(perfData, filter);
    } else {
        renderMonthlyAnalysis(filter);
    }
    renderAnalysisChart(perfData, filter);
}

function renderDailyAnalysis(perfData, filter) {
    document.getElementById('analysisTableTitle').textContent = '日次実績';

    // 日付ごとに集計
    const dateMap = {};
    perfData.forEach(d => {
        if (!dateMap[d.input_date]) {
            dateMap[d.input_date] = { calls: 0, pr: 0, appo: 0, amount: 0, hours: 0 };
        }
        dateMap[d.input_date].calls += d.call_count || 0;
        dateMap[d.input_date].pr += d.pr_count || 0;
        dateMap[d.input_date].appo += d.appointment_count || 0;
        dateMap[d.input_date].amount += d.appointment_amount || 0;
        dateMap[d.input_date].hours += d.call_hours || 0;
    });

    const dates = Object.keys(dateMap).sort();

    document.getElementById('analysisTableHead').innerHTML = `
        <tr>
            <th>日付</th>
            <th class="text-right">架電数</th>
            <th class="text-right">PR数</th>
            <th class="text-right">アポ数</th>
            <th class="text-right">金額</th>
            <th class="text-right">稼働時間</th>
            <th class="text-right">架電toPR</th>
            <th class="text-right">PRtoアポ</th>
        </tr>
    `;

    let rows = '';
    dates.forEach(date => {
        const d = dateMap[date];
        const ctp = d.calls > 0 ? (d.pr / d.calls * 100).toFixed(1) : '-';
        const pta = d.pr > 0 ? (d.appo / d.pr * 100).toFixed(1) : '-';

        rows += `
            <tr>
                <td>${date}</td>
                <td class="text-right number">${d.calls}</td>
                <td class="text-right number">${d.pr}</td>
                <td class="text-right number">${d.appo}</td>
                <td class="text-right number">¥${d.amount.toLocaleString()}</td>
                <td class="text-right number">${d.hours.toFixed(1)}h</td>
                <td class="text-right number">${ctp}%</td>
                <td class="text-right number">${pta}%</td>
            </tr>
        `;
    });

    document.getElementById('analysisTableBody').innerHTML = rows;
}

function renderWeeklyAnalysis(perfData, filter) {
    document.getElementById('analysisTableTitle').textContent = '週次実績';

    // 週ごとに集計
    const weekMap = {};
    perfData.forEach(d => {
        const weekKey = getWeekKey(d.input_date);
        if (!weekMap[weekKey]) {
            weekMap[weekKey] = { calls: 0, pr: 0, appo: 0, amount: 0, hours: 0 };
        }
        weekMap[weekKey].calls += d.call_count || 0;
        weekMap[weekKey].pr += d.pr_count || 0;
        weekMap[weekKey].appo += d.appointment_count || 0;
        weekMap[weekKey].amount += d.appointment_amount || 0;
        weekMap[weekKey].hours += d.call_hours || 0;
    });

    const weeks = Object.keys(weekMap).sort();

    document.getElementById('analysisTableHead').innerHTML = `
        <tr>
            <th>週</th>
            <th class="text-right">架電数</th>
            <th class="text-right">PR数</th>
            <th class="text-right">アポ数</th>
            <th class="text-right">金額</th>
            <th class="text-right">稼働時間</th>
        </tr>
    `;

    let rows = '';
    weeks.forEach(week => {
        const d = weekMap[week];
        rows += `
            <tr>
                <td>${week}</td>
                <td class="text-right number">${d.calls}</td>
                <td class="text-right number">${d.pr}</td>
                <td class="text-right number">${d.appo}</td>
                <td class="text-right number">¥${d.amount.toLocaleString()}</td>
                <td class="text-right number">${d.hours.toFixed(1)}h</td>
            </tr>
        `;
    });

    document.getElementById('analysisTableBody').innerHTML = rows;
}

async function renderMonthlyAnalysis(filter) {
    document.getElementById('analysisTableTitle').textContent = '月次実績';

    try {
        const data = await queryTurso(`
            SELECT substr(input_date, 1, 7) as month,
                   SUM(call_count) as calls, SUM(pr_count) as pr,
                   SUM(appointment_count) as appo, SUM(appointment_amount) as amount,
                   SUM(call_hours) as hours
            FROM performance_rawdata
            GROUP BY month ORDER BY month DESC LIMIT 12
        `);

        document.getElementById('analysisTableHead').innerHTML = `
            <tr>
                <th>月</th>
                <th class="text-right">架電数</th>
                <th class="text-right">PR数</th>
                <th class="text-right">アポ数</th>
                <th class="text-right">金額</th>
                <th class="text-right">稼働時間</th>
            </tr>
        `;

        let rows = '';
        data.forEach(d => {
            rows += `
                <tr>
                    <td>${d.month}</td>
                    <td class="text-right number">${(d.calls || 0).toLocaleString()}</td>
                    <td class="text-right number">${(d.pr || 0).toLocaleString()}</td>
                    <td class="text-right number">${d.appo || 0}</td>
                    <td class="text-right number">¥${(d.amount || 0).toLocaleString()}</td>
                    <td class="text-right number">${(d.hours || 0).toFixed(1)}h</td>
                </tr>
            `;
        });

        document.getElementById('analysisTableBody').innerHTML = rows;
    } catch (e) {
        console.error('Monthly analysis error:', e);
    }
}

function renderAnalysisChart(perfData, filter) {
    // 日付ごとに集計
    const dateMap = {};
    perfData.forEach(d => {
        if (!dateMap[d.input_date]) {
            dateMap[d.input_date] = { calls: 0, pr: 0, appo: 0, amount: 0 };
        }
        dateMap[d.input_date].calls += d.call_count || 0;
        dateMap[d.input_date].pr += d.pr_count || 0;
        dateMap[d.input_date].appo += d.appointment_count || 0;
        dateMap[d.input_date].amount += d.appointment_amount || 0;
    });

    const dates = Object.keys(dateMap).sort();
    const labels = dates.map(d => d.substring(5)); // MM-DD

    let dataValues, label, color;
    switch (currentAnalysisChart) {
        case 'pr':
            dataValues = dates.map(d => dateMap[d].pr);
            label = 'PR数';
            color = '#00a2da';
            break;
        case 'appo':
            dataValues = dates.map(d => dateMap[d].appo);
            label = 'アポ数';
            color = '#e8d335';
            break;
        case 'amount':
            dataValues = dates.map(d => dateMap[d].amount);
            label = '金額';
            color = '#86aaec';
            break;
        default:
            dataValues = dates.map(d => dateMap[d].calls);
            label = '架電数';
            color = '#1155cc';
    }

    if (charts.analysis) charts.analysis.destroy();

    const ctx = document.getElementById('analysisChart').getContext('2d');
    charts.analysis = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: dataValues,
                backgroundColor: color + '80',
                borderColor: color,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#e4e8ef' } },
                x: { grid: { display: false } }
            }
        }
    });
}

function switchAnalysisView(view) {
    currentAnalysisView = view;
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });
    const filter = getFilters();
    renderAnalysis(filterPerformance(performanceData, filter), filter);
}

function switchAnalysisChart(type) {
    currentAnalysisChart = type;
    document.querySelectorAll('#analysisChartSelector .chart-type-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.chart === type);
    });
    const filter = getFilters();
    renderAnalysisChart(filterPerformance(performanceData, filter), filter);
}

// ==================== Tab 6: 設定 ====================
function renderSettings() {
    // 月次目標設定
    const ym = document.getElementById('filterMonth').value;
    let targetHtml = '';

    // 全体目標
    const totalTarget = getTarget('total', 'all', ym);
    targetHtml += `
        <div class="settings-item">
            <label>全体 売上目標</label>
            <input type="number" id="target_total_all" value="${totalTarget ? totalTarget.appointment_amount_target : settingsMap.monthly_target_total || 9000000}" min="0">
        </div>
    `;

    // チーム目標
    ['野口Team', '松居Team', '坪井Team'].forEach(team => {
        const t = getTarget('team', team, ym);
        targetHtml += `
            <div class="settings-item">
                <label>${team} 売上目標</label>
                <input type="number" id="target_team_${team}" value="${t ? t.appointment_amount_target : 0}" min="0">
            </div>
        `;
    });

    // メンバー目標
    membersData.forEach(m => {
        const t = getTarget('member', m.member_name, ym);
        targetHtml += `
            <div class="settings-item">
                <label>${displayName(m.member_name)} 売上目標</label>
                <input type="number" id="target_member_${m.member_name}" value="${t ? t.appointment_amount_target : 0}" min="0">
            </div>
        `;
    });

    document.getElementById('targetSettingsGrid').innerHTML = targetHtml;

    // レート設定
    document.getElementById('settingCancelRate').value = settingsMap.cancel_rate_default || '0.8';
    document.getElementById('settingFlowRate').value = settingsMap.next_month_flow_rate || '0.5';
    document.getElementById('settingMonthlyTarget').value = settingsMap.monthly_target_total || '9000000';

    // メンバー管理テーブル
    let memberRows = '';
    membersData.forEach(m => {
        memberRows += `
            <tr>
                <td>${displayName(m.member_name)}</td>
                <td>${m.team_name}</td>
                <td><span class="status-badge status-executed">${m.status}</span></td>
                <td>
                    <button class="status-btn" onclick="toggleMemberStatus('${m.id}','${m.status === 'active' ? 'inactive' : 'active'}')">
                        ${m.status === 'active' ? '無効化' : '有効化'}
                    </button>
                </td>
            </tr>
        `;
    });
    document.getElementById('memberManageBody').innerHTML = memberRows;
}

async function saveTargets() {
    const ym = document.getElementById('filterMonth').value;
    const msg = document.getElementById('targetMessage');

    try {
        // 全体目標
        const totalVal = parseInt(document.getElementById('target_total_all').value) || 0;
        await upsertTarget('total', 'all', ym, totalVal);

        // チーム目標
        for (const team of ['野口Team', '松居Team', '坪井Team']) {
            const val = parseInt(document.getElementById(`target_team_${team}`).value) || 0;
            await upsertTarget('team', team, ym, val);
        }

        // メンバー目標
        for (const m of membersData) {
            const val = parseInt(document.getElementById(`target_member_${m.member_name}`).value) || 0;
            await upsertTarget('member', m.member_name, ym, val);
        }

        // 目標再読み込み
        targetsData = await queryTurso("SELECT * FROM targets WHERE year_month = ?", [ym]);

        msg.className = 'settings-message success';
        msg.textContent = '目標を保存しました。';
        msg.style.display = 'block';
        setTimeout(() => { msg.style.display = 'none'; }, 3000);

        renderAll();
    } catch (error) {
        msg.className = 'settings-message error';
        msg.textContent = '保存に失敗しました: ' + error.message;
        msg.style.display = 'block';
    }
}

async function upsertTarget(type, name, ym, amount) {
    await executeTurso(
        `INSERT INTO targets (id, target_type, target_name, year_month, appointment_amount_target)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)
         ON CONFLICT(target_type, target_name, year_month)
         DO UPDATE SET appointment_amount_target = excluded.appointment_amount_target`,
        [type, name, ym, amount]
    );
}

async function saveDailyTarget() {
    const member = document.getElementById('dailyTargetMember').value;
    const date = document.getElementById('dailyTargetDate').value;
    const msg = document.getElementById('dailyTargetMessage');

    if (!member || !date) {
        msg.className = 'settings-message error';
        msg.textContent = 'メンバーと日付を入力してください。';
        msg.style.display = 'block';
        return;
    }

    try {
        await executeTurso(
            `INSERT INTO daily_targets (id, member_name, target_date, call_count_target, pr_count_target, appointment_count_target, appointment_amount_target, memo)
             VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(member_name, target_date)
             DO UPDATE SET call_count_target = excluded.call_count_target,
                           pr_count_target = excluded.pr_count_target,
                           appointment_count_target = excluded.appointment_count_target,
                           appointment_amount_target = excluded.appointment_amount_target,
                           memo = excluded.memo`,
            [
                member, date,
                parseInt(document.getElementById('dailyTargetCalls').value) || 0,
                parseInt(document.getElementById('dailyTargetPR').value) || 0,
                parseInt(document.getElementById('dailyTargetAppo').value) || 0,
                parseInt(document.getElementById('dailyTargetAmount').value) || 0,
                document.getElementById('dailyTargetMemo').value || null
            ]
        );

        msg.className = 'settings-message success';
        msg.textContent = '日次目標を保存しました。';
        msg.style.display = 'block';
        setTimeout(() => { msg.style.display = 'none'; }, 3000);
    } catch (error) {
        msg.className = 'settings-message error';
        msg.textContent = '保存に失敗しました: ' + error.message;
        msg.style.display = 'block';
    }
}

async function saveRateSettings() {
    const msg = document.getElementById('rateMessage');
    try {
        const cancelRate = document.getElementById('settingCancelRate').value;
        const flowRate = document.getElementById('settingFlowRate').value;
        const monthlyTarget = document.getElementById('settingMonthlyTarget').value;

        await executeTurso("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('cancel_rate_default', ?, datetime('now'))", [cancelRate]);
        await executeTurso("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('next_month_flow_rate', ?, datetime('now'))", [flowRate]);
        await executeTurso("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('monthly_target_total', ?, datetime('now'))", [monthlyTarget]);

        settingsMap.cancel_rate_default = cancelRate;
        settingsMap.next_month_flow_rate = flowRate;
        settingsMap.monthly_target_total = monthlyTarget;

        msg.className = 'settings-message success';
        msg.textContent = 'レート設定を保存しました。';
        msg.style.display = 'block';
        setTimeout(() => { msg.style.display = 'none'; }, 3000);
    } catch (error) {
        msg.className = 'settings-message error';
        msg.textContent = '保存に失敗しました: ' + error.message;
        msg.style.display = 'block';
    }
}

// ==================== 案件フォーム ====================
function openProjectForm() {
    document.getElementById('projectFormModal').classList.remove('hidden');
    document.getElementById('projFormName').value = '';
    document.getElementById('projFormClient').value = '';
    document.getElementById('projFormUnitPrice').value = '';
    document.getElementById('projFormCapCount').value = '';
    document.getElementById('projFormCapAmount').value = '';
    document.getElementById('projFormListUrl').value = '';
}

function closeProjectForm() {
    document.getElementById('projectFormModal').classList.add('hidden');
}

async function submitProjectForm() {
    const name = document.getElementById('projFormName').value;
    if (!name) return;

    try {
        await executeTurso(
            `INSERT INTO projects (id, project_name, client_name, unit_price, monthly_cap_count, monthly_cap_amount, call_list_url)
             VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?)`,
            [
                name,
                document.getElementById('projFormClient').value || null,
                parseInt(document.getElementById('projFormUnitPrice').value) || 0,
                parseInt(document.getElementById('projFormCapCount').value) || null,
                parseInt(document.getElementById('projFormCapAmount').value) || null,
                document.getElementById('projFormListUrl').value || null
            ]
        );

        closeProjectForm();
        projectsData = await queryTurso("SELECT * FROM projects WHERE status = 'active' ORDER BY project_name");
        renderProjects();
    } catch (error) {
        alert('案件の追加に失敗しました: ' + error.message);
    }
}

// ==================== メンバーフォーム ====================
function openMemberForm() {
    document.getElementById('memberFormModal').classList.remove('hidden');
    document.getElementById('memberFormName').value = '';
}

function closeMemberForm() {
    document.getElementById('memberFormModal').classList.add('hidden');
}

async function submitMemberForm() {
    const name = document.getElementById('memberFormName').value;
    const team = document.getElementById('memberFormTeam').value;
    if (!name || !team) return;

    try {
        await executeTurso(
            "INSERT INTO members (id, member_name, team_name) VALUES (lower(hex(randomblob(16))), ?, ?)",
            [name, team]
        );

        closeMemberForm();
        membersData = await queryTurso("SELECT * FROM members WHERE status = 'active' ORDER BY team_name, member_name");
        populateMemberFilter();
        populateDailyTargetMember();
        renderSettings();
    } catch (error) {
        alert('メンバーの追加に失敗しました: ' + error.message);
    }
}

async function toggleMemberStatus(id, newStatus) {
    try {
        await executeTurso("UPDATE members SET status = ? WHERE id = ?", [newStatus, id]);
        membersData = await queryTurso("SELECT * FROM members WHERE status = 'active' ORDER BY team_name, member_name");
        populateMemberFilter();
        renderSettings();
    } catch (error) {
        alert('ステータス変更に失敗しました: ' + error.message);
    }
}

// ==================== アポ詳細モーダル ====================
function closeAppoDetail() {
    document.getElementById('appoDetailModal').classList.add('hidden');
}

// ==================== タブ切替 ====================
function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tab}`);
    });

    // 概要タブではフィルターを非表示、他タブでは表示
    const filters = document.getElementById('globalFilters');
    if (filters) {
        filters.style.display = tab === 'overview' ? 'none' : 'flex';
    }

    // タブ切替時にチーム・メンバーフィルターをリセット（タブ間の影響を防止）
    document.getElementById('filterTeam').value = 'all';
    document.getElementById('filterMember').value = 'all';
    populateMemberFilter();

    // 現タブのデータを再描画
    renderAll();

    localStorage.setItem('seikaActiveTab', tab);
}

// ==================== 外部共有モード ====================
function enterExternalMode(projectFilter) {
    document.getElementById('externalModeBar').style.display = 'block';
    document.getElementById('topHeader').style.display = 'none';
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('globalFilters').style.display = 'none';

    // アポ確認タブに切替
    switchTab('appointments');
}

function exitExternalMode() {
    document.getElementById('externalModeBar').style.display = 'none';
    document.getElementById('topHeader').style.display = 'flex';
    document.getElementById('sidebar').style.display = 'block';
    document.getElementById('globalFilters').style.display = 'flex';

    window.history.replaceState({}, '', window.location.pathname);
}

// ==================== ユーティリティ ====================
function showLoading() {
    document.getElementById('loadingOverlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}

function showError(msg) {
    const el = document.getElementById('errorMessage');
    el.textContent = msg;
    el.style.display = 'block';
}

function formatDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getEndOfMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return ym + '-' + String(lastDay).padStart(2, '0');
}

function sum(arr, key) {
    return arr.reduce((s, d) => s + (parseFloat(d[key]) || 0), 0);
}

function pct(value, target) {
    return target > 0 ? Math.round(value / target * 1000) / 10 : 0;
}

function getTarget(type, name, ym) {
    return targetsData.find(t => t.target_type === type && t.target_name === name && t.year_month === ym);
}

function getBusinessDays(ym) {
    const [y, m] = ym.split('-').map(Number);
    const today = new Date();
    const lastDay = new Date(y, m, 0).getDate();

    let total = 0;
    let elapsed = 0;

    for (let d = 1; d <= lastDay; d++) {
        const date = new Date(y, m - 1, d);
        const dateStr = formatDate(date);
        const dow = date.getDay();

        // 土日・祝日を除外
        if (dow === 0 || dow === 6 || holidaysSet.has(dateStr)) continue;

        total++;
        if (date <= today) elapsed++;
    }

    return { elapsed, total };
}

function getWeekKey(dateStr) {
    const d = new Date(dateStr);
    const dayOfWeek = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    return formatDate(monday) + '~';
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function displayName(memberName) {
    const member = membersData.find(m => m.member_name === memberName);
    return (member && member.display_name) ? member.display_name : memberName;
}
