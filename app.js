// ==================== Turso DB 設定 ====================
// TURSO_CONFIG は config.js から読み込み（セキュリティのためGit管理外）

// ==================== グローバル状態 ====================
let currentTab = 'management';
let performanceData = [];
let appointmentsData = [];
let membersData = [];
let teamsData = [];
let projectsData = [];
let projectPlansData = []; // project_plans 全件 (project_id でグルーピングして利用)
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
let historicalAppoData = []; // 2025-07以降の全アポ（案件別ステータス集計用）
let monthlyTotalTargets = {}; // year_month → appointment_amount_target（全月分）
let dailyPlansData = []; // 予定報告データ
let dailyTargetsData = []; // 日別目標
let weeklyTargetsData = []; // 週別目標
// KPIカード前月比用（軽量データ）
let prevPerformanceData = [];
let prevAppointmentsData = [];
let prevExecutionAppoData = [];
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

    // 初期表示タブに合わせてフィルター可視性を調整
    // （currentTab デフォルトは management）
    const filters = document.getElementById('globalFilters');
    const teamGroup = document.getElementById('filterTeam')?.closest('.filter-group');
    const memberGroup = document.getElementById('filterMember')?.closest('.filter-group');
    if (filters) {
        if (currentTab === 'morning') {
            filters.style.display = 'none';
        } else if (currentTab === 'management') {
            filters.style.display = 'flex';
            if (teamGroup) teamGroup.style.display = 'none';
            if (memberGroup) memberGroup.style.display = 'none';
        } else {
            filters.style.display = 'flex';
        }
    }

    // URL パラメータで外部共有モード
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'external') {
        enterExternalMode(params.get('project'));
    }

    loadAllData();
});

// ==================== カスタムセレクト ====================
function initCustomSelects() {
    document.querySelectorAll('select:not(.custom-initialized)').forEach(sel => {
        // モーダル内の select は基本除外 (data-custom-select="1" が明示的にあるものだけ許可)
        if (sel.closest('.modal-content') && sel.dataset.customSelect !== '1') return;
        // すでにカスタム化済みなら除外
        if (sel.classList.contains('custom-initialized')) return;

        sel.classList.add('custom-initialized');
        sel.style.display = 'none';

        const wrap = document.createElement('div');
        wrap.className = 'custom-select-wrap';

        const trigger = document.createElement('div');
        trigger.className = 'custom-select-trigger';
        trigger.textContent = sel.options[sel.selectedIndex]?.text || '';

        const optionsDiv = document.createElement('div');
        optionsDiv.className = 'custom-select-options';

        // 10個以上なら検索付き
        if (sel.options.length > 10) {
            const search = document.createElement('input');
            search.type = 'text';
            search.className = 'custom-select-search';
            search.placeholder = '検索...';
            search.addEventListener('input', () => {
                const q = search.value.toLowerCase();
                optionsDiv.querySelectorAll('.custom-select-option').forEach(opt => {
                    opt.style.display = opt.textContent.toLowerCase().includes(q) ? '' : 'none';
                });
            });
            search.addEventListener('click', e => e.stopPropagation());
            optionsDiv.appendChild(search);
        }

        Array.from(sel.options).forEach((opt, i) => {
            const div = document.createElement('div');
            div.className = 'custom-select-option' + (i === sel.selectedIndex ? ' selected' : '');
            div.textContent = opt.text;
            div.dataset.value = opt.value;
            div.addEventListener('click', (e) => {
                e.stopPropagation();
                sel.value = opt.value;
                sel.dispatchEvent(new Event('change'));
                trigger.textContent = opt.text;
                optionsDiv.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
                div.classList.add('selected');
                wrap.classList.remove('open');
            });
            optionsDiv.appendChild(div);
        });

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            // 他のカスタムセレクトを閉じる
            document.querySelectorAll('.custom-select-wrap.open').forEach(w => {
                if (w !== wrap) w.classList.remove('open');
            });
            wrap.classList.toggle('open');
            // 検索にフォーカス
            const searchInput = optionsDiv.querySelector('.custom-select-search');
            if (searchInput) setTimeout(() => searchInput.focus(), 50);
        });

        wrap.appendChild(trigger);
        wrap.appendChild(optionsDiv);
        sel.parentNode.insertBefore(wrap, sel.nextSibling);
    });
}

// どこかクリックしたら閉じる
document.addEventListener('click', () => {
    document.querySelectorAll('.custom-select-wrap.open').forEach(w => w.classList.remove('open'));
});

// 既存のカスタムセレクトを破棄して作り直す
// (native <select> の options を JS で再構築した後に呼ぶ)
function rebuildCustomSelect(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    let nxt = sel.nextSibling;
    while (nxt && !(nxt.classList && nxt.classList.contains('custom-select-wrap'))) {
        nxt = nxt.nextSibling;
    }
    if (nxt) nxt.remove();
    sel.classList.remove('custom-initialized');
    sel.style.display = '';
    initCustomSelects();
}

// ==================== 数値フォーマット (3桁カンマ) ====================
// UI 表示は年・月・日を除いて 3 桁カンマで統一。
// fmtNum() で表示、parseNum() で読み出し時にカンマ除去。
function fmtNum(n) {
    const v = typeof n === 'string' ? parseFloat(n.replace(/,/g, '')) : Number(n);
    if (!isFinite(v)) return '';
    return v.toLocaleString('ja-JP');
}
function parseNum(s) {
    if (s == null || s === '') return 0;
    const n = parseFloat(String(s).replace(/,/g, ''));
    return isFinite(n) ? n : 0;
}
// type="number" だとカンマを受け付けないため、type="text" + inputmode + 自動カンマ整形
function attachThousandSeparator(input, opts) {
    const initial = input.value;
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    const format = () => {
        const cleaned = String(input.value).replace(/[^\d-]/g, '');
        if (cleaned === '' || cleaned === '-') { input.value = ''; return; }
        input.value = parseInt(cleaned, 10).toLocaleString('ja-JP');
    };
    input.addEventListener('input', () => {
        const cleaned = String(input.value).replace(/[^\d-]/g, '');
        if (cleaned === '' || cleaned === '-') { input.value = ''; return; }
        const formatted = parseInt(cleaned, 10).toLocaleString('ja-JP');
        input.value = formatted;
        // カーソルは末尾へ (簡易)
        try { input.setSelectionRange(formatted.length, formatted.length); } catch (e) {}
    });
    input.addEventListener('blur', format);
    if (opts && opts.runFormatNow) format();
    return input;
}

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
const EXCLUDED_MEMBERS = ['辻森', '田中颯汰'];

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
    '越後敦也': '越後', '越後 敦也': '越後', '@越後敦也/echigo atsuya': '越後',
    '松坂有志': '松坂', '松坂 有志': '松坂', '@松坂有志/matsuzaka yushi': '松坂',
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
    'a.echigo@digi-man.com': '越後',
    'y.matsuzaka@digi-man.com': '松坂',
    'k.harada@digi-man.com': '原田',
    'h.miura@digi-man.com': '三浦',
    'k.urakami@digi-man.com': '浦上',
    '三浦宏成': '三浦',
    '三浦 宏成': '三浦',
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
    const map = {};
    // membersテーブルのteam_nameをbaselineに（month_historyに登録がないメンバーも表示できるよう）
    membersData.forEach(m => {
        if (m.team_name) map[m.member_name] = m.team_name;
    });
    // 月別履歴があれば該当月のみ上書き
    const monthHistory = teamHistoryData.filter(h => h.year_month === ym);
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
    // 個別に永久除外するメンバー
    EXCLUDED_MEMBERS.forEach(m => excluded.add(m));
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
    // 着地ヨミ = 実施確定 + 未確認 × (1 - キャンセル率)
    const execForecast = execAmount + Math.round(execUnconfirmedAmount * (1 - 0.15));

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

// ==================== メンバー個別統計集計 ====================
function computeMemberStats(memberName, ym, range) {
    let perf = performanceData.filter(d => d.member_name === memberName);
    let appo = appointmentsData.filter(d => d.member_name === memberName);
    let execAppo = executionAppoData.filter(d => d.member_name === memberName);
    if (range) {
        perf = perf.filter(d => d.input_date >= range.start && d.input_date <= range.end);
        appo = appo.filter(d => d.acquisition_date >= range.start && d.acquisition_date <= range.end);
        execAppo = execAppo.filter(d => d.scheduled_date >= range.start && d.scheduled_date <= range.end);
    }

    const callCount = sum(perf, 'call_count');
    const prCount = sum(perf, 'pr_count');
    const appoCount = sum(perf, 'appointment_count');
    const appoAmount = sum(perf, 'appointment_amount');
    const execAmount = execAppo.filter(a => a.status === '実施').reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const execUnconfirmedAmount = execAppo.filter(a => a.status === '未確認').reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);

    const memberTarget = getTarget('member', memberName, ym);
    const appoTarget = memberTarget ? (parseFloat(memberTarget.appointment_amount_target) || 0) : 0;
    const execTarget = memberTarget ? (parseFloat(memberTarget.execution_target) || 0) : 0;

    // 実施見込内訳（キャンセル・リスケ除外）
    const execAppoActive = execAppo.filter(a => a.status === '実施' || a.status === '未確認');
    const currentMonthExec = execAppoActive.filter(a => a.acquisition_date && a.acquisition_date.startsWith(ym));
    const prevMonthExec = execAppoActive.filter(a => a.acquisition_date && !a.acquisition_date.startsWith(ym));
    const currentMonthExecAmount = currentMonthExec.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const prevMonthExecAmount = prevMonthExec.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const currentMonthAcqAmount = appo.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const currentMonthExecRate = currentMonthAcqAmount > 0 ? currentMonthExecAmount / currentMonthAcqAmount * 100 : 0;

    return {
        callCount, prCount, appoCount, appoAmount,
        execAmount, execUnconfirmedAmount,
        appoTarget, execTarget,
        currentMonthExecAmount, prevMonthExecAmount, currentMonthExecRate,
        perf, appo, execAppo
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
        "UPDATE members SET status = 'active' WHERE member_name IN ('田中か', '村松', '美除', '三善', '小甲') AND status != 'active'"
    );
}

// appointments テーブルに soft delete 用カラムを追加（マイグレーション、idempotent）
async function ensureAppointmentSoftDeleteColumns() {
    try { await executeTurso("ALTER TABLE appointments ADD COLUMN deleted_at TEXT"); }
    catch (e) { /* カラム存在済み */ }
    try { await executeTurso("ALTER TABLE appointments ADD COLUMN delete_reason TEXT"); }
    catch (e) { /* カラム存在済み */ }
}

// 指定 project_id の全プランを plan_order 昇順で返す
function getPlansForProject(projectId) {
    return (projectPlansData || [])
        .filter(p => p.project_id === projectId)
        .sort((a, b) => (a.plan_order || 0) - (b.plan_order || 0));
}

// members テーブルに soft delete 用 deleted_at カラムを追加（idempotent）
async function ensureMembersSoftDeleteColumn() {
    try { await executeTurso("ALTER TABLE members ADD COLUMN deleted_at TEXT"); }
    catch (e) { /* カラム存在済み */ }
}

// project_plans テーブル（1案件 N プラン）を作成 + 既存 projects データを plan_order=1 として移行（idempotent）
async function ensureProjectPlansTable() {
    try {
        await executeTurso(
            "CREATE TABLE IF NOT EXISTS project_plans (" +
            "  id TEXT PRIMARY KEY," +
            "  project_id TEXT NOT NULL," +
            "  plan_order INTEGER NOT NULL," +
            "  unit_price INTEGER DEFAULT 0," +
            "  monthly_cap_count INTEGER DEFAULT 0," +
            "  monthly_cap_amount INTEGER DEFAULT 0," +
            "  created_at TEXT DEFAULT (datetime('now'))," +
            "  updated_at TEXT DEFAULT (datetime('now'))," +
            "  UNIQUE(project_id, plan_order)" +
            ")"
        );
    } catch (e) { console.warn('project_plans 作成失敗:', e); }
    try {
        // まだ plan が無い projects を plan_order=1 として移行
        await executeTurso(
            "INSERT INTO project_plans (id, project_id, plan_order, unit_price, monthly_cap_count, monthly_cap_amount) " +
            "SELECT lower(hex(randomblob(16))), p.id, 1, " +
            "       COALESCE(p.unit_price, 0), COALESCE(p.monthly_cap_count, 0), COALESCE(p.monthly_cap_amount, 0) " +
            "FROM projects p " +
            "WHERE NOT EXISTS (SELECT 1 FROM project_plans pp WHERE pp.project_id = p.id)"
        );
    } catch (e) { console.warn('project_plans 初期移行失敗:', e); }
}

// ==================== データ読み込み ====================
async function loadAllData() {
    showLoading();
    try {
        await ensureMembers();
        await ensureAppointmentSoftDeleteColumns();
        await ensureMembersSoftDeleteColumn();
        await ensureProjectPlansTable();
        console.log('Loading master data...');
        const results = await Promise.all([
            queryTurso("SELECT * FROM members WHERE status IN ('active','inactive') AND (deleted_at IS NULL) ORDER BY (status='active') DESC, team_name, member_name"),
            queryTurso("SELECT * FROM teams WHERE status IN ('active','inactive')"),
            queryTurso("SELECT * FROM projects WHERE status IN ('active','inactive') ORDER BY project_name"),
            queryTurso("SELECT * FROM project_plans ORDER BY project_id, plan_order").catch(() => []),
            queryTurso("SELECT * FROM settings"),
            queryTurso("SELECT date FROM holidays"),
            queryTurso("SELECT * FROM member_team_history ORDER BY year_month, team_name, member_name")
        ]);

        membersData = results[0];
        teamsData = results[1];
        projectsData = stripExcludedProjects(results[2]);
        projectPlansData = results[3] || [];
        settingsMap = {};
        results[4].forEach(s => { settingsMap[s.key] = s.value; });
        holidaysSet = new Set(results[5].map(h => h.date));
        teamHistoryData = results[6];

        // DBの祝日をマージ（フォールバックのHOLIDAYS_2026に追加）
        results[5].forEach(h => { if (h.date) holidaysSet.add(h.date); });

        console.log('Master data loaded:', membersData.length, 'members,', teamsData.length, 'teams,', projectsData.length, 'projects,', holidaysSet.size, 'holidays,', teamHistoryData.length, 'team history');

        populateTeamFilter();
        populateMemberFilter();
        populateDailyTargetMember();

        await loadMonthData();
        loadMappings();
        loadHistoricalAppointments();

        document.getElementById('lastUpdated').textContent = `最終更新: ${new Date().toLocaleString('ja-JP')}`;

        initCustomSelects();
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
    const nextMonthStart = getNextYM(ym) + '-01';

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
        // 当月実施予定アポ(前月以前取得含む) + 当月取得かつ翌月以降実施(リスケ対象)
        queryTurso(
            "SELECT * FROM appointments WHERE (scheduled_date >= ? AND scheduled_date <= ?) OR (acquisition_date >= ? AND acquisition_date <= ? AND scheduled_date >= ?) ORDER BY scheduled_date",
            [startDate, endDate, startDate, endDate, nextMonthStart]
        ),
        // 予定報告データ
        queryTurso(
            "SELECT * FROM daily_plans WHERE planned_date >= ? AND planned_date <= ? ORDER BY planned_date",
            [startDate, endDate]
        ).catch(function() { return []; }),
        queryTurso(
            "SELECT * FROM daily_targets WHERE target_date >= ? AND target_date <= ?",
            [startDate, endDate]
        ).catch(function() { return []; }),
        queryTurso(
            "SELECT * FROM weekly_targets WHERE year_month = ?",
            [ym]
        ).catch(function() { return []; })
    ]);

    performanceData = results[0];
    appointmentsData = results[1];
    targetsData = results[2];
    assignmentsData = results[3] || [];
    executionAppoData = results[4] || [];
    dailyPlansData = results[5] || [];
    dailyTargetsData = results[6] || [];
    weeklyTargetsData = results[7] || [];

    // メンバー名正規化（DB側に非正規名が入っていても正しく集計）
    normalizeDataMemberNames(performanceData);
    normalizeDataMemberNames(appointmentsData);
    normalizeDataMemberNames(executionAppoData);
    normalizeDataMemberNames(assignmentsData);
    normalizeDataMemberNames(dailyPlansData);

    // 同一人物の重複アポを除去（member_name + project_name + acquisition_date + customer_name）
    appointmentsData = deduplicateAppointments(appointmentsData);
    executionAppoData = deduplicateAppointments(executionAppoData);
    // 集計除外顧客（例: 日本経済新聞）を全体から落とす
    appointmentsData = stripExcludedAppos(appointmentsData);
    executionAppoData = stripExcludedAppos(executionAppoData);
    performanceData = stripExcludedAppos(performanceData);
    appointmentsData = stripDeletedAppos(appointmentsData);
    executionAppoData = stripDeletedAppos(executionAppoData);

    // KPIカード前月比用に前月データもまとめてロード
    const prevYM = getPrevYM(ym);
    const prevStart = prevYM + '-01';
    const prevEnd = getEndOfMonth(prevYM);
    const prevResults = await Promise.all([
        queryTurso(
            "SELECT input_date, member_name, project_name, call_count, pr_count, appointment_count, call_hours FROM performance_rawdata WHERE input_date >= ? AND input_date <= ?",
            [prevStart, prevEnd]
        ).catch(() => []),
        queryTurso(
            "SELECT acquisition_date, scheduled_date, member_name, project_name, customer_name, status, amount FROM appointments WHERE acquisition_date >= ? AND acquisition_date <= ?",
            [prevStart, prevEnd]
        ).catch(() => []),
        queryTurso(
            "SELECT acquisition_date, scheduled_date, member_name, project_name, customer_name, status, amount FROM appointments WHERE scheduled_date >= ? AND scheduled_date <= ?",
            [prevStart, prevEnd]
        ).catch(() => [])
    ]);
    prevPerformanceData = prevResults[0] || [];
    prevAppointmentsData = prevResults[1] || [];
    prevExecutionAppoData = prevResults[2] || [];
    normalizeDataMemberNames(prevPerformanceData);
    normalizeDataMemberNames(prevAppointmentsData);
    normalizeDataMemberNames(prevExecutionAppoData);
    prevAppointmentsData = deduplicateAppointments(prevAppointmentsData);
    prevExecutionAppoData = deduplicateAppointments(prevExecutionAppoData);
    prevAppointmentsData = stripExcludedAppos(prevAppointmentsData);
    prevExecutionAppoData = stripExcludedAppos(prevExecutionAppoData);
    prevAppointmentsData = stripDeletedAppos(prevAppointmentsData);
    prevExecutionAppoData = stripDeletedAppos(prevExecutionAppoData);
    prevPerformanceData = deduplicatePerformance(prevPerformanceData);
    prevPerformanceData = stripExcludedAppos(prevPerformanceData);

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

    // 朝礼・経営はフィルタなし（全体表示）
    const noFilter = { team: 'all', member: 'all', month: filter.month };
    renderManagement(noFilter);
    renderMorning(noFilter);

    // 他のタブはフィルター適用
    renderAppointments();
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

