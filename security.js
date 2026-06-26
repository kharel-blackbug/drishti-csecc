/**
 * DRISHTI — Frontend Security Hardening & Performance Optimisation
 * File: security.js
 *
 * Loaded FIRST by index.html — before all other module scripts.
 * Enhances and patches the globals defined in index.html's inline module.
 *
 * SECURITY:
 *   S1 — Client-side input sanitisation (sanitizeInput)
 *   S2 — CSRF token storage and injection into every api() call
 *   S3 — XSS protection (safe DOM helpers, innerHTML guard)
 *   S4 — Session activity refresh, sessionStorage-only enforcement
 *   S6 — CAPTCHA challenge UI (triggered after 3 failed login attempts)
 *
 * PERFORMANCE:
 *   P1 — Intersection Observer for lazy chart initialisation
 *   P2 — sessionStorage API response cache (5-min TTL, mutation invalidation)
 *   P2 — 300ms debounce on all search inputs
 *   P3 — Virtual scroll helper for large lists
 *
 * This file wraps window.api() with:
 *   - Automatic CSRF token injection
 *   - Input sanitisation of all string values in payload
 *   - Response caching for cacheable GET-equivalent actions
 *   - Session activity heartbeat (auto-refresh session TTL)
 *
 * @version 9.0.0
 * @module  Security & Performance
 */

'use strict';

// ═════════════════════════════════════════════════════════════════════════════
// S1 — CLIENT-SIDE INPUT SANITISATION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Maximum input length enforced client-side.
 * @const {number}
 */
const CLIENT_MAX_INPUT = 4000;

/**
 * Patterns to strip from all client-side string inputs.
 * Server-side sanitisation in Security.gs is the authoritative layer;
 * this provides defence-in-depth.
 * @const {RegExp[]}
 */
