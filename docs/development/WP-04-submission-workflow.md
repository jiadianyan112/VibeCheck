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

## 当前迭代：WP-04G 审核通过后的正式发布事务

状态：实现完成；GitHub Actions `31673662696` 已在 PostgreSQL 18 通过全部质量门与事务 fixture。

### 已实现

- worker 只消费绑定 `aggregate_type=submission` 的 `submission_approved`，并复核 payload 的 submission_id 与 aggregate_id 完全一致；畸形或跨 aggregate 事件不进入领域事务。
- 发布先把 `approved/publish_failed` 推进为 `publishing` 并累加 attempt；worker 崩溃后可从 publishing 恢复。领域失败单独写 `publish_failed+last_error_code`，不会遗留半成品公开事实。
- 成功事务重新锁定 Submission、不可变 approve ReviewDecision、decided WorkItem、submitted Draft、URL check、全部 EvidenceDraft/附件及 MediaReference/Resource；审核后被撤销、感染、进入删除 guard 或版本错位的依赖会使整个事务回滚。
- 单一事务创建 `published_platform`、`record_source=user_submission`、`author_link_status=unlinked` 的 Project，显式 V1、first_published Event、正式 Evidence/附件及只读 project_version MediaReference；封面 ID 在 Version snapshot 中替换为正式引用 ID。
- EvidenceDraft 按稳定 ID 顺序一对一晋级并绑定同一 ReviewDecision；project/version/event/asset 目标在事务内解析。资产必须存在对应 asset_draft_key Evidence，关系目标在 Submission 发布分支拒绝。
- `submission_publication_receipts` 以 submission_id 唯一、不可更新/删除；重复 Outbox 投递返回同一 Project/Version/Event/transaction，不重复写 Project、证据、媒体、事件或 `project_published` Outbox。
- 发布成功后 Submission 原子写入 published、resulting_project_id、promoted_evidence_ids 和 published_at；不创建 Creator、AuthorRelation 或作者权限，已有档案作者关联仍只走低频人工验证。
- 迁移 `000024_submission_publication.sql` 同时把历史 Version decision type 从旧原型枚举收敛为 `review_decision|admin_fact_decision|system_fact_decision`；现有 fixture 已迁移到正式枚举。
- PostgreSQL fixture 验证单一 Project/V1/Event/Evidence/Attachment/正式媒体/收据/Outbox、封面 ID 重写、零 AuthorRelation、同决定幂等回放和异决定冲突；worker 单测覆盖事件 aggregate 绑定。

### 后续边界

- `project_published` 的搜索文档刷新、站内通知和可观测消费收据进入下一工作包；正式事实发布不依赖这些异步投影成功。
- asset safe_web_url 的审核前 DNS/重定向安全收据尚未形成独立草稿能力；在该入口开放前不得把人工构造的 asset_drafts 当作受信输入。
- ProjectUpdate、作者验证、Ownership、关系与社区等其余 ReviewDecision 分支继续关闭，不能复用 Submission 发布器绕过各自状态机。

## 当前迭代：WP-04H1 发布后的搜索投影

状态：实现完成；GitHub Actions `31674309172` 已在 PostgreSQL 18 通过全部质量门与投影 fixture。

### 已实现

- worker 新增独立 `project_published` handler，强制 `aggregate_type=project` 且 aggregate_id 与 payload project_id 一致；事件必须同时携带 project/version/submission/review_decision 四个稳定 ID。
- 索引事务从 `submission_publication_receipts` 回查发布来源，并复核 Submission 已 published、Project 仍公开、ReviewDecision 为 approve；不能用客户端事件载荷单独构造搜索文档。
- 搜索结构化字段和全文文本统一调用 catalog 的版本化 ProjectSnapshot validator 与 `buildSearchDocument`，不在 worker 复制第二套字段规则，也不扩写资料中不存在的事实。
- `search.project_documents` 按 Project 幂等 UPSERT；同版本重放不重写，延迟旧事件会读取并索引 Project 当前 Version，版本号 CAS 禁止旧投影覆盖更新版本。
- 同一投影事务初始化可重建的 project_interaction_counters；已存在计数绝不归零或覆盖。
- 搜索投影失败只让 `project_published` Outbox 重试，不回滚或降级已发布 Project。worker 统一沿用 60 秒处理租约、最多 8 次指数退避和 dead-letter 边界。
- 发布 PostgreSQL fixture 已扩展为搜索文档/正式 Version 一致性、互动计数唯一和同版本投影回放验证；worker 单测覆盖跨 Project aggregate 拒绝。

