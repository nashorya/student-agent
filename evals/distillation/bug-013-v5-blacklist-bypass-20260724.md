# BUG-013 · v5 变更元信息黑名单绕过取证

## 性质与边界

- 日期：2026-07-24
- 性质：既有第四型失真的复现修复；按 v4 stop rule ② 允许进入 v5。
- 成本：¥0；零模型调用、零 SWE-bench run、零 harness。
- 未改：φ_exec 阈值、门控、召回、prompt、采样、主库与冻结档案。

## 先取证：实际绕过原文

来源：
`sympy-v4-rematch-20260723T2140-cst-551ea0a8-direct/B/`
`F-SY-UNIT-EQUIVALENCE/2-sympy__sympy-24066/admission.json`。

v4 实际入档的 `fix_summary` 为：

```text
## Files Changed - `sympy/physics/units/unitsystem.py` (production file only)
```

其上游 provider 最终总结中的原始片段是：

```text
## Files Changed

- `sympy/physics/units/unitsystem.py` (production file only)
```

v4 黑名单先做空白折叠，但只接受开头的可选 `**`：

```text
/^(?:\*{0,2})?Files? changed\b/i
```

逐字比对后，绕过原因明确为：**Markdown `##` 标题标点未被 v4 模式覆盖**。
这不是大小写问题；空白折叠已经生效。`boundFixText` 又没有把
`Files Changed` 作为右边界，于是该标题连同文件 bullet 成为最后一个
code-bearing candidate；开头保留 `##` 后，字面正则无法从 `Files`
起始位置匹配。

| 环节 | v4 看到的值 | 结果 |
|---|---|---|
| 空白折叠后 | `## Files Changed - …` | `##` 保留 |
| v4 字面模式 | 起点只允许 `**Files changed` 或 `Files changed` | 漏过 |
| v5 规范化后 | `files changed sympy physics units unitsystem py production file only` | 命中 `^files? changed` |

## v5 修复

`isBlacklistedFix` 现先统一：

1. Unicode NFKC；
2. 小写化；
3. 非字母数字标点剥离为空格；
4. 空白归一。

再对规范化文本匹配 `files changed`、`N files changed`、
`insertions/deletions`、`diff --git` 等同型元信息。只有依赖 hunk
定界符形状的 `@@ … @@` 保留 raw-text 检查。没有新增阈值，也没有继续堆
`## Files Changed` 这一条专用字面正则。

## 回归与真实归档复核

- 新用例直接使用本次实际漏过原文；
- v4 原有四组用例继续覆盖 `Files changed:`、`N files changed`、
  `insertions/deletions`、`diff --git`、`@@ … @@`；
- 另有管线级用例确认 Markdown 标题候选被拒后，不再进入最终
  `fix_summary`。

用 v5 代码对该 B 题 2 的原始 `events.jsonl + records.finalOutput`
做只读离线复核，`fix_summary` 不再是 `Files Changed`，而改取总结中后一个
实际代码行为句：

```text
Otherwise, it applies the function to the dimensions, preserving existing behavior for functions like `Abs` that pass through dimensions.
```

该句不是本单新增的质量承诺；本单只确认已知第四型元信息被挡住。若下一次
真实轨迹又以同型变体绕过，按脆性登记转结构性方案评估，不再继续无限堆补丁。

验收：TypeScript build 通过；全量测试 `167 passed / 1 skipped` test
files、`1148 passed / 1 skipped` tests。没有模型调用、实验 run 或 harness。
