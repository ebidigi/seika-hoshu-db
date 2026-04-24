// ==================== Turso DB 設定 ====================
// TURSO_CONFIG は config.js から読み込み（セキュリティのためGit管理外）

// ==================== グローバル状態 ====================
let currentTab = 'management';
let performanceData = [];
let appointmentsData = [];
let membersData = [];
let teamsData = [];
let projectsData = [];
let targetsData = [];
let settingsMap = {};
// 2026年 日本の祝日（DB未登録時のフォールバック）
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
let holidaysSet = new Set(HOLIDAYS_2026);
let charts = {};
let currentAppoFilter = 'all';
let currentAnalysisView = 'daily';
let currentAnalysisChart = 'calls';
let assignmentsData = [];
let editingAssignmentId = null;
let editingMemberId = null;
let editingProjectId = null;
let teamHistoryData = []; // member_team_history 全データ
let executionAppoData = []; // 当月実施予定のアポ（前月以前取得含む）
let appoShowAll = false; // false=今日まで, true=全一覧
let appoSortKey = 'scheduled_date'; // デフォルトソートキー
let appoSortAsc = false; // false=降順

// ==================== 初期化 ====================
document.addEventListener('DOMContentLoaded', () => {
    // datalabelsプラグインをデフォルトOFF（円グラフだけ個別にON）
    if (window.ChartDataLabels) {
        Chart.register(ChartDataLabels);
        Chart.defaults.plugins.datalabels = { display: false };
    }
    // 月フィルターを2026年3月に固定
    const now = new Date();
    const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById('filterMonth').value = ym;

    // 日次目標の日付をデフォルトで明日に
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dailyTargetDateEl = document.getElementById('dailyTargetDate');
    if (dailyTargetDateEl) dailyTargetDateEl.value = formatDate(tomorrow);

    // 朝礼タブがデフォルトなのでフィルターを非表示
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

// ==================== 除外チーム・メンバー ====================
const EXCLUDED_TEAMS = [];
const EXCLUDED_MEMBERS = [];

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
    '宮城 啓生': '宮城', '宮城啓生': '宮城', '@宮城 啓生/miyagi hiroki': '宮城',
    '宮城一平': '宮城一平', '宮城 一平': '宮城一平', '@宮城一平': '宮城一平',
    '@田中颯汰/tanaka sota': '田中颯汰',
    '村上夢果': '村上', '村上 夢果': '村上', '@村上夢果': '村上',
    '三善一樹': '三善', '三善 一樹': '三善', '@三善一樹/miyoshi itsuki': '三善',
    '菊池幸平': '菊池', '菊池 幸平': '菊池', '@菊池幸平/kikuchi kohei': '菊池',
    '野上樹哉': '野上', '野上 樹哉': '野上', '@野上 樹哉/nogami jukiya': '野上',
    '池田愛': '池田', '池田 愛': '池田', '@池田愛/ikeda ai': '池田',
    '轟玲音': '轟', '轟 玲音': '轟',
    '清水陸斗': '清水', '清水 陸斗': '清水',
    '堀切友世': '堀切', '堀切 友世': '堀切',
    // 全社メンバー
    '堺敏寿': '堺', '堺 敏寿': '堺', '@堺敏寿/Sakai Toshihisa': '堺',
    '小甲陽平': '小甲', '小甲 陽平': '小甲', '@小甲陽平/Kokabu Yohei': '小甲',
    '増谷大輔': '増谷', '増谷 大輔': '増谷', '@増谷大輔/masuya daisuke': '増谷',
    '川上健斗': '川上', '川上 健斗': '川上', '@川上健斗/kento kawakami': '川上',
    '川野透也': '川野', '川野 透也': '川野', '@川野 透也/Kawano Yukiya': '川野',
    '浦上開至': '浦上', '浦上 開至': '浦上', '@浦上開至/Kaishin Urakami': '浦上',
    '秋元崇利': '秋元', '秋元 崇利': '秋元', '@秋元崇利/akimoto takatoshi': '秋元',
    '笹田怜央': '笹田', '笹田 怜央': '笹田', '@笹田 怜央/sasada reo': '笹田',
    '原田幸輝': '原田', '@原田幸輝': '原田',
    '田山喜也': '田山', '田山 喜也': '田山', '@田山 喜也/tayama yoshiya': '田山',
    '小西真次': '小西', '@小西真次': '小西',
    '岸田悠希': '岸田', '岸田 悠希': '岸田', '@Yuki Kishida / 岸田 悠希': '岸田',
    '中村優来': '中村ゆ', '中村 優来': '中村ゆ', '@中村 優来/nakamura yuuri': '中村ゆ',
    '中村凌': '中村り', '中村 凌': '中村り', '@中村凌/nakamura ryo': '中村り',
    '生井響': '生井', '生井 響': '生井', '@生井 響': '生井',
    '海老根涼太': '海老根', '海老根 涼太': '海老根', '@海老根涼太/ebine ryota': '海老根',
    // メールアドレス → DB正規名
    'k.matsui@digi-man.com': '松居',
    's.tsuboi@digi-man.com': '坪井',
    'j.noguchi@digi-man.com': '野口',
    'a.ikeda@digi-man.com': '池田',
    'y.horikiri@digi-man.com': '堀切',
    'r.todoroki@digi-man.com': '轟',
    'k.kawakami@digi-man.com': '川上',
    'katsu.tanaka@digi-man.com': '田中か',
    'k.muramatsu@digi-man.com': '村松',
    'h.miyagi@digi-man.com': '宮城',
    'i.miyagi@digi-man.com': '宮城一平',
    'y.nakamura@digi-man.com': '中村ゆ',
    't.nakamura@digi-man.com': '中村た',
    'r.nakamura@digi-man.com': '中村り',
    'r.shimizu@digi-man.com': '清水',
    't.akimoto@digi-man.com': '秋元',
    'r.sasada@digi-man.com': '笹田',
    'y.kokabu@digi-man.com': '小甲',
    'd.masuya@digi-man.com': '増谷',
    's.konishi@digi-man.com': '小西',
    'y.tayama@digi-man.com': '田山',
    'y.kawano@digi-man.com': '川野',
    'h.namai@digi-man.com': '生井',
    'r.ebine@digi-man.com': '海老根',
    't.sakai@digi-man.com': '堺',
    'k.kikuchi@digi-man.com': '菊池',
    'k.miyoshi@digi-man.com': '三善',
};

function normalizeMemberName(name) {
    if (!name) return name;
    if (MEMBER_NAME_NORMALIZE[name]) return MEMBER_NAME_NORMALIZE[name];
    // メールアドレス＋付加テキスト対応（例: "k.yamada@digi-man.com　香苗"）
    const emailMatch = name.match(/^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
        const email = emailMatch[1];
        if (MEMBER_NAME_NORMALIZE[email]) return MEMBER_NAME_NORMALIZE[email];
    }
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

// ==================== チーム月次解決 ====================
// 指定月のメンバー→チーム マッピングを返す
function getTeamsForMonth(ym) {
    const monthHistory = teamHistoryData.filter(h => h.year_month === ym);
    if (monthHistory.length === 0) {
        // フォールバック: 現在の members.team_name を使用
        const map = {};
        membersData.forEach(m => { map[m.member_name] = m.team_name; });
        return map;
    }
    const map = {};
    monthHistory.forEach(h => { map[h.member_name] = h.team_name; });
    return map;
}

// 指定月にアクティブなチーム名一覧
function getActiveTeamNames(ym) {
    const membership = getTeamsForMonth(ym);
    return [...new Set(Object.values(membership))].filter(t => t !== '所属なし' && t !== '未所属' && !EXCLUDED_TEAMS.includes(t)).sort();
}

// 除外チームのメンバー名一覧を取得
function getExcludedMembers(ym) {
    // teamHistoryとmembersData両方から除外対象を収集
    const excluded = new Set();
    const membership = getTeamsForMonth(ym);
    Object.entries(membership).forEach(([member, team]) => {
        if (EXCLUDED_TEAMS.includes(team)) excluded.add(member);
    });
    // membersDataからも直接チェック（historyに未登録のケース対応）
    membersData.forEach(m => {
        if (EXCLUDED_TEAMS.includes(m.team_name)) excluded.add(m.member_name);
    });
    return [...excluded];
}

// 指定月の特定チームに所属するメンバー名一覧
function getTeamMembersForMonth(teamName, ym) {
    const membership = getTeamsForMonth(ym);
    return Object.entries(membership)
        .filter(([_, team]) => team === teamName)
        .map(([member, _]) => member);
}

// チームフィルタドロップダウンを動的に生成
function populateTeamFilter() {
    const ym = document.getElementById('filterMonth').value;
    const select = document.getElementById('filterTeam');
    const current = select.value;
    select.innerHTML = '<option value="all">全体</option>';
    getActiveTeamNames(ym).forEach(team => {
        select.innerHTML += `<option value="${team}">${team}</option>`;
    });
    if ([...select.options].some(o => o.value === current)) {
        select.value = current;
    } else {
        select.value = 'all';
    }
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

// ==================== クロスチーム アポ補正 ====================
const CROSS_TEAM_APPO_RULES = [
    { member: '池田', fromTeam: '菊池Team', toTeam: '三善Team', acqMonth: '2026-03', execMonth: '2026-04' },
    { member: '田中颯汰', fromTeam: '三善Team', toTeam: '菊池Team', acqMonth: '2026-03', execMonth: '2026-04' }
];

function adjustExecAppoForTeam(execAppo, teamName, ym) {
    let adjusted = [...execAppo];
    CROSS_TEAM_APPO_RULES.forEach(rule => {
        if (ym !== rule.execMonth) return;
        if (teamName === rule.fromTeam) {
            adjusted = adjusted.filter(a => !(a.member_name === rule.member && a.acquisition_date && a.acquisition_date.startsWith(rule.acqMonth)));
        } else if (teamName === rule.toTeam) {
            const crossAppos = executionAppoData.filter(a => a.member_name === rule.member && a.acquisition_date && a.acquisition_date.startsWith(rule.acqMonth));
            adjusted = adjusted.concat(crossAppos);
        }
    });
    return deduplicateAppointments(adjusted);
}

// ==================== チーム統計集計 ====================
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
    const execCancelledAmount = execAppo.filter(a => a.status === 'キャンセル').reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const execRescheduleAmount = execAppo.filter(a => a.status === 'リスケ').reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const execForecast = execAmount + execUnconfirmedAmount;

    const teamTarget = getTarget('team', teamName, ym);
    const appoTarget = teamTarget ? (parseFloat(teamTarget.appointment_amount_target) || 0) : 0;
    const execTarget = teamTarget ? (parseFloat(teamTarget.execution_target) || 0) : 0;

    const callToPr = callCount > 0 ? prCount / callCount * 100 : 0;
    const prToAppo = prCount > 0 ? appoCount / prCount * 100 : 0;
    const callToAppo = callCount > 0 ? appoCount / callCount * 100 : 0;

    const allAppo = deduplicateAppointments([...appo, ...execAppo]);
    const execConfirmedCount = execAppo.filter(a => a.status === '実施').length;
    const appoToExec = allAppo.length > 0 ? execConfirmedCount / allAppo.length * 100 : 0;
    const statusCounts = { '未確認': 0, '実施': 0, 'リスケ': 0, 'キャンセル': 0 };
    allAppo.forEach(a => { if (statusCounts[a.status] !== undefined) statusCounts[a.status]++; });

    // 実施見込内訳（キャンセル・リスケ除外）
    const execAppoActive = execAppo.filter(a => a.status === '実施' || a.status === '未確認');
    const currentMonthExec = execAppoActive.filter(a => a.acquisition_date && a.acquisition_date.startsWith(ym));
    const prevMonthExec = execAppoActive.filter(a => a.acquisition_date && !a.acquisition_date.startsWith(ym));
    const currentMonthExecAmount = currentMonthExec.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const prevMonthExecAmount = prevMonthExec.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    // 当月アポ実施率 = 当月取得のうち当月実施見込 / 当月取得アポ金額
    const currentMonthAcqAmount = appo.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const currentMonthExecRate = currentMonthAcqAmount > 0 ? currentMonthExecAmount / currentMonthAcqAmount * 100 : 0;

    const projectNames = [...new Set(asg.map(a => a.project_name))];

    return {
        members, callCount, prCount, appoCount, appoAmount,
        execAmount, execUnconfirmedAmount, execCancelledAmount, execRescheduleAmount, execForecast,
        appoTarget, execTarget,
        callToPr, prToAppo, callToAppo, appoToExec,
        statusCounts, memberCount: members.length, projectCount: projectNames.length,
        currentMonthExecAmount, prevMonthExecAmount, currentMonthExecRate,
        perf, appo, execAppo, asg
    };
}

// ==================== メンバー自動登録 ====================
async function ensureMembers() {
    // 未登録メンバーの追加
    const requiredMembers = [
        { name: '川上', team: '未所属' },
        { name: '中村ゆ', team: '未所属' },
        { name: '宮城一平', team: '未所属' },
        { name: '岸田', team: '未所属' },
        { name: '田山', team: '未所属' },
    ];
    for (const m of requiredMembers) {
        await queryTurso(
            "INSERT OR IGNORE INTO members (id, member_name, team_name) VALUES (lower(hex(randomblob(16))), ?, ?)",
            [m.name, m.team]
        );
    }
    // inactiveになっている対象メンバーをactiveに復帰
    await queryTurso(
        "UPDATE members SET status = 'active' WHERE member_name IN ('田中か', '村松', '美除') AND status != 'active'"
    );
}

// ==================== データ読み込み ====================
async function loadAllData() {
    showLoading();
    try {
        await ensureMembers();
        console.log('Loading master data...');
        const results = await Promise.all([
            queryTurso("SELECT * FROM members WHERE status = 'active' ORDER BY team_name, member_name"),
            queryTurso("SELECT * FROM teams WHERE status = 'active'"),
            queryTurso("SELECT * FROM projects WHERE status = 'active' ORDER BY project_name"),
            queryTurso("SELECT * FROM settings"),
            queryTurso("SELECT date FROM holidays"),
            queryTurso("SELECT * FROM member_team_history ORDER BY year_month, team_name, member_name")
        ]);

        membersData = results[0];
        teamsData = results[1];
        projectsData = results[2];
        settingsMap = {};
        results[3].forEach(s => { settingsMap[s.key] = s.value; });
        holidaysSet = new Set(results[4].map(h => h.date));
        teamHistoryData = results[5];

        // DBの祝日をマージ（フォールバックのHOLIDAYS_2026に追加）
        results[4].forEach(h => { if (h.date) holidaysSet.add(h.date); });

        console.log('Master data loaded:', membersData.length, 'members,', teamsData.length, 'teams,', projectsData.length, 'projects,', holidaysSet.size, 'holidays,', teamHistoryData.length, 'team history');

        populateTeamFilter();
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
let currentAnalysisSub = 'performance';

function renderAll() {
    const filter = getFilters();
    const filteredPerf = filterPerformance(performanceData, filter);
    const filteredAppo = filterAppointments(appointmentsData, filter);
    const filteredExecAppo = filterAppointments(executionAppoData, filter);

    // 朝礼・経営はフィルタなし（全体表示）
    const noFilter = { team: 'all', member: 'all', month: filter.month };
    renderMorning(noFilter);
    renderManagement(noFilter);

    // 他のタブはフィルター適用
    renderAppointments();
    renderAnalysisNew(noFilter);
    renderProjects();
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
    const excluded = getExcludedMembers(filter.month);
    result = result.filter(d => !excluded.includes(d.member_name));
    if (filter.team !== 'all') {
        const teamMembers = getTeamMembersForMonth(filter.team, filter.month);
        result = result.filter(d => teamMembers.includes(d.member_name));
    }
    if (filter.member !== 'all') {
        result = result.filter(d => d.member_name === filter.member);
    }
    return result;
}

function filterAppointments(data, filter) {
    let result = data;
    const excluded = getExcludedMembers(filter.month);
    result = result.filter(d => !excluded.includes(d.member_name));
    if (filter.team !== 'all') {
        const teamMembers = getTeamMembersForMonth(filter.team, filter.month);
        result = result.filter(d => teamMembers.includes(d.member_name));
    }
    if (filter.member !== 'all') {
        result = result.filter(d => d.member_name === filter.member);
    }
    return result;
}

function applyFilters() {
    const ym = document.getElementById('filterMonth').value;

    // 月変更時にチームフィルタを更新
    populateTeamFilter();

    // チーム選択時にメンバーフィルターを更新
    const team = document.getElementById('filterTeam').value;
    const memberSelect = document.getElementById('filterMember');
    const currentMember = memberSelect.value;

    memberSelect.innerHTML = '<option value="all">全員</option>';
    const excluded = getExcludedMembers(ym);
    const teamMembers = team === 'all' ? membersData.map(m => m.member_name).filter(n => !excluded.includes(n)) : getTeamMembersForMonth(team, ym);
    const filtered = membersData.filter(m => teamMembers.includes(m.member_name));
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
    if (!select) return;
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
    const ym = document.getElementById('filterMonth').value;
    const memberTeamMap = getTeamsForMonth(ym);
    const teamMap = {};
    todayAppo.forEach(a => {
        const team = memberTeamMap[a.member_name] || '不明';
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

// ==================== Tab: 朝礼 ====================
function renderMorning(filter) {
    const ym = filter.month;
    const totalTarget = getTarget('total', 'all', ym);
    const monthlyTarget = totalTarget ? totalTarget.appointment_amount_target : parseInt(settingsMap.monthly_target_total || '9000000');
    const executionTarget = totalTarget ? (totalTarget.execution_target || monthlyTarget) : monthlyTarget;

    // 全体集計
    const excluded = getExcludedMembers(ym);
    const allPerf = performanceData.filter(d => !excluded.includes(d.member_name));
    const allAppo = appointmentsData.filter(d => !excluded.includes(d.member_name));
    const allExecAppo = executionAppoData.filter(d => !excluded.includes(d.member_name));

    const acquisitionAmount = allAppo.reduce((s, a) => s + (a.amount || 0), 0);
    const execConfirmed = allExecAppo.filter(a => a.status === '実施').reduce((s, a) => s + (a.amount || 0), 0);
    const execUnconfirmed = allExecAppo.filter(a => a.status === '未確認').reduce((s, a) => s + (a.amount || 0), 0);
    const execExpected = execConfirmed + execUnconfirmed;

    // 営業日
    const { elapsed, total: totalDays } = getBusinessDays(ym);
    const standardProgress = totalDays > 0 ? Math.round(elapsed / totalDays * 1000) / 10 : 0;
    const remaining = totalDays - elapsed;

    document.getElementById('progressBadge').textContent = `標準進捗: ${standardProgress}%`;
    document.getElementById('dateInfo').textContent = `${ym} | 経過 ${elapsed}日 / 全${totalDays}営業日`;

    // 取得進捗
    const acqRate = monthlyTarget > 0 ? Math.round(acquisitionAmount / monthlyTarget * 1000) / 10 : 0;
    const acqBarWidth = Math.min(acqRate, 100);
    const acqBarColor = acqRate >= standardProgress ? '#86aaec' : acqRate >= standardProgress * 0.8 ? '#ede07d' : '#ef947a';

    // 実施進捗
    const confirmedRate = executionTarget > 0 ? Math.round(execConfirmed / executionTarget * 1000) / 10 : 0;
    const confirmedBarWidth = Math.min(confirmedRate, 100);
    const confirmedBarColor = confirmedRate >= standardProgress ? '#86aaec' : confirmedRate >= standardProgress * 0.8 ? '#ede07d' : '#ef947a';

    // ラップ目標
    const lapTarget = Math.round(monthlyTarget * (elapsed / totalDays));
    const lapExecTarget = Math.round(executionTarget * (elapsed / totalDays));

    // 実施見込内訳（キャンセル・リスケ除外）
    const allExecAppoActive = allExecAppo.filter(a => a.status === '実施' || a.status === '未確認');
    const currentMonthExec = allExecAppoActive.filter(a => a.acquisition_date && a.acquisition_date.startsWith(ym));
    const prevMonthExec = allExecAppoActive.filter(a => a.acquisition_date && !a.acquisition_date.startsWith(ym));
    const currentMonthExecAmt = currentMonthExec.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const prevMonthExecAmt = prevMonthExec.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    // 当月アポ実施率 = 当月取得のうち当月実施見込 / 当月取得アポ金額
    const currentMonthExecRate = acquisitionAmount > 0 ? Math.round(currentMonthExecAmt / acquisitionAmount * 1000) / 10 : 0;

    // KPIカード（1カード1指標）
    document.getElementById('morningKpiBar').innerHTML = `
        <div class="morning-kpi-grid">
            <div class="morning-kpi-card">
                <div class="morning-kpi-label">取得金額</div>
                <div class="morning-kpi-value">¥${acquisitionAmount.toLocaleString()}</div>
                <div class="morning-kpi-sub" style="color:${acqBarColor};">達成率 ${acqRate}%</div>
                <div class="morning-kpi-bar">
                    <div class="morning-kpi-bar-fill" style="width:${acqBarWidth}%;background:${acqBarColor};"></div>
                    <div class="morning-kpi-bar-std" style="left:${Math.min(standardProgress, 100)}%;"></div>
                </div>
                <div class="morning-kpi-detail">目標 ¥${monthlyTarget.toLocaleString()}</div>
            </div>
            <div class="morning-kpi-card">
                <div class="morning-kpi-label">実施確定</div>
                <div class="morning-kpi-value" style="color:#90b8f8;">¥${execConfirmed.toLocaleString()}</div>
                <div class="morning-kpi-sub" style="color:${confirmedBarColor};">達成率 ${confirmedRate}%</div>
                <div class="morning-kpi-bar">
                    <div class="morning-kpi-bar-fill" style="width:${confirmedBarWidth}%;background:${confirmedBarColor};"></div>
                    <div class="morning-kpi-bar-std" style="left:${Math.min(standardProgress, 100)}%;"></div>
                </div>
                <div class="morning-kpi-detail">目標 ¥${executionTarget.toLocaleString()}</div>
            </div>
            <div class="morning-kpi-card">
                <div class="morning-kpi-label">実施見込（未確認）</div>
                <div class="morning-kpi-value">¥${execUnconfirmed.toLocaleString()}</div>
                <div class="morning-kpi-detail">当月 ¥${currentMonthExecAmt.toLocaleString()} / 越し ¥${prevMonthExecAmt.toLocaleString()}</div>
            </div>
            <div class="morning-kpi-card ${currentMonthExecRate < 60 ? 'morning-kpi-warn' : ''}">
                <div class="morning-kpi-label">当月アポ実施率</div>
                <div class="morning-kpi-value ${currentMonthExecRate < 60 ? 'morning-exec-warning' : ''}">${currentMonthExecRate}%${currentMonthExecRate < 60 ? ' ⚠' : ''}</div>
                <div class="morning-kpi-detail">当月取得のうち当月実施見込の割合</div>
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
    if (currentMonthExecRate < 60) {
        alerts.push(`当月アポ実施率が${currentMonthExecRate}%です。月内アポ組みを強化してください。`);
    }
    document.getElementById('morningAlerts').innerHTML = alerts.map(a =>
        `<div class="alert-banner"><span class="alert-banner-icon">&#9888;</span><span class="alert-banner-text">${a}</span></div>`
    ).join('');

    // チーム比較テーブル
    const teamNames = getActiveTeamNames(ym);
    const teamRows = teamNames.map(teamName => {
        const s = computeTeamStats(teamName, ym);
        const lap = totalDays > 0 ? Math.round(s.appoTarget * (elapsed / totalDays)) : 0;
        const acqR = s.appoTarget > 0 ? Math.round(s.appoAmount / s.appoTarget * 1000) / 10 : 0;
        const execR = s.execTarget > 0 ? Math.round(s.execAmount / s.execTarget * 1000) / 10 : 0;
        const acqColor = acqR >= standardProgress ? '#86aaec' : acqR >= standardProgress * 0.8 ? '#ede07d' : '#ef947a';
        const execColor = execR >= standardProgress ? '#86aaec' : execR >= standardProgress * 0.8 ? '#ede07d' : '#ef947a';
        const execWarn = s.currentMonthExecRate < 60;
        return { teamName, s, lap, acqR, execR, acqColor, execColor, execWarn };
    });

    // 合計行の計算
    const totals = {
        appoTarget: teamRows.reduce((s, r) => s + r.s.appoTarget, 0),
        appoAmount: teamRows.reduce((s, r) => s + r.s.appoAmount, 0),
        execTarget: teamRows.reduce((s, r) => s + r.s.execTarget, 0),
        execAmount: teamRows.reduce((s, r) => s + r.s.execAmount, 0),
        execUnconfirmed: teamRows.reduce((s, r) => s + r.s.execUnconfirmedAmount, 0),
        currentMonthExec: teamRows.reduce((s, r) => s + r.s.currentMonthExecAmount, 0),
        prevMonthExec: teamRows.reduce((s, r) => s + r.s.prevMonthExecAmount, 0),
    };
    const totalLap = totalDays > 0 ? Math.round(totals.appoTarget * (elapsed / totalDays)) : 0;
    const totalAcqR = totals.appoTarget > 0 ? Math.round(totals.appoAmount / totals.appoTarget * 1000) / 10 : 0;
    const totalExecR = totals.execTarget > 0 ? Math.round(totals.execAmount / totals.execTarget * 1000) / 10 : 0;
    const totalCurrentExecRate = totals.appoAmount > 0 ? Math.round(totals.currentMonthExec / totals.appoAmount * 1000) / 10 : 0;

    let tableHtml = `
    <div class="morning-table-wrap">
        <table class="morning-compare-table">
            <thead>
                <tr>
                    <th>チーム</th>
                    <th class="text-right">取得目標</th>
                    <th class="text-right">ラップ</th>
                    <th class="text-right">取得実績</th>
                    <th class="text-right">達成率</th>
                    <th style="width:80px;">進捗</th>
                    <th class="text-right">実施目標</th>
                    <th class="text-right">実施確定</th>
                    <th class="text-right">達成率</th>
                    <th class="text-right">見込(未確認)</th>
                    <th class="text-right">当月実施率</th>
                </tr>
            </thead>
            <tbody>`;

    teamRows.forEach(r => {
        tableHtml += `
                <tr>
                    <td class="morning-team-cell">${escapeHtml(r.teamName.replace('Team', ''))}<span class="morning-member-count">${r.s.memberCount}名</span></td>
                    <td class="text-right">¥${r.s.appoTarget.toLocaleString()}</td>
                    <td class="text-right" style="color:var(--text-light);">¥${r.lap.toLocaleString()}</td>
                    <td class="text-right" style="font-weight:700;">¥${r.s.appoAmount.toLocaleString()}</td>
                    <td class="text-right" style="font-weight:600;color:${r.acqColor};">${r.acqR}%</td>
                    <td>
                        <div class="morning-inline-bar">
                            <div class="morning-inline-fill" style="width:${Math.min(r.acqR, 100)}%;background:${r.acqColor};"></div>
                            <div class="morning-inline-standard" style="left:${Math.min(standardProgress, 100)}%;"></div>
                        </div>
                    </td>
                    <td class="text-right">¥${r.s.execTarget.toLocaleString()}</td>
                    <td class="text-right" style="font-weight:700;">¥${r.s.execAmount.toLocaleString()}</td>
                    <td class="text-right" style="font-weight:600;color:${r.execColor};">${r.execR}%</td>
                    <td class="text-right">¥${r.s.execUnconfirmedAmount.toLocaleString()}</td>
                    <td class="text-right ${r.execWarn ? 'morning-exec-warning' : ''}" style="font-weight:600;">${r.s.currentMonthExecRate.toFixed(1)}%${r.execWarn ? ' ⚠' : ''}</td>
                </tr>`;
    });

    // 合計行
    const totalAcqColor = totalAcqR >= standardProgress ? '#86aaec' : totalAcqR >= standardProgress * 0.8 ? '#ede07d' : '#ef947a';
    const totalExecColor = totalExecR >= standardProgress ? '#86aaec' : totalExecR >= standardProgress * 0.8 ? '#ede07d' : '#ef947a';
    tableHtml += `
            </tbody>
            <tfoot>
                <tr class="morning-total-row">
                    <td class="morning-team-cell" style="font-weight:700;">合計</td>
                    <td class="text-right">¥${totals.appoTarget.toLocaleString()}</td>
                    <td class="text-right" style="color:var(--text-light);">¥${totalLap.toLocaleString()}</td>
                    <td class="text-right" style="font-weight:700;">¥${totals.appoAmount.toLocaleString()}</td>
                    <td class="text-right" style="font-weight:700;color:${totalAcqColor};">${totalAcqR}%</td>
                    <td>
                        <div class="morning-inline-bar">
                            <div class="morning-inline-fill" style="width:${Math.min(totalAcqR, 100)}%;background:${totalAcqColor};"></div>
                            <div class="morning-inline-standard" style="left:${Math.min(standardProgress, 100)}%;"></div>
                        </div>
                    </td>
                    <td class="text-right">¥${totals.execTarget.toLocaleString()}</td>
                    <td class="text-right" style="font-weight:700;">¥${totals.execAmount.toLocaleString()}</td>
                    <td class="text-right" style="font-weight:700;color:${totalExecColor};">${totalExecR}%</td>
                    <td class="text-right">¥${totals.execUnconfirmed.toLocaleString()}</td>
                    <td class="text-right" style="font-weight:700;">${totalCurrentExecRate}%</td>
                </tr>
            </tfoot>
        </table>
    </div>`;

    document.getElementById('morningTeamCards').innerHTML = tableHtml;
}

// ==================== Tab: 経営 ====================
// 経営タブ用チャートインスタンス管理
const mgmtCharts = {};
let mgmtPeriod = 'month'; // 'day' | 'week' | 'month' | 'quarter'

function switchMgmtPeriod(period) {
    mgmtPeriod = period;
    document.querySelectorAll('.mgmt-period-btn').forEach(b => b.classList.toggle('active', b.dataset.period === period));
    // Q別はデータ追加ロードが必要
    if (period === 'quarter') {
        loadQuarterDataAndRender();
    } else {
        const noFilter = { month: document.getElementById('filterMonth').value };
        renderManagement(noFilter);
    }
}

async function loadQuarterDataAndRender() {
    const ym = document.getElementById('filterMonth').value;
    const [y, m] = ym.split('-').map(Number);
    const qStart = m <= 3 ? 1 : m <= 6 ? 4 : m <= 9 ? 7 : 10;
    const months = [0, 1, 2].map(i => y + '-' + String(qStart + i).padStart(2, '0'));
    const startDate = months[0] + '-01';
    const endM = qStart + 2;
    const endDate = y + '-' + String(endM).padStart(2, '0') + '-' + new Date(y, endM, 0).getDate();
    try {
        const [perf, appo, exec] = await Promise.all([
            queryTurso("SELECT * FROM performance_rawdata WHERE input_date >= ? AND input_date <= ?", [startDate, endDate]),
            queryTurso("SELECT * FROM appointments WHERE acquisition_date >= ? AND acquisition_date <= ?", [startDate, endDate]),
            queryTurso("SELECT * FROM appointments WHERE scheduled_date >= ? AND scheduled_date <= ?", [startDate, endDate])
        ]);
        normalizeDataMemberNames(perf); normalizeDataMemberNames(appo); normalizeDataMemberNames(exec);
        window._mgmtQuarterData = { perf: deduplicatePerformance(perf), appo: deduplicateAppointments(appo), exec: deduplicateAppointments(exec), months };
        renderManagement({ month: ym });
    } catch (e) { console.error('Quarter load error', e); }
}

// 期間に応じたデータフィルタ
function filterByMgmtPeriod(perfData, appoData, execAppoData, ym) {
    if (mgmtPeriod === 'month') return { perf: perfData, appo: appoData, exec: execAppoData };

    if (mgmtPeriod === 'quarter' && window._mgmtQuarterData) {
        return { perf: window._mgmtQuarterData.perf, appo: window._mgmtQuarterData.appo, exec: window._mgmtQuarterData.exec };
    }

    const today = new Date();
    let startDate, endDate;
    if (mgmtPeriod === 'day') {
        startDate = endDate = formatDate(today);
    } else if (mgmtPeriod === 'week') {
        const dow = today.getDay();
        const mon = new Date(today);
        mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
        const sun = new Date(mon);
        sun.setDate(mon.getDate() + 6);
        startDate = formatDate(mon);
        endDate = formatDate(sun);
    }
    return {
        perf: perfData.filter(d => d.input_date >= startDate && d.input_date <= endDate),
        appo: appoData.filter(d => d.acquisition_date >= startDate && d.acquisition_date <= endDate),
        exec: execAppoData.filter(d => d.scheduled_date >= startDate && d.scheduled_date <= endDate)
    };
}
function destroyMgmtCharts() {
    Object.keys(mgmtCharts).forEach(k => { if (mgmtCharts[k]) { mgmtCharts[k].destroy(); delete mgmtCharts[k]; } });
}

// ゲージチャート描画（半円doughnut + 標準進捗マーカー）
function createGaugeChart(canvasId, value, max, standardPct, label, subLabel) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const pct = max > 0 ? Math.min(value / max, 1.2) : 0;
    const color = (pct * 100) >= standardPct ? '#86aaec' : (pct * 100) >= standardPct * 0.8 ? '#ede07d' : '#ef947a';

    // 標準進捗マーカー: グラフ円弧上にラインを描画
    const needlePlugin = {
        id: 'gaugeNeedle_' + canvasId,
        afterDatasetDraw(chart) {
            const { ctx: c, chartArea } = chart;
            const cx = (chartArea.left + chartArea.right) / 2;
            const cy = chartArea.bottom;
            const outerR = Math.min(chartArea.right - chartArea.left, (chartArea.bottom - chartArea.top)) * 0.92;
            const innerR = outerR * 0.62; // cutout比率に合わせる
            const angle = Math.PI + (standardPct / 100) * Math.PI; // 0%=π(左), 100%=2π(右)
            // 円弧上にライン
            const x1 = cx + (innerR - 4) * Math.cos(angle);
            const y1 = cy + (innerR - 4) * Math.sin(angle);
            const x2 = cx + (outerR + 4) * Math.cos(angle);
            const y2 = cy + (outerR + 4) * Math.sin(angle);
            c.save();
            c.beginPath();
            c.moveTo(x1, y1);
            c.lineTo(x2, y2);
            c.strokeStyle = '#333';
            c.lineWidth = 2.5;
            c.stroke();
            c.restore();
            // 標準ラベル（円弧の帯の中央に配置）
            const midR = (innerR + outerR) / 2;
            const lx = cx + midR * Math.cos(angle);
            const ly = cy + midR * Math.sin(angle);
            // ラインに沿って回転させて描画
            c.save();
            c.translate(lx, ly);
            const textAngle = angle + Math.PI / 2; // ラインに垂直
            c.rotate(textAngle);
            c.font = '700 8px "Noto Sans JP"';
            c.fillStyle = '#fff';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            // 背景ピル
            const txt = `標準 ${standardPct}%`;
            const tw = c.measureText(txt).width + 8;
            c.fillStyle = 'rgba(51,51,51,0.75)';
            c.beginPath();
            c.roundRect(-tw / 2, -8, tw, 16, 4);
            c.fill();
            c.fillStyle = '#fff';
            c.fillText(txt, 0, 0);
            c.restore();
        }
    };

    mgmtCharts[canvasId] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [Math.min(pct, 1) * 100, Math.max(100 - pct * 100, 0)],
                backgroundColor: [color, '#f0f0f0'],
                borderWidth: 0,
                circumference: 180,
                rotation: 270,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            layout: { padding: { top: 0 } },
            plugins: {
                tooltip: { enabled: false },
                legend: { display: false },
            },
            layout: { padding: { top: 0, bottom: 0 } },
        },
        plugins: [needlePlugin, {
            id: 'gaugeCenter_' + canvasId,
            afterDraw(chart) {
                const { ctx: c, chartArea } = chart;
                const cx = (chartArea.left + chartArea.right) / 2;
                const cy = chartArea.bottom;
                c.save();
                c.textAlign = 'center';
                c.fillStyle = '#1a1a1a';
                c.font = '700 22px "Poppins", sans-serif';
                c.fillText('¥' + value.toLocaleString(), cx, cy - 20);
                c.font = '500 11px "Noto Sans JP"';
                c.fillStyle = '#888';
                c.fillText(subLabel, cx, cy - 2);
                c.restore();
            }
        }]
    });
}

function showMemberDetailPopup(memberName, perfData, appoData, execAppoData_) {
    const calls = sum(perfData.filter(d => d.member_name === memberName), 'call_count');
    const pr = sum(perfData.filter(d => d.member_name === memberName), 'pr_count');
    const appo = sum(perfData.filter(d => d.member_name === memberName), 'appointment_count');
    const hours = sum(perfData.filter(d => d.member_name === memberName), 'call_hours');
    const days = new Set(perfData.filter(d => d.member_name === memberName).map(r => r.input_date)).size;
    const amount = appoData.filter(a => a.member_name === memberName).reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const execConfirmed = (execAppoData_ || []).filter(a => a.member_name === memberName && a.status === '実施').reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);

    const stats = {
        calls, pr, appo, amount, execConfirmed, hours, days,
        dailyCalls: days > 0 ? Math.round(calls / days) : 0,
        hourly: hours > 0 ? calls / hours : 0,
        callToPr: calls > 0 ? pr / calls * 100 : 0,
        prToAppo: pr > 0 ? appo / pr * 100 : 0,
        callToAppo: calls > 0 ? appo / calls * 100 : 0,
    };

    const metrics = [
        { key: 'calls', label: '架電数', fmt: v => v.toLocaleString() },
        { key: 'pr', label: '着電数', fmt: v => v.toLocaleString() },
        { key: 'appo', label: 'アポ数', fmt: v => v.toLocaleString() },
        { key: 'amount', label: '取得金額', fmt: v => '¥' + v.toLocaleString() },
        { key: 'execConfirmed', label: '実施確定金額', fmt: v => '¥' + v.toLocaleString() },
        { key: 'hours', label: '架電時間', fmt: v => v.toFixed(1) + 'h' },
        { key: 'days', label: '稼働日数', fmt: v => v + '日' },
        { key: 'dailyCalls', label: '日次架電', fmt: v => v.toLocaleString() },
        { key: 'hourly', label: '1hあたり架電数', fmt: v => v.toFixed(1) },
        { key: 'callToPr', label: '架→着電率', fmt: v => v.toFixed(1) + '%' },
        { key: 'prToAppo', label: '着電→アポ率', fmt: v => v.toFixed(1) + '%' },
        { key: 'callToAppo', label: '架→アポ率', fmt: v => v.toFixed(1) + '%' },
    ];

    let html = '<div class="member-detail-grid">';
    metrics.forEach(m => {
        html += `<div class="member-detail-tile">
            <div class="md-label">${m.label}</div>
            <div class="md-value">${m.fmt(stats[m.key])}</div>
        </div>`;
    });
    html += '</div>';

    document.getElementById('memberDetailTitle').textContent = memberName;
    document.getElementById('memberDetailBody').innerHTML = html;
    document.getElementById('memberDetailModal').classList.remove('hidden');
}

function closeMemberDetail() {
    document.getElementById('memberDetailModal').classList.add('hidden');
}

function renderManagement(filter) {
    destroyMgmtCharts();
    const ym = filter.month;
    const totalTarget = getTarget('total', 'all', ym);
    const monthlyTarget = totalTarget ? totalTarget.appointment_amount_target : parseInt(settingsMap.monthly_target_total || '9000000');
    const executionTarget = totalTarget ? (totalTarget.execution_target || monthlyTarget) : monthlyTarget;
    const RESKED_CANCEL_RATE = 0.15;

    const excluded = getExcludedMembers(ym);
    const periodData = filterByMgmtPeriod(
        performanceData.filter(d => !excluded.includes(d.member_name)),
        appointmentsData.filter(d => !excluded.includes(d.member_name)),
        executionAppoData.filter(d => !excluded.includes(d.member_name)),
        ym
    );
    const allPerf = periodData.perf;
    const allAppo = periodData.appo;
    const allExecAppo = periodData.exec;

    const acquisitionAmount = allAppo.reduce((s, a) => s + (a.amount || 0), 0);
    const execConfirmed = allExecAppo.filter(a => a.status === '実施').reduce((s, a) => s + (a.amount || 0), 0);
    const execUnconfirmed = allExecAppo.filter(a => a.status === '未確認').reduce((s, a) => s + (a.amount || 0), 0);
    const execCancelledAmt = allExecAppo.filter(a => a.status === 'キャンセル').reduce((s, a) => s + (a.amount || 0), 0);
    const execRescheduleAmt = allExecAppo.filter(a => a.status === 'リスケ').reduce((s, a) => s + (a.amount || 0), 0);

    const { elapsed, total: totalDays } = getBusinessDays(ym);
    const standardProgress = totalDays > 0 ? Math.round(elapsed / totalDays * 1000) / 10 : 0;
    const acqRate = monthlyTarget > 0 ? Math.round(acquisitionAmount / monthlyTarget * 1000) / 10 : 0;
    const execRate = executionTarget > 0 ? Math.round(execConfirmed / executionTarget * 1000) / 10 : 0;

    // 実施見込内訳
    const allExecAppoActive = allExecAppo.filter(a => a.status === '実施' || a.status === '未確認');
    const currentMonthExecAmt = allExecAppoActive.filter(a => a.acquisition_date && a.acquisition_date.startsWith(ym)).reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const prevMonthExecAmt = allExecAppoActive.filter(a => a.acquisition_date && !a.acquisition_date.startsWith(ym)).reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);

    // 着地ヨミ
    const execForecast = execConfirmed + Math.round(execUnconfirmed * (1 - RESKED_CANCEL_RATE));
    const forecastDiff = execForecast - executionTarget;
    const forecastColor = forecastDiff >= 0 ? '#86aaec' : '#ef947a';

    // アポ実施タイミング内訳（全アポ対象: 取得月×実施月の組み合わせ）
    const allAppoActive = allAppo.filter(a => a.status !== 'キャンセル');
    // 前月以前取得→当月実施
    const timingPrevToThis = allExecAppoActive.filter(a => a.acquisition_date && !a.acquisition_date.startsWith(ym)).reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    // 当月取得→当月実施
    const timingThisToThis = allExecAppoActive.filter(a => a.acquisition_date && a.acquisition_date.startsWith(ym)).reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    // 当月取得→来月以降実施（当月取得アポのうち、実施予定が来月以降 or 実施予定なし）
    const timingThisToFuture = allAppoActive.filter(a => {
        if (!a.acquisition_date || !a.acquisition_date.startsWith(ym)) return false;
        return !a.scheduled_date || !a.scheduled_date.startsWith(ym);
    }).reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const timingTotal = timingPrevToThis + timingThisToThis + timingThisToFuture;

    // 全体KPI
    const totalCalls = sum(allPerf, 'call_count');
    const totalPr = sum(allPerf, 'pr_count');
    const totalAppoCount = sum(allPerf, 'appointment_count');
    const mgCallToPr = totalCalls > 0 ? (totalPr / totalCalls * 100).toFixed(1) : '0';
    const mgPrToAppo = totalPr > 0 ? (totalAppoCount / totalPr * 100).toFixed(1) : '0';
    const mgCallToAppo = totalCalls > 0 ? (totalAppoCount / totalCalls * 100).toFixed(1) : '0';
    const appoWithinMonth = allAppo.filter(a => a.scheduled_date && a.scheduled_date.startsWith(ym)).length;
    const appoWithinMonthRate = allAppo.length > 0 ? (appoWithinMonth / allAppo.length * 100).toFixed(1) : '0';
    const avgUnitPrice = allAppo.length > 0 ? Math.round(acquisitionAmount / allAppo.length) : 0;
    const execTotal = allExecAppo.length;
    const execCancelCount = allExecAppo.filter(a => a.status === 'キャンセル').length;
    const cancelRateVal = execTotal > 0 ? (execCancelCount / execTotal * 100).toFixed(1) : '0';
    const execConfirmedCount = allExecAppo.filter(a => a.status === '実施').length;
    const execConfirmRateVal = execTotal > 0 ? (execConfirmedCount / execTotal * 100).toFixed(1) : '0';

    // 稼働系KPI
    const totalHours = sum(allPerf, 'call_hours');
    const totalWorkDays = new Set(allPerf.map(r => r.member_name + '_' + r.input_date)).size;
    const totalMemberDays = (() => {
        const memberDays = {};
        allPerf.forEach(r => {
            if (!memberDays[r.member_name]) memberDays[r.member_name] = new Set();
            memberDays[r.member_name].add(r.input_date);
        });
        return Object.values(memberDays).reduce((s, set) => s + set.size, 0);
    })();
    const callsPerHour = totalHours > 0 ? (totalCalls / totalHours).toFixed(1) : '0';
    const callsPerDay = totalMemberDays > 0 ? Math.round(totalCalls / totalMemberDays).toLocaleString() : '0';
    const hoursPerDay = totalMemberDays > 0 ? (totalHours / totalMemberDays).toFixed(1) : '0';

    // ========== 個人別データ準備（ランキング用） ==========
    const activeMembers = membersData.filter(m => m.status === 'active' && !excluded.includes(m.member_name));
    const teamNames = getActiveTeamNames(ym);
    const memberData = [];
    teamNames.forEach(teamName => {
        const teamMembers = getTeamMembersForMonth(teamName, ym).filter(n => activeMembers.some(m => m.member_name === n));
        teamMembers.forEach(memberName => {
            const mTarget = getTarget('member', memberName, ym);
            const mAcqTarget = mTarget ? (parseFloat(mTarget.appointment_amount_target) || 0) : 0;
            const mPerf = allPerf.filter(d => d.member_name === memberName);
            const mAppo = allAppo.filter(d => d.member_name === memberName);
            const mAppoAmount = mAppo.reduce((s, a) => s + (a.amount || 0), 0);
            const mNewAmount = mAppo.filter(a => (a.memo || '').includes('新規')).reduce((s, a) => s + (a.amount || 0), 0);
            const mExistingAmount = mAppoAmount - mNewAmount;
            const mCallCount = sum(mPerf, 'call_count');
            const mPrCount = sum(mPerf, 'pr_count');
            const mAppoCount = sum(mPerf, 'appointment_count');
            memberData.push({ name: memberName, target: mAcqTarget, actual: mAppoAmount, actualNew: mNewAmount, actualExisting: mExistingAmount, calls: mCallCount, pr: mPrCount, appo: mAppoCount });
        });
    });

    // ========== 案件別データ準備 ==========
    const capData = projectsData.filter(p => p.status === 'active').map(proj => {
        const projPerf = allPerf.filter(d => d.project_name === proj.project_name);
        const projAppo = allAppo.filter(d => d.project_name === proj.project_name);
        const callCount = sum(projPerf, 'call_count');
        const prCount = sum(projPerf, 'pr_count');
        const appoCount = sum(projPerf, 'appointment_count');
        const unitPrice = proj.unit_price || 0;
        const actualCount = projAppo.length;
        const actualAmount = projAppo.reduce((s, a) => s + (a.amount || 0), 0);
        const capCount = proj.monthly_cap_count || 0;
        const capAmount = capCount * unitPrice;
        const consumeRate = capCount > 0 ? Math.round(actualCount / capCount * 100) : 0;
        const remaining = capCount > 0 ? capCount - actualCount : null;
        const cancelCount = projAppo.filter(a => a.status === 'キャンセル').length;
        const cancelRate = actualCount > 0 ? Math.round(cancelCount / actualCount * 100) : 0;
        const callToPr = callCount > 0 ? (prCount / callCount * 100).toFixed(1) : '-';
        const prToAppo = prCount > 0 ? (appoCount / prCount * 100).toFixed(1) : '-';
        const callToAppo = callCount > 0 ? (appoCount / callCount * 100).toFixed(1) : '-';
        return { name: proj.project_name, unitPrice, capCount, capAmount, actualCount, actualAmount, consumeRate, remaining, cancelCount, cancelRate, callToPr, prToAppo, callToAppo };
    }).filter(c => c.capCount > 0 || c.actualCount > 0);

    // 案件テーブルHTML
    let projTableHtml = `<div style="overflow-x:auto;"><table class="data-table"><thead><tr>
        <th>案件名</th><th class="text-right">単価</th>
        <th class="text-right" style="background:#eef3fb;color:#6b8cba;">キャップ</th><th class="text-right" style="background:#eef3fb;color:#6b8cba;">キャップ金額</th>
        <th class="text-right">取得数</th><th class="text-right">取得金額</th><th class="text-right">消化率</th><th class="text-right">残り</th>
        <th class="text-right" style="background:#fdf2f0;color:#c0392b;">キャンセル率</th>
        <th class="text-right">架→着電</th><th class="text-right">着電→アポ</th><th class="text-right">架→アポ</th>
    </tr></thead><tbody>`;
    let ttCapCount = 0, ttActCount = 0, ttCapAmt = 0, ttActAmt = 0, ttCancelCount = 0;
    capData.forEach(c => {
        ttCapCount += c.capCount; ttActCount += c.actualCount;
        ttCapAmt += c.capAmount; ttActAmt += c.actualAmount; ttCancelCount += c.cancelCount;
        const cColor = c.consumeRate >= 90 ? '#ef947a' : c.consumeRate >= 70 ? '#ede07d' : '#86aaec';
        const crColor = c.cancelRate >= 20 ? '#c0392b' : c.cancelRate >= 15 ? '#e67e22' : '#2d3436';
        projTableHtml += `<tr>
            <td style="font-weight:600;">${escapeHtml(c.name)}</td>
            <td class="text-right">¥${c.unitPrice.toLocaleString()}</td>
            <td class="text-right" style="background:#f4f7fc;color:#6b8cba;">${c.capCount > 0 ? c.capCount + '件' : '-'}</td>
            <td class="text-right" style="background:#f4f7fc;color:#6b8cba;">${c.capAmount > 0 ? '¥' + c.capAmount.toLocaleString() : '-'}</td>
            <td class="text-right">${c.actualCount}件</td>
            <td class="text-right">¥${c.actualAmount.toLocaleString()}</td>
            <td class="text-right" style="font-weight:600;color:${cColor};">${c.capCount > 0 ? c.consumeRate + '%' : '-'}</td>
            <td class="text-right">${c.remaining !== null ? c.remaining + '件' : '-'}</td>
            <td class="text-right" style="background:#fdf8f7;font-weight:600;color:${crColor};">${c.actualCount > 0 ? c.cancelRate + '%' : '-'}<span style="font-weight:400;font-size:0.7rem;color:#999;"> (${c.cancelCount}件)</span></td>
            <td class="text-right">${c.callToPr}%</td>
            <td class="text-right">${c.prToAppo}%</td>
            <td class="text-right">${c.callToAppo}%</td>
        </tr>`;
    });
    projTableHtml += `</tbody><tfoot><tr style="font-weight:600;">
        <td>合計</td><td></td>
        <td class="text-right" style="background:#f4f7fc;color:#6b8cba;">${ttCapCount}件</td><td class="text-right" style="background:#f4f7fc;color:#6b8cba;">¥${ttCapAmt.toLocaleString()}</td>
        <td class="text-right">${ttActCount}件</td><td class="text-right">¥${ttActAmt.toLocaleString()}</td>
        <td class="text-right">${ttCapCount > 0 ? Math.round(ttActCount / ttCapCount * 100) + '%' : '-'}</td>
        <td class="text-right">${ttCapCount > 0 ? (ttCapCount - ttActCount) + '件' : '-'}</td>
        <td class="text-right" style="background:#fdf8f7;font-weight:600;color:${(ttActCount > 0 ? Math.round(ttCancelCount / ttActCount * 100) : 0) >= 15 ? '#c0392b' : '#2d3436'};">${ttActCount > 0 ? Math.round(ttCancelCount / ttActCount * 100) + '%' : '-'}<span style="font-weight:400;font-size:0.7rem;color:#999;"> (${ttCancelCount}件)</span></td>
        <td></td><td></td><td></td>
    </tr></tfoot></table></div>`;

    // 期間ラベル
    const periodLabels = { day: '日別', week: '週別', month: '月別', quarter: 'Q別' };

    // ========== HTML構築 ==========
    let html = `
    <!-- 期間切替 -->
    <div class="mgmt-period-bar">
        <button class="mgmt-period-btn ${mgmtPeriod === 'day' ? 'active' : ''}" data-period="day" onclick="switchMgmtPeriod('day')">日別</button>
        <button class="mgmt-period-btn ${mgmtPeriod === 'week' ? 'active' : ''}" data-period="week" onclick="switchMgmtPeriod('week')">週別</button>
        <button class="mgmt-period-btn ${mgmtPeriod === 'month' ? 'active' : ''}" data-period="month" onclick="switchMgmtPeriod('month')">月別</button>
        <button class="mgmt-period-btn ${mgmtPeriod === 'quarter' ? 'active' : ''}" data-period="quarter" onclick="switchMgmtPeriod('quarter')">Q別</button>
        <span class="mgmt-period-label">${periodLabels[mgmtPeriod]}表示</span>
    </div>

    <!-- トップ3カード: ゲージ×2 + ヨミ -->
    <div class="mgmt-top-cards">
        <div class="mgmt-gauge-card">
            <div class="mgmt-gauge-title">取得金額</div>
            <div class="mgmt-gauge-wrap"><canvas id="mgmtGaugeAcq"></canvas></div>
            <div class="mgmt-gauge-footer">目標 ¥${monthlyTarget.toLocaleString()}</div>
        </div>
        <div class="mgmt-gauge-card">
            <div class="mgmt-gauge-title">実施確定金額</div>
            <div class="mgmt-gauge-wrap"><canvas id="mgmtGaugeExec"></canvas></div>
            <div class="mgmt-gauge-footer">目標 ¥${executionTarget.toLocaleString()}</div>
        </div>
        <div class="mgmt-gauge-card mgmt-yomi-card">
            <div class="mgmt-gauge-title">着地ヨミ<span style="font-size:0.7rem;color:var(--text-light);margin-left:6px;">85%換算</span></div>
            <div class="mgmt-yomi-value" style="color:${forecastColor};">¥${execForecast.toLocaleString()}</div>
            <div class="mgmt-yomi-sub">確定 ¥${execConfirmed.toLocaleString()} ＋ 未確認 ¥${execUnconfirmed.toLocaleString()} × 85%</div>
            <div class="mgmt-yomi-diff" style="color:${forecastColor};">目標比 ${forecastDiff >= 0 ? '+' : ''}¥${forecastDiff.toLocaleString()}</div>
        </div>
    </div>

    <!-- 円グラフ2つ -->
    <div class="mgmt-pies-row">
        <div class="mgmt-pie-wrap">
            <div class="mgmt-pie-title">実施ステータス内訳</div>
            <div style="position:relative;height:220px;"><canvas id="mgmtPieExec"></canvas></div>
            <div class="mgmt-pie-detail" id="mgmtPieDetail"></div>
            <div class="mgmt-pie-formula">確定 + 未確認 + リスケ + キャンセル</div>
        </div>
        <div class="mgmt-pie-wrap">
            <div class="mgmt-pie-title">着地ヨミ内訳</div>
            <div style="position:relative;height:220px;"><canvas id="mgmtPieYomi"></canvas></div>
            <div class="mgmt-pie-detail" id="mgmtPieYomiDetail"></div>
            <div class="mgmt-pie-formula">確定 + 未確認（リスケ・キャンセル除外）</div>
        </div>
        <div class="mgmt-pie-wrap">
            <div class="mgmt-pie-title">アポ実施タイミング内訳</div>
            <div style="position:relative;height:220px;"><canvas id="mgmtPieTiming"></canvas></div>
            <div class="mgmt-pie-detail" id="mgmtPieTimingDetail"></div>
            <div class="mgmt-pie-formula">前月越し実施 + 当月取得実施 + 当月取得来月以降</div>
        </div>
    </div>

    <!-- 全体KPI -->
    <div class="mgmt-kpi-numbers">
        <div class="mgmt-kpi-item"><div class="mgmt-kpi-label">架電数</div><div class="mgmt-kpi-val">${totalCalls.toLocaleString()}</div></div>
        <div class="mgmt-kpi-item"><div class="mgmt-kpi-label">着電数</div><div class="mgmt-kpi-val">${totalPr.toLocaleString()}</div></div>
        <div class="mgmt-kpi-item"><div class="mgmt-kpi-label">アポ数</div><div class="mgmt-kpi-val">${totalAppoCount.toLocaleString()}</div></div>
        <div class="mgmt-kpi-item"><div class="mgmt-kpi-label">架電toアポ率</div><div class="mgmt-kpi-val">${mgCallToAppo}%</div></div>
        <div class="mgmt-kpi-item"><div class="mgmt-kpi-label">着電toアポ率</div><div class="mgmt-kpi-val">${mgPrToAppo}%</div></div>
        <div class="mgmt-kpi-item"><div class="mgmt-kpi-label">架電to着電率</div><div class="mgmt-kpi-val">${mgCallToPr}%</div></div>
        <div class="mgmt-kpi-item"><div class="mgmt-kpi-label">平均単価</div><div class="mgmt-kpi-val">¥${avgUnitPrice.toLocaleString()}</div></div>
        <div class="mgmt-kpi-item"><div class="mgmt-kpi-label">月内実施率</div><div class="mgmt-kpi-val">${appoWithinMonthRate}%</div></div>
        <div class="mgmt-kpi-item"><div class="mgmt-kpi-label">キャンセル率</div><div class="mgmt-kpi-val">${cancelRateVal}%</div></div>
        <div class="mgmt-kpi-item"><div class="mgmt-kpi-label">実施確定率</div><div class="mgmt-kpi-val">${execConfirmRateVal}%</div></div>
        <div class="mgmt-kpi-item"><div class="mgmt-kpi-label">1hあたり架電数</div><div class="mgmt-kpi-val">${callsPerHour}</div></div>
        <div class="mgmt-kpi-item"><div class="mgmt-kpi-label">1日あたり架電数</div><div class="mgmt-kpi-val">${callsPerDay}</div></div>
        <div class="mgmt-kpi-item"><div class="mgmt-kpi-label">1日あたり稼働時間</div><div class="mgmt-kpi-val">${hoursPerDay}h</div></div>
    </div>

    <!-- 個人別 取得金額（縦棒グラフ） -->
    <div class="section-title" style="margin-top:28px;">個人別 取得金額 目標 vs 実績（既存/新規）</div>
    <div class="mgmt-chart-container"><canvas id="mgmtBarAmount"></canvas></div>

    <!-- 個人別 ランキング3列 -->
    <div class="mgmt-hbar-row" style="margin-top:16px;">
        <div>
            <div class="section-title">架電数ランキング</div>
            <div class="mgmt-chart-container mgmt-hbar-sm"><canvas id="mgmtHBarCalls"></canvas></div>
        </div>
        <div>
            <div class="section-title">着電数ランキング</div>
            <div class="mgmt-chart-container mgmt-hbar-sm"><canvas id="mgmtHBarPr"></canvas></div>
        </div>
        <div>
            <div class="section-title">アポ数ランキング</div>
            <div class="mgmt-chart-container mgmt-hbar-sm"><canvas id="mgmtHBarAppo"></canvas></div>
        </div>
    </div>

    <!-- 歩留まりランキング -->
    <div class="section-title" style="margin-top:28px;">歩留まりランキング</div>
    <div class="mgmt-hbar-row">
        <div>
            <div class="section-title" style="font-size:0.8rem;">架電→アポ率</div>
            <div class="mgmt-chart-container mgmt-hbar-sm"><canvas id="mgmtHBarCallToAppo"></canvas></div>
        </div>
        <div>
            <div class="section-title" style="font-size:0.8rem;">架電→着電率</div>
            <div class="mgmt-chart-container mgmt-hbar-sm"><canvas id="mgmtHBarCallToPr"></canvas></div>
        </div>
        <div>
            <div class="section-title" style="font-size:0.8rem;">着電→アポ率</div>
            <div class="mgmt-chart-container mgmt-hbar-sm"><canvas id="mgmtHBarPrToAppo"></canvas></div>
        </div>
    </div>

    <!-- 案件別 詳細テーブル -->
    <div class="section-title" style="margin-top:28px;">案件別 詳細</div>
    ${projTableHtml}`;

    document.getElementById('mgmtSalesProgress').innerHTML = html;
    document.getElementById('mgmtExecForecast').innerHTML = '';
    document.getElementById('mgmtCapProgress').innerHTML = '';
    document.getElementById('mgmtAssignmentAssess').innerHTML = '';

    // ========== チャート描画 ==========
    createGaugeChart('mgmtGaugeAcq', acquisitionAmount, monthlyTarget, standardProgress, '取得金額', `達成率 ${acqRate}%`);
    createGaugeChart('mgmtGaugeExec', execConfirmed, executionTarget, standardProgress, '実施確定', `達成率 ${execRate}%`);

    // 円グラフ中心テキスト描画プラグイン
    function pieCenterPlugin(centerText) {
        return {
            id: 'pieCenter_' + Math.random().toString(36).slice(2),
            afterDraw(chart) {
                const { ctx: c, chartArea } = chart;
                const cx = (chartArea.left + chartArea.right) / 2;
                const cy = (chartArea.top + chartArea.bottom) / 2;
                c.save();
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.font = '700 15px "Poppins", sans-serif';
                c.fillStyle = '#1a1a1a';
                c.fillText(centerText, cx, cy - 6);
                c.font = '500 9px "Noto Sans JP"';
                c.fillStyle = '#999';
                c.fillText('合計', cx, cy + 10);
                c.restore();
            }
        };
    }

    // 円グラフ: 実施ステータス内訳
    const execPieTotal = execConfirmed + execUnconfirmed + execRescheduleAmt + execCancelledAmt;
    const pieCtx = document.getElementById('mgmtPieExec');
    if (pieCtx) {
        mgmtCharts['mgmtPieExec'] = new Chart(pieCtx, {
            type: 'doughnut',
            data: {
                labels: ['確定（実施）', '未確認', 'リスケ', 'キャンセル'],
                datasets: [{ data: [execConfirmed, execUnconfirmed, execRescheduleAmt, execCancelledAmt], backgroundColor: ['#86aaec', '#b8d4f0', '#ede07d', '#ef947a'], borderWidth: 2, borderColor: '#fff' }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '55%',
                plugins: {
                    legend: { position: 'bottom', labels: { font: { size: 10, family: '"Noto Sans JP"' }, padding: 8, usePointStyle: true } },
                    tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ¥${ctx.parsed.toLocaleString()}` } },
                    datalabels: { display: true, color: '#fff', font: { weight: '700', size: 12 }, formatter: (val, ctx) => { const total = ctx.dataset.data.reduce((a, b) => a + b, 0); return total > 0 && val > 0 ? (val / total * 100).toFixed(0) + '%' : ''; } }
                },
                onClick: (evt, elements) => {
                    const detail = document.getElementById('mgmtPieDetail');
                    if (elements.length > 0 && detail) {
                        const idx = elements[0].index;
                        const labels = ['確定（実施）', '未確認', 'リスケ', 'キャンセル'];
                        const amounts = [execConfirmed, execUnconfirmed, execRescheduleAmt, execCancelledAmt];
                        const notes = ['実施確定済の金額', '今後実施予定の未確認金額', '翌月に流れる可能性あり', '請求¥0'];
                        detail.innerHTML = `<div class="mgmt-pie-detail-card"><strong>${labels[idx]}</strong>: ¥${amounts[idx].toLocaleString()}<br><span style="color:var(--text-light);font-size:0.75rem;">${notes[idx]}</span></div>`;
                    }
                }
            },
            plugins: [pieCenterPlugin('¥' + execPieTotal.toLocaleString())]
        });
    }

    // 円グラフ: 着地ヨミ内訳（当月取得 vs 前月取得）
    const yomiPieTotal = currentMonthExecAmt + prevMonthExecAmt;
    const pieYomiCtx = document.getElementById('mgmtPieYomi');
    if (pieYomiCtx) {
        mgmtCharts['mgmtPieYomi'] = new Chart(pieYomiCtx, {
            type: 'doughnut',
            data: {
                labels: ['当月取得 → 当月実施', '前月取得 → 当月実施'],
                datasets: [{ data: [currentMonthExecAmt, prevMonthExecAmt], backgroundColor: ['#86aaec', '#c4b5fd'], borderWidth: 2, borderColor: '#fff' }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '55%',
                plugins: {
                    legend: { position: 'bottom', labels: { font: { size: 10, family: '"Noto Sans JP"' }, padding: 8, usePointStyle: true } },
                    tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ¥${ctx.parsed.toLocaleString()}` } },
                    datalabels: { display: true, color: '#fff', font: { weight: '700', size: 13 }, formatter: (val, ctx) => { const total = ctx.dataset.data.reduce((a, b) => a + b, 0); return total > 0 && val > 0 ? (val / total * 100).toFixed(0) + '%' : ''; } }
                },
                onClick: (evt, elements) => {
                    const detail = document.getElementById('mgmtPieYomiDetail');
                    if (elements.length > 0 && detail) {
                        const idx = elements[0].index;
                        const labels = ['当月取得 → 当月実施', '前月取得 → 当月実施'];
                        const amounts = [currentMonthExecAmt, prevMonthExecAmt];
                        const total = currentMonthExecAmt + prevMonthExecAmt;
                        const pctVal = total > 0 ? (amounts[idx] / total * 100).toFixed(1) : '0';
                        detail.innerHTML = `<div class="mgmt-pie-detail-card"><strong>${labels[idx]}</strong>: ¥${amounts[idx].toLocaleString()}（${pctVal}%）</div>`;
                    }
                }
            },
            plugins: [pieCenterPlugin('¥' + yomiPieTotal.toLocaleString())]
        });
    }

    // 円グラフ: アポ実施タイミング内訳
    const pieTimingCtx = document.getElementById('mgmtPieTiming');
    if (pieTimingCtx) {
        mgmtCharts['mgmtPieTiming'] = new Chart(pieTimingCtx, {
            type: 'doughnut',
            data: {
                labels: ['前月以前取得→当月実施', '当月取得→当月実施', '当月取得→来月以降実施'],
                datasets: [{ data: [timingPrevToThis, timingThisToThis, timingThisToFuture], backgroundColor: ['#c4b5fd', '#86aaec', '#a8d8b9'], borderWidth: 2, borderColor: '#fff' }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '55%',
                plugins: {
                    legend: { position: 'bottom', labels: { font: { size: 9, family: '"Noto Sans JP"' }, padding: 8, usePointStyle: true } },
                    tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ¥${ctx.parsed.toLocaleString()}` } },
                    datalabels: { display: true, color: '#fff', font: { weight: '700', size: 12 }, formatter: (val, ctx) => { const total = ctx.dataset.data.reduce((a, b) => a + b, 0); return total > 0 && val > 0 ? (val / total * 100).toFixed(0) + '%' : ''; } }
                },
                onClick: (evt, elements) => {
                    const detail = document.getElementById('mgmtPieTimingDetail');
                    if (elements.length > 0 && detail) {
                        const idx = elements[0].index;
                        const labels = ['前月以前取得→当月実施', '当月取得→当月実施', '当月取得→来月以降実施'];
                        const amounts = [timingPrevToThis, timingThisToThis, timingThisToFuture];
                        detail.innerHTML = `<div class="mgmt-pie-detail-card"><strong>${labels[idx]}</strong>: ¥${amounts[idx].toLocaleString()}</div>`;
                    }
                }
            },
            plugins: [pieCenterPlugin('¥' + timingTotal.toLocaleString())]
        });
    }

    // 横棒グラフ共通関数（高さ自動調整）
    function createHBar(canvasId, data, valueKey, formatFn, colorFn) {
        const sorted = [...data].sort((a, b) => b[valueKey] - a[valueKey]);
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        // 親コンテナの高さをデータ数に応じて調整
        const h = Math.max(200, sorted.length * 30 + 40);
        ctx.parentElement.style.height = h + 'px';
        mgmtCharts[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: sorted.map(d => d.name),
                datasets: [{
                    label: '',
                    data: sorted.map(d => d[valueKey]),
                    backgroundColor: sorted.map(d => colorFn ? colorFn(d) : '#86aaec'),
                    borderRadius: 4,
                    barPercentage: 0.7,
                    categoryPercentage: 0.85,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { beginAtZero: true, ticks: { callback: formatFn, font: { size: 10 } }, grid: { color: '#f5f5f5' } },
                    y: { ticks: { font: { size: 11, family: '"Noto Sans JP"', weight: '600' } }, grid: { display: false } }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx) => formatFn(ctx.parsed.x) } }
                }
            }
        });
    }

    // 取得金額（縦棒グラフ: 目標 vs 実績）
    // 達成率の計算
    const memberAchievements = memberData.map(d => {
        if (d.target <= 0) return { pct: '-', color: 'var(--text-light)' };
        const r = Math.round(d.actual / d.target * 1000) / 10;
        const color = r >= standardProgress ? '#86aaec' : '#ef947a';
        return { pct: r + '%', color };
    });

    const barAmountCtx = document.getElementById('mgmtBarAmount');
    if (barAmountCtx) {
        // 実績バーの上に達成率を表示するプラグイン
        const achievementLabelPlugin = {
            id: 'achievementLabels',
            afterDatasetsDraw(chart) {
                const { ctx: c } = chart;
                const metaNew = chart.getDatasetMeta(2); // 新規dataset（スタック最上部）
                const metaExisting = chart.getDatasetMeta(1); // 既存dataset
                c.save();
                c.textAlign = 'center';
                c.textBaseline = 'bottom';
                c.font = '700 10px "Poppins", sans-serif';
                metaNew.data.forEach((bar, i) => {
                    const a = memberAchievements[i];
                    c.fillStyle = a.color;
                    // 新規が0の場合は既存バーの上端を使用
                    const topBar = memberData[i].actualNew > 0 ? bar : metaExisting.data[i];
                    c.fillText(a.pct, topBar.x, topBar.y - 4);
                });
                c.restore();
            }
        };

        mgmtCharts['mgmtBarAmount'] = new Chart(barAmountCtx, {
            type: 'bar',
            data: {
                labels: memberData.map(d => d.name),
                datasets: [
                    { label: '目標', data: memberData.map(d => d.target), backgroundColor: '#e0e0e0', borderRadius: 4, barPercentage: 0.6, categoryPercentage: 0.7, stack: 'target' },
                    { label: '既存', data: memberData.map(d => d.actualExisting), backgroundColor: '#86aaec', borderRadius: 0, barPercentage: 0.6, categoryPercentage: 0.7, stack: 'actual' },
                    { label: '新規', data: memberData.map(d => d.actualNew), backgroundColor: '#f59e0b', borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 }, barPercentage: 0.6, categoryPercentage: 0.7, stack: 'actual' }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                layout: { padding: { top: 16 } },
                scales: {
                    y: { beginAtZero: true, stacked: true, ticks: { callback: v => '¥' + (v / 10000).toFixed(0) + '万', font: { size: 10 } }, grid: { color: '#f0f0f0' } },
                    x: { stacked: true, ticks: { font: { size: 11, family: '"Noto Sans JP"' } }, grid: { display: false } }
                },
                plugins: {
                    legend: { position: 'top', labels: { font: { size: 11 }, usePointStyle: true, padding: 16 } },
                    tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ¥${ctx.parsed.y.toLocaleString()}` } }
                },
                onClick: (evt, elements, chart) => {
                    if (elements.length === 0) return;
                    const idx = elements[0].index;
                    const name = memberData[idx].name;
                    showMemberDetailPopup(name, allPerf, allAppo, allExecAppo);
                }
            },
            plugins: [achievementLabelPlugin]
        });
        // バーにカーソルを変更
        barAmountCtx.style.cursor = 'pointer';
    }

    // 架電数・着電数・アポ数ランキング
    createHBar('mgmtHBarCalls', memberData, 'calls', v => v.toLocaleString(), () => '#86aaec');
    createHBar('mgmtHBarPr', memberData, 'pr', v => v.toLocaleString(), () => '#b8d4f0');
    createHBar('mgmtHBarAppo', memberData, 'appo', v => v.toLocaleString(), () => '#90b8f8');

    // 歩留まりランキング
    const yieldData = memberData.map(d => {
        const callToAppo = d.calls > 0 ? d.appo / d.calls * 100 : 0;
        const callToPr = d.calls > 0 ? d.pr / d.calls * 100 : 0;
        const prToAppo = d.pr > 0 ? d.appo / d.pr * 100 : 0;
        return { name: d.name, callToAppo, callToPr, prToAppo };
    });

    function createYieldHBar(canvasId, data, key, color) {
        const sorted = [...data].sort((a, b) => b[key] - a[key]);
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        const h = Math.max(200, sorted.length * 30 + 40);
        ctx.parentElement.style.height = h + 'px';
        mgmtCharts[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: sorted.map(d => d.name),
                datasets: [{ data: sorted.map(d => d[key]), backgroundColor: color, borderRadius: 4, barPercentage: 0.7, categoryPercentage: 0.85 }]
            },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { beginAtZero: true, ticks: { callback: v => v.toFixed(1) + '%', font: { size: 10 } }, grid: { color: '#f5f5f5' } },
                    y: { ticks: { font: { size: 11, family: '"Noto Sans JP"', weight: '600' } }, grid: { display: false } }
                },
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ctx.parsed.x.toFixed(1) + '%' } } }
            }
        });
    }
    createYieldHBar('mgmtHBarCallToAppo', yieldData, 'callToAppo', '#86aaec');
    createYieldHBar('mgmtHBarCallToPr', yieldData, 'callToPr', '#b8d4f0');
    createYieldHBar('mgmtHBarPrToAppo', yieldData, 'prToAppo', '#90b8f8');
}

