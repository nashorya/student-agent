# C-2 · 缓存前缀重排 — 探针账目 + TTL + 集成口径

- **代码**：commit `2269eade`（段序）+ 后续 1h TTL 配置（model compat + stream `cacheRetention: long`）
- **代理**：`127.0.0.1:7897`（无代理时 Anthropic 经 ZenMux 地区限制，勿再当有效调用）
- **机器账**：`evals/distillation/c2-cache-prefix-smoke-proxy7897.json`

## 序列账目（写入轮 + 读轮，不单记 T2）

| 轮次 | generation id | uncached prompt | cache read | cache write (5m 桶字段) | 备注 |
|---|---|---:|---:|---:|---|
| **W0 首写** | `0cdb2b6b88be409997e26165bfc45c8a` | 27 | 0 | **5102** | 付 write |
| T1 | `4ac2a741fde1442ba4243d05b369f4fd` | 30 | **5102** | 0 | read |
| T2 | `fc224db919564d5cbe0c232e742484f2` | 30 | **5102** | 0 | read（作者探针同构） |
| T3 | `92754c6c3f57487a99dd44caf7c2de0d` | 30 | **5102** | 0 | read |

### 折算命中率（序列合计，非单点 99.42%）

- 总 write = **5102**
- 总 read = **5102 × 3 = 15306**
- 总 uncached prompt ≈ 27+30+30+30 = **117**
- 输入总量估 = 5102+15306+117 = **20525**
- **序列 cache_read 占比 ≈ 15306/20525 ≈ 74.6%**
- 若只看 T1–T3（write 摊到序列外）read 占比 ≈ 99.4%——档案以 **含 W0 的折算 ~75%** 为准

> 方向性结论：首轮 write、后续 read≫write；全价 prompt 从 07-18 批 ~65% 结构上压到个位数 uncached。

## TTL 调研（2026-07-19 实测）

| 项 | 结果 |
|---|---|
| API 接受 `cache_control.ttl=1h` | **是**（200） |
| 1h 写入分项 | `ephemeral_1h_input_tokens` / `cacheCreationInputTokens` 有值（例：1359） |
| 默认/5m | 未显式 ttl 时常落 **5m** 路径（07-18 账 `input_cache_write_5_min`） |
| pi-ai | `cacheRetention: 'long'` → `ttl: '1h'`（需 `supportsLongCacheRetention`） |
| 本仓配置 | Sonnet@openrouter/ZenMux：`compat.cacheControlFormat=anthropic` + `supportsLongCacheRetention`；`applyLlmRequestLimits` 默认 `cacheRetention: long` |

**已知局限**：若网关/模型回落到 5m 桶，长轮次间隔仍可能击穿 TTL → 旧账 write>read 部分归因于此。优先走 1h；不可用时回退 5m 并记档。

## 不变量（单测）

- a 不丢段 / 断点序
- b hardConstraints·taskSpec 保留
- c **真渲染**静态前缀双次字节相同（含 文件规则/Hashline/EVAL/PI，不含 taskSpec）

## 生命体征字段 +1

Campaign 例行：`cachePrefixBreakpoint`、`staticPrefixByteStable`、`gatewayCacheReadShare`（序列折算）、`cacheTtlPreferred: 1h`。

## 集成烟测（真实 pipeline · 7897）

- `createContextAssemblyHook` + `createStudentSession` + 3×`prompt`
- 出站 3 次：均含 `cache_control`、`cache_prefix_breakpoint`、`ttl:1h`
- 本地 pi usage 映射仍为 0 → **命中率以本文件序列账（W0+T1–T3）与网关 id 为准**
- **方向性验收：通过**（read≫write 结构已证；全价 prompt 占比相对 07-18 批 65% 显著下降）

## C-2 关单

A 入档 + B 不变量绿 + C 方向性达标 → **C-2 CLOSED**
