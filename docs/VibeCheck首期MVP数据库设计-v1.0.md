# VibeCheck 首期 MVP 数据库设计

**版本：v1.0｜状态：已批准开发基线（WP-00）｜日期：2026-08-10**

## 1. 文档目的

本文把《VibeCheck 首期 MVP 开发级 PRD》v1.10 的逻辑实体、状态、权限、幂等、历史和事务要求下钻为可执行的关系数据库设计。本文定义物理 Schema、表职责、主外键、唯一约束、索引、事务边界、分区、数据保留和迁移规则。

本文不修改 PRD 的产品范围。PRD v1.9 复审提出的 V19-01—V19-04 已获批准并回写 v1.10；第 4 章技术决策自 WP-00 基线提交起生效。

## 2. 输入基线

| 基线 | 标识 | 使用方式 |
| --- | --- | --- |
| 开发级 PRD | `docs/VibeCheck首期MVP开发级PRD-v1.10.md` | 产品事实、字段、状态、权限、异常、埋点和验收的上位规范 |
| 技术复审 | `VibeCheck开发级PRD技术可实现性复审报告-v1.9.md` | V19-01—V19-05 和原型迁移差距 |
| 代码基线 | `3c1c4ef54f1a24368ef9d2f25bc52432556ad488` | 仅用于识别可复用 UI/DTO；不作为生产数据模型来源 |
| 运行事实 | React/Vite 前端原型；无生产后端、数据库和真实认证 | 全部生产表均为新增，Mock 不迁入生产事实库 |

## 3. 数据库技术基线

### 3.1 推荐基线

- PostgreSQL 18 的受支持补丁版本作为关系事实库；最快部署基线为 Render Singapore 托管 PostgreSQL。实例规格、HA、备份/RPO/RTO、密钥和保留期仍受 TBC-006 剩余门禁约束。
- 数据库编码固定 UTF-8，时区固定 UTC；应用层和报表层再按 Asia/Shanghai 切窗。
- `pgvector` 只用于 P0 语义召回候选；结构化过滤、权限和可见性先由关系字段确定，向量相似度不得绕过过滤。
- 生产连接使用最小权限服务账户；迁移账户、运行账户、只读分析账户、后台导出账户分离。
- 业务事务、Outbox 和审计摘要在同一 PostgreSQL 事务提交。对象存储、搜索索引和通知通过 Outbox 异步执行。

PostgreSQL 官方文档将 18 列为当前受支持版本，并提供 JSONB、行级安全和声明式分区能力；本设计只使用这些稳定能力。参考：

- <https://www.postgresql.org/docs/current/release.html>
- <https://www.postgresql.org/docs/current/datatype-json.html>
- <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>
- <https://www.postgresql.org/docs/current/ddl-partitioning.html>

### 3.2 数据类型规范

| 业务类型 | PostgreSQL 类型 | 规则 |
| --- | --- | --- |
| 内部稳定 ID | `uuid` | 服务端生成 UUIDv7；导入旧 ID 时另存 `legacy_id`，不得改主键 |
| 外部幂等 ID | `varchar(64)` | UUID/ULID/受控 opaque ID；按接口 Schema 校验 |
| 版本号 | `bigint` | 从 1 单调递增；所有可变聚合使用 `version` 乐观锁 |
| 时间 | `timestamptz` | UTC；不使用无时区时间 |
| 日期切窗 | `date` | 只用于报表分区键或业务自然日 |
| 枚举 | `varchar` + `CHECK` | 不使用 PostgreSQL ENUM，便于 expand/contract 迁移 |
| 金额 | 本版无金额字段 | 禁止用浮点数预留未定义商业能力 |
| 可检索文本 | `text` | 写入前净化；另建规范化列或 `tsvector` |
| URL | `text` + `canonical_url_hash bytea` | 原值按访问权限保存；唯一/查重使用规范 URL 哈希 |
| 不可变快照 | `jsonb` | 必须有 `schema_version` 和应用层 JSON Schema；禁止在快照里保存可独立更新的权限或身份外键 |
| 有序小数组 | `jsonb` | 仅用于不可变决定/快照；可查询关系必须拆关联表 |
| 哈希 | `bytea` | API 输出时转小写十六进制；算法字段必须同时保存 |
| 向量 | `vector(n)` | 维度由 embedding model version 冻结；不同维度不写同列 |

### 3.3 通用列

除不可变纯关联表外，可变聚合表统一含：

`id, version, created_at, created_by_actor_type, created_by_actor_id, updated_at, updated_by_actor_type, updated_by_actor_id`。

需要逻辑终止的表使用领域终态，不使用通用 `is_deleted`。隐私删除使用 `privacy_state`、匿名化主体或专用删除任务；公开对象删除保留墓碑、别名和审计。

## 4. v1.9 复审冻结决策

| Decision ID | 对应问题 | 技术决策 | 数据影响 | 生效条件 |
| --- | --- | --- | --- | --- |
| TD-DB-001 | V19-01 | `review_decision/recheck_task` 成为 Version 的第三个合法 ReviewDecision 分支。`decision=apply` 时 ReviewDecision、Version、Project current pointer、Event、RecheckTask、WorkItem 和 Outbox 同事务；project/base 必须与任务及前序 Version 精确一致。 | `project_versions.source_decision_type/id` 校验增加 recheck 分支；不得直接 UPDATE 公开 Project 而无 Version。 | 回写 PRD Version 判别外键、状态机和固定用例 |
| TD-DB-002 | V19-02 | Ownership party 投影改为排序去重的 `party_roles[]`。排序固定为 `opened_by,appealed_account,relation_principal,evidence_submitter`；鉴权从事实关系计算，永不依赖投影标签。 | 不在 Case 主表保存角色；按案件、当前用户从来源表派生。 | 回写 Projection、allowed_actions 和验收 |
| TD-DB-003 | V19-03 | 冻结 `ClientAnalyticsInput.v1`；受保护身份、environment、actor_type、received_at 和有效 consent 均由 collector 产生。 | 接收表分离原始合法 client 输入与持久化 AnalyticsEnvelope；拒绝项不写事实表。 | OpenAPI/JSON Schema 评审通过 |
| TD-DB-004 | V19-04 | Analytics Bridge Snapshot、Metric Recompute Operation、Metric Version、Metric Result 均建模为资源；GET 只读，POST 命令产生新版本，已发布结果不可覆盖。 | 新增快照、映射、重算、指标版本和结果表。 | 回写 A13/IF-ANALYTICS-001 并通过数据评审 |

