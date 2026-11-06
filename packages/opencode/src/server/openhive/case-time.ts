export * as OpenhiveCaseTime from "./case-time"

/**
 * 把表格里的时间文本解析成「Unix 秒 ＋ 精度」。
 *
 * ## 时区
 *
 * 一律按 **Asia/Shanghai（固定 UTC+8）** 解释。中国自 1991 年起没有夏令时 ⇒ 固定偏移是
 * 确定的；用 `Date.UTC` 再减 8 小时，**不许**用 `new Date("2026-01-02 03:04:05")`
 * ——那条路按进程时区漂，同一份文件在不同机器上落到不同的秒。
 *
 * ## 为什么只认这几种格式
 *
 * 认得出才写；认不出返回 `undefined`，调用方把**原文**留在 `started_raw` 里（设计 §4.2
 * 「原始值从未被改写」）。宁可少认，不可猜。
 */
export type Precision = "到日" | "到分" | "到秒"

export interface ParsedTime {
  seconds: number
  precision: Precision
}

const TZ_OFFSET_SECONDS = 8 * 3600

const 到秒 = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/
const 到分 = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})$/
const 到日 = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/
const 紧凑 = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/

/** `Date.UTC` 会自动进位（2 月 31 日变成 3 月 3 日），所以喂进去再读回来逐个字段比。 */
function 组装(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  precision: Precision,
): ParsedTime | undefined {
  const ms = Date.UTC(y, mo - 1, d, h, mi, s)
  const t = new Date(ms)
  if (
    t.getUTCFullYear() !== y ||
    t.getUTCMonth() !== mo - 1 ||
    t.getUTCDate() !== d ||
    t.getUTCHours() !== h ||
    t.getUTCMinutes() !== mi ||
    t.getUTCSeconds() !== s
  ) {
    return undefined
  }
  return { seconds: Math.floor(ms / 1000) - TZ_OFFSET_SECONDS, precision }
}

export function parseTime(raw: string): ParsedTime | undefined {
  const text = raw.trim()
  const m秒 = 到秒.exec(text)
  if (m秒) {
    return 组装(+m秒[1]!, +m秒[2]!, +m秒[3]!, +m秒[4]!, +m秒[5]!, +m秒[6]!, "到秒")
  }
  const m分 = 到分.exec(text)
  if (m分) {
    return 组装(+m分[1]!, +m分[2]!, +m分[3]!, +m分[4]!, +m分[5]!, 0, "到分")
  }
  const m日 = 到日.exec(text)
  if (m日) {
    return 组装(+m日[1]!, +m日[2]!, +m日[3]!, 0, 0, 0, "到日")
  }
  const m紧 = 紧凑.exec(text)
  if (m紧) {
    return 组装(+m紧[1]!, +m紧[2]!, +m紧[3]!, +m紧[4]!, +m紧[5]!, +m紧[6]!, "到秒")
  }
  return undefined
}
