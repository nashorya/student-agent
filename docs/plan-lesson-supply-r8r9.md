# 修改要求：lesson 供给链 R8/R9（v0.5 正式轮复盘产物）

状态：待执行 · 2026-08-15 · 基线 `feat/lesson-authoring-v2`

背景一句话：v0.5 正式轮（14 run，glm-5.3 + thinking 全程确认）证明 R1/R2 生效——`write_lesson` 从 0 次变成 16 次，且模型写的 lesson 内容质量很高；但**零有效注入**，供给链在最后两环双断：

1. 模型 lesson 5/5 被审计拒收进隔离区（`unanchored` → ephemeral）。不是模型偷懒：真实 `toolCallId`（`call_xxx` 格式）只存在于事件日志的 `metadata.evidenceRef`，**模型视野里根本没有**，它只能编造（实录 `bash-run-repro-1/2/3`）或干脆不填 evidence。审计按规矩全拒，无冤案，但等于要求模型引用一个它看不见的东西——设计缺陷。
2. 隐式模板管线还活着，其症状复读式 lesson（`fixSummary` 为 "Patch status. The repository has a valid git diff..." 一类废话）靠机器证据过审晋升，占据主库与 knack 出生权；新渲染语义下无 `cause`/`fixPattern` 渲染为空，被 R3 过滤 → A-L 臂零注入。它繁殖的 knack（同样正文）注入 A-K 后被模型正确无视（`used_recall` 全空）。

证据存档：`.scratch/v05-final/`（种子 lesson 全字段、ephemeral 5 条、三臂 injection.txt 对比、events.jsonl id 格式）。

本单只修供给侧，**不动晋升链语义，不点火任何批次**。

## R8 · evidence 改为运行时签发弧线句柄，机械附着（核心）

- 现状：`write-lesson-tool.ts` 的 schema 要求模型自填 `errorToolCallId` / `fixToolCallIds` / `verificationToolCallId`（真实 id），模型不可见 → 必然编造或留空。
- 要求：
  1. `detectWriteLessonArc` 命中弧线时**签发短句柄** `arcId`（如 `arc-1` 起递增，run 内唯一），session 侧维护弧线注册表：`arcId → { errorToolCallId, fixToolCallIds, verificationToolCallId }`（真实 id 由检测器直接取自事件缓冲，模型全程不经手）。
  2. R1 弧线提醒文本改为携带句柄，例：「你刚完成一次先错后改对（arc-3）。立即调用 write_lesson 记录，evidence 填 `{ "arcId": "arc-3" }`。」R2 收割提示列出本 run **未被认领**的 arcId 清单（已被某条 lesson 引用过的不再列）。
  3. `write_lesson` schema 改造：模型可见的 evidence 只收 `{ arcId?: string }`；删除三个 toolCallId 字段的模型可见面。运行时按 arcId 解析出真实三元组，写入 lesson 记录的 evidence 字段（落盘结构不变，审计消费面不变）。
  4. 判定语义：arcId 有效 → 解析后照跑现有审计（存在性 + 谓词 + R4 时序）作为不变量兜底，通过则 `anchored`；arcId 缺失或无效（不在注册表 / 已过期）→ 维持现状语义 `unanchored` → ephemeral，`details.errorKind` 记 `audit` 并注明原因。模型仍可写无弧线的纯洞察 lesson，落隔离区，不算错误。
  5. 提醒/收割文本改动只进代码常量。v0.5 预注册已结项归档，**不回改**；新文本待 v0.6 预注册再冻结。
- 验收：单测覆盖——句柄递增签发 / 提醒文本携带句柄 / 收割清单只列未认领弧线 / 有效 arcId → anchored 入主库 / 无效或缺失 arcId → unanchored + errorKind / 同一 arcId 被第二条 lesson 引用的行为（裁决：允许，审计不变，收割清单不再列）。

## R9 · 关停隐式模板出生，主库只收模型 lesson

- 现状：`manager.ts` 两处以 `authoredBy: 'template'` 出生 lesson——`observeSignals` → `signalToLessonCandidate`（v0.5 种子 run 的垃圾主 lesson 即出自此）与 `admitDistilled`。knack 蒸馏（`knack-distillation.ts`）从 lesson 审计行选材时无 `authoredBy` 过滤，模板垃圾借道繁殖为 knack。
- 要求：
  1. **先查明再动**：列出两处出生点的全部调用方，确认显式用户偏好通道（preference 相关）不受影响后再动手。显式通道一律不动。
  2. 隐式模板通道关停：`observeSignals` 不再产 lesson（信号本身仍照常落 `signals.jsonl`，可查可审）；`admitDistilled` 若查明仅服务隐式蒸馏链路则一并关停，若有其他消费方则降级为 ephemeral shadow（不参与晋升、注入、knack 蒸馏）。查明结果写进简报。
  3. 存量与下游收紧：注入资格（`jsonl-memory-store.ts` 召回面）与 knack 蒸馏选材统一加 `authoredBy === 'model'` 过滤。`hydrateLesson` 对旧行默认 `template` 的行为不变——正好让存量模板 lesson 被新过滤器自然排除，无需迁移清洗。
- 验收：单测覆盖——信号观察不再出生 lesson / template-only 池注入为空且不占 top-k / knack 蒸馏对 template lesson 零选材 / 显式偏好通道行为不变（回归）。

## 端到端链路证明（完成门）

fixture 级端到端测试：模拟一次含 error→fix→green 弧线的 run → 弧线签发句柄 → 模型（fixture 脚本扮演）调用 `write_lesson` 引用 arcId → lesson `anchored` 入主库 → harness resolved 盖章晋升 → `renderLessonInjection` 渲染非空 → 召回注入出现该 lesson 正文。这条链在 v0.5 中从未整体通过，本单以它作为完成门。

## 禁区

1. 不动 `promoteRunLessonsAfterHarness` / `promoteHarnessEligibleLessons` / BUG-015 盖章语义。
2. 不回改 v0.5 预注册与其结果目录（已归档）；不点火任何正式批。
3. 提醒/收割文本不得提及 harness 内部产物（AEvo 隔离照旧）。
4. key 不入库。
5. 不碰 `feat/self-toolbox` 分支及其计划（独立任务）。

## 完成定义

- R8/R9 全部验收通过，端到端 fixture 链路测试绿；
- `npx vitest run` 与 `tsc --noEmit` 全绿；
- 简报：改动清单、R9 第 1 步的调用方查明结论、测试结果。交付后由作者用真实 key 跑单种子题烟测验证链路，再议 v0.6。
