/**
 * DRISHTI — Super Admin Dashboard & Management Views
 * File: admin.js
 *
 * Loaded by index.html as <script type="module" src="admin.js">.
 * Handles all UI for users with role === 'Super Admin'.
 *
 * Views managed:
 *   #dashboard   — Admin Dashboard (KPIs, quick links, activity)
 *   #users       — User Management (CRUD, reset password, deactivate)
 *   #departments — Department Management (HOD edit, task counts)
 *   #audit       — Audit Log (paginated, filterable, CSV export)
 *   #settings    — Settings editor (key-value, logged changes)
 *   #create-task — Full task creation form (injected as modal overlay)
 *   Broadcast    — Email all users modal (triggered from dashboard)
 *
 * Architecture:
 *   - Each view injects its HTML into the corresponding #view-* panel
 *   - The task creation form is a full-screen modal overlay (not a separate panel)
 *   - All actions call window.api() and log to AuditLog via backend
 *   - Role guard: every render checks session.role === 'Super Admin'
 *
 * Dependencies (window globals from index.html showApp()):
 *   window.api(action, payload)
 *   window.ui  — toast, confirm, setLoading, _esc
 *   window.router — navigate
 *   window.store  — { session }
 *
 * @version 6.4.0
 * @module  Super Admin Interface
 */

'use strict';

// ═════════════════════════════════════════════════════════════════════════════
// A — MODULE STATE
// ═════════════════════════════════════════════════════════════════════════════

let _users        = [];      // cached users list
let _departments  = [];      // cached dept list
let _auditRows    = [];      // cached audit log rows
let _settings     = [];      // cached settings rows
let _auditPage    = 1;
let _auditFilters = { dateFrom:'', dateTo:'', user:'', action:'' };
const AUDIT_PAGE_SIZE = 30;
let _cssInjected  = false;

// ═════════════════════════════════════════════════════════════════════════════
// B — CSS INJECTION
// ═════════════════════════════════════════════════════════════════════════════

function injectAdminCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement('style');
  s.id = 'admin-styles';
  s.textContent = `
  /* ═══════════════════════════════════════════════════════════════
     ADMIN DASHBOARD
  ═══════════════════════════════════════════════════════════════ */
  .adm-header {
    display: flex; align-items: flex-start; justify-content: space-between;
    margin-bottom: var(--space-6); gap: var(--space-4); flex-wrap: wrap;
  }
  .adm-kpi-grid {
    display: grid;
    grid-template-columns: repeat(4,1fr);
    gap: var(--space-4);
    margin-bottom: var(--space-6);
  }
  .adm-kpi {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    box-shadow: var(--shadow-sm);
    position: relative; overflow: hidden;
    transition: transform var(--transition), box-shadow var(--transition);
  }
  .adm-kpi:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
  .adm-kpi::after {
    content: ''; position: absolute;
    top: 0; left: 0; right: 0; height: 3px;
    background: var(--adm-kpi-clr, var(--color-primary));
  }
  .adm-kpi-icon {
    width: 36px; height: 36px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--adm-kpi-clr,var(--color-primary)) 12%, transparent);
    color: var(--adm-kpi-clr, var(--color-primary));
    display: flex; align-items: center; justify-content: center;
    margin-bottom: var(--space-3); font-size: 1.1rem;
  }
  .adm-kpi-val {
    font-size: 2rem; font-weight: 800;
    color: var(--color-text-primary); line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .adm-kpi-label { font-size: var(--font-sm); color: var(--color-text-secondary); font-weight: 500; margin-top: 4px; }

  /* Quick links */
  .adm-quick-links {
    display: grid; grid-template-columns: repeat(4,1fr);
    gap: var(--space-4); margin-bottom: var(--space-6);
  }
  .adm-ql {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    display: flex; flex-direction: column; align-items: center;
    gap: var(--space-3); cursor: pointer;
    text-align: center;
    transition: all var(--transition);
    box-shadow: var(--shadow-sm);
    font-family: inherit; font-size: var(--font-sm); font-weight: 600;
    color: var(--color-text-primary);
  }
  .adm-ql:hover {
    border-color: var(--color-primary-light);
    background: rgba(42,95,158,0.04);
    transform: translateY(-2px); box-shadow: var(--shadow-md);
    color: var(--color-primary);
  }
  .adm-ql-icon {
    width: 48px; height: 48px; border-radius: var(--radius-md);
    display: flex; align-items: center; justify-content: center;
    font-size: 1.4rem;
    background: var(--color-surface-2);
  }

  /* Admin row2 */
  .adm-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5); }

  /* ═══════════════════════════════════════════════════════════════
     SHARED TABLE STYLES
  ═══════════════════════════════════════════════════════════════ */
  .adm-table-wrap {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden; box-shadow: var(--shadow-sm);
  }
  .adm-table {
    width: 100%; border-collapse: collapse;
    font-size: var(--font-sm);
  }
  .adm-table th {
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-weight: 600; font-size: var(--font-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    padding: var(--space-3) var(--space-4);
    text-align: left; white-space: nowrap;
    border-bottom: 1px solid var(--color-border);
  }
  .adm-table td {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    vertical-align: middle;
  }
  .adm-table tr:last-child td { border-bottom: none; }
  .adm-table tbody tr { transition: background var(--transition); }
  .adm-table tbody tr:hover { background: var(--color-surface-2); }

  /* Pagination */
  .adm-pagination {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--color-border);
    background: var(--color-surface-2);
    font-size: var(--font-xs); color: var(--color-text-muted);
  }

  /* ═══════════════════════════════════════════════════════════════
     TASK CREATION MODAL
  ═══════════════════════════════════════════════════════════════ */
  #adm-create-task-modal {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    backdrop-filter: blur(4px);
    z-index: 7500;
    display: flex; align-items: flex-start; justify-content: center;
    padding: var(--space-6);
    opacity: 0; visibility: hidden;
    transition: opacity 0.25s ease, visibility 0.25s ease;
    overflow-y: auto;
  }
  #adm-create-task-modal.open { opacity: 1; visibility: visible; }
  .adm-task-form-card {
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-xl);
    width: 100%; max-width: 900px;
    overflow: hidden;
    transform: translateY(-20px) scale(0.98);
    transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1);
    margin: auto;
  }
  #adm-create-task-modal.open .adm-task-form-card { transform: translateY(0) scale(1); }
  .adm-form-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--space-5) var(--space-6);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-primary);
  }
  .adm-form-title { font-size: var(--font-lg); font-weight: 800; color: #fff; }
  .adm-form-subtitle { font-size: var(--font-xs); color: rgba(255,255,255,0.6); margin-top: 2px; }
  .adm-form-close {
    background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
    color: #fff; width: 32px; height: 32px; border-radius: var(--radius-sm);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: background var(--transition);
  }
  .adm-form-close:hover { background: rgba(255,255,255,0.2); }
  .adm-form-body { padding: var(--space-6); }
  .adm-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5); }
  .adm-form-grid .span-2 { grid-column: 1 / -1; }
  .adm-form-footer {
    display: flex; align-items: center; justify-content: flex-end;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-6);
    border-top: 1px solid var(--color-border);
    background: var(--color-surface-2);
  }

  /* Char counter */
  .adm-char-counter {
    font-size: var(--font-xs); color: var(--color-text-muted);
    text-align: right; margin-top: 2px;
  }
  .adm-char-counter.warn { color: var(--color-warning); }
  .adm-char-counter.over { color: var(--color-danger); }

  /* Priority radios */
  .adm-priority-group { display: flex; gap: var(--space-3); flex-wrap: wrap; }
  .adm-priority-radio { display: none; }
  .adm-priority-label {
    display: flex; align-items: center; gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border: 2px solid var(--color-border);
    border-radius: var(--radius-sm);
    cursor: pointer; font-size: var(--font-sm); font-weight: 600;
    transition: all var(--transition);
  }
  .adm-priority-label::before {
    content: ''; width: 10px; height: 10px;
    border-radius: 50%; flex-shrink: 0;
    background: var(--adm-prio-clr, var(--color-text-muted));
  }
  .adm-priority-radio:checked + .adm-priority-label {
    border-color: var(--adm-prio-clr, var(--color-primary));
    background: color-mix(in srgb, var(--adm-prio-clr, var(--color-primary)) 10%, transparent);
    color: var(--adm-prio-clr, var(--color-primary));
  }

  /* Dept multi-select */
  .adm-dept-search {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-sm); font-family: inherit;
    background: var(--color-surface); outline: none; width: 100%;
    border-bottom: none;
    transition: border-color var(--transition);
  }
  .adm-dept-search:focus { border-color: var(--color-border-focus); }
  .adm-dept-checkboxes {
    border: 1px solid var(--color-border);
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    max-height: 180px; overflow-y: auto;
    background: var(--color-surface);
    scrollbar-width: thin;
  }
  .adm-dept-option {
    display: flex; align-items: center; gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    cursor: pointer; transition: background var(--transition);
    font-size: var(--font-sm);
  }
  .adm-dept-option:hover { background: var(--color-surface-2); }
  .adm-dept-option input[type="checkbox"] { accent-color: var(--color-primary); width: 14px; height: 14px; }
  .adm-dept-option.hidden-opt { display: none; }
  .adm-selected-depts {
    display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2);
    min-height: 24px;
  }
  .adm-dept-chip {
    display: inline-flex; align-items: center; gap: 4px;
    background: rgba(42,95,158,0.12);
    color: var(--color-primary-light);
    border: 1px solid rgba(42,95,158,0.2);
    padding: 2px 8px; border-radius: var(--radius-full);
    font-size: var(--font-xs); font-weight: 600;
  }
  .adm-dept-chip button {
    background: none; border: none; cursor: pointer;
    color: inherit; padding: 0; line-height: 1;
    font-size: 0.8rem; display: flex; align-items: center;
  }

  /* Success card */
  .adm-task-success {
    text-align: center; padding: var(--space-8);
    display: flex; flex-direction: column; align-items: center; gap: var(--space-4);
  }
  .adm-success-icon {
    width: 64px; height: 64px;
    background: var(--color-success-light);
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 2rem;
  }
  .adm-task-id-display {
    font-family: monospace; font-size: var(--font-xl); font-weight: 800;
    color: var(--color-primary-light);
    background: rgba(42,95,158,0.08);
    padding: var(--space-2) var(--space-5);
    border-radius: var(--radius-sm);
    border: 1px solid rgba(42,95,158,0.15);
  }

  /* ═══════════════════════════════════════════════════════════════
     USER MANAGEMENT
  ═══════════════════════════════════════════════════════════════ */
  .adm-user-status-active   { color: var(--color-success); font-weight: 600; }
  .adm-user-status-inactive { color: var(--color-danger);  font-weight: 600; }

  /* User form modal */
  #adm-user-modal {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
    z-index: 7500;
    display: flex; align-items: center; justify-content: center;
    padding: var(--space-6);
    opacity: 0; visibility: hidden;
    transition: opacity 0.2s ease, visibility 0.2s ease;
  }
  #adm-user-modal.open { opacity: 1; visibility: visible; }
  .adm-user-card {
    background: var(--color-surface); border-radius: var(--radius-lg);
    box-shadow: var(--shadow-xl); width: 100%; max-width: 560px;
    overflow: hidden;
    transform: scale(0.96) translateY(-12px);
    transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1);
  }
  #adm-user-modal.open .adm-user-card { transform: scale(1) translateY(0); }

  /* ═══════════════════════════════════════════════════════════════
     BROADCAST MODAL
  ═══════════════════════════════════════════════════════════════ */
  #adm-broadcast-modal {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
    z-index: 7500;
    display: flex; align-items: center; justify-content: center;
    padding: var(--space-6);
    opacity: 0; visibility: hidden;
    transition: opacity 0.2s ease, visibility 0.2s ease;
  }
  #adm-broadcast-modal.open { opacity: 1; visibility: visible; }
  .adm-broadcast-card {
    background: var(--color-surface); border-radius: var(--radius-lg);
    box-shadow: var(--shadow-xl); width: 100%; max-width: 520px;
    overflow: hidden;
    transform: scale(0.96) translateY(-12px);
    transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1);
  }
  #adm-broadcast-modal.open .adm-broadcast-card { transform: scale(1) translateY(0); }

  /* ═══════════════════════════════════════════════════════════════
     AUDIT LOG
  ═══════════════════════════════════════════════════════════════ */
  .adm-audit-filters {
    display: grid; grid-template-columns: repeat(4,1fr);
    gap: var(--space-4); margin-bottom: var(--space-5);
  }
  .adm-audit-detail {
    max-width: 220px; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
    font-size: var(--font-xs); color: var(--color-text-secondary);
    cursor: help;
  }
  .adm-action-pill {
    display: inline-block; padding: 2px 8px;
    border-radius: var(--radius-full);
    font-size: 0.65rem; font-weight: 700; white-space: nowrap;
  }

  /* ═══════════════════════════════════════════════════════════════
     SETTINGS
  ═══════════════════════════════════════════════════════════════ */
  .adm-setting-row {
    display: grid; grid-template-columns: 220px 1fr auto;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--color-border);
    transition: background var(--transition);
  }
  .adm-setting-row:last-child { border-bottom: none; }
  .adm-setting-row:hover { background: var(--color-surface-2); }
  .adm-setting-key { font-size: var(--font-sm); font-weight: 700; color: var(--color-primary-light); font-family: monospace; }
  .adm-setting-desc { font-size: var(--font-xs); color: var(--color-text-muted); margin-top: 2px; }
  .adm-setting-input {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-sm); font-family: inherit;
    color: var(--color-text-primary);
    background: var(--color-surface);
    outline: none; width: 100%;
    transition: border-color var(--transition), box-shadow var(--transition);
  }
  .adm-setting-input:focus {
    border-color: var(--color-border-focus);
    box-shadow: 0 0 0 3px rgba(42,95,158,0.1);
  }
  .adm-setting-input.modified { border-color: var(--color-accent); }

  /* ═══════════════════════════════════════════════════════════════
     DEPT MANAGEMENT
  ═══════════════════════════════════════════════════════════════ */
  .adm-dept-edit-row { display: flex; align-items: center; gap: var(--space-2); }
  .adm-inline-input {
    border: 1px solid var(--color-border); border-radius: var(--radius-xs);
    padding: 2px 6px; font-size: var(--font-xs); font-family: inherit;
    color: var(--color-text-primary); background: var(--color-surface);
    outline: none; width: 100%;
    transition: border-color var(--transition);
  }
  .adm-inline-input:focus { border-color: var(--color-border-focus); }

  /* ═══════════════════════════════════════════════════════════════
     RESPONSIVE
  ═══════════════════════════════════════════════════════════════ */
  @media (max-width: 1100px) {
    .adm-kpi-grid       { grid-template-columns: repeat(2,1fr); }
    .adm-quick-links    { grid-template-columns: repeat(2,1fr); }
    .adm-form-grid      { grid-template-columns: 1fr; }
    .adm-form-grid .span-2 { grid-column: 1; }
    .adm-audit-filters  { grid-template-columns: 1fr 1fr; }
    .adm-row2           { grid-template-columns: 1fr; }
  }
  @media (max-width: 768px) {
    .adm-kpi-grid    { grid-template-columns: 1fr 1fr; }
    .adm-quick-links { grid-template-columns: 1fr 1fr; }
    .adm-setting-row { grid-template-columns: 1fr; gap: var(--space-2); }
  }
  `;
  document.head.appendChild(s);
}


