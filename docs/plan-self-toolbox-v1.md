# 计划：Self-Toolbox v1 —— agent 为项目自写工具,塑形自己的上下文

状态：**未开工**
日期：2026-08-15 · 发起：作者 · 执行：外部 agent
分支：`feat/self-toolbox`(已存在,基于 `feat/lesson-authoring-v2`)

---

## 0. 背景(为什么做)

- agent 在同一项目里反复做笨重操作:读整个文件只为找一个字段定义、从几百行测试输出里翻真正挂掉的三行。原始材料整段进窗口,信噪比低,token 白烧。
- 目标:让 agent 给自己写**项目专属小工具**(如 `find-model-field`、`summarize-test-failures`),一次调用返回**恰好需要的那几行上下文**。用得越久,每个项目长出一套贴身工具,上下文越来越合身。
- 这是**工程功能,不是研究**。不进任何 eval 冻结面,不碰 v0.5 实验。验证方式是 dogfooding。

设计依据来自对五个 Lisp×agent 项目的实现调研(笔记:`.scratch/lisp-survey/survey-notes.md`),四条教训直接决定了下面的裁决:

1. 裸 eval 入口在实战里必然长成几十个工具(cl-mcp-server 1→37),防膨胀要靠单入口 + 入口内动作;
2. "文件落盘 ≠ 重启后可用"会产生幽灵工具(anvil),注册状态必须每次从磁盘推导;
3. 错误要喂回模型自纠 + 连续失败硬停(Sema),输出要有预算和截断(cl-mcp-server);
4. "写了工具 ≠ 会被用"(anvil 明确承认),引导和召回与工具本身同等重要。

## 1. 设计裁决(固定约束,执行时不重开讨论)

1. **不做沙箱。** agent 已有不设防的 shell 工具,给工具层修沙箱防不住任何 shell 做得到的事,纯属安全剧场。信任模型与 shell 一致。
2. **不用 Lisp,不写解释器。** 工具就是 ES module(`.mjs`),模型母语,原生速度,可用全部 Node 生态。
3. **不为"演化农场"预留任何东西。** 无晋升门、无强制自测、无出身/谱系字段、无 manifest 抽象层。那是未来独立研究项目,从零开始。
4. **单入口。** 只注册**一个** pi 工具 `toolbox`,`list`/`describe`/`run`/`create`/`update`/`disable` 全部是它的 action,不是独立工具。上下文里的 tool schema 成本恒为 O(1)。
5. **生死由使用统计决定。** 工具建出来即可用;连续失败 3 次(可配)自动禁用;禁用后 `run` 返回禁用原因,`update` 修好后自动解禁(失败计数清零)。
6. **上下文纪律。** `run` 结果截断(默认 8000 字符,截断时附说明);单次执行超时默认 10 秒;`list` 只回名字 + 一行描述,不回源码。
7. **幽灵工具防治。** 每次会话启动扫工具目录重建注册表,注册状态永远从磁盘推导,不依赖上一会话的内存状态。
8. **feature flag 全程护体。** `STUDENT_AGENT_FEATURE_TOOLBOX`(默认关)。关闭时零行为变化、零工具注册。

## 2. 约定(目录与契约)

### 2.1 磁盘布局

```
<memoryRoot>/toolbox/
  <tool-name>.mjs      # 工具本体,一文件一工具,文件名即工具名
  stats.json           # 使用统计,与工具本体分离
```

`stats.json` 每工具一条:`{ calls, consecutiveFailures, lastUsedAt, disabled, disabledReason? }`。

### 2.2 工具模块契约

```js
// <memoryRoot>/toolbox/summarize-test-failures.mjs
export default {
  name: 'summarize-test-failures',
  description: '从 vitest/pytest 输出中提取失败用例名与断言差异,每个失败 3 行以内',
  params: { output: 'string:测试命令的完整 stdout' },   // 自由格式的参数说明对象
  async run(args) {
    // ...
    return '...';   // 返回 string 或可 JSON.stringify 的值
  },
};
```

- `params` 是给模型看的说明,不做 schema 强校验;`run` 收一个普通对象。
- 加载用动态 `import()`,URL 加 `?v=<mtime>` 破缓存,`update` 后立即生效。
- import 失败 / default export 缺 `name`/`run` → 该文件标记为坏工具,`list` 中以 disabled 呈现,错误信息可经 `describe` 查看。

### 2.3 `toolbox` pi 工具 schema

