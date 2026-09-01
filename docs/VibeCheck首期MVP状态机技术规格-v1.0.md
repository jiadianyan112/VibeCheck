# VibeCheck 首期 MVP 状态机技术规格

**版本：v1.0｜状态：已批准开发基线（WP-00）｜日期：2026-08-10**

## 1. 文档目的

本文将 PRD v1.10 的领域状态下钻为服务端可执行的状态机。每条迁移绑定唯一 Command、触发主体、守卫条件、数据库事务、领域事件、通知和撤销方式。前端不得提交通用 `next_state`，后台也不得直接修改状态列。

## 2. 状态机执行协议

### 2.1 CommandEnvelope

所有状态迁移 Command 至少包含：

`operation_id,actor_context,target_id,expected_version,command_type,payload,request_id,occurred_at`。

后台高风险迁移还必须包含：

`claim_token?,preview_token,confirm_token,reason_code,decision_evidence_refs?`。

### 2.2 执行顺序

1. 查询 operation receipt；相同请求已提交则回放。
2. 验证 session/service identity、CSRF、角色和目的。
3. 锁定聚合根和必要的条件唯一键。
4. 验证 current state、expected_version、对象/字段 ACL、职责分离、利益冲突和 token。
5. 运行状态机 Guard；禁止从请求直接赋值状态。
6. 同事务写领域事实、决定、状态、计数、Outbox、审计摘要和 receipt。
7. COMMIT 后由 Outbox 消费者执行通知、索引、缓存和媒体/抓取异步动作。

### 2.3 失败原则

- Guard 失败返回403/409/410/422之一，领域状态不变。
- 数据库事务失败不产生半决定、半 Version、半 Evidence、半引用或已消费 token。
- 通知、索引或 Analytics 消费失败不回滚已提交业务事实；Outbox 重试。
- 状态机未列出的迁移一律422 `STATE_TRANSITION_NOT_ALLOWED`。
- 终态纠错通过新对象、新决定、新版本或替代链，不原地重开。

### 2.4 状态记录

每个可变聚合保存当前状态和 `version`。每次迁移写：

`transition_id,aggregate_type,aggregate_id,from_state,to_state,command_type,actor_type,actor_id?,reason_code?,decision_ref?,transaction_id,occurred_at`。

Transition Log 不替代领域 Event、ReviewDecision 或 AuditLog。

## 3. v1.9 复审状态机决策

| Decision ID | 问题 | 技术结论 |
| --- | --- | --- |
| TD-SM-001 | V19-01 | Recheck `needs_review→applied` 的 ReviewDecision 和 Version 同事务；Version 允许 review_decision/recheck_task 分支。 |
| TD-SM-002 | V19-02 | Ownership party 角色不是单状态；`party_roles[]` 是从案件来源事实派生的并集，allowed_actions 再按 Case/Request 状态收窄。 |
| TD-SM-003 | V19-04 | BridgeSnapshot、MetricRecomputeOperation、MetricVersion 分别有状态机；GET 绝不触发迁移。 |

## 4. SM-001 Submission 与首次发布

### 4.1 状态

- SubmissionDraft：`editing,submitted,withdrawn,expired`
- Submission：`pending_review,changes_requested,approved,publishing,published,publish_failed,rejected,withdrawn`

### 4.2 迁移

