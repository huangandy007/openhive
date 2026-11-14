export * as OpenhiveCaseSourceProfile from "./case-source-profile"

import { classifyMaterialType } from "./case-mapping"
import { 是识别字段, type 识别字段 } from "./case-field-registry"

/**
 * 数据源档案的命中判定（设计 §4）。纯函数：不碰库、不读时钟。
 *
 * 与格式缓存的区别：缓存键是「表头 + 每列形状」的指纹，列顺序一变就失效；
 * 档案键是**表头集合**，列顺序无关。所以这里的每一步都必须 fail-closed：
 * 缺列、字段失效、类型不符、两档案打平——一律不命中，回落普通识别。
 */
export interface 档案候选 {
  id: string
  name: string
  type: "资金" | "话单" | "其他"
  /** 表头原文（trim 后）→ 字段。 */
  mapping: Record<string, string>
  hitCount: number
  updatedAt: number
}

export interface 档案命中 {
  id: string
  name: string
  /** 还原成**当前**列下标。 */
  columns: Record<number, 识别字段>
}

interface 合格候选 {
  档案: 档案候选
  columns: Record<number, 识别字段>
  有效列数: number
  签名: string
}

/** 映射签名：只看「表头 → 字段」，用于判断两个档案是否真是同一份映射。 */
function 映射签名(mapping: Record<string, string>): string {
  return JSON.stringify(
    Object.entries(mapping)
      .map(([表头, 字段]) => [表头.trim(), 字段] as const)
      .sort(([甲], [乙]) => (甲 < 乙 ? -1 : 甲 > 乙 ? 1 : 0)),
  )
}

export function 匹配数据源档案(输入: {
  表头: readonly (string | null)[]
  档案们: readonly 档案候选[]
}): 档案命中 | null {
  // 表头重名时取第一次出现的列：档案按表头原文建，重名表头在建档时已被拒绝；
  // 这里取第一个只是让「库里有脏数据」时行为确定，不是支持重名。
  const 下标 = new Map<string, number>()
  输入.表头.forEach((原始, i) => {
    const 表头 = 原始?.trim() ?? ""
    if (表头 !== "" && !下标.has(表头)) 下标.set(表头, i)
  })

  const 合格: 合格候选[] = []
  for (const 档案 of 输入.档案们) {
    const columns: Record<number, 识别字段> = {}
    let 不合格 = false

    for (const [原始表头, 字段] of Object.entries(档案.mapping)) {
      const 表头 = 原始表头.trim()
      const 列号 = 下标.get(表头)
      // 规则 1：档案里的每个表头都必须在当前表里；缺一列不套。
      if (列号 === undefined) {
        不合格 = true
        break
      }
      // 规则 2 后半：失效字段 / 已删字段 ⇒ 整条档案不命中（设计 §2）。
      if (!是识别字段(字段)) {
        不合格 = true
        break
      }
      // 两个不同的映射键 trim 后落到同一列：说不清哪一个是真，fail-closed。
      const 已有 = columns[列号]
      if (已有 !== undefined && 已有 !== 字段) {
        不合格 = true
        break
      }
      columns[列号] = 字段
    }
    if (不合格) continue

    const 有效列数 = Object.keys(columns).length
    // 规则 2 前半：有效字段 ≥ 2。
    if (有效列数 < 2) continue
    // 规则 3：还原下标后重新判类型，防「资金档案套话单」。
    if (classifyMaterialType(columns) !== 档案.type) continue

    合格.push({ 档案, columns, 有效列数, 签名: 映射签名(档案.mapping) })
  }

  if (合格.length === 0) return null

  合格.sort(
    (甲, 乙) =>
      乙.有效列数 - 甲.有效列数 ||
      乙.档案.hitCount - 甲.档案.hitCount ||
      乙.档案.updatedAt - 甲.档案.updatedAt ||
      (甲.档案.id < 乙.档案.id ? -1 : 甲.档案.id > 乙.档案.id ? 1 : 0),
  )

  // 规则 5：前两名「列数与 hit_count 都相同、映射不同」⇒ 不猜。
  const 第一 = 合格[0]
  if (第一 === undefined) return null
  const 第二 = 合格[1]
  if (
    第二 !== undefined &&
    第一.有效列数 === 第二.有效列数 &&
    第一.档案.hitCount === 第二.档案.hitCount &&
    第一.签名 !== 第二.签名
  ) {
    return null
  }

  return { id: 第一.档案.id, name: 第一.档案.name, columns: 第一.columns }
}
