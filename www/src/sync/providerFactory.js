import { DropboxProvider } from './dropbox.js'
import { DROPBOX } from './config.js'
import { tokenStore } from './tokenStore.js'
import { readAppKey } from './appKey.js'
import { currentRedirectUri } from './redirect.js'

/**
 * Provider construction.
 *
 * Kept separate so the redirect handler and the Sync panel build an identical
 * provider. That matters for the reason at the cache below.
 */
function build () {
  return new DropboxProvider({
    clientId: readAppKey(),
    // From the shared definition rather than rebuilt here, so the URI the
    // provider sends and the one the panel tells the user to register cannot
    // drift apart. A mismatch here is reported by Dropbox only as
    // `invalid_redirect_uri`, naming nothing useful.
    redirectUri: currentRedirectUri(),
    storage: tokenStore
  })
}

let cached = null

/**
 * Synchronous and cached.
 *
 * One instance for the whole app. The redirect handler and the Sync panel must
 * share it, because a second instance would hold its own PKCE verifier and so
 * could not complete an authorisation the first one began.
 *
 * Cached for the life of the page and never invalidated: the client id is chosen
 * by hostname and compiled in, so it cannot change at runtime. There is
 * deliberately no reset — the one thing that used to need it was a user pasting a
 * different key into the browser, and that path no longer exists.
 */
export function dropboxProvider () {
  cached ||= build()
  return cached
}

export const REMOTE_PATH = DROPBOX.defaultRemotePath
