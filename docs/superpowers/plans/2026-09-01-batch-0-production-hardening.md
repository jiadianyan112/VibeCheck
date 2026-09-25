# Batch 0 Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Follow test-driven development for every behavior change.

**Goal:** Remove production-facing prototype artifacts, stop the comparison bar from obscuring content, replace high-risk internal copy, and enforce the result in CI without changing business APIs or persisted data.

**Architecture:** Keep the current React Router, state, service, and CSS architecture. Remove unreachable placeholder infrastructure, reuse the existing Drawer and confirmation primitives for comparison selection, and add a build-artifact copy checker next to the existing frontend budget gate.

**Tech Stack:** React 19, React Router 7, TypeScript 5.8, Vite 7, CSS, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-29-starboy-inspired-frontend-design.md`

## Global Constraints

- Do not change backend APIs, request ordering, submission idempotency keys, comparison persistence, or stored data shapes.
- Keep the existing React, Router, state, service, and CSS stack; add no dependency.
- Treat `DESIGN.md` and its linked spec as the only visual authority; do not edit user-owned untracked files under `outputs/`.
- Keep `.compare-bar`, `当前比较栏`, `查看作品`, `清空`, and `开始比较` as accessible/test contracts.
- The fixed comparison summary is at most 64 CSS pixels tall at 390, 768, and 1440 widths.
- `/admin/evidence` is hidden from navigation and replace-redirects authorized staff to `/admin`; guests still pass through the existing staff authentication gate.
- Production build artifacts must contain none of the exact forbidden phrases defined in Task 4.

---

### Task 1: Remove Placeholder Routes and Lock the Design Authority

**Files:** `DESIGN.md`, `src/app/routeCatalog.ts`, `src/app/router.tsx`, `src/app/router.test.tsx`, `src/components/AdminLayout.tsx`, `src/pages/index.ts`, `src/pages/RoutePlaceholderPage.tsx`, `src/styles/global.css`

**Behavior:** Remove `RouteCatalogItem.pendingModules`, the placeholder page/export/styles, and the A08 navigation link. Map A08 to `<Navigate to="/admin" replace />`; map any future unmapped catalog item to the branded `NotFoundPage`. Update the design contract to state that untracked `outputs/` previews are non-authoritative.

**TDD:** First add router tests proving an authorized A08 visit lands on the admin dashboard and the admin navigation has no evidence-management link. Run the focused test and verify it fails before production edits. Then implement and rerun it green.

---

### Task 2: Replace the Obstructive Comparison Tray with a Compact Summary and Drawer

**Files:** `src/features/comparison/ComparisonBar.tsx`, `src/features/comparison/ComparisonBar.test.tsx`, `src/components/FrontstageLayout.tsx`, `src/components/FrontstageLayout.test.tsx`, `src/styles/global.css`, `e2e/responsive.spec.ts`

**Behavior:** Keep a fixed summary bar with count, `查看作品`, and start action. Move chips, per-item removal, and clear into the existing accessible Drawer; retain the clear confirmation. Hide at zero, disable start at one, and enable at two through five. Add `app-shell--has-compare-bar` only when the bar renders outside focused flows and reserve 5rem after the shell so final content and footer can scroll above it.

**TDD:** First add component tests for drawer open/close, item removal, clear cancel/confirm, and shell reserve-class behavior. Verify red, implement, then run green. Add Playwright geometry checks for maximum 64px summary height, in-viewport drawer, no page overflow, and a final-page action scrolling above the bar.

---

### Task 3: Remove High-Risk Internal Copy from User Flows

**Files:** `index.html`, submission/auth/media/project-detail pages and their existing tests.

**Behavior:** Replace the file-protocol prototype instructions with a product-neutral access message. Use `默认封面`, `暂无公开图片`, and `暂无作品截图` for missing media. In submission preview/status, remove rendered preview hash, check ID, media/evidence IDs, and raw frozen JSON while preserving those values for API calls; show only submission and review identifiers as `提交编号` and `审核编号`. Replace Session/remote/server-version wording with account/synced/latest-draft wording. Rename the non-functional status-report disclosure to `状态说明`.

**TDD:** Change the existing media, project detail, auth, submit form, submission review, and golden-path tests first. Verify the new expectations fail; implement the minimum copy/rendering changes; rerun the focused group green while preserving API payload assertions.

---

### Task 4: Add a Production Copy Gate

**Files:** `scripts/check-production-copy.mjs`, `scripts/check-production-copy.test.ts`, `package.json`, `.github/workflows/quality.yml`, `scripts/quality-workflow.test.ts`

**Interface:** Add `npm run frontend:copy-check`. The script scans built `dist/index.html` and JavaScript assets, prints `PRODUCTION_COPY_FORBIDDEN term=<term> file=<path>` for each violation, and exits non-zero if any exist.

**Forbidden phrases:** `VIBECHECK PROTOTYPE`, `打开VibeCheck原型`, `开发命令`, `原型场景`, `低保真组件沙盒`, `待实现模块`, `路由骨架`, `路由上下文`, `视觉占位`, `媒体占位`, `作品截图占位`, `预览哈希`, `检查 ID`, `服务端冻结快照`.

**TDD:** First add fixture-based tests that invoke the real checker against a temporary clean build and a violating build, verifying exit code/output behavior. Verify red because the checker does not exist. Implement the checker and package command. Add it to quality CI after production build and before `frontend:budget`, with a workflow behavior test.

---

### Task 5: Integrated Verification

Run focused Vitest after every task. At the end run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run frontend:copy-check`, `npm run frontend:budget`, and relevant Playwright responsive/scenario suites. Inspect 390px and 1440px screenshots for summary-bar obstruction and drawer layout. Request a whole-diff code review; address all Critical and Important findings before completion.
