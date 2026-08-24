目标：扩展现有 SubmissionDraftClient，新增 OP-DRAFT-PREVIEW 与 OP-SUBMIT，仅实现 preview/submit。
顺序：基线 → 核对 OpenAPI/现有 client → 实现与测试 → 反向验证 → 全门禁/提交/CI。
基线：2026-08-24，HEAD 781929f49b8672690100573682c76b29ec03738d；OpenAPI=85 paths/95 operations，contracts=62 pass。
范围：不实现 revision/withdraw/media/evidence，不接前端，不修改 OpenAPI、apps、src、public、e2e 或既有未跟踪文件。
最大风险：preview/submit 精确投影、哈希/版本幂等字段、409/410 错误与 CSRF 请求边界。
取舍：遵守“OpenAPI正确 > 幂等/版本安全 > 兼容既有客户端 > 速度”，不新增依赖；调整须记录。
验证/实现：diff quiet/staged quiet、rev-parse、contracts:check、contracts test/typecheck 通过；已导出 create/get/patch/preview/submit，contracts=110 pass/0 fail/skip/todo，覆盖请求、CSRF、signal、错误、网络和本地拒绝；基线 contracts=62。
反向验证：临时 `previewHash='a'.repeat(63)` 后 contracts=90 pass/20 fail；恢复 64 位后 contracts=110 pass/0 fail。
文档/边界：已更新五方法顺序、CSRF、409/410、pending_review/no Project；BLOCKED.md=无；真实前端 E2E 未开始。
全量门禁：`npm test`=60/285、foundation test/typecheck、lint=0/16、build、diff check 均通过；代码 commit `c5bd20ac8fe707079fa45738d02c662b5dffd762`、Run `32734441188`=success；文档 sync commit `0e081c919c2799185be612b429475478e8ce7b7f`、Run `32734853849`=success。
