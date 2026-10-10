/**
 * Storage for the Checklist PWA.
 *
 * Three localStorage keys, and the split between them is the point:
 *
 * - `KEY` — the tree, exactly as the UI and the Export/Import feature see it.
 *   Nested, human-readable, and unchanged by any of this sync work, so a backup
 *   file a user shares still looks like their checklists.
 * - `SNAPSHOT_KEY` — the flat, mergeable table. Derived from the tree on every
 *   save. This is what sync reads and writes.
 * - `SETTINGS_KEY` — preferences, which are per-browser rather than per-account.
 *
 * Everything is best-effort and synchronous. A checklist that fails to save
 * because storage was full must still render and still be editable, so writes
 * are guarded and never throw into a view.
 */

import { sanitizeTree } from './tree.js'
import { flattenTree, hydrateTree, collectSubtree, SCHEMA_VERSION } from './sync/snapshot.js'
import { canonicalStringify } from './sync/merge.js'

export const KEY = 'checklist-pwa-data-v1'
export const SETTINGS_KEY = 'checklist-pwa-settings-v1'

const SNAPSHOT_KEY = 'checklist-pwa-snapshot-v1'
const TOMBSTONES_KEY = 'checklist-pwa-tombstones-v1'
const LAST_REV_KEY = 'checklist-pwa-last-rev-v1'
const LAST_SYNC_KEY = 'checklist-pwa-last-sync-v1'

/*
 * Tombstones awaiting their next snapshot write.
 *
 * A delete has to survive as a record, not as an absence: without it, "deleted
 * here" and "never synced" look identical and the item comes back on the next
 * cycle. Holding them here means a delete and the save that follows it stay in
 * step, and the snapshot itself remains the single durable store.
 */
let pendingTombstones = []

/*
 * Content signature per node id, from the previous save.
 *
 * This is how `updatedAt` gets stamped. Every mutation in the app — ticking an
 * item, renaming, dragging, marking a list done — ends in `saveData`, so
 * comparing each node's content against the last save catches all of them from
 * one place. Doing it here rather than in each view means a mutation site cannot
 * forget to bump its timestamp, which is the same reason the scheduler
 * subscribes to a revision counter rather than being told by views.
 *
 * The signature deliberately excludes `updatedAt` itself, or every node would
 * look changed every save and last-write-wins would have no meaning.
 */
let lastSignatures = new Map()

function nowIso () {
  return new Date().toISOString()
}

/**
 * A node's content, as something comparable between saves.
 *
 * Includes the parent id, because a node moved into a different list is a change
 * to that node's record — the flat table has no other place for parentage to
 * live, so a move would be invisible to the merge without it.
 */
function signatureOf (node, parentId) {
  const copy = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === 'updatedAt' || key === 'isNew') continue
    if (value === undefined) continue
    copy[key] = key === 'children' ? undefined : value
  }
  copy.parentId = parentId
  return canonicalStringify(copy)
}

/**
 * Give every changed node a fresh `updatedAt`.
 *
 * A node that did not change keeps its timestamp, which is what makes
 * last-write-wins meaningful: if everything were restamped on every save, a
 * device that merely opened the app would appear to have edited everything and
 * would win every merge.
 */
export function stampTree (root) {
  const signatures = new Map()
  const stamp = nowIso()

  const walk = (node, parentId) => {
    if (!node || typeof node.id !== 'string') return
    const signature = signatureOf(node, parentId)
    signatures.set(node.id, signature)
    if (lastSignatures.get(node.id) !== signature) node.updatedAt = stamp
    for (const child of node.children || []) walk(child, node.id)
  }
  walk(root, null)

  lastSignatures = signatures
  return root
}

/**
 * Load checklist data from localStorage.
 * Returns a sanitized tree structure or null if not found/invalid.
 */
export function getData () {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed.type !== 'list') {
      console.warn('Invalid root data, resetting to default')
      return null
    }
    return sanitizeTree(parsed)
  } catch (err) {
    console.error('Invalid saved data', err)
    localStorage.removeItem(KEY)
    return null
  }
}

/**
 * Save checklist data, and publish it to the sync snapshot.
 *
 * Called from every mutation path in the app. Stamps changed nodes, writes the
 * tree for the UI and Export/Import, folds in any tombstones from deletes since
 * the last save, and bumps the revision the scheduler listens to.
 */
export function saveData (data) {
  stampTree(data)
  writeTree(data)
  writeSnapshotFromTree(data)
  bumpRevision()
  return data
}

function writeTree (tree) {
  try {
    localStorage.setItem(KEY, JSON.stringify(tree))
  } catch (err) {
    // Storage full or blocked. The in-memory tree is still correct and the app
    // still works; failing loudly here would take down the edit that triggered
    // the save.
    console.warn('Could not save checklist data', err)
  }
}

function writeSnapshotFromTree (tree) {
  const tombstones = dedupe([...readStoredTombstones(), ...pendingTombstones])
  pendingTombstones = []
  writeJson(TOMBSTONES_KEY, tombstones)
  writeJson(SNAPSHOT_KEY, flattenTree(tree, tombstones))
}

function readStoredTombstones () {
  const raw = safeGet(TOMBSTONES_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((r) => r && r.id && r.deletedAt) : []
  } catch {
    return []
  }
}