| Transition ID | From | Command | To | Actor | Guard | 同事务写入 | 事件/通知 | 撤销 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SM-001-T01 | Draft/editing | OP-SUBMIT | Draft/submitted + Submission/pending_review | owner | URL check≤30分钟；双品类 Schema；Portfolio 15必填；ready+clean媒体；ready EvidenceDraft；preview hash | Draft、Submission、WorkItem、Outbox | project_submitted；受理通知 | 最终决定前可撤回 Submission |
| SM-001-T02 | Submission/pending_review | OP-ADMIN-DECISION changes_requested | changes_requested | 非提交者编辑 | claim/preview/confirm有效；字段路径完整 | ReviewDecision、Submission、WorkItem | submission_changes_requested；通知提交者 | 决定不可改；新修订 Draft |
| SM-001-T03 | pending_review | OP-ADMIN-DECISION reject | rejected | 非提交者编辑/管理员 | 不可补正；reason_code | ReviewDecision、Submission、WorkItem | submission_rejected | 新建提交 |
| SM-001-T04 | pending_review | OP-ADMIN-DECISION approve | approved | 非提交者编辑 | 依赖仍有效；重复检查通过 | ReviewDecision、Submission、WorkItem、publish job Outbox | submission_approved | 不允许前端撤销 |
| SM-001-T05 | pending_review | OP-SUB-WITHDRAW | withdrawn | owner | 尚无最终决定；expected_version | Submission、WorkItem cancelled | submission_withdrawn；通知领取者 | 新建提交 |
| SM-001-T06 | changes_requested | OP-DRAFT-REVISE | 新 Draft/editing | owner | 原决定、owner、base version 有效 | 新 Draft revision；旧对象不改 | submission_revision_draft_created | 新 Draft 可撤回/过期 |
| SM-001-T07 | approved | PublishCommand | publishing | publish service | 幂等键；依赖复检通过 | 发布任务状态 | publish_started_internal | 系统重试 |
| SM-001-T08 | approved | ReopenReviewCommand | pending_review | publish service/admin | URL、安全、重复、Schema 或 Evidence 结论变化 | 新 WorkItem；旧决定保留 | submission_review_reopened | 可在领取前撤回 |
| SM-001-T09 | publishing | PublishCommit | published | publish service | Project/V1/Event/Evidence/Media 全事务可提交 | Project、V1、Event、Evidence、Attachment、MediaReference、Submission、Outbox | project_published；成功通知 | 公开事实后走治理 |
| SM-001-T10 | publishing | PublishFailure | publish_failed | publish service | 事务已回滚；无半 Project | error_code、attempt、next_retry | project_publish_failed | 可重试/重审 |
| SM-001-T11 | publish_failed | RetryPublish | publishing | service/admin | 重试预算、同一幂等键 | attempt+1 | project_publish_retried | 否 |
| SM-001-T12 | publish_failed | ReopenReview | pending_review | admin | 预算耗尽或依赖变化 | 新 WorkItem | submission_review_reopened | 可撤回 |
| SM-001-T13 | publish_failed | Reject/Withdraw | rejected/withdrawn | admin/owner | reason_code；无 Project | 关闭任务 | submission_rejected/withdrawn | 新建提交 |

### 4.3 不变量

- Submission 创建时不得有 project_id；published 后只回填一个 resulting_project_id。
- Project 首发固定 `published_platform,creator_ids=[],author_link_status=unlinked`。
- `project_submitted` 不含 project_id。
- 同批准决定和发布幂等键最多创建一个 Project/V1。

## 5. SM-002 Project 公开治理

### 5.1 review_status

`published_platform,published_author,restricted,archived,deleted`。

| Transition ID | From | Command | To | Actor | Guard | 同事务写入 | 事件 | 可逆 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SM-002-T01 | published_platform | VerificationApproved | published_author | verification service | 至少一条 active AuthorRelation | Project 当前状态、Relation、Outbox；不创建 ProjectVersion/catalog Event | project_author_linked | 是 |
| SM-002-T02 | published_author | RelationSuspended/Terminated | published_platform | ownership/verification service | 最后一条 active AuthorRelation 失效 | Relation、治理 Version、Project | project_author_unlinked | 新关系可恢复 |
| SM-002-T03 | published_* | Restrict | restricted | admin | preview/confirm；法律/安全/隐私/争议原因 | AdminFactDecision、治理 Version、Project、Outbox | project_restricted | 可复核 |
| SM-002-T04 | published_* | Archive | archived | admin | Evidence或豁免；origin publication status | AdminFactDecision、Version、Project | project_archived | 可恢复 |
| SM-002-T05 | restricted | Archive | archived | admin | 复核决定长期归档 | 新决定和 Version | project_archived | 可恢复 |
| SM-002-T06 | restricted/archived | Restore | origin publication status | admin | Evidence有效；若无active Relation只能恢复platform | AdminFactDecision、Version、Project、Outbox | project_publication_restored | 可再次治理 |
| SM-002-T07 | restricted/archived | Delete | deleted | admin | ID二次确认；无合并替代；删除政策允许 | 删除治理 Version、墓碑、审计 | project_deleted | 仅灾备级 |

任何公开事实变化都创建新 Version；禁止直接 UPDATE 当前快照。

## 6. SM-003 ProjectUpdate

状态：`editing,update_pending,changes_requested,approved,applying,applied,apply_failed,rejected,withdrawn`。

