# WP-05B3 WorkBuddy 前端接入交接

**OpenAPI：`packages/contracts/openapi/v1.yaml`｜SHA-256：`b761a81364f87680fcd6ce749cc3acb4304c39c478da6791bc6c554350c84775`｜日期：2026-08-20**

## 1. 接入边界

WorkBuddy 只接入 P12、A06、P08、P13、P14、P15 的真实接口，不修改 migration、后端服务或 OpenAPI。production Feature Flag 在真实 AWS/Staging 验收前保持关闭。

## 2. 接口顺序

1. P12 使用 VerificationRequest create/get/patch/submit/supplements/withdraw；所有写操作发送 Session Cookie、CSRF、幂等/operation ID 和 expected version。
2. A06 先领取 verification WorkItem，后续审核请求携带 `X-Review-Claim-Token`；没有有效领取不得展示材料详情。
3. 读取材料时先签发 read grant，再导航到响应中的相对 `read_url`；该地址只能成功兑换一次，不得缓存或写入 Analytics。
4. A06 决定沿用 preview → confirm → decision；approve 的 `decision_payload` 必须匹配 OpenAPI 的 resolution 判别分支与冻结版本。
5. P15 使用本人 CreatorAccountLink LIST 和 AuthorRelation 查询；公共页面只能使用 Relation public projection，不得枚举账户 Link。

## 3. 必须移除的 Mock

- P12 本地直接把验证状态改为 pending/verified 的逻辑。
- A06 本地直接读取私密材料 URL、绕过领取状态或直接生成作者关系的逻辑。
- P08/P14/P15 中硬编码的作者 Link/Relation；P13 中只按 UI role 放行字段编辑的逻辑。
- 任何 storage key、原始材料 URL、claim token、grant token 或审核私密字段的持久化与埋点。

## 4. 主要错误映射

| 错误码 | 前端动作 |
| --- | --- |
| `VERIFICATION_METHOD_REQUIRED` / `VERIFICATION_SUMMARY_REQUIRED` | 定位必填字段，不丢草稿 |
| `VERIFICATION_MATERIAL_NOT_READY` | 保留选择并刷新材料扫描状态 |
| `VERIFICATION_LINK_POLICY_CHANGED` / `OWNER_LINK_SET_CHANGED` / `REUSED_LINK_CHANGED` | 停止提交，刷新申请与冻结策略 |
| `CONFLICT_OF_INTEREST` | 关闭审核操作并返回队列 |
| `WORK_ITEM_LEASE_EXPIRED` | 清除本地 claim，重新领取 |
| `MATERIAL_READ_GRANT_EXPIRED` / `MATERIAL_READ_GRANT_CONSUMED` | 丢弃 URL；有效领取下重新签发，不自动重复兑换 |
| `AUTHOR_RELATION_EXISTS` | 刷新公开详情和本人 Relation，禁止再次批准 |

## 5. 投影与权限要点

- Verification GET 是 `viewer_schema=applicant|reviewer` 判别联合；不要用一种投影猜测另一种字段。
- Material GET 是 applicant summary/reviewer projection 判别联合；公共页面没有此接口权限。
- Link 本人投影含 exact Profile ref、capabilities 与版本；Relation 本人投影含请求字段、有效字段和来源对象。
- P13 的真实权限只能以后端 AuthorAuthorization 结果为准；按钮可见性不是鉴权。
