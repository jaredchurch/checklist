import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncScheduler } from '../sync/scheduler.js'
import { SyncError } from '../sync/provider.js'
import { beginEdit, endEdit, resetEditGate } from '../sync/editGate.js'
import { toEnvelope } from '../sync/envelope.js'
import { SCHEMA_VERSION } from '../sync/snapshot.js'

const node = (id, extra = {}) => ({
  id,
  type: 'item',
  parentId: 'root',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  ...extra
})

const snapshot = (nodes) => ({ schemaVersion: SCHEMA_VERSION, rootId: 'root', nodes })

/**
 * Build a scheduler over fakes.
 *
 * `provider` defaults to a healthy one that has a file and agrees with local
 * data, so a test only has to describe the behaviour it is about.
 */
function build (overrides = {}) {
  const events = { emitted: [], unsubscribed: 0, notify: () => {} }

  const provider = {
    ensureAuth: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    status: vi.fn(async () => ({ authenticated: true })),
    pull: vi.fn(async () => null),
    push: vi.fn(async () => ({ rev: 'r1' })),
    ...overrides.provider
  }

  /*
   * A real subscription rather than a spy, because one of the things under test
   * is that `stop()` actually detaches: a stubbed subscribe would make that
   * untestable by construction.
   */
  let notify = () => {}
  const subscribeRevision = (listener) => {
    notify = listener
    return () => {
      notify = () => {}
      events.unsubscribed += 1
    }
  }

  const scheduler = new SyncScheduler({
    provider,
    path: 'checklist.json',
    debounceMs: 1000,
    now: () => new Date('2026-06-01T00:00:00.000Z'),
    readLocal: overrides.readLocal || (async () => snapshot({ root: node('root', { type: 'list', parentId: null }) })),
    writeLocal: overrides.writeLocal || vi.fn(async () => {}),
    readLastRev: overrides.readLastRev || (async () => null),
    writeLastRev: overrides.writeLastRev || vi.fn(async () => {}),
    readLastSyncAt: overrides.readLastSyncAt || (async () => null),
    writeLastSyncAt: overrides.writeLastSyncAt || vi.fn(async () => {}),
    subscribeRevision,
    onStatus: (status) => events.emitted.push(status),
    onAuthLost: overrides.onAuthLost
  })

  // Exposed so a test can simulate "the user saved something" without reaching
  // into the scheduler.
  events.notify = () => notify()

  return { scheduler, provider, events }
}

/**
 * jsdom exposes `visibilityState` as a getter only, so it has to be redefined
 * rather than assigned.
 */
function setVisibility (value) {
  Object.defineProperty(document, 'visibilityState', {
    value,
    configurable: true
  })
}

beforeEach(() => {
  // Re-armed per test rather than once at module load: the afterEach restores
  // real timers, which left every test after the first one without them.
  vi.useFakeTimers()
  setVisibility('visible')
  resetEditGate()
})

afterEach(() => {
  vi.useRealTimers()
  resetEditGate()
})

describe('scheduling', () => {
  it('coalesces a burst of edits into one cycle', async () => {
    const { scheduler, provider } = build()

    scheduler.schedule()
    scheduler.schedule()
    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(1000)

    expect(provider.pull).toHaveBeenCalledTimes(1)
  })

  it('does not sync before the quiet period has elapsed', async () => {
    const { scheduler, provider } = build()

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(999)

    expect(provider.pull).not.toHaveBeenCalled()
  })

  it('marks work pending the moment it is registered, not when the cycle runs', async () => {
    const { scheduler, events } = build()

    scheduler.schedule()

    // The window in which a user would otherwise ask "is my change on the other
    // device yet?" and get no answer.
    expect(scheduler.getStatus().pending).toBe(true)
    expect(events.emitted.some((s) => s.pending)).toBe(true)
  })

  it('syncs when the tab becomes visible again', async () => {
    const { scheduler, provider } = build()
    await scheduler.start()

    provider.pull.mockClear()
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)

    expect(provider.pull).toHaveBeenCalledTimes(1)
  })

  it('syncs on pagehide, which is the last chance before a tab is discarded', async () => {
    const { scheduler, provider } = build()
    await scheduler.start()
    await vi.advanceTimersByTimeAsync(0)

    provider.pull.mockClear()
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)

    expect(provider.pull).toHaveBeenCalledTimes(1)
  })

  it('does not sync when the tab is hidden', async () => {
    const { scheduler, provider } = build()
    await scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    provider.pull.mockClear()

    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)

    expect(provider.pull).not.toHaveBeenCalled()
  })
})

