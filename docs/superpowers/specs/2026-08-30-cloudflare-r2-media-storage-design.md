# Cloudflare R2 media storage design

## Scope

Replace the current AWS S3 plus GuardDuty-specific media flow with Cloudflare R2 through its S3-compatible API. Keep the existing media resource/reference data model, HTTP routes, response shapes, supported formats, and validation limits. Changes are limited to media storage, media scanning/sanitization, configuration, API/worker wiring, related tests, and the active media-storage infrastructure documentation.

## Runtime architecture

`R2MediaStorage` remains behind the existing media storage ports and uses `@aws-sdk/client-s3` plus `@aws-sdk/s3-request-presigner`. Its default client is configured with `region: "auto"`, `MEDIA_S3_ENDPOINT`, and the standard AWS credential provider chain. No explicit credentials are copied into application configuration.

The existing `aws-s3-storage.ts` module is retained to avoid an unnecessary module move. It exports the R2 implementation and a compatibility alias for the old class/config names; API and worker production wiring use the R2 factory directly. No application route or public media model is renamed.

## Object lifecycle

1. API issues a short-lived presigned PUT for `public-media/quarantine/{userId}/{mediaResourceId}`.
2. The signed request keeps `Content-Type`, `If-None-Match: *`, and the SHA-256 checksum header. It removes server-side encryption and object-tagging fields and headers.
3. API completion performs the existing object preflight. MIME and byte size are checked when available; provider checksum metadata is optional and is never the authoritative checksum source.
4. A queued media scan request is consumed by the worker. The worker downloads the quarantine object and is authoritative for validation: it checks actual byte size, computes SHA-256, compares it with the database declaration, decodes with Sharp using `limitInputPixels: 40_000_000`, validates the real MIME and dimensions, rotates according to orientation, re-encodes the supported format, and strips EXIF.
5. The worker writes the sanitized result to `public-media/ready/{userId}/{mediaResourceId}` and deletes the quarantine object only after the ready write succeeds.
6. The worker marks the media resource ready only after the full write/delete workflow succeeds. Existing short-lived presigned GET content responses continue to point at the ready object.

## Validation and rejection semantics

Supported MIME types remain `image/jpeg`, `image/png`, `image/webp`, and `image/avif`. SVG, GIF, and PDF remain unsupported. The raw object remains limited to 5 MiB, dimensions to 12000 by 12000, and Sharp input pixels to 40,000,000.

Permanent worker validation failures are mapped to stable rejection reasons:

- `BYTE_SIZE_MISMATCH`
- `CHECKSUM_MISMATCH`
- `MIME_MISMATCH`
- `DIMENSIONS_INVALID`
- `DECODE_FAILED`
- `UNSUPPORTED_FORMAT`

Those failures set the existing media resource status to `rejected` and persist the reason through the existing scan-store path. Storage/network failures remain retryable. The existing `scan_result = clean` column is retained for compatibility, but under the R2 provider it explicitly means that strict server-side byte validation, decoding, dimension/MIME validation, and re-encoding succeeded. It does not mean a GuardDuty malware scan and no code comment or test describes it as one.

## Configuration

When media storage is enabled, configuration requires:

- `MEDIA_STORAGE_PROVIDER=r2`
- `MEDIA_S3_ENDPOINT` using the R2 S3 endpoint
- `MEDIA_AWS_REGION=auto`
- `MEDIA_S3_BUCKET`
- `MEDIA_S3_PREFIX`

The disabled-media configuration remains loadable without storage credentials. No credentials are added to the application config object; the S3 client reads `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` through the standard SDK chain.

## Compatibility and migration

The API routes, media resource/reference structures, database columns, and existing migration history remain unchanged. This feature requires no database migration. AWS GuardDuty and `GetObjectTagging` code paths are removed from the active media implementation and wiring.

## Test strategy

Tests are written first and cover:

- R2 S3 command construction, presigned upload headers, optional provider checksum metadata, direct download validation, Sharp sanitization, ready write/delete ordering, and absence of SSE/tagging.
- Media scan processing for ready, stable rejection reasons, and retryable storage failures.
- R2 configuration defaults and invalid provider/endpoint/region inputs.
- API and worker wiring to the shared R2 storage factory while preserving route boundaries.

Affected workspaces receive fresh test, typecheck, and build verification after implementation.

## R2 browser CORS contract

The browser needs `PUT` permission for the presigned upload origin. The allowed request headers are the headers actually signed/sent by the upload flow: `Content-Type`, `If-None-Match`, and `x-amz-checksum-sha256`. `ETag` is exposed only if the browser reads it from the upload response. No SSE or tagging header is included.
