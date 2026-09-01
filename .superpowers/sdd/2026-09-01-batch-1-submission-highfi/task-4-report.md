# Task 4: Preview and review-state migration

## Result

Submission preview and every review outcome now render in the shared six-stage task workspace. The review surface uses the existing `TaskShell`, `StepRail`, `LivePreview`, and `StatusBeacon` components, with all legacy `.wire-panel` containers removed from this page.

## RED → GREEN

- RED: added three page-level tests for the six-stage preview mapping, high-fidelity shell with no legacy panels, and representative preview/pending/changes-requested structure. `npx vitest run src/pages/SubmissionReviewPage.test.tsx` failed as expected: 3 new failures because the review scope and shared components did not exist; 10 existing tests passed.
- GREEN: migrated all local/remote preview and review-state render paths into `ReviewWorkspace`, mapped stages 1–5 to complete and stage 6 to current, and added scoped production review-section styling. The same test file then passed 13/13.

## Preserved contracts and states

- Local and remote preview flows, valid-preview gate, remote preview retry/recovery, version-conflict refresh, and stable remote submission key behavior remain unchanged.
- Submission confirmation and withdrawal confirmation dialogs keep their prior actions and focus behavior through the existing `ConfirmDialog`.
- Pending, changes requested, rejected, approved, and withdrawn rendering remains available, including supplemental material, refresh, retry, withdrawal, submitted-version history, and approval links.
- Remote receipt identifiers remain stored in state and used by service flows, but opaque UUIDs are no longer rendered to users. Server version behavior is retained in the remote preview summary.
- No local publication side effects were added to remote submission handling.

## Files

- `src/pages/SubmissionReviewPage.tsx`
- `src/pages/SubmissionReviewPage.test.tsx`
- `src/styles/highfi-task.css`

## Verification

- `npx vitest run src/pages/SubmissionReviewPage.test.tsx` — 13 passed.
- `npx tsc -b --pretty false` — passed.
- `npx eslint src/pages/SubmissionReviewPage.tsx src/pages/SubmissionReviewPage.test.tsx` — passed.
- `npm run build:web` — passed. Vite emitted the existing chunk-size advisory only.
- `git diff --check` — passed.

## Self-review

- The task rail is read-only on review states, preventing navigation back into completed stages while clearly preserving stage context.
- StatusBeacon is presentation-only and derives its display from existing draft state; LivePreview only presents current user-facing work content.
- CSS is scoped to `.highfi-scope.submission-review-scope`, avoiding legacy-page impact.

## Concerns

- No functional blockers. The production build continues to warn that its main JavaScript chunk exceeds Vite's advisory threshold; this change did not introduce a separate build failure.

## Fix Round 1

### Scope

- Restored the server-authoritative boundary for remote receipts: remote pending review no longer renders local supplemental-material persistence, mock refresh, or local withdrawal controls. No new remote API was introduced.
- Made `withdrawn` explicit in the status beacon mapping. `restricted` and any future unhandled status now render the neutral `审核状态待确认` fallback instead of a false withdrawn state.

### RED

- Added a remote-receipt regression that completes the real remote preview/submit path, then asserts that local-only controls are absent, `submissionService.submit` has not been called, and no local publication IDs were created.
- Added a restricted-status regression that asserts the neutral fallback and verifies `审核已撤回` is absent.
- Command: `npx vitest run src/pages/SubmissionReviewPage.test.tsx`
- Output: 15 tests, 2 expected failures. The remote receipt still rendered `保存补充材料`; the restricted status still rendered the `审核已撤回` beacon.

### GREEN / verification

- Command: `npx vitest run src/pages/SubmissionReviewPage.test.tsx`
- Output: 15 passed.
- Also run: `npx eslint src/pages/SubmissionReviewPage.tsx src/pages/SubmissionReviewPage.test.tsx`, `npx tsc -b --pretty false`, and `git diff --check`; all passed.
