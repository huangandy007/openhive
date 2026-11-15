/** 秒 → `YYYY-MM-DD HH:mm`（本地时区）。**手写格式化**：`toLocaleString` 的输出随语言环境漂，测不了。 */
export function 时间文本(秒: number | null): string {
  if (秒 === null) return "时间未知"
  const 日 = new Date(秒 * 1000)
  const 补 = (值: number) => String(值).padStart(2, "0")
  return `${日.getFullYear()}-${补(日.getMonth() + 1)}-${补(日.getDate())} ${补(日.getHours())}:${补(日.getMinutes())}`
}

/** 秒 → `YYYY-MM-DD`（本地时区）。同 `时间文本`：手写，不用随语言环境漂的 `toLocale*`。 */
export function 日期文本(秒: number): string {
  const 日 = new Date(秒 * 1000)
  const 补 = (值: number) => String(值).padStart(2, "0")
  return `${日.getFullYear()}-${补(日.getMonth() + 1)}-${补(日.getDate())}`
}

/** 精度只到日/月/年时，时间戳里的时分是 0 点占位——显示它等于替抽取器编一个时刻。 */
const 粗精度 = new Set(["到年", "到月", "到日"])

/**
 * 按精度给展示时间：粗精度只出日期（时分是占位，不显示）；`null` ⇒ 「时间未知」。
 * 同一前提（粗精度不补时分）只在这里写一次，时间线与资金页共用（`#002-06`）。
 */
export function 精度时间文本(秒: number | null, 精度: string | null): string {
  if (秒 === null) return "时间未知"
  if (粗精度.has(精度 ?? "")) return 日期文本(秒)
  return 时间文本(秒)
}

/** 金额是 numeric 字符串，**不转 Number**（§8.2 的口径：别自己转浮点）。 */
export function 金额文本(值: string | null): string {
  return 值 === null ? "—" : `${值} 元`
}

/** `citation.locator` 是 JSONB，形状随抽取方式变：认得就写人话，认不得就什么都不写（不编）。 */
export function 定位文本(locator: unknown): string {
  if (locator === null || typeof locator !== "object") return ""
  const 记 = locator as { sheet?: unknown; row?: unknown }
  const 部: string[] = []
  if (typeof 记.sheet === "string" && 记.sheet !== "") 部.push(记.sheet)
  if (typeof 记.row === "number") 部.push(`第 ${记.row} 行`)
  return 部.join(" · ")
}