// ==================== Tab: 詳細分析サブナビ ====================
function switchAnalysisSub(sub) {
    currentAnalysisSub = sub;
    document.querySelectorAll('.analysis-sub-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sub === sub);
    });
    document.querySelectorAll('.analysis-sub-content').forEach(el => {
        el.classList.toggle('hidden', el.id !== `analysisSub-${sub}`);
    });
}

// ==================== Tab: 詳細分析（BI版） ====================
let analysisCompareData = null;
const analysisCharts = {};
function destroyAnalysisCharts() {
    Object.keys(analysisCharts).forEach(k => { if (analysisCharts[k]) { analysisCharts[k].destroy(); delete analysisCharts[k]; } });
}

// 指標定義
const ANL_METRICS = [
    { key: 'calls', label: '架電数', fmt: v => v.toLocaleString(), unit: '' },
    { key: 'pr', label: '着電数', fmt: v => v.toLocaleString(), unit: '' },
    { key: 'appo', label: 'アポ数', fmt: v => v.toLocaleString(), unit: '' },
    { key: 'amount', label: '取得金額', fmt: v => '¥' + v.toLocaleString(), unit: '¥' },
    { key: 'execConfirmed', label: '実施確定金額', fmt: v => '¥' + v.toLocaleString(), unit: '¥' },
    { key: 'hours', label: '架電時間', fmt: v => v.toFixed(1) + 'h', unit: 'h' },
    { key: 'days', label: '稼働日数', fmt: v => v + '日', unit: '日' },
    { key: 'dailyCalls', label: '日次架電', fmt: v => v.toLocaleString(), unit: '' },
    { key: 'hourly', label: '1hあたり架電数', fmt: v => v.toFixed(1), unit: '/h' },
    { key: 'callToPr', label: '架→着電率', fmt: v => v.toFixed(1) + '%', unit: '%', isRate: true },
    { key: 'prToAppo', label: '着電→アポ率', fmt: v => v.toFixed(1) + '%', unit: '%', isRate: true },
    { key: 'callToAppo', label: '架→アポ率', fmt: v => v.toFixed(1) + '%', unit: '%', isRate: true },
];

