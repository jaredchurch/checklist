import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
/*
 * Everything else is reached through the fresh module returned by
 * `freshStorage()`, because `storage.js` keeps module-level state that has to
 * be reset between tests. `getData` is imported directly only where the point is
 * that the *tree* key and the snapshot key agree.
 */
import { getData } from '../storage.js'
import { createListNode, createNode } from '../tree.js'
import { SCHEMA_VERSION } from '../sync/snapshot.js'

/**
 * Every test gets a clean store, because `storage.js` deliberately keeps module
 * state — the last-known content of each node, and tombstones awaiting their
 * next write. That state is the mechanism, not an oversight, so it has to be
 * reset between tests rather than worked around.
 */
beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  /*
   * A controlled clock. Two saves inside the same millisecond produce the same
   * ISO string, which makes "was this restamped?" unanswerable from the
   * timestamp alone — and the whole mechanism under test is whether a node gets
   * a *new* timestamp.
   */
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

/** Move the clock on, so the next save cannot produce the same timestamp. */
function advanceClock (ms = 1000) {
  vi.setSystemTime(new Date(Date.now() + ms))
}

async function freshStorage () {
  vi.resetModules()
  return import('../storage.js')
}

function tree () {
  const root = createListNode('My Checklist')
  const list = createListNode('Shopping')
  const item = createNode('Milk')
  list.children.push(item)
  root.children.push(list)
  return { root, list, item }
}

describe('stamping', () => {
  it('gives every node a timestamp, including ones that never changed', async () => {
    const { root } = tree()
    const storage = await freshStorage()

    storage.saveData(root)

    expect(root.updatedAt).toEqual(expect.any(String))
    expect(root.children[0].updatedAt).toEqual(expect.any(String))
  })

  it('leaves an untouched node alone when something else changes', async () => {
    // If every node were restamped on every save, a device that merely opened
    // the app would appear to have edited everything and would win every merge.
    const { root, item } = tree()
    const storage = await freshStorage()

    storage.saveData(root)
    const firstStamp = item.updatedAt

    root.children.push(createNode('Bread'))
    advanceClock()
    storage.saveData(root)

    expect(item.updatedAt).toBe(firstStamp)
    expect(root.children[1].updatedAt).not.toBe(firstStamp)
  })

  it('restamps a node whose content changed', async () => {
    const { root, item } = tree()
    const storage = await freshStorage()

    storage.saveData(root)
    const firstStamp = item.updatedAt

    item.title = 'Oat milk'
    advanceClock()
    storage.saveData(root)

    expect(item.updatedAt).not.toBe(firstStamp)
  })

  it('restamps a node that was moved into a different list', async () => {
    // Parentage is a field on the flat record, so a move is a change to the
    // node — without this the merge would not see it.
    const { root, list, item } = tree()
    const storage = await freshStorage()
    storage.saveData(root)
    const firstStamp = item.updatedAt

    const other = createListNode('Hardware')
    root.children.push(other)
    list.children.splice(list.children.indexOf(item), 1)
    other.children.push(item)
    advanceClock()
    storage.saveData(root)

    expect(item.updatedAt).not.toBe(firstStamp)
    expect(readSnapshotOf(storage).nodes[item.id].parentId).toBe(other.id)
  })

  it('does not restamp a parent whose only change was its contents moving', async () => {
    // Deliberate, and worth pinning down. In the flat table a list's record is
    // its own fields plus its parentage — its items are separate records linked
    // by `parentId`. So the item that moved carries the whole change, and the
    // merge resolves it there. Restamping the parent as well would be a second
    // device's worth of noise that can win a merge it did not really take part
    // in.
    const { root, list, item } = tree()
    const storage = await freshStorage()
    storage.saveData(root)
    const firstStamp = list.updatedAt

    const other = createListNode('Hardware')
    root.children.push(other)
    list.children.splice(list.children.indexOf(item), 1)
    other.children.push(item)
    advanceClock()
    storage.saveData(root)

    expect(list.updatedAt).toBe(firstStamp)
    expect(item.updatedAt).not.toBe(firstStamp)
  })

  it('restamps a parent whose own field changed', async () => {
    const { root, list } = tree()
    const storage = await freshStorage()
    storage.saveData(root)
    const firstStamp = list.updatedAt

    list.title = 'Errands'
    advanceClock()
    storage.saveData(root)

    expect(list.updatedAt).not.toBe(firstStamp)
  })
})

function readSnapshotOf (storage) {
  return storage.readSnapshot()
}

describe('the sync snapshot', () => {
  it('is written on every save and mirrors the tree', async () => {
    const { root, item } = tree()
    const storage = await freshStorage()

    storage.saveData(root)
    const snapshot = storage.readSnapshot()

    expect(snapshot.schemaVersion).toBe(SCHEMA_VERSION)
    expect(snapshot.rootId).toBe(root.id)
    expect(Object.keys(snapshot.nodes).sort()).toEqual([item.id, root.id, root.children[0].id].sort())
  })

  it('records parentage, which the nested tree does not carry explicitly', async () => {
    const { root, item } = tree()
    const storage = await freshStorage()

    storage.saveData(root)

    expect(storage.readSnapshot().nodes[item.id].parentId).toBe(root.children[0].id)
  })

  it('starts empty rather than throwing when there is nothing stored', async () => {
    const storage = await freshStorage()

    expect(storage.readSnapshot()).toEqual({ schemaVersion: SCHEMA_VERSION, rootId: null, nodes: {} })
  })

  it('falls back to empty when the stored snapshot is unreadable', async () => {
    const storage = await freshStorage()
    localStorage.setItem('checklist-pwa-snapshot-v1', '{ not json')

    expect(storage.readSnapshot().nodes).toEqual({})
  })
})

