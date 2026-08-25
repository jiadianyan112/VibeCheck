目标：P10 URL-check→create 与 P11 get→patch 接入真实 API（@vibecheck/contracts typed clients），仅 URL-check/create/get/patch 四操作；preview/submit、Media/Evidence、审核发布、ProjectUpdate 留后续。
顺序：基线 → submissionApi 网关（CSRF/Abort/错误保留） → P10 映射矩阵+创建（只认 can_create_draft，client_request_id 幂等，201 后保存导航） → P11 远端元数据+payload_snapshot 双向映射+get/patch/409/410/422 → 单测/反向验证 → 全门禁/提交/CI。
基线：2026-08-24，HEAD 78aefc6；contracts:check=85 paths/95 ops；相关 3 测试文件 21 passed；Playwright --list=72 tests/9 files；build:libraries 通过；@vibecheck/contracts 正式导入通过。
范围：仅任务书白名单文件；生产路径不回退 Mock；MEDIA_ENABLED=false，最后一步只显示草稿已保存文案，不发 preview/submit。
最大风险：真实 API/storageState/唯一测试 URL 缺失导致真实 E2E 无法执行（证据见 BLOCKED.md）；409 冲突分支的“服务端事实优先”取舍；payload_snapshot snake_case 映射遗漏。
取舍：服务端事实 > 数据安全 > 用户输入不丢 > 交付速度；409 不静默覆盖，410 停止编辑，401/403 保留输入。
验证：DTO/CSRF/Abort/映射矩阵/重复候选/同 ID 重试/201 导航/GET 刷新/PATCH 版本递增/409/410/422/无 Mock 回退单测；反向验证 blocked→passed 与陈旧 expected_version 两处，恢复后全绿。
状态：开工前任务 0 完成；真实 API E2E 前置条件缺失，已记 BLOCKED.md；任务 1/2 未开始（已纠正 WorkBuddy 状态）。
实现：任务 1/2/3/4 已完成代码与测试；全门禁、clean clone、push 完成；quality CI 已以 cf0972c593bdb6963a17db05590746ce5addb579 通过（run 32807812891）。
