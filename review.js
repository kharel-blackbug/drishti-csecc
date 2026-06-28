/**
 * DRISHTI — Executive Review Mode
 * File: review.js
 *
 * Loaded by index.html as <script type="module" src="review.js">.
 * Renders a full-viewport, distraction-free task review interface into
 * #view-review, completely replacing the normal app shell layout while
 * Review Mode is active.
 *
 * Routes handled:
 *   #review          — opens Review Mode with the current active filter queue
 *   #review/TASK_ID  — opens Review Mode directly on a specific task
 *
 * Keyboard:
 *   ArrowRight / ArrowLeft — next / previous task in queue
 *   Escape                 — exit Review Mode → #dashboard
 *   Ctrl+Enter             — send comment
 *
 * Dependencies (globals exposed by index.html's showApp()):
 *   window.api(action, payload)
 *   window.ui.toast(title, msg, type)
 *   window.ui.confirm(title, msg, label)
 *   window.ui._esc(str)
 *   window.router.navigate(view, params)
 *   window.store.session
 *
 * @version 6.0.0
 * @module  Executive Review Mode
 */

'use strict';

// ═════════════════════════════════════════════════════════════════════════════
// A — MODULE STATE
// ═════════════════════════════════════════════════════════════════════════════

/** @type {Object[]} Current task queue for navigation */
let _queue      = [];
/** @type {number} Index into _queue of the currently displayed task */
let _queueIdx   = 0;
/** @type {Object|null} Currently loaded task object */
let _task       = null;
/** @type {Object[]} Comments for current task */
let _comments   = [];
/** @type {Object[]} Attachments for current task */
let _attachments= [];
/** @type {'comments'|'attachments'|'ai'} Active right-panel tab */
let _activeTab  = 'comments';
/** @type {boolean} Whether the review overlay is currently visible */
let _active     = false;
/** @type {AbortController|null} For cancelling in-flight requests */
let _abortCtrl  = null;
/** @type {File[]} Files queued for upload */
let _uploadQueue= [];

// ═════════════════════════════════════════════════════════════════════════════
// B — CSS INJECTION (once)
// ═════════════════════════════════════════════════════════════════════════════

