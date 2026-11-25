/**
 * 银行卡流水（平台统一 41 列格式）→ 事实行（result.json）
 *
 * 平台按「调取证据」导出的各家银行流水共用同一套 41 列表头：
 *   查询账号（本方卡号）、交易对方名称/账卡号/开户行/证件号码、交易金额、交易余额、
 *   借贷标志、交易类型、交易是否成功、交易时间、商户名称……
 * 字段可能小幅调整，但上述语义保持稳定；必需列缺失或状态值不认识时整份拒收，绝不猜。
 *
 * 契约（`016-adaptive-format-ingest/contracts/`）：
 *   - 内核以 cwd = 技能目录启动：`bun run convert.ts <原件绝对路径>`
 *     （原件路径同时经 argv[2] 与 OPENHIVE_INPUT_PATH 两条通道给出）
 *   - 只产出 `output.file` 一个 JSON：`{ rows, report }`，两段互不混写
 *   - 退出码：0 转换完成；3 闸门拒收（rows 为空，只交 report）；1 转换器异常
 *
 * 设计铁律：
 *   - 纯函数、确定性：不连库、不调模型、不发网络、不读技能目录以外的文件；无时钟、无随机数
 *   - 借贷标志是方向权威：借=付、贷=收；金额永远取绝对值、两位小数字符串
 *   - rowNo 是源文件 Excel 行号（含表头偏移），不是数组下标
 *   - 时间统一按 Asia/Shanghai 解释成 Unix 秒，认不出就跳过并记原因
 *   - 户名不是属性：对方户名 → counterpartyName；开户行/证件号 → 属性:对方:<键>
 *   - 『商户名称』是摘要/分期说明（如「分期还款 本金 第4/36期」），不是户名，不写
 *   - 阈值与必需列只在 adapter.json 里出现一次（本文件读取，不写第二份数字）
 */
import * as XLSX from "./vendor/xlsx.mjs"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

// ─────────────────────────────────────────────────────────────
// 对外类型
// ─────────────────────────────────────────────────────────────

export type 精度 = "到日" | "到分" | "到秒"

export interface 事实行 {
  sheet: string
  rowNo: number
  startedAt: number
  startedRaw: string
  precision: 精度
  timeType: "发生"
  amount: string
  balance?: string
  direction: "收" | "付"
  ownerAccount: string
  ownerAccountRaw: string
  counterparty: string
  counterpartyRaw: string
  counterpartyName?: string
  currency: string
  extras: Record<string, string>
}

/**
 * 值闸条目。字段名必须与内核契约 `converter-output-contract.md` 一致：
 * `case-ingest.ts` 的 `第一个失败闸` 只认 `检查项` / `通过率` / `阈值`，写成 `项` / `实际率`
 * 会让「值闸不过」被误报成「失败:转换器异常」。
 */
export interface 闸结果 {
  闸: "值"
  检查项: string
  分母: number
  命中: number
  通过率: number
  阈值: number
}

export interface 报告 {
  adapterId: string
  adapterVersion: string
  sourceSha256: string
  source: {
    文件名: string
    字节数: number
    工作表们: { 名称: string; 表头行: number; 数据行: number }[]
  }
  headerGate: { 通过: boolean; 缺列: string[] }
  gates: 闸结果[]
  counts: { 总行: number; 产出: number; 跳过: number }
  warnings: { sheet: string; rowNo: number; code: string; detail: string }[]
  /** 跳过行的金额只在源文件该格可解析时出现；空行/合计行没有金额。 */
  skippedRows: { sheet: string; rowNo: number; 原因: string; 金额?: string }[]
  /** 按原因聚合的跳过行数与金额（绝对值，两位小数）；整份拒收时为空。 */
  跳过汇总: { 原因: string; 行数: number; 金额合计: string }[]
}

export interface 转换结果 {
  rows: 事实行[]
  report: 报告
  /** true = 表头闸或值闸不过，整份拒收（rows 必为空）。 */
  拒收: boolean
}

export interface 识别卡 {
  id: string
  version: string
  attributeKeys: string[]
  match: { requiredHeaders: string[]; optionalHeaders: string[]; priority: number }
  status: { success: string[]; failure: string[] }
  /**
   * 借贷标志里的「非交易」值（如广发信用卡的 `O` = 年费减免等无资金变动行）。
   * 只认这里声明的字面值：它们不进方向闸分母、逐行跳过；未声明的值仍按整份拒收处理。
   */
  nonTransactionFlags?: string[]
  bankNameDeny: string[]
  admission: { checks: string[]; thresholds: Record<string, number> }
  output: { file: string }
}

// ─────────────────────────────────────────────────────────────
// 常量与基础解析（与内核 case-time.ts / case-rows.ts 同一组语义）
// ─────────────────────────────────────────────────────────────

const 时区偏移秒 = 8 * 3600
const 最大金额整数位 = 16
const 空值 = (文本: string) => 文本 === "" || 文本 === "-"

const 合计形状 = /^(本页)?合\s*计(金额)?\s*[:：]?\s*[\d,，]*(\.\d{1,2})?\s*$/
const 小计形状 = /^(本页)?小\s*计(金额)?\s*[:：]?\s*[\d,，]*(\.\d{1,2})?\s*$/

export function 文本值(值: unknown): string {
  return String(值 ?? "").trim()
}

/** 标准列取值：源文件的 `-` 是「无」的占位，标准列不留它。 */
export function 取值(值: unknown): string {
  const 文 = 文本值(值)
  return 空值(文) ? "" : 文
}