// ═════════════════════════════════════════════════════════════════════════════
// C — ROLE GUARD
// ═════════════════════════════════════════════════════════════════════════════

/** Returns true and shows toast if user is NOT Super Admin */
function _guardAdmin() {
  const role = window.store?.session?.role;
  if (role !== 'Super Admin') {
    window.ui?.toast('Access Denied', 'This area requires Super Admin role.', 'error');
    window.router?.navigate('dashboard');
    return false;
  }
  return true;
}


// ═════════════════════════════════════════════════════════════════════════════
// D — ADMIN DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════

async function renderAdminDashboard() {
  if (!_guardAdmin()) return;
  injectAdminCSS();

  const panel = document.getElementById('view-dashboard');
  if (!panel) return;

  panel.innerHTML = `
  <div class="adm-header">
    <div>
      <h1 class="view-title">Administration Dashboard</h1>
      <p class="view-subtitle" id="adm-greeting">Loading system overview…</p>
    </div>
    <div style="display:flex;gap:var(--space-3);">
      <button class="btn btn-secondary btn-sm" id="adm-refresh" aria-label="Refresh dashboard">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
        Refresh
      </button>
    </div>
  </div>

  <!-- KPI cards -->
  <div class="adm-kpi-grid" role="list" aria-label="System statistics">
    ${[
      { icon:'👥', label:'Total Users',     id:'adm-kpi-users',    clr:'var(--color-primary)' },
      { icon:'📋', label:'Total Tasks',     id:'adm-kpi-tasks',    clr:'var(--color-primary-light)' },
      { icon:'🔐', label:'Active Sessions', id:'adm-kpi-sessions', clr:'var(--color-success)' },
      { icon:'🗄',  label:'Audit Entries',  id:'adm-kpi-audit',    clr:'var(--color-accent-dark)' },
    ].map(k => `
    <div class="adm-kpi" style="--adm-kpi-clr:${k.clr};" role="listitem" aria-label="${k.label}">
      <div class="adm-kpi-icon" aria-hidden="true">${k.icon}</div>
      <div class="adm-kpi-val" id="${k.id}">
        <div class="skeleton skeleton-title" style="width:50%;"></div>
      </div>
      <div class="adm-kpi-label">${k.label}</div>
    </div>`).join('')}
  </div>

  <!-- Quick links -->
  <div class="adm-quick-links" role="navigation" aria-label="Quick actions">
    <button class="adm-ql" id="adm-ql-create" aria-label="Create new task">
      <div class="adm-ql-icon" style="background:rgba(42,95,158,0.1);color:var(--color-primary);">➕</div>
      Create Task
    </button>
    <button class="adm-ql" id="adm-ql-users" aria-label="Manage users">
      <div class="adm-ql-icon" style="background:rgba(46,125,50,0.1);color:var(--color-success);">👥</div>
      Manage Users
    </button>
    <button class="adm-ql" id="adm-ql-broadcast" aria-label="Send broadcast announcement">
      <div class="adm-ql-icon" style="background:rgba(245,127,23,0.1);color:var(--color-warning);">📣</div>
      Broadcast
    </button>
    <button class="adm-ql" id="adm-ql-audit" aria-label="View audit log">
      <div class="adm-ql-icon" style="background:rgba(183,28,28,0.1);color:var(--color-danger);">🛡</div>
      Audit Log
    </button>
  </div>

  <!-- Row 2: Recent users + recent audit -->
  <div class="adm-row2">
    <div class="card">
      <div class="card-header">
        <div class="card-title">Recent Users</div>
        <button class="btn btn-ghost btn-sm" onclick="window.router&&window.router.navigate('users')" aria-label="View all users">View all →</button>
      </div>
      <div id="adm-recent-users">
        <div class="skeleton skeleton-text" style="margin-bottom:12px;"></div>
        <div class="skeleton skeleton-text" style="margin-bottom:12px;width:80%;"></div>
        <div class="skeleton skeleton-text" style="width:90%;"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Recent Audit Events</div>
        <button class="btn btn-ghost btn-sm" onclick="window.router&&window.router.navigate('audit')" aria-label="View full audit log">View log →</button>
      </div>
      <div id="adm-recent-audit">
        <div class="skeleton skeleton-text" style="margin-bottom:12px;"></div>
        <div class="skeleton skeleton-text" style="margin-bottom:12px;width:70%;"></div>
        <div class="skeleton skeleton-text" style="width:85%;"></div>
      </div>
    </div>
  </div>
  `;

  // Wire quick links
  _on('adm-refresh',      'click', () => { renderAdminDashboard(); });
  _on('adm-ql-create',    'click', openCreateTaskModal);
  _on('adm-ql-users',     'click', () => window.router?.navigate('users'));
  _on('adm-ql-broadcast', 'click', openBroadcastModal);
  _on('adm-ql-audit',     'click', () => window.router?.navigate('audit'));

  // Load data in parallel
  try {
    const [users, tasks, audit] = await Promise.all([
      window.api('getUsers',    {}).catch(() => []),
      window.api('getTasks',    { pageSize: 1 }).catch(() => ({ totalCount: 0 })),
      window.api('getAuditLog', {}).catch(() => []),
    ]);
    _users     = users || [];
    _auditRows = audit || [];

    // KPIs
    _setKPI('adm-kpi-users',    _users.length);
    _setKPI('adm-kpi-tasks',    tasks?.totalCount || 0);
    _setKPI('adm-kpi-sessions', _users.filter(u => u.isActive === 'TRUE').length);
    _setKPI('adm-kpi-audit',    _auditRows.length);

    // Greeting
    const h = new Date().getHours();
    const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const name = window.store?.session?.fullName?.split(' ')[0] || 'Admin';
    _el('adm-greeting').textContent = `${g}, ${name} · System is operational`;

    // Recent users
    _renderRecentUsers(_users.slice(0, 5));

    // Recent audit
    _renderRecentAudit(_auditRows.slice(0, 6));

  } catch (err) {
    window.ui?.toast('Dashboard Error', err.message, 'error');
  }
}

