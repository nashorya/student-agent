# P0 离线蒸馏化验 · 判卷表

- **日期**：2026-07-17
- **较真税档位**：内部一次性工具（最低档）
- **预算**：模型调用 0 次 / ¥0；仅读硬盘
- **萃取器**：`src/evals/knack-distillation.ts` @ `f78ed974`（schema v1）；入口 `scripts/distill-knacks.ts` @ `0934d40b`
- **工作树 HEAD**：`46713111`
- **命令**：
  ```bash
  npx tsx scripts/distill-knacks.ts \
    --results-dir evals/distillation/tier-b-on-assay-scope \
    --output evals/distillation/p0-assay-candidates.json
  ```
  （scope 目录为 on 臂 6 题 harness 元数据 + 共享 memory 的本地拷贝；原路径见下。符号链接不可用：`findNamedFiles` 不跟随 symlink。）

## 1. 样本定位（Tier B on 臂）

| 角色 | 路径 |
|---|---|
| 共享 memory / 轨迹 | `evals/results/swebench/openrouter-sonnet-tier-b-on-memory-20260612/` |
| 逐题 harness（metadata + harness-report） | `evals/results/swebench/openrouter-sonnet-tier-b-on-{6938,7746,12907,14182,14365,14995}-20260612/` |
| 协议与聚合 | `docs/tier-b-openrouter-sonnet-20260612.md` |

### 可用 run（6 条轨迹）

| runId | evidence_task | events.jsonl 行数 | harness resolved | 萃取器产出 |
|---|---|---:|---|---|
| `run_1781251630240` | `astropy__astropy-6938` | 17 | 是 | 1 条 |
| `run_1781252069033` | `astropy__astropy-7746` | 29 | 否 | 0 |
| `run_1781252404824` | `astropy__astropy-12907` | 13 | 是 | 1 条 |
| `run_1781252811464` | `astropy__astropy-14182` | 32 | 是 | 1 条 |
| `run_1781253829084` | `astropy__astropy-14365` | 12 | 否 | 0 |
| `run_1781254635607` | `astropy__astropy-14995` | 22 | 是 | 1 条 |

- **raw candidateCount（去重前）**：4
- **去重后 candidateCount**：4（`dedup_key` 互异，无碰撞）
- 产物：`evals/distillation/p0-assay-candidates.json`

## 2. 仪器 / 被试分离（随机 3 run）

- **抽样**：`random.sample(runs, 3)`，seed=`20260717`
- **判据**：肉眼在 `events.jsonl`（+ outcome/harness 是否 verified）中数「错误 → 验证过的消除」因果对；与同 run 萃取器产出对照。
- **验证信号说明**：本批 events 仅有 `tool_call` / `tool_error`，**流内无** `exitCode=0` / `reward=1`；`detectVerification` 在 events 上恒为未命中。resolved 题的 verification 来自 harness `resolved_ids` → `verifier reward=1`（`buildVerificationIndex`）。

| run | task | 肉眼因果对数 | 萃取器 | 对照结论 | 备注 |
|---|---|---:|---|---|---|
| `run_1781252404824` | 12907 | 1（任务级：修 bug + harness resolved） | 有 1 条 | **正常** | 唯一 `tool_error`(L4) 是 bash/环境 traceback，非任务根因；萃取器以首 error 为锚，symptom 从 `finalSummary` marker 救出 |
| `run_1781254635607` | 14995 | 1（任务级 verified）；过程错误多次（search_files / hashline×2 / import×2）但无流内 exit0 核销 | 有 1 条 | **正常** | 同设计：首 error=L3 search_files 失败，非 mask 根因；每 run 至多 1 条属预期 |
| `run_1781252069033` | 7746 | 0（任务级） | 无 | **该 run 确实无料** | harness 未 resolved；finalSummary 自述 empty-array 修复，但无 verified 消除，不得入库 |

### 漏检判定

- **未发现**「肉眼有 verified 对、萃取器无/错」的系统性漏检。
- 未 resolved 的 7746/14365 正确为空，**不是**漏检。
- 已知仪器局限（记录，**本单不改萃取器**，≤60 行也无法把「过程 error 锚」升级成「任务根因锚」而不扩工程）：
  1. `distillRunEvents` 固定 **首 error** → 其后 verification；本批首 error 几乎全是过程噪声（hashline / import / search）。
  2. 本批 events **无** verification 事件；全靠 harness 外挂 verification。
  3. 每 run ≤1 条，多段过程恢复不会被拆成多 knack（设计如此）。

→ 分叉：**非**「仪器不足，料况未定」；料况由 4 条 resolved 轨迹支撑，格式侧可判。

## 3. 候选 knack 判卷表

对照 ADR-003 tentative schema 核心字段：`id` / `repo` / `symptom` / `verified_fix` / `evidence_task` / turn 证据 / `compression_level=knack` / `confidence∈{verified,candidate}`。  
现行实现另有 ADR-004 字段（`fix_summary`、`dedup_key`、`evidence_turns` 数组等），不视为违规。