| Transition ID | From | Command | To | Actor | Guard | 同事务写入/事件 |
| --- | --- | --- | --- | --- | --- | --- |
| SM-003-T01 | editing | OP-UPD-SUBMIT | update_pending | verified author/editor | active Link/Profile/Relation 权限交集；diff/Evidence/Media/preview有效 | Update快照+WorkItem；project_update_submitted |
| SM-003-T02 | update_pending | decision changes_requested | changes_requested | 非提交者 reviewer | claim/preview/confirm | ReviewDecision+WorkItem；project_update_reviewed |
| SM-003-T03 | update_pending | decision reject | rejected | reviewer/admin | reason_code | ReviewDecision+WorkItem |
| SM-003-T04 | update_pending | OP-UPD-WITHDRAW | withdrawn | owner | 最终决定前 | Update+WorkItem cancelled；project_update_withdrawn |
| SM-003-T05 | changes_requested | OP-UPD-RESUME | editing | owner | expected_version | 新可编辑快照；旧审核史保留 |
| SM-003-T06 | update_pending | decision approve | approved | reviewer | base仍current | ReviewDecision+WorkItem；project_update_reviewed |
| SM-003-T07 | approved | ApplyStart | applying | update service | apply idempotency；base预检 | attempt metadata |
| SM-003-T08 | applying | ApplyCommit | applied | update service | current/base、权限、Evidence、Media均有效 | 新Version、Project pointer、Event、Evidence/Media、Update、Outbox；project_updated/v2 |
| SM-003-T09 | applying | ApplyFailure | apply_failed | update service | 冲突或事务回滚 | 失败元数据；无半Version |
| SM-003-T10 | apply_failed | RetryApply | applying | service/reviewer | 瞬时故障；base仍current；预算内 | 同幂等键重试 |
| SM-003-T11 | apply_failed | RebaseRequested | changes_requested | 新 reviewer | base变化或需人工合并 | 新WorkItem决定；Project不变 |
| SM-003-T12 | apply_failed | Reject/Withdraw | rejected/withdrawn | admin/owner | reason | 关闭应用任务 |

## 7. SM-004 作品访问与 Recheck

### 7.1 Project.access_status

`normal,login_required,partial_abnormal,link_unavailable,suspected_migration,paused,ended,unknown`。

### 7.2 RecheckTask.check_status

`queued,running,retry_wait,needs_review,confirmed_no_change,applied,dismissed,failed,expired`。

| Transition ID | From | Command | To | Actor | Guard/动作 |
| --- | --- | --- | --- | --- | --- |
| SM-004-T01 | queued | StartCheck | running | worker | 取得租约；不改Project |
| SM-004-T02 | running | CandidateFound | needs_review | worker | 保存result/candidate/Evidence；创建WorkItem |
| SM-004-T03 | running | NoChange | confirmed_no_change | worker | 更新技术检查时间；不改access_status |
| SM-004-T04 | running | RetryableFailure | retry_wait | worker | attempt+1,next_retry_at |
| SM-004-T05 | retry_wait | Requeue | queued | scheduler | 到期 |
| SM-004-T06 | running/retry_wait | Exhausted | failed | worker | 保留结果；告警 |
| SM-004-T07 | failed | Retry/Review/Expire | queued/needs_review/expired | editor/system | 人工修复、充分候选或保留期到期 |
| SM-004-T08 | needs_review | OP-ADMIN-DECISION apply | applied | claimed reviewer | TD-SM-001；同事务创建ReviewDecision+Version+Project pointer+Event+WorkItem |
| SM-004-T09 | needs_review | decision dismiss | dismissed | reviewer | Project不变；关闭Task/WorkItem |
| SM-004-T10 | needs_review | decision confirm_no_change | confirmed_no_change | reviewer | Project不变；记录决定 |

技术检查不得直接产生 paused/ended，也不得用 `recovered` 作为 current access_status。paused/ended 恢复直接迁移到 normal，并追加 recovered Event。

## 8. SM-005 VerificationRequest

状态：`draft,pending,changes_requested,verified,failed,withdrawn`。

| Transition ID | From | Command | To | Actor | Guard/同事务 |
| --- | --- | --- | --- | --- | --- |
| SM-005-T01 | 不存在 | OP-VER-DRAFT-CREATE | draft | registered user | 同申请链唯一活跃；resolution XOR |
| SM-005-T02 | draft/changes_requested | OP-VER-SUBMIT/SUPPLEMENT | pending | applicant | 材料ready+clean；冻结Link policy和Profile exact refs；创建WorkItem |
| SM-005-T03 | pending | decision changes_requested | changes_requested | reviewer | ReviewDecision+WorkItem；字段化缺失项 |
| SM-005-T04 | pending | decision reject | failed | reviewer | 不创建Link/Relation |
| SM-005-T05 | pending | decision approve | verified | non-conflicted reviewer | Request、Creator/ProfileVersion可选、Link、AuthorRelation、Project治理Version、ReviewDecision、WorkItem、Outbox同事务 |
| SM-005-T06 | draft/pending/changes_requested | OP-VER-WITHDRAW | withdrawn | applicant | pending时取消WorkItem；历史保留 |

