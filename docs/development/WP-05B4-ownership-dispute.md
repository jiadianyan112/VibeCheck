# WP-05B4 作者归属争议闭环

**状态：已完成｜日期：2026-08-20｜产品基线：PRD v1.10**

## 1. 交付范围

- `P12/A06`：创建 OwnershipCase、追加证据、追加/拒绝撤回申请、领取和审核读取、`uphold/revoke/withdraw` 裁决。
- `P08/P13/P14/P15`：案件创建即暂停目标 AuthorRelation；终局裁决原子恢复或终止关系，既有目录读取与 AuthorAuthorization 随事务结果立即生效。
- 前端实现继续由 WorkBuddy 负责；本工作包未修改 `src/**`、`public/**` 或 `e2e/**`。

## 2. 数据库与不可变量

追加 migration `000037_ownership_dispute_lifecycle.sql`，不修改历史迁移。新增：

- `workflow.ownership_cases`：一个 AuthorRelation 同时最多一个 open/investigating Case；终态不可修改。
- `workflow.ownership_case_evidence_submissions`：服务端绑定提交 actor，证据提交记录不可更新或删除。
- `workflow.ownership_withdrawal_requests`：每次请求稳定 ID、append-only supersedes 链；同 Case 同时最多一条 requested；决定 ID 唯一。
- `workflow.ownership_conflict_principal_snapshots/members`：每版冲突主体集合和来源版本快照永久保留；普通 API 不返回主体集合、哈希或来源版本。
- `workflow.ownership_operation_receipts`：创建、证据追加和撤回申请按 actor/client request 幂等重放。
- ReviewDecision 新增 ownership_case 判别约束；只有 `uphold→resolved_upheld`、`revoke→resolved_revoked`、`withdraw→withdrawn` 合法。

Case 创建事务同时创建 WorkItem/principal v1、暂停 Relation、重算 Project 作者态、写审计和 `ownership_dispute_opened` Outbox。失败时全部回滚。

## 3. 动态利益冲突与隐私

冲突来源为：

1. 立案人；
2. 所有历史撤回申请人；
3. 原 VerificationRequest 申请人；
4. canonical Creator 当前 active/suspended Link 账户；
5. 所有案件证据提交人；
6. appealed account。

staff queue 在 total/count/filter/sort/cursor/page 前同时执行持久快照和当前 Link/Verification/Case 来源检查。直接 claim、reviewer GET、preview/decision 也重复检查，冲突人员返回 403。证据或撤回来源变化会生成下一版快照，原子释放现有 claim，并撤销绑定的 preview/confirm。

Party 和 Reviewer 使用不同路由及 exact projection：

- Party 只读取自己的角色并集、自己的证据/撤回历史、公开终局摘要和服务端计算的 allowed actions；非当事人 404。
- Reviewer 必须持有当前有效 claim；只能读取审核所需当事人、证据摘要、撤回链、WorkItem 摘要和 conflict version，不返回 principal set/hash/source versions 或任何安全令牌。

## 4. 终局事务

`OP-ADMIN-DECISION` 的 ownership 分支要求 Session、当前 claim、lease、preview、近期认证/confirm、WorkItem version、Case version 和 conflict principal version 全部一致。

- uphold：Case=`resolved_upheld`，Relation=`active`；若存在 requested 撤回子项则写 `closed_by_case_decision`。
- revoke：Case=`resolved_revoked`，Relation=`terminated`；原 VerificationRequest 保持 `verified`，不再次产生 `author_verification_completed`。
- withdraw：必须精确绑定 Case.active withdrawal request；子项=`accepted`、Case=`withdrawn`、Relation=`active`。

三类终局均在同一 PostgreSQL 事务创建 ReviewDecision、更新 Case/Withdrawal/Relation/Project、决定 WorkItem、消费 preview/confirm、写审计和 Outbox。任何 CAS、权限、冲突或令牌失败都不会留下半对象。

## 5. Version 规范冲突处理

旧数据库设计 TX-006 和状态机技术规格曾写“Ownership 裁定创建治理 Version”；PRD v1.10 C-080/Version 判别矩阵只允许 Submission、ProjectUpdate、RecheckTask 使用 `source_decision_type=review_decision`，管理员治理 Version 则必须引用独立 AdminFactDecision。Ownership ReviewDecision 不属于任何允许分支。

本实现以上位 PRD v1.10 为准：Ownership 事务不伪造 ProjectVersion、AdminFactDecision 或 Event，只更新 Project 作者关系投影和 aggregate version，并写 ownership 领域 Outbox。若产品未来扩展 Version 来源矩阵，必须先修订 PRD/数据库判别外键，再追加迁移。

## 6. 验证证据

- OpenAPI：81 paths / 91 operations；SHA-256 见 WorkBuddy 交接文件。
- 单元/契约：Ownership 输入判别、重复证据、claim token 哈希、三类决定 payload、API actor 绑定、unknown field 和 party/reviewer 路由隔离均覆盖。
- PostgreSQL fixture：三种终局、两轮撤回 supersedes 历史、证据导致 principal 轮换与 claim 释放、冲突人员预分页隐藏、VerificationRequest 终态保留、Relation/Project/Outbox 原子一致性。
- GitHub Actions：Run [#32355331970](https://github.com/jiadianyan112/VibeCheck/actions/runs/32355331970) 成功；PostgreSQL 18 上 37 个 append-only migration 重复执行及全量后续夹具通过。
- 核心工程基线：`59eece1`；OpenAPI 为 81 paths / 91 operations，SHA-256 `7550fbd6f968eccd8531df74f4f926338bc336fd15651746251414231a33d4ac`。

## 7. 未进入本工作包

- Creator 合并、作者角色迁移、跨 Case 申诉升级。
- 站外通知发送；本轮只写 Outbox。
- 生产 Feature Flag 开启、真实 Staging 和人工身份争议演练。
- 前端 P12/A06 视觉和交互实现。
