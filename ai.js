/**
 * DRISHTI — AI Assistant (Groq Integration — Frontend)
 * File: ai.js
 *
 * Loaded by index.html as <script type="module" src="ai.js">.
 * Handles the complete AI Assistant UI for routes #ai and #ai/brief.
 *
 * Architecture & Security:
 *   - The Groq API key NEVER touches the frontend.
 *   - All AI calls go through window.api('aiQuery'|'generateDailyBrief'|
 *     'generateTaskSummary') → Apps Script doPost → Groq API.
 *   - Conversation history is stored in sessionStorage only (cleared on
 *     tab close / logout). It is never sent to the server except as context
 *     for the current query.
 *
 * Routes:
 *   #ai        — Main AI Assistant chat interface
 *   #ai/brief  — Full-screen printable Daily Brief
 *
 * Dependencies (window globals from index.html showApp()):
 *   window.api(action, payload)
 *   window.ui.toast / confirm / _esc
 *   window.router.navigate
 *   window.store.session
 *
 * marked.js is loaded lazily from CDN on first use.
 *
 * @version 7.0.0
 * @module  AI Assistant
 */

'use strict';

// ═════════════════════════════════════════════════════════════════════════════
// A — CONSTANTS & STATE
// ═════════════════════════════════════════════════════════════════════════════

const MARKED_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js';

/** sessionStorage key for conversation history */
const CONV_KEY = 'drishti_ai_conversation';

/** Max conversation entries to keep in memory (older ones are trimmed) */
const MAX_HISTORY = 50;

/**
 * Rough token estimate per character for the context panel display.
 * OpenAI / Groq approximate: 1 token ≈ 4 characters.
 */
const CHARS_PER_TOKEN = 4;

/** @type {Array<{role:'user'|'assistant', content:string, timestamp:string, context:string}>} */
let _conversation = [];

/** @type {string} Active context toggle: 'tasks' | 'comments' | 'analytics' */
let _context = 'tasks';

/** @type {boolean} Whether a request is in flight */
let _loading = false;

/** @type {boolean} CSS injected flag */
let _cssInjected = false;

/** @type {Promise|null} marked.js load promise */
let _markedReady = null;

/** @type {Object|null} Last daily brief data for the brief view */
let _lastBrief = null;

/** Pre-built prompt chips shown in the chat */
const PROMPT_CHIPS = [
  { label: '📋 Executive Brief',          query: 'Generate today\'s executive brief with all critical tasks, overdue items, and department momentum.' },
  { label: '⚠ Highest Overdue Rate',      query: 'Which departments have the highest overdue task rate? List them with percentages.' },
  { label: '📅 Tasks This Month',          query: 'Summarise all tasks assigned this month — by department, priority, and completion status.' },
  { label: '🔴 Critical Tasks This Week', query: 'Show all critical priority tasks due this week with their current status and responsible officers.' },
  { label: '😴 Inactive Tasks (7 days)',   query: 'Which tasks have had no activity — no comments, no progress updates — in the last 7 days?' },
  { label: '🗓 Meeting Agenda Tomorrow',   query: 'Generate a structured meeting agenda for tomorrow based on overdue tasks and upcoming deadlines.' },
];

// ═════════════════════════════════════════════════════════════════════════════
// B — CSS INJECTION
// ═════════════════════════════════════════════════════════════════════════════

function injectAICSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const s = document.createElement('style');
  s.id = 'ai-styles';
  s.textContent = `
  /* ═══════════════════════════════════════════════════════════════
     AI ASSISTANT — MAIN LAYOUT
  ═══════════════════════════════════════════════════════════════ */
  #ai-shell {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: 0;
    height: calc(100vh - var(--topbar-height));
    overflow: hidden;
    background: var(--color-bg);
  }

  /* ── LEFT: Chat panel ───────────────────────────────────────── */
  #ai-chat-panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--color-surface);
    border-right: 1px solid var(--color-border);
  }

  /* Chat header */
  .ai-chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
    flex-shrink: 0;
  }
  .ai-chat-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-base);
    font-weight: 700;
    color: var(--color-text-primary);
  }
  .ai-spark {
    color: var(--color-accent);
    font-size: 1.2rem;
    animation: ai-pulse 2.5s ease-in-out infinite;
  }
  @keyframes ai-pulse {
    0%, 100% { opacity: 1;   transform: scale(1); }
    50%       { opacity: 0.6; transform: scale(0.92); }
  }
  .ai-model-badge {
    font-size: 0.65rem;
    font-weight: 600;
    background: rgba(201,168,76,0.12);
    color: var(--color-accent-dark);
    border: 1px solid rgba(201,168,76,0.25);
    padding: 2px 8px;
    border-radius: var(--radius-full);
    letter-spacing: 0.04em;
  }

  /* Chip bar */
  .ai-chip-bar {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5);
    overflow-x: auto;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface-2);
    flex-shrink: 0;
    scrollbar-width: none;
  }
  .ai-chip-bar::-webkit-scrollbar { display: none; }
  .ai-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    font-size: var(--font-xs);
    font-weight: 600;
    color: var(--color-text-primary);
    cursor: pointer;
    white-space: nowrap;
    transition: all var(--transition);
    font-family: inherit;
    flex-shrink: 0;
  }
  .ai-chip:hover {
    border-color: var(--color-primary-light);
    background: rgba(42,95,158,0.06);
    color: var(--color-primary);
  }
  .ai-chip:active { transform: scale(0.97); }

  /* Message list */
  #ai-messages {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) transparent;
  }
  #ai-messages::-webkit-scrollbar { width: 5px; }
  #ai-messages::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 3px; }

  /* Welcome state */
  .ai-welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    text-align: center;
    padding: var(--space-8);
    color: var(--color-text-secondary);
    gap: var(--space-4);
    animation: fadeIn 0.4s ease;
  }
  .ai-welcome-icon {
    width: 72px;
    height: 72px;
    background: linear-gradient(135deg, rgba(201,168,76,0.15), rgba(42,95,158,0.15));
    border: 1px solid rgba(201,168,76,0.25);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2rem;
  }
  .ai-welcome-title {
    font-size: var(--font-xl);
    font-weight: 800;
    color: var(--color-text-primary);
  }
  .ai-welcome-sub {
    font-size: var(--font-sm);
    max-width: 380px;
    line-height: 1.6;
  }

  /* Message bubbles */
  .ai-msg {
    display: flex;
    flex-direction: column;
    gap: 4px;
    animation: fadeIn 0.25s ease backwards;
  }
  .ai-msg.user  { align-items: flex-end; }
  .ai-msg.ai    { align-items: flex-start; }

  .ai-bubble {
    max-width: 82%;
    padding: var(--space-4) var(--space-5);
    border-radius: var(--radius-md);
    line-height: 1.65;
    font-size: var(--font-sm);
    word-break: break-word;
  }
  .ai-msg.user .ai-bubble {
    background: var(--color-primary);
    color: #fff;
    border-radius: var(--radius-md) var(--radius-xs) var(--radius-md) var(--radius-md);
  }
  .ai-msg.ai .ai-bubble {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    color: var(--color-text-primary);
    border-radius: var(--radius-xs) var(--radius-md) var(--radius-md) var(--radius-md);
  }

  /* Markdown content inside AI bubbles */
  .ai-bubble h1,.ai-bubble h2,.ai-bubble h3 {
    font-weight: 700;
    color: var(--color-text-primary);
    margin: var(--space-3) 0 var(--space-2);
    line-height: 1.3;
  }
  .ai-bubble h1 { font-size: var(--font-lg); }
  .ai-bubble h2 { font-size: var(--font-base); }
  .ai-bubble h3 { font-size: var(--font-sm); }
  .ai-bubble p  { margin: 0 0 var(--space-3); }
  .ai-bubble p:last-child { margin-bottom: 0; }
  .ai-bubble ul,.ai-bubble ol {
    padding-left: var(--space-5);
    margin: var(--space-2) 0 var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .ai-bubble ul { list-style: disc; }
  .ai-bubble ol { list-style: decimal; }
  .ai-bubble li { font-size: var(--font-sm); line-height: 1.5; }
  .ai-bubble strong { font-weight: 700; color: var(--color-text-primary); }
  .ai-bubble code {
    background: rgba(0,0,0,0.08);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 0.85em;
    font-family: 'Courier New', monospace;
  }
  .ai-msg.user .ai-bubble code { background: rgba(255,255,255,0.15); }
  .ai-bubble pre {
    background: rgba(0,0,0,0.06);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    overflow-x: auto;
    margin: var(--space-2) 0;
  }
  .ai-bubble pre code { background: none; padding: 0; }
  .ai-bubble table {
    width: 100%; border-collapse: collapse;
    font-size: var(--font-xs); margin: var(--space-3) 0;
  }
  .ai-bubble th,.ai-bubble td {
    border: 1px solid var(--color-border);
    padding: 4px 8px; text-align: left;
  }
  .ai-bubble th { background: var(--color-surface-3); font-weight: 700; }
  .ai-bubble blockquote {
    border-left: 3px solid var(--color-accent);
    padding-left: var(--space-3);
    margin: var(--space-2) 0;
    color: var(--color-text-secondary);
    font-style: italic;
  }

  /* Message meta row */
  .ai-msg-meta {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: 0.65rem;
    color: var(--color-text-muted);
    padding: 0 var(--space-1);
  }
  .ai-msg.user .ai-msg-meta { flex-direction: row-reverse; }
  .ai-msg-actions { display: flex; gap: var(--space-2); }
  .ai-icon-action {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-muted);
    font-size: 0.8rem;
    padding: 2px 6px;
    border-radius: var(--radius-xs);
    transition: color var(--transition), background var(--transition);
    display: flex;
    align-items: center;
    gap: 3px;
    font-family: inherit;
  }
  .ai-icon-action:hover { color: var(--color-text-primary); background: var(--color-surface-2); }
  .ai-icon-action.copied { color: var(--color-success); }

  /* Typing indicator */
  .ai-typing-wrap {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    animation: fadeIn 0.2s ease;
  }
  .ai-typing-avatar {
    width: 28px; height: 28px;
    background: linear-gradient(135deg, var(--color-primary), var(--color-primary-light));
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.8rem;
    color: var(--color-accent);
    flex-shrink: 0;
    font-weight: 700;
  }
  .ai-typing-bubble {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xs) var(--radius-md) var(--radius-md) var(--radius-md);
    padding: var(--space-3) var(--space-4);
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .ai-dot {
    width: 7px; height: 7px;
    background: var(--color-text-muted);
    border-radius: 50%;
    animation: ai-dot-bounce 1.3s ease-in-out infinite;
  }
  .ai-dot:nth-child(2) { animation-delay: 0.18s; }
  .ai-dot:nth-child(3) { animation-delay: 0.36s; }
  @keyframes ai-dot-bounce {
    0%,60%,100% { transform: translateY(0);    opacity: 0.5; }
    30%          { transform: translateY(-6px); opacity: 1;   }
  }

  /* Input bar */
  #ai-input-bar {
    flex-shrink: 0;
    border-top: 1px solid var(--color-border);
    background: var(--color-surface);
    padding: var(--space-4) var(--space-5);
  }
  .ai-input-wrap {
    display: flex;
    align-items: flex-end;
    gap: var(--space-3);
    background: var(--color-surface-2);
    border: 1.5px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
    transition: border-color var(--transition), box-shadow var(--transition);
  }
  .ai-input-wrap:focus-within {
    border-color: var(--color-border-focus);
    box-shadow: 0 0 0 3px rgba(42,95,158,0.1);
  }
  #ai-query-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: var(--font-sm);
    font-family: inherit;
    color: var(--color-text-primary);
    resize: none;
    line-height: 1.55;
    max-height: 120px;
    scrollbar-width: thin;
    min-height: 24px;
  }
  #ai-query-input::placeholder { color: var(--color-text-muted); }
  .ai-send-btn {
    background: var(--color-primary);
    border: none;
    border-radius: var(--radius-sm);
    width: 36px; height: 36px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    color: #fff;
    transition: background var(--transition), transform var(--transition);
    flex-shrink: 0;
  }
  .ai-send-btn:hover:not(:disabled) { background: var(--color-primary-light); }
  .ai-send-btn:active:not(:disabled) { transform: scale(0.94); }
  .ai-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .ai-input-hint {
    font-size: 0.62rem;
    color: var(--color-text-muted);
    text-align: right;
    margin-top: var(--space-2);
  }

  /* ── RIGHT: Context panel ───────────────────────────────────── */
  #ai-context-panel {
    display: flex;
    flex-direction: column;
    background: var(--color-surface-2);
    border-left: 1px solid var(--color-border);
    overflow-y: auto;
    scrollbar-width: thin;
  }
  .ai-ctx-section {
    padding: var(--space-5);
    border-bottom: 1px solid var(--color-border);
  }
  .ai-ctx-label {
    font-size: var(--font-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--color-text-muted);
    margin-bottom: var(--space-3);
  }

  /* Context toggles */
  .ai-ctx-toggles { display: flex; flex-direction: column; gap: var(--space-2); }
  .ai-ctx-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: 1.5px solid var(--color-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all var(--transition);
    font-size: var(--font-sm);
    font-weight: 600;
    color: var(--color-text-secondary);
    font-family: inherit;
    text-align: left;
  }
  .ai-ctx-toggle:hover { border-color: var(--color-primary-light); color: var(--color-primary); }
  .ai-ctx-toggle.active {
    border-color: var(--color-primary);
    background: rgba(26,58,92,0.06);
    color: var(--color-primary);
  }
  .ai-ctx-toggle-icon { font-size: 0.9rem; }

  /* Token estimate */
  .ai-token-meter {
    margin-top: var(--space-3);
  }
  .ai-token-label {
    display: flex;
    justify-content: space-between;
    font-size: var(--font-xs);
    color: var(--color-text-muted);
    margin-bottom: var(--space-2);
  }
  .ai-token-bar {
    height: 5px;
    background: var(--color-surface-3);
    border-radius: var(--radius-full);
    overflow: hidden;
  }
  .ai-token-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--color-success), var(--color-warning));
    border-radius: var(--radius-full);
    transition: width 0.4s ease;
  }
  .ai-token-fill.near-limit { background: linear-gradient(90deg, var(--color-warning), var(--color-danger)); }

  /* Conversation stats */
  .ai-conv-stat {
    display: flex;
    justify-content: space-between;
    font-size: var(--font-xs);
    color: var(--color-text-secondary);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-border);
  }
  .ai-conv-stat:last-child { border-bottom: none; }
  .ai-conv-stat-val { font-weight: 700; color: var(--color-text-primary); }

  /* ═══════════════════════════════════════════════════════════════
     DAILY BRIEF VIEW
  ═══════════════════════════════════════════════════════════════ */
  #ai-brief-overlay {
    position: fixed;
    inset: 0;
    z-index: 6500;
    background: var(--color-bg);
    display: flex;
    flex-direction: column;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.25s ease, visibility 0.25s ease;
    overflow-y: auto;
  }
  #ai-brief-overlay.open { opacity: 1; visibility: visible; }

  .brief-topbar {
    position: sticky;
    top: 0;
    background: var(--color-primary);
    padding: var(--space-3) var(--space-6);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    z-index: 1;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    flex-shrink: 0;
  }
  .brief-topbar-title {
    color: var(--color-accent);
    font-weight: 800;
    font-size: var(--font-base);
    letter-spacing: 0.05em;
  }
  .brief-topbar-actions { display: flex; gap: var(--space-3); }

  .brief-body {
    max-width: 900px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-6);
    width: 100%;
  }

  /* Brief cover */
  .brief-cover {
    text-align: center;
    margin-bottom: var(--space-8);
    padding-bottom: var(--space-8);
    border-bottom: 2px solid var(--color-accent);
  }
  .brief-seal {
    width: 72px; height: 72px;
    object-fit: contain;
    margin: 0 auto var(--space-4);
    filter: brightness(0) saturate(100%) invert(15%) sepia(50%) saturate(400%) hue-rotate(190deg);
  }
  .brief-title {
    font-size: var(--font-2xl);
    font-weight: 900;
    color: var(--color-primary);
    letter-spacing: 0.08em;
    margin-bottom: var(--space-2);
  }
  .brief-subtitle {
    font-size: var(--font-sm);
    color: var(--color-text-secondary);
  }
  .brief-date {
    font-size: var(--font-lg);
    font-weight: 700;
    color: var(--color-accent-dark);
    margin-top: var(--space-3);
  }

  /* Brief section */
  .brief-section {
    margin-bottom: var(--space-8);
    animation: fadeIn 0.3s ease backwards;
  }
  .brief-section-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--color-border);
  }
  .brief-section-num {
    width: 28px; height: 28px;
    background: var(--color-primary);
    color: #fff;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: var(--font-xs);
    font-weight: 800;
    flex-shrink: 0;
  }
  .brief-section-title {
    font-size: var(--font-lg);
    font-weight: 800;
    color: var(--color-text-primary);
  }

  /* KPI row in brief */
  .brief-kpi-row {
    display: grid;
    grid-template-columns: repeat(4,1fr);
    gap: var(--space-4);
  }
  .brief-kpi {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    text-align: center;
    box-shadow: var(--shadow-xs);
  }
  .brief-kpi-val {
    font-size: var(--font-2xl);
    font-weight: 900;
    color: var(--color-primary);
    line-height: 1;
    margin-bottom: 4px;
  }
  .brief-kpi-label { font-size: var(--font-xs); color: var(--color-text-secondary); }

  /* Attention list */
  .brief-attention-item {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    margin-bottom: var(--space-3);
    border-left: 4px solid var(--color-danger);
  }
  .brief-attention-item.high { border-left-color: var(--color-warning); }
  .brief-task-id {
    font-family: monospace;
    font-size: var(--font-xs);
    font-weight: 700;
    color: var(--color-primary-light);
    flex-shrink: 0;
  }
  .brief-task-subject {
    font-size: var(--font-sm);
    font-weight: 600;
    color: var(--color-text-primary);
    flex: 1; min-width: 0;
  }

  /* Dept momentum table */
  .brief-dept-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-sm);
    background: var(--color-surface);
    border-radius: var(--radius-md);
    overflow: hidden;
    box-shadow: var(--shadow-xs);
  }
  .brief-dept-table th {
    background: var(--color-primary);
    color: #fff;
    font-size: var(--font-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: var(--space-3) var(--space-4);
    text-align: left;
  }
  .brief-dept-table td {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    vertical-align: middle;
  }
  .brief-dept-table tr:last-child td { border-bottom: none; }

  /* AI observations section */
  .brief-ai-obs {
    background: linear-gradient(135deg, rgba(26,58,92,0.04), rgba(201,168,76,0.04));
    border: 1px solid rgba(201,168,76,0.25);
    border-radius: var(--radius-md);
    padding: var(--space-6);
    font-size: var(--font-sm);
    line-height: 1.8;
    color: var(--color-text-primary);
    white-space: pre-wrap;
    position: relative;
  }
  .brief-ai-obs::before {
    content: '"';
    position: absolute;
    top: -8px; left: 16px;
    font-size: 3rem;
    color: var(--color-accent);
    font-family: Georgia, serif;
    line-height: 1;
  }

  /* Brief loading state */
  .brief-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-12);
    gap: var(--space-4);
    color: var(--color-text-secondary);
  }

  /* Print styles */
  @media print {
    #ai-brief-overlay .brief-topbar { display: none; }
    #ai-brief-overlay { position: static; overflow: visible; }
    .brief-body { padding: 0; }
    .brief-section { break-inside: avoid; }
  }

  /* ═══════════════════════════════════════════════════════════════
     NOTES PANEL
  ═══════════════════════════════════════════════════════════════ */
  #ai-notes-overlay {
    position: fixed;
    top: 0; right: 0; bottom: 0;
    width: 400px;
    background: var(--color-surface);
    border-left: 1px solid var(--color-border);
    box-shadow: var(--shadow-xl);
    z-index: 6200;
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    transition: transform var(--transition-slow);
  }
  #ai-notes-overlay.open { transform: translateX(0); }
  .notes-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface-2);
    flex-shrink: 0;
  }
  .notes-header-title { font-weight: 700; font-size: var(--font-base); color: var(--color-text-primary); }
  #ai-notes-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .note-item {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-4);
    font-size: var(--font-sm);
    border-left: 3px solid var(--color-accent);
    position: relative;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.6;
  }
  .note-meta {
    font-size: var(--font-xs);
    color: var(--color-text-muted);
    margin-top: var(--space-2);
  }
  .note-del {
    position: absolute; top: 8px; right: 8px;
    background: none; border: none; cursor: pointer;
    color: var(--color-text-muted); font-size: 0.9rem;
    padding: 2px 5px; border-radius: 3px;
    transition: color var(--transition), background var(--transition);
  }
  .note-del:hover { color: var(--color-danger); background: var(--color-danger-light); }

  /* ═══════════════════════════════════════════════════════════════
     RESPONSIVE
  ═══════════════════════════════════════════════════════════════ */
  @media (max-width: 1024px) {
    #ai-shell { grid-template-columns: 1fr; }
    #ai-context-panel { display: none; }
    .brief-kpi-row { grid-template-columns: repeat(2,1fr); }
  }
  @media (max-width: 768px) {
    .brief-kpi-row { grid-template-columns: 1fr 1fr; }
    .brief-body { padding: var(--space-5) var(--space-4); }
    #ai-notes-overlay { width: 100vw; }
  }
  @media (max-width: 480px) {
    .brief-kpi-row { grid-template-columns: 1fr 1fr; }
  }
  `;
  document.head.appendChild(s);
}


