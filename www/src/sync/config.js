/**
 * Dropbox endpoints, scopes and argument shapes.
 *
 * Verified against Dropbox's OAuth guide and the machine-readable API spec
 * (`dropbox/dropbox-api-spec`, `files.stone`):
 *
 * - `upload` and `download` are both `host = "content"`, i.e.
 *   `content.dropboxapi.com`, and both set `allow_app_folder_app = true`, so
 *   App Folder access is valid.
 * - `download` requires `files.content.read`; `upload` requires
 *   `files.content.write`. Both are `auth = "user"`, so a bearer token is right.
 * - `download` is `style = "download"` with a `DownloadArg` struct, so its
 *   arguments travel in the `Dropbox-API-Arg` header, not the URL. It is a POST.
 * - `WriteMode` is a `union_closed`. Its Void members serialise as a bare string,
 *   while `update` — which carries a value — needs an object *and* the `.tag`
 *   discriminator. Omitting the tag fails with `arg: mode: type: missing tag`,
 *   which says nothing about which argument was wrong.
 *
 * Kept in one file so there is a single place to look when a Dropbox upgrade
 * changes a shape, and so the provider itself contains no endpoint knowledge.
 */

/**
 * Scopes the app actually uses. Least privilege, as Dropbox's guide advises.
 *
 * Two, and both are required. Neither `files.metadata.read` nor
 * `account_info.read` is needed: the file's revision comes back in the
 * `download` response header (covered by `files.content.read`), and the
 * conditional write is part of the upload argument (covered by
 * `files.content.write`).
 */
export const SCOPES = ['files.content.read', 'files.content.write']

export const DROPBOX = {
  authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
  tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
  uploadUrl: 'https://content.dropboxapi.com/2/files/upload',
  downloadUrl: 'https://content.dropboxapi.com/2/files/download',

  /**
   * Relative to the app folder. With App Folder access the file lives at
   * `/apps/<app name>/checklist.json`.
   */
  defaultRemotePath: 'checklist.json',

  scopes: SCOPES,

  /**
   * `update` with a rev makes the write conditional: Dropbox rejects it unless
   * the file's current rev matches. That rejection is how a concurrent edit
   * from another device is detected instead of silently overwritten.
   *
   * The `.tag` discriminator is mandatory — see the file header.
   */
  updateMode: (rev) => ({ '.tag': 'update', update: rev }),

  /**
   * `overwrite` is a Void member, so the bare-string shorthand is valid.
   * Spelled out rather than inlined so both modes sit together and the
   * asymmetry between them is visible.
   */
  overwriteMode: 'overwrite'
}

/**
 * Whether to pass `strict_conflict` on writes.
 *
 * From the spec: with `mode = update`, a rev mismatch is only *always* an error
 * when `strict_conflict` is set — without it, a mismatch against a file that
 * has since been deleted can pass unnoticed. For a sync file, "the file changed
 * under me" must never be silent, so this is on.
 */
export const STRICT_CONFLICT = true
