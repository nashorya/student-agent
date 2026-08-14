# 预注册：注入效果实验 v0.5（供给管线 v2）

状态：**已冻结（2026-08-14，作者明确回复「冻结」）；禁止点火。仪器门禁全绿且作者另行回复「点火」前，禁止运行正式题**

| 字段 | 值 |
|------|-----|
| finding | `finding:injection-effect-experiment-v0.5` |
| 前版 | [v0.3（已冻结 2026-07-27；本版不宣布其作废）](./injection-effect-experiment-prereg-v0.3.md) |
| 版本 | **v0.5** · 2026-08-14 |
| 代码基线 | `17ce4e67`（`feat/lesson-authoring-v2`，供给 v2 实现 + INDEX 落痕） |
| 冻结规则 | 作者批准冻结后，任何设计变化均须作废重开；**冻结 ≠ 点火** |
| 继承说明 | 仓库内**无 v0.4 预注册文件**；`plan-lesson-authoring-v2` 文案曾写「继承 v0.4」，本版实际继承最新已冻结版 **v0.3**，并注明该缺口 |
| 本版边界 | **已冻结、仍禁止点火**；不跑三臂/四臂；runner 收到本文件 ≠ 已点火 |

> **落痕**：供给与对比式经验写作 `per ExpeL-2308.10144`；M3 启用时 AOT vs JIT 文档读法 `per GAM-2511.18423`。

---

## 0. 相对 v0.3 的变更摘要

v0.3 已冻结的操作条款（四臂、H1/H2、harness-strong、AEvo 隔离、memory 隔离、样本规则、模型/采样表、族序）**全部继承，不静默删除**。本版仅新增/改写与 **lesson 出生供给管线 v2** 相关的条款：

| 主题 | v0.3 | v0.5 |
|------|------|-----------|
| lesson 出生 | ReflectAgent / 在线结构化 lesson（`Symptom:… Fix:…`）等既有路径 | Agent 经 `write_lesson` 自判自写；审计员锚定证据 |
| 出生置信度 | run 内一律 `candidate`（已预声明） | 模型所写 lesson **一律** `candidate`；未锚定 → ephemeral，永不注入 |
| 写入上限 | （隐含管线产出量） | **写入不限次数**；注入仍靠准入/晋升/top-k 挡水 |
| 晋升链 | `promoteRunLessonsAfterHarness` / harness-strong / `promoteHarnessEligibleLessons` | **一字不动**（BUG-015 盖章语义） |
| 判读补充 | H1/H2 操纵诊断 | 池变大 → top-3 / ADR-005 成活变量；池 >5 时 H2 具备复活条件；M3 时 AOT vs JIT 读法 |

**明确**：本版**不**作废 v0.3；v0.3 结果与冻结状态保持有效。v0.5 自身已冻结；再改须作废重开。

---

## 1. 目标与假设（继承 v0.3）

实验只允许跨题传递记忆，不允许传递代码、worktree、测试产物或其他任务状态。每个 SWE-bench instance 从冻结的 `base_commit` 建立全新干净 worktree。

- **H1（主）**：直接按需召回合格 lesson 的 A-L 臂，在族内第 2、3 题的 resolved 数或升级阶梯次数上优于 B 臂。
- **H1-K（次）**：保留现行成熟度准入的 A-K 臂相对 B 臂是否产生方向性改善，并与 A-L 比较准入延迟的代价。
- **H2**：全量常驻合格 lesson 的 C 臂不优于 A-L，且注入 token 成本更高。

样本量小，所有结论只写“方向性证据，非统计显著”。

### 1.1 v0.5 供给变化下的预期（新增，不改 H 编号）

- lesson **写入不设条数上限** → 合格池可显著大于 v0.3 模板/在线结构化路径 → **standard tier top-3 截断**与 **[ADR-005](../adr/ADR-005-recall-ranking-protocol.md) 排序**成为必须报告的活变量（操纵诊断必含 truncation / rank 信号）。
- 当本臂本族合格主 lesson 池 **> 5** 时，H2（C 常驻 vs A-L 召回）具备**复活/可分辨条件**：池过小时 C 与 A-L 注入集几乎重合，H2 无法检验；池变大后 token 成本差与截断差才可观测。
- 对比式经验正文（错因 / 修法 / 路径差）替代症状复读载荷，预期改变 A-L 注入的语义密度；此为系统变化，预先声明，不作事后解释（`per ExpeL-2308.10144`）。