## 5. Schema 划分

| Schema | 责任 | 禁止事项 |
| --- | --- | --- |
| `iam` | 用户、角色、会话、身份续接、管理员再认证 | 不保存业务内容和埋点 payload |
| `catalog` | Project、Version、Creator、Event、Asset、Relation、Evidence | 不保存草稿和工作队列状态 |
| `workflow` | 发布、更新、验证、争议、复检、审核决定、后台执行 | 不作为公开读取投影 |
| `media` | 媒体资源、引用、上传、删除 Saga | 不保存验证材料正文 |
| `private_material` | 身份验证私密材料、读取授权摘要 | 与普通媒体桶、表和服务账户隔离 |
| `community` | 互动、评论、举报、通知 | 计数只由有效事实重算 |
| `comparison` | 比较会话、成员、浏览进度、保存和合并冲突 | 不保存 DecisionRecord |
| `search` | 查询快照、意图版本、结果版本、导航上下文、索引文档 | 不保存明文敏感查询到 Analytics |
| `taxonomy` | 品类 Schema、字典、排序/阈值配置版本 | 不允许配置覆盖冻结约束 |
| `analytics` | 事件、身份桥快照、指标版本和结果 | 不保存自然人 user_id 到事件事实 |
| `ops` | Outbox、Inbox、作业、配置草稿、操作回执 | 不替代领域决定和审计 |
| `audit` | 不可变操作日志、敏感读取、安全事件 | 业务角色无 UPDATE/DELETE 权限 |

## 6. 核心事实表

### 6.1 catalog

| Table ID | 表 | 主键与关键列 | 关键约束 | 主要索引/读取 |
| --- | --- | --- | --- | --- |
| DB-CAT-001 | `catalog.projects` | `project_id, current_version_id, current_name, category_id, category_schema_version, canonical_public_url, canonical_url_hash, review_status, origin_publication_status, access_status, http_check_status, author_link_status, completeness_level, freshness_status, aggregate_version` | stable ID 不变；current_version 必须属于本 Project；公开事实变化必须有新 Version；`deleted` 保留墓碑 | `canonical_url_hash` 唯一条件索引；`category_id,review_status,updated_at`；`current_name` FTS |
| DB-CAT-002 | `catalog.project_versions` | `version_id, project_id, version_number, previous_version_id, category_id, category_schema_version, snapshot_json, source_decision_type, source_decision_id, transaction_id, effective_at` | `(project_id,version_number)` 唯一；不可 UPDATE/DELETE；typed decision 按 TD-DB-001 和 PRD 分支校验 | `project_id,version_number desc`；`source_decision_type,source_decision_id` 唯一 |
| DB-CAT-003 | `catalog.project_name_aliases` | `alias_id, project_id, name, normalized_name, effective_from, effective_to` | 同 Project 时间段不重叠 | `normalized_name` |
| DB-CAT-004 | `catalog.project_url_aliases` | `alias_id, project_id, canonical_url, url_hash, effective_from, effective_to, redirect_kind` | URL hash 指向唯一 canonical Project；合并别名永久保留 | `url_hash` 唯一 |
| DB-CAT-005 | `catalog.creators` | `creator_id, current_profile_version_id, aggregate_version, owner_link_set_version, canonical_creator_id, merge_status` | canonical 链无环；current profile 属于本 Creator | `canonical_creator_id`; `merge_status` |
| DB-CAT-006 | `catalog.creator_profile_versions` | `creator_profile_version_id, creator_id, base_version_id, source_creator_profile_draft_id, source_verification_request_id, profile_snapshot_json, avatar_media_reference_id, published_by_admin_id, created_at` | 两个 source 恰一非空；不可变；current pointer 同事务切换 | `creator_id,created_at desc` |
| DB-CAT-007 | `catalog.creator_account_links` | `link_id, user_id, creator_id, link_role, permission_profile_id, permission_profile_version, permission_profile_config_hash, status, replacement_link_id, version` | 同 user+canonical creator 最多一条非终态；同 canonical creator 最多一条 active/suspended owner | 两个条件唯一索引；`user_id,status` |
| DB-CAT-008 | `catalog.link_permission_profiles` | `profile_id, profile_version, profile_family, capabilities_json, field_path_ceiling_json, config_hash, deployed_at` | P0 仅 OWNER_V1/MANAGER_V1 version=1；五字段 JCS SHA-256 与固定值一致；不可变 | `(profile_id,profile_version)` 主键；启动时全量校验 |
| DB-CAT-009 | `catalog.author_relations` | `author_relation_id, project_id, creator_id, status, author_role, field_permissions_json, source_verification_id, replacement_relation_id, version` | 公开署名只取 active；终止/替代保留历史 | `project_id,status`; `creator_id,status` |
| DB-CAT-010 | `catalog.events` | `event_id, project_id, version_id, event_type, event_time, time_precision, event_summary, source_type, source_id, evidence_id, created_at` | append-only；同来源业务事件幂等；不是 Analytics 事件 | `project_id,event_time desc,event_id` |
| DB-CAT-011 | `catalog.assets` | `asset_id, project_id, asset_type, name, canonical_url, availability_status, visibility, evidence_id, version` | 外链状态独立于 Project；不可用不硬删档案 | `project_id,availability_status`; URL hash |
| DB-CAT-012 | `catalog.relations` | `relation_id, subject_type/id, object_type/id, relation_type, direction, status, source_decision_id, version` | 规范关系类型只含 fork，不含 fork_of；有向关系防重复；按规则防环 | 两端组合唯一；双向查找索引 |
| DB-CAT-013 | `catalog.evidence` | `evidence_id, object_type/id, project_id, version_id, event_id, field_path, evidence_type, source_channel, source_url, source_summary, captured_at, collected_by, confidence, visibility, validity_status, freshness_status, dispute_status, validity_decision_type/id, source_evidence_draft_id` | 单 target/field；决定 typed ref 有效；final Evidence 不含 draft status/version；不可原地改来源事实 | `object_type,object_id,field_path`; `validity_status,freshness_status`; `source_evidence_draft_id` 唯一 |
| DB-CAT-014 | `catalog.evidence_attachments` | `attachment_id, evidence_id, media_resource_id, role, visibility, source_attachment_draft_id, created_at` | final 不可变；private/reviewer_only 读取另授权 | `evidence_id`; `media_resource_id` |
| DB-CAT-015 | `catalog.project_interaction_counters` | `project_id, favorite_count, like_count, follower_count, visible_comment_count, recalculated_at, source_watermark` | 非负；仅聚合器写；可从事实重建 | 主键 `project_id` |