// ═════════════════════════════════════════════════════════════════════════════
// C — MARKED.JS LOADER
// ═════════════════════════════════════════════════════════════════════════════

function _loadMarked() {
  if (window.marked) return Promise.resolve(window.marked);
  if (_markedReady) return _markedReady;
  _markedReady = new Promise(function(resolve, reject) {
    const s = document.createElement('script');
    s.src = MARKED_CDN;
    s.async = true;
    s.onload  = function() {
      // Configure marked for safe government-appropriate rendering
      if (window.marked && window.marked.setOptions) {
        window.marked.setOptions({
          breaks:   true,   // line breaks become <br>
          gfm:      true,   // GitHub-flavoured markdown
        });
      }
      resolve(window.marked);
    };
    s.onerror = function() { reject(new Error('marked.js CDN load failed')); };
    document.head.appendChild(s);
  });
  return _markedReady;
}

/**
 * Renders a markdown string to safe HTML using marked.js.
 * Falls back to escaped plain text if marked is unavailable.
 * @param {string} text
 * @returns {string} HTML string
 */
async function _renderMarkdown(text) {
  try {
    const marked = await _loadMarked();
    if (marked && typeof marked.parse === 'function') {
      return marked.parse(String(text || ''));
    }
    if (marked && typeof marked === 'function') {
      return marked(String(text || ''));
    }
  } catch (e) { /* fall through */ }
  // Plain-text fallback: escape and preserve newlines
  return _esc(text).replace(/\n/g, '<br/>');
}


