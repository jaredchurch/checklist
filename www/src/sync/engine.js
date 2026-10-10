import { canonicalStringify, mergeSnapshots, repairSnapshot } from './merge.js'
import { parseEnvelope, serialiseEnvelope, toEnvelope } from './envelope.js'
import { SyncError } from './provider.js'
import { SCHEMA_VERSION } from './snapshot.js'

/**
 * The sync cycle.
 *
 * Local-first: the local snapshot is the source of truth and every step here is
 * best-effort. A failure must leave the app fully usable, because the app works
 * offline and losing the checklist because Dropbox was unreachable would be the
 * worst possible outcome of a feature meant to protect it.
 */

export const MAX_ATTEMPTS = 3
const BACKOFF_MS = 500

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function log (deps, level, message) {
  deps.onLog?.({ at: deps.now().toISOString(), level, message })
}

/**
 * Run one sync cycle.
 *
 * The cycle must never overlap itself: two concurrent cycles are the most likely
 * source of duplicate or lost writes, so the caller serialises calls and this
 * function is not re-entrant.
 */
export async function runSync (deps) {
  try {
    // 1. If this fails there is nothing to do and nothing is broken: the app
    //    works locally and offline.
    try {
      await deps.provider.ensureAuth()
    } catch {
      log(deps, 'warn', 'Not connected to Dropbox; continuing locally.')
      return { status: 'skipped', reason: 'not-authenticated' }
    }

    const local = await deps.readLocal()

    // 2. Pull. Null means the file does not exist, which is a first run.
    let remote = null
    try {
      remote = await deps.provider.pull(deps.path)
    } catch (error) {
      if (error instanceof SyncError && error.kind === 'not-found') remote = null
      else throw error
    }

    if (!remote) {
      // First run on this provider: publish what we have.
      log(deps, 'info', 'No remote file yet; creating one from local data.')
      const rev = await pushWithRetry(deps, local, null)
      await deps.writeLastRev(rev)
      return { status: 'pushed', rev, merged: false }
    }

    let parsed
    try {
      parsed = parseEnvelope(JSON.parse(remote.body), deps.supportedSchemaVersion)
    } catch {
      parsed = { ok: false, error: new Error('The synced file is not valid JSON.') }
    }
    if (!parsed.ok) {
      // Refuse rather than interpret. Pushing over the top would destroy
      // whatever is actually on the remote.
      log(deps, 'error', parsed.error.message)
      return { status: 'blocked', reason: 'unsupported-schema', message: parsed.error.message }
    }

    const remoteSnapshot = parsed.snapshot

    // 3. Merge first, then decide what to publish.
    const outcome = mergeSnapshots(local, remoteSnapshot, deps.supportedSchemaVersion)
    if (!outcome.ok) {
      const message =
        `Remote data uses schema ${outcome.remoteSchemaVersion}; ` +
        `this build understands ${deps.supportedSchemaVersion}. Not syncing.`
      log(deps, 'error', message)
      return { status: 'blocked', reason: 'unsupported-schema', message }
    }

    /*
     * Repair before anything is written or published, so local and remote hold
     * the same records. Writing the unrepaired merge locally and publishing the
     * repaired one left the database and the remote holding different data, so
     * every subsequent cycle found a difference and pushed it again — a
     * redundant write on every sync, indefinitely.
     *
     * The comparison below runs against the repaired merge. Repair is
     * idempotent, so once the repaired version has been published both sides
     * agree and the cycle settles.
     */
    const merged = repairSnapshot(outcome.merged)

    // 4. Reconcile locally regardless, so this device always converges on the
    //    union even when there is nothing to publish.
    await deps.writeLocal(merged)

    /*
     * 5. Publish only if the union differs from what the remote already holds.
     *
     * The decision is by content, not by revision. A local edit, addition or
     * deletion leaves the remote revision untouched, so comparing revisions
     * concluded there was nothing to do — and local-only changes then never
     * reached the provider at all. That is why deleting an item left it sitting
     * in Dropbox unchanged.
     *
     * The merge is a union, so the result already contains everything the remote
     * holds. Equality therefore means the remote is current, and pushing would
     * be a no-op write that only mints a new revision.
     */
    if (canonicalStringify(merged) === canonicalStringify(remoteSnapshot)) {
      await deps.writeLastRev(remote.rev)
      log(deps, 'info', 'Local and remote are in agreement; nothing to publish.')
      return { status: 'up-to-date' }
    }

    const rev = await pushWithRetry(deps, merged, remote.rev)
    await deps.writeLastRev(rev)

    log(deps, 'info', 'Merged changes and published local data.')
    return { status: 'pushed', rev, merged: true }
  } catch (error) {
    const kind = error instanceof SyncError ? error.kind : 'unknown'
    const message = error instanceof Error ? error.message : String(error)
    log(deps, 'error', message)
    // Local data is untouched on every path here, which is the point of
    // local-first.
    return { status: 'failed', message, kind }
  }
}

/**
 * Push with a bounded number of attempts.
 *
 * A rejection means something else wrote the file since the pull, so the correct
 * response is to re-run the merge from a fresh read, not to retry the same push.
 * Retrying the push alone would clobber the other writer.
 */
async function pushWithRetry (deps, snapshot, expectedRev) {
  let rev = expectedRev
  let current = snapshot

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await delay(BACKOFF_MS * attempt)

    const body = serialiseEnvelope(toEnvelope(current, deps.now()))
    try {
      const result = await deps.provider.push(deps.path, body, rev)
      return result.rev
    } catch (error) {
      const isConflict = error instanceof SyncError && error.kind === 'conflict'
      const retryable = error instanceof SyncError && error.retryable
      if (!isConflict && !retryable) throw error
      if (attempt === MAX_ATTEMPTS - 1) throw error

      if (isConflict) {
        // Re-read so the next merge sees the other writer's data instead of
        // overwriting it with a stale expectedRev.
        log(deps, 'warn', 'Remote changed during sync; re-reading and retrying.')
        const fresh = await deps.provider.pull(deps.path)
        if (!fresh) throw new SyncError('conflict', 'The remote file was removed during sync.')

        const parsed = parseEnvelope(JSON.parse(fresh.body), deps.supportedSchemaVersion)
        if (parsed.ok) {
          /*
           * Read local *again*, not the snapshot this cycle started with.
           *
           * The in-flight snapshot was read before the round trip, so anything
           * the user saved while the network was in flight is in neither argument
           * to the merge: it would not be merged, and it would not be pushed
           * either. "Sync now" would then report success while omitting the item
           * added a second earlier — a success message that is not true of what
           * the user just did.
           *
           * Read outside the merge so a write that lands during the merge itself
           * is not lost either; `writeLocal` is an upsert.
           */
          const latestLocal = await deps.readLocal()
          const merged = mergeSnapshots(latestLocal, parsed.snapshot, deps.supportedSchemaVersion)
          if (merged.ok) {
            current = repairSnapshot(merged.merged)
            await deps.writeLocal(current)
          }
        }
        rev = fresh.rev
      }
    }
  }

  throw new SyncError('network', 'Push did not succeed after retrying')
}

export { SCHEMA_VERSION }
