# Cloudflare R2 media storage implementation plan

> Execute from the current `codex/wp-05-submission-return` checkout. Preserve unrelated untracked files and changes.

## Objective

Replace the media-specific AWS S3/GuardDuty workflow with an R2 S3-compatible workflow while preserving the public media API, database model, routes, supported formats, and validation limits. The worker becomes authoritative for raw-object byte size, SHA-256, MIME, decode, dimensions, orientation, re-encoding, and EXIF removal.

## Constraints and invariants

- Supported declared/decoded formats remain `image/jpeg`, `image/png`, `image/webp`, and `image/avif`.
- Raw upload limit remains 5 MiB; maximum dimensions remain 12000 × 12000; Sharp uses `limitInputPixels: 40_000_000`.
- SVG, GIF, and PDF remain rejected.
- Continue using `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`; do not add an R2-specific SDK.
- Presigned PUT signs/sends `Content-Type`, `If-None-Match: *`, and the existing SHA-256 checksum header. It must not send or sign SSE/tagging fields.
- No `GetObjectTagging`, GuardDuty result polling, `ServerSideEncryption`, `Tagging`, `x-amz-server-side-encryption`, or `x-amz-tagging` in active media code.
- Keep `GET /api/v1/media-resources/:id/content`, existing media projections, references, status values, and database columns.
- `scan_result='clean'` remains a compatibility value meaning strict server-side validation/decode/re-encode success under R2, never a malware verdict.
- No database migration.

## Execution order

### 1. Establish the red tests

Modify or add only media/config/API/worker tests first; do not change production implementation in this step.

1. In `packages/media/src/aws-s3-storage.test.ts`, convert the contract to R2 behavior and add failing assertions for:
   - S3 client options: region `auto` and the configured endpoint.
   - presigned PUT retaining content type, `IfNoneMatch='*'`, and SHA-256; no SSE/tagging command fields, signed headers, or returned upload headers.
   - `HeadObject` not requesting AWS-only checksum mode and accepting missing provider checksum metadata.
   - worker download/validation of actual byte size and computed SHA-256.
   - MIME mismatch, unsupported format, decode failure, dimension failure, and checksum failure producing stable media errors.
   - Sharp orientation rotation, re-encoding, EXIF removal, ready `PutObject`, and quarantine `DeleteObject` only after a successful ready write.
   - ready writes omitting SSE/tagging fields.
2. In `packages/media/src/scan-processor.test.ts`, replace provider-state polling tests with direct R2 sanitization tests. Add failing assertions that the processor passes the database byte size/checksum to storage, finalizes ready on success, maps permanent validation codes to stable rejection reasons, and records retryable storage failures for retry.
3. In `packages/media/src/service.test.ts`, update the upload-header contract to the R2 header set and add the missing-provider-checksum completion case: MIME/size preflight may queue scanning when provider checksum metadata is absent; a present mismatching checksum still rejects.
4. In `packages/config/src/index.test.ts`, add failing tests for enabled R2 configuration, disabled defaults, required endpoint, exact `auto` region, and unsupported provider rejection.
5. Add API/worker wiring tests (`apps/api/src/media-wiring.test.ts` and `apps/worker/src/media-wiring.test.ts`, or an equivalent pure wiring seam) proving both entrypoints use the shared R2 factory and contain no GuardDuty/tagging result path. Keep the existing route/event tests and add assertions that the media API route boundary is unchanged.
6. Update test fixtures in `packages/media/src/testing/verify-media-fixture.ts` only as needed for the new ports; do not weaken fixture assertions.

Run the affected test files/workspaces immediately and record the expected failures. The red run must fail because the current implementation still requires the AWS/GuardDuty behavior.

### 2. Implement the R2 storage adapter and shared factory

Update `packages/media/src/aws-s3-storage.ts` while retaining the file path to minimize churn.