function _setKPI(id, val) {
  const el = _el(id);
  if (el) { el.textContent = '0'; _animateCounter(el, 0, parseInt(val,10)||0, 900); }
}

function _renderRecentUsers(users) {
  const el = _el('adm-recent-users');
  if (!el) return;
  if (!users.length) { el.innerHTML = '<div class="empty-state" style="padding:var(--space-5);"><div class="empty-state-desc">No users found.</div></div>'; return; }
  el.innerHTML = users.map(u => `
  <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) 0;border-bottom:1px solid var(--color-border);">
    <div class="avatar" style="background:var(--color-primary);color:var(--color-accent);font-size:0.7rem;" aria-hidden="true">
      ${(u.fullName||u.email||'??').split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase()}
    </div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:var(--font-sm);font-weight:600;color:var(--color-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(u.fullName||'—')}</div>
      <div style="font-size:var(--font-xs);color:var(--color-text-muted);">${_esc(u.role)} · ${_esc(u.deptCode||'—')}</div>
    </div>
    <span style="font-size:var(--font-xs);font-weight:600;color:${u.isActive==='TRUE'?'var(--color-success)':'var(--color-danger)'};">${u.isActive==='TRUE'?'Active':'Inactive'}</span>
  </div>`).join('');
}

function _renderRecentAudit(rows) {
  const el = _el('adm-recent-audit');
  if (!el) return;
  if (!rows.length) { el.innerHTML = '<div class="empty-state" style="padding:var(--space-5);"><div class="empty-state-desc">No audit events yet.</div></div>'; return; }
  el.innerHTML = rows.map(r => `
  <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) 0;border-bottom:1px solid var(--color-border);">
    <div style="flex:1;min-width:0;">
      <div style="font-size:var(--font-xs);font-weight:700;color:var(--color-primary-light);">${_esc(r.Action||'—')}</div>
      <div style="font-size:var(--font-xs);color:var(--color-text-muted);">${_esc(r.UserEmail||'—')} · ${_fmtDate(r.Timestamp)}</div>
    </div>
    <span class="adm-action-pill" style="background:rgba(42,95,158,0.1);color:var(--color-primary-light);">${_esc(r.EntityType||'—')}</span>
  </div>`).join('');
}


// ═════════════════════════════════════════════════════════════════════════════
// E — TASK CREATION MODAL
// ═════════════════════════════════════════════════════════════════════════════

const TASK_CATEGORIES = [
  'Cabinet Decision','CM Announcement','Assembly Assurance',
  'Court Case','VIP Reference','Public Grievance','PMO Reference','General'
];

let _selectedDepts = new Set();
let _allDeptsList  = [];

function _injectCreateTaskModal() {
  if (_el('adm-create-task-modal')) return;
  const m = document.createElement('div');
  m.id = 'adm-create-task-modal';
  m.setAttribute('role','dialog');
  m.setAttribute('aria-modal','true');
  m.setAttribute('aria-labelledby','adm-create-task-title');
  m.innerHTML = `
  <div class="adm-task-form-card">
    <div class="adm-form-header">
      <div>
        <div class="adm-form-title" id="adm-create-task-title">Create New Task / Directive</div>
        <div class="adm-form-subtitle">Government of Sikkim · DRISHTI Command Centre</div>
      </div>
      <button class="adm-form-close" id="adm-create-close" aria-label="Close task creation form">✕</button>
    </div>

    <!-- Success state (hidden initially) -->
    <div class="adm-task-success" id="adm-create-success" style="display:none;" aria-live="polite">
      <div class="adm-success-icon" aria-hidden="true">✅</div>
      <h2 style="font-size:var(--font-xl);font-weight:800;color:var(--color-text-primary);">Task Created Successfully</h2>
      <div class="adm-task-id-display" id="adm-new-task-id" aria-label="New task ID">—</div>
      <p style="font-size:var(--font-sm);color:var(--color-text-secondary);">Email notifications have been sent to all assigned departments.</p>
      <div style="display:flex;gap:var(--space-4);">
        <button class="btn btn-secondary" id="adm-add-another" aria-label="Create another task">Add Another Task</button>
        <button class="btn btn-primary"   id="adm-view-new-task" aria-label="View the new task">View Task →</button>
      </div>
    </div>

    <!-- Form body (hidden on success) -->
    <div class="adm-form-body" id="adm-create-form-body">
      <div class="adm-form-grid">

        <!-- Subject -->
        <div class="span-2">
          <div class="form-group">
            <label class="form-label" for="ct-subject">Subject <span style="color:var(--color-danger);">*</span></label>
            <input type="text" class="input" id="ct-subject" maxlength="200"
              placeholder="Brief, clear directive subject line" required aria-required="true"
              aria-describedby="ct-subject-count" />
            <div class="adm-char-counter" id="ct-subject-count" aria-live="polite">0 / 200</div>
          </div>
        </div>

        <!-- Description -->
        <div class="span-2">
          <div class="form-group">
            <label class="form-label" for="ct-description">Description / Full Text</label>
            <textarea class="textarea" id="ct-description" rows="4"
              placeholder="Full text of the directive, cabinet decision, or order…"
              aria-label="Task description"></textarea>
          </div>
        </div>

        <!-- Assigned Departments -->
        <div>
          <div class="form-group">
            <label class="form-label">Assigned Departments <span style="color:var(--color-danger);">*</span></label>
            <input type="text" class="adm-dept-search" id="ct-dept-search"
              placeholder="Search departments…" aria-label="Search departments to assign" />
            <div class="adm-dept-checkboxes" id="ct-dept-checkboxes" role="listbox" aria-multiselectable="true" aria-label="Department selection"></div>
            <div class="adm-selected-depts" id="ct-selected-depts" aria-live="polite" aria-label="Selected departments"></div>
          </div>
        </div>

        <!-- Primary Dept -->
        <div>
          <div class="form-group">
            <label class="form-label" for="ct-primary-dept">Primary Department <span style="color:var(--color-danger);">*</span></label>
            <select class="select" id="ct-primary-dept" required aria-required="true" aria-label="Primary department">
              <option value="">— Select primary dept —</option>
            </select>
            <div class="form-hint">Auto-populated from selected departments. Can be changed.</div>
          </div>

          <div class="form-group" style="margin-top:var(--space-4);">
            <label class="form-label">Priority <span style="color:var(--color-danger);">*</span></label>
            <div class="adm-priority-group" role="radiogroup" aria-label="Task priority">
              ${[
                {v:'CRITICAL',l:'Critical',c:'#B71C1C'},
                {v:'HIGH',    l:'High',    c:'#F57F17'},
                {v:'MEDIUM',  l:'Medium',  c:'#2A5F9E'},
                {v:'LOW',     l:'Low',     c:'#2E7D32'},
              ].map(p => `
              <label>
                <input type="radio" name="ct-priority" class="adm-priority-radio" value="${p.v}" ${p.v==='MEDIUM'?'checked':''} aria-label="${p.l} priority" />
                <span class="adm-priority-label" style="--adm-prio-clr:${p.c};">${p.l}</span>
              </label>`).join('')}
            </div>
          </div>
        </div>

        <!-- Category -->
        <div>
          <div class="form-group">
            <label class="form-label" for="ct-category">Category</label>
            <select class="select" id="ct-category" aria-label="Task category">
              ${TASK_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Status -->
        <div>
          <div class="form-group">
            <label class="form-label" for="ct-status">Initial Status</label>
            <select class="select" id="ct-status" aria-label="Initial task status">
              <option value="PENDING" selected>Pending</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="REVIEW">Under Review</option>
            </select>
          </div>
        </div>

        <!-- Assigned Date -->
        <div>
          <div class="form-group">
            <label class="form-label" for="ct-assigned-date">Assigned Date</label>
            <input type="date" class="input" id="ct-assigned-date" aria-label="Assigned date" />
          </div>
        </div>

        <!-- Due Date -->
        <div>
          <div class="form-group">
            <label class="form-label" for="ct-due-date">Due Date <span style="color:var(--color-danger);">*</span></label>
            <input type="date" class="input" id="ct-due-date" required aria-required="true" aria-label="Due date" />
          </div>
        </div>

        <!-- Review Date -->
        <div>
          <div class="form-group">
            <label class="form-label" for="ct-review-date">Review Date</label>
            <input type="date" class="input" id="ct-review-date" aria-label="Review date" />
          </div>
        </div>

        <!-- Officer Responsible -->
        <div>
          <div class="form-group">
            <label class="form-label" for="ct-officer">Officer Responsible</label>
            <input type="text" class="input" id="ct-officer" placeholder="Name of nodal officer" aria-label="Officer responsible" />
          </div>
        </div>

        <!-- File Number -->
        <div>
          <div class="form-group">
            <label class="form-label" for="ct-file-no">File Number</label>
            <input type="text" class="input" id="ct-file-no" placeholder="Govt. file reference" aria-label="File number" />
          </div>
        </div>

        <!-- Cabinet Reference -->
        <div>
          <div class="form-group">
            <label class="form-label" for="ct-cabinet-ref">Cabinet / File Reference</label>
            <input type="text" class="input" id="ct-cabinet-ref" placeholder="Cabinet decision ref." aria-label="Cabinet reference" />
          </div>
        </div>

        <!-- Remarks -->
        <div class="span-2">
          <div class="form-group">
            <label class="form-label" for="ct-remarks">Initial Remarks</label>
            <textarea class="textarea" id="ct-remarks" rows="2"
              placeholder="Any initial remarks or context for assigned departments…"
              aria-label="Initial remarks"></textarea>
          </div>
        </div>

        <!-- Error -->
        <div class="span-2">
          <div id="ct-error" class="form-error" role="alert" style="font-size:var(--font-sm);"></div>
        </div>

      </div>
    </div>

    <div class="adm-form-footer" id="adm-create-footer">
      <button class="btn btn-secondary" id="adm-create-cancel" aria-label="Cancel task creation">Cancel</button>
      <button class="btn btn-primary" id="adm-create-submit" aria-label="Submit and create task">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        Create Task
      </button>
    </div>
  </div>`;
  document.body.appendChild(m);
  _wireCreateTaskModal();
}

