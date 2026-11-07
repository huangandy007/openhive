/**
 * 实体细类（阶段 1）：大类（`type`）之下的稳定子类，例如「号码 · 手机号」。
 *
 * ## 为什么只做三类
 *
 * 只有**能从值形状或材料里的明确写法稳定判出来**的大类才值得细分。人 / 地点 / 组织 /
 * 车辆 / 物品没有形状规则，只能靠模型猜——错标一次，民警就按错的口径去查，代价比
 * 「只显示大类」大得多。车辆等有样本后再进第二批。
 *
 * ## 两条铁律
 *
 * 1. **fail-closed**：判不出返回 `undefined`，调用方就只显示大类。绝不回退成
 *    「其他号码」这类看起来像结论的兜底。
 * 2. **`attrs.subtype` 优先，但必须在本类白名单里**：材料里明确写着「固定电话」时以
 *    原文为准；模型编一个「涉案号码」这种值一律丢弃、回落形状判定。
 *
 * ## 已知取舍
 *
 * - `号码归一` 已经把分隔符和开头的 `+` 剥掉了（`+8613800138000` 落库是 13 位），
 *   所以手机号要同时认 `86` 前缀。
 * - 16–19 位数字在「号码」类下**不标细类**：那是大类归错了（应归账户），阶段 2 在
 *   入库时纠正；这里标成「银行卡」会让错误的大类看起来是对的。
 */

/** 每类允许的细类。**大类名与 `case_entity.type` 的 CHECK 约束一致。** */
export const 细类白名单 = {
  号码: ["手机号", "身份证", "固定电话"],
  账户: ["银行卡", "银行账号", "第三方支付"],
  虚拟身份: ["邮箱", "QQ", "微信"],
} as const satisfies Record<string, readonly string[]>

function 白名单(大类: string): readonly string[] | undefined {
  // 先 `hasOwn` 再取：直接下标会让 `constructor` / `__proto__` 这类原型键取到东西。
  const 表: Record<string, readonly string[] | undefined> = 细类白名单
  return Object.hasOwn(细类白名单, 大类) ? 表[大类] : undefined
}

/** 年月日是否真实存在。`Date.UTC` 会把 2 月 30 日滚到 3 月，回读年份月份就能识破。 */
function 是日期(年: number, 月: number, 日: number): boolean {
  if (月 < 1 || 月 > 12 || 日 < 1 || 日 > 31) return false
  const 期 = new Date(Date.UTC(年, 月 - 1, 日))
  return 期.getUTCFullYear() === 年 && 期.getUTCMonth() === 月 - 1 && 期.getUTCDate() === 日
}

/** 18 位身份证：地址码 6 ＋ 生日 8（第 7–14 位）＋ 顺序 3 ＋ 校验 1。校验位不验，只验日期。 */
function 是身份证18(值: string): boolean {
  if (!/^\d{17}[\dXx]$/.test(值)) return false
  return 是日期(Number(值.slice(6, 10)), Number(值.slice(10, 12)), Number(值.slice(12, 14)))
}

/** 15 位老身份证：地址码 6 ＋ 生日 6（第 7–12 位，yyMMdd）＋ 顺序 3。 */
function 是身份证15(值: string): boolean {
  if (!/^\d{15}$/.test(值)) return false
  return 是日期(1900 + Number(值.slice(6, 8)), Number(值.slice(8, 10)), Number(值.slice(10, 12)))
}

/** Luhn 校验：银行卡号的自检位。不通过不代表不是账号，只代表不能断言是「银行卡」。 */
function luhn通过(值: string): boolean {
  let 总 = 0
  for (let 序 = 0; 序 < 值.length; 序 += 1) {
    let 位 = 值.charCodeAt(值.length - 1 - 序) - 48
    if (序 % 2 === 1) {
      位 *= 2
      if (位 > 9) 位 -= 9
    }
    总 += 位
  }
  return 总 % 10 === 0
}

function 是邮箱(值: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(值)
}

function 是微信标识(值: string): boolean {
  return /^wxid_[A-Za-z0-9_-]+$/.test(值)
}

function 按形状(大类: string, 值: string): string | undefined {
  if (大类 === "号码") {
    // `+8613800138000` 归一后是 `8613800138000`（13 位）：86 前缀与 11 位手机号都要认。
    if (/^(?:86)?1[3-9]\d{9}$/.test(值)) return "手机号"
    if (是身份证18(值) || 是身份证15(值)) return "身份证"
    // 11 位手机号上面已经拦掉了；这里剩 0 开头的 10–12 位（区号 ＋ 号码）。
    if (/^0\d{9,11}$/.test(值)) return "固定电话"
    return undefined
  }
  if (大类 === "账户") {
    if (/^\d{16,19}$/.test(值)) return luhn通过(值) ? "银行卡" : "银行账号"
    if (是邮箱(值) || 是微信标识(值)) return "第三方支付"
    return undefined
  }
  if (大类 === "虚拟身份") {
    if (是邮箱(值)) return "邮箱"
    if (是微信标识(值)) return "微信"
    // QQ 号：5–11 位、首位非 0。先判邮箱，`12345678@qq.com` 是邮箱不是 QQ。
    if (/^[1-9]\d{4,10}$/.test(值)) return "QQ"
    return undefined
  }
  return undefined
}

/**
 * 判细类：`attrs.subtype`（本类白名单内）优先，否则按值形状；都判不出返回 `undefined`。
 *
 * @param 大类 实体大类（`type` 列的值）
 * @param 规范值 `canonical_value`（**已归一**：分隔符与开头 `+` 已被剥掉）
 * @param attrs 实体 `attrs`（jsonb）的**裸值**：驱动给对象还是 JSON 文本都收，坏值当作没有
 */
export function 细类(大类: string, 规范值: string, attrs?: unknown): string | undefined {
  const 许可 = 白名单(大类)
  if (许可 === undefined) return undefined
  const 写的 = 读attrs(attrs)?.["subtype"]
  if (typeof 写的 === "string" && 许可.includes(写的)) return 写的
  return 按形状(大类, 规范值)
}

/**
 * jsonb 列读回的形状随驱动而变（PGlite 给 JSON 文本，别的驱动可能给对象）；
 * 调用方直接把裸列传进来，这里统一收成对象。坏 JSON / 非对象一律当作没有 attrs。
 */
function 读attrs(原始: unknown): Record<string, unknown> | undefined {
  let 值 = 原始
  if (typeof 值 === "string") {
    try {
      值 = JSON.parse(值)
    } catch {
      return undefined
    }
  }
  if (值 === null || typeof 值 !== "object" || Array.isArray(值)) return undefined
  return 值 as Record<string, unknown>
}
