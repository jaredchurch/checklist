# Checklist PWA

## Dev Commands
- `npm run dev` - Start dev server (Vite on port 5173)
- `npm run build` - Build for production (outputs to `dist/`)
- `npm run test` - Run vitest tests
- `npm run lint` - ESLint (`.js` files in `www/`)

## Architecture
- Single-page Vite app; entry point: `www/src/main.js`
- State logic in `www/src/app.js`, UI in `index.html`
- Tests: `src/__tests__/**/*.test.js` (jsdom environment)
- Persistence: `idb-keyval` (IndexedDB wrapper) + service worker (`sw.js`)
- PWA manifest: `manifest.webmanifest`

## Key Conventions
- ESLint uses Standard config with `eslint-config-standard`
- Vitest globals enabled, no `--browser` flag needed for tests
- No monorepo; no workspace config

## Code Standards
- **Segregation**: CSS, JavaScript, and HTML MUST be kept in separate files. Do not use internal `<style>` or `<script>` tags in HTML files.
- **Documentation**: Always include file headers and descriptive comments in the code to explain the "why" of the implementation logic.

## Validation
- **Post-Change Verification**: After making changes, offer to run `npm run lint` followed by `npm test` to ensure code quality. Do not run these automatically.
