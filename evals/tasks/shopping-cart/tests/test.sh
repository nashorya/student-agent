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
for func in "addItem" "removeItem" "getSubtotal" "checkout"; do
  if ! echo "$cart" | grep -q "export function $func"; then
    echo "FAIL: export function $func not found in cart.ts"
    echo "--- cart.ts ---"
    echo "$cart"
    exit 1
  fi
done

# ---- 3. Check main.ts calls all four functions ----
for func in "addItem" "removeItem" "getSubtotal" "checkout"; do
  if ! echo "$main" | grep -q "$func"; then
    echo "FAIL: main.ts should call $func"
    echo "--- main.ts ---"
    echo "$main"
    exit 1
  fi
done

# ---- 4. Verify addItem: basic add + stacking + multiple items + immutability ----
ADD_OUTPUT=$(run_ts_eval "
import { addItem } from './src/cart.js';

const r1 = addItem([], 'apple', 2);
if (r1.length !== 1 || r1[0].productId !== 'apple' || r1[0].quantity !== 2) {
  console.log('FAIL: addItem basic add wrong');
  process.exit(1);
}
const r2 = addItem(r1, 'apple', 3);
if (r2.length !== 1 || r2[0].quantity !== 5) {
  console.log('FAIL: addItem stacking failed');
  process.exit(1);
}
const r3 = addItem(r2, 'banana', 1);
if (r3.length !== 2 || r3[1].productId !== 'banana') {
  console.log('FAIL: addItem multiple items failed');
  process.exit(1);
}
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

const r1 = removeItem(cart, 'apple', 2);
if (r1.length !== 2) {
  console.log('FAIL: removeItem should keep both items, got', r1.length);
  process.exit(1);
}
const appleQty = r1.find(c => c.productId === 'apple')?.quantity;
if (appleQty !== 3) {
  console.log('FAIL: removeItem partial removal wrong qty, got', appleQty);
  process.exit(1);
}

const r2 = removeItem(r1, 'banana', 3);
if (r2.length !== 1 || r2.find(c => c.productId === 'banana')) {
  console.log('FAIL: removeItem full removal failed');
  process.exit(1);
}

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

# ---- 6. Verify getSubtotal: correct calculation + empty cart + partial match ----
SUBTOTAL_OUTPUT=$(run_ts_eval "
import { addItem, getSubtotal } from './src/cart.js';
import { products } from './src/products.js';

let cart = addItem(addItem([], 'apple', 2), 'milk', 1);
// apple: 5*2=10, milk: 12*1=12 => subtotal=22
const total = getSubtotal(cart, products);
if (total !== 22) {
  console.log('FAIL: getSubtotal expected 22, got', total);
  process.exit(1);
}

const emptyTotal = getSubtotal([], products);
if (emptyTotal !== 0) {
  console.log('FAIL: getSubtotal empty cart should be 0, got', emptyTotal);
  process.exit(1);
}

// productId not in products list should be skipped
const unknownCart = addItem([], 'unknown', 5);
const unknownTotal = getSubtotal(unknownCart, products);
if (unknownTotal !== 0) {
  console.log('FAIL: getSubtotal unknown product should be 0, got', unknownTotal);
  process.exit(1);
}

console.log('PASS: getSubtotal');
")

if ! echo "$SUBTOTAL_OUTPUT" | grep -q "PASS: getSubtotal"; then
  echo "FAIL: getSubtotal logic test failed"
  echo "$SUBTOTAL_OUTPUT"
  exit 1
fi

# ---- 7. Verify checkout: percentage coupon + fixed coupon + no coupon + minAmount guard ----
CHECKOUT_OUTPUT=$(run_ts_eval "
import { addItem, checkout } from './src/cart.js';
import { products } from './src/products.js';
import type { Coupon } from './src/types.js';

let cart = addItem(addItem([], 'apple', 2), 'milk', 1);
// subtotal=22

// percentage coupon 10% off: 22*0.9=19.8, *1.08=21.384 -> 21.38
const c1: Coupon = { code: 'P10', type: 'percentage', value: 10, minAmount: 0 };
const r1 = checkout(cart, products, c1);
if (Math.abs(r1 - 21.38) > 0.01) {
  console.log('FAIL: checkout percentage expected 21.38, got', r1);
  process.exit(1);
}

// fixed coupon ¥5 off: 22-5=17, *1.08=18.36
const c2: Coupon = { code: 'F5', type: 'fixed', value: 5, minAmount: 0 };
const r2 = checkout(cart, products, c2);
if (Math.abs(r2 - 18.36) > 0.01) {
  console.log('FAIL: checkout fixed expected 18.36, got', r2);
  process.exit(1);
}

// no coupon: 22*1.08=23.76
const r3 = checkout(cart, products);
if (Math.abs(r3 - 23.76) > 0.01) {
  console.log('FAIL: checkout no coupon expected 23.76, got', r3);
  process.exit(1);
}

// coupon with minAmount not met: 22 >= 30? no, so no discount -> 23.76
const c3: Coupon = { code: 'MIN30', type: 'fixed', value: 100, minAmount: 30 };
const r4 = checkout(cart, products, c3);
if (Math.abs(r4 - 23.76) > 0.01) {
  console.log('FAIL: checkout minAmount guard failed, expected 23.76, got', r4);
  process.exit(1);
}

// fixed coupon larger than subtotal: should floor at 0 before tax
const smallCart = addItem([], 'apple', 1); // subtotal=5
const c4: Coupon = { code: 'BIG', type: 'fixed', value: 10, minAmount: 0 };
const r5 = checkout(smallCart, products, c4);
if (r5 !== 0) {
  console.log('FAIL: checkout fixed > subtotal expected 0, got', r5);
  process.exit(1);
}

console.log('PASS: checkout');
")

if ! echo "$CHECKOUT_OUTPUT" | grep -q "PASS: checkout"; then
  echo "FAIL: checkout logic test failed"
  echo "$CHECKOUT_OUTPUT"
  exit 1
fi

# ---- 8. Verify main.ts output ----
OUTPUT=$(run_ts "src/main.ts")

if echo "$OUTPUT" | grep -q "购物车中有 3 种商品"; then
  :  # pass
else
  echo "FAIL: main.ts output missing '购物车中有 3 种商品'"
  echo "--- output ---"
  echo "$OUTPUT"
  exit 1
fi

# Expected: apple 3-1=2 remaining = 2*5=10, milk 2*12=24, bread 1*8=8 => subtotal=42
if echo "$OUTPUT" | grep -q "小计: ¥42"; then
  :  # pass
else
  echo "FAIL: main.ts subtotal should be ¥42"
  echo "--- output ---"
  echo "$OUTPUT"
  exit 1
fi

# Expected: subtotal=42, coupon 10% off => 42*0.9=37.8, *1.08=40.824 -> 40.82
if echo "$OUTPUT" | grep -q "40.82"; then
  :  # pass
else
  echo "FAIL: main.ts total should be ¥40.82"
  echo "--- output ---"
  echo "$OUTPUT"
  exit 1
fi

# 所有检查通过
printf '1\n' > "$REWARD_FILE"
echo "PASS: all shopping cart checks passed"
