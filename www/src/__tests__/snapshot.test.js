import { describe, it, expect } from 'vitest'
import {
  flattenTree,
  hydrateTree,
  collectSubtree,
  nodeToRecord,
  recordToNode,
  SCHEMA_VERSION
} from '../sync/snapshot.js'
import { createListNode, createNode } from '../tree.js'

/**
 * Build a small tree by hand.
 *
 * Explicit ids and orders, because the behaviour under test — child ordering,
 * identity across a flatten/hydrate round trip — is exactly what auto-generated
 * ids and counters would obscure.
 */
function tree () {
  const root = { id: 'root', type: 'list', title: 'Root', order: 1, updatedAt: '2026-01-01T00:00:00.000Z', children: [] }
  const list = { id: 'list', type: 'list', title: 'Shopping', order: 1, updatedAt: '2026-01-01T00:00:00.000Z', children: [] }
  const second = { id: 'second', type: 'item', title: 'Second', done: false, order: 2, updatedAt: '2026-01-01T00:00:00.000Z', children: [] }
  const first = { id: 'first', type: 'item', title: 'First', done: true, order: 1, updatedAt: '2026-01-01T00:00:00.000Z', children: [] }

  list.children.push(second, first)
  root.children.push(list)
  return root
}

const titles = (node) => node.children.map((c) => c.title)

describe('nodeToRecord', () => {
  it('records parentage as a field and drops the nested children array', () => {
    const record = nodeToRecord({ id: 'a', type: 'item', children: [{ id: 'b' }] }, 'root')

    expect(record.parentId).toBe('root')
    expect(record.children).toBeUndefined()
  })

  it('carries unknown fields through rather than stripping them', () => {
    // A field a newer build added must survive an older build untouched, or the
    // round trip silently destroys it.
    const record = nodeToRecord({ id: 'a', type: 'item', futureField: 'keep me' }, null)

    expect(record.futureField).toBe('keep me')
  })

  it('drops the transient isNew render hint, which must not outlive the session', () => {
    expect(nodeToRecord({ id: 'a', type: 'item', isNew: true }, null).isNew).toBeUndefined()
  })
})