function injectReviewCSS() {
  if (document.getElementById('rv-styles')) return;
  const s = document.createElement('style');
  s.id = 'rv-styles';
  s.textContent = `
  /* ═══════════════════════════════════════════════════════════════════
     REVIEW MODE OVERLAY — covers the entire viewport over the shell
  ═══════════════════════════════════════════════════════════════════ */
  #rv-overlay {
    position: fixed;
    inset: 0;
    z-index: 6000;
    background: var(--color-bg);
    display: flex;
    flex-direction: column;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.25s ease, visibility 0.25s ease;
    overflow: hidden;
  }
  #rv-overlay.open {
    opacity: 1;
    visibility: visible;
  }

  /* ── Topbar ─────────────────────────────────────────────────────── */
  #rv-topbar {
    height: 52px;
    background: var(--color-primary);
    display: flex;
    align-items: center;
    padding: 0 var(--space-5);
    gap: var(--space-4);
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  }
  .rv-back-btn {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.15);
    color: rgba(255,255,255,0.9);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-sm);
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    transition: background var(--transition);
    flex-shrink: 0;
  }
  .rv-back-btn:hover { background: rgba(255,255,255,0.18); }
  .rv-topbar-id {
    color: var(--color-accent);
    font-weight: 700;
    font-size: var(--font-sm);
    font-family: monospace;
    flex-shrink: 0;
  }
  .rv-topbar-subject {
    color: rgba(255,255,255,0.7);
    font-size: var(--font-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }
  .rv-topbar-badges {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }
  .rv-topbar-theme {
    background: none;
    border: none;
    color: rgba(255,255,255,0.6);
    cursor: pointer;
    display: flex;
    align-items: center;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    transition: color var(--transition), background var(--transition);
  }
  .rv-topbar-theme:hover { color: #fff; background: rgba(255,255,255,0.1); }

  /* ── Body ───────────────────────────────────────────────────────── */
  #rv-body {
    flex: 1;
    display: grid;
    grid-template-columns: 60% 40%;
    overflow: hidden;
    min-height: 0;
  }

  /* ── LEFT PANEL ─────────────────────────────────────────────────── */
  #rv-left {
    overflow-y: auto;
    padding: var(--space-6) var(--space-6) var(--space-6) var(--space-8);
    border-right: 1px solid var(--color-border);
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) transparent;
  }
  #rv-left::-webkit-scrollbar { width: 5px; }
  #rv-left::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 3px; }

  .rv-meta-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin-bottom: var(--space-4);
  }
  .rv-task-id {
    font-family: monospace;
    font-size: var(--font-sm);
    font-weight: 700;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    padding: 2px 10px;
    border-radius: var(--radius-xs);
    color: var(--color-text-secondary);
  }
  .rv-subject {
    font-size: 1.5rem;
    font-weight: 800;
    color: var(--color-text-primary);
    line-height: 1.3;
    margin-bottom: var(--space-4);
  }
  .rv-description {
    font-size: var(--font-base);
    color: var(--color-text-secondary);
    line-height: 1.75;
    white-space: pre-wrap;
    margin-bottom: var(--space-5);
    padding: var(--space-4);
    background: var(--color-surface-2);
    border-radius: var(--radius-sm);
    border-left: 3px solid var(--color-accent);
  }

  /* Metadata grid */
  .rv-meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3) var(--space-5);
    margin-bottom: var(--space-5);
  }
  .rv-meta-item { display: flex; flex-direction: column; gap: 3px; }
  .rv-meta-label {
    font-size: var(--font-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }
  .rv-meta-value {
    font-size: var(--font-sm);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  /* Progress */
  .rv-progress-wrap {
    margin-bottom: var(--space-5);
  }
  .rv-progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-2);
  }
  .rv-progress-label { font-size: var(--font-sm); font-weight: 600; color: var(--color-text-primary); }
  .rv-progress-pct {
    font-size: var(--font-lg);
    font-weight: 800;
    color: var(--color-text-primary);
  }
  .rv-progress-bar {
    height: 10px;
    background: var(--color-surface-3);
    border-radius: var(--radius-full);
    overflow: hidden;
  }
  .rv-progress-fill {
    height: 100%;
    border-radius: var(--radius-full);
    transition: width 0.8s cubic-bezier(0.4,0,0.2,1), background 0.4s ease;
  }
  .rv-progress-fill.low    { background: linear-gradient(90deg, #B71C1C, #EF5350); }
  .rv-progress-fill.mid    { background: linear-gradient(90deg, #F57F17, #FFB300); }
  .rv-progress-fill.high   { background: linear-gradient(90deg, #2E7D32, #43A047); }

  /* Timeline */
  .rv-timeline { position: relative; padding-left: var(--space-5); }
  .rv-timeline::before {
    content: '';
    position: absolute;
    left: 7px;
    top: 6px;
    bottom: 6px;
    width: 2px;
    background: var(--color-border);
    border-radius: 1px;
  }
  .rv-timeline-item {
    position: relative;
    margin-bottom: var(--space-4);
    padding-left: var(--space-4);
    animation: fadeIn 0.3s ease backwards;
  }
  .rv-timeline-dot {
    position: absolute;
    left: -17px;
    top: 4px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--color-surface);
    flex-shrink: 0;
  }
  .rv-timeline-dot.created   { background: var(--color-primary); }
  .rv-timeline-dot.status    { background: var(--color-warning); }
  .rv-timeline-dot.comment   { background: var(--color-primary-light); }
  .rv-timeline-dot.upload    { background: var(--color-success); }
  .rv-timeline-dot.direction { background: var(--color-danger); }
  .rv-tl-time { font-size: var(--font-xs); color: var(--color-text-muted); margin-bottom: 2px; }
  .rv-tl-text { font-size: var(--font-sm); color: var(--color-text-primary); line-height: 1.4; }
  .rv-tl-sub  { font-size: var(--font-xs); color: var(--color-text-secondary); margin-top: 1px; }

  /* ── RIGHT PANEL ────────────────────────────────────────────────── */
  #rv-right {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--color-surface);
  }

  /* Tabs */
  .rv-tabs {
    display: flex;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
    background: var(--color-surface-2);
  }
  .rv-tab {
    flex: 1;
    padding: var(--space-3) var(--space-2);
    border: none;
    background: none;
    font-family: inherit;
    font-size: var(--font-sm);
    font-weight: 600;
    color: var(--color-text-secondary);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color var(--transition), border-color var(--transition), background var(--transition);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
  }
  .rv-tab:hover { color: var(--color-text-primary); background: var(--color-surface-3); }
  .rv-tab.active {
    color: var(--color-primary);
    border-bottom-color: var(--color-primary);
    background: var(--color-surface);
  }
  .rv-tab-badge {
    background: var(--color-primary);
    color: #fff;
    font-size: 0.65rem;
    font-weight: 700;
    border-radius: var(--radius-full);
    padding: 1px 6px;
    min-width: 18px;
    text-align: center;
  }

  /* Tab content */
  .rv-tab-content { display: none; flex: 1; flex-direction: column; overflow: hidden; }
  .rv-tab-content.active { display: flex; }

  /* ── COMMENTS TAB ───────────────────────────────────────────────── */
  #rv-comments-list {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) transparent;
  }
  #rv-comments-list::-webkit-scrollbar { width: 5px; }
  #rv-comments-list::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 3px; }

  .rv-comment-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    animation: rv-slide-in 0.25s ease backwards;
  }
  @keyframes rv-slide-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Right-aligned (CS / Admin) */
  .rv-comment-wrap.mine { align-items: flex-end; }
  .rv-comment-wrap.mine .rv-bubble {
    background: var(--color-primary);
    color: #fff;
    border-radius: var(--radius-md) var(--radius-xs) var(--radius-md) var(--radius-md);
    max-width: 85%;
  }
  .rv-comment-wrap.mine .rv-bubble-meta { text-align: right; }

  /* Left-aligned (Department) */
  .rv-comment-wrap.theirs { align-items: flex-start; }
  .rv-comment-wrap.theirs .rv-bubble {
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xs) var(--radius-md) var(--radius-md) var(--radius-md);
    max-width: 85%;
  }

  .rv-bubble {
    padding: var(--space-3) var(--space-4);
    position: relative;
    word-break: break-word;
    line-height: 1.55;
    font-size: var(--font-sm);
  }
  .rv-bubble-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
    flex-wrap: wrap;
  }
  .rv-bubble-author { font-weight: 700; font-size: var(--font-xs); }
  .rv-bubble-role   { font-size: 0.65rem; opacity: 0.7; }
  .rv-bubble-text   { white-space: pre-wrap; }
  .rv-bubble-meta {
    font-size: 0.65rem;
    color: var(--color-text-muted);
    padding: 0 var(--space-1);
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .rv-read-receipt { font-size: 0.6rem; color: var(--color-success); }

  /* Category badges (comment) */
  .rv-cat-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 8px;
    border-radius: var(--radius-full);
    font-size: 0.65rem;
    font-weight: 700;
    white-space: nowrap;
  }
  .rv-cat-observation  { background: rgba(107,122,153,0.15); color: var(--color-text-secondary); }
  .rv-cat-direction    { background: rgba(26,58,92,0.15);    color: var(--color-primary); }
  .rv-cat-attention    { background: rgba(183,28,28,0.15);   color: var(--color-danger); }
  .rv-cat-appreciation { background: rgba(46,125,50,0.15);   color: var(--color-success); }
  .rv-cat-reminder     { background: rgba(245,127,23,0.15);  color: var(--color-warning); }

  /* Mine variants (on dark bubble) */
  .rv-comment-wrap.mine .rv-cat-observation  { background: rgba(255,255,255,0.15); color: rgba(255,255,255,0.8); }
  .rv-comment-wrap.mine .rv-cat-direction    { background: rgba(201,168,76,0.25);  color: var(--color-accent-light); }
  .rv-comment-wrap.mine .rv-cat-attention    { background: rgba(255,100,100,0.25); color: #ff8a80; }
  .rv-comment-wrap.mine .rv-cat-appreciation { background: rgba(100,255,100,0.15); color: #a5d6a7; }
  .rv-comment-wrap.mine .rv-cat-reminder     { background: rgba(255,200,100,0.2);  color: #ffe082; }

  /* Comment input area */
  #rv-comment-input-area {
    flex-shrink: 0;
    border-top: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  .rv-input-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface-2);
  }
  .rv-cat-select {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    font-size: var(--font-xs);
    font-weight: 600;
    font-family: inherit;
    padding: 3px 8px;
    color: var(--color-text-primary);
    cursor: pointer;
    outline: none;
    transition: border-color var(--transition);
  }
  .rv-cat-select:focus { border-color: var(--color-border-focus); }
  .rv-input-hint {
    font-size: 0.65rem;
    color: var(--color-text-muted);
    margin-left: auto;
  }
  #rv-comment-box {
    min-height: 64px;
    max-height: 140px;
    overflow-y: auto;
    padding: var(--space-3) var(--space-4);
    font-size: var(--font-sm);
    font-family: inherit;
    color: var(--color-text-primary);
    line-height: 1.6;
    outline: none;
    resize: none;
    white-space: pre-wrap;
    word-break: break-word;
  }
  #rv-comment-box:empty::before {
    content: attr(data-placeholder);
    color: var(--color-text-muted);
    pointer-events: none;
  }
  .rv-input-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--color-border);
    background: var(--color-surface-2);
  }
  .rv-attach-btn {
    background: none;
    border: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--font-xs);
    font-family: inherit;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    transition: color var(--transition), background var(--transition);
  }
  .rv-attach-btn:hover { color: var(--color-primary); background: var(--color-surface-3); }

  /* ── ATTACHMENTS TAB ────────────────────────────────────────────── */
  #rv-attachments-panel {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .rv-upload-zone {
    margin: var(--space-4);
    border: 2px dashed var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-6);
    text-align: center;
    cursor: pointer;
    transition: border-color var(--transition), background var(--transition);
    background: var(--color-surface-2);
  }
  .rv-upload-zone:hover,
  .rv-upload-zone.drag-over {
    border-color: var(--color-primary-light);
    background: rgba(42,95,158,0.06);
  }
  .rv-upload-icon { color: var(--color-text-muted); margin-bottom: var(--space-2); }
  .rv-upload-text { font-size: var(--font-sm); color: var(--color-text-secondary); }
  .rv-upload-hint { font-size: var(--font-xs); color: var(--color-text-muted); margin-top: 4px; }
  #rv-upload-input { display: none; }

  .rv-upload-progress {
    margin: 0 var(--space-4) var(--space-3);
    display: none;
  }
  .rv-upload-progress.visible { display: block; }
  .rv-upload-progress-bar {
    height: 4px;
    background: var(--color-surface-3);
    border-radius: var(--radius-full);
    overflow: hidden;
    margin-top: 4px;
  }
  .rv-upload-progress-fill {
    height: 100%;
    background: var(--color-primary-light);
    border-radius: var(--radius-full);
    transition: width 0.3s ease;
  }

  .rv-file-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
    padding: 0 var(--space-4) var(--space-4);
  }
  .rv-file-card {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    transition: box-shadow var(--transition);
  }
  .rv-file-card:hover { box-shadow: var(--shadow-sm); }
  .rv-file-preview {
    width: 100%;
    height: 80px;
    background: var(--color-surface-3);
    border-radius: var(--radius-xs);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: var(--space-2);
  }
  .rv-file-preview img { width: 100%; height: 100%; object-fit: cover; }
  .rv-file-icon { font-size: 2rem; }
  .rv-file-name {
    font-size: var(--font-xs);
    font-weight: 700;
    color: var(--color-text-primary);
    word-break: break-all;
    line-height: 1.3;
  }
  .rv-file-meta { font-size: 0.65rem; color: var(--color-text-muted); }
  .rv-file-actions { display: flex; gap: var(--space-2); margin-top: auto; }

  /* ── AI TAB ─────────────────────────────────────────────────────── */
  #rv-ai-panel {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .rv-ai-summary-box {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    border-left: 4px solid var(--color-accent);
    font-size: var(--font-sm);
    line-height: 1.75;
    white-space: pre-wrap;
    color: var(--color-text-primary);
  }
  .rv-typing-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--font-sm);
  }
  .rv-typing-dots { display: flex; gap: 4px; }
  .rv-typing-dot {
    width: 6px; height: 6px;
    background: var(--color-text-muted);
    border-radius: 50%;
    animation: rv-bounce 1.2s ease-in-out infinite;
  }
  .rv-typing-dot:nth-child(2) { animation-delay: 0.2s; }
  .rv-typing-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes rv-bounce {
    0%,80%,100% { transform: translateY(0); }
    40%          { transform: translateY(-6px); }
  }

  /* ── QUICK ACTIONS BAR ──────────────────────────────────────────── */
  #rv-quick-actions {
    flex-shrink: 0;
    background: var(--color-surface);
    border-top: 1px solid var(--color-border);
    padding: var(--space-3) var(--space-4);
    display: flex;
    gap: var(--space-2);
    justify-content: stretch;
  }
  .rv-action-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: var(--space-2) var(--space-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    cursor: pointer;
    font-family: inherit;
    transition: all var(--transition);
    min-width: 0;
  }
  .rv-action-btn:hover {
    background: var(--color-surface-2);
    border-color: var(--color-primary-light);
    transform: translateY(-1px);
    box-shadow: var(--shadow-sm);
  }
  .rv-action-btn:active { transform: translateY(0); }
  .rv-action-icon { font-size: 1.3rem; line-height: 1; }
  .rv-action-label {
    font-size: 0.62rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
  }
  .rv-action-btn.active .rv-action-label { color: var(--color-primary); }
  .rv-action-btn.danger .rv-action-label { color: var(--color-danger); }
  .rv-action-btn.danger:hover { border-color: var(--color-danger); background: var(--color-danger-light); }

  /* ── NAVIGATION BAR ─────────────────────────────────────────────── */
  #rv-nav-bar {
    height: 48px;
    background: var(--color-primary-dark);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-5);
    flex-shrink: 0;
  }
  .rv-nav-btn {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.15);
    color: rgba(255,255,255,0.9);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-4);
    font-size: var(--font-sm);
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    transition: background var(--transition), opacity var(--transition);
  }
  .rv-nav-btn:hover:not(:disabled) { background: rgba(255,255,255,0.18); }
  .rv-nav-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .rv-nav-counter {
    color: rgba(255,255,255,0.6);
    font-size: var(--font-sm);
    font-weight: 600;
    text-align: center;
  }
  .rv-nav-counter strong { color: #fff; }

  /* ── EMAIL COMPOSE MODAL ────────────────────────────────────────── */
  #rv-email-modal {
    position: fixed;
    inset: 0;
    z-index: 9000;
    background: rgba(0,0,0,0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.2s ease, visibility 0.2s ease;
  }
  #rv-email-modal.open { opacity: 1; visibility: visible; }
  .rv-email-card {
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-xl);
    width: 100%;
    max-width: 560px;
    overflow: hidden;
    transform: scale(0.96) translateY(-16px);
    transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1);
  }
  #rv-email-modal.open .rv-email-card { transform: scale(1) translateY(0); }

  /* ── LOADING STATE ──────────────────────────────────────────────── */
  #rv-loading {
    position: absolute;
    inset: 0;
    background: var(--color-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: var(--space-4);
    z-index: 10;
    transition: opacity 0.3s ease;
  }
  #rv-loading.hidden { opacity: 0; pointer-events: none; }
  .rv-spinner {
    width: 40px; height: 40px;
    border: 3px solid var(--color-border);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  .rv-loading-text { font-size: var(--font-sm); color: var(--color-text-secondary); }

  /* ── RESPONSIVE ─────────────────────────────────────────────────── */
  @media (max-width: 900px) {
    #rv-body { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
    #rv-left { border-right: none; border-bottom: 1px solid var(--color-border); }
  }
  @media (max-width: 600px) {
    #rv-body { grid-template-rows: auto 1fr; }
    .rv-action-label { display: none; }
    .rv-action-btn   { padding: var(--space-2); }
    .rv-meta-grid    { grid-template-columns: 1fr; }
  }
  `;
  document.head.appendChild(s);
}