/** 全角数字/字母/加号/斜杠转半角（与内核一致）。 */
function 全角转半角(v: string): string {
  return v.replace(/[０-９Ａ-Ｚａ-ｚ＋－／]/g, (字符) => String.fromCharCode(字符.charCodeAt(0) - 0xfee0))
}

/** 账号归一化：全角转半角、去空白与横线。与 `case-field-registry.ts` 的 `去横线` 同义。 */
export function 归一化账号(原值: string): string {
  return 全角转半角(原值).replace(/[\s　-]/g, "")
}

/** 与内核 `是账户形状` 同一条：纯数字 6–32 位，或 `@wx.tenpay.com` 后缀账号（大小写不敏感）。 */
export function 是账户形状(原值: string): boolean {
  const v = 原值.trim()
  return /^\d{6,32}$/.test(v.replace(/[\s-]/g, "")) || /^[^@\s]+@wx\.tenpay\.com$/i.test(v.replace(/\s/g, ""))
}

/**
 * 开户行应是**名称**；纯数字是行号/联行号代码（样本里有「991…49」「484…02」）。
 * 把代码当开户行入库，会让「这个账户的开户行是什么」答出一串数字。
 */
export function 是开户行名称(原值: string): boolean {
  const v = 原值.trim()
  return v !== "" && !/^\d+$/.test(v)
}

/** 金额解析：去货币符号与空白；千分位逗号先验分组再剥。返回两位小数字符串（可能带负号）。 */
export function 解析金额(原值: string): string | null {
  const 干净 = 原值.replace(/[\s　￥¥$]/g, "").replace(/，/g, ",")
  if (干净 === "") return null
  if (干净.includes(",")) {
    if (!/^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(干净)) return null
  } else if (!/^-?\d+(\.\d{1,2})?$/.test(干净)) {
    return null
  }
  const [整数 = "", 小数 = ""] = 干净.replace(/,/g, "").split(".")
  if (整数.replace(/^-/, "").length > 最大金额整数位) return null
  return `${整数}.${(小数 + "00").slice(0, 2)}`
}

/** 币种：CNY/RMB/人民币/元（大小写、全半角空白）⇒ CNY；其余转大写原样保留；空 ⇒ CNY。 */
export function 解析币种(原值: string): string {
  const v = (原值 ?? "").replace(/[\s　]/g, "").toUpperCase()
  if (v === "") return "CNY"
  if (["CNY", "RMB", "人民币", "元"].includes(v)) return "CNY"
  return v
}

function 组装时间(
  年: number,
  月: number,
  日: number,
  时: number,
  分: number,
  秒: number,
  精度: 精度,
): { 秒: number; 精度: 精度 } | undefined {
  const 毫秒 = Date.UTC(年, 月 - 1, 日, 时, 分, 秒)
  const 时刻 = new Date(毫秒)
  // `Date.UTC` 会进位（2 月 31 日 → 3 月 3 日），回读逐字段比，拦住不存在的时刻。
  if (
    时刻.getUTCFullYear() !== 年 ||
    时刻.getUTCMonth() !== 月 - 1 ||
    时刻.getUTCDate() !== 日 ||
    时刻.getUTCHours() !== 时 ||
    时刻.getUTCMinutes() !== 分 ||
    时刻.getUTCSeconds() !== 秒
  ) {
    return undefined
  }
  return { 秒: Math.floor(毫秒 / 1000) - 时区偏移秒, 精度 }
}

const 约数 = "(?:许|左右|前后|约)?$"
const 中文到秒 = new RegExp(`^(\\d{4})年(\\d{1,2})月(\\d{1,2})日(\\d{1,2})[时点](\\d{1,2})分(\\d{1,2})秒${约数}`)
const 中文到分 = new RegExp(`^(\\d{4})年(\\d{1,2})月(\\d{1,2})日(\\d{1,2})[时点](\\d{1,2})分${约数}`)
const 中文到点 = new RegExp(`^(\\d{4})年(\\d{1,2})月(\\d{1,2})日(\\d{1,2})[时点]${约数}`)
const 中文到日 = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/
const 到秒 = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/
const 到分 = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})$/
const 到日 = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/
const 紧凑14 = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/

/** 时间解析：标准日期、中文写法与紧凑 14 位一并认；一律 UTC+8。 */
export function 解析时间(原值: string): { 秒: number; 精度: 精度 } | undefined {
  const 文 = 原值.trim()
  let m = 中文到秒.exec(文)
  if (m) return 组装时间(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +m[6]!, "到秒")
  m = 中文到分.exec(文)
  if (m) return 组装时间(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, 0, "到分")
  m = 中文到点.exec(文)
  if (m) return 组装时间(+m[1]!, +m[2]!, +m[3]!, +m[4]!, 0, 0, "到分")
  m = 中文到日.exec(文)
  if (m) return 组装时间(+m[1]!, +m[2]!, +m[3]!, 0, 0, 0, "到日")
  m = 到秒.exec(文)
  if (m) return 组装时间(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +m[6]!, "到秒")
  m = 到分.exec(文)
  if (m) return 组装时间(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, 0, "到分")
  m = 到日.exec(文)
  if (m) return 组装时间(+m[1]!, +m[2]!, +m[3]!, 0, 0, 0, "到日")
  m = 紧凑14.exec(文)
  if (m) return 组装时间(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +m[6]!, "到秒")
  return undefined
}

