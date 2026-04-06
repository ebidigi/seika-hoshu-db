// ==================== Turso DB Config ====================
const TURSO_CONFIG = {
    url: 'https://seika-hoshu-db-ebidigi-ebidigi.aws-ap-northeast-1.turso.io',
    authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzMxMDE2NTgsImlkIjoiMDE5Y2Q1MTgtMTYwMS03NDUzLTg2NTktZDdhZGRhNDY2ZDJhIiwicmlkIjoiNDQ4MTQ4ODAtZDdlZS00NTBlLWFjYTgtMDczYzI2Njk2MDhlIn0.YuB6UZYWy9iE1MxrQe4oKX7OyPjAqtT12RRZeaOzjSueyqR9_HbZUPvmPhiK8fQi-5a3iK3CqkG4lLhVrRn1Cg'
};

// ==================== Global State ====================
let currentPage = 'summary';
let currentSubTab = { miyoshi: 'overview', kikuchi: 'overview', kadou: 'overview' };
let membersData = [];
let teamsData = [];
let projectsData = [];
let targetsData = [];
let performanceData = [];
let appointmentsData = [];
let executionAppoData = [];
let assignmentsData = [];
let teamHistoryData = [];
let holidaysSet = new Set();
let charts = {};

// Team appointment filter/sort state
let appoState = {
    miyoshi: { filter: 'all', search: '', sortKey: 'scheduled_date', sortAsc: false },
    kikuchi: { filter: 'all', search: '', sortKey: 'scheduled_date', sortAsc: false }
};

// Analysis chart state
let analysisState = {
    miyoshi: { chartType: 'calls' },
    kikuchi: { chartType: 'calls' }
};

// Editing state
let editingAssignmentId = null;
let editingAssignmentTeam = null;
let currentSettingsTab = 'teamTargets';

// Holidays fallback
const HOLIDAYS_2026 = [
    '2026-01-01','2026-01-02','2026-01-12',
    '2026-02-11','2026-02-23',
    '2026-03-20',
    '2026-04-29',
    '2026-05-03','2026-05-04','2026-05-05','2026-05-06',
    '2026-07-20',
    '2026-08-11',
    '2026-09-21','2026-09-22','2026-09-23',
    '2026-10-12',
    '2026-11-03','2026-11-23',
];
holidaysSet = new Set(HOLIDAYS_2026);

// Team config
const TEAM_CONFIG = {
    kikuchi: { teamName: '菊池Team', label: '菊池Team' },
    miyoshi: { teamName: '三善Team', label: '三善Team' }
};

// ==================== Member Name Normalization ====================
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
    '@田中颯汰/tanaka sota': '田中颯汰',
    '村上夢果': '村上', '村上 夢果': '村上', '@村上夢果': '村上',
    '三善一樹': '三善', '三善 一樹': '三善', '@三善一樹/miyoshi itsuki': '三善',
    '菊池幸平': '菊池', '菊池 幸平': '菊池', '@菊池幸平/kikuchi kohei': '菊池',
    '野上樹哉': '野上', '野上 樹哉': '野上', '@野上 樹哉/nogami jukiya': '野上',
    '池田愛': '池田', '池田 愛': '池田', '@池田愛/ikeda ai': '池田',
    '轟玲音': '轟', '轟 玲音': '轟',
    '清水陸斗': '清水', '清水 陸斗': '清水',
    '堀切友世': '堀切', '堀切 友世': '堀切',
    '田端音藍': '田端', '田端 音藍': '田端', 'タバタ': '田端'
};