三种 resolution：

- use_existing_link：复用 active Link，不改 role/profile；
- create_new_creator：创建 Creator/PV1 和 owner/OWNER_V1；
- claim_existing_creator：按冻结 owner set 选择 OWNER_V1/MANAGER_V1，锁和CAS保证 owner唯一。

## 9. SM-006 OwnershipCase 与撤案

### 9.1 Case

`open,investigating,resolved_upheld,resolved_revoked,withdrawn`。

### 9.2 WithdrawalRequest

`requested,rejected,accepted,closed_by_case_decision,superseded`。

| Transition ID | From | Command | To | Actor | Guard/同事务 |
| --- | --- | --- | --- | --- | --- |
| SM-006-T01 | 不存在 | OP-OWNERSHIP-CREATE | open | editor/admin | 同Relation一条active；Relation suspended；principal v1 |
| SM-006-T02 | open | reviewer claim | investigating | non-conflicted reviewer | staff queue已预过滤；claim保存principal version |
| SM-006-T03 | open/investigating | EvidenceAdd | 状态不变 | authorized party/editor/admin | append证据；重算principal；冲突assignee自动release |
| SM-006-T04 | open/investigating | WithdrawRequest | 状态不变+Request/requested | opened_by/admin | 无active request；重算principal |
| SM-006-T05 | Request/requested | RejectWithdrawal | rejected | current reviewer | Case保持；清active保留latest |
| SM-006-T06 | open/investigating | decision withdraw | withdrawn+Request/accepted | reviewer | applicant权限、principal、tokens重检；Relation/Project结果同事务 |
| SM-006-T07 | open/investigating | decision uphold | resolved_upheld | reviewer | active request若有→closed_by_case_decision；Relation active；Project状态重算 |
| SM-006-T08 | open/investigating | decision revoke | resolved_revoked | reviewer | active request关闭；Relation terminated；Project重算 |

Party 读取不存单值 party_role。`party_roles[]` 固定顺序：

`opened_by,appealed_account,relation_principal,evidence_submitter`。

动作矩阵：

- opened_by：view、add_evidence、request_withdrawal；
- appealed_account：view、add_evidence；
- relation_principal：view、add_evidence；
- evidence_submitter：view；若未同时命中前三类，不获得新增证据或撤案能力。

## 10. SM-007 ReviewWorkItem

状态：`queued,claimed,decided,cancelled`。

| Transition ID | From | Command | To | Guard | 动作 |
| --- | --- | --- | --- | --- | --- |
| SM-007-T01 | queued | OP-ADMIN-CLAIM | claimed | 对应权限、职责分离、无冲突、expected version | assignee/token hash/lease；WorkItemEvent |
| SM-007-T02 | claimed | OP-ADMIN-HEARTBEAT | claimed | 当前领取者；最大续租预算 | 延长lease；不改领域对象 |
| SM-007-T03 | claimed | OP-ADMIN-RELEASE | queued | 无已提交决定 | 清claim；追加released事件 |
| SM-007-T04 | claimed | LeaseExpired | queued | now>lease | 清claim/token；expired事件 |
| SM-007-T05 | claimed | PrincipalChanged | queued | Ownership principal版本变化 | revoke preview/confirm；release；不披露新主体 |
| SM-007-T06 | claimed | OP-ADMIN-DECISION | decided | 决定矩阵、claim、preview、confirm、ACL全部有效 | 创建ReviewDecision+领域结果+typed ref |
| SM-007-T07 | claimed creator_profile | OP-ADMIN-EXECUTE publish | decided | 管理员当前领取；current pointer有效 | CreatorProfileExecutionDecision+ProfileVersion+typed ref |
| SM-007-T08 | queued/claimed | CancelTarget | cancelled | 目标撤回/合并/替代且无最终决定 | 清claim；cancel reason |

WorkItem 不保存 `approved/rejected/changes_requested`；这些属于领域决定。

## 11. SM-008 Lifecycle Event

Event 为 append-only，无持久化审核状态。

