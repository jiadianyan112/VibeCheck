# WP-03：目录与发现

**状态：开发中（公共读取、关键词搜索、QuerySnapshot 生命周期、Asset 安全解析与 Comparison 核心已实现）｜日期：2026-08-12｜前置：WP-02 / PR #1**

## 1. 本批交付

本批建立目录域的生产数据边界，不把 `src/mocks` 或 localStorage 当作生产事实：

- 新增 `@vibecheck/catalog` workspace，承载 Project/Creator 公共投影、双 Category Schema 运行时校验、稳定游标和 PostgreSQL Store；
- 新增 `000004_catalog_public_read.sql`，落地 taxonomy、Project、Version、Creator、AuthorRelation、Event、Asset、Relation、Evidence、InteractionCounter 与 SearchDocument 首批结构；
- Project Version 使用 `ProjectCore + category_id + category_schema_version + category_data`，Learning 专属字段不得出现在 ProjectCore；
- ProjectVersion、CreatorProfileVersion、Event 使用 append-only 保护；Project 当前版本在事务提交时校验所属 Project 与 Category Schema；
- taxonomy 固定启用 `ai_learning_quiz / learning.v1` 与 `personal_site_portfolio / portfolio.v1`；配置内容哈希由数据库生成；
- 实现目录公共读取、`OP-SEARCH` 关键词检索、`OP-QUERY-GET/LINK/UNLINK/INVALIDATE`、`OP-ASSET-RESOLVE` 与 `OP-COMP-GET/PUT/SAVE`；OpenAPI 当前为 17 条路径、20 个 Operation；
- Project Detail 内嵌仅公开、有效且未过期的 Evidence 摘要，以及已确认且两端作品均公开的 Project→Project Relation；不暴露内部记录引用、私有证据或审核人；
- Event 使用 `event_sort.v1` 将日/月/年/估算精度映射为持久 UTC 排序锚点；默认只读当前事件头，生命周期状态由 supersedes 关系派生；
- Asset 列表只返回可复用元数据和 `requires_resolve`，不返回 `safe_web_url/contact_uri` 原值；只有按次安全解析成功后才返回短期目标；
- 新增双品类确定性 SearchDocument 构建器，只索引公开快照中的冻结字段，不索引 URL 或私密资料；
- 新增 `catalog.synthetic.v1` development/test 合成夹具：3 个 Project、双 Category Schema、Creator/Event/Asset/Evidence/Relation/SearchDocument；固定 manifest hash、事务级 advisory lock、幂等审计和状态漂移检测；
- 合成夹具在 `production` 进入数据库连接前硬拒绝；它只用于本地联调与 CI，不是 64 个正式冷启动档案，也不得计入业务指标；
- 作品列表使用 HMAC 签名游标，绑定 category、snapshot_at、最后更新时间和稳定 ID；并发新增/更新不会进入既有翻页快照；
- 公共读取只返回 `published_platform/published_author`，`restricted/archived` 返回 403，`deleted` 返回 410；非 active AuthorRelation 不进入 Creator 公开投影；
- Render 通过 `CATALOG_ENABLED` 和独立 `CATALOG_CURSOR_SECRET` 启用目录域，不复用 OTP 或 Session 密钥。
- QuerySnapshot 使用 envelope encryption；原始查询不进入响应、URL、普通日志、Analytics、Intent 或过滤快照；恢复接口只返回结构化意图、筛选、排序与版本，并固定返回 `input_state=not_restored`。
- 邮箱 OTP 登录成功签发 5 分钟、单用途、单次消费的 `query_continuation` IdentityLink；链接只增加用户授权，不迁移匿名 owner、不延长 24 小时快照 TTL；解绑后用户立即恢复 403，匿名 owner 不受影响。
- QuerySnapshot 失效对 owner/authorized subject 幂等返回 204，并在同一事务把 envelope data key 和原文密文置空；后续所有主体读取返回 410。
- 第六号迁移增加查询操作幂等回执、IdentityLink 外键/撤销时间、密文擦除约束和隐私审计落点；`query_id+operation_id+subject_hash` 防止同一操作 ID 以不同负载重放。

## 2. 当前接口

