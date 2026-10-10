import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The Sync panel's job is to *surface* the integration, so this suite loads the
 * real `index.html` rather than a hand-built fixture. A fixture would agree with
 * the panel by construction and so could never catch the panel pointing at an id
 * the page does not have, or an entry point that exists but is unreachable.
 *
 * Read from the project root rather than relative to this file: under vitest
 * `import.meta.url` is not a `file:` URL, so `fileURLToPath` cannot be used.
 */
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

let connected = false

vi.mock('../sync/providerFactory.js', () => ({
  dropboxProvider: () => ({
    status: async () => ({ authenticated: connected }),
    beginAuth: async () => ({ url: 'https://www.dropbox.com/oauth2/authorize?stub=1' }),
    completeAuth: async () => {},
    signOut: async () => { connected = false }
  }),
  REMOTE_PATH: 'checklist.json'
}))

vi.mock('../sync/oauthCallback.js', () => ({
  beginAuthCallback: async () => true,
  takeAuthError: () => null
}))

vi.mock('../storage.js', () => ({
  readSnapshot: () => ({
    schemaVersion: 1,
    rootId: 'root',
    nodes: {
      root: { id: 'root', type: 'list', title: 'Root', parentId: null, order: 1, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null },
      gone: { id: 'gone', type: 'item', title: 'Gone', parentId: 'root', order: 2, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: '2026-01-02T00:00:00.000Z' }
    }
  })
}))

const { createSyncPanel } = await import('../syncPanel.js')

/** A scheduler stub, since this suite is about the panel's presentation of it. */
function fakeScheduler (overrides = {}) {
  return {
    getStatus: () => ({
      state: 'idle',
      lastSyncAt: null,
      message: null,
      pending: false,
      lastOutcome: null,
      lastRev: null
    }),
    onStatus: null,
    syncNow: async () => null,
    ...overrides
  }
}

const $ = (id) => document.getElementById(id)

beforeEach(() => {
  connected = false
  document.body.innerHTML = html.replace(/<!DOCTYPE[^>]*>|<html[^>]*>|<\/html>|<head>[\s\S]*?<\/head>|<body[^>]*>|<\/body>/g, '')
  window.localStorage.clear()
})

describe('discoverability', () => {
  it('has an entry point in the main context menu', () => {
    const entry = $('global-sync')

    expect(entry).not.toBeNull()
    // It has to live inside the menu that is actually rendered, not merely
    // somewhere in the document.
    expect($('global-context').contains(entry)).toBe(true)
    expect(entry.textContent.trim()).toBe('Sync…')
  })

  it('starts closed and opens on click', () => {
    createSyncPanel(fakeScheduler())

    expect($('sync-dialog').style.display).toBe('none')

    $('global-sync').click()

    expect($('sync-dialog').style.display).toBe('flex')
  })

  it('closes the context menu it was opened from', async () => {
    // About does this explicitly (`dialogs.js`), because `controls.js` only
    // closes menus for clicks *outside* them. Without it the ☰ menu stays open
    // on top of the Sync dialog, which is positioned over the same header area.
    const scheduler = fakeScheduler()
    createSyncPanel(scheduler)

    const menu = $('global-context')
    menu.classList.add('open')

    $('global-sync').click()

    expect(menu.classList.contains('open')).toBe(false)
  })

  it('closes again on the close button, on the backdrop, and on Escape', () => {
    createSyncPanel(fakeScheduler())
    const dialog = $('sync-dialog')

    $('global-sync').click()
    $('close-sync').click()
    expect(dialog.style.display).toBe('none')

    $('global-sync').click()
    dialog.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    expect(dialog.style.display).toBe('none')

    $('global-sync').click()
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
    expect(dialog.style.display).toBe('none')
  })
})

describe('connection state', () => {
  it('says plainly that it is not connected, rather than looking like it is fine', async () => {
    const scheduler = fakeScheduler()
    createSyncPanel(scheduler)

    $('global-sync').click()
    await vi.waitFor(() => expect($('sync-state').dataset.state).toBe('disconnected'))

    expect($('sync-state').textContent).toMatch(/not connected/i)
    expect($('sync-connect').hidden).toBe(false)
    expect($('sync-disconnect').hidden).toBe(true)
  })

  it('shows Connect instead of Disconnect once connected', async () => {
    connected = true
    const scheduler = fakeScheduler()
    createSyncPanel(scheduler)

    $('global-sync').click()
    await vi.waitFor(() => expect($('sync-state').dataset.state).toBe('idle'))

    expect($('sync-connect').hidden).toBe(true)
    expect($('sync-disconnect').hidden).toBe(false)
  })

  it('tells the user their data is safe locally while disconnected', async () => {
    createSyncPanel(fakeScheduler())

    $('global-sync').click()
    await vi.waitFor(() => expect($('sync-detail').textContent).not.toBe(''))

    expect($('sync-detail').textContent).toMatch(/this browser/i)
  })

  it('surfaces the record count, including what is kept only to propagate a delete', async () => {
    createSyncPanel(fakeScheduler())

    $('global-sync').click()
    await vi.waitFor(() => expect($('sync-records').textContent).not.toBe(''))

    expect($('sync-records').textContent).toMatch(/1 item/)
    expect($('sync-records').textContent).toMatch(/1 deleted/)
  })
})

