# 注入实验点火前置交接

日期：2026-07-20
状态：判分环境尚未完成冒烟；禁止启动正式 18 run。

## 下一步

1. 恢复任一旧的、已知 resolved 的 p1prom prediction。优先使用
   `astropy__astropy-12907`；同批可选项还有 `astropy__astropy-6938`、
   `astropy__astropy-14995`。
2. 启用 Docker Desktop 的 WSL integration，或提供其他可用的 Docker daemon；
   先以 `docker version` 同时看到 client/server 为准。
3. 只对恢复的一个 prediction 运行官方 SWE-bench harness 冒烟：

   ```bash
   npm run eval:injection:score -- \
     --python /tmp/swebench-harness-venv/bin/python \
     --snapshot-manifest /tmp/swebench-lite-69611d3/snapshot.json \
     --predictions-path <restored-p1prom-predictions.jsonl> \
     --instance-id astropy__astropy-12907 \
     --run-id p1prom-old-12907-smoke
   ```

4. 只有该旧 prediction 在固定数据快照上复现 resolved，才报告“点火就绪”。
5. 报告后等待作者明确回复“点火”；不得自动开始正式题或模型调用。

## 当前阻塞证据

- 官方 SWE-bench harness `4.1.0` 已安装在 `/tmp/swebench-harness-venv`。
- 数据快照位于 `/tmp/swebench-lite-69611d3`，实际 test Arrow SHA-256 与冻结值一致。
- 当前环境没有 Docker CLI/socket，且未找到旧 p1prom `predictions.jsonl`；因此尚不能完成判分冒烟。