| Operation ID | Method / Path | 当前行为 |
| --- | --- | --- |
| OP-PROJ-LIST | GET `/api/v1/projects` | 可选 `category_id/limit/cursor`；默认 24、最大 50；返回 `items,next_cursor,result_version` |
| OP-PROJ-GET | GET `/api/v1/projects/{project_id}` | 返回当前不可变 Version 的 public projection、`read_version` 和弱 ETag |
| OP-CREATOR-GET | GET `/api/v1/creators/{creator_id}` | 仅 canonical/public Creator；返回公开档案和已发布作品 ID |
| OP-EVENT-LIST | GET `/api/v1/projects/{project_id}/events` | 固定每页 30；可按冻结事件类型过滤并选择是否含被替代事件；签名游标绑定作品和过滤条件 |
| OP-ASSET-LIST | GET `/api/v1/projects/{project_id}/assets` | 固定每页 30；仅公开且未移除；签名游标绑定作品；原始目标不出列表响应 |
| OP-ASSET-RESOLVE | POST `/api/v1/assets/{asset_id}/resolve` | 同源写请求；`attempt_id` 幂等；HTTP(S) 逐跳 DNS/IP/重定向复检，mailto/tel 不发网；返回 allowed/uncertain/blocked 短期回执 |
| OP-SEARCH | POST `/api/v1/search` | raw query 创建或 owner/authorized `query_id` 重放；关键词 FTS、结构化过滤、稳定结果版本与主体绑定 token |
| OP-QUERY-GET | GET `/api/v1/query-snapshots/{query_id}` | 仅 owner/authorized；返回脱敏恢复投影；跨主体 403、失效/过期 410 |
| OP-QUERY-LINK | POST `/api/v1/query-snapshots/{query_id}/authorized-subjects` | 登录用户+CSRF+有效一次性 IdentityLink；owner/expires 不变 |
| OP-QUERY-UNLINK | DELETE `/api/v1/query-snapshots/{query_id}/authorized-subjects/me` | 登录用户+CSRF；重复撤销 204，撤销后该用户读取 403 |
| OP-QUERY-INVALIDATE | DELETE `/api/v1/query-snapshots/{query_id}` | owner/authorized；重复失效 204并完成密钥/密文擦除 |
| OP-COMP-GET | GET `/api/v1/comparisons/{comparison_id}` | owner-bound 当前版本；匿名主体由签名 Cookie 绑定并保留 7 天；下架项以墓碑返回 |
| OP-COMP-PUT | PUT `/api/v1/comparisons/{comparison_id}` | 首写 `comparison_version=0` 创建存储版本 1；0—5 项有序原子替换，同品类/同 Schema，重复列表不增版，第六项返回 409 |
| OP-COMP-SAVE | PUT `/api/v1/comparisons/{comparison_id}/saved` | 仅登录 owner + CSRF；设置最终保存状态，重复状态不重复写审计 |

公共响应允许短缓存；身份与错误响应仍为 `no-store`。查询参数未知、重复、超限或游标被修改时返回 canonical 400 错误。

## 3. 数据写入边界

本批没有提供绕过审核的 Project 写接口，也不把原型 Mock 自动 INSERT 为 published Project。生产数据库在没有正式 importer/发布审核事务时允许公共列表为空，这是安全状态，不以虚构种子数据填充。

正式冷启动数据必须通过后续受审计 importer 创建平台建档草稿，再由发布审核事务原子创建 Project、首个 Version、Event、Evidence 和 SearchDocument。本批迁移只预置版本化 Category Schema 配置。

为验证真实 PostgreSQL 查询，本批允许通过 `npm run catalog:fixture:load` 在 `development/test` 写入纯合成公开夹具。命令可安全重复执行；第二次返回 `deduplicated`，且会重新检查固定 Project/Version/SearchDocument 与关联对象。生产环境必须返回 `CATALOG_FIXTURE_PRODUCTION_FORBIDDEN`，不能把该命令改造成绕过审核的种子入口。

## 4. 验收覆盖

- Learning 与 Portfolio 快照分别按冻结字段集合校验；旧 Learning 根字段被拒绝；Portfolio P1 字段可校验但不进入 P0 公共投影；
- 游标签名、跨 category 重放、翻页快照和篡改失败；
- published 正常读取，restricted/deleted 分别 403/410；
- Event/Asset 跨作品游标重放、重复事件类型、非法精度日期与枚举漂移被拒绝；
- Event-Version、Event-supersedes、Evidence-target 与 Relation-Asset 的跨对象归属由数据库触发器约束；
- API 列表状态、Query 重复/未知/超限、Project/Creator ETag；
- OpenAPI Operation ID 唯一、引用无悬空；
- 目录/搜索迁移由 GitHub CI 在 PostgreSQL 18 + pgvector 上首跑和二次幂等后，才可标记数据库验收通过。
- CI 在迁移后连续加载两次合成夹具，并通过真实 `PostgresCatalogStore + CatalogService` 验证列表、详情、证据、关系、事件、资产和 SearchDocument；仅 Mock Store 通过不能替代此门禁。
- Comparison PostgreSQL 门禁验证 owner 隔离、请求回放、版本冲突、同品类限制、顺序保留、下架墓碑、保存幂等和不可变历史；四个不同维度累计可见 30 秒且当前有效作品为 2—5 个时，只为该 `comparison_id + comparison_version` 完成一次并写 `comparison_completed` Outbox。

