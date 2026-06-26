// DRISHTI Service Worker — only runs on https:// or localhost
// If you see this in a file:// context, the registration guard in
// index.html should have prevented registration.
/**
 * DRISHTI — Service Worker
 * File: sw.js
 *
 * Responsibilities:
 *   1. Cache shell assets on install (cache-first for static resources).
 *   2. Serve cached assets when offline (network-first with cache fallback).
 *   3. Queue failed API calls (POST to Apps Script) for retry when online.
 *   4. Broadcast offline/online status to all connected clients.
 *
 * Strategy:
 *   - Static assets: Cache-first (install → cache → serve from cache)
 *   - API calls (Apps Script): Network-first (try network, on fail → queue)
 *   - Queued requests are replayed in order when the network is restored.
 *
 * @version 5.0.0
 */

const CACHE_NAME    = 'drishti-shell-v5';
const QUEUE_STORE   = 'drishti-api-queue';

/**
 * Shell assets to cache on install.
 * Only assets that are served from the same origin (GitHub Pages).
 * The Apps Script URL is cross-origin and is NOT cached.
 * @type {string[]}
 */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  // Google Fonts are cached by the browser's own cache;
  // we do not attempt to cache external CDN resources here.
];

// ─────────────────────────────────────────────────────────────────────────────
// INSTALL — Pre-cache shell assets
// ─────────────────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // addAll fails atomically — use individual adds so one missing asset
        // does not block the entire Service Worker installation
        return Promise.allSettled(
          SHELL_ASSETS.map(url => cache.add(url).catch(err => {
            console.warn('[SW] Could not cache:', url, err.message);
          }))
        );
      })
      .then(() => {
        console.log('[SW] Install complete. Version:', CACHE_NAME);
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[SW] Cache install failed:', err);
      })
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATE — Clean up old caches
// ─────────────────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => {
              console.log('[SW] Deleting old cache:', key);
              return caches.delete(key);
            })
        );
      })
      .then(() => {
        console.log('[SW] Activated. Claiming clients.');
        return self.clients.claim();
      })
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// FETCH — Intercept and serve requests
// ─────────────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ── Apps Script API calls (POST, cross-origin) ──────────────────────────
  // Strategy: Network-first. On failure, queue for retry.
  if (
    request.method === 'POST' &&
    url.hostname === 'script.google.com'
  ) {
    event.respondWith(handleApiRequest(request.clone()));
    return;
  }

  // ── Shell assets (same-origin, GET) ────────────────────────────────────
  // Strategy: Cache-first. If not in cache, try network and cache the result.
  if (request.method === 'GET' && url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request)
        .then((cached) => {
          if (cached) return cached;

          return fetch(request)
            .then((networkResponse) => {
              // Cache successful GET responses for the shell
              if (networkResponse && networkResponse.status === 200) {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
              }
              return networkResponse;
            })
            .catch(() => {
              // Offline and not in cache — return the shell index for navigation
              if (request.mode === 'navigate') {
                return caches.match('./index.html');
              }
              return new Response('Offline — resource not available.', {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'text/plain' },
              });
            });
        })
    );
    return;
  }

  // ── All other requests — pass through to network ─────────────────────
  event.respondWith(fetch(request).catch(() => {
    return new Response('Network error.', { status: 503 });
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
// API REQUEST HANDLER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attempts to fetch an API request from the network.
 * If the network is unavailable, queues the request body for later replay
 * and returns a synthetic offline response to the caller.
 *
 * @param {Request} request - The original fetch Request.
 * @returns {Promise<Response>}
 */
async function handleApiRequest(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch (networkErr) {
    // Network failed — queue the request body for replay
    try {
      const body = await request.text();
      await enqueueRequest(request.url, body);
      notifyClientsOffline();
    } catch (queueErr) {
      console.error('[SW] Failed to queue API request:', queueErr);
    }

    // Return a structured offline response the client can detect
    return new Response(
      JSON.stringify({
        success: false,
        error:   'OFFLINE: Your request has been queued and will retry when connectivity is restored.',
        code:    503,
        offline: true,
      }),
      {
        status:  503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND SYNC — Queue management using IndexedDB
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens the IndexedDB database used for the API queue.
 * Creates the object store on first open.
 *
 * @returns {Promise<IDBDatabase>}
 */
function openQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('drishti_queue', 1);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, {
          keyPath:     'id',
          autoIncrement: true,
        });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Adds a failed API request to the IndexedDB queue.
 *
 * @param {string} url  - The API endpoint URL.
 * @param {string} body - Serialised JSON request body.
 * @returns {Promise<void>}
 */
async function enqueueRequest(url, body) {
  const db = await openQueueDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const item  = { url, body, timestamp: Date.now(), attempts: 0 };
    const req   = store.add(item);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Replays all queued API requests when the network comes back online.
 * Successfully replayed requests are removed from the queue.
 * Requests that fail again (max 3 attempts) are also removed to prevent
 * stale data accumulation.
 *
 * @returns {Promise<void>}
 */
async function replayQueuedRequests() {
  let db;
  try { db = await openQueueDB(); } catch { return; }

  const items = await new Promise((resolve, reject) => {
    const tx    = db.transaction(QUEUE_STORE, 'readonly');
    const store = tx.objectStore(QUEUE_STORE);
    const req   = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });

  if (!items.length) return;

  console.log('[SW] Replaying', items.length, 'queued request(s).');

  for (const item of items) {
    let shouldDelete = false;
    try {
      const response = await fetch(item.url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    item.body,
      });
      if (response.ok) {
        shouldDelete = true;
        console.log('[SW] Queued request replayed successfully. ID:', item.id);
      } else {
        // Server error — delete to avoid retrying bad requests indefinitely
        shouldDelete = item.attempts >= 2;
      }
    } catch {
      // Still offline — leave in queue for next attempt
      shouldDelete = item.attempts >= 2;
    }

    if (shouldDelete) {
      await deleteQueuedRequest(db, item.id);
    } else {
      await incrementAttempts(db, item.id, item.attempts);
    }
  }

  // Notify clients that queued requests have been replayed
  notifyClientsOnline();
}

/**
 * Deletes a queued request by its IndexedDB key.
 * @param {IDBDatabase} db
 * @param {number} id
 * @returns {Promise<void>}
 */
function deleteQueuedRequest(db, id) {
  return new Promise((resolve) => {
    const tx  = db.transaction(QUEUE_STORE, 'readwrite');
    const req = tx.objectStore(QUEUE_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => resolve(); // Non-fatal
  });
}

/**
 * Increments the attempt counter for a queued request.
 * @param {IDBDatabase} db
 * @param {number} id
 * @param {number} current
 * @returns {Promise<void>}
 */
function incrementAttempts(db, id, current) {
  return new Promise((resolve) => {
    const tx    = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      if (getReq.result) {
        getReq.result.attempts = (current || 0) + 1;
        store.put(getReq.result);
      }
      resolve();
    };
    getReq.onerror = () => resolve();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNC EVENT — Background sync when connection is restored
// ─────────────────────────────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'drishti-api-retry') {
    event.waitUntil(replayQueuedRequests());
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE — Handle messages from the main thread
// ─────────────────────────────────────────────────────────────────────────────

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'RETRY_QUEUE') {
    replayQueuedRequests();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Broadcasts an offline message to all connected clients.
 * The main app listens for this and shows the offline banner.
 */
function notifyClientsOffline() {
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    clients.forEach((client) => client.postMessage({ type: 'SW_OFFLINE' }));
  });
}

/**
 * Broadcasts an online/sync-complete message to all connected clients.
 */
function notifyClientsOnline() {
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    clients.forEach((client) => client.postMessage({ type: 'SW_ONLINE', replayed: true }));
  });
}
