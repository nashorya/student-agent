# 预注册:注入效果实验（finding:injection-effect-experiment）

状态: **已冻结（2026-07-20，PR #6 合并生效）**

| 字段 | 值 |
|------|-----|
| finding | `finding:injection-effect-experiment` |
| 关联 | [ADR-008](../adr/ADR-008-measured-harness-evolution.md)（本实验先于 chronicle 产品化） |
| 版本 | **v0.1.1** · 2026-07-19 |
| 冻结规则 | **合并 PR 即冻结**；题库附录（作者选族后补入）一并冻结。未冻结前禁止合入 main |

---

## 假设

**H1**：lesson 召回注入使同族任务序列的第 2、3 题表现优于无注入  
（resolved 或升级阶梯触发次数至少一项改善）。

**H2**：全量常驻注入（Hermes 式）不优于按需召回注入，且成本更高。

---

## 设计

### 被试

- 模型：GLM-5.2 + thinking
- 接入：**公司 coding plan 直连**
- **单一模型、单一接入路径**，三臂共用
- 禁止臂间换模型或换接入
- **Sonnet / ZenMux 批次**标记为**跨模型参照，不入对照**

### 三臂

| 臂 | 代号 | 定义 |
|----|------|------|
| A | **recall** | 现行管线（按需召回注入） |
| B | **off** | 记忆注入关闭 |
| C | **full** | 族内已积累 lesson 全量常驻（见下「C 臂细则」），模拟无筛选/无准入生态 |

**C 臂细则**：写入管线与 A 相同；注入**不经召回筛选**，族内已积累的全部 lesson **每轮常驻上下文**（置于**缓存断点后**，与 A **同位置**，仅数量与筛选策略不同）。

### 记忆隔离

- 三臂各用**独立 memory root**
- **每族开跑前**将该臂该族库**重置为空库**
- 现有主库（3 verified）**封存为归档**，**不进任何臂**
- lesson **仅由**族内第 1 题产生（**各臂各自**独立产生）；第 2、3 题只携带本臂本族库中的产物——**不预置人工 lesson**，不跨臂、不跨族、不读归档主库

### 题库

- 同族序列 × **2 族**，每族 **3 题**（**6 题 × 3 臂 = 18 run**）
- 来源优先级：
  1. SWE-bench **同仓库同模块**关联题（候选筛查表交作者选族）
  2. 筛不出 ≥2 族 → **自建埋坑序列**，先为 tombstone 挂解封状态注（理由：实验需要，范围仅此一次）
- 题序固定，族内按依赖时序

### 污染排除

- 题库**不得**含 **zenmux p1prom 批次六题**：`6938` / `7746` / `12907` / `14182` / `14365` / `14995` 及其**直接邻接 issue**
- 候选筛查表须附 **排除核查列**（见附录 A 模板）

### P3 最小版（先落）

- `[[used_recall:<id>]]` 记入 trace（**只记不评分**）
- 作归因数据，**不作验收指标**

### 采样与仪器锁

- **采样配置**（temperature 等）三臂一致，数值随冻结文档记录
- **臂间唯一差异是注入策略**（含 C 的全量常驻 vs A 的召回筛选 vs B 的关闭）；接入路径、模型、采样、题序、memory 隔离规则均属仪器，不得臂间混用

| 采样参数 | A · recall | B · off | C · full | 现行 runner 实值依据 |
|----------|------------|---------|----------|----------------------|
| 模型 | `glm-5.2` | `glm-5.2` | `glm-5.2` | provider profile `zhipu-glm-5.2` |
| thinking | `enabled` | `enabled` | `enabled` | eval provider policy 写入 `{"type":"enabled"}` |
| temperature | `0` | `0` | `0` | eval provider policy 强制写入 |
| top_p | `0.95` | `0.95` | `0.95` | runner 不显式发送；冻结为 GLM-5.2 当前 provider 默认值；`do_sample=false` 时不参与采样 |
| max_tokens | `16384` | `16384` | `16384` | 未设环境覆盖；model resolver 与 Pi request builder 的现行解析值 |

---

## 指标与判读（预公证）

