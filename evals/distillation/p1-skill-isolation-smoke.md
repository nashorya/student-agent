# P1-B · Skill 隔离烟测（2026-07-19）

## 机制

- `createStudentSession({ controlledSkillRoots })` → `DefaultResourceLoader({ noSkills: true, additionalSkillPaths: roots, agentDir: <sandbox>/.pi-eval-agent })`
- eval runner 固定 `controlledSkillRoots = [evals/fixtures/skills]`（当前空目录）
- trace 写 `skillManifest: { roots, entries }`

## 对照

| 条件 | skill 数 | 含 `/Users/.../.agents/skills` |
|---|---:|---|
| **无** isolation（默认发现） | **26** | 是（home 泄漏） |
| **有** `controlledSkillRoots=[fixtures/skills]` | **0** | 否 |

## ZenMux 最小请求（客户端拦截 body）

- 渠道：`https://zenmux.ai/api/v1` / `anthropic/claude-sonnet-4.6`
- 结果：`skillCount=0`；出站 1 次；**无** `<available_skills>` 段（空 skills 不渲染清单）；**无** `/Users/` 路径
- 结论：网关对拍干净（客户端 body 代理验，等价可见请求内容）

## diagnostics

`context_assembly_diagnostics` 已从被试 prompt 移除，仅 `onTrace` / `contextAssemblyTraces` 保留。
