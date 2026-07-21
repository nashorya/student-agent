# Knack 出厂自检探针（2026-07-21）

状态：**跑前预声明已冻结；探针，非验证性结论**。

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

## 冻结输入证据

- p1prom 官方 harness 汇总 SHA-256：`a836249ed3629d5a8db76c06c5519048dfc9bb30e5a241c6384652f059b7eb41`。
- fidelity v2 supply report SHA-256：`11abcdff5cb246de283bf63876b329c3383d510ca770cd5a143f89c90dbfab64`。
- `12907` base commit：`d16bfe05a744909de4b27f5875fe0d4ed41ce607`；病灶文件 `astropy/modeling/separable.py`。
- `14995` base commit：`b16c7d12ccbc7b2d20364b89fb44285bcbfede54`；病灶文件 `astropy/nddata/mixins/ndarithmetic.py`。

