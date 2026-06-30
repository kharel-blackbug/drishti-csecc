/**
 * DRISHTI — Analytics Dashboard & Report Generation
 * File: analytics.js
 *
 * Handles routes #analytics and #reports.
 * Loaded by index.html as <script type="module" src="analytics.js">.
 *
 * Sections rendered:
 *   #analytics
 *     S1 — Three overview charts (Line trend, Bar dept, Area priority)
 *     S2 — Department performance table (sortable, drill-down modal)
 *     S3 — SLA compliance bar chart with 80% threshold line
 *     S4 — Monthly calendar view with task dots and day popover
 *     S5 — Gantt-style timeline (Week / Month / Quarter zoom)
 *   #reports
 *     Full report configuration form
 *     Excel (CSV download), PDF (jsPDF), Print output
 *
 * External CDN dependencies (loaded lazily):
 *   Chart.js 4.4.1  — all charts
 *   jsPDF 2.5.1     — PDF generation
 *
 * @version 8.0.0
 * @module  Analytics & Reports
 */

'use strict';

// ═════════════════════════════════════════════════════════════════════════════
// A — CONSTANTS & STATE
// ═════════════════════════════════════════════════════════════════════════════

const CHART_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
const JSPDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const JSPDF_AUTO_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';

let _chartJSReady  = null;
let _jsPDFReady    = null;

// Chart instances (stored for destroy-before-redraw)
const _charts = {};

// Cached data
let _statsCache      = null;
let _deptPerfCache   = [];
let _heatmapCache    = {};
let _tasksCache      = [];
let _deptListCache   = [];

// Analytics state
let _calendarDate    = new Date();  // Currently displayed month
let _ganttZoom       = 'month';     // 'week' | 'month' | 'quarter'
let _sortCol         = 'completionRate';
let _sortDir         = 'desc';
let _cssInjected     = false;

// Report state
let _reportDepts     = new Set();

// Palette matching DRISHTI design system
const P = {
  primary:      '#1A3A5C',
  primaryLight: '#2A5F9E',
  accent:       '#C9A84C',
  success:      '#2E7D32',
  warning:      '#F57F17',
  danger:       '#B71C1C',
  teal:         '#00695C',
  purple:       '#4527A0',
  muted:        '#9BA8BE',
};

const STATUS_COLORS = {
  PENDING:     P.warning,
  IN_PROGRESS: P.primaryLight,
  COMPLETED:   P.success,
  OVERDUE:     P.danger,
  REVIEW:      P.accent,
  DEFERRED:    P.muted,
};

const PRIORITY_COLORS = {
  CRITICAL: P.danger,
  HIGH:     P.warning,
  MEDIUM:   P.primaryLight,
  LOW:      P.success,
};

// ═════════════════════════════════════════════════════════════════════════════
// B — CSS
// ═════════════════════════════════════════════════════════════════════════════