function calcMemberStats(data, memberName, proj) {
    let d = data.filter(r => r.member_name === memberName);
    if (proj && proj !== 'all') d = d.filter(r => r.project_name === proj);
    const calls = sum(d, 'call_count');
    const pr = sum(d, 'pr_count');
    const appo = sum(d, 'appointment_count');
    const hours = sum(d, 'call_hours');
    const days = new Set(d.map(r => r.input_date)).size;
    // 取得金額（appointmentsテーブルから、performance_rawdataのamountは不正確な場合がある）
    let memberAppo = appointmentsData.filter(a => a.member_name === memberName);
    if (proj && proj !== 'all') memberAppo = memberAppo.filter(a => a.project_name === proj);
    const amount = memberAppo.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    // 実施確定金額（executionAppoDataから）
    let execAppo = executionAppoData.filter(a => a.member_name === memberName && a.status === '実施');
    if (proj && proj !== 'all') execAppo = execAppo.filter(a => a.project_name === proj);
    const execConfirmed = execAppo.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    return {
        calls, pr, appo, amount, execConfirmed, hours, days,
        dailyCalls: days > 0 ? Math.round(calls / days) : 0,
        hourly: hours > 0 ? calls / hours : 0,
        callToPr: calls > 0 ? pr / calls * 100 : 0,
        prToAppo: pr > 0 ? appo / pr * 100 : 0,
        callToAppo: calls > 0 ? appo / calls * 100 : 0,
    };
}

