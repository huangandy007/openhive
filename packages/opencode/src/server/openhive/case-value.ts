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
 * （设计 §7.4 末段）。
 */
export function 号码归一(raw: string): string | undefined {
  const 数字 = raw.replace(/\D/g, "")
  return 数字 === "" ? undefined : 数字
}

const 中文数字: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 贰: 2, 两: 2, 三: 3, 叁: 3,
  四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6, 七: 7, 柒: 7, 八: 8, 捌: 8, 九: 9, 玖: 9,
}
const 中文单位: Record<string, number> = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 }

function 中文整数(s: string): number | undefined {
  let 总 = 0
  let 段 = 0
  let 数 = 0
  for (const ch of s) {
    if (中文数字[ch] !== undefined) {
      数 = 中文数字[ch]!
      continue
    }
    if (中文单位[ch] !== undefined) {
      if (数 === 0) 数 = 1
      段 += 数 * 中文单位[ch]!
      数 = 0
      continue
    }
    if (ch === "万") {
      段 += 数
      总 += (段 === 0 ? 1 : 段) * 10_000
      段 = 0
      数 = 0
      continue
    }
    if (ch === "亿") {
      段 += 数
      总 = (总 + 段) * 100_000_000
      段 = 0
      数 = 0
      continue
    }
    return undefined
  }
  return 总 + 段 + 数
}

export function 金额元(raw: string): number | undefined {
  let s = raw.trim().replace(/[,，\s]/g, "")
  if (s === "") return undefined
  // 币种符号与单位要**先剥**再判括号：`（三千）元` 的结尾是「元」，
  // 先判括号会整个失配，负数就静默变成 undefined。
  s = s.replace(/^[¥￥]/, "").replace(/(元|圆|人民币|RMB|CNY)$/i, "")
  if (s === "") return undefined
  let 负 = false
  const 括号 = /^[（(](.+)[)）]$/.exec(s)
  if (括号) {
    负 = true
    s = 括号[1]!
  }
  if (s.startsWith("-")) {
    负 = !负
    s = s.slice(1)
  }

  let 值: number | undefined
  const 数字 = /^(\d+(?:\.\d+)?)(万|亿)?$/.exec(s)
  if (数字) {
    const n = Number(数字[1])
    if (!Number.isFinite(n)) return undefined
    值 = n * (数字[2] === "万" ? 10_000 : 数字[2] === "亿" ? 100_000_000 : 1)
  } else {
    const 中文 = /^([零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟]+)(万|亿)?$/.exec(s)
    if (!中文) return undefined
    const n = 中文整数(中文[1]!)
    if (n === undefined) return undefined
    值 = n * (中文[2] === "万" ? 10_000 : 中文[2] === "亿" ? 100_000_000 : 1)
  }
  const 结果 = Math.round(值 * 100) / 100
  return 负 ? -结果 : 结果
}

/** 忽略空白与换行差异的包含判断：模型抄原文时经常把换行抄成空格。 */
export function 文本包含(haystack: string, needle: string): boolean {
  const 针 = needle.replace(/\s+/g, "")
  if (针 === "") return false
  return haystack.replace(/\s+/g, "").includes(针)
}

/**
 * 人名形近命中（设计 §7.4「允许张叁 / 张三」）。
 *
 * 只允许**等长、差一个字**，且那个变体必须真的出现在原文里；长度 1 不做形近——
 * 「张」和「李」差一个字，形近规则会把所有单字名认成同一个。
 */
export function 形近命中(haystack: string, name: string): boolean {
  if (name.length < 2) return false
  for (let i = 0; i + name.length <= haystack.length; i++) {
    let 差 = 0
    for (let j = 0; j < name.length; j++) {
      if (haystack[i + j] !== name[j]) 差 += 1
      if (差 > 1) break
    }
    if (差 <= 1) return true
  }
  return false
}

/**
 * `type` 收 `string` 而不是 `实体类型`：类型枚举的源头在 `case-extract.ts`（它建 Schema），
 * 这里再 import 回去就成环了。归一规则只关心「是不是号码」，字符串比较足够。
 */
export function 实体规范值(type: string, value: string): string | undefined {
  if (type === "号码") return 号码归一(value)
  const 规范 = value.normalize("NFKC").trim().replace(/\s+/g, " ")
  return 规范 === "" ? undefined : 规范
}