/**
 * Collapse tombstones to one record per id, newest wins.
 *
 * A node deleted twice — deleted, re-imported, deleted again — leaves two
 * records with the same id. Keeping both would make the table's record count
 * disagree with itself and defeat the envelope's integrity check.
 */
function dedupe (records) {
  const byId = new Map()
  for (const record of records) {
    const existing = byId.get(record.id)
    if (!existing || (record.updatedAt || '') > (existing.updatedAt || '')) {
      byId.set(record.id, record)
    }
  }
  return [...byId.values()]
}

/**
 * Delete a node and everything under it, leaving a tombstone behind.
 *
 * Used by every delete and every "user cancelled the rename, so discard the
 * thing we just made" path. A hard removal cannot sync: the other device would
 * keep the item and put it straight back into the union on the next cycle.
 *
 * The subtree is collected before it is spliced out, because that walk needs to
 * still find the node.
 */
export function removeNode (root, id) {
  const stamp = nowIso()
  const records = collectSubtree(root, id, stamp)
  if (records.length === 0) return false

  pendingTombstones.push(...records)

  const removed = detach(root, id)
  if (removed) bumpRevision()
  return removed
}

/** Splice `id` out of its parent's children. Returns whether it was there. */
function detach (root, id) {
  if (!root) return false
  const visit = (node) => {
    if (!Array.isArray(node.children)) return false
    const index = node.children.findIndex((child) => child.id === id)
    if (index !== -1) {
      node.children.splice(index, 1)
      return true
    }
    return node.children.some(visit)
  }
  return visit(root)
}

/** The mergeable table, as the sync engine reads it. */
export function readSnapshot () {
  const raw = safeGet(SNAPSHOT_KEY)
  if (!raw) return emptySnapshot()
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.nodes !== 'object') return emptySnapshot()
    return { schemaVersion: parsed.schemaVersion ?? SCHEMA_VERSION, rootId: parsed.rootId ?? null, nodes: parsed.nodes }
  } catch (err) {
    console.warn('Snapshot was unreadable; starting from empty', err)
    return emptySnapshot()
  }
}

/**
 * Replace local data with a merged snapshot.
 *
 * Called by the engine with the union of this device and the remote, so the
 * tree the user sees always reflects everything known. Tombstones are folded in
 * so a later local delete of the same id is not mistaken for the first one.
 */
export function writeSnapshot (snapshot) {
  const tree = hydrateTree(snapshot)
  const tombstones = Object.values(snapshot.nodes || {}).filter((r) => r.deletedAt)
  pendingTombstones = []
  writeJson(SNAPSHOT_KEY, snapshot)
  writeJson(TOMBSTONES_KEY, tombstones)
  writeTree(tree)
  // Resignatures, so nodes arriving from the remote are not immediately
  // restamped as local edits on the next save — which would make this device
  // look like it had just edited all of them and win the next merge.
  const signatures = new Map()
  for (const [id, record] of Object.entries(snapshot.nodes || {})) {
    if (record.deletedAt) continue
    const comparable = { ...record }
    delete comparable.parentId
    signatures.set(id, signatureOf(comparable, record.parentId ?? null))
  }
  lastSignatures = signatures
  return tree
}

function emptySnapshot () {
  return { schemaVersion: SCHEMA_VERSION, rootId: null, nodes: {} }
}

export function readLastRev () {
  return safeGet(LAST_REV_KEY)
}

export function writeLastRev (rev) {
  safeSet(LAST_REV_KEY, rev ?? null)
}

export function readLastSyncAt () {
  return safeGet(LAST_SYNC_KEY)
}

export function writeLastSyncAt (at) {
  safeSet(LAST_SYNC_KEY, at)
}

// ── Revision counter ──────────────────────────────────────────────────────────
//
// Every save bumps this. The scheduler subscribes rather than being called by
// each view, so "sync after you change something" cannot be forgotten at a
// mutation site.

let revision = 0
const listeners = new Set()

export function bumpRevision () {
  revision += 1
  for (const listener of listeners) {
    try {
      listener()
    } catch (err) {
      // One broken subscriber must not stop the others from being told.
      console.warn('Sync listener failed', err)
    }
  }
}

export function subscribeRevision (listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getRevision () {
  return revision
}

// ── Settings ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = { showUpDownActions: false, continuousItemCreation: true }

/**
 * Load user settings. Returns defaults if missing or invalid.
 */
export function getSettings () {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw)
    return {
      showUpDownActions: typeof parsed.showUpDownActions === 'boolean' ? parsed.showUpDownActions : false,
      continuousItemCreation: typeof parsed.continuousItemCreation === 'boolean' ? parsed.continuousItemCreation : true
    }
  } catch (err) {
    console.error('Invalid saved settings', err)
    localStorage.removeItem(SETTINGS_KEY)
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings (settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ...settings }))
}

// ── Guarded key/value helpers ────────────────────────────────────────────────
//
// Every storage access is guarded. Sync bookkeeping runs on timers and on
// `pagehide`, so an exception here would surface as an unhandled rejection with
// no stack pointing at anything useful.

function safeGet (key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet (key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch (err) {
    console.warn(`Could not write ${key}`, err)
  }
}

function writeJson (key, value) {
  safeSet(key, JSON.stringify(value))
}