### 下一步

WP-04H2：建立 P0 站内 Notification 存储、用户隔离读取与幂等已读最终态，再让 `project_published` 为 Submission owner 写发布成功通知；站外邮件不进入 P0。

## 当前迭代：WP-04H2 发布成功站内通知

状态：实现完成；GitHub Actions `31704714020` 已在 PostgreSQL 18 通过全部质量门、迁移与通知事务 fixture。

### 已实现

- 新增迁移 `000025_notifications.sql`，建立独立 Notification 事实与已读操作收据；通知正文、接收者、目标、事件和创建时间不可修改或删除，`read_at` 只允许从空值推进一次且不可撤销。
- 首个 P0 通知类型固定为 `submission_published`。worker 在完成发布搜索投影后，依据不可变 publication receipt、published Submission 和 Project 当前名称，为 Submission owner 写一条发布成功通知；同一 Submission 重放通过接收者加 dedup_key 唯一约束返回同一通知。
- 通知列表必须登录，服务端只按 session user_id 查询，不接受客户端 recipient_user_id；默认 30 条、最多 100 条，未读优先并使用绑定用户和筛选条件的 HMAC keyset cursor，返回该用户全局未读数。
- `PUT /api/v1/notifications/read-state` 只接受 `read=true`，可指定 1–100 个通知或 `scope=all`；同源和 CSRF 必须通过。指定列表含非本人或不存在 ID 时整批返回 404，不泄露归属，也不产生部分更新。
- 已读操作按 user_id、operation_id 和请求哈希写不可变收据；同载荷重放返回原响应，异载荷复用返回 409。受限账号仍可读取并清除自己的通知未读状态，但不能借此执行任何领域写入。
- OpenAPI 当前为 55 paths / 63 operations；API、worker 单测覆盖 session/CSRF、参数绑定、事件 aggregate 绑定与索引后通知顺序。
- 新增 PostgreSQL fixture，依赖真实批准发布结果，验证通知来源绑定、重复投递唯一、接收者隔离、跨用户已读拒绝、已读最终态及操作收据幂等。

### 明确边界

- 本轮只提供站内通知，不发送发布成功邮件、短信、Webhook 或推送；站外渠道、重试期限和供应商继续待产品/技术确认。
- 通知目标即使后续不可访问，历史通知仍保留并允许显式标记已读；列表接口不伪造目标可访问状态，前端访问目标时以 catalog 实时鉴权结果为准。
- 通知不属于 Interaction，不参与收藏、点赞、关注或评论计数；通知读取也不改变 Project、Submission、Event 或作者身份事实。
- 登录继续只保留账号状态，本轮没有增加游客通知、游客比较合并或登录后状态选择。

### 下一步

WP-04I：收紧 Submission asset_drafts 的审核前安全边界；在 safe_web_url 具备 DNS、重定向与可访问性审计收据前，生产入口不得接受非空外部资产草稿。随后进入 ProjectUpdate 与作者身份验证的独立状态机实现。

## 当前迭代：WP-04I 外部资产提交安全闸门

状态：实现完成；GitHub Actions `31705527131` 已在 PostgreSQL 18 通过全部质量门与安全闸门 fixture。

### 已实现