1. Introduce `R2MediaConfig` with `endpoint`, `region: 'auto'`, `bucket`, and `objectPrefix`. Export `R2MediaStorage` and a shared `createMediaStorage` factory. Keep compatibility aliases for the old class/config names only where needed by existing consumers; production API/worker wiring must use the R2 name/factory.
2. Construct the default `S3Client` with only `region: 'auto'` and `endpoint`. Do not place access keys in config; rely on the SDK default credential chain (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`).
3. Keep upload command content type, `IfNoneMatch: '*'`, and base64 SHA-256 checksum. Remove all SSE/tagging command fields and headers from presigning options and returned headers. Keep the already-supported signed content/checksum behavior.
4. Make upload inspection use `HeadObject` for receipt/content type/length preflight without `ChecksumMode: 'ENABLED'`. Return a nullable provider checksum; the worker remains authoritative.
5. Keep short-lived ready-object presigned GET behavior and key validation.
6. Implement direct `sanitizeImage` as the complete R2 worker operation:
   - `GetObject` quarantine object and materialize its body safely.
   - compare actual bytes with expected byte size and the 5 MiB limit;
   - compute lowercase SHA-256 and compare with the declared database checksum;
   - decode with Sharp (`failOn: 'error'`, `limitInputPixels: 40_000_000`), map unsupported/invalid decode errors distinctly;
   - compare Sharp’s actual format MIME to the declared MIME and reject non-supported formats;
   - require valid dimensions and enforce 12000 × 12000;
   - call `.rotate()`, re-encode in the supported output format, and ensure the output has no EXIF;
   - put the ready object with content type and no SSE/tagging;
   - delete quarantine only after the ready put succeeds;
   - return the existing final storage key/MIME/dimensions/EXIF projection.
7. Use stable `MediaError` codes for permanent validation failures: `MEDIA_BYTE_SIZE_MISMATCH`, `MEDIA_CHECKSUM_MISMATCH`, `MEDIA_MIME_MISMATCH`, `MEDIA_DIMENSIONS_INVALID`, `MEDIA_DECODE_FAILED`, and `MEDIA_DECODE_UNSUPPORTED`; mark them non-retryable. Keep storage/network errors retryable.
8. Export the new factory/types through `packages/media/src/index.ts` without changing public media API projections.

Run the storage and service tests after this step. Fix only adapter/port mismatches exposed by those tests.

### 3. Update ports and scan processing

Update `packages/media/src/types.ts`, `packages/media/src/store-port.ts`, and `packages/media/src/scan-processor.ts`.

1. Remove `MediaProviderScanResult` and `MediaScanStorage.getScanResult`; retain only direct sanitization in the scan storage port.
2. Add `byteSize` and `checksumSha256` to the sanitize input. Allow `MediaStorage.inspectUpload.checksumSha256` to be `string | null` and propagate that through the media store completion input.
3. Add the stable rejection-reason union and make `MediaScanStorePort.finishRejected` accept a validation reason while preserving the existing database `scan_result` column semantics.
4. Extend the scan row selection type with `byte_size` and `checksum_sha256`.
5. Change `MediaScanProcessor.process` to claim then sanitize directly. On permanent `MediaError` validation codes, call `finishRejected` with the corresponding stable bare reason. On transient/storage errors, call `recordFailure`. Do not call, describe, or emulate an external malware scanner.
6. In `PostgresMediaScanStore.finishReady`, add an explicit code comment that `clean` means strict server-side validation/decode/re-encode succeeded under R2, not GuardDuty malware scanning. Keep the current ready update and audit shape. Store rejection reasons in `rejection_reason_code` through the existing SQL path.
7. Preserve deadline/retry sweep behavior and existing event names.

Run media tests, then media typecheck. If a test failure is ambiguous, use the systematic-debugging workflow before changing implementation.

### 4. Update service/config and production wiring

1. In `packages/media/src/service.ts`, treat a missing provider checksum as “defer authoritative checksum validation to worker”; reject only a present mismatching checksum during completion. Keep all API responses, status transitions, idempotency, and upload receipt behavior unchanged.
2. In `packages/config/src/index.ts`, add `storageProvider`, `s3Endpoint`, and `awsRegion` handling for media. When media is enabled, require provider `r2`, an HTTPS R2 endpoint, exact region `auto`, valid bucket, and valid prefix. When disabled, return safe empty/default values without requiring storage env vars. Do not read or expose AWS credentials from config.
3. In `apps/api/src/main.ts` and `apps/worker/src/main.ts`, replace direct `AwsS3MediaStorage` construction with the shared R2 factory and pass the endpoint/region/bucket/prefix from `loadMediaConfig`. Do not modify private-material storage wiring.
4. Add/adjust pure wiring seams or source-contract tests as needed so API and worker tests can prove the same R2 construction path without importing side-effectful `main.ts`.
5. Update `.env.example` with the five required media R2 variables and an R2 endpoint example. Update/remove only active AWS GuardDuty media infrastructure artifacts (`infra/aws/public-media.yaml` and its test) so they cannot be deployed as the media path; leave unrelated AWS/private-material infrastructure untouched.

Run config, API, and worker tests. Then run all four affected workspace typechecks.

### 5. Full verification and review

1. Run all affected workspace tests:
   - `npm run test -w @vibecheck/media`
   - `npm run test -w @vibecheck/config`
   - `npm run test -w @vibecheck/api`
   - `npm run test -w @vibecheck/worker`
2. Run all affected workspace typechecks in dependency order: config, media, API, worker.
3. Run all affected workspace builds in dependency order: config, media, API, worker.
4. Run `git diff --check`, inspect the complete diff, verify no active media source contains `GetObjectTagging`, GuardDuty, SSE, or tagging fields, and verify only the requested files plus the approved docs changed.
5. Confirm no migration file was added or modified.
6. Review R2 CORS requirements against the actual signed upload headers: `PUT`, the deployed app origin, request headers `Content-Type`, `If-None-Match`, and `x-amz-checksum-sha256`; expose `ETag` only if the browser reads it. Do not include removed SSE/tagging headers.

## Expected deliverable

The final response will list changed files, exact test/typecheck/build results, Northflank environment variables (including standard AWS credentials), migration status, and the final R2 CORS header/method requirements. It will explicitly distinguish local contract tests from any live R2 credentialed test if no live R2 environment is available.
