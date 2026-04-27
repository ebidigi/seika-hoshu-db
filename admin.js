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

// ==================== グローバル状態 ====================

let currentSection = 'projects';
let projectsList = [];
let membersList = [];
let teamsList = [];
let assignmentsList = [];
let mappingsList = [];
let editingId = null;

// ==================== 初期化 ====================

document.addEventListener('DOMContentLoaded', async () => {
    // 月選択のデフォルト値を今月に設定
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('assignmentMonth').value = currentMonth;

    // データ読み込み
    try {
        await loadTeams();
        await Promise.all([loadProjects(), loadMembers()]);
    } catch (e) {
        console.error('初期化エラー:', e);
        showToast('データの読み込みに失敗しました', true);
    }

    // ボタンイベント
    document.getElementById('addProjectBtn').addEventListener('click', () => openProjectForm());
    document.getElementById('addMemberBtn').addEventListener('click', () => openMemberForm());
    document.getElementById('addAssignmentBtn').addEventListener('click', () => openAssignmentForm());
    document.getElementById('addMappingBtn').addEventListener('click', () => openMappingForm());
    document.getElementById('copyNextMonthBtn').addEventListener('click', copyToNextMonth);
    document.getElementById('gasMigrationBtn').addEventListener('click', migrateFromGAS);

    // フォーム送信ボタン
    document.getElementById('projectFormSubmit').addEventListener('click', submitProject);
    document.getElementById('memberFormSubmit').addEventListener('click', submitMember);
    document.getElementById('assignmentFormSubmit').addEventListener('click', submitAssignment);
    document.getElementById('mappingFormSubmit').addEventListener('click', submitMapping);

    // 月選択の変更イベント
    document.getElementById('assignmentMonth').addEventListener('change', loadAssignments);

    // マッピング検索
    document.getElementById('mappingSearch').addEventListener('input', renderMappingsTable);

    // モーダル背景クリックで閉じる
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.add('hidden');
            }
        });
    });
});

// ==================== セクション切替 ====================

function switchAdminSection(name) {
    currentSection = name;

    // サイドバーのアクティブ状態
    document.querySelectorAll('.sidebar-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.section === name);
    });

    // セクション表示切替
    document.querySelectorAll('.admin-section').forEach(sec => {
        sec.classList.toggle('active', sec.id === `section-${name}`);
    });

    // セクション切替時にデータ読み込み
    if (name === 'projects') loadProjects();
    else if (name === 'members') loadMembers();
    else if (name === 'assignments') loadAssignments();
    else if (name === 'mappings') loadMappings();
}

// ==================== Toast 通知 ====================

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.background = isError ? '#ef4444' : '#3b82f6';
    toast.classList.remove('hidden');
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// ==================== ユーティリティ ====================

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function buildTableRow(cells, id) {
    const tr = document.createElement('tr');
    if (id) tr.dataset.id = id;
    cells.forEach(cell => {
        const td = document.createElement('td');
        if (typeof cell === 'object' && cell.html) {
            td.innerHTML = cell.html;
            if (cell.className) td.className = cell.className;
        } else if (typeof cell === 'object' && cell.element) {
            if (cell.className) td.className = cell.className;
            td.appendChild(cell.element);
        } else {
            td.textContent = cell;
        }
        tr.appendChild(td);
    });
    return tr;
}

function createEditButton(onClickFn) {
    const btn = document.createElement('button');
    btn.className = 'btn-icon';
    btn.title = '編集';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    btn.addEventListener('click', onClickFn);
    return btn;
}

function createDeleteButton(onClickFn) {
    const btn = document.createElement('button');
    btn.className = 'btn-icon btn-icon-danger';
    btn.title = '削除';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
    btn.addEventListener('click', onClickFn);
    return btn;
}

function createDeactivateButton(onClickFn) {
    const btn = document.createElement('button');
    btn.className = 'btn-icon btn-icon-danger';
    btn.title = '無効化';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    btn.addEventListener('click', onClickFn);
    return btn;
}

function setEmptyMessage(tbody, colspan) {
    tbody.textContent = '';
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = colspan;
    td.style.cssText = 'text-align:center;color:var(--text-light);padding:2rem;';
    td.textContent = 'データがありません';
    tr.appendChild(td);
    tbody.appendChild(tr);
}

// ==================== Projects CRUD ====================