- `asset_drafts` 字段及后续正式能力保持冻结，但当前 OpenAPI 明确 `maxItems=0`；尚未形成逐资产安全收据前，前端和任何 API 客户端都不能把非空外部资产草稿视为可提交输入。
- preview/submit 在读取同一锁定 Draft 快照时复检 `asset_drafts_json`：非数组是服务端事实损坏，非空数组返回 `SUBMISSION_ASSET_SECURITY_RECEIPT_REQUIRED`，不生成 preview audit、Submission、WorkItem 或 Outbox。
- 新增迁移 `000026_submission_asset_security_gate.sql`，数据库在 Draft 推进到 submitted 的同一事务内再次拒绝非空资产草稿，避免遗漏服务层检查形成旁路。
- changes_requested 修订链在复制旧 Draft 前执行同一闸门；含旧版未收据资产的 Submission 不会把风险输入复制到新草稿。
- 发布 worker 对历史或内部绕过公共提交路径形成的非空资产草稿失败关闭，写 `publish_failed`，不创建 Project、Asset、Evidence、Version 或部分公开事实。
- PostgreSQL 提交 fixture 先写入未收据外链，验证 preview 422 与数据库状态迁移拒绝，再清空字段并证明原有无资产发布流程正常完成。

### 保持关闭

- 本轮不创建临时的“已安全”布尔值，也不把作品 URL 的 check_id 复用于 Asset；每个 Asset 未来必须有绑定规范 URL、DNS 答案、逐跳重定向、HTTP 结果、检查时间、过期时间和输入哈希的独立不可变收据。
- robots、版权合规、正式网络资源阈值与责任人仍按 TBC-004 待确认；确认前不开放外部资产草稿写接口，不删除冻结字段或降低最终产品需求。

### 下一步

WP-05A1：先部署 ProjectUpdate 必需的固定 LinkPermissionProfile 并建立跨服务 fail-closed 校验；随后实现 CreatorAccountLink/AuthorRelation 授权解析，不能从前端角色或旧原型 creatorId 推断作者权限。

## 当前迭代：WP-05A1 固定作者权限档案基线

状态：实现完成；GitHub Actions `31706829447` 已在 PostgreSQL 18 通过全部质量门与 Profile 部署校验；尚未给任何用户授予作者权限。

### 已实现

- 新增迁移 `000027_link_permission_profiles.sql`，P0 只部署不可变 `OWNER_V1` 与 `MANAGER_V1` 两条记录，不提供创建、更新、停用、迁移或 V2 接口。
- 两条 Profile 共用 PRD 冻结的 43 个 `AUTHOR_CONTENT_P0_V1` exact JSON Pointer；owner 能力固定为 ownership.view/project_update.create/project_update.submit，manager 不含 ownership.view。
- 数据库函数、catalog 领域模块分别按五字段、数组 Unicode code point 排序去重、无空白 UTF-8 JSON 和 SHA-256 独立重算；结果必须精确等于 PRD 固定 hash，否则迁移或服务启动失败关闭。
- API 与 worker 均在接收流量/消费事件前读取数据库并独立复核恰好两条 Profile 的 ID、family、version、集合和 hash；仅保留 hash 文本但篡改能力或字段路径同样返回 `LINK_PERMISSION_PROFILE_INVALID`。
- PostgreSQL fixture 验证数据库重算值、43 路径和不可更新/删除触发器；单测验证数组顺序不影响规范 hash、字段或能力漂移必然阻断。

### 明确未授权

- 本轮没有 CreatorAccountLink 表、VerificationRequest 审批或 ProjectUpdate 写 API，因此 Profile 记录本身不能授予权限。
- 下一步必须沿 session user→active CreatorAccountLink→exact Profile→canonical Creator→active AuthorRelation 解析，并取 Profile ceiling 与 Relation fields 交集；不得只凭 identity role=verified_author 放行。

### 下一步

WP-05A2：建立 CreatorAccountLink 的不可变来源、owner 条件唯一键和授权只读解析器，再为 VerificationRequest 审批与 ProjectUpdate 创建提供同一后端授权链。

## 当前迭代：WP-05A2 CreatorAccountLink 与作者授权解析

状态：实现完成；GitHub Actions `31707544024` 已在 PostgreSQL 18 通过全部质量门、Link 约束与授权链 fixture；没有开放 Link 写 API。

### 已实现

