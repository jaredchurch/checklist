- [] REQ1: optimise for phone screen - large touch targets.
- [x] REQ2: source to be kept in subfolder <project-root>/src
- [x] REQ3: single web-page that can work as progressive web app.
- [x] REQ4: infinite tree of checklist items (nested sub-lists)
- [x] REQ5: toggle done/not-done per item
- [x] REQ6: mark all in current level and descendants
- [x] REQ7: reset completed and not-completed across tree
- [x] REQ8: sort items manually or by last completed date
- [x] REQ9: show/hide manual sort controls (up/down arrows)
- [x] REQ10: local storage persistence (localStorage)
- [x] REQ11: JSON export/import backup and restore
- [x] REQ12: optional Firebase sync (when configured)
- [x] REQ13: PWA installable on desktop and iOS
- [x] REQ14: service worker caching + offline support
- [x] REQ15: vitest regression tests

## Implementation Notes

- Storage uses localStorage (not IndexedDB as AGENTS.md incorrectly states)
- Sort methodology:
  - Done sub-lists (all children done) treated same as done items
  - Done items sorted below not-done items
  - Lists sorted before items
  - Manual mode: not-done order preserved
  - Completed mode: items sorted by lastCompletedDate (earliest first), items without date treated as earliest