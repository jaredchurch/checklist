# Checklist PWA

A Progressive Web App checklist application with infinite sub-list tree structure and done/not-done controls.

## Features

- Infinite tree of checklist items
- Toggle done/not-done per item
- Mark all in current level and descendants
- Reset completed and not-completed across tree
- Sort items manually or by last completed date
- Show/hide manual sort controls (up/down arrows)
- Local storage persistence
- JSON export/import backup and restore
- Optional Dropbox sync across your own devices (opt-in, no account needed)
- PWA installable on desktop and iOS
- Service Worker caching + offline support
- Vitest regression tests

### Sort Methodology

- Sub-list items where all child items are marked as done should be treated the same as a checklist item that is marked as done.
- Sort so the done items are lower in the list than items that are not done.
- Sort so that sub-lists come before items.
- In manual sort mode, the order for items that are marked as not done should remain the same.
- In sort by last complete date, the order for items that are marked as not done should be such that the least recently completed item is at the top of the list down to the most recently completed items. Items with no last completed date should be treated as having been last completed earlier in time than any item that has a last completed date.

## Run locally

1. `npm install`
2. `npm run dev` (or `npm run dev -- --host` for network access)
3. Open `http://localhost:5173`

## Build

`npm run build`

## Test

`npm run test`

## Lint

`npm run lint`

## Project Structure

```
www/src/
├── app.js         - Main application entry point
├── controls.js    - Event handlers and UI controls
├── dialogs.js     - Import/export and about dialogs
├── render.js      - DOM rendering and state management
├── sorting.js     - Sort logic by completion status/date
├── storage.js     - LocalStorage persistence, change stamping, the sync snapshot
├── syncPanel.js   - The Sync dialog and header status pill
├── tree.js        - Tree data structure operations
├── utils.js       - Utility functions
├── main.js        - Client-side entry point
└── sync/
    ├── appKey.js          - The built-in Dropbox client ids, selected by host
    ├── config.js          - Dropbox endpoints, scopes and argument shapes
    ├── dropbox.js         - The Dropbox provider: PKCE, refresh, upload/download
    ├── engine.js          - One sync cycle: pull, merge, publish
    ├── envelope.js        - The wire format, shared with export/import
    ├── fireAndForget.js   - Discard a promise without losing its failure
    ├── merge.js           - Cross-device merge (the highest-risk code here)
    ├── oauthCallback.js   - Handling the authorisation redirect
    ├── provider.js        - The provider abstraction and normalised errors
    ├── providerFactory.js - One shared, cached provider instance
    ├── redirect.js        - The OAuth redirect URI for this deployment
    ├── scheduler.js       - When a sync runs, and what the status says
    ├── snapshot.js        - Tree ⇄ flat mergeable table
    └── tokenStore.js      - Credentials, in IndexedDB only
```

## Sync

Sync is **opt-in and off by default**. Nothing leaves the browser until you
connect a Dropbox account of your own.

- A header indicator shows the connection state at a glance: **☁ Not synced**,
  **⟳ Syncing…**, **⟳ Pending…**, **☁ Saved**, or **⚡ Sync problem**. Click it to
  open the Sync panel.
- Open **☰ → Sync…** and press **Connect Dropbox**.
- Your checklists sync to a single file, `checklist.json`, inside a Dropbox
  **App Folder** — `/apps/<your app name>/checklist.json`. The app cannot reach
  the rest of your Dropbox.
- There is nothing to configure. The Dropbox client id is compiled in and chosen
  by hostname: the production app on `jaredchurch.github.io`, a separate testing
  app everywhere else. They have separate app folders, so local development
  cannot overwrite production data. See [`DROPBOX_SETUP.md`](./DROPBOX_SETUP.md).
- **Never put an App secret in `www/src/sync/appKey.js` or any `VITE_`
  variable** — anything so named is embedded in the shipped JavaScript.
- Sync is local-first and best-effort. IndexedDB aside, your checklists live in
  `localStorage` and the app is fully usable with Dropbox unreachable, not
  connected, or never set up. No part of the boot path waits on the network.
- Sync runs on app open, on a 5-second debounce after a change, when you return
  to the tab, and on `pagehide`. There is no background polling.
- **Disconnect does not delete anything.** It discards the credential; your
  checklists stay in the browser and in Dropbox.

See [`DROPBOX_SETUP.md`](./DROPBOX_SETUP.md) for app registration, the two
scopes involved, and troubleshooting.

### How merging works

Each node is stored as a flat record with an id, a `parentId`, an `updatedAt`
and a `deletedAt`. Every sync is a union by id, resolved by whole-record
last-write-wins — never field by field, which could synthesise a record that
existed on neither device.

Two consequences worth knowing:

- **Deletions propagate.** A delete writes a tombstone rather than removing the
  record, so another device deletes it too, and a device that was offline for a
  month does not bring it back.
- **Concurrent edits to the same item resolve to one side.** If both devices edit
  the same item while offline, the later `updatedAt` wins for that whole item.

Ties are broken by a canonical serialisation so two devices always choose the
same winner and converge. The merge is covered by tests asserting commutativity,
idempotence and convergence.
