# C-2 · 缓存前缀重排烟测（2026-07-19）

## 代码改动

| 文件 | 作用 |
|---|---|
| `src/memory/recall/context-builder.ts` | `STATIC_*` / `DYNAMIC_*`、`partitionContextSections`、`CACHE_PREFIX_BREAKPOINT` |
| `src/extension/hooks/context-assembly.ts` | 渲染序：静态 → 断点 → 动态（段内容不变） |
| `src/core/pi-bridge/session-factory.ts` | system：`Pi base` → memory（static…dynamic） |

生产代码净增约 **51 行**（≤80 上限）。

## 不变量

| # | 断言 | 结果 |
|---|---|---|
| a | 分区不丢段；assembly 含 taskSpec / PI CONTRACT | 单测绿 |
| b | hardConstraints / taskSpec 仍在动态侧、预算独立 | 单测绿 |
| c | 同配置两次 build 静态段字节级相同 | 单测绿 |
| 截断 | `applySectionBudgets` 按段独立；重排不改谁先被截 | 提案修订已记 |

## 烟测（≈$0.1 级，3 turn 同 session · ZenMux Sonnet 4.6）

客户端拦截 3 次出站：

| turn | `cache_control` | `cache_prefix_breakpoint` | body≈ |
|---:|:---:|:---:|---:|
| 1 | 有 | 有 | ~16k |
| 2 | 有 | 有 | ~16k |
| 3 | 有 | 有 | ~16k |

- 段序：断点前为静态 padding + 安全/文件规则，断点后为 `taskSpec` 动态段。
- skill 隔离：无 `/Users/.../.agents/skills` 泄漏。
- **本地 usage 字段**：pi 侧 `cacheRead/Write` 仍为 0（stream 分项未落满，与 A 仪器「usage 不完整」同源）；**网关权威分项以 ZenMux 控制台本批 3 请求为准**。

### 与 proposal 预期对照（入档口径）

| 指标 | proposal 目标 | 本烟测 |
|---|---|---|
| 静态跨 turn 稳定 | 字节级 | **是**（单测 + 同 session 前缀） |
| 请求带 `cache_control` | 有 | **3/3** |
| cache_read 占比上升 | ≥80% 静态复用（粗算） | **待控制台回填**（本地 usage=0） |
| prompt 全价占比下降 | 写多→读多 | **待控制台回填** |

> 作者可在 ZenMux 对刚才 3 条 generation 拉 `input_cache_read` / `input_cache_write_*` / 未缓存 prompt 分项，补进下表。

| feeItem | turn1 | turn2 | turn3 | 备注 |
|---|---:|---:|---:|---|
| input (uncached) |  |  |  | 网关填 |
| input_cache_read |  |  |  | 网关填 |
| input_cache_write_5_min |  |  |  | 网关填 |

## 生命体征 +1

Campaign 例行字段建议新增：`cachePrefixBreakpoint: true`、`staticSectionByteStable: true`、网关 `cacheReadShare`。