---

## 2. 四臂（继承 v0.3）

| 臂 | 代号 | 注入定义 |
|----|------|----------|
| A-L | `lesson-recall` | 仅从本臂本族此前 resolved run 的主 lesson 中按需排序召回；不注入 knack 或其他记忆类型 |
| A-K | `knack-recall` | 仅召回由合格 lesson 按现行 breaker / harness-strong 规则晋升的 knack；不放宽晋升或 ranking 规则 |
| B | `off` | 与其他臂使用相同 context-runtime 组装，学习照常写入，但记忆注入为空 |
| C | `lesson-full` | 本臂本族此前 resolved run 的全部主 lesson 常驻；不排序、不做成熟度筛选 |

四臂的模型、接入、采样、题序、非记忆上下文和学习管线一致，唯一差异是上表的记忆注入策略。

### 2.1 可注入记忆的闭集（继承 v0.3，补供给措辞）

- 只允许 `lesson` 或由其晋升的 `knack`；preferences、历史任务快照、run archive、artifact refs、doc findings 全文等不得进入提示词。
- lesson 必须来自当前 arm/family、`quality=high`、未 archived，且来源 run 经钉死的官方 harness 判为 `resolved=true`。
- **`ephemeral/lessons.jsonl` 永不注入**（含 v0.5 审计失败的 unanchored 条目）。C 的“全量”指上述合格主 lesson 的全集。
- A-L 使用现行基础相关性评分、`doNotApplyWhen` 和 standard tier 的数量/token 上限；同分时按 `updatedAt` 降序、ID 升序固定。排序协议以 ADR-005 为准（knack 专用 tuple；lesson 走 kind 对应规则与 tier top-k）。
- A-K 继续使用现行 breaker 和 knack ranking；来源 lesson 未通过 harness 准入的 knack 不合格。
- lesson 晋升后，A-L/C 仍只渲染 lesson 一次；A-K 只渲染 knack，禁止双份注入。
- **v0.5 渲染语义（供给 v2，与实现一致）**：注入优先渲染 `cause` / `fixPattern` / `doNotApplyWhen` / `docRefs`（ctx7 library+topic **指针**，禁止文档正文）；`symptomKeys` 与原始错误串只参与召回匹配，**不作为注入载荷**。

### 2.2 harness-strong 出生规则（继承 v0.3 · BUG-015 语义不动）

- **晋升**：harness 判 `resolved=true`（reward=1）后，由 `promoteRunLessonsAfterHarness` 将该 run 在线出生的 candidate lesson 晋升为 `verified`；`resolved=false` 则该 run 的 lesson/knack 永久不准入。
- **harness-strong**：已由 harness reward=1 晋升为 verified 的 lesson，免除「同类信号 ≥2 次」的重复要求，**单次直升 knack**（经 `promoteHarnessEligibleLessons`）。无 harness 的生产态仍走重复规则。时序保持延迟晋升：run 内一律 candidate，不在 run 内写主库 knack。
- **离线蒸馏器**：确定性蒸馏器（`knack-distillation.ts` 等）保持 audit-only，**不再写主库**（与 v0.3 / BUG-014 一致）。
- **对 A-K 的系统影响（v0.5 再声明）**：A-K 注入内容来自 agent 自写、经审计锚定、再经 harness-strong 直升的 knack；出生率、措辞与 v0.3 在线 `Symptom:… Fix:…` 路径系统性不同。此差异预先声明，不作事后解释。

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
6. **AEvo 隔离（继承并强调）**：`write_lesson`、提示指令、lesson 正文与 `docRefs` **不得**引用 harness 内部产物（测试名、判分日志、详细 harness 报告）。harness 产物只作审计，不进 memory root 或模型上下文；管线只消费 resolved 布尔值。

### 3.2 写入指令（冻结用逐字正文 · 中文）

以下段落为预注册**逐字冻结正文**；实现侧提示常量须与此一致（快照测试守护）。**冻结后仍不得点火，须作者另行回复「点火」。**

