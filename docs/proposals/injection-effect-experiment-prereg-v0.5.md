# 预注册：注入效果实验 v0.5（三臂纯记忆迁移 · 共享种子题 · 供给管线 v2）

状态：**已冻结（2026-08-14，作者明确回复「冻结」）；禁止点火。仪器门禁全绿且作者另行回复「点火」前，禁止运行正式题**

| 字段 | 值 |
|------|-----|
| finding | `finding:injection-effect-experiment-v0.5` |
| 前版 | [v0.4（三臂 · 共享种子题；其设计与仪器验收由本版全部继承）](./injection-effect-experiment-prereg-v0.4.md) |
| 版本 | **v0.5** · 2026-08-14 |
| 代码基线 | `8dda2f4b`（`feat/lesson-authoring-v2`：供给 v2 实现 + cherry-pick v0.4 仪器与 BUG-015 修复） |
| 冻结规则 | 作者批准冻结后，任何设计变化均须作废重开；**冻结 ≠ 点火** |
| 基线勘误 | 本文档初稿（基线 `17ce4e67`）因分支上当时无 v0.4 文件而写作「继承 v0.3」；同日 cherry-pick `8dda2f4b` 补齐 v0.4 仪器后，改为继承 v0.4，初稿的 v0.3 继承文本不作数 |
| 本版边界 | **已冻结、仍禁止点火**；runner 收到本文件 ≠ 已点火 |

> **落痕**：供给与对比式经验写作 `per ExpeL-2308.10144`；M3 启用时 AOT vs JIT 文档读法 `per GAM-2511.18423`。

---

## 0. 相对 v0.4 的变更摘要

v0.4 的全部操作条款（三臂、共享种子题、种子门、单通道判读、AEvo 隔离、memory 隔离、空 patch / 续跑显式声明、样本规则、模型/采样表、族序、manifest 记 prereg sha256）**全部继承，不静默删除**。本版仅新增/改写与 **lesson 出生供给管线 v2** 相关的条款：

| 主题 | v0.4 | v0.5 |
|------|------|-----------|
| lesson 出生 | ReflectAgent / 在线结构化 lesson（`Symptom:… Fix:…`）模板路径 | Agent 经 `write_lesson` 自判自写；审计员锚定证据；模板路径保留 |
| 出生置信度 | run 内在线出生一律 `candidate`；模板路径 `streamVerified` 出生 `verified` | 模型所写 lesson **一律** `candidate`；未锚定 → ephemeral，永不注入 |
| 写入上限 | （隐含管线产出量，每 resolved run ≈1 条主 lesson） | **写入不限次数**；注入仍靠准入/晋升/top-k 挡水 |
| 晋升链 | `promoteRunLessonsAfterHarness` / harness-strong / `promoteHarnessEligibleLessons`（BUG-015 `promotedAt` 盖章语义） | **一字不动** |
| 注入载荷 | lesson 正文（含症状复读） | 渲染 `cause` / `fixPattern` / `doNotApplyWhen` / `docRefs`；症状只作召回索引 |
| 判读补充 | 复合量恒报告不作通道 | 操纵诊断增补：truncation / top-k、unanchored 计数、每 run `write_lesson` 次数、（若 M3）ctx7 计数 |

**明确**：本版**不**作废 v0.4；v0.4 的仪器验收记录（2026-07-28）对继承条款保持有效，但供给 v2 新增面须按 §8 完成门补验。

---

## 1. 目标与假设（继承 v0.4）

实验只允许跨题传递记忆，不允许传递代码、worktree、测试产物或其他任务状态。每个 SWE-bench instance 从冻结的 `base_commit` 建立全新干净 worktree。

- **H1（主）**：在记忆池完全相同的条件下，直接按需召回合格 lesson 的 A-L 臂，在族内第 2 题的 resolved 结果上优于 B 臂。
- **H1-K（次）**：保留现行成熟度准入的 A-K 臂相对 B 臂是否产生方向性改善，并与 A-L 比较准入延迟的代价。

**H2（全量常驻 vs 按需召回）本版继续搁置**：供给 v2 的不限量写入使「合格池 > 5」在结构上可达（v0.4 搁置理由之一因此部分解除），但 v0.4 理由 2（常驻 / 提示词格式 / citation 三变量耦合，差异无法单独归因）未解决，且现行仪器对 C 臂 CLI 保持拒绝。H2 留待能单独隔离常驻变量的后版；本版不得用池变大事后补跑 C 臂。

样本量小，所有结论只写「方向性证据，非统计显著」；本版明确不作统计推断。

### 1.1 v0.5 供给变化下的预期（新增，不改 H 编号）

