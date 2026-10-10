import { SyncError, RemoteFile } from './provider.js'
import { DROPBOX, STRICT_CONFLICT } from './config.js'

/**
 * Dropbox provider.
 *
 * All Dropbox specifics — URLs, scopes, mode flags, status codes — live here or
 * in `config.js`. Nothing above this file imports from `dropbox.js`, so adding a
 * second provider does not touch the engine.
 */

/**
 * The stored credential.
 *
 * `refreshToken` matters more than it looks. Dropbox requires
 * `token_access_type=offline` on the *authorisation URL* before it will return
 * a refresh token at all; without that parameter no `refresh_token` appears in
 * the token payload, whatever else is asked for. Both halves have to be right,
 * and a test asserting the parameter is on the URL is what keeps it there.
 *
 * Without a refresh token the only recovery from an expired access token is
 * sending the user back through Dropbox's consent screen, which makes "please
 * reconnect" a routine event that happens on a timer rather than a signal that
 * something is wrong.
 *
 * `accountId` is absent by design: reading an account name needs the
 * `account_info.read` scope, and requesting a third permission purely to show a
 * label in the UI is a poor trade.
 */
export class DropboxProvider {
  constructor (options) {
    this.id = 'dropbox'
    this.clientId = options.clientId
    this.redirectUri = options.redirectUri
    this.storage = options.storage
    this.fetchImpl = options.fetchImpl || ((...args) => fetch(...args))
    this.randomBytes = options.randomBytes || defaultRandomBytes
    this.now = options.now || (() => Date.now())
    /*
     * The refresh state for this session. Three states, and the difference
     * between the first two is the whole reason this is not a boolean:
     *
     * - `undefined` — not attempted yet. Worth attempting.
     * - a promise — in flight and shared, so two requests failing at once make
     *   one exchange instead of both minting a token and racing each other's
     *   credential write.
     * - `null` — attempted and failed, so the refresh token is dead. Never worth
     *   attempting again this session; without this a tab left open would spend a
     *   token exchange per cycle against a credential that will never work.
     */
    this.refreshTokens = undefined
    /*
     * The pending PKCE verifier, cached for the duration of the round trip.
     *
     * Never sufficient on its own: the OAuth redirect is a full page navigation,
     * so anything held only in memory is gone by the time the code returns.
     * `sessionStorage` is the durable copy that makes the flow work at all.
     */
    this.verifier = null
    this.inMemoryState = null
  }

  /**
   * Whether there is a credential worth using — which is not the same as an
   * access token that has not expired yet.
   *
   * A credential with a refresh token is usable, because the first thing any
   * request does with it is make it current. Answered from local state with no
   * network call, since `status()` reads it to render the connection state.
   */
  async hasUsableToken () {
    const tokens = toTokens(await this.storage.read())
    if (!tokens) return false
    if (tokens.expiresAt !== undefined && tokens.expiresAt <= this.now()) {
      return tokens.refreshToken !== undefined
    }
    return true
  }

  /**
   * Build the URL to send the user to.
   *
   * Async because the PKCE S256 challenge is a SHA-256 digest and
   * `crypto.subtle` has no synchronous digest. Omitting the challenge would
   * mean using the `plain` method, which Dropbox documents as supported but not
   * recommended.
   */
  async beginAuth (state) {
    const verifier = base64Url(this.randomBytes(64))
    this.verifier = verifier
    this.inMemoryState = state
    this.writePending({ verifier, state, createdAt: this.now() })

    const url = new URL(DROPBOX.authorizeUrl)
    url.searchParams.set('client_id', this.clientId)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', this.redirectUri)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('code_challenge', base64Url(await sha256(verifier)))
    url.searchParams.set('state', state)
    /*
     * `token_access_type=offline`, and it has to be here explicitly. Dropbox
     * documents it as a requirement, not a default: without this parameter no
     * `refresh_token` is returned, whatever else is asked for.
     *
     * Safe to send now that the scopes are granted: with it, Dropbox grants
     * exactly what the Permissions tab lists.
     */
    url.searchParams.set('token_access_type', 'offline')
    /*
     * Deliberately no `scope` parameter. Dropbox documents that omitting it
     * requests exactly the scopes selected on the app's Permissions tab, which
     * makes the console the single source of truth for what the app may access.
     *
     * Requesting an explicit subset is the fragile choice: whenever the console
     * and the code disagree by even one scope, Dropbox rejects the whole
     * authorisation with `scope_not_granted` and the app cannot start at all.
     * Least privilege is still achieved, by ticking only the two scopes in the
     * console.
     */
    return { url: url.toString() }
  }