const CLIENT_DANGEROUS_PATTERNS = [
  /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
  /<iframe[\s\S]*?>/gi,
  /on\w+\s*=\s*["'][^"']*["']/gi,
  /on\w+\s*=\s*[^\s>]*/gi,
  /javascript\s*:/gi,
  /vbscript\s*:/gi,
  /data\s*:\s*text\/html/gi,
  /expression\s*\(/gi,
  /--\s*;?/g,
  /;\s*DROP\s+TABLE/gi,
  /UNION\s+SELECT/gi,
  /\x00/g,
];

/**
 * Sanitises a user-supplied string for safe transmission to the backend.
 * - Strips dangerous patterns
 * - Trims whitespace
 * - Escapes leading Sheets formula characters
 * - Enforces maximum length
 *
 * NOTE: Passwords must NOT be sanitised — they are hashed immediately
 *       and sanitisation would alter special characters.
 *
 * @param {*} value - Raw input (any type).
 * @returns {string} Safe string.
 */
function sanitizeInput(value) {
  if (value === null || value === undefined) return '';
  let str = String(value);
  CLIENT_DANGEROUS_PATTERNS.forEach(function(re) { str = str.replace(re, ''); });
  str = str.replace(/[ \t]{2,}/g, ' ').trim();
  str = str.replace(/^([=+\-@\t\r|])/, "'$1");
  if (str.length > CLIENT_MAX_INPUT) str = str.substring(0, CLIENT_MAX_INPUT);
  return str;
}

/**
 * Recursively sanitises all string values in a payload object.
 * Applied before every api() call (passwords are excluded by the skipKeys list).
 *
 * @param {*}        obj      - The payload object.
 * @param {string[]} skipKeys - Keys whose values must NOT be sanitised (e.g. 'password').
 * @param {number}   depth    - Current recursion depth.
 * @returns {*} A sanitised copy.
 */
function sanitizePayloadClient(obj, skipKeys, depth) {
  skipKeys = skipKeys || ['password', 'oldPassword', 'newPassword', 'fileData'];
  depth    = depth || 0;
  if (depth > 4 || typeof obj !== 'object' || obj === null) {
    return typeof obj === 'string' ? sanitizeInput(obj) : obj;
  }
  const result = {};
  Object.keys(obj).forEach(function(key) {
    const val = obj[key];
    if (skipKeys.includes(key)) {
      result[key] = val; // pass through unsanitised
    } else if (typeof val === 'string') {
      result[key] = sanitizeInput(val);
    } else if (Array.isArray(val)) {
      result[key] = val.map(function(item) {
        return typeof item === 'string' ? sanitizeInput(item) : item;
      });
    } else if (typeof val === 'object' && val !== null) {
      result[key] = sanitizePayloadClient(val, skipKeys, depth + 1);
    } else {
      result[key] = val;
    }
  });
  return result;
}


// ═════════════════════════════════════════════════════════════════════════════
// S2 — CSRF TOKEN STORAGE AND INJECTION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * sessionStorage key for the CSRF token.
 * @const {string}
 */
const CSRF_STORAGE_KEY = 'drishti_csrf_token';

/**
 * Stores the CSRF token received at login.
 * Called by the patched auth.login() after a successful response.
 *
 * @param {string} token - CSRF token from the server login response.
 * @returns {void}
 */
function storeCSRFToken(token) {
  if (token) sessionStorage.setItem(CSRF_STORAGE_KEY, token);
}

/**
 * Retrieves the current CSRF token from sessionStorage.
 * @returns {string} The token, or an empty string if not set.
 */
function getCSRFToken() {
  return sessionStorage.getItem(CSRF_STORAGE_KEY) || '';
}

/**
 * Clears the CSRF token (called on logout).
 * @returns {void}
 */
function clearCSRFToken() {
  sessionStorage.removeItem(CSRF_STORAGE_KEY);
}


// ═════════════════════════════════════════════════════════════════════════════
// S3 — XSS PROTECTION: SAFE DOM HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Safely escapes a string for insertion as HTML text content.
 * This is the authoritative escape function — all modules should use this
 * instead of string interpolation into innerHTML.
 *
 * @param {*} str - Value to escape.
 * @returns {string} HTML-entity-escaped string.
 */
function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Sets an element's text content safely (never innerHTML).
 * @param {HTMLElement} el   - Target element.
 * @param {*}           text - Text to set.
 * @returns {void}
 */
function safeSetText(el, text) {
  if (el) el.textContent = String(text !== null && text !== undefined ? text : '');
}

/**
 * Creates and returns a DOM element with optional text content.
 * All user data should be set via this or safeSetText(), never via innerHTML
 * with untrusted data.
 *
 * @param {string} tag       - HTML tag name.
 * @param {Object} [attrs]   - Key-value attribute pairs.
 * @param {string} [text]    - Text content (set via textContent).
 * @returns {HTMLElement}
 */
function createElement(tag, attrs, text) {
  const el = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function(key) {
      if (key === 'className') el.className = attrs[key];
      else if (key === 'style') el.style.cssText = attrs[key];
      else el.setAttribute(key, attrs[key]);
    });
  }
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}

/**
 * Guards against accidental raw innerHTML usage with user data.
 * Replaces any occurrence of a known dangerous pattern in a template string.
 * For use in tagged template literals:
 *   const html = safeHTML`<div>${userValue}</div>`;
 *
 * Values are automatically HTML-escaped.
 *
 * @param {TemplateStringsArray} strings - Static string parts.
 * @param {...*} values - Dynamic values (auto-escaped).
 * @returns {string} Safe HTML string.
 */
function safeHTML(strings) {
  const values = Array.prototype.slice.call(arguments, 1);
  return strings.reduce(function(result, str, i) {
    const val = values[i - 1];
    return result + escapeHTML(val !== undefined ? val : '') + str;
  });
}

// Override the simple _esc used in inline modules with the canonical version
window._escHTML = escapeHTML;


// ═════════════════════════════════════════════════════════════════════════════
// S4 — SESSION SECURITY: ACTIVITY HEARTBEAT & ENFORCEMENT
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Session activity heartbeat interval: 15 minutes.
 * Calls validateSession on the server to refresh the session TTL.
 * @const {number}
 */
const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;

/** @type {number|null} Heartbeat timer ID */
let _heartbeatTimer = null;

