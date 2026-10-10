import { runSync } from './engine.js'
import { fireAndForget } from './fireAndForget.js'
import { isEditing, onEditBegan, onEditSettled } from './editGate.js'
import { SCHEMA_VERSION } from './snapshot.js'

/**
 * Sync scheduling.
 *
 * Triggers: app open, a debounced local write, returning to the tab,
 * `pagehide`, and a manual button. Deliberately no background polling — there
 * is no inbound push path, so a timer produces only empty cycles and keeps the
 * device awake.
 *
 * The local-write trigger is the storage layer's revision counter rather than an
 * argument passed in by whichever view happened to make the change. That
 * inversion matters: with the trigger supplied from outside, `schedule()` was
 * reachable only if every write path remembered to call it, none did, and the
 * debounce it implements was unreachable in production while its tests passed.
 * Every write already bumps the revision, so subscribing to it here means the
 * trigger cannot be forgotten.
 */

export const DEBOUNCE_MS = 5000

/**
 * How long to wait before retrying a transiently failed cycle.
 *
 * Three attempts, then it stops. An unbounded retry would spend a request every
 * minute on a network that stays down until the tab is closed.
 */
const RETRY_BACKOFF_MS = [5000, 30000, 120000]

/** Failures that mean the stored token cannot be used and must be replaced. */
function isAuthFailure (kind) {
  return kind === 'auth' || kind === 'scope-missing'
}

/**
 * Failures worth trying again on our own.
 *
 * Deliberately narrower than `SyncError.retryable`, which also includes
 * `conflict` — a conflict is handled *inside* the cycle by re-reading and
 * retrying the push, so one reaching here means that handling was exhausted.
 *
 * `auth` and `scope-missing` are excluded because waiting cannot fix them: the
 * user has to authorise again, or the Dropbox app console has to change.
 */
function isTransientFailure (kind) {
  return kind === 'network' || kind === 'rate-limited'
}

/**
 * What to say when the stored token turns out to be unusable.
 *
 * Says what happened and what is still true, and nothing more. The precise
 * cause — expired, revoked, or the app's permissions changed — is not knowable
 * from here, and guessing between them costs the user more time than admitting
 * it.
 */
const TOKEN_LOST =
  'Dropbox sign-in has expired or is no longer valid, so sync is paused. ' +
  'Your data is safe in this browser — reconnect to carry on syncing.'

/**
 * What to say when Dropbox refused the app for a permission.
 *
 * Separate from `TOKEN_LOST` because the two need opposite actions and only one
 * of them is the user's: reauthorising cannot add a scope, so telling someone
 * to reconnect sends them in a circle. This is usually the Dropbox *app console*
 * missing a tick, and the Connect button reappearing with no explanation would be
 * the only clue they got.
 */
const SCOPE_MISSING =
  'Dropbox rejected the app for a missing permission. Check that files.content.read and ' +
  'files.content.write are ticked on your app in the Dropbox App Console, then connect again.'

