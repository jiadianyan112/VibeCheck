
# VibeCheck 首期 MVP 接口清单与契约

**版本：v1.0｜状态：已批准开发基线（WP-00）｜日期：2026-08-10**

## 1. 文档目的

本文把 PRD v1.10 的 Interface ID 和 Operation ID 固化为 API 资源、认证、请求、响应、错误、幂等、并发、事件接收和指标控制面规范。本文是 OpenAPI 生成、前后端联调、契约测试和安全评审的输入；不以页面 Mock 或现有 TypeScript 类型替代服务端 Schema。

## 2. 契约基线

| 项目 | 规范 |
| --- | --- |
| API 风格 | HTTPS JSON REST；命令型复杂事务使用名词资源或 `actions/recomputations` 子资源 |
| 对外版本 | `/api/v1`；不在同一路径静默改变字段语义 |
| 描述格式 | OpenAPI 3.1.2；Schema 使用 JSON Schema 2020-12 |
| 字段命名 | JSON `snake_case`；URL path/query `snake_case` |
| 字符编码 | UTF-8 |
| 时间 | RFC3339 UTC，输出含 `Z` |
| ID | UUID/受控 opaque ID；客户端不得推断顺序或类型 |
| 未知字段 | 写请求默认拒绝；JSON Schema `unevaluatedProperties=false` |
| 空值 | “字段缺失”和显式 `null` 分别校验；不得用空字符串替代 null |
| 金额 | 本版无金额字段 |
| Schema 源 | 一份版本化 JSON Schema 同时生成服务端验证、TypeScript client 和契约 fixture |

参考标准：

- <https://spec.openapis.org/oas/>
- <https://json-schema.org/draft/2020-12>

## 3. v1.9 复审接口决策

| Decision ID | 对应问题 | 唯一接口结论 | 回写要求 |
| --- | --- | --- | --- |
| TD-API-001 | V19-01 | Recheck `decision=apply` 仍经 `OP-ADMIN-DECISION`，但响应和事务必须返回/创建合法 `review_decision_id+version_id+event_id`；ReviewDecision target 为 recheck_task，project/base 与 Version 精确一致。 | PRD Version 判别外键与 Recheck 用例 |
| TD-API-002 | V19-02 | Ownership party 响应字段改为 `party_roles[]`，固定排序；`allowed_actions` 由服务端按事实角色和 Case 状态派生。 | PRD Projection/Operation/测试 |
| TD-API-003 | V19-03 | 冻结 `BatchEnvelope.v1` 和 `ClientAnalyticsInput.v1`；身份、环境、actor、received_at、consent 和 bridge 均由 collector 产生。 | PRD Analytics 字段字典 |
| TD-API-004 | V19-04 | `OP-ANALYTICS-QUERY` 只读；快照构建/发布、指标重算/发布均使用独立 POST Command 和状态资源。 | PRD A13/IF-ANALYTICS-001 |

## 4. 认证与授权

### 4.1 安全方案

| Scheme | 使用者 | 载体 | 服务端校验 |
| --- | --- | --- | --- |
| `public` | 游客 | 无凭据；限流 cookie 可选 | IP/风险限流；不产生自然人身份 |
| `session_cookie` | 注册用户/作者/后台人员 | HttpOnly、Secure、SameSite Cookie | session active、roles_version、风险状态、CSRF |
| `verified_author_capability` | 已验证作者 | session_cookie | active Link→固定 PermissionProfile→canonical Creator→active AuthorRelation→capability/field intersection |
| `editor_role` | 平台编辑 | session_cookie | role active、对象 ACL、职责分离、WorkItem |
| `admin_role` | 管理员 | session_cookie | role active、对象 ACL、利益冲突、必要时双主体审批 |
| `admin_confirm` | 高风险后台命令 | preview_token+confirm_token；必要时 reauth_grant | actor、主 session、roles_version、target、diff、TTL、一次消费 |
| `service_identity` | 内部服务/worker | 工作负载身份或 mTLS | service allowlist、audience、transaction_id、Schema 分支 |
| `signed_upload` | 媒体/材料上传 | 短期单用途签名 URL | resource、part、checksum、size、expiry |

所有 Cookie 写请求必须通过 CSRF；CORS 仅允许已批准同站 Origin。客户端不得提交 `user_id`、后台角色、creator_id、permissions 或 service_actor_id 作为鉴权依据。

### 4.2 可见性与实际鉴权

- “按钮不可见”不构成权限；每个 Operation 在服务端重复校验角色、对象、字段和状态。
- 非当事人读取私密资源优先返回 404 防枚举；已知对象但状态过期返回 410。
- Ownership reviewer 命中冲突主体返回 403，不降级为 party，不返回冲突原因集合。
- 公共 Project 读取只返回 public Projection；party/reviewer 使用独立判别 Schema。
- 后台导出是独立受审计动作，不复用普通列表响应绕过小样本和字段限制。

## 5. 请求和响应公共规范

### 5.1 请求 Header

| Header | 必填范围 | 规则 |
| --- | --- | --- |
| `X-Request-Id` | 推荐全部请求 | 1—64；非法则服务端重建；响应回显最终值 |
| `traceparent` | 可选 | 符合 W3C Trace Context；服务端可重建 |
| `X-CSRF-Token` | session Cookie 下所有写操作 | 与 session 绑定；失败403 |
| `Idempotency-Key` | 创建资源且 PRD 指定的 Operation | 1—64；同主体+Operation scope 唯一 |
| `If-None-Match` | 公开版本化 GET | ETag 命中返回304 |
| `Accept-Language` | 可选 | 只影响 message_key 的客户端呈现，不改变 error_code |
| `X-Analytics-Session` | Analytics batch 条件必填 | 与 item.session_id 二选一 |

`expected_version` 保持在命令 body 中，避免 Header/body 两套并发值。服务端响应可返回 ETag 供缓存，但写入仍以 body 的 expected_version 为唯一 CAS 输入。

### 5.2 成功响应

- 单资源 GET：直接返回版本化 Projection，并含 `read_version` 或 `version`。
- 列表：`{items,next_cursor,total_count?,result_version?}`；只有权限过滤完成后才计算 total_count。
- 创建：201；异步受理：202；幂等重复可返回原 200/201/202 receipt。
- 删除/解绑：204；若删除本身是 Saga，则202返回 Job。
- 所有响应 Header 含 `X-Request-Id`；可缓存响应含 `ETag` 和明确 `Cache-Control`。

### 5.3 错误响应

```json
{
  "error": {
    "code": "PROFILE_REBASE_REQUIRED",
    "message_key": "creator_profile.rebase_required",
    "request_id": "01JZ6Q6P6A4H5J6K7M8N9P0Q1R",
    "field_errors": [
      {
        "path": "/conflict_resolutions/0/field_path",
        "code": "MISSING_RESOLUTION"
      }
    ],
    "retryable": false,
    "retry_after_ms": null,
    "conflict": {
      "current_version": 8,
      "expected_version": 7,
      "conflict_token": null
    }
  }
}
```

