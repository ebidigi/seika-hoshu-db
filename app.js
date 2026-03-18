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

// ==================== メンバー名正規化（フロントエンド防御） ====================
const MEMBER_NAME_NORMALIZE = {
    '野口純': '野口', '野口 純': '野口', '@野口純/noguchi jun': '野口',
    '坪井 秀斗': '坪井', '坪井秀斗': '坪井', '@坪井 秀斗/tsuboi shuto': '坪井',
    '松居和輝': '松居', '松居 和輝': '松居', '@松居和輝/matsui kazuki': '松居',
    '村松和哉': '村松', '村松 和哉': '村松', '@村松和哉/Kazuya Muramatsu': '村松',
    '辻森誠也': '辻森', '辻森 誠也': '辻森', '@辻森誠也/Tsujimori Seiya': '辻森',
    '山本匠太郎': '山本', '山本 匠太郎': '山本', '@山本 匠太郎': '山本',
    '美除直生': '美除', '美除 直生': '美除', '@美除直生': '美除',
    '中村 峻也': '中村た', '中村峻也': '中村た', '@中村 峻也/nakamura takaya': '中村た',
    '田中克樹': '田中か', '@田中克樹/katsuki tanaka': '田中か',
    '宮城 啓生': '宮城', '宮城啓生': '宮城', '@宮城 啓生/miyagi hiroki': '宮城', '宮城一平': '宮城', '@宮城一平': '宮城',
    '@田中颯汰/tanaka sota': '田中颯汰'
};