export class SyncScheduler {
  constructor (config) {
    this.provider = config.provider
    this.path = config.path
    this.debounceMs = config.debounceMs ?? DEBOUNCE_MS
    this.now = config.now || (() => new Date())
    this.onStatus = config.onStatus
    this.onLog = config.onLog
    this.subscribeRevision = config.subscribeRevision
    this.readLocal = config.readLocal
    this.writeLocal = config.writeLocal
    this.readLastRev = config.readLastRev
    this.writeLastRev = config.writeLastRev
    this.writeLastSyncAt = config.writeLastSyncAt
    this.readLastSyncAt = config.readLastSyncAt
    this.onAuthLost = config.onAuthLost

    this.debounceTimer = null
    /** Armed only after a transient failure. */
    this.retryTimer = null
    this.retryCount = 0
    this.onVisibilityChange = null
    this.onPageHide = null
    this.onRevision = null
    this.detachRevision = null
    this.detachEditBegan = null
    this.detachEditSettled = null

    /*
     * An edit opening has to disarm a cycle that is already armed.
     *
     * This is the half that actually matters for the bug it fixes. Adding an
     * item saves it *before* the rename dialog appears, so `schedule()` has
     * already armed the debounce by the time the edit begins — and without this
     * it fires five seconds in, mid-rename, publishing the placeholder title.
     * Holding only in `schedule()` would catch every save that happened *during*
     * the dialog and none of the one that armed it.
     *
     * Only marks the cycle held if one was genuinely pending. Opening a dialog
     * with nothing scheduled must not oblige a sync on the way out.
     */
    this.detachEditBegan = onEditBegan(() => {
      if (this.stopped) return
      if (!this.debounceTimer) return
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
      this.cycleHeldForEdit = true
    })

    /*
     * And re-arm it when the last dialog closes.
     *
     * Registered in the constructor rather than in `start()`. A cycle held by
     * `schedule()` is only released by this listener, so a scheduler that
     * suppressed a cycle without having registered it would drop that cycle
     * silently and for the rest of the session — sync simply never happening
     * again, with nothing on screen to say why. `schedule()` is public, so it has
     * to be safe to call at any point in the scheduler's life.
     */
    this.detachEditSettled = onEditSettled(() => {
      if (!this.cycleHeldForEdit) return
      this.cycleHeldForEdit = false
      this.schedule()
    })

    /*
     * A cycle that was suppressed because the user was mid-rename.
     *
     * Not the same as `workOutstanding`, which means "there is work to send".
     * This means "a cycle would have been armed by now, except that publishing
     * half a name was exactly what we were avoiding". Tracked separately so the
     * edit settling re-arms a cycle that was actually held, rather than forcing
     * a sync after every dialog the user opened and abandoned.
     */
    this.cycleHeldForEdit = false

    /*
     * True while this scheduler is the one writing, so the bump its own write
     * causes is not mistaken for the user having changed something.
     *
     * Without this, every sync that merged remote data would schedule another
     * cycle to publish the write it had just made — a second round trip that
     * finds nothing. It has to be a flag around `writeLocal` rather than a
     * revision comparison, because a user write that lands *during* a cycle must
     * still be noticed; the two are indistinguishable by revision number, and
     * only by asking who caused it.
     */
    this.writingLocally = false
    this.stopped = false
    this.running = false
    this.queuedWhileRunning = false

    /*
     * Whether changes are still outstanding: an armed debounce, or work that
     * arrived after the current cycle started reading.
     *
     * This makes `pending` work-scoped rather than cycle-scoped. Clearing it
     * unconditionally in the cycle's `finally` meant a write landing mid-cycle
     * lit the indicator and then had it cleared by a cycle that had already
     * passed it — leaving the flag false for the whole debounce window before
     * the change was actually pushed. Nothing was lost, but the indicator was
     * wrong in exactly the window it exists to describe.
     */
    this.workOutstanding = false
    this.started = false

    this.status = {
      state: 'idle',
      lastOutcome: null,
      lastSyncAt: null,
      lastRev: null,
      message: null,
      pending: false
    }
  }

  /**
   * Level defaults to `info` because most scheduler messages are ordinary
   * lifecycle notes — a cycle starting, nothing to publish. Hardcoding `warn`
   * made every routine message look like a problem.
   */
  log (message, level = 'info') {
    this.onLog?.({ at: this.now().toISOString(), level, message })
  }

  emit (patch) {
    this.status = { ...this.status, ...patch }
    this.onStatus?.(this.status)
  }

