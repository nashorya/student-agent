# ADR-003 · v0.4x 优先级重排（基于 Tier B 数据）

- **日期**：2026-06-13
- **状态**：已采纳

## 背景

Tier B pilot（2026-06-12，OpenRouter Sonnet 4.6，astropy 6 题，1 seed）给出了首条
受控数据。在此之前，v0.4x 的组件优先级来自直觉；现在用数据重排，并把若干方向
显式 tombstone。

核心发现（详见 [benchmark-report-2026-06.md](../benchmark-report-2026-06.md) §5）：

1. **归档→召回→注入链路已跑通**（第 2 题起稳定召回 4 条）——管道本身不是瓶颈。
2. **零条 lesson 是"验证过的解法"**——31 条全是过程错误，无法产生质量收益。
3. **效率改善由单题离群值主导**——排除后 on 臂成本反升 14~18%。
4. **NO-GO 扩量**——病灶在写入层，扩样本前必须先修写入。

## 决策：v0.4x 组件优先级

### P0 · 离线蒸馏化验（零成本验证前提）

**做什么**：写脚本读 Tier B on 臂已有的 `events.jsonl`，从轨迹抽
"错误 → 后来哪步消除了它"的因果对，格式化为候选 knack，人工判质量。

**为什么 P0**：skill/knack 路线的全部投入建立在一个前提上——
"轨迹里存在可蒸馏的、被验证过的解法"。这是事实问题，不是观点问题。
化验结果好则前提成立，可放心建蒸馏管道；化验结果差则问题在更上游，
避免照着论文建一座空工厂。成本约等于零（读硬盘，不启动 agent）。

**验收**：产出 ≥3 条格式合法的候选 knack，人工评定至少 1 条"若注入第 4 题
能少走弯路"——则继续 P1；否则重新定位病灶。

**接口（tentative knack schema）**：
```jsonc
{
  "id": "knack-astropy-pytest-filterwarnings",
  "repo": "astropy",
  "symptom": "pytest 因 warning 配置报错（W::DeprecationWarning）",
  "verified_fix": "pytest -o 'filterwarnings=ignore::DeprecationWarning'",
  "evidence_task": "astropy-14182",          // 哪道题验证过
  "evidence_turn": 7,                         // 第几轮工具调用
  "compression_level": "knack",              // lesson / knack / rule
  "confidence": "verified"                   // verified / candidate
}
```

> **状态注 · P0 离线蒸馏化验（2026-07-17，不改上文原文）**
>
> - **Scope**：Tier B on 臂 pilot（2026-06-12 OpenRouter Sonnet）；轨迹
>   `evals/results/swebench/openrouter-sonnet-tier-b-on-memory-20260612/runs/*`
>   （6 run / events 行数 17·29·13·32·12·22）；逐题 harness
>   `openrouter-sonnet-tier-b-on-{6938,7746,12907,14182,14365,14995}-20260612`。
> - **萃取器版本（初检）**：`src/evals/knack-distillation.ts` @ `f78ed974`；入口
>   `scripts/distill-knacks.ts` @ `0934d40b`；化验时工作树 HEAD `46713111`。
> - **产出**：raw candidateCount **4** → 去重后 **4**（
>   `evals/distillation/p0-assay-candidates.json`）；判卷表
>   `evals/distillation/p0-assay-grading.md`。
> - **仪器/被试**（seed `20260717` 抽 3 run：12907 / 14995 / 7746）：
>   resolved 轨迹肉眼有任务级 verified 对且萃取器有 → **正常**；
>   未 resolved（7746）肉眼无 verified 料且萃取器无 → **确实无料**。
>   **无系统性漏检**。已知局限：首 error 常为过程噪声、
>   events 无流内 verification（靠 harness `reward=1`）。
> - **作者合页（同日）**：格式门通过；**有料**（否 tombstone）；仪器部分失真
>   （2/4 `fix_summary` 流水账）；**迁移未观察**（仅 2 条有「产自第 4 题前」
>   资格且与 RST 题无行为层迁移）。前提部分成立；knack 价值假设修正为
>   「同类症状复发时召回」（对齐 ADR-005/006）；预注入叙事降级；
>   **P1 准入本身不受影响，但须先修萃取器保真度**。scope n=6/4/1 仓不外推。
>
> **状态注 · 萃取器保真度修复（P0 后续 / P1 前置，2026-07-17）**
>
> - **改动**：`extractFixSummary` 无 marker 时**禁止**回退 `Tool sequence` 首句；
>   改为 (a) `finalSummary` 末个含代码符号句 (b) 否则 `fix_summary=""` +
>   `confidence=candidate` + unit_test `Fix not extracted.`。不动 ADR-004 字段。
> - **测试**：`knack-distillation.test.ts` 全绿；新增有 marker 不回归 /
>   无 marker → candidate 用例；import 脚本消费新 JSON 无报错。
> - **重跑**：同 scope 4 候选；12907/14182 流水账 → 人话 fix（verified 保持）；
>   6938/14995 marker 路径不变。diff 见判卷表 §3.1。
> - **萃取器 commit**：`9105cd53`（`fix(evals): degrade knack fix_summary without markers`）。
> - **边界**：模型调用 0；未做 P1 准入门控。