// ═════════════════════════════════════════════════════════════════════════════
// C — HTML SCAFFOLD (injected into document.body once)
// ═════════════════════════════════════════════════════════════════════════════

function injectReviewOverlay() {
  if (document.getElementById('rv-overlay')) return;

  const el = document.createElement('div');
  el.id = 'rv-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Executive Review Mode');
  el.innerHTML = `

  <!-- Loading spinner -->
  <div id="rv-loading" role="status" aria-live="polite">
    <div class="rv-spinner" aria-hidden="true"></div>
    <div class="rv-loading-text">Loading task…</div>
  </div>

  <!-- Topbar -->
  <div id="rv-topbar" role="banner">
    <button class="rv-back-btn" id="rv-back-btn" aria-label="Exit Review Mode and return to dashboard">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
      Exit Review
    </button>
    <span class="rv-topbar-id" id="rv-topbar-id" aria-label="Task ID">—</span>
    <span class="rv-topbar-subject" id="rv-topbar-subject">—</span>
    <div class="rv-topbar-badges" id="rv-topbar-badges"></div>
    <button class="rv-topbar-theme" id="rv-theme-btn" aria-label="Toggle dark mode">
      <svg id="rv-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
      <svg id="rv-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="display:none"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
    </button>
  </div>

  <!-- Split body -->
  <div id="rv-body">

    <!-- LEFT: Task Detail -->
    <div id="rv-left" role="main" aria-label="Task details">
      <div class="rv-meta-header" id="rv-meta-header"></div>
      <h1 class="rv-subject" id="rv-subject">—</h1>
      <div class="rv-description" id="rv-description" aria-label="Task description">—</div>

      <div class="rv-meta-grid" id="rv-meta-grid" aria-label="Task metadata"></div>

      <div class="rv-progress-wrap">
        <div class="rv-progress-header">
          <span class="rv-progress-label">Progress</span>
          <span class="rv-progress-pct" id="rv-pct-label" aria-live="polite">0%</span>
        </div>
        <div class="rv-progress-bar" role="progressbar" aria-labelledby="rv-pct-label">
          <div class="rv-progress-fill low" id="rv-progress-fill" style="width:0%"></div>
        </div>
      </div>

      <div style="margin-bottom:var(--space-2);font-size:var(--font-sm);font-weight:700;color:var(--color-text-primary);">
        Activity Timeline
      </div>
      <div class="rv-timeline" id="rv-timeline" aria-label="Task activity timeline" role="log" aria-live="polite"></div>
    </div>

    <!-- RIGHT: Activity Feed -->
    <div id="rv-right" aria-label="Activity feed">

      <!-- Tabs -->
      <div class="rv-tabs" role="tablist" aria-label="Activity feed tabs">
        <button class="rv-tab active" role="tab" data-tab="comments"
          aria-selected="true" aria-controls="rv-tab-comments" id="rv-tab-btn-comments">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          Comments
          <span class="rv-tab-badge" id="rv-comment-count">0</span>
        </button>
        <button class="rv-tab" role="tab" data-tab="attachments"
          aria-selected="false" aria-controls="rv-tab-attachments" id="rv-tab-btn-attachments">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
          Attachments
          <span class="rv-tab-badge" id="rv-attach-count">0</span>
        </button>
        <button class="rv-tab" role="tab" data-tab="ai"
          aria-selected="false" aria-controls="rv-tab-ai" id="rv-tab-btn-ai">
          <span style="color:var(--color-accent);font-size:0.9rem;">✦</span>
          AI Summary
        </button>
      </div>

      <!-- COMMENTS TAB -->
      <div class="rv-tab-content active" id="rv-tab-comments" role="tabpanel" aria-labelledby="rv-tab-btn-comments">
        <div id="rv-comments-list" aria-live="polite" aria-label="Comment thread"></div>
        <div id="rv-comment-input-area">
          <div class="rv-input-toolbar">
            <label for="rv-cat-select" class="visually-hidden">Comment category</label>
            <select class="rv-cat-select" id="rv-cat-select" aria-label="Comment category">
              <option value="General Observation">ℹ General Observation</option>
              <option value="Direction">→ Direction</option>
              <option value="Immediate Attention">! Immediate Attention</option>
              <option value="Appreciation">★ Appreciation</option>
              <option value="Reminder">⏰ Reminder</option>
            </select>
            <span class="rv-input-hint" aria-hidden="true">Ctrl+Enter to send</span>
          </div>
          <div
            id="rv-comment-box"
            contenteditable="true"
            role="textbox"
            aria-multiline="true"
            aria-label="Type a comment"
            data-placeholder="Type a comment or direction…"
            tabindex="0"
          ></div>
          <div class="rv-input-actions">
            <button class="rv-attach-btn" id="rv-attach-comment-btn" aria-label="Attach file to comment">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
              Attach File
            </button>
            <button class="btn btn-primary btn-sm" id="rv-send-btn" aria-label="Post comment (Ctrl+Enter)">
              Post
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- ATTACHMENTS TAB -->
      <div class="rv-tab-content" id="rv-tab-attachments" role="tabpanel" aria-labelledby="rv-tab-btn-attachments">
        <div id="rv-attachments-panel">
          <div
            class="rv-upload-zone"
            id="rv-upload-zone"
            role="button"
            tabindex="0"
            aria-label="Upload files — click or drag and drop"
          >
            <div class="rv-upload-icon" aria-hidden="true">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </div>
            <div class="rv-upload-text">Drag & drop files here or <strong>click to browse</strong></div>
            <div class="rv-upload-hint">PDF, DOCX, XLSX, PNG, JPG, ZIP — max 10 MB each</div>
            <input type="file" id="rv-upload-input" multiple accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.zip" aria-hidden="true" tabindex="-1" />
          </div>
          <div class="rv-upload-progress" id="rv-upload-progress">
            <div style="font-size:var(--font-xs);color:var(--color-text-secondary);" id="rv-upload-status">Uploading…</div>
            <div class="rv-upload-progress-bar">
              <div class="rv-upload-progress-fill" id="rv-upload-bar" style="width:0%"></div>
            </div>
          </div>
          <div class="rv-file-grid" id="rv-file-grid" aria-live="polite" aria-label="Attached files"></div>
        </div>
      </div>

      <!-- AI TAB -->
      <div class="rv-tab-content" id="rv-tab-ai" role="tabpanel" aria-labelledby="rv-tab-btn-ai">
        <div id="rv-ai-panel">
          <button class="btn btn-accent" id="rv-ai-gen-btn" style="align-self:flex-start;" aria-label="Generate AI summary for this task">
            <span style="font-size:1rem;">✦</span> Generate AI Summary
          </button>
          <div id="rv-ai-output" aria-live="polite"></div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div id="rv-quick-actions" role="toolbar" aria-label="Quick actions">
        <button class="rv-action-btn" id="rv-qa-approve" aria-label="Mark task as reviewed or change status">
          <span class="rv-action-icon">✅</span>
          <span class="rv-action-label">Mark Reviewed</span>
        </button>
        <button class="rv-action-btn" id="rv-qa-direction" aria-label="Add a direction comment">
          <span class="rv-action-icon">→</span>
          <span class="rv-action-label">Add Direction</span>
        </button>
        <button class="rv-action-btn" id="rv-qa-reminder" aria-label="Send reminder to assigned department">
          <span class="rv-action-icon">🔔</span>
          <span class="rv-action-label">Send Reminder</span>
        </button>
        <button class="rv-action-btn" id="rv-qa-pin" aria-label="Pin or unpin this task">
          <span class="rv-action-icon">📌</span>
          <span class="rv-action-label">Pin Task</span>
        </button>
        <button class="rv-action-btn" id="rv-qa-email" aria-label="Post a direction to the assigned department">
          <span class="rv-action-icon">✉</span>
          <span class="rv-action-label">Post Direction</span>
        </button>
      </div>

    </div><!-- /#rv-right -->
  </div><!-- /#rv-body -->

  <!-- Navigation bar -->
  <div id="rv-nav-bar" role="navigation" aria-label="Task navigation">
    <button class="rv-nav-btn" id="rv-prev-btn" aria-label="Previous task">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
      Previous
    </button>
    <div class="rv-nav-counter" id="rv-nav-counter" aria-live="polite">—</div>
    <button class="rv-nav-btn" id="rv-next-btn" aria-label="Next task">
      Next
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
    </button>
  </div>

  `;

  document.body.appendChild(el);

  // Email compose modal (separate DOM element)
  injectEmailModal();
}

