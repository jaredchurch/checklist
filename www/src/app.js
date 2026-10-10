/**
 * Checklist PWA — Main Application Entry Point
 *
 * Initialisation order:
 *  1. Load local data (IndexedDB is not used; localStorage holds everything)
 *  2. Start the sync scheduler, which runs a cycle on load
 *  3. Render, and re-render whenever sync writes back merged remote data
 *
 * Local-first, throughout: nothing in the boot path waits on the network. If
 * Dropbox is unreachable, slow, or not set up at all, the app renders exactly
 * as it would offline.
 */

import { createListNode } from './tree.js'
import { getData, saveData, readSnapshot, writeSnapshot, subscribeRevision, readLastRev, writeLastRev, readLastSyncAt, writeLastSyncAt } from './storage.js'
import { registerControls } from './controls.js'
import { render, initState } from './render.js'
import { SyncScheduler } from './sync/scheduler.js'
import { dropboxProvider, REMOTE_PATH } from './sync/providerFactory.js'
import { createSyncPanel } from './syncPanel.js'
import { fireAndForget } from './sync/fireAndForget.js'

function init () {
  document.title = 'Checklist'

  // Shared mutable refs — all modules read/write through these
  const nodesRef = { current: null }
  const currentPathRef = { current: [] }

  // Core render closure
  const renderFn = () => {
    render(() => renderFn(), nodesRef, currentPathRef)
  }

  // ── Boot with a given dataset ─────────────────────────────────────────────
  function bootApp (data) {
    const defaultList = createListNode('My Checklist')
    nodesRef.current = data || defaultList
    currentPathRef.current = []
    initState(nodesRef.current)
    if (!data) saveData(nodesRef.current)
    renderFn()
  }

  // ── Sync ───────────────────────────────────────────────────────────────────
  // Held in a `let` because the panel is built after the scheduler, and the
  // scheduler is the only thing that discovers a credential has died.
  let syncPanel = null

  const scheduler = new SyncScheduler({
    provider: dropboxProvider(),
    path: REMOTE_PATH,
    readLocal: async () => readSnapshot(),
    /*
     * The engine writes the merged union back through here. The tree the user is
     * looking at is replaced with it, so a change made on another device
     * appears without a reload.
     */
    writeLocal: async (snapshot) => {
      nodesRef.current = writeSnapshot(snapshot)
      currentPathRef.current = []
      initState(nodesRef.current)
      renderFn()
    },
    readLastRev: async () => readLastRev(),
    writeLastRev: async (rev) => writeLastRev(rev),
    readLastSyncAt: async () => readLastSyncAt(),
    writeLastSyncAt: async (at) => writeLastSyncAt(at),
    subscribeRevision,
    // The panel owns the connection state, and the scheduler is the only thing
    // that discovers a credential has expired or been revoked. Without this the
    // app would carry on showing "connected" after it had just signed out, and
    // never offer the Connect button that would fix it.
    onAuthLost: () => syncPanel?.refresh()
  })

  syncPanel = createSyncPanel(scheduler)

  registerControls(nodesRef, currentPathRef, renderFn)

  // Load local data first so the app is usable before sync has said anything.
  bootApp(getData())

  // Started without awaiting: a slow or unreachable Dropbox must never delay
  // the app becoming usable. The scheduler serialises its own cycles.
  fireAndForget(scheduler.start())

  // ── PWA service worker ───────────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/www/sw.js')
      .then(() => console.log('Service worker registered'))
      .catch(err => console.error('SW registration failed', err))
  }
}

window.addEventListener('load', init)

export { init }