| id | symptom | fix_summary | evidence_task | 格式合法 | 人工质量（作者填） | 若注入第 4 题能否少走弯路（作者填） |
|---|---|---|---|---|---|---|
| `knack-astropy-astropy-bda676b58a58` | ``output_field.replace(...)` returns a new array but the result is discarded.` | assign 回 `output_field`（slice in-place） | `astropy__astropy-6938` | **是** | | **N/A / 无行为层迁移**（作者 2026-07-17：数组原地赋值教训与第 4 题 RST 无关；见作者 P0 合页） |
| `knack-astropy-astropy-56bb6cb9aa1e` | `_cstack` 在 `right` 已是 ndarray 时填 `1` 而非拷贝矩阵 | ~~（退化成 tool sequence 摘要；缺 The-fix-is marker）~~ → **见 §3.1 保真度重跑** | `astropy__astropy-12907` | **是** | | **N/A / 无行为层迁移**（作者：矩阵拼接 vs RST header_rows） |
| `knack-astropy-astropy-f2a2f69eada5` | `RST.__init__` 不接受 `header_rows`（相对 `FixedWidth`） | ~~（退化成 tool sequence 摘要）~~ → **见 §3.1 保真度重跑** | `astropy__astropy-14182` | **是** | | **N/A（循环/穿越：产自第 4 题本身）** |
| `knack-astropy-astropy-441a5f2731ca` | `_arithmetic_mask` else 支未处理 `operand.mask is None` | add missing case | `astropy__astropy-14995` | **是** | | **N/A（循环/穿越：第 4 题之后）** |

> **人工判卷由作者本人完成**；agent 不代填「质量」与「注入第 4 题」两栏。  
> （作者合页 2026-07-17 已填「注入第 4 题」侧：迁移未观察到；质量栏仍可对 §3.1 新人话 fix 补判。）

### 格式侧汇总

- 格式合法候选：**4 ≥ 3** → 格式门槛通过。
- 质量门槛（≥1 条「注入第 4 题能少走弯路」）：作者合页判定 **未观察到迁移**；knack 价值假设修正为「同类症状复发时召回」。

### 3.1 保真度修复后重跑（2026-07-17，旧行不删）

- **动机**：4 条中 2 条 `fix_summary` 退化为 `Tool sequence: …` 流水账（无 `The fix is` 类 marker）。
- **策略**（宁缺毋滥，无模型）：marker → 否则 `finalSummary` 中**最后一个含代码符号**的句子 → 否则 `fix_summary=""` + `confidence=candidate` + unit_test 标注 `Fix not extracted.`
- **Scope**：同一 `evals/distillation/tier-b-on-assay-scope`，同一 distill 命令。
- **萃取器**：`knack-distillation.ts` 保真度补丁 @ `9105cd53`；基线 `f78ed974`。
- **快照**：旧输出备份 `p0-assay-candidates.before-fidelity.json`；新输出覆写 `p0-assay-candidates.json`（仍 4 条）。

| evidence_task | 字段 | 旧 | 新 | 说明 |
|---|---|---|---|---|
| 6938 | fix_summary | assign 回 `output_field`（slice in-place） | **same** | 本有 marker，不回归 |
| 6938 | confidence | verified | **same** | |
| 12907 | fix_summary | `Tool sequence: bash -> … -> bash.` | `The analogous code for left already did this correctly (cleft[…]=left), so the fix makes right consistent with…` | 无 marker → 末代码句；**流水账消除** |
| 12907 | confidence | verified | **same** | 代码句路径仍 verified |
| 14182 | fix_summary | `Tool sequence: bash -> … -> read.` | `For header_rows=["name","unit"]: separator_index=2, correctly points to the separator after two header rows.` | 无 marker → 末代码句；**流水账消除** |
| 14182 | confidence | verified | **same** | |
| 14995 | fix_summary | to add that missing case. | **same** | 本有 marker，不回归 |
| 14995 | confidence | verified | **same** | |
| *all* | id / symptom / evidence_turns | — | **unchanged** | id 哈希未变（verified_fix 构造未改） |

- **验收勾选**：无 marker 路径不再产出流水账 ✓；相关测试 20/20 绿 ✓；`importDistilledKnacks` 消费新 JSON 导入 4 条无报错 ✓。
- **质量栏**：第 2、3 行（12907 / 14182）新人话 fix **留作者补判**；「注入第 4 题」结论**不重判**（作者已 N/A）。

## 4. 化验结论（agent 可断言部分）

| 项 | 结论 |
|---|---|
| 样本 | Tier B on 臂 6 run / 6 条 events 轨迹（2026-06-12 OpenRouter Sonnet pilot） |
| 萃取 | raw 4 → dedup 4；仅 resolved 四题出料 |
| 仪器 | 抽 3 run 无系统性漏检；过程 error 作锚是质量噪声源，非漏检；**fix_summary 流水账已用降级策略修复** |
| 格式门 | 通过（4 条合法） |
| 质量门 / 迁移 | 作者合页：**有料**；**未见跨任务预注入价值**；价值假设 → 同类症状召回 |
| P0 总判 | 前提部分成立；**先修萃取器保真度（本补丁）→ 再谈 P1 准入**（准入条件仍为 verified fix；预注入叙事降级） |
| 不执行 | 未实现 P1 门控；未改 ADR-004 schema 字段；无 tombstone |

## 5. 中间产物清单（不进主干污染）

```
evals/distillation/p0-assay-candidates.json              # 保真度修复后重跑输出
evals/distillation/p0-assay-candidates.before-fidelity.json  # 修复前快照
evals/distillation/p0-assay-grading.md                   # 本判卷表（含 §3.1 diff）
evals/distillation/tier-b-on-assay-scope/                # 只读 scope 拷贝
evals/distillation/candidate-knacks.json                 # 既有历史产物（非本单写入）
```
