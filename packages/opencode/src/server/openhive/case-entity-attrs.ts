export * as OpenhiveCaseEntityAttrs from "./case-entity-attrs"

import { 账户键, type 属性观察, type 卡片草稿 } from "./case-translate"

/**
 * `case_entity.attrs` 的形状与合并（01 §3.10 / 05 §5）。
 *
 * 形状：`{ "<键>": [{ "值": "...", "出处": "<material_id>#<sheet>#<row_no>" }, ...] }`。
 * `subtype` 是**唯一的标量键**（材料里明确写出的细类），语义保持「新值覆盖旧值」。
 *
 * 为什么必须替换掉 `attrs || excluded.attrs`（`case-fact-store.ts:73`）：jsonb 的 `||`
 * 是**键级覆盖**。两家材料给出不同开户行时，后写的那条把前一条整键抹掉——证据丢了，
 * 而且没人知道丢过（A16 要的是「两条都在」）。
 */

export type 实体属性 = Record<string, unknown>

/** 类型谓词而不是 `as`：仓库的 oxlint 规则 `no-unsafe-type-assertion` 会把断言判成 warning。 */
function 是记录(值: unknown): 值 is 实体属性 {
  return typeof 值 === "object" && 值 !== null && !Array.isArray(值)
}

export function 读jsonb(值: unknown): 实体属性 {
  if (值 === null || 值 === undefined) return {}
  if (typeof 值 === "string") {
    try {
      const 解析 = JSON.parse(值)
      return 是记录(解析) ? 解析 : {}
    } catch {
      return {}
    }
  }
  return 是记录(值) ? 值 : {}
}

interface 观察 {
  值: string
  出处: string
}

/** 同 `是记录`：用 `in` 收窄，避免 `as` 触发的 `no-unsafe-type-assertion`。 */
function 是观察(值: unknown): 值 is 观察 {
  return typeof 值 === "object" && 值 !== null && "值" in 值 && "出处" in 值
    && typeof 值.值 === "string" && typeof 值.出处 === "string"
}

function 是观察数组(值: unknown): 值 is 观察[] {
  return Array.isArray(值) && 值.every(是观察)
}

/** 按 key 合并：观察数组按 `值` 去重（保留首次出处）；其余（标量）新值覆盖。 */
export function 合并属性(旧: 实体属性, 新: 实体属性): 实体属性 {
  const 结果: 实体属性 = { ...旧 }
  for (const [键, 新值] of Object.entries(新)) {
    const 旧值 = 结果[键]
    if (是观察数组(新值)) {
      const 已有 = 是观察数组(旧值) ? 旧值 : []
      const 已见值 = new Set(已有.map((x) => x.值))
      const 追加 = 新值.filter((x) => !已见值.has(x.值))
      结果[键] = [...已有, ...追加]
      continue
    }
    结果[键] = 新值
  }
  return 结果
}

/**
 * 剥掉「由这份材料产生」的观察（Q14：来源键总规）。
 *
 * 不做这一步，重放时换过的旧值会永远留在 attrs 里——同键不同值本来就并存，看不出哪条是
 * 上一轮解析的残留。出处前缀 `<material_id>#` 是唯一可靠的归属判据。
 */
export function 剥离本材料出处(旧: 实体属性, materialId: string): 实体属性 {
  const 前缀 = `${materialId}#`
  const 结果: 实体属性 = {}
  for (const [键, 值] of Object.entries(旧)) {
    if (!是观察数组(值)) {
      结果[键] = 值
      continue
    }
    const 留 = 值.filter((x) => !x.出处.startsWith(前缀))
    if (留.length > 0) 结果[键] = 留
  }
  return 结果
}

/**
 * 观察 → 按实体分组的属性（`归属` 只有「对方/本方」，要回到产生它的卡片才知道是哪个实体）。
 *
 * 出处是 `<material_id>#<sheet>#<row_no>`，卡片的 `(sheet, rowNo)` 是它的后缀 ⇒ 先建
 * 「后缀 → 卡片」索引，再按归属取对应参与者。同一行可能既有本方属性又有对方属性，
 * 两条各自找自己的实体。
 *
 * 前提：`materialId` 里**不含 `#`**（现在的事实 id 都是十六进制/短串）。否则
 * `split("#").slice(1).join("#")` 会把材料 id 的一部分当成工作表名，属性静默挂错实体。
 * 出处格式本身是 T5 的契约，不在这里改。
 */
export function 属性观察表(
  属性们: readonly 属性观察[],
  实体缓存: ReadonlyMap<string, string>,
  卡片们: readonly 卡片草稿[],
): Map<string, 实体属性> {
  const 按出处 = new Map<string, 卡片草稿>()
  for (const 卡 of 卡片们) 按出处.set(`${卡.sheet}#${卡.rowNo}`, 卡)

  const 结果 = new Map<string, 实体属性>()
  for (const a of 属性们) {
    const 卡 = 按出处.get(a.出处.split("#").slice(1).join("#"))
    if (卡 === undefined) continue
    const 参与 = a.归属 === "本方" ? 卡.participants[0] : 卡.participants[1]
    if (!参与.实体) continue
    const entityId = 实体缓存.get(账户键(参与.规范值))
    if (entityId === undefined) continue
    const 现有 = 结果.get(entityId) ?? {}
    结果.set(entityId, 合并属性(现有, { [a.键]: [{ 值: a.值, 出处: a.出处 }] }))
  }
  return 结果
}