### 6.2 workflow

| Table ID | 表 | 主键与关键列 | 关键约束与生命周期 |
| --- | --- | --- | --- |
| DB-WF-001 | `workflow.submission_url_checks` | `check_id, owner_user_id, input_hash, canonical_url, canonical_url_hash, redirect_chain_json, risk_result, duplicate_candidates_json, checked_at, expires_at` | TTL 30 分钟；原始 URL 按敏感字段策略保存；过期只读 |
| DB-WF-002 | `workflow.pending_inputs` | `pending_input_id, owner_subject_hash, input_type, ciphertext, key_version, expires_at, consumed_at` | 登录回跳一次消费；明文不进 URL/日志 |
| DB-WF-003 | `workflow.submission_drafts` | `draft_id, owner_user_id, submission_chain_id, draft_revision, supersedes_draft_id, base_submission_id, check_id, category_id, schema_version, draft_json, status, version, saved_at, expires_at` | 同 chain 仅一条 editing；submitted 后不可改；P0 Schema 服务端校验 |
| DB-WF-004 | `workflow.submissions` | `submission_id, draft_id, submitter_user_id, snapshot_json, status, review_work_item_id, approved_review_decision_id, resulting_project_id, version` | 创建时无 project_id；发布成功后回填 resulting_project_id；决定/发布事务分离 |
| DB-WF-005 | `workflow.project_updates` | `update_id, project_id, owner_user_id, base_version_id, update_type, diff_json, evidence_draft_ids_json, media_reference_ids_json, status, review_work_item_id, approved_review_decision_id, resulting_version_id, version` | base/current CAS；公开变化只经新 Version |
| DB-WF-006 | `workflow.admin_project_creation_drafts` | `draft_id, owner_editor_id, snapshot_json, category/schema, status, version` | 创建者不得审核；提交后生成 Submission |
| DB-WF-007 | `workflow.admin_project_edit_drafts` | `draft_id, project_id, owner_actor_id, base_version_id, diff_json, evidence_waiver_reason_code, status, version` | 不直接改公开事实；execute 创建 AdminFactDecision+Version |
| DB-WF-008 | `workflow.evidence_drafts` | `evidence_draft_id, owner_user_id, collector_actor_type, parent_type/id, final_target_kind, target_asset_draft_key, field_path, requested_visibility, evidence_type, source_channel, source_url, internal_record_ref_ciphertext, text_excerpt, status, source_hash, completed_at, promoted_evidence_id, version` | 一个 draft 最多提升一个 Evidence；ready 后内容不可改；父事务失败不提升 |
| DB-WF-009 | `workflow.evidence_attachment_drafts` | `attachment_draft_id, evidence_draft_id, media_resource_id, requested_visibility, status, version` | Draft ready/promoted 后不可撤回 |
| DB-WF-010 | `workflow.verification_requests` | `verification_id, project_id, applicant_user_id, creator_resolution_mode, target_creator_id, creator_account_link_id, snapshot_json, status, review_work_item_id, resulting ids, version` | resolution XOR；verified/failed/withdrawn 终态；材料引用稳定 |
| DB-WF-011 | `workflow.ownership_cases` | `case_id, project_id, author_relation_id, opened_by_user_id, appealed_user_id, reason_code, status, review_work_item_id, active_withdrawal_request_id, latest_withdrawal_request_id, conflict_principal_version, version` | 同 Relation 一条 active；party_roles 不落单值列；终态不可改 |
| DB-WF-012 | `workflow.ownership_evidence_submissions` | `submission_id, case_id, evidence_id, submitted_by_user_id, submitted_at, summary` | append-only；同 Case+Evidence+actor 去重 |
| DB-WF-013 | `workflow.ownership_withdrawal_requests` | `withdrawal_request_id, case_id, requested_by_user_id, reason_code, status, supersedes_request_id, decided_at, decision_reason_code, version` | 同 Case 同时一条 requested；历史请求不覆盖 |
| DB-WF-014 | `workflow.ownership_conflict_snapshots` | `case_id, principal_version, principal_set_hash, source_versions_json, created_at` | `(case_id,principal_version)` 唯一；不可变 |
| DB-WF-015 | `workflow.ownership_conflict_principals` | `case_id, principal_version, user_id, reason_code, source_type, source_id` | 并集去重；队列过滤在分页前用本表 anti-join |
| DB-WF-016 | `workflow.relation_candidates` | `candidate_id, subject/object, relation_type, status, review_work_item_id, preview_hash, version` | approve 前不创建 Relation |
| DB-WF-017 | `workflow.recheck_tasks` | `task_id, target_type/id, project_id, base_version_id, check_type, check_status, result_snapshot_json, candidate_access_status, review_work_item_id, resulting_version_id, attempt_count, version` | apply 遵循 TD-DB-001；不得直接改 Project |
| DB-WF-018 | `workflow.review_work_items` | `work_item_id, work_type, target_type/id, status, assignee_user_id, claim_token_hash, lease_expires_at, conflict_principal_version_at_claim, decision_ref_type/id, attempt_count, version` | 同 target 一条 active；typed ref 成对；决定与 WorkItem 同事务 |
| DB-WF-019 | `workflow.work_item_events` | `work_item_event_id, work_item_id, event_type, actor_id, reason_code, payload_hash, occurred_at` | append-only；领取、续租、释放、过期、冲突释放均记录 |
| DB-WF-020 | `workflow.review_decisions` | PRD ReviewDecision v1 全字段 | `(work_item_id)` 唯一决定；`decision_request_id+actor+work_item` 唯一；不可变；target 联合 CHECK+触发器 |
| DB-WF-021 | `workflow.admin_fact_decisions` | PRD AdminFactDecision 全字段 | 与 Admin Version 同事务；不可变 |
| DB-WF-022 | `workflow.system_fact_decisions` | `system_fact_decision_id, job_id/type, project_id, base_version_id, reason_code, payload_hash, transaction_id, committed_at` | 仅白名单 job type；与 Version 同事务 |
| DB-WF-023 | `workflow.creator_profile_drafts` | PRD CreatorProfileDraft 全字段 | 同 chain 一个非终态 revision；旧 revision 不重开 |
| DB-WF-024 | `workflow.profile_rebase_tokens` | PRD ProfileRebaseToken 全字段 | 仅存 token hash；TTL 10 分钟；一次消费；actor/roles/current 变化撤销 |
| DB-WF-025 | `workflow.creator_profile_execution_decisions` | `execution_decision_id, work_item_id, draft_id, actor_admin_id, project/base pointers, transaction_id, committed_at` | publish 唯一决定；与 ProfileVersion/current pointer 同事务 |
| DB-WF-026 | `workflow.admin_operation_previews` | `preview_id/token_hash, actor/session/roles, operation_type, target_hash, diff_hash, impact_hash, status, expires_at` | TTL 10 分钟；领域版本变化撤销 |
| DB-WF-027 | `workflow.admin_operation_confirms` | `confirm_id/token_hash, preview_id, reauth_grant_id, status, expires_at, consumed_at` | TTL 120 秒；一次消费 |
| DB-WF-028 | `workflow.admin_operations` | `operation_id, operation_type, actor, target, status, request_hash, result_json, transaction_id, committed_at` | `operation_id` 幂等；相同 ID 异载荷 409 |
| DB-WF-029 | `workflow.operation_receipts` | `operation_id, request_hash, http_status, response_ciphertext, response_expires_at, committed_at` | 先查 receipt 再校验已过期令牌；用于提交成功后响应丢失重放 |

