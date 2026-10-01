# VibeCheck 首期 MVP 后台管理规则

**版本：v1.0｜状态：已批准开发基线（WP-00）｜日期：2026-08-10**

## 1. 文档目的

本文定义 A01—A14 的后台权限、队列、操作协议、最小投影、二次确认、职责分离、审计、异常和验收规则。后台页面只是管理入口，后端鉴权和领域状态机是最终控制边界。

## 2. 后台边界

- 游客、注册用户和已验证作者不能访问 `/admin`。
- 平台编辑只能执行明确授权的建档、普通事实编辑、初审、字典/配置起草和聚合数据查看。
- 管理员处理限制/归档/删除、合并、身份争议、角色、系统配置发布、指标快照发布和高风险撤销。
- 任何角色都不能直接修改数据库状态、Decision、Version、Event、AuditLog 或已发布配置。
- 自动监测、抓取、模型和规则只创建候选或白名单系统事实；需要人工判断的公开变化进入 WorkItem。
- 本版不提供“超级管理员绕过所有 Guard”的通用能力。

## 3. 后台权限模型

### 3.1 权限层次

1. Session active；
2. roles_version 与服务端一致；
3. route capability；
4. Operation capability；
5. target/object ACL；
6. field path ACL；
7. current state；
8. separation-of-duty；
9. conflict-of-interest；
10. claim/lease/preview/confirm/expected version。

任一层失败即拒绝，不因前端按钮显示而放宽。

### 3.2 Capability

| Capability | 平台编辑 | 管理员 | 说明 |
| --- | --- | --- | --- |
| `admin.dashboard.read_business` | 是 | 是 | A01 业务待办 |
| `admin.dashboard.read_system` | 否 | 是 | 系统健康和安全摘要 |
| `project.creation_draft.write` | 是 | 是 | A02 草稿，不创建 Project |
| `project.fact.edit_standard` | 是 | 是 | A03 普通事实字段 |
| `project.governance.execute` | 否 | 是 | restrict/archive/restore/delete |
| `duplicate.review` | 是 | 是 | A04 查看/建议 |
| `duplicate.merge.execute` | 否 | 是 | A04 合并 |
| `submission.review` | 是 | 是 | A05，提交者不得自审 |
| `project_update.review` | 是 | 是 | A05，更新所有者不得自审 |
| `verification.review` | 是 | 是 | A06 初审/决定，受冲突约束 |
| `ownership.decide` | 否 | 是 | A06 uphold/revoke/withdraw |
| `taxonomy.draft.write` | 是 | 是 | A07 |
| `taxonomy.publish` | 否 | 是 | A07 |
| `evidence.review` | 是 | 是 | A08 |
| `evidence.revoke` | 否 | 是 | 高风险撤销 |
| `recheck.read_run` | 是 | 是 | A09 |
| `access_status.decide` | 是 | 是 | 普通状态；restricted/archive由治理能力 |
| `relation.review` | 是 | 是 | A10 |
| `relation.terminate` | 否 | 是 | A10 |
| `community.moderate` | 是 | 是 | A11 |
| `account.restrict` | 否 | 是 | A11/A12 |
| `creator_profile.draft.write` | 是 | 是 | A12 本人草稿 |
| `creator_profile.publish` | 否 | 是 | A12 WorkItem领取者 |
| `creator.merge.execute` | 否 | 是 | A12 |
| `role_change.request_decide` | 否 | 是 | A12；请求者≠批准者 |
| `analytics.aggregate.read` | 是 | 是 | A13 published聚合 |
| `analytics.recompute.request` | 否 | 是 | A13 |
| `analytics.snapshot.publish` | 否 | 是 | A13；构建者≠发布者 |
| `config.draft.write` | 是 | 是 | A14 |
| `config.publish` | 否 | 是 | A14 |
| `audit.export` | 条件 | 是 | 受范围、字段、小样本和审计限制 |

### 3.3 字段 ACL

- A03 平台编辑只能改 PRD 普通公开字段；review_status、身份、关系、历史、计数、决定和系统字段不在普通 ACL。
- A06 平台编辑看验证所需材料投影；Ownership 决定、冲突集合和内部安全日志仅受控管理员服务读取。
- A12 平台编辑不读取账户角色、私密争议、其他编辑草稿和权限档案内部配置。
- A13 任何人级下钻只显示 opaque metric triple 和 bridge snapshot version，不返回 user_id 或 bridge 反查。
- 字段 ACL 在服务端按 JSON Pointer 校验；不接受客户端自报 allowed fields。

