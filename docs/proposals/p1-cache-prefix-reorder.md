# Proposal · 缓存前缀重排（P1-C / C-2）

- **日期**：2026-07-19
- **状态**：**作者已批 · C-2 落地中**（context-builder + assembly + session 段序）
- **背景**：ZenMux 07-18 日志写多读少（write 侧实质成本高于 read），`cache_control` 打在含动态段的 developer 消息上，每轮前缀变化 → 断点失效。

## 现状（问题）

当前注入顺序（逻辑上）大致为：

1. 记忆管线拼装（workingMemory / knacks / ledger / **diagnostics**）
2. Pi 基座 system（工具 schema、安全规则、skills…）

动态段（任务态、召回 knack、diagnostics）在 **cache 断点之前或之内** → 每轮 hash 变 → 网关只能写新缓存、命中率结构性偏低。

网关透视：单请求「缓存读取」百分比常在 40–70%，但 **写路径仍频繁**；与「静态前缀可复用」目标不符。

## 目标段序

```
[静态 · 可跨 turn 稳定]
  L0  安全边界 / 文件规则 / Hashline 契约
  L0  工具 schema 摘要（若本 run 工具集不变）
  L0  受控 skills 清单（evals/fixtures/skills，通常空）
  ── cache_control: ephemeral 断点（只打在这里）──
[动态 · 断点之后]
  L1  workingMemory / task ledger
  L1  knacks / lessons 召回
  L1  本 turn 指令增量
  （diagnostics 不进 prompt，只进 trace）
```

## 改动点清单（批准后实现）

| 文件 | 改动 |
|---|---|
| `src/extension/hooks/context-assembly.ts` | 已将 diagnostics 移出 prompt；需再拆「静态/动态」render 接口 |
| `src/memory/recall/context-builder.ts` | 段优先级/顺序：静态固定 priority 高于动态；暴露 `staticPrefix` / `dynamicSuffix` |
| `src/core/pi-bridge/session-factory.ts` | systemPrompt 组装时静态段在前，动态 memory 在后；与 Pi `cache_control` 锚点对齐 |
| `src/evals/agent-runner.ts` | 可选：记录 cache hit 率到 trace 便于验收 |

## 预期命中率（粗算）

假设：

- 静态前缀 ≈ 6–10k tokens/请求且 **跨 turn 字节级稳定**
- 动态后缀 ≈ 2–8k 每轮变化

则在 10–20 turn 的 run 上：

| 指标 | 现状（估） | 重排后（目标） |
|---|---|---|
| 请求级 cache read % | 40–70% 波动、写仍多 | 静态段 **≥80%** 跨 turn 复用 |
| cache write / read 成本比 | write 明显偏高（07-18 透视） | write 主要发生在 **第 1–2 turn** |
| 单 run 费用 | 见 07-18 ≈ $0.4/题量级 | 预期 **下降 15–30%**（视静态占比） |

*测算非承诺；以批准后 A/B 网关日志为准。*

## 风险

- 工具列表若中途变化，静态段仍会失效 → 工具集应在 run 内冻结。
- 召回 knack 变化属动态，不得塞进断点前。
- 与 Anthropic/Bedrock 经 ZenMux 的 cache 语义需再对拍一次 management/generation。

## 请作者批

- [x] 批准按上表改 context-builder / session-factory  
- [ ] 或要求先做单题 A/B（改前/改后各 1 run）再合入  

## C-2 落地修订（2026-07-19）

### 截断语义（不变量 3）

`applySectionBudgets` **按段独立**取 `sectionBudgets[name]` 截断，**不**按物理段序累计抢预算。  
因此重排只改变 prompt **物理位置**，不改变「谁先被截」的既有语义。

`applyLegacyBudget`（无 tier、仅 `maxTokenBudget`）仍按 `SECTION_ORDER` 累计；  
C-2 保持 `SECTION_ORDER = static… + dynamic…`，与重排前静态优先一致，**无语义回退**。

### 实现要点

| 点 | 做法 |
|---|---|
| 静态段 | `evalAutonomyRule` / `anthropicExecutionOverride` / `piContract*` / schema |
| 动态段 | `taskSpec` / `hardConstraints` / ledger / wm / knacks / … |
| 断点 | 渲染标记 `CACHE_PREFIX_BREAKPOINT`（非预算段） |
| system 拼装 | Pi base（tools/skills）在前，memory（static→break→dynamic）在后 |
| diagnostics | 仍只进 trace（B 已做） |