- 新增 `catalog.creator_account_links`，Link 的 user、canonical Creator、role、固定 Profile exact ref 与来源验证 ID 创建后不可改；terminated 为不可恢复终态且记录不可删除。
- `user+canonical creator` 最多一条 active/suspended Link；同 canonical Creator 最多一条 active/suspended owner Link，suspended 仍占 owner 唯一集合，防止争议期间旁路提权。
- Link role 必须与 Profile family 一致，Profile ID/version/config_hash 使用数据库外键精确绑定；merged Creator 不能接收新 Link。
- 新增只读 `PostgresAuthorAuthorizationResolver`：仅连接 active Link、数据库固定 Profile、canonical Creator 和目标作品 active AuthorRelation；不读取或信任 `verified_author` 角色、前端 creatorId 或前端权限数组。
- 每条授权 Grant 分别返回 Link/Relation 版本；有效字段只取 Profile `field_path_ceiling` 与 Relation `field_permissions_json` 的 exact JSON Pointer 交集，能力也必须来自同一条完整 Grant，不能跨 Creator 拼接提权。
- PostgreSQL fixture 验证完整 active 链、字段交集、owner 条件唯一键与 role/Profile 不匹配拒绝；领域单测验证无完整链 403 和配置漂移 503。

### 明确未授权

- Link 仅允许未来 VerificationRequest approve 领域事务内部创建；本轮没有公共/作者/后台 Link POST/PATCH/DELETE。
- 本轮不创建测试之外的生产用户授权；`verified_author` IAM role 单独存在时仍无 P13 写权限。
- Link suspend/restore/terminate 的服务入口留给 OwnershipCase 裁定事务，不能用通用 CRUD 绕过。

### 下一步

WP-05A3：实现 ProjectUpdate editing 草稿的创建、读取、字段级 PATCH 与预览，只接受 WP-05A2 授权解析器返回的 `project_update.create` 和 exact field paths；提交审核与应用事务分后续小步交付。

## 当前迭代：WP-05A3 ProjectUpdate 草稿与预览

状态：实现完成；GitHub Actions `31709324032` 已在 PostgreSQL 18 通过全部质量门、草稿授权与公开事实隔离 fixture。

### 已实现

- 新增 `catalog.project_updates` 与 append-only `project_update_operations`；状态轴完整预留，但本轮 API 只产生/修改 `editing`，不伪造 update_pending、审核决定或公开 Version。
- `POST /api/v1/project-updates` 只从认证 session 注入 owner；要求目标为 published_author、请求 base_version 等于当前 Version，并通过 WP-05A2 完整授权链的 `project_update.create`。
- `GET /api/v1/project-updates/{update_id}` 仅 owner 可读；权限后续失效时仍保留本人草稿投影，但 `authorization_state=revoked` 且不允许继续写或预览。
- `PATCH /api/v1/project-updates/{update_id}` 拒绝客户端 user/creator/role/permission 输入；每个 exact JSON Pointer 必须由同一条 active Link/Profile/Relation Grant 同时覆盖，不能跨 Grant 拼接权限。
- `before_after.before_value` 只从创建时冻结的 base Version snapshot 派生，不信任客户端 before 值；PATCH 仅保存草稿，不更新 Project、Version、Event、Asset 或公开检索。
- EvidenceDraft 必须 owner/parent_type=project_update/parent_id=update_id 且 editing/ready；MediaReference 必须绑定同一 update_id、owner resource、active、ready+clean 且无删除 guard；预览时再次检查，阻止状态变化后的陈旧引用。
- PATCH 使用 expected_version 乐观锁和 `update_id+owner+operation_id` 不可变 receipt；同键同载荷（含并发）回放同一结果，同键异载荷 409。创建请求同样具有并发幂等保护。
- `POST /api/v1/project-updates/{update_id}/preview` 重检 base/current、完整当前授权链、全部字段与引用，非空草稿才返回绑定 exact draft version 的 SHA-256 preview_hash。
- OpenAPI 增加 OP-UPD-CREATE/GET/PATCH/PREVIEW，当前为 58 paths/67 operations；API 测试覆盖 CSRF、session owner 注入和客户端伪造权限字段拒绝。

### 明确未授权

- 本轮没有 OP-UPD-SUBMIT/RESUME/WITHDRAW，也不创建 project_update ReviewWorkItem；preview_hash 尚不能换取审核提交。
- 没有 approved→applying→applied worker；公开 Project.current_version_id/current_name、Event、Evidence 和 Media 正式引用保持不变。
- 当前 update_type 仅沿用已确认 P13 原型的 version/address/status/asset/description 输入集合；具体提交谓词仍由后续 Evidence/URL/Asset 分支逐类收紧。

