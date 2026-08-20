# VibeCheck 首期 MVP 剩余开发执行计划

**版本：v1.0｜执行状态：第 0–4 步已完成，第 5 步进行中｜记录日期：2026-08-20**

## 1. 执行基线

- 产品基线：`docs/VibeCheck首期MVP开发级PRD-v1.10.md`。
- 技术基线：`docs/VibeCheck首期MVP技术实现方案-v1.0.md`。
- 稳定代码基线：`6296652`，正式完成至第 4 步。
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
| 5 | P10–P13 发布、审核、回流真实链路 | URL 安全、草稿、媒体/证据、审核、发布、更新 E2E 通过 | 进行中：公开封面媒体闭环已实现，待 PostgreSQL CI 与后续切片 |
| 6 | P14–P18 社区和个人闭环 | 互动幂等计数、作者主页、个人中心、通知和登录回放通过 | 待开始 |
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

## 11. 第 5 步进行记录

### 11.1 已完成切片：P11 公开封面媒体安全闭环

- 追加 migration `000041_public_media_upload_control_plane.sql`，增加上传/处理期限、不可变完成回执、上传身份字段 Guard 和状态索引；历史 migration 未修改。
- `POST /api/v1/media-resources` 只接受 `project_cover`、JPEG/PNG/WebP/AVIF、1–5 MiB 和 SHA-256，返回 15 分钟 S3 quarantine 条件上传指令。
- `POST /api/v1/media-resources/{id}/complete` 通过 HeadObject 校验 ETag、MIME、长度和 checksum，原子写入完成回执并产生 `media_scan_requested`。
- Worker 轮询 GuardDuty 标签；仅 `NO_THREATS_FOUND` 进入服务端 Sharp 真实解码、方向归一和元数据剥离，并写入独立 ready 对象后将数据库置为 `ready+clean`。恶意、不可扫描、超时和三次 provider failure 均进入不可引用的 rejected 终态。
- `GET /api/v1/media-resources/{id}/content` 只允许资源所有者读取 `ready+clean` 的净化对象，返回最长 60 秒的私有 302，不暴露 storage key。
- `start_submission` PendingAction 现只消费登录门禁并使用受信 `return_to` 进入 P10/P11；不会跳过 URL check 或自动创建草稿。
- AWS 模板见 `infra/aws/public-media.yaml`；production `MEDIA_ENABLED` 仍为 false，真实 S3/GuardDuty/Staging 验收属于第 10 步外部门禁。
- 本切片不开放视频、不提供公开 CDN、不实现资源物理删除 Saga；这些能力不能由前端 Mock 冒充。
- 实现边界见 `docs/development/WP-05A-public-media.md`；WorkBuddy 接入见 `docs/development/WP-05A-workbuddy-handoff.md`。

### 11.2 已完成实现、等待 PostgreSQL CI：P13 媒体与证据绑定

- 修复“契约允许 `project_update`、PostgreSQL Store 运行时返回 503”的实现断点；MediaReference 与 EvidenceDraft 现可绑定 editing ProjectUpdate。
- 绑定和解绑在各自事务内同步更新 ProjectUpdate 引用数组并推进 optimistic version；公开 Project、Version、Event 不受影响。
- ProjectUpdate 的 `bigint` 版本进入 Evidence 投影前执行安全整数转换，避免 Node `pg` 字符串与请求数字严格比较造成伪 409。
- `verified_author_statement` 改为创建事务内校验 active Link＋Relation、exact permission profile 和字段权限交集；Session 角色不再被当作作者事实来源。
- 修复 WP-05A 首次 CI 暴露的 Outbox 多态 JSON 参数 42P08，并将同类扫描重排、审计 SQL 一并显式定型。
- PostgreSQL fixture 新增两类父对象的可重放验证；实现说明见 `docs/development/WP-05B-project-update-media-evidence.md`，WorkBuddy 接入见 `docs/development/WP-05B-workbuddy-handoff.md`。
