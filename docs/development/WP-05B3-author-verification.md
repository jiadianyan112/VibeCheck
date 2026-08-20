# WP-05B3 作者验证原子闭环交付记录

**工作包：WP-05B3a–d｜基线：PRD v1.10｜状态：候选实现，待 GitHub Actions PostgreSQL 门禁确认｜日期：2026-08-20**

## 1. 交付范围

- P12：验证草稿提交、退回后补充提交、草稿/审核中/退回后撤回及申请人六态投影。
- A06：身份审核队列领取、claim/Session 绑定的审核投影、私密材料一次性读取、退回、拒绝和批准。
- 三种 Creator resolution：`create_new_creator`、`claim_existing_creator`、`use_existing_link`。
- 原子公开事实：`Creator`、首个 `CreatorProfileVersion`、`CreatorAccountLink`、`AuthorRelation`、Project 作者状态、ReviewDecision、WorkItem、审计日志与 Outbox。
- P08/P14：沿用公开目录读取 active AuthorRelation；P13：沿用完整 AuthorAuthorization 链；P15：新增本人 Link/Relation 读取接口。
- 验证批准不创建 `ProjectVersion` 或 catalog `Event`。

## 2. 数据库与事务边界

- 追加 migration `000036_author_verification_lifecycle.sql`，不修改历史 migration。
- 新增 append-only `workflow.verification_request_submissions`，保存每次初次/补充提交的材料、证据与 Link policy 快照。
- 新增 `private_material.material_read_grants`，令牌只保存 SHA-256，绑定 reviewer、主 Session、WorkItem、claim、用途和过期时间；消费或失效后不可复活、不可删除。
- AuthorRelation 新增批准来源 Link；新写入强制 canonical Creator、申请人 Link、规范角色、不可变身份字段和非终态 Creator+Project 唯一性。
- 批准在一个 PostgreSQL 事务内完成全部公开事实、决定、WorkItem、审计和 Outbox。snapshot、owner 唯一键、Profile exact ref、Link version 或关系唯一性冲突均回滚整笔事务。

## 3. 安全边界

- 申请人不能审核自己的申请；审核者必须为管理员或具备 `admin:identity_review`。
- 审核材料读取还必须是当前 verification WorkItem 的有效领取者，claim token、lease、主 Session、Request–Material 均需匹配。
- read grant 最长 5 分钟；一次性兑换时重新校验全部绑定并先消费，再签发最长 60 秒的 S3 GetObject 地址。
- 第二次兑换、过期、领取释放/超时、申请决定/撤回或材料撤销统一失效；签发和兑换分别写不可删除访问日志。
- storage key 不进入 API 响应、普通日志、Analytics 或 grant 表。

## 4. 稳定接口与错误

- 申请：`POST /verification-requests/{id}/submit|supplements|withdraw`。
- 材料：判别 GET、`POST /verification-materials/{id}/read-grants`、一次性 `GET /verification-material-read-grants/{token}`。
- 公开事实：Link GET/本人 LIST，Relation GET/LIST。
- A06：通用 ReviewDecision 增加 verification 判别分支。
- 稳定冲突/安全错误覆盖 `VERIFICATION_LINK_POLICY_CHANGED`、`OWNER_LINK_SET_CHANGED`、`REUSED_LINK_CHANGED`、`AUTHOR_RELATION_EXISTS`、`CONFLICT_OF_INTEREST`、`WORK_ITEM_LEASE_EXPIRED`、`MATERIAL_READ_GRANT_EXPIRED` 与 `MATERIAL_READ_GRANT_CONSUMED`。

## 5. 事件与异步边界

- 首次提交：`author_verification_started`；补充：`verification_resubmitted`。
- 批准/拒绝/已提交撤回：`author_verification_completed`；首次项目作者关联额外产生 `project_author_linked`。
- 撤回会在事务内使 read grant 失效并通过 Outbox 请求撤销对象读取；`LEGAL_HOLD` 仅阻止物理删除，不恢复读取。
- 通知中心投递、搜索索引消费和站外通知仍分别留在后续工作包。

## 6. 冲突处理

技术方案 TX-005 曾描述身份验证创建 ProjectVersion；PRD v1.10 和状态机判别矩阵明确禁止 verification 作为 Version 来源。本实现以 PRD/状态机为准，并同步修正数据库设计和状态机技术规格：验证只更新 Project 作者关联状态与 aggregate，不创建 ProjectVersion/Event。

## 7. 验证证据

- OpenAPI：75 paths / 85 operations，引用和 operationId 检查通过。
- 本地：60 个前端测试文件、285 项测试通过；受影响 database/catalog/workflow/private-material/API/Worker 测试通过；完整类型检查通过。
- 待远端门禁确认：PostgreSQL 18 新库/重复 migration、目录夹具升级、verification create-new 审批事务以及全量 CI。
- production Feature Flag 保持关闭，直到 WorkBuddy 接入 P12/A06 且真实 AWS/Staging 验收完成。