## 4. 高风险操作协议

### 4.1 队列审核

适用：A05、A06、A08、A09、A10、A11，以及 A12 creator_profile changes_requested。

```text
queue -> claim -> heartbeat/release -> preview -> confirm -> decision
```

规则：

- WorkItem lease 候选60秒，heartbeat候选30秒；最大续租由版本化配置确定。
- preview 绑定 actor、primary session、roles_version、target、expected version、diff/impact hash。
- confirm 绑定 preview 和 confirmation summary，TTL≤120秒。
- 需要近期认证时，只为被挑战 preview 创建 reauth grant；邮箱验证码发送/验证服务不可用时不降级。
- decision 提交锁内重检所有 Guard，创建不可变 ReviewDecision 和 WorkItem typed ref。

### 4.2 直接管理

适用：A03、A04、A07、A12 合并/角色执行、A14，以及管理员治理。

```text
draft/selection -> preview -> confirm -> execute
```

公开执行唯一入口为 `OP-ADMIN-EXECUTE`。资源模块不得暴露第二个 publish/merge/execute API。

### 4.3 Creator Profile 交接

```text
editor draft -> submit-review -> admin claim -> admin preview -> admin confirm -> admin execute
```

- 编辑者不能领取本人提交的 WorkItem。
- changes_requested 创建 ReviewDecision，旧 revision 终态。
- publish 不创建 approve ReviewDecision；创建 CreatorProfileExecutionDecision。
- Draft 不持久化 publishing。

### 4.4 双主体审批

强制双主体：

- 用户角色变更；
- 最后一名管理员保护相关动作；
- Analytics BridgeSnapshot/MetricVersion 发布；
- break-glass；
- 安全/法务要求的特殊数据导出。

请求人、批准人和执行人按规则不得为同一主体；至少请求人≠批准人。

## 5. 二次确认

确认摘要必须显示：

- operation_type；
- target stable ID 和当前 Version；
- before/after 或受影响对象数；
- 不可逆影响；
- Evidence/豁免；
- reason_code；
- 将创建的 Decision/Version/Event 类型；
- token 到期时间。

删除、合并、归属裁定、角色和配置发布要求用户再次输入目标 ID 或确认摘要哈希。确认文本不能只写“确定吗”。

## 6. 审计与安全日志

### 6.1 AuditLog 必填

`operation_id,actor_user_id,actor_roles,roles_version,primary_session_hash,operation_type,target_type,target_id,before_hash,after_hash,diff,reason_code,evidence_refs,request_id,trace_id,ip_risk_summary,preview_id,confirm_id,decision_ref,transaction_id,result,error_code,created_at`。

### 6.2 记录原则

- 业务管理员无 UPDATE/DELETE AuditLog 权限。
- 日志不保存 token、密码、邮箱验证码、完整邮箱、材料正文、完整私密 Evidence、storage key 或 raw query。
- 敏感读取单独记录 actor、purpose、WorkItem、grant、结果和时间。
- 拒绝操作也记录最小安全摘要；Ownership 冲突拒绝不记录可被普通后台查询的 principal 明细。
- 导出记录筛选、字段、行数、快照/指标版本、下载过期时间和批准人。

## 7. 队列统一规则

### 7.1 QueueItemProjection

`work_item_id,work_type,target_type,target_id,domain_summary,status,created_at,priority,lease_expires_at?,version`。

未领取时不得返回私密正文、材料 URL、完整 Evidence、claim token、冲突主体或内部决定。

### 7.2 排序

默认：

1. 明确法律/安全优先级；
2. SLA due_at；
3. created_at；
4. work_item_id。

priority 只能来自版本化规则，不允许前端自由输入。

### 7.3 Ownership 过滤

当前 staff user 命中以下任一来源即从队列完全排除：

- opened_by；
- appealed_user；
- 原 verification applicant；
- 争议 Creator 的 active/suspended Link 用户；
- 所有案件 Evidence submitter；
- 所有历史 WithdrawalRequest requester；
- 规则定义的关联账户。

过滤发生在 total/count/filter/sort/cursor/page/domain resolve 前。禁止：

- placeholder；
- actor_conflicted flag；
- 空洞补页；
- 泄露 target_id、摘要或命中原因。

## 8. 后台页面地图

