# Knack 出厂自检探针（2026-07-21）

状态：**探针完成；跑前预声明保持冻结；探针，非验证性结论**。

本探针只回答一个机制下限问题：同一题自产、经 p1prom 官方 harness 验证且按 fidelity v2 修复保真度的 knack，能否帮助 GLM-5.2 再做该出生题。它不是 v0.2 预注册实验的一部分，不能与 v0.2 的 Django/SymPy 结果合并或替代其结论。

## 旧批次弯路盘点（零模型调用）

数据来源：`p1prom-20260718-zenmux` 三道 resolved run 的 `records.json`、run `events.jsonl` 与共享 memory 的 `ephemeral/lessons.jsonl`。ephemeral 按 `provenance.sessionRef` 归属；同一次 Hashline 失败会同时留下 `hashline_rejection` 和 `tool_error` 两条 lesson，表中保留条目原数并另注明因果事件数。

| instance_id | 旧 run | ephemeral 条目 | 阶梯触发 | 弯路分型与证据 | 选择 |
|---|---|---:|---|---|---|
| `astropy__astropy-6938` | `run_1784388318631` | 5（1 次 broad-glob block；2 次 Hashline 锚点失败，各双记为 rejection/tool_error） | **不可观测**：该旧 trace 没有 `failureEscalationEvents` 固定字段 | 题面直接给出 `fitsrec.py` 病灶代码；首次成功检索即命中 `astropy/io/fits/fitsrec.py`，根因没有定位弯路。其余是搜索/编辑器过程摩擦。 | **跳过**：根因一杆进洞，同题重放有天花板效应。 |
| `astropy__astropy-12907` | `run_1784388508942` | 1（bash import/build error） | **不可观测**：同上 | **环境型**：第 1 个工具调用已读取 `astropy/modeling/separable.py`，第 3 个调用完成 `_cstack` 修改；随后从源码检出导入 Astropy 失败。 | **阴性对照**。 |
| `astropy__astropy-14995` | `run_1784388855001` | 6（2 次 Hashline 锚点失败各双记，共 4；2 次 bash 环境失败） | **不可观测**：同上 | **定位/锚点型 ≥1，兼有环境型**：先在 `astropy/nddata/*.py` 检索未命中，再枚举子目录，至第 3 个工具调用才触达 `astropy/nddata/mixins/ndarithmetic.py`；其后两次 stale Hashline 重试。环境侧另有未 build 扩展和 NumPy 2.0 不兼容。 | **主探针**。 |

“不可观测”不按 0 计。新探针使用现行 trace 的 `failureEscalationEvents` 作为阶梯计数源。

## 固定条件

- 模型与采样：`glm-5.2`，profile `zhipu-glm-5.2`，thinking `enabled`，`temperature=0`，`top_p=0.95`（`do_sample=false`，不显式发送），`max_tokens=16384`。
- 每个 condition 使用独立空 memory root；每题每跑从 SWE-bench 原始 `base_commit` 建立全新干净 worktree。
- 两个 condition 都走同一个 context-runtime；差异只允许是记忆段为空或含下表唯一 knack。
- 不启用跨题学习，不读取主 memory；注入条件只把下表冻结的 v2 lesson/knack 复制到该 run 的临时 memory，并登记原 p1prom run `resolved=true`。源库不写回。
- 每个 patch 立即用官方 SWE-bench harness 判分。空 patch 记 `resolved=false`，仍保留记录，不重跑找补。
- 结果单独写入 `evals/results/diagnostic-knack-birth-probe-20260721/`；该目录不得被 v0.2 汇总器读取。

## 跑前预声明（禁止事后改写）