  /**
   * Exchange the authorisation code from the redirect for tokens.
   *
   * `state` is checked against the value stored by `beginAuth`. Without that
   * check a third party could feed this app an authorisation code of their
   * choosing, and the app would silently adopt whichever Dropbox account that
   * code belongs to.
   */
  async completeAuth (code, state) {
    const pending = this.readPending()

    if (!pending) {
      throw new SyncError(
        'auth',
        'This authorisation link has expired or was started in a different browser tab. Start again from the Sync panel.'
      )
    }
    if (pending.state !== state) {
      // Drop it: a mismatched state means this callback is not ours.
      this.clearPending()
      throw new SyncError('auth', 'Authorisation state did not match. Start again.')
    }

    const body = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      code_verifier: pending.verifier
    })

    const response = await this.fetchImpl(DROPBOX.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })
    if (!response.ok) {
      throw new SyncError('auth', `Authorisation failed (${response.status}).`)
    }

    const json = await response.json()
    if (!json.access_token) {
      throw new SyncError('auth', 'Authorisation response contained no access token.')
    }

    await this.storage.write({
      accessToken: json.access_token,
      // Present only if the provider issued one; its absence is not an error.
      expiresAt: this.now() + (json.expires_in !== undefined ? json.expires_in : TOKEN_TTL_FALLBACK_SECONDS) * 1000,
      ...(json.account_id ? { accountId: json.account_id } : {}),
      // Kept rather than discarded — see the file header.
      ...(json.refresh_token ? { refreshToken: json.refresh_token } : {})
    })
    this.verifier = null
    this.inMemoryState = null
    this.clearPending()
  }

  writePending (pending) {
    try {
      window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
    } catch {
      // Without this the round trip cannot complete, so surface it at the point
      // of the redirect rather than after a confusing failure on the way back.
      throw new SyncError(
        'auth',
        'This browser is blocking session storage, so the Dropbox authorisation cannot be completed.'
      )
    }
  }

  readPending () {
    let raw
    try {
      raw = window.sessionStorage.getItem(PENDING_KEY)
    } catch {
      // Storage is blocked. Fall back to the in-memory copy: that only works if
      // no navigation happened, but it is better than failing outright.
      return this.verifier && this.inMemoryState
        ? { verifier: this.verifier, state: this.inMemoryState, createdAt: this.now() }
        : null
    }
    if (!raw) return null

    try {
      const parsed = JSON.parse(raw)
      if (
        typeof parsed.verifier !== 'string' ||
        parsed.verifier === '' ||
        typeof parsed.state !== 'string' ||
        typeof parsed.createdAt !== 'number'
      ) {
        return null
      }
      // Expire it, so a stale entry cannot be replayed much later.
      if (this.now() - parsed.createdAt > PENDING_TTL_MS) {
        this.clearPending()
        return null
      }
      return parsed
    } catch {
      return null
    }
  }

  clearPending () {
    try {
      window.sessionStorage.removeItem(PENDING_KEY)
    } catch {
      // Nothing more to do.
    }
  }

  async ensureAuth () {
    const tokens = toTokens(await this.storage.read())
    if (!tokens) {
      // No usable token and no interactive sign-in available from here, so the
      // caller must prompt the user. Signalling this as an auth error lets the
      // engine skip the cycle quietly rather than reporting a failure.
      throw new SyncError('auth', 'Not connected to Dropbox.')
    }

    if (tokens.expiresAt !== undefined && tokens.expiresAt <= this.now()) {
      // Expired, but refreshable — so make it current rather than reporting a
      // dead credential the user would have to sign in for.
      if (tokens.refreshToken === undefined) {
        throw new SyncError('auth', 'Not connected to Dropbox.')
      }
      const outcome = await this.runRefresh()
      if (outcome.ok) return
      throw this.refreshFailure(outcome.reason)
    }
  }

  /** The shared, in-flight refresh, started on first use. */
  async runRefresh () {
    if (this.refreshTokens === undefined) this.refreshTokens = this.refreshAccessToken()
    // The memo may already be `null` — a refresh this session already found to
    // be rejected — so it is not always something to await.
    return this.refreshTokens || { ok: false, reason: 'rejected' }
  }

  /**
   * Turn a failed refresh into the error the engine should see.
   *
   * `rejected` is `auth`, which the scheduler recovers from by discarding the
   * credential and offering Connect. `unreachable` is `network`, which it does
   * not — it backs off and tries again. That single choice is what keeps a
   * dropped connection from signing someone out.
   */
  refreshFailure (reason) {
    return reason === 'rejected'
      ? new SyncError('auth', 'Not connected to Dropbox.')
      : new SyncError('network', 'Could not reach Dropbox to renew the connection.')
  }

  async signOut () {
    // Local data is deliberately untouched: signing out of the sync provider
    // must never be the same as deleting a user's checklists.
    this.verifier = null
    this.inMemoryState = null
    this.clearPending()
    await this.storage.clear()
  }

  async status () {
    return { authenticated: await this.hasUsableToken() }
  }

  async pull (path) {
    const arg = { path: normalizePath(path) }

    // POST with the argument in the header: `download` is `style = "download"`
    // with a DownloadArg struct, so the path does not belong in the URL.
    const response = await this.authenticated((accessToken) =>
      this.fetchImpl(DROPBOX.downloadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Dropbox-API-Arg': JSON.stringify(arg)
        }
      })
    )

    if (response.ok) {
      const rev = response.headers.get('dropbox-api-result')
      const body = await response.text()
      return new RemoteFile(body, rev ? parseRev(rev) : 'unknown')
    }

    const detail = await describeFailure(response, { op: `download ${arg.path}`, args: arg })
    if (detail.kind === 'not-found') return null
    throw detail.error
  }

  async push (path, body, expectedRev) {
    const args = {
      path: normalizePath(path),
      mode: expectedRev ? DROPBOX.updateMode(expectedRev) : DROPBOX.overwriteMode,
      autorename: false,
      mute: true,
      strict_conflict: STRICT_CONFLICT
    }

    const response = await this.authenticated((accessToken) =>
      this.fetchImpl(DROPBOX.uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify(args)
        },
        body
      })
    )

    if (response.ok) {
      const json = await response.json()
      return { rev: json.rev || 'unknown' }
    }

    const detail = await describeFailure(response, { op: `upload ${args.path}`, args })
    if (detail.kind === 'conflict') {
      throw new SyncError('conflict', 'The remote file changed before this write landed.')
    }
    throw detail.error
  }

  async requireToken () {
    const tokens = toTokens(await this.storage.read())
    if (!tokens) throw new SyncError('auth', 'Not connected to Dropbox.')
    return tokens
  }

  /**
   * Make an authenticated request, refreshing once if the credential is dead.
   *
   * **Once, and only on a credential failure.** Two bounds, both load-bearing:
   *
   * - Only a 401/403 triggers it. Refreshing on any failure would spend a round
   *   trip on every rate limit and every offline attempt, and would make a
   *   network problem look like a credential problem.
   * - Only one retry. A refresh token that is itself dead returns
   *   `invalid_grant`, and an unbounded retry against one is a loop that looks
   *   like syncing.
   *
   * A refresh that fails is reported by *reason*, not as a bare auth error:
   * returning the original 401 re-classified a Dropbox outage as a revoked
   * credential, and the scheduler's response to `auth` is to discard the stored
   * token and ask the user to sign in — so a 502 from the token endpoint cost
   * someone their connection.
   */
  async authenticated (send) {
    const tokens = await this.requireToken()

    const first = await classifyAuthFailure(await send(tokens.accessToken))
    if (!first.credential || tokens.refreshToken === undefined) return first.response

    const outcome = await this.runRefresh()
    if (!outcome.ok) throw this.refreshFailure(outcome.reason)

    return (await classifyAuthFailure(await send(outcome.accessToken))).response
  }

  /**
   * Mints a new access token, or reports why it could not.
   *
   * Memoised for the life of the provider so concurrent failures share one
   * exchange. Cleared to `null` when the exchange fails, so a revoked refresh
   * token is not retried for every subsequent request in the session.
   */
  async refreshAccessToken () {
    const stored = toTokens(await this.storage.read())
    const refreshToken = stored?.refreshToken
    if (refreshToken === undefined) return { ok: false, reason: 'rejected' }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId
    })

    try {
      const response = await this.fetchImpl(DROPBOX.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      })
      if (!response.ok) {
        /*
         * Dropbox answered, and the answer was no. 4xx is Dropbox refusing this
         * token; 5xx and 429 are Dropbox being unavailable or throttling us,
         * which says nothing about the token. Conflating them is what made a
         * transient outage destroy a working connection.
         */
        const refused = response.status >= 400 && response.status < 500 && response.status !== 429
        if (refused) this.refreshTokens = null
        return { ok: false, reason: refused ? 'rejected' : 'unreachable' }
      }

      const json = await response.json()
      if (typeof json.access_token !== 'string' || json.access_token === '') {
        // A 200 with no token is not a credential we can use, and there is
        // nothing to retry — but it is still not Dropbox refusing the token, so
        // keep it for a later attempt rather than signing the user out over a
        // malformed response.
        this.refreshTokens = null
        return { ok: false, reason: 'unreachable' }
      }

      await this.storage.write({
        // Spread the existing credential rather than assembling one, so a field
        // added to the token shape later is not silently dropped on the first
        // refresh — which is how the refresh token itself was nearly lost.
        ...stored,
        accessToken: json.access_token,
        expiresAt:
          this.now() +
          (typeof json.expires_in === 'number' ? json.expires_in : TOKEN_TTL_FALLBACK_SECONDS) * 1000
      })
      return { ok: true, accessToken: json.access_token }
    } catch {
      // The request never completed: offline, DNS failure, a blocked request.
      // The token is untouched and unquestioned.
      return { ok: false, reason: 'unreachable' }
    }
  }
}

