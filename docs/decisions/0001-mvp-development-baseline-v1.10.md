# ADR-0001：VibeCheck 首期 MVP v1.10 开发基线

**状态：Accepted｜批准日期：2026-08-10｜分支：`codex/mvp-engineering-foundation`**

## 决定

产品负责人在当前任务中明确批准：

1. V19-01—V19-04 四项技术决定全部生效；
2. P0 使用邮箱一次性验证码登录/注册；
3. 部署方式由开发交付负责人选择最快可部署方案；本基线选择 Render Singapore Blueprint；
4. 搜索采用结构化/FTS 加可替换语义 adapter；P0 抓取仅安全 HTTP/HTML，不含 JS 渲染/自动截图；P0 仅站内通知；P19/P20 不进 P0；
5. 允许创建专用分支并启动 WP-00/WP-01。

## 生效文件

以下 SHA-256 对应 Git commit 中的 blob 原始字节，不受 Windows 工作区行尾转换影响。

| 文件 | SHA-256 | Git blob |
| --- | --- | --- |
| `docs/VibeCheck首期MVP开发级PRD-v1.10.md` | `3215dc1e4f13a6306c7de156ac888de6c0732c7cd23a0b036ba9ce6c6e5f6dac` | `5d7fe0715970cbe80d6e888675468d1087be1e32` |
| `docs/VibeCheck首期MVP数据库设计-v1.0.md` | `c85330457a3f57e5d2b752ea07d4b93bcd6a26b6be92eca48f2a7c9a12a2b4a2` | `bbf2810b1b466097d4dce94c7d535af51255ca2d` |
| `docs/VibeCheck首期MVP接口清单与契约-v1.0.md` | `4f4de13de253308cc1b77ab9fe9fab62d3ff011a8e2fb222003b664d6bed175f` | `7f1013cdde8a5541c6ea7f8c68d4bcfe5efe15f0` |
| `docs/VibeCheck首期MVP状态机技术规格-v1.0.md` | `ab94ef87756299c48397308df0b693a3efa18a4848d154fd6561ff3b23507e47` | `9fbaf9b7f07376e8d66b521d86ddbfc1f25e7ed0` |
| `docs/VibeCheck首期MVP后台管理规则-v1.0.md` | `b0c2a2d534eaba3dcdc198f1238f6caf010d4ea0ae387ab277a8149de0f245bb` | `10d9025f87949921022d5cd08502c0fa0f1bb6aa` |
| `docs/VibeCheck首期MVP技术实现方案-v1.0.md` | `4456e4c31d1f460b56002f7cf5cc37fa8d333aa988273a7e3cb7be702b9a24ba` | `4b9081ab2c0511d1a31753b6c321f71a36c49fad` |

## Git 绑定

| 项 | 值 |
| --- | --- |
| 产品/原型代码起点 | `3c1c4ef54f1a24368ef9d2f25bc52432556ad488` |
| WP-00 文档基线提交 | `cbe23cc83a30a659362dce6a23a5cae5c075744d` |
| 开发分支 | `codex/mvp-engineering-foundation` |
| 上位 PRD | `VibeCheck首期MVP开发级PRD-v1.10.md` |
| 被替代工作母版 | `VibeCheck首期MVP开发级PRD-v1.0.md`；保留历史但不作为唯一开发输入 |

## V19 闭环

| 问题 | 关闭证据 |
| --- | --- |
| V19-01 | PRD C-097、Version 第三 review_decision target、Recheck 原子事务与固定用例 |
| V19-02 | PRD C-098、`party_roles[]`、来源事实鉴权和重叠角色用例 |
| V19-03 | PRD C-099、`BatchEnvelope.v1`/`ClientAnalyticsInput.v1` 精确 Schema |
| V19-04 | PRD C-100、Analytics 版本资源、GET 只读和 POST 控制面 |
| V19-05 | 本 ADR 的版本文件、commit、SHA-256、批准范围和代码起点绑定 |

## 变更治理

- PRD v1.10 的冻结字段、状态、页面、权限或 P0 范围发生变化时，必须生成新 PRD 版本和新 ADR，不覆盖本记录。
- 仅实现细节变化时创建新的技术 ADR，并在不改变上位产品语义的前提下更新技术文档版本。
- 任何生产发布都记录使用的 PRD blob、OpenAPI hash、数据库 migration head、配置版本、镜像 digest 和代码 commit。