| Page | 路由 | 主要能力 | 当前代码 |
| --- | --- | --- | --- |
| A01 | `/admin` | 总览 | C |
| A02 | `/admin/projects` | 作品建档/列表 | C |
| A03 | `/admin/project/:id` | 作品事实编辑 | B/E |
| A04 | `/admin/duplicates` | 重复合并 | C |
| A05 | `/admin/reviews` | 发布/更新审核 | C/E |
| A06 | `/admin/author-verification` | 身份与争议 | C/E |
| A07 | `/admin/taxonomies` | 分类字典 | D |
| A08 | `/admin/evidence` | 证据管理 | C，占位 |
| A09 | `/admin/status-monitor` | 状态复检 | C/E |
| A10 | `/admin/relations` | 关系审核 | D |
| A11 | `/admin/community` | 社区审核 | D |
| A12 | `/admin/users-creators` | 用户/作者 | D |
| A13 | `/admin/analytics` | 埋点与指标 | D |
| A14 | `/admin/settings` | 系统配置 | D |

## 9. A01 运营总览

| 项目 | 规则 |
| --- | --- |
| Requirement | VC-A01-001 |
| 目标 | 只读展示待办、异常和路径健康，不修改事实 |
| 权限 | 编辑看业务；管理员看业务+系统；后端裁剪 |
| 模块 | Submission/Update/Verification/Ownership/Evidence/Recheck/Community 待办；Outbox/Analytics质量 |
| 接口 | OP-ADMIN-DASH |
| 写入 | 仅访问/导出审计 |
| Empty | 每张卡分别显示0和数据水位 |
| Error | 卡片隔离；不得用Mock或缓存冒充实时 |
| 性能 | 首屏卡片并行；每卡标 calculated_at |
| 验收 | 数量必须与权限过滤后的队列一致；Analytics失败不影响业务待办 |

## 10. A02 作品建档与列表

| 项目 | 规则 |
| --- | --- |
| Requirement | VC-A02-001 |
| 权限 | 编辑/管理员创建和查看授权草稿；创建者不得审核自己 |
| 模块 | Project检索、AdminProjectCreationDraft、重复候选、EvidenceDraft、媒体、Schema校验 |
| 接口 | OP-ADMIN-PROJ-LIST/CREATE、OP-ADMIN-DRAFT-GET/PATCH/PREVIEW/SUBMIT |
| 流程 | 创建草稿→自动保存→绑定证据/媒体→预览→提交为Submission/WorkItem |
| 不变量 | submit前无project_id；最终Evidence只在发布事务提升 |
| 重复 | 候选命中转A04；不得绕过URL查重 |
| 批量 | 只允许导入草稿候选；每项独立校验和回执 |
| 验收 | 提交只创建Submission+WorkItem；不同编辑审核发布后才产生Project |

## 11. A03 作品编辑

| 项目 | 规则 |
| --- | --- |
| Requirement | VC-A03-001 |
| 路由 | 只注册 `/admin/project/:id` |
| 权限 | 编辑普通字段；管理员治理字段；均按JSON Pointer ACL |
| 接口 | Admin edit draft系列+OP-ADMIN-PREVIEW/CONFIRM/EXECUTE |
| 流程 | 创建edit draft→patch→Evidence/Media校验→preview→confirm→execute |
| 事务 | AdminFactDecision+Version+Project pointer+Event+Evidence/Media+Audit+Outbox |
| 无Evidence | 必须 `evidence_waiver_reason_code`；仍创建AdminFactDecision/Version |
| 禁止 | 直接PATCH Project、修改旧Version/Event、资源专用公开execute |
| 冲突 | expected_version过期返回canonical ConflictResponse |
| 验收 | 任一步失败保留草稿且无半决定/Version |

## 12. A04 重复识别与合并

| 项目 | 规则 |
| --- | --- |
| Requirement | VC-A04-001 |
| 权限 | 编辑查看/建议；管理员执行 |
| 模块 | URL/名称/作者/时间线差异、引用、互动、关系、碰撞矩阵 |
| 接口 | IF-MERGE-001、OP-ADMIN-PREVIEW/CONFIRM/EXECUTE |
| 前置 | 同品类；无活跃审核/争议；主档明确；所有版本锁有效 |
| 合并 | 别名指主档；互动按user+type去重；历史/Decision/Audit保留 |
| Creator碰撞 | Link role/profile/status、Relation、OwnershipCase有冲突即阻断 |
| 二次确认 | 输入canonical project_id；展示折叠/替代数量 |
| 撤销 | 不自动撤销；纠错走受审计反向迁移方案 |
| 验收 | 并发变更返回409，两个对象均不被部分修改 |