### 6.3 media 与 private_material

| Table ID | 表 | 关键字段与约束 |
| --- | --- | --- |
| DB-MED-001 | `media.media_resources` | `media_resource_id, owner_user_id, purpose, declared/detected mime, byte_size, checksum_sha256, storage_bucket_key_ciphertext, status, scan_result, deletion_guard_at, version`；资源状态与引用状态分离 |
| DB-MED-002 | `media.media_upload_parts` | `resource_id, upload_id, part_number, part_checksum, part_etag_ciphertext, completed_at`；组合主键，完成后清理凭据 |
| DB-MED-003 | `media.media_references` | `media_reference_id, resource_id, target_type/id, role, alt_text, sort_order, crop_focus_json, variant, source_reference_id, status, version`；正式 Version 引用不可变 |
| DB-MED-004 | `media.media_deletion_jobs` | `deletion_job_id, resource_id, status, phase, attempt_count, max_attempts, next_retry_at, policy_versions, receipt_summary, version`；同资源一条非终态 Job |
| DB-MED-005 | `media.media_deletion_attempts` | `attempt_id, job_id, attempt_no, action, provider_result_code, result_hash, started_at, completed_at`；不存供应商敏感原文 |
| DB-PRI-001 | `private_material.verification_materials` | PRD VerificationMaterial 全字段；storage key 加密；独立服务账户；申请人仅粗粒度状态 |
| DB-PRI-002 | `private_material.material_read_grants` | `grant_id, material_id, reviewer_id, work_item_id, purpose, token_hash, expires_at, consumed_at`；≤5 分钟、一次读取 |
| DB-PRI-003 | `private_material.material_access_logs` | `access_id, material_id, actor_id, work_item_id, purpose, result, occurred_at`；append-only |

### 6.4 community 与 comparison

| Table ID | 表 | 关键字段与约束 |
| --- | --- | --- |
| DB-COM-001 | `community.interactions` | `interaction_id,user_id,type,target_type/id,state,client_request_id,updated_at`；`user+type+target` 唯一；最终状态幂等 |
| DB-COM-002 | `community.comments` | PRD Comment 字段；`user_id+client_request_id` 唯一；正文原快照保留，公开投影按 moderation_state |
| DB-COM-003 | `community.comment_reports` | `report_id,comment_id,reporter_user_id,reason_code,note_ciphertext,status,review_work_item_id,version`；同人+评论+理由唯一 |
| DB-COM-004 | `community.notifications` | PRD Notification 字段；`recipient_user_id+dedup_key` 唯一；先鉴权 recipient 再解析 target |
| DB-CMP-001 | `comparison.comparisons` | `comparison_id,owner_user_id,anonymous_subject_hash,category_id,comparison_version,status,expires_at,version`；user/anonymous owner XOR |
| DB-CMP-002 | `comparison.comparison_items` | `comparison_id,comparison_version,project_id,position,validity_status,invalid_reason`；2—5 完成，同品类，位置唯一 |
| DB-CMP-003 | `comparison.comparison_dimension_progress` | `comparison_id,comparison_version,dimension_group,visible_ms,last_event_at`；成员变化新版本清零 |
| DB-CMP-004 | `comparison.comparison_saves` | `comparison_id,comparison_version,user_id,saved_at,state`；每用户+版本唯一 |
| DB-CMP-005 | `comparison.comparison_merge_conflicts` | `conflict_id,anonymous_comparison_id,user_comparison_id,status,resolution_json,expires_at`；不得静默截断 |

