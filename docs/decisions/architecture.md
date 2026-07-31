# 前端架构决策

## 目标

让页面、领域能力、模拟数据、异步服务和跨页面状态保持单一职责，并为 T00—T57 的逐任务开发提供稳定边界。

## 目录职责

- `src/app`：应用入口、路由和全局 Provider 组合。
- `src/components`：不包含作品业务字段的通用 UI 组件。
- `src/features`：按比较、发布、身份验证、评论等业务能力组织。
- `src/pages`：路由级页面组合，只读取参数和组合能力。
- `src/mocks`：固定 ID、固定日期的模拟数据与场景定义。
- `src/services`：统一异步模拟接口与类型化错误。
- `src/state`：会话级和持久化状态、动作与选择器。
- `src/types`：跨功能使用的领域类型和枚举。
- `src/utils`：可测试、无 React 依赖的纯函数。
- `src/styles`：灰度低保真设计变量、全局样式和响应式规则。
- `src/tests`：测试渲染工具与共享夹具。
- `e2e`：Playwright 主流程和原型测试任务。

## 依赖方向

`pages` 可以组合 `features` 与 `components`；`features` 可以使用 `services`、`state`、`types`、`utils` 与通用组件；`services`、`state` 和 `mocks` 依赖领域类型，但不依赖页面。页面不得直接读取 `mocks`，模拟数据只能经 service 层进入页面。

目录通过显式 `index.ts` 公共出口暴露稳定 API。功能内部优先使用相对路径，禁止跨目录读取未导出的内部文件，以降低循环依赖风险。
