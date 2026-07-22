# 注入实验 v0.2：SymPy 族中期审计报告

> 性质：按冻结预注册生成的单族中期检查；方向性证据，非统计显著。未改变题目、采样、召回、蒸馏或判读规则。

## 完整性

- 正式族：`F-SY-UNIT-EQUIVALENCE`；四臂 12 个 run 全部完成。
- 12 个 run 均由官方 harness 判为 `resolved=true`。
- 每题初始 HEAD 均等于冻结 `base_commit`，工作树无跨题残留。
- 12 个 run 的仪器 commit 均为 `b79a90f8c4fe1b9dd7b65000c4b9f58f292285c9`，正式请求采样审计全部通过。
- 必需的 trace、events、injection、prediction、harness、admission/distillation 和 memory inventory 均齐全。
- 四臂第 2、3 题没有全灭，替补族不触发。

## 冻结主分析（只看第 2、3 题）

| 臂 | resolved | 轮次 | agent 时长 | 总 tokens | 阶梯触发 | 实际注入 |
|---|---:|---:|---:|---:|---:|---|
| A-L | 2/2 | 34 | 306.484s | 404,345 | 7 | 题 2：1 lesson；题 3：2 lessons |
| A-K | 2/2 | 50 | 568.316s | 868,900 | 11 | 题 2：空；题 3：2 knacks |
| B | 2/2 | 24 | 219.820s | 334,547 | 2 | 始终为空 |
| C | 2/2 | 41 | 289.861s | 644,525 | 9 | 题 2：空；题 3：4 resident lessons |

### H1：A-L vs B

不支持 H1，且过程指标方向相反：resolved 打平；A-L 阶梯不是比 B 少至少 30%，而是 `7 vs 2`。A-L 相比 B 轮次多 41.7%、agent 时长多 39.4%、总 tokens 多 20.9%。A-L 两个注入题均未产生 `used_recall` citation。

### H1-K：A-K vs B，以及 A-L vs A-K

A-K 相比 B 未见改善：resolved 打平，阶梯为 `11 vs 2`，轮次多 108.3%，时长多 158.5%，tokens 多 159.7%。A-K 第 2 题因 breaker 尚未晋升而空召回；第 3 题注入 2 条 knack，并合法引用其中 1 条，但效率仍劣于 B。

A-L 相比 A-K 明显更省过程成本，但不能据此证明 lesson 有益：两者 resolved 相同，A-L 轮次、时长、tokens 和阶梯都更低；然而 A-L 仍劣于无注入 B。

### H2：C vs A-L

按冻结中期脚本的总 token 口径，H2 的方向条件满足：两臂 resolved 打平，C 总 tokens 比 A-L 高 59.4%。C 轮次多 20.6%、阶梯多 28.6%，但 agent 时长少 5.4%，因此不能写成所有效率维度都更差。

C 的操纵并非三题都非空：题 1 无前序记忆；题 1 的确定性蒸馏为空，故题 2 合法空注入；题 2 resolved 后形成 4 条合格主 lesson，题 3 的 injection 快照确实包含全部 4 条 `[resident:lesson_*]`。

额外的 L3 prompt 估算显示，C 题 3 的 resident 段约 4,716 tokens，A-L 题 3 的 lesson 段约 2,704 tokens；但合计题 2、3 时，C 因题 2 空注入而约为 5,199，A-L 约为 5,644。这个诊断不改变冻结脚本使用总 tokens 的 H2 判读，只说明总成本差异不应全部归因于 resident 文本长度。

## 中期结论

SymPy 族的 resolved 指标完全饱和，无法区分四臂。过程指标没有为 lesson/knack 召回提供正向证据：B 在轮次、时长、tokens 和阶梯上总体最好；A-L 和 A-K 均更费过程成本。C 符合“resolved 不优于 A-L 且总 token 更高”的 H2 方向，但时长略低且只有第 3 题真正非空注入，证据应保持限定。

这与 Django 族的方向信号并不一致，因此 v0.2 最终结论应写成跨族异质，而不是“记忆必然有效”或“记忆完全无效”。
