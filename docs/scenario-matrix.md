# VibeCheck 统一原型场景与异常矩阵

本索引是 T53 后唯一的必备场景入口。开发服务器中，打开页面左下角“原型场景”面板即可一键切换；面板会先清空本地原型状态，再写入该场景所需的固定身份、草稿或比较选择。点击“重置场景与原型数据”可回到 `/projects` 和初始固定数据。

生产构建不渲染场景面板，但下表的 `prototypeScenario` 参数继续有效。相对地址均以 `http://127.0.0.1:4173` 为基准。

| 必备状态 | 场景 ID | 固定地址 | 一键准备 | 预期结果 |
| --- | --- | --- | --- | --- |
| 搜索不足 | `search_insufficient` | `/search?q=PDF&prototypeScenario=search_insufficient` | 无 | 只显示 2 个固定结果，查询和匹配理由保留 |
| 平台收录 | `platform_included` | `/project/project-pdfquizlab?prototypeScenario=platform_included` | 无 | “平台收录”与“尚未关联验证作者”并列 |
| 字段未知 | `field_unknown` | `/project/project-learntrack?prototypeScenario=field_unknown` | 无 | 未知、过期及其原因可见，不被补成失败 |
| 链接异常 | `link_anomaly` | `/project/project-dailydrill?prototypeScenario=link_anomaly` | 无 | 显示当前公开链接不可用，不推断作品结束 |
| 比较不足 | `comparison_insufficient` | `/compare/comparison-anonymous-pdf?prototypeScenario=comparison_insufficient` | 面板重置为 1 个作品 | 显示 `1/5`，正式比较区提示至少再选一个 |
| 发布重复 | `publication_duplicate` | `/submit?prototypeScenario=publication_duplicate&resumeUrl=https%3A%2F%2Fexample.test%2Fscenario-duplicate&autoCheck=1` | 面板登录米娅 | 自动完成检查并显示已有档案，不创建新作品或草稿 |
| 自动提取失败 | `extraction_partial` | `/submit/new?draft=draft-scenario-extraction-partial&step=prefill&prototypeScenario=extraction_partial` | 面板登录米娅并建立隔离草稿 | 已提取字段保留；缺失字段显示原始提取缺失并可手填 |
| 身份审核中 | `identity_pending` | `/project/project-pdfquizlab/verify-author?prototypeScenario=identity_pending` | 面板登录米娅 | 显示等待人工审核，不显示虚构倒计时 |
| 登录回跳 | `login_return` | `/auth?from=%2Fsearch%3Fq%3DPDF%26status%3Dnormal&prototypeScenario=login_return` | 无 | 登录后返回 `/search?q=PDF&status=normal`，完整参数保留 |
| 服务错误 | `service_error` | `/search?q=PDF&prototypeScenario=service_error` | 无 | 显示稳定错误码和原位重试；离开该 URL 后恢复默认服务 |
| 外链风险 | `external_link_risk` | `/submit?prototypeScenario=external_link_risk&resumeUrl=https%3A%2F%2Funsafe.example%2Fscenario&autoCheck=1` | 面板登录米娅 | 自动完成检查，阻止继续且不创建草稿 |

## 隔离规则

- 面板每次切换都执行本地存储清理和状态重置，场景之间不继承草稿、身份、比较选择或事件日志。
- 场景只由当前 URL 的 `prototypeScenario` 驱动；旧的 `scenario` 参数仅作为历史回归别名保留。
- 自动提取使用固定草稿 `draft-scenario-extraction-partial`；重复发布和外链风险只执行检查，不写入草稿。
- 面板仅在 `import.meta.env.DEV` 为真时挂载；`npm run build` 的页面不会出现面板。

## 历史服务场景

网络中断、超时、审核结果和权限失效等更细的服务回归仍可使用 `scenario` 参数。完整别名见 [testing-scenarios.md](./testing-scenarios.md)，但 T53 的 11 个验收场景统一使用上表的 `prototypeScenario`。