function normalizeMemberName(name) {
    if (!name) return name;
    if (MEMBER_NAME_NORMALIZE[name]) return MEMBER_NAME_NORMALIZE[name];
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

function displayName(memberName) {
    const member = membersData.find(m => m.member_name === memberName);
    return (member && member.display_name) ? member.display_name : memberName;
}

// ==================== Turso API ====================
async function queryTurso(sql, args = []) {
    const payload = { statements: [{ q: sql, params: args }] };
    const response = await fetch(TURSO_CONFIG.url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${TURSO_CONFIG.authToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Turso API error: ${response.status}`);
    const result = await response.json();
    if (result[0] && result[0].error) throw new Error(result[0].error.message || result[0].error);
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

// ==================== Team Resolution ====================
function getTeamsForMonth(ym) {
    const monthHistory = teamHistoryData.filter(h => h.year_month === ym);
    if (monthHistory.length === 0) {
        const map = {};
        membersData.forEach(m => { map[m.member_name] = m.team_name; });
        return map;
    }
    const map = {};
    monthHistory.forEach(h => { map[h.member_name] = h.team_name; });
    return map;
}

function getTeamMembersForMonth(teamName, ym) {
    const membership = getTeamsForMonth(ym);
    return Object.entries(membership)
        .filter(([_, team]) => team === teamName)
        .map(([member, _]) => member);
}

// ==================== Helpers ====================
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

function formatYen(v) {
    if (v == null) return '¥0';
    return '¥' + Math.round(v).toLocaleString();
}

function formatNum(v) {
    if (v == null) return '0';
    return Number(v).toLocaleString();
}

function formatPct(v) {
    if (v == null || isNaN(v)) return '0%';
    return v.toFixed(1) + '%';
}

function getSelectedMonth() {
    return document.getElementById('filterMonth').value;
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
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function progressColor(pct) {
    if (pct >= 80) return 'green';
    if (pct >= 50) return 'yellow';
    return 'red';
}

function safeId(str) { return encodeURIComponent(str).replace(/%/g, '_'); }

function yieldClass(value, baseline) {
    if (value >= baseline) return 'yield-good';
    if (value >= baseline * 0.7) return 'yield-warn';
    return 'yield-bad';
}

function deduplicateAppointments(appoArray) {
    const seen = new Map();
    for (const a of appoArray) {
        const key = `${a.member_name}|${a.project_name}|${a.acquisition_date}|${a.customer_name || a.id}`;
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
        } else if (d.updated_at > seen.get(key).updated_at) {
            seen.set(key, d);
        }
    }
    return Array.from(seen.values());
}

// ==================== UI Helpers ====================
function showLoading() {
    document.getElementById('loadingOverlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}

function showToast(message, isError = false) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast ' + (isError ? 'error' : 'success');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3500);
}

// ==================== Navigation ====================
function switchPage(page) {
    currentPage = page;
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.nav-tab[data-page="${page}"]`).classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-' + page).classList.remove('hidden');
    renderCurrentPage();
}

function switchSubTab(teamKey, sub) {
    currentSubTab[teamKey] = sub;
    const tabsEl = document.getElementById(teamKey + 'SubTabs');
    tabsEl.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
    tabsEl.querySelector(`.sub-tab[data-sub="${sub}"]`).classList.add('active');

    ['overview', 'appointments', 'projects', 'analysis'].forEach(s => {
        const el = document.getElementById(teamKey + '-' + s);
        if (s === sub) el.classList.remove('hidden');
        else el.classList.add('hidden');
    });
    renderTeamSubTab(teamKey, sub);
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

// ==================== Initialization ====================
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('filterMonth').value = '2026-04';
    loadAllData();
});

// ==================== Data Loading ====================
async function loadAllData() {
    showLoading();
    try {
        const results = await Promise.all([
            queryTurso("SELECT * FROM members WHERE status = 'active' ORDER BY team_name, member_name"),
            queryTurso("SELECT * FROM teams WHERE status = 'active'"),
            queryTurso("SELECT * FROM projects WHERE status = 'active' ORDER BY project_name"),
            queryTurso("SELECT date FROM holidays"),
            queryTurso("SELECT * FROM member_team_history ORDER BY year_month, team_name, member_name")
        ]);

        membersData = results[0];
        teamsData = results[1];
        projectsData = results[2];
        holidaysSet = new Set(HOLIDAYS_2026);
        results[3].forEach(h => { if (h.date) holidaysSet.add(h.date); });
        teamHistoryData = results[4];

        console.log('Master data loaded:', membersData.length, 'members,', teamsData.length, 'teams,', projectsData.length, 'projects');

        await loadMonthData();
        document.getElementById('lastUpdated').textContent = `最終更新: ${new Date().toLocaleString('ja-JP')}`;
    } catch (error) {
        console.error('Data load error:', error);
        showToast('データの読み込みに失敗しました: ' + error.message, true);
    } finally {
        hideLoading();
    }
}

async function loadMonthData() {
    const ym = getSelectedMonth();
    const startDate = ym + '-01';
    const endDate = getEndOfMonth(ym);

    const results = await Promise.all([
        queryTurso("SELECT * FROM performance_rawdata WHERE input_date >= ? AND input_date <= ? ORDER BY input_date", [startDate, endDate]),
        queryTurso("SELECT * FROM appointments WHERE acquisition_date >= ? AND acquisition_date <= ? ORDER BY acquisition_date DESC", [startDate, endDate]),
        queryTurso("SELECT * FROM targets WHERE year_month = ?", [ym]),
        queryTurso("SELECT * FROM project_member_assignments WHERE year_month = ? ORDER BY project_name, member_name", [ym]),
        queryTurso("SELECT * FROM appointments WHERE scheduled_date >= ? AND scheduled_date <= ? ORDER BY scheduled_date", [startDate, endDate])
    ]);

    performanceData = results[0];
    appointmentsData = results[1];
    targetsData = results[2];
    assignmentsData = results[3] || [];
    executionAppoData = results[4] || [];

    normalizeDataMemberNames(performanceData);
    normalizeDataMemberNames(appointmentsData);
    normalizeDataMemberNames(executionAppoData);
    normalizeDataMemberNames(assignmentsData);

    appointmentsData = deduplicateAppointments(appointmentsData);
    executionAppoData = deduplicateAppointments(executionAppoData);
    performanceData = deduplicatePerformance(performanceData);

    // Fill missing appointment_amount from project unit_price
    const projectPriceMap = {};
    projectsData.forEach(p => { projectPriceMap[p.project_name] = p.unit_price || 0; });
    performanceData.forEach(d => {
        if (!d.appointment_amount && d.appointment_count > 0) {
            d.appointment_amount = (projectPriceMap[d.project_name] || 0) * d.appointment_count;
        }
    });

    console.log('Month data loaded:', performanceData.length, 'perf,', appointmentsData.length, 'appos');
    renderAll();
}

function onMonthChange() {
    showLoading();
    loadMonthData().catch(e => showToast(e.message, true)).finally(() => hideLoading());
}

function refreshData() {
    const btn = document.getElementById('refreshBtn');
    btn.disabled = true;
    loadAllData().finally(() => { btn.disabled = false; });
}

// ==================== Render Dispatch ====================
function renderAll() {
    renderCurrentPage();
}

function renderCurrentPage() {
    if (currentPage === 'summary') {
        renderSummary();
    } else if (currentPage === 'team-miyoshi') {
        renderTeamSubTab('miyoshi', currentSubTab.miyoshi);
    } else if (currentPage === 'team-kikuchi') {
        renderTeamSubTab('kikuchi', currentSubTab.kikuchi);
    } else if (currentPage === 'team-kadou') {
        renderKadouSubTab(currentSubTab.kadou);
    }
}

function renderTeamSubTab(teamKey, sub) {
    const teamName = TEAM_CONFIG[teamKey].teamName;
    const ym = getSelectedMonth();
    const members = getTeamMembersForMonth(teamName, ym);
    const perf = performanceData.filter(d => members.includes(d.member_name));
    const appo = appointmentsData.filter(d => members.includes(d.member_name));
    const execAppoRaw = executionAppoData.filter(d => members.includes(d.member_name));
    const execAppo = adjustExecAppoForTeam(execAppoRaw, teamName, ym);
    const asg = assignmentsData.filter(d => members.includes(d.member_name));

    switch (sub) {
        case 'overview': renderTeamOverview(teamKey, teamName, ym, members, perf, appo, execAppo, asg); break;
        case 'appointments': renderTeamAppointments(teamKey, teamName, ym, members, appo, execAppo); break;
        case 'projects': renderTeamProjects(teamKey, teamName, ym, members, perf, asg); break;
        case 'analysis': renderTeamAnalysis(teamKey, teamName, ym, members, perf, appo, execAppo); break;
    }
}

// ==================== Cross-Team Appointment Adjustments ====================
// 3月取得→4月実施のイレギュラー: 旧チーム側に帰属させる
const CROSS_TEAM_APPO_RULES = [
    { member: '池田', fromTeam: '菊池Team', toTeam: '三善Team', acqMonth: '2026-03', execMonth: '2026-04' },
    { member: '田中颯汰', fromTeam: '三善Team', toTeam: '菊池Team', acqMonth: '2026-03', execMonth: '2026-04' }
];

function adjustExecAppoForTeam(execAppo, teamName, ym) {
    let adjusted = [...execAppo];
    CROSS_TEAM_APPO_RULES.forEach(rule => {
        if (ym !== rule.execMonth) return;
        if (teamName === rule.fromTeam) {
            // このチームから該当アポを除外
            adjusted = adjusted.filter(a => !(a.member_name === rule.member && a.acquisition_date && a.acquisition_date.startsWith(rule.acqMonth)));
        } else if (teamName === rule.toTeam) {
            // このチームに該当アポを追加
            const crossAppos = executionAppoData.filter(a => a.member_name === rule.member && a.acquisition_date && a.acquisition_date.startsWith(rule.acqMonth));
            adjusted = adjusted.concat(crossAppos);
        }
    });
    return deduplicateAppointments(adjusted);
}

// ==================== Compute Team Stats ====================
function computeTeamStats(teamName, ym) {
    const members = getTeamMembersForMonth(teamName, ym);
    const perf = performanceData.filter(d => members.includes(d.member_name));
    const appo = appointmentsData.filter(d => members.includes(d.member_name));
    const execAppoRaw = executionAppoData.filter(d => members.includes(d.member_name));
    const execAppo = adjustExecAppoForTeam(execAppoRaw, teamName, ym);
    const asg = assignmentsData.filter(d => members.includes(d.member_name));

    const callCount = sum(perf, 'call_count');
    const prCount = sum(perf, 'pr_count');
    const appoCount = sum(perf, 'appointment_count');
    const appoAmount = sum(perf, 'appointment_amount');
    const execAmount = execAppo.filter(a => a.status === '実施').reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const execUnconfirmedAmount = execAppo.filter(a => a.status === '未確認').reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const execForecast = execAmount + execUnconfirmedAmount * 0.85;

    // Target from targets table
    const teamTarget = getTarget('team', teamName, ym);
    const appoTarget = teamTarget ? (parseFloat(teamTarget.appointment_amount_target) || 0) : 0;
    const execTarget = teamTarget ? (parseFloat(teamTarget.execution_target) || 0) : 0;

    const callToPr = callCount > 0 ? prCount / callCount * 100 : 0;
    const prToAppo = prCount > 0 ? appoCount / prCount * 100 : 0;
    const callToAppo = callCount > 0 ? appoCount / callCount * 100 : 0;

    // Appo status counts - merge acquisition and execution, dedup
    const allAppo = deduplicateAppointments([...appo, ...execAppo]);
    const execCount = execAppo.filter(a => a.status === '実施').length;
    const appoToExec = allAppo.length > 0 ? execCount / allAppo.length * 100 : 0;
    const statusCounts = { '未確認': 0, '実施': 0, 'リスケ': 0, 'キャンセル': 0 };
    allAppo.forEach(a => { if (statusCounts[a.status] !== undefined) statusCounts[a.status]++; });

    // Unique projects for this team
    const projectNames = [...new Set(asg.map(a => a.project_name))];

    return {
        members, callCount, prCount, appoCount, appoAmount, execAmount, execUnconfirmedAmount, execForecast,
        appoTarget, execTarget,
        callToPr, prToAppo, callToAppo, appoToExec,
        statusCounts, memberCount: members.length, projectCount: projectNames.length,
        perf, appo, execAppo, asg
    };
}

// ==================== Summary Page ====================
function renderSummary() {
    const ym = getSelectedMonth();
    const bd = getBusinessDays(ym);
    const standardProgress = bd.total > 0 ? Math.round(bd.elapsed / bd.total * 1000) / 10 : 0;

    const kikuchiStats = computeTeamStats('菊池Team', ym);
    const miyoshiStats = computeTeamStats('三善Team', ym);

    const totalAppoTarget = kikuchiStats.appoTarget + miyoshiStats.appoTarget;
    const totalAppoAmount = kikuchiStats.appoAmount + miyoshiStats.appoAmount;
    const totalAchievement = totalAppoTarget > 0 ? totalAppoAmount / totalAppoTarget * 100 : 0;

    // KPI Bar
    document.getElementById('summaryKpiBar').innerHTML = `
        <div class="kpi-main">
            <div class="kpi-label">全体売上目標</div>
            <div class="kpi-value">${formatYen(totalAppoTarget)}</div>
            <div class="kpi-sub">取得実績: ${formatYen(totalAppoAmount)}</div>
        </div>
        <div class="kpi-progress-wrap">
            <div class="kpi-progress-labels">
                <span>達成率 ${totalAchievement.toFixed(1)}%</span>
                <span>標準進捗 ${standardProgress}%</span>
            </div>
            <div class="kpi-progress-bar">
                <div class="kpi-progress-fill" style="width:${Math.min(totalAchievement, 100)}%"></div>
                <div class="kpi-progress-standard" style="left:${standardProgress}%"></div>
            </div>
        </div>
        <div class="kpi-badges">
            <div class="kpi-badge">
                <div class="badge-value">${bd.elapsed}/${bd.total}</div>
                <div class="badge-label">営業日</div>
            </div>
            <div class="kpi-badge">
                <div class="badge-value">${formatYen(kikuchiStats.execAmount + miyoshiStats.execAmount)}</div>
                <div class="badge-label">実施確定</div>
            </div>
        </div>
    `;

    // Team Comparison Table
    function compRow(label, kv, mv, tv, isYen = false, isPct = false) {
        const fmt = isYen ? formatYen : isPct ? formatPct : formatNum;
        return `<tr>
            <td class="label-col">${label}</td>
            <td class="num">${fmt(kv)}</td>
            <td class="num">${fmt(mv)}</td>
            <td class="num total-col">${fmt(tv)}</td>
        </tr>`;
    }

    const k = kikuchiStats, m = miyoshiStats;
    const kAllAppoTotal = deduplicateAppointments([...k.appo, ...k.execAppo]);
    const mAllAppoTotal = deduplicateAppointments([...m.appo, ...m.execAppo]);
    document.getElementById('summaryComparisonTable').innerHTML = `
        <thead><tr>
            <th>指標</th><th class="num">菊池Team</th><th class="num">三善Team</th><th class="num total-col">全体</th>
        </tr></thead>
        <tbody>
            ${compRow('取得目標', k.appoTarget, m.appoTarget, k.appoTarget + m.appoTarget, true)}
            ${compRow('取得実績', k.appoAmount, m.appoAmount, k.appoAmount + m.appoAmount, true)}
            ${compRow('達成率', pct(k.appoAmount, k.appoTarget), pct(m.appoAmount, m.appoTarget), pct(k.appoAmount + m.appoAmount, k.appoTarget + m.appoTarget), false, true)}
            ${compRow('実施目標', k.execTarget, m.execTarget, k.execTarget + m.execTarget, true)}
            ${compRow('実施目標（0.85）', k.execTarget > 0 ? Math.round(k.execTarget / 0.85) : 0, m.execTarget > 0 ? Math.round(m.execTarget / 0.85) : 0, (k.execTarget + m.execTarget) > 0 ? Math.round((k.execTarget + m.execTarget) / 0.85) : 0, true)}
            ${compRow('実施確定', k.execAmount, m.execAmount, k.execAmount + m.execAmount, true)}
            ${compRow('実施見込（0.85）', Math.round(k.execForecast), Math.round(m.execForecast), Math.round(k.execForecast + m.execForecast), true)}
            ${compRow('架電数', k.callCount, m.callCount, k.callCount + m.callCount)}
            ${compRow('PR数', k.prCount, m.prCount, k.prCount + m.prCount)}
            ${compRow('アポ数', k.appoCount, m.appoCount, k.appoCount + m.appoCount)}
            ${compRow('アポ単価', k.appoCount > 0 ? Math.round(k.appoAmount / k.appoCount) : 0, m.appoCount > 0 ? Math.round(m.appoAmount / m.appoCount) : 0, (k.appoCount + m.appoCount) > 0 ? Math.round((k.appoAmount + m.appoAmount) / (k.appoCount + m.appoCount)) : 0, true)}
            ${compRow('架電toPR', k.callToPr, m.callToPr, (k.callCount + m.callCount) > 0 ? (k.prCount + m.prCount) / (k.callCount + m.callCount) * 100 : 0, false, true)}
            ${compRow('PRtoアポ', k.prToAppo, m.prToAppo, (k.prCount + m.prCount) > 0 ? (k.appoCount + m.appoCount) / (k.prCount + m.prCount) * 100 : 0, false, true)}
            ${compRow('架電toアポ', k.callToAppo, m.callToAppo, (k.callCount + m.callCount) > 0 ? (k.appoCount + m.appoCount) / (k.callCount + m.callCount) * 100 : 0, false, true)}
            ${compRow('アポto実施', k.appoToExec, m.appoToExec, (kAllAppoTotal.length + mAllAppoTotal.length) > 0 ? (k.statusCounts['実施'] + m.statusCounts['実施']) / (kAllAppoTotal.length + mAllAppoTotal.length) * 100 : 0, false, true)}
            ${compRow('メンバー数', k.memberCount, m.memberCount, k.memberCount + m.memberCount)}
            ${compRow('案件数', k.projectCount, m.projectCount, k.projectCount + m.projectCount)}
        </tbody>
    `;

    // Appo Status Summary
    const statuses = ['未確認', '実施', 'リスケ', 'キャンセル'];
    const kAllAppo = deduplicateAppointments([...k.appo, ...k.execAppo]);
    const mAllAppo = deduplicateAppointments([...m.appo, ...m.execAppo]);
    const kStatusCounts = { '未確認': 0, '実施': 0, 'リスケ': 0, 'キャンセル': 0 };
    const mStatusCounts = { '未確認': 0, '実施': 0, 'リスケ': 0, 'キャンセル': 0 };
    kAllAppo.forEach(a => { if (kStatusCounts[a.status] !== undefined) kStatusCounts[a.status]++; });
    mAllAppo.forEach(a => { if (mStatusCounts[a.status] !== undefined) mStatusCounts[a.status]++; });

    const kExecRate = kAllAppo.length > 0 ? kStatusCounts['実施'] / kAllAppo.length * 100 : 0;
    const mExecRate = mAllAppo.length > 0 ? mStatusCounts['実施'] / mAllAppo.length * 100 : 0;
    const allAppoTotal = kAllAppo.length + mAllAppo.length;
    const totalExecRate = allAppoTotal > 0 ? (kStatusCounts['実施'] + mStatusCounts['実施']) / allAppoTotal * 100 : 0;

    document.getElementById('summaryAppoStatusTable').innerHTML = `
        <thead><tr>
            <th>ステータス</th><th class="num">菊池Team</th><th class="num">三善Team</th><th class="num total-col">全体</th>
        </tr></thead>
        <tbody>
            ${statuses.map(s => `<tr>
                <td class="label-col">${s}</td>
                <td class="num">${kStatusCounts[s]}</td>
                <td class="num">${mStatusCounts[s]}</td>
                <td class="num total-col">${kStatusCounts[s] + mStatusCounts[s]}</td>
            </tr>`).join('')}
            <tr>
                <td class="label-col">実施率</td>
                <td class="num">${formatPct(kExecRate)}</td>
                <td class="num">${formatPct(mExecRate)}</td>
                <td class="num total-col">${formatPct(totalExecRate)}</td>
            </tr>
        </tbody>
    `;

    // Member Ranking
    const memberTeamMap = getTeamsForMonth(ym);
    const allMembers = [...new Set([...k.members, ...m.members])];
    const memberStats = allMembers.map(name => {
        const mp = performanceData.filter(d => d.member_name === name);
        return {
            name,
            team: memberTeamMap[name] || '-',
            appoAmount: sum(mp, 'appointment_amount'),
            appoCount: sum(mp, 'appointment_count')
        };
    }).sort((a, b) => b.appoAmount - a.appoAmount);

    document.getElementById('summaryRankingTable').innerHTML = `
        <thead><tr>
            <th class="num">順位</th><th>名前</th><th>チーム</th><th class="num">取得金額</th><th class="num">アポ数</th>
        </tr></thead>
        <tbody>
            ${memberStats.map((s, i) => `<tr>
                <td class="num">${i + 1}</td>
                <td>${escapeHtml(displayName(s.name))}</td>
                <td>${escapeHtml(s.team)}</td>
                <td class="num highlight">${formatYen(s.appoAmount)}</td>
                <td class="num">${s.appoCount}</td>
            </tr>`).join('')}
        </tbody>
    `;
}

// ==================== Team Overview ====================
function renderTeamOverview(teamKey, teamName, ym, members, perf, appo, execAppo, asg) {
    const container = document.getElementById(teamKey + '-overview');
    const bd = getBusinessDays(ym);
    const standardProgress = bd.total > 0 ? Math.round(bd.elapsed / bd.total * 1000) / 10 : 0;

    const callCount = sum(perf, 'call_count');
    const prCount = sum(perf, 'pr_count');
    const appoCount = sum(perf, 'appointment_count');
    const appoAmount = sum(perf, 'appointment_amount');
    const execAmount = execAppo.filter(a => a.status === '実施').reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const execUnconfirmedAmt = execAppo.filter(a => a.status === '未確認').reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const execForecast = execAmount + execUnconfirmedAmt * 0.85;

    const teamTarget = getTarget('team', teamName, ym);
    const appoTarget = teamTarget ? (parseFloat(teamTarget.appointment_amount_target) || 0) : 0;
    const execTarget = teamTarget ? (parseFloat(teamTarget.execution_target) || 0) : 0;
    const achievement = pct(appoAmount, appoTarget);
    const execAchievement = pct(execAmount, execTarget);

    // Team KPI card
    let html = `
        <div class="team-kpi-card">
            <div class="team-kpi-item">
                <div class="tki-label">取得目標</div>
                <div class="tki-value">${formatYen(appoTarget)}</div>
            </div>
            <div class="team-kpi-item">
                <div class="tki-label">取得実績</div>
                <div class="tki-value">${formatYen(appoAmount)}</div>
                <div class="tki-sub">達成率 ${achievement}%</div>
            </div>
            <div class="team-kpi-item">
                <div class="tki-label">実施目標</div>
                <div class="tki-value">${formatYen(execTarget)}</div>
                <div class="tki-sub">0.85換算: ${execTarget > 0 ? formatYen(Math.round(execTarget / 0.85)) : '-'}</div>
            </div>
            <div class="team-kpi-item">
                <div class="tki-label">実施確定</div>
                <div class="tki-value">${formatYen(execAmount)}</div>
                <div class="tki-sub">達成率 ${execAchievement}%</div>
                <div class="tki-sub" style="margin-top:2px;">見込（0.85）: ${formatYen(Math.round(execForecast))}</div>
            </div>
            <div class="team-kpi-item">
                <div class="tki-label">標準進捗</div>
                <div class="tki-value">${standardProgress}%</div>
                <div class="tki-sub">${bd.elapsed}/${bd.total}日</div>
            </div>
        </div>
    `;

    // Member cards
    html += '<div class="member-cards">';
    members.forEach(name => {
        const mp = perf.filter(d => d.member_name === name);
        const mAppoAmt = sum(mp, 'appointment_amount');

        // Member target
        const memberTarget = getTarget('member', name, ym);
        const mTarget = memberTarget ? (parseFloat(memberTarget.appointment_amount_target) || 0) : 0;
        const mExecTarget = memberTarget ? (parseFloat(memberTarget.execution_target) || 0) : 0;
        const mAchievement = pct(mAppoAmt, mTarget);

        const mExecAppo = execAppo.filter(a => a.member_name === name && a.status === '実施');
        const mExecAmount = mExecAppo.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);

        const initials = displayName(name).substring(0, 2);

        html += `
            <div class="member-card">
                <div class="mc-name">
                    <div class="mc-icon">${escapeHtml(initials)}</div>
                    ${escapeHtml(displayName(name))}
                </div>
                <div class="mc-row">
                    <span class="mc-label">取得金額</span>
                    <span class="mc-value">${formatYen(mAppoAmt)}</span>
                </div>
                <div class="mc-row">
                    <span class="mc-label">取得目標</span>
                    <span class="mc-value" style="font-size:0.78rem;color:var(--text-light);">${mTarget > 0 ? formatYen(mTarget) : '-'}</span>
                </div>
                ${mTarget > 0 ? `
                <div class="mc-progress">
                    <div class="progress-bar">
                        <div class="progress-fill ${progressColor(mAchievement)}" style="width:${Math.min(mAchievement, 100)}%"></div>
                    </div>
                    <div style="text-align:right;font-size:0.72rem;color:var(--text-light);margin-top:2px;">${mAchievement}%</div>
                </div>` : ''}
                <div class="mc-divider"></div>
                <div class="mc-row">
                    <span class="mc-label">実施確定</span>
                    <span class="mc-value">${formatYen(mExecAmount)}</span>
                </div>
                <div class="mc-row">
                    <span class="mc-label">実施目標</span>
                    <span class="mc-value" style="font-size:0.78rem;color:var(--text-light);">${mExecTarget > 0 ? formatYen(mExecTarget) : '-'}</span>
                </div>
                ${mExecTarget > 0 ? (() => {
                    const execAchieve = Math.round(mExecAmount / mExecTarget * 1000) / 10;
                    return `
                <div class="mc-progress">
                    <div class="progress-bar">
                        <div class="progress-fill ${progressColor(execAchieve)}" style="width:${Math.min(execAchieve, 100)}%"></div>
                    </div>
                    <div style="text-align:right;font-size:0.72rem;color:var(--text-light);margin-top:2px;">${execAchieve}%</div>
                </div>`;
                })() : ''}
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}

// ==================== Team Appointments ====================
function renderTeamAppointments(teamKey, teamName, ym, members, appo, execAppo) {
    const container = document.getElementById(teamKey + '-appointments');
    const state = appoState[teamKey];

    // Merge and dedup
    const allAppo = deduplicateAppointments([...appo, ...execAppo]);

    // Status counts & amounts
    const statusCounts = { all: allAppo.length, '未確認': 0, '実施': 0, 'リスケ': 0, 'キャンセル': 0 };
    const statusAmounts = { '未確認': 0, '実施': 0, 'リスケ': 0, 'キャンセル': 0 };
    allAppo.forEach(a => {
        if (statusCounts[a.status] !== undefined) {
            statusCounts[a.status]++;
            statusAmounts[a.status] += a.amount || 0;
        }
    });
    const totalAmount = statusAmounts['実施'] + statusAmounts['リスケ'] + statusAmounts['キャンセル'] + statusAmounts['未確認'];
    const total = allAppo.length;

    // Filter
    let filtered = allAppo;
    if (state.filter !== 'all') {
        filtered = filtered.filter(a => a.status === state.filter);
    }
    if (state.search) {
        const q = state.search.toLowerCase();
        filtered = filtered.filter(a =>
            (a.customer_name || '').toLowerCase().includes(q) ||
            (a.project_name || '').toLowerCase().includes(q) ||
            (a.member_name || '').toLowerCase().includes(q)
        );
    }

    // Sort
    filtered.sort((a, b) => {
        let va = a[state.sortKey] || '';
        let vb = b[state.sortKey] || '';
        if (state.sortKey === 'amount') {
            va = parseFloat(va) || 0;
            vb = parseFloat(vb) || 0;
        }
        if (va < vb) return state.sortAsc ? -1 : 1;
        if (va > vb) return state.sortAsc ? 1 : -1;
        return 0;
    });

    const statusBadgeClass = { '未確認': 'unconfirmed', '実施': 'executed', 'リスケ': 'rescheduled', 'キャンセル': 'cancelled' };

    function sortIcon(key) {
        const active = state.sortKey === key;
        const arrow = active ? (state.sortAsc ? '\u25B2' : '\u25BC') : '\u25BC';
        return `<span class="sort-icon ${active ? 'active' : ''}">${arrow}</span>`;
    }

    const execRate = total > 0 ? (statusCounts['実施'] / total * 100).toFixed(1) : '0.0';
    const rescheduleRate = total > 0 ? (statusCounts['リスケ'] / total * 100).toFixed(1) : '0.0';
    const cancelRate = total > 0 ? (statusCounts['キャンセル'] / total * 100).toFixed(1) : '0.0';
    const unconfirmedRate = total > 0 ? (statusCounts['未確認'] / total * 100).toFixed(1) : '0.0';

    let html = `
        <div class="appo-summary-bar">
            <div class="appo-summary-item">
                <span style="color:var(--text-light);">全体</span>
                <span class="asi-count">${statusCounts.all}</span>
            </div>
            <div class="appo-summary-item">
                <span class="status-badge unconfirmed">未確認</span>
                <span class="asi-count">${statusCounts['未確認']}</span>
            </div>
            <div class="appo-summary-item">
                <span class="status-badge executed">実施</span>
                <span class="asi-count">${statusCounts['実施']}</span>
            </div>
            <div class="appo-summary-item">
                <span class="status-badge rescheduled">リスケ</span>
                <span class="asi-count">${statusCounts['リスケ']}</span>
            </div>
            <div class="appo-summary-item">
                <span class="status-badge cancelled">キャンセル</span>
                <span class="asi-count">${statusCounts['キャンセル']}</span>
            </div>
        </div>

        <div class="appo-amount-summary" style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:12px 0;">
            <div style="background:var(--bg-light,#f8f9fa);border-radius:8px;padding:10px 12px;text-align:center;">
                <div style="font-size:0.7rem;color:var(--text-muted,#999);">総金額</div>
                <div style="font-size:0.95rem;font-weight:700;">${formatYen(totalAmount)}</div>
                <div style="font-size:0.7rem;color:var(--text-muted,#999);">${total}件</div>
            </div>
            <div style="background:var(--bg-light,#f8f9fa);border-radius:8px;padding:10px 12px;text-align:center;">
                <div style="font-size:0.7rem;color:#2563eb;">実施確定</div>
                <div style="font-size:0.95rem;font-weight:700;color:#2563eb;">${formatYen(statusAmounts['実施'])}</div>
                <div style="font-size:0.7rem;color:var(--text-muted,#999);">${statusCounts['実施']}件 (${execRate}%)</div>
            </div>
            <div style="background:var(--bg-light,#f8f9fa);border-radius:8px;padding:10px 12px;text-align:center;">
                <div style="font-size:0.7rem;color:#a16207;">リスケ</div>
                <div style="font-size:0.95rem;font-weight:700;color:#a16207;">${formatYen(statusAmounts['リスケ'])}</div>
                <div style="font-size:0.7rem;color:var(--text-muted,#999);">${statusCounts['リスケ']}件 (${rescheduleRate}%)</div>
            </div>
            <div style="background:var(--bg-light,#f8f9fa);border-radius:8px;padding:10px 12px;text-align:center;">
                <div style="font-size:0.7rem;color:#dc2626;">キャンセル</div>
                <div style="font-size:0.95rem;font-weight:700;color:#dc2626;">${formatYen(statusAmounts['キャンセル'])}</div>
                <div style="font-size:0.7rem;color:var(--text-muted,#999);">${statusCounts['キャンセル']}件 (${cancelRate}%)</div>
            </div>
            <div style="background:var(--bg-light,#f8f9fa);border-radius:8px;padding:10px 12px;text-align:center;">
                <div style="font-size:0.7rem;color:#6b7280;">未確認</div>
                <div style="font-size:0.95rem;font-weight:700;color:#6b7280;">${formatYen(statusAmounts['未確認'])}</div>
                <div style="font-size:0.7rem;color:var(--text-muted,#999);">${statusCounts['未確認']}件 (${unconfirmedRate}%)</div>
            </div>
        </div>

        <div class="appo-filters">
            <div class="filter-tabs">
                ${['all', '未確認', '実施', 'リスケ', 'キャンセル'].map(s => {
                    const label = s === 'all' ? '全て' : s;
                    const count = s === 'all' ? statusCounts.all : statusCounts[s];
                    return `<button class="filter-tab ${state.filter === s ? 'active' : ''}" onclick="setAppoFilter('${teamKey}','${s}')">${label}<span class="badge">${count}</span></button>`;
                }).join('')}
            </div>
            <input type="text" class="search-input" placeholder="検索..." value="${escapeHtml(state.search)}" oninput="setAppoSearch('${teamKey}', this.value)">
        </div>

        <div class="card">
            <div class="card-body no-pad table-scroll">
                <table class="data-table">
                    <thead><tr>
                        <th class="sortable" onclick="setAppoSort('${teamKey}','acquisition_date')">取得日${sortIcon('acquisition_date')}</th>
                        <th class="sortable" onclick="setAppoSort('${teamKey}','member_name')">担当者${sortIcon('member_name')}</th>
                        <th class="sortable" onclick="setAppoSort('${teamKey}','project_name')">案件名${sortIcon('project_name')}</th>
                        <th>顧客名</th>
                        <th class="sortable" onclick="setAppoSort('${teamKey}','scheduled_date')">実施予定日${sortIcon('scheduled_date')}</th>
                        <th class="sortable num" onclick="setAppoSort('${teamKey}','amount')">金額${sortIcon('amount')}</th>
                        <th>ステータス</th>
                        <th>操作</th>
                    </tr></thead>
                    <tbody>
    `;

    if (filtered.length === 0) {
        html += '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px;">データなし</td></tr>';
    } else {
        filtered.forEach(a => {
            const badgeCls = statusBadgeClass[a.status] || '';
            const actions = a.status === '未確認'
                ? `<div class="appo-actions">
                    <button class="btn btn-sm btn-success" onclick="updateAppoStatus('${a.id}','実施','${teamKey}')">実施</button>
                    <button class="btn btn-sm btn-warning" onclick="updateAppoStatus('${a.id}','リスケ','${teamKey}')">リスケ</button>
                    <button class="btn btn-sm btn-danger" onclick="updateAppoStatus('${a.id}','キャンセル','${teamKey}')">取消</button>
                  </div>`
                : `<div class="appo-actions">
                    <button class="btn btn-sm btn-secondary" onclick="updateAppoStatus('${a.id}','未確認','${teamKey}')">戻す</button>
                  </div>`;

            html += `<tr>
                <td style="white-space:nowrap;">${a.acquisition_date || '-'}</td>
                <td>${escapeHtml(displayName(a.member_name))}</td>
                <td>${escapeHtml(a.project_name)}</td>
                <td>${escapeHtml(a.customer_name)}</td>
                <td style="white-space:nowrap;">${a.scheduled_date || '-'}</td>
                <td class="num">${formatYen(a.amount)}</td>
                <td><span class="status-badge ${badgeCls}">${a.status}</span></td>
                <td>${actions}</td>
            </tr>`;
        });
    }

    html += '</tbody></table></div></div>';
    container.innerHTML = html;
}

function setAppoFilter(teamKey, filter) {
    appoState[teamKey].filter = filter;
    renderTeamSubTab(teamKey, 'appointments');
}

function setAppoSearch(teamKey, value) {
    appoState[teamKey].search = value;
    renderTeamSubTab(teamKey, 'appointments');
}

function setAppoSort(teamKey, key) {
    if (appoState[teamKey].sortKey === key) {
        appoState[teamKey].sortAsc = !appoState[teamKey].sortAsc;
    } else {
        appoState[teamKey].sortKey = key;
        appoState[teamKey].sortAsc = true;
    }
    renderTeamSubTab(teamKey, 'appointments');
}

async function updateAppoStatus(id, newStatus, teamKey) {
    try {
        await executeTurso("UPDATE appointments SET status = ?, confirmation_date = datetime('now'), confirmed_by = 'dashboard' WHERE id = ?", [newStatus, id]);

        // Update local data
        [appointmentsData, executionAppoData].forEach(arr => {
            const found = arr.find(a => a.id === id);
            if (found) found.status = newStatus;
        });

        showToast(`ステータスを「${newStatus}」に更新しました`);
        renderTeamSubTab(teamKey, 'appointments');
    } catch (e) {
        showToast('更新に失敗しました: ' + e.message, true);
    }
}

// ==================== Team Projects ====================
function renderTeamProjects(teamKey, teamName, ym, members, perf, asg) {
    const container = document.getElementById(teamKey + '-projects');

    // Active projects (those with assignments for this team)
    const projectNames = [...new Set(asg.map(a => a.project_name))];
    const activeProjects = projectsData.filter(p => projectNames.includes(p.project_name));

    let html = '';

    // New assignment button
    html += `<div style="margin-bottom:16px;">
        <button class="btn btn-primary" onclick="openAssignmentModal('${teamKey}')">
            + 新規アサインメント
        </button>
    </div>`;

    // Project cards
    if (activeProjects.length > 0) {
        html += '<div class="project-cards">';
        activeProjects.forEach(p => {
            const pAsg = asg.filter(a => a.project_name === p.project_name);
            const pPerf = perf.filter(d => d.project_name === p.project_name);
            const totalAppoAmt = sum(pPerf, 'appointment_amount');
            const capAmount = p.monthly_cap_amount || 0;
            const capProgress = capAmount > 0 ? pct(totalAppoAmt, capAmount) : 0;

            html += `
                <div class="project-card">
                    <div class="pc-header">
                        <div>
                            <div class="pc-name">${escapeHtml(p.project_name)}</div>
                            <div class="pc-client">${escapeHtml(p.client_name || '')}</div>
                        </div>
                    </div>
                    <div class="pc-row">
                        <span class="pc-label">単価</span>
                        <span class="pc-value">${formatYen(p.unit_price)}</span>
                    </div>
                    <div class="pc-row">
                        <span class="pc-label">キャップ</span>
                        <span class="pc-value">${capAmount > 0 ? formatYen(capAmount) : '-'}</span>
                    </div>
                    <div class="pc-row">
                        <span class="pc-label">実績</span>
                        <span class="pc-value">${formatYen(totalAppoAmt)}</span>
                    </div>
                    ${capAmount > 0 ? `
                    <div style="margin-top:8px;">
                        <div class="progress-bar">
                            <div class="progress-fill ${progressColor(capProgress)}" style="width:${Math.min(capProgress, 100)}%"></div>
                        </div>
                        <div style="text-align:right;font-size:0.72rem;color:var(--text-light);margin-top:2px;">${capProgress}%</div>
                    </div>` : ''}
                </div>
            `;
        });
        html += '</div>';
    }

    // Assignment table
    html += `
        <div class="card">
            <div class="card-header"><h2>アサインメント一覧</h2></div>
            <div class="card-body no-pad table-scroll">
                <table class="data-table">
                    <thead><tr>
                        <th>案件名</th><th>タイプ</th><th>客先CP</th><th>メンバー</th>
                        <th class="num">キャップ数</th><th class="num">キャップ金額</th><th class="num">目標数</th>
                        <th class="num">架電数</th><th class="num">PR数</th><th class="num">アポ数</th>
                        <th class="num">架toPR</th><th class="num">PRtoア</th><th class="num">架toア</th>
                        <th class="num">確定金額</th><th>シート</th><th>操作</th>
                    </tr></thead>
                    <tbody>
    `;

    if (asg.length === 0) {
        html += '<tr><td colspan="16" style="text-align:center;color:var(--text-muted);padding:24px;">アサインメントなし</td></tr>';
    } else {
        asg.forEach(a => {
            const mPerf = perf.filter(d => d.member_name === a.member_name && d.project_name === a.project_name);
            const calls = sum(mPerf, 'call_count');
            const prs = sum(mPerf, 'pr_count');
            const appos = sum(mPerf, 'appointment_count');
            const amount = sum(mPerf, 'appointment_amount');
            const ctop = calls > 0 ? (prs / calls * 100) : 0;
            const ptoa = prs > 0 ? (appos / prs * 100) : 0;
            const ctoa = calls > 0 ? (appos / calls * 100) : 0;

            html += `<tr>
                <td>${escapeHtml(a.project_name)}</td>
                <td>${escapeHtml(a.project_type || '-')}</td>
                <td>${escapeHtml(a.pm_name || '-')}</td>
                <td>${escapeHtml(displayName(a.member_name))}</td>
                <td class="num">${a.cap_count || '-'}</td>
                <td class="num">${a.cap_amount ? formatYen(a.cap_amount) : '-'}</td>
                <td class="num">${a.target_count || '-'}</td>
                <td class="num">${formatNum(calls)}</td>
                <td class="num">${formatNum(prs)}</td>
                <td class="num">${formatNum(appos)}</td>
                <td class="num ${yieldClass(ctop, 15)}">${formatPct(ctop)}</td>
                <td class="num ${yieldClass(ptoa, 30)}">${formatPct(ptoa)}</td>
                <td class="num ${yieldClass(ctoa, 3)}">${formatPct(ctoa)}</td>
                <td class="num highlight">${formatYen(amount)}</td>
                <td>${a.sheet_url ? `<a href="${escapeHtml(a.sheet_url)}" target="_blank" style="color:var(--primary-blue);font-size:0.78rem;">開く</a>` : '-'}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" onclick="editAssignment('${a.id}','${teamKey}')">編集</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteAssignment('${a.id}','${teamKey}')">削除</button>
                </td>
            </tr>`;
        });
    }

    html += '</tbody></table></div></div>';
    container.innerHTML = html;
}

// ==================== Assignment CRUD ====================
function openAssignmentModal(teamKey) {
    editingAssignmentId = null;
    editingAssignmentTeam = teamKey;
    document.getElementById('assignmentModalTitle').textContent = 'アサインメント追加';

    const ym = getSelectedMonth();
    const teamName = TEAM_CONFIG[teamKey].teamName;
    const members = getTeamMembersForMonth(teamName, ym);

    // Populate dropdowns
    const memberSel = document.getElementById('asgMember');
    memberSel.innerHTML = members.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(displayName(m))}</option>`).join('');

    const projSel = document.getElementById('asgProject');
    projSel.innerHTML = projectsData.map(p => `<option value="${escapeHtml(p.project_name)}">${escapeHtml(p.project_name)}</option>`).join('');

    // Clear fields
    document.getElementById('asgType').value = 'メイン';
    document.getElementById('asgPm').value = '';
    document.getElementById('asgCapCount').value = '';
    document.getElementById('asgCapAmount').value = '';
    document.getElementById('asgTargetCount').value = '';
    document.getElementById('asgSheetUrl').value = '';

    document.getElementById('assignmentModal').classList.remove('hidden');
}

function editAssignment(id, teamKey) {
    const a = assignmentsData.find(x => x.id === id);
    if (!a) return;
    editingAssignmentId = id;
    editingAssignmentTeam = teamKey;
    document.getElementById('assignmentModalTitle').textContent = 'アサインメント編集';

    const ym = getSelectedMonth();
    const teamName = TEAM_CONFIG[teamKey].teamName;
    const members = getTeamMembersForMonth(teamName, ym);

    const memberSel = document.getElementById('asgMember');
    memberSel.innerHTML = members.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(displayName(m))}</option>`).join('');
    memberSel.value = a.member_name;

    const projSel = document.getElementById('asgProject');
    projSel.innerHTML = projectsData.map(p => `<option value="${escapeHtml(p.project_name)}">${escapeHtml(p.project_name)}</option>`).join('');
    projSel.value = a.project_name;

    document.getElementById('asgType').value = a.project_type || 'メイン';
    document.getElementById('asgPm').value = a.pm_name || '';
    document.getElementById('asgCapCount').value = a.cap_count || '';
    document.getElementById('asgCapAmount').value = a.cap_amount || '';
    document.getElementById('asgTargetCount').value = a.target_count || '';
    document.getElementById('asgSheetUrl').value = a.sheet_url || '';

    document.getElementById('assignmentModal').classList.remove('hidden');
}

async function saveAssignment() {
    const ym = getSelectedMonth();
    const member = document.getElementById('asgMember').value;
    const project = document.getElementById('asgProject').value;
    const type = document.getElementById('asgType').value;
    const pm = document.getElementById('asgPm').value;
    const capCount = document.getElementById('asgCapCount').value || null;
    const capAmount = document.getElementById('asgCapAmount').value || null;
    const targetCount = document.getElementById('asgTargetCount').value || null;
    const sheetUrl = document.getElementById('asgSheetUrl').value || null;

    try {
        if (editingAssignmentId) {
            await executeTurso(
                `UPDATE project_member_assignments SET member_name=?, project_name=?, project_type=?, pm_name=?, cap_count=?, cap_amount=?, target_count=?, sheet_url=? WHERE id=?`,
                [member, project, type, pm, capCount, capAmount, targetCount, sheetUrl, editingAssignmentId]
            );
            showToast('アサインメントを更新しました');
        } else {
            await executeTurso(
                `INSERT INTO project_member_assignments (member_name, project_name, year_month, project_type, pm_name, cap_count, cap_amount, target_count, sheet_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [member, project, ym, type, pm, capCount, capAmount, targetCount, sheetUrl]
            );
            showToast('アサインメントを追加しました');
        }
        closeModal('assignmentModal');
        await loadMonthData();
    } catch (e) {
        showToast('保存に失敗しました: ' + e.message, true);
    }
}

