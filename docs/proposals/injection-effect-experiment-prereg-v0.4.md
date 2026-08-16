# 预注册：注入效果实验 v0.4（三臂纯记忆迁移 · 共享种子题 · 三族）

状态：**在用**

| 字段 | 值 |
|------|-----|
| finding | `finding:injection-effect-experiment-v0.4` |
| 前版 | [v0.3（已作废，禁止并入结果）](./injection-effect-experiment-prereg-v0.3.md) |
| 版本 | **v0.4** · 2026-07-28 |
| 代码基线 | `TBD`（本预注册配套仪器改动合并入 main 后回填合并 SHA） |

## 相对 v0.3 改了什么

v0.3 因**设计不可分辨**作废。v0.3 **零正式 run**（无 `evals/results/injection-experiment-v0.3/`），因此没有任何结果需要隔离，本版是干净重开而非结果作废。四条理由：

1. **第 1 题的运气决定后续在比什么。** v0.3 四臂第 1 题记忆全空、注入策略无效，实为四次独立采样；而第 1 题的 resolved 结果决定该臂后续记忆池（v0.3 准入第 6 条：unresolved 永久不准入）。若 A-L 第 1 题未过而 C 过，A-L 在第 2 题退化为 B 臂，比较测的是第 1 题运气而非注入策略。v0.3 仪器无任何门禁：中期判读直接跳过第 1 题，既不报告也不校验四臂是否分叉。
2. **H2（C 臂）结构上不可测。** 每 resolved run 出 1 条主 lesson，故第 2 题合格池 ≤1 条、第 3 题 ≤2 条；而 A-L 的 lesson 无条数上限（`RECALL_LIMITS.standard` 只限 `knacks`），仅受 lessons 段 token 预算约束，1–2 条远低于该预算。A-L 与 C 因此极可能注入完全相同的集合，「C ≤ A-L 且成本更高」注定为无差异，C 臂 6 run 空转。
3. **C 与 A-L 的差异不止「常驻」一项。** C 走全量常驻渲染且不带 recall citation，A-L 走召回段渲染且附带 citation 指令：残留策略、提示词格式、citation 指令三者同时变化，任何差异都无法单独归因给常驻。
4. **v0.3 冻结文档未覆盖两个已实装行为。** 空 patch 判 unresolved 且跳过 harness（`harness: null`），与 v0.3 完成门「每 run 必须落官方 harness 报告」自相矛盾且全文未提；断点续跑（`--resume-from-task`）亦不在文档内，而 v0.3 明写「不补种、不重跑」。两者状态处理本身幂等，不是缺陷，而是预注册未覆盖实际行为——这正是预注册应当防止的漏洞。

另修正两处判读与仪器纪律问题：v0.3 判读采用「resolved 差 ≥1 题 **或** 阶梯少 ≥30%」双通道 OR，在仅 2 个判读点上把本已很弱的门槛再放宽一倍；批次 manifest 只记代码 commit，不记预注册文档自身 hash，而冻结题序是用正则从本文档 markdown 表格刮取的，文档排版变动会静默改变实验参数。

v0.3 及更早各版只可作历史对照引用，禁止并入本版结果。

## 目标与假设

实验只允许跨题传递记忆，不允许传递代码、worktree、测试产物或其他任务状态。每个 SWE-bench instance 从冻结的 `base_commit` 建立全新干净 worktree。

- **H1（主）**：在记忆池完全相同的条件下，直接按需召回合格 lesson 的 A-L 臂，在族内第 2 题的 resolved 结果上优于 B 臂。
- **H1-K（次）**：保留现行成熟度准入的 A-K 臂相对 B 臂是否产生方向性改善，并与 A-L 比较准入延迟的代价。

H2（全量常驻 vs 按需召回）**本版删除**：合格池 ≤2 条时两者注入集合几乎必然相同，该对比在当前族规模下结构上不可分辨，留待族规模足以产生 ≥5 条合格 lesson 的版本再开。

样本量小，所有结论只写“方向性证据，非统计显著”；本版明确不作统计推断。

## 三臂

| 臂 | 代号 | 注入定义 |
|----|------|----------|
| A-L | `lesson-recall` | 仅从本臂本族此前 resolved run 的主 lesson 中按需排序召回；不注入 knack 或其他记忆类型 |
| A-K | `knack-recall` | 仅召回由合格 lesson 按现行 breaker / harness-strong 规则晋升的 knack；不放宽晋升或 ranking 规则 |
| B | `off` | 与其他臂使用相同 context-runtime 组装，学习照常写入，但记忆注入为空 |