| HTTP | 语义 |
| --- | --- |
| 400 | JSON/HTTP envelope 无法解析 |
| 401 | 未认证或 session 失效 |
| 403 | 已认证但角色、对象、字段、职责分离或冲突校验失败 |
| 404 | 不存在或为防枚举不可披露 |
| 409 | 版本、幂等载荷、唯一约束或领域并发冲突 |
| 410 | 已过期、终止、撤销且调用方有权知道 |
| 413 | body/文件/批次超限 |
| 415 | MIME/Content-Type 不允许 |
| 422 | 结构可解析但字段或状态前置条件非法 |
| 423 | 媒体删除 guard/法律保全锁 |
| 429 | 限流；必须返回 Retry-After |
| 503 | 依赖不可用且不得降级 |
| 504 | 上游超时 |

错误响应禁止返回 SQL、堆栈、token、权限集合、私密正文、存储 Key、供应商原始响应或自然人标识。

## 6. 幂等、并发与分页

### 6.1 幂等

- 创建型写入按 `actor scope+operation_id/idempotency_key/client_request_id` 建唯一 receipt。
- 同键相同 payload hash 返回原响应；同键异 payload 返回409 `IDEMPOTENCY_PAYLOAD_MISMATCH`。
- 已提交但响应丢失时先返回 receipt，再判断 claim/preview/confirm/rebase token 是否已过期。
- Outbox 消费按 `consumer_name+event_id` 去重。

### 6.2 并发

- 每个可变聚合命令携带 `expected_version`。
- 409 响应返回 canonical ConflictResponse，不静默覆盖、不自动选择 local/remote。
- WorkItem claim 使用60秒 lease、30秒 heartbeat 候选值；最大续租时长由系统配置冻结。
- Creator owner、current Version、current Profile、active withdrawal request 和 active WorkItem 由数据库唯一约束+CAS。

### 6.3 游标

- 游标是服务端签名 opaque 字符串，绑定 filter hash、sort、result/schema version、最后排序值和 stable ID。
- filter/sort/version 改变后旧游标422或410，不重新解释。
- Ownership staff queue 在冲突过滤后计算 count、sort、cursor 和 page。
- 禁止公开使用 OFFSET 作为稳定分页契约。

## 7. Operation 总清单

本表列出 PRD v1.10 的全部 138 个既有 Operation。关键请求、响应、错误和事务仍以 PRD 对应行及本文公共规范共同约束；第 9 章列出为关闭 V19-04 新增的 8 个 Operation。

| Operation ID | Interface ID | Method 与路径 | 鉴权 | 来源 |
| --- | --- | --- | --- | --- |