/** Injects the email compose modal into document body */
function injectEmailModal() {
  if (document.getElementById('rv-email-modal')) return;
  const m = document.createElement('div');
  m.id = 'rv-email-modal';
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-modal', 'true');
  m.setAttribute('aria-labelledby', 'rv-email-title');
  m.innerHTML = `
  <div class="rv-email-card">
    <div class="modal-header">
      <div class="modal-title" id="rv-email-title">Post Direction to Department</div>
      <button class="icon-btn" id="rv-email-close" aria-label="Close direction composer">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:var(--space-4);">
      <div class="form-group">
        <label class="form-label" for="rv-email-to">To</label>
        <input type="text" class="input" id="rv-email-to" placeholder="HOD emails (auto-populated)" aria-label="Email recipients" readonly />
      </div>
      <div class="form-group">
        <label class="form-label" for="rv-email-subject">Subject</label>
        <input type="text" class="input" id="rv-email-subject" placeholder="Email subject" aria-label="Email subject" />
      </div>
      <div class="form-group">
        <label class="form-label" for="rv-email-body">Message</label>
        <textarea class="textarea" id="rv-email-body" rows="6" placeholder="Your message to the department…" aria-label="Email body"></textarea>
      </div>
      <div id="rv-email-error" class="form-error" role="alert"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="rv-email-cancel" aria-label="Cancel">Cancel</button>
      <button class="btn btn-primary" id="rv-email-send-btn" aria-label="Post direction">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        Post Direction
      </button>
    </div>
  </div>`;
  document.body.appendChild(m);
}


// ═════════════════════════════════════════════════════════════════════════════
// D — OPEN / CLOSE REVIEW MODE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Opens Review Mode for the given task queue and optionally jumps to a taskID.
 * @param {Object[]} queue  - Ordered array of task objects.
 * @param {string}   taskID - Optional; jump to this task in the queue.
 */
async function openReview(queue, taskID) {
  if (!queue || queue.length === 0) {
    window.ui?.toast('Review Mode', 'No tasks to review.', 'warning');
    return;
  }

  _queue    = queue;
  _queueIdx = taskID
    ? Math.max(0, queue.findIndex(t => t.TaskID === taskID))
    : 0;

  injectReviewCSS();
  injectReviewOverlay();
  _wireEvents();

  const overlay = document.getElementById('rv-overlay');
  overlay.classList.add('open');
  _active = true;

  // Prevent scroll on main page
  document.body.style.overflow = 'hidden';

  // Sync theme icon
  _syncThemeIcon();

  // Load the first/targeted task
  await _loadTask(_queue[_queueIdx]);
}

