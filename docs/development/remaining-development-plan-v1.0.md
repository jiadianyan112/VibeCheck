# VibeCheck 首期 MVP 剩余开发执行计划

**版本：v1.0｜执行状态：第 0–1 步已完成，第 2 步待开始｜记录日期：2026-08-20**

## 1. 执行基线

- 产品基线：`docs/VibeCheck首期MVP开发级PRD-v1.10.md`。
- 技术基线：`docs/VibeCheck首期MVP技术实现方案-v1.0.md`。
- 稳定代码基线：`5648e47`，正式完成至 WP-05B2a。
- 当前分支：`codex/wp-03-directory-discovery`。
- P0 范围：P01–P18、A01–A14；P19/P20 不进入首期 P0。
- P09 不建立 DecisionRecord，不产生 `decision_submitted`。
- 登录后只保留账号比较状态，不实现游客比较集合选择、替换或合并冲突流程。
- Codex 负责数据库、API、Worker、OpenAPI、权限、安全、基础设施与后端测试；WorkBuddy 负责 `src/**`、`public/**`、视觉、响应式和前端 E2E。未经协调不得跨边界修改。

## 2. 执行顺序

| 步骤 | 工作内容 | 完成门槛 | 状态 |
| --- | --- | --- | --- |
| 0 | 恢复安全开发基线：文件归属、范围漂移、稳定测试证据 | 无用户/WorkBuddy 文件误纳入；冻结范围一致；稳定基线可追溯 | 已完成 |
| 1 | WP-05B2b：S3 + GuardDuty 私密材料安全链 | 未扫描不可读；clean/malicious/unscannable/超时/重试通过；API/Worker/IaC/CI 完整 | 已完成 |
| 2 | 作者验证提交、审核、CreatorAccountLink、AuthorRelation | P12→A06→P08/P13/P14/P15 原子闭环及负向权限测试通过 | 待开始 |
| 3 | 作者归属争议 | 立案、撤案、裁决、关系暂停/恢复及隐私隔离通过 | 待开始 |
| 4 | P01–P09 浏览、搜索、比较真实链路 | 生产路径不读取 Mock；同品类比较及完成口径通过 | 待开始 |
| 5 | P10–P13 发布、审核、回流真实链路 | URL 安全、草稿、媒体/证据、审核、发布、更新 E2E 通过 | 待开始 |
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
