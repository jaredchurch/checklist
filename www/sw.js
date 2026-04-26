const CACHE_NAME = 'checklist-pwa-v1'
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/src/main.js',
  '/src/app.js',
  '/src/auth.js',
  '/src/firebase.js',
  '/src/sync.js',
  '/src/storage.js',
  '/src/controls.js',
  '/src/render.js',
  '/src/tree.js',
  '/src/dialogs.js',
  '/src/sorting.js',
  '/src/utils.js',
  '/src/style.css',
  '/src/firebase-config.js',
  '/icons/favicon-180.png',
  '/favicon.ico'
]

// ── Install: pre-cache app shell ─────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // addAll fails the whole install if any asset 404s; use individual puts
      return Promise.allSettled(
        PRECACHE_ASSETS.map(url =>
          fetch(url).then(res => {
            if (res.ok) cache.put(url, res)
          }).catch(() => { /* ignore missing assets during install */ })
        )
      )
    })
  )
})

// ── Activate: clean up old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    })
  )
})

// ── Fetch: network-first with cache fallback ──────────────────────────────────
self.addEventListener('fetch', event => {
  // Only handle GET requests for our assets
  if (event.request.method !== 'GET') return

  event.respondWith(
    fetch(event.request)
      .then(networkRes => {
        // Only cache successful responses for our own origin
        const isInternal = event.request.url.startsWith(self.location.origin)
        if (networkRes.ok && isInternal) {
          const cacheCopy = networkRes.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, cacheCopy))
        }
        return networkRes
      })
      .catch(() => {
        // Fallback to cache if network fails
        return caches.match(event.request).then(cachedRes => {
          if (cachedRes) return cachedRes

          // If it's a navigation request and we're offline, return index.html
          if (event.request.mode === 'navigate') {
            return caches.match('/')
          }
        })
      })
  )
})
