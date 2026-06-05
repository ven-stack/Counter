const CACHE = 'counter-v3';
const ASSETS = ['./', './index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];
const DB_NAME = 'counterDB', DB_STORE = 'state', DB_KEY = 'count';
const NOTIF_TAG = 'counter-live';

// ── Cache ─────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});

// ── IndexedDB helpers ─────────────────────────────────────────
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(DB_STORE);
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

async function dbGet() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_KEY);
    req.onsuccess = () => res(req.result ?? 0);
    req.onerror   = e => rej(e.target.error);
  });
}

async function dbSet(val) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(val, DB_KEY);
    tx.oncomplete = () => res(val);
    tx.onerror    = e => rej(e.target.error);
  });
}

// ── Notification helpers ──────────────────────────────────────
function notifBody(count) {
  if (count === 0) return 'Counter is at zero';
  if (count > 0)  return `Counting up ▲`;
  return `Counting down ▼`;
}

async function showNotification(count) {
  await self.registration.showNotification('COUNT UNIT — MODEL 7', {
    tag:          NOTIF_TAG,
    renotify:     false,
    silent:       true,
    body:         notifBody(count),
    icon:         'icons/icon-192.png',
    badge:        'icons/icon-192.png',
    ongoing:      true,
    actions: [
      { action: 'dec', title: '−' },
      { action: 'rst', title: String(count) },
      { action: 'inc', title: '+' },
    ],
    data: { count }
  });
}

async function closeNotification() {
  const notifs = await self.registration.getNotifications({ tag: NOTIF_TAG });
  notifs.forEach(n => n.close());
}

// ── Broadcast updated count to open pages ─────────────────────
async function broadcastCount(count) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(c => c.postMessage({ type: 'COUNT_UPDATED', count }));
}

// ── Messages from page ────────────────────────────────────────
self.addEventListener('message', async (e) => {
  if (e.data?.type === 'UPDATE_NOTIF') {
    await showNotification(e.data.count);
  }
  if (e.data?.type === 'CLOSE_NOTIF') {
    await closeNotification();
  }
});

// ── Notification action buttons ───────────────────────────────
self.addEventListener('notificationclick', async (e) => {
  e.notification.close();

  const action = e.action;
  let count = await dbGet();

  if (action === 'inc') count += 1;
  else if (action === 'dec') count -= 1;
  else if (action === 'rst') count = 0;
  else {
    // Tapped the notification body — focus or open app
    e.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        if (clients.length) return clients[0].focus();
        return self.clients.openWindow('./');
      })
    );
    return;
  }

  e.waitUntil((async () => {
    await dbSet(count);
    await showNotification(count);
    await broadcastCount(count);
  })());
});