describe('deleting', () => {
  it('removes the node from the tree', async () => {
    const { root, list } = tree()
    const storage = await freshStorage()
    storage.saveData(root)

    expect(storage.removeNode(root, list.id)).toBe(true)
    expect(root.children).toHaveLength(0)
  })

  it('leaves a tombstone, so the other device deletes it too', async () => {
    // A hard removal is invisible to the other device, which would keep the item
    // and put it straight back into the union on the next cycle.
    const { root, list } = tree()
    const storage = await freshStorage()
    storage.saveData(root)

    storage.removeNode(root, list.id)
    storage.saveData(root)

    expect(storage.readSnapshot().nodes[list.id].deletedAt).toEqual(expect.any(String))
  })

  it('tombstones the whole subtree, so deleting a list removes its items', async () => {
    const { root, list, item } = tree()
    const storage = await freshStorage()
    storage.saveData(root)

    storage.removeNode(root, list.id)
    storage.saveData(root)

    const nodes = storage.readSnapshot().nodes
    expect(nodes[list.id].deletedAt).toBeTruthy()
    expect(nodes[item.id].deletedAt).toBeTruthy()
  })

  it('keeps one tombstone per id, so the record count stays consistent', async () => {
    // The envelope's integrity check compares the count against what arrived, so
    // a table with two rows for one id would look truncated.
    const { root, item } = tree()
    const storage = await freshStorage()
    storage.saveData(root)

    storage.removeNode(root, item.id)
    storage.saveData(root)
    storage.removeNode(root, item.id)
    storage.saveData(root)

    expect(storage.readSnapshot().nodes[item.id].deletedAt).toBeTruthy()
  })

  it('reports false for an id that is not there', async () => {
    const { root } = tree()
    const storage = await freshStorage()

    expect(storage.removeNode(root, 'nope')).toBe(false)
  })
})

describe('writing a merged snapshot back', () => {
  it('replaces the tree the user is looking at', async () => {
    const storage = await freshStorage()
    const merged = {
      schemaVersion: SCHEMA_VERSION,
      rootId: 'root',
      nodes: {
        root: { id: 'root', type: 'list', title: 'Remote root', parentId: null, order: 1, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null },
        fromElsewhere: { id: 'fromElsewhere', type: 'item', title: 'Added elsewhere', done: false, parentId: 'root', order: 2, updatedAt: '2026-01-02T00:00:00.000Z', deletedAt: null }
      }
    }

    const treeAfter = storage.writeSnapshot(merged)

    expect(treeAfter.title).toBe('Remote root')
    expect(treeAfter.children.map((c) => c.title)).toEqual(['Added elsewhere'])
    expect(getData().children.map((c) => c.title)).toEqual(['Added elsewhere'])
  })

  it('does not restamp what arrived, so the next save is not a phantom edit', async () => {
    // Otherwise this device would look like it had just edited everything it
    // received and win the very next merge.
    const storage = await freshStorage()
    const merged = {
      schemaVersion: SCHEMA_VERSION,
      rootId: 'root',
      nodes: {
        root: { id: 'root', type: 'list', title: 'Root', parentId: null, order: 1, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null },
        item: { id: 'item', type: 'item', title: 'Theirs', done: false, parentId: 'root', order: 2, updatedAt: '2026-01-02T00:00:00.000Z', deletedAt: null }
      }
    }

    const treeAfter = storage.writeSnapshot(merged)
    const stamp = treeAfter.children[0].updatedAt
    storage.saveData(treeAfter)

    expect(treeAfter.children[0].updatedAt).toBe(stamp)
  })

  it('carries tombstones forward, so a later local delete is not a first delete', async () => {
    const storage = await freshStorage()
    storage.writeSnapshot({
      schemaVersion: SCHEMA_VERSION,
      rootId: 'root',
      nodes: {
        root: { id: 'root', type: 'list', title: 'Root', parentId: null, order: 1, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null },
        gone: { id: 'gone', type: 'item', title: 'Gone', parentId: 'root', order: 2, updatedAt: '2026-01-02T00:00:00.000Z', deletedAt: '2026-01-02T00:00:00.000Z' }
      }
    })

    expect(storage.readSnapshot().nodes.gone.deletedAt).toBe('2026-01-02T00:00:00.000Z')
  })
})

describe('the revision counter', () => {
  it('bumps on every save, so sync cannot be forgotten at a mutation site', async () => {
    const storage = await freshStorage()
    const { root } = tree()
    const listener = vi.fn()
    const detach = storage.subscribeRevision(listener)

    storage.saveData(root)
    storage.saveData(root)

    expect(listener).toHaveBeenCalledTimes(2)
    detach()
  })

  it('detaches cleanly, so a stopped scheduler stops being told', async () => {
    const storage = await freshStorage()
    const { root } = tree()
    const listener = vi.fn()
    const detach = storage.subscribeRevision(listener)
    detach()

    storage.saveData(root)

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('stampTree in isolation', () => {
  it('accepts a tree with no prior signatures', async () => {
    const storage = await freshStorage()
    const { root } = tree()

    expect(() => storage.stampTree(root)).not.toThrow()
  })
})