### 6.5 search

| Table ID | 表 | 关键字段与约束 |
| --- | --- | --- |
| DB-SRCH-001 | `search.query_snapshots` | PRD QuerySnapshot；raw query 使用 envelope encryption；owner/expires 不变 |
| DB-SRCH-002 | `search.query_authorized_subjects` | `query_id,subject_hash,identity_link_id,authorized_at,revoked_at`；只由有效 IdentityLink 添加 |
| DB-SRCH-003 | `search.intent_versions` | `query_id,intent_version,intent_json,confidence_json,parser_version,created_at`；append-only |
| DB-SRCH-004 | `search.result_versions` | `result_version,query_id,intent_version,ranking_version,filter_snapshot_json,created_at,expires_at`；不可变 |
| DB-SRCH-005 | `search.result_items` | `result_version,group_id,result_item_id,project_id,position,channel,reason_json,token_binding_hash`；组内位置唯一 |
| DB-SRCH-006 | `search.navigation_contexts` | PRD SearchNavigationContext 全字段；`click_request_id+owner` 唯一；active→consumed 原子 |
| DB-SRCH-007 | `search.project_documents` | `project_id,version_id,category_id,visibility,structured_json,search_text,tsvector,ranking_features_json,indexed_at`；只索引当前可见 Version |
| DB-SRCH-008 | `search.project_embeddings` | `project_id,version_id,model_id,model_version,embedding,content_hash,indexed_at`；同 model/version 唯一；模型变化重建新行 |

## 7. IAM、配置和审计表

| Table ID | 表 | 关键字段与约束 |
| --- | --- | --- |
| DB-IAM-001 | `iam.users` | `user_id,status,role_version,privacy_state,created_at`；不存密码、OTP 或客户端自报角色 |
| DB-IAM-002 | `iam.user_roles` | `user_id,role,granted_by_operation_id,valid_from,valid_to`；有效区间不重叠 |
| DB-IAM-003 | `iam.sessions` | `session_id_hash,user_id,anonymous_subject_id,roles_version,status,recent_auth_at,expires_at,revoked_at`；Cookie HttpOnly/Secure/SameSite |
| DB-IAM-004 | `iam.identity_links` | `identity_link_id,anonymous_subject_id,user_id,purpose,status,issued_at,consumed_at,expires_at`；purpose 限定，一次消费 |
| DB-IAM-005 | `iam.admin_reauth_grants` | PRD AdminReauthGrant；绑定主 session 和 preview；一次消费 |
| DB-IAM-006 | `iam.role_change_requests` | PRD RoleChangeRequest；requester≠approver；保护最后管理员 |
| DB-IAM-007 | `iam.role_change_approvals` | `approval_id,request_id,approver_admin_id,decision,reason_code,created_at`；一请求一最终批准/拒绝 |
| DB-IAM-008 | `iam.user_email_identities` | `email_identity_id,user_id,normalized_email_hash,email_ciphertext,key_version,verified_at,status,created_at`；active normalized_email_hash 唯一；明文只在受控解密/发信用途出现 |
| DB-IAM-009 | `iam.auth_email_challenges` | `challenge_id,auth_flow_id,purpose,normalized_email_hash,otp_hash,otp_salt,primary_session_id_hash?,preview_token_hash?,status,attempt_count,max_attempts,send_receipt_ref,expires_at,consumed_at,created_at`；10分钟、最多5次、单次消费；不存明文 OTP/邮箱 |
| DB-IAM-010 | `iam.auth_rate_limit_buckets` | `scope_hash,scope_type,email_session_ip,window_started_at,attempt_count,blocked_until,updated_at`；限流摘要不得支持反查完整邮箱/IP |
| DB-TAX-001 | `taxonomy.category_schema_versions` | `category_id,schema_version,status,json_schema,comparison_dimension_map,search_field_map,content_hash,published_at`；已发布不可改 |
| DB-TAX-002 | `taxonomy.dictionary_versions` | `dictionary_key,version,status,entries_json,content_hash,published_at`；引用旧版本可继续解析 |
| DB-OPS-001 | `ops.outbox_events` | `outbox_id,aggregate_type/id,event_name,event_version,payload_json,transaction_id,status,attempt_count,next_attempt_at,created_at,published_at`；transaction+event 去重 |
| DB-OPS-002 | `ops.inbox_receipts` | `consumer_name,event_id,payload_hash,processed_at,result`；组合主键保证消费者幂等 |
| DB-OPS-003 | `ops.job_runs` | `job_run_id,job_type,target_type/id,status,attempt,policy_version,started_at,finished_at,error_code` |
| DB-OPS-004 | `ops.config_versions` | `config_key,version,status,value_json,schema_version,content_hash,published_at`；已发布不可改 |
| DB-OPS-005 | `ops.config_drafts` | `draft_id,config_key,base_version,value_json,status,validation_json,version`；发布创建新 config version |
| DB-AUD-001 | `audit.audit_logs` | `audit_id,operation_id,actor_user_id,actor_roles_json,target_type/id,before_hash,after_hash,diff_json,reason_code,evidence_refs_json,request_id,ip_risk_summary,result,created_at`；append-only |
| DB-AUD-002 | `audit.sensitive_read_logs` | `read_id,actor,target,purpose,grant_id,result,trace_id,created_at`；材料、私密证据、用户详情必记 |
| DB-AUD-003 | `audit.security_events` | `security_event_id,event_type,severity,actor/session hashes,target,error_code,metadata_json,created_at`；禁止写令牌和正文 |

## 8. Analytics 物理模型

### 8.1 ClientAnalyticsInput.v1

客户端请求对象只允许以下字段；`unevaluatedProperties=false`：

