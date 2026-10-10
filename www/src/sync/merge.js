import { SCHEMA_VERSION } from './snapshot.js'

/**
 * Cross-device merge.
 *
 * This is the highest-risk code in the app. It runs unattended, a wrong answer
 * loses a user's history, and a non-deterministic answer means two devices never
 * converge without any error ever being reported.
 *
 * It is therefore a pure function with no I/O, no clock reads and no framework
 * imports, so it can be tested directly and reasoned about on its own.
 *
 * Merging is whole-record last-write-wins, never field-by-field. Field-level
 * merging can synthesise a record that never existed on either device — a title
 * from here and a completion state from there — and that record would then be
 * published to both. Last-write-wins on the whole record keeps every device
 * holding something a user actually typed.
 */

/**
 * JSON with object keys sorted, recursively.
 *
 * The tiebreak below compares two records that claim the same `updatedAt`. Using
 * plain `JSON.stringify` would not be deterministic: key order follows insertion
 * order, which can differ between two devices that built the same record by
 * different routes. Two devices would then pick different winners from
 * identical data and never agree.
 */
export function canonicalStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`
  }
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`).join(',')}}`
}

/**
 * Pick the winner for one id present on both sides.
 */
function pickWinner (local, remote) {
  if (local.updatedAt > remote.updatedAt) return local
  if (remote.updatedAt > local.updatedAt) return remote

  // Exact tie — which is common, because two devices that saved within the same
  // clock millisecond produce identical timestamps. Compare canonical
  // serialisations so every device independently arrives at the same answer.
  return canonicalStringify(local) >= canonicalStringify(remote) ? local : remote
}

/**
 * Merge two snapshots into one.
 *
 * `deletedAt` is an ordinary field, so a deletion is resolved by the same
 * last-write-wins rule as an edit and needs no special case. Tombstones are
 * retained in the output so a device that was offline for a month does not
 * resurrect items deleted elsewhere.
 *
 * `rootId` is resolved by the same rule rather than by a separate policy: the
 * root is just a record, and two devices that each renamed their own root should
 * not be able to disagree about which one is real.
 */
export function mergeSnapshots (local, remote, supportedSchemaVersion = SCHEMA_VERSION) {
  // Syncing an older client against a newer schema is how data gets corrupted.
  // Refuse rather than "helpfully" interpreting what we do not understand.
  if (remote.schemaVersion > supportedSchemaVersion) {
    return {
      ok: false,
      reason: 'unsupported-schema',
      remoteSchemaVersion: remote.schemaVersion,
      supportedSchemaVersion
    }
  }

  const nodes = {}
  const ids = new Set([...Object.keys(local.nodes || {}), ...Object.keys(remote.nodes || {})])

  for (const id of ids) {
    const localRecord = local.nodes?.[id]
    const remoteRecord = remote.nodes?.[id]
    if (localRecord && remoteRecord) nodes[id] = pickWinner(localRecord, remoteRecord)
    // Nothing on either side is ever dropped: a union, not a replacement.
    else nodes[id] = localRecord || remoteRecord
  }

  const rootWinner =
    local.nodes?.[local.rootId] && remote.nodes?.[remote.rootId]
      ? pickWinner(local.nodes[local.rootId], remote.nodes[remote.rootId])
      : local.nodes?.[local.rootId] || remote.nodes?.[remote.rootId]

  return {
    ok: true,
    merged: {
      // Never downgrade the schema version by merging with a stale device.
      schemaVersion: Math.max(local.schemaVersion, remote.schemaVersion),
      rootId: rootWinner ? rootWinner.id : local.rootId || remote.rootId,
      nodes
    }
  }
}

/**
 * Drop references to records that exist in neither snapshot.
 *
 * After a union, references normally resolve, so this is close to a no-op. It
 * matters when a record was lost outright — a hand-edited file, or a snapshot
 * from a build that wrote a different shape — and the alternative is an item
 * whose `parentId` names something the app cannot display, which would render
 * as an item that exists but can never be found again.
 *
 * An orphan is reattached to the root rather than deleted, because "in the
 * wrong list" is recoverable by the user and "gone" is not. The repair is
 * applied to the *records*, so the comparison the engine makes afterwards is
 * between two snapshots in the same repaired shape — otherwise every cycle
 * would find a difference and push a redundant correction forever.
 *
 * Returns a new snapshot and reuses every unchanged record, so the input is
 * never modified. `mergeSnapshots` shares object identity with its arguments;
 * a repair that edited in place would silently rewrite the caller's data.
 */
export function repairSnapshot (snapshot) {
  const nodes = snapshot.nodes || {}
  const liveIds = new Set(Object.keys(nodes).filter((id) => !nodes[id].deletedAt))

  const rootId = liveIds.has(snapshot.rootId) ? snapshot.rootId : pickFallbackRoot(nodes, liveIds)

  // Records caught in a parent cycle, found by walking up from each one.
  const cyclic = findCyclicIds(nodes, liveIds)

  let changed = false
  const repaired = {}
  for (const id of [...liveIds].sort()) {
    const record = nodes[id]

    if (id === rootId) {
      repaired[id] = record.parentId === null ? record : { ...record, parentId: null }
      if (repaired[id] !== record) changed = true
      continue
    }

    if (record.parentId && liveIds.has(record.parentId) && !cyclic.has(id)) {
      repaired[id] = record
      continue
    }

    /*
     * Reattach to the root rather than drop. "In the wrong list" is something
     * the user can find and move; "gone" is not, and the item is one they can
     * still see on another device.
     */
    repaired[id] = { ...record, parentId: rootId }
    changed = true
  }

  /*
   * Tombstones are carried through untouched. Rewriting a tombstone's parentId
   * would change the bytes of a record whose whole meaning is "this was here and
   * it was removed", and two devices could then disagree about its content and
   * ping-pong it forever.
   */
  for (const id of Object.keys(nodes)) {
    if (nodes[id].deletedAt) repaired[id] = nodes[id]
  }

  return changed || rootId !== snapshot.rootId
    ? { schemaVersion: snapshot.schemaVersion, rootId, nodes: repaired }
    : snapshot
}

/**
 * Find every record that sits in a parent cycle.
 *
 * Two records that name each other as parent both pass a plain "does my parent
 * exist" check, and the result is a pair that is unreachable from the root —
 * which renders as two items silently missing. Detecting the cycle and pinning
 * both to the root is also what stops two devices ping-ponging: without it, one
 * device's local copy and the other's would keep choosing different parents on
 * every merge and neither would settle.
 *
 * Walks up from each id with a visited set. Bounded by the live id count, so a
 * hand-edited file cannot make this loop.
 *
 * Ids are visited in sorted order so the result does not depend on key
 * insertion order.
 */
function findCyclicIds (nodes, liveIds) {
  const cyclic = new Set()

  for (const start of [...liveIds].sort()) {
    const seen = new Set([start])
    let current = nodes[start].parentId

    while (current && liveIds.has(current) && current !== start) {
      if (seen.has(current)) {
        cyclic.add(start)
        break
      }
      seen.add(current)
      current = nodes[current].parentId
      if (seen.size > liveIds.size) break
    }
  }

  return cyclic
}

/**
 * Choose a root when the declared one is gone.
 *
 * Deterministic without a clock, so every device that sees the same records
 * picks the same root and they agree rather than each showing a different
 * first list.
 */
function pickFallbackRoot (nodes, liveIds) {
  const candidates = [...liveIds].filter((id) => nodes[id].type === 'list').sort()
  return candidates[0] || null
}

/** Count records across a snapshot, for tests and the Sync panel. */
export function countRecords (snapshot) {
  const all = Object.keys(snapshot?.nodes || {})
  const live = all.filter((id) => !snapshot.nodes[id].deletedAt)
  return { total: all.length, live: live.length, deleted: all.length - live.length }
}