describe('the header indicator', () => {
  it('says so when not connected, rather than showing nothing', async () => {
    // An earlier version rendered blank here. That was neutral in principle and
    // invisible in practice: the only other entry point is one item in a menu
    // nobody opens, so the feature had no presence on the page at all.
    createSyncPanel(fakeScheduler())

    await vi.waitFor(() => expect($('sync-status').textContent).not.toBe(''))

    expect($('sync-status').textContent).toMatch(/not synced/i)
    expect($('sync-status').className).toContain('disconnected')
  })

  it('never claims the work is saved while there is no connection', async () => {
    // The one claim this app must never make. Distinct styling is the point:
    // "Saved" with no connection is the user being told their work is on another
    // device when it is not.
    createSyncPanel(fakeScheduler())

    await vi.waitFor(() => expect($('sync-status').textContent).not.toBe(''))

    expect($('sync-status').textContent).not.toMatch(/saved/i)
    expect($('sync-status').className).not.toContain('synced')
  })

  it('shows a saved state once connected', async () => {
    connected = true
    const scheduler = fakeScheduler()
    createSyncPanel(scheduler)

    $('global-sync').click()
    await vi.waitFor(() => expect($('sync-state').dataset.state).toBe('idle'))

    expect($('sync-status').textContent).toMatch(/saved/i)
    expect($('sync-status').className).toContain('synced')
  })

  it('shows pending distinctly from saved, because work is not yet on the device', async () => {
    connected = true
    const scheduler = fakeScheduler({
      getStatus: () => ({ state: 'idle', message: null, pending: true, lastSyncAt: null, lastOutcome: null, lastRev: null })
    })
    createSyncPanel(scheduler)

    $('global-sync').click()
    await vi.waitFor(() => expect($('sync-status').textContent).not.toBe(''))

    expect($('sync-status').textContent).toMatch(/pending/i)
    expect($('sync-status').className).not.toContain('synced')
  })

  it('flags a sync problem rather than showing green', async () => {
    connected = true
    const scheduler = fakeScheduler({
      getStatus: () => ({ state: 'error', message: 'Sync failed: offline', pending: false, lastSyncAt: null, lastOutcome: null, lastRev: null })
    })
    createSyncPanel(scheduler)

    $('global-sync').click()
    await vi.waitFor(() => expect($('sync-state').dataset.state).toBe('error'))

    expect($('sync-status').className).toContain('offline')
    expect($('sync-state').textContent).toMatch(/problem/i)
  })

  it('opens the Sync panel when clicked, since it is the only sign sync exists', async () => {
    createSyncPanel(fakeScheduler())
    await vi.waitFor(() => expect($('sync-status').textContent).not.toBe(''))

    $('sync-status').click()

    expect($('sync-dialog').style.display).toBe('flex')
  })

  it('opens from the keyboard too, matching the role it advertises', async () => {
    createSyncPanel(fakeScheduler())
    await vi.waitFor(() => expect($('sync-status').getAttribute('role')).toBe('button'))

    $('sync-status').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }))

    expect($('sync-dialog').style.display).toBe('flex')
  })
})

describe('what the panel deliberately does not show', () => {
  /*
   * The one-time Dropbox app registration instructions used to live here as a
   * collapsed `<details>`. They are now only in `DROPBOX_SETUP.md`.
   *
   * Two reasons that is the better home: they are needed once per app by whoever
   * maintains it, not once per user who opens the panel; and the redirect URI in
   * particular was a thing to copy once, at registration — not a status to
   * re-read every time sync looks wrong.
   */
  it('has no registration instructions', () => {
    expect(document.querySelector('.sync-setup')).toBeNull()
    expect($('sync-redirect-uri')).toBeNull()
    expect($('sync-remote-path')).toBeNull()
  })

  it('offers no way to type a client id', () => {
    // The key is compiled in and chosen by hostname. A field would let a stale
    // value pair with whichever redirect URI a *different* Dropbox app had
    // registered, which is what produces `invalid_redirect_uri` with nothing
    // useful in the message.
    expect(document.querySelector('input#sync-app-key')).toBeNull()
    expect($('sync-app-key-save')).toBeNull()
  })

  it('still offers the one action that needs no setup: connecting', () => {
    expect($('sync-connect')).not.toBeNull()
    expect($('sync-now')).not.toBeNull()
  })
})