| 字段 | 类型 | 必填 | 来源 | 校验 |
| --- | --- | --- | --- | --- |
| `event_id` | UUID string | 是 | client | 每次行为生成；全局幂等 |
| `event_name` | string | 是 | client | 1—64；必须存在于 client 事件注册表 |
| `event_version` | integer | 是 | client | 与 name+client actor 的已发布 Schema 精确匹配 |
| `occurred_at` | RFC3339 datetime | 是 | client | 超前超过5分钟拒绝；迟到按质量规则标记或拒绝 |
| `app_version` | string | 是 | client | 1—32；必须是可识别构建版本 |
| `page_id` | string | 条件必填 | client | P01—P18/A01—A14 中事件定义允许的页面 |
| `source_page` | string | 否 | client | 同一 Page ID 注册表 |
| `request_id` | string | 否 | client | 1—64；只用于关联同次 BFF 请求 |
| `payload` | object | 是 | client | 由 event_name+event_version 判别；禁止 raw query、正文、自然人 ID 和主体三元组 |
| `session_id` | opaque string | 条件必填 | client/header | 与批次 Header 二选一；若 Header 存在则 item 禁止此字段 |

`received_at,environment,actor_type,consent_state,metric_subject_id,subject_kind,bridge_version,clock_skew_flag,user_id,anonymous_id,service_actor_id,transaction_id` 均禁止客户端提交。collector 从部署、会话、同意状态和身份桥产生合法 AnalyticsEnvelope。

### 8.2 事件与接收表

| Table ID | 表 | 关键字段与约束 |
| --- | --- | --- |
| DB-ANA-001 | `analytics.ingest_receipts` | `receipt_id,batch_hash,session_hash,http_status,accepted_count,rejected_count,created_at`；不保存自然人 ID |
| DB-ANA-002 | `analytics.ingest_items` | `receipt_id,event_id,status,error_code,payload_hash`；拒绝项仅存最小错误摘要，不存非法 payload |
| DB-ANA-003 | `analytics.events` | AnalyticsEnvelope 全字段；client 含 session_id_hash+事件时三元组，service 含 service_actor_id+transaction_id；`event_id` 唯一；按 `received_at` 月分区 |
| DB-ANA-004 | `analytics.identity_bridge_events` | `bridge_event_id,subject triple,link_action,canonical_subject_id,status,effective_at,source_identity_link_id,created_at`；append-only |

### 8.3 Bridge Snapshot 与指标资源

| Table ID | 表 | 关键字段与约束 |
| --- | --- | --- |
| DB-ANA-005 | `analytics.bridge_snapshots` | `snapshot_version bigint PK,status=building｜validated｜published｜revoked,previous_published_version,source_watermark,row_count,content_hash,built_by_operation_id,built_at,validated_at,published_at,revoked_at`；published 后映射不可改 |
| DB-ANA-006 | `analytics.bridge_snapshot_members` | `snapshot_version,input_metric_subject_id,input_subject_kind,input_bridge_version,canonical_metric_subject_id,canonical_subject_kind,mapping_status,reason_code`；完整输入三元组在 B 下唯一映射；canonical bridge version 隐含等于 B |
| DB-ANA-007 | `analytics.metric_definitions` | `metric_key,formula_version,formula_hash,definition_json,status,published_at`；公式版本不可改 |
| DB-ANA-008 | `analytics.metric_recompute_operations` | `operation_id,metric_key,snapshot_version,formula_version,window_json,category_id,event_watermark,request_hash,status=queued｜running｜succeeded｜failed｜cancelled,attempt_count,resulting_metric_version_id,error_code,created_at,started_at,finished_at`；operation_id 幂等 |
| DB-ANA-009 | `analytics.metric_versions` | `metric_version_id,metric_key,snapshot_version,formula_version,event_watermark,window_json,category_id,status=computing｜validated｜published｜revoked,quality_flags_json,content_hash,calculated_at,published_at,created_by_operation_id`；每次重算新建；published 不覆盖 |
| DB-ANA-010 | `analytics.metric_results` | `metric_version_id,dimension_key,dimension_value,numerator,denominator,value,sample_count,result_json`；组合主键；分母0时 value=NULL |

## 9. 主外键和跨 Schema 约束

### 9.1 数据库原生外键

- 同一 Schema 内稳定关系使用普通外键，默认 `ON DELETE RESTRICT`。
- append-only 子对象使用 `ON DELETE RESTRICT`；隐私删除通过匿名化或密钥销毁，不级联删除事实。
- 临时上传分片可在资源终止且无审计保留要求后 `ON DELETE CASCADE`。
- Version、Decision、Evidence、Event、Audit、Outbox 已发布记录永不级联删除。

### 9.2 Typed reference

`source_decision_type/source_decision_id`、`target_type/target_id` 不能只靠普通外键表达，使用三层约束：

1. `CHECK` 限制 type 枚举；
2. 同事务领域服务调用数据库约束函数验证目标表、target、project、base 和 transaction；
3. 延迟约束触发器在 COMMIT 前验证反向引用。

不得通过无约束字符串跳过验证。迁移脚本必须运行同一约束函数。

### 9.3 不变量

| Invariant ID | 不变量 | 实现 |
| --- | --- | --- |
| DB-INV-001 | 所有公开 Project 事实变化都有不可变 Version | Project pointer 触发器要求同事务存在 next Version |
| DB-INV-002 | 一 WorkItem 最多一个最终决定 | `work_item_id` 条件唯一；typed ref 延迟校验 |
| DB-INV-003 | 一 canonical Creator 最多一个非终态 owner Link | canonical key materialized 列+条件唯一索引 |
| DB-INV-004 | 同品类比较且每版本0—5项 | deferred trigger 校验 category 和计数；完成条件另由服务校验2—5 |
| DB-INV-005 | 关注蕴含收藏 | interaction command 同事务 upsert 两行；提交前断言 |
| DB-INV-006 | final Evidence 一对一源 Draft | `source_evidence_draft_id` 唯一 |
| DB-INV-007 | 公开署名仅 active AuthorRelation | 公开 Projection 只从受控 View 读取 |
| DB-INV-008 | Analytics 事实无 user_id | 列层面不存在；payload JSON Schema 和拒绝词扫描 |
| DB-INV-009 | 已发布指标不覆盖 | UPDATE/DELETE 权限撤销；只允许 status publish/revoke 专用函数 |
| DB-INV-010 | 审计不可删除 | 运行账户无 UPDATE/DELETE；归档由独立保全流程 |