async function deleteAssignment(id, teamKey) {
    if (!confirm('このアサインメントを削除しますか？')) return;
    try {
        await executeTurso("DELETE FROM project_member_assignments WHERE id = ?", [id]);
        showToast('アサインメントを削除しました');
        await loadMonthData();
    } catch (e) {
        showToast('削除に失敗しました: ' + e.message, true);
    }
}

// ==================== Team Analysis ====================
function renderTeamAnalysis(teamKey, teamName, ym, members, perf, appo, execAppo) {
    const container = document.getElementById(teamKey + '-analysis');
    const state = analysisState[teamKey];

    const callCount = sum(perf, 'call_count');
    const prCount = sum(perf, 'pr_count');
    const appoCount = sum(perf, 'appointment_count');
    const execCount = execAppo.filter(a => a.status === '実施').length;
    const allAppo = deduplicateAppointments([...appo, ...execAppo]);

    const callToPr = callCount > 0 ? prCount / callCount * 100 : 0;
    const prToAppo = prCount > 0 ? appoCount / prCount * 100 : 0;
    const callToAppo = callCount > 0 ? appoCount / callCount * 100 : 0;
    const appoToExec = allAppo.length > 0 ? execCount / allAppo.length * 100 : 0;

    let html = '';

    // Funnel
    html += `
        <div class="card">
            <div class="card-header"><h2>歩留まりファネル</h2></div>
            <div class="card-body">
                <div class="funnel">
                    <div class="funnel-step" style="background:var(--blue-50);">
                        <div class="fs-value">${formatNum(callCount)}</div>
                        <div class="fs-label">架電</div>
                    </div>
                    <div class="funnel-arrow">\u2192</div>
                    <div class="funnel-step" style="background:var(--info-light);">
                        <div class="fs-value">${formatNum(prCount)}</div>
                        <div class="fs-label">PR</div>
                        <div class="funnel-rate">${formatPct(callToPr)}</div>
                    </div>
                    <div class="funnel-arrow">\u2192</div>
                    <div class="funnel-step" style="background:var(--success-light);">
                        <div class="fs-value">${formatNum(appoCount)}</div>
                        <div class="fs-label">アポ</div>
                        <div class="funnel-rate">${formatPct(prToAppo)}</div>
                    </div>
                    <div class="funnel-arrow">\u2192</div>
                    <div class="funnel-step" style="background:var(--warning-light);">
                        <div class="fs-value">${formatNum(execCount)}</div>
                        <div class="fs-label">実施</div>
                        <div class="funnel-rate">${formatPct(appoToExec)}</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Member yield table
    html += `
        <div class="card">
            <div class="card-header"><h2>メンバー別歩留まり</h2></div>
            <div class="card-body no-pad table-scroll">
                <table class="data-table">
                    <thead><tr>
                        <th>メンバー</th>
                        <th class="num">架電</th><th class="num">PR</th><th class="num">アポ</th>
                        <th class="num">架toPR</th><th class="num">PRtoアポ</th><th class="num">架toアポ</th>
                        <th class="num">取得金額</th>
                    </tr></thead>
                    <tbody>
    `;

    members.forEach(name => {
        const mp = perf.filter(d => d.member_name === name);
        const c = sum(mp, 'call_count');
        const p = sum(mp, 'pr_count');
        const a = sum(mp, 'appointment_count');
        const amt = sum(mp, 'appointment_amount');
        const ctp = c > 0 ? p / c * 100 : 0;
        const pta = p > 0 ? a / p * 100 : 0;
        const cta = c > 0 ? a / c * 100 : 0;

        html += `<tr>
            <td>${escapeHtml(displayName(name))}</td>
            <td class="num">${formatNum(c)}</td>
            <td class="num">${formatNum(p)}</td>
            <td class="num">${formatNum(a)}</td>
            <td class="num ${yieldClass(ctp, 15)}">${formatPct(ctp)}</td>
            <td class="num ${yieldClass(pta, 30)}">${formatPct(pta)}</td>
            <td class="num ${yieldClass(cta, 3)}">${formatPct(cta)}</td>
            <td class="num highlight">${formatYen(amt)}</td>
        </tr>`;
    });

    html += `
                    </tbody>
                    <tfoot><tr style="font-weight:600;background:var(--gray-100);">
                        <td>合計</td>
                        <td class="num">${formatNum(callCount)}</td>
                        <td class="num">${formatNum(prCount)}</td>
                        <td class="num">${formatNum(appoCount)}</td>
                        <td class="num">${formatPct(callToPr)}</td>
                        <td class="num">${formatPct(prToAppo)}</td>
                        <td class="num">${formatPct(callToAppo)}</td>
                        <td class="num">${formatYen(sum(perf, 'appointment_amount'))}</td>
                    </tr></tfoot>
                </table>
            </div>
        </div>
    `;

    // Baselines legend
    html += `
        <div class="alert alert-info" style="font-size:0.8rem;">
            基準値: 架toPR \u226515%, PRtoアポ \u226530%, 架toアポ \u22653% &mdash;
            <span class="yield-good">達成</span> / <span class="yield-warn">注意</span> / <span class="yield-bad">要改善</span>
        </div>
    `;

    // Diagnosis
    html += '<div class="card"><div class="card-header"><h2>診断・改善示唆</h2></div><div class="card-body"><ul class="diagnosis-list">';
    const diagnoses = [];

    if (callToPr < 15 * 0.7) {
        diagnoses.push({ icon: '\u26A0\uFE0F', text: `架電toPR率が${formatPct(callToPr)}と低水準です。トークスクリプトの見直しやロープレを推奨します。` });
    } else if (callToPr < 15) {
        diagnoses.push({ icon: '\u{1F4A1}', text: `架電toPR率${formatPct(callToPr)} - 基準の15%まであと少しです。受付突破率を意識しましょう。` });
    }

    if (prToAppo < 30 * 0.7) {
        diagnoses.push({ icon: '\u26A0\uFE0F', text: `PRtoアポ率が${formatPct(prToAppo)}と低水準です。クロージングトークの改善が必要です。` });
    } else if (prToAppo < 30) {
        diagnoses.push({ icon: '\u{1F4A1}', text: `PRtoアポ率${formatPct(prToAppo)} - 基準の30%まであと少し。ヒアリング強化を。` });
    }

    if (callToAppo < 3 * 0.7) {
        diagnoses.push({ icon: '\u26A0\uFE0F', text: `架電toアポ率${formatPct(callToAppo)}が低いです。全体的なアプローチ改善が急務です。` });
    }

    // Profitability alert per project
    const projectPriceMap = {};
    projectsData.forEach(p => { projectPriceMap[p.project_name] = p.unit_price || 0; });
    const projectNames = [...new Set(perf.map(d => d.project_name))];
    projectNames.forEach(pn => {
        const pp = perf.filter(d => d.project_name === pn);
        const pc = sum(pp, 'call_count');
        const pa = sum(pp, 'appointment_count');
        const pcta = pc > 0 ? pa / pc : 0;
        const unitPrice = projectPriceMap[pn] || 0;
        if (unitPrice * pcta < 7 && pc > 50) {
            diagnoses.push({ icon: '\u{1F6A8}', text: `「${pn}」の収益性アラート: 単価${formatYen(unitPrice)} x 架toアポ${formatPct(pcta * 100)} = ${(unitPrice * pcta).toFixed(1)} < 7` });
        }
    });

    if (diagnoses.length === 0) {
        diagnoses.push({ icon: '\u2705', text: '現在アラートはありません。全指標が基準値以上です。' });
    }

    diagnoses.forEach(d => {
        html += `<li><span class="diagnosis-icon">${d.icon}</span><span>${d.text}</span></li>`;
    });
    html += '</ul></div></div>';

    // Trend chart
    html += `
        <div class="card">
            <div class="card-header">
                <h2>トレンド</h2>
                <div class="chart-toggles">
                    ${['calls', 'pr', 'appo', 'amount'].map(t => {
                        const labels = { calls: '架電', pr: 'PR', appo: 'アポ', amount: '金額' };
                        return `<button class="chart-toggle ${state.chartType === t ? 'active' : ''}" onclick="setAnalysisChart('${teamKey}','${t}')">${labels[t]}</button>`;
                    }).join('')}
                </div>
            </div>
            <div class="card-body">
                <div class="chart-container">
                    <canvas id="chart-${teamKey}"></canvas>
                </div>
            </div>
        </div>
    `;

    // Daily data table
    const dates = [...new Set(perf.map(d => d.input_date))].sort();
    html += `
        <div class="card">
            <div class="card-header"><h2>日次データ</h2></div>
            <div class="card-body no-pad table-scroll">
                <table class="data-table">
                    <thead><tr>
                        <th>日付</th><th class="num">架電</th><th class="num">PR</th><th class="num">アポ</th><th class="num">金額</th><th class="num">架toPR</th><th class="num">架toアポ</th>
                    </tr></thead>
                    <tbody>
    `;

    dates.forEach(date => {
        const dp = perf.filter(d => d.input_date === date);
        const dc = sum(dp, 'call_count');
        const dpr = sum(dp, 'pr_count');
        const da = sum(dp, 'appointment_count');
        const damt = sum(dp, 'appointment_amount');
        html += `<tr>
            <td>${date}</td>
            <td class="num">${formatNum(dc)}</td>
            <td class="num">${formatNum(dpr)}</td>
            <td class="num">${formatNum(da)}</td>
            <td class="num">${formatYen(damt)}</td>
            <td class="num">${dc > 0 ? formatPct(dpr / dc * 100) : '-'}</td>
            <td class="num">${dc > 0 ? formatPct(da / dc * 100) : '-'}</td>
        </tr>`;
    });

    html += '</tbody></table></div></div>';

    container.innerHTML = html;

    // Render chart
    renderAnalysisChart(teamKey, perf, state.chartType);
}

function setAnalysisChart(teamKey, type) {
    analysisState[teamKey].chartType = type;
    renderTeamSubTab(teamKey, 'analysis');
}

function renderAnalysisChart(teamKey, perf, chartType) {
    const canvasId = 'chart-' + teamKey;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // Destroy old chart
    if (charts[canvasId]) {
        charts[canvasId].destroy();
    }

    const dates = [...new Set(perf.map(d => d.input_date))].sort();
    const keyMap = { calls: 'call_count', pr: 'pr_count', appo: 'appointment_count', amount: 'appointment_amount' };
    const labelMap = { calls: '架電数', pr: 'PR数', appo: 'アポ数', amount: '取得金額' };
    const colorMap = { calls: '#1155cc', pr: '#00a2da', appo: '#22c55e', amount: '#f59e0b' };
    const dataKey = keyMap[chartType];

    const values = dates.map(date => {
        const dp = perf.filter(d => d.input_date === date);
        return sum(dp, dataKey);
    });

    // Cumulative
    const cumulative = [];
    let runningTotal = 0;
    values.forEach(v => { runningTotal += v; cumulative.push(runningTotal); });

    charts[canvasId] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: dates.map(d => d.substring(5)),
            datasets: [
                {
                    type: 'bar',
                    label: labelMap[chartType] + '（日次）',
                    data: values,
                    backgroundColor: colorMap[chartType] + '40',
                    borderColor: colorMap[chartType],
                    borderWidth: 1,
                    yAxisID: 'y'
                },
                {
                    type: 'line',
                    label: labelMap[chartType] + '（累計）',
                    data: cumulative,
                    borderColor: colorMap[chartType],
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: 2,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            const v = ctx.raw;
                            return ctx.dataset.label + ': ' + (chartType === 'amount' ? formatYen(v) : formatNum(v));
                        }
                    }
                }
            },
            scales: {
                y: { position: 'left', beginAtZero: true, title: { display: true, text: '日次' } },
                y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: '累計' } }
            }
        }
    });
}

// ==================== Settings Modal ====================
function openSettingsModal() {
    document.getElementById('settingsModal').classList.remove('hidden');
    switchSettingsTab('teamTargets');
}

function switchSettingsTab(tab) {
    currentSettingsTab = tab;
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    const active = document.querySelector(`.settings-tab[data-tab="${tab}"]`) || document.querySelector(`.settings-tab[onclick*="${tab}"]`);
    if (active) active.classList.add('active');
    renderSettingsContent();
}

function renderSettingsContent() {
    const container = document.getElementById('settingsContent');
    const ym = getSelectedMonth();

    if (currentSettingsTab === 'teamTargets') {
        renderTeamTargetsSettings(container, ym);
    } else if (currentSettingsTab === 'memberTargets') {
        renderMemberTargetsSettings(container, ym);
    } else if (currentSettingsTab === 'memberMgmt') {
        renderMemberMgmtSettings(container);
    }
}

function renderTeamTargetsSettings(container, ym) {
    const teams = ['菊池Team', '三善Team'];
    let html = `<p style="font-size:0.8rem;color:var(--text-light);margin-bottom:12px;">${ym} のチーム目標</p>`;

    teams.forEach(teamName => {
        const target = getTarget('team', teamName, ym);
        const appoTarget = target ? target.appointment_amount_target || '' : '';
        const execTarget = target ? target.execution_target || '' : '';

        html += `
            <div style="margin-bottom:16px;padding:12px;background:var(--gray-100);border-radius:8px;">
                <strong>${teamName}</strong>
                <div class="form-row" style="margin-top:8px;">
                    <div class="form-group">
                        <label>取得目標（円）</label>
                        <input type="number" id="tt-appo-${safeId(teamName)}" value="${appoTarget}">
                    </div>
                    <div class="form-group">
                        <label>実施目標（円）</label>
                        <input type="number" id="tt-exec-${safeId(teamName)}" value="${execTarget}">
                    </div>
                </div>
            </div>
        `;
    });

    html += `<button class="btn btn-primary" onclick="saveTeamTargets()">保存</button>`;
    container.innerHTML = html;
}

async function saveTeamTargets() {
    const ym = getSelectedMonth();
    const teams = ['菊池Team', '三善Team'];

    try {
        for (const teamName of teams) {
            const appoTarget = document.getElementById('tt-appo-' + safeId(teamName)).value || 0;
            const execTarget = document.getElementById('tt-exec-' + safeId(teamName)).value || 0;

            await executeTurso(
                `INSERT INTO targets (target_type, target_name, year_month, appointment_amount_target, execution_target)
                 VALUES ('team', ?, ?, ?, ?)
                 ON CONFLICT(target_type, target_name, year_month)
                 DO UPDATE SET appointment_amount_target = ?, execution_target = ?`,
                [teamName, ym, appoTarget, execTarget, appoTarget, execTarget]
            );
        }
        showToast('チーム目標を保存しました');
        await loadMonthData();
    } catch (e) {
        showToast('保存に失敗しました: ' + e.message, true);
    }
}

function renderMemberTargetsSettings(container, ym) {
    const teams = ['菊池Team', '三善Team'];
    let html = `<p style="font-size:0.8rem;color:var(--text-light);margin-bottom:12px;">${ym} のメンバー目標</p>`;

    teams.forEach(teamName => {
        const members = getTeamMembersForMonth(teamName, ym);
        html += `<h4 style="margin:12px 0 8px;">${teamName}</h4>`;
        members.forEach(name => {
            const target = getTarget('member', name, ym);
            const appoTarget = target ? target.appointment_amount_target || '' : '';
            const execTarget = target ? target.execution_target || '' : '';

            html += `
                <div class="form-row" style="margin-bottom:6px;align-items:flex-end;">
                    <div style="min-width:80px;font-size:0.85rem;font-weight:500;padding-bottom:8px;">${displayName(name)}</div>
                    <div class="form-group" style="margin-bottom:0;">
                        <label style="font-size:0.72rem;">取得目標</label>
                        <input type="number" id="mt-appo-${safeId(name)}" value="${appoTarget}" style="padding:5px 8px;font-size:0.82rem;">
                    </div>
                    <div class="form-group" style="margin-bottom:0;">
                        <label style="font-size:0.72rem;">実施目標</label>
                        <input type="number" id="mt-exec-${safeId(name)}" value="${execTarget}" style="padding:5px 8px;font-size:0.82rem;">
                    </div>
                </div>
            `;
        });
    });

    html += `<button class="btn btn-primary" style="margin-top:12px;" onclick="saveMemberTargets()">保存</button>`;
    container.innerHTML = html;
}

async function saveMemberTargets() {
    const ym = getSelectedMonth();
    const allMembers = [...getTeamMembersForMonth('菊池Team', ym), ...getTeamMembersForMonth('三善Team', ym)];

    try {
        for (const name of allMembers) {
            const appoEl = document.getElementById('mt-appo-' + safeId(name));
            const execEl = document.getElementById('mt-exec-' + safeId(name));
            if (!appoEl) continue;
            const appoTarget = appoEl.value || 0;
            const execTarget = execEl ? execEl.value || 0 : 0;

            await executeTurso(
                `INSERT INTO targets (target_type, target_name, year_month, appointment_amount_target, execution_target)
                 VALUES ('member', ?, ?, ?, ?)
                 ON CONFLICT(target_type, target_name, year_month)
                 DO UPDATE SET appointment_amount_target = ?, execution_target = ?`,
                [name, ym, appoTarget, execTarget, appoTarget, execTarget]
            );
        }
        showToast('メンバー目標を保存しました');
        await loadMonthData();
    } catch (e) {
        showToast('保存に失敗しました: ' + e.message, true);
    }
}

function renderMemberMgmtSettings(container) {
    let html = `
        <p style="font-size:0.8rem;color:var(--text-light);margin-bottom:12px;">アクティブメンバー一覧</p>
        <table class="data-table">
            <thead><tr><th>名前</th><th>表示名</th><th>チーム</th><th>操作</th></tr></thead>
            <tbody>
    `;

    membersData.forEach(m => {
        html += `<tr>
            <td>${escapeHtml(m.member_name)}</td>
            <td>${escapeHtml(m.display_name || m.member_name)}</td>
            <td>${escapeHtml(m.team_name || '-')}</td>
            <td><button class="btn btn-sm btn-danger" onclick="toggleMemberStatus('${m.member_name}','inactive')">無効化</button></td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

async function toggleMemberStatus(name, newStatus) {
    if (!confirm(`${displayName(name)}を${newStatus === 'inactive' ? '無効' : '有効'}にしますか？`)) return;
    try {
        await executeTurso("UPDATE members SET status = ? WHERE member_name = ?", [newStatus, name]);
        showToast(`${displayName(name)}を${newStatus === 'inactive' ? '無効化' : '有効化'}しました`);
        await loadAllData();
        renderSettingsContent();
    } catch (e) {
        showToast('更新に失敗しました: ' + e.message, true);
    }
}

// ==================== Feedback ====================
const FEEDBACK_GAS_URL = 'https://script.google.com/macros/s/AKfycbwv2aCYMB7z7OHxqVArBnuyDPCj1-VB9-gBBvXjvw76kGxfcvq1VjzLgxMdJMGdOZJp/exec';
const FEEDBACK_SLACK_CHANNEL = 'C0ACA4Q05PB';
const FEEDBACK_MENTION_IDS = ['U043X21F2GL', 'U06DWC2HFBN'];

function openFeedbackModal() {
    document.getElementById('feedbackModal').classList.remove('hidden');
    document.getElementById('feedbackType').value = 'バグ報告';
    document.getElementById('feedbackTitle').value = '';
    document.getElementById('feedbackDetail').value = '';
    document.getElementById('feedbackSubmitBtn').disabled = false;

    const sel = document.getElementById('feedbackReporter');
    sel.innerHTML = '<option value="">選択してください</option>';
    membersData.forEach(m => {
        sel.innerHTML += `<option value="${escapeHtml(m.member_name)}">${escapeHtml(displayName(m.member_name))}</option>`;
    });
}

async function submitFeedback() {
    const type = document.getElementById('feedbackType').value;
    const reporter = document.getElementById('feedbackReporter').value;
    const title = document.getElementById('feedbackTitle').value.trim();
    const detail = document.getElementById('feedbackDetail').value.trim();

    if (!reporter || !title) {
        showToast('報告者とタイトルは必須です', true);
        return;
    }

    const btn = document.getElementById('feedbackSubmitBtn');
    btn.disabled = true;
    btn.textContent = '送信中...';

    try {
        // Save to DB
        await executeTurso(
            "INSERT INTO feedback_requests (id, type, title, detail, reporter, status, created_at) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, 'open', datetime('now'))",
            [type, title, detail, reporter]
        );

        // Send to Slack via GAS
        const mentions = FEEDBACK_MENTION_IDS.map(id => `<@${id}>`).join(' ');
        const slackText = `${mentions}\n*[${type}]* ${title}\n報告者: ${displayName(reporter)}\n${detail ? '詳細: ' + detail : ''}`;

        try {
            await fetch(FEEDBACK_GAS_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'sendSlackFeedback',
                    channel: FEEDBACK_SLACK_CHANNEL,
                    text: slackText
                })
            });
        } catch (slackErr) {
            console.warn('Slack notification failed:', slackErr);
        }

        showToast('フィードバックを送信しました');
        closeModal('feedbackModal');
    } catch (e) {
        showToast('送信に失敗しました: ' + e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = '送信';
    }
}