三臂的模型、接入、采样、题序、非记忆上下文和学习管线一致，唯一差异是上表的记忆注入策略。

### 可注入记忆的闭集

- 只允许 `lesson` 或由其晋升的 `knack`；preferences、历史任务快照、run archive、artifact refs、doc findings 等不得进入提示词。
- lesson 必须来自当前 family 的种子题或本臂此前的 resolved run，`quality=high`、未 archived，且来源 run 经钉死的官方 harness 判为 `resolved=true`。
- `ephemeral/lessons.jsonl` 永不注入。
- A-L 使用现行基础相关性评分、`doNotApplyWhen` 和 standard tier 的数量/token 上限；同分时按 `updatedAt` 降序、ID 升序固定。
- A-K 继续使用现行 breaker 和 knack ranking；来源 lesson 未通过 harness 准入的 knack 不合格。
- lesson 晋升后，A-L 仍只渲染 lesson 一次；A-K 只渲染 knack，禁止双份注入。

### harness-strong 出生规则

eval knack 供给与生产闭环同构：run 内由 ReflectAgent 在线出生的 lesson 一律为 `candidate`；离线确定性蒸馏器（`knack-distillation.ts` 等）为 audit-only，**不写主库**。

- **晋升**：harness 判 `resolved=true`（reward=1）后，由 `promoteRunLessonsAfterHarness` 将该 run 在线出生的 candidate lesson 晋升为 `verified`；`resolved=false` 则该 run 的 lesson/knack 永久不准入。
- **harness-strong**：已由 harness reward=1 盖上 `promotedAt` 的 verified lesson，免除「同类信号 ≥2 次」的重复要求，**单次直升 knack**（经 `promoteHarnessEligibleLessons`）。无 harness 的生产态仍走重复规则。
- **run 内自证的 lesson 同样要盖 `promotedAt`**（BUG-015 修复）：出生时若 run 内已有「报错 → 操作 → 通过校验」的因果链（`streamVerified`），confidence 直接是 `verified`。此前 `promoteCandidatesForRun` 只处理 `candidate`，于是这类**证据最强**的 lesson 永远拿不到 `promotedAt`，harness-strong 永不触发，knack 恒为 0。现改为按 `promotedAt` 是否为空判断是否盖章：`candidate` 升 `verified` 并盖章，已 `verified` 的补盖章，已盖章的幂等跳过。判据仍是「外部 harness 判对」这一件事，只是不再被出生时的 confidence 挡住。


`per AEvo-2605.13821`：evaluator 与 agent 保持隔离——agent 不得窥探 evaluator 内部、不得访问隐藏 benchmark 产物、不得直写官方分数。本实验中 harness 的测试名、日志和详细报告只作审计产物，不进入 memory root 或模型上下文；管线只消费 resolved 布尔值。

## 共享种子题（相对 v0.3 的核心设计变更）

每族第 1 题为**种子题，全族只运行一次**，而非每臂各跑一次：

- 种子 run 使用 `injectionMode: 'off'`（池本来为空，注入策略无效），独立 memory root，产物落 `<resultsDir>/seed/<familyId>/`。
- 种子 run 判分与准入流程与正式 run 完全一致（官方 harness 单实例判分 → admission → lesson 晋升 → knack 晋升）。
- 种子 memory root 在臂阶段开始前**整体复制**给每个臂，作为该臂的起始记忆。
- 因此三臂进入第 2 题时记忆池**完全相同**，第 2 题是本实验唯一无混淆的注入对照。

第 3 题的合格池取决于该臂自己第 2 题的结果，属处理效应的下游而非混淆，但比较是条件性的，故第 3 题降为条件性/探索性指标，不进主判读。

## 两阶段执行与种子门

### 阶段 A：种子门

三族各运行 1 个种子 run（共 3 run）。判读规则：

- 种子 `resolved=true` → 该族进入阶段 B。
- 种子 `resolved=false` → 该族合格池必为空、三臂必然同构，**该族对主分析作废**，记为「该族无法产生注入对照」。**禁止**将其解释为「注入无效」或任何方向性证据。
- 可用族 ≥2 → 进入阶段 B。可用族 ≤1 → 运行储备族 `F-DJ-INHERITANCE-PREDICATE` 的种子（需先按同一口径把其三题并入钉死输入）；本版不预先启用该族，若可用族 ≤1 则直接停跑，如实记「题库无法产生注入对照」并结束本版。

### 阶段 B：臂阶段

对每个可用族，三臂各运行第 2、3 题（每族 6 run），串行：