/** 方向：借贷标志是权威；借=付、贷=收。缺方向时不从金额正负反推。 */
export function 解析方向(原值: string): "收" | "付" | undefined {
  const v = 原值.trim()
  if (v === "借") return "付"
  if (v === "贷") return "收"
  return undefined
}

/**
 * adapter.json 声明的「非交易」方向标志（如广发信用卡的 `O`：年费减免等无资金变动行）。
 * 只认声明过的字面值——这条是 fail-closed 的缩小，不是放宽：没声明的值仍让整份文件拒收。
 */
export function 是非交易标志(原值: string, 卡: 识别卡): boolean {
  const v = 原值.trim()
  return v !== "" && (卡.nonTransactionFlags ?? []).includes(v)
}

/** 交易状态：只在 adapter.json 声明的两个集合里判定；不在集合里即不可识别（fail-closed）。 */
export function 判定状态(原值: string, 卡: 识别卡): "成功" | "失败" | undefined {
  const v = 原值.trim()
  if (卡.status.success.includes(v)) return "成功"
  if (卡.status.failure.includes(v)) return "失败"
  return undefined
}

/** 开户行里的支付通道标记（支付宝/财付通/银联等）不是银行名，不能入库。 */
export function 是禁用开户行(原值: string, 禁用词: readonly string[]): boolean {
  const 小写 = 原值.trim().toLowerCase()
  return 小写 !== "" && 禁用词.some((词) => 小写.includes(词.toLowerCase()))
}

// ─────────────────────────────────────────────────────────────
// 识别卡：阈值/必需列的唯一出处
// ─────────────────────────────────────────────────────────────

export function 读识别卡(目录: string = 技能目录()): 识别卡 {
  const 原文 = readFileSync(join(目录, "adapter.json"), "utf8")
  const 卡 = JSON.parse(原文) as 识别卡
  if (!Array.isArray(卡.match?.requiredHeaders) || 卡.match.requiredHeaders.length === 0) {
    throw new Error("adapter.json：match.requiredHeaders 必须是非空数组")
  }
  if (!Array.isArray(卡.attributeKeys) || 卡.attributeKeys.some((键) => typeof 键 !== "string")) {
    throw new Error("adapter.json：attributeKeys 必须是字符串数组")
  }
  if (typeof 卡.status?.success !== "object" || 卡.status.success === null || 卡.status.success.length === 0) {
    throw new Error("adapter.json：status.success 必须是非空字符串数组")
  }
  if (!Array.isArray(卡.status.failure) || 卡.status.failure.some((值) => typeof 值 !== "string")) {
    throw new Error("adapter.json：status.failure 必须是字符串数组")
  }
  if (!Array.isArray(卡.bankNameDeny) || 卡.bankNameDeny.some((词) => typeof 词 !== "string" || 词.trim() === "")) {
    throw new Error("adapter.json：bankNameDeny 必须是非空字符串数组")
  }
  if (
    卡.nonTransactionFlags !== undefined &&
    (!Array.isArray(卡.nonTransactionFlags) ||
      卡.nonTransactionFlags.some((值) => typeof 值 !== "string" || 值.trim() === ""))
  ) {
    throw new Error("adapter.json：nonTransactionFlags 必须是非空字符串数组")
  }
  if (!Array.isArray(卡.admission?.checks)) throw new Error("adapter.json：admission.checks 必须是数组")
  if (typeof 卡.admission?.thresholds !== "object" || 卡.admission.thresholds === null) {
    throw new Error("adapter.json：admission.thresholds 必须是对象")
  }
  if (typeof 卡.output?.file !== "string" || 卡.output.file.trim() === "") {
    throw new Error("adapter.json：output.file 必须是非空字符串")
  }
  return 卡
}

function 检查项阈值(卡: 识别卡, 项: string): number {
  const 表 = 卡.admission.thresholds
  if (Object.hasOwn(表, 项)) return 表[项]!
  if (Object.hasOwn(表, "其余")) return 表["其余"]!
  throw new Error(`adapter.json：检查项「${项}」既没有显式阈值，也没有「其余」兜底`)
}

// ─────────────────────────────────────────────────────────────
// 读源文件：xls / xlsx / csv → 统一文本网格（绝对行号）
// ─────────────────────────────────────────────────────────────

interface 网格行 {
  /** 源文件行号（Excel 1 起；CSV 记录序号 1 起）。 */
  rowNo: number
  cells: string[]
}

interface 网格表 {
  名称: string
  行们: 网格行[]
}

export interface 源工作簿 {
  字节数: number
  sha256: string
  表们: 网格表[]
}

/** SheetJS 工作表是「单元格地址 → 单元」的字典，外加 `!ref` 等元数据；vendor 是 JS，无类型声明。 */
interface 工作表 {
  "!ref"?: string
  [单元格: string]: unknown
}

function 工作表转网格(名称: string, ws: 工作表 | undefined): 网格表 {
  if (ws === undefined || typeof ws["!ref"] !== "string") return { 名称, 行们: [] }
  const 范围 = XLSX.utils.decode_range(ws["!ref"])
  const 行们: 网格行[] = []
  for (let r = 范围.s.r; r <= 范围.e.r; r++) {
    const cells: string[] = []
    for (let c = 范围.s.c; c <= 范围.e.c; c++) {
      const 单元 = ws[XLSX.utils.encode_cell({ r, c })] as
        | { w?: string; v?: unknown }
        | undefined
      let 文 = ""
      if (单元 !== undefined) {
        if (typeof 单元.w === "string") 文 = 单元.w
        else if (单元.v !== undefined && 单元.v !== null) 文 = String(单元.v)
      }
      cells.push(文)
    }
    行们.push({ rowNo: r + 1, cells })
  }
  return { 名称, 行们 }
}