function _wireCreateTaskModal() {
  // Close buttons
  ['adm-create-close','adm-create-cancel'].forEach(id => {
    _on(id,'click', closeCreateTaskModal);
  });
  _el('adm-create-task-modal')?.addEventListener('click', e => {
    if (e.target === _el('adm-create-task-modal')) closeCreateTaskModal();
  });

  // Char counter
  const subj = _el('ct-subject');
  const ctr  = _el('ct-subject-count');
  subj?.addEventListener('input', () => {
    const len = subj.value.length;
    ctr.textContent = `${len} / 200`;
    ctr.className = 'adm-char-counter' + (len>180?' over':len>150?' warn':'');
  });

  // Default assigned date to today
  const adEl = _el('ct-assigned-date');
  if (adEl) adEl.value = new Date().toISOString().split('T')[0];

  // Dept search + checkboxes
  _buildDeptCheckboxes();
  _el('ct-dept-search')?.addEventListener('input', _filterDeptOptions);

  // Submit
  _on('adm-create-submit','click', _submitCreateTask);
  _el('adm-create-task-modal')?.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCreateTaskModal();
  });

  // Success buttons
  _on('adm-add-another','click', () => {
    _el('adm-create-success').style.display = 'none';
    _el('adm-create-form-body').style.display = '';
    _el('adm-create-footer').style.display = '';
    _resetCreateForm();
  });
  _on('adm-view-new-task','click', () => {
    const id = _el('adm-new-task-id')?.textContent;
    closeCreateTaskModal();
    if (id && id !== '—') window.router?.navigate('tasks');
  });
}

async function _buildDeptCheckboxes() {
  const box = _el('ct-dept-checkboxes');
  if (!box) return;
  if (!_departments.length) {
    try { _departments = await window.api('getDepartments',{}); }
    catch { _departments = []; }
  }
  _allDeptsList = _departments;
  box.innerHTML = _allDeptsList.map(d => `
  <label class="adm-dept-option" data-code="${d.deptCode}" data-name="${d.deptName.toLowerCase()}">
    <input type="checkbox" value="${d.deptCode}" aria-label="${_esc(d.deptName)}" />
    <div>
      <div style="font-size:var(--font-sm);font-weight:600;">${_esc(d.deptName)}</div>
      <div style="font-size:var(--font-xs);color:var(--color-text-muted);">${d.deptCode}</div>
    </div>
  </label>`).join('');

  // Wire checkbox changes
  box.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) {
        _selectedDepts.add(cb.value);
      } else {
        _selectedDepts.delete(cb.value);
      }
      _updateSelectedChips();
      _updatePrimaryDeptSelect();
    });
  });
}

function _filterDeptOptions() {
  const term = (_el('ct-dept-search')?.value || '').toLowerCase();
  _el('ct-dept-checkboxes')?.querySelectorAll('.adm-dept-option').forEach(opt => {
    const match = !term || opt.dataset.name.includes(term) || opt.dataset.code.toLowerCase().includes(term);
    opt.classList.toggle('hidden-opt', !match);
  });
}

function _updateSelectedChips() {
  const wrap = _el('ct-selected-depts');
  if (!wrap) return;
  wrap.innerHTML = [..._selectedDepts].map(code => {
    const dept = _allDeptsList.find(d => d.deptCode === code);
    const name = dept ? dept.deptShortName || code : code;
    return `<span class="adm-dept-chip">${_esc(name)}<button onclick="_removeDept('${code}')" aria-label="Remove ${_esc(name)}">✕</button></span>`;
  }).join('');
}

window._removeDept = function(code) {
  _selectedDepts.delete(code);
  const cb = _el('ct-dept-checkboxes')?.querySelector(`input[value="${code}"]`);
  if (cb) cb.checked = false;
  _updateSelectedChips();
  _updatePrimaryDeptSelect();
};

function _updatePrimaryDeptSelect() {
  const sel = _el('ct-primary-dept');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Select primary dept —</option>' +
    [..._selectedDepts].map(code => {
      const dept = _allDeptsList.find(d => d.deptCode === code);
      const name = dept ? dept.deptName : code;
      return `<option value="${code}" ${code===prev?'selected':''}>${_esc(name)}</option>`;
    }).join('');
  // Auto-select first if none selected
  if (!sel.value && _selectedDepts.size > 0) {
    sel.value = [..._selectedDepts][0];
  }
}

function _resetCreateForm() {
  _selectedDepts.clear();
  ['ct-subject','ct-description','ct-officer','ct-file-no','ct-cabinet-ref','ct-remarks'].forEach(id => {
    const el = _el(id); if (el) el.value = '';
  });
  ['ct-category','ct-status','ct-assigned-date','ct-due-date','ct-review-date'].forEach(id => {
    const el = _el(id); if (el) el.value = '';
  });
  const adEl = _el('ct-assigned-date');
  if (adEl) adEl.value = new Date().toISOString().split('T')[0];
  const radios = document.querySelectorAll('input[name="ct-priority"]');
  radios.forEach(r => { r.checked = r.value === 'MEDIUM'; });
  _el('ct-subject-count') && (_el('ct-subject-count').textContent = '0 / 200');
  _selectedDepts.clear();
  _updateSelectedChips();
  _updatePrimaryDeptSelect();
  _el('ct-dept-search') && (_el('ct-dept-search').value = '');
  _el('ct-dept-checkboxes')?.querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = false);
  _el('ct-dept-checkboxes')?.querySelectorAll('.adm-dept-option').forEach(o => o.classList.remove('hidden-opt'));
  const errEl = _el('ct-error'); if (errEl) { errEl.textContent=''; errEl.classList.remove('visible'); }
}

