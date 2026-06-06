#!/usr/bin/env bash
set -euo pipefail

cd "$SANDBOX_DIR"

# ---- Helpers ----
run_ts() {
  tsx "$@" 2>&1 || node --loader ts-node/esm "$@" 2>&1 || npx tsx "$@" 2>&1 || true
}

run_ts_eval() {
  echo "$1" | tsx - 2>&1 || echo "$1" | node --loader ts-node/esm - 2>&1 || echo "$1" | npx tsx - 2>&1 || true
}

# ---- 1. Check files exist ----
for file in "src/cart.ts" "src/main.ts" "src/types.ts" "src/products.ts"; do
  if [ ! -f "$file" ]; then
    echo "FAIL: $file not found"
    exit 1
  fi
done

cart=$(cat "src/cart.ts")
main=$(cat "src/main.ts")

# ---- 2. Check exported functions exist in cart.ts ----
if ! echo "$cart" | grep -q "export function addItem"; then
  echo "FAIL: export function addItem not found in cart.ts"
  echo "--- cart.ts ---"
  echo "$cart"
  exit 1
fi

if ! echo "$cart" | grep -q "export function removeItem"; then
  echo "FAIL: export function removeItem not found in cart.ts"
  exit 1
fi

if ! echo "$cart" | grep -q "export function getTotal"; then
  echo "FAIL: export function getTotal not found in cart.ts"
  exit 1
fi

# ---- 3. Check main.ts calls all three functions ----
if ! echo "$main" | grep -q "addItem"; then
  echo "FAIL: main.ts should call addItem"
  echo "--- main.ts ---"
  echo "$main"
  exit 1
fi
if ! echo "$main" | grep -q "removeItem"; then
  echo "FAIL: main.ts should call removeItem"
  exit 1
fi
if ! echo "$main" | grep -q "getTotal"; then
  echo "FAIL: main.ts should call getTotal"
  exit 1
fi

# ---- 4. Verify addItem: basic add + stacking + multiple items ----
ADD_OUTPUT=$(run_ts_eval "
import { addItem } from './src/cart.js';

// basic add
const r1 = addItem([], 'apple', 2);
if (r1.length !== 1 || r1[0].productId !== 'apple' || r1[0].quantity !== 2) {
  console.log('FAIL: addItem basic add wrong');
  process.exit(1);
}

// stacking same product
const r2 = addItem(r1, 'apple', 3);
if (r2.length !== 1 || r2[0].quantity !== 5) {
  console.log('FAIL: addItem stacking failed');
  process.exit(1);
}

// add different product
const r3 = addItem(r2, 'banana', 1);
if (r3.length !== 2 || r3[1].productId !== 'banana') {
  console.log('FAIL: addItem multiple items failed');
  process.exit(1);
}

// immutability check
if (r1.length !== 1 || r1[0].quantity !== 2) {
  console.log('FAIL: addItem mutated original array');
  process.exit(1);
}

console.log('PASS: addItem');
")

if ! echo "$ADD_OUTPUT" | grep -q "PASS: addItem"; then
  echo "FAIL: addItem logic test failed"
  echo "$ADD_OUTPUT"
  exit 1
fi

# ---- 5. Verify removeItem: partial remove + full remove + nonexistent ----
REMOVE_OUTPUT=$(run_ts_eval "
import { addItem, removeItem } from './src/cart.js';

let cart = addItem(addItem([], 'apple', 5), 'banana', 3);

// partial removal
const r1 = removeItem(cart, 'apple', 2);
if (r1.length !== 2) {
  console.log('FAIL: removeItem should keep both items', r1.length);
  process.exit(1);
}
const appleQty = r1.find(c => c.productId === 'apple')?.quantity;
if (appleQty !== 3) {
  console.log('FAIL: removeItem partial removal wrong qty', appleQty);
  process.exit(1);
}

// full removal (quantity >= existing)
const r2 = removeItem(r1, 'banana', 3);
if (r2.length !== 1 || r2.find(c => c.productId === 'banana')) {
  console.log('FAIL: removeItem full removal failed');
  process.exit(1);
}

// nonexistent product should leave cart unchanged
const r3 = removeItem(r2, 'nonexistent', 1);
if (r3.length !== 1) {
  console.log('FAIL: removeItem nonexistent should not change cart');
  process.exit(1);
}

console.log('PASS: removeItem');
")

if ! echo "$REMOVE_OUTPUT" | grep -q "PASS: removeItem"; then
  echo "FAIL: removeItem logic test failed"
  echo "$REMOVE_OUTPUT"
  exit 1
fi

# ---- 6. Verify getTotal: correct calculation with 8% tax ----
TOTAL_OUTPUT=$(run_ts_eval "
import { addItem, getTotal } from './src/cart.js';
import { products } from './src/products.js';

let cart = addItem(addItem(addItem([], 'apple', 2), 'banana', 3), 'cherry', 1);
// apple: 5*2=10, banana: 3*3=9, cherry: 15*1=15 => subtotal=34, *1.08=36.72
const total = getTotal(cart, products);
if (Math.abs(total - 36.72) > 0.01) {
  console.log('FAIL: getTotal expected 36.72, got', total);
  process.exit(1);
}

// empty cart
const emptyTotal = getTotal([], products);
if (emptyTotal !== 0) {
  console.log('FAIL: getTotal empty cart should be 0, got', emptyTotal);
  process.exit(1);
}

console.log('PASS: getTotal');
")

if ! echo "$TOTAL_OUTPUT" | grep -q "PASS: getTotal"; then
  echo "FAIL: getTotal logic test failed"
  echo "$TOTAL_OUTPUT"
  exit 1
fi

# ---- 7. Verify main.ts output ----
OUTPUT=$(run_ts "src/main.ts")

if echo "$OUTPUT" | grep -q "购物车中有 3 种商品"; then
  :  # pass
else
  echo "FAIL: main.ts output missing '购物车中有 3 种商品'"
  echo "--- output ---"
  echo "$OUTPUT"
  exit 1
fi

if echo "$OUTPUT" | grep -q "33.48"; then
  :  # pass
else
  echo "FAIL: main.ts total should be 33.48 (含 8% 税)"
  echo "--- output ---"
  echo "$OUTPUT"
  exit 1
fi

# 所有检查通过
printf '1\n' > "$REWARD_FILE"
echo "PASS: all shopping cart checks passed"