/** 严格 UTF-8 的 CSV（RFC 4180：引号、双引号转义、CRLF）。GBK/UTF-16 明确拒绝。 */
function 读CSV(bytes: Uint8Array, 名称: string): 网格表 {
  if (bytes.length >= 2) {
    const b0 = bytes[0]!
    const b1 = bytes[1]!
    if ((b0 === 0xff && b1 === 0xfe) || (b0 === 0xfe && b1 === 0xff)) {
      throw new Error("CSV 是 UTF-16 编码；请另存为 UTF-8")
    }
  }
  let 文本: string
  try {
    文本 = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new Error("CSV 不是合法 UTF-8（GBK 等编码请先另存为 UTF-8）")
  }
  if (文本.charCodeAt(0) === 0xfeff) 文本 = 文本.slice(1)

  const 行们: 网格行[] = []
  let cells: string[] = []
  let 字段 = ""
  let 引号内 = false
  let 字段开头 = true
  const 收字段 = () => {
    cells.push(字段)
    字段 = ""
    字段开头 = true
  }
  const 收行 = () => {
    收字段()
    行们.push({ rowNo: 行们.length + 1, cells })
    cells = []
  }
  for (let i = 0; i < 文本.length; i++) {
    const 字符 = 文本[i]!
    if (引号内) {
      if (字符 === '"') {
        if (文本[i + 1] === '"') {
          字段 += '"'
          i++
        } else {
          引号内 = false
        }
      } else {
        字段 += 字符
      }
      continue
    }
    if (字符 === '"' && 字段开头) {
      引号内 = true
      字段开头 = false
      continue
    }
    if (字符 === ",") {
      收字段()
      continue
    }
    if (字符 === "\r" || 字符 === "\n") {
      if (字符 === "\r" && 文本[i + 1] === "\n") i++
      收行()
      continue
    }
    字段 += 字符
    字段开头 = false
  }
  if (字段 !== "" || cells.length > 0) 收行()
  return { 名称, 行们 }
}

export function 读源文件(路径: string): 源工作簿 {
  const 字节 = readFileSync(路径)
  const sha256 = createHash("sha256").update(字节).digest("hex")
  const 名 = basename(路径)
  const 是CSV = /\.csv$/i.test(路径)
  const 表们: 网格表[] = []
  if (是CSV) {
    表们.push(读CSV(字节, 名))
  } else {
    const 工作簿 = XLSX.read(字节, { type: "buffer", cellDates: false, cellFormula: false })
    for (const 表名 of 工作簿.SheetNames) {
      表们.push(工作表转网格(表名, 工作簿.Sheets[表名]))
    }
  }
  return { 字节数: 字节.length, sha256, 表们 }
}

// ─────────────────────────────────────────────────────────────
// 表头闸
// ─────────────────────────────────────────────────────────────

interface 表计划 {
  表: 网格表
  表头下标: number
  表头行号: number
  列: Map<string, number>
  数据行们: 网格行[]
}

function 找表头(表: 网格表, 必需列: readonly string[]): { 下标: number; 命中: number; 缺列: string[] } {
  let 最佳 = { 下标: -1, 命中: 0, 缺列: [...必需列] }
  const 上限 = Math.min(10, 表.行们.length)
  for (let i = 0; i < 上限; i++) {
    const 集合 = new Set(表.行们[i]!.cells.map((x) => x.trim()))
    const 缺列 = 必需列.filter((列) => !集合.has(列))
    const 命中 = 必需列.length - 缺列.length
    // 并列取最早：只有严格更多才替换。
    if (命中 > 最佳.命中) 最佳 = { 下标: i, 命中, 缺列 }
  }
  return 最佳
}

function 列映射(表头: 网格行): Map<string, number> {
  const 映射 = new Map<string, number>()
  表头.cells.forEach((原值, 下标) => {
    const 列名 = 原值.trim()
    if (列名 !== "" && !映射.has(列名)) 映射.set(列名, 下标)
  })
  return 映射
}

function 单元格(row: 网格行, 列: Map<string, number>, 名: string): string {
  const 下标 = 列.get(名)
  return 下标 === undefined ? "" : 取值(row.cells[下标])
}

function 原始单元格(row: 网格行, 列: Map<string, number>, 名: string): string {
  const 下标 = 列.get(名)
  return 下标 === undefined ? "" : 文本值(row.cells[下标])
}

// ─────────────────────────────────────────────────────────────
// 行分类
// ─────────────────────────────────────────────────────────────

function 是空行(row: 网格行): boolean {
  return row.cells.every((值) => 空值(值.trim()))
}

function 汇总行原因(row: 网格行): "合计行" | "小计行" | null {
  const 文本们 = row.cells.map((值) => 值.trim()).filter((值) => 值 !== "")
  if (文本们.some((值) => 小计形状.test(值))) return "小计行"
  if (文本们.some((值) => 合计形状.test(值))) return "合计行"
  return null
}

// ─────────────────────────────────────────────────────────────
// 转换主体
// ─────────────────────────────────────────────────────────────