> 每当你发现自己先做错了、之后又改对了（包括没有报错但走了弯路的情况），立即调用 write_lesson 记录：哪步错了、真正的成因、后来用什么方法改对、错误路径和正确路径的差异。查过文档就带上文档索引。不限次数。

### 3.3 文档索引（M3 相关 · 指针不进正文）

- `docRefs` 仅存 ctx7 的 `library` + `topic` 指针，**禁止**把文档正文写入 lesson 或注入段。
- 若 M3 启用：eval 运行时提供常规 `context7_query`（或等价）文档查询；查询失败**确定性降级为无文档**，不得使 run invalid；run summary 记 `ctx7Calls` / `ctx7Failures`。

---

## 4. 串行执行与准入（继承 v0.3）

每臂每族使用独立 memory root，族开始时重置为空；三题按附录 A 顺序串行：

1. 从当前 instance 的冻结 `base_commit` 创建新 worktree，并验证初始 HEAD 与工作树洁净。
2. 从本臂本族前序合格记忆组装提示，落 injection 快照后运行 agent。
3. 落 patch、trace、events、prediction；不得把 worktree 或 diff 带入下一题。
4. 立即用冻结数据快照和官方 SWE-bench harness 单实例判分。
5. harness 进程非零、报告缺失或快照不符属于仪器异常，整批停跑保留现场。
6. `resolved=false` 是合法结果：继续下一题，但该 run 的 lesson/knack 永久不准入，不补种、不重跑。
7. `resolved=true` 后才登记准入；由 `promoteRunLessonsAfterHarness` 晋升该 run 在线出生的 lesson（reward=1 → verified）。晋升为空只记原因，禁止 synthetic fallback，禁止回退到离线确定性蒸馏器写主库。
8. 对已准入（verified）lesson 执行现行 knack 晋升（含 harness-strong 单次直升），再开始下一题。第 3 题完成后仍照常归档/晋升，但不跨族使用。

harness 的测试名、日志和详细报告只作审计产物，不进入 memory root 或模型上下文；管线只消费 resolved 布尔值。

**v0.5 补充**：run 内 `write_lesson` 产生的 unanchored 条目只进 ephemeral，不影响 resolved 判分；不得因 unanchored 数量作废 run。

---

## 5. 模型、采样与快照（继承 v0.3）

| 参数 | 四臂冻结值 |
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

> 代码基线：v0.3 冻结于 `f032b71e`。v0.5 冻结于 `17ce4e67`（`feat/lesson-authoring-v2`，含供给 v2 实现）。正式点火前仍须仪器门禁全绿，且作者另行回复「点火」。

---

## 6. 指标与判读（继承 v0.3 + 补充）

主分析只看每族第 2、3 题：

| 类型 | 定义 |
|------|------|
| 主 | A-L 与 B 的 resolved 数；A-L > B 至少 1 题或升级阶梯触发少至少 30%即方向支持 H1 |
| 次 | A-K vs B、A-L vs A-K 的 resolved 与升级阶梯次数 |
| H2 | C ≤ A-L 且 C 的实际注入/token 成本 > A-L；**当合格主 lesson 池 > 5 时优先报告 H2，池 ≤ 5 时注明 H2 低分辨力** |
| 操纵诊断 | 合格 lesson 数、合格 knack 数、注入数、空召回率、`used_recall`、**truncation / top-k 命中与否**、**unanchored 计数**、**每 run `write_lesson` 次数**；只报告，不作排除条件 |

`[[used_recall:<id>]]` 对 A-L lesson 与 A-K knack 均记入 trace，只记不评分。C resident 不使用 recall citation。

### 6.1 中期换族与异常纪律（继承 v0.3）

- Django 正式族 12 run（3 题 × 4 臂）完成后立即判读。
- 仅当四臂在第 2、3 题全部为 0 resolved，才判题库全族过难并启用替补；单臂全灭不得换族。
- 换族时该正式族全部作废，替补族四臂从空 memory root 重跑一次；替补仍全灭则如实记“题库无法分辨”。
- 未触发或替补检查完成后，才允许运行 SymPy 族。
- 限流、provider 格式异常、harness 歧义或审计产物缺失均停跑报告；禁止现场修改设计救批。

