/**
 * The OAuth redirect URI for this deployment.
 *
 * Lives in its own module because three call sites need it — the provider, the
 * redirect handler and the Sync panel — and two of those already import each
 * other. Defining it once avoids the possibility of the provider registering
 * one URI while the panel tells the user to register another, which Dropbox
 * reports only as `invalid_redirect_uri` with nothing to say about which half
 * was wrong.
 *
 * No imports, deliberately: this sits below everything else in `sync/`.
 */

/**
 * The path this deployment is served under, with a trailing slash.
 *
 * `import.meta.env.BASE_URL` is the authority when the app has been bundled —
 * Vite substitutes it at build time. The deployed copy of this app is served as
 * unbuilt ES modules, though, where `import.meta` exists but carries no `env`, so
 * reading `.BASE_URL` off it throws before a connection can even be attempted.
 *
 * The fallback derives the same answer from where the document actually is,
 * which is more truthful than a hardcoded path: it is correct on GitHub Pages
 * under `/checklist/`, at a subdomain root, and in local development, with no
 * value to keep in step. `[^/]*$` strips the last path segment, so
 * `/checklist/index.html` and `/checklist/` both yield `/checklist/`.
 */
function basePath () {
  const env = import.meta.env
  if (env && env.BASE_URL) return env.BASE_URL
  if (typeof window === 'undefined') return '/'
  return window.location.pathname.replace(/[^/]*$/, '') || '/'
}

/**
 * The URI this deployment sends to Dropbox, and the one it must have registered.
 */
export function currentRedirectUri () {
  return `${window.location.origin}${basePath()}`
}

/**
 * The app's own home. The same value, under a name that says what it is for.
 *
 * Delegates rather than recomputing: the two were byte-identical
 * implementations under two names and two rationales, so a change to how the
 * base path is derived would have had to be made twice with nothing asserting
 * the two had to agree.
 */
export function appHomeUrl () {
  return currentRedirectUri()
}
