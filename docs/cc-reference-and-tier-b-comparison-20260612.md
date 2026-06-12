# Claude Code 参照与 Tier B 完整对比（2026-06-12）

## 结论先行

目前没有足够证据形成“student-agent vs Claude Code + Sonnet 4.6”的受控
六题对比：

- 本地真实 Claude Code 历史产物只覆盖 12907、14182，模型是 off-label
  `gpt-5.5`，不是 Sonnet 4.6；官方 SWE-bench harness 最终为 2/2 resolved。
- 截至 2026-06-12，未在 SWE-bench 官方 experiments 仓库中找到命名为
  Claude Code 的可下载逐题提交产物。
- Epoch AI 的公开 Sonnet 4.6 结果可逐题核验，但原始 log 的
  `agent-type` 是 `bash` / `bash_agent`，不是 Claude Code。六题中有四题属于
  Verified 子集，这四题全部通过。
- student-agent 的 Tier B on/off 均为 4/6；在与 Epoch 相交的四题上均为
  3/4，唯一差题是 14365。

因此，本报告只作三层参照，不宣称“胜过/落后 Claude Code”：

1. student-agent OpenRouter Sonnet 4.6：受控自我 ablation。
2. 本地 Claude Code + gpt-5.5：历史内部参考。
3. Epoch bash scaffold + Sonnet 4.6：公开同模型外部参考。

## 证据口径

| 层级 | 系统 / 模型 | 数据集与覆盖 | 可作何种主张 |
|---|---|---|---|
| 自有受控 | student-agent / OpenRouter `anthropic/claude-sonnet-4.6` | SWE-bench Lite astropy 六题，on/off 各 1 seed | memory on/off ablation |
| 本地历史 | Claude Code 2.1.153 / `gpt-5.5` | Lite 12907、14182 | 内部行为与成本参考，不对外引用 |
| 公开外部 | Epoch `bash_agent` / Anthropic `claude-sonnet-4-6` | Verified 484 题；与本项目相交四题 | 同模型背景参照，不是 CC |
| 厂商总体 | Anthropic simple agentic scaffold / Sonnet 4.6 | SWE-bench Verified，总分 79.6% | 总体背景，无本项目逐题数据 |

Epoch 当前公开运行总分为 `75.2066%`，运行参数记录为 `bash_agent`、
`text_editor`、`apply_patch` 与 bash 工具。Anthropic system card 的
`79.6%` 也注明使用简单双工具 scaffold，而不是 Claude Code 产品。

## 六题逐题对照

student-agent 三元组为 `inputTokens / totalTokens / turns`。Epoch 的最后一列
是消息数，不等同于 turns；Claude Code 12907 的历史 runner 未保存
`num_turns`，只保存了 13 次 tool calls，故明确记为 `N/A`。

| 题目 | student off | student on | 本地 CC + gpt-5.5 | Epoch bash + Sonnet 4.6 |
|---|---|---|---|---|
| 6938 | ✓ `6,688 / 86,802 / 11` | ✓ `9,220 / 123,643 / 14` | 未跑 | 不在 Verified |
| 7746 | ✗ `30,048 / 275,149 / 20` | ✗ `32,092 / 365,366 / 24` | 未跑 | 不在 Verified |
| 12907 | ✓ `14,035 / 168,143 / 14` | ✓ `22,932 / 171,386 / 13` | ✓ `164,945 / 170,044 / N/A` | ✓ `20 / 49,033 / 22 msgs` |
| 14182 | ✓ `39,355 / 486,207 / 34` | ✓ `38,268 / 501,003 / 30` | ✓ `464,598 / 480,489 / 33` | ✓ `83 / 453,883 / 86 msgs` |
| 14365 | ✗ `21,736 / 165,651 / 12` | ✗ `16,094 / 186,456 / 12` | 未跑 | ✓ `29 / 52,681 / 31 msgs` |
| 14995 | ✓ `46,280 / 769,995 / 49` | ✓ `22,584 / 223,804 / 18` | 未跑 | ✓ `20 / 37,532 / 22 msgs` |

Epoch 的 `input_tokens` 不含 cache read/write，不能与 student-agent 或历史
CC 的 input 字段作横向效率比较。四题 Epoch 合计为：

- input `152`
- cache write `54,621`
- cache read `525,572`
- output `12,784`
- total `593,129`
- cache read 占 prompt input `90.56%`

## 聚合对照

