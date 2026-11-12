export * as OpenhiveCaseRecognize from "./case-recognize"

import type { RawSheet } from "./case-sheet"
import { 是属性列 } from "./case-attribute-registry"
import { 候选字段集, type 识别字段 } from "./case-field-registry"
import {
  classifyMaterialType,
  detectMapping,
  type MappingResult,
  type 待确认项,
  type 识别来源,
} from "./case-mapping"
import { 合并模型结果, 需要模型, type 表头识别器 } from "./case-header-ai"
import type { 别名上下文 } from "./case-field-alias"
// ⚠️ type-only：`格式结果` 定义在 `case-ingest`，而 `case-ingest` **运行时** import 本模块
// （`识别材料`）。写成 `import type` 编译后被完全擦除，不产生运行时循环依赖——别改成值导入。
import type { 格式结果 } from "./case-ingest"

/**
 * 一次材料的识别编排：四层召回 → 缓存 → 模型兜底 → 汇总。
 *
 * ## 顺序（R18）
 *
 * 缓存**先于**识别：调用方（`跑表格`）已按指纹查过 `case_table_format`，把命中的表以
 * `缓存` 传进来。命中的表**不跑 `detectMapping`、不参与模型**——否则缓存只影响
 * `hit_count`，模型照样每份材料调一次，格式缓存等于白建。
 *
 * 未命中的表先跑四层召回（别名上下文由调用方读一次、随参数传下）→ 合并后判触发 →
 * 需要才调**一次**模型（只送未命中的表）→ 模型建议只合并进未命中的表 → 汇总。
 * 模型不可达只记错误名，不抛：离线要能照常入库（D4）。
 */
export interface 工作表识别 {
  sheet: string
  表头: (string | null)[]
  列: Record<number, 识别字段>
  来源: Record<number, 识别来源>
  待确认: 待确认项[]
  方法: "词典" | "特征" | "别名" | "模型"
  未知列: number
  /** 来自格式缓存（`true` ⇒ 本表没有跑四层、没有参与模型）。 */
  命中: boolean
}

export interface 材料识别 {
  工作表: 工作表识别[]
  类型: "话单" | "资金" | "其他"
  模型: { 调用: number; 失败?: string }
}

export interface 识别输入 {
  sheets: readonly RawSheet[]
  别名: 别名上下文
  /** 与 `sheets` 等长；调用方已按指纹查过缓存。 */
  缓存: readonly (Readonly<{ columns: Record<number, 识别字段>; result: 格式结果 }> | undefined)[]
  /** 不注入 ⇒ 只走离线规则（dryRun 就是这种情况，见 R20）。 */
  识别器?: 表头识别器
}

