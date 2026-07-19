# 注入效果实验 · 前置烟测记录

> 不属实验本体；不冻结预注册设计。对照预注册 **v0.1.1**「前置烟测」三门。

## 轮次 2 · 2026-07-19 晚（再烟测）

| 门 | 结果 | 证据 |
|----|------|------|
| **1. 管线（离线）** | **通过（聚焦）** | citation / context-builder / P3 recall-citation eval / failure-escalation / lessons manager / chronicle graph：**6 files · 58 tests pass** |
| **2. 出站 / 接入** | **通过（接入可达）** | `open.bigmodel.cn` models 含 **glm-5.2**；`chat/completions` model=`glm-5.2` 返回 usage（thinking：`reasoning_tokens` 占用 completion；content 可空）。**未做**三臂注入段代理对拍、独立 memory root 实跑核对 |
| **3. 蒸馏话风** | **部分（仅单测）** | lessons manager **8/8 pass**；causal-pair 源文件存在。**未**跑含真实错误的小任务 live 蒸馏 / marker 抓取率抽查 |

### 命令（轮次 2）

```text
npx vitest run \
  src/memory/recall/__tests__/citation.test.ts \
  src/memory/recall/__tests__/context-builder.test.ts \
  src/evals/context-runtime/recall-citation.eval.test.ts \
  src/extension/hooks/__tests__/failure-escalation.test.ts \
  src/memory/lessons/__tests__/manager.test.ts \
  src/archive/__tests__/knowledge-graph.test.ts
# → 58 passed

# GLM-5.2
# GET .../models → glm-5.2 present
# POST .../chat/completions model=glm-5.2 → total_tokens>0 OK
```

### 结论（轮次 2）

- **可宣称**：聚焦管线单测绿；**glm-5.2 coding-plan 路径可达**。
- **仍缺（烟测未全通）**：
  1. 三臂出站对拍（A 筛选 vs C 断点后全量常驻 vs B 关闭；独立 memory root）
  2. live 小任务：阶梯触发 + events 可蒸 + GLM 话风 marker/因果对
- **不得合并**预注册（仍为草案；合并即冻结）。

---

## 轮次 1 · 2026-07-19 早（摘要）

| 门 | 结果 |
|----|------|
| 1 | 聚焦 76 tests pass；宽域 recall+evals 有 9 fail（未当绿） |
| 2 | models 200；glm-5.2 可达；无三臂对拍 |
| 3 | lessons 单测绿；无 live 蒸馏 |

---

## 对照 v0.1.1 新增仪器（尚未烟测覆盖）

| 条款 | 烟测状态 |
|------|----------|
| 三臂独立 memory root / 族前空库 | 未实跑 |
| 主库 3 verified 封存不进臂 | 未实跑 |
| p1prom 六题黑名单筛查 | 文书条款；无自动化门 |
| C 臂断点后全量常驻 | 未实跑 / 无单元夹具 |
| 采样三臂一致 | 未锁数值表（冻结时入档） |
