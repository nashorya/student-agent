# Bug 档案

> 规则：再小的问题也记录。模板见文末。状态：OPEN / FIXED / FIXED-待回归 / WONTFIX。
> 修复必须由 AI 执行并在此留痕；注释里的说明不算档案。

---

## BUG-001 · benchmark 路径未接入 Context Runtime

- **时间**：2026-06-11，发现者：codex（用户转述），Claude 确认根因
- **症状**：SWE 对比 run 的 trace 中 `layers.L1/L2/L3.sectionCount = 0`、
  `contextPromptEstimatedTokens = 0`（见 `evals/results/comparison/full-main-contextbreakdown-20260611T065619Z/swe-student-agent/records.json`）
- **根因**：`runNonInteractive` 从未在 TasksManager 创建 task；
  `context-assembly.ts` 新管道以 `getActive()` 为前提，无 task 走降级分支跳过 L1/L2/L3。
  次要：hook 创建时未传 `runMode: 'eval'`。
- **影响**：65k vs 286k 的 token 对比不能归因 context runtime（归基座设计）；
  此 run 可复用为 ablation 的 off 臂。
- **处置**：按
  [plan-noninteractive-context-runtime-fix.md](plan-noninteractive-context-runtime-fix.md)
  完成非交互 task 创建、eval run mode 与 context assembly 接线，并补齐测试和
  context breakdown 观测。
- **状态**：CLOSED（Tier A/B 实跑 trace 已持续记录 task lifecycle、
  context assembly 与分层注入指标）

## BUG-002 · cc usage 采集不认 OpenAI 格式，cache 恒为 0

- **时间**：2026-06-11，发现者：Claude（排查 cache=0 异常时）
- **症状**：cc（经代理跑 gpt-5.5）的 `cacheReadTokens` 恒为 0
- **根因**：`usageFromClaudeJson` 只解析 Anthropic 字段
  （`cache_read_input_tokens`），不认 OpenAI 的
  `prompt_tokens_details.cached_tokens`；且原始 usage 未留底，无法事后判断。
- **修复**：`src/evals/claude-code-runner.ts` 增加 OpenAI 格式回退
  （注意语义归一：OpenAI `prompt_tokens` 含 cached，映射时减除）；
  新增 `rawUsage` 字段原样留底；补单测。
- **遗留**：terminal-bench 路径（`run_benchmark_comparison.py` 的 `n_cache_tokens`）
  另一条链路，未核；若代理本身丢字段则客户端无解，rawUsage 留底后可判别。
- **2026-06-12 OpenRouter Sonnet 回归**：跨 agent 自跑已按 Tier C 修订停止，
  cache 关案口径迁移到 student-agent 的 OpenRouter Anthropic-compatible
  通道。`prove-plus-comm` 探针（commit `452e46b0`，
  `anthropic/claude-sonnet-4.6`）逐轮 usage 真实记录
  `cacheReadTokens=48,998`、`cacheWriteTokens=7,436`、非缓存
  `inputTokens=5,205`；cache read 占 prompt 输入总量
  `48,998 / (5,205 + 48,998 + 7,436) = 79.49%`。第 1 轮写入 cache，
  第 2~11 轮均有 cache read，证明 Pi 的 Anthropic `cache_control`
  经 OpenRouter 透传且 usage 采集未丢字段。探针成本 `$0.1196094`。
- **状态**：CLOSED（OpenRouter Sonnet cache_control 透传与 usage 采集实测正常；
  已停止的 cc lane 不再作为关案前提）

## BUG-003 · 档案纪律失守：v0.37–v0.4 被打包进 batch commit

- **时间**：2026-06-08 发生，2026-06-11 复盘
- **症状**：git log 最后的版本化提交停在 v0.36，v0.4 成果埋在
  `79ad7f64 chore: batch commit`；另有 ~90 文件长期未提交；
  评测结果 JSON 未绑定 commit hash，无法复现。
- **根因**：赶进度时档案流程停摆（本方法论的已知失败模式）。
- **处置**：恢复小步提交 + 版本 tag；结果 metadata 强制含 commit/model/单价；
  会话末由 AI 追加 INDEX 时间轴，降低纪律成本。
- **2026-06-12 关案证据**：功能分支恢复为 37 个独立小步提交；运行时 memory
  与结果文件已取消跟踪并 ignore；评测 metadata 强制记录
  commit/model/单价；INDEX 继续按会话追加时间轴。
- **状态**：CLOSED

## BUG-004 · overfull-hbox 约束未进入近场，导致非法 synonym 替换

- **时间**：2026-06-11 18:20，发现者：codex
- **症状**：Terminal Tier A 的 `overfull-hbox` run 中 agent 消除了
  `Overfull \hbox`，但 verifier 失败：
  `modified input.tex must only modify words in synonyms.txt`。失败差异为
  `natures -> traits`，二者不在同一 synonym family。
