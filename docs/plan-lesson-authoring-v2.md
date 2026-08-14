# 计划：Lesson 出生管线 v2 —— agent 自判自写 + 证据锚定

状态：**M1–M5 已落地**（分支 `feat/lesson-authoring-v2`）；M6 全量测试绿，live 烟测未点火
日期：2026-08-14 · 发起：作者 · 执行：外部 agent

---

## 0. 背景（为什么改）

- **现状**：lesson 出生是纯确定性模板拼接，全程无模型参与。正文 = 模板前缀 + `signal.summary`（即错误字符串本身）。出生路径见 `src/memory/lessons/manager.ts`（`observeRecentSignals` 一带）与 `src/evals/causal-pair.ts`（`findCausalPair`）。
- **后果**：lesson 内容是症状复读；`doNotApplyWhen` 是模板写死的废话；Tier B 实测"召回内容主要为临时工具/环境错误，未见明确利用证据"（`docs/INDEX.md` 2026-06-12 行）。
- **结论**：注入实验照旧跑等于花钱测"注入模板字符串有没有用"。先改供给，再跑实验。

设计依据（commit message 按 CLAUDE.md 落痕规则注明）：

- 对比式经验提取：`per ExpeL-2308.10144`
- 紧凑 gene 表示与失败面附着：`per GEP-Gene-2604.15097`

## 1. 设计裁决（固定约束，执行时不重开讨论）

1. **触发权给 agent**：系统提示指示 agent 在"先错后改对"的情形调用 `write_lesson` 工具，**不限条数**。写入不限量，注入有门（准入/晋升挡水）。
2. **证据强制锚定**：`write_lesson` 必须引用轨迹证据（`errorToolCallId`、`fixToolCallIds[]`、`verificationToolCallId`）。现有 `findCausalPair` 逻辑**降职为审计员**：核验引用事件真实存在、错误事件真实是错误、验证事件真实转绿。核验失败 → 标 `unanchored`，进 ephemeral 隔离（`ephemeral/lessons.jsonl` 语义，永不注入），不入主库候选池。
3. **出生置信度**：模型所写 lesson 一律 `candidate` 出生。原 `streamVerified → 出生即 verified` 语义仅适用于审计员核验通过证据链的 lesson。**harness 晋升链（`promoteRunLessonsAfterHarness` / `promoteHarnessEligibleLessons`，即 BUG-015 修复后的盖章语义）一字不动。**
4. **文档进索引不进正文**：`docRefs` 只存 ctx7 的 library + topic 指针，禁止存文档正文。
5. **写作要求对比**：提示模板要求写出"错的那步为什么错 / 对的那步为什么对 / 差异在哪"，作为 `cause` 与 `doNotApplyWhen` 的原料。禁止只写"用 X 修好了"。

## 2. Schema 变更（`src/memory/lessons/types.ts`）

新增字段，旧字段保留，读旧数据向后兼容：

```ts
cause: string;            // 根因，写在"子系统 + 缺陷类别"层，不写具体行号
fixPattern: string;       // 修法模式
contrast?: string;        // 错误路径 vs 正确路径的差异
symptomKeys: string[];    // 召回索引用，永不注入
docRefs?: Array<{ library: string; topic: string }>;   // ctx7 指针
evidence: {
  errorToolCallId: string;
  fixToolCallIds: string[];
  verificationToolCallId: string;
};
authoredBy: 'model' | 'template';   // 旧数据读取时默认 'template'
audit: 'anchored' | 'unanchored';
```

**渲染语义变更**：注入时渲染 `cause` / `fixPattern` / `doNotApplyWhen` / `docRefs`；症状（旧 lesson 正文、`symptomKeys`）只参与召回匹配，**不注入**——注入症状是给模型看它自己马上会看到的东西。

## 3. 里程碑（小步提交，每个里程碑一批 commit，禁止 batch commit）

### M1 · schema + 写入路径 + 审计员

- 改 `src/memory/lessons/types.ts`、`src/memory/lessons/manager.ts`。
- 新增 API：`recordModelAuthoredLesson(candidate, sessionEvents)` —— 调 `findCausalPair` 系逻辑对 `evidence` 三元组做核验。
- 单测（新增于 `src/memory/lessons/__tests__/`）：锚定通过入库为 candidate / 引用的 toolCallId 不存在 → unanchored 隔离 / 引用的验证事件并未转绿 → unanchored / 隔离条目不进召回候选池 / 旧模板路径读写兼容。
- 验收：`npx vitest run` 相关文件全绿，`tsc --noEmit` 干净。