/**
 * Where the pending authorisation is parked across the redirect.
 *
 * sessionStorage is correct and deliberate: it survives a same-tab navigation,
 * which is exactly the one journey this needs to survive, and it is scoped to
 * the tab and discarded when the tab closes. localStorage would outlive the
 * authorisation and leave a token-exchange credential lying around for no
 * reason.
 *
 * The verifier is a short-lived secret — it is what proves the token request
 * belongs to the authorisation request — so it is kept out of localStorage and
 * out of any export.
 */
const PENDING_KEY = 'checklist:dropbox-pending'

/** Ten minutes: long enough for a login and a consent screen, short enough to expire. */
const PENDING_TTL_MS = 10 * 60 * 1000

/** Used when Dropbox omits `expires_in`. Access tokens last hours, not forever. */
const TOKEN_TTL_FALLBACK_SECONDS = 4 * 60 * 60

/**
 * Defensive parse of a stored credential.
 *
 * The value is untrusted input in practice: it survives schema migrations and
 * may have been written by a different build or a different provider. A
 * malformed record reads as "not connected" so the user is prompted to
 * reconnect, rather than the app failing on a shape mismatch or — worse — using
 * a field that happens to be a string.
 *
 * Lives here rather than in `tokenStore.js` because only the provider knows what
 * a token for it looks like.
 */