- **根因**：归因已推进三层。第一层是原始失败 run 未把完整约束保留到
  L1；第二层修复后，DeepSeek 与 gpt-5.5 trace 均证实
  `hardConstraints` 已完整渲染且未截断；第三层根因是约束核对没有被执行成
  可校验动作。模型收尾时凭记忆或语感声明修改符合约束，只验证了任务主目标
  （例如编译与 overfull warning），没有用 `git diff`/`read` 取证后逐条对照
  HARD CONSTRAINTS，因此跨 family 替换仍能漏过。
- **修复/处置**：按 `plan-tier-a-green-and-sonnet.md` P1 增加通用
  `working_memory.hardConstraints` 与 L1 `hardConstraints` section；非交互路径
  确定性保存完整 instruction；eval autonomy rule 增加完工前重读 hard
  constraints 的收尾纪律。第三层修复新增通用 completion self-check：
  非交互主回合结束后，若 hardConstraints 非空，追加且仅追加一轮固定自查，
  要求用工具取得修改证据、逐条判定满足/违反、发现违反立即修复并重新校验；
  summary 记录该轮是否运行、工具调用数和是否产生编辑。
- **2026-06-11 回归证据**：使用 DeepSeek 官方 endpoint 跑
  `p2-overfull-official-deepseek-seed1-20260611`，agent phase 正常完成，
  verifier 4 项通过 3 项：编译成功、无 overfull hbox、未修改
  `main.tex`/`synonyms.txt`；`test_input_file_matches` 失败，最终文件含非法
  `to → of`。trace 显示 `hardConstraints` 已作为 L1 section 渲染
  （437 chars / 125 estimated tokens），working memory 中也保留了
  "each line specifies a family of allowed synonyms" 的完整约束。
  因此装配缺失已排除，残余问题属于行为/验证闭环：agent 曾主动发现并回退
  `unbroken → steady`，但在多次大段替换和 edit 失败后，最终自检没有发现
  verifier 报出的 `to → of`。推断非法替换由大段文本改写夹带，尚无直接
  tool payload 证据，不据此加 hack。
- **2026-06-11 gpt-5.5 回归证据**：更换可用 key 后运行
  `p2-overfull-gpt55-newkey-seed1-20260611`，agent phase 正常完成，
  14 turns / 172,788 input tokens。verifier 再次 3/4：编译、无 overfull、
  保护文件均通过，`test_input_file_matches` 因 `natures → traits` 跨
  family 失败，与最初 Tier A 症状同型。L1 `hardConstraints` 仍完整渲染
  （437 chars / 125 estimated tokens）。该轮采用较小范围 patch，但收尾只
  grep `Overfull \hbox`，没有运行逐 token synonym-family 校验；日志未保存
  `apply_patch` payload，无法把非法替换归到某一笔 patch。按失败即停规则，
  未继续 seed 2/3 与 SWE 回归。
- **2026-06-11 completion self-check 三 seed**：commit `c1d2aff9`
  增加一次性收尾自查后，用 gpt-5.5 跑
  `p3-overfull-selfcheck-gpt55-seed{1,2,3}-20260611`。三轮自查均真实调用工具，
  但 verifier 仅 seed 2 为 4/4；seed 1、3 仍为 3/4：
  - seed 1：`177,461 / 255,396 / 20`（input/total/turns），
    `selfCheck={ran:true, toolCalls:11, editsMade:false}`，失败差异
    `an → a`。
  - seed 2：`140,392 / 239,697 / 16`，
    `selfCheck={ran:true, toolCalls:6, editsMade:false}`，verifier 4/4。
  - seed 3：`148,327 / 242,658 / 17`，
    `selfCheck={ran:true, toolCalls:8, editsMade:false}`，失败差异
    `natures → moods`。
- **失败 seed 自查 trace 原文摘录**：
  - seed 1：
    > Evidence examples from the final input.tex and synonyms.txt: communicative -> open, reserved -> quiet, curious -> odd...
    >
    > No constraint violations found.
  - seed 3：
    > every introduced replacement word appears in the synonym families in synonyms.txt, for example open, quiet, opinions, odd...
    >
    > Result: Task is complete.
- **第三层验证结论**：self-check 已把核对变成工具动作，满足
  `selfCheck.toolCalls >= 1`，但模型仍采用示例抽查而非完整逐 token 对照，
  因而能对未枚举的非法替换给出错误的“全部满足”结论。关案双条件未满足；
  按约定不继续 SWE、不打 tag、不自行增加第三层 hack。