// ═════════════════════════════════════════════════════════════════════════════
// D — SESSION HISTORY MANAGEMENT
// ═════════════════════════════════════════════════════════════════════════════

/** Loads conversation from sessionStorage */
function _loadHistory() {
  try {
    const raw = sessionStorage.getItem(CONV_KEY);
    _conversation = raw ? JSON.parse(raw) : [];
  } catch {
    _conversation = [];
  }
}

/** Saves conversation to sessionStorage */
function _saveHistory() {
  try {
    // Trim to MAX_HISTORY
    if (_conversation.length > MAX_HISTORY) {
      _conversation = _conversation.slice(-MAX_HISTORY);
    }
    sessionStorage.setItem(CONV_KEY, JSON.stringify(_conversation));
  } catch { /* sessionStorage full — fail silently */ }
}

/** Clears conversation history */
function _clearHistory() {
  _conversation = [];
  sessionStorage.removeItem(CONV_KEY);
}

/** Estimates token count for the current context + history */
function _estimateTokens(queryText) {
  const historyText = _conversation.map(function(m) { return m.content; }).join(' ');
  const totalChars  = historyText.length + (queryText || '').length;
  return Math.round(totalChars / CHARS_PER_TOKEN);
}


// ═════════════════════════════════════════════════════════════════════════════
// E — MAIN AI VIEW SCAFFOLD
// ═════════════════════════════════════════════════════════════════════════════

function renderAIView() {
  injectAICSS();

  const panel = document.getElementById('view-ai');
  if (!panel) return;

  _loadHistory();

  // Check role — AI is for CS and Admin only
  const role = window.store?.session?.role;
  if (!['Super Admin', 'Chief Secretary'].includes(role)) {
    panel.innerHTML = `
    <div class="empty-state" style="padding:var(--space-12);">
      <div class="empty-state-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
      </div>
      <div class="empty-state-title">Access Restricted</div>
      <div class="empty-state-desc">The AI Assistant is available to Chief Secretary and Super Admin only.</div>
    </div>`;
    return;
  }

  panel.innerHTML = `
  <div id="ai-shell">

    <!-- LEFT: Chat panel -->
    <div id="ai-chat-panel">

      <!-- Header -->
      <div class="ai-chat-header">
        <div class="ai-chat-title">
          <span class="ai-spark" aria-hidden="true">✦</span>
          DRISHTI AI Assistant
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-3);">
          <span class="ai-model-badge">Groq · llama3-70b</span>
          <button class="btn btn-ghost btn-sm" id="ai-view-brief-btn" aria-label="View Daily Brief">
            📄 Daily Brief
          </button>
          <button class="btn btn-ghost btn-sm" id="ai-notes-btn" aria-label="View saved notes">
            📝 Notes
          </button>
        </div>
      </div>

      <!-- Prompt chips -->
      <div class="ai-chip-bar" role="list" aria-label="Quick prompts">
        ${PROMPT_CHIPS.map(function(chip, i) {
          return `<button class="ai-chip" data-chip-idx="${i}" role="listitem" aria-label="${_esc(chip.label)}">${_esc(chip.label)}</button>`;
        }).join('')}
      </div>

      <!-- Messages -->
      <div id="ai-messages" role="log" aria-live="polite" aria-label="Conversation"></div>

      <!-- Input bar -->
      <div id="ai-input-bar">
        <div class="ai-input-wrap">
          <textarea
            id="ai-query-input"
            placeholder="Ask about tasks, performance, overdue items, directives…"
            rows="1"
            aria-label="AI query input"
            aria-multiline="true"
          ></textarea>
          <button class="ai-send-btn" id="ai-send-btn" aria-label="Send query (Ctrl+Enter)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
        <div class="ai-input-hint">
          Ctrl+Enter to send · Context: <strong id="ai-ctx-label">Tasks</strong> · ~<span id="ai-token-hint">0</span> tokens
        </div>
      </div>

    </div><!-- /#ai-chat-panel -->

    <!-- RIGHT: Context panel -->
    <div id="ai-context-panel" role="complementary" aria-label="AI context settings">

      <div class="ai-ctx-section">
        <div class="ai-ctx-label">Context Source</div>
        <div class="ai-ctx-toggles" role="radiogroup" aria-label="Select AI context">
          <button class="ai-ctx-toggle active" data-ctx="tasks" aria-pressed="true">
            <span>📋 Tasks</span>
            <span class="ai-ctx-toggle-icon">✓</span>
          </button>
          <button class="ai-ctx-toggle" data-ctx="comments" aria-pressed="false">
            <span>💬 Comments</span>
            <span class="ai-ctx-toggle-icon"></span>
          </button>
          <button class="ai-ctx-toggle" data-ctx="analytics" aria-pressed="false">
            <span>📊 Analytics</span>
            <span class="ai-ctx-toggle-icon"></span>
          </button>
        </div>
        <div class="ai-token-meter">
          <div class="ai-token-label">
            <span>Est. Token Usage</span>
            <span id="ai-token-count">0 / 8,192</span>
          </div>
          <div class="ai-token-bar">
            <div class="ai-token-fill" id="ai-token-bar-fill" style="width:0%"></div>
          </div>
        </div>
      </div>

      <div class="ai-ctx-section">
        <div class="ai-ctx-label">Conversation</div>
        <div class="ai-conv-stat">
          <span>Messages</span>
          <span class="ai-conv-stat-val" id="ctx-msg-count">0</span>
        </div>
        <div class="ai-conv-stat">
          <span>AI Responses</span>
          <span class="ai-conv-stat-val" id="ctx-ai-count">0</span>
        </div>
        <div class="ai-conv-stat">
          <span>Session Started</span>
          <span class="ai-conv-stat-val" id="ctx-session-start">—</span>
        </div>
        <button class="btn btn-ghost btn-sm" id="ai-clear-btn" style="width:100%;margin-top:var(--space-3);" aria-label="Clear conversation history">
          🗑 Clear Conversation
        </button>
      </div>

      <div class="ai-ctx-section">
        <div class="ai-ctx-label">Quick Actions</div>
        <div style="display:flex;flex-direction:column;gap:var(--space-2);">
          <button class="btn btn-secondary btn-sm" id="ctx-brief-btn" style="justify-content:flex-start;" aria-label="Generate Daily Brief">
            📄 Generate Daily Brief
          </button>
          <button class="btn btn-secondary btn-sm" id="ctx-export-btn" style="justify-content:flex-start;" aria-label="Export conversation">
            ⬇ Export Conversation
          </button>
        </div>
      </div>

      <div class="ai-ctx-section">
        <div class="ai-ctx-label">AI Model Info</div>
        <div style="font-size:var(--font-xs);color:var(--color-text-muted);line-height:1.6;">
          <div><strong>Model:</strong> llama3-70b-8192</div>
          <div><strong>Provider:</strong> Groq API</div>
          <div><strong>Context:</strong> 8,192 tokens</div>
          <div style="margin-top:var(--space-2);padding:var(--space-2);background:var(--color-surface);border-radius:var(--radius-xs);border:1px solid var(--color-border);">
            🔒 API key secured server-side. Never exposed to frontend.
          </div>
        </div>
      </div>

    </div><!-- /#ai-context-panel -->

  </div><!-- /#ai-shell -->
  `;

  _wireAIEvents();
  _renderMessages();
  _updateContextStats();
}