> n 太小不谈显著性，谈方向。结论一律带 **「方向性证据，非统计显著」** 标注。

| 类型 | 定义 |
|------|------|
| **主** | 各臂第 2、3 题 **resolved 数**（harness 官方判分） |
| **副** | **升级阶梯触发次数**（第 2、3 题，臂间对比） |
| **归因** | A 臂 resolved run 中 `used_recall` 非空比例 |

### 判读规则（写死）

1. **H1 方向支持**：A > B 至少 1 题 **或** 阶梯触发少 ≥30%
2. **H2 方向支持**：C ≤ A **且** C 成本 > A
3. **题库过难**：任何臂全灭 → 换族重跑一次（预算内）；再灭则如实记「本题库无法分辨」
4. **n = 6/臂**（第 2+3 题 × 2 族）；不宣称统计显著

---

## 预算与熔断

- GLM 配额**零现金支出**，按等价标价入档（沿用 **2026-06 口径**）
- **$25 为备用金**，仅限 coding plan 限流/故障时临时切付费口
- **一旦切换，该族全部作废重跑**——接入路径属仪器，臂间不得混
- 无效 run 哨兵沿用
- 总等价超 **$25** 熔断，已完成部分如实入档

---

## 前置烟测（冻结前完成，不属实验本体）

| # | 项 | 通过标准 |
|---|-----|----------|
| 1 | **GLM 管线迁移** | 升级阶梯 / 蒸馏 / 召回 / P3 埋点全通 |
| 2 | **出站对拍** | coding plan 无网关日志 → 以本地代理抓 1–2 单出站请求；核对三臂注入段差异（含 C 常驻 vs A 筛选）、**独立 memory root**、skill 隔离仍生效、P3 埋点落盘；**抓完即弃，不留常驻代理** |
| 3 | **蒸馏话风验证** | GLM 表述习惯下 marker/因果对抓取率抽查；跑一个含真实错误的小任务，确认阶梯触发、events 可蒸 |

---

## 冻结物

| 物 | 状态 |
|----|------|
| 本预注册正文（假设 / 设计 / 指标 / 预算 / 烟测门） | **草案 v0.1.1 · 未冻结**；**禁止合并**；**合并即冻结** |
| 题库附录（作者选族后补入） | **已选定并写入，待作者批准冻结**；与正文一并冻结 |
| 采样配置数值表 | **已补实值**（三臂同一组数） |
| 结果与判读 | 事后入档；不得回改本设计条款 |

### 批准 / 冻结栏

- 作者批准合并（冻结）：☑ 2026-07-20 / PR #6
- 陪审知悉：☑ 2026-07-20
- 作废重开：□ 理由 ____ / 新版路径 ____

---

## 附录 A · 题库清单（已选，待冻结）

> 选定前可改；选定并随冻结合并后不可改。

**数据快照（冻结输入）**：`SWE-bench/SWE-bench_Lite` `test` split；数据仓库 commit SHA `69611d31007e1c6731db8bd5b5c3f2d33f5bab6e`；本地解码后的 test Arrow SHA-256 `b77fa3036c06219715a35e8088fee13b0b87bc957052546c3270caf38a325627`。族内题序按该快照的 `created_at`（关联 PR 创建时间）升序固定。

| 族 | 题序 | 题 ID / 来源 | 依赖说明 | 作者选定 |
|----|------|--------------|----------|----------|
| 族1 · `F-DJ-MIGRATION-REFERENCE` | 1 | `django__django-12125` · `django/db/migrations/serializer.py` | `created_at=2019-11-22T12:55:45Z`；首题，本臂本族自然产 lesson | ☑ 已选 |
| 族1 · `F-DJ-MIGRATION-REFERENCE` | 2 | `django__django-14580` · `django/db/migrations/serializer.py` | `created_at=2021-07-01T07:38:03Z`；携带本臂本族 lesson | ☑ 已选 |
| 族1 · `F-DJ-MIGRATION-REFERENCE` | 3 | `django__django-17087` · `django/db/migrations/serializer.py` | `created_at=2023-07-17T20:28:41Z`；携带本臂本族 lesson | ☑ 已选 |
| 族2 · `F-SY-UNIT-EQUIVALENCE` | 1 | `sympy__sympy-20442` · `sympy/physics/units/util.py` | `created_at=2020-11-17T22:23:42Z`；首题，本臂本族自然产 lesson | ☑ 已选 |
| 族2 · `F-SY-UNIT-EQUIVALENCE` | 2 | `sympy__sympy-24066` · `sympy/physics/units/unitsystem.py` | `created_at=2022-09-16T22:58:15Z`；携带本臂本族 lesson | ☑ 已选 |
| 族2 · `F-SY-UNIT-EQUIVALENCE` | 3 | `sympy__sympy-24213` · `sympy/physics/units/unitsystem.py` | `created_at=2022-11-03T14:00:09Z`；携带本臂本族 lesson | ☑ 已选 |

