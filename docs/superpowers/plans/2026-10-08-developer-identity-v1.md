# 开发者／团队身份与作品管理 v1

本计划由用户于 2026-10-08 明确批准并要求实施。以正式版 92cdabb 为起点。

## 已批准规格

- 每个作品展示个人开发者或开发团队，团队由一个账号管理；新提交仅支持自己的作品。
- `publication_details.developer` 保存 `kind: individual | team`、`displayName`（1–80 字）、可选 `avatarUrl` 和 `websiteUrl`。自述不授予权限，历史快照保持可读。
- 未认证作品可发布；材料审核认证通过后才可以管理和提交作品更新。
- 详情身份行展示头像、名字与主体类型；16px 盾牌图标距名称 6px。认证为深绿色盾牌和对勾，未认证为灰色空心盾牌；悬停、聚焦、点击提供说明。
- 身份未知隐藏身份行，保留认领入口；争议沿用现有提示。本人管理按钮由服务端权限决定。
- 认证、私有材料扫描、后台领取／续租／预览／确认／决策和作品更新全部连接真实 API；禁止本地状态伪造发布结果。
- `GET /api/v1/me/projects` 提供分页作品、最新认证进度与 `can_manage`；开发主体主页读取真实 Creator 和作品接口。
- 作品有可空的主要主体关系引用；认证事务锁定作品并阻止第二负责人覆盖。颜色依据当前作品有效关系，不依据全局账号认证。
- 第一版不实现推荐者、作者署名、协作者、交接或官网自动验证。

## 任务与接口约定

- [x] Task 1: 后端主体资料、兼容迁移、逐作品认证与权限、公开 projection 和我的作品接口（主代理）。
- [x] Task 2: 发布保存／预览／校验、紧凑身份行及真实主页（developer_public_ui）。
- [x] Task 3: 认证申请、材料扫描、补充撤回及真实后台身份审核（developer_verification_ui）。
- [x] Task 4: 我的作品、真实作品更新草稿／预览／审核／应用（developer_management_ui）。
- [ ] Task 5: PostgreSQL 与浏览器完整链路、全量 CI、审查、推送发布及线上验证（主代理）。

公开 `developer` 对象为 `kind: individual | team | null`, `display_name`, `avatar_url`, `website_url`, `creator_id`, `verification_status: unverified | verified | disputed`。
前端 Project.developer 对象对应 camelCase。未关联主体的 creator_id=null，未知主体整体为 null。
我的作品接口为 `{ items: [{ project_id, current_name, developer, verification_id, verification_status, can_manage }], next_cursor }`，认证申请状态沿用现有 draft/pending/changes_requested/verified/failed/withdrawn。
认证 new_creator_profile_input 新增 kind、avatar_url、website_url。内部 OWNER_V1、author_role=owner 与已有审计能力保持一致。

## 全局验证与发布

Node >=24.14.1 <25。复用 React、现有样式与客户端请求约定。JS gzip <=251435 bytes，CSS gzip <=22528 bytes。
测试覆盖新版主体资料、第三方拒绝、旧记录兼容、认证并发、禁止自审、私有材料、跨账号隔离、权限暂停撤销、审核应用后公开、手机和键盘访问。
执行完整 quality CI；新增迁移同步 CI 中原先 47 份迁移的验收数量。
使用现有 Northflank 正式版发布路径；兼容数据库/API 先于前端，核对 Web/API 与 Worker 的部署提交和健康。
旧关系与既有权限不批量改写；仅唯一、有效 owner 的历史关系可补主要主体引用，多主体不自动挑选。

## 实施记录

迁移数量为 49。新认证申请显式保存新版边界标记，不能通过省略主体类型或使用旧 manager 请求绕过唯一负责人校验；已冻结的历史申请继续兼容。更新应用进程重新检查主要关系、负责人账号、认证来源和版本，权限变化后不会应用待处理更新。

本版作品更新支持版本说明、介绍和状态，均先审核再应用。地址更新尚缺客户端安全检查凭据流程，资产不在当前字段权限范围，暂不开放这两个入口；保留服务端既有 URL 安全校验和字段权限。

本地浏览器验收使用独立 `developer_e2e` PostgreSQL 数据库和真实 API、审核及应用服务。仅登录会话、域名探测与材料扫描结果使用测试边界资料。运行：生产构建后设置 `PLAYWRIGHT_SKIP_WEBSERVER=1`，执行 `npx playwright test e2e/developer-identity.spec.ts --project=desktop-chromium`。数据库只允许 localhost:55438 或 CI localhost:5432，拒绝其他地址和生产数据库。
