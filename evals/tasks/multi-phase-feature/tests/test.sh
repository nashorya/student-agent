#!/usr/bin/env bash
set -euo pipefail

cd "$SANDBOX_DIR"

# ---- 检查文件存在 ----
for file in "src/math.ts" "src/main.ts"; do
  if [ ! -f "$file" ]; then
    echo "FAIL: $file not found"
    exit 1
  fi
done

math=$(cat "src/math.ts")
main=$(cat "src/main.ts")

# ---- Phase 1: multiply 函数存在 ----
if ! echo "$math" | grep -q "export function multiply"; then
  echo "FAIL: multiply function not found in math.ts"
  echo "--- content ---"
  echo "$math"
  exit 1
fi
if ! echo "$math" | grep -q "return a \* b"; then
  echo "FAIL: multiply should return a * b"
  exit 1
fi

# ---- Phase 2: divide 函数存在 ----
if ! echo "$math" | grep -q "export function divide"; then
  echo "FAIL: divide function not found in math.ts"
  echo "--- content ---"
  echo "$math"
  exit 1
fi
if ! echo "$math" | grep -q "return a / b"; then
  echo "FAIL: divide should return a / b"
  exit 1
fi

# ---- Phase 3: main.ts 调用了全部四个函数 ----
if ! echo "$main" | grep -q "multiply"; then
  echo "FAIL: main.ts should call multiply"
  echo "--- main.ts ---"
  echo "$main"
  exit 1
fi
if ! echo "$main" | grep -q "divide"; then
  echo "FAIL: main.ts should call divide"
  exit 1
fi
if ! echo "$main" | grep -q "subtract"; then
  echo "FAIL: main.ts should call subtract"
  exit 1
fi

# ---- Phase 4: 输出验证 ----
OUTPUT=$(node --loader ts-node/esm src/main.ts 2>&1 || node --loader tsx src/main.ts 2>&1 || tsx src/main.ts 2>&1 || npx tsx src/main.ts 2>&1 || true)

if echo "$OUTPUT" | grep -q "10 + 5 = 15"; then
  :  # pass
elif echo "$OUTPUT" | grep -q "3 + 4 = 7"; then
  echo "FAIL: main.ts still uses old add-only code, not all four functions"
  echo "--- output ---"
  echo "$OUTPUT"
  exit 1
else
  echo "FAIL: unexpected output from main.ts"
  echo "--- output ---"
  echo "$OUTPUT"
  exit 1
fi

# 所有检查通过
printf '1\n' > "$REWARD_FILE"
echo "PASS: all multi-phase feature checks passed"