/** Wires all event handlers in the AI view */
function _wireAIEvents() {
  // Send button
  const sendBtn = document.getElementById('ai-send-btn');
  const input   = document.getElementById('ai-query-input');

  sendBtn?.addEventListener('click', _submitQuery);

  input?.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      _submitQuery();
    }
    // Auto-resize textarea
    setTimeout(function() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    }, 0);
  });

  input?.addEventListener('input', function() {
    _updateTokenHint();
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  // Prompt chips
  document.querySelectorAll('.ai-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      const idx   = parseInt(chip.dataset.chipIdx, 10);
      const query = PROMPT_CHIPS[idx]?.query;
      if (query && input) {
        input.value = query;
        input.dispatchEvent(new Event('input'));
        input.focus();
      }
    });
  });

  // Context toggles
  document.querySelectorAll('.ai-ctx-toggle').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.ai-ctx-toggle').forEach(function(b) {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
        b.querySelector('.ai-ctx-toggle-icon').textContent = '';
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      btn.querySelector('.ai-ctx-toggle-icon').textContent = '✓';
      _context = btn.dataset.ctx;

      // Update the input bar context label
      const labels = { tasks:'Tasks', comments:'Comments', analytics:'Analytics' };
      const ctxLbl = document.getElementById('ai-ctx-label');
      if (ctxLbl) ctxLbl.textContent = labels[_context] || _context;
      _updateTokenHint();
    });
  });

  // Clear conversation
  document.getElementById('ai-clear-btn')?.addEventListener('click', async function() {
    const ok = await window.ui?.confirm('Clear Conversation', 'Remove all messages from this session?', 'Clear All');
    if (!ok) return;
    _clearHistory();
    _renderMessages();
    _updateContextStats();
    window.ui?.toast('Cleared', 'Conversation history cleared.', 'info', 2000);
  });

  // Brief buttons
  document.getElementById('ai-view-brief-btn')?.addEventListener('click', openDailyBrief);
  document.getElementById('ctx-brief-btn')?.addEventListener('click', openDailyBrief);

  // Notes button
  document.getElementById('ai-notes-btn')?.addEventListener('click', _toggleNotes);

  // Export conversation
  document.getElementById('ctx-export-btn')?.addEventListener('click', _exportConversation);
}


// ═════════════════════════════════════════════════════════════════════════════
// F — QUERY SUBMISSION & RESPONSE RENDERING
// ═════════════════════════════════════════════════════════════════════════════

/** Submits the current input as an AI query */
async function _submitQuery() {
  const input = document.getElementById('ai-query-input');
  const query = (input?.value || '').trim();
  if (!query || _loading) return;

  _loading = true;

  // Add user message to conversation
  const userMsg = {
    role:      'user',
    content:   query,
    timestamp: new Date().toISOString(),
    context:   _context,
  };
  _conversation.push(userMsg);
  _saveHistory();

  // Clear input
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }

  // Render user message immediately
  _renderMessages();
  _scrollToBottom();

  // Disable send
  const sendBtn = document.getElementById('ai-send-btn');
  if (sendBtn) sendBtn.disabled = true;

  // Show typing indicator
  _showTyping();

  try {
    const result = await window.api('aiQuery', {
      query:   query,
      context: _context,
    });

    _hideTyping();

    const answer = result?.answer || 'I was unable to generate a response. Please try again.';
    const tokens = result?.tokensUsed || 0;

    const aiMsg = {
      role:      'assistant',
      content:   answer,
      timestamp: new Date().toISOString(),
      context:   _context,
      tokens:    tokens,
    };
    _conversation.push(aiMsg);
    _saveHistory();

    _renderMessages();
    _scrollToBottom();
    _updateContextStats();
    _updateTokenHint();

  } catch (err) {
    _hideTyping();

    const errMsg = {
      role:      'assistant',
      content:   '**Error:** ' + err.message + '\n\nPlease check your connection and try again.',
      timestamp: new Date().toISOString(),
      context:   _context,
      isError:   true,
    };
    _conversation.push(errMsg);
    _saveHistory();

    _renderMessages();
    _scrollToBottom();
    window.ui?.toast('AI Error', err.message, 'error');

  } finally {
    _loading = false;
    if (sendBtn) sendBtn.disabled = false;
    input?.focus();
  }
}

/** Renders the full conversation into #ai-messages */
async function _renderMessages() {
  const container = document.getElementById('ai-messages');
  if (!container) return;

  if (!_conversation.length) {
    container.innerHTML = `
    <div class="ai-welcome" role="status" aria-label="Welcome to DRISHTI AI">
      <div class="ai-welcome-icon" aria-hidden="true">✦</div>
      <div class="ai-welcome-title">DRISHTI AI Assistant</div>
      <div class="ai-welcome-sub">
        Ask me about task progress, overdue directives, department performance,
        or generate an executive brief. All queries are processed securely
        through the Government of Sikkim's DRISHTI platform.
      </div>
    </div>`;
    return;
  }

  // Render all messages — use a document fragment for performance
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < _conversation.length; i++) {
    const msg   = _conversation[i];
    const isAI  = msg.role === 'assistant';
    const wrap  = document.createElement('div');
    wrap.className = 'ai-msg ' + (isAI ? 'ai' : 'user');
    wrap.setAttribute('data-idx', i);
    wrap.style.animationDelay = '0ms'; // no stagger on full re-render

    if (isAI) {
      // Render AI bubble with markdown (synchronous fallback if marked not ready)
      let html;
      try {
        const marked = window.marked;
        if (marked && typeof marked.parse === 'function') {
          html = marked.parse(msg.content);
        } else if (marked && typeof marked === 'function') {
          html = marked(msg.content);
        } else {
          html = _esc(msg.content).replace(/\n/g, '<br/>');
        }
      } catch {
        html = _esc(msg.content).replace(/\n/g, '<br/>');
      }

      const tokenStr = msg.tokens ? `· ${msg.tokens} tokens` : '';
      wrap.innerHTML = `
      <div class="ai-bubble ${msg.isError ? 'style="border-color:var(--color-danger-light);border-left:3px solid var(--color-danger);"' : ''}" role="article" aria-label="AI response">
        ${html}
      </div>
      <div class="ai-msg-meta">
        <span>${_fmtTime(msg.timestamp)} ${tokenStr}</span>
        <div class="ai-msg-actions">
          <button class="ai-icon-action" data-action="copy" data-idx="${i}" aria-label="Copy response">
            📋 Copy
          </button>
          <button class="ai-icon-action" data-action="save" data-idx="${i}" aria-label="Save to notes">
            📝 Save
          </button>
        </div>
      </div>`;
    } else {
      wrap.innerHTML = `
      <div class="ai-bubble" role="article" aria-label="Your message">
        ${_esc(msg.content).replace(/\n/g, '<br/>')}
      </div>
      <div class="ai-msg-meta">
        <span>${_fmtTime(msg.timestamp)}</span>
      </div>`;
    }

    fragment.appendChild(wrap);
  }

  container.innerHTML = '';
  container.appendChild(fragment);

  // Wire copy/save actions
  container.querySelectorAll('[data-action]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const idx = parseInt(btn.dataset.idx, 10);
      if (btn.dataset.action === 'copy') _copyMessage(idx, btn);
      if (btn.dataset.action === 'save') _saveToNotes(idx);
    });
  });

  // Load marked.js in background for next render
  _loadMarked().catch(function() {});
}

