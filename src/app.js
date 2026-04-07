/**
 * Checklist PWA — Main Application Entry Point
 *
 * Initialisation order:
 *  1. Firebase (if configured)
 *  2. Auth overlay wiring
 *  3. On sign-in  → initSync → load data (remote wins if newer) → render
 *  4. On sign-out → teardownSync → keep local data → render
 *  5. No Firebase → skip auth entirely, render with local data only
 */

import { getData, registerSyncHook } from './storage.js'
import { registerControls } from './controls.js'
import { render, initState } from './render.js'
import { initFirebase, isFirebaseConfigured } from './firebase.js'
import { initAuth, bindAuthOverlay, signOut } from './auth.js'
import { initSync, syncSave, teardownSync } from './sync.js'

// ── Bootstrap ────────────────────────────────────────────────────────────────
function init () {
  document.title = 'Checklist'

  // Try to start Firebase (will be a no-op if window.__FIREBASE_CONFIG__ absent)
  initFirebase()

  // Wire up the sync hook so storage.js pushes saves to the cloud
  registerSyncHook(syncSave)

  // Shared mutable refs — all modules read/write through these
  const nodesRef       = { current: null }
  const currentPathRef = { current: [] }

  // Core render closure
  const renderFn = () => {
    render(() => renderFn(), nodesRef, currentPathRef)
  }

  // ── Helper: boot the app with a given dataset ──────────────────────────────
  function bootApp (data) {
    nodesRef.current       = data
    currentPathRef.current = []
    initState(data)
    renderFn()
  }

  // ── Auth callbacks ─────────────────────────────────────────────────────────
  async function onSignedIn (user) {
    // Pull remote data; sync engine will call saveData/onRemoteData if newer
    await initSync(user.uid, remoteData => {
      nodesRef.current       = remoteData
      currentPathRef.current = []
      initState(remoteData)
      renderFn()
    })

    // Use whatever data is now in localStorage (may have been updated by sync)
    const data = getData()
    bootApp(data)
  }

  function onSignedOut () {
    teardownSync()
    // Keep showing local data — don't wipe it
    const data = getData()
    bootApp(data)
  }

  // ── Register controls (once, independent of auth state) ───────────────────
  registerControls(nodesRef, currentPathRef, renderFn)

  // ── Auth ───────────────────────────────────────────────────────────────────
  if (isFirebaseConfigured()) {
    // Bind the overlay UI buttons
    bindAuthOverlay()

    // Wire sign-out button in header
    document.getElementById('auth-signout-btn')
      ?.addEventListener('click', () => signOut())

    // Start watching auth state
    initAuth({ onSignedIn, onSignedOut })
  } else {
    // No Firebase — pure local mode, render immediately
    const data = getData()
    bootApp(data)
  }

  // ── PWA service worker ────────────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log('Service worker registered'))
      .catch(err => console.error('SW registration failed', err))
  }

  // ── Commit info in About dialog ───────────────────────────────────────────
  fetchCommitInfo()
}

// ── Commit info ──────────────────────────────────────────────────────────────
async function fetchCommitInfo () {
  const el = document.getElementById('about-commit-info')
  if (!el) return
  const owner = 'jaredchurch', repo = 'checklist'
  try {
    let branch = 'main'
    const pagesResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/pages`)
    if (pagesResp.ok) {
      branch = (await pagesResp.json()).source?.branch || branch
    }
    const commitResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${branch}`)
    if (!commitResp.ok) throw new Error(commitResp.status)
    const commit = await commitResp.json()
    const hash = commit.sha.slice(0, 7)
    const date = new Date(commit.commit.committer.date).toLocaleString()
    el.textContent = `Commit ${hash} @ ${date} (${branch})`
  } catch {
    el.textContent = 'Commit info unavailable'
  }
}

window.addEventListener('load', init)

export { init }
