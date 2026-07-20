# 预注册：注入效果实验 v0.2（四臂纯记忆迁移）

状态：**待作者批准冻结；冻结前及仪器全绿前禁止运行正式题**

| 字段 | 值 |
|------|-----|
| finding | `finding:injection-effect-experiment-v0.2` |
| 前版 | [v0.1.1（已作废，禁止并入结果）](./injection-effect-experiment-prereg-v0.md) |
| 版本 | **v0.2** · 2026-07-20 |
| 冻结规则 | 作者批准后合并本预注册即冻结；任何设计变化均须再次作废重开 |

## 目标与假设

实验只允许跨题传递记忆，不允许传递代码、worktree、测试产物或其他任务状态。每个 SWE-bench instance 从冻结的 `base_commit` 建立全新干净 worktree。

- **H1（主）**：直接按需召回合格 lesson 的 A-L 臂，在族内第 2、3 题的 resolved 数或升级阶梯次数上优于 B 臂。
- **H1-K（次）**：保留现行成熟度准入的 A-K 臂相对 B 臂是否产生方向性改善，并与 A-L 比较准入延迟的代价。
- **H2**：全量常驻合格 lesson 的 C 臂不优于 A-L，且注入 token 成本更高。

样本量小，所有结论只写“方向性证据，非统计显著”。

## 四臂

| 臂 | 代号 | 注入定义 |
|----|------|----------|
| A-L | `lesson-recall` | 仅从本臂本族此前 resolved run 的主 lesson 中按需排序召回；不注入 knack 或其他记忆类型 |
| A-K | `knack-recall` | 仅召回由合格 lesson 按现行 breaker 晋升的 knack；不放宽晋升或 ranking 规则 |
| B | `off` | 与其他臂使用相同 context-runtime 组装，学习照常写入，但记忆注入为空 |
| C | `lesson-full` | 本臂本族此前 resolved run 的全部主 lesson 常驻；不排序、不做成熟度筛选 |

四臂的模型、接入、采样、题序、非记忆上下文和学习管线一致，唯一差异是上表的记忆注入策略。

### 可注入记忆的闭集

- 只允许 `lesson` 或由其晋升的 `knack`；preferences、历史任务快照、run archive、artifact refs、doc findings 等不得进入提示词。
- lesson 必须来自当前 arm/family，`quality=high`、未 archived，且来源 run 经钉死的官方 harness 判为 `resolved=true`。
- `ephemeral/lessons.jsonl` 永不注入。C 的“全量”指上述合格主 lesson 的全集。
- A-L 使用现行基础相关性评分、`doNotApplyWhen` 和 standard tier 的数量/token 上限；同分时按 `updatedAt` 降序、ID 升序固定。
- A-K 继续使用现行 breaker 和 knack ranking；来源 lesson 未通过 harness 准入的 knack 不合格。
- lesson 晋升后，A-L/C 仍只渲染 lesson 一次；A-K 只渲染 knack，禁止双份注入。

## 串行执行与准入

每臂每族使用独立 memory root，族开始时重置为空；三题按附录 A 顺序串行：

1. 从当前 instance 的冻结 `base_commit` 创建新 worktree，并验证初始 HEAD 与工作树洁净。
2. 从本臂本族前序合格记忆组装提示，落 injection 快照后运行 agent。
3. 落 patch、trace、events、prediction；不得把 worktree 或 diff 带入下一题。
4. 立即用冻结数据快照和官方 SWE-bench harness 单实例判分。
5. harness 进程非零、报告缺失或快照不符属于仪器异常，整批停跑保留现场。
6. `resolved=false` 是合法结果：继续下一题，但该 run 的 lesson/knack 永久不准入，不补种、不重跑。
7. `resolved=true` 后才登记准入；用 issue 文本、最终总结、实际 trace events 和 harness reward 运行既有确定性蒸馏器。蒸馏为空只记原因，禁止 synthetic fallback。
8. 对已准入 lesson 执行现行 knack 晋升，再开始下一题。第 3 题完成后仍照常归档/蒸馏，但不跨族使用。

harness 的测试名、日志和详细报告只作审计产物，不进入 memory root 或模型上下文；管线只消费 resolved 布尔值。

## 模型、采样与快照

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

## 指标与判读

主分析只看每族第 2、3 题：

| 类型 | 定义 |
|------|------|
| 主 | A-L 与 B 的 resolved 数；A-L > B 至少 1 题或升级阶梯触发少至少 30%即方向支持 H1 |
| 次 | A-K vs B、A-L vs A-K 的 resolved 与升级阶梯次数 |
| H2 | C ≤ A-L 且 C 的实际注入/token 成本 > A-L |
| 操纵诊断 | 合格 lesson 数、合格 knack 数、注入数、空召回率、`used_recall`；只报告，不作排除条件 |

`[[used_recall:<id>]]` 对 A-L lesson 与 A-K knack 均记入 trace，只记不评分。C resident 不使用 recall citation。

### 中期换族与异常纪律

- Django 正式族 12 run（3 题 × 4 臂）完成后立即判读。
- 仅当四臂在第 2、3 题全部为 0 resolved，才判题库全族过难并启用替补；单臂全灭不得换族。
- 换族时该正式族全部作废，替补族四臂从空 memory root 重跑一次；替补仍全灭则如实记“题库无法分辨”。
- 未触发或替补检查完成后，才允许运行 SymPy 族。
- 限流、provider 格式异常、harness 歧义或审计产物缺失均停跑报告；禁止现场修改设计救批。

## 附录 A：冻结题序

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

## 审计产物与完成门

每 run 必须落：trace、events、注入快照、prediction、官方 harness 报告、distillation/admission 报告、注入前后 memory inventory。批次 manifest 必须记录当前代码 commit、文档版本、数据 SHA、arm/family、模型与采样。

正式点火前必须通过：四臂差异单测、resolved/unresolved 双题无模型回放、跨臂/跨族/ephemeral/历史记忆防泄漏测试、P3 lesson/knack citation 测试、全量测试、构建，以及旧 resolved prediction 的官方判分烟测。全部通过后仍需作者另行明确回复“点火”。

## 批准 / 冻结栏

- 作者批准合并（冻结）：□ 日期 ____ / PR ____
- 陪审知悉：□ 日期 ____
- 作废重开：□ 理由 ____ / 新版路径 ____
