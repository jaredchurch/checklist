/**
 * Imported from a full CDN URL rather than the bare `idb-keyval` specifier.
 *
 * A bare specifier only resolves through a bundler. This app's deployed copy is
 * served as unbuilt ES modules, so a bare specifier throws
 * `Failed to resolve module specifier` in the browser — and because module
 * imports are static and hoisted, one bad specifier takes down the whole import
 * graph. That meant the entire app failed to start, not just sync.
 *
 * A full URL resolves in a browser *and* survives a Vite build untouched, so
 * this import is correct under both deployment shapes. The bundled copy keeps
 * paying a CDN round trip; that is the price of the deploy serving source, and
 * it disappears if the site is changed to publish `dist/`.
 */
import { get, set, del } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm'

/**
 * Token storage backed by IndexedDB.
 *
 * Tokens are secrets: never logged, never included in an export or a sync
 * payload, never rendered in full in the UI. They live in their own store
 * under their own key rather than inside the checklist data, so the snapshot
 * reader excludes them *structurally* rather than by remembering to filter
 * them out of a payload it is about to publish.
 *
 * IndexedDB rather than localStorage: localStorage is synchronous, is included
 * in nothing by default but is trivially readable by any script on the page,
 * and the app's own export feature writes plain JSON that users email to each
 * other. A credential must not be reachable from either.
 */

/**
 * A credential store with no opinion about what a credential looks like.
 *
 * Deliberately opaque. This type used to be spelled with Dropbox's own token
 * shape, which meant the storage layer's table was typed by a provider
 * implementation — and adding a second provider, the whole point of the
 * provider abstraction, would have meant editing this file.
 *
 * The trade is that `read()` hands back whatever is stored, valid or not. That
 * is the correct place to draw the line: only the provider knows what a token
 * for *it* looks like, and `dropbox.js` is where an untrusted record becomes
 * either a usable token or "not connected".
 */
const KEY = 'checklist:dropbox-tokens'

export const tokenStore = {
  /**
   * `null` when nothing is stored, otherwise whatever was written, unparsed.
   *
   * "No record" and "a record holding null" are deliberately the same answer —
   * only the provider knows whether a null credential means "not connected",
   * and for this one it does.
   */
  async read () {
    return (await get(KEY)) ?? null
  },

  async write (value) {
    await set(KEY, value)
  },

  async clear () {
    await del(KEY)
  }
}
