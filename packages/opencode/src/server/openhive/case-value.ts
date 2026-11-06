export * as OpenhiveCaseValue from "./case-value"

/**
 * 值归一与回读原语。
 *
 * ## 为什么这些不交给模型
 *
 * 设计 §7.4 边界 2：归一化是确定性工作。模型吐 `28万`，我们算 280000；它要是直接吐
 * `280000`，我们反而没法知道这是从原文哪一句来的。所以**只接受原文**，规范值全在这里算。
 *
 * ## 认不出就 undefined
 *
 * 金额/号码解析不出时返回 `undefined`，调用方写 null ＋ 标记存疑——错数字比没数字害人
 * （设计 §7.4 末段、`#011-02`）。
 *
 * ## 三个入口一律先 NFKC
 *
 * 笔录与 OCR 里全角数字（`１３８`）、全角括号（`（）`）、全角逗号很常见。不先做 NFKC
 * 就会「漏认」（`１３８` 不是数字）或「错认」（`（三千）` 认不出括号）。
 */

/** 号码里允许出现、但不携带信息的分隔符。**只剥这些**，绝不用 `\D` 通吃。 */
const 号码分隔符 = /[\s\-－—()（）／/·.]/g

/**
 * 号码归一：**只适用于标识符**（手机号、身份证、账号、卡号），**不得喂整段原文**。
 *
 * 为什么不用 `replace(/\D/g, "")`（上一版就是这么写的，实测出三种静默错）：
 * - `138００１３８０００`（半角＋全角混排）会被截成 `138`——一个看似合法的短号；
 * - `11010119900101123X` 的校验位 `X` 被吃掉，**静默变成另一个身份证号**；
 * - `2026年3月5日` 归成 `202635`，日期串当号码入库。
 *
 * 所以：先 NFKC，只剥分隔符，剩下的必须是「字母数字串且含数字且不短于 3 位」，否则
 * undefined。需要「这段文字里有没有这串数字」时**另写包含判断**，别拿本函数凑。
 */
export function 号码归一(raw: string): string | undefined {
  // `+` 只剥**开头**那一个：`+8613800138000` 的国际前缀要认，但 `12+34` 中间那个加号
  // 不是号码的一部分（剥成 `1234` 就是把两个数拼成一个）。
  const 净 = raw.normalize("NFKC").replace(/^\+/, "").replace(号码分隔符, "")
  if (!/^[0-9A-Za-z]+$/.test(净)) return undefined
  if (!/[0-9]/.test(净)) return undefined
  if (净.length < 3) return undefined
  return 净
}

const 中文数字: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 贰: 2, 两: 2, 三: 3, 叁: 3,
  四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6, 七: 7, 柒: 7, 八: 8, 捌: 8, 九: 9, 玖: 9,
}
const 中文单位: Record<string, number> = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 }

/**
 * 中文整数（大写/小写）。
 *
 * 严格到「看不懂就 undefined」，因为金额算错比认不出害人：
 * - 裸单位（`万`、`百`）不认——单位前面必须有数（`十八` 的 `十` 是唯一例外）；
 * - 连续两个数字位（`一二三`、`二〇二六`）不认——那是年份/编号的写法，不是金额；
 * - 省略写法（`三千五`、`一千二百三`）不认——3500 还是 3005 有歧义，不猜；
 * - `万`、`亿` 各只许出现一次，但**亿后可以跟一个万**（`一亿二千万` 认；`一万二万`、
 *   `一亿二亿`、`一万亿` 不认——`一万亿` 超出现有段结构，fail-closed）；
 * - `零` 只作占位（`一百零三`）。
 */