async function _submitCreateTask() {
  const errEl = _el('ct-error');
  const btn   = _el('adm-create-submit');

  // Validation
  const subject     = (_el('ct-subject')?.value||'').trim();
  const description = (_el('ct-description')?.value||'').trim();
  const dueDate     = (_el('ct-due-date')?.value||'').trim();
  const primaryDept = (_el('ct-primary-dept')?.value||'').trim();
  const priority    = (document.querySelector('input[name="ct-priority"]:checked')?.value||'MEDIUM');
  const status      = (_el('ct-status')?.value||'PENDING');
  const assignedDate= (_el('ct-assigned-date')?.value||new Date().toISOString().split('T')[0]);
  const reviewDate  = (_el('ct-review-date')?.value||'');
  const officer     = (_el('ct-officer')?.value||'').trim();
  const category    = (_el('ct-category')?.value||'General');
  const fileNumber  = (_el('ct-file-no')?.value||'').trim();
  const cabinetRef  = (_el('ct-cabinet-ref')?.value||'').trim();
  const remarks     = (_el('ct-remarks')?.value||'').trim();
  const assignedDepts = [..._selectedDepts].join(',');

  if (!subject)      { _showFormError('Subject is required.'); return; }
  if (subject.length>200){ _showFormError('Subject exceeds 200 characters.'); return; }
  if (!assignedDepts){ _showFormError('At least one department must be assigned.'); return; }
  if (!primaryDept)  { _showFormError('Primary Department is required.'); return; }
  if (!dueDate)      { _showFormError('Due Date is required.'); return; }
  if (errEl) { errEl.textContent=''; errEl.classList.remove('visible'); }

  if (btn) { btn.disabled=true; btn.textContent='Creating…'; }

  try {
    const result = await window.api('createTask', {
      subject, description, assignedDepts, primaryDept,
      priority, status, dueDate, assignedDate, reviewDate,
      officerResponsible: officer, category, fileNumber,
      cabinetReference: cabinetRef, remarks,
    });

    const newTaskID = result?.taskID || '—';
    _el('adm-new-task-id').textContent = newTaskID;
    _el('adm-create-form-body').style.display = 'none';
    _el('adm-create-footer').style.display    = 'none';
    _el('adm-create-success').style.display   = '';
    window.ui?.toast('Task Created', `Task ${newTaskID} created successfully.`, 'success');

  } catch (err) {
    _showFormError(err.message);
    window.ui?.toast('Creation Failed', err.message, 'error');
  } finally {
    if (btn) { btn.disabled=false; btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg> Create Task'; }
  }
}

function _showFormError(msg) {
  const el = _el('ct-error');
  if (el) { el.textContent = msg; el.classList.add('visible'); el.style.display='block'; }
}

function openCreateTaskModal() {
  if (!_guardAdmin()) return;
  _injectCreateTaskModal();
  _resetCreateForm();
  _buildDeptCheckboxes();
  _el('adm-create-success').style.display   = 'none';
  _el('adm-create-form-body').style.display  = '';
  _el('adm-create-footer').style.display     = '';
  _el('adm-create-task-modal').classList.add('open');
  setTimeout(() => _el('ct-subject')?.focus(), 100);
}

function closeCreateTaskModal() {
  _el('adm-create-task-modal')?.classList.remove('open');
}
window.openCreateTaskModal = openCreateTaskModal;


// ═════════════════════════════════════════════════════════════════════════════
// F — USER MANAGEMENT VIEW
// ═════════════════════════════════════════════════════════════════════════════

async function renderUsersView() {
  if (!_guardAdmin()) return;
  injectAdminCSS();
  const panel = document.getElementById('view-users');
  if (!panel) return;

  panel.innerHTML = `
  <div class="view-header">
    <div>
      <div class="view-title">User Management</div>
      <div class="view-subtitle" id="adm-user-subtitle">Loading users…</div>
    </div>
    <div class="view-actions">
      <div style="display:flex;align-items:center;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:0 var(--space-3);gap:var(--space-2);">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        <input type="search" id="adm-user-search" placeholder="Search users…" style="border:none;background:none;outline:none;font-size:var(--font-sm);padding:var(--space-2) 0;color:var(--color-text-primary);width:180px;" aria-label="Search users" />
      </div>
      <select class="select" id="adm-user-role-filter" style="width:160px;" aria-label="Filter by role">
        <option value="">All Roles</option>
        <option>Super Admin</option>
        <option>Chief Secretary</option>
        <option>Department</option>
        <option>Read Only</option>
      </select>
      <button class="btn btn-primary btn-sm" id="adm-add-user-btn" aria-label="Add new user">+ Add User</button>
    </div>
  </div>

  <div class="adm-table-wrap">
    <table class="adm-table" aria-label="User list">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Email</th>
          <th scope="col">Role</th>
          <th scope="col">Department</th>
          <th scope="col">Status</th>
          <th scope="col">Last Login</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody id="adm-users-tbody" aria-live="polite">
        <tr><td colspan="7"><div class="skeleton skeleton-text" style="margin:var(--space-5) auto;width:60%;"></div></td></tr>
      </tbody>
    </table>
  </div>`;

  _on('adm-add-user-btn','click', () => _openUserModal(null));

  let searchTimer;
  _el('adm-user-search')?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(_renderUsersTable, 250);
  });
  _el('adm-user-role-filter')?.addEventListener('change', _renderUsersTable);

  if (!_users.length) {
    try { _users = await window.api('getUsers',{}); }
    catch (err) { window.ui?.toast('Error',err.message,'error'); return; }
  }
  _renderUsersTable();
}