## 10. 索引设计

### 10.1 公共读取

- `projects(category_id,review_status,updated_at desc,project_id)`
- `projects(category_id,access_status,review_status)`
- `project_versions(project_id,version_number desc)`
- `events(project_id,event_time desc,event_id desc)`
- `assets(project_id,availability_status,asset_type)`
- `author_relations(project_id,status,creator_id)`
- `creators(canonical_creator_id)`
- `evidence(object_type,object_id,field_path,validity_status)`

### 10.2 工作队列

- `review_work_items(work_type,status,created_at,work_item_id)` 条件 `status in ('queued','claimed')`
- Ownership 队列使用 `NOT EXISTS` anti-join 到 `ownership_conflict_principals(case_id,principal_version,user_id)`，过滤必须发生在 count/sort/cursor/page 之前。
- `lease_expires_at` 单列索引用于释放过期 claim。
- 所有队列游标包含排序字段和 stable ID，不用 OFFSET。

### 10.3 JSONB

- Project Version 快照以主键读取，不建全量 GIN。
- 搜索所需结构化字段投影到 `search.project_documents.structured_json`；只对已冻结过滤路径建表达式索引。
- 配置/决定 JSON 主要按 ID 读取；禁止为未知查询建立宽泛 GIN。

### 10.4 向量

- 冷启动先用 exact search；达到容量阈值后在固定 model/version 分区建立 HNSW cosine 索引。
- 召回 SQL 必须先限制 category_id、visibility、review_status 和 access policy；结果再按结构化分、语义分和可信分组合。
- 索引参数、召回率评估集和上线阈值受 TBC-007 约束。

## 11. 分区与容量

| 表 | 分区键 | 初始策略 | 归档 |
| --- | --- | --- | --- |
| `analytics.events` | `received_at` 月 | 当前月+未来2月预建 | 保留期按 TBC-009/013；历史分区只读 |
| `audit.audit_logs` | `created_at` 月 | 月分区 | 按法务保留策略归档，不由业务删除 |
| `ops.outbox_events` | `created_at` 月 | 月分区 | 全部消费者确认后保留最小 receipt |
| `catalog.events` | 不分区起步 | 以 project 索引 | 达容量门槛再按时间分区 |
| `search.result_items` | 不分区起步 | TTL 清理 | QuerySnapshot 过期后按作业删除 |

容量门槛必须来自压测和生产估算；未达到前不引入分库。MVP 默认单 PostgreSQL 集群、读副本可选、应用层模块化单体，避免分布式事务。

## 12. 事务边界

| TX ID | 事务 | 同事务写入 | 事务外动作 |
| --- | --- | --- | --- |
| TX-001 | Submission 发布 | Project、V1、Event、Asset、Evidence、Attachment、正式 MediaReference、Submission、Outbox | 搜索索引、通知、缓存 |
| TX-002 | ProjectUpdate 应用 | ReviewDecision 已存在；新 Version、Project pointer、Event、Evidence/Media 提升、Update、Outbox | 索引、通知 |
| TX-003 | Recheck apply | ReviewDecision、Version、Project pointer、Event、RecheckTask、WorkItem、Outbox | 重建索引、通知 |
| TX-004 | A03 公开事实编辑 | AdminFactDecision、Version、Project pointer、Evidence/Media、AdminOperation、Outbox | 索引、通知 |
| TX-005 | 作者验证批准 | VerificationRequest、Creator/ProfileVersion、Link、AuthorRelation、Project Version/状态、ReviewDecision、WorkItem、Outbox | 通知、索引 |
| TX-006 | Ownership 裁定 | ReviewDecision、Case、WithdrawalRequest、AuthorRelation、Project Version/状态、WorkItem、Outbox | 通知、索引 |
| TX-007 | Creator Profile 发布 | CreatorProfileExecutionDecision、ProfileVersion、正式头像引用、Creator pointer/version、Draft、WorkItem、Outbox | 缓存、通知 |
| TX-008 | 互动设置 | Interaction 行、蕴含关系、计数 delta、Outbox | Analytics service 事件 |
| TX-009 | 评论审核 | ReviewDecision、Comment、Report、计数 delta、WorkItem、Outbox | 通知 |
| TX-010 | 搜索导航创建 | NavigationContext、点击证明 Outbox | Analytics consumer |
| TX-011 | P08 搜索到达 | Context consume、详情到达证明 Outbox | Analytics consumer |
| TX-012 | 指标重算启动 | RecomputeOperation queued、Outbox | worker 扫描事件并建 MetricVersion |

任何 TX 失败均不得留下半决定、半 Version、半 Evidence、已消费令牌或已移动 pointer。

## 13. 并发与幂等

- Command 接口先按 `operation_id/client_request_id/idempotency_key` 查 receipt，再读取可能已过期的 token。
- `expected_version` 使用 `UPDATE ... WHERE id=? AND version=?`；影响行数0返回 409 canonical ConflictResponse。
- Claim 使用行锁和租约，不在领域对象保存领取状态。
- Creator owner 唯一性、current Version、current Profile、active withdrawal request、active WorkItem 使用条件唯一索引和 CAS 双重保护。
- Outbox 生产与业务写同事务；消费者以 `consumer_name+event_id` Inbox 去重。
- 令牌只存哈希；成功消费与领域写同事务。已提交响应丢失按 receipt 回放，不因令牌到期把成功改为失败。

## 14. 数据安全