function _injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement('style');
  s.id = 'analytics-styles';
  s.textContent = `
  /* ─── Section headers ──────────────────────────────────────── */
  .an-section { margin-bottom: var(--space-8); }
  .an-section-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: var(--space-5); gap: var(--space-4); flex-wrap: wrap;
  }
  .an-section-title {
    font-size: var(--font-lg); font-weight: 800;
    color: var(--color-text-primary); line-height: 1.2;
    display: flex; align-items: center; gap: var(--space-3);
  }
  .an-section-num {
    width: 26px; height: 26px;
    background: var(--color-primary); color: #fff;
    border-radius: 50%; display: flex; align-items: center; justify-content: center;
    font-size: var(--font-xs); font-weight: 800; flex-shrink: 0;
  }
  .an-section-actions { display: flex; gap: var(--space-3); align-items: center; }

  /* ─── Chart cards ────────────────────────────────────────── */
  .an-charts-row {
    display: grid; grid-template-columns: repeat(3,1fr);
    gap: var(--space-5);
  }
  .an-chart-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    box-shadow: var(--shadow-sm);
    position: relative;
    transition: box-shadow var(--transition);
  }
  .an-chart-card:hover { box-shadow: var(--shadow-md); }
  .an-chart-card:hover .an-export-btn { opacity: 1; }
  .an-chart-title {
    font-size: var(--font-sm); font-weight: 700;
    color: var(--color-text-primary); margin-bottom: var(--space-4);
    display: flex; align-items: center; justify-content: space-between;
  }
  .an-chart-wrap {
    position: relative; width: 100%;
    height: 220px;
    display: flex; align-items: center; justify-content: center;
  }
  .an-chart-wrap canvas { max-height: 220px; }
  .an-export-btn {
    opacity: 0;
    background: none; border: none; cursor: pointer;
    color: var(--color-text-muted); font-size: var(--font-xs);
    padding: 2px 6px; border-radius: var(--radius-xs);
    transition: opacity var(--transition), color var(--transition), background var(--transition);
    display: flex; align-items: center; gap: 4px;
    font-family: inherit;
  }
  .an-export-btn:hover { color: var(--color-primary); background: var(--color-surface-2); }

  /* ─── Dept performance table ──────────────────────────────── */
  .an-table-wrap {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden; box-shadow: var(--shadow-sm);
  }
  .an-table { width: 100%; border-collapse: collapse; font-size: var(--font-sm); }
  .an-table th {
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-weight: 600; font-size: var(--font-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    padding: var(--space-3) var(--space-4);
    text-align: left; white-space: nowrap;
    border-bottom: 1px solid var(--color-border);
    cursor: pointer; user-select: none;
    transition: background var(--transition);
  }
  .an-table th:hover { background: var(--color-surface-3); }
  .an-table th.sort-asc::after  { content: ' ↑'; color: var(--color-primary); }
  .an-table th.sort-desc::after { content: ' ↓'; color: var(--color-primary); }
  .an-table td {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border); vertical-align: middle;
  }
  .an-table tr:last-child td { border-bottom: none; }
  .an-table tbody tr {
    cursor: pointer; transition: background var(--transition);
  }
  .an-table tbody tr:hover { background: var(--color-surface-2); }

  /* Mini sparkline placeholder */
  .an-trend-spark { width: 60px; height: 20px; display: inline-block; }

  /* Performance badge */
  .an-perf-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 8px; border-radius: var(--radius-full);
    font-size: 0.68rem; font-weight: 700;
    color: #fff; white-space: nowrap;
  }

  /* ─── SLA chart ───────────────────────────────────────────── */
  .an-sla-wrap {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5); box-shadow: var(--shadow-sm);
  }
  .an-sla-chart-wrap { position: relative; height: 280px; }

  /* ─── Calendar ────────────────────────────────────────────── */
  .an-cal-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: var(--space-4);
  }
  .an-cal-month {
    font-size: var(--font-lg); font-weight: 800;
    color: var(--color-text-primary);
  }
  .an-cal-nav { display: flex; gap: var(--space-2); }
  .an-cal-grid {
    display: grid; grid-template-columns: repeat(7,1fr);
    gap: 2px;
  }
  .an-cal-dow {
    text-align: center; font-size: var(--font-xs);
    font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--color-text-muted);
    padding: var(--space-2) 0;
  }
  .an-cal-day {
    aspect-ratio: 1;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 4px;
    cursor: pointer;
    position: relative;
    transition: background var(--transition), border-color var(--transition);
    min-height: 56px;
    display: flex; flex-direction: column; gap: 3px;
  }
  .an-cal-day:hover { background: var(--color-surface-2); border-color: var(--color-primary-light); }
  .an-cal-day.empty { background: var(--color-surface-2); cursor: default; border-color: transparent; }
  .an-cal-day.today  { border-color: var(--color-primary); background: rgba(26,58,92,0.04); }
  .an-cal-day.has-tasks { background: rgba(42,95,158,0.04); }
  .an-day-num {
    font-size: var(--font-xs); font-weight: 700;
    color: var(--color-text-secondary); line-height: 1;
  }
  .an-cal-day.today .an-day-num {
    color: var(--color-primary); background: var(--color-primary);
    color: #fff; width: 20px; height: 20px;
    border-radius: 50%; display: flex; align-items: center; justify-content: center;
  }
  .an-day-dots { display: flex; flex-wrap: wrap; gap: 2px; }
  .an-day-dot {
    width: 6px; height: 6px; border-radius: 50%;
    flex-shrink: 0;
  }
  .an-day-count {
    font-size: 0.6rem; color: var(--color-text-muted); font-weight: 600;
    margin-top: auto;
  }

  /* Day popover */
  .an-day-popover {
    position: fixed;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    padding: var(--space-4);
    z-index: 5500;
    min-width: 240px; max-width: 320px;
    max-height: 320px; overflow-y: auto;
    font-size: var(--font-sm);
    animation: fadeIn 0.15s ease;
  }
  .an-popover-title {
    font-weight: 700; font-size: var(--font-sm);
    color: var(--color-primary); margin-bottom: var(--space-3);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--color-border);
  }
  .an-popover-task {
    display: flex; align-items: center; gap: var(--space-2);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-border);
    cursor: pointer; transition: background var(--transition);
  }
  .an-popover-task:last-child { border-bottom: none; }
  .an-popover-task:hover { background: var(--color-surface-2); padding-left: 4px; }
  .an-popover-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .an-popover-subject { font-size: var(--font-xs); color: var(--color-text-primary); flex: 1; min-width: 0; }

  /* ─── Gantt / Timeline ────────────────────────────────────── */
  .an-gantt-wrap {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden; box-shadow: var(--shadow-sm);
  }
  .an-gantt-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface-2);
  }
  .an-gantt-zoom { display: flex; gap: var(--space-1); }
  .an-zoom-btn {
    padding: 3px 12px; border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    background: var(--color-surface); color: var(--color-text-secondary);
    font-size: var(--font-xs); font-weight: 600;
    cursor: pointer; transition: all var(--transition); font-family: inherit;
  }
  .an-zoom-btn.active {
    background: var(--color-primary); border-color: var(--color-primary);
    color: #fff;
  }
  .an-gantt-body { overflow-x: auto; overflow-y: auto; max-height: 400px; }
  .an-gantt-grid {
    display: grid;
    min-width: 800px;
  }
  .an-gantt-row {
    display: grid; grid-template-columns: 160px 1fr;
    border-bottom: 1px solid var(--color-border);
    min-height: 40px;
  }
  .an-gantt-row.header-row { position: sticky; top: 0; z-index: 2; }
  .an-gantt-label {
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-xs); font-weight: 600;
    color: var(--color-text-secondary);
    border-right: 1px solid var(--color-border);
    background: var(--color-surface-2);
    display: flex; align-items: center;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .an-gantt-row.header-row .an-gantt-label {
    font-weight: 700; color: var(--color-text-primary);
  }
  .an-gantt-track { position: relative; background: var(--color-surface); }
  .an-gantt-row.header-row .an-gantt-track {
    background: var(--color-surface-2);
    display: flex;
  }
  .an-gantt-col-label {
    flex: 1; text-align: center;
    font-size: 0.65rem; font-weight: 600;
    color: var(--color-text-muted); padding: var(--space-2) 0;
    border-right: 1px solid var(--color-border);
  }
  .an-gantt-col-label:last-child { border-right: none; }
  .an-gantt-bar {
    position: absolute; top: 6px; height: 28px;
    border-radius: var(--radius-xs);
    display: flex; align-items: center;
    padding: 0 6px;
    font-size: 0.62rem; font-weight: 700; color: #fff;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    cursor: pointer;
    transition: opacity var(--transition), transform var(--transition);
    box-shadow: var(--shadow-xs);
  }
  .an-gantt-bar:hover { opacity: 0.88; transform: scaleY(1.06); }
  .an-gantt-empty {
    padding: var(--space-8); text-align: center;
    color: var(--color-text-muted); font-size: var(--font-sm);
  }

  /* ─── Dept drill-down modal ───────────────────────────────── */
  #an-dept-modal {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
    z-index: 7000;
    display: flex; align-items: center; justify-content: center;
    padding: var(--space-6);
    opacity: 0; visibility: hidden;
    transition: opacity 0.2s ease, visibility 0.2s ease;
  }
  #an-dept-modal.open { opacity: 1; visibility: visible; }
  .an-dept-modal-card {
    background: var(--color-surface); border-radius: var(--radius-lg);
    box-shadow: var(--shadow-xl); width: 100%; max-width: 720px;
    overflow: hidden;
    transform: scale(0.96) translateY(-12px);
    transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1);
    max-height: 90vh; overflow-y: auto;
  }
  #an-dept-modal.open .an-dept-modal-card { transform: scale(1) translateY(0); }
  .an-dept-modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--space-5) var(--space-6);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-primary);
    position: sticky; top: 0; z-index: 1;
  }
  .an-dept-modal-title { font-size: var(--font-lg); font-weight: 800; color: #fff; }

  /* ─── Reports ─────────────────────────────────────────────── */
  .an-report-grid {
    display: grid; grid-template-columns: 360px 1fr;
    gap: var(--space-6); align-items: start;
  }
  .an-report-form {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-6); box-shadow: var(--shadow-sm);
    display: flex; flex-direction: column; gap: var(--space-5);
    position: sticky; top: var(--space-4);
  }
  .an-report-type-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
  .an-report-type-radio { display: none; }
  .an-report-type-label {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: var(--space-2); padding: var(--space-3);
    border: 2px solid var(--color-border); border-radius: var(--radius-sm);
    cursor: pointer; font-size: var(--font-xs); font-weight: 600;
    color: var(--color-text-secondary); text-align: center;
    transition: all var(--transition);
  }
  .an-report-type-label:hover { border-color: var(--color-primary-light); color: var(--color-primary); }
  .an-report-type-radio:checked + .an-report-type-label {
    border-color: var(--color-primary); background: rgba(26,58,92,0.06);
    color: var(--color-primary);
  }
  .an-report-icon { font-size: 1.4rem; }
  .an-format-btns { display: flex; gap: var(--space-2); }
  .an-format-radio { display: none; }
  .an-format-label {
    flex: 1; text-align: center;
    padding: var(--space-2) var(--space-3);
    border: 2px solid var(--color-border); border-radius: var(--radius-sm);
    cursor: pointer; font-size: var(--font-sm); font-weight: 600;
    color: var(--color-text-secondary); transition: all var(--transition);
  }
  .an-format-radio:checked + .an-format-label {
    border-color: var(--color-primary); background: var(--color-primary); color: #fff;
  }

  /* Report preview panel */
  .an-report-preview {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-6); box-shadow: var(--shadow-sm);
    min-height: 500px;
  }
  .an-preview-placeholder {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 400px; gap: var(--space-4);
    color: var(--color-text-muted);
  }
  .an-preview-icon { font-size: 3rem; opacity: 0.4; }

  /* Print-friendly report */
  #an-print-frame {
    display: none;
  }
  @media print {
    #an-print-frame { display: block !important; }
    body > *:not(#an-print-frame) { display: none !important; }
    .an-print-page { page-break-after: always; }
    .an-print-page:last-child { page-break-after: avoid; }
  }

  /* ─── Loading spinners ────────────────────────────────────── */
  .an-loading {
    display: flex; align-items: center; justify-content: center;
    padding: var(--space-8); color: var(--color-text-muted); gap: var(--space-3);
  }

  /* ─── Responsive ──────────────────────────────────────────── */
  @media (max-width: 1200px) {
    .an-charts-row { grid-template-columns: 1fr 1fr; }
    .an-report-grid { grid-template-columns: 1fr; }
    .an-report-form { position: static; }
  }
  @media (max-width: 900px) {
    .an-charts-row { grid-template-columns: 1fr; }
    .an-gantt-wrap { overflow-x: scroll; }
  }
  @media (max-width: 768px) {
    .an-report-type-grid { grid-template-columns: 1fr; }
    .an-cal-grid { gap: 1px; }
    .an-cal-day { min-height: 40px; }
  }
  `;
  document.head.appendChild(s);
}


// ═════════════════════════════════════════════════════════════════════════════
// C — CDN LOADERS
// ═════════════════════════════════════════════════════════════════════════════

function _loadChartJS() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (_chartJSReady) return _chartJSReady;
  _chartJSReady = new Promise(function(res, rej) {
    const s = document.createElement('script');
    s.src = CHART_CDN; s.async = true;
    s.onload  = function() { res(window.Chart); };
    s.onerror = function() { rej(new Error('Chart.js CDN failed')); };
    document.head.appendChild(s);
  });
  return _chartJSReady;
}

function _loadJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  if (_jsPDFReady) return _jsPDFReady;
  _jsPDFReady = new Promise(function(res, rej) {
    // Load jsPDF then autoTable plugin
    const s1 = document.createElement('script');
    s1.src = JSPDF_CDN; s1.async = true;
    s1.onload = function() {
      const s2 = document.createElement('script');
      s2.src = JSPDF_AUTO_CDN; s2.async = true;
      s2.onload  = function() { res(window.jspdf); };
      s2.onerror = function() { res(window.jspdf); }; // autoTable optional
      document.head.appendChild(s2);
    };
    s1.onerror = function() { rej(new Error('jsPDF CDN failed')); };
    document.head.appendChild(s1);
  });
  return _jsPDFReady;
}

function _destroyChart(key) {
  if (_charts[key]) { try { _charts[key].destroy(); } catch {} _charts[key] = null; }
}


// ═════════════════════════════════════════════════════════════════════════════
// D — ANALYTICS VIEW — SCAFFOLD
// ═════════════════════════════════════════════════════════════════════════════