/** Shows the animated typing indicator */
function _showTyping() {
  const container = document.getElementById('ai-messages');
  if (!container) return;
  const el = document.createElement('div');
  el.id = 'ai-typing-indicator';
  el.className = 'ai-typing-wrap';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', 'AI is thinking');
  el.innerHTML = `
  <div class="ai-typing-avatar" aria-hidden="true">✦</div>
  <div class="ai-typing-bubble" aria-hidden="true">
    <div class="ai-dot"></div>
    <div class="ai-dot"></div>
    <div class="ai-dot"></div>
  </div>`;
  container.appendChild(el);
  _scrollToBottom();
}

/** Removes the typing indicator */
function _hideTyping() {
  document.getElementById('ai-typing-indicator')?.remove();
}

/** Scrolls the messages container to the bottom */
function _scrollToBottom() {
  const container = document.getElementById('ai-messages');
  if (container) {
    requestAnimationFrame(function() {
      container.scrollTop = container.scrollHeight;
    });
  }
}

/** Copies an AI message to clipboard */
function _copyMessage(idx, btn) {
  const msg = _conversation[idx];
  if (!msg) return;
  navigator.clipboard.writeText(msg.content).then(function() {
    btn.textContent = '✓ Copied';
    btn.classList.add('copied');
    setTimeout(function() {
      btn.textContent = '📋 Copy';
      btn.classList.remove('copied');
    }, 2000);
  }).catch(function() {
    window.ui?.toast('Copy Failed', 'Could not access clipboard.', 'error');
  });
}

/** Saves an AI message to the notes panel */
function _saveToNotes(idx) {
  const msg = _conversation[idx];
  if (!msg) return;
  _addNote(msg.content, msg.timestamp);
  window.ui?.toast('Saved to Notes', 'Response added to your notes panel.', 'success', 2000);
}

/** Updates the token hint in the input bar */
function _updateTokenHint() {
  const input  = document.getElementById('ai-query-input');
  const query  = input?.value || '';
  const tokens = _estimateTokens(query);
  const MAX    = 8192;

  const hint = document.getElementById('ai-token-hint');
  const full  = document.getElementById('ai-token-count');
  const bar   = document.getElementById('ai-token-bar-fill');

  if (hint) hint.textContent = tokens.toLocaleString();
  if (full) full.textContent = tokens.toLocaleString() + ' / ' + MAX.toLocaleString();

  const pct = Math.min((tokens / MAX) * 100, 100);
  if (bar) {
    bar.style.width = pct + '%';
    bar.className   = 'ai-token-fill' + (pct > 75 ? ' near-limit' : '');
  }
}

/** Updates the context stats panel */
function _updateContextStats() {
  const userCount = _conversation.filter(function(m) { return m.role === 'user'; }).length;
  const aiCount   = _conversation.filter(function(m) { return m.role === 'assistant'; }).length;

  const msgEl   = document.getElementById('ctx-msg-count');
  const aiEl    = document.getElementById('ctx-ai-count');
  const startEl = document.getElementById('ctx-session-start');

  if (msgEl)   msgEl.textContent   = _conversation.length;
  if (aiEl)    aiEl.textContent    = aiCount;
  if (startEl && _conversation.length > 0) {
    startEl.textContent = _fmtTime(_conversation[0].timestamp);
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// G — DAILY BRIEF VIEW
// ═════════════════════════════════════════════════════════════════════════════

/** Opens the full-screen Daily Brief overlay */
async function openDailyBrief() {
  injectAICSS();
  _injectBriefOverlay();

  const overlay = document.getElementById('ai-brief-overlay');
  overlay.classList.add('open');

  // Show loading
  const body = document.getElementById('brief-body-content');
  if (body) {
    body.innerHTML = `
    <div class="brief-loading" role="status" aria-live="polite">
      <div class="rv-spinner" aria-hidden="true"></div>
      <div>Compiling executive brief…</div>
      <div style="font-size:var(--font-xs);color:var(--color-text-muted);">Fetching data and generating AI observations via Groq</div>
    </div>`;
  }

  try {
    // Fetch dashboard stats and AI brief in parallel
    const [stats, briefResult, deptPerf] = await Promise.all([
      window.api('getDashboardStats', {}).catch(function() { return {}; }),
      window.api('generateDailyBrief', {}).catch(function(e) { return { brief: 'AI observations unavailable: ' + e.message }; }),
      window.api('getDepartmentPerformance', {}).catch(function() { return []; }),
    ]);

    _lastBrief = { stats, brief: briefResult?.brief || '', deptPerf, cached: briefResult?.cached };
    _renderBriefContent(_lastBrief);

  } catch (err) {
    if (body) body.innerHTML = `<div class="empty-state" style="padding:var(--space-12);"><div class="empty-state-title">Failed to generate brief</div><div class="empty-state-desc">${_esc(err.message)}</div></div>`;
    window.ui?.toast('Brief Error', err.message, 'error');
  }
}

/** Injects the brief overlay DOM element into body (once) */
function _injectBriefOverlay() {
  if (document.getElementById('ai-brief-overlay')) return;
  const el = document.createElement('div');
  el.id = 'ai-brief-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'brief-title-label');
  el.innerHTML = `
  <div class="brief-topbar" role="banner">
    <div class="brief-topbar-title" id="brief-title-label">DRISHTI EXECUTIVE DAILY BRIEF</div>
    <div class="brief-topbar-actions">
      <button class="btn btn-secondary btn-sm" id="brief-refresh-btn" aria-label="Regenerate brief">
        ↺ Refresh
      </button>
      <button class="btn btn-secondary btn-sm" id="brief-print-btn" aria-label="Print brief">
        🖨 Print
      </button>
      <button class="btn btn-accent btn-sm" id="brief-export-btn" aria-label="Export brief as text">
        ⬇ Export
      </button>
      <button class="btn btn-ghost btn-sm" id="brief-close-btn" style="color:rgba(255,255,255,0.7);" aria-label="Close brief">
        ✕ Close
      </button>
    </div>
  </div>
  <div class="brief-body" id="brief-body-content" aria-live="polite"></div>`;
  document.body.appendChild(el);

  document.getElementById('brief-close-btn')?.addEventListener('click', function() {
    el.classList.remove('open');
  });
  document.getElementById('brief-print-btn')?.addEventListener('click', function() {
    window.print();
  });
  document.getElementById('brief-refresh-btn')?.addEventListener('click', function() {
    _lastBrief = null;
    openDailyBrief();
  });
  document.getElementById('brief-export-btn')?.addEventListener('click', _exportBrief);

  // Escape to close
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && el.classList.contains('open')) el.classList.remove('open');
  });
}

