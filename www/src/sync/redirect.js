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

function basePath () {
  // Read through a declared shape: `import.meta.env` is untyped outside a
  // Vite-aware module and yields `any`.
  const env = import.meta.env
  // `BASE_URL` carries the trailing slash Vite assumes, so a redirect to the
  // bare directory name would not match what was registered.
  return env.BASE_URL || '/'
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