## 5. 未完成范围

下列仍属于 WP-03，当前不得标记完成：

- Evidence/Relation 当前按冻结契约嵌入 Project/Event/Asset 公共投影，不新增未定义的独立公共路由；
- AdminProjectCreationDraft 的受审计 importer 已完成；Submission/ReviewWorkItem 发布链及 64 个经审核正式档案仍未完成，当前 3 个合成 fixture 不能替代；
- P01—P08 从 Mock 向真实 API 的分页面迁移及 route-level lazy loading；
- 意图解析适配器、语义匹配、同类分析与搜索导航归因仍未完成；结构化 keyword/FTS 降级已完成且明确 `semantic_degraded=true`，不冒充语义结果；
- P09 Comparison 核心和完成口径已落地；登录后的匿名 Comparison 候选合并/逐项冲突处理仍待 `OP-AUTH-MERGE-GET/RESOLVE/CANCEL` 批次实现；
- 搜索评估集、语义供应商和前端包体预算仍受 TBC-003/TBC-007/TBC-011 控制。

## 6. 下一批顺序

1. 与 WorkBuddy 的 P01/P08/P14 真实 API 接入做契约联调，再实现 P05—P07 查询上下文；
2. 接续 P09 登录合并分支并把 `OP-ANALYTICS-INGEST` 可信维度可见事件接到 Comparison 内部进度服务；
3. 进入 WP-04 Submission/ReviewWorkItem 发布审核链，不允许目录 importer 绕过审核直接发布。

## 7. 受审计目录 importer（WP-03 增量）

- `admin_project_import.v1` 是内部 JSON 输入契约；批次含 1—500 项，每项必须有稳定 `source_record_key`，每项独立事务、校验和回执。
- 入口 `npm run catalog:admin:import` 只读取 `CATALOG_IMPORT_FILE` 指定的本地 JSON，调用者由 `CATALOG_IMPORT_ACTOR_USER_ID` 指定，数据库实时校验 active editor/admin；无角色、受限或禁用账户在创建批次前拒绝。
- 导入器只创建 `workflow.admin_project_creation_drafts(status=editing)`，不会创建 Project、Version、Submission、WorkItem、Evidence 或公开搜索文档。提交、审核和最终事实晋级仍属于 WP-04。
- URL 只做确定性 HTTP(S) 规范化和重复候选哈希，不执行网络抓取，也不把该结果冒充 URL 安全/可访问性检查；SSRF、重定向和访问检查仍由后续安全执行器完成。
- `(import_source,source_record_key)` 是跨批次幂等范围；同键同载荷返回既有草稿，不复制审计事实；同键异载荷产生 `IMPORT_ITEM_KEY_CONFLICT` 拒绝回执，不覆盖草稿。
- 每个新草稿和每个拒绝项写不可删除审计；导入回执不可更新/删除。批次重复调用必须使用相同输入摘要、actor 和 item_count，否则返回 `IMPORT_BATCH_KEY_CONFLICT`。
- migration `000007_admin_project_import.sql` 和 PostgreSQL fixture 验证双品类、重复候选、同批/跨批重放、Schema 错配、无权限、不可变回执/审计，并断言导入前后公开 Project 数量不变。

## 8. 结构化 keyword 与 FTS 降级（WP-03 增量）

- `search.keyword.v1` 保持冻结 ranking version：规范 URL/名称精确或前缀命中优先，其次结构化匹配字段数、PostgreSQL `ts_rank_cd`、相似度、公开 Evidence 数、`last_verified_at` 与稳定 `project_id`。
- 同字段多值使用 OR，不同字段使用 AND，`exclude_category_fields` 使用 NOT；公共状态、可用资产和最近核验窗口在候选召回前应用。硬过滤字段严格采用 PRD 24.3：Learning 四项、Portfolio 五项；视觉风格、响应式等仍是软匹配理由，不接受伪装成硬过滤。
- migration `000008_search_structured_fts.sql` 校正双 Category Schema 的 `search_field_map` 漂移，增加 `structured_json` GIN、公共过滤组合索引，并阻止 SearchDocument 的 Project/Version/Category/Schema 交叉归属。
- PostgreSQL fixture 分别验证 Learning FTS、Portfolio 同字段 OR/跨字段 AND/排除 NOT、版本化配置、FTS/结构化索引和交叉归属拒绝；响应继续返回 `semantic_degraded=true`，本批不实现向量召回或自然语言意图解析。

