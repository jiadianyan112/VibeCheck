# WP-04 发布与回流开发记录

## 当前迭代：WP-04A URL 检查与服务端草稿

状态：实现完成；远端 PostgreSQL 质量门禁已通过（commit `efac1fd`）。

### 已实现

- `OP-URL-CHECK`：认证用户、同源与 CSRF 门禁；http/https 规范化；禁止凭据、显式端口、私网/本机、混合 DNS 答案和不安全重定向；每跳重新解析并固定连接地址；最多 5 次重定向。
- URL 检查把安全结论与可访问性分轴：DNS/地址风险未确定时不得创建草稿；访问探测临时失败可保存入口草稿但后续不得提交公开；HTTP 404 等确定失败标记为 unavailable。
- URL 检查 30 分钟过期；同 owner+规范输入复用同一 check；每个 client_request_id 通过 receipt 固定载荷，异载荷复用返回 409。
- 当前公开 Project 使用规范 URL 哈希精确查重；命中时返回已有档案候选且不创建草稿；创建草稿事务再次查重，避免检查后竞态。
- `OP-DRAFT-CREATE/GET/PATCH`：只创建 `SubmissionDraft/editing`，不创建 Project、Version、Event 或公开 Evidence；草稿保存双品类 schema 标识、稳定 chain/revision、版本与过期时间。
- PATCH 使用递归对象补丁、expected_version 和 operation_id receipt；同操作重放返回原响应，异载荷复用或旧版本返回 409。
- category/schema/check/public_url、owner、chain 和首版 revision 在草稿内不可修改；submitted 草稿内容不可修改且禁止回到 editing。
- 数据库已预置 `Submission` 和 `ReviewWorkItem` 的关联边界，为下一迭代的冻结快照与审核链提供不可绕过的对象分离。
- 本迭代完成时 OpenAPI 为 32 paths / 37 operations；新增迁移 `000016_submission_entry_and_drafts.sql`。

### 安全与隐私边界

- API 普通请求日志不记录 URL 正文；重定向链移除 query/fragment 后才持久化和返回。
- canonical URL 仅位于 owner 隔离工作流数据；禁止凭据型 URL。
- 网络探测不跟随运行时默认重定向；每跳重新执行 DNS 公网地址校验并以解析地址固定连接，防止 SSRF/DNS rebinding。
- 当前未实现网页正文抓取、JS 渲染或自动提取，避免在 TBC-004 合规与供应商策略确认前扩大网络能力。

### 本迭代明确未开放

- `OP-SUBMIT`、撤回、修订草稿、审核决定与发布 worker 尚未开放。
- EvidenceDraft、MediaResource/MediaReference 未完成前，服务端不会把不完整草稿提交为 Submission。
- `start_submission` PendingAction 继续返回 501 且不消费；该动作只有在入口语义与 URL/PendingInput 一致后才开放，不能绕过 `check_id` 前置条件。
- 不存在审核前 Project，也不存在从当前本地原型 reducer 直接发布公开事实的路径。

## 当前迭代：WP-04B 审核工作项队列与租约底座

状态：实现完成，等待远端 PostgreSQL 质量门禁。

### 已实现

- `OP-WORK-QUEUE`：按单一 work_type、可选 target_type/status 返回稳定签名游标；职责冲突主体在 `total_count`、排序、游标、分页和领域摘要计算前通过数据库反连接过滤，不返回 conflict flag 或被过滤对象占位。
- `OP-ADMIN-CLAIM`：平台编辑/管理员按 work_type 权限领取；creator_profile 仅管理员；expected_version、当前状态、职责分离与 ownership principal version 在同一数据库锁内复检。
- 原始 claim token 使用 256-bit 随机值，只在成功响应返回；数据库、事件、审计和日志仅保存 SHA-256 哈希或不保存 token。
- 租约固定 60 秒，客户端按 PRD 每 30 秒 heartbeat；当前技术默认最长连续领取 900 秒，可通过受边界校验的环境配置调整。heartbeat 每次增加 WorkItem version，超过租约或最长时长返回 410 并释放。
- `OP-ADMIN-RELEASE`：当前领取者或持有效 token 的管理员可释放；以 claim token 哈希+请求哈希保存 receipt，同载荷重试返回原响应，异载荷返回 409。
- worker 每轮批量回收过期 ReviewWorkItem；领取、续租、释放、过期和取消均写 append-only WorkItemEvent，后台写同时生成不可含自然人 ID 的审计哈希。
- 社区评论审核工作项已接入 author/reporter 冲突主体；迁移会回填已存在的社区工作项，后续 Submission/Verification/Ownership 等创建器必须在创建 WorkItem 的同一事务写入对应主体快照。
- 数据库约束禁止非 claimed 状态残留 assignee/token/lease，禁止 decided 缺少 typed decision ref；修复 `SubmissionDraft.base_submission_id` 的逻辑外键。
- OpenAPI 当前为 36 paths / 41 operations；新增迁移 `000017_review_work_item_leases.sql` 和独立 `@vibecheck/workflow` 领域包。

### 本迭代明确未开放

- `OP-ADMIN-DECISION`、ReviewDecision、CreatorProfileExecutionDecision 仍未开放；不能通过 claim/release 直接修改领域事实。
- Submission、Verification、Ownership、Evidence、Relation、Recheck、Creator Profile 的工作项创建器与领域摘要由对应后续迭代接入；当前通用权限和枚举契约不代表这些审核业务已经完成。
- 未实现任何后台前端页面；WorkBuddy 可在接口稳定后消费队列与租约 API，但不得绕过服务端鉴权或在浏览器保存 claim token 到持久存储。

### 下一迭代

WP-04C：EvidenceDraft/MediaResource 最小晋级前置；完成后再开放 Submission 冻结快照，同事务创建 `Submission/pending_review`、`ReviewWorkItem/queued`、冲突主体和 `project_submitted` Outbox。随后实现 owner 撤回及退回后的新 revision，不在旧 draft 上重开。
