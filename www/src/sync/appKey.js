/**
 * Where the Dropbox app key comes from.
 *
 * The key is an OAuth *client id*, not a secret. Under PKCE there is no client
 * secret and the key ships in the JavaScript bundle either way, so baking it in
 * costs nothing that hiding it would achieve. What baking it in does buy is that
 * a user never has to know a client id exists: the deployed app works with no
 * configuration, and there is nothing in the UI to misconfigure.
 *
 * A client secret must never appear in this file, or in any `VITE_` variable.
 * Anything prefixed `VITE_` is inlined into the shipped JavaScript and is
 * readable by anyone loading the page.
 */

/**
 * Hosts serving the deployed, production app.
 *
 * Selection is by *where the app is running*, not by whether this is a production
 * build: `npm run build` served locally by `vite preview` is a production build
 * and must still not touch production data. That is why this is a host list
 * rather than a build flag.
 *
 * Keep it in step with the repository's Pages deployment.
 */
export const PRODUCTION_HOSTS = ['jaredchurch.github.io']

/**
 * Built-in client ids, one per registered Dropbox app.
 *
 * Two separate apps is the point, not a side effect. They have separate app
 * folders, and therefore separate `checklist.json` files — so local development
 * cannot overwrite production data. Running both against one app would mean a
 * stray local run publishing over the deployed site's checklists, with no way to
 * tell afterwards which copy was which.
 */
export const BUILT_IN_KEYS = {
  production: 'l131kro8izrkyfq',
  development: '4ivz46qn0205dpp'
}

/** Pure, so the host-to-environment mapping can be tested directly. */
export function environmentForHost (hostname) {
  return PRODUCTION_HOSTS.includes(hostname) ? 'production' : 'development'
}

/** Pure. Returns the built-in client id for a host. */
export function selectBuiltInKey (hostname) {
  return BUILT_IN_KEYS[environmentForHost(hostname)]
}

/**
 * Resolve the client id for this deployment.
 *
 * Synchronous by design: the OAuth redirect handler runs before the app renders
 * and needs the key to redeem the authorisation code.
 */
export function readAppKey () {
  return selectBuiltInKey(window.location.hostname)
}