| Transition ID | From | Command | To/派生 | Guard | 动作 |
| --- | --- | --- | --- | --- | --- |
| SM-008-T01 | 不存在 | ParentFactCommitted | published head | 父事实事务批准；type/time/summary/Evidence完整 | 同事务创建Event并计算sort_at/rule_version |
| SM-008-T02 | current head | CorrectEvent | 新Event=head；旧Event派生superseded | expected_chain_head；preview/confirm；Evidence | 只新增新Event(supersedes old)，旧行不更新 |

禁止 Event draft/pending_review/rejected 和直接客户端创建。

## 12. SM-009 Asset

状态：`unknown,available,login_required,paid,contact_required,link_abnormal,removed`。

| Transition ID | From | Command | To | Guard |
| --- | --- | --- | --- | --- |
| SM-009-T01 | unknown | ConfirmCheck | 任一确认状态 | 安全检查、访问结果、Evidence |
| SM-009-T02 | available/login_required/paid/contact_required | ConfirmAbnormal | link_abnormal | 重复异常达到阈值或安全阻断 |
| SM-009-T03 | link_abnormal | ConfirmRecovery | 可用门槛状态 | 新URL/获取方式复检和Evidence |
| SM-009-T04 | 非removed | RemoveAsset | removed | 作者审核/平台决定、原因 |
| SM-009-T05 | removed | RecheckCandidate | unknown | 新候选需全量检查 |
| SM-009-T06 | 任意 | SecurityBlock | 原状态不变 | SSRF/恶意/非法scheme；阻断导航并审计 |

availability_status 和 security_result 分离；blocked 不伪造为 removed。

## 13. SM-010 Comment 与 Report

Comment：`pending,under_review,visible,collapsed,hidden,rejected,author_withdrawn`。

| Transition ID | From | Command | To | 公开计数 delta | 决定 |
| --- | --- | --- | --- | --- | --- |
| SM-010-T01 | 新建 | CreateComment | pending | 0 | 自动审核待处理 |
| SM-010-T02 | pending | AutoPass | visible | +1 | 自动规则 |
| SM-010-T03 | pending | NeedsReview | under_review | 0 | 创建WorkItem |
| SM-010-T04 | pending | AutoReject | rejected | 0 | 规则版本化 |
| SM-010-T05 | visible | Report/HighRisk | under_review | -1 | 创建/复用Report和WorkItem |
| SM-010-T06 | visible | Collapse | collapsed | 0 | ReviewDecision |
| SM-010-T07 | visible/collapsed/under_review | Hide/Reject | hidden/rejected | visible/collapsed为-1；under_review为0 | ReviewDecision |
| SM-010-T08 | under_review | Restore | visible/collapsed | +1 | ReviewDecision |
| SM-010-T09 | collapsed | RestoreVisible | visible | 0 | ReviewDecision |
| SM-010-T10 | hidden | AppealRestore | visible/collapsed | +1 | 新WorkItem/替代决定 |
| SM-010-T11 | pending/visible/collapsed/under_review | Withdraw | author_withdrawn | visible/collapsed为-1；其余0 | 作者命令 |

公开集合严格为 visible/collapsed。计数只在跨集合边界时变化。

## 14. SM-011 Evidence

### 14.1 validity_status

`pending_review,valid,suspended,invalid,revoked`。

| Transition ID | From | Command | To | Guard |
| --- | --- | --- | --- | --- |
| SM-011-T01 | pending_review | verify_valid | valid | 来源/归属/field_path可验证；ReviewDecision |
| SM-011-T02 | pending_review | mark_invalid | invalid | 不能支持主张；终态 |
| SM-011-T03 | pending_review | revoke | revoked | 伪造/法律/安全；终态 |
| SM-011-T04 | valid | mark_suspended | suspended | 暂不可达/归属争议/补证 |
| SM-011-T05 | suspended | restore_valid | valid | 新检查消除原因；新决定 |
| SM-011-T06 | suspended | mark_invalid | invalid | 复核确认永久无效 |
| SM-011-T07 | valid/suspended | revoke | revoked | 高风险确认 |

`freshness_status=valid/expiring/expired` 和 `dispute_status` 是独立状态轴。Evidence 可计为有效必须同时满足 validity=valid、freshness≠expired、dispute不在in_review且 visibility/field_path 匹配。

## 15. SM-012 Media 与删除 Saga

### 15.1 MediaResource

`created,uploading,uploaded,scanning,ready,rejected,quarantined,deleted`。

### 15.2 MediaDeletionJob

`accepted,running,retry_wait,reconciliation_required,succeeded,failed,cancelled`。