### P1 · Lesson 准入门控（batch distillation 管道）

**做什么**：在 lesson 写入时增加准入条件——lesson 必须包含
"验证过的解法"（tool call 取证 + exit 0）才能入库；否则降级为
ephemeral note，不归档、不跨任务传播。

旧行为（已 tombstone，见下）：把过程错误（"import 失败过"）当 lesson 写入。

实现路径：`LessonWriter` 在归档前做 causal pair 检查；
无法配对的记录标 `quality: low`，写入 `ephemeral/` 而非 `lessons/`。

**验收**：Tier B on 臂重跑，lesson 库里"verified" 占比 ≥ 50%；
质量分（人工盲审 5 条）≥ 3/5 可用。

> **状态注 · P1 阶段 1 门控实现（2026-07-17，不改上文原文）**
>
> - **判据单一来源**：`src/evals/causal-pair.ts` 的 `findCausalPair`
>   （首 error → 其后 verification，中间 ≥1 tool_call）。
>   `knack-distillation.distillRunEvents` 与 `LessonsManager` 准入共用，
>   禁止第二套配对逻辑。
> - **路由**：配对成功 → `lessons.jsonl`，`quality: high`，
>   `confidence` 走共享 `extractFixSummary`（verified/candidate）；
>   配对失败 → `ephemeral/lessons.jsonl`，`quality: low`，不进主库、
>   不参与 promote/recall（`getAll()` 仅读主库）。
> - **阶段 1 测试**：配对入库 / 配对失败降级 / 空轨迹不写；
>   lessons + knack-distillation + reflect + memory/recall 相关 **242** 测绿。
> - **阶段 1 commit**：`00ad6422`。
> - **阶段 2（未跑）**：验收重跑 Tier B on 臂 6 run **需作者批预算**。
>   预估价（同批口径，2026-06-12 pilot）：on 臂 trace 合计约 **$1.81**；
>   建议上限 **$3.0**（含重试/波动）。过门前不启动。
> - **边界**：未改 ADR-004 / ADR-005；无模型调用；无注入效果评估。
>
> **状态注 · P1 阶段 2 验收重跑（2026-07-18，不改上文原文）**
>
> - **Scope（不完整）**：on 臂 OpenRouter `anthropic/claude-sonnet-4.6`，
>   共享 memory `evals/results/swebench/openrouter-sonnet-tier-b-on-memory-p1gate-20260718`；
>   题序 6938→7746→12907→14182→14365→14995；门控 commit `00ad6422`；
>   需 `NODE_USE_ENV_PROXY=1` + 本地 HTTP 代理（直连 OpenRouter 会 403 区域限制）。
> - **跑通**：6938 / 7746 **success**（trace cost **$0.369**）；
>   12907 / 14182 / 14365 **failed** OpenRouter **402**（key 额度不足支撑
>   `max_tokens=32000`）；14995 未完成。成功 run **2/6**，**未达完整验收样本**。
> - **准入结果**：主库 `lessons.jsonl` **0** 条；`ephemeral/lessons.jsonl` **12**
>   条（全 `quality: low`：tool_error / hashline / toolguard）。  
>   **verified 占比 = N/A（主库空）→ 未过 ≥50% 线**（不粉饰）。
> - **隔离侧**：门控隔离验收 **通过**——**12/12 噪声无一入库**。
> - **verified 侧诊断**：**时序错位、结构性零分**——**非**门控失败、**非**无料。
>   finalize 早于 harness；流内几乎无 pytest exit-0，reward 在写入时尚未到达。
> - **402 run**：12907 / 14182 / 14365 标 **invalid(funding)**；14995 missing 同因；
>   `rerunRequired` 见 `evals/distillation/p1-phase2-admission-report.json`。
> - **盲审**：`p1-phase2-blind-review.md` 5 条均为 ephemeral 噪声，**不正式判卷**；
>   两分钟扫一眼确认“确实是垃圾”即可（门控抽检）。
> - **召回附记**：成功 run 的 `usedRecallIds` 均为 `[]`。
> - **验收结论**：**未达标**（样本不全 + 主库 verified 结构性零）。不重跑刷分。
> - **产物**：`evals/distillation/p1-phase2-admission-report.json`；
>   runner `evals/results/swebench/logs/run-p1gate-tier-b-on.sh`。
>
> **状态注 · P1 补丁 · 延迟晋升（2026-07-18）**
>
> - **改动**：`findCausalPair` 明确 stream→harness verification 回退 +
>   `allowProvisional`（error+ops 无证 → provisional）；lesson 两级写入——
>   流内证 → `verified`，无流内证但 pair 成立 → `candidate`，不成对 → ephemeral；
>   harness 后 `promoteCandidatesForRun`（reward=1 升 verified + `promotedAt`，
>   ≠1 保留 candidate）。接入 `reconcileSweBenchRecallCredits`。
> - **测试**：流内 verified / provisional candidate / 晋升 / 不晋升 / 噪声 ephemeral
>   五类 + 相关回归绿。
> - **commit**：`b3759244`。
> - **阶段 2b（花钱，先报批）**：补丁合入后重跑 on 6 题；预估 ≈ **$1.5**
>   （~$0.2/run）；OpenRouter 需充值。验收仍 ADR-003 原文。
>
> **状态注 · P1 阶段 2b ZenMux 重跑（2026-07-18，不改上文原文）**
>
> - **渠道**：ZenMux `https://zenmux.ai/api/v1` + `anthropic/claude-sonnet-4.6`
>   （**非** OpenRouter 同批口径；功能验收可用）。  
>   运行时坑：`pi-ai` 在 provider=`openrouter` 时只读 `OPENROUTER_API_KEY`，
>   须 `OPENROUTER_API_KEY=$ZENMUX_API_KEY`（进程内映射）。
> - **Scope**：shared memory  
>   `evals/results/swebench/openrouter-sonnet-tier-b-on-memory-p1prom-20260718-zenmux`；  
>   题序 6938→7746→12907→14182→14365→14995；门控+延迟晋升 `b3759244`。
> - **Produce**：**6/6 success**；trace cost 合计 **≈ $0.74**。
> - **准入（harness 前）**：主库 **13**（verified **7** / candidate **6**）→  
>   verified 占比 **53.8% ≥ 50%**（流内证路径）；ephemeral **13**（噪声隔离仍在）。  
>   harness 判分与 candidate→verified 晋升 **尚未跑**（待 Docker SWE harness）。
> - **召回**：本批 `usedRecallIds` 均为空。
> - **盲审表**：`evals/distillation/p1-phase2b-zenmux-blind-review.md`（5 条主库样本）。
> - **报告**：`evals/distillation/p1-phase2b-zenmux-admission-report.json`。
> - **验收（produce 侧）**：曾报 verified 53.8% **已作废**（主库过程噪声误入，
>   见 2026-07-19 写入路径审计）。成本回填网关 **$2.41**（本地 $0.74 作废）。
>
> **状态注 · P1 收尾 + 仪器三修（2026-07-19）**
>
> - **A 成本**：网关权威 **$2.41**；本地低估 3.3× 记 buglog；计价器补 cache 分项
>   重算 + `costAuthority`；历史批次不重算、跨批 ÷3.3 折算注。
> - **B skill 隔离**：eval `controlledSkillRoots=evals/fixtures/skills`（空）+
>   `noSkills` 禁默认发现；trace `skillManifest`；diagnostics 移出被试 prompt。
> - **C 缓存前缀**：proposal 已批；**C-2 落地**（static→breakpoint→dynamic，
>   截断语义不变）见 `docs/proposals/p1-cache-prefix-reorder.md` 修订与
>   `evals/distillation/c2-cache-prefix-smoke.md`。
> - **D+ 主库审计**：13 条均经 LessonWriter 但判据过松；已全部降 ephemeral；
>   盲审 **0/5** 归因「写入路径旁路真判据」，**非**轨迹无料；knack 线不死刑。
> - **D harness（2026-07-19）**：官方 SWE-bench Lite harness 6/6 完成；
>   **resolved 3/6（50%）** vs produce success 6/6（success ≠ resolved，如实记）。
>   resolved：6938 / 12907 / 14995；unresolved：7746 / 14182 / 14365。
>   当时主库空（D+ 过程噪声全降 ephemeral）→ 晋升 **0**；verified 曾 **voided_empty_main**。
>   报告：`evals/distillation/p1-phase2b-zenmux-harness-report.json`。
>
> **状态注 · P1-E 接通供给管道（2026-07-19）**
>
> - **供给路径**：蒸馏(events) → LessonWriter.`findCausalPair` 门控 → 主库 → harness 晋升  
>   （`importDistilledLessons` + `admitDistilled`；**不**碰 KnacksManager / 不改蒸馏·门控判据）。
> - 接续「主库 0 条」：对本批 6 run 蒸馏；resolved 三题入主库并 promote（`promotedAt`=harness 时间）；
>   unresolved 三题无 stream/harness 外证 → 蒸馏合法 null（非后门）。
> - **主库现 3**（verified **3** / candidate **0**）→ verified 占比 **100%**（样本小，盲审另判）。
> - 新盲审表：`evals/distillation/p1-e-blind-review.md`（正货 symptom+fix）；
>   报告：`evals/distillation/p1-e-supply-report.json`。P1 待作者盲审 ≥3/5 再合页。
>
> **状态注 · P1 合页（2026-07-19）**
>
> - **盲审**：**2/3 通过**（n=3；验收线按 ADR-003 的 3/5 比例折算为 **≥2/3**，
>   判卷前公证）。判定 **0/1/1**。  
>   第 1 条判 0 归因：symptom 格为诊断口水话（`"confirmed."`），检索钥匙失效  
>   （非轨迹无料、非门控失败）。表：`evals/distillation/p1-e-blind-review.md`。
> - **P1 最终形态**：`蒸馏(events)` → `LessonWriter` 门控 → 主库 → harness 晋升；  
>   全链路 commit 可查（供给 `99687ad9`；仪器 `c9d2c106`；harness 文档 `6f05bf00`；
>   延迟晋升 `b3759244`）。主库 **3 verified / 0 candidate**。
> - **scope**：n=3、单仓库（astropy）、单批次（ZenMux 07-18 produce + harness）。  
>   **未验证**：「lesson 注入改善后续任务」——属下阶段独立实验。
> - **状态**：**P1 CLOSED（合页）**。
> - **保真度 v2 落地** @ `84dac410`：`extractSymptom` 任务侧优先 + fix 按句取整；对照 `p1-fidelity-v2-diff.md`。
  
