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
- Optional Firebase sync (when configured)
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
src/
├── app.js         - Main application entry point
├── controls.js    - Event handlers and UI controls
├── dialogs.js     - Import/export and about dialogs
├── firebase.js    - Firebase configuration (optional)
├── auth.js        - Authentication UI and logic (optional)
├── sync.js        - Cloud sync logic (optional)
├── render.js      - DOM rendering and state management
├── sorting.js     - Sort logic by completion status/date
├── storage.js     - LocalStorage persistence
├── tree.js        - Tree data structure operations
├── utils.js       - Utility functions
└── main.js        - Client-side entry point
```
