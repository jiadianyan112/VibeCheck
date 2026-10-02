# 实际体验上线

## 顺序

部署前，`vibecheck-web` 的 Runtime variables 必须包含 `COMMUNITY_ENABLED=true`、至少32字符的 `COMMUNITY_CURSOR_SECRET`、32字节随机密钥Base64格式的 `COMMUNITY_REPORT_ENCRYPTION_KEY` 与 `COMMUNITY_REPORT_ENCRYPTION_KEY_VERSION=community-v1`。密钥已有则保留，不能随着构建更换。

1. Northflank → Jobs → vibecheck-db-migrate，构建并部署 `codex/actual-experiences` 分支的最新提交。
2. 保持 CMD override 为 `npm run db:migrate`，使用生产 PostgreSQL 对应的 DATABASE_URL，手动运行一次。
3. 首次运行预期 `migrations_ok applied=1 existing=44`、退出码 0；重复运行预期 applied=0。需确认运行的是包含 `000045_structured_experiences.sql` 的提交。
4. 迁移成功后，将 `vibecheck-web` 与 `vibecheck-worker` 构建/部署到相同提交。该迁移兼容现有程序，可先迁移再切换。
5. 线上验证下列流程。

## 验收

- 访客打开已发布作品，能读取「实际体验」与独立普通讨论。
- 访客填写任务、结果后登录，表单内容仍在；登录后发布，刷新和其他设备能读到记录。
- 上传 1–3 张截图，安全处理完成后提交。超过数量、5 MiB、扫描未就绪和跨账号资源应被拒绝。
- 已验证作者回复即时公开并有作者标记；普通回复待审核。
- 举报体验后公开列表与截图 API 均不可读。浏览器收到图片字节，不接收存储签名地址。
- 后台社区内容审核：领取、查看字段与截图、选择原因、公开/隐藏；作者及举报者不能处理自己的任务。
- 普通讨论发布、举报、撤回流程仍可用。

## 已执行的本地检查

- 全量网页测试：83 文件 / 490 测试通过。
- API 47、社区 6、媒体 26、审核 21、迁移发现 1 测试通过。
- 完整库、API、worker、网页构建及类型编译通过。
- OpenAPI 契约、生产文案、前端体积预算、改动文件 ESLint 通过。

## 待执行

当前环境没有生产数据库连接与可用的 Northflank 登录会话，也没有运行中的本地 PostgreSQL。真实数据库迁移、并发事务集成验证和线上验收尚未执行。不要把本地测试通过视为已经上线。

## 上线记录与限流策略补齐

2026-10-02 用户提供日志确认 `000045` 已成功应用：`migrations_ok applied=1 existing=44`，退出码0。网页部署后开启社区服务，发布时报 `RATE_LIMIT_POLICY_UNAVAILABLE`：原社区限流策略仅测试fixture初始化，生产迁移未写入。

`000046_community_rate_limit_defaults.sql` 给尚无已发布配置的键补齐默认策略：评论/体验/回复共用每用户60秒3次，举报每用户60秒2次；已发布策略不覆盖。构建并部署该提交到 `vibecheck-db-migrate` 后运行 `npm run db:migrate`，预期首次 `applied=1 existing=45`。无需再次修改密钥，也不需要为仅数据库策略迁移重部署网页。
