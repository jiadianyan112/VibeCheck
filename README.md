# VibeCheck 低保真原型

VibeCheck 是面向 Vibe Coding 创作者的作品发现、比较、发布与生命周期资产平台。本仓库是在既有 AI 学习与题库原型上扩展的多品类低保真 Web 原型：原品类完整保留，并新增公开可访问、由 AI 编程工具辅助开发的个人主页与作品集。

## 环境要求

- Node.js 22 或更高版本。
- npm 10 或更高版本。
- Chromium、Chrome、Edge 等现代浏览器。

## 安装与启动

```powershell
cd C:\path\to\vibecheck
npm ci
npm run dev -- --host 127.0.0.1 --port 4173
```

浏览器打开 <http://127.0.0.1:4173/>。Windows 也可双击根目录的 `打开VibeCheck原型.cmd`，脚本会复用或启动本地服务并打开默认浏览器。

不要直接双击 `index.html`。它是 Vite 源码入口，`file://` 无法加载 TypeScript/React 模块；直接打开时只会显示启动说明。

## 构建与预览

```powershell
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

`dist/` 是可重新生成且被 Git 忽略的构建产物。生产预览支持前台和后台深层路由刷新。

## 测试

首次运行 Playwright 前安装 Chromium：

```powershell
npx playwright install chromium
```

完整质量命令：

```powershell
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run build
```

- 单元／组件测试：60 个文件、273 项测试。
- Playwright：四条核心流程、U01–U06、响应式、固定场景、axe 和键盘回归。
- E2E 启动 preview 前会自动生产构建；失败时在 `test-results/` 保留截图和 trace，并生成 `playwright-report/`。
- 单独运行六个原型任务：`npx playwright test e2e/prototype-tasks.spec.ts --project=desktop-chromium`。

## 主要路由

| 区域 | 路由 | 用途 |
| --- | --- | --- |
| 浏览 | `/projects`、`/categories`、`/categories/:slug`、`/activity` | 广场、分类、专题与生命周期动态 |
| 发现 | `/search`、`/discover`、`/discover/result` | 搜作品、确认意图与同类分析 |
| 作品 | `/project/:id`、`/compare/:sessionId` | 可信档案、来源、资产、讨论与 2–5 项比较 |
| 发布 | `/submit`、`/submit/new` | 地址检查、查重、结构化发布与审核状态 |
| 作者 | `/project/:id/verify-author`、`/project/:id/update`、`/creator/:id` | 身份材料、作品更新与作者主页 |
| 账户 | `/auth`、`/me`、`/notifications` | 固定身份登录、个人资产与通知 |
| 说明 | `/about` | 收录规则、可信边界与排除范围 |
| 后台 | `/admin`、`/admin/projects`、`/admin/project/:id` | 看板、作品队列、字段、证据、历史与日志 |
| 后台工作流 | `/admin/duplicates`、`/admin/reviews`、`/admin/author-verification`、`/admin/status-monitor` | 合并、发布审核、身份审核与状态复核 |

完整页面映射见 `docs/requirements-map.md`。`/__sandbox` 是开发样式沙盒，不属于用户任务。

## 固定测试账号

原型不收集密码；在 `/auth` 或登录弹层直接选择身份。

| 身份 | 角色 | 适合验证 |
| --- | --- | --- |
| 米娅 | 普通用户 | 收藏、关注、比较、发布草稿、身份申请 |
| 周可 | 已验证作者 | 普通用户能力，以及“口语回声”的版本、地址、状态、资产与说明更新 |
| 平台编辑 | 编辑 | 后台浏览、字段维护、首次状态异常记录 |
| 原型管理员 | 管理员 | 合并、限制展示、最终状态复核和高权限审核 |

## 场景切换与模拟数据

开发模式下，页面左下角“原型场景”面板可一键重置本地状态并打开固定场景。场景覆盖搜索不足、平台收录、字段未知、链接异常、比较不足、发布重复、部分提取、身份审核中、登录回跳、服务错误和外链风险。

也可直接使用 `docs/scenario-matrix.md` 中的固定 URL。旧版服务场景和错误 code 见 `docs/testing-scenarios.md`。

- 业务数据全部来自 `src/mocks/`，使用固定 `projectId`、品类 Schema、事件、证据、资产和时间。个人主页与作品集使用 16 个代表性模拟档案（8 个策展子群各 2 个），64 仅是后续冷启动目标。
- 用户状态保存在浏览器 `localStorage` 的 `vibecheck-prototype-state-v1`。
- 列表滚动位置保存在当前标签页的 `sessionStorage`。
- “重置场景与原型数据”只清除上述原型状态，不访问远程服务。

## 已实现范围

- 作品广场、分类、动态、搜索、查同类、详情、比较、行动记录。
- 发布前地址检查、重复分流、四步结构化发布、审核状态和首次发布事件。
- 低频作者身份材料、已验证作者更新、详情时间线、动态和通知同步。
- 收藏、关注、匿名比较、登录续办、草稿和个人中心。
- 后台作品维护、证据核对、追加日志、发布／身份审核、重复合并和状态复核。
- 360、390、768 与桌面响应式；WCAG A/AA axe 核心审计与键盘主任务。
- 固定成功、空、未知、过期、争议、异常、权限和服务失败状态。

## 明确排除范围

不实现真实后端、生产数据库、真实认证、网页抓取、模型调用、真实状态监测、消息推送、支付、私信、粉丝等级、排行榜、复杂推荐、商业成功判断或品牌视觉定稿。跨品类只共享 ProjectCore 和通用入口，不伪造品类专属关系。所有请求、审核与异常均由前端固定数据模拟。

## 已知限制

- 数据只存在当前浏览器；清理站点数据或切换浏览器后不会同步。
- 示例外链使用 `example.test`，外链守卫用于验证风险提示，不保证目标可访问。
- 场景面板只在开发模式显示；生产构建仍支持场景 URL，但不显示开发面板。
- 后台以桌面操作为主，窄屏只保证提示、基本浏览与表格内部滚动。
- `/admin/evidence` 保留为信息占位；证据核对、状态标记和日志实际集中在 `/admin/project/:id`。
- 生产主脚本约 659 kB，Vite 会提示单包超过 500 kB；不影响本地低保真验收。
- `npm audit` 会报告 React Router 的不稳定 RSC Action 公告；本项目是纯客户端静态 SPA，不使用 RSC、SSR、loader 或 action。详见 `docs/acceptance/T56-quality-report.md`。

## 文档索引

- 产品运行上下文：`PRODUCT.md`
- 需求追踪：`docs/requirements-map.md`
- 固定场景：`docs/scenario-matrix.md`
- 逐任务报告：`docs/task-reports/T00.md` 至 `docs/task-reports/T57.md`
- 最终验收：`docs/acceptance/final-report.md`
- 只读产品源文件副本：`docs/source/`

原始设计文件与开发任务书位于根目录 `设计文件/`，按仓库规则不纳入 Git，也不得由原型实现修改。
