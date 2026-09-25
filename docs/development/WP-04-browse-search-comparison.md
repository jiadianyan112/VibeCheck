# WP-04 浏览、搜索与比较真实链路

**状态：已完成｜日期：2026-08-20｜产品基线：PRD v1.10**

## 1. 交付范围

- P01–P03：双品类字典、九个冻结专题、专题别名解析和公开作品目录读取。
- P04：跨作品公开生命周期事件流，使用稳定游标和统一 `event_sort.v1` 排序。
- P05/P08：关键词检索结果点击由服务端签发一次性导航上下文；详情读取消费上下文并产生可核验的点击/浏览归因事实。
- P09：保留同品类 2–5 项比较、服务端完成口径和账号保存；登录后只读取账号活动比较，不采用、合并、替换或询问游客比较集合。
- 前端实现继续由 WorkBuddy 负责；本工作包未修改 `src/**`、`public/**` 或 `e2e/**`。

P06/P07 的生产自然语言解析、可降级语义召回、正式评估集和权重快照仍由既定第 8 步完成。本工作包不把浏览器正则或原型 Mock 标记为生产能力。

## 2. 数据库与契约

追加三个 migration，不修改历史迁移：

- `000038_discovery_taxonomy_and_public_feed.sql`：版本化 Category/Topic 字典、TopicAlias、FeaturedPlacement 控制面和公开事件流索引。
- `000039_search_navigation_attribution.sql`：owner-bound SearchNavigationContext、冻结检索位置/分组/排序事实、一次消费状态与主体桥接引用。
- `000040_retire_comparison_login_merge.sql`：取消未决比较合并冲突和关联的保存续办、撤销活动 merge link，并记录策略迁移审计。

OpenAPI 公开接口为 82 paths / 92 operations。旧 comparison merge GET/resolve/cancel Operation、相关 Schema 和登录响应字段已从公开契约删除；历史表和内部代码只为 append-only 兼容保留，不再有公开路由或登录调用方。

## 3. 搜索导航归因

`POST /api/v1/search-navigation-contexts` 只接受服务端签名的 result item token、P05/P07 来源页和 UUID click request。服务端重新校验：

1. QuerySnapshot 主体授权、状态和有效期；
2. 当前 intent 对应的最新 ResultVersion；
3. ResultItem、Project、组内位置、channel、group、ranking version 和 token binding hash；
4. Project 当前仍公开；
5. 同主体 click request 的 payload hash 幂等一致。

同一事务写 SearchNavigationContext、identity bridge、`feed_item_clicked/v2` Outbox。P08 通过 `navigation_context_id` 最多消费一次并写 `project_viewed/v2`；过期、跨主体、跨作品、重复消费或下架不会伪造浏览归因，也不会阻断无归因的公共详情读取。含导航参数的详情响应使用 `private, no-store`。

## 4. 登录后账号比较规则

- OTP 登录不再签发 `comparison_merge` IdentityLink，不执行 `prepareLoginMerge`，响应不包含 `comparison_merge`。
- 游客发起的 `save_comparison` PendingAction 登录回放固定取消为 `account_comparison_preserved`，不得修改账号活动比较。
- 三条历史 merge conflict API 返回标准 404；WorkBuddy 不得保留合并、选择或替换界面。
- 旧匿名比较记录不因登录被物理删除；认证会话的比较读写始终使用账号主体，避免数据丢失式迁移。

## 5. 关键修复与边界

- Topic 即使当前匹配作品数为 0 也必须返回；`project_count` 使用独立相关子查询，不能把 0 结果误判为 `TOPIC_NOT_FOUND`。
- 公开目录只返回 canonical、active 字典项；Topic alias 明确回显 `alias_resolved` 和链长。
- 匹配数量、结果数量和事件数量都不得生成竞争强弱、市场空白或商业成功结论。
- 冷启动频道权重、正式 FeaturedPlacement 运营内容和语义供应商仍属于已登记外部门禁。

## 6. 验证证据

- 本地：OpenAPI `contract_ok paths=82 operations=92`；Lint 0 error；全仓 TypeScript、foundation tests 和生产构建通过。
- PostgreSQL 18：40 个 append-only migration 新库/重复运行及全量目录、搜索、比较、身份、审核夹具通过。
- GitHub Actions：Run [#32362182369](https://github.com/jiadianyan112/VibeCheck/actions/runs/32362182369) 通过。
- 核心工程基线：`3dfc15a`；OpenAPI SHA-256 `7928370e7674f80638e5ca451e2a795dd55f8d71a492eb0e9dc481f0dcdb823f`。

## 7. 未进入本工作包

- P06/P07 生产意图解析、语义匹配、精确/相邻分析评估集和正式排序调参；见第 8 步。
- P01 正式运营权重和冷启动配额；保持待产品确认。
- 前端视觉、响应式、页面接线和浏览器 E2E；由 WorkBuddy 完成。
- Analytics 仓库消费、指标物化和全漏斗报表；见第 9 步。