## 13. A05 发布审核

| 项目 | 规则 |
| --- | --- |
| Requirement | VC-A05-001 |
| Work types | submission、project_update 分栏 |
| 权限 | 非提交者编辑/管理员；创建者不可领取 |
| 接口 | OP-WORK-QUEUE、CLAIM/HEARTBEAT/RELEASE、PREVIEW/CONFIRM/DECISION |
| Submission | 退回/拒绝/批准；批准后publish worker |
| ProjectUpdate | 退回/拒绝/批准；批准后apply worker |
| 证据/媒体 | 决定前重检ready/clean/guard；最终提升在父事务 |
| 决定 | ReviewDecision v1；target/project/base按分支矩阵 |
| 错误 | lease/token/version失效409/410；不重复决定 |
| 验收 | 两种work type事件、目标和事务不可串用 |

## 14. A06 作者身份与争议

| 项目 | 规则 |
| --- | --- |
| Requirement | VC-A06-001 |
| 权限 | 编辑验证审核；管理员Ownership裁定；全部受冲突约束 |
| 模块 | VerificationRequest/Material、Link/Profile、AuthorRelation、OwnershipCase/Principal/Withdrawal |
| 材料 | 一次性read grant≤5分钟；申请人粗粒度投影；读取双审计 |
| 验证 | use_existing不改Link；create_new固定OWNER_V1；claim_existing按owner set选择 |
| 并发 | Creator aggregate/owner_link_set/Link version锁和CAS |
| Ownership | party/reviewer独立Projection；party_roles[]；队列预分页过滤 |
| 动作 | CREATE、EVIDENCE-ADD、WITHDRAW-REQUEST、uphold/revoke/withdraw |
| 日志 | 每一步principal version/hash pass/deny；普通后台不见集合 |
| 验收 | 冲突管理员队列、claim、preview、confirm、decision全部拒绝且无侧信道 |

## 15. A07 分类与字段字典

| 项目 | 规则 |
| --- | --- |
| Requirement | VC-A07-001 |
| 权限 | 编辑起草；管理员发布 |
| 模块 | Category Schema、字典、比较维度、检索字段、影响项目 |
| 接口 | OP-TAX-GET、DRAFT-CREATE/PATCH、ADMIN PREVIEW/CONFIRM/EXECUTE |
| 版本 | 已发布不可改；破坏性变更有迁移计划；旧Project按旧Schema渲染 |
| 冻结 | 两个category_id、P0字段和比较2—5不可由配置覆盖 |
| 发布 | 构建者和发布者可由组织策略分离；至少管理员确认 |
| 验收 | 删除已使用枚举/字段返回422并列影响 |

## 16. A08 证据管理

| 项目 | 规则 |
| --- | --- |
| Requirement | VC-A08-001 |
| 权限 | 编辑审核；管理员revoke |
| 模块 | Evidence元数据、field_path、引用、validity/freshness/dispute、附件授权 |
| 接口 | OP-EVID-LIST、WorkItem协议、read grant |
| 决定 | verify_valid/mark_suspended/restore_valid/mark_invalid/revoke |
| 事务 | 每次validity迁移创建ReviewDecision并写typed ref |
| 最小披露 | private只返元数据；正文另授权 |
| 影响 | 显示受影响Project/Asset/Field；不删除历史 |
| 验收 | invalid/revoked后不计公开证据覆盖率；终态不能restore |

## 17. A09 状态监测

| 项目 | 规则 |
| --- | --- |
| Requirement | VC-A09-001 |
| 权限 | 编辑查看/重检/普通状态决定；管理员治理 |
| 模块 | RecheckTask、HTTP/redirect/security、candidate、Evidence、WorkItem |
| 接口 | OP-MON-CHECK/TASK-GET、WorkItem协议 |
| 自动检查 | 只产生candidate/confirmed_no_change/retry/failed，不直接改公开access_status |
| Apply | TD-API-001：ReviewDecision+Version+Project+Event同事务 |
| paused/ended | 技术成功信号不覆盖；需要人工Evidence |
| SSRF | 私网、重绑定、非法端口、危险scheme零请求并安全告警 |
| 验收 | dismiss不改Project；apply没有合法Version则门禁失败 |

## 18. A10 作品关系审核