/**
 * Starts the session heartbeat.
 * Called after successful login or session hydration.
 *
 * @returns {void}
 */
function startSessionHeartbeat() {
  stopSessionHeartbeat();
  _heartbeatTimer = setInterval(async function() {
    try {
      const result = await window.api('validateSession', {});
      if (!result?.valid) {
        stopSessionHeartbeat();
        window.ui?.toast('Session Expired', 'Your session has expired. Please sign in again.', 'warning');
        if (window.auth) window.auth.logout(true);
      }
    } catch {
      // Network error during heartbeat — don't log out, just skip
    }
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * Stops the session heartbeat timer.
 * @returns {void}
 */
function stopSessionHeartbeat() {
  if (_heartbeatTimer !== null) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

/**
 * Verifies no sensitive data is stored in localStorage.
 * Called on startup — removes any session data accidentally placed there.
 *
 * @returns {void}
 */
function enforceSessionStoragePolicy() {
  const sensitiveKeys = ['drishti_session', 'drishti_user', 'drishti_csrf_token'];
  sensitiveKeys.forEach(function(key) {
    if (localStorage.getItem(key)) {
      localStorage.removeItem(key);
      console.warn('[DRISHTI][SECURITY] Removed sensitive key from localStorage: ' + key);
    }
  });
}


// ═════════════════════════════════════════════════════════════════════════════
// S6 — CAPTCHA UI
// ═════════════════════════════════════════════════════════════════════════════

/** @type {{ challengeID: string, question: string }|null} Current captcha challenge */
let _currentCaptcha = null;

/**
 * Requests a CAPTCHA challenge from the server and renders it in the login form.
 * Called after the 3rd failed login attempt.
 *
 * @param {string} email - The email address being logged in with.
 * @returns {Promise<void>}
 */
async function showCaptchaChallenge(email) {
  try {
    const result = await window.api('getCaptchaChallenge', { email });
    if (!result?.required) return;

    _currentCaptcha = { challengeID: result.challengeID, question: result.question };

    // Inject CAPTCHA UI into the login form
    const loginForm = document.getElementById('login-form');
    if (!loginForm) return;

    let captchaEl = document.getElementById('login-captcha');
    if (!captchaEl) {
      captchaEl = document.createElement('div');
      captchaEl.id = 'login-captcha';
      captchaEl.style.cssText = 'margin-top:12px;padding:12px;background:rgba(245,127,23,0.1);border:1px solid rgba(245,127,23,0.3);border-radius:8px;';

      const label = createElement('label', { for:'captcha-input', style:'display:block;color:rgba(255,255,255,0.7);font-size:0.8rem;font-weight:600;margin-bottom:6px;' });
      safeSetText(label, '🔒 Security Check (after multiple failed attempts)');

      const question = createElement('p', { style:'color:rgba(255,255,255,0.9);font-weight:700;margin:0 0 8px;font-size:0.9rem;' });
      safeSetText(question, result.question);

      const input = createElement('input', {
        type:        'number',
        id:          'captcha-input',
        placeholder: 'Enter your answer',
        style:       'width:100%;padding:8px 12px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:#fff;font-size:0.9rem;outline:none;',
        'aria-label':result.question,
        'aria-required':'true',
      });

      captchaEl.appendChild(label);
      captchaEl.appendChild(question);
      captchaEl.appendChild(input);

      // Insert before the submit button
      const submitBtn = document.getElementById('login-btn');
      if (submitBtn) loginForm.insertBefore(captchaEl, submitBtn);
      else loginForm.appendChild(captchaEl);
    } else {
      // Update question if challenge was refreshed
      const q = captchaEl.querySelector('p');
      if (q) safeSetText(q, result.question);
    }

    document.getElementById('captcha-input')?.focus();
  } catch (err) {
    console.warn('[DRISHTI] CAPTCHA challenge failed:', err.message);
  }
}

/**
 * Removes the CAPTCHA UI and clears the current challenge.
 * Called on successful login.
 *
 * @returns {void}
 */
function clearCaptchaUI() {
  _currentCaptcha = null;
  document.getElementById('login-captcha')?.remove();
}


// ═════════════════════════════════════════════════════════════════════════════
// P2 — API RESPONSE CACHE (5-MINUTE TTL)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Cache TTL for API responses: 5 minutes in milliseconds.
 * @const {number}
 */
const API_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * sessionStorage key prefix for cached API responses.
 * @const {string}
 */
const API_CACHE_PREFIX = 'drishti_cache_';

/**
 * Actions whose responses are safe to cache.
 * These are "read-only" actions that return reference or aggregate data.
 * @const {Set<string>}
 */
const CACHEABLE_ACTIONS = new Set([
  'getDashboardStats',
  'getHeatmapData',
  'getDepartmentPerformance',
  'getDepartments',
  'getSettings',
  'getPublicConfig',
]);

/**
 * Actions that mutate data and should invalidate all related caches.
 * @const {Object.<string, string[]>} action → cache keys to invalidate
 */
const CACHE_INVALIDATION_MAP = {
  createTask:      ['getDashboardStats','getHeatmapData','getDepartmentPerformance'],
  updateTask:      ['getDashboardStats','getHeatmapData','getDepartmentPerformance'],
  updateProgress:  ['getDashboardStats','getDepartmentPerformance'],
  deleteTask:      ['getDashboardStats','getHeatmapData','getDepartmentPerformance'],
  pinTask:         ['getDashboardStats'],
  createUser:      ['getSettings'],
  updateUser:      ['getSettings'],
  updateSetting:   ['getSettings','getPublicConfig'],
};

/**
 * Reads a cached API response from sessionStorage.
 *
 * @param {string} cacheKey - The cache key.
 * @returns {*|null} Parsed data, or null if not cached or expired.
 */
function readAPICache(cacheKey) {
  try {
    const raw = sessionStorage.getItem(API_CACHE_PREFIX + cacheKey);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.ts > API_CACHE_TTL_MS) {
      sessionStorage.removeItem(API_CACHE_PREFIX + cacheKey);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

/**
 * Writes an API response to the sessionStorage cache.
 *
 * @param {string} cacheKey - The cache key.
 * @param {*}      data     - The response data to cache.
 * @returns {void}
 */
function writeAPICache(cacheKey, data) {
  try {
    const entry = { ts: Date.now(), data: data };
    const json  = JSON.stringify(entry);
    // Only cache if the data is reasonably small (< 500KB)
    if (json.length < 512000) {
      sessionStorage.setItem(API_CACHE_PREFIX + cacheKey, json);
    }
  } catch {
    // sessionStorage full — fail silently
  }
}

/**
 * Invalidates specific API cache entries after a mutation.
 *
 * @param {string} action - The mutation action that was performed.
 * @returns {void}
 */
function invalidateAPICache(action) {
  const keys = CACHE_INVALIDATION_MAP[action] || [];
  keys.forEach(function(key) {
    try { sessionStorage.removeItem(API_CACHE_PREFIX + key); }
    catch {}
  });
}

/**
 * Clears all DRISHTI API caches from sessionStorage.
 * Called on logout.
 * @returns {void}
 */
function clearAllAPICache() {
  try {
    const toRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(API_CACHE_PREFIX)) toRemove.push(key);
    }
    toRemove.forEach(function(k) { sessionStorage.removeItem(k); });
  } catch {}
}


// ═════════════════════════════════════════════════════════════════════════════
// P1 — INTERSECTION OBSERVER: LAZY CHART INITIALISATION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Observes a canvas element and calls initFn() only when it becomes visible
 * in the viewport. This prevents Chart.js from initialising off-screen canvases
 * (which can cause sizing issues) and avoids blocking the main thread.
 *
 * @param {HTMLCanvasElement} canvasEl  - The chart canvas to observe.
 * @param {Function}          initFn   - Called once when the canvas is visible.
 * @returns {IntersectionObserver} The observer (disconnect() when done).
 */
function lazyInitChart(canvasEl, initFn) {
  if (!canvasEl) return null;
  if (!('IntersectionObserver' in window)) {
    // Fallback: initialise immediately
    initFn();
    return null;
  }

  const observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        observer.disconnect();
        initFn();
      }
    });
  }, { threshold: 0.1 }); // 10% visible triggers initialisation

  observer.observe(canvasEl);
  return observer;
}