| Transition ID | From | Command | To | Guard/动作 |
| --- | --- | --- | --- | --- |
| SM-012-T01 | created | UploadPart | uploading | signed part；checksum |
| SM-012-T02 | uploading | CompleteUpload | uploaded | parts完整；幂等 |
| SM-012-T03 | uploaded | ScanStart | scanning | worker租约 |
| SM-012-T04 | scanning | ScanClean | ready | MIME/恶意/内容策略通过 |
| SM-012-T05 | scanning | ScanReject | rejected/quarantined | 规则和原因；禁止引用 |
| SM-012-T06 | ready/rejected | DeleteRequest | Job/accepted；Resource原状态+guard | 零引用、无LEGAL_HOLD；创建Job |
| SM-012-T07 | accepted/retry_wait | RunDelete | running | worker租约 |
| SM-012-T08 | running | ProviderDeleted/NotFound | succeeded + Resource/deleted | 确定receipt；清guard |
| SM-012-T09 | running | RetryableDeleteError | retry_wait | attempt<max |
| SM-012-T10 | running | AmbiguousResult | reconciliation_required | 不猜测成功 |
| SM-012-T11 | running/retry_wait/reconciliation_required | Exhausted | failed | 预算耗尽；guard保留 |
| SM-012-T12 | accepted/retry_wait | CancelDelete | cancelled | 无receipt/进行中动作；HEAD确认对象存在；清guard |

正式 Version/证据引用不可解绑；删除与引用创建锁同一资源。

## 16. SM-013 Creator Profile 与 Rebase Token

### 16.1 Draft

`editing,awaiting_admin_review,changes_requested,published,cancelled,expired`。

| Transition ID | From | Command | To | Guard/动作 |
| --- | --- | --- | --- | --- |
| SM-013-T01 | 不存在 | CreateDraft | editing | base=current；同owner无active chain |
| SM-013-T02 | editing | SubmitReview | awaiting_admin_review | 字段/头像/current pointer；创建WorkItem |
| SM-013-T03 | awaiting_admin_review | changes_requested decision | changes_requested | ReviewDecision；WorkItem decided |
| SM-013-T04 | changes_requested | InitialRebase无冲突 | 新revision/editing | base/local/current三方合并；旧Draft不改 |
| SM-013-T05 | changes_requested | InitialRebase有冲突 | 状态不变+Token/active | 返回409；不建Draft |
| SM-013-T06 | Token/active | RetryRebase成功 | Token/consumed+新Draft/editing | token/全部resolution/current/actor有效；同事务 |
| SM-013-T07 | Token/active | Expire/Revoke | expired/revoked | TTL、source/current/roles变化 |
| SM-013-T08 | awaiting_admin_review | PublishExecute | published | admin claim/preview/confirm/current有效；ExecutionDecision+ProfileVersion+pointer同事务 |
| SM-013-T09 | editing/changes_requested | Cancel/Expire | cancelled/expired | 无已提交发布 |

Draft 不持久化 publishing。相同已提交 operation 按 receipt 回放。

## 17. SM-014 Admin Preview/Confirm/Execute

PreviewToken：`active,consumed,expired,revoked`；ConfirmToken 同状态；AdminReauthGrant 同状态；AdminOperation：`prepared,executing,succeeded,failed`。

| Transition ID | From | Command | To | Guard |
| --- | --- | --- | --- | --- |
| SM-014-T01 | 不存在 | OP-ADMIN-PREVIEW | Preview/active | 权限、目标版本、影响摘要；不写领域状态 |
| SM-014-T02 | Preview/active | OP-ADMIN-CONFIRM近期认证 | Confirm/active | 同session/actor/summary；Preview有效 |
| SM-014-T03 | Preview/active且需认证 | StepUp | Reauth/active | 绑定该Preview和主session |
| SM-014-T04 | Reauth/active | OP-ADMIN-CONFIRM | Reauth/consumed+Confirm/active | 一次消费 |
| SM-014-T05 | Confirm/active | OP-ADMIN-EXECUTE | tokens/consumed+Operation/succeeded | 提交锁内复检；领域事务成功 |
| SM-014-T06 | 任一active token | TTL/版本/角色/session变化 | expired/revoked | 不改领域事实 |
| SM-014-T07 | Operation prepared/executing | TransactionFailure | failed | 零部分领域写；可用新token重试 |

Preview 不产生草稿状态；Confirm 不代表事实已执行。

## 18. SM-015 Comparison

Comparison：`active,expired,merged,invalidated`；每次成员或顺序变化提升 `comparison_version`。

