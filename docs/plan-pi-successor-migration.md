# Plan · pi 后继包迁移

## 背景

当前稳定线精确锁定 `@mariozechner/pi-*` 0.73.1，以恢复干净检出的可安装性。
这些包已经弃用，且 `pi-coding-agent` 0.73.1 存在 high security advisory。

2026-07-13 的隔离试验表明，官方后继 `@earendil-works/pi-*` 0.80.6 不是包名迁移：

- Node 最低版本从 20 提高到 22.19；
- `getModel`、`getModels`、`getProviders`、`completeSimple` 已不再导出；
- 当前模型解析、首次配置、意图分类和 Context7 retry 路径均需适配新 API。

`@oh-my-pi/pi-*` 需要 Bun，且既有路线图明确只采用它的独立 `hashline` 包，
不引入其 agent runtime、TUI 或 provider routing。Codex fork 会替换整个代理基座，
不属于依赖升级。

## 决策

1. 当前发布修复保持 Node 20+ 与 pi 0.73.1 精确 npm 版本。
2. 不迁移到 Codex 或 oh-my-pi runtime。
3. 建立独立批次迁移到 `@earendil-works/pi`，不与 ADR-003 P2 产品实验混改。

## 迁移步骤

1. 建立 pi compatibility adapter，集中封装 model registry 和 simple completion。
2. 用现有单测锁定 provider/model 选择、fallback、usage 和 tool schema 行为。
3. 将运行时基线提升到 Node 22.19，并更新 CI/README。
4. 替换为 `@earendil-works/pi-*` 精确版本，逐项适配移除的 API。
5. 运行 TypeScript build、全量 Vitest、Python runner、`eval:validate`。
6. 运行一条零付费 faux-provider smoke 和一条受控非交互真实 provider smoke。
7. `npm audit` 确认旧 `@mariozechner/pi-coding-agent` advisory 已消失后再合并。

## 验收

- 干净检出只需 `npm ci`，没有本地 `pi-mono`；
- 全量测试与 deterministic eval 通过；
- 模型选择、工具调用和 usage trace 无回归；
- 不新增 Bun runtime；
- audit 不再包含旧 pi 0.73.1 advisory。
