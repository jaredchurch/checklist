import { describe, it, expect, vi } from 'vitest'
import { runSync } from '../sync/engine.js'
import { SyncError } from '../sync/provider.js'
import { toEnvelope } from '../sync/envelope.js'
import { SCHEMA_VERSION } from '../sync/snapshot.js'

const node = (id, updatedAt, extra = {}) => ({
  id,
  type: 'item',
  title: id,
  done: false,
  order: 1,
  parentId: 'root',
  updatedAt,
  deletedAt: null,
  ...extra
})

const root = (updatedAt = '2026-01-01T00:00:00.000Z') =>
  node('root', updatedAt, { type: 'list', parentId: null })

const snapshot = (nodes) => ({ schemaVersion: SCHEMA_VERSION, rootId: 'root', nodes })

const NOW = () => new Date('2026-06-01T00:00:00.000Z')

/**
 * A provider double.
 *
 * Every method is overridable per test, because the behaviours worth asserting
 * here are about *which* calls the engine makes in what order.
 */
function provider (overrides = {}) {
  return {
    ensureAuth: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    status: vi.fn(async () => ({ authenticated: true })),
    pull: vi.fn(async () => null),
    push: vi.fn(async () => ({ rev: 'r1' })),
    ...overrides
  }
}

function deps (overrides = {}) {
  return {
    provider: overrides.provider || provider(),
    path: 'checklist.json',
    supportedSchemaVersion: SCHEMA_VERSION,
    readLocal: overrides.readLocal || (async () => snapshot({ root: root() })),
    writeLocal: overrides.writeLocal || vi.fn(async () => {}),
    writeLastRev: overrides.writeLastRev || vi.fn(async () => {}),
    now: NOW,
    ...overrides
  }
}

const remoteBody = (nodes) => JSON.stringify(toEnvelope({ schemaVersion: SCHEMA_VERSION, rootId: 'root', nodes }, NOW()))

const remote = (nodes, rev = 'r1') => ({ body: remoteBody(nodes), rev })

describe('first run', () => {
  it('publishes local data when no remote file exists', async () => {
    const p = provider()
    const d = deps({ provider: p })

    const outcome = await runSync(d)

    expect(outcome).toMatchObject({ status: 'pushed', merged: false })
    expect(p.push).toHaveBeenCalledTimes(1)
    expect(d.writeLastRev).toHaveBeenCalledWith('r1')
  })

  it('treats a not-found pull as a first run rather than a failure', async () => {
    const p = provider({
      pull: vi.fn(async () => { throw new SyncError('not-found', 'File not found.') })
    })

    const outcome = await runSync(deps({ provider: p }))

    expect(outcome.status).toBe('pushed')
  })
})

describe('up to date', () => {
  it('does not publish when local and remote already agree', async () => {
    // Pushing here would be a no-op write that only mints a new revision.
    const nodes = { root: root(), a: node('a', '2026-01-01T00:00:00.000Z') }
    const p = provider({ pull: vi.fn(async () => remote(nodes)) })

    const outcome = await runSync(deps({ provider: p, readLocal: async () => snapshot(nodes) }))

    expect(outcome).toEqual({ status: 'up-to-date' })
    expect(p.push).not.toHaveBeenCalled()
  })

  it('publishes a purely local change, because a local edit leaves the remote revision untouched', async () => {
    // Comparing revisions instead of content concluded there was nothing to do,
    // so local edits and deletions silently never reached the provider at all.
    const remoteNodes = { root: root(), a: node('a', '2026-01-01T00:00:00.000Z') }
    const localNodes = { ...remoteNodes, b: node('b', '2026-02-01T00:00:00.000Z') }
    const p = provider({ pull: vi.fn(async () => remote(remoteNodes)) })

    const outcome = await runSync(deps({ provider: p, readLocal: async () => snapshot(localNodes) }))

    expect(outcome).toMatchObject({ status: 'pushed', merged: true })
    expect(p.push).toHaveBeenCalledTimes(1)
  })
})