| Transition ID | From | Command | To | Guard/动作 |
| --- | --- | --- | --- | --- |
| SM-015-T01 | 不存在 | Create/Add | active v1 | 0—5唯一同品类；匿名或登录owner |
| SM-015-T02 | active vN | PutMembers | active vN+1 | 0—5；不截断；新版本进度清零 |
| SM-015-T03 | active vN | Start | 状态不变 | 2—5有效作品；一次comparison_started |
| SM-015-T04 | active vN | DimensionVisible | 状态不变 | ≥50%可见且聚焦1秒；累加visible_ms |
| SM-015-T05 | active vN | Complete | 状态不变 | 2—5有效、≥4维度组、累计≥30秒；版本一次 |
| SM-015-T06 | active vN | Save | 状态不变 | 登录owner；最终状态幂等 |
| SM-015-T07 | anonymous active | LoginMerge无冲突 | merged | 同品类并集≤5；保留版本史 |
| SM-015-T08 | anonymous active | LoginMerge冲突 | 状态不变+MergeConflict | 并集>5/跨类；用户显式解决 |
| SM-015-T09 | active | Expire/PrivacyDelete | expired/invalidated | 保留期或删除请求 |

本版不存在 DecisionRecord、DecisionForm、decision_submitted。

## 19. SM-016 Analytics Bridge 与指标

### 19.1 BridgeSnapshot

`building,ready,published,failed`。

| Transition ID | From | Command | To | Guard |
| --- | --- | --- | --- | --- |
| SM-016-T01 | 不存在 | BuildSnapshot | building | previous published、水位、operation_id |
| SM-016-T02 | building | ValidateSnapshot | ready | 完整映射、内容hash、质量门槛 |
| SM-016-T03 | ready | PublishSnapshot | published | 独立管理员；hash一致；不可变 |
| SM-016-T04 | building | BuildFailed | failed | 构建失败；不得作为B查询；新operation重建 |

### 19.2 MetricRecomputeOperation

`queued,running,succeeded,failed,cancelled`。

| Transition ID | From | Command | To | Guard |
| --- | --- | --- | --- | --- |
| SM-016-T06 | 不存在 | RecomputeCommand | queued | snapshot published；formula published；operation幂等 |
| SM-016-T07 | queued | WorkerStart | running | 任务租约；固定event watermark |
| SM-016-T08 | running | ComputeSuccess | succeeded | 创建MetricVersion/ready和完整结果 |
| SM-016-T09 | running | ComputeFailure | failed | 不发布半结果；error_code |
| SM-016-T10 | queued | Cancel | cancelled | 尚未运行；授权者 |
| SM-016-T11 | failed | Retry | 新Operation/queued | 新operation_id；旧失败保留 |

### 19.3 MetricVersion

`computing,ready,published,failed`。

| Transition ID | From | Command | To | Guard |
| --- | --- | --- | --- | --- |
| SM-016-T12 | 不存在 | WorkerCreate | computing | 绑定B、formula、水位、窗口 |
| SM-016-T13 | computing | ResultsCommitted | ready | 分子/分母/质量/内容hash完整 |
| SM-016-T14 | computing | ComputeFailed | failed | 不公开半结果；新operation重算 |
| SM-016-T15 | ready | PublishMetricVersion | published | 独立管理员；hash匹配；小样本策略 |

GET 查询不触发任何上述迁移。不同 B、公式、水位或窗口必须产生新 MetricVersion，不覆盖 published。published Snapshot/MetricVersion 不提供撤销或原位修改迁移；数据质量或隐私事故通过新版本、访问策略和审计处置，旧版本保留追溯且不再作为默认指针。

## 20. SM-017 邮箱验证码认证

`pending,consumed,expired,attempts_exceeded,cancelled`。

| Transition ID | From | Command | To | Guard |
| --- | --- | --- | --- | --- |
| SM-017-T01 | 不存在 | CreateEmailChallenge | pending | 邮箱格式有效；发送限流允许；purpose=login或admin_confirm；OTP仅发信adapter短暂可见 |
| SM-017-T02 | pending | VerifyCorrectOtp | consumed | 10分钟内、attempt<5、同challenge/auth_flow/CSRF；原子签发/提升会话并消费 |
| SM-017-T03 | pending | VerifyWrongOtp | pending | attempt+1后仍<5；返回通用OTP_INVALID，不枚举账户 |
| SM-017-T04 | pending | VerifyWrongOtp | attempts_exceeded | 第5次错误；不得再验证或签发会话 |
| SM-017-T05 | pending | Expire | expired | expires_at到达；定时任务或请求期惰性迁移 |
| SM-017-T06 | pending | Cancel | cancelled | 当前auth flow主体取消；撤销未消费continuation |

