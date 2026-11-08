import { 是组织泛称 } from "./case-admission"

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
 * 2. **形状优先，`attrs.subtype` 只补形状判不出的空**：材料里写着「支付宝账号」时用它
 *    （10 位账号没有形状规则）；但材料写「固定电话」压不过 11 位手机号形状——模型给的
 *    类别值没有原文核对机制。越界值（如「涉案号码」）一律丢弃。
 *
 * ## 已知取舍
 *
 * - `号码归一` 已经把分隔符和开头的 `+` 剥掉了（`+8613800138000` 落库是 13 位），
 *   所以手机号要同时认 `86` 前缀。
 * - 16–19 位数字在「号码」类下**不标细类**：那是大类归错了（应归账户）。新数据由
 *   `纠正大类` 在入库前改对；库里已有的旧行走历史修复。这里标成「银行卡」会让错误的
 *   大类看起来是对的。
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
 * 判细类：**形状优先**；形状判不出时才看 `attrs.subtype`（本类白名单内）；都判不出返回 `undefined`。
 *
 * 为什么不是 attrs 优先：`attrs.subtype` 是模型从原文抄的类别词，**没有原文核对机制**
 * （不像金额 / 时间那样回读校验）。让它盖掉确定性形状，等于把「模型说的类型」重新变成
 * 权威——大类归错正是不信形状、只信模型的结果。形状是确定性结论，模型只能补形状判不出的空。
 *
 * @param 大类 实体大类（`type` 列的值）
 * @param 规范值 `canonical_value`（**已归一**：分隔符与开头 `+` 已被剥掉）
 * @param attrs 实体 `attrs`（jsonb）的**裸值**：驱动给对象还是 JSON 文本都收，坏值当作没有
 */
export function 细类(大类: string, 规范值: string, attrs?: unknown): string | undefined {
  const 形 = 按形状(大类, 规范值)
  if (形 !== undefined) return 形
  const 许可 = 白名单(大类)
  if (许可 === undefined) return undefined
  const 写的 = 读attrs(attrs)?.["subtype"]
  if (typeof 写的 === "string" && 许可.includes(写的)) return 写的
  return undefined
}

/**
 * 入库时决定「材料里写的细类要不要落库」：只收**形状判不出、且在本类白名单内**的那一个。
 *
 * 形状判得出的不落库，有两个理由：一是读侧（[[细类]]）本来就以形状为准，存了也不会用；
 * 二是存下来会让下一个人以为「原文明明写了固定电话，为什么显示手机号」是 bug。
 *
 * @param 写的 模型输出里的细类**裸值**（可能不是字符串，一律判掉）
 * @returns 可存进 `attrs.subtype` 的值；不采纳返回 `undefined`
 */
export function 采纳细类(大类: string, 规范值: string, 写的: unknown): string | undefined {
  if (按形状(大类, 规范值) !== undefined) return undefined
  const 许可 = 白名单(大类)
  if (许可 === undefined) return undefined
  return typeof 写的 === "string" && 许可.includes(写的) ? 写的 : undefined
}

/**
 * 人名的组织后缀（阶段 B）：模型把「柏加派出所」标成「人」时，入库前改成「组织」。
 *
 * 不用裸 `局 / 所 / 院`：会把「王局」「李院」这类人名误改。只认完整的机构后缀词。
 * 不以机构后缀结尾的组织泛称（`鉴定机构 / 林业部门 / …`）复用准入那份词表
 * （`是组织泛称`），不另抄一份（`#002-06`）。
 * `纠正大类` 的调用方（入库写实体、`端点()` 查关系两端）必须都用返回值。
 */
const 组织后缀们 = [
  "派出所",
  "公安局",
  "法院",
  "检察院",
  "村委会",
  "居委会",
  "委员会",
  "管理局",
  "公司",
  "银行",
  "学校",
  "医院",
  "事务所",
  "鉴定所",
  "营业厅",
  "运营商",
  "林业局",
] as const

function 是组织名(值: string): boolean {
  return 是组织泛称(值) || 组织后缀们.some((后缀) => 值.endsWith(后缀))
}

/**
 * 大类纠正（阶段 2）：模型把卡号写成「号码」时，入库前把大类改对。
 *
 * **只动形状与现值互相矛盾的三处**，其余一律原样返回（fail-closed）：
 * - `号码` ＋ 16–19 位数字 ⇒ `账户`。18 位身份证形状例外——那是真号码，不是卡号。
 * - `账户` ＋ 身份证形状 ⇒ `号码`。
 * - `人` ＋ 组织后缀 ⇒ `组织`（阶段 B）。
 *
 * Luhn 不参与判断方向：自检不过的卡号仍然是账号，只是细类叫「银行账号」不叫「银行卡」。
 * 位数窗口外（≤15 / ≥20）不猜——那可能是长编号，改错大类比不标更害人。
 * 「账户 ＋ 邮箱」也不动：支付宝账号与社交邮箱在这里没有形状差别，交人判。
 *
 * @returns 纠正后的大类。调用方必须用返回值算 `事实id` 与落库，否则会写出一条错类实体。
 */
export function 纠正大类(大类: string, 规范值: string): string {
  if (大类 === "人") return 是组织名(规范值) ? "组织" : "人"
  const 是证件号 = 是身份证18(规范值) || 是身份证15(规范值)
  if (大类 === "号码") return !是证件号 && /^\d{16,19}$/.test(规范值) ? "账户" : 大类
  if (大类 === "账户") return 是证件号 ? "号码" : 大类
  return 大类
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
