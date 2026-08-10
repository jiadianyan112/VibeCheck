# WP-03：目录与发现

**状态：开发中（第一批目录公共读取已实现）｜日期：2026-08-11｜前置：WP-02 / PR #1**

## 1. 本批交付

本批建立目录域的生产数据边界，不把 `src/mocks` 或 localStorage 当作生产事实：

- 新增 `@vibecheck/catalog` workspace，承载 Project/Creator 公共投影、双 Category Schema 运行时校验、稳定游标和 PostgreSQL Store；
- 新增 `000004_catalog_public_read.sql`，落地 taxonomy、Project、Version、Creator、AuthorRelation、Event、Asset、Relation、Evidence、InteractionCounter 与 SearchDocument 首批结构；
- Project Version 使用 `ProjectCore + category_id + category_schema_version + category_data`，Learning 专属字段不得出现在 ProjectCore；
- ProjectVersion、CreatorProfileVersion、Event 使用 append-only 保护；Project 当前版本在事务提交时校验所属 Project 与 Category Schema；
- taxonomy 固定启用 `ai_learning_quiz / learning.v1` 与 `personal_site_portfolio / portfolio.v1`；配置内容哈希由数据库生成；
- 实现 `OP-PROJ-LIST`、`OP-PROJ-GET` 和 `OP-CREATOR-GET`；OpenAPI 当前为 8 条路径、9 个 Operation；
- 作品列表使用 HMAC 签名游标，绑定 category、snapshot_at、最后更新时间和稳定 ID；并发新增/更新不会进入既有翻页快照；
- 公共读取只返回 `published_platform/published_author`，`restricted/archived` 返回 403，`deleted` 返回 410；非 active AuthorRelation 不进入 Creator 公开投影；
- Render 通过 `CATALOG_ENABLED` 和独立 `CATALOG_CURSOR_SECRET` 启用目录域，不复用 OTP 或 Session 密钥。

## 2. 当前接口

| Operation ID | Method / Path | 当前行为 |
| --- | --- | --- |
| OP-PROJ-LIST | GET `/api/v1/projects` | 可选 `category_id/limit/cursor`；默认 24、最大 50；返回 `items,next_cursor,result_version` |
| OP-PROJ-GET | GET `/api/v1/projects/{project_id}` | 返回当前不可变 Version 的 public projection、`read_version` 和弱 ETag |
| OP-CREATOR-GET | GET `/api/v1/creators/{creator_id}` | 仅 canonical/public Creator；返回公开档案和已发布作品 ID |

公共响应允许短缓存；身份与错误响应仍为 `no-store`。查询参数未知、重复、超限或游标被修改时返回 canonical 400 错误。

## 3. 数据写入边界

本批没有提供绕过审核的 Project 写接口，也不把原型 Mock 自动 INSERT 为 published Project。生产数据库在没有正式 importer/发布审核事务时允许公共列表为空，这是安全状态，不以虚构种子数据填充。

正式冷启动数据必须通过后续受审计 importer 创建平台建档草稿，再由发布审核事务原子创建 Project、首个 Version、Event、Evidence 和 SearchDocument。本批迁移只预置版本化 Category Schema 配置。

## 4. 验收覆盖

- Learning 与 Portfolio 快照分别按冻结字段集合校验；旧 Learning 根字段被拒绝；Portfolio P1 字段可校验但不进入 P0 公共投影；
- 游标签名、跨 category 重放、翻页快照和篡改失败；
- published 正常读取，restricted/deleted 分别 403/410；
- API 列表状态、Query 重复/未知/超限、Project/Creator ETag；
- OpenAPI Operation ID 唯一、引用无悬空；
- 第四号迁移由 GitHub CI 在 PostgreSQL 18 + pgvector 上首跑和二次幂等后，才可标记数据库验收通过。

## 5. 未完成范围

下列仍属于 WP-03，当前不得标记完成：

- Event、Asset、Evidence、Relation 的完整公共读取接口和外链 resolve；
- 受审计目录 importer、双品类正式 fixture 与 SearchDocument 构建器；
- P01—P08 从 Mock 向真实 API 的分页面迁移及 route-level lazy loading；
- 结构化过滤、PostgreSQL FTS、意图解析适配器、语义匹配降级和搜索导航归因；
- P09 服务端 Comparison、同品类 2—5 项约束、匿名合并与完成口径；
- 搜索评估集、语义供应商和前端包体预算仍受 TBC-003/TBC-007/TBC-011 控制。

## 6. 下一批顺序

1. 为 Event/Asset/Evidence/Relation 增加公开投影与契约；
2. 实现受审计 importer 和不进入生产运行时的确定性测试 fixture；
3. 建 SearchDocument 结构化索引及 FTS 降级查询；
4. 先迁移 P01/P03/P04/P08 读取，再实现 P05—P07 查询上下文；
5. 最后实现 P09 Comparison，避免前端继续把 DecisionRecord 当作 P0 事实。
