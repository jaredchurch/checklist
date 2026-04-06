# Checklist PWA

## Dev Commands
- `npm run dev` - Start dev server (Vite on port 5173)
- `npm run build` - Build for production (outputs to `dist/`)
- `npm run test` - Run vitest tests
- `npm run lint` - ESLint (`.js` and `.html` files)

## Architecture
- Single-page Vite app; entry point: `src/main.js`
- State logic in `src/app.js`, UI in `index.html`
- Tests: `src/__tests__/**/*.test.js` (jsdom environment)
- Persistence: `idb-keyval` (IndexedDB wrapper) + service worker (`sw.js`)
- PWA manifest: `manifest.webmanifest`

## Key Conventions
- ESLint uses Standard config with `eslint-config-standard`
- Vitest globals enabled, no `--browser` flag needed for tests
- No monorepo; no workspace config
