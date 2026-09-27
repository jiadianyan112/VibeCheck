# Northflank 发布后台进程

审核通过仅写入数据库审核决定和 `submission_approved` 待处理事件。公开作品档案由 `@vibecheck/worker` 处理该事件后创建。若只部署 Web/API，作品不会出现在 `/api/v1/projects`。

在同一个 Northflank 项目创建一个持续运行的 Service（不要用一次性 Job）：

1. 使用与 `vibecheck-web` 相同的 Git 仓库和部署分支，构建目录为仓库根目录。
2. 构建命令：`npm ci && npm run build:libraries && npm run build -w @vibecheck/worker`。
3. 在 **CMD override** 选择 **Custom command (default process)**，填写 `npm run start -w @vibecheck/worker`。
4. 绑定与 Web/API 相同的运行时 secret group，至少提供同一数据库的 `DATABASE_URL`。沿用 Web/API 的 `DATABASE_SSL`、媒体存储和私有材料配置。不要把数据库连接串放入构建参数。
5. 保持实例运行。启动日志应含 `worker_started`；处理审核后应含 `worker_cycle_completed` 且 `claimed > 0`。随后 `GET /api/v1/projects` 应能查到对应作品。

服务应在 Web/API 更新前或同时部署。重复启动多个 worker 时，数据库 outbox 会用 claim 避免同一事件被同时处理。