describe('not overlapping', () => {
  it('runs a cycle arriving mid-flight once afterwards, not in parallel', async () => {
    // Two concurrent cycles are the most likely source of duplicate or lost
    // writes. The first is held open inside the write; the second must wait
    // rather than run beside it.
    let release
    const gate = new Promise((resolve) => { release = resolve })

    const remoteNodes = { root: node('root', { type: 'list', parentId: null }) }
    const localNodes = { ...remoteNodes, extra: node('extra') }

    const provider = {
      ensureAuth: vi.fn(async () => {}),
      signOut: vi.fn(async () => {}),
      pull: vi.fn(async () => ({
        body: JSON.stringify(toEnvelope(snapshot(remoteNodes), new Date('2026-06-01T00:00:00.000Z'))),
        rev: 'r1'
      })),
      push: vi.fn(async () => ({ rev: 'r2' }))
    }

    let inFlight = 0
    let maxConcurrent = 0
    const { scheduler } = build({
      provider,
      readLocal: async () => snapshot(localNodes),
      writeLocal: vi.fn(async () => {
        inFlight += 1
        maxConcurrent = Math.max(maxConcurrent, inFlight)
        await gate
        inFlight -= 1
      })
    })

    const first = scheduler.syncNow()
    expect(await scheduler.syncNow()).toBe(null)

    release()
    await first
    await vi.advanceTimersByTimeAsync(0)

    expect(maxConcurrent).toBe(1)
  })
})

describe('status', () => {
  it('settles to idle and records the time after a successful cycle', async () => {
    const { scheduler } = build()

    await scheduler.start()

    expect(scheduler.getStatus()).toMatchObject({
      state: 'idle',
      lastSyncAt: '2026-06-01T00:00:00.000Z',
      message: null
    })
  })

  it('clears pending once the cycle that read the work has finished', async () => {
    const { scheduler } = build()

    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(1000)

    expect(scheduler.getStatus().pending).toBe(false)
  })

  it('keeps pending lit when a write lands during the cycle', async () => {
    // Clearing it unconditionally misreported the whole debounce window as
    // synced. Nothing was lost, but the indicator was wrong in exactly the
    // window it exists to describe.
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const provider = {
      ensureAuth: vi.fn(async () => {}),
      signOut: vi.fn(async () => {}),
      pull: vi.fn(async () => { await gate; return null }),
      push: vi.fn(async () => ({ rev: 'r1' }))
    }
    const { scheduler } = build({ provider })

    const running = scheduler.syncNow()
    scheduler.schedule()
    release()
    await running
    await vi.advanceTimersByTimeAsync(0)

    expect(scheduler.getStatus().pending).toBe(true)
  })

  it('reports the remote revision it last published', async () => {
    const { scheduler } = build({ readLastRev: async () => 'rev-42' })

    await scheduler.start()

    expect(scheduler.getStatus().lastRev).toBe('rev-42')
  })
})

describe('credential loss', () => {
  it('discards a token the provider reports as unusable, and says so', async () => {
    // Without this the indicator showed "Synced" indefinitely and the Connect
    // button never came back — the app telling the user their work was on the
    // other device when it was not.
    const { scheduler, provider } = build({
      provider: { ensureAuth: vi.fn(async () => { throw new SyncError('auth', 'expired') }) }
    })

    await scheduler.start()

    expect(provider.signOut).toHaveBeenCalled()
    expect(scheduler.getStatus()).toMatchObject({ state: 'error' })
    expect(scheduler.getStatus().message).toMatch(/expired or is no longer valid/)
  })

  it('tells whoever owns the connection state, or the app goes on claiming one', async () => {
    const onAuthLost = vi.fn()
    const { scheduler } = build({
      provider: { ensureAuth: vi.fn(async () => { throw new SyncError('auth', 'expired') }) },
      onAuthLost
    })

    await scheduler.start()

    expect(onAuthLost).toHaveBeenCalled()
  })

  it('discards a token with no scopes and explains where the fix is', async () => {
    // Reauthorising cannot fix this — the Dropbox app console is missing a
    // scope — and a Connect button reappearing with no explanation would be the
    // only clue the user got.
    const { scheduler, provider } = build({
      provider: {
        ensureAuth: vi.fn(async () => {}),
        pull: vi.fn(async () => { throw new SyncError('scope-missing', 'no scopes') })
      }
    })

    await scheduler.start()

    expect(provider.signOut).toHaveBeenCalled()
    expect(scheduler.getStatus().message).toContain('App Console')
  })
})

