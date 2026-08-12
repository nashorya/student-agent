# Plan · pi 后继包迁移

## 背景

当前稳定线精确锁定 `@mariozechner/pi-*` 0.73.1，以恢复干净检出的可安装性。
这些包已经弃用，且 `pi-coding-agent` 0.73.1 存在 high security advisory。

2026-07-13 的隔离试验表明，官方后继 `@earendil-works/pi-*` 0.80.6 不是包名迁移：

- Node 最低版本从 20 提高到 22.19；
- `getModel`、`getModels`、`getProviders`、`completeSimple` 已不再导出；
- 当前模型解析、首次配置、意图分类和 Context7 retry 路径均需适配新 API。

另一个迁移动机来自 provider capability 映射：pi 0.73.1 不会为通用 OpenAI-compatible
端点稳定地产生 Z.AI GLM-5 所需的 `thinking: { type: "enabled" }` 请求字段。当前 eval
runner 因此在最终 fetch 出口执行临时注入、`temperature: 0` / `do_sample: false`
确定性锁定和落地字节审计；迁移到 0.80.6
时应重新验证模型解析与 provider 参数映射，能由新版本原生保证后再删除该补丁。

`@oh-my-pi/pi-*` 需要 Bun，且既有路线图明确只采用它的独立 `hashline` 包，
不引入其 agent runtime、TUI 或 provider routing。Codex fork 会替换整个代理基座，
不属于依赖升级。

## 决策

1. Phase 0：Node ≥22.19 与 `@earendil-works/pi-*` 0.84.1（compat shim）；旧 TUI 已删。
2. 不迁移到 Codex 或 oh-my-pi runtime。
3. 建立独立批次迁移到 `@earendil-works/pi`，不与 ADR-003 P2 产品实验混改。
4. **总纲见 [ADR-009](adr/ADR-009-pi-successor-and-student-tui.md)**：施工目标 `@earendil-works/pi-*` **0.84.1**、Node **≥22.19**；compat 优先；**不对 tui-v2 做 API 修补**，旧 TUI 在 Phase 1 整目录删除后由新 shell 取代。

## 迁移步骤

> 2026-08-12：Phase 0 代码已合入工作树（未要求 commit）——0.84.1、`pi-compat`、旧 TUI 删除、readline 临时 REPL；`tsc` / Vitest / `eval:validate` 已绿。待办：faux-provider smoke、GLM thinking 真实请求复验、合并前再确认 audit 无旧 pi advisory。

1. ~~建立 pi compatibility adapter~~ → `src/core/pi-compat`
2. ~~单测锁定~~ → Vitest 全绿
3. ~~Node 22.19 + README~~
4. ~~替换 `@earendil-works/pi-*` 0.84.1 + session `modelRuntime`~~
5. ~~TypeScript / Vitest / `eval:validate`~~
6. 零付费 faux-provider smoke + 受控真实 provider / GLM thinking 复验（待）
7. 合并前 `npm audit` 确认无旧 `@mariozechner/pi-coding-agent` advisory（当前剩余为传递依赖 brace-expansion / undici，非旧 pi 包）

## 验收

- 干净检出只需 `npm ci`，没有本地 `pi-mono`；
- 全量测试与 deterministic eval 通过；
- 模型选择、工具调用和 usage trace 无回归；
- 不新增 Bun runtime；
- audit 不再包含旧 pi 0.73.1 advisory。