interface 行计划 {
  表名: string
  rowNo: number
  cells: 网格行
  列: Map<string, number>
  /** 同表紧邻的下一行；流水按时间倒序，下一行的余额是上一笔交易后的余额。 */
  下一行?: 网格行
  /** 借贷标志是 adapter.json 声明的非交易值（无方向可言）：不进方向闸分母，逐行跳过。 */
  非交易: boolean
}

function 元转分(金额: string): bigint {
  const 负 = 金额.startsWith("-")
  const 净 = 负 ? 金额.slice(1) : 金额
  const [整数 = "0", 小数 = ""] = 净.split(".")
  const 分 = BigInt(整数) * 100n + BigInt((小数 + "00").slice(0, 2))
  return 负 ? -分 : 分
}

function 分转元(分: bigint): string {
  const 元 = 分 / 100n
  return `${元}.${String(分 % 100n).padStart(2, "0")}`
}

/** 按原因聚合跳过行数与金额（绝对值）；金额用整数分累加，避免浮点漂移。 */
export function 汇总跳过(跳过: 报告["skippedRows"]): 报告["跳过汇总"] {
  const 表 = new Map<string, { 行数: number; 分: bigint }>()
  for (const 项 of 跳过) {
    const 现 = 表.get(项.原因) ?? { 行数: 0, 分: 0n }
    现.行数 += 1
    if (项.金额 !== undefined) {
      const 分 = 元转分(项.金额)
      现.分 += 分 < 0n ? -分 : 分
    }
    表.set(项.原因, 现)
  }
  return [...表.entries()]
    .map(([原因, 计]) => ({ 原因, 行数: 计.行数, 金额合计: 分转元(计.分) }))
    .sort((甲, 乙) => 乙.行数 - 甲.行数 || (甲.原因 < 乙.原因 ? -1 : 甲.原因 > 乙.原因 ? 1 : 0))
}

/**
 * 冲正行的借贷标志可能沿用原交易的「借」，与余额变化相反（实测样本 2 的 445/447 两笔
 * 「手机转账冲正」：标志为借，余额各增加 462,000）。只做一条窄核对：
 *   摘要/类型含「冲正」+ 相邻行同账号 + 两边余额可解析 + 余额差精确等于金额 ⇒ 按余额翻向。
 * 差一分钱、缺相邻行、账号不同都**不翻**，只在报告里说明。
 */
export function 核对冲正(
  原方向: "收" | "付",
  金额: string,
  本余额: string | null,
  下一余额: string | null,
  下一账号: string,
  本方账号: string,
  摘要: string,
  交易类型: string,
): { 修正?: "收" | "付"; 告警?: string } {
  if (!/冲正/.test(`${摘要}${交易类型}`)) return {}
  if (本余额 === null || 下一余额 === null || 本方账号 === "" || 下一账号 !== 本方账号) {
    return { 告警: "冲正行缺少可核对的相邻余额，保留借贷标志" }
  }
  const 差 = 元转分(本余额) - 元转分(下一余额)
  const 原额 = 元转分(金额)
  const 额 = 原额 < 0n ? -原额 : 原额
  if (差 === 额 && 原方向 === "付") return { 修正: "收" }
  if (差 === -额 && 原方向 === "收") return { 修正: "付" }
  if (差 === -额 && 原方向 === "付") return {}
  if (差 === 额 && 原方向 === "收") return {}
  return { 告警: "冲正行余额差与金额不相等，保留借贷标志" }
}

