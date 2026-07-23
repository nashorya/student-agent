# SymPy v4 rematch · citation 分诊（2026-07-23）

> 档位：诊断性取证，零模型调用、零 run、零 harness。本报告不修复
> citation 仪器，也不使用 v0.2 旧 B 臂数据。

## 结论

**明确落格：② 模型未申报。**

两次正式 A-L run 的 lesson 与 `RECALL CITATION RULE` 均完整进入实际
prompt，且无截断、无 context compaction；但 citation audit 在清理标记前
看到的 assistant 消息中没有任何 citation。宽松搜索也未发现少方括号、空格
变体或全角方括号变体。故这不是 BUG-012 的“写了但采集失败”复发，也不是
规则段缺失/被压缩，而是模型通篇没有申报。

这只证明“未申报”，**不能反推模型没有受 lesson 影响**。后续归因必须继续把
“已注入 / 已申报 / 行为改变”三层分列。

## 取证范围与方法

- 正式批目录：
  `evals/results/injection-experiment-v0.2/sympy-v4-rematch-20260723T2140-cst-551ea0a8-direct/`
- run：A-L 题 2 `sympy__sympy-24066`、题 3 `sympy__sympy-24213`。
- 搜索对象：每个 run 的 `trace.json`、`records.json`、`events.jsonl`、
  `injection.txt` 及同目录其他归档文件。
- 搜索式同时覆盖精确 `[[used_recall:`、去方括号的 `used_recall`、
  方括号内空格，以及全角 `［［used_recall`。
- `providerRequestAudit` 只归档请求/响应状态与 token 元数据，不保存逐条
  provider response 正文；不过 citation audit 是 runner 在落盘前直接对
  `message_end` 收到的**未清理 assistant 消息数组**运行的，之后才把标记从
  `finalOutput` 清掉。因此 `recallAudit.cited_recall_ids=[]` 与
  `citation_events=[]` 是本批可用的原始消息级证据，不依赖对已清理
  `finalOutput` 的 grep。

## A1 · 正式 run 原文取证

| run | assistant 消息 | 响应中 citation 次数 | 引用 ID 原文 | 注入 allowlist | allowlist 内？ |
|---|---:|---:|---|---|---|
| A-L / 24066 | 19 条（0-based `0..18`） | 0 | 无 | `lesson_4e0ba2df-ed02-462d-92b5-4eb665d610c6` | 不适用 |
| A-L / 24213 | 11 条（0-based `0..10`） | 0 | 无 | `lesson_4e0ba2df-ed02-462d-92b5-4eb665d610c6`；`lesson_95fadbf0-9bad-4268-b52a-d2bf60c9c080`；`lesson_cc972d8b-0954-42a3-8892-b10005fbaabb` | 不适用 |

两题 `trace.json` 的原文均为：

```json
"cited_recall_ids": [],
"used_recall_ids": [],
"invalid_recall_ids": [],
"citation_events": []
```

全目录宽松 grep 的命中只来自 prompt 的两份重复快照
（`injection.txt` 与 `records.json.injectionSnapshot`），没有来自
assistant 输出、tool event 或独立响应正文的命中。

## 探针 14995 对照：路径差异

BUG-012 回放 fixture 保存了探针当时的明确原文：

```text
Applying the recalled fix. [[used_recall:knack-astropy-astropy-cd70659d7b27]]
```

其 citation 位于 assistant `message_index=17`（18 条消息中的末条），
上下文轨迹只有 1 条。旧实现把它判为 invalid；现实现沿用最近 allowlist 后，
fixture 回放得到：

```json
"used_recall_ids": ["knack-astropy-astropy-cd70659d7b27"],
"invalid_recall_ids": []
```

正式 SymPy 两题同样各只有 1 条 context assembly trace，消息数分别为
19/11；若任一后续消息写出合法标记，现有“最近 allowlist 向前沿用”路径应能
采集。两者的决定性差异是：**14995 fixture 的末条 assistant 消息确实包含
citation；正式 run 的所有 assistant 消息均未包含 citation。** 因此
BUG-012 的 ordinal 对齐修复没有在本批再次失效。

## A3 · 规则段、缓存断点与压缩

| run | citation rule 位置 | cache 位置 | 组装截断 | 总轮次 | compaction |
|---|---|---|---:|---:|---:|
| 24066 | `injection.txt:156-159`，L3 `lessons` | `cache_prefix_breakpoint` 在第 107 行；规则位于其后 | `truncated=[]` | 19 | 0 |
| 24213 | `injection.txt:167-170`，L3 `lessons` | `cache_prefix_breakpoint` 在第 107 行；规则位于其后 | `truncated=[]` | 11 | 0 |

规则原文完整在场：

```text
RECALL CITATION RULE:
- Recalled memory items below have stable IDs.
- Only when a recalled item materially informs a diagnosis, edit, or validation action, emit [[used_recall:<id>]] in that assistant message.
- Do not cite an item merely because it was shown.
```

两题的 `compactionEvents=[]`、`postCompactionPrompts={}`，故不存在多轮后被
压缩边界削去的证据。规则处于动态任务上下文（cache breakpoint 之后）且
L3 section 被完整渲染；本批不能归为 ③。

## 三分判定与后续

| 判定 | 本批证据 | 结果 |
|---|---|---|
| ① 埋点二次故障 | 没有 cited/invalid/event；宽松搜索无模型标记；14995 fixture 的显式标记可被现路径采集 | 否 |
| ② 模型未申报 | 19 + 11 条 assistant 消息均无 citation | **是** |
| ③ 规则未达 | 规则完整在 L3、无截断、0 次 compaction | 否 |

后续建议（本单不实施）：

1. 单独开 citation 申报可靠性修复/验收单；在修复前，不把
   `used_recall_ids=[]` 写成“模型未使用记忆”，只能写“模型未申报”。
2. 验收应使用正式 provider 的多轮消息级归档，同时覆盖“写出合法标记”
   与“不写标记”两条路径；fixture 只证明解析器下限，不证明模型会遵守规则。
3. 报告继续强制分列 injection allowlist、citation declaration 与行为差，
   避免把申报缺失混进记忆效果结论。

## 可复核锚点

- 24066：`trace.json:10,698,753,834-841,1058`；
  `injection.txt:107,156-160`。
- 24213：`trace.json:10,440,495,590-599,729`；
  `injection.txt:107,167-173`。
- 探针对照：`evals/fixtures/knack-birth-14995-citation-replay.json:17-19,49`；
  `src/memory/recall/__tests__/citation-14995-replay.test.ts:30-52`。
- 采集顺序：`src/evals/agent-runner.ts:231-249,780-825`；
  allowlist 前向沿用：`src/memory/recall/citation.ts:31-60`。