- lesson **写入不设条数上限** → 合格池可显著大于 v0.4 模板路径 → **standard tier top-3 截断**与 **[ADR-005](../adr/ADR-005-recall-ranking-protocol.md) 排序**成为必须报告的活变量（操纵诊断必含 truncation / rank 信号）。
- 对比式经验正文（错因 / 修法 / 路径差）替代症状复读载荷，预期改变 A-L 注入的语义密度；此为系统变化，预先声明，不作事后解释（`per ExpeL-2308.10144`）。

---

## 2. 三臂（继承 v0.4）

| 臂 | 代号 | 注入定义 |
|----|------|----------|
| A-L | `lesson-recall` | 仅从本臂本族此前 resolved run 的主 lesson 中按需排序召回；不注入 knack 或其他记忆类型 |
| A-K | `knack-recall` | 仅召回由合格 lesson 按现行 breaker / harness-strong 规则晋升的 knack；不放宽晋升或 ranking 规则 |
| B | `off` | 与其他臂使用相同 context-runtime 组装，学习照常写入，但记忆注入为空 |

三臂的模型、接入、采样、题序、非记忆上下文和学习管线一致，唯一差异是上表的记忆注入策略。

### 2.1 可注入记忆的闭集（继承 v0.4，补供给措辞）

- 只允许 `lesson` 或由其晋升的 `knack`；preferences、历史任务快照、run archive、artifact refs、doc findings 全文等不得进入提示词。
- lesson 必须来自当前 family 的种子题或本臂此前的 resolved run，`quality=high`、未 archived，且来源 run 经钉死的官方 harness 判为 `resolved=true`。
- **`ephemeral/lessons.jsonl` 永不注入**（含 v0.5 审计失败的 unanchored 条目）。
- A-L 使用现行基础相关性评分、`doNotApplyWhen` 和 standard tier 的数量/token 上限；同分时按 `updatedAt` 降序、ID 升序固定。排序协议以 ADR-005 为准。
- A-K 继续使用现行 breaker 和 knack ranking；来源 lesson 未通过 harness 准入的 knack 不合格。
- lesson 晋升后，A-L 仍只渲染 lesson 一次；A-K 只渲染 knack，禁止双份注入。
- **v0.5 渲染语义（供给 v2，与实现一致）**：注入优先渲染 `cause` / `fixPattern` / `doNotApplyWhen` / `docRefs`（ctx7 library+topic **指针**，禁止文档正文）；`symptomKeys` 与原始错误串只参与召回匹配，**不作为注入载荷**。

### 2.2 harness-strong 出生规则（继承 v0.4 · BUG-015 语义不动）

- **晋升**：harness 判 `resolved=true`（reward=1）后，由 `promoteRunLessonsAfterHarness` 将该 run 在线出生的 candidate lesson 晋升为 `verified`；`resolved=false` 则该 run 的 lesson/knack 永久不准入。
- **harness-strong**：已由 harness reward=1 盖上 `promotedAt` 的 verified lesson，免除「同类信号 ≥2 次」的重复要求，**单次直升 knack**（经 `promoteHarnessEligibleLessons`）。无 harness 的生产态仍走重复规则。
- **BUG-015 盖章语义（继承，不动）**：`promoteCandidatesForRun` 按 `promotedAt` 是否为空盖章——`candidate` 升 `verified` 并盖章，模板路径 `streamVerified` 出生即 `verified` 的补盖章，已盖章的幂等跳过。
- **离线蒸馏器**：确定性蒸馏器（`knack-distillation.ts` 等）保持 audit-only，**不写主库**。
- **对 A-K 的系统影响（v0.5 声明）**：A-K 注入内容来自 agent 自写、经审计锚定、再经 harness-strong 直升的 knack；出生率与措辞与 v0.4 模板路径系统性不同。此差异预先声明，不作事后解释。

`per AEvo-2605.13821`：evaluator 与 agent 保持隔离——harness 的测试名、日志和详细报告只作审计产物，不进入 memory root 或模型上下文；管线只消费 resolved 布尔值。

---

## 3. 供给管线 v2（本版新增核心）

### 3.1 写入路径

1. **Agent 自写**：系统提示指示 agent 在「先错后改对」（含无报错但走弯路）时调用 `write_lesson`，**不限次数**。写入不限量；注入靠准入、晋升与 top-k。
2. **证据锚定（审计员）**：`write_lesson` 必须引用轨迹证据三元组：
   - `errorToolCallId`
   - `fixToolCallIds[]`
   - `verificationToolCallId`  
   现有 `findCausalPair` 系逻辑降职为**审计员**：核验引用事件真实存在、错误事件真实为错误、验证事件真实转绿。
