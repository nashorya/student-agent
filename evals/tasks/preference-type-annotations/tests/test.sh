#!/usr/bin/env bash
set -euo pipefail

cd "$SANDBOX_DIR"

# 检查文件是否存在
if [ ! -f "src/app.ts" ]; then
  echo "FAIL: src/app.ts not found"
  exit 1
fi

content=$(cat "src/app.ts")

# 检查 userName 是否有显式类型标注
if ! echo "$content" | grep -q "const userName: string"; then
  echo "FAIL: userName should have explicit type annotation ': string'"
  echo "--- content ---"
  echo "$content"
  exit 1
fi

# 检查 userAge 是否有显式类型标注
if ! echo "$content" | grep -q "const userAge: number"; then
  echo "FAIL: userAge should have explicit type annotation ': number'"
  echo "--- content ---"
  echo "$content"
  exit 1
fi

# 检查 greeting 是否有显式类型标注
if ! echo "$content" | grep -q "const greeting: string"; then
  echo "FAIL: greeting should have explicit type annotation ': string'"
  echo "--- content ---"
  echo "$content"
  exit 1
fi

# 检查 message（函数内部）是否有显式类型标注
if ! echo "$content" | grep -q "const message: string"; then
  echo "FAIL: message inside greet() should have explicit type annotation ': string'"
  echo "--- content ---"
  echo "$content"
  exit 1
fi

# 所有检查通过
printf '1\n' > "$REWARD_FILE"
echo "PASS: all type annotation checks passed"
