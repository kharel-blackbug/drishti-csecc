/**
 * DRISHTI — Department User Dashboard & Task Views
 * File: dept.js
 *
 * Handles all UI for users with role === 'Department'.
 * Loaded by index.html as <script type="module" src="dept.js">.
 *
 * Routes handled:
 *   #dashboard  — Department Dashboard (intercepted when role === 'Department')
 *   #tasks      — Full task list with filters, sort, search
 *   #task/:id   — Slide-in task detail panel
 *
 * Architecture:
 *   - Dept Dashboard injects into #view-dashboard (same panel, different render)
 *   - Task list injects into #view-tasks
 *   - Task detail is a slide-in panel (#dept-task-panel) appended to body
 *   - Department role is STRICTLY enforced: department users can ONLY update
 *     ProgressPercent and Remarks; all other fields are read-only
 *
 * Future Departments:
 *   - New departments added to the Departments sheet are automatically
 *     available. DeptCode is the only coupling point; no code changes needed.
 *   - The department banner resolves DeptName/HODName live from the API.
 *   - All department-scoped filters use session.deptCode dynamically.
 *
 * Dependencies (window globals from index.html showApp()):
 *   window.api(action, payload)
 *   window.ui  — toast, confirm, _esc, setLoading
 *   window.router — navigate
 *   window.store  — { session }
 *
 * @version 6.3.0
 * @module  Department User Interface
 */

'use strict';

// ═════════════════════════════════════════════════════════════════════════════
// A — MODULE STATE
// ═════════════════════════════════════════════════════════════════════════════

/** @type {Object|null} Department info for the current user's dept */
let _dept        = null;
/** @type {Object[]} Full task list for current user's dept */
let _allTasks    = [];
/** @type {Object[]} Filtered + sorted task list */
let _filtered    = [];
/** @type {string} Active sort column key */
let _sortCol     = 'DueDate';
/** @type {'asc'|'desc'} Sort direction */
let _sortDir     = 'asc';
/** @type {number} Current page (1-indexed) */
let _page        = 1;
/** @type {number} Page size */
const PAGE_SIZE  = 20;
/** @type {Object} Active filter values */
let _filters     = { status: [], priority: [], dueDateFrom: '', dueDateTo: '', search: '' };
/** @type {string|null} Task ID of the currently open detail panel */
let _openTaskID  = null;
/** @type {Object[]} Comments for open task */
let _taskComments    = [];
/** @type {Object[]} Attachments for open task */
let _taskAttachments = [];
/** @type {boolean} Whether CSS has been injected */
let _cssInjected = false;
/** @type {boolean} Whether the slide-in panel DOM exists */
let _panelExists = false;
/** @type {Chart|null} Status doughnut chart instance */
let _deptChart   = null;

// Chart.js CDN — same version as dashboard.js and analytics.js
const CHART_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
let   _chartJSReady = null;

// ═════════════════════════════════════════════════════════════════════════════
// B — CSS INJECTION
// ═════════════════════════════════════════════════════════════════════════════

function injectDeptCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement('style');
  s.id = 'dept-styles';
  s.textContent = `
  /* ═══════════════════════════════════════════════════════════════
     DEPARTMENT DASHBOARD
  ═══════════════════════════════════════════════════════════════ */

  /* Department banner */
  .dept-banner {
    background: linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 60%, var(--color-primary-light) 100%);
    border-radius: var(--radius-lg);
    padding: var(--space-8) var(--space-8);
    margin-bottom: var(--space-6);
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
  }
  .dept-banner::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 80% 50%, rgba(201,168,76,0.12) 0%, transparent 60%);
    pointer-events: none;
  }
  .dept-banner-left { position: relative; z-index: 1; }
  .dept-banner-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    background: rgba(201,168,76,0.2);
    border: 1px solid rgba(201,168,76,0.4);
    color: var(--color-accent-light);
    font-size: var(--font-xs);
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 3px 12px;
    border-radius: var(--radius-full);
    margin-bottom: var(--space-3);
  }
  .dept-banner-name {
    font-size: var(--font-2xl);
    font-weight: 800;
    color: #fff;
    line-height: 1.2;
    margin-bottom: var(--space-2);
  }
  .dept-banner-hod {
    font-size: var(--font-sm);
    color: rgba(255,255,255,0.65);
  }
  .dept-banner-hod strong { color: rgba(255,255,255,0.9); }
  .dept-banner-code {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .dept-code-badge {
    font-size: 3rem;
    font-weight: 900;
    color: rgba(201,168,76,0.3);
    letter-spacing: -0.02em;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .dept-banner-date {
    font-size: var(--font-xs);
    color: rgba(255,255,255,0.4);
  }

  /* KPI row */
  .dept-kpi-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-4);
    margin-bottom: var(--space-6);
  }
  .dept-kpi {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    box-shadow: var(--shadow-sm);
    position: relative;
    overflow: hidden;
    transition: transform var(--transition), box-shadow var(--transition);
  }
  .dept-kpi:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
  .dept-kpi::after {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    background: var(--dkpi-clr, var(--color-primary));
  }
  .dept-kpi-icon {
    width: 36px; height: 36px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--dkpi-clr, var(--color-primary)) 12%, transparent);
    color: var(--dkpi-clr, var(--color-primary));
    display: flex; align-items: center; justify-content: center;
    margin-bottom: var(--space-3);
    font-size: 1.1rem;
  }
  .dept-kpi-val {
    font-size: 2rem;
    font-weight: 800;
    color: var(--color-text-primary);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .dept-kpi-label {
    font-size: var(--font-sm);
    color: var(--color-text-secondary);
    font-weight: 500;
    margin-top: 4px;
  }

  /* Row 2 — tasks list + recent comments */
  .dept-row2 {
    display: grid;
    grid-template-columns: 58% 1fr;
    gap: var(--space-5);
    margin-bottom: var(--space-6);
  }

  /* Quick task list in dashboard */
  .dept-task-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--color-border);
    cursor: pointer;
    transition: background var(--transition);
    border-radius: var(--radius-xs);
  }
  .dept-task-row:last-child { border-bottom: none; }
  .dept-task-row:hover { background: var(--color-surface-2); padding-left: var(--space-2); }
  .dept-task-info { flex: 1; min-width: 0; }
  .dept-task-subject {
    font-size: var(--font-sm);
    font-weight: 600;
    color: var(--color-text-primary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .dept-task-meta { font-size: var(--font-xs); color: var(--color-text-muted); margin-top: 2px; }
  .dept-mini-progress {
    width: 64px;
    height: 5px;
    background: var(--color-surface-3);
    border-radius: var(--radius-full);
    overflow: hidden;
    flex-shrink: 0;
  }
  .dept-mini-progress-fill {
    height: 100%;
    border-radius: var(--radius-full);
    background: var(--color-primary-light);
    transition: width 0.6s ease;
  }

  /* Comment item in dashboard */
  .dept-comment-item {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--transition);
    border-bottom: 1px solid var(--color-border);
  }
  .dept-comment-item:last-child { border-bottom: none; }
  .dept-comment-item:hover { background: var(--color-surface-2); }
  .dept-comment-task-id { font-size: var(--font-xs); font-weight: 700; color: var(--color-primary-light); }
  .dept-comment-text {
    font-size: var(--font-sm);
    color: var(--color-text-primary);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .dept-comment-meta { font-size: var(--font-xs); color: var(--color-text-muted); }

  /* Row 3 — deadlines + chart */
  .dept-row3 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-5);
    margin-bottom: var(--space-6);
  }
  .dept-deadline-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--color-border);
  }
  .dept-deadline-item:last-child { border-bottom: none; }
  .dept-days-badge {
    flex-shrink: 0;
    width: 40px; height: 40px;
    border-radius: var(--radius-sm);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    font-weight: 800;
    font-size: 0.9rem;
    line-height: 1;
  }
  .dept-days-badge.urgent  { background: var(--color-danger-light);  color: var(--color-danger); }
  .dept-days-badge.soon    { background: var(--color-warning-light); color: var(--color-warning); }
  .dept-days-badge.ok      { background: var(--color-success-light); color: var(--color-success); }
  .dept-days-badge span    { font-size: 0.55rem; font-weight: 500; }
  .dept-deadline-info { flex: 1; min-width: 0; }
  .dept-deadline-subject {
    font-size: var(--font-sm); font-weight: 600;
    color: var(--color-text-primary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .dept-deadline-date { font-size: var(--font-xs); color: var(--color-text-muted); }

  /* ═══════════════════════════════════════════════════════════════
     TASK LIST VIEW
  ═══════════════════════════════════════════════════════════════ */

  .dept-tasklist-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-5);
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .dept-search-bar {
    display: flex;
    align-items: center;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-3);
    gap: var(--space-2);
    flex: 0 1 280px;
    transition: border-color var(--transition), box-shadow var(--transition);
  }
  .dept-search-bar:focus-within {
    border-color: var(--color-border-focus);
    box-shadow: 0 0 0 3px rgba(42,95,158,0.1);
  }
  .dept-search-bar input {
    border: none; background: none; outline: none;
    font-size: var(--font-sm); color: var(--color-text-primary);
    padding: var(--space-2) 0; width: 100%;
  }
  .dept-search-bar input::placeholder { color: var(--color-text-muted); }

  /* Filter panel */
  .dept-filter-panel {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    margin-bottom: var(--space-4);
    display: none;
    box-shadow: var(--shadow-sm);
    animation: fadeIn 0.2s ease;
  }
  .dept-filter-panel.open { display: block; }
  .dept-filter-row { display: flex; gap: var(--space-6); flex-wrap: wrap; }
  .dept-filter-group { display: flex; flex-direction: column; gap: var(--space-2); }
  .dept-filter-label {
    font-size: var(--font-xs); font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }
  .dept-check-group { display: flex; flex-direction: column; gap: var(--space-2); }
  .dept-check-item {
    display: flex; align-items: center; gap: var(--space-2);
    font-size: var(--font-sm); color: var(--color-text-primary);
    cursor: pointer;
  }
  .dept-check-item input[type="checkbox"] { width: 14px; height: 14px; accent-color: var(--color-primary); }

  /* Task table */
  .dept-table-wrap {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
  }
  .dept-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-sm);
  }
  .dept-table th {
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-weight: 600;
    font-size: var(--font-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: var(--space-3) var(--space-4);
    text-align: left;
    white-space: nowrap;
    border-bottom: 1px solid var(--color-border);
    user-select: none;
  }
  .dept-table th.sortable { cursor: pointer; }
  .dept-table th.sortable:hover { background: var(--color-surface-3); }
  .dept-table th.sort-asc::after  { content: ' ↑'; color: var(--color-primary); }
  .dept-table th.sort-desc::after { content: ' ↓'; color: var(--color-primary); }
  .dept-table td {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text-primary);
    vertical-align: middle;
  }
  .dept-table tr:last-child td { border-bottom: none; }
  .dept-table tbody tr {
    cursor: pointer;
    transition: background var(--transition);
  }
  .dept-table tbody tr:hover { background: var(--color-surface-2); }
  .dept-table tbody tr.overdue-row { background: rgba(183,28,28,0.03); }
  .dept-table tbody tr.overdue-row:hover { background: rgba(183,28,28,0.07); }

  /* Pagination */
  .dept-pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--color-border);
    background: var(--color-surface-2);
  }
  .dept-page-info { font-size: var(--font-xs); color: var(--color-text-muted); }
  .dept-page-btns { display: flex; gap: var(--space-2); }

  /* ═══════════════════════════════════════════════════════════════
     TASK DETAIL SLIDE-IN PANEL
  ═══════════════════════════════════════════════════════════════ */

  #dept-task-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(680px, 95vw);
    background: var(--color-surface);
    box-shadow: var(--shadow-xl);
    z-index: 5000;
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    transition: transform var(--transition-slow);
    border-left: 1px solid var(--color-border);
  }
  #dept-task-panel.open { transform: translateX(0); }

  #dept-panel-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.35);
    backdrop-filter: blur(2px);
    z-index: 4999;
    opacity: 0;
    visibility: hidden;
    transition: opacity var(--transition-slow), visibility var(--transition-slow);
  }
  #dept-panel-backdrop.open { opacity: 1; visibility: visible; }

  .dp-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface-2);
    flex-shrink: 0;
  }
  .dp-task-id {
    font-family: monospace;
    font-size: var(--font-sm);
    font-weight: 700;
    color: var(--color-primary-light);
    background: rgba(42,95,158,0.1);
    padding: 2px 8px;
    border-radius: var(--radius-xs);
  }
  .dp-close {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    width: 32px; height: 32px;
    border-radius: var(--radius-sm);
    display: flex; align-items: center; justify-content: center;
    transition: color var(--transition), background var(--transition);
  }
  .dp-close:hover { color: var(--color-danger); background: var(--color-danger-light); }

  /* Panel tabs */
  .dp-tabs {
    display: flex;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface-2);
    flex-shrink: 0;
  }
  .dp-tab {
    flex: 1;
    padding: var(--space-3);
    border: none; background: none;
    font-family: inherit;
    font-size: var(--font-sm); font-weight: 600;
    color: var(--color-text-secondary);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all var(--transition);
    display: flex; align-items: center; justify-content: center; gap: var(--space-2);
  }
  .dp-tab:hover { color: var(--color-text-primary); background: var(--color-surface-3); }
  .dp-tab.active { color: var(--color-primary); border-bottom-color: var(--color-primary); background: var(--color-surface); }
  .dp-tab-badge {
    background: var(--color-primary);
    color: #fff;
    font-size: 0.65rem;
    font-weight: 700;
    border-radius: var(--radius-full);
    padding: 1px 6px; min-width: 18px;
    text-align: center;
  }

  /* Tab content */
  .dp-tab-content { display: none; flex: 1; flex-direction: column; overflow: hidden; }
  .dp-tab-content.active { display: flex; }

  /* Task info section */
  .dp-info-section {
    overflow-y: auto;
    padding: var(--space-5);
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-border);
    scrollbar-width: thin;
  }
  .dp-subject {
    font-size: var(--font-lg);
    font-weight: 800;
    color: var(--color-text-primary);
    margin-bottom: var(--space-3);
    line-height: 1.3;
  }
  .dp-badges { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-4); }
  .dp-meta-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2) var(--space-5);
    margin-bottom: var(--space-4);
  }
  .dp-meta-item { display: flex; flex-direction: column; gap: 2px; }
  .dp-meta-label {
    font-size: var(--font-xs); font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--color-text-muted);
  }
  .dp-meta-value { font-size: var(--font-sm); font-weight: 600; color: var(--color-text-primary); }

  /* Progress update form */
  .dp-progress-form {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    margin-top: var(--space-4);
  }
  .dp-progress-form-title {
    font-size: var(--font-sm);
    font-weight: 700;
    color: var(--color-primary);
    margin-bottom: var(--space-4);
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .dp-slider-wrap {
    position: relative;
    margin-bottom: var(--space-3);
  }
  .dp-slider-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-2);
  }
  .dp-slider-label { font-size: var(--font-sm); font-weight: 600; color: var(--color-text-primary); }
  .dp-slider-pct {
    font-size: var(--font-xl);
    font-weight: 800;
    color: var(--color-primary);
    min-width: 56px;
    text-align: right;
    transition: color var(--transition);
  }
  .dp-slider-pct.low  { color: var(--color-danger); }
  .dp-slider-pct.mid  { color: var(--color-warning); }
  .dp-slider-pct.high { color: var(--color-success); }

  input[type="range"].dp-range {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--color-surface-3);
    outline: none;
    cursor: pointer;
    transition: background 0.3s ease;
  }
  input[type="range"].dp-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 22px; height: 22px;
    border-radius: 50%;
    background: var(--color-primary);
    border: 3px solid var(--color-surface);
    box-shadow: var(--shadow-sm);
    cursor: pointer;
    transition: background var(--transition), transform var(--transition);
  }
  input[type="range"].dp-range:hover::-webkit-slider-thumb { transform: scale(1.2); }
  input[type="range"].dp-range::-moz-range-thumb {
    width: 22px; height: 22px;
    border-radius: 50%;
    background: var(--color-primary);
    border: 3px solid var(--color-surface);
    box-shadow: var(--shadow-sm);
    cursor: pointer;
  }
  .dp-progress-visual {
    height: 8px;
    background: var(--color-surface-3);
    border-radius: var(--radius-full);
    overflow: hidden;
    margin-top: var(--space-2);
  }
  .dp-progress-fill {
    height: 100%;
    border-radius: var(--radius-full);
    transition: width 0.4s ease, background 0.3s ease;
  }
  .dp-progress-fill.low  { background: linear-gradient(90deg,#B71C1C,#EF5350); }
  .dp-progress-fill.mid  { background: linear-gradient(90deg,#F57F17,#FFB300); }
  .dp-progress-fill.high { background: linear-gradient(90deg,#2E7D32,#43A047); }

  /* Comments in slide panel */
  .dp-comments-wrap {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) transparent;
  }
  .dp-bubble-wrap {
    display: flex;
    flex-direction: column;
    gap: 3px;
    animation: fadeIn 0.2s ease backwards;
  }
  .dp-bubble-wrap.mine  { align-items: flex-end; }
  .dp-bubble-wrap.theirs{ align-items: flex-start; }
  .dp-bubble {
    max-width: 85%;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    font-size: var(--font-sm);
    line-height: 1.55;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .dp-bubble-wrap.mine .dp-bubble {
    background: var(--color-primary);
    color: #fff;
    border-radius: var(--radius-md) var(--radius-xs) var(--radius-md) var(--radius-md);
  }
  .dp-bubble-wrap.theirs .dp-bubble {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xs) var(--radius-md) var(--radius-md) var(--radius-md);
  }
  .dp-bubble-head {
    display: flex; align-items: center; gap: var(--space-2);
    flex-wrap: wrap; margin-bottom: var(--space-1);
  }
  .dp-bubble-author { font-weight: 700; font-size: var(--font-xs); }
  .dp-bubble-role   { font-size: 0.65rem; opacity: 0.7; }
  .dp-bubble-meta   {
    font-size: 0.65rem;
    color: var(--color-text-muted);
    padding: 0 var(--space-1);
  }
  .dp-cat-badge {
    display: inline-flex; align-items: center; gap: 3px;
    padding: 1px 7px;
    border-radius: var(--radius-full);
    font-size: 0.65rem; font-weight: 700;
    white-space: nowrap;
  }
  .dp-cat-observation  { background: rgba(107,122,153,0.15); color: var(--color-text-secondary); }
  .dp-cat-direction    { background: rgba(26,58,92,0.15);    color: var(--color-primary); }
  .dp-cat-attention    { background: rgba(183,28,28,0.15);   color: var(--color-danger); }
  .dp-cat-appreciation { background: rgba(46,125,50,0.15);   color: var(--color-success); }
  .dp-cat-reminder     { background: rgba(245,127,23,0.15);  color: var(--color-warning); }
  .dp-bubble-wrap.mine .dp-cat-direction    { background: rgba(201,168,76,0.25); color: var(--color-accent-light); }
  .dp-bubble-wrap.mine .dp-cat-observation  { background: rgba(255,255,255,0.15); color: rgba(255,255,255,0.8); }
  .dp-bubble-wrap.mine .dp-cat-attention    { background: rgba(255,100,100,0.25); color: #ff8a80; }
  .dp-bubble-wrap.mine .dp-cat-appreciation { background: rgba(100,255,100,0.15); color: #a5d6a7; }
  .dp-bubble-wrap.mine .dp-cat-reminder     { background: rgba(255,200,100,0.2);  color: #ffe082; }

  /* Comment input in panel */
  .dp-comment-input-area {
    border-top: 1px solid var(--color-border);
    flex-shrink: 0;
    background: var(--color-surface);
  }
  .dp-input-toolbar {
    display: flex; align-items: center; gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface-2);
  }
  .dp-cat-select {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    font-size: var(--font-xs);
    font-weight: 600;
    font-family: inherit;
    padding: 3px 8px;
    color: var(--color-text-primary);
    outline: none;
    cursor: pointer;
  }
  #dp-comment-box {
    min-height: 56px;
    max-height: 120px;
    overflow-y: auto;
    padding: var(--space-3) var(--space-4);
    font-size: var(--font-sm);
    font-family: inherit;
    color: var(--color-text-primary);
    line-height: 1.6;
    outline: none;
    white-space: pre-wrap;
    word-break: break-word;
  }
  #dp-comment-box:empty::before {
    content: attr(data-placeholder);
    color: var(--color-text-muted);
    pointer-events: none;
  }
  .dp-input-actions {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--color-border);
    background: var(--color-surface-2);
  }
  .dp-input-hint { font-size: 0.65rem; color: var(--color-text-muted); }

  /* Attachments in panel */
  .dp-attach-wrap { flex: 1; overflow-y: auto; padding: var(--space-4); }
  .dp-upload-zone {
    border: 2px dashed var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    text-align: center;
    cursor: pointer;
    transition: border-color var(--transition), background var(--transition);
    background: var(--color-surface-2);
    margin-bottom: var(--space-4);
  }
  .dp-upload-zone:hover, .dp-upload-zone.drag-over {
    border-color: var(--color-primary-light);
    background: rgba(42,95,158,0.05);
  }
  .dp-file-list { display: flex; flex-direction: column; gap: var(--space-3); }
  .dp-file-item {
    display: flex; align-items: center; gap: var(--space-3);
    padding: var(--space-3);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
  }
  .dp-file-icon-box {
    width: 36px; height: 36px;
    background: var(--color-surface-3);
    border-radius: var(--radius-sm);
    display: flex; align-items: center; justify-content: center;
    font-size: 1.2rem;
    flex-shrink: 0;
  }
  .dp-file-info { flex: 1; min-width: 0; }
  .dp-file-name { font-size: var(--font-sm); font-weight: 600; color: var(--color-text-primary); truncate: true; }
  .dp-file-meta { font-size: var(--font-xs); color: var(--color-text-muted); }

  /* AI panel in slide panel */
  .dp-ai-wrap { flex: 1; overflow-y: auto; padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-4); }
  .dp-ai-summary {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-left: 4px solid var(--color-accent);
    border-radius: var(--radius-sm);
    padding: var(--space-4);
    font-size: var(--font-sm);
    line-height: 1.75;
    white-space: pre-wrap;
    color: var(--color-text-primary);
  }
  .dp-typing { display: flex; gap: 5px; align-items: center; padding: var(--space-3); }
  .dp-typing-dot {
    width: 6px; height: 6px;
    background: var(--color-text-muted);
    border-radius: 50%;
    animation: rv-bounce 1.2s ease-in-out infinite;
  }
  .dp-typing-dot:nth-child(2) { animation-delay: 0.2s; }
  .dp-typing-dot:nth-child(3) { animation-delay: 0.4s; }

  /* ═══════════════════════════════════════════════════════════════
     RESPONSIVE
  ═══════════════════════════════════════════════════════════════ */
  @media (max-width: 1024px) {
    .dept-kpi-row { grid-template-columns: repeat(2, 1fr); }
    .dept-row2    { grid-template-columns: 1fr; }
    .dept-row3    { grid-template-columns: 1fr; }
  }
  @media (max-width: 768px) {
    .dept-kpi-row { grid-template-columns: repeat(2, 1fr); }
    .dept-banner  { flex-direction: column; gap: var(--space-4); }
    .dept-banner-code { align-items: flex-start; }
    #dept-task-panel { width: 100vw; }
  }
  @media (max-width: 480px) {
    .dept-kpi-row { grid-template-columns: 1fr 1fr; }
  }
  `;
  document.head.appendChild(s);
}


