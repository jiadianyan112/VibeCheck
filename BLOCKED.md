# BLOCKED — 真实 API 专项 E2E（e2e/submission-real-api.spec.ts）

时间：2026-08-28。旧的“API 不可达”结论已修正：Media/Evidence 路由契约已存在，typed clients 已通过本地注入 fetch 的契约测试；这些测试不等同真实网络路由可达。本文件仅记录真实部署与真实 E2E 尚未验收的前置条件；按任务书约定不绕过、不创建该 spec。

本轮 P12B 主流程最终修正门禁补充：真实空草稿状态化 golden path 已覆盖四步填写、双 canonical PATCH、封面/证据、preview/submit 与 `pending_review`；本地聚焦前端、contracts tests/check、lint、typecheck 与 build 均通过。这些仍是本地客户端/契约/状态化证据，不是 production E2E。PostgreSQL fixture 未通过也未标绿：本机 `DATABASE_URL` 未设置；`npm run submission:submit:fixture:verify` 的精确失败为 `Error: CONFIG_DATABASE_URL_REQUIRED`（exit 1）。在本地环境可用或 CI 证明 pushed HEAD 前，CI 仍为 fixture 权威。

1. **真实部署与数据依赖尚未验收（AUTH/IDENTITY/SUBMISSION）**
   - 已有记录显示生产部署（render.yaml `vibecheck-web`，SUBMISSION_ENABLED=true）在 2026-08-24 的探测中超时：`curl -m 90 https://vibecheck-web.onrender.com/health/ready` 与 `/` 均 exit 28、HTTP 000；这只能说明当次真实部署验收失败，不否定本地 API 路由和客户端契约。
   - 本地真实 API 仍无法启动：`apps/api/src/main.ts` 强制依赖 PostgreSQL（`createDatabasePool`、`PostgresSubmissionStore`、`PostgresIdentityStore`）；当时本机 `docker: command not found`、`psql: command not found`，compose.yaml 的 pgvector 容器无法启动。
2. **无已登录 storageState**：`playwright.config.ts` 与 `e2e/` 全部 spec 均无 storageState 配置或登录态文件（grep 无匹配）。
3. **无预置唯一公开测试 URL**：docs 与配置中未定义可用于 URL-check 访问探测且保证不撞查重的唯一公开 URL。

4. **AWS signed upload / scan 与部署 flag 未验收**：真实 S3/对象存储 signed URL、上传回执、扫描器清理 EXIF 并返回 clean/ready 的链路尚未在 AWS 环境验证；`SUBMISSION_ENABLED` 等部署 flag 也未开启或验收。本轮只验证客户端边界，不把本地 mock fetch 当作真实上传扫描。

5. **本轮不得扩展为 production E2E 或审核完成**：没有把状态化测试记为 production E2E；review approval、first publication、ProjectUpdate return flow 仍是 future scope，均未完成。真实 deployed E2E 仍需 authenticated storageState、唯一公开 URL、真实 API/数据库、AWS signed-upload/scan 与生产 feature flags。

处置：未使用源码相对路径导入 contracts、未使用 page.route、未构造假 Session；`e2e/submission-real-api.spec.ts` 不创建（避免向 CI 引入必失败或用 skip 规避的用例）。待真实部署/本地 Postgres、storageState、唯一测试 URL、AWS signed-upload/scan 与 flag 到位后补建。
