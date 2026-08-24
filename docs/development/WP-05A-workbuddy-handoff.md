# WP-05A WorkBuddy 前端接入交接

**OpenAPI：`packages/contracts/openapi/v1.yaml`｜SHA-256：`2adb1e176ba08370d16146fb6e9adef95287ab263c94dc46a1fcc6996993a9de`｜日期：2026-08-20**

## 0. SubmissionDraft Typed HTTP Client（P10→P11）

- contracts 已导出 `SubmissionDraftClient`、`createSubmissionDraftClient` 和 `createSubmissionDraftHttpClient`。三个方法分别是 `create(request)`（`POST /api/v1/submission-drafts`，成功 `201`）、`get(draftId)`（`GET /api/v1/submission-drafts/{draft_id}`，成功 `200`）和 `patch(draftId, request)`（`PATCH /api/v1/submission-drafts/{draft_id}`，成功 `200`）。请求体严格使用 OpenAPI 的 `SubmissionDraftCreateRequest` / `SubmissionDraftPatchRequest`。
- 三个请求都使用 `credentials: include`、`Accept: application/json`、`X-Request-Id`，并透传 `AbortSignal`。`create`/`patch` 每次调用 `getCsrfToken()` 后发送 `Content-Type: application/json` 与 `X-CSRF-Token`；`get` 不读取或发送 CSRF，也不发送 `Content-Type`。
- `client_request_id` 与 `operation_id` 原样放入请求体；客户端不替换、不递增、不隐式重试。HTTP 错误保留 `status`、`code`、`request_id`、`retryable`、`retry_after_ms`、`field_errors` 和 `details`。
- 版本冲突映射：`409`（尤其 `SUBMISSION_DRAFT_VERSION_CONFLICT`）是明确的 HTTP 错误；保留当前草稿和错误详情，由上层重新读取并决定刷新/合并，不能自动重试或递增 `expected_version`。过期映射：`410` 表示草稿不可继续编辑；丢弃过期草稿状态，重新完成有效 URL check 后创建新草稿。
- 本地 typed client 已完成；远端 CI 待验证；真实前端 E2E 未开始。该客户端不覆盖 preview、submit、revision、媒体或证据。

## 1. P10/P11 调用顺序

1. 未登录点击发布：创建 `start_submission` PendingAction；OTP 成功并消费后只按服务端 `return_to` 进入发布入口，不期待自动创建 draft。
2. 完成 URL check 并创建 SubmissionDraft。
3. 客户端计算文件 SHA-256，调用 `POST /api/v1/media-resources`。必须发送 Session、Origin、CSRF、稳定 `Idempotency-Key`。
4. 使用响应 `upload_url` 做 PUT，并原样发送响应中的全部 `upload_headers`；保存 PUT 响应 ETag。
5. 调用 `POST /api/v1/media-resources/{id}/complete`，新操作使用新的 `Idempotency-Key`；网络重试复用同一键、checksum 和 ETag。
6. 轮询 `GET /api/v1/media-resources/{id}`。只有 `status=ready && scan_result=clean` 时才能创建 MediaReference。
7. 创建 `role=cover`、`target_type=submission_draft` 的 MediaReference，再把 reference ID 写入 `project_core.cover_media_reference_ids`。不要把 MediaResource ID 当作 cover reference ID。
8. 刷新后预览使用 `GET /api/v1/media-resources/{id}/content`，允许浏览器跟随 302；不要缓存 Location 或把签名 URL存入状态、日志、Analytics。

## 2. UI 状态映射

| 后端状态 | UI 行为 |
| --- | --- |
| `uploading` | 显示上传中；过期后允许用户重新选择文件并使用新 Idempotency-Key |
| `uploaded/scanning` | 显示“正在进行安全检查”；15 秒退避轮询，不允许提交 |
| `ready+clean` | 创建/恢复 MediaReference，展示净化预览 |
| `rejected+malicious` | 固定提示“文件未通过安全检查”，不得自动重传同一文件 |
| `rejected+unscannable` | 提示重新导出为受支持图片后上传 |
| 409 `MEDIA_RESOURCE_NOT_READY` | 保留选择，继续查询状态，不创建引用 |
| 410 `MEDIA_UPLOAD_EXPIRED` | 废弃当前 resource，重新 prepare |
| 413/415 | 在文件选择处展示尺寸/MIME错误，不调用 PUT |
| 503 `MEDIA_STORAGE_*` | 保留 operation key，按 Retry-After/指数退避重试 |

## 3. 必须移除或停用的 Mock

- 本地定时器直接把上传状态改为 success/ready。
- 使用 blob/data URL 作为刷新后的正式封面来源。
- 在未创建 MediaReference 时把 MediaResource ID 写入 cover 字段。
- 绕过 URL check 直接创建 SubmissionDraft。
- 登录成功后由浏览器自行伪造已完成的 PendingAction。
- production 中的 SVG/GIF/视频上传入口；本切片只开放四种静态图片 MIME。

## 4. Feature Flag 与验收

当前 Render `MEDIA_ENABLED=false`。在 Flag 打开前，需由 Codex/平台完成 AWS Staging 资源；WorkBuddy 完成真实接口接线，并验证上传过期、重复 complete、扫描 pending、恶意/不可扫描、刷新恢复、无权限读取和提交前未 ready 拦截。前端不得将 Mock 成功态作为上线证据。