async function renderAnalyticsView() {
  _injectCSS();
  const panel = document.getElementById('view-analytics');
  if (!panel) return;

  // Role check
  const isSuperAdmin = window.store?.session?.isSuperAdmin;
  const role = window.store?.session?.role;
  if (!isSuperAdmin && role !== 'Chief Secretary') {
    panel.innerHTML = `<div class="empty-state" style="padding:var(--space-12);"><div class="empty-state-title">Access Restricted</div><div class="empty-state-desc">Analytics is available to Chief Secretary and Super Admins only.</div></div>`;
    return;
  }

  panel.innerHTML = `<div class="view-container" id="an-container">
    <div class="view-header">
      <div>
        <div class="view-title">Analytics</div>
        <div class="view-subtitle">Department intelligence · Performance tracking · SLA compliance</div>
      </div>
      <div class="view-actions">
        <button class="btn btn-secondary btn-sm" id="an-refresh" aria-label="Refresh analytics data">↺ Refresh</button>
        <button class="btn btn-primary btn-sm" onclick="window.router&&window.router.navigate('reports')" aria-label="Generate report">📄 Generate Report</button>
      </div>
    </div>

    <!-- S1: Overview Charts -->
    <div class="an-section">
      <div class="an-section-header">
        <div class="an-section-title"><div class="an-section-num">1</div> Overview</div>
      </div>
      <div class="an-charts-row" id="an-charts-row">
        ${['an-trend-wrap','an-dept-bar-wrap','an-priority-wrap'].map(function(id) {
          return `<div class="an-chart-card"><div class="an-loading"><div class="rv-spinner" aria-hidden="true"></div></div></div>`;
        }).join('')}
      </div>
    </div>

    <!-- S2: Dept performance table -->
    <div class="an-section">
      <div class="an-section-header">
        <div class="an-section-title"><div class="an-section-num">2</div> Department Performance</div>
        <div class="an-section-actions">
          <span style="font-size:var(--font-xs);color:var(--color-text-muted);">Click a row for drill-down</span>
        </div>
      </div>
      <div class="an-table-wrap" id="an-dept-table-wrap">
        <div class="an-loading"><div class="rv-spinner" aria-hidden="true"></div></div>
      </div>
    </div>

    <!-- S3: SLA Compliance -->
    <div class="an-section">
      <div class="an-section-header">
        <div class="an-section-title"><div class="an-section-num">3</div> SLA Compliance (80% threshold)</div>
      </div>
      <div class="an-sla-wrap">
        <div class="an-sla-chart-wrap">
          <canvas id="an-sla-chart" role="img" aria-label="SLA compliance bar chart"></canvas>
        </div>
      </div>
    </div>

    <!-- S4: Calendar -->
    <div class="an-section">
      <div class="an-section-header">
        <div class="an-section-title"><div class="an-section-num">4</div> Task Calendar</div>
      </div>
      <div class="card" id="an-cal-card" style="padding:var(--space-5);">
        <div class="an-loading"><div class="rv-spinner" aria-hidden="true"></div></div>
      </div>
    </div>

    <!-- S5: Gantt Timeline -->
    <div class="an-section">
      <div class="an-section-header">
        <div class="an-section-title"><div class="an-section-num">5</div> Task Timeline</div>
      </div>
      <div class="an-gantt-wrap">
        <div class="an-gantt-header">
          <span style="font-size:var(--font-sm);font-weight:700;color:var(--color-text-primary);">Gantt View</span>
          <div class="an-gantt-zoom" role="group" aria-label="Zoom level">
            <button class="an-zoom-btn" data-zoom="week">Week</button>
            <button class="an-zoom-btn active" data-zoom="month">Month</button>
            <button class="an-zoom-btn" data-zoom="quarter">Quarter</button>
          </div>
        </div>
        <div class="an-gantt-body" id="an-gantt-body">
          <div class="an-loading"><div class="rv-spinner" aria-hidden="true"></div></div>
        </div>
      </div>
    </div>
  </div>`;

  // Wire events
  document.getElementById('an-refresh')?.addEventListener('click', function() {
    _statsCache = null; _deptPerfCache = []; _heatmapCache = {}; _tasksCache = [];
    renderAnalyticsView();
  });
  document.querySelectorAll('.an-zoom-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.an-zoom-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      _ganttZoom = btn.dataset.zoom;
      _renderGantt(_tasksCache, _deptListCache);
    });
  });

  // Load data and render all sections
  await _loadAnalyticsData();
}

async function _loadAnalyticsData() {
  try {
    const Chart = await _loadChartJS();
    _configureChartDefaults(Chart);

    const [stats, deptPerf, heatmap, tasks, depts] = await Promise.all([
      _statsCache
        ? Promise.resolve(_statsCache)
        : window.api('getDashboardStats', {}).catch(function() { return {}; }),
      _deptPerfCache.length
        ? Promise.resolve(_deptPerfCache)
        : window.api('getDepartmentPerformance', {}).catch(function() { return []; }),
      Object.keys(_heatmapCache).length
        ? Promise.resolve(_heatmapCache)
        : window.api('getHeatmapData', {}).catch(function() { return {}; }),
      _tasksCache.length
        ? Promise.resolve(_tasksCache)
        : window.api('getTasks', { pageSize: 200 }).then(function(r) { return r?.tasks || []; }).catch(function() { return []; }),
      _deptListCache.length
        ? Promise.resolve(_deptListCache)
        : window.api('getDepartments', {}).catch(function() { return []; }),
    ]);

    _statsCache    = stats;
    _deptPerfCache = deptPerf;
    _heatmapCache  = heatmap;
    _tasksCache    = tasks;
    _deptListCache = depts;

    _renderOverviewCharts(Chart, stats, deptPerf, tasks);
    _renderDeptTable(deptPerf);
    _renderSLAChart(Chart, deptPerf);
    _renderCalendar(tasks);
    _renderGantt(tasks, depts);

  } catch (err) {
    window.ui?.toast('Analytics Error', err.message, 'error');
  }
}

function _configureChartDefaults(Chart) {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  Chart.defaults.font.family  = "'Inter', sans-serif";
  Chart.defaults.font.size    = 11;
  Chart.defaults.color        = isDark ? '#8B95B0' : '#6B7A99';
}


// ═════════════════════════════════════════════════════════════════════════════
// E — SECTION 1: OVERVIEW CHARTS
// ═════════════════════════════════════════════════════════════════════════════

function _renderOverviewCharts(Chart, stats, deptPerf, tasks) {
  const row = document.getElementById('an-charts-row');
  if (!row) return;
  const isDark  = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridClr = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
  const textClr = isDark ? '#8B95B0' : '#6B7A99';

  row.innerHTML = `
  <!-- Chart 1: Line — Trend -->
  <div class="an-chart-card">
    <div class="an-chart-title">
      Task Creation vs Completion (12 months)
      <button class="an-export-btn" data-chart="trend" aria-label="Export trend chart as PNG">⬇ PNG</button>
    </div>
    <div class="an-chart-wrap"><canvas id="an-trend-chart" role="img" aria-label="12-month task trend line chart"></canvas></div>
  </div>
  <!-- Chart 2: Bar — Dept -->
  <div class="an-chart-card">
    <div class="an-chart-title">
      Department Task Count (Top 10)
      <button class="an-export-btn" data-chart="dept" aria-label="Export department chart as PNG">⬇ PNG</button>
    </div>
    <div class="an-chart-wrap"><canvas id="an-dept-chart" role="img" aria-label="Department task count bar chart"></canvas></div>
  </div>
  <!-- Chart 3: Area — Priority -->
  <div class="an-chart-card">
    <div class="an-chart-title">
      Priority Distribution
      <button class="an-export-btn" data-chart="priority" aria-label="Export priority chart as PNG">⬇ PNG</button>
    </div>
    <div class="an-chart-wrap"><canvas id="an-priority-chart" role="img" aria-label="Priority distribution area chart"></canvas></div>
  </div>`;

  // Wire export buttons
  row.querySelectorAll('.an-export-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { _exportChartAsPNG(btn.dataset.chart); });
  });

  // ── Chart 1: 12-month trend line ─────────────────────────────────────────
  const trend = stats?.completionTrend || [];
  // Extend to 12 months if we only have 6
  const trendLabels   = trend.map(function(m) { return m.month; });
  const trendCreated  = trend.map(function(m) { return m.created; });
  const trendCompleted= trend.map(function(m) { return m.completed; });

  _destroyChart('trend');
  const trendCtx = document.getElementById('an-trend-chart');
  if (trendCtx) {
    _charts['trend'] = new Chart(trendCtx, {
      type: 'line',
      data: {
        labels: trendLabels,
        datasets: [
          {
            label: 'Created',
            data: trendCreated,
            borderColor: P.primaryLight,
            backgroundColor: P.primaryLight + '15',
            borderWidth: 2.5,
            pointRadius: 4, pointHoverRadius: 7,
            pointBackgroundColor: P.primaryLight,
            tension: 0.4, fill: true,
            borderDash: [5,3],
          },
          {
            label: 'Completed',
            data: trendCompleted,
            borderColor: P.success,
            backgroundColor: P.success + '20',
            borderWidth: 2.5,
            pointRadius: 4, pointHoverRadius: 7,
            pointBackgroundColor: P.success,
            tension: 0.4, fill: true,
          },
        ]
      },
      options: _lineOptions(gridClr, textClr),
    });
  }

  // ── Chart 2: Dept bar ────────────────────────────────────────────────────
  const top10  = [...deptPerf].sort(function(a,b) { return b.total - a.total; }).slice(0,10);
  const deptLabels = top10.map(function(d) { return d.deptShortName || d.deptCode; });

  _destroyChart('dept');
  const deptCtx = document.getElementById('an-dept-chart');
  if (deptCtx) {
    _charts['dept'] = new Chart(deptCtx, {
      type: 'bar',
      data: {
        labels: deptLabels,
        datasets: [
          {
            label: 'Completed',
            data: top10.map(function(d) { return d.completedCount; }),
            backgroundColor: P.success + 'BB',
            borderColor: P.success, borderWidth: 1.5, borderRadius: 4, borderSkipped: false,
          },
          {
            label: 'Pending/In Progress',
            data: top10.map(function(d) { return d.total - d.completedCount - d.overdueCount; }),
            backgroundColor: P.primaryLight + 'BB',
            borderColor: P.primaryLight, borderWidth: 1.5, borderRadius: 4, borderSkipped: false,
          },
          {
            label: 'Overdue',
            data: top10.map(function(d) { return d.overdueCount; }),
            backgroundColor: P.danger + 'BB',
            borderColor: P.danger, borderWidth: 1.5, borderRadius: 4, borderSkipped: false,
          },
        ]
      },
      options: Object.assign(_barOptions(gridClr, textClr), { scales: { x: { stacked: true, grid:{color:gridClr}, ticks:{color:textClr,maxRotation:40} }, y: { stacked: true, grid:{color:gridClr}, ticks:{color:textClr,precision:0}, beginAtZero:true } } }),
    });
  }

  // ── Chart 3: Priority area (doughnut-style) ───────────────────────────────
  const bp = stats?.byPriority || {};
  _destroyChart('priority');
  const prioCtx = document.getElementById('an-priority-chart');
  if (prioCtx) {
    _charts['priority'] = new Chart(prioCtx, {
      type: 'doughnut',
      data: {
        labels: ['Critical','High','Medium','Low'],
        datasets: [{
          data: [bp.critical||0, bp.high||0, bp.medium||0, bp.low||0],
          backgroundColor: [P.danger+'CC', P.warning+'CC', P.primaryLight+'CC', P.success+'CC'],
          borderColor: isDark ? '#1A1D27' : '#fff',
          borderWidth: 3, hoverOffset: 8,
        }]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        animation:{ duration:900, easing:'easeOutQuart' },
        cutout:'60%',
        plugins:{
          legend:{ position:'bottom', labels:{ padding:14, boxWidth:12, usePointStyle:true } },
          tooltip:{ callbacks:{ label:function(ctx) { return ` ${ctx.label}: ${ctx.parsed} tasks`; } } }
        }
      }
    });
  }
}

