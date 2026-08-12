# WP-04 发布与回流开发记录

## 当前迭代：WP-04A URL 检查与服务端草稿

状态：实现完成，等待远端 PostgreSQL 质量门禁。

### 已实现

- `OP-URL-CHECK`：认证用户、同源与 CSRF 门禁；http/https 规范化；禁止凭据、显式端口、私网/本机、混合 DNS 答案和不安全重定向；每跳重新解析并固定连接地址；最多 5 次重定向。
- URL 检查把安全结论与可访问性分轴：DNS/地址风险未确定时不得创建草稿；访问探测临时失败可保存入口草稿但后续不得提交公开；HTTP 404 等确定失败标记为 unavailable。
- URL 检查 30 分钟过期；同 owner+规范输入复用同一 check；每个 client_request_id 通过 receipt 固定载荷，异载荷复用返回 409。
- 当前公开 Project 使用规范 URL 哈希精确查重；命中时返回已有档案候选且不创建草稿；创建草稿事务再次查重，避免检查后竞态。
- `OP-DRAFT-CREATE/GET/PATCH`：只创建 `SubmissionDraft/editing`，不创建 Project、Version、Event 或公开 Evidence；草稿保存双品类 schema 标识、稳定 chain/revision、版本与过期时间。
- PATCH 使用递归对象补丁、expected_version 和 operation_id receipt；同操作重放返回原响应，异载荷复用或旧版本返回 409。
- category/schema/check/public_url、owner、chain 和首版 revision 在草稿内不可修改；submitted 草稿内容不可修改且禁止回到 editing。
- 数据库已预置 `Submission` 和 `ReviewWorkItem` 的关联边界，为下一迭代的冻结快照与审核链提供不可绕过的对象分离。
- OpenAPI 当前为 32 paths / 37 operations；新增迁移 `000016_submission_entry_and_drafts.sql`。

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

### 下一迭代

WP-04B：EvidenceDraft/MediaResource 最小晋级前置与 Submission 冻结快照；同事务创建 `Submission/pending_review`、`ReviewWorkItem/queued` 和 `project_submitted` Outbox，随后实现 owner 撤回及退回后的新 revision，不在旧 draft 上重开。
