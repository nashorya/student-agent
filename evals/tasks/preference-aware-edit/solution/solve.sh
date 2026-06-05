#!/usr/bin/env bash
set -euo pipefail

cd "$SANDBOX_DIR"

# 读取项目规则（模拟 agent 的行为）
cat memory/project-rules.md > /dev/null  # just to show we checked

# 修改文件：重命名变量 + 切换为双引号
perl -i -pe "
  s/const greeting = 'hello';/const message = \"你好世界\";/;
  s/console\.log\(greeting\);/console.log(message);/
" src/app.ts