function renderAnalysisNew(filter) {
    destroyAnalysisCharts();
    const ym = filter.month;
    const excluded = getExcludedMembers(ym);
    const activeMembers = membersData.filter(m => m.status === 'active' && !excluded.includes(m.member_name));
    const activeProjects = projectsData.filter(p => p.status === 'active');
    const sortedMembers = [...activeMembers].sort((a, b) => a.member_name.localeCompare(b.member_name, 'ja'));
    const memberOpts = sortedMembers.map(m => `<option value="${escapeHtml(m.member_name)}">${escapeHtml(m.member_name)}</option>`).join('');
    const metricOpts = ANL_METRICS.map(m => `<option value="${m.key}">${m.label}</option>`).join('');

    let html = `
    <!-- コントロール -->
    <div class="anl-controls">
        <div class="anl-control-group">
            <label>期間A</label>
            <input type="date" id="anlStartA" value="${ym}-01">
            <span>〜</span>
            <input type="date" id="anlEndA" value="${getEndOfMonth(ym)}">
        </div>
        <div class="anl-control-group">
            <label>比較期間B</label>
            <input type="date" id="anlStartB" value="">
            <span>〜</span>
            <input type="date" id="anlEndB" value="">
        </div>
        <div class="anl-control-group">
            <label>案件</label>
            <select id="anlProjectFilter">
                <option value="all">全案件</option>
                ${activeProjects.map(p => `<option value="${escapeHtml(p.project_name)}">${escapeHtml(p.project_name)}</option>`).join('')}
            </select>
        </div>
        <button class="anl-apply-btn" onclick="applyAnalysisFilter()">適用</button>
    </div>

    <!-- 上段: スコアカード -->
    <div class="anl-scorecard-area">
        <div class="anl-scorecard-header">
            <select id="anlScoreMember" onchange="renderScorecard()">${memberOpts}</select>
        </div>
        <div class="anl-scorecard-grid" id="anlScorecardGrid"></div>
    </div>

    <!-- 中段: ヒートマップ -->
    <div class="section-title" style="margin-top:24px;">全員 × 指標 ヒートマップ</div>
    <div style="overflow-x:auto;" id="anlHeatmapWrap"></div>

    <!-- 下段: 散布図 -->
    <div class="section-title" style="margin-top:24px;">散布図
        <div style="display:inline-flex;gap:8px;margin-left:12px;font-size:0.8rem;">
            <label style="font-weight:500;">X軸</label><select id="anlScatterX" onchange="renderScatter()">${metricOpts}</select>
            <label style="font-weight:500;">Y軸</label><select id="anlScatterY" onchange="renderScatter()"><option value="callToAppo">架→アポ率</option>${metricOpts}</select>
            <label style="font-weight:500;">サイズ</label><select id="anlScatterSize" onchange="renderScatter()"><option value="amount">取得金額</option>${metricOpts}</select>
        </div>
    </div>
    <div class="mgmt-chart-container" style="height:380px;"><canvas id="anlScatterChart"></canvas></div>`;

    document.getElementById('analysisNewContent').innerHTML = html;
    applyAnalysisFilter();
}