| 项目 | 规则 |
| --- | --- |
| Requirement | VC-A10-001 |
| 权限 | 编辑候选/初审；管理员冲突和终止 |
| 模块 | RelationCandidate、双端对象、方向、Evidence、环检测 |
| 接口 | OP-REL-LIST、CANDIDATE-DRAFT-CREATE/PREVIEW/CREATE、WorkItem协议 |
| 不变量 | 禁自环、重复有效关系、禁止环；规范类型fork不输出fork_of |
| 证据 | candidate绑定ready EvidenceDraft；approve事务提升 |
| 边界 | 作者归属不在A10，转A06 |
| 验收 | 环路返回完整受控路径且零Relation写入 |

## 19. A11 社区审核

| 项目 | 规则 |
| --- | --- |
| Requirement | VC-A11-001 |
| 权限 | 编辑内容审核；管理员账户限制/申诉 |
| Work type | community；target_type=comment或report |
| 接口 | OP-COMM-ADMIN、WorkItem协议 |
| 状态 | pending/under_review/visible/collapsed/hidden/rejected/author_withdrawn |
| 计数 | 只在跨公开集合visible/collapsed边界时delta±1 |
| 决定 | collapse/hide/restore_visible/reject或report resolution |
| 幂等 | decision_request_id重复不增加计数/通知/事件 |
| 验收 | hidden后正文不在公共Projection；Report和审核史保留 |

## 20. A12 用户与作者管理

| 项目 | 规则 |
| --- | --- |
| Requirement | VC-A12-001 |
| 权限 | 编辑创建/修改本人CreatorProfileDraft；管理员发布、合并、账户、角色 |
| Creator Profile | submit-review→admin claim→preview→confirm→execute |
| Rebase | initial无token；冲突409+10分钟token；retry带完整resolution；成功一次消费 |
| 发布 | ExecutionDecision+ProfileVersion+正式头像+current pointer+WorkItem同事务 |
| Link/Profile | P0固定OWNER_V1/MANAGER_V1；A12无Profile发布/迁移API |
| Creator merge | 碰撞矩阵出现blocking collision即409 |
| Role | 请求者≠批准者；批准不直接执行；execute再校验最后管理员 |
| Session | 角色变更成功递增roles_version并撤销旧session |
| 验收 | 编辑直接execute 403；响应丢失按operation receipt回放同一Version |

## 21. A13 埋点路径与指标

| 项目 | 规则 |
| --- | --- |
| Requirement | VC-A13-001 |
| 权限 | 编辑看published聚合；管理员请求重算/构建；独立管理员发布 |
| 模块 | 事件质量、拒绝率、迟到、producer版本、bridge snapshot、metric version、路径 |
| 只读接口 | snapshot/version list/get、OP-ANALYTICS-QUERY |
| 写命令 | snapshot build/publish、metric recompute/publish |
| 不变量 | GET无写副作用；每次重算固定B/formula/watermark；published不覆盖 |
| 隐私 | 人级下钻只给opaque三元组+B；不返user_id、session或bridge明细 |
| 小样本 | 阈值TBC-010；未冻结时禁止导出小样本人级数据 |
| 职责分离 | snapshot/metric构建或重算发起者不得发布自己的版本 |
| 验收 | B不存在/未发布、并发重算、失败重试、不同B新版本均有确定结果 |

## 22. A14 系统配置

| 项目 | 规则 |
| --- | --- |
| Requirement | VC-A14-001 |
| 权限 | 编辑起草；管理员发布 |
| 模块 | key/version/environment/value/schema/status/impact |
| 接口 | CONFIG GET、DRAFT CREATE/PATCH、ADMIN PREVIEW/CONFIRM/EXECUTE |
| 发布 | 同base只有一个草稿成功；回滚创建新版本，不修改历史 |
| 禁止 | 密钥明文；覆盖冻结枚举/权限/比较约束；未发布草稿回退公共配置 |
| 缓存 | ETag+version；配置发布Outbox失效 |
| 验收 | compare_max=6返回FROZEN_CONSTRAINT；published不变 |

## 23. 全局后台页面状态

| 状态 | 规则 |
| --- | --- |
| Loading | 页面壳和导航立即显示；表格骨架等高；卡片独立加载 |
| Empty | 显示当前筛选和“0项”，不把权限过滤误报为全局无数据 |
| Error | 稳定error_code、request_id、重试；已成功数据保留并标水位 |
| 401 | 跳P17并保存受控return_to；不保存高风险pending decision |
| 403 | 不显示对象正文、权限结构或冲突原因；清本地敏感缓存 |
| 404 | 后台稳定404；不枚举对象 |
| 409 | 展示差异和刷新/重基线入口；不自动覆盖 |
| 410 | 清理过期token/claim本地态；要求重走协议 |
| 429 | 显示Retry-After；禁止自动高频重试 |
| 5xx | 不把未知结果显示成成功；先按operation receipt查询 |

