# 注入实验点火前置复检

日期：2026-07-20
状态：**五灯全绿，等待作者明确回复“点火”**。尚未启动任何正式题，零模型调用。

## 冻结手续

- PR #8 已合并，merge commit `7f3cc37b9a79a3b1cb1b44b24d3fee235e128001`。
- 预注册正文原有字节未改；仅在文档末尾追加“条款解释注（2026-07-20，解释非修改）”。
- 执行口径为滚动积累：A/C 每题蒸馏，B 写入管线照跑但不注入；第 N 题仅携带前 N-1 题积累。

## 五灯复检

| 灯 | 结果 | 复核证据 |
|---|---|---|
| 三臂独立空 memory root | ✅ | runner 以 `memory/<arm>/<family>` 隔离，正式启动前递归清空；测试覆盖旧文件消失、三题串行及同臂共库。A/B/C dry-run 均解析为冻结题序 `12125 → 14580 → 17087`。 |
| P3 `used_recall` 正式路径 | ✅ | A 臂走 `context_runtime + recall`；eval prompt 带稳定 citation 规则，`trace.recallAudit.used_recall_ids` 固定落盘；citation eval 测试通过。 |
| C 臂 full-resident | ✅ | C 读取本臂本族 `lessons.jsonl` 全量 lesson，替换筛选后的 knack 段并置于 `cache_prefix_breakpoint` 后；测试覆盖两条 lesson 全量出现、recall 列表为空。 |
| Docker + 官方 harness | ✅ | Docker client/server `29.5.3`；独立 venv `/tmp/swebench-harness-venv` 中 `swebench 4.1.0`、`datasets 5.0.0`。 |
| 升级阶梯 trace | ✅ | `failureEscalationEvents[]` 固定记录 `level/count/timestamp`；连续三次人造失败得到 1/2/3 级事件。 |

## 冻结输入与采样

- runner 仅需 `--family` 与 `--arm`；默认读取 `evals/inputs/injection-effect-frozen-instances.jsonl`（正式两族 + 替补，共 9 题）。
- 题序、模型、profile、thinking、temperature、top_p、max_tokens 均从冻结预注册解析。
- 正式请求路径接收整包冻结采样值；`max_tokens=16384` 显式写入，`top_p=0.95` 按冻结表保持 provider 默认、不发送，且 `do_sample=false`。
- 数据集 commit：`69611d31007e1c6731db8bd5b5c3f2d33f5bab6e`。
- test Arrow SHA-256：`b77fa3036c06219715a35e8088fee13b0b87bc957052546c3270caf38a325627`。

## 判分冒烟

使用旧 p1prom prediction `astropy__astropy-12907`，只运行官方判分器，未调用模型：

- 执行：1；完成：1；resolved：1；unresolved：0；error：0。
- 用时约 149 秒，复用了既有官方 instance image。
- 报告：`evals/distillation/injection-effect-preflight-old-12907-report.json`。
- 判分脚本在启动前同时核对预注册 dataset commit、源 Arrow SHA、本地 saved-dataset Arrow SHA；任一不一致即拒绝运行。

## 验证

- 全量测试：162 files passed、1114 tests passed；另有 1 个既有 spike test skipped。
- `npm run build` 通过。
- runner 143 行，低于 150 行上限。

## 点火纪律

当前停在免费检查点。收到作者明确“点火”前，不运行 Django 族 9 run；点火后仍按族 1 → 中期全灭检查 → 再决定族 2 的顺序执行。