## 9. Asset 外链安全解析（WP-03 增量）

- `OP-ASSET-RESOLVE` 采用“先取数据库内目标、再解析”的边界，客户端不能提交任意 URL；每次回放前重查当前可见性/下架状态，目标哈希也进入请求摘要；`attempt_id` 同一主体同一目标可重放，同 ID 跨主体、异载荷或目标已变更返回 409。
- `safe_web_url` 只允许无凭据、无异常端口的 HTTP(S)。每次请求与每次重定向都重新解析 DNS；只要答案集合含 loopback、private、link-local、reserved、文档地址或 IPv4-mapped private IPv6，就在发出该跳请求前返回 blocked。
- HTTP 探测固定连接到已检查 IP，同时保留原 Host/TLS server name，避免 DNS 检查与连接间重绑定；先 HEAD，405/501 时才使用 `Range: bytes=0-0` 的 GET；最多五次重定向。
- DNS、探测超时和上游 5xx 只产生 uncertain，不能降级成 allowed；前端必须显式提示确认。blocked 响应不携带可继续访问的 URL。
- `contact_uri` 只接受 mailto/tel，完成 NFKC、长度、换行和格式校验，永不进入 DNS/HTTP。若一项资产同时存在 Web 与联系目标，请求必须显式给 `target_kind`；这是避免歧义的技术契约补充。
- 每次新解析写入不可更新/删除的 `workflow.asset_resolution_receipts` 与脱敏 `audit.security_events`；审计仅记录目标域哈希，不记录原始 URL/contact。回执 allowed/blocked 有效五分钟，uncertain 有效一分钟；过期 attempt 返回 410，客户端使用新 attempt 重新检查。
- 每主体默认每分钟 30 个新 attempt；已有有效回执在计数前返回。迁移 `000009_asset_resolution_security.sql` 落地不可变回执与限流桶。
- 单元测试覆盖协议、凭据、端口、私网/保留地址、混合 DNS、逐跳重定向、HEAD→GET、降级和联系 URI；PostgreSQL fixture 额外验证回执重放、跨主体冲突、危险地址零探测、审计脱敏和数据库不可变触发器。

## 10. P09 Comparison 核心（WP-03 增量）

- 比较栏存储允许 0—5 项，首写至少一项；真正开始和完成比较均要求当前有效公开作品为 2—5 项。首次 `PUT` 使用客户端预生成的稳定 `comparison_id` 和 `comparison_version=0`，服务端创建版本 1；这是冻结接口缺少独立 create Operation 后的技术澄清，不新增路由。
- 每次成员或顺序变化在单事务与 advisory lock 下校验期望版本、作品公开性、Category 和 Category Schema，然后追加不可变 Version/Item；完全相同顺序返回 `no_change`。旧版本、旧进度和完成时间保留，当前版本进度从零开始。
- `client_request_id + subject_hash` 保存不可变回执；同主体同请求同载荷返回原响应，异载荷返回 409。版本冲突返回当前版本和当前有序 Project ID，客户端不得静默覆盖或截断。
- 匿名主体保存 7 天且只存 HMAC；用户主体必须匹配真实 Session owner。保存状态使用最终状态语义，只有状态变化才写脱敏安全审计，保存本身不增加成员版本。
- Learning 原三组维度无法满足冻结的“四组”完成口径；迁移将 `learning.v1` 比较映射明确拆为 audience/problem/workflow/capabilities，Portfolio 保持 purpose/structure/visual/interaction，并在 Store 层拒绝少于四组的无效配置。
- 维度进度按 `comparison_id + comparison_version + dimension_group` 聚合，单事件限制 1—60 秒，`event_id` 与组内 `view_sequence` 双重幂等。当前尚不公开新的进度写路由；后续由冻结的 `OP-ANALYTICS-INGEST` 校验事件后调用可信内部方法。
- 当且仅当当前版本含 2—5 个有效公开作品、至少四个不同维度组各有可见记录且累计不少于 30,000ms，原子设置一次 `completed_at`，并在同事务写入 `comparison_completed` Outbox；不创建 DecisionRecord，不产生 `decision_submitted`。
- 作品后续 restricted/archived/deleted 或当前版本失效时，不改写历史 Item；GET 动态返回 invalid tombstone 和原因。当前数据模型尚无已合并作品的 canonical 映射，因此归并墓碑随后台合并能力一并补齐。
