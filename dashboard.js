/**
 * DRISHTI — Chief Secretary Executive Dashboard
 * File: dashboard.js
 *
 * Renders the complete CS Dashboard into #view-dashboard.
 * Consumed by index.html via:
 *   <script type="module" src="dashboard.js"></script>
 *
 * Dependencies (provided by index.html's module scope):
 *   window.api(action, payload)  — Apps Script fetch wrapper
 *   window.ui                    — toast(), confirm(), _esc()
 *   window.router                — navigate()
 *   window.store                 — { session, theme }
 * Chart.js is loaded from CDN dynamically on first dashboard render.
 *
 * SECTIONS:
 *   A — Constants & colour tokens
 *   B — Dashboard HTML scaffold injection
 *   C — KPI Cards (animated counters)
 *   D — Department Activity Table
 *   E — Recent Directions panel
 *   F — Charts (Chart.js: doughnut, bar, line)
 *   G — 90-Day Activity Heatmap
 *   H — Pinned Tasks & Executive Alerts
 *   I — AI Insights panel
 *   J — Floating Speed-Dial (Quick Actions)
 *   K — Full-Screen Global Search overlay
 *   L — Master init & view-change listener
 *
 * @version 6.0.0
 * @module  CS Dashboard
 */

'use strict';

// ═════════════════════════════════════════════════════════════════════════════
// A — CONSTANTS & COLOUR TOKENS
// ═════════════════════════════════════════════════════════════════════════════

const CHART_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';

/** DRISHTI palette for chart datasets — mirrors CSS custom properties */
const P = {
  primary:       '#1A3A5C',
  primaryLight:  '#2A5F9E',
  accent:        '#C9A84C',
  accentLight:   '#E2C97A',
  success:       '#2E7D32',
  successLight:  '#E8F5E9',
  warning:       '#F57F17',
  warningLight:  '#FFF8E1',
  danger:        '#B71C1C',
  dangerLight:   '#FFEBEE',
  teal:          '#00695C',
  purple:        '#4527A0',
  textMuted:     '#9BA8BE',
};

/** Status → display label */
const STATUS_LABEL = {
  PENDING:     'Pending',
  IN_PROGRESS: 'In Progress',
  REVIEW:      'Under Review',
  COMPLETED:   'Completed',
  OVERDUE:     'Overdue',
  DEFERRED:    'Deferred',
};

/** Performance label → colour */
const PERF_COLOURS = {
  'Leading the Charge': P.success,
  'Fast Movers':        P.teal,
  'Rising Momentum':    P.primaryLight,
  'Maintaining Course': P.accent,
  'Focus Required':     P.warning,
  'Needs Attention':    P.danger,
};

/** Module-level chart instances (for destroy-before-redraw) */
let _chartStatus    = null;
let _chartPriority  = null;
let _chartTrend     = null;

/** Debounce timer for global search */
let _searchTimer    = null;

/** Flag: Chart.js CDN load promise */
let _chartJsLoading = null;

/** Cached dashboard data (avoid redundant API calls on tab switch) */
let _dashCache      = null;
let _dashCacheTs    = 0;
const CACHE_TTL_MS  = 2 * 60 * 1000; // 2 minutes


// ═════════════════════════════════════════════════════════════════════════════
// B — DASHBOARD HTML SCAFFOLD
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Injects the complete dashboard scaffold into #view-dashboard.
 * Called once on first render; subsequent refreshes only update data.
 */
function injectDashboardScaffold() {
  const panel = document.getElementById('view-dashboard');
  if (!panel) return;

  panel.innerHTML = `
  <!-- ── Dashboard header ─────────────────────────────────────── -->
  <div class="db-header" id="db-header">
    <div>
      <h1 class="db-title">Executive Dashboard</h1>
      <p class="db-subtitle" id="db-greeting">Loading…</p>
    </div>
    <div class="db-header-actions">
      <button class="btn btn-secondary btn-sm" id="db-refresh-btn" aria-label="Refresh dashboard">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
        Refresh
      </button>
      <button class="btn btn-primary btn-sm" id="db-new-task-btn" aria-label="Create new task">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New Task
      </button>
    </div>
  </div>

  <!-- ── ROW 1: KPI Cards ──────────────────────────────────────── -->
  <section aria-label="Key performance indicators">
    <div class="db-kpi-grid" id="db-kpi-grid" role="list"></div>
  </section>

  <!-- ── ROW 2: Dept Table + Recent Directions ─────────────────── -->
  <section class="db-row2" aria-label="Department activity and directions">
    <div class="db-dept-panel card" id="db-dept-panel">
      <div class="card-header">
        <div class="card-title">Department Activity</div>
        <span class="db-panel-badge" id="db-dept-count">—</span>
      </div>
      <div class="db-dept-table-wrap" id="db-dept-table-wrap" aria-live="polite">
        <div class="db-skeleton-list">
          ${Array(6).fill('<div class="skeleton skeleton-text" style="margin-bottom:12px;"></div>').join('')}
        </div>
      </div>
    </div>

    <div class="db-directions-panel card" id="db-directions-panel">
      <div class="card-header">
        <div class="card-title">Recent Directions</div>
        <span class="badge badge-medium">CS / Admin</span>
      </div>
      <div id="db-directions-list" aria-live="polite">
        <div class="db-skeleton-list">
          ${Array(4).fill('<div class="skeleton skeleton-text" style="margin-bottom:12px;height:40px;"></div>').join('')}
        </div>
      </div>
    </div>
  </section>

  <!-- ── ROW 3: Charts ─────────────────────────────────────────── -->
  <section class="db-charts-row" aria-label="Statistical charts">
    <div class="card db-chart-card">
      <div class="card-header">
        <div class="card-title">Task Status</div>
      </div>
      <div class="db-chart-wrap" style="max-height:220px;">
        <canvas id="chart-status" role="img" aria-label="Task status distribution doughnut chart"></canvas>
      </div>
    </div>
    <div class="card db-chart-card">
      <div class="card-header">
        <div class="card-title">By Priority</div>
      </div>
      <div class="db-chart-wrap" style="max-height:220px;">
        <canvas id="chart-priority" role="img" aria-label="Tasks by priority bar chart"></canvas>
      </div>
    </div>
    <div class="card db-chart-card" style="flex:1.8;">
      <div class="card-header">
        <div class="card-title">Completion Trend (6 months)</div>
      </div>
      <div class="db-chart-wrap" style="max-height:220px;">
        <canvas id="chart-trend" role="img" aria-label="Monthly task completion trend line chart"></canvas>
      </div>
    </div>
  </section>

  <!-- ── ROW 4: Heatmap ────────────────────────────────────────── -->
  <section aria-label="90-day activity heatmap">
    <div class="card db-heatmap-card">
      <div class="card-header">
        <div class="card-title">90-Day Task Activity</div>
        <span class="db-heatmap-legend" aria-hidden="true">
          <span>Less</span>
          ${[0,1,2,3,4].map(l => `<span class="db-hm-swatch" data-level="${l}"></span>`).join('')}
          <span>More</span>
        </span>
      </div>
      <div id="db-heatmap" class="db-heatmap-grid" role="img" aria-label="90-day activity heatmap" aria-live="polite"></div>
    </div>
  </section>

  <!-- ── ROW 5: Pinned + Alerts ────────────────────────────────── -->
  <section class="db-row5" aria-label="Pinned tasks and executive alerts">
    <div class="card db-pinned-panel">
      <div class="card-header">
        <div class="card-title">📌 Pinned Tasks</div>
        <button class="btn btn-ghost btn-sm" id="db-view-all-pinned" aria-label="View all pinned tasks">View all</button>
      </div>
      <div id="db-pinned-list" aria-live="polite">
        <div class="empty-state" style="padding:var(--space-6);">
          <div class="empty-state-desc">No pinned tasks yet.</div>
        </div>
      </div>
    </div>

    <div class="card db-alerts-panel">
      <div class="card-header">
        <div class="card-title">⚠ Executive Alerts</div>
        <span class="badge badge-critical" id="db-alert-count" aria-live="polite">0</span>
      </div>
      <div id="db-alerts-list" aria-live="polite">
        <div class="empty-state" style="padding:var(--space-6);">
          <div class="empty-state-desc">No overdue tasks. All on track.</div>
        </div>
      </div>
    </div>
  </section>

  <!-- ── ROW 6: AI Insights ────────────────────────────────────── -->
  <section aria-label="AI insights panel">
    <div class="card db-ai-panel">
      <div class="card-header">
        <div class="card-title" style="display:flex;align-items:center;gap:8px;">
          <span style="color:var(--color-accent);font-size:1.1rem;">✦</span>
          AI Executive Insights
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-accent btn-sm" id="db-gen-brief-btn" aria-label="Generate today's AI brief">
            Generate Today's Brief
          </button>
        </div>
      </div>
      <div id="db-brief-content" class="db-brief-content" aria-live="polite">
        <div class="db-brief-placeholder">
          <span style="color:var(--color-text-muted);font-size:var(--font-sm);">
            Click <strong>Generate Today's Brief</strong> to receive an AI-compiled executive summary.
          </span>
        </div>
      </div>
      <div class="db-ai-quick">
        <input
          type="text"
          class="input"
          id="db-ai-query"
          placeholder="Ask AI about tasks, performance, or directives…"
          aria-label="AI query input"
        />
        <button class="btn btn-primary btn-sm" id="db-ai-ask-btn" aria-label="Submit AI query">
          Ask AI
        </button>
      </div>
    </div>
  </section>

  <!-- ── Heatmap tooltip (positioned by JS) ────────────────────── -->
  <div id="db-hm-tooltip" class="db-hm-tooltip" role="tooltip" aria-hidden="true"></div>
  `;

  // Wire up static button events
  _wireDashboardEvents();
}