// ==================== 稼働報酬Team ====================
const KADOU_GAS_URL = 'https://script.google.com/macros/s/AKfycbwG_1cvgfnnNuK9PuhmXJOSeBuS8kFzJbf-R1p0qvySu0BW8GYKJKCKzHJ4Ny11FtkV/exec';
const KADOU_CACHE_TTL = 5 * 60 * 1000;

// State
let kadouMonthlyData = null;
let kadouPipelineData = null;
let kadouRawData = null;
let kadouProgressMode = 'today';
let kadouYesterdayProgress = 0;
let kadouTodayProgress = 0;
let kadouTomorrowProgress = 0;
let kadouSelectedProjects = [];
let kadouSelectedMembers = [];
let kadouAnalysisSelectedProjects = [];
let kadouAnalysisSelectedMembers = [];
let kadouCurrentChartType = 'calls';
let kadouCompareMonthEnabled = false;
let kadouSettingsData = null;

// Sub-tab navigation
function switchKadouSubTab(sub) {
    currentSubTab.kadou = sub;
    const tabsEl = document.getElementById('kadouSubTabs');
    tabsEl.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
    tabsEl.querySelector(`.sub-tab[data-sub="${sub}"]`).classList.add('active');
    ['overview', 'analysis', 'yield', 'settings'].forEach(s => {
        const el = document.getElementById('kadou-' + s);
        if (s === sub) el.classList.remove('hidden');
        else el.classList.add('hidden');
    });
    renderKadouSubTab(sub);
}