/** Renders the brief content from fetched data */
function _renderBriefContent(data) {
  const body    = document.getElementById('brief-body-content');
  if (!body) return;

  const { stats = {}, brief = '', deptPerf = [] } = data;
  const today   = new Date();
  const dateStr = today.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  // Overdue and critical tasks from stats
  const overdueList  = (stats.overdueList  || []).slice(0, 8);
  const critical     = (stats.pinnedTasks  || []).filter(function(t) { return t.Priority === 'CRITICAL'; }).slice(0, 5);

  // Find the Sikkim seal for the brief cover
  const sealImg = document.querySelector('.sidebar-emblem') || document.querySelector('.login-emblem') || document.querySelector('.loading-emblem');
  const sealSrc = sealImg?.src || '';

  body.innerHTML = `
  <!-- Cover -->
  <div class="brief-cover">
    ${sealSrc ? `<img src="${_esc(sealSrc)}" class="brief-seal" alt="Government of Sikkim" />` : ''}
    <div class="brief-title">DRISHTI</div>
    <div class="brief-subtitle">Chief Secretary Executive Command Centre · Government of Sikkim</div>
    <div class="brief-date">${dateStr}</div>
    <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:var(--space-2);">
      ${data.cached ? '(Served from cache · Generated within last hour)' : 'Generated ' + _fmtTime(new Date().toISOString())}
    </div>
  </div>

  <!-- Section 1: Today at a Glance -->
  <div class="brief-section" style="animation-delay:0ms;">
    <div class="brief-section-header">
      <div class="brief-section-num">1</div>
      <div class="brief-section-title">Today at a Glance</div>
    </div>
    <div class="brief-kpi-row">
      ${[
        { label:'Total Tasks',   val: stats.totalTasks  || 0,  clr:'var(--color-primary)' },
        { label:'Pending',       val: stats.pending     || 0,  clr:'var(--color-warning)' },
        { label:'Overdue',       val: stats.overdue     || 0,  clr:'var(--color-danger)'  },
        { label:'Completed',     val: stats.completed   || 0,  clr:'var(--color-success)' },
        { label:'Critical',      val: stats.critical    || 0,  clr:'#c62828'              },
        { label:'Due Today',     val: stats.dueToday    || 0,  clr:'var(--color-accent-dark)' },
        { label:'In Progress',   val: stats.inProgress  || 0,  clr:'var(--color-primary-light)' },
        { label:'Due This Week', val: stats.dueThisWeek || 0,  clr:'var(--color-success)'  },
      ].map(function(k) {
        return `<div class="brief-kpi">
          <div class="brief-kpi-val" style="color:${k.clr};">${k.val}</div>
          <div class="brief-kpi-label">${k.label}</div>
        </div>`;
      }).join('')}
    </div>
  </div>

  <!-- Section 2: Immediate Attention -->
  <div class="brief-section" style="animation-delay:60ms;">
    <div class="brief-section-header">
      <div class="brief-section-num">2</div>
      <div class="brief-section-title">Immediate Attention Required</div>
    </div>
    ${overdueList.length ? overdueList.map(function(t) {
      const days = t.DueDate
        ? Math.max(0, Math.floor((Date.now() - new Date(t.DueDate)) / 86400000))
        : '?';
      const isCrit = t.Priority === 'CRITICAL';
      return `<div class="brief-attention-item ${isCrit ? '' : 'high'}">
        <span class="brief-task-id">${_esc(t.TaskID)}</span>
        <span class="brief-task-subject truncate">${_esc(t.Subject)}</span>
        <span class="badge badge-${(t.Priority||'low').toLowerCase()}" style="flex-shrink:0;">${t.Priority}</span>
        <span style="font-size:var(--font-xs);color:var(--color-danger);font-weight:700;flex-shrink:0;">${days}d overdue</span>
      </div>`;
    }).join('') : `<div style="color:var(--color-success);font-weight:600;padding:var(--space-4);">✓ No overdue tasks — all directives are on track.</div>`}
  </div>

  <!-- Section 3: Department Momentum -->
  <div class="brief-section" style="animation-delay:120ms;">
    <div class="brief-section-header">
      <div class="brief-section-num">3</div>
      <div class="brief-section-title">Department Momentum</div>
    </div>
    ${deptPerf.length ? `
    <table class="brief-dept-table">
      <thead>
        <tr>
          <th>Department</th>
          <th style="text-align:right;">Total</th>
          <th style="text-align:right;">Done</th>
          <th style="text-align:right;">Overdue</th>
          <th style="text-align:right;">Rate</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${deptPerf.slice(0, 15).map(function(d) {
          const PERF_COLORS = {
            'Leading the Charge':'#2E7D32','Fast Movers':'#00695C',
            'Rising Momentum':'#2A5F9E','Maintaining Course':'#A07830',
            'Focus Required':'#F57F17','Needs Attention':'#B71C1C',
          };
          const colour = PERF_COLORS[d.performanceLabel] || '#6B7A99';
          return `<tr>
            <td style="font-weight:600;">${_esc(d.deptShortName || d.deptCode)}</td>
            <td style="text-align:right;">${d.total}</td>
            <td style="text-align:right;color:var(--color-success);">${d.completedCount}</td>
            <td style="text-align:right;color:var(--color-danger);">${d.overdueCount}</td>
            <td style="text-align:right;font-weight:700;">${d.completionRate}%</td>
            <td><span style="font-size:0.7rem;font-weight:700;color:${colour};">● ${_esc(d.performanceLabel)}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>` : `<div style="color:var(--color-text-muted);font-size:var(--font-sm);">Department performance data unavailable.</div>`}
  </div>

  <!-- Section 4: Recent Directions -->
  <div class="brief-section" style="animation-delay:180ms;">
    <div class="brief-section-header">
      <div class="brief-section-num">4</div>
      <div class="brief-section-title">Recent Directions Issued</div>
    </div>
    <div id="brief-directions-content">
      <div style="color:var(--color-text-muted);font-size:var(--font-sm);">Loading recent directions…</div>
    </div>
  </div>

  <!-- Section 5: New Uploads -->
  <div class="brief-section" style="animation-delay:240ms;">
    <div class="brief-section-header">
      <div class="brief-section-num">5</div>
      <div class="brief-section-title">New Uploads & Attachments</div>
    </div>
    <div style="color:var(--color-text-muted);font-size:var(--font-sm);">
      Attachment activity is tracked in real-time on the task detail pages.
      Use the Reports module to export a full attachment log.
    </div>
  </div>

  <!-- Section 6: AI Observations -->
  <div class="brief-section" style="animation-delay:300ms;">
    <div class="brief-section-header">
      <div class="brief-section-num">6</div>
      <div class="brief-section-title">AI Executive Observations</div>
    </div>
    <div class="brief-ai-obs" aria-label="AI-generated observations">
      ${brief ? _esc(brief) : '<span style="color:var(--color-text-muted);font-style:italic;">No AI observations available. Click Refresh to generate.</span>'}
    </div>
    <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:var(--space-2);">
      Generated by Groq llama3-70b-8192 · For official use only · Verify all figures before action
    </div>
  </div>
  `;

  // Load recent directions asynchronously
  _loadBriefDirections();
}

/** Loads recent Direction comments for the brief */
async function _loadBriefDirections() {
  const el = document.getElementById('brief-directions-content');
  if (!el) return;
  try {
    // Get a few recent tasks and their comments
    const result    = await window.api('getTasks', { pageSize: 10, sortBy: 'dueDate' });
    const tasks     = result?.tasks || [];
    const commentArrays = await Promise.all(
      tasks.slice(0, 3).map(function(t) {
        return window.api('getComments', { taskID: t.TaskID }).catch(function() { return []; });
      })
    );
    const directions = commentArrays.flat()
      .filter(function(c) { return c.Category === 'Direction' || c.Category === 'Immediate Attention'; })
      .sort(function(a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); })
      .slice(0, 5);

    if (!directions.length) {
      el.innerHTML = '<div style="color:var(--color-text-muted);font-size:var(--font-sm);">No recent directions issued.</div>';
      return;
    }

    const taskMap = {};
    tasks.forEach(function(t) { taskMap[t.TaskID] = t.Subject; });

    el.innerHTML = directions.map(function(c) {
      return `<div style="padding:var(--space-3) 0;border-bottom:1px solid var(--color-border);">
        <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-2);">
          <span style="font-size:var(--font-xs);font-weight:700;color:var(--color-primary-light);">${_esc(c.TaskID)}</span>
          <span style="font-size:var(--font-xs);font-weight:700;color:var(--color-text-primary);">${_esc((taskMap[c.TaskID]||'').substring(0,60))}</span>
          <span class="dp-cat-badge dp-cat-${c.Category==='Immediate Attention'?'attention':'direction'}" style="font-size:0.65rem;">${_esc(c.Category)}</span>
        </div>
        <div style="font-size:var(--font-sm);color:var(--color-text-primary);line-height:1.5;">${_esc(c.Content.substring(0,200))}${c.Content.length>200?'…':''}</div>
        <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:var(--space-1);">${_esc(c.AuthorName)} · ${_fmtDate(c.Timestamp)}</div>
      </div>`;
    }).join('');
  } catch {
    el.innerHTML = '<div style="color:var(--color-text-muted);font-size:var(--font-sm);">Could not load directions.</div>';
  }
}

/** Exports the daily brief as a plain-text file */
function _exportBrief() {
  const dateStr = new Date().toISOString().split('T')[0];
  const brief   = _lastBrief?.brief || '';
  const stats   = _lastBrief?.stats || {};
  const text    = [
    '═══════════════════════════════════════════',
    'DRISHTI EXECUTIVE DAILY BRIEF',
    'Government of Sikkim — Chief Secretary CSECC',
    'Generated: ' + new Date().toLocaleString('en-IN'),
    '═══════════════════════════════════════════',
    '',
    'TODAY AT A GLANCE',
    '─────────────────',
    'Total Tasks:   ' + (stats.totalTasks  || 0),
    'Pending:       ' + (stats.pending     || 0),
    'In Progress:   ' + (stats.inProgress  || 0),
    'Completed:     ' + (stats.completed   || 0),
    'Overdue:       ' + (stats.overdue     || 0),
    'Critical:      ' + (stats.critical    || 0),
    'Due Today:     ' + (stats.dueToday    || 0),
    '',
    'AI EXECUTIVE OBSERVATIONS',
    '─────────────────────────',
    brief || 'No AI observations available.',
    '',
    '═══════════════════════════════════════════',
    'CONFIDENTIAL — For Official Use Only',
    'DRISHTI · Government of Sikkim',
  ].join('\n');

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `DRISHTI_Brief_${dateStr}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  window.ui?.toast('Exported', 'Brief downloaded as text file.', 'success', 2000);
}


// ═════════════════════════════════════════════════════════════════════════════
// H — NOTES PANEL
// ═════════════════════════════════════════════════════════════════════════════

const NOTES_KEY = 'drishti_ai_notes';

function _loadNotes() {
  try { return JSON.parse(sessionStorage.getItem(NOTES_KEY) || '[]'); }
  catch { return []; }
}
function _saveNotes(notes) {
  try { sessionStorage.setItem(NOTES_KEY, JSON.stringify(notes)); }
  catch {}
}

function _addNote(content, timestamp) {
  const notes = _loadNotes();
  notes.unshift({ content, timestamp: timestamp || new Date().toISOString() });
  _saveNotes(notes);
  _renderNotes();
}

function _injectNotesPanel() {
  if (document.getElementById('ai-notes-overlay')) return;
  const el = document.createElement('div');
  el.id = 'ai-notes-overlay';
  el.setAttribute('role', 'complementary');
  el.setAttribute('aria-label', 'Saved AI notes');
  el.innerHTML = `
  <div class="notes-header">
    <span class="notes-header-title">📝 Saved Notes</span>
    <div style="display:flex;gap:var(--space-2);">
      <button class="btn btn-ghost btn-sm" id="notes-clear-btn" aria-label="Clear all notes">Clear All</button>
      <button class="icon-btn" id="notes-close-btn" aria-label="Close notes panel">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </div>
  <div id="ai-notes-content" aria-live="polite"></div>`;
  document.body.appendChild(el);

  document.getElementById('notes-close-btn')?.addEventListener('click', function() {
    el.classList.remove('open');
  });
  document.getElementById('notes-clear-btn')?.addEventListener('click', async function() {
    const ok = await window.ui?.confirm('Clear Notes', 'Delete all saved notes from this session?', 'Clear All');
    if (!ok) return;
    sessionStorage.removeItem(NOTES_KEY);
    _renderNotes();
  });
}

function _renderNotes() {
  const el = document.getElementById('ai-notes-content');
  if (!el) return;
  const notes = _loadNotes();
  if (!notes.length) {
    el.innerHTML = '<div class="empty-state" style="padding:var(--space-6);"><div class="empty-state-desc">No notes saved yet. Use the "Save" button on any AI response.</div></div>';
    return;
  }
  el.innerHTML = notes.map(function(n, i) {
    return `<div class="note-item" role="listitem">
      <button class="note-del" onclick="_deleteNote(${i})" aria-label="Delete note">✕</button>
      ${_esc(n.content).replace(/\n/g,'<br/>')}
      <div class="note-meta">${_fmtDate(n.timestamp)} ${_fmtTime(n.timestamp)}</div>
    </div>`;
  }).join('');
}

window._deleteNote = function(idx) {
  const notes = _loadNotes();
  notes.splice(idx, 1);
  _saveNotes(notes);
  _renderNotes();
};

function _toggleNotes() {
  _injectNotesPanel();
  _renderNotes();
  document.getElementById('ai-notes-overlay')?.classList.toggle('open');
}


// ═════════════════════════════════════════════════════════════════════════════
// I — EXPORT CONVERSATION
// ═════════════════════════════════════════════════════════════════════════════

function _exportConversation() {
  if (!_conversation.length) {
    window.ui?.toast('No Conversation', 'Start a conversation first before exporting.', 'info');
    return;
  }
  const lines = [
    'DRISHTI AI Conversation Export',
    'Government of Sikkim · ' + new Date().toLocaleString('en-IN'),
    '═'.repeat(60),
    '',
  ];
  _conversation.forEach(function(m) {
    lines.push(m.role === 'user' ? '>>> YOU' : '<<< DRISHTI AI');
    lines.push('[' + _fmtDate(m.timestamp) + ' ' + _fmtTime(m.timestamp) + ']');
    lines.push(m.content);
    lines.push('─'.repeat(40));
    lines.push('');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'DRISHTI_AI_' + new Date().toISOString().split('T')[0] + '.txt';
  a.click();
  URL.revokeObjectURL(url);
  window.ui?.toast('Exported', _conversation.length + ' messages exported.', 'success');
}


// ═════════════════════════════════════════════════════════════════════════════
// J — HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function _esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}); }
  catch { return iso; }
}
function _fmtTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}); }
  catch { return ''; }
}


