#!/usr/bin/env bash
set -euo pipefail

cd "$SANDBOX_DIR"

# Phase 1: 实现 addItem（removeItem 和 getTotal 保持占位）
cat > src/cart.ts << 'CART'
import { type CartItem, type Product } from "./types.js";

export function addItem(
  cart: CartItem[],
  productId: string,
  quantity: number,
): CartItem[] {
  const index = cart.findIndex((item) => item.productId === productId);
  if (index === -1) {
    return [...cart, { productId, quantity }];
  }
  const updated = [...cart];
  updated[index] = { ...updated[index], quantity: updated[index].quantity + quantity };
  return updated;
}

export function removeItem(
  cart: CartItem[],
  productId: string,
  quantity: number,
): CartItem[] {
  // TODO: 实现
  return cart;
}

export function getTotal(
  cart: CartItem[],
  products: Product[],
): number {
  // TODO: 实现
  return 0;
}
CART

# Phase 2: 实现 removeItem（getTotal 保持占位）
cat > src/cart.ts << 'CART'
import { type CartItem, type Product } from "./types.js";

export function addItem(
  cart: CartItem[],
  productId: string,
  quantity: number,
): CartItem[] {
  const index = cart.findIndex((item) => item.productId === productId);
  if (index === -1) {
    return [...cart, { productId, quantity }];
  }
  const updated = [...cart];
  updated[index] = { ...updated[index], quantity: updated[index].quantity + quantity };
  return updated;
}

export function removeItem(
  cart: CartItem[],
  productId: string,
  quantity: number,
): CartItem[] {
  return cart.reduce<CartItem[]>((acc, item) => {
    if (item.productId === productId) {
      const remain = item.quantity - quantity;
      if (remain > 0) {
        acc.push({ ...item, quantity: remain });
      }
    } else {
      acc.push(item);
    }
    return acc;
  }, []);
}

export function getTotal(
  cart: CartItem[],
  products: Product[],
): number {
  // TODO: 实现
  return 0;
}
CART

# Phase 3: 实现 getTotal
cat > src/cart.ts << 'CART'
import { type CartItem, type Product } from "./types.js";

export function addItem(
  cart: CartItem[],
  productId: string,
  quantity: number,
): CartItem[] {
  const index = cart.findIndex((item) => item.productId === productId);
  if (index === -1) {
    return [...cart, { productId, quantity }];
  }
  const updated = [...cart];
  updated[index] = { ...updated[index], quantity: updated[index].quantity + quantity };
  return updated;
}

export function removeItem(
  cart: CartItem[],
  productId: string,
  quantity: number,
): CartItem[] {
  return cart.reduce<CartItem[]>((acc, item) => {
    if (item.productId === productId) {
      const remain = item.quantity - quantity;
      if (remain > 0) {
        acc.push({ ...item, quantity: remain });
      }
    } else {
      acc.push(item);
    }
    return acc;
  }, []);
}

export function getTotal(
  cart: CartItem[],
  products: Product[],
): number {
  const subtotal = cart.reduce<number>((sum, item) => {
    const product = products.find((p) => p.id === item.productId);
    if (!product) return sum;
    return sum + product.price * item.quantity;
  }, 0);
  return Math.round(subtotal * 1.08 * 100) / 100;
}
CART

# Phase 4: main.ts 已预设好调用逻辑，无需修改
echo "Solution complete: cart.ts has addItem, removeItem, getTotal implemented"