describe('flattenTree and hydrateTree', () => {
  it('round-trips a tree without losing or reordering anything', () => {
    const original = tree()

    const restored = hydrateTree(flattenTree(original))

    expect(restored.id).toBe(original.id)
    expect(titles(restored)).toEqual(['Shopping'])
    expect(titles(restored.children[0])).toEqual(['First', 'Second'])
    expect(restored.children[0].children[0].done).toBe(true)
  })

  it('preserves the timestamps, so a hydrated node is not restamped as an edit', () => {
    const stamp = '2026-01-01T00:00:00.000Z'

    const restored = hydrateTree(flattenTree(tree()))

    expect(restored.updatedAt).toBe(stamp)
  })

  it('excludes tombstoned records from the tree but keeps them in the table', () => {
    const original = tree()
    // The real delete path tombstones the whole subtree, not just the list.
    const tombstones = collectSubtree(original, 'list', '2026-02-01T00:00:00.000Z')

    const snapshot = flattenTree(original, tombstones)
    const restored = hydrateTree(snapshot)

    expect(Object.keys(snapshot.nodes).sort()).toEqual(['first', 'list', 'root', 'second'])
    expect(snapshot.nodes.list.deletedAt).toBe('2026-02-01T00:00:00.000Z')
    expect(titles(restored)).toEqual([])
  })

  it('reattaches a child whose parent was tombstoned, rather than losing it', () => {
    const original = tree()
    // Only the list is tombstoned. Its items were never recorded as deleted —
    // which is exactly what happens if one device's tombstone table is
    // truncated — so dropping them would silently lose items the user can see
    // elsewhere.
    const tombstones = collectSubtree(original, 'list', '2026-02-01T00:00:00.000Z').slice(0, 1)

    const restored = hydrateTree(flattenTree(original, tombstones))

    expect(titles(restored)).toEqual(['First', 'Second'])
  })

  it('reattaches an orphan to the root rather than dropping it', () => {
    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      rootId: 'root',
      nodes: {
        root: { id: 'root', type: 'list', title: 'Root', parentId: null, order: 1, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null },
        // Its declared parent does not exist in the table at all.
        orphan: { id: 'orphan', type: 'item', title: 'Orphan', parentId: 'vanished', order: 1, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
      }
    }

    const restored = hydrateTree(snapshot)

    expect(titles(restored)).toEqual(['Orphan'])
  })

  it('chooses a new root when the declared root has been deleted', () => {
    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      rootId: 'root',
      nodes: {
        root: { id: 'root', type: 'list', title: 'Root', parentId: null, order: 1, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: '2026-02-01T00:00:00.000Z' },
        listB: { id: 'listB', type: 'list', title: 'B', parentId: null, order: 1, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null },
        listA: { id: 'listA', type: 'list', title: 'A', parentId: null, order: 2, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
      }
    }

    const restored = hydrateTree(snapshot)

    // By id, not by timestamp: a deterministic rule needs no clock, and two
    // devices seeing the same records must pick the same root.
    expect(restored.id).toBe('listA')
    expect(titles(restored)).toEqual(['B'])
  })

  it('produces an empty list when nothing survives, so the app still renders', () => {
    const restored = hydrateTree({ schemaVersion: SCHEMA_VERSION, rootId: 'root', nodes: {} })

    expect(restored.type).toBe('list')
    expect(restored.children).toEqual([])
  })

  it('does not loop forever on a parent cycle in a hand-edited file', () => {
    const snapshot = {
      schemaVersion: SCHEMA_VERSION,
      rootId: 'root',
      nodes: {
        root: { id: 'root', type: 'list', title: 'Root', parentId: null, order: 1, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null },
        a: { id: 'a', type: 'list', title: 'A', parentId: 'b', order: 1, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null },
        b: { id: 'b', type: 'list', title: 'B', parentId: 'a', order: 1, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null }
      }
    }

    // The cycle is broken by reattaching both to the root, so neither hangs the
    // renderer.
    const restored = hydrateTree(snapshot)

    expect(restored.children.map((c) => c.id).sort()).toEqual(['a', 'b'])
    expect(restored.children.every((c) => c.children.length === 0)).toBe(true)
  })
})

describe('collectSubtree', () => {
  it('returns the node and everything under it, already tombstoned', () => {
    const original = tree()
    const stamp = '2026-02-01T00:00:00.000Z'

    const records = collectSubtree(original, 'list', stamp)

    expect(records.map((r) => r.id).sort()).toEqual(['first', 'list', 'second'])
    expect(records.every((r) => r.deletedAt === stamp && r.updatedAt === stamp)).toBe(true)
  })

  it('preserves parentage within the collected subtree, so a rehydration is faithful', () => {
    const records = collectSubtree(tree(), 'list', '2026-02-01T00:00:00.000Z')

    const list = records.find((r) => r.id === 'list')
    const children = records.filter((r) => r.parentId === 'list')

    expect(list.parentId).toBe('root')
    expect(children.map((c) => c.id).sort()).toEqual(['first', 'second'])
  })

  it('returns nothing for an id that is not in the tree', () => {
    expect(collectSubtree(tree(), 'nope', '2026-02-01T00:00:00.000Z')).toEqual([])
  })
})

describe('recordToNode', () => {
  it('always produces a children array', () => {
    expect(recordToNode({ id: 'a', type: 'item' }).children).toEqual([])
  })

  it('defaults done for items but not for lists', () => {
    // Adding `done` to a list would put a field in the exported JSON that the
    // app has never written.
    expect(recordToNode({ id: 'a', type: 'item' }).done).toBe(false)
    expect(recordToNode({ id: 'a', type: 'list' }).done).toBeUndefined()
  })
})

describe('created nodes', () => {
  it('are born with a timestamp, because a record without one cannot be merged', () => {
    const item = createNode('Thing')
    const list = createListNode('Things')

    expect(item.updatedAt).toEqual(expect.any(String))
    expect(list.updatedAt).toEqual(expect.any(String))
    expect(Number.isNaN(Date.parse(item.updatedAt))).toBe(false)
  })
})