async function loadProjects() {
    try {
        projectsList = await queryTurso('SELECT * FROM projects ORDER BY status ASC, project_name ASC');
        renderProjectsTable();
    } catch (e) {
        console.error('案件読み込みエラー:', e);
        showToast('案件データの読み込みに失敗しました', true);
    }
}

function renderProjectsTable() {
    const tbody = document.getElementById('projectsTableBody');
    tbody.textContent = '';

    if (projectsList.length === 0) {
        setEmptyMessage(tbody, 6);
        return;
    }

    projectsList.forEach(p => {
        const tr = document.createElement('tr');
        tr.dataset.id = p.id;

        // 案件名
        const tdName = document.createElement('td');
        const strong = document.createElement('strong');
        strong.textContent = p.project_name;
        tdName.appendChild(strong);
        tr.appendChild(tdName);

        // 顧客名
        const tdClient = document.createElement('td');
        tdClient.textContent = p.client_name || '';
        tr.appendChild(tdClient);

        // アポ単価
        const tdPrice = document.createElement('td');
        tdPrice.className = 'text-right';
        tdPrice.textContent = p.unit_price ? `\u00a5${Number(p.unit_price).toLocaleString()}` : '-';
        tr.appendChild(tdPrice);

        // キャップ数
        const tdCap = document.createElement('td');
        tdCap.className = 'text-right';
        tdCap.textContent = p.monthly_cap_count ?? '-';
        tr.appendChild(tdCap);

        // ステータス
        const tdStatus = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = 'status-badge ' + (p.status === 'active' ? 'status-active' : 'status-inactive');
        badge.textContent = p.status;
        tdStatus.appendChild(badge);
        tr.appendChild(tdStatus);

        // 操作
        const tdActions = document.createElement('td');
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'action-buttons';
        actionsDiv.appendChild(createEditButton(() => openProjectForm(p.id)));
        if (p.status === 'active') {
            actionsDiv.appendChild(createDeactivateButton(() => deactivateProject(p.id)));
        }
        tdActions.appendChild(actionsDiv);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
    });
}

function openProjectForm(id = null) {
    editingId = id;
    const modal = document.getElementById('projectModal');
    const title = document.getElementById('projectModalTitle');

    if (id) {
        const project = projectsList.find(p => p.id === id);
        if (!project) return;
        title.textContent = '案件編集';
        document.getElementById('projectFormId').value = project.id;
        document.getElementById('projectFormName').value = project.project_name || '';
        document.getElementById('projectFormClient').value = project.client_name || '';
        document.getElementById('projectFormUnitPrice').value = project.unit_price || '';
        document.getElementById('projectFormCapCount').value = project.monthly_cap_count || '';
        document.getElementById('projectFormCapAmount').value = project.monthly_cap_amount || '';
    } else {
        title.textContent = '案件追加';
        document.getElementById('projectFormId').value = '';
        document.getElementById('projectForm').reset();
    }

    modal.classList.remove('hidden');
}

async function submitProject() {
    const name = document.getElementById('projectFormName').value.trim();
    if (!name) {
        showToast('案件名は必須です', true);
        return;
    }

    const client = document.getElementById('projectFormClient').value.trim();
    const unitPrice = parseInt(document.getElementById('projectFormUnitPrice').value) || 0;
    const capCount = parseInt(document.getElementById('projectFormCapCount').value) || null;
    const capAmount = parseInt(document.getElementById('projectFormCapAmount').value) || null;

    try {
        if (editingId) {
            await executeTurso(
                `UPDATE projects SET project_name = ?, client_name = ?, unit_price = ?, monthly_cap_count = ?, monthly_cap_amount = ?, updated_at = datetime('now') WHERE id = ?`,
                [name, client, unitPrice, capCount, capAmount, editingId]
            );
            showToast('案件を更新しました');
        } else {
            await executeTurso(
                `INSERT INTO projects (id, project_name, client_name, unit_price, monthly_cap_count, monthly_cap_amount) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?)`,
                [name, client, unitPrice, capCount, capAmount]
            );
            showToast('案件を追加しました');
        }

        document.getElementById('projectModal').classList.add('hidden');
        editingId = null;
        await loadProjects();
    } catch (e) {
        console.error('案件保存エラー:', e);
        showToast('保存に失敗しました: ' + e.message, true);
    }
}