### 下一步

WP-05A4：实现 OP-UPD-SUBMIT 与 OP-UPD-WITHDRAW，原子创建/取消唯一 work_type=project_update 的 ReviewWorkItem，冻结提交快照并保证 A05 submission 队列无法混入该类型；仍不在该轮应用公开 Version。

## 当前迭代：WP-05A4 ProjectUpdate 提交与撤回

状态：实现完成；GitHub Actions `31710438007` 已在 PostgreSQL 18 通过全部质量门与提交/撤回事务 fixture。

### 已实现

- 新增 `POST /api/v1/project-updates/{update_id}/submit`：先以 exact version 重新生成并比对 preview_hash，再要求同一完整 Grant 同时具有 `project_update.submit` 与全部字段权限。
- submit 在同一数据库事务内把 Update 从 editing 迁移到 update_pending、冻结最新授权快照、创建唯一 `(work_type=project_update,target_type=project_update,target_id=update_id)` queued WorkItem，并写提交者 conflict principal。
- 提交者因此无法领取/审核自己的更新；A05 以 work_type 过滤，submission 队列不会返回 ProjectUpdate 工作项。
- 新增 `POST /api/v1/project-updates/{update_id}/withdraw`：editing 可直接撤回；update_pending/changes_requested/apply_failed 按状态机撤回；如存在 queued/claimed 未决定 WorkItem，同事务清空 lease 并取消。
- submit/withdraw 都使用不可变 operation receipt；同键同载荷回放原结果，同键异载荷 409。已决定工作项不能被作者撤回覆盖。
- PostgreSQL fixture 覆盖 pending 工作项类型、提交者冲突主体、撤回取消和全过程公开 Project.current_name/current_version_id 不变。
- OpenAPI 当前为 60 paths/69 operations；本轮仍未提供审核决定后的 Version 应用能力。

### 明确未授权

- submit 只排队，不创建 ReviewDecision、Version、Event、正式 Evidence/Media 或 project_updated。
- 审核批准仍须后续 WP-05A5 复用现有 ReviewDecision 安全令牌链；批准后应用事务另由 WP-05A6 worker 完成。
- 普通作者不能通过 withdraw 取消已经 decided 的工作项或回滚 applied 更新。

### 下一步

WP-05A5：扩展 ReviewDecisionService 的 project_update 分支，只允许无利益冲突且持有效 claim/preview/confirm 的编辑或管理员执行 changes_requested/reject/approve；决定事务不直接创建 Version。

## 当前迭代：WP-05A5 ProjectUpdate 审核决定

状态：实现完成；GitHub Actions `31713919359` 已在 PostgreSQL 18 通过全部质量门与 Submission/ProjectUpdate 决定事务 fixture。

### 已实现

- 既有 `POST /api/v1/admin/work-items/{work_item_id}/decision` 已扩展为 Submission/ProjectUpdate 共用入口；服务端从锁定 WorkItem 决定分支，不接受客户端 work_type、project_id 或 base_version_id 作为权限来源。
- ProjectUpdate 只接受 `(work_type=project_update,target_type=project_update)`、`update_pending` 且 `review_work_item_id` 完全匹配的目标；提交者 conflict principal 与 owner 复核形成双重利益冲突阻断。
- approve、changes_requested、reject 分别原子推进为 approved、changes_requested、rejected；changes_requested 仍强制至少一个 JSON Pointer，决定 payload 在 V1 必须为空对象。
- 审核决定继续复用 claimed WorkItem、未过期 lease、一次性 preview、recent-auth/step-up confirm 和同 session/actor/roles_version 绑定；ProjectUpdate preview 固定为 `project_update_review`、目标 update_id、Update/WorkItem 双版本和最终状态 diff。
- 同一事务写不可变 ReviewDecision、领域状态、decided WorkItem、WorkItem event、confirm-consumed security event、Outbox 与审计日志，并消费 preview/confirm；任何一步失败全部回滚。
- 新增迁移 `000031_project_update_review_decisions.sql`，数据库要求 ProjectUpdate 决定携带从服务端事实读取的 project_id/base_version_id，并限制决定与 resulting_status 的精确映射。
- approve 只把 Update 置为 approved 并产生 `project_update_approved` Outbox；本轮不创建 Version、不修改 Project.current_version_id/current_name，也不启动应用事务。
- OpenAPI 仍为 60 paths/69 operations；响应现在按工作类型返回 nullable project_id/base_version_id，Submission 分支保持 null。
- PostgreSQL fixture 同时验证 Submission 与 ProjectUpdate 决定、令牌消费、不可变记录、ProjectUpdate 的 project/base 绑定，以及批准前后公开 Version 数量和 current_version_id 不变。

