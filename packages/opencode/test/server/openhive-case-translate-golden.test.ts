import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { detectMapping } from "../../src/server/openhive/case-mapping"
import { toFactRows } from "../../src/server/openhive/case-rows"
import { 翻译资金, type 跳过原因 } from "../../src/server/openhive/case-translate"
import type { 属性归属 } from "../../src/server/openhive/case-attribute-registry"
import type { RawRow, RawSheet } from "../../src/server/openhive/case-sheet"

/**
 * 金标准门禁（01 §4.3）：C1 列级 ≥98% 且误认 0；C2 值级 100%；C3 行级 ≥95%；C4 案件级完全一致。
 *
 * ⚠️ 本轮夹具是**合成的**：35 份真实资金文件尚未到手（计划缺口表第 1 条）。真实文件到位后
 * 只需把 `表.json` 换成从 xlsx 转出的同形 JSON，用例本身不改——门槛先钉住，数据后补。
 */
const 根 = join(import.meta.dir, "../fixtures/translate/资金")

interface 夹具表 {
  说明: string
  覆盖变体: string[]
  sheets: Record<string, string[][]>
}
interface 期望 {
  列: Record<string, string | null>
  卡片: {
    rowNo: number
    amount: string
    precision: "到日" | "到分" | "到秒"
    主体角色: "付款方" | "收款方"
    对方角色: "付款方" | "收款方"
    对方: string
  }[]
  跳过: { rowNo: number; 原因: 跳过原因 }[]
  属性?: { 归属: 属性归属; 键: string; 值: string; rowNo: number }[]
  掩码实体?: { rowNo: number; 不可建实体: boolean }[]
  汇总: { 笔数: number; 合计: string }
}

function 造表(名: string, aoa: string[][]): RawSheet {
  const [表头 = [], ...行们] = aoa
  const 转 = (t: string): RawRow["cells"][number] =>
    t === "" ? { text: null, kind: "empty" } : { text: t, kind: /^-?\d+(\.\d+)?$/.test(t) ? "number" : "text" }
  return {
    name: 名,
    header: 表头.map(转),
    rows: 行们.map((r, i) => ({ rowNo: i + 2, cells: r.map(转) })),
  }
}

describe.each(readdirSync(根, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name))(
  "金标准：%s",
  (目录) => {
    // `JSON.parse` 返回 `any`：直接赋给有类型的常量，不用 `as`（不触发 no-unsafe-type-assertion）。
    const 夹具: 夹具表 = JSON.parse(readFileSync(join(根, 目录, "表.json"), "utf8"))
    const 期望: 期望 = JSON.parse(readFileSync(join(根, 目录, "expected.json"), "utf8"))
    const sheets = Object.entries(夹具.sheets).map(([名, aoa]) => 造表(名, aoa))
    const sheet = sheets[0]
    const 表头 = sheet.header.map((c) => c.text)
    const 行们 = sheet.rows.map((r) => r.cells.map((c) => c.text))
    const 映射 = detectMapping(表头, 行们)

    test("C1 列级：≥98% 且误认 0", () => {
      const 键们 = Object.keys(期望.列)
      let 命中 = 0
      const 误认: string[] = []
      for (let i = 0; i < 表头.length; i++) {
        const 表头名 = 表头[i] ?? ""
        if (!(表头名 in 期望.列)) continue
        const 期望字段 = 期望.列[表头名]
        const 实际字段 = 映射.columns[i] ?? null
        if ((期望字段 ?? null) === (实际字段 ?? null)) {
          命中 += 1
          continue
        }
        if (期望字段 === null && 实际字段 !== null) 误认.push(`${表头名} ⇒ ${实际字段}（期望不认）`)
        if (期望字段 !== null && 实际字段 !== null) 误认.push(`${表头名} ⇒ ${实际字段}（期望 ${期望字段}）`)
      }
      expect(误认).toEqual([])
      expect(命中 / 键们.length).toBeGreaterThanOrEqual(0.98)
    })

    test("C2/C3 值级与行级：卡片逐个对，跳过逐条对", () => {
      const 明细 = toFactRows({ projectId: "p-gold", materialId: "m-gold", sheet, mapping: 映射.columns })
      const 结果 = 翻译资金({ projectId: "p-gold", materialId: "m-gold", rows: 明细 })

      expect(结果.跳过们.map(({ rowNo, 原因 }) => ({ rowNo, 原因 }))).toEqual(期望.跳过)
      for (const 期望卡 of 期望.卡片) {
        const 卡 = 结果.卡片们.find((c) => c.rowNo === 期望卡.rowNo)
        expect(卡).toBeDefined()
        expect(卡).toMatchObject({
          amount: 期望卡.amount,
          precision: 期望卡.precision,
          type: "资金交易",
          currency: "CNY",
        })
        expect(卡?.participants[0]?.角色).toBe(期望卡.主体角色)
        expect(卡?.participants[1]?.角色).toBe(期望卡.对方角色)
        expect(卡?.participants[1]?.提及).toBe(期望卡.对方)
      }
      // C3：卡片数 / 应该产卡的行数
      expect(结果.卡片们.length / 期望.卡片.length).toBeGreaterThanOrEqual(0.95)

      for (const 期望属性 of 期望.属性 ?? []) {
        expect(结果.属性们).toContainEqual({
          归属: 期望属性.归属,
          键: 期望属性.键,
          值: 期望属性.值,
          出处: `m-gold#${sheet.name}#${期望属性.rowNo}`,
        })
      }
      for (const 掩 of 期望.掩码实体 ?? []) {
        const 卡 = 结果.卡片们.find((c) => c.rowNo === 掩.rowNo)
        expect(卡?.participants[1]?.实体).toBe(false)
      }
    })

    test("C4 案件级：笔数与合计完全一致", () => {
      const 明细 = toFactRows({ projectId: "p-gold", materialId: "m-gold", sheet, mapping: 映射.columns })
      const { 卡片们 } = 翻译资金({ projectId: "p-gold", materialId: "m-gold", rows: 明细 })
      const 合计 = 卡片们.reduce((n, c) => n + Number(c.amount), 0).toFixed(2)
      expect(卡片们.length).toBe(期望.汇总.笔数)
      expect(合计).toBe(期望.汇总.合计)
    })
  },
)