/** Additional dashboard-specific CSS injected once */
function injectDashboardCSS() {
  if (document.getElementById('db-styles')) return;
  const style = document.createElement('style');
  style.id = 'db-styles';
  style.textContent = `
  /* ── Dashboard layout ─────────────────────────────────────────────── */
  .db-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: var(--space-6);
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .db-title {
    font-size: var(--font-xl);
    font-weight: 800;
    color: var(--color-text-primary);
    line-height: 1.2;
  }
  .db-subtitle {
    font-size: var(--font-sm);
    color: var(--color-text-secondary);
    margin-top: var(--space-1);
  }
  .db-header-actions { display: flex; gap: var(--space-3); flex-shrink: 0; }

  /* ── KPI Grid ─────────────────────────────────────────────────────── */
  .db-kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-4);
    margin-bottom: var(--space-6);
  }
  .db-kpi {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    box-shadow: var(--shadow-sm);
    position: relative;
    overflow: hidden;
    transition: transform var(--transition), box-shadow var(--transition);
    cursor: default;
  }
  .db-kpi:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
  .db-kpi::after {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    background: var(--kpi-clr, var(--color-primary));
    border-radius: 0;
  }
  .db-kpi-icon {
    width: 38px; height: 38px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--kpi-clr, var(--color-primary)) 12%, transparent);
    color: var(--kpi-clr, var(--color-primary));
    display: flex; align-items: center; justify-content: center;
    margin-bottom: var(--space-3);
  }
  .db-kpi-value {
    font-size: 2.2rem;
    font-weight: 800;
    color: var(--color-text-primary);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .db-kpi-label {
    font-size: var(--font-sm);
    color: var(--color-text-secondary);
    font-weight: 500;
    margin-top: 4px;
  }
  .db-kpi-trend {
    font-size: var(--font-xs);
    margin-top: var(--space-2);
    display: flex; align-items: center; gap: 3px;
    color: var(--color-text-muted);
  }

  /* ── Row 2 ────────────────────────────────────────────────────────── */
  .db-row2 {
    display: grid;
    grid-template-columns: 60% 1fr;
    gap: var(--space-5);
    margin-bottom: var(--space-6);
  }
  .db-panel-badge {
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-size: var(--font-xs);
    font-weight: 600;
    padding: 2px 10px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
  }
  .db-dept-table-wrap { overflow-x: auto; }
  .db-dept-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-sm);
  }
  .db-dept-table th {
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-weight: 600;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: var(--space-2) var(--space-3);
    text-align: left;
    white-space: nowrap;
    border-bottom: 1px solid var(--color-border);
  }
  .db-dept-table td {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border);
    vertical-align: middle;
  }
  .db-dept-table tr:last-child td { border-bottom: none; }
  .db-dept-table tbody tr {
    cursor: pointer;
    transition: background var(--transition);
  }
  .db-dept-table tbody tr:hover { background: var(--color-surface-2); }

  .db-perf-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    font-size: 0.68rem;
    font-weight: 700;
    white-space: nowrap;
    color: #fff;
  }

  /* Directions panel */
  .db-direction-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--transition);
    border-bottom: 1px solid var(--color-border);
  }
  .db-direction-item:last-child { border-bottom: none; }
  .db-direction-item:hover { background: var(--color-surface-2); }
  .db-direction-task { font-size: var(--font-xs); font-weight: 700; color: var(--color-primary-light); }
  .db-direction-text { font-size: var(--font-sm); color: var(--color-text-primary); line-height: 1.4; }
  .db-direction-meta { font-size: var(--font-xs); color: var(--color-text-muted); display: flex; gap: 8px; }

  /* ── Charts ───────────────────────────────────────────────────────── */
  .db-charts-row {
    display: flex;
    gap: var(--space-5);
    margin-bottom: var(--space-6);
    align-items: stretch;
  }
  .db-chart-card { flex: 1; min-width: 0; }
  .db-chart-wrap {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .db-chart-wrap canvas { max-width: 100%; }

  /* ── Heatmap ──────────────────────────────────────────────────────── */
  .db-heatmap-card { margin-bottom: var(--space-6); }
  .db-heatmap-legend {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--font-xs);
    color: var(--color-text-muted);
  }
  .db-hm-swatch {
    width: 12px; height: 12px;
    border-radius: 2px;
    display: inline-block;
  }
  .db-hm-swatch[data-level="0"] { background: var(--color-surface-2); }
  .db-hm-swatch[data-level="1"] { background: #A5D6A7; }
  .db-hm-swatch[data-level="2"] { background: #66BB6A; }
  .db-hm-swatch[data-level="3"] { background: #388E3C; }
  .db-hm-swatch[data-level="4"] { background: #1B5E20; }

  .db-heatmap-grid {
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
    padding: var(--space-2) 0;
    min-height: 100px;
  }
  .db-hm-week {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .db-hm-cell {
    width: 12px; height: 12px;
    border-radius: 2px;
    cursor: pointer;
    transition: transform 0.15s ease, opacity 0.15s ease;
    animation: hm-appear 0.3s ease backwards;
  }
  .db-hm-cell:hover { transform: scale(1.4); opacity: 0.9; }
  @keyframes hm-appear { from { opacity: 0; transform: scale(0); } to { opacity: 1; transform: scale(1); } }

  .db-hm-tooltip {
    position: fixed;
    background: var(--color-primary-dark);
    color: #fff;
    font-size: 0.7rem;
    padding: 4px 10px;
    border-radius: var(--radius-xs);
    pointer-events: none;
    white-space: nowrap;
    z-index: 8000;
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .db-hm-tooltip.visible { opacity: 1; }

  /* ── Row 5 ────────────────────────────────────────────────────────── */
  .db-row5 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-5);
    margin-bottom: var(--space-6);
  }

  /* Pinned task row */
  .db-pinned-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--color-border);
  }
  .db-pinned-row:last-child { border-bottom: none; }
  .db-pinned-info { flex: 1; min-width: 0; }
  .db-pinned-subject { font-size: var(--font-sm); font-weight: 600; color: var(--color-text-primary); }
  .db-pinned-meta { font-size: var(--font-xs); color: var(--color-text-muted); margin-top: 2px; }

  /* Alert row */
  .db-alert-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--color-border);
  }
  .db-alert-row:last-child { border-bottom: none; }
  .db-alert-info { flex: 1; min-width: 0; }
  .db-alert-subject { font-size: var(--font-sm); font-weight: 600; color: var(--color-danger); }
  .db-alert-meta { font-size: var(--font-xs); color: var(--color-text-muted); margin-top: 2px; }
  .db-overdue-days { color: var(--color-danger); font-weight: 700; }

  /* ── AI Panel ─────────────────────────────────────────────────────── */
  .db-ai-panel { margin-bottom: var(--space-6); }
  .db-brief-content {
    min-height: 80px;
    margin-bottom: var(--space-4);
    font-size: var(--font-sm);
    color: var(--color-text-primary);
    line-height: 1.7;
    border-left: 3px solid var(--color-accent);
    padding-left: var(--space-4);
    white-space: pre-wrap;
  }
  .db-brief-placeholder { color: var(--color-text-muted); font-style: italic; }
  .db-ai-quick { display: flex; gap: var(--space-3); margin-top: var(--space-4); }
  .db-ai-quick .input { flex: 1; }
  .db-ai-response {
    margin-top: var(--space-4);
    padding: var(--space-4);
    background: var(--color-surface-2);
    border-radius: var(--radius-sm);
    font-size: var(--font-sm);
    line-height: 1.7;
    white-space: pre-wrap;
    border-left: 3px solid var(--color-primary-light);
  }

  /* ── Skeleton list ────────────────────────────────────────────────── */
  .db-skeleton-list { padding: var(--space-2) 0; }

  /* ── Speed Dial ───────────────────────────────────────────────────── */
  #db-speed-dial {
    position: fixed;
    bottom: var(--space-8);
    right: var(--space-8);
    z-index: 7000;
    display: flex;
    flex-direction: column-reverse;
    align-items: flex-end;
    gap: var(--space-3);
  }
  .db-fab {
    width: 52px; height: 52px;
    background: var(--color-primary);
    color: #fff;
    border: none;
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-lg);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.4rem;
    transition: transform var(--transition-spring), background var(--transition);
    position: relative;
  }
  .db-fab.main-fab {
    background: var(--color-accent);
    color: var(--color-primary-dark);
    width: 56px; height: 56px;
    font-size: 1.5rem;
  }
  .db-fab.main-fab.open { transform: rotate(45deg); }
  .db-fab:hover { transform: scale(1.08); }
  .db-fab.main-fab.open:hover { transform: rotate(45deg) scale(1.08); }
  .db-fab-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    opacity: 0;
    transform: translateY(12px) scale(0.9);
    pointer-events: none;
    transition: opacity var(--transition), transform var(--transition-spring);
  }
  .db-fab-item.visible {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }
  .db-fab-label {
    background: var(--color-primary-dark);
    color: #fff;
    font-size: var(--font-xs);
    font-weight: 600;
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    white-space: nowrap;
    box-shadow: var(--shadow-sm);
  }

  /* ── Global Search Overlay ────────────────────────────────────────── */
  #db-search-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 9500;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 80px;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.2s ease, visibility 0.2s ease;
  }
  #db-search-overlay.open {
    opacity: 1;
    visibility: visible;
  }
  .db-search-box {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-xl);
    width: 100%;
    max-width: 640px;
    overflow: hidden;
    transform: translateY(-20px) scale(0.97);
    transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1);
  }
  #db-search-overlay.open .db-search-box {
    transform: translateY(0) scale(1);
  }
  .db-search-input-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--color-border);
  }
  #db-search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: var(--font-lg);
    color: var(--color-text-primary);
    font-family: inherit;
  }
  #db-search-input::placeholder { color: var(--color-text-muted); }
  .db-search-kbd {
    font-size: var(--font-xs);
    color: var(--color-text-muted);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xs);
    padding: 2px 6px;
  }
  .db-search-results {
    max-height: 400px;
    overflow-y: auto;
    padding: var(--space-2) 0;
  }
  .db-search-group-label {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
    padding: var(--space-3) var(--space-5) var(--space-2);
  }
  .db-search-result {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-5);
    cursor: pointer;
    transition: background var(--transition);
    outline: none;
  }
  .db-search-result:hover,
  .db-search-result.focused { background: var(--color-surface-2); }
  .db-search-result-icon {
    width: 32px; height: 32px;
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    color: var(--color-text-secondary);
  }
  .db-search-result-main { flex: 1; min-width: 0; }
  .db-search-result-title { font-size: var(--font-sm); font-weight: 600; color: var(--color-text-primary); }
  .db-search-result-sub   { font-size: var(--font-xs); color: var(--color-text-muted); }
  .db-search-empty {
    text-align: center;
    padding: var(--space-8);
    color: var(--color-text-muted);
    font-size: var(--font-sm);
  }
  .db-search-footer {
    display: flex;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-5);
    border-top: 1px solid var(--color-border);
    background: var(--color-surface-2);
    font-size: var(--font-xs);
    color: var(--color-text-muted);
  }
  .db-search-footer kbd {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    padding: 1px 5px;
    font-family: inherit;
  }

  /* ── Responsive ───────────────────────────────────────────────────── */
  @media (max-width: 1280px) {
    .db-kpi-grid { grid-template-columns: repeat(4, 1fr); }
  }
  @media (max-width: 1024px) {
    .db-kpi-grid { grid-template-columns: repeat(4, 1fr); }
    .db-row2     { grid-template-columns: 1fr; }
    .db-charts-row { flex-direction: column; }
    .db-row5     { grid-template-columns: 1fr; }
  }
  @media (max-width: 768px) {
    .db-kpi-grid { grid-template-columns: repeat(2, 1fr); }
    #db-speed-dial { bottom: var(--space-5); right: var(--space-5); }
    .db-search-box { max-width: calc(100vw - 32px); }
  }
  @media (max-width: 480px) {
    .db-kpi-grid { grid-template-columns: 1fr 1fr; }
  }
  `;
  document.head.appendChild(style);
}