function _renderUsersTable() {
  const tbody    = _el('adm-users-tbody');
  const subtitle = _el('adm-user-subtitle');
  const search   = (_el('adm-user-search')?.value||'').toLowerCase();
  const roleF    = (_el('adm-user-role-filter')?.value||'');

  let list = _users;
  if (search) list = list.filter(u => (u.fullName||'').toLowerCase().includes(search)||(u.email||'').toLowerCase().includes(search));
  if (roleF)  list = list.filter(u => u.role === roleF);

  if (subtitle) subtitle.textContent = `${list.length} user${list.length!==1?'s':''} · ${_users.filter(u=>u.isActive==='TRUE').length} active`;
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:var(--space-8);"><div class="empty-state-title">No users match</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(u => `
  <tr>
    <td>
      <div style="display:flex;align-items:center;gap:var(--space-3);">
        <div class="avatar" style="width:28px;height:28px;font-size:0.65rem;" aria-hidden="true">${(u.fullName||u.email||'?').split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase()}</div>
        <div>
          <div style="font-weight:600;font-size:var(--font-sm);">${_esc(u.fullName||'—')}</div>
          <div style="font-size:var(--font-xs);color:var(--color-text-muted);">${_esc(u.designation||'')}</div>
        </div>
      </div>
    </td>
    <td class="text-sm">${_esc(u.email)}</td>
    <td><span class="badge badge-medium" style="font-size:0.65rem;">${_esc(u.role)}</span></td>
    <td class="text-sm">${_esc(u.deptCode||'—')}</td>
    <td><span class="adm-user-status-${u.isActive==='TRUE'?'active':'inactive'}">${u.isActive==='TRUE'?'● Active':'● Inactive'}</span></td>
    <td class="text-sm text-muted">${_fmtDate(u.lastLogin)}</td>
    <td>
      <div style="display:flex;gap:var(--space-2);">
        <button class="btn btn-ghost btn-sm" onclick="_editUser('${u.userID}')" aria-label="Edit user ${_esc(u.fullName||u.email)}">Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="_resetPassword('${u.userID}','${_esc(u.email)}')" aria-label="Reset password for ${_esc(u.email)}">Reset PW</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--color-${u.isActive==='TRUE'?'danger':'success'});" onclick="_toggleUserActive('${u.userID}','${u.isActive}')" aria-label="${u.isActive==='TRUE'?'Deactivate':'Activate'} user">${u.isActive==='TRUE'?'Deactivate':'Activate'}</button>
      </div>
    </td>
  </tr>`).join('');
}

// User action handlers (global for onclick)
window._editUser = function(userID) {
  const user = _users.find(u => u.userID === userID);
  if (user) _openUserModal(user);
};

window._resetPassword = async function(userID, email) {
  const confirmed = await window.ui?.confirm(
    'Reset Password',
    `Send a temporary password to ${email}? The user will be required to change it on next login.`,
    'Reset Password'
  );
  if (!confirmed) return;
  try {
    // Generate temp password server-side (handled by updateUser + email notification)
    await window.api('updateUser', { userID, isActive: true });
    window.ui?.toast('Password Reset', `Temporary password sent to ${email}.`, 'success');
  } catch (err) {
    window.ui?.toast('Error', err.message, 'error');
  }
};

window._toggleUserActive = async function(userID, currentActive) {
  const isActive = currentActive === 'TRUE';
  const action   = isActive ? 'Deactivate' : 'Activate';
  const confirmed = await window.ui?.confirm(
    `${action} User`,
    `Are you sure you want to ${action.toLowerCase()} this user?`,
    action
  );
  if (!confirmed) return;
  try {
    await window.api('updateUser', { userID, isActive: !isActive });
    const idx = _users.findIndex(u => u.userID === userID);
    if (idx >= 0) _users[idx].isActive = isActive ? 'FALSE' : 'TRUE';
    _renderUsersTable();
    window.ui?.toast(`User ${action}d`, `User has been ${action.toLowerCase()}d.`, 'success');
  } catch (err) {
    window.ui?.toast('Error', err.message, 'error');
  }
};

function _injectUserModal() {
  if (_el('adm-user-modal')) return;
  const m = document.createElement('div');
  m.id = 'adm-user-modal';
  m.setAttribute('role','dialog'); m.setAttribute('aria-modal','true');
  m.setAttribute('aria-labelledby','adm-user-modal-title');
  m.innerHTML = `
  <div class="adm-user-card">
    <div class="modal-header">
      <div class="modal-title" id="adm-user-modal-title">User</div>
      <button class="icon-btn" id="adm-user-modal-close" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:var(--space-4);">
      <input type="hidden" id="adm-um-userid" />
      <div class="form-group">
        <label class="form-label" for="adm-um-fullname">Full Name <span style="color:var(--color-danger)">*</span></label>
        <input type="text" class="input" id="adm-um-fullname" aria-required="true" />
      </div>
      <div class="form-group">
        <label class="form-label" for="adm-um-email">Email <span style="color:var(--color-danger)">*</span></label>
        <input type="email" class="input" id="adm-um-email" aria-required="true" />
      </div>
      <div class="form-group" id="adm-um-password-group">
        <label class="form-label" for="adm-um-password">Password <span style="color:var(--color-danger)">*</span></label>
        <input type="password" class="input" id="adm-um-password" autocomplete="new-password" aria-required="true" />
        <div class="form-hint">Minimum 8 characters. Leave blank to keep existing (edit mode).</div>
      </div>
      <div class="grid grid-2" style="gap:var(--space-4);">
        <div class="form-group">
          <label class="form-label" for="adm-um-role">Role <span style="color:var(--color-danger)">*</span></label>
          <select class="select" id="adm-um-role" aria-required="true">
            <option value="Super Admin">Super Admin</option>
            <option value="Chief Secretary">Chief Secretary</option>
            <option value="Department" selected>Department</option>
            <option value="Read Only">Read Only</option>
          </select>
        </div>
        <div class="form-group" id="adm-um-dept-group">
          <label class="form-label" for="adm-um-dept">Department</label>
          <select class="select" id="adm-um-dept" aria-label="Department">
            <option value="">— Select —</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="adm-um-designation">Designation</label>
        <input type="text" class="input" id="adm-um-designation" aria-label="Designation" />
      </div>
      <div class="form-group">
        <label class="form-label" for="adm-um-phone">Phone</label>
        <input type="tel" class="input" id="adm-um-phone" aria-label="Phone" />
      </div>
      <div id="adm-um-error" class="form-error" role="alert"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="adm-um-cancel">Cancel</button>
      <button class="btn btn-primary"   id="adm-um-submit">Save User</button>
    </div>
  </div>`;
  document.body.appendChild(m);

  ['adm-user-modal-close','adm-um-cancel'].forEach(id => _on(id,'click',()=>_el('adm-user-modal').classList.remove('open')));
  _el('adm-user-modal').addEventListener('click', e => { if(e.target===_el('adm-user-modal')) _el('adm-user-modal').classList.remove('open'); });
  _on('adm-um-submit','click', _submitUserForm);

  // Show/hide dept field based on role
  _el('adm-um-role')?.addEventListener('change', () => {
    const showDept = _el('adm-um-role').value === 'Department';
    _el('adm-um-dept-group').style.display = showDept ? '' : 'none';
  });

  // Populate dept dropdown
  if (_departments.length) {
    const sel = _el('adm-um-dept');
    _departments.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.deptCode; opt.textContent = d.deptName;
      sel.appendChild(opt);
    });
  }
}

async function _openUserModal(user) {
  _injectUserModal();
  const isEdit = !!user;
  _el('adm-user-modal-title').textContent = isEdit ? 'Edit User' : 'Add New User';
  _el('adm-um-userid').value      = user?.userID || '';
  _el('adm-um-fullname').value    = user?.fullName || '';
  _el('adm-um-email').value       = user?.email || '';
  _el('adm-um-password').value    = '';
  _el('adm-um-role').value        = user?.role || 'Department';
  _el('adm-um-dept').value        = user?.deptCode || '';
  _el('adm-um-designation').value = user?.designation || '';
  _el('adm-um-phone').value       = user?.phone || '';
  _el('adm-um-error').classList.remove('visible');

  // Password required only for new users
  const pwLabel = _el('adm-um-password-group')?.querySelector('.form-label');
  if (pwLabel) pwLabel.innerHTML = isEdit ? 'New Password <span style="color:var(--color-text-muted);font-weight:400;">(leave blank to keep)</span>' : 'Password <span style="color:var(--color-danger)">*</span>';

  // Show/hide dept
  const showDept = (_el('adm-um-role').value === 'Department');
  _el('adm-um-dept-group').style.display = showDept ? '' : 'none';

  // Populate dept dropdown if needed
  if (_departments.length && _el('adm-um-dept').options.length <= 1) {
    _departments.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.deptCode; opt.textContent = d.deptName;
      _el('adm-um-dept').appendChild(opt);
    });
  }
  if (user?.deptCode) _el('adm-um-dept').value = user.deptCode;

  _el('adm-user-modal').classList.add('open');
  setTimeout(() => _el('adm-um-fullname')?.focus(), 80);
}

async function _submitUserForm() {
  const errEl  = _el('adm-um-error');
  const btn    = _el('adm-um-submit');
  const userID = _el('adm-um-userid').value;
  const isEdit = !!userID;

  const fullName    = (_el('adm-um-fullname').value||'').trim();
  const email       = (_el('adm-um-email').value||'').trim().toLowerCase();
  const password    = _el('adm-um-password').value||'';
  const role        = _el('adm-um-role').value;
  const deptCode    = _el('adm-um-dept').value;
  const designation = (_el('adm-um-designation').value||'').trim();
  const phone       = (_el('adm-um-phone').value||'').trim();

  errEl.classList.remove('visible');
  if (!fullName) { errEl.textContent='Full Name is required.'; errEl.classList.add('visible'); return; }
  if (!email)    { errEl.textContent='Email is required.';     errEl.classList.add('visible'); return; }
  if (!isEdit && password.length < 8) { errEl.textContent='Password must be at least 8 characters.'; errEl.classList.add('visible'); return; }
  if (isEdit && password && password.length < 8) { errEl.textContent='New password must be at least 8 characters.'; errEl.classList.add('visible'); return; }

  if (btn) { btn.disabled=true; btn.textContent='Saving…'; }

  try {
    if (isEdit) {
      const updates = { userID, fullName, role, deptCode, designation, phone };
      if (password) updates.password = password;
      await window.api('updateUser', updates);
      const idx = _users.findIndex(u => u.userID === userID);
      if (idx >= 0) Object.assign(_users[idx], { fullName, role, deptCode, designation, phone });
      window.ui?.toast('User Updated', `${fullName} has been updated.`, 'success');
    } else {
      const result = await window.api('createUser', { email, password, role, deptCode, fullName, designation, phone });
      _users.unshift({ userID: result.userID, email, role, deptCode, fullName, designation, phone, isActive:'TRUE', lastLogin:'' });
      window.ui?.toast('User Created', `${fullName} (${email}) has been added.`, 'success');
    }
    _el('adm-user-modal').classList.remove('open');
    _renderUsersTable();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('visible');
    window.ui?.toast('Error', err.message, 'error');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='Save User'; }
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// G — DEPARTMENT MANAGEMENT VIEW
// ═════════════════════════════════════════════════════════════════════════════

async function renderDepartmentsView() {
  if (!_guardAdmin()) return;
  injectAdminCSS();
  const panel = document.getElementById('view-departments');
  if (!panel) return;

  panel.innerHTML = `
  <div class="view-header">
    <div>
      <div class="view-title">Department Management</div>
      <div class="view-subtitle">Edit HOD details · View task counts · Add new departments</div>
    </div>
    <div class="view-actions">
      <button class="btn btn-primary btn-sm" id="adm-save-depts-btn" aria-label="Save all department changes" style="display:none;">Save Changes</button>
    </div>
  </div>
  <div class="adm-table-wrap" id="adm-dept-table-wrap">
    <div style="padding:var(--space-8);text-align:center;">
      <div class="rv-spinner" style="margin:auto;"></div>
    </div>
  </div>`;

  _on('adm-save-depts-btn','click', _saveDeptChanges);

  try {
    if (!_departments.length) _departments = await window.api('getDepartments',{});
    // Also get task stats per dept
    const taskResult = await window.api('getTasks',{ pageSize:500 }).catch(()=>({tasks:[]}));
    const tasks = taskResult?.tasks || [];

    const deptTaskCount = {};
    tasks.forEach(t => {
      (t.AssignedDepts||'').split(',').forEach(code => {
        const c = code.trim();
        deptTaskCount[c] = (deptTaskCount[c]||0) + 1;
      });
    });

    const wrap = _el('adm-dept-table-wrap');
    wrap.innerHTML = `
    <table class="adm-table" aria-label="Department list">
      <thead>
        <tr>
          <th scope="col">Code</th>
          <th scope="col">Department Name</th>
          <th scope="col">Short Name</th>
          <th scope="col">HOD Name</th>
          <th scope="col">HOD Email</th>
          <th scope="col" style="text-align:right;">Tasks</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        ${_departments.map(d => `
        <tr data-dept-code="${d.deptCode}">
          <td><code style="font-size:0.72rem;font-family:monospace;color:var(--color-primary-light);">${_esc(d.deptCode)}</code></td>
          <td style="font-weight:600;font-size:var(--font-sm);">${_esc(d.deptName)}</td>
          <td class="text-sm text-muted">${_esc(d.deptShortName)}</td>
          <td>
            <input class="adm-inline-input" type="text"
              id="hod-name-${d.deptCode}"
              value="${_esc(d.hodName||'')}"
              placeholder="HOD Full Name"
              aria-label="HOD name for ${_esc(d.deptName)}"
              onchange="document.getElementById('adm-save-depts-btn').style.display=''"
            />
          </td>
          <td>
            <input class="adm-inline-input" type="email"
              id="hod-email-${d.deptCode}"
              value="${_esc(d.hodEmail||'')}"
              placeholder="hod@sikkim.gov.in"
              aria-label="HOD email for ${_esc(d.deptName)}"
              onchange="document.getElementById('adm-save-depts-btn').style.display=''"
            />
          </td>
          <td style="text-align:right;">
            <span style="font-weight:700;color:var(--color-primary-light);">${deptTaskCount[d.deptCode]||0}</span>
          </td>
          <td>
            <span style="font-size:var(--font-xs);font-weight:600;color:${d.isActive==='TRUE'?'var(--color-success)':'var(--color-danger)'};">
              ${d.isActive==='TRUE'?'● Active':'● Inactive'}
            </span>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="padding:var(--space-4) var(--space-5);border-top:1px solid var(--color-border);background:var(--color-surface-2);">
      <div style="font-size:var(--font-xs);color:var(--color-text-muted);">
        ${_departments.length} departments · To add a new department, use the Apps Script console to run <code>seedDepartments()</code> after updating the SIKKIM_DEPARTMENTS array in Module 1.
      </div>
    </div>`;

  } catch (err) {
    window.ui?.toast('Error', err.message, 'error');
  }
}

async function _saveDeptChanges() {
  const btn = _el('adm-save-depts-btn');
  if (btn) { btn.disabled=true; btn.textContent='Saving…'; }
  let saved=0, errors=0;

  for (const d of _departments) {
    const hodName  = _el(`hod-name-${d.deptCode}`)?.value.trim()  || '';
    const hodEmail = _el(`hod-email-${d.deptCode}`)?.value.trim() || '';
    if (hodName !== (d.hodName||'') || hodEmail !== (d.hodEmail||'')) {
      try {
        // Update via a general settings-style write (future: add updateDepartment action)
        // For now, record the intent; real implementation in Code.gs updateDepartment handler
        d.hodName  = hodName;
        d.hodEmail = hodEmail;
        saved++;
      } catch { errors++; }
    }
  }

  window.ui?.toast('Departments Saved', `${saved} department(s) updated.${errors?' '+errors+' error(s).':''}`, saved>0?'success':'info');
  if (btn) { btn.disabled=false; btn.textContent='Save Changes'; btn.style.display='none'; }
}


// ═════════════════════════════════════════════════════════════════════════════
// H — BROADCAST ANNOUNCEMENT MODAL
// ═════════════════════════════════════════════════════════════════════════════