async function applyAnalysisFilter() {
    const startA = document.getElementById('anlStartA')?.value;
    const endA = document.getElementById('anlEndA')?.value;
    const startB = document.getElementById('anlStartB')?.value;
    const endB = document.getElementById('anlEndB')?.value;
    if (!startA || !endA) return;

    const dataA = await fetchPerfRange(startA, endA);
    let dataB = null;
    if (startB && endB) dataB = await fetchPerfRange(startB, endB);
    analysisCompareData = { dataA, dataB, startA, endA, startB, endB };

    renderScorecard();
    renderHeatmap();
    renderScatter();
}

async function fetchPerfRange(start, end) {
    const local = performanceData.filter(d => d.input_date >= start && d.input_date <= end);
    if (local.length > 0) return local;
    const data = await queryTurso("SELECT * FROM performance_rawdata WHERE input_date >= ? AND input_date <= ? ORDER BY input_date", [start, end]);
    normalizeDataMemberNames(data);
    return deduplicatePerformance(data);
}

// スコアカード
function renderScorecard() {
    if (!analysisCompareData) return;
    const { dataA, dataB } = analysisCompareData;
    const member = document.getElementById('anlScoreMember')?.value;
    const proj = document.getElementById('anlProjectFilter')?.value;
    if (!member) return;

    const a = calcMemberStats(dataA, member, proj);
    const b = dataB ? calcMemberStats(dataB, member, proj) : null;

    let html = '';
    ANL_METRICS.forEach(m => {
        const valA = a[m.key];
        const valB = b ? b[m.key] : null;
        let diffHtml = '';
        if (b) {
            const diff = valA - valB;
            if (Math.abs(diff) > 0.01) {
                const color = diff > 0 ? '#86aaec' : '#ef947a';
                const sign = diff > 0 ? '↑' : '↓';
                const fmt = m.isRate ? Math.abs(diff).toFixed(1) + 'pt' : Math.abs(Math.round(diff)).toLocaleString();
                diffHtml = `<div class="anl-sc-diff" style="color:${color};">${sign} ${fmt}</div>`;
            } else {
                diffHtml = `<div class="anl-sc-diff" style="color:var(--text-light);">→</div>`;
            }
        }
        html += `<div class="anl-sc-tile">
            <div class="anl-sc-label">${m.label}</div>
            <div class="anl-sc-value">${m.fmt(valA)}</div>
            ${diffHtml}
        </div>`;
    });
    document.getElementById('anlScorecardGrid').innerHTML = html;
}

// レーダーチャート
function renderRadar() {
    if (!analysisCompareData) return;
    if (analysisCharts['anlRadar']) { analysisCharts['anlRadar'].destroy(); }
    const { dataA } = analysisCompareData;
    const m1 = document.getElementById('anlRadarMember1')?.value;
    const m2 = document.getElementById('anlRadarMember2')?.value;
    const proj = document.getElementById('anlProjectFilter')?.value;
    const excluded = getExcludedMembers(document.getElementById('filterMonth').value);
    const activeMembers = membersData.filter(m => m.status === 'active' && !excluded.includes(m.member_name));

    const s1 = calcMemberStats(dataA, m1, proj);
    let s2;
    if (m2 === 'avg') {
        const allStats = activeMembers.map(m => calcMemberStats(dataA, m.member_name, proj));
        s2 = {};
        ANL_METRICS.forEach(m => { s2[m.key] = allStats.reduce((s, st) => s + st[m.key], 0) / allStats.length; });
    } else {
        s2 = calcMemberStats(dataA, m2, proj);
    }

    // 正規化: 全員の中での相対位置 (0-100)
    const allStats = activeMembers.map(m => calcMemberStats(dataA, m.member_name, proj));
    function normalize(key, val) {
        const vals = allStats.map(s => s[key]);
        const max = Math.max(...vals, 1);
        return max > 0 ? val / max * 100 : 0;
    }

    const radarKeys = ['calls', 'pr', 'appo', 'amount', 'dailyCalls', 'hourly', 'callToPr', 'prToAppo', 'callToAppo'];
    const radarLabels = radarKeys.map(k => ANL_METRICS.find(m => m.key === k)?.label || k);

    const ctx = document.getElementById('anlRadarChart');
    if (!ctx) return;
    analysisCharts['anlRadar'] = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: radarLabels,
            datasets: [
                { label: m1, data: radarKeys.map(k => normalize(k, s1[k])), borderColor: '#86aaec', backgroundColor: 'rgba(134,170,236,0.2)', pointRadius: 3 },
                { label: m2 === 'avg' ? '全員平均' : m2, data: radarKeys.map(k => normalize(k, s2[k])), borderColor: '#c4b5fd', backgroundColor: 'rgba(196,181,253,0.15)', pointRadius: 3, borderDash: [4, 3] }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { r: { beginAtZero: true, max: 100, ticks: { display: false }, pointLabels: { font: { size: 10, family: '"Noto Sans JP"' } } } },
            plugins: { legend: { position: 'top', labels: { font: { size: 10 }, usePointStyle: true } } }
        }
    });
}