| 口径 | resolved | inputTokens | totalTokens | turns / 消息 | cost |
|---|---:|---:|---:|---:|---:|
| student off，六题 | 4/6 | 158,142 | 1,951,947 | 140 turns | $1.9091 |
| student on，六题 | 4/6 | 141,190 | 1,571,658 | 111 turns | $1.8058 |
| student off，Epoch 四题交集 | 3/4 | 121,406 | 1,589,996 | 109 turns | $1.4574 |
| student on，Epoch 四题交集 | 3/4 | 99,878 | 1,082,649 | 73 turns | $1.2607 |
| Epoch bash，四题交集 | 4/4 | 152* | 593,129 | 161 msgs | 未提供 |
| 本地 CC，有效 patch 两题 | 2/2 | 629,543 | 650,533 | 12907 N/A；14182 33 | $4.0294 |

`*` Epoch input 另有 cache write/read，详见上一节。跨系统 token、turn 与成本
均不具备受控可比性：模型、provider、cache 记账、scaffold 和运行环境都不同。

本地 CC 的 14182 还经历过一次空 patch：`93,093 / 95,540 / 17`，
成本 `$0.52664`。第二次在达到 `$3` budget 后退出，但已经留下正确 patch，
该 patch 经官方 harness 判为 resolved。若按所有付费尝试计，本地 CC 两题总成本
为 `$4.556075`；若只计最终有效 patch 对应 run，则为 `$4.029435`。

## 14365 质量差距归因

14365 给出了本轮最具体、可行动的差距：

- student-agent on/off 都只把 `_line_type` 的正则编译改为
  `re.IGNORECASE`。
- agent 的隔离 regex 测试通过，但真实 Astropy 导入和 pytest 因本地依赖问题
  失败；模型随后错误地断言“一处修改已经足够”。
- SWE-bench 隐藏测试把整份 QDP 内容转为小写，其中数据缺失值 `NO` 也变成
  `no`。后续解析仍使用 `if v == "NO"`，所以 student patch 未覆盖完整数据流。
- Epoch 的正确 patch 除 `re.IGNORECASE` 外，还把该判断改为
  `if v.upper() == "NO"`，因此 fail-to-pass 与全部 pass-to-pass 测试均通过。

这不是 memory on/off 的差异，两臂生成了同一错误 patch。更准确的结论是：
当前 agent 在真实测试环境不可用时，替代验证只覆盖了入口 regex，没有沿数据流
穷举受大小写影响的全部 token 类型。

## 能说明什么

1. Tier B 已证明跨任务 recall 管道可运行，但没有证明质量收益：on/off 都是
   4/6，且 14365 失败完全一致。
2. student-agent 在相交四题上比公开同模型 bash scaffold 少解出 14365；
   这是一个真实的逐题差距，但不是受控 agent 排名。
3. 本地 CC 的 2/2 只能说明 Claude Code + gpt-5.5 解出了两个已覆盖题；
   它没有跑 6938、7746、14365、14995，不能外推为六题成绩。
4. 现有证据不支持任何“student-agent vs CC”的胜负结论。最诚实的说法是：
   CC 同配置数据缺失，公开同模型 scaffold 提供了一个 14365 的可复现改进样本。
5. 工程优先级应是修 recall 准入/排序污染，并让验证在主测试不可运行时仍沿完整
   数据流构造等价反例；在此之前不值得扩 Tier B seed 或 django 序列。

## 产物与来源

本地产物：

- student-agent Tier B：[tier-b-openrouter-sonnet-20260612.md](tier-b-openrouter-sonnet-20260612.md)
- Claude Code merged harness：
  `evals/results/root-json-archive/claude-code.full-main-cc-merged-20260611.json`
- Claude Code 12907 与首次 14182：
  `evals/results/comparison/full-main-2026-06-11T11-00/swe-claude-code-retry/records.json`
- Claude Code 14182 有效 patch：
  `evals/results/comparison/full-main-2026-06-11T11-00/swe-claude-code-14182-retry-v2/records.json`

公开来源：

- Anthropic Sonnet 4.6 system card：
  <https://www.anthropic.com/claude-sonnet-4-6-system-card>
- Epoch SWE-bench Verified：
  <https://epoch.ai/benchmarks/swe-bench-verified>
- Epoch 数据下载说明：
  <https://epoch.ai/benchmarks/use-this-data>
- Epoch Sonnet 4.6 原始 log viewer：
  <https://logs.epoch.ai/inspect-viewer/36231d6d/viewer.html?log_file=https%3A%2F%2Flogs.epoch.ai%2Finspect_ai_logs%2FKEdgiMmtJKHxgGiS82agYj.eval>
- SWE-bench 官方 experiments 仓库：
  <https://github.com/SWE-bench/experiments>
