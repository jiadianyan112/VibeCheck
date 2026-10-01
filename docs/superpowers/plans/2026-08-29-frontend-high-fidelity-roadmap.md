# VibeCheck Frontend High-Fidelity Roadmap

> **For agentic workers:** This roadmap defines sequencing and acceptance boundaries. Implement only the currently approved slice, using that slice's detailed plan and its required sub-skill.

**Goal:** Upgrade all frontstage and task pages to the approved Starboy-inspired VibeCheck visual system while preserving the existing business flows; keep admin pages tool-oriented.

**Architecture:** Keep the current React Router, state, service, and contract layers. Add a scoped visual system and focused presentation components, then migrate one independently testable route group at a time. Business components continue to own state and requests; new brand/editorial components remain presentational.

**Tech Stack:** React 19, React Router 7, TypeScript 5.8, Vite 7, CSS, SVG, IntersectionObserver, Vitest, Testing Library, Playwright, axe-core.

**Spec:** `docs/superpowers/specs/2026-08-29-starboy-inspired-frontend-design.md`

## Global Constraints

- Do not copy Starboy branding, hardware, character forms, typeface, or assets.
- Do not alter submission request ordering, versions, operation IDs, submission keys, conflict handling, or server contracts for visual work.
- Do not add GSAP, Framer Motion, WebGL, a runtime image generator, or a third-party font request.
- New visual runtime code across the program must stay within 15 KB gzip.
- Desktop images must be at most 350 KB each; mobile variants must be at most 180 KB each; initial hero media must stay within 900 KB total.
- Every route must remain usable with `prefers-reduced-motion: reduce`.
- Validate at 390, 768, and 1440 CSS pixels and preserve the existing 360-pixel submission check.
- Keep existing unknown, evidence, permission, conflict, error, and pending-review states visible.
- Each slice ends with Sol review, an isolated commit, an automatic push, and successful remote quality CI.

---

## Slice 1: Visual Foundation and P01

**Detailed plan:** `docs/superpowers/plans/2026-08-29-frontend-foundation-p01.md`

Deliver the scoped design tokens, Vibe Lens, media stage, reveal behavior, editorial structures, upgraded frontstage shell, upgraded project cards, and a complete responsive P01 Works Plaza. Establish executable bundle budgets and visual snapshots.

Acceptance: P01 passes unit, axe, responsive, screenshot, build-budget, and existing regression gates without changing project-service behavior.

## Slice 2: P10/P11 Submission Main Flow

Deliver `TaskShell`, `StepRail`, `LivePreview`, `StatusBeacon`, and `ErrorSummary`; migrate URL check, four editing steps, materials, preview, submit, and `pending_review` receipt.

Acceptance: the existing stateful golden-path tests still prove canonical PATCH, media/evidence binding, preview/submit, exact retry, conflict refresh, and pending-review receipt. Add screenshots for URL entry, one editing step, preview, and receipt at 390/768/1440.

## Slice 3: P02–P07 Discovery

Migrate categories, category detail, activity, search, idea analysis, and result analysis to Editorial Landing and Discovery Canvas templates. Add the accessible filter drawer, matching explanation treatment, and horizontal content strip.

Acceptance: search URLs, filters, matching reasons, category-specific facts, and empty/error states retain their existing semantics and tests. No route has unexpected horizontal overflow.

## Slice 4: P08/P09/P14 Story and Comparison

Migrate project detail and creator profile to Project Story; migrate comparison to Decision Workspace. Preserve evidence drawers, unknown facts, timelines, assets, relations, discussion, selection, and decision records.

Acceptance: desktop comparison stays parallel; 390/768 remain complete and keyboard accessible; existing comparison matrix and project-detail E2E tests pass.

## Slice 5: P12/P13/P15–P18 Accounts and Follow-up Tasks

Migrate author verification, project update, personal center, notifications, login, and about pages. Reuse the task components from Slice 2 and editorial components from Slice 1.

Acceptance: authentication return paths, saved intent, permissions, verification/update status, notification read state, and focus recovery retain existing behavior.

## Slice 6: Admin Alignment and Whole-Site Gates

Scope shared primitives for admin density, introduce route-level lazy loading for frontstage/task/admin chunks, and complete whole-site visual, accessibility, performance, and functional verification.

Acceptance: admin remains compact; initial entry JS is no larger than the pre-program 236,435-byte gzip baseline; all public routes pass the three target viewports and WCAG A/AA axe checks; full local and remote gates are green.

## Program Execution Rules

1. Execute slices in order. Do not start a later slice to hide an incomplete acceptance gate.
2. Create the detailed plan for the next slice only after the current slice's screenshots and CI are accepted.
3. Treat existing untracked files as user-owned. Stage only files named by the current slice.
4. Use test-driven development for component and behavior changes.
5. Keep commits at task boundaries inside a slice; push the completed slice automatically after Sol review.