function _lineOptions(gridClr, textClr) {
  return {
    responsive:true, maintainAspectRatio:false,
    animation:{ duration:900, easing:'easeOutQuart' },
    interaction:{ mode:'index', intersect:false },
    plugins:{
      legend:{ position:'top', labels:{ boxWidth:12, padding:14, usePointStyle:true } },
      tooltip:{ backgroundColor: document.documentElement.getAttribute('data-theme')==='dark'?'#1A1D27':'#fff', titleColor: document.documentElement.getAttribute('data-theme')==='dark'?'#E8ECF4':'#1A2233', bodyColor:textClr, borderColor:gridClr, borderWidth:1, padding:10 }
    },
    scales:{
      x:{ grid:{color:gridClr}, ticks:{color:textClr} },
      y:{ grid:{color:gridClr}, ticks:{color:textClr,precision:0}, beginAtZero:true }
    }
  };
}
function _barOptions(gridClr, textClr) {
  return {
    responsive:true, maintainAspectRatio:false,
    animation:{ duration:900, easing:'easeOutQuart', delay:function(ctx) { return ctx.dataIndex * 40; } },
    plugins:{ legend:{ position:'top', labels:{ boxWidth:12, padding:14, usePointStyle:true } } },
    scales:{
      x:{ grid:{color:gridClr}, ticks:{color:textClr} },
      y:{ grid:{color:gridClr}, ticks:{color:textClr,precision:0}, beginAtZero:true }
    }
  };
}

function _exportChartAsPNG(key) {
  const chart = _charts[key];
  if (!chart) { window.ui?.toast('Export','Chart not available.','warning'); return; }
  const url = chart.toBase64Image();
  const a = document.createElement('a');
  a.href = url; a.download = `DRISHTI_Chart_${key}_${_todayStr()}.png`;
  a.click();
  window.ui?.toast('Exported', key + ' chart downloaded.', 'success', 2000);
}


// ═════════════════════════════════════════════════════════════════════════════
// F — SECTION 2: DEPARTMENT PERFORMANCE TABLE
// ═════════════════════════════════════════════════════════════════════════════

const PERF_COLORS = {
  'Leading the Charge': '#2E7D32',
  'Fast Movers':        '#00695C',
  'Rising Momentum':    '#2A5F9E',
  'Maintaining Course': '#A07830',
  'Focus Required':     '#F57F17',
  'Needs Attention':    '#B71C1C',
};

function _renderDeptTable(deptPerf) {
  const wrap = document.getElementById('an-dept-table-wrap');
  if (!wrap) return;

  // Sort
  const sorted = [...deptPerf].sort(function(a,b) {
    const av = a[_sortCol] !== undefined ? a[_sortCol] : 0;
    const bv = b[_sortCol] !== undefined ? b[_sortCol] : 0;
    if (typeof av === 'string') return _sortDir==='asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return _sortDir === 'asc' ? av - bv : bv - av;
  });

  const cols = [
    { key:'deptName',        label:'Department',        fmt:function(d) { return `<span style="font-weight:600;">${_esc(d.deptShortName||d.deptCode)}</span><div style="font-size:var(--font-xs);color:var(--color-text-muted);">${_esc(d.deptName)}</div>`; } },
    { key:'total',           label:'Total',             fmt:function(d) { return `<strong>${d.total}</strong>`; } },
    { key:'completedCount',  label:'Completed',         fmt:function(d) { return `<span style="color:var(--color-success);font-weight:600;">${d.completedCount}</span>`; } },
    { key:'inProgress',      label:'In Progress',       fmt:function(d) { const v=d.total-d.completedCount-d.overdueCount; return `<span style="color:var(--color-primary-light);">${Math.max(0,v)}</span>`; } },
    { key:'overdueCount',    label:'Overdue',           fmt:function(d) { return `<span style="color:var(--color-danger);font-weight:600;">${d.overdueCount}</span>`; } },
    { key:'completionRate',  label:'Completion %',      fmt:function(d) {
      const pct=d.completionRate;
      const clr=pct>=80?P.success:pct>=60?P.warning:P.danger;
      return `<div style="display:flex;align-items:center;gap:6px;"><div style="flex:1;height:6px;background:var(--color-surface-3);border-radius:99px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:${clr};border-radius:99px;"></div></div><strong style="color:${clr};min-width:36px;">${pct}%</strong></div>`;
    }},
    { key:'avgDaysToComplete',label:'Avg Days',         fmt:function(d) { return d.avgDaysToComplete!=null?d.avgDaysToComplete+'d':'—'; } },
    { key:'performanceLabel', label:'Status',           fmt:function(d) { const c=PERF_COLORS[d.performanceLabel]||P.muted; return `<span class="an-perf-badge" style="background:${c};">● ${_esc(d.performanceLabel)}</span>`; } },
  ];

  wrap.innerHTML = `
  <table class="an-table" aria-label="Department performance table">
    <thead><tr>
      ${cols.map(function(c) {
        const cls = c.key===_sortCol ? 'sort-'+_sortDir : '';
        return `<th class="${cls}" data-col="${c.key}" scope="col" aria-sort="${c.key===_sortCol?(_sortDir==='asc'?'ascending':'descending'):'none'}">${c.label}</th>`;
      }).join('')}
    </tr></thead>
    <tbody>
      ${sorted.map(function(d) {
        return `<tr data-dept-code="${d.deptCode}" aria-label="View department ${_esc(d.deptName)}">
          ${cols.map(function(c) { return `<td>${c.fmt(d)}</td>`; }).join('')}
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;

  // Sort on header click
  wrap.querySelectorAll('th[data-col]').forEach(function(th) {
    th.addEventListener('click', function() {
      if (_sortCol === th.dataset.col) {
        _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        _sortCol = th.dataset.col;
        _sortDir = 'desc';
      }
      _renderDeptTable(deptPerf);
    });
  });

  // Row click → drill-down modal
  wrap.querySelectorAll('tbody tr').forEach(function(row) {
    row.addEventListener('click', function() {
      const code = row.dataset.deptCode;
      const dept = deptPerf.find(function(d) { return d.deptCode === code; });
      if (dept) _openDeptModal(dept);
    });
  });
}