export async function 识别材料(输入: 识别输入): Promise<材料识别> {
  const 表头们 = 输入.sheets.map((sheet) => sheet.header.map((cell) => cell.text))
  const 行们 = 输入.sheets.map((sheet) =>
    sheet.rows.slice(0, 20).map((row) => row.cells.map((cell) => cell.text)),
  )

  const 合并后: MappingResult[] = []
  /** 未命中的下标：模型只看这些表，建议也只合并回这些表。 */
  const 未命中: number[] = []
  const 未命中基础: MappingResult[] = []
  const 未命中表头: (string | null)[][] = []
  const 未命中行: (string | null)[][][] = []

  for (let i = 0; i < 输入.sheets.length; i++) {
    const 缓存 = 输入.缓存[i]
    const 表头 = 表头们[i] ?? []
    const 行 = 行们[i] ?? []
    if (缓存 !== undefined) {
      合并后.push({
        columns: 缓存.columns,
        // `MappingResult.method` 只有三值；缓存可能存过「模型」——那属于另一层的口径，
        // 这里只把它收窄成 `特征`（本对象唯一的读者是 `classifyMaterialType`，不看方法）。
        // 对外的 `工作表识别.方法` 直接取 `缓存.result.方法`，见下方汇总。
        method: 缓存.result.方法 === "模型" ? "特征" : 缓存.result.方法,
        来源: 缓存.result.来源,
        待确认: 缓存.result.待确认,
        // 列形状可重算、缓存里没存；本模块按 `缓存.result.未知列` 取数。
        unknownColumns: [],
      })
      continue
    }
    未命中.push(i)
    const 基础 = detectMapping(表头, 行, {
      别名: 输入.别名.别名,
      候选字段: 候选字段集(表头, 行),
    })
    合并后.push(基础)
    未命中基础.push(基础)
    未命中表头.push(表头)
    未命中行.push(行)
  }

  let 模型: { 调用: number; 失败?: string } = { 调用: 0 }
  if (
    输入.识别器 !== undefined &&
    未命中.length > 0 &&
    需要模型(未命中基础, 未命中表头, 未命中行)
  ) {
    模型 = { 调用: 1 }
    try {
      const 建议 = await 输入.识别器({
        工作表: 未命中.map((i) => {
          const 表头 = 表头们[i] ?? []
          const 样例 = 行们[i] ?? []
          // 属性列不交给识别器（05 §4.3）：表头**与对应单元格同时置 null**，保长度、保下标。
          // 只置表头不够：实现若判 `是属性列`，null 会漏判，样例按 `行[i]` 取仍会把属性值外发；
          // 也不能 filter，列号会漂移、模型建议整体错位。`表头们` / `行们` 本体不动——
          // 后面 `需要模型` / `合并模型结果` 还要用原始下标。
          const 属性集 = new Set(表头.flatMap((h, j) => (是属性列(h) ? [j] : [])))
          return {
            名: 输入.sheets[i]?.name ?? "",
            表头: 表头.map((h, j) => (属性集.has(j) ? null : h)),
            样例: 样例.map((行) => 行.map((v, j) => (属性集.has(j) ? null : v))),
          }
        }),
        候选字段: [
          ...new Set([
            ...未命中基础.flatMap((结果) => Object.values(结果.columns)),
            ...未命中表头.flatMap((表头, k) => [...候选字段集(表头, 未命中行[k] ?? [])]),
          ]),
        ],
      })
      for (let k = 0; k < 未命中.length; k++) {
        const i = 未命中[k]
        const 名 = 输入.sheets[i]?.name ?? ""
        const 列 = 建议.工作表[名]?.列 ?? {}
        合并后[i] = 合并模型结果(未命中表头[k] ?? [], 未命中行[k] ?? [], 未命中基础[k], 列)
      }
    } catch (error) {
      // 失败只记错误名（与抽取链的失败口径一致），不抛：离线仍要能入库。
      模型.失败 = error instanceof Error ? error.name : "未知错误"
    }
  }

  const 工作表: 工作表识别[] = 合并后.map((结果, i) => {
    const 缓存 = 输入.缓存[i]
    const 用了模型 = Object.values(结果.来源).includes("模型")
    return {
      sheet: 输入.sheets[i]?.name ?? "",
      表头: 表头们[i] ?? [],
      列: 结果.columns,
      来源: 结果.来源,
      待确认: 结果.待确认,
      // R19：按**表**判，不能把「模型调用过」当成「每张表都是模型产的」。
      方法: 缓存 !== undefined ? 缓存.result.方法 : 用了模型 ? "模型" : 结果.method,
      未知列: 缓存 !== undefined ? 缓存.result.未知列 : 结果.unknownColumns.length,
      命中: 缓存 !== undefined,
    }
  })

  return { 工作表, 类型: 材料类型(合并后), 模型 }
}

/**
 * 材料类型（R21）：**话单优先，其次资金**，与 `classifyMaterialType` 的判定顺序一致。
 *
 * 一个材料只有一个 `kind`，混合表（话单 ＋ 流水各一张）总得挑一个。`跑表格` 此前是
 * 「最后一张赢」⇒ 话单在前、流水在后时会被判成资金；宁可把混合表判成话单，也不要把
 * 话单判成资金。spec 的多表 kind 缺口仍在（本函数不解决它，只固定一个更安全的偏向）。
 */
function 材料类型(结果们: readonly MappingResult[]): "话单" | "资金" | "其他" {
  let 类型: "话单" | "资金" | "其他" = "其他"
  for (const 结果 of 结果们) {
    const 此表 = classifyMaterialType(结果.columns)
    if (此表 === "话单") return "话单"
    if (此表 === "资金") 类型 = "资金"
  }
  return 类型
}
