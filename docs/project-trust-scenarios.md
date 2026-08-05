# 作品详情可信状态场景索引

测试人员可直接打开下列固定 URL，无需修改代码或数据。T53 的必备子集已纳入 [统一原型场景与异常矩阵](./scenario-matrix.md)。

| 状态 | 固定入口 | 预期重点 |
| --- | --- | --- |
| 平台收录、作者未关联 | `/project/project-pdfquizlab?prototypeScenario=platform_included` | “平台收录”与“尚未关联验证作者”并列 |
| 未知＋过期 | `/project/project-learntrack?prototypeScenario=field_unknown` | 未知不等于失败；页面仍完整可看但降低可信提示 |
| 部分异常 | `/project/project-papertopractice` | 只标记部分流程异常，保留其他事实 |
| 链接不可用 | `/project/project-dailydrill?prototypeScenario=link_anomaly` | 当前链接异常，不推断结束原因 |
| 疑似迁移 | `/project/project-dictaflow` | 旧地址与待确认新地址并列 |
| 已暂停 | `/project/project-mocksprint` | 作者声明暂停，不标为失败 |
| 已结束 | `/project/project-echoscore` | 结束不等于失败，资产继续独立展示 |
| 首次异常 | `/project/project-quizforge?variant=first-anomaly` | 验证中并维持原公开状态 |
| 来源争议 | `/project/project-dictaflow?variant=disputed` | 两个来源、不同说法与更新时间并列 |

每个页面都提供“补充字段信息”“报告状态问题”和“展开本作品证据”入口。