| OP-PROJ-LIST | IF-PROJ-001 | GET `/api/v1/projects` | 公共/会话投影 | PRD v1.10 |
| OP-PROJ-GET | IF-PROJ-001 | GET `/api/v1/projects/{project_id}` | 按作品可见性；party/reviewer 另校验 Link/WorkItem ACL | PRD v1.10 |
| OP-INTERACT-SET | IF-INTERACT-001 | PUT `/api/v1/interactions/{type}/{target_type}/{target_id}` | 注册且账户可写 | PRD v1.10 |
| OP-COMMENT-LIST | IF-COMM-001 | GET `/api/v1/projects/{project_id}/comments` | 按作品可见性 | PRD v1.10 |
| OP-COMMENT-CREATE | IF-COMM-001 | POST `/api/v1/projects/{project_id}/comments` | 注册且账户可写 | PRD v1.10 |
| OP-COMMENT-REPORT | IF-COMM-003 | POST `/api/v1/comments/{comment_id}/reports` | 注册 | PRD v1.10 |
| OP-COMMENT-WITHDRAW | IF-COMM-004 | POST `/api/v1/comments/{comment_id}/withdraw` | 评论作者 | PRD v1.10 |
| OP-COMP-GET | IF-COMP-001 | GET `/api/v1/comparisons/{comparison_id}` | 签名匿名主体/所有者 | PRD v1.10 |
| OP-COMP-PUT | IF-COMP-001 | PUT `/api/v1/comparisons/{comparison_id}` | 签名匿名主体/所有者 | PRD v1.10 |
| OP-COMP-SAVE | IF-COMP-001 | PUT `/api/v1/comparisons/{comparison_id}/saved` | 注册所有者 | PRD v1.10 |
| OP-SEARCH | IF-SEARCH-001 | POST `/api/v1/search` | raw query 创建为公共限流；query_id 分支为 owner/authorized subject | PRD v1.10 |
| OP-INTENT-PARSE | IF-INTENT-001 | POST `/api/v1/intents` | 公共限流 | PRD v1.10 |
| OP-INTENT-CONFIRM | IF-INTENT-001 | POST `/api/v1/intents/{query_id}/versions` | QuerySnapshot owner/authorized subject | PRD v1.10 |
| OP-DISCOVER | IF-DISC-001 | POST `/api/v1/discover-results` | QuerySnapshot owner/authorized subject | PRD v1.10 |
| OP-SEARCH-NAV-CREATE | IF-SEARCH-001、IF-DISC-001 | POST `/api/v1/search-navigation-contexts` | result_item_token 所属 owner/authorized subject | PRD v1.10 |
| OP-QUERY-GET | IF-QUERY-001 | GET `/api/v1/query-snapshots/{query_id}` | 当前 owner/authorized subject | PRD v1.10 |
| OP-QUERY-LINK | IF-QUERY-001 | POST `/api/v1/query-snapshots/{query_id}/authorized-subjects` | 认证用户且持有效 purpose=query_continuation IdentityLink | PRD v1.10 |
| OP-QUERY-UNLINK | IF-QUERY-001 | DELETE `/api/v1/query-snapshots/{query_id}/authorized-subjects/me` | 当前 linked user | PRD v1.10 |
| OP-QUERY-INVALIDATE | IF-QUERY-001 | DELETE `/api/v1/query-snapshots/{query_id}` | 当前 owner/authorized subject | PRD v1.10 |
| OP-URL-CHECK | IF-SUB-001 | POST `/api/v1/submission-url-checks` | 注册 | PRD v1.10 |
| OP-DRAFT-CREATE | IF-SUB-002 | POST `/api/v1/submission-drafts` | 注册 | PRD v1.10 |
| OP-DRAFT-GET | IF-SUB-002 | GET `/api/v1/submission-drafts/{draft_id}` | 草稿所有者/授权审核者 | PRD v1.10 |
| OP-DRAFT-PATCH | IF-SUB-002 | PATCH `/api/v1/submission-drafts/{draft_id}` | 草稿所有者 | PRD v1.10 |
| OP-DRAFT-REVISE | IF-SUB-002 | POST `/api/v1/submissions/{submission_id}/revision-drafts` | 原 Submission 所有者 | PRD v1.10 |
| OP-SUBMIT | IF-SUB-003 | POST `/api/v1/submissions` | 草稿所有者 | PRD v1.10 |
| OP-SUB-WITHDRAW | IF-SUB-003 | POST `/api/v1/submissions/{submission_id}/withdraw` | Submission 所有者 | PRD v1.10 |
| OP-MEDIA-CREATE | IF-MEDIA-001 | POST `/api/v1/media-resources` | 注册 | PRD v1.10 |
| OP-MEDIA-PART | IF-MEDIA-001 | PUT `/api/v1/media-resources/{id}/parts/{part}` | 资源所有者签名凭证 | PRD v1.10 |
| OP-MEDIA-COMPLETE | IF-MEDIA-001 | POST `/api/v1/media-resources/{id}/complete` | 资源所有者 | PRD v1.10 |
| OP-MEDIA-STATUS | IF-MEDIA-001 | GET `/api/v1/media-resources/{id}` | 资源所有者/授权审核者 | PRD v1.10 |
| OP-MEDIA-DELETE | IF-MEDIA-DELETE-001 | DELETE `/api/v1/media-resources/{id}` | 资源所有者/管理员 | PRD v1.10 |
| OP-MEDIA-DELETE-JOB-GET | IF-MEDIA-DELETE-001 | GET `/api/v1/media-deletion-jobs/{deletion_job_id}` | 资源 owner/管理员 | PRD v1.10 |
| OP-MEDIA-DELETE-JOB-ACTION | IF-MEDIA-DELETE-001 | POST `/api/v1/media-deletion-jobs/{deletion_job_id}/actions` | owner retry/cancel；管理员 retry/repair | PRD v1.10 |
| OP-MEDIA-REF-CREATE | IF-MEDIA-REF-001 | POST `/api/v1/media-references` | 暂存目标所有者/授权编辑；正式目标仅内部事务 | PRD v1.10 |
| OP-MEDIA-REF-LIST | IF-MEDIA-REF-001 | GET `/api/v1/media-references` | 目标所有者/授权读取者 | PRD v1.10 |
| OP-MEDIA-REF-PATCH | IF-MEDIA-REF-001 | PATCH `/api/v1/media-references/{media_reference_id}` | 草稿目标所有者/授权编辑 | PRD v1.10 |
| OP-MEDIA-REF-DELETE | IF-MEDIA-REF-001 | DELETE `/api/v1/media-references/{media_reference_id}` | 草稿目标所有者/管理员 | PRD v1.10 |
| OP-EVID-DRAFT-CREATE | IF-EVID-001 | POST `/api/v1/evidence-drafts` | parent owner/授权编辑 | PRD v1.10 |
| OP-EVID-DRAFT-GET | IF-EVID-001 | GET `/api/v1/evidence-drafts/{evidence_draft_id}` | owner/已领取审核者字段 ACL | PRD v1.10 |
| OP-EVID-DRAFT-PATCH | IF-EVID-001 | PATCH `/api/v1/evidence-drafts/{evidence_draft_id}` | owner/授权编辑 | PRD v1.10 |
| OP-EVID-DRAFT-BIND | IF-EVID-001 | POST `/api/v1/evidence-drafts/{evidence_draft_id}/binding` | owner/授权编辑 | PRD v1.10 |
| OP-EVID-DRAFT-COMPLETE | IF-EVID-001 | POST `/api/v1/evidence-drafts/{evidence_draft_id}/complete` | owner/授权编辑 | PRD v1.10 |
| OP-EVID-ATTACH-CREATE | IF-EVID-ATTACH-001 | POST `/api/v1/evidence-drafts/{evidence_draft_id}/attachments` | parent owner/授权编辑 | PRD v1.10 |
| OP-EVID-ATTACH-DELETE | IF-EVID-ATTACH-001 | DELETE `/api/v1/evidence-attachment-drafts/{attachment_draft_id}` | parent owner/授权编辑 | PRD v1.10 |
| OP-EVID-ATTACH-READ-GRANT | IF-EVID-ATTACH-001 | POST `/api/v1/evidence-attachments/{id}/read-grants` | Evidence viewer ACL/已领取审核者 | PRD v1.10 |
| OP-EVID-DRAFT-WITHDRAW | IF-EVID-001 | POST `/api/v1/evidence-drafts/{evidence_draft_id}/withdraw` | owner/授权编辑 | PRD v1.10 |
| OP-VER-DRAFT-CREATE | IF-VER-001 | POST `/api/v1/verification-requests` | 注册 | PRD v1.10 |
| OP-VER-GET | IF-VER-001、IF-VER-002 | GET `/api/v1/verification-requests/{verification_id}` | 申请人/已领取审核者 | PRD v1.10 |
| OP-VER-DRAFT-PATCH | IF-VER-001 | PATCH `/api/v1/verification-requests/{verification_id}` | 申请所有者 | PRD v1.10 |
| OP-VER-SUBMIT | IF-VER-001 | POST `/api/v1/verification-requests/{verification_id}/submit` | 申请所有者 | PRD v1.10 |
| OP-VER-SUPPLEMENT | IF-VER-002 | POST `/api/v1/verification-requests/{verification_id}/supplements` | 申请人 | PRD v1.10 |
| OP-VER-WITHDRAW | IF-VER-001、IF-VER-002 | POST `/api/v1/verification-requests/{verification_id}/withdraw` | 申请所有者 | PRD v1.10 |
| OP-VER-MATERIAL-PREPARE | IF-VER-MATERIAL-001 | POST `/api/v1/verification-materials` | 申请所有者 | PRD v1.10 |
| OP-VER-MATERIAL-COMPLETE | IF-VER-MATERIAL-001 | POST `/api/v1/verification-materials/{material_id}/complete` | 材料所有者 | PRD v1.10 |
| OP-VER-MATERIAL-GET | IF-VER-MATERIAL-001 | GET `/api/v1/verification-materials/{material_id}` | 材料所有者或已领取且有字段 ACL 的审核者 | PRD v1.10 |
| OP-VER-MATERIAL-READ-GRANT | IF-VER-MATERIAL-001 | POST `/api/v1/verification-materials/{material_id}/read-grants` | 已领取对应 WorkItem 且有字段 ACL 的审核者 | PRD v1.10 |
| OP-VER-MATERIAL-REVOKE | IF-VER-MATERIAL-001 | POST `/api/v1/verification-materials/{material_id}/revoke` | 申请人/争议管理员 | PRD v1.10 |
| OP-OWNERSHIP-CREATE | IF-OWNERSHIP-001 | POST `/api/v1/ownership-cases` | 编辑/管理员 | PRD v1.10 |
| OP-OWNERSHIP-GET | IF-OWNERSHIP-001 | GET party `/api/v1/me/ownership-cases/{case_id}`；reviewer `/api/v1/admin/ownership-cases/{case_id}` | 当事人经 party 路由；无冲突且已领取审核者经 reviewer 路由 | PRD v1.10 |
| OP-OWNERSHIP-EVIDENCE-ADD | IF-OWNERSHIP-001 | POST `/api/v1/ownership-cases/{case_id}/evidence-submissions` | 关系当事账户/编辑/管理员 | PRD v1.10 |
| OP-OWNERSHIP-WITHDRAW-REQUEST | IF-OWNERSHIP-001 | POST `/api/v1/ownership-cases/{case_id}/withdrawal-requests` | 立案人/管理员 | PRD v1.10 |
| OP-OWNERSHIP-WITHDRAW-REJECT | IF-OWNERSHIP-001 | POST `/api/v1/ownership-cases/{case_id}/withdrawal-requests/{withdrawal_request_id}/reject` | 当前领取管理员 | PRD v1.10 |
| OP-UPD-CREATE | IF-UPD-001 | POST `/api/v1/project-updates` | 关联作者/编辑 | PRD v1.10 |
| OP-UPD-GET | IF-UPD-001 | GET `/api/v1/project-updates/{update_id}` | 所有者/授权审核者 | PRD v1.10 |
| OP-UPD-PATCH | IF-UPD-001 | PATCH `/api/v1/project-updates/{update_id}` | 所有者 | PRD v1.10 |
| OP-UPD-RESUME | IF-UPD-001 | POST `/api/v1/project-updates/{update_id}/resume` | 所有者 | PRD v1.10 |
| OP-UPD-SUBMIT | IF-UPD-002 | POST `/api/v1/project-updates/{update_id}/submit` | 所有者 | PRD v1.10 |
| OP-UPD-WITHDRAW | IF-UPD-002 | POST `/api/v1/project-updates/{update_id}/withdraw` | 所有者 | PRD v1.10 |
| OP-CREATOR-GET | IF-CRE-001 | GET `/api/v1/creators/{creator_id}` | 公共/可见性 | PRD v1.10 |
| OP-CREATOR-LINK-GET | IF-CREATOR-LINK-001 | GET `/api/v1/creator-account-links/{creator_account_link_id}` | 当前 link 用户/已领取审核者/管理员 ACL | PRD v1.10 |
| OP-CREATOR-LINK-LIST | IF-CREATOR-LINK-001 | GET `/api/v1/me/creator-account-links` | 当前注册用户 | PRD v1.10 |
| OP-AUTHOR-REL-GET | IF-AUTHOR-REL-001 | GET `/api/v1/author-relations/{author_relation_id}` | public 仅 active 最小投影；当事人需 active/suspended Link；审核者需 WorkItem/ACL | PRD v1.10 |
| OP-AUTHOR-REL-LIST | IF-AUTHOR-REL-001 | GET `/api/v1/author-relations` | 按 Creator/Project 可见性 | PRD v1.10 |
| OP-ME-GET | IF-ME-001 | GET `/api/v1/me/{section}` | 注册 | PRD v1.10 |
| OP-EVENT-LIST | IF-EVENT-001 | GET `/api/v1/projects/{project_id}/events` | 按作品可见性 | PRD v1.10 |
| OP-ASSET-LIST | IF-ASSET-001 | GET `/api/v1/projects/{project_id}/assets` | 按作品可见性 | PRD v1.10 |
| OP-ASSET-RESOLVE | IF-ASSET-001 | POST `/api/v1/assets/{asset_id}/resolve` | 按作品可见性 | PRD v1.10 |
| OP-AUTH-START | IF-AUTH-001 | POST `/api/v1/auth/email-challenges` | 公共 login/已有主会话 admin_confirm | PRD v1.10；邮箱验证码 challenge |
| OP-AUTH-CALLBACK | IF-AUTH-001 | POST `/api/v1/auth/email-challenges/{challenge_id}/verify` | 持 challenge 的同站浏览器 | PRD v1.10；OTP 单次验证 |
| OP-AUTH-SESSION-GET | IF-AUTH-001 | GET `/api/v1/auth/session` | 会话 | PRD v1.10 |
| OP-AUTH-SESSION-DELETE | IF-AUTH-001 | DELETE `/api/v1/auth/session` | 会话 | PRD v1.10 |
| OP-AUTH-PENDING-CREATE | IF-AUTH-001 | POST `/api/v1/auth/pending-actions` | 签名匿名/当前会话主体 | PRD v1.10 |
| OP-AUTH-PENDING-GET | IF-AUTH-001 | GET `/api/v1/auth/pending-actions/{id}` | 当前 owner 或持本 auth_flow purpose=pending_action_replay IdentityLink 的用户 | PRD v1.10 |
| OP-AUTH-PENDING-CONSUME | IF-AUTH-001 | POST `/api/v1/auth/pending-actions/{id}/consume` | 持本 auth_flow purpose=pending_action_replay IdentityLink 的用户＋领域执行服务签名 | PRD v1.10 |
| OP-AUTH-PENDING-CANCEL | IF-AUTH-001 | POST `/api/v1/auth/pending-actions/{id}/cancel` | 当前 owner 或持本 auth_flow purpose=pending_action_replay IdentityLink 的用户 | PRD v1.10 |
| OP-AUTH-MERGE-GET | IF-AUTH-001 | GET `/api/v1/auth/comparison-merge-conflicts/{conflict_id}` | 当前认证主体且 purpose=comparison_merge IdentityLink 匹配 | PRD v1.10 |
| OP-AUTH-MERGE-RESOLVE | IF-AUTH-001 | POST `/api/v1/auth/comparison-merge-conflicts/{conflict_id}/resolve` | 当前认证主体 | PRD v1.10 |
| OP-AUTH-MERGE-CANCEL | IF-AUTH-001 | POST `/api/v1/auth/comparison-merge-conflicts/{conflict_id}/cancel` | 当前认证主体 | PRD v1.10 |
| OP-AUTH-PENDING-INPUT-CREATE | IF-AUTH-001 | POST `/api/v1/auth/pending-inputs` | 签名匿名主体 | PRD v1.10 |
| OP-AUTH-PENDING-INPUT-CONSUME | IF-AUTH-001 | POST `/api/v1/auth/pending-inputs/{ref}/consume` | 认证后同一主体/state | PRD v1.10 |
| OP-NOTIF-LIST | IF-NOTIF-001 | GET `/api/v1/notifications` | 注册 | PRD v1.10 |
| OP-NOTIF-READ | IF-NOTIF-002 | PUT `/api/v1/notifications/read-state` | 注册 | PRD v1.10 |
| OP-TAX-GET | IF-TAX-001 | GET `/api/v1/taxonomies/{category_id}` | 公共 | PRD v1.10 |
| OP-ADMIN-PREVIEW | IF-ADMIN-AUTH-001 | POST `/api/v1/admin/operations/preview` | 对应编辑/管理员权限 | PRD v1.10 |
| OP-ADMIN-CONFIRM | IF-ADMIN-AUTH-001 | POST `/api/v1/admin/operations/confirm` | 预览 actor 的同一主会话 | PRD v1.10 |
| OP-ADMIN-EXECUTE | IF-MERGE-001、IF-ADMIN-PROJ-002、IF-TAX-002、IF-USER-ADMIN-001、IF-CONFIG-002 | POST `/api/v1/admin/operations/execute` | 对应直接管理权限；Creator Profile 还须当前 WorkItem 领取者 | PRD v1.10 |
| OP-ADMIN-CLAIM | IF-REVIEW-001、IF-VERIFY-002、IF-OWNERSHIP-001、IF-EVID-002、IF-MON-001、IF-REL-002、IF-COMM-002、IF-USER-ADMIN-001 | POST `/api/v1/admin/work-items/{id}/claim` | work_type 对应审核权限且职责分离 | PRD v1.10 |
| OP-ADMIN-HEARTBEAT | IF-REVIEW-001、IF-VERIFY-002、IF-OWNERSHIP-001、IF-EVID-002、IF-MON-001、IF-REL-002、IF-COMM-002 | POST `/api/v1/admin/work-items/{id}/heartbeat` | 当前领取者 | PRD v1.10 |
| OP-ADMIN-RELEASE | IF-REVIEW-001、IF-VERIFY-002、IF-OWNERSHIP-001、IF-EVID-002、IF-MON-001、IF-REL-002、IF-COMM-002 | POST `/api/v1/admin/work-items/{id}/release` | 当前领取者/管理员 | PRD v1.10 |
| OP-ADMIN-DECISION | IF-REVIEW-001、IF-VERIFY-002、IF-OWNERSHIP-001、IF-EVID-002、IF-MON-001、IF-REL-002、IF-COMM-002、IF-USER-ADMIN-001 | POST `/api/v1/admin/work-items/{id}/decision` | 当前无利益冲突领取者/所需复核者 | PRD v1.10 |
| OP-MON-CHECK | IF-MON-001 | POST `/api/v1/admin/recheck-tasks` | 编辑/管理员 | PRD v1.10 |
| OP-MON-TASK-GET | IF-MON-001 | GET `/api/v1/admin/recheck-tasks/{task_id}` | 编辑/管理员 | PRD v1.10 |
| OP-ANALYTICS-INGEST | IF-ANALYTICS-002 | POST `/api/v1/analytics/events:batch` | 同站 session-bound client；service 只走内部签名/Outbox | PRD v1.10 |
| OP-ANALYTICS-DELETE | IF-ANALYTICS-002 | DELETE `/api/v1/analytics/subjects/{subject_id}` | 本人验证会话/隐私管理员 | PRD v1.10 |
| OP-ADMIN-DASH | IF-ADMIN-001 | GET `/api/v1/admin/dashboard` | 编辑/管理员 | PRD v1.10 |
| OP-ADMIN-PROJ-LIST | IF-ADMIN-PROJ-001 | GET `/api/v1/admin/projects` | 编辑/管理员 | PRD v1.10 |
| OP-ADMIN-PROJ-CREATE | IF-ADMIN-PROJ-001 | POST `/api/v1/admin/project-creation-drafts` | 编辑/管理员 | PRD v1.10 |
| OP-ADMIN-DRAFT-GET | IF-ADMIN-PROJ-001 | GET `/api/v1/admin/project-creation-drafts/{admin_creation_draft_id}` | 所有者/授权编辑 | PRD v1.10 |
| OP-ADMIN-DRAFT-PATCH | IF-ADMIN-PROJ-001 | PATCH `/api/v1/admin/project-creation-drafts/{admin_creation_draft_id}` | 草稿所有者 | PRD v1.10 |
| OP-ADMIN-DRAFT-PREVIEW | IF-ADMIN-PROJ-001 | POST `/api/v1/admin/project-creation-drafts/{admin_creation_draft_id}/preview` | 草稿所有者 | PRD v1.10 |
| OP-ADMIN-DRAFT-SUBMIT | IF-ADMIN-PROJ-001 | POST `/api/v1/admin/project-creation-drafts/{admin_creation_draft_id}/submit` | 草稿所有者 | PRD v1.10 |
| OP-ADMIN-PROJ-GET | IF-ADMIN-PROJ-002 | GET `/api/v1/admin/projects/{id}` | 编辑/管理员字段 ACL | PRD v1.10 |
| OP-ADMIN-PROJ-EDIT-DRAFT | IF-ADMIN-PROJ-002 | POST `/api/v1/admin/projects/{id}/edit-drafts` | 有字段权限编辑/管理员 | PRD v1.10 |
| OP-ADMIN-PROJ-EDIT-DRAFT-GET | IF-ADMIN-PROJ-002 | GET `/api/v1/admin/project-edit-drafts/{admin_project_edit_draft_id}` | 草稿所有者/授权管理员 | PRD v1.10 |
| OP-ADMIN-PROJ-EDIT-DRAFT-PATCH | IF-ADMIN-PROJ-002 | PATCH `/api/v1/admin/project-edit-drafts/{admin_project_edit_draft_id}` | 草稿所有者 | PRD v1.10 |
| OP-WORK-QUEUE | IF-REVIEW-001、IF-VERIFY-002、IF-OWNERSHIP-001、IF-EVID-002、IF-MON-001、IF-REL-002、IF-COMM-002、IF-USER-ADMIN-001 | GET `/api/v1/admin/work-items` | work_type 对应审核权限 | PRD v1.10 |
| OP-TAX-DRAFT-CREATE | IF-TAX-002 | POST `/api/v1/admin/taxonomy-drafts` | 编辑 | PRD v1.10 |
| OP-TAX-DRAFT-PATCH | IF-TAX-002 | PATCH `/api/v1/admin/taxonomy-drafts/{version}` | 草稿作者/授权编辑 | PRD v1.10 |
| OP-EVID-LIST | IF-EVID-002 | GET `/api/v1/admin/evidence` | 编辑/管理员字段 ACL | PRD v1.10 |
| OP-REL-LIST | IF-REL-002 | GET `/api/v1/admin/relations` | 编辑/管理员 | PRD v1.10 |
| OP-REL-CANDIDATE-DRAFT-CREATE | IF-REL-002 | POST `/api/v1/admin/relation-candidates` | 编辑/管理员 | PRD v1.10 |
| OP-REL-CANDIDATE-PREVIEW | IF-REL-002 | POST `/api/v1/admin/relation-candidates/{relation_candidate_id}/preview` | 候选所有者/管理员 | PRD v1.10 |
| OP-REL-CANDIDATE-CREATE | IF-REL-002 | POST `/api/v1/admin/relation-candidates/{relation_candidate_id}/submit` | 候选所有者/管理员 | PRD v1.10 |
| OP-USER-GET | IF-USER-ADMIN-001 | GET `/api/v1/admin/users/{id}` | 管理员 | PRD v1.10 |
| OP-CREATOR-ADMIN-GET | IF-USER-ADMIN-001 | GET `/api/v1/admin/creators/{creator_id}` | 平台编辑/管理员 | PRD v1.10 |
| OP-CREATOR-PROFILE-DRAFT-CREATE | IF-USER-ADMIN-001 | POST `/api/v1/admin/creators/{creator_id}/profile-drafts` | 平台编辑/管理员 | PRD v1.10 |
| OP-CREATOR-PROFILE-DRAFT-GET | IF-USER-ADMIN-001 | GET `/api/v1/admin/creator-profile-drafts/{creator_profile_draft_id}` | 草稿所有者/管理员 | PRD v1.10 |
| OP-CREATOR-PROFILE-DRAFT-REVISE | IF-USER-ADMIN-001 | POST `/api/v1/admin/creator-profile-drafts/{creator_profile_draft_id}/revisions` | 原草稿所有者/管理员 | PRD v1.10 |
| OP-CREATOR-PROFILE-DRAFT-PATCH | IF-USER-ADMIN-001 | PATCH `/api/v1/admin/creator-profile-drafts/{creator_profile_draft_id}` | 草稿所有者/管理员 | PRD v1.10 |
| OP-CREATOR-PROFILE-DRAFT-SUBMIT-REVIEW | IF-USER-ADMIN-001、IF-REVIEW-001 | POST `/api/v1/admin/creator-profile-drafts/{creator_profile_draft_id}/submit-review` | 草稿所有者编辑/管理员 | PRD v1.10 |
| OP-ROLE-REQUEST-CREATE | IF-USER-ADMIN-001 | POST `/api/v1/admin/role-change-requests` | 管理员 | PRD v1.10 |
| OP-ROLE-REQUEST-GET | IF-USER-ADMIN-001 | GET `/api/v1/admin/role-change-requests/{request_id}` | 管理员 | PRD v1.10 |
| OP-ROLE-REQUEST-DECIDE | IF-USER-ADMIN-001 | POST `/api/v1/admin/role-change-requests/{request_id}/decisions` | 非请求者的独立管理员 | PRD v1.10 |
| OP-ROLE-REQUEST-CANCEL | IF-USER-ADMIN-001 | POST `/api/v1/admin/role-change-requests/{request_id}/cancel` | 请求者/更高权限管理员 | PRD v1.10 |
| OP-ANALYTICS-QUERY | IF-ANALYTICS-001 | GET `/api/v1/admin/metrics/{metric_key}` | 编辑/管理员 | PRD v1.10 |
| OP-CONFIG-GET | IF-CONFIG-001 | GET `/api/v1/public/config/{key}` | 公共 | PRD v1.10 |
| OP-CONFIG-DRAFT-CREATE | IF-CONFIG-002 | POST `/api/v1/admin/config-drafts` | 编辑起草 | PRD v1.10 |
| OP-CONFIG-DRAFT-PATCH | IF-CONFIG-002 | PATCH `/api/v1/admin/config-drafts/{draft_id}` | 草稿作者/授权编辑 | PRD v1.10 |


