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

状态：实现完成；远端 PostgreSQL 质量门禁已通过（commit `1113dc9`）。

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

## 当前迭代：WP-04C MediaReference 与 EvidenceDraft 晋级前置

状态：控制面实现完成；首轮远端门禁确认迁移与 Media fixture 通过，Evidence fixture 的 UUID/text 测试 SQL 类型错误已修复并等待复验。对象存储上传面在供应商、安全扫描与 SLA 确认前保持关闭。

### 已实现

- 新增 `MediaResource`、分片记录、`MediaReference`、`EvidenceDraft`、证据附件草稿、不可变快照和幂等 receipt 的逻辑模型与数据库约束；不把草稿对象提前写成公开 `Asset` 或 `Evidence`。
- 冻结媒体状态与扫描结果矩阵。只有 `ready + clean` 且没有删除保护原因的 owner 资源可被草稿引用或作为证据附件。
- `OP-MEDIA-STATUS` 与 MediaReference 列表、创建、修改、删除已接入真实数据库；当前仅开放 `submission_draft` 父对象，其余 PRD 目标类型明确返回能力未开放，避免伪造成功。
- `MediaReference` 创建、排序修改和解除引用同步维护草稿的 `media_reference_ids_json` 与乐观版本；删除语义为 `unlinked`，不物理删除资源或历史记录。
- EvidenceDraft 已实现创建、读取、修改、字段绑定、证据附件、完成和撤回。EvidenceDraft 身份、目标与来源类型创建后不可改，内容修改均形成 append-only snapshot。
- 普通用户首期只可声明 `trusted_external_source`；平台事实仅平台编辑/管理员可创建；`verified_author_statement` 在作者身份关联能力真正上线前明确关闭。
- 外部证据 URL 复用 SSRF 防护解析器；完成时生成确定性摘要和置信度，并复检附件可用性与可见性边界。
- MediaReference 与 EvidenceDraft 的写操作均要求登录、同源、CSRF、账号可写、owner 鉴权、幂等键和数据库审计。
- 新增迁移 `000018_media_and_evidence_drafts.sql`，OpenAPI 当前为 46 paths / 54 operations；PostgreSQL fixture 覆盖引用重放、排序、解除引用、证据绑定、附件隔离、完成、撤回、快照和审计。

### 明确未开放

- `OP-MEDIA-CREATE`、分片上传和上传完成尚未连接真实对象存储及恶意文件扫描服务；Render 的 `MEDIA_ENABLED`、`EVIDENCE_ENABLED` 默认均为 `false`，不得把控制面存在解释为生产上传能力已经可用。
- 当前没有网页正文抓取、自动截图、OCR 或自动证据提取；这些能力继续受 TBC-004 的合规与供应商决定约束。
- 尚未创建 Submission、审核工作项或公开 Project；EvidenceDraft/MediaReference 只是 WP-04D 提交事务可校验的正式前置对象。

## 当前迭代：WP-04D 预览冻结与提交审核事务

状态：实现完成；远端已执行到 Submission entry fixture。失败原因是 fixture 选择了不同品类的首个 Project，却按 Portfolio 检查精确重复；领域实现未失败，fixture 已增加同品类过滤并等待复验。

### 已实现

- `OP-DRAFT-PREVIEW`：按 owner、草稿版本和 check_id 生成服务端预览；预览不依赖客户端计算，哈希绑定 draft/version/check/input_hash、规范 ProjectSnapshot、权威 MediaReference ID 和 EvidenceDraft ID。
- 双品类提交均复用版本化 Catalog Schema 做严格字段校验；Portfolio 仅在 15 个必填字段类型完整时通过，`navigation_pattern` 与 `homepage_sequence` 保持可空/可空数组；ProjectCore 将冻结字段 `access_status` 纳入版本快照契约。
- 预览与提交都实时复检 URL check 未过期、风险允许、页面可访问、当前无规范 URL 重复；超时后不可沿用旧 preview_hash。
- MediaReference 以活动关系记录为权威事实，并与草稿绑定 ID 投影逐项对账；所有活动引用必须解析到 owner 的 `ready+clean+guard=null` Resource，且至少一项有序 role=cover，与 payload 的封面 ID 完全一致。
- EvidenceDraft 以草稿绑定 ID 集合作为提交边界，再逐项核对 parent/owner/status；至少一项且全部为 ready；活动附件必须属于 owner 且 Resource 仍为 `ready+clean+guard=null`。撤回证据会从父草稿原子解除绑定，避免残留 ID 永久阻塞提交。
- `OP-SUBMIT` 要求 draft_version、check_id、preview_hash 与 submission_key；同 owner+submission_key 同载荷重放返回同一 Submission，异载荷复用返回 409。
- 提交在一个 PostgreSQL 事务内锁定所有前置对象，创建 `Submission/pending_review`、唯一 `ReviewWorkItem/queued`、`submission_owner` 冲突主体、`project_submitted` Outbox 和审计，然后把原 Draft 置为 submitted 只读。
- `project_submitted` payload 只含 draft_id、submission_id、submission_chain_id、category_id、result，不含 project_id 或自然人 ID；提交响应也不返回 project_id。
- 新增迁移 `000019_submission_preview_and_submit.sql`，Submission 冻结 media_reference_ids 与 preview_hash；OpenAPI 当前为 48 paths / 56 operations。
- 新增 PostgreSQL 事务 fixture，明确断言一次幂等提交只产生 1 个 Submission、1 个审核项、1 个 Outbox、0 个 Project，并验证提交者不能领取自己的审核项所需的冲突主体已经落库。

