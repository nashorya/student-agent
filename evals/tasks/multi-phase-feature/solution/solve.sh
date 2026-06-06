#!/usr/bin/env bash
set -euo pipefail

cd "$SANDBOX_DIR"

# Phase 1: 添加 multiply
perl -i -pe "s/export function subtract/export function multiply(a: number, b: number): number {\n  return a * b;\n}\n\nexport function subtract/" src/math.ts

# Phase 2: 添加 divide
perl -i -pe "s/^export function subtract/export function divide(a: number, b: number): number {\n  if (b === 0) throw new Error('Division by zero');\n  return a \/ b;\n}\n\nexport function subtract/" src/math.ts

# Phase 3: 更新 main.ts
cat > src/main.ts << 'EOF'
import { add, subtract, multiply, divide } from "./math.js";

const a = 10;
const b = 5;

console.log(`${a} + ${b} = ${add(a, b)}`);
console.log(`${a} - ${b} = ${subtract(a, b)}`);
console.log(`${a} * ${b} = ${multiply(a, b)}`);
console.log(`${a} / ${b} = ${divide(a, b)}`);
EOF
