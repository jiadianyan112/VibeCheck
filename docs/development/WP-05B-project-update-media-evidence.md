# WP-05B：P13 项目更新媒体与证据绑定闭环

**状态：实现已提交（HEAD `9c47e55`）；当前 CI 失败，未全量验证｜日期：2026-08-24**

## 1. 交付目标

解除 P13 的运行时断点：ProjectUpdate OpenAPI 虽已声明 `project_update` 媒体目标和证据父对象，既有 PostgreSQL Store 却仅实现 `submission_draft`，正式请求会返回 503。本切片让编辑中的项目更新稿能够绑定、校验和撤销真实 MediaReference/EvidenceDraft，而不改动公开 Project、Version 或 Event。

## 2. 后端约束

- 仅更新稿所有者可操作，且目标必须处于 `editing`；非所有者返回 403，非编辑态返回 409，不存在返回 404。
- MediaReference 创建前仍要求 MediaResource 属于同一用户、`ready+clean` 且不存在 deletion guard。
- EvidenceDraft 必须以 `parent_type=project_update` 和该 Update ID 创建；bind 使用 Update 当前版本做乐观锁。
- `verified_author_statement` 不信任客户端角色或 IAM 角色文本；创建事务要求目标为本人的 editing ProjectUpdate，并沿 active CreatorAccountLink→canonical Creator→active AuthorRelation→exact LinkPermissionProfile 校验 `project_update.create` 与该 `field_path` 的权限交集。通过后服务端才冻结 `collector_actor_type=verified_author`。
- 作者声明固定使用 `source_channel=author_statement`；缺少字段上下文、关系暂停/终止、Link 失效或字段越权均不创建 EvidenceDraft。
- 媒体创建/解绑、证据绑定/撤回各自在原事务内更新 `media_reference_ids_json` 或 `evidence_draft_ids_json`，并严格将 ProjectUpdate `version+1`。
- Evidence 的 ProjectUpdate `bigint` 版本在进入 TypeScript 投影前转换并校验为安全正整数，避免 `pg` 字符串返回造成伪版本冲突。
- ProjectUpdate `patch/preview/submit` 继续复用既有 `validateDraftBindings`：只接受同 owner、同 Update、有效状态的证据，以及 active、ready+clean 的媒体引用。
- 所有解绑均保留不可变操作回执、快照和审计记录；不会物理删除资源或证据。

## 3. CI 同步修复

上一切片的 PostgreSQL media fixture 暴露 Outbox SQL 42P08：同一参数同时用于 `varchar` aggregate 和 `jsonb_build_object(any)` 时无法推断类型。本切片为上传完成、扫描重排和扫描审计中的 JSON 参数增加显式类型，不改变事件结构或公开契约。

## 4. 当前 CI 状态与验证范围

- GitHub Actions Run [#32367557494](https://github.com/jiadianyan112/VibeCheck/actions/runs/32367557494) 对应 HEAD `9c47e55`，结论为 `failure`。质量门、41 个 migration 新库/重复执行和 URL-check fixture 通过；Media fixture 失败；本工作包的 Evidence fixture 以及后续提交、审核、应用、搜索投影和通知 fixture 均 skipped。
- 最近完整绿色基线为提交 `6296652` / Run [#32362566696](https://github.com/jiadianyan112/VibeCheck/actions/runs/32362566696)。该 Run 不能替代当前 HEAD 对 `project_update` Media/Evidence 事务的验证。

- Media PostgreSQL fixture 覆盖 `submission_draft` 与 `project_update` 的创建、数组写入、解绑、版本推进和重放后终态。
- Evidence PostgreSQL fixture 覆盖 `project_update` 的 create→bind→patch→complete→withdraw，验证绑定数组和版本从 3→4→5；另覆盖无作者链 403，以及普通 Session 角色通过真实 active Link＋Relation 创建 `verified_author_statement`。
- 本地静态检查、TypeScript、契约和生产构建可作为实现信号，但不能替代 PostgreSQL 事务证据；不再将固定的前端测试文件/项目数写成当前验收结论。
- 本地无 PostgreSQL；最终门禁必须在 PostgreSQL 18 上先通过 `npm run media:fixture:verify`，再运行 `npm run evidence:fixture:verify`，并继续完成后续应用/回流 fixture。

## 5. 边界

本切片不新增 API 路径，不修改 OpenAPI 类型，不实现前端、不改变 ProjectUpdate 审核或应用状态机，也不开放视频和附件物理删除。公开事实仍只在已批准 Update 的既有应用事务中产生。