function _openDeptModal(dept) {
  _injectDeptModal();
  const modal = document.getElementById('an-dept-modal');
  const title = document.getElementById('an-dept-modal-title');
  const body  = document.getElementById('an-dept-modal-body');
  if (!modal || !title || !body) return;

  title.textContent = dept.deptName;

  const colour = PERF_COLORS[dept.performanceLabel] || P.muted;
  const tasks  = _tasksCache.filter(function(t) {
    return (t.AssignedDepts||'').split(',').map(function(d){return d.trim();}).includes(dept.deptCode);
  });
  const pending    = tasks.filter(function(t){return t.Status==='PENDING';}).length;
  const inProgress = tasks.filter(function(t){return t.Status==='IN_PROGRESS';}).length;

  body.innerHTML = `
  <div style="padding:var(--space-5) var(--space-6);">
    <!-- Stats row -->
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:var(--space-3);margin-bottom:var(--space-5);">
      ${[
        {l:'Total',    v:dept.total,           c:'var(--color-primary)'},
        {l:'Completed',v:dept.completedCount,  c:P.success},
        {l:'Pending',  v:pending,              c:P.warning},
        {l:'In Prog.', v:inProgress,           c:P.primaryLight},
        {l:'Overdue',  v:dept.overdueCount,    c:P.danger},
      ].map(function(s) {
        return `<div style="background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:var(--space-3);text-align:center;">
          <div style="font-size:1.5rem;font-weight:800;color:${s.c};line-height:1;">${s.v}</div>
          <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:2px;">${s.l}</div>
        </div>`;
      }).join('')}
    </div>
    <!-- Performance -->
    <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);padding:var(--space-3);background:color-mix(in srgb,${colour} 8%,transparent);border-radius:var(--radius-sm);border-left:4px solid ${colour};">
      <span style="font-size:1rem;font-weight:800;color:${colour};">${dept.completionRate}%</span>
      <span style="font-size:var(--font-sm);font-weight:700;color:${colour};">Completion Rate · ${_esc(dept.performanceLabel)}</span>
      ${dept.avgDaysToComplete!=null?`<span style="font-size:var(--font-xs);color:var(--color-text-muted);margin-left:auto;">Avg ${dept.avgDaysToComplete} days to complete</span>`:''}
    </div>
    <!-- Task list -->
    <div style="font-size:var(--font-xs);font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--color-text-muted);margin-bottom:var(--space-3);">Recent Tasks (${tasks.length})</div>
    <div style="max-height:260px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius-sm);">
      ${tasks.slice(0,15).map(function(t) {
        const pctClr = t.ProgressPercent<30?P.danger:t.ProgressPercent<70?P.warning:P.success;
        return `<div style="display:grid;grid-template-columns:auto 1fr auto auto;gap:var(--space-3);align-items:center;padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--color-border);">
          <code style="font-size:0.7rem;color:var(--color-primary-light);font-family:monospace;">${_esc(t.TaskID)}</code>
          <div style="font-size:var(--font-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(t.Subject)}</div>
          <span class="status-pill status-${(t.Status||'pending').toLowerCase().replace('_','-')}" style="font-size:0.65rem;">${t.Status}</span>
          <span style="font-size:var(--font-xs);font-weight:700;color:${pctClr};">${t.ProgressPercent||0}%</span>
        </div>`;
      }).join('') || '<div style="padding:var(--space-5);text-align:center;color:var(--color-text-muted);">No tasks found.</div>'}
    </div>
  </div>`;

  modal.classList.add('open');
}

function _injectDeptModal() {
  if (document.getElementById('an-dept-modal')) return;
  const el = document.createElement('div');
  el.id = 'an-dept-modal';
  el.setAttribute('role','dialog'); el.setAttribute('aria-modal','true');
  el.setAttribute('aria-labelledby','an-dept-modal-title');
  el.innerHTML = `
  <div class="an-dept-modal-card">
    <div class="an-dept-modal-header">
      <div class="an-dept-modal-title" id="an-dept-modal-title">Department</div>
      <button class="icon-btn" id="an-dept-modal-close" style="color:rgba(255,255,255,0.8);" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div id="an-dept-modal-body"></div>
  </div>`;
  document.body.appendChild(el);
  document.getElementById('an-dept-modal-close')?.addEventListener('click', function() { el.classList.remove('open'); });
  el.addEventListener('click', function(e) { if(e.target===el) el.classList.remove('open'); });
  document.addEventListener('keydown', function(e) { if(e.key==='Escape') el.classList.remove('open'); });
}


// ═════════════════════════════════════════════════════════════════════════════
// G — SECTION 3: SLA COMPLIANCE CHART
// ═════════════════════════════════════════════════════════════════════════════

async function _renderSLAChart(Chart, deptPerf) {
  const ctx = document.getElementById('an-sla-chart');
  if (!ctx || !deptPerf.length) return;
  const isDark  = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridClr = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
  const textClr = isDark ? '#8B95B0' : '#6B7A99';

  // SLA = completion rate (tasks completed / total)
  const sorted = [...deptPerf].sort(function(a,b) { return b.completionRate - a.completionRate; }).slice(0,12);
  const labels = sorted.map(function(d) { return d.deptShortName || d.deptCode; });
  const rates  = sorted.map(function(d) { return d.completionRate; });

  _destroyChart('sla');
  _charts['sla'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Completion Rate %',
          data: rates,
          backgroundColor: rates.map(function(r) { return (r >= 80 ? P.success : r >= 60 ? P.warning : P.danger) + 'BB'; }),
          borderColor:     rates.map(function(r) { return r >= 80 ? P.success : r >= 60 ? P.warning : P.danger; }),
          borderWidth: 1.5, borderRadius: 5, borderSkipped: false,
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 900, easing: 'easeOutQuart', delay: function(ctx) { return ctx.dataIndex * 40; } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(ctx) { return ` Completion: ${ctx.parsed.y}%`; },
            afterLabel: function(ctx) { return ctx.parsed.y >= 80 ? '✓ SLA Met' : '⚠ Below SLA'; },
          }
        },
        // SLA threshold line annotation (drawn manually on chart)
      },
      scales: {
        x: { grid: {color:gridClr}, ticks: {color:textClr, maxRotation:40} },
        y: {
          grid: {color:gridClr}, ticks: {color:textClr, callback:function(v){return v+'%';}},
          beginAtZero: true, max: 100,
        }
      }
    },
    plugins: [{
      id: 'sla-line',
      afterDraw: function(chart) {
        const { ctx: c, chartArea: { left, right, top }, scales: { y } } = chart;
        const yPos = y.getPixelForValue(80);
        c.save();
        c.beginPath();
        c.moveTo(left, yPos); c.lineTo(right, yPos);
        c.strokeStyle = P.danger;
        c.lineWidth = 2;
        c.setLineDash([6, 4]);
        c.stroke();
        c.fillStyle = P.danger;
        c.font = 'bold 10px Inter, sans-serif';
        c.fillText('SLA 80%', right - 56, yPos - 6);
        c.restore();
      }
    }]
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// H — SECTION 4: CALENDAR VIEW
// ═════════════════════════════════════════════════════════════════════════════