- RLS 作为纵深防御，不替代 API RBAC/ACL。`private_material`、本人草稿、通知、Comparison、QuerySnapshot 和 Analytics 管理查询启用按服务角色隔离的策略。
- 公共 API 只读数据库 View/Projection，不直接 SELECT 领域主表。
- Ownership party/reviewer 使用两套显式 SQL projection；禁止通用 Case serializer。
- 受保护列使用 envelope encryption；密钥版本随密文保存。数据库不得存上传签名 URL、明文 token、密码、明文邮箱验证码、完整 IP 或 user agent。
- 日志和 Analytics 禁止 raw query、评论正文、私密证据、验证材料、自然人 ID。
- 数据主体删除、导出、保全和跨境规则受 TBC-013；技术表预留 `privacy_state/deletion_request_id`，但不自行定义法定期限。

## 15. 保留和删除

| 数据类别 | 策略 |
| --- | --- |
| Project/Version/Event/Decision/Audit | 永久逻辑保留或依法保全；公开删除只产生墓碑 |
| 草稿、匿名比较、通知正文、QuerySnapshot | 期限由 TBC-009 配置；到期净化正文并保留最小审计 |
| VerificationMaterial | 按提交时 retention_policy_version；LEGAL_HOLD 只延迟物理删除 |
| MediaResource | 仅零引用且无保全时经删除 Saga；对象删除 receipt 确认后写 succeeded |
| Analytics 人级事实 | 按 TBC-009/013；删除使 identity bridge 断链，历史聚合不反查自然人 |
| Outbox/Inbox | 保留到全部消费者确认和审计期结束；随后归档最小 receipt |

## 16. 迁移策略

### 16.1 Schema 迁移

1. Expand：新增表/列/索引/双写能力；
2. Backfill：按固定水位分批迁移并记录数量和哈希；
3. Verify：新旧读模型、外键、不变量和指标对账；
4. Switch：切换读取与写入；
5. Contract：至少一个兼容发布后删除旧列/旧写路径。

禁止同一发布同时新增新列并删除旧列。大索引使用在线创建策略；失败可安全重试。

### 16.2 原型数据

当前 `src/mocks` 和 localStorage 不是生产事实，不执行自动生产迁移。若需冷启动种子，只通过受审计 importer 写平台建档草稿并走审核，不直接 INSERT published Project。

### 16.3 固定种子

- `OWNER_V1` hash：`8d9ca77abf8c83611d8eed83bba8318807db6d9c4bd69d6d93f1c83014c69a7c`
- `MANAGER_V1` hash：`72f2b162c65ff2d145cb9f38407653b18906e067dd3c43afda8c1a524f56165d`

迁移器、身份服务和 ProjectUpdate 鉴权服务启动时独立重算；不一致 fail closed。

## 17. 数据库验收

| Test ID | Given | When | Then |
| --- | --- | --- | --- |
| DB-AC-001 | Recheck apply 指向 P1/V7 | 提交合法 ReviewDecision | 同事务创建 V8、更新 pointer、关闭 Task/WorkItem；任一步失败全回滚 |
| DB-AC-002 | 同用户同时命中 opened_by 和 evidence_submitter | 读取 party projection | `party_roles` 按固定顺序返回两个值；allowed_actions 由事实矩阵计算 |
| DB-AC-003 | ClientAnalyticsInput 含 environment 或 user_id | 批量接收 | item rejected；Analytics 事实表无行，拒绝摘要不含非法值 |
| DB-AC-004 | B5 已发布、B6 未发布 | 查询指标 | B5 可读；B6 返回404/409且 GET 不创建 MetricVersion |
| DB-AC-005 | 两个并发 owner Link 审批基于同 owner_set_version | 提交 | 仅一个成功；败者409，零半对象 |
| DB-AC-006 | Evidence 提升第 N 项失败 | 发布事务 | 全事务回滚，Draft 仍 ready，无半 Evidence/Attachment/Version |
| DB-AC-007 | 同 operation_id 相同 payload 重放 | 首次响应丢失后重试 | 返回同 receipt；不重复决定、事件和通知 |
| DB-AC-008 | 同 operation_id 不同 payload | 重试 | 409 IDEMPOTENCY_PAYLOAD_MISMATCH |
| DB-AC-009 | Ownership 冲突管理员请求队列 | 计算 total/cursor/page | 在 count 前排除；响应不存在占位或侧信道 |
| DB-AC-010 | 已发布 MetricVersion | 尝试 UPDATE/DELETE | 数据库权限拒绝；纠错只能新建版本或受审计 revoke |

## 18. 待确认与冻结门禁

| 项目 | 对应 TBC/问题 | 阻断 |
| --- | --- | --- |
| Render PostgreSQL 实例、HA、备份、RPO/RTO、密钥 | TBC-006（平台/区域/PG18 已确认） | 生产上线 |
| 草稿、比较、通知、查询、材料保留期 | TBC-009 | 数据治理签字 |
| 删除/导出、法定保留、跨境 | TBC-013 | 隐私签字 |
| 向量模型、供应商、成本与 SLA | TBC-003/007 | 搜索生产集成和质量验收 |
| 抓取 robots/版权合规（P0 不做 JS 渲染/截图） | TBC-004 | 生产抓取 |
| 小样本阈值 | TBC-010 | A13 导出和运营 SOP |
| TD-DB-001—004 回写 PRD | V19-01—V19-04 | 对应数据库表、接口和联调冻结 |
| PRD 文件名/Git/评审/SHA | V19-05 | 唯一发布基线声明 |

## 19. 数据库设计完成度自检

| 检查项 | 结果 |
| --- | --- |
| 九个 PRD 核心实体均映射到物理表 | 通过 |
| 发布、更新、验证、争议、复检、媒体、评论、Analytics 工作流均有表 | 通过 |
| typed decision、Version、Evidence 外键有确定校验 | 通过；TD-DB-001 待回写 |
| 幂等、CAS、租约、Outbox 和 receipt 有数据对象 | 通过 |
| party/reviewer 最小披露不依赖通用 serializer | 通过；TD-DB-002 待回写 |
| ClientAnalyticsInput 和指标快照资源可落库 | 通过；TD-DB-003/004 待回写 |
| 保留、隐私、备份未被主观编造 | 通过；集中列 TBC |
| 未把 Mock/localStorage 当生产实现 | 通过 |