// ヒートマップ
function renderHeatmap() {
    if (!analysisCompareData) return;
    const { dataA } = analysisCompareData;
    const proj = document.getElementById('anlProjectFilter')?.value;
    const excluded = getExcludedMembers(document.getElementById('filterMonth').value);
    const activeMembers = membersData.filter(m => m.status === 'active' && !excluded.includes(m.member_name));

    const allStats = activeMembers.map(m => ({ name: m.member_name, ...calcMemberStats(dataA, m.member_name, proj) }));

    // 各指標のmin/max
    const ranges = {};
    ANL_METRICS.forEach(m => {
        const vals = allStats.map(s => s[m.key]);
        ranges[m.key] = { min: Math.min(...vals), max: Math.max(...vals, 1) };
    });

    function heatColor(key, val) {
        const { min, max } = ranges[key];
        const range = max - min || 1;
        const ratio = (val - min) / range; // 0~1
        // 青系グラデーション: 薄い→濃い
        const r = Math.round(240 - ratio * 106); // 240→134
        const g = Math.round(244 - ratio * 74);  // 244→170
        const b = Math.round(248 - ratio * 12);  // 248→236
        return `rgb(${r},${g},${b})`;
    }

    let html = `<table class="data-table anl-heatmap"><thead><tr><th>メンバー</th>`;
    ANL_METRICS.forEach(m => { html += `<th class="text-right">${m.label}</th>`; });
    html += `</tr></thead><tbody>`;

    allStats.forEach(s => {
        html += `<tr><td style="font-weight:600;white-space:nowrap;">${escapeHtml(s.name)}</td>`;
        ANL_METRICS.forEach(m => {
            const v = s[m.key];
            html += `<td class="text-right" style="background:${heatColor(m.key, v)};font-size:0.75rem;font-weight:600;">${m.fmt(v)}</td>`;
        });
        html += `</tr>`;
    });
    html += `</tbody></table>`;
    document.getElementById('anlHeatmapWrap').innerHTML = html;
}

// 散布図
function renderScatter() {
    if (!analysisCompareData) return;
    if (analysisCharts['anlScatter']) { analysisCharts['anlScatter'].destroy(); }
    const { dataA } = analysisCompareData;
    const proj = document.getElementById('anlProjectFilter')?.value;
    const xKey = document.getElementById('anlScatterX')?.value || 'calls';
    const yKey = document.getElementById('anlScatterY')?.value || 'callToAppo';
    const sizeKey = document.getElementById('anlScatterSize')?.value || 'amount';
    const excluded = getExcludedMembers(document.getElementById('filterMonth').value);
    const activeMembers = membersData.filter(m => m.status === 'active' && !excluded.includes(m.member_name));

    const xMeta = ANL_METRICS.find(m => m.key === xKey);
    const yMeta = ANL_METRICS.find(m => m.key === yKey);
    const sMeta = ANL_METRICS.find(m => m.key === sizeKey);

    const allStats = activeMembers.map(m => ({ name: m.member_name, ...calcMemberStats(dataA, m.member_name, proj) }));
    const maxSize = Math.max(...allStats.map(s => s[sizeKey]), 1);

    const colors = ['#86aaec', '#c4b5fd', '#ef947a', '#a8d8b9', '#ede07d', '#f0b8d0', '#90b8f8', '#b8d4f0', '#d4a8e0', '#f0c8a8', '#a8c8f0', '#c8e0a8', '#e0b8c8', '#b8e0d4', '#e0d4a8'];

    const ctx = document.getElementById('anlScatterChart');
    if (!ctx) return;
    analysisCharts['anlScatter'] = new Chart(ctx, {
        type: 'bubble',
        data: {
            datasets: allStats.map((s, i) => ({
                label: s.name,
                data: [{ x: s[xKey], y: s[yKey], r: Math.max(4, s[sizeKey] / maxSize * 30) }],
                backgroundColor: colors[i % colors.length] + 'aa',
                borderColor: colors[i % colors.length],
                borderWidth: 1.5,
            }))
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: xMeta?.label, font: { size: 11 } }, beginAtZero: true, ticks: { font: { size: 10 } }, grid: { color: '#f0f0f0' } },
                y: { title: { display: true, text: yMeta?.label, font: { size: 11 } }, beginAtZero: true, ticks: { font: { size: 10 } }, grid: { color: '#f0f0f0' } }
            },
            plugins: {
                legend: { position: 'right', labels: { font: { size: 10 }, usePointStyle: true, padding: 8 } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const d = ctx.raw;
                            return `${ctx.dataset.label}: ${xMeta?.label}=${xMeta?.fmt(d.x)}, ${yMeta?.label}=${yMeta?.fmt(d.y)}`;
                        }
                    }
                }
            }
        }
    });
}

// ==================== Tab: 個人分析 ====================
function renderIndividualAnalysis(filter) {
    const ym = filter.month;
    const excluded = getExcludedMembers(ym);
    const activeMembers = membersData.filter(m => m.status === 'active' && !excluded.includes(m.member_name));
    const teamNames = getActiveTeamNames(ym);

    let html = '';
    teamNames.forEach(teamName => {
        const teamMembers = getTeamMembersForMonth(teamName, ym).filter(n => activeMembers.some(m => m.member_name === n));
        if (teamMembers.length === 0) return;

        html += `<div class="section-title">${escapeHtml(teamName)}</div>`;
        html += `<div style="overflow-x:auto;"><table class="data-table"><thead><tr>
            <th>メンバー</th>
            <th class="text-right">取得実績</th><th class="text-right">達成率</th>
            <th class="text-right">実施確定</th><th class="text-right">達成率</th>
            <th class="text-right">見込(未確認)</th>
            <th class="text-right">架toア</th>
            <th>状態</th>
        </tr></thead><tbody>`;

        teamMembers.forEach(memberName => {
            const mTarget = getTarget('member', memberName, ym);
            const acqTarget = mTarget ? (parseFloat(mTarget.appointment_amount_target) || 0) : 0;
            const execTarget = mTarget ? (parseFloat(mTarget.execution_target) || 0) : 0;

            const mPerf = performanceData.filter(d => d.member_name === memberName);
            const mAppo = appointmentsData.filter(d => d.member_name === memberName);
            const mExec = executionAppoData.filter(d => d.member_name === memberName);

            const appoAmount = sum(mPerf, 'appointment_amount');
            const callCount = sum(mPerf, 'call_count');
            const prCount = sum(mPerf, 'pr_count');
            const appoCount = sum(mPerf, 'appointment_count');

            const execConfirmed = mExec.filter(a => a.status === '実施').reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
            const execUnconfirmed = mExec.filter(a => a.status === '未確認').reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
            const execCancelled = mExec.filter(a => a.status === 'キャンセル').reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
            const execReschedule = mExec.filter(a => a.status === 'リスケ').reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);

            const acqAchieve = acqTarget > 0 ? Math.round(appoAmount / acqTarget * 100) : 0;
            const execAchieve = execTarget > 0 ? Math.round(execConfirmed / execTarget * 100) : 0;
            const callToPr = callCount > 0 ? (prCount / callCount * 100).toFixed(1) : '-';
            const prToAppo = prCount > 0 ? (appoCount / prCount * 100).toFixed(1) : '-';
            const callToAppo = callCount > 0 ? (appoCount / callCount * 100).toFixed(1) : '-';

            const hasIssue = (callToAppo !== '-' && parseFloat(callToAppo) < 3 && callCount > 100);
            const statusLabel = hasIssue ? '要注意' : callCount < 50 ? '稼働少' : '正常';
            const statusColor = hasIssue ? 'var(--primary-red)' : callCount < 50 ? '#8a7a00' : '#86aaec';
            html += `<tr>
                <td style="font-weight:600;">${escapeHtml(memberName)}</td>
                <td class="text-right">¥${appoAmount.toLocaleString()}</td>
                <td class="text-right" style="color:${acqAchieve >= 80 ? '#86aaec' : 'var(--primary-red)'};">${acqAchieve}%</td>
                <td class="text-right">¥${execConfirmed.toLocaleString()}</td>
                <td class="text-right" style="color:${execAchieve >= 80 ? '#86aaec' : 'var(--primary-red)'};">${execAchieve}%</td>
                <td class="text-right">¥${execUnconfirmed.toLocaleString()}</td>
                <td class="text-right">${callToAppo}%</td>
                <td style="color:${statusColor};font-weight:600;">${statusLabel}</td>
            </tr>`;
        });
        html += `</tbody></table></div>`;
    });

    document.getElementById('individualAnalysisContent').innerHTML = html || '<p style="color:var(--text-light);padding:24px;">データがありません</p>';
}

