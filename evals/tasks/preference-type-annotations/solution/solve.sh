#!/usr/bin/env bash
set -euo pipefail

cd "$SANDBOX_DIR"

# 读取项目规则（模拟 agent 的行为）
cat memory/project-rules.md > /dev/null

# 修改文件：为所有变量声明添加类型标注
perl -i -pe "
  s/const userName =/const userName: string =/;
  s/const userAge =/const userAge: number =/;
  s/const greeting =/const greeting: string =/;
  s/const message =/const message: string =/;
" src/app.ts