### 6.2 AOT vs JIT 文档读法（若 M3 启用 · `per GAM-2511.18423`）

GAM 区分 **AOT（Ahead-of-Time）** 预压缩记忆服务请求，与 **JIT（Just-in-Time）** 运行时在轻量索引引导下对完整源再检索/整合。映射到本仓库术语（不另起实验臂，仅作操纵/机制诊断框架）：

| 读法 | 本仓库操作化 | 观察什么 |
|------|----------------|----------|
| **AOT** | 前序 run 已写入 lesson 的 **文档结论/指针**（`docRefs` library+topic；以及 lesson 正文中已提炼的文档相关 cause/fix）在后续题被注入后**直接使用**，不再查 ctx7 | 注入后同库文档类错误是否减少；是否出现过时指针导致的误用 |
| **JIT** | 当轮任务对 ctx7 **现查**（`context7_query` / 等价 runtime 文档工具），以当轮返回为准 | `ctx7Calls` 是否与 resolved/升级阶梯共变；无注入时 JIT 是否可部分替代记忆 |

- **预声明**：本框架用于解释「记住的文档结论」vs「每次重查」的贡献分解，**不是**第五臂；不改变 §2 四臂定义。
- AOT 压缩有信息损失、JIT 按需检索更贴请求（GAM 动机）；本实验只报告方向性共变，不声称复现 GAM 基准。
- 若 M3 **未**启用：本节整节标 N/A，不得用缺失 ctx7 数据事后编造 AOT/JIT 结论。

---

## 7. 附录 A：冻结题序（继承 v0.3）

| 族 | 顺序 | instance_id |
|----|------|-------------|
| `F-DJ-MIGRATION-REFERENCE` | 1 | `django__django-12125` |
|  | 2 | `django__django-14580` |
|  | 3 | `django__django-17087` |
| `F-SY-UNIT-EQUIVALENCE` | 1 | `sympy__sympy-20442` |
|  | 2 | `sympy__sympy-24066` |
|  | 3 | `sympy__sympy-24213` |

替补仅在上述全族全灭规则触发后启用：

| 替补族 | 顺序 | instance_id |
|--------|------|-------------|
| `F-DJ-SELECT-MASK` | 1 | `django__django-14667` |
|  | 2 | `django__django-15814` |
|  | 3 | `django__django-16910` |

题序按冻结快照 `created_at` 升序；污染排除和候选依据沿用[候选筛查表](./injection-effect-task-families.md)，不得换题或重排。

---

## 8. 审计产物与完成门（继承 v0.3 + v0.5 补充）

每 run 必须落：trace、events、注入快照、prediction、官方 harness 报告、admission 报告、注入前后 memory inventory。  
**v0.5 另须**：`write_lesson` 调用记录、审计结果（anchored/unanchored）、ephemeral 增量、（若 M3）`ctx7Calls`/`ctx7Failures`。

批次 manifest 必须记录当前代码 commit、预注册文档版本、数据 SHA、arm/family、模型与采样。

正式点火前必须通过：四臂差异单测、resolved/unresolved 双题无模型回放、跨臂/跨族/ephemeral/历史记忆防泄漏测试、P3 lesson/knack citation 测试、全量测试、构建，以及旧 resolved prediction 的官方 harness 判分烟测；**外加**供给 v2 相关单测（锚定/隔离/指令快照/渲染不含原始错误串正文）。全部通过后仍需作者另行明确回复「点火」。

runner 收到本任务单**不等于**已点火。阶段 0（本预注册冻结 + 作者「点火」）未完成前，只允许 `--dry-run` 与文书审阅。**已冻结 ≠ 已点火。**

---

## 9. 批准 / 冻结栏

- 作者批准冻结：☑ 2026-08-14 / 作者明确回复「冻结」（代码基线 `17ce4e67`，分支 `feat/lesson-authoring-v2`）
- 陪审知悉：□ 日期 ____
- 作废重开：□ 理由 ____ / 新版路径 ____
- **现行状态**：**已冻结，禁止点火** · 不跑三臂/四臂 · 须作者另行回复「点火」才可跑正式批

（v0.3 冻结记录仍见 [v0.3 批准栏](./injection-effect-experiment-prereg-v0.3.md)；本版不覆盖、不撤销。）
