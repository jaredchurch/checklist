# Dropbox app registration

**Why this is manual:** creating the app requires signing into your Dropbox
account and accepting Dropbox's developer terms on your behalf. I cannot and
should not do that.

**When to do it:** once, before using Sync for the first time.

> **The client id is built into the app.** There is nothing to paste and nothing
> to configure in the browser. This file is the whole of the setup: it is done
> once per registered app, by whoever maintains the deployment — not once per
> user who opens the Sync panel.

> **You need two apps**, not one — see step 0.

---

## About these instructions

The App Console UI changes. The **fields and concepts** below are stable and the
instructions are written to survive a relayout, but exact labels and the numbering
of screens may differ from what you see.

If a step fails or the console shows something not described here, stop and say
what you see rather than guessing your way through it.

---

## 0. Two apps, not one

The build contains two client ids and picks one by hostname:

| Served from | Client id | Dropbox app |
| --- | --- | --- |
| `jaredchurch.github.io` | `l131kro8izrkyfq` | **production** |
| anything else (`localhost`, previews) | `4ivz46qn0205dpp` | **testing** |

**Register the whole of steps 1–5 twice**, once for each app. They are separate
Dropbox apps with separate App Folders, and therefore separate `checklist.json`
files. That is deliberate: running local development against the production app
would let a stray `npm run dev` publish over the deployed site's checklists, with
nothing afterwards to say which copy was which.

To confirm which one a given build uses, read `BUILT_IN_KEYS` in
`www/src/sync/appKey.js` — the app does not display it, because there is nothing
for a user to change.

---

## 1. Open the App Console