3. **出生置信度**：模型所写 lesson **一律** `candidate`。
4. **未锚定隔离**：审计失败 → `audit=unanchored` → 写入 `ephemeral/lessons.jsonl`（或等价隔离语义），**永不注入**，不入主库候选池。
5. **Harness 晋升链不变**：`promoteRunLessonsAfterHarness` / `promoteHarnessEligibleLessons` 及 BUG-015 `promotedAt` 盖章语义**一字不动**。
6. **AEvo 隔离（继承并强调）**：`write_lesson`、提示指令、lesson 正文与 `docRefs` **不得**引用 harness 内部产物（测试名、判分日志、详细 harness 报告）。

### 3.2 写入指令（冻结用逐字正文 · 中文）

以下段落为预注册**逐字冻结正文**；实现侧提示常量须与此一致（快照测试守护）。**冻结后仍不得点火，须作者另行回复「点火」。**

> 每当你发现自己先做错了、之后又改对了（包括没有报错但走了弯路的情况），立即调用 write_lesson 记录：哪步错了、真正的成因、后来用什么方法改对、错误路径和正确路径的差异。查过文档就带上文档索引。不限次数。

### 3.3 文档索引（M3 相关 · 指针不进正文）

- `docRefs` 仅存 ctx7 的 `library` + `topic` 指针，**禁止**把文档正文写入 lesson 或注入段。
- 若 M3 启用：eval 运行时提供常规 `context7_query`（或等价）文档查询；查询失败**确定性降级为无文档**，不得使 run invalid；run summary 记 `ctx7Calls` / `ctx7Failures`。

---

## 4. 共享种子题与两阶段执行（继承 v0.4）

每族第 1 题为**种子题，全族只运行一次**：种子 run 使用 `injectionMode: 'off'`、独立 memory root，判分与准入流程与正式 run 完全一致；种子 memory root 在臂阶段开始前**整体复制**给每个臂。三臂进入第 2 题时记忆池**完全相同**，第 2 题是本实验唯一无混淆的注入对照；第 3 题为条件性/探索性指标，不进主判读。

### 4.1 种子门（阶段 A）

三族各运行 1 个种子 run。种子 `resolved=false` → 该族对主分析作废，禁止解释为「注入无效」；可用族 ≤1 → 停跑，如实记「题库无法产生注入对照」。阶段 B 在该族种子 `resolved=false` 时由仪器层拒绝启动。

### 4.2 臂阶段（阶段 B）

对每个可用族，三臂各运行第 2、3 题（每族 6 run），串行流程与 v0.4 完全一致（复制种子 memory root 并验证一致性 → 冻结 `base_commit` 新 worktree → 注入快照 → 判分 → 准入 → 晋升）。`resolved=false` 是合法结果：不补种、不重跑，该 run 的 lesson/knack 永久不准入。

**v0.5 补充**：run 内 `write_lesson` 产生的 unanchored 条目只进 ephemeral，不影响 resolved 判分；不得因 unanchored 数量作废 run。

### 4.3 预算（继承 v0.4）

| 情形 | run 数 |
|------|--------|
| 三族种子全过 | 3 + 3×6 = 21 |
| 两族种子过 | 3 + 2×6 = 15 |
| ≤1 族种子过 | 3，停跑并如实记录 |

上限 ≤24 run。

### 4.4 已实装行为的显式声明（继承 v0.4）

- **空 patch**：计 `resolved=false`、跳过 harness 判分，`admission.json` 须带 `harnessSkipped.reason = empty_patch_counted_unresolved`；该 run 的 lesson/knack 永久不准入。
- **断点续跑**：允许 `--resume-from-task` 且必须在批次 manifest 留痕；只重放空 patch run 的收尾登记（按 runId 幂等），不得重跑已判分题、不得改动既有判分、不得重置 memory root。

---

## 5. 模型、采样与快照（继承 v0.4）

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
- harness Python 与本地 snapshot manifest 必须由点火命令显式提供；runner 不设默认路径并逐题复验 SHA。
- 种子 run 与臂 run 使用同一组冻结采样值，不得分别设置。

> 代码基线：v0.4 仪器验收于 `3cb5aa36`（本分支 cherry-pick 为 `8dda2f4b`）。v0.5 冻结基线 `8dda2f4b`（`feat/lesson-authoring-v2`，含供给 v2 实现）。正式点火前仍须仪器门禁全绿，且作者另行回复「点火」。

---

## 6. 指标与判读（继承 v0.4 + 补充）

主分析只看每个可用族的**第 2 题**——该题是三臂记忆池相同的唯一位置。