describe('failure handling', () => {
  it('retries a network failure on a timer', async () => {
    const provider = {
      ensureAuth: vi.fn(async () => {}),
      signOut: vi.fn(async () => {}),
      pull: vi.fn(async () => { throw new SyncError('network', 'offline') }),
      push: vi.fn(async () => ({ rev: 'r1' }))
    }
    const { scheduler } = build({ provider })

    await scheduler.start()
    expect(scheduler.getStatus().state).toBe('error')

    provider.pull.mockResolvedValue(null)
    await vi.advanceTimersByTimeAsync(5000)

    expect(scheduler.getStatus().state).toBe('idle')
  })

  it('gives up after a bounded number of retries', async () => {
    const provider = {
      ensureAuth: vi.fn(async () => {}),
      signOut: vi.fn(async () => {}),
      pull: vi.fn(async () => { throw new SyncError('network', 'offline') }),
      push: vi.fn(async () => ({ rev: 'r1' }))
    }
    const { scheduler } = build({ provider })

    await scheduler.start()
    await vi.advanceTimersByTimeAsync(5000 + 30000 + 120000)
    const callsAfterBudget = provider.pull.mock.calls.length
    await vi.advanceTimersByTimeAsync(600000)

    expect(provider.pull.mock.calls.length).toBe(callsAfterBudget)
  })

  it('does not retry a rejected credential, which waiting cannot fix', async () => {
    const provider = {
      ensureAuth: vi.fn(async () => {}),
      signOut: vi.fn(async () => {}),
      pull: vi.fn(async () => { throw new SyncError('rate-limited', 'slow down') }),
      push: vi.fn(async () => ({ rev: 'r1' }))
    }
    const { scheduler } = build({ provider })
    await scheduler.start()

    provider.pull.mockRejectedValueOnce(new SyncError('auth', 'expired'))
    await vi.advanceTimersByTimeAsync(5000)
    const afterFirst = provider.pull.mock.calls.length

    await vi.advanceTimersByTimeAsync(600000)

    expect(provider.pull.mock.calls.length).toBe(afterFirst)
  })

  it('disarms a stale retry once a manual sync succeeds', async () => {
    // Otherwise a retry left over from an outage keeps firing after the problem
    // has gone.
    const provider = {
      ensureAuth: vi.fn(async () => {}),
      signOut: vi.fn(async () => {}),
      pull: vi.fn(async () => { throw new SyncError('network', 'offline') }),
      push: vi.fn(async () => ({ rev: 'r1' }))
    }
    const { scheduler } = build({ provider })

    await scheduler.start()
    provider.pull.mockResolvedValue(null)
    await scheduler.syncNow()

    provider.pull.mockClear()
    await vi.advanceTimersByTimeAsync(600000)

    expect(provider.pull).not.toHaveBeenCalled()
  })
})

describe('teardown', () => {
  it('stops syncing entirely once stopped', async () => {
    // The method says one thing and does another unless it detaches the
    // listeners as well as clearing the timer.
    const { scheduler, provider } = build()
    await scheduler.start()

    scheduler.stop()
    provider.pull.mockClear()

    scheduler.schedule()
    window.dispatchEvent(new Event('pagehide'))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(10000)

    expect(provider.pull).not.toHaveBeenCalled()
  })

  it('does not start a cycle when stopped, whoever is asking', async () => {
    const { scheduler, provider } = build()

    scheduler.stop()
    const outcome = await scheduler.syncNow()

    expect(outcome).toBe(null)
    expect(provider.pull).not.toHaveBeenCalled()
  })

  it('ignores a late local write, so it cannot resurrect a torn-down scheduler', async () => {
    const { scheduler, provider, events } = build()
    await scheduler.start()
    provider.pull.mockClear()

    scheduler.stop()
    events.notify()
    await vi.advanceTimersByTimeAsync(10000)

    expect(provider.pull).not.toHaveBeenCalled()
  })

  it('detaches the revision subscription on stop', async () => {
    const { scheduler, events } = build()
    await scheduler.start()

    scheduler.stop()

    expect(events.unsubscribed).toBe(1)
  })
})