function normalizeMemberName(name) {
    if (!name) return name;
    if (MEMBER_NAME_NORMALIZE[name]) return MEMBER_NAME_NORMALIZE[name];
    // @名前/id 形式のフォールバック
    const m = name.match(/^@(.+?)\//);
    if (m) {
        const extracted = m[1].trim();
        if (MEMBER_NAME_NORMALIZE[extracted]) return MEMBER_NAME_NORMALIZE[extracted];
    } else if (name.startsWith('@')) {
        const stripped = name.substring(1).trim();
        if (MEMBER_NAME_NORMALIZE[stripped]) return MEMBER_NAME_NORMALIZE[stripped];
    }
    return name;
}

function normalizeDataMemberNames(dataArray) {
    dataArray.forEach(d => {
        if (d.member_name) d.member_name = normalizeMemberName(d.member_name);
    });
}

function deduplicateAppointments(appoArray) {
    const seen = new Map();
    for (const a of appoArray) {
        const key = `${a.member_name}|${a.project_name}|${a.acquisition_date}|${a.customer_name}`;
        // confirmation_date がある方を優先
        if (!seen.has(key) || (a.confirmation_date && !seen.get(key).confirmation_date)) {
            seen.set(key, a);
        }
    }
    return Array.from(seen.values());
}

function deduplicatePerformance(perfArray) {
    const seen = new Map();
    for (const d of perfArray) {
        const key = `${d.member_name}|${d.project_name}|${d.input_date}`;
        if (!seen.has(key)) {
            seen.set(key, d);
        }
        // 同じキーが複数ある場合、updated_atが新しい方を採用
        else if (d.updated_at > seen.get(key).updated_at) {
            seen.set(key, d);
        }
    }
    return Array.from(seen.values());
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

    // メンバー名正規化（DB側に非正規名が入っていても正しく集計）
    normalizeDataMemberNames(performanceData);
    normalizeDataMemberNames(appointmentsData);
    normalizeDataMemberNames(executionAppoData);
    normalizeDataMemberNames(assignmentsData);

    // 同一人物の重複アポを除去（member_name + project_name + acquisition_date + customer_name）
    appointmentsData = deduplicateAppointments(appointmentsData);
    executionAppoData = deduplicateAppointments(executionAppoData);

    // 実績の重複排除（正規化後に同一 member_name + project_name + input_date が複数存在する場合）
    performanceData = deduplicatePerformance(performanceData);

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

// ==================== 本日サマリー ====================
let todaySummaryOpen = true;

function toggleTodaySummary() {
    todaySummaryOpen = !todaySummaryOpen;
    const body = document.getElementById('todaySummaryBody');
    const icon = document.getElementById('todaySummaryToggleIcon');
    if (body) body.style.display = todaySummaryOpen ? 'block' : 'none';
    if (icon) icon.style.transform = todaySummaryOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
}

function renderTodaySummary(appoData) {
    const today = formatDate(new Date());
    const todayAppo = appoData.filter(a => a.acquisition_date === today);

    // 全体合計（データ有無問わず表示）
    const grandTotal = todayAppo.reduce((s, a) => s + (a.amount || 0), 0);

    if (todayAppo.length === 0) {
        document.getElementById('todaySummary').innerHTML = `
            <div class="today-summary-card">
                <div class="today-summary-header" onclick="toggleTodaySummary()" style="cursor:pointer;">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <svg id="todaySummaryToggleIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="transition:transform 0.2s;${todaySummaryOpen ? '' : 'transform:rotate(-90deg);'}"><path d="M6 9l6 6 6-6"/></svg>
                        <span>本日の実績</span>
                    </div>
                    <span class="today-summary-total">¥0</span>
                </div>
                <div id="todaySummaryBody" style="${todaySummaryOpen ? '' : 'display:none;'}">
                    <div style="color:var(--text-light);font-size:0.85rem;padding:12px 0;">本日のアポ取得データはまだありません</div>
                </div>
            </div>`;
        return;
    }

    // 案件名リスト＆色割り当て
    const projectNames = [...new Set(todayAppo.map(a => a.project_name).filter(Boolean))];
    const projectColors = [
        '#86aaec', '#ef947a', '#ede07d', '#7ecba1', '#c4a0e8',
        '#f5a8c4', '#8dd4cf', '#f0c078', '#a0b8d8', '#d4a5a5'
    ];
    const colorMap = {};
    projectNames.forEach((p, i) => { colorMap[p] = projectColors[i % projectColors.length]; });

    // メンバー別集計（案件別内訳: 金額＋件数）
    const memberMap = {};
    todayAppo.forEach(a => {
        const name = a.member_name || '不明';
        if (!memberMap[name]) memberMap[name] = { total: 0, count: 0, projects: {} };
        memberMap[name].total += (a.amount || 0);
        memberMap[name].count++;
        const pn = a.project_name || '不明';
        if (!memberMap[name].projects[pn]) memberMap[name].projects[pn] = { amount: 0, count: 0 };
        memberMap[name].projects[pn].amount += (a.amount || 0);
        memberMap[name].projects[pn].count++;
    });

    // ランキング順（金額降順）
    const memberRanking = Object.entries(memberMap)
        .sort((a, b) => b[1].total - a[1].total);
    const maxMemberAmount = memberRanking.length > 0 ? memberRanking[0][1].total : 1;

    // チーム別集計
    const teamMap = {};
    todayAppo.forEach(a => {
        const member = membersData.find(m => m.member_name === a.member_name);
        const team = member ? member.team_name : '不明';
        if (!teamMap[team]) teamMap[team] = { total: 0, count: 0, projects: {} };
        teamMap[team].total += (a.amount || 0);
        teamMap[team].count++;
        const pn = a.project_name || '不明';
        if (!teamMap[team].projects[pn]) teamMap[team].projects[pn] = { amount: 0, count: 0 };
        teamMap[team].projects[pn].amount += (a.amount || 0);
        teamMap[team].projects[pn].count++;
    });
    const teamRanking = Object.entries(teamMap).sort((a, b) => b[1].total - a[1].total);
    const maxTeamAmount = teamRanking.length > 0 ? teamRanking[0][1].total : 1;

    // 積み上げバー生成関数
    function stackedBar(projects, maxAmount) {
        let html = '<div class="today-stacked-bar">';
        for (const pn of projectNames) {
            const p = projects[pn];
            if (!p || p.amount <= 0) continue;
            const widthPct = (p.amount / maxAmount * 100).toFixed(1);
            const tooltip = `${pn}\n${p.count}件 / ¥${p.amount.toLocaleString()}`;
            html += `<div class="today-stacked-segment" data-tooltip="${tooltip.replace(/"/g, '&quot;')}" style="width:${widthPct}%;background:${colorMap[pn]};"></div>`;
        }
        html += '</div>';
        return html;
    }

    // HTML構築
    let html = `<div class="today-summary-card">
        <div class="today-summary-header" onclick="toggleTodaySummary()" style="cursor:pointer;">
            <div style="display:flex;align-items:center;gap:8px;">
                <svg id="todaySummaryToggleIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="transition:transform 0.2s;${todaySummaryOpen ? '' : 'transform:rotate(-90deg);'}"><path d="M6 9l6 6 6-6"/></svg>
                <span>本日の実績</span>
            </div>
            <span class="today-summary-total">¥${grandTotal.toLocaleString()}</span>
        </div>
        <div id="todaySummaryBody" style="${todaySummaryOpen ? '' : 'display:none;'}">
        <div class="today-legend">`;
    projectNames.forEach(pn => {
        html += `<span class="today-legend-item"><span class="today-legend-dot" style="background:${colorMap[pn]};"></span>${pn}</span>`;
    });
    html += `</div>`;

    // メンバーランキング
    html += `<div class="today-section-label">メンバー別</div>`;
    html += `<div class="today-ranking">`;
    memberRanking.forEach(([name, data], i) => {
        html += `<div class="today-rank-row">
            <span class="today-rank-num">${i + 1}</span>
            <span class="today-rank-name">${displayName(name)}</span>
            <div class="today-rank-bar-wrap">${stackedBar(data.projects, maxMemberAmount)}</div>
            <span class="today-rank-amount"><span class="today-rank-count">${data.count}件</span>¥${data.total.toLocaleString()}</span>
        </div>`;
    });
    html += `</div>`;

    // チーム別
    html += `<div class="today-section-label">チーム別</div>`;
    html += `<div class="today-ranking">`;
    teamRanking.forEach(([name, data]) => {
        html += `<div class="today-rank-row">
            <span class="today-rank-name" style="min-width:80px;">${name}</span>
            <div class="today-rank-bar-wrap">${stackedBar(data.projects, maxTeamAmount)}</div>
            <span class="today-rank-amount"><span class="today-rank-count">${data.count}件</span>¥${data.total.toLocaleString()}</span>
        </div>`;
    });
    html += `</div>`;

    html += `</div></div>`;
    document.getElementById('todaySummary').innerHTML = html;

    // カスタムツールチップ
    initTodayTooltips();
}

function initTodayTooltips() {
    let tip = document.getElementById('todayTooltip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'todayTooltip';
        tip.className = 'today-tooltip';
        document.body.appendChild(tip);
    }

    document.querySelectorAll('.today-stacked-segment').forEach(el => {
        el.addEventListener('mouseenter', e => {
            const text = el.getAttribute('data-tooltip');
            if (!text) return;
            tip.innerHTML = text.replace(/\n/g, '<br>');
            tip.style.display = 'block';
            const rect = el.getBoundingClientRect();
            tip.style.left = (rect.left + rect.width / 2) + 'px';
            tip.style.top = (rect.top - 8) + 'px';
        });
        el.addEventListener('mouseleave', () => {
            tip.style.display = 'none';
        });
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

    // 本日サマリー
    renderTodaySummary(appoData);

    // 取得目標 進捗バー
    const acqRate = monthlyTarget > 0 ? Math.round(acquisitionAmount / monthlyTarget * 1000) / 10 : 0;
    const acqBarWidth = Math.min(acqRate, 100);
    const acqBarColor = acqRate >= standardProgress ? '#86aaec' : acqRate >= standardProgress * 0.8 ? '#ede07d' : '#ef947a';

    // 実施確定 進捗バー（実施目標 vs 確定金額）
    const confirmedRate = executionTarget > 0 ? Math.round(execConfirmed / executionTarget * 1000) / 10 : 0;
    const confirmedBarWidth = Math.min(confirmedRate, 100);
    const confirmedBarColor = confirmedRate >= standardProgress ? '#86aaec' : confirmedRate >= standardProgress * 0.8 ? '#ede07d' : '#ef947a';

    document.getElementById('salesTargetCard').innerHTML = `
        <div class="sales-target-card" style="grid-template-columns:1fr;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
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
                    <div class="sales-target-label">実施確定（目標: ¥${executionTarget.toLocaleString()}）</div>
                    <div class="sales-target-amount" style="color:#90b8f8;">¥${execConfirmed.toLocaleString()}</div>
                    <div class="sales-target-bar-wrap" style="margin-top:8px;">
                        <div class="sales-target-bar-info">
                            <span>達成率 ${confirmedRate}%</span>
                            <span>残 ¥${Math.max(0, executionTarget - execConfirmed).toLocaleString()}</span>
                        </div>
                        <div class="sales-target-bar">
                            <div class="sales-target-bar-fill" style="width:${confirmedBarWidth}%;background:${confirmedBarColor};"></div>
                            <div class="sales-target-bar-line" style="left:${Math.min(standardProgress, 100)}%;"></div>
                        </div>
                    </div>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.15);">
                <span style="font-size:0.8rem;color:rgba(255,255,255,0.6);">実施見込</span>
                <span style="font-size:1rem;font-weight:600;">¥${execExpected.toLocaleString()}</span>
                <span style="font-size:0.75rem;color:rgba(255,255,255,0.5);">（未確認 ¥${execUnconfirmed.toLocaleString()} + 確定 ¥${execConfirmed.toLocaleString()}）</span>
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

    // 歩留まり＆キャンセル率
    const appoCount = appoData.length;
    const callToPR = totalCalls > 0 ? (totalPR / totalCalls * 100).toFixed(1) : '-';
    const prToAppo = totalPR > 0 ? (appoCount / totalPR * 100).toFixed(1) : '-';
    const execCount = execAppoData.length;
    const execConfirmedCount = execAppoData.filter(a => a.status === '実施').length;
    const execCancelledCount = execAppoData.filter(a => a.status === 'キャンセル').length;
    const execRescheduleCount = execAppoData.filter(a => a.status === 'リスケ').length;
    const executionRate = execCount > 0 ? (execConfirmedCount / execCount * 100).toFixed(1) : '-';
    const cancelRate = execCount > 0 ? (execCancelledCount / execCount * 100).toFixed(1) : '-';
    const rescheduleRate = execCount > 0 ? (execRescheduleCount / execCount * 100).toFixed(1) : '-';

    document.getElementById('conversionRates').innerHTML = `
        <div class="conversion-rates-row" style="margin-bottom:12px;">
            <div class="conversion-rate-card">
                <div class="conversion-rate-value">${totalCalls.toLocaleString()}</div>
                <div class="conversion-rate-label">架電数</div>
            </div>
            <div class="conversion-rate-card">
                <div class="conversion-rate-value">${totalPR.toLocaleString()}</div>
                <div class="conversion-rate-label">PR数</div>
            </div>
            <div class="conversion-rate-card">
                <div class="conversion-rate-value">${appoCount.toLocaleString()}</div>
                <div class="conversion-rate-label">アポ数</div>
            </div>
            <div class="conversion-rate-card">
                <div class="conversion-rate-value">${totalHours.toFixed(1)}h</div>
                <div class="conversion-rate-label">稼働時間</div>
            </div>
        </div>
        <div class="conversion-rates-row">
            <div class="conversion-rate-card">
                <div class="conversion-rate-value">${callToPR}%</div>
                <div class="conversion-rate-label">架電→PR率</div>
            </div>
            <div class="conversion-rate-card">
                <div class="conversion-rate-value">${prToAppo}%</div>
                <div class="conversion-rate-label">PR→アポ率</div>
            </div>
            <div class="conversion-rate-card">
                <div class="conversion-rate-value" style="color:${executionRate !== '-' && parseFloat(executionRate) < 80 ? 'var(--primary-red)' : 'var(--primary-blue)'};">${executionRate}%</div>
                <div class="conversion-rate-label">実施率（${execConfirmedCount}/${execCount}件）</div>
            </div>
            <div class="conversion-rate-card">
                <div class="conversion-rate-value" style="color:${cancelRate !== '-' && parseFloat(cancelRate) > 15 ? 'var(--primary-red)' : 'var(--text-dark)'};">${cancelRate}%</div>
                <div class="conversion-rate-label">キャンセル率（${execCancelledCount}件）</div>
            </div>
            <div class="conversion-rate-card">
                <div class="conversion-rate-value" style="color:${rescheduleRate !== '-' && parseFloat(rescheduleRate) > 15 ? '#8a7a00' : 'var(--text-dark)'};">${rescheduleRate}%</div>
                <div class="conversion-rate-label">リスケ率（${execRescheduleCount}件）</div>
            </div>
        </div>
    `;

    // チームカード
    renderTeamCards(perfData, appoData, execAppoData, standardProgress);

    // メンバー別売上カード
    renderMemberSalesCards(appoData, execAppoData, standardProgress);

    // メンバー別稼働グラフ
    renderMemberGraphs(perfData);
}

function renderTeamCards(perfData, appoData, execAppoData, standardProgress) {
    const ym = document.getElementById('filterMonth').value;

    const teamNames = ['野口Team', '坪井Team', '松居Team', '宮城Team'];
    let html = '<div class="team-grid">';

    teamNames.forEach(teamName => {
        const teamMembers = membersData.filter(m => m.team_name === teamName).map(m => m.member_name);
        const teamAppo = appoData.filter(d => teamMembers.includes(d.member_name));
        const teamExec = execAppoData.filter(d => teamMembers.includes(d.member_name));

        // 取得金額（当月取得アポ）
        const acqAmount = teamAppo.reduce((s, a) => s + (a.amount || 0), 0);

        // 実施見込（キャンセル・リスケ除く）
        const execForecast = teamExec.filter(a => a.status !== 'キャンセル' && a.status !== 'リスケ').reduce((s, a) => s + (a.amount || 0), 0);
        // 実施確定（ステータス=実施のみ）
        const execConfirmed = teamExec.filter(a => a.status === '実施').reduce((s, a) => s + (a.amount || 0), 0);

        const teamTarget = getTarget('team', teamName, ym);
        const target = teamTarget ? teamTarget.appointment_amount_target : 0;
        const execTarget = teamTarget ? (teamTarget.execution_target || target) : 0;
        const acqRate = target > 0 ? Math.round(acqAmount / target * 1000) / 10 : 0;
        const confirmedRate = execTarget > 0 ? Math.round(execConfirmed / execTarget * 1000) / 10 : 0;
        const barColor = acqRate >= standardProgress ? 'var(--success)' : acqRate >= standardProgress * 0.8 ? 'var(--warning)' : 'var(--danger)';

        const confirmedBarColor = confirmedRate >= standardProgress ? 'var(--success)' : confirmedRate >= standardProgress * 0.8 ? 'var(--warning)' : 'var(--danger)';

        html += `
            <div class="team-card">
                <div class="team-card-header">
                    <span class="team-name">${teamName}</span>
                    <span class="team-progress" style="color:${barColor};">${acqRate}%</span>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:4px;">
                    <div>
                        <div style="font-size:0.7rem;color:var(--text-light);">取得</div>
                        <div class="number" style="font-size:1.1rem;font-weight:700;">¥${acqAmount.toLocaleString()}</div>
                        ${target > 0 ? `
                        <div class="progress-bar" style="margin-top:4px;">
                            <div class="progress-bar-fill" style="width:${Math.min(acqRate, 100)}%;background:${barColor};"></div>
                            <div class="progress-bar-line" style="left:${Math.min(standardProgress, 100)}%;"></div>
                        </div>
                        <div style="font-size:0.65rem;color:var(--text-light);">目標 ¥${(target / 10000).toFixed(0)}万 | ${acqRate}%</div>
                        ` : ''}
                    </div>
                    <div>
                        <div style="font-size:0.7rem;color:var(--text-light);">実施確定</div>
                        <div class="number" style="font-size:1.1rem;font-weight:700;color:var(--primary-blue);">¥${execConfirmed.toLocaleString()}</div>
                        ${execTarget > 0 ? `
                        <div class="progress-bar" style="margin-top:4px;">
                            <div class="progress-bar-fill" style="width:${Math.min(confirmedRate, 100)}%;background:${confirmedBarColor};"></div>
                            <div class="progress-bar-line" style="left:${Math.min(standardProgress, 100)}%;"></div>
                        </div>
                        <div style="font-size:0.65rem;color:var(--text-light);">目標 ¥${(execTarget / 10000).toFixed(0)}万 | ${confirmedRate}%</div>
                        ` : ''}
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid var(--border-color);">
                    <span style="font-size:0.65rem;color:var(--text-light);">実施見込</span>
                    <span style="font-size:0.8rem;font-weight:600;font-family:'Poppins',sans-serif;">¥${execForecast.toLocaleString()}</span>
                    <span style="font-size:0.6rem;color:var(--text-light);">（未確認+実施）</span>
                </div>
            </div>
        `;
    });

    html += '</div>';
    document.getElementById('teamCards').innerHTML = html;
}

function renderMemberSalesCards(appoData, execAppoData, standardProgress) {
    let html = '<div class="member-grid">';
    const ym = document.getElementById('filterMonth').value;

    membersData.forEach(member => {
        const memberAppo = appoData.filter(d => d.member_name === member.member_name);
        const acqAmount = memberAppo.reduce((s, a) => s + (a.amount || 0), 0);

        const memberExec = execAppoData.filter(d => d.member_name === member.member_name);
        const execForecast = memberExec.filter(a => a.status !== 'キャンセル' && a.status !== 'リスケ').reduce((s, a) => s + (a.amount || 0), 0);
        const execConfirmed = memberExec.filter(a => a.status === '実施').reduce((s, a) => s + (a.amount || 0), 0);

        const memberTarget = getTarget('member', member.member_name, ym);
        const acqTarget = memberTarget ? memberTarget.appointment_amount_target : 0;
        const execTarget = memberTarget ? (memberTarget.execution_target || acqTarget) : 0;
        const acqRate = acqTarget > 0 ? Math.round(acqAmount / acqTarget * 1000) / 10 : 0;
        const confirmedRate = execTarget > 0 ? Math.round(execConfirmed / execTarget * 1000) / 10 : 0;

        const acqBarColor = acqRate >= standardProgress ? 'var(--success)' : acqRate >= standardProgress * 0.8 ? 'var(--warning)' : 'var(--danger)';
        const confirmedBarColor = confirmedRate >= standardProgress ? 'var(--success)' : confirmedRate >= standardProgress * 0.8 ? 'var(--warning)' : 'var(--danger)';

        html += `
            <div class="member-card">
                <div class="member-card-header">
                    <span class="member-name">${displayName(member.member_name)}</span>
                    <span class="member-team-badge">${member.team_name}</span>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px;">
                    <div>
                        <div style="font-size:0.7rem;color:var(--text-light);">取得</div>
                        <div style="font-size:1.1rem;font-weight:700;font-family:'Poppins',sans-serif;">¥${acqAmount.toLocaleString()}</div>
                        ${acqTarget > 0 ? `
                        <div class="progress-bar" style="margin-top:4px;">
                            <div class="progress-bar-fill" style="width:${Math.min(acqRate, 100)}%;background:${acqBarColor};"></div>
                            <div class="progress-bar-line" style="left:${Math.min(standardProgress || 0, 100)}%;"></div>
                        </div>
                        <div style="font-size:0.65rem;color:var(--text-light);">目標 ¥${(acqTarget / 10000).toFixed(0)}万 | ${acqRate}%</div>
                        ` : ''}
                    </div>
                    <div>
                        <div style="font-size:0.7rem;color:var(--text-light);">実施確定</div>
                        <div style="font-size:1.1rem;font-weight:700;font-family:'Poppins',sans-serif;color:var(--primary-blue);">¥${execConfirmed.toLocaleString()}</div>
                        ${execTarget > 0 ? `
                        <div class="progress-bar" style="margin-top:4px;">
                            <div class="progress-bar-fill" style="width:${Math.min(confirmedRate, 100)}%;background:${confirmedBarColor};"></div>
                            <div class="progress-bar-line" style="left:${Math.min(standardProgress || 0, 100)}%;"></div>
                        </div>
                        <div style="font-size:0.65rem;color:var(--text-light);">目標 ¥${(execTarget / 10000).toFixed(0)}万 | ${confirmedRate}%</div>
                        ` : ''}
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid var(--border-color);">
                    <span style="font-size:0.65rem;color:var(--text-light);">実施見込</span>
                    <span style="font-size:0.8rem;font-weight:600;font-family:'Poppins',sans-serif;">¥${execForecast.toLocaleString()}</span>
                    <span style="font-size:0.6rem;color:var(--text-light);">（未確認+実施）</span>
                </div>
            </div>
        `;
    });

    html += '</div>';
    document.getElementById('memberSalesCards').innerHTML = html;
}

function renderMemberGraphs(perfData) {
    const PROJ_COLORS = [
        '#86aaec', '#6dc6e5', '#ede07d', '#ef947a', '#a1d7ea',
        '#c2d6f9', '#f4edb6', '#fecec0', '#b8d4f0', '#d4eaf7'
    ];

    // 案件リスト（色割り当て用）
    const projectNames = [...new Set(perfData.map(d => d.project_name).filter(Boolean))].sort();
    const projColorMap = {};
    projectNames.forEach((name, i) => { projColorMap[name] = PROJ_COLORS[i % PROJ_COLORS.length]; });

    const metrics = [
        { key: 'call_count', label: '架電数' },
        { key: 'pr_count', label: 'PR数' },
        { key: 'appointment_count', label: 'アポ数' },
        { key: 'call_hours', label: '稼働時間', suffix: 'h', decimals: 1 }
    ];

    // 凡例
    let legendHtml = '<div class="member-graph-legend">';
    projectNames.forEach(name => {
        legendHtml += `<span class="member-graph-legend-item"><span class="member-graph-legend-dot" style="background:${projColorMap[name]};"></span>${name}</span>`;
    });
    legendHtml += '</div>';

    let html = legendHtml;

    metrics.forEach(metric => {
        // メンバーごとに案件別の内訳を集計
        const memberValues = membersData.map(member => {
            const memberPerf = perfData.filter(d => d.member_name === member.member_name);
            const total = metric.key === 'call_hours' ? memberPerf.reduce((s, d) => s + (d[metric.key] || 0), 0) : memberPerf.reduce((s, d) => s + (d[metric.key] || 0), 0);
            const byProject = {};
            memberPerf.forEach(d => {
                const pn = d.project_name || '不明';
                byProject[pn] = (byProject[pn] || 0) + (d[metric.key] || 0);
            });
            return { name: displayName(member.member_name), total, byProject };
        }).sort((a, b) => b.total - a.total);

        const maxValue = Math.max(...memberValues.map(m => m.total), 1);

        html += `<div class="member-graph-section">
            <div class="member-graph-title">${metric.label}</div>
            <div class="member-graph-bars">`;

        memberValues.forEach(m => {
            const totalPct = maxValue > 0 ? (m.total / maxValue * 100) : 0;
            const displayVal = metric.decimals ? m.total.toFixed(metric.decimals) : m.total.toLocaleString();

            // 積み上げセグメント
            let segments = '';
            projectNames.forEach(pn => {
                const val = m.byProject[pn] || 0;
                if (val <= 0) return;
                const segPct = m.total > 0 ? (val / m.total * 100) : 0;
                const segDisplay = metric.decimals ? val.toFixed(metric.decimals) : val.toLocaleString();
                segments += `<div class="member-graph-segment" style="width:${segPct}%;background:${projColorMap[pn]};" data-tip="${pn}: ${segDisplay}${metric.suffix || ''}"></div>`;
            });
            // 不明な案件
            const unknownVal = m.byProject['不明'] || 0;
            if (unknownVal > 0 && !projectNames.includes('不明')) {
                const segPct = m.total > 0 ? (unknownVal / m.total * 100) : 0;
                segments += `<div class="member-graph-segment" style="width:${segPct}%;background:var(--gray-300);" data-tip="不明: ${unknownVal}"></div>`;
            }

            html += `
                <div class="member-graph-row">
                    <div class="member-graph-name">${m.name}</div>
                    <div class="member-graph-bar-wrap">
                        <div class="member-graph-stacked" style="width:${totalPct}%;">
                            ${segments}
                        </div>
                    </div>
                    <div class="member-graph-value">${displayVal}${metric.suffix || ''}</div>
                </div>`;
        });

        html += `</div></div>`;
    });

    document.getElementById('memberGraphs').innerHTML = html;

    // カスタムツールチップ
    let tip = document.getElementById('graphTooltip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'graphTooltip';
        tip.className = 'graph-tooltip';
        document.body.appendChild(tip);
    }
    document.querySelectorAll('.member-graph-segment[data-tip]').forEach(el => {
        el.addEventListener('mouseenter', e => {
            tip.textContent = el.dataset.tip;
            tip.style.display = 'block';
            const rect = el.getBoundingClientRect();
            tip.style.left = (rect.left + rect.width / 2) + 'px';
            tip.style.top = (rect.top - 8) + 'px';
        });
        el.addEventListener('mouseleave', () => {
            tip.style.display = 'none';
        });
    });
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
    const total = allData.length;
    const executeRate = total > 0 ? (statusCounts['実施'] / total * 100).toFixed(1) : '0';
    const cancelRate = total > 0 ? (statusCounts['キャンセル'] / total * 100).toFixed(1) : '0';
    const rescheduleRate = total > 0 ? (statusCounts['リスケ'] / total * 100).toFixed(1) : '0';
    const unconfirmedRate = total > 0 ? (statusCounts['未確認'] / total * 100).toFixed(1) : '0';

    document.getElementById('appo-status-summary').innerHTML = `
        <div class="rate-grid" style="margin-bottom:12px;">
            <div class="rate-card">
                <div class="rate-value" style="color:var(--text-dark);">${total}</div>
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
        <div class="rate-grid" style="margin-bottom:20px;">
            <div class="rate-card">
                <div class="rate-value" style="color:${parseFloat(executeRate) < 80 ? 'var(--primary-red)' : 'var(--primary-blue)'}">${executeRate}%</div>
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
                <div class="rate-value" style="color:var(--text-light);">${unconfirmedRate}%</div>
                <div class="rate-label">未確認率</div>
            </div>
        </div>
    `;

    // テーブル用データ: 今日までフィルタ + ステータスフィルタ
    let tableData = allData;
    if (!appoShowAll) {
        const today = formatDate(new Date());
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

}

function filterAppoStatus(status) {
    currentAppoFilter = status;
    document.querySelectorAll('.appo-status-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.status === status);
    });
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
        const now = formatDate(new Date());
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

    // 実施数（取得ベース: 当月取得アポのうち実施確定のもの）
    const filteredAcqAppo = filter.team !== 'all'
        ? appointmentsData.filter(a => {
            const tm = membersData.filter(m => m.team_name === filter.team).map(m => m.member_name);
            return tm.includes(a.member_name);
        })
        : filter.member !== 'all'
            ? appointmentsData.filter(a => a.member_name === filter.member)
            : appointmentsData;
    const execConfirmed = filteredAcqAppo.filter(a => a.status === '実施').length;
    const appoToExec = totalAppo > 0 ? (execConfirmed / totalAppo * 100) : 0;

    // ファネル
    const maxHeight = 160;
    const callH = maxHeight;
    const prH = totalCalls > 0 ? Math.max(20, totalPR / totalCalls * maxHeight) : 20;
    const appoH = totalCalls > 0 ? Math.max(20, totalAppo / totalCalls * maxHeight) : 20;
    const execH = totalCalls > 0 ? Math.max(20, execConfirmed / totalCalls * maxHeight) : 20;

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
        <div style="text-align:center;">
            <div class="funnel-arrow">→</div>
            <div class="funnel-rate">${appoToExec.toFixed(1)}%</div>
        </div>
        <div class="funnel-stage">
            <div class="funnel-bar" style="width:100px;height:${execH}px;background:var(--success-light);"></div>
            <div class="funnel-value">${execConfirmed.toLocaleString()}</div>
            <div class="funnel-label">実施数</div>
        </div>
    `;

    // メンバー/チーム別歩留まりテーブル
    const entities = filter.team !== 'all'
        ? membersData.filter(m => m.team_name === filter.team)
        : filter.member !== 'all'
            ? membersData.filter(m => m.member_name === filter.member)
            : membersData;

    // 基準値（赤字判定用）
    const BL_CTP = 15;   // 架電toPR 15%
    const BL_PTA = 30;   // PRtoアポ 30%
    const BL_CTA = 3;    // 架電toアポ 3%

    const redStyle = (val, baseline) => val !== '-' && parseFloat(val) < baseline ? ' style="color:var(--primary-red);font-weight:600;"' : '';

    let yieldRows = '';
    let totalExecCount = 0;
    entities.forEach(entity => {
        const ep = perfData.filter(d => d.member_name === entity.member_name);
        const c = sum(ep, 'call_count');
        const p = sum(ep, 'pr_count');
        const a = sum(ep, 'appointment_count');

        // 実施数（取得ベース: 当月取得アポのうち実施確定）
        const memberExec = appointmentsData.filter(d => d.member_name === entity.member_name && d.status === '実施');
        const e = memberExec.length;
        totalExecCount += e;
        const ate = a > 0 ? (e / a * 100).toFixed(1) : '-';

        const ctp = c > 0 ? (p / c * 100).toFixed(1) : '-';
        const pta = p > 0 ? (a / p * 100).toFixed(1) : '-';
        const cta = c > 0 ? (a / c * 100).toFixed(2) : '-';

        yieldRows += `
            <tr>
                <td>${displayName(entity.member_name)}</td>
                <td class="text-right number">${c.toLocaleString()}</td>
                <td class="text-right number">${p.toLocaleString()}</td>
                <td class="text-right number">${a}</td>
                <td class="text-right number">${e}</td>
                <td class="text-right number"${redStyle(ctp, BL_CTP)}>${ctp}%</td>
                <td class="text-right number"${redStyle(pta, BL_PTA)}>${pta}%</td>
                <td class="text-right number">${ate}%</td>
                <td class="text-right number"${redStyle(cta, BL_CTA)}>${cta}%</td>
            </tr>
        `;
    });

    // 合計行
    const totalAte = totalAppo > 0 ? (totalExecCount / totalAppo * 100).toFixed(1) : '-';
    yieldRows += `
        <tr style="font-weight:700;background:var(--gray-100);">
            <td>合計</td>
            <td class="text-right number">${totalCalls.toLocaleString()}</td>
            <td class="text-right number">${totalPR.toLocaleString()}</td>
            <td class="text-right number">${totalAppo}</td>
            <td class="text-right number">${totalExecCount}</td>
            <td class="text-right number"${redStyle(callToPR.toFixed(1), BL_CTP)}>${callToPR.toFixed(1)}%</td>
            <td class="text-right number"${redStyle(prToAppo.toFixed(1), BL_PTA)}>${prToAppo.toFixed(1)}%</td>
            <td class="text-right number">${totalAte}%</td>
            <td class="text-right number"${redStyle(callToAppo.toFixed(2), BL_CTA)}>${callToAppo.toFixed(2)}%</td>
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

    const BASELINE = {
        callToPR: 0.15,
        prToAppo: 0.30,
        callToAppo: 0.03,
        callsPerHour: 40
    };

    let rows = '';
    let projDiagHtml = '';

    Object.keys(projectMap).sort().forEach(name => {
        const p = projectMap[name];
        const ctp = p.calls > 0 ? (p.pr / p.calls * 100).toFixed(1) : '-';
        const pta = p.pr > 0 ? (p.appo / p.pr * 100).toFixed(1) : '-';
        const cta = p.calls > 0 ? (p.appo / p.calls * 100).toFixed(2) : '-';

        const proj = projectsData.find(pr => pr.project_name === name);
        const unitPrice = proj ? proj.unit_price : (p.appo > 0 ? Math.round(p.amount / p.appo) : 0);
        const profitCheck = p.calls > 0 ? unitPrice * p.appo / p.calls : 0;
        const profitAlert = p.calls > 0 && profitCheck < 7;

        // 各指標の診断
        const actCtp = p.calls > 0 ? p.pr / p.calls : 0;
        const actPta = p.pr > 0 ? p.appo / p.pr : 0;
        const actCta = p.calls > 0 ? p.appo / p.calls : 0;
        const ctpLow = p.calls >= 30 && actCtp < BASELINE.callToPR * 0.9;
        const ptaLow = p.pr >= 10 && actPta < BASELINE.prToAppo * 0.9;
        const ctaLow = p.calls >= 30 && actCta < BASELINE.callToAppo * 0.9;
        const hasAnyAlert = profitAlert || ctpLow || ptaLow || ctaLow;

        // アラートバッジ
        let badges = '';
        if (!hasAnyAlert) {
            badges = '<span style="color:var(--success);font-size:0.75rem;">OK</span>';
        } else {
            if (ctpLow) badges += `<span class="yield-alert-badge alert" title="架電to着電率: ${(actCtp*100).toFixed(1)}%（基準${(BASELINE.callToPR*100)}%）">着電率↓</span>`;
            if (ptaLow) badges += `<span class="yield-alert-badge alert" title="着電toアポ率: ${(actPta*100).toFixed(1)}%（基準${(BASELINE.prToAppo*100)}%）">アポ率↓</span>`;
            if (profitAlert) badges += `<span class="yield-alert-badge alert" title="単価×架toア = ${profitCheck.toFixed(1)}（基準: 7以上）">収益性↓</span>`;
        }

        // 詳細行（クリックで展開）
        const rowId = `proj-detail-${name.replace(/[^a-zA-Z0-9]/g, '_')}`;
        let detailCells = '';
        if (hasAnyAlert && p.calls >= 30) {
            const details = [];
            if (ctpLow) details.push(`架電to着電率 ${(actCtp*100).toFixed(1)}%（基準 ${(BASELINE.callToPR*100)}%、乖離 ${((actCtp/BASELINE.callToPR-1)*100).toFixed(0)}%） → リスト品質・時間帯の見直し`);
            if (ptaLow) details.push(`着電toアポ率 ${(actPta*100).toFixed(1)}%（基準 ${(BASELINE.prToAppo*100)}%、乖離 ${((actPta/BASELINE.prToAppo-1)*100).toFixed(0)}%） → トークスクリプト改善・ヒアリング精度向上`);
            if (ctaLow) details.push(`架電toアポ率 ${(actCta*100).toFixed(2)}%（基準 ${(BASELINE.callToAppo*100)}%、乖離 ${((actCta/BASELINE.callToAppo-1)*100).toFixed(0)}%） → リスト品質とトーク品質の両面から改善`);
            if (profitAlert) details.push(`収益性指標 ${profitCheck.toFixed(1)}（基準: 7以上） → 単価またはアポ率の改善が必要`);

            detailCells = `<tr id="${rowId}" class="yield-detail-row" style="display:none;">
                <td colspan="8" style="padding:12px 16px;background:var(--gray-50);">
                    <div style="font-size:0.8rem;color:var(--text-dark);line-height:1.8;">
                        ${details.map(d => `<div style="margin-bottom:4px;">・${d}</div>`).join('')}
                    </div>
                </td>
            </tr>`;
        }

        rows += `
            <tr${hasAnyAlert ? ' style="background:var(--red-50);cursor:pointer;" onclick="toggleYieldDetail(\'' + rowId + '\')"' : ''}>
                <td>${name}</td>
                <td class="text-right number">${p.calls.toLocaleString()}</td>
                <td class="text-right number">${p.pr.toLocaleString()}</td>
                <td class="text-right number">${p.appo}</td>
                <td class="text-right number">${ctp}%</td>
                <td class="text-right number">${pta}%</td>
                <td class="text-right number">${cta}%</td>
                <td>${badges}</td>
            </tr>
            ${detailCells}
        `;

        // 診断セクション（アラートありのみ）
        if (hasAnyAlert && p.calls >= 30) {
            const gaps = [];
            if (ctpLow) gaps.push({ label: '架電to着電率', actual: actCtp, baseline: BASELINE.callToPR, suggestion: 'リスト品質・時間帯の見直し' });
            if (ptaLow) gaps.push({ label: '着電toアポ率', actual: actPta, baseline: BASELINE.prToAppo, suggestion: 'トークスクリプト改善・ヒアリング精度向上' });
            if (profitAlert) gaps.push({ label: '収益性', actual: profitCheck, baseline: 7, isIndex: true, suggestion: '単価またはアポ率の改善が必要' });

            const tags = gaps.map(g => {
                if (g.isIndex) return `<span class="diagnosis-tag alert">${g.label}: ${g.actual.toFixed(1)}（基準: ${g.baseline}以上） → ${g.suggestion}</span>`;
                const pct = (g.actual * 100).toFixed(1);
                const basePct = (g.baseline * 100).toFixed(1);
                return `<span class="diagnosis-tag alert">${g.label}: ${pct}%（基準: ${basePct}%） → ${g.suggestion}</span>`;
            }).join('');

            projDiagHtml += `
                <div class="project-diagnosis-card has-alert">
                    <div class="project-diagnosis-name">${name}</div>
                    <div class="project-diagnosis-tags">${tags}</div>
                </div>
            `;
        }
    });

    document.getElementById('projectYieldTableBody').innerHTML = rows;
    document.getElementById('projectDiagnosisGrid').innerHTML = projDiagHtml || '<div style="color:var(--text-light);font-size:0.85rem;">全案件が基準値を満たしています</div>';
}

function toggleYieldDetail(rowId) {
    const row = document.getElementById(rowId);
    if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
}

// ==================== Tab 4: 案件管理 ====================
function renderProjects() {
    // 案件ごとの当月アポ件数を集計
    const projectAppoCount = {};
    appointmentsData.forEach(a => {
        const pn = a.project_name;
        if (!pn) return;
        projectAppoCount[pn] = (projectAppoCount[pn] || 0) + 1;
    });

    // 案件カード
    let html = '';
    projectsData.forEach(p => {
        const pid = encodeURIComponent(p.project_name);
        const cap = p.monthly_cap_count || 0;
        const actual = projectAppoCount[p.project_name] || 0;
        const remaining = cap > 0 ? cap - actual : null;
        const capRate = cap > 0 ? Math.round(actual / cap * 100) : null;
        const barWidth = cap > 0 ? Math.min(actual / cap * 100, 100) : 0;
        const isOver = cap > 0 && actual >= cap;
        const barColor = isOver ? 'var(--primary-red)' : capRate > 80 ? '#ede07d' : 'var(--primary-blue)';

        html += `
            <div class="project-card" id="pcard-${pid}">
                <div class="project-card-header">
                    <div>
                        <div class="project-name">${p.project_name}</div>
                        <div class="project-client">${p.client_name || '-'}</div>
                    </div>
                    <span class="kpi-badge good">${p.status}</span>
                </div>
                <div class="project-cap-section">
                    <div class="project-cap-header">
                        <span class="project-meta-label">月次キャップ</span>
                        <span class="project-cap-edit editable-field" onclick="editProjectField(this, '${escapeHtml(p.project_name)}', 'monthly_cap_count', ${cap})">${cap > 0 ? cap + '件' : '未設定'}</span>
                    </div>
                    ${cap > 0 ? `
                        <div class="project-cap-bar-wrap">
                            <div class="project-cap-bar">
                                <div class="project-cap-bar-fill" style="width:${barWidth}%;background:${barColor};"></div>
                            </div>
                        </div>
                        <div class="project-cap-stats">
                            <span class="project-cap-actual">${actual}件<span style="color:var(--text-light);font-weight:400;"> / ${cap}件</span></span>
                            <span class="project-cap-remaining ${isOver ? 'over' : ''}">${isOver ? 'キャップ超過' : '残り' + remaining + '件'}</span>
                        </div>
                    ` : `
                        <div class="project-cap-stats">
                            <span class="project-cap-actual">${actual}件</span>
                        </div>
                    `}
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

function editProjectField(el, projectName, field, currentValue) {
    if (el.querySelector('input')) return; // already editing
    const display = el.innerHTML;
    const input = document.createElement('input');
    input.type = 'number';
    input.value = currentValue || '';
    input.style.cssText = 'width:80px;padding:4px 6px;border:1px solid var(--primary-blue);border-radius:4px;font-size:0.85rem;text-align:right;';
    el.innerHTML = '';
    el.appendChild(input);
    input.focus();
    input.select();

    const save = async () => {
        const newVal = parseInt(input.value) || 0;
        try {
            await executeTurso(
                `UPDATE projects SET ${field} = ?, updated_at = datetime('now') WHERE project_name = ?`,
                [newVal, projectName]
            );
            const proj = projectsData.find(p => p.project_name === projectName);
            if (proj) proj[field] = newVal;
            showToast(`${projectName}のキャップを更新しました`);
            renderProjects();
        } catch (e) {
            el.innerHTML = display;
            showToast('更新に失敗しました: ' + e.message, true);
        }
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { el.innerHTML = display; }
    });
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
    let acqHtml = '';
    let execHtml = '';

    // 全体目標
    const totalTarget = getTarget('total', 'all', ym);
    acqHtml += `
        <div class="settings-item">
            <label>全体</label>
            <input type="number" id="target_total_all" value="${totalTarget ? totalTarget.appointment_amount_target : settingsMap.monthly_target_total || 9000000}" min="0">
        </div>
    `;
    execHtml += `
        <div class="settings-item">
            <label>全体</label>
            <input type="number" id="target_total_all_exec" value="${totalTarget ? (totalTarget.execution_target || 0) : 0}" min="0">
        </div>
    `;

    // チーム目標
    ['野口Team', '松居Team', '坪井Team', '宮城Team'].forEach(team => {
        const t = getTarget('team', team, ym);
        acqHtml += `
            <div class="settings-item">
                <label>${team}</label>
                <input type="number" id="target_team_${team}" value="${t ? t.appointment_amount_target : 0}" min="0">
            </div>
        `;
        execHtml += `
            <div class="settings-item">
                <label>${team}</label>
                <input type="number" id="target_team_${team}_exec" value="${t ? (t.execution_target || 0) : 0}" min="0">
            </div>
        `;
    });

    // メンバー目標
    membersData.forEach(m => {
        const t = getTarget('member', m.member_name, ym);
        acqHtml += `
            <div class="settings-item">
                <label>${displayName(m.member_name)}</label>
                <input type="number" id="target_member_${m.member_name}" value="${t ? t.appointment_amount_target : 0}" min="0">
            </div>
        `;
        execHtml += `
            <div class="settings-item">
                <label>${displayName(m.member_name)}</label>
                <input type="number" id="target_member_${m.member_name}_exec" value="${t ? (t.execution_target || 0) : 0}" min="0">
            </div>
        `;
    });

    document.getElementById('acqTargetSettingsGrid').innerHTML = acqHtml;
    document.getElementById('execTargetSettingsGrid').innerHTML = execHtml;

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

function showToast(message, isError = false) {
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'toast-notification' + (isError ? ' error' : '');
    toast.textContent = isError ? message : '\u2714 ' + message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

function setSaveBtnState(btn, success) {
    if (!btn) return;
    const original = btn.textContent;
    btn.textContent = success ? '\u2714 保存しました' : '\u2716 失敗';
    btn.classList.add('saved');
    setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('saved');
    }, 2000);
}

async function saveTargets() {
    const ym = document.getElementById('filterMonth').value;
    const msg = document.getElementById('targetMessage');

    try {
        // 全体目標
        const totalVal = parseInt(document.getElementById('target_total_all').value) || 0;
        const totalExec = parseInt(document.getElementById('target_total_all_exec').value) || 0;
        await upsertTarget('total', 'all', ym, totalVal, totalExec);

        // チーム目標
        for (const team of ['野口Team', '松居Team', '坪井Team', '宮城Team']) {
            const val = parseInt(document.getElementById(`target_team_${team}`).value) || 0;
            const execVal = parseInt(document.getElementById(`target_team_${team}_exec`).value) || 0;
            await upsertTarget('team', team, ym, val, execVal);
        }

        // メンバー目標
        for (const m of membersData) {
            const val = parseInt(document.getElementById(`target_member_${m.member_name}`).value) || 0;
            const execVal = parseInt(document.getElementById(`target_member_${m.member_name}_exec`).value) || 0;
            await upsertTarget('member', m.member_name, ym, val, execVal);
        }

        // 目標再読み込み
        targetsData = await queryTurso("SELECT * FROM targets WHERE year_month = ?", [ym]);

        msg.className = 'settings-message success';
        msg.textContent = '目標を保存しました。';
        msg.style.display = 'block';
        setTimeout(() => { msg.style.display = 'none'; }, 3000);

        showToast('目標を保存しました');
        document.querySelectorAll('.save-btn[onclick="saveTargets()"]').forEach(b => setSaveBtnState(b, true));

        renderAll();
    } catch (error) {
        msg.className = 'settings-message error';
        msg.textContent = '保存に失敗しました: ' + error.message;
        msg.style.display = 'block';
        showToast('保存に失敗しました: ' + error.message, true);
    }
}

async function upsertTarget(type, name, ym, amount, execAmount) {
    await executeTurso(
        `INSERT INTO targets (id, target_type, target_name, year_month, appointment_amount_target, execution_target)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?)
         ON CONFLICT(target_type, target_name, year_month)
         DO UPDATE SET appointment_amount_target = excluded.appointment_amount_target,
                       execution_target = excluded.execution_target`,
        [type, name, ym, amount, execAmount || 0]
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

        showToast('日次目標を保存しました');
        setSaveBtnState(document.querySelector('.save-btn[onclick="saveDailyTarget()"]'), true);
    } catch (error) {
        msg.className = 'settings-message error';
        msg.textContent = '保存に失敗しました: ' + error.message;
        msg.style.display = 'block';
        showToast('保存に失敗しました: ' + error.message, true);
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

        showToast('レート設定を保存しました');
        setSaveBtnState(document.querySelector('.save-btn[onclick="saveRateSettings()"]'), true);
    } catch (error) {
        msg.className = 'settings-message error';
        msg.textContent = '保存に失敗しました: ' + error.message;
        msg.style.display = 'block';
        showToast('保存に失敗しました: ' + error.message, true);
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
