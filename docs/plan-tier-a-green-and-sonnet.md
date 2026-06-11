# 计划：Tier A 全绿 → 配置冻结 → Sonnet 锚点轮

> 前置阅读：[benchmark-matrix.md](benchmark-matrix.md)、INDEX 2026-06-11 Tier A 条目。
> 执行顺序严格按 P0→P3，每个 P 完成后在 INDEX 时间轴追加一行。

---

## P0 · overfull-hbox 归因（先查后修，不许跳过）

1. 取 overfull-hbox 失败 run 的 trace，定位模型做出 `natures→traits` 替换的那一轮。
2. 检查该轮实际发送的 prompt：synonym family 约束文本是否出现在
   （a）累积对话历史中的位置（距末尾多少 token）；（b）L1 注入区。
3. 归因写入 `docs/buglog.md`（BUG-004，用模板）：
   - 约束在历史深处、L1 无 → **装配问题**（走 P1 机制修复为主）
   - 约束就在近处仍违反 → **显著性/收尾纪律问题**（走 P1 政策修复为主）
   - 两者都做，但归因决定 Tier B 之后的 v0.4x 优先级排序，必须记录。

## P1 · 修复（机制 + 政策，均为通用件，禁止 synonym 专用 hack）

### 1a. Hard Constraints section（Requirement Ledger MVP）

- task 创建时把 instruction 原文（或其约束段）存入 task（新字段
  `working_memory.hardConstraints: string`，第一版**确定性照搬，不用 LLM 抽取**）。
- `ContextBuilder` 新增 `hardConstraints` section，归 L1，每轮渲染，
  受 tier budget 约束（minimal 档可截断，标注 truncated）。
- 非交互路径（`runNonInteractive` 建 task 处）把 instruction 写入该字段。
- 单测：有 hardConstraints 的 task，build 输出含该 section；超预算被截断且记录。

### 1b. 政策补丁（autonomy rule 追加一条）

```
- Before declaring the task complete, re-read the HARD CONSTRAINTS section
  and verify your changes satisfy every constraint. A solution that passes
  validation but violates a stated constraint is a failure.
```

### 1c. Terminal 基础设施固化

- Linux Node/node_modules 缓存安装策略写成脚本（或固化进现有 adapter），
  文档落 `docs/`，禁止口口相传。
- verifier 对 apt/Debian mirror 类操作加重试（≥2 次，间隔退避）或换稳定 mirror。

## P2 · 回归验收（Tier A 全量，gpt-5.5）

- 跑全套 Tier A：SWE 12907/14182 + terminal prove-plus-comm / fix-git / overfull-hbox。
- overfull-hbox 额外跑 2~3 seed。
- 验收：5 题全绿；SWE 两题 turns/inputTokens 相对本轮基线
  （12907=189k/11 calls，14182=189k/9 turns）无显著回涨（>20% 需归因）；
  `verify_retry`/`patch_retry` 触发数记录在案。
- 报数口径：final records 的 `inputTokens / totalTokens / turns` 三元组。
- ⚠ 常驻文本改动会全盘改变行为（前案：环境豁免补丁使 token -57%），
  任何异常先 trace diff 归因，再决定是否调整。

## P3 · 冻结 + Sonnet 锚点轮

1. **先打 tag**（如 `v0.4.1-bench-frozen`），结果一旦对外引用必须可溯源到该 commit。
2. 矩阵：**cc + sonnet** vs **student-agent + sonnet**（原生 Anthropic 渠道），
   Tier A 全部 5 题，每题 1 trial。预算控制：这是配置无可指摘的锚点，不是统计。
3. 必须采集：rawUsage 原样落 trace；验证 `cache_read_input_tokens` 真实填充
   （关案 BUG-002）；cost 按官方单价计算并写入 metadata
   （commit、model、单价、variant 缺一不可）。
4. 产出：对比表（resolved、inputTokens/totalTokens/turns、cost、cache 命中），
   写入 `docs/`，INDEX 时间轴登记。此表为今后所有"vs cc"引用的锚点。

## 范围外（明确不做）

- Tier B（astropy 序列）：等 Tier A 全绿后另行启动，协议见 ADR-002。
- LoCoBench：parked。
- LLM 抽取约束、Requirement Ledger 完整版（rejection/tombstone 联动）：v0.4x，
  等 P0 归因 + Tier B 数据后排期。
