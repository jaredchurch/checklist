/**
 * The sync snapshot: a flat, mergeable table of node records.
 *
 * This is the bridge between the two shapes this app has.
 *
 * **The tree** — what the UI works with, what Export/Import produces, what a
 * user reads when they open the JSON. Nested, with `children` arrays.
 *
 * **The snapshot** — what sync merges. Flat, keyed by id, one record per node,
 * with `parentId` making the hierarchy explicit and `updatedAt`/`deletedAt`
 * making the record mergeable.
 *
 * A nested tree cannot be merged by the union-by-id, last-write-wins rule the
 * sync engine relies on: parentage is implicit, so the same node exists in a
 * different shape on every device and there is no stable identity to reconcile
 * against. Flattening gives every node an identity and a timestamp, which is
 * what makes deletions propagate and two devices converge.
 *
 * Every function here is pure. No I/O, no clock, no storage — the merge is the
 * highest-risk code in this app and it must be testable directly.
 */

export const SCHEMA_VERSION = 1

/**
 * Turn one tree node into a flat record.
 *
 * `parentId` is the whole point of the flattening: it makes the hierarchy a
 * field that last-write-wins can resolve, rather than an implicit fact about
 * array position. Without it a node that moved on one device and was edited on
 * another has no defined winner.
 *
 * Unknown fields are carried through rather than dropped. A node field added by
 * a newer build must survive a round trip through an older one — the older build
 * cannot interpret it, but it can still carry it. A silent strip here is a quiet
 * way to destroy a user's data.
 */
export function nodeToRecord (node, parentId) {
  const record = {}
  for (const [key, value] of Object.entries(node)) {
    // `children` is the nesting this table replaces; `isNew` is a transient
    // render hint that must not outlive the session that set it.
    if (key === 'children' || key === 'isNew') continue
    if (value === undefined) continue
    record[key] = value
  }
  record.id = node.id
  record.parentId = parentId
  return record
}

/**
 * Rebuild a tree node from a record.
 *
 * The inverse of `nodeToRecord`, plus the `children` array the tree shape
 * requires. Metadata fields are preserved: the tree is the local copy of the
 * data, and dropping timestamps here would make every node look brand new on
 * the next save.
 */
export function recordToNode (record) {
  const node = {}
  for (const [key, value] of Object.entries(record)) {
    if (key === 'parentId') continue
    if (value === undefined) continue
    node[key] = value
  }
  if (!Array.isArray(node.children)) node.children = []
  // Only items carry `done`. Defaulting it on a list as well would put a field
  // in the exported JSON that the rest of the app has never written.
  if (node.type === 'item' && typeof node.done !== 'boolean') node.done = false
  return node
}

/**
 * Flatten a tree into a snapshot.
 *
 * `tombstones` are records whose nodes have been deleted. They are kept in the
 * table rather than dropped: a deletion has to propagate, and a device that was
 * offline for a month must not resurrect what another device removed. Without a
 * tombstone, "absent" is indistinguishable from "not yet synced".
 */
export function flattenTree (root, tombstones = []) {
  const nodes = {}

  const walk = (node, parentId) => {
    if (!node || typeof node.id !== 'string') return
    const record = nodeToRecord(node, parentId)
    nodes[record.id] = record
    for (const child of node.children || []) walk(child, record.id)
  }
  walk(root, null)

  for (const record of tombstones) nodes[record.id] = record

  return { schemaVersion: SCHEMA_VERSION, rootId: root?.id ?? null, nodes }
}

/**
 * Collect the subtree rooted at `id`, as records.
 *
 * Returns records already carrying `deletedAt`, so the caller can hand them
 * straight to the tombstone store. Exported because deleting a list has to take
 * its items with it, and walking the subtree twice would risk the two walks
 * disagreeing.
 */
export function collectSubtree (root, id, now) {
  const records = []

  const walk = (node, parentId) => {
    if (!node) return
    const record = nodeToRecord(node, parentId)
    record.updatedAt = now
    record.deletedAt = now
    records.push(record)
    for (const child of node.children || []) walk(child, record.id)
  }

  const visit = (node, parentId) => {
    if (!node) return
    if (node.id === id) {
      walk(node, parentId)
      return
    }
    for (const child of node.children || []) visit(child, node.id)
  }

  visit(root, null)
  return records
}