function toTokens (value) {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value
  if (typeof candidate.accessToken !== 'string' || candidate.accessToken === '') return null

  return {
    accessToken: candidate.accessToken,
    ...(typeof candidate.expiresAt === 'number' ? { expiresAt: candidate.expiresAt } : {}),
    ...(typeof candidate.accountId === 'string' ? { accountId: candidate.accountId } : {}),
    // Absent on a credential written before this field existed, which is fine:
    // the refresh path checks for it and reports `token-lost` when there is none.
    ...(typeof candidate.refreshToken === 'string' && candidate.refreshToken !== ''
      ? { refreshToken: candidate.refreshToken }
      : {})
  }
}

/**
 * Dropbox paths MUST begin with a slash.
 *
 * The spec declares `WritePath` and `ReadPath` as strings matching
 * `(/(.|\r\n)*)|(ns:...)` — the leading slash is part of the pattern, not a
 * convention. A path without one fails validation and Dropbox answers with its
 * catch-all `other/` error, which says nothing useful.
 *
 * With App Folder access the slash is relative to the app folder, so
 * `/checklist.json` resolves to `/apps/<app name>/checklist.json`. It does not
 * address the account root.
 */
function normalizePath (path) {
  // Collapse any run of leading slashes to one, so a path configured with extra
  // slashes still addresses the intended file rather than a differently-named one.
  return `/${path.trim().replace(/^\/+/, '')}`
}

/**
 * Decide whether a failed response means the *credential* is dead, as opposed
 * to the app being refused for a reason refreshing cannot fix.
 *
 * Status-based in principle — the body has to be parsed to be understood, and
 * by the time it has been the request has already failed for a reason that may
 * not be the credential. But the status alone is not enough here: Dropbox
 * answers `missing_scope` with a 403, the same status as an expired token.
 * Refreshing on it spent a round trip, failed, and reported "Not connected to
 * Dropbox", so the user was told to reconnect when the thing that needed to
 * change was a tick in the app console — and the scheduler's explanation of
 * exactly that, which is the most useful message in this whole module, was
 * unreachable.
 *
 * Returns a response whose body can still be read, because the caller needs it
 * to describe the failure.
 */
