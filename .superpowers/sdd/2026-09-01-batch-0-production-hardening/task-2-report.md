# Task 2 Report — 紧凑比较摘要栏与 Drawer

## 范围与改动

- `src/features/comparison/ComparisonBar.tsx`
  - 固定比较栏只保留数量、`查看作品` 与 `开始比较`。
  - 将作品 chip、逐项移除与 `清空` 收入既有 `Drawer`；清空前仍需确认，取消后回到 Drawer。
  - 保持零项隐藏、一项禁用、二至五项开始比较可用，以及既有状态 action / 持久化 / API。
- `src/components/FrontstageLayout.tsx`
  - 仅在非 focused flow 且有选中作品时添加 `app-shell--has-compare-bar` 并渲染比较栏。
- `src/styles/global.css`
  - 固定摘要栏限制为 `min-height/max-height: 4rem`（64px），并为带栏 shell 预留 `5rem` 底部空间。
- 组件和端到端测试覆盖 Drawer 交互、壳层 class、三档宽度几何、Drawer 视口、横向溢出和页尾动作可达性。

## TDD 证据

### RED

先修改 `ComparisonBar.test.tsx` 与 `FrontstageLayout.test.tsx`，再执行：

```text
npx vitest run src/features/comparison/ComparisonBar.test.tsx src/components/FrontstageLayout.test.tsx
```

结果：9 个测试中 3 个失败；关键失败为找不到名称为“已选作品”的 dialog，以及 `.app-shell` 缺少 `app-shell--has-compare-bar`。失败原因是目标 Drawer/壳层预留行为尚未实现。

### GREEN

实现后重复执行同一命令：

```text
Test Files  2 passed (2)
Tests  9 passed (9)
```

## 验证命令与输出

```text
npm run build:web
✓ built in 2.76s
```

```text
$env:PLAYWRIGHT_SKIP_WEBSERVER='1'; npx playwright test e2e/responsive.spec.ts --project=desktop-chromium
5 passed (23.7s)
```

其中新增的 390/768/1440px 摘要栏几何检查通过：栏高不超过 64px，Drawer 位于视口内，页面无横向溢出，页尾“了解收录规则”可滚至摘要栏上方。

`npm run lint` 退出成功，报告 17 条既存的 `react-refresh/only-export-components` warning，Task 2 文件没有新增 lint error。

```text
npm test
```

按要求仅启动一次全量测试。该命令在执行通道的 30 秒输出窗口后继续运行，已观察到多组 Vitest 测试通过，之后进程结束；但通道未返回最终汇总或退出码。因此这项全量测试的最终状态未捕获，不能作为通过证据。

首次直接运行 Playwright 时，自动 `webServer` 的 foundation build 在共享环境内以 `failedTests: []` 结束而未提供测试失败项。随后使用本次成功的 `npm run build:web` 产物启动本地 preview，以 `PLAYWRIGHT_SKIP_WEBSERVER=1` 重跑相关 E2E，得到上面的完整 5/5 通过结果。

## 自审

- 保留了 `.compare-bar`、`当前比较栏`、`查看作品`、`清空`、`开始比较`。
- 未改状态 action、持久化逻辑、API，也未新增依赖。
- `app-shell--has-compare-bar` 只在非 focused flow 且 selection 非空时出现；focused flow 不渲染比较栏。
- 64px 约束和 5rem shell 预留均由 CSS 与 E2E 几何断言覆盖。
- `git diff --check` 未发现空白错误。
