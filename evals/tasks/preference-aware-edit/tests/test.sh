#!/usr/bin/env bash
set -euo pipefail

cd "$SANDBOX_DIR"

# 检查文件是否存在
if [ ! -f "src/app.ts" ]; then
  echo "FAIL: src/app.ts not found"
  exit 1
fi

# 读取文件内容
content=$(cat "src/app.ts")

# 检查变量名是否已改为 message
if ! echo "$content" | grep -q "const message"; then
  echo "FAIL: variable name should be 'message', not 'greeting'"
  echo "--- content ---"
  echo "$content"
  exit 1
fi

# 检查是否使用了双引号（遵循 project-rules.md）
if ! echo "$content" | grep -q '"你好世界"'; then
  echo "FAIL: string should use double quotes per project rules, got:"
  echo "$content" | grep "你好世界" || echo "(not found)"
  echo "--- full content ---"
  echo "$content"
  exit 1
fi

# Check no single quotes remain for the greeting string
if echo "$content" | grep -q "'你好世界'"; then
  echo "FAIL: found single quotes, should use double quotes per project rules"
  echo "--- content ---"
  echo "$content"
  exit 1
fi

# 所有检查通过
printf '1\n' > "$REWARD_FILE"
echo "PASS: all checks passed"