function _renderCalendar(tasks) {
  const card = document.getElementById('an-cal-card');
  if (!card) return;

  const year  = _calendarDate.getFullYear();
  const month = _calendarDate.getMonth();
  const today = new Date();
  const monthLabel = _calendarDate.toLocaleDateString('en-IN', { month:'long', year:'numeric' });

  // Build task map: 'YYYY-MM-DD' → tasks[]
  const taskMap = {};
  tasks.forEach(function(t) {
    const dates = [];
    if (t.DueDate)     dates.push(_toDateStr(new Date(t.DueDate)));
    if (t.AssignedDate)dates.push(_toDateStr(new Date(t.AssignedDate)));
    dates.forEach(function(d) {
      if (!taskMap[d]) taskMap[d] = [];
      if (!taskMap[d].find(function(x) { return x.TaskID === t.TaskID; })) taskMap[d].push(t);
    });
  });

  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month+1, 0).getDate();

  let calHTML = `
  <div class="an-cal-header">
    <button class="btn btn-ghost btn-sm" id="an-cal-prev" aria-label="Previous month">← Prev</button>
    <div class="an-cal-month">${monthLabel}</div>
    <button class="btn btn-ghost btn-sm" id="an-cal-next" aria-label="Next month">Next →</button>
  </div>
  <div class="an-cal-grid">
    ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(function(d) { return `<div class="an-cal-dow">${d}</div>`; }).join('')}`;

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    calHTML += `<div class="an-cal-day empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date    = new Date(year, month, day);
    const dateStr = _toDateStr(date);
    const dayTasks = taskMap[dateStr] || [];
    const isToday  = date.toDateString() === today.toDateString();

    const dots = dayTasks.slice(0,4).map(function(t) {
      const clr = PRIORITY_COLORS[t.Priority] || P.muted;
      return `<div class="an-day-dot" style="background:${clr};" aria-hidden="true"></div>`;
    }).join('');

    calHTML += `
    <div class="an-cal-day${isToday?' today':''}${dayTasks.length?' has-tasks':''}"
      data-date="${dateStr}"
      role="button"
      tabindex="${dayTasks.length ? '0' : '-1'}"
      aria-label="${dateStr}: ${dayTasks.length} task${dayTasks.length!==1?'s':''}"
    >
      <div class="an-day-num">${day}</div>
      ${dots ? `<div class="an-day-dots">${dots}</div>` : ''}
      ${dayTasks.length > 0 ? `<div class="an-day-count">${dayTasks.length} task${dayTasks.length!==1?'s':''}</div>` : ''}
    </div>`;
  }

  calHTML += `</div>`;
  card.innerHTML = calHTML;

  // Navigation
  document.getElementById('an-cal-prev')?.addEventListener('click', function() {
    _calendarDate = new Date(_calendarDate.getFullYear(), _calendarDate.getMonth()-1, 1);
    _renderCalendar(_tasksCache);
  });
  document.getElementById('an-cal-next')?.addEventListener('click', function() {
    _calendarDate = new Date(_calendarDate.getFullYear(), _calendarDate.getMonth()+1, 1);
    _renderCalendar(_tasksCache);
  });

  // Day click → popover
  card.querySelectorAll('.an-cal-day.has-tasks').forEach(function(cell) {
    cell.addEventListener('click', function(e) { _showDayPopover(e, cell.dataset.date, taskMap[cell.dataset.date]||[]); });
    cell.addEventListener('keydown', function(e) { if(e.key==='Enter'||e.key===' '){e.preventDefault();cell.click();} });
  });

  // Close popover on outside click
  document.addEventListener('click', function() { _closePopover(); }, { once: false });
}

let _popoverEl = null;

function _showDayPopover(event, dateStr, tasks) {
  _closePopover();
  event.stopPropagation();

  const pop = document.createElement('div');
  pop.className = 'an-day-popover';
  pop.setAttribute('role','tooltip');
  pop.setAttribute('aria-label', `Tasks for ${dateStr}`);

  const d = new Date(dateStr);
  const label = d.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'});

  pop.innerHTML = `
  <div class="an-popover-title">${label} · ${tasks.length} task${tasks.length!==1?'s':''}</div>
  ${tasks.map(function(t) {
    const clr = PRIORITY_COLORS[t.Priority] || P.muted;
    return `<div class="an-popover-task" onclick="window.router&&window.router.navigate('tasks')" aria-label="View task ${_esc(t.TaskID)}">
      <div class="an-popover-dot" style="background:${clr};"></div>
      <div class="an-popover-subject">
        <div style="font-weight:600;">${_esc(t.Subject.substring(0,40))}${t.Subject.length>40?'…':''}</div>
        <div style="font-size:0.65rem;color:var(--color-text-muted);">${t.TaskID} · ${t.Status}</div>
      </div>
    </div>`;
  }).join('')}`;

  document.body.appendChild(pop);
  _popoverEl = pop;

  // Position near clicked cell
  const rect = event.currentTarget.getBoundingClientRect();
  const pw   = pop.offsetWidth || 260;
  const ph   = pop.offsetHeight || 200;
  let  left  = rect.left + window.scrollX;
  let  top   = rect.bottom + window.scrollY + 6;
  if (left + pw > window.innerWidth) left = window.innerWidth - pw - 12;
  if (top + ph > window.innerHeight + window.scrollY) top = rect.top + window.scrollY - ph - 6;
  pop.style.left = left + 'px';
  pop.style.top  = top  + 'px';

  setTimeout(function() {
    document.addEventListener('click', _closePopover, { once: true });
  }, 0);
}

function _closePopover() {
  if (_popoverEl) { _popoverEl.remove(); _popoverEl = null; }
}


// ═════════════════════════════════════════════════════════════════════════════
// I — SECTION 5: GANTT TIMELINE
// ═════════════════════════════════════════════════════════════════════════════

function _renderGantt(tasks, depts) {
  const body = document.getElementById('an-gantt-body');
  if (!body) return;

  const now   = new Date();
  const today = _toDateStr(now);

  // Define the visible date window
  let start, end, cols;
  if (_ganttZoom === 'week') {
    // Current week Mon–Sun
    const mon = new Date(now); mon.setDate(now.getDate() - (now.getDay()||7) + 1);
    start = mon; end = new Date(mon.getTime() + 6*86400000);
    cols  = 7;
  } else if (_ganttZoom === 'quarter') {
    const qMon = [0,3,6,9][Math.floor(now.getMonth()/3)];
    start = new Date(now.getFullYear(), qMon, 1);
    end   = new Date(now.getFullYear(), qMon+3, 0);
    cols  = 13; // ~13 weeks in a quarter
  } else {
    // Month
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end   = new Date(now.getFullYear(), now.getMonth()+1, 0);
    cols  = end.getDate();
  }

  const totalMs   = end.getTime() - start.getTime() + 86400000;
  const colLabels = _buildGanttColLabels(start, end, _ganttZoom, cols);

  // Group tasks by primary dept
  const deptMap = {};
  (depts || []).forEach(function(d) { deptMap[d.deptCode] = d.deptName; });

  const groups = {};
  tasks.forEach(function(t) {
    const code = t.PrimaryDept || 'OTHER';
    if (!groups[code]) groups[code] = [];
    groups[code].push(t);
  });

  const visibleGroups = Object.keys(groups).slice(0,12);

  if (!visibleGroups.length) {
    body.innerHTML = '<div class="an-gantt-empty">No tasks to display for the selected period.</div>';
    return;
  }

  let html = `<div class="an-gantt-grid">
  <!-- Header row -->
  <div class="an-gantt-row header-row">
    <div class="an-gantt-label">Department</div>
    <div class="an-gantt-track">
      ${colLabels.map(function(l) { return `<div class="an-gantt-col-label">${l}</div>`; }).join('')}
    </div>
  </div>`;

  visibleGroups.forEach(function(code) {
    const deptName = (deptMap[code] || code).substring(0,18);
    const deptTasks= groups[code].filter(function(t) {
      // Show tasks that overlap the visible window
      const tStart = t.AssignedDate ? new Date(t.AssignedDate) : new Date(t.CreatedAt);
      const tEnd   = t.DueDate ? new Date(t.DueDate) : new Date();
      return tEnd >= start && tStart <= end;
    });

    html += `<div class="an-gantt-row">
      <div class="an-gantt-label" title="${_esc(deptMap[code]||code)}">${_esc(deptName)}</div>
      <div class="an-gantt-track" style="position:relative;min-height:40px;">`;

    deptTasks.slice(0, 5).forEach(function(t, i) {
      const tStart = t.AssignedDate ? new Date(t.AssignedDate) : new Date(t.CreatedAt);
      const tEnd   = t.DueDate      ? new Date(t.DueDate)      : now;
      const clampedStart = tStart < start ? start : tStart;
      const clampedEnd   = tEnd   > end   ? end   : tEnd;

      const leftPct  = Math.max(0, (clampedStart.getTime()-start.getTime())/totalMs*100);
      const widthPct = Math.max(1, (clampedEnd.getTime()-clampedStart.getTime()+86400000)/totalMs*100);

      const clr = STATUS_COLORS[t.Status] || P.muted;
      const top = 6 + i * 0; // stack vertically if needed (simplified: just offset slightly)

      html += `<div class="an-gantt-bar"
        style="left:${leftPct.toFixed(1)}%;width:${Math.min(widthPct,100-leftPct).toFixed(1)}%;background:${clr};top:${top}px;"
        title="${_esc(t.Subject)} (${t.Status})"
        aria-label="${_esc(t.TaskID)}: ${_esc(t.Subject)}"
        onclick="window.router&&window.router.navigate('tasks')"
      >${_esc(t.TaskID)}</div>`;
    });

    html += `</div></div>`;
  });

  html += '</div>';
  body.innerHTML = html;
}

function _buildGanttColLabels(start, end, zoom, cols) {
  const labels = [];
  if (zoom === 'week') {
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getTime() + i*86400000);
      labels.push(d.toLocaleDateString('en-IN',{weekday:'short',day:'numeric'}));
    }
  } else if (zoom === 'month') {
    // Show every 5th day
    const days = end.getDate();
    for (let d = 1; d <= days; d += Math.ceil(days/6)) {
      labels.push(d + '');
    }
  } else {
    // Quarter: show month names
    for (let m = 0; m < 3; m++) {
      const mon = new Date(start.getFullYear(), start.getMonth()+m, 1);
      labels.push(mon.toLocaleDateString('en-IN',{month:'short'}));
    }
  }
  return labels;
}


// ═════════════════════════════════════════════════════════════════════════════
// J — REPORTS VIEW
// ═════════════════════════════════════════════════════════════════════════════

const REPORT_TYPES = [
  { id:'executive',   label:'Executive Summary',  icon:'📊' },
  { id:'department',  label:'Department Report',  icon:'🏢' },
  { id:'task-register',label:'Task Register',     icon:'📋' },
  { id:'overdue',     label:'Overdue Analysis',   icon:'⚠' },
  { id:'progress',    label:'Progress Report',    icon:'📈' },
];

async function renderReportsView() {
  _injectCSS();
  const panel = document.getElementById('view-reports');
  if (!panel) return;

  const isSuperAdmin = window.store?.session?.isSuperAdmin;
  const role = window.store?.session?.role;
  if (!isSuperAdmin && role !== 'Chief Secretary') {
    panel.innerHTML = `<div class="empty-state" style="padding:var(--space-12);"><div class="empty-state-title">Access Restricted</div><div class="empty-state-desc">Reports are available to Chief Secretary and Super Admins only.</div></div>`;
    return;
  }

  // Ensure depts are loaded for multi-select
  if (!_deptListCache.length) {
    try { _deptListCache = await window.api('getDepartments',{}); } catch {}
  }

  panel.innerHTML = `<div class="view-container">
  <div class="view-header">
    <div>
      <div class="view-title">Report Generation</div>
      <div class="view-subtitle">Export government-branded reports in Excel, PDF, or Print format</div>
    </div>
  </div>

  <div class="an-report-grid">
    <!-- Form -->
    <div class="an-report-form">
      <div>
        <div class="form-label" style="margin-bottom:var(--space-3);">Report Type</div>
        <div class="an-report-type-grid">
          ${REPORT_TYPES.map(function(rt, i) {
            return `<label>
              <input type="radio" name="rpt-type" class="an-report-type-radio" value="${rt.id}" ${i===0?'checked':''} aria-label="${rt.label}" />
              <span class="an-report-type-label">
                <span class="an-report-icon">${rt.icon}</span>
                ${rt.label}
              </span>
            </label>`;
          }).join('')}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="rpt-date-from">Date From</label>
        <input type="date" class="input" id="rpt-date-from" aria-label="Report start date" />
      </div>
      <div class="form-group">
        <label class="form-label" for="rpt-date-to">Date To</label>
        <input type="date" class="input" id="rpt-date-to" aria-label="Report end date" />
      </div>

      <div class="form-group">
        <label class="form-label">Departments</label>
        <div style="border:1px solid var(--color-border);border-radius:var(--radius-sm);max-height:160px;overflow-y:auto;background:var(--color-surface);">
          <label style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--color-border);font-size:var(--font-sm);cursor:pointer;">
            <input type="checkbox" id="rpt-all-depts" checked aria-label="All departments" />
            <strong>All Departments</strong>
          </label>
          ${_deptListCache.map(function(d) {
            return `<label style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2) var(--space-3);font-size:var(--font-sm);cursor:pointer;border-bottom:1px solid var(--color-border);">
              <input type="checkbox" class="rpt-dept-cb" value="${d.deptCode}" checked aria-label="${_esc(d.deptName)}" />
              ${_esc(d.deptShortName||d.deptCode)} — ${_esc(d.deptName)}
            </label>`;
          }).join('')}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="rpt-status">Status Filter</label>
        <select class="select" id="rpt-status" aria-label="Filter by status">
          <option value="">All Statuses</option>
          <option>PENDING</option><option>IN_PROGRESS</option>
          <option>COMPLETED</option><option>OVERDUE</option>
          <option>REVIEW</option><option>DEFERRED</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="rpt-priority">Priority Filter</label>
        <select class="select" id="rpt-priority" aria-label="Filter by priority">
          <option value="">All Priorities</option>
          <option>CRITICAL</option><option>HIGH</option>
          <option>MEDIUM</option><option>LOW</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Output Format</label>
        <div class="an-format-btns" role="group" aria-label="Report format">
          <label>
            <input type="radio" name="rpt-format" class="an-format-radio" value="pdf" checked aria-label="PDF format" />
            <span class="an-format-label">📄 PDF</span>
          </label>
          <label>
            <input type="radio" name="rpt-format" class="an-format-radio" value="excel" aria-label="Excel (CSV) format" />
            <span class="an-format-label">📊 Excel</span>
          </label>
          <label>
            <input type="radio" name="rpt-format" class="an-format-radio" value="print" aria-label="Print format" />
            <span class="an-format-label">🖨 Print</span>
          </label>
        </div>
      </div>

      <button class="btn btn-primary" id="rpt-generate" aria-label="Generate report" style="justify-content:center;">
        ⚡ Generate Report
      </button>
      <div id="rpt-status-msg" style="font-size:var(--font-xs);color:var(--color-text-muted);text-align:center;display:none;"></div>
    </div>

    <!-- Preview -->
    <div class="an-report-preview" id="rpt-preview">
      <div class="an-preview-placeholder">
        <div class="an-preview-icon">📄</div>
        <div style="font-size:var(--font-sm);font-weight:700;color:var(--color-text-secondary);">Report preview will appear here</div>
        <div style="font-size:var(--font-xs);color:var(--color-text-muted);">Configure options and click Generate</div>
      </div>
    </div>
  </div>
  </div>`;

  // All-depts checkbox toggle
  document.getElementById('rpt-all-depts')?.addEventListener('change', function(e) {
    document.querySelectorAll('.rpt-dept-cb').forEach(function(cb) { cb.checked = e.target.checked; });
  });

  document.getElementById('rpt-generate')?.addEventListener('click', _generateReport);
}

async function _generateReport() {
  const btn     = document.getElementById('rpt-generate');
  const msgEl   = document.getElementById('rpt-status-msg');
  const preview = document.getElementById('rpt-preview');

  const type     = (document.querySelector('input[name="rpt-type"]:checked')?.value || 'executive');
  const format   = (document.querySelector('input[name="rpt-format"]:checked')?.value || 'pdf');
  const status   = document.getElementById('rpt-status')?.value   || '';
  const priority = document.getElementById('rpt-priority')?.value  || '';
  const dateFrom = document.getElementById('rpt-date-from')?.value || '';
  const dateTo   = document.getElementById('rpt-date-to')?.value   || '';
  const selDepts = [...document.querySelectorAll('.rpt-dept-cb:checked')].map(function(cb) { return cb.value; });
  const deptCode = selDepts.length === _deptListCache.length ? '' : selDepts.join(',');

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }
  if (msgEl) { msgEl.textContent = 'Fetching data…'; msgEl.style.display = ''; }

  try {
    const result = await window.api('generateReport', {
      type:       format === 'excel' ? 'excel' : 'pdf',
      title:      REPORT_TYPES.find(function(r){return r.id===type;})?.label || 'DRISHTI Report',
      status:     status   || undefined,
      priority:   priority || undefined,
      deptCode:   deptCode || undefined,
      dateFrom:   dateFrom || undefined,
      dateTo:     dateTo   || undefined,
    });

    if (msgEl) { msgEl.textContent = `Report compiled — ${result?.rowCount || 0} records.`; }

    if (format === 'excel') {
      _downloadCSV(result?.data || '', REPORT_TYPES.find(function(r){return r.id===type;})?.label || 'Report');
      _showPreview(preview, result, 'excel', type);
      window.ui?.toast('Excel Ready', (result?.rowCount||0) + ' rows exported.', 'success');
    } else if (format === 'pdf') {
      await _generatePDF(result, type);
    } else {
      _printReport(result, type);
    }

  } catch (err) {
    window.ui?.toast('Report Error', err.message, 'error');
    if (msgEl) msgEl.textContent = 'Error: ' + err.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Generate Report'; }
  }
}

function _downloadCSV(csvData, title) {
  const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `DRISHTI_${title.replace(/\s+/g,'_')}_${_todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function _generatePDF(result, reportType) {
  let jspdf;
  try { jspdf = await _loadJsPDF(); }
  catch { window.ui?.toast('PDF Error','Could not load PDF library.','error'); return; }

  const { jsPDF } = jspdf;
  if (!jsPDF) { window.ui?.toast('PDF Error','jsPDF not available.','error'); return; }

  const doc    = new jsPDF({ orientation:'landscape', unit:'pt', format:'a4' });
  const pw     = doc.internal.pageSize.getWidth();
  const ph     = doc.internal.pageSize.getHeight();
  const margin = 40;
  const title  = REPORT_TYPES.find(function(r){return r.id===reportType;})?.label || 'Report';
  const data   = result?.data || {};
  const rows   = data.rows || [];
  const cols   = data.columns || [];
  const stats  = data.stats || {};

  // ── Cover page ────────────────────────────────────────────────────────────
  // Header bar
  doc.setFillColor(26, 58, 92); // #1A3A5C
  doc.rect(0, 0, pw, 80, 'F');

  doc.setTextColor(201, 168, 76); // accent
  doc.setFontSize(22); doc.setFont('helvetica','bold');
  doc.text('DRISHTI', margin, 38);

  doc.setTextColor(255,255,255);
  doc.setFontSize(11); doc.setFont('helvetica','normal');
  doc.text('Decision Review, Intelligence, Supervision, Harmonisation, Tracking & Insights', margin, 56);
  doc.text('Chief Secretary Executive Command Centre · Government of Sikkim', margin, 70);

  // Report title
  doc.setTextColor(26,58,92);
  doc.setFontSize(18); doc.setFont('helvetica','bold');
  doc.text(title, pw/2, 120, { align:'center' });

  doc.setFontSize(11); doc.setFont('helvetica','normal');
  doc.setTextColor(107,122,153);
  doc.text('Generated: ' + new Date().toLocaleString('en-IN'), pw/2, 140, { align:'center' });
  doc.text('Generated by: ' + (window.store?.session?.fullName || window.store?.session?.email || '—'), pw/2, 156, { align:'center' });

  // Summary stats box
  const statKeys = Object.keys(stats);
  if (statKeys.length) {
    doc.setFillColor(240,242,245);
    doc.roundedRect(margin, 170, pw-margin*2, 60, 6, 6, 'F');
    const boxW = (pw-margin*2) / statKeys.length;
    statKeys.forEach(function(k, i) {
      const x = margin + i*boxW + boxW/2;
      doc.setTextColor(26,58,92); doc.setFontSize(18); doc.setFont('helvetica','bold');
      doc.text(String(stats[k]||0), x, 200, { align:'center' });
      doc.setTextColor(107,122,153); doc.setFontSize(9); doc.setFont('helvetica','normal');
      doc.text(k, x, 218, { align:'center' });
    });
  }

  // Confidentiality footer
  doc.setFontSize(8); doc.setTextColor(107,122,153);
  doc.text('CONFIDENTIAL — For Official Use Only · Government of Sikkim', pw/2, ph-20, { align:'center' });
  doc.text(`Page 1`, pw-margin, ph-20, { align:'right' });

  // ── Data table page ───────────────────────────────────────────────────────
  if (rows.length && cols.length) {
    doc.addPage();

    // Table header
    doc.setFillColor(26,58,92);
    doc.rect(0, 0, pw, 28, 'F');
    doc.setTextColor(201,168,76); doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text(title + ' — Data', margin, 18);

    const tableHead = [cols.map(function(c) { return c.label; })];
    const tableBody = rows.map(function(r) {
      return cols.map(function(c) { return String(r[c.key]||'—'); });
    });

    if (doc.autoTable) {
      doc.autoTable({
        head:       tableHead,
        body:       tableBody,
        startY:     36,
        margin:     { left: margin, right: margin },
        headStyles: {
          fillColor:   [26,58,92],
          textColor:   [255,255,255],
          fontStyle:   'bold',
          fontSize:    9,
        },
        alternateRowStyles: { fillColor: [245,247,250] },
        bodyStyles:   { fontSize: 8, textColor: [26,34,51] },
        columnStyles: { 0:{ fontStyle:'bold' } },
        didDrawPage:  function(data) {
          doc.setFontSize(8); doc.setTextColor(107,122,153);
          doc.text('DRISHTI · Government of Sikkim · CONFIDENTIAL', margin, ph-12);
          doc.text('Page ' + data.pageNumber, pw-margin, ph-12, { align:'right' });
        }
      });
    } else {
      // Fallback without autoTable: simple manual table
      let yPos = 50;
      doc.setFontSize(8); doc.setTextColor(26,34,51);
      tableBody.slice(0,40).forEach(function(row) {
        if (yPos > ph - 30) { doc.addPage(); yPos = 40; }
        doc.text(row.join(' | '), margin, yPos);
        yPos += 14;
      });
    }
  }

  // ── Export chart images (if available) ───────────────────────────────────
  const chartKeys = Object.keys(_charts).filter(function(k) { return _charts[k]; });
  if (chartKeys.length) {
    doc.addPage();
    doc.setFillColor(26,58,92); doc.rect(0,0,pw,28,'F');
    doc.setTextColor(201,168,76); doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text('Analytics Charts', margin, 18);

    let cy = 40;
    const cw = (pw-margin*2-20)/2;
    let cx = margin;
    chartKeys.slice(0,4).forEach(function(key) {
      try {
        const imgData = _charts[key].toBase64Image();
        doc.addImage(imgData, 'PNG', cx, cy, cw, 150);
        cx += cw + 20;
        if (cx > pw/2) { cx = margin; cy += 160; }
      } catch {}
    });

    doc.setFontSize(8); doc.setTextColor(107,122,153);
    doc.text('DRISHTI Analytics · Government of Sikkim · CONFIDENTIAL', margin, ph-12);
  }

  doc.save(`DRISHTI_${title.replace(/\s+/g,'_')}_${_todayStr()}.pdf`);
  window.ui?.toast('PDF Ready', title + ' downloaded.', 'success');

  // Show preview
  const preview = document.getElementById('rpt-preview');
  if (preview) _showPreview(preview, result, 'pdf', reportType);
}

function _printReport(result, reportType) {
  const title  = REPORT_TYPES.find(function(r){return r.id===reportType;})?.label || 'Report';
  const data   = result?.data || {};
  const rows   = data.rows || [];
  const cols   = data.columns || [];
  const stats  = data.stats || {};

  const win = window.open('','_blank');
  if (!win) { window.ui?.toast('Print','Enable pop-ups to print reports.','warning'); return; }

  const statHTML = Object.entries(stats).map(function(e) {
    return `<div style="text-align:center;padding:12px 20px;border:1px solid #E0E4EC;border-radius:8px;">
      <div style="font-size:1.5rem;font-weight:900;color:#1A3A5C;">${e[1]}</div>
      <div style="font-size:0.75rem;color:#6B7A99;">${e[0]}</div>
    </div>`;
  }).join('');

  const tableHTML = (cols.length && rows.length) ? `
    <table style="width:100%;border-collapse:collapse;font-size:0.8rem;margin-top:24px;">
      <thead><tr>${cols.map(function(c){return `<th style="background:#1A3A5C;color:#fff;padding:8px 12px;text-align:left;font-size:0.7rem;text-transform:uppercase;">${c.label}</th>`;}).join('')}</tr></thead>
      <tbody>
        ${rows.map(function(r,i){return `<tr style="background:${i%2===0?'#fff':'#F5F7FA'};">${cols.map(function(c){return `<td style="padding:7px 12px;border-bottom:1px solid #E0E4EC;">${_esc(String(r[c.key]||'—'))}</td>`;}).join('')}</tr>`;}).join('')}
      </tbody>
    </table>` : '';

  win.document.write(`<!DOCTYPE html><html lang="en"><head>
    <meta charset="UTF-8"/>
    <title>DRISHTI — ${_esc(title)}</title>
    <style>
      @page { margin: 20mm; }
      body { font-family: 'Inter', Arial, sans-serif; color: #1A2233; }
      .header { background:#1A3A5C; color:#C9A84C; padding:20px 28px; margin-bottom:24px; }
      .title { font-size:1.3rem; font-weight:900; }
      .subtitle { font-size:0.8rem; color:rgba(255,255,255,0.6); margin-top:4px; }
      .stats { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:20px; }
      .footer { margin-top:32px; padding-top:12px; border-top:1px solid #E0E4EC; font-size:0.7rem; color:#9BA8BE; display:flex; justify-content:space-between; }
      @media print { .no-print { display:none; } }
    </style>
  </head><body>
    <div class="header">
      <div class="title">DRISHTI — ${_esc(title)}</div>
      <div class="subtitle">Government of Sikkim · Chief Secretary Executive Command Centre<br/>Generated: ${new Date().toLocaleString('en-IN')} · By: ${_esc(window.store?.session?.fullName||'—')}</div>
    </div>
    <div class="stats">${statHTML}</div>
    ${tableHTML}
    <div class="footer">
      <span>CONFIDENTIAL — For Official Use Only</span>
      <span>DRISHTI · Government of Sikkim</span>
    </div>
    <div class="no-print" style="margin-top:20px;">
      <button onclick="window.print()" style="background:#1A3A5C;color:#fff;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:0.9rem;font-weight:600;">🖨 Print Now</button>
    </div>
  </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(function() { win.print(); }, 500);
}

function _showPreview(preview, result, format, reportType) {
  const data  = result?.data || {};
  const rows  = data.rows  || [];
  const stats = data.stats || {};
  const title = REPORT_TYPES.find(function(r){return r.id===reportType;})?.label || 'Report';
  const icon  = format==='excel'?'📊':format==='pdf'?'📄':'🖨';

  preview.innerHTML = `
  <div style="background:var(--color-primary);color:var(--color-accent);padding:var(--space-5) var(--space-6);border-radius:var(--radius-sm) var(--radius-sm) 0 0;font-weight:800;font-size:var(--font-base);">
    ${icon} ${_esc(title)} Preview
  </div>
  <div style="padding:var(--space-5);">
    <div style="display:flex;flex-wrap:wrap;gap:var(--space-3);margin-bottom:var(--space-5);">
      ${Object.entries(stats).map(function(e) {
        return `<div style="background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:var(--space-3) var(--space-5);text-align:center;">
          <div style="font-size:var(--font-xl);font-weight:900;color:var(--color-primary);">${e[1]}</div>
          <div style="font-size:var(--font-xs);color:var(--color-text-muted);">${e[0]}</div>
        </div>`;
      }).join('')}
    </div>
    <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-bottom:var(--space-3);">Showing first 10 of ${rows.length} records</div>
    <div style="overflow-x:auto;border:1px solid var(--color-border);border-radius:var(--radius-sm);">
      <table style="width:100%;border-collapse:collapse;font-size:var(--font-xs);">
        <thead><tr style="background:var(--color-primary);">
          ${(data.columns||[]).map(function(c){return `<th style="color:#fff;padding:var(--space-2) var(--space-3);text-align:left;white-space:nowrap;">${_esc(c.label)}</th>`;}).join('')}
        </tr></thead>
        <tbody>
          ${rows.slice(0,10).map(function(r,i){
            const bg = i%2===0?'var(--color-surface)':'var(--color-surface-2)';
            return `<tr style="background:${bg};">${(data.columns||[]).map(function(c){return `<td style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--color-border);">${_esc(String(r[c.key]||'—').substring(0,40))}</td>`;}).join('')}</tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:var(--space-3);">
      ${format==='excel'?'✓ CSV file downloaded to your device.':format==='pdf'?'✓ PDF saved to your device.':'✓ Print dialog opened.'}
    </div>
  </div>`;
}


// ═════════════════════════════════════════════════════════════════════════════
// K — HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function _esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _toDateStr(date) {
  if (!date || isNaN(date.getTime())) return '';
  return date.getUTCFullYear()+'-'+String(date.getUTCMonth()+1).padStart(2,'0')+'-'+String(date.getUTCDate()).padStart(2,'0');
}
function _todayStr() {
  return new Date().toISOString().split('T')[0];
}
function _fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}); }
  catch { return iso; }
}


// ═════════════════════════════════════════════════════════════════════════════
// L — ROUTE HANDLING
// ═════════════════════════════════════════════════════════════════════════════

document.addEventListener('drishti:viewchange', function(e) {
  const { view } = e.detail;
  if (view === 'analytics') renderAnalyticsView();
  if (view === 'reports')   renderReportsView();
});

document.addEventListener('drishti:appready', function() {
  const hash = window.location.hash.replace('#','');
  if (hash === 'analytics') renderAnalyticsView();
  if (hash === 'reports')   renderReportsView();
});