describe('merging', () => {
  it('writes the union locally even when there is nothing to publish', async () => {
    // This device has to converge on the union regardless, or an item added
    // elsewhere stays invisible until some later change happens to publish.
    const nodes = { root: root(), a: node('a', '2026-01-01T00:00:00.000Z') }
    const p = provider({ pull: vi.fn(async () => remote(nodes)) })
    const writeLocal = vi.fn(async () => {})

    await runSync(deps({ provider: p, readLocal: async () => snapshot(nodes), writeLocal }))

    expect(writeLocal).toHaveBeenCalledTimes(1)
  })

  it('publishes the union of both sides', async () => {
    const localNodes = { root: root(), mine: node('mine', '2026-01-01T00:00:00.000Z') }
    const remoteNodes = { root: root(), theirs: node('theirs', '2026-01-01T00:00:00.000Z') }
    const p = provider({ pull: vi.fn(async () => remote(remoteNodes)) })

    await runSync(deps({ provider: p, readLocal: async () => snapshot(localNodes) }))

    const published = JSON.parse(p.push.mock.calls[0][1])
    expect(Object.keys(published.nodes).sort()).toEqual(['mine', 'root', 'theirs'])
  })

  it('publishes a tombstone so a deletion reaches the other device', async () => {
    const localNodes = {
      root: root(),
      gone: node('gone', '2026-02-01T00:00:00.000Z', { deletedAt: '2026-02-01T00:00:00.000Z' })
    }
    const remoteNodes = { root: root(), gone: node('gone', '2026-01-01T00:00:00.000Z') }
    const p = provider({ pull: vi.fn(async () => remote(remoteNodes)) })

    await runSync(deps({ provider: p, readLocal: async () => snapshot(localNodes) }))

    expect(JSON.parse(p.push.mock.calls[0][1]).nodes.gone.deletedAt).toBe('2026-02-01T00:00:00.000Z')
  })

  it('reconciles locally before publishing, so both sides end up with the same bytes', async () => {
    // Writing the unrepaired merge locally and publishing the repaired one left
    // the database and the remote holding different data, so every cycle
    // afterwards found a difference and pushed it again — forever.
    const localNodes = {
      root: root(),
      orphan: node('orphan', '2026-01-01T00:00:00.000Z', { parentId: 'vanished' })
    }
    const remoteNodes = { root: root() }
    const p = provider({ pull: vi.fn(async () => remote(remoteNodes)) })
    const writeLocal = vi.fn(async () => {})

    await runSync(deps({ provider: p, readLocal: async () => snapshot(localNodes), writeLocal }))

    const written = writeLocal.mock.calls[0][0].nodes.orphan
    const published = JSON.parse(p.push.mock.calls[0][1]).nodes.orphan
    expect(written.parentId).toBe('root')
    expect(published.parentId).toBe(written.parentId)
  })

  it('settles after one round trip rather than pushing on every cycle', async () => {
    const repaired = snapshot({
      root: root(),
      orphan: node('orphan', '2026-01-01T00:00:00.000Z', { parentId: 'root' })
    })
    const p = provider({ pull: vi.fn(async () => remote({ root: root(), orphan: node('orphan', '2026-01-01T00:00:00.000Z', { parentId: 'root' }) })) })

    const outcome = await runSync(deps({ provider: p, readLocal: async () => repaired }))

    expect(outcome.status).toBe('up-to-date')
  })
})

describe('refusing to sync', () => {
  it('skips quietly when there is no credential, rather than reporting a failure', async () => {
    const p = provider({ ensureAuth: vi.fn(async () => { throw new SyncError('auth', 'Not connected.') }) })

    const outcome = await runSync(deps({ provider: p }))

    // A disconnected app is not broken. Reporting an error here would show a
    // red state for a user who never asked to connect.
    expect(outcome).toEqual({ status: 'skipped', reason: 'not-authenticated' })
    expect(p.pull).not.toHaveBeenCalled()
  })

  it('refuses a remote file it cannot understand instead of overwriting it', async () => {
    const p = provider({ pull: vi.fn(async () => ({ body: '{"format":"nope"}', rev: 'r1' })) })

    const outcome = await runSync(deps({ provider: p }))

    expect(outcome).toMatchObject({ status: 'blocked', reason: 'unsupported-schema' })
    expect(p.push).not.toHaveBeenCalled()
  })

  it('refuses a remote file that is not JSON at all', async () => {
    const p = provider({ pull: vi.fn(async () => ({ body: 'not json', rev: 'r1' })) })

    expect(await runSync(deps({ provider: p }))).toMatchObject({ status: 'blocked' })
  })

  it('refuses a truncated remote file rather than silently dropping items', async () => {
    const p = provider({ pull: vi.fn(async () => ({ body: remoteBody({ root: root(), a: node('a', '2026-01-01T00:00:00.000Z') }).replace('"a"', '"a","b"'), rev: 'r1' })) })

    expect(await runSync(deps({ provider: p }))).toMatchObject({ status: 'blocked' })
  })

  it('leaves local data untouched when the pull fails', async () => {
    const p = provider({ pull: vi.fn(async () => { throw new SyncError('network', 'offline') }) })
    const writeLocal = vi.fn(async () => {})

    const outcome = await runSync(deps({ provider: p, writeLocal }))

    expect(outcome).toMatchObject({ status: 'failed', kind: 'network' })
    expect(writeLocal).not.toHaveBeenCalled()
  })
})