// ═════════════════════════════════════════════════════════════════════════════
// P2 — DEBOUNCE UTILITY
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Returns a debounced version of fn that delays execution by `wait` ms.
 * Used for all search inputs (300ms) and window resize handlers.
 *
 * @param {Function} fn   - The function to debounce.
 * @param {number}   wait - Delay in milliseconds.
 * @returns {Function} Debounced function.
 */
function debounce(fn, wait) {
  let timer = null;
  return function() {
    const ctx  = this;
    const args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(ctx, args); }, wait);
  };
}

/**
 * Returns a throttled version of fn that executes at most once per `limit` ms.
 * Used for scroll event handlers in the virtual scroll implementation.
 *
 * @param {Function} fn    - The function to throttle.
 * @param {number}   limit - Minimum interval in milliseconds.
 * @returns {Function} Throttled function.
 */
function throttle(fn, limit) {
  let lastCall  = 0;
  return function() {
    const now = Date.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      fn.apply(this, arguments);
    }
  };
}

/**
 * Wires a 300ms debounced search handler to an input element.
 * Replaces any direct input → search flow with the debounced version.
 *
 * @param {string|HTMLElement} inputEl  - Input element or its ID.
 * @param {Function}           handler  - Search handler function.
 * @returns {void}
 */
function wireSearchInput(inputEl, handler) {
  const el = typeof inputEl === 'string' ? document.getElementById(inputEl) : inputEl;
  if (!el) return;
  const debounced = debounce(handler, 300);
  el.addEventListener('input', function() { debounced(el.value); });
}