  /**
   * Begin scheduling. Safe to call once; the load-time sync runs here.
   */
  async start () {
    if (this.started) return
    this.started = true

    // Tab focus: the user has just come back, so this is the moment most likely
    // to want a fresh pull.
    this.onVisibilityChange = () => {
      if (document.visibilityState === 'visible') fireAndForget(this.syncNow())
    }
    document.addEventListener('visibilitychange', this.onVisibilityChange)

    // The last reliable hook before a tab is discarded. A best-effort push here,
    // never a blocking prompt.
    this.onPageHide = () => {
      fireAndForget(this.syncNow())
    }
    window.addEventListener('pagehide', this.onPageHide)

    /*
     * Stored before the first `await` so `stop()` can detach it even if it is
     * called while `start()` is still waiting on storage. Registering it
     * afterwards left a live subscription belonging to a scheduler nobody held,
     * still scheduling cycles.
     */
    this.onRevision = () => {
      if (this.writingLocally) return
      this.schedule()
    }
    this.detachRevision = this.subscribeRevision(this.onRevision)

    this.emit({ lastSyncAt: await this.readLastSyncAt() })
    // Once per app start, not per cycle: the revision is a reportable fact, not
    // an input to any decision.
    this.emit({ lastRev: await this.readLastRev() })
    await this.syncNow()
  }

