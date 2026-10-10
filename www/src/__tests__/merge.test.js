import { describe, it, expect } from 'vitest'
import { canonicalStringify, mergeSnapshots, repairSnapshot, countRecords } from '../sync/merge.js'
import { SCHEMA_VERSION } from '../sync/snapshot.js'

/**
 * Record builders.
 *
 * Written as functions rather than literals so a test states only the fields it
 * is about; a shared fixture that grew a field would quietly change every
 * expectation derived from it.
 */
const record = (id, updatedAt, extra = {}) => ({
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

const snapshot = (nodes, rootId = 'root') => ({
  schemaVersion: SCHEMA_VERSION,
  rootId,
  nodes
})

const rootNode = (updatedAt = '2026-01-01T00:00:00.000Z') =>
  record('root', updatedAt, { type: 'list', parentId: null })

const merge = (local, remote) => {
  const outcome = mergeSnapshots(local, remote, SCHEMA_VERSION)
  expect(outcome.ok).toBe(true)
  return outcome.merged
}

describe('canonicalStringify', () => {
  it('sorts object keys recursively so key order cannot affect the result', () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe(canonicalStringify({ a: 2, b: 1 }))
    expect(canonicalStringify({ a: { z: 1, y: 2 } })).toBe(canonicalStringify({ a: { y: 2, z: 1 } }))
  })

  it('preserves array order, which is meaningful', () => {
    expect(canonicalStringify([1, 2])).not.toBe(canonicalStringify([2, 1]))
  })

  it('distinguishes different values', () => {
    expect(canonicalStringify({ a: 1 })).not.toBe(canonicalStringify({ a: 2 }))
  })
})

describe('mergeSnapshots', () => {
  it('takes the union rather than replacing', () => {
    const local = snapshot({ root: rootNode(), a: record('a', '2026-01-01T00:00:00.000Z') })
    const remote = snapshot({ root: rootNode(), b: record('b', '2026-01-01T00:00:00.000Z') })

    const merged = merge(local, remote)

    expect(Object.keys(merged.nodes).sort()).toEqual(['a', 'b', 'root'])
  })

  it('keeps the newer whole record when both sides edited the same item', () => {
    const local = snapshot({ root: rootNode(), a: record('a', '2026-02-01T00:00:00.000Z', { title: 'local' }) })
    const remote = snapshot({ root: rootNode(), a: record('a', '2026-03-01T00:00:00.000Z', { title: 'remote' }) })

    const merged = merge(local, remote)

    expect(merged.nodes.a.title).toBe('remote')
  })

  it('resolves an exact updatedAt tie identically on both devices', () => {
    const stamp = '2026-02-01T00:00:00.000Z'
    const left = record('a', stamp, { title: 'aaa' })
    const right = record('a', stamp, { title: 'bbb' })

    // Key insertion order differs between the two, as it would on two devices
    // that built the same record by different routes.
    const oneWay = merge(snapshot({ root: rootNode(), a: left }), snapshot({ root: rootNode(), a: right }))
    const otherWay = merge(snapshot({ root: rootNode(), a: right }), snapshot({ root: rootNode(), a: left }))

    expect(oneWay.nodes.a).toEqual(otherWay.nodes.a)
  })

  it('propagates a deletion as a tombstone rather than dropping the record', () => {
    const local = snapshot({ root: rootNode(), a: record('a', '2026-02-01T00:00:00.000Z') })
    const remote = snapshot({
      root: rootNode(),
      a: record('a', '2026-03-01T00:00:00.000Z', { deletedAt: '2026-03-01T00:00:00.000Z' })
    })

    const merged = merge(local, remote)

    expect(merged.nodes.a.deletedAt).toBe('2026-03-01T00:00:00.000Z')
    // One live record remains: the root. The deleted item is still in the table.
    expect(countRecords(merged)).toEqual({ total: 2, live: 1, deleted: 1 })
  })

  it('lets a later edit resurrect a record, because deletedAt is just a field', () => {
    const local = snapshot({
      root: rootNode(),
      a: record('a', '2026-02-01T00:00:00.000Z', { deletedAt: '2026-02-01T00:00:00.000Z' })
    })
    const remote = snapshot({ root: rootNode(), a: record('a', '2026-03-01T00:00:00.000Z') })

    const merged = merge(local, remote)

    expect(merged.nodes.a.deletedAt).toBe(null)
  })

  it('resolves the root by the same rule as any other record', () => {
    const local = snapshot({ root: rootNode('2026-01-01T00:00:00.000Z') }, 'root')
    const other = snapshot(
      { root2: { ...rootNode('2026-05-01T00:00:00.000Z'), id: 'root2' } },
      'root2'
    )

    const merged = merge(local, other)

    expect(merged.rootId).toBe('root2')
  })

  it('refuses a remote built against a newer schema rather than interpreting it', () => {
    const local = snapshot({ root: rootNode() })
    const remote = { schemaVersion: SCHEMA_VERSION + 1, rootId: 'root', nodes: { root: rootNode() } }

    const outcome = mergeSnapshots(local, remote, SCHEMA_VERSION)

    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('unsupported-schema')
  })

  it('never downgrades the schema version by merging with a stale device', () => {
    const local = { schemaVersion: 5, rootId: 'root', nodes: { root: rootNode() } }
    const remote = { schemaVersion: 3, rootId: 'root', nodes: { root: rootNode() } }

    expect(mergeSnapshots(local, remote, 5).merged.schemaVersion).toBe(5)
  })
})

describe('merge convergence', () => {
  /**
   * The properties that make cross-device sync work at all. Each one has a
   * failure mode that produces no error and simply loses data, which is why they
   * are asserted directly rather than inferred from individual merge cases.
   */
  const left = snapshot({
    root: rootNode(),
    a: record('a', '2026-01-05T00:00:00.000Z', { title: 'A', done: true }),
    b: record('b', '2026-01-06T00:00:00.000Z', { title: 'B' }),
    gone: record('gone', '2026-01-07T00:00:00.000Z')
  })
  const right = snapshot({
    root: rootNode('2026-02-01T00:00:00.000Z'),
    a: record('a', '2026-01-05T00:00:00.000Z', { title: 'A' }),
    c: record('c', '2026-01-08T00:00:00.000Z', { title: 'C' }),
    gone: record('gone', '2026-01-09T00:00:00.000Z', { deletedAt: '2026-01-09T00:00:00.000Z' })
  })

  it('is commutative: both devices reach the same snapshot either way round', () => {
    expect(canonicalStringify(merge(left, right))).toBe(canonicalStringify(merge(right, left)))
  })

  it('is idempotent: re-merging the result changes nothing', () => {
    const once = merge(left, right)
    expect(canonicalStringify(merge(once, right))).toBe(canonicalStringify(once))
  })

  it('is absorbing: merging the result with either input is a no-op', () => {
    const merged = merge(left, right)
    expect(canonicalStringify(merge(merged, left))).toBe(canonicalStringify(merged))
    expect(canonicalStringify(merge(merged, right))).toBe(canonicalStringify(merged))
  })

  it('converges regardless of which device merges first', () => {
    // The realistic failure: two devices sync at different times and in a
    // different order. Whichever order they merge in, the third result must
    // match.
    const oneThenTwo = merge(merge(left, right), left)
    const twoThenOne = merge(merge(right, left), right)
    expect(canonicalStringify(oneThenTwo)).toBe(canonicalStringify(twoThenOne))
  })
})

describe('repairSnapshot', () => {
  it('reattaches an orphan to the root rather than dropping it', () => {
    const orphaned = snapshot({
      root: rootNode(),
      // Its parent list is absent entirely.
      a: record('a', '2026-01-01T00:00:00.000Z', { parentId: 'vanished' })
    })

    const repaired = repairSnapshot(orphaned)

    expect(repaired.nodes.a.parentId).toBe('root')
    expect(repaired.nodes.a.id).toBe('a')
  })

  it('reattaches a child whose parent was tombstoned', () => {
    const merged = snapshot({
      root: rootNode(),
      list: record('list', '2026-01-01T00:00:00.000Z', { type: 'list', deletedAt: '2026-02-01T00:00:00.000Z' }),
      child: record('child', '2026-01-01T00:00:00.000Z', { parentId: 'list' })
    })

    expect(repairSnapshot(merged).nodes.child.parentId).toBe('root')
  })

  it('picks a replacement root deterministically when the declared one is gone', () => {
    const merged = snapshot({
      root: { ...rootNode(), deletedAt: '2026-02-01T00:00:00.000Z' },
      listB: record('listB', '2026-01-01T00:00:00.000Z', { type: 'list', parentId: null }),
      listA: record('listA', '2026-01-01T00:00:00.000Z', { type: 'list', parentId: null })
    })

    const first = repairSnapshot(merged)
    const second = repairSnapshot(merged)

    expect(first.rootId).toBe('listA')
    expect(second.rootId).toBe(first.rootId)
  })

  it('leaves a tombstone untouched, so two devices cannot ping-pong its bytes', () => {
    const merged = snapshot({
      root: rootNode(),
      gone: record('gone', '2026-02-01T00:00:00.000Z', {
        deletedAt: '2026-02-01T00:00:00.000Z',
        parentId: 'vanished'
      })
    })

    const repaired = repairSnapshot(merged)

    expect(repaired.nodes.gone.parentId).toBe('vanished')
  })

  it('is idempotent, so a repaired merge compares equal to its own repair', () => {
    const merged = snapshot({
      root: rootNode(),
      a: record('a', '2026-01-01T00:00:00.000Z', { parentId: 'vanished' })
    })

    const once = repairSnapshot(merged)
    const twice = repairSnapshot(once)

    expect(canonicalStringify(twice)).toBe(canonicalStringify(once))
  })

  it('does not modify the snapshot it was given', () => {
    const merged = snapshot({
      root: rootNode(),
      a: record('a', '2026-01-01T00:00:00.000Z', { parentId: 'vanished' })
    })
    const before = canonicalStringify(merged)

    repairSnapshot(merged)

    expect(canonicalStringify(merged)).toBe(before)
  })
})
