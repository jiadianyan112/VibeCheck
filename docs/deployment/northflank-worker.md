# Northflank 发布后台进程

审核通过仅写入数据库审核决定和 `submission_approved` 待处理事件。公开作品档案由 `@vibecheck/worker` 处理该事件后创建。若只部署 Web/API，作品不会出现在 `/api/v1/projects`。

在同一个 Northflank 项目创建一个持续运行的 Service（不要用一次性 Job）：

1. 使用与 `vibecheck-web` 相同的 Git 仓库和部署分支，构建目录为仓库根目录。
2. 构建命令：`npm ci && npm run build:libraries && npm run build -w @vibecheck/worker`。
3. 在 **CMD override** 选择 **Custom command (default process)**，填写 `npm run start -w @vibecheck/worker`。
4. 绑定与 Web/API 相同的运行时 secret group，至少提供同一数据库的 `DATABASE_URL`。沿用 Web/API 的 `DATABASE_SSL`、媒体存储和私有材料配置。不要把数据库连接串放入构建参数。
5. 保持实例运行。启动日志应含 `worker_started`；处理审核后应含 `worker_cycle_completed` 且 `claimed > 0`。随后 `GET /api/v1/projects` 应能查到对应作品。

服务应在 Web/API 更新前或同时部署。重复启动多个 worker 时，数据库 outbox 会用 claim 避免同一事件被同时处理。

开发者身份 v1 起，Web/API 和 Worker 的 `start` 命令会先运行编译后的数据库迁移，迁移成功后才启动服务。迁移通过 PostgreSQL advisory lock 串行执行且保存校验和；同时部署两个服务不会重复执行。构建必须包含 `@vibecheck/database`。迁移失败时新实例不会提供前端或处理事件，既有实例保留至新实例健康。

本次新增 000048/000049：主要开发主体引用、新版作品权限标记、新版认证申请边界。历史记录保留，只有唯一且有效的历史 owner 关系才补主要引用。回退应用版本时保留新增字段、身份和审核记录，不回滚数据库数据。

生产运行账号没有表结构变更权限时，先使用数据库已有管理员／迁移连接单独执行新增迁移并写入 ops.schema_migrations，再部署应用。不要给 Web/API 或 Worker 永久绑定管理员连接，也不要扩大运行角色权限。已存在的迁移记录表不会重新执行 CREATE SCHEMA；启动进程会核对已有迁移校验和，缺少迁移时仍阻止新版启动。手动恢复旧构建会关闭 Northflank CD，恢复新版时必须重新打开并核对该开关。