/**
 * Rebuild the tree from a snapshot.
 *
 * Two structural problems can only show up here, after a union of two devices'
 * records, and both are handled rather than assumed away:
 *
 * - A live node whose parent is missing or tombstoned has nowhere to hang. It is
 *   attached to the root, which is where the user will still see it, rather than
 *   dropped — losing an item the user can see on another device is worse than
 *   showing it in the wrong list.
 * - The root itself may be gone. The oldest surviving list becomes the root, and
 *   if nothing survives, an empty list is created, because the app has to have
 *   something to render.
 *
 * Children are ordered by `order`, because the tree's array order is a derived
 * view of that field, not an independent fact. `getCurrentNodes` relies on
 * array order for its stable partitions, so hydrating in any other order would
 * change what the user sees with no edit having occurred.
 */
export function hydrateTree (snapshot) {
  const nodes = snapshot.nodes || {}
  const live = (id) => {
    const record = nodes[id]
    return record && !record.deletedAt ? record : null
  }

  let rootRecord = live(snapshot.rootId)
  if (!rootRecord) {
    // Oldest surviving list wins, so the choice is deterministic across devices.
    // Sorting by id rather than by timestamp keeps it stable without needing a
    // clock, and a tie is not a correctness problem — only a naming one.
    const candidates = Object.values(nodes)
      .filter((r) => !r.deletedAt && r.type === 'list')
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    rootRecord = candidates[0] || null
  }

  if (!rootRecord) {
    return { id: 'root', type: 'list', title: 'My Checklist', children: [], updatedAt: null }
  }

  const liveIds = new Set(
    Object.keys(nodes).filter((id) => nodes[id] && !nodes[id].deletedAt)
  )

  /*
   * Group children by their effective parent, in two passes.
   *
   * Pass one groups by *declared* parentage and walks down from the root to
   * find what is actually reachable. Pass two reparents everything unreachable.
   *
   * A single "does the declared parent exist?" check is not enough, and the
   * difference is silent data loss: two records that name each other as parent
   * both pass a liveness check, both become unreachable from the root, and both
   * then disappear from the app with no error anywhere. Treating "unreachable"
   * as the orphan test catches the missing parent, the tombstoned parent and
   * the cycle with one rule.
   */
  const declaredChildren = new Map()
  for (const id of liveIds) {
    if (id === rootRecord.id) continue
    const parentId = nodes[id].parentId
    if (!declaredChildren.has(parentId)) declaredChildren.set(parentId, [])
    declaredChildren.get(parentId).push(nodes[id])
  }

  const reachable = new Set([rootRecord.id])
  const walk = (id) => {
    for (const child of declaredChildren.get(id) || []) {
      if (reachable.has(child.id)) continue
      reachable.add(child.id)
      walk(child.id)
    }
  }
  walk(rootRecord.id)

  const childrenByParent = new Map()
  for (const id of liveIds) {
    if (id === rootRecord.id) continue
    const declared = nodes[id].parentId
    const parentId = reachable.has(id) && declared && declared !== id ? declared : rootRecord.id
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, [])
    childrenByParent.get(parentId).push(nodes[id])
  }

  const built = new Map()

  const build = (record, ancestors) => {
    const node = recordToNode(record)
    node.children = []
    built.set(record.id, node)

    const chain = new Set([...ancestors, record.id])
    for (const child of childrenByParent.get(record.id) || []) {
      // A back-edge would hand back a tree that is its own ancestor, which hangs
      // the renderer rather than failing here.
      if (chain.has(child.id)) continue
      // Already placed elsewhere. A well-formed table gives every node exactly
      // one parent, so this only happens in a hand-edited file — and sharing the
      // object would put one item in two lists at once, where moving it would
      // silently move both.
      if (built.has(child.id)) continue
      node.children.push(build(child, chain))
    }
    node.children.sort(compareByOrderThenId)
    return node
  }

  return build(rootRecord, new Set())
}

function compareByOrderThenId (a, b) {
  const orderA = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER
  const orderB = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER
  if (orderA !== orderB) return orderA - orderB
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
