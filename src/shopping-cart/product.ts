import type { Product, ProductCategory } from "./types.js";

/** 商品目录——管理所有可购买商品 */
export class ProductCatalog {
  private products: Map<string, Product> = new Map();

  constructor(initialProducts?: Product[]) {
    if (initialProducts) {
      for (const p of initialProducts) {
        this.products.set(p.id, p);
      }
    }
  }

  /** 添加或更新商品 */
  upsert(product: Product): void {
    const now = new Date();
    const existing = this.products.get(product.id);
    this.products.set(product.id, {
      ...product,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  /** 根据 ID 查找 */
  getById(id: string): Product | undefined {
    return this.products.get(id);
  }

  /** 按分类筛选 */
  getByCategory(category: ProductCategory): Product[] {
    return Array.from(this.products.values()).filter(
      (p) => p.category === category
    );
  }

  /** 搜索（名称/描述/标签） */
  search(keyword: string): Product[] {
    const kw = keyword.toLowerCase();
    return Array.from(this.products.values()).filter(
      (p) =>
        p.name.toLowerCase().includes(kw) ||
        p.description.toLowerCase().includes(kw) ||
        p.tags.some((t) => t.toLowerCase().includes(kw))
    );
  }

  /** 价格区间筛选 */
  getByPriceRange(min: number, max: number): Product[] {
    return Array.from(this.products.values()).filter((p) => {
      const price = p.discountPrice ?? p.price;
      return price >= min && price <= max;
    });
  }

  /** 获取所有商品 */
  getAll(): Product[] {
    return Array.from(this.products.values());
  }

  /** 删除商品 */
  remove(id: string): boolean {
    return this.products.delete(id);
  }

  /** 检查库存是否充足 */
  hasStock(id: string, quantity: number = 1): boolean {
    const product = this.products.get(id);
    return product ? product.stock >= quantity : false;
  }

  /** 扣减库存（下单后调用） */
  deductStock(id: string, quantity: number): boolean {
    const product = this.products.get(id);
    if (!product || product.stock < quantity) return false;
    product.stock -= quantity;
    product.updatedAt = new Date();
    return true;
  }

  /** 补回库存（取消订单后调用） */
  restoreStock(id: string, quantity: number): void {
    const product = this.products.get(id);
    if (product) {
      product.stock += quantity;
      product.updatedAt = new Date();
    }
  }
}

// ========== 预置示例商品 ==========

export const defaultProducts: Product[] = [
  {
    id: "p-001",
    name: "无线蓝牙耳机 Pro",
    price: 29900,       // 分 -> ¥299
    category: "电子产品",
    description: "主动降噪，30小时续航，IPX5防水",
    stock: 50,
    specs: [
      { name: "颜色", values: ["曜石黑", "珍珠白", "薄荷绿"] },
    ],
    tags: ["耳机", "蓝牙", "降噪"],
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  },
  {
    id: "p-002",
    name: "机械键盘 K8",
    price: 49900,
    discountPrice: 39900,
    category: "电子产品",
    description: "87键紧凑布局，Cherry MX青轴，RGB背光",
    stock: 30,
    specs: [
      { name: "轴体", values: ["青轴", "红轴", "茶轴"] },
      { name: "背光", values: ["白光", "RGB"] },
    ],
    tags: ["键盘", "机械键盘", "外设"],
    createdAt: new Date("2025-01-15"),
    updatedAt: new Date("2025-01-15"),
  },
  {
    id: "p-003",
    name: "纯棉短袖T恤",
    price: 12900,
    category: "服装",
    description: "100%精梳棉，透气亲肤，宽松版型",
    stock: 200,
    specs: [
      { name: "颜色", values: ["白色", "黑色", "灰色", "藏青"] },
      { name: "尺寸", values: ["S", "M", "L", "XL", "XXL"] },
    ],
    tags: ["T恤", "纯棉", "夏季"],
    createdAt: new Date("2025-02-01"),
    updatedAt: new Date("2025-02-01"),
  },
  {
    id: "p-004",
    name: "《深入理解 TypeScript》",
    price: 7900,
    category: "图书",
    description: "TypeScript 高级类型编程实战，含大量企业级案例",
    stock: 100,
    tags: ["TypeScript", "编程", "前端"],
    createdAt: new Date("2025-03-01"),
    updatedAt: new Date("2025-03-01"),
  },
  {
    id: "p-005",
    name: "不锈钢保温杯 500ml",
    price: 15900,
    category: "家居",
    description: "316不锈钢内胆，72小时保温，一键开盖",
    stock: 80,
    specs: [
      { name: "颜色", values: ["银色", "黑色", "蓝色"] },
    ],
    tags: ["保温杯", "水杯", "家居"],
    createdAt: new Date("2025-03-10"),
    updatedAt: new Date("2025-03-10"),
  },
  {
    id: "p-006",
    name: "运动跑鞋 AirFlow",
    price: 59900,
    discountPrice: 44900,
    category: "运动",
    description: "全掌气垫，透气网面，缓震回弹",
    stock: 40,
    specs: [
      { name: "颜色", values: ["黑色", "白色", "红黑"] },
      { name: "尺码", values: ["39", "40", "41", "42", "43", "44"] },
    ],
    tags: ["跑鞋", "运动", "跑步"],
    createdAt: new Date("2025-04-01"),
    updatedAt: new Date("2025-04-01"),
  },
  {
    id: "p-007",
    name: "氨基酸洁面乳",
    price: 8900,
    category: "美妆",
    description: "温和氨基酸配方，不紧绷，适合敏感肌",
    stock: 150,
    tags: ["洁面", "护肤", "氨基酸"],
    createdAt: new Date("2025-04-10"),
    updatedAt: new Date("2025-04-10"),
  },
  {
    id: "p-008",
    name: "手撕牛肉干 200g",
    price: 3900,
    category: "食品",
    description: "内蒙古风干牛肉，高蛋白低脂肪",
    stock: 500,
    specs: [
      { name: "口味", values: ["原味", "香辣", "孜然"] },
    ],
    tags: ["零食", "牛肉干", "内蒙古"],
    createdAt: new Date("2025-05-01"),
    updatedAt: new Date("2025-05-01"),
  },
];