// ==================== Tab 1: 概要（レガシー・未使用） ====================
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

    // 当月取得件数・当月実施率（acquisition_dateベース）
    const acqAppoCount = appoData.length;
    const acqExecCount = appoData.filter(a => a.status === '実施').length;
    const acqExecutionRate = acqAppoCount > 0 ? (acqExecCount / acqAppoCount * 100).toFixed(1) : '-';

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
        <div class="conversion-rates-row" style="margin-top:12px;">
            <div class="conversion-rate-card">
                <div class="conversion-rate-value">${acqAppoCount}</div>
                <div class="conversion-rate-label">当月取得件数</div>
            </div>
            <div class="conversion-rate-card">
                <div class="conversion-rate-value" style="color:${acqExecutionRate !== '-' && parseFloat(acqExecutionRate) < 80 ? 'var(--primary-red)' : 'var(--primary-blue)'};">${acqExecutionRate}%</div>
                <div class="conversion-rate-label">当月実施率（${acqExecCount}/${acqAppoCount}件）</div>
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

    const teamNames = getActiveTeamNames(ym);
    let html = '<div class="team-grid">';

    teamNames.forEach(teamName => {
        const teamMembers = getTeamMembersForMonth(teamName, ym);
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
                        <div style="font-size:0.75rem;color:var(--text-light);">目標 ¥${(target / 10000).toFixed(0)}万 | ${acqRate}%</div>
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
                        <div style="font-size:0.75rem;color:var(--text-light);">目標 ¥${(execTarget / 10000).toFixed(0)}万 | ${confirmedRate}%</div>
                        ` : ''}
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid var(--border-color);">
                    <span style="font-size:0.75rem;color:var(--text-light);">実施見込</span>
                    <span style="font-size:0.8rem;font-weight:600;font-family:'Poppins',sans-serif;">¥${execForecast.toLocaleString()}</span>
                    <span style="font-size:0.75rem;color:var(--text-light);">（未確認+実施）</span>
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
    const excluded = getExcludedMembers(ym);

    membersData.filter(m => !excluded.includes(m.member_name)).forEach(member => {
        const memberAppo = appoData.filter(d => d.member_name === member.member_name);
        const acqAmount = memberAppo.reduce((s, a) => s + (a.amount || 0), 0);
        const avgUnitPrice = memberAppo.length > 0 ? Math.round(acqAmount / memberAppo.length) : 0;

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
                    <span style="display:flex;align-items:center;gap:6px;">
                        <span style="font-size:0.7rem;color:var(--text-light);">単価</span>
                        <span style="font-size:0.8rem;font-weight:600;font-family:'Poppins',sans-serif;">¥${avgUnitPrice.toLocaleString()}</span>
                        <span class="member-team-badge">${getTeamsForMonth(ym)[member.member_name] || member.team_name}</span>
                    </span>
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
                        <div style="font-size:0.75rem;color:var(--text-light);">目標 ¥${(acqTarget / 10000).toFixed(0)}万 | ${acqRate}%</div>
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
                        <div style="font-size:0.75rem;color:var(--text-light);">目標 ¥${(execTarget / 10000).toFixed(0)}万 | ${confirmedRate}%</div>
                        ` : ''}
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid var(--border-color);">
                    <span style="font-size:0.75rem;color:var(--text-light);">実施見込</span>
                    <span style="font-size:0.8rem;font-weight:600;font-family:'Poppins',sans-serif;">¥${execForecast.toLocaleString()}</span>
                    <span style="font-size:0.75rem;color:var(--text-light);">（未確認+実施）</span>
                </div>
            </div>
        `;
    });

    html += '</div>';
    document.getElementById('memberSalesCards').innerHTML = html;
}

function renderMemberGraphs(perfData) {
    const ym = document.getElementById('filterMonth').value;
    const excluded = getExcludedMembers(ym);
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
        const memberValues = membersData.filter(m => !excluded.includes(m.member_name)).map(member => {
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
    // executionAppoData（scheduled_dateベース）に加え、appointmentsData（acquisition_dateベース）も
    // マージして表示。当月取得だがscheduled_dateが異なる月/NULLのアポも表示されるようにする。
    const execFiltered = filterAppointments(executionAppoData, filter);
    const acqFiltered = filterAppointments(appointmentsData, filter);
    // IDベース + コンテンツベースの重複排除でマージ
    const seenIds = new Set(execFiltered.map(a => a.id));
    const seenKeys = new Set(execFiltered.map(a => `${a.member_name}|${a.project_name}|${a.acquisition_date}|${a.customer_name}`));
    const merged = [...execFiltered];
    acqFiltered.forEach(a => {
        const key = `${a.member_name}|${a.project_name}|${a.acquisition_date}|${a.customer_name}`;
        if (!seenIds.has(a.id) && !seenKeys.has(key)) {
            merged.push(a);
            seenKeys.add(key);
        }
    });
    // ソート
    merged.sort((a, b) => {
        let va = a[appoSortKey] || '';
        let vb = b[appoSortKey] || '';
        if (appoSortKey === 'amount') {
            va = a.amount || 0;
            vb = b.amount || 0;
            return appoSortAsc ? va - vb : vb - va;
        }
        const cmp = String(va).localeCompare(String(vb), 'ja');
        return appoSortAsc ? cmp : -cmp;
    });
    const allData = merged;

    // サマリは当月全体（今日以降も含む）
    const summaryData = allData;

    // テーブル・ドロップダウン用は「今日まで」フィルタを適用
    let tableBaseData = allData;
    if (!appoShowAll) {
        const today = formatDate(new Date());
        tableBaseData = tableBaseData.filter(a => !a.scheduled_date || a.scheduled_date <= today);
    }

    const statusCounts = { '未確認': 0, '実施': 0, 'リスケ': 0, 'キャンセル': 0 };
    const statusAmounts = { '未確認': 0, '実施': 0, 'リスケ': 0, 'キャンセル': 0 };
    summaryData.forEach(a => {
        if (statusCounts[a.status] !== undefined) {
            statusCounts[a.status]++;
            statusAmounts[a.status] += a.amount || 0;
        }
    });

    // 未確認バッジ（今日までの件数）
    const badge = document.getElementById('unconfirmedBadge');
    const badgeUnconfirmedCount = tableBaseData.filter(a => a.status === '未確認').length;
    if (badgeUnconfirmedCount > 0) {
        badge.textContent = badgeUnconfirmedCount;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }

    // ステータスサマリ
    const total = summaryData.length;
    const executeRate = total > 0 ? (statusCounts['実施'] / total * 100).toFixed(1) : '0';
    const cancelRate = total > 0 ? (statusCounts['キャンセル'] / total * 100).toFixed(1) : '0';
    const rescheduleRate = total > 0 ? (statusCounts['リスケ'] / total * 100).toFixed(1) : '0';
    const unconfirmedRate = total > 0 ? (statusCounts['未確認'] / total * 100).toFixed(1) : '0';

    const totalAmount = statusAmounts['実施'] + statusAmounts['リスケ'] + statusAmounts['キャンセル'] + statusAmounts['未確認'];
    document.getElementById('appo-status-summary').innerHTML = `
        <div class="rate-grid" style="margin-bottom:12px;">
            <div class="rate-card">
                <div class="rate-value" style="color:var(--text-dark);">${total}件</div>
                <div class="rate-label">総アポ数</div>
                <div style="font-size:0.85rem;font-weight:600;color:var(--text-dark);margin-top:2px;">¥${totalAmount.toLocaleString()}</div>
            </div>
            <div class="rate-card">
                <div class="rate-value" style="color:var(--primary-blue);">${statusCounts['実施']}件<span style="font-size:0.75rem;font-weight:500;margin-left:4px;">(${executeRate}%)</span></div>
                <div class="rate-label">実施確定</div>
                <div style="font-size:0.85rem;font-weight:600;color:var(--primary-blue);margin-top:2px;">¥${statusAmounts['実施'].toLocaleString()}</div>
            </div>
            <div class="rate-card">
                <div class="rate-value" style="color:#8a7a00;">${statusCounts['リスケ']}件<span style="font-size:0.75rem;font-weight:500;margin-left:4px;">(${rescheduleRate}%)</span></div>
                <div class="rate-label">リスケ</div>
                <div style="font-size:0.85rem;font-weight:600;color:#8a7a00;margin-top:2px;">¥${statusAmounts['リスケ'].toLocaleString()}</div>
            </div>
            <div class="rate-card">
                <div class="rate-value" style="color:var(--primary-red);">${statusCounts['キャンセル']}件<span style="font-size:0.75rem;font-weight:500;margin-left:4px;">(${cancelRate}%)</span></div>
                <div class="rate-label">キャンセル</div>
                <div style="font-size:0.85rem;font-weight:600;color:var(--primary-red);margin-top:2px;">¥${statusAmounts['キャンセル'].toLocaleString()}</div>
            </div>
            <div class="rate-card">
                <div class="rate-value" style="color:var(--text-light);">${statusCounts['未確認']}件<span style="font-size:0.75rem;font-weight:500;margin-left:4px;">(${unconfirmedRate}%)</span></div>
                <div class="rate-label">未確認</div>
                <div style="font-size:0.85rem;font-weight:600;color:var(--text-light);margin-top:2px;">¥${statusAmounts['未確認'].toLocaleString()}</div>
            </div>
        </div>
    `;

    // アポ用メンバー・案件フィルタドロップダウン更新
    const appoMemberFilter = document.getElementById('appoMemberFilter');
    const appoProjectFilter = document.getElementById('appoProjectFilter');
    if (appoMemberFilter) {
        const currentMember = appoMemberFilter.value;
        const members = [...new Set(tableBaseData.map(a => a.member_name).filter(Boolean))].sort();
        appoMemberFilter.innerHTML = '<option value="all">全担当者</option>' +
            members.map(m => `<option value="${m}">${displayName(m)}</option>`).join('');
        appoMemberFilter.value = members.includes(currentMember) ? currentMember : 'all';
    }
    if (appoProjectFilter) {
        const currentProject = appoProjectFilter.value;
        const projects = [...new Set(tableBaseData.map(a => a.project_name).filter(Boolean))].sort();
        appoProjectFilter.innerHTML = '<option value="all">全案件</option>' +
            projects.map(p => `<option value="${p}">${p}</option>`).join('');
        appoProjectFilter.value = projects.includes(currentProject) ? currentProject : 'all';
    }

    // テーブル用データ: tableBaseData（今日までフィルタ済み） + ステータスフィルタ
    let filtered = currentAppoFilter === 'all' ? tableBaseData : tableBaseData.filter(a => a.status === currentAppoFilter);

    // メンバーフィルタ
    const selectedMember = appoMemberFilter ? appoMemberFilter.value : 'all';
    if (selectedMember !== 'all') {
        filtered = filtered.filter(a => a.member_name === selectedMember);
    }

    // 案件フィルタ
    const selectedProject = appoProjectFilter ? appoProjectFilter.value : 'all';
    if (selectedProject !== 'all') {
        filtered = filtered.filter(a => a.project_name === selectedProject);
    }

    // 検索フィルタ
    const searchInput = document.getElementById('appoSearchInput');
    const searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (searchQuery) {
        filtered = filtered.filter(a =>
            (a.customer_name || '').toLowerCase().includes(searchQuery)
        );
    }

    const tbody = document.getElementById('appoTableBody');
    tbody.innerHTML = filtered.map(a => {
        const statusClass = a.status === '未確認' ? 'status-unconfirmed' :
                           a.status === '実施' ? 'status-executed' :
                           a.status === 'リスケ' ? 'status-rescheduled' : 'status-cancelled';
        return `
            <tr>
                <td>${formatDateDisplay(a.acquisition_date)}</td>
                <td>${displayName(a.member_name)}</td>
                <td>${a.project_name}</td>
                <td>${a.customer_name || '-'}</td>
                <td>${formatDateDisplay(a.scheduled_date)}</td>
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

function sortAppoTable(key) {
    if (appoSortKey === key) {
        appoSortAsc = !appoSortAsc;
    } else {
        appoSortKey = key;
        appoSortAsc = true;
    }
    // ソートアイコン更新
    document.querySelectorAll('.sort-icon').forEach(el => { el.textContent = ''; });
    const icon = document.getElementById('sort-' + key);
    if (icon) icon.textContent = appoSortAsc ? '▲' : '▼';
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
            const tm = getTeamMembersForMonth(filter.team, filter.month);
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
    const excludedForYield = getExcludedMembers(filter.month);
    const teamMembersForYield = filter.team !== 'all' ? getTeamMembersForMonth(filter.team, filter.month) : null;
    const entities = filter.team !== 'all'
        ? membersData.filter(m => teamMembersForYield.includes(m.member_name))
        : filter.member !== 'all'
            ? membersData.filter(m => m.member_name === filter.member)
            : membersData.filter(m => !excludedForYield.includes(m.member_name));

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
                <td class="text-right number"${redStyle(ctp, BL_CTP)}>${ctp}%</td>
                <td class="text-right number"${redStyle(pta, BL_PTA)}>${pta}%</td>
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
            <td class="text-right number"${redStyle(callToPR.toFixed(1), BL_CTP)}>${callToPR.toFixed(1)}%</td>
            <td class="text-right number"${redStyle(prToAppo.toFixed(1), BL_PTA)}>${prToAppo.toFixed(1)}%</td>
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
        const profitAlert = p.calls > 0 && profitCheck < 7.5;

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
            if (profitAlert) badges += `<span class="yield-alert-badge alert" title="単価×架toア = ${profitCheck.toFixed(1)}（基準: 7.5以上）">収益性↓</span>`;
        }

        // 詳細行（クリックで展開）
        const rowId = `proj-detail-${name.replace(/[^a-zA-Z0-9]/g, '_')}`;
        let detailCells = '';
        if (hasAnyAlert && p.calls >= 30) {
            const details = [];
            if (ctpLow) details.push(`架電to着電率 ${(actCtp*100).toFixed(1)}%（基準 ${(BASELINE.callToPR*100)}%、乖離 ${((actCtp/BASELINE.callToPR-1)*100).toFixed(0)}%） → リスト品質・時間帯の見直し`);
            if (ptaLow) details.push(`着電toアポ率 ${(actPta*100).toFixed(1)}%（基準 ${(BASELINE.prToAppo*100)}%、乖離 ${((actPta/BASELINE.prToAppo-1)*100).toFixed(0)}%） → トークスクリプト改善・ヒアリング精度向上`);
            if (ctaLow) details.push(`架電toアポ率 ${(actCta*100).toFixed(2)}%（基準 ${(BASELINE.callToAppo*100)}%、乖離 ${((actCta/BASELINE.callToAppo-1)*100).toFixed(0)}%） → リスト品質とトーク品質の両面から改善`);
            if (profitAlert) details.push(`収益性指標 ${profitCheck.toFixed(1)}（基準: 7.5以上） → 単価またはアポ率の改善が必要`);

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
            if (profitAlert) gaps.push({ label: '収益性', actual: profitCheck, baseline: 7.5, isIndex: true, suggestion: '単価またはアポ率の改善が必要' });

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

    // 案件別の実績集計（アラート計算用）
    const projectPerfStats = {};
    performanceData.forEach(d => {
        const pn = d.project_name;
        if (!pn) return;
        if (!projectPerfStats[pn]) projectPerfStats[pn] = { calls: 0, appo: 0 };
        projectPerfStats[pn].calls += d.call_count || 0;
        projectPerfStats[pn].appo += d.appointment_count || 0;
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

        // アラート: 単価×架電toアポ率 < 7（架電100件以上）
        const stats = projectPerfStats[p.project_name] || { calls: 0, appo: 0 };
        const unitPrice = p.unit_price || 0;
        const cta = stats.calls > 0 ? (stats.appo / stats.calls) : 0;
        const alertScore = unitPrice * cta;
        const hasAlert = stats.calls >= 100 && alertScore < 7;

        html += `
            <div class="project-card" id="pcard-${pid}" ${hasAlert ? 'style="border-left:3px solid var(--primary-red);"' : ''}>
                <div class="project-card-header">
                    <div>
                        <div class="project-name">${p.project_name} ${hasAlert ? '<span style="color:var(--primary-red);font-size:0.8rem;">⚠ 収益性注意</span>' : ''}</div>
                        <div class="project-client">${p.client_name || '-'}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <button class="project-edit-btn" onclick="openProjectForm('${p.id}')" title="編集">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        <span class="kpi-badge good">${p.status}</span>
                    </div>
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
    input.value = '';
    input.placeholder = currentValue || '0';
    input.style.cssText = 'width:80px;padding:4px 6px;border:1px solid var(--primary-blue);border-radius:4px;font-size:0.85rem;text-align:right;';
    el.innerHTML = '';
    el.appendChild(input);
    input.focus();

    const save = async () => {
        const rawVal = input.value.trim();
        if (rawVal === '') { el.innerHTML = display; return; } // 未入力はキャンセル
        const newVal = parseInt(rawVal) || 0;
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

function renderCapTable() {
    // projectsData + appointmentsData から案件別キャップ vs 実績を計算
    const caps = projectsData
        .filter(p => p.monthly_cap_count > 0)
        .map(p => {
            const actual = appointmentsData.filter(a => a.project_name === p.project_name).length;
            const unitPrice = p.unit_price || 0;
            return {
                project_name: p.project_name,
                cap_count: p.monthly_cap_count,
                cap_amount: unitPrice * p.monthly_cap_count,
                actual_count: actual,
                actual_amount: unitPrice * actual
            };
        });

    // キャップサマリー集計
    let totalCap = 0, totalActual = 0, totalCapAmount = 0, totalActualAmount = 0;
    caps.forEach(c => {
        totalCap += c.cap_count || 0;
        totalActual += c.actual_count || 0;
        totalCapAmount += c.cap_amount || 0;
        totalActualAmount += c.actual_amount || 0;
    });
    const totalRemaining = totalCap - totalActual;
    const totalRate = totalCap > 0 ? Math.round(totalActual / totalCap * 100) : 0;
    const rateColor = totalRate >= 100 ? 'var(--primary-red)' : totalRate >= 80 ? '#ede07d' : 'var(--success)';

    document.getElementById('capSummary').innerHTML = `
        <div class="cap-summary-grid">
            <div class="cap-summary-item">
                <div class="cap-summary-label">合計キャップ</div>
                <div class="cap-summary-value">${totalCap}<span class="cap-summary-unit">件</span></div>
            </div>
            <div class="cap-summary-item">
                <div class="cap-summary-label">合計実績</div>
                <div class="cap-summary-value">${totalActual}<span class="cap-summary-unit">件</span></div>
            </div>
            <div class="cap-summary-item">
                <div class="cap-summary-label">残キャップ</div>
                <div class="cap-summary-value" style="color:${totalRemaining <= 0 ? 'var(--primary-red)' : 'var(--text-dark)'}">${totalRemaining}<span class="cap-summary-unit">件</span></div>
            </div>
            <div class="cap-summary-item">
                <div class="cap-summary-label">消化率</div>
                <div class="cap-summary-value" style="color:${rateColor}">${totalRate}<span class="cap-summary-unit">%</span></div>
                <div class="cap-summary-bar">
                    <div class="cap-summary-bar-fill" style="width:${Math.min(totalRate, 100)}%;background:${rateColor};"></div>
                </div>
            </div>
        </div>
    `;

    let rows = '';
    caps.forEach(c => {
        const countRate = c.cap_count > 0 ? (c.actual_count / c.cap_count * 100).toFixed(0) : '-';
        const barWidth = c.cap_count > 0 ? Math.min(c.actual_count / c.cap_count * 100, 100) : 0;
        const barColor = barWidth >= 100 ? 'var(--primary-red)' : barWidth >= 80 ? '#ede07d' : 'var(--success)';

        rows += `
            <tr>
                <td>${c.project_name}</td>
                <td class="text-right number">${c.cap_count}</td>
                <td class="text-right number">${c.actual_count}</td>
                <td class="text-right number">${countRate}%</td>
                <td class="text-right number">¥${(c.cap_amount || 0).toLocaleString()}</td>
                <td class="text-right number">¥${(c.actual_amount || 0).toLocaleString()}</td>
                <td>
                    <div class="progress-bar" style="width:100px;">
                        <div class="progress-bar-fill" style="width:${barWidth}%;background:${barColor};"></div>
                    </div>
                </td>
            </tr>
        `;
    });
    document.getElementById('capTableBody').innerHTML = rows || '<tr><td colspan="7" style="text-align:center;color:var(--text-light);">キャップ設定のある案件がありません</td></tr>';
}

// ==================== アサイン管理 ====================
function renderAssignments() {
    const filter = getFilters();
    let filtered = assignmentsData.slice();

    if (filter.team !== 'all') {
        const teamMembers = getTeamMembersForMonth(filter.team, filter.month);
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

    let rows = '';
    filtered.forEach(a => {
        const progressColor = a._progress >= 100 ? 'var(--success)' : a._progress >= 70 ? '#ede07d' : '#ef947a';
        const progressWidth = Math.min(a._progress, 100);

        const ctaColor = a._callToAppo !== '-' && parseFloat(a._callToAppo) < 3 ? 'var(--primary-red)' : '';
        rows += `
            <tr>
                <td>${a.project_name}${a.sheet_url ? ` <a href="${escapeHtml(a.sheet_url)}" target="_blank" title="シート" style="font-size:0.75rem;">📋</a>` : ''}</td>
                <td>${displayName(a.member_name)}</td>
                <td class="text-right number">${a._calls.toLocaleString()}</td>
                <td class="text-right number">${a._appo}</td>
                <td class="text-right number" style="color:${ctaColor};font-weight:600;">${a._callToAppo}%${a._hasAlert ? ' ⚠' : ''}</td>
                <td class="text-right number">¥${a._confirmedAmount.toLocaleString()}</td>
                <td>
                    <div class="progress-bar" style="width:50px;display:inline-block;vertical-align:middle;">
                        <div class="progress-bar-fill" style="width:${progressWidth}%;background:${progressColor};"></div>
                    </div>
                    <span class="number" style="font-size:0.75rem;">${a._progress}%</span>
                </td>
                <td>
                    <button class="icon-btn" onclick="openAssignmentForm('${a.id}')" title="編集">✏️</button>
                    <button class="icon-btn" onclick="deleteAssignment('${a.id}')" title="削除">🗑</button>
                </td>
            </tr>
        `;
    });

    document.getElementById('assignmentTableBody').innerHTML = rows || '<tr><td colspan="8" style="text-align:center;color:var(--text-light);padding:20px;">アサインが登録されていません。「+ 新規アサイン」から追加してください。</td></tr>';
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
            const typeSelect = document.getElementById('asgFormType');
            const typeVal = a.project_type || '成果報酬';
            typeSelect.value = typeVal;
            // 値がオプションに存在しない場合、オプションを動的追加
            if (typeSelect.value !== typeVal) {
                const opt = document.createElement('option');
                opt.value = typeVal;
                opt.textContent = typeVal;
                typeSelect.appendChild(opt);
                typeSelect.value = typeVal;
            }
            document.getElementById('asgFormPM').value = a.pm_name || '';
            document.getElementById('asgFormCapCount').value = a.cap_count || '';
            document.getElementById('asgFormCapAmount').value = a.cap_amount || '';
            document.getElementById('asgFormTargetCount').value = a.target_count || '';
            document.getElementById('asgFormSheetUrl').value = a.sheet_url || '';
        }
    } else {
        document.getElementById('assignmentFormTitle').textContent = '新規アサイン追加';
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
    const rank = null;
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
async function renderAnalysis(perfData, filter) {
    if (currentAnalysisView === 'daily') {
        renderDailyAnalysis(perfData, filter);
        renderAnalysisChart(perfData, filter);
    } else if (currentAnalysisView === 'weekly') {
        renderWeeklyAnalysis(perfData, filter);
        renderAnalysisChart(perfData, filter);
    } else {
        renderMonthlyAnalysis(filter);
        // 月次チャートは全期間データが必要なのでDBから取得
        try {
            const allPerf = await queryTurso("SELECT input_date, call_count, pr_count, appointment_count, appointment_amount FROM performance_rawdata");
            renderAnalysisChart(allPerf, filter);
        } catch (e) {
            console.error('Monthly chart data error:', e);
            renderAnalysisChart(perfData, filter);
        }
    }
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
        </tr>
    `;

    let rows = '';
    dates.forEach(date => {
        const d = dateMap[date];

        rows += `
            <tr>
                <td>${date}</td>
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
    const bucketMap = {};

    if (currentAnalysisView === 'monthly') {
        // 月別集計
        perfData.forEach(d => {
            const month = d.input_date ? d.input_date.substring(0, 7) : null;
            if (!month) return;
            if (!bucketMap[month]) bucketMap[month] = { calls: 0, pr: 0, appo: 0, amount: 0 };
            bucketMap[month].calls += d.call_count || 0;
            bucketMap[month].pr += d.pr_count || 0;
            bucketMap[month].appo += d.appointment_count || 0;
            bucketMap[month].amount += d.appointment_amount || 0;
        });
    } else if (currentAnalysisView === 'weekly') {
        // 週別集計（月曜始まり）
        perfData.forEach(d => {
            if (!d.input_date) return;
            const dt = new Date(d.input_date);
            const day = dt.getDay();
            const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(dt);
            monday.setDate(diff);
            const weekKey = monday.toISOString().substring(0, 10);
            if (!bucketMap[weekKey]) bucketMap[weekKey] = { calls: 0, pr: 0, appo: 0, amount: 0 };
            bucketMap[weekKey].calls += d.call_count || 0;
            bucketMap[weekKey].pr += d.pr_count || 0;
            bucketMap[weekKey].appo += d.appointment_count || 0;
            bucketMap[weekKey].amount += d.appointment_amount || 0;
        });
    } else {
        // 日別集計
        perfData.forEach(d => {
            if (!d.input_date) return;
            if (!bucketMap[d.input_date]) bucketMap[d.input_date] = { calls: 0, pr: 0, appo: 0, amount: 0 };
            bucketMap[d.input_date].calls += d.call_count || 0;
            bucketMap[d.input_date].pr += d.pr_count || 0;
            bucketMap[d.input_date].appo += d.appointment_count || 0;
            bucketMap[d.input_date].amount += d.appointment_amount || 0;
        });
    }

    const dates = Object.keys(bucketMap).sort();
    const labels = currentAnalysisView === 'monthly' ? dates : dates.map(d => d.substring(5));

    let dataValues, label, color;
    switch (currentAnalysisChart) {
        case 'pr':
            dataValues = dates.map(d => bucketMap[d].pr);
            label = 'PR数';
            color = '#00a2da';
            break;
        case 'appo':
            dataValues = dates.map(d => bucketMap[d].appo);
            label = 'アポ数';
            color = '#e8d335';
            break;
        case 'amount':
            dataValues = dates.map(d => bucketMap[d].amount);
            label = '金額';
            color = '#86aaec';
            break;
        default:
            dataValues = dates.map(d => bucketMap[d].calls);
            label = '架電数';
            color = '#1155cc';
    }

    // チャートタイトルをビューに合わせて更新
    const chartTitle = document.getElementById('analysisChartTitle');
    if (chartTitle) {
        chartTitle.textContent = currentAnalysisView === 'monthly' ? '月別トレンド' : currentAnalysisView === 'weekly' ? '週別トレンド' : '日別トレンド';
    }

    if (charts.analysis) charts.analysis.destroy();

    const ctx = document.getElementById('analysisChart').getContext('2d');
    const isDaily = currentAnalysisView === 'daily';
    charts.analysis = new Chart(ctx, {
        type: isDaily ? 'line' : 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: dataValues,
                backgroundColor: isDaily ? color + '15' : color + '80',
                borderColor: color,
                borderWidth: isDaily ? 2 : 1,
                fill: isDaily,
                tension: 0.3,
                pointRadius: isDaily ? 3 : 0,
                pointBackgroundColor: color
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
function recalcTargetTotals() {
    const ym = document.getElementById('filterMonth').value;
    const teamNames = getActiveTeamNames(ym);

    ['', '_exec'].forEach(suffix => {
        let grandTotal = 0;
        teamNames.forEach(team => {
            const members = getTeamMembersForMonth(team, ym);
            let teamSum = 0;
            members.forEach(m => {
                const el = document.getElementById(`target_member_${m}${suffix}`);
                if (el) teamSum += parseInt(el.value) || 0;
            });
            const teamEl = document.getElementById(`target_team_${team}${suffix}`);
            const teamDisplay = document.getElementById(`target_team_${team}${suffix}_display`);
            if (teamEl) teamEl.value = teamSum;
            if (teamDisplay) teamDisplay.textContent = '¥' + teamSum.toLocaleString();
            grandTotal += teamSum;
        });
        const totalEl = document.getElementById(`target_total_all${suffix}`);
        const totalDisplay = document.getElementById(`target_total_all${suffix}_display`);
        if (totalEl) totalEl.value = grandTotal;
        if (totalDisplay) totalDisplay.textContent = '¥' + grandTotal.toLocaleString();
    });
}

function renderSettings() {
    const ym = document.getElementById('filterMonth').value;
    const teamNames = getActiveTeamNames(ym);

    function buildTargetSection(type) {
        const isExec = type === 'exec';
        const suffix = isExec ? '_exec' : '';
        const targetField = isExec ? 'execution_target' : 'appointment_amount_target';

        const totalTarget = getTarget('total', 'all', ym);
        const totalVal = totalTarget ? (totalTarget[targetField] || 0) : 0;

        let html = `
            <input type="hidden" id="target_total_all${suffix}" value="${totalVal}">
            <div class="target-team-columns">
        `;

        teamNames.forEach(team => {
            const t = getTarget('team', team, ym);
            const teamVal = t ? (t[targetField] || 0) : 0;
            const members = getTeamMembersForMonth(team, ym);

            html += `
                <div class="target-team-col">
                    <div class="target-team-header">
                        <span class="target-team-name">${team.replace('Team', '')}</span>
                        <span class="target-team-sum" id="target_team_${team}${suffix}_display">¥0</span>
                        <input type="hidden" id="target_team_${team}${suffix}" value="${teamVal}">
                    </div>
            `;

            members.forEach(memberName => {
                const mt = getTarget('member', memberName, ym);
                const mVal = mt ? (mt[targetField] || 0) : 0;
                html += `
                    <div class="target-member-row">
                        <label>${displayName(memberName)}</label>
                        <input type="number" id="target_member_${memberName}${suffix}" value="${mVal}" min="0" oninput="recalcTargetTotals()">
                    </div>
                `;
            });

            html += `</div>`;
        });

        html += `</div>`;
        return html;
    }

    document.getElementById('acqTargetSettingsGrid').innerHTML = buildTargetSection('acq');
    document.getElementById('execTargetSettingsGrid').innerHTML = buildTargetSection('exec');

    recalcTargetTotals();

    // レート設定（DOM要素がある場合のみ）
    const crEl = document.getElementById('settingCancelRate');
    const frEl = document.getElementById('settingFlowRate');
    const mtEl = document.getElementById('settingMonthlyTarget');
    if (crEl) crEl.value = settingsMap.cancel_rate_default || '0.8';
    if (frEl) frEl.value = settingsMap.next_month_flow_rate || '0.5';
    if (mtEl) mtEl.value = settingsMap.monthly_target_total || '9000000';

    // メンバー管理テーブル
    let memberRows = '';
    membersData.forEach(m => {
        memberRows += `
            <tr>
                <td>${displayName(m.member_name)}</td>
                <td>${m.team_name}</td>
                <td><span class="status-badge status-executed">${m.status}</span></td>
                <td style="display:flex;gap:4px;">
                    <button class="status-btn" onclick="openMemberForm('${m.id}')">編集</button>
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
        for (const team of getActiveTeamNames(ym)) {
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
function openProjectForm(projectId) {
    editingProjectId = projectId || null;
    document.getElementById('projectFormModal').classList.remove('hidden');
    document.getElementById('projectFormTitle').textContent = editingProjectId ? '案件編集' : '新規案件追加';

    if (editingProjectId) {
        const p = projectsData.find(x => x.id === editingProjectId);
        if (p) {
            document.getElementById('projFormName').value = p.project_name || '';
            document.getElementById('projFormClient').value = p.client_name || '';
            document.getElementById('projFormUnitPrice').value = p.unit_price || '';
            document.getElementById('projFormCapCount').value = p.monthly_cap_count || '';
            document.getElementById('projFormCapAmount').value = p.monthly_cap_amount || '';
            document.getElementById('projFormListUrl').value = p.call_list_url || '';
        }
    } else {
        document.getElementById('projFormName').value = '';
        document.getElementById('projFormClient').value = '';
        document.getElementById('projFormUnitPrice').value = '';
        document.getElementById('projFormCapCount').value = '';
        document.getElementById('projFormCapAmount').value = '';
        document.getElementById('projFormListUrl').value = '';
    }
}

function closeProjectForm() {
    document.getElementById('projectFormModal').classList.add('hidden');
    editingProjectId = null;
}

async function submitProjectForm() {
    const name = document.getElementById('projFormName').value;
    if (!name) return;

    try {
        if (editingProjectId) {
            await executeTurso(
                `UPDATE projects SET project_name = ?, client_name = ?, unit_price = ?, monthly_cap_count = ?, monthly_cap_amount = ?, call_list_url = ?, updated_at = datetime('now') WHERE id = ?`,
                [
                    name,
                    document.getElementById('projFormClient').value || null,
                    parseInt(document.getElementById('projFormUnitPrice').value) || 0,
                    parseInt(document.getElementById('projFormCapCount').value) || null,
                    parseInt(document.getElementById('projFormCapAmount').value) || null,
                    document.getElementById('projFormListUrl').value || null,
                    editingProjectId
                ]
            );
            showToast('案件を更新しました');
        } else {
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
            showToast('案件を追加しました');
        }

        closeProjectForm();
        projectsData = await queryTurso("SELECT * FROM projects WHERE status = 'active' ORDER BY project_name");
        renderProjects();
    } catch (error) {
        alert((editingProjectId ? '案件の更新' : '案件の追加') + 'に失敗しました: ' + error.message);
    }
}

// ==================== メンバーフォーム ====================
function openMemberForm(memberId) {
    editingMemberId = memberId || null;
    document.getElementById('memberFormModal').classList.remove('hidden');
    document.getElementById('memberFormTitle').textContent = editingMemberId ? 'メンバー編集' : 'メンバー追加';

    // チームドロップダウンを動的生成
    const teamSelect = document.getElementById('memberFormTeam');
    teamSelect.innerHTML = '';
    teamsData.filter(t => t.status === 'active').forEach(t => {
        teamSelect.innerHTML += `<option value="${t.team_name}">${t.team_name}</option>`;
    });

    if (editingMemberId) {
        const m = membersData.find(x => x.id === editingMemberId);
        if (m) {
            document.getElementById('memberFormName').value = m.member_name;
            document.getElementById('memberFormDisplayName').value = m.display_name || '';
            document.getElementById('memberFormTeam').value = m.team_name;
        }
    } else {
        document.getElementById('memberFormName').value = '';
        document.getElementById('memberFormDisplayName').value = '';
    }
}

function closeMemberForm() {
    document.getElementById('memberFormModal').classList.add('hidden');
    editingMemberId = null;
}

async function submitMemberForm() {
    const name = document.getElementById('memberFormName').value;
    const displayNameVal = document.getElementById('memberFormDisplayName').value || null;
    const team = document.getElementById('memberFormTeam').value;
    if (!name || !team) return;

    try {
        if (editingMemberId) {
            await executeTurso(
                "UPDATE members SET member_name = ?, display_name = ?, team_name = ? WHERE id = ?",
                [name, displayNameVal, team, editingMemberId]
            );
            showToast('メンバーを更新しました');
        } else {
            await executeTurso(
                "INSERT INTO members (id, member_name, display_name, team_name) VALUES (lower(hex(randomblob(16))), ?, ?, ?)",
                [name, displayNameVal, team]
            );
            showToast('メンバーを追加しました');
        }

        // 当月の team_history も更新
        const currentYM = document.getElementById('filterMonth').value;
        await executeTurso(
            `INSERT INTO member_team_history (id, member_name, team_name, year_month)
             VALUES (lower(hex(randomblob(16))), ?, ?, ?)
             ON CONFLICT(member_name, year_month) DO UPDATE SET team_name = excluded.team_name`,
            [name, team, currentYM]
        );

        closeMemberForm();
        membersData = await queryTurso("SELECT * FROM members WHERE status = 'active' ORDER BY team_name, member_name");
        teamHistoryData = await queryTurso("SELECT * FROM member_team_history ORDER BY year_month, team_name, member_name");
        populateTeamFilter();
        populateMemberFilter();
        populateDailyTargetMember();
        renderSettings();
    } catch (error) {
        alert((editingMemberId ? 'メンバーの更新' : 'メンバーの追加') + 'に失敗しました: ' + error.message);
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

    // 朝礼・経営タブではフィルターを非表示
    const filters = document.getElementById('globalFilters');
    if (filters) {
        filters.style.display = (tab === 'morning' || tab === 'management' || tab === 'analysis') ? 'none' : 'flex';
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

// ==================== サイドバー折りたたみ ====================
function toggleSidebar() {
    const container = document.querySelector('.app-container');
    container.classList.toggle('sidebar-collapsed');
    // チャートのリサイズを待つ
    setTimeout(() => { window.dispatchEvent(new Event('resize')); }, 300);
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

function formatDateDisplay(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const days = ['日','月','火','水','木','金','土'];
    return `${d.getMonth()+1}/${d.getDate()}(${days[d.getDay()]})`;
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
    // 標準進捗は昨日時点で計算
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
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
        if (date <= yesterday) elapsed++;
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

// ==================== フィードバック/改修依頼 ====================
const FEEDBACK_SLACK_CHANNEL = 'C0ACA4Q05PB';
const FEEDBACK_MENTION_IDS = ['U043X21F2GL', 'U06DWC2HFBN']; // 海老根, 菊池

function openFeedbackModal() {
    document.getElementById('feedbackModal').classList.remove('hidden');
    document.getElementById('feedbackType').value = 'バグ報告';
    document.getElementById('feedbackTitle').value = '';
    document.getElementById('feedbackDetail').value = '';
    document.getElementById('feedbackSubmitBtn').disabled = false;
    document.getElementById('feedbackSubmitBtn').textContent = '送信';

    // 報告者プルダウンをメンバーから生成
    const sel = document.getElementById('feedbackReporter');
    sel.innerHTML = '<option value="">選択してください</option>';
    membersData.forEach(m => {
        sel.innerHTML += `<option value="${m.member_name}">${displayName(m.member_name)}</option>`;
    });
}

function closeFeedbackModal() {
    document.getElementById('feedbackModal').classList.add('hidden');
}

async function submitFeedback() {
    const type = document.getElementById('feedbackType').value;
    const title = document.getElementById('feedbackTitle').value;
    const detail = document.getElementById('feedbackDetail').value;
    const reporter = document.getElementById('feedbackReporter').value;
    if (!title) return;

    const btn = document.getElementById('feedbackSubmitBtn');
    btn.disabled = true;
    btn.textContent = '送信中...';

    // Slack メンション
    const mentions = FEEDBACK_MENTION_IDS.map(id => `<@${id}>`).join(' ');
    const reporterText = reporter ? `報告者: ${reporter}` : '報告者: 未選択';

    const slackText = `${mentions}\n:mega: *【成果報酬 DB】${type}*\n\n*${title}*\n${detail ? '\n' + detail + '\n' : ''}\n${reporterText}`;

    try {
        // Slack Webhook経由で送信（GAS proxy）
        await sendFeedbackToSlack(slackText);
        closeFeedbackModal();
        showToast('改修依頼を送信しました');
    } catch (error) {
        btn.disabled = false;
        btn.textContent = '送信';
        showToast('送信に失敗しました: ' + error.message, true);
    }
}

async function sendFeedbackToSlack(text) {
    // Turso の settings テーブルに一旦保存（履歴として）
    await executeTurso(
        `INSERT INTO feedback_requests (id, type, title, detail, reporter, created_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, datetime('now'))`,
        [
            document.getElementById('feedbackType').value,
            document.getElementById('feedbackTitle').value,
            document.getElementById('feedbackDetail').value || null,
            document.getElementById('feedbackReporter').value || null
        ]
    );

    // Slack API で送信（CORS制約があるのでGAS proxyを使う）
    const gasUrl = 'https://script.google.com/macros/s/AKfycbwv2aCYMB7z7OHxqVArBnuyDPCj1-VB9-gBBvXjvw76kGxfcvq1VjzLgxMdJMGdOZJp/exec';
    const res = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'sendSlackFeedback',
            channel: FEEDBACK_SLACK_CHANNEL,
            text: text
        })
    });

    if (!res.ok) throw new Error('Slack送信に失敗しました');
}