/** Closes Review Mode and returns to the previous hash. */
function closeReview() {
  const overlay = document.getElementById('rv-overlay');
  if (overlay) overlay.classList.remove('open');
  _active = false;
  document.body.style.overflow = '';
  // Abort any in-flight request
  if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
  // Navigate back
  if (window.router) window.router.navigate('dashboard');
}


// ═════════════════════════════════════════════════════════════════════════════
// E — TASK LOADING & RENDERING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Loads all data for a task and renders every panel.
 * @param {Object} taskObj - A task row object from the queue.
 */
async function _loadTask(taskObj) {
  _showLoading(true);
  _task = taskObj;

  try {
    const result = await window.api('getTask', { taskID: taskObj.TaskID });
    if (!result) throw new Error('Task data not returned from server.');

    _task        = result.task        || taskObj;
    _comments    = result.comments    || [];
    _attachments = result.attachments || [];

    _renderTopbar();
    _renderLeftPanel();
    _renderTimeline();
    _renderComments();
    _renderAttachments();
    _renderNavBar();
    _updateQuickActions();

    // Scroll comments to bottom
    setTimeout(() => {
      const list = document.getElementById('rv-comments-list');
      if (list) list.scrollTop = list.scrollHeight;
    }, 80);

  } catch (err) {
    window.ui?.toast('Load Error', err.message, 'error');
  } finally {
    _showLoading(false);
  }
}

/** Shows or hides the loading overlay within the review panel. */
function _showLoading(show) {
  const el = document.getElementById('rv-loading');
  if (el) el.classList.toggle('hidden', !show);
}

// ── LEFT PANEL ──────────────────────────────────────────────────────────────

function _renderTopbar() {
  const t = _task;
  _el('rv-topbar-id').textContent     = t.TaskID;
  _el('rv-topbar-subject').textContent = t.Subject;
  document.title = `DRISHTI Review — ${t.TaskID}`;

  const badges = _el('rv-topbar-badges');
  badges.innerHTML =
    `<span class="badge badge-${(t.Priority||'low').toLowerCase()}">${t.Priority}</span>` +
    `<span class="status-pill status-${(t.Status||'pending').toLowerCase()}">${_fmtStatus(t.Status)}</span>`;
}

function _renderLeftPanel() {
  const t = _task;

  // Meta header
  _el('rv-meta-header').innerHTML =
    `<span class="rv-task-id">${_esc(t.TaskID)}</span>` +
    `<span class="badge badge-${(t.Priority||'low').toLowerCase()}">${t.Priority}</span>` +
    `<span class="status-pill status-${(t.Status||'pending').toLowerCase()}">${_fmtStatus(t.Status)}</span>` +
    (t.IsPinned === 'TRUE' ? '<span title="Pinned" aria-label="Pinned task">📌</span>' : '');

  // Subject & description
  _el('rv-subject').textContent     = t.Subject;
  _el('rv-description').textContent = t.Description || 'No description provided.';

  // Metadata grid
  const depts = (t.AssignedDepts || '').split(',').join(' · ');
  _el('rv-meta-grid').innerHTML = [
    { label: 'Assigned Depts',      value: depts || '—' },
    { label: 'Due Date',            value: _fmtDate(t.DueDate) },
    { label: 'Assigned Date',       value: _fmtDate(t.AssignedDate) },
    { label: 'Officer Responsible', value: t.OfficerResponsible || '—' },
    { label: 'File Number',         value: t.FileNumber || '—' },
    { label: 'Category',            value: t.Category || '—' },
    { label: 'Cabinet Reference',   value: t.CabinetReference || '—' },
    { label: 'Created By',          value: t.CreatedBy || '—' },
  ].map(m => `
    <div class="rv-meta-item">
      <span class="rv-meta-label">${_esc(m.label)}</span>
      <span class="rv-meta-value">${_esc(m.value)}</span>
    </div>`).join('');

  // Progress bar
  const pct    = parseInt(t.ProgressPercent, 10) || 0;
  const fill   = _el('rv-progress-fill');
  const pctLbl = _el('rv-pct-label');
  pctLbl.textContent = pct + '%';
  fill.className  = 'rv-progress-fill ' + (pct < 30 ? 'low' : pct < 70 ? 'mid' : 'high');
  // Animate after paint
  requestAnimationFrame(() => { fill.style.width = pct + '%'; });
}

function _renderTimeline() {
  const events = [];
  const t = _task;

  // Seed with task creation
  events.push({ type: 'created', time: t.CreatedAt, text: 'Task created', sub: `by ${t.CreatedBy || '—'}` });

  // Comments → timeline events
  _comments.forEach(c => {
    const isDirection = c.Category === 'Direction' || c.Category === 'Immediate Attention';
    events.push({
      type: isDirection ? 'direction' : 'comment',
      time: c.Timestamp,
      text: `${_esc(c.AuthorName)} posted ${_esc(c.Category)}`,
      sub:  (c.Content || '').substring(0, 60) + ((c.Content || '').length > 60 ? '…' : ''),
    });
  });

  // Attachments → timeline
  _attachments.forEach(a => {
    events.push({
      type: 'upload',
      time: a.UploadedAt,
      text: `File attached: ${a.FileName}`,
      sub:  `by ${a.UploadedBy || '—'} · ${_fmtBytes(parseInt(a.FileSizeBytes, 10) || 0)}`,
    });
  });

  // Status — use LastUpdatedAt as a proxy if completed
  if (t.Status === 'COMPLETED' && t.LastUpdatedAt) {
    events.push({ type: 'status', time: t.LastUpdatedAt, text: 'Status → Completed', sub: `by ${t.LastUpdatedBy || '—'}` });
  }

  events.sort((a, b) => new Date(a.time) - new Date(b.time));

  const container = _el('rv-timeline');
  container.innerHTML = events.map((ev, i) => `
    <div class="rv-timeline-item" style="animation-delay:${i * 40}ms;" role="listitem">
      <div class="rv-timeline-dot ${ev.type}" aria-hidden="true"></div>
      <div class="rv-tl-time">${_fmtDate(ev.time)} ${_fmtTime(ev.time)}</div>
      <div class="rv-tl-text">${ev.text}</div>
      ${ev.sub ? `<div class="rv-tl-sub">${_esc(ev.sub)}</div>` : ''}
    </div>`).join('');

  if (!events.length) {
    container.innerHTML = '<div style="color:var(--color-text-muted);font-size:var(--font-sm);">No timeline events yet.</div>';
  }
}

// ── RIGHT PANEL — COMMENTS ───────────────────────────────────────────────────