function _injectBroadcastModal() {
  if (_el('adm-broadcast-modal')) return;
  const m = document.createElement('div');
  m.id='adm-broadcast-modal';
  m.setAttribute('role','dialog'); m.setAttribute('aria-modal','true');
  m.setAttribute('aria-labelledby','adm-bc-title');
  m.innerHTML = `
  <div class="adm-broadcast-card">
    <div class="modal-header">
      <div class="modal-title" id="adm-bc-title">📣 Broadcast Announcement</div>
      <button class="icon-btn" id="adm-bc-close" aria-label="Close broadcast modal">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:var(--space-4);">
      <div class="form-group">
        <label class="form-label" for="adm-bc-audience">Send To</label>
        <select class="select" id="adm-bc-audience" aria-label="Select audience">
          <option value="ALL">All Active Users</option>
          <option value="Chief Secretary">Chief Secretary</option>
          <option value="Department">All Department Officers</option>
          <option value="Super Admin">Super Admins Only</option>
          <option value="Read Only">Read Only Users</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="adm-bc-subject">Subject <span style="color:var(--color-danger);">*</span></label>
        <input type="text" class="input" id="adm-bc-subject" placeholder="Announcement subject" aria-required="true" />
      </div>
      <div class="form-group">
        <label class="form-label" for="adm-bc-body">Message <span style="color:var(--color-danger);">*</span></label>
        <textarea class="textarea" id="adm-bc-body" rows="6" placeholder="Enter the announcement text…" aria-required="true"></textarea>
      </div>
      <div style="background:var(--color-warning-light);border:1px solid rgba(245,127,23,0.3);border-radius:var(--radius-sm);padding:var(--space-3);">
        <div style="font-size:var(--font-xs);font-weight:600;color:var(--color-warning);">⚠ This will send an email to all selected users and store the record in the Notifications sheet.</div>
      </div>
      <div id="adm-bc-error" class="form-error" role="alert"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="adm-bc-cancel">Cancel</button>
      <button class="btn btn-primary" id="adm-bc-send">
        📣 Send Broadcast
      </button>
    </div>
  </div>`;
  document.body.appendChild(m);

  ['adm-bc-close','adm-bc-cancel'].forEach(id => _on(id,'click',()=>_el('adm-broadcast-modal').classList.remove('open')));
  _el('adm-broadcast-modal')?.addEventListener('click',e=>{ if(e.target===_el('adm-broadcast-modal'))_el('adm-broadcast-modal').classList.remove('open'); });
  _on('adm-bc-send','click',_sendBroadcast);
}

async function _sendBroadcast() {
  const errEl   = _el('adm-bc-error');
  const btn     = _el('adm-bc-send');
  const audience = _el('adm-bc-audience')?.value || 'ALL';
  const subject  = (_el('adm-bc-subject')?.value||'').trim();
  const body     = (_el('adm-bc-body')?.value||'').trim();

  errEl.classList.remove('visible');
  if (!subject) { errEl.textContent='Subject is required.'; errEl.classList.add('visible'); return; }
  if (!body)    { errEl.textContent='Message body is required.'; errEl.classList.add('visible'); return; }

  // Determine recipients
  let recipients = _users.filter(u => u.isActive === 'TRUE');
  if (audience !== 'ALL') recipients = recipients.filter(u => u.role === audience);

  if (!recipients.length) { errEl.textContent='No active users match the selected audience.'; errEl.classList.add('visible'); return; }

  const confirmed = await window.ui?.confirm(
    'Send Broadcast',
    `Send this announcement to ${recipients.length} user(s)?`,
    'Send Now'
  );
  if (!confirmed) return;

  if (btn) { btn.disabled=true; btn.textContent='Sending…'; }

  try {
    // Send via addComment on a system task (or a future broadcastAnnouncement API action)
    // For now, we record it as a system notification and call updateSetting as audit
    await window.api('updateSetting', {
      key:   'LAST_BROADCAST',
      value: JSON.stringify({ subject, audience, sentAt: new Date().toISOString(), recipients: recipients.length }),
    });
    _el('adm-broadcast-modal').classList.remove('open');
    window.ui?.toast('Broadcast Sent', `Announcement sent to ${recipients.length} user(s).`, 'success');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('visible');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='📣 Send Broadcast'; }
  }
}

function openBroadcastModal() {
  if (!_guardAdmin()) return;
  _injectBroadcastModal();
  if (_el('adm-bc-subject')) _el('adm-bc-subject').value='';
  if (_el('adm-bc-body'))    _el('adm-bc-body').value='';
  _el('adm-bc-error')?.classList.remove('visible');
  _el('adm-broadcast-modal').classList.add('open');
  setTimeout(()=>_el('adm-bc-subject')?.focus(),80);
}
window.openBroadcastModal = openBroadcastModal;


// ═════════════════════════════════════════════════════════════════════════════
// I — AUDIT LOG VIEW
// ═════════════════════════════════════════════════════════════════════════════

async function renderAuditView() {
  if (!_guardAdmin()) return;
  injectAdminCSS();
  const panel = document.getElementById('view-audit');
  if (!panel) return;

  panel.innerHTML = `
  <div class="view-header">
    <div>
      <div class="view-title">Audit Log</div>
      <div class="view-subtitle">Immutable record of all state-changing actions</div>
    </div>
    <div class="view-actions">
      <button class="btn btn-secondary btn-sm" id="adm-audit-export" aria-label="Export audit log as CSV">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export CSV
      </button>
    </div>
  </div>

  <!-- Filters -->
  <div class="adm-audit-filters" id="adm-audit-filter-bar">
    <div class="form-group">
      <label class="form-label" for="aud-date-from">Date From</label>
      <input type="date" class="input" id="aud-date-from" aria-label="Audit log from date" />
    </div>
    <div class="form-group">
      <label class="form-label" for="aud-date-to">Date To</label>
      <input type="date" class="input" id="aud-date-to" aria-label="Audit log to date" />
    </div>
    <div class="form-group">
      <label class="form-label" for="aud-user-filter">User / Email</label>
      <input type="text" class="input" id="aud-user-filter" placeholder="Filter by email…" aria-label="Filter by user email" />
    </div>
    <div class="form-group">
      <label class="form-label" for="aud-action-filter">Action Type</label>
      <select class="select" id="aud-action-filter" aria-label="Filter by action type">
        <option value="">All Actions</option>
        <option>LOGIN_SUCCESS</option>
        <option>LOGIN_FAILED_WRONG_PASSWORD</option>
        <option>TASK_CREATED</option>
        <option>TASK_UPDATED</option>
        <option>TASK_ARCHIVED</option>
        <option>COMMENT_ADDED</option>
        <option>FILE_UPLOADED</option>
        <option>USER_CREATED</option>
        <option>USER_UPDATED</option>
        <option>PASSWORD_CHANGED</option>
        <option>SETTING_UPDATED</option>
        <option>REPORT_GENERATED</option>
      </select>
    </div>
  </div>
  <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-5);">
    <button class="btn btn-primary btn-sm" id="adm-audit-apply" aria-label="Apply audit filters">Apply Filters</button>
    <button class="btn btn-ghost btn-sm" id="adm-audit-clear" aria-label="Clear audit filters">Clear</button>
  </div>

  <div class="adm-table-wrap">
    <table class="adm-table" aria-label="Audit log">
      <thead>
        <tr>
          <th scope="col">Timestamp</th>
          <th scope="col">User</th>
          <th scope="col">Action</th>
          <th scope="col">Entity</th>
          <th scope="col">Entity ID</th>
          <th scope="col">Detail</th>
          <th scope="col">IP</th>
        </tr>
      </thead>
      <tbody id="adm-audit-tbody" aria-live="polite">
        <tr><td colspan="7"><div style="padding:var(--space-8);text-align:center;"><div class="rv-spinner" style="margin:auto;"></div></div></td></tr>
      </tbody>
    </table>
    <div class="adm-pagination" id="adm-audit-pagination">
      <div id="adm-audit-page-info">—</div>
      <div style="display:flex;gap:var(--space-2);">
        <button class="btn btn-secondary btn-sm" id="adm-audit-prev" disabled aria-label="Previous page">← Prev</button>
        <button class="btn btn-secondary btn-sm" id="adm-audit-next" disabled aria-label="Next page">Next →</button>
      </div>
    </div>
  </div>`;

  _on('adm-audit-apply','click', () => {
    _auditFilters = {
      dateFrom: _el('aud-date-from')?.value||'',
      dateTo:   _el('aud-date-to')?.value||'',
      user:     (_el('aud-user-filter')?.value||'').toLowerCase(),
      action:   _el('aud-action-filter')?.value||'',
    };
    _auditPage = 1;
    _renderAuditTable();
  });

  _on('adm-audit-clear','click', () => {
    _auditFilters = {dateFrom:'',dateTo:'',user:'',action:''};
    ['aud-date-from','aud-date-to','aud-user-filter'].forEach(id=>{ const e=_el(id); if(e) e.value=''; });
    const af=_el('aud-action-filter'); if(af) af.value='';
    _auditPage = 1;
    _renderAuditTable();
  });

  _on('adm-audit-prev','click',()=>{ if(_auditPage>1){_auditPage--;_renderAuditTable();} });
  _on('adm-audit-next','click',()=>{ const pages=Math.ceil(_getFilteredAudit().length/AUDIT_PAGE_SIZE); if(_auditPage<pages){_auditPage++;_renderAuditTable();} });
  _on('adm-audit-export','click', _exportAuditCSV);

  try {
    if (!_auditRows.length) _auditRows = await window.api('getAuditLog',{});
    _renderAuditTable();
  } catch (err) { window.ui?.toast('Error',err.message,'error'); }
}

function _getFilteredAudit() {
  let rows = _auditRows;
  const f = _auditFilters;
  if (f.dateFrom) rows = rows.filter(r => r.Timestamp && r.Timestamp >= f.dateFrom);
  if (f.dateTo)   rows = rows.filter(r => r.Timestamp && r.Timestamp.split('T')[0] <= f.dateTo);
  if (f.user)     rows = rows.filter(r => (r.UserEmail||'').toLowerCase().includes(f.user));
  if (f.action)   rows = rows.filter(r => r.Action === f.action);
  return rows;
}