// ═════════════════════════════════════════════════════════════════════════════
// C — KPI CARDS WITH ANIMATED COUNTERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Renders 8 KPI cards from dashboard stats and animates the numbers.
 * @param {Object} stats - getDashboardStats response.
 */
function renderKPICards(stats) {
  const defs = [
    { key: 'totalTasks',   label: 'Total Tasks',    icon: 'layers',   clr: P.primary,      trend: null },
    { key: 'pending',      label: 'Pending',         icon: 'clock',    clr: P.warning,      trend: null },
    { key: 'inProgress',   label: 'In Progress',     icon: 'activity', clr: P.primaryLight, trend: null },
    { key: 'completed',    label: 'Completed',       icon: 'check',    clr: P.success,      trend: null },
    { key: 'critical',     label: 'Critical',        icon: 'zap',      clr: P.danger,       trend: 'danger' },
    { key: 'overdue',      label: 'Overdue',         icon: 'alert',    clr: '#c62828',      trend: 'danger' },
    { key: 'dueToday',     label: 'Due Today',       icon: 'calendar', clr: P.accent,       trend: 'warn' },
    { key: 'dueThisWeek',  label: 'Due This Week',   icon: 'week',     clr: P.teal,         trend: null },
  ];

  const grid = document.getElementById('db-kpi-grid');
  if (!grid) return;

  grid.innerHTML = defs.map((d, i) => {
    const val = Number(stats[d.key] || 0);
    const trendHTML = d.trend === 'danger' && val > 0
      ? `<span style="color:${P.danger};">↑ Requires attention</span>`
      : d.trend === 'warn' && val > 0
        ? `<span style="color:${P.warning};">⏰ Action needed</span>`
        : `<span>Up to date</span>`;
    return `
    <div class="db-kpi" style="--kpi-clr:${d.clr};" role="listitem" aria-label="${d.label}: ${val}">
      <div class="db-kpi-icon" aria-hidden="true">${_kpiSVG(d.icon)}</div>
      <div class="db-kpi-value" id="kpi-val-${i}" data-target="${val}" aria-live="polite">0</div>
      <div class="db-kpi-label">${d.label}</div>
      <div class="db-kpi-trend">${trendHTML}</div>
    </div>`;
  }).join('');

  // Animate counters with easing
  grid.querySelectorAll('.db-kpi-value').forEach(el => {
    const target = parseInt(el.dataset.target, 10) || 0;
    _animateCounter(el, 0, target, 1000);
  });
}