### 明确未开放

- 当前提交仅进入人工审核，不创建 Project、Version、Event、正式 Evidence、正式 MediaReference 或 AuthorRelation。
- changes_requested 后的 `OP-DRAFT-REVISE`、审核决定与 approved 后发布事务尚未开放。
- Media 上传面仍关闭时，生产环境不能凭空构造 ready Resource；本迭代只完成对真实前置对象的提交消费事务。

### 下一迭代

WP-04E：先完成 owner 撤回，再实现审核退回后的新 revision；随后进入审核决定和批准后发布事务，旧 Draft/Submission 保持不可变，不在旧对象上重开。

## 当前迭代：WP-04E1 提交者撤回

状态：实现完成；已提交远端 PostgreSQL 事务 fixture 验证。

### 已实现

- `OP-SUB-WITHDRAW` 只允许 Submission owner 对 `pending_review` 且 WorkItem 仍为 queued/claimed 的快照执行；approved、decided、rejected、changes_requested、withdrawn、publishing、publish_failed、published 均返回状态冲突，不猜测 `publish_failed` 是否开放给用户终止。
- expected_version 与 operation_id 同时参与幂等收据；相同 operation_id/相同载荷返回同一撤回结果，不同载荷复用返回 409。
- 单一事务把 Submission 写为 withdrawn、WorkItem 写为 cancelled、清理 claim/lease、追加 WorkItem cancelled 事件、写 `submission_withdrawn` Outbox 与审计；原 Draft、Submission payload、媒体和证据快照均不删除、不重开。
- 若 WorkItem 已领取，额外写内部 `review_assignment_cancelled` Outbox，供通知消费者定向通知原领取者；公共分析事件不携带该人员 ID。
- OpenAPI 当前为 49 paths / 57 operations；迁移 `000020_submission_withdrawal.sql` 增加 append-only 语义的操作收据。

## 当前迭代：WP-04E2 退回修改与修订链

状态：实现完成；等待远端 PostgreSQL 事务 fixture。

### 已实现

- `OP-DRAFT-REVISE` 只允许 Submission owner 对 `changes_requested` 且 expected_submission_version 一致的快照创建一次后继草稿；路径与 body 的 base_submission_id 必须一致。
- 创建前由服务端自动重跑规范 URL 的 SSRF 安全、可访问性、品类和公开作品精确查重，不复用超过 30 分钟的审核前检查；失败时不创建半成品修订草稿。
- 新草稿沿用 submission_chain_id，revision 加一，并分别写入 supersedes_draft_id 与 base_submission_id；数据库唯一约束保证同一退回 Submission 最多产生一个后继草稿。
- 原 Submission、原 Draft、原 MediaReference 与原 EvidenceDraft 均保持只读。媒体只复制引用并复用已扫描 Resource；封面 ID 在 payload 中原子替换为新引用 ID。
- 证据复制为绑定新草稿的 editing EvidenceDraft，并复制活动附件引用；用户必须重新核对并完成证据，不能把旧审核快照无条件视为新提交的 ready 证据。
- 创建事务同时写 `submission_revision_draft_created` Outbox 与 `OP-DRAFT-REVISE` 审计；client_request_id 同载荷重放返回同一草稿，异载荷复用返回 409。
- 修订草稿再次通过 preview/submit 后生成新的 Submission；新快照写入 supersedes_submission_id 指向被退回 Submission，完整保留 chain，旧快照不覆盖。
- OpenAPI 当前为 50 paths / 58 operations；迁移 `000021_submission_revision_drafts.sql` 增加 base_submission_id 的唯一后继约束。
- 新增 PostgreSQL 事务 fixture，覆盖修订幂等、媒体与证据复制、封面 ID 重写、旧对象不可变、Outbox/审计唯一，以及再次提交后的 Submission 前后继关系。

### 明确未开放

- 审核决定写入仍未开放；本迭代 fixture 只构造已合法进入 changes_requested 的前置状态，用于验证修订事务，不提供绕过审核的公开 API。
- `approved` 后晋级 Project、Version、Event、Evidence 与公开 MediaReference 的发布事务尚未实现。

### 下一步

WP-04F：实现不可变 ReviewDecision 与 `OP-ADMIN-DECISION`，先覆盖 changes_requested/rejected/approved 的职责分离、原因码和并发决定边界，再进入批准后的发布 worker。

## 当前迭代：WP-04F0 后台高风险预览与确认边界

状态：实现完成，进入本地 PostgreSQL/远端质量门验证；尚未开放任何审核决定或事实写入。