| 题 | 注入的唯一 knack | 预期改变的步骤 | 阴性/阳性判据 |
|---|---|---|---|
| `astropy__astropy-14995`（主探针） | `knack-astropy-astropy-cd70659d7b27`：`In v5.3, NDDataRef mask propagation fails when one of the operand does not have a mask` → 在 `_arithmetic_mask` 增加 `elif operand.mask is None: return deepcopy(self.mask)`。 | 注入跑应在**第 1 个定位轮次**直接触达 `astropy/nddata/mixins/ndarithmetic.py` 的 `_arithmetic_mask` `else` 分支；Hashline 重试预期为 **0**。 | 若注入跑 resolved，且相对 GLM 无注入基线减少定位轮数或 Hashline/阶梯触发，即为机制下限阳性信号；否则不阳性。 |
| `astropy__astropy-12907`（环境阴性对照） | `knack-astropy-astropy-d1783fe64a63`：nested `CompoundModel` 下 `_cstack` 错把 `right` block 全填为 `1` → 应复制实际矩阵 `right`。 | 两跑都应很快触达 `astropy/modeling/separable.py::_cstack`；注入不应消除“源码检出未 build 导致 Astropy import/test 失败”这一环境弯路。Hashline 重试预期均为 **0**。 | 若主要变化只出现在环境失败/重试，不能归因于 knack 的定位帮助；阴性对照不用于证明无效。 |

## 指标口径

- `resolved`：官方 harness 报告的布尔值。
- `阶梯触发数`：`trace.failureEscalationEvents.length`；同时按 level 列出。
- `定位轮数`：provider request audit 中，发出首个触达病灶文件的工具调用所对应的模型请求序号。若 provider audit 缺失，则退化为“首个病灶文件工具调用序号”并明确标记，禁止混写。
- `Hashline 重试数`：`trace.protectedEvents` 中 `source=hashline,type=stale_rejection` 的条数；用 tool error 复核但不双计。
- 等价标价：保留 trace token 用量；本地价格字段为 0 时，按运行时记录的 GLM-5.2 公开等价单价另算并标记“等价估算”，不冒充账单实扣。

## 零模型注入预检记录（仍在点火前）

2026-07-21 的注入快照预检发现：现行 SWE context-runtime 给 active task 分配内部 `task_*` ID，而 knack schema-v1 的 repository ranking 从这个 ID 推断仓库，因而把真实 `repo=astropy/astropy` 与当前仪器仓库误判为不匹配；同时 recall query 只含内部任务名，不含 issue 文本。两条目标 knack 均以 `knack_eligibility_failed` 被丢弃，若直接开跑会变成“名义注入、实际空召回”。

本探针测的是**已注入 knack 的机制下限**，不是 repository gate。因此跑前固定一个仅作用于临时 memory 的适配：冻结 fixture 保持完整，临时 runtime copy 只删除不会渲染进 prompt 的 `repo`、`symptom`、`fixSummary` 三个 schema-v1 排序字段；`id`、主 `summary`、准入 run、证据和其余字段不变。注入快照必须证明唯一出现预声明的 `[recall:<knack-id>]`，且其正文与 fidelity v2 主 lesson 逐字一致。这个适配不写回主库，也不用于 v0.2。

## 冻结输入证据

- p1prom 官方 harness 汇总 SHA-256：`a836249ed3629d5a8db76c06c5519048dfc9bb30e5a241c6384652f059b7eb41`。
- fidelity v2 supply report SHA-256：`11abcdff5cb246de283bf63876b329c3383d510ca770cd5a143f89c90dbfab64`。
- `12907` base commit：`d16bfe05a744909de4b27f5875fe0d4ed41ce607`；病灶文件 `astropy/modeling/separable.py`。
- `14995` base commit：`b16c7d12ccbc7b2d20364b89fb44285bcbfede54`；病灶文件 `astropy/nddata/mixins/ndarithmetic.py`。

## 探针结果

四跑均从表中 base commit 的全新干净 worktree 启动，48/48、18/18、45/45、22/22 个 provider 请求全部符合冻结采样；四个 prediction 均为非空 production-only patch，官方 harness 均判 `resolved=true`。完整 trace 留在独立的本地目录 `evals/results/diagnostic-knack-birth-probe-20260721/`，不进入 v0.2 结果目录；紧凑机器账见 `evals/distillation/knack-birth-self-check-probe-20260721.json`。