/**
 * Smoothly animates a number from `from` to `to` over `duration` ms.
 * Uses requestAnimationFrame with ease-out cubic.
 * @param {HTMLElement} el
 * @param {number} from
 * @param {number} to
 * @param {number} duration
 */
function _animateCounter(el, from, to, duration) {
  if (to === 0) { el.textContent = '0'; return; }
  const start = performance.now();
  const range = to - from;

  function tick(now) {
    const elapsed = Math.min(now - start, duration);
    const t       = elapsed / duration;
    // Ease-out cubic: 1 - (1-t)^3
    const eased   = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + range * eased).toLocaleString();
    if (elapsed < duration) requestAnimationFrame(tick);
    else el.textContent = to.toLocaleString();
  }

  requestAnimationFrame(tick);
}


// ═════════════════════════════════════════════════════════════════════════════
// D — DEPARTMENT ACTIVITY TABLE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Renders the department activity table with performance badges.
 * @param {Object[]} depts - getDepartmentPerformance response.
 */
function renderDeptTable(depts) {
  const wrap  = document.getElementById('db-dept-table-wrap');
  const count = document.getElementById('db-dept-count');
  if (!wrap) return;

  if (!depts || !depts.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:var(--space-6);"><div class="empty-state-desc">No department data available.</div></div>';
    return;
  }

  if (count) count.textContent = depts.length + ' depts';

  wrap.innerHTML = `
  <table class="db-dept-table" aria-label="Department performance table">
    <thead>
      <tr>
        <th scope="col">Department</th>
        <th scope="col" style="text-align:right;">Total</th>
        <th scope="col" style="text-align:right;">Done</th>
        <th scope="col" style="text-align:right;">Pending</th>
        <th scope="col" style="text-align:right;">Overdue</th>
        <th scope="col">Rate</th>
        <th scope="col">Status</th>
      </tr>
    </thead>
    <tbody>
      ${depts.map(d => {
        const colour = PERF_COLOURS[d.performanceLabel] || P.textMuted;
        const barPct = Math.min(d.completionRate, 100);
        return `
        <tr
          role="button"
          tabindex="0"
          aria-label="View tasks for ${_esc(d.deptName)}"
          onclick="window.router && window.router.navigate('tasks', { deptCode: '${d.deptCode}' })"
          onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}"
        >
          <td>
            <div style="font-weight:600;font-size:var(--font-sm);">${_esc(d.deptShortName || d.deptCode)}</div>
            <div style="font-size:var(--font-xs);color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;">${_esc(d.deptName)}</div>
          </td>
          <td style="text-align:right;font-weight:700;">${d.total}</td>
          <td style="text-align:right;color:${P.success};font-weight:600;">${d.completedCount}</td>
          <td style="text-align:right;color:${P.warning};">${d.total - d.completedCount - d.overdueCount}</td>
          <td style="text-align:right;color:${P.danger};font-weight:600;">${d.overdueCount}</td>
          <td style="min-width:80px;">
            <div class="progress-bar" style="margin-bottom:3px;">
              <div class="progress-fill" style="width:${barPct}%;background:${colour};" aria-label="${d.completionRate}%"></div>
            </div>
            <div style="font-size:0.68rem;color:var(--color-text-muted);">${d.completionRate}%</div>
          </td>
          <td>
            <span class="db-perf-badge" style="background:${colour};" aria-label="${d.performanceLabel}">
              ${_esc(d.performanceLabel)}
            </span>
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}


// ═════════════════════════════════════════════════════════════════════════════
// E — RECENT DIRECTIONS PANEL
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Renders the last 10 Direction/Immediate Attention comments.
 * @param {Object[]} comments - Recent comments from activity or a dedicated fetch.
 * @param {Object[]} tasks    - Task list for cross-referencing subject.
 */