describe('while the user is naming something', () => {
  /*
   * The bug this exists to prevent. Adding an item creates the node, saves it,
   * and only then asks for its title. The debounce is shorter than most people
   * take to type, so a cycle fired part-way through and published the item under
   * its placeholder title — the other device showed "New item" until a later
   * sync corrected it. The data was never wrong; it was published mid-write.
   */
  it('does not sync while the rename dialog is open, however long it stays open', async () => {
    const { scheduler, provider } = build()

    scheduler.schedule()
    beginEdit()

    // Well past the debounce.
    await vi.advanceTimersByTimeAsync(60000)

    expect(provider.pull).not.toHaveBeenCalled()
  })

  it('still shows the work as pending, so the indicator tells the truth', async () => {
    // `pending` covering the hold is the point. A silent hold would look
    // identical to sync having nothing to do.
    const { scheduler } = build()

    scheduler.schedule()
    beginEdit()

    expect(scheduler.getStatus().pending).toBe(true)
  })

  it('syncs once the rename is finished', async () => {
    const { scheduler, provider } = build()

    scheduler.schedule()
    beginEdit()
    await vi.advanceTimersByTimeAsync(60000)

    endEdit()
    // The debounce restarts from the dialog closing, so the name that was just
    // typed is what gets published.
    await vi.advanceTimersByTimeAsync(1000)

    expect(provider.pull).toHaveBeenCalledTimes(1)
  })

  it('publishes only after the debounce that follows the rename, not during it', async () => {
    const { scheduler, provider } = build()

    scheduler.schedule()
    beginEdit()
    await vi.advanceTimersByTimeAsync(60000)
    expect(provider.pull).not.toHaveBeenCalled()

    endEdit()
    await vi.advanceTimersByTimeAsync(999)
    expect(provider.pull).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(provider.pull).toHaveBeenCalledTimes(1)
  })

  it('waits for the last of several overlapping renames', async () => {
    /*
     * Continuous item creation: saving item two opens item three's dialog from
     * inside item two's save handler, so the gate is opened twice and released
     * once. A boolean would read "done" while item three was still open, and the
     * cycle would fire during it.
     */
    const { scheduler, provider } = build()

    beginEdit() // item 2
    scheduler.schedule()
    beginEdit() // item 3, opened from item 2's save handler
    endEdit() // item 2's dialog closes

    await vi.advanceTimersByTimeAsync(60000)
    expect(provider.pull).not.toHaveBeenCalled()

    endEdit() // item 3's dialog closes
    await vi.advanceTimersByTimeAsync(1000)

    expect(provider.pull).toHaveBeenCalledTimes(1)
  })

  it('coalesces a run of saves made during the rename into one cycle', async () => {
    // Creating an item saves twice before the name is even asked for, and again
    // once it is given. All of it is one cycle.
    const { scheduler, provider } = build()

    beginEdit()
    scheduler.schedule()
    scheduler.schedule()
    scheduler.schedule()
    endEdit()

    await vi.advanceTimersByTimeAsync(1000)

    expect(provider.pull).toHaveBeenCalledTimes(1)
  })

  it('does not force a sync for a dialog that was opened and abandoned', async () => {
    // Opening a dialog with nothing scheduled must not oblige a cycle on the way
    // out — otherwise merely opening the rename menu costs a round trip.
    const { provider } = build()

    beginEdit()
    endEdit()

    await vi.advanceTimersByTimeAsync(60000)

    expect(provider.pull).not.toHaveBeenCalled()
  })

  it('still honours a manual sync, because a button that silently does nothing is worse', async () => {
    const { scheduler, provider } = build()
    beginEdit()

    await scheduler.syncNow()

    expect(provider.pull).toHaveBeenCalledTimes(1)
  })

  it('stops holding once stopped, even with the gate still open', async () => {
    // `schedule()` already ignores a stopped scheduler; this is the same rule
    // reached through the other door, and a leak here would be invisible.
    const { scheduler, provider } = build()
    await scheduler.start()
    // `start()` runs a cycle of its own; this is about what happens afterwards.
    provider.pull.mockClear()

    scheduler.stop()
    beginEdit()
    scheduler.schedule()
    await vi.advanceTimersByTimeAsync(60000)

    expect(provider.pull).not.toHaveBeenCalled()
  })

  it('detaches from the gate on stop, so a later edit cannot re-arm it', async () => {
    const { scheduler } = build()
    await scheduler.start()
    scheduler.stop()

    // The scheduler must not act on this, even though `schedule()` is a no-op
    // for it while stopped. Asserted through the absence of any throw, which is
    // what a double-detach would produce.
    beginEdit()
    endEdit()
    expect(scheduler.getStatus().pending).toBe(false)
  })
})