// ═════════════════════════════════════════════════════════════════════════════
// C — CHART.JS LOADER
// ═════════════════════════════════════════════════════════════════════════════

function _loadChartJS() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (_chartJSReady) return _chartJSReady;
  _chartJSReady = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = CHART_CDN; s.async = true;
    s.integrity = 'sha512-ZpOF0cDnEGdKR7bQOIKa9UcMXqNOBCe22I3oTEiVVYdqKHLBGFTJ3kCRjJgvJEzGxmpB0aTe7O8VmF4MFPPA==';
    s.crossOrigin = 'anonymous';
    s.onload = () => res(window.Chart);
    s.onerror = () => rej(new Error('Chart.js CDN load failed'));
    document.head.appendChild(s);
  });
  return _chartJSReady;
}


// ═════════════════════════════════════════════════════════════════════════════
// D — DEPARTMENT DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Main entry — renders the Department Dashboard into #view-dashboard.
 * Only called when session.role === 'Department'.
 */
async function renderDeptDashboard() {
  injectDeptCSS();
  const panel = document.getElementById('view-dashboard');
  if (!panel) return;

  // Show loading state
  panel.innerHTML = `
  <div style="padding:var(--space-8);text-align:center;color:var(--color-text-muted);">
    <div class="rv-spinner" style="margin:0 auto var(--space-4);"></div>
    Loading your department dashboard…
  </div>`;

  const session = window.store?.session;
  const deptCode = session?.deptCode;

  // Fetch in parallel — use getDashboardStats for KPI counts, getTasks for task list
  let depts = [], tasks = [], comments = [], stats = {};
  try {
    [depts, { tasks = [] } = {}, stats] = await Promise.all([
      window.api('getDepartments', {}),
      window.api('getTasks', { pageSize: 50 }),
      window.api('getDashboardStats', {}).catch(() => ({})),
    ]);
  } catch (err) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-state-title">Failed to load dashboard</div><div class="empty-state-desc">${_esc(err.message)}</div></div>`;
    return;
  }

  // Resolve department info — supports any future department automatically
  _dept = depts.find(d => d.deptCode === deptCode) || {
    deptCode: deptCode || '—',
    deptName: 'Your Department',
    deptShortName: deptCode || '—',
    hodName:  session?.fullName || '—',
    hodEmail: session?.email || '',
  };
  _allTasks = tasks;

  // KPIs — sourced from getDashboardStats for accuracy (server-side, role-filtered)
  const myTasks    = stats.totalTasks  ?? tasks.length;
  const pending    = stats.pending     ?? tasks.filter(t => t.Status === 'PENDING').length;
  const inProgress = stats.inProgress  ?? tasks.filter(t => t.Status === 'IN_PROGRESS').length;
  const completed  = stats.completed   ?? tasks.filter(t => t.Status === 'COMPLETED').length;

  // Upcoming (next 7 days, not completed)
  const today   = new Date(); today.setHours(0,0,0,0);
  const in7     = new Date(today.getTime() + 7*86400000);
  const upcoming = tasks
    .filter(t => t.Status !== 'COMPLETED' && t.DueDate)
    .filter(t => { const d = new Date(t.DueDate); return d >= today && d <= in7; })
    .sort((a,b) => new Date(a.DueDate) - new Date(b.DueDate));

  // Recent tasks for the dashboard list (top 6 by last updated)
  const recentTasks = [...tasks]
    .sort((a,b) => new Date(b.LastUpdatedAt||b.CreatedAt) - new Date(a.LastUpdatedAt||a.CreatedAt))
    .slice(0, 6);

  // Fetch recent comments on my tasks
  try {
    const taskIDs = recentTasks.slice(0,3).map(t => t.TaskID);
    const commentArrays = await Promise.all(
      taskIDs.map(id => window.api('getComments', { taskID: id }).catch(() => []))
    );
    comments = commentArrays.flat()
      .sort((a,b) => new Date(b.Timestamp) - new Date(a.Timestamp))
      .slice(0, 8);
  } catch { /* non-fatal */ }

  panel.innerHTML = _buildDashboardHTML({
    deptName: _dept.deptName,
    deptCode: _dept.deptCode,
    hodName:  _dept.hodName,
    kpi: { myTasks, pending, inProgress, completed },
    recentTasks,
    comments,
    upcoming,
    tasks,
  });

  // Animate KPI counters
  panel.querySelectorAll('[data-count-to]').forEach(el => {
    _animateCounter(el, 0, parseInt(el.dataset.countTo, 10) || 0, 900);
  });

  // Render doughnut chart
  _renderDeptChart(tasks);

  // Wire task row clicks
  panel.querySelectorAll('[data-task-id]').forEach(row => {
    row.addEventListener('click', () => openTaskPanel(row.dataset.taskId));
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
    });
  });
}