function renderRecentDirections(comments, tasks) {
  const el = document.getElementById('db-directions-list');
  if (!el) return;

  const directions = (comments || [])
    .filter(c => c.Category === 'Direction' || c.Category === 'Immediate Attention')
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    .slice(0, 10);

  if (!directions.length) {
    el.innerHTML = '<div class="empty-state" style="padding:var(--space-6);"><div class="empty-state-desc">No recent directions issued.</div></div>';
    return;
  }

  const taskMap = {};
  (tasks || []).forEach(t => { taskMap[t.TaskID] = t; });

  el.innerHTML = directions.map(c => {
    const task       = taskMap[c.TaskID];
    const subject    = task ? task.Subject : c.TaskID;
    const status     = task ? task.Status  : '';
    const preview    = (c.Content || '').length > 100 ? c.Content.substring(0, 100) + '…' : c.Content;
    const statusCls  = 'status-' + (status || 'pending').toLowerCase();
    const catColour  = c.Category === 'Immediate Attention' ? P.danger : P.primaryLight;
    return `
    <div
      class="db-direction-item"
      role="button"
      tabindex="0"
      aria-label="View direction on task ${c.TaskID}"
      onclick="window.router && window.router.navigate('task-detail', { taskID: '${c.TaskID}' })"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}"
    >
      <div class="db-direction-task">
        <span style="font-size:0.65rem;padding:1px 6px;background:color-mix(in srgb,${catColour} 15%,transparent);color:${catColour};border-radius:99px;font-weight:700;margin-right:4px;">${_esc(c.Category)}</span>
        ${_esc(subject.length > 50 ? subject.substring(0,50)+'…' : subject)}
      </div>
      <div class="db-direction-text">${_esc(preview)}</div>
      <div class="db-direction-meta">
        <span>${_fmtDate(c.Timestamp)}</span>
        <span>${_esc(c.AuthorName || '')}</span>
        ${status ? `<span class="status-pill ${statusCls}" style="padding:1px 6px;font-size:0.62rem;">${STATUS_LABEL[status] || status}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}


// ═════════════════════════════════════════════════════════════════════════════
// F — CHART.JS CHARTS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Lazily loads Chart.js from CDN, returns the Chart constructor.
 * @returns {Promise<typeof Chart>}
 */
function _loadChartJS() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (_chartJsLoading) return _chartJsLoading;

  _chartJsLoading = new Promise((resolve, reject) => {
    const s         = document.createElement('script');
    s.src           = CHART_CDN;
    s.async         = true;
    s.onload        = () => resolve(window.Chart);
    s.onerror       = () => reject(new Error('Failed to load Chart.js from CDN.'));
    document.head.appendChild(s);
  });

  return _chartJsLoading;
}

/**
 * Builds all three Chart.js charts from dashboard stats.
 * @param {Object} stats - getDashboardStats response.
 */
async function renderCharts(stats) {
  let Chart;
  try { Chart = await _loadChartJS(); }
  catch (err) {
    console.error('[DRISHTI] Chart.js load error:', err);
    window.ui?.toast('Charts', 'Could not load charting library. Check internet connection.', 'warning');
    return;
  }

  // Destroy previous instances to avoid canvas re-use error
  [_chartStatus, _chartPriority, _chartTrend].forEach(c => { if (c) c.destroy(); });

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridClr = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
  const textClr = isDark ? '#8B95B0' : '#6B7A99';

  Chart.defaults.font.family  = "'Inter', sans-serif";
  Chart.defaults.font.size    = 11;
  Chart.defaults.color        = textClr;

  // ── Doughnut: Task Status ────────────────────────────────────────────
  const statusCtx = document.getElementById('chart-status');
  if (statusCtx) {
    _chartStatus = new Chart(statusCtx, {
      type: 'doughnut',
      data: {
        labels: ['Pending', 'In Progress', 'Completed', 'Overdue', 'Deferred'],
        datasets: [{
          data: [
            stats.pending    || 0,
            stats.inProgress || 0,
            stats.completed  || 0,
            stats.overdue    || 0,
            stats.deferred   || 0
          ],
          backgroundColor: [P.warning, P.primaryLight, P.success, P.danger, P.textMuted],
          borderColor:     isDark ? '#1A1D27' : '#fff',
          borderWidth:     3,
          hoverOffset:     6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 900, easing: 'easeOutQuart' },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { padding: 14, boxWidth: 12, boxHeight: 12, usePointStyle: true },
          },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${ctx.parsed} tasks`
            }
          }
        },
        cutout: '68%',
      }
    });
  }

  // ── Bar: Tasks by Priority ───────────────────────────────────────────
  const prioCtx = document.getElementById('chart-priority');
  if (prioCtx) {
    const bp = stats.byPriority || {};
    _chartPriority = new Chart(prioCtx, {
      type: 'bar',
      data: {
        labels: ['Critical', 'High', 'Medium', 'Low'],
        datasets: [{
          label: 'Tasks',
          data: [bp.critical || 0, bp.high || 0, bp.medium || 0, bp.low || 0],
          backgroundColor: [
            P.danger + 'CC',
            P.warning + 'CC',
            P.primaryLight + 'CC',
            P.success + 'CC',
          ],
          borderColor: [P.danger, P.warning, P.primaryLight, P.success],
          borderWidth: 2,
          borderRadius: 6,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 900, easing: 'easeOutQuart', delay: ctx => ctx.dataIndex * 80 },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: gridClr }, ticks: { color: textClr } },
          y: {
            grid: { color: gridClr },
            ticks: { color: textClr, stepSize: 1, precision: 0 },
            beginAtZero: true,
          }
        }
      }
    });
  }

  // ── Line: Monthly Completion Trend ───────────────────────────────────
  const trendCtx = document.getElementById('chart-trend');
  if (trendCtx && stats.completionTrend?.length) {
    const labels    = stats.completionTrend.map(m => m.month);
    const completed = stats.completionTrend.map(m => m.completed);
    const created   = stats.completionTrend.map(m => m.created);

    _chartTrend = new Chart(trendCtx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label:           'Completed',
            data:            completed,
            borderColor:     P.success,
            backgroundColor: P.success + '22',
            borderWidth:     2.5,
            pointRadius:     4,
            pointHoverRadius:7,
            pointBackgroundColor: P.success,
            tension:         0.4,
            fill:            true,
          },
          {
            label:           'Created',
            data:            created,
            borderColor:     P.primaryLight,
            backgroundColor: P.primaryLight + '11',
            borderWidth:     2,
            pointRadius:     3,
            pointHoverRadius:6,
            pointBackgroundColor: P.primaryLight,
            tension:         0.4,
            fill:            false,
            borderDash:      [5, 3],
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 1000, easing: 'easeOutQuart' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 12, padding: 16, usePointStyle: true },
          },
          tooltip: {
            backgroundColor: isDark ? '#1A1D27' : '#fff',
            titleColor:      isDark ? '#E8ECF4' : '#1A2233',
            bodyColor:       textClr,
            borderColor:     isDark ? '#2E3347' : '#E0E4EC',
            borderWidth:     1,
            padding:         10,
          }
        },
        scales: {
          x: { grid: { color: gridClr }, ticks: { color: textClr } },
          y: {
            grid: { color: gridClr },
            ticks: { color: textClr, stepSize: 1, precision: 0 },
            beginAtZero: true,
          }
        }
      }
    });
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// G — 90-DAY ACTIVITY HEATMAP
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Renders the GitHub-style heatmap grid from date-keyed count data.
 * @param {Object.<string, number>} heatmapData - { 'YYYY-MM-DD': count }
 */
function renderHeatmap(heatmapData) {
  const container = document.getElementById('db-heatmap');
  const tooltip   = document.getElementById('db-hm-tooltip');
  if (!container || !tooltip) return;

  const data    = heatmapData || {};
  const dates   = Object.keys(data).sort();
  const counts  = Object.values(data);
  const maxVal  = Math.max(...counts, 1);

  /**
   * Maps a count to a heat level 0–4.
   * @param {number} n
   * @returns {number}
   */
  function level(n) {
    if (n === 0) return 0;
    if (n <= Math.ceil(maxVal * 0.25)) return 1;
    if (n <= Math.ceil(maxVal * 0.50)) return 2;
    if (n <= Math.ceil(maxVal * 0.75)) return 3;
    return 4;
  }

  const HEAT_COLOURS = ['#E8EBF0', '#A5D6A7', '#66BB6A', '#388E3C', '#1B5E20'];
  const HEAT_DARK    = ['#2A2F45', '#1B4332', '#2D6A4F', '#40916C', '#74C69D'];

  // Group dates into weeks (columns of 7 cells)
  const weeks = [];
  let week    = [];
  dates.forEach((date, i) => {
    week.push(date);
    if (week.length === 7 || i === dates.length - 1) {
      weeks.push(week);
      week = [];
    }
  });

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const colours = isDark ? HEAT_DARK : HEAT_COLOURS;

  container.innerHTML = '';

  weeks.forEach((wk, wi) => {
    const col = document.createElement('div');
    col.className = 'db-hm-week';

    wk.forEach((date, di) => {
      const count = data[date] || 0;
      const lvl   = level(count);
      const cell  = document.createElement('div');
      cell.className           = 'db-hm-cell';
      cell.style.background    = colours[lvl];
      cell.style.animationDelay = `${(wi * 7 + di) * 4}ms`;
      cell.setAttribute('aria-label', `${date}: ${count} tasks`);
      cell.setAttribute('tabindex', '0');
      cell.setAttribute('role', 'gridcell');

      // Tooltip on hover / focus
      const showTip = (e) => {
        const d    = new Date(date + 'T00:00:00');
        const nice = d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
        tooltip.textContent = `${count} task${count !== 1 ? 's' : ''} on ${nice}`;
        tooltip.classList.add('visible');
        tooltip.setAttribute('aria-hidden', 'false');
        const r = cell.getBoundingClientRect();
        tooltip.style.left = (r.left + r.width / 2 - tooltip.offsetWidth / 2) + 'px';
        tooltip.style.top  = (r.top - 32 + window.scrollY) + 'px';
      };
      const hideTip = () => {
        tooltip.classList.remove('visible');
        tooltip.setAttribute('aria-hidden', 'true');
      };

      cell.addEventListener('mouseenter', showTip);
      cell.addEventListener('mouseleave', hideTip);
      cell.addEventListener('focus',      showTip);
      cell.addEventListener('blur',       hideTip);
      cell.addEventListener('click', () => {
        // Navigate to tasks filtered by this date
        if (window.router) {
          window.router.navigate('tasks');
          // Signal tasks view to filter by date (handled in tasks view)
          document.dispatchEvent(new CustomEvent('drishti:filterbydate', { detail: { date } }));
        }
      });

      col.appendChild(cell);
    });

    container.appendChild(col);
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// H — PINNED TASKS & EXECUTIVE ALERTS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Renders pinned tasks with quick status update buttons.
 * @param {Object[]} pinned - Tasks where IsPinned === 'TRUE'.
 */
function renderPinnedTasks(pinned) {
  const el = document.getElementById('db-pinned-list');
  if (!el) return;

  if (!pinned?.length) return; // Keep empty state

  el.innerHTML = pinned.slice(0, 5).map(t => `
  <div class="db-pinned-row" role="listitem">
    <div class="db-pinned-info" style="min-width:0;">
      <div class="db-pinned-subject truncate">${_esc(t.Subject)}</div>
      <div class="db-pinned-meta">${t.TaskID} · ${t.PrimaryDept} · Due ${_fmtDate(t.DueDate)}</div>
      <div class="progress-bar" style="margin-top:4px;height:4px;">
        <div class="progress-fill" style="width:${t.ProgressPercent||0}%;"></div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;flex-shrink:0;">
      <span class="status-pill status-${(t.Status||'pending').toLowerCase()}" style="font-size:0.65rem;">${STATUS_LABEL[t.Status]||t.Status}</span>
      <button
        class="btn btn-ghost btn-sm"
        style="font-size:0.68rem;padding:2px 8px;"
        aria-label="Open task ${t.TaskID}"
        onclick="window.router && window.router.navigate('task-detail', { taskID: '${t.TaskID}' })"
      >View →</button>
    </div>
  </div>`).join('');
}

/**
 * Renders overdue tasks sorted by priority as executive alerts
 * with a one-click "Send Reminder" action.
 * @param {Object[]} overdue   - Overdue task list from dashboard stats.
 * @param {Object}   deptCache - DeptCode → DeptName lookup (optional).
 */
function renderExecutiveAlerts(overdue, deptCache) {
  const el    = document.getElementById('db-alerts-list');
  const count = document.getElementById('db-alert-count');
  if (!el) return;

  if (count) {
    count.textContent = overdue?.length || 0;
    count.className   = `badge ${(overdue?.length > 0) ? 'badge-critical' : 'badge-low'}`;
  }

  if (!overdue?.length) return; // Keep empty state

  const PRIO_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const sorted     = [...overdue].sort((a,b) => (PRIO_ORDER[a.Priority]||9) - (PRIO_ORDER[b.Priority]||9));

  const today = new Date();

  el.innerHTML = sorted.slice(0, 8).map(t => {
    const daysOver = t.DueDate
      ? Math.max(0, Math.floor((today - new Date(t.DueDate)) / 86400000))
      : '?';
    const deptName = (deptCache || {})[t.PrimaryDept] || t.PrimaryDept;
    return `
    <div class="db-alert-row" role="listitem">
      <div class="db-alert-info" style="min-width:0;">
        <div class="db-alert-subject truncate">${_esc(t.Subject)}</div>
        <div class="db-alert-meta">
          ${t.TaskID} · ${_esc(deptName)} ·
          <span class="db-overdue-days">${daysOver}d overdue</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;flex-shrink:0;">
        <span class="badge badge-${(t.Priority||'low').toLowerCase()}" style="font-size:0.65rem;">${t.Priority}</span>
        <button
          class="btn btn-ghost btn-sm"
          style="font-size:0.68rem;padding:2px 8px;color:var(--color-danger);"
          aria-label="Send reminder for task ${t.TaskID}"
          onclick="_sendReminder('${t.TaskID}', '${_esc(t.Subject)}')"
        >Send Reminder</button>
      </div>
    </div>`;
  }).join('');
}

/**
 * Sends an escalation reminder comment on the task.
 * Global so onclick can call it.
 * @param {string} taskID
 * @param {string} subject
 */
window._sendReminder = async function(taskID, subject) {
  const confirmed = await window.ui?.confirm(
    'Send Reminder',
    `Post an "Immediate Attention" reminder on task "${subject}"?`,
    'Send Reminder'
  );
  if (!confirmed) return;

  try {
    await window.api('addComment', {
      taskID,
      content:  'This task is overdue. Immediate attention and status update required.',
      category: 'Immediate Attention',
    });
    window.ui?.toast('Reminder Sent', 'Immediate Attention posted on ' + taskID, 'success');
  } catch (err) {
    window.ui?.toast('Error', err.message, 'error');
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// I — AI INSIGHTS PANEL
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Wires the AI panel buttons and renders a cached brief if available.
 * @param {Object} settings - Settings rows array (may contain LAST_DAILY_BRIEF).
 */
function initAIPanel(settings) {
  const brief = (settings || []).find(s => s.Key === 'LAST_DAILY_BRIEF');
  if (brief?.Value) {
    _renderBrief(brief.Value);
  }

  document.getElementById('db-gen-brief-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('db-gen-brief-btn');
    if (btn) { btn.disabled = true; btn.textContent = '✦ Generating…'; }

    try {
      const result = await window.api('generateDailyBrief', {});
      if (result?.brief) _renderBrief(result.brief);
      window.ui?.toast('Brief Ready', result?.cached ? 'Served from cache.' : 'AI brief generated.', 'success');
    } catch (err) {
      window.ui?.toast('AI Error', err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Generate Today\'s Brief'; }
    }
  });

  document.getElementById('db-ai-ask-btn')?.addEventListener('click', _submitAIQuery);
  document.getElementById('db-ai-query')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') _submitAIQuery();
  });
}

/** Renders the daily brief text into the content pane. */
function _renderBrief(text) {
  const el = document.getElementById('db-brief-content');
  if (!el) return;
  // Show first ~600 chars / 3 paragraphs
  const paras = text.split('\n').filter(p => p.trim()).slice(0, 6).join('\n');
  el.innerHTML = `<div style="white-space:pre-wrap;font-size:var(--font-sm);line-height:1.75;color:var(--color-text-primary);">${_esc(paras)}</div>`;
}

/** Submits an ad-hoc AI query from the dashboard quick box. */
async function _submitAIQuery() {
  const input  = document.getElementById('db-ai-query');
  const btn    = document.getElementById('db-ai-ask-btn');
  const query  = input?.value.trim();
  if (!query) return;

  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  // Remove any previous response
  document.getElementById('db-ai-response')?.remove();

  try {
    const result = await window.api('aiQuery', { query, context: 'tasks' });
    const div    = document.createElement('div');
    div.id        = 'db-ai-response';
    div.className = 'db-ai-response';
    div.setAttribute('aria-live', 'polite');
    div.textContent = result?.answer || 'No response received.';
    document.querySelector('.db-ai-panel')?.appendChild(div);
    if (input) input.value = '';
  } catch (err) {
    window.ui?.toast('AI Error', err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Ask AI'; }
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// J — FLOATING SPEED DIAL
// ═════════════════════════════════════════════════════════════════════════════

/** Injects the floating speed-dial into the document body (once). */
function injectSpeedDial() {
  if (document.getElementById('db-speed-dial')) return;

  const items = [
    { label: 'New Task',       icon: '＋', action: () => { if (typeof window.openCreateTaskModal === 'function') window.openCreateTaskModal(); else window.ui?.toast('Access Denied', 'Task creation requires Super Admin or Chief Secretary role.', 'warning'); } },
    { label: 'Generate Report',icon: '📄', action: () => window.router?.navigate('reports') },
    { label: 'AI Brief',       icon: '✦',  action: () => { document.getElementById('db-gen-brief-btn')?.click(); } },
    { label: 'Review Mode',    icon: '🔍', action: () => window.router?.navigate('review') },
  ];

  const dial = document.createElement('div');
  dial.id    = 'db-speed-dial';
  dial.setAttribute('role', 'group');
  dial.setAttribute('aria-label', 'Quick actions');

  // Item buttons (rendered top-to-bottom, but CSS is column-reverse so they appear above FAB)
  dial.innerHTML = items.map((item, i) => `
    <div class="db-fab-item" id="db-fab-item-${i}" role="listitem">
      <span class="db-fab-label">${_esc(item.label)}</span>
      <button
        class="db-fab"
        style="width:42px;height:42px;font-size:1rem;"
        aria-label="${_esc(item.label)}"
        data-fab-idx="${i}"
      >${item.icon}</button>
    </div>
  `).join('') + `
    <button class="db-fab main-fab" id="db-fab-main" aria-label="Quick actions" aria-expanded="false" aria-haspopup="true">＋</button>
  `;

  document.body.appendChild(dial);

  let open = false;
  const mainBtn = dial.querySelector('#db-fab-main');

  mainBtn.addEventListener('click', () => {
    open = !open;
    mainBtn.classList.toggle('open', open);
    mainBtn.setAttribute('aria-expanded', open);
    dial.querySelectorAll('.db-fab-item').forEach((el, i) => {
      setTimeout(() => el.classList.toggle('visible', open), open ? i * 60 : (items.length - 1 - i) * 40);
    });
  });

  // Wire item buttons
  dial.querySelectorAll('[data-fab-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.fabIdx, 10);
      if (items[idx]) items[idx].action();
      // Close dial
      open = false;
      mainBtn.classList.remove('open');
      mainBtn.setAttribute('aria-expanded', 'false');
      dial.querySelectorAll('.db-fab-item').forEach(el => el.classList.remove('visible'));
    });
  });

  // Close dial on outside click
  document.addEventListener('click', e => {
    if (open && !dial.contains(e.target)) {
      open = false;
      mainBtn.classList.remove('open');
      mainBtn.setAttribute('aria-expanded', 'false');
      dial.querySelectorAll('.db-fab-item').forEach(el => el.classList.remove('visible'));
    }
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// K — FULL-SCREEN GLOBAL SEARCH OVERLAY
// ═════════════════════════════════════════════════════════════════════════════

/** Injects the full-screen search overlay (once). */
function injectSearchOverlay() {
  if (document.getElementById('db-search-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id    = 'db-search-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Search DRISHTI');

  overlay.innerHTML = `
  <div class="db-search-box" role="document">
    <div class="db-search-input-row">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <input
        type="search"
        id="db-search-input"
        placeholder="Search tasks, task IDs, officers, file numbers…"
        autocomplete="off"
        aria-label="Global search"
        aria-autocomplete="list"
        aria-controls="db-search-results"
      />
      <kbd class="db-search-kbd">Esc</kbd>
    </div>
    <div class="db-search-results" id="db-search-results" role="listbox" aria-label="Search results" aria-live="polite">
      <div class="db-search-empty">Type at least 2 characters to search…</div>
    </div>
    <div class="db-search-footer">
      <span><kbd>↑↓</kbd> Navigate</span>
      <span><kbd>↵</kbd> Open</span>
      <span><kbd>Esc</kbd> Close</span>
    </div>
  </div>`;

  document.body.appendChild(overlay);

  const input   = overlay.querySelector('#db-search-input');
  const results = overlay.querySelector('#db-search-results');
  let   focusedIdx = -1;
  let   resultItems = [];

  /** Opens the search overlay. */
  function openSearch() {
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    setTimeout(() => input.focus(), 80);
    focusedIdx = -1;
  }

  /** Closes the search overlay. */
  function closeSearch() {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    input.value = '';
    results.innerHTML = '<div class="db-search-empty">Type at least 2 characters to search…</div>';
    focusedIdx   = -1;
    resultItems  = [];
  }

  // Keyboard shortcut Ctrl+K / Cmd+K
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      overlay.classList.contains('open') ? closeSearch() : openSearch();
    }
    if (e.key === 'Escape' && overlay.classList.contains('open')) {
      e.stopPropagation();
      closeSearch();
    }
  });

  // Close on backdrop click
  overlay.addEventListener('click', e => { if (e.target === overlay) closeSearch(); });

  // Also wire the existing topbar search input to open this overlay
  const topbarSearch = document.getElementById('global-search');
  if (topbarSearch) {
    topbarSearch.addEventListener('focus', () => { openSearch(); topbarSearch.blur(); });
  }

  // ── Search input handler ──────────────────────────────────────────────
  input.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    const term = input.value.trim();
    if (term.length < 2) {
      results.innerHTML = '<div class="db-search-empty">Type at least 2 characters to search…</div>';
      return;
    }
    results.innerHTML = '<div class="db-search-empty" aria-live="polite">Searching…</div>';
    _searchTimer = setTimeout(() => _executeSearch(term, results), 300);
  });

  // ── Keyboard navigation within results ───────────────────────────────
  input.addEventListener('keydown', e => {
    resultItems = Array.from(results.querySelectorAll('.db-search-result'));
    if (!resultItems.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusedIdx = (focusedIdx + 1) % resultItems.length;
      _setFocus(resultItems, focusedIdx);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusedIdx = (focusedIdx - 1 + resultItems.length) % resultItems.length;
      _setFocus(resultItems, focusedIdx);
    } else if (e.key === 'Enter' && focusedIdx >= 0) {
      e.preventDefault();
      resultItems[focusedIdx]?.click();
    }
  });

  /** Sets keyboard focus highlight on a result item. */
  function _setFocus(items, idx) {
    items.forEach((el, i) => el.classList.toggle('focused', i === idx));
    items[idx]?.scrollIntoView({ block: 'nearest' });
  }

  // Expose openSearch globally so the notification bell and other
  // parts of the app can trigger it
  window.openSearch = openSearch;
}

/**
 * Fetches search results from the API and renders them grouped by type.
 * @param {string}      term    - User's search query.
 * @param {HTMLElement} results - Container element for results.
 */
async function _executeSearch(term, results) {
  try {
    const data = await window.api('getTasks', { search: term, pageSize: 20 });
    const tasks = data?.tasks || [];

    if (!tasks.length) {
      results.innerHTML = `<div class="db-search-empty">No results for "<strong>${_esc(term)}</strong>"</div>`;
      return;
    }

    const taskIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`;

    results.innerHTML = `
      <div class="db-search-group-label">Tasks (${tasks.length})</div>
      ${tasks.map((t, i) => `
        <div
          class="db-search-result"
          role="option"
          tabindex="-1"
          aria-label="Open task ${t.TaskID}: ${_esc(t.Subject)}"
          data-task-id="${t.TaskID}"
          onclick="window.router && window.router.navigate('task-detail', { taskID: '${t.TaskID}' }); document.getElementById('db-search-overlay')?.classList.remove('open');"
        >
          <div class="db-search-result-icon">${taskIcon}</div>
          <div class="db-search-result-main">
            <div class="db-search-result-title truncate">${_esc(t.Subject)}</div>
            <div class="db-search-result-sub">${t.TaskID} · ${t.PrimaryDept} · ${STATUS_LABEL[t.Status]||t.Status}</div>
          </div>
          <span class="badge badge-${(t.Priority||'low').toLowerCase()}" style="flex-shrink:0;">${t.Priority}</span>
        </div>`).join('')}
    `;
  } catch (err) {
    results.innerHTML = `<div class="db-search-empty" style="color:var(--color-danger);">Search failed: ${_esc(err.message)}</div>`;
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// L — EVENT WIRING & MASTER INIT
// ═════════════════════════════════════════════════════════════════════════════

/** Wires static button events inside the dashboard scaffold. */
function _wireDashboardEvents() {
  document.getElementById('db-refresh-btn')?.addEventListener('click', () => {
    _dashCache  = null;
    _dashCacheTs = 0;
    loadDashboard();
  });

  document.getElementById('db-new-task-btn')?.addEventListener('click', () => {
    if (typeof window.openCreateTaskModal === 'function') window.openCreateTaskModal();
    else window.ui?.toast('Access Denied', 'Task creation requires Super Admin or Chief Secretary role.', 'warning');
  });

  document.getElementById('db-view-all-pinned')?.addEventListener('click', () => {
    if (window.router) window.router.navigate('tasks', { isPinned: true });
  });
}

/**
 * Master dashboard data loader.
 * Fetches all required data in parallel, renders each section,
 * and caches results to avoid redundant API calls within TTL.
 */
async function loadDashboard() {
  // ── Check cache ───────────────────────────────────────────────────────
  if (_dashCache && (Date.now() - _dashCacheTs) < CACHE_TTL_MS) {
    _renderAllSections(_dashCache);
    return;
  }

  // ── Show greeting ─────────────────────────────────────────────────────
  const session  = window.store?.session;
  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name     = session?.fullName?.split(' ')[0] || 'Officer';
  const dateStr  = new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const greetEl  = document.getElementById('db-greeting');
  if (greetEl) greetEl.textContent = `${greeting}, ${name} · ${dateStr}`;

  // ── Parallel API calls ────────────────────────────────────────────────
  let stats, heatmap, deptPerf, settings;
  try {
    [stats, heatmap, deptPerf, settings] = await Promise.all([
      window.api('getDashboardStats',        {}),
      window.api('getHeatmapData',           {}),
      window.api('getDepartmentPerformance', {}),
      window.api('getSettings',              {}).catch(() => []), // Fails gracefully for non-admins
    ]);
  } catch (err) {
    window.ui?.toast('Dashboard Error', err.message, 'error');
    return;
  }

  // ── Fetch recent comments for directions panel ────────────────────────
  // We use last 10 activity records' taskIDs to get associated comments
  let recentComments = [];
  try {
    if (stats?.recentActivity?.length) {
      // Get the first distinct task and load its comments
      const taskIDs = [...new Set(
        (stats.recentActivity || []).map(a => a.TaskID).filter(Boolean)
      )].slice(0, 3);

      const commentArrays = await Promise.all(
        taskIDs.map(id => window.api('getComments', { taskID: id }).catch(() => []))
      );
      recentComments = commentArrays.flat();
    }
  } catch { /* non-fatal */ }

  // ── Cache ─────────────────────────────────────────────────────────────
  _dashCache   = { stats, heatmap, deptPerf, settings, recentComments };
  _dashCacheTs = Date.now();

  _renderAllSections(_dashCache);
}

/**
 * Renders all dashboard sections from cached data.
 * @param {{ stats, heatmap, deptPerf, settings, recentComments }} data
 */
function _renderAllSections(data) {
  const { stats, heatmap, deptPerf, settings, recentComments } = data;

  if (stats) {
    renderKPICards(stats);
    renderPinnedTasks(stats.pinnedTasks || []);
    renderExecutiveAlerts(stats.overdueList || [], {});
  }

  renderDeptTable(deptPerf || []);
  renderRecentDirections(recentComments || [], stats?.pinnedTasks || []);

  if (stats) renderCharts(stats);
  if (heatmap) renderHeatmap(heatmap);

  initAIPanel(settings || []);
}

/**
 * Initialises the dashboard module.
 * Called on DOMContentLoaded and every time the dashboard view is navigated to.
 */
function initDashboard() {
  injectDashboardCSS();

  const panel = document.getElementById('view-dashboard');
  if (!panel) return;

  const alreadyInjected = panel.querySelector('#db-header');
  if (!alreadyInjected) {
    // Panel was cleared (logout/role switch) or first load — inject fresh scaffold
    // Destroy any lingering chart instances first to prevent canvas re-use errors
    [_chartStatus, _chartPriority, _chartTrend].forEach(function(c) {
      if (c) { try { c.destroy(); } catch(e) {} }
    });
    _chartStatus = _chartPriority = _chartTrend = null;
    injectDashboardScaffold();
  }

  injectSpeedDial();
  injectSearchOverlay();
  loadDashboard();
}


// ═════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/** Formats an ISO date string for display in en-IN locale. */
function _fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }); }
  catch { return iso; }
}

/** Escapes HTML entities to prevent XSS in dynamically-rendered content. */
function _esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** Returns an inline SVG icon for KPI cards. */
function _kpiSVG(name) {
  const svgs = {
    layers:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
    clock:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    activity: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    check:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
    zap:      `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    alert:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    calendar: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    week:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="15" x2="16" y2="15"/></svg>`,
  };
  return svgs[name] || svgs.layers;
}


// ═════════════════════════════════════════════════════════════════════════════
// VIEW-CHANGE LISTENER & EXPORT
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Listens for the drishti:viewchange custom event (fired by router.resolve())
 * and triggers dashboard init when navigating to #dashboard.
 */
document.addEventListener('drishti:viewchange', (e) => {
  if (e.detail?.view === 'dashboard') {
    initDashboard();
  }
});

/**
 * If the page loads directly on #dashboard (or no hash), init immediately
 * once the main app is shown. We wait for the `drishti:appready` event
 * which index.html fires after showApp() (deferred one frame to ensure all
 * module scripts have registered their listeners first).
 *
 * Handles: Chief Secretary, Read Only, CSO Staff, and any non-admin non-dept role.
 * Super Admin is handled by admin.js. Department role is handled by dept.js.
 */
document.addEventListener('drishti:appready', () => {
  const hash = window.location.hash.replace('#','') || 'dashboard';
  const role = window.store?.session?.role;
  const isAdmin = role === 'Super Admin';
  const isDept  = role === 'Department';
  // Dashboard.js renders for CS, ReadOnly, Staff, and any other non-admin/non-dept role
  if ((hash === 'dashboard' || hash === '') && !isAdmin && !isDept) {
    initDashboard();
  }
});

// Also expose globally for direct calls from index.html if needed
window.initDashboard = initDashboard;

/**
 * Clears all dashboard module-level state.
 * Called by showLogin() in index.html on logout/session switch to prevent
 * User A's data appearing on User B's first render.
 */
window.resetDashboardState = function() {
  // Bust data cache so next render fetches fresh data for the new session
  _dashCache   = null;
  _dashCacheTs = 0;

  // Destroy chart instances — prevents canvas re-use errors and memory leaks
  [_chartStatus, _chartPriority, _chartTrend].forEach(function(chart) {
    if (chart) { try { chart.destroy(); } catch(e) {} }
  });
  _chartStatus   = null;
  _chartPriority = null;
  _chartTrend    = null;

  // Clear Chart.js load promise so it re-registers cleanly if CDN changes
  _chartJsLoading = null;
};