function _renderComments() {
  const list = _el('rv-comments-list');
  const badge = _el('rv-comment-count');
  if (badge) badge.textContent = _comments.length;

  if (!_comments.length) {
    list.innerHTML = `
      <div class="empty-state" style="padding:var(--space-8);">
        <div class="empty-state-title">No comments yet</div>
        <div class="empty-state-desc">Use the input below to add the first direction or observation.</div>
      </div>`;
    return;
  }

  const myID = window.store?.session?.userID;

  list.innerHTML = _comments.map((c, i) => {
    const isMine = c.AuthorID === myID ||
                   ['Super Admin','Chief Secretary'].includes(c.AuthorRole);
    const side    = isMine ? 'mine' : 'theirs';
    const catCls  = _catClass(c.Category);
    const catIcon = _catIcon(c.Category);
    const readBy  = (c.ReadBy || '').split(',').filter(Boolean);
    const readTxt = readBy.length > 1
      ? `✓✓ Read by ${readBy.length}`
      : readBy.length === 1 ? '✓ Delivered' : '';
    const edited  = c.IsEdited === 'TRUE' ? ' · <em>edited</em>' : '';

    return `
    <div class="rv-comment-wrap ${side}" data-comment-id="${c.CommentID}" style="animation-delay:${i * 30}ms;" role="listitem">
      <div class="rv-bubble">
        <div class="rv-bubble-header">
          <span class="rv-bubble-author">${_esc(c.AuthorName)}</span>
          <span class="rv-bubble-role">${_esc(c.AuthorRole)}</span>
          <span class="rv-cat-badge ${catCls}" aria-label="Category: ${_esc(c.Category)}">${catIcon} ${_esc(c.Category)}</span>
        </div>
        <div class="rv-bubble-text">${_esc(c.Content)}</div>
      </div>
      <div class="rv-bubble-meta">
        <span>${_fmtDate(c.Timestamp)} ${_fmtTime(c.Timestamp)}${edited}</span>
        ${readTxt ? `<span class="rv-read-receipt" aria-label="${readTxt}">${readTxt}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── RIGHT PANEL — ATTACHMENTS ────────────────────────────────────────────────

function _renderAttachments() {
  const grid  = _el('rv-file-grid');
  const badge = _el('rv-attach-count');
  if (badge) badge.textContent = _attachments.length;

  if (!_attachments.length) {
    grid.innerHTML = '<div style="padding:var(--space-4);color:var(--color-text-muted);font-size:var(--font-sm);">No attachments yet. Upload files above.</div>';
    return;
  }

  // Safety helper: only allow Google Drive / Docs URLs to prevent open-redirect attacks
  function _safeDriveUrl(url) {
    if (!url || typeof url !== 'string') return '#';
    return url.startsWith('https://drive.google.com/') || url.startsWith('https://docs.google.com/') ? url : '#';
  }

  grid.innerHTML = _attachments.map(a => {
    const ext      = (a.FileName || '').split('.').pop().toLowerCase();
    const isImage  = ['png','jpg','jpeg','gif','webp'].includes(ext);
    const isPDF    = ext === 'pdf';
    const fileIcon = _fileIcon(ext);
    const safeUrl  = _safeDriveUrl(a.DriveViewURL);
    const preview  = isImage
      ? `<img src="${_esc(safeUrl)}" alt="${_esc(a.FileName)}" loading="lazy" />`
      : isPDF
        ? `<span class="rv-file-icon">📄</span>`
        : `<span class="rv-file-icon">${fileIcon}</span>`;

    return `
    <div class="rv-file-card" role="listitem">
      <div class="rv-file-preview" aria-hidden="true">${preview}</div>
      <div class="rv-file-name" title="${_esc(a.FileName)}">${_esc(a.FileName)}</div>
      <div class="rv-file-meta">${_esc(a.FileType.split('/').pop().toUpperCase())} · ${_fmtBytes(parseInt(a.FileSizeBytes,10)||0)}</div>
      <div class="rv-file-meta">↑ ${_esc(a.UploadedBy || '—')} · ${_fmtDate(a.UploadedAt)}</div>
      <div class="rv-file-actions">
        <a href="${_esc(safeUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="flex:1;justify-content:center;" aria-label="View file ${_esc(a.FileName)}">View</a>
        <a href="${_esc(safeUrl)}" download="${_esc(a.FileName)}" class="btn btn-ghost btn-sm" aria-label="Download file ${_esc(a.FileName)}">DL</a>
      </div>
    </div>`;
  }).join('');
}

function _renderNavBar() {
  const total   = _queue.length;
  const current = _queueIdx + 1;
  _el('rv-nav-counter').innerHTML = `Task <strong>${current}</strong> of <strong>${total}</strong>`;
  _el('rv-prev-btn').disabled = _queueIdx === 0;
  _el('rv-next-btn').disabled = _queueIdx === total - 1;
}

function _updateQuickActions() {
  const pinBtn = _el('rv-qa-pin');
  if (_task?.IsPinned === 'TRUE') {
    pinBtn.querySelector('.rv-action-label').textContent = 'Unpin Task';
    pinBtn.querySelector('.rv-action-icon').textContent  = '📍';
  } else {
    pinBtn.querySelector('.rv-action-label').textContent = 'Pin Task';
    pinBtn.querySelector('.rv-action-icon').textContent  = '📌';
  }

  const approveBtn = _el('rv-qa-approve');
  if (_task?.Status === 'REVIEW') {
    approveBtn.querySelector('.rv-action-label').textContent = 'Mark Completed';
  } else {
    approveBtn.querySelector('.rv-action-label').textContent = 'Mark Reviewed';
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// F — EVENT WIRING
// ═════════════════════════════════════════════════════════════════════════════

let _eventsWired = false;

function _wireEvents() {
  if (_eventsWired) return;
  _eventsWired = true;

  // ── Back / Exit ───────────────────────────────────────────────────────
  _on('rv-back-btn', 'click', closeReview);

  // ── Theme toggle ─────────────────────────────────────────────────────
  _on('rv-theme-btn', 'click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next   = isDark ? 'light' : 'dark';
    window.ui?.applyTheme(next);
    _syncThemeIcon();
  });

  // ── Tabs ─────────────────────────────────────────────────────────────
  document.querySelectorAll('.rv-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      _switchTab(tab);
    });
  });

  // ── Navigation ───────────────────────────────────────────────────────
  _on('rv-prev-btn', 'click', () => _navigateQueue(-1));
  _on('rv-next-btn', 'click', () => _navigateQueue(1));

  // ── Keyboard ─────────────────────────────────────────────────────────
  document.addEventListener('keydown', _handleKeyboard);

  // ── Send comment ─────────────────────────────────────────────────────
  _on('rv-send-btn', 'click', _sendComment);
  _on('rv-comment-box', 'keydown', e => {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); _sendComment(); }
  });

  // ── Quick Actions ─────────────────────────────────────────────────────
  _on('rv-qa-approve',   'click', _qaApprove);
  _on('rv-qa-direction', 'click', _qaDirection);
  _on('rv-qa-reminder',  'click', _qaReminder);
  _on('rv-qa-pin',       'click', _qaPin);
  _on('rv-qa-email',     'click', _qaEmail);

  // ── File upload zone ──────────────────────────────────────────────────
  const zone  = _el('rv-upload-zone');
  const input = _el('rv-upload-input');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    _handleFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', () => _handleFiles(input.files));

  // Comment attach button
  _on('rv-attach-comment-btn', 'click', () => {
    _switchTab('attachments');
    _el('rv-upload-input').click();
  });

  // ── AI generate ───────────────────────────────────────────────────────
  _on('rv-ai-gen-btn', 'click', _generateAISummary);

  // ── Email modal ───────────────────────────────────────────────────────
  _on('rv-email-close',   'click', _closeEmailModal);
  _on('rv-email-cancel',  'click', _closeEmailModal);
  _on('rv-email-send-btn','click', _sendEmailToDepth);
}

function _handleKeyboard(e) {
  if (!_active) return;
  // Don't intercept when typing in comment box or input
  const tag = document.activeElement?.tagName;
  const inEditable = document.activeElement?.isContentEditable;
  if (['INPUT','TEXTAREA','SELECT'].includes(tag) || inEditable) {
    if (e.key === 'Escape') { document.activeElement.blur(); }
    return;
  }

  if (e.key === 'Escape')       closeReview();
  if (e.key === 'ArrowRight')   _navigateQueue(1);
  if (e.key === 'ArrowLeft')    _navigateQueue(-1);
}

function _switchTab(tab) {
  _activeTab = tab;
  document.querySelectorAll('.rv-tab').forEach(b => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active);
  });
  document.querySelectorAll('.rv-tab-content').forEach(el => {
    el.classList.toggle('active', el.id === `rv-tab-${tab}`);
  });
}

async function _navigateQueue(dir) {
  const next = _queueIdx + dir;
  if (next < 0 || next >= _queue.length) return;
  _queueIdx = next;
  await _loadTask(_queue[_queueIdx]);
  // Update URL hash silently
  const taskID = _queue[_queueIdx].TaskID;
  history.replaceState(null, '', `#review/${taskID}`);
}