- **第四层修复**：commit `5537d326` 只升级新建的 `SELF_CHECK_PROMPT`，
  明确要求核验覆盖 full diff 的 EVERY change，抽查本身即验证失败；凡文件内容、
  diff、词表、行归属等机械可检约束，必须由 agent 编写并运行小脚本做穷举校验，
  仅在无法脚本化时才允许人工检查。未改 `EVAL_AUTONOMY_RULE`，也未加入
  synonym/LaTeX 专用逻辑。
- **2026-06-11~12 第四层回归证据**：gpt-5.5 运行
  `p4-overfull-scripted-selfcheck-gpt55-seed{1,2,3}-20260611`，三轮 verifier
  均 4/4；三元组（input/total/turns）分别为
  `552,804 / 675,094 / 34`、`1,058,943 / 1,219,319 / 38`、
  `561,541 / 630,920 / 25`。`selfCheck.toolCalls` 分别为 16/25/22，
  且 trace 均有 agent 生成并执行 Node 校验器的证据。脚本不是走形式：
  seed 1 抓到 `an -> a` 与尾部空行丢失；seed 2 抓到
  `great -> fine`、article 变化；seed 3 抓到
  `unmistakable -> clear`、`reaction -> concern`，修复后重新编译与全量校验才
  通过。
- **成本归因**：三轮 input 与 turns 均超过第三层基线
  （140k~177k / 16~20 turns）的 20% 阈值。trace 显示增量集中在自查回合：
  容器无 `git`/`python3`，Node 脚本先后经历 LaTeX quoting、LCS/位置对齐修复，
  并在发现真实违规后触发编辑、重编译和再次穷举；这是为获得可执行完备性证据
  支付的验证与返工成本，不是 context 装配漂移。
- **SWE 回归**：官方 harness 均 resolved。12907 为
  `425,030 / 447,385 / 16`，相对基线 `189,152 / 190,615 / 11` 的 input
  回涨 124.7%；trace 为 31 次工具调用（基线 11），主要消耗在 pytest warning
  策略、缺扩展、Python 3.13 `build_ext` 失败后改走 stub 执行验证。14182 有效
  重跑为 `136,215 / 148,775 / 8`，低于基线
  `189,407 / 211,708 / 9`。14182 首次联合运行被外部终止，随后工作目录清理使
  `git diff` 表现为全仓删除（11.6 MB suspicious patch）；该失败产物未送判分，
  单题重跑正常。
- **状态**：CLOSED（3 seed 均满足 verifier 4/4、工具取证、脚本穷举三条件；
  SWE 12907/14182 官方 resolved）

## BUG-005 · P2 overfull 回归为无效 run：provider 漂移 + 缺 API key

- **时间**：2026-06-11 19:35 run / 验收时发现，发现者：Claude（验收）
- **症状**：`p2-overfull-hard-constraints-20260611` reward=0 看似红灯，
  实为 agent exit 2：`Missing DEEPSEEK_API_KEY for provider deepseek`，
  agent 从未运行，verifier 测的是原始 repo（test_no_overfull_hboxes 自然失败）。
- **根因**：run 配置漂移到 `student-agent__deepseek-v4-pro`，违反矩阵
  Tier A 的 gpt-5.5 口径；且环境缺对应 key。哨兵缺失：agent 退出码非零时
  结果仍被当作正常 trial 落盘，容易误读为任务失败。
- **修复/处置**：① 重跑用 gpt-5.5（与基线口径一致）；② runner 对
  agent-phase 非零退出应标记 `invalid_run` 而非进入 reward 统计；
  ③ hardConstraints 的实战验证独立记录在 BUG-004，不用无效 run 判断质量。
- **2026-06-11 回归证据**：`gpt-5.5` 中转链路连续 3 次因
  `503 No available accounts` 以 agent exit 1 结束；新汇总层均输出
  `invalid_run=true`、`validRewardTrials=0`、`mean=null`，且 pass/fail
  为空，没有进入 reward 统计。随后 DeepSeek 官方 endpoint 的有效 run
  正常进入 verifier，未被误标 invalid。
- **状态**：CLOSED

## BUG-006 · verifier 环境失败被计为 reward 0，污染判分与重跑配额

- **时间**：2026-06-12，发现者：codex（sonnet Tier A 重定基线时）
- **症状**：overfull-hbox 重跑 agent 正常退出，verifier reward 0.0；
  verifier 输出含 `curl SSL_connect`（astral.sh）失败与 `uvx: command not found`
  ——verifier 依赖的 uv 安装失败，判分环境未就绪。另：首跑 AgentTimeoutError
  （OpenRouter 渠道延迟，超时阈值可能需上调）。
- **根因**：① verifier 运行时从网络安装 uv，受限网络下必败；
  ② harness 未区分"verifier 环境失败"与"任务失败"，前者应标 invalid_run
  （BUG-005 哨兵的姊妹场景：彼为 agent 非零退出，此为 verifier setup 失败）。
