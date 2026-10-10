/**
 * The wire format for the sync file.
 *
 * The same format backs Export/Import, so one schema serves the sync engine,
 * the import dialog and a hand-recovered file. A separate sync format would be a
 * second schema to keep in step.
 *
 * OAuth credentials are deliberately absent. A sync file is the kind of thing
 * that gets emailed around, and it must not also grant access to the user's
 * Dropbox account.
 */

export const FORMAT = 'checklist-backup'

/** Bumped only on a breaking layout change. */
export const FORMAT_VERSION = 1

export class EnvelopeError extends Error {
  constructor (message, issues = []) {
    super(message)
    this.name = 'EnvelopeError'
    this.issues = issues
  }
}

function isIsoInstant (value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

/**
 * Validate one node record, leniently about fields it does not recognise.
 *
 * `id`, `type` and a timestamp are required — without them a record cannot be
 * merged, ordered or placed. Everything else is carried through untouched so a
 * file written by a newer build survives a round trip through an older one.
 * The older build cannot interpret a field it has not seen, but it can still
 * hand it back rather than silently dropping it.
 */
function validateRecord (record, path, issues) {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    issues.push(`${path}: must be an object`)
    return false
  }
  if (typeof record.id !== 'string' || record.id === '') {
    issues.push(`${path}.id: must be a non-empty string`)
    return false
  }
  if (record.type !== 'item' && record.type !== 'list') {
    issues.push(`${path}.type: must be "item" or "list"`)
    return false
  }
  if (!isIsoInstant(record.updatedAt)) {
    issues.push(`${path}.updatedAt: must be an ISO instant`)
    return false
  }
  if (record.deletedAt !== null && record.deletedAt !== undefined && !isIsoInstant(record.deletedAt)) {
    issues.push(`${path}.deletedAt: must be null or an ISO instant`)
    return false
  }
  if (record.parentId !== null && record.parentId !== undefined && typeof record.parentId !== 'string') {
    issues.push(`${path}.parentId: must be null or a string`)
    return false
  }
  return true
}

/**
 * Parse a sync or backup payload.
 *
 * The format field is checked before anything else is interpreted, and a future
 * `formatVersion` is rejected rather than best-effort parsed. A payload is never
 * partially applied: validation completes or nothing happens.
 */
export function parseEnvelope (raw, supportedSchemaVersion) {
  if (!raw || typeof raw !== 'object' || raw.format !== FORMAT) {
    return { ok: false, error: new EnvelopeError(`Not a ${FORMAT} file.`) }
  }

  if (typeof raw.formatVersion !== 'number' || raw.formatVersion < 1) {
    return {
      ok: false,
      error: new EnvelopeError('Backup format version is missing or invalid.')
    }
  }
  if (raw.formatVersion > FORMAT_VERSION) {
    return {
      ok: false,
      error: new EnvelopeError(
        `Backup format version ${raw.formatVersion} is newer than this build supports (${FORMAT_VERSION}). Update the app before syncing.`
      )
    }
  }

  const issues = []
  if (typeof raw.schemaVersion !== 'number' || raw.schemaVersion < 0) {
    issues.push('schemaVersion: must be a non-negative number')
  }
  if (!isIsoInstant(raw.exportedAt)) issues.push('exportedAt: must be an ISO instant')
  if (!raw.counts || typeof raw.counts !== 'object') issues.push('counts: must be an object')
  if (!raw.nodes || typeof raw.nodes !== 'object' || Array.isArray(raw.nodes)) {
    issues.push('nodes: must be an object keyed by id')
  }

  if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > supportedSchemaVersion) {
    return {
      ok: false,
      error: new EnvelopeError(
        `Backup uses data schema ${raw.schemaVersion}, but this build understands ${supportedSchemaVersion}. Update the app.`
      )
    }
  }

  if (issues.length > 0) {
    return { ok: false, error: new EnvelopeError('Backup is not valid.', issues) }
  }

  const nodes = {}
  let expectedCount = null
  if (typeof raw.counts.nodes === 'number') expectedCount = raw.counts.nodes

  for (const [id, record] of Object.entries(raw.nodes)) {
    if (!validateRecord(record, `nodes.${id}`, issues)) continue
    // The table key is authoritative for identity. A record whose `id` field
    // disagrees with its key would merge under two different names depending on
    // which side of the merge read it.
    if (record.id !== id) {
      issues.push(`nodes.${id}.id: must match its key`)
      continue
    }
    nodes[id] = record
  }

  /*
   * Counts are the cheap integrity check — they confirm nothing was truncated in
   * transit. Validating the field is the easy half; comparing it to what
   * actually arrived is the half that catches a file cut short by a quota, a
   * half-finished upload, or a hand edit. A mismatch means the document is
   * incomplete, and syncing it would silently drop items the user believes they
   * backed up.
   */
  if (expectedCount !== null && expectedCount !== Object.keys(nodes).length) {
    issues.push(
      `counts.nodes: says ${expectedCount} records but the file contains ${Object.keys(nodes).length}`
    )
  }

  if (issues.length > 0) {
    return {
      ok: false,
      error: new EnvelopeError('Backup is incomplete or not valid.', issues)
    }
  }

  return {
    ok: true,
    snapshot: { schemaVersion: raw.schemaVersion, rootId: raw.rootId ?? null, nodes }
  }
}

/** Build a payload from a snapshot. Field names pass through unchanged. */
export function toEnvelope (snapshot, exportedAt) {
  const nodes = snapshot.nodes || {}

  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    schemaVersion: snapshot.schemaVersion,
    rootId: snapshot.rootId ?? null,
    exportedAt: exportedAt.toISOString(),
    // Tombstones are counted as well as live records: they are real rows that
    // have to travel, and a count that excluded them would make a file with
    // deletions look inconsistent against its own contents.
    counts: { nodes: Object.keys(nodes).length },
    nodes
  }
}

/**
 * Serialise for the wire.
 *
 * Compact rather than pretty-printed: these files get emailed, and newlines
 * triple the size for no benefit.
 */
export function serialiseEnvelope (envelope) {
  return JSON.stringify(envelope)
}