## 24. 导出规则

- 导出必须使用独立 Operation，不在列表查询加 `format=csv` 绕过。
- 权限、行过滤、字段裁剪和小样本规则与屏幕读取一致或更严格。
- 导出文件短期签名、绑定操作者和一次下载；不发公共URL。
- 文件含生成时间、筛选、快照/metric/schema版本和免责声明。
- VerificationMaterial、私密Evidence正文、token、storage key、自然人Analytics映射禁止导出。
- 角色/争议/安全类导出要求管理员和必要的双主体审批。

## 25. Break-glass

仅用于平台预置服务账户处理既有运维事故，不能用普通管理员切换获得。

必需：

- 书面 incident/ticket ID；
- 两名独立管理员批准；
- purpose和target白名单；
- TTL≤15分钟；
- 不绕过Ownership conflict filter；
- 全量安全告警和事后复核；
- 禁止读取材料正文，除非专用read grant仍成立。

## 26. 后台测试矩阵

每页至少执行：

1. 平台编辑正常权限；
2. 管理员正常权限；
3. 注册用户直接调用403/404；
4. 按钮隐藏但手工调用仍拒绝；
5. expected_version冲突；
6. token过期；
7. 相同operation重放；
8. 异载荷重放；
9. 事务故障回滚；
10. 审计日志完整；
11. 敏感字段递归泄露检查；
12. 键盘操作、焦点、表格滚动和错误可访问性。

关键安全用例：

- 创建者自审；
- 角色请求者自批；
- Creator Profile编辑者自发布；
- Ownership冲突管理员所有入口；
- A03编辑治理字段；
- A13构建者自发布；
- A14配置覆盖冻结约束；
- A04合并中途对象版本变化；
- A08私密附件无grant读取。

## 27. 后台上线门禁

| Gate | 条件 |
| --- | --- |
| ADM-GATE-01 | A01—A14路由、403/404和lazy chunk完整 |
| ADM-GATE-02 | Capability、对象ACL、字段ACL和职责分离契约测试通过 |
| ADM-GATE-03 | 队列/直接管理/Profile交接三套协议无旁路 |
| ADM-GATE-04 | 所有高风险操作有preview/confirm/reason/expected_version/AuditLog |
| ADM-GATE-05 | Ownership预分页过滤与双Projection安全测试通过 |
| ADM-GATE-06 | Recheck apply合法Version决定链通过 |
| ADM-GATE-07 | A13 GET只读、POST控制面和小样本保护通过 |
| ADM-GATE-08 | 角色、配置、快照发布双主体规则通过 |
| ADM-GATE-09 | 所有导出可追溯、短期、最小字段 |
| ADM-GATE-10 | E2E 0 failed；skip有批准原因 |

## 28. 待确认

| 项 | 来源 | 影响 |
| --- | --- | --- |
| 首页频道配置 | TBC-001 | A14运营值 |
| 站外通知 | 首期范围已关闭 | P0 后台不管理站外渠道 |
| Render 实例/备份/RPO/RTO/密钥 | TBC-006 剩余项 | 后台生产上线 |
| 搜索评估 | TBC-007 | A01/A13质量卡 |
| 保留期 | TBC-009 | 导出、通知、材料 |
| 小样本阈值 | TBC-010 | A13 |
| SLO/告警/值班 | TBC-012 | A01系统卡和运维 |
| 删除/导出/跨境 | TBC-013 | A12/A13/导出 |
| V19-01—04回写 | v1.9复审 | A06/A09/A13相关接口冻结 |
| 发布治理 | V19-05 | 唯一生效基线 |

## 29. 完成度自检

| 检查项 | 结果 |
| --- | --- |
| A01—A14均有目标、权限、模块、接口、风险和验收 | 通过 |
| 前端可见性与后端鉴权分离 | 通过 |
| 高风险操作、二次确认、职责分离 | 通过 |
| 公开事实、删除、合并、历史、身份争议日志 | 通过 |
| Ownership双Projection和队列过滤 | 通过 |
| A13指标控制面 | 通过；待回写PRD |
| 导出、break-glass、异常和测试 | 通过 |
