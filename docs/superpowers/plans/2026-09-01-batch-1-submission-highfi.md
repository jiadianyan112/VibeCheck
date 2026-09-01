# Batch 1: P10/P11 Production Submission Workspace

**Base:** `d783e73`
**Branch:** `codex/batch-1-submission-ui`
**Stacked PR base:** `codex/wp-05-submission-return`

## Global constraints

- Redesign `/submit`, `/submit/new`, and submission preview/review states as one guided six-stage workspace: 检查地址、基础信息、定位与用途、核心内容、开发与资产、预览与提交。
- Preserve API ordering, DTOs, draft persistence, versions, operation IDs, submission keys, retries, conflicts, and every existing review state.
- Do not add dependencies, routes, backend changes, raster assets, or runtime image generation.
- Do not raise the existing JS gzip budget of 251,435 bytes or CSS gzip budget of 17,749 bytes.
- Keep the action labels `检查地址`, `继续补充作品信息`, `保存并继续`, `准备提交材料`, `确认并提交审核`, and `确认提交` stable.
- Main P10/P11 production states must not render `.wire-panel` or expose internal candidate project IDs.
- Support reduced motion and prevent horizontal overflow at 360, 390, 768, and 1440 pixels.
- Preserve user-owned untracked files outside this isolated worktree.

## Task 1: Shared task workspace components and styles

Use strict TDD to introduce `TaskShell`, `StepRail`, `LivePreview`, `StatusBeacon`, and `ErrorSummary`, export them through the component barrel, and add a scoped `highfi-task.css` imported after existing high-fidelity styles.

Required interfaces:

```ts
export type TaskStepState = 'complete' | 'current' | 'upcoming'
export type StatusTone = 'idle' | 'progress' | 'success' | 'warning' | 'error'

export interface TaskStepItem {
  id: string
  label: string
  state: TaskStepState
}

export interface TaskShellProps {
  eyebrow: string
  title: string
  description?: React.ReactNode
  rail: React.ReactNode
  aside?: React.ReactNode
  children: React.ReactNode
}

export interface ErrorSummaryItem {
  fieldId: string
  label: string
  message: string
}
```

`StepRail` uses `aria-current="step"` and does not make upcoming steps interactive. `ErrorSummary` scrolls and focuses the field identified by `fieldId`. `StatusBeacon` uses appropriate polite/assertive live regions. `LivePreview` is presentation-only and owns no draft state.

At 1100px and above, use a `12rem / minmax(0, 1fr) / 18rem` grid with sticky rail and aside. Below 1100px, use a single column, horizontal step rail, and place the aside after the main content. At 390px, primary actions may fill the width. All columns must permit shrinking with `min-width: 0`.

## Task 2: P10 address-check migration

Move every `SubmitEntryPage` state into the shared workspace: logged-out guidance, input, checking, cancellation, error, warning, blocked, passed, draft creation, and duplicate candidate. The current step is 检查地址 and the remaining steps are upcoming. The aside shows concise status and necessary warnings.

Keep URL-check and draft-create requests, client request IDs, cancellation, auth behavior, retries, category persistence, and navigation unchanged. Preserve duplicate view/claim/correction exits but remove the visible candidate project ID. Reduce repeated and development-oriented copy without hiding consequences. Add tests first for the new structure, removal of `.wire-panel`, internal-ID suppression, and retained behaviors.

## Task 3: P11 form migration

Move the existing four editing steps into stages 2–5 of the shared rail, with stage 1 complete and stage 6 upcoming. Preserve every field, both categories, local edit recovery, GET/PATCH behavior, cover flow, evidence preparation, material receipts, conflict recovery, and navigation.

Derive `LivePreview` directly from the current draft values without another store. Derive an `ErrorSummary` from existing validation errors and give every target input or choice group a stable focusable ID. Use `StatusBeacon` for material/conflict progress while retaining callbacks. Do not use a full-screen fixed action bar. Keep one primary instruction per panel and move secondary help into progressive disclosure where useful. Add failing tests before implementation.

## Task 4: Preview and review-state migration

Move submission preview and all review outcomes into the shared workspace. On preview, stages 1–5 are complete and stage 6 is current. Preserve local and remote preview behavior, confirmation, pending_review, changes_requested, rejected, approved, withdrawn, supplemental material, refresh, retry, and withdraw flows. Keep server version and stable submit-key behavior unchanged. Use `LivePreview` and `StatusBeacon`, remove legacy `.wire-panel` containers, and keep dialogs and focus handling accessible. Add tests first for structure and existing state behavior.

## Task 5: Responsive, visual, and accessibility coverage

Add Playwright coverage for address entry, one editing step, submission preview, and pending-review receipt at 390, 768, and 1440 pixels, producing 12 committed visual baselines. Cover 360/390/768/1440 overflow, keyboard traversal and error-summary focus, plus axe checks for P10, P11, preview, and receipt. Keep tests deterministic and use existing API fixtures/helpers.

Run lint, typecheck, the full unit suite, focused submission/golden-path tests, production build, production-copy check, budget check, and relevant Playwright suites. Fix all Critical and Important review findings before push. Push the stacked branch and open a PR against `codex/wp-05-submission-return`; do not merge it.
