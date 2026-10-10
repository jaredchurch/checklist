/**
 * Start a promise without waiting for it, and without losing its failure.
 *
 * Sync runs on timers, on `visibilitychange` and on `pagehide`, so most of its
 * entry points are fire-and-forget by nature — there is no caller left to await
 * them, and blocking the event handler on a network round trip would be worse
 * than not syncing.
 *
 * The point of this helper is the `.catch`. Discarding the promise outright
 * leaves a rejection with nowhere to surface, which is exactly the silent
 * failure that makes a sync bug impossible to find from inside the app: a
 * rejected cycle would simply not happen, and the status line would show
 * "Up to date".
 *
 * `catch` rather than `finally`: `finally` re-throws, which is the opposite of
 * what a fire-and-forget caller wants.
 *
 * Used instead of `void promise`, which the project's lint rules reject — and
 * rightly: `void` silences the rejection as thoroughly as dropping it does.
 */
export function fireAndForget (promise, onError) {
  Promise.resolve(promise).catch((err) => {
    if (onError) onError(err)
    else console.warn('[checklist] background task failed:', err)
  })
}
