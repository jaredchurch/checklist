/**
 * Sync provider abstraction.
 *
 * The engine depends only on this interface, never on a Dropbox client. A
 * second provider must be addable without touching the engine, so nothing above
 * this file may know what a rev is, what a scope is called, or what an app
 * folder is.
 */

export const SYNC_ERROR_KINDS = [
  'auth',
  /**
   * The token carries no file permissions.
   *
   * Distinct from plain `auth` because the recovery is known rather than
   * guessed: the stored token is provably unusable, so discarding it is safe,
   * and it turns a dead end into a single reconnect rather than a message
   * explaining what to do.
   */
  'scope-missing',
  'rate-limited',
  'not-found',
  'conflict',
  'network',
  'unknown'
]

/**
 * Normalised error.
 *
 * The engine branches on the kind, never on a provider's error shape, so adding
 * a provider cannot leak its error types into shared code.
 */
export class SyncError extends Error {
  constructor (kind, message) {
    super(message)
    this.name = 'SyncError'
    this.kind = kind
    /*
     * Retryable: rate limits, transient network failures, and push conflicts — a
     * conflict means another device wrote first, so the answer is to re-read and
     * merge, which the engine does. Everything else is not: retrying a rejected
     * token or a refused permission just burns quota and returns the same answer.
     */
    this.retryable = kind === 'rate-limited' || kind === 'network' || kind === 'conflict'
  }
}

export class RemoteFile {
  constructor (body, rev) {
    this.body = body
    /*
     * Opaque provider revision. Used to detect that the remote changed since we
     * last read it, so a concurrent write is merged rather than clobbered.
     */
    this.rev = rev
  }
}

export class SyncProvider {
  /** Restore or acquire credentials. Must be safe when already valid — it runs every cycle. */
  async ensureAuth () { throw new Error('not implemented') }

  /** Discard credentials. Local data must be untouched. */
  async signOut () { throw new Error('not implemented') }

  async status () { throw new Error('not implemented') }

  /**
   * Fetch the remote blob. Must return null for "does not exist", which is
   * distinct from an error: a first run and a failed fetch must not look alike.
   */
  async pull (path) { throw new Error('not implemented') }

  /**
   * Write the blob, enforcing `expectedRev` so a concurrent write is rejected
   * rather than silently overwritten.
   */
  async push (path, body, expectedRev) { throw new Error('not implemented') }
}