| 类型 | 定义 |
|------|------|
| 主 | 每个可用族在第 2 题上 A-L 与 B 的 resolved 配对结果；逐族原样列出三臂结果，并给出跨族符号计数 |
| 次 | A-K vs B 同结构配对；A-L vs A-K 的 resolved 与准入延迟代价 |
| 条件性 | 第 3 题各臂 resolved，单独成节，只作探索性描述 |
| 操纵诊断 | 合格 lesson 数、合格 knack 数、注入数、空召回率、`used_recall`、升级阶梯、总/注入 token、错误类型分布；**v0.5 增补**：truncation / top-k 命中与否、unanchored 计数、每 run `write_lesson` 次数、（若 M3）`ctx7Calls`/`ctx7Failures`。只报告，不作判读通道，不作排除条件 |

判读纪律（继承 v0.4）：**不作统计推断**；**单一主通道**（只有第 2 题 resolved 配对构成 H1 判读通道，不设「阶梯少 30%」等 OR 通道）；`[[used_recall:<id>]]` 只记不评分。

### 6.1 异常纪律（继承 v0.4）

限流、provider 格式异常、harness 歧义或审计产物缺失均停跑报告；禁止现场修改设计救批。种子门判为不可用的族不得事后改判、不得换题重试。

### 6.2 AOT vs JIT 文档读法（若 M3 启用 · `per GAM-2511.18423`）

GAM 区分 **AOT（Ahead-of-Time）** 预压缩记忆服务请求，与 **JIT（Just-in-Time）** 运行时再检索。映射到本仓库（不另起实验臂，仅作操纵/机制诊断框架）：

| 读法 | 本仓库操作化 | 观察什么 |
|------|----------------|----------|
| **AOT** | 前序 run 已写入 lesson 的**文档结论/指针**（`docRefs`；lesson 正文中已提炼的文档相关 cause/fix）在后续题被注入后**直接使用**，不再查 ctx7 | 注入后同库文档类错误是否减少；是否出现过时指针误用 |
| **JIT** | 当轮任务对 ctx7 **现查**（`context7_query`），以当轮返回为准 | `ctx7Calls` 是否与 resolved/升级阶梯共变 |

- **预声明**：本框架用于分解「记住的文档结论」vs「每次重查」的贡献，**不是**第四臂；不改变 §2 三臂定义。
- 若 M3 **未**启用：本节整节标 N/A，不得用缺失 ctx7 数据事后编造 AOT/JIT 结论。

---

## 7. 附录 A：冻结题序（继承 v0.4）

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

`F-DJ-INHERITANCE-PREDICATE` 记为储备族，其三题尚未并入冻结输入，本版不启用（可用族 ≤1 时直接停跑，本版无替补机制）。

题序按冻结快照 `created_at` 升序；污染排除和候选依据沿用[候选筛查表](./injection-effect-task-families.md)，不得换题或重排。

---

## 8. 审计产物与完成门（继承 v0.4 + v0.5 补充）

每 run 必须落：trace、events、注入快照、prediction、官方 harness 报告（空 patch run 例外，须改落 `harnessSkipped`）、admission 报告、注入前后 memory inventory。种子阶段另须落种子 memory root inventory 与复制后各臂 inventory 一致性校验结果。  
**v0.5 另须**：`write_lesson` 调用记录、审计结果（anchored/unanchored）、ephemeral 增量、（若 M3）`ctx7Calls`/`ctx7Failures`。

批次 manifest 必须记录当前代码 commit、**本预注册文档的 sha256**、预注册文档版本、数据 SHA、arm/family、模型与采样、以及是否为续跑。

正式点火前必须通过：三臂差异单测、种子共享与复制一致性单测、种子 unresolved 时臂阶段拒绝启动、resolved/unresolved 双题无模型回放、跨臂/跨族/ephemeral/历史记忆防泄漏测试、P3 lesson/knack citation 测试、全量测试、构建，以及旧 resolved prediction 的官方 harness 判分烟测；**外加**供给 v2 相关单测（锚定/隔离/指令快照/渲染不含原始错误串正文）。全部通过后仍需作者另行明确回复「点火」。

runner 收到本任务单**不等于**已点火。**已冻结 ≠ 已点火。**

---

## 9. 批准 / 冻结栏

- 作者批准冻结：☑ 2026-08-14 / 作者明确回复「冻结」
- 基线勘误：☑ 2026-08-14 / 初稿基线 `17ce4e67` 继承 v0.3 有误（分支当时缺 v0.4 文件）；cherry-pick `8dda2f4b` 后当日修正为继承 v0.4，冻结批复沿用，实验设计以本文本为准
- 陪审知悉：□ 日期 ____
- 作废重开：□ 理由 ____ / 新版路径 ____
- **现行状态**：**已冻结，禁止点火** · 须作者另行回复「点火」才可跑正式批

（v0.4 验收记录见 [v0.4 完成门](./injection-effect-experiment-prereg-v0.4.md)；本版不覆盖、不撤销。）