/** Builds the dashboard HTML string */
function _buildDashboardHTML({ deptName, deptCode, hodName, kpi, recentTasks, comments, upcoming, tasks }) {
  const today = new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  const kpiDefs = [
    { label:'My Tasks',   val: kpi.myTasks,    icon:'📋', clr:'var(--color-primary)' },
    { label:'Pending',    val: kpi.pending,     icon:'⏳', clr:'var(--color-warning)' },
    { label:'In Progress',val: kpi.inProgress,  icon:'⚙', clr:'var(--color-primary-light)' },
    { label:'Completed',  val: kpi.completed,   icon:'✅', clr:'var(--color-success)' },
  ];

  return `
  <!-- Department Banner -->
  <div class="dept-banner" role="banner">
    <div class="dept-banner-left">
      <div class="dept-banner-badge">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
        Department Portal
      </div>
      <div class="dept-banner-name">${_esc(deptName)}</div>
      <div class="dept-banner-hod">Head of Department: <strong>${_esc(hodName || 'Not assigned')}</strong></div>
    </div>
    <div class="dept-banner-code">
      <div class="dept-code-badge" aria-hidden="true">${_esc(deptCode)}</div>
      <div class="dept-banner-date">${today}</div>
    </div>
  </div>

  <!-- KPI Cards -->
  <div class="dept-kpi-row" role="list" aria-label="Key performance indicators">
    ${kpiDefs.map(k => `
    <div class="dept-kpi" style="--dkpi-clr:${k.clr};" role="listitem" aria-label="${k.label}: ${k.val}">
      <div class="dept-kpi-icon" aria-hidden="true">${k.icon}</div>
      <div class="dept-kpi-val" data-count-to="${k.val}">0</div>
      <div class="dept-kpi-label">${k.label}</div>
    </div>`).join('')}
  </div>

  <!-- Row 2 -->
  <div class="dept-row2">
    <!-- Recent Tasks list -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">My Tasks</div>
        <button class="btn btn-ghost btn-sm" onclick="window.router && window.router.navigate('tasks')" aria-label="View all tasks">View All →</button>
      </div>
      ${recentTasks.length ? recentTasks.map(t => `
      <div class="dept-task-row" role="button" tabindex="0" data-task-id="${t.TaskID}" aria-label="Open task ${t.TaskID}: ${_esc(t.Subject)}">
        <div class="dept-task-info">
          <div class="dept-task-subject">${_esc(t.Subject)}</div>
          <div class="dept-task-meta">${t.TaskID} · Due ${_fmtDate(t.DueDate)}</div>
        </div>
        <span class="badge badge-${(t.Priority||'low').toLowerCase()}" style="flex-shrink:0;">${t.Priority}</span>
        <span class="status-pill status-${(t.Status||'pending').toLowerCase().replace('_','-')}" style="flex-shrink:0;font-size:0.65rem;">${_fmtStatus(t.Status)}</span>
        <div class="dept-mini-progress" aria-label="${t.ProgressPercent||0}% complete" aria-hidden="true">
          <div class="dept-mini-progress-fill" style="width:${t.ProgressPercent||0}%"></div>
        </div>
      </div>`).join('') : `<div class="empty-state" style="padding:var(--space-6);"><div class="empty-state-desc">No tasks assigned to your department yet.</div></div>`}
    </div>

    <!-- Recent Comments -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">Recent Directions & Comments</div>
        <span class="badge badge-medium">${comments.length} recent</span>
      </div>
      ${comments.length ? comments.map(c => `
      <div class="dept-comment-item" role="button" tabindex="0" data-task-id="${c.TaskID}" aria-label="View comment on task ${c.TaskID}">
        <div class="dept-comment-task-id">
          ${c.TaskID}
          <span class="dp-cat-badge dp-cat-${_catKey(c.Category)}" style="margin-left:4px;">${_catIcon(c.Category)} ${_esc(c.Category)}</span>
        </div>
        <div class="dept-comment-text">${_esc(c.Content)}</div>
        <div class="dept-comment-meta">${_esc(c.AuthorName)} · ${_fmtDate(c.Timestamp)}</div>
      </div>`).join('') : `<div class="empty-state" style="padding:var(--space-6);"><div class="empty-state-desc">No recent comments on your tasks.</div></div>`}
    </div>
  </div>

  <!-- Row 3 -->
  <div class="dept-row3">
    <!-- Upcoming deadlines -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">⏰ Upcoming Deadlines (7 days)</div>
        <span class="badge ${upcoming.length > 0 ? 'badge-high' : 'badge-low'}">${upcoming.length} tasks</span>
      </div>
      ${upcoming.length ? upcoming.map(t => {
        const due   = new Date(t.DueDate); due.setHours(0,0,0,0);
        const todayD = new Date(); todayD.setHours(0,0,0,0);
        const days  = Math.round((due - todayD) / 86400000);
        const urgency = days <= 1 ? 'urgent' : days <= 3 ? 'soon' : 'ok';
        return `
        <div class="dept-deadline-item" role="listitem">
          <div class="dept-days-badge ${urgency}" aria-label="${days} days remaining">
            ${days === 0 ? '<span>TODAY</span>' : days === 1 ? '1<span>day</span>' : `${days}<span>days</span>`}
          </div>
          <div class="dept-deadline-info" style="min-width:0;">
            <div class="dept-deadline-subject">${_esc(t.Subject)}</div>
            <div class="dept-deadline-date">${t.TaskID} · Due ${_fmtDate(t.DueDate)}</div>
          </div>
          <button
            class="btn btn-primary btn-sm"
            style="flex-shrink:0;font-size:0.68rem;"
            onclick="window.deptOpenTask && window.deptOpenTask('${t.TaskID}')"
            aria-label="Update progress for ${t.TaskID}"
          >Update</button>
        </div>`;
      }).join('') : `<div class="empty-state" style="padding:var(--space-6);"><div class="empty-state-desc">No tasks due in the next 7 days.</div></div>`}
    </div>

    <!-- Department analytics doughnut -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">Department Task Status</div>
      </div>
      <div style="position:relative;height:220px;display:flex;align-items:center;justify-content:center;">
        <canvas id="dept-status-chart" role="img" aria-label="Department task status doughnut chart"></canvas>
      </div>
    </div>
  </div>
  `;
}

/** Renders the status doughnut chart for dept dashboard */
async function _renderDeptChart(tasks) {
  try {
    const Chart = await _loadChartJS();
    const ctx = document.getElementById('dept-status-chart');
    if (!ctx) return;

    if (_deptChart) { _deptChart.destroy(); _deptChart = null; }

    const counts = {
      PENDING:     tasks.filter(t => t.Status === 'PENDING').length,
      IN_PROGRESS: tasks.filter(t => t.Status === 'IN_PROGRESS').length,
      COMPLETED:   tasks.filter(t => t.Status === 'COMPLETED').length,
      OVERDUE:     tasks.filter(t => t.Status === 'OVERDUE').length,
    };

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    _deptChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Pending', 'In Progress', 'Completed', 'Overdue'],
        datasets: [{
          data: [counts.PENDING, counts.IN_PROGRESS, counts.COMPLETED, counts.OVERDUE],
          backgroundColor: ['#F57F17','#2A5F9E','#2E7D32','#B71C1C'],
          borderColor: isDark ? '#1A1D27' : '#fff',
          borderWidth: 3,
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 900, easing: 'easeOutQuart' },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { padding: 12, boxWidth: 12, usePointStyle: true, font: { size: 11 } },
          }
        },
        cutout: '65%',
      }
    });
  } catch { /* Chart.js unavailable */ }
}


// ═════════════════════════════════════════════════════════════════════════════
// E — TASK LIST VIEW
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Renders the full-page task list into #view-tasks.
 */