// ═════════════════════════════════════════════════════════════════════════════
// K — ROUTE HANDLING & LIFECYCLE
// ═════════════════════════════════════════════════════════════════════════════

/** Clears conversation when user logs out (called by auth.logout) */
function _onLogout() {
  _clearHistory();
  sessionStorage.removeItem(NOTES_KEY);
}

document.addEventListener('drishti:viewchange', function(e) {
  const { view, param } = e.detail;

  if (view === 'ai') {
    // Start loading marked.js in background immediately
    _loadMarked().catch(function() {});

    if (param === 'brief') {
      // Navigate to brief sub-view
      renderAIView(); // Ensure base view is rendered first
      openDailyBrief();
    } else {
      renderAIView();
    }
  }
});

document.addEventListener('drishti:appready', function() {
  const hash = window.location.hash.replace('#','');
  if (hash === 'ai' || hash.startsWith('ai/')) {
    _loadMarked().catch(function() {});
    if (hash === 'ai/brief') {
      renderAIView();
      openDailyBrief();
    } else {
      renderAIView();
    }
  }
});

// Hook into logout to clear sensitive session data
const _origLogout = window.auth?.logout;
if (window.auth && typeof _origLogout === 'function') {
  window.auth.logout = async function(silent) {
    _onLogout();
    return _origLogout.call(window.auth, silent);
  };
}

// Also listen for the custom logout event for resilience
document.addEventListener('drishti:logout', _onLogout);

// Expose openDailyBrief globally for dashboard.js speed-dial
window.openDailyBrief = openDailyBrief;