>   fix 按句取整）——证据见 p1-e 盲审 #1 错格。

### P2 · 召回排序去 recency 偏置

**状态**：已实现，正式协议见 [ADR-005](ADR-005-recall-ranking-protocol.md)。

**做什么**：当前召回按时间序取最近 N 条；改为按相关性（仓库 + 症状 embedding
相似度）排序，recency 降权为 tiebreaker。

**为什么 P2 不是 P1**：P1 解决"写入的都是垃圾"，P2 解决"好东西被旧垃圾
压着召不出来"——必须先有质量过关的 lesson 才值得调召回排序。

### P3 · 利用可观测（recall citation）

**状态**：已实现，正式协议见 [ADR-006](ADR-006-recall-citation-and-credit.md)。

**做什么**：agent 在引用 lesson/knack 时，在 trace 里留 citation 标记
（`used_recall_ids: ["knack-xxx"]`）；harness 统计"召回但未引用"
vs "召回且引用"，作为下一轮 eval 的二级指标。

**为什么 P3**：Tier B 的核心审计盲点是"无模型实际利用的证据"；
没有 citation 就永远无法区分"有效利用"和"注入了但忽略了"。

### P4 · Requirement Ledger 完整版

延续现有 hardConstraints 机制，结构化为 Ledger：
每条约束有 ID、来源、验证方式、当前状态（open / satisfied / waived）。
完工后可替换掉 completion self-check 里的自由文本约束列举。

