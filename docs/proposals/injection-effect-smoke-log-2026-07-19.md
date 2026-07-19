# 注入效果实验 · 前置烟测记录（2026-07-19）

> 不属实验本体；不冻结预注册设计。对照预注册 v0.1「前置烟测」三门。

| 门 | 结果 | 证据 |
|----|------|------|
| **1. 管线（离线）** | **部分通过** | P3 citation / context-builder / failure-escalation / lessons manager / chronicle graph：**76 tests pass**（见下）。宽域 `src/memory/recall`+`src/evals` 另有 **9 fail**（ranking timeout、agent-runner generationId 等，与本实验门控非同一批，**未当本门绿**） |
| **2. 出站 / 接入** | **部分通过** | `open.bigmodel.cn` models **200**；`glm-5.2` chat completions 可达（thinking：`completion_tokens` 含 reasoning，content 可空）。**未做**三臂注入段代理对拍（需 agent 全链路 + 临时代理抓包，本轮未起常驻代理） |
| **3. 蒸馏话风** | **未做 live** | lessons manager 单测绿；**未**跑含真实错误的小任务 live 蒸馏抽查 |

## 命令摘要

```text
# 聚焦门 1（全绿）
npx vitest run \
  src/memory/recall/__tests__/citation.test.ts \
  src/memory/recall/__tests__/context-builder.test.ts \
  src/evals/context-runtime/recall-citation.eval.test.ts \
  src/extension/hooks/__tests__/failure-escalation.test.ts \
  src/archive/__tests__/knowledge-graph.test.ts \
  src/memory/lessons
# → 5+2 files, 50+26+8 tests pass

# 接入探测
# open.bigmodel.cn/api/paas/v4/models → 200；含 glm-5.2
# chat/completions model=glm-5.2 max_tokens=32 → usage OK（thinking 路径）
```

## 结论

- 预注册 **v0.1 已写**，**未冻结**（禁止合并）。
- 烟测：**离线 P3/阶梯/lesson 单测绿**；**GLM-5.2 接入可达**；**三臂对拍 + live 蒸馏话风仍缺**，不得宣称「前置烟测全通」。
- 下一步：coding plan 下 1 次最小 agent run（临时代理抓注入段）+ 小任务阶梯/events 可蒸抽查 → 再谈作者冻结合并。
