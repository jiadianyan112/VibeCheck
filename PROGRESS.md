目标：交付 P10→P11 SubmissionDraft Typed HTTP Client，仅实现 create/get/patch。
顺序：基线门禁 → 核对 OpenAPI/现有模式 → 客户端与测试 → 文档/门禁 → 白名单提交。
基线：2026-08-24，HEAD 4445def；contracts:check=85 paths/95 operations，contracts=62 pass。
当前：SubmissionDraftClient、根导出与测试已完成；contracts=62 pass/0 fail/skip/todo。
最大风险：Draft 精确投影/错误映射、CSRF 与同源 URL 细节可能影响契约正确性。
取舍：遵守白名单与“契约正确 > 权限安全 > 覆盖完整 > 开发速度”，不新增依赖。
验证：contracts:check=85/95；npm test=60 文件/285 项；contracts test/typecheck、foundation test/typecheck、build、diff check 均通过。
质量：lint=0 error/16 warnings；已推送 4445def，GitHub Actions Run #32720210701 success；contracts/后端质量门已通过，真实前端 E2E 未开始；BLOCKED.md=无。
下一步：不将第 5 步或真实前端 E2E 标记完成；后续每轮在本地门禁通过后自动 commit、push 并监控 CI。
