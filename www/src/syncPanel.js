/**
 * The Sync panel: everything the user can see or do about Dropbox sync.
 *
 * Kept out of `app.js` so the bootstrap stays a sequence of decisions rather
 * than a pile of DOM wiring, and out of the Sync panel dialog in `index.html`
 * so the markup stays markup.
 *
 * Two rules this module exists to hold to:
 *
 * - It never reports success it cannot back up. The status line is driven by the
 *   scheduler's reported state, and "not connected" is shown as exactly that
 *   rather than as a silent failure.
 * - It always shows the redirect URI it is about to send. Dropbox matches that
 *   string exactly and reports a mismatch as `invalid_redirect_uri`, naming
 *   nothing about which half was wrong — so the user has to be able to see it.
 */

import { dropboxProvider } from './sync/providerFactory.js'
import { beginAuthCallback, takeAuthError } from './sync/oauthCallback.js'
import { countRecords } from './sync/merge.js'
import { readSnapshot } from './storage.js'
import { updateMenuLock } from './render.js'
import { fireAndForget } from './sync/fireAndForget.js'

const STATUS_TEXT = {
  idle: 'Up to date',
  syncing: 'Syncing…',
  error: 'Sync problem'
}

/** Header indicator labels. Every state has one — none of them is blank. */
const PILL_TEXT = {
  disconnected: '☁ Not synced',
  syncing: '⟳ Syncing…',
  pending: '⟳ Pending…',
  saved: '☁ Saved',
  error: '⚡ Sync problem'
}

/**
 * Wire the panel to a scheduler.
 *
 * @param {object} scheduler - the running SyncScheduler
 * @returns {object} callbacks the bootstrap needs: refresh after a data change
 *   landed, and the current connection state
 */