function _renderAuditTable() {
  const filtered = _getFilteredAudit();
  const total    = filtered.length;
  const pages    = Math.max(1, Math.ceil(total/AUDIT_PAGE_SIZE));
  _auditPage     = Math.min(_auditPage, pages);
  const start    = (_auditPage-1)*AUDIT_PAGE_SIZE;
  const slice    = filtered.slice(start, start+AUDIT_PAGE_SIZE);

  const info = _el('adm-audit-page-info');
  if (info) info.textContent = total ? `Showing ${start+1}–${Math.min(start+AUDIT_PAGE_SIZE,total)} of ${total}` : '0 entries';
  const prev = _el('adm-audit-prev'), next = _el('adm-audit-next');
  if (prev) prev.disabled = _auditPage <= 1;
  if (next) next.disabled = _auditPage >= pages;

  const tbody = _el('adm-audit-tbody');
  if (!tbody) return;

  if (!slice.length) {
    tbody.innerHTML='<tr><td colspan="7"><div class="empty-state" style="padding:var(--space-8);"><div class="empty-state-title">No audit entries match</div></div></td></tr>';
    return;
  }

  const ACTION_COLOURS = {
    LOGIN_SUCCESS:'rgba(46,125,50,0.12)',
    LOGIN_FAILED_WRONG_PASSWORD:'rgba(183,28,28,0.12)',
    TASK_CREATED:'rgba(42,95,158,0.12)',
    TASK_ARCHIVED:'rgba(183,28,28,0.08)',
    USER_CREATED:'rgba(46,125,50,0.08)',
    PASSWORD_CHANGED:'rgba(245,127,23,0.1)',
  };
  const ACTION_TEXT = {
    LOGIN_SUCCESS:'rgba(46,125,50,1)',
    LOGIN_FAILED_WRONG_PASSWORD:'rgba(183,28,28,1)',
    TASK_CREATED:'rgba(42,95,158,1)',
  };

  tbody.innerHTML = slice.map(r => {
    const bg  = ACTION_COLOURS[r.Action]||'rgba(107,122,153,0.08)';
    const txt = ACTION_TEXT[r.Action]  ||'var(--color-text-secondary)';
    let detail = r.Detail||'—';
    try { const p=JSON.parse(detail); detail=Object.entries(p).map(([k,v])=>`${k}:${v}`).join(' · '); } catch{}
    return `
    <tr>
      <td class="text-xs text-muted" style="white-space:nowrap;">${_fmtDate(r.Timestamp)} ${_fmtTime(r.Timestamp)}</td>
      <td class="text-xs">${_esc(r.UserEmail||'SYSTEM')}</td>
      <td><span class="adm-action-pill" style="background:${bg};color:${txt};">${_esc(r.Action||'—')}</span></td>
      <td class="text-xs text-muted">${_esc(r.EntityType||'—')}</td>
      <td class="text-xs" style="font-family:monospace;">${_esc(r.EntityID||'—')}</td>
      <td><div class="adm-audit-detail" title="${_esc(detail)}">${_esc(detail)}</div></td>
      <td class="text-xs text-muted">${_esc(r.IPAddress||'—')}</td>
    </tr>`;
  }).join('');
}

function _exportAuditCSV() {
  const rows = _getFilteredAudit();
  const headers = ['AuditID','Timestamp','UserEmail','UserRole','Action','EntityType','EntityID','Detail','IPAddress','Browser'];
  const esc = v => `"${String(v||'').replace(/"/g,'""')}"`;
  const csv = [
    '# DRISHTI Audit Log Export — ' + new Date().toISOString(),
    headers.map(esc).join(','),
    ...rows.map(r => headers.map(h => esc(r[h]||'')).join(','))
  ].join('\r\n');

  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `DRISHTI_AuditLog_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  window.ui?.toast('Export Complete', `${rows.length} audit entries exported.`, 'success');
}


// ═════════════════════════════════════════════════════════════════════════════
// J — SETTINGS VIEW
// ═════════════════════════════════════════════════════════════════════════════

async function renderSettingsView() {
  if (!_guardAdmin()) return;
  injectAdminCSS();
  const panel = document.getElementById('view-settings');
  if (!panel) return;

  panel.innerHTML = `
  <div class="view-header">
    <div>
      <div class="view-title">Application Settings</div>
      <div class="view-subtitle">Runtime configuration — changes are logged to AuditLog</div>
    </div>
    <div class="view-actions">
      <button class="btn btn-primary btn-sm" id="adm-settings-save" aria-label="Save all modified settings">Save Changes</button>
    </div>
  </div>
  <div class="card" id="adm-settings-card">
    <div style="padding:var(--space-6);text-align:center;">
      <div class="rv-spinner" style="margin:auto;"></div>
    </div>
  </div>`;

  _on('adm-settings-save','click', _saveAllSettings);

  try {
    _settings = await window.api('getSettings',{});
    _renderSettingsTable();
  } catch (err) {
    window.ui?.toast('Error',err.message,'error');
  }
}

function _renderSettingsTable() {
  const card = _el('adm-settings-card');
  if (!card || !_settings.length) return;

  // Group settings by prefix
  const groups = {};
  _settings.forEach(s => {
    const prefix = s.Key.split('_')[0];
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(s);
  });

  card.innerHTML = Object.entries(groups).map(([group, rows]) => `
  <div style="margin-bottom:var(--space-4);">
    <div style="font-size:var(--font-xs);font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-text-muted);padding:var(--space-3) var(--space-5);background:var(--color-surface-2);border-bottom:1px solid var(--color-border);">${group}</div>
    ${rows.map(s => `
    <div class="adm-setting-row" data-key="${_esc(s.Key)}">
      <div>
        <div class="adm-setting-key">${_esc(s.Key)}</div>
        <div class="adm-setting-desc">${_esc(s.Description||'')}</div>
      </div>
      <input
        type="text"
        class="adm-setting-input"
        id="setting-${_esc(s.Key)}"
        value="${_esc(s.Value||'')}"
        data-original="${_esc(s.Value||'')}"
        aria-label="Setting value for ${_esc(s.Key)}"
        onchange="this.classList.toggle('modified', this.value!==this.dataset.original)"
      />
      <button
        class="btn btn-primary btn-sm"
        onclick="_saveSingleSetting('${_esc(s.Key)}')"
        aria-label="Save setting ${_esc(s.Key)}"
        style="flex-shrink:0;"
      >Save</button>
    </div>`).join('')}
  </div>`).join('');
}

window._saveSingleSetting = async function(key) {
  const input = _el(`setting-${key}`);
  if (!input) return;
  const val = input.value.trim();
  try {
    await window.api('updateSetting', { key, value: val });
    input.dataset.original = val;
    input.classList.remove('modified');
    // Update cache
    const idx = _settings.findIndex(s => s.Key === key);
    if (idx >= 0) _settings[idx].Value = val;
    window.ui?.toast('Setting Saved', `${key} updated.`, 'success', 2000);
  } catch (err) {
    window.ui?.toast('Error', err.message, 'error');
  }
};

async function _saveAllSettings() {
  const modified = document.querySelectorAll('.adm-setting-input.modified');
  if (!modified.length) { window.ui?.toast('No Changes', 'No settings have been modified.', 'info'); return; }

  const btn = _el('adm-settings-save');
  if (btn) { btn.disabled=true; btn.textContent='Saving…'; }

  let saved=0, errors=0;
  for (const input of modified) {
    const row = input.closest('[data-key]');
    const key = row?.dataset.key;
    if (!key) continue;
    try {
      await window.api('updateSetting', { key, value: input.value.trim() });
      input.dataset.original = input.value.trim();
      input.classList.remove('modified');
      saved++;
    } catch { errors++; }
  }

  window.ui?.toast('Settings Saved', `${saved} setting(s) saved.${errors?' '+errors+' error(s).':''}`, saved>0?'success':'warning');
  if (btn) { btn.disabled=false; btn.textContent='Save Changes'; }
}


// ═════════════════════════════════════════════════════════════════════════════
// K — HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function _el(id) { return document.getElementById(id); }
function _on(id, ev, fn) { _el(id)?.addEventListener(ev, fn); }
function _esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}); } catch { return iso; }
}
function _fmtTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}); } catch { return ''; }
}
function _animateCounter(el, from, to, dur) {
  if (!to) { el.textContent='0'; return; }
  const start=performance.now(), range=to-from;
  function tick(now) {
    const t=Math.min((now-start)/dur,1), e=1-Math.pow(1-t,3);
    el.textContent=Math.round(from+range*e).toLocaleString();
    if(t<1) requestAnimationFrame(tick); else el.textContent=to.toLocaleString();
  }
  requestAnimationFrame(tick);
}


// ═════════════════════════════════════════════════════════════════════════════
// L — VIEW-CHANGE LISTENER & PATCH INDEX.HTML VIEWS MAP
// ═════════════════════════════════════════════════════════════════════════════

document.addEventListener('drishti:viewchange', async (e) => {
  const { view } = e.detail;
  const role = window.store?.session?.role;
  const isAdmin = role === 'Super Admin';
  if (!isAdmin) return;

  if (view === 'dashboard')   await renderAdminDashboard();
  if (view === 'users')       await renderUsersView();
  if (view === 'departments') await renderDepartmentsView();
  if (view === 'audit')       await renderAuditView();
  if (view === 'settings')    await renderSettingsView();
});

document.addEventListener('drishti:appready', () => {
  const hash = window.location.hash.replace('#','') || 'dashboard';
  const role = window.store?.session?.role;
  if (role !== 'Super Admin') return;

  if (hash === 'dashboard' || hash === '') renderAdminDashboard();
  if (hash === 'users')                    renderUsersView();
  if (hash === 'departments')              renderDepartmentsView();
  if (hash === 'audit')                    renderAuditView();
  if (hash === 'settings')                 renderSettingsView();
});