async function deactivateProject(id) {
    if (!confirm('この案件を無効化しますか？')) return;

    try {
        await executeTurso(
            `UPDATE projects SET status = 'inactive', updated_at = datetime('now') WHERE id = ?`,
            [id]
        );
        showToast('案件を無効化しました');
        await loadProjects();
    } catch (e) {
        console.error('案件無効化エラー:', e);
        showToast('無効化に失敗しました', true);
    }
}

// ==================== Members CRUD ====================

async function loadTeams() {
    try {
        teamsList = await queryTurso("SELECT * FROM teams WHERE status = 'active' ORDER BY team_name ASC");
    } catch (e) {
        console.error('チーム読み込みエラー:', e);
    }
}

async function loadMembers() {
    try {
        membersList = await queryTurso('SELECT * FROM members ORDER BY status ASC, team_name ASC, member_name ASC');
        renderMembersTable();
    } catch (e) {
        console.error('メンバー読み込みエラー:', e);
        showToast('メンバーデータの読み込みに失敗しました', true);
    }
}

function renderMembersTable() {
    const tbody = document.getElementById('membersTableBody');
    tbody.textContent = '';

    if (membersList.length === 0) {
        setEmptyMessage(tbody, 5);
        return;
    }

    membersList.forEach(m => {
        const tr = document.createElement('tr');
        tr.dataset.id = m.id;

        // メンバー名
        const tdName = document.createElement('td');
        const strong = document.createElement('strong');
        strong.textContent = m.member_name;
        tdName.appendChild(strong);
        tr.appendChild(tdName);

        // 表示名
        const tdDisplay = document.createElement('td');
        tdDisplay.textContent = m.display_name || m.member_name;
        tr.appendChild(tdDisplay);

        // チーム
        const tdTeam = document.createElement('td');
        tdTeam.textContent = m.team_name;
        tr.appendChild(tdTeam);

        // ステータス
        const tdStatus = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = 'status-badge ' + (m.status === 'active' ? 'status-active' : 'status-inactive');
        badge.style.cursor = 'pointer';
        badge.textContent = m.status;
        badge.addEventListener('click', () => toggleMemberStatus(m.id, m.status));
        tdStatus.appendChild(badge);
        tr.appendChild(tdStatus);

        // 操作
        const tdActions = document.createElement('td');
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'action-buttons';
        actionsDiv.appendChild(createEditButton(() => openMemberForm(m.id)));
        tdActions.appendChild(actionsDiv);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
    });
}

function openMemberForm(id = null) {
    editingId = id;
    const modal = document.getElementById('memberModal');
    const title = document.getElementById('memberModalTitle');
    const teamSelect = document.getElementById('memberFormTeam');

    // チーム選択肢を生成
    teamSelect.textContent = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '選択してください';
    teamSelect.appendChild(defaultOpt);
    teamsList.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.team_name;
        opt.textContent = t.team_name;
        teamSelect.appendChild(opt);
    });

    if (id) {
        const member = membersList.find(m => m.id === id);
        if (!member) return;
        title.textContent = 'メンバー編集';
        document.getElementById('memberFormId').value = member.id;
        document.getElementById('memberFormName').value = member.member_name || '';
        document.getElementById('memberFormDisplayName').value = member.display_name || '';
        teamSelect.value = member.team_name || '';
        document.getElementById('memberFormStatus').value = member.status || 'active';
    } else {
        title.textContent = 'メンバー追加';
        document.getElementById('memberFormId').value = '';
        document.getElementById('memberForm').reset();
    }

    modal.classList.remove('hidden');
}

async function submitMember() {
    const name = document.getElementById('memberFormName').value.trim();
    const team = document.getElementById('memberFormTeam').value;
    if (!name || !team) {
        showToast('メンバー名とチームは必須です', true);
        return;
    }

    const displayName = document.getElementById('memberFormDisplayName').value.trim() || null;
    const status = document.getElementById('memberFormStatus').value;

    try {
        if (editingId) {
            await executeTurso(
                'UPDATE members SET member_name = ?, display_name = ?, team_name = ?, status = ? WHERE id = ?',
                [name, displayName, team, status, editingId]
            );
            showToast('メンバーを更新しました');
        } else {
            await executeTurso(
                'INSERT INTO members (id, member_name, display_name, team_name, status) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)',
                [name, displayName, team, status]
            );
            showToast('メンバーを追加しました');
        }

        document.getElementById('memberModal').classList.add('hidden');
        editingId = null;
        await loadMembers();
    } catch (e) {
        console.error('メンバー保存エラー:', e);
        showToast('保存に失敗しました: ' + e.message, true);
    }
}