## 8. 既有 Operation 的技术修订

### 8.1 OP-ADMIN-DECISION：Recheck apply

当 `work_type=recheck,target_type=recheck_task,decision=apply`：

- 请求额外条件字段：`expected_project_version_id,expected_project_aggregate_version`。
- ReviewDecision 必填 `project_id,base_version_id`。
- 成功响应必填 `review_decision_id,version_id,event_id,recheck_task_status=applied,work_item_status=decided,transaction_id,outbox_status`。
- ReviewDecision、Version、Project pointer、Event、Task、WorkItem 和 Outbox 同事务。
- `dismiss/confirm_no_change` 不创建 Version，`base_version_id` 必须为空。
- 任何 project/base/current 不一致返回409，零部分写。

### 8.2 OP-OWNERSHIP-GET：party_roles

Party Projection：

`viewer_schema=party,case_id,project_id,author_relation_id,status,reason_code,party_roles[],my_evidence_submissions[],my_withdrawal_requests[],decision_summary?,allowed_actions[],version,created_at,updated_at`。

角色排序与动作矩阵：

| 事实角色 | 可见 | open/investigating 可追加证据 | 可请求撤案 | 可裁定 |
| --- | --- | --- | --- | --- |
| opened_by | 是 | 是 | 是；无 active requested 时 | 否 |
| appealed_account | 是 | 是 | 否 | 否 |
| relation_principal | 是 | 是 | 否 | 否 |
| evidence_submitter | 是 | 否；除非同时命中前三类 | 否 | 否 |