```
toolbox({
  action: 'list' | 'describe' | 'run' | 'create' | 'update' | 'disable',
  name?: string,        // describe/run/create/update/disable 必填
  args?: object,        // run 用
  source?: string,      // create/update 用,完整模块文本
})
```

行为要点:

- `list`:名字 + 一行描述 + 禁用标记,无源码;
- `describe`:完整 description、params 说明、统计;
- `run`:执行,超时/截断;抛错时把错误文本作为工具结果返回(模型自纠),并累加失败计数;
- `create`/`update`:写盘 → 动态 import 校验 → 校验失败返回错误并**删除/回滚**该文件(不留坏文件);
- 所有返回都极简,禁止把源码回显进上下文(`create`/`update` 成功只回一行确认)。

## 3. 里程碑(小步提交,禁止 batch commit)

### M1 · 注册表 + 执行器(`src/memory/toolbox/`)

- `registry.ts`:扫目录加载、`createTool`/`updateTool`(写盘+校验+回滚)、`disableTool`、`recordUsage`(含连续失败自动禁用与修复解禁)、stats 读写。
- `runner.ts`:动态 import(mtime 破缓存)、超时(默认 10s)、结果序列化与截断(默认 8000 字符)。
- 单测(`src/memory/toolbox/__tests__/`):磁盘重建注册表(幽灵工具防治)/ 坏模块标记不炸加载 / 连续 3 次失败自动禁用、update 后解禁 / 超时中断 / 截断附说明 / create 校验失败回滚不留脏文件。
- 验收:相关 vitest 全绿,`tsc --noEmit` 干净。

### M2 · `toolbox` pi 工具 + 接线 + flag

- 新文件 `src/core/pi-bridge/toolbox-tool.ts`,用 `defineTool` 实现单入口(参照 `write-lesson-tool.ts` 的结构与返回形状)。
- config:`features.toolbox` + 环境变量 `STUDENT_AGENT_FEATURE_TOOLBOX`,照抄 `STUDENT_AGENT_FEATURE_CONTEXT7` 在 `src/core/config/loader.ts` 的模式。
- 接线点**先查明再动**:`src/core/pi-bridge/session-factory.ts` 的工具注册面(`write_lesson` 怎么注册,`toolbox` 就怎么注册),flag 关闭时完全不注册。
- 工具 description / promptGuidelines 里写入使用指引,措辞基线(可润色,意思不得变):
  > 当你发现自己在这个项目里第二次做同样的笨重操作(重复的搜索、解析、格式化、从长输出里提取固定信息),用 toolbox create 把它固化成工具,下次一次调用解决。工具应该返回"恰好需要的信息",而不是原始材料。
- 单测:flag 关闭零注册 / action 路由 / 指引文本快照。
- 验收:同 M1。

### M3 · 采用引导(召回面)

- 会话开场注入现有工具清单:每个工具一行(名字 + 描述),上限 10 个,按 `lastUsedAt` 降序;空工具箱时不注入任何内容。
- 注入点**先查明再动**:跟着现有 memory 注入面走(`src/memory/recall/` 与 session-factory 的 prompt 组装链),作为独立小节,不与 lesson 注入混排。
- 单测:清单渲染 / 上限截断 / 空箱零注入 / flag 关闭零注入。
- 验收:同 M1;另跑一次全量 `npx vitest run` + `tsc --noEmit` 确认无回归。

## 4. 边界(明确不做,发现自己在做以下任何一件事立即停)

- 沙箱、权限模型、policy-subjects、能力白名单;
- Lisp / 解释器 / s 表达式;
- 晋升门、强制自测、出身记录、谱系、manifest 抽象;
- 变异/杂交/适应度等一切演化机制;
- 重复操作自动检测(触发提醒只靠 M2 的静态指引,自动检测留 v1.1 再议);
- eval 集成:不接 `agent-runner`,不进任何预注册,不碰 `docs/proposals/**` 与 `evals/inputs/**`。

## 5. 分支纪律

- 全部工作在 `feat/self-toolbox`;**禁止 push `feat/lesson-authoring-v2`**(云端 VM 正按其冻结基线跑 v0.5 实验)。
- 工作区里 `docs/proposals/*`、`evals/inputs/injection-effect-frozen-instances.jsonl`、`docs/INDEX.md` 可能存在**不属于本任务的未提交改动**(v0.5 附录冻结的残留),不许提交、不许还原,绕开走。
- 提交只含本计划涉及的文件;commit message 按 CLAUDE.md 落痕规则。
