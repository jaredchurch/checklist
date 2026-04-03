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

## Run locally

1. `npm install`
2. `npm run dev` (maybe `npm run dev -- --host`)
3. open `http://localhost:5173`

## Build

`npm run build`

## Test

`npm run test`
