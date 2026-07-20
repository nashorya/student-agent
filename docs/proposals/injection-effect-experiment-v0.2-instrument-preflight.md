# 注入实验 v0.2 · 仪器复检

日期：2026-07-20
状态：**仪器 PR #11 已合并；冻结状态夹具修正后全量复检全绿；等待作者另行点火**

## 四臂与纯记忆边界

| 检查 | 结果 | 证据 |
|------|------|------|
| 四臂同一 context-runtime | ✅ | A-L/A-K/B/C 分别映射 `lesson-recall` / `knack-recall` / `off` / `lesson-full`；B 不再走 plain prompt |
| 跨题只传合格记忆 | ✅ | 每 instance 新建 worktree，初始 HEAD 必须等于冻结 `base_commit` 且工作树洁净；历史 task/run/artifact/preference/doc 均从实验提示闭集中排除 |
| harness 准入 | ✅ | 独立 `injection-admission.json` 只登记 resolved 布尔值；unresolved 产物留档但不可召回、常驻或参与 knack 晋升 |
| lesson / knack / full 差异 | ✅ | 双题无模型回放：task1 resolved 后 A-L task2 出现自然蒸馏的 `__qualname__` lesson；A-K 仍需现行 breaker；B 为空；C 只常驻全部合格主 lesson |
| P3 | ✅ | `used_recall` allowlist 同时接受实际注入的 lesson 与 knack；其他类型或未注入 ID 仍记 invalid；C resident 不计 recall citation |

四臂 Django dry-run 均解析冻结题序 `12125 → 14580 → 17087`，得到互不重叠的 `memory/<arm>/<family>` root。正式模式在文档未出现“已冻结”状态时会在 provider 调用前拒绝启动；harness Python 和 snapshot manifest 缺一也拒绝启动。

## 逐题判分烟测（零模型调用）

复用旧 p1prom prediction `astropy__astropy-12907`，通过 v0.2 的逐题 scorer 判分：

- Docker client/server：`29.5.3` / `29.5.3`。
- harness：独立 venv `/tmp/swebench-harness-venv`，官方 `swebench 4.1.0`。
- 数据 commit：`69611d31007e1c6731db8bd5b5c3f2d33f5bab6e`。
- Arrow SHA-256：`b77fa3036c06219715a35e8088fee13b0b87bc957052546c3270caf38a325627`。
- 结果：completed 1、resolved 1、unresolved 0、error 0；用时约 151 秒。
- scorer 成功复制 batch summary 与单实例官方 report；没有模型请求。

原始烟测日志位于忽略目录 `evals/results/injection-experiment-v0.2-preflight-old-12907/`，不属于正式结果。

## 静态与回归验证

- `npm run build`：通过。
- 全量测试：164 files passed、1122 tests passed；另有 1 个既有 OpenTUI spike test skipped。
- 合并提交首次复检发现 2 条 runner 测试仍把真实预注册当作未冻结草案；仅将拒跑测试改用临时 draft fixture，未改 runner 或设计，修正后全量复检通过。
- 正式 CLI runner：56 行；编排细节下沉至可单测模块。
- 覆盖：四臂映射、未冻结拒跑、独立 root、unresolved 继续、缺产物/失败停批、双题自然蒸馏、ephemeral/历史记忆防泄漏、harness SHA fail-closed、lesson/knack citation，以及四臂全灭才启用替补的中期判定。

## 点火门

1. ✅ 作者已批准并合并 PR #10，v0.2 已正式冻结。
2. ✅ 仪器 PR #11 已合并；合并提交加上述 test-only fixture 修正后，build、全量测试和 Django 四臂 dry-run 复验通过。仪器行为未变，复用旧 prediction 判分烟测。
3. 作者另行明确回复“点火”后，才可从全新结果目录运行 Django 12 run。

任何限流、provider 格式异常、harness 报告歧义或审计产物缺失均停跑报告；禁止现场改设计。