*优先级低于 P1-P3，因为 hardConstraints 已有应急兜底，不阻塞质量收益路径。*

### P5 · "较真税"治理（thoroughness budget）

overfull-hbox 案例表明穷举自查成本可达 600k-1.2M total。
需要机制让 agent 感知当前任务的"彻底性预算"，高精度任务开满、
日常任务收缩。实现方案待 P1-P3 稳定后设计。

---

## Tombstone（被否方向，勿重提）

| 方向 | 否决原因 |
|---|---|
| ⏸ 直接扩 lesson 量（更多 seed / 更多题）| 病灶在写入质量，扩量只放大噪声 |
| ⏸ 调优召回 top-k（从 4 → 8）| 同上，垃圾召更多仍是垃圾 |
| ⏸ 自建埋坑任务序列 | 设计成本高，说服力弱（见 ADR-002） |
| ⏸ self-running Claude Code 对比 | off-label，成本高，已转引公开数据（见 ADR-001）|

---

## 关联

- 数据来源：[ADR-002](ADR-002-learning-eval-protocol.md)，[benchmark-report-2026-06.md](../benchmark-report-2026-06.md)
- 触发此 ADR 的 bug：BUG-001（context runtime 未接入）、BUG-004（约束遵循）
- 下一个 ADR：ADR-004（knack schema 定稿，待离线化验结果后写）