// ═════════════════════════════════════════════════════════════════════════════
// P3 — VIRTUAL SCROLL FOR LARGE LISTS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * VirtualScroll — renders only the visible rows in a large dataset.
 * Reduces DOM nodes from N to ~50 for smooth scrolling on large task lists.
 *
 * Usage:
 *   const vs = new VirtualScroll({
 *     container: document.getElementById('tasks-tbody'),
 *     items:     taskArray,
 *     rowHeight: 52,
 *     renderRow: (task, index) => '<tr>...</tr>',
 *     pageSize:  50,
 *   });
 *   vs.render();
 *
 * @param {Object} options
 * @param {HTMLElement}  options.container  - The scroll container (tbody or div).
 * @param {Array}        options.items      - Full dataset array.
 * @param {number}       options.rowHeight  - Approx height of each row in px.
 * @param {Function}     options.renderRow  - (item, index) → HTML string.
 * @param {number}       [options.pageSize] - Rows visible at once (default 50).
 */
function VirtualScroll(options) {
  this.container  = options.container;
  this.items      = options.items    || [];
  this.rowHeight  = options.rowHeight || 48;
  this.renderRow  = options.renderRow;
  this.pageSize   = options.pageSize  || 50;
  this._startIdx  = 0;
  this._endIdx    = Math.min(this.pageSize, this.items.length);
  this._scrollEl  = null;
}

VirtualScroll.prototype.render = function() {
  if (!this.container || !this.renderRow) return;

  // Find nearest scrollable ancestor
  let parent = this.container.parentElement;
  while (parent && parent !== document.body) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') { this._scrollEl = parent; break; }
    parent = parent.parentElement;
  }
  if (!this._scrollEl) this._scrollEl = this.container.closest('#main-content') || window;

  this._renderVisible();

  const self = this;
  const onScroll = throttle(function() { self._onScroll(); }, 100);
  this._scrollEl.addEventListener('scroll', onScroll);
  this._cleanup = function() { self._scrollEl.removeEventListener('scroll', onScroll); };
};