`allowed_actions` 是命中角色动作的去重并集，再受 Case 状态、active withdrawal request、Evidence ACL 和 legal hold 收窄。鉴权直接读取事实来源，不读取 `party_roles` 回传值。

### 8.3 OP-ANALYTICS-QUERY：只读

- GET 只能读取已存在且调用者可见的 `metric_version_id`。
- 可按 `metric_key,window,category_id,snapshot_version,formula_version,status=published` 查找；若未指定 metric_version，返回满足条件的最新 published 版本。
- GET 不创建、不重算、不替换 MetricVersion，不写业务表。
- snapshot 未发布或结果不存在返回404；版本参数互相矛盾返回422。

## 9. Analytics 新增控制面 Operation

| Operation ID | Method 与路径 | 鉴权 | 请求 | 成功响应 | 失败与幂等 |
| --- | --- | --- | --- | --- | --- |
| OP-ANALYTICS-BRIDGE-SNAPSHOT-LIST | GET `/api/v1/admin/analytics/bridge-snapshots` | 平台编辑/管理员 | status,cursor | 200 snapshot page | 403/429；只读 |
| OP-ANALYTICS-BRIDGE-SNAPSHOT-GET | GET `/api/v1/admin/analytics/bridge-snapshots/{snapshot_version}` | 平台编辑/管理员 | version | 200 snapshot metadata/quality/content_hash | 403/404/410；不返回自然人映射明细 |
| OP-ANALYTICS-BRIDGE-SNAPSHOT-BUILD | POST `/api/v1/admin/analytics/bridge-snapshot-builds` | 管理员/内部指标服务 | operation_id,previous_published_version,source_watermark,reason_code | 202 operation_id/snapshot_version/status=building | 403/409/422；operation_id 幂等；并发水位 CAS |
| OP-ANALYTICS-BRIDGE-SNAPSHOT-PUBLISH | POST `/api/v1/admin/analytics/bridge-snapshots/{snapshot_version}/publish` | 独立管理员 | operation_id,expected_status=validated,content_hash,reason_code | 200 status=published/published_at | 403/409/410/422；构建者不得自批；发布后映射不可改 |
| OP-ANALYTICS-METRIC-VERSION-LIST | GET `/api/v1/admin/metrics/{metric_key}/versions` | 编辑/管理员 | snapshot_version,formula_version,window,category,status,cursor | 200 MetricVersion page | 403/422/429；只读 |
| OP-ANALYTICS-METRIC-RECOMPUTE | POST `/api/v1/admin/metrics/{metric_key}/recomputations` | 管理员/内部指标服务 | operation_id,snapshot_version,formula_version,event_watermark,window,category_id?,reason_code | 202 operation_id/status=queued | 403/404/409/422/429；snapshot 必须 published；同键同载荷回放 |
| OP-ANALYTICS-METRIC-RECOMPUTE-GET | GET `/api/v1/admin/metric-recomputations/{operation_id}` | 发起者/管理员 | operation_id | 200 status/attempt/resulting_metric_version_id?/error_code? | 403/404/429；只读 |
| OP-ANALYTICS-METRIC-VERSION-PUBLISH | POST `/api/v1/admin/metric-versions/{metric_version_id}/publish` | 独立管理员 | operation_id,expected_status=validated,content_hash,reason_code | 200 status=published/published_at | 403/409/410/422；重算发起者不得自批；旧 published 不覆盖 |