1. 将该族种子 memory root 复制为本臂 memory root；验证复制后的合格 lesson / knack 集合与种子一致。
2. 从当前 instance 的冻结 `base_commit` 创建新 worktree，并验证初始 HEAD 与工作树洁净。
3. 从本臂本族此前合格记忆组装提示，落 injection 快照后运行 agent。
4. 落 patch、trace、events、prediction；不得把 worktree 或 diff 带入下一题。
5. 立即用冻结数据快照和官方 SWE-bench harness 单实例判分。
6. harness 进程非零、报告缺失或快照不符属于仪器异常，整批停跑保留现场。
7. `resolved=false` 是合法结果：继续下一题，但该 run 的 lesson/knack 永久不准入，不补种、不重跑。
8. `resolved=true` 后才登记准入；由 `promoteRunLessonsAfterHarness` 晋升该 run 在线出生的 lesson（reward=1 → verified）。晋升为空只记原因，禁止 synthetic fallback，禁止回退到离线确定性蒸馏器写主库。
9. 对已准入（verified）lesson 执行现行 knack 晋升（含 harness-strong 单次直升），再开始下一题。第 3 题完成后仍照常归档/晋升，但不跨族使用。

阶段 B 在该族种子 `resolved=false` 时**拒绝启动**（仪器层门禁，不得静默继续）。

### 预算

| 情形 | run 数 |
|------|--------|
| 三族种子全过 | 3 + 3×6 = 21 |
| 两族种子过 | 3 + 2×6 = 15 |
| ≤1 族种子过 | 3，停跑并如实记录 |

上限 ≤24 run，与 v0.3 预算持平。

### 已实装行为的显式声明（v0.3 遗漏项）

- **空 patch**：agent 产出干净空 patch（trace 成功但无 diff）时，该 run 计 `resolved=false`、**跳过 harness 判分**，`admission.json` 中 `harness` 为 `null` 并必须带 `harnessSkipped.reason = empty_patch_counted_unresolved`。完成门显式接受这一例外：空 patch run 不要求官方 harness 报告，但要求 `harnessSkipped` 字段存在。该 run 的 lesson/knack 永久不准入。
- **断点续跑**：允许 `--resume-from-task` 从族内第 N 题续跑，且必须在批次 manifest 留痕。边界：续跑只重放此前空 patch run 的收尾登记（该操作按 runId 幂等），**不得**重跑已判分的题、不得改动既有判分、不得重置该族 memory root。与「不补种、不重跑」并行成立。

## 模型、采样与快照

| 参数 | 三臂冻结值 |
|------|------------|
| model | `glm-5.2` |
| provider profile | `zhipu-glm-5.2` |
| thinking | `enabled` |
| temperature | `0` |
| top_p | `0.95`（`do_sample=false`，不显式发送） |
| max_tokens | `16384` |

- 数据集：`SWE-bench/SWE-bench_Lite`，`test` split。
- 数据仓库 commit：`69611d31007e1c6731db8bd5b5c3f2d33f5bab6e`。
- 解码 test Arrow SHA-256：`b77fa3036c06219715a35e8088fee13b0b87bc957052546c3270caf38a325627`。
- harness Python 与本地 snapshot manifest 必须由运行命令显式提供；runner 不设默认路径并逐题复验 SHA。
- 种子 run 与臂 run 使用同一组冻结采样值，不得分别设置。

## 指标与判读

主分析只看每个可用族的**第 2 题**——该题是三臂记忆池相同的唯一位置。

| 类型 | 定义 |
|------|------|
| 主 | 每个可用族在第 2 题上 A-L 与 B 的 resolved 配对结果。逐族原样列出三臂结果，并给出跨族符号计数（A-L 过而 B 未过的族数 vs B 过而 A-L 未过的族数） |
| 次 | A-K vs B 同结构配对；A-L vs A-K 的 resolved 与准入延迟代价 |
| 条件性 | 第 3 题各臂 resolved，单独成节；因池取决于该臂自身第 2 题结果，只作探索性描述 |

判读纪律：

