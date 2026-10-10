import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DropboxProvider } from '../sync/dropbox.js'
import { SyncError } from '../sync/provider.js'
import { DROPBOX } from '../sync/config.js'

/**
 * A token store that lives in memory.
 *
 * The provider takes its store as a dependency precisely so it can be tested
 * without IndexedDB — and so a second provider could supply its own.
 */
function memoryStore (initial = null) {
  // A closure rather than `this`: the arrow functions below would capture
  // `memoryStore`'s `this`, which is undefined.
  let value = initial
  return {
    read: vi.fn(async () => value),
    write: vi.fn(async (v) => { value = v }),
    clear: vi.fn(async () => { value = null })
  }
}

/** A Response-alike, since jsdom does not provide the real one usefully. */
function response (body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body)
  }
}

const validTokens = {
  accessToken: 'access-1',
  expiresAt: Date.now() + 3600_000,
  refreshToken: 'refresh-1'
}

function build (overrides = {}) {
  return new DropboxProvider({
    clientId: 'testclientid',
    redirectUri: 'https://example.test/app/',
    storage: overrides.storage || memoryStore(),
    fetchImpl: overrides.fetchImpl || vi.fn(),
    randomBytes: overrides.randomBytes || (() => new Uint8Array(64).fill(7)),
    now: overrides.now
  })
}

beforeEach(() => {
  window.sessionStorage.clear()
})

describe('beginAuth', () => {
  it('sends token_access_type=offline, without which Dropbox returns no refresh token', async () => {
    // The parameter is on the authorisation URL, not the token request, and
    // omitting it makes the entire refresh path dead in production while every
    // other test still passes.
    const provider = build()
    const { url } = await provider.beginAuth('state-123')

    expect(new URL(url).searchParams.get('token_access_type')).toBe('offline')
  })

  it('uses the S256 challenge rather than the plain method', async () => {
    const provider = build()
    const { url } = await provider.beginAuth('state-123')
    const params = new URL(url).searchParams

    expect(params.get('code_challenge_method')).toBe('S256')
    expect(params.get('code_challenge')).toEqual(expect.any(String))
    expect(params.get('code_challenge')).not.toBe(params.get('state'))
  })

  it('sends no scope parameter, so the app console stays the source of truth', async () => {
    // Sending an explicit subset means the console and the code disagreeing by
    // one scope fails the whole authorisation with `scope_not_granted`.
    const provider = build()
    const { url } = await provider.beginAuth('state-123')

    expect(new URL(url).searchParams.has('scope')).toBe(false)
  })

  it('sends the redirect URI exactly as configured', async () => {
    const provider = build()
    const { url } = await provider.beginAuth('state-123')

    expect(new URL(url).searchParams.get('redirect_uri')).toBe('https://example.test/app/')
  })

  it('parks the verifier in sessionStorage so the redirect can complete', async () => {
    const provider = build()
    await provider.beginAuth('state-123')

    const pending = JSON.parse(window.sessionStorage.getItem('checklist:dropbox-pending'))
    expect(pending.state).toBe('state-123')
    expect(typeof pending.verifier).toBe('string')
  })
})

describe('completeAuth', () => {
  const tokenResponse = {
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    expires_in: 14400,
    account_id: 'dbid:1'
  }

  async function beginFirst (provider) {
    await provider.beginAuth('state-123')
    return provider
  }

  it('stores the credential, keeping the refresh token rather than discarding it', async () => {
    const fetchImpl = vi.fn(async () => response(tokenResponse))
    const storage = memoryStore()
    const provider = await beginFirst(build({ fetchImpl, storage }))

    await provider.completeAuth('code-abc', 'state-123')

    expect(storage.write).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: expect.any(Number)
      })
    )
  })

  it('posts the code, verifier and client id as a form body', async () => {
    const fetchImpl = vi.fn(async () => response(tokenResponse))
    const provider = await beginFirst(build({ fetchImpl }))

    await provider.completeAuth('code-abc', 'state-123')

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(DROPBOX.tokenUrl)
    const body = new URLSearchParams(init.body)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('code-abc')
    expect(body.get('code_verifier')).toBeTruthy()
    expect(body.get('client_id')).toBe('testclientid')
  })

  it('refuses a callback whose state does not match', async () => {
    // Without this check a third party could feed the app an authorisation code
    // of their choosing and it would silently adopt that Dropbox account.
    const fetchImpl = vi.fn(async () => response(tokenResponse))
    const provider = await beginFirst(build({ fetchImpl }))

    await expect(provider.completeAuth('code-abc', 'someone-elses-state')).rejects.toThrow(SyncError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a callback whose pending authorisation has expired', async () => {
    const fetchImpl = vi.fn(async () => response(tokenResponse))
    let clock = Date.now()
    const provider = await beginFirst(build({ fetchImpl, now: () => clock }))

    clock += 11 * 60 * 1000

    await expect(provider.completeAuth('code-abc', 'state-123')).rejects.toThrow(/expired/)
  })

  it('explains a token response that carries no access token', async () => {
    const fetchImpl = vi.fn(async () => response({ refresh_token: 'only-this' }))
    const provider = await beginFirst(build({ fetchImpl }))

    await expect(provider.completeAuth('code-abc', 'state-123')).rejects.toThrow(/no access token/)
  })
})