async function renderDeptTaskList() {
  injectDeptCSS();
  const panel = document.getElementById('view-tasks');
  if (!panel) return;

  panel.innerHTML = `
  <div class="dept-tasklist-header">
    <div>
      <div class="view-title">My Tasks</div>
      <div class="view-subtitle" id="dept-task-subtitle">Loading…</div>
    </div>
    <div style="display:flex;gap:var(--space-3);align-items:center;">
      <div class="dept-search-bar">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        <input type="search" id="dept-search-input" placeholder="Search tasks, IDs…" aria-label="Search tasks" autocomplete="off" />
      </div>
      <button class="btn btn-secondary btn-sm" id="dept-filter-toggle" aria-label="Toggle filters" aria-expanded="false" aria-controls="dept-filter-panel">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
        Filters
      </button>
    </div>
  </div>

  <!-- Filter panel -->
  <div class="dept-filter-panel" id="dept-filter-panel" role="search" aria-label="Task filters">
    <div class="dept-filter-row">
      <div class="dept-filter-group">
        <div class="dept-filter-label">Status</div>
        <div class="dept-check-group">
          ${['PENDING','IN_PROGRESS','REVIEW','COMPLETED','OVERDUE','DEFERRED'].map(s => `
          <label class="dept-check-item">
            <input type="checkbox" class="dept-status-filter" value="${s}" ${_filters.status.includes(s)?'checked':''} aria-label="${_fmtStatus(s)}" />
            ${_fmtStatus(s)}
          </label>`).join('')}
        </div>
      </div>
      <div class="dept-filter-group">
        <div class="dept-filter-label">Priority</div>
        <div class="dept-check-group">
          ${['CRITICAL','HIGH','MEDIUM','LOW'].map(p => `
          <label class="dept-check-item">
            <input type="checkbox" class="dept-priority-filter" value="${p}" ${_filters.priority.includes(p)?'checked':''} aria-label="${p}" />
            ${p}
          </label>`).join('')}
        </div>
      </div>
      <div class="dept-filter-group">
        <div class="dept-filter-label">Due Date Range</div>
        <div style="display:flex;flex-direction:column;gap:var(--space-2);">
          <div class="form-group">
            <label class="form-label" for="dept-due-from" style="font-size:var(--font-xs);">From</label>
            <input type="date" class="input" id="dept-due-from" style="font-size:var(--font-xs);padding:6px 10px;" value="${_filters.dueDateFrom}" aria-label="Due date from" />
          </div>
          <div class="form-group">
            <label class="form-label" for="dept-due-to" style="font-size:var(--font-xs);">To</label>
            <input type="date" class="input" id="dept-due-to" style="font-size:var(--font-xs);padding:6px 10px;" value="${_filters.dueDateTo}" aria-label="Due date to" />
          </div>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4);">
      <button class="btn btn-primary btn-sm" id="dept-apply-filters">Apply Filters</button>
      <button class="btn btn-ghost btn-sm" id="dept-clear-filters">Clear All</button>
    </div>
  </div>

  <!-- Task table -->
  <div class="dept-table-wrap">
    <table class="dept-table" id="dept-tasks-table" aria-label="My department tasks">
      <thead>
        <tr>
          <th class="sortable" data-col="TaskID" scope="col">Task ID</th>
          <th class="sortable" data-col="Subject" scope="col">Subject</th>
          <th class="sortable" data-col="Priority" scope="col">Priority</th>
          <th class="sortable" data-col="Status" scope="col">Status</th>
          <th class="sortable" data-col="DueDate" scope="col">Due Date</th>
          <th class="sortable" data-col="ProgressPercent" scope="col">Progress</th>
          <th class="sortable" data-col="LastUpdatedAt" scope="col">Last Updated</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody id="dept-tasks-tbody" aria-live="polite">
        <tr><td colspan="8">
          <div style="padding:var(--space-8);text-align:center;">
            <div class="rv-spinner" style="margin:auto;"></div>
          </div>
        </td></tr>
      </tbody>
    </table>
    <div class="dept-pagination" id="dept-pagination">
      <div class="dept-page-info" id="dept-page-info">—</div>
      <div class="dept-page-btns">
        <button class="btn btn-secondary btn-sm" id="dept-prev-page" disabled aria-label="Previous page">← Prev</button>
        <button class="btn btn-secondary btn-sm" id="dept-next-page" disabled aria-label="Next page">Next →</button>
      </div>
    </div>
  </div>
  `;

  // Load data if not cached
  if (!_allTasks.length) {
    try {
      const result = await window.api('getTasks', { pageSize: 500 });
      _allTasks = result?.tasks || [];
    } catch (err) {
      document.getElementById('dept-tasks-tbody').innerHTML =
        `<tr><td colspan="8"><div class="empty-state"><div class="empty-state-title">Failed to load tasks</div><div class="empty-state-desc">${_esc(err.message)}</div></div></td></tr>`;
      return;
    }
  }

  _applyFiltersAndSort();
  _renderTaskTable();
  _wireTaskListEvents();
}

