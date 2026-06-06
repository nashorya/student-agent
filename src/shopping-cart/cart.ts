import type {
  CartItem,
  CartSnapshot,
  CartState,
  CartEvent,
  Coupon,
  ShippingRule,
  Product,
} from "./types.js";

/** 默认运费规则 */
const DEFAULT_SHIPPING: ShippingRule = {
  baseFee: 1000,           // ¥10
  freeThreshold: 9900,     // 满 ¥99 免运费
};

/**
 * 生成 SKU ID：productId + 按 key 排序的规格组合
 */
function buildSkuId(productId: string, specs: Record<string, string>): string {
  const keys = Object.keys(specs).sort();
  const specStr = keys.map((k) => `${k}:${specs[k]}`).join("|");
  return specStr ? `${productId}__${specStr}` : productId;
}

/**
 * 购物车——核心领域模型
 *
 * 职责：
 * - 商品项的增删改查
 * - 自动生成 skuId
 * - 价格与运费计算
 * - 优惠券应用
 * - 事件审计
 */
export class ShoppingCart {
  private state: CartState;

  constructor(shippingRule?: Partial<ShippingRule>) {
    this.state = {
      items: [],
      coupon: null,
      shippingRule: { ...DEFAULT_SHIPPING, ...shippingRule },
      history: [],
      updatedAt: new Date(),
    };
  }

  // ========== 读取 ==========

  /** 获取所有购物车项 */
  get items(): CartItem[] {
    return [...this.state.items];
  }

  /** 获取已应用优惠券 */
  get coupon(): Coupon | null {
    return this.state.coupon;
  }

  /** 获取完整状态（快照） */
  getState(): CartState {
    return this.state;
  }

  /** 按 skuId 查找 */
  findItem(skuId: string): CartItem | undefined {
    return this.state.items.find((i) => i.skuId === skuId);
  }

  /** 购物车事件历史 */
  get history(): CartEvent[] {
    return [...this.state.history];
  }

  // ========== 写操作 ==========

  /**
   * 添加商品到购物车
   * @param product  商品
   * @param quantity 数量
   * @param specs    规格选择
   * @returns 添加后的 CartItem
   */
  addItem(
    product: Product,
    quantity: number = 1,
    specs: Record<string, string> = {}
  ): CartItem {
    if (quantity <= 0) throw new Error("数量必须大于 0");
    if (product.stock < quantity) {
      throw new Error(`库存不足：${product.name} 仅剩 ${product.stock} 件`);
    }

    // 校验规格合法性
    if (product.specs) {
      for (const spec of product.specs) {
        const value = specs[spec.name];
        if (!value || !spec.values.includes(value)) {
          throw new Error(
            `请选择有效的${spec.name}：${spec.values.join(" / ")}`
          );
        }
      }
    }

    const skuId = buildSkuId(product.id, specs);
    const price = product.discountPrice ?? product.price;
    const existing = this.state.items.find((i) => i.skuId === skuId);

    if (existing) {
      // 合并数量
      const newQty = existing.quantity + quantity;
      if (newQty > product.stock) {
        throw new Error(`库存不足：${product.name} 仅剩 ${product.stock} 件`);
      }
      existing.quantity = newQty;
      // 价格可能已更新
      existing.price = price;
    } else {
      this.state.items.push({
        skuId,
        productId: product.id,
        name: product.name,
        price,
        quantity,
        specs,
        imageUrl: product.imageUrl,
        maxQuantity: product.stock,
      });
    }

    this.recordEvent("ITEM_ADDED", product.id, skuId, `+${quantity} ${product.name}`);
    this.touch();
    return this.findItem(skuId)!;
  }

  /**
   * 从购物车移除商品
   */
  removeItem(skuId: string): boolean {
    const idx = this.state.items.findIndex((i) => i.skuId === skuId);
    if (idx === -1) return false;

    const removed = this.state.items.splice(idx, 1)[0];
    this.recordEvent("ITEM_REMOVED", removed.productId, skuId, `-${removed.name}`);
    this.touch();
    return true;
  }

  /**
   * 更新商品数量
   */
  updateQuantity(skuId: string, quantity: number): CartItem {
    if (quantity <= 0) throw new Error("数量必须大于 0");

    const item = this.state.items.find((i) => i.skuId === skuId);
    if (!item) throw new Error(`未找到商品: ${skuId}`);

    if (quantity > item.maxQuantity) {
      throw new Error(`库存不足，最大可购买 ${item.maxQuantity} 件`);
    }

    const oldQty = item.quantity;
    item.quantity = quantity;

    this.recordEvent(
      "QUANTITY_CHANGED",
      item.productId,
      skuId,
      `${item.name}: ${oldQty} → ${quantity}`
    );
    this.touch();
    return item;
  }