VirtualScroll.prototype._renderVisible = function() {
  if (!this.container) return;
  const rows = this.items.slice(this._startIdx, this._endIdx);
  const html = rows.map(this.renderRow).join('');

  // Spacer rows to maintain scroll height
  const topSpacer    = this._startIdx * this.rowHeight;
  const bottomSpacer = Math.max(0, (this.items.length - this._endIdx) * this.rowHeight);

  this.container.innerHTML =
    (topSpacer    > 0 ? `<tr style="height:${topSpacer}px;" aria-hidden="true"><td></td></tr>`    : '') +
    html +
    (bottomSpacer > 0 ? `<tr style="height:${bottomSpacer}px;" aria-hidden="true"><td></td></tr>` : '');
};

VirtualScroll.prototype._onScroll = function() {
  if (!this._scrollEl) return;
  const scrollTop = typeof this._scrollEl.scrollTop === 'number'
    ? this._scrollEl.scrollTop
    : (this._scrollEl.scrollY || 0);

  const newStart = Math.max(0, Math.floor(scrollTop / this.rowHeight) - 5);
  const newEnd   = Math.min(this.items.length, newStart + this.pageSize + 10);

  if (newStart !== this._startIdx || newEnd !== this._endIdx) {
    this._startIdx = newStart;
    this._endIdx   = newEnd;
    this._renderVisible();
  }
};

VirtualScroll.prototype.updateItems = function(items) {
  this.items     = items || [];
  this._startIdx = 0;
  this._endIdx   = Math.min(this.pageSize, this.items.length);
  this._renderVisible();
};

VirtualScroll.prototype.destroy = function() {
  if (this._cleanup) this._cleanup();
};


// ═════════════════════════════════════════════════════════════════════════════
// PATCHED window.api() — SECURITY + PERFORMANCE WRAPPER
// ═════════════════════════════════════════════════════════════════════════════

/**
 * This function installs itself as window.api after the page is fully loaded.
 * It wraps the original api() defined in index.html's inline module with:
 *
 *   1. Payload sanitisation (sanitizePayloadClient)
 *   2. CSRF token injection (X-CSRF-Token in body)
 *   3. Response caching for CACHEABLE_ACTIONS (5-min TTL)
 *   4. Cache invalidation for mutation actions
 *
 * Installation strategy:
 *   The inline module in index.html defines window.api in showApp().
 *   We use a MutationObserver on window to detect when window.api is set,
 *   then wrap it. This avoids race conditions with module load order.
 *
 * @returns {void}
 */
function installAPIWrapper() {
  const originalAPI = window.api;
  if (!originalAPI || typeof originalAPI !== 'function') return;

  /**
   * Wrapped api() — drop-in replacement for window.api().
   * @param {string} action  - Action name.
   * @param {Object} payload - Request payload.
   * @returns {Promise<*>}
   */
  window.api = async function secureApi(action, payload) {
    // 1. Sanitise payload (skip password fields)
    const sanitisedPayload = sanitizePayloadClient(payload || {});

    // 2. Check cache for read-only actions
    if (CACHEABLE_ACTIONS.has(action)) {
      const cacheKey = action + '_' + JSON.stringify(sanitisedPayload).substring(0, 100);
      const cached   = readAPICache(cacheKey);
      if (cached !== null) return cached;

      // Fetch and cache
      const result = await originalAPI.call(this, action, sanitisedPayload);
      if (result !== undefined) writeAPICache(cacheKey, result);
      return result;
    }

    // 3. For mutation actions, add CSRF token to payload
    const csrfToken = getCSRFToken();
    // The CSRF token is included in the request body (not header, since
    // Apps Script fetch() doesn't support custom request headers server-side)
    const enrichedPayload = Object.assign({}, sanitisedPayload, {
      _csrfToken: csrfToken, // picked up by doPost in Security.gs
    });

    // 4. Execute the request
    // We need to also pass csrfToken at the body root level (Security.gs reads body.csrfToken)
    // Patch: temporarily override the body construction in originalAPI by passing csrfToken
    // via a module-level singleton that doPost reads from body.csrfToken
    const result = await _callWithCSRF(originalAPI, action, sanitisedPayload, csrfToken);

    // 5. Invalidate related caches
    invalidateAPICache(action);

    return result;
  };

  console.info('[DRISHTI][SECURITY] Secure API wrapper installed.');
}

