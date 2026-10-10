/**
 * OAuth redirect handling.
 *
 * Dropbox returns the authorisation code in the query string. This runs once at
 * startup, before the app renders.
 *
 * It clears the query string *first*, before exchanging the code, so that a
 * refresh cannot try to redeem the same one-time code twice: the second attempt
 * would fail and look like a real authorisation error. Clearing afterwards
 * would leave the code in the URL for as long as the network call took.
 */

import { dropboxProvider } from './providerFactory.js'

/**
 * The single in-flight callback, memoised.
 *
 * The app starts this without awaiting it, so a slow or unreachable Dropbox
 * never delays startup. Anything that needs to *know* whether the authorisation
 * succeeded — the Sync panel deciding between "connected" and "not connected" —
 * awaits this instead of racing it. Querying the token store before the exchange
 * finishes reports "not connected" for an authorisation that actually worked.
 */
let inFlight = null

export function beginAuthCallback () {
  inFlight ||= completeAuthFromRedirect()
  return inFlight
}

export async function completeAuthFromRedirect () {
  if (typeof window === 'undefined') return false

  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state') || ''
  const error = params.get('error_description') || params.get('error')
  if (!code && !error) return false

  // Clear first: if redemption fails there is nothing to retry, and leaving the
  // code in the URL invites a doomed repeat on reload.
  const clean = window.location.pathname + window.location.hash
  window.history.replaceState({}, '', clean)

  if (error) {
    // Dropbox sends these when the user declines or a scope is missing. Logged
    // rather than swallowed, so a failed authorisation is diagnosable instead of
    // just presenting as "not connected".
    console.warn('[checklist] Dropbox authorisation did not complete:', error)
    recordAuthError(error)
    return false
  }
  if (!code) return false

  try {
    await dropboxProvider().completeAuth(code, state)
    return true
  } catch (cause) {
    // Not rethrown: an authorisation failure must not stop the app from
    // starting. The reason is stored so the Sync panel can show it.
    const message = cause instanceof Error ? cause.message : String(cause)
    console.warn('[checklist] Dropbox authorisation failed:', message)
    recordAuthError(message)
    return false
  }
}

const AUTH_ERROR_KEY = 'checklist:dropbox-auth-error'

function recordAuthError (message) {
  try {
    window.sessionStorage.setItem(AUTH_ERROR_KEY, message)
  } catch {
    // Storage blocked; the console warning above is the only record.
  }
}

/** Read and clear the last authorisation failure, for display in the Sync panel. */
export function takeAuthError () {
  try {
    const value = window.sessionStorage.getItem(AUTH_ERROR_KEY)
    if (value !== null) window.sessionStorage.removeItem(AUTH_ERROR_KEY)
    return value
  } catch {
    return null
  }
}
