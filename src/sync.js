/**
 * Sync engine — bridges local IndexedDB cache and Firestore cloud store.
 *
 * Strategy
 * ────────
 * • Local writes are always instant (offline-first).
 * • When online, every local save is also pushed to Firestore with a
 *   client-side timestamp.
 * • Firestore real-time listener pushes remote changes back; if the remote
 *   updatedAt is newer than the last local save the remote wins (last-write-wins).
 * • While offline, writes are queued in IndexedDB and flushed when the
 *   connection is restored.
 * • The sync status indicator keeps the user informed.
 */

import { get, set } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm'
import {
  saveToFirestore,
  loadFromFirestore,
  subscribeToFirestore,
  isFirebaseConfigured
} from './firebase.js'
import { saveData } from './storage.js'

const IDB_KEY_DATA          = 'checklist-cloud-data-v1'
const IDB_KEY_PENDING       = 'checklist-pending-sync-v1'
const IDB_KEY_LAST_SAVED_AT = 'checklist-last-saved-at-v1'

let _uid          = null
let _onRemoteData = null   // (data) => void  — called when remote wins
let _unsubscribe  = null   // Firestore real-time listener teardown
let _pendingFlush = null   // setTimeout handle for debounced flush

// ── Initialise for a signed-in user ─────────────────────────────────────────
export async function initSync (uid, onRemoteData) {
  _uid          = uid
  _onRemoteData = onRemoteData

  if (!isFirebaseConfigured()) {
    setSyncStatus('local')
    return
  }

  setSyncStatus('syncing')

  // 1. Try to get the latest from Firestore first
  try {
    const remote = await loadFromFirestore(uid)
    if (remote?.data) {
      const remotTs  = remote.updatedAt?.toMillis?.() || 0
      const localTs  = (await get(IDB_KEY_LAST_SAVED_AT)) || 0

      if (remotTs > localTs) {
        // Remote is newer — adopt it
        await set(IDB_KEY_DATA, remote.data)
        await set(IDB_KEY_LAST_SAVED_AT, remotTs)
        saveData(remote.data)          // write through to localStorage
        _onRemoteData?.(remote.data)
      }
    }
  } catch (_) {
    // Offline or error — will retry on next save
  }

  // 2. Flush any pending offline writes
  await flushPending()

  // 3. Subscribe to real-time updates
  _unsubscribe = subscribeToFirestore(uid, async remote => {
    if (!remote?.data) return
    const remotTs = remote.updatedAt?.toMillis?.() || 0
    const localTs = (await get(IDB_KEY_LAST_SAVED_AT)) || 0

    if (remotTs > localTs) {
      await set(IDB_KEY_DATA, remote.data)
      await set(IDB_KEY_LAST_SAVED_AT, remotTs)
      saveData(remote.data)
      _onRemoteData?.(remote.data)
      setSyncStatus('synced')
    }
  })

  setSyncStatus('synced')
}

// ── Tear down when user signs out ────────────────────────────────────────────
export function teardownSync () {
  _unsubscribe?.()
  _unsubscribe  = null
  _uid          = null
  _onRemoteData = null
  clearTimeout(_pendingFlush)
  setSyncStatus('local')
}

// ── Called by app on every local data change ─────────────────────────────────
export async function syncSave (data) {
  const now = Date.now()

  // Always persist locally first
  await set(IDB_KEY_DATA, data)
  await set(IDB_KEY_LAST_SAVED_AT, now)

  if (!_uid || !isFirebaseConfigured()) return

  if (!navigator.onLine) {
    // Queue for later
    await set(IDB_KEY_PENDING, { data, queuedAt: now })
    setSyncStatus('offline')
    return
  }

  setSyncStatus('syncing')
  clearTimeout(_pendingFlush)
  _pendingFlush = setTimeout(async () => {
    try {
      await saveToFirestore(_uid, data)
      await set(IDB_KEY_PENDING, null)
      setSyncStatus('synced')
    } catch (_) {
      // Network blip — queue it
      await set(IDB_KEY_PENDING, { data, queuedAt: now })
      setSyncStatus('offline')
    }
  }, 600)  // debounce: coalesce rapid edits into one Firestore write
}

// ── Flush offline queue when connection returns ───────────────────────────────
async function flushPending () {
  if (!_uid || !isFirebaseConfigured() || !navigator.onLine) return
  const pending = await get(IDB_KEY_PENDING)
  if (!pending?.data) return

  try {
    await saveToFirestore(_uid, pending.data)
    await set(IDB_KEY_PENDING, null)
    setSyncStatus('synced')
  } catch (_) {
    setSyncStatus('offline')
  }
}

// Wire up online/offline events once
window.addEventListener('online',  () => { flushPending() })
window.addEventListener('offline', () => { setSyncStatus('offline') })

// ── Sync status indicator ────────────────────────────────────────────────────
const STATUS_LABELS = {
  local:   { text: '',               cls: '' },
  syncing: { text: '⟳ Syncing…',    cls: 'syncing' },
  synced:  { text: '✓ Saved',       cls: 'synced' },
  offline: { text: '⚡ Offline',    cls: 'offline' }
}

let _clearTimer = null

function setSyncStatus (key) {
  const el = document.getElementById('sync-status')
  if (!el) return
  const { text, cls } = STATUS_LABELS[key] || STATUS_LABELS.local
  el.textContent  = text
  el.className    = 'sync-status ' + cls

  // Auto-clear "Saved" after 2 s
  clearTimeout(_clearTimer)
  if (key === 'synced') {
    _clearTimer = setTimeout(() => setSyncStatus('local'), 2000)
  }
}
