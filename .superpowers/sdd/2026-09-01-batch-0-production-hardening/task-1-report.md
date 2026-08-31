# Batch 0 Task 1 Report

## Result

Removed the production route placeholder infrastructure and locked the design authority. Authorized staff visiting `/admin/evidence` now receive a replace redirect to `/admin`; the admin navigation no longer exposes evidence management. Unmapped catalog entries fall back to the branded `NotFoundPage`.

## TDD evidence

### RED

Command:

```text
npm test -- src/app/router.test.tsx
```

Key output:

```text
Test Files  1 failed (1)
Tests       2 failed | 14 passed (16)
```

The new authorized A08 redirect test failed because `/admin/evidence` rendered `RoutePlaceholderPage`; the navigation test failed because the `证据管理` link was present.

### GREEN

After the production changes, the same focused command passed:

```text
Test Files  1 passed (1)
Tests       16 passed (16)
```

### Full verification

Per the task brief, the full suite was run once after the focused test passed:

```text
npm test
```

Key output:

```text
Test Files  69 passed (69)
Tests       398 passed (398)
```

The focused command also rebuilt `@vibecheck/contracts` successfully. `git diff --check` reported no whitespace errors.

## Changed files

- `DESIGN.md` — states that untracked `outputs/` previews are non-authoritative.
- `src/app/routeCatalog.ts` — removes `RouteCatalogItem.pendingModules` and all catalog values using it.
- `src/app/router.tsx` — removes placeholder import/rendering, maps A08 to `<Navigate to="/admin" replace />`, and maps future unmapped entries to `NotFoundPage`.
- `src/app/router.test.tsx` — adds the authorized A08 redirect and hidden-navigation regression tests.
- `src/components/AdminLayout.tsx` — removes the evidence-management navigation link.
- `src/pages/index.ts` — removes the placeholder page export.
- `src/pages/RoutePlaceholderPage.tsx` — deleted.
- `src/styles/global.css` — removes placeholder-only layout rules.
- `docs/superpowers/plans/2026-09-01-batch-0-production-hardening.md` — included unchanged as the batch execution record.

## Self-review

- Staff authentication remains outside the child route, so guests still pass through the existing `StaffRoute` gate before any A08 redirect can render.
- The redirect uses `replace`, preventing the hidden A08 URL from remaining in browser history.
- The fallback is branded `NotFoundPage` in both frontstage and admin catalog mappings; no route placeholder component or `pendingModules` reference remains in production `src` files.
- No files under the user-owned untracked `outputs/` directory were edited.