| 题 / 条件 | resolved | 阶梯触发 | 定位轮数 | Hashline 重试 | agent 轮次 | agent 时长 | 等价标价 |
|---|---:|---:|---:|---:|---:|---:|---:|
| `14995` / 无注入 | 1 | 5（L1×5） | 1 | 2 | 48 | 636.381s | ¥3.051908 |
| `14995` / 自产 knack | 1 | 2（L1×2） | 1 | 0 | 18 | 191.286s | ¥0.966872 |
| `12907` / 无注入 | 1 | 8（L1×6、L2×2） | 1 | 3 | 45 | 330.288s | ¥2.333512 |
| `12907` / 自产 knack | 1 | 5（L1×4、L2×1） | 2 | 3 | 22 | 180.415s | ¥0.760520 |

标价使用仓库现行 GLM-5.2 公开等价单价：未缓存输入 ¥8/M、缓存输入 ¥2/M、输出 ¥28/M。四跑合计 **¥7.112812**；按仅为汇报换算的固定 `¥7.20/USD` 约 **$0.9879**。实际走 Coding Plan 配额，不能把该等价值写成逐 run 实扣账单。

### 对照预声明

- **14995 主探针：命中预声明的机制下限阳性条件。** 两跑都 resolved，因此没有正确率提升空间；注入跑定位仍是第 1 轮，未优于基线，但 Hashline `2→0`、阶梯 `5→2`，轮次 `48→18`（-62.5%），时长 -69.9%，等价成本 -68.3%。预声明的“注入跑第 1 轮触达、Hashline=0”均实现。
- **12907 阴性对照：环境弯路保留，但 Hashline 预期未实现。** 注入跑仍遇到 Astropy 源码检出无法直接 import/build 的环境失败，说明 knack 没消除环境水土不服；Hashline 为 `3→3`，没有改善。定位轮数反而 `1→2`。不过轮次 `45→22`、阶梯 `8→5`、时长 -45.4%、等价成本 -67.4%，所以“总体效率下降”不能只解释为 14995 特有的定位帮助，更像同题答案记忆普遍压缩了搜索/验证链。
- **准确性结论是天花板，不是无效。** 两题基线已 2/2 resolved；本探针只能提供效率与弯路的方向信号，不能证明 knack 提升 resolved。
- **操纵成立，但 uptake 埋点不成立。** 两个注入快照都只含预声明的唯一 knack，B 快照为空；模型末条消息也写出了对应 citation。但当前 P3 按 message index 对齐 context，而每个 run 只有 1 条 context trace，末条 citation 被记为 `invalid`，故 `used_recall_ids=[]`。因此本报告只声称“提示词实际暴露 + 行为差异”，不把 `used_recall` 当作摄取证据。
- **端到端召回另有前置缺陷。** 不加临时适配时，两条 schema-v1 knack 会因 SWE active task 使用内部 `task_*` ID 而被 repository gate 误杀。本探针按跑前记录删除了临时 copy 的三个非渲染排序字段，测的是强制注入后的机制下限，不证明当前自然召回链可用。

结论：**14995 按预声明出现机制下限阳性信号，但仅是诊断性、非验证性结论。** 值得继续的不是再跑同题刷 resolved，而是检查既有实验是否也存在“判分打平、过程效率分离”，再修召回链并用有重复样本的迁移探针判断效果是否稳定。

## 后续分诊清单（2026-07-21 补记）

1. [x] **先回查 v0.2 各臂的轮次、时长、等价成本和阶梯，不只看 resolved。** [补审结果](./injection-effect-v0.2-efficiency-reaudit-2026-07-21.md)：Django 的 A-L 与 B 虽然 resolved `2:2`，但阶梯 `3:6`，已满足预注册“少至少 30%”的 H1 方向支持规则；额外效率指标整体为小幅、分题异质，不能写成稳定翻案。SymPy 尚未运行，v0.2 总结论未完成。
2. [ ] 修复 repository identity gate 与 P3 context/citation 对齐，使“实际召回”和“实际使用”都可由原生审计链验证。
3. [ ] 若另开后续实验，把轮次、agent/producer 时长、等价成本预注册为正式 outcome，并增加同题重复；不得回改 v0.2 冻结条款或用事后阈值包装现有单次轨迹。