// ═════════════════════════════════════════════════════════════════════════════
// G — COMMENT SUBMIT
// ═════════════════════════════════════════════════════════════════════════════

async function _sendComment() {
  const box  = _el('rv-comment-box');
  const cat  = _el('rv-cat-select');
  const btn  = _el('rv-send-btn');

  const content  = (box.textContent || '').trim();
  const category = cat?.value || 'General Observation';

  if (!content) { window.ui?.toast('Comment', 'Please type a comment first.', 'warning'); return; }
  if (!_task?.TaskID) return;

  btn.disabled = true;
  btn.textContent = '…';

  try {
    const result = await window.api('addComment', {
      taskID:   _task.TaskID,
      content,
      category,
    });

    // Optimistic UI — add comment locally
    const session = window.store?.session;
    const newComment = {
      CommentID:  result?.commentID || 'new-' + Date.now(),
      TaskID:     _task.TaskID,
      AuthorID:   session?.userID   || '',
      AuthorName: session?.fullName || session?.email || 'You',
      AuthorRole: session?.role     || '',
      Content:    content,
      Category:   category,
      Timestamp:  new Date().toISOString(),
      IsEdited:   'FALSE',
      ReadBy:     session?.userID || '',
    };

    _comments.push(newComment);
    _renderComments();
    _renderTimeline();

    // Scroll to bottom
    const list = _el('rv-comments-list');
    if (list) list.scrollTop = list.scrollHeight;

    // Clear input
    box.textContent = '';
    window.ui?.toast('Comment Posted', category + ' added to ' + _task.TaskID, 'success', 2500);

    // Update comment badge
    const badge = _el('rv-comment-count');
    if (badge) badge.textContent = _comments.length;

  } catch (err) {
    window.ui?.toast('Error', err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Post <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// H — FILE UPLOAD
// ═════════════════════════════════════════════════════════════════════════════

const ALLOWED_EXTS = ['pdf','docx','xlsx','png','jpg','jpeg','zip'];
const MAX_BYTES    = 10 * 1024 * 1024;

/**
 * Processes a FileList for upload — validates, encodes, uploads sequentially.
 * @param {FileList} files
 */
async function _handleFiles(files) {
  if (!files || !files.length) return;

  const progress  = _el('rv-upload-progress');
  const bar       = _el('rv-upload-bar');
  const statusEl  = _el('rv-upload-status');

  progress.classList.add('visible');

  let uploaded = 0;
  const total  = files.length;

  for (const file of Array.from(files)) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) {
      window.ui?.toast('Invalid File', `".${ext}" files are not allowed.`, 'warning');
      continue;
    }
    if (file.size > MAX_BYTES) {
      window.ui?.toast('File Too Large', `${file.name} exceeds 10 MB.`, 'warning');
      continue;
    }
    if (file.size === 0) {
      window.ui?.toast('Empty File', `${file.name} is empty.`, 'warning');
      continue;
    }

    statusEl.textContent = `Uploading ${file.name}…`;

    try {
      const base64 = await _readFileAsBase64(file);

      // Simulate progress (real progress requires XHR, not fetch)
      bar.style.width = '30%';

      const result = await window.api('uploadFile', {
        taskID:   _task.TaskID,
        fileName: file.name,
        fileData: base64,
      });

      bar.style.width = Math.round(((uploaded + 1) / total) * 100) + '%';

      // Add to local list
      _attachments.push({
        AttachmentID:  result?.attachmentID || 'att-' + Date.now(),
        TaskID:        _task.TaskID,
        CommentID:     '',
        FileName:      file.name,
        FileType:      file.type || 'application/octet-stream',
        FileSizeBytes: String(file.size),
        DriveFileID:   '',
        DriveViewURL:  result?.driveViewURL || '#',
        UploadedBy:    window.store?.session?.userID || '',
        UploadedAt:    new Date().toISOString(),
      });

      _renderAttachments();
      uploaded++;

      window.ui?.toast('Uploaded', file.name + ' uploaded successfully.', 'success', 2500);

    } catch (err) {
      window.ui?.toast('Upload Failed', `${file.name}: ${err.message}`, 'error');
    }
  }

  // Reset progress
  setTimeout(() => {
    progress.classList.remove('visible');
    bar.style.width = '0%';
    const input = _el('rv-upload-input');
    if (input) input.value = '';
  }, 1000);
}

/**
 * Reads a File object as a base64 string.
 * @param {File} file
 * @returns {Promise<string>} Base64-encoded file content (no data-URI prefix).
 */
function _readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => {
      const result = reader.result;
      // Strip the "data:...;base64," prefix
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// I — QUICK ACTIONS
// ═════════════════════════════════════════════════════════════════════════════

async function _qaApprove() {
  if (!_task) return;
  const newStatus = _task.Status === 'REVIEW' ? 'COMPLETED' : 'REVIEW';
  const label     = newStatus === 'COMPLETED' ? 'Mark as Completed' : 'Send to Review';

  const confirmed = await window.ui?.confirm(
    label,
    `Change status of "${_task.Subject}" to ${newStatus}?`,
    label
  );
  if (!confirmed) return;

  try {
    await window.api('updateTask', { taskID: _task.TaskID, status: newStatus });
    _task.Status = newStatus;
    _renderTopbar();
    _renderLeftPanel();
    _updateQuickActions();
    window.ui?.toast('Status Updated', `Task is now ${newStatus}.`, 'success');
  } catch (err) {
    window.ui?.toast('Error', err.message, 'error');
  }
}

function _qaDirection() {
  // Pre-select Direction in the category dropdown and focus the input
  const select = _el('rv-cat-select');
  if (select) select.value = 'Direction';
  _switchTab('comments');
  const box = _el('rv-comment-box');
  if (box) { box.focus(); }
}

async function _qaReminder() {
  if (!_task) return;
  const confirmed = await window.ui?.confirm(
    'Send Reminder',
    `Post an Immediate Attention reminder on task "${_task.Subject}"?`,
    'Send Reminder'
  );
  if (!confirmed) return;

  try {
    const result = await window.api('addComment', {
      taskID:   _task.TaskID,
      content:  'This task requires immediate attention. Please update progress and provide a status report by end of day.',
      category: 'Immediate Attention',
    });
    window.ui?.toast('Reminder Sent', 'Immediate Attention posted.', 'success');
    // Reload comments
    const updated = await window.api('getComments', { taskID: _task.TaskID });
    _comments = updated || _comments;
    _renderComments();
  } catch (err) {
    window.ui?.toast('Error', err.message, 'error');
  }
}

async function _qaPin() {
  if (!_task) return;
  try {
    const result = await window.api('pinTask', { taskID: _task.TaskID });
    _task.IsPinned = result?.isPinned ? 'TRUE' : 'FALSE';
    _renderTopbar();
    _renderLeftPanel();
    _updateQuickActions();
    window.ui?.toast(
      result?.isPinned ? 'Task Pinned' : 'Task Unpinned',
      result?.isPinned ? 'Task is now pinned to the dashboard.' : 'Task removed from pinned.',
      'success', 2500
    );
  } catch (err) {
    window.ui?.toast('Error', err.message, 'error');
  }
}

function _qaEmail() {
  if (!_task) return;
  // Pre-fill email composer
  _el('rv-email-to').value      = _task.AssignedDepts
    ? `HOD(s) of: ${_task.AssignedDepts.split(',').join(', ')}`
    : '—';
  _el('rv-email-subject').value = `[DRISHTI Action Required] Task ${_task.TaskID}: ${_task.Subject}`;
  _el('rv-email-body').value    =
    `Dear Department Head,\n\n` +
    `This communication pertains to Task ${_task.TaskID}: "${_task.Subject}".\n\n` +
    `Current Status: ${_task.Status}\n` +
    `Due Date: ${_fmtDate(_task.DueDate)}\n` +
    `Progress: ${_task.ProgressPercent || 0}%\n\n` +
    `Please provide an update at your earliest convenience.\n\n` +
    `Regards,\nChief Secretary's Office\nGovernment of Sikkim`;

  document.getElementById('rv-email-modal').classList.add('open');
}

function _closeEmailModal() {
  document.getElementById('rv-email-modal').classList.remove('open');
  _el('rv-email-error').classList.remove('visible');
}

async function _sendEmailToDepth() {
  const subject = (_el('rv-email-subject').value || '').trim();
  const body    = (_el('rv-email-body').value    || '').trim();
  const errEl   = _el('rv-email-error');
  const sendBtn = _el('rv-email-send-btn');

  errEl.classList.remove('visible');
  if (!subject) { errEl.textContent = 'Subject is required.'; errEl.classList.add('visible'); return; }
  if (!body)    { errEl.textContent = 'Message body is required.'; errEl.classList.add('visible'); return; }

  sendBtn.disabled   = true;
  sendBtn.textContent = 'Posting…';

  try {
    // Post a Direction comment that embeds the direction context
    await window.api('addComment', {
      taskID:   _task.TaskID,
      content:  `DIRECTION TO DEPARTMENT:\nSubject: ${subject}\n\n${body}`,
      category: 'Direction',
    });
    _closeEmailModal();
    window.ui?.toast('Direction Posted', 'Direction posted to department.', 'success');
    // Reload comments
    const updated = await window.api('getComments', { taskID: _task.TaskID });
    _comments = updated || _comments;
    _renderComments();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.add('visible');
  } finally {
    sendBtn.disabled    = false;
    sendBtn.innerHTML   = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Post Direction';
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// J — AI SUMMARY
// ═════════════════════════════════════════════════════════════════════════════

async function _generateAISummary() {
  const btn    = _el('rv-ai-gen-btn');
  const output = _el('rv-ai-output');

  btn.disabled    = true;
  btn.textContent = '✦ Generating…';
  output.innerHTML = `
    <div class="rv-typing-indicator" aria-live="polite" aria-label="AI is generating summary">
      <div class="rv-typing-dots">
        <div class="rv-typing-dot"></div>
        <div class="rv-typing-dot"></div>
        <div class="rv-typing-dot"></div>
      </div>
      <span>AI is summarising this task…</span>
    </div>`;

  try {
    const result = await window.api('generateTaskSummary', { taskID: _task.TaskID });
    const summary = result?.summary || 'No summary generated.';

    output.innerHTML = `
      <div class="rv-ai-summary-box" aria-label="AI-generated task summary">
        ${_esc(summary).replace(/\n/g, '<br/>')}
      </div>
      <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:var(--space-2);">
        Tokens used: ${result?.tokensUsed || '—'} · Powered by Groq llama3-70b-8192
      </div>`;
  } catch (err) {
    output.innerHTML = `<div style="color:var(--color-danger);font-size:var(--font-sm);">${_esc(err.message)}</div>`;
    window.ui?.toast('AI Error', err.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = '✦ Regenerate Summary';
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// K — HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/** @param {string} id @returns {HTMLElement} */
function _el(id) { return document.getElementById(id); }

/** @param {string} id @param {string} ev @param {Function} fn */
function _on(id, ev, fn) { _el(id)?.addEventListener(ev, fn); }

/** Escapes HTML entities */
function _esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** Formats ISO date */
function _fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }); }
  catch { return iso; }
}

/** Formats ISO time */
function _fmtTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12: true }); }
  catch { return ''; }
}

