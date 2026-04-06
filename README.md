# Checklist PWA

A Progressive Web App checklist application with infinite sub-list tree structure and done/not-done controls.

## Features

- Infinite tree of checklist items
- Toggle done/not-done per item
- Mark all in current level and descendants
- Reset completed and not-completed across tree
- Local storage persistence
- JSON export/import backup and restore
- PWA installable on desktop and iOS
- Service Worker caching + offline support
- Vitest regression tests

### Sort Methodology
- sub-list items where all child items are marked as done should be treated the same as a checklist item that is marked as done.
1. sort so the done items are lower in the list than items that are not done.
2. sort so that sub-lists come before items.
3. in manual sort mode the order for items that are marked as not done should remain the same.
4. in sort by last complte date, the order for items that are marked as not done should be such that the least recently completed item is at the top of the list down to the most recently completed items. Items with no last complte date should be treated as having been last complete earlier in time than any item that has a last completed date.

## Run locally

1. `npm install`
2. `npm run dev` (maybe `npm run dev -- --host`)
3. open `http://localhost:5173`

## Build

`npm run build`

## Test

`npm run test`