function 中文整数(s: string): number | undefined {
  let 总 = 0
  let 段 = 0
  let 数 = 0
  let 待乘 = false // 上一个 token 是数字位，正等着乘一个单位
  let 最后单位 = 1 // 用于识别「省略写法」的歧义
  let 零后 = false // 最后一个单位之后出现过「零」
  let 见过万 = false
  let 见过亿 = false

  for (const ch of s) {
    const 位 = 中文数字[ch]
    if (位 !== undefined) {
      if (位 === 0) {
        待乘 = false
        if (最后单位 >= 100) 零后 = true
        continue
      }
      if (待乘) return undefined
      数 = 位
      待乘 = true
      continue
    }

    const 小单位 = 中文单位[ch]
    if (小单位 !== undefined) {
      if (!待乘) {
        if (ch === "十" && 总 === 0 && 段 === 0) 数 = 1
        else return undefined
      }
      段 += 数 * 小单位
      数 = 0
      待乘 = false
      最后单位 = 小单位
      零后 = false
      continue
    }

    if (ch === "万") {
      // 亿后可以再有一个万：`一亿二千万` = 1亿 + 2000万。`一万二万` 仍要拒（`见过万`），
      // `一万亿`（万在亿前）也仍要拒——`亿` 分支要求 `总 === 0`，一万已把 `总` 写成 10000。
      if (见过万) return undefined
      if (!待乘 && 段 === 0) return undefined
      段 += 数
      数 = 0
      待乘 = false
      总 += 段 * 10_000
      段 = 0
      见过万 = true
      最后单位 = 10_000
      零后 = false
      continue
    }

    if (ch === "亿") {
      if (见过亿 || 总 !== 0) return undefined
      if (!待乘 && 段 === 0) return undefined
      段 += 数
      数 = 0
      待乘 = false
      总 = (总 + 段) * 100_000_000
      段 = 0
      见过亿 = true
      最后单位 = 100_000_000
      零后 = false
      continue
    }

    return undefined
  }

  // 省略写法的歧义闸：`三千五`（段 3000 ＋ 尾数 5）可能是 3500 也可能是 3005。
  if (数 > 0 && 数 < 10 && 最后单位 >= 100 && !零后) return undefined

  const 和 = 总 + 段 + 数
  return 和 === 0 && !/[零〇]/.test(s) ? undefined : 和
}

/** `numeric(18,2)` 的整数位上限。超过它落库会整批失败（`case-rows.ts` 同款闸）。 */
const 金额整数位上限 = 16

/** 万 / 亿 是**小数点右移**，不是乘法：全程在字符串上移位，不经过浮点。 */
function 位移位数(后缀: string | undefined): number {
  return 后缀 === "万" ? 4 : 后缀 === "亿" ? 8 : 0
}

export function 金额元(raw: string): number | undefined {
  let s = raw.normalize("NFKC").trim()
  // 币种与单位要**先剥**再判括号：`（三千）元` 的结尾是「元」，先判括号会整个失配，
  // 负数就静默变成 undefined。`元整 / 圆整 / 整 / 正` 是中文会计写法，不认会让回读失败率虚高。
  s = s
    .replace(/^(?:人民币|RMB|CNY|[¥￥])/i, "")
    .replace(/(?:元整|圆整|整|正|元|圆|人民币|RMB|CNY)$/i, "")
    .replace(/\s+/g, "")
  if (s === "") return undefined

  let 负 = false
  const 括号 = /^[（(](.+)[)）]$/.exec(s)
  if (括号) {
    负 = true
    s = 括号[1]
  }
  if (s.startsWith("-")) {
    // `(-1200)`：括号与负号都表示负，是冲突写法。翻转成正数属于猜，直接不认。
    if (负) return undefined
    负 = true
    s = s.slice(1)
  }
  if (s === "") return undefined

  // 千分位必须先验成组再剥：`1234,56` 若先剥逗号会变成 123456（**放大 100 倍**）。
  // 这正是 `case-rows.ts` 的 `parseAmount` 专门挡住的那类事故。
  if (s.includes(",")) {
    // 逗号只约束分组；后缀照旧放行（`1,234.5万` 是合法写法）。
    if (!/^\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:万|亿)?$/.test(s)) return undefined
    s = s.replace(/,/g, "")
  }

  let 元整数: string
  let 元小数: string
  if (/^\d/.test(s)) {
    const 数字 = /^(\d+)(?:\.(\d+))?(万|亿)?$/.exec(s)
    if (!数字) return undefined
    const 整 = 数字[1] ?? ""
    if (整.length > 金额整数位上限) return undefined
    // `1.23456万` = 12345.6 元：小数部分补足位移位后，前 4 位进整数、剩下的留小数。
    const 位移 = 位移位数(数字[3])
    const 补 = (数字[2] ?? "").padEnd(位移, "0")
    元整数 = 整 + 补.slice(0, 位移)
    元小数 = 补.slice(位移)
  } else {
    if (!/^[零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟]+$/.test(s)) return undefined
    const n = 中文整数(s)
    if (n === undefined) return undefined
    元整数 = String(n)
    元小数 = ""
  }

  // 舍到分：只看第三位小数（`1.005 ⇒ 1.01`）。整数部分与分都用**字符串/整数**算——
  // 上一版是 `Math.round((值 + Number.EPSILON) * 100)`，EPSILON 是绝对量，
  // 到百万级就压不住尾差（`1234567.005` 舍成 `1234567`）。这里没有浮点参与。
  if (元整数.replace(/^0+/, "").length > 金额整数位上限) return undefined
  const 分 = Number(元整数) * 100 + Number((元小数 + "00").slice(0, 2))
  if (!Number.isSafeInteger(分)) return undefined
  const 分终 = (元小数 + "000")[2] >= "5" ? 分 + 1 : 分
  const 结果 = 分终 / 100
  // `-0` 不是 `0`（`Object.is(-0, 0) === false`）：留着会让调用方的 `结果 === 0` 判空失效。
  return 负 && 结果 !== 0 ? -结果 : 结果
}