### 下一步

WP-05A6：由 worker 消费 `project_update_approved`，重新锁定批准决定、Update、base/current Version 和全部依赖，按乐观并发规则创建新 Version/Event 并切换 Project 当前版本；失败进入 apply_failed，重复投递必须返回同一应用收据。

## 当前迭代：WP-05A6 ProjectUpdate 原子应用

状态：实现完成；GitHub Actions `31714707438` 已在 PostgreSQL 18 通过全部质量门、迁移、原子应用与幂等收据 fixture。

### 已实现

- worker 新增 `project_update_approved` handler，只接受 aggregate_type/project_update、aggregate_id、payload.update_id 与 review_decision_id 完全一致的内部事件；事件不能携带客户端自定 Project/base/权限事实。
- 应用器先按 update_id 取得数据库 advisory lock，再分别执行 approved/apply_failed→applying 和 applying→applied；同一 Update 的并发及重复投递串行化，已存在不可变收据时返回同一结果，决定 ID 不同则拒绝。
- 应用事务重新锁定并交叉校验 ReviewDecision、decided WorkItem、ProjectUpdate、Project.current_version_id 和 base Version；任一 target/project/base/work item/decision/status 不一致即 fail closed。
- 应用时重新解析当前 active CreatorAccountLink、固定 LinkPermissionProfile、canonical Creator 与 AuthorRelation exact refs；Link/Relation/Profile 版本变化、撤销或字段/能力交集失效均拒绝，不信任提交时快照继续授权。
- 非空 diff 使用冻结 base snapshot 重验 before/after 和 JSON Pointer，再按原品类 Schema 验证完整新快照；本轮 URL 改动在缺正式安全收据时 fail closed，不以简单字符串替换改变 canonical URL。
- 同一事务创建不可变 ProjectVersion（source_decision=ReviewDecision）、派生 version_updated Event、正式 project_version MediaReference、最终 Evidence/Attachment，切换 Project.current_version_id/current_name/access_status，推进 Update=applied，并写不可变应用收据、project_updated Outbox 与审计日志。
- 任一步失败时应用事务全部回滚，不留下半 Version/Event/Evidence/Media/Project 指针；外层把仍为 applying 的 Update 推进为 apply_failed 并记录稳定错误码，允许按同一批准决定安全重试。
- 新增迁移 `000032_project_update_application.sql`，补充应用错误字段、不可变应用收据，并用数据库触发器校验 ReviewDecision→WorkItem→ProjectUpdate→Project/base Version 的 typed source chain。
- PostgreSQL fixture 覆盖新版本与 Project 指针原子切换、旧 Version 不变、收据不可变、重复投递幂等、错误决定拒绝、Event/Outbox 唯一以及公开名称更新；worker 单测覆盖事件与 aggregate 绑定。

### 明确未授权

- 本轮不开放任何“直接应用”HTTP API；作者、编辑和管理员均不能绕过批准决定调用应用器。
- address 更新仍需后续 URL 安全收据链；asset/relation 目标的 Evidence 与 ReusableAsset 变更继续 fail closed，不以不完整对象上线。
- `project_updated` 的搜索重建、关注者通知与 service analytics v2 投影由后续异步消费者完成；应用事务只提交可重放 Outbox，不在事务内调用外部服务。

### 下一步

