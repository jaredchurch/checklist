import { describe, it, expect } from 'vitest'
import { parseEnvelope, toEnvelope, serialiseEnvelope, FORMAT, FORMAT_VERSION } from '../sync/envelope.js'
import { SCHEMA_VERSION } from '../sync/snapshot.js'

const node = (id, extra = {}) => ({
  id,
  type: 'item',
  title: id,
  done: false,
  order: 1,
  parentId: 'root',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  ...extra
})

const snapshot = (nodes) => ({ schemaVersion: SCHEMA_VERSION, rootId: 'root', nodes })

const exportedAt = new Date('2026-03-01T12:00:00.000Z')

describe('toEnvelope', () => {
  it('carries no credentials, because a backup file gets emailed around', () => {
    const envelope = toEnvelope(snapshot({ root: node('root'), a: node('a') }), exportedAt)

    expect(JSON.stringify(envelope)).not.toMatch(/access_token|refreshToken|authorization/i)
  })

  it('counts tombstoned records as well as live ones', () => {
    // They are real rows that have to travel. Excluding them would make a file
    // with deletions look inconsistent against its own contents.
    const envelope = toEnvelope(
      snapshot({ root: node('root'), a: node('a', { deletedAt: '2026-02-01T00:00:00.000Z' }) }),
      exportedAt
    )

    expect(envelope.counts.nodes).toBe(2)
  })
})

describe('round trip', () => {
  it('survives serialise and parse unchanged', () => {
    const original = snapshot({ root: node('root', { type: 'list', parentId: null }), a: node('a') })

    const parsed = parseEnvelope(JSON.parse(serialiseEnvelope(toEnvelope(original, exportedAt))), SCHEMA_VERSION)

    expect(parsed.ok).toBe(true)
    expect(parsed.snapshot).toEqual(original)
  })

  it('carries a field this build does not understand through untouched', () => {
    // An older build must be able to hold a newer build's file. Stripping
    // unknown fields is a quiet way to destroy a user's data.
    const envelope = toEnvelope(snapshot({ a: node('a', { futureField: 'keep me' }) }), exportedAt)

    const parsed = parseEnvelope(JSON.parse(JSON.stringify(envelope)), SCHEMA_VERSION)

    expect(parsed.ok).toBe(true)
    expect(parsed.snapshot.nodes.a.futureField).toBe('keep me')
  })
})

describe('parseEnvelope rejects', () => {
  it('a payload that is not this format at all', () => {
    const parsed = parseEnvelope({ format: 'something-else' }, SCHEMA_VERSION)

    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toContain(FORMAT)
  })

  it('a future format version, rather than best-effort parsing it', () => {
    const envelope = toEnvelope(snapshot({ a: node('a') }), exportedAt)
    envelope.formatVersion = FORMAT_VERSION + 1

    const parsed = parseEnvelope(envelope, SCHEMA_VERSION)

    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toContain('newer than this build supports')
  })

  it('a payload written by a newer data schema', () => {
    const envelope = toEnvelope(snapshot({ a: node('a') }), exportedAt)
    envelope.schemaVersion = SCHEMA_VERSION + 1

    expect(parseEnvelope(envelope, SCHEMA_VERSION).ok).toBe(false)
  })

  it('a truncated file, using the count as the evidence', () => {
    // Validating the count field is the easy half; comparing it to what actually
    // arrived is the half that catches a file cut short by a quota or a
    // half-finished upload.
    const envelope = toEnvelope(snapshot({ a: node('a'), b: node('b') }), exportedAt)
    delete envelope.nodes.b

    const parsed = parseEnvelope(envelope, SCHEMA_VERSION)

    expect(parsed.ok).toBe(false)
    expect(parsed.error.message).toContain('incomplete')
  })

  it('a record with no timestamp, because it could never be merged', () => {
    const envelope = toEnvelope(snapshot({ a: node('a') }), exportedAt)
    envelope.nodes.a.updatedAt = 'not a date'

    const parsed = parseEnvelope(envelope, SCHEMA_VERSION)

    expect(parsed.ok).toBe(false)
    expect(parsed.error.issues.join(' ')).toContain('updatedAt')
  })

  it('a record whose id disagrees with the key it is filed under', () => {
    // It would otherwise merge under two different names depending on which
    // side of the merge read it.
    const envelope = toEnvelope(snapshot({ a: node('a') }), exportedAt)
    envelope.nodes.a.id = 'b'

    expect(parseEnvelope(envelope, SCHEMA_VERSION).ok).toBe(false)
  })

  it('a record of unknown type, which could not be rendered', () => {
    const envelope = toEnvelope(snapshot({ a: node('a') }), exportedAt)
    envelope.nodes.a.type = 'mystery'

    expect(parseEnvelope(envelope, SCHEMA_VERSION).ok).toBe(false)
  })

  it('a nodes table that is an array rather than an object', () => {
    const envelope = toEnvelope(snapshot({ a: node('a') }), exportedAt)
    envelope.nodes = []

    expect(parseEnvelope(envelope, SCHEMA_VERSION).ok).toBe(false)
  })
})
