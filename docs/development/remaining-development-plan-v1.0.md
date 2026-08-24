# VibeCheck 首期 MVP 剩余开发执行计划

**版本：v1.1｜执行状态：第 0–4 步已完成；第 5 步 5.1–5.5 后端绿色、5.6 真实前端 E2E 未开始；第 6 步后端基础存在、正式前端闭环未开始｜记录日期：2026-08-24**

## 1. 执行基线

- 产品基线：`docs/VibeCheck首期MVP开发级PRD-v1.10.md`。
- 技术基线：`docs/VibeCheck首期MVP技术实现方案-v1.0.md`。
- 最近绿色实现基线：`0067aaa`（`fix: repair media fixture rerun guard`），对应 GitHub Actions Run [#32691188138](https://github.com/jiadianyan112/VibeCheck/actions/runs/32691188138)，Run 结论为 success。该 Run 两次执行 41 个 append-only migrations，并通过 URL-check、Media、Evidence、Submission、Workflow、ProjectUpdate、首次发布和通知后端链路；第 5 步 5.1–5.5 后端门禁已绿色。
- 旧失败 Run [#32367557494](https://github.com/jiadianyan112/VibeCheck/actions/runs/32367557494) 仅作为历史记录保留：其 Media fixture 失败导致后续 fixture skipped，不能继续作为当前状态。第 5 步 5.6 真实前端 E2E 尚未开始，WP-05A 的 AWS Staging/production flag 尚未验收。
- 当前分支：`codex/wp-05-submission-return`。
- P0 范围：P01–P18、A01–A14；P19/P20 不进入首期 P0。
- P09 不建立 DecisionRecord，不产生 `decision_submitted`。
- 登录后只保留账号比较状态，不实现游客比较集合选择、替换或合并冲突流程。
- Codex 负责数据库、API、Worker、OpenAPI、权限、安全、基础设施与后端测试；WorkBuddy 负责 `src/**`、`public/**`、视觉、响应式和前端 E2E。未经协调不得跨边界修改。

## 2. 执行顺序

| 步骤 | 工作内容 | 完成门槛 | 状态 |
| --- | --- | --- | --- |
| 0 | 恢复安全开发基线：文件归属、范围漂移、稳定测试证据 | 无用户/WorkBuddy 文件误纳入；冻结范围一致；稳定基线可追溯 | 已完成 |
| 1 | WP-05B2b：S3 + GuardDuty 私密材料安全链 | 未扫描不可读；clean/malicious/unscannable/超时/重试通过；API/Worker/IaC/CI 完整 | 已完成 |
| 2 | 作者验证提交、审核、CreatorAccountLink、AuthorRelation | P12→A06→P08/P13/P14/P15 原子闭环及负向权限测试通过 | 已完成 |
| 3 | 作者归属争议 | 立案、撤案、裁决、关系暂停/恢复及隐私隔离通过 | 已完成 |
| 4 | P01–P09 浏览、搜索、比较真实链路 | 生产路径不读取 Mock；同品类比较及完成口径通过 | 已完成 |
| 5 | P10–P13 发布、审核、回流真实链路 | 六个切片分别通过 URL-check、草稿、审核、首次发布、ProjectUpdate 回流和真实前端 E2E 门禁 | 进行中：5.1–5.5 后端绿色；5.6 真实前端 E2E 未开始；WP-05A AWS Staging/production flag 未验收 |
| 6 | P14–P18 社区和个人闭环 | 六个切片分别通过互动评论、P14、P15、P16、P17 和 P18 门禁，并完成真实前端闭环 | 后端基础部分存在；正式前端闭环未开始 |
| 7 | A01–A14 正式后台 | 全路由无占位；高风险操作具备鉴权、预览、确认、原因、乐观锁和审计 | 待开始 |
| 8 | 生产搜索与查同类 | 结构化+FTS 基线、可降级语义适配器、固定评估集和版本快照通过 | 待开始 |
| 9 | Analytics、埋点和指标 | 路径可还原、指标可直接计算、禁止废弃事件 | 待开始 |
| 10 | Staging 与生产基础设施 | Render/AWS/Resend/密钥/迁移/监控/恢复可重复部署 | 待开始 |
| 11 | 发布候选硬化 | 全路由、五角色、安全、性能、恢复、可访问性和视觉验收无阻断项 | 待开始 |
| 12 | 小流量 Beta 与正式上线 | 分阶段 Feature Flag 开放并完成观察期 | 待开始 |

## 3. 每个工作包的统一交付门禁

1. 先冻结 OpenAPI、Schema、状态与错误码，再实现存储和业务逻辑。
2. 数据库迁移只追加，不修改已发布 migration；同时验证新库和升级路径。
3. 所有写操作覆盖幂等、乐观锁、鉴权、审计、重复请求和并发失败。
4. 异步流程覆盖 Outbox 去重、重试、死信、重启恢复和卡死任务回收。
5. 生产 Feature Flag 在纵向闭环完成前保持关闭。
6. 每个工作包运行格式/静态检查、类型检查、单元、契约、PostgreSQL 集成和必要 E2E。
7. 每个提交只包含当前工作包受控文件；不提交 WorkBuddy、用户文档、截图或输出目录。
8. 每次后端切片向 WorkBuddy 交付 OpenAPI SHA、生成客户端、fixture、错误映射、权限说明和 Mock 清理清单。

## 4. 外部上线门禁

- AWS 账号/部署角色：S3 + GuardDuty 真实验收。
- Render 项目权限：Staging 与生产部署。
- Resend、发件域名和 DNS：真实邮箱 OTP。
- 正式域名：Cookie、Origin、CORS、回跳和分享验收。
- 语义服务供应商与预算：生产语义能力。
- 数据保留、私密材料保留和 RPO/RTO：发布候选验收。
- P01 双品类冷启动权重：生产排序验收。

## 5. 计划维护规则

- 本文件是剩余开发的持久执行记忆；状态变化随交付提交更新。
- 若 PRD、产品批准或安全结论改变，以最新明确批准为准，并在此记录影响和迁移动作。
- 时间预估：内部真实使用 2–3 周，小范围 Beta 4–6 周，完整 P0 发布候选 7–9 周；完成状态只按门禁证据判断，不按日期判断。

## 6. 第 0 步完成记录

### 6.1 文件归属

- Codex 当前受控草稿仅限 `apps/worker/package.json`、`package-lock.json`、`packages/config/**`、`packages/private-material/**` 以及 `apps/worker/src/private-material-scan-handler*`。
- `.workbuddy/**`、`.ardot-shots/**`、`src/**`、`public/**`、`e2e/**`、`outputs/**`、旧 PRD/复审文件和 `docs/highfi-tokens-mapping.md` 均视为 WorkBuddy 或用户文件，不纳入 Codex 提交。
- `git diff --check` 通过；没有发现空白错误。

### 6.2 稳定门禁证据

- 前端基线：60 个测试文件、285 项测试全部通过。
- 契约基线：`contract_ok paths=66 operations=76`。
- 当前后端草稿：`npm run typecheck:foundation` 全部通过。该结果只证明类型与构建边界成立，不代表 WP-05B2b 行为完成。
- GitHub CLI 当前没有登录，未在本轮重新查询远端 Run；稳定提交 `5648e47` 的既有 CI 证据保留，不以本轮远端查询替代。

### 6.3 范围漂移处理

1. P09 的 `DecisionRecord`、`DecisionForm`、`decision_submitted` 和“决策记录”文本仍残留在前端原型类型、状态、Mock 与路由描述中，但当前 P09 页面主路径不要求 action record。此清理由 WorkBuddy 在 P01–P09 真实 API 接入时完成；生产构建不得导入或产生这些对象和事件。
2. 游客比较合并冲突的旧 OpenAPI、API、数据库对象和测试仍存在。根据 2026-08-20 前的已批准产品决定，P0 登录后只保留账号状态，不向用户提供合并、替换或选择流程。旧 migration 保持 append-only，不回改历史；相关公开 Operation、运行入口和执行器在 P01–P09 联调前通过独立兼容清理退场，且不得被前端调用。
3. 上述两项不阻断 WP-05B2b，但都是发布候选的强制清理门禁。

## 7. 第 1 步完成记录

### 7.1 交付基线

- 工程提交：`f6e5581`（`feat: complete private material scan pipeline`）。
- API 装配 AWS S3 私密材料适配器；Worker 消费 `verification_material_scan_requested`，实现材料领取租约、GuardDuty 标签轮询、领域级重排、三次 provider failure 上限和过期回收。
- `prepare` OpenAPI 返回五个必须原样发送的签名 Header；上传使用 checksum、SSE-S3、quarantine 标签和 `If-None-Match: *` 条件写入。
- 追加第 35 个 migration，仅扩展版本化 `scanning → scanning` 轮询迁移；历史 migration 未修改。
- 新增 `infra/aws/private-material.yaml`，冻结私有桶、GuardDuty MalwareProtectionPlan、条件写入与 GuardDuty/application 双标签读取门禁。
- 生产 Feature Flag 继续默认关闭；真实 AWS 资源、部署角色与恶意/干净样本演练仍属于第 10 步外部上线门禁，不以 Mock 冒充已激活。

### 7.2 验证证据

- 本地：Lint 无错误；全仓 TypeScript、OpenAPI、Render 部署契约、全部基础包测试和生产构建通过。
- 前端回归：60 个测试文件、285 项测试全部通过；未修改或暂存 WorkBuddy 文件。
- 私密材料包：17 项单元/基础设施契约测试通过。
- GitHub Actions：Run [#60](https://github.com/jiadianyan112/VibeCheck/actions/runs/32332867619) 成功；PostgreSQL 18 上第 35 个迁移重复执行、既有控制面 fixture 和新增 GuardDuty 扫描事务 fixture 全部通过。
- 详细实现与激活规则见 `docs/development/WP-05B2b-private-material-scan.md`。

## 8. 第 2 步完成记录

### 8.1 交付基线

- 工程基线提交：`9b0cfec`；核心实现起点为 `f555993`。
- 追加 migration `000036_author_verification_lifecycle.sql`，完成提交快照、操作幂等收据、材料 read grant、verification ReviewDecision、AuthorRelation 来源/唯一性/迁移 Guard；历史 migration 未修改。
- P12 完成 submit、supplement、withdraw 与六态本人投影；A06 完成领取、审核投影、一次性材料读取、changes-requested、reject、approve。
- 三种 resolution 全部落为同一 PostgreSQL 事务中的公开事实；验证批准不创建 ProjectVersion/Event。
- P08/P14 可读取 active 最小署名，P13 复用完整 AuthorAuthorization，P15 可读取本人 Link/Relation；公共端不能枚举 Link。
- WorkBuddy 接入资料见 `docs/development/WP-05B3-workbuddy-handoff.md`；production Feature Flag 继续关闭至真实 AWS/Staging 验收。

### 8.2 验证证据

- OpenAPI：75 paths / 85 operations；SHA-256 `b761a81364f87680fcd6ce749cc3acb4304c39c478da6791bc6c554350c84775`。
- GitHub Actions：Run [#32347906631](https://github.com/jiadianyan112/VibeCheck/actions/runs/32347906631) 成功。
- PostgreSQL 18：36 个 append-only migration 新库/重复执行通过；create-new、claim owner、claim manager、use-existing、补充/拒绝/三类撤回、自审拦截、重复关系全回滚、一次性 read grant 与双审计通过。
- 全仓契约、部署检查、Lint、TypeScript、测试、foundation tests、生产构建及后续既有 PostgreSQL 夹具全部通过。
- 详细事务、安全边界和冲突处理见 `docs/development/WP-05B3-author-verification.md`。

## 9. 第 3 步完成记录

### 9.1 交付基线

- 核心工程基线：`59eece1`；新增 `000037_ownership_dispute_lifecycle.sql`，历史 migration 未修改。
- 完成立案、证据追加、撤回申请与 supersedes 历史、撤回拒绝、`uphold/revoke/withdraw` 三类终局，以及 Party/Reviewer 隔离投影。
- Case 创建即暂停 AuthorRelation；终局事务原子恢复或终止 Relation、重算 Project 作者态、决定 WorkItem、消费安全令牌并写不可删除审计与 Outbox。
- 队列分页前过滤持久与实时冲突主体；claim、审核读取和决定时再次校验，申请人、关系主体、证据提交者和撤回申请者不能审核案件。
- Ownership ReviewDecision 不创建 ProjectVersion/Event；按 PRD v1.10 Version 判别矩阵处理与旧技术说明的冲突。
- WorkBuddy 接入资料见 `docs/development/WP-05B4-workbuddy-handoff.md`；production Feature Flag 继续关闭。

### 9.2 验证证据

- OpenAPI：81 paths / 91 operations；SHA-256 `7550fbd6f968eccd8531df74f4f926338bc336fd15651746251414231a33d4ac`。
- GitHub Actions：Run [#32355331970](https://github.com/jiadianyan112/VibeCheck/actions/runs/32355331970) 成功。
- PostgreSQL 18：37 个 append-only migration 新库/重复执行通过；归属夹具覆盖三类终局、两轮撤回、冲突主体轮换、claim 释放、队列预分页隔离、VerificationRequest 保留及 Relation/Project/Outbox 原子一致性。
- 全仓契约、部署检查、Lint、TypeScript、测试、foundation tests、生产构建及全部既有 PostgreSQL 夹具通过。
- 同时修复验证 supersedes 链在同时间戳下依赖随机 UUID 排序的旧非确定性，现按无后继链尾判定。
- 详细事务、安全边界和未纳入范围见 `docs/development/WP-05B4-ownership-dispute.md`。

## 10. 第 4 步完成记录

### 10.1 交付基线

- 核心工程基线：`3dfc15a`；追加 `000038`–`000040`，历史 migration 未修改。
- P01–P04 增加双品类/九专题版本化字典、专题别名和跨作品公开事件流；0 个匹配作品的专题仍稳定返回。
- P05→P08 使用 owner-bound、服务端签名并一次消费的 SearchNavigationContext，原子产生 `feed_item_clicked/v2` 与 `project_viewed/v2` 可核验事实。
- P09 保持同品类 2–5 项和可信完成口径；OTP 登录、PendingAction、公开 OpenAPI 和运行路由均落实“只保留账号比较状态”。
- P06/P07 的生产语义和正式评估仍按计划留在第 8 步；旧浏览器规则不得在 production 冒充真实能力。

### 10.2 验证证据

- OpenAPI：82 paths / 92 operations；SHA-256 `7928370e7674f80638e5ca451e2a795dd55f8d71a492eb0e9dc481f0dcdb823f`。
- GitHub Actions：Run [#32362182369](https://github.com/jiadianyan112/VibeCheck/actions/runs/32362182369) 成功。
- PostgreSQL 18：40 个 append-only migration 新库/重复执行通过；目录、搜索导航归因、比较和既有全量夹具通过。
- 本地契约、Lint、TypeScript、foundation tests 和生产构建通过；未修改或暂存 WorkBuddy 前端文件。
- 详细边界见 `docs/development/WP-04-browse-search-comparison.md`；前端接入见 `docs/development/WP-04-workbuddy-handoff.md`。

## 11. 第 5 步切片执行计划：P10–P13

### 11.0 当前证据与执行顺序

- `0067aaa` 已修复 Media fixture 重放守卫；Run [#32691188138](https://github.com/jiadianyan112/VibeCheck/actions/runs/32691188138) 成功。质量门、41 个 migration 新库/重复执行和 URL-check、Media、Evidence、Submission、Workflow、ProjectUpdate、首次发布、通知后端链路均通过；5.1–5.5 后端切片可标记绿色。
- 旧失败 Run [#32367557494](https://github.com/jiadianyan112/VibeCheck/actions/runs/32367557494) 作为历史记录保留，不再作为当前状态；最近完整代码/CI 基线以 `0067aaa` / Run `32691188138` 为准。
- 切片仍按 5.1→5.2→5.3→5.4→5.5→5.6 顺序验收；5.6 真实前端 E2E 尚未开始，WP-05A AWS Staging/production flag 尚未验收，不能把后端绿色顺延为第 5 步全部完成。

### 11.1 URL 检查

- **现状**：P10 URL-check 与不可变 SubmissionDraft 边界已实现；`0067aaa` 的 Run `32691188138` 中 URL-check fixture 通过，且已增加导出的 typed HTTP client 契约实现。服务端已覆盖规范化、SSRF/DNS 风险、重复候选、30 分钟 TTL、owner 绑定和同请求幂等。
- **依赖/完成门槛**：必须先通过 `contracts:check`；相同 owner、规范输入和 `client_request_id` 重放返回同一 check，异载荷冲突；URL 过期、输入哈希/品类/最终跳转或安全结论变化必须强制复检；只有允许且无确定重复时才能进入草稿创建。
- **验证命令**：`npm run contracts:check`；`npm run submission:fixture:verify`；再以带数据库的 quality workflow 复跑同一 fixture。
- **禁止误报**：fixture 通过不等于 P10 前端已接真实 API；URL-check 通过不等于目标站点长期可用；不得把 `uncertain`、超时或依赖服务失败写成“安全通过”，也不得声称已自动创建 Project。

### 11.2 草稿提交

- **现状**：SubmissionDraft 的创建、编辑、预览绑定和提交服务已有实现；`0067aaa` 的 Run `32691188138` 已通过 Submission 相关后端 fixture，草稿提交链取得 PostgreSQL 绿色证据。
- **本轮状态**：typed client 已提交并推送（`4445def`）；GitHub Actions Run [#32720210701](https://github.com/jiadianyan112/VibeCheck/actions/runs/32720210701) 成功，contracts/后端质量门已通过；真实前端 E2E 未开始。
- **依赖/完成门槛**：依赖 11.1 的未过期 check；草稿 owner、schema/P0 字段、`ready+clean` 媒体、所需 `ready` EvidenceDraft、版本和 preview hash 必须在同一提交前置校验中成立；提交必须冻结快照、创建唯一 pending-review Submission，并保持原 Draft 只读。
- **验证命令**：`npm run submission:submit:fixture:verify`；`npm run submission:revision:fixture:verify`；`npm run typecheck`；随后运行真实前端 E2E 的草稿创建/预览/提交场景。
- **禁止误报**：创建 Draft 不等于创建 Project；`pending_review` 不等于已发布；未执行或 skipped 的 fixture 不能计为通过；不得用前端 Mock 的媒体/证据 ID 绕过 owner、状态或 preview hash 门禁。

### 11.3 审核决定

- **现状**：通用审核队列、租约、提交审核决定和 ProjectUpdate 决定基础已存在；`0067aaa` 的 Run `32691188138` 已通过 Workflow/审核相关后端 fixture，取得绿色证据。
- **依赖/完成门槛**：依赖已冻结的 Submission/ProjectUpdate 快照；领取、预览、确认、决定必须校验 work type/target、角色职责分离、租约和 expected version；决定不可变、同请求幂等、异决定冲突，并拒绝提交者或冲突主体自审。
- **验证命令**：`npm run workflow:fixture:verify`；`npm run workflow:review-decision:fixture:verify`；`npm run deployment:check`；再复跑依赖的 submission fixture。
- **禁止误报**：审核队列存在不等于决定已通过；approve 不单独等于发布成功；后端 fixture 通过不能写成“审核 E2E 通过”；不得用 session 角色或客户端 payload 冒充作者授权事实。

### 11.4 首次发布

- **现状**：发布事务和 worker 基础实现已在 `0067aaa` 的绿色 Run 中通过首次发布相关后端 fixture，已取得当前 HEAD 的 PostgreSQL 发布证据。
- **依赖/完成门槛**：依赖有效 URL check、完整 Draft、ready 媒体/证据和不可变 approve 决定；发布必须原子创建唯一 Project、首个 Version、正式 Evidence/MediaReference、`first_published` Event、Outbox 和 receipt，并支持同决定幂等回放，不得留下半对象。
- **验证命令**：`npm run submission:publication:fixture:verify`；`npm run test:foundation`；`npm run build`；随后用真实 API E2E 覆盖提交→审核→首次发布和重复投递。
- **禁止误报**：批准、Outbox 入队或本地单测都不等于公开发布；后端 PostgreSQL fixture 通过不能替代真实前端 E2E 或 AWS Staging 验收；发布成功不得创建未授权 AuthorRelation，也不得在失败时留下 Project/Version/Event 半对象。

### 11.5 ProjectUpdate 回流

- **现状**：`0067aaa` 已包含 ProjectUpdate 的 MediaReference/EvidenceDraft 创建、绑定、解绑、版本推进和 `verified_author_statement` 授权校验；Run `32691188138` 已通过 Media、Evidence、ProjectUpdate、首次发布、搜索/回流及通知相关后端 fixture。
- **依赖/完成门槛**：依赖 11.2–11.4 的事实和 WP-05B 的父对象绑定；更新稿必须是 owner 的 `editing`，沿 active CreatorAccountLink→canonical Creator→active AuthorRelation→exact permission profile 做字段权限交集；只有批准后的 Update 才能原子生成新 Version/Event、切换 Project 指针，并按 Outbox 可靠回流搜索与收件人隔离通知。
- **验证命令**：`npm run media:fixture:verify`；`npm run evidence:fixture:verify`；`npm run workflow:review-decision:fixture:verify`；`npm run catalog:project-update:application:verify`；`npm run worker:project-updated:fixture:verify`；需要通知时再运行 `npm run community:notification:fixture:verify`。
- **禁止误报**：绑定媒体/证据不等于公开更新；`editing` 或 `update_pending` 不得写成已应用；后端 fixture 通过不等于真实前端 E2E 或 AWS Staging/production flag 验收；不得用客户端 `verified_author`、旧 creatorId 或 session 角色绕过真实授权链。

### 11.6 前端真实 E2E

- **现状**：仓库已有 P10–P13 低保真页面和原型 E2E，但页面仍主要使用 `src/mocks/**`；正式前端对真实 API 的端到端闭环尚未开始。
- **依赖/完成门槛**：依赖 11.1–11.5 的 PostgreSQL 绿色证据、冻结的 OpenAPI SHA/生成客户端、可运行 API/Worker、认证和媒体测试环境；真实 E2E 必须通过 URL 检查→草稿→预览/提交→审核→首次发布→ProjectUpdate 回流，检查网络请求没有 Mock 兜底，并覆盖权限、过期、重复和失败状态。
- **验证命令**：新增真实 API 场景后运行 `npm run build`；`npm run test:e2e -- --project=desktop-chromium`；完整交付运行 `npm run test:e2e` 和第 5 步全部 fixture 命令。
- **禁止误报**：现有 prototype task、截图、静态页面或 `localStorage` 场景不能计为真实 E2E；只通过 `npm run test:e2e` 也不能证明后端链路，必须记录 API/数据库/Worker 证据；未配置真实 API 时不得标记完成。

## 12. 第 6 步切片执行计划：P14–P18

### 12.0 共同状态与门禁

- 六个切片的共同状态是“后端基础部分存在；正式前端闭环未开始”。现有页面和 prototype E2E 只能证明原型覆盖，不能证明正式 MVP；每个切片都必须新增真实 API 接入、权限/错误态和真实 E2E 证据后才可关闭。
- 依赖顺序建议为 12.1 互动评论→12.2 P14 作者主页→12.3 P15 个人中心→12.4 P16 通知→12.5 P17 认证回放→12.6 P18 可信机制；通知依赖发布/更新 Outbox，认证回放依赖真实认证配置，可信机制依赖版本化配置与证据投影。

### 12.1 互动评论

- **现状**：`@vibecheck/community` 已有互动最终状态、幂等计数、评论、举报、撤回和审核工作项基础；`npm run community:fixture:verify` 已在绿色 Run `32691188138` 中通过。正式 P08/P14/P15 前端互动闭环未开始。
- **依赖/完成门槛**：评论创建、列表、举报、作者撤回必须按当前用户/公开状态/版本和速率限制校验；收藏、点赞、关注和评论计数必须由服务端事实与事件驱动，重复请求不重复计数；真实页面必须覆盖登录、pending moderation、可见/折叠/撤回和权限错误。
- **验证命令**：`npm run community:fixture:verify`；`npm run test:foundation`；真实页面接入后运行 `npm run test:e2e -- --project=desktop-chromium`。
- **禁止误报**：交互 fixture 通过不等于评论 UI 已接后端；pending 评论不得显示为公开评论；前端乐观计数、Mock 事件和 localStorage 状态不能替代数据库计数；评论不应被当作通知或可信证据。

### 12.2 P14 作者主页

- **现状**：公开 Creator 投影、active AuthorRelation 的最小署名和作者授权读取基础已存在；相关 catalog/authorization fixture 已在绿色 Run `32691188138` 中通过。`/creator/:id` 仍是原型页面，正式真实 API 闭环未开始。
- **依赖/完成门槛**：公开接口只能返回 canonical Creator、公开档案和已发布作品；必须隔离 Link、VerificationRequest 材料和审核细节，正确显示 active/suspended/disputed/ended 状态、来源与更新时间；前端必须覆盖不存在、隐私隔离、争议和无作品状态。
- **验证命令**：`npm run catalog:authorization:verify`；`npm run contracts:check`；`npm run build`；真实 P14 页面接入后运行 `npm run test:e2e`。
- **禁止误报**：路由存在、原型有作者卡片或 `creatorId` 可读取不等于 P14 正式完成；不能公开枚举 CreatorAccountLink；`verified_author` session 角色不等于 active AuthorRelation，也不能把作者主页显示为所有权证明。

### 12.3 P15 个人中心

- **现状**：当前账号状态、作者 Link/Relation 的 owner-bound 投影和 PendingAction 相关基础存在；个人资产/草稿/通知入口已有原型页面，但正式 API 接入和完整账户闭环未开始。
- **依赖/完成门槛**：所有列表和详情按 session user_id 服务端隔离；P15 需覆盖草稿、提交、作者验证、ProjectUpdate、收藏/关注/比较和通知入口的状态汇总，分页/游标、空态、过期、受限账号和跨用户拒绝均有确定响应；任何敏感材料只走专用授权读取。
- **验证命令**：`npm run catalog:authorization:verify`；`npm run identity:pending:verify`；`npm run contracts:check`；真实 P15 接入后运行 `npm run test:e2e`。
- **禁止误报**：localStorage 的个人状态不等于账户数据；“固定身份选择”不等于真实认证；仅能看到自己数据不代表所有 P15 写操作已闭环；不能把 Link/Relation 内部字段渲染为公开个人信息。

### 12.4 P16 通知

- **现状**：Notification 事实、接收者隔离、游标读取、不可逆已读收据和发布/更新 worker 基础已存在；通知相关后端 fixture 已在绿色 Run `32691188138` 中通过。正式 `/notifications` 前端闭环未开始。
- **依赖/完成门槛**：依赖首次发布和 ProjectUpdate 应用/投影 Outbox；通知必须按 recipient、目标和 dedup key 幂等，未读优先且 cursor 绑定用户，跨用户读取/批量已读整批拒绝；P16 只承诺站内通知，不扩展邮件、短信或推送。
- **验证命令**：按依赖顺序运行 `npm run submission:publication:fixture:verify`、`npm run worker:project-updated:fixture:verify`、`npm run community:notification:fixture:verify`；真实页面接入后运行 `npm run test:e2e`。
- **禁止误报**：后端 notification fixture 通过不等于前端已展示正确；存在通知表不等于前端闭环；发布/更新异步失败时不得伪造成功通知；站内通知不能写成邮件/推送已实现。

### 12.5 P17 认证回放

- **现状**：加密 PendingAction、purpose 绑定的 IdentityLink、consume/cancel/expire 和一次性真实领域回放基础存在；`npm run identity:pending:verify` 已在绿色 Run `32691188138` 中通过。`/auth` 仍使用原型固定身份，正式认证回调与前端闭环未开始。
- **依赖/完成门槛**：需要真实认证/OTP、Cookie、Origin、CSRF 和密钥配置；`return_to` 必须同源 allowlist，pending payload 最小化并加密，业务写成功后才消费且只能回放一次，过期/取消/刷新不得重复执行；不得恢复未批准的游客比较合并流程。
- **验证命令**：`npm run identity:pending:verify`；`npm run test`；真实认证环境接入后运行 `npm run test:e2e -- --project=desktop-chromium`，覆盖成功回跳、外跳拒绝、重复刷新和业务失败保留 pending。
- **禁止误报**：PendingAction fixture 通过不等于真实身份认证已接入；服务端回放基础不等于浏览器回跳安全已验收；不能把客户端 execution receipt、role 或 return_to 当作可信授权；一次成功不得因刷新再次执行。

### 12.6 P18 可信机制

- **现状**：Catalog 的版本化事实/证据类型、作者关联和状态投影基础存在；`/about` 和项目详情的可信说明仍是原型静态内容，正式版本化可信规则配置、缓存回退和真实前端闭环未开始。
- **依赖/完成门槛**：建立只读的已发布规则配置版本，覆盖双品类边界、事实/推断、证据类型、状态和纠错说明；配置失败时只能显示最近已发布版本及时间，不显示未发布草稿；页面不能把异常、数量或推断升级为商业成功、质量或失败结论。
- **验证命令**：`npm run contracts:check`；`npm run catalog:fixture:verify`；`npm run build`；可信配置与页面接入后运行 `npm run test:e2e`，覆盖当前版本、缓存回退、未知状态和争议状态。
- **禁止误报**：静态 `/about` 通过不等于可信配置服务完成；Evidence 类型存在不等于每条事实都有充分证据；“可信”不能写成平台保证或商业判断；缓存回退不得展示未发布规则。