async function renderKadouSubTab(sub) {
    switch (sub) {
        case 'overview': await loadAndRenderKadouOverview(); break;
        case 'analysis': await loadAndRenderKadouAnalysis(); break;
        case 'yield': await loadAndRenderKadouYield(); break;
        case 'settings': await loadAndRenderKadouSettings(); break;
    }
}

// ---- Data fetching ----
function kadouCacheGet(key) {
    try {
        const raw = localStorage.getItem('kadou_' + key);
        if (!raw) return null;
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts > KADOU_CACHE_TTL) { localStorage.removeItem('kadou_' + key); return null; }
        return data;
    } catch { return null; }
}

function kadouCacheSet(key, data) {
    try { localStorage.setItem('kadou_' + key, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

async function fetchKadouMonthly(month) {
    const url = `${KADOU_GAS_URL}?type=monthly${month ? '&month=' + month : ''}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
}

async function fetchKadouPipeline() {
    const url = `${KADOU_GAS_URL}?type=pipeline_v2`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
}

async function fetchKadouRawData(startDate, endDate) {
    let url = `${KADOU_GAS_URL}?type=rawdata`;
    if (startDate) url += '&startDate=' + startDate;
    if (endDate) url += '&endDate=' + endDate;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
}

async function fetchKadouSalesTargets() {
    const url = `${KADOU_GAS_URL}?type=sales_targets`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
}

// ---- Helper: get kadou month from header selector ----
function getKadouMonth() {
    return getSelectedMonth();
}

function kadouGetStatus(value, standard) {
    if (value >= standard) return 'success';
    if (value >= standard * 0.8) return 'warning';
    return 'danger';
}

function kadouGetStatusColor(value, standard) {
    const colors = { success: '#86aaec', warning: '#ede07d', danger: '#ef947a' };
    if (value >= standard) return colors.success;
    if (value >= standard * 0.8) return colors.warning;
    return colors.danger;
}

function kadouFormatDeviation(dev) {
    if (dev > 0) return `<span style="color:var(--success);font-weight:600;">+${dev}</span>`;
    if (dev < 0) return `<span style="color:var(--danger);font-weight:600;">${dev}</span>`;
    return `<span style="color:var(--text-muted);">±0</span>`;
}

// ========== Phase 2: 概要サブタブ ==========
async function loadAndRenderKadouOverview() {
    const container = document.getElementById('kadouOverviewContent');
    const month = getKadouMonth();
    const cacheKey = 'monthly_' + month;

    // Show cached data immediately
    const cached = kadouCacheGet(cacheKey);
    if (cached && !kadouMonthlyData) {
        kadouMonthlyData = cached;
    }

    if (!kadouMonthlyData) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-light);">データを読み込んでいます...</div>';
        try {
            kadouMonthlyData = await fetchKadouMonthly(month);
            kadouCacheSet(cacheKey, kadouMonthlyData);
        } catch (e) {
            container.innerHTML = `<div class="alert alert-danger">読み込みエラー: ${escapeHtml(e.message)}</div>`;
            return;
        }
    }

    // Also load pipeline data for sales summary
    if (!kadouPipelineData) {
        const plCached = kadouCacheGet('pipeline');
        if (plCached) {
            kadouPipelineData = plCached;
        } else {
            try {
                kadouPipelineData = await fetchKadouPipeline();
                kadouCacheSet('pipeline', kadouPipelineData);
            } catch (e) {
                console.warn('Pipeline load failed:', e);
            }
        }
    }

    renderKadouOverview();
}

function renderKadouOverview() {
    const container = document.getElementById('kadouOverviewContent');
    const data = kadouMonthlyData;
    if (!data) return;

    const { metadata, summary, members } = data;
    const month = getKadouMonth();

    // Progress calculations
    const elapsedDays = parseInt(metadata.elapsedDays) || 0;
    const totalDays = parseInt(metadata.totalDays) || 1;
    kadouTodayProgress = parseFloat(metadata.standardProgress);
    kadouYesterdayProgress = Math.max(0, parseFloat(((elapsedDays - 1) / totalDays * 100).toFixed(2)));
    kadouTomorrowProgress = Math.min(100, parseFloat(((elapsedDays + 1) / totalDays * 100).toFixed(2)));

    const standardProgress = kadouProgressMode === 'today' ? kadouTodayProgress :
                             kadouProgressMode === 'yesterday' ? kadouYesterdayProgress : kadouTomorrowProgress;

    const now = new Date();
    const currentYM = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const isCurrentMonth = (metadata.targetMonth || month) === currentYM;

    // Sales summary from pipeline data
    let salesHtml = '';
    if (kadouPipelineData) {
        const { pipeline, revenue, salesTargets } = kadouPipelineData;
        const revMap = {}; (revenue || []).forEach(r => { revMap[r.month] = Number(r.revenue || 0); });
        const tgtMap = {}; (salesTargets || []).forEach(r => { tgtMap[r.target_month] = Number(r.total_sales_target || 0); });
        const plMap = {}; (pipeline || []).forEach(r => { plMap[r.month] = r; });

        const target = tgtMap[month] || 0;
        const rev = revMap[month] || 0;
        const pl = plMap[month] || {};
        const weighted = Number(pl.weighted || 0);
        const prospect = rev + weighted;
        const gap = target > 0 ? rev - target : 0;
        const rate = target > 0 ? Math.round(rev / target * 1000) / 10 : 0;
        const barWidth = Math.min(rate, 100);
        const barColor = rate >= 100 ? 'var(--success)' : rate >= 80 ? 'var(--warning)' : 'var(--danger)';

        salesHtml = `
            <div class="card">
                <div class="card-header"><h2>売上サマリー</h2></div>
                <div class="card-body">
                    <div class="kadou-sales-summary">
                        <div class="kadou-sales-main">
                            <div class="kadou-sales-label">確定売上</div>
                            <div class="kadou-sales-amount">${formatYen(rev)}</div>
                        </div>
                        <div class="kadou-sales-bar-wrap">
                            <div style="display:flex;justify-content:space-between;font-size:0.8rem;color:var(--text-light);margin-bottom:4px;">
                                <span>達成率 ${rate}%</span>
                                <span>目標 ${formatYen(target)}</span>
                            </div>
                            <div class="kadou-sales-bar">
                                <div class="kadou-sales-bar-fill" style="width:${barWidth}%;background:${barColor};"></div>
                            </div>
                        </div>
                        <div class="kadou-sales-cards">
                            <div class="kadou-sales-card">
                                <div class="kadou-sales-card-label">差分</div>
                                <div class="kadou-sales-card-value" style="color:${gap >= 0 ? 'var(--success)' : 'var(--danger)'};">${formatYen(gap)}</div>
                            </div>
                            <div class="kadou-sales-card">
                                <div class="kadou-sales-card-label">見込（PL込）</div>
                                <div class="kadou-sales-card-value">${formatYen(prospect)}</div>
                            </div>
                        </div>
                    </div>
                    <div style="margin-top:12px;">
                        <button class="btn btn-secondary btn-sm" onclick="toggleKadouSalesDetail()">
                            <span id="kadouSalesDetailToggleIcon">▶</span> 売上詳細テーブル
                        </button>
                        <div id="kadouSalesDetailTable" style="display:none;margin-top:12px;">
                            ${renderKadouSalesDetailTable()}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // KPI Progress
    const callStatus = kadouGetStatus(summary.callProgressRate, standardProgress);
    const appoStatus = kadouGetStatus(summary.appointmentProgressRate, standardProgress);
    const diff = (summary.appointmentProgressRate - standardProgress).toFixed(1);

    const kpiHtml = `
        <div class="card">
            <div class="card-header">
                <h2>KPI進捗</h2>
                <div style="display:flex;align-items:center;gap:8px;">
                    <span class="badge badge-info" style="font-size:0.8rem;">
                        ${isCurrentMonth ? `経過 ${elapsedDays}日 / 全${totalDays}稼働日` : `全${totalDays}稼働日`}
                    </span>
                    <span class="badge badge-primary" id="kadouProgressBadge">標準進捗: ${standardProgress}%</span>
                </div>
            </div>
            <div class="card-body">
                <div class="kadou-progress-toggles">
                    <button class="chart-toggle ${kadouProgressMode === 'yesterday' ? 'active' : ''}" onclick="setKadouProgressMode('yesterday')">前日 ${kadouYesterdayProgress}%</button>
                    <button class="chart-toggle ${kadouProgressMode === 'today' ? 'active' : ''}" onclick="setKadouProgressMode('today')">本日 ${kadouTodayProgress}%</button>
                    <button class="chart-toggle ${kadouProgressMode === 'tomorrow' ? 'active' : ''}" onclick="setKadouProgressMode('tomorrow')">明日 ${kadouTomorrowProgress}%</button>
                </div>
                <div class="kadou-kpi-grid">
                    <div class="kadou-kpi-card highlight">
                        <div class="kadou-kpi-label">標準進捗</div>
                        <div class="kadou-kpi-value">${standardProgress}%</div>
                        <div class="kadou-kpi-detail">経過日数ベース</div>
                    </div>
                    <div class="kadou-kpi-card">
                        <div class="kadou-kpi-label">架電進捗</div>
                        <div class="kadou-kpi-value ${callStatus}">${summary.callProgressRate}%</div>
                        <div class="kadou-kpi-detail">${(summary.totalCalls || 0).toLocaleString()} / ${(summary.targetCalls || 0).toLocaleString()}件</div>
                    </div>
                    <div class="kadou-kpi-card">
                        <div class="kadou-kpi-label">アポ進捗</div>
                        <div class="kadou-kpi-value ${appoStatus}">${summary.appointmentProgressRate}%</div>
                        <div class="kadou-kpi-detail">${summary.totalAppointments || 0} / ${summary.targetAppointments || 0}件</div>
                    </div>
                    <div class="kadou-kpi-card">
                        <div class="kadou-kpi-label">進捗差分</div>
                        <div class="kadou-kpi-value ${appoStatus}">${diff >= 0 ? '+' : ''}${diff}%</div>
                        <div class="kadou-kpi-detail">アポ - 標準</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Member cards - apply filters
    let filtered = members;
    if (kadouSelectedProjects.length > 0) filtered = filtered.filter(m => kadouSelectedProjects.includes(m.project));
    if (kadouSelectedMembers.length > 0) filtered = filtered.filter(m => kadouSelectedMembers.includes(m.name));
    const sorted = [...filtered].sort((a, b) => b.appointmentProgress - a.appointmentProgress);

    // Filter UI
    const projects = [...new Set(members.map(m => m.project))];
    const allNames = [...new Set(members.map(m => m.name))];
    let availableProjects = new Set(projects);
    let availableMembers = new Set(allNames);
    if (kadouSelectedMembers.length > 0) {
        availableProjects = new Set();
        members.forEach(m => { if (kadouSelectedMembers.includes(m.name)) availableProjects.add(m.project); });
    }
    if (kadouSelectedProjects.length > 0) {
        availableMembers = new Set();
        members.forEach(m => { if (kadouSelectedProjects.includes(m.project)) availableMembers.add(m.name); });
    }
    const hasFilter = kadouSelectedProjects.length > 0 || kadouSelectedMembers.length > 0;

    const filterHtml = `
        <div class="card">
            <div class="card-header"><h2>フィルター</h2></div>
            <div class="card-body">
                <div style="margin-bottom:8px;font-size:0.8rem;color:var(--text-light);">案件で絞り込み</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
                    ${[...availableProjects].map(p => `<button class="chart-toggle ${kadouSelectedProjects.includes(p) ? 'active' : ''}" onclick="toggleKadouFilter('project','${escapeHtml(p)}')">${escapeHtml(p)}</button>`).join('')}
                </div>
                <div style="margin-bottom:8px;font-size:0.8rem;color:var(--text-light);">担当者で絞り込み</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                    ${[...availableMembers].map(n => `<button class="chart-toggle ${kadouSelectedMembers.includes(n) ? 'active' : ''}" onclick="toggleKadouFilter('member','${escapeHtml(n)}')">${escapeHtml(n)}</button>`).join('')}
                </div>
                ${hasFilter ? '<button class="btn btn-secondary btn-sm" onclick="clearKadouFilters()">クリア</button>' : ''}
            </div>
        </div>
    `;

    const memberCardsHtml = sorted.length > 0 ? `
        <div class="card">
            <div class="card-header"><h2>担当者別進捗</h2></div>
            <div class="card-body">
                <div class="kadou-member-grid">
                    ${sorted.map(m => {
                        const effectiveCallProgress = (m.targetCalls === 0 && m.actualCalls > 0) ? 100 : m.callProgress;
                        const effectiveAppoProgress = (m.targetAppointments === 0 && m.actualAppointments > 0) ? 100 : m.appointmentProgress;
                        const cs = kadouGetStatus(effectiveCallProgress, standardProgress);
                        const as = kadouGetStatus(effectiveAppoProgress, standardProgress);
                        const expectedCalls = Math.round(m.targetCalls * standardProgress / 100);
                        const callDev = m.actualCalls - expectedCalls;
                        const expectedAppo = Math.round(m.targetAppointments * standardProgress / 100);
                        const appoDev = m.actualAppointments - expectedAppo;

                        return `
                            <div class="kadou-member-card">
                                <div class="kadou-member-name">${escapeHtml(m.name)}（${escapeHtml(m.project)}）</div>
                                <div class="kadou-progress-row">
                                    <span class="kadou-progress-label">架電</span>
                                    <div class="kadou-progress-bar-container">
                                        <div class="kadou-progress-bar">
                                            <div class="kadou-progress-fill ${cs}" style="width:${Math.min(effectiveCallProgress, 100)}%;"></div>
                                            <div class="kadou-target-line" style="left:${standardProgress}%;"></div>
                                        </div>
                                    </div>
                                    <span class="kadou-progress-value ${cs}">${effectiveCallProgress}%</span>
                                </div>
                                <div class="kadou-progress-row">
                                    <span class="kadou-progress-label">アポ</span>
                                    <div class="kadou-progress-bar-container">
                                        <div class="kadou-progress-bar">
                                            <div class="kadou-progress-fill ${as}" style="width:${Math.min(effectiveAppoProgress, 100)}%;"></div>
                                            <div class="kadou-target-line" style="left:${standardProgress}%;"></div>
                                        </div>
                                    </div>
                                    <span class="kadou-progress-value ${as}">${effectiveAppoProgress}%</span>
                                </div>
                                <div class="kadou-stats-row">
                                    <div class="kadou-stat"><div class="kadou-stat-label">架電</div><div>${m.actualCalls}/${m.targetCalls}</div><div>${kadouFormatDeviation(callDev)}</div></div>
                                    <div class="kadou-stat"><div class="kadou-stat-label">アポ</div><div>${m.actualAppointments}/${m.targetAppointments}</div><div>${kadouFormatDeviation(appoDev)}</div></div>
                                    <div class="kadou-stat"><div class="kadou-stat-label">架toアポ</div><div>${m.callToAppointmentActual || 0}%</div></div>
                                    <div class="kadou-stat"><div class="kadou-stat-label">売上</div><div>${formatYen(m.actualSales || 0)}</div></div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    ` : '';

    // Charts
    const chartsHtml = `
        <div class="card">
            <div class="card-header"><h2>個人別 架電 vs アポ進捗</h2></div>
            <div class="card-body"><div class="chart-container"><canvas id="kadou-member-compare"></canvas></div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
            <div class="card">
                <div class="card-header"><h2>架電進捗ランキング</h2></div>
                <div class="card-body"><div class="chart-container"><canvas id="kadou-call-rank"></canvas></div></div>
            </div>
            <div class="card">
                <div class="card-header"><h2>アポ進捗ランキング</h2></div>
                <div class="card-body"><div class="chart-container"><canvas id="kadou-appo-rank"></canvas></div></div>
            </div>
        </div>
    `;

    container.innerHTML = salesHtml + kpiHtml + filterHtml + memberCardsHtml + chartsHtml;

    // Render charts
    renderKadouOverviewCharts(filtered, standardProgress);
}

function renderKadouOverviewCharts(members, standardProgress) {
    if (!members || members.length === 0) return;

    // Destroy old charts
    ['kadou-member-compare', 'kadou-call-rank', 'kadou-appo-rank'].forEach(id => {
        if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    });

    // Member data aggregation
    const memberData = {};
    members.forEach(m => {
        if (!memberData[m.name]) memberData[m.name] = { totalCalls: 0, targetCalls: 0, totalAppo: 0, targetAppo: 0 };
        memberData[m.name].totalCalls += m.actualCalls;
        memberData[m.name].targetCalls += m.targetCalls;
        memberData[m.name].totalAppo += m.actualAppointments;
        memberData[m.name].targetAppo += m.targetAppointments;
    });

    const labels = Object.keys(memberData);
    const callProg = labels.map(n => memberData[n].targetCalls === 0 ? (memberData[n].totalCalls > 0 ? 100 : 0) : Math.round(memberData[n].totalCalls / memberData[n].targetCalls * 1000) / 10);
    const appoProg = labels.map(n => memberData[n].targetAppo === 0 ? (memberData[n].totalAppo > 0 ? 100 : 0) : Math.round(memberData[n].totalAppo / memberData[n].targetAppo * 1000) / 10);

    const chartFont = { family: "'Noto Sans JP', sans-serif" };
    const annotationOpts = {
        annotations: {
            line1: { type: 'line', yMin: standardProgress, yMax: standardProgress, borderColor: '#082558', borderWidth: 2, borderDash: [5, 5],
                label: { display: true, content: `標準 ${standardProgress}%`, position: 'end', color: '#fff', backgroundColor: '#082558', font: { family: "'Poppins', sans-serif" } } }
        }
    };

    const el1 = document.getElementById('kadou-member-compare');
    if (el1) {
        charts['kadou-member-compare'] = new Chart(el1, {
            type: 'bar',
            data: { labels, datasets: [
                { label: '架電進捗', data: callProg, backgroundColor: '#1155cc', borderRadius: 4 },
                { label: 'アポ進捗', data: appoProg, backgroundColor: '#00a2da', borderRadius: 4 }
            ]},
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#787b7f', font: chartFont } }, annotation: annotationOpts },
                scales: { y: { beginAtZero: true, grid: { color: '#e4e8ef' } }, x: { grid: { display: false } } }
            }
        });
    }

    // Rankings
    const callRank = labels.map((n, i) => ({ name: n, v: callProg[i] })).sort((a, b) => b.v - a.v);
    const appoRank = labels.map((n, i) => ({ name: n, v: appoProg[i] })).sort((a, b) => b.v - a.v);

    const rankOpts = (data) => ({
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, grid: { color: '#e4e8ef' } }, y: { grid: { display: false } } }
    });

    const el2 = document.getElementById('kadou-call-rank');
    if (el2) {
        charts['kadou-call-rank'] = new Chart(el2, {
            type: 'bar',
            data: { labels: callRank.map(d => d.name), datasets: [{ data: callRank.map(d => d.v), backgroundColor: callRank.map(d => kadouGetStatusColor(d.v, standardProgress)), borderRadius: 4 }] },
            options: rankOpts()
        });
    }

    const el3 = document.getElementById('kadou-appo-rank');
    if (el3) {
        charts['kadou-appo-rank'] = new Chart(el3, {
            type: 'bar',
            data: { labels: appoRank.map(d => d.name), datasets: [{ data: appoRank.map(d => d.v), backgroundColor: appoRank.map(d => kadouGetStatusColor(d.v, standardProgress)), borderRadius: 4 }] },
            options: rankOpts()
        });
    }
}

function setKadouProgressMode(mode) {
    kadouProgressMode = mode;
    renderKadouOverview();
}

function toggleKadouFilter(type, value) {
    if (type === 'project') {
        kadouSelectedProjects = kadouSelectedProjects.includes(value) ? kadouSelectedProjects.filter(p => p !== value) : [...kadouSelectedProjects, value];
    } else {
        kadouSelectedMembers = kadouSelectedMembers.includes(value) ? kadouSelectedMembers.filter(m => m !== value) : [...kadouSelectedMembers, value];
    }
    renderKadouOverview();
}

function clearKadouFilters() {
    kadouSelectedProjects = [];
    kadouSelectedMembers = [];
    renderKadouOverview();
}

function toggleKadouSalesDetail() {
    const el = document.getElementById('kadouSalesDetailTable');
    const icon = document.getElementById('kadouSalesDetailToggleIcon');
    if (el.style.display === 'none') {
        el.style.display = 'block';
        icon.textContent = '▼';
    } else {
        el.style.display = 'none';
        icon.textContent = '▶';
    }
}

function renderKadouSalesDetailTable() {
    if (!kadouPipelineData) return '<div style="color:var(--text-light);">パイプラインデータなし</div>';

    const { deals, pipeline, revenue, salesTargets } = kadouPipelineData;
    const quarters = [[3,4,5,6],[7,8,9],[10,11,12],[1,2]];
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    let currentQIdx = quarters.findIndex(q => q.includes(currentMonth));
    if (currentQIdx === -1) currentQIdx = 0;
    const year = now.getFullYear();
    const qMonths = quarters[currentQIdx];
    const monthKeys = qMonths.map(m => {
        let y = year;
        if (m <= 2 && currentMonth >= 3) y = year + 1;
        return y + '-' + String(m).padStart(2, '0');
    });
    const monthLabels = qMonths.map(m => m + '月');

    const tgtMap = {}; (salesTargets || []).forEach(r => { tgtMap[r.target_month] = Number(r.total_sales_target || 0); });
    const revMap = {}; (revenue || []).forEach(r => { revMap[r.month] = Number(r.revenue || 0); });
    const plMapData = {}; (pipeline || []).forEach(r => { plMapData[r.month] = r; });

    // Separate won vs pipeline deals
    const wonDeals = (deals || []).filter(d => d.phase === '受注');
    const plDeals = (deals || []).filter(d => d.phase !== '受注' && d.phase !== '失注');

    // Build deal-month amount map
    function dealMonthMap(dealList) {
        const map = {};
        dealList.forEach(d => {
            const key = d.deal_name + '|' + (d.owner || '');
            if (!map[key]) map[key] = { name: d.deal_name, owner: d.owner || '', amounts: {} };
            const dMonth = (d.expected_start_date || '').substring(0, 7);
            if (monthKeys.includes(dMonth)) {
                map[key].amounts[dMonth] = (map[key].amounts[dMonth] || 0) + Number(d.amount || 0);
            }
        });
        return Object.values(map);
    }

    const wonRows = dealMonthMap(wonDeals);
    const plRows = dealMonthMap(plDeals);

    function renderDealRows(rows, sectionLabel, bgColor, dealList) {
        if (rows.length === 0) return '';
        let html = '';
        rows.forEach((r, i) => {
            const bg = i === 0 ? `<td rowspan="${rows.length}" style="font-weight:600;background:${bgColor};vertical-align:top;padding:8px;">${sectionLabel}</td>` : '';
            // Find deal id for edit button
            const deal = dealList.find(d => d.deal_name === r.name && (d.owner || '') === r.owner);
            const editBtn = deal ? `<button class="btn btn-secondary btn-sm" onclick="openKadouDealForm('${deal.id}')" title="編集" style="padding:2px 6px;font-size:0.7rem;">&#9998;</button>` : '';
            html += `<tr>${bg}<td>${escapeHtml(r.name)} ${editBtn}</td>${monthKeys.map(mk => `<td class="num">${r.amounts[mk] ? formatYen(r.amounts[mk]) : '¥0'}</td>`).join('')}<td class="num" style="font-weight:600;">${formatYen(monthKeys.reduce((s, mk) => s + (r.amounts[mk] || 0), 0))}</td></tr>`;
        });
        return html;
    }

    // Summary rows
    const wonTotals = monthKeys.map(mk => wonRows.reduce((s, r) => s + (r.amounts[mk] || 0), 0));
    const plTotals = monthKeys.map(mk => plRows.reduce((s, r) => s + (r.amounts[mk] || 0), 0));
    const targets = monthKeys.map(mk => tgtMap[mk] || 0);

    let html = `<div class="table-scroll"><table class="data-table" style="font-size:0.85rem;">
        <thead><tr><th></th><th></th>${monthLabels.map(l => `<th class="num">${l}</th>`).join('')}<th class="num" style="border-left:2px solid var(--border-color);">合計</th></tr></thead>
        <tbody>
        <tr style="background:var(--gray-100);font-weight:600;"><td colspan="2">目標金額</td>${targets.map(t => `<td class="num">${formatYen(t)}</td>`).join('')}<td class="num" style="border-left:2px solid var(--border-color);">${formatYen(targets.reduce((a, b) => a + b, 0))}</td></tr>
        <tr><td colspan="${monthKeys.length + 3}" style="height:4px;border:none;"></td></tr>
        ${renderDealRows(wonRows, '確定', '#dcfce7', wonDeals)}
        <tr><td colspan="${monthKeys.length + 3}" style="height:4px;border:none;"></td></tr>
        ${renderDealRows(plRows, 'パイプ', '#fef3c7', plDeals)}
        <tr><td colspan="${monthKeys.length + 3}" style="height:4px;border:none;"></td></tr>
        <tr style="font-weight:600;background:var(--gray-100);"><td colspan="2">確定金額合計</td>${wonTotals.map(t => `<td class="num">${formatYen(t)}</td>`).join('')}<td class="num" style="border-left:2px solid var(--border-color);">${formatYen(wonTotals.reduce((a, b) => a + b, 0))}</td></tr>
        <tr style="font-weight:600;background:var(--gray-100);"><td colspan="2">見込（パイプ込）</td>${monthKeys.map((mk, i) => `<td class="num">${formatYen(wonTotals[i] + plTotals[i])}</td>`).join('')}<td class="num" style="border-left:2px solid var(--border-color);">${formatYen(wonTotals.reduce((a, b) => a + b, 0) + plTotals.reduce((a, b) => a + b, 0))}</td></tr>
        <tr><td colspan="${monthKeys.length + 3}" style="height:4px;border:none;"></td></tr>
        <tr style="font-weight:600;color:${wonTotals.reduce((a, b, i) => a + b - targets[i], 0) < 0 ? 'var(--danger)' : 'var(--success)'};"><td colspan="2">目標対確定差分</td>${monthKeys.map((mk, i) => {
            const d = wonTotals[i] - targets[i];
            return `<td class="num" style="color:${d < 0 ? 'var(--danger)' : 'var(--success)'};">${formatYen(d)}</td>`;
        }).join('')}<td class="num" style="border-left:2px solid var(--border-color);">${formatYen(wonTotals.reduce((a, b) => a + b, 0) - targets.reduce((a, b) => a + b, 0))}</td></tr>
        <tr style="font-weight:600;"><td colspan="2">目標対見込差分</td>${monthKeys.map((mk, i) => {
            const d = wonTotals[i] + plTotals[i] - targets[i];
            return `<td class="num" style="color:${d < 0 ? 'var(--danger)' : 'var(--success)'};">${formatYen(d)}</td>`;
        }).join('')}<td class="num" style="border-left:2px solid var(--border-color);">${formatYen(wonTotals.reduce((a, b) => a + b, 0) + plTotals.reduce((a, b) => a + b, 0) - targets.reduce((a, b) => a + b, 0))}</td></tr>
        </tbody></table></div>
        <div style="margin-top:12px;">
            <button class="btn btn-primary btn-sm" onclick="openKadouDealForm()">+ 案件を追加</button>
        </div>`;

    return html;
}

// ========== Phase 3: 歩留まりサブタブ ==========
async function loadAndRenderKadouYield() {
    const container = document.getElementById('kadouYieldContent');
    if (!kadouMonthlyData) {
        try {
            kadouMonthlyData = await fetchKadouMonthly(getKadouMonth());
            kadouCacheSet('monthly_' + getKadouMonth(), kadouMonthlyData);
        } catch (e) {
            container.innerHTML = `<div class="alert alert-danger">読み込みエラー: ${escapeHtml(e.message)}</div>`;
            return;
        }
    }
    renderKadouYield();
}

function renderKadouYield() {
    const container = document.getElementById('kadouYieldContent');
    const data = kadouMonthlyData;
    if (!data || !data.members) return;

    const members = data.members;
    // Aggregate totals
    let totalCalls = 0, totalPR = 0, totalAppo = 0;
    members.forEach(m => {
        totalCalls += m.actualCalls || 0;
        totalPR += m.actualPR || 0;
        totalAppo += m.actualAppointments || 0;
    });

    const callToPr = totalCalls > 0 ? totalPR / totalCalls * 100 : 0;
    const prToAppo = totalPR > 0 ? totalAppo / totalPR * 100 : 0;
    const callToAppo = totalCalls > 0 ? totalAppo / totalCalls * 100 : 0;

    let html = '';

    // Funnel
    html += `
        <div class="card">
            <div class="card-header"><h2>歩留まりファネル</h2></div>
            <div class="card-body">
                <div class="funnel">
                    <div class="funnel-step" style="background:var(--blue-50);">
                        <div class="fs-value">${formatNum(totalCalls)}</div>
                        <div class="fs-label">架電</div>
                    </div>
                    <div class="funnel-arrow">\u2192</div>
                    <div class="funnel-step" style="background:var(--info-light);">
                        <div class="fs-value">${formatNum(totalPR)}</div>
                        <div class="fs-label">PR</div>
                        <div class="funnel-rate">${formatPct(callToPr)}</div>
                    </div>
                    <div class="funnel-arrow">\u2192</div>
                    <div class="funnel-step" style="background:var(--success-light);">
                        <div class="fs-value">${formatNum(totalAppo)}</div>
                        <div class="fs-label">アポ</div>
                        <div class="funnel-rate">${formatPct(prToAppo)}</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Member yield table
    const uniqueMembers = [...new Set(members.map(m => m.name))];
    html += `
        <div class="card">
            <div class="card-header"><h2>メンバー別歩留まり</h2></div>
            <div class="card-body no-pad table-scroll">
                <table class="data-table">
                    <thead><tr>
                        <th>メンバー</th>
                        <th class="num">架電</th><th class="num">PR</th><th class="num">アポ</th>
                        <th class="num">架toPR</th><th class="num">PRtoアポ</th><th class="num">架toアポ</th>
                    </tr></thead>
                    <tbody>
    `;

    uniqueMembers.forEach(name => {
        const ms = members.filter(m => m.name === name);
        const c = ms.reduce((s, m) => s + (m.actualCalls || 0), 0);
        const p = ms.reduce((s, m) => s + (m.actualPR || 0), 0);
        const a = ms.reduce((s, m) => s + (m.actualAppointments || 0), 0);
        const ctp = c > 0 ? p / c * 100 : 0;
        const pta = p > 0 ? a / p * 100 : 0;
        const cta = c > 0 ? a / c * 100 : 0;

        html += `<tr>
            <td>${escapeHtml(name)}</td>
            <td class="num">${formatNum(c)}</td>
            <td class="num">${formatNum(p)}</td>
            <td class="num">${formatNum(a)}</td>
            <td class="num ${yieldClass(ctp, 15)}">${formatPct(ctp)}</td>
            <td class="num ${yieldClass(pta, 30)}">${formatPct(pta)}</td>
            <td class="num ${yieldClass(cta, 3)}">${formatPct(cta)}</td>
        </tr>`;
    });

    html += `
                    </tbody>
                    <tfoot><tr style="font-weight:600;background:var(--gray-100);">
                        <td>合計</td>
                        <td class="num">${formatNum(totalCalls)}</td>
                        <td class="num">${formatNum(totalPR)}</td>
                        <td class="num">${formatNum(totalAppo)}</td>
                        <td class="num">${formatPct(callToPr)}</td>
                        <td class="num">${formatPct(prToAppo)}</td>
                        <td class="num">${formatPct(callToAppo)}</td>
                    </tr></tfoot>
                </table>
            </div>
        </div>
    `;

    // Baselines legend
    html += `<div class="alert alert-info" style="font-size:0.8rem;">
        基準値: 架toPR \u226515%, PRtoアポ \u226530%, 架toアポ \u22653% &mdash;
        <span class="yield-good">達成</span> / <span class="yield-warn">注意</span> / <span class="yield-bad">要改善</span>
    </div>`;

    // Diagnosis
    html += '<div class="card"><div class="card-header"><h2>診断・改善示唆</h2></div><div class="card-body"><ul class="diagnosis-list">';
    const diagnoses = [];

    if (callToPr < 15 * 0.7) {
        diagnoses.push({ icon: '\u26A0\uFE0F', text: `架電toPR率が${formatPct(callToPr)}と低水準です。トークスクリプトの見直しやロープレを推奨します。` });
    } else if (callToPr < 15) {
        diagnoses.push({ icon: '\u{1F4A1}', text: `架電toPR率${formatPct(callToPr)} - 基準の15%まであと少しです。受付突破率を意識しましょう。` });
    }

    if (prToAppo < 30 * 0.7) {
        diagnoses.push({ icon: '\u26A0\uFE0F', text: `PRtoアポ率が${formatPct(prToAppo)}と低水準です。クロージングトークの改善が必要です。` });
    } else if (prToAppo < 30) {
        diagnoses.push({ icon: '\u{1F4A1}', text: `PRtoアポ率${formatPct(prToAppo)} - 基準の30%まであと少し。ヒアリング強化を。` });
    }

    if (callToAppo < 3 * 0.7) {
        diagnoses.push({ icon: '\u26A0\uFE0F', text: `架電toアポ率${formatPct(callToAppo)}が低いです。全体的なアプローチ改善が急務です。` });
    }

    if (diagnoses.length === 0) {
        diagnoses.push({ icon: '\u2705', text: '現在アラートはありません。全指標が基準値以上です。' });
    }

    diagnoses.forEach(d => {
        html += `<li><span class="diagnosis-icon">${d.icon}</span><span>${d.text}</span></li>`;
    });
    html += '</ul></div></div>';

    container.innerHTML = html;
}

// ========== Phase 4: 分析サブタブ ==========
async function loadAndRenderKadouAnalysis() {
    const container = document.getElementById('kadouAnalysisContent');
    const month = getKadouMonth();
    const startDate = month + '-01';
    const endDate = getEndOfMonth(month);
    const cacheKey = 'rawdata_' + startDate + '_' + endDate;

    if (!kadouRawData) {
        const cached = kadouCacheGet(cacheKey);
        if (cached) {
            kadouRawData = cached;
        } else {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-light);">データを読み込んでいます...</div>';
            try {
                kadouRawData = await fetchKadouRawData(startDate, endDate);
                kadouCacheSet(cacheKey, kadouRawData);
            } catch (e) {
                container.innerHTML = `<div class="alert alert-danger">読み込みエラー: ${escapeHtml(e.message)}</div>`;
                return;
            }
        }
    }
    renderKadouAnalysis();
}

function getKadouFilteredAnalysisData() {
    if (!kadouRawData || !kadouRawData.records) return { records: [], aggregated: null };
    let filtered = kadouRawData.records;
    if (kadouAnalysisSelectedProjects.length > 0) filtered = filtered.filter(r => kadouAnalysisSelectedProjects.includes(r.project));
    if (kadouAnalysisSelectedMembers.length > 0) filtered = filtered.filter(r => kadouAnalysisSelectedMembers.includes(r.name));

    let totalCalls = 0, totalPR = 0, totalAppo = 0, totalCallTime = 0;
    const dailyMap = {};
    filtered.forEach(r => {
        totalCalls += r.calls; totalPR += r.pr; totalAppo += r.appo; totalCallTime += r.callTime;
        if (r.date) {
            if (!dailyMap[r.date]) dailyMap[r.date] = { calls: 0, pr: 0, appo: 0, callTime: 0 };
            dailyMap[r.date].calls += r.calls; dailyMap[r.date].pr += r.pr;
            dailyMap[r.date].appo += r.appo; dailyMap[r.date].callTime += r.callTime;
        }
    });

    return {
        records: filtered,
        aggregated: {
            totals: {
                calls: totalCalls, pr: totalPR, appo: totalAppo, callTime: totalCallTime,
                callToPR: totalCalls > 0 ? Math.round(totalPR / totalCalls * 10000) / 100 : 0,
                prToAppo: totalPR > 0 ? Math.round(totalAppo / totalPR * 10000) / 100 : 0,
                callToAppo: totalCalls > 0 ? Math.round(totalAppo / totalCalls * 10000) / 100 : 0,
                callsPerHour: totalCallTime > 0 ? Math.round(totalCalls / totalCallTime * 10) / 10 : 0
            },
            daily: Object.keys(dailyMap).sort().map(date => ({
                date, ...dailyMap[date],
                callToPR: dailyMap[date].calls > 0 ? Math.round(dailyMap[date].pr / dailyMap[date].calls * 10000) / 100 : 0,
                prToAppo: dailyMap[date].pr > 0 ? Math.round(dailyMap[date].appo / dailyMap[date].pr * 10000) / 100 : 0,
                callToAppo: dailyMap[date].calls > 0 ? Math.round(dailyMap[date].appo / dailyMap[date].calls * 10000) / 100 : 0,
                callsPerHour: dailyMap[date].callTime > 0 ? Math.round(dailyMap[date].calls / dailyMap[date].callTime * 10) / 10 : 0
            }))
        }
    };
}

function renderKadouAnalysis() {
    const container = document.getElementById('kadouAnalysisContent');
    if (!kadouRawData) return;

    const { aggregated } = getKadouFilteredAnalysisData();
    if (!aggregated) return;

    const totals = aggregated.totals;
    const comparisons = kadouRawData.comparisons || { lastMonth: {}, allTime: {} };

    // Filters
    const projects = kadouRawData.filters ? kadouRawData.filters.projects || [] : [];
    const members = kadouRawData.filters ? kadouRawData.filters.members || [] : [];
    const hasFilter = kadouAnalysisSelectedProjects.length > 0 || kadouAnalysisSelectedMembers.length > 0;

    function compClass(v) { return !v || v === 0 ? '' : v > 0 ? 'yield-good' : 'yield-bad'; }
    function compFmt(v) { return !v || v === 0 ? '±0.0%' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }

    const chartTypes = [
        { key: 'calls', label: '架電数' }, { key: 'pr', label: 'PR数' }, { key: 'appo', label: 'アポ数' },
        { key: 'callToPR', label: '架toPR率' }, { key: 'prToAppo', label: 'PRtoアポ率' },
        { key: 'callToAppo', label: '架toアポ率' }, { key: 'callsPerHour', label: '架電数/H' }
    ];

    let html = `
        <div class="card">
            <div class="card-header"><h2>フィルター</h2></div>
            <div class="card-body">
                <div style="margin-bottom:8px;font-size:0.8rem;color:var(--text-light);">案件で絞り込み</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
                    ${projects.map(p => `<button class="chart-toggle ${kadouAnalysisSelectedProjects.includes(p) ? 'active' : ''}" onclick="toggleKadouAnalysisFilter('project','${escapeHtml(p)}')">${escapeHtml(p)}</button>`).join('')}
                </div>
                <div style="margin-bottom:8px;font-size:0.8rem;color:var(--text-light);">担当者で絞り込み</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                    ${members.map(n => `<button class="chart-toggle ${kadouAnalysisSelectedMembers.includes(n) ? 'active' : ''}" onclick="toggleKadouAnalysisFilter('member','${escapeHtml(n)}')">${escapeHtml(n)}</button>`).join('')}
                </div>
                ${hasFilter ? '<button class="btn btn-secondary btn-sm" onclick="clearKadouAnalysisFilters()">クリア</button>' : ''}
            </div>
        </div>

        <div class="card">
            <div class="card-header"><h2>実数指標</h2></div>
            <div class="card-body">
                <div class="kadou-kpi-grid">
                    <div class="kadou-kpi-card"><div class="kadou-kpi-label">架電数</div><div class="kadou-kpi-value">${totals.calls.toLocaleString()}</div></div>
                    <div class="kadou-kpi-card"><div class="kadou-kpi-label">PR数</div><div class="kadou-kpi-value">${totals.pr.toLocaleString()}</div></div>
                    <div class="kadou-kpi-card"><div class="kadou-kpi-label">アポ数</div><div class="kadou-kpi-value">${totals.appo.toLocaleString()}</div></div>
                    <div class="kadou-kpi-card"><div class="kadou-kpi-label">架電数/H</div><div class="kadou-kpi-value">${totals.callsPerHour}</div></div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header"><h2>率指標</h2></div>
            <div class="card-body">
                <div class="kadou-kpi-grid">
                    <div class="kadou-kpi-card">
                        <div class="kadou-kpi-label">架電toPR率</div>
                        <div class="kadou-kpi-value">${totals.callToPR}%</div>
                        <div class="kadou-kpi-detail">先月比: <span class="${compClass(comparisons.lastMonth.callToPR)}">${compFmt(comparisons.lastMonth.callToPR)}</span></div>
                        <div class="kadou-kpi-detail">通算比: <span class="${compClass(comparisons.allTime.callToPR)}">${compFmt(comparisons.allTime.callToPR)}</span></div>
                    </div>
                    <div class="kadou-kpi-card">
                        <div class="kadou-kpi-label">PRtoアポ率</div>
                        <div class="kadou-kpi-value">${totals.prToAppo}%</div>
                        <div class="kadou-kpi-detail">先月比: <span class="${compClass(comparisons.lastMonth.prToAppo)}">${compFmt(comparisons.lastMonth.prToAppo)}</span></div>
                        <div class="kadou-kpi-detail">通算比: <span class="${compClass(comparisons.allTime.prToAppo)}">${compFmt(comparisons.allTime.prToAppo)}</span></div>
                    </div>
                    <div class="kadou-kpi-card">
                        <div class="kadou-kpi-label">架電toアポ率</div>
                        <div class="kadou-kpi-value">${totals.callToAppo}%</div>
                        <div class="kadou-kpi-detail">先月比: <span class="${compClass(comparisons.lastMonth.callToAppo)}">${compFmt(comparisons.lastMonth.callToAppo)}</span></div>
                        <div class="kadou-kpi-detail">通算比: <span class="${compClass(comparisons.allTime.callToAppo)}">${compFmt(comparisons.allTime.callToAppo)}</span></div>
                    </div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h2>日次推移</h2>
                <div class="chart-toggles">
                    ${chartTypes.map(t => `<button class="chart-toggle ${kadouCurrentChartType === t.key ? 'active' : ''}" onclick="setKadouChartType('${t.key}')">${t.label}</button>`).join('')}
                </div>
            </div>
            <div class="card-body">
                <div style="margin-bottom:8px;">
                    <label style="font-size:0.8rem;cursor:pointer;">
                        <input type="checkbox" id="kadouCompareToggle" ${kadouCompareMonthEnabled ? 'checked' : ''} onchange="toggleKadouCompare()"> 前月と比較
                    </label>
                </div>
                <div class="chart-container"><canvas id="kadou-analysis-chart"></canvas></div>
            </div>
        </div>
    `;

    container.innerHTML = html;
    renderKadouAnalysisChart();
}

function renderKadouAnalysisChart() {
    const { aggregated } = getKadouFilteredAnalysisData();
    if (!aggregated || !aggregated.daily || aggregated.daily.length === 0) return;

    if (charts['kadou-analysis-chart']) { charts['kadou-analysis-chart'].destroy(); delete charts['kadou-analysis-chart']; }

    const daily = aggregated.daily;
    const config = {
        calls: { label: '架電数', color: '#1155cc', field: 'calls' },
        pr: { label: 'PR数', color: '#00a2da', field: 'pr' },
        appo: { label: 'アポ数', color: '#22c55e', field: 'appo' },
        callToPR: { label: '架電toPR率 (%)', color: '#f59e0b', field: 'callToPR' },
        prToAppo: { label: 'PRtoアポ率 (%)', color: '#00a2da', field: 'prToAppo' },
        callToAppo: { label: '架電toアポ率 (%)', color: '#e04f24', field: 'callToAppo' },
        callsPerHour: { label: '架電数/H', color: '#ef4444', field: 'callsPerHour' }
    };

    const cfg = config[kadouCurrentChartType] || config.calls;
    const labels = kadouCompareMonthEnabled ? daily.map(d => new Date(d.date).getDate() + '日') : daily.map(d => d.date);
    const data = daily.map(d => d[cfg.field]);

    const datasets = [{
        label: kadouCompareMonthEnabled ? '当月 ' + cfg.label : cfg.label,
        data, borderColor: cfg.color, backgroundColor: cfg.color + '20',
        fill: !kadouCompareMonthEnabled, tension: 0.3, pointRadius: 4, pointBackgroundColor: cfg.color
    }];

    if (kadouCompareMonthEnabled && kadouRawData && kadouRawData.previousMonthDaily) {
        const prevDaily = kadouRawData.previousMonthDaily.daily;
        const validValues = prevDaily.filter(d => d[cfg.field] > 0).map(d => d[cfg.field]);
        if (validValues.length > 0) {
            const avg = Math.round(validValues.reduce((s, v) => s + v, 0) / validValues.length * 100) / 100;
            datasets.push({
                label: '前月平均 ' + cfg.label + ' (' + avg + ')',
                data: Array(data.length).fill(avg),
                borderColor: '#e04f24', backgroundColor: 'transparent',
                fill: false, tension: 0, pointRadius: 0, borderWidth: 2, borderDash: [8, 4]
            });
        }
    }

    const canvas = document.getElementById('kadou-analysis-chart');
    if (!canvas) return;

    charts['kadou-analysis-chart'] = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#787b7f', font: { family: "'Noto Sans JP', sans-serif" } } } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#e4e8ef' } },
                x: { grid: { display: false } }
            }
        }
    });
}

function toggleKadouAnalysisFilter(type, value) {
    if (type === 'project') {
        kadouAnalysisSelectedProjects = kadouAnalysisSelectedProjects.includes(value)
            ? kadouAnalysisSelectedProjects.filter(p => p !== value) : [...kadouAnalysisSelectedProjects, value];
    } else {
        kadouAnalysisSelectedMembers = kadouAnalysisSelectedMembers.includes(value)
            ? kadouAnalysisSelectedMembers.filter(m => m !== value) : [...kadouAnalysisSelectedMembers, value];
    }
    renderKadouAnalysis();
}

function clearKadouAnalysisFilters() {
    kadouAnalysisSelectedProjects = [];
    kadouAnalysisSelectedMembers = [];
    renderKadouAnalysis();
}

function setKadouChartType(type) {
    kadouCurrentChartType = type;
    renderKadouAnalysis();
}

function toggleKadouCompare() {
    kadouCompareMonthEnabled = document.getElementById('kadouCompareToggle').checked;
    // Hide absolute charts in compare mode
    const absoluteCharts = ['calls', 'pr', 'appo'];
    if (kadouCompareMonthEnabled && absoluteCharts.includes(kadouCurrentChartType)) {
        kadouCurrentChartType = 'callToPR';
    }
    renderKadouAnalysis();
}

// ========== Phase 5: 設定サブタブ ==========
async function loadAndRenderKadouSettings() {
    const container = document.getElementById('kadouSettingsContent');
    if (!kadouSettingsData) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-light);">データを読み込んでいます...</div>';
        try {
            const result = await fetchKadouSalesTargets();
            kadouSettingsData = result.targets || {};
        } catch (e) {
            container.innerHTML = `<div class="alert alert-danger">読み込みエラー: ${escapeHtml(e.message)}</div>`;
            return;
        }
    }
    renderKadouSettings();
}

function renderKadouSettings() {
    const container = document.getElementById('kadouSettingsContent');
    const targets = kadouSettingsData || {};

    // Generate Q months
    const quarters = [[3,4,5,6],[7,8,9],[10,11,12],[1,2]];
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const year = now.getFullYear();
    let currentQIdx = quarters.findIndex(q => q.includes(currentMonth));
    if (currentQIdx === -1) currentQIdx = 0;

    const months = [];
    const q = quarters[currentQIdx];
    q.forEach(m => {
        let y = year;
        if (m <= 2 && currentMonth >= 3) y = year + 1;
        const key = y + '-' + String(m).padStart(2, '0');
        months.push({ key, label: m + '月' });
    });

    container.innerHTML = `
        <div class="card">
            <div class="card-header"><h2>月別売上目標設定</h2></div>
            <div class="card-body">
                <div class="table-scroll">
                    <table class="data-table">
                        <thead><tr><th>月</th><th>売上目標</th></tr></thead>
                        <tbody id="kadouSettingsTableBody">
                            ${months.map(m => {
                                const val = targets[m.key] || '';
                                return `<tr data-month="${m.key}">
                                    <td style="font-weight:500;">${m.key.split('-')[0]}年${m.label}</td>
                                    <td>
                                        <input type="text" inputmode="numeric" class="kadou-settings-input" data-field="salesTarget"
                                               value="${val ? Number(val).toLocaleString() : ''}" placeholder="0">
                                        <span style="font-size:0.8rem;color:var(--text-light);margin-left:4px;">円</span>
                                    </td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                <div style="margin-top:16px;display:flex;align-items:center;gap:12px;">
                    <button class="btn btn-primary" onclick="saveKadouSettings()">保存</button>
                    <span id="kadouSettingsMessage" style="font-size:0.85rem;"></span>
                </div>
            </div>
        </div>
    `;
}

async function saveKadouSettings() {
    const rows = document.querySelectorAll('#kadouSettingsTableBody tr');
    const data = {};
    rows.forEach(row => {
        const month = row.dataset.month;
        const raw = row.querySelector('[data-field="salesTarget"]').value.replace(/,/g, '');
        data[month] = Number(raw) || 0;
    });

    const msgEl = document.getElementById('kadouSettingsMessage');
    try {
        const params = new URLSearchParams({ type: 'sales_targets_save', data: JSON.stringify(data) });
        const res = await fetch(`${KADOU_GAS_URL}?${params}`);
        const result = await res.json();
        if (result.error) throw new Error(result.error);
        msgEl.textContent = '保存しました';
        msgEl.style.color = 'var(--success)';
        // Clear pipeline cache
        kadouPipelineData = null;
        localStorage.removeItem('kadou_pipeline');
        kadouSettingsData = data;
    } catch (e) {
        msgEl.textContent = 'エラー: ' + e.message;
        msgEl.style.color = 'var(--danger)';
    }
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
}

// ========== 稼働報酬 案件CRUD ==========
let kadouEditingDealId = null;

function openKadouDealForm(dealId) {
    const modal = document.getElementById('kadouDealModal');
    const title = document.getElementById('kadouDealFormTitle');
    kadouEditingDealId = dealId || null;

    // Populate owner dropdown
    const select = document.getElementById('kdDealOwner');
    const existing = select.querySelectorAll('option:not(:first-child)');
    existing.forEach(o => o.remove());
    const owners = new Set();
    if (kadouPipelineData && kadouPipelineData.deals) {
        kadouPipelineData.deals.forEach(d => { if (d.owner) owners.add(d.owner); });
    }
    if (kadouMonthlyData && kadouMonthlyData.members) {
        kadouMonthlyData.members.forEach(m => { if (m.name) owners.add(m.name); });
    }
    Array.from(owners).sort().forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    });

    const deleteBtn = document.getElementById('kdDealDeleteBtn');

    if (dealId && kadouPipelineData && kadouPipelineData.deals) {
        const deal = kadouPipelineData.deals.find(d => String(d.id) === String(dealId));
        if (deal) {
            title.textContent = '案件を編集';
            document.getElementById('kdDealName').value = deal.deal_name || '';
            document.getElementById('kdDealOwner').value = deal.owner || '';
            document.getElementById('kdDealPhase').value = deal.phase || '提案前';
            document.getElementById('kdDealAmount').value = deal.amount || '';
            document.getElementById('kdDealProbability').value = deal.probability ? Math.round(Number(deal.probability) * 100) : '';
            document.getElementById('kdDealStartDate').value = deal.expected_start_date || '';
            document.getElementById('kdDealNextAction').value = deal.next_action || '';
            document.getElementById('kdDealDeadline').value = deal.action_deadline || '';
            document.getElementById('kdDealMemo').value = deal.memo || '';
            deleteBtn.style.display = '';
        }
    } else {
        title.textContent = '新規案件を追加';
        document.getElementById('kadouDealForm').reset();
        document.getElementById('kdDealPhase').value = '提案前';
        deleteBtn.style.display = 'none';
    }

    toggleKdDealFields();
    modal.classList.remove('hidden');
}

function closeKadouDealForm() {
    document.getElementById('kadouDealModal').classList.add('hidden');
    kadouEditingDealId = null;
}

function toggleKdDealFields() {
    const phase = document.getElementById('kdDealPhase').value;
    const isWon = (phase === '受注');
    document.getElementById('kdDealProbField').style.display = isWon ? 'none' : '';
    document.getElementById('kdDealActionFields').style.display = isWon ? 'none' : '';
    // 失注の場合もアクションフィールド非表示
    if (phase === '失注') {
        document.getElementById('kdDealActionFields').style.display = 'none';
    }
}

async function submitKadouDealForm() {
    const phase = document.getElementById('kdDealPhase').value;
    const isWon = (phase === '受注');
    const prob = document.getElementById('kdDealProbability').value;
    const data = {
        deal_name: document.getElementById('kdDealName').value,
        owner: document.getElementById('kdDealOwner').value,
        phase: phase,
        amount: Number(document.getElementById('kdDealAmount').value) || 0,
        probability: isWon ? 1 : (prob ? Number(prob) / 100 : 0),
        expected_start_date: document.getElementById('kdDealStartDate').value,
        next_action: isWon ? '' : document.getElementById('kdDealNextAction').value,
        action_deadline: isWon ? '' : document.getElementById('kdDealDeadline').value,
        memo: document.getElementById('kdDealMemo').value,
    };

    if (!data.deal_name || !data.owner) {
        showToast('案件名と担当者は必須です', true);
        return;
    }

    if (kadouEditingDealId) {
        data.id = kadouEditingDealId;
    }

    const btn = document.getElementById('kdDealSubmitBtn');
    btn.disabled = true;
    btn.textContent = '保存中...';

    try {
        // GAS Web App: GETで送信（元のsales_dashboardと同じ方式）
        const url = `${KADOU_GAS_URL}?type=deal_upsert&data=${encodeURIComponent(JSON.stringify(data))}`;
        console.log('Deal upsert URL:', url);
        const res = await fetch(url);
        console.log('Deal upsert response status:', res.status, res.ok);
        const text = await res.text();
        console.log('Deal upsert response:', text.substring(0, 200));
        let result;
        try { result = JSON.parse(text); } catch { result = { success: true }; }
        if (result.error) throw new Error(result.error);

        closeKadouDealForm();
        showToast('案件を保存しました');
        // Clear caches and reload
        kadouPipelineData = null;
        kadouMonthlyData = null;
        localStorage.removeItem('kadou_pipeline');
        localStorage.removeItem('kadou_monthly_' + getKadouMonth());
        await loadAndRenderKadouOverview();
    } catch (e) {
        console.error('Deal upsert error:', e);
        showToast('保存エラー: ' + e.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = '保存';
    }
}

async function deleteKadouDeal() {
    if (!kadouEditingDealId) return;
    const name = document.getElementById('kdDealName').value;
    if (!confirm(`「${name}」を削除しますか？`)) return;

    try {
        const url = `${KADOU_GAS_URL}?type=deal_delete&id=${encodeURIComponent(String(kadouEditingDealId))}`;
        console.log('Deal delete URL:', url);
        const res = await fetch(url);
        console.log('Deal delete response status:', res.status, res.ok);
        const text = await res.text();
        console.log('Deal delete response:', text.substring(0, 200));
        let result;
        try { result = JSON.parse(text); } catch { result = { success: true }; }
        if (result.error) throw new Error(result.error);

        closeKadouDealForm();
        showToast('案件を削除しました');
        kadouPipelineData = null;
        kadouMonthlyData = null;
        localStorage.removeItem('kadou_pipeline');
        localStorage.removeItem('kadou_monthly_' + getKadouMonth());
        await loadAndRenderKadouOverview();
    } catch (e) {
        console.error('Deal delete error:', e);
        showToast('削除エラー: ' + e.message, true);
    }
}

// Reload kadou data on month change
const _origOnMonthChange = onMonthChange;
onMonthChange = function() {
    // Reset kadou caches
    kadouMonthlyData = null;
    kadouPipelineData = null;
    kadouRawData = null;
    _origOnMonthChange();
    if (currentPage === 'team-kadou') {
        renderKadouSubTab(currentSubTab.kadou);
    }
};
