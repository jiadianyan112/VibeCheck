目标：P10 URL-check→create 与 P11 get→patch 接入真实 API（@vibecheck/contracts typed clients）；P12A 先完成 Submission Media/Evidence typed clients 与 submissionAssetsApi 生产前置。preview/submit、审核发布、ProjectUpdate 留后续。
顺序：基线 → submissionApi 网关（CSRF/Abort/错误保留） → P10 映射矩阵+创建（只认 can_create_draft，client_request_id 幂等，201 后保存导航） → P11 远端元数据+payload_snapshot 双向映射+get/patch/409/410/422 → 单测/反向验证 → 全门禁/提交/CI。
基线：2026-08-24，HEAD 78aefc6；contracts:check=85 paths/95 ops；相关 3 测试文件 21 passed；Playwright --list=72 tests/9 files；build:libraries 通过；@vibecheck/contracts 正式导入通过。
范围：仅任务书白名单文件；生产路径不回退 Mock；MEDIA_ENABLED=false，最后一步只显示草稿已保存文案，不发 preview/submit。
最大风险：真实 API/storageState/唯一测试 URL 缺失导致真实 E2E 无法执行（证据见 BLOCKED.md）；409 冲突分支的“服务端事实优先”取舍；payload_snapshot snake_case 映射遗漏。
取舍：服务端事实 > 数据安全 > 用户输入不丢 > 交付速度；409 不静默覆盖，410 停止编辑，401/403 保留输入。
验证：DTO/CSRF/Abort/映射矩阵/重复候选/同 ID 重试/201 导航/GET 刷新/PATCH 版本递增/409/410/422/无 Mock 回退单测；反向验证 blocked→passed 与陈旧 expected_version 两处，恢复后全绿。
状态：P10/P11 已完成；P12A 的 Media/Evidence typed clients、signed upload 与证据链网关已实现并完成本地门禁；P12B 的页面接入、preview/submit 调用与 pending_review receipt 已通过本地门禁。真实上传扫描、真实部署与真实 E2E 均未完成，不以客户端测试冒充真实验收。
P12A 验收边界：Media 仅在服务端 ready+clean+exif_removed=true 时允许 cover reference；Evidence 严格复用服务端返回版本并保留 409/422/transport/protocol/http 错误。真实 API 部署、storageState、唯一测试 URL、AWS signed-upload/扫描与部署 flag 仍见 BLOCKED.md，未验收。
上一阶段交付记录：P10/P11 的全门禁、clean clone、push 与 quality CI 已以 cf0972c593bdb6963a17db05590746ce5addb579（run 32807812891）完成。P12A 阶段只交付前置客户端与网关；P12B 的页面、preview/submit 与状态化同源流程见下方门禁记录，真实上传扫描和真实 E2E 仍未完成。

P12B Task 1C2B 门禁记录（2026-08-28，HEAD 6e393ff6aaa2b06cc1330f0c48ba7f78217da96c）：聚焦前端 Vitest 7 files / 87 tests passed；`npm test -w @vibecheck/contracts` 135 passed、0 failed（4 suites）；`npm run contracts:check` 通过（85 paths / 95 operations）；`npm run lint` 通过（0 errors、16 warnings，均为 `react-refresh/only-export-components`）；`npm run typecheck` 通过；`npm run build` 通过（Vite 188 modules transformed，HTML 1.46 kB、CSS 57.57 kB、JS 815.27 kB；仅有 chunk >500 kB 提示）。
本轮相关门禁通过后，canonical Learning snapshot、one cover + one URL evidence preparation、server preview/submit、`pending_review` receipt，以及 stateful same-origin submission golden-path integration 均可记录为本地门禁已完成；这表示客户端/契约与同源状态化测试证据成立，不等同真实部署验收。PostgreSQL fixture 未完成：本机无 `DATABASE_URL`，`npm run submission:submit:fixture:verify` exit 1，精确错误为 `Error: CONFIG_DATABASE_URL_REQUIRED`；不把该 fixture 标绿，CI 仍为权威。
