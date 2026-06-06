import { describe, it, expect, beforeEach } from "vitest";
import { ShoppingCart } from "../cart.js";
import { ProductCatalog, defaultProducts } from "../product.js";
import { CouponManager, defaultCoupons } from "../discount.js";
import type { Product } from "../types.js";

describe("ShoppingCart", () => {
  let cart: ShoppingCart;
  let catalog: ProductCatalog;
  let couponMgr: CouponManager;

  beforeEach(() => {
    cart = new ShoppingCart();
    catalog = new ProductCatalog(defaultProducts);
    couponMgr = new CouponManager(defaultCoupons);
  });

  // ========== 商品添加 ==========

  it("应该能添加商品到购物车", () => {
    const book = catalog.getById("p-004")!;
    cart.addItem(book, 2);

    const snap = cart.getSnapshot();
    expect(snap.itemCount).toBe(2);
    expect(snap.uniqueItemCount).toBe(1);
  });

  it("应该能添加带规格的商品", () => {
    const tshirt = catalog.getById("p-003")!;
    cart.addItem(tshirt, 1, { 颜色: "黑色", 尺寸: "L" });

    const item = cart.items[0];
    expect(item.specs).toEqual({ 颜色: "黑色", 尺寸: "L" });
    expect(item.skuId).toContain("p-003");
  });

  it("相同 SKU 应合并数量", () => {
    const tshirt = catalog.getById("p-003")!;
    cart.addItem(tshirt, 1, { 颜色: "白色", 尺寸: "M" });
    cart.addItem(tshirt, 2, { 颜色: "白色", 尺寸: "M" });

    expect(cart.items.length).toBe(1);
    expect(cart.items[0].quantity).toBe(3);
  });

  it("不同规格应作为不同项", () => {
    const tshirt = catalog.getById("p-003")!;
    cart.addItem(tshirt, 1, { 颜色: "白色", 尺寸: "M" });
    cart.addItem(tshirt, 1, { 颜色: "黑色", 尺寸: "M" });

    expect(cart.items.length).toBe(2);
  });

  it("无效规格应抛出错误", () => {
    const tshirt = catalog.getById("p-003")!;
    expect(() => {
      cart.addItem(tshirt, 1, { 颜色: "紫色" });
    }).toThrow("请选择有效的颜色");
  });

  it("库存不足时应抛出错误", () => {
    const lowStock: Product = {
      ...defaultProducts[0],
      stock: 2,
    };
    catalog.upsert(lowStock);

    expect(() => {
      cart.addItem(lowStock, 3, { 颜色: "曜石黑" });
    }).toThrow("库存不足");
  });

  // ========== 商品移除 ==========

  it("应该移除商品", () => {
    const book = catalog.getById("p-004")!;
    cart.addItem(book, 2);

    const skuId = cart.items[0].skuId;
    const result = cart.removeItem(skuId);

    expect(result).toBe(true);
    expect(cart.items.length).toBe(0);
  });

  it("移除不存在的商品应返回 false", () => {
    expect(cart.removeItem("not-exist")).toBe(false);
  });

  // ========== 数量修改 ==========

  it("应更新数量", () => {
    const book = catalog.getById("p-004")!;
    cart.addItem(book, 1);

    const skuId = cart.items[0].skuId;
    cart.updateQuantity(skuId, 5);

    expect(cart.items[0].quantity).toBe(5);
  });

  it("数量超过库存时应抛出错误", () => {
    const book = catalog.getById("p-004")!;
    cart.addItem(book, 1);

    const skuId = cart.items[0].skuId;
    expect(() => cart.updateQuantity(skuId, 999)).toThrow("库存不足");
  });

  // ========== 清空 ==========

  it("应清空购物车", () => {
    cart.addItem(catalog.getById("p-004")!, 2);
    cart.addItem(catalog.getById("p-005")!, 1, { 颜色: "黑色" });
    cart.clear();

    expect(cart.items.length).toBe(0);
    expect(cart.getSnapshot().itemCount).toBe(0);
    expect(cart.getSnapshot().total).toBe(0);
  });

  // ========== 金额计算 ==========

  it("应正确计算总价（无折扣无运费）", () => {
    const book = catalog.getById("p-004")!; // ¥79
    cart.addItem(book, 2);

    const snap = cart.getSnapshot();
    expect(snap.subtotal).toBe(15800);        // 79 * 2
    expect(snap.total).toBe(15800);           // 满99免邮 => 免邮
  });

  it("应计算折扣价", () => {
    const keyboard = catalog.getById("p-002")!; // 原价¥499，折扣价¥399
    cart.addItem(keyboard, 1, { 轴体: "红轴", 背光: "RGB" });

    const snap = cart.getSnapshot();
    expect(snap.subtotal).toBe(39900);
  });

  it("不足免邮门槛应计算运费", () => {
    cart.addItem(catalog.getById("p-004")!, 1); // ¥39 -> ¥39 不够免邮

    const snap = cart.getSnapshot();
    expect(snap.subtotal).toBe(7900);
    expect(snap.shipping).toBe(1000);            // ¥10 运费
    expect(snap.total).toBe(8900);
  });

  it("达到免邮门槛应免运费", () => {
    const keyboard = catalog.getById("p-002")!; // ¥399
    cart.addItem(keyboard, 1, { 轴体: "红轴", 背光: "RGB" });

    const snap = cart.getSnapshot();
    expect(snap.subtotal).toBe(39900);
    expect(snap.shipping).toBe(0);
    expect(snap.total).toBe(39900);
  });

  // ========== 优惠券 ==========

  it("应应用满减优惠券", () => {
    const keyboard = catalog.getById("p-002")!; // ¥399
    cart.addItem(keyboard, 1, { 轴体: "红轴", 背光: "RGB" });

    const coupon = couponMgr.validate("NEW10");  // 满100减10
    cart.applyCoupon(coupon);

    const snap = cart.getSnapshot();
    expect(snap.couponDiscount).toBe(1000);
    expect(snap.total).toBe(38900);              // 39900 - 1000
  });

  it("应应用折扣优惠券", () => {
    const keyboard = catalog.getById("p-002")!; // ¥399
    cart.addItem(keyboard, 1, { 轴体: "红轴", 背光: "RGB" });

    const coupon = couponMgr.validate("VIP8");   // 8折
    cart.applyCoupon(coupon);

    const snap = cart.getSnapshot();
    expect(snap.couponDiscount).toBe(7980);      // 39900 * 20%
    expect(snap.total).toBe(31920);
  });

  it("应应用免邮优惠券", () => {
    cart.addItem(catalog.getById("p-004")!, 1);  // ¥39，不足免邮

    const coupon = couponMgr.validate("FREESHIP");
    cart.applyCoupon(coupon);

    const snap = cart.getSnapshot();
    expect(snap.shipping).toBe(0);               // 免邮券抵扣运费
    expect(snap.total).toBe(7900);
  });

  it("不满门槛时优惠券应报错", () => {
    cart.addItem(catalog.getById("p-004")!, 1);  // ¥39

    expect(() => {
      const coupon = couponMgr.validate("NEW10"); // 满100
      cart.applyCoupon(coupon);
    }).toThrow("最低消费");
  });

  it("应移除优惠券", () => {
    const keyboard = catalog.getById("p-002")!;
    cart.addItem(keyboard, 1, { 轴体: "红轴", 背光: "RGB" });

    const coupon = couponMgr.validate("VIP8");
    cart.applyCoupon(coupon);
    expect(cart.coupon).not.toBeNull();

    cart.removeCoupon();
    expect(cart.coupon).toBeNull();
  });

  // ========== 事件审计 ==========

  it("应记录操作事件", () => {
    const book = catalog.getById("p-004")!;
    cart.addItem(book, 1);
    cart.removeItem(cart.items[0].skuId);
    cart.addItem(book, 2);
    cart.clear();

    expect(cart.history.length).toBe(4);
    expect(cart.history[0].type).toBe("ITEM_ADDED");
    expect(cart.history[1].type).toBe("ITEM_REMOVED");
    expect(cart.history[2].type).toBe("ITEM_ADDED");
    expect(cart.history[3].type).toBe("CLEARED");
  });

  // ========== 复杂场景 ==========

  it("混合场景：多商品+优惠券+运费", () => {
    // 耳机 ¥299（选颜色） + 键盘 ¥399（选轴体/背光）
    const earphone = catalog.getById("p-001")!;
    const keyboard = catalog.getById("p-002")!;

    cart.addItem(earphone, 1, { 颜色: "珍珠白" });
    cart.addItem(keyboard, 1, { 轴体: "红轴", 背光: "RGB" });

    let snap = cart.getSnapshot();
    expect(snap.subtotal).toBe(69800);            // 29900 + 39900
    expect(snap.shipping).toBe(0);                // 满99免邮
    expect(snap.uniqueItemCount).toBe(2);

    // 应用 8 折券
    const coupon = couponMgr.validate("VIP8");
    cart.applyCoupon(coupon);

    snap = cart.getSnapshot();
    const expectedDiscount = Math.round(69800 * 0.2);
    expect(snap.couponDiscount).toBe(expectedDiscount);
    expect(snap.total).toBe(69800 - expectedDiscount);
  });

  // ========== 库存管理 ==========

  it("下单后应扣减库存", () => {
    const keyboard = catalog.getById("p-002")!;
    const initialStock = keyboard.stock;

    catalog.deductStock(keyboard.id, 2);

    expect(catalog.getById("p-002")!.stock).toBe(initialStock - 2);
  });

  it("取消订单应恢复库存", () => {
    const keyboard = catalog.getById("p-002")!;
    const initialStock = keyboard.stock;

    catalog.deductStock(keyboard.id, 2);
    catalog.restoreStock(keyboard.id, 2);

    expect(catalog.getById("p-002")!.stock).toBe(initialStock);
  });
});