- **不作统计推断**。可用族最多 3 个，主判读最多 3 个配对点。报告只允许写「N 个族中 M 个族出现 A-L 优于 B」的原样计数，禁止写显著性、禁止把符号计数换算成率或百分比。
- **单一主通道**。v0.3 的「resolved 差 或 阶梯少 30%」双通道 OR 予以删除：只有第 2 题 resolved 的配对结果构成 H1 的判读通道。
- **复合量恒报告但不作判读通道**（`per Survey-Skill-2606.11435`：该综述将「以二元 pass/fail 为主、忽略 token 成本与错误类型」列为领域结构性缺口，主张转向复合刻画；同时指出缺乏纵向评估，本版据此把第 2 题设为纵向链条上唯一可比位置）：每 run 恒报告升级阶梯触发次数、总 token、注入 token、空召回率、`used_recall` 命中、错误类型分布。这些量只用于描述与操纵诊断，**不构成 H1/H1-K 的替代判读通道，也不作为排除条件**。
- `[[used_recall:<id>]]` 对 A-L lesson 与 A-K knack 均记入 trace，只记不评分。

### 异常纪律

限流、provider 格式异常、harness 歧义或审计产物缺失均停跑报告；禁止现场修改设计救批。种子门判为不可用的族不得事后改判、不得换题重试。

## 附录 A：冻结题序

每族第 1 题为共享种子题，第 2、3 题为臂阶段题。

| 族 | 顺序 | instance_id |
|----|------|-------------|
| `F-DJ-MIGRATION-REFERENCE` | 1 | `django__django-12125` |
|  | 2 | `django__django-14580` |
|  | 3 | `django__django-17087` |
| `F-SY-UNIT-EQUIVALENCE` | 1 | `sympy__sympy-20442` |
|  | 2 | `sympy__sympy-24066` |
|  | 3 | `sympy__sympy-24213` |
| `F-DJ-SELECT-MASK` | 1 | `django__django-14667` |
|  | 2 | `django__django-15814` |
|  | 3 | `django__django-16910` |

`F-DJ-SELECT-MASK` 由 v0.3 的替补族升为第三正式族：其三题已在冻结输入内，[候选筛查表](./injection-effect-task-families.md)评「症状同类度强、污染核查通过」。种子门取代 v0.3 的中期换族规则，本版无替补族。

`F-DJ-INHERITANCE-PREDICATE` 记为储备族，其三题尚未并入冻结输入，本版不启用。

题序按冻结快照 `created_at` 升序；污染排除和候选依据沿用候选筛查表，不得换题或重排。

## 审计产物与完成门

每 run 必须落：trace、events、注入快照、prediction、官方 harness 报告（空 patch run 例外，须改落 `harnessSkipped`）、admission 报告、注入前后 memory inventory。批次 manifest 必须记录当前代码 commit、**本预注册文档的 sha256**、预注册文档版本、数据 SHA、arm/family、模型与采样、以及是否为续跑。种子阶段另须落种子 memory root 的 inventory 与复制后各臂 inventory 的一致性校验结果。

跑正式批次前该过的检查：三臂差异单测、种子共享与复制一致性单测、种子 unresolved 时臂阶段拒绝启动、resolved/unresolved 双题无模型回放、跨臂/跨族/ephemeral/历史记忆防泄漏、P3 lesson/knack citation、全量测试与构建，以及旧 resolved prediction 的官方 harness 判分烟测。

### 仪器验收实测记录（2026-07-28）

| 门项 | 结果 |
|------|------|
| 全量单测 + `tsc --noEmit` | 通过（1190 passed / 1 skipped / 0 failed） |
| 三族两阶段 `--dry-run`、题序刮取、`preregSha256` | 通过 |
| 缺 harness/快照参数时拒绝真跑、退役 C 臂 CLI 拒绝 | 通过 |
| 旧 resolved prediction 官方 harness 判分烟测 | **通过**：`astropy__astropy-12907` → `resolved=true`，patch 应用成功，FAIL_TO_PASS 2/2、PASS_TO_PASS 13/13；数据快照三道 SHA 门禁对真实数据生效 |
| live 种子 run（真实 glm-5.2 + 官方 harness） | **通过**：出 patch → 判 `resolved=true` → admission 登记 → lesson 在线出生且合格 |
| 种子记忆复制一致性（对真实出生的 lesson） | **通过**：三臂 `seedCopyVerified=true`，第 2 题起始 `eligibleLessonIds` 三臂完全一致 |
| A-L 注入有效性（真实记忆 + 真实任务上下文） | **通过**：注入提示 5506 字符含真实 lesson 正文，对照 B 4554 字符 |
| A-K 注入有效性 | **通过（修 BUG-015 后）**：修复前 knacks=0、A-K 与 B 仅差段落骨架；修复后同一条真实 lesson 产出 1 个 knack，A-K 注入 5473 字符含 knack 正文，对照 B 4543 |

live 烟测使用 spec 副本（族替换为镜像本地可用的 astropy 题），产物落 scratchpad，不入 `evals/results/`。



