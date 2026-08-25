# BLOCKED — 真实 API 专项 E2E（e2e/submission-real-api.spec.ts）

时间：2026-08-24。结论：clean 环境缺少真实 E2E 前置条件，按任务书约定不绕过、不创建该 spec，证据如下。

1. **无可用真实 API（AUTH/IDENTITY/SUBMISSION）**
   - 生产部署（render.yaml `vibecheck-web`，SUBMISSION_ENABLED=true）不可达：`curl -m 90 https://vibecheck-web.onrender.com/health/ready` 与 `/` 均超时（exit 28，HTTP 000），代理与 `--noproxy '*'` 直连两种路径同样超时；DNS 可解析（216.24.57.7/15）。
   - 本地无法启动真实 API：`apps/api/src/main.ts` 强制依赖 PostgreSQL（`createDatabasePool`、`PostgresSubmissionStore`、`PostgresIdentityStore`）；本机 `docker: command not found`、`psql: command not found`，compose.yaml 的 pgvector 容器无法启动。
2. **无已登录 storageState**：`playwright.config.ts` 与 `e2e/` 全部 spec 均无 storageState 配置或登录态文件（grep 无匹配）。
3. **无预置唯一公开测试 URL**：docs 与配置中未定义可用于 URL-check 访问探测且保证不撞查重的唯一公开 URL。

处置：未使用源码相对路径导入 contracts、未使用 page.route、未构造假 Session；`e2e/submission-real-api.spec.ts` 不创建（避免向 CI 引入必失败或用 skip 规避的用例）。待 Render 服务恢复/本地 Postgres 可用、预置登录态与唯一测试 URL 到位后补建。
