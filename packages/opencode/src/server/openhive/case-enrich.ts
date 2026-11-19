export * as OpenhiveCaseEnrich from "./case-enrich"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { 解析属性列, type 属性归属 } from "./case-attribute-registry"
import { 是账户形状, 归一化值 } from "./case-field-registry"
import { 文本数组 } from "./case-fact-store"
import type { FactRowInput, Queryable } from "./case-store"
import type { 属性观察 } from "./case-translate"
import type { 参考类别, 参考库, 外部核验服务 } from "./case-reference-store"

/**
 * 016 T012 · N4 富化层：受控键分类 → 产键去重 → 每类一次批量查 → Map 回填。
 *
 * ## 受控分类表（唯一出处）
 *
 * 分类依据是**键的语义**，与数据源无关（spec FR-052 / Clarifications Q5）。未登记键
 * **fail-closed 按身份类**：身份类的查不到要进「待确认」让人工看，而参考类的查不到只是
 * 告警 —— 默认成参考类会让一个没登记的新键静默消失（`#005-18` 假绿四问里的「默认值满足断言」）。
 *
 * ## 三类处置（FR-052）
 *
 * | 类别 | 命中 | 未命中 |
 * |---|---|---|
 * | 参考类 | 产 `属性观察` | 留空 + `告警们`，不阻塞 |
 * | 身份类 | 产 `属性观察`（实名核验结论） | 进 `待确认们`，不写空值 |
 * | 匹配类 | 记 `匹配命中们`（不写 attrs） | 记 `未匹配们`，不告警、不进待确认 |
 *
 * ## 写入口
 *
 * 富化结果**不落新表**：属性观察由调用方并入 `翻译结果.属性们`，走既有唯一写入口
 * `写入翻译结果`（`case-translate-store.ts`）。`属性观察` 的形状只有 `{归属,键,值,出处}`
 * —— 依据 / 置信度 / 版本放 `补全明细们`（给 T013 写报告），**不扩 attrs 类型**。
 */

export const 参考类键 = ["开户行", "卡种", "卡行", "号码归属地", "行号"] as const
export const 身份类键 = ["证件号", "户名", "实名核验结论"] as const
export const 匹配类键 = ["账号", "人名", "组织名"] as const

export type 键类别 = "参考类" | "身份类" | "匹配类"

const 参考类集: ReadonlySet<string> = new Set(参考类键)
const 匹配类集: ReadonlySet<string> = new Set(匹配类键)

/**
 * 未登记 ⇒ 身份类（fail-closed）。`身份类键` 本身也走这里的兜底：
 * 两个集合都不命中就是身份类，语义与「未登记」完全一致，没必要再列一遍。
 */
export function 键分类(键: string): 键类别 {
  if (参考类集.has(键)) return "参考类"
  if (匹配类集.has(键)) return "匹配类"
  return "身份类"
}

/** 电话号码形状（brief 字面值）。 */
const 电话形状 = /^\d{7,12}$/

/** 账户形状的值要查的参考类键（同一账号每类一次查）。 */
const 账户参考类别们 = ["开户行", "卡种"] as const satisfies readonly 参考类别[]

/** 匹配类键 → 案件库实体类型。`查案件库账号` 一条语句覆盖这三类实体。 */
const 匹配实体类型们 = ["账户", "人", "组织"] as const

export interface 富化输入 {
  readonly projectId: string
  readonly materialId: string
  readonly rows: readonly FactRowInput[]
}

export interface 富化依赖 {
  readonly 参考库: 参考库
  readonly 外部服务?: 外部核验服务
  /** 值为「账号」时的可选实现；语句计数探针在测试里包它。空值数组不会到这里。 */
  readonly 案件库: (值们: readonly string[]) => Promise<ReadonlyMap<string, string>>
  readonly 现在秒?: () => number
}

