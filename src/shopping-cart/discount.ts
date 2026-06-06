import type { Coupon, CouponType } from "./types.js";

/** 优惠券管理 */
export class CouponManager {
  private coupons: Map<string, Coupon> = new Map();

  constructor(initialCoupons?: Coupon[]) {
    if (initialCoupons) {
      for (const c of initialCoupons) {
        this.coupons.set(c.id, c);
      }
    }
  }

  /** 添加优惠券 */
  add(coupon: Coupon): void {
    this.coupons.set(coupon.id, coupon);
  }

  /** 按 ID 获取 */
  getById(id: string): Coupon | undefined {
    return this.coupons.get(id);
  }

  /** 按券码查找 */
  getByCode(code: string): Coupon | undefined {
    return Array.from(this.coupons.values()).find((c) => c.code === code);
  }

  /** 获取所有可用优惠券 */
  getAvailable(): Coupon[] {
    const now = new Date();
    return Array.from(this.coupons.values()).filter(
      (c) => c.validFrom <= now && now <= c.validTo && !c.usedAt
    );
  }

  /** 标记优惠券已使用 */
  markUsed(id: string): boolean {
    const coupon = this.coupons.get(id);
    if (!coupon) return false;
    coupon.usedAt = new Date();
    return true;
  }

  /** 获取所有优惠券 */
  getAll(): Coupon[] {
    return Array.from(this.coupons.values());
  }

  /** 校验并返回可用优惠券 */
  validate(code: string): Coupon {
    const coupon = this.getByCode(code);
    if (!coupon) throw new Error(`优惠券不存在: ${code}`);

    const now = new Date();
    if (now < coupon.validFrom || now > coupon.validTo) {
      throw new Error("优惠券已过期");
    }
    if (coupon.usedAt) {
      throw new Error("优惠券已被使用");
    }

    return coupon;
  }
}

// ========== 预置优惠券 ==========

export const defaultCoupons: Coupon[] = [
  {
    id: "c-001",
    code: "NEW10",
    type: "满减",
    threshold: 10000,       // 满 ¥100
    value: 1000,            // 减 ¥10
    description: "新用户满100减10",
    validFrom: new Date("2025-01-01"),
    validTo: new Date("2026-12-31"),
    minSpend: 10000,
  },
  {
    id: "c-002",
    code: "VIP8",
    type: "折扣",
    value: 20,              // 打 8 折（20% off）
    description: "全场8折，最高优惠不设限",
    validFrom: new Date("2025-01-01"),
    validTo: new Date("2026-12-31"),
    minSpend: 5000,
  },
  {
    id: "c-003",
    code: "FREESHIP",
    type: "免邮",
    value: 0,
    description: "全场免邮（不限金额）",
    validFrom: new Date("2025-01-01"),
    validTo: new Date("2026-12-31"),
  },
  {
    id: "c-004",
    code: "SUMMER50",
    type: "满减",
    threshold: 20000,
    value: 5000,
    description: "夏季狂欢满200减50",
    validFrom: new Date("2025-06-01"),
    validTo: new Date("2025-08-31"),
    minSpend: 20000,
  },
];

/** 生成随机优惠券码 */
export function generateCouponCode(length: number = 8): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** 批量创建优惠券 */
export function createCouponBatch(
  template: {
    type: CouponType;
    value: number;
    threshold?: number;
    description: string;
  },
  count: number,
  validDays: number = 30
): Coupon[] {
  const now = new Date();
  const validTo = new Date(now.getTime() + validDays * 86400000);
  const batch: Coupon[] = [];

  for (let i = 0; i < count; i++) {
    batch.push({
      id: `batch-${Date.now()}-${i}`,
      code: generateCouponCode(),
      type: template.type,
      value: template.value,
      threshold: template.threshold,
      description: template.description,
      validFrom: now,
      validTo,
    });
  }

  return batch;
}