WP-05A7：实现 `project_updated` 投影消费者，使用当前 Version 重建搜索文档，并按关注关系生成收件人隔离且幂等的作品更新通知；随后进入作者身份验证申请与 Link 创建的低频审核分支。

## 当前迭代：WP-05A7 ProjectUpdate 搜索与通知回流

状态：实现完成；GitHub Actions `31715633531` 已在 PostgreSQL 18 通过全部质量门、搜索投影与收件人隔离通知 fixture。

### 已实现

- worker 新增 `project_updated` v2 handler；当前只接受 source_type=project_update、initiator_type=verified_author、update_type=author_content_update、result=success 的已实现作者分支，并强制 aggregate/project/version/update/decision/Event 全字段绑定。
- 搜索投影器从不可变 ProjectUpdateApplicationReceipt 反查 applied Update、批准决定、Version 与 Event，不信任 Outbox payload 作为公开内容源；按 Version Schema 重建结构化文档和全文检索字段。
- 搜索 upsert 只允许更高 version_number 覆盖；重复事件返回 already_current，乱序旧事件返回 already_newer，均不会把检索结果降级到旧 Version。
- 关注通知只从 `community.project_interactions(type=follow,state=true)` 生成；每个 recipient+`project_updated:{update_id}` 唯一，重复投递不重复创建，且通知目标绑定 Project 与本次 Event。
- NotificationType/OpenAPI 增加 `project_updated`，P16 既有归属校验、游标、未读计数与 read-state 幂等接口继续复用，不向其他账户泄露通知。
- PostgreSQL fixture 创建明确关注者后验证搜索 Version/名称更新、单收件人单通知、未读状态和重复投递幂等；worker 单测验证先索引后通知以及跨 aggregate/非作者分支拒绝。

### 明确未授权

- A03 admin_project_edit 与 system_job 虽属于冻结的 project_updated v2 联合类型，但对应事实事务尚未实现；当前 handler 明确拒绝，不能伪造成作者更新。
- service analytics v2 的 metric subject 三元组仍须 WP-06 身份桥服务完成；本轮 Outbox 不写自然人 ID，也不以 reviewer/worker 代替作者指标主体。
- 站外邮件/短信/推送未获产品渠道与重试策略确认；本轮只创建站内通知。

### 下一步

WP-05B1：实现已有作品“我是作者”的 VerificationRequest/VerificationMaterial 私密申请链；申请只进入低频人工审核，不自动授予 CreatorAccountLink，也不创建重复 Project。

## 当前迭代：WP-05B1 VerificationRequest 私密草稿链

状态：实现完成；GitHub Actions `31717355151` 已在 PostgreSQL 18 通过全部质量门、迁移与 VerificationRequest 事务 fixture。

### 已实现

- 新增 `POST /api/v1/verification-requests`、`GET/PATCH /api/v1/verification-requests/{verification_id}`，只返回申请人安全投影，不返回 applicant_user_id、材料内部状态、存储引用或审核令牌。
- 创建草稿按 applicant+project 取得数据库事务锁，同一申请链只允许一个 draft/pending/changes_requested；首次必须 supersedes=null，未来 failed/withdrawn 重提必须显式指向最新终态，verified 阻止新建。
- 创建和自动保存分别使用申请人作用域幂等键与不可变操作收据；同键同载荷回放原结果，同键异载荷 409；PATCH 使用 expected_version 乐观锁。
- 三种 Creator 解析严格互斥：use_existing_link 只接受当前用户 active Link；create_new_creator 要求 1–80 字 display_name 并固定 owner/OWNER_V1；claim_existing_creator 只接受公开 canonical Creator、拒绝本人已有 active Link，并按 owner 集合计算 owner/manager provisional policy。
- provisional policy 只引用部署基线中的 OWNER_V1/MANAGER_V1 exact ref；本轮不冻结 submit policy，不创建 Creator、CreatorProfileVersion、CreatorAccountLink 或 AuthorRelation。
- 新增迁移 `000033_verification_request_drafts.sql`，包含 VerificationRequest、草稿操作收据、active-chain/幂等/supersedes 唯一约束、终态不可变和状态迁移触发器。
- OpenAPI 增至 62 paths/72 operations；Workflow 单测覆盖安全投影、输入校验和先鉴权后解析，PostgreSQL fixture 覆盖创建/重放/自动保存/越权/活动链唯一及零公开事实写入。