/** Applies current filters and sort to _allTasks → _filtered */
function _applyFiltersAndSort() {
  let tasks = [..._allTasks];

  // Search
  if (_filters.search) {
    const term = _filters.search.toLowerCase();
    tasks = tasks.filter(t =>
      (t.Subject    || '').toLowerCase().includes(term) ||
      (t.TaskID     || '').toLowerCase().includes(term) ||
      (t.FileNumber || '').toLowerCase().includes(term)
    );
  }

  // Status
  if (_filters.status.length) {
    tasks = tasks.filter(t => _filters.status.includes(t.Status));
  }

  // Priority
  if (_filters.priority.length) {
    tasks = tasks.filter(t => _filters.priority.includes(t.Priority));
  }

  // Due date range
  if (_filters.dueDateFrom) {
    const from = new Date(_filters.dueDateFrom);
    tasks = tasks.filter(t => t.DueDate && new Date(t.DueDate) >= from);
  }
  if (_filters.dueDateTo) {
    const to = new Date(_filters.dueDateTo);
    to.setHours(23,59,59,999);
    tasks = tasks.filter(t => t.DueDate && new Date(t.DueDate) <= to);
  }

  // Sort
  const PRIO = { CRITICAL:0, HIGH:1, MEDIUM:2, LOW:3 };
  tasks.sort((a, b) => {
    let av = a[_sortCol] || '';
    let bv = b[_sortCol] || '';

    if (_sortCol === 'Priority') {
      av = PRIO[av] ?? 9; bv = PRIO[bv] ?? 9;
      return _sortDir === 'asc' ? av - bv : bv - av;
    }
    if (_sortCol === 'ProgressPercent') {
      av = parseInt(av,10) || 0; bv = parseInt(bv,10) || 0;
      return _sortDir === 'asc' ? av - bv : bv - av;
    }
    if (['DueDate','LastUpdatedAt','CreatedAt'].includes(_sortCol)) {
      const ad = av ? new Date(av).getTime() : 0;
      const bd = bv ? new Date(bv).getTime() : 0;
      return _sortDir === 'asc' ? ad - bd : bd - ad;
    }
    av = String(av).toLowerCase(); bv = String(bv).toLowerCase();
    if (av < bv) return _sortDir === 'asc' ? -1 : 1;
    if (av > bv) return _sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  _filtered = tasks;
  _page = 1; // reset to first page after filter/sort
}

/** Renders the paginated task table */
function _renderTaskTable() {
  const tbody    = document.getElementById('dept-tasks-tbody');
  const pageInfo = document.getElementById('dept-page-info');
  const prevBtn  = document.getElementById('dept-prev-page');
  const nextBtn  = document.getElementById('dept-next-page');
  const subtitle = document.getElementById('dept-task-subtitle');
  if (!tbody) return;

  // Update subtitle
  if (subtitle) subtitle.textContent = `${_filtered.length} task${_filtered.length !== 1 ? 's' : ''} assigned to your department`;

  // Pagination
  const total      = _filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  _page            = Math.min(_page, totalPages);
  const start      = (_page - 1) * PAGE_SIZE;
  const pageItems  = _filtered.slice(start, start + PAGE_SIZE);

  if (pageInfo) pageInfo.textContent = total ? `Showing ${start+1}–${Math.min(start+PAGE_SIZE, total)} of ${total}` : '0 tasks';
  if (prevBtn)  prevBtn.disabled = _page <= 1;
  if (nextBtn)  nextBtn.disabled = _page >= totalPages;

  // Sort indicators
  document.querySelectorAll('.dept-table th.sortable').forEach(th => {
    th.classList.remove('sort-asc','sort-desc');
    if (th.dataset.col === _sortCol) th.classList.add('sort-' + _sortDir);
    th.setAttribute('aria-sort', th.dataset.col === _sortCol ? (_sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
  });

  // Empty state
  if (!pageItems.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state" style="padding:var(--space-8);"><div class="empty-state-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg></div><div class="empty-state-title">No tasks match your filters</div><div class="empty-state-desc">Try adjusting the filters or clear them to see all tasks.</div></div></td></tr>`;
    return;
  }

  const todayStr = new Date().toISOString().split('T')[0];

  tbody.innerHTML = pageItems.map(t => {
    const pct      = parseInt(t.ProgressPercent,10) || 0;
    const isOverdue = t.DueDate && t.DueDate.split('T')[0] < todayStr && t.Status !== 'COMPLETED';
    const pctClr   = pct < 30 ? '#B71C1C' : pct < 70 ? '#F57F17' : '#2E7D32';
    return `
    <tr
      class="${isOverdue ? 'overdue-row' : ''}"
      role="button"
      tabindex="0"
      aria-label="Open task ${t.TaskID}: ${_esc(t.Subject)}"
      onclick="window.deptOpenTask && window.deptOpenTask('${t.TaskID}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.deptOpenTask&&window.deptOpenTask('${t.TaskID}');}"
    >
      <td><code style="font-size:0.72rem;font-family:monospace;color:var(--color-primary-light);">${t.TaskID}</code></td>
      <td style="max-width:260px;">
        <div class="truncate" style="font-weight:600;" title="${_esc(t.Subject)}">${_esc(t.Subject)}</div>
        ${isOverdue ? `<div style="font-size:0.65rem;color:var(--color-danger);font-weight:600;">⚠ Overdue</div>` : ''}
      </td>
      <td><span class="badge badge-${(t.Priority||'low').toLowerCase()}">${t.Priority}</span></td>
      <td><span class="status-pill status-${(t.Status||'pending').toLowerCase().replace('_','-')}">${_fmtStatus(t.Status)}</span></td>
      <td class="text-sm ${isOverdue?'text-danger':''}">${_fmtDate(t.DueDate)}</td>
      <td style="min-width:100px;">
        <div style="display:flex;align-items:center;gap:var(--space-2);">
          <div style="flex:1;height:6px;background:var(--color-surface-3);border-radius:99px;overflow:hidden;">
            <div style="width:${pct}%;height:100%;background:${pctClr};border-radius:99px;transition:width 0.5s ease;"></div>
          </div>
          <span style="font-size:0.7rem;font-weight:700;color:${pctClr};min-width:28px;">${pct}%</span>
        </div>
      </td>
      <td class="text-sm text-muted">${_fmtDate(t.LastUpdatedAt)}</td>
      <td>
        <button
          class="btn btn-primary btn-sm"
          style="font-size:0.68rem;padding:3px 10px;"
          onclick="event.stopPropagation();window.deptOpenTask&&window.deptOpenTask('${t.TaskID}')"
          aria-label="Update progress for ${t.TaskID}"
        >Update</button>
      </td>
    </tr>`;
  }).join('');
}

/** Wires filter, sort, pagination, search events in the task list */
function _wireTaskListEvents() {
  // Sort: column header clicks
  document.querySelectorAll('.dept-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (_sortCol === col) {
        _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        _sortCol = col;
        _sortDir = 'asc';
      }
      _applyFiltersAndSort();
      _renderTaskTable();
    });
  });

  // Search
  let searchTimer;
  const searchInput = document.getElementById('dept-search-input');
  if (searchInput) {
    searchInput.value = _filters.search;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        _filters.search = searchInput.value.trim();
        _applyFiltersAndSort();
        _renderTaskTable();
      }, 280);
    });
  }

  // Filter toggle
  document.getElementById('dept-filter-toggle')?.addEventListener('click', () => {
    const fp = document.getElementById('dept-filter-panel');
    const open = fp.classList.toggle('open');
    document.getElementById('dept-filter-toggle').setAttribute('aria-expanded', open);
  });

  // Apply filters
  document.getElementById('dept-apply-filters')?.addEventListener('click', () => {
    _filters.status   = [...document.querySelectorAll('.dept-status-filter:checked')].map(c => c.value);
    _filters.priority = [...document.querySelectorAll('.dept-priority-filter:checked')].map(c => c.value);
    _filters.dueDateFrom = document.getElementById('dept-due-from')?.value || '';
    _filters.dueDateTo   = document.getElementById('dept-due-to')?.value || '';
    _applyFiltersAndSort();
    _renderTaskTable();
  });

  // Clear filters
  document.getElementById('dept-clear-filters')?.addEventListener('click', () => {
    _filters = { status:[], priority:[], dueDateFrom:'', dueDateTo:'', search:'' };
    if (searchInput) searchInput.value = '';
    document.querySelectorAll('.dept-status-filter,.dept-priority-filter').forEach(c => c.checked = false);
    const df = document.getElementById('dept-due-from'); if(df) df.value = '';
    const dt = document.getElementById('dept-due-to');   if(dt) dt.value = '';
    _applyFiltersAndSort();
    _renderTaskTable();
  });

  // Pagination
  document.getElementById('dept-prev-page')?.addEventListener('click', () => {
    if (_page > 1) { _page--; _renderTaskTable(); }
  });
  document.getElementById('dept-next-page')?.addEventListener('click', () => {
    const totalPages = Math.ceil(_filtered.length / PAGE_SIZE);
    if (_page < totalPages) { _page++; _renderTaskTable(); }
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// F — TASK DETAIL SLIDE-IN PANEL
// ═════════════════════════════════════════════════════════════════════════════

/** Injects the slide-in panel HTML into body (once) */
function _injectTaskPanel() {
  if (_panelExists) return;
  _panelExists = true;

  const backdrop = document.createElement('div');
  backdrop.id = 'dept-panel-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.addEventListener('click', closeTaskPanel);
  document.body.appendChild(backdrop);

  const panel = document.createElement('div');
  panel.id = 'dept-task-panel';
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'Task detail panel');
  panel.innerHTML = `
  <!-- Panel header -->
  <div class="dp-header">
    <span class="dp-task-id" id="dp-task-id">—</span>
    <div id="dp-badges" style="display:flex;gap:var(--space-2);"></div>
    <button class="dp-close" id="dp-close-btn" aria-label="Close task panel">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>

  <!-- Task brief info -->
  <div class="dp-info-section" id="dp-info-section">
    <div class="dp-subject" id="dp-subject">Loading…</div>
    <div class="dp-badges" id="dp-badges-row"></div>
    <div class="dp-meta-row" id="dp-meta-row"></div>

    <!-- Progress update form — DEPT ONLY -->
    <div class="dp-progress-form" id="dp-progress-form">
      <div class="dp-progress-form-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        Update Progress
      </div>
      <div class="dp-slider-wrap">
        <div class="dp-slider-header">
          <label class="dp-slider-label" for="dp-progress-range">Progress</label>
          <span class="dp-slider-pct high" id="dp-pct-display" aria-live="polite">0%</span>
        </div>
        <input
          type="range"
          class="dp-range"
          id="dp-progress-range"
          min="0" max="100" step="5"
          value="0"
          aria-label="Task progress percentage"
          aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
        />
        <div class="dp-progress-visual">
          <div class="dp-progress-fill low" id="dp-progress-fill" style="width:0%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;">
          ${[0,25,50,75,100].map(v=>`<span style="font-size:0.6rem;color:var(--color-text-muted);">${v}%</span>`).join('')}
        </div>
      </div>
      <div class="form-group" style="margin-top:var(--space-4);">
        <label class="form-label" for="dp-remarks-input" style="font-size:var(--font-sm);">Progress Remarks</label>
        <textarea
          class="textarea"
          id="dp-remarks-input"
          rows="3"
          placeholder="Describe current progress, actions taken, or blockers…"
          aria-label="Progress remarks"
        ></textarea>
      </div>
      <button class="btn btn-primary" id="dp-submit-progress" aria-label="Submit progress update" style="margin-top:var(--space-3);width:100%;justify-content:center;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        Submit Progress Update
      </button>
    </div>
  </div>

  <!-- Tabs -->
  <div class="dp-tabs" role="tablist">
    <button class="dp-tab active" role="tab" data-tab="comments" aria-selected="true" aria-controls="dp-tab-comments" id="dp-tab-btn-comments">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      Comments
      <span class="dp-tab-badge" id="dp-comment-badge">0</span>
    </button>
    <button class="dp-tab" role="tab" data-tab="attachments" aria-selected="false" aria-controls="dp-tab-attachments" id="dp-tab-btn-attachments">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
      Files
      <span class="dp-tab-badge" id="dp-attach-badge">0</span>
    </button>
    <button class="dp-tab" role="tab" data-tab="ai" aria-selected="false" aria-controls="dp-tab-ai" id="dp-tab-btn-ai">
      <span style="color:var(--color-accent);">✦</span> AI
    </button>
  </div>

  <!-- COMMENTS TAB -->
  <div class="dp-tab-content active" id="dp-tab-comments" role="tabpanel" aria-labelledby="dp-tab-btn-comments">
    <div class="dp-comments-wrap" id="dp-comments-list" aria-live="polite" aria-label="Task comments"></div>
    <div class="dp-comment-input-area">
      <div class="dp-input-toolbar">
        <label for="dp-cat-select" class="visually-hidden">Comment category</label>
        <select class="dp-cat-select" id="dp-cat-select" aria-label="Comment category">
          <option value="General Observation">ℹ Observation</option>
          <option value="Direction">→ Direction</option>
          <option value="Immediate Attention">! Attention</option>
          <option value="Appreciation">★ Appreciation</option>
          <option value="Reminder">⏰ Reminder</option>
        </select>
        <span class="dp-input-hint">Ctrl+Enter to send</span>
      </div>
      <div
        id="dp-comment-box"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        aria-label="Type a comment"
        data-placeholder="Type your update or query…"
        tabindex="0"
      ></div>
      <div class="dp-input-actions">
        <button class="rv-attach-btn" id="dp-attach-file-btn" aria-label="Attach file">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
          Attach
        </button>
        <button class="btn btn-primary btn-sm" id="dp-send-comment-btn" aria-label="Post comment">
          Post
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>
  </div>

  <!-- ATTACHMENTS TAB -->
  <div class="dp-tab-content" id="dp-tab-attachments" role="tabpanel" aria-labelledby="dp-tab-btn-attachments">
    <div class="dp-attach-wrap">
      <div
        class="dp-upload-zone"
        id="dp-upload-zone"
        role="button" tabindex="0"
        aria-label="Upload files — click or drag and drop"
      >
        <div aria-hidden="true" style="font-size:1.5rem;margin-bottom:var(--space-2);">📎</div>
        <div style="font-size:var(--font-sm);color:var(--color-text-secondary);">
          Drag & drop or <strong>click to browse</strong>
        </div>
        <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:4px;">
          PDF, DOCX, XLSX, PNG, JPG, ZIP — max 10 MB
        </div>
        <input type="file" id="dp-upload-input" multiple accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.zip" style="display:none;" tabindex="-1" />
      </div>
      <div id="dp-upload-progress" style="display:none;margin-bottom:var(--space-3);">
        <div style="font-size:var(--font-xs);color:var(--color-text-secondary);" id="dp-upload-status">Uploading…</div>
        <div style="height:4px;background:var(--color-surface-3);border-radius:99px;overflow:hidden;margin-top:4px;">
          <div id="dp-upload-bar" style="height:100%;background:var(--color-primary-light);border-radius:99px;transition:width 0.3s;width:0%;"></div>
        </div>
      </div>
      <div class="dp-file-list" id="dp-file-list" aria-live="polite" aria-label="Attached files"></div>
    </div>
  </div>

  <!-- AI TAB -->
  <div class="dp-tab-content" id="dp-tab-ai" role="tabpanel" aria-labelledby="dp-tab-btn-ai">
    <div class="dp-ai-wrap">
      <button class="btn btn-accent" id="dp-ai-gen-btn" style="align-self:flex-start;" aria-label="Generate AI summary">
        ✦ Generate AI Summary
      </button>
      <div id="dp-ai-output" aria-live="polite"></div>
    </div>
  </div>
  `;

  document.body.appendChild(panel);
  _wirePanelEvents(panel);
}

/** Wires all events in the slide-in panel */
function _wirePanelEvents(panel) {
  // Close
  panel.querySelector('#dp-close-btn').addEventListener('click', closeTaskPanel);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _openTaskID) closeTaskPanel(); });

  // Tabs
  panel.querySelectorAll('.dp-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      panel.querySelectorAll('.dp-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
        b.setAttribute('aria-selected', b.dataset.tab === tab);
      });
      panel.querySelectorAll('.dp-tab-content').forEach(c => {
        c.classList.toggle('active', c.id === `dp-tab-${tab}`);
      });
    });
  });

  // Progress slider
  const slider  = panel.querySelector('#dp-progress-range');
  const pctDisp = panel.querySelector('#dp-pct-display');
  const fill    = panel.querySelector('#dp-progress-fill');

  slider.addEventListener('input', () => {
    const v = parseInt(slider.value, 10);
    pctDisp.textContent = v + '%';
    pctDisp.className   = 'dp-slider-pct ' + (v < 30 ? 'low' : v < 70 ? 'mid' : 'high');
    fill.style.width    = v + '%';
    fill.className      = 'dp-progress-fill ' + (v < 30 ? 'low' : v < 70 ? 'mid' : 'high');
    slider.setAttribute('aria-valuenow', v);
  });

  // Submit progress
  panel.querySelector('#dp-submit-progress').addEventListener('click', _submitProgressUpdate);

  // Send comment
  panel.querySelector('#dp-send-comment-btn').addEventListener('click', _sendPanelComment);
  panel.querySelector('#dp-comment-box').addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); _sendPanelComment(); }
  });

  // File upload
  const zone  = panel.querySelector('#dp-upload-zone');
  const input = panel.querySelector('#dp-upload-input');
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); input.click(); } });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); _handlePanelUpload(e.dataTransfer.files); });
  input.addEventListener('change', () => _handlePanelUpload(input.files));
  panel.querySelector('#dp-attach-file-btn').addEventListener('click', () => {
    panel.querySelector('[data-tab="attachments"]').click();
    input.click();
  });

  // AI
  panel.querySelector('#dp-ai-gen-btn').addEventListener('click', _generatePanelAI);
}

/**
 * Opens the slide-in task detail panel for a given task ID.
 * Loads task data fresh from API.
 * @param {string} taskID
 */
async function openTaskPanel(taskID) {
  if (!taskID) return;
  _injectTaskPanel();

  _openTaskID = taskID;
  const panel    = document.getElementById('dept-task-panel');
  const backdrop = document.getElementById('dept-panel-backdrop');

  panel.classList.add('open');
  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Reset tabs to comments
  document.querySelectorAll('.dp-tab').forEach(b => { b.classList.toggle('active', b.dataset.tab === 'comments'); b.setAttribute('aria-selected', b.dataset.tab === 'comments'); });
  document.querySelectorAll('.dp-tab-content').forEach(c => c.classList.toggle('active', c.id === 'dp-tab-comments'));

  // Loading state
  document.getElementById('dp-subject').textContent = 'Loading…';

  try {
    const result = await window.api('getTask', { taskID });
    const task   = result?.task;
    _taskComments    = result?.comments    || [];
    _taskAttachments = result?.attachments || [];

    if (!task) throw new Error('Task not found');

    // Populate info section
    document.getElementById('dp-task-id').textContent = task.TaskID;
    document.getElementById('dp-subject').textContent  = task.Subject;

    document.getElementById('dp-badges-row').innerHTML =
      `<span class="badge badge-${(task.Priority||'low').toLowerCase()}">${task.Priority}</span>
       <span class="status-pill status-${(task.Status||'pending').toLowerCase().replace('_','-')}">${_fmtStatus(task.Status)}</span>`;

    const pct = parseInt(task.ProgressPercent,10) || 0;
    document.getElementById('dp-meta-row').innerHTML = [
      { label: 'Task ID',            value: task.TaskID },
      { label: 'Due Date',           value: _fmtDate(task.DueDate) },
      { label: 'Officer Responsible',value: task.OfficerResponsible || '—' },
      { label: 'File Number',        value: task.FileNumber || '—' },
      { label: 'Category',           value: task.Category || '—' },
      { label: 'Assigned Date',      value: _fmtDate(task.AssignedDate) },
    ].map(m => `
      <div class="dp-meta-item">
        <span class="dp-meta-label">${_esc(m.label)}</span>
        <span class="dp-meta-value">${_esc(m.value)}</span>
      </div>`).join('');

    // Set slider to current progress
    const slider  = document.getElementById('dp-progress-range');
    const pctDisp = document.getElementById('dp-pct-display');
    const fill    = document.getElementById('dp-progress-fill');
    slider.value           = pct;
    slider.setAttribute('aria-valuenow', pct);
    pctDisp.textContent    = pct + '%';
    pctDisp.className      = 'dp-slider-pct ' + (pct < 30 ? 'low' : pct < 70 ? 'mid' : 'high');
    fill.style.width       = pct + '%';
    fill.className         = 'dp-progress-fill ' + (pct < 30 ? 'low' : pct < 70 ? 'mid' : 'high');

    // Restore existing remarks
    const remarksInput = document.getElementById('dp-remarks-input');
    if (remarksInput) remarksInput.value = task.Remarks || '';

    // Render comments and attachments
    _renderPanelComments(task);
    _renderPanelAttachments();

    // Scroll comments to bottom
    setTimeout(() => {
      const list = document.getElementById('dp-comments-list');
      if (list) list.scrollTop = list.scrollHeight;
    }, 80);

  } catch (err) {
    document.getElementById('dp-subject').textContent = 'Error loading task';
    window.ui?.toast('Error', err.message, 'error');
  }
}

/** Closes the slide-in task detail panel */
function closeTaskPanel() {
  _openTaskID = null;
  document.getElementById('dept-task-panel')?.classList.remove('open');
  document.getElementById('dept-panel-backdrop')?.classList.remove('open');
  document.body.style.overflow = '';
}

function _renderPanelComments(task) {
  const list  = document.getElementById('dp-comments-list');
  const badge = document.getElementById('dp-comment-badge');
  if (badge) badge.textContent = _taskComments.length;
  if (!list) return;

  if (!_taskComments.length) {
    list.innerHTML = `<div class="empty-state" style="padding:var(--space-6);"><div class="empty-state-desc">No comments yet. Add the first update below.</div></div>`;
    return;
  }

  const myID = window.store?.session?.userID;
  list.innerHTML = _taskComments.map((c, i) => {
    const isMine = c.AuthorID === myID || c.AuthorRole === 'Department';
    const side   = isMine ? 'mine' : 'theirs';
    const catKey = _catKey(c.Category);
    return `
    <div class="dp-bubble-wrap ${side}" style="animation-delay:${i*25}ms;" role="listitem">
      <div class="dp-bubble">
        <div class="dp-bubble-head">
          <span class="dp-bubble-author">${_esc(c.AuthorName)}</span>
          <span class="dp-bubble-role">${_esc(c.AuthorRole)}</span>
          <span class="dp-cat-badge dp-cat-${catKey}">${_catIcon(c.Category)} ${_esc(c.Category)}</span>
        </div>
        <div style="white-space:pre-wrap;word-break:break-word;">${_esc(c.Content)}</div>
      </div>
      <div class="dp-bubble-meta">${_fmtDate(c.Timestamp)} ${_fmtTime(c.Timestamp)}</div>
    </div>`;
  }).join('');
}

function _renderPanelAttachments() {
  const list  = document.getElementById('dp-file-list');
  const badge = document.getElementById('dp-attach-badge');
  if (badge) badge.textContent = _taskAttachments.length;
  if (!list) return;

  if (!_taskAttachments.length) {
    list.innerHTML = '<div style="color:var(--color-text-muted);font-size:var(--font-sm);">No attachments yet.</div>';
    return;
  }

  list.innerHTML = _taskAttachments.map(a => {
    const ext  = (a.FileName||'').split('.').pop().toLowerCase();
    const icon = { pdf:'📄', docx:'📝', xlsx:'📊', png:'🖼', jpg:'🖼', jpeg:'🖼', zip:'🗜' }[ext] || '📎';
    return `
    <div class="dp-file-item" role="listitem">
      <div class="dp-file-icon-box" aria-hidden="true">${icon}</div>
      <div class="dp-file-info" style="min-width:0;">
        <div class="dp-file-name truncate" title="${_esc(a.FileName)}">${_esc(a.FileName)}</div>
        <div class="dp-file-meta">${_fmtBytes(parseInt(a.FileSizeBytes,10)||0)} · ${_fmtDate(a.UploadedAt)}</div>
      </div>
      <a href="${_esc(a.DriveViewURL)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="flex-shrink:0;" aria-label="View ${_esc(a.FileName)}">View</a>
    </div>`;
  }).join('');
}


// ═════════════════════════════════════════════════════════════════════════════
// G — PROGRESS UPDATE SUBMIT
// ═════════════════════════════════════════════════════════════════════════════

async function _submitProgressUpdate() {
  if (!_openTaskID) return;
  const btn     = document.getElementById('dp-submit-progress');
  const slider  = document.getElementById('dp-progress-range');
  const remarks = document.getElementById('dp-remarks-input');
  const pct     = parseInt(slider?.value, 10) || 0;
  const rmk     = remarks?.value.trim() || '';

  if (!rmk) {
    window.ui?.toast('Remarks Required', 'Please add a remark describing your progress before submitting.', 'warning');
    remarks?.focus();
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

  try {
    await window.api('updateProgress', {
      taskID:          _openTaskID,
      progressPercent: pct,
      remarks:         rmk,
    });

    window.ui?.toast('Progress Updated', `Task ${_openTaskID} updated to ${pct}%.`, 'success');

    // Refresh activity in panel — reload comments
    const updated = await window.api('getTask', { taskID: _openTaskID });
    if (updated) {
      _taskComments    = updated.comments    || _taskComments;
      _taskAttachments = updated.attachments || _taskAttachments;
      _renderPanelComments(updated.task);
    }

    // Update the in-memory task list
    const idx = _allTasks.findIndex(t => t.TaskID === _openTaskID);
    if (idx >= 0) {
      _allTasks[idx].ProgressPercent = String(pct);
      _allTasks[idx].Remarks         = rmk;
      _allTasks[idx].LastUpdatedAt   = new Date().toISOString();
    }

    // Refresh the visible table if on tasks view
    if (document.getElementById('dept-tasks-tbody')) {
      _applyFiltersAndSort();
      _renderTaskTable();
    }

  } catch (err) {
    window.ui?.toast('Update Failed', err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg> Submit Progress Update'; }
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// H — PANEL COMMENT SUBMIT
// ═════════════════════════════════════════════════════════════════════════════

async function _sendPanelComment() {
  if (!_openTaskID) return;
  const box  = document.getElementById('dp-comment-box');
  const cat  = document.getElementById('dp-cat-select');
  const btn  = document.getElementById('dp-send-comment-btn');
  const content  = (box?.textContent || '').trim();
  const category = cat?.value || 'General Observation';

  if (!content) { window.ui?.toast('Comment', 'Please type a comment first.', 'warning'); return; }

  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  try {
    const result = await window.api('addComment', {
      taskID:   _openTaskID,
      content,
      category,
    });

    const session = window.store?.session;
    const newC = {
      CommentID:  result?.commentID || 'tmp-' + Date.now(),
      TaskID:     _openTaskID,
      AuthorID:   session?.userID   || '',
      AuthorName: session?.fullName || session?.email || 'You',
      AuthorRole: session?.role     || 'Department',
      Content:    content,
      Category:   category,
      Timestamp:  new Date().toISOString(),
      IsEdited:   'FALSE',
      ReadBy:     session?.userID || '',
    };

    _taskComments.push(newC);
    _renderPanelComments(null);

    if (box) box.textContent = '';
    window.ui?.toast('Comment Posted', category + ' added.', 'success', 2000);

    const list = document.getElementById('dp-comments-list');
    if (list) list.scrollTop = list.scrollHeight;

    const badge = document.getElementById('dp-comment-badge');
    if (badge) badge.textContent = _taskComments.length;

  } catch (err) {
    window.ui?.toast('Error', err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Post <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
    }
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// I — PANEL FILE UPLOAD
// ═════════════════════════════════════════════════════════════════════════════

async function _handlePanelUpload(files) {
  if (!files?.length || !_openTaskID) return;
  const prog   = document.getElementById('dp-upload-progress');
  const bar    = document.getElementById('dp-upload-bar');
  const status = document.getElementById('dp-upload-status');
  if (prog) prog.style.display = 'block';

  const ALLOWED = ['pdf','docx','xlsx','png','jpg','jpeg','zip'];
  const MAX_B   = 10 * 1024 * 1024;

  for (const file of Array.from(files)) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED.includes(ext)) { window.ui?.toast('Invalid file type', `.${ext} is not allowed.`, 'warning'); continue; }
    if (file.size > MAX_B)      { window.ui?.toast('File too large', `${file.name} exceeds 10 MB.`, 'warning'); continue; }
    if (file.size === 0)        { window.ui?.toast('Empty file', file.name, 'warning'); continue; }

    if (status) status.textContent = `Uploading ${file.name}…`;
    if (bar)    bar.style.width = '30%';

    try {
      const base64 = await _toBase64(file);
      const result = await window.api('uploadFile', {
        taskID:   _openTaskID,
        fileName: file.name,
        fileData: base64,
      });
      if (bar) bar.style.width = '100%';

      _taskAttachments.push({
        AttachmentID: result?.attachmentID || 'att-' + Date.now(),
        TaskID: _openTaskID,
        CommentID: '',
        FileName: file.name,
        FileType: file.type,
        FileSizeBytes: String(file.size),
        DriveFileID: '',
        DriveViewURL: result?.driveViewURL || '#',
        UploadedBy: window.store?.session?.userID || '',
        UploadedAt: new Date().toISOString(),
      });
      _renderPanelAttachments();
      window.ui?.toast('Uploaded', `${file.name} uploaded.`, 'success', 2000);
    } catch (err) {
      window.ui?.toast('Upload failed', `${file.name}: ${err.message}`, 'error');
    }
  }

  setTimeout(() => {
    if (prog) prog.style.display = 'none';
    if (bar)  bar.style.width = '0%';
    const inp = document.getElementById('dp-upload-input');
    if (inp) inp.value = '';
  }, 800);
}

function _toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.includes(',') ? r.result.split(',')[1] : r.result);
    r.onerror = () => rej(new Error('File read failed'));
    r.readAsDataURL(file);
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// J — PANEL AI SUMMARY
// ═════════════════════════════════════════════════════════════════════════════

async function _generatePanelAI() {
  if (!_openTaskID) return;
  const btn = document.getElementById('dp-ai-gen-btn');
  const out = document.getElementById('dp-ai-output');
  if (btn) { btn.disabled = true; btn.textContent = '✦ Generating…'; }
  if (out) out.innerHTML = `
    <div class="dp-typing" aria-live="polite" aria-label="AI generating">
      <div class="dp-typing-dot"></div>
      <div class="dp-typing-dot"></div>
      <div class="dp-typing-dot"></div>
      <span style="font-size:var(--font-xs);color:var(--color-text-muted);">Analysing task…</span>
    </div>`;

  try {
    const result = await window.api('generateTaskSummary', { taskID: _openTaskID });
    if (out) out.innerHTML = `
      <div class="dp-ai-summary">${_esc(result?.summary || 'No summary available.')}</div>
      <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:var(--space-2);">
        Tokens: ${result?.tokensUsed || '—'} · Groq llama3-70b-8192
      </div>`;
  } catch (err) {
    if (out) out.innerHTML = `<div style="color:var(--color-danger);font-size:var(--font-sm);">${_esc(err.message)}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✦ Regenerate'; }
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// K — HELPERS
// ═════════════════════════════════════════════════════════════════════════════

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
function _fmtStatus(s) {
  return {PENDING:'Pending',IN_PROGRESS:'In Progress',REVIEW:'Under Review',COMPLETED:'Completed',OVERDUE:'Overdue',DEFERRED:'Deferred'}[s] || s || '—';
}
function _fmtBytes(n) {
  if (n>=1048576) return (n/1048576).toFixed(1)+' MB';
  if (n>=1024)    return (n/1024).toFixed(0)+' KB';
  return n+' B';
}
function _catKey(cat) {
  return {
    'General Observation':'observation',
    'Direction':'direction',
    'Immediate Attention':'attention',
    'Appreciation':'appreciation',
    'Reminder':'reminder',
  }[cat] || 'observation';
}
function _catIcon(cat) {
  return {'General Observation':'ℹ','Direction':'→','Immediate Attention':'!','Appreciation':'★','Reminder':'⏰'}[cat] || 'ℹ';
}
function _animateCounter(el, from, to, dur) {
  if (!to) { el.textContent = '0'; return; }
  const start = performance.now();
  const range = to - from;
  function tick(now) {
    const t = Math.min((now-start)/dur, 1);
    const e = 1 - Math.pow(1-t, 3);
    el.textContent = Math.round(from + range*e);
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = to;
  }
  requestAnimationFrame(tick);
}


// ═════════════════════════════════════════════════════════════════════════════
// L — EVENT LISTENERS & EXPORT
// ═════════════════════════════════════════════════════════════════════════════

/** Listen for view changes — intercept dashboard for Dept role */
document.addEventListener('drishti:viewchange', async (e) => {
  const { view } = e.detail;
  const role = window.store?.session?.role;
  const isDept = role === 'Department';

  if (view === 'dashboard' && isDept) {
    await renderDeptDashboard();
  }
  if (view === 'tasks' && isDept) {
    await renderDeptTaskList();
  }

  // Close slide panel on navigation
  if (_openTaskID) closeTaskPanel();
});

/** Also handle appready in case page loads directly on these routes */
document.addEventListener('drishti:appready', () => {
  const hash = window.location.hash.replace('#','') || 'dashboard';
  const role = window.store?.session?.role;
  const isDept = role === 'Department';

  if (isDept) {
    if (hash === 'dashboard' || hash === '') renderDeptDashboard();
    if (hash === 'tasks')                    renderDeptTaskList();
  }
});

/** Expose globally for onclick in rendered HTML */
window.deptOpenTask = openTaskPanel;

/**
 * Future Department Expansion Note:
 * ─────────────────────────────────
 * Adding a new department requires NO code changes in this file.
 * Steps:
 *   1. Add a row to the Departments sheet via the Admin UI (Departments view)
 *      with a unique DeptCode, DeptName, DeptShortName, HODName, HODEmail.
 *   2. Create a User record with Role = 'Department' and DepartmentCode = new DeptCode.
 *   3. The department banner, task filtering, KPI cards, and chart all
 *      resolve dynamically from session.deptCode at runtime.
 *   4. The seedDepartments() function in DRISHTI_Module1_Database.gs can be
 *      extended with additional rows; the idempotency guard ensures no duplicates.
 * No frontend deployment is required for new departments.
 */