export interface 富化结果 {
  /** 出处 = `${materialId}#${sheet}#${rowNo}`。 */
  readonly 属性们: 属性观察[]
  readonly 待确认们: { 键: string; 值: string; 出处: string; 原因: string }[]
  readonly 告警们: { 键: string; 值: string; 原因: string }[]
  readonly 未匹配们: { 类别: string; 值: string }[]
  readonly 匹配命中们: { 类别: string; 值: string; 实体id: string }[]
  readonly 补全明细们: {
    键: string
    值: string
    依据: "参考库" | "外部核验" | "案件库"
    置信度: number
    版本: string
    出处: string
  }[]
  readonly 统计: { 补全数: number; 未补全数: number; 参考库版本: string }
}

interface 参考产键 {
  归属: 属性归属
  键: 参考类别
  值: string
  出处: string
}

interface 身份产键 {
  归属: 属性归属
  键: string
  值: string
  出处: string
}

interface 匹配产键 {
  类别: "账号" | "人名"
  值: string
}

/** 产键：只从事实行取，不逐行查库（FR-049）。 */
function 产键(输入: 富化输入): {
  参考: 参考产键[]
  身份: 身份产键[]
  匹配: 匹配产键[]
} {
  const 参考: 参考产键[] = []
  const 身份: 身份产键[] = []
  const 匹配: 匹配产键[] = []

  for (const row of 输入.rows) {
    const 出处 = `${输入.materialId}#${row.sheet}#${row.rowNo}`

    // ── 账户形状：开户行 / 卡种（参考类）＋ 账号（匹配类）──
    // 适配器通路（`转换行`）给的是原文，四层通路 `toFactRows` 已归一化 ⇒ 这里统一走
    // 标准归一化（幂等）：否则带空格 / 横线的账号查参考库全不中、查案件库全未匹配。
    const 本方 = 归一化值("ownerAccount", row.ownerAccount ?? "").trim()
    const 对方 = 归一化值("counterparty", row.counterparty ?? "").trim()
    const 账号们: { 归属: 属性归属; 值: string }[] = []
    if (本方 !== "" && 是账户形状(本方)) 账号们.push({ 归属: "本方", 值: 本方 })
    if (对方 !== "" && 是账户形状(对方)) 账号们.push({ 归属: "对方", 值: 对方 })
    for (const 账号 of 账号们) {
      for (const 类别 of 账户参考类别们) 参考.push({ 归属: 账号.归属, 键: 类别, 值: 账号.值, 出处 })
      匹配.push({ 类别: "账号", 值: 账号.值 })
    }

    // ── 电话号码形状：号码归属地（参考类）──
    // 来源只取明确的号码字段：caller / callee / extras.contactPhone。
    // 不扫全部 extras：原始账号列也在 extras 里，12 位以内的裸账号会被误当号码。
    const 号码们: { 归属: 属性归属; 值: string }[] = []
    const 加号码 = (归属: 属性归属, 字段: "caller" | "callee" | "contactPhone", 原: string | null | undefined) => {
      // 形状同样对**归一化后**的值判：`+86 …` 原文会被 `电话形状` 判掉（同 I1 的通路问题）。
      const 值 = 归一化值(字段, 原 ?? "").trim()
      if (值 !== "" && 电话形状.test(值)) 号码们.push({ 归属, 值 })
    }
    加号码("本方", "caller", row.caller)
    加号码("对方", "callee", row.callee)
    const 联系人电话 = row.extras?.["contactPhone"]
    if (typeof 联系人电话 === "string") 加号码("对方", "contactPhone", 联系人电话)
    for (const 号码 of 号码们) 参考.push({ 归属: 号码.归属, 键: "号码归属地", 值: 号码.值, 出处 })

    // ── extras 属性列：身份类产键（参考类原文已由翻译层写入，匹配类不追加）──
    for (const [键, 原] of Object.entries(row.extras ?? {})) {
      if (typeof 原 !== "string") continue
      const 属性 = 解析属性列(键)
      if (属性 === undefined) continue
      const 值 = 原.trim()
      if (值 === "") continue
      // 未登记键也从这里进身份类（`键分类` 的 fail-closed 兜底）。
      if (键分类(属性.键) !== "身份类") continue
      身份.push({ 归属: 属性.归属, 键: 属性.键, 值, 出处 })
    }

    // ── 匹配类固定产键：对手户名 / 本方户名（`extras.ownerName`）⇒ 人名 ──
    // `ownerAccountRaw` 是**账号原文**、不是人名：当人名去查案件库只会制造未匹配噪音。
    const 对手户名 = (row.counterpartyName ?? "").trim()
    if (对手户名 !== "") 匹配.push({ 类别: "人名", 值: 对手户名 })
    const 本方户名 = row.extras?.["ownerName"]
    if (typeof 本方户名 === "string" && 本方户名.trim() !== "") 匹配.push({ 类别: "人名", 值: 本方户名.trim() })
  }

  return { 参考, 身份, 匹配 }
}