// 集計・表示から完全除外（customer_name または project_name に「日本経済新聞」を含むレコード）
const EXCLUDED_KEYWORD = '日本経済新聞';
function isExcludedAppo(a) {
    if (!a) return false;
    if ((a.customer_name || '').includes(EXCLUDED_KEYWORD)) return true;
    if ((a.project_name || '').includes(EXCLUDED_KEYWORD)) return true;
    return false;
}
function stripExcludedAppos(list) {
    return (list || []).filter(a => !isExcludedAppo(a));
}
// UI からの soft delete 済みアポを集計・表示から除外
function stripDeletedAppos(list) {
    return (list || []).filter(a => !a.deleted_at);
}
function isExcludedProject(p) {
    return p && (p.project_name || '').includes(EXCLUDED_KEYWORD);
}
function stripExcludedProjects(list) {
    return (list || []).filter(p => !isExcludedProject(p));
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
let mrnPeriod = 'month';

// 朝礼用 期間ピッカーの状態
const mrnDatePickerState = {
    mode: 'single',
    single: null,
    rangeStart: null,
    rangeEnd: null,
    popoverMonth: null,
    popoverPickStep: 'start',
    activeInput: null
};

function fmtYmdLocal(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function parseYmd(s) {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function shiftYmMrn(ym, delta) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function setMrnPickerMode(mode) {
    mrnDatePickerState.mode = mode;
    if (mode === 'single') {
        mrnDatePickerState.rangeStart = null;
        mrnDatePickerState.rangeEnd = null;
    } else {
        mrnDatePickerState.single = null;
    }
    renderMrnPickerBar();
}

function openMrnPickerPopover(which) {
    mrnDatePickerState.activeInput = which;
    const st = mrnDatePickerState;
    const ref = which === 'end' ? st.rangeEnd : (which === 'start' ? st.rangeStart : st.single);
    const refDate = ref ? parseYmd(ref) : new Date();
    st.popoverMonth = refDate.getFullYear() + '-' + String(refDate.getMonth() + 1).padStart(2, '0');
    if (st.mode === 'range') {
        st.popoverPickStep = which === 'end' ? 'end' : 'start';
    }
    renderMrnPickerPopover();
    document.getElementById('mrnPickerPopover').classList.add('open');
}

function closeMrnPickerPopover() {
    const pop = document.getElementById('mrnPickerPopover');
    if (pop) pop.classList.remove('open');
    mrnDatePickerState.activeInput = null;
}

function shiftPopoverMonth(delta) {
    mrnDatePickerState.popoverMonth = shiftYmMrn(mrnDatePickerState.popoverMonth, delta);
    renderMrnPickerPopover();
}

function selectMrnPickerDay(ymd) {
    const st = mrnDatePickerState;
    if (st.mode === 'single') {
        st.single = ymd;
        mrnPeriod = 'day';
        closeMrnPickerPopover();
        renderMrnPickerBar();
        applyMrnPicker();
        return;
    }
    if (st.popoverPickStep === 'start' || !st.rangeStart || (st.rangeStart && st.rangeEnd)) {
        st.rangeStart = ymd;
        st.rangeEnd = null;
        st.popoverPickStep = 'end';
    } else {
        if (parseYmd(ymd) < parseYmd(st.rangeStart)) {
            st.rangeEnd = st.rangeStart;
            st.rangeStart = ymd;
        } else {
            st.rangeEnd = ymd;
        }
        mrnPeriod = 'custom';
        closeMrnPickerPopover();
        renderMrnPickerBar();
        applyMrnPicker();
        return;
    }
    renderMrnPickerBar();
    if (st.activeInput) renderMrnPickerPopover();
}

function clearMrnPicker() {
    mrnDatePickerState.single = null;
    mrnDatePickerState.rangeStart = null;
    mrnDatePickerState.rangeEnd = null;
    mrnPeriod = 'month';
    closeMrnPickerPopover();
    renderMrnPickerBar();
    applyMrnPicker();
}

function setMrnPickerToday() {
    selectMrnPickerDay(fmtYmdLocal(new Date()));
}

async function applyMrnPicker() {
    const st = mrnDatePickerState;
    let targetMonth = null;
    if (st.mode === 'single' && st.single) targetMonth = st.single.slice(0, 7);
    else if (st.mode === 'range' && st.rangeStart) targetMonth = st.rangeStart.slice(0, 7);

    const filterMonth = document.getElementById('filterMonth');
    if (targetMonth && filterMonth.value !== targetMonth) {
        filterMonth.value = targetMonth;
        await loadMonthData();
    }
    renderMorning({ month: filterMonth.value });
}

function renderMrnPickerBar() {
    const bar = document.getElementById('mrnPickerBar');
    if (!bar) return;
    const st = mrnDatePickerState;
    let inputsHtml;
    if (st.mode === 'single') {
        inputsHtml = `
            <div class="mrn-picker-input-wrap">
                <input type="text" class="mrn-picker-input" readonly value="${st.single || ''}" placeholder="YYYY-MM-DD" onclick="openMrnPickerPopover('single')">
                <span class="mrn-picker-icon">📅</span>
            </div>
        `;
    } else {
        inputsHtml = `
            <div class="mrn-picker-input-wrap">
                <input type="text" class="mrn-picker-input" readonly value="${st.rangeStart || ''}" placeholder="開始日" onclick="openMrnPickerPopover('start')">
                <span class="mrn-picker-icon">📅</span>
            </div>
            <span class="mrn-picker-sep">〜</span>
            <div class="mrn-picker-input-wrap">
                <input type="text" class="mrn-picker-input" readonly value="${st.rangeEnd || ''}" placeholder="終了日" onclick="openMrnPickerPopover('end')">
                <span class="mrn-picker-icon">📅</span>
            </div>
        `;
    }
    let summary = '';
    if (st.mode === 'single' && st.single) summary = '対象: ' + st.single;
    if (st.mode === 'range' && st.rangeStart && st.rangeEnd) summary = '期間: ' + st.rangeStart + ' 〜 ' + st.rangeEnd;
    bar.innerHTML = `
        <div class="mrn-picker-mode">
            <button class="${st.mode === 'single' ? 'active' : ''}" onclick="setMrnPickerMode('single')">単日</button>
            <button class="${st.mode === 'range' ? 'active' : ''}" onclick="setMrnPickerMode('range')">期間</button>
        </div>
        <div style="position:relative;display:inline-flex;align-items:center;gap:6px;">
            ${inputsHtml}
            <div id="mrnPickerPopover" class="mrn-picker-popover"></div>
        </div>
        <button class="mrn-picker-apply" onclick="applyMrnPicker()">適用</button>
        <button class="mrn-picker-clear" onclick="clearMrnPicker()">クリア</button>
        <span class="mrn-picker-summary">${summary}</span>
    `;
    const pop = document.getElementById('mrnPickerPopover');
    if (pop) pop.onclick = function(e) { e.stopPropagation(); };
}

function renderMrnPickerPopover() {
    const pop = document.getElementById('mrnPickerPopover');
    if (!pop) return;
    const st = mrnDatePickerState;
    const ym = st.popoverMonth || (new Date()).getFullYear() + '-' + String((new Date()).getMonth() + 1).padStart(2, '0');
    const [y, m] = ym.split('-').map(Number);
    const monthLabel = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'][m - 1] + ' ' + y;
    const firstDow = new Date(y, m - 1, 1).getDay();
    const lastDay = new Date(y, m, 0).getDate();
    const todayStr = fmtYmdLocal(new Date());

    let html = '<div class="mrn-picker-pop-header">'
        + '<div class="mrn-picker-pop-month">' + monthLabel + '</div>'
        + '<div class="mrn-picker-pop-nav">'
        + '<button onclick="shiftPopoverMonth(-1)">↑</button>'
        + '<button onclick="shiftPopoverMonth(1)">↓</button>'
        + '</div></div>';
    html += '<div class="mrn-picker-pop-grid">';
    const labels = ['日','月','火','水','木','金','土'];
    labels.forEach(function(l, i) {
        const cls = i === 0 ? 'sun' : i === 6 ? 'sat' : '';
        html += '<div class="mrn-picker-pop-dlabel ' + cls + '">' + l + '</div>';
    });
    const prevYm = shiftYmMrn(ym, -1);
    const [py, pm] = prevYm.split('-').map(Number);
    const prevLast = new Date(py, pm, 0).getDate();
    for (let i = firstDow - 1; i >= 0; i--) {
        const d = prevLast - i;
        const ds = prevYm + '-' + String(d).padStart(2, '0');
        html += '<div class="mrn-picker-pop-day other" onclick="selectMrnPickerDay(\'' + ds + '\')">' + d + '</div>';
    }
    for (let d = 1; d <= lastDay; d++) {
        const ds = ym + '-' + String(d).padStart(2, '0');
        const cls = ['mrn-picker-pop-day'];
        if (ds === todayStr) cls.push('today');
        if (st.mode === 'single' && ds === st.single) cls.push('selected');
        if (st.mode === 'range') {
            if (ds === st.rangeStart) cls.push('range-start');
            if (ds === st.rangeEnd) cls.push('range-end');
            if (st.rangeStart && st.rangeEnd && ds > st.rangeStart && ds < st.rangeEnd) cls.push('in-range');
        }
        html += '<div class="' + cls.join(' ') + '" onclick="selectMrnPickerDay(\'' + ds + '\')">' + d + '</div>';
    }
    const totalCells = firstDow + lastDay;
    const trailing = (7 - (totalCells % 7)) % 7;
    const nextYm = shiftYmMrn(ym, 1);
    for (let i = 1; i <= trailing; i++) {
        const ds = nextYm + '-' + String(i).padStart(2, '0');
        html += '<div class="mrn-picker-pop-day other" onclick="selectMrnPickerDay(\'' + ds + '\')">' + i + '</div>';
    }
    html += '</div>';
    html += '<div class="mrn-picker-pop-footer">'
        + '<button onclick="clearMrnPicker()">Clear</button>'
        + '<button onclick="setMrnPickerToday()">Today</button>'
        + '</div>';
    pop.innerHTML = html;
}

document.addEventListener('click', function(e) {
    const pop = document.getElementById('mrnPickerPopover');
    if (!pop || !pop.classList.contains('open')) return;
    if (pop.contains(e.target)) return;
    if (e.target.closest('.mrn-picker-input-wrap')) return;
    closeMrnPickerPopover();
});

function switchMrnPeriod(period) {
    if (period === 'custom') {
        // カスタム選択時はピッカー範囲モードに切替（実際の期間はピッカーで指定）
        setMrnPickerMode('range');
        return;
    }
    // 通常トグル: ピッカー状態をクリアしてピッカー優先を解除
    mrnDatePickerState.single = null;
    mrnDatePickerState.rangeStart = null;
    mrnDatePickerState.rangeEnd = null;
    mrnPeriod = period;
    document.querySelectorAll('.mrn-period-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.period === period);
    });
    var noFilter = { month: document.getElementById('filterMonth').value };
    renderMorning(noFilter);
}

function renderMorning(filter) {
    renderMrnPickerBar();
    const ym = filter.month;
    const totalTarget = getTarget('total', 'all', ym);
    const monthlyTarget = totalTarget ? totalTarget.appointment_amount_target : parseInt(settingsMap.monthly_target_total || '16000000');
    const executionTarget = totalTarget ? (totalTarget.execution_target || monthlyTarget) : monthlyTarget;

    // 営業日
    const { elapsed, total: totalDays } = getBusinessDays(ym);
    const standardProgress = totalDays > 0 ? Math.round(elapsed / totalDays * 1000) / 10 : 0;
    const remaining = totalDays - elapsed;

    // 期間に応じた目標金額
    const periodTarget = calcMrnPeriodTarget(monthlyTarget, totalDays, ym);
    const periodExecTarget = calcMrnPeriodTarget(executionTarget, totalDays, ym);

    // 期間に応じたデータフィルタ
    const excluded = getExcludedMembers(ym);
    const periodData = filterByMrnPeriod(
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
    const execExpected = execConfirmed + execUnconfirmed;

    document.getElementById('progressBadge').textContent = `標準進捗: ${standardProgress}%`;
    document.getElementById('dateInfo').textContent = `${ym} | 経過 ${elapsed}日 / 全${totalDays}営業日`;

    const periodLabels = { day: '日別', week: '週別', month: '月別', quarter: 'Q別', custom: 'カスタム' };

    // 取得進捗
    const acqRate = periodTarget > 0 ? Math.round(acquisitionAmount / periodTarget * 1000) / 10 : 0;

    // 実施進捗
    const confirmedRate = periodExecTarget > 0 ? Math.round(execConfirmed / periodExecTarget * 1000) / 10 : 0;

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

    // 着地ヨミ
    const RESKED_CANCEL_RATE_MRN = 0.15;
    const execForecastMrn = execConfirmed + Math.round(execUnconfirmed * (1 - RESKED_CANCEL_RATE_MRN));
    const forecastDiffMrn = execForecastMrn - periodExecTarget;
    const forecastColorMrn = forecastDiffMrn >= 0 ? '#86aaec' : '#ef947a';

    // KPIカード（経営タブと同じゲージスタイル + 期間切替）
    document.getElementById('morningKpiBar').innerHTML = `
        <div class="mgmt-period-bar">
            <button class="mrn-period-btn mgmt-period-btn ${mrnPeriod === 'day' ? 'active' : ''}" data-period="day" onclick="switchMrnPeriod('day')">日別</button>
            <button class="mrn-period-btn mgmt-period-btn ${mrnPeriod === 'week' ? 'active' : ''}" data-period="week" onclick="switchMrnPeriod('week')">週別</button>
            <button class="mrn-period-btn mgmt-period-btn ${mrnPeriod === 'month' ? 'active' : ''}" data-period="month" onclick="switchMrnPeriod('month')">月別</button>
            <button class="mrn-period-btn mgmt-period-btn ${mrnPeriod === 'custom' ? 'active' : ''}" data-period="custom" onclick="switchMrnPeriod('custom')">カスタム</button>
            <span class="mgmt-period-label">${periodLabels[mrnPeriod] || ''}表示</span>
        </div>
        <div class="mgmt-top-cards">
            <div class="mgmt-gauge-card">
                <div class="mgmt-gauge-title">取得金額</div>
                <div class="mgmt-gauge-wrap"><canvas id="mrnGaugeAcq"></canvas></div>
                <div class="mgmt-gauge-footer">目標 ¥${periodTarget.toLocaleString()}</div>
            </div>
            <div class="mgmt-gauge-card mgmt-yomi-card">
                <div class="mgmt-gauge-title">着地ヨミ<span style="font-size:0.7rem;color:var(--text-light);margin-left:6px;">85%換算</span></div>
                <div class="mgmt-yomi-value" style="color:${forecastColorMrn};">¥${execForecastMrn.toLocaleString()}</div>
                <div class="mgmt-yomi-sub">確定 ¥${execConfirmed.toLocaleString()} ＋ 未確認 ¥${execUnconfirmed.toLocaleString()} × 85%</div>
                <div class="mgmt-yomi-diff" style="color:${forecastColorMrn};">目標比 ${forecastDiffMrn >= 0 ? '+' : ''}¥${forecastDiffMrn.toLocaleString()}</div>
            </div>
        </div>
    `;

    // ゲージチャート描画（朝礼用: charts に保存、destroyMgmtCharts の影響を受けない）
    if (charts['mrnGaugeAcq']) { charts['mrnGaugeAcq'].destroy(); }
    charts['mrnGaugeAcq'] = createGaugeChart('mrnGaugeAcq', acquisitionAmount, periodTarget, standardProgress, '取得金額', '達成率 ' + acqRate + '%');

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

    // メンバー比較テーブル（個人単位）
    const memberTeamMap = getTeamsForMonth(ym);
    const excludedSet = new Set(getExcludedMembers(ym));
    const memberNames = Object.keys(memberTeamMap)
        .filter(name => !excludedSet.has(name))
        .filter(name => {
            const t = memberTeamMap[name];
            return t && t !== '未所属' && t !== '所属なし';
        })
        .filter(name => membersData.some(m => m.member_name === name && m.status === 'active'));

    const memberPickerRange = getMrnEffectiveRange(ym);
    const memberRows = memberNames.map(memberName => {
        const teamName = memberTeamMap[memberName];
        const s = computeMemberStats(memberName, ym, memberPickerRange);
        const lap = totalDays > 0 ? Math.round(s.appoTarget * (elapsed / totalDays)) : 0;
        const acqR = s.appoTarget > 0 ? Math.round(s.appoAmount / s.appoTarget * 1000) / 10 : 0;
        const execR = s.execTarget > 0 ? Math.round(s.execAmount / s.execTarget * 1000) / 10 : 0;
        const acqColor = acqR >= standardProgress ? '#86aaec' : acqR >= standardProgress * 0.8 ? '#ede07d' : '#ef947a';
        const execColor = execR >= standardProgress ? '#86aaec' : execR >= standardProgress * 0.8 ? '#ede07d' : '#ef947a';
        const execWarn = s.currentMonthExecRate < 60;
        return { memberName, teamName, s, lap, acqR, execR, acqColor, execColor, execWarn };
    });
    // チーム→名前順でソート
    memberRows.sort((a, b) => {
        if (a.teamName !== b.teamName) return a.teamName.localeCompare(b.teamName);
        return a.memberName.localeCompare(b.memberName);
    });

    // 合計行の計算
    const totals = {
        appoTarget: memberRows.reduce((s, r) => s + r.s.appoTarget, 0),
        appoAmount: memberRows.reduce((s, r) => s + r.s.appoAmount, 0),
        execTarget: memberRows.reduce((s, r) => s + r.s.execTarget, 0),
        execAmount: memberRows.reduce((s, r) => s + r.s.execAmount, 0),
        execUnconfirmed: memberRows.reduce((s, r) => s + r.s.execUnconfirmedAmount, 0),
        currentMonthExec: memberRows.reduce((s, r) => s + r.s.currentMonthExecAmount, 0),
        prevMonthExec: memberRows.reduce((s, r) => s + r.s.prevMonthExecAmount, 0),
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
                    <th>メンバー</th>
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

    memberRows.forEach(r => {
        tableHtml += `
                <tr>
                    <td class="morning-team-cell">${escapeHtml(displayName(r.memberName))}</td>
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

    // 日次推移グラフ
    renderMorningLineSection(ym);
}

// ==================== 朝礼: 日別目論見金額テーブル ====================
// All data comes from internal DB (membersData, performanceData, dailyPlansData).
// DOM methods used for safe rendering - no innerHTML with user content.
function renderMorningDailyAmount(ym) {
    var table = document.getElementById('morningDailyAmountTable');
    if (!table) return;

    var memberTeamMap = getTeamsForMonth(ym);
    var activeMembers = membersData.filter(function(m) { return m.status === 'active'; });
    var teamMembers = activeMembers.filter(function(m) {
        var team = memberTeamMap[m.member_name];
        return team && team !== '未所属';
    });

    var today = new Date();

    // 前営業日
    var yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    while (yesterday.getDay() === 0 || yesterday.getDay() === 6 || holidaysSet.has(fmtDateYMD(yesterday))) {
        yesterday.setDate(yesterday.getDate() - 1);
    }
    var yesterdayStr = fmtDateYMD(yesterday);

    // 翌営業日
    var tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    while (tomorrow.getDay() === 0 || tomorrow.getDay() === 6 || holidaysSet.has(fmtDateYMD(tomorrow))) {
        tomorrow.setDate(tomorrow.getDate() + 1);
    }
    var tomorrowStr = fmtDateYMD(tomorrow);

    // 案件単価マップ
    var projectPriceMap = {};
    projectsData.forEach(function(p) { projectPriceMap[p.project_name] = parseFloat(p.unit_price) || 0; });

    // 前日実績集計
    var yesterdayPerf = {};
    performanceData.filter(function(d) { return d.input_date === yesterdayStr; }).forEach(function(d) {
        var name = d.member_name;
        if (!yesterdayPerf[name]) yesterdayPerf[name] = { calls: 0, appo: 0, amount: 0 };
        yesterdayPerf[name].calls += parseInt(d.call_count) || 0;
        yesterdayPerf[name].appo += parseInt(d.appointment_count) || 0;
        yesterdayPerf[name].amount += parseFloat(d.appointment_amount) || ((parseInt(d.appointment_count) || 0) * (projectPriceMap[d.project_name] || 0));
    });

    // 翌日予定集計
    var tomorrowPlan = {};
    dailyPlansData.filter(function(d) { return d.planned_date === tomorrowStr; }).forEach(function(d) {
        var name = d.member_name;
        if (!tomorrowPlan[name]) tomorrowPlan[name] = { plannedCalls: 0, appo: 0, amount: 0 };
        tomorrowPlan[name].plannedCalls += parseInt(d.planned_calls) || 0;
        tomorrowPlan[name].appo += parseInt(d.appointment_count) || 0;
        tomorrowPlan[name].amount += (parseInt(d.appointment_count) || 0) * (projectPriceMap[d.project_name] || 0);
    });

    // チーム別グルーピング
    var teamGroups = {};
    teamMembers.forEach(function(m) {
        var team = memberTeamMap[m.member_name] || '未所属';
        if (!teamGroups[team]) teamGroups[team] = [];
        teamGroups[team].push(m.member_name);
    });

    var fmtDate = function(d) { return (d.getMonth() + 1) + '/' + d.getDate(); };
    var totalYC = 0, totalYA = 0, totalYAmt = 0;
    var totalTC = 0, totalTA = 0, totalTAmt = 0;

    // DOM構築
    table.textContent = '';

    var thead = document.createElement('thead');
    var hr1 = document.createElement('tr');
    var thM = document.createElement('th'); thM.rowSpan = 2; thM.textContent = 'メンバー'; hr1.appendChild(thM);
    var thT = document.createElement('th'); thT.rowSpan = 2; thT.textContent = 'チーム'; hr1.appendChild(thT);
    var thY = document.createElement('th'); thY.colSpan = 3; thY.className = 'group-header yesterday-header'; thY.textContent = '前日実績（' + fmtDate(yesterday) + '）'; hr1.appendChild(thY);
    var thTm = document.createElement('th'); thTm.colSpan = 3; thTm.className = 'group-header tomorrow-header'; thTm.textContent = '翌日予定（' + fmtDate(tomorrow) + '）'; hr1.appendChild(thTm);
    thead.appendChild(hr1);

    var hr2 = document.createElement('tr');
    ['架電', 'アポ', '金額', '架電目', 'アポ', '金額'].forEach(function(label) {
        var th = document.createElement('th'); th.className = 'num'; th.textContent = label; hr2.appendChild(th);
    });
    thead.appendChild(hr2);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    var teamNames = Object.keys(teamGroups).sort();

    teamNames.forEach(function(teamName) {
        var members = teamGroups[teamName].sort();
        var tYC = 0, tYA = 0, tYAmt = 0, tTC = 0, tTA = 0, tTAmt = 0;

        members.forEach(function(name) {
            var yp = yesterdayPerf[name] || { calls: 0, appo: 0, amount: 0 };
            var tp = tomorrowPlan[name] || { plannedCalls: 0, appo: 0, amount: 0 };
            tYC += yp.calls; tYA += yp.appo; tYAmt += yp.amount;
            tTC += tp.plannedCalls; tTA += tp.appo; tTAmt += tp.amount;

            var tr = document.createElement('tr');
            [
                { t: displayName(name), c: '' },
                { t: teamName.replace('Team', ''), c: 'team-col' },
                { t: yp.calls || '-', c: 'num' },
                { t: yp.appo || '-', c: 'num' },
                { t: yp.amount > 0 ? '¥' + yp.amount.toLocaleString() : '-', c: 'num' + (yp.amount > 0 ? ' highlight' : '') },
                { t: tp.plannedCalls || '-', c: 'num' },
                { t: tp.appo || '-', c: 'num' },
                { t: tp.amount > 0 ? '¥' + tp.amount.toLocaleString() : '-', c: 'num' + (tp.amount > 0 ? ' highlight' : '') }
            ].forEach(function(cell) {
                var td = document.createElement('td'); td.className = cell.c; td.textContent = cell.t; tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });

        // チーム小計
        var subTr = document.createElement('tr'); subTr.className = 'subtotal-row';
        var subTd = document.createElement('td'); subTd.colSpan = 2; subTd.textContent = teamName + ' 計'; subTr.appendChild(subTd);
        [
            { t: tYC || '-', c: 'num' }, { t: tYA || '-', c: 'num' },
            { t: tYAmt > 0 ? '¥' + tYAmt.toLocaleString() : '-', c: 'num highlight' },
            { t: tTC || '-', c: 'num' }, { t: tTA || '-', c: 'num' },
            { t: tTAmt > 0 ? '¥' + tTAmt.toLocaleString() : '-', c: 'num highlight' }
        ].forEach(function(cell) {
            var td = document.createElement('td'); td.className = cell.c; td.textContent = cell.t; subTr.appendChild(td);
        });
        tbody.appendChild(subTr);

        totalYC += tYC; totalYA += tYA; totalYAmt += tYAmt;
        totalTC += tTC; totalTA += tTA; totalTAmt += tTAmt;
    });

    // 合計行
    var totalTr = document.createElement('tr'); totalTr.className = 'total-row';
    var totalTd = document.createElement('td'); totalTd.colSpan = 2; totalTd.textContent = '合計'; totalTr.appendChild(totalTd);
    [
        { t: totalYC || '-', c: 'num' }, { t: totalYA || '-', c: 'num' },
        { t: totalYAmt > 0 ? '¥' + totalYAmt.toLocaleString() : '-', c: 'num highlight' },
        { t: totalTC || '-', c: 'num' }, { t: totalTA || '-', c: 'num' },
        { t: totalTAmt > 0 ? '¥' + totalTAmt.toLocaleString() : '-', c: 'num highlight' }
    ].forEach(function(cell) {
        var td = document.createElement('td'); td.className = cell.c; td.textContent = cell.t; totalTr.appendChild(td);
    });
    tbody.appendChild(totalTr);
    table.appendChild(tbody);
}

function fmtDateYMD(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 朝礼用: 期間フィルタ
function getMrnEffectiveRange(ym) {
    var st = mrnDatePickerState;
    if (st.mode === 'single' && st.single) {
        return { start: st.single, end: st.single, isCustom: true };
    }
    if (st.mode === 'range' && st.rangeStart && st.rangeEnd) {
        return { start: st.rangeStart, end: st.rangeEnd, isCustom: true };
    }
    return null;
}

function filterByMrnPeriod(perfData, appoData, execData, ym) {
    // ピッカー優先
    var customRange = getMrnEffectiveRange(ym);
    if (customRange) {
        return {
            perf: perfData.filter(function(d) { return d.input_date >= customRange.start && d.input_date <= customRange.end; }),
            appo: appoData.filter(function(d) { return d.acquisition_date >= customRange.start && d.acquisition_date <= customRange.end; }),
            exec: execData.filter(function(d) { return d.scheduled_date >= customRange.start && d.scheduled_date <= customRange.end; })
        };
    }
    if (mrnPeriod === 'month') {
        var mStart = ym + '-01';
        var mEnd = getEndOfMonth(ym);
        return { perf: perfData, appo: appoData, exec: execData.filter(function(d) { return d.scheduled_date && d.scheduled_date >= mStart && d.scheduled_date <= mEnd; }) };
    }
    var today = new Date();
    var startDate, endDate;
    if (mrnPeriod === 'day') {
        startDate = endDate = fmtDateYMD(today);
    } else if (mrnPeriod === 'week') {
        var dow = today.getDay();
        var mon = new Date(today);
        mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
        var sun = new Date(mon);
        sun.setDate(mon.getDate() + 6);
        startDate = fmtDateYMD(mon);
        endDate = fmtDateYMD(sun);
    }
    return {
        perf: perfData.filter(function(d) { return d.input_date >= startDate && d.input_date <= endDate; }),
        appo: appoData.filter(function(d) { return d.acquisition_date >= startDate && d.acquisition_date <= endDate; }),
        exec: execData.filter(function(d) { return d.scheduled_date >= startDate && d.scheduled_date <= endDate; })
    };
}

// 朝礼用: 期間別目標
function calcMrnPeriodTarget(monthlyTarget, totalBizDays, ym) {
    if (mrnPeriod === 'month') return monthlyTarget;

    // 日別: dailyTargetsData から合算、なければ自動計算
    if (mrnPeriod === 'day') {
        var todayStr = fmtDateYMD(new Date());
        var daySum = sumDailyTargets(todayStr);
        if (daySum > 0) return daySum;
        return totalBizDays > 0 ? Math.round(monthlyTarget / totalBizDays) : 0;
    }

    // 週別: weeklyTargetsData から合算、なければ自動計算
    if (mrnPeriod === 'week') {
        var weekNum = getCurrentWeekNumber(ym);
        var weekSum = sumWeeklyTargets(ym, weekNum);
        if (weekSum > 0) return weekSum;
        // フォールバック: 自動計算
        var today = new Date();
        var dow = today.getDay();
        var mon = new Date(today);
        mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
        var weekBizDays = 0;
        for (var i = 0; i < 7; i++) {
            var d = new Date(mon);
            d.setDate(mon.getDate() + i);
            var ds = fmtDateYMD(d);
            if (ds.substring(0, 7) !== ym) continue;
            if (d.getDay() !== 0 && d.getDay() !== 6 && !holidaysSet.has(ds)) weekBizDays++;
        }
        var dailyTarget = totalBizDays > 0 ? monthlyTarget / totalBizDays : 0;
        return Math.round(dailyTarget * weekBizDays);
    }
    return monthlyTarget;
}

// 日別目標の全メンバー合算
function sumDailyTargets(dateStr) {
    return dailyTargetsData
        .filter(function(t) { return t.target_date === dateStr; })
        .reduce(function(s, t) { return s + (parseInt(t.appointment_amount_target) || 0); }, 0);
}

// 週別目標の全メンバー合算
function sumWeeklyTargets(ym, weekNum) {
    return weeklyTargetsData
        .filter(function(t) { return t.year_month === ym && parseInt(t.week_number) === weekNum; })
        .reduce(function(s, t) { return s + (parseInt(t.amount_target) || 0); }, 0);
}

// 今日が何週目か算出
function getCurrentWeekNumber(ym) {
    var parts = ym.split('-');
    var year = parseInt(parts[0]);
    var month = parseInt(parts[1]);
    var weeks = getWeeksOfMonth(year, month);
    var today = new Date().getDate();
    for (var i = 0; i < weeks.length; i++) {
        if (today >= weeks[i].startDay && today <= weeks[i].endDay) return weeks[i].num;
    }
    return weeks.length > 0 ? weeks[weeks.length - 1].num : 1;
}

// ==================== 朝礼: 散布図 ====================
function renderMorningScatterSection() {
    var section = document.getElementById('morningScatterSection');
    if (!section) return;

    var metricOpts = ANL_METRICS.map(function(m) {
        return '<option value="' + m.key + '">' + m.label + '</option>';
    }).join('');

    section.textContent = '';

    // タイトル + セレクト
    var titleDiv = document.createElement('div');
    titleDiv.className = 'section-title';
    titleDiv.style.marginTop = '24px';
    titleDiv.textContent = '散布図 ';

    var controlsSpan = document.createElement('span');
    controlsSpan.style.cssText = 'display:inline-flex;gap:8px;margin-left:12px;font-size:0.8rem;align-items:center;vertical-align:middle;';

    var xLabel = document.createElement('label'); xLabel.style.fontWeight = '500'; xLabel.textContent = 'X軸';
    var xSel = document.createElement('select'); xSel.id = 'mrnScatterX'; xSel.onchange = renderMorningScatter;
    xSel.innerHTML = metricOpts;

    var yLabel = document.createElement('label'); yLabel.style.fontWeight = '500'; yLabel.textContent = 'Y軸';
    var ySel = document.createElement('select'); ySel.id = 'mrnScatterY'; ySel.onchange = renderMorningScatter;
    ySel.innerHTML = '<option value="callToAppo">架→アポ率</option>' + metricOpts;

    var sLabel = document.createElement('label'); sLabel.style.fontWeight = '500'; sLabel.textContent = 'サイズ';
    var sSel = document.createElement('select'); sSel.id = 'mrnScatterSize'; sSel.onchange = renderMorningScatter;
    sSel.innerHTML = '<option value="amount">取得金額</option>' + metricOpts;

    controlsSpan.appendChild(xLabel); controlsSpan.appendChild(xSel);
    controlsSpan.appendChild(yLabel); controlsSpan.appendChild(ySel);
    controlsSpan.appendChild(sLabel); controlsSpan.appendChild(sSel);
    titleDiv.appendChild(controlsSpan);
    section.appendChild(titleDiv);

    // チャートコンテナ
    var chartWrap = document.createElement('div');
    chartWrap.className = 'mgmt-chart-container';
    chartWrap.style.height = '380px';
    var canvas = document.createElement('canvas');
    canvas.id = 'mrnScatterChart';
    chartWrap.appendChild(canvas);
    section.appendChild(chartWrap);

    renderMorningScatter();
}

// ==================== 朝礼: 日次推移グラフ ====================
const MRN_LINE_METRICS = [
    { key: 'calls', label: '架電数', field: 'call_count' },
    { key: 'appo', label: 'アポ数', field: 'appointment_count' },
    { key: 'amount', label: '取得金額', field: 'appointment_amount' },
    { key: 'pr', label: '着電数', field: 'pr_count' },
    { key: 'hours', label: '架電時間', field: 'call_hours' },
    { key: 'callToPr', label: '架電to着電率', isRate: true, numerator: 'pr_count', denominator: 'call_count' },
    { key: 'callToAppo', label: '架電toアポ率', isRate: true, numerator: 'appointment_count', denominator: 'call_count' },
    { key: 'prToAppo', label: '着電toアポ率', isRate: true, numerator: 'appointment_count', denominator: 'pr_count' },
];

function renderMorningLineSection(ym) {
    var section = document.getElementById('morningLineSection');
    if (!section) return;

    section.textContent = '';

    // タイトル行
    var titleDiv = document.createElement('div');
    titleDiv.className = 'section-title';
    titleDiv.style.marginTop = '24px';
    titleDiv.textContent = '日次推移 ';

    var controls = document.createElement('span');
    controls.style.cssText = 'display:inline-flex;gap:8px;margin-left:12px;font-size:0.8rem;align-items:center;';

    // 指標セレクト
    var mLabel = document.createElement('label'); mLabel.style.fontWeight = '500'; mLabel.textContent = '指標';
    var mSel = document.createElement('select'); mSel.id = 'mrnLineMetric';
    mSel.onchange = function() { renderMorningLineChart(ym); };
    MRN_LINE_METRICS.forEach(function(m) {
        var opt = document.createElement('option'); opt.value = m.key; opt.textContent = m.label;
        mSel.appendChild(opt);
    });

    // メンバーセレクト
    var memLabel = document.createElement('label'); memLabel.style.fontWeight = '500'; memLabel.textContent = 'メンバー';
    var memSel = document.createElement('select'); memSel.id = 'mrnLineMember';
    memSel.onchange = function() { renderMorningLineChart(ym); };
    var optAll = document.createElement('option'); optAll.value = 'all'; optAll.textContent = '全体';
    memSel.appendChild(optAll);

    var excluded = getExcludedMembers(ym);
    var activeMembers = membersData.filter(function(m) { return m.status === 'active' && !excluded.includes(m.member_name); });
    var memberTeamMap = getTeamsForMonth(ym);
    activeMembers.filter(function(m) {
        var team = memberTeamMap[m.member_name];
        return team && team !== '未所属';
    }).forEach(function(m) {
        var opt = document.createElement('option'); opt.value = m.member_name; opt.textContent = displayName(m.member_name);
        memSel.appendChild(opt);
    });

    controls.appendChild(mLabel); controls.appendChild(mSel);
    controls.appendChild(memLabel); controls.appendChild(memSel);
    titleDiv.appendChild(controls);
    section.appendChild(titleDiv);

    // チャートコンテナ
    var chartWrap = document.createElement('div');
    chartWrap.className = 'mgmt-chart-container';
    chartWrap.style.height = '300px';
    var canvas = document.createElement('canvas');
    canvas.id = 'mrnLineChart';
    chartWrap.appendChild(canvas);
    section.appendChild(chartWrap);

    renderMorningLineChart(ym);
    initCustomSelects();
}

function renderMorningLineChart(ym) {
    if (charts['mrnLine']) { charts['mrnLine'].destroy(); }
    var ctx = document.getElementById('mrnLineChart');
    if (!ctx) return;

    var metricKey = document.getElementById('mrnLineMetric')?.value || 'calls';
    var memberFilter = document.getElementById('mrnLineMember')?.value || 'all';
    var metric = MRN_LINE_METRICS.find(function(m) { return m.key === metricKey; });
    if (!metric) return;

    // 期間決定（ピッカー優先、なければ当月）
    var customRange = getMrnEffectiveRange(ym);
    var startStr, endStr;
    if (customRange) {
        startStr = customRange.start;
        endStr = customRange.end;
    } else {
        startStr = ym + '-01';
        var parts0 = ym.split('-');
        var lastDay0 = new Date(parseInt(parts0[0]), parseInt(parts0[1]), 0).getDate();
        endStr = ym + '-' + String(lastDay0).padStart(2, '0');
    }

    // 期間内の日付一覧（土日祝除外）
    var dates = [];
    var startD = new Date(parseInt(startStr.slice(0,4)), parseInt(startStr.slice(5,7)) - 1, parseInt(startStr.slice(8,10)));
    var endD = new Date(parseInt(endStr.slice(0,4)), parseInt(endStr.slice(5,7)) - 1, parseInt(endStr.slice(8,10)));
    for (var dt = new Date(startD); dt <= endD; dt.setDate(dt.getDate() + 1)) {
        if (dt.getDay() === 0 || dt.getDay() === 6) continue;
        var ds = fmtYmdLocal(dt);
        if (holidaysSet.has(ds)) continue;
        dates.push(ds);
    }

    // データ集計
    var filtered = performanceData.filter(function(r) {
        return r.input_date >= startStr && r.input_date <= endStr;
    });
    if (memberFilter !== 'all') {
        filtered = filtered.filter(function(r) { return r.member_name === memberFilter; });
    }

    var dailyMap = {};
    if (metric.isRate) {
        filtered.forEach(function(r) {
            if (!dailyMap[r.input_date]) dailyMap[r.input_date] = { num: 0, den: 0 };
            dailyMap[r.input_date].num += parseFloat(r[metric.numerator]) || 0;
            dailyMap[r.input_date].den += parseFloat(r[metric.denominator]) || 0;
        });
    } else {
        filtered.forEach(function(r) {
            if (!dailyMap[r.input_date]) dailyMap[r.input_date] = 0;
            var val = parseFloat(r[metric.field]) || 0;
            dailyMap[r.input_date] += val;
        });
    }

    var labels = dates.map(function(ds) { return parseInt(ds.split('-')[2]) + '日'; });
    var data = dates.map(function(ds) {
        if (metric.isRate) {
            var d = dailyMap[ds];
            if (!d || d.den === 0) return null;
            return Math.round(d.num / d.den * 1000) / 10;
        }
        return dailyMap[ds] || 0;
    });

    // 色
    var lineColor = '#1155cc';
    var bgColor = 'rgba(17, 85, 204, 0.1)';

    charts['mrnLine'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: metric.label + (memberFilter !== 'all' ? '（' + displayName(memberFilter) + '）' : '（全体）'),
                data: data,
                borderColor: lineColor,
                backgroundColor: bgColor,
                fill: true,
                tension: 0.3,
                pointRadius: 3,
                pointBackgroundColor: lineColor,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: '#f0f0f0' },
                    ticks: {
                        font: { size: 10 },
                        callback: function(value) { return metric.isRate ? value + '%' : value; }
                    }
                },
                x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0 } }
            },
            plugins: {
                legend: { labels: { font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: function(tipCtx) {
                            var v = tipCtx.raw;
                            if (v === null || v === undefined) return '-';
                            if (metric.isRate) return v.toFixed(1) + '%';
                            if (metricKey === 'amount') return '¥' + v.toLocaleString();
                            if (metricKey === 'hours') return v.toFixed(1) + 'h';
                            return v.toLocaleString();
                        }
                    }
                }
            }
        }
    });
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
    if (mgmtPeriod === 'month') {
        const mStart = ym + '-01';
        const mEnd = getEndOfMonth(ym);
        return {
            perf: perfData,
            appo: appoData,
            exec: execAppoData.filter(d => d.scheduled_date && d.scheduled_date >= mStart && d.scheduled_date <= mEnd)
        };
    }

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
// 期間に応じた目標金額を算出
function calcPeriodTarget(monthlyTarget, totalBizDays, ym) {
    if (mgmtPeriod === 'month') return monthlyTarget;
    if (mgmtPeriod === 'quarter') return monthlyTarget * 3;

    if (mgmtPeriod === 'day') {
        var todayStr = fmtDateYMD(new Date());
        var daySum = sumDailyTargets(todayStr);
        if (daySum > 0) return daySum;
        return totalBizDays > 0 ? Math.round(monthlyTarget / totalBizDays) : 0;
    }
    if (mgmtPeriod === 'week') {
        var weekNum = getCurrentWeekNumber(ym);
        var weekSum = sumWeeklyTargets(ym, weekNum);
        if (weekSum > 0) return weekSum;
        // フォールバック
        var today = new Date();
        var dow = today.getDay();
        var mon = new Date(today);
        mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
        var weekBizDays = 0;
        for (var i = 0; i < 7; i++) {
            var d = new Date(mon);
            d.setDate(mon.getDate() + i);
            var ds = fmtDateYMD(d);
            var dym = ds.substring(0, 7);
            if (dym !== ym) continue;
            if (d.getDay() !== 0 && d.getDay() !== 6 && !holidaysSet.has(ds)) weekBizDays++;
        }
        var dailyTarget = totalBizDays > 0 ? monthlyTarget / totalBizDays : 0;
        return Math.round(dailyTarget * weekBizDays);
    }
    return monthlyTarget;
}

function destroyMgmtCharts() {
    Object.keys(mgmtCharts).forEach(k => { if (mgmtCharts[k]) { mgmtCharts[k].destroy(); delete mgmtCharts[k]; } });
}

// 2025-07以降の全アポを軽量取得（案件別ステータス集計 / 月別推移用）
// 取得日 OR 実施予定日のいずれかが 2025-07 以降のものを対象
async function loadHistoricalAppointments() {
    try {
        const [appoData, allTargets] = await Promise.all([
            queryTurso(
                "SELECT acquisition_date, scheduled_date, member_name, project_name, customer_name, status, amount FROM appointments WHERE acquisition_date >= '2025-07-01' OR scheduled_date >= '2025-07-01' ORDER BY acquisition_date",
                []
            ),
            queryTurso(
                "SELECT year_month, appointment_amount_target FROM targets WHERE target_type='total' AND target_name='all' ORDER BY year_month",
                []
            ).catch(() => []),
        ]);
        normalizeDataMemberNames(appoData);
        // dedup は適用しない（acquisition_date+customer_name 単独で同一視されると、
        // 同顧客で実施予定日が複数のアポが合算されてしまうため）。
        // 月別集計用には素のレコードを保持し、各レンダー側で精緻な key で重複排除する。
        historicalAppoData = stripDeletedAppos(stripExcludedAppos(appoData));
        monthlyTotalTargets = {};
        (allTargets || []).forEach(t => { monthlyTotalTargets[t.year_month] = parseFloat(t.appointment_amount_target) || 0; });
        if (document.getElementById('mgmtHistoricalStatus')) {
            renderHistoricalProjectStatus();
        }
        if (document.getElementById('mgmtMonthlyTrend')) {
            renderMonthlyTrendTable();
        }
        // 全案件 取得実績バナーも historicalAppoData に依存するため、経営タブを再描画
        if (currentTab === 'management') {
            const ym = document.getElementById('filterMonth').value;
            renderManagement({ team: 'all', member: 'all', month: ym });
        }
    } catch (e) {
        console.error('履歴アポ読み込み失敗:', e);
    }
}

// 2025-07以降の案件別ステータス集計を描画（経営タブ最下部）
function renderHistoricalProjectStatus() {
    const container = document.getElementById('mgmtHistoricalStatus');
    if (!container) return;
    if (!historicalAppoData || historicalAppoData.length === 0) {
        // textContent for plain text — 安全
        container.textContent = '読み込み中...';
        return;
    }
    const STATUSES = ['未確認', '実施', 'リスケ', 'キャンセル'];
    const grouped = {};
    historicalAppoData.forEach(a => {
        const proj = a.project_name || '(未指定)';
        if (!grouped[proj]) grouped[proj] = { 未確認: 0, 実施: 0, リスケ: 0, キャンセル: 0, total: 0, amount: 0 };
        const st = STATUSES.includes(a.status) ? a.status : '未確認';
        grouped[proj][st] += 1;
        grouped[proj].total += 1;
        grouped[proj].amount += parseFloat(a.amount) || 0;
    });
    const rows = Object.entries(grouped).sort((a, b) => b[1].total - a[1].total);
    const totals = { 未確認: 0, 実施: 0, リスケ: 0, キャンセル: 0, total: 0, amount: 0 };
    rows.forEach(([, v]) => { STATUSES.forEach(s => totals[s] += v[s]); totals.total += v.total; totals.amount += v.amount; });

    // DOM 構築（escapeHtml は他箇所と同様、案件名のサニタイズに使用）
    const parts = [];
    parts.push('<div style="display:flex;justify-content:space-between;align-items:baseline;margin:28px 0 8px;">');
    parts.push('<div class="section-title" style="margin:0;border:none;padding:0;">案件別ステータス集計 <span style="font-size:0.75rem;color:var(--text-light);font-weight:normal;margin-left:8px;">2025-07 〜 現在 / 取得日ベース</span></div>');
    parts.push('<div style="font-size:0.8rem;color:var(--text-light);">全' + totals.total.toLocaleString() + '件</div>');
    parts.push('</div>');
    parts.push('<div style="overflow-x:auto;"><table class="data-table"><thead><tr>');
    parts.push('<th>案件名</th><th class="text-right">合計</th>');
    parts.push('<th class="text-right" style="background:#f0f4ff;">実施</th>');
    parts.push('<th class="text-right" style="background:#fff8e6;">未確認</th>');
    parts.push('<th class="text-right" style="background:#fffbe6;">リスケ</th>');
    parts.push('<th class="text-right" style="background:#fdf2f0;color:#c0392b;">キャンセル</th>');
    parts.push('<th class="text-right">実施率</th><th class="text-right">キャンセル率</th><th class="text-right">取得金額合計</th>');
    parts.push('</tr></thead><tbody>');
    rows.forEach(([name, v]) => {
        const execRate = v.total > 0 ? (v['実施'] / v.total * 100).toFixed(1) + '%' : '-';
        const cancelRate = v.total > 0 ? (v['キャンセル'] / v.total * 100).toFixed(1) + '%' : '-';
        const cancelColor = v['キャンセル'] > 0 && v.total > 0 && (v['キャンセル']/v.total) >= 0.15 ? '#c0392b' : 'inherit';
        parts.push('<tr>');
        parts.push('<td style="font-weight:600;">' + escapeHtml(name) + '</td>');
        parts.push('<td class="text-right">' + v.total.toLocaleString() + '</td>');
        parts.push('<td class="text-right" style="background:#f8faff;">' + v['実施'].toLocaleString() + '</td>');
        parts.push('<td class="text-right" style="background:#fffdf5;">' + v['未確認'].toLocaleString() + '</td>');
        parts.push('<td class="text-right" style="background:#fffdf5;">' + v['リスケ'].toLocaleString() + '</td>');
        parts.push('<td class="text-right" style="background:#fdf8f7;color:#c0392b;">' + v['キャンセル'].toLocaleString() + '</td>');
        parts.push('<td class="text-right">' + execRate + '</td>');
        parts.push('<td class="text-right" style="color:' + cancelColor + ';">' + cancelRate + '</td>');
        parts.push('<td class="text-right">¥' + Math.round(v.amount).toLocaleString() + '</td>');
        parts.push('</tr>');
    });
    const tExecRate = totals.total > 0 ? (totals['実施'] / totals.total * 100).toFixed(1) + '%' : '-';
    const tCancelRate = totals.total > 0 ? (totals['キャンセル'] / totals.total * 100).toFixed(1) + '%' : '-';
    parts.push('</tbody><tfoot><tr style="font-weight:600;">');
    parts.push('<td>合計</td>');
    parts.push('<td class="text-right">' + totals.total.toLocaleString() + '</td>');
    parts.push('<td class="text-right" style="background:#f0f4ff;">' + totals['実施'].toLocaleString() + '</td>');
    parts.push('<td class="text-right" style="background:#fff8e6;">' + totals['未確認'].toLocaleString() + '</td>');
    parts.push('<td class="text-right" style="background:#fffbe6;">' + totals['リスケ'].toLocaleString() + '</td>');
    parts.push('<td class="text-right" style="background:#fdf2f0;color:#c0392b;">' + totals['キャンセル'].toLocaleString() + '</td>');
    parts.push('<td class="text-right">' + tExecRate + '</td>');
    parts.push('<td class="text-right">' + tCancelRate + '</td>');
    parts.push('<td class="text-right">¥' + Math.round(totals.amount).toLocaleString() + '</td>');
    parts.push('</tr></tfoot></table></div>');
    container.innerHTML = parts.join('');
}

// 月別 全案件 取得目標 vs 実績 推移テーブルを描画
// 集計ロジック: 「取得日 OR 実施予定日が当該月」のアポを active案件 + 除外メンバー除外で UNION → amount合計
function renderMonthlyTrendTable() {
    const container = document.getElementById('mgmtMonthlyTrend');
    if (!container) return;
    if (!historicalAppoData) {
        container.textContent = '読み込み中...';
        return;
    }
    // 月リスト: 2026-01 〜 当月
    const today = new Date();
    const months = [];
    let y = 2026, m = 1;
    while (y < today.getFullYear() || (y === today.getFullYear() && m <= today.getMonth() + 1)) {
        months.push(y + '-' + String(m).padStart(2, '0'));
        m++;
        if (m > 12) { m = 1; y++; }
    }
    months.reverse(); // 直近を上に
    const activeProjectNames = new Set(projectsData.filter(p => p.status === 'active').map(p => p.project_name));
    const settingsDefault = parseInt(settingsMap.monthly_target_total || '16000000');

    const rows = months.map(ym => {
        const excluded = getExcludedMembers(ym);
        // UNION dedup
        const seen = new Set();
        let actual = 0;
        historicalAppoData.forEach(a => {
            if (excluded.includes(a.member_name)) return;
            if (!activeProjectNames.has(a.project_name)) return;
            const acqIn = a.acquisition_date && a.acquisition_date.startsWith(ym);
            const schIn = a.scheduled_date && a.scheduled_date.startsWith(ym);
            if (!acqIn && !schIn) return;
            const key = a.id != null
                ? 'id_' + a.id
                : `${a.member_name}|${a.project_name}|${a.acquisition_date || ''}|${a.scheduled_date || ''}|${a.customer_name || ''}|${a.amount || ''}`;
            if (seen.has(key)) return;
            seen.add(key);
            actual += parseFloat(a.amount) || 0;
        });
        const target = monthlyTotalTargets[ym] || settingsDefault;
        const rate = target > 0 ? (actual / target * 100) : 0;
        return { ym, target, actual, rate };
    });

    const parts = [];
    parts.push('<div style="margin:28px 0 8px;">');
    parts.push('<div class="section-title" style="margin:0;border:none;padding:0;">月別 達成率推移 <span style="font-size:0.75rem;color:var(--text-light);font-weight:normal;margin-left:8px;">2026-01 〜 当月 / 全案件 取得目標 vs amount合計実績（取得日 OR 実施予定日が当該月）</span></div>');
    parts.push('</div>');
    parts.push('<div style="overflow-x:auto;"><table class="data-table"><thead><tr>');
    parts.push('<th>月</th>');
    parts.push('<th class="text-right">目標</th>');
    parts.push('<th class="text-right">実績</th>');
    parts.push('<th class="text-right">達成率</th>');
    parts.push('<th style="min-width:200px;">進捗バー</th>');
    parts.push('</tr></thead><tbody>');
    rows.forEach(r => {
        const rateStr = r.rate.toFixed(1) + '%';
        const barWidth = Math.min(r.rate, 100);
        const color = r.rate >= 100 ? '#86aaec' : r.rate >= 80 ? '#ede07d' : r.rate >= 50 ? '#f0b8a0' : '#ef947a';
        parts.push('<tr>');
        parts.push('<td style="font-weight:600;">' + r.ym + '</td>');
        parts.push('<td class="text-right">¥' + r.target.toLocaleString() + '</td>');
        parts.push('<td class="text-right" style="font-weight:600;">¥' + Math.round(r.actual).toLocaleString() + '</td>');
        parts.push('<td class="text-right" style="color:' + color + ';font-weight:600;">' + rateStr + '</td>');
        parts.push('<td><div style="height:10px;background:#eef0f4;border-radius:4px;overflow:hidden;"><div style="height:100%;width:' + barWidth + '%;background:' + color + ';border-radius:4px;"></div></div></td>');
        parts.push('</tr>');
    });
    parts.push('</tbody></table></div>');
    container.innerHTML = parts.join('');
}

// 案件別詳細テーブル: メンバー別内訳サブ行のトグル表示
function toggleProjMemberBreakdown(projIdx) {
    const rows = document.querySelectorAll(`.proj-member-row[data-proj-idx="${projIdx}"]`);
    if (rows.length === 0) return;
    const expand = rows[0].style.display === 'none';
    rows.forEach(r => { r.style.display = expand ? '' : 'none'; });
    const btn = document.querySelector(`.proj-toggle[data-proj-idx="${projIdx}"]`);
    if (btn) btn.textContent = expand ? '▼' : '▶';
}

// ゲージチャート描画（半円doughnut + 標準進捗マーカー）
// breakdown: [{name, value}] を渡すと色付き弧をホバーした時にメンバー別内訳をツールチップ表示
function createGaugeChart(canvasId, value, max, standardPct, label, subLabel, breakdown) {
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

    var chartInstance = new Chart(ctx, {
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
                tooltip: (breakdown && breakdown.length > 0) ? {
                    enabled: true,
                    displayColors: false,
                    backgroundColor: '#1a1a1a',
                    titleColor: '#ffffff',
                    bodyColor: '#ffffff',
                    titleFont: { size: 11, family: '"Noto Sans JP"', weight: '700' },
                    bodyFont: { size: 11, family: '"Noto Sans JP"' },
                    padding: 10,
                    yAlign: 'bottom',
                    caretSize: 6,
                    callbacks: {
                        title: () => `${label} 内訳（合計 ¥${value.toLocaleString()}）`,
                        label: () => '',
                        afterBody: () => {
                            const sorted = [...breakdown].filter(b => b.value > 0).sort((a, b) => b.value - a.value);
                            if (sorted.length === 0) return ['（取得実績なし）'];
                            return sorted.map(b => `${b.name}: ¥${Math.round(b.value).toLocaleString()}`);
                        }
                    },
                    filter: (item) => item.dataIndex === 0,
                } : { enabled: false },
                legend: { display: false },
            },
            layout: { padding: { top: 0, bottom: 0 } },
        },
        plugins: [needlePlugin, {
            id: 'gaugeCenter_' + canvasId,
            // afterDatasetsDraw はツールチップより前に走るため、ホバー時にテキストが上にかぶらない
            afterDatasetsDraw(chart) {
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
    mgmtCharts[canvasId] = chartInstance;
    return chartInstance;
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
    const monthlyTarget = totalTarget ? totalTarget.appointment_amount_target : parseInt(settingsMap.monthly_target_total || '16000000');
    const executionTarget = totalTarget ? (totalTarget.execution_target || monthlyTarget) : monthlyTarget;
    // キャンセル率デフォルト 15%（着地ヨミ計算用）
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

    // 当月取得ゲージは 人別詳細テーブル と同じ条件(activeメンバー + active案件)で集計
    const PERSON_DETAIL_MEMBERS_SET = new Set(membersData.filter(m => m.status === 'active' && !excluded.includes(m.member_name)).map(m => m.member_name));
    const activeProjectNamesForGauge = new Set(projectsData.filter(p => p.status === 'active').map(p => p.project_name));
    const gaugeAcqAmount = allAppo
        .filter(a => PERSON_DETAIL_MEMBERS_SET.has(a.member_name) && activeProjectNamesForGauge.has(a.project_name))
        .reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);

    const { elapsed, total: totalDays } = getBusinessDays(ym);
    const standardProgress = totalDays > 0 ? Math.round(elapsed / totalDays * 1000) / 10 : 0;

    // 期間に応じた目標金額を算出
    const periodTarget = calcPeriodTarget(monthlyTarget, totalDays, ym);
    const periodExecTarget = calcPeriodTarget(executionTarget, totalDays, ym);

    const acqRate = periodTarget > 0 ? Math.round(gaugeAcqAmount / periodTarget * 1000) / 10 : 0;
    const execRate = periodExecTarget > 0 ? Math.round(execConfirmed / periodExecTarget * 1000) / 10 : 0;

    // 着地ヨミ = 実施確定 + 未確認 × (1 - キャンセル率)
    const execForecast = execConfirmed + Math.round(execUnconfirmed * (1 - RESKED_CANCEL_RATE));
    const forecastDiff = execForecast - periodExecTarget;
    const forecastColor = forecastDiff >= 0 ? '#86aaec' : '#ef947a';

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
    // 列定義（ユーザー指定）:
    //  当月取得件数 = appointments で acquisition_date が当月の行（=allAppo）
    //  当月実施アポ件数合計 = appointments で scheduled_date が当月の行（=allExecAppo / 売上報告RawData由来）
    //  取得金額 = アポ単価 × 当月取得件数
    //  却下,キャンセル数 = 当月実施 のうち status=キャンセル（売上報告RawData）
    //  却下,キャンセル率 = 却下,キャンセル数 ÷ 当月実施アポ件数合計 × 100
    const capData = projectsData.filter(p => p.status === 'active').map(proj => {
        const projPerf = allPerf.filter(d => d.project_name === proj.project_name);
        const projAppo = allAppo.filter(d => d.project_name === proj.project_name);
        const projExec = allExecAppo.filter(d => d.project_name === proj.project_name);
        const callCount = sum(projPerf, 'call_count');
        const prCount = sum(projPerf, 'pr_count');
        const appoCountPerf = sum(projPerf, 'appointment_count');
        const callHours = sum(projPerf, 'call_hours');
        const unitPrice = proj.unit_price || 0;
        const acquiredCount = projAppo.length;
        const execCount = projExec.length;
        const acqAmount = unitPrice * acquiredCount;
        const cancelCount = projExec.filter(a => a.status === 'キャンセル').length;
        const cancelRate = execCount > 0 ? Math.round(cancelCount / execCount * 100) : 0;
        const callToAppo = callCount > 0 ? (appoCountPerf / callCount * 100).toFixed(1) : '-';
        const prRate = callCount > 0 ? (prCount / callCount * 100).toFixed(1) : '-';
        const prToAppo = prCount > 0 ? (appoCountPerf / prCount * 100).toFixed(1) : '-';
        const callsPerHour = callHours > 0 ? (callCount / callHours).toFixed(1) : '-';
        return { name: proj.project_name, unitPrice, acquiredCount, execCount, acqAmount, cancelCount, cancelRate, callCount, prCount, appoCountPerf, callHours, callToAppo, prRate, prToAppo, callsPerHour };
    }).filter(c => c.acquiredCount > 0 || c.execCount > 0 || c.callCount > 0);

    // 案件テーブルHTML
    let projTableHtml = `<div style="overflow-x:auto;"><table class="data-table"><thead><tr>
        <th>案件</th>
        <th class="text-right">アポ単価</th>
        <th class="text-right">当月取得件数</th>
        <th class="text-right">当月実施アポ件数合計</th>
        <th class="text-right">取得金額</th>
        <th class="text-right" style="background:#fdf2f0;color:#c0392b;">却下,キャンセル数</th>
        <th class="text-right" style="background:#fdf2f0;color:#c0392b;">却下,キャンセル率</th>
        <th class="text-right">架電数</th>
        <th class="text-right">着電数</th>
        <th class="text-right">アポ数</th>
        <th class="text-right">稼働時間</th>
        <th class="text-right">架電Toアポ率</th>
        <th class="text-right">着電率</th>
        <th class="text-right">着電Toアポ率</th>
        <th class="text-right">1時間あたり架電数</th>
    </tr></thead><tbody>`;
    let ttAcq = 0, ttExec = 0, ttAmt = 0, ttCancel = 0, ttCalls = 0, ttPr = 0, ttAppoP = 0, ttHours = 0;
    capData.forEach((c, projIdx) => {
        ttAcq += c.acquiredCount;
        ttExec += c.execCount;
        ttAmt += c.acqAmount;
        ttCancel += c.cancelCount;
        ttCalls += c.callCount;
        ttPr += c.prCount;
        ttAppoP += c.appoCountPerf;
        ttHours += c.callHours;
        projTableHtml += `<tr class="proj-row" data-proj-idx="${projIdx}">
            <td style="font-weight:600;">${escapeHtml(c.name)}</td>
            <td class="text-right">¥${c.unitPrice.toLocaleString()}</td>
            <td class="text-right">${c.acquiredCount}件</td>
            <td class="text-right">${c.execCount}件</td>
            <td class="text-right">¥${c.acqAmount.toLocaleString()}</td>
            <td class="text-right" style="background:#fdf8f7;color:#c0392b;">${c.cancelCount}件</td>
            <td class="text-right" style="background:#fdf8f7;color:#c0392b;">${c.cancelCount > 0 ? c.cancelRate + '%' : '-'}</td>
            <td class="text-right">${c.callCount.toLocaleString()}</td>
            <td class="text-right">${c.prCount.toLocaleString()}</td>
            <td class="text-right">${c.appoCountPerf.toLocaleString()}</td>
            <td class="text-right">${c.callHours.toFixed(1)}h</td>
            <td class="text-right">${c.callToAppo === '-' ? '-' : c.callToAppo + '%'}</td>
            <td class="text-right">${c.prRate === '-' ? '-' : c.prRate + '%'}</td>
            <td class="text-right">${c.prToAppo === '-' ? '-' : c.prToAppo + '%'}</td>
            <td class="text-right">${c.callsPerHour}</td>
        </tr>`;
    });
    const ttCallToAppo = ttCalls > 0 ? (ttAppoP / ttCalls * 100).toFixed(1) + '%' : '-';
    const ttPrRate = ttCalls > 0 ? (ttPr / ttCalls * 100).toFixed(1) + '%' : '-';
    const ttPrToAppo = ttPr > 0 ? (ttAppoP / ttPr * 100).toFixed(1) + '%' : '-';
    const ttCallsPerHour = ttHours > 0 ? (ttCalls / ttHours).toFixed(1) : '-';
    const ttCancelRate = ttExec > 0 ? Math.round(ttCancel / ttExec * 100) + '%' : '-';
    projTableHtml += `</tbody><tfoot><tr style="font-weight:600;">
        <td>合計</td>
        <td></td>
        <td class="text-right">${ttAcq}件</td>
        <td class="text-right">${ttExec}件</td>
        <td class="text-right">¥${ttAmt.toLocaleString()}</td>
        <td class="text-right" style="background:#fdf8f7;color:#c0392b;">${ttCancel}件</td>
        <td class="text-right" style="background:#fdf8f7;color:#c0392b;">${ttCancelRate}</td>
        <td class="text-right">${ttCalls.toLocaleString()}</td>
        <td class="text-right">${ttPr.toLocaleString()}</td>
        <td class="text-right">${ttAppoP.toLocaleString()}</td>
        <td class="text-right">${ttHours.toFixed(1)}h</td>
        <td class="text-right">${ttCallToAppo}</td>
        <td class="text-right">${ttPrRate}</td>
        <td class="text-right">${ttPrToAppo}</td>
        <td class="text-right">${ttCallsPerHour}</td>
    </tr></tfoot></table></div>`;

    // ========== 人別 詳細データ準備（案件別と同じ列構成、アポ単価のみ除外） ==========
    // 表示メンバー: 設定タブでactiveにしたメンバーのみ
    const PERSON_DETAIL_MEMBERS = activeMembers.map(m => m.member_name);
    const activeProjectNamesPerMember = new Set(projectsData.filter(p => p.status === 'active').map(p => p.project_name));

    const memberDetailData = PERSON_DETAIL_MEMBERS.map(memberName => {
        const mAppo = allAppo.filter(d => d.member_name === memberName && activeProjectNamesPerMember.has(d.project_name));
        const mExec = allExecAppo.filter(d => d.member_name === memberName && activeProjectNamesPerMember.has(d.project_name));
        const mPerf = allPerf.filter(d => d.member_name === memberName && activeProjectNamesPerMember.has(d.project_name));
        const acquiredCount = mAppo.length;
        const execCount = mExec.length;
        const acqAmount = mAppo.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
        const cancelCount = mExec.filter(a => a.status === 'キャンセル').length;
        const cancelRate = execCount > 0 ? Math.round(cancelCount / execCount * 100) : 0;
        const callCount = sum(mPerf, 'call_count');
        const prCount = sum(mPerf, 'pr_count');
        const appoCountPerf = sum(mPerf, 'appointment_count');
        const callHours = sum(mPerf, 'call_hours');
        const callToAppo = callCount > 0 ? (appoCountPerf / callCount * 100).toFixed(1) : '-';
        const prRate = callCount > 0 ? (prCount / callCount * 100).toFixed(1) : '-';
        const prToAppo = prCount > 0 ? (appoCountPerf / prCount * 100).toFixed(1) : '-';
        const callsPerHour = callHours > 0 ? (callCount / callHours).toFixed(1) : '-';
        return { name: memberName, acquiredCount, execCount, acqAmount, cancelCount, cancelRate, callCount, prCount, appoCountPerf, callHours, callToAppo, prRate, prToAppo, callsPerHour };
    }).sort((a, b) => b.acqAmount - a.acqAmount);

    let memberTableHtml = `<div style="overflow-x:auto;"><table class="data-table"><thead><tr>
        <th style="min-width:90px;white-space:nowrap;">人</th>
        <th class="text-right">当月取得件数</th>
        <th class="text-right">当月実施アポ件数合計</th>
        <th class="text-right">取得金額</th>
        <th class="text-right" style="background:#fdf2f0;color:#c0392b;">却下,キャンセル数</th>
        <th class="text-right" style="background:#fdf2f0;color:#c0392b;">却下,キャンセル率</th>
        <th class="text-right">架電数</th>
        <th class="text-right">着電数</th>
        <th class="text-right">アポ数</th>
        <th class="text-right">稼働時間</th>
        <th class="text-right">架電Toアポ率</th>
        <th class="text-right">着電率</th>
        <th class="text-right">着電Toアポ率</th>
        <th class="text-right">1時間あたり架電数</th>
    </tr></thead><tbody>`;
    let mtAcq = 0, mtExec = 0, mtAmt = 0, mtCancel = 0, mtCalls = 0, mtPr = 0, mtAppoP = 0, mtHours = 0;
    memberDetailData.forEach(m => {
        mtAcq += m.acquiredCount;
        mtExec += m.execCount;
        mtAmt += m.acqAmount;
        mtCancel += m.cancelCount;
        mtCalls += m.callCount;
        mtPr += m.prCount;
        mtAppoP += m.appoCountPerf;
        mtHours += m.callHours;
        memberTableHtml += `<tr>
            <td style="font-weight:600;min-width:90px;white-space:nowrap;">${escapeHtml(m.name)}</td>
            <td class="text-right">${m.acquiredCount}件</td>
            <td class="text-right">${m.execCount}件</td>
            <td class="text-right">¥${m.acqAmount.toLocaleString()}</td>
            <td class="text-right" style="background:#fdf8f7;color:#c0392b;">${m.cancelCount}件</td>
            <td class="text-right" style="background:#fdf8f7;color:#c0392b;">${m.cancelCount > 0 ? m.cancelRate + '%' : '-'}</td>
            <td class="text-right">${m.callCount.toLocaleString()}</td>
            <td class="text-right">${m.prCount.toLocaleString()}</td>
            <td class="text-right">${m.appoCountPerf.toLocaleString()}</td>
            <td class="text-right">${m.callHours.toFixed(1)}h</td>
            <td class="text-right">${m.callToAppo === '-' ? '-' : m.callToAppo + '%'}</td>
            <td class="text-right">${m.prRate === '-' ? '-' : m.prRate + '%'}</td>
            <td class="text-right">${m.prToAppo === '-' ? '-' : m.prToAppo + '%'}</td>
            <td class="text-right">${m.callsPerHour}</td>
        </tr>`;
    });
    const mtCallToAppo = mtCalls > 0 ? (mtAppoP / mtCalls * 100).toFixed(1) + '%' : '-';
    const mtPrRate = mtCalls > 0 ? (mtPr / mtCalls * 100).toFixed(1) + '%' : '-';
    const mtPrToAppo = mtPr > 0 ? (mtAppoP / mtPr * 100).toFixed(1) + '%' : '-';
    const mtCallsPerHour = mtHours > 0 ? (mtCalls / mtHours).toFixed(1) : '-';
    const mtCancelRate = mtExec > 0 ? Math.round(mtCancel / mtExec * 100) + '%' : '-';
    memberTableHtml += `</tbody><tfoot><tr style="font-weight:600;">
        <td style="min-width:90px;white-space:nowrap;">合計</td>
        <td class="text-right">${mtAcq}件</td>
        <td class="text-right">${mtExec}件</td>
        <td class="text-right">¥${mtAmt.toLocaleString()}</td>
        <td class="text-right" style="background:#fdf8f7;color:#c0392b;">${mtCancel}件</td>
        <td class="text-right" style="background:#fdf8f7;color:#c0392b;">${mtCancelRate}</td>
        <td class="text-right">${mtCalls.toLocaleString()}</td>
        <td class="text-right">${mtPr.toLocaleString()}</td>
        <td class="text-right">${mtAppoP.toLocaleString()}</td>
        <td class="text-right">${mtHours.toFixed(1)}h</td>
        <td class="text-right">${mtCallToAppo}</td>
        <td class="text-right">${mtPrRate}</td>
        <td class="text-right">${mtPrToAppo}</td>
        <td class="text-right">${mtCallsPerHour}</td>
    </tr></tfoot></table></div>`;

    // 取消率チャート高さ
    const cancelChartHeight = Math.max(200, capData.filter(c => c.cancelCount > 0).length * 36 + 40);

    // 期間ラベル
    const periodLabels = { day: '日別', week: '週別', month: '月別', quarter: 'Q別', custom: 'カスタム' };

    // ========== 当月着地（アポ確認タブの全件合計と一致） ==========
    // アポ確認タブ renderAppointments() と同一の母集合: executionAppoData (scheduled_date 当月)
    //   + active案件 + 除外メンバー除外。 status は 実施/リスケ/キャンセル/未確認 の4種合算。
    const activeProjectNamesForCard = new Set(projectsData.filter(p => p.status === 'active').map(p => p.project_name));
    const ymStartCard = ym + '-01';
    const ymEndCard = getEndOfMonth(ym);
    const totalAcqActualCard = (executionAppoData || [])
        .filter(a => !excluded.includes(a.member_name))
        .filter(a => activeProjectNamesForCard.has(a.project_name))
        .filter(a => a.scheduled_date && a.scheduled_date >= ymStartCard && a.scheduled_date <= ymEndCard)
        .reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    // 当月着地 専用目標 (取得目標とは別管理)
    const landingTarget = totalTarget && totalTarget.landing_amount_target
        ? parseInt(totalTarget.landing_amount_target) || 0
        : monthlyTarget;
    const totalAcqTargetCard = landingTarget;
    const achieveRateCard = totalAcqTargetCard > 0 ? (totalAcqActualCard / totalAcqTargetCard * 100).toFixed(1) : '0';
    const barWidthCard = Math.min(parseFloat(achieveRateCard), 100);
    const barColorCard = parseFloat(achieveRateCard) >= standardProgress ? '#86aaec' : parseFloat(achieveRateCard) >= standardProgress * 0.8 ? '#ede07d' : '#ef947a';

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

    <!-- トップ4カード: ゲージ×2 + 全案件取得 + ヨミ -->
    <div class="mgmt-top-cards">
        <div class="mgmt-gauge-card">
            <div class="mgmt-gauge-title">当月取得<span style="font-size:0.7rem;color:var(--text-light);margin-left:6px;">取得日基準</span></div>
            <div class="mgmt-gauge-wrap"><canvas id="mgmtGaugeAcq"></canvas></div>
            <div class="mgmt-gauge-footer">目標 ¥${periodTarget.toLocaleString()}</div>
        </div>
        <div class="mgmt-gauge-card">
            <div class="mgmt-gauge-title">実施確定金額</div>
            <div class="mgmt-gauge-wrap"><canvas id="mgmtGaugeExec"></canvas></div>
            <div class="mgmt-gauge-footer">目標 ¥${periodExecTarget.toLocaleString()}</div>
            <div class="mgmt-progress-wrap">
                <div class="mgmt-progress-bar">
                    <div class="mgmt-progress-fill" style="width:${Math.min(execRate, 100)}%;background:${execRate < 50 ? 'var(--red-400)' : execRate < 80 ? 'var(--yellow-300)' : 'var(--blue-200)'}"></div>
                </div>
                <div class="mgmt-progress-label">実行達成率 ${execRate}%</div>
            </div>
        </div>
        <div class="mgmt-acq-summary-card">
            <div class="mgmt-gauge-title">当月着地<span style="font-size:0.7rem;color:var(--text-light);margin-left:6px;">実施予定基準（アポ確認と一致）</span></div>
            <div style="margin-top:14px;">
                <div class="mgmt-acq-row"><span>取得目標</span><span class="mgmt-acq-value">¥${totalAcqTargetCard.toLocaleString()}</span></div>
                <div class="mgmt-acq-row"><span>着地予定</span><span class="mgmt-acq-value" style="color:${barColorCard};">¥${totalAcqActualCard.toLocaleString()}</span></div>
                <div class="mgmt-acq-bar"><div class="mgmt-acq-bar-fill" style="width:${barWidthCard}%;background:${barColorCard};"></div></div>
                <div style="font-size:0.72rem;color:var(--text-light);margin-top:6px;">達成率 ${achieveRateCard}%</div>
                <div style="font-size:0.66rem;color:var(--text-light);margin-top:4px;line-height:1.3;">※実施予定日 が当月 / active案件 / 4status(実施・リスケ・キャンセル・未確認)合計</div>
            </div>
        </div>
        <div class="mgmt-gauge-card mgmt-yomi-card">
            <div class="mgmt-gauge-title">着地ヨミ<span style="font-size:0.7rem;color:var(--text-light);margin-left:6px;">85%換算</span></div>
            <div class="mgmt-yomi-value" style="color:${forecastColor};">¥${execForecast.toLocaleString()}</div>
            <div class="mgmt-yomi-sub">確定 ¥${execConfirmed.toLocaleString()} ＋ 未確認 ¥${execUnconfirmed.toLocaleString()} × 85%</div>
            <div class="mgmt-yomi-diff" style="color:${forecastColor};">目標比 ${forecastDiff >= 0 ? '+' : ''}¥${forecastDiff.toLocaleString()}</div>
        </div>
    </div>

    <!-- 全体KPI（当月 vs 前月） -->
    ${(() => {
        const prevYM = getPrevYM(ym);
        const curr = computeMonthKpis(ym);
        const prev = computeMonthKpis(prevYM);
        const intFmt = v => Math.round(v).toLocaleString();
        const pctFmt = v => v.toFixed(1);
        const yenFmt = v => '¥' + Math.round(v).toLocaleString();
        // 前月比は「当月の経過営業日数」と同じ営業日数で前月を切り詰めて比較
        const prevCutoffDate = elapsed > 0 ? getNthBusinessDay(prevYM, elapsed) : null;
        const currCutoffDate = elapsed > 0 ? getNthBusinessDay(ym, elapsed) : null;
        const cmpNote = prevCutoffDate && currCutoffDate
            ? `※ 前月比は当月（${ym}-01 〜 ${currCutoffDate}, ${elapsed}営業日）と前月の同営業日数（${prevYM}-01 〜 ${prevCutoffDate}）を比較`
            : `※ 前月（${prevYM}）の同じ営業日数で比較`;
        const card = (label, currVal, prevVal, fmt, opts = {}) => `
            <div class="mgmt-kpi-item">
                <div class="mgmt-kpi-label">${label}</div>
                <div class="mgmt-kpi-val">${fmt(currVal)}${opts.suffix || ''}</div>
                <div class="mgmt-kpi-prev">前月 ${fmt(prevVal)}${opts.suffix || ''} ${kpiDiffBadge(currVal, prevVal, { invert: opts.invert, fmt, suffix: opts.suffix })}</div>
            </div>`;
        return `
        <div style="font-size:0.75rem;color:var(--text-light);margin:18px 0 6px;padding:0 2px;">${escapeHtml(cmpNote)}</div>
        <div class="mgmt-kpi-numbers">
            ${card('架電数', curr.calls, prev.calls, intFmt)}
            ${card('着電数', curr.pr, prev.pr, intFmt)}
            ${card('アポ数', curr.appoCnt, prev.appoCnt, intFmt)}
            ${card('架電toアポ率', curr.callToAppo, prev.callToAppo, pctFmt, { suffix: '%' })}
            ${card('着電toアポ率', curr.prToAppo, prev.prToAppo, pctFmt, { suffix: '%' })}
            ${card('架電to着電率', curr.callToPr, prev.callToPr, pctFmt, { suffix: '%' })}
            ${card('平均単価', curr.avgUnit, prev.avgUnit, yenFmt)}
            ${card('月内実施率', curr.withinMonthRate, prev.withinMonthRate, pctFmt, { suffix: '%' })}
            ${card('キャンセル率', curr.cancelRate, prev.cancelRate, pctFmt, { suffix: '%', invert: true })}
            ${card('実施確定率', curr.confirmRate, prev.confirmRate, pctFmt, { suffix: '%' })}
            ${card('1hあたり架電数', curr.callsPerHour, prev.callsPerHour, pctFmt)}
            ${card('1日あたり架電数', curr.callsPerDay, prev.callsPerDay, intFmt)}
            ${card('1日あたり稼働時間', curr.hoursPerDay, prev.hoursPerDay, pctFmt, { suffix: 'h' })}
        </div>`;
    })()}

    <!-- 個人別 取得金額（縦棒グラフ） -->
    <div class="section-title" style="margin-top:28px;">個人別 取得金額 目標 vs 実績（既存/新規）</div>
    <div class="mgmt-chart-container"><canvas id="mgmtBarAmount"></canvas></div>

    <!-- 案件別 詳細テーブル -->
    <div class="section-title" style="margin-top:28px;">案件別 詳細</div>
    ${projTableHtml}

    <!-- 人別 詳細テーブル -->
    <div class="section-title" style="margin-top:28px;">人別 詳細</div>
    ${memberTableHtml}`;

    document.getElementById('mgmtSalesProgress').innerHTML = html;

    // 案件別キャンセル率チャートは別コンテナに出力
    document.getElementById('mgmtCancelRateChart').innerHTML =
        '<div class="section-title" style="margin-top:28px;">案件別 キャンセル率</div>' +
        '<div class="mgmt-chart-container" style="height:' + cancelChartHeight + 'px;"><canvas id="mgmtBarCancelRate"></canvas></div>';
    document.getElementById('mgmtExecForecast').innerHTML = '';
    document.getElementById('mgmtCapProgress').innerHTML = '';
    document.getElementById('mgmtAssignmentAssess').innerHTML = '';

    // 月別 達成率推移 + 案件別ステータス集計（履歴データが既に読み込み済みなら描画）
    renderMonthlyTrendTable();
    renderHistoricalProjectStatus();

    // ========== チャート描画 ==========
    // 当月取得ゲージのbreakdown も activeメンバー + active案件 で算出（合計が表と一致するため）
    const acqBreakdown = memberDetailData
        .filter(d => d.acqAmount > 0)
        .map(d => ({ name: d.name, value: d.acqAmount }));
    const execBreakdown = activeMembers.map(m => ({
        name: m.member_name,
        value: allExecAppo.filter(a => a.member_name === m.member_name && a.status === '実施').reduce((s, a) => s + (parseFloat(a.amount) || 0), 0),
    }));
    createGaugeChart('mgmtGaugeAcq', gaugeAcqAmount, periodTarget, standardProgress, '取得金額', `達成率 ${acqRate}%`, acqBreakdown);
    createGaugeChart('mgmtGaugeExec', execConfirmed, periodExecTarget, standardProgress, '実施確定', `達成率 ${execRate}%`, execBreakdown);

    // 円グラフ中心テキスト描画プラグイン
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

    // 案件別キャンセル率バーチャート（キャンセル件数0の案件は除外）
    // チャート用は通常意味のキャンセル率（キャンセル数 / 当月実施合計 × 100）で表示
    const cancelRateData = capData
        .filter(c => c.cancelCount > 0 && c.execCount > 0)
        .map(c => ({ ...c, chartCancelRate: Math.round(c.cancelCount / c.execCount * 100) }))
        .sort((a, b) => b.chartCancelRate - a.chartCancelRate);
    const cancelBarCtx = document.getElementById('mgmtBarCancelRate');
    if (cancelBarCtx && cancelRateData.length > 0) {
        mgmtCharts['mgmtBarCancelRate'] = new Chart(cancelBarCtx, {
            type: 'bar',
            data: {
                labels: cancelRateData.map(c => c.name),
                datasets: [{
                    data: cancelRateData.map(c => c.chartCancelRate),
                    backgroundColor: cancelRateData.map(c => c.chartCancelRate >= 30 ? 'var(--red-400)' : 'var(--blue-200)'),
                    borderRadius: 4,
                    barPercentage: 0.7,
                    categoryPercentage: 0.85
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { beginAtZero: true, max: Math.max(100, ...cancelRateData.map(c => c.chartCancelRate)), ticks: { callback: v => v + '%', font: { size: 10 } }, grid: { color: '#f5f5f5' } },
                    y: { ticks: { font: { size: 11, family: '"Noto Sans JP"', weight: '600' } }, grid: { display: false } }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx) => ctx.parsed.x + '% (' + cancelRateData[ctx.dataIndex].cancelCount + '件)' } }
                }
            }
        });
    }
}

// ==================== 共通指標定義（朝礼の散布図などで使用） ====================
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
    { key: 'cancelRate', label: 'キャンセル率', fmt: v => v.toFixed(1) + '%', unit: '%', isRate: true },
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
    // キャンセル率（アポ件数に対するキャンセル件数の割合）
    let memberAllAppo = appointmentsData.filter(a => a.member_name === memberName);
    if (proj && proj !== 'all') memberAllAppo = memberAllAppo.filter(a => a.project_name === proj);
    const cancelCount = memberAllAppo.filter(a => a.status === 'キャンセル').length;
    const cancelRate = memberAllAppo.length > 0 ? cancelCount / memberAllAppo.length * 100 : 0;
    return {
        calls, pr, appo, amount, execConfirmed, hours, days,
        dailyCalls: days > 0 ? Math.round(calls / days) : 0,
        hourly: hours > 0 ? calls / hours : 0,
        callToPr: calls > 0 ? pr / calls * 100 : 0,
        prToAppo: pr > 0 ? appo / pr * 100 : 0,
        callToAppo: calls > 0 ? appo / calls * 100 : 0,
        cancelRate,
    };
}

// 散布図（共通描画関数）
const SCATTER_COLORS = ['#86aaec', '#c4b5fd', '#ef947a', '#a8d8b9', '#ede07d', '#f0b8d0', '#90b8f8', '#b8d4f0', '#d4a8e0', '#f0c8a8', '#a8c8f0', '#c8e0a8', '#e0b8c8', '#b8e0d4', '#e0d4a8'];

function renderScatterChart(canvasId, chartStore, chartKey, perfData, xKey, yKey, sizeKey, proj) {
    if (chartStore[chartKey]) { chartStore[chartKey].destroy(); }
    const excluded = getExcludedMembers(document.getElementById('filterMonth').value);
    const activeMembers = membersData.filter(m => m.status === 'active' && !excluded.includes(m.member_name));

    const xMeta = ANL_METRICS.find(m => m.key === xKey);
    const yMeta = ANL_METRICS.find(m => m.key === yKey);

    const allStats = activeMembers.map(m => ({ name: m.member_name, ...calcMemberStats(perfData, m.member_name, proj) }));
    const maxSize = Math.max(...allStats.map(s => s[sizeKey]), 1);

    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    chartStore[chartKey] = new Chart(ctx, {
        type: 'bubble',
        data: {
            datasets: allStats.map((s, i) => ({
                label: s.name,
                data: [{ x: s[xKey], y: s[yKey], r: Math.max(4, s[sizeKey] / maxSize * 30) }],
                backgroundColor: SCATTER_COLORS[i % SCATTER_COLORS.length] + 'aa',
                borderColor: SCATTER_COLORS[i % SCATTER_COLORS.length],
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
                        label: (tipCtx) => {
                            const d = tipCtx.raw;
                            return `${tipCtx.dataset.label}: ${xMeta?.label}=${xMeta?.fmt(d.x)}, ${yMeta?.label}=${yMeta?.fmt(d.y)}`;
                        }
                    }
                }
            }
        }
    });
}

// 朝礼タブ用ラッパー
function renderMorningScatter() {
    const xKey = document.getElementById('mrnScatterX')?.value || 'calls';
    const yKey = document.getElementById('mrnScatterY')?.value || 'callToAppo';
    const sizeKey = document.getElementById('mrnScatterSize')?.value || 'amount';
    renderScatterChart('mrnScatterChart', charts, 'mrnScatter', performanceData, xKey, yKey, sizeKey, 'all');
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
    const monthlyTarget = totalTarget ? totalTarget.appointment_amount_target : parseInt(settingsMap.monthly_target_total || '16000000');
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

        // 着地ヨミ = 実施確定 + 未確認 × (1 - キャンセル率)
        const teamExecConfirmedAmt = teamExec.filter(a => a.status === '実施').reduce((s, a) => s + (a.amount || 0), 0);
        const teamExecUnconfirmedAmt = teamExec.filter(a => a.status === '未確認').reduce((s, a) => s + (a.amount || 0), 0);
        const execForecast = teamExecConfirmedAmt + Math.round(teamExecUnconfirmedAmt * (1 - 0.15));
        // 実施確定（ステータス=実施のみ）
        const execConfirmed = teamExecConfirmedAmt;

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
                    <span style="font-size:0.75rem;color:var(--text-light);">（確定+未確認×85%）</span>
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
        // 着地ヨミ = 実施確定 + 未確認 × (1 - キャンセル率)
        const memberExecConfirmedAmt = memberExec.filter(a => a.status === '実施').reduce((s, a) => s + (a.amount || 0), 0);
        const memberExecUnconfirmedAmt = memberExec.filter(a => a.status === '未確認').reduce((s, a) => s + (a.amount || 0), 0);
        const execForecast = memberExecConfirmedAmt + Math.round(memberExecUnconfirmedAmt * (1 - 0.15));
        const execConfirmed = memberExecConfirmedAmt;

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
                    <span style="font-size:0.75rem;color:var(--text-light);">（確定+未確認×85%）</span>
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
// アポ確認タブ専用: 日付範囲フィルターの読み出し
function getAppoDateFilter() {
    return {
        acqFrom: (document.getElementById('appoAcqFrom') || {}).value || '',
        acqTo:   (document.getElementById('appoAcqTo')   || {}).value || '',
        schFrom: (document.getElementById('appoSchFrom') || {}).value || '',
        schTo:   (document.getElementById('appoSchTo')   || {}).value || ''
    };
}
function onAppoDateFilterChange() {
    // 入力範囲が当月外なら再クエリ。それ以外はクライアント側だけで再描画
    const ym = document.getElementById('filterMonth').value;
    const ymStart = ym + '-01';
    const ymEnd = getEndOfMonth(ym);
    const f = getAppoDateFilter();
    const outOfMonth = [f.acqFrom, f.acqTo, f.schFrom, f.schTo].some(d => d && (d < ymStart || d > ymEnd));
    if (outOfMonth) {
        reloadAppoDataForDateRange().then(() => renderAppointments());
    } else {
        renderAppointments();
    }
}
function clearAppoDateFilter() {
    ['appoAcqFrom','appoAcqTo','appoSchFrom','appoSchTo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    renderAppointments();
}
// 日付範囲が当月を超える場合に、必要な範囲を Turso から追加ロード
async function reloadAppoDataForDateRange() {
    const ym = document.getElementById('filterMonth').value;
    const ymStart = ym + '-01';
    const ymEnd = getEndOfMonth(ym);
    const f = getAppoDateFilter();
    const dates = [ymStart, ymEnd, f.acqFrom, f.acqTo, f.schFrom, f.schTo].filter(Boolean);
    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));
    try {
        const rows = await queryTurso(
            "SELECT * FROM appointments WHERE (acquisition_date BETWEEN ? AND ?) OR (scheduled_date BETWEEN ? AND ?) ORDER BY scheduled_date",
            [minDate, maxDate, minDate, maxDate]
        );
        normalizeDataMemberNames(rows);
        executionAppoData = stripDeletedAppos(stripExcludedAppos(deduplicateAppointments(rows)));
    } catch (e) {
        console.error('アポ範囲再読み込み失敗:', e);
    }
}

function renderAppointments() {
    const ym = document.getElementById('filterMonth').value;
    const excluded = getExcludedMembers(ym);
    const activeProjectsForAppo = new Set(projectsData.filter(p => p.status === 'active').map(p => p.project_name));

    // アポ確認タブはグローバルのチーム/メンバー/月フィルターを無視し、
    // 自前の日付範囲フィルター(取得日 from~to AND 実施予定日 from~to)を使う。
    const df = getAppoDateFilter();
    const ymStart = ym + '-01';
    const ymEnd = getEndOfMonth(ym);
    // 日付未入力時のデフォルトは当月（実施予定日が当月）
    const acqFrom = df.acqFrom || '';
    const acqTo   = df.acqTo   || '';
    const schFrom = df.schFrom || (df.acqFrom || df.acqTo ? '' : ymStart);
    const schTo   = df.schTo   || (df.acqFrom || df.acqTo ? '' : ymEnd);

    const merged = (executionAppoData || [])
        .filter(a => !excluded.includes(a.member_name))
        .filter(a => activeProjectsForAppo.has(a.project_name))
        .filter(a => !acqFrom || (a.acquisition_date && a.acquisition_date >= acqFrom))
        .filter(a => !acqTo   || (a.acquisition_date && a.acquisition_date <= acqTo))
        .filter(a => !schFrom || (a.scheduled_date && a.scheduled_date >= schFrom))
        .filter(a => !schTo   || (a.scheduled_date && a.scheduled_date <= schTo));
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

    // テーブル・ドロップダウン用「今日まで」フィルタは「未確認」絞り込み時のみ適用
    // （担当者が今日までに確認すべきアポを浮き上がらせるため）
    // 全て / 実施 / リスケ / キャンセル は今日以降の日程も含めて全件表示
    let tableBaseData = allData;
    if (!appoShowAll && currentAppoFilter === '未確認') {
        const today = formatDate(new Date());
        tableBaseData = tableBaseData.filter(a => !a.scheduled_date || a.scheduled_date <= today);
    }

    const statusCounts = { '未確認': 0, '実施': 0, 'リスケ': 0, 'キャンセル': 0 };
    const statusAmounts = { '未確認': 0, '実施': 0, 'リスケ': 0, 'キャンセル': 0 };
    // 「翌月以降リスケ」判定: scheduled_date が当月内 & reschedule_date が翌月初日以上
    // それ以外のリスケ (当月内 / reschedule_date 未入力) は表示しない仕様
    const nextYM = getNextYM(ym);
    const nextStart = nextYM + '-01';
    let rescheduleNextCount = 0, rescheduleNextAmount = 0;
    summaryData.forEach(a => {
        if (statusCounts[a.status] !== undefined) {
            statusCounts[a.status]++;
            statusAmounts[a.status] += a.amount || 0;
        }
        if (a.status === 'リスケ') {
            // 取得日が当月 & 実施日時が翌月以降 = 当月取得アポが翌月以降にリスケされたもの
            const acqInMonth = a.acquisition_date && a.acquisition_date >= ymStart && a.acquisition_date <= ymEnd;
            const schNextOrLater = a.scheduled_date && a.scheduled_date >= nextStart;
            if (acqInMonth && schNextOrLater) {
                rescheduleNextCount++;
                rescheduleNextAmount += a.amount || 0;
            }
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
    // リスケ率の分子は「翌月リスケ」のみ。分母はモ集団 (total)
    const rescheduleRate = total > 0 ? (rescheduleNextCount / total * 100).toFixed(1) : '0';
    const unconfirmedRate = total > 0 ? (statusCounts['未確認'] / total * 100).toFixed(1) : '0';

    const totalAmount = statusAmounts['実施'] + statusAmounts['リスケ'] + statusAmounts['キャンセル'] + statusAmounts['未確認'];
    // 各カードクリックでステータス絞り込み（XSSなし: ハードコードされた静的属性のみ）
    const _act = (s) => currentAppoFilter === s ? ' rate-card-active' : '';
    document.getElementById('appo-status-summary').innerHTML = `
        <div class="rate-grid" style="margin-bottom:12px;">
            <div class="rate-card rate-card-clickable${_act('all')}" onclick="filterAppoStatus('all')">
                <div class="rate-value" style="color:var(--text-dark);">${total}件</div>
                <div class="rate-label">総アポ数</div>
                <div style="font-size:0.85rem;font-weight:600;color:var(--text-dark);margin-top:2px;">¥${totalAmount.toLocaleString()}</div>
            </div>
            <div class="rate-card rate-card-clickable${_act('実施')}" onclick="filterAppoStatus('実施')">
                <div class="rate-value" style="color:var(--primary-blue);">${statusCounts['実施']}件<span style="font-size:0.75rem;font-weight:500;margin-left:4px;">(${executeRate}%)</span></div>
                <div class="rate-label">実施確定</div>
                <div style="font-size:0.85rem;font-weight:600;color:var(--primary-blue);margin-top:2px;">¥${statusAmounts['実施'].toLocaleString()}</div>
            </div>
            <div class="rate-card rate-card-clickable${_act('リスケ')}" onclick="filterAppoStatus('リスケ')" title="当月実施予定だったアポのうち、翌月以降にリスケされたもの">
                <div class="rate-value" style="color:#8a7a00;">${rescheduleNextCount}件<span style="font-size:0.75rem;font-weight:500;margin-left:4px;">(${rescheduleRate}%)</span></div>
                <div class="rate-label">リスケ<span style="font-size:0.7rem;color:var(--text-muted);margin-left:4px;">(翌月以降)</span></div>
                <div style="font-size:0.85rem;font-weight:600;color:#8a7a00;margin-top:2px;">¥${rescheduleNextAmount.toLocaleString()}</div>
            </div>
            <div class="rate-card rate-card-clickable${_act('キャンセル')}" onclick="filterAppoStatus('キャンセル')">
                <div class="rate-value" style="color:var(--primary-red);">${statusCounts['キャンセル']}件<span style="font-size:0.75rem;font-weight:500;margin-left:4px;">(${cancelRate}%)</span></div>
                <div class="rate-label">キャンセル</div>
                <div style="font-size:0.85rem;font-weight:600;color:var(--primary-red);margin-top:2px;">¥${statusAmounts['キャンセル'].toLocaleString()}</div>
            </div>
            <div class="rate-card rate-card-clickable${_act('未確認')}" onclick="filterAppoStatus('未確認')">
                <div class="rate-value" style="color:var(--text-light);">${statusCounts['未確認']}件<span style="font-size:0.75rem;font-weight:500;margin-left:4px;">(${unconfirmedRate}%)</span></div>
                <div class="rate-label">未確認</div>
                <div style="font-size:0.85rem;font-weight:600;color:var(--text-light);margin-top:2px;">¥${statusAmounts['未確認'].toLocaleString()}</div>
            </div>
        </div>
    `;

    // アポ用メンバー・案件フィルタドロップダウン更新
    // 候補の母集団は「メンバー/案件マスター」(active のみ・除外メンバーを除く)。
    // 表示中データ(allData)に依存させると 1行しかない時に候補が消えてしまうため。
    const appoMemberFilter = document.getElementById('appoMemberFilter');
    const appoProjectFilter = document.getElementById('appoProjectFilter');
    if (appoMemberFilter) {
        const currentMember = appoMemberFilter.value;
        const members = membersData
            .filter(m => m.status === 'active' && !excluded.includes(m.member_name))
            .map(m => m.member_name)
            .sort((a, b) => a.localeCompare(b, 'ja'));
        const desiredOptCount = members.length + 1;
        // 母集団が変わらない (= 同じ件数) ならカスタムセレクトの作り直しは不要
        if (appoMemberFilter.options.length !== desiredOptCount) {
            appoMemberFilter.innerHTML = '<option value="all">全担当者</option>' +
                members.map(m => `<option value="${m}">${displayName(m)}</option>`).join('');
            appoMemberFilter.value = (currentMember === 'all' || members.includes(currentMember)) ? currentMember : 'all';
            rebuildCustomSelect('appoMemberFilter');
        } else {
            appoMemberFilter.value = (currentMember === 'all' || members.includes(currentMember)) ? currentMember : 'all';
        }
    }
    if (appoProjectFilter) {
        const currentProject = appoProjectFilter.value;
        const projects = projectsData
            .filter(p => p.status === 'active')
            .map(p => p.project_name)
            .sort((a, b) => a.localeCompare(b, 'ja'));
        const desiredOptCount = projects.length + 1;
        if (appoProjectFilter.options.length !== desiredOptCount) {
            appoProjectFilter.innerHTML = '<option value="all">全案件</option>' +
                projects.map(p => `<option value="${p}">${p}</option>`).join('');
            appoProjectFilter.value = (currentProject === 'all' || projects.includes(currentProject)) ? currentProject : 'all';
            rebuildCustomSelect('appoProjectFilter');
        } else {
            appoProjectFilter.value = (currentProject === 'all' || projects.includes(currentProject)) ? currentProject : 'all';
        }
    }

    // テーブル用データ: tableBaseData（今日までフィルタ済み） + ステータスフィルタ
    // リスケ タブは「翌月以降リスケ」のみ表示（当月内・NULL は非表示）
    let filtered;
    if (currentAppoFilter === 'all') {
        filtered = tableBaseData;
    } else if (currentAppoFilter === 'リスケ') {
        // 取得日が当月 & 実施日時が翌月以降のリスケのみ表示
        filtered = tableBaseData.filter(a =>
            a.status === 'リスケ' &&
            a.acquisition_date && a.acquisition_date >= ymStart && a.acquisition_date <= ymEnd &&
            a.scheduled_date && a.scheduled_date >= nextStart
        );
    } else {
        filtered = tableBaseData.filter(a => a.status === currentAppoFilter);
    }

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
                <td>
                    ${formatDateDisplay(a.scheduled_date)}
                    ${a.status === 'リスケ' && a.reschedule_date ? `<div style="font-size:0.7rem;color:#8a7a00;margin-top:2px;">→ ${formatDateDisplay(a.reschedule_date)}</div>` : ''}
                </td>
                <td class="text-right number">¥${(a.amount || 0).toLocaleString()}</td>
                <td><span class="status-badge ${statusClass}">${a.status}</span></td>
                <td>
                    <div style="display:flex;gap:4px;align-items:center;">
                        ${a.status === '未確認' ? `
                            <button class="status-btn btn-execute" onclick="updateAppoStatus('${a.id}','実施')">実施</button>
                            <button class="status-btn btn-reschedule" onclick="openRescheduleModal('${a.id}')">リスケ</button>
                            <button class="status-btn btn-cancel" onclick="updateAppoStatus('${a.id}','キャンセル')">キャンセル</button>
                        ` : `
                            <button class="status-btn" onclick="updateAppoStatus('${a.id}','未確認')">戻す</button>
                        `}
                        <button class="status-btn" title="削除（集計対象外）" onclick="deleteAppointment('${a.id}')" style="border-color:var(--border-color);color:var(--text-light);padding:4px 6px;line-height:1;">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                                <path d="M10 11v6"/>
                                <path d="M14 11v6"/>
                                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                            </svg>
                        </button>
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


// アポを soft delete (キャンセル率には影響させない「無効化」)
// 元データ(スプレッドシート)が次回 sync で同キーを送ってきても deleted_at は維持されるため復活しない
async function deleteAppointment(id) {
    if (!confirm('このアポを削除します。\nキャンセル率などの集計には影響しません。\nよろしいですか？')) return;
    try {
        await executeTurso(
            "UPDATE appointments SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
            [id]
        );
        // ローカルデータからも除去
        [appointmentsData, executionAppoData, historicalAppoData].forEach(list => {
            if (!list) return;
            const idx = list.findIndex(a => a.id === id);
            if (idx >= 0) list.splice(idx, 1);
        });
        showToast('アポを削除しました');
        renderAppointments();
        // 経営タブ等も再描画して集計を反映
        if (typeof renderAll === 'function') {
            try { renderAll(); } catch (e) { /* noop */ }
        }
    } catch (error) {
        console.error('アポ削除に失敗:', error);
        alert('削除に失敗しました: ' + error.message);
    }
}

// ==================== リスケモーダル ====================
function openRescheduleModal(id) {
    const appo = (executionAppoData || []).find(a => a.id === id)
              || (appointmentsData || []).find(a => a.id === id);
    if (!appo) { alert('対象アポが見つかりません'); return; }

    document.getElementById('rescheduleAppoId').value = id;
    document.getElementById('rescheduleCustomer').textContent = appo.customer_name || '-';
    document.getElementById('rescheduleOriginalDate').textContent = formatDateDisplay(appo.scheduled_date) || '-';

    // 既に reschedule_date がある場合は初期値として表示（編集用途）
    document.getElementById('rescheduleNewDate').value = appo.reschedule_date || '';
    document.getElementById('rescheduleMemo').value = appo.memo || '';

    document.getElementById('rescheduleModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('rescheduleNewDate').focus(), 50);
}

function closeRescheduleModal() {
    document.getElementById('rescheduleModal').classList.add('hidden');
}

function submitRescheduleModal() {
    const id = document.getElementById('rescheduleAppoId').value;
    const newDate = document.getElementById('rescheduleNewDate').value;
    const memo = document.getElementById('rescheduleMemo').value.trim();
    if (!id || !newDate) { alert('新しい実施予定日を入力してください'); return; }
    closeRescheduleModal();
    updateAppoStatus(id, 'リスケ', newDate, memo || null);
}

async function updateAppoStatus(id, newStatus, rescheduleDate = null, memo = null) {
    console.log('updateAppoStatus called:', id, newStatus, rescheduleDate, memo);
    try {
        const now = formatDate(new Date());
        if (newStatus === '未確認') {
            // 戻す: reschedule_date はクリア、memo はユーザー判断で保持
            await executeTurso(
                "UPDATE appointments SET status = ?, confirmation_date = NULL, confirmed_by = NULL, reschedule_date = NULL, updated_at = datetime('now') WHERE id = ?",
                [newStatus, id]
            );
        } else if (newStatus === 'リスケ') {
            // memo は渡された場合のみ更新（既存メモを上書きしないよう COALESCE）
            await executeTurso(
                "UPDATE appointments SET status = ?, confirmation_date = ?, confirmed_by = 'dashboard', reschedule_date = ?, memo = COALESCE(?, memo), updated_at = datetime('now') WHERE id = ?",
                [newStatus, now, rescheduleDate, memo, id]
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
                if (newStatus === 'リスケ') {
                    appo.reschedule_date = rescheduleDate;
                    if (memo !== null) appo.memo = memo;
                } else if (newStatus === '未確認') {
                    appo.reschedule_date = null;
                }
            }
        });
        console.log('Local data updated');

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

    // 案件カード (active / inactive を分けて描画)
    const buildProjectCard = (p) => {
        const pid = encodeURIComponent(p.project_name);
        const cap = p.monthly_cap_count || 0;
        const actual = projectAppoCount[p.project_name] || 0;
        const remaining = cap > 0 ? cap - actual : null;
        const capRate = cap > 0 ? Math.round(actual / cap * 100) : null;
        const barWidth = cap > 0 ? Math.min(actual / cap * 100, 100) : 0;
        const isOver = cap > 0 && actual >= cap;
        const barColor = isOver ? 'var(--primary-red)' : capRate > 80 ? '#ede07d' : 'var(--primary-blue)';
        const isInactive = p.status === 'inactive';

        const stats = projectPerfStats[p.project_name] || { calls: 0, appo: 0 };
        const unitPrice = p.unit_price || 0;
        const cta = stats.calls > 0 ? (stats.appo / stats.calls) : 0;
        const alertScore = unitPrice * cta;
        const hasAlert = !isInactive && stats.calls >= 100 && alertScore < 7;

        const cardExtraStyle = [
            hasAlert ? 'border-left:3px solid var(--primary-red);' : '',
            isInactive ? 'opacity:0.55;background:#fafafa;' : ''
        ].filter(Boolean).join('');

        return `
            <div class="project-card" id="pcard-${pid}"${cardExtraStyle ? ` style="${cardExtraStyle}"` : ''}>
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
                        <span class="kpi-badge${isInactive ? '' : ' good'}">${p.status}</span>
                    </div>
                </div>
                <div class="project-cap-section">
                    <div class="project-cap-header">
                        <span class="project-meta-label">月次キャップ</span>
                        <span class="project-cap-edit editable-field" onclick="onProjectCapClick(this, '${p.id}', '${escapeHtml(p.project_name)}', ${cap})">${cap > 0 ? fmtNum(cap) + '件' : '未設定'}</span>
                    </div>
                    ${cap > 0 ? `
                        <div class="project-cap-bar-wrap">
                            <div class="project-cap-bar">
                                <div class="project-cap-bar-fill" style="width:${barWidth}%;background:${barColor};"></div>
                            </div>
                        </div>
                        <div class="project-cap-stats">
                            <span class="project-cap-actual">${fmtNum(actual)}件<span style="color:var(--text-light);font-weight:400;"> / ${fmtNum(cap)}件</span></span>
                            <span class="project-cap-remaining ${isOver ? 'over' : ''}">${isOver ? 'キャップ超過' : '残り' + fmtNum(remaining) + '件'}</span>
                        </div>
                    ` : `
                        <div class="project-cap-stats">
                            <span class="project-cap-actual">${fmtNum(actual)}件</span>
                        </div>
                    `}
                </div>
                ${p.call_list_url ? `<div style="margin-top:12px;"><a href="${escapeHtml(p.call_list_url)}" target="_blank" style="color:var(--text-muted);font-size:0.8rem;">架電リスト →</a></div>` : ''}
            </div>
        `;
    };

    const activeProjects = projectsData.filter(p => p.status !== 'inactive');
    const inactiveProjects = projectsData.filter(p => p.status === 'inactive');
    const activeHtml = activeProjects.map(buildProjectCard).join('') || '<p style="color:var(--text-light);padding:20px;">案件が登録されていません。</p>';
    // 既存と同じパターン: ユーザ入力は escapeHtml/encodeURIComponent 済み、状態値はホワイトリスト
    document.getElementById('projectGrid').innerHTML = activeHtml;

    const inactiveWrap = document.getElementById('inactiveProjectsWrap');
    const inactiveGrid = document.getElementById('inactiveProjectGrid');
    if (inactiveWrap && inactiveGrid) {
        if (inactiveProjects.length > 0) {
            inactiveGrid.innerHTML = inactiveProjects.map(buildProjectCard).join('');
            inactiveWrap.style.display = '';
        } else {
            inactiveGrid.textContent = '';
            inactiveWrap.style.display = 'none';
        }
    }

    // キャップテーブル
    renderCapTable();
    // アサイン管理テーブル
    renderAssignments();
}

// 案件カードのキャップ数クリック時:
// 単一プラン案件はそのままインライン編集を許可。複数プラン案件はモーダルへ誘導。
function onProjectCapClick(el, projectId, projectName, currentValue) {
    const plans = getPlansForProject(projectId);
    if (plans.length > 1) {
        alert('この案件は複数プランあるため、編集モーダルから変更してください。');
        openProjectForm(projectId);
        return;
    }
    editProjectField(el, projectName, 'monthly_cap_count', currentValue, projectId);
}

function editProjectField(el, projectName, field, currentValue, projectId) {
    if (el.querySelector('input')) return; // already editing
    const display = el.innerHTML;
    const input = document.createElement('input');
    input.value = '';
    input.placeholder = currentValue ? fmtNum(currentValue) : '0';
    input.style.cssText = 'width:80px;padding:4px 6px;border:1px solid var(--primary-blue);border-radius:4px;font-size:0.85rem;text-align:right;';
    attachThousandSeparator(input);
    el.innerHTML = '';
    el.appendChild(input);
    input.focus();

    const save = async () => {
        const rawVal = input.value.trim();
        if (rawVal === '') { el.innerHTML = display; return; } // 未入力はキャンセル
        const newVal = parseNum(rawVal);
        try {
            await executeTurso(
                `UPDATE projects SET ${field} = ?, updated_at = datetime('now') WHERE project_name = ?`,
                [newVal, projectName]
            );
            const proj = projectsData.find(p => p.project_name === projectName);
            if (proj) proj[field] = newVal;
            // project_plans とも同期 (単一プラン案件のみ呼ばれる想定。plan が無ければ 1 行作成)
            if (projectId && field === 'monthly_cap_count') {
                const plans = getPlansForProject(projectId);
                if (plans.length === 1) {
                    const unitPrice = plans[0].unit_price || 0;
                    await executeTurso(
                        "UPDATE project_plans SET monthly_cap_count = ?, monthly_cap_amount = ?, updated_at = datetime('now') WHERE id = ?",
                        [newVal, unitPrice * newVal, plans[0].id]
                    );
                    plans[0].monthly_cap_count = newVal;
                    plans[0].monthly_cap_amount = unitPrice * newVal;
                } else if (plans.length === 0) {
                    await executeTurso(
                        `INSERT INTO project_plans (id, project_id, plan_order, unit_price, monthly_cap_count, monthly_cap_amount)
                         VALUES (lower(hex(randomblob(16))), ?, 1, 0, ?, 0)`,
                        [projectId, newVal]
                    );
                    projectPlansData.push({ project_id: projectId, plan_order: 1, unit_price: 0, monthly_cap_count: newVal, monthly_cap_amount: 0 });
                }
            }
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
                <div class="cap-summary-value">${fmtNum(totalCap)}<span class="cap-summary-unit">件</span></div>
            </div>
            <div class="cap-summary-item">
                <div class="cap-summary-label">合計実績</div>
                <div class="cap-summary-value">${fmtNum(totalActual)}<span class="cap-summary-unit">件</span></div>
            </div>
            <div class="cap-summary-item">
                <div class="cap-summary-label">残キャップ</div>
                <div class="cap-summary-value" style="color:${totalRemaining <= 0 ? 'var(--primary-red)' : 'var(--text-dark)'}">${fmtNum(totalRemaining)}<span class="cap-summary-unit">件</span></div>
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
    // 数値 input に 3桁カンマを適用 (一度きり attach)
    ['asgFormCapCount','asgFormCapAmount','asgFormTargetCount'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.sepAttached) {
            attachThousandSeparator(el, { runFormatNow: true });
            el.dataset.sepAttached = '1';
        } else if (el) {
            // 既に attach 済み → 値だけ整形
            el.dispatchEvent(new Event('blur'));
        }
    });
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
    const capCount = parseNum(document.getElementById('asgFormCapCount').value);
    const capAmount = parseNum(document.getElementById('asgFormCapAmount').value);
    const targetCount = parseNum(document.getElementById('asgFormTargetCount').value);
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

    // 月別 総目標金額(全社合計) テーブルを描画
    renderMonthlyTotalTargets();

    // レート設定（DOM要素がある場合のみ）
    const crEl = document.getElementById('settingCancelRate');
    const frEl = document.getElementById('settingFlowRate');
    const mtEl = document.getElementById('settingMonthlyTarget');
    if (crEl) crEl.value = settingsMap.cancel_rate_default || '0.8';
    if (frEl) frEl.value = settingsMap.next_month_flow_rate || '0.5';
    if (mtEl) mtEl.value = settingsMap.monthly_target_total || '16000000';

    // チーム管理テーブル
    const teamManageBody = document.getElementById('teamManageBody');
    if (teamManageBody) {
        const teamsSorted = [...(teamsData || [])].sort((a, b) => {
            const sa = a.status === 'active' ? 0 : 1;
            const sb = b.status === 'active' ? 0 : 1;
            if (sa !== sb) return sa - sb;
            return String(a.team_name || '').localeCompare(String(b.team_name || ''), 'ja');
        });
        teamManageBody.innerHTML = teamsSorted.map(t => {
            const isInactive = t.status !== 'active';
            const rowStyle = isInactive ? 'opacity:0.55;background:#fafafa;' : '';
            const badgeClass = isInactive ? 'status-badge' : 'status-badge status-executed';
            const leaderDisplay = t.leader_name ? normalizeMemberName(t.leader_name) : '-';
            return `
                <tr style="${rowStyle}">
                    <td>${t.team_name}</td>
                    <td>${leaderDisplay}</td>
                    <td><span class="${badgeClass}">${t.status}</span></td>
                    <td style="display:flex;gap:4px;">
                        <button class="status-btn" onclick="openTeamForm('${t.id}')">編集</button>
                        <button class="status-btn" onclick="toggleTeamStatus('${t.id}','${isInactive ? 'active' : 'inactive'}')">${isInactive ? '有効化' : '無効化'}</button>
                        <button class="status-btn btn-cancel" onclick="deleteTeam('${t.id}')">削除</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // メンバー管理テーブル (active が上、inactive は下に灰色トーンで)
    let memberRows = '';
    const memberSortedForRender = [...membersData].sort((a, b) => {
        const sa = a.status === 'active' ? 0 : 1;
        const sb = b.status === 'active' ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return String(a.team_name || '').localeCompare(String(b.team_name || ''), 'ja');
    });
    memberSortedForRender.forEach(m => {
        const isInactive = m.status !== 'active';
        const rowStyle = isInactive ? 'opacity:0.55;background:#fafafa;' : '';
        const badgeClass = isInactive ? 'status-badge' : 'status-badge status-executed';
        memberRows += `
            <tr style="${rowStyle}">
                <td>${displayName(m.member_name)}</td>
                <td>${m.team_name}</td>
                <td><span class="${badgeClass}">${m.status}</span></td>
                <td style="display:flex;gap:4px;">
                    <button class="status-btn" onclick="openMemberForm('${m.id}')">編集</button>
                    <button class="status-btn" onclick="toggleMemberStatus('${m.id}','${isInactive ? 'active' : 'inactive'}')">
                        ${isInactive ? '有効化' : '無効化'}
                    </button>
                    <button class="status-btn btn-cancel" onclick="deleteMember('${m.id}')">削除</button>
                </td>
            </tr>
        `;
    });
    document.getElementById('memberManageBody').innerHTML = memberRows;

    // 日別/週別目標: メンバードロップダウン初期化
    initDWTargetMemberSelect(ym);
}

// ==================== 日別・週別 目標設定 ====================

function initDWTargetMemberSelect(ym) {
    var sel = document.getElementById('dwTargetMember');
    if (!sel) return;

    // 既存カスタムラッパーを削除して再生成
    sel.classList.remove('custom-initialized');
    sel.style.display = '';
    var oldWrap = sel.nextElementSibling;
    if (oldWrap && oldWrap.classList.contains('custom-select-wrap')) oldWrap.remove();

    sel.textContent = '';
    var excluded = getExcludedMembers(ym);
    var memberTeamMap = getTeamsForMonth(ym);
    membersData.filter(function(m) {
        return m.status === 'active' && !excluded.includes(m.member_name);
    }).filter(function(m) {
        var team = memberTeamMap[m.member_name];
        return team && team !== '未所属';
    }).forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m.member_name;
        opt.textContent = displayName(m.member_name);
        sel.appendChild(opt);
    });
    sel.addEventListener('change', function() { renderDWTargetForm(); });
    renderDWTargetForm();
    initCustomSelects();
}

function renderDWTargetForm() {
    var container = document.getElementById('dwTargetContent');
    if (!container) return;
    container.textContent = '';

    var ym = document.getElementById('filterMonth').value;
    var memberName = document.getElementById('dwTargetMember')?.value;
    if (!memberName) return;

    var parts = ym.split('-');
    var year = parseInt(parts[0]);
    var month = parseInt(parts[1]);
    var lastDay = new Date(year, month, 0).getDate();
    var dayNames = ['日', '月', '火', '水', '木', '金', '土'];

    // === カレンダーUI（週別+日別統合） ===
    var calTitle = document.createElement('h4');
    calTitle.textContent = '目標設定（' + month + '月）';
    calTitle.style.cssText = 'margin:0 0 8px;font-size:0.9rem;';
    container.appendChild(calTitle);

    var weeks = getWeeksOfMonth(year, month);

    var calS = 'max-width:720px;border:1px solid #e2e5ea;border-radius:8px;overflow:hidden;';
    var headerS = 'display:grid;grid-template-columns:100px repeat(5,1fr);background:#e7eefb;';
    var dayLabelS = 'text-align:center;padding:8px 0;font-weight:600;font-size:0.8rem;color:#1155cc;';
    var weekLabelS = 'text-align:center;padding:8px 0;font-weight:600;font-size:0.75rem;color:#666;';
    var rowS = 'display:grid;grid-template-columns:100px repeat(5,1fr);border-top:1px solid #e2e5ea;';
    var cellS = 'padding:6px;min-height:64px;border-right:1px solid #e4e8ef;display:flex;flex-direction:column;gap:4px;';
    var weekCellS = 'padding:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;background:#f8f9fb;border-right:1px solid #e4e8ef;';
    var inputS = 'width:100%;padding:4px 6px;border:1px solid #e2e5ea;border-radius:4px;font-size:0.8rem;text-align:right;background:#fff;';
    var weekInputS = 'width:80px;padding:4px 6px;border:1px solid #c2d6f9;border-radius:4px;font-size:0.8rem;text-align:right;background:#fff;font-weight:600;';

    var cal = document.createElement('div');
    cal.style.cssText = calS;

    // 曜日ヘッダー（週列 + 月~金）
    var headerRow = document.createElement('div');
    headerRow.style.cssText = headerS;
    var weekHeader = document.createElement('div');
    weekHeader.style.cssText = weekLabelS;
    weekHeader.textContent = '週目標';
    headerRow.appendChild(weekHeader);
    ['月', '火', '水', '木', '金'].forEach(function(d) {
        var cell = document.createElement('div');
        cell.style.cssText = dayLabelS;
        cell.textContent = d;
        headerRow.appendChild(cell);
    });
    cal.appendChild(headerRow);

    // 月初の曜日を取得
    var firstDow = new Date(year, month - 1, 1).getDay();
    var mondayOffset = firstDow === 0 ? 6 : firstDow - 1;

    var weekIdx = 0;
    var row = document.createElement('div');
    row.style.cssText = rowS;

    // 週セル追加
    function addWeekCell(r) {
        var w = weeks[weekIdx] || null;
        var wCell = document.createElement('div');
        wCell.style.cssText = weekCellS;
        if (w) {
            var wLabel = document.createElement('div');
            wLabel.style.cssText = 'font-size:0.7rem;color:#666;font-weight:600;';
            wLabel.textContent = '第' + w.num + '週';
            wCell.appendChild(wLabel);

            var existing = weeklyTargetsData.find(function(t) {
                return t.member_name === memberName && t.year_month === ym && parseInt(t.week_number) === w.num;
            });
            var val = existing ? (parseInt(existing.amount_target) || 0) : 0;
            var wInput = document.createElement('input');
            wInput.value = val || '';
            wInput.placeholder = '¥';
            wInput.id = 'dwWeek_' + w.num;
            wInput.style.cssText = weekInputS;
            attachThousandSeparator(wInput, { runFormatNow: true });
            wCell.appendChild(wInput);
        }
        r.appendChild(wCell);
        weekIdx++;
    }

    addWeekCell(row);

    // 月初の空セル
    for (var e = 0; e < mondayOffset; e++) {
        var empty = document.createElement('div');
        empty.style.cssText = cellS + 'background:#f1f3f5;';
        row.appendChild(empty);
    }

    var cellCount = mondayOffset;
    for (var d = 1; d <= lastDay; d++) {
        var dt = new Date(year, month - 1, d);
        var dow = dt.getDay();

        if (dow === 0 || dow === 6) {
            if (dow === 0 && cellCount > 0) {
                cal.appendChild(row);
                row = document.createElement('div');
                row.style.cssText = rowS;
                addWeekCell(row);
                cellCount = 0;
            }
            continue;
        }

        var ds = ym + '-' + String(d).padStart(2, '0');
        var isHoliday = holidaysSet.has(ds);
        var isToday = ds === fmtDateYMD(new Date());

        var existing = dailyTargetsData.find(function(t) {
            return t.member_name === memberName && t.target_date === ds;
        });
        var val = existing ? (parseInt(existing.appointment_amount_target) || 0) : 0;

        var cell = document.createElement('div');
        var extra = isHoliday ? 'background:#fff8f0;' : isToday ? 'background:#eef4ff;box-shadow:inset 0 0 0 2px #1155cc;' : '';
        cell.style.cssText = cellS + extra;

        var dayLabel = document.createElement('div');
        dayLabel.style.cssText = 'font-size:0.75rem;font-weight:600;color:#333;';
        dayLabel.textContent = d;
        cell.appendChild(dayLabel);

        if (!isHoliday) {
            var input = document.createElement('input');
            input.value = val || '';
            input.placeholder = '¥';
            input.id = 'dwDay_' + ds;
            input.style.cssText = inputS;
            attachThousandSeparator(input, { runFormatNow: true });
            cell.appendChild(input);
        } else {
            var hLabel = document.createElement('div');
            hLabel.style.cssText = 'font-size:0.7rem;color:#e04f24;';
            hLabel.textContent = '祝';
            cell.appendChild(hLabel);
        }

        row.appendChild(cell);
        cellCount++;

        if (dow === 5) {
            cal.appendChild(row);
            row = document.createElement('div');
            row.style.cssText = rowS;
            addWeekCell(row);
            cellCount = 0;
        }
    }
    if (cellCount > 0) {
        cal.appendChild(row);
    }

    // === カレンダー + チーム目標を横並び ===
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;';
    wrapper.appendChild(cal);

    // === チーム目標サイドパネル ===
    var memberTeamMap = getTeamsForMonth(ym);
    var teamName = memberTeamMap[memberName] || '';
    if (teamName) {
        var teamMembers = getTeamMembersForMonth(teamName, ym);
        var teamTarget = getTarget('team', teamName, ym);
        var monthlyTeamTarget = teamTarget ? (parseInt(teamTarget.appointment_amount_target) || 0) : 0;

        var side = document.createElement('div');
        side.style.cssText = 'min-width:220px;flex:1;max-width:300px;';

        // チーム名ヘッダー
        var teamHeader = document.createElement('div');
        teamHeader.style.cssText = 'font-weight:700;font-size:0.9rem;margin-bottom:12px;padding:8px 12px;background:#e7eefb;border-radius:6px;color:#1155cc;';
        teamHeader.textContent = teamName.replace('Team', '') + 'チーム';
        side.appendChild(teamHeader);

        // 月間目標
        var monthCard = document.createElement('div');
        monthCard.style.cssText = 'padding:10px 12px;background:#f8f9fb;border-radius:6px;margin-bottom:8px;';
        var monthLabel = document.createElement('div');
        monthLabel.style.cssText = 'font-size:0.7rem;color:#999;margin-bottom:2px;';
        monthLabel.textContent = '月間チーム目標';
        monthCard.appendChild(monthLabel);
        var monthVal = document.createElement('div');
        monthVal.style.cssText = 'font-size:1.1rem;font-weight:700;color:#333;';
        monthVal.textContent = '¥' + monthlyTeamTarget.toLocaleString();
        monthCard.appendChild(monthVal);

        // 週間合算（現在の週）
        var currentWeekNum = getCurrentWeekNumber(ym);
        var weekMemberSum = 0;
        teamMembers.forEach(function(mn) {
            var wt = weeklyTargetsData.find(function(t) {
                return t.member_name === mn && t.year_month === ym && parseInt(t.week_number) === currentWeekNum;
            });
            weekMemberSum += wt ? (parseInt(wt.amount_target) || 0) : 0;
        });
        var weekLabel2 = document.createElement('div');
        weekLabel2.style.cssText = 'font-size:0.7rem;color:#999;margin-top:6px;margin-bottom:2px;';
        weekLabel2.textContent = '第' + currentWeekNum + '週 チーム合算';
        monthCard.appendChild(weekLabel2);
        var weekVal = document.createElement('div');
        weekVal.style.cssText = 'font-size:0.95rem;font-weight:600;color:#1155cc;';
        weekVal.textContent = '¥' + weekMemberSum.toLocaleString();
        monthCard.appendChild(weekVal);

        // 日間合算（今日）
        var todayStr = fmtDateYMD(new Date());
        var dayMemberSum = 0;
        teamMembers.forEach(function(mn) {
            var dt = dailyTargetsData.find(function(t) {
                return t.member_name === mn && t.target_date === todayStr;
            });
            dayMemberSum += dt ? (parseInt(dt.appointment_amount_target) || 0) : 0;
        });
        var dayLabel2 = document.createElement('div');
        dayLabel2.style.cssText = 'font-size:0.7rem;color:#999;margin-top:6px;margin-bottom:2px;';
        dayLabel2.textContent = '本日 チーム合算';
        monthCard.appendChild(dayLabel2);
        var dayVal = document.createElement('div');
        dayVal.style.cssText = 'font-size:0.95rem;font-weight:600;color:#333;';
        dayVal.textContent = '¥' + dayMemberSum.toLocaleString();
        monthCard.appendChild(dayVal);

        side.appendChild(monthCard);

        // チームメンバー内訳
        var listTitle = document.createElement('div');
        listTitle.style.cssText = 'font-size:0.75rem;color:#999;margin:12px 0 6px;';
        listTitle.textContent = 'メンバー別（第' + currentWeekNum + '週）';
        side.appendChild(listTitle);

        teamMembers.forEach(function(mn) {
            var wt = weeklyTargetsData.find(function(t) {
                return t.member_name === mn && t.year_month === ym && parseInt(t.week_number) === currentWeekNum;
            });
            var wVal = wt ? (parseInt(wt.amount_target) || 0) : 0;
            var isSelf = mn === memberName;

            var mRow = document.createElement('div');
            mRow.style.cssText = 'display:flex;justify-content:space-between;padding:4px 8px;border-radius:4px;font-size:0.8rem;' + (isSelf ? 'background:#eef4ff;font-weight:600;' : '');

            var mName = document.createElement('span');
            mName.textContent = displayName(mn) + (isSelf ? ' ◀' : '');
            mRow.appendChild(mName);

            var mVal = document.createElement('span');
            mVal.style.cssText = 'font-weight:600;color:#333;';
            mVal.textContent = wVal > 0 ? '¥' + wVal.toLocaleString() : '-';
            mRow.appendChild(mVal);

            side.appendChild(mRow);
        });

        wrapper.appendChild(side);
    }

    container.appendChild(wrapper);
}

function getWeeksOfMonth(year, month) {
    var weeks = [];
    var weekNum = 1;
    var d = 1;
    var lastDay = new Date(year, month, 0).getDate();

    while (d <= lastDay) {
        var startD = d;
        var dt = new Date(year, month - 1, d);
        // 週末をスキップして最初の営業日を見つける
        while (d <= lastDay && (new Date(year, month - 1, d).getDay() === 0 || new Date(year, month - 1, d).getDay() === 6)) d++;
        if (d > lastDay) break;
        var weekStart = d;
        // 金曜日まで or 月末まで
        while (d <= lastDay && new Date(year, month - 1, d).getDay() !== 0 && new Date(year, month - 1, d).getDay() !== 6) d++;
        var weekEnd = d - 1;
        if (weekStart <= lastDay) {
            weeks.push({ num: weekNum, startDay: weekStart, endDay: Math.min(weekEnd, lastDay) });
            weekNum++;
        }
        // 次の月曜日へ
        while (d <= lastDay && (new Date(year, month - 1, d).getDay() === 0 || new Date(year, month - 1, d).getDay() === 6)) d++;
    }
    return weeks;
}

async function saveDWTargets() {
    var ym = document.getElementById('filterMonth').value;
    var memberName = document.getElementById('dwTargetMember')?.value;
    if (!memberName) return;

    var parts = ym.split('-');
    var year = parseInt(parts[0]);
    var month = parseInt(parts[1]);
    var msgEl = document.getElementById('dwTargetMessage');

    try {
        // 週別保存
        var weeks = getWeeksOfMonth(year, month);
        for (var i = 0; i < weeks.length; i++) {
            var w = weeks[i];
            var input = document.getElementById('dwWeek_' + w.num);
            var val = input ? parseNum(input.value) : 0;
            var weekStart = ym + '-' + String(w.startDay).padStart(2, '0');
            var weekEnd = ym + '-' + String(w.endDay).padStart(2, '0');
            await executeTurso(
                "INSERT INTO weekly_targets (id, member_name, year_month, week_number, week_start, week_end, amount_target) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?) ON CONFLICT(member_name, year_month, week_number) DO UPDATE SET amount_target=excluded.amount_target, week_start=excluded.week_start, week_end=excluded.week_end",
                [memberName, ym, w.num, weekStart, weekEnd, val]
            );
        }

        // 日別保存
        var lastDay = new Date(year, month, 0).getDate();
        for (var d = 1; d <= lastDay; d++) {
            var dt = new Date(year, month - 1, d);
            if (dt.getDay() === 0 || dt.getDay() === 6) continue;
            var ds = ym + '-' + String(d).padStart(2, '0');
            if (holidaysSet.has(ds)) continue;
            var input = document.getElementById('dwDay_' + ds);
            var val = input ? parseNum(input.value) : 0;
            await executeTurso(
                "INSERT INTO daily_targets (id, member_name, target_date, appointment_amount_target) VALUES (lower(hex(randomblob(16))), ?, ?, ?) ON CONFLICT(member_name, target_date) DO UPDATE SET appointment_amount_target=excluded.appointment_amount_target",
                [memberName, ds, val]
            );
        }

        showToast(displayName(memberName) + ' の日別・週別目標を保存しました');
        // リロード
        await loadMonthData();
    } catch (e) {
        showToast('保存エラー: ' + e.message, true);
    }
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
        // 全体目標(total/all) は「月別 総目標金額」セクションで独立管理するため、
        // チーム/メンバー合計による上書きは行わない。

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

async function upsertTarget(type, name, ym, amount, execAmount, landingAmount) {
    await executeTurso(
        `INSERT INTO targets (id, target_type, target_name, year_month, appointment_amount_target, execution_target, landing_amount_target)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?)
         ON CONFLICT(target_type, target_name, year_month)
         DO UPDATE SET appointment_amount_target = excluded.appointment_amount_target,
                       execution_target = excluded.execution_target,
                       landing_amount_target = excluded.landing_amount_target`,
        [type, name, ym, amount, execAmount || 0, landingAmount || 0]
    );
}

// 月別 総目標金額(全社合計) — targets(total, all, YYYY-MM) を月単位で編集
function renderMonthlyTotalTargets() {
    const tbody = document.getElementById('monthlyTargetBody');
    if (!tbody) return;

    // 月リスト: 翌月 / 当月 / 前月 / 前々月 の4ヶ月（直近が上）
    const today = new Date();
    const months = [];
    let y = today.getFullYear();
    let m = today.getMonth() + 2; // 翌月から開始
    if (m > 12) { m -= 12; y += 1; }
    for (let i = 0; i < 4; i++) {
        if (m < 1) { m += 12; y -= 1; }
        months.push(y + '-' + String(m).padStart(2, '0'));
        m--;
    }

    tbody.textContent = '';
    months.forEach(ym => {
        const t = getTarget('total', 'all', ym);
        const acqVal = t ? (parseInt(t.appointment_amount_target) || 0) : 0;
        const execVal = t ? (parseInt(t.execution_target) || 0) : 0;
        const landingVal = t ? (parseInt(t.landing_amount_target) || 0) : 0;

        const tr = document.createElement('tr');

        const tdYm = document.createElement('td');
        tdYm.textContent = ym;
        tdYm.style.fontWeight = '500';
        tr.appendChild(tdYm);

        const tdAcq = document.createElement('td');
        const acqInput = document.createElement('input');
        acqInput.id = `mtt_acq_${ym}`;
        acqInput.value = acqVal;
        acqInput.className = 'num-input';
        acqInput.style.maxWidth = '180px';
        attachThousandSeparator(acqInput, { runFormatNow: true });
        tdAcq.appendChild(acqInput);
        tr.appendChild(tdAcq);

        const tdExec = document.createElement('td');
        const execInput = document.createElement('input');
        execInput.id = `mtt_exec_${ym}`;
        execInput.value = execVal;
        execInput.className = 'num-input';
        execInput.style.maxWidth = '180px';
        attachThousandSeparator(execInput, { runFormatNow: true });
        tdExec.appendChild(execInput);
        tr.appendChild(tdExec);

        const tdLanding = document.createElement('td');
        const landingInput = document.createElement('input');
        landingInput.id = `mtt_landing_${ym}`;
        landingInput.value = landingVal;
        landingInput.className = 'num-input';
        landingInput.style.maxWidth = '180px';
        attachThousandSeparator(landingInput, { runFormatNow: true });
        tdLanding.appendChild(landingInput);
        tr.appendChild(tdLanding);

        const tdBtn = document.createElement('td');
        const btn = document.createElement('button');
        btn.className = 'status-btn';
        btn.textContent = '保存';
        btn.onclick = () => saveMonthlyTotalTarget(ym, btn);
        tdBtn.appendChild(btn);
        tr.appendChild(tdBtn);

        tbody.appendChild(tr);
    });
}

async function saveMonthlyTotalTarget(ym, btn) {
    const msg = document.getElementById('monthlyTargetMessage');
    const acqEl = document.getElementById(`mtt_acq_${ym}`);
    const execEl = document.getElementById(`mtt_exec_${ym}`);
    const landingEl = document.getElementById(`mtt_landing_${ym}`);
    if (!acqEl || !execEl) return;

    const acqVal = parseNum(acqEl.value);
    const execVal = parseNum(execEl.value);
    const landingVal = landingEl ? parseNum(landingEl.value) : 0;

    try {
        await upsertTarget('total', 'all', ym, acqVal, execVal, landingVal);
        // 目標再読み込み(現在表示中の月分)
        const curYm = document.getElementById('filterMonth').value;
        targetsData = await queryTurso("SELECT * FROM targets WHERE year_month = ?", [curYm]);
        // 月別推移用の全月キャッシュも更新
        if (typeof monthlyTotalTargets === 'object' && monthlyTotalTargets) {
            monthlyTotalTargets[ym] = acqVal;
        }

        if (msg) {
            msg.className = 'settings-message success';
            msg.textContent = `${ym} の総目標金額を保存しました。`;
            msg.style.display = 'block';
            setTimeout(() => { msg.style.display = 'none'; }, 3000);
        }
        showToast(`${ym} 総目標を保存しました`);
        setSaveBtnState(btn, true);

        renderAll();
    } catch (error) {
        if (msg) {
            msg.className = 'settings-message error';
            msg.textContent = '保存に失敗しました: ' + error.message;
            msg.style.display = 'block';
        }
        showToast('保存に失敗しました: ' + error.message, true);
    }
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
            document.getElementById('projFormStatus').value = p.status === 'inactive' ? 'inactive' : 'active';
            const plans = getPlansForProject(editingProjectId);
            renderProjectPlanRows(plans.length > 0 ? plans : [{ unit_price: 0, monthly_cap_count: 0 }]);
        }
    } else {
        document.getElementById('projFormName').value = '';
        document.getElementById('projFormStatus').value = 'active';
        renderProjectPlanRows([{ unit_price: 0, monthly_cap_count: 0 }]);
    }
}

// プラン行を一括で描画 (plans は project_plans の行配列 or 編集中の状態)
function renderProjectPlanRows(plans) {
    const list = document.getElementById('projFormPlansList');
    if (!list) return;
    list.innerHTML = '';
    plans.forEach((plan, idx) => list.appendChild(buildProjectPlanRow(plan, idx)));
}

function buildProjectPlanRow(plan, idx) {
    const row = document.createElement('div');
    row.className = 'proj-plan-row';
    row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr 32px;gap:8px;margin-bottom:6px;align-items:center;';

    const price = document.createElement('input');
    price.placeholder = '例: 25,000';
    price.value = plan.unit_price != null ? plan.unit_price : '';
    price.className = 'proj-plan-price';

    const count = document.createElement('input');
    count.placeholder = '例: 10';
    count.value = plan.monthly_cap_count != null ? plan.monthly_cap_count : '';
    count.className = 'proj-plan-count';

    const amount = document.createElement('input');
    amount.readOnly = true;
    amount.tabIndex = -1;
    amount.className = 'proj-plan-amount';

    const recalcAmount = () => {
        const u = parseNum(price.value);
        const c = parseNum(count.value);
        amount.value = fmtNum(u * c);
    };
    attachThousandSeparator(price, { runFormatNow: true });
    attachThousandSeparator(count, { runFormatNow: true });
    price.addEventListener('input', recalcAmount);
    count.addEventListener('input', recalcAmount);
    recalcAmount();

    const del = document.createElement('button');
    del.type = 'button'; del.className = 'status-btn';
    del.title = 'プランを削除';
    del.style.cssText = 'padding:4px 6px;line-height:1;color:var(--text-light);border-color:var(--border-color);';
    del.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
    del.addEventListener('click', () => {
        const list = document.getElementById('projFormPlansList');
        if (list && list.children.length > 1) row.remove();
    });

    row.appendChild(price);
    row.appendChild(count);
    row.appendChild(amount);
    row.appendChild(del);
    return row;
}

function addProjectPlanRow() {
    const list = document.getElementById('projFormPlansList');
    if (!list) return;
    list.appendChild(buildProjectPlanRow({ unit_price: 0, monthly_cap_count: 0 }, list.children.length));
}

// モーダルから現在のプラン入力を読み出す
function collectProjectPlanInputs() {
    const list = document.getElementById('projFormPlansList');
    if (!list) return [];
    const rows = [...list.querySelectorAll('.proj-plan-row')];
    return rows.map((row, idx) => {
        const u = parseNum(row.querySelector('.proj-plan-price').value);
        const c = parseNum(row.querySelector('.proj-plan-count').value);
        return {
            plan_order: idx + 1,
            unit_price: u,
            monthly_cap_count: c,
            monthly_cap_amount: u * c
        };
    }).filter(p => p.unit_price > 0 || p.monthly_cap_count > 0); // 空行は捨てる
}

function closeProjectForm() {
    document.getElementById('projectFormModal').classList.add('hidden');
    editingProjectId = null;
}

async function submitProjectForm() {
    const name = document.getElementById('projFormName').value;
    if (!name) return;

    try {
        const status = document.getElementById('projFormStatus').value === 'inactive' ? 'inactive' : 'active';
        const plans = collectProjectPlanInputs();
        // 代表値 (他画面互換用): 単価=先頭プラン / キャップ数・金額=合計
        const repUnitPrice = plans[0] ? plans[0].unit_price : 0;
        const sumCapCount = plans.reduce((s, p) => s + (p.monthly_cap_count || 0), 0);
        const sumCapAmount = plans.reduce((s, p) => s + (p.monthly_cap_amount || 0), 0);

        let projectId = editingProjectId;
        if (editingProjectId) {
            // 顧客名 / 架電リストURL の DB カラムは温存 (UI のみ削除) → UPDATE 文に含めない
            await executeTurso(
                `UPDATE projects SET project_name = ?, unit_price = ?, monthly_cap_count = ?, monthly_cap_amount = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
                [name, repUnitPrice, sumCapCount || null, sumCapAmount || null, status, editingProjectId]
            );
            showToast('案件を更新しました');
        } else {
            // 新規 INSERT 時に id を生成しておく (後で project_plans に紐づけるため)
            projectId = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36);
            await executeTurso(
                `INSERT INTO projects (id, project_name, unit_price, monthly_cap_count, monthly_cap_amount, status)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [projectId, name, repUnitPrice, sumCapCount || null, sumCapAmount || null, status]
            );
            showToast('案件を追加しました');
        }

        // プランを全置換 (シンプル方式)
        await executeTurso("DELETE FROM project_plans WHERE project_id = ?", [projectId]);
        for (const p of plans) {
            await executeTurso(
                `INSERT INTO project_plans (id, project_id, plan_order, unit_price, monthly_cap_count, monthly_cap_amount)
                 VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?)`,
                [projectId, p.plan_order, p.unit_price, p.monthly_cap_count, p.monthly_cap_amount]
            );
        }

        closeProjectForm();
        projectsData = stripExcludedProjects(await queryTurso("SELECT * FROM projects WHERE status IN ('active','inactive') ORDER BY project_name"));
        projectPlansData = await queryTurso("SELECT * FROM project_plans ORDER BY project_id, plan_order").catch(() => []);
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
        membersData = await queryTurso("SELECT * FROM members WHERE status IN ('active','inactive') AND (deleted_at IS NULL) ORDER BY (status='active') DESC, team_name, member_name");
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
        membersData = await queryTurso("SELECT * FROM members WHERE status IN ('active','inactive') AND (deleted_at IS NULL) ORDER BY (status='active') DESC, team_name, member_name");
        populateMemberFilter();
        renderSettings();
    } catch (error) {
        alert('ステータス変更に失敗しました: ' + error.message);
    }
}

// ==================== チーム管理 ====================
let editingTeamId = null;
// チーム編集モーダル: メンバーの保留状態 (保存ボタンで DB 反映、キャンセルで破棄)
let teamFormPendingMemberIds = [];  // モーダル上の「所属メンバー」最新状態 (member.id の配列)
let teamFormOriginalMemberIds = []; // モーダルを開いた時点のスナップショット (差分計算用)

function openTeamForm(teamId) {
    editingTeamId = teamId || null;
    document.getElementById('teamFormModal').classList.remove('hidden');
    document.getElementById('teamFormTitle').textContent = editingTeamId ? 'チーム編集' : 'チーム追加';

    // リーダー select の選択肢を「active メンバー」で構築
    const leaderSel = document.getElementById('teamFormLeader');
    const activeMembers = membersData
        .filter(m => m.status === 'active')
        .sort((a, b) => String(a.member_name || '').localeCompare(String(b.member_name || ''), 'ja'));
    leaderSel.innerHTML = '<option value="">（未選択）</option>' +
        activeMembers.map(m => `<option value="${m.member_name}">${displayName(m.member_name)}</option>`).join('');

    let currentTeamName = '';
    if (editingTeamId) {
        const t = teamsData.find(x => x.id === editingTeamId);
        if (t) {
            currentTeamName = t.team_name || '';
            document.getElementById('teamFormName').value = currentTeamName;
            const leaderCanon = t.leader_name ? normalizeMemberName(t.leader_name) : '';
            leaderSel.value = leaderCanon && activeMembers.some(m => m.member_name === leaderCanon) ? leaderCanon : '';
            document.getElementById('teamFormStatus').value = t.status === 'inactive' ? 'inactive' : 'active';
        }
        document.getElementById('teamFormMembersSection').style.display = '';
        // 現在の所属メンバーをスナップショット & 編集中の保留状態にコピー
        teamFormOriginalMemberIds = membersData
            .filter(m => m.status === 'active' && m.team_name === currentTeamName)
            .map(m => m.id);
        teamFormPendingMemberIds = [...teamFormOriginalMemberIds];
        renderTeamMemberChips(currentTeamName);
    } else {
        document.getElementById('teamFormName').value = '';
        leaderSel.value = '';
        document.getElementById('teamFormStatus').value = 'active';
        document.getElementById('teamFormMembersSection').style.display = 'none';
        teamFormOriginalMemberIds = [];
        teamFormPendingMemberIds = [];
    }

    // モーダル内 select もカスタム化 (検索可能 dropdown)
    rebuildCustomSelect('teamFormLeader');
}

// チーム編集モーダル: 所属メンバーをチップ表示 + 追加 dropdown を再構築
// 保存ボタンが押されるまでは DB に書き込まない (保留状態のみ更新)
function renderTeamMemberChips(teamName) {
    const chipsEl = document.getElementById('teamFormMemberChips');
    const addSel = document.getElementById('teamFormAddMember');
    if (!chipsEl || !addSel) return;

    const pendingIds = new Set(teamFormPendingMemberIds);
    const belongs = membersData
        .filter(m => m.status === 'active' && pendingIds.has(m.id))
        .sort((a, b) => String(a.member_name || '').localeCompare(String(b.member_name || ''), 'ja'));

    chipsEl.innerHTML = belongs.length === 0
        ? '<span style="color:var(--text-light);font-size:0.8rem;">(所属メンバーなし)</span>'
        : belongs.map(m => `
            <span style="display:inline-flex;align-items:center;gap:6px;background:var(--blue-50,#e9eefb);color:var(--primary-blue,#3b6cf0);font-size:0.82rem;padding:4px 6px 4px 10px;border-radius:14px;">
                ${displayName(m.member_name)}
                <button type="button" title="このチームから外す（保存で確定）" onclick="removeMemberFromTeam('${m.id}', '${escapeHtml(teamName)}')" style="background:transparent;border:none;color:inherit;cursor:pointer;font-size:0.95rem;line-height:1;padding:0 2px;">×</button>
            </span>
        `).join('');

    // 追加 dropdown: 現在の保留チップに居ない active メンバー
    const candidates = membersData
        .filter(m => m.status === 'active' && !pendingIds.has(m.id))
        .sort((a, b) => String(a.member_name || '').localeCompare(String(b.member_name || ''), 'ja'));
    addSel.innerHTML = '<option value="">＋ メンバー追加</option>' +
        candidates.map(m => `<option value="${m.id}">${displayName(m.member_name)} ｜ ${m.team_name}</option>`).join('');
    addSel.onchange = () => {
        const id = addSel.value;
        if (!id) return;
        addMemberToTeam(id, teamName);
    };
    rebuildCustomSelect('teamFormAddMember');
}

// 保留リストに追加 (DB 書き込みは保存時)
function addMemberToTeam(memberId, teamName) {
    if (!teamFormPendingMemberIds.includes(memberId)) {
        teamFormPendingMemberIds.push(memberId);
    }
    renderTeamMemberChips(teamName);
}

// 保留リストから除去 (DB 書き込みは保存時)
function removeMemberFromTeam(memberId, teamName) {
    teamFormPendingMemberIds = teamFormPendingMemberIds.filter(id => id !== memberId);
    renderTeamMemberChips(teamName);
}

function closeTeamForm() {
    document.getElementById('teamFormModal').classList.add('hidden');
    editingTeamId = null;
    // 保留中の変更は破棄
    teamFormPendingMemberIds = [];
    teamFormOriginalMemberIds = [];
}

async function submitTeamForm() {
    const name = document.getElementById('teamFormName').value.trim();
    if (!name) return;
    const leader = document.getElementById('teamFormLeader').value.trim() || null;
    const status = document.getElementById('teamFormStatus').value === 'inactive' ? 'inactive' : 'active';
    try {
        if (editingTeamId) {
            await executeTurso(
                "UPDATE teams SET team_name = ?, leader_name = ?, status = ? WHERE id = ?",
                [name, leader, status, editingTeamId]
            );

            // 所属メンバーの差分を一括反映
            const original = new Set(teamFormOriginalMemberIds);
            const pending = new Set(teamFormPendingMemberIds);
            const removed = [...original].filter(id => !pending.has(id));
            const added = [...pending].filter(id => !original.has(id));
            for (const id of removed) {
                await executeTurso("UPDATE members SET team_name = ? WHERE id = ?", ['未所属', id]);
                const m = membersData.find(x => x.id === id);
                if (m) m.team_name = '未所属';
            }
            for (const id of added) {
                await executeTurso("UPDATE members SET team_name = ? WHERE id = ?", [name, id]);
                const m = membersData.find(x => x.id === id);
                if (m) m.team_name = name;
            }

            showToast('チームを更新しました');
        } else {
            await executeTurso(
                "INSERT INTO teams (team_name, leader_name, status) VALUES (?, ?, ?)",
                [name, leader, status]
            );
            showToast('チームを追加しました');
        }
        closeTeamForm();
        teamsData = await queryTurso("SELECT * FROM teams WHERE status IN ('active','inactive')");
        populateTeamFilter();
        populateMemberFilter();
        renderSettings();
    } catch (error) {
        alert('チーム保存に失敗しました: ' + error.message);
    }
}

async function deleteTeam(id) {
    const t = teamsData.find(x => x.id === id);
    if (!t) return;
    // active メンバーが残っているチームは削除させない
    const activeMembersInTeam = membersData.filter(m => m.team_name === t.team_name && m.status === 'active');
    if (activeMembersInTeam.length > 0) {
        alert(`このチームには active メンバーが ${activeMembersInTeam.length} 名います。\n先にメンバーを別チームへ移動するか、無効化・削除してください。`);
        return;
    }
    if (!confirm(`チーム「${t.team_name}」を削除します。\nよろしいですか？`)) return;
    try {
        await executeTurso("DELETE FROM teams WHERE id = ?", [id]);
        teamsData = await queryTurso("SELECT * FROM teams WHERE status IN ('active','inactive')");
        populateTeamFilter();
        renderSettings();
        showToast('チームを削除しました');
    } catch (error) {
        alert('チーム削除に失敗しました: ' + error.message);
    }
}

async function toggleTeamStatus(id, newStatus) {
    try {
        await executeTurso("UPDATE teams SET status = ? WHERE id = ?", [newStatus, id]);
        teamsData = await queryTurso("SELECT * FROM teams WHERE status IN ('active','inactive')");
        populateTeamFilter();
        renderSettings();
    } catch (error) {
        alert('チームステータス変更に失敗しました: ' + error.message);
    }
}

// メンバー削除 (soft delete: deleted_at マーキング)
async function deleteMember(id) {
    const m = membersData.find(x => x.id === id);
    const name = m ? displayName(m.member_name) : '';
    if (!confirm(`メンバー「${name}」を削除します。\n画面・集計から完全に除外されますが、DBにはデータは残ります。\nよろしいですか？`)) return;
    try {
        await executeTurso("UPDATE members SET deleted_at = datetime('now') WHERE id = ?", [id]);
        membersData = await queryTurso("SELECT * FROM members WHERE status IN ('active','inactive') AND (deleted_at IS NULL) ORDER BY (status='active') DESC, team_name, member_name");
        populateMemberFilter();
        renderSettings();
        showToast('メンバーを削除しました');
    } catch (error) {
        alert('削除に失敗しました: ' + error.message);
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

    // タブごとのフィルター表示制御
    // 朝礼: 全フィルター非表示 / 経営: 月のみ表示 / その他: 全表示
    const filters = document.getElementById('globalFilters');
    const teamGroup = document.getElementById('filterTeam')?.closest('.filter-group');
    const memberGroup = document.getElementById('filterMember')?.closest('.filter-group');
    if (filters) {
        if (tab === 'morning') {
            filters.style.display = 'none';
        } else if (tab === 'management') {
            filters.style.display = 'flex';
            if (teamGroup) teamGroup.style.display = 'none';
            if (memberGroup) memberGroup.style.display = 'none';
        } else if (tab === 'appointments') {
            // アポ確認タブは独自の日付範囲フィルターを使うため、上部グローバルは隠す
            filters.style.display = 'none';
        } else {
            filters.style.display = 'flex';
            if (teamGroup) teamGroup.style.display = '';
            if (memberGroup) memberGroup.style.display = '';
        }
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

// 翌月 ym（YYYY-MM 形式）
function getNextYM(ym) {
    const [y, m] = ym.split('-').map(Number);
    if (m === 12) return `${y + 1}-01`;
    return `${y}-${String(m + 1).padStart(2, '0')}`;
}

// 前月 ym（YYYY-MM 形式）
function getPrevYM(ym) {
    const [y, m] = ym.split('-').map(Number);
    if (m === 1) return `${y - 1}-12`;
    return `${y}-${String(m - 1).padStart(2, '0')}`;
}

// 指定月の N 営業日目の日付(YYYY-MM-DD)を返す
// （N=現在月で経過した営業日数 → 前月の同じ営業日インデックスに対応する日付）
function getNthBusinessDay(ym, n) {
    if (n <= 0) return null;
    const [y, m] = ym.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    let count = 0;
    for (let d = 1; d <= lastDay; d++) {
        const date = new Date(y, m - 1, d);
        const dateStr = formatDate(date);
        const dow = date.getDay();
        if (dow === 0 || dow === 6 || holidaysSet.has(dateStr)) continue;
        count++;
        if (count === n) return dateStr;
    }
    // n が当該月の総営業日を超える場合は月末営業日を返す
    return null;
}

// 指定月の全体KPIをまとめて算出（KPIカード用）
// 前月比較のため、当月で経過した営業日数 N と同じだけ前月の冒頭から N 営業日分のデータと比較する
function computeMonthKpis(ym) {
    const currentYM = (typeof document !== 'undefined' && document.getElementById('filterMonth')) ? document.getElementById('filterMonth').value : ym;
    // 当月以外（=前月）はloadMonthDataで別取得した軽量データを使う
    const isPrev = ym !== currentYM;
    const perfSrc = isPrev ? prevPerformanceData : performanceData;
    const appoSrc = isPrev ? prevAppointmentsData : appointmentsData;
    const execSrc = isPrev ? prevExecutionAppoData : executionAppoData;
    const excluded = getExcludedMembers(ym);

    // 営業日カットオフ: 前月データを当月経過営業日数まで切り詰める
    let cutoff = null;
    if (isPrev) {
        const elapsed = getBusinessDays(currentYM).elapsed;
        if (elapsed > 0) cutoff = getNthBusinessDay(ym, elapsed);
    }
    const inRange = (dateStr) => !cutoff || (dateStr && dateStr <= cutoff);

    const perf = perfSrc.filter(d => !excluded.includes(d.member_name) && d.input_date && d.input_date.startsWith(ym) && inRange(d.input_date));
    const appo = appoSrc.filter(d => !excluded.includes(d.member_name) && d.acquisition_date && d.acquisition_date.startsWith(ym) && inRange(d.acquisition_date));
    const execAppo = execSrc.filter(d => !excluded.includes(d.member_name) && d.scheduled_date && d.scheduled_date.startsWith(ym) && inRange(d.scheduled_date));

    const calls = sum(perf, 'call_count');
    const pr = sum(perf, 'pr_count');
    const appoCnt = sum(perf, 'appointment_count');
    const acqAmount = appo.reduce((s, a) => s + (a.amount || 0), 0);

    const callToAppo = calls > 0 ? appoCnt / calls * 100 : 0;
    const prToAppo = pr > 0 ? appoCnt / pr * 100 : 0;
    const callToPr = calls > 0 ? pr / calls * 100 : 0;
    const avgUnit = appo.length > 0 ? Math.round(acqAmount / appo.length) : 0;
    const withinMonth = appo.filter(a => a.scheduled_date && a.scheduled_date.startsWith(ym)).length;
    const withinMonthRate = appo.length > 0 ? withinMonth / appo.length * 100 : 0;

    const execTotal = execAppo.length;
    const execCancel = execAppo.filter(a => a.status === 'キャンセル').length;
    const execConfirmed = execAppo.filter(a => a.status === '実施').length;
    const cancelRate = execTotal > 0 ? execCancel / execTotal * 100 : 0;
    const confirmRate = execTotal > 0 ? execConfirmed / execTotal * 100 : 0;

    const hours = sum(perf, 'call_hours');
    const memberDays = (() => {
        const md = {};
        perf.forEach(r => { if (!md[r.member_name]) md[r.member_name] = new Set(); md[r.member_name].add(r.input_date); });
        return Object.values(md).reduce((s, set) => s + set.size, 0);
    })();
    const callsPerHour = hours > 0 ? calls / hours : 0;
    const callsPerDay = memberDays > 0 ? calls / memberDays : 0;
    const hoursPerDay = memberDays > 0 ? hours / memberDays : 0;

    return { calls, pr, appoCnt, callToAppo, prToAppo, callToPr, avgUnit, withinMonthRate, cancelRate, confirmRate, callsPerHour, callsPerDay, hoursPerDay };
}

// 前月比表示用の小タグHTML（差分・矢印）
function kpiPrevTag(prev, fmt, opts = {}) {
    const { invert = false, isPct = false, suffix = '' } = opts;
    if (prev === null || prev === undefined || (typeof prev === 'number' && !isFinite(prev))) {
        return `<div class="mgmt-kpi-prev">前月 -</div>`;
    }
    return `<div class="mgmt-kpi-prev">前月 ${fmt(prev)}${suffix}</div>`;
}

// 増減記号（カレント vs 前月） — invert: 大きい方が悪い指標(キャンセル率など)
function kpiDiffBadge(curr, prev, opts = {}) {
    const { invert = false, isPct = false, fmt = (v) => v.toFixed(1), suffix = '' } = opts;
    if (prev === null || prev === undefined || !isFinite(prev) || prev === 0 && curr === 0) {
        return '';
    }
    const diff = curr - prev;
    const up = diff > 0;
    const eq = Math.abs(diff) < 0.01;
    if (eq) return `<span class="mgmt-kpi-diff" style="color:#999;">±0</span>`;
    const good = invert ? !up : up;
    const color = good ? '#5e7eb4' : '#c0392b';
    const arrow = up ? '▲' : '▼';
    const sign = up ? '+' : '';
    return `<span class="mgmt-kpi-diff" style="color:${color};">${arrow} ${sign}${fmt(diff)}${suffix}</span>`;
}

function pct(value, target) {
    return target > 0 ? Math.round(value / target * 1000) / 10 : 0;
}

function getTarget(type, name, ym) {
    return targetsData.find(t => t.target_type === type && t.target_name === name && t.year_month === ym);
}

function getBusinessDays(ym) {
    const [y, m] = ym.split('-').map(Number);
    // 経過営業日は前日までをカウント（標準進捗を前日基準で表示）
    const today = new Date();
    today.setHours(0, 0, 0, 0);
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
        if (date < today) elapsed++;
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

// ==================== 名前マッピング管理 ====================
let mappingsData = [];
let editingMappingId = null;

async function loadMappings() {
    try {
        mappingsData = await queryTurso('SELECT * FROM member_name_mappings ORDER BY canonical_name, raw_name');
        renderMappingsTable();
    } catch (e) {
        console.error('マッピング読み込みエラー:', e);
    }
}

function renderMappingsTable() {
    const tbody = document.getElementById('mappingTableBody');
    if (!tbody) return;
    const search = (document.getElementById('mappingSearchInput')?.value || '').toLowerCase();
    const filtered = search
        ? mappingsData.filter(m => m.raw_name.toLowerCase().includes(search) || m.canonical_name.toLowerCase().includes(search))
        : mappingsData;

    tbody.textContent = '';
    if (filtered.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 3;
        td.style.textAlign = 'center';
        td.style.color = 'var(--text-light)';
        td.style.padding = '24px';
        td.textContent = 'データなし';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }
    filtered.forEach(m => {
        const tr = document.createElement('tr');
        const tdRaw = document.createElement('td');
        tdRaw.textContent = m.raw_name;
        const tdCanon = document.createElement('td');
        const strong = document.createElement('strong');
        strong.textContent = m.canonical_name;
        tdCanon.appendChild(strong);
        const tdAction = document.createElement('td');
        const btnEdit = document.createElement('button');
        btnEdit.className = 'btn-small';
        btnEdit.textContent = '編集';
        btnEdit.onclick = () => openMappingForm(m.id);
        const btnDel = document.createElement('button');
        btnDel.className = 'btn-small btn-danger-small';
        btnDel.textContent = '削除';
        btnDel.onclick = () => deleteMapping(m.id);
        tdAction.appendChild(btnEdit);
        tdAction.appendChild(document.createTextNode(' '));
        tdAction.appendChild(btnDel);
        tr.appendChild(tdRaw);
        tr.appendChild(tdCanon);
        tr.appendChild(tdAction);
        tbody.appendChild(tr);
    });
}

function filterMappingsTable() {
    renderMappingsTable();
}

function openMappingForm(id) {
    editingMappingId = id || null;
    const modal = document.getElementById('mappingFormModal');
    const title = document.getElementById('mappingFormTitle');
    const rawInput = document.getElementById('mappingFormRawName');
    const canonSelect = document.getElementById('mappingFormCanonical');

    canonSelect.textContent = '';
    membersData.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.member_name;
        opt.textContent = m.member_name;
        canonSelect.appendChild(opt);
    });

    if (id) {
        const mapping = mappingsData.find(x => x.id === id);
        if (mapping) {
            title.textContent = 'マッピング編集';
            rawInput.value = mapping.raw_name;
            canonSelect.value = mapping.canonical_name;
            rawInput.readOnly = true;
        }
    } else {
        title.textContent = '新規マッピング追加';
        rawInput.value = '';
        rawInput.readOnly = false;
        if (canonSelect.options.length > 0) canonSelect.selectedIndex = 0;
    }
    modal.classList.remove('hidden');
}

function closeMappingForm() {
    document.getElementById('mappingFormModal').classList.add('hidden');
    editingMappingId = null;
}

async function submitMappingForm() {
    const rawName = document.getElementById('mappingFormRawName').value.trim();
    const canonical = document.getElementById('mappingFormCanonical').value;
    if (!rawName || !canonical) return;

    try {
        if (editingMappingId) {
            await executeTurso('UPDATE member_name_mappings SET canonical_name = ? WHERE id = ?', [canonical, editingMappingId]);
        } else {
            await executeTurso(
                'INSERT INTO member_name_mappings (id, raw_name, canonical_name) VALUES (lower(hex(randomblob(16))), ?, ?)',
                [rawName, canonical]
            );
        }
        closeMappingForm();
        await loadMappings();
        showToast('マッピングを保存しました');
    } catch (e) {
        showToast('保存エラー: ' + e.message, true);
    }
}

async function deleteMapping(id) {
    if (!confirm('このマッピングを削除しますか？')) return;
    try {
        await executeTurso('DELETE FROM member_name_mappings WHERE id = ?', [id]);
        await loadMappings();
        showToast('マッピングを削除しました');
    } catch (e) {
        showToast('削除エラー: ' + e.message, true);
    }
}

async function migrateGASMappings() {
    if (!confirm('GASのMEMBER_NAME_MAPデータをDBに移行します。既存データと重複する場合はスキップされます。続けますか？')) return;

    const gasMap = [
        ['tanaka sota', '田中颯汰'], ['中村 峻也', '中村た'], ['中村峻也', '中村た'],
        ['田中克樹', '田中か'], ['田中颯汰', '田中颯汰'], ['宮城 啓生', '宮城'], ['宮城啓生', '宮城'],
        ['宮城一平', '宮城一平'], ['野口純', '野口'], ['野口 純', '野口'],
        ['坪井 秀斗', '坪井'], ['坪井秀斗', '坪井'], ['松居和輝', '松居'], ['松居 和輝', '松居'],
        ['村松和哉', '村松'], ['村松 和哉', '村松'], ['辻森誠也', '辻森'], ['辻森 誠也', '辻森'],
        ['山本匠太郎', '山本'], ['山本 匠太郎', '山本'], ['美除直生', '美除'], ['美除 直生', '美除'],
        ['村上夢果', '村上'], ['村上 夢果', '村上'], ['三善一樹', '三善'], ['三善 一樹', '三善'],
        ['菊池幸平', '菊池'], ['菊池 幸平', '菊池'], ['野上樹哉', '野上'], ['野上 樹哉', '野上'],
        ['池田愛', '池田'], ['池田 愛', '池田'], ['轟玲音', '轟'], ['轟 玲音', '轟'],
        ['清水陸斗', '清水'], ['清水 陸斗', '清水'], ['堀切友世', '堀切'], ['堀切 友世', '堀切'],
        ['k.matsui@digi-man.com', '松居'], ['s.tsuboi@digi-man.com', '坪井'],
        ['j.noguchi@digi-man.com', '野口'], ['a.ikeda@digi-man.com', '池田'],
        ['y.horikiri@digi-man.com', '堀切'], ['r.todoroki@digi-man.com', '轟'],
        ['k.kawakami@digi-man.com', '川上'], ['katsu.tanaka@digi-man.com', '田中か'],
        ['k.muramatsu@digi-man.com', '村松'], ['h.miyagi@digi-man.com', '宮城'],
        ['i.miyagi@digi-man.com', '宮城一平'], ['y.nakamura@digi-man.com', '中村ゆ'],
        ['t.nakamura@digi-man.com', '中村た'], ['r.shimizu@digi-man.com', '清水'],
        ['k.kikuchi@digi-man.com', '菊池'], ['k.miyoshi@digi-man.com', '三善'],
        ['y.murakami@digi-man.com', '村上'], ['s.yamamoto@digi-man.com', '山本'],
        ['s.tanaka@digi-man.com', '田中颯汰'], ['j.nogami@digi-man.com', '野上'],
        ['y.tayama@digi-man.com', '田山'],
    ];

    let success = 0, skipped = 0;
    for (const [raw, canonical] of gasMap) {
        try {
            await executeTurso(
                'INSERT OR IGNORE INTO member_name_mappings (id, raw_name, canonical_name) VALUES (lower(hex(randomblob(16))), ?, ?)',
                [raw, canonical]
            );
            success++;
        } catch (e) {
            skipped++;
        }
    }
    await loadMappings();
    showToast('GASデータ移行完了: ' + success + '件処理');
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