  /**
   * 清空购物车
   */
  clear(): void {
    this.state.items = [];
    this.state.coupon = null;
    this.recordEvent("CLEARED", undefined, undefined, "购物车已清空");
    this.touch();
  }

  // ========== 优惠券 ==========

  /**
   * 应用优惠券
   */
  applyCoupon(coupon: Coupon): void {
    // 有效性检查
    const now = new Date();
    if (now < coupon.validFrom || now > coupon.validTo) {
      throw new Error("优惠券不在有效期内");
    }
    if (coupon.usedAt) {
      throw new Error("优惠券已被使用");
    }

    const { subtotal } = this.calcSubtotal();

    // 最低消费检查
    if (coupon.minSpend && subtotal < coupon.minSpend) {
      throw new Error(
        `未达到最低消费 ¥${(coupon.minSpend / 100).toFixed(2)}`
      );
    }

    // 满减门槛检查
    if (
      coupon.type === "满减" &&
      coupon.threshold &&
      subtotal < coupon.threshold
    ) {
      throw new Error(
        `未满 ¥${(coupon.threshold / 100).toFixed(2)}，无法使用该优惠券`
      );
    }

    // 分类限制检查
    if (coupon.applicableCategories) {
      const allMatch = this.state.items.every((item) => {
        // 此处应有更完善的产品分类判断，简化处理
        return true;
      });
    }

    this.state.coupon = coupon;
    this.recordEvent("COUPON_APPLIED", undefined, undefined, `券码: ${coupon.code}`);
    this.touch();
  }

  /**
   * 移除优惠券
   */
  removeCoupon(): void {
    if (this.state.coupon) {
      this.recordEvent(
        "COUPON_REMOVED",
        undefined,
        undefined,
        `移除券码: ${this.state.coupon.code}`
      );
      this.state.coupon = null;
      this.touch();
    }
  }

  // ========== 计算 ==========

  /** 计算商品小计（含折扣） */
  private calcSubtotal(): { subtotal: number; discount: number } {
    let subtotal = 0;
    let discount = 0;

    for (const item of this.state.items) {
      subtotal += item.price * item.quantity;
    }

    return { subtotal, discount };
  }

  /** 计算运费 */
  private calcShipping(subtotal: number): number {
    if (this.state.items.length === 0) return 0;

    const { shippingRule } = this.state;
    if (subtotal >= shippingRule.freeThreshold) return 0;

    let fee = shippingRule.baseFee;
    if (shippingRule.additionalPerItem && this.state.items.length > 1) {
      fee += shippingRule.additionalPerItem * (this.state.items.length - 1);
    }
    return fee;
  }

  /** 计算优惠券减免 */
  private calcCouponDiscount(subtotal: number): number {
    const coupon = this.state.coupon;
    if (!coupon) return 0;

    switch (coupon.type) {
      case "满减":
        return coupon.value;
      case "折扣":
        return Math.round((subtotal * coupon.value) / 100);
      case "免邮":
        // 免邮券不直接减免金额，运费在下游被置为 0
        return 0;
      default:
        return 0;
    }
  }

  /**
   * 获取购物车快照——一次性算清所有费用
   */
  getSnapshot(): CartSnapshot {
    const { subtotal, discount } = this.calcSubtotal();
    const shipping = this.calcShipping(subtotal);
    const couponDiscount = this.calcCouponDiscount(subtotal);
    const total = Math.max(0, subtotal - discount - couponDiscount + shipping);

    // 免邮券：运费已减免到 couponDiscount，不再计运费
    const finalShipping =
      this.state.coupon?.type === "免邮" ? 0 : shipping;

    const finalTotal = Math.max(
      0,
      subtotal - discount - couponDiscount + finalShipping
    );

    const itemCount = this.state.items.reduce(
      (sum, i) => sum + i.quantity,
      0
    );

    return {
      items: [...this.state.items],
      subtotal,
      discount,
      shipping: finalShipping,
      couponDiscount,
      couponApplied: this.state.coupon !== null,
      total: finalTotal,
      itemCount,
      uniqueItemCount: this.state.items.length,
    };
  }

  // ========== 辅助方法 ==========

  private recordEvent(
    type: CartEvent["type"],
    productId?: string,
    skuId?: string,
    detail?: string
  ): void {
    this.state.history.push({
      type,
      timestamp: new Date(),
      productId,
      skuId,
      detail,
    });
  }

  private touch(): void {
    this.state.updatedAt = new Date();
  }

  /** 格式化输出（分 → 元字符串） */
  static formatPrice(cents: number): string {
    return `¥${(cents / 100).toFixed(2)}`;
  }
}