/**
 * 富化主入口。
 *
 * 参考库先 `刷新`（版本没变时内部直接返回），再产键 / 分类查 / 回填。
 * 任一查询通道抛错 ⇒ 整体 reject；调用方（`case-ingest.ts`）按「增强通道失败不拖垮作业」
 * 记 WARN 并继续（FR-052 参考类不阻塞）。
 */
export async function 富化(输入: 富化输入, 依赖: 富化依赖): Promise<富化结果> {
  await 依赖.参考库.刷新()

  const { 参考: 参考产键们, 身份: 身份产键们, 匹配: 匹配产键们 } = 产键(输入)

  const 属性们: 属性观察[] = []
  const 待确认们: { 键: string; 值: string; 出处: string; 原因: string }[] = []
  const 告警们: { 键: string; 值: string; 原因: string }[] = []
  const 未匹配们: { 类别: string; 值: string }[] = []
  const 匹配命中们: { 类别: string; 值: string; 实体id: string }[] = []
  const 补全明细们: 富化结果["补全明细们"] = []

  /** 属性观察去重：`归属\0键\0值\0出处`（同一 (键,值,出处) 只产一条）。 */
  const 属性已见 = new Set<string>()
  const 待确认已见 = new Set<string>()
  const 告警已见 = new Set<string>()
  /** 统计口径：`归属\0键\0值`（同一值多出处只算一次）。 */
  const 补全已见 = new Set<string>()
  const 未补全已见 = new Set<string>()

  // ── 参考类：内存查，无语句 ──
  const 参考查过 = new Map<string, string | undefined>()
  for (const 键 of 参考产键们) {
    const 查询键 = `${键.键}\u0000${键.值}`
    let 结果 = 参考查过.get(查询键)
    if (!参考查过.has(查询键)) {
      结果 = 依赖.参考库.查(键.键, 键.值)
      参考查过.set(查询键, 结果)
    }
    if (结果 === undefined) {
      未补全已见.add(`${键.归属}\u0000${键.键}\u0000${键.值}`)
      // 告警按「值」层面去重：同一账号在两侧 / 多行都查不到，人只需要看一条值级告警。
      const 去重 = `${键.键}\u0000${键.值}`
      if (告警已见.has(去重)) continue
      告警已见.add(去重)
      告警们.push({ 键: 键.键, 值: 键.值, 原因: "参考库无此值" })
      continue
    }
    补全已见.add(`${键.归属}\u0000${键.键}\u0000${结果}`)
    // 出处进去重键：同一值来自不同行时每行各产一条观察（`#002-06` 的「出处是事实」）。
    const 去重 = `${键.归属}\u0000${键.键}\u0000${结果}\u0000${键.出处}`
    if (属性已见.has(去重)) continue
    属性已见.add(去重)
    属性们.push({ 归属: 键.归属, 键: 键.键, 值: 结果, 出处: 键.出处 })
    补全明细们.push({
      键: 键.键,
      值: 结果,
      依据: "参考库",
      置信度: 1,
      版本: 依赖.参考库.版本,
      出处: 键.出处,
    })
  }

  // ── 身份类：同一 (键, 值) 只核验一次；外部服务缺失 ⇒ 全部按查不到 ──
  const 核验唯一 = new Map<string, 身份产键>()
  for (const 键 of 身份产键们) {
    const 去重 = `${键.键}\u0000${键.值}`
    if (!核验唯一.has(去重)) 核验唯一.set(去重, 键)
  }
  const 身份结果 = new Map<string, string | undefined>()
  if (依赖.外部服务 === undefined) {
    for (const 去重 of 核验唯一.keys()) 身份结果.set(去重, undefined)
  } else {
    const 服务 = 依赖.外部服务
    await Promise.all(
      [...核验唯一.entries()].map(async ([去重, 键]) => {
        身份结果.set(去重, await 服务.核验(键.值))
      }),
    )
  }
  // 产出 / 待确认**遍历全部产键**：同一证件号既是本方又是对方时两侧都产（核验仍只问一次）。
  for (const 键 of 身份产键们) {
    const 结果 = 身份结果.get(`${键.键}\u0000${键.值}`)
    const 产出去重 = `${键.归属}\u0000${键.键}\u0000${键.值}\u0000${键.出处}`
    if (结果 === undefined) {
      if (待确认已见.has(产出去重)) continue
      待确认已见.add(产出去重)
      未补全已见.add(`${键.归属}\u0000${键.键}\u0000${键.值}`)
      待确认们.push({ 键: 键.键, 值: 键.值, 出处: 键.出处, 原因: "查不到" })
      continue
    }
    // 身份类命中的产物固定是「实名核验结论」（brief 三类处置表）。
    const 观察键 = "实名核验结论"
    const 属性去重 = `${键.归属}\u0000${观察键}\u0000${结果}\u0000${键.出处}`
    if (属性已见.has(属性去重)) continue
    属性已见.add(属性去重)
    补全已见.add(`${键.归属}\u0000${观察键}\u0000${结果}`)
    属性们.push({ 归属: 键.归属, 键: 观察键, 值: 结果, 出处: 键.出处 })
    补全明细们.push({
      键: 观察键,
      值: 结果,
      依据: "外部核验",
      // 外部服务不返回置信度与版本：这里如实写「验证通过」的 1 与通道名，
      // 不编造一个看起来来自参考库的版本号。
      置信度: 1,
      版本: "外部核验",
      出处: 键.出处,
    })
  }

  // ── 匹配类：全部值一条批量查（FR-050），命中/未命中分开记 ──
  const 匹配值们 = [...new Set(匹配产键们.map((键) => 键.值))]
  const 案件库命中 =
    匹配值们.length === 0 ? new Map<string, string>() : await 依赖.案件库(匹配值们)
  const 匹配已见 = new Set<string>()
  for (const 键 of 匹配产键们) {
    const 去重 = `${键.类别}\u0000${键.值}`
    if (匹配已见.has(去重)) continue
    匹配已见.add(去重)
    const 实体id = 案件库命中.get(键.值)
    if (实体id === undefined) 未匹配们.push({ 类别: 键.类别, 值: 键.值 })
    else 匹配命中们.push({ 类别: 键.类别, 值: 键.值, 实体id })
  }

  return {
    属性们,
    待确认们,
    告警们,
    未匹配们,
    匹配命中们,
    补全明细们,
    统计: {
      // 按 `归属+键+值` 去重：同一值多出处只算一次（brief「按值去重后」）。
      补全数: 补全已见.size,
      未补全数: 未补全已见.size,
      参考库版本: 依赖.参考库.版本,
    },
  }
}

/**
 * 案件库批量查：一条语句覆盖全部值（复用 `case_entity_canonical` 唯一索引
 * `(project_id, type, canonical_value)`，见 `0031_case_fact_layer.sql:90`）。
 *
 * 空数组**不发语句**：`any('{}')` 也合法，但为一次注定为空的结果多走一轮往返没有意义。
 * 返回 `canonical_value → entity.id`；`type` 覆盖匹配类的三类实体（账户 / 人 / 组织）。
 */
export async function 查案件库账号(
  db: Queryable,
  projectId: string,
  值们: readonly string[],
): Promise<Map<string, string>> {
  const 唯一 = [...new Set(值们.map((值) => 值.trim()).filter((值) => 值 !== ""))]
  if (唯一.length === 0) return new Map()

  const 行们 = rowsOf(
    await db.execute(sql`
      select canonical_value, id
        from auth.case_entity
       where project_id = ${projectId}
         and type = any(${文本数组(匹配实体类型们)})
         and canonical_value = any(${文本数组(唯一)})
    `),
  )
  const 结果 = new Map<string, string>()
  for (const 行 of 行们) 结果.set(String(行.canonical_value), String(行.id))
  return 结果
}