## 10. ClientAnalyticsInput.v1 Wire Schema

### 10.1 BatchEnvelope.v1

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://vibecheck.example/schemas/analytics/BatchEnvelope.v1.json",
  "type": "object",
  "required": ["batch_version", "sent_at", "sdk_version", "events"],
  "properties": {
    "batch_version": {
      "const": 1
    },
    "sent_at": {
      "type": "string",
      "format": "date-time"
    },
    "sdk_version": {
      "type": "string",
      "minLength": 1,
      "maxLength": 32
    },
    "events": {
      "type": "array",
      "minItems": 1,
      "maxItems": 100,
      "items": {
        "$ref": "ClientAnalyticsInput.v1.json"
      }
    }
  },
  "unevaluatedProperties": false
}
```

### 10.2 ClientAnalyticsInput.v1 字段

| 字段 | 类型 | 必填 | 责任 | 限制 |
| --- | --- | --- | --- | --- |
| event_id | UUID string | 是 | client | 幂等键；离线重试不变 |
| event_name | string | 是 | client | 只允许第10.4表的 client 事件 |
| event_version | integer | 是 | client | 与事件注册表精确匹配 |
| occurred_at | date-time | 是 | client | 超前>5分钟拒绝；迟到按政策标记 |
| app_version | string | 是 | client | 1—32 |
| page_id | Page ID | 条件 | client | 与事件允许页面相容 |
| source_page | Page ID | 否 | client | 不得伪造 service source |
| request_id | string | 否 | client | 1—64 |
| payload | 判别联合 object | 是 | client | required/optional/enum 按第10.4表；未知 Key 拒绝 |
| session_id | opaque string | 条件 | client | 与 X-Analytics-Session 二选一 |

服务端派生且客户端禁止的字段：

`received_at,environment,actor_type,consent_state,metric_subject_id,subject_kind,bridge_version,clock_skew_flag,user_id,anonymous_id,device_id_hash,service_actor_id,transaction_id`。

### 10.3 Session 绑定

- 请求有 `X-Analytics-Session` 时，所有 item 必须省略 session_id。
- 请求无 Header 时，每个 item 必须有同一个 session_id。
- Header 与 item 同时出现：整批422 `SESSION_BINDING_AMBIGUOUS`。
- item session 不同：整批422 `MULTI_SESSION_BATCH_FORBIDDEN`。
- 未知、过期、跨会话或与当前同站上下文不符：对应 item `ACTOR_IDENTITY_INVALID`，不降级游客。

### 10.4 Client 事件 payload 判别表

| event_name/version | 必填 payload | 可选 payload | 禁止/特殊规则 |
| --- | --- | --- | --- |
| home_viewed/v1 | category_mix,result,page_view_id | referrer,campaign | payload 不含 app_version |
| feed_item_clicked/v1 | item_type,item_id,position,channel,click_id,result | project_id,topic_slug | 禁 query_id/navigation_context_id |
| project_viewed/v1 | project_id,category_id,access_status,result | version_id,referrer | 禁 query_id/click_id/navigation_context_id |
| project_favorited/v1 | project_id,target_state,result,client_request_id | error_code,change_source | change_source=explicit或follow_cascade |
| project_liked/v1 | project_id,target_state,result,client_request_id | error_code | target_state boolean |
| project_followed/v1 | project_id,target_state,result,client_request_id | error_code,change_source | change_source=explicit或favorite_cascade |
| comment_created/v1 | project_id,comment_id,resulting_status,result,client_request_id | parent_comment_id,error_code | resulting_status=pending |
| comment_reported/v1 | project_id,comment_id,report_id,reason_code,result,client_request_id | error_code | 不含举报 note |
| comment_withdrawn/v1 | project_id,comment_id,resulting_status,result,operation_id | error_code | resulting_status=author_withdrawn |
| search_submitted/v1 | query_id,mode,query_length_bucket,category_id,result,attempt | token_count,filter_count,error_code,parser_version | 不含 query 原文/词列表 |
| intent_confirmed/v1 | query_id,intent_version,changed_fields,confidence_bucket,result | low_confidence_fields,error_code | changed_fields 只含字段路径 |
| comparison_added/v1 | comparison_id,comparison_version,project_id,category_id,count,result,request_id | reason,replaced_project_id | count 0—5 |
| comparison_started/v1 | comparison_id,comparison_version,category_id,project_count,valid_count | invalid_count | 仅2—5有效同类触发 |
| comparison_dimension_viewed/v1 | comparison_id,comparison_version,dimension_group,visible_ms,project_count,view_sequence | interaction_type | 页面不可见时间不计 |
| comparison_completed/v1 | comparison_id,comparison_version,category_id,project_count,dimension_group_count,visible_duration_ms | saved | 客户端事件仅作为进度输入；collector/聚合器复核完成条件 |
| comparison_saved/v1 | comparison_id,comparison_version,project_count,result,target_state | error_code | 登录会话 |
| asset_clicked/v1 | asset_id,project_id,asset_type,target_scheme,result,attempt_id | target_domain,status,error_code | result=attempt或allowed或blocked |
| project_submitted/v1 | draft_id,submission_id,category_id,result | duplicate_count,error_code | 禁 project_id |
| author_verification_started/v1 | verification_id,project_id,result | evidence_type_count,material_count,error_code | 仅 pending+WorkItem 创建后 |
| project_update_withdrawn/v1 | update_id,project_id,from_status,operation_id,result | reason_code,error_code | 不计新作品发布漏斗 |
| auth_completed/v1 | method,result,return_to_valid,auth_attempt_id | pending_action,comparison_count,error_code,comparison_id | 使用轮换后 session |
| page_viewed/v1 | page_id,result,page_view_id | category_id,referrer,error_code,project_id | 不用于P01/P08专用曝光 |
| search_filter_changed/v1 | query_id,filter_key,operation,result_count,result,filter_version | value_bucket,error_code | 不记录敏感原值 |
| search_routed/v1 | query_id,from_mode,to_mode,reason,route_version | confidence | 系统 UI 路由结果 |
| search_results_viewed/v1 | query_id,group,result_count,sort_version,result_version | exact_count,adjacent_count | 首组可见触发 |
| intent_parse_completed/v1 | query_id,result,latency_ms,confidence_bucket,parse_attempt_id | low_confidence_fields,error_code,parser_version | 不含 query 原文 |
| discover_results_viewed/v1 | query_id,exact_count,adjacent_count,rule_version,result_version | group_count | 合规空态也可 success |
| submission_url_checked/v1 | normalized_domain,access_result,security_result,duplicate_count,result,check_id | http_status,error_code,project_id | 禁 raw URL、path、fragment |
| duplicate_branch_selected/v1 | check_id,branch,duplicate_count,branch_version | selected_project_id | branch 枚举受 Schema |
| submission_step_completed/v1 | draft_id,step,category_id,result,draft_version | error_fields,error_code | error_fields 只含字段路径 |
| prototype_reset/v1 | environment,result,fixture_version,reset_id | — | 仅非生产；生产接收安全告警并拒绝 |

`feed_item_clicked/v2,project_viewed/v2,comment_moderation_changed,author_verification_completed,ownership_dispute_opened/resolved/withdrawn,evidence_validity_changed,project_updated/v2` 仅允许 service identity/Outbox；client 同名版本拒绝 `ACTOR_TYPE_FORBIDDEN`。`decision_submitted` 所有版本拒绝 `EVENT_DEPRECATED`。

### 10.5 批次结果

- Batch envelope 非法：HTTP 400/422，无 item receipt。
- Envelope 合法：HTTP 202，每个 item 为 accepted/deduplicated/rejected。
- event unknown key、错误版本、非法 payload：对应 item `SCHEMA_INVALID`。
- 身份保护字段：对应 item `IDENTITY_FIELD_FORBIDDEN`。
- raw query、正文、材料字段：对应 item `SENSITIVE_FIELD_FORBIDDEN`。
- 只有429/503和明确 retryable item 可重试；重试保留 event_id/occurred_at。

## 11. 内部事件与 Outbox

内部事件 Envelope 必填：

`event_id,event_name,event_version,aggregate_type,aggregate_id,transaction_id,occurred_at,producer_service,schema_version,payload`。

- producer 在数据库事务写 Outbox；relay 至少一次发送；consumer Inbox 去重。
- 事件 Schema 不接受 unknown key；消费者不读未声明字段。
- 事件版本升级采用双发布/双消费窗口；同一 event_id 不发布两个 payload。
- 通知、搜索索引、Analytics service event、媒体处理、抓取和缓存失效均为 Outbox 消费者。
- 业务失败不得用删除 Outbox 行补偿；写新补偿事件和审计。

## 12. 接口契约测试

| Test ID | Given | When | Then |
| --- | --- | --- | --- |
| API-AC-001 | 每个 OpenAPI Operation | 运行 lint/generator | Operation ID 唯一，request/response/error Schema 有定义，无悬空 ref |
| API-AC-002 | 写请求含未知字段 | 调用 | 422 UNKNOWN_FIELD；无静默忽略 |
| API-AC-003 | 同 idempotency key 同载荷 | 重放 | 返回相同状态码和资源 ID |
| API-AC-004 | 同 idempotency key 异载荷 | 重放 | 409，原资源不变 |
| API-AC-005 | expected_version 过期 | 写入 | 409 ConflictResponse，服务端事实不变 |
| API-AC-006 | Recheck apply 合法 | 决定 | 返回 ReviewDecision+Version+Event；同事务 |
| API-AC-007 | 同用户命中多个 Ownership 角色 | GET party | party_roles 排序去重；动作矩阵正确 |
| API-AC-008 | Analytics GET 查询未计算组合 | GET | 404，不创建 MetricVersion |
| API-AC-009 | 并发相同指标重算 | POST | 同 operation 回放；不同 operation 生成独立版本且不覆盖 |
| API-AC-010 | Batch Header和item session同时存在 | ingest | 整批422 SESSION_BINDING_AMBIGUOUS |
| API-AC-011 | 合法 batch 混合合法/非法 item | ingest | HTTP202逐项 receipt；非法项不写事实 |
| API-AC-012 | client 发送 service v2 | ingest | item rejected ACTOR_TYPE_FORBIDDEN |
| API-AC-013 | 非当事人猜测 Ownership Case ID | GET party | 404且无存在性侧信道 |
| API-AC-014 | 冲突管理员访问 reviewer Case | GET | 403且不降级、不返 principal |
| API-AC-015 | OpenAPI 生成 TypeScript client | 编译前端 | 无手写重复 DTO，严格模式通过 |

## 13. OpenAPI 交付结构

建议后续代码仓库形成：

```text
contracts/
  openapi/
    public.v1.yaml
    account.v1.yaml
    admin.v1.yaml
    analytics.v1.yaml
  schemas/
    common/
    catalog/
    workflow/
    analytics/
  events/
    outbox/
    analytics/
  fixtures/
    positive/
    negative/