/** 忽略空白与换行差异的包含判断：模型抄原文时经常把换行抄成空格。 */
export function 文本包含(haystack: string, needle: string): boolean {
  const 针 = needle.replace(/\s+/g, "")
  if (针 === "") return false
  return haystack.replace(/\s+/g, "").includes(针)
}

/** 脱敏名（`张某`、`李某`、`X某某`）不是具体的某个人，形近规则不得把它认成某人。 */
const 脱敏位 = /[某〇Xx*]/

/**
 * 人名形近命中（设计 §7.4「允许张叁 / 张三」）。
 *
 * 上一版是「等长、整串差一个字」，实测误报面失控：`李三`、`三千`、`张某` 都能命中「张三」。
 * 两字名差一个字 = 差掉一半姓名信息，所以：
 * - **两字名只认「姓相同、名不同」**（张叁 / 张三）；
 * - 三字及以上才允许整串差一个字；
 * - 任一侧出现脱敏位（`某`、`〇`、`X`、`*`）一律不认；
 * - 长度 1 不做形近（「张」和「李」差一个字，会把所有单字名认成同一个人）。
 */
export function 形近命中(haystack: string, name: string): boolean {
  if (name.length < 2) return false
  if (脱敏位.test(name)) return false
  const 同姓 = name.length === 2
  for (let i = 0; i + name.length <= haystack.length; i++) {
    const 窗口 = haystack.slice(i, i + name.length)
    if (脱敏位.test(窗口)) continue
    if (同姓 && 窗口[0] !== name[0]) continue
    let 差 = 0
    for (let j = 0; j < name.length; j++) {
      if (窗口[j] !== name[j]) 差 += 1
      if (差 > 1) break
    }
    if (差 <= 1) return true
  }
  return false
}

/**
 * `type` 收 `string` 而不是 `实体类型`：类型枚举的源头在 `case-extract.ts`（它建 Schema），
 * 这里再 import 回去就成环了。归一规则只关心「是不是号码」，字符串比较足够。
 *
 * 空白**全部去掉**（不是折成一个）：笔录/OCR 里「张  三」与「张三」是同一个人；
 * 保留空格会让同一个人在各片里裂成两个实体（`case-extract.ts` 用 `类型\u0000规范值` 做去重键）。
 */
export function 实体规范值(type: string, value: string): string | undefined {
  if (type === "号码") return 号码归一(value)
  const 规范 = value.normalize("NFKC").replace(/\s+/g, "")
  return 规范 === "" ? undefined : 规范
}
