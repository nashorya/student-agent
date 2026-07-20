# 注入效果实验 · 前置烟测记录

> 不属实验本体；不冻结预注册设计。对照预注册 **v0.1.1** 三门。

## 轮次 3 · 2026-07-19 live 收尾（**三门全通**）

| 门 | 结果 | 证据 |
|----|------|------|
| **1. 管线 / B 空库** | ✅ | `smoke-injection-live` B 臂：toolCalls≥5、failedToolCalls≥0/1、correctness=1、events 落盘（独立 mem-B）、`B_no_lesson_markers` |
| **2. 三臂注入对拍** | ✅ | 预注入尺寸 B≈986 / A≈5k / C≈5k；B 无 lesson；A 含 `[recall:…]`；C 含 `full resident` / `[resident:]`；A 无 resident 标记；skill 泄漏 **否** |
| **3. live 蒸馏话风** | ✅ | 对 B 真实轨迹 events 跑 `distillRunEvents`；成功产出 candidate（有时经 toolcall reconstruction：archive `events.jsonl` 缺 `isError` 标志）。见附录 |

### 产物

| 路径 | 说明 |
|------|------|
| `evals/tasks/smoke-injection-live/` | 微型埋坑任务（**仅烟测，非正式题库**） |
| `scripts/smoke-injection-live.ts` | B→蒸馏→A/C 编排；临时 mem 用后销毁 |
| `docs/proposals/injection-effect-smoke-captures-2026-07-19-12-36-20.md` | 脱敏抓包/预注入附录 |
| 配置 | `STUDENT_AGENT_PROVIDER_PROFILE=zhipu-glm-5.2`（coding plan 直连） |

### 成本

- 本地 model cost 字段为 0（配置未写单价）；等价标价按 token 粗估 **≪ $0.5**（三臂 micro task 各约 1–2 分钟 GLM-5.2 thinking）。

### 命令

```bash
STUDENT_AGENT_PROVIDER_PROFILE=zhipu-glm-5.2 npx tsx scripts/smoke-injection-live.ts
# → ok: true, gates.allGreen: true
```

### 终判

**烟测三门全通**（gate3 注：因果对在 archive 缺 isError 时用 toolcall 重建，属烟测可接受路径；正式实验应补全 events 错误标志）。

预注册仍为 **草案 v0.1.1 · 未冻结 · 禁止合并**；待作者选族 + 批准冻结。

---

## 轮次 2 · 聚焦离线（摘要）

58 tests pass；glm-5.2 可达；无 live 三臂。

## 轮次 1 · 初探（摘要）

聚焦绿；宽域 ranking 超时；无 live。