/**
 * Internal helper — calls the original API function with CSRF token injected
 * at the body root level. Works by temporarily patching the store's session
 * token fetch to append the CSRF, then restoring.
 *
 * Implementation note: Since the inline api() in index.html constructs the
 * POST body as:
 *   { action, payload, sessionToken: store.session?.sessionToken || '' }
 *
 * We pass the CSRF token as an additional top-level field by overriding
 * the fetch call to inject it. The cleanest approach without modifying
 * index.html is to patch window.fetch temporarily.
 *
 * @param {Function} originalAPI - The unwrapped api() function.
 * @param {string}   action      - Action name.
 * @param {Object}   payload     - Sanitised payload.
 * @param {string}   csrfToken   - CSRF token to inject.
 * @returns {Promise<*>}
 */
async function _callWithCSRF(originalAPI, action, payload, csrfToken) {
  // Patch window.fetch for this single call to inject csrfToken into the body
  const originalFetch = window.fetch;

  window.fetch = async function(url, options) {
    if (options && options.body && typeof options.body === 'string') {
      try {
        const body = JSON.parse(options.body);
        body.csrfToken = csrfToken;
        options = Object.assign({}, options, { body: JSON.stringify(body) });
      } catch { /* body not JSON — pass through */ }
    }
    return originalFetch.call(this, url, options);
  };

  try {
    return await originalAPI.call(null, action, payload);
  } finally {
    window.fetch = originalFetch; // always restore
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// PATCHED auth.login() AND auth.logout()
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Patches auth.login() to:
 *   - Store the CSRF token returned by the server
 *   - Start the session heartbeat
 *   - Handle captchaRequired responses
 *   - Clear all caches on logout
 *
 * Called from installAuthPatches() after window.auth is available.
 */
function installAuthPatches() {
  if (!window.auth) return;

  const originalLogin  = window.auth.login.bind(window.auth);
  const originalLogout = window.auth.logout.bind(window.auth);

  /**
   * Patched login — adds CSRF storage, captcha handling, and heartbeat.
   * @param {string} email
   * @param {string} password
   * @returns {Promise<boolean>}
   */
  window.auth.login = async function(email, password) {
    // Determine if CAPTCHA is needed
    const captchaInput = document.getElementById('captcha-input');
    const hasCaptcha   = !!captchaInput && !!_currentCaptcha;

    // Build extra captcha payload if present
    if (hasCaptcha) {
      // Inject captcha into the API payload for this call by patching api temporarily
      const captchaAnswer     = captchaInput.value.trim();
      const captchaChallengeID= _currentCaptcha.challengeID;

      // We need to pass captcha fields — override the login payload construction
      const result = await window.api('login', {
        email,
        password,
        browser:              navigator.userAgent.substring(0, 200),
        captchaChallengeID,
        captchaAnswer,
      });

      if (!result || !result.success) {
        if (result?.captchaRequired) {
          await showCaptchaChallenge(email); // refresh challenge
        }
        throw new Error(result?.message || 'Login failed.');
      }

      // Success
      if (result.csrfToken) storeCSRFToken(result.csrfToken);
      clearCaptchaUI();
      startSessionHeartbeat();
      return true;
    }

    // Standard login (no captcha yet)
    try {
      const success = await originalLogin(email, password);
      // Retrieve CSRF token from the most recent API response
      // originalLogin calls api('login',...) internally; the CSRF token is
      // in the response data. We read it from store.session if it was stored.
      // Fetch the CSRF token by calling a direct fetch here:
      const sessionData = window.store?.session;
      if (sessionData?.csrfToken) {
        storeCSRFToken(sessionData.csrfToken);
      }
      startSessionHeartbeat();
      return success;
    } catch (err) {
      // Check if CAPTCHA is now required
      if (err.message && err.message.includes('CAPTCHA_REQUIRED')) {
        await showCaptchaChallenge(email);
      } else if (err.message && err.message.includes('attempt')) {
        // May need captcha after 3 failures — pre-emptively check
        const attempts = parseInt(err.message.match(/\d+/)?.[0] || '0', 10);
        if (MAX_FAILED_ATTEMPTS - attempts <= MAX_FAILED_ATTEMPTS - 3) {
          await showCaptchaChallenge(email);
        }
      }
      throw err;
    }
  };

  /**
   * Patched logout — clears CSRF, stops heartbeat, wipes all caches.
   * @param {boolean} [silent]
   */
  window.auth.logout = async function(silent) {
    stopSessionHeartbeat();
    clearCSRFToken();
    clearAllAPICache();
    clearCaptchaUI();
    return originalLogout(silent);
  };

  console.info('[DRISHTI][SECURITY] Auth patches installed.');
}

/** Constant for CAPTCHA threshold (mirrors Security.gs) */
const MAX_FAILED_ATTEMPTS = 5;


// ═════════════════════════════════════════════════════════════════════════════
// SKELETON SCREEN HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Generates a skeleton loading placeholder HTML string.
 * Used by all views as the initial state before data arrives.
 *
 * @param {number} rows    - Number of skeleton rows to generate.
 * @param {number} cols    - Number of columns per row.
 * @param {number} [height]- Height of each skeleton block in px (default: 14).
 * @returns {string} HTML string (safe — no user data).
 */
function skeletonRows(rows, cols, height) {
  height = height || 14;
  const row = '<tr>' + Array(cols).fill(
    `<td><div class="skeleton skeleton-text" style="height:${height}px;border-radius:4px;"></div></td>`
  ).join('') + '</tr>';
  return Array(rows).fill(row).join('');
}

/**
 * Shows a skeleton overlay on an element while data loads.
 * Replaces the element's content with shimmer blocks.
 *
 * @param {HTMLElement} el      - Container element to show skeleton in.
 * @param {number}      [lines] - Number of skeleton lines (default: 4).
 * @returns {Function} Call this function when data is ready to clear skeleton.
 */
function showSkeleton(el, lines) {
  lines = lines || 4;
  if (!el) return function() {};
  const original = el.innerHTML;
  el.innerHTML = Array(lines).fill(0).map(function(_, i) {
    const w = [100, 85, 70, 90, 60][i % 5];
    return `<div class="skeleton skeleton-text" style="width:${w}%;margin-bottom:10px;"></div>`;
  }).join('');
  return function() { el.innerHTML = original; };
}


// ═════════════════════════════════════════════════════════════════════════════
// STARTUP SEQUENCE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Installs all security and performance patches.
 * Called when the DOM is ready, before any DRISHTI module code runs.
 *
 * @returns {void}
 */
function installSecurityPatches() {
  // S4: Enforce sessionStorage-only policy on startup
  enforceSessionStoragePolicy();

  // Wait for window.api and window.auth to be set by index.html's showApp()
  // then install wrappers
  document.addEventListener('drishti:appready', function() {
    installAPIWrapper();
    installAuthPatches();
  });

  // Expose helpers globally for use by all modules
  window.sanitizeInput     = sanitizeInput;
  window.escapeHTML        = escapeHTML;
  window.safeSetText       = safeSetText;
  window.createElement     = createElement;
  window.safeHTML          = safeHTML;
  window.lazyInitChart     = lazyInitChart;
  window.debounce          = debounce;
  window.throttle          = throttle;
  window.wireSearchInput   = wireSearchInput;
  window.VirtualScroll     = VirtualScroll;
  window.skeletonRows      = skeletonRows;
  window.showSkeleton      = showSkeleton;
  window.storeCSRFToken    = storeCSRFToken;
  window.getCSRFToken      = getCSRFToken;
  window.clearCSRFToken    = clearCSRFToken;
  window.invalidateAPICache= invalidateAPICache;
  window.showCaptchaChallenge = showCaptchaChallenge;

  console.info('[DRISHTI][SECURITY] Security patches installed. Version 9.0.0');
}

// Kick off immediately — security.js is loaded first
installSecurityPatches();
