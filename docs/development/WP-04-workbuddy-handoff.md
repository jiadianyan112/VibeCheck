# WP-04 WorkBuddy 前端接入交接

**OpenAPI：`packages/contracts/openapi/v1.yaml`｜SHA-256：`7928370e7674f80638e5ca451e2a795dd55f8d71a492eb0e9dc481f0dcdb823f`｜日期：2026-08-20**

## 1. 可接入页面与接口

- P01/P02：`GET /api/v1/projects`、`GET /api/v1/taxonomies/{category_id}`。
- P03：`GET /api/v1/topics/{slug}`；0 个匹配作品仍返回 200 和 `project_count=0`。
- P04：`GET /api/v1/events`，支持 category/event type 和服务端签名游标。
- P05：`POST /api/v1/search` 当前只开放 `mode=search` 关键词生产基线。
- P05/P07→P08：先 `POST /api/v1/search-navigation-contexts`，再使用响应的相对 `navigation_url`；不得自行拼接 query/result/position 参数。
- P08：`GET /api/v1/projects/{project_id}`；导航 URL 带 `navigation_context_id` 时可能附加一次性的 `attribution_context`。
- P09：现有 Comparison GET/PUT/saved API；只允许同品类、最多 5 项，比较完成由可信 Analytics 维度事件驱动。

## 2. 必须删除或停用的 Mock

- P01–P04 本地作品、分类、专题计数和动态列表。
- P05 浏览器内字符串结果列表，以及前端自报 `feed_item_clicked` 的 query/position/ranking 事实。
- P08 依据 URL 参数或 localStorage 自行恢复搜索来源的逻辑。
- 登录后的游客/账号比较合并弹窗、选择、替换、自动采用和对应状态模型。
- `DecisionForm`、DecisionRecord、`decision_submitted` 及任何 P09 显式决策提交。

P06/P07 的旧正则解析和浏览器内同类分析不得在 production Feature Flag 下启用。正式能力由第 8 步契约交付后再接入；当前应展示受控未开放态或仅保留设计验收入口，不能把 Mock 标成真实结果。

## 3. 登录与比较行为

- OTP 登录响应不再包含 `comparison_merge`；`identity_links[].purpose` 只有 `query_continuation` 或 `pending_action_replay`。
- 登录成功后重新读取账号 Comparison；不要读取游客集合、不要弹选择、不要发 merge 请求。
- 三个 `/api/v1/auth/comparison-merge-conflicts/**` 路由已退役并返回 404。
- 游客的保存比较续办会以 `account_comparison_preserved` 取消；前端提示“已保留账号中的比较”，不要重试或改写账号集合。

## 4. 搜索导航调用顺序

1. 从 Search ResultItem 读取 opaque `result_item_token`。
2. 以全新 UUID `click_request_id` 调用 navigation create；网络重试必须复用同一 ID 和同一 payload。
3. 使用响应的 `navigation_url` 跳转 P08，不复制 token 到 URL、Storage 或 Analytics。
4. P08 正常渲染 ProjectProjection；`attribution_context` 仅用于本次服务端已确认的页面上下文，不在客户端二次上报主体或检索事实。

主要错误处理：

| 错误码 | 前端动作 |
| --- | --- |
| `CLICK_REQUEST_REUSED` | 生成新 click request；不得改写旧请求 payload |
| `QUERY_FORBIDDEN` | 清理当前 query 恢复态并回 P05 |
| `SEARCH_RESULT_EXPIRED` / `SEARCH_RESULT_STALE` | 重新执行搜索，不复用旧 token |
| `SEARCH_RESULT_TOKEN_MISMATCH` | 视为客户端状态损坏，丢弃整页结果并刷新 |
| `PROJECT_NOT_PUBLIC` | 展示作品不可用，不从比较栏静默删除 tombstone |
| `SEARCH_NAVIGATION_EXPIRED` | P08 仍可显示公共详情，但不显示来源归因 |

## 5. 缓存与安全

- 目录和无导航参数详情可遵循响应 Cache-Control/ETag。
- 带 `navigation_context_id` 的详情是 `private, no-store`；不能进入 Service Worker、IndexedDB 或页面缓存。
- raw query 不进入 URL、local/session storage、普通日志、错误监控或 Analytics。
- result token、navigation context、metric subject 和 identity link 都不得展示、埋点或跨 Session 复用。

production Feature Flag 在 WorkBuddy 完成真实 API 接线、移除上述 Mock，并在 Staging 验证匿名/登录/过期/下架/重复点击后再开放。

后端验收基线：`3dfc15a`；GitHub Actions Run [#32362182369](https://github.com/jiadianyan112/VibeCheck/actions/runs/32362182369) 已通过。
