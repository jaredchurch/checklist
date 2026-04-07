/**
 * Service Worker — Checklist PWA
 *
 * Strategy: Cache-first for app shell assets, network-first for API calls.
 * Offline fallback to index.html for navigation requests.
 */

const CACHE_NAME = 'checklist-pwa-v3'

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
  '/icons/favicon-180.png'
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
          }).catch(() => {/* ignore missing assets during install */})
        )
      )
    })
  )
  self.skipWaiting()
})

// ── Activate: prune old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  )
  self.clients.claim()
})

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event

  // Only handle GET requests
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Skip Firebase / Google APIs — let them go straight to network
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('google') ||
    url.hostname.includes('gstatic') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('firestore')
  ) return

  // Navigation requests: network-first, fall back to cached index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone()
          caches.open(CACHE_NAME).then(c => c.put(request, clone))
          return res
        })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  // App shell assets: cache-first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone()
          caches.open(CACHE_NAME).then(c => c.put(request, clone))
        }
        return res
      }).catch(() => caches.match('/index.html'))
    })
  )
})