```

OpenAPI 合并产物必须生成：

- 前端 TypeScript client；
- 服务端 route type；
- JSON Schema 运行时验证器；
- 正常/异常契约 fixture；
- mock server 仅用于前端并行开发；
- breaking-change diff 报告。

## 14. 接口冻结门禁

| 门禁 | 通过条件 |
| --- | --- |
| API-GATE-01 | V19-01/TD-API-001 回写并由产品、后端、数据签字 |
| API-GATE-02 | V19-02/TD-API-002 的 party_roles 和动作矩阵签字 |
| API-GATE-03 | ClientAnalyticsInput JSON Schema、事件 payload 联合和负例通过 |
| API-GATE-04 | Analytics GET/POST 控制面及资源状态签字 |
| API-GATE-05 | 138个既有+8个新增 Operation ID 无重复、无悬空 Schema |
| API-GATE-06 | 鉴权、CSRF、CORS、对象 ACL、字段 ACL 和职责分离威胁测试通过 |
| API-GATE-07 | 所有写 Operation 幂等、并发和事务回滚用例通过 |
| API-GATE-08 | v1.10 版本化 PRD 与 Git 基线记录提交后标记“生效” |

## 15. 待确认事项

- TBC-003：语义解析、安全检测供应商与 SLA；
- TBC-004：P0 已排除 JS 渲染/自动截图；robots、版权和生产抓取合规仍待确认；
- TBC-005：已关闭首期范围，P0 仅站内通知；
- TBC-006：部署已选 Render Singapore/PostgreSQL 18；备份、RPO/RTO 与密钥仍待确认；
- TBC-007：搜索评估和权重；
- TBC-009：保留期限；
- TBC-010：小样本导出阈值；
- TBC-012：SLO/告警；
- TBC-013：删除/导出/跨境。

上述事项不阻断稳定 DTO 和接口骨架开发，但阻断对应生产集成或上线签字。

## 16. 完成度自检

| 检查项 | 结果 |
| --- | --- |
| PRD 138个 Operation 全量列出 | 通过 |
| V19-04 新增8个 Analytics Operation | 通过 |
| 公共认证、错误、幂等、并发、分页规则完整 | 通过 |
| ClientAnalyticsInput/Batch 精确 Wire Schema | 通过；待回写 PRD |
| Ownership party 多角色与动作矩阵 | 通过；待回写 PRD |
| Recheck→Version 合法决定链 | 通过；待回写 PRD |
| GET 无写副作用 | 通过 |
| 契约测试和冻结门禁 | 通过 |