export function createSyncPanel (scheduler) {
  const els = {
    open: document.getElementById('global-sync'),
    dialog: document.getElementById('sync-dialog'),
    close: document.getElementById('close-sync'),
    status: document.getElementById('sync-state'),
    detail: document.getElementById('sync-detail'),
    connect: document.getElementById('sync-connect'),
    disconnect: document.getElementById('sync-disconnect'),
    syncNow: document.getElementById('sync-now'),
    records: document.getElementById('sync-records'),
    pill: document.getElementById('sync-status')
  }

  let connected = false

  function setConnected (value) {
    connected = value
    if (els.connect) els.connect.hidden = value
    if (els.disconnect) els.disconnect.hidden = !value
  }

  async function refreshConnection () {
    const status = await dropboxProvider().status()
    setConnected(status.authenticated)
    render()
    return status.authenticated
  }

  function render () {
    const status = scheduler.getStatus()

    if (els.status) {
      els.status.textContent = connected
        ? STATUS_TEXT[status.state] || 'Idle'
        : 'Not connected to Dropbox'
      els.status.dataset.state = connected ? status.state : 'disconnected'
    }

    renderPill(status)

    if (els.detail) {
      els.detail.textContent = describe(status, connected)
    }
  }

  /**
   * The header indicator.
   *
   * Always says something. An earlier version deliberately showed *nothing* when
   * Dropbox was not connected, on the reasoning that a blank pill is neutral —
   * but it made the feature undiscoverable, since the only other entry point is
   * one item in a menu nobody opens. Neutral and invisible turned out to be the
   * same thing.
   *
   * The rule that still holds is the one that mattered: it never says "saved"
   * unless there is a working connection. Disconnected and up-to-date have to
   * look different, because the user cannot act on "your work is on the other
   * device" while there is no other device to put it on.
   */
  function renderPill (status) {
    const pill = els.pill
    if (!pill) return

    if (!connected) {
      pill.textContent = PILL_TEXT.disconnected
      pill.className = 'sync-status disconnected'
      // Not decorative: the pill is the only thing on screen that says the app
      // can sync at all, so it is also the route into the panel.
      pill.title = 'Not connected to Dropbox — click to open the Sync panel'
      pill.setAttribute('role', 'button')
      pill.tabIndex = 0
      return
    }

    pill.removeAttribute('role')
    pill.removeAttribute('tabindex')

    if (status.state === 'error') {
      pill.textContent = PILL_TEXT.error
      pill.className = 'sync-status offline'
      pill.title = status.message || 'Sync problem — click for detail'
    } else if (status.state === 'syncing') {
      pill.textContent = PILL_TEXT.syncing
      pill.className = 'sync-status syncing'
      pill.title = 'Syncing…'
    } else if (status.pending) {
      pill.textContent = PILL_TEXT.pending
      pill.className = 'sync-status syncing'
      pill.title = 'Waiting to send your latest changes…'
    } else {
      pill.textContent = PILL_TEXT.saved
      pill.className = 'sync-status synced'
      pill.title = 'Saved to Dropbox'
    }
  }

  function describe (status, isConnected) {
    if (!isConnected) {
      return 'Your checklists stay in this browser. Connect Dropbox to carry them to another device.'
    }
    if (status.pending) return 'Waiting to send your latest changes…'
    if (status.state === 'error') return status.message || 'Sync failed.'
    if (status.lastSyncAt) return `Last synced ${formatTime(status.lastSyncAt)}.`
    return 'Connected. Syncing shortly…'
  }

  function formatTime (iso) {
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
  }

  async function connect () {
    try {
      const { url } = await dropboxProvider().beginAuth(randomState())
      // A full navigation, not a fetch: the redirect is what carries the
      // authorisation code back, and it has to land on this page for the
      // callback to find it.
      window.location.assign(url)
    } catch (err) {
      showError(err)
    }
  }

  async function disconnect () {
    try {
      // Local data is untouched. Signing out of the sync provider must never be
      // the same as deleting a user's checklists.
      await dropboxProvider().signOut()
      await refreshConnection()
    } catch (err) {
      showError(err)
    }
  }

  function showError (err) {
    if (!els.detail) return
    els.detail.textContent = err instanceof Error ? err.message : String(err)
  }

  // ── Wiring ──────────────────────────────────────────────────────────────────

  els.open?.addEventListener('click', () => {
    els.dialog.style.display = 'flex'
    /*
     * Close the menu this was opened from.
     *
     * `controls.js` only closes menus for clicks *outside* them, and this
     * button is inside one — so without this the ☰ menu stays open directly
     * behind the dialog. About does the same thing explicitly.
     */
    document.querySelectorAll('.context-menu.open').forEach((menu) => menu.classList.remove('open'))
    updateMenuLock()
    takeAuthError()
    refreshConnection()
  })

  els.close?.addEventListener('click', (evt) => {
    evt.stopPropagation()
    els.dialog.style.display = 'none'
  })

  els.dialog?.addEventListener('click', (evt) => {
    if (evt.target === els.dialog) els.dialog.style.display = 'none'
  })

  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape' && els.dialog?.style.display === 'flex') {
      els.dialog.style.display = 'none'
    }
  })

  els.connect?.addEventListener('click', connect)
  els.disconnect?.addEventListener('click', disconnect)

  els.syncNow?.addEventListener('click', async () => {
    els.syncNow.disabled = true
    try {
      await scheduler.syncNow()
      render()
    } finally {
      els.syncNow.disabled = false
    }
  })

  /*
   * The indicator is the route into the panel.
   *
   * It carries the only on-screen signal that the app can sync at all, so making
   * it inert would leave the feature reachable only by opening a menu. Also
   * handled from the keyboard, because `tabIndex` and `role="button"` are set in
   * `renderPill` only while disconnected — this listener is unconditional so it
   * cannot fall out of step with what the pill claims to be.
   */
  const openPanel = () => els.open?.click()
  els.pill?.addEventListener('click', openPanel)
  els.pill?.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter' || evt.key === ' ') {
      evt.preventDefault()
      openPanel()
    }
  })

  // ── Startup ────────────────────────────────────────────────────────────────

  scheduler.onStatus = render

  /*
   * Wait for the redirect exchange before asking the provider whether it is
   * connected. Racing them reports "not connected" for an authorisation that
   * actually worked, and the panel then offers Connect for a user who has just
   * connected.
   */
  fireAndForget((async () => {
    await beginAuthCallback()
    await refreshConnection()
    const authError = takeAuthError()
    if (authError && els.detail) els.detail.textContent = authError
    showRecordCount()
  })())

  function showRecordCount () {
    if (!els.records) return
    // Read synchronously rather than importing the store lazily: `app.js` has
    // already loaded it, so a dynamic import would be a second copy of the same
    // module's state rather than anything cheaper.
    const counts = countRecords(readSnapshot())
    els.records.textContent =
      `${counts.live} item${counts.live === 1 ? '' : 's'}` +
      (counts.deleted ? `, ${counts.deleted} deleted (kept so other devices delete them too)` : '')
  }

  return { refresh: render }
}

function randomState () {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