login 成功必须轮换 session；admin_confirm 只提升绑定的原主 session/recent_auth_at 并签发一次性 AdminReauthGrant，不切换账户或角色。所有终态不可重开；重发创建新 challenge，旧 challenge 进入 cancelled 或按原期限过期。

正常验收：Given 新邮箱 challenge=pending；When 10分钟内第一次提交正确 OTP；Then challenge=consumed、创建 registered user/HttpOnly Session，并按 continuation 只回放一次动作。

异常验收：Given challenge 已 consumed/expired/attempts_exceeded；When再次验证；Then返回 410/422 对应稳定错误，Session、PendingAction、IdentityLink 均不变化。

## 21. 状态机实现模式

建议每个聚合实现：

```text
Command Handler
  -> Authorization Policy
  -> State Guard
  -> Domain Transition
  -> Repository Unit of Work
  -> Outbox + Audit + Receipt
```

禁止：

- 通用 `PATCH /resource/{id}` 修改 status；
- Controller 内散落状态字符串；
- 前端计算下一个正式状态；
- Worker 绕过领域 Command 直接 UPDATE；
- 用通知、Analytics 或 AuditLog 反推业务当前状态；
- 用数据库触发器隐藏主要业务迁移。触发器只执行不变量和延迟外键。

## 22. 统一异常矩阵

| 场景 | HTTP/Error | 状态 |
| --- | --- | --- |
| 当前状态不允许 | 422 STATE_TRANSITION_NOT_ALLOWED | 不变 |
| expected_version 过期 | 409 VERSION_CONFLICT | 不变 |
| 幂等键异载荷 | 409 IDEMPOTENCY_PAYLOAD_MISMATCH | 不变 |
| token过期 | 410 TOKEN_EXPIRED | 不变 |
| token已消费且非同receipt | 410 TOKEN_CONSUMED | 不变 |
| 无角色/对象/字段权限 | 403 FORBIDDEN | 不变 |
| 利益冲突 | 403 CONFLICT_OF_INTEREST | 不变并释放相关claim |
| 资源对调用方不可枚举 | 404 NOT_FOUND | 不变 |
| 依赖暂不可用 | 503 DEPENDENCY_UNAVAILABLE | 不变或进入明确retry状态 |
| 事务回滚 | 503 TRANSACTION_FAILED | 零部分写 |

## 23. 状态机测试

每条 Transition ID 至少具备：

- 正常迁移；
- 未授权；
- 非法前态；
- expected_version 冲突；
- 幂等重放；
- 异载荷重放；
- 事务中间点故障回滚；
- Outbox 重试；
- 终态不可重开。

关键并发测试：

1. 两个审核者同时 claim；
2. 两个 owner Link 同时批准；
3. Recheck apply 与作者更新同时争抢 current Version；
4. Creator Profile execute 与 rebase current pointer 变化；
5. Ownership principal 在 preview/confirm/execute 间变化；
6. 评论举报/撤回/审核并发对公开计数；
7. 媒体引用创建与删除 Saga；
8. 两个指标重算基于相同/不同水位。

## 23. 状态机冻结门禁

| Gate | 条件 |
| --- | --- |
| SM-GATE-01 | TD-SM-001 回写 PRD，Recheck→Version 固定用例通过 |
| SM-GATE-02 | TD-SM-002 回写 Projection/allowed_actions |
| SM-GATE-03 | 所有状态只由 Command 迁移，无通用 status PATCH |
| SM-GATE-04 | 每个公开事实迁移有 Decision+Version+Event/Outbox |
| SM-GATE-05 | 每个终态、撤销、重试和失败恢复有测试 |
| SM-GATE-06 | Analytics GET 只读，POST 状态机完整 |
| SM-GATE-07 | 状态枚举与数据库 CHECK、OpenAPI、前端 union、测试 fixture 一致 |

## 24. 完成度自检

| 检查项 | 结果 |
| --- | --- |
| PRD 7套必需状态机 | 完整 |
| Evidence 有效性状态机 | 完整 |
| 发布、更新、复检、Ownership、WorkItem | 完整 |
| Media、Creator Profile、Admin token、Comparison、Analytics、邮箱验证码 | 完整 |
| 每条迁移含 Command/Actor/Guard/事务或动作 | 完整 |
| 非法迁移、并发、幂等、失败恢复 | 完整 |
| V19-01/V19-02/V19-04 | 已批准并回写 PRD v1.10 |