### 已实现

- `OP-ADMIN-PREVIEW` 冻结 actor、主 session 哈希、roles_version、operation_type、目标集合、expected_versions、proposed_diff、原因、可选 claim 哈希与冲突主体版本；原始 session、claim 与 preview token 不写普通日志或数据库明文。
- 预览摘要使用稳定键序列化计算 diff/impact/confirmation SHA-256；服务端返回确定性影响摘要，preview token 为 256-bit 随机值，TTL 固定 10 分钟。
- `OP-ADMIN-CONFIRM` 在数据库锁内复检主 session、账户状态、roles_version、预览摘要和冲突主体版本。`recent_auth_at≤5分钟` 时直接签发；否则把预览标记为 `reauth_required` 并返回 `REAUTH_REQUIRED`，不得降级执行。
- 已被挑战的预览必须消费身份域签发且绑定同 actor、主 session、roles_version、preview 哈希的一次性 `AdminReauthGrant`；仅更新原主会话近期认证，不轮换 session。
- confirm token 绑定服务端 confirm_grant_id，通过 HMAC 确定性恢复；数据库只存 token 哈希。TTL 固定 120 秒，同 session+preview+confirm_request_id 重放返回同一 token，异会话/角色/摘要/冲突版本失败关闭。
- 新增 append-only 安全事件、不可删除审计、数据库形状约束和 PostgreSQL fixture；迁移为 `000022_admin_operation_security.sql`。
- OpenAPI 当前为 52 paths / 60 operations；API 仅接受登录编辑/管理员的同源 CSRF 请求，并把真实 session cookie 只传到服务端安全域做绑定哈希。

### 明确未开放

- confirm token 尚不能直接改变 Submission、WorkItem、Project 或其他领域事实；后续 `OP-ADMIN-DECISION`/`OP-ADMIN-EXECUTE` 必须在其业务事务内原子校验并消费，不能先消费再写事实，也不能绕过 preview/confirm。
- 本轮只完成通用安全控制面；ownership_case 的最新冲突集合重算、Creator Profile handoff、合并碰撞矩阵等资源专属 preview 校验仍由相应领域 handler 接入。

### 下一步

WP-04F1：实现 Submission 分支的不可变 `ReviewDecision v1` 与 `OP-ADMIN-DECISION`，要求有效 claim+preview+confirm，并把决定、Submission 审核态、WorkItem typed decision ref、Outbox 和审计写入同一事务。

## 当前迭代：WP-04F1 Submission 审核决定

状态：实现完成；进入远端 PostgreSQL 事务 fixture 验证。

### 已实现

- 新增迁移 `000023_review_decisions.sql` 与唯一不可变 `ReviewDecision v1`。决定按 WorkItem 唯一，另以 actor+work_item+decision_request_id 幂等；相同请求同载荷返回原决定，异载荷复用返回 409。
- `OP-ADMIN-DECISION` 首个正式 handler 仅开放 `work_type=submission,target_type=submission`，只接受 `approve|changes_requested|reject`；Submission 分支强制 `project_id/base_version_id=null`，branch-specific `decision_payload` 必须为空对象。
- `changes_requested` 必须给至少一个 JSON Pointer field_path；field_paths 与 decision_evidence_refs 规范化、去重并参与 decision_payload_hash，引用的正式 Evidence 必须存在。
- 提交事务先锁并重检当前 session/roles_version、WorkItem expected_version、领取者、60 秒 lease、claim 哈希、职责冲突、Submission pending_review、preview 目标/版本/差异/原因绑定和 confirm 绑定/TTL。
- `approve` 额外重检冻结的 EvidenceDraft 仍为 ready，MediaReference 仍 active 且 Resource ready+clean、无 deletion guard；任何失败均不消费 token、不写部分决定。
- 成功事务原子创建 ReviewDecision，把 Submission 写为 approved/changes_requested/rejected，把 WorkItem 写为 decided 并反指 typed decision ref，同时消费 confirm+preview、追加安全事件/WorkItemEvent/审计与单一 Outbox。
- approve 只发出 `submission_approved` 发布任务，不创建 Project、Version、Event、正式 Evidence 或正式 MediaReference。OpenAPI 当前为 53 paths / 61 operations。
- PostgreSQL fixture 覆盖决定唯一性、同载荷回放、异载荷冲突、决定不可更新、token 一次消费、Outbox/事件/审计唯一，以及 Project 数量不变。

### 明确未开放

- `approved` 后的 Project/Version/Event/Evidence/MediaReference 发布事务仍未实现；公共目录不会因审核批准立即出现作品。
- ProjectUpdate、Verification、Ownership、Evidence、Recheck、Relation、Community 和 CreatorProfile 的 ReviewDecision 分支仍关闭，不能通过 Submission handler 传入其他 target/decision/payload。

### 下一步

WP-04G：实现批准后的 Submission 发布 worker，在独立幂等事务中创建 Project V1、Version、Event，晋级 Evidence/MediaReference，并把 Submission 从 approved 推进到 publishing/published 或 publish_failed。