  /**
   * Arm a retry after a transiently failed cycle.
   *
   * **This is not polling.** It fires only when the last cycle actually failed,
   * and there is nothing to retry once one succeeds — so a healthy tab
   * schedules nothing at all. That distinction is why this can coexist with the
   * no-background-polling rule rather than override it.
   */
  armRetry () {
    if (this.stopped) return
    if (this.retryCount >= RETRY_BACKOFF_MS.length) return
    const wait = RETRY_BACKOFF_MS[this.retryCount]
    this.retryCount += 1
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      fireAndForget(this.syncNow())
    }, wait)
  }

  /** Drop any armed retry and reset the budget. */
  clearRetry () {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.retryCount = 0
  }

  /**
   * Stop scheduling.
   *
   * Detaches the listeners as well as clearing the pending timer. Clearing the
   * timer alone left `visibilitychange` and `pagehide` attached and
   * `schedule()` still armed, so a stopped scheduler kept syncing — the method
   * said one thing and did another.
   */
  stop () {
    this.stopped = true
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = null
    // With the debounce timer. Without it an armed retry survives teardown and
    // the stopped scheduler goes on syncing, which is the exact failure the
    // rest of this method exists to prevent — and `schedule()`'s own stopped
    // check does not help, because a retry calls `syncNow()` directly.
    this.clearRetry()
    this.detachRevision?.()
    this.detachRevision = null
    this.detachEditBegan?.()
    this.detachEditBegan = null
    this.detachEditSettled?.()
    this.detachEditSettled = null
    this.onRevision = null
    if (this.onVisibilityChange) {
      document.removeEventListener('visibilitychange', this.onVisibilityChange)
      this.onVisibilityChange = null
    }
    if (this.onPageHide) {
      window.removeEventListener('pagehide', this.onPageHide)
      this.onPageHide = null
    }
  }

  /**
   * Schedule a sync after a quiet period.
   *
   * Coalesces a burst of edits into one cycle. Called by the revision
   * subscription on every local write, which is what makes "syncs after you tick
   * something off" true without any view knowing sync exists.
   *
   * **Held while a rename dialog is open.** The debounce is short enough that
   * typing a title can outlast it, so without this a cycle fires part-way
   * through and publishes the item under its placeholder name — the other device
   * then shows "New item" until a second sync corrects it. Holding is not
   * delaying for no reason: the work is genuinely not in a publishable state
   * until the dialog closes. `pending` still goes true immediately, so the
   * indicator tells the truth for the whole window.
   *
   * Deliberately does *not* block `syncNow`. A manual "Sync now", and the
   * `pagehide` push, are deliberate flushes and the dialog is modal over them
   * anyway; refusing them would mean the app quietly ignored a button.
   */
  schedule () {
    // Ignored once stopped, so a late write cannot resurrect a scheduler the app
    // has already torn down.
    if (this.stopped) return
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = null
    // Announced the moment the change is registered rather than when the cycle
    // runs, so "pending" covers the whole debounce window, not just the round
    // trip.
    this.workOutstanding = true
    this.emit({ pending: true })

    if (isEditing()) {
      this.cycleHeldForEdit = true
      return
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      fireAndForget(this.syncNow())
    }, this.debounceMs)
  }

  /**
   * Run a cycle now.
   *
   * Two concurrent cycles are the most likely source of duplicate or lost
   * writes, so a cycle arriving mid-flight is remembered and run once after,
   * not run in parallel.
   */
  async syncNow () {
    // Stopped means stopped, whoever is asking. A manual "Sync now" — or a
    // retry timer that was mid-flight when teardown began — must not start a
    // cycle on a scheduler nobody holds.
    if (this.stopped) return null
    if (this.running) {
      this.queuedWhileRunning = true
      return null
    }
    this.running = true
    // Everything outstanding is being read by this cycle from here on. Anything
    // that arrives afterwards re-arms the flag in `schedule`.
    this.workOutstanding = false
    this.emit({ state: 'syncing', message: null })

    try {
      const outcome = await runSync({
        provider: this.provider,
        path: this.path,
        supportedSchemaVersion: SCHEMA_VERSION,
        readLocal: this.readLocal,
        // Wrapped so the revision subscription can tell our own write from the
        // user's.
        writeLocal: async (snapshot) => {
          this.writingLocally = true
          try {
            await this.writeLocal(snapshot)
          } finally {
            this.writingLocally = false
          }
        },
        // The engine records the revision but never reads it; the scheduler
        // reads it once at startup for the status line.
        writeLastRev: this.writeLastRev,
        now: this.now,
        onLog: (entry) => {
          if (entry.level === 'error') this.emit({ message: entry.message })
        }
      })

      const at = this.now().toISOString()

      /*
       * A rejected token is provably unusable — expired, or granted without the
       * permissions the app now needs. Discarding it loses nothing (local data is
       * untouched by sign-out) and turns a dead end into a single reconnect.
       *
       * `skipped` is `not-authenticated`, and it means the token died rather than
       * that there was never one: the scheduler only runs while the panel says
       * connected, so this cannot be a first run. It used to render as a green
       * "Synced" indefinitely, and the Connect button never came back — the user
       * being told their work was on the other device when it was not.
       */
      const scopeMissing = outcome.status === 'failed' && outcome.kind === 'scope-missing'
      const tokenUnusable =
        outcome.status === 'skipped' ||
        (outcome.status === 'failed' && isAuthFailure(outcome.kind))

      if (tokenUnusable) {
        this.log('The saved Dropbox token stopped working; discarded it so you can reconnect.', 'warn')
        await this.provider.signOut()
        // Whoever owns the connection state has to learn about this, or the app
        // goes on claiming to be connected to a provider it has just left.
        this.onAuthLost?.()
      }

      if (outcome.status === 'pushed' || outcome.status === 'up-to-date') {
        this.clearRetry()
        await this.writeLastSyncAt(at)
        this.emit({ state: 'idle', lastOutcome: outcome, lastSyncAt: at, message: null })
      } else if (tokenUnusable) {
        this.clearRetry()
        this.emit({
          state: 'error',
          lastOutcome: outcome,
          message: scopeMissing ? SCOPE_MISSING : TOKEN_LOST
        })
      } else {
        // A cycle that failed transiently is retried on a timer; one that failed
        // permanently is not. Disarming on anything else matters as much as
        // arming: a stale retry left over from an outage would keep firing after
        // a successful manual sync.
        if (outcome.status === 'failed' && isTransientFailure(outcome.kind)) this.armRetry()
        else this.clearRetry()

        this.emit({
          state: 'error',
          lastOutcome: outcome,
          message:
            outcome.status === 'blocked' ? outcome.message : `Sync failed: ${outcome.message}`
        })
      }
      return outcome
    } finally {
      this.running = false
      // Cleared rather than left lit forever on a failed cycle: a failure has
      // still resolved whatever it could, and an indicator that never goes out
      // trains the user to ignore it. But only when nothing is outstanding — a
      // write that arrived mid-flight set `workOutstanding`, and clearing the
      // flag then would misreport the debounce window as synced.
      if (!this.workOutstanding) this.emit({ pending: false })
      if (this.queuedWhileRunning) {
        this.queuedWhileRunning = false
        fireAndForget(this.syncNow())
      }
    }
  }

  getStatus () {
    return this.status
  }
}