/** Formats status enum to display label */
function _fmtStatus(st) {
  const m = { PENDING:'Pending', IN_PROGRESS:'In Progress', REVIEW:'Under Review',
               COMPLETED:'Completed', OVERDUE:'Overdue', DEFERRED:'Deferred' };
  return m[st] || st || '—';
}

/** Formats bytes to human-readable */
function _fmtBytes(n) {
  if (n >= 1048576) return (n/1048576).toFixed(1) + ' MB';
  if (n >= 1024)    return (n/1024).toFixed(0) + ' KB';
  return n + ' B';
}

/** Maps comment category to CSS class */
function _catClass(cat) {
  const m = {
    'General Observation': 'rv-cat-observation',
    'Direction':           'rv-cat-direction',
    'Immediate Attention': 'rv-cat-attention',
    'Appreciation':        'rv-cat-appreciation',
    'Reminder':            'rv-cat-reminder',
  };
  return m[cat] || 'rv-cat-observation';
}

/** Maps comment category to icon */
function _catIcon(cat) {
  const m = {
    'General Observation': 'ℹ',
    'Direction':           '→',
    'Immediate Attention': '!',
    'Appreciation':        '★',
    'Reminder':            '⏰',
  };
  return m[cat] || 'ℹ';
}

/** Maps file extension to emoji icon */
function _fileIcon(ext) {
  const m = { pdf:'📄', docx:'📝', xlsx:'📊', png:'🖼', jpg:'🖼', jpeg:'🖼', zip:'🗜', default:'📎' };
  return m[ext] || m.default;
}

/** Syncs the theme toggle icon in Review Mode topbar */
function _syncThemeIcon() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const sun  = document.getElementById('rv-sun');
  const moon = document.getElementById('rv-moon');
  if (sun)  sun.style.display  = isDark ? 'none' : '';
  if (moon) moon.style.display = isDark ? ''     : 'none';
}


// ═════════════════════════════════════════════════════════════════════════════
// L — VIEW-CHANGE LISTENER & QUEUE BUILDER
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Builds the review queue by fetching tasks and opens Review Mode.
 * Called when the router navigates to #review or #review/TASK_ID.
 * @param {string|null} paramTaskID - Optional direct task ID from URL.
 */
async function _initReview(paramTaskID) {
  // Only CS and Admin may enter review mode
  const role = window.store?.session?.role;
  if (!['Chief Secretary', 'Super Admin'].includes(role)) {
    window.ui?.toast('Access Denied', 'Review Mode is for Chief Secretary and Super Admin only.', 'error');
    window.router?.navigate('dashboard');
    return;
  }

  // Use cached queue if still valid; otherwise fetch fresh
  let queue = _queue;
  if (!queue.length) {
    try {
      // Default queue: non-archived tasks sorted by due date
      const result = await window.api('getTasks', {
        sortBy:    'dueDate',
        sortOrder: 'asc',
        pageSize:  100,
      });
      queue = result?.tasks || [];
    } catch (err) {
      window.ui?.toast('Review Mode', 'Could not load task queue: ' + err.message, 'error');
      return;
    }
  }

  await openReview(queue, paramTaskID);
}

// Listen for route change to #review
document.addEventListener('drishti:viewchange', async (e) => {
  const { view, param } = e.detail;
  if (view === 'review') {
    // Hide the normal view panel (we use the overlay instead)
    const panel = document.getElementById('view-review');
    if (panel) panel.innerHTML = ''; // Clear placeholder content
    await _initReview(param || null);
  } else {
    // Close review overlay when navigating away
    if (_active) {
      const overlay = document.getElementById('rv-overlay');
      if (overlay) overlay.classList.remove('open');
      _active = false;
      document.body.style.overflow = '';
    }
  }
});

// Listen for appready in case the page loads directly on #review
document.addEventListener('drishti:appready', () => {
  const hash = window.location.hash.replace('#', '');
  if (hash.startsWith('review')) {
    const parts  = hash.split('/');
    const taskID = parts[1] || null;
    _initReview(taskID);
  }
});

/**
 * Allows external modules (e.g. dashboard.js) to set the review queue
 * before navigating to #review, so the user enters Review Mode already
 * scoped to the right set of tasks (e.g. overdue, critical, pinned).
 *
 * Usage:
 *   window.setReviewQueue(tasks);
 *   window.router.navigate('review', { taskID: tasks[0].TaskID });
 *
 * @param {Object[]} tasks - Ordered array of task objects.
 */
window.setReviewQueue = function(tasks) {
  _queue    = tasks || [];
  _queueIdx = 0;
};