export function 转换工作簿(源: 源工作簿, 卡: 识别卡): 转换结果 {
  const 必需列 = 卡.match.requiredHeaders
  const 警告: 报告["warnings"] = []
  const 跳过: 报告["skippedRows"] = []
  const 表计划们: 表计划[] = []
  const 缺列候选: string[][] = []

  for (const 表 of 源.表们) {
    if (表.行们.length === 0) {
      警告.push({ sheet: 表.名称, rowNo: 0, code: "空工作表", detail: "工作表没有可读单元格" })
      continue
    }
    const 表头 = 找表头(表, 必需列)
    if (表头.命中 === 0) {
      警告.push({ sheet: 表.名称, rowNo: 0, code: "非数据工作表", detail: "前 10 行没有命中任何必需列" })
      continue
    }
    if (表头.缺列.length > 0) {
      缺列候选.push(表头.缺列)
      警告.push({
        sheet: 表.名称,
        rowNo: 表.行们[表头.下标]!.rowNo,
        code: "工作表缺列",
        detail: `表头命中 ${表头.命中}/${必需列.length}，缺：${表头.缺列.join("、")}；整表不转化`,
      })
      continue
    }
    const 表头行 = 表.行们[表头.下标]!
    const 计划: 表计划 = {
      表,
      表头下标: 表头.下标,
      表头行号: 表头行.rowNo,
      列: 列映射(表头行),
      数据行们: 表.行们.slice(表头.下标 + 1),
    }
    表计划们.push(计划)
  }

  if (表计划们.length === 0) {
    const 缺列 = 缺列候选.length > 0 ? 缺列候选[0]! : [...必需列]
    return {
      rows: [],
      report: {
        adapterId: 卡.id,
        adapterVersion: 卡.version,
        sourceSha256: 源.sha256,
        source: { 文件名: "", 字节数: 源.字节数, 工作表们: [] },
        headerGate: { 通过: false, 缺列 },
        gates: [],
        counts: { 总行: 0, 产出: 0, 跳过: 0 },
        warnings: 警告,
        skippedRows: [],
        跳过汇总: [],
      },
      拒收: true,
    }
  }

  // ── 值闸统计（分母只算候选行：非空、非汇总、非重复表头）──
  // 先校验 adapter.json 声明的每一项都真的实现了：拼错/新增检查项必须立刻炸，不能静默放行。
  const 已实现检查项 = new Set(["查询账号非空", "借贷标志合法", "金额可解析", "时间可解析", "交易状态可识别"])
  for (const 项 of 卡.admission.checks) {
    if (!已实现检查项.has(项)) throw new Error(`convert.ts 未实现 adapter.json 声明的检查项：${项}`)
  }
  // 分母为 0 的检查项按 1.0 通过，但条目仍要出现在报告里。
  const 闸计数 = new Map<string, { 分母: number; 命中: number }>(
    卡.admission.checks.map((项) => [项, { 分母: 0, 命中: 0 }]),
  )
  const 加闸 = (项: string, 命中: boolean) => {
    const 现 = 闸计数.get(项) ?? { 分母: 0, 命中: 0 }
    现.分母++
    if (命中) 现.命中++
    闸计数.set(项, 现)
  }

  const 计划行们: 行计划[] = []

  for (const 计划 of 表计划们) {
    const 表头行 = 计划.表.行们[计划.表头下标]!
    const 表头文本 = 表头行.cells.map((x) => x.trim())
    const 数据行们 = 计划.数据行们
    for (let i = 0; i < 数据行们.length; i++) {
      const row = 数据行们[i]!
      if (是空行(row)) {
        跳过.push({ sheet: 计划.表.名称, rowNo: row.rowNo, 原因: "空行" })
        continue
      }
      const 汇总 = 汇总行原因(row)
      if (汇总 !== null) {
        跳过.push({ sheet: 计划.表.名称, rowNo: row.rowNo, 原因: 汇总 })
        continue
      }
      if (row.cells.length === 表头文本.length && row.cells.every((值, i) => 值.trim() === 表头文本[i])) {
        跳过.push({ sheet: 计划.表.名称, rowNo: row.rowNo, 原因: "重复表头" })
        continue
      }

      const 列 = 计划.列
      const 金额 = 解析金额(原始单元格(row, 列, "交易金额"))
      const 时间 = 解析时间(原始单元格(row, 列, "交易时间"))
      const 查询账号 = 归一化账号(原始单元格(row, 列, "查询账号"))
      const 方向原文 = 原始单元格(row, 列, "借贷标志")
      const 方向 = 解析方向(方向原文)
      const 非交易 = 方向 === undefined && 是非交易标志(方向原文, 卡)
      const 状态 = 判定状态(原始单元格(row, 列, "交易是否成功"), 卡)

      加闸("查询账号非空", 查询账号 !== "")
      // 声明的非交易值不进方向闸分母（它不是资金交易，没有方向）；未声明的值照旧进分母。
      if (!非交易) 加闸("借贷标志合法", 方向 !== undefined)
      加闸("金额可解析", 金额 !== null)
      加闸("时间可解析", 时间 !== undefined)
      加闸("交易状态可识别", 状态 !== undefined)

      计划行们.push({ 表名: 计划.表.名称, rowNo: row.rowNo, cells: row, 列, 下一行: 数据行们[i + 1], 非交易 })
    }
  }

  const 闸们: 闸结果[] = 卡.admission.checks.map((项) => {
    const 计 = 闸计数.get(项)
    if (计 === undefined) throw new Error(`convert.ts 未实现 adapter.json 声明的检查项：${项}`)
    // 分母为 0 按 1.0 通过（见契约 / SKILL §4），条目仍出现在报告里。
    const 通过率 = 计.分母 === 0 ? 1 : 计.命中 / 计.分母
    const 阈值 = 检查项阈值(卡, 项)
    return { 闸: "值", 检查项: 项, 分母: 计.分母, 命中: 计.命中, 通过率, 阈值 }
  })
  const 闸全过 = 闸们.every((闸) => 闸.通过率 >= 闸.阈值)

  const 总行 = 表计划们.reduce((和, 计划) => 和 + 计划.数据行们.length, 0)
  const 工作表们 = 表计划们.map((计划) => ({
    名称: 计划.表.名称,
    表头行: 计划.表头行号,
    数据行: 计划.数据行们.length,
  }))

  if (!闸全过) {
    return {
      rows: [],
      report: {
        adapterId: 卡.id,
        adapterVersion: 卡.version,
        sourceSha256: 源.sha256,
        source: { 文件名: "", 字节数: 源.字节数, 工作表们 },
        headerGate: { 通过: true, 缺列: [] },
        gates: 闸们,
        counts: { 总行, 产出: 0, 跳过: 0 },
        warnings: 警告,
        skippedRows: [],
        跳过汇总: [],
      },
      拒收: true,
    }
  }

  // ── 逐行产出 ──
  const 行们: 事实行[] = []
  let 缺对方户名行数 = 0
  for (const 计划 of 计划行们) {
    const 列 = 计划.列
    const row = 计划.cells
    // 跳过的金额能解析就带上：报告按原因汇总「跳过多少行、多少钱」。
    const 记跳过 = (原因: string, 金额?: string | null) => {
      跳过.push({
        sheet: 计划.表名,
        rowNo: 计划.rowNo,
        原因,
        ...(金额 === undefined || 金额 === null ? {} : { 金额 }),
      })
    }
    const 方向 = 解析方向(原始单元格(row, 列, "借贷标志"))
    const 金额 = 解析金额(原始单元格(row, 列, "交易金额"))
    if (方向 === undefined) {
      记跳过(计划.非交易 ? "非交易行" : "方向不明", 金额)
      continue
    }
    if (金额 === null) {
      记跳过("金额无法解析")
      continue
    }
    // 内核契约要求 `amount > 0`：零金额行没有资金流动，留在 rows 里会让整份材料被拒收。
    if (/^-?0+\.0{2}$/.test(金额)) {
      记跳过("金额为零", 金额)
      continue
    }
    const 时间文 = 原始单元格(row, 列, "交易时间")
    const 时间 = 解析时间(时间文)
    if (时间 === undefined) {
      记跳过("时间无法解析", 金额)
      continue
    }
    const 状态 = 判定状态(原始单元格(row, 列, "交易是否成功"), 卡)
    if (状态 === "失败") {
      记跳过("交易未成功", 金额)
      continue
    }
    if (状态 === undefined) {
      // 值闸按 adapter.json 的阈值本应已拒收；阈值被放宽时仍不产出未识别的状态。
      记跳过("交易状态不明", 金额)
      continue
    }

    const 查询账号原文 = 原始单元格(row, 列, "查询账号")
    const 查询账号 = 归一化账号(查询账号原文)
    if (查询账号 === "") {
      记跳过("缺本方账号", 金额)
      continue
    }
    const 对方原文 = 原始单元格(row, 列, "交易对方账卡号")
    const 对方账号 = 归一化账号(对方原文)
    if (对方账号 === "") {
      记跳过("缺对方账号", 金额)
      continue
    }
    // 全零账号是平台的无对手方占位（实测样本 1 的 8 行支付宝退款）；建实体会把互不相关的
    // 退款并到一个假账户上，按缺对方账号处理。
    if (/^0+$/.test(对方账号)) {
      记跳过("对方账号为全零占位", 金额)
      continue
    }

    const extras: Record<string, string> = {}
    const 备注 = 单元格(row, 列, "备注")
    if (备注 !== "") extras["备注"] = 备注
    const 交易类型 = 单元格(row, 列, "交易类型")
    if (交易类型 !== "") extras["交易类型"] = 交易类型

    // 开户行：通道标记与纯数字代码都不是银行名，不写，记告警。
    const 开户行 = 单元格(row, 列, "交易对方账号开户行")
    if (开户行 !== "") {
      if (是禁用开户行(开户行, 卡.bankNameDeny)) {
        警告.push({
          sheet: 计划.表名,
          rowNo: 计划.rowNo,
          code: "开户行疑似通道标记",
          detail: `开户行「${开户行}」是支付通道标记而不是银行名，未写入 属性:对方:开户行`,
        })
      } else if (是开户行名称(开户行)) {
        extras["属性:对方:开户行"] = 开户行
      } else {
        警告.push({
          sheet: 计划.表名,
          rowNo: 计划.rowNo,
          code: "开户行疑似代码",
          detail: `开户行「${开户行}」是纯数字代码，未写入 属性:对方:开户行`,
        })
      }
    }
    const 证件号 = 单元格(row, 列, "交易对方证件号码")
    if (证件号 !== "") extras["属性:对方:证件号"] = 证件号

    const 余额文 = 原始单元格(row, 列, "交易余额")
    const 余额 = 余额文 === "" ? null : 解析金额(余额文)
    if (余额文 !== "" && 余额 === null) {
      警告.push({
        sheet: 计划.表名,
        rowNo: 计划.rowNo,
        code: "余额无法解析",
        detail: `交易余额「${余额文}」无法解析，未写入 balance`,
      })
    }

    // 冲正宽核：只对「摘要/类型含冲正 + 相邻余额精确矛盾」的行按余额翻向。
    const 摘要 = 单元格(row, 列, "交易摘要")
    const 下一余额文 = 计划.下一行 === undefined ? "" : 原始单元格(计划.下一行, 列, "交易余额")
    const 下一余额 = 下一余额文 === "" ? null : 解析金额(下一余额文)
    const 下一账号 = 计划.下一行 === undefined ? "" : 归一化账号(原始单元格(计划.下一行, 列, "查询账号"))
    const 核对 = 核对冲正(方向, 金额, 余额, 下一余额, 下一账号, 查询账号, 摘要, 交易类型)
    const 最终方向 = 核对.修正 ?? 方向
    if (核对.修正 !== undefined) {
      警告.push({
        sheet: 计划.表名,
        rowNo: 计划.rowNo,
        code: "冲正方向按余额修正",
        detail: `借贷标志为「${方向 === "付" ? "借" : "贷"}」，但相邻余额差与金额同号相反；按余额改为「${最终方向}」`,
      })
    }
    if (核对.告警 !== undefined) {
      警告.push({ sheet: 计划.表名, rowNo: 计划.rowNo, code: "冲正余额未核对", detail: 核对.告警 })
    }

    const 事实行: 事实行 = {
      sheet: 计划.表名,
      rowNo: 计划.rowNo,
      startedAt: 时间.秒,
      startedRaw: 时间文,
      precision: 时间.精度,
      timeType: "发生",
      // 金额永远正数；方向默认由借贷列决定，只有冲正宽核能改（见 核对冲正）。
      amount: 金额.replace(/^-/, ""),
      direction: 最终方向,
      ownerAccount: 查询账号,
      ownerAccountRaw: 查询账号原文,
      counterparty: 对方账号,
      counterpartyRaw: 对方原文,
      currency: 解析币种(单元格(row, 列, "币种")),
      extras,
    }
    if (余额 !== null) 事实行.balance = 余额
    const 对方户名 = 单元格(row, 列, "交易对方名称")
    if (对方户名 !== "") {
      事实行.counterpartyName = 对方户名
    } else {
      缺对方户名行数++
    }
    if (!是账户形状(查询账号) || !是账户形状(对方账号)) {
      警告.push({
        sheet: 计划.表名,
        rowNo: 计划.rowNo,
        code: "账号形状可疑",
        detail: `本方「${查询账号}」/ 对方「${对方账号}」不满足 6–32 位数字或 @wx.tenpay.com 形状；下游可能只留 mention，不建账户实体`,
      })
    }
    行们.push(事实行)
  }

  if (缺对方户名行数 > 0) {
    警告.push({
      sheet: "",
      rowNo: 0,
      code: "户名缺失",
      detail: `${缺对方户名行数} 行的『交易对方名称』为空或为 -；counterpartyName 留空，不臆造`,
    })
  }

  // 稳定排序：工作表原顺序 + rowNo 升序。字符串比较用码元序而非 localeCompare：
  // 后者随 ICU 版本变化，会破坏字节级确定性。
  const 码元序 = (甲: string, 乙: string) => (甲 < 乙 ? -1 : 甲 > 乙 ? 1 : 0)
  const 表序 = new Map(表计划们.map((计划, i) => [计划.表.名称, i]))
  行们.sort((甲, 乙) => (表序.get(甲.sheet)! - 表序.get(乙.sheet)!) || 甲.rowNo - 乙.rowNo)
  跳过.sort((甲, 乙) => (表序.get(甲.sheet)! - 表序.get(乙.sheet)!) || 甲.rowNo - 乙.rowNo)
  警告.sort(
    (甲, 乙) =>
      (表序.get(甲.sheet) ?? -1) - (表序.get(乙.sheet) ?? -1) ||
      甲.rowNo - 乙.rowNo ||
      码元序(甲.code, 乙.code) ||
      码元序(甲.detail, 乙.detail),
  )

  return {
    rows: 行们,
    report: {
      adapterId: 卡.id,
      adapterVersion: 卡.version,
      sourceSha256: 源.sha256,
      source: { 文件名: "", 字节数: 源.字节数, 工作表们 },
      headerGate: { 通过: true, 缺列: [] },
      gates: 闸们,
      counts: { 总行, 产出: 行们.length, 跳过: 跳过.length },
      warnings: 警告,
      skippedRows: 跳过,
      跳过汇总: 汇总跳过(跳过),
    },
    拒收: false,
  }
}