Go to **[console.dropbox.com/apps](https://console.dropbox.com/apps)** and sign in
with the Dropbox account you want the app to sync to.

One account is in scope. Do not invite any other Dropbox user as a collaborator:
the sync file is a single file per app folder, and two accounts writing it would
merge each other's checklists.

---

## 2. Create the app

Choose **Create apps**.

| Field | Value | Note |
| --- | --- | --- |
| **Access type** | **Scoped access** | Full Dropbox access is for legacy apps. Scoped access is what you want. |
| **App name** | anything recognisable | Shown to you on the consent screen. |
| **Access** | **App Folder** | This app writes exactly one file, and Dropbox's own guidance is to ask for the least access required. App Folder confines it to `/apps/<app name>/`. "Full Dropbox" grants reach over the whole account and is not needed. |

With App Folder access the sync file lives at
`/apps/<app name>/checklist.json`, and the path constant in
`www/src/sync/config.js` is just `checklist.json`.

---

## 3. Choose permissions

This is the step most worth getting right. Grant only what the app actually
calls.

### Tick exactly these two

| Scope | Required by | Why |
| --- | --- | --- |
| `files.content.read` | `download` | Fetching the sync file |
| `files.content.write` | `upload` | Writing it |

**Both are required, and the Permissions tab starts with nothing ticked for a new
app**, so this step cannot be skipped.

Earlier notes for this app suggested `files.metadata.read`, `files.metadata.write`
and `account_info.read` as well. They are **not** needed:

- The file's revision comes back in the response header of `download`, which
  already requires only `files.content.read`.
- The conditional write (`mode: {"update": "<rev>"}`) is part of the upload
  argument, so it is covered by `files.content.write`.
- The connected account is read from the stored token, not from the API.

**Scope changes only take effect on re-authorisation.** If you change the scopes
in the console, disconnect and reconnect the app in the Sync panel, or the change
will not take effect.

---

## 4. Add the redirect URI

The OAuth redirect URI must match **exactly** — scheme, host, path, trailing
slash, and port. A mismatch does not produce a useful error; it produces a failed
authorisation with a blank screen or a console error that names nothing about
which half was wrong.

The app sends `window.location.origin` + Vite's `BASE_URL`, so the value to
register is:

- **Deployed:** `https://jaredchurch.github.io/` — including the trailing slash.
  A Pages URL ends with one.
- **Local development:** `http://localhost:5173/` — note the scheme is `http` and
  there is a port.

If the console normalises or strips your trailing slash, note what it actually
stored; that exact form is what the OAuth config must use.

This is derived from the deployment, not stored anywhere. If you serve the app
from a different host or under a sub-path, recompute it as
`<origin><base path>` before registering.

---

## 5. Record the App key

At the top of the app's settings page you will find an **App key** — this is the
OAuth **client ID**. You will also see an **App secret**.

Record the **App key**. Do nothing else with it — it is already compiled into the
build, selected by hostname (step 0). If the key you see here does not match
`BUILT_IN_KEYS` in `www/src/sync/appKey.js`, this table is out of date: fix the
table in the code, not the app.

### The App secret is not needed and must not be used

The app is a public client using PKCE, so there is no secret to keep — and
nowhere safe to put one anyway, since this is a static site and every byte ships
to the browser.

The App key is **not** sensitive. It ships in the JavaScript bundle and that is
by design. It is also why it is fine to commit.

---

## 6. Where the key comes from

There is exactly one place: `BUILT_IN_KEYS` in `www/src/sync/appKey.js`. There is
no environment variable and no browser-stored key.

**Never put an App secret in `appKey.js` or any `VITE_` variable.** Anything
prefixed `VITE_` is embedded in the shipped JavaScript and is readable by anyone
loading the page.

---

## Checklist before first connect

- [ ] Access type is **Scoped access**
- [ ] Access is **App Folder**
- [ ] `files.content.read` and `files.content.write` ticked, and nothing else needed
- [ ] Redirect URI registered, matching what the Sync panel displays
- [ ] Done twice, once per app (step 0), each with its own App Folder
- [ ] App secret **not** recorded anywhere, not used

---

## What happens next

Authorisation is a user action at runtime:

- Authorization code flow with PKCE. No implicit flow.
- The redirect URI must match a registered value exactly.
- Tokens go in IndexedDB, never `localStorage`, and never into a sync payload or
  an exported backup.
- Declining or abandoning authorisation leaves a fully working local-only app.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `invalid_redirect_uri` | The URI in the console does not match what the app sends, character for character. Copy it from the Sync panel. |
| `invalid_client_id` | The key compiled into the build does not match a real Dropbox app. Check `BUILT_IN_KEYS` in `www/src/sync/appKey.js` against the App Console. |
| `scope_not_granted` at connect | Console and code disagree — normally because a scope was unticked. |
| "Dropbox rejected the app for a missing permission" on first sync | The app connected with no file scopes. Tick both, then disconnect and reconnect. Scope changes only apply on re-authorisation. |
| "Please reconnect" every few hours | The token is not being refreshed. Check the app is **Short-lived** under Settings → Access token expiration, and that the authorisation URL carries `token_access_type=offline` (it does; there is a test asserting it). |
| "Sync problem" with a network error | Dropbox was unreachable. The app backs off and retries three times, and keeps your data locally throughout. Nothing is lost. |

---

## Verified against Dropbox's own documentation

- PKCE is supported and explicitly recommended for single-page applications in
  pure JavaScript
- The authorization code flow is the recommended flow
- The redirect URI must match a registered value exactly
- Content access is a choice between App Folder and Full Dropbox
- `upload` and `download` are both on `content.dropboxapi.com` and both allow
  App Folder access
- `download` is a **POST** with the path in the `Dropbox-API-Arg` header, not a
  GET with the path in the URL
- `WriteMode` is a `union_closed`, so `"overwrite"` serialises as a bare string
  and the conditional write needs `{".tag": "update", "update": "<rev>"}` — the
  `.tag` is mandatory, and omitting it fails with `arg: mode: type: missing tag`
- `ReadPath` and `WritePath` match `(/(.|\r\n)*)|(ns:...)`, so the **leading slash
  is part of the pattern**, not a convention

The endpoint paths, scopes and argument shapes are collected in
`www/src/sync/config.js` with the verification noted, so there is one place to
look. Tests assert the exact request shapes, so a regression is caught.