### M2 · `write_lesson` 工具 + 提示指令

- 工具注册点**先查明再动**：从 `src/core/pi-bridge/session-factory.ts` 与 `src/extension/index.ts` 的 `createStudentSession` 调用链找工具注册面；eval 侧在 `src/evals/agent-runner.ts`。
- 工具 schema：

```
write_lesson({
  whatWentWrong: string,      // 哪一步、当时为什么那么做
  rootCause: string,
  fixMethod: string,
  contrast: string,           // 为什么错的错、对的对
  doNotApplyWhen: string,     // 真实边界，禁止模板话
  symptomKeys: string[],
  evidence: { errorToolCallId, fixToolCallIds[], verificationToolCallId },
  docRefs?: [{ library, topic }]
})
```

- 工具返回必须极简（一行确认 + lesson id），不得把 lesson 回显进上下文。
- 提示指令逐字定稿并放入代码常量（后续要冻进预注册），措辞基线：
  > 每当你发现自己先做错了、之后又改对了（包括没有报错但走了弯路的情况），立即调用 write_lesson 记录：哪步错了、真正的成因、后来用什么方法改对、错误路径和正确路径的差异。查过文档就带上文档索引。不限次数。
- 验收：单测证明工具调用落库走 M1 路径；指令文本有快照测试。

### M3 · ctx7 常规化（eval 运行时可用）

- 现状：ctx7 锁在 `config.features.context7` 后、只挂 failure escalation（`src/evals/agent-runner.ts:123-127`）。
- 改动：eval runner 提供常规文档查询能力（供 agent 主动查），timeout / maxDocsChars 走统一配置。
- **降级规则**：ctx7 查询失败或服务不可达，一律确定性降级为"无文档"，**绝不使 run invalid**，只在 run summary 记 `ctx7Calls` / `ctx7Failures` 计数。
- 验收：断网单测（mock 失败）证明降级路径；summary 字段有测试。

### M4 · 召回渲染切换

- 渲染点先查明：lesson 注入渲染在 recall/context-assembly 一侧（`src/memory/recall/`、`src/extension/hooks/context-assembly.ts`、`src/evals/injection-family-runner.ts` 的注入段），找到后按第 2 节渲染语义改。
- 验收：注入提示词 fixture 快照中不再出现原始错误字符串正文；出现 `cause` / `fixPattern` / `docRefs`。

### M5 · 预注册 v0.5 草案（纯文书）

- 新文件 `docs/proposals/injection-effect-experiment-prereg-v0.5.md`，继承 v0.4 全部未变更条款，新增：
  - 供给管线描述（agent 自写 + 审计锚定 + candidate 出生）；
  - 写入指令逐字全文；
  - 预期变化：lesson 数量不设上限 → 池变大 → top-3 截断与 ADR-005 排序成为活变量；池 >5 时 H2（常驻 vs 召回）具备复活条件；
  - 若 M3 启用：AOT vs JIT 判读框架（记住文档结论 vs 每次重查），`per GAM-2511.18423`。
- **v0.4 文档一字不动。本草案标注"未冻结，禁止点火"。**

### M6 · 全量回归 + 一题 live 烟测

- `npx vitest run` 全量 + `tsc --noEmit` 全绿。
- live 烟测：1 道种子题（建议 `astropy__astropy-12907`，有历史对照），**需作者提供 key，预算上限 $2，超停**。无 key 则止步于 M5，如实报告。
- 烟测只看两个数：单 run lesson 出生数量；抽查全部出生 lesson，标"成因表述 vs 症状复读"比例，清单交作者人工判。

## 4. 禁区

1. 不动 BUG-015 晋升语义（`promotedAt` 盖章链）。
2. 不动 v0.4 预注册文档；不冻结、不点火任何实验；不跑三臂。
3. AEvo 隔离不破：`write_lesson`、提示指令、lesson 内容不得引用 harness 内部产物（测试名、判分日志）。
4. 不合并 main（作者决定）；在工作分支小步提交。
5. key 与秘密不入库；烟测 key 从 `~/.student-agent/.env` 注入。
6. 本计划不含 dsh / MCP server 相关工作，勿扩scope。

## 5. 完成定义

- M1–M5 全部验收通过，M6 视 key 供给执行；
- 全量测试与 tsc 干净；
- 输出简报：改动清单、测试结果、烟测两个数、待作者决策项（是否冻结 v0.5、是否点火）；
- `docs/INDEX.md` 时间轴追加一行（一行 + 链接，细节留在本文件）。