describe('pull', () => {
  it('POSTs the path in the Dropbox-API-Arg header, not the URL', async () => {
    // `download` is style="download" with a DownloadArg struct, so the path does
    // not belong in the URL. Getting this wrong returns a validation error that
    // names nothing useful.
    const fetchImpl = vi.fn(async () =>
      response('{}', { headers: { 'dropbox-api-result': JSON.stringify({ rev: 'r1' }) } })
    )
    const provider = build({ fetchImpl, storage: memoryStore(validTokens) })

    await provider.pull('checklist.json')

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(DROPBOX.downloadUrl)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.headers['Dropbox-API-Arg'])).toEqual({ path: '/checklist.json' })
    expect(url).not.toContain('checklist.json')
  })

  it('returns the file and its revision', async () => {
    const fetchImpl = vi.fn(async () =>
      response('{"format":"checklist-backup"}', { headers: { 'dropbox-api-result': JSON.stringify({ rev: 'r1' }) } })
    )
    const provider = build({ fetchImpl, storage: memoryStore(validTokens) })

    const file = await provider.pull('checklist.json')

    expect(file.rev).toBe('r1')
    expect(file.body).toContain('checklist-backup')
  })

  it('reports a missing file as null, which is a first run and not a failure', async () => {
    const fetchImpl = vi.fn(async () =>
      response({ error_summary: 'path/not_found/...' }, { status: 409 })
    )
    const provider = build({ fetchImpl, storage: memoryStore(validTokens) })

    expect(await provider.pull('checklist.json')).toBe(null)
  })

  it('classifies a missing scope by the name Dropbox gives it', async () => {
    // Dropbox answers `missing_scope` with a 403 — the same status as an expired
    // token. If that triggered a refresh, the user would be told to reconnect
    // when the thing to change was a tick in the app console.
    const fetchImpl = vi.fn(async () => response({ error_summary: 'missing_scope/...' }, { status: 403 }))
    const provider = build({ fetchImpl, storage: memoryStore(validTokens) })

    await expect(provider.pull('checklist.json')).rejects.toMatchObject({ kind: 'scope-missing' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('push', () => {
  it('sends a conditional write when a revision is known', async () => {
    const fetchImpl = vi.fn(async () => response({ rev: 'r2' }))
    const provider = build({ fetchImpl, storage: memoryStore(validTokens) })

    const result = await provider.push('checklist.json', '{}', 'r1')

    const arg = JSON.parse(fetchImpl.mock.calls[0][1].headers['Dropbox-API-Arg'])
    // The `.tag` discriminator is mandatory for a member that carries a value;
    // without it Dropbox answers `arg: mode: type: missing tag`.
    expect(arg.mode).toEqual({ '.tag': 'update', update: 'r1' })
    expect(arg.strict_conflict).toBe(true)
    expect(result.rev).toBe('r2')
  })

  it('overwrites when there is no revision yet', async () => {
    const fetchImpl = vi.fn(async () => response({ rev: 'r1' }))
    const provider = build({ fetchImpl, storage: memoryStore(validTokens) })

    await provider.push('checklist.json', '{}', null)

    expect(JSON.parse(fetchImpl.mock.calls[0][1].headers['Dropbox-API-Arg']).mode).toBe('overwrite')
  })

  it('classifies a rev mismatch as a conflict so the engine re-reads', async () => {
    const fetchImpl = vi.fn(async () =>
      response({ error_summary: 'path/conflict/file/...' }, { status: 409 })
    )
    const provider = build({ fetchImpl, storage: memoryStore(validTokens) })

    await expect(provider.push('checklist.json', '{}', 'r1')).rejects.toMatchObject({ kind: 'conflict' })
  })

  it('normalises the path to exactly one leading slash', async () => {
    // The leading slash is part of Dropbox's path pattern, not a convention.
    const fetchImpl = vi.fn(async () => response({ rev: 'r1' }))
    const provider = build({ fetchImpl, storage: memoryStore(validTokens) })

    await provider.push('///checklist.json', '{}', null)

    expect(JSON.parse(fetchImpl.mock.calls[0][1].headers['Dropbox-API-Arg']).path).toBe('/checklist.json')
  })
})

describe('token refresh', () => {
  it('refreshes once on a 401 and retries with the new token', async () => {
    const tokenResponse = { access_token: 'access-2', expires_in: 14400 }
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response('', { status: 401 }))
      .mockResolvedValueOnce(response(tokenResponse))
      .mockResolvedValueOnce(response('{}', { headers: { 'dropbox-api-result': JSON.stringify({ rev: 'r1' }) } }))
    const provider = build({ fetchImpl, storage: memoryStore(validTokens) })

    const file = await provider.pull('checklist.json')

    expect(file.body).toBe('{}')
    expect(fetchImpl.mock.calls[1][1].body.toString()).toContain('grant_type=refresh_token')
  })

  it('does not refresh on a non-auth failure, which would fix nothing', async () => {
    const fetchImpl = vi.fn(async () => response({ error_summary: 'too_many_requests/' }, { status: 429 }))
    const provider = build({ fetchImpl, storage: memoryStore(validTokens) })

    await expect(provider.pull('checklist.json')).rejects.toMatchObject({ kind: 'rate-limited' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retries only once, so a credential Dropbox keeps refusing cannot loop', async () => {
    // The refresh itself succeeds, but the new token is refused too. That is the
    // case an unbounded retry turns into a loop that looks like syncing.
    const fetchImpl = vi.fn(async (url) =>
      url === DROPBOX.tokenUrl
        ? response({ access_token: 'access-2', expires_in: 14400 })
        : response('', { status: 401 })
    )
    const provider = build({ fetchImpl, storage: memoryStore(validTokens) })

    await expect(provider.pull('checklist.json')).rejects.toThrow(SyncError)
    // Download, token exchange, one retried download — and no fourth call.
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('treats a refused refresh token as a dead credential', async () => {
    // The download 401s; the token endpoint refuses the refresh.
    const fetchImpl = vi.fn(async (url) =>
      url === DROPBOX.tokenUrl
        ? response({ error: 'invalid_grant' }, { status: 400 })
        : response('', { status: 401 })
    )
    const provider = build({ fetchImpl, storage: memoryStore(validTokens) })

    // `auth` is what makes the scheduler discard the token and offer Connect.
    await expect(provider.pull('checklist.json')).rejects.toMatchObject({ kind: 'auth' })
  })

  it('treats a Dropbox outage as a network problem, not a dead credential', async () => {
    // Conflating these is what made a transient 502 sign users out. Reporting
    // `auth` here would discard a perfectly good credential.
    const fetchImpl = vi.fn(async (url) =>
      url === DROPBOX.tokenUrl ? response('', { status: 503 }) : response('', { status: 401 })
    )
    const provider = build({ fetchImpl, storage: memoryStore(validTokens) })

    await expect(provider.pull('checklist.json')).rejects.toMatchObject({ kind: 'network' })
  })

  it('shares one exchange between two concurrent failures', async () => {
    // Two exchanges racing would each mint a token and then overwrite each
    // other's credential write.
    const fetchImpl = vi.fn(async (url) => {
      if (url === DROPBOX.tokenUrl) return response({ access_token: 'access-2', expires_in: 14400 })
      return response('', { status: 401 })
    })
    const provider = build({ fetchImpl, storage: memoryStore(validTokens) })

    await Promise.allSettled([provider.pull('a.json'), provider.pull('b.json')])

    const tokenCalls = fetchImpl.mock.calls.filter(([url]) => url === DROPBOX.tokenUrl)
    expect(tokenCalls).toHaveLength(1)
  })

  it('stops attempting once a refresh has been rejected this session', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url === DROPBOX.tokenUrl) return response({ error: 'invalid_grant' }, { status: 400 })
      return response('', { status: 401 })
    })
    const provider = build({ fetchImpl, storage: memoryStore(validTokens) })

    await provider.pull('a.json').catch(() => {})
    await provider.pull('b.json').catch(() => {})

    const tokenCalls = fetchImpl.mock.calls.filter(([url]) => url === DROPBOX.tokenUrl)
    expect(tokenCalls).toHaveLength(1)
  })
})

describe('hasUsableToken', () => {
  it('counts an expired token with a refresh token as usable', async () => {
    const storage = memoryStore({ ...validTokens, expiresAt: Date.now() - 1000 })

    expect(await build({ storage }).hasUsableToken()).toBe(true)
  })

  it('does not count an expired token with nothing to refresh as usable', async () => {
    const storage = memoryStore({ accessToken: 'a', expiresAt: Date.now() - 1000 })

    expect(await build({ storage }).hasUsableToken()).toBe(false)
  })

  it('rejects a malformed stored record rather than half-using it', async () => {
    expect(await build({ storage: memoryStore({ accessToken: 42 }) }).hasUsableToken()).toBe(false)
    expect(await build({ storage: memoryStore('nonsense') }).hasUsableToken()).toBe(false)
  })
})

describe('signOut', () => {
  it('clears the credential and leaves local data alone', async () => {
    const storage = memoryStore(validTokens)
    const provider = build({ storage })

    await provider.signOut()

    expect(storage.clear).toHaveBeenCalled()
    // The store this module owns holds credentials only. The checklist itself
    // lives in localStorage and is not reachable from here at all.
  })
})