- **修复/处置**：① verifier 依赖预烘焙（镜像内预装 uv 或本地缓存安装包），
  与 P1c terminal 基础设施固化同类；② verifier setup 失败（依赖安装报错、
  网络超时）标记 invalid_run，不计 reward、不消耗 agent 重跑配额；
  ③ 红线修订：infra 失败不计入"最多重跑 1 次"，但须修复 infra 后才许重试。
- **2026-06-12 修复**：`scripts/run_benchmark_comparison.py` 增加 terminal
  infra invalid_run 分类：`NonZeroAgentExitCodeError`、`AgentTimeoutError`、
  verifier 日志中的 astral/uvx/网络 setup failure 均剔出 reward 统计，并记录
  `invalid_reasons`。新增 `scripts/prepare_terminal_bench_verifier_deps.py`，
  将 Harbor 缓存的 `overfull-hbox` 复制为本地 patched task，构建
  `student-agent-overfull-hbox:20251031-uv0.9.5` 派生镜像，把 Linux
  `uv/uvx` 预装进 verifier 环境，`tests/test.sh` 不再运行时访问 astral.sh。
  patched task 同时把 `[agent].timeout_sec` 从 750s 提到 1125s（×1.5），
  verifier 改用 `uv run --python/--with` 长参数，避免预装 uvx 不接受旧短参数。
  本地已生成 patched task：
  `$HOME/.cache/student-agent/terminal-bench-local-tasks/overfull-hbox`。
- **2026-06-12 回归阻塞**：patched task 两次重测均按哨兵标为
  `invalid_run=true / validRewardTrials=0 / mean=null`，原因均为
  `agent_timeout`，不计 reward、不消耗题目重跑配额。第二次已确认 infra
  修复生效：`[agent].timeout_sec=1125.0`，secret env file 模式避免 key 出现在
  `docker compose` 参数中，verifier 不再访问 astral.sh，且能启动 pytest；
  但 agent 在超时前尚未完成编辑，verifier 测到的是原始 overfull 文件，因此
  `test_no_overfull_hboxes` 失败。OpenRouter key usage 查得 `$3.89538615`，
  未超过 `$5` 熔断线；按红线停止，不继续 SWE，下一步需先排查
  OpenRouter/agent 第一轮 bash 后长时间无输出的问题。
- **附**：本轮有效数据——cache 探针 prove-plus-comm reward 1.0，
  `5,205 / 65,733 / 11`，$0.12，**cache read 占比 79.49%**（BUG-002 据此关案，
  口径：OpenRouter 渠道）；fix-git 绿 `18,175 / 148,787 / 18`，$0.19。
- **2026-06-12 后续决策**：verifier infra 与 invalid_run 哨兵保持 FIXED；
  overfull 的 agent 行为回归因预算标记 deferred，不再阻塞先行采集 SWE 基线。
  续航哨兵的 overfull 实战验证顺延至 Tier B 或预算补充后，不将 deferred
  误记为 verifier 修复失败。
- **状态**：CLOSED（verifier 依赖与 invalid_run 哨兵已实测生效；后续
  OpenRouter agent timeout/overfull deferred 属 agent run 行为与预算事项，
  不再归入 verifier 污染问题）

## BUG-007 · 本地 probe 凭据误入未推送分支历史

- **时间**：2026-06-12，发现者：codex（发布前秘密扫描）
- **症状**：`scripts/probe_tools.py` 被纳入功能分支提交，文件中的本地渠道配置
  含明文凭据；当前工作树还存在用户自己的后续修改。
- **根因**：一次性连通性探针被当作通用 eval 脚本提交，缺少
  “本地凭据脚本不得入 VCS”的 ignore 规则。
- **修复/处置**：将该路径从 VCS 取消跟踪并加入 `.gitignore`，本地文件原样
  保留；发布前重写尚未推送的功能分支与 `v0.4.1-bench-frozen` tag 历史，
  从所有待发布提交中移除该路径。远端当前没有该功能分支或 tag。
- **2026-06-12 关案证据**：仅重写 `main..codex/context-runtime-benchmark`
  的 37 个未推送提交并重建冻结 tag；`main` 与最终代码树均未改变。新历史中
  `scripts/probe_tools.py` 路径、明文 key 模式和个人绝对路径扫描均为零命中；
  本地 probe 文件保持 ignored，清理前后 SHA-256 一致。
- **状态**：CLOSED（相关凭据仍建议轮换）

---

## 模板

```
## BUG-NNN · 一句话标题

- **时间**：YYYY-MM-DD HH:MM，发现者：
- **症状**：（现象 + 证据位置）
- **根因**：（定位到文件/函数；未定位写"未明"）
- **修复/处置**：（改了哪、为什么这么改；暂时方案要标注"暂时"）
- **状态**：OPEN / FIXED / FIXED-待回归 / WONTFIX
```