async function toggleMemberStatus(id, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    const msg = newStatus === 'inactive' ? 'このメンバーを無効化しますか？' : 'このメンバーを有効化しますか？';
    if (!confirm(msg)) return;

    try {
        await executeTurso('UPDATE members SET status = ? WHERE id = ?', [newStatus, id]);
        showToast(`ステータスを ${newStatus} に変更しました`);
        await loadMembers();
    } catch (e) {
        console.error('ステータス変更エラー:', e);
        showToast('ステータス変更に失敗しました', true);
    }
}

// ==================== Assignments CRUD ====================

async function loadAssignments() {
    const yearMonth = document.getElementById('assignmentMonth').value;
    if (!yearMonth) return;

    try {
        assignmentsList = await queryTurso(
            'SELECT * FROM project_member_assignments WHERE year_month = ? ORDER BY project_name ASC, member_name ASC',
            [yearMonth]
        );
        renderAssignmentsTable();
    } catch (e) {
        console.error('アサイン読み込みエラー:', e);
        showToast('アサインデータの読み込みに失敗しました', true);
    }
}

function renderAssignmentsTable() {
    const tbody = document.getElementById('assignmentsTableBody');
    tbody.textContent = '';

    if (assignmentsList.length === 0) {
        setEmptyMessage(tbody, 7);
        return;
    }

    assignmentsList.forEach(a => {
        const tr = document.createElement('tr');
        tr.dataset.id = a.id;

        // 案件名
        const tdProject = document.createElement('td');
        const strong = document.createElement('strong');
        strong.textContent = a.project_name;
        tdProject.appendChild(strong);
        tr.appendChild(tdProject);

        // メンバー
        const tdMember = document.createElement('td');
        tdMember.textContent = a.member_name;
        tr.appendChild(tdMember);

        // ランク
        const tdRank = document.createElement('td');
        const rankBadge = document.createElement('span');
        const rankVal = a.rank || 'C';
        rankBadge.className = 'rank-badge rank-' + rankVal.toLowerCase();
        rankBadge.textContent = rankVal;
        tdRank.appendChild(rankBadge);
        tr.appendChild(tdRank);

        // PM
        const tdPM = document.createElement('td');
        tdPM.textContent = a.pm_name || '-';
        tr.appendChild(tdPM);

        // キャップ数
        const tdCapCount = document.createElement('td');
        tdCapCount.className = 'text-right';
        tdCapCount.textContent = a.cap_count ?? '-';
        tr.appendChild(tdCapCount);

        // キャップ金額
        const tdCapAmount = document.createElement('td');
        tdCapAmount.className = 'text-right';
        tdCapAmount.textContent = a.cap_amount ? `\u00a5${Number(a.cap_amount).toLocaleString()}` : '-';
        tr.appendChild(tdCapAmount);

        // 操作
        const tdActions = document.createElement('td');
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'action-buttons';
        actionsDiv.appendChild(createEditButton(() => openAssignmentForm(a.id)));
        actionsDiv.appendChild(createDeleteButton(() => deleteAssignment(a.id)));
        tdActions.appendChild(actionsDiv);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
    });
}

function openAssignmentForm(id = null) {
    editingId = id;
    const modal = document.getElementById('assignmentModal');
    const title = document.getElementById('assignmentModalTitle');

    // 案件選択肢を生成（activeのみ）
    const projectSelect = document.getElementById('assignmentFormProject');
    projectSelect.textContent = '';
    const projDefault = document.createElement('option');
    projDefault.value = '';
    projDefault.textContent = '選択してください';
    projectSelect.appendChild(projDefault);
    projectsList.filter(p => p.status === 'active').forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.project_name;
        opt.textContent = p.project_name;
        projectSelect.appendChild(opt);
    });

    // メンバー選択肢を生成（activeのみ）
    const memberSelect = document.getElementById('assignmentFormMember');
    memberSelect.textContent = '';
    const memDefault = document.createElement('option');
    memDefault.value = '';
    memDefault.textContent = '選択してください';
    memberSelect.appendChild(memDefault);
    membersList.filter(m => m.status === 'active').forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.member_name;
        opt.textContent = m.member_name;
        memberSelect.appendChild(opt);
    });

    if (id) {
        const assignment = assignmentsList.find(a => a.id === id);
        if (!assignment) return;
        title.textContent = 'アサイン編集';
        document.getElementById('assignmentFormId').value = assignment.id;
        projectSelect.value = assignment.project_name || '';
        memberSelect.value = assignment.member_name || '';
        document.getElementById('assignmentFormRank').value = assignment.rank || 'C';
        document.getElementById('assignmentFormType').value = assignment.project_type || '成果報酬';
        document.getElementById('assignmentFormPM').value = assignment.pm_name || '';
        document.getElementById('assignmentFormCapCount').value = assignment.cap_count || '';
        document.getElementById('assignmentFormCapAmount').value = assignment.cap_amount || '';
        document.getElementById('assignmentFormTargetCount').value = assignment.target_count || '';
    } else {
        title.textContent = 'アサイン追加';
        document.getElementById('assignmentFormId').value = '';
        document.getElementById('assignmentForm').reset();
        // タイプのデフォルト値を再設定
        document.getElementById('assignmentFormType').value = '成果報酬';
    }

    modal.classList.remove('hidden');
}