**替补族（仅在判读规则“题库过难”触发换族时启用；未触发则不进入正式 18 run）**：

| 替补族 | 题序 | 题 ID / 来源 | 固定时序 |
|--------|------|--------------|----------|
| `F-DJ-SELECT-MASK` | 1 | `django__django-14667` · `django/db/models/sql/query.py` | `created_at=2021-07-19T21:08:03Z` |
| `F-DJ-SELECT-MASK` | 2 | `django__django-15814` · `django/db/models/sql/query.py` | `created_at=2022-07-03T19:10:56Z` |
| `F-DJ-SELECT-MASK` | 3 | `django__django-16910` · `django/db/models/sql/query.py` | `created_at=2023-05-31T22:28:10Z` |

**近似度评估表**（候选筛查 → 作者选族）：

| 候选 ID | 仓库/模块 | 与锚点题关系 | 依赖时序是否可排 | **排除核查**（非 p1prom 六题/非直接邻接） | 备注 |
|---------|-----------|--------------|------------------|------------------------------------------|------|
| `F-DJ-MIGRATION-REFERENCE` | `django/django` · `django/db/migrations/serializer.py` | 同文件；均为生成迁移时 Python 引用不完整 | 是；2019 → 2021 → 2023 | ☑ 通过；非 Astropy，无同 issue/PR/函数邻接 | **正式族1** |
| `F-SY-UNIT-EQUIVALENCE` | `sympy/sympy` · `sympy/physics/units/` | 同模块；均为结构判断代替量纲语义等价 | 是；2020 → 2022-09 → 2022-11 | ☑ 通过；非 Astropy，无同 issue/PR/函数邻接 | **正式族2** |
| `F-DJ-SELECT-MASK` | `django/django` · `django/db/models/sql/query.py` | 同文件；均为字段选择掩码未归一化 | 是；2021 → 2022 → 2023 | ☑ 通过；非 Astropy，无同 issue/PR/函数邻接 | **替补族** |

**p1prom 黑名单（硬排除）**：`astropy__astropy-6938`、`7746`、`12907`、`14182`、`14365`、`14995` 及同 PR/同 issue 直接邻接项。

---

## 图关系（机读）

```
finding:injection-effect-experiment --verifies--> campaign:injection-effect-prereg-v0
ADR-008 --motivates--> finding:injection-effect-experiment
finding:injection-effect-experiment --requires--> phase:P1
finding:injection-effect-experiment --requires--> phase:P3
```

---

## 变更记录

| 版本 | 日期 | 摘要 |
|------|------|------|
| v0 | 2026-07-19 | 初稿：ZenMux 被试、烟测未单列 |
| v0.1 | 2026-07-19 | coding plan 直连；备用换口废族；前置烟测三门；禁止合并 |
| **v0.1.1** | 2026-07-19 | **记忆隔离**（独立 root / 族前空库 / 主库封存）；**污染排除** p1prom 六题+邻接；**C 臂细则**（断点后全量常驻、写入同 A）；**采样三臂一致**锁仪器 |
| **v0.1.1 + 附录 A** | 2026-07-20 | 作者选定 `F-DJ-MIGRATION-REFERENCE` + `F-SY-UNIT-EQUIVALENCE`；`F-DJ-SELECT-MASK` 为替补；记录固定题序与数据快照 SHA；仍待批准冻结 |
