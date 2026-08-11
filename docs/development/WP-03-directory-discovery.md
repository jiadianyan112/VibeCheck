# WP-03：目录与发现

**状态：开发中（公共读取与非生产合成夹具已实现）｜日期：2026-08-11｜前置：WP-02 / PR #1**

## 1. 本批交付

本批建立目录域的生产数据边界，不把 `src/mocks` 或 localStorage 当作生产事实：

- 新增 `@vibecheck/catalog` workspace，承载 Project/Creator 公共投影、双 Category Schema 运行时校验、稳定游标和 PostgreSQL Store；
- 新增 `000004_catalog_public_read.sql`，落地 taxonomy、Project、Version、Creator、AuthorRelation、Event、Asset、Relation、Evidence、InteractionCounter 与 SearchDocument 首批结构；
- Project Version 使用 `ProjectCore + category_id + category_schema_version + category_data`，Learning 专属字段不得出现在 ProjectCore；
- ProjectVersion、CreatorProfileVersion、Event 使用 append-only 保护；Project 当前版本在事务提交时校验所属 Project 与 Category Schema；
- taxonomy 固定启用 `ai_learning_quiz / learning.v1` 与 `personal_site_portfolio / portfolio.v1`；配置内容哈希由数据库生成；
- 实现 `OP-PROJ-LIST`、`OP-PROJ-GET`、`OP-CREATOR-GET`、`OP-EVENT-LIST` 和 `OP-ASSET-LIST`；OpenAPI 当前为 10 条路径、11 个 Operation；
- Project Detail 内嵌仅公开、有效且未过期的 Evidence 摘要，以及已确认且两端作品均公开的 Project→Project Relation；不暴露内部记录引用、私有证据或审核人；
- Event 使用 `event_sort.v1` 将日/月/年/估算精度映射为持久 UTC 排序锚点；默认只读当前事件头，生命周期状态由 supersedes 关系派生；
- Asset 列表只返回可复用元数据和 `requires_resolve`，不返回 `safe_web_url/contact_uri` 原值；安全解析接口留到外链安全执行器完成后实现；
- 新增双品类确定性 SearchDocument 构建器，只索引公开快照中的冻结字段，不索引 URL 或私密资料；
- 新增 `catalog.synthetic.v1` development/test 合成夹具：3 个 Project、双 Category Schema、Creator/Event/Asset/Evidence/Relation/SearchDocument；固定 manifest hash、事务级 advisory lock、幂等审计和状态漂移检测；
- 合成夹具在 `production` 进入数据库连接前硬拒绝；它只用于本地联调与 CI，不是 64 个正式冷启动档案，也不得计入业务指标；
- 作品列表使用 HMAC 签名游标，绑定 category、snapshot_at、最后更新时间和稳定 ID；并发新增/更新不会进入既有翻页快照；
- 公共读取只返回 `published_platform/published_author`，`restricted/archived` 返回 403，`deleted` 返回 410；非 active AuthorRelation 不进入 Creator 公开投影；
- Render 通过 `CATALOG_ENABLED` 和独立 `CATALOG_CURSOR_SECRET` 启用目录域，不复用 OTP 或 Session 密钥。

## 2. 当前接口

| Operation ID | Method / Path | 当前行为 |
| --- | --- | --- |
| OP-PROJ-LIST | GET `/api/v1/projects` | 可选 `category_id/limit/cursor`；默认 24、最大 50；返回 `items,next_cursor,result_version` |
| OP-PROJ-GET | GET `/api/v1/projects/{project_id}` | 返回当前不可变 Version 的 public projection、`read_version` 和弱 ETag |
| OP-CREATOR-GET | GET `/api/v1/creators/{creator_id}` | 仅 canonical/public Creator；返回公开档案和已发布作品 ID |
| OP-EVENT-LIST | GET `/api/v1/projects/{project_id}/events` | 固定每页 30；可按冻结事件类型过滤并选择是否含被替代事件；签名游标绑定作品和过滤条件 |
| OP-ASSET-LIST | GET `/api/v1/projects/{project_id}/assets` | 固定每页 30；仅公开且未移除；签名游标绑定作品；原始目标不出列表响应 |

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
- 第四号迁移由 GitHub CI 在 PostgreSQL 18 + pgvector 上首跑和二次幂等后，才可标记数据库验收通过。
- CI 在迁移后连续加载两次合成夹具，并通过真实 `PostgresCatalogStore + CatalogService` 验证列表、详情、证据、关系、事件、资产和 SearchDocument；仅 Mock Store 通过不能替代此门禁。

## 5. 未完成范围

下列仍属于 WP-03，当前不得标记完成：

- Asset 外链 resolve 安全执行器与接口；Evidence/Relation 当前按冻结契约嵌入 Project/Event/Asset 公共投影，不新增未定义的独立公共路由；
- 生产受审计目录 importer、AdminProjectCreationDraft/Submission/ReviewWorkItem 发布链及 64 个经审核正式档案；当前 3 个合成 fixture 不能替代；
- P01—P08 从 Mock 向真实 API 的分页面迁移及 route-level lazy loading；
- 结构化过滤、PostgreSQL FTS、意图解析适配器、语义匹配降级和搜索导航归因；
- P09 服务端 Comparison、同品类 2—5 项约束、匿名合并与完成口径；
- 搜索评估集、语义供应商和前端包体预算仍受 TBC-003/TBC-007/TBC-011 控制。

## 6. 下一批顺序

1. 实现只写 AdminProjectCreationDraft 的受审计生产 importer，并等待发布审核链后才生成公开事实；
2. 基于已生成 SearchDocument 建结构化索引查询及 FTS 降级排序；
3. 交付 Asset resolve 的 SSRF/重定向/协议白名单安全执行器；
4. 与 WorkBuddy 的 P01/P08/P14 真实 API 接入做契约联调，再实现 P05—P07 查询上下文；
5. 最后实现 P09 Comparison，避免前端继续把 DecisionRecord 当作 P0 事实。