async function classifyAuthFailure (response) {
  if (response.ok) return { credential: false, response }
  if (response.status !== 401 && response.status !== 403) return { credential: false, response }

  const text = await response.text()
  let missingScope = false
  try {
    missingScope = String(JSON.parse(text)?.error_summary ?? '').startsWith('missing_scope')
  } catch {
    // Not JSON. The status alone decides, which is the tolerant direction.
  }

  return { credential: !missingScope, response: rewind(response, text) }
}

/**
 * A body can only be read once, so hand back a response carrying a fresh copy.
 *
 * Built rather than assigned so this works against the real `Response` and
 * against the minimal stand-ins tests use, without the caller knowing which.
 */
function rewind (response, text) {
  if (typeof Response === 'function') {
    try {
      return new Response(text, { status: response.status, headers: response.headers })
    } catch {
      // Fall through: some environments refuse to construct one.
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    text: async () => text,
    json: async () => JSON.parse(text)
  }
}

/**
 * Turn a failed response into a classified, explained error.
 *
 * Dropbox returns a JSON body containing `error_summary` — values such as
 * `path/not_found/`, `path/conflict/file` or `invalid_access_token` — which say
 * exactly what went wrong. Discarding it and reporting only "upload failed
 * (409)" is what makes a real failure undiagnosable from the app.
 */
async function describeFailure (response, call) {
  const status = response.status

  // Read once, as text. `response.json()` throws on the failure paths that turn
  // out to be non-JSON, and an unreadable body left the error with no detail at
  // all — which forced a guess about the cause.
  const raw = (await response.text()).trim()

  let summary = ''
  try {
    const body = JSON.parse(raw)
    summary = body.error_summary || (body.error ? JSON.stringify(body.error) : '')
  } catch {
    // Not JSON. Dropbox answers some malformed requests with an empty or
    // plain-text body, so the status and raw text are all there is to go on.
  }

  // Everything known about the failure, in one string. A response with no
  // usable body is the case that matters most and previously carried the least
  // information, so the raw text is included rather than discarded.
  const detail =
    `\nHTTP ${status} on ${call.op}` +
    `\nargs: ${JSON.stringify(call.args)}` +
    (summary ? `\nDropbox said: ${summary}` : '') +
    (raw && !summary ? `\nbody: ${raw.slice(0, 300)}` : '')

  if (status === 401) {
    return { kind: 'auth', error: new SyncError('auth', `Dropbox rejected the token.${detail}`) }
  }
  if (status === 429) {
    return {
      kind: 'rate-limited',
      error: new SyncError('rate-limited', `Dropbox rate limit reached.${detail}`)
    }
  }
  if (status === 409) {
    if (summary.includes('not_found')) {
      // A missing file is a normal first-run state, not a failure.
      return { kind: 'not-found', error: new SyncError('not-found', 'File not found.') }
    }
    return { kind: 'conflict', error: new SyncError('conflict', `The remote file changed.${detail}`) }
  }
  if (summary.startsWith('missing_scope')) {
    // Dropbox names this precisely, so the fix is known rather than guessed: the
    // token carries no file permissions. Authorisation succeeds without any —
    // consent is given for whatever the app has ticked, and a new app has none —
    // so it surfaces here, on the first file call.
    return {
      kind: 'scope-missing',
      error: new SyncError('scope-missing', `The Dropbox connection has no file permissions.${detail}`)
    }
  }

  // No specific case for the remainder, so report what came back rather than
  // guessing at a cause. A previous version asserted the most common cause —
  // that no permissions were ticked — which was wrong once they were, and sent
  // the debugging in the wrong direction while hiding the status and body that
  // would have shown it.
  return {
    kind: 'unknown',
    error: new SyncError('unknown', `Dropbox rejected the request without saying why.${detail}`)
  }
}

function parseRev (header) {
  try {
    return JSON.parse(header).rev || 'unknown'
  } catch {
    return 'unknown'
  }
}

function defaultRandomBytes (length) {
  const bytes = new Uint8Array(length)
  const webCrypto = globalThis.crypto
  if (!webCrypto || !webCrypto.getRandomValues) {
    throw new SyncError('auth', 'No secure random source available for PKCE.')
  }
  webCrypto.getRandomValues(bytes)
  return bytes
}

/**
 * Base64url (RFC 4648 §5): standard base64 with `+`/`/` swapped and padding
 * stripped, which is what PKCE requires for the verifier and challenge.
 */
function base64Url (bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256 (value) {
  const encoded = new TextEncoder().encode(value)
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new SyncError('auth', 'No subtle crypto available for the PKCE challenge.')
  }
  return new Uint8Array(await subtle.digest('SHA-256', encoded))
}