export function 转换文件(路径: string, 卡: 识别卡): 转换结果 {
  const 源 = 读源文件(路径)
  const 结果 = 转换工作簿(源, 卡)
  结果.report.source.文件名 = basename(路径)
  return 结果
}

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────

function 技能目录(): string {
  const 目录 = (import.meta as unknown as { dir?: string }).dir
  if (typeof 目录 === "string" && 目录 !== "") return 目录
  return dirname(new URL(import.meta.url).pathname)
}

interface 命令行 {
  输入: string
  输出目录: string
}

export function 解析命令行(argv: readonly string[], 默认输出目录: string): 命令行 {
  let 输入 = ""
  let 输出目录 = 默认输出目录
  for (let i = 0; i < argv.length; i++) {
    const 项 = argv[i]!
    if (项 === "--input") {
      输入 = argv[++i] ?? ""
    } else if (项 === "--out") {
      输出目录 = argv[++i] ?? 默认输出目录
    } else if (!项.startsWith("-") && 输入 === "") {
      输入 = 项
    }
  }
  if (输入 === "") 输入 = process.env["OPENHIVE_INPUT_PATH"] ?? ""
  return { 输入, 输出目录 }
}

export function 主函数(argv: readonly string[]): number {
  try {
    const 卡 = 读识别卡()
    const 命令行 = 解析命令行(argv, 技能目录())
    if (命令行.输入 === "") {
      console.error("用法: bun run convert.ts <原件路径> [--out <输出目录>]")
      return 1
    }
    const 输入路径 = resolve(命令行.输入)
    if (!existsSync(输入路径) || !statSync(输入路径).isFile()) {
      console.error(`读不到原件：${输入路径}`)
      return 1
    }
    const 结果 = 转换文件(输入路径, 卡)
    const 输出目录 = resolve(命令行.输出目录)
    mkdirSync(输出目录, { recursive: true })
    const 输出路径 = join(输出目录, 卡.output.file)
    if (existsSync(输出路径)) {
      console.error(`输出文件已存在，拒绝覆盖：${输出路径}`)
      return 1
    }
    writeFileSync(输出路径, JSON.stringify({ rows: 结果.rows, report: 结果.report }, null, 2) + "\n", "utf8")
    const 计 = 结果.report.counts
    console.error(
      `[${卡.id}] ${结果.拒收 ? "拒收" : "完成"}：总行 ${计.总行}，产出 ${计.产出}，跳过 ${计.跳过}`,
    )
    return 结果.拒收 ? 3 : 0
  } catch (错误) {
    console.error(`转换器异常：${错误 instanceof Error ? 错误.message : String(错误)}`)
    return 1
  }
}

const 入口 = process.argv[1] ?? ""
if (/convert\.(ts|js|mjs)$/.test(入口)) {
  process.exit(主函数(process.argv.slice(2)))
}
