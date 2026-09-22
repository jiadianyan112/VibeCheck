# Single-page publishing implementation plan

**Goal:** Implement the user-approved single-page publishing design, with four required facts and non-blocking asynchronous URL checks.

**Architecture:** Keep the existing authenticated submission, revision, preview and review transaction chain. Accept minimal factual snapshots, normalize missing optional data to empty/unknown, and retain all ownership, URL safety and bound-resource checks. Replace the entry wizard with one editor shared by `/submit` and `/submit/new`.

**Stack:** React, TypeScript, existing submission/media clients, PostgreSQL and existing catalog schemas.

**Approved design:** User approved the preceding design on 2026-09-14: name, URL, introduction and category required; media optional; optional detail groups; persistent drafts; async checks; explicit review outcome. Warm canvas, black text, lime primary action, compact headings.

## Work

- [x] Backend: minimal snapshot normalization, unknown facts, optional cover/evidence, uncertain access reviewed as unknown. Preserve exact-duplicate and unsafe-URL rejection, ownership, optimistic versions, idempotency, media scans and immutable submission receipts.
- [x] Editor: render immediately, local/remote draft persistence, login return, optional images, failure recovery, single submit operation through real API.
- [x] Layout: desktop editor and gallery-card preview; mobile single column and persistent submit action; existing shared navigation.
- [x] Regression: minimal submission, warnings, unsafe links, network recovery, draft restoration, responsive and accessibility checks.
- [x] Validate build, lint, meaningful frontend/backend tests and inspect browser screenshots before delivery.

## Compatibility

Keep legacy editor source for existing unit coverage while routing user publishing to the composer. Preserve existing drafts and schema identities. Do not silently relabel unsupported categories. Broadening the taxonomy requires a genuine reviewable request representation, not a third label mapped onto another category.

## Acceptance

Writing is possible before check completion. Unknown network results cannot dead-end the author. No false saved/submitted state. Failed uploads preserve other content. Guest edits survive authentication. Media is optional, attached media must be safe. Public data never turns unknown access into verified availability. No deployment in this implementation request.

## Verification (2026-09-17, refreshed 2026-09-19)

Frontend: 460 tests passed across 77 files. Submission: 22 tests passed. Catalog: 32 tests passed. Contract client: 137 tests passed. Contract schema check passed (85 paths / 95 operations). Frontend and all foundation packages build successfully; lint, copy and bundle budget checks pass. Browser image/draft restoration, image ordering, modal focus, responsive overflow and WCAG checks pass at 390 and 1440 pixels.

Submission browser tests use mocked HTTP contracts; actual PostgreSQL and storage integration were not run because the local Docker service is unavailable. Changes are local and have not been deployed.

Final browser regression: 10/10 passed on 2026-09-19. Covers minimal submission at 390/1440, uncertain access, unconfirmed category, unsafe URL rejection, patch failure preserving input, guest login recovery, submission retry after refresh preserving the exact request, image crop/reorder/persistence and accessibility. The publish mock route now correctly intercepts nested preview requests.