### 明确未授权

- 本轮不提供 VerificationMaterial prepare/complete/read-grant，不允许浏览器或通用媒体服务保存私密身份材料。
- 本轮不提供 OP-VER-SUBMIT/补充/撤回，也不创建 verification ReviewWorkItem、ReviewDecision 或业务埋点 `author_verification_started`；该事件只在后续成功提交 pending 时产生。
- 创建或保存草稿不会改变 Project.review_status/author_link_status/current_version_id，不会自动授予任何作品管理权限，也不会创建重复 Project。

### 下一步

WP-05B2：实现隔离的 VerificationMaterial 控制面、申请人粗粒度扫描投影、prepare/complete/revoke 与过期/扫描 worker；材料只绑定已存在的 draft verification_id，长期申请对象只引用稳定 material_id。

## 当前迭代：WP-05B2a VerificationMaterial 私密控制面

状态：实现完成；GitHub Actions `31724284272` 已在 PostgreSQL 18 通过全部质量门、第 34 个迁移与私密材料控制面事务 fixture。异步扫描与超时推进属于 WP-05B2b。

### 已实现

- 新增 `POST /api/v1/verification-materials`、`GET /api/v1/verification-materials/{material_id}`、`POST .../complete` 与 `POST .../revoke`；全部绑定真实 Session owner，写操作要求同源与 CSRF，客户端不能提交 owner、存储坐标或扫描结论。
- 新增独立 `@vibecheck/private-material` 边界与 `PrivateMaterialStorage` 端口。私密材料不进入通用 `media.media_resources`、浏览器持久存储或公开目录；稳定 storage key 使用 AES-256-GCM 加密后才写数据库。
- prepare 只允许 PDF/JPEG/PNG、单件 10 MiB、单申请最多 5 件且声明总量最多 30 MiB；上传地址固定 30 分钟过期，申请人作用域幂等键同载荷重放、异载荷冲突。
- complete 重新读取对象存储的 MIME、字节数和 SHA-256；声明不一致在同一事务持久化 rejected，合法对象只推进 uploaded、写一次 `verification_material_scan_requested` Outbox，并返回 pending，不伪造 clean/ready。
- complete/revoke 使用不可变操作收据；即使后续 worker 改变材料状态，重试仍回放首次申请人安全响应。revoke 先提交数据库终态再通知存储网关拒绝读取，网关失败返回可重试 503 且不回滚撤销事实。
- 申请人投影仅包含 material_id、verification_id、pending/accepted/rejected、稳定 reason/next_action、上传期限和版本；不返回加密存储键、detected MIME、原始扫描结果、重试次数或审核访问记录。
- 新增迁移 `000034_verification_material_control_plane.sql`，包含材料、不可变操作回执和不可变访问日志；数据库触发器限制状态迁移、终态写入与身份字段修改。
- OpenAPI 增至 66 paths/76 operations；单测覆盖安全投影、完成回执、MIME 拒绝和撤销失败，PostgreSQL fixture 覆盖 prepare/complete/revoke 幂等、单次扫描 Outbox、拒绝持久化与零通用媒体写入。

### 明确未授权与部署门

- 本轮不选择对象存储、签名上传或恶意文件扫描供应商；生产 `main` 不注入存储适配器，因此四个路由在未配置正式隔离网关前 fail closed 为 503，不能退回本地磁盘、公开媒体或仅凭浏览器 MIME 判断。
- 本轮不消费 `verification_material_scan_requested`，不产生 clean/ready；重试、三次上限、30 分钟处理截止、prepared 过期与内容保留删除由 WP-05B2b worker 实现。
- 本轮不提供审核员 read-grant/content-read，不提交 VerificationRequest、不创建 ReviewWorkItem，也不授予 CreatorAccountLink 或公开事实权限。

### 下一步

WP-05B2b：实现可租约、可重放的扫描/过期 worker 与存储隔离适配器配置；只有可信 scanner clean 回执可以推进 ready，超时和重试耗尽统一映射申请人 `processing_unavailable`。