async function submitAssignment() {
    const projectName = document.getElementById('assignmentFormProject').value;
    const memberName = document.getElementById('assignmentFormMember').value;
    const yearMonth = document.getElementById('assignmentMonth').value;

    if (!projectName || !memberName || !yearMonth) {
        showToast('案件、メンバー、月は必須です', true);
        return;
    }

    const rank = document.getElementById('assignmentFormRank').value.trim() || 'C';
    const projectType = document.getElementById('assignmentFormType').value || '成果報酬';
    const pmName = document.getElementById('assignmentFormPM').value.trim() || null;
    const capCount = parseInt(document.getElementById('assignmentFormCapCount').value) || 0;
    const capAmount = parseInt(document.getElementById('assignmentFormCapAmount').value) || 0;
    const targetCount = parseInt(document.getElementById('assignmentFormTargetCount').value) || 0;

    try {
        if (editingId) {
            await executeTurso(
                `UPDATE project_member_assignments SET member_name = ?, project_name = ?, year_month = ?, rank = ?, project_type = ?, pm_name = ?, cap_count = ?, cap_amount = ?, target_count = ?, updated_at = datetime('now') WHERE id = ?`,
                [memberName, projectName, yearMonth, rank, projectType, pmName, capCount, capAmount, targetCount, editingId]
            );
            showToast('アサインを更新しました');
        } else {
            await executeTurso(
                `INSERT INTO project_member_assignments (id, member_name, project_name, year_month, rank, project_type, pm_name, cap_count, cap_amount, target_count) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [memberName, projectName, yearMonth, rank, projectType, pmName, capCount, capAmount, targetCount]
            );
            showToast('アサインを追加しました');
        }

        document.getElementById('assignmentModal').classList.add('hidden');
        editingId = null;
        await loadAssignments();
    } catch (e) {
        console.error('アサイン保存エラー:', e);
        showToast('保存に失敗しました: ' + e.message, true);
    }
}

async function deleteAssignment(id) {
    if (!confirm('このアサインを削除しますか？')) return;

    try {
        await executeTurso('DELETE FROM project_member_assignments WHERE id = ?', [id]);
        showToast('アサインを削除しました');
        await loadAssignments();
    } catch (e) {
        console.error('アサイン削除エラー:', e);
        showToast('削除に失敗しました', true);
    }
}

async function copyToNextMonth() {
    const yearMonth = document.getElementById('assignmentMonth').value;
    if (!yearMonth) {
        showToast('月を選択してください', true);
        return;
    }

    // 次月を計算
    const [year, month] = yearMonth.split('-').map(Number);
    const nextDate = new Date(year, month, 1); // month is 0-indexed in Date, so passing month (1-indexed) gives next month
    const nextYearMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;

    if (!confirm(`${yearMonth} のアサインを ${nextYearMonth} にコピーしますか？\n（既存のアサインは上書きされません）`)) return;

    try {
        await executeTurso(
            `INSERT OR IGNORE INTO project_member_assignments (id, member_name, project_name, year_month, rank, project_type, pm_name, cap_count, cap_amount, target_count)
             SELECT lower(hex(randomblob(16))), member_name, project_name, ?, rank, project_type, pm_name, cap_count, cap_amount, target_count
             FROM project_member_assignments WHERE year_month = ?`,
            [nextYearMonth, yearMonth]
        );
        showToast(`${nextYearMonth} にコピーしました`);
    } catch (e) {
        console.error('次月コピーエラー:', e);
        showToast('コピーに失敗しました: ' + e.message, true);
    }
}

// ==================== Name Mappings CRUD ====================

async function loadMappings() {
    try {
        mappingsList = await queryTurso('SELECT * FROM member_name_mappings ORDER BY canonical_name ASC, raw_name ASC');
        renderMappingsTable();
    } catch (e) {
        console.error('マッピング読み込みエラー:', e);
        showToast('マッピングデータの読み込みに失敗しました', true);
    }
}

function renderMappingsTable() {
    const tbody = document.getElementById('mappingsTableBody');
    tbody.textContent = '';
    const searchQuery = (document.getElementById('mappingSearch').value || '').trim().toLowerCase();

    let filtered = mappingsList;
    if (searchQuery) {
        filtered = mappingsList.filter(m =>
            (m.raw_name || '').toLowerCase().includes(searchQuery) ||
            (m.canonical_name || '').toLowerCase().includes(searchQuery)
        );
    }

    if (filtered.length === 0) {
        setEmptyMessage(tbody, 4);
        return;
    }

    filtered.forEach(m => {
        const tr = document.createElement('tr');
        tr.dataset.id = m.id;

        // raw_name
        const tdRaw = document.createElement('td');
        const code = document.createElement('code');
        code.textContent = m.raw_name;
        tdRaw.appendChild(code);
        tr.appendChild(tdRaw);

        // canonical_name
        const tdCanonical = document.createElement('td');
        const strong = document.createElement('strong');
        strong.textContent = m.canonical_name;
        tdCanonical.appendChild(strong);
        tr.appendChild(tdCanonical);

        // 作成日
        const tdDate = document.createElement('td');
        tdDate.textContent = m.created_at || '-';
        tr.appendChild(tdDate);

        // 操作
        const tdActions = document.createElement('td');
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'action-buttons';
        actionsDiv.appendChild(createEditButton(() => openMappingForm(m.id)));
        actionsDiv.appendChild(createDeleteButton(() => deleteMapping(m.id)));
        tdActions.appendChild(actionsDiv);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
    });
}

function openMappingForm(id = null) {
    editingId = id;
    const modal = document.getElementById('mappingModal');
    const title = document.getElementById('mappingModalTitle');

    // メンバー選択肢を生成
    const canonicalSelect = document.getElementById('mappingFormCanonicalSelect');
    canonicalSelect.textContent = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'メンバーから選択...';
    canonicalSelect.appendChild(defaultOpt);

    const uniqueNames = [...new Set(membersList.map(m => m.member_name))].sort();
    uniqueNames.forEach(n => {
        const opt = document.createElement('option');
        opt.value = n;
        opt.textContent = n;
        canonicalSelect.appendChild(opt);
    });

    if (id) {
        const mapping = mappingsList.find(m => m.id === id);
        if (!mapping) return;
        title.textContent = '名前マッピング編集';
        document.getElementById('mappingFormId').value = mapping.id;
        document.getElementById('mappingFormRawName').value = mapping.raw_name || '';
        // canonical_nameがメンバーリストにあればselect、なければテキスト入力
        if (uniqueNames.includes(mapping.canonical_name)) {
            canonicalSelect.value = mapping.canonical_name;
            document.getElementById('mappingFormCanonicalText').value = '';
        } else {
            canonicalSelect.value = '';
            document.getElementById('mappingFormCanonicalText').value = mapping.canonical_name || '';
        }
    } else {
        title.textContent = '名前マッピング追加';
        document.getElementById('mappingFormId').value = '';
        document.getElementById('mappingForm').reset();
        canonicalSelect.value = '';
    }

    modal.classList.remove('hidden');
}

async function submitMapping() {
    const rawName = document.getElementById('mappingFormRawName').value.trim();
    const canonicalFromSelect = document.getElementById('mappingFormCanonicalSelect').value;
    const canonicalFromText = document.getElementById('mappingFormCanonicalText').value.trim();
    const canonicalName = canonicalFromSelect || canonicalFromText;

    if (!rawName || !canonicalName) {
        showToast('元の名前と正規名は必須です', true);
        return;
    }

    try {
        if (editingId) {
            await executeTurso(
                'UPDATE member_name_mappings SET raw_name = ?, canonical_name = ? WHERE id = ?',
                [rawName, canonicalName, editingId]
            );
            showToast('マッピングを更新しました');
        } else {
            await executeTurso(
                'INSERT INTO member_name_mappings (id, raw_name, canonical_name) VALUES (lower(hex(randomblob(16))), ?, ?)',
                [rawName, canonicalName]
            );
            showToast('マッピングを追加しました');
        }

        document.getElementById('mappingModal').classList.add('hidden');
        editingId = null;
        await loadMappings();
    } catch (e) {
        console.error('マッピング保存エラー:', e);
        showToast('保存に失敗しました: ' + e.message, true);
    }
}

async function deleteMapping(id) {
    if (!confirm('このマッピングを削除しますか？')) return;

    try {
        await executeTurso('DELETE FROM member_name_mappings WHERE id = ?', [id]);
        showToast('マッピングを削除しました');
        await loadMappings();
    } catch (e) {
        console.error('マッピング削除エラー:', e);
        showToast('削除に失敗しました', true);
    }
}

async function migrateFromGAS() {
    if (!confirm('既存データに追加されます。続けますか？')) return;

    const mappings = [
        ['tanaka sota', '田中颯汰'],
        ['中村 峻也', '中村た'],
        ['中村峻也', '中村た'],
        ['田中克樹', '田中か'],
        ['宮城 啓生', '宮城'],
        ['宮城啓生', '宮城'],
        ['宮城一平', '宮城一平'],
        ['野口純', '野口'],
        ['野口 純', '野口'],
        ['坪井 秀斗', '坪井'],
        ['坪井秀斗', '坪井'],
        ['松居和輝', '松居'],
        ['松居 和輝', '松居'],
        ['村松和哉', '村松'],
        ['村松 和哉', '村松'],
        ['辻森誠也', '辻森'],
        ['辻森 誠也', '辻森'],
        ['山本匠太郎', '山本'],
        ['山本 匠太郎', '山本'],
        ['美除直生', '美除'],
        ['美除 直生', '美除'],
        ['村上夢果', '村上'],
        ['村上 夢果', '村上'],
        ['三善一樹', '三善'],
        ['三善 一樹', '三善'],
        ['菊池幸平', '菊池'],
        ['菊池 幸平', '菊池'],
        ['野上樹哉', '野上'],
        ['野上 樹哉', '野上'],
        ['池田愛', '池田'],
        ['池田 愛', '池田'],
        ['轟玲音', '轟'],
        ['轟 玲音', '轟'],
        ['清水陸斗', '清水'],
        ['清水 陸斗', '清水'],
        ['堀切友世', '堀切'],
        ['堀切 友世', '堀切'],
        ['k.matsui@digi-man.com', '松居'],
        ['s.tsuboi@digi-man.com', '坪井'],
        ['j.noguchi@digi-man.com', '野口'],
        ['a.ikeda@digi-man.com', '池田'],
        ['y.horikiri@digi-man.com', '堀切'],
        ['r.todoroki@digi-man.com', '轟'],
        ['k.kawakami@digi-man.com', '川上'],
        ['katsu.tanaka@digi-man.com', '田中か'],
        ['k.muramatsu@digi-man.com', '村松'],
        ['h.miyagi@digi-man.com', '宮城'],
        ['i.miyagi@digi-man.com', '宮城一平'],
        ['y.nakamura@digi-man.com', '中村ゆ'],
        ['t.nakamura@digi-man.com', '中村た'],
        ['r.shimizu@digi-man.com', '清水'],
        ['k.kikuchi@digi-man.com', '菊池'],
        ['k.miyoshi@digi-man.com', '三善'],
        ['y.murakami@digi-man.com', '村上'],
        ['s.yamamoto@digi-man.com', '山本'],
        ['s.tanaka@digi-man.com', '田中颯汰'],
        ['j.nogami@digi-man.com', '野上'],
        ['y.tayama@digi-man.com', '田山'],
    ];

    let successCount = 0;
    let errorCount = 0;

    for (const [rawName, canonicalName] of mappings) {
        try {
            await executeTurso(
                'INSERT OR IGNORE INTO member_name_mappings (id, raw_name, canonical_name) VALUES (lower(hex(randomblob(16))), ?, ?)',
                [rawName, canonicalName]
            );
            successCount++;
        } catch (e) {
            errorCount++;
            console.error(`マッピング移行エラー (${rawName}):`, e);
        }
    }

    showToast(`GAS移行完了: ${successCount}件処理${errorCount > 0 ? ` / ${errorCount}件エラー` : ''}`);
    await loadMappings();
}
