# WP-05A：P11 公开封面媒体安全闭环

**状态：实现已提交（HEAD `9c47e55`）；当前 CI 失败，未全量验证｜日期：2026-08-24**

## 1. 交付目标

该切片解除 P11 的真实阻断：注册用户可以把封面从本地文件转换为可被 SubmissionDraft 引用的 `ready+clean` MediaResource。原始对象始终位于隔离区；浏览器、草稿和公开页面都不能读取未扫描原图。

## 2. 状态与事务

1. `OP-MEDIA-CREATE` 原子创建 `uploading/not_scanned` 资源，按 `owner_user_id + idempotency_key` 重放。
2. 浏览器按响应的五个 Header 将 1–5 MiB 图片直传 S3；API 不代理文件字节。
3. `OP-MEDIA-COMPLETE` 通过 HeadObject 校验 ETag、MIME、长度和 SHA-256。通过时原子置为 `uploaded`、保存不可变回执并写 Outbox；不匹配时持久化 rejected 回执，同一操作重放同一错误。
4. Worker 将 `uploaded/scanning` 领取为有界扫描租约。pending 15 秒领域重排；provider failure 最多三次指数退避；处理总期限 30 分钟。
5. GuardDuty clean 后，Worker 用 Sharp 解码并限制 4,000 万像素、单边 12,000 像素，按方向旋转，再以 JPEG/PNG/WebP/AVIF 重新编码。重新编码不会复制 EXIF/ICC/XMP；只有独立 ready 对象写成功后数据库才进入 `ready/clean/exif_removed=true`。
6. MediaReference 创建仍在事务内要求同一所有者、`ready+clean`、无 deletion guard；Submission preview/submit 的既有门禁无需降级。

跨 S3/PostgreSQL 采用可重试顺序：净化对象使用稳定 ready key 幂等覆盖，数据库最后提交；隔离对象由 S3 lifecycle 延迟清理，避免数据库提交失败后失去重试源。正式物理删除 Saga 不在本切片。

## 3. 安全边界

- 接受 MIME：`image/jpeg`、`image/png`、`image/webp`、`image/avif`；GIF/SVG/视频/文档拒绝。
- S3 上传必须带 checksum、SSE-S3、quarantine tag 和 `If-None-Match: *`。
- GuardDuty 仅扫描 quarantine prefix；ready 对象只能由运行角色从已扫描字节重新编码产生。
- API 投影、日志、Analytics 和错误响应均无 bucket、storage key、签名凭据或 provider 原文。
- 草稿刷新预览使用 owner-only content 302，签名最长 60 秒，响应 `private, no-store`。
- 生产 Flag 保持关闭；AWS 模板、IAM 运行角色、CORS 精确 Origin、干净/恶意样本均需在 Staging 真实演练。

## 4. 契约与错误

- `POST /api/v1/media-resources`
- `GET /api/v1/media-resources/{media_resource_id}`
- `POST /api/v1/media-resources/{media_resource_id}/complete`
- `GET /api/v1/media-resources/{media_resource_id}/content`
- 既有 `POST/GET/PATCH/DELETE /api/v1/media-references*`

稳定错误包括 `MEDIA_MIME_UNSUPPORTED`、`MEDIA_SIZE_INVALID`、`MEDIA_UPLOAD_EXPIRED`、`MEDIA_UPLOAD_RECEIPT_MISMATCH`、`MEDIA_MIME_MISMATCH`、`MEDIA_CHECKSUM_MISMATCH`、`MEDIA_RESOURCE_NOT_READY`、`MEDIA_SCAN_VERSION_CONFLICT` 和 `MEDIA_STORAGE_*` 503。

## 5. 当前 CI 状态

- GitHub Actions Run [#32367557494](https://github.com/jiadianyan112/VibeCheck/actions/runs/32367557494) 对应 HEAD `9c47e55`，结论为 `failure`。质量门、41 个 migration 新库/重复执行和 URL-check fixture 通过；本工作包的 `media:fixture:verify` 失败；Evidence 及后续 fixture 因工作流顺序被 skipped。
- 最近完整绿色基线为提交 `6296652` / Run [#32362566696](https://github.com/jiadianyan112/VibeCheck/actions/runs/32362566696)。该 Run 不能替代当前 HEAD 的 Media fixture 证据。
- 因此本文件中的实现边界和本地测试说明不等于 PostgreSQL 验收完成；生产 `MEDIA_ENABLED` 仍保持关闭。

## 6. 验证与复跑门槛

- OpenAPI：85 paths / 95 operations；SHA-256 `2adb1e176ba08370d16146fb6e9adef95287ab263c94dc46a1fcc6996993a9de`。
- Media 单元测试覆盖输入上限、prepare/complete、GuardDuty 五类映射、处理失败重试、真实图片重编码与 EXIF 移除、AWS 模板门禁。
- API 测试覆盖登录、Origin、CSRF、幂等键、命令绑定及 owner-only 302。
- Worker 测试覆盖事件 aggregate/payload 绑定。
- `npm audit --omit=dev`：0 vulnerability；Sharp 使用已修复 libvips 公告的 0.35.3。
- 本地没有 PostgreSQL 服务；最终门禁必须在 PostgreSQL 18 上复跑 `npm run db:migrate` 两次、确认 41 个 migration，再运行 `npm run media:fixture:verify`。在该命令成功前，不得把 ready-resource guard、不可变 unlink receipt 或 WP-05A 标为完成。
