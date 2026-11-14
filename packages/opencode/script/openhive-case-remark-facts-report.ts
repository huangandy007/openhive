#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { readSheets } from "../src/server/openhive/case-sheet"
import { detectMapping } from "../src/server/openhive/case-mapping"
import { toFactRows } from "../src/server/openhive/case-rows"
import { 判定用途, 解析备注段 } from "../src/server/openhive/case-purpose"
import { 抽取备注事实 } from "../src/server/openhive/case-remark-facts"
import type { FactRowInput } from "../src/server/openhive/case-store"

/**
 * 备注事实量化（设计 §8.1-5）：三份真文件逐行走生产链路，报告商户/对象/摘要的覆盖与来源。
 *
 * 用法（**cwd 必须是 `packages/opencode`**）：
 *   timeout 300 bun run script/openhive-case-remark-facts-report.ts "<三份 .xls 所在目录>"
 *
 * 只读、只打印；真数据不入 git。
 */

const 目录 = process.argv[2]
if (!目录) {
  console.error('用法：bun run script/openhive-case-remark-facts-report.ts "<三份 .xls 目录>"')
  process.exit(1)
}

const 清单 = JSON.parse(readFileSync(join(import.meta.dir, "openhive-case-purpose-baseline.json"), "utf8")) as {
  文件们: { 文件: string; 行数: number }[]
}

/** `extras` 是 `Record<string, unknown>`：按生产同一口径（`case-translate.ts`）窄化取字符串。 */
function 备注释(row: FactRowInput): string | null {
  const v = row.extras?.["备注"]
  return typeof v === "string" ? v : null
}

function 交易类型释(row: FactRowInput): string | null {
  const v = row.extras?.["交易类型"]
  return typeof v === "string" ? v : null
}

let 总行 = 0
let 消费行 = 0
let 有子商户段 = 0
/** `有子商户段` 按用途分流：`商户非空` / `解码失败` 只统计消费行，同一个标签里必须能看出差在哪。 */
let 消费有段 = 0
let 非消费有段 = 0
let 商户非空 = 0
let 解码失败 = 0
const 商户们 = new Map<string, number>()
let 车牌行 = 0
const 车牌们 = new Map<string, number>()
let 号码行 = 0
const 号码们 = new Map<string, number>()
let 摘要首段可用 = 0
let 摘要回退商户 = 0
let 摘要回退对手 = 0
let 摘要回退用途 = 0

for (const 项 of 清单.文件们) {
  const 读 = readSheets(new Uint8Array(readFileSync(join(目录, 项.文件))))
  const 表 = 读.sheets[0]
  if (表 === undefined) throw new Error(`没有工作表：${项.文件}`)
  const 头 = 表.header.map((c) => c.text ?? null)
  const 矩阵 = 表.rows.map((r) => r.cells.map((c) => c.text ?? null))
  const 映射 = detectMapping(头, 矩阵)
  const 行们 = toFactRows({ projectId: "p", materialId: "m", mapping: 映射.columns, sheet: 表 })
  for (const 行 of 行们) {
    const 备注 = 备注释(行)
    const 交易类型 = 交易类型释(行)
    总行 += 1
    const 用途 = 判定用途({ 备注, 交易类型 })
    if (用途.一级 === "消费") 消费行 += 1
    // 取「子商户名称」段必须用生产同一解析：`UTF8#…` 的值自身含 `#`，
    // 用 `/子商户名称：([^#]*)/` 会在第一个 `#` 截断成 `UTF8`（假绿，预检修正）。
    const 子商户 = 备注 === null ? undefined : 解析备注段(备注).段["子商户名称"]
    if (子商户 !== undefined && 子商户.trim() !== "") {
      有子商户段 += 1
      if (用途.一级 === "消费") 消费有段 += 1
      else 非消费有段 += 1
    }
    if (
      用途.一级 === "消费" &&
      子商户 !== undefined &&
      子商户.trim().startsWith("UTF8#") &&
      抽取备注事实({ 备注, 用途, 对手名: null }).商户 === null
    )
      解码失败 += 1
    const 事实 = 抽取备注事实({ 备注, 用途, 对手名: 行.counterpartyName ?? 行.counterparty ?? null })
    if (事实.商户 !== null) {
      商户非空 += 1
      商户们.set(事实.商户, (商户们.get(事实.商户) ?? 0) + 1)
    }
    if (事实.车辆.length > 0) {
      车牌行 += 1
      for (const 牌 of 事实.车辆) 车牌们.set(牌, (车牌们.get(牌) ?? 0) + 1)
    }
    if (事实.号码.length > 0) {
      号码行 += 1
      for (const 号 of 事实.号码) 号码们.set(号, (号码们.get(号) ?? 0) + 1)
    }
    if (事实.摘要 === null) continue
    const 对手净 = (行.counterpartyName ?? 行.counterparty ?? "").replace(/\((商户|个人)\)$/u, "").trim()
    if (事实.商户 !== null && 事实.摘要 === 事实.商户) 摘要回退商户 += 1
    else if (对手净 !== "" && 事实.摘要 === 对手净) 摘要回退对手 += 1
    else if (事实.摘要 === (用途.二级 ?? 用途.一级)) 摘要回退用途 += 1
    else 摘要首段可用 += 1
  }
}

const 前 = (表: Map<string, number>) =>
  [...表.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => `${v}\t${k}`)
    .join("\n  ")

console.log(`总行 ${总行}；消费行 ${消费行}`)
console.log(
  `备注含子商户段 ${有子商户段}（消费行 ${消费有段} / 非消费行 ${非消费有段}）；` +
    `消费行内商户非空 ${商户非空}（去重 ${商户们.size}）；消费行内解码失败 ${解码失败}`,
)
console.log(`车牌：${车牌行} 行 / 去重 ${车牌们.size} 个`)
console.log(`  前 10：\n  ${前(车牌们)}`)
console.log(`手机号：${号码行} 行 / 去重 ${号码们.size} 个`)
console.log(`  前 10：\n  ${前(号码们)}`)
// 分类是按「摘要文本等于谁」反推的，只能说明长相，不声称来源（首段本来就可能是商户名）。
console.log(`摘要取值：等于商户名 ${摘要回退商户}；等于对手名 ${摘要回退对手}；等于用途 ${摘要回退用途}；其他 ${摘要首段可用}`)
console.log(`商户前 10：\n  ${前(商户们)}`)