describe('conflicts', () => {
  it('re-reads and re-merges rather than retrying the same push', async () => {
    // Retrying the push alone would clobber the other writer. This is the case
    // where another device saved between our pull and our write.
    const remoteNodes = { root: root(), mine: node('mine', '2026-01-01T00:00:00.000Z') }
    const localNodes = { ...remoteNodes, alsoMine: node('alsoMine', '2026-01-02T00:00:00.000Z') }
    const other = { root: root(), theirs: node('theirs', '2026-03-01T00:00:00.000Z') }
    const p = provider({
      pull: vi.fn()
        .mockResolvedValueOnce(remote(remoteNodes))
        .mockResolvedValueOnce(remote(other, 'r2')),
      push: vi.fn()
        .mockRejectedValueOnce(new SyncError('conflict', 'changed'))
        .mockResolvedValueOnce({ rev: 'r3' })
    })

    const outcome = await runSync(deps({ provider: p, readLocal: async () => snapshot(localNodes) }))

    expect(outcome).toMatchObject({ status: 'pushed' })
    const published = JSON.parse(p.push.mock.calls[1][1])
    expect(Object.keys(published.nodes).sort()).toEqual(['alsoMine', 'mine', 'root', 'theirs'])
    expect(p.push.mock.calls[1][2]).toBe('r2')
  })

  it('re-reads local on the conflict path, so an edit made mid-cycle is not lost', async () => {
    // The in-flight snapshot was read before the round trip, so anything the
    // user saved while the network was in flight was in neither argument to the
    // merge — it would not be merged and it would not be pushed. "Sync now"
    // would report success while omitting the item just added.
    const remoteNodes = { root: root() }
    const readLocal = vi.fn()
      .mockResolvedValueOnce(snapshot({ ...remoteNodes, mine: node('mine', '2026-01-01T00:00:00.000Z') }))
      .mockResolvedValueOnce(snapshot({ ...remoteNodes, mine: node('mine', '2026-01-01T00:00:00.000Z'), justAdded: node('justAdded', '2026-03-01T00:00:00.000Z') }))
    const p = provider({
      pull: vi.fn(async () => remote(remoteNodes)),
      push: vi.fn()
        .mockRejectedValueOnce(new SyncError('conflict', 'changed'))
        .mockResolvedValueOnce({ rev: 'r3' })
    })

    await runSync(deps({ provider: p, readLocal }))

    expect(readLocal).toHaveBeenCalledTimes(2)
    expect(JSON.parse(p.push.mock.calls[1][1]).nodes.justAdded).toBeDefined()
  })

  it('gives up after a bounded number of attempts', async () => {
    const p = provider({
      pull: vi.fn(async () => remote({ root: root() })),
      push: vi.fn(async () => { throw new SyncError('conflict', 'changed') })
    })

    const outcome = await runSync(deps({ provider: p, readLocal: async () => snapshot({ root: root(), a: node('a', '2026-02-01T00:00:00.000Z') }) }))

    expect(outcome).toMatchObject({ status: 'failed', kind: 'conflict' })
    expect(p.push).toHaveBeenCalledTimes(3)
  })
})

describe('retries', () => {
  it('retries a rate limit', async () => {
    const p = provider({
      pull: vi.fn(async () => remote({ root: root() })),
      push: vi.fn()
        .mockRejectedValueOnce(new SyncError('rate-limited', 'slow down'))
        .mockResolvedValueOnce({ rev: 'r2' })
    })

    const outcome = await runSync(deps({ provider: p, readLocal: async () => snapshot({ root: root(), a: node('a', '2026-02-01T00:00:00.000Z') }) }))

    expect(outcome).toMatchObject({ status: 'pushed' })
  })

  it('does not retry a rejected credential, which would return the same answer', async () => {
    const p = provider({
      pull: vi.fn(async () => remote({ root: root() })),
      push: vi.fn(async () => { throw new SyncError('auth', 'rejected') })
    })

    await runSync(deps({
      provider: p,
      readLocal: async () => snapshot({ root: root(), a: node('a', '2026-02-01T00:00:00.000Z') })
    }))

    expect(p.push).toHaveBeenCalledTimes(1)
  })
})
